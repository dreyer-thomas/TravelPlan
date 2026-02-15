import { z } from "zod";

const latSchema = z
  .number({ message: "Latitude must be a number" })
  .min(-90, "Latitude must be between -90 and 90")
  .max(90, "Latitude must be between -90 and 90");

const lngSchema = z
  .number({ message: "Longitude must be a number" })
  .min(-180, "Longitude must be between -180 and 180")
  .max(180, "Longitude must be between -180 and 180");

const labelSchema = z.string().trim().max(200, "Location label must be at most 200 characters");

const locationObjectSchema = z.object({
  lat: latSchema,
  lng: lngSchema,
  label: labelSchema.optional().nullable(),
});

export const locationInputSchema = z.union([locationObjectSchema, z.null()]);

export type LocationInput = z.infer<typeof locationInputSchema>;
