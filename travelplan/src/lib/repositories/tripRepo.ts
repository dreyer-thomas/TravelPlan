import { prisma } from "@/lib/db/prisma";
import { getAccommodationCostTotalForTrip } from "@/lib/repositories/accommodationRepo";

export type CreateTripParams = {
  userId: string;
  name: string;
  startDate: string;
  endDate: string;
};

export type TripSummary = {
  id: string;
  name: string;
  startDate: Date;
  endDate: Date;
  dayCount: number;
  heroImageUrl: string | null;
};

export type TripHeroSummary = {
  id: string;
  name: string;
  startDate: Date;
  endDate: Date;
  dayCount: number;
  heroImageUrl: string | null;
};

export type TripDaySummary = {
  id: string;
  date: Date;
  dayIndex: number;
  missingAccommodation: boolean;
  missingPlan: boolean;
  accommodation: {
    id: string;
    name: string;
    notes: string | null;
    status: "planned" | "booked";
    costCents: number | null;
    link: string | null;
  } | null;
};

export type TripWithDays = {
  id: string;
  name: string;
  startDate: Date;
  endDate: Date;
  dayCount: number;
  accommodationCostTotalCents: number | null;
  heroImageUrl: string | null;
  days: TripDaySummary[];
};

const normalizeToUtcDate = (date: Date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

const toDateKey = (date: Date) => date.toISOString().slice(0, 10);

const buildTripDays = (start: Date, end: Date) => {
  const days: { date: Date; dayIndex: number }[] = [];
  const cursor = new Date(start);
  let index = 1;

  while (cursor.getTime() <= end.getTime()) {
    days.push({ date: new Date(cursor), dayIndex: index });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    index += 1;
  }

  return days;
};

export const createTripWithDays = async ({ userId, name, startDate, endDate }: CreateTripParams) => {
  const normalizedStart = normalizeToUtcDate(new Date(startDate));
  const normalizedEnd = normalizeToUtcDate(new Date(endDate));

  return prisma.$transaction(async (tx) => {
    const trip = await tx.trip.create({
      data: {
        userId,
        name,
        startDate: normalizedStart,
        endDate: normalizedEnd,
      },
    });

    const days = buildTripDays(normalizedStart, normalizedEnd).map((day) => ({
      tripId: trip.id,
      date: day.date,
      dayIndex: day.dayIndex,
    }));

    const created = await tx.tripDay.createMany({ data: days });

    return { trip, dayCount: created.count };
  });
};

export const listTripsForUser = async (userId: string): Promise<TripSummary[]> => {
  const trips = await prisma.trip.findMany({
    where: { userId },
    orderBy: { startDate: "asc" },
    include: { _count: { select: { days: true } } },
  });

  return trips.map((trip) => ({
    id: trip.id,
    name: trip.name,
    startDate: trip.startDate,
    endDate: trip.endDate,
    dayCount: trip._count.days,
    heroImageUrl: trip.heroImageUrl,
  }));
};

export type UpdateTripParams = {
  userId: string;
  tripId: string;
  name: string;
  startDate: string;
  endDate: string;
};

export const updateTripWithDays = async ({ userId, tripId, name, startDate, endDate }: UpdateTripParams) => {
  const normalizedStart = normalizeToUtcDate(new Date(startDate));
  const normalizedEnd = normalizeToUtcDate(new Date(endDate));

  return prisma.$transaction(async (tx) => {
    const trip = await tx.trip.findFirst({
      where: { id: tripId, userId },
      include: { days: true },
    });

    if (!trip) {
      return null;
    }

    const newDays = buildTripDays(normalizedStart, normalizedEnd);
    const existingByDate = new Map(trip.days.map((day) => [toDateKey(day.date), day]));
    const retainedDayIds = new Set<string>();

    for (const day of newDays) {
      const existing = existingByDate.get(toDateKey(day.date));
      if (existing) {
        retainedDayIds.add(existing.id);
        if (existing.dayIndex !== day.dayIndex || existing.date.getTime() !== day.date.getTime()) {
          await tx.tripDay.update({
            where: { id: existing.id },
            data: { date: day.date, dayIndex: day.dayIndex },
          });
        }
      } else {
        await tx.tripDay.create({
          data: {
            tripId: trip.id,
            date: day.date,
            dayIndex: day.dayIndex,
          },
        });
      }
    }

    const staleIds = trip.days.filter((day) => !retainedDayIds.has(day.id)).map((day) => day.id);
    if (staleIds.length > 0) {
      await tx.tripDay.deleteMany({ where: { id: { in: staleIds } } });
    }

    const updatedTrip = await tx.trip.update({
      where: { id: trip.id },
      data: { name, startDate: normalizedStart, endDate: normalizedEnd },
    });

    const dayCount = await tx.tripDay.count({ where: { tripId: trip.id } });

    return { trip: updatedTrip, dayCount };
  });
};

export const getTripWithDaysForUser = async (userId: string, tripId: string): Promise<TripWithDays | null> => {
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, userId },
    include: {
      days: {
        orderBy: [{ dayIndex: "asc" }, { date: "asc" }],
        include: {
          accommodation: { select: { id: true, name: true, notes: true, status: true, costCents: true, link: true } },
          _count: { select: { dayPlanItems: true } },
        },
      },
      _count: { select: { days: true } },
    },
  });

  if (!trip) {
    return null;
  }

  const accommodationCostTotalCents = await getAccommodationCostTotalForTrip(userId, tripId);

  return {
    id: trip.id,
    name: trip.name,
    startDate: trip.startDate,
    endDate: trip.endDate,
    dayCount: trip._count.days,
    accommodationCostTotalCents,
    heroImageUrl: trip.heroImageUrl,
    days: trip.days.map((day) => {
      const accommodationName = day.accommodation?.name?.trim() ?? "";
      const hasAccommodation = accommodationName.length > 0;
      const status = day.accommodation?.status === "BOOKED" ? "booked" : "planned";

      return {
        id: day.id,
        date: day.date,
        dayIndex: day.dayIndex,
        missingAccommodation: !hasAccommodation,
        missingPlan: day._count.dayPlanItems === 0,
        accommodation: hasAccommodation
          ? {
              id: day.accommodation!.id,
              name: accommodationName,
              notes: day.accommodation!.notes,
              status,
              costCents: day.accommodation!.costCents,
              link: day.accommodation!.link,
            }
          : null,
      };
    }),
  };
};

export const deleteTripForUser = async (userId: string, tripId: string) => {
  const result = await prisma.trip.deleteMany({
    where: { id: tripId, userId },
  });

  return result.count > 0;
};

export const getTripByIdForUser = async (userId: string, tripId: string) =>
  prisma.trip.findFirst({
    where: { id: tripId, userId },
    select: { id: true },
  });

export const updateTripHeroImageForUser = async ({
  userId,
  tripId,
  heroImageUrl,
}: {
  userId: string;
  tripId: string;
  heroImageUrl: string | null;
}): Promise<TripHeroSummary | null> =>
  prisma.$transaction(async (tx) => {
    const trip = await tx.trip.findFirst({
      where: { id: tripId, userId },
      include: { _count: { select: { days: true } } },
    });

    if (!trip) {
      return null;
    }

    const updated = await tx.trip.update({
      where: { id: trip.id },
      data: { heroImageUrl },
    });

    return {
      id: updated.id,
      name: updated.name,
      startDate: updated.startDate,
      endDate: updated.endDate,
      dayCount: trip._count.days,
      heroImageUrl: updated.heroImageUrl,
    };
  });
