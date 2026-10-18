import type { NextRequest } from "next/server";
import { apiError } from "@/lib/errors/apiError";
import { fail, ok } from "@/lib/http/response";
import { requireSession } from "@/lib/auth/sessionGuard";
import { refuseUnlessTripWriter } from "@/lib/auth/tripAccess";
import { CSRF_COOKIE_NAME, validateCsrf } from "@/lib/security/csrf";
import {
  loadSuggestionPlanContextForWriter,
  planBasis,
  planFirstLegPoint,
  planOrderingOrigin,
  planOrigin,
  planSuggestionAppend,
} from "@/lib/repositories/daySuggestionApplyRepo";
import { readScheduleInputInTransaction } from "@/lib/repositories/dayScheduleTransaction";
import { prisma } from "@/lib/db/prisma";
import { getDayRouteFromOsrm } from "@/lib/routing/dayRouteService";
import {
  legFromOsrm,
  orderSuggestions,
  SUGGESTION_MODE_ROUTING,
  suggestionDurationMinutes,
  type SuggestionLeg,
} from "@/lib/trips/suggestionPlan";
import { dayRouteParamsSchema } from "@/lib/validation/dayRouteSchemas";
import { suggestionPreviewRequestSchema, type SuggestionPreview } from "@/lib/validation/daySuggestionApplySchemas";

/**
 * Story 12.4 (AC1–AC3, AC6). `POST` the ticked suggestions and the search's mode; get back the order they
 * would be visited in, their times and the legs between them. Writes nothing. The times come from the
 * apply's own planner (`planSuggestionAppend`, Story 13.4) over the day as it stands.
 *
 * A planning step, so writers only (`refuseUnlessTripWriter`), unlike the search, which also admits an
 * ADMIN viewer. It calls no AI, so it neither checks `isAiSuggestionsEnabled` nor counts against the daily
 * limit. The check order is the suggestions route's: CSRF, session, params, access, JSON, schema.
 *
 * **One OSRM request** (FOSSGIS fair use: one request per explicit user action) for the whole chain: the
 * first stop's timeline neighbour, then the stops in order. Apply never calls OSRM again; it receives these
 * legs back, so what lands is what was shown. Any routing error leaves every leg unknown, without a retry
 * per pair, and the stops are still planned (AC6).
 */

export const runtime = "nodejs";

/** A chain of up to nine points; the service's 3.5 s default is sized for a single pair. */
const ROUTING_TIMEOUT_MS = 8000;

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
  const parsedBody = suggestionPreviewRequestSchema.safeParse(rawBody.value);
  if (!parsedBody.success) {
    return fail(apiError("validation_error", "Invalid preview request", parsedBody.error.flatten()), 400);
  }
  const { mode, suggestions } = parsedBody.data;

  try {
    const planContext = await loadSuggestionPlanContextForWriter(userId, tripId, dayId);
    if (!planContext) {
      return fail(apiError("not_found", "Trip day not found"), 404);
    }

    const order = orderSuggestions(
      suggestions.map((suggestion) => ({ lat: suggestion.lat, lng: suggestion.lng })),
      planOrderingOrigin(planContext),
      planContext.end,
    );
    const ordered = order.map((index) => suggestions[index]);

    // Leg `i` arrives at stop `i`. Without a first point the first leg is unknown and OSRM's legs start
    // at the second stop.
    const firstLegPoint = planFirstLegPoint(planContext);
    const points = [
      ...(firstLegPoint ? [firstLegPoint] : []),
      ...ordered.map((suggestion) => ({ lat: suggestion.lat, lng: suggestion.lng })),
    ];
    const offset = firstLegPoint ? 0 : 1;
    const legs: (SuggestionLeg | null)[] = ordered.map(() => null);
    let routingUnavailable = false;
    if (points.length >= 2) {
      try {
        const route = await getDayRouteFromOsrm({
          points,
          profile: SUGGESTION_MODE_ROUTING[mode].profile,
          timeoutMs: ROUTING_TIMEOUT_MS,
        });
        // The service only sends legs that match the points; checked here too, since every leg written
        // later is one of these.
        if (route.legs && route.legs.length === points.length - 1) {
          route.legs.forEach((leg, legIndex) => {
            legs[legIndex + offset] = legFromOsrm(leg.durationSeconds, leg.distanceMeters);
          });
        } else {
          routingUnavailable = true;
        }
      } catch (error) {
        // Every routing error, `routing_no_route` for one unreachable pair included: no retry per pair.
        console.warn("day suggestions preview: routing failed", {
          code: error instanceof Error && "code" in error ? (error as { code: unknown }).code : undefined,
        });
        routingUnavailable = true;
      }
    }

    // Story 13.4 §8: the apply's planner, on the day read after the OSRM call (the apply re-plans anyway).
    const state = await readScheduleInputInTransaction(prisma, tripId, dayId);
    if (!state) {
      return fail(apiError("not_found", "Trip day not found"), 404);
    }
    const plan = planSuggestionAppend(
      state,
      ordered.map((suggestion) => suggestionDurationMinutes(suggestion.durationMinutes)),
      legs.map((leg) => leg?.durationMinutes ?? null),
    );
    const rows = plan.appended.map((row) =>
      row.fromTime && row.toTime ? { fromTime: row.fromTime, toTime: row.toTime } : null,
    );

    const preview: SuggestionPreview = {
      order,
      rows,
      legs,
      basis: planBasis(planContext, plan),
      overflow: rows.some((row) => row === null),
      routingUnavailable,
      origin: planOrigin(planContext),
    };
    return ok(preview);
  } catch (error) {
    console.error("day suggestions preview: failed", { name: error instanceof Error ? error.name : typeof error });
    return fail(apiError("server_error", "Unable to plan the suggestions"), 500);
  }
};
