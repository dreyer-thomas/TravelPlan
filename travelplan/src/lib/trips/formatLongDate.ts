import { INTL_LOCALES, type Language } from "@/i18n";

/**
 * Renders a raw date string as a long weekday plus the written-out date - `"Sunday, August 9, 2026"`
 * in English, `"Sonntag, 9. August 2026"` in German - for the places that show a day's date on its
 * own line (the day-view hero, the whole-day transfer picker, the day print sheet). The short sibling
 * shown next to a day label is `formatShortDate`.
 *
 * `timeZone: "UTC"` is not optional: a day is stored at midnight UTC, and formatting it in the
 * viewer's zone would show the previous day and weekday anywhere west of UTC.
 *
 * Returns `null` rather than throwing when `value` doesn't parse - `Intl…format(new Date(""))` throws
 * a `RangeError` - so the caller can drop the date instead of failing the whole screen, the same
 * contract `formatShortDate` has.
 */
export const formatLongDate = (value: string, language: Language): string | null => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat(INTL_LOCALES[language], {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed);
};
