import { z } from "zod";

import {
  TRANSPORT_TYPES,
  transportTypeAllowsDistance,
  transportTypeRequiresDistance,
} from "@/lib/trips/transportTypes";
import { isSafeExternalUrl } from "@/lib/validation/safeExternalUrl";

const linkSchema = z
  .string()
  .trim()
  .url("Link must be a valid URL")
  .refine((value) => isSafeExternalUrl(value), "Link must use http or https")
  .max(2000, "Link must be at most 2000 characters");

export const travelSegmentItemTypeSchema = z.enum(["accommodation", "dayPlanItem"]);
// The enum and the per-mode distance rule both come from `@/lib/trips/transportTypes`, which is the
// one place either is written down. Deriving the schema from `TRANSPORT_TYPES` means adding a mode
// there widens this schema automatically instead of leaving a second list to forget.
export const travelTransportTypeSchema = z.enum(TRANSPORT_TYPES);

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

    if (transportTypeRequiresDistance(value.transportType) && (value.distanceKm === null || value.distanceKm === undefined)) {
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
