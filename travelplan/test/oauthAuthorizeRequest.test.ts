import { describe, expect, it, vi } from "vitest";
import {
  buildAuthorizationResponseUrl,
  buildErrorRedirectUrl,
  isMcpResource,
  validateAuthorizeRequest,
} from "@/lib/oauth/authorizeRequest";
import { parseClientIdUrl, resolveClientMetadata, setClientMetadataFetcherForTests } from "@/lib/oauth/clientMetadata";
import {
  authorizeQuery,
  CLAUDE_CODE_CLIENT_ID,
  documents,
  fetchCalls,
  HOSTED_CLIENT_ID,
  HOSTED_REDIRECT,
  ISSUER,
  setupConnectorEnvironment,
} from "./helpers/oauthFixtures";

setupConnectorEnvironment();

describe("client id metadata documents", () => {
  it("refuses a client id outside the allowlist without fetching and logs host and path", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const result = await resolveClientMetadata("https://evil.example/oauth/client");
    expect(result).toEqual({ ok: false, reason: "client_not_allowed" });
    expect(fetchCalls).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith("oauth/authorize: client_id not allowed: evil.example/oauth/client");
    warn.mockRestore();
  });

  it("allows claude.ai only under /oauth/ by default (review D1)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await resolveClientMetadata("https://claude.ai/share/abc.json")).toEqual({ ok: false, reason: "client_not_allowed" });
    expect(await resolveClientMetadata("https://claude.ai/oauthx/abc")).toEqual({ ok: false, reason: "client_not_allowed" });
    expect(fetchCalls).toHaveLength(0);
    warn.mockRestore();
  });

  it("logs the host of a non-canonical client id", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await resolveClientMetadata("https://Claude.ai/oauth/x")).toEqual({ ok: false, reason: "invalid_client_id" });
    expect(warn).toHaveBeenCalledWith("oauth/authorize: client_id not canonical: claude.ai/oauth/x");
    warn.mockRestore();
  });

  it("refuses a document not served as application/json", async () => {
    setClientMetadataFetcherForTests(async (url) => ({
      ok: true,
      status: 200,
      headers: { "content-type": "text/plain" },
      body: new Uint8Array(Buffer.from(JSON.stringify(documents[CLAUDE_CODE_CLIENT_ID]))),
      url,
    }));
    expect(await resolveClientMetadata(CLAUDE_CODE_CLIENT_ID)).toEqual({ ok: false, reason: "invalid_document" });
  });

  it("drops javascript:, data:, custom-scheme and plain-http redirect uris and refuses a document left with none", async () => {
    const mixedId = "https://claude.ai/oauth/mixed";
    const evilId = "https://claude.ai/oauth/evil";
    const scriptUri = "javascript:alert(document.cookie)//";
    documents[mixedId] = {
      client_id: mixedId,
      client_name: "Mixed",
      redirect_uris: [scriptUri, "data:text/html,x", "claude://callback", "http://example.com/cb", HOSTED_REDIRECT, "http://127.0.0.1/callback"],
    };
    documents[evilId] = { client_id: evilId, client_name: "Evil", redirect_uris: [scriptUri, "http://example.com/cb"] };
    const mixed = await resolveClientMetadata(mixedId);
    expect(mixed.ok && mixed.client.redirectUris).toEqual([HOSTED_REDIRECT, "http://127.0.0.1/callback"]);
    expect(await resolveClientMetadata(evilId)).toEqual({ ok: false, reason: "invalid_document" });
    const viaScript = await validateAuthorizeRequest(authorizeQuery({ client_id: mixedId, redirect_uri: scriptUri }));
    expect(viaScript).toEqual({ kind: "fatal", reason: "invalid_redirect_uri" });
    delete documents[mixedId];
    delete documents[evilId];
  });

  it("accepts an extra host from MCP_CLIENT_ID_HOSTS", async () => {
    process.env.MCP_CLIENT_ID_HOSTS = "claude.ai,claude.com";
    documents["https://claude.com/oauth/client"] = {
      client_id: "https://claude.com/oauth/client",
      client_name: "Claude",
      redirect_uris: [HOSTED_REDIRECT],
    };
    const result = await resolveClientMetadata("https://claude.com/oauth/client");
    expect(result.ok).toBe(true);
    delete documents["https://claude.com/oauth/client"];
  });

  it.each([
    "http://claude.ai/oauth/x",
    "https://claude.ai:8443/oauth/x",
    "https://claude.ai/",
    "https://claude.ai",
    "https://user@claude.ai/oauth/x",
    "https://claude.ai/oauth/x#frag",
    "not a url",
  ])("refuses the client id shape %s", (raw) => {
    expect(parseClientIdUrl(raw)).toBeNull();
  });

  it("resolves a valid document and caches it", async () => {
    const first = await resolveClientMetadata(CLAUDE_CODE_CLIENT_ID);
    expect(first.ok && first.client.clientName).toBe("Claude Code");
    await resolveClientMetadata(CLAUDE_CODE_CLIENT_ID);
    expect(fetchCalls).toEqual([CLAUDE_CODE_CLIENT_ID]);
  });

  it("refuses a document whose client_id differs from its URL", async () => {
    documents["https://claude.ai/oauth/liar"] = {
      client_id: CLAUDE_CODE_CLIENT_ID,
      client_name: "Liar",
      redirect_uris: [HOSTED_REDIRECT],
    };
    expect(await resolveClientMetadata("https://claude.ai/oauth/liar")).toEqual({ ok: false, reason: "invalid_document" });
    delete documents["https://claude.ai/oauth/liar"];
  });

  it("refuses a document without redirect uris or with a confidential auth method", async () => {
    documents["https://claude.ai/oauth/empty"] = { client_id: "https://claude.ai/oauth/empty", client_name: "X", redirect_uris: [] };
    documents["https://claude.ai/oauth/secret"] = {
      client_id: "https://claude.ai/oauth/secret",
      client_name: "X",
      redirect_uris: [HOSTED_REDIRECT],
      token_endpoint_auth_method: "client_secret_basic",
    };
    expect(await resolveClientMetadata("https://claude.ai/oauth/empty")).toEqual({ ok: false, reason: "invalid_document" });
    expect(await resolveClientMetadata("https://claude.ai/oauth/secret")).toEqual({ ok: false, reason: "invalid_document" });
    delete documents["https://claude.ai/oauth/empty"];
    delete documents["https://claude.ai/oauth/secret"];
  });

  it("caches a failed fetch for a minute only", async () => {
    let calls = 0;
    setClientMetadataFetcherForTests(async () => {
      calls += 1;
      return { ok: false, reason: "timeout" };
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      await resolveClientMetadata(CLAUDE_CODE_CLIENT_ID);
      await resolveClientMetadata(CLAUDE_CODE_CLIENT_ID);
      expect(calls).toBe(1);
      vi.setSystemTime(Date.now() + 61_000);
      await resolveClientMetadata(CLAUDE_CODE_CLIENT_ID);
      expect(calls).toBe(2);
    } finally {
      vi.useRealTimers();
      warn.mockRestore();
    }
  });

  it("shares one fetch between concurrent misses and keeps a no-store document for a minute", async () => {
    let calls = 0;
    setClientMetadataFetcherForTests(async (url) => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return {
        ok: true,
        status: 200,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
        body: new Uint8Array(Buffer.from(JSON.stringify(documents[CLAUDE_CODE_CLIENT_ID]))),
        url,
      };
    });
    const results = await Promise.all([1, 2, 3].map(() => resolveClientMetadata(CLAUDE_CODE_CLIENT_ID)));
    expect(results.every((result) => result.ok)).toBe(true);
    await resolveClientMetadata(CLAUDE_CODE_CLIENT_ID);
    expect(calls).toBe(1);
  });

  it("stops fetching once the process-wide budget is spent", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    for (let index = 0; index < 30; index += 1) {
      await resolveClientMetadata(`https://claude.ai/oauth/missing-${index}`);
    }
    expect(fetchCalls).toHaveLength(30);
    expect(await resolveClientMetadata(CLAUDE_CODE_CLIENT_ID)).toEqual({ ok: false, reason: "fetch_failed" });
    expect(fetchCalls).toHaveLength(30);
    warn.mockRestore();
  });
});

describe("validateAuthorizeRequest", () => {
  it("accepts a complete request from the hosted client", async () => {
    const result = await validateAuthorizeRequest(authorizeQuery());
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.request.scope).toBe("trips");
    expect(result.request.resource).toBe(`${ISSUER}/api/mcp`);
    expect(result.request.state).toBe("state-123");
    expect(result.request.loopbackWarning).toBe(false);
  });

  it("warns when the requested redirect is loopback even if https ones are registered", async () => {
    const bothId = "https://claude.ai/oauth/both";
    documents[bothId] = { client_id: bothId, client_name: "Both", redirect_uris: [HOSTED_REDIRECT, "http://localhost/callback"] };
    const loopback = await validateAuthorizeRequest(
      authorizeQuery({ client_id: bothId, redirect_uri: "http://localhost:4444/callback" }),
    );
    expect(loopback.kind === "ok" && loopback.request.loopbackWarning).toBe(true);
    const hosted = await validateAuthorizeRequest(authorizeQuery({ client_id: bothId }));
    expect(hosted.kind === "ok" && hosted.request.loopbackWarning).toBe(false);
    delete documents[bothId];
  });

  it("refuses a query the decision route could not take back", async () => {
    const result = await validateAuthorizeRequest(authorizeQuery({ state: "s".repeat(9000) }));
    expect(result.kind === "redirectError" && result.error).toBe("invalid_request");
  });

  it("accepts Claude Code on an ephemeral loopback port and flags loopback-only", async () => {
    const result = await validateAuthorizeRequest(
      authorizeQuery({ client_id: CLAUDE_CODE_CLIENT_ID, redirect_uri: "http://localhost:3118/callback" }),
    );
    expect(result.kind).toBe("ok");
    expect(result.kind === "ok" && result.request.loopbackWarning).toBe(true);
  });

  it("is fatal (no redirect) for an unknown client or an unregistered redirect", async () => {
    expect(await validateAuthorizeRequest(authorizeQuery({ client_id: "https://evil.example/c" }))).toEqual({
      kind: "fatal",
      reason: "client_not_allowed",
    });
    expect(await validateAuthorizeRequest(authorizeQuery({ client_id: null }))).toEqual({ kind: "fatal", reason: "invalid_client" });
    expect(await validateAuthorizeRequest(authorizeQuery({ redirect_uri: "https://evil.example/cb" }))).toEqual({
      kind: "fatal",
      reason: "invalid_redirect_uri",
    });
    expect(await validateAuthorizeRequest(authorizeQuery({ redirect_uri: null }))).toEqual({
      kind: "fatal",
      reason: "invalid_redirect_uri",
    });
    expect(await validateAuthorizeRequest(authorizeQuery({ client_id: "https://claude.ai/oauth/missing" }))).toEqual({
      kind: "fatal",
      reason: "client_unavailable",
    });
  });

  it.each([
    [{ response_type: "token" }, "unsupported_response_type"],
    [{ code_challenge_method: "plain" }, "invalid_request"],
    [{ code_challenge: null }, "invalid_request"],
    [{ code_challenge: "short" }, "invalid_request"],
    [{ resource: "https://plan.example.test/api/other" }, "invalid_target"],
    [{ resource: null }, "invalid_target"],
    [{ scope: "trips admin" }, "invalid_scope"],
  ])("redirects %o back as %s with state", async (overrides, error) => {
    const result = await validateAuthorizeRequest(authorizeQuery(overrides as Record<string, string | null>));
    expect(result.kind).toBe("redirectError");
    if (result.kind !== "redirectError") return;
    expect(result.error).toBe(error);
    const url = new URL(buildErrorRedirectUrl(result));
    expect(url.origin + url.pathname).toBe(HOSTED_REDIRECT);
    expect(url.searchParams.get("state")).toBe("state-123");
    expect(url.searchParams.get("iss")).toBe(ISSUER);
  });

  it("refuses a duplicated parameter", async () => {
    const params = authorizeQuery();
    params.append("client_id", HOSTED_CLIENT_ID);
    expect((await validateAuthorizeRequest(params)).kind).toBe("fatal");
    const twice = authorizeQuery();
    twice.append("resource", `${ISSUER}/api/mcp`);
    const result = await validateAuthorizeRequest(twice);
    expect(result.kind === "redirectError" && result.error).toBe("invalid_request");
  });

  it("tolerates one trailing slash on the resource and nothing else", () => {
    expect(isMcpResource(`${ISSUER}/api/mcp/`)).toBe(true);
    expect(isMcpResource("HTTPS://PLAN.EXAMPLE.TEST/api/mcp")).toBe(true);
    expect(isMcpResource(`${ISSUER}/api/mcp?x=1`)).toBe(false);
    expect(isMcpResource("https://other.example/api/mcp")).toBe(false);
  });

  it("always adds iss to the authorization response", () => {
    const url = new URL(buildAuthorizationResponseUrl(HOSTED_REDIRECT, { code: "abc", state: null }));
    expect(url.searchParams.get("code")).toBe("abc");
    expect(url.searchParams.has("state")).toBe(false);
    expect(url.searchParams.get("iss")).toBe(ISSUER);
  });
});
