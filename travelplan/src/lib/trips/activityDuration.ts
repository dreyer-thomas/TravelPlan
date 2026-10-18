import { formatMessage } from "@/i18n";

/**
 * Story 14.1. An activity's duration as the bucket-list row's meta line shows it: "1 Std", "45 Min",
 * "1 Std 30 Min" (en: "1 h", "45 min", "1 h 30 min"). Whole hours drop the minutes, under an hour drops
 * the hours. Pure; the print view's own `formatDuration` and the day view's are left as they are.
 */
export const formatActivityDuration = (minutes: number, t: (key: string) => string): string => {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours === 0) return formatMessage(t("trips.duration.minutes"), { minutes: rest });
  if (rest === 0) return formatMessage(t("trips.duration.hours"), { hours });
  return formatMessage(t("trips.duration.hoursMinutes"), { hours, minutes: rest });
};

/**
 * Story 14.1. The `bucket-item` meta line: duration and place, separated by " · " ("1 Std · Gullfoss").
 * Without a place it is the duration alone.
 */
export const bucketItemMetaLine = (
  item: { durationMinutes: number; location: { label?: string | null } | null },
  t: (key: string) => string,
): string => [formatActivityDuration(item.durationMinutes, t), item.location?.label?.trim() ?? ""].filter(Boolean).join(" · ");
