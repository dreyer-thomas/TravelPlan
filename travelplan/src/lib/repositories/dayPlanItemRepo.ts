import { prisma } from "@/lib/db/prisma";
import {
  deleteBucketListItemForTripInTransaction,
  findBucketListItemForTripInTransaction,
} from "@/lib/repositories/bucketListRepo";
import { MAX_DOCUMENTS_PER_ENTRY } from "@/lib/trips/documentUploads";

type TransactionClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

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
  | { status: "deleted"; removedTravelSegmentIds: string[] };

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

type DayPlanItemMoveParams = {
  userId: string;
  tripId: string;
  sourceTripDayId: string;
  targetTripDayId: string;
};

type SingleDayPlanItemMoveParams = {
  userId: string;
  tripId: string;
  tripDayId: string;
  itemId: string;
  targetTripDayId: string;
};

type DayPlanItemSwapParams = {
  userId: string;
  tripId: string;
  firstTripDayId: string;
  secondTripDayId: string;
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

export type DayPlanItemDocumentDetail = {
  id: string;
  dayPlanItemId: string;
  documentUrl: string;
  fileName: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

type DayPlanItemDocumentCreateParams = DayPlanItemImageScopeParams & {
  documentUrl: string;
  fileName: string;
};

type DayPlanItemDocumentDeleteParams = DayPlanItemImageScopeParams & {
  documentId: string;
};

/**
 * Three outcomes rather than the images' `Detail | null`, because the create has three answers to
 * give: the entry is not this user's to write to, the entry is full, or here is the row. The stay
 * repository carries the twin of this type and the same reasoning.
 */
export type DayPlanItemDocumentCreateResult =
  | { status: "not_found" }
  | { status: "limit_reached" }
  | { status: "created"; document: DayPlanItemDocumentDetail };

export type DayPlanItemDocumentDeleteResult =
  | { status: "not_found" }
  | { status: "missing" }
  | { status: "deleted" };

export type DayPlanItemMoveResult =
  | { status: "not_found" }
  | { status: "validation_error"; code: "same_day"; message: string }
  | { status: "moved"; movedItemIds: string[]; removedTargetItemIds: string[] };

export type DayPlanItemSwapResult =
  | { status: "not_found" }
  | { status: "validation_error"; code: "same_day"; message: string }
  | { status: "swapped"; firstDayItemIds: string[]; secondDayItemIds: string[] };

/**
 * Story 6.23. Deliberately a *different* result shape from `DayPlanItemMoveResult`: the day-level
 * move replaces the target day (`removedTargetItemIds`), this one appends to it and can only ever
 * remove travel segments. Sharing a type would invite sharing the function, which is Trap 1.
 */
export type SingleDayPlanItemMoveResult =
  | { status: "not_found" }
  | { status: "missing" }
  | { status: "validation_error"; code: "same_day"; message: string }
  | {
      status: "moved";
      itemId: string;
      sourceTripDayId: string;
      targetTripDayId: string;
      removedTravelSegmentIds: string[];
    };

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

const findTransferTripDaysForWriter = async (
  userId: string,
  tripId: string,
  tripDayIds: string[],
) =>
  prisma.tripDay.findMany({
    where: {
      id: { in: tripDayIds },
      tripId,
      trip: {
        OR: [{ userId }, { members: { some: { userId, role: "CONTRIBUTOR" } } }],
      },
    },
    select: { id: true },
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

/**
 * Story 6.23, AC4/AC6. Deletes every travel segment on `tripDayIds` that points at `itemId`, and
 * returns the ids it deleted so the caller can report them.
 *
 * `TravelSegment` has **no foreign key to `DayPlanItem`** — `fromItemId`/`toItemId` are plain strings
 * paired with a `fromItemType`/`toItemType` discriminator, and the only cascade is on `tripDayId`. So
 * an activity that leaves a day (moved *or* deleted) leaves its segments behind, and nothing in the
 * app cleans them up. They are invisible — `segmentsByKey` in `TripDayView` only looks up pairs the
 * timeline actually draws — but `totalTravelMinutes` sums *every* segment on the day, so the orphan
 * keeps being counted as "Fahrzeit" forever.
 *
 * This is called from both `moveDayPlanItemToTripDay` and `deleteDayPlanItemForTripDay`. Fixing only
 * the move path would mean the app tidies up after a move but not after a delete, which is the
 * defect AC6 exists to close.
 *
 * It deliberately does **not** heal the chain by joining the removed activity's two former
 * neighbours, and does not create anything on the target day: transport mode, duration and distance
 * are the user's knowledge, and a fabricated segment is worse than a visible gap (AC5, Trap 3).
 */
const removeTravelSegmentsReferencingDayPlanItem = async (
  tx: TransactionClient,
  tripDayIds: string[],
  itemId: string,
): Promise<string[]> => {
  const segments = await tx.travelSegment.findMany({
    where: {
      tripDayId: { in: tripDayIds },
      OR: [
        { fromItemType: "DAY_PLAN_ITEM", fromItemId: itemId },
        { toItemType: "DAY_PLAN_ITEM", toItemId: itemId },
      ],
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });

  if (segments.length === 0) {
    return [];
  }

  const removedIds = segments.map((segment) => segment.id);
  await tx.travelSegment.deleteMany({ where: { id: { in: removedIds } } });
  return removedIds;
};

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

const toDocumentDetail = (item: {
  id: string;
  dayPlanItemId: string;
  documentUrl: string;
  fileName: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}): DayPlanItemDocumentDetail => ({
  id: item.id,
  dayPlanItemId: item.dayPlanItemId,
  documentUrl: item.documentUrl,
  fileName: item.fileName,
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

  // Story 6.23 AC6: one transaction, so a delete can never leave the day with segments pointing at
  // an activity that is gone. Like the move below, the existence check *is* the write — `deleteMany`
  // scoped by `[id, tripDayId]` cannot race a concurrent delete into a P2025 the way a bare
  // `delete({ where: { id } })` after a separate `findFirst` can. The delete runs before the sweep so
  // that a "missing" outcome touches nothing; the segments have no FK to the item, so neither order
  // cascades.
  const outcome = await prisma.$transaction(async (tx) => {
    const deleted = await tx.dayPlanItem.deleteMany({ where: { id: itemId, tripDayId } });
    if (deleted.count !== 1) {
      return { status: "missing" as const };
    }
    const removed = await removeTravelSegmentsReferencingDayPlanItem(tx, [tripDayId], itemId);
    return { status: "deleted" as const, removedTravelSegmentIds: removed };
  });

  if (outcome.status === "missing") {
    return { status: "missing" };
  }

  return { status: "deleted", removedTravelSegmentIds: outcome.removedTravelSegmentIds };
};

/**
 * Story 6.23. Moves **one** activity to another day of the same trip.
 *
 * This is *not* `moveDayPlanItemsBetweenTripDays` with a narrower `where`, and must never become
 * that: the day-level move deletes the target day's activities before reassigning the source day's
 * (a whole-day replace wearing the name "move"), which for a single activity would destroy
 * everything already on the destination. Here the target day is only ever appended to (AC2).
 *
 * The move itself is a single `update` of `tripDayId`. Everything attached to the activity travels
 * with it for free (AC3): `day_plan_item_images.day_plan_item_id` and `cost_payments.day_plan_item_id`
 * are foreign keys onto the row that is being updated, not onto the day, and title, description,
 * times, cost, link and location are columns on the row itself.
 *
 * Ordering on the new day (AC7) needs no write: `DayPlanItem` has no `sortOrder` column, and every
 * reader sorts by `fromTime` then `createdAt` then `id`. See the Dev Agent Record.
 */
export const moveDayPlanItemToTripDay = async (
  params: SingleDayPlanItemMoveParams,
): Promise<SingleDayPlanItemMoveResult> => {
  const { userId, tripId, tripDayId, itemId, targetTripDayId } = params;
  if (tripDayId === targetTripDayId) {
    return {
      status: "validation_error",
      code: "same_day",
      message: "Source and target days must be different",
    };
  }

  const tripDays = await findTransferTripDaysForWriter(userId, tripId, [tripDayId, targetTripDayId]);
  if (tripDays.length !== 2) {
    return { status: "not_found" };
  }

  // The whole move is decided inside the transaction, including whether the activity is still on the
  // day the caller thinks it is. Checking first and writing afterwards leaves a window two open tabs
  // are enough to hit: the other tab moves the activity to a third day, this one's `update` by id
  // alone would follow it there and sweep the wrong two days for segments. `updateMany` is what makes
  // the day part of the write condition — `update` needs a unique `where`, and `[id, tripDayId]` is
  // not one.
  const outcome = await prisma.$transaction(async (tx) => {
    const moved = await tx.dayPlanItem.updateMany({
      where: { id: itemId, tripDayId },
      data: { tripDayId: targetTripDayId },
    });
    if (moved.count !== 1) {
      return { status: "missing" as const };
    }
    // Both days, not just the source: AC4 says the activity's segments go from both, and scoping the
    // sweep to one of them would leave a stray behind if one ever existed on the other.
    const removed = await removeTravelSegmentsReferencingDayPlanItem(
      tx,
      [tripDayId, targetTripDayId],
      itemId,
    );
    return { status: "moved" as const, removedTravelSegmentIds: removed };
  });

  if (outcome.status === "missing") {
    return { status: "missing" };
  }

  return {
    status: "moved",
    itemId,
    sourceTripDayId: tripDayId,
    targetTripDayId,
    removedTravelSegmentIds: outcome.removedTravelSegmentIds,
  };
};

export const moveDayPlanItemsBetweenTripDays = async (
  params: DayPlanItemMoveParams,
): Promise<DayPlanItemMoveResult> => {
  const { userId, tripId, sourceTripDayId, targetTripDayId } = params;
  if (sourceTripDayId === targetTripDayId) {
    return {
      status: "validation_error",
      code: "same_day",
      message: "Source and target days must be different",
    };
  }

  const tripDays = await findTransferTripDaysForWriter(userId, tripId, [sourceTripDayId, targetTripDayId]);
  if (tripDays.length !== 2) {
    return { status: "not_found" };
  }

  return prisma.$transaction(async (tx) => {
    const sourceItems = await tx.dayPlanItem.findMany({
      where: { tripDayId: sourceTripDayId },
      select: { id: true },
    });
    const targetItems = await tx.dayPlanItem.findMany({
      where: { tripDayId: targetTripDayId },
      select: { id: true },
    });

    await tx.travelSegment.deleteMany({
      where: { tripDayId: { in: [sourceTripDayId, targetTripDayId] } },
    });
    await tx.dayPlanItem.deleteMany({
      where: { id: { in: targetItems.map((item) => item.id) } },
    });
    await tx.dayPlanItem.updateMany({
      where: { id: { in: sourceItems.map((item) => item.id) } },
      data: { tripDayId: targetTripDayId },
    });

    return {
      status: "moved" as const,
      movedItemIds: sourceItems.map((item) => item.id),
      removedTargetItemIds: targetItems.map((item) => item.id),
    };
  });
};

export const swapDayPlanItemsBetweenTripDays = async (
  params: DayPlanItemSwapParams,
): Promise<DayPlanItemSwapResult> => {
  const { userId, tripId, firstTripDayId, secondTripDayId } = params;
  if (firstTripDayId === secondTripDayId) {
    return {
      status: "validation_error",
      code: "same_day",
      message: "Source and target days must be different",
    };
  }

  const tripDays = await findTransferTripDaysForWriter(userId, tripId, [firstTripDayId, secondTripDayId]);
  if (tripDays.length !== 2) {
    return { status: "not_found" };
  }

  return prisma.$transaction(async (tx) => {
    const firstDayItems = await tx.dayPlanItem.findMany({
      where: { tripDayId: firstTripDayId },
      select: { id: true },
    });
    const secondDayItems = await tx.dayPlanItem.findMany({
      where: { tripDayId: secondTripDayId },
      select: { id: true },
    });

    await tx.travelSegment.deleteMany({
      where: { tripDayId: { in: [firstTripDayId, secondTripDayId] } },
    });
    await tx.dayPlanItem.updateMany({
      where: { id: { in: firstDayItems.map((item) => item.id) } },
      data: { tripDayId: secondTripDayId },
    });
    await tx.dayPlanItem.updateMany({
      where: { id: { in: secondDayItems.map((item) => item.id) } },
      data: { tripDayId: firstTripDayId },
    });

    return {
      status: "swapped" as const,
      firstDayItemIds: secondDayItems.map((item) => item.id),
      secondDayItemIds: firstDayItems.map((item) => item.id),
    };
  });
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

export const listDayPlanItemDocuments = async (
  params: DayPlanItemImageScopeParams,
): Promise<DayPlanItemDocumentDetail[] | null> => {
  // The participant scope, exactly as the gallery read uses: a viewer who can see the day must be
  // able to see what is attached to it. The write functions below use the owner-only scope instead.
  const item = await findScopedDayPlanItemForTripParticipant(params);
  if (!item) {
    return null;
  }

  const documents = await prisma.dayPlanItemDocument.findMany({
    where: { dayPlanItemId: item.id },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return documents.map(toDocumentDetail);
};

/**
 * Every activity's documents for one day in a single query, twinning
 * `listDayPlanItemImagesForTripDay`. The day view renders a media row per activity and would
 * otherwise issue one request per card.
 */
export const listDayPlanItemDocumentsForTripDay = async (params: {
  userId: string;
  tripId: string;
  tripDayId: string;
}): Promise<DayPlanItemDocumentDetail[] | null> => {
  const tripDay = await findTripDayForTripParticipant(params.userId, params.tripId, params.tripDayId);
  if (!tripDay) {
    return null;
  }

  const documents = await prisma.dayPlanItemDocument.findMany({
    where: {
      dayPlanItem: {
        tripDayId: params.tripDayId,
      },
    },
    orderBy: [{ dayPlanItemId: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
  });

  return documents.map(toDocumentDetail);
};

export const createDayPlanItemDocument = async (
  params: DayPlanItemDocumentCreateParams,
): Promise<DayPlanItemDocumentCreateResult> => {
  const item = await findScopedDayPlanItem(params);
  if (!item) {
    return { status: "not_found" };
  }

  // Counted here rather than in the dialog. The route has already written the file by the time it
  // calls this, so the refusal has to be distinguishable enough for it to roll that write back - see
  // `DayPlanItemDocumentCreateResult`.
  const existingCount = await prisma.dayPlanItemDocument.count({
    where: { dayPlanItemId: item.id },
  });
  if (existingCount >= MAX_DOCUMENTS_PER_ENTRY) {
    return { status: "limit_reached" };
  }

  const last = await prisma.dayPlanItemDocument.findFirst({
    where: { dayPlanItemId: item.id },
    orderBy: [{ sortOrder: "desc" }],
    select: { sortOrder: true },
  });
  const nextSortOrder = (last?.sortOrder ?? 0) + 1;

  const created = await prisma.dayPlanItemDocument.create({
    data: {
      dayPlanItemId: item.id,
      documentUrl: params.documentUrl,
      fileName: params.fileName,
      sortOrder: nextSortOrder,
    },
  });

  return { status: "created", document: toDocumentDetail(created) };
};

export const deleteDayPlanItemDocument = async (
  params: DayPlanItemDocumentDeleteParams,
): Promise<DayPlanItemDocumentDeleteResult> => {
  const item = await findScopedDayPlanItem(params);
  if (!item) {
    return { status: "not_found" };
  }

  const existing = await prisma.dayPlanItemDocument.findFirst({
    where: {
      id: params.documentId,
      dayPlanItemId: item.id,
    },
    select: { id: true },
  });
  if (!existing) {
    return { status: "missing" };
  }

  await prisma.dayPlanItemDocument.delete({ where: { id: existing.id } });
  return { status: "deleted" };
};
