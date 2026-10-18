import type { TransactionClient } from "@/lib/repositories/travelSegmentRepo";
import type {
  DayChangeEdited,
  DayChangePlanConflict,
  DayChangeReceipt,
  MovedItemRow,
  TravelSegmentRow,
} from "@/lib/trips/dayChangeReceipt";
import { compareDayPlanItemsByOrder } from "@/lib/trips/dayPlanItemOrder";
import {
  hasValidTimes,
  placeFixedItem,
  scheduleDay,
  type ScheduleConflict,
  type ScheduleItem,
  type ScheduleLeg,
} from "@/lib/trips/daySchedule";
import { scheduleInputFor, toScheduleItem, toScheduleLeg } from "@/lib/trips/planConflicts";

/**
 * Story 13.1 (FR42). The transaction half of the schedule rule, shared by every write that can change a
 * day's times or order: the activity writes (`dayPlanItemRepo.ts`), the leg writes (`travelSegmentRepo.ts`)
 * and last night's check-out (`accommodationRepo.ts`). It replaces Story 11.4's `dayPlanPushTransaction.ts`.
 *
 * Each write keeps the shape Epic 11 gave it, inside one `prisma.$transaction`:
 *
 * 1. `readScheduleInputInTransaction`: the day's rows in order, last night's stay, the day's legs.
 * 2. `planDaySchedule` (pure): apply the edit to the in-memory day, place a fixed row by its time if it
 *    needs placing, and schedule the day **before** and **after**. It never refuses: since Story 13.2 a
 *    flexible row pushed past 23:59 is stored without times (rule 5), and the trip payload marks it.
 * 3. The write itself.
 * 4. `applyScheduleChangesInTransaction`: every other row whose times or `sortOrder` changed, each
 *    conditional on the `updatedAt` step 1 read (`DayPlanChangedError` rolls the whole change back).
 * 5. 11.1's sweep and `buildReceipt`.
 *
 * This module imports `travelSegmentRepo.ts` for its transaction type only, so `dayPlanItemRepo.ts` (which
 * imports `travelSegmentRepo.ts`) and `travelSegmentRepo.ts` itself can both import it without a cycle.
 */

/**
 * Story 11.2. A row changed between the transaction's read and its conditional write: another write
 * slipped in. Thrown inside the transaction so all of it rolls back; the route maps it to
 * `409 day_plan_changed`.
 */
export class DayPlanChangedError extends Error {
  constructor() {
    super("A pushed activity changed during the write");
    this.name = "DayPlanChangedError";
  }
}

export const buildReceipt = (
  tripDayId: string,
  edited: DayChangeEdited,
  removedTravelSegments: TravelSegmentRow[],
  movedItems: MovedItemRow[],
  extras: {
    planConflicts?: DayChangePlanConflict[];
  } = {},
): DayChangeReceipt => ({
  version: 3,
  tripDayId,
  edited,
  removedTravelSegments,
  movedItems,
  // Absent when empty, as `removedImageFiles` is (12.4): an undo result pinned with `toEqual` stays valid.
  ...(extras.planConflicts && extras.planConflicts.length > 0 ? { planConflicts: extras.planConflicts } : {}),
});

/** A stored row as the schedule reads it, with the stamps its conditional write needs. */
export type StoredScheduleRow = ScheduleItem & { sortOrder: number; createdAt: Date; updatedAt: Date };

/** A stored leg with its id, so a leg save can leave out the row it replaces or deletes. */
export type StoredScheduleLeg = ScheduleLeg & { id: string };

export type ScheduleDayState = {
  tripDayId: string;
  /** In the day's order (`compareDayPlanItemsByOrder`). */
  rows: StoredScheduleRow[];
  /** The accommodation of the nearest earlier day, or `null` when there is none. */
  previousStay: { id: string; checkOutTime: string | null } | null;
  /** Every leg on the day, in `createdAt` order; `scheduleDay` counts only the drawn ones. */
  legs: StoredScheduleLeg[];
};

/**
 * Step 1. The day's rows, last night's stay and the day's legs, read through `tx` before the first write.
 * `null` when the day is not on the trip.
 */
export const readScheduleInputInTransaction = async (
  tx: TransactionClient,
  tripId: string,
  tripDayId: string,
): Promise<ScheduleDayState | null> => {
  const day = await tx.tripDay.findFirst({
    where: { id: tripDayId, tripId },
    select: {
      dayIndex: true,
      dayPlanItems: {
        select: {
          id: true,
          title: true,
          scheduleMode: true,
          durationMinutes: true,
          fromTime: true,
          toTime: true,
          sortOrder: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      travelSegments: {
        orderBy: { createdAt: "asc" },
        select: { id: true, fromItemId: true, toItemId: true, durationMinutes: true },
      },
    },
  });
  if (!day) return null;

  // The timeline's rule: last night's stay is the nearest lower `dayIndex`, not `dayIndex - 1`.
  const previousDay = await tx.tripDay.findFirst({
    where: { tripId, dayIndex: { lt: day.dayIndex } },
    orderBy: [{ dayIndex: "desc" }, { date: "desc" }],
    select: { accommodation: { select: { id: true, checkOutTime: true } } },
  });

  return {
    tripDayId,
    rows: [...day.dayPlanItems].sort(compareDayPlanItemsByOrder),
    previousStay: previousDay?.accommodation ?? null,
    // The trip payload (`tripRepo.ts`) maps its legs with the same `toScheduleLeg` (Story 13.2 §2).
    legs: day.travelSegments.map((segment) => ({ id: segment.id, ...toScheduleLeg(segment) })),
  };
};

/** What a write does to the day, as the plan applies it in memory. */
export type ScheduleEdit =
  /** Nothing about the rows: a recompute only (a leg to tonight's stay, say). */
  | { kind: "none" }
  /** A new row. FLEXIBLE is appended; FIXED is placed by its time (rule 4). */
  | { kind: "insert"; item: ScheduleItem }
  /**
   * A row's new state. FIXED that was not FIXED, or whose start changed, is placed by time; every other
   * edit keeps the row where it is.
   */
  | { kind: "update"; item: ScheduleItem }
  | { kind: "remove"; itemId: string }
  /** *Nach oben* / *Nach unten*: the two rows trade places. */
  | { kind: "swap"; itemId: string; neighbourId: string }
  /** A leg save: `removeSegmentId` leaves the stored row out, `leg` is put first so it wins its pair. */
  | { kind: "legs"; removeSegmentId?: string; leg?: ScheduleLeg }
  /** Last night's check-out as it will be stored. */
  | { kind: "checkOut"; checkOutTime: string | null };

export type PlannedRow = {
  id: string;
  title: string | null;
  fromTime: string | null;
  toTime: string | null;
  sortOrder: number;
};

/** A row other than the edited one whose stored times or order the write changes. */
export type PlannedChange = PlannedRow & {
  /** A FIXED row without two readable times was scheduled as flexible; it is stored as FLEXIBLE (§5). */
  normaliseToFlexible: boolean;
  previous: { fromTime: string | null; toTime: string | null; sortOrder: number; updatedAt: Date };
};

export type DaySchedulePlan = {
  /** The day after the write, in order, with the computed times (`null` for a row that does not fit). */
  order: PlannedRow[];
  /** The inserted or updated row as it will be written; `null` for every other edit. */
  edited: PlannedRow | null;
  changes: PlannedChange[];
  /** Conflicts this write made: new ones, or reached later than before (§15). */
  newConflicts: ScheduleConflict[];
};

/**
 * Step 2, pure. Throws when the edit names a row that is not on the day; the repositories check first.
 */
export const planDaySchedule = (state: ScheduleDayState, edit: ScheduleEdit): DaySchedulePlan => {
  const beforeItems = state.rows.map(toScheduleItem);
  const beforeStay = state.previousStay;
  // The same input builder as the trip payload's conflicts (Story 13.2 §2), so the read cannot drift.
  const before = scheduleDay(scheduleInputFor({ items: beforeItems, legs: state.legs, previousStay: beforeStay }));

  let items = [...beforeItems];
  let legs: ScheduleLeg[] = state.legs;
  let stay = beforeStay;
  let editedId: string | null = null;
  let placeId: string | null = null;

  const indexOf = (itemId: string) => {
    const index = items.findIndex((item) => item.id === itemId);
    if (index < 0) throw new Error("planDaySchedule: the activity is not on the day");
    return index;
  };

  switch (edit.kind) {
    case "none":
      break;
    case "insert":
      items.push(edit.item);
      editedId = edit.item.id;
      if (edit.item.scheduleMode === "FIXED") placeId = edit.item.id;
      break;
    case "update": {
      const index = indexOf(edit.item.id);
      const existing = items[index];
      items[index] = edit.item;
      editedId = edit.item.id;
      if (
        edit.item.scheduleMode === "FIXED" &&
        (existing.scheduleMode !== "FIXED" || existing.fromTime !== edit.item.fromTime)
      ) {
        placeId = edit.item.id;
      }
      break;
    }
    case "remove":
      indexOf(edit.itemId);
      items = items.filter((item) => item.id !== edit.itemId);
      break;
    case "swap": {
      const first = indexOf(edit.itemId);
      const second = indexOf(edit.neighbourId);
      [items[first], items[second]] = [items[second], items[first]];
      break;
    }
    case "legs":
      legs = [
        ...(edit.leg ? [edit.leg] : []),
        ...state.legs.filter((leg) => leg.id !== edit.removeSegmentId),
      ];
      break;
    case "checkOut":
      stay = beforeStay ? { ...beforeStay, checkOutTime: edit.checkOutTime } : beforeStay;
      break;
    default: {
      const unhandled: never = edit;
      throw new Error(`Unhandled schedule edit: ${String(unhandled)}`);
    }
  }

  // `items` is overridden at each call below: placing a fixed row changes the order.
  const scheduleInput = scheduleInputFor({ items, legs, previousStay: stay });

  if (placeId !== null) {
    const placed = items[indexOf(placeId)];
    const index = placeFixedItem({ ...scheduleInput, items, itemId: placeId });
    items = items.filter((item) => item.id !== placeId);
    items.splice(index, 0, placed);
  }

  const after = scheduleDay({ ...scheduleInput, items });

  // Story 13.2: a row pushed past 23:59 is not refused. Its `null` times are a change like any other, so it
  // lands in `changes` (and the receipt's `movedItems`) with its previous times, and undo restores it.

  const stored = new Map(state.rows.map((row) => [row.id, row]));
  const order: PlannedRow[] = after.rows.map((row, sortOrder) => ({
    id: row.id,
    title: items[sortOrder].title,
    fromTime: row.fromTime,
    toTime: row.toTime,
    sortOrder,
  }));

  let edited: PlannedRow | null = null;
  const changes: PlannedChange[] = [];
  for (const row of order) {
    if (row.id === editedId) {
      edited = row;
      continue;
    }
    const previous = stored.get(row.id)!;
    const normaliseToFlexible = previous.scheduleMode === "FIXED" && !hasValidTimes(previous);
    if (
      previous.fromTime !== row.fromTime ||
      previous.toTime !== row.toTime ||
      previous.sortOrder !== row.sortOrder ||
      normaliseToFlexible
    ) {
      changes.push({
        ...row,
        normaliseToFlexible,
        previous: {
          fromTime: previous.fromTime,
          toTime: previous.toTime,
          sortOrder: previous.sortOrder,
          updatedAt: previous.updatedAt,
        },
      });
    }
  }

  const beforeConflicts = new Map(before.conflicts.map((conflict) => [conflict.itemId, conflict]));
  const newConflicts = after.conflicts.filter((conflict) => {
    const previous = beforeConflicts.get(conflict.itemId);
    return !previous || conflict.lateMinutes > previous.lateMinutes;
  });

  return { order, edited, changes, newConflicts };
};

/**
 * Step 4. Writes each change conditionally on the `updatedAt` the plan read, all stamped with the
 * transaction's one `now`. A miss means another write got in between: throw, and the whole change rolls
 * back. Returns one moved row per change, for the receipt.
 */
export const applyScheduleChangesInTransaction = async (
  tx: TransactionClient,
  tripDayId: string,
  changes: PlannedChange[],
  now: Date,
): Promise<MovedItemRow[]> => {
  const movedItems: MovedItemRow[] = [];
  for (const change of changes) {
    const written = await tx.dayPlanItem.updateMany({
      where: { id: change.id, tripDayId, updatedAt: change.previous.updatedAt },
      data: {
        fromTime: change.fromTime,
        toTime: change.toTime,
        sortOrder: change.sortOrder,
        updatedAt: now,
        ...(change.normaliseToFlexible ? { scheduleMode: "FLEXIBLE" as const } : {}),
      },
    });
    if (written.count !== 1) throw new DayPlanChangedError();
    movedItems.push({
      itemId: change.id,
      previousFromTime: change.previous.fromTime,
      previousToTime: change.previous.toTime,
      previousSortOrder: change.previous.sortOrder,
      fromTime: change.fromTime,
      toTime: change.toTime,
      previousUpdatedAt: change.previous.updatedAt,
      updatedAt: now,
    });
  }
  return movedItems;
};

/** The receipt's conflicts, from the plan's. `lateMinutes` stays out: the receipt schema is strict v3. */
export const toPlanConflicts = (conflicts: ScheduleConflict[]): DayChangePlanConflict[] =>
  conflicts.map(({ itemId, title, fromTime, reachableAt }) => ({ itemId, title, fromTime, reachableAt }));
