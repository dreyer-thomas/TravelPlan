import { formatMessage } from "@/i18n";

/**
 * Story 12.3. The typical duration a suggestion card shows: "ca. 45 min", "ca. 1½ h".
 *
 * Deliberately coarser than `formatDurationMinutes` in `TripDayView` ("1h 30m"): the number is the
 * model's estimate, and printing it to the minute would claim a precision it does not have. Under an
 * hour it rounds to 5 minutes (never below 5); from an hour it rounds to the half hour. A value that
 * rounds up to 60 is written as "1 h", not "60 min".
 */
export const formatApproxDuration = (minutes: number, t: (key: string) => string): string => {
  const fiveMinuteSteps = Math.max(5, Math.round(minutes / 5) * 5);
  if (fiveMinuteSteps < 60) {
    return formatMessage(t("trips.suggestions.durationMinutes"), { minutes: fiveMinuteSteps });
  }
  const halfHours = Math.max(2, Math.round(minutes / 30));
  const whole = Math.floor(halfHours / 2);
  const hours = halfHours % 2 === 1 ? `${whole}½` : String(whole);
  return formatMessage(t("trips.suggestions.durationHours"), { hours });
};
