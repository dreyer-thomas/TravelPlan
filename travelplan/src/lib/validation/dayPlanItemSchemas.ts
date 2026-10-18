import { z } from "zod";
import { costCurrencyFields, paymentOriginalField, refineCostCurrency } from "@/lib/validation/costCurrencySchemas";
import { isValidDateOnly } from "@/lib/validation/dateOnly";
import { locationInputSchema } from "@/lib/validation/locationSchemas";
import { isSafeExternalUrl } from "@/lib/validation/safeExternalUrl";

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

export const contentJsonSchema = z
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

export const linkSchema = z
  .string()
  .trim()
  .url("Link must be a valid URL")
  .refine((value) => isSafeExternalUrl(value), "Link must use http or https")
  .max(2000, "Link must be at most 2000 characters");
const dateOnlySchema = z
  .string()
  .trim()
  .refine((value) => isValidDateOnly(value), "Date must be a valid YYYY-MM-DD value");
const paymentSchema = z.object({
  amountCents: z.number().int().nonnegative("Cost must be zero or greater"),
  dueDate: dateOnlySchema,
  ...paymentOriginalField,
});
export const paymentsSchema = z.array(paymentSchema);

/**
 * "Payments sum to the cost", shared by the day activity and the parked one (Story 14.1), so the two
 * payloads cannot drift apart on it.
 */
export const refinePaymentTotal = (
  value: { costCents?: number | null; payments?: { amountCents: number }[] | null },
  context: z.RefinementCtx,
) => {
  const costCents = value.costCents ?? null;
  const payments = value.payments ?? null;
  if (costCents === null) {
    if (payments && payments.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["payments"],
        message: "Payments require a total cost",
      });
    }
    return;
  }

  if (!payments || payments.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["payments"],
      message: "Payments are required when cost is set",
    });
    return;
  }

  const total = payments.reduce((sum, payment) => sum + payment.amountCents, 0);
  if (total !== costCents) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["payments"],
      message: "Payment total must match cost",
    });
  }
};

const normalizeTime = (raw: string): string | null => {
  const value = raw.trim();
  const match = value.match(/^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d{1,3})?)?$/);
  if (!match) return null;

  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
};

const timeFieldSchema = z
  .string()
  .transform((value, context): string | typeof z.NEVER => {
    const normalized = normalizeTime(value);
    if (normalized === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Time must be in HH:mm format",
      });
      return z.NEVER;
    }
    return normalized;
  });

const toMinutes = (value: string) => {
  const [hours, minutes] = value.split(":").map((part) => Number.parseInt(part, 10));
  return hours * 60 + minutes;
};

/** Story 13.1. The shortest duration the dialog and the API accept; a stored row may be shorter (§4). */
export const MIN_ACTIVITY_DURATION_MINUTES = 5;
/** `HH:MM` ends at 23:59, so no activity can last longer than this within one day. */
export const MAX_ACTIVITY_DURATION_MINUTES = 23 * 60 + 59;
const LAST_MINUTE_OF_DAY = 23 * 60 + 59;

/** Story 13.1's duration bounds, shared with the parked activity (Story 14.1). `false` when it reported. */
export const refineDurationInRange = (minutes: number, context: z.RefinementCtx) => {
  if (minutes < MIN_ACTIVITY_DURATION_MINUTES) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["durationMinutes"],
      message: `Duration must be at least ${MIN_ACTIVITY_DURATION_MINUTES} minutes`,
    });
    return false;
  }
  if (minutes > MAX_ACTIVITY_DURATION_MINUTES) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["durationMinutes"],
      message: "Duration must end within the day",
    });
    return false;
  }
  return true;
};

export const dayPlanItemMutationSchema = z.object({
  tripDayId: z.string().trim().min(1, "Trip day is required"),
  title: z.string().trim().min(1, "Title is required").max(120, "Title must be at most 120 characters"),
  /**
   * Story 13.1 (FR46). Absent means FIXED with both times, the shape every client before 13.1 sends
   * (§14). FLEXIBLE takes only `durationMinutes` (15 when absent) and ignores any times sent. FIXED takes
   * `fromTime` plus `toTime` or `durationMinutes`; `toTime` wins when both are sent, and the repository
   * stores `toTime − fromTime` as the duration.
   */
  scheduleMode: z.enum(["FLEXIBLE", "FIXED"]).optional(),
  durationMinutes: z.number().int("Duration must be whole minutes").optional().nullable(),
  fromTime: timeFieldSchema.optional().nullable(),
  toTime: timeFieldSchema.optional().nullable(),
  contentJson: contentJsonSchema,
  costCents: z.number().int().nonnegative("Cost must be zero or greater").optional().nullable(),
  ...costCurrencyFields,
  payments: paymentsSchema.optional().nullable(),
  linkUrl: linkSchema.optional().nullable(),
  location: locationInputSchema.optional(),
  /**
   * Story 13.3 (*Einfügen nach*). On a create only, and only for FLEXIBLE: the new activity goes directly
   * after this one; absent or `null` appends. A FIXED one is placed by its time, so the field is refused.
   */
  afterItemId: z.string().min(1).nullable().optional(),
}).superRefine((value, context) => {
  /*
    The time and cents rules, nested so that their early returns stay local (Story 13.1 split them in
    two, the schedule and the payments, so a schedule error no longer hides a payment one). At the top
    level a `return` here would skip the currency rule below for every payload with a malformed time
    or no cost - and "metadata present, costCents null" is precisely the shape that must be refused.
  */
  const checkSchedule = () => {
    const duration = value.durationMinutes ?? null;
    const durationInRange = (minutes: number) => refineDurationInRange(minutes, context);

    if (value.scheduleMode === "FLEXIBLE") {
      if (duration !== null) durationInRange(duration);
      return;
    }

    // A time that failed its own format check is reported there; it is neither present nor missing here.
    const fromTime = typeof value.fromTime === "string" ? value.fromTime : null;
    const toTime = typeof value.toTime === "string" ? value.toTime : null;
    if (fromTime === null) {
      if (value.fromTime === undefined || value.fromTime === null) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["fromTime"], message: "From time is required" });
      }
      return;
    }
    if (value.toTime !== undefined && value.toTime !== null && toTime === null) return;
    if (toTime !== null) {
      if (toMinutes(toTime) <= toMinutes(fromTime)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["toTime"],
          message: "To time must be later than from time",
        });
      }
      return;
    }
    // Without a mode, the pre-13.1 shape: both times are required.
    if (value.scheduleMode === undefined || duration === null) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["toTime"], message: "To time is required" });
      return;
    }
    if (durationInRange(duration) && toMinutes(fromTime) + duration > LAST_MINUTE_OF_DAY) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["durationMinutes"],
        message: "The activity would end after midnight",
      });
    }
  };

  checkSchedule();
  if (value.afterItemId != null && value.scheduleMode !== "FLEXIBLE") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["afterItemId"],
      message: "Only a flexible activity can be inserted after another",
    });
  }
  refinePaymentTotal(value, context);

  // Story 10.1, additively and deliberately last - see the identical note in accommodationSchemas.ts.
  refineCostCurrency(value, context);
});

export type DayPlanItemMutationInput = z.infer<typeof dayPlanItemMutationSchema>;

export const dayPlanItemUpdateSchema = dayPlanItemMutationSchema.safeExtend({
  itemId: z.string().trim().min(1, "Day plan item is required"),
  // Story 13.3: an edit keeps its place (13.1 §13); *Nach oben* / *Nach unten* move it.
  afterItemId: z.undefined({ error: "An edit keeps its place" }).optional(),
});

export type DayPlanItemUpdateInput = z.infer<typeof dayPlanItemUpdateSchema>;

export const dayPlanItemDeleteSchema = z.object({
  tripDayId: z.string().trim().min(1, "Trip day is required"),
  itemId: z.string().trim().min(1, "Day plan item is required"),
});

export type DayPlanItemDeleteInput = z.infer<typeof dayPlanItemDeleteSchema>;

/** Story 11.3. *Nach oben* / *Nach unten*; the server finds the neighbour itself. */
export const dayPlanItemReorderSchema = z.object({
  tripDayId: z.string().trim().min(1, "Trip day is required"),
  itemId: z.string().trim().min(1, "Day plan item is required"),
  direction: z.enum(["up", "down"]),
});

export type DayPlanItemReorderInput = z.infer<typeof dayPlanItemReorderSchema>;

/** Story 14.1. "+" on a bucket-list row: which parked activity, onto which day. */
export const dayPlanItemScheduleSchema = z
  .object({
    itemId: z.string().trim().min(1, "Day plan item is required"),
    tripDayId: z.string().trim().min(1, "Trip day is required"),
  })
  .strict();

export type DayPlanItemScheduleInput = z.infer<typeof dayPlanItemScheduleSchema>;

/** Story 14.2. *Parken*: which activity, off which day (the park is conditional on it still being there). */
export const dayPlanItemParkSchema = z
  .object({
    itemId: z.string().trim().min(1, "Day plan item is required"),
    tripDayId: z.string().trim().min(1, "Trip day is required"),
  })
  .strict();

export type DayPlanItemParkInput = z.infer<typeof dayPlanItemParkSchema>;

/** Story 13.3. *Alle flexibel machen*: every FIXED activity of this day becomes FLEXIBLE. */
export const dayMakeFlexibleSchema = z
  .object({
    tripDayId: z.string().trim().min(1, "Trip day is required"),
  })
  .strict();

export type DayMakeFlexibleInput = z.infer<typeof dayMakeFlexibleSchema>;

/**
 * Story 6.23. Deliberately its own schema rather than a third `operation` on
 * `dayActivityTransferSchema` below: that schema's two operations are whole-day and its "move"
 * *replaces* the target day, so an append-one-activity operation sharing the name would be the
 * `common.save` naming trap again. It also needs a different payload — an `itemId`.
 */
export const dayPlanItemMoveSchema = z
  .object({
    tripDayId: z.string().trim().min(1, "Trip day is required"),
    itemId: z.string().trim().min(1, "Day plan item is required"),
    targetTripDayId: z.string().trim().min(1, "Target day is required"),
  })
  .superRefine((value, context) => {
    if (value.tripDayId === value.targetTripDayId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetTripDayId"],
        message: "Source and target days must be different",
      });
    }
  });

export type DayPlanItemMoveInput = z.infer<typeof dayPlanItemMoveSchema>;

export const dayActivityTransferSchema = z
  .object({
    operation: z.enum(["move", "swap"]),
    sourceTripDayId: z.string().trim().min(1, "Source day is required"),
    targetTripDayId: z.string().trim().min(1, "Target day is required"),
    confirmOverwrite: z.boolean().optional(),
  })
  .superRefine((value, context) => {
    if (value.sourceTripDayId === value.targetTripDayId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetTripDayId"],
        message: "Source and target days must be different",
      });
    }
  });

export type DayActivityTransferInput = z.infer<typeof dayActivityTransferSchema>;
