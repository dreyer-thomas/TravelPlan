import type { NextRequest } from "next/server";
import { apiError } from "@/lib/errors/apiError";
import { fail, ok } from "@/lib/http/response";
import { hasTripOwnerOrContributorAccess } from "@/lib/auth/tripAccess";
import { CSRF_COOKIE_NAME, validateCsrf } from "@/lib/security/csrf";
import { requireSession } from "@/lib/auth/sessionGuard";
import { dayChangedResponse, withPushConflict } from "@/lib/http/dayPlanPushResponses";
import { reorderDayPlanItemForTripDay } from "@/lib/repositories/dayPlanItemRepo";
import { toDayChangeReceiptWire } from "@/lib/trips/dayChangeReceipt";
import { signDayChangeReceipt } from "@/lib/trips/dayChangeReceiptSignature";
import { dayPlanItemReorderSchema } from "@/lib/validation/dayPlanItemSchemas";

/**
 * Story 11.3 (FR43). `POST /api/trips/{id}/day-plan-items/reorder` with `{ tripDayId, itemId, direction }`
 * moves an activity one place earlier (`up`, *Nach oben*) or later (`down`, *Nach unten*).
 *
 * Its own route rather than an operation on an existing one: it writes
 * nothing but times, the server decides the neighbour, and it answers with a change receipt alone. It is
 * deliberately not called "swap": `swapDayPlanItemsBetweenTripDays` is the whole-day transfer, and two
 * operations sharing a name is the `common.save` naming trap (Story 6.17).
 *
 * The check order is `day-plan-items/route.ts`'s POST: CSRF, session, the owner-or-contributor gate (404
 * for a viewer), JSON, schema. The repository adds the writer clause. Refusals are `409`:
 * `day_plan_not_reorderable` (since Story 13.1 §10 only two cases: the activity is FIXED, or it has no
 * neighbour in that direction; a FLEXIBLE one swaps with a neighbour of either mode) and
 * `day_plan_changed` (a concurrent write). None of them writes anything.
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
    return fail(apiError("not_found", "Trip not found"), 404);
  }

  const rawPayload = await parseJson(request);
  if (!rawPayload) {
    return fail(apiError("invalid_json", "Request body must be valid JSON"), 400);
  }

  const parsed = dayPlanItemReorderSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return fail(apiError("validation_error", "Invalid reorder request", parsed.error.flatten()), 400);
  }

  try {
    const attempt = await withPushConflict(() =>
      reorderDayPlanItemForTripDay({
        userId,
        tripId,
        origin: "user",
        tripDayId: parsed.data.tripDayId,
        itemId: parsed.data.itemId,
        direction: parsed.data.direction,
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
      case "not_reorderable":
        return fail(apiError("day_plan_not_reorderable", "The activity cannot move in that direction"), 409);
      case "reordered":
        return ok({ receipt: signDayChangeReceipt(toDayChangeReceiptWire(result.receipt), { tripId, userId }) });
      default: {
        const unhandled: never = result;
        throw new Error(`Unhandled reorder result: ${String(unhandled)}`);
      }
    }
  } catch {
    return fail(apiError("server_error", "Unable to change the order"), 500);
  }
};
