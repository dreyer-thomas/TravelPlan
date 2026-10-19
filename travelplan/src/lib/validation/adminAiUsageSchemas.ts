import { z } from "zod";

/**
 * Story 8.7. The month view's query: an optional `YYYY-MM`, not after `currentMonth` (server-local). Built
 * per request because "the future" moves; zero-padded keys compare correctly as strings.
 */
export const buildAdminAiUsageQuerySchema = (currentMonth: string) =>
  z.object({
    month: z
      .string()
      // The year starts at 1000: `new Date(y, m, 1)` reads 0-99 as 1900-1999.
      .regex(/^[1-9]\d{3}-(0[1-9]|1[0-2])$/, "Expected YYYY-MM")
      .refine((month) => month <= currentMonth, "Month is in the future")
      .optional(),
  });
