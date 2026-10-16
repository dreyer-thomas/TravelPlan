import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db/prisma";
import {
  buildReceipt,
  DayPlanChangedError,
  findCheckInWarningForOrderInTransaction,
  readPushInputInTransaction,
} from "@/lib/repositories/dayPlanPushTransaction";
import {
  buildSegmentTimelineInTransaction,
  readDrawnSegmentKeysInTransaction,
  sweepNoLongerDrawnSegmentsInTransaction,
  type TransactionClient,
} from "@/lib/repositories/travelSegmentRepo";
import type { DayChangeReceipt } from "@/lib/trips/dayChangeReceipt";
import { compareDayPlanItemsByStartTime } from "@/lib/trips/dayPlanItemOrder";
import { activityEndMinutes, minutesToTime, timeToMinutes } from "@/lib/trips/dayPlanPush";
import { buildDaySegmentPairKey, buildDrawnDaySegmentPairKeys } from "@/lib/trips/daySegmentPairs";
import { planDayPlanItemGalleryPhoto, removeWrittenPhotos } from "@/lib/trips/importPhotos";
import { plainTextToTiptapDoc } from "@/lib/trips/planText";
import { DEFAULT_CHECK_OUT_TIME, resolveCheckOutTime } from "@/lib/trips/stayTimes";
import type { DownloadedSuggestionImage } from "@/lib/trips/suggestionImageDownload";
import { chainTimes, DAY_START_WITHOUT_STAY, SUGGESTION_MODE_ROUTING } from "@/lib/trips/suggestionPlan";
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
 * **What the plan starts from** (the *basis*). The chain starts after the last timed activity, or at last
 * night's check-out (10:00 when none is stored, the time the timeline draws), or at 09:00 on a day with
 * no stay the night before. Apply re-reads the basis
 * inside its transaction and refuses with `DayPlanChangedError` (`409 day_plan_changed`) when it moved,
 * so a day that changed after the preview is never written to with the preview's times.
 *
 * **The transaction** follows the Epic 11 writes: drawn keys before, the creates, the sweep of any leg the
 * new activities now sit inside (typically last activity → tonight's stay), the check-in warning, the
 * receipt. It also creates legs, which 11.1 reserved for undo: R7 makes this the one deliberate
 * exception. A leg is created only where the final timeline draws it, so an untimed activity sorting
 * between two new ones never ends up under an orphaned leg. No leg goes to tonight's stay.
 *
 * **Files.** The pictures were downloaded before (network I/O cannot sit inside a SQLite transaction);
 * each one is written after its activity exists, because the path names the activity. Every written
 * path is collected, and all of them are removed if the transaction throws: the import's own
 * write-then-roll-back.
 */

type BasisReader = Pick<TransactionClient, "tripDay">;

type PlanStay = { id: string; name: string; checkOutTime: string | null; point: GeoPoint | null };

export type SuggestionPlanContext = {
  tripDayId: string;
  previousStay: PlanStay | null;
  /** Tonight's stay; only its point matters. */
  end: GeoPoint | null;
  tripStart: { label: string | null; point: GeoPoint | null };
  lastTimed: { id: string; title: string | null; point: GeoPoint | null; endMinute: number } | null;
};

const pointOf = (lat: number | null, lng: number | null): GeoPoint | null =>
  lat !== null && lng !== null ? { lat, lng } : null;

/** The day's plan context, read through `client` (the global client, or a transaction's). */
const readPlanContext = async (client: BasisReader, tripId: string, tripDayId: string): Promise<SuggestionPlanContext | null> => {
  const stay = { select: { id: true, name: true, checkOutTime: true, locationLat: true, locationLng: true } } as const;
  const day = await client.tripDay.findFirst({
    where: { id: tripDayId, tripId },
    select: {
      id: true,
      dayIndex: true,
      trip: { select: { startLocationLabel: true, startLocationLat: true, startLocationLng: true } },
      accommodation: stay,
      dayPlanItems: {
        select: { id: true, title: true, fromTime: true, toTime: true, createdAt: true, locationLat: true, locationLng: true },
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

  // The last timed activity in the timeline's order; one whose start cannot be read is not timed here.
  const timed = [...day.dayPlanItems]
    .sort(compareDayPlanItemsByStartTime)
    .filter((item) => Boolean(item.fromTime) && activityEndMinutes(item) !== null);
  const last = timed.at(-1) ?? null;

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
    lastTimed: last
      ? { id: last.id, title: last.title, point: pointOf(last.locationLat, last.locationLng), endMinute: activityEndMinutes(last) as number }
      : null,
  };
};

/** The writer clause of `findTripDayForTripWriter`, so a viewer gets nothing to plan from. */
export const loadSuggestionPlanContextForWriter = async (
  userId: string,
  tripId: string,
  tripDayId: string,
): Promise<SuggestionPlanContext | null> => {
  const writable = await prisma.tripDay.findFirst({
    where: { id: tripDayId, tripId, trip: { OR: [{ userId }, { members: { some: { userId, role: "CONTRIBUTOR" } } }] } },
    select: { id: true },
  });
  if (!writable) return null;
  return readPlanContext(prisma, tripId, tripDayId);
};

/**
 * Where the chain starts (AC2): the last timed activity's end; else last night's check-out (stored, or the
 * timeline's 10:00 default); else, with no stay last night, 09:00 (ruling 1c).
 */
export const planStartMinute = (context: SuggestionPlanContext): number => {
  if (context.lastTimed) return context.lastTimed.endMinute;
  if (!context.previousStay) return timeToMinutes(DAY_START_WITHOUT_STAY) as number;
  return timeToMinutes(resolveCheckOutTime(context.previousStay.checkOutTime)) ?? (timeToMinutes(DEFAULT_CHECK_OUT_TIME) as number);
};

export const planBasis = (context: SuggestionPlanContext): SuggestionPlanBasis => ({
  afterItemId: context.lastTimed?.id ?? null,
  startTime: minutesToTime(planStartMinute(context)),
});

/**
 * The point the stops are ordered from (AC1): the last timed activity's place, else last night's stay,
 * else the trip's start.
 */
export const planOrderingOrigin = (context: SuggestionPlanContext): GeoPoint | null =>
  context.lastTimed?.point ?? context.previousStay?.point ?? context.tripStart.point;

/**
 * Where the first leg leaves from, which is always the first stop's timeline neighbour, never a fallback:
 * a last timed activity without a place has an unknown first leg (AC4).
 */
export const planFirstLegPoint = (context: SuggestionPlanContext): GeoPoint | null => {
  if (context.lastTimed) return context.lastTimed.point;
  if (context.previousStay) return context.previousStay.point;
  return context.tripStart.point;
};

export const planOrigin = (context: SuggestionPlanContext): SuggestionPreviewOrigin => {
  if (context.lastTimed) return { kind: "activity", label: context.lastTimed.title?.trim() || null };
  if (context.previousStay) return { kind: "stay", label: context.previousStay.name };
  if (context.tripStart.point || context.tripStart.label) return { kind: "tripStart", label: context.tripStart.label };
  return { kind: "none", label: null };
};

const toPrismaTransport = (mode: SuggestionMode) => {
  const transport = SUGGESTION_MODE_ROUTING[mode].transport;
  // The three search modes; `TravelTransportType` spells them in capitals.
  return transport.toUpperCase() as "CAR" | "WALKING" | "CYCLING";
};

export type ApplySuggestionsParams = {
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
  left.afterItemId === right.afterItemId && left.startTime === right.startTime;

/**
 * AC4. Writes every activity, its pictures and the drawn legs in one transaction, and returns the receipt.
 * `null` when the day is not on the trip (the route has checked the writer role already).
 */
export const applySuggestionsForTripDay = async (params: ApplySuggestionsParams): Promise<DayChangeReceipt | null> => {
  const { tripId, tripDayId, mode, suggestions, legs, basis, images } = params;
  const writtenFiles: string[] = [];

  try {
    return await prisma.$transaction(
      async (tx) => {
        const context = await readPlanContext(tx, tripId, tripDayId);
        if (!context) return null;
        if (!sameBasis(planBasis(context), basis)) throw new DayPlanChangedError();

        const { rows } = chainTimes({
          startMinute: planStartMinute(context),
          legMinutes: legs.map((leg) => leg?.durationMinutes ?? null),
          durations: suggestions.map((suggestion) => suggestion.durationMinutes),
        });

        const drawnBefore = await readDrawnSegmentKeysInTransaction(tx, tripId, tripDayId);

        // Each a millisecond after the last, so untimed ones (past midnight) keep the visiting order.
        const base = Date.now();
        const created: { id: string; updatedAt: Date }[] = [];
        const imageIds: string[] = [];
        for (const [index, suggestion] of suggestions.entries()) {
          const times = rows[index];
          const item = await tx.dayPlanItem.create({
            data: {
              tripDayId,
              title: suggestion.title,
              fromTime: times?.fromTime ?? null,
              toTime: times?.toTime ?? null,
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
            await fs.writeFile(placement.filePath, image.bytes);
            writtenFiles.push(placement.filePath);
            const row = await tx.dayPlanItemImage.create({
              data: { dayPlanItemId: item.id, imageUrl: placement.imageUrl, sortOrder: position + 1 },
              select: { id: true },
            });
            imageIds.push(row.id);
          }
        }

        const removed = await sweepNoLongerDrawnSegmentsInTransaction(tx, { tripId, tripDayId, drawnBefore });

        // The legs the preview knew, each only where the final timeline draws it.
        const timeline = (await buildSegmentTimelineInTransaction(tx, tripId, tripDayId)) ?? [];
        const drawnAfter = buildDrawnDaySegmentPairKeys(timeline);
        const firstFrom = context.lastTimed
          ? { type: "dayPlanItem" as const, id: context.lastTimed.id }
          : context.previousStay
            ? { type: "accommodation" as const, id: context.previousStay.id }
            : null;
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

        const [items] = await readPushInputInTransaction(tx, tripDayId);
        const checkInWarning = await findCheckInWarningForOrderInTransaction(
          tx,
          tripDayId,
          [...items].sort(compareDayPlanItemsByStartTime),
        );

        return buildReceipt(
          tripDayId,
          {
            kind: "suggestionsApplied",
            items: created.map((item) => ({ itemId: item.id, updatedAt: item.updatedAt })),
            segments,
            imageIds,
          },
          removed,
          [],
          { checkInWarning },
        );
      },
      { timeout: APPLY_TRANSACTION_TIMEOUT_MS },
    );
  } catch (error) {
    await removeWrittenPhotos(writtenFiles);
    throw error;
  }
};
