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
 * OSRM's `{profile}` path segment. `driving` is what every caller used before Story 6.16; `walking`
 * and `cycling` back the two travel modes it added.
 */
export type RoutingProfile = "driving" | "walking" | "cycling";

export const DEFAULT_ROUTING_PROFILE: RoutingProfile = "driving";

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
  const url = `https://router.project-osrm.org/route/v1/${profile}/${coordinatePath}?alternatives=false&overview=full&geometries=geojson`;
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

    if (!response.ok) {
      throw new DayRouteError("routing_unavailable", "Unable to retrieve route geometry");
    }

    const payload = (await response.json()) as OsrmResponse;
    // OSRM answers "the graph for this profile connects nothing here" with `NoRoute`. That is an
    // answer, not an outage - see `routing_no_route`.
    if (payload.code === "NoRoute") {
      throw new DayRouteError("routing_no_route", "No route available for this travel mode");
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
