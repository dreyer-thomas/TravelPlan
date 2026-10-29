import fs from "node:fs/promises";
import {
  undoDayPlanChangeForTrip,
  type DayPlanChangeUndoResult,
  type UndoneImageFile,
} from "@/lib/repositories/dayPlanChangeRepo";
import type { TransactionClient } from "@/lib/repositories/travelSegmentRepo";
import type { DayChangeReceipt } from "@/lib/trips/dayChangeReceipt";
import { removeManagedMediaFile } from "@/lib/trips/mediaCleanup";
import { resolveManagedItemMediaDir } from "@/lib/trips/uploadPaths";

/**
 * Story 15.4. The undo core, shared by its three callers: the app's receipt route
 * (`day-plan-changes/undo`, which checks the receipt's signature first), the app's route for a stored AI
 * change (`ai-changes/[changeId]/undo`) and the connector's `undo_ai_change` tool. One line: the
 * repository transaction (with the caller's optional `inTransaction` write) and then the post-commit
 * cleanup of the image files the undo took away.
 *
 * Story 12.4: undoing an apply of suggestions deletes image rows whose files nothing else names. They are
 * unlinked here, after the transaction has committed and only for the rows it read, each confined to its
 * activity's own directory, and then that directory itself once it is empty. A failed unlink is logged
 * and never turns the undo into an error.
 */

export type DayChangeUndoOutcome =
  | { status: "undone" }
  | Exclude<DayPlanChangeUndoResult, { status: "undone" }>;

const removeUndoneImageFiles = async (tripId: string, removedFiles: UndoneImageFile[], logContext: string) => {
  // Story 14.1: each file from the folder its own URL names (`resolveManagedItemMediaDir`), not one
  // built from the receipt's day; a URL outside the activity's folders is logged and skipped.
  const folders = new Set<string>();
  for (const file of removedFiles) {
    const allowedDir = resolveManagedItemMediaDir({
      storedUrl: file.imageUrl,
      tripId,
      itemId: file.dayPlanItemId,
      kind: "image",
    });
    if (!allowedDir) {
      console.error(`${logContext}: stored media url names no folder of this activity`, {
        tripId,
        dayPlanItemId: file.dayPlanItemId,
        storedUrl: file.imageUrl,
      });
      continue;
    }
    folders.add(allowedDir);
    await removeManagedMediaFile({ storedUrl: file.imageUrl, allowedDir, context: logContext });
  }
  // Then each activity's own directory, which nothing names any more. `rmdir` only removes an
  // empty one, so anything else found there stays; failures are not the user's problem.
  for (const folder of folders) {
    await fs.rmdir(folder).catch(() => undefined);
  }
};

export const runDayChangeUndo = async (params: {
  userId: string;
  tripId: string;
  receipt: DayChangeReceipt;
  /** Runs after the reverse writes, inside the undo's transaction; a throw rolls the undo back. */
  inTransaction?: (tx: TransactionClient) => Promise<void>;
  /** The prefix of the cleanup's log lines. */
  logContext?: string;
}): Promise<DayChangeUndoOutcome> => {
  const { userId, tripId, receipt, inTransaction, logContext = "day-plan-changes undo" } = params;
  const result = await undoDayPlanChangeForTrip({ userId, tripId, receipt, inTransaction });
  if (result.status !== "undone") return result;
  await removeUndoneImageFiles(tripId, result.removedImageFiles ?? [], logContext);
  return { status: "undone" };
};
