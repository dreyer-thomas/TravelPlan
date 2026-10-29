import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET as getProtectedResource } from "@/app/.well-known/oauth-protected-resource/route";
import { GET as getProtectedResourceInserted } from "@/app/.well-known/oauth-protected-resource/api/mcp/route";
import { GET as getAuthorizationServer } from "@/app/.well-known/oauth-authorization-server/route";
import { POST as postDecision } from "@/app/api/oauth/authorize/decision/route";
import { POST as postToken } from "@/app/api/oauth/token/route";
import { POST as postRevoke } from "@/app/api/oauth/revoke/route";
import { prisma } from "@/lib/db/prisma";
import { createAuthorizationCode, findActiveAccessToken } from "@/lib/repositories/oauthRepo";
import { hashOpaqueToken } from "@/lib/oauth/secrets";
import {
  authorizeQuery,
  cleanOAuthTables,
  createUser,
  formRequest,
  HOSTED_CLIENT_ID,
  HOSTED_REDIRECT,
  ISSUER,
  MCP_RESOURCE,
  PKCE_CHALLENGE,
  PKCE_VERIFIER,
  sessionCookieFor,
  setupConnectorEnvironment,
} from "./helpers/oauthFixtures";

setupConnectorEnvironment();

const TOKEN_URL = `${ISSUER}/api/oauth/token`;

const issueCode = async (userId: string, now?: Date) =>
  createAuthorizationCode({
    userId,
    clientId: HOSTED_CLIENT_ID,
    clientName: "Claude",
    redirectUri: HOSTED_REDIRECT,
    codeChallenge: PKCE_CHALLENGE,
    resource: MCP_RESOURCE,
    scope: "trips",
    now,
  });

const codeGrant = (code: string, overrides: Record<string, string> = {}) =>
  formRequest(TOKEN_URL, {
    grant_type: "authorization_code",
    code,
    client_id: HOSTED_CLIENT_ID,
    redirect_uri: HOSTED_REDIRECT,
    code_verifier: PKCE_VERIFIER,
    resource: MCP_RESOURCE,
    ...overrides,
  });

const refreshGrant = (refreshToken: string, overrides: Record<string, string> = {}) =>
  formRequest(TOKEN_URL, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: HOSTED_CLIENT_ID,
    ...overrides,
  });

type TokenBody = { access_token: string; refresh_token: string; token_type: string; expires_in: number; scope: string; error?: string };

const exchange = async (userId: string) => {
  const code = await issueCode(userId);
  const response = await postToken(codeGrant(code));
  return (await response.json()) as TokenBody;
};

beforeEach(async () => {
  await cleanOAuthTables();
});

describe("discovery metadata", () => {
  it("serves the protected-resource metadata on both paths", async () => {
    for (const get of [getProtectedResource, getProtectedResourceInserted]) {
      const response = get();
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("public, max-age=300");
      expect(await response.json()).toEqual({
        resource: MCP_RESOURCE,
        authorization_servers: [ISSUER],
        scopes_supported: ["trips"],
        bearer_methods_supported: ["header"],
        resource_name: "TravelPlan",
      });
    }
  });

  it("serves the authorization-server metadata without a registration endpoint", async () => {
    const body = (await getAuthorizationServer().json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/oauth/authorize`,
      token_endpoint: `${ISSUER}/api/oauth/token`,
      revocation_endpoint: `${ISSUER}/api/oauth/revoke`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: ["trips", "offline_access"],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
    });
    expect(body).not.toHaveProperty("registration_endpoint");
  });

  it("answers 404 everywhere while the connector is off", async () => {
    process.env.MCP_ENABLED = "false";
    expect(getProtectedResource().status).toBe(404);
    expect(getProtectedResourceInserted().status).toBe(404);
    expect(getAuthorizationServer().status).toBe(404);
    expect((await postToken(codeGrant("x"))).status).toBe(404);
    expect((await postRevoke(formRequest(`${ISSUER}/api/oauth/revoke`, { token: "x" }))).status).toBe(404);
  });
});

describe("POST /api/oauth/authorize/decision", () => {
  const decisionRequest = (body: unknown, cookie: string | null, csrf = true) =>
    new NextRequest(`${ISSUER}/api/oauth/authorize/decision`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(csrf ? { "x-csrf-token": "test-csrf-token" } : {}),
        cookie: [csrf ? "csrf_token=test-csrf-token" : null, cookie].filter(Boolean).join("; "),
      },
      body: JSON.stringify(body),
    });

  it("refuses without CSRF (403) and without a session (401)", async () => {
    const user = await createUser();
    const cookie = await sessionCookieFor(user);
    expect((await postDecision(decisionRequest({ query: authorizeQuery().toString(), decision: "allow" }, cookie, false))).status).toBe(403);
    expect((await postDecision(decisionRequest({ query: authorizeQuery().toString(), decision: "allow" }, null))).status).toBe(401);
  });

  it("denies with access_denied, state and iss", async () => {
    const user = await createUser();
    const response = await postDecision(
      decisionRequest({ query: authorizeQuery().toString(), decision: "deny" }, await sessionCookieFor(user)),
    );
    const body = (await response.json()) as { data: { redirectUrl: string } };
    const url = new URL(body.data.redirectUrl);
    expect(url.origin + url.pathname).toBe(HOSTED_REDIRECT);
    expect(url.searchParams.get("error")).toBe("access_denied");
    expect(url.searchParams.get("state")).toBe("state-123");
    expect(url.searchParams.get("iss")).toBe(ISSUER);
    expect(await prisma.oAuthAuthorizationCode.count()).toBe(0);
  });

  it("allows with a single-use code bound to the request", async () => {
    const user = await createUser();
    const response = await postDecision(
      decisionRequest({ query: authorizeQuery().toString(), decision: "allow" }, await sessionCookieFor(user)),
    );
    const body = (await response.json()) as { data: { redirectUrl: string } };
    const url = new URL(body.data.redirectUrl);
    const code = url.searchParams.get("code");
    expect(code).toBeTruthy();
    expect(url.searchParams.get("iss")).toBe(ISSUER);
    const row = await prisma.oAuthAuthorizationCode.findUnique({ where: { codeHash: hashOpaqueToken(code!) } });
    expect(row).toMatchObject({ userId: user.id, clientId: HOSTED_CLIENT_ID, redirectUri: HOSTED_REDIRECT, resource: MCP_RESOURCE });
    const tokens = (await (await postToken(codeGrant(code!))).json()) as TokenBody;
    expect(tokens.access_token).toBeTruthy();
  });

  it("re-validates the query and refuses an invalid client without a redirect", async () => {
    const user = await createUser();
    const response = await postDecision(
      decisionRequest(
        { query: authorizeQuery({ redirect_uri: "https://evil.example/cb" }).toString(), decision: "allow" },
        await sessionCookieFor(user),
      ),
    );
    expect(response.status).toBe(400);
    expect(await prisma.oAuthAuthorizationCode.count()).toBe(0);
  });

  it("refuses a session that must change its password", async () => {
    const user = await createUser({ mustChangePassword: true });
    const response = await postDecision(
      decisionRequest({ query: authorizeQuery().toString(), decision: "allow" }, await sessionCookieFor(user)),
    );
    expect(response.status).toBe(403);
  });
});

describe("POST /api/oauth/token (authorization_code)", () => {
  it("exchanges a code once for a bearer pair with no-store headers", async () => {
    const user = await createUser();
    const code = await issueCode(user.id);
    const response = await postToken(codeGrant(code));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("pragma")).toBe("no-cache");
    const body = (await response.json()) as TokenBody;
    expect(body).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: "trips" });
    expect(body.access_token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.refresh_token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // Only hashes are stored.
    expect(await prisma.oAuthToken.count({ where: { tokenHash: body.access_token } })).toBe(0);
    expect(await prisma.oAuthToken.count({ where: { tokenHash: hashOpaqueToken(body.access_token) } })).toBe(1);
  });

  it("revokes the issued family when a code is presented again", async () => {
    const user = await createUser();
    const code = await issueCode(user.id);
    const first = (await (await postToken(codeGrant(code))).json()) as TokenBody;
    const second = await postToken(codeGrant(code));
    expect(second.status).toBe(400);
    expect(((await second.json()) as TokenBody).error).toBe("invalid_grant");
    expect(await findActiveAccessToken(first.access_token)).toBeNull();
  });

  it.each([
    [{ code_verifier: "x".repeat(43) }],
    [{ redirect_uri: "https://claude.ai/other" }],
    [{ client_id: "https://claude.ai/oauth/other" }],
  ])("refuses a mismatching %o with invalid_grant", async (overrides) => {
    const user = await createUser();
    const code = await issueCode(user.id);
    const response = await postToken(codeGrant(code, overrides));
    expect(response.status).toBe(400);
    expect(((await response.json()) as TokenBody).error).toBe("invalid_grant");
    // A failed attempt does not burn the code for the legitimate client.
    expect((await postToken(codeGrant(code))).status).toBe(200);
  });

  it("refuses a wrong resource with invalid_target and an expired code with invalid_grant", async () => {
    const user = await createUser();
    const code = await issueCode(user.id);
    const wrong = await postToken(codeGrant(code, { resource: "https://other.example/api/mcp" }));
    expect(((await wrong.json()) as TokenBody).error).toBe("invalid_target");
    const old = await issueCode(user.id, new Date(Date.now() - 61_000));
    const expired = await postToken(codeGrant(old));
    expect(((await expired.json()) as TokenBody).error).toBe("invalid_grant");
  });

  it("refuses JSON bodies, duplicated parameters and unknown grants", async () => {
    const json = new NextRequest(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant_type: "authorization_code" }),
    });
    const jsonResponse = await postToken(json);
    expect(jsonResponse.status).toBe(400);
    expect(((await jsonResponse.json()) as TokenBody).error).toBe("invalid_request");

    const duplicated = new NextRequest(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "grant_type=refresh_token&refresh_token=a&refresh_token=b&client_id=x",
    });
    expect(((await (await postToken(duplicated)).json()) as TokenBody).error).toBe("invalid_request");

    const unknown = formRequest(TOKEN_URL, { grant_type: "password", client_id: HOSTED_CLIENT_ID });
    expect(((await (await postToken(unknown)).json()) as TokenBody).error).toBe("unsupported_grant_type");
  });
});

describe("POST /api/oauth/token (refresh_token)", () => {
  it("rotates within the same family", async () => {
    const user = await createUser();
    const first = await exchange(user.id);
    const response = await postToken(refreshGrant(first.refresh_token));
    expect(response.status).toBe(200);
    const second = (await response.json()) as TokenBody;
    expect(second.refresh_token).not.toBe(first.refresh_token);
    const families = await prisma.oAuthToken.groupBy({ by: ["familyId"] });
    expect(families).toHaveLength(1);
  });

  it("does not revoke on a parallel refresh inside the 30 s grace window", async () => {
    const user = await createUser();
    const first = await exchange(user.id);
    const second = (await (await postToken(refreshGrant(first.refresh_token))).json()) as TokenBody;
    const race = await postToken(refreshGrant(first.refresh_token));
    expect(((await race.json()) as TokenBody).error).toBe("invalid_grant");
    expect(await findActiveAccessToken(second.access_token)).not.toBeNull();
  });

  it("revokes the whole family on reuse after the grace window", async () => {
    const user = await createUser();
    const first = await exchange(user.id);
    const second = (await (await postToken(refreshGrant(first.refresh_token))).json()) as TokenBody;
    await prisma.oAuthToken.update({
      where: { tokenHash: hashOpaqueToken(first.refresh_token) },
      data: { rotatedAt: new Date(Date.now() - 31_000) },
    });
    const reuse = await postToken(refreshGrant(first.refresh_token));
    expect(((await reuse.json()) as TokenBody).error).toBe("invalid_grant");
    expect(await findActiveAccessToken(second.access_token)).toBeNull();
    expect(((await (await postToken(refreshGrant(second.refresh_token))).json()) as TokenBody).error).toBe("invalid_grant");
  });

  it("refuses an expired refresh token, an access token and a foreign client", async () => {
    const user = await createUser();
    const first = await exchange(user.id);
    expect(((await (await postToken(refreshGrant(first.access_token))).json()) as TokenBody).error).toBe("invalid_grant");
    expect(
      ((await (await postToken(refreshGrant(first.refresh_token, { client_id: "https://claude.ai/oauth/x" }))).json()) as TokenBody)
        .error,
    ).toBe("invalid_grant");
    await prisma.oAuthToken.update({
      where: { tokenHash: hashOpaqueToken(first.refresh_token) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(((await (await postToken(refreshGrant(first.refresh_token))).json()) as TokenBody).error).toBe("invalid_grant");
  });

  it("never extends a family past 30 days from consent", async () => {
    const user = await createUser();
    const first = await exchange(user.id);
    const familyEnd = new Date(Date.now() + 60_000);
    await prisma.oAuthToken.updateMany({ data: { familyExpiresAt: familyEnd } });
    const second = (await (await postToken(refreshGrant(first.refresh_token))).json()) as TokenBody;
    const row = await prisma.oAuthToken.findUnique({ where: { tokenHash: hashOpaqueToken(second.refresh_token) } });
    expect(row?.expiresAt.getTime()).toBe(familyEnd.getTime());
  });
});

describe("POST /api/oauth/revoke", () => {
  it("revokes the whole family and answers 200 for unknown tokens", async () => {
    const user = await createUser();
    const tokens = await exchange(user.id);
    const response = await postRevoke(formRequest(`${ISSUER}/api/oauth/revoke`, { token: tokens.refresh_token }));
    expect(response.status).toBe(200);
    expect(await findActiveAccessToken(tokens.access_token)).toBeNull();
    const unknown = await postRevoke(formRequest(`${ISSUER}/api/oauth/revoke`, { token: "nothing" }));
    expect(unknown.status).toBe(200);
  });
});

describe("housekeeping and cascade", () => {
  it("deletes rows expired more than a day ago when tokens are issued", async () => {
    const user = await createUser();
    await issueCode(user.id, new Date(Date.now() - 3 * 24 * 60 * 60 * 1000));
    await exchange(user.id);
    expect(await prisma.oAuthAuthorizationCode.count({ where: { expiresAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } } })).toBe(0);
  });

  it("deletes a user's codes and tokens with the user", async () => {
    const user = await createUser();
    await exchange(user.id);
    await issueCode(user.id);
    await prisma.user.delete({ where: { id: user.id } });
    expect(await prisma.oAuthToken.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.oAuthAuthorizationCode.count({ where: { userId: user.id } })).toBe(0);
  });

  it("logs nothing that contains a token", async () => {
    const spies = [vi.spyOn(console, "info"), vi.spyOn(console, "warn"), vi.spyOn(console, "error")];
    const user = await createUser();
    const tokens = await exchange(user.id);
    await postToken(refreshGrant(tokens.refresh_token));
    const logged = spies.flatMap((spy) => spy.mock.calls.flat().map(String)).join("\n");
    expect(logged).not.toContain(tokens.refresh_token);
    expect(logged).not.toContain(tokens.access_token);
    spies.forEach((spy) => spy.mockRestore());
  });
});
