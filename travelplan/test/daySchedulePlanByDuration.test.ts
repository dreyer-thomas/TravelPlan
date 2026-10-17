import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import {
  createDayPlanItemForTripDay,
  listDayPlanItemsForTripDay,
  updateDayPlanItemForTripDay,
} from "@/lib/repositories/dayPlanItemRepo";
import { createTravelSegmentForTripDay } from "@/lib/repositories/travelSegmentRepo";
import { undoDayPlanChangeForTrip } from "@/lib/repositories/dayPlanChangeRepo";
import type { DayChangeReceipt } from "@/lib/trips/dayChangeReceipt";

/**
 * Story 13.1 (Task 10). The 2026-10-17 proposal's success criteria 1–3 and 5, end to end through the
 * repositories, with no time typed for a flexible activity:
 *
 * 1. Check-out 09:00, a 30-minute leg from the stay, flexible activities of 1 h, 2 h and 30 min with
 *    20-minute legs between them read 09:30–10:30, 10:50–12:50 and 13:10–13:40.
 * 2. Shortening the second to 1 h moves the third to 12:10–12:40.
 * 3. A fixed ferry after that chain is reached late: the save succeeds, its time does not move, and the
 *    receipt names it. (The ferry is booked at 12:30: rule 4 places a fixed row by its time, and at
 *    12:00 it would sort before the third activity, whose computed start is 12:10. At 12:30 it follows
 *    the chain, and is reachable at 12:40, the proposal's own figure.)
 * 5. Undo restores the day exactly, order and modes included, one change at a time.
 */

const sampleDoc = (text: string) =>
  JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

const resetDatabase = async () => {
  await prisma.travelSegment.deleteMany();
  await prisma.costPayment.deleteMany();
  await prisma.dayPlanItem.deleteMany();
  await prisma.accommodation.deleteMany();
  await prisma.tripDay.deleteMany();
  await prisma.trip.deleteMany();
  await prisma.user.deleteMany();
};

const databaseState = async () => ({
  items: await prisma.dayPlanItem.findMany({ orderBy: { id: "asc" } }),
  legs: await prisma.travelSegment.findMany({ orderBy: { id: "asc" } }),
  stays: await prisma.accommodation.findMany({ orderBy: { id: "asc" } }),
});

describe("a day planned by duration (Story 13.1, the proposal's success criteria)", () => {
  beforeEach(resetDatabase);

  it("computes the day, pulls it forward, reports the late ferry, and undoes exactly", async () => {
    const user = await prisma.user.create({ data: { email: "duration-day@example.com", passwordHash: "hashed", role: "OWNER" } });
    const trip = await prisma.trip.create({
      data: {
        userId: user.id,
        name: "Westland",
        startDate: new Date("2026-11-04T00:00:00.000Z"),
        endDate: new Date("2026-11-05T00:00:00.000Z"),
      },
    });
    const stayDay = await prisma.tripDay.create({ data: { tripId: trip.id, date: new Date("2026-11-04T00:00:00.000Z"), dayIndex: 1 } });
    const day = await prisma.tripDay.create({ data: { tripId: trip.id, date: new Date("2026-11-05T00:00:00.000Z"), dayIndex: 2 } });
    const stay = await prisma.accommodation.create({ data: { tripDayId: stayDay.id, name: "Glenfern", checkOutTime: "09:00" } });
    const scope = { userId: user.id, tripId: trip.id, tripDayId: day.id };

    const flexible = async (title: string, durationMinutes: number) => {
      const result = await createDayPlanItemForTripDay({
        ...scope,
        title,
        scheduleMode: "FLEXIBLE",
        durationMinutes,
        fromTime: null,
        toTime: null,
        contentJson: sampleDoc(title),
      });
      if (!result || "status" in result) throw new Error(`expected a create of ${title}`);
      return result.item;
    };
    const leg = async (from: { type: "accommodation" | "dayPlanItem"; id: string }, to: { id: string }, durationMinutes: number) => {
      const result = await createTravelSegmentForTripDay({
        ...scope,
        fromItemType: from.type,
        fromItemId: from.id,
        toItemType: "dayPlanItem",
        toItemId: to.id,
        transportType: "car",
        durationMinutes,
        distanceKm: null,
        linkUrl: null,
      });
      if (result.status !== "created") throw new Error(`expected a leg, got ${result.status}`);
    };
    const day2 = async () =>
      ((await listDayPlanItemsForTripDay(scope)) ?? []).map(
        (item) => `${item.title} ${item.scheduleMode} ${item.fromTime ?? "-"}–${item.toTime ?? "-"}`,
      );

    // 1.
    const first = await flexible("Waterfall", 60);
    const second = await flexible("Lunch", 120);
    const third = await flexible("Museum", 30);
    await leg({ type: "accommodation", id: stay.id }, first, 30);
    await leg({ type: "dayPlanItem", id: first.id }, second, 20);
    await leg({ type: "dayPlanItem", id: second.id }, third, 20);
    expect(await day2()).toEqual([
      "Waterfall FLEXIBLE 09:30–10:30",
      "Lunch FLEXIBLE 10:50–12:50",
      "Museum FLEXIBLE 13:10–13:40",
    ]);

    // 2.
    const beforeShortening = await databaseState();
    const shortened = await updateDayPlanItemForTripDay({
      ...scope,
      itemId: second.id,
      title: "Lunch",
      scheduleMode: "FLEXIBLE",
      durationMinutes: 60,
      fromTime: null,
      toTime: null,
      contentJson: sampleDoc("Lunch"),
    });
    if (shortened.status !== "updated") throw new Error(`expected an update, got ${shortened.status}`);
    expect((await day2())[2]).toBe("Museum FLEXIBLE 12:10–12:40");
    expect(shortened.receipt.movedItems.map((row) => row.itemId)).toEqual([third.id]);

    // 3.
    const beforeFerry = await databaseState();
    const ferry = await createDayPlanItemForTripDay({
      ...scope,
      title: "Ferry",
      scheduleMode: "FIXED",
      fromTime: "12:30",
      toTime: "13:30",
      contentJson: sampleDoc("Ferry"),
    });
    if (!ferry || "status" in ferry) throw new Error("expected the ferry to be saved");
    expect(await day2()).toEqual([
      "Waterfall FLEXIBLE 09:30–10:30",
      "Lunch FLEXIBLE 10:50–11:50",
      "Museum FLEXIBLE 12:10–12:40",
      "Ferry FIXED 12:30–13:30",
    ]);
    expect(ferry.receipt.planConflicts).toEqual([
      { itemId: ferry.item.id, title: "Ferry", fromTime: "12:30", reachableAt: "12:40" },
    ]);

    // 5.
    const undo = (receipt: DayChangeReceipt) => undoDayPlanChangeForTrip({ userId: user.id, tripId: trip.id, receipt });
    expect(await undo(ferry.receipt)).toEqual({ status: "undone" });
    expect(await databaseState()).toEqual(beforeFerry);
    expect(await undo(shortened.receipt)).toEqual({ status: "undone" });
    expect(await databaseState()).toEqual(beforeShortening);
  });
});
