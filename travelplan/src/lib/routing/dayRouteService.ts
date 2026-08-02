export type RoutingPoint = {
  lat: number;
  lng: number;
};

export type DayRouteResult = {
  polyline: [number, number][];
  distanceMeters: number | null;
  durationSeconds: number | null;
};

/**
 * The travel modes this service can route for. `driving` is what every caller used before Story
 * 6.16; `walking` and `cycling` back the two travel modes it added.
 */
export type RoutingProfile = "driving" | "walking" | "cycling";

export const DEFAULT_ROUTING_PROFILE: RoutingProfile = "driving";

/**
 * An OSRM deployment serves exactly **one** profile: the graph is fixed at `osrm-extract` time by a
 * Lua profile, and the `{profile}` segment in the request URL is part of the path, not a selector.
 * An instance built from the car graph answers `/route/v1/foot/...` with car numbers and no error -
 * which is precisely how Story 6.16 shipped walking and cycling imports that returned driving times
 * against `router.project-osrm.org` (a single-profile demo host) while every mocked test stayed
 * green. Selecting a profile therefore means selecting an *endpoint*.
 *
 * FOSSGIS runs one public instance per profile at the paths below. Measured on the same 2.9 km of
 * central Berlin: car 29.6 km/h, bike 9.9 km/h, foot 4.5 km/h.
 *
 * It is a community service under fair use - fine at one request per explicit user action, not
 * something to poll. Set `OSRM_BASE_URL` to point at a self-hosted deployment that mirrors the same
 * three paths when that stops being true.
 */
const DEFAULT_OSRM_BASE_URL = "https://routing.openstreetmap.de";

const OSRM_PATH_BY_PROFILE: Record<RoutingProfile, string> = {
  driving: "routed-car/route/v1/driving",
  cycling: "routed-bike/route/v1/bike",
  walking: "routed-foot/route/v1/foot",
};

const osrmBaseUrl = () => (process.env.OSRM_BASE_URL || DEFAULT_OSRM_BASE_URL).replace(/\/+$/, "");

/**
 * `routing_no_route` is deliberately separate from `routing_unavailable`. Cycling coverage is patchy
 * in large parts of the world, and "there is no bicycle route between these two points" is a normal,
 * correct answer - not a failure of the service or of the feature. Callers must be able to say so.
 */
export type RoutingErrorCode = "routing_unavailable" | "routing_invalid_response" | "routing_no_route";

export class DayRouteError extends Error {
  readonly code: RoutingErrorCode;

  constructor(code: RoutingErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

type OsrmRoute = {
  geometry?: {
    coordinates?: [number, number][];
  };
  distance?: number;
  duration?: number;
};

type OsrmResponse = {
  code?: string;
  routes?: OsrmRoute[];
};

const toOsrmCoordinatePath = (points: RoutingPoint[]) => points.map((point) => `${point.lng},${point.lat}`).join(";");

const isFiniteCoordinate = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

const toPolyline = (coordinates: [number, number][]) =>
  coordinates
    .filter(
      (coordinate): coordinate is [number, number] =>
        Array.isArray(coordinate) &&
        coordinate.length === 2 &&
        isFiniteCoordinate(coordinate[0]) &&
        isFiniteCoordinate(coordinate[1]),
    )
    .map(([lng, lat]) => [lat, lng] as [number, number]);

export const getDayRouteFromOsrm = async ({
  points,
  profile = DEFAULT_ROUTING_PROFILE,
  fetchImpl = fetch,
  timeoutMs = 3500,
}: {
  points: RoutingPoint[];
  profile?: RoutingProfile;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<DayRouteResult> => {
  if (points.length < 2) {
    return { polyline: points.map((point) => [point.lat, point.lng]), distanceMeters: null, durationSeconds: null };
  }

  const coordinatePath = toOsrmCoordinatePath(points);
  const url = `${osrmBaseUrl()}/${OSRM_PATH_BY_PROFILE[profile]}/${coordinatePath}?alternatives=false&overview=full&geometries=geojson`;
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetchImpl(url, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "User-Agent": "TravelPlan/0.1 routing",
      },
    });

    // The body has to be read before the response is rejected. OSRM reports every non-`Ok` code with
    // HTTP 400 and a JSON body carrying that code, so `!response.ok` on its own cannot tell "there is
    // no route for this profile here" apart from an outage - and treating both as an outage is what
    // made `routing_no_route` unreachable in production. A body that will not parse is a real outage.
    let payload: OsrmResponse | null = null;
    try {
      payload = (await response.json()) as OsrmResponse;
    } catch {
      payload = null;
    }

    // `NoRoute`: the profile's graph connects nothing between these points. `NoSegment`: a coordinate
    // cannot be snapped to the profile's network at all - a stop pinned in a pedestrian zone with no
    // cycleway, on a beach, inside a building. Both are answers, not outages.
    if (payload?.code === "NoRoute" || payload?.code === "NoSegment") {
      throw new DayRouteError("routing_no_route", "No route available for this travel mode");
    }
    if (!response.ok || !payload) {
      throw new DayRouteError("routing_unavailable", "Unable to retrieve route geometry");
    }
    if (payload.code !== "Ok") {
      throw new DayRouteError("routing_unavailable", "Routing service unavailable");
    }

    const route = payload.routes?.[0];
    if (!route) {
      // `code: "Ok"` with an empty route list means the same thing as `NoRoute`.
      throw new DayRouteError("routing_no_route", "No route available for this travel mode");
    }
    const coordinates = route?.geometry?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) {
      throw new DayRouteError("routing_invalid_response", "Invalid routing geometry");
    }

    const polyline = toPolyline(coordinates);
    if (polyline.length < 2) {
      throw new DayRouteError("routing_invalid_response", "Invalid routing geometry");
    }

    return {
      polyline,
      distanceMeters: typeof route.distance === "number" ? route.distance : null,
      durationSeconds: typeof route.duration === "number" ? route.duration : null,
    };
  } catch (error) {
    if (error instanceof DayRouteError) {
      throw error;
    }
    throw new DayRouteError("routing_unavailable", "Routing request failed");
  } finally {
    clearTimeout(timeout);
  }
};
