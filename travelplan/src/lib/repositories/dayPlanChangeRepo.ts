import path from "node:path";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  deleteDayPlanItemInTransaction,
  parkedDayPlanItemsWhere,
  renumberDayInTransaction,
} from "@/lib/repositories/dayPlanItemRepo";
import {
  buildStoredSegmentPairKey,
  buildSegmentTimelineInTransaction,
  readDrawnSegmentKeysInTransaction,
  type TransactionClient,
} from "@/lib/repositories/travelSegmentRepo";
import type {
  DayChangeReceipt,
  DayPlanItemRow,
  DayPlanItemSnapshot,
  DeletedDayPlanItemSnapshot,
  DeletedStaySnapshot,
  StayRow,
  StaySnapshot,
} from "@/lib/trips/dayChangeReceipt";
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
 * recreates rows that point at its files - DW-187 stays as it is). Since Story 13.4 the apply recomputes the
 * day, so its `movedItems` may list existing rows it moved or renumbered (never one it created), restored
 * like every other kind's.
 *
 * Story 14.3: a `suggestionsApplied` receipt may also list `parkedItems`, the suggestions the same apply
 * parked to the bucket list. Phase 1 checks them as parked rows of the trip (`parkedDayPlanItemsWhere`)
 * with the stamp the apply gave them, and runs the image, document and leg checks over them too; phase 2
 * deletes them by the same predicate. An all-parked receipt never touched the day, so it carries no leg,
 * no moved row and no removed leg.
 *
 * Story 13.1 (version 3). Every write recomputes the day, so `movedItems` also lists rows only renumbered;
 * phase 1 checks every one of them and phase 2 restores `fromTime`, `toTime`, `sortOrder` and `updatedAt`.
 * The snapshots carry `scheduleMode`, `durationMinutes` and `sortOrder`, so `updated` and `deleted` put
 * them back with the other columns. `legDeleted` re-creates the leg with its id and stamps: refused when
 * the id exists again, and a `P2002` (the pair has a leg again) maps to `stale`, as for removed legs.
 *
 * Story 14.1 adds `scheduled`: "+" moved a parked activity onto the day. Phase 1 refuses when the
 * activity is no longer on the day with the stamp the schedule gave it, or a leg names it now; new
 * pictures or documents do not refuse, because nothing is deleted - they go back to the bucket list with
 * it. Phase 2 parks it again (no day, FLEXIBLE, no times, `sortOrder` 0, its previous `updatedAt`),
 * renumbers the day, and restores the moved rows as for every kind.
 *
 * Story 14.2 adds `parked`, the mirror: *Parken* took the activity off the day. Phase 1 refuses when it
 * is no longer parked on this trip with the stamp the park gave it (an edit in the bucket dialog, or "+"
 * onto any day); new pictures or documents do not refuse, they come back to the day with it. Phase 2
 * writes its previous day, schedule columns and `updatedAt` back, then the moved rows and the removed
 * legs as for every kind. No renumber: `movedItems` carries every renumbered row's previous `sortOrder`
 * and the activity gets its own back, so the order is restored exactly.
 *
 * Story 15.4 restores the connector's marker. `updated` and `deleted` write `aiChangedAt` back with the
 * other snapshot columns (legs and media rows carry it too); `scheduled`, `parked` and `reordered` put the
 * targeted activity's `previousAiChangedAt` back. A row only moved or renumbered never had its marker
 * changed, so the moved-items restore leaves it alone. An optional `inTransaction` hook runs after the
 * reverse writes and the post-condition, inside the same transaction (the connector marks its stored
 * change undone there); a throw rolls the undo back.
 *
 * Story 15.5 adds `dayPlanApplied`: one connector `apply_day_plan`. Phase 1 refuses when a created activity
 * or leg is gone or carries a new stamp, when a created activity gained an image, a document or a leg the
 * plan did not create, or when an activity a `replace` deleted exists again. Phase 2 deletes the created
 * legs, then the created activities (the same delete as the other kinds), recreates each deleted activity
 * from its snapshot (the `deleted` kind's path, with its payments, images and documents; the files never
 * left the disk, DW-187), and then restores the moved rows and the removed legs as for every kind, which
 * the post-condition checks.
 *
 * Story 15.6 adds the connector's stay kinds. `stayCreated`: phase 1 refuses when the stay is gone, carries a
 * new stamp, or gained an image, a document or a leg; phase 2 deletes it, conditional on the stamp (its
 * payments go by cascade). `stayUpdated`: phase 1 refuses on a new stamp, and when the receipt's day is
 * neither the stay's day nor the day after it (the pushed day of a check-out recompute); phase 2 writes
 * every previous column back, conditional on the stamp, and replaces the payments; the pushed rows come
 * back as moved items. `stayDeleted`: phase 1 refuses when the stay's id exists again, its day has a stay
 * again, a next-day leg exists again, or `nextDayId` is no longer the day after the stay's; phase 2
 * recreates the stay with its payments, images and documents, then its next-day legs; phase 3 checks each
 * of those is drawn on the next day, as the generic check does for the stay's own day. A stay restored on
 * its own day comes back last in the timeline and on the next day first, so it cannot un-draw another leg.
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

/** Story 15.5. As long as `apply_day_plan`'s own transaction may take. */
const UNDO_TRANSACTION_TIMEOUT_MS = 30000;

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

/**
 * A deleted activity's snapshot against the receipt's day and trip: its payments and media are its own, and
 * every media path stays inside this trip's upload tree. Shared by `deleted` and (Story 15.5) the activities
 * a `dayPlanApplied` replace deleted.
 */
const deletedSnapshotInvalidity = (
  previous: DeletedDayPlanItemSnapshot,
  tripDayId: string,
  tripId: string,
): string | null => {
  if (previous.tripDayId !== tripDayId) return "item on another day";
  if (previous.payments.some((payment) => payment.dayPlanItemId !== previous.id || payment.accommodationId !== null)) {
    return "payment of another entry";
  }
  const { id, images, documents } = previous;
  if (images.some((image) => image.dayPlanItemId !== id)) return "image of another item";
  if (documents.some((document) => document.dayPlanItemId !== id)) return "document of another item";
  if (images.some((image) => !isInsideTripUploadTree(image.imageUrl, tripId))) return "image outside the trip";
  if (documents.some((document) => !isInsideTripUploadTree(document.documentUrl, tripId))) {
    return "document outside the trip";
  }
  return null;
};

/** Story 15.6. A stay snapshot's payments are its own: `accommodationId` set to it, no activity. */
const stayPaymentsInvalidity = (previous: StaySnapshot): string | null =>
  previous.payments.some((payment) => payment.accommodationId !== previous.id || payment.dayPlanItemId !== null)
    ? "payment of another entry"
    : null;

/**
 * Story 15.6. The stay kinds against the receipt's day and trip. A create or an update never removes a leg;
 * a create or a delete never moves a row (a delete only takes legs, and an update moves rows only on the
 * pushed next day). A deleted stay sits on the receipt's day with its own payments and media, its media
 * inside this trip's upload tree, and its next-day legs on one other day, each leg once across both lists.
 */
const stayInvalidity = (receipt: DayChangeReceipt, tripId: string): string | null => {
  const { tripDayId, edited } = receipt;
  if (edited.kind === "stayCreated") {
    if (receipt.removedTravelSegments.length > 0) return "side effect a stay save never has";
    if (receipt.movedItems.length > 0) return "side effect a stay create never has";
    return null;
  }
  if (edited.kind === "stayUpdated") {
    const { previous } = edited;
    if (receipt.removedTravelSegments.length > 0) return "side effect a stay save never has";
    if (previous.id !== edited.accommodationId) return "snapshot of another stay";
    if (previous.tripDayId === tripDayId && receipt.movedItems.length > 0) return "stay save moved its own day";
    return stayPaymentsInvalidity(previous);
  }
  if (edited.kind === "stayDeleted") {
    const { previous, nextDayId, nextDayLegs } = edited;
    if (previous.id !== edited.accommodationId) return "snapshot of another stay";
    if (previous.tripDayId !== tripDayId) return "stay on another day";
    if (receipt.movedItems.length > 0) return "side effect a stay delete never has";
    const paymentInvalidity = stayPaymentsInvalidity(previous);
    if (paymentInvalidity) return paymentInvalidity;
    if (previous.images.some((image) => image.accommodationId !== previous.id)) return "image of another stay";
    if (previous.documents.some((document) => document.accommodationId !== previous.id)) return "document of another stay";
    if (previous.images.some((image) => !isInsideTripUploadTree(image.imageUrl, tripId))) return "image outside the trip";
    if (previous.documents.some((document) => !isInsideTripUploadTree(document.documentUrl, tripId))) {
      return "document outside the trip";
    }
    // Only the stay's own legs: into it on its day, out of it on the next day.
    const namesStay = (type: string, id: string) => type === "ACCOMMODATION" && id === previous.id;
    if (receipt.removedTravelSegments.some((leg) => !namesStay(leg.fromItemType, leg.fromItemId) && !namesStay(leg.toItemType, leg.toItemId))) {
      return "removed leg of another entry";
    }
    if (nextDayLegs.some((leg) => !namesStay(leg.fromItemType, leg.fromItemId))) return "next-day leg not out of the stay";
    if (nextDayId === tripDayId) return "next day is the stay's day";
    if (nextDayLegs.length > 0 && nextDayId === null) return "next-day legs without a next day";
    if (nextDayLegs.some((leg) => leg.tripDayId !== nextDayId)) return "leg on another day";
    const legIds = new Set(receipt.removedTravelSegments.map((leg) => leg.id));
    for (const leg of nextDayLegs) {
      if (legIds.has(leg.id)) return "duplicate leg";
      legIds.add(leg.id);
    }
  }
  return null;
};

/**
 * The ownership half of AC12; the shape half is `dayChangeReceiptSchemas.ts`. Exported for Story 15.5: a
 * write that must keep its undo checks its receipt here before it commits.
 */
export const findInvalidity = (receipt: DayChangeReceipt, tripId: string): string | null => {
  const { tripDayId, edited } = receipt;

  const legIds = new Set<string>();
  for (const leg of receipt.removedTravelSegments) {
    if (leg.tripDayId !== tripDayId) return "leg on another day";
    if (legIds.has(leg.id)) return "duplicate leg";
    legIds.add(leg.id);
  }

  if (edited.kind === "parked" && edited.previous.tripDayId !== tripDayId) return "item on another day";

  if (edited.kind === "updated") {
    const previous = edited.previous;
    if (previous.tripDayId !== tripDayId) return "item on another day";
    if (previous.id !== edited.itemId) return "snapshot of another item";
    if (previous.payments.some((payment) => payment.dayPlanItemId !== previous.id || payment.accommodationId !== null)) {
      return "payment of another entry";
    }
  }

  if (edited.kind === "deleted") {
    const invalidity = deletedSnapshotInvalidity(edited.previous, tripDayId, tripId);
    if (invalidity) return invalidity;
  }

  // Story 11.2: the push never moves the edited activity, and moves each other one at most once.
  // Story 11.3: a reorder's two activities are the exception; both must be listed as moved.
  // Story 11.4: a leg or check-out save edits no activity, so only the activity kinds have an edited id.
  const movedIds = new Set<string>();
  const editedId =
    edited.kind === "deleted"
      ? edited.previous.id
      : edited.kind === "created" ||
          edited.kind === "updated" ||
          edited.kind === "scheduled" ||
          edited.kind === "parked"
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
    // Story 13.4: the apply recomputes the day, so it may move existing rows, never one it created.
    // Story 14.3: every created id once across the day's and the parked ones.
    const allItems = [...edited.items, ...(edited.parkedItems ?? [])];
    const createdIds = new Set(allItems.map((item) => item.itemId));
    if (receipt.movedItems.some((moved) => createdIds.has(moved.itemId))) return "applied item listed as moved";
    if (createdIds.size !== allItems.length) return "duplicate item";
    if (
      edited.items.length === 0 &&
      (edited.segments.length > 0 || receipt.movedItems.length > 0 || receipt.removedTravelSegments.length > 0)
    ) {
      return "side effect an all-parked apply never has";
    }
    if (new Set(edited.segments.map((segment) => segment.segmentId)).size !== edited.segments.length) return "duplicate leg";
    if (edited.segments.some((segment) => legIds.has(segment.segmentId))) return "leg both created and removed";
    if (new Set(edited.imageIds).size !== edited.imageIds.length) return "duplicate image";
  }

  if (edited.kind === "dayPlanApplied") {
    // Story 15.5: every snapshot as a `deleted` one's; each id once, a created id never moved or deleted, a
    // deleted one never moved (it is not on the day after the write), and no leg both created and removed.
    if (edited.mode === "append" && edited.deletedItems.length > 0) return "append that deleted activities";
    for (const previous of edited.deletedItems) {
      const invalidity = deletedSnapshotInvalidity(previous, tripDayId, tripId);
      if (invalidity) return invalidity;
    }
    const createdIds = new Set(edited.items.map((item) => item.itemId));
    const deletedIds = new Set(edited.deletedItems.map((previous) => previous.id));
    if (createdIds.size !== edited.items.length) return "duplicate item";
    if (deletedIds.size !== edited.deletedItems.length) return "duplicate deleted item";
    if ([...createdIds].some((id) => deletedIds.has(id))) return "applied item listed as deleted";
    if (receipt.movedItems.some((moved) => createdIds.has(moved.itemId))) return "applied item listed as moved";
    if (receipt.movedItems.some((moved) => deletedIds.has(moved.itemId))) return "deleted item listed as moved";
    if (new Set(edited.segments.map((segment) => segment.segmentId)).size !== edited.segments.length) return "duplicate leg";
    if (edited.segments.some((segment) => legIds.has(segment.segmentId))) return "leg both created and removed";
  }

  if (edited.kind === "stayCreated" || edited.kind === "stayUpdated" || edited.kind === "stayDeleted") {
    const invalidity = stayInvalidity(receipt, tripId);
    if (invalidity) return invalidity;
  }

  // Story 14.1: a schedule appends, which can un-draw the leg from the day's last activity to tonight's
  // stay; like a create's, that leg is in `removedTravelSegments` and phase 2 recreates it.
  // Story 14.2: a park removes the legs naming the activity (to either stay too); phase 2 recreates them.

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

/** Story 15.6. Every `Accommodation` column of a stay snapshot, without the relations. */
const stayColumns = (snapshot: StaySnapshot): StayRow => {
  const { payments: _payments, ...columns } = snapshot;
  void _payments;
  return columns;
};

/** Story 15.6. The stay's payments replaced by the snapshot's, as the stay write replaces them. */
const restoreStayPayments = async (tx: TransactionClient, snapshot: StaySnapshot) => {
  await tx.costPayment.deleteMany({ where: { accommodationId: snapshot.id } });
  if (snapshot.payments.length > 0) {
    await tx.costPayment.createMany({ data: snapshot.payments });
  }
};

/** Story 15.6. A deleted stay back from its snapshot, with its id, stamps, marker, payments and media rows. */
const recreateDeletedStay = async (tx: TransactionClient, previous: DeletedStaySnapshot) => {
  const { images, documents, ...snapshot } = previous;
  await tx.accommodation.create({ data: stayColumns(snapshot) });
  await restoreStayPayments(tx, snapshot);
  if (images.length > 0) await tx.accommodationImage.createMany({ data: images });
  if (documents.length > 0) await tx.accommodationDocument.createMany({ data: documents });
};

/** Story 15.6. The day after `tripDayId` by the check-out rule (the smallest higher `dayIndex`), or `null`. */
const findNextDayIdInTransaction = async (tx: TransactionClient, tripId: string, tripDayId: string) => {
  const day = await tx.tripDay.findFirst({ where: { id: tripDayId, tripId }, select: { dayIndex: true } });
  if (!day) return null;
  const next = await tx.tripDay.findFirst({
    where: { tripId, dayIndex: { gt: day.dayIndex } },
    orderBy: [{ dayIndex: "asc" }, { date: "asc" }],
    select: { id: true },
  });
  return next?.id ?? null;
};

/**
 * A deleted activity back from its snapshot, with its id, stamps, marker, payments and media rows. Story
 * 14.1: the receipt row has no `tripId`; it is the trip the undo was asked on (the day is on it). Story
 * 15.5: shared by `deleted` and a `dayPlanApplied` replace.
 */
const recreateDeletedItem = async (tx: TransactionClient, tripId: string, previous: DeletedDayPlanItemSnapshot) => {
  const { images, documents, ...snapshot } = previous;
  await tx.dayPlanItem.create({ data: { ...itemColumns(snapshot), tripId } });
  await restorePayments(tx, snapshot);
  if (images.length > 0) await tx.dayPlanItemImage.createMany({ data: images });
  if (documents.length > 0) await tx.dayPlanItemDocument.createMany({ data: documents });
};

/**
 * Story 12.4, phase 1 for `suggestionsApplied`. Every created activity and leg must still be on the day with
 * the stamp the apply gave it, and nothing may have been added to the activities since: no image the apply
 * did not create, no document, no leg it did not create. Returns the image rows phase 2 will take with
 * the activities, read here, inside the transaction, so the files removed later are the rows' own.
 */
const checkSuggestionsAppliedInTransaction = async (
  tx: TransactionClient,
  tripId: string,
  tripDayId: string,
  edited: Extract<DayChangeReceipt["edited"], { kind: "suggestionsApplied" }>,
): Promise<UndoneImageFile[]> => {
  const dayItemIds = edited.items.map((item) => item.itemId);
  const parkedItems = edited.parkedItems ?? [];
  const parkedIds = parkedItems.map((item) => item.itemId);
  const itemIds = [...dayItemIds, ...parkedIds];
  const segmentIds = new Set(edited.segments.map((segment) => segment.segmentId));

  const items = await tx.dayPlanItem.findMany({ where: { id: { in: dayItemIds }, tripDayId }, select: { id: true, updatedAt: true } });
  const itemStamps = new Map(items.map((item) => [item.id, item.updatedAt]));
  for (const item of edited.items) {
    const stamp = itemStamps.get(item.itemId);
    if (!stamp || !sameInstant(stamp, item.updatedAt)) throw new UndoStaleError("applied item changed");
  }
  // Story 14.3: a parked one scheduled with "+", edited in the bucket dialog or deleted since is stale.
  if (parkedIds.length > 0) {
    const parked = await tx.dayPlanItem.findMany({
      where: { id: { in: parkedIds }, ...parkedDayPlanItemsWhere(tripId) },
      select: { id: true, updatedAt: true },
    });
    const parkedStamps = new Map(parked.map((item) => [item.id, item.updatedAt]));
    for (const item of parkedItems) {
      const stamp = parkedStamps.get(item.itemId);
      if (!stamp || !sameInstant(stamp, item.updatedAt)) throw new UndoStaleError("applied item changed");
    }
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

/**
 * Story 15.5, phase 1 for `dayPlanApplied`. Every created activity and leg must still be on the day with the
 * stamp the plan gave it; nothing may have been added to the activities since (the plan creates no image or
 * document, and no leg but its own); and no activity a `replace` deleted may exist again.
 */
const checkDayPlanAppliedInTransaction = async (
  tx: TransactionClient,
  tripDayId: string,
  edited: Extract<DayChangeReceipt["edited"], { kind: "dayPlanApplied" }>,
): Promise<void> => {
  const itemIds = edited.items.map((item) => item.itemId);
  const segmentIds = new Set(edited.segments.map((segment) => segment.segmentId));

  const items = await tx.dayPlanItem.findMany({ where: { id: { in: itemIds }, tripDayId }, select: { id: true, updatedAt: true } });
  const itemStamps = new Map(items.map((item) => [item.id, item.updatedAt]));
  for (const item of edited.items) {
    const stamp = itemStamps.get(item.itemId);
    if (!stamp || !sameInstant(stamp, item.updatedAt)) throw new UndoStaleError("planned item changed");
  }

  const segments = await tx.travelSegment.findMany({
    where: { id: { in: [...segmentIds] }, tripDayId },
    select: { id: true, updatedAt: true },
  });
  const segmentStamps = new Map(segments.map((segment) => [segment.id, segment.updatedAt]));
  for (const segment of edited.segments) {
    const stamp = segmentStamps.get(segment.segmentId);
    if (!stamp || !sameInstant(stamp, segment.updatedAt)) throw new UndoStaleError("planned leg changed");
  }

  const [images, documents, referencing, reappeared] = await Promise.all([
    tx.dayPlanItemImage.count({ where: { dayPlanItemId: { in: itemIds } } }),
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
    tx.dayPlanItem.count({ where: { id: { in: edited.deletedItems.map((previous) => previous.id) } } }),
  ]);
  if (images > 0) throw new UndoStaleError("planned item gained an image");
  if (documents > 0) throw new UndoStaleError("planned item gained a document");
  if (referencing.some((leg) => !segmentIds.has(leg.id))) throw new UndoStaleError("planned item gained a leg");
  if (reappeared > 0) throw new UndoStaleError("deleted item exists again");
  // A replace left only its own activities on the day; one added since would sit among the restored rows
  // with a clashing order and times, so it refuses like any later edit.
  if (edited.mode === "replace") {
    const others = await tx.dayPlanItem.count({ where: { tripDayId, id: { notIn: itemIds } } });
    if (others > 0) throw new UndoStaleError("day gained an activity since the replace");
  }
};

const undoInTransaction = async (
  tx: TransactionClient,
  tripId: string,
  receipt: DayChangeReceipt,
  inTransaction?: (tx: TransactionClient) => Promise<void>,
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
  // Story 15.5: so are the legs a connector day plan created.
  if (edited.kind === "dayPlanApplied") edited.segments.forEach((segment) => receiptLegIds.add(segment.segmentId));
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
      removedImageFiles = await checkSuggestionsAppliedInTransaction(tx, tripId, tripDayId, edited);
      break;
    case "scheduled": {
      const item = await tx.dayPlanItem.findFirst({ where: { id: edited.itemId, tripId, tripDayId }, select: { updatedAt: true } });
      if (!item || !sameInstant(item.updatedAt, edited.updatedAt)) throw new UndoStaleError("scheduled item changed");
      // A parked activity cannot have legs (the CHECK's spirit, and a leg needs a day). Media may have
      // been added since: they stay attached and go back to the list with it, so they do not refuse.
      const legs = await tx.travelSegment.count({
        where: {
          OR: [
            { fromItemType: "DAY_PLAN_ITEM", fromItemId: edited.itemId },
            { toItemType: "DAY_PLAN_ITEM", toItemId: edited.itemId },
          ],
        },
      });
      if (legs > 0) throw new UndoStaleError("scheduled item gained a leg");
      break;
    }
    case "parked": {
      // Still parked on this trip with the park's stamp. Media added since stay attached and come back
      // with it, so they do not refuse; a parked row cannot have legs (a leg needs a day).
      const item = await tx.dayPlanItem.findFirst({
        where: { id: edited.itemId, tripId, tripDayId: null },
        select: { updatedAt: true },
      });
      if (!item || !sameInstant(item.updatedAt, edited.updatedAt)) throw new UndoStaleError("parked item changed");
      break;
    }
    case "dayPlanApplied":
      await checkDayPlanAppliedInTransaction(tx, tripDayId, edited);
      break;
    case "stayCreated": {
      const stay = await tx.accommodation.findFirst({
        where: { id: edited.accommodationId, tripDayId },
        select: { updatedAt: true },
      });
      if (!stay || !sameInstant(stay.updatedAt, edited.updatedAt)) throw new UndoStaleError("created stay changed");
      // Media and legs on a freshly created stay can only come from later edits; deleting it would take them.
      const [images, documents, legs] = await Promise.all([
        tx.accommodationImage.count({ where: { accommodationId: edited.accommodationId } }),
        tx.accommodationDocument.count({ where: { accommodationId: edited.accommodationId } }),
        tx.travelSegment.count({
          where: {
            OR: [
              { fromItemType: "ACCOMMODATION", fromItemId: edited.accommodationId },
              { toItemType: "ACCOMMODATION", toItemId: edited.accommodationId },
            ],
          },
        }),
      ]);
      if (images > 0 || documents > 0 || legs > 0) throw new UndoStaleError("created stay gained media or legs");
      break;
    }
    case "stayUpdated": {
      const stay = await tx.accommodation.findFirst({
        where: { id: edited.accommodationId, tripDay: { tripId } },
        select: { updatedAt: true, tripDayId: true },
      });
      if (!stay || !sameInstant(stay.updatedAt, edited.updatedAt)) throw new UndoStaleError("stay changed");
      if (stay.tripDayId !== edited.previous.tripDayId) throw new UndoStaleError("stay on another day");
      // The receipt's day is the stay's own, or the next day its check-out pushed.
      if (tripDayId !== stay.tripDayId && (await findNextDayIdInTransaction(tx, tripId, stay.tripDayId)) !== tripDayId) {
        throw new UndoStaleError("stay is not on or before the receipt's day");
      }
      break;
    }
    case "stayDeleted": {
      const [sameId, dayStay, reappearedLegs] = await Promise.all([
        tx.accommodation.findUnique({ where: { id: edited.accommodationId }, select: { id: true } }),
        tx.accommodation.findUnique({ where: { tripDayId }, select: { id: true } }),
        tx.travelSegment.count({ where: { id: { in: edited.nextDayLegs.map((leg) => leg.id) } } }),
      ]);
      if (sameId) throw new UndoStaleError("deleted stay exists again");
      if (dayStay) throw new UndoStaleError("day has a stay again");
      if (reappearedLegs > 0) throw new UndoStaleError("removed leg exists again");
      if (edited.nextDayId !== null && (await findNextDayIdInTransaction(tx, tripId, tripDayId)) !== edited.nextDayId) {
        throw new UndoStaleError("next day changed");
      }
      break;
    }
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

  // Phase 2: the reverse. Items first, legs last. One branch per kind again.
  switch (edited.kind) {
    case "created": {
      const deleted = await deleteDayPlanItemInTransaction(tx, { tripId, tripDayId, itemId: edited.itemId });
      // The staleness check refused any leg referencing the item, so the delete's own sweeps find nothing;
      // if they did, it would be a leg the undo must not take (the post-condition's rule, stated early).
      if (deleted.status !== "deleted" || deleted.removedTravelSegments.length > 0) {
        throw new UndoStaleError("created item could not be removed cleanly");
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
    case "deleted":
      await recreateDeletedItem(tx, tripId, edited.previous);
      break;
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
    case "scheduled": {
      // Back to the bucket list exactly as it was parked, conditional on the stamp just checked.
      const parked = await tx.dayPlanItem.updateMany({
        where: { id: edited.itemId, tripId, tripDayId, updatedAt: edited.updatedAt },
        data: {
          tripDayId: null,
          scheduleMode: "FLEXIBLE",
          fromTime: null,
          toTime: null,
          sortOrder: 0,
          updatedAt: edited.previousUpdatedAt,
          aiChangedAt: edited.previousAiChangedAt,
        },
      });
      if (parked.count !== 1) throw new UndoStaleError("scheduled item changed");
      await renumberDayInTransaction(tx, tripDayId);
      break;
    }
    case "parked": {
      // Back onto its day exactly as it was planned, conditional on the stamp just checked. No renumber:
      // the moved rows below get their previous `sortOrder` back, which restores the order exactly.
      const { previous } = edited;
      const restored = await tx.dayPlanItem.updateMany({
        where: { id: edited.itemId, tripId, tripDayId: null, updatedAt: edited.updatedAt },
        data: {
          tripDayId: previous.tripDayId,
          scheduleMode: previous.scheduleMode,
          durationMinutes: previous.durationMinutes,
          sortOrder: previous.sortOrder,
          fromTime: previous.fromTime,
          toTime: previous.toTime,
          updatedAt: previous.updatedAt,
          aiChangedAt: previous.previousAiChangedAt,
        },
      });
      if (restored.count !== 1) throw new UndoStaleError("parked item changed");
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
      // Story 14.3: the parked ones, by the parked predicate (not by day); the cascade takes their image rows.
      for (const item of edited.parkedItems ?? []) {
        const deleted = await tx.dayPlanItem.deleteMany({
          where: { id: item.itemId, ...parkedDayPlanItemsWhere(tripId), updatedAt: item.updatedAt },
        });
        if (deleted.count !== 1) throw new UndoStaleError("applied item changed");
      }
      break;
    }
    case "dayPlanApplied": {
      // As `suggestionsApplied`: the created legs, each conditional on its stamp, then the created activities
      // through the shared delete, which must find nothing more to sweep. Then the activities a replace
      // deleted, each as a `deleted` undo recreates it.
      for (const segment of edited.segments) {
        const removed = await tx.travelSegment.deleteMany({
          where: { id: segment.segmentId, tripDayId, updatedAt: segment.updatedAt },
        });
        if (removed.count !== 1) throw new UndoStaleError("planned leg changed");
      }
      for (const item of edited.items) {
        const deleted = await deleteDayPlanItemInTransaction(tx, { tripId, tripDayId, itemId: item.itemId });
        if (deleted.status !== "deleted" || deleted.removedTravelSegments.length > 0) {
          throw new UndoStaleError("planned item could not be removed cleanly");
        }
      }
      for (const previous of edited.deletedItems) {
        await recreateDeletedItem(tx, tripId, previous);
      }
      break;
    }
    case "stayCreated": {
      // Conditional on the stamp just checked; the payments go by cascade.
      const removed = await tx.accommodation.deleteMany({
        where: { id: edited.accommodationId, tripDayId, updatedAt: edited.updatedAt },
      });
      if (removed.count !== 1) throw new UndoStaleError("created stay changed");
      break;
    }
    case "stayUpdated": {
      // Every column, stamps and marker included, so the stay reads exactly as before the save.
      const { id: _id, ...columns } = stayColumns(edited.previous);
      void _id;
      const restored = await tx.accommodation.updateMany({
        where: { id: edited.accommodationId, updatedAt: edited.updatedAt },
        data: columns,
      });
      if (restored.count !== 1) throw new UndoStaleError("stay changed");
      await restoreStayPayments(tx, edited.previous);
      break;
    }
    case "stayDeleted":
      await recreateDeletedStay(tx, edited.previous);
      for (const leg of edited.nextDayLegs) {
        await tx.travelSegment.create({ data: leg });
      }
      break;
    default: {
      const unhandled: never = edited;
      throw new Error(`Unhandled receipt kind: ${String(unhandled)}`);
    }
  }

  // Story 11.2: each moved activity back where it was, conditional on the stamp phase 1 just checked.
  // Story 13.1: its place in the order too, which a renumbering may be all that changed.
  // Story 15.4: a reorder's moved activity also gets its previous marker back; every other row kept its own.
  for (const moved of receipt.movedItems) {
    const restoresMarker = edited.kind === "reordered" && moved.itemId === edited.itemId;
    const restored = await tx.dayPlanItem.updateMany({
      where: { id: moved.itemId, tripDayId, updatedAt: moved.updatedAt },
      data: {
        fromTime: moved.previousFromTime,
        toTime: moved.previousToTime,
        sortOrder: moved.previousSortOrder,
        updatedAt: moved.previousUpdatedAt,
        ...(restoresMarker ? { aiChangedAt: edited.previousAiChangedAt } : {}),
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
  // Story 15.6: a deleted stay's legs out of last night's stay are drawn on the next day again.
  if (edited.kind === "stayDeleted" && edited.nextDayId !== null && edited.nextDayLegs.length > 0) {
    const nextDayDrawn = await readDrawnSegmentKeysInTransaction(tx, tripId, edited.nextDayId);
    if (edited.nextDayLegs.some((leg) => !nextDayDrawn.has(buildStoredSegmentPairKey(leg)))) {
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

  // Story 15.4: the caller's own write, committed with the undo or not at all.
  if (inTransaction) await inTransaction(tx);

  return removedImageFiles;
};

export const undoDayPlanChangeForTrip = async (params: {
  userId: string;
  tripId: string;
  receipt: DayChangeReceipt;
  /** Story 15.4. Runs after the reverse writes, inside the undo's transaction. */
  inTransaction?: (tx: TransactionClient) => Promise<void>;
}): Promise<DayPlanChangeUndoResult> => {
  const { userId, tripId, receipt, inTransaction } = params;

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
    // Story 15.5: a plan's undo deletes and recreates up to 50 activities each with its sweeps, well past
    // Prisma's 5 s default on a slow disk; the apply itself has the same budget.
    removedImageFiles = await prisma.$transaction((tx) => undoInTransaction(tx, tripId, receipt, inTransaction), {
      timeout: UNDO_TRANSACTION_TIMEOUT_MS,
    });
  } catch (error) {
    if (error instanceof UndoStaleError) return { status: "stale" };
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { status: "stale" };
    throw error;
  }

  return removedImageFiles.length > 0 ? { status: "undone", removedImageFiles } : { status: "undone" };
};
