import { z } from "zod";

const coordinateSchema = z.coerce.number().finite().min(-180).max(180);

export const travelSegmentRouteLookupParamsSchema = z.object({
  id: z.string().trim().min(1),
});

/**
 * Only the modes a router can actually answer for. Ship and flight are absent on purpose: there is
 * no equivalent profile, so they never reach this endpoint and keep using the manual path instead.
 *
 * Optional and defaulted to `car` so links and callers written before Story 6.16 keep working.
 */
export const travelSegmentRouteLookupModeSchema = z.enum(["car", "walking", "cycling"]);

export type TravelSegmentRouteLookupMode = z.infer<typeof travelSegmentRouteLookupModeSchema>;

export const travelSegmentRouteLookupQuerySchema = z.object({
  originLat: coordinateSchema.min(-90).max(90),
  originLng: coordinateSchema,
  destinationLat: coordinateSchema.min(-90).max(90),
  destinationLng: coordinateSchema,
  mode: travelSegmentRouteLookupModeSchema.optional().default("car"),
});
