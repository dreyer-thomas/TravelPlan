import type { NextRequest } from "next/server";
import { apiError } from "@/lib/errors/apiError";
import { fail, ok } from "@/lib/http/response";
import { requireSession } from "@/lib/auth/sessionGuard";
import { CSRF_COOKIE_NAME, validateCsrf } from "@/lib/security/csrf";
import { UnsupportedTripFeedbackVoteError, upsertTripFeedbackVote } from "@/lib/repositories/tripFeedbackRepo";
import { tripFeedbackVoteSchema } from "@/lib/validation/tripFeedbackSchemas";

type RouteContext = {
  params: Promise<{ id?: string }>;
};

const toTargetInput = (tripId: string, payload: { targetType: string; targetId: string; tripDayId?: string }) => {
  switch (payload.targetType) {
    case "trip":
      return { type: "trip" as const, tripId };
    case "tripDay":
      return { type: "tripDay" as const, tripId, tripDayId: payload.targetId };
    case "accommodation":
      return { type: "accommodation" as const, tripId, tripDayId: payload.tripDayId ?? "", accommodationId: payload.targetId };
    case "dayPlanItem":
      return { type: "dayPlanItem" as const, tripId, tripDayId: payload.tripDayId ?? "", dayPlanItemId: payload.targetId };
    default:
      return null;
  }
};

export const PUT = async (request: NextRequest, context: RouteContext) => {
  const csrfCookie = request.cookies.get(CSRF_COOKIE_NAME)?.value;
  const csrfHeader = request.headers.get("x-csrf-token") ?? undefined;
  if (!validateCsrf(csrfCookie, csrfHeader)) {
    return fail(apiError("csrf_invalid", "Invalid CSRF token"), 403);
  }

  const auth = await requireSession(request);
  if (auth.response) {
    return auth.response;
  }

  const { id: tripId } = await context.params;
  if (!tripId) {
    return fail(apiError("not_found", "Trip not found"), 404);
  }

  let rawPayload: unknown;
  try {
    rawPayload = await request.json();
  } catch {
    return fail(apiError("invalid_json", "Request body must be valid JSON"), 400);
  }

  const parsed = tripFeedbackVoteSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return fail(apiError("validation_error", "Invalid feedback vote", parsed.error.flatten()), 400);
  }

  const target = toTargetInput(tripId, parsed.data);
  if (!target) {
    return fail(apiError("validation_error", "Invalid feedback target"), 400);
  }

  if ((parsed.data.targetType === "accommodation" || parsed.data.targetType === "dayPlanItem") && !parsed.data.tripDayId) {
    return fail(apiError("validation_error", "Trip day is required for item feedback"), 400);
  }

  try {
    const feedback = await upsertTripFeedbackVote({
      userId: auth.session.sub,
      target,
      value: parsed.data.value,
    });

    if (!feedback) {
      return fail(apiError("not_found", "Trip not found"), 404);
    }

    return ok({
      feedback: {
        targetType: feedback.targetType,
        targetId: feedback.targetId,
        comments: feedback.comments.map((comment) => ({
          id: comment.id,
          body: comment.body,
          createdAt: comment.createdAt.toISOString(),
          updatedAt: comment.updatedAt.toISOString(),
          author: comment.author,
        })),
        voteSummary: feedback.voteSummary,
      },
    });
  } catch (error) {
    if (error instanceof UnsupportedTripFeedbackVoteError) {
      return fail(apiError("validation_error", "Voting is not supported for this feedback target"), 400);
    }

    return fail(apiError("server_error", "Unable to save feedback vote"), 500);
  }
};
