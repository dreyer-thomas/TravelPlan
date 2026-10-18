import { z } from "zod";

const entityIdSchema = z.string().trim().min(1);

const reorderEntrySchema = z.object({
  imageId: entityIdSchema,
  sortOrder: z.number().int().min(1),
});

export const accommodationImageUploadSchema = z.object({
  tripDayId: entityIdSchema,
  accommodationId: entityIdSchema,
});

export const accommodationImageDeleteSchema = z.object({
  tripDayId: entityIdSchema,
  accommodationId: entityIdSchema,
  imageId: entityIdSchema,
});

export const accommodationImageReorderSchema = z.object({
  tripDayId: entityIdSchema,
  accommodationId: entityIdSchema,
  order: z.array(reorderEntrySchema).min(1),
});

export const dayPlanItemImageUploadSchema = z.object({
  // Story 14.1: absent for a parked activity (the bucket list), which has no day.
  tripDayId: entityIdSchema.optional(),
  dayPlanItemId: entityIdSchema,
});

export const dayPlanItemImageDeleteSchema = z.object({
  // Story 14.1: absent for a parked activity (the bucket list), which has no day.
  tripDayId: entityIdSchema.optional(),
  dayPlanItemId: entityIdSchema,
  imageId: entityIdSchema,
});

export const dayPlanItemImageReorderSchema = z.object({
  // Story 14.1: absent for a parked activity (the bucket list), which has no day.
  tripDayId: entityIdSchema.optional(),
  dayPlanItemId: entityIdSchema,
  order: z.array(reorderEntrySchema).min(1),
});
