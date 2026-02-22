import { z } from "zod";

const ISO_UTC_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;
const HHMM_TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MINUTES_PER_HOUR = 60;

const normalizeTime = (raw: string): string | null => {
  const value = raw.trim();
  const match = value.match(/^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d{1,3})?)?$/);
  if (!match) return null;

  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
};

const importTimeFieldSchema = z.string().transform((value, context): string | typeof z.NEVER => {
  const normalized = normalizeTime(value);
  if (!normalized) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Time must be in HH:mm format",
    });
    return z.NEVER;
  }
  return normalized;
});

const optionalImportTimeSchema = z.union([importTimeFieldSchema, z.null()]).optional().default(null);

const parseTimeToMinutes = (value: string) => {
  const [hours, minutes] = value.split(":").map((part) => Number.parseInt(part, 10));
  return hours * MINUTES_PER_HOUR + minutes;
};

const isoUtcDate = z
  .string()
  .trim()
  .refine((value) => ISO_UTC_REGEX.test(value), "Date must be ISO 8601 UTC")
  .refine((value) => !Number.isNaN(Date.parse(value)), "Date must be valid ISO 8601 UTC");

const urlOrNull = z
  .union([z.string().trim().url("URL must be valid"), z.null()])
  .transform((value) => (typeof value === "string" ? value.trim() : value));

const dayImageUrlOrNull = z
  .union([z.string().trim(), z.null()])
  .refine(
    (value) => {
      if (value === null) return true;
      if (value.startsWith("/uploads/")) return true;
      return z.string().url("URL must be valid").safeParse(value).success;
    },
    { message: "URL must be valid" },
  )
  .transform((value) => (typeof value === "string" ? value.trim() : value));

const optionalLabelSchema = z.union([z.string().trim(), z.null()]);

const locationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  label: optionalLabelSchema,
});

const accommodationImportSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1, "Accommodation name is required"),
  notes: z.union([z.string(), z.null()]),
  status: z.enum(["planned", "booked"]),
  costCents: z.union([z.number().int().nonnegative(), z.null()]),
  link: urlOrNull,
  checkInTime: optionalImportTimeSchema,
  checkOutTime: optionalImportTimeSchema,
  location: z.union([locationSchema, z.null()]),
  createdAt: isoUtcDate,
  updatedAt: isoUtcDate,
});

const dayPlanItemImportSchema = z
  .object({
    id: z.string().trim().min(1),
    title: z.union([z.string().trim().min(1).max(120), z.null()]).optional().default(null),
    fromTime: z.union([z.string().trim().regex(HHMM_TIME_REGEX), z.null()]).optional().default(null),
    toTime: z.union([z.string().trim().regex(HHMM_TIME_REGEX), z.null()]).optional().default(null),
    contentJson: z.string().trim().min(1, "contentJson is required"),
    costCents: z.union([z.number().int().nonnegative(), z.null()]).optional().default(null),
    linkUrl: urlOrNull,
    location: z.union([locationSchema, z.null()]),
    createdAt: isoUtcDate,
    updatedAt: isoUtcDate,
  })
  .superRefine((value, ctx) => {
    const hasFromTime = typeof value.fromTime === "string";
    const hasToTime = typeof value.toTime === "string";

    if (hasFromTime !== hasToTime) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["fromTime"],
        message: "fromTime and toTime must both be set or both be null",
      });
      return;
    }

    if (value.fromTime !== null && value.toTime !== null) {
      const fromTime = value.fromTime;
      const toTime = value.toTime;
      if (parseTimeToMinutes(toTime) <= parseTimeToMinutes(fromTime)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["toTime"],
          message: "toTime must be later than fromTime",
        });
      }
    }
  });

const tripDayImportSchema = z.object({
  id: z.string().trim().min(1),
  date: isoUtcDate,
  dayIndex: z.number().int().min(1),
  imageUrl: dayImageUrlOrNull.optional().default(null),
  note: z.union([z.string().trim().max(280), z.null()]).optional().default(null),
  createdAt: isoUtcDate,
  updatedAt: isoUtcDate,
  accommodation: z.union([accommodationImportSchema, z.null()]),
  dayPlanItems: z.array(dayPlanItemImportSchema),
});

const tripImportSchema = z
  .object({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1, "Trip name is required"),
    startDate: isoUtcDate,
    endDate: isoUtcDate,
    heroImageUrl: z.union([z.string().trim(), z.null()]),
    startLocation: z.union([locationSchema, z.null()]).optional(),
    destinationLocation: z.union([locationSchema, z.null()]).optional(),
    createdAt: isoUtcDate,
    updatedAt: isoUtcDate,
  })
  .refine((data) => new Date(data.startDate).getTime() <= new Date(data.endDate).getTime(), {
    message: "Start date must be before or equal to end date",
    path: ["endDate"],
  });

export const tripImportPayloadSchema = z.object({
  meta: z.object({
    exportedAt: isoUtcDate,
    appVersion: z.string().trim().min(1),
    formatVersion: z.number().int().positive(),
  }),
  trip: tripImportSchema,
  days: z.array(tripDayImportSchema).min(1, "At least one day is required"),
}).superRefine((input, ctx) => {
  const start = new Date(input.trip.startDate);
  const end = new Date(input.trip.endDate);
  const expectedDays = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
  if (input.days.length !== expectedDays) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Trip days are incomplete for the selected trip date range",
      path: ["days"],
    });
  }

  const seenDayIndexes = new Set<number>();
  for (const day of input.days) {
    if (seenDayIndexes.has(day.dayIndex)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate dayIndex detected: ${day.dayIndex}`,
        path: ["days"],
      });
      break;
    }
    seenDayIndexes.add(day.dayIndex);
  }
});

export const tripImportConflictStrategySchema = z.enum(["overwrite", "createNew"]);

export const tripImportRequestSchema = z
  .object({
    payload: tripImportPayloadSchema,
    strategy: tripImportConflictStrategySchema.optional(),
    targetTripId: z.string().trim().min(1).optional(),
  })
  .superRefine((input, ctx) => {
    if (input.strategy === "overwrite" && !input.targetTripId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "targetTripId is required for overwrite strategy",
        path: ["targetTripId"],
      });
    }

    if (input.strategy !== "overwrite" && input.targetTripId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "targetTripId is only allowed for overwrite strategy",
        path: ["targetTripId"],
      });
    }
  });

export type TripImportPayloadInput = z.infer<typeof tripImportPayloadSchema>;
export type TripImportConflictStrategy = z.infer<typeof tripImportConflictStrategySchema>;
export type TripImportRequestInput = z.infer<typeof tripImportRequestSchema>;
