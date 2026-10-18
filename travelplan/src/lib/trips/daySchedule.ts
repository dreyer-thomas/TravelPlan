/**
 * Story 13.1 (FR42, FR46). The schedule rule: one forward pass over a day's activities in `sortOrder`,
 * which works out every flexible activity's times from the day start, the durations and the drawn legs.
 *
 * One pure function over the day. No Prisma import and no clock, so the rule is unit-tested on its own
 * (`test/daySchedule.test.ts`), and the repositories (`dayScheduleTransaction.ts`) only read the day, call
 * it, and write the rows whose times or order changed, all inside the write's own transaction. It replaces
 * Story 11.2's push walk (`dayPlanPush.ts`, deleted), which only ever moved rows later and stopped at the
 * first one that fitted.
 *
 * The rule, as the 2026-10-17 proposal states it:
 *
 * 1. **Day start.** A cursor starts at `dayStartMinute` (`resolveDayStartMinute`, `stayTimes.ts`). The
 *    first row adds the drawn leg from last night's stay.
 * 2. **Flexible.** `fromTime = cursor + leg(previous → this)`, `toTime = fromTime + durationMinutes`; the
 *    cursor moves to `toTime`. A flexible row always sits tight: a gap before one never survives.
 * 3. **Fixed.** Its times are never changed. It is reached late, a *conflict*, when what is already on
 *    the day plus the leg passes its `fromTime`; that covers a flexible chain running into a booking and
 *    two overlapping bookings. The day start alone never makes a booking late (Tommy's ruling during the
 *    13.2 real run, 2026-10-18): a flight at 00:00 on a day without a stay, or a ferry before the
 *    check-out, just means the day starts earlier. So the late check reads `busyUntil`, the end of the
 *    last activity actually on the day, and a booking with nothing before it is never late. The cursor
 *    moves to `max(cursor, toTime)`, so a gap before a fixed row stays as waiting time; the day start
 *    still decides where flexible rows begin, so no time changes with this rule.
 * 5. **Midnight.** A flexible row whose end would pass 23:59 gets `null` times, meaning *does not fit in
 *    the day*, and so does every later flexible row. Its duration is untouched, so the next write that
 *    makes room gives the times back exactly.
 *
 * (Rule 4, placing a fixed row by its time, is `placeFixedItem` below.)
 *
 * **Which legs count.** Only drawn ones: the timeline draws last night's stay → the rows in order →
 * tonight's stay, so the leg into row `i` is the one from row `i − 1`, and into the first row the one from
 * last night's stay. When several stored legs share a pair, the first one in `legs` wins, as Story 11.2's
 * walk read them; a leg save passes its new value first so it wins over the stored row.
 *
 * **A `FIXED` row without two readable times** (both `HH:MM`, end after start) cannot keep times it does
 * not have. It is scheduled as if it were flexible. Only a seed can make one; the repository normalises it
 * to `FLEXIBLE` on the next write of its day (Story 13.1 §5).
 */

/** `HH:MM` has no 24:00 (`normalizeTime` caps hours at 23), so the last storable minute is 23:59. */
export const LAST_MINUTE_OF_DAY = 23 * 60 + 59;

const TIME_PATTERN = /^(\d{1,2}):(\d{2})$/;

/** Minutes since midnight, or `null` for anything that is not a readable `HH:MM` (an odd import). */
export const timeToMinutes = (value: string | null): number | null => {
  if (!value) return null;
  const match = TIME_PATTERN.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
};

/** Zero-padded `HH:MM`. Only called for values already bounded to the day. */
export const minutesToTime = (value: number): string =>
  `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;

/**
 * The end of an activity in minutes: its `toTime` when that is set and after its start, otherwise its
 * start (a zero-length row, or an overnight `23:00–01:00` pair from an import). `null` when even the
 * start is unreadable.
 */
export const activityEndMinutes = (item: { fromTime: string | null; toTime: string | null }): number | null => {
  const start = timeToMinutes(item.fromTime);
  if (start === null) return null;
  const end = timeToMinutes(item.toTime);
  return end !== null && end > start ? end : start;
};

/** Both times readable and the end after the start: the only shape a `FIXED` row keeps (§5). */
export const hasValidTimes = (item: { fromTime: string | null; toTime: string | null }): boolean => {
  const start = timeToMinutes(item.fromTime);
  const end = timeToMinutes(item.toTime);
  return start !== null && end !== null && end > start;
};

export type ScheduleMode = "FLEXIBLE" | "FIXED";

export type ScheduleItem = {
  id: string;
  title: string | null;
  scheduleMode: ScheduleMode;
  durationMinutes: number;
  fromTime: string | null;
  toTime: string | null;
};

/** A stored leg. A key is an activity's id, or last night's stay's accommodation id. */
export type ScheduleLeg = { fromKey: string; toKey: string; durationMinutes: number };

export type ScheduleInput = {
  dayStartMinute: number;
  /** Last night's stay, whose leg to the first row counts; `null` on a day without one. */
  previousStayId: string | null;
  /** In `sortOrder`. */
  items: ScheduleItem[];
  legs: ScheduleLeg[];
};

export type ScheduleConflict = {
  itemId: string;
  title: string | null;
  fromTime: string;
  /** Capped at 23:59, the last time of day there is (review D1). */
  reachableAt: string;
  /** From the uncapped reach, so a booking reached only after midnight is not understated (13.2 review). */
  lateMinutes: number;
};

export type ScheduleResult = {
  /** One per input row, in the same order. A fixed row's strings are passed through verbatim. */
  rows: Array<{ id: string; fromTime: string | null; toTime: string | null }>;
  /** Fixed rows reached late, in day order. */
  conflicts: ScheduleConflict[];
  /** Flexible rows that do not fit before 23:59 (rule 5), in day order. */
  overflow: string[];
};

const legKey = (fromKey: string, toKey: string) => `${fromKey}\u0000${toKey}`;

const buildLegMinutes = (legs: ScheduleLeg[]): Map<string, number> => {
  const legMinutes = new Map<string, number>();
  for (const leg of legs) {
    const key = legKey(leg.fromKey, leg.toKey);
    if (!legMinutes.has(key)) legMinutes.set(key, leg.durationMinutes);
  }
  return legMinutes;
};

export const scheduleDay = (input: ScheduleInput): ScheduleResult => {
  const { dayStartMinute, previousStayId, items, legs } = input;
  const legMinutes = buildLegMinutes(legs);
  const rows: ScheduleResult["rows"] = [];
  const conflicts: ScheduleConflict[] = [];
  const overflow: string[] = [];

  let cursor = dayStartMinute;
  /** The end of the last activity on the day so far; `null` before the first. Only the late check reads it. */
  let busyUntil: number | null = null;
  let overflowed = false;

  items.forEach((item, index) => {
    const previousKey = index === 0 ? previousStayId : items[index - 1].id;
    const leg = previousKey === null ? 0 : (legMinutes.get(legKey(previousKey, item.id)) ?? 0);
    const reachable = cursor + leg;

    if (item.scheduleMode === "FIXED" && hasValidTimes(item)) {
      const start = timeToMinutes(item.fromTime)!;
      const end = timeToMinutes(item.toTime)!;
      // After an overflow the cursor is past 23:59, and the overflow already describes that day (13.2
      // shows it). Without one, a booking reached only after midnight (a long leg into a late row) is
      // still a conflict; its `reachableAt` is capped at 23:59, the last time of day there is (review D1).
      const reachedFromDay = busyUntil === null ? null : busyUntil + leg;
      if (reachedFromDay !== null && reachedFromDay > start && !overflowed) {
        conflicts.push({
          itemId: item.id,
          title: item.title,
          fromTime: item.fromTime!,
          reachableAt: minutesToTime(Math.min(reachedFromDay, LAST_MINUTE_OF_DAY)),
          lateMinutes: reachedFromDay - start,
        });
      }
      cursor = Math.max(cursor, end);
      busyUntil = Math.max(busyUntil ?? end, end);
      rows.push({ id: item.id, fromTime: item.fromTime, toTime: item.toTime });
      return;
    }

    const end = reachable + item.durationMinutes;
    busyUntil = Math.max(busyUntil ?? end, end);
    if (overflowed || end > LAST_MINUTE_OF_DAY) {
      overflowed = true;
      cursor = Math.max(cursor, end);
      overflow.push(item.id);
      rows.push({ id: item.id, fromTime: null, toTime: null });
      return;
    }
    cursor = end;
    rows.push({ id: item.id, fromTime: minutesToTime(reachable), toTime: minutesToTime(end) });
  });

  return { rows, conflicts, overflow };
};

/**
 * Rule 4. Where a row that has just become fixed, or whose fixed start changed, belongs: the row is taken
 * out of the order, the rest is scheduled, and the row goes after the last row whose **computed** start is
 * at or before its start (position 0 when there is none). A row with `null` computed times counts as later
 * than everything. Returns the index in the order *without* the row, which is its index in the new order.
 * It never refuses; this replaces Story 11.2's `before_predecessor`.
 *
 * Throws when `itemId` is not on the day or has no readable start; the caller checks both.
 */
export const placeFixedItem = (input: ScheduleInput & { itemId: string }): number => {
  const placed = input.items.find((entry) => entry.id === input.itemId);
  const placedStart = placed ? timeToMinutes(placed.fromTime) : null;
  if (!placed || placedStart === null) {
    throw new Error("placeFixedItem: the activity is not on the day or has no start");
  }
  const rest = input.items.filter((entry) => entry.id !== input.itemId);
  const { rows } = scheduleDay({ ...input, items: rest });
  let index = 0;
  rows.forEach((row, position) => {
    const start = timeToMinutes(row.fromTime);
    if (start !== null && start <= placedStart) index = position + 1;
  });
  return index;
};
