import { z } from "zod";
import { SUGGESTION_MODE_ROUTING, type SuggestionTimes, type SuggestionLeg } from "@/lib/trips/suggestionPlan";
import { transportTypeRequiresDistance } from "@/lib/trips/transportTypes";
import {
  isWikimediaThumbnailUrl,
  isWikimediaUploadUrl,
  MAX_SUGGESTIONS,
  SUGGESTION_MODES,
  suggestionSchema,
} from "@/lib/validation/daySuggestionSchemas";

/**
 * Story 12.4. The preview and apply requests, and the preview's answer. Client-safe (Zod and types), so
 * the dialog shares them with the routes.
 *
 * The suggestions come back from the client, so they are held to no more than a user could type: the
 * bounds of 12.1's `suggestionSchema`, `verified` as a plain boolean (not stored), at most three pictures,
 * and each picture's URLs through their Wikimedia guards. A picture that fails a guard is dropped, not the
 * request: the download is the only thing it was for.
 */

const imageSchema = z.object({ thumbnailUrl: z.string().max(2000), originalUrl: z.string().max(2000) });

const imagesSchema = z
  .array(z.unknown())
  .max(3)
  .transform((rows) =>
    rows.flatMap((row) => {
      const parsed = imageSchema.safeParse(row);
      if (!parsed.success) return [];
      const { thumbnailUrl, originalUrl } = parsed.data;
      return isWikimediaThumbnailUrl(thumbnailUrl) && isWikimediaUploadUrl(originalUrl) ? [{ thumbnailUrl, originalUrl }] : [];
    }),
  );

export const applySuggestionSchema = suggestionSchema.extend({
  verified: z.boolean(),
  images: imagesSchema,
});

export type ApplySuggestion = z.infer<typeof applySuggestionSchema>;

const suggestionsSchema = z.array(applySuggestionSchema).min(1).max(MAX_SUGGESTIONS);

export const suggestionPreviewRequestSchema = z.object({
  mode: z.enum(SUGGESTION_MODES),
  suggestions: suggestionsSchema,
});

/** Item 9. What the plan was computed on; apply refuses with `409 day_plan_changed` when it moved. */
export const suggestionPlanBasisSchema = z
  .object({
    afterItemId: z.string().min(1).max(128).nullable(),
    /** Opaque to the client: what the preview read and the times it planned (`planBasis`). */
    fingerprint: z.string().min(1).max(512),
  })
  .strict();

export type SuggestionPlanBasis = z.infer<typeof suggestionPlanBasisSchema>;

/** A leg as the preview computed it. Bounded like a typed one; the client could have typed any of these. */
const legSchema = z
  .object({
    durationMinutes: z.number().int().min(1).max(1440),
    distanceKm: z.number().positive().max(5000).nullable(),
  })
  .strict()
  .nullable();

/**
 * `suggestions` in visiting order (the preview's `order` applied) and one leg per suggestion, the leg
 * *into* it. Apply plans the day with these legs through the preview's own planner (Story 13.4) and never
 * calls OSRM again (item 8).
 *
 * Story 14.3: `parked` are the ticked ones set to *Parken*, in the dialog's list order. They are not in the
 * order, the legs or the basis; they become bucket-list entries. Together with `suggestions` there is at
 * least one and at most `MAX_SUGGESTIONS`. `basis` is there exactly when something is scheduled: an
 * all-parked apply never reads the day's plan. `parked` defaults to `[]`, so a 13.4 body still parses.
 */
export const suggestionApplyRequestSchema = z
  .object({
    mode: z.enum(SUGGESTION_MODES),
    suggestions: z.array(applySuggestionSchema).max(MAX_SUGGESTIONS),
    legs: z.array(legSchema).max(MAX_SUGGESTIONS),
    basis: suggestionPlanBasisSchema.nullable(),
    parked: z.array(applySuggestionSchema).max(MAX_SUGGESTIONS).default([]),
  })
  .superRefine((value, context) => {
    const total = value.suggestions.length + value.parked.length;
    if (total < 1 || total > MAX_SUGGESTIONS) {
      context.addIssue({ code: "custom", path: ["suggestions"], message: `Between 1 and ${MAX_SUGGESTIONS} suggestions` });
    }
    if (value.suggestions.length > 0 && value.basis === null) {
      context.addIssue({ code: "custom", path: ["basis"], message: "A basis is required when something is scheduled" });
    }
    if (value.suggestions.length === 0 && value.basis !== null) {
      context.addIssue({ code: "custom", path: ["basis"], message: "No basis when nothing is scheduled" });
    }
    if (value.legs.length !== value.suggestions.length) {
      context.addIssue({ code: "custom", path: ["legs"], message: "One leg per suggestion" });
    }
    // The leg route's rule: a car leg carries a distance.
    if (transportTypeRequiresDistance(SUGGESTION_MODE_ROUTING[value.mode].transport)) {
      value.legs.forEach((leg, index) => {
        if (leg && leg.distanceKm === null) {
          context.addIssue({ code: "custom", path: ["legs", index, "distanceKm"], message: "Distance is required for car travel" });
        }
      });
    }
  });

export type SuggestionApplyRequest = z.infer<typeof suggestionApplyRequestSchema>;

export type SuggestionPreviewOrigin = {
  /** `none`: no point to start from at all (no stay, no trip start), so the dialog's order is kept. */
  kind: "stay" | "activity" | "tripStart" | "none";
  label: string | null;
};

/** `200 { data: SuggestionPreview }`. `rows` and `legs` are in visiting order; `order` maps them back. */
export type SuggestionPreview = {
  order: number[];
  rows: (SuggestionTimes | null)[];
  legs: (SuggestionLeg | null)[];
  basis: SuggestionPlanBasis;
  overflow: boolean;
  routingUnavailable: boolean;
  origin: SuggestionPreviewOrigin;
};
