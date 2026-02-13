import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { createTripWithDays, deleteTripForUser, getTripWithDaysForUser, updateTripWithDays } from "@/lib/repositories/tripRepo";

const VALID_RANGE = {
  startDate: "2026-04-01T00:00:00.000Z",
  endDate: "2026-04-02T00:00:00.000Z",
};

describe("tripRepo", () => {
  beforeEach(async () => {
    await prisma.tripDay.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
  });

  it("does not create days when trip creation fails", async () => {
    await expect(
      createTripWithDays({
        userId: "missing-user",
        name: "Failing Trip",
        ...VALID_RANGE,
      })
    ).rejects.toBeDefined();

    const tripCount = await prisma.trip.count();
    const dayCount = await prisma.tripDay.count();

    expect(tripCount).toBe(0);
    expect(dayCount).toBe(0);
  });

  it("returns days in ascending dayIndex order", async () => {
    const user = await prisma.user.create({
      data: {
        email: "trip-order@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });

    const trip = await prisma.trip.create({
      data: {
        userId: user.id,
        name: "Ordering Trip",
        startDate: new Date("2026-04-01T00:00:00.000Z"),
        endDate: new Date("2026-04-03T00:00:00.000Z"),
      },
    });

    await prisma.tripDay.createMany({
      data: [
        { tripId: trip.id, date: new Date("2026-04-02T00:00:00.000Z"), dayIndex: 2 },
        { tripId: trip.id, date: new Date("2026-04-01T00:00:00.000Z"), dayIndex: 1 },
        { tripId: trip.id, date: new Date("2026-04-03T00:00:00.000Z"), dayIndex: 3 },
      ],
    });

    const detail = await getTripWithDaysForUser(user.id, trip.id);

    expect(detail).not.toBeNull();
    expect(detail?.days.map((day) => day.dayIndex)).toEqual([1, 2, 3]);
  });

  it("orders days by dayIndex then date", async () => {
    const user = await prisma.user.create({
      data: {
        email: "trip-tiebreaker@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });

    const trip = await prisma.trip.create({
      data: {
        userId: user.id,
        name: "Tie Break Trip",
        startDate: new Date("2026-04-01T00:00:00.000Z"),
        endDate: new Date("2026-04-03T00:00:00.000Z"),
      },
    });

    await prisma.tripDay.createMany({
      data: [
        { tripId: trip.id, date: new Date("2026-04-02T00:00:00.000Z"), dayIndex: 1 },
        { tripId: trip.id, date: new Date("2026-04-01T00:00:00.000Z"), dayIndex: 1 },
        { tripId: trip.id, date: new Date("2026-04-03T00:00:00.000Z"), dayIndex: 2 },
      ],
    });

    const detail = await getTripWithDaysForUser(user.id, trip.id);

    expect(detail).not.toBeNull();
    expect(detail?.days.map((day) => `${day.dayIndex}-${day.date.toISOString()}`)).toEqual([
      "1-2026-04-01T00:00:00.000Z",
      "1-2026-04-02T00:00:00.000Z",
      "2-2026-04-03T00:00:00.000Z",
    ]);
  });

  it("updates trip and adjusts day entries to match new date range", async () => {
    const user = await prisma.user.create({
      data: {
        email: "trip-update@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });

    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Original Trip",
      startDate: "2026-05-01T00:00:00.000Z",
      endDate: "2026-05-03T00:00:00.000Z",
    });

    const updated = await updateTripWithDays({
      userId: user.id,
      tripId: trip.id,
      name: "Updated Trip",
      startDate: "2026-05-02T00:00:00.000Z",
      endDate: "2026-05-04T00:00:00.000Z",
    });

    expect(updated).not.toBeNull();
    expect(updated?.trip.name).toBe("Updated Trip");
    expect(updated?.dayCount).toBe(3);

    const days = await prisma.tripDay.findMany({
      where: { tripId: trip.id },
      orderBy: { dayIndex: "asc" },
    });

    expect(days.map((day) => day.date.toISOString())).toEqual([
      "2026-05-02T00:00:00.000Z",
      "2026-05-03T00:00:00.000Z",
      "2026-05-04T00:00:00.000Z",
    ]);
  });

  it("computes missing accommodation and plan flags per day", async () => {
    const user = await prisma.user.create({
      data: {
        email: "trip-gaps@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });

    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Gap Trip",
      startDate: "2026-09-01T00:00:00.000Z",
      endDate: "2026-09-04T00:00:00.000Z",
    });

    const days = await prisma.tripDay.findMany({
      where: { tripId: trip.id },
      orderBy: { dayIndex: "asc" },
    });

    await prisma.accommodation.create({
      data: { tripDayId: days[0].id },
    });
    await prisma.dayPlanItem.create({
      data: { tripDayId: days[1].id },
    });
    await prisma.accommodation.create({
      data: { tripDayId: days[2].id },
    });
    await prisma.dayPlanItem.create({
      data: { tripDayId: days[2].id },
    });

    const detail = await getTripWithDaysForUser(user.id, trip.id);

    expect(detail).not.toBeNull();
    expect(detail?.days.map((day) => [day.missingAccommodation, day.missingPlan])).toEqual([
      [false, true],
      [true, false],
      [false, false],
      [true, true],
    ]);
  });

  it("deletes trip and associated days for user", async () => {
    const user = await prisma.user.create({
      data: {
        email: "trip-delete@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });

    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Delete Trip",
      startDate: "2026-06-01T00:00:00.000Z",
      endDate: "2026-06-02T00:00:00.000Z",
    });

    const deleted = await deleteTripForUser(user.id, trip.id);
    expect(deleted).toBe(true);

    const tripCount = await prisma.trip.count({ where: { id: trip.id } });
    const dayCount = await prisma.tripDay.count({ where: { tripId: trip.id } });

    expect(tripCount).toBe(0);
    expect(dayCount).toBe(0);
  });
});
