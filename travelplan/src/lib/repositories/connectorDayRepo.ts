import { prisma } from "@/lib/db/prisma";
import type { DayChangeReceipt } from "@/lib/trips/dayChangeReceipt";
import { ChangedSinceReadError, type InTransactionHook } from "@/lib/trips/writeOrigin";

/**
 * Story 15.9. The connector's writes to the day's own note and picture, each one transaction with its
 * `ai_changes` record (the `inTransaction` hook), as every connector write since 15.4. The tool has already
 * placed a new picture's bytes on disk; this module only touches the day row. A picture the write replaces
 * or removes stays on disk for the undo (`dayDetailsChanged`), and the expiry sweep removes it later.
 *
 * Writers only: the day is re-read inside the transaction with the writer clause (owner, or a `CONTRIBUTOR`
 * member), so a viewer's or a stranger's call finds nothing, exactly like an id that names nothing. The
 * receipt's `previous` comes from that read, never from one before the transaction.
 *
 * Both write through Prisma's `update` (millisecond stamps), not the raw `CURRENT_TIMESTAMP` the app's day
 * route uses, and both set the day's KI/AI marker.
 */

const writerTrip = (userId: string) => ({ OR: [{ userId }, { members: { some: { userId, role: "CONTRIBUTOR" as const } } }] });

const daySelect = { note: true, imageUrl: true, updatedAt: true, aiChangedAt: true } as const;

type DayRow = { note: string | null; imageUrl: string | null; updatedAt: Date; aiChangedAt: Date | null };

const dayDetailsReceipt = (dayId: string, before: DayRow, updatedAt: Date, imageUrl: string | null): DayChangeReceipt => ({
  version: 3,
  tripDayId: dayId,
  edited: {
    kind: "dayDetailsChanged",
    updatedAt,
    previous: { note: before.note, imageUrl: before.imageUrl, aiChangedAt: before.aiChangedAt },
    imageUrl,
  },
  removedTravelSegments: [],
  movedItems: [],
});

/** `written`: the day after the write. `unchanged`: the note was already that, and nothing was written. */
export type ConnectorDayWriteResult = { status: "written"; updatedAt: Date } | { status: "unchanged" };

/**
 * The day's note, checked against the `updatedAt` the model read (`ChangedSinceReadError` otherwise). `note`
 * is already trimmed, `null` to clear. A note equal to the stored one (trimmed, blank as none) writes nothing
 * and does not run the hook. The picture is never touched. `null`: no such day on a trip this user may plan.
 */
export const updateDayNoteForConnector = async (params: {
  userId: string;
  tripId: string;
  dayId: string;
  note: string | null;
  expectedUpdatedAt: Date;
  inTransaction: InTransactionHook;
}): Promise<ConnectorDayWriteResult | null> => {
  const { userId, tripId, dayId, note, expectedUpdatedAt, inTransaction } = params;
  return prisma.$transaction(async (tx) => {
    const day = await tx.tripDay.findFirst({ where: { id: dayId, tripId, trip: writerTrip(userId) }, select: daySelect });
    if (!day) return null;
    if (day.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new ChangedSinceReadError();
    if ((day.note?.trim() || null) === note) return { status: "unchanged" };

    const updated = await tx.tripDay.update({
      where: { id: dayId },
      data: { note, aiChangedAt: new Date() },
      select: { updatedAt: true },
    });
    await inTransaction(tx, { receipt: dayDetailsReceipt(dayId, day, updated.updatedAt, day.imageUrl), itemId: dayId });
    return { status: "written", updatedAt: updated.updatedAt };
  });
};

/**
 * The day's picture: a new stored URL (attach, which replaces any picture without a stamp) or `null` (delete,
 * checked against the `updatedAt` the model read). Deleting from a day without a picture throws
 * `ChangedSinceReadError`: the picture the model read is gone. `null`: no such day on a trip this user may plan.
 */
export const setDayImageForConnector = async (params: {
  userId: string;
  tripId: string;
  dayId: string;
  imageUrl: string | null;
  expectedUpdatedAt?: Date;
  inTransaction: InTransactionHook;
}): Promise<{ updatedAt: Date } | null> => {
  const { userId, tripId, dayId, imageUrl, expectedUpdatedAt, inTransaction } = params;
  return prisma.$transaction(async (tx) => {
    const day = await tx.tripDay.findFirst({ where: { id: dayId, tripId, trip: writerTrip(userId) }, select: daySelect });
    if (!day) return null;
    if (expectedUpdatedAt && day.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new ChangedSinceReadError();
    if (imageUrl === null && !day.imageUrl?.trim()) throw new ChangedSinceReadError();

    const updated = await tx.tripDay.update({
      where: { id: dayId },
      data: { imageUrl, aiChangedAt: new Date() },
      select: { updatedAt: true },
    });
    await inTransaction(tx, { receipt: dayDetailsReceipt(dayId, day, updated.updatedAt, imageUrl), itemId: dayId });
    return { updatedAt: updated.updatedAt };
  });
};
