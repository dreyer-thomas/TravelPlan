import { z } from "zod";

/**
 * Story 16.4. The stored packing receipt (`packingChangeReceipt.ts`) as `ai_changes.receipt_json` holds it.
 * Stored receipts are written by the server and trusted, but parsed back defensively like the day receipt:
 * every object `.strict()`, every id bounded, every date an ISO timestamp, every array capped.
 *
 * No length caps on stored text, for the reason `dayChangeReceiptSchemas.ts` gives: undo restores what
 * existed, and a cap stricter than what can be stored would make that item's own receipt un-undoable.
 */

const MAX_ID_LENGTH = 128;
/** The most items one connector call touches (`add_packing_items` takes at most 50). */
const MAX_ENTRIES = 50;
/** A body bound, not a data rule: far above any trip's day count. */
const MAX_DAY_IDS = 1000;

const idSchema = z.string().min(1).max(MAX_ID_LENGTH);
/** Exactly what `Date.prototype.toISOString` writes (as `dayChangeReceiptSchemas.ts`). */
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const isoDateSchema = z
  .string()
  .regex(ISO_TIMESTAMP, "Date must be an ISO timestamp")
  .refine((value) => Number.isFinite(Date.parse(value)), "Date must be an ISO timestamp");

const snapshotSchema = z
  .object({
    id: idSchema,
    name: z.string(),
    nameKey: z.string(),
    category: z.string().nullable(),
    packed: z.boolean(),
    aiChangedAt: isoDateSchema.nullable(),
    createdAt: isoDateSchema,
    updatedAt: isoDateSchema,
    dayIds: z.array(idSchema).max(MAX_DAY_IDS),
  })
  .strict();

const entrySchema = z.discriminatedUnion("change", [
  z.object({ change: z.literal("created"), itemId: idSchema, updatedAt: isoDateSchema }).strict(),
  z.object({ change: z.literal("updated"), before: snapshotSchema, updatedAt: isoDateSchema }).strict(),
  z.object({ change: z.literal("deleted"), before: snapshotSchema }).strict(),
]);

export const storedPackingChangeReceiptSchema = z
  .object({
    kind: z.literal("packingChanged"),
    version: z.literal(1),
    entries: z.array(entrySchema).min(1).max(MAX_ENTRIES),
  })
  .strict();
