import { z } from "zod";
import {
  PACKING_CATEGORY_MAX,
  PACKING_ITEM_NAME_MAX,
  PACKING_TAG_MAX,
  PACKING_TAGS_PER_ITEM_MAX,
  dedupePackingTags,
} from "@/lib/trips/packingList";

/**
 * Story 16.1 (FR58). The packing list's write payloads. Lengths are measured after NFC normalization and trimming; `null` or
 * `""` clears the category. `.strict()`, so a stray field is a 400 rather than silently dropped. The
 * "Sonstiges"/"Other" folding and the reuse of an existing spelling happen in the repository.
 */

// Story 16.4: `nameField` and `categoryField` are exported for the connector's packing tools.
// NFC before the length check: the repository stores the NFC form, and a few characters grow under it,
// so measuring the raw input could let a stored name exceed the limit.
export const nameField = z
  .string()
  .transform((value) => value.normalize("NFC").trim())
  .pipe(
    z
      .string()
      .min(1, "Name is required")
      .max(PACKING_ITEM_NAME_MAX, `Name must be at most ${PACKING_ITEM_NAME_MAX} characters`),
  );

export const categoryField = z
  .string()
  .transform((value) => value.normalize("NFC").trim())
  .pipe(z.string().max(PACKING_CATEGORY_MAX, `Category must be at most ${PACKING_CATEGORY_MAX} characters`))
  .nullable();

// Story 16.8: a free tag. NFC + trim before the checks; a comma is refused because it is the separator in
// the tags input and in the day email ("Powerbank (Aufladen, Kaufen)").
export const tagField = z
  .string()
  .transform((value) => value.normalize("NFC").trim())
  .pipe(
    z
      .string()
      .min(1, "Tag is required")
      .max(PACKING_TAG_MAX, `Tag must be at most ${PACKING_TAG_MAX} characters`)
      .refine((value) => !value.includes(","), "Tag must not contain a comma"),
  );

// The raw array bound is a body bound; the dedupe can only shrink it. Merges re-check the limit in the
// repository.
export const tagsField = z
  .array(tagField)
  .max(PACKING_TAGS_PER_ITEM_MAX, `An item carries at most ${PACKING_TAGS_PER_ITEM_MAX} tags`)
  .transform((tags) => dedupePackingTags(tags));

const itemIdField = z.string().trim().min(1, "Packing item is required");

export const packingItemCreateSchema = z
  .object({
    name: nameField,
    category: categoryField.optional(),
    // Story 16.8: for a name that exists, the tags are added to that item (D3).
    tags: tagsField.optional(),
  })
  .strict();

export type PackingItemCreateInput = z.infer<typeof packingItemCreateSchema>;

// Story 16.7: `notNeeded` marks the item not needed this time (or needed again); `confirmedDayCount` is
// the day count the person confirmed for that mark (DW-432 pattern) and means nothing without it.
export const packingItemUpdateSchema = z
  .object({
    itemId: itemIdField,
    name: nameField.optional(),
    category: categoryField.optional(),
    packed: z.boolean().optional(),
    notNeeded: z.boolean().optional(),
    // Story 16.8: the item's full tag list (replacement).
    tags: tagsField.optional(),
    confirmedDayCount: z.number().int().min(0).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.name !== undefined ||
      value.category !== undefined ||
      value.packed !== undefined ||
      value.notNeeded !== undefined ||
      value.tags !== undefined,
    { message: "Nothing to update" },
  )
  .refine((value) => !(value.notNeeded === true && value.packed === true), {
    message: "An item cannot be packed and not needed",
  })
  .refine((value) => value.confirmedDayCount === undefined || value.notNeeded === true, {
    message: "confirmedDayCount only goes with notNeeded: true",
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
 *
 * Story 16.7: `markNeeded: true` says the item may be not needed and is to be marked needed again with the
 * link; without it, a not-needed item is refused (409 `not_needed`).
 */
const markNeededField = z.literal(true).optional();

export const packingDayLinkCreateSchema = z.union([
  z.object({ tripDayId: tripDayIdField, itemId: itemIdField, markNeeded: markNeededField }).strict(),
  z
    .object({ tripDayId: tripDayIdField, name: nameField, category: categoryField.optional(), markNeeded: markNeededField })
    .strict(),
]);

export type PackingDayLinkCreateInput = z.infer<typeof packingDayLinkCreateSchema>;

export const packingDayLinkDeleteSchema = z.object({ tripDayId: tripDayIdField, itemId: itemIdField }).strict();

export type PackingDayLinkDeleteInput = z.infer<typeof packingDayLinkDeleteSchema>;

/**
 * Story 16.5 (FR60). Copy items from another trip's packing list: the source trip and the chosen item ids.
 * `PACKING_COPY_MAX_ITEMS` is a body bound (there is no per-trip item cap); duplicate ids are dropped.
 * Ids that are not on the source trip are ignored by the repository (D5).
 */
export const PACKING_COPY_MAX_ITEMS = 500;

export const packingCopySchema = z
  .object({
    sourceTripId: z.string().trim().min(1, "Source trip is required"),
    itemIds: z
      .array(itemIdField)
      .min(1, "Nothing selected")
      .max(PACKING_COPY_MAX_ITEMS, `At most ${PACKING_COPY_MAX_ITEMS} items can be copied at once`)
      .transform((ids) => [...new Set(ids)]),
  })
  .strict();

export type PackingCopyInput = z.infer<typeof packingCopySchema>;
