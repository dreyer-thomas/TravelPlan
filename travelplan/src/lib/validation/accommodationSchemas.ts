import { z } from "zod";
import { isValidDateOnly } from "@/lib/validation/dateOnly";
import { locationInputSchema } from "@/lib/validation/locationSchemas";

const notesSchema = z.string().trim().max(1000, "Notes must be at most 1000 characters");
const statusSchema = z.enum(["planned", "booked"], "Status must be planned or booked");
const costSchema = z
  .number({ message: "Cost must be a number" })
  .int("Cost must be an integer")
  .min(0, "Cost must be at least 0")
  .max(100000000, "Cost must be at most 100000000");
const dateOnlySchema = z
  .string()
  .trim()
  .refine((value) => isValidDateOnly(value), "Date must be a valid YYYY-MM-DD value");
const paymentSchema = z.object({
  amountCents: costSchema,
  dueDate: dateOnlySchema,
});
const paymentsSchema = z.array(paymentSchema);
const linkSchema = z.string().trim().url("Link must be a valid URL").max(2000, "Link must be at most 2000 characters");
const normalizeTime = (raw: string): string | null => {
  const value = raw.trim();
  const match = value.match(/^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d{1,3})?)?$/);
  if (!match) return null;

  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
};

const timeFieldSchema = z.string().transform((value, context): string | typeof z.NEVER => {
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

const optionalTimeSchema = z.union([timeFieldSchema, z.null()]).optional();

export const accommodationMutationSchema = z.object({
  tripDayId: z.string().trim().min(1, "Trip day is required"),
  name: z.string().trim().min(1, "Accommodation name is required"),
  status: statusSchema,
  costCents: costSchema.optional().nullable(),
  payments: paymentsSchema.optional().nullable(),
  link: linkSchema.optional().nullable(),
  notes: notesSchema.optional().nullable(),
  checkInTime: optionalTimeSchema,
  checkOutTime: optionalTimeSchema,
  location: locationInputSchema.optional(),
}).superRefine((value, context) => {
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
});

export type AccommodationMutationInput = z.infer<typeof accommodationMutationSchema>;

export const accommodationDeleteSchema = z.object({
  tripDayId: z.string().trim().min(1, "Trip day is required"),
});

export type AccommodationDeleteInput = z.infer<typeof accommodationDeleteSchema>;

export const accommodationCopySchema = z.object({
  tripDayId: z.string().trim().min(1, "Trip day is required"),
});

export type AccommodationCopyInput = z.infer<typeof accommodationCopySchema>;
