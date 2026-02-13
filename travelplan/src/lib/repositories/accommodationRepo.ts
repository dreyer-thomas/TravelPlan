import { prisma } from "@/lib/db/prisma";

export type AccommodationDetail = {
  id: string;
  tripDayId: string;
  name: string;
  notes: string | null;
};

export type AccommodationUpdateResult =
  | { status: "not_found" }
  | { status: "missing" }
  | { status: "updated"; accommodation: AccommodationDetail };

type AccommodationMutationParams = {
  userId: string;
  tripId: string;
  tripDayId: string;
  name: string;
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

const toDetail = (accommodation: { id: string; tripDayId: string; name: string; notes: string | null }) => ({
  id: accommodation.id,
  tripDayId: accommodation.tripDayId,
  name: accommodation.name,
  notes: accommodation.notes,
});

export const createAccommodationForTripDay = async (
  params: AccommodationMutationParams,
): Promise<AccommodationDetail | null> => {
  const { userId, tripId, tripDayId, name, notes } = params;
  const tripDay = await findTripDayForUser(userId, tripId, tripDayId);
  if (!tripDay) {
    return null;
  }

  const accommodation = await prisma.accommodation.upsert({
    where: { tripDayId },
    update: {
      name,
      notes: notes ?? null,
    },
    create: {
      tripDayId,
      name,
      notes: notes ?? null,
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

  const updated = await prisma.accommodation.update({
    where: { id: existing.id },
    data: {
      name,
      notes: notes ?? null,
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
