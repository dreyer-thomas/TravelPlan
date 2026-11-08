import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { DELETE, GET, PATCH, POST } from "@/app/api/trips/[id]/packing-items/route";
import { prisma } from "@/lib/db/prisma";
import { createSessionJwt } from "@/lib/auth/jwt";
import { routeContext } from "./helpers/routeContext";

/** Story 16.1 (FR58). `/api/trips/[id]/packing-items`: read for every participant, write for planners. */

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

type WireItem = {
  id: string;
  name: string;
  category: string | null;
  packed: boolean;
  dayCount: number;
  days: { id: string; dayIndex: number; date: string }[];
  aiChangedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

const CSRF = "csrf-token-packing";

const buildRequest = (url: string, options?: { session?: string; csrf?: string; method?: string; body?: unknown }) => {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options?.session) headers.cookie = `session=${options.session}`;
  if (options?.csrf) {
    headers.cookie = headers.cookie ? `${headers.cookie}; csrf_token=${options.csrf}` : `csrf_token=${options.csrf}`;
    headers["x-csrf-token"] = options.csrf;
  }
  return new NextRequest(url, {
    method: options?.method ?? "GET",
    headers,
    body: options?.body === undefined ? undefined : typeof options.body === "string" ? options.body : JSON.stringify(options.body),
  });
};

let counter = 0;
const createUser = (label: string) =>
  prisma.user.create({
    data: { email: `packing-route-${label}-${counter++}@example.com`, passwordHash: "hashed", role: "OWNER", mustChangePassword: false },
  });

const tokenFor = (user: { id: string }) => createSessionJwt({ sub: user.id, role: "OWNER" });

const url = (tripId: string) => `http://localhost/api/trips/${tripId}/packing-items`;

const setup = async () => {
  const owner = await createUser("owner");
  const contributor = await createUser("contributor");
  const viewer = await createUser("viewer");
  const stranger = await createUser("stranger");
  const trip = await prisma.trip.create({
    data: {
      userId: owner.id,
      name: "Packing Route Trip",
      startDate: new Date("2026-12-01T00:00:00.000Z"),
      endDate: new Date("2026-12-03T00:00:00.000Z"),
    },
  });
  await prisma.tripMember.createMany({
    data: [
      { tripId: trip.id, userId: contributor.id, role: "CONTRIBUTOR" },
      { tripId: trip.id, userId: viewer.id, role: "VIEWER" },
    ],
  });
  return {
    trip,
    owner: await tokenFor(owner),
    contributor: await tokenFor(contributor),
    viewer: await tokenFor(viewer),
    stranger: await tokenFor(stranger),
  };
};

const write = (method: "POST" | "PATCH" | "DELETE", tripId: string, session: string, body: unknown, csrf: string | null = CSRF) => {
  const handler = method === "POST" ? POST : method === "PATCH" ? PATCH : DELETE;
  return handler(buildRequest(url(tripId), { session, csrf: csrf ?? undefined, method, body }), routeContext(tripId));
};

describe("/api/trips/[id]/packing-items (Story 16.1)", () => {
  beforeEach(async () => {
    await prisma.packingItem.deleteMany();
    await prisma.tripDay.deleteMany();
    await prisma.tripMember.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
  });

  it("lists items with the caller's role for owner, contributor and viewer; 404 for a stranger", async () => {
    const ctx = await setup();
    const day = await prisma.tripDay.create({ data: { tripId: ctx.trip.id, dayIndex: 1, date: new Date("2026-12-01T00:00:00.000Z") } });
    const item = await prisma.packingItem.create({ data: { tripId: ctx.trip.id, name: "Pass", nameKey: "pass", category: "Dokumente" } });
    await prisma.packingItemDay.create({ data: { packingItemId: item.id, tripDayId: day.id } });

    for (const [session, role] of [
      [ctx.owner, "owner"],
      [ctx.contributor, "contributor"],
      [ctx.viewer, "viewer"],
    ] as const) {
      const response = await GET(buildRequest(url(ctx.trip.id), { session }), routeContext(ctx.trip.id));
      const payload = (await response.json()) as ApiEnvelope<{ accessRole: string; items: WireItem[] }>;
      expect(response.status).toBe(200);
      expect(payload.data!.accessRole).toBe(role);
      expect(payload.data!.items).toEqual([
        expect.objectContaining({ id: item.id, name: "Pass", category: "Dokumente", packed: false, dayCount: 1, aiChangedAt: null }),
      ]);
      expect(typeof payload.data!.items[0].createdAt).toBe("string");
    }

    const strangerResponse = await GET(buildRequest(url(ctx.trip.id), { session: ctx.stranger }), routeContext(ctx.trip.id));
    expect(strangerResponse.status).toBe(404);
  });

  it("answers 401 without a session", async () => {
    const ctx = await setup();
    const response = await GET(buildRequest(url(ctx.trip.id)), routeContext(ctx.trip.id));
    expect(response.status).toBe(401);
  });

  it("creates an item and resolves a duplicate name to the existing one", async () => {
    const ctx = await setup();

    const created = await write("POST", ctx.trip.id, ctx.contributor, { name: " Taucherbrille ", category: "Sport" });
    const createdPayload = (await created.json()) as ApiEnvelope<{ item: WireItem; existed: boolean }>;
    expect(created.status).toBe(200);
    expect(createdPayload.data).toMatchObject({ existed: false, item: { name: "Taucherbrille", category: "Sport", packed: false } });

    const duplicate = await write("POST", ctx.trip.id, ctx.owner, { name: "TAUCHERBRILLE" });
    const duplicatePayload = (await duplicate.json()) as ApiEnvelope<{ item: WireItem; existed: boolean }>;
    expect(duplicate.status).toBe(200);
    expect(duplicatePayload.data).toMatchObject({ existed: true, item: { id: createdPayload.data!.item.id } });
    expect(await prisma.packingItem.count()).toBe(1);
  });

  it("updates name, category and packed; 409 on a duplicate rename; 404 on an unknown item", async () => {
    const ctx = await setup();
    const pass = await prisma.packingItem.create({ data: { tripId: ctx.trip.id, name: "Pass", nameKey: "pass" } });
    await prisma.packingItem.create({ data: { tripId: ctx.trip.id, name: "Brille", nameKey: "brille" } });

    const ticked = await write("PATCH", ctx.trip.id, ctx.owner, { itemId: pass.id, packed: true, category: "Dokumente" });
    expect(ticked.status).toBe(200);
    expect(((await ticked.json()) as ApiEnvelope<{ item: WireItem }>).data!.item).toMatchObject({ packed: true, category: "Dokumente" });

    const cleared = await write("PATCH", ctx.trip.id, ctx.owner, { itemId: pass.id, category: null });
    expect(((await cleared.json()) as ApiEnvelope<{ item: WireItem }>).data!.item.category).toBeNull();

    const clash = await write("PATCH", ctx.trip.id, ctx.owner, { itemId: pass.id, name: "brille" });
    const clashPayload = (await clash.json()) as ApiEnvelope<unknown>;
    expect(clash.status).toBe(409);
    expect(clashPayload.error?.code).toBe("duplicate_name");
    expect((await prisma.packingItem.findUniqueOrThrow({ where: { id: pass.id } })).name).toBe("Pass");

    const unknown = await write("PATCH", ctx.trip.id, ctx.owner, { itemId: "nope", packed: true });
    expect(unknown.status).toBe(404);
    expect(((await unknown.json()) as ApiEnvelope<unknown>).error?.message).toBe("Packing item not found");
  });

  it("deletes an item; 404 on an unknown item", async () => {
    const ctx = await setup();
    const pass = await prisma.packingItem.create({ data: { tripId: ctx.trip.id, name: "Pass", nameKey: "pass" } });

    const deleted = await write("DELETE", ctx.trip.id, ctx.contributor, { itemId: pass.id });
    expect(deleted.status).toBe(200);
    expect(((await deleted.json()) as ApiEnvelope<{ deleted: boolean }>).data).toEqual({ deleted: true });
    expect(await prisma.packingItem.count()).toBe(0);

    const again = await write("DELETE", ctx.trip.id, ctx.contributor, { itemId: pass.id });
    expect(again.status).toBe(404);
  });

  it("refuses every write from a viewer (403) and a stranger (404), writing nothing", async () => {
    const ctx = await setup();
    const pass = await prisma.packingItem.create({ data: { tripId: ctx.trip.id, name: "Pass", nameKey: "pass" } });

    for (const [session, status] of [
      [ctx.viewer, 403],
      [ctx.stranger, 404],
    ] as const) {
      expect((await write("POST", ctx.trip.id, session, { name: "Mütze" })).status).toBe(status);
      expect((await write("PATCH", ctx.trip.id, session, { itemId: pass.id, packed: true })).status).toBe(status);
      expect((await write("DELETE", ctx.trip.id, session, { itemId: pass.id })).status).toBe(status);
    }
    expect(await prisma.packingItem.findMany({ select: { name: true, packed: true } })).toEqual([{ name: "Pass", packed: false }]);
  });

  it("refuses a write without CSRF (403)", async () => {
    const ctx = await setup();
    const response = await write("POST", ctx.trip.id, ctx.owner, { name: "Mütze" }, null);
    expect(response.status).toBe(403);
    expect(((await response.json()) as ApiEnvelope<unknown>).error?.code).toBe("csrf_invalid");
  });

  it("answers 400 for an invalid body", async () => {
    const ctx = await setup();
    const pass = await prisma.packingItem.create({ data: { tripId: ctx.trip.id, name: "Pass", nameKey: "pass" } });

    expect((await write("POST", ctx.trip.id, ctx.owner, "{not json")).status).toBe(400);
    expect((await write("POST", ctx.trip.id, ctx.owner, { name: "   " })).status).toBe(400);
    expect((await write("POST", ctx.trip.id, ctx.owner, { name: "x".repeat(81) })).status).toBe(400);
    expect((await write("POST", ctx.trip.id, ctx.owner, { name: "ok", category: "c".repeat(41) })).status).toBe(400);
    expect((await write("POST", ctx.trip.id, ctx.owner, { name: "ok", extra: 1 })).status).toBe(400);
    expect((await write("PATCH", ctx.trip.id, ctx.owner, { itemId: pass.id })).status).toBe(400);
    expect((await write("PATCH", ctx.trip.id, ctx.owner, { itemId: pass.id, name: "" })).status).toBe(400);
    expect((await write("DELETE", ctx.trip.id, ctx.owner, {})).status).toBe(400);

    // 80 characters after trimming is still fine.
    expect((await write("POST", ctx.trip.id, ctx.owner, { name: `  ${"x".repeat(80)}  ` })).status).toBe(200);
  });

  it("carries the linked days with ISO dates in the wire (Story 16.2)", async () => {
    const ctx = await setup();
    const day2 = await prisma.tripDay.create({ data: { tripId: ctx.trip.id, dayIndex: 2, date: new Date("2026-12-02T00:00:00.000Z") } });
    const day1 = await prisma.tripDay.create({ data: { tripId: ctx.trip.id, dayIndex: 1, date: new Date("2026-12-01T00:00:00.000Z") } });
    const item = await prisma.packingItem.create({ data: { tripId: ctx.trip.id, name: "Pass", nameKey: "pass" } });
    await prisma.packingItemDay.createMany({
      data: [
        { packingItemId: item.id, tripDayId: day2.id },
        { packingItemId: item.id, tripDayId: day1.id },
      ],
    });

    const response = await GET(buildRequest(url(ctx.trip.id), { session: ctx.viewer }), routeContext(ctx.trip.id));
    const payload = (await response.json()) as ApiEnvelope<{ items: WireItem[] }>;
    expect(payload.data!.items[0].days).toEqual([
      { id: day1.id, dayIndex: 1, date: "2026-12-01T00:00:00.000Z" },
      { id: day2.id, dayIndex: 2, date: "2026-12-02T00:00:00.000Z" },
    ]);
  });

  it("answers 409 days_changed with the fresh count when the confirmed day count is stale (Story 16.2, DW-432)", async () => {
    const ctx = await setup();
    const day = await prisma.tripDay.create({ data: { tripId: ctx.trip.id, dayIndex: 1, date: new Date("2026-12-01T00:00:00.000Z") } });
    const item = await prisma.packingItem.create({ data: { tripId: ctx.trip.id, name: "Pass", nameKey: "pass" } });
    await prisma.packingItemDay.create({ data: { packingItemId: item.id, tripDayId: day.id } });

    const stale = await write("DELETE", ctx.trip.id, ctx.owner, { itemId: item.id, confirmedDayCount: 0 });
    const stalePayload = (await stale.json()) as ApiEnvelope<unknown>;
    expect(stale.status).toBe(409);
    expect(stalePayload.error).toMatchObject({ code: "days_changed", details: { dayCount: 1 } });
    expect(await prisma.packingItem.count()).toBe(1);

    const confirmed = await write("DELETE", ctx.trip.id, ctx.owner, { itemId: item.id, confirmedDayCount: 1 });
    expect(confirmed.status).toBe(200);
    expect(await prisma.packingItem.count()).toBe(0);
    expect(await prisma.packingItemDay.count()).toBe(0);

    expect((await write("DELETE", ctx.trip.id, ctx.owner, { itemId: item.id, confirmedDayCount: -1 })).status).toBe(400);
  });
});
