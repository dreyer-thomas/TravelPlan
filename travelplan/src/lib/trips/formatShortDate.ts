import { INTL_LOCALES, type Language } from "@/i18n";

/**
 * Renders a raw date string as a short weekday plus a locale month/day pair - `"Sun, 8/9"` in
 * English, `"So., 9.8."` in German (the period after the weekday is CLDR data) - for the short
 * in-line date shown next to a day label (timeline day rows, the accommodation dialog's day
 * subtitle). The weekday is read in the same UTC zone as the date (Story 7.15): a day is stored at
 * midnight UTC, so formatting it in the viewer's zone would move both back a day west of UTC.
 *
 * Returns `null` rather than throwing when `value` doesn't parse. The parse check itself -
 * `new Date(value)` then `Number.isNaN(parsed.getTime())` - is the same one `toDateOnly`
 * (`TripDayPlanDialog.tsx`) uses, but the fallback differs on purpose: `toDateOnly` substitutes
 * today's date because its caller always needs *a* date, while a `null` here lets the caller drop
 * the short date instead of showing a wrong one.
 *
 * This is the single source for this short format: both known call sites (`TripTimeline.tsx`'s
 * day rows and `TripAccommodationDialog.tsx`'s day subtitle) read it, so they cannot drift. The
 * `de-DE`/`en-US` locale selection itself is still duplicated elsewhere (`formatCost.ts` and
 * others) - out of scope here, so it's read from the shared `INTL_LOCALES` map rather than
 * re-hardcoded.
 */
export const formatShortDate = (value: string, language: Language): string | null => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat(INTL_LOCALES[language], {
    weekday: "short",
    month: "numeric",
    day: "numeric",
    timeZone: "UTC",
  }).format(parsed);
};
