import { prisma } from "@/lib/db/prisma";
import { findInvalidity, UndoStaleError } from "@/lib/repositories/dayPlanChangeRepo";
import type { TransactionClient } from "@/lib/repositories/travelSegmentRepo";
import {
  fromDayChangeReceiptWire,
  toDayChangeReceiptWire,
  type DayChangeReceipt,
} from "@/lib/trips/dayChangeReceipt";
import { runDayChangeUndo } from "@/lib/trips/dayChangeUndo";
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
 * Retention is 14 days: every read and undo ignores older rows, and every insert deletes them.
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
  | "legDeleted";

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
 * other housekeeping), then inserts this one and returns its id.
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
  await tx.aiChange.deleteMany({ where: { createdAt: { lt: retentionCutoff(now) } } });
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
 * Newest first, within retention, undone ones included unless `notUndone`. `tripDayId` narrows to one
 * day's changes; `take` caps the number of rows.
 */
export const listAiChangesForTrip = async (params: {
  tripId: string;
  tripDayId?: string;
  now: Date;
  notUndone?: boolean;
  take?: number;
}): Promise<AiChangeEntry[]> => {
  const rows = await prisma.aiChange.findMany({
    where: {
      tripId: params.tripId,
      ...(params.tripDayId !== undefined ? { tripDayId: params.tripDayId } : {}),
      ...(params.notUndone ? { undoneAt: null } : {}),
      createdAt: { gte: retentionCutoff(params.now) },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    ...(params.take !== undefined ? { take: params.take } : {}),
    select: entrySelect,
  });
  return rows.map(toEntry);
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
