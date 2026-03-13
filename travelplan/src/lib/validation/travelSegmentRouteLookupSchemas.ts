import { z } from "zod";

const coordinateSchema = z.coerce.number().finite().min(-180).max(180);

export const travelSegmentRouteLookupParamsSchema = z.object({
  id: z.string().trim().min(1),
});

export const travelSegmentRouteLookupQuerySchema = z.object({
  originLat: coordinateSchema.min(-90).max(90),
  originLng: coordinateSchema,
  destinationLat: coordinateSchema.min(-90).max(90),
  destinationLng: coordinateSchema,
});
