import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/trips/[id]/day-plan-items/reorder/route";
import { prisma } from "@/lib/db/prisma";
import { createSessionJwt } from "@/lib/auth/jwt";
import { reorderDayPlanItemForTripDay } from "@/lib/repositories/dayPlanItemRepo";
import { undoDayPlanChangeForTrip } from "@/lib/repositories/dayPlanChangeRepo";
import { routeContext } from "./helpers/routeContext";
import { settleSeededDay } from "./helpers/settleSeededDay";
import { tripIdOfDay } from "./helpers/tripIdOfDay";

/**
 * Story 11.3. *Nach oben* / *Nach unten* wired through the repository and the route: what is written,
 * what the receipt says, which legs go (and which survive), and that every refusal writes nothing. Story
 * 13.1 §10: only a FLEXIBLE activity moves, the pair trades `sortOrder` and the day is recomputed, so the
 * days here are flexible chains; the arithmetic is pinned in `daySchedule.test.ts`.
 */

const sampleDoc = (text: string) =>
  JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

/** Fixture rows are stamped in the past so a later write can never share their millisecond. */
const PAST = new Date("2026-01-02T03:04:05.678Z");

const createUser = (email: string) => prisma.user.create({ data: { email, passwordHash: "hashed", role: "OWNER" } });

/** Two days, so a stay on the first is "last night's" for the second. */
const createTrip = async (userId: string) => {
  const trip = await prisma.trip.create({
    data: {
      userId,
      name: "Reorder Trip",
      startDate: new Date("2026-11-04T00:00:00.000Z"),
      endDate: new Date("2026-11-05T00:00:00.000Z"),
    },
  });
  const firstDay = await prisma.tripDay.create({
    data: { tripId: trip.id, date: new Date("2026-11-04T00:00:00.000Z"), dayIndex: 1 },
  });
  const day = await prisma.tripDay.create({
    data: { tripId: trip.id, date: new Date("2026-11-05T00:00:00.000Z"), dayIndex: 2 },
  });
  return { trip, firstDay, day };
};

let created = 0;
/** Distinct, increasing `createdAt`s, so equal starts always sort in creation order. */
const createRawItem = async (tripDayId: string, title: string | null, fromTime: string | null, toTime: string | null) => {
  created += 1;
  const stamp = new Date(PAST.getTime() + created * 1000);
  return prisma.dayPlanItem.create({
    data: { tripId: await tripIdOfDay(tripDayId), tripDayId, title, fromTime, toTime, contentJson: sampleDoc(title ?? ""), createdAt: stamp, updatedAt: PAST },
  });
};

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
  durationMinutes = 15,
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
      createdAt: PAST,
      updatedAt: PAST,
    },
  });

const item = (id: string) => ({ type: "DAY_PLAN_ITEM" as const, id });
const stay = (id: string) => ({ type: "ACCOMMODATION" as const, id });

/**
 * Success criterion 4's day, flexible since Story 13.1: A for an hour, B for 30 minutes, C for an hour,
 * from the 09:00 start of a day without a stay last night: A 09–10, B 10–10:30, C 10:30–11:30.
 * `beforeSettle` seeds the stay and legs the schedule should count.
 */
const seedDay = async (
  email: string,
  beforeSettle?: (rows: { firstDayId: string; dayId: string; a: { id: string }; b: { id: string }; c: { id: string } }) => Promise<unknown>,
) => {
  const user = await createUser(email);
  const { trip, firstDay, day } = await createTrip(user.id);
  const a = await createItem(day.id, "A", "09:00", "10:00");
  const b = await createItem(day.id, "B", "10:30", "11:00");
  const c = await createItem(day.id, "C", "11:30", "12:30");
  await beforeSettle?.({ firstDayId: firstDay.id, dayId: day.id, a, b, c });
  await settleSeededDay(day.id, { flexible: [a.id, b.id, c.id] });
  return { user, trip, firstDay, day, a, b, c };
};

/** Every row a day-plan write could touch, in a stable order. */
const databaseState = async () => ({
  items: await prisma.dayPlanItem.findMany({ orderBy: { id: "asc" } }),
  payments: await prisma.costPayment.findMany({ orderBy: { id: "asc" } }),
  legs: await prisma.travelSegment.findMany({ orderBy: { id: "asc" } }),
});

const times = async (tripDayId: string) =>
  Object.fromEntries(
    (await prisma.dayPlanItem.findMany({ where: { tripDayId } })).map((row) => [row.title, `${row.fromTime}–${row.toTime}`]),
  );

const resetDatabase = async () => {
  await prisma.travelSegment.deleteMany();
  await prisma.dayPlanItemDocument.deleteMany();
  await prisma.dayPlanItemImage.deleteMany();
  await prisma.costPayment.deleteMany();
  await prisma.dayPlanItem.deleteMany();
  await prisma.tripMember.deleteMany();
  await prisma.accommodation.deleteMany();
  await prisma.tripDay.deleteMany();
  await prisma.trip.deleteMany();
  await prisma.user.deleteMany();
};

type ApiEnvelope<T> = { data: T | null; error: { code: string; message: string; details?: unknown } | null };

const CSRF = "csrf-token-value";

const send = async (tripId: string, session: string, body: unknown, csrf = CSRF) => {
  const request = new NextRequest(`http://localhost/api/trips/${tripId}/day-plan-items/reorder`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie: `session=${session}; csrf_token=${CSRF}`,
      "x-csrf-token": csrf,
    },
    body: JSON.stringify(body),
  });
  const response = await POST(request, routeContext(tripId));
  return { status: response.status, body: (await response.json()) as ApiEnvelope<unknown> };
};

type WireReceipt = {
  version: number;
  signature: string;
  edited: { kind: string; itemId: string; neighbourId: string };
  movedItems: {
    itemId: string;
    previousFromTime: string;
    previousToTime: string;
    fromTime: string | null;
    toTime: string | null;
    previousUpdatedAt: string;
    updatedAt: string;
  }[];
  removedTravelSegments: { id: string }[];
};

describe("POST /api/trips/[id]/day-plan-items/reorder (Story 11.3)", () => {
  beforeEach(resetDatabase);

  it("moves B up: writes both times, answers a signed receipt naming the pair first, and the DB matches", async () => {
    const { user, trip, day, a, b } = await seedDay("reorder-up@example.com");
    const session = await createSessionJwt({ sub: user.id, role: user.role });

    const response = await send(trip.id, session, { tripDayId: day.id, itemId: b.id, direction: "up" });

    expect(response.status).toBe(200);
    // 13.1: B takes the 09:00 start, A follows it, and C (tight behind A either way) keeps its times.
    expect(await times(day.id)).toEqual({ A: "09:30–10:30", B: "09:00–09:30", C: "10:30–11:30" });
    const receipt = (response.body.data as { receipt: WireReceipt }).receipt;
    expect(receipt.version).toBe(3);
    expect(receipt.signature).toMatch(/^[0-9a-f]{64}$/);
    expect(receipt.edited).toEqual({ kind: "reordered", itemId: b.id, neighbourId: a.id, previousAiChangedAt: null });
    expect(receipt.movedItems.map((row) => row.itemId)).toEqual([b.id, a.id]);
    // 13.1: B's previous times are the schedule's, 10:00–10:30.
    expect(receipt.movedItems[0]).toMatchObject({ previousFromTime: "10:00", previousToTime: "10:30", previousUpdatedAt: PAST.toISOString() });
    expect(receipt.removedTravelSegments).toEqual([]);

    const stored = await prisma.dayPlanItem.findMany({ where: { id: { in: [a.id, b.id] } } });
    for (const row of stored) {
      expect(row.updatedAt.toISOString()).toBe(receipt.movedItems.find((moved) => moved.itemId === row.id)!.updatedAt);
    }
  });

  it("moving A down is the same swap: same times, same pair, the user's item named as itemId", async () => {
    const { user, trip, day, a, b } = await seedDay("reorder-down@example.com");

    const result = await reorderDayPlanItemForTripDay({ origin: "user", userId: user.id, tripId: trip.id, tripDayId: day.id, itemId: a.id, direction: "down" });

    expect(result.status).toBe("reordered");
    if (result.status !== "reordered") return;
    expect(await times(day.id)).toEqual({ A: "09:30–10:30", B: "09:00–09:30", C: "10:30–11:30" });
    expect(result.receipt.edited).toEqual({ kind: "reordered", itemId: a.id, neighbourId: b.id, previousAiChangedAt: null });
    expect(result.receipt.movedItems.map((row) => row.itemId)).toEqual([b.id, a.id]);
  });

  it("sweeps stay→A, A→B and B→C, and creates nothing (AC3)", async () => {
    const legs: { id: string }[] = [];
    const { user, trip, day, b } = await seedDay("reorder-legs@example.com", async ({ firstDayId, dayId, a, b, c }) => {
      const lastNight = await prisma.accommodation.create({ data: { tripDayId: firstDayId, name: "Last night", status: "BOOKED" } });
      legs.push(await createLeg(dayId, stay(lastNight.id), item(a.id)));
      legs.push(await createLeg(dayId, item(a.id), item(b.id)));
      legs.push(await createLeg(dayId, item(b.id), item(c.id)));
    });
    const [fromStay, ab, bc] = legs;

    const result = await reorderDayPlanItemForTripDay({ origin: "user", userId: user.id, tripId: trip.id, tripDayId: day.id, itemId: b.id, direction: "up" });

    expect(result.status).toBe("reordered");
    if (result.status !== "reordered") return;
    expect(result.receipt.removedTravelSegments.map((leg) => leg.id).sort()).toEqual([fromStay.id, ab.id, bc.id].sort());
    expect(await prisma.travelSegment.count()).toBe(0);
  });

  it("keeps a pre-existing undrawn B→A leg and counts it (Read this first §5)", async () => {
    const user = await createUser("reorder-reverse-leg@example.com");
    const { trip, day } = await createTrip(user.id);
    const a = await createItem(day.id, "A", "09:00", "10:00");
    const b = await createItem(day.id, "B", "10:00", "11:00");
    const ba = await createLeg(day.id, item(b.id), item(a.id), 20);
    await settleSeededDay(day.id, { flexible: [a.id, b.id] });

    const result = await reorderDayPlanItemForTripDay({ origin: "user", userId: user.id, tripId: trip.id, tripDayId: day.id, itemId: b.id, direction: "up" });

    expect(result.status).toBe("reordered");
    if (result.status !== "reordered") return;
    expect(await times(day.id)).toEqual({ A: "10:20–11:20", B: "09:00–10:00" });
    expect(result.receipt.removedTravelSegments).toEqual([]);
    expect(await prisma.travelSegment.findMany()).toEqual([ba]);
    // Kept for the record: `ba` was seeded before the settle, which keeps every stamp as seeded.
  });

  it("moves what follows the pair and lists it after the pair", async () => {
    const user = await createUser("reorder-push@example.com");
    const { trip, day } = await createTrip(user.id);
    const a = await createItem(day.id, "A", "09:00", "11:00");
    const b = await createItem(day.id, "B", "10:00", "10:30");
    const c = await createItem(day.id, "C", "11:00", "12:00");
    // 13.1: flexible A 09–11, B 11–11:30, and C 11:40–12:40 behind the 10-minute B→C leg.
    await createLeg(day.id, item(b.id), item(c.id), 10);
    await settleSeededDay(day.id, { flexible: [a.id, b.id, c.id] });

    const result = await reorderDayPlanItemForTripDay({ origin: "user", userId: user.id, tripId: trip.id, tripDayId: day.id, itemId: b.id, direction: "up" });

    if (result.status !== "reordered") throw new Error(`expected reordered, got ${result.status}`);
    // B→C is no longer drawn (swept), so C now sits tight behind A.
    expect(await times(day.id)).toEqual({ A: "09:30–11:30", B: "09:00–09:30", C: "11:30–12:30" });
    expect(result.receipt.movedItems.map((row) => row.itemId)).toEqual([b.id, a.id, c.id]);
    expect(result.receipt.removedTravelSegments).toHaveLength(1);
  });

  it("past midnight: 200, the pushed activity stored without times and listed in the receipt", async () => {
    // Story 13.2: past midnight is saved, not refused.
    const user = await createUser("reorder-midnight@example.com");
    const { trip, day } = await createTrip(user.id);
    // 13.1: a fixed show until 22:00, then flexible A (90 min, to 23:30) and B (15 min, to 23:45). Up,
    // B starts at 22:00 and A follows the 20-minute B→A leg to 22:35–00:05: past midnight.
    await createItem(day.id, "Show", "21:00", "22:00");
    const a = await createItem(day.id, "A", "21:00", "22:30");
    const b = await createItem(day.id, "B", "22:00", "22:15");
    await createLeg(day.id, item(b.id), item(a.id), 20);
    await settleSeededDay(day.id, { flexible: [a.id, b.id] });
    const session = await createSessionJwt({ sub: user.id, role: user.role });

    const response = await send(trip.id, session, { tripDayId: day.id, itemId: b.id, direction: "up" });

    expect(response.status).toBe(200);
    expect(await times(day.id)).toEqual({ Show: "21:00–22:00", A: "null–null", B: "22:00–22:15" });
    expect(await prisma.dayPlanItem.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ durationMinutes: 90 });
    const receipt = (response.body.data as { receipt: WireReceipt }).receipt;
    expect(receipt.movedItems.find((row) => row.itemId === a.id)).toMatchObject({
      previousFromTime: "22:00",
      previousToTime: "23:30",
      fromTime: null,
      toTime: null,
    });
  });

  it("not reorderable: the first activity up, the last down, a fixed one either way → 409, DB unchanged", async () => {
    const { user, trip, day, a } = await seedDay("reorder-refused@example.com");
    // 13.1 §10: an untimed row is flexible now and may move; a FIXED one may not.
    const fixed = await createItem(day.id, "F", "18:00", "19:00");
    const untimed = await createItem(day.id, "U", null, null);
    const session = await createSessionJwt({ sub: user.id, role: user.role });
    const before = await databaseState();

    for (const body of [
      { tripDayId: day.id, itemId: a.id, direction: "up" },
      { tripDayId: day.id, itemId: untimed.id, direction: "down" },
      { tripDayId: day.id, itemId: fixed.id, direction: "up" },
      { tripDayId: day.id, itemId: fixed.id, direction: "down" },
    ]) {
      const response = await send(trip.id, session, body);
      expect(response.status).toBe(409);
      expect(response.body.error?.code).toBe("day_plan_not_reorderable");
    }
    expect(await databaseState()).toEqual(before);
  });

  it("a missing item is 404; a viewer is 404; a bad CSRF token is 403; a bad direction is 400", async () => {
    const { user, trip, day, b } = await seedDay("reorder-guards@example.com");
    const viewer = await createUser("reorder-viewer@example.com");
    await prisma.tripMember.create({ data: { tripId: trip.id, userId: viewer.id, role: "VIEWER" } });
    const session = await createSessionJwt({ sub: user.id, role: user.role });
    const viewerSession = await createSessionJwt({ sub: viewer.id, role: viewer.role });
    const before = await databaseState();

    const missing = await send(trip.id, session, { tripDayId: day.id, itemId: "nope", direction: "up" });
    expect(missing.status).toBe(404);
    expect(missing.body.error?.message).toBe("Day plan item not found");

    const asViewer = await send(trip.id, viewerSession, { tripDayId: day.id, itemId: b.id, direction: "up" });
    expect(asViewer.status).toBe(404);

    const forged = await send(trip.id, session, { tripDayId: day.id, itemId: b.id, direction: "up" }, "wrong");
    expect(forged.status).toBe(403);
    expect(forged.body.error?.code).toBe("csrf_invalid");

    const sideways = await send(trip.id, session, { tripDayId: day.id, itemId: b.id, direction: "left" });
    expect(sideways.status).toBe(400);
    expect(sideways.body.error?.code).toBe("validation_error");

    expect(await databaseState()).toEqual(before);
  });

  it("a user reorder on a day whose rows share a sortOrder (legacy data) still succeeds (Story 15.4)", async () => {
    const { user, trip, day, b, c } = await seedDay("reorder-duplicate-order@example.com");
    // B and C share sortOrder 1 and C already carries the times it gets at position 2 (10:00–11:00), so
    // moving C up changes neither its order nor its times: the recompute does not restamp it.
    await prisma.dayPlanItem.update({ where: { id: b.id }, data: { durationMinutes: 60, fromTime: "10:00", toTime: "11:00" } });
    await prisma.dayPlanItem.update({ where: { id: c.id }, data: { sortOrder: 1, fromTime: "10:00", toTime: "11:00" } });
    const session = await createSessionJwt({ sub: user.id, role: user.role });

    const response = await send(trip.id, session, { tripDayId: day.id, itemId: c.id, direction: "up" });
    expect(response.status).toBe(200);
    expect((await prisma.dayPlanItem.findUniqueOrThrow({ where: { id: c.id } })).aiChangedAt).toBeNull();
  });

  it("a contributor may reorder", async () => {
    const { trip, day, b } = await seedDay("reorder-owner@example.com");
    const contributor = await createUser("reorder-contributor@example.com");
    await prisma.tripMember.create({ data: { tripId: trip.id, userId: contributor.id, role: "CONTRIBUTOR" } });
    const session = await createSessionJwt({ sub: contributor.id, role: contributor.role });

    const response = await send(trip.id, session, { tripDayId: day.id, itemId: b.id, direction: "up" });
    expect(response.status).toBe(200);
  });

  describe("past a fixed booking (Story 13.3 AC1)", () => {
    /** Flexible A 09–10, a fixed 12:00 ferry, flexible B behind it 13–14, on a day starting at 09:00. */
    const seedFerryDay = async (email: string) => {
      const user = await createUser(email);
      const { trip, day } = await createTrip(user.id);
      const a = await createRawItem(day.id, "A", "09:00", "10:00");
      const ferry = await createRawItem(day.id, "Ferry", "12:00", "13:00");
      const b = await createRawItem(day.id, "B", "13:00", "14:00");
      await settleSeededDay(day.id, { flexible: [a.id, b.id] });
      return { user, trip, day, a, ferry, b };
    };

    it("moves B up past the ferry: the ferry keeps its times, B runs before it, undo restores the day", async () => {
      const { user, trip, day, a, ferry, b } = await seedFerryDay("reorder-past-fixed-up@example.com");
      const before = await databaseState();

      const result = await reorderDayPlanItemForTripDay({ origin: "user", userId: user.id, tripId: trip.id, tripDayId: day.id, itemId: b.id, direction: "up" });

      if (result.status !== "reordered") throw new Error(`expected reordered, got ${result.status}`);
      expect(await times(day.id)).toEqual({ A: "09:00–10:00", B: "10:00–11:00", Ferry: "12:00–13:00" });
      const order = await prisma.dayPlanItem.findMany({ where: { tripDayId: day.id }, orderBy: { sortOrder: "asc" } });
      expect(order.map((row) => row.id)).toEqual([a.id, b.id, ferry.id]);
      expect(order[2]).toMatchObject({ scheduleMode: "FIXED", fromTime: "12:00", toTime: "13:00" });
      expect(result.receipt.edited).toEqual({ kind: "reordered", itemId: b.id, neighbourId: ferry.id, previousAiChangedAt: null });
      expect(result.receipt.planConflicts).toBeUndefined();

      expect(await undoDayPlanChangeForTrip({ userId: user.id, tripId: trip.id, receipt: result.receipt })).toEqual({ status: "undone" });
      expect(await databaseState()).toEqual(before);
    });

    it("moves A down past the ferry: the ferry keeps its times and A follows it, undo restores the day", async () => {
      const { user, trip, day, a, ferry, b } = await seedFerryDay("reorder-past-fixed-down@example.com");
      const before = await databaseState();

      const result = await reorderDayPlanItemForTripDay({ origin: "user", userId: user.id, tripId: trip.id, tripDayId: day.id, itemId: a.id, direction: "down" });

      if (result.status !== "reordered") throw new Error(`expected reordered, got ${result.status}`);
      expect(await times(day.id)).toEqual({ A: "13:00–14:00", B: "14:00–15:00", Ferry: "12:00–13:00" });
      const order = await prisma.dayPlanItem.findMany({ where: { tripDayId: day.id }, orderBy: { sortOrder: "asc" } });
      expect(order.map((row) => row.id)).toEqual([ferry.id, a.id, b.id]);
      expect(result.receipt.edited).toEqual({ kind: "reordered", itemId: a.id, neighbourId: ferry.id, previousAiChangedAt: null });

      expect(await undoDayPlanChangeForTrip({ userId: user.id, tripId: trip.id, receipt: result.receipt })).toEqual({ status: "undone" });
      expect(await databaseState()).toEqual(before);
    });

    it("a swap that makes the ferry late is saved and carries the conflict in the receipt (13.2)", async () => {
      const user = await createUser("reorder-past-fixed-late@example.com");
      const { trip, day } = await createTrip(user.id);
      // Flexible X 09–11, the 12:00 ferry, flexible B (3 h) behind it. B up: X 09–11, B 11–14, ferry late.
      const x = await createRawItem(day.id, "X", "09:00", "11:00");
      const ferry = await createRawItem(day.id, "Ferry", "12:00", "13:00");
      const b = await createRawItem(day.id, "B", "13:00", "16:00");
      await settleSeededDay(day.id, { flexible: [x.id, b.id] });

      const result = await reorderDayPlanItemForTripDay({ origin: "user", userId: user.id, tripId: trip.id, tripDayId: day.id, itemId: b.id, direction: "up" });

      if (result.status !== "reordered") throw new Error(`expected reordered, got ${result.status}`);
      expect(await times(day.id)).toEqual({ X: "09:00–11:00", B: "11:00–14:00", Ferry: "12:00–13:00" });
      expect(result.receipt.planConflicts).toEqual([
        { itemId: ferry.id, title: "Ferry", fromTime: "12:00", reachableAt: "14:00" },
      ]);
    });
  });

  it("carries no check-in warning when the swapped day reaches an explicit check-in too late (Story 13.2)", async () => {
    const user = await createUser("reorder-checkin@example.com");
    const { trip, day } = await createTrip(user.id);
    // 13.1: flexible A (2 h) and B (30 min) behind a fixed lunch until 15:00: A 15–17, B 17–17:30.
    await createItem(day.id, "Lunch", "14:00", "15:00");
    const a = await createItem(day.id, "A", "15:00", "17:00");
    const b = await createItem(day.id, "B", "16:00", "16:30");
    await prisma.accommodation.create({
      data: { tripDayId: day.id, name: "Hotel", status: "BOOKED", checkInTime: "17:15" },
    });
    // B→A takes 20 minutes: A becomes 15:50–17:50, after the 17:15 check-in.
    await createLeg(day.id, item(b.id), item(a.id), 20);
    await settleSeededDay(day.id, { flexible: [a.id, b.id] });
    const session = await createSessionJwt({ sub: user.id, role: user.role });

    const response = await send(trip.id, session, { tripDayId: day.id, itemId: b.id, direction: "up" });

    expect(response.status).toBe(200);
    const receipt = (response.body.data as { receipt: WireReceipt }).receipt;
    expect(receipt.movedItems.length).toBeGreaterThan(0);
    expect(Object.keys(receipt)).not.toContain("checkInWarning");
  });
});
