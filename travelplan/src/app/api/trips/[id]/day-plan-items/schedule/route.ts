import type { NextRequest } from "next/server";
import { apiError } from "@/lib/errors/apiError";
import { fail, ok } from "@/lib/http/response";
import { refuseUnlessTripWriter } from "@/lib/auth/tripAccess";
import { CSRF_COOKIE_NAME, validateCsrf } from "@/lib/security/csrf";
import { requireSession } from "@/lib/auth/sessionGuard";
import { dayChangedResponse, withPushConflict } from "@/lib/http/dayPlanPushResponses";
import { scheduleParkedDayPlanItemForTripDay } from "@/lib/repositories/dayPlanItemRepo";
import { toDayChangeReceiptWire } from "@/lib/trips/dayChangeReceipt";
import { signDayChangeReceipt } from "@/lib/trips/dayChangeReceiptSignature";
import { dayPlanItemScheduleSchema } from "@/lib/validation/dayPlanItemSchemas";

/**
 * Story 14.1 (FR31). `POST /api/trips/{id}/day-plan-items/schedule` with `{ itemId, tripDayId }` moves a
 * parked activity (the bucket list's) onto that day: the same row, appended as FLEXIBLE, the day
 * recomputed in the same transaction. It answers `{ item, receipt }`; the receipt's kind is `scheduled`,
 * and undoing it parks the activity again.
 *
 * Beside `move/` and `reorder/` because it is the same kind of write: one activity changes place. The
 * gate is the bucket list's (`refuseUnlessTripWriter`: viewer 403 `forbidden`, non-participant 404), so
 * the two halves of the idea's life answer a refused caller alike (AC5). Refusals are `404` (no such
 * day, no such parked activity) and `409 day_plan_changed` (a concurrent write). None of them writes
 * anything. A day pushed past 23:59 is saved (Story 13.2).
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

  const parsed = dayPlanItemScheduleSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return fail(apiError("validation_error", "Invalid schedule request", parsed.error.flatten()), 400);
  }

  try {
    const attempt = await withPushConflict(() =>
      scheduleParkedDayPlanItemForTripDay({
        userId,
        tripId,
        origin: "user",
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
        return fail(apiError("not_found", "Bucket list item not found"), 404);
      case "scheduled": {
        const { item } = result;
        return ok({
          item: { ...item, createdAt: item.createdAt.toISOString() },
          receipt: signDayChangeReceipt(toDayChangeReceiptWire(result.receipt), { tripId, userId }),
        });
      }
      default: {
        const unhandled: never = result;
        throw new Error(`Unhandled schedule result: ${String(unhandled)}`);
      }
    }
  } catch (error) {
    console.error("day plan item schedule failed", { tripId, error });
    return fail(apiError("server_error", "Unable to schedule the activity"), 500);
  }
};
