/**
 * Story 11.4 (FR42, rule 9). The times a stay is assumed to have when none is stored, and the rule that
 * decides when "none is stored".
 *
 * One module for client and server. The day view, the stay dialog and the overview gantt each used to
 * hold their own `"10:00"`/`"16:00"`, which was harmless while only the screen drew with them. Since 11.4
 * the server pushes the next day from the resolved check-out, so a second copy could make the server
 * push from one time while the timeline draws another. No Prisma import: the client bundle reads this.
 */

export const DEFAULT_CHECK_OUT_TIME = "10:00";
export const DEFAULT_CHECK_IN_TIME = "16:00";

/** The timeline's rule: an empty or whitespace-only value falls back exactly like `null`. */
export const resolveStayTime = (value: string | null | undefined, fallback: string) =>
  value && value.trim() ? value : fallback;

export const resolveCheckOutTime = (value: string | null | undefined) => resolveStayTime(value, DEFAULT_CHECK_OUT_TIME);
