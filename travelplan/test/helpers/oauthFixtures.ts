import { afterEach, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createSessionJwt } from "@/lib/auth/jwt";
import { resetOAuthHousekeepingForTests } from "@/lib/repositories/oauthRepo";
import { prisma } from "@/lib/db/prisma";
import type { GuardedFetchResult } from "@/lib/http/guardedFetch";
import {
  resetClientMetadataCacheForTests,
  setClientMetadataFetcherForTests,
} from "@/lib/oauth/clientMetadata";

/** Story 15.1 test fixtures for the connector's OAuth server. No network: the CIMD fetch is replaced. */

export const ISSUER = "https://plan.example.test";
export const MCP_RESOURCE = `${ISSUER}/api/mcp`;
export const CLAUDE_CODE_CLIENT_ID = "https://claude.ai/oauth/claude-code-client-metadata";
export const HOSTED_CLIENT_ID = "https://claude.ai/oauth/hosted-client-metadata";
export const HOSTED_REDIRECT = "https://claude.ai/api/mcp/auth_callback";
// RFC 7636 Appendix B.
export const PKCE_VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
export const PKCE_CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

export const documents: Record<string, unknown> = {
  [CLAUDE_CODE_CLIENT_ID]: {
    client_id: CLAUDE_CODE_CLIENT_ID,
    client_name: "Claude Code",
    redirect_uris: ["http://localhost/callback", "http://127.0.0.1/callback"],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  },
  [HOSTED_CLIENT_ID]: {
    client_id: HOSTED_CLIENT_ID,
    client_name: "Claude",
    redirect_uris: [HOSTED_REDIRECT],
    token_endpoint_auth_method: "none",
  },
};

export const fetchCalls: string[] = [];

const ENV_KEYS = ["MCP_ENABLED", "APP_BASE_URL", "MCP_CLIENT_ID_HOSTS"] as const;

/** Turns the connector on with a fixed issuer and a fake CIMD fetcher, and restores everything after. */
export const setupConnectorEnvironment = () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const key of ENV_KEYS) saved[key] = process.env[key];
    process.env.MCP_ENABLED = "true";
    process.env.APP_BASE_URL = ISSUER;
    delete process.env.MCP_CLIENT_ID_HOSTS;
    fetchCalls.length = 0;
    resetClientMetadataCacheForTests();
    resetOAuthHousekeepingForTests();
    // The process-wide outbound fetch budget would otherwise carry over between tests.
    (globalThis as { rateLimitStore?: Map<string, unknown> }).rateLimitStore?.delete("oauth-client-metadata-fetch");
    setClientMetadataFetcherForTests(async (url): Promise<GuardedFetchResult> => {
      fetchCalls.push(url);
      const document = documents[url];
      if (!document) return { ok: true, status: 404, headers: {}, body: new Uint8Array(), url };
      return {
        ok: true,
        status: 200,
        headers: { "content-type": "application/json" },
        body: new Uint8Array(Buffer.from(JSON.stringify(document))),
        url,
      };
    });
  });
  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    setClientMetadataFetcherForTests(null);
    resetClientMetadataCacheForTests();
  });
};

export const cleanOAuthTables = async () => {
  await prisma.oAuthToken.deleteMany();
  await prisma.oAuthAuthorizationCode.deleteMany();
};

let userCounter = 0;
export const createUser = async (overrides: { mustChangePassword?: boolean } = {}) => {
  userCounter += 1;
  return prisma.user.create({
    data: {
      email: `oauth-user-${Date.now()}-${userCounter}@example.com`,
      passwordHash: "not-a-real-hash",
      mustChangePassword: overrides.mustChangePassword ?? false,
    },
  });
};

export const sessionCookieFor = async (user: { id: string; role: string; mustChangePassword: boolean }) =>
  `session=${await createSessionJwt({ sub: user.id, role: user.role, mustChangePassword: user.mustChangePassword })}`;

export const authorizeQuery = (overrides: Record<string, string | null> = {}) => {
  const params = new URLSearchParams();
  const values: Record<string, string | null> = {
    response_type: "code",
    client_id: HOSTED_CLIENT_ID,
    redirect_uri: HOSTED_REDIRECT,
    code_challenge: PKCE_CHALLENGE,
    code_challenge_method: "S256",
    resource: MCP_RESOURCE,
    scope: "trips offline_access",
    state: "state-123",
    ...overrides,
  };
  for (const [key, value] of Object.entries(values)) {
    if (value !== null) params.set(key, value);
  }
  return params;
};

export const formRequest = (url: string, values: Record<string, string>, contentType = "application/x-www-form-urlencoded") =>
  new NextRequest(url, {
    method: "POST",
    headers: { "content-type": contentType, "x-forwarded-for": `10.9.${userCounter % 250}.${Math.floor(Math.random() * 250)}` },
    body: new URLSearchParams(values).toString(),
  });
