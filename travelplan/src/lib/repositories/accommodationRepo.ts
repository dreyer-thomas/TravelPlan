import { prisma } from "@/lib/db/prisma";

export type AccommodationDetail = {
  id: string;
  tripDayId: string;
  name: string;
  notes: string | null;
  status: AccommodationStatus;
  costCents: number | null;
  link: string | null;
  checkInTime: string | null;
  checkOutTime: string | null;
  location: { lat: number; lng: number; label: string | null } | null;
};

export type AccommodationStatus = "planned" | "booked";

export type AccommodationUpdateResult =
  | { status: "not_found" }
  | { status: "missing" }
  | { status: "updated"; accommodation: AccommodationDetail };

export type AccommodationCopyResult =
  | { status: "not_found" }
  | { status: "missing" }
  | { status: "copied"; accommodation: AccommodationDetail };

type AccommodationMutationParams = {
  userId: string;
  tripId: string;
  tripDayId: string;
  name: string;
  status: AccommodationStatus;
  costCents?: number | null;
  link?: string | null;
  notes?: string | null;
  checkInTime?: string | null;
  checkOutTime?: string | null;
  location?: { lat: number; lng: number; label?: string | null } | null;
};

type AccommodationDeleteParams = {
  userId: string;
  tripId: string;
  tripDayId: string;
};

export type AccommodationImageDetail = {
  id: string;
  accommodationId: string;
  imageUrl: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

type AccommodationImageScopeParams = {
  userId: string;
  tripId: string;
  tripDayId: string;
  accommodationId: string;
};

type AccommodationImageCreateParams = AccommodationImageScopeParams & {
  imageUrl: string;
};

type AccommodationImageDeleteParams = AccommodationImageScopeParams & {
  imageId: string;
};

type AccommodationImageReorderParams = AccommodationImageScopeParams & {
  order: { imageId: string; sortOrder: number }[];
};

export type AccommodationImageDeleteResult =
  | { status: "not_found" }
  | { status: "missing" }
  | { status: "deleted" };

export type AccommodationImageReorderResult =
  | { status: "not_found" }
  | { status: "missing" }
  | { status: "reordered" };

const findTripDayForUser = async (userId: string, tripId: string, tripDayId: string) =>
  prisma.tripDay.findFirst({
    where: {
      id: tripDayId,
      tripId,
      trip: { userId },
    },
  });

const findScopedAccommodation = async ({ userId, tripId, tripDayId, accommodationId }: AccommodationImageScopeParams) =>
  prisma.accommodation.findFirst({
    where: {
      id: accommodationId,
      tripDayId,
      tripDay: {
        id: tripDayId,
        tripId,
        trip: { userId },
      },
    },
    select: { id: true },
  });

const toImageDetail = (image: {
  id: string;
  accommodationId: string;
  imageUrl: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}): AccommodationImageDetail => ({
  id: image.id,
  accommodationId: image.accommodationId,
  imageUrl: image.imageUrl,
  sortOrder: image.sortOrder,
  createdAt: image.createdAt,
  updatedAt: image.updatedAt,
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
  locationLat: number | null;
  locationLng: number | null;
  locationLabel: string | null;
  checkInTime: string | null;
  checkOutTime: string | null;
}) => ({
  id: accommodation.id,
  tripDayId: accommodation.tripDayId,
  name: accommodation.name,
  notes: accommodation.notes,
  status: toStatus(accommodation.status),
  costCents: accommodation.costCents,
  link: accommodation.link,
  checkInTime: accommodation.checkInTime,
  checkOutTime: accommodation.checkOutTime,
  location:
    accommodation.locationLat !== null && accommodation.locationLng !== null
      ? {
          lat: accommodation.locationLat,
          lng: accommodation.locationLng,
          label: accommodation.locationLabel,
        }
      : null,
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
  const checkInTime = params.checkInTime ?? null;
  const checkOutTime = params.checkOutTime ?? null;
  const location = params.location ?? null;
  const accommodation = await prisma.accommodation.upsert({
    where: { tripDayId },
    update: {
      name,
      notes: notes ?? null,
      status: toDbStatus(status),
      costCents: costCents ?? null,
      link: link ?? null,
      checkInTime,
      checkOutTime,
      locationLat: location?.lat ?? null,
      locationLng: location?.lng ?? null,
      locationLabel: location?.label?.trim() || null,
    },
    create: {
      tripDayId,
      name,
      notes: notes ?? null,
      status: toDbStatus(status),
      costCents: costCents ?? null,
      link: link ?? null,
      checkInTime,
      checkOutTime,
      locationLat: location?.lat ?? null,
      locationLng: location?.lng ?? null,
      locationLabel: location?.label?.trim() || null,
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
  const location = params.location ?? null;
  const data = {
    name,
    notes: notes ?? null,
    status: toDbStatus(status),
    costCents: costCents ?? null,
    link: link ?? null,
    locationLat: location?.lat ?? null,
    locationLng: location?.lng ?? null,
    locationLabel: location?.label?.trim() || null,
  } as {
    name: string;
    notes: string | null;
    status: "PLANNED" | "BOOKED";
    costCents: number | null;
    link: string | null;
    locationLat: number | null;
    locationLng: number | null;
    locationLabel: string | null;
    checkInTime?: string | null;
    checkOutTime?: string | null;
  };

  if (params.checkInTime !== undefined) {
    data.checkInTime = params.checkInTime;
  }
  if (params.checkOutTime !== undefined) {
    data.checkOutTime = params.checkOutTime;
  }

  const updated = await prisma.accommodation.update({
    where: { id: existing.id },
    data,
  });

  return { status: "updated", accommodation: toDetail(updated) };
};

export const copyAccommodationFromPreviousNight = async (params: {
  userId: string;
  tripId: string;
  tripDayId: string;
}): Promise<AccommodationCopyResult> => {
  const { userId, tripId, tripDayId } = params;
  const currentDay = await prisma.tripDay.findFirst({
    where: {
      id: tripDayId,
      tripId,
      trip: { userId },
    },
    select: { id: true, dayIndex: true },
  });

  if (!currentDay) {
    return { status: "not_found" };
  }

  const previousDayIndex = currentDay.dayIndex - 1;
  if (previousDayIndex < 0) {
    return { status: "missing" };
  }

  const previousDay = await prisma.tripDay.findFirst({
    where: {
      tripId,
      dayIndex: previousDayIndex,
      trip: { userId },
    },
    select: { id: true },
  });

  if (!previousDay) {
    return { status: "missing" };
  }

  const previousAccommodation = await prisma.accommodation.findUnique({
    where: { tripDayId: previousDay.id },
  });

  if (!previousAccommodation) {
    return { status: "missing" };
  }

  const data = {
    name: previousAccommodation.name,
    notes: previousAccommodation.notes,
    status: previousAccommodation.status,
    costCents: null,
    link: previousAccommodation.link,
    checkInTime: previousAccommodation.checkInTime,
    checkOutTime: previousAccommodation.checkOutTime,
    locationLat: previousAccommodation.locationLat,
    locationLng: previousAccommodation.locationLng,
    locationLabel: previousAccommodation.locationLabel,
  };

  const nextAccommodation = await prisma.accommodation.upsert({
    where: { tripDayId: currentDay.id },
    update: data,
    create: { tripDayId: currentDay.id, ...data },
  });

  return { status: "copied", accommodation: toDetail(nextAccommodation) };
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

export const listAccommodationImages = async (
  params: AccommodationImageScopeParams,
): Promise<AccommodationImageDetail[] | null> => {
  const accommodation = await findScopedAccommodation(params);
  if (!accommodation) {
    return null;
  }

  const images = await prisma.accommodationImage.findMany({
    where: { accommodationId: accommodation.id },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });

  return images.map(toImageDetail);
};

export const createAccommodationImage = async (
  params: AccommodationImageCreateParams,
): Promise<AccommodationImageDetail | null> => {
  const accommodation = await findScopedAccommodation(params);
  if (!accommodation) {
    return null;
  }

  const last = await prisma.accommodationImage.findFirst({
    where: { accommodationId: accommodation.id },
    orderBy: [{ sortOrder: "desc" }],
    select: { sortOrder: true },
  });
  const nextSortOrder = (last?.sortOrder ?? 0) + 1;

  const created = await prisma.accommodationImage.create({
    data: {
      accommodationId: accommodation.id,
      imageUrl: params.imageUrl,
      sortOrder: nextSortOrder,
    },
  });

  return toImageDetail(created);
};

export const deleteAccommodationImage = async (
  params: AccommodationImageDeleteParams,
): Promise<AccommodationImageDeleteResult> => {
  const accommodation = await findScopedAccommodation(params);
  if (!accommodation) {
    return { status: "not_found" };
  }

  const existing = await prisma.accommodationImage.findFirst({
    where: {
      id: params.imageId,
      accommodationId: accommodation.id,
    },
    select: { id: true },
  });

  if (!existing) {
    return { status: "missing" };
  }

  await prisma.accommodationImage.delete({ where: { id: existing.id } });
  return { status: "deleted" };
};

export const reorderAccommodationImages = async (
  params: AccommodationImageReorderParams,
): Promise<AccommodationImageReorderResult> => {
  const accommodation = await findScopedAccommodation(params);
  if (!accommodation) {
    return { status: "not_found" };
  }

  const existing = await prisma.accommodationImage.findMany({
    where: { accommodationId: accommodation.id },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((item) => item.id));
  const orderIds = new Set(params.order.map((item) => item.imageId));

  if (
    existing.length !== params.order.length ||
    orderIds.size !== params.order.length ||
    [...orderIds].some((id) => !existingIds.has(id))
  ) {
    return { status: "missing" };
  }

  await prisma.$transaction(async (tx) => {
    for (const item of params.order) {
      await tx.accommodationImage.update({
        where: { id: item.imageId },
        data: { sortOrder: item.sortOrder + 1000 },
      });
    }

    for (const item of params.order) {
      await tx.accommodationImage.update({
        where: { id: item.imageId },
        data: { sortOrder: item.sortOrder },
      });
    }
  });

  return { status: "reordered" };
};
