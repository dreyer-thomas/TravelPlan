import { prisma } from "@/lib/db/prisma";
import {
  deleteBucketListItemForTripInTransaction,
  findBucketListItemForTripInTransaction,
} from "@/lib/repositories/bucketListRepo";

export type DayPlanItemDetail = {
  id: string;
  tripDayId: string;
  title: string | null;
  fromTime: string | null;
  toTime: string | null;
  contentJson: string;
  costCents: number | null;
  payments: { amountCents: number; dueDate: string }[];
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

export type DayPlanItemConversionResult =
  | { status: "not_found" }
  | { status: "bucket_missing" }
  | { status: "created"; item: DayPlanItemDetail };

type DayPlanItemMutationParams = {
  userId: string;
  tripId: string;
  tripDayId: string;
  title: string;
  fromTime: string;
  toTime: string;
  contentJson: string;
  costCents?: number | null;
  payments?: { amountCents: number; dueDate: string }[] | null;
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

type DayPlanItemConversionParams = DayPlanItemMutationParams & { bucketListItemId: string };

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

const findTripDayForTripParticipant = async (userId: string, tripId: string, tripDayId: string) =>
  prisma.tripDay.findFirst({
    where: {
      id: tripDayId,
      tripId,
      trip: {
        OR: [{ userId }, { members: { some: { userId } } }],
      },
    },
  });

const findTripDayForTripWriter = async (userId: string, tripId: string, tripDayId: string) =>
  prisma.tripDay.findFirst({
    where: {
      id: tripDayId,
      tripId,
      trip: {
        OR: [{ userId }, { members: { some: { userId, role: "CONTRIBUTOR" } } }],
      },
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

const findScopedDayPlanItemForTripParticipant = async ({
  userId,
  tripId,
  tripDayId,
  dayPlanItemId,
}: DayPlanItemImageScopeParams) =>
  prisma.dayPlanItem.findFirst({
    where: {
      id: dayPlanItemId,
      tripDayId,
      tripDay: {
        id: tripDayId,
        tripId,
        trip: {
          OR: [{ userId }, { members: { some: { userId } } }],
        },
      },
    },
    select: { id: true },
  });

const toDetail = (item: {
  id: string;
  tripDayId: string;
  title: string | null;
  fromTime: string | null;
  toTime: string | null;
  contentJson: string;
  costCents: number | null;
  payments?: { amountCents: number; dueDate: string }[];
  linkUrl: string | null;
  locationLat: number | null;
  locationLng: number | null;
  locationLabel: string | null;
  createdAt: Date;
}) => ({
  id: item.id,
  tripDayId: item.tripDayId,
  title: item.title,
  fromTime: item.fromTime,
  toTime: item.toTime,
  contentJson: item.contentJson,
  costCents: item.costCents,
  payments: item.payments ?? [],
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

const compareDayPlanItemsByStartTime = (
  left: { fromTime: string | null; createdAt: Date; id: string },
  right: { fromTime: string | null; createdAt: Date; id: string },
) => {
  const leftHasStart = Boolean(left.fromTime);
  const rightHasStart = Boolean(right.fromTime);
  if (leftHasStart && rightHasStart) {
    if (left.fromTime !== right.fromTime) return left.fromTime!.localeCompare(right.fromTime!);
  } else if (leftHasStart !== rightHasStart) {
    return leftHasStart ? -1 : 1;
  }

  const leftTime = left.createdAt.getTime();
  const rightTime = right.createdAt.getTime();
  if (leftTime !== rightTime) return leftTime - rightTime;
  return left.id.localeCompare(right.id);
};

export const listDayPlanItemsForTripDay = async (params: {
  userId: string;
  tripId: string;
  tripDayId: string;
}): Promise<DayPlanItemDetail[] | null> => {
  const { userId, tripId, tripDayId } = params;
  const tripDay = await findTripDayForTripParticipant(userId, tripId, tripDayId);
  if (!tripDay) {
    return null;
  }

  const items = await prisma.dayPlanItem.findMany({
    where: { tripDayId },
    orderBy: { createdAt: "asc" },
    include: {
      payments: {
        select: { amountCents: true, dueDate: true },
        orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
      },
    },
  });

  return items.map(toDetail).sort(compareDayPlanItemsByStartTime);
};

export const createDayPlanItemForTripDay = async (
  params: DayPlanItemMutationParams,
): Promise<DayPlanItemDetail | null> => {
  const { userId, tripId, tripDayId, contentJson, costCents, linkUrl, location, fromTime, toTime } = params;
  const tripDay = await findTripDayForTripWriter(userId, tripId, tripDayId);
  if (!tripDay) {
    return null;
  }

  return prisma.$transaction(async (tx) => {
    const item = await tx.dayPlanItem.create({
      data: {
        tripDayId,
        title: params.title.trim(),
        fromTime,
        toTime,
        contentJson,
        costCents: costCents ?? null,
        linkUrl: linkUrl ?? null,
        locationLat: location?.lat ?? null,
        locationLng: location?.lng ?? null,
        locationLabel: location?.label?.trim() || null,
      },
    });

    if (params.payments) {
      await tx.costPayment.deleteMany({ where: { dayPlanItemId: item.id } });
      if (params.payments.length > 0) {
        await tx.costPayment.createMany({
          data: params.payments.map((payment, index) => ({
            dayPlanItemId: item.id,
            amountCents: payment.amountCents,
            dueDate: payment.dueDate,
            sortOrder: index,
          })),
        });
      }
    }

    const payments = await tx.costPayment.findMany({
      where: { dayPlanItemId: item.id },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { amountCents: true, dueDate: true },
    });

    return toDetail({ ...item, payments });
  });
};

export const convertBucketListItemToDayPlanItemForTripDay = async (
  params: DayPlanItemConversionParams,
): Promise<DayPlanItemConversionResult> => {
  const { userId, tripId, tripDayId, bucketListItemId, contentJson, costCents, linkUrl, location, fromTime, toTime } =
    params;
  const tripDay = await findTripDayForTripWriter(userId, tripId, tripDayId);
  if (!tripDay) {
    return { status: "not_found" };
  }

  return prisma.$transaction(async (tx) => {
    const bucketItem = await findBucketListItemForTripInTransaction({
      tx,
      userId,
      tripId,
      itemId: bucketListItemId,
    });

    if (!bucketItem) {
      return { status: "bucket_missing" };
    }

    const created = await tx.dayPlanItem.create({
      data: {
        tripDayId,
        title: params.title.trim(),
        fromTime,
        toTime,
        contentJson,
        costCents: costCents ?? null,
        linkUrl: linkUrl ?? null,
        locationLat: location?.lat ?? null,
        locationLng: location?.lng ?? null,
        locationLabel: location?.label?.trim() || null,
      },
    });

    if (params.payments) {
      await tx.costPayment.deleteMany({ where: { dayPlanItemId: created.id } });
      if (params.payments.length > 0) {
        await tx.costPayment.createMany({
          data: params.payments.map((payment, index) => ({
            dayPlanItemId: created.id,
            amountCents: payment.amountCents,
            dueDate: payment.dueDate,
            sortOrder: index,
          })),
        });
      }
    }

    const deleted = await deleteBucketListItemForTripInTransaction({
      tx,
      tripId,
      itemId: bucketItem.id,
    });

    if (!deleted) {
      throw new Error("Bucket list item deletion failed");
    }

    const payments = await tx.costPayment.findMany({
      where: { dayPlanItemId: created.id },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { amountCents: true, dueDate: true },
    });

    return { status: "created", item: toDetail({ ...created, payments }) };
  });
};

export const updateDayPlanItemForTripDay = async (
  params: DayPlanItemUpdateParams,
): Promise<DayPlanItemUpdateResult> => {
  const { userId, tripId, tripDayId, itemId, contentJson, costCents, linkUrl, location, title, fromTime, toTime } = params;
  const tripDay = await findTripDayForTripWriter(userId, tripId, tripDayId);
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

  const updated = await prisma.$transaction(async (tx) => {
    const item = await tx.dayPlanItem.update({
      where: { id: existing.id },
      data: {
        title: title.trim(),
        fromTime,
        toTime,
        contentJson,
        costCents: costCents ?? null,
        linkUrl: linkUrl ?? null,
        locationLat: location?.lat ?? null,
        locationLng: location?.lng ?? null,
        locationLabel: location?.label?.trim() || null,
      },
    });

    if (params.payments) {
      await tx.costPayment.deleteMany({ where: { dayPlanItemId: existing.id } });
      if (params.payments.length > 0) {
        await tx.costPayment.createMany({
          data: params.payments.map((payment, index) => ({
            dayPlanItemId: existing.id,
            amountCents: payment.amountCents,
            dueDate: payment.dueDate,
            sortOrder: index,
          })),
        });
      }
    }

    const payments = await tx.costPayment.findMany({
      where: { dayPlanItemId: existing.id },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { amountCents: true, dueDate: true },
    });

    return toDetail({ ...item, payments });
  });

  return { status: "updated", item: updated };
};

export const deleteDayPlanItemForTripDay = async (
  params: DayPlanItemDeleteParams,
): Promise<DayPlanItemDeleteResult> => {
  const { userId, tripId, tripDayId, itemId } = params;
  const tripDay = await findTripDayForTripWriter(userId, tripId, tripDayId);
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
  const item = await findScopedDayPlanItemForTripParticipant(params);
  if (!item) {
    return null;
  }

  const images = await prisma.dayPlanItemImage.findMany({
    where: { dayPlanItemId: item.id },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return images.map(toImageDetail);
};

export const listDayPlanItemImagesForTripDay = async (params: {
  userId: string;
  tripId: string;
  tripDayId: string;
}): Promise<DayPlanItemImageDetail[] | null> => {
  const tripDay = await findTripDayForTripParticipant(params.userId, params.tripId, params.tripDayId);
  if (!tripDay) {
    return null;
  }

  const images = await prisma.dayPlanItemImage.findMany({
    where: {
      dayPlanItem: {
        tripDayId: params.tripDayId,
      },
    },
    orderBy: [{ dayPlanItemId: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
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
