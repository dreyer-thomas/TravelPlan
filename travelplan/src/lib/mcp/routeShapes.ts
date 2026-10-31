import { toDateKey } from "@/lib/mcp/plannerShapes";
import type { TripWithDays } from "@/lib/repositories/tripRepo";
import { buildDaySegmentPairKey, buildDaySegmentPairKeyForSegment, type DaySegmentEndpointType } from "@/lib/trips/daySegmentPairs";
import { TRANSPORT_TYPES, isTransportType, transportTypeAllowsDistance, type TransportType } from "@/lib/trips/transportTypes";
import { selectDrawnTravelSegments, summarizeTripTravel } from "@/lib/trips/tripTravelSummary";

/**
 * Story 15.10. A trip as `get_trip_route` hands it to the model: per day, where it goes and how, and
 * nothing else — no texts but the stay's name, no costs, links or files. Pure, like `plannerShapes.ts`.
 *
 * The drawn-leg rule and the trip totals are `tripTravelSummary.ts`'s, not re-derived here: days are
 * walked in array order with `previousDay = days[index - 1]`, exactly as `summarizeTripTravel` walks
 * them, so the per-mode figures cannot drift from the trip overview's. The path is straight lines
 * between stops in plan order; no routing service is involved.
 */

type Day = TripWithDays["days"][number];
type Point = [lat: number, lng: number];

export type RouteLeg = { mode: TransportType; count: number; distanceKm: number | null; durationMinutes: number };
export type RouteSection = { mode: TransportType | null; points: Point[] };
export type RouteDay = {
  date: string;
  dayIndex: number;
  stay: { name: string; lat: number; lng: number } | null;
  legs: RouteLeg[];
  path: RouteSection[];
  missingPositions: number;
};
export type TripRoute = {
  id: string;
  startDate: string;
  endDate: string;
  totals: { distanceKm: number; byMode: RouteLeg[] };
  days: RouteDay[];
};

/** 5 decimals (about a metre). `+ 0` turns a rounded `-0` into `0`. */
const roundCoordinate = (value: number) => Math.round(value * 1e5) / 1e5 + 0;

/** One decimal, applied once to a finished sum, as `summarizeTripTravel` does. */
const roundKm = (value: number) => Math.round(value * 10) / 10;

/** A stored position, rounded; a missing or non-finite one is no position. */
const toPoint = (location: { lat: number; lng: number } | null): Point | null =>
  location && Number.isFinite(location.lat) && Number.isFinite(location.lng)
    ? [roundCoordinate(location.lat), roundCoordinate(location.lng)]
    : null;

const toLegs = (segments: Day["travelSegments"]): RouteLeg[] => {
  const totals = new Map<TransportType, { count: number; durationMinutes: number; km: number; hasKm: boolean }>();
  for (const segment of segments) {
    if (!isTransportType(segment.transportType)) continue;
    const entry = totals.get(segment.transportType) ?? { count: 0, durationMinutes: 0, km: 0, hasKm: false };
    entry.count += 1;
    entry.durationMinutes += segment.durationMinutes;
    // The same guard as `summarizeTripTravel`: a flight or ship distance from an old backup is not counted.
    if (
      transportTypeAllowsDistance(segment.transportType) &&
      typeof segment.distanceKm === "number" &&
      Number.isFinite(segment.distanceKm)
    ) {
      entry.km += segment.distanceKm;
      entry.hasKm = true;
    }
    totals.set(segment.transportType, entry);
  }
  return TRANSPORT_TYPES.flatMap((mode) => {
    const entry = totals.get(mode);
    return entry
      ? [{ mode, count: entry.count, distanceKm: entry.hasKm ? roundKm(entry.km) : null, durationMinutes: entry.durationMinutes }]
      : [];
  });
};

type Endpoint = { type: DaySegmentEndpointType; id: string; point: Point | null };

/**
 * The day's stops in plan order as sections of one mode each (story Dev Notes → "Path algorithm"). A
 * hop is named by its drawn leg only when its two stops are adjacent in the plan; a hop that skips a
 * stop without position, or has no leg drawn, is `null`. Zero-length hops are dropped; sections share
 * their boundary point so the line is continuous.
 */
const toPath = (endpoints: Endpoint[], drawnModes: Map<string, TransportType>): RouteSection[] => {
  const positioned = endpoints.flatMap((endpoint, index) => (endpoint.point ? [{ index, endpoint, point: endpoint.point }] : []));
  const sections: RouteSection[] = [];
  for (let hop = 1; hop < positioned.length; hop += 1) {
    const from = positioned[hop - 1];
    const to = positioned[hop];
    if (from.point[0] === to.point[0] && from.point[1] === to.point[1]) continue;
    const mode =
      to.index === from.index + 1
        ? (drawnModes.get(buildDaySegmentPairKey(from.endpoint.type, from.endpoint.id, to.endpoint.type, to.endpoint.id)) ?? null)
        : null;
    const last = sections.at(-1);
    if (last && last.mode === mode) last.points.push(to.point);
    else sections.push({ mode, points: [from.point, to.point] });
  }
  if (sections.length === 0 && positioned.length > 0) return [{ mode: null, points: [positioned[0].point] }];
  return sections;
};

const toRouteDay = (day: Day, previousDay: Day | null): RouteDay => {
  const { orderedPlanItems, drawnTravelSegments } = selectDrawnTravelSegments(day, previousDay);

  const drawnModes = new Map<string, TransportType>();
  for (const segment of drawnTravelSegments) {
    if (isTransportType(segment.transportType)) drawnModes.set(buildDaySegmentPairKeyForSegment(segment), segment.transportType);
  }

  const previousStay = previousDay?.accommodation ?? null;
  const stayPoint = day.accommodation ? toPoint(day.accommodation.location) : null;
  const itemPoints = orderedPlanItems.map((item) => ({ type: "dayPlanItem" as const, id: item.id, point: toPoint(item.location) }));
  const endpoints: Endpoint[] = [
    ...(previousStay ? [{ type: "accommodation" as const, id: previousStay.id, point: toPoint(previousStay.location) }] : []),
    ...itemPoints,
    ...(day.accommodation ? [{ type: "accommodation" as const, id: day.accommodation.id, point: stayPoint }] : []),
  ];

  // The day's own stops only: last night's stay was counted on the day it was tonight's stay.
  const missingPositions =
    itemPoints.filter((entry) => entry.point === null).length + (day.accommodation && !stayPoint ? 1 : 0);

  return {
    date: toDateKey(day.date),
    dayIndex: day.dayIndex,
    stay: day.accommodation && stayPoint ? { name: day.accommodation.name, lat: stayPoint[0], lng: stayPoint[1] } : null,
    legs: toLegs(drawnTravelSegments),
    path: toPath(endpoints, drawnModes),
    missingPositions,
  };
};

export const toTripRoute = (trip: TripWithDays): TripRoute => {
  const summary = summarizeTripTravel(trip.days);
  return {
    id: trip.id,
    startDate: toDateKey(trip.startDate),
    endDate: toDateKey(trip.endDate),
    totals: {
      distanceKm: summary.totalKm,
      byMode: summary.byMode.map((entry) => ({
        mode: entry.transportType,
        count: entry.legCount,
        distanceKm: entry.distanceKm,
        durationMinutes: entry.durationMinutes,
      })),
    },
    days: trip.days.map((day, index) => toRouteDay(day, trip.days[index - 1] ?? null)),
  };
};
