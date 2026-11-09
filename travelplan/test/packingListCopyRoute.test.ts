import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/trips/[id]/packing-items/copy/route";
import { prisma } from "@/lib/db/prisma";
import { createSessionJwt } from "@/lib/auth/jwt";
import { routeContext } from "./helpers/routeContext";

/** Story 16.5 (FR60). `/api/trips/[id]/packing-items/copy`: copy items from another trip, writers only. */

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

const CSRF = "csrf-token-packing-copy";

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
    data: { email: `packing-copy-${label}-${counter++}@example.com`, passwordHash: "hashed", role: "OWNER", mustChangePassword: false },
  });

const tokenFor = (user: { id: string }) => createSessionJwt({ sub: user.id, role: "OWNER" });

const url = (tripId: string) => `http://localhost/api/trips/${tripId}/packing-items/copy`;

const createTrip = (userId: string, name: string, start: string) =>
  prisma.trip.create({
    data: { userId, name, startDate: new Date(`${start}T00:00:00.000Z`), endDate: new Date(`${start}T00:00:00.000Z`) },
  });

const setup = async () => {
  const owner = await createUser("owner");
  const contributor = await createUser("contributor");
  const viewer = await createUser("viewer");
  const stranger = await createUser("stranger");
  const trip = await createTrip(owner.id, "Ziel", "2027-01-01");
  const source = await createTrip(owner.id, "Sommer", "2026-07-01");
  await prisma.tripMember.createMany({
    data: [
      { tripId: trip.id, userId: contributor.id, role: "CONTRIBUTOR" },
      { tripId: trip.id, userId: viewer.id, role: "VIEWER" },
      { tripId: source.id, userId: contributor.id, role: "VIEWER" },
      { tripId: source.id, userId: viewer.id, role: "VIEWER" },
    ],
  });
  const item = await prisma.packingItem.create({
    data: { tripId: source.id, name: "Badehose", nameKey: "badehose", category: "Kleidung", packed: true },
  });
  const strangerTrip = await createTrip(stranger.id, "Fremd", "2026-05-01");
  const strangerItem = await prisma.packingItem.create({ data: { tripId: strangerTrip.id, name: "Zelt", nameKey: "zelt" } });
  return {
    trip,
    source,
    item,
    strangerTrip,
    strangerItem,
    owner: await tokenFor(owner),
    contributor: await tokenFor(contributor),
    viewer: await tokenFor(viewer),
    stranger: await tokenFor(stranger),
  };
};

const post = (tripId: string, session: string, body: unknown, csrf: string | null = CSRF) =>
  POST(buildRequest(url(tripId), { session, csrf: csrf ?? undefined, method: "POST", body }), routeContext(tripId));

describe("/api/trips/[id]/packing-items/copy (Story 16.5)", () => {
  beforeEach(async () => {
    await prisma.packingItem.deleteMany();
    await prisma.tripDay.deleteMany();
    await prisma.tripMember.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
  });

  it("lists the trips to copy from for owner and contributor, with ISO dates", async () => {
    const ctx = await setup();

    for (const session of [ctx.owner, ctx.contributor]) {
      const response = await GET(buildRequest(url(ctx.trip.id), { session }), routeContext(ctx.trip.id));
      const payload = (await response.json()) as ApiEnvelope<{ trips: unknown[] }>;
      expect(response.status).toBe(200);
      expect(payload.data!.trips).toEqual([
        {
          id: ctx.source.id,
          name: "Sommer",
          startDate: "2026-07-01T00:00:00.000Z",
          endDate: "2026-07-01T00:00:00.000Z",
          itemCount: 1,
        },
      ]);
    }
  });

  it("refuses the listing to a viewer (403), a stranger (404) and without a session (401)", async () => {
    const ctx = await setup();

    expect((await GET(buildRequest(url(ctx.trip.id), { session: ctx.viewer }), routeContext(ctx.trip.id))).status).toBe(403);
    expect((await GET(buildRequest(url(ctx.trip.id), { session: ctx.stranger }), routeContext(ctx.trip.id))).status).toBe(404);
    expect((await GET(buildRequest(url(ctx.trip.id)), routeContext(ctx.trip.id))).status).toBe(401);
  });

  it("copies the chosen items and answers the counts and the created wire items", async () => {
    const ctx = await setup();
    await prisma.packingItem.create({ data: { tripId: ctx.source.id, name: "Pass", nameKey: "pass" } });
    await prisma.packingItem.create({ data: { tripId: ctx.trip.id, name: "PASS", nameKey: "pass" } });
    const pass = await prisma.packingItem.findFirstOrThrow({ where: { tripId: ctx.source.id, nameKey: "pass" } });

    const response = await post(ctx.trip.id, ctx.contributor, { sourceTripId: ctx.source.id, itemIds: [ctx.item.id, pass.id, ctx.item.id] });
    const payload = (await response.json()) as ApiEnvelope<{ added: number; existed: number; items: Record<string, unknown>[] }>;

    expect(response.status).toBe(200);
    expect(payload.data!.added).toBe(1);
    expect(payload.data!.existed).toBe(1);
    expect(payload.data!.items).toEqual([
      expect.objectContaining({ name: "Badehose", category: "Kleidung", packed: false, notNeeded: false, tags: [], dayCount: 0, days: [], aiChangedAt: null }),
    ]);
    expect(typeof payload.data!.items[0].createdAt).toBe("string");
  });

  it("answers 400 for no ids, too many ids, a stray field and invalid JSON", async () => {
    const ctx = await setup();
    const tooMany = Array.from({ length: 501 }, (_, index) => `id-${index}`);

    for (const body of [
      { sourceTripId: ctx.source.id, itemIds: [] },
      { sourceTripId: ctx.source.id, itemIds: tooMany },
      { sourceTripId: ctx.source.id, itemIds: [ctx.item.id], extra: true },
      { sourceTripId: "", itemIds: [ctx.item.id] },
    ]) {
      const response = await post(ctx.trip.id, ctx.owner, body);
      expect(response.status).toBe(400);
      expect(((await response.json()) as ApiEnvelope<unknown>).error!.code).toBe("validation_error");
    }

    const invalid = await post(ctx.trip.id, ctx.owner, "{not json");
    expect(invalid.status).toBe(400);
    expect(((await invalid.json()) as ApiEnvelope<unknown>).error!.code).toBe("invalid_json");
    expect(await prisma.packingItem.count({ where: { tripId: ctx.trip.id } })).toBe(0);
  });

  it("refuses without CSRF (403), for a viewer (403) and a stranger (404)", async () => {
    const ctx = await setup();
    const body = { sourceTripId: ctx.source.id, itemIds: [ctx.item.id] };

    expect((await post(ctx.trip.id, ctx.owner, body, null)).status).toBe(403);
    expect((await post(ctx.trip.id, ctx.viewer, body)).status).toBe(403);
    expect((await post(ctx.trip.id, ctx.stranger, body)).status).toBe(404);
    expect(await prisma.packingItem.count({ where: { tripId: ctx.trip.id } })).toBe(0);
  });

  it("answers 404 source_not_found for a source the person cannot see and for the trip itself", async () => {
    const ctx = await setup();

    for (const body of [
      { sourceTripId: ctx.strangerTrip.id, itemIds: [ctx.strangerItem.id] },
      { sourceTripId: ctx.trip.id, itemIds: [ctx.item.id] },
    ]) {
      const response = await post(ctx.trip.id, ctx.owner, body);
      expect(response.status).toBe(404);
      expect(((await response.json()) as ApiEnvelope<unknown>).error!.code).toBe("source_not_found");
    }
    expect(await prisma.packingItem.count({ where: { tripId: ctx.trip.id } })).toBe(0);
  });
});
