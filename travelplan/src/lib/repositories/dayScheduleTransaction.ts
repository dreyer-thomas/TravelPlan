import type { TransactionClient } from "@/lib/repositories/travelSegmentRepo";
import type {
  DayChangeCheckInWarning,
  DayChangeEdited,
  DayChangePlanConflict,
  DayChangeReceipt,
  MovedItemRow,
  TravelSegmentRow,
} from "@/lib/trips/dayChangeReceipt";
import { compareDayPlanItemsByOrder } from "@/lib/trips/dayPlanItemOrder";
import {
  activityEndMinutes,
  hasValidTimes,
  placeFixedItem,
  scheduleDay,
  timeToMinutes,
  type ScheduleConflict,
  type ScheduleItem,
  type ScheduleLeg,
} from "@/lib/trips/daySchedule";
import { resolveDayStartMinute } from "@/lib/trips/stayTimes";

/**
 * Story 13.1 (FR42). The transaction half of the schedule rule, shared by every write that can change a
 * day's times or order: the activity writes (`dayPlanItemRepo.ts`), the leg writes (`travelSegmentRepo.ts`)
 * and last night's check-out (`accommodationRepo.ts`). It replaces Story 11.4's `dayPlanPushTransaction.ts`.
 *
 * Each write keeps the shape Epic 11 gave it, inside one `prisma.$transaction`:
 *
 * 1. `readScheduleInputInTransaction`: the day's rows in order, last night's stay, the day's legs.
 * 2. `planDaySchedule` (pure): apply the edit to the in-memory day, place a fixed row by its time if it
 *    needs placing, schedule the day **before** and **after**, and decide the one refusal
 *    (`past_midnight`) *before the first write*, as Story 11.2 §7 requires.
 * 3. The write itself.
 * 4. `applyScheduleChangesInTransaction`: every other row whose times or `sortOrder` changed, each
 *    conditional on the `updatedAt` step 1 read (`DayPlanChangedError` rolls the whole change back).
 * 5. 11.1's sweep, the check-in warning, and `buildReceipt`.
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

/**
 * The one refusal the schedule rule still has until Story 13.2 (Story 13.1 §7): a write would leave a
 * flexible activity that fitted, or the one being created, without room before 23:59.
 */
export type DaySchedulePastMidnight = { status: "past_midnight"; item: { id: string; title: string | null } };

export const buildReceipt = (
  tripDayId: string,
  edited: DayChangeEdited,
  removedTravelSegments: TravelSegmentRow[],
  movedItems: MovedItemRow[],
  extras: {
    checkInWarning?: DayChangeCheckInWarning;
    planConflicts?: DayChangePlanConflict[];
  } = {},
): DayChangeReceipt => ({
  version: 3,
  tripDayId,
  edited,
  removedTravelSegments,
  movedItems,
  ...(extras.checkInWarning ? { checkInWarning: extras.checkInWarning } : {}),
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
    legs: day.travelSegments.map((segment) => ({
      id: segment.id,
      fromKey: segment.fromItemId,
      toKey: segment.toItemId,
      durationMinutes: segment.durationMinutes,
    })),
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

export type DaySchedulePlan =
  | {
      status: "ok";
      /** The day after the write, in order, with the computed times. */
      order: PlannedRow[];
      /** The inserted or updated row as it will be written; `null` for every other edit. */
      edited: PlannedRow | null;
      changes: PlannedChange[];
      /** Conflicts this write made: new ones, or reached later than before (§15). */
      newConflicts: ScheduleConflict[];
    }
  | DaySchedulePastMidnight;

const asScheduleItem = (row: ScheduleItem): ScheduleItem => ({
  id: row.id,
  title: row.title,
  scheduleMode: row.scheduleMode,
  durationMinutes: row.durationMinutes,
  fromTime: row.fromTime,
  toTime: row.toTime,
});

/**
 * Step 2, pure. Throws when the edit names a row that is not on the day; the repositories check first.
 */
export const planDaySchedule = (state: ScheduleDayState, edit: ScheduleEdit): DaySchedulePlan => {
  const beforeItems = state.rows.map(asScheduleItem);
  const beforeStay = state.previousStay;
  const before = scheduleDay({
    dayStartMinute: resolveDayStartMinute(beforeStay),
    previousStayId: beforeStay?.id ?? null,
    items: beforeItems,
    legs: state.legs,
  });

  let items = [...beforeItems];
  let legs: ScheduleLeg[] = state.legs;
  let stay = beforeStay;
  let editedId: string | null = null;
  let createdId: string | null = null;
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
      editedId = createdId = edit.item.id;
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

  const scheduleInput = {
    dayStartMinute: resolveDayStartMinute(stay),
    previousStayId: stay?.id ?? null,
    legs,
  };

  if (placeId !== null) {
    const placed = items[indexOf(placeId)];
    const index = placeFixedItem({ ...scheduleInput, items, itemId: placeId });
    items = items.filter((item) => item.id !== placeId);
    items.splice(index, 0, placed);
  }

  const after = scheduleDay({ ...scheduleInput, items });

  // §7: only a *new* overflow refuses. A row that did not fit before stays untimed and never blocks.
  const beforeTimes = new Map(before.rows.map((row) => [row.id, row]));
  for (const id of after.overflow) {
    const hadTimes = beforeTimes.get(id)?.fromTime != null;
    if (id === createdId || hadTimes) {
      const item = items.find((entry) => entry.id === id)!;
      return { status: "past_midnight", item: { id, title: item.title } };
    }
  }

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
    return !previous || timeToMinutes(conflict.reachableAt)! > timeToMinutes(previous.reachableAt)!;
  });

  return { status: "ok", order, edited, changes, newConflicts };
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

/** The receipt's conflicts, from the plan's. */
export const toPlanConflicts = (conflicts: ScheduleConflict[]): DayChangePlanConflict[] =>
  conflicts.map((conflict) => ({ ...conflict }));

/** `true` when the write moved some other row's times (a renumbering alone moves nothing visible). */
export const movedAnyTimes = (movedItems: MovedItemRow[]) =>
  movedItems.some((row) => row.previousFromTime !== row.fromTime || row.previousToTime !== row.toTime);

/**
 * Story 11.2 AC9, kept until Story 13.2 removes it. Only after a change that moved some row's times, and
 * only against an explicit check-in: the 16:00 default lives in the client and never warns. The last timed
 * activity's end, plus the stored leg from it to the night's stay when that leg is drawn (the activity is
 * the day's last), compared in plain minutes; the sum may pass midnight and is never formatted.
 */
export const findCheckInWarningForOrderInTransaction = async (
  tx: TransactionClient,
  tripDayId: string,
  order: Array<{ id: string; fromTime: string | null; toTime: string | null }>,
): Promise<DayChangeCheckInWarning | undefined> => {
  const day = await tx.tripDay.findUnique({
    where: { id: tripDayId },
    select: { accommodation: { select: { id: true, checkInTime: true } } },
  });
  const stay = day?.accommodation;
  const checkInTime = stay?.checkInTime?.trim();
  if (!stay || !checkInTime) return undefined;
  const checkInMinutes = timeToMinutes(checkInTime);
  if (checkInMinutes === null) return undefined;

  const timed = order.filter((item) => Boolean(item.fromTime));
  const last = timed.at(-1);
  if (!last) return undefined;
  const lastEnd = activityEndMinutes(last);
  if (lastEnd === null) return undefined;

  let arrival = lastEnd;
  if (order.at(-1) === last) {
    const legToStay = await tx.travelSegment.findFirst({
      where: {
        tripDayId,
        fromItemType: "DAY_PLAN_ITEM",
        fromItemId: last.id,
        toItemType: "ACCOMMODATION",
        toItemId: stay.id,
      },
      select: { durationMinutes: true },
    });
    arrival += legToStay?.durationMinutes ?? 0;
  }

  return arrival > checkInMinutes ? { accommodationId: stay.id, checkInTime } : undefined;
};

/** The check-in warning for a planned write: only when it moved some row's times, as before 13.1. */
export const findCheckInWarningInTransaction = async (
  tx: TransactionClient,
  tripDayId: string,
  order: PlannedRow[],
  movedItems: MovedItemRow[],
): Promise<DayChangeCheckInWarning | undefined> =>
  movedAnyTimes(movedItems) ? findCheckInWarningForOrderInTransaction(tx, tripDayId, order) : undefined;
