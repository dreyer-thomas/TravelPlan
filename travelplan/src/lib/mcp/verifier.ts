import { OAuthError, OAuthErrorCode, type AuthInfo, type OAuthTokenVerifier } from "@modelcontextprotocol/server";
import { findActiveAccessToken, touchTokenLastUsed } from "@/lib/repositories/oauthRepo";

/**
 * Story 15.1, AC 3, 19. Resolves a bearer token for `requireBearerAuth`. Only an unrevoked, unexpired
 * access token from our own table passes; everything else is `invalid_token`, which the SDK turns into the
 * 401 with the `WWW-Authenticate` challenge. `resource` comes from the token row, so `expectedResource`
 * rejects a token issued for anything but `/api/mcp`.
 */
export const travelPlanTokenVerifier: OAuthTokenVerifier = {
  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const row = await findActiveAccessToken(token);
    if (!row) throw new OAuthError(OAuthErrorCode.InvalidToken, "Invalid or expired access token");
    await touchTokenLastUsed(row).catch((error) => console.error("mcp: lastUsedAt update failed", error));
    return {
      token,
      clientId: row.clientId,
      scopes: row.scope.split(" ").filter((scope) => scope.length > 0),
      expiresAt: Math.floor(row.expiresAt.getTime() / 1000),
      resource: new URL(row.resource),
      extra: { userId: row.userId },
    };
  },
};

/** The signed-in user of a tool call, or `null`; tools never fall back to anything else. */
export const userIdFromAuthInfo = (authInfo: AuthInfo | undefined) => {
  const userId = authInfo?.extra?.userId;
  return typeof userId === "string" && userId.length > 0 ? userId : null;
};
