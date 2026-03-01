import { z } from "zod";
import { locationInputSchema } from "@/lib/validation/locationSchemas";

const titleSchema = z.string().trim().min(1, "Title is required").max(120, "Title must be at most 120 characters");
const descriptionSchema = z.string().trim().max(1000, "Description must be at most 1000 characters");
const positionTextSchema = z.string().trim().max(200, "Position text must be at most 200 characters");

export const bucketListMutationSchema = z.object({
  title: titleSchema,
  description: descriptionSchema.optional().nullable(),
  positionText: positionTextSchema.optional().nullable(),
  location: locationInputSchema.optional(),
});

export type BucketListMutationInput = z.infer<typeof bucketListMutationSchema>;

export const bucketListUpdateSchema = bucketListMutationSchema.safeExtend({
  itemId: z.string().trim().min(1, "Bucket list item is required"),
});

export type BucketListUpdateInput = z.infer<typeof bucketListUpdateSchema>;

export const bucketListDeleteSchema = z.object({
  itemId: z.string().trim().min(1, "Bucket list item is required"),
});

export type BucketListDeleteInput = z.infer<typeof bucketListDeleteSchema>;
