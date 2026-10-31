import { z } from "zod";
import type { DayChangeTransportType } from "@/lib/trips/dayChangeReceipt";
import { isTransportType } from "@/lib/trips/transportTypes";
import { MAX_DAY_PLAN_APPLY_ACTIVITIES } from "@/lib/validation/dayPlanItemSchemas";
import { MAX_SUGGESTIONS } from "@/lib/validation/daySuggestionSchemas";
import { isSafeExternalUrl } from "@/lib/validation/safeExternalUrl";
import { isSafeStoredImageUrl, MAX_STORED_IMAGE_URL_LENGTH } from "@/lib/validation/safeStoredImageUrl";

/**
 * Story 11.1 AC12. The wire form of a change receipt, as the undo route receives it back.
 *
 * The receipt comes from the client, so it is untrusted input even though the server wrote it: the undo
 * endpoint must be no more powerful than the write endpoints it reverses. The main guarantee of that is
 * the server's signature (`dayChangeReceiptSignature.ts`, checked in the route right after this schema):
 * a receipt the server did not issue, or one altered since, is refused before anything reads it. This
 * schema is the shape half underneath (every object `.strict()`, every id bounded, every date an ISO
 * timestamp, every array capped, every URL safe); `dayPlanChangeRepo.ts` does the ownership half (every
 * row on the receipt's day, that day on the trip in the URL, every media URL inside this trip's upload
 * tree). Both stay as defence in depth.
 *
 * **Neither create-time business rules nor write-time length limits are re-applied.** The per-mode
 * distance rule, "payments must sum to the cost", "to after from", a 120-character title — a
 * legitimately stored row (an import, an older version of the app) may not satisfy them, and undo
 * restores what existed rather than authoring anything new. A cap stricter than what can be stored would
 * make that row's own receipt un-undoable, so stored text carries no length cap here; the signature, not
 * a cap, is what keeps forged content out. What is kept is every rule that protects a *reader*: URL
 * schemes, enum vocabularies, and array caps that only bound the request body.
 */

const MAX_ID_LENGTH = 128;
/** Only for URLs, whose stored length the write paths bound. */
const MAX_URL_LENGTH = 2000;
/**
 * Body bounds, not data rules: well above anything a day can hold (an import caps a day at 200 legs;
 * payments and images per entry are uncapped on the write side, but nothing realistic nears this).
 */
const MAX_LEGS = 1000;
const MAX_PAYMENTS = 1000;
const MAX_MEDIA = 1000;
/** Story 12.4: `MAX_SUGGESTIONS` and the three pictures a suggestion carries. */
const MAX_APPLIED_SUGGESTIONS = MAX_SUGGESTIONS;
const MAX_IMAGES_PER_APPLIED_SUGGESTION = 3;

const idSchema = z.string().min(1).max(MAX_ID_LENGTH);
const nullableText = () => z.string().nullable();
/** Exactly what `Date.prototype.toISOString` writes — `Date.parse` alone also takes "2026" or "Oct 10 2026". */
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const isoDateSchema = z
  .string()
  .regex(ISO_TIMESTAMP, "Date must be an ISO timestamp")
  .refine((value) => Number.isFinite(Date.parse(value)), "Date must be an ISO timestamp");
const finiteNullable = z.number().finite().nullable();
const safeLinkSchema = z
  .string()
  .max(MAX_URL_LENGTH)
  .refine((value) => isSafeExternalUrl(value), "Link must use http or https")
  .nullable();
const endpointTypeSchema = z.enum(["ACCOMMODATION", "DAY_PLAN_ITEM"]);
/**
 * A receipt carries stored rows, so the stored (uppercase) spelling — derived from the shared lowercase
 * vocabulary rather than restated, so a sixth mode cannot be accepted on the write side and refused here.
 */
const transportTypeSchema = z
  .string()
  .refine(
    (value) => value === value.toUpperCase() && isTransportType(value.toLowerCase()),
    "Unknown transport type",
  )
  .transform((value) => value as DayChangeTransportType);

const stamps = { createdAt: isoDateSchema, updatedAt: isoDateSchema };
/** Story 15.4. The connector's provenance marker: a required key, `null` when a person last wrote the row. */
const nullableIsoDateSchema = isoDateSchema.nullable();
const marked = { aiChangedAt: nullableIsoDateSchema };

const travelSegmentRowSchema = z
  .object({
    id: idSchema,
    tripDayId: idSchema,
    fromItemType: endpointTypeSchema,
    fromItemId: idSchema,
    toItemType: endpointTypeSchema,
    toItemId: idSchema,
    transportType: transportTypeSchema,
    durationMinutes: z.number().int().nonnegative(),
    distanceKm: finiteNullable,
    linkUrl: safeLinkSchema,
    ...stamps,
    ...marked,
  })
  .strict();

const costPaymentRowSchema = z
  .object({
    id: idSchema,
    accommodationId: z.null(),
    dayPlanItemId: idSchema,
    amountCents: z.number().int(),
    amountOriginal: z.number().int().nullable(),
    dueDate: z.string(),
    sortOrder: z.number().int(),
    ...stamps,
  })
  .strict();

/** Story 15.6. A stay's payment row: the other target of the one-target CHECK. */
const stayPaymentRowSchema = z
  .object({
    id: idSchema,
    accommodationId: idSchema,
    dayPlanItemId: z.null(),
    amountCents: z.number().int(),
    amountOriginal: z.number().int().nullable(),
    dueDate: z.string(),
    sortOrder: z.number().int(),
    ...stamps,
  })
  .strict();

const dayPlanItemColumns = {
  id: idSchema,
  tripDayId: idSchema,
  title: nullableText(),
  fromTime: nullableText(),
  toTime: nullableText(),
  // Story 13.1. Stored values, so no 5-minute floor (§4: a migrated fixed row may last one minute).
  scheduleMode: z.enum(["FLEXIBLE", "FIXED"]),
  durationMinutes: z.number().int().nonnegative(),
  sortOrder: z.number().int().nonnegative(),
  contentJson: z.string(),
  costCents: z.number().int().nullable(),
  costOriginalAmount: z.number().int().nullable(),
  costCurrency: nullableText(),
  costRate: finiteNullable,
  costRateDate: nullableText(),
  linkUrl: safeLinkSchema,
  locationLat: finiteNullable,
  locationLng: finiteNullable,
  locationLabel: nullableText(),
  ...stamps,
  ...marked,
  payments: z.array(costPaymentRowSchema).max(MAX_PAYMENTS),
};

const dayPlanItemSnapshotSchema = z.object(dayPlanItemColumns).strict();

const imageRowSchema = z
  .object({
    id: idSchema,
    dayPlanItemId: idSchema,
    imageUrl: z
      .string()
      .max(MAX_STORED_IMAGE_URL_LENGTH)
      .refine((value) => isSafeStoredImageUrl(value), "Image URL must be a stored image address"),
    sortOrder: z.number().int(),
    ...stamps,
    ...marked,
  })
  .strict();

const documentRowSchema = z
  .object({
    id: idSchema,
    dayPlanItemId: idSchema,
    // Documents have only ever been stored as server-composed upload paths; there is no external form.
    // Containment in this trip's tree is the repository's check, with the trip id in hand.
    documentUrl: z
      .string()
      .max(MAX_STORED_IMAGE_URL_LENGTH)
      .refine((value) => value.startsWith("/uploads/"), "Document URL must be a stored upload path"),
    fileName: z.string().min(1),
    sortOrder: z.number().int(),
    ...stamps,
    ...marked,
  })
  .strict();

const deletedSnapshotSchema = z
  .object({
    ...dayPlanItemColumns,
    images: z.array(imageRowSchema).max(MAX_MEDIA),
    documents: z.array(documentRowSchema).max(MAX_MEDIA),
  })
  .strict();

/** Story 15.6. Every `Accommodation` column of a stay snapshot, plus its payments; stored values, no caps. */
const stayColumns = {
  id: idSchema,
  tripDayId: idSchema,
  name: z.string(),
  status: z.enum(["PLANNED", "BOOKED"]),
  costCents: z.number().int().nullable(),
  costOriginalAmount: z.number().int().nullable(),
  costCurrency: nullableText(),
  costRate: finiteNullable,
  costRateDate: nullableText(),
  link: safeLinkSchema,
  locationLat: finiteNullable,
  locationLng: finiteNullable,
  locationLabel: nullableText(),
  notes: nullableText(),
  checkInTime: nullableText(),
  checkOutTime: nullableText(),
  ...stamps,
  ...marked,
  payments: z.array(stayPaymentRowSchema).max(MAX_PAYMENTS),
};

const staySnapshotSchema = z.object(stayColumns).strict();

const stayImageRowSchema = z
  .object({
    id: idSchema,
    accommodationId: idSchema,
    imageUrl: z
      .string()
      .max(MAX_STORED_IMAGE_URL_LENGTH)
      .refine((value) => isSafeStoredImageUrl(value), "Image URL must be a stored image address"),
    sortOrder: z.number().int(),
    ...stamps,
    ...marked,
  })
  .strict();

const stayDocumentRowSchema = z
  .object({
    id: idSchema,
    accommodationId: idSchema,
    documentUrl: z
      .string()
      .max(MAX_STORED_IMAGE_URL_LENGTH)
      .refine((value) => value.startsWith("/uploads/"), "Document URL must be a stored upload path"),
    fileName: z.string().min(1),
    sortOrder: z.number().int(),
    ...stamps,
    ...marked,
  })
  .strict();

/**
 * Story 15.7. A file the connector deleted, by its parent and list (nested on `target`, then `media`), so
 * `previous` must be the row type those two name. The URL rules are each row schema's own; containment in
 * this trip's tree is the repository's check.
 */
const fileDeletedSchema = z.discriminatedUnion("target", [
  z.discriminatedUnion("media", [
    z.object({ kind: z.literal("fileDeleted"), target: z.literal("activity"), media: z.literal("image"), previous: imageRowSchema }).strict(),
    z
      .object({ kind: z.literal("fileDeleted"), target: z.literal("activity"), media: z.literal("document"), previous: documentRowSchema })
      .strict(),
  ]),
  z.discriminatedUnion("media", [
    z.object({ kind: z.literal("fileDeleted"), target: z.literal("stay"), media: z.literal("image"), previous: stayImageRowSchema }).strict(),
    z
      .object({ kind: z.literal("fileDeleted"), target: z.literal("stay"), media: z.literal("document"), previous: stayDocumentRowSchema })
      .strict(),
  ]),
]);

const deletedStaySnapshotSchema = z
  .object({
    ...stayColumns,
    images: z.array(stayImageRowSchema).max(MAX_MEDIA),
    documents: z.array(stayDocumentRowSchema).max(MAX_MEDIA),
  })
  .strict();

const editedSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("created"), itemId: idSchema, updatedAt: isoDateSchema }).strict(),
  z
    .object({
      kind: z.literal("updated"),
      itemId: idSchema,
      updatedAt: isoDateSchema,
      previous: dayPlanItemSnapshotSchema,
    })
    .strict(),
  z.object({ kind: z.literal("deleted"), previous: deletedSnapshotSchema }).strict(),
  // Story 11.3. Additive, so `version` stays 2; `dayPlanChangeRepo.ts` checks both ids are in `movedItems`.
  // Story 15.4: `previousAiChangedAt` is the moved activity's marker before the write.
  z
    .object({
      kind: z.literal("reordered"),
      itemId: idSchema,
      neighbourId: idSchema,
      previousAiChangedAt: nullableIsoDateSchema,
    })
    .strict(),
  // Story 11.4. Additive too; `dayPlanChangeRepo.ts` checks the leg row and the stay against the day.
  z.object({ kind: z.literal("legCreated"), segmentId: idSchema, updatedAt: isoDateSchema }).strict(),
  z
    .object({
      kind: z.literal("legUpdated"),
      segmentId: idSchema,
      updatedAt: isoDateSchema,
      previous: travelSegmentRowSchema,
    })
    .strict(),
  // Story 13.1. A leg delete recomputes the day, so it needs its own receipt.
  z.object({ kind: z.literal("legDeleted"), segmentId: idSchema, previous: travelSegmentRowSchema }).strict(),
  z
    .object({
      kind: z.literal("stayCheckOutChanged"),
      accommodationId: idSchema,
      updatedAt: isoDateSchema,
      previousUpdatedAt: isoDateSchema,
      previousCheckOutTime: nullableText(),
    })
    .strict(),
  // Story 14.1. A parked activity moved onto the day; `dayPlanChangeRepo.ts` checks it against the day.
  z
    .object({
      kind: z.literal("scheduled"),
      itemId: idSchema,
      updatedAt: isoDateSchema,
      previousUpdatedAt: isoDateSchema,
      previousAiChangedAt: nullableIsoDateSchema,
    })
    .strict(),
  // Story 14.2. An activity parked off the day; `dayPlanChangeRepo.ts` checks `previous.tripDayId`
  // against the receipt's day. `previous` holds stored values, so the bounds are `dayPlanItemColumns`'.
  z
    .object({
      kind: z.literal("parked"),
      itemId: idSchema,
      updatedAt: isoDateSchema,
      previous: z
        .object({
          tripDayId: idSchema,
          scheduleMode: dayPlanItemColumns.scheduleMode,
          durationMinutes: dayPlanItemColumns.durationMinutes,
          sortOrder: dayPlanItemColumns.sortOrder,
          fromTime: nullableText(),
          toTime: nullableText(),
          updatedAt: isoDateSchema,
          previousAiChangedAt: nullableIsoDateSchema,
        })
        .strict(),
    })
    .strict(),
  // Story 12.4. Additive; the bounds are what one apply can create (8 suggestions, a leg into each, 3
  // pictures each). `dayPlanChangeRepo.ts` checks every row against the day.
  // Story 14.3: `parkedItems` are the ones parked to the bucket list; optional, so a 13.4 receipt stays
  // valid. Together with `items` at least one and at most `MAX_APPLIED_SUGGESTIONS`.
  z
    .object({
      kind: z.literal("suggestionsApplied"),
      items: z
        .array(z.object({ itemId: idSchema, updatedAt: isoDateSchema }).strict())
        .max(MAX_APPLIED_SUGGESTIONS),
      segments: z
        .array(z.object({ segmentId: idSchema, updatedAt: isoDateSchema }).strict())
        .max(MAX_APPLIED_SUGGESTIONS),
      imageIds: z.array(idSchema).max(MAX_APPLIED_SUGGESTIONS * MAX_IMAGES_PER_APPLIED_SUGGESTION),
      parkedItems: z
        .array(z.object({ itemId: idSchema, updatedAt: isoDateSchema }).strict())
        .max(MAX_APPLIED_SUGGESTIONS)
        .optional(),
    })
    .strict()
    .refine((edited) => {
      const total = edited.items.length + (edited.parkedItems?.length ?? 0);
      return total >= 1 && total <= MAX_APPLIED_SUGGESTIONS;
    }, `Between 1 and ${MAX_APPLIED_SUGGESTIONS} applied suggestions`),
  // Story 15.5. One connector day plan: at least one activity, at most what one call writes, a leg into each
  // at most; `deletedItems` is bounded like a day's media, as a body bound. `dayPlanChangeRepo.ts` checks
  // every row against the day.
  z
    .object({
      kind: z.literal("dayPlanApplied"),
      mode: z.enum(["append", "replace"]),
      items: z
        .array(z.object({ itemId: idSchema, updatedAt: isoDateSchema }).strict())
        .min(1)
        .max(MAX_DAY_PLAN_APPLY_ACTIVITIES),
      segments: z
        .array(z.object({ segmentId: idSchema, updatedAt: isoDateSchema }).strict())
        .max(MAX_DAY_PLAN_APPLY_ACTIVITIES),
      deletedItems: z.array(deletedSnapshotSchema).max(MAX_MEDIA),
    })
    .strict(),
  // Story 15.6. The connector's stay kinds; `dayPlanChangeRepo.ts` checks the snapshots, their payments and
  // media, and the next day's legs against the receipt's day and trip.
  z.object({ kind: z.literal("stayCreated"), accommodationId: idSchema, updatedAt: isoDateSchema }).strict(),
  z
    .object({
      kind: z.literal("stayUpdated"),
      accommodationId: idSchema,
      updatedAt: isoDateSchema,
      previous: staySnapshotSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("stayDeleted"),
      accommodationId: idSchema,
      previous: deletedStaySnapshotSchema,
      nextDayId: idSchema.nullable(),
      nextDayLegs: z.array(travelSegmentRowSchema).max(MAX_LEGS),
    })
    .strict(),
  // Story 15.7. The connector's file kinds. `url` is a stored upload path (the attach writes nothing else);
  // `dayPlanChangeRepo.ts` checks it lies inside this trip's tree.
  z
    .object({
      kind: z.literal("fileAttached"),
      target: z.enum(["activity", "stay"]),
      media: z.enum(["document", "image"]),
      parentId: idSchema,
      fileId: idSchema,
      url: z
        .string()
        .max(MAX_STORED_IMAGE_URL_LENGTH)
        .refine((value) => value.startsWith("/uploads/"), "File URL must be a stored upload path"),
      updatedAt: isoDateSchema,
    })
    .strict(),
  fileDeletedSchema,
  // Story 15.9. The day's own note and picture. A day picture may be an external address (the dialog's
  // `PATCH` accepts one), so the URLs are bounded text here; `dayPlanChangeRepo.ts` checks that a picture
  // the undo would remove lies in the day's own upload directory.
  z
    .object({
      kind: z.literal("dayDetailsChanged"),
      updatedAt: isoDateSchema,
      previous: z
        .object({
          note: nullableText(),
          imageUrl: z.string().max(2000).nullable(),
          aiChangedAt: nullableIsoDateSchema,
        })
        .strict(),
      imageUrl: z.string().max(2000).nullable(),
    })
    .strict(),
]);

/** Story 11.2. Times are stored text (an import may hold odd ones); the stamps are what undo compares. */
const movedItemSchema = z
  .object({
    itemId: idSchema,
    previousFromTime: nullableText(),
    previousToTime: nullableText(),
    previousSortOrder: z.number().int().nonnegative(),
    fromTime: nullableText(),
    toTime: nullableText(),
    previousUpdatedAt: isoDateSchema,
    updatedAt: isoDateSchema,
  })
  .strict();

/** Story 13.1. For the notice only; undo ignores it, the signature covers it. */
const planConflictSchema = z
  .object({ itemId: idSchema, title: nullableText(), fromTime: z.string(), reachableAt: z.string() })
  .strict();

/**
 * Story 15.4. Everything but the seal. A connector write stores its receipt server-side (`ai_changes`),
 * unsigned and trusted, and `storedDayChangeReceiptSchema` parses it back; a client-held receipt is the
 * same shape plus `signature` (`dayChangeReceiptSchema`). Both `.strict()`.
 */
const receiptShape = {
  version: z.literal(3),
  tripDayId: idSchema,
  edited: editedSchema,
  removedTravelSegments: z.array(travelSegmentRowSchema).max(MAX_LEGS),
  movedItems: z.array(movedItemSchema).max(MAX_LEGS),
  planConflicts: z.array(planConflictSchema).max(MAX_LEGS).optional(),
};

export const storedDayChangeReceiptSchema = z.object(receiptShape).strict();

export const dayChangeReceiptSchema = z
  .object({
    // Story 11.2 bumped this to 2, Story 13.1 to 3. An older receipt held across a deploy is refused
    // (400), which the client already treats as "undo unavailable" - better than misreading it as a change
    // that moved nothing. Receipts are client-held and short-lived, so no older version is tolerated.
    // Story 14.1 dropped `consumedBucketListItem` without a bump: `.strict()` refuses a receipt that
    // still carries it (400), which is the same "undo unavailable" outcome. Story 13.2 dropped
    // the check-in warning the same way. Story 15.4 added the marker keys the same way.
    version: receiptShape.version,
    // The server's seal (hex HMAC-SHA256). The route verifies it; the schema only bounds its shape.
    signature: z.string().regex(/^[0-9a-f]{64}$/, "Receipt signature is malformed"),
    tripDayId: receiptShape.tripDayId,
    edited: receiptShape.edited,
    removedTravelSegments: receiptShape.removedTravelSegments,
    movedItems: receiptShape.movedItems,
    planConflicts: receiptShape.planConflicts,
  })
  .strict();

export const dayChangeUndoSchema = z.object({ receipt: dayChangeReceiptSchema }).strict();

export type DayChangeUndoInput = z.infer<typeof dayChangeUndoSchema>;
