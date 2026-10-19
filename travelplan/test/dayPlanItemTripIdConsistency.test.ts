import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import {
  createDayPlanItemForTripDay,
  deleteDayPlanItemForTripDay,
  moveDayPlanItemsBetweenTripDays,
  parkDayPlanItemForTripDay,
  scheduleParkedDayPlanItemForTripDay,
  swapDayPlanItemsBetweenTripDays,
} from "@/lib/repositories/dayPlanItemRepo";
import { undoDayPlanChangeForTrip } from "@/lib/repositories/dayPlanChangeRepo";
import {
  applySuggestionsForTripDay,
  loadSuggestionPlanContextForWriter,
  planBasis,
  planSuggestionAppend,
} from "@/lib/repositories/daySuggestionApplyRepo";
import { readScheduleInputInTransaction } from "@/lib/repositories/dayScheduleTransaction";
import { createTripWithDays, getTripExportForUser, importTripFromExportForUser } from "@/lib/repositories/tripRepo";
import { suggestionDurationMinutes } from "@/lib/trips/suggestionPlan";
import type { TripImportPayloadInput } from "@/lib/validation/tripImportSchemas";
import { suggestion } from "./helpers/suggestionApplyFixtures";

/**
 * Story 14.1 (Task 2). `DayPlanItem.tripId` is denormalised from the day, so every write path that puts
 * a row on a day must leave `tripId === tripDay.tripId`. Nothing in the schema enforces it (a CHECK
 * cannot reach another table), so each path is driven here and the whole table is checked after it.
 */

const doc = (text: string) =>
  JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

/** Every row on a day whose `trip_id` is not its day's trip. Must always be empty. */
const mismatches = () =>
  prisma.$queryRaw<{ id: string }[]>`
    SELECT i.id FROM day_plan_items i JOIN trip_days d ON d.id = i.trip_day_id WHERE i.trip_id <> d.trip_id`;

let counter = 0;
const seed = async () => {
  const user = await prisma.user.create({
    data: { email: `trip-id-consistency-${counter++}@example.com`, passwordHash: "hashed", role: "OWNER" },
  });
  const { trip } = await createTripWithDays({
    userId: user.id,
    name: "Consistency",
    startDate: "2026-08-01T00:00:00.000Z",
    endDate: "2026-08-03T00:00:00.000Z",
  });
  // A second trip, so a row taking the wrong trip's id would have one to take.
  await createTripWithDays({
    userId: user.id,
    name: "Other",
    startDate: "2026-09-01T00:00:00.000Z",
    endDate: "2026-09-01T00:00:00.000Z",
  });
  const days = await prisma.tripDay.findMany({ where: { tripId: trip.id }, orderBy: { dayIndex: "asc" } });
  return { user, trip, days };
};

const create = async (userId: string, tripId: string, tripDayId: string, title: string) => {
  const result = await createDayPlanItemForTripDay({
    userId,
    tripId,
    tripDayId,
    title,
    scheduleMode: "FLEXIBLE",
    durationMinutes: 30,
    fromTime: null,
    toTime: null,
    contentJson: doc(title),
  });
  if (!result || "status" in result) throw new Error("create failed");
  return result;
};

const expectConsistent = async (tripId: string) => {
  expect(await mismatches()).toEqual([]);
  const rows = await prisma.dayPlanItem.findMany({ where: { tripDay: { tripId } }, select: { tripId: true } });
  expect(rows.every((row) => row.tripId === tripId)).toBe(true);
};

describe("every write path keeps DayPlanItem.tripId equal to its day's trip (Story 14.1)", () => {
  beforeEach(async () => {
    await prisma.travelSegment.deleteMany();
    await prisma.dayPlanItem.deleteMany();
    await prisma.tripDay.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
  });

  it("create, park and schedule onto another day, whole-day move and swap", async () => {
    const { user, trip, days } = await seed();
    const a = await create(user.id, trip.id, days[0].id, "A");
    await create(user.id, trip.id, days[1].id, "B");
    expect(a.item).toMatchObject({ tripDayId: days[0].id });
    await expectConsistent(trip.id);

    expect(await parkDayPlanItemForTripDay({ userId: user.id, tripId: trip.id, tripDayId: days[0].id, itemId: a.item.id })).toMatchObject({ status: "parked" });
    await expectConsistent(trip.id);
    expect(await scheduleParkedDayPlanItemForTripDay({ userId: user.id, tripId: trip.id, tripDayId: days[2].id, itemId: a.item.id })).toMatchObject({ status: "scheduled" });
    await expectConsistent(trip.id);

    await swapDayPlanItemsBetweenTripDays({ userId: user.id, tripId: trip.id, firstTripDayId: days[1].id, secondTripDayId: days[2].id });
    await expectConsistent(trip.id);

    await moveDayPlanItemsBetweenTripDays({ userId: user.id, tripId: trip.id, sourceTripDayId: days[1].id, targetTripDayId: days[0].id });
    await expectConsistent(trip.id);
  });

  it("the undo of a delete, which re-creates the row", async () => {
    const { user, trip, days } = await seed();
    const a = await create(user.id, trip.id, days[0].id, "A");
    const deleted = await deleteDayPlanItemForTripDay({ userId: user.id, tripId: trip.id, tripDayId: days[0].id, itemId: a.item.id });
    if (deleted.status !== "deleted") throw new Error("delete failed");

    expect(await undoDayPlanChangeForTrip({ userId: user.id, tripId: trip.id, receipt: deleted.receipt })).toEqual({ status: "undone" });
    expect(await prisma.dayPlanItem.findUniqueOrThrow({ where: { id: a.item.id } })).toMatchObject({ tripId: trip.id, tripDayId: days[0].id });
    await expectConsistent(trip.id);
  });

  it("scheduling a parked activity", async () => {
    const { user, trip, days } = await seed();
    const idea = await prisma.dayPlanItem.create({
      data: { tripId: trip.id, tripDayId: null, scheduleMode: "FLEXIBLE", title: "Idea", contentJson: doc("Idea") },
    });
    const scheduled = await scheduleParkedDayPlanItemForTripDay({ userId: user.id, tripId: trip.id, tripDayId: days[1].id, itemId: idea.id });
    expect(scheduled.status).toBe("scheduled");
    await expectConsistent(trip.id);
  });

  it("applying suggestions", async () => {
    const { user, trip, days } = await seed();
    const context = await loadSuggestionPlanContextForWriter(user.id, trip.id, days[0].id);
    if (!context) throw new Error("no context");
    const state = await readScheduleInputInTransaction(prisma, trip.id, days[0].id);
    if (!state) throw new Error("no state");
    const plan = planSuggestionAppend(state, [suggestionDurationMinutes(suggestion().durationMinutes)], [null]);
    const receipt = await applySuggestionsForTripDay({
      userId: user.id,
      tripId: trip.id,
      tripDayId: days[0].id,
      mode: "walking",
      suggestions: [suggestion({ title: "Suggested" })],
      legs: [null],
      basis: planBasis(context, plan),
      images: [[]],
    });
    expect(receipt).not.toBeNull();
    expect(await prisma.dayPlanItem.count({ where: { tripId: trip.id } })).toBe(1);
    await expectConsistent(trip.id);
  });

  it("importing a backup, with its days' activities and its parked ones", async () => {
    const { user, trip, days } = await seed();
    await create(user.id, trip.id, days[0].id, "A");
    await prisma.dayPlanItem.create({
      data: { tripId: trip.id, tripDayId: null, scheduleMode: "FLEXIBLE", title: "Idea", contentJson: doc("Idea") },
    });
    const exported = await getTripExportForUser(user.id, trip.id);
    if (!exported) throw new Error("export failed");
    const payload = {
      ...exported.payload,
      meta: { exportedAt: exported.payload.trip.updatedAt, appVersion: "test", formatVersion: 2, warnings: [] },
      trip: { ...exported.payload.trip, bucketListItems: [] },
    } as unknown as TripImportPayloadInput;

    const result = await importTripFromExportForUser({ userId: user.id, payload, strategy: "createNew", photoBytes: new Map() });
    if (result.outcome !== "imported") throw new Error("import failed");

    const newTripId = result.trip.id;
    expect(await prisma.dayPlanItem.count({ where: { tripId: newTripId, tripDayId: { not: null } } })).toBe(1);
    expect(await prisma.dayPlanItem.count({ where: { tripId: newTripId, tripDayId: null } })).toBe(1);
    await expectConsistent(newTripId);
  });
});
