import { prisma } from "@/lib/db/prisma";

export type AccommodationDetail = {
  id: string;
  tripDayId: string;
  name: string;
  notes: string | null;
  status: AccommodationStatus;
  costCents: number | null;
  link: string | null;
};

export type AccommodationStatus = "planned" | "booked";

export type AccommodationUpdateResult =
  | { status: "not_found" }
  | { status: "missing" }
  | { status: "updated"; accommodation: AccommodationDetail };

type AccommodationMutationParams = {
  userId: string;
  tripId: string;
  tripDayId: string;
  name: string;
  status: AccommodationStatus;
  costCents?: number | null;
  link?: string | null;
  notes?: string | null;
};

type AccommodationDeleteParams = {
  userId: string;
  tripId: string;
  tripDayId: string;
};

const findTripDayForUser = async (userId: string, tripId: string, tripDayId: string) =>
  prisma.tripDay.findFirst({
    where: {
      id: tripDayId,
      tripId,
      trip: { userId },
    },
  });

const toStatus = (status: string): AccommodationStatus => (status === "BOOKED" ? "booked" : "planned");
const toDbStatus = (status: AccommodationStatus) => (status === "booked" ? "BOOKED" : "PLANNED");

const toDetail = (accommodation: {
  id: string;
  tripDayId: string;
  name: string;
  notes: string | null;
  status: string;
  costCents: number | null;
  link: string | null;
}) => ({
  id: accommodation.id,
  tripDayId: accommodation.tripDayId,
  name: accommodation.name,
  notes: accommodation.notes,
  status: toStatus(accommodation.status),
  costCents: accommodation.costCents,
  link: accommodation.link,
});

export const createAccommodationForTripDay = async (
  params: AccommodationMutationParams,
): Promise<AccommodationDetail | null> => {
  const { userId, tripId, tripDayId, name, notes } = params;
  const tripDay = await findTripDayForUser(userId, tripId, tripDayId);
  if (!tripDay) {
    return null;
  }

  const { status, costCents, link } = params;
  const accommodation = await prisma.accommodation.upsert({
    where: { tripDayId },
    update: {
      name,
      notes: notes ?? null,
      status: toDbStatus(status),
      costCents: costCents ?? null,
      link: link ?? null,
    },
    create: {
      tripDayId,
      name,
      notes: notes ?? null,
      status: toDbStatus(status),
      costCents: costCents ?? null,
      link: link ?? null,
    },
  });

  return toDetail(accommodation);
};

export const updateAccommodationForTripDay = async (
  params: AccommodationMutationParams,
): Promise<AccommodationUpdateResult> => {
  const { userId, tripId, tripDayId, name, notes } = params;
  const tripDay = await findTripDayForUser(userId, tripId, tripDayId);
  if (!tripDay) {
    return { status: "not_found" };
  }

  const existing = await prisma.accommodation.findUnique({ where: { tripDayId } });
  if (!existing) {
    return { status: "missing" };
  }

  const { status, costCents, link } = params;
  const updated = await prisma.accommodation.update({
    where: { id: existing.id },
    data: {
      name,
      notes: notes ?? null,
      status: toDbStatus(status),
      costCents: costCents ?? null,
      link: link ?? null,
    },
  });

  return { status: "updated", accommodation: toDetail(updated) };
};

export const deleteAccommodationForTripDay = async (params: AccommodationDeleteParams): Promise<boolean> => {
  const { userId, tripId, tripDayId } = params;
  const tripDay = await findTripDayForUser(userId, tripId, tripDayId);
  if (!tripDay) {
    return false;
  }

  const existing = await prisma.accommodation.findUnique({ where: { tripDayId } });
  if (!existing) {
    return true;
  }

  await prisma.accommodation.delete({ where: { id: existing.id } });
  return true;
};

export const getAccommodationCostTotalForTrip = async (
  userId: string,
  tripId: string,
): Promise<number | null> => {
  const result = await prisma.accommodation.aggregate({
    where: {
      costCents: { not: null },
      tripDay: {
        tripId,
        trip: { userId },
      },
    },
    _sum: { costCents: true },
    _count: { costCents: true },
  });

  if (result._count.costCents === 0) {
    return null;
  }

  return result._sum.costCents ?? 0;
};
