import type { NextRequest } from "next/server";
import { apiError } from "@/lib/errors/apiError";
import { fail, ok } from "@/lib/http/response";
import { requireSession } from "@/lib/auth/sessionGuard";
import { isMcpEnabled } from "@/lib/oauth/config";
import { listConnectionsForUser } from "@/lib/repositories/oauthRepo";

export const runtime = "nodejs";

/**
 * Story 15.3. The signed-in user's active connector connections for *Connected apps* - one entry per token
 * family, newest first. The listing rules (active, connected since, last used) live in
 * `listConnectionsForUser`; this route only gates and shapes.
 *
 * Gated on `isMcpEnabled()` first, like every other connector endpoint: with the connector off there is
 * nothing to manage, and the route answers 404 rather than an empty list so it does not exist at all.
 *
 * `requireSession` because `/api/users/*` is outside the proxy matcher (see `proxy.ts`). Strictly the
 * caller's own rows - there is no admin view of other users' connections. No CSRF on a read; `no-store`
 * because the body says which assistants hold access to this account.
 */
export const GET = async (request: NextRequest) => {
  if (!isMcpEnabled()) {
    return fail(apiError("not_found", "Not found"), 404);
  }

  const auth = await requireSession(request);
  if (auth.response) {
    return auth.response;
  }

  try {
    const connections = await listConnectionsForUser(auth.session.sub);
    return ok(
      {
        connections: connections.map((connection) => ({
          id: connection.id,
          clientName: connection.clientName,
          redirectHost: connection.redirectHost,
          connectedAt: connection.connectedAt.toISOString(),
          lastUsedAt: connection.lastUsedAt?.toISOString() ?? null,
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return fail(apiError("server_error", "Unable to load connections"), 500);
  }
};
