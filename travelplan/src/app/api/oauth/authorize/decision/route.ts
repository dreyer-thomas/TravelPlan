import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/sessionGuard";
import { prisma } from "@/lib/db/prisma";
import { apiError } from "@/lib/errors/apiError";
import { fail, ok } from "@/lib/http/response";
import {
  buildAuthorizationResponseUrl,
  buildErrorRedirectUrl,
  validateAuthorizeRequest,
} from "@/lib/oauth/authorizeRequest";
import { isMcpEnabled } from "@/lib/oauth/config";
import { connectorDisabled } from "@/lib/oauth/http";
import { createAuthorizationCode } from "@/lib/repositories/oauthRepo";
import { CSRF_COOKIE_NAME, validateCsrf } from "@/lib/security/csrf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const decisionSchema = z.object({
  query: z.string().max(8 * 1024),
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

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return fail(apiError("invalid_json", "Invalid JSON"), 400);
  }
  const parsed = decisionSchema.safeParse(raw);
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
    return ok({ redirectUrl: buildErrorRedirectUrl(validation) });
  }

  const authorization = validation.request;
  if (parsed.data.decision === "deny") {
    return ok({
      redirectUrl: buildAuthorizationResponseUrl(authorization.redirectUri, {
        error: "access_denied",
        error_description: "The user denied the request",
        state: authorization.state,
      }),
    });
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
  });
};
