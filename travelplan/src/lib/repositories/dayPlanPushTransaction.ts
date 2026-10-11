import type { TransactionClient } from "@/lib/repositories/travelSegmentRepo";
import type {
  DayChangeCheckInWarning,
  DayChangeEdited,
  DayChangeReceipt,
  MovedItemRow,
  TravelSegmentRow,
  TripBucketListItemRow,
} from "@/lib/trips/dayChangeReceipt";
import {
  activityEndMinutes,
  planDayPushFrom,
  timeToMinutes,
  type PushItem,
  type PushLeg,
  type PushMove,
  type PushStart,
} from "@/lib/trips/dayPlanPush";

/**
 * Story 11.4. The transaction half of the push rule, shared by every write that can push a day: the
 * activity writes (`dayPlanItemRepo.ts`, Stories 11.2 and 11.3), the leg writes (`travelSegmentRepo.ts`)
 * and the stay update (`accommodationRepo.ts`).
 *
 * These helpers were private to `dayPlanItemRepo.ts` until 11.4 needed them from the other two. They
 * moved here unchanged rather than being imported from there, because `dayPlanItemRepo.ts` imports
 * `travelSegmentRepo.ts` and the reverse import would be a cycle. This module imports
 * `travelSegmentRepo.ts` for its transaction type only. `dayPlanItemRepo.ts` re-exports
 * `DayPlanChangedError` and `DayPlanPushRefusal`, so every existing import stays valid.
 */

/**
 * Story 11.2. The push rule's two refusals (`dayPlanPush.ts`), decided before the first write of the
 * transaction, so a refused change writes nothing: no row, no swept leg, no consumed idea.
 */
export type DayPlanPushRefusal =
  | { status: "before_predecessor"; predecessor: { id: string; title: string | null; fromTime: string } }
  | { status: "past_midnight"; item: { id: string; title: string | null } };

/**
 * Story 11.2. A pushed activity changed between the transaction's read and its conditional write: another
 * write slipped in. Thrown inside the transaction so all of it rolls back; the route maps it to
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
  extras: { consumedBucketListItem?: TripBucketListItemRow; checkInWarning?: DayChangeCheckInWarning } = {},
): DayChangeReceipt => ({
  version: 2,
  tripDayId,
  edited,
  removedTravelSegments,
  movedItems,
  ...(extras.consumedBucketListItem ? { consumedBucketListItem: extras.consumedBucketListItem } : {}),
  ...(extras.checkInWarning ? { checkInWarning: extras.checkInWarning } : {}),
});

export type PlannedPush = {
  order: PushItem[];
  moves: PushMove[];
  /** The `updatedAt` each row had when the plan was read: the condition its move is written under. */
  readUpdatedAt: Map<string, Date>;
};

/**
 * The day's activities (with the `updatedAt` each move is written under) and its activity-to-activity
 * legs, read through `tx`: the walk's whole input. Shared by the push (Story 11.2), the reorder (11.3) and
 * the leg and check-out saves (11.4, which need each leg's `id` to plan with a leg as it will be).
 */
export const readPushInputInTransaction = (tx: TransactionClient, tripDayId: string) =>
  Promise.all([
    tx.dayPlanItem.findMany({
      where: { tripDayId },
      select: { id: true, title: true, fromTime: true, toTime: true, createdAt: true, updatedAt: true },
    }),
    tx.travelSegment.findMany({
      where: { tripDayId, fromItemType: "DAY_PLAN_ITEM", toItemType: "DAY_PLAN_ITEM" },
      select: { id: true, fromItemId: true, toItemId: true, durationMinutes: true },
    }),
  ]);

/**
 * Writes each move conditionally on the `updatedAt` the plan read, all stamped with the transaction's
 * one `now`. A miss means another write got in between: throw, and the whole change rolls back.
 */
export const applyPushMovesInTransaction = async (
  tx: TransactionClient,
  tripDayId: string,
  planned: PlannedPush,
  now: Date,
): Promise<MovedItemRow[]> => {
  const movedItems: MovedItemRow[] = [];
  for (const move of planned.moves) {
    const previousUpdatedAt = planned.readUpdatedAt.get(move.itemId);
    if (!previousUpdatedAt) throw new DayPlanChangedError();
    const written = await tx.dayPlanItem.updateMany({
      where: { id: move.itemId, tripDayId, updatedAt: previousUpdatedAt },
      data: { fromTime: move.fromTime, toTime: move.toTime, updatedAt: now },
    });
    if (written.count !== 1) throw new DayPlanChangedError();
    movedItems.push({
      itemId: move.itemId,
      previousFromTime: move.previousFromTime,
      previousToTime: move.previousToTime,
      previousUpdatedAt,
      updatedAt: now,
    });
  }
  return movedItems;
};

/**
 * Story 11.2 AC9. Only after a change that moved something, and only against an explicit check-in: the
 * 16:00 default lives in the client and never warns. The last timed activity's end, plus the stored leg
 * from it to the night's stay when that leg is drawn (the activity is the day's last, with no untimed
 * one after it), compared in plain minutes; the sum may pass midnight and is never formatted.
 */
export const findCheckInWarningInTransaction = async (
  tx: TransactionClient,
  tripDayId: string,
  planned: PlannedPush,
): Promise<DayChangeCheckInWarning | undefined> => {
  if (planned.moves.length === 0) return undefined;

  const day = await tx.tripDay.findUnique({
    where: { id: tripDayId },
    select: { accommodation: { select: { id: true, checkInTime: true } } },
  });
  const stay = day?.accommodation;
  const checkInTime = stay?.checkInTime?.trim();
  if (!stay || !checkInTime) return undefined;
  const checkInMinutes = timeToMinutes(checkInTime);
  if (checkInMinutes === null) return undefined;

  const timed = planned.order.filter((item) => Boolean(item.fromTime));
  const last = timed.at(-1);
  if (!last) return undefined;
  const lastEnd = activityEndMinutes(last);
  if (lastEnd === null) return undefined;

  let arrival = lastEnd;
  if (planned.order.at(-1) === last) {
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

/**
 * Story 11.4. Plans a push that starts at something other than an edited activity (`planDayPushFrom`):
 * a leg save, or a later check-out of last night's stay. Reads through `tx` before the transaction's first
 * write, so a refusal leaves nothing to roll back.
 *
 * `legOverride` is the leg as it will be after the write: the stored row `replaceSegmentId` is left out
 * (a leg update), and `leg`, when the new leg joins two activities, is put first so it wins over any
 * stored row for the same pair.
 */
export const planPushFromInTransaction = async (
  tx: TransactionClient,
  tripDayId: string,
  start: PushStart,
  legOverride?: { replaceSegmentId?: string; leg?: PushLeg },
): Promise<PlannedPush | { status: "past_midnight"; item: { id: string; title: string | null } }> => {
  const [items, storedLegs] = await readPushInputInTransaction(tx, tripDayId);
  const legs: PushLeg[] = [
    ...(legOverride?.leg ? [legOverride.leg] : []),
    ...storedLegs.filter((leg) => leg.id !== legOverride?.replaceSegmentId),
  ];

  const plan = planDayPushFrom({ items, legs, start });
  if (plan.status === "past_midnight") return plan;
  if (plan.status !== "ok") throw new Error("planDayPushFrom refused on order, which it never does");
  return {
    order: plan.order,
    moves: plan.moves,
    readUpdatedAt: new Map(items.map((item) => [item.id, item.updatedAt])),
  };
};
