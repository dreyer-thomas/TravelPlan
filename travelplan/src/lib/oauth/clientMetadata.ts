import { z } from "zod";
import { guardedFetch, type GuardedFetchResult } from "@/lib/http/guardedFetch";
import { getAllowedClientIdHosts, getIssuer } from "@/lib/oauth/config";

/**
 * Story 15.1, AC 6-7. Clients identify themselves with a Client ID Metadata Document: the `client_id` is an
 * https URL and the document behind it says who the client is and where it may be redirected
 * (MCP authorization spec 2026-07-28; Dynamic Client Registration is deprecated there and not offered).
 *
 * The allowlist (`MCP_CLIENT_ID_HOSTS`, Tommy 2026-10-29: Claude only) is checked **before** anything is
 * fetched, so an arbitrary client cannot make this server request arbitrary URLs. The fetch itself still goes
 * through `guardedFetch`. A refused host is logged by name only: that log line is how the operator learns the
 * hosted Claude apps' document host if it is not `claude.ai`, which Anthropic does not publish.
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
const DEFAULT_CACHE_MS = 60 * 60 * 1000;

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
const cache = new Map<string, { client: ResolvedClient; expiresAt: number }>();

/** Tests replace the network; production never calls this. */
export const setClientMetadataFetcherForTests = (next: ClientMetadataFetcher | null) => {
  fetcher = next ?? defaultFetcher;
};

export const resetClientMetadataCacheForTests = () => {
  cache.clear();
};

/** AC 6 shape: https, no port, no userinfo, no fragment, a path beyond `/`. */
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
  if (url.toString() !== raw) return null;
  return url;
};

export const isAllowedClientIdHost = (url: URL) => getAllowedClientIdHosts().includes(url.hostname.toLowerCase());

const cacheLifetimeMs = (cacheControl: string | string[] | undefined) => {
  const header = Array.isArray(cacheControl) ? cacheControl.join(",") : (cacheControl ?? "");
  if (/no-store|no-cache/i.test(header)) return 0;
  const match = /max-age=(\d+)/i.exec(header);
  if (!match) return DEFAULT_CACHE_MS;
  return Math.min(Number(match[1]) * 1000, MAX_CACHE_MS);
};

export const resolveClientMetadata = async (rawClientId: string | null | undefined): Promise<ClientMetadataResult> => {
  const url = parseClientIdUrl(rawClientId);
  if (!url) return { ok: false, reason: "invalid_client_id" };
  if (!isAllowedClientIdHost(url)) {
    console.warn(`oauth/authorize: client_id host not allowed: ${url.hostname}`);
    return { ok: false, reason: "client_not_allowed" };
  }
  const clientId = url.toString();

  const cached = cache.get(clientId);
  if (cached && cached.expiresAt > Date.now()) return { ok: true, client: cached.client };

  const response = await fetcher(clientId);
  if (!response.ok || response.status !== 200) {
    console.warn(`oauth/authorize: client metadata fetch failed for host ${url.hostname}`);
    return { ok: false, reason: "fetch_failed" };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(Buffer.from(response.body).toString("utf8"));
  } catch {
    return { ok: false, reason: "invalid_document" };
  }
  const parsed = documentSchema.safeParse(parsedJson);
  if (!parsed.success) return { ok: false, reason: "invalid_document" };
  const document = parsed.data;
  if (document.client_id !== clientId) return { ok: false, reason: "invalid_document" };
  if (document.token_endpoint_auth_method !== undefined && document.token_endpoint_auth_method !== "none") {
    return { ok: false, reason: "invalid_document" };
  }

  const client: ResolvedClient = {
    clientId,
    clientName: document.client_name.trim(),
    redirectUris: document.redirect_uris,
  };
  const lifetime = cacheLifetimeMs(response.headers["cache-control"]);
  if (lifetime > 0) cache.set(clientId, { client, expiresAt: Date.now() + lifetime });
  return { ok: true, client };
};
