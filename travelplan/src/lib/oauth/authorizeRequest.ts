import { getIssuer, getMcpResourceUrl, MCP_SCOPE, OFFLINE_ACCESS_SCOPE } from "@/lib/oauth/config";
import { resolveClientMetadata, type ResolvedClient } from "@/lib/oauth/clientMetadata";
import { isValidPkceValue } from "@/lib/oauth/pkce";
import { isLoopbackRedirectUri, matchesRegisteredRedirectUri } from "@/lib/oauth/redirectUri";

/**
 * Story 15.1, AC 9. One validation of an authorization request, used by the authorize page and again,
 * server-side, by the decision route: the decision never trusts what the page showed.
 *
 * The order matters. Until `client_id` and `redirect_uri` are verified, nothing may redirect the browser
 * (that would make this an open redirector), so those failures are `fatal` and the page renders an error
 * card. Everything after that goes back to the client as an error redirect, with `state` and `iss`.
 */

export type FatalReason = "invalid_client" | "client_not_allowed" | "client_unavailable" | "invalid_redirect_uri";

export type AuthorizeRequest = {
  client: ResolvedClient;
  redirectUri: string;
  codeChallenge: string;
  resource: string;
  scope: string;
  state: string | null;
  /**
   * AC 11 warning: the code goes to a program on this computer - the requested redirect is a loopback
   * address, or every redirect the client registered is.
   */
  loopbackWarning: boolean;
};

export type AuthorizeValidation =
  | { kind: "fatal"; reason: FatalReason }
  | { kind: "redirectError"; redirectUri: string; error: string; description: string; state: string | null }
  | { kind: "ok"; request: AuthorizeRequest };

/** RFC 6749 §3.1: a parameter sent more than once is an error. */
const single = (params: URLSearchParams, name: string) => {
  const values = params.getAll(name);
  if (values.length > 1) return { duplicated: true as const };
  return { duplicated: false as const, value: values[0] ?? null };
};

/** One trailing slash tolerated, scheme and host compared case-insensitively (`URL` lowercases them). */
export const isMcpResource = (value: string | null) => {
  if (!value) return false;
  try {
    const candidate = new URL(value);
    const expected = new URL(getMcpResourceUrl());
    if (candidate.search !== "" || candidate.hash !== "") return false;
    const path = candidate.pathname.endsWith("/") ? candidate.pathname.slice(0, -1) : candidate.pathname;
    return candidate.origin === expected.origin && path === expected.pathname;
  } catch {
    return false;
  }
};

const ALLOWED_SCOPES = new Set([MCP_SCOPE, OFFLINE_ACCESS_SCOPE]);

/** The decision route's ceiling for the query it is sent back; the page refuses anything longer. */
export const MAX_AUTHORIZE_QUERY_LENGTH = 8 * 1024;

export const validateAuthorizeRequest = async (params: URLSearchParams): Promise<AuthorizeValidation> => {
  const clientIdParam = single(params, "client_id");
  const redirectParam = single(params, "redirect_uri");
  if (clientIdParam.duplicated || !clientIdParam.value) return { kind: "fatal", reason: "invalid_client" };

  const resolved = await resolveClientMetadata(clientIdParam.value);
  if (!resolved.ok) {
    switch (resolved.reason) {
      case "client_not_allowed":
        return { kind: "fatal", reason: "client_not_allowed" };
      case "invalid_client_id":
        return { kind: "fatal", reason: "invalid_client" };
      default:
        return { kind: "fatal", reason: "client_unavailable" };
    }
  }
  const client = resolved.client;

  if (redirectParam.duplicated || !redirectParam.value) return { kind: "fatal", reason: "invalid_redirect_uri" };
  const redirectUri = redirectParam.value;
  if (!matchesRegisteredRedirectUri(redirectUri, client.redirectUris)) {
    return { kind: "fatal", reason: "invalid_redirect_uri" };
  }

  // From here on the redirect URI is trusted and errors go back to the client.
  const stateParam = single(params, "state");
  const state = stateParam.duplicated ? null : stateParam.value;
  const redirectError = (error: string, description: string): AuthorizeValidation => ({
    kind: "redirectError",
    redirectUri,
    error,
    description,
    state,
  });

  if (stateParam.duplicated) return redirectError("invalid_request", "state sent more than once");
  // The consent card posts this query back to the decision route, which accepts at most this much;
  // refusing here keeps the card from offering buttons that can only fail.
  if (params.toString().length > MAX_AUTHORIZE_QUERY_LENGTH) {
    return redirectError("invalid_request", "Authorization request too large");
  }

  for (const name of ["response_type", "code_challenge", "code_challenge_method", "resource", "scope"]) {
    if (single(params, name).duplicated) return redirectError("invalid_request", `${name} sent more than once`);
  }

  if (params.get("response_type") !== "code") {
    return redirectError("unsupported_response_type", "Only response_type=code is supported");
  }
  if (params.get("code_challenge_method") !== "S256") {
    return redirectError("invalid_request", "code_challenge_method must be S256");
  }
  const codeChallenge = params.get("code_challenge");
  if (!codeChallenge || !isValidPkceValue(codeChallenge)) {
    return redirectError("invalid_request", "code_challenge is missing or malformed");
  }
  if (!isMcpResource(params.get("resource"))) {
    return redirectError("invalid_target", "resource must be the TravelPlan MCP endpoint");
  }
  const requestedScope = params.get("scope");
  if (requestedScope !== null) {
    const scopes = requestedScope.split(" ").filter((entry) => entry.length > 0);
    if (scopes.some((entry) => !ALLOWED_SCOPES.has(entry))) {
      return redirectError("invalid_scope", "Only the trips scope is available");
    }
  }

  return {
    kind: "ok",
    request: {
      client,
      redirectUri,
      codeChallenge,
      resource: getMcpResourceUrl(),
      scope: MCP_SCOPE,
      state,
      loopbackWarning: isLoopbackRedirectUri(redirectUri) || client.redirectUris.every((uri) => isLoopbackRedirectUri(uri)),
    },
  };
};

/** RFC 9207: `iss` on every authorization response, success and error alike. */
export const buildAuthorizationResponseUrl = (redirectUri: string, values: Record<string, string | null>) => {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(values)) {
    if (value !== null) url.searchParams.set(key, value);
  }
  url.searchParams.set("iss", getIssuer());
  return url.toString();
};

export const buildErrorRedirectUrl = (validation: Extract<AuthorizeValidation, { kind: "redirectError" }>) =>
  buildAuthorizationResponseUrl(validation.redirectUri, {
    error: validation.error,
    error_description: validation.description,
    state: validation.state,
  });
