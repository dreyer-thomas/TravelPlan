import {
  scheduleDay,
  type ScheduleInput,
  type ScheduleItem,
  type ScheduleLeg,
} from "@/lib/trips/daySchedule";
import { resolveDayStartMinute } from "@/lib/trips/stayTimes";

/**
 * Story 13.2 (FR47). When a day's plan does not work out: the activities `scheduleDay` marks, as the trip
 * payload carries them (`planConflicts` per day, `tripRepo.ts`). Derived on every read and never stored
 * (architecture, *Activities planned by duration*): the day view and the trip overview both render the
 * one list the server derived, and neither computes a schedule of its own.
 *
 * Two kinds, one entry per marked activity, in the day's order:
 *
 * - `late`: a FIXED activity reached after its start, by a flexible chain running into it or an earlier
 *   fixed activity overlapping it. `reachableAt` is capped at 23:59 (13.1 review D1); `lateMinutes` is not.
 * - `overflow`: a FLEXIBLE activity that does not fit before 23:59, and every flexible one after it.
 *
 * A fixed activity after an overflow is not reported late, and arriving at tonight's stay after its
 * check-in is never a conflict; both are `scheduleDay`'s own rules.
 *
 * Pure, no Prisma and no `server-only`, so the client may import the type.
 */

export type DayPlanConflict =
  | {
      kind: "late";
      itemId: string;
      title: string | null;
      fromTime: string;
      reachableAt: string;
      lateMinutes: number;
    }
  | { kind: "overflow"; itemId: string; title: string | null };

/** A stored leg as Prisma returns it. A key is an activity's id or last night's stay's accommodation id. */
export type ScheduleSourceSegment = { fromItemId: string; toItemId: string; durationMinutes: number };

/** Last night's stay as the schedule reads it: its id and check-out. Its name plays no part. */
export type ScheduleSourceStay = { id: string; checkOutTime: string | null };

export const toScheduleItem = (row: ScheduleItem): ScheduleItem => ({
  id: row.id,
  title: row.title,
  scheduleMode: row.scheduleMode,
  durationMinutes: row.durationMinutes,
  fromTime: row.fromTime,
  toTime: row.toTime,
});

export const toScheduleLeg = (segment: ScheduleSourceSegment): ScheduleLeg => ({
  fromKey: segment.fromItemId,
  toKey: segment.toItemId,
  durationMinutes: segment.durationMinutes,
});

/** The day start and the first leg's key, from last night's stay. Shared by the writes (`planDaySchedule`). */
export const scheduleInputFor = (params: {
  items: ScheduleItem[];
  legs: ScheduleLeg[];
  previousStay: ScheduleSourceStay | null;
}): ScheduleInput => ({
  dayStartMinute: resolveDayStartMinute(params.previousStay),
  previousStayId: params.previousStay?.id ?? null,
  items: params.items,
  legs: params.legs,
});

/**
 * The schedule input from stored rows: `items` already in the day's order (`compareDayPlanItemsByOrder`),
 * `legs` in `createdAt` order (the first leg per pair wins), and `previousStay` the accommodation of the
 * nearest earlier day, whatever its name.
 */
export const buildScheduleInput = (params: {
  items: ScheduleItem[];
  legs: ScheduleSourceSegment[];
  previousStay: ScheduleSourceStay | null;
}): ScheduleInput =>
  scheduleInputFor({
    items: params.items.map(toScheduleItem),
    legs: params.legs.map(toScheduleLeg),
    previousStay: params.previousStay,
  });

export const derivePlanConflicts = (input: ScheduleInput): DayPlanConflict[] => {
  const { conflicts, overflow } = scheduleDay(input);
  const late = new Map(conflicts.map((conflict) => [conflict.itemId, conflict]));
  const overflowIds = new Set(overflow);
  const result: DayPlanConflict[] = [];
  for (const item of input.items) {
    const conflict = late.get(item.id);
    if (conflict) {
      result.push({
        kind: "late",
        itemId: conflict.itemId,
        title: conflict.title,
        fromTime: conflict.fromTime,
        reachableAt: conflict.reachableAt,
        lateMinutes: conflict.lateMinutes,
      });
    } else if (overflowIds.has(item.id)) {
      result.push({ kind: "overflow", itemId: item.id, title: item.title });
    }
  }
  return result;
};
