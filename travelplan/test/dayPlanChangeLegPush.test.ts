import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { PATCH, POST } from "@/app/api/trips/[id]/travel-segments/route";
import { prisma } from "@/lib/db/prisma";
import { createSessionJwt } from "@/lib/auth/jwt";
import {
  createTravelSegmentForTripDay,
  updateTravelSegmentForTripDay,
} from "@/lib/repositories/travelSegmentRepo";
import type { DayChangeReceiptWire } from "@/lib/trips/dayChangeReceipt";
import { verifyDayChangeReceipt } from "@/lib/trips/dayChangeReceiptSignature";
import { compareDayPlanItemsByStartTime } from "@/lib/trips/dayPlanItemOrder";
import { routeContext } from "./helpers/routeContext";

/**
 * Story 11.4 AC1, AC2, AC5, AC6, AC8, AC15. A leg save pushes the day from where the leg starts: the
 * activity it leaves, or last night's check-out. Repository first, then the route's envelope.
 */

const PAST = new Date("2026-01-02T03:04:05.678Z");
const CSRF = "csrf-token-value";

const sampleDoc = (text: string) =>
  JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

const resetDatabase = async () => {
  await prisma.travelSegment.deleteMany();
  await prisma.costPayment.deleteMany();
  await prisma.dayPlanItem.deleteMany();
  await prisma.tripMember.deleteMany();
  await prisma.accommodation.deleteMany();
  await prisma.tripDay.deleteMany();
  await prisma.trip.deleteMany();
  await prisma.user.deleteMany();
};

const createUser = (email: string) => prisma.user.create({ data: { email, passwordHash: "hashed", role: "OWNER" } });

/** Day 1 holds last night's stay (check-out `checkOutTime`); day 2 is the day under test. */
const seedTrip = async (email: string, checkOutTime: string | null = "09:00") => {
  const user = await createUser(email);
  const trip = await prisma.trip.create({
    data: {
      userId: user.id,
      name: "Leg Trip",
      startDate: new Date("2026-11-04T00:00:00.000Z"),
      endDate: new Date("2026-11-05T00:00:00.000Z"),
    },
  });
  const stayDay = await prisma.tripDay.create({
    data: { tripId: trip.id, date: new Date("2026-11-04T00:00:00.000Z"), dayIndex: 4 },
  });
  const day = await prisma.tripDay.create({
    data: { tripId: trip.id, date: new Date("2026-11-05T00:00:00.000Z"), dayIndex: 5 },
  });
  const stay = await prisma.accommodation.create({
    data: { tripDayId: stayDay.id, name: "Glenfern Villas", checkOutTime, createdAt: PAST, updatedAt: PAST },
  });
  return { user, trip, stayDay, day, stay };
};

const createItem = (tripDayId: string, title: string, fromTime: string | null, toTime: string | null) =>
  prisma.dayPlanItem.create({
    data: { tripDayId, title, fromTime, toTime, contentJson: sampleDoc(title), createdAt: PAST, updatedAt: PAST },
  });

const createLeg = (
  tripDayId: string,
  from: { type: "ACCOMMODATION" | "DAY_PLAN_ITEM"; id: string },
  to: { type: "ACCOMMODATION" | "DAY_PLAN_ITEM"; id: string },
  durationMinutes: number,
) =>
  prisma.travelSegment.create({
    data: {
      tripDayId,
      fromItemType: from.type,
      fromItemId: from.id,
      toItemType: to.type,
      toItemId: to.id,
      transportType: "CAR",
      durationMinutes,
      distanceKm: 50,
      linkUrl: null,
      createdAt: PAST,
      updatedAt: PAST,
    },
  });

const item = (id: string) => ({ type: "DAY_PLAN_ITEM" as const, id });
const stayEndpoint = (id: string) => ({ type: "ACCOMMODATION" as const, id });

/** The day in its canonical order, as the timeline draws it. */
const times = async (tripDayId: string) =>
  (await prisma.dayPlanItem.findMany({ where: { tripDayId } }))
    .sort(compareDayPlanItemsByStartTime)
    .map((row) => `${row.title} ${row.fromTime ?? "-"}–${row.toTime ?? "-"}`);

const databaseState = async () => ({
  items: await prisma.dayPlanItem.findMany({ orderBy: { id: "asc" } }),
  legs: await prisma.travelSegment.findMany({ orderBy: { id: "asc" } }),
  stays: await prisma.accommodation.findMany({ orderBy: { id: "asc" } }),
});

const legParams = (
  userId: string,
  tripId: string,
  tripDayId: string,
  from: { type: "accommodation" | "dayPlanItem"; id: string },
  to: { type: "accommodation" | "dayPlanItem"; id: string },
  durationMinutes: number,
  extra: { transportType?: "car" | "ship" | "flight" | "walking" | "cycling"; distanceKm?: number | null; linkUrl?: string | null } = {},
) => ({
  userId,
  tripId,
  tripDayId,
  fromItemType: from.type,
  fromItemId: from.id,
  toItemType: to.type,
  toItemId: to.id,
  transportType: extra.transportType ?? ("car" as const),
  durationMinutes,
  distanceKm: extra.distanceKm === undefined ? 50 : extra.distanceKm,
  linkUrl: extra.linkUrl ?? null,
});

const act = (id: string) => ({ type: "dayPlanItem" as const, id });
const accommodation = (id: string) => ({ type: "accommodation" as const, id });

describe("a leg between two activities pushes the day (Story 11.4 AC1)", () => {
  beforeEach(resetDatabase);

  it("creates a leg that pushes the next activities and returns the receipt", async () => {
    const { user, trip, day } = await seedTrip("leg-create@example.com");
    const a = await createItem(day.id, "A", "09:00", "10:00");
    const b = await createItem(day.id, "B", "10:30", "11:30");
    const c = await createItem(day.id, "C", "12:00", "13:00");
    await createItem(day.id, "D", "16:00", "17:00");

    const result = await createTravelSegmentForTripDay(legParams(user.id, trip.id, day.id, act(a.id), act(b.id), 60));

    expect(result.status).toBe("created");
    if (result.status !== "created") return;
    expect(await times(day.id)).toEqual(["A 09:00–10:00", "B 11:00–12:00", "C 12:00–13:00", "D 16:00–17:00"]);
    const stored = await prisma.travelSegment.findUniqueOrThrow({ where: { id: result.segment.id } });
    expect(result.receipt).toEqual({
      version: 2,
      tripDayId: day.id,
      edited: { kind: "legCreated", segmentId: stored.id, updatedAt: stored.updatedAt },
      removedTravelSegments: [],
      movedItems: [
        {
          itemId: b.id,
          previousFromTime: "10:30",
          previousToTime: "11:30",
          previousUpdatedAt: PAST,
          updatedAt: (await prisma.dayPlanItem.findUniqueOrThrow({ where: { id: b.id } })).updatedAt,
        },
      ],
    });
    void c;
  });

  it("absorbs a leg into slack and still returns a receipt", async () => {
    const { user, trip, day } = await seedTrip("leg-slack@example.com");
    const a = await createItem(day.id, "A", "09:00", "10:00");
    const b = await createItem(day.id, "B", "11:00", "12:00");

    const result = await createTravelSegmentForTripDay(legParams(user.id, trip.id, day.id, act(a.id), act(b.id), 45));

    expect(result.status).toBe("created");
    if (result.status !== "created") return;
    expect(result.receipt.movedItems).toEqual([]);
    expect(result.receipt.edited.kind).toBe("legCreated");
    expect(await times(day.id)).toEqual(["A 09:00–10:00", "B 11:00–12:00"]);
  });

  it("updates a leg to a longer one and carries the whole previous row", async () => {
    const { user, trip, day } = await seedTrip("leg-update@example.com");
    const a = await createItem(day.id, "A", "09:00", "10:00");
    const b = await createItem(day.id, "B", "10:30", "11:30");
    const c = await createItem(day.id, "C", "11:45", "12:45");
    const leg = await createLeg(day.id, item(a.id), item(b.id), 30);
    await createLeg(day.id, item(b.id), item(c.id), 15);

    const result = await updateTravelSegmentForTripDay({
      ...legParams(user.id, trip.id, day.id, act(a.id), act(b.id), 90),
      segmentId: leg.id,
    });

    expect(result.status).toBe("updated");
    if (result.status !== "updated") return;
    expect(await times(day.id)).toEqual(["A 09:00–10:00", "B 11:30–12:30", "C 12:45–13:45"]);
    expect(result.receipt.edited).toEqual({
      kind: "legUpdated",
      segmentId: leg.id,
      updatedAt: (await prisma.travelSegment.findUniqueOrThrow({ where: { id: leg.id } })).updatedAt,
      previous: leg,
    });
    expect(result.receipt.movedItems.map((row) => row.itemId)).toEqual([b.id, c.id]);
    expect(result.receipt.removedTravelSegments).toEqual([]);
  });

  it("pushes from the new start when the leg's endpoints change", async () => {
    const { user, trip, day } = await seedTrip("leg-endpoints@example.com");
    const a = await createItem(day.id, "A", "09:00", "10:00");
    const b = await createItem(day.id, "B", "10:00", "11:00");
    const c = await createItem(day.id, "C", "11:00", "12:00");
    // A→B is re-pointed at B→C: the walk starts at B, the leg's new start. (A→B's 30 min is not
    // honoured on this day, and no longer counts once the row is retargeted.)
    const leg = await createLeg(day.id, item(a.id), item(b.id), 30);
    const result = await updateTravelSegmentForTripDay({
      ...legParams(user.id, trip.id, day.id, act(b.id), act(c.id), 20),
      segmentId: leg.id,
    });

    expect(result.status).toBe("updated");
    expect(await times(day.id)).toEqual(["A 09:00–10:00", "B 10:00–11:00", "C 11:20–12:20"]);
  });

  it("moves nothing for a shorter leg, a same-length leg, or a mode, distance or link change", async () => {
    const { user, trip, day } = await seedTrip("leg-no-reason@example.com");
    const a = await createItem(day.id, "A", "09:00", "10:00");
    const b = await createItem(day.id, "B", "10:30", "11:30");
    // Already inconsistent: the stored 60 min leg does not fit. Running the walk would move B.
    const leg = await createLeg(day.id, item(a.id), item(b.id), 60);
    const base = legParams(user.id, trip.id, day.id, act(a.id), act(b.id), 60);

    // Sequential saves of one row, so the shorter one comes last: after it, 60 would be a longer leg.
    for (const params of [
      { ...base },
      { ...base, transportType: "walking" as const, distanceKm: 3 },
      { ...base, distanceKm: 99 },
      { ...base, linkUrl: "https://maps.example.com/x" },
      { ...base, durationMinutes: 45 },
    ]) {
      const result = await updateTravelSegmentForTripDay({ ...params, segmentId: leg.id });
      expect(result.status).toBe("updated");
      if (result.status !== "updated") return;
      expect(result.receipt.movedItems).toEqual([]);
      expect(result.receipt.edited.kind).toBe("legUpdated");
    }
    expect(await times(day.id)).toEqual(["A 09:00–10:00", "B 10:30–11:30"]);
  });

  it("moves nothing for a leg that arrives at tonight's stay", async () => {
    const { user, trip, day } = await seedTrip("leg-to-stay@example.com");
    const a = await createItem(day.id, "A", "09:00", "10:00");
    const tonight = await prisma.accommodation.create({ data: { tripDayId: day.id, name: "Haast Motel", checkInTime: "12:00" } });

    const result = await createTravelSegmentForTripDay(
      legParams(user.id, trip.id, day.id, act(a.id), accommodation(tonight.id), 600),
    );

    expect(result.status).toBe("created");
    if (result.status !== "created") return;
    expect(result.receipt.movedItems).toEqual([]);
    expect(result.receipt.checkInWarning).toBeUndefined();
  });

  it("moves nothing for a leg that leaves or arrives at an untimed activity", async () => {
    const { user, trip, day } = await seedTrip("leg-untimed@example.com");
    const a = await createItem(day.id, "A", "09:00", "10:00");
    const u = await createItem(day.id, "U", null, null);
    const v = await createItem(day.id, "V", null, null);

    const into = await createTravelSegmentForTripDay(legParams(user.id, trip.id, day.id, act(a.id), act(u.id), 600));
    const between = await createTravelSegmentForTripDay(legParams(user.id, trip.id, day.id, act(u.id), act(v.id), 600));

    expect(into.status === "created" && into.receipt.movedItems).toEqual([]);
    expect(between.status === "created" && between.receipt.movedItems).toEqual([]);
    expect((await times(day.id)).sort()).toEqual(["A 09:00–10:00", "U -–-", "V -–-"]);
  });

  it("warns when the push makes the day reach tonight's explicit check-in too late", async () => {
    const { user, trip, day } = await seedTrip("leg-checkin@example.com");
    const a = await createItem(day.id, "A", "09:00", "10:00");
    const b = await createItem(day.id, "B", "13:00", "14:00");
    const tonight = await prisma.accommodation.create({ data: { tripDayId: day.id, name: "Haast Motel", checkInTime: "14:30" } });

    const result = await createTravelSegmentForTripDay(legParams(user.id, trip.id, day.id, act(a.id), act(b.id), 240));

    expect(result.status).toBe("created");
    if (result.status !== "created") return;
    expect(result.receipt.movedItems.map((row) => row.itemId)).toEqual([b.id]);
    expect(result.receipt.checkInWarning).toEqual({ accommodationId: tonight.id, checkInTime: "14:30" });
  });
});

describe("a leg from last night's stay pushes from the check-out (Story 11.4 AC2)", () => {
  beforeEach(resetDatabase);

  it("runs Tommy's case: 09:00 check-out, 3 h 15 min drive, the walk continues", async () => {
    const { user, trip, day, stay } = await seedTrip("leg-tommy@example.com", "09:00");
    const fantail = await createItem(day.id, "Fantail Falls", "12:10", "13:10");
    const haast = await createItem(day.id, "Haast walk", "13:30", "14:00");
    await createItem(day.id, "Dinner", "18:00", "19:00");
    const stayLeg = await createLeg(day.id, stayEndpoint(stay.id), item(fantail.id), 60);
    await createLeg(day.id, item(fantail.id), item(haast.id), 30);

    const result = await updateTravelSegmentForTripDay({
      ...legParams(user.id, trip.id, day.id, accommodation(stay.id), act(fantail.id), 195),
      segmentId: stayLeg.id,
    });

    expect(result.status).toBe("updated");
    if (result.status !== "updated") return;
    expect(await times(day.id)).toEqual(["Fantail Falls 12:15–13:15", "Haast walk 13:45–14:15", "Dinner 18:00–19:00"]);
    expect(result.receipt.movedItems.map((row) => row.itemId)).toEqual([fantail.id, haast.id]);
  });

  it("uses the shared default check-out when none is stored", async () => {
    const { user, trip, day, stay } = await seedTrip("leg-default@example.com", null);
    const first = await createItem(day.id, "F", "12:00", "13:00");

    const result = await createTravelSegmentForTripDay(
      legParams(user.id, trip.id, day.id, accommodation(stay.id), act(first.id), 180),
    );

    expect(result.status).toBe("created");
    expect(await times(day.id)).toEqual(["F 13:00–14:00"]);
  });

  it("walks nothing from a stored check-out it cannot read", async () => {
    const { user, trip, day, stay } = await seedTrip("leg-odd-checkout@example.com", "late morning");
    const first = await createItem(day.id, "F", "10:00", "11:00");

    const result = await createTravelSegmentForTripDay(
      legParams(user.id, trip.id, day.id, accommodation(stay.id), act(first.id), 600),
    );

    expect(result.status === "created" && result.receipt.movedItems).toEqual([]);
  });

  it("moves nothing when the day's first activity is untimed", async () => {
    const { user, trip, day, stay } = await seedTrip("leg-first-untimed@example.com");
    const u = await createItem(day.id, "U", null, null);

    const result = await createTravelSegmentForTripDay(legParams(user.id, trip.id, day.id, accommodation(stay.id), act(u.id), 600));

    expect(result.status === "created" && result.receipt.movedItems).toEqual([]);
  });
});

describe("a leg save past midnight writes nothing (Story 11.4 AC6)", () => {
  beforeEach(resetDatabase);

  it("refuses a create and an update, naming the activity, with the whole database unchanged", async () => {
    const { user, trip, day } = await seedTrip("leg-midnight@example.com");
    const a = await createItem(day.id, "A", "09:00", "10:00");
    const b = await createItem(day.id, "Late show", "22:00", "23:30");
    const before = await databaseState();

    const created = await createTravelSegmentForTripDay(legParams(user.id, trip.id, day.id, act(a.id), act(b.id), 760));
    expect(created).toEqual({ status: "past_midnight", item: { id: b.id, title: "Late show" } });
    expect(await databaseState()).toEqual(before);

    const leg = await createLeg(day.id, item(a.id), item(b.id), 30);
    const withLeg = await databaseState();
    const updated = await updateTravelSegmentForTripDay({
      ...legParams(user.id, trip.id, day.id, act(a.id), act(b.id), 760),
      segmentId: leg.id,
    });
    expect(updated).toEqual({ status: "past_midnight", item: { id: b.id, title: "Late show" } });
    expect(await databaseState()).toEqual(withLeg);
  });
});

// ---------------------------------------------------------------------------------------------------
// The route.

const buildRequest = (url: string, method: "POST" | "PATCH", options: { session: string; body: unknown }) =>
  new NextRequest(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      cookie: `session=${options.session}; csrf_token=${CSRF}`,
      "x-csrf-token": CSRF,
    },
    body: JSON.stringify(options.body),
  });

type Envelope = {
  data: { segment: { id: string }; receipt: DayChangeReceiptWire & { signature: string } } | null;
  error: { code: string; details?: Record<string, unknown> } | null;
};

const send = async (method: "POST" | "PATCH", tripId: string, session: string, body: unknown) => {
  const handler = method === "POST" ? POST : PATCH;
  const response = await handler(
    buildRequest(`http://localhost/api/trips/${tripId}/travel-segments`, method, { session, body }),
    routeContext(tripId),
  );
  return { status: response.status, body: (await response.json()) as Envelope };
};

const wireLeg = (tripDayId: string, from: { type: string; id: string }, to: { type: string; id: string }, durationMinutes: number) => ({
  tripDayId,
  fromItemType: from.type,
  fromItemId: from.id,
  toItemType: to.type,
  toItemId: to.id,
  transportType: "car",
  durationMinutes,
  distanceKm: 50,
});

describe("POST and PATCH /api/trips/[id]/travel-segments push and answer with a receipt (Story 11.4)", () => {
  beforeEach(resetDatabase);

  it("always answers with a signed receipt beside the segment, even when nothing moved", async () => {
    const { user, trip, day } = await seedTrip("route-leg-receipt@example.com");
    const session = await createSessionJwt({ sub: user.id, role: user.role });
    const a = await createItem(day.id, "A", "09:00", "10:00");
    const b = await createItem(day.id, "B", "12:00", "13:00");

    const created = await send("POST", trip.id, session, wireLeg(day.id, act(a.id), act(b.id), 30));
    expect(created.status).toBe(200);
    const receipt = created.body.data!.receipt;
    expect(receipt.edited).toMatchObject({ kind: "legCreated", segmentId: created.body.data!.segment.id });
    expect(receipt.movedItems).toEqual([]);
    expect(verifyDayChangeReceipt(receipt, { tripId: trip.id, userId: user.id })).not.toBeNull();

    const updated = await send("PATCH", trip.id, session, {
      ...wireLeg(day.id, act(a.id), act(b.id), 180),
      segmentId: created.body.data!.segment.id,
    });
    expect(updated.status).toBe(200);
    expect(updated.body.data!.receipt.edited.kind).toBe("legUpdated");
    expect(updated.body.data!.receipt.movedItems.map((row) => row.itemId)).toEqual([b.id]);
    expect(await times(day.id)).toEqual(["A 09:00–10:00", "B 13:00–14:00"]);
  });

  it("answers 409 day_plan_past_midnight with the activity in details, and writes nothing", async () => {
    const { user, trip, day } = await seedTrip("route-leg-midnight@example.com");
    const session = await createSessionJwt({ sub: user.id, role: user.role });
    const a = await createItem(day.id, "A", "09:00", "10:00");
    const b = await createItem(day.id, "Late show", "22:00", "23:30");
    const before = await databaseState();

    const result = await send("POST", trip.id, session, wireLeg(day.id, act(a.id), act(b.id), 760));

    expect(result.status).toBe(409);
    expect(result.body.error).toMatchObject({
      code: "day_plan_past_midnight",
      details: { itemId: b.id, itemTitle: "Late show" },
    });
    expect(await databaseState()).toEqual(before);
  });

  it("still answers not_adjacent with 400 and an existing pair with 409 travel_segment_exists", async () => {
    const { user, trip, day } = await seedTrip("route-leg-unchanged@example.com");
    const session = await createSessionJwt({ sub: user.id, role: user.role });
    const a = await createItem(day.id, "A", "09:00", "10:00");
    const b = await createItem(day.id, "B", "12:00", "13:00");
    const c = await createItem(day.id, "C", "15:00", "16:00");

    const notAdjacent = await send("POST", trip.id, session, wireLeg(day.id, act(a.id), act(c.id), 30));
    expect(notAdjacent.status).toBe(400);
    expect(notAdjacent.body.error?.code).toBe("validation_error");

    await createLeg(day.id, item(a.id), item(b.id), 30);
    const exists = await send("POST", trip.id, session, wireLeg(day.id, act(a.id), act(b.id), 30));
    expect(exists.status).toBe(409);
    expect(exists.body.error?.code).toBe("travel_segment_exists");
    expect(await prisma.travelSegment.count()).toBe(1);
  });

  it("refuses a viewer with 404 and writes nothing", async () => {
    const { user, trip, day } = await seedTrip("route-leg-viewer-owner@example.com");
    const viewer = await createUser("route-leg-viewer@example.com");
    await prisma.tripMember.create({ data: { tripId: trip.id, userId: viewer.id, role: "VIEWER" } });
    const a = await createItem(day.id, "A", "09:00", "10:00");
    const b = await createItem(day.id, "B", "10:00", "11:00");
    void user;
    const before = await databaseState();

    const result = await send(
      "POST",
      trip.id,
      await createSessionJwt({ sub: viewer.id, role: viewer.role }),
      wireLeg(day.id, act(a.id), act(b.id), 120),
    );

    expect(result.status).toBe(404);
    expect(await databaseState()).toEqual(before);
  });
});
