import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db/prisma";
import {
  applyScheduleChangesInTransaction,
  buildReceipt,
  DayPlanChangedError,
  planDaySchedule,
  readScheduleInputInTransaction,
  toPlanConflicts,
  type DaySchedulePlan,
  type ScheduleDayState,
} from "@/lib/repositories/dayScheduleTransaction";
import {
  buildSegmentTimelineInTransaction,
  readDrawnSegmentKeysInTransaction,
  sweepNoLongerDrawnSegmentsInTransaction,
  type TransactionClient,
} from "@/lib/repositories/travelSegmentRepo";
import type { DayChangeReceipt } from "@/lib/trips/dayChangeReceipt";
import { compareDayPlanItemsByOrder } from "@/lib/trips/dayPlanItemOrder";
import type { ScheduleItem, ScheduleLeg } from "@/lib/trips/daySchedule";
import { buildDaySegmentPairKey, buildDrawnDaySegmentPairKeys } from "@/lib/trips/daySegmentPairs";
import { planDayPlanItemGalleryPhoto, removeWrittenPhotos } from "@/lib/trips/importPhotos";
import { plainTextToTiptapDoc } from "@/lib/trips/planText";
import type { DownloadedSuggestionImage } from "@/lib/trips/suggestionImageDownload";
import { SUGGESTION_MODE_ROUTING, suggestionDurationMinutes } from "@/lib/trips/suggestionPlan";
import type { GeoPoint } from "@/lib/geo/distance";
import type {
  ApplySuggestion,
  SuggestionPlanBasis,
  SuggestionPreviewOrigin,
} from "@/lib/validation/daySuggestionApplySchemas";
import type { SuggestionMode } from "@/lib/validation/daySuggestionSchemas";

/**
 * Story 12.4 (FR45). What the suggestion preview plans from, and the one transaction that applies it.
 *
 * Not `getDaySuggestionContextForUser` (12.1): that admits viewers and carries neither ids nor the stay's
 * check-out, and the apply needs both. The day is read through the writer clause, as every planning write
 * reads it.
 *
 * **The times** (Story 13.4). The suggestions are appended as FLEXIBLE activities after the day's last
 * activity, timed or not, and the day is planned through `planDaySchedule` (`planSuggestionAppend`), so
 * their times are the schedule rule's: they follow the last activity (or start at the day start on an
 * empty day) plus the legs, and those that do not fit before 23:59 have none. The preview and the apply
 * run the same planner.
 *
 * **The basis.** What the preview planned from: the day's last activity, and a fingerprint of the rest:
 * how many activities the day has, where the first leg leaves from, the point the stops are ordered from,
 * tonight's stay, and the planned times themselves. Apply plans again inside its transaction and refuses
 * with `DayPlanChangedError` (`409 day_plan_changed`) when any of it differs, so a day that changed after
 * the preview (a check-out, an earlier duration, a leg) is never written to with times the user did not
 * see, and a repeated apply (a retry after a lost answer, a second tab) is refused.
 *
 * **The transaction** follows the Epic 13 writes: plan before the first write, drawn keys, the creates,
 * the recompute of every other row whose times or order changed (an unsettled day, a legacy import's,
 * is normalised here), the sweep of any leg the new activities now sit inside (typically last activity →
 * tonight's stay), the receipt. It also creates legs, which 11.1 reserved for undo: R7 makes this the
 * one deliberate exception. A leg is created only where the final timeline draws it. No leg goes to
 * tonight's stay.
 *
 * **Files.** The pictures were downloaded before (network I/O cannot sit inside a SQLite transaction);
 * each one is written after its activity exists, because the path names the activity. Every written
 * path is collected, and all of them are removed if the transaction throws: the import's own
 * write-then-roll-back. The activity directories created for them go too, once empty.
 */

type BasisReader = Pick<TransactionClient, "tripDay">;

/** The writer clause of `findTripDayForTripWriter`, so a viewer gets nothing to plan from or write to. */
const writerTrip = (userId: string) => ({ OR: [{ userId }, { members: { some: { userId, role: "CONTRIBUTOR" as const } } }] });

type PlanStay = { id: string; name: string; checkOutTime: string | null; point: GeoPoint | null };

export type SuggestionPlanContext = {
  tripDayId: string;
  previousStay: PlanStay | null;
  /** Tonight's stay; only its point matters. */
  end: GeoPoint | null;
  tripStart: { label: string | null; point: GeoPoint | null };
  /** The day's last activity in its order, timed or not: the first stop's neighbour, where its leg leaves. */
  lastItem: { id: string; title: string | null; point: GeoPoint | null } | null;
  /** Every activity on the day, timed or not: a repeated apply of untimed ones still changes it. */
  itemCount: number;
};

const pointOf = (lat: number | null, lng: number | null): GeoPoint | null =>
  lat !== null && lng !== null ? { lat, lng } : null;

/** The day's plan context for a writer, read through `client` (the global client, or a transaction's). */
const readPlanContext = async (
  client: BasisReader,
  userId: string,
  tripId: string,
  tripDayId: string,
): Promise<SuggestionPlanContext | null> => {
  const stay = { select: { id: true, name: true, checkOutTime: true, locationLat: true, locationLng: true } } as const;
  const day = await client.tripDay.findFirst({
    where: { id: tripDayId, tripId, trip: writerTrip(userId) },
    select: {
      id: true,
      dayIndex: true,
      trip: { select: { startLocationLabel: true, startLocationLat: true, startLocationLng: true } },
      accommodation: stay,
      dayPlanItems: {
        select: {
          id: true,
          title: true,
          fromTime: true,
          toTime: true,
          createdAt: true,
          sortOrder: true,
          locationLat: true,
          locationLng: true,
        },
      },
    },
  });
  if (!day) return null;

  const previousDay = await client.tripDay.findFirst({
    where: { tripId, dayIndex: { lt: day.dayIndex } },
    orderBy: [{ dayIndex: "desc" }, { date: "desc" }],
    select: { accommodation: stay },
  });
  const previous = previousDay?.accommodation ?? null;

  // The suggestions are appended after the day's last activity (an overflow row without times counts), so
  // it is the first stop's neighbour.
  const last = [...day.dayPlanItems].sort(compareDayPlanItemsByOrder).at(-1) ?? null;

  return {
    tripDayId: day.id,
    previousStay: previous
      ? { id: previous.id, name: previous.name, checkOutTime: previous.checkOutTime, point: pointOf(previous.locationLat, previous.locationLng) }
      : null,
    end: day.accommodation ? pointOf(day.accommodation.locationLat, day.accommodation.locationLng) : null,
    tripStart: {
      label: day.trip.startLocationLabel?.trim() || null,
      point: pointOf(day.trip.startLocationLat, day.trip.startLocationLng),
    },
    lastItem: last
      ? { id: last.id, title: last.title, point: pointOf(last.locationLat, last.locationLng) }
      : null,
    itemCount: day.dayPlanItems.length,
  };
};

/** Through the writer clause, so a viewer gets nothing to plan from. */
export const loadSuggestionPlanContextForWriter = (
  userId: string,
  tripId: string,
  tripDayId: string,
): Promise<SuggestionPlanContext | null> => readPlanContext(prisma, userId, tripId, tripDayId);

/**
 * The point the stops are ordered from (AC1): the day's last activity's place, else last night's stay,
 * else the trip's start.
 */
export const planOrderingOrigin = (context: SuggestionPlanContext): GeoPoint | null =>
  context.lastItem?.point ?? context.previousStay?.point ?? context.tripStart.point;

/**
 * Where the first leg leaves from, which is always the first stop's timeline neighbour, never a fallback:
 * a last activity without a place has an unknown first leg (AC4).
 */
export const planFirstLegPoint = (context: SuggestionPlanContext): GeoPoint | null => {
  if (context.lastItem) return context.lastItem.point;
  if (context.previousStay) return context.previousStay.point;
  return context.tripStart.point;
};

export const planOrigin = (context: SuggestionPlanContext): SuggestionPreviewOrigin => {
  if (context.lastItem) return { kind: "activity", label: context.lastItem.title?.trim() || null };
  if (context.previousStay) return { kind: "stay", label: context.previousStay.name };
  if (context.tripStart.point || context.tripStart.label) return { kind: "tripStart", label: context.tripStart.label };
  return { kind: "none", label: null };
};

const pointKey = (point: GeoPoint | null) => (point ? `${point.lat},${point.lng}` : "-");

/** The first leg's `from` end as apply would store it; `null` when nothing can carry a leg (trip start). */
const planFirstLegFrom = (context: SuggestionPlanContext) =>
  context.lastItem
    ? { type: "dayPlanItem" as const, id: context.lastItem.id }
    : context.previousStay
      ? { type: "accommodation" as const, id: context.previousStay.id }
      : null;

/** Story 13.4 §3. A stand-in id for suggestion `index`; no stored row or leg can carry one. */
const standInId = (index: number) => `\u0000suggestion:${index}`;

/**
 * Story 13.4 §3. The day with the suggestions appended FLEXIBLE in visiting order, planned through
 * `planDaySchedule`. `durations` are already rounded (`suggestionDurationMinutes`); `legMinutes[i]` is the
 * leg into suggestion `i`, `null` when unknown. The leg into the first one leaves from the day's last row,
 * or from last night's stay on an empty day, or from nothing (the trip's start carries no leg), which is
 * exactly what `scheduleDay` reads. `appended[i]` is suggestion `i`'s times and `sortOrder`.
 */
export const planSuggestionAppend = (
  state: ScheduleDayState,
  durations: number[],
  legMinutes: (number | null)[],
): DaySchedulePlan => {
  const items: ScheduleItem[] = durations.map((durationMinutes, index) => ({
    id: standInId(index),
    title: null,
    scheduleMode: "FLEXIBLE",
    durationMinutes,
    fromTime: null,
    toTime: null,
  }));
  const firstFrom = state.rows.at(-1)?.id ?? state.previousStay?.id ?? null;
  const legs: ScheduleLeg[] = [];
  items.forEach((item, index) => {
    const minutes = legMinutes[index] ?? null;
    const fromKey = index === 0 ? firstFrom : items[index - 1].id;
    if (minutes === null || fromKey === null) return;
    legs.push({ fromKey, toKey: item.id, durationMinutes: minutes });
  });
  return planDaySchedule(state, { kind: "append", items, legs });
};

/**
 * Item 9, Story 13.4 §7. What the plan was computed on. `afterItemId` is the day's last activity; the
 * fingerprint covers the rest the preview read (the day's activity count, the first leg's `from` end and
 * point, the ordering origin, tonight's stay) and the times it planned, so a change of last night's
 * check-out, an earlier duration or a leg is a different basis too.
 */
export const planBasis = (context: SuggestionPlanContext, plan: DaySchedulePlan): SuggestionPlanBasis => {
  const from = planFirstLegFrom(context);
  return {
    afterItemId: context.lastItem?.id ?? null,
    fingerprint: [
      `items:${context.itemCount}`,
      `from:${from ? `${from.type}:${from.id}` : "-"}@${pointKey(planFirstLegPoint(context))}`,
      `order:${pointKey(planOrderingOrigin(context))}`,
      `end:${pointKey(context.end)}`,
      `times:${plan.appended.map((row) => (row.fromTime && row.toTime ? `${row.fromTime}-${row.toTime}` : "-")).join(",")}`,
    ].join("|"),
  };
};

const toPrismaTransport = (mode: SuggestionMode) => {
  const transport = SUGGESTION_MODE_ROUTING[mode].transport;
  // The three search modes; `TravelTransportType` spells them in capitals.
  return transport.toUpperCase() as "CAR" | "WALKING" | "CYCLING";
};

export type ApplySuggestionsParams = {
  userId: string;
  tripId: string;
  tripDayId: string;
  mode: SuggestionMode;
  /** In visiting order. */
  suggestions: ApplySuggestion[];
  /** The leg into each suggestion, from the preview. */
  legs: ({ durationMinutes: number; distanceKm: number | null } | null)[];
  basis: SuggestionPlanBasis;
  /** One entry per suggestion, already downloaded. */
  images: DownloadedSuggestionImage[][];
};

/** 24 small writes, 24 files and a sweep; well past Prisma's 5 s default on a slow disk. */
const APPLY_TRANSACTION_TIMEOUT_MS = 20000;

const sameBasis = (left: SuggestionPlanBasis, right: SuggestionPlanBasis) =>
  left.afterItemId === right.afterItemId && left.fingerprint === right.fingerprint;

/**
 * AC4. Writes every activity, its pictures and the drawn legs in one transaction, and returns the receipt.
 * `null` when the day is not on the trip or the user cannot write to it (the route checked the role
 * already; the writer clause here is the planning writes' own).
 */
export const applySuggestionsForTripDay = async (params: ApplySuggestionsParams): Promise<DayChangeReceipt | null> => {
  const { userId, tripId, tripDayId, mode, suggestions, legs, basis, images } = params;
  const writtenFiles: string[] = [];
  const createdDirs = new Set<string>();

  try {
    return await prisma.$transaction(
      async (tx) => {
        const context = await readPlanContext(tx, userId, tripId, tripDayId);
        if (!context) return null;
        const state = await readScheduleInputInTransaction(tx, tripId, tripDayId);
        if (!state) return null;

        // Story 13.4: the same planner as the preview, on the day as it stands in this transaction.
        const durations = suggestions.map((suggestion) => suggestionDurationMinutes(suggestion.durationMinutes));
        const plan = planSuggestionAppend(state, durations, legs.map((leg) => leg?.durationMinutes ?? null));
        if (!sameBasis(planBasis(context, plan), basis)) throw new DayPlanChangedError();

        const now = new Date();
        const drawnBefore = await readDrawnSegmentKeysInTransaction(tx, tripId, tripDayId);

        // Each a millisecond after the last: the order is `sortOrder`, but the creation order stays readable.
        const base = Date.now();
        const created: { id: string; updatedAt: Date }[] = [];
        const imageIds: string[] = [];
        for (const [index, suggestion] of suggestions.entries()) {
          const planned = plan.appended[index];
          const item = await tx.dayPlanItem.create({
            data: {
              tripId,
              tripDayId,
              title: suggestion.title,
              fromTime: planned.fromTime,
              toTime: planned.toTime,
              scheduleMode: "FLEXIBLE",
              durationMinutes: durations[index],
              sortOrder: planned.sortOrder,
              contentJson: plainTextToTiptapDoc(suggestion.description),
              locationLat: suggestion.lat,
              locationLng: suggestion.lng,
              locationLabel: suggestion.locationLabel,
              createdAt: new Date(base + index),
            },
            select: { id: true, updatedAt: true },
          });
          created.push(item);

          const taken = new Set<string>();
          for (const [position, image] of (images[index] ?? []).entries()) {
            const placement = planDayPlanItemGalleryPhoto(
              { tripId, tripDayId, dayPlanItemId: item.id, contentType: image.contentType },
              taken,
            );
            await fs.mkdir(path.dirname(placement.filePath), { recursive: true });
            createdDirs.add(path.dirname(placement.filePath));
            await fs.writeFile(placement.filePath, image.bytes);
            writtenFiles.push(placement.filePath);
            const row = await tx.dayPlanItemImage.create({
              data: { dayPlanItemId: item.id, imageUrl: placement.imageUrl, sortOrder: position + 1 },
              select: { id: true },
            });
            imageIds.push(row.id);
          }
        }

        // Every other row whose times or order the plan changed (an unsettled day is normalised here).
        const movedItems = await applyScheduleChangesInTransaction(tx, tripDayId, plan.changes, now);

        const removed = await sweepNoLongerDrawnSegmentsInTransaction(tx, { tripId, tripDayId, drawnBefore });

        // The legs the preview knew, each only where the final timeline draws it.
        const timeline = (await buildSegmentTimelineInTransaction(tx, tripId, tripDayId)) ?? [];
        const drawnAfter = buildDrawnDaySegmentPairKeys(timeline);
        const firstFrom = planFirstLegFrom(context);
        const segments: { segmentId: string; updatedAt: Date }[] = [];
        for (const [index, leg] of legs.entries()) {
          if (!leg) continue;
          const from = index === 0 ? firstFrom : { type: "dayPlanItem" as const, id: created[index - 1].id };
          if (!from) continue;
          const to = created[index];
          if (!drawnAfter.has(buildDaySegmentPairKey(from.type, from.id, "dayPlanItem", to.id))) continue;
          const segment = await tx.travelSegment.create({
            data: {
              tripDayId,
              fromItemType: from.type === "accommodation" ? "ACCOMMODATION" : "DAY_PLAN_ITEM",
              fromItemId: from.id,
              toItemType: "DAY_PLAN_ITEM",
              toItemId: to.id,
              transportType: toPrismaTransport(mode),
              durationMinutes: leg.durationMinutes,
              distanceKm: leg.distanceKm,
            },
            select: { id: true, updatedAt: true },
          });
          segments.push({ segmentId: segment.id, updatedAt: segment.updatedAt });
        }

        return buildReceipt(
          tripDayId,
          {
            kind: "suggestionsApplied",
            items: created.map((item) => ({ itemId: item.id, updatedAt: item.updatedAt })),
            segments,
            imageIds,
          },
          removed,
          movedItems,
          // Appended FLEXIBLE rows cannot make an earlier FIXED row late; passed anyway, so the receipt is honest.
          { planConflicts: toPlanConflicts(plan.newConflicts) },
        );
      },
      { timeout: APPLY_TRANSACTION_TIMEOUT_MS },
    );
  } catch (error) {
    await removeWrittenPhotos(writtenFiles);
    // `rmdir` removes only an empty directory; each one is named after an activity that was rolled back.
    for (const dir of createdDirs) {
      await fs.rmdir(dir).catch(() => undefined);
    }
    throw error;
  }
};
