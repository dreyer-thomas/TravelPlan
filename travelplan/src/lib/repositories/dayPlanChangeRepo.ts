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
 * Any failure throws `UndoStaleError`, which rolls the transaction back and maps to `stale`. A `P2002`
 * while recreating a row maps there too: someone drew a new leg for the same pair, or reused the id.
 *
 * Before the transaction, the receipt is checked against the trip it claims to belong to (`invalid`):
 * the endpoint must be no more powerful than the write endpoints it reverses.
 */

export type DayPlanChangeUndoResult =
  | { status: "not_found" }
  | { status: "invalid"; reason: string }
  | { status: "stale" }
  | { status: "undone" };

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
  const movedIds = new Set<string>();
  const editedId = edited.kind === "deleted" ? edited.previous.id : edited.itemId;
  for (const moved of receipt.movedItems) {
    if (movedIds.has(moved.itemId)) return "duplicate moved item";
    if (edited.kind !== "reordered" && moved.itemId === editedId) return "edited item listed as moved";
    movedIds.add(moved.itemId);
  }
  if (edited.kind === "reordered") {
    if (edited.itemId === edited.neighbourId) return "reordered with itself";
    if (!movedIds.has(edited.itemId) || !movedIds.has(edited.neighbourId)) return "reordered pair not listed as moved";
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

const undoInTransaction = async (tx: TransactionClient, tripId: string, receipt: DayChangeReceipt) => {
  const { tripDayId, edited } = receipt;

  // What the day draws before the undo, and which of its legs the receipt does not own. The second set
  // is what the post-condition protects.
  const drawnBeforeUndo = await readDrawnSegmentKeysInTransaction(tx, tripId, tripDayId);
  const receiptLegIds = new Set(receipt.removedTravelSegments.map((leg) => leg.id));
  const protectedLegs = (await tx.travelSegment.findMany({ where: { tripDayId } })).filter(
    (leg) => !receiptLegIds.has(leg.id) && drawnBeforeUndo.has(buildStoredSegmentPairKey(leg)),
  );

  // Phase 1: staleness, before any write.
  if (edited.kind === "created") {
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
  } else if (edited.kind === "updated") {
    const item = await tx.dayPlanItem.findFirst({ where: { id: edited.itemId, tripDayId }, select: { updatedAt: true } });
    if (!item || !sameInstant(item.updatedAt, edited.updatedAt)) throw new UndoStaleError("updated item changed");
  } else if (edited.kind === "deleted") {
    if (await tx.dayPlanItem.findUnique({ where: { id: edited.previous.id }, select: { id: true } })) {
      throw new UndoStaleError("deleted item exists again");
    }
  }
  // A `reordered` receipt has no edited-item check: both of its rows are checked as moved items below.
  for (const moved of receipt.movedItems) {
    const item = await tx.dayPlanItem.findFirst({ where: { id: moved.itemId, tripDayId }, select: { updatedAt: true } });
    if (!item || !sameInstant(item.updatedAt, moved.updatedAt)) throw new UndoStaleError("moved item changed");
  }
  if (receipt.removedTravelSegments.length > 0) {
    const existing = await tx.travelSegment.count({ where: { id: { in: [...receiptLegIds] } } });
    if (existing > 0) throw new UndoStaleError("removed leg exists again");
  }
  if (receipt.consumedBucketListItem) {
    const existing = await tx.tripBucketListItem.findUnique({
      where: { id: receipt.consumedBucketListItem.id },
      select: { id: true },
    });
    if (existing) throw new UndoStaleError("bucket-list row exists again");
  }

  // Phase 2: the reverse. Items first, legs last.
  if (edited.kind === "created") {
    const deleted = await deleteDayPlanItemInTransaction(tx, { tripId, tripDayId, itemId: edited.itemId });
    // The staleness check refused any leg referencing the item, so the delete's own sweeps find nothing;
    // if they did, it would be a leg the undo must not take (the post-condition's rule, stated early).
    if (deleted.status !== "deleted" || deleted.removedTravelSegments.length > 0) {
      throw new UndoStaleError("created item could not be removed cleanly");
    }
    if (receipt.consumedBucketListItem) {
      await tx.tripBucketListItem.create({ data: receipt.consumedBucketListItem });
    }
  } else if (edited.kind === "updated") {
    // Conditional on the `updatedAt` just checked, so nothing can slip in between check and write.
    const restored = await tx.dayPlanItem.updateMany({
      where: { id: edited.itemId, tripDayId, updatedAt: edited.updatedAt },
      data: itemColumns(edited.previous),
    });
    if (restored.count !== 1) throw new UndoStaleError("updated item changed");
    await restorePayments(tx, edited.previous);
  } else if (edited.kind === "deleted") {
    const { images, documents, ...snapshot } = edited.previous;
    await tx.dayPlanItem.create({ data: itemColumns(snapshot) });
    await restorePayments(tx, snapshot);
    if (images.length > 0) await tx.dayPlanItemImage.createMany({ data: images });
    if (documents.length > 0) await tx.dayPlanItemDocument.createMany({ data: documents });
  }
  // A `reordered` receipt has no edited-item write: both of its rows are restored as moved items below.

  // Story 11.2: each pushed activity back where it was, conditional on the stamp phase 1 just checked.
  for (const moved of receipt.movedItems) {
    const restored = await tx.dayPlanItem.updateMany({
      where: { id: moved.itemId, tripDayId, updatedAt: moved.updatedAt },
      data: { fromTime: moved.previousFromTime, toTime: moved.previousToTime, updatedAt: moved.previousUpdatedAt },
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

  try {
    await prisma.$transaction((tx) => undoInTransaction(tx, tripId, receipt));
  } catch (error) {
    if (error instanceof UndoStaleError) return { status: "stale" };
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { status: "stale" };
    throw error;
  }

  return { status: "undone" };
};
