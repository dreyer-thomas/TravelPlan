import { isMcpResource } from "@/lib/oauth/authorizeRequest";
import { getMcpResourceUrl, isMcpEnabled } from "@/lib/oauth/config";
import { connectorDisabled, oauthError, oauthJson, readFormBody } from "@/lib/oauth/http";
import { getClientIp } from "@/lib/http/clientIp";
import {
  deleteExpiredOAuthRows,
  exchangeAuthorizationCode,
  rotateRefreshToken,
  type TokenGrantResult,
} from "@/lib/repositories/oauthRepo";
import { checkRateLimit } from "@/lib/security/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

/**
 * Story 15.1, AC 14-15, 21. The token endpoint: authorization-code and refresh-token grants for public
 * clients (no client authentication; PKCE and the stored bindings carry the proof). RFC 6749 shapes only.
 *
 * Claude allows 10 s here (30 s for refresh); everything below is one SQLite transaction.
 */
export const POST = async (request: Request) => {
  if (!isMcpEnabled()) return connectorDisabled();

  const ip = getClientIp(request);
  if (ip !== "unknown" && !checkRateLimit(`oauth-token:${ip}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS).ok) {
    return oauthError("slow_down", "Too many token requests", 429);
  }

  const form = await readFormBody(request);
  if (!form.ok) return oauthError("invalid_request", form.description);
  const params = form.params;
  const clientId = params.get("client_id");
  if (!clientId) return oauthError("invalid_request", "client_id is required");

  let result: TokenGrantResult;
  switch (params.get("grant_type")) {
    case "authorization_code": {
      const code = params.get("code");
      const redirectUri = params.get("redirect_uri");
      const codeVerifier = params.get("code_verifier");
      const resource = params.get("resource");
      if (!code || !redirectUri || !codeVerifier || !resource) {
        return oauthError("invalid_request", "code, redirect_uri, code_verifier and resource are required");
      }
      if (!isMcpResource(resource)) return oauthError("invalid_target", "resource must be the TravelPlan MCP endpoint");
      result = await exchangeAuthorizationCode({
        code,
        clientId,
        redirectUri,
        codeVerifier,
        resource: getMcpResourceUrl(),
      });
      break;
    }
    case "refresh_token": {
      const refreshToken = params.get("refresh_token");
      if (!refreshToken) return oauthError("invalid_request", "refresh_token is required");
      const resource = params.get("resource");
      if (resource !== null && !isMcpResource(resource)) {
        return oauthError("invalid_target", "resource must be the TravelPlan MCP endpoint");
      }
      result = await rotateRefreshToken({
        refreshToken,
        clientId,
        resource: resource === null ? null : getMcpResourceUrl(),
      });
      break;
    }
    case null:
      return oauthError("invalid_request", "grant_type is required");
    default:
      return oauthError("unsupported_grant_type", "Only authorization_code and refresh_token are supported");
  }

  if (!result.ok) return oauthError(result.error, result.description);

  await deleteExpiredOAuthRows().catch((error) => console.error("oauth/token: housekeeping failed", error));

  return oauthJson({
    access_token: result.tokens.accessToken,
    token_type: "Bearer",
    expires_in: result.tokens.expiresIn,
    refresh_token: result.tokens.refreshToken,
    scope: result.tokens.scope,
  });
};
