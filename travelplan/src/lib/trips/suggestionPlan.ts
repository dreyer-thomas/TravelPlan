/**
 * Story 12.4 (FR45). The order the picked suggestions are visited in, and the duration each one is stored with.
 *
 * Pure: no React, no Prisma, no `server-only`. The preview and apply routes feed it, and the dialog
 * imports its types. Both routes run the same functions, so apply writes exactly what the preview showed.
 *
 * - **Order** (`orderSuggestions`). With a start and an end more than 500 m apart, the stops are sorted
 *   by how far along the way from start to end they lie (a projection onto that line, in a flat plane
 *   around the start). With no end, or an end next to the start (a round trip from the same hotel), a
 *   nearest-neighbour tour from the start. With no start, the dialog's order. Ties keep list order.
 * - **Duration** (`suggestionDurationMinutes`). The suggested duration rounded up to five minutes.
 * - **Times.** Since Story 13.4 the stops are FLEXIBLE activities appended to the day, and their times
 *   are the schedule rule's (`planSuggestionAppend` in `daySuggestionApplyRepo.ts`): starts are not
 *   rounded, and a stop that would end after 23:59 is stored without times (Story 13.2's overflow).
 */

import { haversineMeters, type GeoPoint } from "@/lib/geo/distance";
import { DAY_START_WITHOUT_STAY } from "@/lib/trips/stayTimes";
import type { RoutingProfile } from "@/lib/routing/dayRouteService";
import type { TransportType } from "@/lib/trips/transportTypes";
import {
  MAX_ACTIVITY_DURATION_MINUTES,
  MIN_ACTIVITY_DURATION_MINUTES,
} from "@/lib/validation/dayPlanItemSchemas";
import type { SuggestionMode } from "@/lib/validation/daySuggestionSchemas";

/** Where the chain starts without a stay last night; shared with the schedule rule since Story 13.1. */
export { DAY_START_WITHOUT_STAY };

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

/** Story 13.4. A suggestion's stored duration: rounded up to five minutes, inside the activity range. */
export const suggestionDurationMinutes = (minutes: number) =>
  Math.min(MAX_ACTIVITY_DURATION_MINUTES, Math.max(MIN_ACTIVITY_DURATION_MINUTES, ceilToFive(minutes)));

/** A planned stop's times in the preview; `null` in its place means it does not fit in the day. */
export type SuggestionTimes = { fromTime: string; toTime: string };

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
