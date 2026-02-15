export type RoutingPoint = {
  lat: number;
  lng: number;
};

export type DayRouteResult = {
  polyline: [number, number][];
  distanceMeters: number | null;
  durationSeconds: number | null;
};

export type RoutingErrorCode = "routing_unavailable" | "routing_invalid_response";

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
  fetchImpl = fetch,
  timeoutMs = 3500,
}: {
  points: RoutingPoint[];
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<DayRouteResult> => {
  if (points.length < 2) {
    return { polyline: points.map((point) => [point.lat, point.lng]), distanceMeters: null, durationSeconds: null };
  }

  const coordinatePath = toOsrmCoordinatePath(points);
  const url = `https://router.project-osrm.org/route/v1/driving/${coordinatePath}?alternatives=false&overview=full&geometries=geojson`;
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
    if (payload.code !== "Ok") {
      throw new DayRouteError("routing_unavailable", "Routing service unavailable");
    }

    const route = payload.routes?.[0];
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
