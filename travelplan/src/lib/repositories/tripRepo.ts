import { prisma } from "@/lib/db/prisma";
import type { TripImportConflictStrategy, TripImportPayloadInput } from "@/lib/validation/tripImportSchemas";

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
  imageUrl: string | null;
  note: string | null;
  plannedCostSubtotal: number;
  missingAccommodation: boolean;
  missingPlan: boolean;
  accommodation: {
    id: string;
    name: string;
    notes: string | null;
    status: "planned" | "booked";
    costCents: number | null;
    link: string | null;
    location: { lat: number; lng: number; label: string | null } | null;
  } | null;
  dayPlanItems: {
    id: string;
    contentJson: string;
    linkUrl: string | null;
    location: { lat: number; lng: number; label: string | null } | null;
  }[];
};

export type TripWithDays = {
  id: string;
  name: string;
  startDate: Date;
  endDate: Date;
  dayCount: number;
  plannedCostTotal: number;
  accommodationCostTotalCents: number;
  heroImageUrl: string | null;
  days: TripDaySummary[];
};

export type TripExportPayload = {
  trip: {
    id: string;
    name: string;
    startDate: string;
    endDate: string;
    heroImageUrl: string | null;
    createdAt: string;
    updatedAt: string;
  };
  days: {
    id: string;
    date: string;
    dayIndex: number;
    imageUrl: string | null;
    note: string | null;
    createdAt: string;
    updatedAt: string;
    accommodation: {
      id: string;
      name: string;
      notes: string | null;
      status: "planned" | "booked";
      costCents: number | null;
      link: string | null;
      location: { lat: number; lng: number; label: string | null } | null;
      createdAt: string;
      updatedAt: string;
    } | null;
    dayPlanItems: {
      id: string;
      contentJson: string;
      linkUrl: string | null;
      location: { lat: number; lng: number; label: string | null } | null;
      createdAt: string;
      updatedAt: string;
    }[];
  }[];
};

type TripImportConflict = {
  id: string;
  name: string;
};

type ImportTripConflictResult = {
  outcome: "conflict";
  conflicts: TripImportConflict[];
};

type ImportTripSuccessResult = {
  outcome: "imported";
  mode: "overwrite" | "createNew";
  trip: {
    id: string;
    name: string;
    startDate: Date;
    endDate: Date;
    heroImageUrl: string | null;
  };
  dayCount: number;
};

export type ImportTripResult = ImportTripConflictResult | ImportTripSuccessResult;

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
          accommodation: {
            select: {
              id: true,
              name: true,
              notes: true,
              status: true,
              costCents: true,
              link: true,
              locationLat: true,
              locationLng: true,
              locationLabel: true,
            },
          },
          dayPlanItems: {
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              contentJson: true,
              linkUrl: true,
              locationLat: true,
              locationLng: true,
              locationLabel: true,
            },
          },
          _count: { select: { dayPlanItems: true } },
        },
      },
      _count: { select: { days: true } },
    },
  });

  if (!trip) {
    return null;
  }

  const dayMetaRows = await prisma.$queryRawUnsafe<
    {
      id: string;
      image_url: string | null;
      note: string | null;
    }[]
  >(`SELECT "id", "image_url", "note" FROM "trip_days" WHERE "trip_id" = ?`, trip.id);
  const dayMetaById = new Map(dayMetaRows.map((row) => [row.id, row]));

  const getVisibleAccommodationCost = (day: (typeof trip.days)[number]) => {
    const accommodationName = day.accommodation?.name?.trim() ?? "";
    if (!accommodationName) return 0;
    return day.accommodation?.costCents ?? 0;
  };

  const plannedCostTotal = trip.days.reduce((sum, day) => sum + getVisibleAccommodationCost(day), 0);

  return {
    id: trip.id,
    name: trip.name,
    startDate: trip.startDate,
    endDate: trip.endDate,
    dayCount: trip._count.days,
    plannedCostTotal,
    accommodationCostTotalCents: plannedCostTotal,
    heroImageUrl: trip.heroImageUrl,
    days: trip.days.map((day) => {
      const accommodationName = day.accommodation?.name?.trim() ?? "";
      const hasAccommodation = accommodationName.length > 0;
      const status = day.accommodation?.status === "BOOKED" ? "booked" : "planned";
      const dayMeta = dayMetaById.get(day.id);

      return {
        id: day.id,
        date: day.date,
        dayIndex: day.dayIndex,
        imageUrl: dayMeta?.image_url ?? day.imageUrl ?? null,
        note: dayMeta?.note ?? day.note ?? null,
        plannedCostSubtotal: getVisibleAccommodationCost(day),
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
              location:
                day.accommodation!.locationLat !== null && day.accommodation!.locationLng !== null
                  ? {
                      lat: day.accommodation!.locationLat,
                      lng: day.accommodation!.locationLng,
                      label: day.accommodation!.locationLabel,
                    }
                  : null,
            }
          : null,
        dayPlanItems: day.dayPlanItems.map((item) => ({
          id: item.id,
          contentJson: item.contentJson,
          linkUrl: item.linkUrl,
          location:
            item.locationLat !== null && item.locationLng !== null
              ? {
                  lat: item.locationLat,
                  lng: item.locationLng,
                  label: item.locationLabel,
                }
              : null,
        })),
      };
    }),
  };
};

export const updateTripDayImageForUser = async ({
  userId,
  tripId,
  dayId,
  imageUrl,
  note,
}: {
  userId: string;
  tripId: string;
  dayId: string;
  imageUrl?: string | null;
  note?: string | null;
}) => {
  const day = await prisma.tripDay.findFirst({
    where: {
      id: dayId,
      tripId,
      trip: { userId },
    },
    select: { id: true },
  });

  if (!day) {
    return null;
  }

  const setClauses: string[] = [];
  const setValues: Array<string | null> = [];

  if (imageUrl !== undefined) {
    setClauses.push(`"image_url" = ?`);
    setValues.push(imageUrl);
  }
  if (note !== undefined) {
    setClauses.push(`"note" = ?`);
    setValues.push(note);
  }

  if (setClauses.length > 0) {
    setClauses.push(`"updated_at" = CURRENT_TIMESTAMP`);
    await prisma.$executeRawUnsafe(
      `UPDATE "trip_days" SET ${setClauses.join(", ")} WHERE "id" = ?`,
      ...setValues,
      day.id,
    );
  }

  const rows = await prisma.$queryRawUnsafe<
    {
      id: string;
      trip_id: string;
      image_url: string | null;
      note: string | null;
      updated_at: Date | string;
    }[]
  >(`SELECT "id", "trip_id", "image_url", "note", "updated_at" FROM "trip_days" WHERE "id" = ? LIMIT 1`, day.id);

  const row = rows[0];
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    tripId: row.trip_id,
    imageUrl: row.image_url,
    note: row.note,
    updatedAt: row.updated_at instanceof Date ? row.updated_at : new Date(row.updated_at),
  };
};

export const getTripExportForUser = async (userId: string, tripId: string): Promise<TripExportPayload | null> => {
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, userId },
    include: {
      days: {
        orderBy: [{ dayIndex: "asc" }, { date: "asc" }],
        include: {
          accommodation: {
            select: {
              id: true,
              name: true,
              notes: true,
              status: true,
              costCents: true,
              link: true,
              locationLat: true,
              locationLng: true,
              locationLabel: true,
              createdAt: true,
              updatedAt: true,
            },
          },
          dayPlanItems: {
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            select: {
              id: true,
              contentJson: true,
              linkUrl: true,
              locationLat: true,
              locationLng: true,
              locationLabel: true,
              createdAt: true,
              updatedAt: true,
            },
          },
        },
      },
    },
  });

  if (!trip) {
    return null;
  }

  return {
    trip: {
      id: trip.id,
      name: trip.name,
      startDate: trip.startDate.toISOString(),
      endDate: trip.endDate.toISOString(),
      heroImageUrl: trip.heroImageUrl,
      createdAt: trip.createdAt.toISOString(),
      updatedAt: trip.updatedAt.toISOString(),
    },
    days: trip.days.map((day) => ({
      id: day.id,
      date: day.date.toISOString(),
      dayIndex: day.dayIndex,
      imageUrl: day.imageUrl,
      note: day.note,
      createdAt: day.createdAt.toISOString(),
      updatedAt: day.updatedAt.toISOString(),
      accommodation: day.accommodation
        ? {
            id: day.accommodation.id,
            name: day.accommodation.name,
            notes: day.accommodation.notes,
            status: day.accommodation.status === "BOOKED" ? "booked" : "planned",
            costCents: day.accommodation.costCents,
            link: day.accommodation.link,
            location:
              day.accommodation.locationLat !== null && day.accommodation.locationLng !== null
                ? {
                    lat: day.accommodation.locationLat,
                    lng: day.accommodation.locationLng,
                    label: day.accommodation.locationLabel,
                  }
                : null,
            createdAt: day.accommodation.createdAt.toISOString(),
            updatedAt: day.accommodation.updatedAt.toISOString(),
          }
        : null,
      dayPlanItems: day.dayPlanItems.map((item) => ({
        id: item.id,
        contentJson: item.contentJson,
        linkUrl: item.linkUrl,
        location:
          item.locationLat !== null && item.locationLng !== null
            ? {
                lat: item.locationLat,
                lng: item.locationLng,
                label: item.locationLabel,
              }
            : null,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      })),
    })),
  };
};

const toAccommodationStatus = (status: "planned" | "booked") => (status === "booked" ? "BOOKED" : "PLANNED");

const sortImportDays = (days: TripImportPayloadInput["days"]) =>
  [...days].sort((left, right) => {
    if (left.dayIndex !== right.dayIndex) return left.dayIndex - right.dayIndex;
    return new Date(left.date).getTime() - new Date(right.date).getTime();
  });

const createImportedDays = async ({
  tx,
  tripId,
  sortedDays,
}: {
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
  tripId: string;
  sortedDays: TripImportPayloadInput["days"];
}) => {
  for (const day of sortedDays) {
    const createdDay = await tx.tripDay.create({
      data: {
        tripId,
        date: new Date(day.date),
        dayIndex: day.dayIndex,
        imageUrl: day.imageUrl ?? null,
        note: day.note ?? null,
      },
    });

    if (day.accommodation) {
      await tx.accommodation.create({
        data: {
          tripDayId: createdDay.id,
          name: day.accommodation.name,
          notes: day.accommodation.notes,
          status: toAccommodationStatus(day.accommodation.status),
          costCents: day.accommodation.costCents,
          link: day.accommodation.link,
          locationLat: day.accommodation.location?.lat ?? null,
          locationLng: day.accommodation.location?.lng ?? null,
          locationLabel: day.accommodation.location?.label ?? null,
        },
      });
    }

    for (const item of day.dayPlanItems) {
      await tx.dayPlanItem.create({
        data: {
          tripDayId: createdDay.id,
          contentJson: item.contentJson,
          linkUrl: item.linkUrl,
          locationLat: item.location?.lat ?? null,
          locationLng: item.location?.lng ?? null,
          locationLabel: item.location?.label ?? null,
        },
      });
    }
  }
};

export const importTripFromExportForUser = async ({
  userId,
  payload,
  strategy,
  targetTripId,
}: {
  userId: string;
  payload: TripImportPayloadInput;
  strategy?: TripImportConflictStrategy;
  targetTripId?: string;
}): Promise<ImportTripResult> => {
  const sameNameTrips = await prisma.trip.findMany({
    where: {
      userId,
      name: payload.trip.name,
    },
    select: {
      id: true,
      name: true,
    },
    orderBy: [{ createdAt: "asc" }],
  });

  if (!strategy && sameNameTrips.length > 0) {
    return {
      outcome: "conflict",
      conflicts: sameNameTrips,
    };
  }

  const sortedDays = sortImportDays(payload.days);

  if (strategy === "overwrite") {
    if (!targetTripId) {
      throw new Error("target_trip_required");
    }
    if (!sameNameTrips.some((trip) => trip.id === targetTripId)) {
      throw new Error("target_trip_not_conflict");
    }

    return prisma.$transaction(async (tx) => {
      const targetTrip = await tx.trip.findFirst({
        where: {
          id: targetTripId,
          userId,
        },
      });

      if (!targetTrip) {
        throw new Error("target_trip_not_found");
      }

      const updatedTrip = await tx.trip.update({
        where: { id: targetTrip.id },
        data: {
          name: payload.trip.name,
          startDate: new Date(payload.trip.startDate),
          endDate: new Date(payload.trip.endDate),
          heroImageUrl: payload.trip.heroImageUrl,
        },
      });

      await tx.tripDay.deleteMany({ where: { tripId: targetTrip.id } });
      await createImportedDays({
        tx,
        tripId: targetTrip.id,
        sortedDays,
      });

      return {
        outcome: "imported",
        mode: "overwrite",
        trip: {
          id: updatedTrip.id,
          name: updatedTrip.name,
          startDate: updatedTrip.startDate,
          endDate: updatedTrip.endDate,
          heroImageUrl: updatedTrip.heroImageUrl,
        },
        dayCount: sortedDays.length,
      };
    });
  }

  return prisma.$transaction(async (tx) => {
    const createdTrip = await tx.trip.create({
      data: {
        userId,
        name: payload.trip.name,
        startDate: new Date(payload.trip.startDate),
        endDate: new Date(payload.trip.endDate),
        heroImageUrl: payload.trip.heroImageUrl,
      },
    });

    await createImportedDays({
      tx,
      tripId: createdTrip.id,
      sortedDays,
    });

    return {
      outcome: "imported",
      mode: "createNew",
      trip: {
        id: createdTrip.id,
        name: createdTrip.name,
        startDate: createdTrip.startDate,
        endDate: createdTrip.endDate,
        heroImageUrl: createdTrip.heroImageUrl,
      },
      dayCount: sortedDays.length,
    };
  });
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

export const getTripDayByIdForUser = async ({
  userId,
  tripId,
  dayId,
}: {
  userId: string;
  tripId: string;
  dayId: string;
}) =>
  prisma.tripDay.findFirst({
    where: {
      id: dayId,
      tripId,
      trip: { userId },
    },
    select: { id: true, tripId: true },
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
