import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { PATCH, POST } from "@/app/api/trips/[id]/day-plan-items/route";
import { prisma } from "@/lib/db/prisma";
import { createSessionJwt } from "@/lib/auth/jwt";
import {
  createDayPlanItemForTripDay,
  deleteDayPlanItemForTripDay,
  listDayPlanItemsForTripDay,
  updateDayPlanItemForTripDay,
} from "@/lib/repositories/dayPlanItemRepo";
import { routeContext } from "./helpers/routeContext";
import { settleSeededDay } from "./helpers/settleSeededDay";

/**
 * Story 11.2. The push rule wired into the three write paths: what moves, what the receipt says, what a
 * refusal leaves behind (nothing), and the check-in warning. Story 13.1 replaced the rule with the
 * schedule (`daySchedule.test.ts` pins its arithmetic): a fixed row never moves, so the activities that
 * moved here are flexible ones, and the worked day has B and C flexible. This suite is still about the
 * transaction around the rule.
 */

const sampleDoc = (text: string) =>
  JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

/** Fixture rows are stamped in the past so a later write can never share their millisecond. */
const PAST = new Date("2026-01-02T03:04:05.678Z");

const createUser = (email: string) => prisma.user.create({ data: { email, passwordHash: "hashed", role: "OWNER" } });

const createTrip = async (userId: string) => {
  const trip = await prisma.trip.create({
    data: {
      userId,
      name: "Push Trip",
      startDate: new Date("2026-11-05T00:00:00.000Z"),
      endDate: new Date("2026-11-05T00:00:00.000Z"),
    },
  });
  const day = await prisma.tripDay.create({
    data: { tripId: trip.id, date: new Date("2026-11-05T00:00:00.000Z"), dayIndex: 1 },
  });
  return { trip, day };
};

let created = 0;
/** Distinct, increasing `createdAt`s, so equal starts always sort in creation order. */
const createRawItem = (tripDayId: string, title: string | null, fromTime: string | null, toTime: string | null) => {
  created += 1;
  const stamp = new Date(PAST.getTime() + created * 1000);
  return prisma.dayPlanItem.create({
    data: { tripDayId, title, fromTime, toTime, contentJson: sampleDoc(title ?? ""), createdAt: stamp, updatedAt: PAST },
  });
};

/** Story 13.1: each seeded day is numbered the way the migration numbers real data. */
const createItem = async (...args: Parameters<typeof createRawItem>) => {
  const row = await createRawItem(...args);
  await settleSeededDay(row.tripDayId);
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
      createdAt: PAST,
      updatedAt: PAST,
    },
  });

const item = (id: string) => ({ type: "DAY_PLAN_ITEM" as const, id });
const stay = (id: string) => ({ type: "ACCOMMODATION" as const, id });

/**
 * The worked example, as Story 13.1 plans it: A fixed 09–10, B and C flexible for an hour each, D fixed
 * 16–17, leg B→C 20 minutes. The schedule stores B 10:00–11:00 and C 11:20–12:20; `extraLegs` are seeded
 * before it runs.
 */
const seedWorkedDay = async (
  email: string,
  extraLegs?: (rows: { dayId: string; a: { id: string }; b: { id: string } }) => Promise<unknown>,
) => {
  const user = await createUser(email);
  const { trip, day } = await createTrip(user.id);
  const a = await createItem(day.id, "A", "09:00", "10:00");
  const b = await createItem(day.id, "B", "10:30", "11:30");
  const c = await createItem(day.id, "C", "12:00", "13:00");
  const d = await createItem(day.id, "D", "16:00", "17:00");
  const bc = await createLeg(day.id, item(b.id), item(c.id), 20);
  await extraLegs?.({ dayId: day.id, a, b });
  await settleSeededDay(day.id, { flexible: [b.id, c.id] });
  return { user, trip, day, a, b, c, d, bc };
};

const mutation = (userId: string, tripId: string, tripDayId: string) => ({ userId, tripId, tripDayId, costCents: null, linkUrl: null });

/** Every row a day-plan write could touch, in a stable order. */
const databaseState = async () => ({
  items: await prisma.dayPlanItem.findMany({ orderBy: { id: "asc" } }),
  payments: await prisma.costPayment.findMany({ orderBy: { id: "asc" } }),
  legs: await prisma.travelSegment.findMany({ orderBy: { id: "asc" } }),
  bucket: await prisma.tripBucketListItem.findMany({ orderBy: { id: "asc" } }),
});

const times = async (tripDayId: string) =>
  Object.fromEntries(
    (await prisma.dayPlanItem.findMany({ where: { tripDayId } })).map((row) => [row.title, `${row.fromTime}–${row.toTime}`]),
  );

const resetDatabase = async () => {
  await prisma.travelSegment.deleteMany();
  await prisma.dayPlanItemDocument.deleteMany();
  await prisma.dayPlanItemImage.deleteMany();
  await prisma.tripBucketListItem.deleteMany();
  await prisma.costPayment.deleteMany();
  await prisma.dayPlanItem.deleteMany();
  await prisma.tripMember.deleteMany();
  await prisma.accommodation.deleteMany();
  await prisma.tripDay.deleteMany();
  await prisma.trip.deleteMany();
  await prisma.user.deleteMany();
};

describe("day-plan writes push the rest of the day (Story 11.2)", () => {
  beforeEach(resetDatabase);

  it("create pushes B and C, records both with their previous and post-write stamps, and the DB matches", async () => {
    // A→B exists, so the insert between them sweeps it: the summary's "· 1 Fahrt entfernt" case.
    let ab = { id: "" };
    const { user, trip, day, b, c, d } = await seedWorkedDay("push-create@example.com", async ({ dayId, a, b }) => {
      ab = await createLeg(dayId, item(a.id), item(b.id), 10);
    });
    // 13.1: the stay-less day starts at 09:00; with the 10-minute A→B leg the schedule stored B 10:10–11:10.
    expect((await times(day.id)).B).toBe("10:10–11:10");

    const result = await createDayPlanItemForTripDay({
      ...mutation(user.id, trip.id, day.id),
      title: "M",
      fromTime: "10:00",
      toTime: "11:30",
      contentJson: sampleDoc("M"),
    });
    if (!result || "status" in result) throw new Error("expected a create");

    expect(await times(day.id)).toEqual({
      A: "09:00–10:00",
      M: "10:00–11:30",
      B: "11:30–12:30",
      C: "12:50–13:50",
      D: "16:00–17:00",
    });
    const moved = result.receipt.movedItems;
    // 13.1: the previous times are the stored, computed ones; D moved only in `sortOrder` (renumbered).
    expect(moved.map((row) => [row.itemId, row.previousFromTime, row.previousToTime, row.previousSortOrder])).toEqual([
      [b.id, "10:10", "11:10", 1],
      [c.id, "11:30", "12:30", 2],
      [d.id, "16:00", "17:00", 3],
    ]);
    for (const row of moved) {
      expect(row.previousUpdatedAt.getTime()).toBe(PAST.getTime());
      const stored = await prisma.dayPlanItem.findUniqueOrThrow({ where: { id: row.itemId } });
      expect(stored.updatedAt.getTime()).toBe(row.updatedAt.getTime());
      expect(stored.updatedAt.getTime()).toBeGreaterThan(PAST.getTime());
    }
    expect(result.receipt.removedTravelSegments.map((leg) => leg.id)).toEqual([ab.id]);
    // B→C is still drawn after the push, so it survives.
    expect(await prisma.travelSegment.count({ where: { tripDayId: day.id } })).toBe(1);
  });

  it("update that extends pushes; update that shortens pulls forward (13.1 AC4)", async () => {
    const { user, trip, day, a, b, c } = await seedWorkedDay("push-update@example.com");

    const extended = await updateDayPlanItemForTripDay({
      ...mutation(user.id, trip.id, day.id),
      itemId: a.id,
      title: "A",
      fromTime: "09:00",
      toTime: "11:00",
      contentJson: sampleDoc("A"),
    });
    expect(extended.status).toBe("updated");
    if (extended.status !== "updated") return;
    // B to 11:00–12:00; the 20-minute B→C leg then needs C at 12:20.
    expect(extended.receipt.movedItems.map((row) => row.itemId)).toEqual([b.id, c.id]);
    expect((await times(day.id)).B).toBe("11:00–12:00");
    expect((await times(day.id)).C).toBe("12:20–13:20");

    const before = await times(day.id);
    const shortened = await updateDayPlanItemForTripDay({
      ...mutation(user.id, trip.id, day.id),
      itemId: a.id,
      title: "A",
      fromTime: "09:00",
      toTime: "09:30",
      contentJson: sampleDoc("A"),
    });
    if (shortened.status !== "updated") throw new Error("expected an update");
    // 13.1 AC4: flexible rows sit tight, so B and C follow A forward.
    expect(shortened.receipt.movedItems.map((row) => row.itemId)).toEqual([b.id, c.id]);
    expect(await times(day.id)).toEqual({ ...before, A: "09:00–09:30", B: "09:30–10:30", C: "10:50–11:50" });
  });

  it("a save that leaves the times unchanged moves nothing, even where the day already overlaps", async () => {
    // Code review of 11.2: a title or notes edit is not a retime.
    const user = await createUser("push-notes-only@example.com");
    const { trip, day } = await createTrip(user.id);
    const a = await createItem(day.id, "A", "09:00", "10:00");
    await createItem(day.id, "B", "09:30", "10:30");
    await createItem(day.id, "C", "23:00", "23:59");
    const before = await times(day.id);

    const result = await updateDayPlanItemForTripDay({
      ...mutation(user.id, trip.id, day.id),
      itemId: a.id,
      title: "A renamed",
      fromTime: "09:00",
      toTime: "10:00",
      contentJson: sampleDoc("A renamed"),
    });
    if (result.status !== "updated") throw new Error(`expected an update, got ${result.status}`);
    expect(result.receipt.movedItems).toEqual([]);
    const { A: _old, ...rest } = before;
    void _old;
    expect(await times(day.id)).toEqual({ ...rest, "A renamed": "09:00–10:00" });
  });

  it("delete pulls the flexible rows after it forward (13.1 AC4)", async () => {
    const { user, trip, day, a, b, c, d } = await seedWorkedDay("push-delete@example.com");

    const deleted = await deleteDayPlanItemForTripDay({ userId: user.id, tripId: trip.id, tripDayId: day.id, itemId: a.id });
    if (deleted.status !== "deleted") throw new Error("expected a delete");
    // 13.1 AC4: with A gone, B starts at the 09:00 day start; D keeps its time and is only renumbered.
    expect(deleted.receipt.movedItems.map((row) => [row.itemId, row.fromTime, row.previousSortOrder])).toEqual([
      [b.id, "09:00", 1],
      [c.id, "10:20", 2],
      [d.id, "16:00", 3],
    ]);
    expect(await times(day.id)).toEqual({ B: "09:00–10:00", C: "10:20–11:20", D: "16:00–17:00" });
  });

  it("an untimed activity given a time is placed by its time (13.1 AC7)", async () => {
    const { user, trip, day, c, d } = await seedWorkedDay("push-untimed@example.com");
    const u = await createItem(day.id, "U", null, null);

    const result = await updateDayPlanItemForTripDay({
      ...mutation(user.id, trip.id, day.id),
      itemId: u.id,
      title: "U",
      fromTime: "10:00",
      toTime: "11:00",
      contentJson: sampleDoc("U"),
    });
    if (result.status !== "updated") throw new Error("expected an update");
    // 13.1 AC7: a fixed 10:00 goes after B, whose computed start is 10:00 too; B does not move, U is
    // reached late, and C (its B→C leg no longer drawn) follows U's end.
    expect(result.receipt.movedItems.map((row) => row.itemId)).toEqual([c.id, d.id]);
    expect(await times(day.id)).toMatchObject({ B: "10:00–11:00", U: "10:00–11:00", C: "11:00–12:00" });
    expect(result.receipt.planConflicts).toEqual([{ itemId: u.id, title: "U", fromTime: "10:00", reachableAt: "11:00" }]);
    expect(result.receipt.removedTravelSegments).toHaveLength(1);
  });

  it("listDayPlanItemsForTripDay returns the canonical order (DW-216)", async () => {
    const user = await createUser("push-list@example.com");
    const { trip, day } = await createTrip(user.id);
    const untimed = await createItem(day.id, "U", null, null);
    const late = await createItem(day.id, "Late", "15:00", "16:00");
    const tieFirst = await createItem(day.id, "Tie 1", "09:00", "10:00");
    const tieSecond = await createItem(day.id, "Tie 2", "09:00", "09:30");

    const items = await listDayPlanItemsForTripDay({ userId: user.id, tripId: trip.id, tripDayId: day.id });
    expect(items?.map((row) => row.id)).toEqual([tieFirst.id, tieSecond.id, late.id, untimed.id]);
  });
});

describe("the push rule's refusals write nothing (Story 11.2 AC5, AC8)", () => {
  beforeEach(resetDatabase);

  it("a fixed start before its predecessor is placed by time, never refused (13.1 AC7)", async () => {
    const { user, trip, day, a, b, c, d } = await seedWorkedDay("refuse-predecessor@example.com");

    const result = await updateDayPlanItemForTripDay({
      ...mutation(user.id, trip.id, day.id),
      itemId: c.id,
      title: "C",
      fromTime: "09:30",
      toTime: "10:00",
      contentJson: sampleDoc("C"),
    });

    // 13.1 AC7: `day_plan_before_predecessor` is gone. C goes after A, is reached at A's end, and B follows.
    if (result.status !== "updated") throw new Error(`expected an update, got ${result.status}`);
    const order = (await listDayPlanItemsForTripDay({ userId: user.id, tripId: trip.id, tripDayId: day.id }))!;
    expect(order.map((row) => row.id)).toEqual([a.id, c.id, b.id, d.id]);
    expect(result.receipt.planConflicts).toEqual([{ itemId: c.id, title: "C", fromTime: "09:30", reachableAt: "10:00" }]);
  });

  it("past_midnight: a create that would push a row past 23:59 writes nothing", async () => {
    const user = await createUser("refuse-midnight@example.com");
    const { trip, day } = await createTrip(user.id);
    // 13.1 §7: only a flexible row can be pushed past midnight; Late follows the fixed Show, 22:00–23:30.
    await createItem(day.id, "Show", "21:00", "22:00");
    const late = await createItem(day.id, "Late", "22:00", "23:30");
    await settleSeededDay(day.id, { flexible: [late.id] });
    const before = await databaseState();

    const result = await createDayPlanItemForTripDay({
      ...mutation(user.id, trip.id, day.id),
      title: "Dinner",
      fromTime: "21:00",
      toTime: "23:00",
      contentJson: sampleDoc("Dinner"),
    });

    expect(result).toEqual({ status: "past_midnight", item: { id: late.id, title: "Late" } });
    expect(await databaseState()).toEqual(before);
  });
});

describe("a row that already does not fit never blocks a save (Story 13.1 §7)", () => {
  beforeEach(resetDatabase);

  it("saves an unrelated change on a day whose last flexible row already has no times", async () => {
    const user = await createUser("midnight-existing@example.com");
    const { trip, day } = await createTrip(user.id);
    const a = await createItem(day.id, "A", "09:00", "10:00");
    await createItem(day.id, "Show", "22:00", "23:30");
    // Seeded untimed: flexible, and after the 23:30 show it does not fit (rule 5).
    const late = await createItem(day.id, "Night walk", null, null);
    await prisma.dayPlanItem.update({ where: { id: late.id }, data: { durationMinutes: 60 } });

    const result = await updateDayPlanItemForTripDay({
      ...mutation(user.id, trip.id, day.id),
      itemId: a.id,
      title: "A renamed",
      fromTime: "09:00",
      toTime: "10:00",
      contentJson: sampleDoc("A renamed"),
    });

    if (result.status !== "updated") throw new Error(`expected an update, got ${result.status}`);
    expect(await prisma.dayPlanItem.findUniqueOrThrow({ where: { id: late.id } })).toMatchObject({ fromTime: null, toTime: null });
  });

  it("refuses a change that pushes a row that fitted past midnight, but not one that already did not fit", async () => {
    const user = await createUser("midnight-new@example.com");
    const { trip, day } = await createTrip(user.id);
    await createItem(day.id, "Show", "21:00", "22:00");
    const fits = await createItem(day.id, "Bar", "22:00", "23:00");
    await settleSeededDay(day.id, { flexible: [fits.id] });
    const before = await databaseState();

    const pushed = await createDayPlanItemForTripDay({
      ...mutation(user.id, trip.id, day.id),
      title: "Dinner",
      fromTime: "21:30",
      toTime: "23:30",
      contentJson: sampleDoc("Dinner"),
    });

    expect(pushed).toEqual({ status: "past_midnight", item: { id: fits.id, title: "Bar" } });
    expect(await databaseState()).toEqual(before);
  });
});

// ---------------------------------------------------------------------------------------------------
// The route: 409 bodies and the conversion path.

type ApiEnvelope<T> = { data: T | null; error: { code: string; message: string; details?: unknown } | null };

const CSRF = "csrf-token-value";
const itemsUrl = (tripId: string) => `http://localhost/api/trips/${tripId}/day-plan-items`;

const send = async (
  handler: typeof POST,
  method: "POST" | "PATCH",
  tripId: string,
  session: string,
  body: unknown,
) => {
  const request = new NextRequest(itemsUrl(tripId), {
    method,
    headers: {
      "Content-Type": "application/json",
      cookie: `session=${session}; csrf_token=${CSRF}`,
      "x-csrf-token": CSRF,
    },
    body: JSON.stringify(body),
  });
  const response = await handler(request, routeContext(tripId));
  return { status: response.status, body: (await response.json()) as ApiEnvelope<unknown> };
};

describe("POST and PATCH /api/trips/[id]/day-plan-items push refusals (Story 11.2)", () => {
  beforeEach(resetDatabase);

  it("PATCH before the predecessor: 200, the row placed by its time (13.1 AC7 removed the 409)", async () => {
    const { user, trip, day, a, b, c, d } = await seedWorkedDay("route-predecessor@example.com");
    const session = await createSessionJwt({ sub: user.id, role: user.role });

    const response = await send(PATCH, "PATCH", trip.id, session, {
      tripDayId: day.id,
      itemId: c.id,
      title: "C",
      fromTime: "09:30",
      toTime: "10:00",
      contentJson: sampleDoc("C"),
    });

    expect(response.status).toBe(200);
    const order = (await listDayPlanItemsForTripDay({ userId: user.id, tripId: trip.id, tripDayId: day.id }))!;
    expect(order.map((row) => row.id)).toEqual([a.id, c.id, b.id, d.id]);
  });

  it("POST past midnight: 409 day_plan_past_midnight with details, database unchanged", async () => {
    const user = await createUser("route-midnight@example.com");
    const { trip, day } = await createTrip(user.id);
    // 13.1 §7: Late is flexible behind the fixed Show, 23:00–23:45; the fixed Bar pushes it past 23:59.
    await createItem(day.id, "Show", "22:00", "23:00");
    const late = await createItem(day.id, "Late", "23:00", "23:45");
    await settleSeededDay(day.id, { flexible: [late.id] });
    const session = await createSessionJwt({ sub: user.id, role: user.role });
    const before = await databaseState();

    const response = await send(POST, "POST", trip.id, session, {
      tripDayId: day.id,
      title: "Bar",
      fromTime: "22:30",
      toTime: "23:30",
      contentJson: sampleDoc("Bar"),
    });

    expect(response.status).toBe(409);
    expect(response.body.error).toMatchObject({ code: "day_plan_past_midnight", details: { itemId: late.id, itemTitle: "Late" } });
    expect(await databaseState()).toEqual(before);
  });

  it("POST conversion past midnight: the idea is still on the bucket list", async () => {
    const user = await createUser("route-convert-midnight@example.com");
    const { trip, day } = await createTrip(user.id);
    // 13.1 §7: as above, a flexible Late behind a fixed Show.
    await createItem(day.id, "Show", "22:00", "23:00");
    const late = await createItem(day.id, "Late", "23:00", "23:45");
    await settleSeededDay(day.id, { flexible: [late.id] });
    const idea = await prisma.tripBucketListItem.create({ data: { tripId: trip.id, title: "Idea" } });
    const session = await createSessionJwt({ sub: user.id, role: user.role });
    const before = await databaseState();

    const response = await send(POST, "POST", trip.id, session, {
      tripDayId: day.id,
      bucketListItemId: idea.id,
      title: "Idea",
      fromTime: "22:30",
      toTime: "23:30",
      contentJson: sampleDoc("Idea"),
    });

    expect(response.status).toBe(409);
    expect(response.body.error?.code).toBe("day_plan_past_midnight");
    expect(await prisma.tripBucketListItem.findUnique({ where: { id: idea.id } })).not.toBeNull();
    expect(await databaseState()).toEqual(before);
  });

  it("POST success still answers dayPlanItem and a signed version-3 receipt listing moved items", async () => {
    const { user, trip, day, c, d } = await seedWorkedDay("route-success@example.com");
    const session = await createSessionJwt({ sub: user.id, role: user.role });

    const response = await send(POST, "POST", trip.id, session, {
      tripDayId: day.id,
      title: "M",
      fromTime: "10:00",
      toTime: "11:00",
      contentJson: sampleDoc("M"),
    });

    expect(response.status).toBe(200);
    const data = response.body.data as {
      dayPlanItem: { title: string };
      receipt: { version: number; signature: string; movedItems: { itemId: string; updatedAt: string }[] };
    };
    expect(data.dayPlanItem.title).toBe("M");
    expect(data.receipt.version).toBe(3);
    expect(data.receipt.signature).toMatch(/^[0-9a-f]{64}$/);
    // 13.1: the fixed M goes after B (computed start 10:00 too); C follows M, D is renumbered.
    expect(data.receipt.movedItems.map((row) => row.itemId)).toEqual([c.id, d.id]);
    expect(data.receipt.movedItems[0].updatedAt).toMatch(/Z$/);
  });
});

describe("the check-in warning (Story 11.2 AC9)", () => {
  beforeEach(resetDatabase);

  /** A 15:00–16:00 and B 16:00–17:00, with tonight's stay. Extending A to 16:45 pushes B to 16:45–17:45. */
  const seedEvening = async (email: string, checkInTime: string | null) => {
    const user = await createUser(email);
    const { trip, day } = await createTrip(user.id);
    const a = await createItem(day.id, "A", "15:00", "16:00");
    const b = await createItem(day.id, "B", "16:00", "17:00");
    // 13.1: B is flexible, so it is what A's changes move.
    await settleSeededDay(day.id, { flexible: [b.id] });
    const accommodation = await prisma.accommodation.create({
      data: { tripDayId: day.id, name: "Hotel", status: "BOOKED", checkInTime },
    });
    return { user, trip, day, a, b, accommodation };
  };

  const extendA = (user: { id: string }, trip: { id: string }, day: { id: string }, a: { id: string }, toTime = "16:45") =>
    updateDayPlanItemForTripDay({
      ...mutation(user.id, trip.id, day.id),
      itemId: a.id,
      title: "A",
      fromTime: "15:00",
      toTime,
      contentJson: sampleDoc("A"),
    });

  it("warns when the pushed day reaches an explicit check-in too late", async () => {
    const { user, trip, day, a, accommodation } = await seedEvening("warn-explicit@example.com", "17:30");

    const result = await extendA(user, trip, day, a);
    if (result.status !== "updated") throw new Error("expected an update");
    expect(result.receipt.movedItems).toHaveLength(1);
    expect(result.receipt.checkInWarning).toEqual({ accommodationId: accommodation.id, checkInTime: "17:30" });
  });

  it("does not warn when the stay's check-in is not set (the 16:00 default is the client's)", async () => {
    const { user, trip, day, a } = await seedEvening("warn-null@example.com", null);

    const result = await extendA(user, trip, day, a);
    if (result.status !== "updated") throw new Error("expected an update");
    expect(result.receipt.movedItems).toHaveLength(1);
    expect(result.receipt.checkInWarning).toBeUndefined();
  });

  it("does not warn when nothing moved, even if the day already ends after check-in", async () => {
    const { user, trip, day, a } = await seedEvening("warn-unmoved@example.com", "12:00");

    // 13.1 AC4: a shorter A would pull B forward now, so the save that moves nothing keeps A's times.
    const result = await extendA(user, trip, day, a, "16:00");
    if (result.status !== "updated") throw new Error("expected an update");
    expect(result.receipt.movedItems).toEqual([]);
    expect(result.receipt.checkInWarning).toBeUndefined();
  });

  it("counts the leg to the stay only when it is drawn", async () => {
    // B ends at 17:45 after the push; check-in 18:00. Without the 30-minute leg there is no warning.
    const drawn = await seedEvening("warn-leg-drawn@example.com", "18:00");
    await createLeg(drawn.day.id, item(drawn.b.id), stay(drawn.accommodation.id), 30);
    const withLeg = await extendA(drawn.user, drawn.trip, drawn.day, drawn.a);
    if (withLeg.status !== "updated") throw new Error("expected an update");
    expect(withLeg.receipt.checkInWarning).toEqual({ accommodationId: drawn.accommodation.id, checkInTime: "18:00" });

    await resetDatabase();

    // The same leg, but an untimed activity now sits between B and the stay: the leg is not drawn.
    const undrawn = await seedEvening("warn-leg-undrawn@example.com", "18:00");
    await createItem(undrawn.day.id, "Untimed", null, null);
    await createLeg(undrawn.day.id, item(undrawn.b.id), stay(undrawn.accommodation.id), 30);
    const withoutLeg = await extendA(undrawn.user, undrawn.trip, undrawn.day, undrawn.a);
    if (withoutLeg.status !== "updated") throw new Error("expected an update");
    // 13.1: the former untimed row is flexible and follows B, 17:45–18:00, which is not after 18:00.
    expect(withoutLeg.receipt.movedItems).toHaveLength(2);
    expect(withoutLeg.receipt.checkInWarning).toBeUndefined();
  });
});
