import type { NextRequest } from "next/server";
import { apiError } from "@/lib/errors/apiError";
import { fail, ok } from "@/lib/http/response";
import { hasTripOwnerOrContributorAccess } from "@/lib/auth/tripAccess";
import { CSRF_COOKIE_NAME, validateCsrf } from "@/lib/security/csrf";
import { requireSession } from "@/lib/auth/sessionGuard";
import { undoAiChange } from "@/lib/repositories/aiChangeRepo";

type RouteContext = {
  params: Promise<{
    id?: string;
    changeId?: string;
  }>;
};

/**
 * Story 15.4. `POST /api/trips/{id}/ai-changes/{changeId}/undo` takes one stored connector change back
 * through the shared undo core and marks it undone in the same transaction. Any owner or contributor may
 * undo any change on the trip, not only the one who connected the assistant.
 *
 * `day-plan-changes/undo`'s check order: CSRF, session, the owner-or-contributor gate (404, not 403). No
 * body: the receipt is the stored one. `404` for an unknown, foreign or expired change, `409
 * already_undone`, `400 undo_unavailable` when there is no (usable) receipt, `409 undo_stale` when the day
 * has changed since.
 */
export const POST = async (request: NextRequest, context: RouteContext) => {
  const csrfCookie = request.cookies.get(CSRF_COOKIE_NAME)?.value;
  const csrfHeader = request.headers.get("x-csrf-token") ?? undefined;
  if (!validateCsrf(csrfCookie, csrfHeader)) {
    return fail(apiError("csrf_invalid", "Invalid CSRF token"), 403);
  }

  const auth = await requireSession(request);
  if (auth.response) {
    return auth.response;
  }
  const userId = auth.session.sub;

  const { id: tripId, changeId } = await context.params;
  if (!tripId) {
    return fail(apiError("not_found", "Trip not found"), 404);
  }
  if (!(await hasTripOwnerOrContributorAccess(userId, tripId))) {
    return fail(apiError("not_found", "Trip not found"), 404);
  }
  if (!changeId) {
    return fail(apiError("not_found", "AI change not found"), 404);
  }

  try {
    const result = await undoAiChange({ userId, tripId, changeId, now: new Date() });
    switch (result.status) {
      case "undone":
        return ok({ undone: true });
      case "not_found":
        return fail(apiError("not_found", "AI change not found"), 404);
      case "already_undone":
        return fail(apiError("already_undone", "This change has already been undone"), 409);
      case "unavailable":
        return fail(apiError("undo_unavailable", "This change cannot be undone"), 400);
      case "stale":
        return fail(apiError("undo_stale", "The day has changed since this change was made"), 409);
      default: {
        const unhandled: never = result;
        throw new Error(`Unhandled undo result: ${String(unhandled)}`);
      }
    }
  } catch {
    return fail(apiError("server_error", "Unable to undo the change"), 500);
  }
};
