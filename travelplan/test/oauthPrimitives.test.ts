import { afterEach, describe, expect, it } from "vitest";
import {
  assertMcpConfigured,
  getAllowedClientIdRules,
  getIssuer,
  getMcpResourceUrl,
  isMcpEnabled,
} from "@/lib/oauth/config";
import { isValidPkceValue, verifyS256 } from "@/lib/oauth/pkce";
import { isLoopbackRedirectUri, matchesRegisteredRedirectUri } from "@/lib/oauth/redirectUri";
import { safeOAuthReturnTo } from "@/lib/oauth/returnTo";
import { generateOpaqueToken, hashOpaqueToken } from "@/lib/oauth/secrets";

const ENV_KEYS = ["MCP_ENABLED", "APP_BASE_URL", "MCP_CLIENT_ID_HOSTS", "NODE_ENV", "NEXT_PHASE"] as const;
const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const env = process.env as Record<string, string | undefined>;

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete env[key];
    else env[key] = savedEnv[key];
  }
});

describe("oauth config", () => {
  it("is off unless MCP_ENABLED is exactly true", () => {
    delete env.MCP_ENABLED;
    expect(isMcpEnabled()).toBe(false);
    env.MCP_ENABLED = "1";
    expect(isMcpEnabled()).toBe(false);
    env.MCP_ENABLED = "true";
    expect(isMcpEnabled()).toBe(true);
  });

  it("uses the origin of APP_BASE_URL as issuer and resource base", () => {
    env.APP_BASE_URL = "https://plan.example.test/some/path/";
    expect(getIssuer()).toBe("https://plan.example.test");
    expect(getMcpResourceUrl()).toBe("https://plan.example.test/api/mcp");
  });

  it("defaults the client id allowlist to claude.ai/oauth/ and parses host and host/path entries", () => {
    delete env.MCP_CLIENT_ID_HOSTS;
    expect(getAllowedClientIdRules()).toEqual([{ host: "claude.ai", pathPrefix: "/oauth/" }]);
    env.MCP_CLIENT_ID_HOSTS = " Claude.ai/oauth/ , https://example.org ,claude.com.";
    expect(getAllowedClientIdRules()).toEqual([
      { host: "claude.ai", pathPrefix: "/oauth/" },
      { host: "example.org", pathPrefix: "/" },
      { host: "claude.com", pathPrefix: "/" },
    ]);
  });

  it("skips malformed entries and falls back to the default when none remain", () => {
    env.MCP_CLIENT_ID_HOSTS = "claude.ai:8443, http://claude.ai, claude.ai/x?y=1, , ";
    expect(getAllowedClientIdRules()).toEqual([{ host: "claude.ai", pathPrefix: "/oauth/" }]);
    env.MCP_CLIENT_ID_HOSTS = "bücher.example";
    expect(getAllowedClientIdRules()).toEqual([{ host: "xn--bcher-kva.example", pathPrefix: "/" }]);
  });

  it("boot check throws only in production with the connector on and no https base url", () => {
    env.NODE_ENV = "production";
    env.MCP_ENABLED = "true";
    env.APP_BASE_URL = "http://plan.example.test";
    expect(() => assertMcpConfigured()).toThrow(/APP_BASE_URL/);
    delete env.APP_BASE_URL;
    expect(() => assertMcpConfigured()).toThrow(/APP_BASE_URL/);
    env.APP_BASE_URL = "https://plan.example.test";
    expect(() => assertMcpConfigured()).not.toThrow();
    env.APP_BASE_URL = "http://plan.example.test";
    env.NEXT_PHASE = "phase-production-build";
    expect(() => assertMcpConfigured()).not.toThrow();
    delete env.NEXT_PHASE;
    env.MCP_ENABLED = "false";
    expect(() => assertMcpConfigured()).not.toThrow();
    env.MCP_ENABLED = "true";
    env.NODE_ENV = "test";
    expect(() => assertMcpConfigured()).not.toThrow();
  });
});

describe("pkce", () => {
  // RFC 7636 Appendix B.
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

  it("accepts the RFC 7636 example and refuses a mismatch", () => {
    expect(verifyS256(verifier, challenge)).toBe(true);
    expect(verifyS256(`${verifier.slice(0, -1)}A`, challenge)).toBe(false);
  });

  it("refuses values outside 43-128 unreserved characters", () => {
    expect(isValidPkceValue("a".repeat(42))).toBe(false);
    expect(isValidPkceValue("a".repeat(129))).toBe(false);
    expect(isValidPkceValue(`${"a".repeat(42)}+`)).toBe(false);
    expect(verifyS256("short", challenge)).toBe(false);
  });
});

describe("redirect uri matching", () => {
  const claudeCode = ["http://localhost/callback", "http://127.0.0.1/callback"];

  it("matches loopback redirects on any port for localhost and 127.0.0.1", () => {
    expect(matchesRegisteredRedirectUri("http://localhost:3118/callback", claudeCode)).toBe(true);
    expect(matchesRegisteredRedirectUri("http://127.0.0.1:51234/callback", claudeCode)).toBe(true);
    expect(matchesRegisteredRedirectUri("http://localhost/callback", claudeCode)).toBe(true);
  });

  it("does not relax path, query, scheme or host for loopback", () => {
    expect(matchesRegisteredRedirectUri("http://localhost:3118/callback/x", claudeCode)).toBe(false);
    expect(matchesRegisteredRedirectUri("http://localhost:3118/callback?x=1", claudeCode)).toBe(false);
    expect(matchesRegisteredRedirectUri("https://localhost:3118/callback", claudeCode)).toBe(false);
    expect(matchesRegisteredRedirectUri("http://[::1]:3118/callback", claudeCode)).toBe(false);
    expect(matchesRegisteredRedirectUri("http://evil.example:3118/callback", claudeCode)).toBe(false);
  });

  it("requires an exact match for https redirects", () => {
    const hosted = ["https://claude.ai/api/mcp/auth_callback"];
    expect(matchesRegisteredRedirectUri("https://claude.ai/api/mcp/auth_callback", hosted)).toBe(true);
    expect(matchesRegisteredRedirectUri("https://claude.ai/api/mcp/auth_callback/", hosted)).toBe(false);
    expect(matchesRegisteredRedirectUri("https://claude.ai:8443/api/mcp/auth_callback", hosted)).toBe(false);
    expect(matchesRegisteredRedirectUri("https://claude.ai/api/mcp/auth_callback?x=1", hosted)).toBe(false);
  });

  it("recognises loopback redirects", () => {
    expect(isLoopbackRedirectUri("http://localhost/callback")).toBe(true);
    expect(isLoopbackRedirectUri("http://127.0.0.1:9/cb")).toBe(true);
    expect(isLoopbackRedirectUri("https://claude.ai/api/mcp/auth_callback")).toBe(false);
  });
});

describe("login returnTo", () => {
  it("accepts only the authorize step", () => {
    expect(safeOAuthReturnTo("/oauth/authorize?client_id=x&state=y")).toBe("/oauth/authorize?client_id=x&state=y");
    expect(safeOAuthReturnTo("/trips")).toBeNull();
    expect(safeOAuthReturnTo("//evil.example/oauth/authorize?x")).toBeNull();
    expect(safeOAuthReturnTo("https://evil.example/oauth/authorize?x")).toBeNull();
    expect(safeOAuthReturnTo("/oauth/authorize?x\\@evil")).toBeNull();
    expect(safeOAuthReturnTo("/oauth/authorize?x\n")).toBeNull();
    expect(safeOAuthReturnTo("/oauth/authorize")).toBeNull();
    expect(safeOAuthReturnTo(null)).toBeNull();
  });
});

describe("opaque tokens", () => {
  it("are 43-character base64url values with a stable sha256 hash", () => {
    const token = generateOpaqueToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateOpaqueToken()).not.toBe(token);
    expect(hashOpaqueToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashOpaqueToken(token)).toBe(hashOpaqueToken(token));
  });
});
