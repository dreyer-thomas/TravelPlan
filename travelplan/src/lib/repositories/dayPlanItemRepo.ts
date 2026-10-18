import { prisma } from "@/lib/db/prisma";
import { type PaymentDetail, toPaymentDetails } from "@/lib/repositories/paymentDetail";
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
  DayChangeEdited,
  DayChangeReceipt,
  DayPlanItemRow,
  DeletedDayPlanItemSnapshot,
  MovedItemRow,
  TravelSegmentRow,
} from "@/lib/trips/dayChangeReceipt";
// Story 11.4: the transaction helpers live in their own module so the leg and stay writes can share
// them without an import cycle; Story 13.1 replaced the push walk with the schedule rule there. The two
// names other modules import from here are re-exported.
import {
  applyScheduleChangesInTransaction,
  buildReceipt,
  DayPlanChangedError,
  findCheckInWarningInTransaction,
  planDaySchedule,
  readScheduleInputInTransaction,
  toPlanConflicts,
  type DaySchedulePastMidnight,
  type DaySchedulePlan,
  type ScheduleEdit,
} from "@/lib/repositories/dayScheduleTransaction";
import { MAX_DOCUMENTS_PER_ENTRY } from "@/lib/trips/documentUploads";
import { compareDayPlanItemsByOrder } from "@/lib/trips/dayPlanItemOrder";
import { hasValidTimes, minutesToTime, placeFixedItem, timeToMinutes, type ScheduleMode } from "@/lib/trips/daySchedule";
import { resolveDayStartMinute } from "@/lib/trips/stayTimes";
import { DEFAULT_ACTIVITY_DURATION_MINUTES } from "@/lib/trips/legacySchedule";

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
  /** Story 14.1. `null` for a parked activity (the bucket list); every day read returns a day's rows. */
  tripDayId: string | null;
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
  /** Story 13.1. How the activity is planned, its duration, and its place in the day's order. */
  scheduleMode: ScheduleMode;
  durationMinutes: number;
  sortOrder: number;
};

/**
 * Story 11.1: every create, update and delete of an activity also returns its change receipt
 * (`dayChangeReceipt.ts`) — always, even when nothing was swept, so the route never has to guess.
 */
export type DayPlanItemCreateResult = { item: DayPlanItemDetail; receipt: DayChangeReceipt };

/**
 * Story 11.2's refusals, down to one since Story 13.1: a fixed row is placed by its time instead of being
 * refused for starting before its predecessor, so only `past_midnight` is left (until Story 13.2).
 */
export type DayPlanPushRefusal = DaySchedulePastMidnight;

export { DayPlanChangedError };

/** *Nach oben* / *Nach unten*. */
export type ReorderDirection = "up" | "down";

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
  | DayPlanPushRefusal
  | { status: "deleted"; removedTravelSegmentIds: string[]; receipt: DayChangeReceipt };

/** Story 14.1. "+" on a bucket-list row: the parked activity itself moves onto the day. */
export type ParkedDayPlanItemScheduleResult =
  | { status: "not_found" }
  | { status: "missing" }
  | DayPlanPushRefusal
  | { status: "scheduled"; item: DayPlanItemDetail; receipt: DayChangeReceipt };

type DayPlanItemMutationParams = {
  userId: string;
  tripId: string;
  tripDayId: string;
  title: string;
  /**
   * Story 13.1. Absent means FIXED with `fromTime`/`toTime`, the shape every caller before 13.1 sends
   * (§14). FLEXIBLE plans by `durationMinutes` (15 when absent) and ignores any times; the schedule rule
   * works them out. FIXED stores `toTime − fromTime` as its duration, whatever `durationMinutes` says.
   */
  scheduleMode?: ScheduleMode;
  durationMinutes?: number | null;
  fromTime: string | null;
  toTime: string | null;
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


export type DayPlanItemImageDetail = {
  id: string;
  dayPlanItemId: string;
  imageUrl: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Story 14.1: `tripDayId` absent (or `null`) means the activity must be parked. The scope is the item's
 * *current* place, so a parked activity's media are reached without a day and a planned one's with it.
 */
type DayPlanItemImageScopeParams = {
  userId: string;
  tripId: string;
  tripDayId?: string | null;
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
      tripId,
      // Story 14.1: the item's current place. Through `tripId` and the item's own `trip` relation since a
      // parked activity has no day to scope through; a day id names a day of this trip because the item
      // row's `tripId` equals its day's.
      tripDayId: tripDayId ?? null,
      // The writer clause, identical to `findTripDayForTripWriter` above. Story 5.13 widened it from
      // `trip: { userId }`: a contributor may create, move and delete the activity itself, so refusing
      // her the photos and documents attached to it was chronology (Story 2.16 predates the role), not
      // a rule. The explicit `role: "CONTRIBUTOR"` is load-bearing - the role-agnostic spelling just
      // below is the *participant read* scope and admits viewers.
      trip: {
        OR: [{ userId }, { members: { some: { userId, role: "CONTRIBUTOR" } } }],
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
      tripId,
      tripDayId: tripDayId ?? null,
      // Story 14.1: a parked activity belongs to the bucket list, which only writers see (AC5), so its
      // media are read under the writer clause; a planned one's under the participant clause, as before.
      trip: tripDayId
        ? { OR: [{ userId }, { members: { some: { userId } } }] }
        : { OR: [{ userId }, { members: { some: { userId, role: "CONTRIBUTOR" } } }] },
    },
    select: { id: true },
  });

const toDetail = (item: {
  id: string;
  tripDayId: string | null;
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
  scheduleMode: ScheduleMode;
  durationMinutes: number;
  sortOrder: number;
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
  scheduleMode: item.scheduleMode,
  durationMinutes: item.durationMinutes,
  sortOrder: item.sortOrder,
});

/**
 * Story 14.1 (FR30). The rule for reading activities by trip, in one place.
 *
 * Every trip-level reader (costs, the dashboard, gantt, map, route, print, packet, suggestions) reaches
 * activities *through the day* (`tripDay: { tripId }`, `trip.days[].dayPlanItems`), and a relation
 * filter on the nullable `tripDay` never matches a parked row, so those readers need no filter. A
 * reader that queries `DayPlanItem.tripId` directly must say which side it wants: only the bucket list
 * reads `parkedDayPlanItemsWhere`, and any other reader by `tripId` uses `plannedDayPlanItemsWhere`.
 */
export const parkedDayPlanItemsWhere = (tripId: string) => ({ tripId, tripDayId: null });
export const plannedDayPlanItemsWhere = (tripId: string) => ({ tripId, tripDayId: { not: null } });

/**
 * Story 14.1. A stored row as the receipt carries it: `DayPlanItemRow` has no `tripId` (undo takes it
 * from the request) and names the receipt's day, so a row read through a day is narrowed here. Without
 * this a spread row would carry `tripId`, which the receipt schema's `.strict()` refuses on undo.
 */
const toReceiptRow = <R extends { tripId: string; tripDayId: string | null }>(row: R) => {
  const { tripId: _tripId, tripDayId, ...rest } = row;
  void _tripId;
  if (tripDayId === null) throw new Error("toReceiptRow: a parked row has no day receipt");
  return { ...rest, tripDayId };
};

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

/**
 * Stands in for the id of an activity that does not exist yet, while its create is being planned. No
 * stored leg can name it, which is exactly right: a new activity has no legs.
 */
const NEW_ITEM_ID = "\u0000new";

/**
 * Story 13.1. The schedule fields a write stores, from what the caller sent (see
 * `DayPlanItemMutationParams`). For FIXED the duration is always the true `toTime − fromTime`.
 */
const scheduleFieldsOf = (params: Pick<DayPlanItemMutationParams, "scheduleMode" | "durationMinutes" | "fromTime" | "toTime">) => {
  const scheduleMode: ScheduleMode = params.scheduleMode ?? "FIXED";
  if (scheduleMode === "FLEXIBLE") {
    return {
      scheduleMode,
      durationMinutes: params.durationMinutes ?? DEFAULT_ACTIVITY_DURATION_MINUTES,
      fromTime: null,
      toTime: null,
    };
  }
  const start = timeToMinutes(params.fromTime);
  // The start + duration form (the schema has bounded the end to the day); `toTime` wins when both came.
  const toTime =
    params.toTime ?? (start !== null && params.durationMinutes != null ? minutesToTime(start + params.durationMinutes) : null);
  const end = timeToMinutes(toTime);
  return {
    scheduleMode,
    durationMinutes: start !== null && end !== null && end > start ? end - start : (params.durationMinutes ?? DEFAULT_ACTIVITY_DURATION_MINUTES),
    fromTime: params.fromTime,
    toTime,
  };
};

/**
 * Story 13.1. Reads the day through `tx` and plans the write's recompute (`dayScheduleTransaction.ts`).
 * Called before the transaction's first write, so a refusal leaves nothing to roll back. The writer clause
 * has already found the day on the trip, so the read always finds it.
 */
const planActivityWriteInTransaction = async (
  tx: TransactionClient,
  tripId: string,
  tripDayId: string,
  edit: ScheduleEdit,
): Promise<DaySchedulePlan> => {
  const state = await readScheduleInputInTransaction(tx, tripId, tripDayId);
  if (!state) throw new Error("planActivityWriteInTransaction: the day is not on the trip");
  return planDaySchedule(state, edit);
};

/** A refusal that names the row being created names it by its title only; it has no id yet. */
const refusalOf = (refusal: DaySchedulePastMidnight): DaySchedulePastMidnight =>
  refusal.item.id === NEW_ITEM_ID ? { status: "past_midnight", item: { id: "", title: refusal.item.title } } : refusal;

type PlannedOk = Extract<DaySchedulePlan, { status: "ok" }>;

/**
 * Story 13.1. Everything after the write's own row write: the other rows' changes, 11.1's sweep, the
 * check-in warning, the receipt. `createdId` replaces the stand-in id of a created row in the conflicts.
 */
const finishActivityWriteInTransaction = async (
  tx: TransactionClient,
  params: { tripId: string; tripDayId: string; drawnBefore: ReadonlySet<string>; now: Date; createdId?: string },
  plan: PlannedOk,
  edited: DayChangeEdited,
  extras: { removedTravelSegments?: TravelSegmentRow[] } = {},
): Promise<{ receipt: DayChangeReceipt; movedItems: MovedItemRow[] }> => {
  const { tripId, tripDayId, drawnBefore, now, createdId } = params;
  const movedItems = await applyScheduleChangesInTransaction(tx, tripDayId, plan.changes, now);
  const swept = await sweepNoLongerDrawnSegmentsInTransaction(tx, { tripId, tripDayId, drawnBefore });
  const removed = extras.removedTravelSegments ?? [];
  const removedIds = new Set(removed.map((segment) => segment.id));
  const order = plan.order.map((row) => (createdId && row.id === NEW_ITEM_ID ? { ...row, id: createdId } : row));
  const checkInWarning = await findCheckInWarningInTransaction(tx, tripDayId, order, movedItems);
  const planConflicts = toPlanConflicts(plan.newConflicts).map((conflict) =>
    createdId && conflict.itemId === NEW_ITEM_ID ? { ...conflict, itemId: createdId } : conflict,
  );
  return {
    movedItems,
    receipt: buildReceipt(
      tripDayId,
      edited,
      [...removed, ...swept.filter((segment) => !removedIds.has(segment.id))],
      movedItems,
      { checkInWarning, planConflicts },
    ),
  };
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
  const { payments, images, documents } = previous;
  const snapshot: DeletedDayPlanItemSnapshot = { ...toReceiptRow(previous), payments, images, documents };
  return { status: "deleted", previous: snapshot, removedTravelSegments };
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

  return items.map((item) => toDetail({ ...item, payments: toPaymentDetails(item.payments) })).sort(compareDayPlanItemsByOrder);
};

/** `null` is "not your day", as before; a refusal carries a `status`, a success does not. */
export const createDayPlanItemForTripDay = async (
  params: DayPlanItemMutationParams,
): Promise<DayPlanItemCreateResult | DayPlanPushRefusal | null> => {
  const { userId, tripId, tripDayId, contentJson, costCents, linkUrl, location } = params;
  const tripDay = await findTripDayForTripWriter(userId, tripId, tripDayId);
  if (!tripDay) {
    return null;
  }

  return prisma.$transaction(async (tx) => {
    // Story 11.2: planned first, so a refusal returns before anything is written. Story 13.1: a FLEXIBLE
    // row is appended and scheduled, a FIXED one is placed by its time; `NEW_ITEM_ID` stands in for it.
    const now = new Date();
    const fields = scheduleFieldsOf(params);
    const plan = await planActivityWriteInTransaction(tx, tripId, tripDayId, {
      kind: "insert",
      item: { id: NEW_ITEM_ID, title: params.title.trim(), ...fields },
    });
    if (plan.status === "past_midnight") return refusalOf(plan);
    const planned = plan.edited!;

    // Story 11.1: what the day drew before this write, read through `tx` before anything changes.
    const drawnBefore = await readDrawnSegmentKeysInTransaction(tx, tripId, tripDayId);
    const item = await tx.dayPlanItem.create({
      data: {
        tripId,
        tripDayId,
        title: params.title.trim(),
        fromTime: planned.fromTime,
        toTime: planned.toTime,
        scheduleMode: fields.scheduleMode,
        durationMinutes: fields.durationMinutes,
        sortOrder: planned.sortOrder,
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

    const { receipt } = await finishActivityWriteInTransaction(
      tx,
      { tripId, tripDayId, drawnBefore, now, createdId: item.id },
      plan,
      { kind: "created", itemId: item.id, updatedAt: item.updatedAt },
    );

    const payments = await tx.costPayment.findMany({
      where: { dayPlanItemId: item.id },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { amountCents: true, dueDate: true, amountOriginal: true },
    });

    return { item: toDetail({ ...item, payments: toPaymentDetails(payments) }), receipt };
  });
};

/**
 * Story 14.1 (FR31). "+" on a bucket-list row: the parked activity **itself** moves onto the day - same
 * id, so its pictures, documents, payments, link, text and duration come along without a copy. It is
 * appended as FLEXIBLE through 13.1's insert path (the plan is told the real id, which it uses for
 * identity only), and the day is recomputed in the same transaction.
 *
 * Refusals are decided before the first write: `not_found` (not a day of this trip the user may write),
 * `missing` (no parked activity with that id on this trip - already scheduled, deleted, or another
 * trip's), and a new overflow past 23:59 (`past_midnight`, as a create refuses until Story 13.2). The
 * move itself is conditional on the item still being parked with the `updatedAt` read here; a miss is
 * `DayPlanChangedError` (409 `day_plan_changed`).
 */
export const scheduleParkedDayPlanItemForTripDay = async (params: {
  userId: string;
  tripId: string;
  tripDayId: string;
  itemId: string;
}): Promise<ParkedDayPlanItemScheduleResult> => {
  const { userId, tripId, tripDayId, itemId } = params;
  const tripDay = await findTripDayForTripWriter(userId, tripId, tripDayId);
  if (!tripDay) {
    return { status: "not_found" };
  }

  return prisma.$transaction(async (tx): Promise<ParkedDayPlanItemScheduleResult> => {
    const parked = await tx.dayPlanItem.findFirst({
      where: { id: itemId, ...parkedDayPlanItemsWhere(tripId) },
      select: { id: true, title: true, durationMinutes: true, updatedAt: true },
    });
    if (!parked) return { status: "missing" };

    const plan = await planActivityWriteInTransaction(tx, tripId, tripDayId, {
      kind: "insert",
      item: {
        id: parked.id,
        title: parked.title,
        scheduleMode: "FLEXIBLE",
        durationMinutes: parked.durationMinutes,
        fromTime: null,
        toTime: null,
      },
    });
    if (plan.status === "past_midnight") return plan;
    const planned = plan.edited!;

    const now = new Date();
    const drawnBefore = await readDrawnSegmentKeysInTransaction(tx, tripId, tripDayId);
    const moved = await tx.dayPlanItem.updateMany({
      where: { id: parked.id, ...parkedDayPlanItemsWhere(tripId), updatedAt: parked.updatedAt },
      data: {
        tripDayId,
        scheduleMode: "FLEXIBLE",
        sortOrder: planned.sortOrder,
        fromTime: planned.fromTime,
        toTime: planned.toTime,
        updatedAt: now,
      },
    });
    if (moved.count !== 1) throw new DayPlanChangedError();

    const { receipt } = await finishActivityWriteInTransaction(tx, { tripId, tripDayId, drawnBefore, now }, plan, {
      kind: "scheduled",
      itemId: parked.id,
      updatedAt: now,
      previousUpdatedAt: parked.updatedAt,
    });

    const item = await tx.dayPlanItem.findUniqueOrThrow({
      where: { id: parked.id },
      include: {
        payments: {
          select: { amountCents: true, dueDate: true, amountOriginal: true },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        },
      },
    });
    return { status: "scheduled", item: toDetail({ ...item, payments: toPaymentDetails(item.payments) }), receipt };
  });
};

export const updateDayPlanItemForTripDay = async (
  params: DayPlanItemUpdateParams,
): Promise<DayPlanItemUpdateResult> => {
  const { userId, tripId, tripDayId, itemId, contentJson, costCents, linkUrl, location, title } = params;
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

    // Story 13.1: a FLEXIBLE edit and a FIXED edit that keeps its start keep the row where it is; a row
    // that becomes FIXED, or whose fixed start changes, is placed by its time. Planned before any write.
    const now = new Date();
    const fields = scheduleFieldsOf(params);
    const plan = await planActivityWriteInTransaction(tx, tripId, tripDayId, {
      kind: "update",
      item: { id: existing.id, title: title.trim(), ...fields },
    });
    if (plan.status === "past_midnight") return plan;
    const planned = plan.edited!;

    const drawnBefore = await readDrawnSegmentKeysInTransaction(tx, tripId, tripDayId);

    const item = await tx.dayPlanItem.update({
      where: { id: existing.id },
      data: {
        title: title.trim(),
        fromTime: planned.fromTime,
        toTime: planned.toTime,
        scheduleMode: fields.scheduleMode,
        durationMinutes: fields.durationMinutes,
        sortOrder: planned.sortOrder,
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

    // `item` is the row as the update left it; replacing payments does not touch the item's own
    // `updatedAt`, so this is the post-write value undo compares against.
    const { receipt } = await finishActivityWriteInTransaction(
      tx,
      { tripId, tripDayId, drawnBefore, now },
      plan,
      { kind: "updated", itemId: item.id, updatedAt: item.updatedAt, previous: { ...toReceiptRow(existing), payments: existing.payments } },
    );

    const payments = await tx.costPayment.findMany({
      where: { dayPlanItemId: existing.id },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { amountCents: true, dueDate: true, amountOriginal: true },
    });

    return { item: toDetail({ ...item, payments: toPaymentDetails(payments) }), receipt };
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
  // a create deletes through the same core; the recompute stays out here, because undo must not run it.
  // Story 13.1: a delete now pulls the flexible rows after it forward, planned before the delete.
  return prisma.$transaction(async (tx): Promise<DayPlanItemDeleteResult> => {
    const state = await readScheduleInputInTransaction(tx, tripId, tripDayId);
    if (!state || !state.rows.some((row) => row.id === itemId)) return { status: "missing" };
    const plan = planDaySchedule(state, { kind: "remove", itemId });
    if (plan.status === "past_midnight") return plan;

    const now = new Date();
    const outcome = await deleteDayPlanItemInTransaction(tx, { tripId, tripDayId, itemId });
    if (outcome.status === "missing") return { status: "missing" };

    // The delete's own sweep already ran (against the order without the row); the recompute changes no
    // order, so the second sweep below finds nothing, and the delete's legs are passed through.
    const { receipt } = await finishActivityWriteInTransaction(
      tx,
      { tripId, tripDayId, drawnBefore: new Set(), now },
      plan,
      { kind: "deleted", previous: outcome.previous },
      { removedTravelSegments: outcome.removedTravelSegments },
    );

    // `removedTravelSegmentIds` lists *every* removed leg, referencing or swept, so the client's local
    // filter after an optimistic delete stays correct (AC2).
    return {
      status: "deleted",
      removedTravelSegmentIds: outcome.removedTravelSegments.map((segment) => segment.id),
      receipt,
    };
  });
};

/**
 * Story 11.3 (FR43), rewired by Story 13.1 §10. *Nach oben* / *Nach unten*: a FLEXIBLE activity and its
 * neighbour in `direction` (of either mode) trade places in `sortOrder`, and the day is recomputed. A
 * FIXED activity is refused (`not_reorderable`): its place follows from its time. A FIXED neighbour keeps
 * its times and is not re-placed by them (rule 4 applies only when a row *becomes* fixed or its start
 * changes). Not called "swap": that name belongs to `swapDayPlanItemsBetweenTripDays`, the whole-day
 * transfer.
 *
 * The neighbour is decided here, inside the transaction, from the day as stored; the client's view only
 * decides which controls it offers. Everything is read and planned before the first write, so a refusal
 * writes nothing. The writes are the recompute's own, each conditional on the `updatedAt` the plan read
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
    const state = await readScheduleInputInTransaction(tx, tripId, tripDayId);
    const index = state ? state.rows.findIndex((row) => row.id === itemId) : -1;
    if (!state || index < 0) {
      return { status: "missing" };
    }
    const neighbour = state.rows[direction === "up" ? index - 1 : index + 1];
    if (state.rows[index].scheduleMode !== "FLEXIBLE" || !neighbour) return { status: "not_reorderable" };

    const plan = planDaySchedule(state, { kind: "swap", itemId, neighbourId: neighbour.id });
    if (plan.status === "past_midnight") return plan;

    const now = new Date();
    const drawnBefore = await readDrawnSegmentKeysInTransaction(tx, tripId, tripDayId);
    const { receipt } = await finishActivityWriteInTransaction(tx, { tripId, tripDayId, drawnBefore, now }, plan, {
      kind: "reordered",
      itemId,
      neighbourId: neighbour.id,
    });
    return { status: "reordered", receipt };
  });
};

/**
 * Story 13.1 §11. Rewrites a day's `sortOrder` densely in `orderedIds`' order (the day's own order when
 * omitted), writing only rows whose number changes. The moves between days use it; they keep both days'
 * order dense but do not recompute times, which Story 13.3 adds.
 */
export const renumberDayInTransaction = async (tx: TransactionClient, tripDayId: string, orderedIds?: string[]) => {
  const rows = await tx.dayPlanItem.findMany({
    where: { tripDayId },
    select: { id: true, fromTime: true, createdAt: true, sortOrder: true },
  });
  const current = new Map(rows.map((row) => [row.id, row.sortOrder]));
  const ids = orderedIds ?? [...rows].sort(compareDayPlanItemsByOrder).map((row) => row.id);
  for (const [sortOrder, id] of ids.entries()) {
    if (current.get(id) !== sortOrder) {
      await tx.dayPlanItem.updateMany({ where: { id, tripDayId }, data: { sortOrder } });
    }
  }
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
 * Ordering on the new day (AC7): Story 13.1 stores the order, so the moved row gets a place on the target
 * day (a FLEXIBLE one at the end, a FIXED one by its time, `placeFixedItem`) and both days are renumbered
 * densely. Neither day is recomputed: a flexible row keeps its old times until its new day's next write,
 * a known gap that Story 13.3 closes.
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
    // Where it goes on the target day, read before the move.
    const target = await readScheduleInputInTransaction(tx, tripId, targetTripDayId);
    const movedRow = await tx.dayPlanItem.findFirst({
      where: { id: itemId, tripDayId },
      select: { id: true, title: true, scheduleMode: true, durationMinutes: true, fromTime: true, toTime: true },
    });
    const targetIds = target?.rows.map((row) => row.id) ?? [];
    let position = targetIds.length;
    if (target && movedRow && movedRow.scheduleMode === "FIXED" && hasValidTimes(movedRow)) {
      position = placeFixedItem({
        dayStartMinute: resolveDayStartMinute(target.previousStay),
        previousStayId: target.previousStay?.id ?? null,
        items: [...target.rows, movedRow],
        legs: target.legs,
        itemId,
      });
    }

    const moved = await tx.dayPlanItem.updateMany({
      where: { id: itemId, tripDayId },
      data: { tripDayId: targetTripDayId },
    });
    if (moved.count !== 1) {
      return { status: "missing" as const };
    }
    await renumberDayInTransaction(tx, tripDayId);
    await renumberDayInTransaction(tx, targetTripDayId, [...targetIds.slice(0, position), itemId, ...targetIds.slice(position)]);
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
    // Story 13.1 §11: the source day's order comes along unchanged; renumbering keeps it dense regardless.
    await renumberDayInTransaction(tx, targetTripDayId);

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
    // Story 13.1 §11: each day's order travels with it; renumbering keeps both dense regardless.
    await renumberDayInTransaction(tx, firstTripDayId);
    await renumberDayInTransaction(tx, secondTripDayId);

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
