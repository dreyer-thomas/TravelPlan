import { prisma } from "@/lib/db/prisma";
import {
  deletedFileParentId,
  deletedFileUrl,
  findInvalidity,
  resolveFileParentDir,
  UndoStaleError,
} from "@/lib/repositories/dayPlanChangeRepo";
import type { TransactionClient } from "@/lib/repositories/travelSegmentRepo";
import {
  fromDayChangeReceiptWire,
  toDayChangeReceiptWire,
  type DayChangeReceipt,
} from "@/lib/trips/dayChangeReceipt";
import { runDayChangeUndo } from "@/lib/trips/dayChangeUndo";
import { removeManagedMediaFile } from "@/lib/trips/mediaCleanup";
import { getTripDayUploadDir, isExternalMediaUrl } from "@/lib/trips/uploadPaths";
import { storedDayChangeReceiptSchema } from "@/lib/validation/dayChangeReceiptSchemas";

/**
 * Story 15.4. The connector's stored changes (`ai_changes`): one row per write tool call, inserted in the
 * write's own transaction through the repository's `inTransaction` hook, so the write and its record
 * commit together or not at all.
 *
 * A row says who (user, client metadata URL), what (`action` and `subject`, the activity's title at write
 * time, which the app phrases in the UI language) and how to take it back: the v3 day-change receipt in
 * its wire form, or `null` for a write the app cannot undo (a parked activity's create, edit or delete).
 * Stored receipts are trusted and unsigned; client-held receipts stay HMAC-signed.
 *
 * Retention is 14 days: every read and undo ignores older rows, and every insert deletes them. Story 15.7:
 * except a `fileDeleted` change that is still undoable, whose file stayed on disk for its undo. Deleting the
 * row there would orphan the file for good, and unlinking inside the insert's transaction would break a
 * still-valid undo if that transaction rolled back, so those rows wait for `sweepExpiredFileDeletions`,
 * which every connector write runs first.
 *
 * No access check here: the routes and tools gate the trip (writer, 404 otherwise) before calling, and the
 * undo core adds the writer clause on the receipt's day.
 */

export const AI_CHANGE_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Story 15.5 adds `planAppended` and `planReplaced` (`apply_day_plan`), whose `subject` is the new activities'
 * titles joined by ", ", capped at 120 characters.
 *
 * Story 15.6 adds the stay actions (`subject`: the stay's name) and the leg actions (`subject`: "<from> →
 * <to>", the endpoints' titles or names, "?" when untitled, capped at 120 code points).
 *
 * Story 15.7 adds `fileAttached` and `fileDeleted` (`subject`: the file's name, capped at 120 code points).
 *
 * Story 15.9 adds the day's own note and picture: `dayNoteChanged` (`subject`: the new note, or the previous
 * one when cleared), `dayImageSet` and `dayImageRemoved` (`subject`: the picture's file name), each capped
 * at 120 code points.
 */
export type AiChangeAction =
  | "created"
  | "updated"
  | "deleted"
  | "moved"
  | "parked"
  | "scheduled"
  | "planAppended"
  | "planReplaced"
  | "stayCreated"
  | "stayUpdated"
  | "stayDeleted"
  | "legCreated"
  | "legUpdated"
  | "legDeleted"
  | "fileAttached"
  | "fileDeleted"
  | "dayNoteChanged"
  | "dayImageSet"
  | "dayImageRemoved";

export type AiChangeEntry = {
  id: string;
  tripId: string;
  tripDayId: string | null;
  userId: string;
  clientId: string;
  action: string;
  subject: string | null;
  createdAt: Date;
  undoneAt: Date | null;
  /** A receipt is stored. Whether the undo would still succeed is only known by trying it. */
  hasReceipt: boolean;
};

export type AiChangeUndoResult =
  | { status: "undone" }
  | { status: "not_found" }
  | { status: "already_undone" }
  | { status: "unavailable" }
  | { status: "stale" };

const retentionCutoff = (now: Date) => new Date(now.getTime() - AI_CHANGE_RETENTION_MS);

/**
 * Story 15.7. A `fileDeleted` change whose undo may still need its kept file: only the sweep removes it.
 * Story 15.9: so may a day picture the connector replaced or removed. A `dayImageSet` over a day without a
 * picture keeps nothing; the sweep simply finds no file to remove.
 */
const KEPT_FILE_ACTIONS: AiChangeAction[] = ["fileDeleted", "dayImageSet", "dayImageRemoved"];
const keptFileWhere = { action: { in: KEPT_FILE_ACTIONS }, undoneAt: null, receiptJson: { not: null } };

const entrySelect = {
  id: true,
  tripId: true,
  tripDayId: true,
  userId: true,
  clientId: true,
  action: true,
  subject: true,
  createdAt: true,
  undoneAt: true,
  receiptJson: true,
} as const;

const toEntry = (row: {
  id: string;
  tripId: string;
  tripDayId: string | null;
  userId: string;
  clientId: string;
  action: string;
  subject: string | null;
  createdAt: Date;
  undoneAt: Date | null;
  receiptJson: string | null;
}): AiChangeEntry => ({
  id: row.id,
  tripId: row.tripId,
  tripDayId: row.tripDayId,
  userId: row.userId,
  clientId: row.clientId,
  action: row.action,
  subject: row.subject,
  createdAt: row.createdAt,
  undoneAt: row.undoneAt,
  hasReceipt: row.receiptJson !== null,
});

/**
 * Story 15.5. A write that must not commit without its undo (a plan's `replace` deletes a whole day) asked
 * for a receipt the stored schema refuses, or one the undo would refuse as invalid (e.g. an image stored as
 * an external address). Thrown inside the write's transaction, so nothing is written.
 */
export class UnstorableReceiptError extends Error {
  constructor() {
    super("The change's receipt cannot be stored");
    this.name = "UnstorableReceiptError";
  }
}

/**
 * The receipt's wire form as stored, or `null` when there is none or it would not parse back: a stored
 * receipt the undo cannot read must not make the list claim "undoable". With `requireReceipt` (Story 15.5)
 * the second case throws `UnstorableReceiptError` instead, as does a receipt the undo would refuse as
 * invalid for this trip.
 */
const storableReceiptJson = (
  receipt: DayChangeReceipt | null,
  tripId: string,
  requireReceipt = false,
): string | null => {
  if (!receipt) return null;
  if (requireReceipt && findInvalidity(receipt, tripId) !== null) throw new UnstorableReceiptError();
  const wire = toDayChangeReceiptWire(receipt);
  if (!storedDayChangeReceiptSchema.safeParse(wire).success) {
    if (requireReceipt) throw new UnstorableReceiptError();
    console.error(`ai-changes: receipt kind=${receipt.edited.kind} failed the stored schema; stored without receipt`);
    return null;
  }
  return JSON.stringify(wire);
};

/**
 * Inside the write's transaction. Deletes every row past retention first (all trips: the table has no
 * other housekeeping) except the ones keeping a deleted file (Story 15.7, the sweep's), then inserts this
 * one and returns its id.
 */
export const insertAiChangeInTransaction = async (
  tx: TransactionClient,
  params: {
    tripId: string;
    tripDayId: string | null;
    userId: string;
    clientId: string;
    action: AiChangeAction;
    subject: string | null;
    receipt: DayChangeReceipt | null;
    /** Story 15.5. Refuse (throw, rolling the write back) rather than store a receipt the undo cannot read. */
    requireReceipt?: boolean;
    now?: Date;
  },
): Promise<string> => {
  const now = params.now ?? new Date();
  await tx.aiChange.deleteMany({ where: { createdAt: { lt: retentionCutoff(now) }, NOT: keptFileWhere } });
  const row = await tx.aiChange.create({
    data: {
      tripId: params.tripId,
      tripDayId: params.tripDayId,
      userId: params.userId,
      clientId: params.clientId,
      action: params.action,
      subject: params.subject,
      receiptJson: storableReceiptJson(params.receipt, params.tripId, params.requireReceipt),
      createdAt: now,
    },
    select: { id: true },
  });
  return row.id;
};

/**
 * Newest first, within retention, undone ones included unless `notUndone`, acknowledged ones unless
 * `notAcknowledged`. `tripDayId` narrows to one day's changes; `take` caps the number of rows.
 */
export const listAiChangesForTrip = async (params: {
  tripId: string;
  tripDayId?: string;
  now: Date;
  notUndone?: boolean;
  notAcknowledged?: boolean;
  take?: number;
}): Promise<AiChangeEntry[]> => {
  const rows = await prisma.aiChange.findMany({
    where: {
      tripId: params.tripId,
      ...(params.tripDayId !== undefined ? { tripDayId: params.tripDayId } : {}),
      ...(params.notUndone ? { undoneAt: null } : {}),
      ...(params.notAcknowledged ? { acknowledgedAt: null } : {}),
      createdAt: { gte: retentionCutoff(params.now) },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    ...(params.take !== undefined ? { take: params.take } : {}),
    select: entrySelect,
  });
  return rows.map(toEntry);
};

/**
 * The day view's OK (2026-10-31): marks the listed changes as seen, for every planner of the trip. Only
 * the ids the notice showed, so a change the assistant makes meanwhile is not confirmed unseen; ids of
 * another trip, already acknowledged ones and expired ones are skipped. Returns how many it marked.
 */
export const acknowledgeAiChanges = async (params: {
  tripId: string;
  changeIds: string[];
  now: Date;
}): Promise<number> => {
  if (params.changeIds.length === 0) return 0;
  const result = await prisma.aiChange.updateMany({
    where: {
      id: { in: params.changeIds },
      tripId: params.tripId,
      acknowledgedAt: null,
      createdAt: { gte: retentionCutoff(params.now) },
    },
    data: { acknowledgedAt: params.now },
  });
  return result.count;
};

export const findAiChangeForTrip = async (params: {
  tripId: string;
  changeId: string;
  now: Date;
}): Promise<AiChangeEntry | null> => {
  const row = await prisma.aiChange.findFirst({
    where: { id: params.changeId, tripId: params.tripId, createdAt: { gte: retentionCutoff(params.now) } },
    select: entrySelect,
  });
  return row ? toEntry(row) : null;
};

const parseStoredReceipt = (receiptJson: string): DayChangeReceipt | null => {
  let raw: unknown;
  try {
    raw = JSON.parse(receiptJson);
  } catch {
    return null;
  }
  const parsed = storedDayChangeReceiptSchema.safeParse(raw);
  return parsed.success ? fromDayChangeReceiptWire(parsed.data) : null;
};

/**
 * Story 15.7. Whether any of the four media tables names this stored URL (again). Story 15.9: or any day's
 * picture, which matters because the app's own `day.<ext>` name is reused by every later app upload.
 */
const mediaRowNamesUrl = async (url: string) => {
  const counts = await Promise.all([
    prisma.dayPlanItemDocument.count({ where: { documentUrl: url } }),
    prisma.dayPlanItemImage.count({ where: { imageUrl: url } }),
    prisma.accommodationDocument.count({ where: { documentUrl: url } }),
    prisma.accommodationImage.count({ where: { imageUrl: url } }),
    prisma.tripDay.count({ where: { imageUrl: url } }),
  ]);
  return counts.some((count) => count > 0);
};

/**
 * Story 15.7. The housekeeping the retention delete leaves out: every `fileDeleted` change past retention
 * that was never undone (Story 15.9: and every replaced or removed day picture's). Each row is deleted first (conditional on still being not undone), and only then
 * its kept file unlinked, so a crash in between leaves an orphaned file, never a row whose file is gone.
 * A file a media row names again (an import or a copy reusing the URL) is kept; each unlink is confined to
 * the parent's own folder, as the undo's is. Returns how many rows it removed. Failures to unlink are
 * logged by `removeManagedMediaFile` and never thrown.
 *
 * It runs on a connector write's request path, so one call takes at most `SWEEP_BATCH` rows, oldest first;
 * a backlog drains over the following writes. A receipt that no longer parses is read before its row goes,
 * and logged with the change id, because the row is the only record of where its kept file is.
 */
const SWEEP_BATCH = 25;

/**
 * Story 15.9. Whether another day picture change still in the window keeps this URL for its undo. The app
 * writes every upload to the same `day.<ext>`, so two connector replaces around an app upload both keep it.
 */
const pendingDayChangeKeepsUrl = async (tripDayId: string, url: string) => {
  const rows = await prisma.aiChange.findMany({
    where: { ...keptFileWhere, tripDayId, action: { in: ["dayImageSet", "dayImageRemoved"] } },
    select: { receiptJson: true },
  });
  return rows.some((row) => {
    const receipt = row.receiptJson === null ? null : parseStoredReceipt(row.receiptJson);
    return receipt?.edited.kind === "dayDetailsChanged" && receipt.edited.previous.imageUrl === url;
  });
};

/**
 * Story 15.9. The day picture a `dayDetailsChanged` replaced or removed: the previous one, when it is a stored
 * file and not the picture the write left. Kept while any day or media row names it, or another pending day
 * picture change keeps it; the unlink is confined to the receipt's day's own upload folder.
 */
const removeKeptDayPicture = async (tripId: string, receipt: DayChangeReceipt) => {
  const { edited } = receipt;
  if (edited.kind !== "dayDetailsChanged") return;
  const storedUrl = edited.previous.imageUrl;
  if (storedUrl === null || storedUrl === edited.imageUrl || isExternalMediaUrl(storedUrl)) return;
  if (await mediaRowNamesUrl(storedUrl)) return;
  if (await pendingDayChangeKeepsUrl(receipt.tripDayId, storedUrl)) return;
  await removeManagedMediaFile({
    storedUrl,
    allowedDir: getTripDayUploadDir(tripId, receipt.tripDayId),
    context: "ai-changes sweep",
  });
};

export const sweepExpiredFileDeletions = async (now: Date = new Date()): Promise<number> => {
  const rows = await prisma.aiChange.findMany({
    where: { ...keptFileWhere, createdAt: { lt: retentionCutoff(now) } },
    select: { id: true, tripId: true, receiptJson: true },
    orderBy: { createdAt: "asc" },
    take: SWEEP_BATCH,
  });
  let removed = 0;
  for (const row of rows) {
    const receipt = row.receiptJson === null ? null : parseStoredReceipt(row.receiptJson);
    const deleted = await prisma.aiChange.deleteMany({ where: { id: row.id, undoneAt: null } });
    if (deleted.count !== 1) continue;
    removed += 1;
    if (receipt?.edited.kind === "dayDetailsChanged") {
      await removeKeptDayPicture(row.tripId, receipt);
      continue;
    }
    if (!receipt || receipt.edited.kind !== "fileDeleted") {
      console.error("ai-changes sweep: kept file's receipt no longer reads; file left on disk", {
        tripId: row.tripId,
        changeId: row.id,
      });
      continue;
    }
    const { edited } = receipt;
    const storedUrl = deletedFileUrl(edited);
    if (isExternalMediaUrl(storedUrl) || (await mediaRowNamesUrl(storedUrl))) continue;
    const allowedDir = resolveFileParentDir({
      storedUrl,
      tripId: row.tripId,
      target: edited.target,
      media: edited.media,
      parentId: deletedFileParentId(edited),
    });
    if (!allowedDir) {
      console.error("ai-changes sweep: kept file url names no folder of its entry", { tripId: row.tripId, changeId: row.id });
      continue;
    }
    await removeManagedMediaFile({ storedUrl, allowedDir, context: "ai-changes sweep" });
  }
  return removed;
};

/**
 * Undoes one stored change through the shared undo core, marking it undone in the same transaction
 * (conditional on it not being undone yet, so two concurrent undos cannot both succeed).
 *
 * `not_found`: no such change on this trip within retention, or the user may not write its day.
 * `unavailable`: no receipt, or one that no longer parses or fails the core's ownership checks.
 * `stale`: the core's rule (`409 undo_stale`), unchanged.
 */
export const undoAiChange = async (params: {
  userId: string;
  tripId: string;
  changeId: string;
  now: Date;
}): Promise<AiChangeUndoResult> => {
  const { userId, tripId, changeId, now } = params;
  const row = await prisma.aiChange.findFirst({
    where: { id: changeId, tripId, createdAt: { gte: retentionCutoff(now) } },
    select: { id: true, undoneAt: true, receiptJson: true },
  });
  if (!row) return { status: "not_found" };
  if (row.undoneAt) return { status: "already_undone" };
  if (row.receiptJson === null) return { status: "unavailable" };
  const receipt = parseStoredReceipt(row.receiptJson);
  if (!receipt) return { status: "unavailable" };

  const result = await runDayChangeUndo({
    userId,
    tripId,
    receipt,
    logContext: "ai-changes undo",
    inTransaction: async (tx) => {
      const marked = await tx.aiChange.updateMany({ where: { id: row.id, undoneAt: null }, data: { undoneAt: now } });
      if (marked.count !== 1) throw new UndoStaleError("change already undone");
    },
  });

  switch (result.status) {
    case "undone":
      return { status: "undone" };
    case "not_found":
      return { status: "not_found" };
    case "invalid":
      return { status: "unavailable" };
    case "stale": {
      // A concurrent undo of the same change got there first: say so rather than "stale".
      const after = await prisma.aiChange.findUnique({ where: { id: row.id }, select: { undoneAt: true } });
      return after?.undoneAt ? { status: "already_undone" } : { status: "stale" };
    }
    default: {
      const unhandled: never = result;
      throw new Error(`Unhandled undo result: ${String(unhandled)}`);
    }
  }
};
