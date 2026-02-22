import { z } from "zod";
import { locationInputSchema } from "@/lib/validation/locationSchemas";

const ISO_UTC_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

const isoUtcDate = z
  .string()
  .trim()
  .refine((value) => ISO_UTC_REGEX.test(value), "Date must be ISO 8601 UTC")
  .refine((value) => !Number.isNaN(Date.parse(value)), "Date must be valid ISO 8601 UTC");

const tripLocationSchema = locationInputSchema.superRefine((value, ctx) => {
  if (!value) return;
  const label = value.label;
  if (typeof label !== "string" || label.trim().length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Location label is required",
    });
  }
});

export const createTripSchema = z
  .object({
    name: z.string().trim().min(1, "Trip name is required"),
    startDate: isoUtcDate,
    endDate: isoUtcDate,
    startLocation: tripLocationSchema.optional(),
    destinationLocation: tripLocationSchema.optional(),
  })
  .refine((data) => new Date(data.startDate).getTime() <= new Date(data.endDate).getTime(), {
    message: "Start date must be before or equal to end date",
    path: ["endDate"],
  })
  .refine(
    (data) => {
      const startState = data.startLocation === undefined ? "missing" : data.startLocation === null ? "null" : "object";
      const destinationState =
        data.destinationLocation === undefined ? "missing" : data.destinationLocation === null ? "null" : "object";
      return startState === destinationState;
    },
    {
      message: "Start and destination must both be provided",
      path: ["destinationLocation"],
    },
  );

export type CreateTripInput = z.infer<typeof createTripSchema>;

export const updateTripSchema = createTripSchema;

export type UpdateTripInput = z.infer<typeof updateTripSchema>;
