import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import {
  createDayPlanItemForTripDay,
  deleteDayPlanItemForTripDay,
  parkDayPlanItemForTripDay,
  scheduleParkedDayPlanItemForTripDay,
  updateDayPlanItemForTripDay,
} from "@/lib/repositories/dayPlanItemRepo";
import { undoDayPlanChangeForTrip } from "@/lib/repositories/dayPlanChangeRepo";
import { getTripWithDaysForUser } from "@/lib/repositories/tripRepo";
import { settleSeededDay } from "./helpers/settleSeededDay";

/**
 * Story 13.2 AC6. Past midnight is saved, not refused: a write that pushes flexible activities past
 * 23:59 stores them without times and with their durations, the receipt lists the ones that had times,
 * undo restores them exactly, and the next write that makes room gives the times back. The trip payload
 * marks every one of them (`overflow`).
 */

const doc = (text: string) =>
  JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

/** Fixture rows are stamped in the past so a later write can never share their millisecond. */
const PAST = new Date("2026-01-02T03:04:05.678Z");

const resetDatabase = async () => {
  await prisma.travelSegment.deleteMany();
  await prisma.costPayment.deleteMany();
  await prisma.dayPlanItem.deleteMany();
  await prisma.accommodation.deleteMany();
  await prisma.tripMember.deleteMany();
  await prisma.tripDay.deleteMany();
  await prisma.trip.deleteMany();
  await prisma.user.deleteMany();
};

const databaseState = async () => ({
  items: await prisma.dayPlanItem.findMany({ orderBy: { id: "asc" } }),
  payments: await prisma.costPayment.findMany({ orderBy: { id: "asc" } }),
  legs: await prisma.travelSegment.findMany({ orderBy: { id: "asc" } }),
});

const times = async (tripDayId: string) =>
  Object.fromEntries(
    (await prisma.dayPlanItem.findMany({ where: { tripDayId } })).map((row) => [
      row.title,
      `${row.fromTime ?? "-"}–${row.toTime ?? "-"}`,
    ]),
  );

/**
 * One day with no stay the night before (09:00 start): a fixed show 20:00–21:00, then flexible A (60),
 * B (60) and C (30): A 21:00–22:00, B 22:00–23:00, C 23:00–23:30.
 */
const seedEvening = async (email: string) => {
  const user = await prisma.user.create({ data: { email, passwordHash: "hashed", role: "OWNER" } });
  const trip = await prisma.trip.create({
    data: {
      userId: user.id,
      name: "Late Trip",
      startDate: new Date("2026-11-05T00:00:00.000Z"),
      endDate: new Date("2026-11-05T00:00:00.000Z"),
    },
  });
  const day = await prisma.tripDay.create({ data: { tripId: trip.id, date: new Date("2026-11-05T00:00:00.000Z"), dayIndex: 1 } });
  const row = (title: string, sortOrder: number, fields: Record<string, unknown>) =>
    prisma.dayPlanItem.create({
      data: { tripId: trip.id, tripDayId: day.id, title, sortOrder, contentJson: doc(title), updatedAt: PAST, ...fields },
    });
  await row("Show", 0, { scheduleMode: "FIXED", durationMinutes: 60, fromTime: "20:00", toTime: "21:00" });
  const a = await row("A", 1, { scheduleMode: "FLEXIBLE", durationMinutes: 60 });
  const b = await row("B", 2, { scheduleMode: "FLEXIBLE", durationMinutes: 60 });
  const c = await row("C", 3, { scheduleMode: "FLEXIBLE", durationMinutes: 30 });
  await settleSeededDay(day.id, { flexible: [a.id, b.id, c.id] });
  return { user, trip, day, a, b, c };
};

const flexibleEdit = (
  seeded: { user: { id: string }; trip: { id: string }; day: { id: string } },
  item: { id: string },
  title: string,
  durationMinutes: number,
) =>
  updateDayPlanItemForTripDay({
    origin: "user",
    userId: seeded.user.id,
    tripId: seeded.trip.id,
    tripDayId: seeded.day.id,
    itemId: item.id,
    title,
    scheduleMode: "FLEXIBLE",
    durationMinutes,
    fromTime: null,
    toTime: null,
    contentJson: doc(title),
  });

const conflictsOf = async (userId: string, tripId: string) =>
  (await getTripWithDaysForUser(userId, tripId))!.days[0].planConflicts;

describe("past midnight is saved (Story 13.2 AC6)", () => {
  beforeEach(resetDatabase);

  it("an edit pushing two flexible rows past 23:59 stores both untimed, keeps their durations, and undo restores the day", async () => {
    const seeded = await seedEvening("midnight-edit@example.com");
    const { user, trip, day, a, b, c } = seeded;
    expect(await times(day.id)).toEqual({ Show: "20:00–21:00", A: "21:00–22:00", B: "22:00–23:00", C: "23:00–23:30" });
    const before = await databaseState();

    const longer = await flexibleEdit(seeded, a, "A", 150);

    if (longer.status !== "updated") throw new Error(`expected an update, got ${longer.status}`);
    expect(await times(day.id)).toEqual({ Show: "20:00–21:00", A: "21:00–23:30", B: "-–-", C: "-–-" });
    expect(await prisma.dayPlanItem.findUniqueOrThrow({ where: { id: b.id } })).toMatchObject({ durationMinutes: 60 });
    expect(await prisma.dayPlanItem.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ durationMinutes: 30 });
    expect(longer.receipt.movedItems.map((row) => [row.itemId, row.previousFromTime, row.previousToTime, row.fromTime, row.toTime])).toEqual([
      [b.id, "22:00", "23:00", null, null],
      [c.id, "23:00", "23:30", null, null],
    ]);
    expect(await conflictsOf(user.id, trip.id)).toEqual([
      { kind: "overflow", itemId: b.id, title: "B" },
      { kind: "overflow", itemId: c.id, title: "C" },
    ]);

    const undone = await undoDayPlanChangeForTrip({ userId: user.id, tripId: trip.id, receipt: longer.receipt });

    expect(undone).toEqual({ status: "undone" });
    expect(await databaseState()).toEqual(before);
  });

  it("a later shortening gives the untimed rows their times back exactly", async () => {
    const seeded = await seedEvening("midnight-shorten@example.com");
    const { user, trip, day, a } = seeded;
    await flexibleEdit(seeded, a, "A", 150);

    const shorter = await flexibleEdit(seeded, a, "A", 60);

    expect(shorter.status).toBe("updated");
    expect(await times(day.id)).toEqual({ Show: "20:00–21:00", A: "21:00–22:00", B: "22:00–23:00", C: "23:00–23:30" });
    expect(await conflictsOf(user.id, trip.id)).toEqual([]);
  });

  it("a delete gives the untimed rows their times back", async () => {
    const seeded = await seedEvening("midnight-delete@example.com");
    const { user, trip, day, a } = seeded;
    await flexibleEdit(seeded, a, "A", 150);

    const deleted = await deleteDayPlanItemForTripDay({ userId: user.id, tripId: trip.id, tripDayId: day.id, itemId: a.id });

    expect(deleted.status).toBe("deleted");
    expect(await times(day.id)).toEqual({ Show: "20:00–21:00", B: "21:00–22:00", C: "22:00–22:30" });
    expect(await conflictsOf(user.id, trip.id)).toEqual([]);
  });

  it("a create that does not fit is saved without times, and nothing else moves", async () => {
    const seeded = await seedEvening("midnight-create@example.com");
    const { user, trip, day } = seeded;

    const created = await createDayPlanItemForTripDay({
      origin: "user",
      userId: user.id,
      tripId: trip.id,
      tripDayId: day.id,
      title: "Night swim",
      scheduleMode: "FLEXIBLE",
      durationMinutes: 45,
      fromTime: null,
      toTime: null,
      contentJson: doc("Night swim"),
      costCents: null,
      linkUrl: null,
    });

    if (!created) throw new Error("expected a create");
    expect(created.item).toMatchObject({ fromTime: null, toTime: null, durationMinutes: 45 });
    expect(created.receipt.movedItems).toEqual([]);
    expect(await conflictsOf(user.id, trip.id)).toEqual([{ kind: "overflow", itemId: created.item.id, title: "Night swim" }]);
  });

  it("\"+\" on a full day (Story 14.1) schedules the idea without times", async () => {
    const seeded = await seedEvening("midnight-schedule@example.com");
    const { user, trip, day } = seeded;
    const idea = await prisma.dayPlanItem.create({
      data: { tripId: trip.id, tripDayId: null, scheduleMode: "FLEXIBLE", durationMinutes: 60, title: "Idea", contentJson: doc("Idea") },
    });

    const scheduled = await scheduleParkedDayPlanItemForTripDay({ origin: "user", userId: user.id, tripId: trip.id, tripDayId: day.id, itemId: idea.id });

    expect(scheduled.status).toBe("scheduled");
    expect(await prisma.dayPlanItem.findUniqueOrThrow({ where: { id: idea.id } })).toMatchObject({
      tripDayId: day.id,
      fromTime: null,
      toTime: null,
      durationMinutes: 60,
    });
  });

  it("parking on a full day (Story 14.2) succeeds and makes room for the rows after it", async () => {
    const seeded = await seedEvening("midnight-park@example.com");
    const { user, trip, day, a } = seeded;
    await flexibleEdit(seeded, a, "A", 150);

    const parked = await parkDayPlanItemForTripDay({ origin: "user", userId: user.id, tripId: trip.id, tripDayId: day.id, itemId: a.id });

    expect(parked.status).toBe("parked");
    expect(await times(day.id)).toEqual({ Show: "20:00–21:00", B: "21:00–22:00", C: "22:00–22:30" });
  });
});
