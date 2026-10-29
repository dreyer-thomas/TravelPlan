import type { NextRequest } from "next/server";
import { apiError } from "@/lib/errors/apiError";
import { fail, ok } from "@/lib/http/response";
import { requireSession } from "@/lib/auth/sessionGuard";
import { CSRF_COOKIE_NAME, validateCsrf } from "@/lib/security/csrf";
import { isMcpEnabled } from "@/lib/oauth/config";
import { revokeConnectionForUser } from "@/lib/repositories/oauthRepo";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    familyId?: string;
  }>;
};

/**
 * Story 15.3. *Disconnect*: revokes every token of one connection (token family) of the signed-in user.
 * The assistant's next `/api/mcp` call answers 401 and its refresh token gets `invalid_grant`.
 *
 * Connector gate first, then CSRF, then the session - the order the other session mutations check in.
 *
 * Unknown, already revoked and foreign family ids all answer the same 404 `not_found`: the repository puts
 * the owner into the update's `where`, so another user's connection is neither touched nor confirmed to
 * exist. Rows are marked `revokedAt` rather than deleted, so a reuse of the refresh token stays recognisable until
 * housekeeping removes the rows a day after they expire.
 */
export const DELETE = async (request: NextRequest, context: RouteContext) => {
  if (!isMcpEnabled()) {
    return fail(apiError("not_found", "Not found"), 404);
  }

  const csrfCookie = request.cookies.get(CSRF_COOKIE_NAME)?.value;
  const csrfHeader = request.headers.get("x-csrf-token") ?? undefined;
  if (!validateCsrf(csrfCookie, csrfHeader)) {
    return fail(apiError("csrf_invalid", "Invalid CSRF token"), 403);
  }

  const auth = await requireSession(request);
  if (auth.response) {
    return auth.response;
  }

  const { familyId } = await context.params;
  if (!familyId) {
    return fail(apiError("not_found", "Connection not found"), 404);
  }

  try {
    const revoked = await revokeConnectionForUser(auth.session.sub, familyId);
    if (!revoked) {
      return fail(apiError("not_found", "Connection not found"), 404);
    }
    return ok({ revoked: true });
  } catch {
    return fail(apiError("server_error", "Unable to disconnect"), 500);
  }
};
