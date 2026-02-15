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

const findTripDayForUser = async (userId: string, tripId: string, tripDayId: string) =>
  prisma.tripDay.findFirst({
    where: {
      id: tripDayId,
      tripId,
      trip: { userId },
    },
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
