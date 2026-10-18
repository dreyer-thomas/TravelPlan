import type { NextRequest } from "next/server";
import { apiError } from "@/lib/errors/apiError";
import { fail, ok } from "@/lib/http/response";
import { refuseUnlessTripWriter } from "@/lib/auth/tripAccess";
import { CSRF_COOKIE_NAME, validateCsrf } from "@/lib/security/csrf";
import { requireSession } from "@/lib/auth/sessionGuard";
import { dayChangedResponse, withPushConflict } from "@/lib/http/dayPlanPushResponses";
import { makeDayFlexibleForTripDay } from "@/lib/repositories/dayPlanItemRepo";
import { toDayChangeReceiptWire } from "@/lib/trips/dayChangeReceipt";
import { signDayChangeReceipt } from "@/lib/trips/dayChangeReceiptSignature";
import { dayMakeFlexibleSchema } from "@/lib/validation/dayPlanItemSchemas";

/**
 * Story 13.3. `POST /api/trips/{id}/day-plan-items/make-flexible` with `{ tripDayId }` (*Alle flexibel
 * machen*): every FIXED activity of the day becomes FLEXIBLE with its duration, the order unchanged, and the
 * day is recomputed in the same transaction. It answers `{ receipt }`, kind `madeFlexible`; undoing it
 * restores every mode, duration, time, place and stamp.
 *
 * The sibling of `park/`, with the same gate (`refuseUnlessTripWriter`: viewer 403 `forbidden`,
 * non-participant 404). Refusals are `404` (no such day) and `409 day_plan_changed` (a concurrent write,
 * or a day without a FIXED activity: the menu offers the action only on a day with one). None of them
 * writes anything.
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

  const parsed = dayMakeFlexibleSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return fail(apiError("validation_error", "Invalid make-flexible request", parsed.error.flatten()), 400);
  }

  try {
    const attempt = await withPushConflict(() =>
      makeDayFlexibleForTripDay({ userId, tripId, tripDayId: parsed.data.tripDayId }),
    );
    if ("conflict" in attempt) {
      return dayChangedResponse();
    }
    const result = attempt.result;

    switch (result.status) {
      case "not_found":
        return fail(apiError("not_found", "Trip day not found"), 404);
      case "made_flexible":
        return ok({ receipt: signDayChangeReceipt(toDayChangeReceiptWire(result.receipt), { tripId, userId }) });
      default: {
        const unhandled: never = result;
        throw new Error(`Unhandled make-flexible result: ${String(unhandled)}`);
      }
    }
  } catch (error) {
    console.error("day make flexible failed", { tripId, error });
    return fail(apiError("server_error", "Unable to make the activities flexible"), 500);
  }
};
