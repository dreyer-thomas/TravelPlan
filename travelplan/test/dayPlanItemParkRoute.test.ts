import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST as PARK_POST } from "@/app/api/trips/[id]/day-plan-items/park/route";
import { POST as UNDO_POST } from "@/app/api/trips/[id]/day-plan-changes/undo/route";
import { prisma } from "@/lib/db/prisma";
import { createSessionJwt } from "@/lib/auth/jwt";
import { routeContext } from "./helpers/routeContext";

/** Story 14.2 AC7, AC8. `POST /api/trips/{id}/day-plan-items/park`, through real requests. */

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

const CSRF = "csrf-token-value";

const sampleDoc = (text: string) =>
  JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

const buildRequest = (url: string, options: { session?: string; csrf?: string; body: string }) => {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const cookies: string[] = [];
  if (options.session) cookies.push(`session=${options.session}`);
  if (options.csrf) {
    cookies.push(`csrf_token=${options.csrf}`);
    headers["x-csrf-token"] = options.csrf;
  }
  if (cookies.length > 0) headers.cookie = cookies.join("; ");
  return new NextRequest(url, { method: "POST", headers, body: options.body });
};

const park = (tripId: string, session: string, body: unknown, csrf: string | undefined = CSRF) =>
  PARK_POST(
    buildRequest(`http://localhost/api/trips/${tripId}/day-plan-items/park`, {
      session,
      csrf,
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    routeContext(tripId),
  );

const seed = async (label: string) => {
  const owner = await prisma.user.create({
    data: { email: `park-route-${label}-owner@example.com`, passwordHash: "hashed", role: "OWNER" },
  });
  const trip = await prisma.trip.create({
    data: {
      userId: owner.id,
      name: "Park Route Trip",
      startDate: new Date("2026-12-03T00:00:00.000Z"),
      endDate: new Date("2026-12-04T00:00:00.000Z"),
    },
  });
  const day = await prisma.tripDay.create({ data: { tripId: trip.id, date: new Date("2026-12-03T00:00:00.000Z"), dayIndex: 1 } });
  const otherDay = await prisma.tripDay.create({ data: { tripId: trip.id, date: new Date("2026-12-04T00:00:00.000Z"), dayIndex: 2 } });
  const item = await prisma.dayPlanItem.create({
    data: { tripId: trip.id, tripDayId: day.id, title: "Wasserfall", fromTime: "10:00", toTime: "12:00", contentJson: sampleDoc("x") },
  });
  const session = await createSessionJwt({ sub: owner.id, role: owner.role });
  return { owner, trip, day, otherDay, item, session };
};

const member = async (tripId: string, label: string, role: "VIEWER" | "CONTRIBUTOR") => {
  const user = await prisma.user.create({
    data: { email: `park-route-${label}@example.com`, passwordHash: "hashed", role: "VIEWER" },
  });
  await prisma.tripMember.create({ data: { tripId, userId: user.id, role } });
  return createSessionJwt({ sub: user.id, role: user.role });
};

const items = () => prisma.dayPlanItem.findMany({ orderBy: { id: "asc" } });

describe("POST /api/trips/[id]/day-plan-items/park (Story 14.2 AC7, AC8)", () => {
  beforeEach(async () => {
    await prisma.travelSegment.deleteMany();
    await prisma.costPayment.deleteMany();
    await prisma.dayPlanItem.deleteMany();
    await prisma.tripMember.deleteMany();
    await prisma.tripDay.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
  });

  it("parks for the owner with a signed parked receipt that the undo route accepts", async () => {
    const { trip, day, item, session } = await seed("owner");
    const before = await items();

    const response = await park(trip.id, session, { itemId: item.id, tripDayId: day.id });
    const payload = (await response.json()) as ApiEnvelope<{
      item: { id: string; tripDayId: string | null; scheduleMode: string; durationMinutes: number; createdAt: string };
      receipt: { version: number; signature: string; edited: { kind: string; itemId: string } };
    }>;

    expect(response.status).toBe(200);
    expect(payload.data?.item).toMatchObject({ id: item.id, tripDayId: null, scheduleMode: "FLEXIBLE", durationMinutes: 120 });
    expect(payload.data?.item.createdAt).toBe(item.createdAt.toISOString());
    expect(payload.data?.receipt).toMatchObject({ version: 3, edited: { kind: "parked", itemId: item.id } });
    expect(payload.data?.receipt.signature).toMatch(/^[0-9a-f]{64}$/);

    const undo = await UNDO_POST(
      buildRequest(`http://localhost/api/trips/${trip.id}/day-plan-changes/undo`, {
        session,
        csrf: CSRF,
        body: JSON.stringify({ receipt: payload.data?.receipt }),
      }),
      routeContext(trip.id),
    );
    expect(undo.status).toBe(200);
    expect(await items()).toEqual(before);
  });

  it("parks for a contributor (TripMember.role decides, not User.role)", async () => {
    const { trip, day, item } = await seed("contributor");
    const session = await member(trip.id, "contributor", "CONTRIBUTOR");

    expect((await park(trip.id, session, { itemId: item.id, tripDayId: day.id })).status).toBe(200);
    expect((await prisma.dayPlanItem.findUniqueOrThrow({ where: { id: item.id } })).tripDayId).toBeNull();
  });

  it("answers a viewer 403 forbidden and an outsider 404, writing nothing", async () => {
    const { trip, day, item } = await seed("roles");
    const viewer = await member(trip.id, "viewer", "VIEWER");
    const stranger = await prisma.user.create({ data: { email: "park-route-stranger@example.com", passwordHash: "hashed", role: "OWNER" } });
    const before = await items();

    const asViewer = await park(trip.id, viewer, { itemId: item.id, tripDayId: day.id });
    expect(asViewer.status).toBe(403);
    expect(((await asViewer.json()) as ApiEnvelope<null>).error?.code).toBe("forbidden");
    const asStranger = await park(trip.id, await createSessionJwt({ sub: stranger.id, role: stranger.role }), {
      itemId: item.id,
      tripDayId: day.id,
    });
    expect(asStranger.status).toBe(404);
    expect(((await asStranger.json()) as ApiEnvelope<null>).error?.code).toBe("not_found");
    expect(await items()).toEqual(before);
  });

  it("answers 403 without a CSRF token, 400 for invalid JSON and an extra field, 404 for the wrong day", async () => {
    const { trip, day, otherDay, item, session } = await seed("malformed");
    const before = await items();

    const noCsrf = await park(trip.id, session, { itemId: item.id, tripDayId: day.id }, "");
    expect(noCsrf.status).toBe(403);
    expect(((await noCsrf.json()) as ApiEnvelope<null>).error?.code).toBe("csrf_invalid");

    const badJson = await park(trip.id, session, "{not json");
    expect(badJson.status).toBe(400);
    expect(((await badJson.json()) as ApiEnvelope<null>).error?.code).toBe("invalid_json");

    const extra = await park(trip.id, session, { itemId: item.id, tripDayId: day.id, fromTime: "09:00" });
    expect(extra.status).toBe(400);
    expect(((await extra.json()) as ApiEnvelope<null>).error?.code).toBe("validation_error");

    // The activity is not on the named day (a stale tab after a move elsewhere).
    const wrongDay = await park(trip.id, session, { itemId: item.id, tripDayId: otherDay.id });
    expect(wrongDay.status).toBe(404);
    expect(((await wrongDay.json()) as ApiEnvelope<null>).error?.code).toBe("not_found");

    expect(await items()).toEqual(before);

    // Parked once, it is no longer on the day: a second park is 404 too.
    expect((await park(trip.id, session, { itemId: item.id, tripDayId: day.id })).status).toBe(200);
    expect((await park(trip.id, session, { itemId: item.id, tripDayId: day.id })).status).toBe(404);
  });
});
