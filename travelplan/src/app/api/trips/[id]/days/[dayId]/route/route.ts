import type { NextRequest } from "next/server";
import { apiError } from "@/lib/errors/apiError";
import { fail, ok } from "@/lib/http/response";
import { DayRouteError, getDayRouteFromOsrm } from "@/lib/routing/dayRouteService";
import { getDayRoutePointsForUser } from "@/lib/repositories/tripRepo";
import { dayRouteParamsSchema } from "@/lib/validation/dayRouteSchemas";
import { requireSession } from "@/lib/auth/sessionGuard";

type RouteContext = {
  params: Promise<{
    id?: string;
    dayId?: string;
  }>;
};

export const GET = async (request: NextRequest, context: RouteContext) => {
  const auth = await requireSession(request);
  if (auth.response) {
    return auth.response;
  }
  const userId = auth.session.sub;

  const rawParams = await context.params;
  const parsedParams = dayRouteParamsSchema.safeParse(rawParams);
  if (!parsedParams.success) {
    return fail(apiError("validation_error", "Invalid route parameters", parsedParams.error.flatten()), 400);
  }

  const points = await getDayRoutePointsForUser({
    userId,
    tripId: parsedParams.data.id,
    dayId: parsedParams.data.dayId,
  });

  if (!points) {
    return fail(apiError("not_found", "Trip day not found"), 404);
  }

  const fallbackPolyline = points.map((point) => [point.lat, point.lng] as [number, number]);

  if (points.length < 2) {
    return ok({
      points,
      route: {
        polyline: fallbackPolyline,
        distanceMeters: null,
        durationSeconds: null,
      },
    });
  }

  try {
    const route = await getDayRouteFromOsrm({
      points: points.map((point) => ({ lat: point.lat, lng: point.lng })),
    });

    return ok({
      points,
      route,
    });
  } catch (error) {
    if (error instanceof DayRouteError) {
      return fail(apiError(error.code, "Routing service unavailable", { fallbackPolyline }), 502);
    }
    return fail(apiError("server_error", "Unable to build day route"), 500);
  }
};
