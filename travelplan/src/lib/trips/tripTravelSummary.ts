/**
 * Story 7.14. Which of a day's stored legs the trip overview counts, and what they add up to across
 * the whole trip.
 *
 * The overview's per-day coverage bar and its trip-wide distance figures describe the same legs, so
 * they come from one derivation here rather than two local ones free to drift — the reason
 * `daySegmentPairs.ts` exists (see the "7h 45m vs 7h 30m" incident in its header).
 *
 * Deliberately dependency-free beyond the trip rules it composes, so client components can import it.
 */
import { compareDayPlanItemsByOrder } from "@/lib/trips/dayPlanItemOrder";
import {
  buildDrawnDaySegmentPairKeys,
  isDrawnDaySegment,
  type DaySegmentEndpoint,
  type DaySegmentPairSource,
} from "@/lib/trips/daySegmentPairs";
import {
  TRANSPORT_TYPES,
  isTransportType,
  transportTypeAllowsDistance,
  type TransportType,
} from "@/lib/trips/transportTypes";

/**
 * The fields of an activity the day's order is decided by. All optional, as on the wire. `createdAt` is a
 * `Date` on repository rows (Story 15.10 passes `TripWithDays` days straight in) and a string on the wire.
 */
type OrderablePlanItem = {
  id: string;
  sortOrder?: number;
  fromTime?: string | null;
  createdAt?: Date | string;
};

/** The fields of a day the drawn set is decided by, typed structurally so callers keep their own types. */
type DrawableDay<TItem extends OrderablePlanItem, TSegment extends DaySegmentPairSource> = {
  accommodation: { id: string } | null;
  dayPlanItems: readonly TItem[];
  travelSegments?: readonly TSegment[];
};

/**
 * Story 8.5 review (`DW-151`). The day's endpoint order, exactly as `TripDayView` builds it: last
 * night's stay, the day's activities, this night's stay. Only the consecutive pairs of it are legs the
 * timeline draws, and only those may be counted.
 *
 * **And the activity order is derived here, not taken from the payload.** Reading `day.dayPlanItems`
 * in array order was correct only because `getTripWithDaysForUser` sorts each day's activities before
 * serialising them (`tripRepo.ts`) — an invisible, unpinned dependency. Applying the shared comparator
 * means the overview computes its drawn set from an order it owns. `orderedPlanItems` is returned so a
 * caller that also needs the order (the coverage bar) does not sort a second time.
 */
export const selectDrawnTravelSegments = <TItem extends OrderablePlanItem, TSegment extends DaySegmentPairSource>(
  day: DrawableDay<TItem, TSegment>,
  previousDay: { accommodation: { id: string } | null } | null,
): { orderedPlanItems: TItem[]; drawnTravelSegments: TSegment[] } => {
  const orderedPlanItems = [...day.dayPlanItems].sort((left, right) =>
    compareDayPlanItemsByOrder(
      { sortOrder: left.sortOrder ?? 0, fromTime: left.fromTime ?? null, createdAt: left.createdAt ?? "", id: left.id },
      { sortOrder: right.sortOrder ?? 0, fromTime: right.fromTime ?? null, createdAt: right.createdAt ?? "", id: right.id },
    ),
  );
  const dayEndpoints: DaySegmentEndpoint[] = [
    ...(previousDay?.accommodation ? [{ type: "accommodation" as const, id: previousDay.accommodation.id }] : []),
    ...orderedPlanItems.map((item) => ({ type: "dayPlanItem" as const, id: item.id })),
    ...(day.accommodation ? [{ type: "accommodation" as const, id: day.accommodation.id }] : []),
  ];
  const drawnPairKeys = buildDrawnDaySegmentPairKeys(dayEndpoints);
  const drawnTravelSegments = Array.isArray(day.travelSegments)
    ? day.travelSegments.filter((segment) => isDrawnDaySegment(drawnPairKeys, segment))
    : [];
  return { orderedPlanItems, drawnTravelSegments };
};

type SummarizableSegment = DaySegmentPairSource & {
  transportType: string;
  durationMinutes: number;
  distanceKm: number | null;
};

export type TripTravelModeSummary = {
  transportType: TransportType;
  legCount: number;
  durationMinutes: number;
  /** `null` when none of the mode's legs carries a distance — the card then shows no km figure. */
  distanceKm: number | null;
};

export type TripTravelSummary = {
  totalKm: number;
  byMode: TripTravelModeSummary[];
};

/** One decimal, applied once to a finished sum — never per leg, so `0.1 + 0.2` reads as `0.3`. */
const roundKm = (value: number) => Math.round(value * 10) / 10;

/**
 * The trip's drawn legs, summed per mode in `TRANSPORT_TYPES` order. `days` must be in `dayIndex`
 * order, because a day's first leg may start at the previous day's stay. A leg without a distance
 * still counts towards its mode's legs and time; an orphaned leg counts for nothing; a leg whose
 * stored mode is outside the union is skipped rather than given an invented row.
 */
export const summarizeTripTravel = (
  days: readonly DrawableDay<OrderablePlanItem, SummarizableSegment>[],
): TripTravelSummary => {
  const totals = new Map<TransportType, { legCount: number; durationMinutes: number; km: number; hasKm: boolean }>();
  let totalKm = 0;

  days.forEach((day, index) => {
    const previousDay = index > 0 ? days[index - 1] : null;
    for (const segment of selectDrawnTravelSegments(day, previousDay).drawnTravelSegments) {
      if (!isTransportType(segment.transportType)) continue;
      const entry = totals.get(segment.transportType) ?? { legCount: 0, durationMinutes: 0, km: 0, hasKm: false };
      entry.legCount += 1;
      entry.durationMinutes += segment.durationMinutes;
      // A flight or ship may still hold a distance (a restored backup or a row older than the
      // mode/distance coupling - `tripImportSchemas.ts` deliberately lets it through). The day view
      // hides it behind the same check, so the trip's figures must not count it either.
      if (
        transportTypeAllowsDistance(segment.transportType) &&
        typeof segment.distanceKm === "number" &&
        Number.isFinite(segment.distanceKm)
      ) {
        entry.km += segment.distanceKm;
        entry.hasKm = true;
        totalKm += segment.distanceKm;
      }
      totals.set(segment.transportType, entry);
    }
  });

  const byMode = TRANSPORT_TYPES.flatMap((transportType) => {
    const entry = totals.get(transportType);
    return entry
      ? [
          {
            transportType,
            legCount: entry.legCount,
            durationMinutes: entry.durationMinutes,
            distanceKm: entry.hasKm ? roundKm(entry.km) : null,
          },
        ]
      : [];
  });

  return { totalKm: roundKm(totalKm), byMode };
};
