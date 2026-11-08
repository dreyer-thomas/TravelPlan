import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { DELETE, POST } from "@/app/api/trips/[id]/packing-items/day-links/route";
import { prisma } from "@/lib/db/prisma";
import { createSessionJwt } from "@/lib/auth/jwt";
import { routeContext } from "./helpers/routeContext";

/** Story 16.2 (FR59). `/api/trips/[id]/packing-items/day-links`: link, create-and-link, unlink. */

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

type WireItem = {
  id: string;
  name: string;
  category: string | null;
  packed: boolean;
  notNeeded: boolean;
  dayCount: number;
  days: { id: string; dayIndex: number; date: string }[];
};

const CSRF = "csrf-token-day-links";

const buildRequest = (url: string, options: { session: string; csrf?: string; method: string; body: unknown }) => {
  const headers: Record<string, string> = { "Content-Type": "application/json", cookie: `session=${options.session}` };
  if (options.csrf) {
    headers.cookie = `${headers.cookie}; csrf_token=${options.csrf}`;
    headers["x-csrf-token"] = options.csrf;
  }
  return new NextRequest(url, {
    method: options.method,
    headers,
    body: typeof options.body === "string" ? options.body : JSON.stringify(options.body),
  });
};

let counter = 0;
const createUser = (label: string) =>
  prisma.user.create({
    data: { email: `day-links-${label}-${counter++}@example.com`, passwordHash: "hashed", role: "OWNER", mustChangePassword: false },
  });

const tokenFor = (user: { id: string }) => createSessionJwt({ sub: user.id, role: "OWNER" });

const createTrip = (userId: string) =>
  prisma.trip.create({
    data: {
      userId,
      name: "Day Links Trip",
      startDate: new Date("2026-12-01T00:00:00.000Z"),
      endDate: new Date("2026-12-02T00:00:00.000Z"),
    },
  });

const setup = async () => {
  const owner = await createUser("owner");
  const contributor = await createUser("contributor");
  const viewer = await createUser("viewer");
  const stranger = await createUser("stranger");
  const trip = await createTrip(owner.id);
  await prisma.tripMember.createMany({
    data: [
      { tripId: trip.id, userId: contributor.id, role: "CONTRIBUTOR" },
      { tripId: trip.id, userId: viewer.id, role: "VIEWER" },
    ],
  });
  const day = await prisma.tripDay.create({ data: { tripId: trip.id, dayIndex: 1, date: new Date("2026-12-01T00:00:00.000Z") } });
  const pass = await prisma.packingItem.create({ data: { tripId: trip.id, name: "Pass", nameKey: "pass", category: "Dokumente" } });
  return {
    owner,
    trip,
    day,
    pass,
    ownerToken: await tokenFor(owner),
    contributor: await tokenFor(contributor),
    viewer: await tokenFor(viewer),
    stranger: await tokenFor(stranger),
  };
};

const write = (method: "POST" | "DELETE", tripId: string, session: string, body: unknown, csrf: string | null = CSRF) => {
  const handler = method === "POST" ? POST : DELETE;
  return handler(
    buildRequest(`http://localhost/api/trips/${tripId}/packing-items/day-links`, { session, csrf: csrf ?? undefined, method, body }),
    routeContext(tripId),
  );
};

describe("/api/trips/[id]/packing-items/day-links (Story 16.2)", () => {
  beforeEach(async () => {
    await prisma.packingItem.deleteMany();
    await prisma.tripDay.deleteMany();
    await prisma.tripMember.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
  });

  it("links an existing item", async () => {
    const ctx = await setup();
    const response = await write("POST", ctx.trip.id, ctx.contributor, { tripDayId: ctx.day.id, itemId: ctx.pass.id });
    const payload = (await response.json()) as ApiEnvelope<{ item: WireItem; created: boolean }>;
    expect(response.status).toBe(200);
    expect(payload.data).toMatchObject({ created: false, item: { id: ctx.pass.id, dayCount: 1 } });
    expect(payload.data!.item.days).toEqual([{ id: ctx.day.id, dayIndex: 1, date: "2026-12-01T00:00:00.000Z" }]);
  });

  it("creates a new item by name, and links an existing name instead of creating it", async () => {
    const ctx = await setup();

    const created = await write("POST", ctx.trip.id, ctx.ownerToken, { tripDayId: ctx.day.id, name: "Taucherbrille", category: "Sport" });
    const createdPayload = (await created.json()) as ApiEnvelope<{ item: WireItem; created: boolean }>;
    expect(created.status).toBe(200);
    expect(createdPayload.data).toMatchObject({ created: true, item: { name: "Taucherbrille", category: "Sport", packed: false, dayCount: 1 } });

    const existing = await write("POST", ctx.trip.id, ctx.ownerToken, { tripDayId: ctx.day.id, name: " PASS " });
    const existingPayload = (await existing.json()) as ApiEnvelope<{ item: WireItem; created: boolean }>;
    expect(existingPayload.data).toMatchObject({ created: false, item: { id: ctx.pass.id, name: "Pass", category: "Dokumente" } });
    expect(await prisma.packingItem.count()).toBe(2);
  });

  it("unlinks", async () => {
    const ctx = await setup();
    await prisma.packingItemDay.create({ data: { packingItemId: ctx.pass.id, tripDayId: ctx.day.id } });

    const response = await write("DELETE", ctx.trip.id, ctx.contributor, { tripDayId: ctx.day.id, itemId: ctx.pass.id });
    const payload = (await response.json()) as ApiEnvelope<{ item: WireItem }>;
    expect(response.status).toBe(200);
    expect(payload.data!.item).toMatchObject({ id: ctx.pass.id, dayCount: 0, days: [] });
    expect(await prisma.packingItem.count()).toBe(1);
  });

  it("refuses a viewer (403) and a stranger (404), writing nothing", async () => {
    const ctx = await setup();
    await prisma.packingItemDay.create({ data: { packingItemId: ctx.pass.id, tripDayId: ctx.day.id } });
    for (const [session, status] of [
      [ctx.viewer, 403],
      [ctx.stranger, 404],
    ] as const) {
      expect((await write("POST", ctx.trip.id, session, { tripDayId: ctx.day.id, name: "Mütze" })).status).toBe(status);
      expect((await write("DELETE", ctx.trip.id, session, { tripDayId: ctx.day.id, itemId: ctx.pass.id })).status).toBe(status);
    }
    expect(await prisma.packingItem.count()).toBe(1);
    expect(await prisma.packingItemDay.count()).toBe(1);
  });

  it("refuses a write without CSRF (403)", async () => {
    const ctx = await setup();
    const response = await write("POST", ctx.trip.id, ctx.ownerToken, { tripDayId: ctx.day.id, itemId: ctx.pass.id }, null);
    expect(response.status).toBe(403);
    await prisma.packingItemDay.create({ data: { packingItemId: ctx.pass.id, tripDayId: ctx.day.id } });
    const unlink = await write("DELETE", ctx.trip.id, ctx.ownerToken, { tripDayId: ctx.day.id, itemId: ctx.pass.id }, null);
    expect(unlink.status).toBe(403);
    expect(await prisma.packingItemDay.count()).toBe(1);
  });

  it("answers 400 for an invalid body", async () => {
    const ctx = await setup();
    const bad = [
      "{not json",
      { tripDayId: ctx.day.id, itemId: ctx.pass.id, name: "Pass" },
      { tripDayId: ctx.day.id },
      { tripDayId: ctx.day.id, name: "   " },
      { tripDayId: ctx.day.id, name: "x".repeat(81) },
      { itemId: ctx.pass.id },
    ];
    for (const body of bad) {
      expect((await write("POST", ctx.trip.id, ctx.ownerToken, body)).status).toBe(400);
    }
    expect((await write("DELETE", ctx.trip.id, ctx.ownerToken, { tripDayId: ctx.day.id, name: "Pass" })).status).toBe(400);
    expect(await prisma.packingItemDay.count()).toBe(0);
  });

  it("answers 404 for a day or item not of this trip", async () => {
    const ctx = await setup();
    const otherTrip = await createTrip(ctx.owner.id);
    const foreignDay = await prisma.tripDay.create({
      data: { tripId: otherTrip.id, dayIndex: 1, date: new Date("2026-12-01T00:00:00.000Z") },
    });
    const foreignItem = await prisma.packingItem.create({ data: { tripId: otherTrip.id, name: "Pass", nameKey: "pass" } });

    const unknownDay = await write("POST", ctx.trip.id, ctx.ownerToken, { tripDayId: foreignDay.id, itemId: ctx.pass.id });
    expect(unknownDay.status).toBe(404);
    expect(((await unknownDay.json()) as ApiEnvelope<unknown>).error?.message).toBe("Trip day not found");

    const unknownItem = await write("POST", ctx.trip.id, ctx.ownerToken, { tripDayId: ctx.day.id, itemId: foreignItem.id });
    expect(unknownItem.status).toBe(404);
    expect(((await unknownItem.json()) as ApiEnvelope<unknown>).error?.message).toBe("Packing item not found");

    // The day section relies on this message to drop an item deleted elsewhere (DW-433).
    const unlinkForeign = await write("DELETE", ctx.trip.id, ctx.ownerToken, { tripDayId: ctx.day.id, itemId: foreignItem.id });
    expect(unlinkForeign.status).toBe(404);
    expect(((await unlinkForeign.json()) as ApiEnvelope<unknown>).error?.message).toBe("Packing item not found");

    const unlinkForeignDay = await write("DELETE", ctx.trip.id, ctx.ownerToken, { tripDayId: foreignDay.id, itemId: ctx.pass.id });
    expect(unlinkForeignDay.status).toBe(404);
    expect(((await unlinkForeignDay.json()) as ApiEnvelope<unknown>).error?.message).toBe("Trip day not found");
    expect(await prisma.packingItemDay.count()).toBe(0);
  });

  it("refuses a not-needed item by id and by name (409 not_needed); markNeeded marks and links (Story 16.7)", async () => {
    const ctx = await setup();
    await prisma.packingItem.update({ where: { id: ctx.pass.id }, data: { notNeeded: true } });

    const byId = await write("POST", ctx.trip.id, ctx.contributor, { tripDayId: ctx.day.id, itemId: ctx.pass.id });
    expect(byId.status).toBe(409);
    expect(((await byId.json()) as ApiEnvelope<unknown>).error).toMatchObject({ code: "not_needed" });
    const byName = await write("POST", ctx.trip.id, ctx.contributor, { tripDayId: ctx.day.id, name: " PASS " });
    expect(byName.status).toBe(409);
    expect(((await byName.json()) as ApiEnvelope<unknown>).error).toMatchObject({ code: "not_needed" });
    expect(await prisma.packingItemDay.count()).toBe(0);
    expect(await prisma.packingItem.count()).toBe(1);

    const marked = await write("POST", ctx.trip.id, ctx.contributor, { tripDayId: ctx.day.id, itemId: ctx.pass.id, markNeeded: true });
    expect(marked.status).toBe(200);
    expect(((await marked.json()) as ApiEnvelope<{ item: WireItem }>).data!.item).toMatchObject({
      id: ctx.pass.id,
      notNeeded: false,
      dayCount: 1,
    });

    // By name with markNeeded resolves onto the existing item (no duplicate).
    await prisma.packingItemDay.deleteMany();
    await prisma.packingItem.update({ where: { id: ctx.pass.id }, data: { notNeeded: true } });
    const markedByName = await write("POST", ctx.trip.id, ctx.contributor, { tripDayId: ctx.day.id, name: "pass", markNeeded: true });
    expect(markedByName.status).toBe(200);
    expect(((await markedByName.json()) as ApiEnvelope<{ item: WireItem; created: boolean }>).data).toMatchObject({
      created: false,
      item: { id: ctx.pass.id, notNeeded: false, dayCount: 1 },
    });
    expect(await prisma.packingItem.count()).toBe(1);
  });

  it("answers 400 for markNeeded with a value other than true (Story 16.7)", async () => {
    const ctx = await setup();
    for (const markNeeded of [false, "true", 1]) {
      const response = await write("POST", ctx.trip.id, ctx.ownerToken, { tripDayId: ctx.day.id, itemId: ctx.pass.id, markNeeded });
      expect(response.status).toBe(400);
    }
    expect(await prisma.packingItemDay.count()).toBe(0);
  });
});
