import { z } from "zod";
import { locationInputSchema } from "@/lib/validation/locationSchemas";

const isSafeExternalUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

const hasRenderableContent = (node: unknown): boolean => {
  if (!node || typeof node !== "object") return false;
  const nodeWithText = node as { text?: unknown };
  if (typeof nodeWithText.text === "string") {
    return nodeWithText.text.trim().length > 0;
  }
  const nodeWithTypeAndAttrs = node as { type?: unknown; attrs?: { src?: unknown } };
  if (
    nodeWithTypeAndAttrs.type === "image" &&
    typeof nodeWithTypeAndAttrs.attrs?.src === "string" &&
    isSafeExternalUrl(nodeWithTypeAndAttrs.attrs.src.trim())
  ) {
    return true;
  }
  const nodeWithContent = node as { content?: unknown[] };
  if (Array.isArray(nodeWithContent.content)) {
    return nodeWithContent.content.some((child) => hasRenderableContent(child));
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
      return hasRenderableContent(parsed);
    } catch {
      return false;
    }
  }, "Content must be valid and non-empty JSON");

const linkSchema = z
  .string()
  .trim()
  .url("Link must be a valid URL")
  .refine((value) => isSafeExternalUrl(value), "Link must use http or https")
  .max(2000, "Link must be at most 2000 characters");

const timeFieldSchema = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d(\.\d{1,3})?)?$/, "Time must be in HH:mm format")
  .transform((value) => value.slice(0, 5));

const toMinutes = (value: string) => {
  const [hours, minutes] = value.split(":").map((part) => Number.parseInt(part, 10));
  return hours * 60 + minutes;
};

export const dayPlanItemMutationSchema = z.object({
  tripDayId: z.string().trim().min(1, "Trip day is required"),
  title: z.string().trim().min(1, "Title is required").max(120, "Title must be at most 120 characters"),
  fromTime: timeFieldSchema,
  toTime: timeFieldSchema,
  contentJson: contentJsonSchema,
  costCents: z.number().int().nonnegative("Cost must be zero or greater").optional().nullable(),
  linkUrl: linkSchema.optional().nullable(),
  location: locationInputSchema.optional(),
}).superRefine((value, context) => {
  if (toMinutes(value.toTime) <= toMinutes(value.fromTime)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["toTime"],
      message: "To time must be later than from time",
    });
  }
});

export type DayPlanItemMutationInput = z.infer<typeof dayPlanItemMutationSchema>;

export const dayPlanItemUpdateSchema = dayPlanItemMutationSchema.safeExtend({
  itemId: z.string().trim().min(1, "Day plan item is required"),
});

export type DayPlanItemUpdateInput = z.infer<typeof dayPlanItemUpdateSchema>;

export const dayPlanItemDeleteSchema = z.object({
  tripDayId: z.string().trim().min(1, "Trip day is required"),
  itemId: z.string().trim().min(1, "Day plan item is required"),
});

export type DayPlanItemDeleteInput = z.infer<typeof dayPlanItemDeleteSchema>;
