import type { NextRequest } from "next/server";
import { apiError } from "@/lib/errors/apiError";
import { fail, ok } from "@/lib/http/response";
import { dayChangedResponse } from "@/lib/http/dayPlanPushResponses";
import { requireSession } from "@/lib/auth/sessionGuard";
import { refuseUnlessTripWriter } from "@/lib/auth/tripAccess";
import { CSRF_COOKIE_NAME, validateCsrf } from "@/lib/security/csrf";
import { DayPlanChangedError } from "@/lib/repositories/dayScheduleTransaction";
import { applySuggestionsForTripDay } from "@/lib/repositories/daySuggestionApplyRepo";
import { toDayChangeReceiptWire } from "@/lib/trips/dayChangeReceipt";
import { signDayChangeReceipt } from "@/lib/trips/dayChangeReceiptSignature";
import { downloadSuggestionImages } from "@/lib/trips/suggestionImageDownload";
import { dayRouteParamsSchema } from "@/lib/validation/dayRouteSchemas";
import { suggestionApplyRequestSchema } from "@/lib/validation/daySuggestionApplySchemas";

/**
 * Story 12.4 (AC4–AC7, AC9). `POST` the ticked suggestions in visiting order with the preview's legs and
 * basis; the day gets them as activities, with their pictures and the drawn legs, in one transaction.
 * Answers `{ receipt }`, signed like every other day-change receipt, so the notice can take it all back.
 *
 * Writers only, like the preview; CSRF, session, params, access, JSON, schema, in that order. The
 * pictures are downloaded first, outside the transaction (`suggestionImageDownload.ts`); a failed one is
 * skipped and never fails the apply. Then the repository re-reads the basis inside its transaction and
 * answers `409 day_plan_changed` when the day moved since the preview: the dialog then previews again.
 * The day is recomputed with the preview's own planner and the legs sent back with it; OSRM is not
 * asked twice.
 *
 * Story 14.3: `parked` go to the bucket list in the same transaction, their pictures downloaded in the
 * same call (one budget for the whole apply). An all-parked apply carries no basis and never answers 409.
 */

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    id?: string;
    dayId?: string;
  }>;
};

const requireCsrf = (request: NextRequest) => {
  const csrfCookie = request.cookies.get(CSRF_COOKIE_NAME)?.value;
  const csrfHeader = request.headers.get("x-csrf-token") ?? undefined;
  return validateCsrf(csrfCookie, csrfHeader);
};

const parseJson = async (request: NextRequest) => {
  try {
    return { ok: true as const, value: (await request.json()) as unknown };
  } catch {
    return { ok: false as const };
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

  const parsedParams = dayRouteParamsSchema.safeParse(await context.params);
  if (!parsedParams.success) {
    return fail(apiError("validation_error", "Invalid route parameters", parsedParams.error.flatten()), 400);
  }
  const { id: tripId, dayId } = parsedParams.data;

  const refusal = await refuseUnlessTripWriter(userId, tripId, "Trip day not found");
  if (refusal) {
    return refusal;
  }

  const rawBody = await parseJson(request);
  if (!rawBody.ok) {
    return fail(apiError("invalid_json", "Request body must be valid JSON"), 400);
  }
  const parsedBody = suggestionApplyRequestSchema.safeParse(rawBody.value);
  if (!parsedBody.success) {
    return fail(apiError("validation_error", "Invalid apply request", parsedBody.error.flatten()), 400);
  }
  const { mode, suggestions, legs, basis, parked } = parsedBody.data;

  try {
    const downloaded = await downloadSuggestionImages(
      [...suggestions, ...parked].map((suggestion) => suggestion.images),
      { signal: request.signal },
    );
    const images = downloaded.slice(0, suggestions.length);
    const parkedImages = downloaded.slice(suggestions.length);
    const receipt = await applySuggestionsForTripDay({
      userId,
      tripId,
      origin: "user",
      tripDayId: dayId,
      mode,
      suggestions,
      legs,
      basis,
      images,
      parked,
      parkedImages,
    });
    if (!receipt) {
      return fail(apiError("not_found", "Trip day not found"), 404);
    }
    return ok({ receipt: signDayChangeReceipt(toDayChangeReceiptWire(receipt), { tripId, userId }) });
  } catch (error) {
    if (error instanceof DayPlanChangedError) {
      return dayChangedResponse();
    }
    console.error("day suggestions apply: failed", { name: error instanceof Error ? error.name : typeof error });
    return fail(apiError("server_error", "Unable to add the suggestions"), 500);
  }
};
