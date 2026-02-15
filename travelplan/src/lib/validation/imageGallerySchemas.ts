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
  tripDayId: entityIdSchema,
  dayPlanItemId: entityIdSchema,
});

export const dayPlanItemImageDeleteSchema = z.object({
  tripDayId: entityIdSchema,
  dayPlanItemId: entityIdSchema,
  imageId: entityIdSchema,
});

export const dayPlanItemImageReorderSchema = z.object({
  tripDayId: entityIdSchema,
  dayPlanItemId: entityIdSchema,
  order: z.array(reorderEntrySchema).min(1),
});
