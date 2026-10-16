import type { NextRequest } from "next/server";
import { apiError } from "@/lib/errors/apiError";
import { fail, ok } from "@/lib/http/response";
import { requireSession } from "@/lib/auth/sessionGuard";
import { refuseUnlessTripPlannerOrAdminReader } from "@/lib/auth/tripAccess";
import { CSRF_COOKIE_NAME, validateCsrf } from "@/lib/security/csrf";
import { getDaySuggestionContextForUser } from "@/lib/repositories/tripRepo";
import { dayRouteParamsSchema } from "@/lib/validation/dayRouteSchemas";
import { suggestionsRequestSchema } from "@/lib/validation/daySuggestionSchemas";
import { isAiSuggestionsEnabled } from "@/lib/ai/config";
import { consumeDailySearch } from "@/lib/ai/dailyLimit";
import { AiSuggestionError, requestDaySuggestions } from "@/lib/ai/daySuggestionService";
import { verifySuggestionLocations } from "@/lib/ai/verifySuggestions";

/**
 * Story 12.1. `POST` a wish and a travel mode, get back 3–8 suggested stops for the day.
 *
 * A `POST` although it writes nothing: every call spends the operator's money on a Claude request with
 * web search, so it must not be a link a crawler or a prefetch can follow, and it goes through the CSRF
 * check like every other `POST`.
 *
 * The order is deliberate. `ai_unavailable` comes straight after the session, before any trip lookup: it
 * says nothing about the trip, and it keeps the feature-off state free. The daily limit is consumed only
 * once access and the body have passed, immediately before the model call, so a refused or malformed
 * request never costs the user one of their searches - but a model call that fails still does, because
 * it was paid for.
 *
 * Verification against Nominatim follows the model call and can take up to ten seconds on top of it
 * (`verifySuggestions.ts`). No `maxDuration` is exported: the app is self-hosted and sets none anywhere.
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

  if (!isAiSuggestionsEnabled()) {
    return fail(apiError("ai_unavailable", "Suggestions are not available"), 503);
  }

  const parsedParams = dayRouteParamsSchema.safeParse(await context.params);
  if (!parsedParams.success) {
    return fail(apiError("validation_error", "Invalid route parameters", parsedParams.error.flatten()), 400);
  }
  const { id: tripId, dayId } = parsedParams.data;

  const refusal = await refuseUnlessTripPlannerOrAdminReader(userId, tripId, "Trip day not found");
  if (refusal) {
    return refusal;
  }

  const dayContext = await getDaySuggestionContextForUser({ userId, tripId, dayId });
  if (!dayContext) {
    return fail(apiError("not_found", "Trip day not found"), 404);
  }

  const rawBody = await parseJson(request);
  if (!rawBody.ok) {
    return fail(apiError("invalid_json", "Request body must be valid JSON"), 400);
  }

  const parsedBody = suggestionsRequestSchema.safeParse(rawBody.value);
  if (!parsedBody.success) {
    return fail(apiError("validation_error", "Invalid suggestion request", parsedBody.error.flatten()), 400);
  }

  if (!consumeDailySearch(userId).ok) {
    return fail(apiError("ai_limit_reached", "Daily suggestion limit reached"), 429);
  }

  try {
    const suggestions = await requestDaySuggestions({
      context: dayContext,
      prompt: parsedBody.data.prompt,
      mode: parsedBody.data.mode,
      signal: request.signal,
    });
    return ok({ suggestions: await verifySuggestionLocations(suggestions, { signal: request.signal }) });
  } catch (error) {
    // Class names and an HTTP status only: never the message, which can carry upstream text, and never
    // the prompt or the key. `upstream` names the SDK error behind an `ai_failed`, so a timeout, an
    // abort and a 5xx can be told apart in the log.
    const name = error instanceof Error ? error.name : typeof error;
    const status = error instanceof AiSuggestionError ? error.status : undefined;
    const upstream = error instanceof AiSuggestionError ? error.upstream : undefined;
    console.error("day suggestions: request failed", { name, upstream, status });

    if (error instanceof AiSuggestionError) {
      return fail(apiError("ai_failed", "Unable to get suggestions right now"), 502);
    }
    return fail(apiError("server_error", "Unable to get suggestions"), 500);
  }
};
