import { z } from "zod";
import { guardedFetch, type GuardedFetchResult } from "@/lib/http/guardedFetch";
import { getAllowedClientIdRules, getIssuer } from "@/lib/oauth/config";
import { isLoopbackRedirectUri } from "@/lib/oauth/redirectUri";
import { checkRateLimit } from "@/lib/security/rateLimit";

/**
 * Story 15.1, AC 6-7. Clients identify themselves with a Client ID Metadata Document: the `client_id` is an
 * https URL and the document behind it says who the client is and where it may be redirected
 * (MCP authorization spec 2026-07-28; Dynamic Client Registration is deprecated there and not offered).
 *
 * The allowlist (`MCP_CLIENT_ID_HOSTS`, host plus path prefix, default `claude.ai/oauth/`; Tommy 2026-10-29:
 * Claude only) is checked **before** anything is fetched, so an arbitrary client cannot make this server
 * request arbitrary URLs. A refused client is logged by host and path: that log line is how the operator
 * learns where the hosted Claude apps' document lives, which Anthropic does not publish.
 *
 * The authorize page runs this for unauthenticated visitors, so outbound fetches are bounded (review,
 * 2026-10-29): successes are cached at least a minute, failures for a minute, concurrent misses for one URL
 * share one fetch, and the whole process makes at most `MAX_FETCHES_PER_MINUTE` fetches.
 */

export type ResolvedClient = {
  clientId: string;
  clientName: string;
  redirectUris: string[];
};

export type ClientMetadataFailure = "invalid_client_id" | "client_not_allowed" | "fetch_failed" | "invalid_document";

export type ClientMetadataResult = { ok: true; client: ResolvedClient } | { ok: false; reason: ClientMetadataFailure };

export type ClientMetadataFetcher = (url: string) => Promise<GuardedFetchResult>;

const MAX_DOCUMENT_BYTES = 64 * 1024;
const FETCH_TIMEOUT_MS = 15 * 1000;
const MAX_CACHE_MS = 24 * 60 * 60 * 1000;
const MIN_CACHE_MS = 60 * 1000;
const DEFAULT_CACHE_MS = 60 * 60 * 1000;
const FAILURE_CACHE_MS = 60 * 1000;
const MAX_CACHE_ENTRIES = 100;
const MAX_FETCHES_PER_MINUTE = 30;

/**
 * Only `https:` redirect URIs, or `http:` on a loopback host (Claude Code), may be used; anything else in a
 * document (`javascript:`, `data:`, plain `http:` elsewhere, custom schemes) is dropped, so it can never
 * become the browser's next location. A document left with no usable URI is invalid.
 */
const isUsableRedirectUri = (value: string) => {
  try {
    const url = new URL(value);
    if (url.hash !== "" || url.username !== "" || url.password !== "") return false;
    return url.protocol === "https:" || isLoopbackRedirectUri(value);
  } catch {
    return false;
  }
};

const documentSchema = z.object({
  client_id: z.string(),
  client_name: z.string().trim().min(1).max(200),
  redirect_uris: z.array(z.string().min(1).max(2000)).min(1).max(20),
  token_endpoint_auth_method: z.string().optional(),
});

const defaultFetcher: ClientMetadataFetcher = (url) =>
  guardedFetch(url, {
    maxBytes: MAX_DOCUMENT_BYTES,
    timeoutMs: FETCH_TIMEOUT_MS,
    maxRedirects: 0,
    accept: "application/json",
    userAgent: `TravelPlan (+${getIssuer()})`,
  });

let fetcher: ClientMetadataFetcher = defaultFetcher;
type CacheEntry = { result: ClientMetadataResult; expiresAt: number };
const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<ClientMetadataResult>>();

/** Tests replace the network; production never calls this. */
export const setClientMetadataFetcherForTests = (next: ClientMetadataFetcher | null) => {
  fetcher = next ?? defaultFetcher;
};

export const resetClientMetadataCacheForTests = () => {
  cache.clear();
  inFlight.clear();
};

/** AC 6 shape: https, no port, no userinfo, no fragment, a path beyond `/`, already in canonical form. */
export const parseClientIdUrl = (raw: string | null | undefined) => {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.port !== "" || url.username !== "" || url.password !== "") return null;
  if (url.hash !== "" || raw.includes("#")) return null;
  if (url.pathname === "" || url.pathname === "/") return null;
  // The document must name itself with exactly this string, so the input must already be canonical.
  if (url.toString() !== raw) {
    console.warn(`oauth/authorize: client_id not canonical: ${url.hostname}${url.pathname}`);
    return null;
  }
  return url;
};

export const isAllowedClientId = (url: URL) =>
  getAllowedClientIdRules().some((rule) => url.hostname === rule.host && url.pathname.startsWith(rule.pathPrefix));

const cacheLifetimeMs = (cacheControl: string | string[] | undefined) => {
  const header = Array.isArray(cacheControl) ? cacheControl.join(",") : (cacheControl ?? "");
  const match = /max-age=(\d+)/i.exec(header);
  const requested = /no-store|no-cache/i.test(header) ? 0 : match ? Number(match[1]) * 1000 : DEFAULT_CACHE_MS;
  return Math.min(Math.max(requested, MIN_CACHE_MS), MAX_CACHE_MS);
};

const remember = (clientId: string, result: ClientMetadataResult, lifetimeMs: number) => {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(clientId, { result, expiresAt: Date.now() + lifetimeMs });
  return result;
};

const isJsonContentType = (value: string | string[] | undefined) => {
  const header = (Array.isArray(value) ? value[0] : value) ?? "";
  return header.split(";")[0].trim().toLowerCase() === "application/json";
};

const fetchAndValidate = async (url: URL, clientId: string): Promise<ClientMetadataResult> => {
  if (!checkRateLimit("oauth-client-metadata-fetch", MAX_FETCHES_PER_MINUTE, 60 * 1000).ok) {
    console.warn("oauth/authorize: client metadata fetch budget exhausted");
    return { ok: false, reason: "fetch_failed" };
  }

  const failed = (reason: ClientMetadataFailure): ClientMetadataResult =>
    remember(clientId, { ok: false, reason }, FAILURE_CACHE_MS);

  const response = await fetcher(clientId);
  if (!response.ok || response.status !== 200) {
    console.warn(`oauth/authorize: client metadata fetch failed for host ${url.hostname}`);
    return failed("fetch_failed");
  }
  if (!isJsonContentType(response.headers["content-type"])) return failed("invalid_document");

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(Buffer.from(response.body).toString("utf8"));
  } catch {
    return failed("invalid_document");
  }
  const parsed = documentSchema.safeParse(parsedJson);
  if (!parsed.success) return failed("invalid_document");
  const document = parsed.data;
  if (document.client_id !== clientId) return failed("invalid_document");
  if (document.token_endpoint_auth_method !== undefined && document.token_endpoint_auth_method !== "none") {
    return failed("invalid_document");
  }
  const redirectUris = document.redirect_uris.filter(isUsableRedirectUri);
  if (redirectUris.length === 0) return failed("invalid_document");

  return remember(
    clientId,
    { ok: true, client: { clientId, clientName: document.client_name.trim(), redirectUris } },
    cacheLifetimeMs(response.headers["cache-control"]),
  );
};

export const resolveClientMetadata = async (rawClientId: string | null | undefined): Promise<ClientMetadataResult> => {
  const url = parseClientIdUrl(rawClientId);
  if (!url) return { ok: false, reason: "invalid_client_id" };
  if (!isAllowedClientId(url)) {
    console.warn(`oauth/authorize: client_id not allowed: ${url.hostname}${url.pathname}`);
    return { ok: false, reason: "client_not_allowed" };
  }
  const clientId = url.toString();

  const cached = cache.get(clientId);
  if (cached && cached.expiresAt > Date.now()) return cached.result;

  const pending = inFlight.get(clientId);
  if (pending) return pending;
  const request = fetchAndValidate(url, clientId).finally(() => inFlight.delete(clientId));
  inFlight.set(clientId, request);
  return request;
};
