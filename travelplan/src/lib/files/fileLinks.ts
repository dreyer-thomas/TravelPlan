import crypto from "node:crypto";
import { isMcpEnabled, parseBaseUrl } from "@/lib/oauth/config";

/**
 * Story 15.8. Short-lived signed links to one stored image or document: `/f/{fileId}?w=&exp=&sig=`.
 *
 * **The signature is the grant.** The `/f/` route has no session, no token and no trip check; a link is
 * minted only inside a connector tool call that has passed the writer check, so its holder gets, until
 * `exp`, what that tool would have handed over anyway. Revocation is by expiry, or by rotating
 * `FILE_LINK_SECRET`, which invalidates every open link at once.
 *
 * `w` is part of the signed string, so a link cannot be reused for another render size. Every refusal is
 * the same `{ ok: false }`: nothing tells a wrong signature apart from an expired link or a bad width.
 *
 * The path may end in the served file's extension (`/f/{fileId}.jpg`). It is cosmetic and not signed: some
 * download tools refuse a URL without an image extension before fetching it, and a saved file gets a name.
 */

export const FILE_LINK_WIDTHS = [800, 1600, 2400] as const;
/** The width the connector's reads sign image links with. */
export const MCP_IMAGE_LINK_WIDTH = 1600;
/** What the route sends: a re-encoded image (JPEG or WebP) or a PDF. */
export const FILE_LINK_EXTENSIONS = ["jpg", "webp", "pdf"] as const;
export type FileLinkExtension = (typeof FILE_LINK_EXTENSIONS)[number];

const DEFAULT_TTL_SECONDS = 900;
const MIN_TTL_SECONDS = 60;
const MAX_TTL_SECONDS = 86_400;
const MIN_SECRET_BYTES = 32;
const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;
const INTEGER = /^\d+$/;
/** A positive integer written without leading zeros, so one link has exactly one spelling. */
const CANONICAL_INTEGER = /^[1-9]\d*$/;
const LINK_SEGMENT = new RegExp(`^([A-Za-z0-9_-]{1,64})(?:\\.(?:${FILE_LINK_EXTENSIONS.join("|")}))?$`);

/** `FILE_LINK_SECRET` decoded from base64url, or `null` when it is unset, malformed or under 32 bytes. */
export const readFileLinkSecret = (): Buffer | null => {
  const raw = process.env.FILE_LINK_SECRET?.trim();
  if (!raw || !BASE64URL.test(raw)) return null;
  const secret = Buffer.from(raw, "base64url");
  return secret.length >= MIN_SECRET_BYTES ? secret : null;
};

/** `FILE_LINK_TTL_SECONDS`: an integer from 60 to 86400, anything else (or unset) 900. */
export const readFileLinkTtlSeconds = (): number => {
  const raw = process.env.FILE_LINK_TTL_SECONDS?.trim();
  if (!raw || !INTEGER.test(raw)) return DEFAULT_TTL_SECONDS;
  const value = Number(raw);
  return value >= MIN_TTL_SECONDS && value <= MAX_TTL_SECONDS ? value : DEFAULT_TTL_SECONDS;
};

/** `base64url(HMAC-SHA256(secret, "fileId|w|exp"))`, with an empty `w` for a link without a width. */
export const fileLinkSignature = (secret: Buffer, fileId: string, w: number | null, exp: number): string =>
  crypto
    .createHmac("sha256", secret)
    .update(`${fileId}|${w ?? ""}|${exp}`)
    .digest("base64url");

const isLinkWidth = (value: number): boolean => (FILE_LINK_WIDTHS as readonly number[]).includes(value);

/** Whether links can be signed at all (a usable secret and `APP_BASE_URL`), so callers can skip disk reads. */
export const fileLinksEnabled = (): boolean =>
  readFileLinkSecret() !== null && parseBaseUrl(process.env.APP_BASE_URL) !== null;

/** The file id of the route's path segment, which may carry a served extension; `null` when malformed. */
export const fileIdOfLinkSegment = (segment: string): string | null => LINK_SEGMENT.exec(segment)?.[1] ?? null;

/** The signed URL and its expiry, or `null` without a usable secret or `APP_BASE_URL`. */
export const signFileLink = (
  fileId: string,
  options: { width?: number; extension?: FileLinkExtension; now?: Date } = {},
): { url: string; expiresAt: Date } | null => {
  const secret = readFileLinkSecret();
  const base = parseBaseUrl(process.env.APP_BASE_URL);
  if (!secret || !base) return null;
  const width = options.width ?? null;
  if (width !== null && !isLinkWidth(width)) throw new Error(`Unsupported file link width: ${width}`);
  const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1000);
  const exp = nowSeconds + readFileLinkTtlSeconds();
  const query = new URLSearchParams();
  if (width !== null) query.set("w", String(width));
  query.set("exp", String(exp));
  query.set("sig", fileLinkSignature(secret, fileId, width, exp));
  const name = `${encodeURIComponent(fileId)}${options.extension ? `.${options.extension}` : ""}`;
  return { url: `${base.origin}/f/${name}?${query.toString()}`, expiresAt: new Date(exp * 1000) };
};

/**
 * Checks one link's query. `ok` only with a usable secret, both `exp` and `sig`, a supported `w` or none,
 * an integer `exp` still in the future, and a matching signature (compared in constant time).
 */
export const verifyFileLink = (params: {
  fileId: string;
  w: string | null;
  exp: string | null;
  sig: string | null;
  now?: Date;
}): { ok: true; width: number | null; expiresAt: number } | { ok: false } => {
  const refused = { ok: false } as const;
  const secret = readFileLinkSecret();
  if (!secret || params.exp === null || params.sig === null) return refused;
  let width: number | null = null;
  if (params.w !== null) {
    if (!CANONICAL_INTEGER.test(params.w)) return refused;
    width = Number(params.w);
    if (!isLinkWidth(width)) return refused;
  }
  if (!CANONICAL_INTEGER.test(params.exp)) return refused;
  const exp = Number(params.exp);
  const nowSeconds = Math.floor((params.now ?? new Date()).getTime() / 1000);
  if (!Number.isSafeInteger(exp) || exp <= nowSeconds) return refused;
  const expected = Buffer.from(fileLinkSignature(secret, params.fileId, width, exp));
  const given = Buffer.from(params.sig);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return refused;
  return { ok: true, width, expiresAt: exp };
};

/**
 * The boot check, called from `instrumentation.ts` next to `assertMcpConfigured`, under the same gate:
 * with the connector on in production, a missing secret would silently turn every `downloadUrl` into null.
 */
export const assertFileLinksConfigured = () => {
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.NODE_ENV !== "production") return;
  if (!isMcpEnabled()) return;
  if (!readFileLinkSecret()) {
    throw new Error("MCP_ENABLED=true requires FILE_LINK_SECRET (base64url, at least 32 bytes)");
  }
};
