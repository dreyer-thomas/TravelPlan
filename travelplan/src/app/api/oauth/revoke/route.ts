import { NextResponse } from "next/server";
import { isMcpEnabled } from "@/lib/oauth/config";
import { connectorDisabled, oauthError, readFormBody } from "@/lib/oauth/http";
import { getClientIp } from "@/lib/http/clientIp";
import { revokeFamilyByToken } from "@/lib/repositories/oauthRepo";
import { checkRateLimit } from "@/lib/security/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

/**
 * Story 15.1, AC 17. Token revocation (RFC 7009). Revoking either token ends the whole connection, and
 * the answer is 200 whether or not the token was known (§2.2), so the endpoint cannot be used to probe.
 */
export const POST = async (request: Request) => {
  if (!isMcpEnabled()) return connectorDisabled();

  // An unknown address shares one bucket rather than skipping the limit.
  if (!checkRateLimit(`oauth-revoke:${getClientIp(request)}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS).ok) {
    return oauthError("slow_down", "Too many revocation requests", 429);
  }

  const form = await readFormBody(request);
  if (!form.ok) return oauthError("invalid_request", form.description);
  const token = form.params.get("token");
  if (!token) return oauthError("invalid_request", "token is required");

  try {
    await revokeFamilyByToken(token, form.params.get("client_id"));
  } catch (error) {
    console.error("oauth/revoke: revocation failed", error instanceof Error ? error.message : "unknown error");
    return oauthError("server_error", "Temporary failure, try again", 500);
  }
  return new NextResponse(null, { status: 200, headers: { "Cache-Control": "no-store" } });
};
