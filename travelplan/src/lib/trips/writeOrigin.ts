import type { TransactionClient } from "@/lib/repositories/travelSegmentRepo";
import type { DayChangeReceipt } from "@/lib/trips/dayChangeReceipt";

/**
 * Story 15.4. Who a repository write is for: a person in the app (`"user"`) or the connector (`"ai"`).
 *
 * Every exported repository function that creates or edits an activity (on a day or parked), a stay, a
 * leg, or an item/stay image or document row takes it as a required parameter, with no default, so a new
 * caller cannot forget to say. A write sets (`"ai"`) or clears (`"user"`) `aiChangedAt` only on the rows it
 * targets: the created or edited row, the moved, parked or scheduled activity, the rows a day transfer
 * moved. A media upload targets only its new image or document row, not the activity or stay it belongs
 * to, so it neither sets nor clears that entry's badge. Rows the recompute only shifts or renumbers keep
 * their value. Pure deletes and media-order changes take no origin: they leave no marked row behind.
 */
export type WriteOrigin = "user" | "ai";

/** The `aiChangedAt` value a write with `origin` stores on the rows it targets. */
export const aiChangedAtFor = (origin: WriteOrigin, now: Date): Date | null => (origin === "ai" ? now : null);

/**
 * Story 15.4. An update or delete was given the `updatedAt` its caller read, and the row no longer carries
 * it. Thrown inside the write's transaction, so nothing is written; the connector maps it to "changed
 * since you read it".
 */
export class ChangedSinceReadError extends Error {
  constructor() {
    super("The row changed since it was read");
    this.name = "ChangedSinceReadError";
  }
}

/**
 * Story 15.4. Runs last inside a write's transaction, with the write's receipt (`null` for writes the app
 * cannot undo: the parked create, edit and delete) and the id of the row it targeted. The connector
 * inserts its `ai_changes` row here, so the write and its record commit together; a throw rolls both back.
 *
 * Story 15.6: `itemId` is the targeted row, whatever its kind: the activity, the stay or the leg.
 */
export type InTransactionHook = (
  tx: TransactionClient,
  outcome: { receipt: DayChangeReceipt | null; itemId: string },
) => Promise<void>;
