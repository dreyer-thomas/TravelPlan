import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth/sessionGuard";
import { apiError } from "@/lib/errors/apiError";
import { fail, ok } from "@/lib/http/response";
import { deleteTripFeedbackComment, updateTripFeedbackComment } from "@/lib/repositories/tripFeedbackRepo";
import { CSRF_COOKIE_NAME, validateCsrf } from "@/lib/security/csrf";
import { tripFeedbackCommentEditSchema } from "@/lib/validation/tripFeedbackSchemas";

type RouteContext = {
  params: Promise<{ id?: string; commentId?: string }>;
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

  const { id: tripId, commentId } = await context.params;
  if (!tripId || !commentId) {
    return fail(apiError("not_found", "Trip not found"), 404);
  }

  let rawPayload: unknown;
  try {
    rawPayload = await request.json();
  } catch {
    return fail(apiError("invalid_json", "Request body must be valid JSON"), 400);
  }

  const parsed = tripFeedbackCommentEditSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return fail(apiError("validation_error", "Invalid feedback comment", parsed.error.flatten()), 400);
  }

  try {
    const result = await updateTripFeedbackComment({
      userId: auth.session.sub,
      tripId,
      commentId,
      body: parsed.data.body,
    });

    if (result.outcome === "not_found") {
      return fail(apiError("not_found", "Trip not found"), 404);
    }

    if (result.outcome === "forbidden") {
      return fail(apiError("forbidden", "Comment can only be edited by its author"), 403);
    }

    return ok({
      feedback: {
        targetType: result.feedback.targetType,
        targetId: result.feedback.targetId,
        comments: result.feedback.comments.map((comment) => ({
          id: comment.id,
          body: comment.body,
          createdAt: comment.createdAt.toISOString(),
          updatedAt: comment.updatedAt.toISOString(),
          author: comment.author,
        })),
        voteSummary: result.feedback.voteSummary,
      },
    });
  } catch {
    return fail(apiError("server_error", "Unable to update feedback comment"), 500);
  }
};

export const DELETE = async (request: NextRequest, context: RouteContext) => {
  const csrfCookie = request.cookies.get(CSRF_COOKIE_NAME)?.value;
  const csrfHeader = request.headers.get("x-csrf-token") ?? undefined;
  if (!validateCsrf(csrfCookie, csrfHeader)) {
    return fail(apiError("csrf_invalid", "Invalid CSRF token"), 403);
  }

  const auth = await requireSession(request);
  if (auth.response) {
    return auth.response;
  }

  const { id: tripId, commentId } = await context.params;
  if (!tripId || !commentId) {
    return fail(apiError("not_found", "Trip not found"), 404);
  }

  try {
    const result = await deleteTripFeedbackComment({
      userId: auth.session.sub,
      tripId,
      commentId,
    });

    if (result.outcome === "not_found") {
      return fail(apiError("not_found", "Trip not found"), 404);
    }

    if (result.outcome === "forbidden") {
      return fail(apiError("forbidden", "Comment can only be deleted by its author"), 403);
    }

    return ok({
      feedback: {
        targetType: result.feedback.targetType,
        targetId: result.feedback.targetId,
        comments: result.feedback.comments.map((comment) => ({
          id: comment.id,
          body: comment.body,
          createdAt: comment.createdAt.toISOString(),
          updatedAt: comment.updatedAt.toISOString(),
          author: comment.author,
        })),
        voteSummary: result.feedback.voteSummary,
      },
    });
  } catch {
    return fail(apiError("server_error", "Unable to delete feedback comment"), 500);
  }
};
