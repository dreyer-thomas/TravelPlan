import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth/sessionGuard";
import { hasTripReadAccess } from "@/lib/auth/tripAccess";
import { apiError } from "@/lib/errors/apiError";
import { fail, ok } from "@/lib/http/response";
import { DayRouteError, getDayRouteFromOsrm, type RoutingProfile } from "@/lib/routing/dayRouteService";
import {
  travelSegmentRouteLookupParamsSchema,
  travelSegmentRouteLookupQuerySchema,
  type TravelSegmentRouteLookupMode,
} from "@/lib/validation/travelSegmentRouteLookupSchemas";

type RouteContext = {
  params: Promise<{
    id?: string;
  }>;
};

/** Travel mode (the app's vocabulary) to OSRM profile. Kept here so the wire never leaks OSRM's. */
const ROUTING_PROFILE_BY_MODE: Record<TravelSegmentRouteLookupMode, RoutingProfile> = {
  car: "driving",
  walking: "walking",
  cycling: "cycling",
};

export const GET = async (request: NextRequest, context: RouteContext) => {
  const auth = await requireSession(request);
  if (auth.response) {
    return auth.response;
  }
  const userId = auth.session.sub;

  const rawParams = await context.params;
  const parsedParams = travelSegmentRouteLookupParamsSchema.safeParse(rawParams);
  if (!parsedParams.success) {
    return fail(apiError("validation_error", "Invalid route parameters", parsedParams.error.flatten()), 400);
  }

  if (!(await hasTripReadAccess(userId, parsedParams.data.id))) {
    return fail(apiError("not_found", "Trip not found"), 404);
  }

  const parsedQuery = travelSegmentRouteLookupQuerySchema.safeParse({
    originLat: request.nextUrl.searchParams.get("originLat"),
    originLng: request.nextUrl.searchParams.get("originLng"),
    destinationLat: request.nextUrl.searchParams.get("destinationLat"),
    destinationLng: request.nextUrl.searchParams.get("destinationLng"),
    // `?? undefined` rather than the raw `null`: the schema defaults an *absent* mode to car, and a
    // null would be a type error instead.
    mode: request.nextUrl.searchParams.get("mode") ?? undefined,
  });
  if (!parsedQuery.success) {
    return fail(apiError("validation_error", "Invalid route lookup query", parsedQuery.error.flatten()), 400);
  }

  try {
    const route = await getDayRouteFromOsrm({
      points: [
        { lat: parsedQuery.data.originLat, lng: parsedQuery.data.originLng },
        { lat: parsedQuery.data.destinationLat, lng: parsedQuery.data.destinationLng },
      ],
      profile: ROUTING_PROFILE_BY_MODE[parsedQuery.data.mode],
    });

    return ok({ route });
  } catch (error) {
    if (error instanceof DayRouteError) {
      // "No route for this mode between these points" is a fact about the request, not a broken
      // upstream, so it is a 404 and keeps its own code. Everything else stays a 502.
      if (error.code === "routing_no_route") {
        return fail(apiError(error.code, "No route available for this travel mode"), 404);
      }
      return fail(apiError(error.code, "Routing service unavailable"), 502);
    }
    return fail(apiError("server_error", "Unable to build travel segment route"), 500);
  }
};
