/**
 * The hours box and the minutes box of a duration, shared by the leg dialog (Story 6.18) and, since
 * Story 13.1, the activity dialog. Pure, so both dialogs and their tests read one rule. Moved here from
 * `TripDayTravelSegmentDialog.tsx` unchanged.
 */

/** What the two duration boxes hold. Strings, because they are what the user is mid-way through typing. */
export type DurationInput = { hours: string; minutes: string };

/**
 * Story 6.18 replaced the single `HH:mm` text field with an hours box and a minutes box, so this is
 * a split rather than a format. Nothing is zero-padded: the boxes take a bare count, where "05" is
 * noise.
 */
export const splitMinutesToDuration = (minutes: number): DurationInput => {
  if (!Number.isFinite(minutes) || minutes <= 0) return { hours: "", minutes: "" };
  return { hours: String(Math.floor(minutes / 60)), minutes: String(minutes % 60) };
};

/**
 * The two boxes recombined, or `null` for "this is not a duration" — one answer for the pair, which
 * is why one error line hangs under both boxes rather than one under each.
 *
 * The accepted set is deliberately the one the old `^(\d{1,3}):(\d{2})$` regex had: hours 0-999,
 * minutes 0-59, total above zero. That is why each box is matched against `^\d+$` before it is
 * parsed — `Number.parseInt` would otherwise read "1e3", "12abc", "-5" and "1.5" as numbers the
 * regex rejected outright. This function is the only judge; the boxes are `type="text"` precisely
 * so that everything the user typed reaches it, rather than a number input handing back `""` for
 * input it privately considers malformed.
 *
 * Hours are *not* capped at 23. They were once, and the field could therefore reject its own
 * prefill: a route import happily writes 39 hours and the old `\d{1,2}` / `hours > 23` pair then
 * answered "Duration is required" over a field that visibly contained a duration. Once route import
 * started returning real walking speeds (~4.5 km/h) a ~110 km leg was enough to reach it, and a
 * multi-day ship crossing always could.
 */
export const combineDurationToMinutes = ({ hours, minutes }: DurationInput): number | null => {
  // The one widening Story 6.18 allows: an *empty* box counts as zero, where "01:" and ":30" were
  // both rejected. An empty box in a two-box duration reads as zero, and 60 and 30 minutes were
  // always acceptable durations. It applies to both boxes on purpose — an empty hours box next to a
  // minutes box reading 45 is the same "Duration is required over a field that visibly holds a
  // duration" this function's second paragraph exists to prevent, and a box empties itself on one
  // backspace. Two empty boxes still cannot mean "0 minutes": the `total > 0` floor below catches
  // that.
  const hoursRaw = hours.trim() || "0";
  const minutesRaw = minutes.trim() || "0";
  if (!/^\d+$/.test(hoursRaw) || !/^\d+$/.test(minutesRaw)) return null;
  const parsedHours = Number.parseInt(hoursRaw, 10);
  const parsedMinutes = Number.parseInt(minutesRaw, 10);
  if (parsedHours > 999 || parsedMinutes > 59) return null;
  const total = parsedHours * 60 + parsedMinutes;
  return total > 0 ? total : null;
};
