import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import { Readable } from "node:stream";
import sharp from "sharp";
import { verifyFileLink } from "@/lib/files/fileLinks";
import { getClientIp } from "@/lib/http/clientIp";
import { findFileForSignedLink } from "@/lib/repositories/connectorReadRepo";
import { checkRateLimit } from "@/lib/security/rateLimit";
import { sniffDocumentContentType, sniffPhotoContentType } from "@/lib/trips/importPackage";
import { readFileHead, resolveTripFilePath } from "@/lib/trips/tripFilePath";

/**
 * Story 15.8. One stored image or document behind a short-lived signed link (`src/lib/files/fileLinks.ts`):
 * `GET /f/{fileId}?w=&exp=&sig=`, the `downloadUrl` the connector's reads hand to an AI client.
 *
 * **The signature is the grant**, so this route reads no session, no token and no trip membership, and it is
 * deliberately absent from `proxy.ts`'s matcher. The link was minted inside a tool call that passed the
 * writer check; until `exp` its holder gets what that call's `get_file` would have handed over anyway.
 *
 * The order is fixed: the rate limit (before any verification, so guessing signatures costs as much as
 * fetching), the id's character set, the signature, the lookup by id, the containment on disk. Every query
 * refusal is the same empty 403 and every missing file the same empty 404, so nothing tells a wrong
 * signature apart from an expired link or a bad width.
 *
 * **Images never leave as stored.** They are re-encoded in memory with sharp, oriented, resized to the
 * signed width when there is one, and written without any metadata (sharp's default; nothing here calls
 * `keepMetadata`, `keepExif`, `withExif` or `withMetadata`), because phone photos carry GPS. A PDF is
 * streamed unchanged. The type always comes from the bytes, never from the extension or the column. Files
 * on disk are never modified.
 *
 * Logging: nothing on success; a sharp failure logs the file id only, never the path or the signature.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ fileId: string }> };

const FILE_LINK_RATE_LIMIT = 300;
const FILE_LINK_RATE_WINDOW_MS = 60_000;
const FILE_ID = /^[A-Za-z0-9_-]{1,64}$/;

const empty = (status: number) => new Response(null, { status });

const headersFor = (contentType: string, length: number, maxAgeSeconds: number) => ({
  "content-type": contentType,
  "content-length": String(length),
  "cache-control": `private, max-age=${maxAgeSeconds}`,
  "x-content-type-options": "nosniff",
  "content-disposition": "inline",
});

/** Oriented, resized when `width` is given, metadata dropped: WebP for a WebP or a PNG with alpha, else JPEG. */
const renderImage = async (filePath: string, sourceType: string, width: number | null) => {
  const image = sharp(filePath);
  const { hasAlpha } = await image.metadata();
  image.autoOrient();
  if (width !== null) image.resize({ width, withoutEnlargement: true });
  const asWebp = sourceType === "image/webp" || (sourceType === "image/png" && hasAlpha);
  return asWebp
    ? { bytes: await image.webp({ quality: 82 }).toBuffer(), contentType: "image/webp" }
    : { bytes: await image.jpeg({ quality: 85, mozjpeg: true }).toBuffer(), contentType: "image/jpeg" };
};

export async function GET(request: Request, context: RouteContext) {
  const ip = getClientIp(request);
  if (ip !== "unknown" && !checkRateLimit(`file-link:${ip}`, FILE_LINK_RATE_LIMIT, FILE_LINK_RATE_WINDOW_MS).ok) {
    return empty(429);
  }

  const { fileId } = await context.params;
  if (!FILE_ID.test(fileId)) return empty(404);

  const query = new URL(request.url).searchParams;
  const link = verifyFileLink({ fileId, w: query.get("w"), exp: query.get("exp"), sig: query.get("sig") });
  if (!link.ok) return empty(403);

  const file = await findFileForSignedLink(fileId);
  if (!file) return empty(404);
  // A document link is never minted with a width, so one carrying a width was not minted here.
  if (file.media === "document" && link.width !== null) return empty(403);
  const filePath = await resolveTripFilePath(file.tripId, file.url);
  const stat = filePath ? await fs.stat(filePath).catch(() => null) : null;
  if (!filePath || !stat?.isFile()) return empty(404);

  // Gone or unreadable since the stat: the same empty 404 as a missing file, not a 500.
  const head = await readFileHead(filePath, 16).catch(() => null);
  if (!head) return empty(404);
  const contentType = file.media === "image" ? sniffPhotoContentType(head) : sniffDocumentContentType(head);
  if (!contentType) return empty(404);
  const maxAge = Math.max(0, link.expiresAt - Math.floor(Date.now() / 1000));

  if (contentType === "application/pdf") {
    const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream<Uint8Array>;
    return new Response(stream, { status: 200, headers: headersFor(contentType, stat.size, maxAge) });
  }

  let rendered;
  try {
    // A document image keeps its size: only image links carry a width.
    rendered = await renderImage(filePath, contentType, file.media === "image" ? link.width : null);
  } catch {
    console.error("file link: image could not be processed", { fileId });
    return empty(404);
  }
  return new Response(new Uint8Array(rendered.bytes), {
    status: 200,
    headers: headersFor(rendered.contentType, rendered.bytes.length, maxAge),
  });
}
