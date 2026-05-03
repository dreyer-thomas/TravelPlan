import type { NextRequest } from "next/server";
import { apiError } from "@/lib/errors/apiError";
import { fail, ok } from "@/lib/http/response";
import { getTripDayPrintPayloadForUser } from "@/lib/repositories/tripRepo";
import { dayRouteParamsSchema } from "@/lib/validation/dayRouteSchemas";
import { requireSession } from "@/lib/auth/sessionGuard";

export const runtime = "nodejs";

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

  const payload = await getTripDayPrintPayloadForUser({
    userId,
    tripId: parsedParams.data.id,
    dayId: parsedParams.data.dayId,
  });

  if (!payload) {
    return fail(apiError("not_found", "Trip day not found"), 404);
  }

  return ok(payload, { headers: { "Cache-Control": "no-store" } });
};
