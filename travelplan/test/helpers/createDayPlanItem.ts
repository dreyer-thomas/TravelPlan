import { createDayPlanItemForTripDay, type DayPlanItemCreateResult } from "@/lib/repositories/dayPlanItemRepo";

/**
 * Story 11.2 widened `createDayPlanItemForTripDay` to also return the push rule's refusals. Suites that
 * create fixtures through it expect a success, so this narrows the result and fails loudly on a refusal
 * instead of letting a `?.item` read `undefined` further down.
 */
export const createDayPlanItemExpectingSuccess = async (
  params: Parameters<typeof createDayPlanItemForTripDay>[0],
): Promise<DayPlanItemCreateResult | null> => {
  const result = await createDayPlanItemForTripDay(params);
  if (result && "status" in result) {
    throw new Error(`Expected the create to succeed, but the push rule refused it: ${result.status}`);
  }
  return result;
};
