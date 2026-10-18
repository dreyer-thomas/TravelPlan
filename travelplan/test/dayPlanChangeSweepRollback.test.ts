import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";

/**
 * Story 11.1 AC1 — the *atomicity* half of the sweep: it runs inside the write's own transaction, so a
 * sweep that throws rolls the item write back.
 *
 * Its own file for the reason `accommodationDeleteRollback.test.ts` gives: the sweep is a read and a
 * `deleteMany` over rows the test just created, there is no input that makes it fail, and `vi.mock` is
 * per-module for a whole file.
 */
const sweep = vi.hoisted(() => vi.fn());

vi.mock("@/lib/repositories/travelSegmentRepo", async () => {
  const actual = await vi.importActual<typeof import("@/lib/repositories/travelSegmentRepo")>(
    "@/lib/repositories/travelSegmentRepo",
  );
  return {
    ...actual,
    sweepNoLongerDrawnSegmentsInTransaction: (...args: unknown[]) => sweep(...args),
  };
});

const { createDayPlanItemForTripDay, updateDayPlanItemForTripDay, deleteDayPlanItemForTripDay } = await import(
  "@/lib/repositories/dayPlanItemRepo"
);

const sampleDoc = (text: string) =>
  JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

describe("a day-plan write is atomic with its leg sweep", () => {
  beforeEach(async () => {
    await prisma.travelSegment.deleteMany();
    await prisma.costPayment.deleteMany();
    await prisma.dayPlanItem.deleteMany();
    await prisma.tripDay.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
    sweep.mockReset();
    sweep.mockRejectedValue(new Error("sweep failed"));
  });

  const seed = async (email: string) => {
    const user = await prisma.user.create({ data: { email, passwordHash: "hashed", role: "OWNER" } });
    const trip = await prisma.trip.create({
      data: {
        userId: user.id,
        name: "Rollback",
        startDate: new Date("2026-10-01T00:00:00.000Z"),
        endDate: new Date("2026-10-01T00:00:00.000Z"),
      },
    });
    const day = await prisma.tripDay.create({
      data: { tripId: trip.id, date: new Date("2026-10-01T00:00:00.000Z"), dayIndex: 1 },
    });
    const a = await prisma.dayPlanItem.create({
      data: { tripId: day.tripId, tripDayId: day.id, title: "A", fromTime: "09:00", toTime: "10:00", contentJson: sampleDoc("A") },
    });
    const b = await prisma.dayPlanItem.create({
      data: { tripId: day.tripId, tripDayId: day.id, title: "B", fromTime: "15:00", toTime: "16:00", contentJson: sampleDoc("B") },
    });
    const leg = await prisma.travelSegment.create({
      data: {
        tripDayId: day.id,
        fromItemType: "DAY_PLAN_ITEM",
        fromItemId: a.id,
        toItemType: "DAY_PLAN_ITEM",
        toItemId: b.id,
        transportType: "CAR",
        durationMinutes: 40,
      },
    });
    return { user, trip, day, a, b, leg };
  };

  it("does not commit a create when the sweep throws", async () => {
    const { user, trip, day, leg } = await seed("rollback-create@example.com");

    await expect(
      createDayPlanItemForTripDay({
        userId: user.id,
        tripId: trip.id,
        tripDayId: day.id,
        title: "M",
        fromTime: "12:00",
        toTime: "13:00",
        contentJson: sampleDoc("M"),
      }),
    ).rejects.toThrow("sweep failed");

    expect(sweep).toHaveBeenCalledTimes(1);
    expect(await prisma.dayPlanItem.count({ where: { title: "M" } })).toBe(0);
    expect(await prisma.travelSegment.findUnique({ where: { id: leg.id } })).toEqual(leg);
  });

  it("does not commit an update when the sweep throws", async () => {
    const { user, trip, day, a } = await seed("rollback-update@example.com");

    await expect(
      updateDayPlanItemForTripDay({
        userId: user.id,
        tripId: trip.id,
        tripDayId: day.id,
        itemId: a.id,
        title: "A moved",
        fromTime: "17:00",
        toTime: "18:00",
        contentJson: sampleDoc("A moved"),
      }),
    ).rejects.toThrow("sweep failed");

    expect(await prisma.dayPlanItem.findUnique({ where: { id: a.id } })).toEqual(a);
  });

  it("does not commit a delete, nor its referencing-leg removal, when the sweep throws", async () => {
    const { user, trip, day, a, leg } = await seed("rollback-delete@example.com");

    await expect(
      deleteDayPlanItemForTripDay({ userId: user.id, tripId: trip.id, tripDayId: day.id, itemId: a.id }),
    ).rejects.toThrow("sweep failed");

    expect(await prisma.dayPlanItem.findUnique({ where: { id: a.id } })).toEqual(a);
    expect(await prisma.travelSegment.findUnique({ where: { id: leg.id } })).toEqual(leg);
  });
});
