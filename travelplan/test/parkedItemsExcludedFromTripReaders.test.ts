import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import {
  createTripWithDays,
  getDayRoutePointsForUser,
  getDaySuggestionContextForUser,
  getTripDayPrintPayloadForUser,
  getTripWithDaysForUser,
  listTripsForUser,
} from "@/lib/repositories/tripRepo";
import { parkedDayPlanItemsWhere, plannedDayPlanItemsWhere } from "@/lib/repositories/dayPlanItemRepo";

/**
 * Story 14.1 AC3. A parked activity (`tripDayId = null`) is the bucket list's and nobody else's. Every
 * trip-level reader reaches activities through the day, so none of them was changed for 14.1; this test
 * is what proves they do not leak. Each reader's whole result is serialised and searched for the parked
 * row's id and title, so a new field that starts carrying it fails here without naming it in advance.
 *
 * The overview map and the gantt are drawn on the client from `getTripWithDaysForUser`'s days, and the
 * document packet is built from the day's print payload (`documents/packet/route.ts`), so those readers
 * cover them.
 */
describe("parked activities are excluded from every trip-level reader (Story 14.1 AC3)", () => {
  let counter = 0;

  beforeEach(async () => {
    await prisma.dayPlanItem.deleteMany();
    await prisma.tripDay.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
  });

  const PARKED_TITLE = "Geparkte Gletscherwanderung";

  const seed = async () => {
    const user = await prisma.user.create({
      data: { email: `parked-readers-${Date.now()}-${counter++}@example.com`, passwordHash: "hashed", role: "OWNER" },
    });
    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Island",
      startDate: "2026-08-01T00:00:00.000Z",
      endDate: "2026-08-02T00:00:00.000Z",
    });
    const days = await prisma.tripDay.findMany({ where: { tripId: trip.id }, orderBy: { dayIndex: "asc" } });
    const planned = await prisma.dayPlanItem.create({
      data: {
        tripId: trip.id,
        tripDayId: days[0].id,
        title: "Geplanter Wasserfall",
        fromTime: "10:00",
        toTime: "11:00",
        contentJson: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }] }),
        costCents: 1000,
        locationLat: 64.0,
        locationLng: -21.0,
        locationLabel: "Seljalandsfoss",
      },
    });
    await prisma.costPayment.create({
      data: { dayPlanItemId: planned.id, amountCents: 1000, dueDate: "2026-08-01", sortOrder: 0 },
    });
    const parked = await prisma.dayPlanItem.create({
      data: {
        tripId: trip.id,
        tripDayId: null,
        title: PARKED_TITLE,
        scheduleMode: "FLEXIBLE",
        durationMinutes: 120,
        contentJson: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "y" }] }] }),
        costCents: 2500,
        locationLat: 64.3271,
        locationLng: -20.1199,
        locationLabel: "Gullfoss",
      },
    });
    await prisma.costPayment.create({
      data: { dayPlanItemId: parked.id, amountCents: 2500, dueDate: "2026-08-01", sortOrder: 0 },
    });
    await prisma.dayPlanItemImage.create({
      data: {
        dayPlanItemId: parked.id,
        imageUrl: `/uploads/trips/${trip.id}/parked/day-plan-items/${parked.id}/a.webp`,
        sortOrder: 1,
      },
    });
    return { user, trip, days, planned, parked };
  };

  const expectNoParked = (value: unknown, parked: { id: string }) => {
    const json = JSON.stringify(value);
    expect(json).not.toContain(parked.id);
    expect(json).not.toContain(PARKED_TITLE);
    expect(json).not.toContain("Gullfoss");
  };

  it("leaves the parked activity out of the trip with its days and its cost totals", async () => {
    const { user, trip, planned, parked } = await seed();
    const detail = await getTripWithDaysForUser(user.id, trip.id);
    expect(detail).not.toBeNull();
    expectNoParked(detail, parked);
    expect(detail!.plannedCostTotal).toBe(1000);
    expect(JSON.stringify(detail)).toContain(planned.id);
  });

  it("leaves it out of the dashboard aggregate", async () => {
    const { user, parked } = await seed();
    const page = await listTripsForUser(user.id);
    expectNoParked(page, parked);
    const [summary] = page.trips;
    expect(summary.plannedCostTotal).toBe(1000);
    expect(summary.planItemCount).toBe(1);
  });

  it("leaves it out of the day's route points, print payload (and packet) and suggestion context", async () => {
    const { user, trip, days, parked } = await seed();
    for (const day of days) {
      const route = await getDayRoutePointsForUser({ userId: user.id, tripId: trip.id, dayId: day.id });
      expectNoParked(route, parked);
      const print = await getTripDayPrintPayloadForUser({ userId: user.id, tripId: trip.id, dayId: day.id });
      expect(print).not.toBeNull();
      expectNoParked(print, parked);
      const context = await getDaySuggestionContextForUser({ userId: user.id, tripId: trip.id, dayId: day.id });
      expectNoParked(context, parked);
    }
  });

  it("names each side through the two predicates", async () => {
    const { trip, planned, parked } = await seed();
    const parkedRows = await prisma.dayPlanItem.findMany({ where: parkedDayPlanItemsWhere(trip.id), select: { id: true } });
    const plannedRows = await prisma.dayPlanItem.findMany({ where: plannedDayPlanItemsWhere(trip.id), select: { id: true } });
    expect(parkedRows).toEqual([{ id: parked.id }]);
    expect(plannedRows).toEqual([{ id: planned.id }]);
  });
});
