import type { NextRequest } from "next/server";
import { apiError } from "@/lib/errors/apiError";
import { fail, ok } from "@/lib/http/response";
import { hasTripOwnerOrContributorAccess } from "@/lib/auth/tripAccess";
import { CSRF_COOKIE_NAME, validateCsrf } from "@/lib/security/csrf";
import { moveDayPlanItemToTripDay } from "@/lib/repositories/dayPlanItemRepo";
import { dayPlanItemMoveSchema } from "@/lib/validation/dayPlanItemSchemas";
import { requireSession } from "@/lib/auth/sessionGuard";

/**
 * Story 6.23 — move **one** activity to another day.
 *
 * Its own route rather than a third `operation` on `day-activity-transfer`: that endpoint's two
 * operations are whole-day, and its "move" deletes the target day's activities. Putting an
 * append-one-activity operation behind the same name would hide opposite semantics under a shared
 * word, which is the trap `common.save` was. Sitting under `day-plan-items/` also puts it next to the
 * resource it actually moves.
 *
 * Guard order matches the neighbouring write routes: CSRF, session, write access, then validation.
 * The write-access failure answers `403 unauthorized` like `day-activity-transfer` rather than the
 * `404 not_found` `day-plan-items` uses, because AC8 makes this the transfer's permission.
 */
type RouteContext = {
  params: Promise<{
    id?: string;
  }>;
};

const requireCsrf = (request: NextRequest) => {
  const csrfCookie = request.cookies.get(CSRF_COOKIE_NAME)?.value;
  const csrfHeader = request.headers.get("x-csrf-token") ?? undefined;
  return validateCsrf(csrfCookie, csrfHeader);
};

const parseJson = async (request: NextRequest) => {
  try {
    return await request.json();
  } catch {
    return null;
  }
};

export const POST = async (request: NextRequest, context: RouteContext) => {
  if (!requireCsrf(request)) {
    return fail(apiError("csrf_invalid", "Invalid CSRF token"), 403);
  }

  const auth = await requireSession(request);
  if (auth.response) {
    return auth.response;
  }
  const userId = auth.session.sub;

  const { id: tripId } = await context.params;
  if (!tripId) {
    return fail(apiError("not_found", "Trip not found"), 404);
  }
  if (!(await hasTripOwnerOrContributorAccess(userId, tripId))) {
    return fail(apiError("unauthorized", "Trip write access required"), 403);
  }

  const rawPayload = await parseJson(request);
  if (!rawPayload) {
    return fail(apiError("invalid_json", "Request body must be valid JSON"), 400);
  }

  const parsed = dayPlanItemMoveSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return fail(apiError("validation_error", "Invalid day plan item move", parsed.error.flatten()), 400);
  }

  const result = await moveDayPlanItemToTripDay({
    userId,
    tripId,
    tripDayId: parsed.data.tripDayId,
    itemId: parsed.data.itemId,
    targetTripDayId: parsed.data.targetTripDayId,
  });

  if (result.status === "not_found") {
    return fail(apiError("not_found", "Trip day not found"), 404);
  }
  if (result.status === "missing") {
    return fail(apiError("not_found", "Day plan item not found"), 404);
  }
  if (result.status === "validation_error") {
    return fail(apiError("validation_error", result.message), 400);
  }

  // `removedTravelSegmentIds` is the whole of AC4 on the wire: a removed segment carried a duration,
  // a distance and sometimes a link that someone typed, so the UI has to be able to say what went.
  return ok({
    itemId: result.itemId,
    sourceTripDayId: result.sourceTripDayId,
    targetTripDayId: result.targetTripDayId,
    removedTravelSegmentIds: result.removedTravelSegmentIds,
  });
};
