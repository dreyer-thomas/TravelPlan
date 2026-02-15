import { prisma } from "@/lib/db/prisma";

export type DayPlanItemDetail = {
  id: string;
  tripDayId: string;
  contentJson: string;
  linkUrl: string | null;
  location: { lat: number; lng: number; label: string | null } | null;
  createdAt: Date;
};

export type DayPlanItemUpdateResult =
  | { status: "not_found" }
  | { status: "missing" }
  | { status: "updated"; item: DayPlanItemDetail };

export type DayPlanItemDeleteResult =
  | { status: "not_found" }
  | { status: "missing" }
  | { status: "deleted" };

type DayPlanItemMutationParams = {
  userId: string;
  tripId: string;
  tripDayId: string;
  contentJson: string;
  linkUrl?: string | null;
  location?: { lat: number; lng: number; label?: string | null } | null;
};

type DayPlanItemUpdateParams = DayPlanItemMutationParams & { itemId: string };

type DayPlanItemDeleteParams = {
  userId: string;
  tripId: string;
  tripDayId: string;
  itemId: string;
};

export type DayPlanItemImageDetail = {
  id: string;
  dayPlanItemId: string;
  imageUrl: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

type DayPlanItemImageScopeParams = {
  userId: string;
  tripId: string;
  tripDayId: string;
  dayPlanItemId: string;
};

type DayPlanItemImageCreateParams = DayPlanItemImageScopeParams & {
  imageUrl: string;
};

type DayPlanItemImageDeleteParams = DayPlanItemImageScopeParams & {
  imageId: string;
};

type DayPlanItemImageReorderParams = DayPlanItemImageScopeParams & {
  order: { imageId: string; sortOrder: number }[];
};

export type DayPlanItemImageDeleteResult =
  | { status: "not_found" }
  | { status: "missing" }
  | { status: "deleted" };

export type DayPlanItemImageReorderResult =
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

const findScopedDayPlanItem = async ({ userId, tripId, tripDayId, dayPlanItemId }: DayPlanItemImageScopeParams) =>
  prisma.dayPlanItem.findFirst({
    where: {
      id: dayPlanItemId,
      tripDayId,
      tripDay: {
        id: tripDayId,
        tripId,
        trip: { userId },
      },
    },
    select: { id: true },
  });

const toDetail = (item: {
  id: string;
  tripDayId: string;
  contentJson: string;
  linkUrl: string | null;
  locationLat: number | null;
  locationLng: number | null;
  locationLabel: string | null;
  createdAt: Date;
}) => ({
  id: item.id,
  tripDayId: item.tripDayId,
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
  createdAt: item.createdAt,
});

const toImageDetail = (item: {
  id: string;
  dayPlanItemId: string;
  imageUrl: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}): DayPlanItemImageDetail => ({
  id: item.id,
  dayPlanItemId: item.dayPlanItemId,
  imageUrl: item.imageUrl,
  sortOrder: item.sortOrder,
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
});

export const listDayPlanItemsForTripDay = async (params: {
  userId: string;
  tripId: string;
  tripDayId: string;
}): Promise<DayPlanItemDetail[] | null> => {
  const { userId, tripId, tripDayId } = params;
  const tripDay = await findTripDayForUser(userId, tripId, tripDayId);
  if (!tripDay) {
    return null;
  }

  const items = await prisma.dayPlanItem.findMany({
    where: { tripDayId },
    orderBy: { createdAt: "asc" },
  });

  return items.map(toDetail);
};

export const createDayPlanItemForTripDay = async (
  params: DayPlanItemMutationParams,
): Promise<DayPlanItemDetail | null> => {
  const { userId, tripId, tripDayId, contentJson, linkUrl, location } = params;
  const tripDay = await findTripDayForUser(userId, tripId, tripDayId);
  if (!tripDay) {
    return null;
  }

  const item = await prisma.dayPlanItem.create({
    data: {
      tripDayId,
      contentJson,
      linkUrl: linkUrl ?? null,
      locationLat: location?.lat ?? null,
      locationLng: location?.lng ?? null,
      locationLabel: location?.label?.trim() || null,
    },
  });

  return toDetail(item);
};

export const updateDayPlanItemForTripDay = async (
  params: DayPlanItemUpdateParams,
): Promise<DayPlanItemUpdateResult> => {
  const { userId, tripId, tripDayId, itemId, contentJson, linkUrl, location } = params;
  const tripDay = await findTripDayForUser(userId, tripId, tripDayId);
  if (!tripDay) {
    return { status: "not_found" };
  }

  const existing = await prisma.dayPlanItem.findFirst({
    where: {
      id: itemId,
      tripDayId,
    },
  });

  if (!existing) {
    return { status: "missing" };
  }

  const updated = await prisma.dayPlanItem.update({
    where: { id: existing.id },
    data: {
      contentJson,
      linkUrl: linkUrl ?? null,
      locationLat: location?.lat ?? null,
      locationLng: location?.lng ?? null,
      locationLabel: location?.label?.trim() || null,
    },
  });

  return { status: "updated", item: toDetail(updated) };
};

export const deleteDayPlanItemForTripDay = async (
  params: DayPlanItemDeleteParams,
): Promise<DayPlanItemDeleteResult> => {
  const { userId, tripId, tripDayId, itemId } = params;
  const tripDay = await findTripDayForUser(userId, tripId, tripDayId);
  if (!tripDay) {
    return { status: "not_found" };
  }

  const existing = await prisma.dayPlanItem.findFirst({
    where: {
      id: itemId,
      tripDayId,
    },
  });

  if (!existing) {
    return { status: "missing" };
  }

  await prisma.dayPlanItem.delete({ where: { id: existing.id } });
  return { status: "deleted" };
};

export const listDayPlanItemImages = async (
  params: DayPlanItemImageScopeParams,
): Promise<DayPlanItemImageDetail[] | null> => {
  const item = await findScopedDayPlanItem(params);
  if (!item) {
    return null;
  }

  const images = await prisma.dayPlanItemImage.findMany({
    where: { dayPlanItemId: item.id },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return images.map(toImageDetail);
};

export const createDayPlanItemImage = async (
  params: DayPlanItemImageCreateParams,
): Promise<DayPlanItemImageDetail | null> => {
  const item = await findScopedDayPlanItem(params);
  if (!item) {
    return null;
  }

  const last = await prisma.dayPlanItemImage.findFirst({
    where: { dayPlanItemId: item.id },
    orderBy: [{ sortOrder: "desc" }],
    select: { sortOrder: true },
  });
  const nextSortOrder = (last?.sortOrder ?? 0) + 1;

  const created = await prisma.dayPlanItemImage.create({
    data: {
      dayPlanItemId: item.id,
      imageUrl: params.imageUrl,
      sortOrder: nextSortOrder,
    },
  });

  return toImageDetail(created);
};

export const deleteDayPlanItemImage = async (
  params: DayPlanItemImageDeleteParams,
): Promise<DayPlanItemImageDeleteResult> => {
  const item = await findScopedDayPlanItem(params);
  if (!item) {
    return { status: "not_found" };
  }

  const existing = await prisma.dayPlanItemImage.findFirst({
    where: {
      id: params.imageId,
      dayPlanItemId: item.id,
    },
    select: { id: true },
  });
  if (!existing) {
    return { status: "missing" };
  }

  await prisma.dayPlanItemImage.delete({ where: { id: existing.id } });
  return { status: "deleted" };
};

export const reorderDayPlanItemImages = async (
  params: DayPlanItemImageReorderParams,
): Promise<DayPlanItemImageReorderResult> => {
  const item = await findScopedDayPlanItem(params);
  if (!item) {
    return { status: "not_found" };
  }

  const existing = await prisma.dayPlanItemImage.findMany({
    where: { dayPlanItemId: item.id },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((entry) => entry.id));
  const orderIds = new Set(params.order.map((entry) => entry.imageId));

  if (
    existing.length !== params.order.length ||
    orderIds.size !== params.order.length ||
    [...orderIds].some((id) => !existingIds.has(id))
  ) {
    return { status: "missing" };
  }

  await prisma.$transaction(async (tx) => {
    for (const entry of params.order) {
      await tx.dayPlanItemImage.update({
        where: { id: entry.imageId },
        data: { sortOrder: entry.sortOrder + 1000 },
      });
    }

    for (const entry of params.order) {
      await tx.dayPlanItemImage.update({
        where: { id: entry.imageId },
        data: { sortOrder: entry.sortOrder },
      });
    }
  });

  return { status: "reordered" };
};
