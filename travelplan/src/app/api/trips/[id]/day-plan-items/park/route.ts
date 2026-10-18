import type { NextRequest } from "next/server";
import { apiError } from "@/lib/errors/apiError";
import { fail, ok } from "@/lib/http/response";
import { refuseUnlessTripWriter } from "@/lib/auth/tripAccess";
import { CSRF_COOKIE_NAME, validateCsrf } from "@/lib/security/csrf";
import { requireSession } from "@/lib/auth/sessionGuard";
import { dayChangedResponse, pastMidnightResponse, withPushConflict } from "@/lib/http/dayPlanPushResponses";
import { parkDayPlanItemForTripDay } from "@/lib/repositories/dayPlanItemRepo";
import { toDayChangeReceiptWire } from "@/lib/trips/dayChangeReceipt";
import { signDayChangeReceipt } from "@/lib/trips/dayChangeReceiptSignature";
import { dayPlanItemParkSchema } from "@/lib/validation/dayPlanItemSchemas";

/**
 * Story 14.2 (FR48). `POST /api/trips/{id}/day-plan-items/park` with `{ itemId, tripDayId }` moves the
 * activity off that day into the bucket list: the same row, `tripDayId` null, FLEXIBLE with its duration,
 * the day recomputed in the same transaction. It answers `{ item, receipt }`; the receipt's kind is
 * `parked`, and undoing it puts the activity back where it was.
 *
 * The sibling of `schedule/`, with the same gate (`refuseUnlessTripWriter`: viewer 403 `forbidden`,
 * non-participant 404). The body names the day as well as the activity, unlike the architecture's
 * `{ itemId }`, so a park from a stale tab cannot follow the activity to a day another tab moved it to.
 * Refusals are `404` (no such day, or the activity is no longer on it), `409 day_plan_past_midnight` and
 * `409 day_plan_changed` (a concurrent write). None of them writes anything.
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
  const refusal = await refuseUnlessTripWriter(userId, tripId, "Trip not found");
  if (refusal) {
    return refusal;
  }

  const rawPayload = await parseJson(request);
  if (!rawPayload) {
    return fail(apiError("invalid_json", "Request body must be valid JSON"), 400);
  }

  const parsed = dayPlanItemParkSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return fail(apiError("validation_error", "Invalid park request", parsed.error.flatten()), 400);
  }

  try {
    const attempt = await withPushConflict(() =>
      parkDayPlanItemForTripDay({
        userId,
        tripId,
        tripDayId: parsed.data.tripDayId,
        itemId: parsed.data.itemId,
      }),
    );
    if ("conflict" in attempt) {
      return dayChangedResponse();
    }
    const result = attempt.result;

    switch (result.status) {
      case "not_found":
        return fail(apiError("not_found", "Trip day not found"), 404);
      case "missing":
        return fail(apiError("not_found", "Day plan item not found"), 404);
      case "past_midnight":
        return pastMidnightResponse(result.item);
      case "parked": {
        const { item } = result;
        return ok({
          item: { ...item, createdAt: item.createdAt.toISOString() },
          receipt: signDayChangeReceipt(toDayChangeReceiptWire(result.receipt), { tripId, userId }),
        });
      }
      default: {
        const unhandled: never = result;
        throw new Error(`Unhandled park result: ${String(unhandled)}`);
      }
    }
  } catch (error) {
    console.error("day plan item park failed", { tripId, error });
    return fail(apiError("server_error", "Unable to park the activity"), 500);
  }
};
