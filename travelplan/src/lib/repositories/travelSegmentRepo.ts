import { prisma } from "@/lib/db/prisma";
import type { TravelSegmentItemType, TravelTransportType } from "@/generated/prisma/enums";
import type { TravelSegment } from "@/generated/prisma/client";
// Story 8.5: the adjacency rule below used to sort with a private copy of this comparator, while the
// screen that draws the same day's legs read the API's `createdAt` order. Two orders, one of which
// decides what the server accepts and the other what the user sees. Now one module owns the rule and
// `TripDayView.tsx` imports the same function — see `dayPlanItemOrder.ts` for why that mattered.
import { compareDayPlanItemsByOrder } from "@/lib/trips/dayPlanItemOrder";
import {
  buildDaySegmentPairKey,
  buildDrawnDaySegmentPairKeys,
  type DaySegmentEndpointType,
} from "@/lib/trips/daySegmentPairs";
import type { TransportType } from "@/lib/trips/transportTypes";
import {
  applyScheduleChangesInTransaction,
  buildReceipt,
  planDaySchedule,
  readScheduleInputInTransaction,
  toPlanConflicts,
  type ScheduleEdit,
} from "@/lib/repositories/dayScheduleTransaction";
import type { DayChangeEdited, DayChangeReceipt } from "@/lib/trips/dayChangeReceipt";
import { aiChangedAtFor, type WriteOrigin } from "@/lib/trips/writeOrigin";

/**
 * Declared per repository, as `dayPlanItemRepo.ts` and `bucketListRepo.ts` do. There is no shared
 * repository module in this project and inventing one to hold a four-word type alias would be a
 * larger change than the one Story 8.5 is making.
 */
export type TransactionClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Lowercase wire vocabulary for `TravelTransportType`, mirroring `TravelSegmentItemTypeInput`. */
export type TransportTypeInput = TransportType;

export type TravelSegmentDetail = {
  id: string;
  tripDayId: string;
  fromItemType: "accommodation" | "dayPlanItem";
  fromItemId: string;
  toItemType: "accommodation" | "dayPlanItem";
  toItemId: string;
  transportType: TransportTypeInput;
  durationMinutes: number;
  distanceKm: number | null;
  linkUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type TravelSegmentUpdateResult =
  | { status: "not_found" }
  | { status: "missing" }
  | { status: "not_adjacent" }
  | { status: "updated"; segment: TravelSegmentDetail; receipt: DayChangeReceipt };

export type TravelSegmentDeleteResult =
  | { status: "not_found" }
  | { status: "missing" }
  /** Story 13.1: a leg delete recomputes the day, so it returns a receipt like the other leg saves. */
  | { status: "deleted"; receipt: DayChangeReceipt };

export type TravelSegmentCreateResult =
  | { status: "not_found" }
  | { status: "missing" }
  | { status: "not_adjacent" }
  | { status: "created"; segment: TravelSegmentDetail; receipt: DayChangeReceipt };

type TravelSegmentItemTypeInput = "accommodation" | "dayPlanItem";

type TravelSegmentMutationParams = {
  userId: string;
  tripId: string;
  tripDayId: string;
  fromItemType: TravelSegmentItemTypeInput;
  fromItemId: string;
  toItemType: TravelSegmentItemTypeInput;
  toItemId: string;
  transportType: TransportTypeInput;
  durationMinutes: number;
  distanceKm?: number | null;
  linkUrl?: string | null;
  /** Story 15.4. `"ai"` marks the leg, `"user"` clears the mark. */
  origin: WriteOrigin;
};

type TravelSegmentUpdateParams = TravelSegmentMutationParams & { segmentId: string };

type TravelSegmentDeleteParams = {
  userId: string;
  tripId: string;
  tripDayId: string;
  segmentId: string;
};

type SegmentTimelineItem = {
  id: string;
  type: TravelSegmentItemTypeInput;
};

const toPrismaItemType = (value: TravelSegmentItemTypeInput): TravelSegmentItemType =>
  value === "accommodation" ? "ACCOMMODATION" : "DAY_PLAN_ITEM";

// Both directions are exhaustive rather than `default`-terminated: a `default` here would have
// quietly stored every mode added after FLIGHT *as* FLIGHT. Story 6.16 added two, so the compiler
// has to be the one that notices the next one. Story 15.5: exported for the connector's day plan, which
// creates its legs in its own transaction (`dayPlanApplyRepo.ts`).
export const toPrismaTransportType = (value: TransportTypeInput): TravelTransportType => {
  switch (value) {
    case "car":
      return "CAR";
    case "ship":
      return "SHIP";
    case "flight":
      return "FLIGHT";
    case "walking":
      return "WALKING";
    case "cycling":
      return "CYCLING";
    case "train":
      return "TRAIN";
    case "bus":
      return "BUS";
    default: {
      const unhandled: never = value;
      throw new Error(`Unhandled travel transport type: ${String(unhandled)}`);
    }
  }
};

/**
 * Stored discriminator → timeline vocabulary. Exported for Story 11.1: the sweep keys stored rows with
 * it so they match the timeline's keys, and a wrong mapping there would sweep every leg or none.
 */
export const fromPrismaItemType = (value: TravelSegmentItemType): DaySegmentEndpointType =>
  value === "ACCOMMODATION" ? "accommodation" : "dayPlanItem";

const fromPrismaTransportType = (value: TravelTransportType): TransportTypeInput => {
  switch (value) {
    case "CAR":
      return "car";
    case "SHIP":
      return "ship";
    case "FLIGHT":
      return "flight";
    case "WALKING":
      return "walking";
    case "CYCLING":
      return "cycling";
    case "TRAIN":
      return "train";
    case "BUS":
      return "bus";
    default: {
      const unhandled: never = value;
      throw new Error(`Unhandled travel transport type: ${String(unhandled)}`);
    }
  }
};

const toDetail = (segment: {
  id: string;
  tripDayId: string;
  fromItemType: TravelSegmentItemType;
  fromItemId: string;
  toItemType: TravelSegmentItemType;
  toItemId: string;
  transportType: TravelTransportType;
  durationMinutes: number;
  distanceKm: number | null;
  linkUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}): TravelSegmentDetail => ({
  id: segment.id,
  tripDayId: segment.tripDayId,
  fromItemType: fromPrismaItemType(segment.fromItemType),
  fromItemId: segment.fromItemId,
  toItemType: fromPrismaItemType(segment.toItemType),
  toItemId: segment.toItemId,
  transportType: fromPrismaTransportType(segment.transportType),
  durationMinutes: segment.durationMinutes,
  distanceKm: segment.distanceKm,
  linkUrl: segment.linkUrl,
  createdAt: segment.createdAt,
  updatedAt: segment.updatedAt,
});

const findTripDayForUser = async (userId: string, tripId: string, tripDayId: string) =>
  prisma.tripDay.findFirst({
    where: {
      id: tripDayId,
      tripId,
      trip: { userId },
    },
    select: { id: true },
  });

const findTripDayForTripParticipant = async (userId: string, tripId: string, tripDayId: string) =>
  prisma.tripDay.findFirst({
    where: {
      id: tripDayId,
      tripId,
      trip: {
        OR: [{ userId }, { members: { some: { userId } } }],
      },
    },
    select: { id: true },
  });

const findTripDayForTripWriter = async (userId: string, tripId: string, tripDayId: string) =>
  prisma.tripDay.findFirst({
    where: {
      id: tripDayId,
      tripId,
      trip: {
        OR: [{ userId }, { members: { some: { userId, role: "CONTRIBUTOR" } } }],
      },
    },
    select: { id: true },
  });

/**
 * Story 11.1. The endpoint-ordering core of the timeline, through a transaction client so a
 * day-plan write can read the day it is about to change — and the day it has just changed — inside its
 * own `prisma.$transaction`. A read through the global client there would not see the write's own rows.
 *
 * No writer clause: every caller has already passed one. (Story 11.4 removed `buildSegmentTimeline`,
 * the global-client wrapper the adjacency check used: that check now reads through the save's own `tx`.) The order is the one the day view draws: last night's stay (the nearest lower `dayIndex`), the
 * day's activities by `compareDayPlanItemsByOrder` (Story 13.1: `sortOrder`), this night's stay. `null` when the day is not on
 * the trip.
 */
export const buildSegmentTimelineInTransaction = async (
  tx: TransactionClient,
  tripId: string,
  tripDayId: string,
): Promise<SegmentTimelineItem[] | null> => {
  const day = await tx.tripDay.findFirst({
    where: { id: tripDayId, tripId },
    select: {
      id: true,
      dayIndex: true,
      accommodation: { select: { id: true } },
      dayPlanItems: {
        select: { id: true, fromTime: true, createdAt: true, sortOrder: true },
      },
    },
  });

  if (!day) return null;

  const previousDay = await tx.tripDay.findFirst({
    where: {
      tripId,
      dayIndex: { lt: day.dayIndex },
    },
    orderBy: [{ dayIndex: "desc" }, { date: "desc" }],
    select: {
      accommodation: { select: { id: true } },
    },
  });

  const timeline: SegmentTimelineItem[] = [];
  if (previousDay?.accommodation?.id) {
    timeline.push({ id: previousDay.accommodation.id, type: "accommodation" });
  }

  const sortedPlanItems = [...day.dayPlanItems].sort(compareDayPlanItemsByOrder);
  for (const item of sortedPlanItems) {
    timeline.push({ id: item.id, type: "dayPlanItem" });
  }

  if (day.accommodation?.id) {
    timeline.push({ id: day.accommodation.id, type: "accommodation" });
  }

  return timeline;
};

/**
 * Story 11.1. The keys of the pairs a day's timeline draws right now, read through `tx`. The rule itself
 * is `daySegmentPairs.ts`'s, the one the day view and the overview already share — not a fourth copy.
 * An unknown day draws nothing.
 */
export const readDrawnSegmentKeysInTransaction = async (
  tx: TransactionClient,
  tripId: string,
  tripDayId: string,
): Promise<Set<string>> => buildDrawnDaySegmentPairKeys((await buildSegmentTimelineInTransaction(tx, tripId, tripDayId)) ?? []);

/** The pair key of a stored row, in the timeline's vocabulary. */
export const buildStoredSegmentPairKey = (segment: {
  fromItemType: TravelSegmentItemType;
  fromItemId: string;
  toItemType: TravelSegmentItemType;
  toItemId: string;
}) =>
  buildDaySegmentPairKey(
    fromPrismaItemType(segment.fromItemType),
    segment.fromItemId,
    fromPrismaItemType(segment.toItemType),
    segment.toItemId,
  );

/**
 * Story 11.1 AC1, superseding Story 8.5 AC3. Deletes every leg on the day that the change *un-drew*: its
 * pair was consecutive before the change (`drawnBefore`, read by the caller through `tx` before it
 * mutated) and is not consecutive after it. Returns the deleted rows in full, for the change receipt.
 *
 * **A leg that was already undrawn before the change is left alone.** A restored backup, `DW-318`'s other
 * routes or older rows can leave orphans this change did not make; Story 8.5's orphan list is how their
 * owner removes them, and sweeping them here would destroy measurements on the strength of an unrelated
 * edit.
 *
 * Like `removeTravelSegmentsReferencingItemInTransaction`, it never heals: nothing joins the new
 * neighbours, because mode, duration and distance are the user's knowledge (Story 6.23's rule).
 */
export const sweepNoLongerDrawnSegmentsInTransaction = async (
  tx: TransactionClient,
  params: { tripId: string; tripDayId: string; drawnBefore: ReadonlySet<string> },
): Promise<TravelSegment[]> => {
  const { tripId, tripDayId, drawnBefore } = params;
  if (drawnBefore.size === 0) return [];

  const drawnAfter = await readDrawnSegmentKeysInTransaction(tx, tripId, tripDayId);
  const segments = await tx.travelSegment.findMany({
    where: { tripDayId },
    orderBy: { createdAt: "asc" },
  });
  const swept = segments.filter((segment) => {
    const key = buildStoredSegmentPairKey(segment);
    return drawnBefore.has(key) && !drawnAfter.has(key);
  });

  if (swept.length === 0) return [];

  await tx.travelSegment.deleteMany({ where: { id: { in: swept.map((segment) => segment.id) } } });
  return swept;
};

/**
 * Story 8.5's adjacency rule. Story 11.4 reads it through the save's own transaction, so the walk plans
 * against the same day the rule accepted; the writer clause has already run outside, first.
 */
const ensureSegmentItemsExist = async (
  tx: TransactionClient,
  params: TravelSegmentMutationParams,
): Promise<"ok" | "missing" | "not_adjacent"> => {
  const { tripId, tripDayId, fromItemType, fromItemId, toItemType, toItemId } = params;

  const timeline = await buildSegmentTimelineInTransaction(tx, tripId, tripDayId);
  if (!timeline) return "missing";

  const fromIndex = timeline.findIndex((item) => item.id === fromItemId && item.type === fromItemType);
  if (fromIndex < 0) return "missing";
  const toIndex = timeline.findIndex((item) => item.id === toItemId && item.type === toItemType);
  if (toIndex < 0) return "missing";

  if (toIndex !== fromIndex + 1) return "not_adjacent";

  return "ok";
};

/**
 * Story 13.1 (FR42). Every leg save recomputes the day the leg is on, with the leg as it will be after the
 * save: `edit` leaves out the stored row a save replaces or deletes and puts the new value first, so it
 * wins its pair. A shorter leg pulls the day forward now as a longer one pushes it (Story 11.4's "only a
 * longer leg pushes" guard is gone). Planned before the save's first write; it never refuses (13.2).
 * The day is on the trip (the caller checked), so the read always finds it.
 */
const planLegScheduleInTransaction = async (
  tx: TransactionClient,
  params: { tripId: string; tripDayId: string },
  edit: ScheduleEdit,
) => {
  const state = await readScheduleInputInTransaction(tx, params.tripId, params.tripDayId);
  if (!state) throw new Error("planLegScheduleInTransaction: the day is not on the trip");
  return planDaySchedule(state, edit);
};

/** The leg as the schedule reads it after the save. */
const scheduleLegOf = (params: TravelSegmentMutationParams) => ({
  fromKey: params.fromItemId,
  toKey: params.toItemId,
  durationMinutes: params.durationMinutes,
});

/** The moves and the new conflicts of a planned recompute, as the receipt. */
const applyLegScheduleInTransaction = async (
  tx: TransactionClient,
  tripDayId: string,
  plan: Awaited<ReturnType<typeof planLegScheduleInTransaction>>,
  edited: DayChangeEdited,
  now: Date,
): Promise<DayChangeReceipt> => {
  const movedItems = await applyScheduleChangesInTransaction(tx, tripDayId, plan.changes, now);
  // A leg save never changes the order, so 11.1's sweep has nothing to remove (rule 12).
  return buildReceipt(tripDayId, edited, [], movedItems, { planConflicts: toPlanConflicts(plan.newConflicts) });
};

/**
 * Story 6.23, AC4/AC6, generalised by Story 8.5 (`DW-215`). Deletes every travel segment on
 * `tripDayIds` that points at `itemId` **as `itemType`**, and returns the deleted rows in full (Story
 * 11.1: the change receipt carries them so undo can recreate them) — callers that only report ids map
 * them.
 *
 * `TravelSegment` has **no foreign key to either endpoint** — `fromItemId`/`toItemId` are plain
 * strings paired with a `fromItemType`/`toItemType` discriminator, and the only cascade is on
 * `tripDayId`. So an endpoint that leaves a day (moved *or* deleted) leaves its segments behind, and
 * before this helper nothing in the app cleaned them up. They are invisible — `TripDayView` only
 * draws pairs the timeline actually produces — and were counted as "Fahrzeit" forever.
 *
 * It lives here rather than in `dayPlanItemRepo.ts` because `TravelSegmentItemType` has exactly two
 * members and both of them now come through this one function: activities from
 * `deleteDayPlanItemForTripDay` and `parkDayPlanItemForTripDay` (Story 14.4 removed 6.23's single move),
 * accommodations from
 * `deleteAccommodationForTripDay`. `DW-215`'s decision is one helper, not a second near-identical
 * `removeTravelSegmentsReferencingAccommodation`. Fixing only some of those paths would mean the app
 * tidies up after one kind of removal but not another, which is the defect AC6 exists to close.
 *
 * The day ids are the caller's because the two types have different reach: an activity can only be an
 * endpoint on its own day, while `buildSegmentTimelineInTransaction` above offers day N's accommodation as the
 * leading endpoint of day N+1, so the stay path passes the whole trip's days. See the Design Notes in
 * the story spec.
 *
 * It deliberately does **not** heal the chain by joining the removed item's two former
 * neighbours, and does not create anything on the target day: transport mode, duration and distance
 * are the user's knowledge, and a fabricated segment is worse than a visible gap (AC5, Trap 3).
 */
export const removeTravelSegmentsReferencingItemInTransaction = async (
  tx: TransactionClient,
  tripDayIds: string[],
  itemType: TravelSegmentItemType,
  itemId: string,
): Promise<TravelSegment[]> => {
  const segments = await tx.travelSegment.findMany({
    where: {
      tripDayId: { in: tripDayIds },
      OR: [
        { fromItemType: itemType, fromItemId: itemId },
        { toItemType: itemType, toItemId: itemId },
      ],
    },
    orderBy: { createdAt: "asc" },
  });

  if (segments.length === 0) {
    return [];
  }

  await tx.travelSegment.deleteMany({ where: { id: { in: segments.map((segment) => segment.id) } } });
  return segments;
};

export const listTravelSegmentsForTripDay = async (params: {
  userId: string;
  tripId: string;
  tripDayId: string;
}): Promise<TravelSegmentDetail[] | null> => {
  const { userId, tripId, tripDayId } = params;
  const tripDay = await findTripDayForTripParticipant(userId, tripId, tripDayId);
  if (!tripDay) return null;

  const segments = await prisma.travelSegment.findMany({
    where: { tripDayId },
    orderBy: { createdAt: "asc" },
  });

  return segments.map(toDetail);
};

/**
 * Story 11.4, rewired by 13.1: a new leg recomputes its day (`planLegScheduleInTransaction`). Adjacency,
 * plan, write and moves are one transaction; a `not_adjacent` writes nothing, and a `P2002` (the pair already has
 * a leg) still propagates for the route's `409 travel_segment_exists`. The receipt is always returned.
 */
export const createTravelSegmentForTripDay = async (
  params: TravelSegmentMutationParams,
): Promise<TravelSegmentCreateResult> => {
  const { userId, tripId, tripDayId, fromItemType, fromItemId, toItemType, toItemId, transportType } = params;
  const tripDay = await findTripDayForTripWriter(userId, tripId, tripDayId);
  if (!tripDay) return { status: "not_found" };

  return prisma.$transaction(async (tx): Promise<TravelSegmentCreateResult> => {
    const itemStatus = await ensureSegmentItemsExist(tx, params);
    if (itemStatus === "missing") return { status: "missing" };
    if (itemStatus === "not_adjacent") return { status: "not_adjacent" };

    const plan = await planLegScheduleInTransaction(tx, params, { kind: "legs", leg: scheduleLegOf(params) });

    const now = new Date();
    const segment = await tx.travelSegment.create({
      data: {
        tripDayId,
        fromItemType: toPrismaItemType(fromItemType),
        fromItemId,
        toItemType: toPrismaItemType(toItemType),
        toItemId,
        transportType: toPrismaTransportType(transportType),
        durationMinutes: params.durationMinutes,
        distanceKm: params.distanceKm ?? null,
        linkUrl: params.linkUrl ?? null,
        aiChangedAt: aiChangedAtFor(params.origin, now),
      },
    });

    const receipt = await applyLegScheduleInTransaction(
      tx,
      tripDayId,
      plan,
      { kind: "legCreated", segmentId: segment.id, updatedAt: segment.updatedAt },
      now,
    );
    return { status: "created", segment: toDetail(segment), receipt };
  });
};

export const updateTravelSegmentForTripDay = async (
  params: TravelSegmentUpdateParams,
): Promise<TravelSegmentUpdateResult> => {
  const { userId, tripId, tripDayId, segmentId, fromItemType, fromItemId, toItemType, toItemId, transportType } = params;
  const tripDay = await findTripDayForTripWriter(userId, tripId, tripDayId);
  if (!tripDay) return { status: "not_found" };

  return prisma.$transaction(async (tx): Promise<TravelSegmentUpdateResult> => {
    // Inside: it is the receipt's `previous`, and must be the row the write replaces.
    const existing = await tx.travelSegment.findFirst({
      where: { id: segmentId, tripDayId },
    });

    if (!existing) {
      return { status: "missing" };
    }

    const itemStatus = await ensureSegmentItemsExist(tx, params);
    if (itemStatus === "missing") return { status: "missing" };
    if (itemStatus === "not_adjacent") return { status: "not_adjacent" };

    const plan = await planLegScheduleInTransaction(tx, params, {
      kind: "legs",
      removeSegmentId: segmentId,
      leg: scheduleLegOf(params),
    });

    const now = new Date();
    const updated = await tx.travelSegment.update({
      where: { id: segmentId },
      data: {
        fromItemType: toPrismaItemType(fromItemType),
        fromItemId,
        toItemType: toPrismaItemType(toItemType),
        toItemId,
        transportType: toPrismaTransportType(transportType),
        durationMinutes: params.durationMinutes,
        distanceKm: params.distanceKm ?? null,
        linkUrl: params.linkUrl ?? null,
        aiChangedAt: aiChangedAtFor(params.origin, now),
      },
    });

    const receipt = await applyLegScheduleInTransaction(
      tx,
      tripDayId,
      plan,
      { kind: "legUpdated", segmentId, updatedAt: updated.updatedAt, previous: existing },
      now,
    );
    return { status: "updated", segment: toDetail(updated), receipt };
  });
};

export const deleteTravelSegmentForTripDay = async (
  params: TravelSegmentDeleteParams,
): Promise<TravelSegmentDeleteResult> => {
  const { userId, tripId, tripDayId, segmentId } = params;
  const tripDay = await findTripDayForTripWriter(userId, tripId, tripDayId);
  if (!tripDay) return { status: "not_found" };

  // Story 13.1 §8: a leg delete changes the schedule as a shorter leg does, so it gets the other leg
  // saves' shape: one transaction, the recompute planned before the delete, a receipt.
  return prisma.$transaction(async (tx): Promise<TravelSegmentDeleteResult> => {
    const existing = await tx.travelSegment.findFirst({ where: { id: segmentId, tripDayId } });
    if (!existing) return { status: "missing" };

    const plan = await planLegScheduleInTransaction(tx, { tripId, tripDayId }, { kind: "legs", removeSegmentId: segmentId });

    const now = new Date();
    const deleted = await tx.travelSegment.deleteMany({ where: { id: segmentId, tripDayId } });
    if (deleted.count !== 1) return { status: "missing" };

    const receipt = await applyLegScheduleInTransaction(
      tx,
      tripDayId,
      plan,
      { kind: "legDeleted", segmentId, previous: existing },
      now,
    );
    return { status: "deleted", receipt };
  });
};
