import { prisma } from "@/lib/db/prisma";

type TransactionClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

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

type BucketListItemScopeParams = {
  userId: string;
  tripId: string;
  itemId: string;
};

/**
 * The single scope gate behind all four exported bucket-list functions, so Story 5.13 moved list, create,
 * update and delete together by widening this one query from `where: { id: tripId, userId }` to the flat
 * writer clause. Renamed from `findTripForUser` in the same commit: the old name would tell the next
 * reader it is owner-only, which it no longer is.
 *
 * The explicit `role: "CONTRIBUTOR"` is load-bearing. A bare `members: { some: { userId } }` is the
 * participant *read* clause and would hand viewers write access to the list.
 */
const findTripForTripWriter = async (userId: string, tripId: string) =>
  prisma.trip.findFirst({
    where: {
      id: tripId,
      OR: [{ userId }, { members: { some: { userId, role: "CONTRIBUTOR" } } }],
    },
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
  const trip = await findTripForTripWriter(userId, tripId);
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
  const trip = await findTripForTripWriter(userId, tripId);
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
  const trip = await findTripForTripWriter(userId, tripId);
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
  const trip = await findTripForTripWriter(userId, tripId);
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

/**
 * Widened to the writer clause by Story 5.13 in step with its transaction twin below. It has no callers
 * today; it is kept in the same spelling precisely so the two cannot drift and the next caller does not
 * pick up an owner-only scope by accident.
 */
export const findBucketListItemForTrip = async (
  params: BucketListItemScopeParams,
): Promise<BucketListItemDetail | null> => {
  const item = await prisma.tripBucketListItem.findFirst({
    where: {
      id: params.itemId,
      tripId: params.tripId,
      trip: {
        OR: [{ userId: params.userId }, { members: { some: { userId: params.userId, role: "CONTRIBUTOR" } } }],
      },
    },
  });

  return item ? toDetail(item) : null;
};

/**
 * The "add this idea to that day" flow's item lookup, inside `convertBucketListItemToDayPlanItemForTripDay`'s
 * transaction. Story 5.13 widened it to the writer clause: the route (`day-plan-items/route.ts`) and the day
 * lookup beside it were already contributor-permissive, so an owner-only scope here let a contributor get all
 * the way into the transaction and then fail as `bucket_missing` -> 404, which reads as a vanished idea rather
 * than a refusal.
 */
export const findBucketListItemForTripInTransaction = async (
  params: BucketListItemScopeParams & { tx: TransactionClient },
): Promise<BucketListItemDetail | null> => {
  const item = await params.tx.tripBucketListItem.findFirst({
    where: {
      id: params.itemId,
      tripId: params.tripId,
      trip: {
        OR: [{ userId: params.userId }, { members: { some: { userId: params.userId, role: "CONTRIBUTOR" } } }],
      },
    },
  });

  return item ? toDetail(item) : null;
};

export const deleteBucketListItemForTripInTransaction = async (params: {
  tx: TransactionClient;
  tripId: string;
  itemId: string;
}): Promise<boolean> => {
  const existing = await params.tx.tripBucketListItem.findFirst({
    where: {
      id: params.itemId,
      tripId: params.tripId,
    },
    select: { id: true },
  });

  if (!existing) {
    return false;
  }

  await params.tx.tripBucketListItem.delete({ where: { id: existing.id } });
  return true;
};
