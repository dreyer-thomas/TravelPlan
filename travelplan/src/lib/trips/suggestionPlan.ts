/**
 * Story 12.4 (FR45). The order the picked suggestions are visited in, and the times the chain gives them.
 *
 * Pure: no React, no Prisma, no `server-only`. The preview and apply routes feed it, and the dialog
 * imports its types. Both routes run the same functions, so apply writes exactly what the preview showed.
 *
 * - **Order** (`orderSuggestions`). With a start and an end more than 500 m apart, the stops are sorted
 *   by how far along the way from start to end they lie (a projection onto that line, in a flat plane
 *   around the start). With no end, or an end next to the start (a round trip from the same hotel), a
 *   nearest-neighbour tour from the start. With no start, the dialog's order. Ties keep list order.
 * - **Times** (`chainTimes`). From the start minute, each stop begins after the previous end plus its
 *   leg, rounded up to five minutes, and lasts its duration, also rounded up. An unknown leg counts as 0.
 *   The time format has no 24:00, so the first stop that would end after 23:59 and every one after it
 *   get no times at all: nothing is clamped and no duration is shortened.
 */

import { haversineMeters, type GeoPoint } from "@/lib/geo/distance";
import { LAST_MINUTE_OF_DAY, minutesToTime } from "@/lib/trips/dayPlanPush";
import type { RoutingProfile } from "@/lib/routing/dayRouteService";
import type { TransportType } from "@/lib/trips/transportTypes";
import type { SuggestionMode } from "@/lib/validation/daySuggestionSchemas";

/**
 * Where the chain starts on a day with no stay the night before (the trip's first day): there is no
 * check-out to follow, so the day begins at 09:00 (Tommy, 2026-10-16, ruling 1c). A stay last night
 * always decides instead, through its check-out or the timeline's 10:00 default.
 */
export const DAY_START_WITHOUT_STAY = "09:00";

/** Closer than this, the start and the end are "the same place" and a projection means nothing. */
export const SAME_PLACE_METERS = 500;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
const wrapLongitudeDelta = (deltaDegrees: number) => ((deltaDegrees % 360) + 540) % 360 - 180;

/** A flat x/y around `origin`, in degrees of latitude. Enough for ordering stops within a day. */
const toLocalPlane = (point: GeoPoint, origin: GeoPoint) => ({
  x: wrapLongitudeDelta(point.lng - origin.lng) * Math.cos(toRadians(origin.lat)),
  y: point.lat - origin.lat,
});

const nearestNeighbourTour = (points: GeoPoint[], origin: GeoPoint): number[] => {
  const remaining = points.map((_point, index) => index);
  const order: number[] = [];
  let current = origin;
  while (remaining.length > 0) {
    let bestPosition = 0;
    let bestDistance = haversineMeters(current, points[remaining[0]]);
    for (let position = 1; position < remaining.length; position += 1) {
      const distance = haversineMeters(current, points[remaining[position]]);
      // Strictly less: on a tie the earlier list entry wins.
      if (distance < bestDistance) {
        bestDistance = distance;
        bestPosition = position;
      }
    }
    const [next] = remaining.splice(bestPosition, 1);
    order.push(next);
    current = points[next];
  }
  return order;
};

/** Indices into `points`, in visiting order (AC1). */
export const orderSuggestions = (points: GeoPoint[], origin: GeoPoint | null, end: GeoPoint | null): number[] => {
  const listOrder = points.map((_point, index) => index);
  if (!origin) return listOrder;
  if (!end || haversineMeters(origin, end) <= SAME_PLACE_METERS) return nearestNeighbourTour(points, origin);

  const direction = toLocalPlane(end, origin);
  const scores = points.map((point) => {
    const local = toLocalPlane(point, origin);
    return local.x * direction.x + local.y * direction.y;
  });
  // `Array.prototype.sort` is stable, so equal scores keep list order.
  return listOrder.sort((left, right) => scores[left] - scores[right]);
};

export const ceilToFive = (minutes: number) => Math.ceil(minutes / 5) * 5;

export type ChainedTimes = { fromTime: string; toTime: string };

/**
 * AC2. `legMinutes[i]` is the leg into stop `i` (from the start for `i = 0`), `null` when unknown.
 * A `null` row has no times (item 2); `overflow` says at least one row is `null`.
 */
export const chainTimes = ({
  startMinute,
  legMinutes,
  durations,
}: {
  startMinute: number;
  legMinutes: (number | null)[];
  durations: number[];
}): { rows: (ChainedTimes | null)[]; overflow: boolean } => {
  const rows: (ChainedTimes | null)[] = [];
  let previousEnd = startMinute;
  let overflow = false;
  durations.forEach((duration, index) => {
    if (overflow) {
      rows.push(null);
      return;
    }
    const from = ceilToFive(previousEnd + (legMinutes[index] ?? 0));
    const to = from + ceilToFive(duration);
    if (to > LAST_MINUTE_OF_DAY) {
      overflow = true;
      rows.push(null);
      return;
    }
    rows.push({ fromTime: minutesToTime(from), toTime: minutesToTime(to) });
    previousEnd = to;
  });
  return { rows, overflow };
};

/**
 * The search's mode as an OSRM profile and as the stored leg's transport type. One map for both callers
 * of OSRM by mode: the leg dialog's route preview and this story.
 */
export const SUGGESTION_MODE_ROUTING: Record<SuggestionMode, { profile: RoutingProfile; transport: TransportType }> = {
  car: { profile: "driving", transport: "car" },
  walking: { profile: "walking", transport: "walking" },
  cycling: { profile: "cycling", transport: "cycling" },
};

export type SuggestionLeg = { durationMinutes: number; distanceKm: number };

/**
 * One OSRM leg as the leg dialog would store it: minutes rounded, at least 1; kilometres to 0.1, at
 * least 0.1 (a stored distance must be positive). A zero or missing value is no route, as in the dialog.
 */
export const legFromOsrm = (durationSeconds: number | null, distanceMeters: number | null): SuggestionLeg | null => {
  if (durationSeconds === null || distanceMeters === null) return null;
  if (!(durationSeconds > 0) || !(distanceMeters > 0)) return null;
  return {
    durationMinutes: Math.max(1, Math.round(durationSeconds / 60)),
    distanceKm: Math.max(0.1, Math.round(distanceMeters / 100) / 10),
  };
};
