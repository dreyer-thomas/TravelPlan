import { minutesToTime, LAST_MINUTE_OF_DAY } from "@/lib/trips/daySchedule";
import type { ScheduleMode } from "@/lib/trips/daySchedule";

/**
 * Story 13.1 (AC15). The schedule fields for rows that carry none: a day's activities from a backup made
 * before Story 13.4, which adds the fields to the export. The rule is the migration's
 * (`20261017120000_add_day_plan_item_schedule`), stated in TS once; `migrationDayPlanItemSchedule.test.ts`
 * runs both over the same rows and requires the same answer.
 *
 * - **Validly timed** (both `HH:MM`, hours 00-23, end after start): `FIXED`, the duration is the true
 *   difference (no 5-minute floor, §4), times unchanged.
 * - **Everything else**: `FLEXIBLE` with 15 minutes. In order, each takes the next 15 minutes from the
 *   latest end among the day's fixed rows (10:00 without one), and keeps `null` times where its end would
 *   pass 23:59 (§6).
 * - **Order**: fixed rows first, then flexible ones, each group in the comparator order used before 13.1
 *   (a start before none, `fromTime`, then creation order). The input order *is* the creation order:
 *   import inserts rows in the package's array order.
 *
 * Returns one entry per input row, in input order.
 */

export type LegacyScheduleInput = { fromTime: string | null; toTime: string | null };

export type LegacyScheduleFields = {
  scheduleMode: ScheduleMode;
  durationMinutes: number;
  sortOrder: number;
  fromTime: string | null;
  toTime: string | null;
};

/** The default for a row without a duration (Tommy, 2026-10-17: "kurz anhalten und umschauen"). */
export const DEFAULT_ACTIVITY_DURATION_MINUTES = 15;

const STRICT_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const strictMinutes = (value: string | null): number | null =>
  value !== null && STRICT_TIME.test(value) ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5)) : null;

const LEGACY_DAY_START_MINUTE = 10 * 60;

export const legacyScheduleFields = (items: LegacyScheduleInput[]): LegacyScheduleFields[] => {
  const entries = items.map((item, index) => {
    const start = strictMinutes(item.fromTime);
    const end = strictMinutes(item.toTime);
    const fixed = start !== null && end !== null && end > start;
    return { item, index, fixed, start, end };
  });

  const hasStart = (value: string | null) => Boolean(value);
  const ordered = [...entries].sort((left, right) => {
    if (left.fixed !== right.fixed) return left.fixed ? -1 : 1;
    const leftHas = hasStart(left.item.fromTime);
    const rightHas = hasStart(right.item.fromTime);
    if (leftHas !== rightHas) return leftHas ? -1 : 1;
    if (leftHas && left.item.fromTime !== right.item.fromTime) {
      return left.item.fromTime! < right.item.fromTime! ? -1 : 1;
    }
    return left.index - right.index;
  });

  const fixedEnds = entries.filter((entry) => entry.fixed).map((entry) => entry.end!);
  const flexStart = fixedEnds.length > 0 ? Math.max(...fixedEnds) : LEGACY_DAY_START_MINUTE;

  const result: LegacyScheduleFields[] = new Array(items.length);
  let slot = 0;
  ordered.forEach((entry, sortOrder) => {
    if (entry.fixed) {
      result[entry.index] = {
        scheduleMode: "FIXED",
        durationMinutes: entry.end! - entry.start!,
        sortOrder,
        fromTime: entry.item.fromTime,
        toTime: entry.item.toTime,
      };
      return;
    }
    const from = flexStart + DEFAULT_ACTIVITY_DURATION_MINUTES * slot;
    const to = from + DEFAULT_ACTIVITY_DURATION_MINUTES;
    slot += 1;
    const fits = to <= LAST_MINUTE_OF_DAY;
    result[entry.index] = {
      scheduleMode: "FLEXIBLE",
      durationMinutes: DEFAULT_ACTIVITY_DURATION_MINUTES,
      sortOrder,
      fromTime: fits ? minutesToTime(from) : null,
      toTime: fits ? minutesToTime(to) : null,
    };
  });
  return result;
};
