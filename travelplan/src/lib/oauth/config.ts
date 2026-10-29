/**
 * Story 15.1. The connector's switches and fixed values, read per call like `src/lib/ai/config.ts` so
 * tests can toggle them.
 *
 * The issuer is the origin of `APP_BASE_URL`, never the raw value: Claude compares the issuer and the
 * resource strings exactly, and a trailing slash or a path in the variable would break the connection
 * without any error on our side.
 */

export const MCP_SCOPE = "trips";
export const OFFLINE_ACCESS_SCOPE = "offline_access";

export const CODE_TTL_MS = 60 * 1000;
export const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Claude refreshes proactively and can race itself; a just-rotated token gets this long before reuse counts. */
export const REFRESH_REUSE_GRACE_MS = 30 * 1000;
/** `lastUsedAt` is written at most this often per token, so a busy agent does not write on every call. */
export const LAST_USED_WRITE_INTERVAL_MS = 5 * 60 * 1000;
/** Codes and tokens are deleted this long after they expired. */
export const EXPIRED_ROW_RETENTION_MS = 24 * 60 * 60 * 1000;

const DEFAULT_CLIENT_ID_HOSTS = ["claude.ai"];
const DEV_FALLBACK_BASE_URL = "http://localhost:3000";

export const isMcpEnabled = () => process.env.MCP_ENABLED === "true";

const parseBaseUrl = (raw: string | undefined) => {
  if (!raw?.trim()) return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url;
  } catch {
    return null;
  }
};

/** `https://plan.example` (no trailing slash). Outside production a missing value falls back like the reset route. */
export const getIssuer = () => {
  const url = parseBaseUrl(process.env.APP_BASE_URL);
  return url ? url.origin : DEV_FALLBACK_BASE_URL;
};

export const getMcpResourceUrl = () => `${getIssuer()}/api/mcp`;

export const getProtectedResourceMetadataUrl = () => `${getIssuer()}/.well-known/oauth-protected-resource`;

export const getAllowedClientIdHosts = () => {
  const raw = process.env.MCP_CLIENT_ID_HOSTS;
  if (raw === undefined || raw.trim() === "") return DEFAULT_CLIENT_ID_HOSTS;
  return raw
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter((host) => host.length > 0);
};

/**
 * The boot check, called from `instrumentation.ts`. Only in production and only when the connector is on:
 * there a missing or non-https `APP_BASE_URL` would silently produce an issuer Claude cannot use.
 */
export const assertMcpConfigured = () => {
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.NODE_ENV !== "production") return;
  if (!isMcpEnabled()) return;
  const url = parseBaseUrl(process.env.APP_BASE_URL);
  if (!url || url.protocol !== "https:") {
    throw new Error("MCP_ENABLED=true requires APP_BASE_URL to be an https URL");
  }
};
