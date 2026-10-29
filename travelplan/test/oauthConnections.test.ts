import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET as getConnections } from "@/app/api/users/me/connections/route";
import { DELETE as deleteConnection } from "@/app/api/users/me/connections/[familyId]/route";
import { POST as postMcp } from "@/app/api/mcp/route";
import { POST as postToken } from "@/app/api/oauth/token/route";
import { POST as postRevoke } from "@/app/api/oauth/revoke/route";
import { prisma } from "@/lib/db/prisma";
import { REFRESH_TOKEN_TTL_MS } from "@/lib/oauth/config";
import { hashOpaqueToken } from "@/lib/oauth/secrets";
import {
  listConnectionsForUser,
  revokeAllTokensForUser,
  revokeConnectionForUser,
} from "@/lib/repositories/oauthRepo";
import {
  cleanOAuthTables,
  createUser,
  exchange,
  formRequest,
  HOSTED_REDIRECT,
  ISSUER,
  refreshGrant,
  sessionCookieFor,
  setupConnectorEnvironment,
  type TokenBody,
} from "./helpers/oauthFixtures";
import { rpc } from "./helpers/mcpClient";

/**
 * Story 15.3. *Connected apps*: the repository's listing and revocation rules, the two session routes
 * against the I/O matrix, and the effect a disconnect has on the assistant holding the tokens.
 */

setupConnectorEnvironment();

const CONNECTIONS_URL = "http://localhost/api/users/me/connections";
const CSRF = "test-csrf-token";

type ApiEnvelope<T> = { data: T | null; error: { code: string; message: string } | null };
type ConnectionBody = {
  connections: { id: string; clientName: string; redirectHost: string | null; connectedAt: string; lastUsedAt: string | null }[];
};

type User = Awaited<ReturnType<typeof createUser>>;

const listRequest = async (user: User | null) =>
  new NextRequest(CONNECTIONS_URL, { headers: user ? { cookie: await sessionCookieFor(user) } : {} });

const deleteRequest = async (user: User | null, familyId: string, options: { csrf?: boolean } = {}) => {
  const cookies = [user ? await sessionCookieFor(user) : null, options.csrf === false ? null : `csrf_token=${CSRF}`]
    .filter(Boolean)
    .join("; ");
  const headers: Record<string, string> = { cookie: cookies };
  if (options.csrf !== false) headers["x-csrf-token"] = CSRF;
  return deleteConnection(new NextRequest(`${CONNECTIONS_URL}/${familyId}`, { method: "DELETE", headers }), {
    params: Promise.resolve({ familyId }),
  });
};

const familyOf = async (token: string) =>
  (await prisma.oAuthToken.findUniqueOrThrow({ where: { tokenHash: hashOpaqueToken(token) } })).familyId;

const callMcp = (token: string) =>
  postMcp(rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, { authorization: `Bearer ${token}` }));

const rotate = async (refreshToken: string) => (await (await postToken(refreshGrant(refreshToken))).json()) as TokenBody;

beforeEach(async () => {
  await cleanOAuthTables();
});

describe("listConnectionsForUser", () => {
  it("lists each active family once, newest first, and skips revoked and expired ones", async () => {
    const user = await createUser();
    const older = await exchange(user.id);
    // Rotated twice: three pairs, still one connection.
    const rotatedOnce = await rotate(older.refresh_token);
    await rotate(rotatedOnce.refresh_token);
    const newer = await exchange(user.id);
    const revoked = await exchange(user.id);
    const expired = await exchange(user.id);

    const olderFamily = await familyOf(older.access_token);
    const newerFamily = await familyOf(newer.access_token);
    await prisma.oAuthToken.updateMany({
      where: { familyId: olderFamily },
      data: { familyExpiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS - 60_000) },
    });
    await revokeConnectionForUser(user.id, await familyOf(revoked.access_token));
    await prisma.oAuthToken.updateMany({
      where: { familyId: await familyOf(expired.access_token) },
      data: { familyExpiresAt: new Date(Date.now() - 1000) },
    });

    const connections = await listConnectionsForUser(user.id);
    expect(connections.map((connection) => connection.id)).toEqual([newerFamily, olderFamily]);
    expect(connections[0]).toMatchObject({ clientName: "Claude", redirectHost: new URL(HOSTED_REDIRECT).host, lastUsedAt: null });
  });

  it("derives connected-since from the family end and last-used from the newest row", async () => {
    const user = await createUser();
    const tokens = await exchange(user.id);
    const familyId = await familyOf(tokens.access_token);
    const familyExpiresAt = new Date("2026-11-20T10:00:00.000Z");
    const recent = new Date("2026-10-28T09:00:00.000Z");
    await prisma.oAuthToken.updateMany({ where: { familyId }, data: { familyExpiresAt } });
    await prisma.oAuthToken.updateMany({ where: { familyId, kind: "ACCESS" }, data: { lastUsedAt: new Date("2026-10-27T09:00:00.000Z") } });
    await prisma.oAuthToken.updateMany({ where: { familyId, kind: "REFRESH" }, data: { lastUsedAt: recent } });

    const [connection] = await listConnectionsForUser(user.id, new Date("2026-10-29T00:00:00.000Z"));
    expect(connection.connectedAt.toISOString()).toBe(new Date(familyExpiresAt.getTime() - REFRESH_TOKEN_TTL_MS).toISOString());
    expect(connection.lastUsedAt?.toISOString()).toBe(recent.toISOString());
  });

  it("shows no host for a family issued before the redirect URI was stored", async () => {
    const user = await createUser();
    const tokens = await exchange(user.id);
    await prisma.oAuthToken.updateMany({ where: { familyId: await familyOf(tokens.access_token) }, data: { redirectUri: null } });

    const [connection] = await listConnectionsForUser(user.id);
    expect(connection.redirectHost).toBeNull();
  });

  it("copies the redirect URI from the code and carries it through rotation", async () => {
    const user = await createUser();
    const first = await exchange(user.id);
    const second = await rotate(first.refresh_token);
    const rows = await prisma.oAuthToken.findMany({ where: { familyId: await familyOf(second.access_token) } });
    expect(rows).toHaveLength(4);
    for (const row of rows) expect(row.redirectUri).toBe(HOSTED_REDIRECT);
  });

  it("never lists another user's family", async () => {
    const user = await createUser();
    const other = await createUser();
    await exchange(other.id);
    expect(await listConnectionsForUser(user.id)).toEqual([]);
  });
});

describe("revokeAllTokensForUser", () => {
  it("revokes every token of the user and none of anyone else's", async () => {
    const user = await createUser();
    const other = await createUser();
    await exchange(user.id);
    await exchange(user.id);
    await exchange(other.id);

    await revokeAllTokensForUser(prisma, user.id);
    expect(await prisma.oAuthToken.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
    expect(await prisma.oAuthToken.count({ where: { userId: other.id, revokedAt: null } })).toBe(2);
  });
});

describe("GET /api/users/me/connections", () => {
  it("answers the caller's active connections in the envelope, with no-store", async () => {
    const user = await createUser();
    const tokens = await exchange(user.id);
    const response = await getConnections(await listRequest(user));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as ApiEnvelope<ConnectionBody>;
    expect(body.error).toBeNull();
    expect(body.data?.connections).toEqual([
      {
        id: await familyOf(tokens.access_token),
        clientName: "Claude",
        redirectHost: new URL(HOSTED_REDIRECT).host,
        connectedAt: expect.any(String),
        lastUsedAt: null,
      },
    ]);
  });

  it("answers 401 without a session", async () => {
    const response = await getConnections(await listRequest(null));
    expect(response.status).toBe(401);
    expect(((await response.json()) as ApiEnvelope<null>).error?.code).toBe("unauthorized");
  });

  it("answers 404 while the connector is off", async () => {
    process.env.MCP_ENABLED = "false";
    const user = await createUser();
    expect((await getConnections(await listRequest(user))).status).toBe(404);
  });
});

describe("DELETE /api/users/me/connections/[familyId]", () => {
  it("revokes the whole family: the access token gets 401 on /api/mcp and the refresh token invalid_grant", async () => {
    const user = await createUser();
    const tokens = await exchange(user.id);
    const rotated = await rotate(tokens.refresh_token);
    const familyId = await familyOf(rotated.access_token);
    expect((await callMcp(rotated.access_token)).status).toBe(200);

    const response = await deleteRequest(user, familyId);
    expect(response.status).toBe(200);
    expect(((await response.json()) as ApiEnvelope<{ revoked: boolean }>).data).toEqual({ revoked: true });

    // Marked, not deleted.
    const rows = await prisma.oAuthToken.findMany({ where: { familyId } });
    expect(rows).toHaveLength(4);
    for (const row of rows) expect(row.revokedAt).not.toBeNull();

    expect((await callMcp(rotated.access_token)).status).toBe(401);
    expect((await rotate(rotated.refresh_token)).error).toBe("invalid_grant");
    expect(await listConnectionsForUser(user.id)).toEqual([]);
  });

  it("answers 404 for another user's family and leaves its rows alone", async () => {
    const user = await createUser();
    const other = await createUser();
    const tokens = await exchange(other.id);
    const familyId = await familyOf(tokens.access_token);

    const response = await deleteRequest(user, familyId);
    expect(response.status).toBe(404);
    expect(((await response.json()) as ApiEnvelope<null>).error?.code).toBe("not_found");
    expect(await prisma.oAuthToken.count({ where: { familyId, revokedAt: null } })).toBe(2);
  });

  it("answers 404 for an unknown or already revoked family", async () => {
    const user = await createUser();
    const tokens = await exchange(user.id);
    const familyId = await familyOf(tokens.access_token);
    expect((await deleteRequest(user, "no-such-family")).status).toBe(404);
    expect((await deleteRequest(user, familyId)).status).toBe(200);
    expect((await deleteRequest(user, familyId)).status).toBe(404);
  });

  it("answers 403 csrf_invalid without the token and 401 without a session, revoking nothing", async () => {
    const user = await createUser();
    const tokens = await exchange(user.id);
    const familyId = await familyOf(tokens.access_token);

    const noCsrf = await deleteRequest(user, familyId, { csrf: false });
    expect(noCsrf.status).toBe(403);
    expect(((await noCsrf.json()) as ApiEnvelope<null>).error?.code).toBe("csrf_invalid");

    const noSession = await deleteRequest(null, familyId);
    expect(noSession.status).toBe(401);

    expect(await prisma.oAuthToken.count({ where: { familyId, revokedAt: null } })).toBe(2);
  });

  it("answers 404 while the connector is off", async () => {
    const user = await createUser();
    const tokens = await exchange(user.id);
    const familyId = await familyOf(tokens.access_token);
    process.env.MCP_ENABLED = "false";
    expect((await deleteRequest(user, familyId)).status).toBe(404);
    expect(await prisma.oAuthToken.count({ where: { familyId, revokedAt: null } })).toBe(2);
  });
});

describe("RFC 7009 revocation by the client itself", () => {
  it("revokes the connection of the access token it is given, which then leaves the list", async () => {
    const user = await createUser();
    const tokens = await exchange(user.id);
    expect(await listConnectionsForUser(user.id)).toHaveLength(1);

    const response = await postRevoke(formRequest(`${ISSUER}/api/oauth/revoke`, { token: tokens.access_token }));
    expect(response.status).toBe(200);
    expect(await listConnectionsForUser(user.id)).toEqual([]);
    expect((await callMcp(tokens.access_token)).status).toBe(401);
  });
});
