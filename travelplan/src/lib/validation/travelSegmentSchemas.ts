import { z } from "zod";

const isSafeExternalUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

const linkSchema = z
  .string()
  .trim()
  .url("Link must be a valid URL")
  .refine((value) => isSafeExternalUrl(value), "Link must use http or https")
  .max(2000, "Link must be at most 2000 characters");

export const travelSegmentItemTypeSchema = z.enum(["accommodation", "dayPlanItem"]);
export const travelTransportTypeSchema = z.enum(["car", "ship", "flight", "walking", "cycling"]);

/**
 * Story 6.16 / AC6 - the distance rule, stated rather than inherited.
 *
 * Distance is *allowed* for every ground mode (car, walking, cycling) and *required* for car alone.
 *
 * Requiring it for the new modes would turn a two-minute walk between two adjacent stops into a form
 * error over a number nobody has. Forbidding it - the rule ship and flight live under - would throw
 * away the 40 km of a cycled leg, and would also make the route import for those modes pointless,
 * since it prefills exactly duration *and* distance. Allowed-but-optional is the only rule that
 * keeps both cases usable. Car keeps its stricter rule untouched, so no stored row and no existing
 * caller changes behaviour.
 */
export const TRANSPORT_TYPES_ALLOWING_DISTANCE = ["car", "walking", "cycling"] as const;

export const transportTypeAllowsDistance = (value: string): boolean =>
  (TRANSPORT_TYPES_ALLOWING_DISTANCE as readonly string[]).includes(value);

export const travelSegmentMutationSchema = z
  .object({
    tripDayId: z.string().trim().min(1, "Trip day is required"),
    fromItemType: travelSegmentItemTypeSchema,
    fromItemId: z.string().trim().min(1, "From item is required"),
    toItemType: travelSegmentItemTypeSchema,
    toItemId: z.string().trim().min(1, "To item is required"),
    transportType: travelTransportTypeSchema,
    durationMinutes: z.number().int().positive("Duration is required"),
    distanceKm: z.number().positive("Distance must be greater than 0").optional().nullable(),
    linkUrl: linkSchema.optional().nullable(),
  })
  .superRefine((value, context) => {
    if (value.fromItemType === value.toItemType && value.fromItemId === value.toItemId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["toItemId"],
        message: "Travel segment must connect two different items",
      });
    }

    if (value.transportType === "car" && (value.distanceKm === null || value.distanceKm === undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["distanceKm"],
        message: "Distance is required for car travel",
      });
    }

    if (
      !transportTypeAllowsDistance(value.transportType) &&
      value.distanceKm !== null &&
      value.distanceKm !== undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["distanceKm"],
        message: "Distance is only allowed for car, walking and cycling travel",
      });
    }
  });

export type TravelSegmentMutationInput = z.infer<typeof travelSegmentMutationSchema>;

export const travelSegmentUpdateSchema = travelSegmentMutationSchema.safeExtend({
  segmentId: z.string().trim().min(1, "Travel segment is required"),
});

export type TravelSegmentUpdateInput = z.infer<typeof travelSegmentUpdateSchema>;

export const travelSegmentDeleteSchema = z.object({
  tripDayId: z.string().trim().min(1, "Trip day is required"),
  segmentId: z.string().trim().min(1, "Travel segment is required"),
});

export type TravelSegmentDeleteInput = z.infer<typeof travelSegmentDeleteSchema>;
