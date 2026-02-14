import { z } from "zod";

const hasNonEmptyText = (node: unknown): boolean => {
  if (!node || typeof node !== "object") return false;
  if ("text" in node && typeof (node as { text?: unknown }).text === "string") {
    return (node as { text?: string }).text.trim().length > 0;
  }
  if ("content" in node && Array.isArray((node as { content?: unknown[] }).content)) {
    return (node as { content?: unknown[] }).content!.some((child) => hasNonEmptyText(child));
  }
  return false;
};

const contentJsonSchema = z
  .string()
  .trim()
  .min(1, "Content is required")
  .refine((value) => {
    try {
      const parsed = JSON.parse(value);
      return hasNonEmptyText(parsed);
    } catch {
      return false;
    }
  }, "Content must be valid and non-empty JSON");

const linkSchema = z.string().trim().url("Link must be a valid URL").max(2000, "Link must be at most 2000 characters");

export const dayPlanItemMutationSchema = z.object({
  tripDayId: z.string().trim().min(1, "Trip day is required"),
  contentJson: contentJsonSchema,
  linkUrl: linkSchema.optional().nullable(),
});

export type DayPlanItemMutationInput = z.infer<typeof dayPlanItemMutationSchema>;

export const dayPlanItemUpdateSchema = dayPlanItemMutationSchema.extend({
  itemId: z.string().trim().min(1, "Day plan item is required"),
});

export type DayPlanItemUpdateInput = z.infer<typeof dayPlanItemUpdateSchema>;

export const dayPlanItemDeleteSchema = z.object({
  tripDayId: z.string().trim().min(1, "Trip day is required"),
  itemId: z.string().trim().min(1, "Day plan item is required"),
});

export type DayPlanItemDeleteInput = z.infer<typeof dayPlanItemDeleteSchema>;
