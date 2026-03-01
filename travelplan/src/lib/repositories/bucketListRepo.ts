import { prisma } from "@/lib/db/prisma";

export type BucketListItemDetail = {
  id: string;
  tripId: string;
  title: string;
  description: string | null;
  positionText: string | null;
  location: { lat: number; lng: number; label: string | null } | null;
  createdAt: Date;
  updatedAt: Date;
};

export type BucketListItemUpdateResult =
  | { status: "not_found" }
  | { status: "missing" }
  | { status: "updated"; item: BucketListItemDetail };

export type BucketListItemDeleteResult =
  | { status: "not_found" }
  | { status: "missing" }
  | { status: "deleted" };

type BucketListItemCreateParams = {
  userId: string;
  tripId: string;
  title: string;
  description?: string | null;
  positionText?: string | null;
  location?: { lat: number; lng: number; label?: string | null } | null;
};

type BucketListItemUpdateParams = BucketListItemCreateParams & { itemId: string };

type BucketListItemDeleteParams = {
  userId: string;
  tripId: string;
  itemId: string;
};

const findTripForUser = async (userId: string, tripId: string) =>
  prisma.trip.findFirst({
    where: { id: tripId, userId },
    select: { id: true },
  });

const cleanOptionalString = (value?: string | null) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

const toDetail = (item: {
  id: string;
  tripId: string;
  title: string;
  description: string | null;
  positionText: string | null;
  locationLat: number | null;
  locationLng: number | null;
  locationLabel: string | null;
  createdAt: Date;
  updatedAt: Date;
}): BucketListItemDetail => ({
  id: item.id,
  tripId: item.tripId,
  title: item.title,
  description: item.description,
  positionText: item.positionText,
  location:
    item.locationLat !== null && item.locationLng !== null
      ? {
          lat: item.locationLat,
          lng: item.locationLng,
          label: item.locationLabel,
        }
      : null,
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
});

export const listBucketListItemsForTrip = async (params: {
  userId: string;
  tripId: string;
}): Promise<BucketListItemDetail[] | null> => {
  const { userId, tripId } = params;
  const trip = await findTripForUser(userId, tripId);
  if (!trip) {
    return null;
  }

  const items = await prisma.tripBucketListItem.findMany({
    where: { tripId },
    orderBy: [{ title: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });

  return items.map(toDetail);
};

export const createBucketListItemForTrip = async (
  params: BucketListItemCreateParams,
): Promise<BucketListItemDetail | null> => {
  const { userId, tripId, title, description, positionText, location } = params;
  const trip = await findTripForUser(userId, tripId);
  if (!trip) {
    return null;
  }

  const created = await prisma.tripBucketListItem.create({
    data: {
      tripId,
      title: title.trim(),
      description: cleanOptionalString(description),
      positionText: cleanOptionalString(positionText),
      locationLat: location?.lat ?? null,
      locationLng: location?.lng ?? null,
      locationLabel: cleanOptionalString(location?.label),
    },
  });

  return toDetail(created);
};

export const updateBucketListItemForTrip = async (
  params: BucketListItemUpdateParams,
): Promise<BucketListItemUpdateResult> => {
  const { userId, tripId, itemId, title, description, positionText, location } = params;
  const trip = await findTripForUser(userId, tripId);
  if (!trip) {
    return { status: "not_found" };
  }

  const existing = await prisma.tripBucketListItem.findFirst({
    where: {
      id: itemId,
      tripId,
    },
  });

  if (!existing) {
    return { status: "missing" };
  }

  const updated = await prisma.tripBucketListItem.update({
    where: { id: existing.id },
    data: {
      title: title.trim(),
      description: cleanOptionalString(description),
      positionText: cleanOptionalString(positionText),
      locationLat: location?.lat ?? null,
      locationLng: location?.lng ?? null,
      locationLabel: cleanOptionalString(location?.label),
    },
  });

  return { status: "updated", item: toDetail(updated) };
};

export const deleteBucketListItemForTrip = async (
  params: BucketListItemDeleteParams,
): Promise<BucketListItemDeleteResult> => {
  const { userId, tripId, itemId } = params;
  const trip = await findTripForUser(userId, tripId);
  if (!trip) {
    return { status: "not_found" };
  }

  const existing = await prisma.tripBucketListItem.findFirst({
    where: {
      id: itemId,
      tripId,
    },
    select: { id: true },
  });

  if (!existing) {
    return { status: "missing" };
  }

  await prisma.tripBucketListItem.delete({ where: { id: existing.id } });
  return { status: "deleted" };
};
