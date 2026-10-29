import { prisma } from "@/lib/db/prisma";
import type { TransactionClient } from "@/lib/repositories/travelSegmentRepo";
import type {
  DayChangeFileMedia,
  DayChangeFileTarget,
  DayChangeReceipt,
  DeletedFileRow,
} from "@/lib/trips/dayChangeReceipt";
import { MAX_DOCUMENTS_PER_ENTRY } from "@/lib/trips/documentUploads";
import { ChangedSinceReadError, type InTransactionHook } from "@/lib/trips/writeOrigin";

/**
 * Story 15.7. The connector's file writes: one row of an activity's or a stay's documents or images, attached
 * or deleted in one transaction with its `ai_changes` record (the `inTransaction` hook), as every connector
 * write since 15.4. The tool has already placed the bytes on disk (attach) or will remove them after the
 * commit (a parked delete); this module only touches rows.
 *
 * Writers only: every read here carries the writer clause (owner, or a `CONTRIBUTOR` member), so a viewer's
 * or a stranger's call finds nothing, exactly like an id that names nothing.
 *
 * Both writes build their receipt (`fileAttached`, `fileDeleted`) only when the parent has a day: the
 * receipt names a day, and a parked activity's writes have none (as every bucket-list connector write since
 * 15.4), so they are recorded without undo.
 */

const writerTrip = (userId: string) => ({ OR: [{ userId }, { members: { some: { userId, role: "CONTRIBUTOR" as const } } }] });

/** The parent's current day, scoped to the trip and its writer; `undefined` when the parent is gone. */
const readParentDayInTransaction = async (
  tx: TransactionClient,
  params: { userId: string; tripId: string; target: DayChangeFileTarget; parentId: string },
): Promise<string | null | undefined> => {
  const { userId, tripId, target, parentId } = params;
  if (target === "activity") {
    const item = await tx.dayPlanItem.findFirst({
      where: { id: parentId, tripId, trip: writerTrip(userId) },
      select: { tripDayId: true },
    });
    return item ? item.tripDayId : undefined;
  }
  const stay = await tx.accommodation.findFirst({
    where: { id: parentId, tripDay: { tripId, trip: writerTrip(userId) } },
    select: { tripDayId: true },
  });
  return stay ? stay.tripDayId : undefined;
};

const fileReceipt = (tripDayId: string, edited: DayChangeReceipt["edited"]): DayChangeReceipt => ({
  version: 3,
  tripDayId,
  edited,
  removedTravelSegments: [],
  movedItems: [],
});

export type ConnectorAttachedFile = { id: string; updatedAt: Date; sortOrder: number };

export type ConnectorAttachResult = { status: "attached"; file: ConnectorAttachedFile } | { status: "limit_reached" };

/**
 * Attaches one file row to an activity or a stay, marked (`aiChangedAt`), after the parent's last one. The
 * parent is re-read inside the transaction: gone, or (for an activity) on another day than the one its
 * folder was built from (`expectedTripDayId`, `null` for parked), throws `ChangedSinceReadError`, because the
 * file on disk would then sit in a folder that is not the parent's current place. The document cap is
 * enforced again here (`limit_reached`), as the app's create does after its own write.
 */
export const attachFileForConnector = async (params: {
  userId: string;
  tripId: string;
  target: DayChangeFileTarget;
  media: DayChangeFileMedia;
  parentId: string;
  expectedTripDayId: string | null;
  url: string;
  /** The sanitised name; stored for a document, unused for an image (images have no name column). */
  fileName: string;
  inTransaction: InTransactionHook;
}): Promise<ConnectorAttachResult> => {
  const { userId, tripId, target, media, parentId, url, fileName } = params;
  return prisma.$transaction(async (tx) => {
    const tripDayId = await readParentDayInTransaction(tx, { userId, tripId, target, parentId });
    if (tripDayId === undefined || tripDayId !== params.expectedTripDayId) throw new ChangedSinceReadError();

    const now = new Date();
    const orderOf = (last: { sortOrder: number } | null) => (last?.sortOrder ?? 0) + 1;
    const lastFirst = { orderBy: [{ sortOrder: "desc" as const }], select: { sortOrder: true } };
    let file: ConnectorAttachedFile;
    if (target === "activity") {
      const where = { dayPlanItemId: parentId };
      if (media === "document") {
        if ((await tx.dayPlanItemDocument.count({ where })) >= MAX_DOCUMENTS_PER_ENTRY) return { status: "limit_reached" };
        const last = await tx.dayPlanItemDocument.findFirst({ where, ...lastFirst });
        file = await tx.dayPlanItemDocument.create({
          data: { dayPlanItemId: parentId, documentUrl: url, fileName, sortOrder: orderOf(last), aiChangedAt: now },
          select: { id: true, updatedAt: true, sortOrder: true },
        });
      } else {
        const last = await tx.dayPlanItemImage.findFirst({ where, ...lastFirst });
        file = await tx.dayPlanItemImage.create({
          data: { dayPlanItemId: parentId, imageUrl: url, sortOrder: orderOf(last), aiChangedAt: now },
          select: { id: true, updatedAt: true, sortOrder: true },
        });
      }
    } else {
      const where = { accommodationId: parentId };
      if (media === "document") {
        if ((await tx.accommodationDocument.count({ where })) >= MAX_DOCUMENTS_PER_ENTRY) return { status: "limit_reached" };
        const last = await tx.accommodationDocument.findFirst({ where, ...lastFirst });
        file = await tx.accommodationDocument.create({
          data: { accommodationId: parentId, documentUrl: url, fileName, sortOrder: orderOf(last), aiChangedAt: now },
          select: { id: true, updatedAt: true, sortOrder: true },
        });
      } else {
        const last = await tx.accommodationImage.findFirst({ where, ...lastFirst });
        file = await tx.accommodationImage.create({
          data: { accommodationId: parentId, imageUrl: url, sortOrder: orderOf(last), aiChangedAt: now },
          select: { id: true, updatedAt: true, sortOrder: true },
        });
      }
    }

    const receipt =
      tripDayId === null
        ? null
        : fileReceipt(tripDayId, {
            kind: "fileAttached",
            target,
            media,
            parentId,
            fileId: file.id,
            url,
            updatedAt: file.updatedAt,
          });
    await params.inTransaction(tx, { receipt, itemId: file.id });
    return { status: "attached", file };
  });
};

export type ConnectorDeleteResult = {
  /** The parent's day at the delete, `null` for a parked activity (no receipt, so the caller removes the file). */
  tripDayId: string | null;
  parentId: string;
  url: string;
};

/**
 * The file row, read again inside the transaction; a missing one (gone, another trip, not the writer's) or
 * one carrying another stamp than `expectedUpdatedAt` throws `ChangedSinceReadError`. The row is deleted and
 * its full snapshot becomes the `fileDeleted` receipt when the parent has a day. The file itself is never
 * touched here: it stays on disk for the undo, or the caller removes it after the commit for a parked one.
 */
export const deleteFileForConnector = async (params: {
  userId: string;
  tripId: string;
  target: DayChangeFileTarget;
  media: DayChangeFileMedia;
  fileId: string;
  expectedUpdatedAt: Date;
  /**
   * The parent's day the caller read (`null` when parked). The change row was labelled with it and chose
   * `requireReceipt` by it, so a parent parked, scheduled or moved since refuses as changed rather than
   * storing a change whose day and receipt disagree, or silently losing the undo.
   */
  expectedTripDayId: string | null;
  inTransaction: InTransactionHook;
}): Promise<ConnectorDeleteResult> => {
  const { userId, tripId, target, media, fileId, expectedUpdatedAt, expectedTripDayId } = params;
  const sameStamp = (value: Date) => value.getTime() === expectedUpdatedAt.getTime();
  return prisma.$transaction(async (tx) => {
    const itemWhere = { id: fileId, dayPlanItem: { tripId, trip: writerTrip(userId) } };
    const stayWhere = { id: fileId, accommodation: { tripDay: { tripId, trip: writerTrip(userId) } } };
    let deleted: DeletedFileRow;
    let parentId: string;
    let url: string;
    if (target === "activity") {
      if (media === "image") {
        const row = await tx.dayPlanItemImage.findFirst({ where: itemWhere });
        if (!row || !sameStamp(row.updatedAt)) throw new ChangedSinceReadError();
        await tx.dayPlanItemImage.delete({ where: { id: row.id } });
        deleted = { target, media, previous: row };
        parentId = row.dayPlanItemId;
        url = row.imageUrl;
      } else {
        const row = await tx.dayPlanItemDocument.findFirst({ where: itemWhere });
        if (!row || !sameStamp(row.updatedAt)) throw new ChangedSinceReadError();
        await tx.dayPlanItemDocument.delete({ where: { id: row.id } });
        deleted = { target, media, previous: row };
        parentId = row.dayPlanItemId;
        url = row.documentUrl;
      }
    } else if (media === "image") {
      const row = await tx.accommodationImage.findFirst({ where: stayWhere });
      if (!row || !sameStamp(row.updatedAt)) throw new ChangedSinceReadError();
      await tx.accommodationImage.delete({ where: { id: row.id } });
      deleted = { target, media, previous: row };
      parentId = row.accommodationId;
      url = row.imageUrl;
    } else {
      const row = await tx.accommodationDocument.findFirst({ where: stayWhere });
      if (!row || !sameStamp(row.updatedAt)) throw new ChangedSinceReadError();
      await tx.accommodationDocument.delete({ where: { id: row.id } });
      deleted = { target, media, previous: row };
      parentId = row.accommodationId;
      url = row.documentUrl;
    }

    const parentDay = await readParentDayInTransaction(tx, { userId, tripId, target, parentId });
    if (parentDay === undefined || parentDay !== expectedTripDayId) throw new ChangedSinceReadError();
    const tripDayId = parentDay;
    const receipt = tripDayId === null ? null : fileReceipt(tripDayId, { kind: "fileDeleted", ...deleted });
    await params.inTransaction(tx, { receipt, itemId: fileId });
    return { tripDayId, parentId, url };
  });
};
