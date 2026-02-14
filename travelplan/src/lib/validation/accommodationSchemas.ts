import { z } from "zod";

const notesSchema = z.string().trim().max(1000, "Notes must be at most 1000 characters");
const statusSchema = z.enum(["planned", "booked"], "Status must be planned or booked");
const costSchema = z
  .number({ invalid_type_error: "Cost must be a number" })
  .int("Cost must be an integer")
  .min(0, "Cost must be at least 0")
  .max(100000000, "Cost must be at most 100000000");
const linkSchema = z.string().trim().url("Link must be a valid URL").max(2000, "Link must be at most 2000 characters");

export const accommodationMutationSchema = z.object({
  tripDayId: z.string().trim().min(1, "Trip day is required"),
  name: z.string().trim().min(1, "Accommodation name is required"),
  status: statusSchema,
  costCents: costSchema.optional().nullable(),
  link: linkSchema.optional().nullable(),
  notes: notesSchema.optional().nullable(),
});

export type AccommodationMutationInput = z.infer<typeof accommodationMutationSchema>;

export const accommodationDeleteSchema = z.object({
  tripDayId: z.string().trim().min(1, "Trip day is required"),
});

export type AccommodationDeleteInput = z.infer<typeof accommodationDeleteSchema>;
