import { apiError } from "@/lib/errors/apiError";
import { fail } from "@/lib/http/response";
import { DayPlanChangedError, type DayPlanPushRefusal } from "@/lib/repositories/dayPlanItemRepo";

/**
 * The push rule's HTTP answers, shared by `day-plan-items/route.ts` (Story 11.2) and
 * `day-plan-items/reorder/route.ts` (Story 11.3), so both say the same thing in the same shape. They
 * lived in the first route until the second needed them; a route module may only export its handlers.
 */

/** Story 11.2 AC8. The activity that would pass 23:59, named in `details`. Nothing was written. */
export const pastMidnightResponse = (item: { id: string; title: string | null }) =>
  fail(
    apiError("day_plan_past_midnight", "The change would push an activity past midnight", {
      itemId: item.id,
      itemTitle: item.title,
    }),
    409,
  );

/**
 * Story 11.2 AC5/AC8. The push rule's refusals, with the activity they name in `details` so the dialog
 * can say which one. Nothing was written for either.
 */
export const pushRefusalResponse = (refusal: DayPlanPushRefusal) =>
  refusal.status === "before_predecessor"
    ? fail(
        apiError("day_plan_before_predecessor", "Start is before the previous activity", {
          predecessorId: refusal.predecessor.id,
          predecessorTitle: refusal.predecessor.title,
          predecessorFromTime: refusal.predecessor.fromTime,
        }),
        409,
      )
    : pastMidnightResponse(refusal.item);

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
