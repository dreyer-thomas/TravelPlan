import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/errors/apiError";
import { fail, ok } from "@/lib/http/response";
import { hasTripOwnerOrContributorAccess } from "@/lib/auth/tripAccess";
import { CSRF_COOKIE_NAME, validateCsrf } from "@/lib/security/csrf";
import { requireSession } from "@/lib/auth/sessionGuard";
import { acknowledgeAiChanges } from "@/lib/repositories/aiChangeRepo";

type RouteContext = {
  params: Promise<{
    id?: string;
  }>;
};

// The notice lists at most 50 (`AI_CHANGES_LIST_LIMIT`); the cap only bounds the request.
const bodySchema = z.object({
  changeIds: z.array(z.string().min(1).max(64)).min(1).max(100),
});

/**
 * `POST /api/trips/{id}/ai-changes/acknowledge` with `{ changeIds }`: the notice's OK (2026-10-31). The
 * changes the notice showed are confirmed as seen and leave it for every planner of the trip; their
 * badges stay. The undo route's check order: CSRF, session, the owner-or-contributor gate (404, not 403).
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

  const { id: tripId } = await context.params;
  if (!tripId) {
    return fail(apiError("not_found", "Trip not found"), 404);
  }
  if (!(await hasTripOwnerOrContributorAccess(userId, tripId))) {
    return fail(apiError("not_found", "Trip not found"), 404);
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return fail(apiError("validation_error", "Invalid request body"), 400);
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return fail(apiError("validation_error", "Invalid request body"), 400);
  }

  try {
    const acknowledged = await acknowledgeAiChanges({ tripId, changeIds: parsed.data.changeIds, now: new Date() });
    return ok({ acknowledged });
  } catch {
    return fail(apiError("server_error", "Unable to confirm the AI changes"), 500);
  }
};
