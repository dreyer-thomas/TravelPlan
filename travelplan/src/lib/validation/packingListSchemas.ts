import { z } from "zod";
import { PACKING_CATEGORY_MAX, PACKING_ITEM_NAME_MAX } from "@/lib/trips/packingList";

/**
 * Story 16.1 (FR58). The packing list's write payloads. Lengths are measured after NFC normalization and trimming; `null` or
 * `""` clears the category. `.strict()`, so a stray field is a 400 rather than silently dropped. The
 * "Sonstiges"/"Other" folding and the reuse of an existing spelling happen in the repository.
 */

// NFC before the length check: the repository stores the NFC form, and a few characters grow under it,
// so measuring the raw input could let a stored name exceed the limit.
const nameField = z
  .string()
  .transform((value) => value.normalize("NFC").trim())
  .pipe(
    z
      .string()
      .min(1, "Name is required")
      .max(PACKING_ITEM_NAME_MAX, `Name must be at most ${PACKING_ITEM_NAME_MAX} characters`),
  );

const categoryField = z
  .string()
  .transform((value) => value.normalize("NFC").trim())
  .pipe(z.string().max(PACKING_CATEGORY_MAX, `Category must be at most ${PACKING_CATEGORY_MAX} characters`))
  .nullable();

const itemIdField = z.string().trim().min(1, "Packing item is required");

export const packingItemCreateSchema = z
  .object({
    name: nameField,
    category: categoryField.optional(),
  })
  .strict();

export type PackingItemCreateInput = z.infer<typeof packingItemCreateSchema>;

export const packingItemUpdateSchema = z
  .object({
    itemId: itemIdField,
    name: nameField.optional(),
    category: categoryField.optional(),
    packed: z.boolean().optional(),
  })
  .strict()
  .refine((value) => value.name !== undefined || value.category !== undefined || value.packed !== undefined, {
    message: "Nothing to update",
  });

export type PackingItemUpdateInput = z.infer<typeof packingItemUpdateSchema>;

// Story 16.2 (DW-432): the day count the person confirmed; a stale one is refused with the fresh count.
export const packingItemDeleteSchema = z
  .object({ itemId: itemIdField, confirmedDayCount: z.number().int().min(0).optional() })
  .strict();

export type PackingItemDeleteInput = z.infer<typeof packingItemDeleteSchema>;

const tripDayIdField = z.string().trim().min(1, "Trip day is required");

/**
 * Story 16.2 (FR59). Adds to a day either an item of the trip (`itemId`) or a name (`name`, with an
 * optional category for a new item); the server resolves an existing name to its item. Exactly one of
 * the two shapes - both or neither is a 400.
 */
export const packingDayLinkCreateSchema = z.union([
  z.object({ tripDayId: tripDayIdField, itemId: itemIdField }).strict(),
  z.object({ tripDayId: tripDayIdField, name: nameField, category: categoryField.optional() }).strict(),
]);

export type PackingDayLinkCreateInput = z.infer<typeof packingDayLinkCreateSchema>;

export const packingDayLinkDeleteSchema = z.object({ tripDayId: tripDayIdField, itemId: itemIdField }).strict();

export type PackingDayLinkDeleteInput = z.infer<typeof packingDayLinkDeleteSchema>;
