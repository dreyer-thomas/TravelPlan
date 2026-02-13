import { z } from "zod";

const ISO_UTC_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

const isoUtcDate = z
  .string()
  .trim()
  .refine((value) => ISO_UTC_REGEX.test(value), "Date must be ISO 8601 UTC")
  .refine((value) => !Number.isNaN(Date.parse(value)), "Date must be valid ISO 8601 UTC");

export const createTripSchema = z
  .object({
    name: z.string().trim().min(1, "Trip name is required"),
    startDate: isoUtcDate,
    endDate: isoUtcDate,
  })
  .refine((data) => new Date(data.startDate).getTime() <= new Date(data.endDate).getTime(), {
    message: "Start date must be before or equal to end date",
    path: ["endDate"],
  });

export type CreateTripInput = z.infer<typeof createTripSchema>;

export const updateTripSchema = createTripSchema;

export type UpdateTripInput = z.infer<typeof updateTripSchema>;
