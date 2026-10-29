import { prisma } from "@/lib/db/prisma";
import { deleteDayPlanItemInTransaction, scheduleFieldsOf } from "@/lib/repositories/dayPlanItemRepo";
import {
  applyScheduleChangesInTransaction,
  buildReceipt,
  DayPlanChangedError,
  planDaySchedule,
  readScheduleInputInTransaction,
  toPlanConflicts,
} from "@/lib/repositories/dayScheduleTransaction";
import {
  buildSegmentTimelineInTransaction,
  readDrawnSegmentKeysInTransaction,
  sweepNoLongerDrawnSegmentsInTransaction,
  toPrismaTransportType,
  type TransactionClient,
} from "@/lib/repositories/travelSegmentRepo";
import type { GeoPoint } from "@/lib/geo/distance";
import type {
  DayChangeReceipt,
  DayPlanApplyMode,
  DeletedDayPlanItemSnapshot,
  TravelSegmentRow,
} from "@/lib/trips/dayChangeReceipt";
import { compareDayPlanItemsByOrder } from "@/lib/trips/dayPlanItemOrder";
import type { ScheduleItem, ScheduleLeg, ScheduleMode } from "@/lib/trips/daySchedule";
import { buildDaySegmentPairKey, buildDrawnDaySegmentPairKeys } from "@/lib/trips/daySegmentPairs";
import type { TransportType } from "@/lib/trips/transportTypes";
import { aiChangedAtFor, type InTransactionHook, type WriteOrigin } from "@/lib/trips/writeOrigin";

/**
 * Story 15.5. The connector's `apply_day_plan`: a whole day written in one transaction, recorded as one
 * `dayPlanApplied` receipt that undoes it in one step.
 *
 * The model is `daySuggestionApplyRepo.ts` (Story 12.4/13.4), with three differences:
 *
 * - **Replace.** In `replace` mode the day's activities are deleted first, each through
 *   `deleteDayPlanItemInTransaction` (the app's delete): it takes the legs naming the activity and sweeps
 *   the ones its absence un-draws, and snapshots the activity with its payments, images and documents for
 *   undo. The files stay on disk (DW-187), so the recreated rows find them.
 * - **Fixed activities.** The plan goes through `planDaySchedule`'s `append` edit, which since 15.5 places a
 *   FIXED activity by its start as it is added, so the order is that of N single creates, recomputed once.
 *   A FIXED activity's schedule fields are `scheduleFieldsOf`'s, the single create's rule.
 * - **Legs.** Any transport mode, with the duration and distance the tool resolved (routing ran before the
 *   transaction, which never holds network I/O). The first leg leaves from the day's last activity, or on an
 *   empty day (always after a replace) from last night's stay; the tool routed from the entry it read, and
 *   passes its id, and a day that changed under it is `DayPlanChangedError`. A leg is created only where the
 *   final timeline draws its pair (a fixed activity placed by time may have split the pair); the others are
 *   returned as skipped. No leg goes to tonight's stay.
 *
 * The transaction, under the writer clause on the day: the deletes, the schedule read, the plan, the drawn
 * keys, the creates (with their payments), the recompute of every other row, the sweep, the drawn legs, the
 * receipt, and the caller's hook last, so the `ai_changes` row commits with the write or not at all.
 */

/** The writer clause of `findTripDayForTripWriter`, so a viewer gets nothing to plan from or write to. */
const writerTrip = (userId: string) => ({ OR: [{ userId }, { members: { some: { userId, role: "CONTRIBUTOR" as const } } }] });

const pointOf = (lat: number | null, lng: number | null): GeoPoint | null =>
  lat !== null && lng !== null ? { lat, lng } : null;

export type DayPlanContext = {
  tripDayId: string;
  /** The day's date: a cost's one payment is due on it. */
  date: Date;
  /** The day's last activity in its order, timed or not: where an `append`'s first leg leaves from. */
  lastItem: { id: string; point: GeoPoint | null } | null;
  /** Last night's stay (the nearest lower `dayIndex`, the schedule's rule): the first leg's start otherwise. */
  previousStay: { id: string; point: GeoPoint | null } | null;
};

/**
 * The day as the tool plans from it, through the writer clause; `null` when the day is not on a trip the
 * user may write. Read before the transaction, for validation and routing.
 */
export const readDayPlanContextForWriter = async (params: {
  userId: string;
  tripId: string;
  tripDayId: string;
}): Promise<DayPlanContext | null> => {
  const { userId, tripId, tripDayId } = params;
  const day = await prisma.tripDay.findFirst({
    where: { id: tripDayId, tripId, trip: writerTrip(userId) },
    select: {
      id: true,
      date: true,
      dayIndex: true,
      dayPlanItems: {
        select: { id: true, fromTime: true, toTime: true, createdAt: true, sortOrder: true, locationLat: true, locationLng: true },
      },
    },
  });
  if (!day) return null;

  const previousDay = await prisma.tripDay.findFirst({
    where: { tripId, dayIndex: { lt: day.dayIndex } },
    orderBy: [{ dayIndex: "desc" }, { date: "desc" }],
    select: { accommodation: { select: { id: true, locationLat: true, locationLng: true } } },
  });
  const stay = previousDay?.accommodation ?? null;
  const last = [...day.dayPlanItems].sort(compareDayPlanItemsByOrder).at(-1) ?? null;

  return {
    tripDayId: day.id,
    date: day.date,
    lastItem: last ? { id: last.id, point: pointOf(last.locationLat, last.locationLng) } : null,
    previousStay: stay ? { id: stay.id, point: pointOf(stay.locationLat, stay.locationLng) } : null,
  };
};

/** One activity of the plan, validated by the tool (`dayPlanItemMutationSchema`). */
export type DayPlanActivityInput = {
  title: string;
  contentJson: string;
  scheduleMode: ScheduleMode;
  durationMinutes: number | null;
  fromTime: string | null;
  toTime: string | null;
  location: { lat: number; lng: number; label: string | null } | null;
  linkUrl: string | null;
  /** EUR only (Story 15.5); with exactly the payments that sum to it, or both `null`. */
  costCents: number | null;
  payments: { amountCents: number; dueDate: string }[] | null;
};

/** A leg the tool resolved: into activity `toIndex` (0-based) from the entry before it. */
export type DayPlanLegInput = {
  toIndex: number;
  transportType: TransportType;
  durationMinutes: number;
  distanceKm: number | null;
  linkUrl: string | null;
};

export type DayPlanApplyResult = {
  receipt: DayChangeReceipt;
  /** The created activities, in input order. */
  itemIds: string[];
  deletedCount: number;
  legsCreated: number;
  /** The legs the final timeline does not draw, by their `toIndex`. */
  skippedLegs: { toIndex: number; reason: "not_drawn" }[];
};

export type ApplyDayPlanParams = {
  userId: string;
  tripId: string;
  tripDayId: string;
  mode: DayPlanApplyMode;
  /** 1..50, in input order. */
  activities: DayPlanActivityInput[];
  legs: DayPlanLegInput[];
  /**
   * The entry the tool routed the first leg from (the day's last activity, or last night's stay), `null`
   * when there was none. Checked only when `legs` has one into the first activity.
   */
  firstLegFromId: string | null;
  /** Marks (or leaves unmarked) every activity and leg the plan creates. */
  origin: WriteOrigin;
  /** Runs last inside the transaction, with the receipt and the first created activity's id. */
  inTransaction?: InTransactionHook;
};

/** 50 creates with payments, up to 50 deletes with their sweeps, 50 legs: well past Prisma's 5 s default. */
const APPLY_TRANSACTION_TIMEOUT_MS = 30000;

/** A stand-in id for plan activity `index`; no stored row or leg can carry one. */
const standInId = (index: number) => `\u0000plan:${index}`;

/** `null` when the day is not on the trip or the user cannot write to it. */
export const applyDayPlanForTripDay = async (params: ApplyDayPlanParams): Promise<DayPlanApplyResult | null> => {
  const { userId, tripId, tripDayId, mode, activities, legs, firstLegFromId } = params;

  return prisma.$transaction(
    async (tx: TransactionClient): Promise<DayPlanApplyResult | null> => {
      const day = await tx.tripDay.findFirst({
        where: { id: tripDayId, tripId, trip: writerTrip(userId) },
        select: { id: true },
      });
      if (!day) return null;

      // 1. Replace: the day's activities go through the app's own delete, each snapshotted for undo.
      const deletedItems: DeletedDayPlanItemSnapshot[] = [];
      const removedLegs = new Map<string, TravelSegmentRow>();
      if (mode === "replace") {
        const existing = await tx.dayPlanItem.findMany({ where: { tripDayId }, select: { id: true } });
        for (const { id } of existing) {
          const deleted = await deleteDayPlanItemInTransaction(tx, { tripId, tripDayId, itemId: id });
          if (deleted.status !== "deleted") throw new DayPlanChangedError();
          deletedItems.push(deleted.previous);
          for (const leg of deleted.removedTravelSegments) removedLegs.set(leg.id, leg);
        }
      }

      // 2. The day as it now stands, and where the first leg leaves from.
      const state = await readScheduleInputInTransaction(tx, tripId, tripDayId);
      if (!state) return null;
      const lastRow = state.rows.at(-1) ?? null;
      const firstFrom = lastRow
        ? { type: "dayPlanItem" as const, id: lastRow.id }
        : state.previousStay
          ? { type: "accommodation" as const, id: state.previousStay.id }
          : null;
      if (legs.some((leg) => leg.toIndex === 0) && (firstFrom?.id ?? null) !== firstLegFromId) {
        throw new DayPlanChangedError();
      }

      // 3. One plan: each activity added as a single create would add it, the legs winning their pairs.
      const fields = activities.map((activity) => scheduleFieldsOf(activity));
      const items: ScheduleItem[] = activities.map((activity, index) => ({
        id: standInId(index),
        title: activity.title,
        ...fields[index],
      }));
      const planLegs: ScheduleLeg[] = [];
      for (const leg of legs) {
        const fromKey = leg.toIndex === 0 ? (firstFrom?.id ?? null) : standInId(leg.toIndex - 1);
        if (fromKey === null) continue;
        planLegs.push({ fromKey, toKey: standInId(leg.toIndex), durationMinutes: leg.durationMinutes });
      }
      const plan = planDaySchedule(state, { kind: "append", items, legs: planLegs });
      const planned = new Map(plan.appended.map((row) => [row.id, row]));

      const now = new Date();
      const aiChangedAt = aiChangedAtFor(params.origin, now);
      const drawnBefore = await readDrawnSegmentKeysInTransaction(tx, tripId, tripDayId);

      // 4. The rows, each a millisecond after the last: the order is `sortOrder`, the creation order stays readable.
      const base = now.getTime();
      const created: { id: string; updatedAt: Date }[] = [];
      for (const [index, activity] of activities.entries()) {
        const row = planned.get(standInId(index))!;
        const item = await tx.dayPlanItem.create({
          data: {
            tripId,
            tripDayId,
            title: activity.title,
            fromTime: row.fromTime,
            toTime: row.toTime,
            scheduleMode: fields[index].scheduleMode,
            durationMinutes: fields[index].durationMinutes,
            sortOrder: row.sortOrder,
            contentJson: activity.contentJson,
            costCents: activity.costCents,
            linkUrl: activity.linkUrl,
            locationLat: activity.location?.lat ?? null,
            locationLng: activity.location?.lng ?? null,
            locationLabel: activity.location?.label?.trim() || null,
            createdAt: new Date(base + index),
            aiChangedAt,
          },
          select: { id: true, updatedAt: true },
        });
        if (activity.payments && activity.payments.length > 0) {
          await tx.costPayment.createMany({
            data: activity.payments.map((payment, position) => ({
              dayPlanItemId: item.id,
              amountCents: payment.amountCents,
              dueDate: payment.dueDate,
              sortOrder: position,
            })),
          });
        }
        created.push(item);
      }

      // 5. Every other row whose times or order the plan changed, then the legs the new order un-drew.
      const movedItems = await applyScheduleChangesInTransaction(tx, tripDayId, plan.changes, now);
      const swept = await sweepNoLongerDrawnSegmentsInTransaction(tx, { tripId, tripDayId, drawnBefore });
      for (const leg of swept) if (!removedLegs.has(leg.id)) removedLegs.set(leg.id, leg);

      // 6. Each leg only where the final timeline draws its pair.
      const timeline = (await buildSegmentTimelineInTransaction(tx, tripId, tripDayId)) ?? [];
      const drawnAfter = buildDrawnDaySegmentPairKeys(timeline);
      const segments: { segmentId: string; updatedAt: Date }[] = [];
      const skippedLegs: DayPlanApplyResult["skippedLegs"] = [];
      for (const leg of legs) {
        const from = leg.toIndex === 0 ? firstFrom : { type: "dayPlanItem" as const, id: created[leg.toIndex - 1].id };
        const to = created[leg.toIndex];
        if (!from || !drawnAfter.has(buildDaySegmentPairKey(from.type, from.id, "dayPlanItem", to.id))) {
          skippedLegs.push({ toIndex: leg.toIndex, reason: "not_drawn" });
          continue;
        }
        const segment = await tx.travelSegment.create({
          data: {
            tripDayId,
            fromItemType: from.type === "accommodation" ? "ACCOMMODATION" : "DAY_PLAN_ITEM",
            fromItemId: from.id,
            toItemType: "DAY_PLAN_ITEM",
            toItemId: to.id,
            transportType: toPrismaTransportType(leg.transportType),
            durationMinutes: leg.durationMinutes,
            distanceKm: leg.distanceKm,
            linkUrl: leg.linkUrl,
            aiChangedAt,
          },
          select: { id: true, updatedAt: true },
        });
        segments.push({ segmentId: segment.id, updatedAt: segment.updatedAt });
      }

      // 7. The receipt, the conflicts naming the created rows instead of their stand-ins, and the hook last.
      const createdIdOf = new Map(created.map((item, index) => [standInId(index), item.id]));
      const receipt = buildReceipt(
        tripDayId,
        {
          kind: "dayPlanApplied",
          mode,
          items: created.map((item) => ({ itemId: item.id, updatedAt: item.updatedAt })),
          segments,
          deletedItems,
        },
        [...removedLegs.values()],
        movedItems,
        {
          planConflicts: toPlanConflicts(plan.newConflicts).map((conflict) => ({
            ...conflict,
            itemId: createdIdOf.get(conflict.itemId) ?? conflict.itemId,
          })),
        },
      );
      if (params.inTransaction) await params.inTransaction(tx, { receipt, itemId: created[0].id });

      return {
        receipt,
        itemIds: created.map((item) => item.id),
        deletedCount: deletedItems.length,
        legsCreated: segments.length,
        skippedLegs,
      };
    },
    { timeout: APPLY_TRANSACTION_TIMEOUT_MS },
  );
};
