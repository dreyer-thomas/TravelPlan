import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/sessionGuard";
import { prisma } from "@/lib/db/prisma";
import { apiError } from "@/lib/errors/apiError";
import { readJsonBodyWithinLimit } from "@/lib/http/bodyLimit";
import { fail, ok } from "@/lib/http/response";
import {
  buildAuthorizationResponseUrl,
  buildErrorRedirectUrl,
  MAX_AUTHORIZE_QUERY_LENGTH,
  validateAuthorizeRequest,
} from "@/lib/oauth/authorizeRequest";
import { isMcpEnabled } from "@/lib/oauth/config";
import { connectorDisabled } from "@/lib/oauth/http";
import { createAuthorizationCode } from "@/lib/repositories/oauthRepo";
import { CSRF_COOKIE_NAME, validateCsrf } from "@/lib/security/csrf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_DECISION_BODY_BYTES = 16 * 1024;
/** The answer can carry a live authorization code; it must never be cached. */
const NO_STORE = { headers: { "Cache-Control": "no-store", Pragma: "no-cache" } };

const decisionSchema = z.object({
  query: z.string().max(MAX_AUTHORIZE_QUERY_LENGTH),
  decision: z.enum(["allow", "deny"]),
});

/**
 * Story 15.1, AC 12. The consent card's *Erlauben* / *Ablehnen*. The body carries the original authorize
 * query string, which is validated again here exactly as the page did: nothing the page displayed is trusted.
 * The answer is the URL the browser goes to next, always on the client's verified redirect URI.
 */
export const POST = async (request: NextRequest) => {
  if (!isMcpEnabled()) return connectorDisabled();

  const csrfCookie = request.cookies.get(CSRF_COOKIE_NAME)?.value;
  const csrfHeader = request.headers.get("x-csrf-token") ?? undefined;
  if (!validateCsrf(csrfCookie, csrfHeader)) {
    return fail(apiError("csrf_invalid", "Invalid CSRF token"), 403);
  }

  const auth = await requireSession(request);
  if (auth.response) return auth.response;

  const body = await readJsonBodyWithinLimit(request.body, MAX_DECISION_BODY_BYTES);
  if (!body.ok) {
    return body.reason === "too_large"
      ? fail(apiError("payload_too_large", "Request body too large"), 413)
      : fail(apiError("invalid_json", "Invalid JSON"), 400);
  }
  const parsed = decisionSchema.safeParse(body.raw);
  if (!parsed.success) {
    return fail(apiError("validation_error", "Invalid decision", parsed.error.flatten()), 400);
  }

  // The session token outlives an account by up to seven days; the code needs a real user row.
  const user = await prisma.user.findUnique({ where: { id: auth.session.sub }, select: { id: true } });
  if (!user) return fail(apiError("unauthorized", "Authentication required"), 401);

  const query = parsed.data.query.startsWith("?") ? parsed.data.query.slice(1) : parsed.data.query;
  const validation = await validateAuthorizeRequest(new URLSearchParams(query));
  if (validation.kind === "fatal") {
    return fail(apiError("invalid_request", "Invalid authorization request", { reason: validation.reason }), 400);
  }
  if (validation.kind === "redirectError") {
    return ok({ redirectUrl: buildErrorRedirectUrl(validation) }, NO_STORE);
  }

  const authorization = validation.request;
  if (parsed.data.decision === "deny") {
    return ok({
      redirectUrl: buildAuthorizationResponseUrl(authorization.redirectUri, {
        error: "access_denied",
        error_description: "The user denied the request",
        state: authorization.state,
      }),
    }, NO_STORE);
  }

  const code = await createAuthorizationCode({
    userId: user.id,
    clientId: authorization.client.clientId,
    clientName: authorization.client.clientName,
    redirectUri: authorization.redirectUri,
    codeChallenge: authorization.codeChallenge,
    resource: authorization.resource,
    scope: authorization.scope,
  });
  return ok({
    redirectUrl: buildAuthorizationResponseUrl(authorization.redirectUri, { code, state: authorization.state }),
  }, NO_STORE);
};
