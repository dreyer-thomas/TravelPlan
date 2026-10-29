import { POST } from "@/app/api/mcp/route";
import { createAuthorizationCode, exchangeAuthorizationCode } from "@/lib/repositories/oauthRepo";
import { HOSTED_CLIENT_ID, HOSTED_REDIRECT, ISSUER, MCP_RESOURCE, PKCE_CHALLENGE, PKCE_VERIFIER } from "./oauthFixtures";

/** Stories 15.1 and 15.2. A real access token and JSON-RPC requests against `POST /api/mcp`. */

export const MCP_URL = `${ISSUER}/api/mcp`;

export const issueAccessToken = async (userId: string, resource = MCP_RESOURCE) => {
  const code = await createAuthorizationCode({
    userId,
    clientId: HOSTED_CLIENT_ID,
    clientName: "Claude",
    redirectUri: HOSTED_REDIRECT,
    codeChallenge: PKCE_CHALLENGE,
    resource,
    scope: "trips",
  });
  const result = await exchangeAuthorizationCode({
    code,
    clientId: HOSTED_CLIENT_ID,
    redirectUri: HOSTED_REDIRECT,
    codeVerifier: PKCE_VERIFIER,
    resource,
  });
  if (!result.ok) throw new Error("token issue failed");
  return result.tokens.accessToken;
};

export const rpc = (body: unknown, headers: Record<string, string> = {}) =>
  new Request(MCP_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-11-25",
      ...headers,
    },
    body: JSON.stringify(body),
  });

export type ToolCallBody = {
  result?: {
    structuredContent?: Record<string, unknown>;
    /** Story 15.7: `get_file` adds an embedded resource block after the text one. */
    content?: { type: string; text?: string; resource?: { uri: string; mimeType?: string; blob?: string } }[];
    isError?: boolean;
  };
  error?: { code: number; message: string };
};

/** A `tools/call` on the 2025-era leg; the parsed JSON-RPC body. */
export const callTool = async (token: string, name: string, args: Record<string, unknown> = {}): Promise<ToolCallBody> => {
  const response = await POST(
    rpc(
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } },
      { authorization: `Bearer ${token}` },
    ),
  );
  if (response.status !== 200) throw new Error(`tools/call ${name} answered ${response.status}`);
  return (await response.json()) as ToolCallBody;
};
