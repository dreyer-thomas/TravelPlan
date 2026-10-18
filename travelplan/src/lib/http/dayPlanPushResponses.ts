import { apiError } from "@/lib/errors/apiError";
import { fail } from "@/lib/http/response";
import { DayPlanChangedError } from "@/lib/repositories/dayPlanItemRepo";

/**
 * The schedule rule's HTTP answers, shared by every route whose write recomputes a day (Stories 11.2-11.4,
 * 13.1), so all of them say the same thing in the same shape. Story 13.1 removed
 * `day_plan_before_predecessor`: a fixed activity is placed by its time instead of being refused. Story
 * 13.2 removed the midnight refusal: a write past 23:59 is saved, its overflowing rows untimed. They
 * lived in the first route until the second needed them; a route module may only export its handlers.
 */

/**
 * Story 11.2. Runs a write, mapping a push that lost a race with another write (the transaction has
 * rolled back) to `409 day_plan_changed`. Anything else propagates as before.
 */
export const withPushConflict = async <T>(write: () => Promise<T>): Promise<{ result: T } | { conflict: true }> => {
  try {
    return { result: await write() };
  } catch (error) {
    if (error instanceof DayPlanChangedError) return { conflict: true };
    throw error;
  }
};

export const dayChangedResponse = () => fail(apiError("day_plan_changed", "The day was changed by another write"), 409);
