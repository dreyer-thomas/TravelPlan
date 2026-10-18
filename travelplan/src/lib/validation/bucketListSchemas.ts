import { z } from "zod";
import { costCurrencyFields, refineCostCurrency } from "@/lib/validation/costCurrencySchemas";
import {
  contentJsonSchema,
  linkSchema,
  paymentsSchema,
  refineDurationInRange,
  refinePaymentTotal,
} from "@/lib/validation/dayPlanItemSchemas";
import { locationInputSchema } from "@/lib/validation/locationSchemas";

/**
 * Story 14.1 (FR30). A bucket-list idea is an activity without a day, so its payload is the activity's,
 * built from the same field schemas and refinements (`dayPlanItemSchemas.ts`), minus everything that
 * belongs to a day: there is no `tripDayId`, no `scheduleMode`, no `fromTime` or `toTime`. A parked
 * activity is always FLEXIBLE and untimed (the table's CHECK). `.strict()`, so a stray time is a 400
 * rather than silently dropped.
 *
 * `durationMinutes` absent means 15, as on a day (the dialog sends 15 for two empty boxes).
 */
const parkedFields = {
  title: z.string().trim().min(1, "Title is required").max(120, "Title must be at most 120 characters"),
  durationMinutes: z.number().int("Duration must be whole minutes").optional().nullable(),
  contentJson: contentJsonSchema,
  costCents: z.number().int().nonnegative("Cost must be zero or greater").optional().nullable(),
  ...costCurrencyFields,
  payments: paymentsSchema.optional().nullable(),
  linkUrl: linkSchema.optional().nullable(),
  location: locationInputSchema.optional(),
};

const refineParked = (
  value: z.infer<z.ZodObject<typeof parkedFields>>,
  context: z.RefinementCtx,
) => {
  if (value.durationMinutes != null) refineDurationInRange(value.durationMinutes, context);
  refinePaymentTotal(value, context);
  refineCostCurrency(value, context);
};

export const bucketListMutationSchema = z.object(parkedFields).strict().superRefine(refineParked);

export type BucketListMutationInput = z.infer<typeof bucketListMutationSchema>;

export const bucketListUpdateSchema = z
  .object({ ...parkedFields, itemId: z.string().trim().min(1, "Bucket list item is required") })
  .strict()
  .superRefine(refineParked);

export type BucketListUpdateInput = z.infer<typeof bucketListUpdateSchema>;

export const bucketListDeleteSchema = z
  .object({
    itemId: z.string().trim().min(1, "Bucket list item is required"),
  })
  .strict();

export type BucketListDeleteInput = z.infer<typeof bucketListDeleteSchema>;
