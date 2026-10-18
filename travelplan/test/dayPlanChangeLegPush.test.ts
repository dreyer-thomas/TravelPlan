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
import { compareDayPlanItemsByOrder } from "@/lib/trips/dayPlanItemOrder";
import { routeContext } from "./helpers/routeContext";
import { settleSeededDay } from "./helpers/settleSeededDay";
import { tripIdOfDay } from "./helpers/tripIdOfDay";

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

const createRawItem = async (tripDayId: string, title: string, fromTime: string | null, toTime: string | null) =>
  prisma.dayPlanItem.create({
    data: { tripId: await tripIdOfDay(tripDayId), tripDayId, title, fromTime, toTime, contentJson: sampleDoc(title), createdAt: PAST, updatedAt: PAST },
  });

/** Story 13.1: each seeded day is numbered the way the migration numbers real data. */
const createItem = async (...args: Parameters<typeof createRawItem>) => {
  const row = await createRawItem(...args);
  await settleSeededDay(row.tripDayId!);
  return prisma.dayPlanItem.findUniqueOrThrow({ where: { id: row.id } });
};

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
    .sort(compareDayPlanItemsByOrder)
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
    // 13.1: B and C flexible for an hour each, so the schedule stores them at 10–11 and 11–12.
    await settleSeededDay(day.id, { flexible: [b.id, c.id] });

    const result = await createTravelSegmentForTripDay(legParams(user.id, trip.id, day.id, act(a.id), act(b.id), 60));

    expect(result.status).toBe("created");
    if (result.status !== "created") return;
    expect(await times(day.id)).toEqual(["A 09:00–10:00", "B 11:00–12:00", "C 12:00–13:00", "D 16:00–17:00"]);
    const stored = await prisma.travelSegment.findUniqueOrThrow({ where: { id: result.segment.id } });
    const updatedAt = (await prisma.dayPlanItem.findUniqueOrThrow({ where: { id: b.id } })).updatedAt;
    expect(result.receipt).toEqual({
      version: 3,
      tripDayId: day.id,
      edited: { kind: "legCreated", segmentId: stored.id, updatedAt: stored.updatedAt },
      removedTravelSegments: [],
      // 13.1: C sits tight behind B, so it moves too, which the 11.2 walk's slack had absorbed.
      movedItems: [
        {
          itemId: b.id,
          previousFromTime: "10:00",
          previousToTime: "11:00",
          previousSortOrder: 1,
          fromTime: "11:00",
          toTime: "12:00",
          previousUpdatedAt: PAST,
          updatedAt,
        },
        {
          itemId: c.id,
          previousFromTime: "11:00",
          previousToTime: "12:00",
          previousSortOrder: 2,
          fromTime: "12:00",
          toTime: "13:00",
          previousUpdatedAt: PAST,
          updatedAt,
        },
      ],
    });
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
    // 13.1: flexible B and C; the schedule computes exactly the seeded times from the two legs.
    await settleSeededDay(day.id, { flexible: [b.id, c.id] });

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
    // A→B is re-pointed at B→C. 13.1: with B and C flexible, B pulls back to A's end once A→B's 30 minutes
    // stop counting, and C follows the new 20-minute leg.
    const leg = await createLeg(day.id, item(a.id), item(b.id), 30);
    await settleSeededDay(day.id, { flexible: [b.id, c.id] });
    const result = await updateTravelSegmentForTripDay({
      ...legParams(user.id, trip.id, day.id, act(b.id), act(c.id), 20),
      segmentId: leg.id,
    });

    expect(result.status).toBe("updated");
    expect(await times(day.id)).toEqual(["A 09:00–10:00", "B 10:00–11:00", "C 11:20–12:20"]);
  });

  it("moves nothing for a same-length leg or a mode, distance or link change; a shorter leg pulls forward (13.1 AC4)", async () => {
    const { user, trip, day } = await seedTrip("leg-no-reason@example.com");
    const a = await createItem(day.id, "A", "09:00", "10:00");
    const b = await createItem(day.id, "B", "10:30", "11:30");
    const leg = await createLeg(day.id, item(a.id), item(b.id), 60);
    // 13.1: flexible B behind the 60-minute leg, 11:00–12:00.
    await settleSeededDay(day.id, { flexible: [b.id] });
    const base = legParams(user.id, trip.id, day.id, act(a.id), act(b.id), 60);

    for (const params of [
      { ...base },
      { ...base, transportType: "walking" as const, distanceKm: 3 },
      { ...base, distanceKm: 99 },
      { ...base, linkUrl: "https://maps.example.com/x" },
    ]) {
      const result = await updateTravelSegmentForTripDay({ ...params, segmentId: leg.id });
      expect(result.status).toBe("updated");
      if (result.status !== "updated") return;
      expect(result.receipt.movedItems).toEqual([]);
      expect(result.receipt.edited.kind).toBe("legUpdated");
    }
    expect(await times(day.id)).toEqual(["A 09:00–10:00", "B 11:00–12:00"]);

    // 13.1 AC4: Story 11.4 never pulled forward; a shorter leg now does.
    const shorter = await updateTravelSegmentForTripDay({ ...base, durationMinutes: 45, segmentId: leg.id });
    if (shorter.status !== "updated") throw new Error(`expected an update, got ${shorter.status}`);
    expect(shorter.receipt.movedItems.map((row) => row.itemId)).toEqual([b.id]);
    expect(await times(day.id)).toEqual(["A 09:00–10:00", "B 10:45–11:45"]);
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
  });

  it("moves a formerly untimed activity, which is flexible now, by a leg into it (13.1 §5)", async () => {
    const { user, trip, day } = await seedTrip("leg-untimed@example.com");
    const a = await createItem(day.id, "A", "09:00", "10:00");
    const u = await createItem(day.id, "U", null, null);
    const v = await createItem(day.id, "V", null, null);

    // 13.1: untimed rows are FLEXIBLE/15 and get their times from the schedule, like any flexible row.
    const into = await createTravelSegmentForTripDay(legParams(user.id, trip.id, day.id, act(a.id), act(u.id), 60));
    const between = await createTravelSegmentForTripDay(legParams(user.id, trip.id, day.id, act(u.id), act(v.id), 30));

    expect(into.status === "created" && into.receipt.movedItems.map((row) => row.itemId)).toEqual([u.id, v.id]);
    expect(between.status === "created" && between.receipt.movedItems.map((row) => row.itemId)).toEqual([v.id]);
    expect(await times(day.id)).toEqual(["A 09:00–10:00", "U 11:00–11:15", "V 11:45–12:00"]);
  });

  it("does not warn when the push makes the day reach tonight's explicit check-in too late (Story 13.2)", async () => {
    const { user, trip, day } = await seedTrip("leg-checkin@example.com");
    const a = await createItem(day.id, "A", "09:00", "10:00");
    const b = await createItem(day.id, "B", "13:00", "14:00");
    // 13.1: B flexible, 10:00–11:00 until the four-hour leg moves it to 14:00–15:00.
    await settleSeededDay(day.id, { flexible: [b.id] });
    await prisma.accommodation.create({ data: { tripDayId: day.id, name: "Haast Motel", checkInTime: "14:30" } });

    const result = await createTravelSegmentForTripDay(legParams(user.id, trip.id, day.id, act(a.id), act(b.id), 240));

    expect(result.status).toBe("created");
    if (result.status !== "created") return;
    expect(result.receipt.movedItems.map((row) => row.itemId)).toEqual([b.id]);
    expect(Object.keys(result.receipt)).not.toContain("checkInWarning");
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
    // 13.1: the two walks are flexible; the schedule stores Fantail 10:00–11:00 and Haast 11:30–12:00.
    await settleSeededDay(day.id, { flexible: [fantail.id, haast.id] });

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
    await settleSeededDay(day.id, { flexible: [first.id] });

    const result = await createTravelSegmentForTripDay(
      legParams(user.id, trip.id, day.id, accommodation(stay.id), act(first.id), 180),
    );

    expect(result.status).toBe("created");
    expect(await times(day.id)).toEqual(["F 13:00–14:00"]);
  });

  it("reads a stored check-out it cannot read as the 10:00 default (13.1 rule 1)", async () => {
    const { user, trip, day, stay } = await seedTrip("leg-odd-checkout@example.com", "late morning");
    const first = await createItem(day.id, "F", "10:00", "11:00");
    await settleSeededDay(day.id, { flexible: [first.id] });

    const result = await createTravelSegmentForTripDay(
      legParams(user.id, trip.id, day.id, accommodation(stay.id), act(first.id), 600),
    );

    // 13.1: `resolveDayStartMinute` falls back to 10:00 rather than walking nothing.
    expect(result.status === "created" && result.receipt.movedItems.map((row) => row.itemId)).toEqual([first.id]);
    expect(await times(day.id)).toEqual(["F 20:00–21:00"]);
  });

  it("gives a formerly untimed first activity its times from the check-out and the leg (13.1 §5)", async () => {
    const { user, trip, day, stay } = await seedTrip("leg-first-untimed@example.com");
    const u = await createItem(day.id, "U", null, null);

    const result = await createTravelSegmentForTripDay(legParams(user.id, trip.id, day.id, accommodation(stay.id), act(u.id), 600));

    // 13.1: an untimed row is FLEXIBLE/15, so it is scheduled like any other.
    expect(result.status === "created" && result.receipt.movedItems.map((row) => row.itemId)).toEqual([u.id]);
    expect(await times(day.id)).toEqual(["U 19:00–19:15"]);
  });
});

describe("a leg save past midnight is saved (Story 11.4 AC6, Story 13.2 AC6)", () => {
  beforeEach(resetDatabase);

  it("saves a create and an update; the pushed activity loses its times and keeps its duration", async () => {
    // Story 13.2: past midnight is saved, not refused.
    const { user, trip, day } = await seedTrip("leg-midnight@example.com");
    const a = await createItem(day.id, "A", "09:00", "10:00");
    const b = await createItem(day.id, "Late show", "22:00", "23:30");
    // Only a flexible row can be pushed past midnight; this one lasts 90 minutes.
    await settleSeededDay(day.id, { flexible: [b.id] });

    const created = await createTravelSegmentForTripDay(legParams(user.id, trip.id, day.id, act(a.id), act(b.id), 760));
    if (created.status !== "created") throw new Error(`expected a create, got ${created.status}`);
    expect(created.receipt.movedItems).toEqual([expect.objectContaining({ itemId: b.id, fromTime: null, toTime: null })]);
    expect(await times(day.id)).toEqual(["A 09:00–10:00", "Late show -–-"]);
    expect(await prisma.dayPlanItem.findUniqueOrThrow({ where: { id: b.id } })).toMatchObject({ durationMinutes: 90 });

    // A shorter leg makes room again: the times come back exactly from the duration.
    const shorter = await updateTravelSegmentForTripDay({
      ...legParams(user.id, trip.id, day.id, act(a.id), act(b.id), 30),
      segmentId: created.segment.id,
    });
    if (shorter.status !== "updated") throw new Error(`expected an update, got ${shorter.status}`);
    expect(await times(day.id)).toEqual(["A 09:00–10:00", "Late show 10:30–12:00"]);

    const updated = await updateTravelSegmentForTripDay({
      ...legParams(user.id, trip.id, day.id, act(a.id), act(b.id), 760),
      segmentId: created.segment.id,
    });
    if (updated.status !== "updated") throw new Error(`expected an update, got ${updated.status}`);
    expect(await times(day.id)).toEqual(["A 09:00–10:00", "Late show -–-"]);
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
    // 13.1 AC5: B is fixed, so a three-hour leg does not move it; the receipt names the late arrival.
    expect(updated.body.data!.receipt.movedItems).toEqual([]);
    expect(updated.body.data!.receipt.planConflicts).toEqual([
      { itemId: b.id, title: "B", fromTime: "12:00", reachableAt: "13:00" },
    ]);
    expect(await times(day.id)).toEqual(["A 09:00–10:00", "B 12:00–13:00"]);
  });

  it("answers 200 for a leg that pushes an activity past midnight, which is stored without times", async () => {
    // Story 13.2: past midnight is saved, not refused.
    const { user, trip, day } = await seedTrip("route-leg-midnight@example.com");
    const session = await createSessionJwt({ sub: user.id, role: user.role });
    const a = await createItem(day.id, "A", "09:00", "10:00");
    const b = await createItem(day.id, "Late show", "22:00", "23:30");
    await settleSeededDay(day.id, { flexible: [b.id] });

    const result = await send("POST", trip.id, session, wireLeg(day.id, act(a.id), act(b.id), 760));

    expect(result.status).toBe(200);
    expect(result.body.error).toBeNull();
    expect(await times(day.id)).toEqual(["A 09:00–10:00", "Late show -–-"]);
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
