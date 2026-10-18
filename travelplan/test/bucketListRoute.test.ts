import fs from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { DELETE, GET, PATCH, POST } from "@/app/api/trips/[id]/bucket-list-items/route";
import { prisma } from "@/lib/db/prisma";
import { createSessionJwt } from "@/lib/auth/jwt";
import { getMediaRoot } from "@/lib/trips/uploadPaths";
import { routeContext } from "./helpers/routeContext";

/**
 * Story 14.1 rewrote this suite for the parked activity: the bucket list is `DayPlanItem` rows without a
 * day. Every scenario of the old suite is kept (order, refusals, CSRF, validation, roles); the payload
 * is the activity's.
 */

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

type WireItem = {
  id: string;
  tripId: string;
  title: string;
  contentJson: string;
  durationMinutes: number;
  costCents: number | null;
  payments: { amountCents: number; dueDate: string }[];
  linkUrl: string | null;
  location: { lat: number; lng: number; label: string | null } | null;
  firstImageUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

const buildRequest = (
  url: string,
  options?: { session?: string; csrf?: string; method?: string; body?: string },
) => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (options?.session) {
    headers.cookie = `session=${options.session}`;
  }

  if (options?.csrf) {
    headers.cookie = headers.cookie ? `${headers.cookie}; csrf_token=${options.csrf}` : `csrf_token=${options.csrf}`;
    headers["x-csrf-token"] = options.csrf;
  }

  return new NextRequest(url, {
    method: options?.method ?? "GET",
    headers,
    body: options?.body,
  });
};

const doc = (text: string) =>
  JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

let counter = 0;
const createUser = (label: string, extra: { role?: "OWNER" | "VIEWER"; mustChangePassword?: boolean } = {}) =>
  prisma.user.create({
    data: {
      email: `bucket-route-${label}-${counter++}@example.com`,
      passwordHash: "hashed",
      role: extra.role ?? "OWNER",
      mustChangePassword: extra.mustChangePassword ?? false,
    },
  });

const createTrip = (userId: string, name = "Bucket Route Trip") =>
  prisma.trip.create({
    data: {
      userId,
      name,
      startDate: new Date("2026-12-01T00:00:00.000Z"),
      endDate: new Date("2026-12-05T00:00:00.000Z"),
    },
  });

const createParked = (tripId: string, title: string, extra: Partial<{ createdAt: Date; locationLat: number; locationLng: number; locationLabel: string; durationMinutes: number }> = {}) =>
  prisma.dayPlanItem.create({
    data: { tripId, tripDayId: null, scheduleMode: "FLEXIBLE", title, contentJson: doc(title), ...extra },
  });

const url = (tripId: string) => `http://localhost/api/trips/${tripId}/bucket-list-items`;

describe("/api/trips/[id]/bucket-list-items (Story 14.1)", () => {
  beforeEach(async () => {
    await prisma.dayPlanItem.deleteMany();
    await prisma.tripDay.deleteMany();
    // Added by Story 5.13, which gave this suite its first memberships. Without it a stale row would
    // decide the next test's role.
    await prisma.tripMember.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
  });

  it("lists the trip's parked activities by title, then created, then id, with duration, place and first picture", async () => {
    const user = await createUser("owner");
    const token = await createSessionJwt({ sub: user.id, role: user.role });
    const trip = await createTrip(user.id);
    const day = await prisma.tripDay.create({ data: { tripId: trip.id, date: new Date("2026-12-01T00:00:00.000Z"), dayIndex: 1 } });

    await createParked(trip.id, "Zoo", { createdAt: new Date("2026-10-01T10:00:00.000Z") });
    const aquarium = await createParked(trip.id, "Aquarium", {
      locationLat: 48.1372,
      locationLng: 11.5756,
      locationLabel: "Marienplatz",
      durationMinutes: 120,
    });
    await prisma.dayPlanItemImage.createMany({
      data: [
        { dayPlanItemId: aquarium.id, imageUrl: "/uploads/trips/t/parked/day-plan-items/a/second.webp", sortOrder: 2 },
        { dayPlanItemId: aquarium.id, imageUrl: "/uploads/trips/t/parked/day-plan-items/a/first.webp", sortOrder: 1 },
      ],
    });
    // Same title, later: after the earlier one.
    await createParked(trip.id, "Zoo", { createdAt: new Date("2026-10-02T10:00:00.000Z") });
    // A planned activity is not on the bucket list.
    await prisma.dayPlanItem.create({
      data: { tripId: trip.id, tripDayId: day.id, title: "Aaa planned", fromTime: "09:00", toTime: "10:00", contentJson: doc("x") },
    });

    const response = await GET(buildRequest(url(trip.id), { session: token }), routeContext(trip.id));
    const payload = (await response.json()) as ApiEnvelope<{ items: WireItem[] }>;

    expect(response.status).toBe(200);
    expect(payload.error).toBeNull();
    const items = payload.data!.items;
    expect(items.map((item) => item.title)).toEqual(["Aquarium", "Zoo", "Zoo"]);
    expect(items[1].createdAt < items[2].createdAt).toBe(true);
    expect(items[0]).toMatchObject({
      id: aquarium.id,
      tripId: trip.id,
      durationMinutes: 120,
      location: { lat: 48.1372, lng: 11.5756, label: "Marienplatz" },
      firstImageUrl: "/uploads/trips/t/parked/day-plan-items/a/first.webp",
      contentJson: doc("Aquarium"),
      payments: [],
    });
    expect(items[1].firstImageUrl).toBeNull();
    expect(items[1].location).toBeNull();
  });

  it("returns 404 when listing items for a non-owned trip", async () => {
    const owner = await createUser("other-owner");
    const user = await createUser("outsider");
    const token = await createSessionJwt({ sub: user.id, role: user.role });
    const trip = await createTrip(owner.id);

    const response = await GET(buildRequest(url(trip.id), { session: token }), routeContext(trip.id));
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(404);
    expect(payload.error?.code).toBe("not_found");
  });

  it("blocks flagged sessions from protected bucket-list routes", async () => {
    const user = await createUser("flagged", { role: "VIEWER", mustChangePassword: true });
    const token = await createSessionJwt({ sub: user.id, role: user.role, mustChangePassword: true });
    const trip = await createTrip(user.id, "Flagged Bucket Trip");

    const response = await GET(buildRequest(url(trip.id), { session: token }), routeContext(trip.id));
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(403);
    expect(payload.data).toBeNull();
    expect(payload.error?.code).toBe("password_change_required");
  });

  it("creates a parked activity with the activity payload: FLEXIBLE, no day, no times, sort order 0", async () => {
    const user = await createUser("creator");
    const token = await createSessionJwt({ sub: user.id, role: user.role });
    const trip = await createTrip(user.id);

    const response = await POST(
      buildRequest(url(trip.id), {
        session: token,
        csrf: "csrf-token",
        method: "POST",
        body: JSON.stringify({
          title: "  Gullfoss  ",
          contentJson: doc("Früh hin"),
          durationMinutes: 120,
          costCents: 2500,
          payments: [
            { amountCents: 1000, dueDate: "2026-11-01" },
            { amountCents: 1500, dueDate: "2026-12-01" },
          ],
          linkUrl: "https://example.com/gullfoss",
          location: { lat: 64.3271, lng: -20.1199, label: "Gullfoss" },
        }),
      }),
      routeContext(trip.id),
    );
    const payload = (await response.json()) as ApiEnvelope<{ item: WireItem; receipt?: unknown }>;

    expect(response.status).toBe(200);
    expect(payload.error).toBeNull();
    expect(payload.data).not.toHaveProperty("receipt");
    expect(payload.data!.item).toMatchObject({
      title: "Gullfoss",
      durationMinutes: 120,
      costCents: 2500,
      payments: [
        { amountCents: 1000, dueDate: "2026-11-01" },
        { amountCents: 1500, dueDate: "2026-12-01" },
      ],
      linkUrl: "https://example.com/gullfoss",
      location: { lat: 64.3271, lng: -20.1199, label: "Gullfoss" },
      firstImageUrl: null,
    });
    const stored = await prisma.dayPlanItem.findUniqueOrThrow({ where: { id: payload.data!.item.id } });
    expect(stored).toMatchObject({
      tripId: trip.id,
      tripDayId: null,
      scheduleMode: "FLEXIBLE",
      fromTime: null,
      toTime: null,
      sortOrder: 0,
      durationMinutes: 120,
    });
  });

  it("stores 15 minutes when no duration is sent", async () => {
    const user = await createUser("default-duration");
    const token = await createSessionJwt({ sub: user.id, role: user.role });
    const trip = await createTrip(user.id);

    const response = await POST(
      buildRequest(url(trip.id), {
        session: token,
        csrf: "csrf-token",
        method: "POST",
        body: JSON.stringify({ title: "Kurz", contentJson: doc("Kurz") }),
      }),
      routeContext(trip.id),
    );
    const payload = (await response.json()) as ApiEnvelope<{ item: WireItem }>;
    expect(response.status).toBe(200);
    expect(payload.data!.item.durationMinutes).toBe(15);
  });

  it("rejects an empty title, missing text, a bad duration and payments that do not sum on create", async () => {
    const user = await createUser("validator");
    const token = await createSessionJwt({ sub: user.id, role: user.role });
    const trip = await createTrip(user.id);

    const post = (body: unknown) =>
      POST(
        buildRequest(url(trip.id), { session: token, csrf: "csrf-token", method: "POST", body: JSON.stringify(body) }),
        routeContext(trip.id),
      );
    const fieldErrors = async (body: unknown) => {
      const response = await post(body);
      expect(response.status).toBe(400);
      const payload = (await response.json()) as ApiEnvelope<null>;
      expect(payload.error?.code).toBe("validation_error");
      return (payload.error?.details as { fieldErrors: Record<string, string[]> }).fieldErrors;
    };

    expect(await fieldErrors({ title: "   ", contentJson: doc("x") })).toHaveProperty("title");
    expect(await fieldErrors({ title: "Ohne Text", contentJson: JSON.stringify({ type: "doc", content: [] }) })).toHaveProperty(
      "contentJson",
    );
    expect(await fieldErrors({ title: "Kurz", contentJson: doc("x"), durationMinutes: 4 })).toHaveProperty("durationMinutes");
    expect(await fieldErrors({ title: "Lang", contentJson: doc("x"), durationMinutes: 1440 })).toHaveProperty("durationMinutes");
    expect(
      await fieldErrors({ title: "Kosten", contentJson: doc("x"), costCents: 2500, payments: [{ amountCents: 1000, dueDate: "2026-11-01" }] }),
    ).toHaveProperty("payments");
    expect(await prisma.dayPlanItem.count()).toBe(0);
  });

  it("refuses a day field on a parked payload (strict): a time, a mode or a day", async () => {
    const user = await createUser("strict");
    const token = await createSessionJwt({ sub: user.id, role: user.role });
    const trip = await createTrip(user.id);

    for (const extra of [{ fromTime: "09:00" }, { toTime: "10:00" }, { scheduleMode: "FIXED" }, { tripDayId: "day-1" }]) {
      const response = await POST(
        buildRequest(url(trip.id), {
          session: token,
          csrf: "csrf-token",
          method: "POST",
          body: JSON.stringify({ title: "Strikt", contentJson: doc("x"), ...extra }),
        }),
        routeContext(trip.id),
      );
      expect(response.status).toBe(400);
      expect(((await response.json()) as ApiEnvelope<null>).error?.code).toBe("validation_error");
    }
    expect(await prisma.dayPlanItem.count()).toBe(0);
  });

  it("rejects create without CSRF token", async () => {
    const user = await createUser("csrf-create");
    const token = await createSessionJwt({ sub: user.id, role: user.role });
    const trip = await createTrip(user.id);

    const response = await POST(
      buildRequest(url(trip.id), { session: token, method: "POST", body: JSON.stringify({ title: "x", contentJson: doc("x") }) }),
      routeContext(trip.id),
    );
    expect(response.status).toBe(403);
    expect(((await response.json()) as ApiEnvelope<null>).error?.code).toBe("csrf_invalid");
  });

  it("rejects create for non-owned trip", async () => {
    const owner = await createUser("create-owner");
    const user = await createUser("create-outsider");
    const token = await createSessionJwt({ sub: user.id, role: user.role });
    const trip = await createTrip(owner.id);

    const response = await POST(
      buildRequest(url(trip.id), {
        session: token,
        csrf: "csrf-token",
        method: "POST",
        body: JSON.stringify({ title: "x", contentJson: doc("x") }),
      }),
      routeContext(trip.id),
    );
    expect(response.status).toBe(404);
    expect(await prisma.dayPlanItem.count()).toBe(0);
  });

  it("rejects partial location coordinates on create", async () => {
    const user = await createUser("partial-location");
    const token = await createSessionJwt({ sub: user.id, role: user.role });
    const trip = await createTrip(user.id);

    const response = await POST(
      buildRequest(url(trip.id), {
        session: token,
        csrf: "csrf-token",
        method: "POST",
        body: JSON.stringify({ title: "Halb", contentJson: doc("x"), location: { lat: 47.1 } }),
      }),
      routeContext(trip.id),
    );
    expect(response.status).toBe(400);
    expect(((await response.json()) as ApiEnvelope<null>).error?.code).toBe("validation_error");
  });

  it("updates a parked activity and leaves its mode, times and order alone", async () => {
    const user = await createUser("updater");
    const token = await createSessionJwt({ sub: user.id, role: user.role });
    const trip = await createTrip(user.id);
    const item = await createParked(trip.id, "Alt");

    const response = await PATCH(
      buildRequest(url(trip.id), {
        session: token,
        csrf: "csrf-token",
        method: "PATCH",
        body: JSON.stringify({ itemId: item.id, title: "Neu", contentJson: doc("Neu"), durationMinutes: 45, costCents: 900, payments: [{ amountCents: 900, dueDate: "2026-11-30" }] }),
      }),
      routeContext(trip.id),
    );
    const payload = (await response.json()) as ApiEnvelope<{ item: WireItem }>;

    expect(response.status).toBe(200);
    expect(payload.data!.item).toMatchObject({ id: item.id, title: "Neu", durationMinutes: 45, costCents: 900 });
    expect(await prisma.dayPlanItem.findUniqueOrThrow({ where: { id: item.id } })).toMatchObject({
      tripDayId: null,
      scheduleMode: "FLEXIBLE",
      fromTime: null,
      toTime: null,
      sortOrder: 0,
    });
    expect(await prisma.costPayment.count({ where: { dayPlanItemId: item.id } })).toBe(1);
  });

  it("answers 404 for an idea that is on a day by now, and does not edit it", async () => {
    const user = await createUser("scheduled-meanwhile");
    const token = await createSessionJwt({ sub: user.id, role: user.role });
    const trip = await createTrip(user.id);
    const day = await prisma.tripDay.create({ data: { tripId: trip.id, date: new Date("2026-12-01T00:00:00.000Z"), dayIndex: 1 } });
    const planned = await prisma.dayPlanItem.create({
      data: { tripId: trip.id, tripDayId: day.id, title: "Auf dem Tag", fromTime: "09:00", toTime: "10:00", contentJson: doc("x") },
    });

    const response = await PATCH(
      buildRequest(url(trip.id), {
        session: token,
        csrf: "csrf-token",
        method: "PATCH",
        body: JSON.stringify({ itemId: planned.id, title: "Umbenannt", contentJson: doc("x") }),
      }),
      routeContext(trip.id),
    );
    expect(response.status).toBe(404);
    expect(await prisma.dayPlanItem.findUniqueOrThrow({ where: { id: planned.id } })).toMatchObject({
      title: "Auf dem Tag",
      tripDayId: day.id,
    });

    const deleted = await DELETE(
      buildRequest(url(trip.id), { session: token, csrf: "csrf-token", method: "DELETE", body: JSON.stringify({ itemId: planned.id }) }),
      routeContext(trip.id),
    );
    expect(deleted.status).toBe(404);
    expect(await prisma.dayPlanItem.count({ where: { id: planned.id } })).toBe(1);
  });

  it("rejects update without CSRF token", async () => {
    const user = await createUser("csrf-update");
    const token = await createSessionJwt({ sub: user.id, role: user.role });
    const trip = await createTrip(user.id);
    const item = await createParked(trip.id, "Alt");

    const response = await PATCH(
      buildRequest(url(trip.id), {
        session: token,
        method: "PATCH",
        body: JSON.stringify({ itemId: item.id, title: "Neu", contentJson: doc("x") }),
      }),
      routeContext(trip.id),
    );
    expect(response.status).toBe(403);
    expect((await prisma.dayPlanItem.findUniqueOrThrow({ where: { id: item.id } })).title).toBe("Alt");
  });

  it("rejects update for non-owned trip", async () => {
    const owner = await createUser("update-owner");
    const user = await createUser("update-outsider");
    const token = await createSessionJwt({ sub: user.id, role: user.role });
    const trip = await createTrip(owner.id);
    const item = await createParked(trip.id, "Alt");

    const response = await PATCH(
      buildRequest(url(trip.id), {
        session: token,
        csrf: "csrf-token",
        method: "PATCH",
        body: JSON.stringify({ itemId: item.id, title: "Neu", contentJson: doc("x") }),
      }),
      routeContext(trip.id),
    );
    expect(response.status).toBe(404);
    expect((await prisma.dayPlanItem.findUniqueOrThrow({ where: { id: item.id } })).title).toBe("Alt");
  });

  it("deletes a parked activity with its pictures, documents, payments and files", async () => {
    const user = await createUser("deleter");
    const token = await createSessionJwt({ sub: user.id, role: user.role });
    const trip = await createTrip(user.id);
    const item = await createParked(trip.id, "Weg damit");
    const parkedDir = path.join(getMediaRoot(), "uploads", "trips", trip.id, "parked", "day-plan-items", item.id);
    const oldDayDir = path.join(getMediaRoot(), "uploads", "trips", trip.id, "days", "old-day", "day-plan-items", item.id);
    await fs.mkdir(path.join(parkedDir, "documents"), { recursive: true });
    await fs.mkdir(oldDayDir, { recursive: true });
    await fs.writeFile(path.join(parkedDir, "a.webp"), "a");
    await fs.writeFile(path.join(parkedDir, "documents", "doc-1.pdf"), "d");
    await fs.writeFile(path.join(oldDayDir, "old.webp"), "o");
    await prisma.dayPlanItemImage.createMany({
      data: [
        { dayPlanItemId: item.id, imageUrl: `/uploads/trips/${trip.id}/parked/day-plan-items/${item.id}/a.webp`, sortOrder: 1 },
        { dayPlanItemId: item.id, imageUrl: `/uploads/trips/${trip.id}/days/old-day/day-plan-items/${item.id}/old.webp`, sortOrder: 2 },
      ],
    });
    await prisma.dayPlanItemDocument.create({
      data: {
        dayPlanItemId: item.id,
        documentUrl: `/uploads/trips/${trip.id}/parked/day-plan-items/${item.id}/documents/doc-1.pdf`,
        fileName: "Ticket.pdf",
        sortOrder: 1,
      },
    });
    await prisma.costPayment.create({ data: { dayPlanItemId: item.id, amountCents: 100, dueDate: "2026-11-01", sortOrder: 0 } });

    const response = await DELETE(
      buildRequest(url(trip.id), { session: token, csrf: "csrf-token", method: "DELETE", body: JSON.stringify({ itemId: item.id }) }),
      routeContext(trip.id),
    );

    expect(response.status).toBe(200);
    expect(await prisma.dayPlanItem.count()).toBe(0);
    expect(await prisma.dayPlanItemImage.count()).toBe(0);
    expect(await prisma.dayPlanItemDocument.count()).toBe(0);
    expect(await prisma.costPayment.count()).toBe(0);
    await expect(fs.stat(parkedDir)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.stat(path.join(oldDayDir, "old.webp"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects delete without CSRF token", async () => {
    const user = await createUser("csrf-delete");
    const token = await createSessionJwt({ sub: user.id, role: user.role });
    const trip = await createTrip(user.id);
    const item = await createParked(trip.id, "Bleibt");

    const response = await DELETE(
      buildRequest(url(trip.id), { session: token, method: "DELETE", body: JSON.stringify({ itemId: item.id }) }),
      routeContext(trip.id),
    );
    expect(response.status).toBe(403);
    expect(await prisma.dayPlanItem.count()).toBe(1);
  });

  it("rejects delete for non-owned trip", async () => {
    const owner = await createUser("delete-owner");
    const user = await createUser("delete-outsider");
    const token = await createSessionJwt({ sub: user.id, role: user.role });
    const trip = await createTrip(owner.id);
    const item = await createParked(trip.id, "Bleibt");

    const response = await DELETE(
      buildRequest(url(trip.id), { session: token, csrf: "csrf-token", method: "DELETE", body: JSON.stringify({ itemId: item.id }) }),
      routeContext(trip.id),
    );
    expect(response.status).toBe(404);
    expect(await prisma.dayPlanItem.count()).toBe(1);
  });

  it("lets a contributor list, create, update and delete ideas", async () => {
    const owner = await createUser("role-owner");
    const contributor = await createUser("role-contributor", { role: "VIEWER" });
    const token = await createSessionJwt({ sub: contributor.id, role: contributor.role });
    const trip = await createTrip(owner.id, "Bucket Route Roles");
    await prisma.tripMember.create({ data: { tripId: trip.id, userId: contributor.id, role: "CONTRIBUTOR" } });

    const created = await POST(
      buildRequest(url(trip.id), {
        session: token,
        csrf: "csrf-token",
        method: "POST",
        body: JSON.stringify({ title: "Night market", contentJson: doc("Night market") }),
      }),
      routeContext(trip.id),
    );
    const createdPayload = (await created.json()) as ApiEnvelope<{ item: WireItem }>;
    expect(created.status).toBe(200);
    const itemId = createdPayload.data!.item.id;

    const listed = await GET(buildRequest(url(trip.id), { session: token }), routeContext(trip.id));
    expect(((await listed.json()) as ApiEnvelope<{ items: WireItem[] }>).data?.items.map((entry) => entry.title)).toEqual([
      "Night market",
    ]);

    const updated = await PATCH(
      buildRequest(url(trip.id), {
        session: token,
        csrf: "csrf-token",
        method: "PATCH",
        body: JSON.stringify({ itemId, title: "Night market at dusk", contentJson: doc("x") }),
      }),
      routeContext(trip.id),
    );
    expect(updated.status).toBe(200);
    expect(((await updated.json()) as ApiEnvelope<{ item: WireItem }>).data?.item.title).toBe("Night market at dusk");

    const deleted = await DELETE(
      buildRequest(url(trip.id), { session: token, csrf: "csrf-token", method: "DELETE", body: JSON.stringify({ itemId }) }),
      routeContext(trip.id),
    );
    expect(deleted.status).toBe(200);
    expect(await prisma.dayPlanItem.count()).toBe(0);
  });

  it("refuses a viewer 403 forbidden on all four verbs and keeps 404 for a non-participant (Story 14.1 AC5)", async () => {
    const owner = await createUser("refusal-owner");
    const viewer = await createUser("refusal-viewer", { role: "VIEWER" });
    const viewerToken = await createSessionJwt({ sub: viewer.id, role: viewer.role });
    const stranger = await createUser("refusal-stranger");
    const strangerToken = await createSessionJwt({ sub: stranger.id, role: stranger.role });
    const trip = await createTrip(owner.id, "Bucket Route Refusals");
    await prisma.tripMember.create({ data: { tripId: trip.id, userId: viewer.id, role: "VIEWER" } });
    const item = await createParked(trip.id, "Owner idea");

    const callEveryVerb = async (sessionToken: string) => [
      await GET(buildRequest(url(trip.id), { session: sessionToken }), routeContext(trip.id)),
      await POST(
        buildRequest(url(trip.id), {
          session: sessionToken,
          csrf: "csrf-token",
          method: "POST",
          body: JSON.stringify({ title: "Uninvited", contentJson: doc("x") }),
        }),
        routeContext(trip.id),
      ),
      await PATCH(
        buildRequest(url(trip.id), {
          session: sessionToken,
          csrf: "csrf-token",
          method: "PATCH",
          body: JSON.stringify({ itemId: item.id, title: "Renamed", contentJson: doc("x") }),
        }),
        routeContext(trip.id),
      ),
      await DELETE(
        buildRequest(url(trip.id), { session: sessionToken, csrf: "csrf-token", method: "DELETE", body: JSON.stringify({ itemId: item.id }) }),
        routeContext(trip.id),
      ),
    ];

    for (const response of await callEveryVerb(viewerToken)) {
      expect(response.status).toBe(403);
      expect(((await response.json()) as ApiEnvelope<null>).error?.code).toBe("forbidden");
    }
    // A membership is what earns the 403. Without one the answer is still "there is no such trip".
    for (const response of await callEveryVerb(strangerToken)) {
      expect(response.status).toBe(404);
      expect(((await response.json()) as ApiEnvelope<null>).error?.code).toBe("not_found");
    }
    // Nothing refused above touched the owner's list.
    expect(await prisma.dayPlanItem.count()).toBe(1);
    expect((await prisma.dayPlanItem.findUniqueOrThrow({ where: { id: item.id } })).title).toBe("Owner idea");
  });
});
