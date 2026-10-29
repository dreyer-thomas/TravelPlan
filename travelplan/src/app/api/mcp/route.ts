import { NextResponse } from "next/server";
import {
  createMcpHandler,
  isLegacyRequest,
  requireBearerAuth,
  WebStandardStreamableHTTPServerTransport,
  type AuthInfo,
} from "@modelcontextprotocol/server";
import { createTravelPlanMcpServer } from "@/lib/mcp/server";
import { travelPlanTokenVerifier } from "@/lib/mcp/verifier";
import { getMcpResourceUrl, getProtectedResourceMetadataUrl, isMcpEnabled, MCP_SCOPE } from "@/lib/oauth/config";
import { connectorDisabled } from "@/lib/oauth/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_MCP_BODY_BYTES = 2 * 1024 * 1024;

/**
 * Story 15.1, AC 3, 19. The connector's MCP endpoint: bearer tokens only, stateless, JSON responses.
 *
 * The bearer gate runs before anything reads the body, so an unauthenticated request never reaches the SDK.
 * The session cookie is never consulted here, and no other route reads `Authorization`.
 *
 * Two legs, both stateless and both answering plain JSON (no SSE, so Nginx needs no streaming setup):
 * 2026-07-28 traffic goes to `createMcpHandler` with `responseMode: 'json'`; 2025-era traffic (an
 * `initialize` handshake, no per-request envelope) goes to a fresh streamable HTTP transport per request
 * with `enableJsonResponse`. The SDK's built-in legacy fallback would answer those with SSE, which is why the
 * routing is done here with the SDK's own `isLegacyRequest` predicate, the composition its docs describe.
 */
const modern = createMcpHandler(() => createTravelPlanMcpServer(), {
  legacy: "reject",
  responseMode: "json",
  maxRequestBodySize: MAX_MCP_BODY_BYTES,
  onerror: (error) => console.error("mcp: request failed", error.message),
});

const serveLegacy = async (request: Request, authInfo: AuthInfo) => {
  const server = createTravelPlanMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    maxRequestBodySize: MAX_MCP_BODY_BYTES,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request, { authInfo });
  } finally {
    await server.close().catch(() => undefined);
  }
};

const jsonRpcError = (status: number, message: string) =>
  NextResponse.json({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }, { status });

const methodNotAllowed = () => {
  const response = jsonRpcError(405, "Method not allowed.");
  response.headers.set("Allow", "POST");
  return response;
};

/**
 * RFC 6750 §3.1: a request that carries no credentials gets the challenge without an error code. The SDK
 * gate always names `invalid_token`, so the no-credentials case is answered here, before it.
 */
const missingCredentials = () =>
  NextResponse.json(
    { error: "unauthorized", error_description: "Bearer token required" },
    {
      status: 401,
      headers: {
        "WWW-Authenticate": `Bearer resource_metadata="${getProtectedResourceMetadataUrl()}", scope="${MCP_SCOPE}"`,
      },
    },
  );

export const POST = async (request: Request) => {
  if (!isMcpEnabled()) return connectorDisabled();
  if (!request.headers.get("authorization")) return missingCredentials();

  const gate = requireBearerAuth({
    verifier: travelPlanTokenVerifier,
    requiredScopes: [MCP_SCOPE],
    expectedResource: new URL(getMcpResourceUrl()),
    resourceMetadataUrl: getProtectedResourceMetadataUrl(),
  });
  const auth = await gate(request);
  if (auth instanceof Response) return auth;

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_MCP_BODY_BYTES) {
    return jsonRpcError(413, "Request body too large.");
  }

  if (await isLegacyRequest(request, undefined, { maxRequestBodySize: MAX_MCP_BODY_BYTES })) {
    return serveLegacy(request, auth);
  }
  return modern.fetch(request, { authInfo: auth });
};

export const GET = () => (isMcpEnabled() ? methodNotAllowed() : connectorDisabled());
export const DELETE = () => (isMcpEnabled() ? methodNotAllowed() : connectorDisabled());
