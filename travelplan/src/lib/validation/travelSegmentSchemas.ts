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
export const travelTransportTypeSchema = z.enum(["car", "ship", "flight"]);

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

    if (value.transportType !== "car" && value.distanceKm !== null && value.distanceKm !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["distanceKm"],
        message: "Distance is only allowed for car travel",
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
