import { prisma } from "@/lib/db/prisma";
import { type PaymentDetail, toPaymentDetails } from "@/lib/repositories/paymentDetail";
import {
  deleteBucketListItemForTripInTransaction,
  findBucketListItemForTripInTransaction,
} from "@/lib/repositories/bucketListRepo";
// Story 8.5 (`DW-215`): the segment sweep this file used to own privately now serves both members of
// `TravelSegmentItemType` and lives beside the rows it deletes. Story 11.1 made it return full rows (for
// the change receipt) and added the sweep of legs a write un-draws; the delete's `removedTravelSegmentIds`
// now lists both sets, while the move's still lists only the referencing legs, as Story 6.23 shipped.
import {
  readDrawnSegmentKeysInTransaction,
  removeTravelSegmentsReferencingItemInTransaction,
  sweepNoLongerDrawnSegmentsInTransaction,
  type TransactionClient,
} from "@/lib/repositories/travelSegmentRepo";
import type {
  DayChangeCheckInWarning,
  DayChangeEdited,
  DayChangeReceipt,
  DeletedDayPlanItemSnapshot,
  MovedItemRow,
  TravelSegmentRow,
  TripBucketListItemRow,
} from "@/lib/trips/dayChangeReceipt";
import {
  activityEndMinutes,
  planDayPush,
  planDayReorder,
  timeToMinutes,
  type PushEdit,
  type PushItem,
  type PushMove,
  type ReorderDirection,
} from "@/lib/trips/dayPlanPush";
import { MAX_DOCUMENTS_PER_ENTRY } from "@/lib/trips/documentUploads";
// Story 11.2 (`DW-216`): the last private copy of the order rule is gone; this file sorts with the
// canonical comparator, as the push walk does.
import { compareDayPlanItemsByStartTime } from "@/lib/trips/dayPlanItemOrder";

// `TransactionClient` is `travelSegmentRepo.ts`'s alias, exported for Story 11.1: this file's one
// named transaction helper (`deleteDayPlanItemInTransaction`, shared with undo) is typed against it.
// Every inline `prisma.$transaction` callback still infers its own client.

/**
 * Story 10.1, mirroring `accommodationRepo.ts`: optional inbound so every existing EUR caller stays
 * valid unchanged (AC4), required outbound so a read surface cannot quietly drop it.
 */
type PaymentInput = { amountCents: number; dueDate: string; amountOriginal?: number | null };

export type DayPlanItemDetail = {
  id: string;
  tripDayId: string;
  title: string | null;
  fromTime: string | null;
  toTime: string | null;
  contentJson: string;
  costCents: number | null;
  costOriginalAmount: number | null;
  costCurrency: string | null;
  costRate: number | null;
  costRateDate: string | null;
  payments: PaymentDetail[];
  linkUrl: string | null;
  location: { lat: number; lng: number; label: string | null } | null;
  createdAt: Date;
};

/**
 * Story 11.1: every create, update and delete of an activity also returns its change receipt
 * (`dayChangeReceipt.ts`) — always, even when nothing was swept, so the route never has to guess.
 */
export type DayPlanItemCreateResult = { item: DayPlanItemDetail; receipt: DayChangeReceipt };

/**
 * Story 11.2. The push rule's two refusals (`dayPlanPush.ts`), decided before the first write of the
 * transaction, so a refused change writes nothing: no row, no swept leg, no consumed idea.
 */
export type DayPlanPushRefusal =
  | { status: "before_predecessor"; predecessor: { id: string; title: string | null; fromTime: string } }
  | { status: "past_midnight"; item: { id: string; title: string | null } };

/**
 * Story 11.2. A pushed activity changed between the transaction's read and its conditional write: another
 * write slipped in. Thrown inside the transaction so all of it rolls back; the route maps it to
 * `409 day_plan_changed`.
 */
export class DayPlanChangedError extends Error {
  constructor() {
    super("A pushed activity changed during the write");
    this.name = "DayPlanChangedError";
  }
}

export type DayPlanItemUpdateResult =
  | { status: "not_found" }
  | { status: "missing" }
  | DayPlanPushRefusal
  | { status: "updated"; item: DayPlanItemDetail; receipt: DayChangeReceipt };

/** Story 11.3. *Nach oben* / *Nach unten*; refusals are decided before the transaction's first write. */
export type DayPlanItemReorderResult =
  | { status: "not_found" }
  | { status: "missing" }
  | { status: "not_reorderable" }
  | { status: "past_midnight"; item: { id: string; title: string | null } }
  | { status: "reordered"; receipt: DayChangeReceipt };

export type DayPlanItemDeleteResult =
  | { status: "not_found" }
  | { status: "missing" }
  | { status: "deleted"; removedTravelSegmentIds: string[]; receipt: DayChangeReceipt };

export type DayPlanItemConversionResult =
  | { status: "not_found" }
  | { status: "bucket_missing" }
  | DayPlanPushRefusal
  | { status: "created"; item: DayPlanItemDetail; receipt: DayChangeReceipt };

type DayPlanItemMutationParams = {
  userId: string;
  tripId: string;
  tripDayId: string;
  title: string;
  fromTime: string;
  toTime: string;
  contentJson: string;
  costCents?: number | null;
  costOriginalAmount?: number | null;
  costCurrency?: string | null;
  costRate?: number | null;
  costRateDate?: string | null;
  payments?: PaymentInput[] | null;
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
        // The writer clause, identical to `findTripDayForTripWriter` above. Story 5.13 widened it from
        // `trip: { userId }`: a contributor may create, move and delete the activity itself, so refusing
        // her the photos and documents attached to it was chronology (Story 2.16 predates the role), not
        // a rule. The explicit `role: "CONTRIBUTOR"` is load-bearing - the role-agnostic spelling just
        // below is the *participant read* scope and admits viewers.
        trip: {
          OR: [{ userId }, { members: { some: { userId, role: "CONTRIBUTOR" } } }],
        },
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
  costOriginalAmount: number | null;
  costCurrency: string | null;
  costRate: number | null;
  costRateDate: string | null;
  payments?: PaymentDetail[];
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
  costOriginalAmount: item.costOriginalAmount,
  costCurrency: item.costCurrency,
  costRate: item.costRate,
  costRateDate: item.costRateDate,
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

/** Payments in the order PATCH wrote them (`sortOrder`), which is the order undo writes them back in. */
const paymentSnapshotOrder = [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }];
const mediaSnapshotOrder = [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }];

const buildReceipt = (
  tripDayId: string,
  edited: DayChangeEdited,
  removedTravelSegments: TravelSegmentRow[],
  movedItems: MovedItemRow[],
  extras: { consumedBucketListItem?: TripBucketListItemRow; checkInWarning?: DayChangeCheckInWarning } = {},
): DayChangeReceipt => ({
  version: 2,
  tripDayId,
  edited,
  removedTravelSegments,
  movedItems,
  ...(extras.consumedBucketListItem ? { consumedBucketListItem: extras.consumedBucketListItem } : {}),
  ...(extras.checkInWarning ? { checkInWarning: extras.checkInWarning } : {}),
});

/**
 * Stands in for the id of an activity that does not exist yet, while its create is being planned. No
 * stored leg can name it, which is exactly right: a new activity has no legs.
 */
const NEW_ITEM_ID = "\u0000new";

type PlannedPush = {
  order: PushItem[];
  moves: PushMove[];
  /** The `updatedAt` each row had when the plan was read: the condition its move is written under. */
  readUpdatedAt: Map<string, Date>;
};

/**
 * The day's activities (with the `updatedAt` each move is written under) and its activity-to-activity
 * legs, read through `tx`: the walk's whole input. Shared by the push (Story 11.2) and the reorder (11.3).
 */
const readPushInputInTransaction = (tx: TransactionClient, tripDayId: string) =>
  Promise.all([
    tx.dayPlanItem.findMany({
      where: { tripDayId },
      select: { id: true, title: true, fromTime: true, toTime: true, createdAt: true, updatedAt: true },
    }),
    tx.travelSegment.findMany({
      where: { tripDayId, fromItemType: "DAY_PLAN_ITEM", toItemType: "DAY_PLAN_ITEM" },
      select: { fromItemId: true, toItemId: true, durationMinutes: true },
    }),
  ]);

/**
 * Story 11.2 AC11. Reads the day's activities and its activity-to-activity legs through `tx` and plans
 * the push. Called before the transaction's first write, so a refusal leaves nothing to roll back.
 */
const planPushInTransaction = async (
  tx: TransactionClient,
  tripDayId: string,
  edit: PushEdit,
): Promise<PlannedPush | DayPlanPushRefusal> => {
  const [items, legs] = await readPushInputInTransaction(tx, tripDayId);

  const plan = planDayPush({ items, legs, edit });
  if (plan.status !== "ok") return plan;
  return {
    order: plan.order,
    moves: plan.moves,
    readUpdatedAt: new Map(items.map((item) => [item.id, item.updatedAt])),
  };
};

/**
 * Writes each move conditionally on the `updatedAt` the plan read, all stamped with the transaction's
 * one `now`. A miss means another write got in between: throw, and the whole change rolls back.
 */
const applyPushMovesInTransaction = async (
  tx: TransactionClient,
  tripDayId: string,
  planned: PlannedPush,
  now: Date,
): Promise<MovedItemRow[]> => {
  const movedItems: MovedItemRow[] = [];
  for (const move of planned.moves) {
    const previousUpdatedAt = planned.readUpdatedAt.get(move.itemId);
    if (!previousUpdatedAt) throw new DayPlanChangedError();
    const written = await tx.dayPlanItem.updateMany({
      where: { id: move.itemId, tripDayId, updatedAt: previousUpdatedAt },
      data: { fromTime: move.fromTime, toTime: move.toTime, updatedAt: now },
    });
    if (written.count !== 1) throw new DayPlanChangedError();
    movedItems.push({
      itemId: move.itemId,
      previousFromTime: move.previousFromTime,
      previousToTime: move.previousToTime,
      previousUpdatedAt,
      updatedAt: now,
    });
  }
  return movedItems;
};

/**
 * Story 11.2 AC9. Only after a change that moved something, and only against an explicit check-in: the
 * 16:00 default lives in the client and never warns. The last timed activity's end, plus the stored leg
 * from it to the night's stay when that leg is drawn (the activity is the day's last, with no untimed
 * one after it), compared in plain minutes; the sum may pass midnight and is never formatted.
 */
const findCheckInWarningInTransaction = async (
  tx: TransactionClient,
  tripDayId: string,
  planned: PlannedPush,
): Promise<DayChangeCheckInWarning | undefined> => {
  if (planned.moves.length === 0) return undefined;

  const day = await tx.tripDay.findUnique({
    where: { id: tripDayId },
    select: { accommodation: { select: { id: true, checkInTime: true } } },
  });
  const stay = day?.accommodation;
  const checkInTime = stay?.checkInTime?.trim();
  if (!stay || !checkInTime) return undefined;
  const checkInMinutes = timeToMinutes(checkInTime);
  if (checkInMinutes === null) return undefined;

  const timed = planned.order.filter((item) => Boolean(item.fromTime));
  const last = timed.at(-1);
  if (!last) return undefined;
  const lastEnd = activityEndMinutes(last);
  if (lastEnd === null) return undefined;

  let arrival = lastEnd;
  if (planned.order.at(-1) === last) {
    const legToStay = await tx.travelSegment.findFirst({
      where: {
        tripDayId,
        fromItemType: "DAY_PLAN_ITEM",
        fromItemId: last.id,
        toItemType: "ACCOMMODATION",
        toItemId: stay.id,
      },
      select: { durationMinutes: true },
    });
    arrival += legToStay?.durationMinutes ?? 0;
  }

  return arrival > checkInMinutes ? { accommodationId: stay.id, checkInTime } : undefined;
};

export type DayPlanItemInTransactionDeleteResult =
  | { status: "missing" }
  | { status: "deleted"; previous: DeletedDayPlanItemSnapshot; removedTravelSegments: TravelSegmentRow[] };

/**
 * Story 11.1. The body of an activity delete, through `tx`, so the undo of a *create*
 * (`dayPlanChangeRepo.ts`) deletes through exactly the path `DELETE` does (AC5).
 *
 * It snapshots the item with everything its cascade takes — payments, image rows, document rows — so the
 * undo of a delete can bring all of them back; the files themselves stay on disk because this delete has
 * never unlinked them (see the story's *Read this first* §2, and the ledger entry recorded there). Then
 * it deletes the item, the legs referencing it (Story 6.23), and the legs its absence un-draws (11.1),
 * and returns the union of the two leg sets once each.
 *
 * Like the move below, the existence check *is* the write: `deleteMany` scoped by `[id, tripDayId]`.
 */
export const deleteDayPlanItemInTransaction = async (
  tx: TransactionClient,
  params: { tripId: string; tripDayId: string; itemId: string },
): Promise<DayPlanItemInTransactionDeleteResult> => {
  const { tripId, tripDayId, itemId } = params;
  const previous = await tx.dayPlanItem.findFirst({
    where: { id: itemId, tripDayId },
    include: {
      payments: { orderBy: paymentSnapshotOrder },
      images: { orderBy: mediaSnapshotOrder },
      documents: { orderBy: mediaSnapshotOrder },
    },
  });
  if (!previous) {
    return { status: "missing" };
  }

  const drawnBefore = await readDrawnSegmentKeysInTransaction(tx, tripId, tripDayId);
  const deleted = await tx.dayPlanItem.deleteMany({ where: { id: itemId, tripDayId } });
  if (deleted.count !== 1) {
    return { status: "missing" };
  }
  const referencing = await removeTravelSegmentsReferencingItemInTransaction(
    tx,
    [tripDayId],
    "DAY_PLAN_ITEM",
    itemId,
  );
  const swept = await sweepNoLongerDrawnSegmentsInTransaction(tx, { tripId, tripDayId, drawnBefore });

  const removedIds = new Set(referencing.map((segment) => segment.id));
  const removedTravelSegments = [...referencing, ...swept.filter((segment) => !removedIds.has(segment.id))];
  return { status: "deleted", previous, removedTravelSegments };
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
        select: { amountCents: true, dueDate: true, amountOriginal: true },
        orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
      },
    },
  });

  return items.map((item) => toDetail({ ...item, payments: toPaymentDetails(item.payments) })).sort(compareDayPlanItemsByStartTime);
};

/** `null` is "not your day", as before; a refusal carries a `status`, a success does not. */
export const createDayPlanItemForTripDay = async (
  params: DayPlanItemMutationParams,
): Promise<DayPlanItemCreateResult | DayPlanPushRefusal | null> => {
  const { userId, tripId, tripDayId, contentJson, costCents, linkUrl, location, fromTime, toTime } = params;
  const tripDay = await findTripDayForTripWriter(userId, tripId, tripDayId);
  if (!tripDay) {
    return null;
  }

  return prisma.$transaction(async (tx) => {
    // Story 11.2: the push is planned first, so a refusal returns before anything is written. The new
    // row's `createdAt` is not known yet; `now` sorts it last among equal starts, where a fresh row sorts.
    const now = new Date();
    const planned = await planPushInTransaction(tx, tripDayId, {
      kind: "insert",
      item: { id: NEW_ITEM_ID, title: params.title.trim(), fromTime, toTime, createdAt: now },
    });
    if ("status" in planned) return planned;

    // Story 11.1: what the day drew before this write, read through `tx` before anything changes.
    const drawnBefore = await readDrawnSegmentKeysInTransaction(tx, tripId, tripDayId);
    const item = await tx.dayPlanItem.create({
      data: {
        tripDayId,
        title: params.title.trim(),
        fromTime,
        toTime,
        contentJson,
        costCents: costCents ?? null,
        costOriginalAmount: params.costOriginalAmount ?? null,
        costCurrency: params.costCurrency ?? null,
        costRate: params.costRate ?? null,
        costRateDate: params.costRateDate ?? null,
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
            amountOriginal: payment.amountOriginal ?? null,
            dueDate: payment.dueDate,
            sortOrder: index,
          })),
        });
      }
    }

    const movedItems = await applyPushMovesInTransaction(tx, tripDayId, planned, now);
    const removed = await sweepNoLongerDrawnSegmentsInTransaction(tx, { tripId, tripDayId, drawnBefore });
    const checkInWarning = await findCheckInWarningInTransaction(tx, tripDayId, planned);

    const payments = await tx.costPayment.findMany({
      where: { dayPlanItemId: item.id },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { amountCents: true, dueDate: true, amountOriginal: true },
    });

    return {
      item: toDetail({ ...item, payments: toPaymentDetails(payments) }),
      receipt: buildReceipt(
        tripDayId,
        { kind: "created", itemId: item.id, updatedAt: item.updatedAt },
        removed,
        movedItems,
        { checkInWarning },
      ),
    };
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
      return { status: "bucket_missing" as const };
    }

    // Story 11.2: planned before the create and before the idea is deleted, so a refusal leaves it in place.
    const now = new Date();
    const planned = await planPushInTransaction(tx, tripDayId, {
      kind: "insert",
      item: { id: NEW_ITEM_ID, title: params.title.trim(), fromTime, toTime, createdAt: now },
    });
    if ("status" in planned) return planned;

    // Story 11.1: the idea as it was, so undoing the conversion brings it back rather than destroying it.
    const consumedBucketListItem = await tx.tripBucketListItem.findUniqueOrThrow({ where: { id: bucketItem.id } });
    const drawnBefore = await readDrawnSegmentKeysInTransaction(tx, tripId, tripDayId);

    const created = await tx.dayPlanItem.create({
      data: {
        tripDayId,
        title: params.title.trim(),
        fromTime,
        toTime,
        contentJson,
        costCents: costCents ?? null,
        costOriginalAmount: params.costOriginalAmount ?? null,
        costCurrency: params.costCurrency ?? null,
        costRate: params.costRate ?? null,
        costRateDate: params.costRateDate ?? null,
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
            amountOriginal: payment.amountOriginal ?? null,
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

    const movedItems = await applyPushMovesInTransaction(tx, tripDayId, planned, now);
    const removed = await sweepNoLongerDrawnSegmentsInTransaction(tx, { tripId, tripDayId, drawnBefore });
    const checkInWarning = await findCheckInWarningInTransaction(tx, tripDayId, planned);

    const payments = await tx.costPayment.findMany({
      where: { dayPlanItemId: created.id },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { amountCents: true, dueDate: true, amountOriginal: true },
    });

    return {
      status: "created" as const,
      item: toDetail({ ...created, payments: toPaymentDetails(payments) }),
      receipt: buildReceipt(
        tripDayId,
        { kind: "created", itemId: created.id, updatedAt: created.updatedAt },
        removed,
        movedItems,
        { consumedBucketListItem, checkInWarning },
      ),
    };
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

  // Story 11.1: the read moved inside the transaction. It is now the receipt's "previous state", and a
  // snapshot taken outside would let a concurrent write slip in between it and the write it describes.
  const outcome = await prisma.$transaction(async (tx) => {
    const existing = await tx.dayPlanItem.findFirst({
      where: { id: itemId, tripDayId },
      include: { payments: { orderBy: paymentSnapshotOrder } },
    });
    if (!existing) {
      return null;
    }

    // Story 11.2: an already-timed activity is retimed in place (and may be refused for starting before
    // its predecessor); an untimed one given a time is inserted where it sorts. Planned before any write.
    const now = new Date();
    const planned = await planPushInTransaction(
      tx,
      tripDayId,
      existing.fromTime
        ? { kind: "retime", itemId: existing.id, fromTime, toTime }
        : { kind: "insert", item: { id: existing.id, title: title.trim(), fromTime, toTime, createdAt: existing.createdAt } },
    );
    if ("status" in planned) return planned;

    const drawnBefore = await readDrawnSegmentKeysInTransaction(tx, tripId, tripDayId);

    const item = await tx.dayPlanItem.update({
      where: { id: existing.id },
      data: {
        title: title.trim(),
        fromTime,
        toTime,
        contentJson,
        costCents: costCents ?? null,
        costOriginalAmount: params.costOriginalAmount ?? null,
        costCurrency: params.costCurrency ?? null,
        costRate: params.costRate ?? null,
        costRateDate: params.costRateDate ?? null,
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
            amountOriginal: payment.amountOriginal ?? null,
            dueDate: payment.dueDate,
            sortOrder: index,
          })),
        });
      }
    }

    const movedItems = await applyPushMovesInTransaction(tx, tripDayId, planned, now);
    const removed = await sweepNoLongerDrawnSegmentsInTransaction(tx, { tripId, tripDayId, drawnBefore });
    const checkInWarning = await findCheckInWarningInTransaction(tx, tripDayId, planned);

    const payments = await tx.costPayment.findMany({
      where: { dayPlanItemId: existing.id },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { amountCents: true, dueDate: true, amountOriginal: true },
    });

    // `item` is the row as the update left it; replacing payments does not touch the item's own
    // `updatedAt`, so this is the post-write value undo compares against.
    return {
      item: toDetail({ ...item, payments: toPaymentDetails(payments) }),
      receipt: buildReceipt(
        tripDayId,
        { kind: "updated", itemId: item.id, updatedAt: item.updatedAt, previous: existing },
        removed,
        movedItems,
        { checkInWarning },
      ),
    };
  });

  if (!outcome) {
    return { status: "missing" };
  }
  if ("status" in outcome) {
    return outcome;
  }

  return { status: "updated", item: outcome.item, receipt: outcome.receipt };
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
  // an activity that is gone. The body is `deleteDayPlanItemInTransaction` (Story 11.1), so the undo of
  // a create deletes through the same core. The delete runs before the sweeps so that a "missing"
  // outcome touches nothing; the segments have no FK to the item, so neither order cascades.
  const outcome = await prisma.$transaction((tx) => deleteDayPlanItemInTransaction(tx, { tripId, tripDayId, itemId }));

  if (outcome.status === "missing") {
    return { status: "missing" };
  }

  // `removedTravelSegmentIds` lists *every* removed leg, referencing or swept, so the client's local
  // filter after an optimistic delete stays correct (AC2).
  return {
    status: "deleted",
    removedTravelSegmentIds: outcome.removedTravelSegments.map((segment) => segment.id),
    // Story 11.2 AC3: a delete never pulls anything forward, so nothing moved.
    receipt: buildReceipt(tripDayId, { kind: "deleted", previous: outcome.previous }, outcome.removedTravelSegments, []),
  };
};

/**
 * Story 11.3 (FR43). *Nach oben* / *Nach unten*: the activity and its timed neighbour in `direction`
 * trade places (`planDayReorder`), and the 11.2 walk pushes what follows. Not called "swap": that name
 * belongs to `swapDayPlanItemsBetweenTripDays`, the whole-day transfer.
 *
 * The neighbour is decided here, inside the transaction, from the day as stored; the client's view only
 * decides which controls it offers. Everything is read and planned before the first write, so a refusal
 * writes nothing. The writes are the push's own: each time conditional on the `updatedAt` the plan read
 * (`DayPlanChangedError` rolls the whole change back), then 11.1's sweep of every leg the new order no
 * longer draws. Nothing creates or reverses a leg.
 */
export const reorderDayPlanItemForTripDay = async (params: {
  userId: string;
  tripId: string;
  tripDayId: string;
  itemId: string;
  direction: ReorderDirection;
}): Promise<DayPlanItemReorderResult> => {
  const { userId, tripId, tripDayId, itemId, direction } = params;
  const tripDay = await findTripDayForTripWriter(userId, tripId, tripDayId);
  if (!tripDay) {
    return { status: "not_found" };
  }

  return prisma.$transaction(async (tx): Promise<DayPlanItemReorderResult> => {
    const [items, legs] = await readPushInputInTransaction(tx, tripDayId);
    if (!items.some((item) => item.id === itemId)) {
      return { status: "missing" };
    }

    const plan = planDayReorder({ items, legs, itemId, direction });
    if (plan.status !== "ok") return plan;
    const planned: PlannedPush = {
      order: plan.order,
      moves: plan.moves,
      readUpdatedAt: new Map(items.map((item) => [item.id, item.updatedAt])),
    };

    const now = new Date();
    const drawnBefore = await readDrawnSegmentKeysInTransaction(tx, tripId, tripDayId);
    const movedItems = await applyPushMovesInTransaction(tx, tripDayId, planned, now);
    const removed = await sweepNoLongerDrawnSegmentsInTransaction(tx, { tripId, tripDayId, drawnBefore });
    const checkInWarning = await findCheckInWarningInTransaction(tx, tripDayId, planned);

    return {
      status: "reordered",
      receipt: buildReceipt(
        tripDayId,
        { kind: "reordered", itemId: plan.itemId, neighbourId: plan.neighbourId },
        removed,
        movedItems,
        { checkInWarning },
      ),
    };
  });
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
    const removed = await removeTravelSegmentsReferencingItemInTransaction(
      tx,
      [tripDayId, targetTripDayId],
      "DAY_PLAN_ITEM",
      itemId,
    );
    return { status: "moved" as const, removedTravelSegmentIds: removed.map((segment) => segment.id) };
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
