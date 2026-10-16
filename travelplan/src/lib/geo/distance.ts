/**
 * Great-circle distance between two points, in metres (Story 12.1).
 *
 * The first exported geo-distance helper in the codebase. `dayRouteService.ts` keeps its own private
 * equirectangular `metersBetween`, deliberately: its tests pin its numbers and it only ever compares
 * against a 50 m threshold, where the approximation is exact enough. This one decides whether a
 * geocoder's hit is "the same place" as an AI's coordinates at a 2 km threshold anywhere on earth, so it
 * is the full haversine on a 6371 km sphere.
 *
 * Longitude deltas need no wrapping: `sin²(Δλ/2)` is the same for Δλ and Δλ ± 360°, so two points a few
 * kilometres apart on either side of the antimeridian measure correctly as they are.
 */
export type GeoPoint = { lat: number; lng: number };

const EARTH_RADIUS_METERS = 6371000;
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

export const haversineMeters = (a: GeoPoint, b: GeoPoint) => {
  const deltaLat = toRadians(b.lat - a.lat);
  const deltaLng = toRadians(b.lng - a.lng);
  const h =
    Math.sin(deltaLat / 2) ** 2 + Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(deltaLng / 2) ** 2;
  // `min(1, …)` guards the rounding that can push `h` a hair above 1 for antipodal points.
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
};
