import { z } from "zod";

const notesSchema = z.string().trim().max(1000, "Notes must be at most 1000 characters");

export const accommodationMutationSchema = z.object({
  tripDayId: z.string().trim().min(1, "Trip day is required"),
  name: z.string().trim().min(1, "Accommodation name is required"),
  notes: notesSchema.optional().nullable(),
});

export type AccommodationMutationInput = z.infer<typeof accommodationMutationSchema>;

export const accommodationDeleteSchema = z.object({
  tripDayId: z.string().trim().min(1, "Trip day is required"),
});

export type AccommodationDeleteInput = z.infer<typeof accommodationDeleteSchema>;
