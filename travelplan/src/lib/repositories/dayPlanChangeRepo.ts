import path from "node:path";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { deleteDayPlanItemInTransaction } from "@/lib/repositories/dayPlanItemRepo";
import {
  buildStoredSegmentPairKey,
  buildSegmentTimelineInTransaction,
  readDrawnSegmentKeysInTransaction,
  type TransactionClient,
} from "@/lib/repositories/travelSegmentRepo";
import type { DayChangeReceipt, DayPlanItemRow, DayPlanItemSnapshot } from "@/lib/trips/dayChangeReceipt";
import { buildDrawnDaySegmentPairKeys } from "@/lib/trips/daySegmentPairs";
import {
  getTripUploadDir,
  isExternalMediaUrl,
  mediaPathIsInside,
  resolveStoredMediaPath,
} from "@/lib/trips/uploadPaths";

/**
 * Story 11.1 AC5/AC6/AC12. Takes a whole day-plan change back in one transaction, from the receipt the
 * write returned — or refuses, writing nothing, when the day has moved on since.
 *
 * Three phases, in this order, all inside one `prisma.$transaction`:
 *
 * 1. **Staleness.** Every row the change left in place must still carry the `updatedAt` the receipt
 *    recorded, and every row the change removed must still be absent. Anything else means a later edit
 *    exists, and an undo never overwrites a later edit. Story 11.2: that includes every activity the push
 *    rule moved (`movedItems`), each on the receipt's day with the post-write `updatedAt` it recorded.
 * 2. **The reverse.** Items before legs, so the post-condition sees the final timeline: the edited item
 *    first, then each moved activity back to its previous times and `updatedAt` (Story 11.2), then the
 *    legs. Restoring the times restores the original order, so the drawn sets of phase 3 hold.
 * 3. **The post-condition.** Every restored leg is *drawn* on the final timeline — its endpoints are
 *    there and consecutive, so undo never resurrects a leg pointing at nothing, nor one that a later edit
 *    has since put something between (that would only refill Story 8.5's orphan list, and from a forged
 *    receipt would create a pair the segment route refuses as `not_adjacent`). And every leg *not* in the
 *    receipt that was drawn before the undo is still drawn after it (undo never orphans a leg it did not
 *    delete).
 *
 * Story 11.3: a `reordered` receipt (*Nach oben* / *Nach unten*) has no edited-item write at all. The two
 * activities that traded places are both in `movedItems`, so phases 1 and 2 check and restore them with
 * every pushed one, and restoring their times restores the order phase 3 relies on.
 *
 * Story 11.4 adds the leg and check-out kinds. `legCreated` deletes the leg and `legUpdated` writes its
 * previous row back in full; both are conditional on the leg's post-write stamp, and the receipt's own
 * leg is left out of the post-condition's protected set (it is drawn before the undo and is the very row
 * the undo deletes or rewrites). `stayCheckOutChanged` puts back only the check-out and the stay's
 * `updatedAt`, conditional on the stamp, and only for the stay of the night before the receipt's (pushed)
 * day. None of them ever removed a leg, so a non-empty `removedTravelSegments` is a forgery.
 *
 * Story 12.4 adds `suggestionsApplied`: the activities, legs and image rows one apply of picked
 * suggestions created. Phase 1 refuses when any of them changed or gained something the apply did not
 * create (an image, a document, a leg); phase 2 deletes the legs, then the activities through the same
 * delete as the other kinds, then restores the legs the apply swept. The image *files* go only after the
 * transaction commits, and only those of the rows read inside it (the route does that): nothing else can
 * point at them, because the activities they belonged to are gone (unlike a deleted item, whose undo
 * recreates rows that point at its files - DW-187 stays as it is).
 *
 * Story 13.1 (version 3). Every write recomputes the day, so `movedItems` also lists rows only renumbered;
 * phase 1 checks every one of them and phase 2 restores `fromTime`, `toTime`, `sortOrder` and `updatedAt`.
 * The snapshots carry `scheduleMode`, `durationMinutes` and `sortOrder`, so `updated` and `deleted` put
 * them back with the other columns. `legDeleted` re-creates the leg with its id and stamps: refused when
 * the id exists again, and a `P2002` (the pair has a leg again) maps to `stale`, as for removed legs.
 *
 * Any failure throws `UndoStaleError`, which rolls the transaction back and maps to `stale`. A `P2002`
 * while recreating a row maps there too: someone drew a new leg for the same pair, or reused the id.
 *
 * Before the transaction, the receipt is checked against the trip it claims to belong to (`invalid`):
 * the endpoint must be no more powerful than the write endpoints it reverses.
 */

/** Story 12.4. An image row the undo deleted: its file is the route's to remove after the commit. */
export type UndoneImageFile = { dayPlanItemId: string; imageUrl: string };

export type DayPlanChangeUndoResult =
  | { status: "not_found" }
  | { status: "invalid"; reason: string }
  | { status: "stale" }
  /** `removedImageFiles` only when the undo deleted image rows (Story 12.4); every other kind answers as before. */
  | { status: "undone"; removedImageFiles?: UndoneImageFile[] };

export class UndoStaleError extends Error {
  constructor(reason: string) {
    super(`Undo refused: ${reason}`);
    this.name = "UndoStaleError";
  }
}

/** `updatedAt` by epoch milliseconds, never by `Date` identity. SQLite stores milliseconds. */
const sameInstant = (left: Date, right: Date) => left.getTime() === right.getTime();

/**
 * Whether a stored media URL resolves into this trip's own upload tree. The resolved-path containment
 * from `uploadPaths.ts` (Story 8.4), not a string prefix: `/uploads/trips/<this>/../<other>/x` starts
 * with the right prefix and resolves into another trip. An external URL is never "inside" — the item
 * media routes store nothing but upload paths, so a restored image or document has no business naming
 * one.
 */
const isInsideTripUploadTree = (storedUrl: string, tripId: string) => {
  if (!storedUrl || isExternalMediaUrl(storedUrl)) return false;
  return mediaPathIsInside(path.resolve(resolveStoredMediaPath(storedUrl)), path.resolve(getTripUploadDir(tripId)));
};

const findWritableTripDay = (userId: string, tripId: string, tripDayId: string) =>
  prisma.tripDay.findFirst({
    where: {
      id: tripDayId,
      tripId,
      // Story 5.13's writer clause, identical to `findTripDayForTripWriter`: a contributor may undo
      // exactly as she may write.
      trip: { OR: [{ userId }, { members: { some: { userId, role: "CONTRIBUTOR" } } }] },
    },
    select: { id: true },
  });

/** The ownership half of AC12; the shape half is `dayChangeReceiptSchemas.ts`. */
const findInvalidity = (receipt: DayChangeReceipt, tripId: string): string | null => {
  const { tripDayId, edited } = receipt;

  const legIds = new Set<string>();
  for (const leg of receipt.removedTravelSegments) {
    if (leg.tripDayId !== tripDayId) return "leg on another day";
    if (legIds.has(leg.id)) return "duplicate leg";
    legIds.add(leg.id);
  }

  if (edited.kind === "updated" || edited.kind === "deleted") {
    const previous = edited.previous;
    if (previous.tripDayId !== tripDayId) return "item on another day";
    if (edited.kind === "updated" && previous.id !== edited.itemId) return "snapshot of another item";
    if (previous.payments.some((payment) => payment.dayPlanItemId !== previous.id || payment.accommodationId !== null)) {
      return "payment of another entry";
    }
  }

  if (edited.kind === "deleted") {
    const { id, images, documents } = edited.previous;
    if (images.some((image) => image.dayPlanItemId !== id)) return "image of another item";
    if (documents.some((document) => document.dayPlanItemId !== id)) return "document of another item";
    if (images.some((image) => !isInsideTripUploadTree(image.imageUrl, tripId))) return "image outside the trip";
    if (documents.some((document) => !isInsideTripUploadTree(document.documentUrl, tripId))) {
      return "document outside the trip";
    }
  }

  // Story 11.2: the push never moves the edited activity, and moves each other one at most once.
  // Story 11.3: a reorder's two activities are the exception; both must be listed as moved.
  // Story 11.4: a leg or check-out save edits no activity, so only the activity kinds have an edited id.
  const movedIds = new Set<string>();
  const editedId =
    edited.kind === "deleted"
      ? edited.previous.id
      : edited.kind === "created" || edited.kind === "updated"
        ? edited.itemId
        : null;
  for (const moved of receipt.movedItems) {
    if (movedIds.has(moved.itemId)) return "duplicate moved item";
    if (editedId !== null && moved.itemId === editedId) return "edited item listed as moved";
    movedIds.add(moved.itemId);
  }
  if (edited.kind === "reordered") {
    if (edited.itemId === edited.neighbourId) return "reordered with itself";
    if (!movedIds.has(edited.itemId) || !movedIds.has(edited.neighbourId)) return "reordered pair not listed as moved";
  }

  if (
    edited.kind === "legCreated" ||
    edited.kind === "legUpdated" ||
    edited.kind === "legDeleted" ||
    edited.kind === "stayCheckOutChanged"
  ) {
    if (receipt.removedTravelSegments.length > 0) return "side effect a leg or stay save never has";
  }
  if (edited.kind === "legUpdated" || edited.kind === "legDeleted") {
    if (edited.previous.id !== edited.segmentId) return "snapshot of another leg";
    if (edited.previous.tripDayId !== tripDayId) return "leg on another day";
  }

  if (edited.kind === "suggestionsApplied") {
    // An apply only appends: it never moves an existing activity.
    if (receipt.movedItems.length > 0) return "side effect an apply never has";
    if (new Set(edited.items.map((item) => item.itemId)).size !== edited.items.length) return "duplicate item";
    if (new Set(edited.segments.map((segment) => segment.segmentId)).size !== edited.segments.length) return "duplicate leg";
    if (edited.segments.some((segment) => legIds.has(segment.segmentId))) return "leg both created and removed";
    if (new Set(edited.imageIds).size !== edited.imageIds.length) return "duplicate image";
  }

  if (receipt.consumedBucketListItem) {
    // Only a create can consume an idea; any other pairing is not something a write ever returned.
    if (edited.kind !== "created") return "bucket-list row on a non-create";
    if (receipt.consumedBucketListItem.tripId !== tripId) return "bucket-list row of another trip";
  }

  return null;
};

/** Every `DayPlanItem` column of a snapshot, without the relations, for a create or an update. */
const itemColumns = (snapshot: DayPlanItemSnapshot): DayPlanItemRow => {
  const { payments: _payments, ...columns } = snapshot;
  void _payments;
  return columns;
};

const restorePayments = async (tx: TransactionClient, snapshot: DayPlanItemSnapshot) => {
  await tx.costPayment.deleteMany({ where: { dayPlanItemId: snapshot.id } });
  if (snapshot.payments.length > 0) {
    await tx.costPayment.createMany({ data: snapshot.payments });
  }
};

/**
 * Story 12.4, phase 1 for `suggestionsApplied`. Every created activity and leg must still be on the day with
 * the stamp the apply gave it, and nothing may have been added to the activities since: no image the apply
 * did not create, no document, no leg it did not create. Returns the image rows phase 2 will take with
 * the activities, read here, inside the transaction, so the files removed later are the rows' own.
 */
const checkSuggestionsAppliedInTransaction = async (
  tx: TransactionClient,
  tripDayId: string,
  edited: Extract<DayChangeReceipt["edited"], { kind: "suggestionsApplied" }>,
): Promise<UndoneImageFile[]> => {
  const itemIds = edited.items.map((item) => item.itemId);
  const segmentIds = new Set(edited.segments.map((segment) => segment.segmentId));

  const items = await tx.dayPlanItem.findMany({ where: { id: { in: itemIds }, tripDayId }, select: { id: true, updatedAt: true } });
  const itemStamps = new Map(items.map((item) => [item.id, item.updatedAt]));
  for (const item of edited.items) {
    const stamp = itemStamps.get(item.itemId);
    if (!stamp || !sameInstant(stamp, item.updatedAt)) throw new UndoStaleError("applied item changed");
  }

  const segments = await tx.travelSegment.findMany({
    where: { id: { in: [...segmentIds] }, tripDayId },
    select: { id: true, updatedAt: true },
  });
  const segmentStamps = new Map(segments.map((segment) => [segment.id, segment.updatedAt]));
  for (const segment of edited.segments) {
    const stamp = segmentStamps.get(segment.segmentId);
    if (!stamp || !sameInstant(stamp, segment.updatedAt)) throw new UndoStaleError("applied leg changed");
  }

  const [images, documents, referencing] = await Promise.all([
    tx.dayPlanItemImage.findMany({ where: { dayPlanItemId: { in: itemIds } }, select: { id: true, dayPlanItemId: true, imageUrl: true } }),
    tx.dayPlanItemDocument.count({ where: { dayPlanItemId: { in: itemIds } } }),
    tx.travelSegment.findMany({
      where: {
        OR: [
          { fromItemType: "DAY_PLAN_ITEM", fromItemId: { in: itemIds } },
          { toItemType: "DAY_PLAN_ITEM", toItemId: { in: itemIds } },
        ],
      },
      select: { id: true },
    }),
  ]);
  const receiptImageIds = new Set(edited.imageIds);
  if (images.some((image) => !receiptImageIds.has(image.id))) throw new UndoStaleError("applied item gained an image");
  if (documents > 0) throw new UndoStaleError("applied item gained a document");
  if (referencing.some((leg) => !segmentIds.has(leg.id))) throw new UndoStaleError("applied item gained a leg");

  return images.map((image) => ({ dayPlanItemId: image.dayPlanItemId, imageUrl: image.imageUrl }));
};

const undoInTransaction = async (
  tx: TransactionClient,
  tripId: string,
  receipt: DayChangeReceipt,
): Promise<UndoneImageFile[]> => {
  const { tripDayId, edited } = receipt;

  // What the day draws before the undo, and which of its legs the receipt does not own. The second set
  // is what the post-condition protects.
  const drawnBeforeUndo = await readDrawnSegmentKeysInTransaction(tx, tripId, tripDayId);
  const receiptLegIds = new Set(receipt.removedTravelSegments.map((leg) => leg.id));
  // Story 11.4: the leg a leg save wrote is the undo's own to delete or rewrite, not one it must protect.
  if (edited.kind === "legCreated" || edited.kind === "legUpdated") receiptLegIds.add(edited.segmentId);
  // Story 12.4: the legs an apply created are the undo's own to delete.
  if (edited.kind === "suggestionsApplied") edited.segments.forEach((segment) => receiptLegIds.add(segment.segmentId));
  const protectedLegs = (await tx.travelSegment.findMany({ where: { tripDayId } })).filter(
    (leg) => !receiptLegIds.has(leg.id) && drawnBeforeUndo.has(buildStoredSegmentPairKey(leg)),
  );

  // Phase 1: staleness, before any write. One branch per kind; none falls into another's.
  let removedImageFiles: UndoneImageFile[] = [];
  switch (edited.kind) {
    case "created": {
      const item = await tx.dayPlanItem.findFirst({ where: { id: edited.itemId, tripDayId } });
      if (!item || !sameInstant(item.updatedAt, edited.updatedAt)) throw new UndoStaleError("created item changed");
      // Media and legs on a freshly created item can only come from later edits; deleting them would
      // overwrite those edits.
      const [images, documents, legs] = await Promise.all([
        tx.dayPlanItemImage.count({ where: { dayPlanItemId: item.id } }),
        tx.dayPlanItemDocument.count({ where: { dayPlanItemId: item.id } }),
        tx.travelSegment.count({
          where: {
            OR: [
              { fromItemType: "DAY_PLAN_ITEM", fromItemId: item.id },
              { toItemType: "DAY_PLAN_ITEM", toItemId: item.id },
            ],
          },
        }),
      ]);
      if (images > 0 || documents > 0 || legs > 0) throw new UndoStaleError("created item gained media or legs");
      break;
    }
    case "updated": {
      const item = await tx.dayPlanItem.findFirst({ where: { id: edited.itemId, tripDayId }, select: { updatedAt: true } });
      if (!item || !sameInstant(item.updatedAt, edited.updatedAt)) throw new UndoStaleError("updated item changed");
      break;
    }
    case "deleted":
      if (await tx.dayPlanItem.findUnique({ where: { id: edited.previous.id }, select: { id: true } })) {
        throw new UndoStaleError("deleted item exists again");
      }
      break;
    case "reordered":
      // No edited-item check: both of its rows are checked as moved items below.
      break;
    case "legCreated":
    case "legUpdated": {
      const segment = await tx.travelSegment.findFirst({
        where: { id: edited.segmentId, tripDayId },
        select: { updatedAt: true },
      });
      if (!segment || !sameInstant(segment.updatedAt, edited.updatedAt)) throw new UndoStaleError("leg changed");
      break;
    }
    case "legDeleted":
      if (await tx.travelSegment.findUnique({ where: { id: edited.segmentId }, select: { id: true } })) {
        throw new UndoStaleError("deleted leg exists again");
      }
      break;
    case "stayCheckOutChanged": {
      // The stay must be last night's for the pushed day (the nearest lower `dayIndex`, the timeline's
      // rule): a receipt naming any other stay is not something a check-out save ever returned.
      const stay = await tx.accommodation.findFirst({
        where: { id: edited.accommodationId, tripDay: { tripId } },
        select: { updatedAt: true, tripDayId: true },
      });
      if (!stay || !sameInstant(stay.updatedAt, edited.updatedAt)) throw new UndoStaleError("stay changed");
      const pushedDay = await tx.tripDay.findFirst({ where: { id: tripDayId, tripId }, select: { dayIndex: true } });
      const previousDay = pushedDay
        ? await tx.tripDay.findFirst({
            where: { tripId, dayIndex: { lt: pushedDay.dayIndex } },
            orderBy: [{ dayIndex: "desc" }, { date: "desc" }],
            select: { id: true },
          })
        : null;
      if (!previousDay || previousDay.id !== stay.tripDayId) throw new UndoStaleError("stay is not last night's");
      break;
    }
    case "suggestionsApplied":
      removedImageFiles = await checkSuggestionsAppliedInTransaction(tx, tripDayId, edited);
      break;
    default: {
      const unhandled: never = edited;
      throw new Error(`Unhandled receipt kind: ${String(unhandled)}`);
    }
  }
  for (const moved of receipt.movedItems) {
    const item = await tx.dayPlanItem.findFirst({ where: { id: moved.itemId, tripDayId }, select: { updatedAt: true } });
    if (!item || !sameInstant(item.updatedAt, moved.updatedAt)) throw new UndoStaleError("moved item changed");
  }
  if (receipt.removedTravelSegments.length > 0) {
    const removedLegIds = receipt.removedTravelSegments.map((leg) => leg.id);
    const existing = await tx.travelSegment.count({ where: { id: { in: removedLegIds } } });
    if (existing > 0) throw new UndoStaleError("removed leg exists again");
  }
  if (receipt.consumedBucketListItem) {
    const existing = await tx.tripBucketListItem.findUnique({
      where: { id: receipt.consumedBucketListItem.id },
      select: { id: true },
    });
    if (existing) throw new UndoStaleError("bucket-list row exists again");
  }

  // Phase 2: the reverse. Items first, legs last. One branch per kind again.
  switch (edited.kind) {
    case "created": {
      const deleted = await deleteDayPlanItemInTransaction(tx, { tripId, tripDayId, itemId: edited.itemId });
      // The staleness check refused any leg referencing the item, so the delete's own sweeps find nothing;
      // if they did, it would be a leg the undo must not take (the post-condition's rule, stated early).
      if (deleted.status !== "deleted" || deleted.removedTravelSegments.length > 0) {
        throw new UndoStaleError("created item could not be removed cleanly");
      }
      if (receipt.consumedBucketListItem) {
        await tx.tripBucketListItem.create({ data: receipt.consumedBucketListItem });
      }
      break;
    }
    case "updated": {
      // Conditional on the `updatedAt` just checked, so nothing can slip in between check and write.
      const restored = await tx.dayPlanItem.updateMany({
        where: { id: edited.itemId, tripDayId, updatedAt: edited.updatedAt },
        data: itemColumns(edited.previous),
      });
      if (restored.count !== 1) throw new UndoStaleError("updated item changed");
      await restorePayments(tx, edited.previous);
      break;
    }
    case "deleted": {
      const { images, documents, ...snapshot } = edited.previous;
      await tx.dayPlanItem.create({ data: itemColumns(snapshot) });
      await restorePayments(tx, snapshot);
      if (images.length > 0) await tx.dayPlanItemImage.createMany({ data: images });
      if (documents.length > 0) await tx.dayPlanItemDocument.createMany({ data: documents });
      break;
    }
    case "reordered":
      // No edited-item write: both of its rows are restored as moved items below.
      break;
    case "legCreated": {
      const removed = await tx.travelSegment.deleteMany({
        where: { id: edited.segmentId, tripDayId, updatedAt: edited.updatedAt },
      });
      if (removed.count !== 1) throw new UndoStaleError("leg changed");
      break;
    }
    case "legUpdated": {
      const { id: _id, ...columns } = edited.previous;
      void _id;
      // Every column, stamps included, so the row reads exactly as before the save.
      const restored = await tx.travelSegment.updateMany({
        where: { id: edited.segmentId, tripDayId, updatedAt: edited.updatedAt },
        data: columns,
      });
      if (restored.count !== 1) throw new UndoStaleError("leg changed");
      break;
    }
    case "legDeleted":
      await tx.travelSegment.create({ data: edited.previous });
      break;
    case "stayCheckOutChanged": {
      // Only what caused the push: the check-out and its stamp. Every other saved field is kept.
      const restored = await tx.accommodation.updateMany({
        where: { id: edited.accommodationId, updatedAt: edited.updatedAt },
        data: { checkOutTime: edited.previousCheckOutTime, updatedAt: edited.previousUpdatedAt },
      });
      if (restored.count !== 1) throw new UndoStaleError("stay changed");
      break;
    }
    case "suggestionsApplied": {
      // The legs first, each conditional on the stamp just checked, then the activities. With their legs
      // gone and no other leg naming them (phase 1), the deletes find nothing more to sweep; if they did,
      // it would be a leg the undo must not take.
      for (const segment of edited.segments) {
        const removed = await tx.travelSegment.deleteMany({
          where: { id: segment.segmentId, tripDayId, updatedAt: segment.updatedAt },
        });
        if (removed.count !== 1) throw new UndoStaleError("applied leg changed");
      }
      for (const item of edited.items) {
        const deleted = await deleteDayPlanItemInTransaction(tx, { tripId, tripDayId, itemId: item.itemId });
        if (deleted.status !== "deleted" || deleted.removedTravelSegments.length > 0) {
          throw new UndoStaleError("applied item could not be removed cleanly");
        }
      }
      break;
    }
    default: {
      const unhandled: never = edited;
      throw new Error(`Unhandled receipt kind: ${String(unhandled)}`);
    }
  }

  // Story 11.2: each moved activity back where it was, conditional on the stamp phase 1 just checked.
  // Story 13.1: its place in the order too, which a renumbering may be all that changed.
  for (const moved of receipt.movedItems) {
    const restored = await tx.dayPlanItem.updateMany({
      where: { id: moved.itemId, tripDayId, updatedAt: moved.updatedAt },
      data: {
        fromTime: moved.previousFromTime,
        toTime: moved.previousToTime,
        sortOrder: moved.previousSortOrder,
        updatedAt: moved.previousUpdatedAt,
      },
    });
    if (restored.count !== 1) throw new UndoStaleError("moved item changed");
  }

  for (const leg of receipt.removedTravelSegments) {
    await tx.travelSegment.create({ data: leg });
  }

  // Phase 3: the post-condition, over the final timeline.
  const timeline = (await buildSegmentTimelineInTransaction(tx, tripId, tripDayId)) ?? [];
  const drawnAfterUndo = buildDrawnDaySegmentPairKeys(timeline);
  for (const leg of receipt.removedTravelSegments) {
    if (!drawnAfterUndo.has(buildStoredSegmentPairKey(leg))) {
      throw new UndoStaleError("restored leg would not be drawn");
    }
  }
  // A leg save that re-pointed the leg leaves its old endpoints unguarded: a later delete of one of them
  // sweeps nothing (the leg no longer names it), and writing `previous` back would store an orphan.
  if (
    (edited.kind === "legUpdated" || edited.kind === "legDeleted") &&
    !drawnAfterUndo.has(buildStoredSegmentPairKey(edited.previous))
  ) {
    throw new UndoStaleError("restored leg would not be drawn");
  }
  if (protectedLegs.length > 0) {
    const stillThere = new Set(
      (await tx.travelSegment.findMany({ where: { id: { in: protectedLegs.map((leg) => leg.id) } }, select: { id: true } })).map(
        (leg) => leg.id,
      ),
    );
    for (const leg of protectedLegs) {
      if (!stillThere.has(leg.id) || !drawnAfterUndo.has(buildStoredSegmentPairKey(leg))) {
        throw new UndoStaleError("undo would orphan a leg it did not delete");
      }
    }
  }

  return removedImageFiles;
};

export const undoDayPlanChangeForTrip = async (params: {
  userId: string;
  tripId: string;
  receipt: DayChangeReceipt;
}): Promise<DayPlanChangeUndoResult> => {
  const { userId, tripId, receipt } = params;

  // A day of another trip is a forged receipt (AC12: 400), not a missing day. The route has already
  // passed the trip-level gate, so this is the receipt lying about where it came from.
  const dayOnTrip = await prisma.tripDay.findFirst({ where: { id: receipt.tripDayId, tripId }, select: { id: true } });
  if (!dayOnTrip) return { status: "invalid", reason: "day of another trip" };

  const tripDay = await findWritableTripDay(userId, tripId, receipt.tripDayId);
  if (!tripDay) return { status: "not_found" };

  const invalidity = findInvalidity(receipt, tripId);
  if (invalidity) return { status: "invalid", reason: invalidity };

  let removedImageFiles: UndoneImageFile[];
  try {
    removedImageFiles = await prisma.$transaction((tx) => undoInTransaction(tx, tripId, receipt));
  } catch (error) {
    if (error instanceof UndoStaleError) return { status: "stale" };
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { status: "stale" };
    throw error;
  }

  return removedImageFiles.length > 0 ? { status: "undone", removedImageFiles } : { status: "undone" };
};
