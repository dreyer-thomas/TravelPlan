/**
 * Story 11.4 (FR42, rule 9). The times a stay is assumed to have when none is stored, and the rule that
 * decides when "none is stored".
 *
 * One module for client and server. The day view, the stay dialog and the overview gantt each used to
 * hold their own `"10:00"`/`"16:00"`, which was harmless while only the screen drew with them. Since 11.4
 * the server pushes the next day from the resolved check-out, so a second copy could make the server
 * push from one time while the timeline draws another. No Prisma import: the client bundle reads this.
 */
import { timeToMinutes } from "@/lib/trips/daySchedule";

export const DEFAULT_CHECK_OUT_TIME = "10:00";
export const DEFAULT_CHECK_IN_TIME = "16:00";

/** The timeline's rule: an empty or whitespace-only value falls back exactly like `null`. */
export const resolveStayTime = (value: string | null | undefined, fallback: string) =>
  value && value.trim() ? value : fallback;

export const resolveCheckOutTime = (value: string | null | undefined) => resolveStayTime(value, DEFAULT_CHECK_OUT_TIME);

/**
 * Story 12.4 (Tommy's ruling 1c), shared since Story 13.1. Where a day starts that has no stay the night
 * before (the trip's first day, or a night without one): there is no check-out to start from.
 */
export const DAY_START_WITHOUT_STAY = "09:00";

/**
 * Story 13.1 (rule 1). The minute a day's schedule starts: last night's stay's check-out, the 10:00
 * default when it stores none (or one that does not read as `HH:MM`), and 09:00 with no stay last night.
 * "Last night's stay" is the accommodation of the nearest earlier day; a caller whose earlier day has no
 * accommodation passes `null`.
 */
export const resolveDayStartMinute = (previousStay: { checkOutTime: string | null } | null): number => {
  if (!previousStay) return timeToMinutes(DAY_START_WITHOUT_STAY)!;
  return timeToMinutes(resolveCheckOutTime(previousStay.checkOutTime)) ?? timeToMinutes(DEFAULT_CHECK_OUT_TIME)!;
};
