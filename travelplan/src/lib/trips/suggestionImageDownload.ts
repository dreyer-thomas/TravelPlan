import "server-only";
import { getWikimediaUserAgent } from "@/lib/ai/suggestionImages";
import { sniffPhotoContentType } from "@/lib/trips/importPackage";
import {
  isWikimediaThumbnailUrl,
  isWikimediaUploadUrl,
  type SuggestionImage,
} from "@/lib/validation/daySuggestionSchemas";

/**
 * Story 12.4 (AC5, items 13–15). Downloads the pictures of the ticked suggestions on the server, so they
 * can be stored on the new activities like any uploaded picture. Runs **before** the apply transaction:
 * network I/O cannot sit inside a SQLite transaction, and the item ids the files are named after are
 * only known inside it, so the bytes wait in memory (at most 8 × 3 pictures of at most 5 MB each).
 *
 * - **Which file.** Commons originals are often 10–50 MB, over the 5 MB limit of the image upload route.
 *   Wikimedia serves only standard thumbnail widths, so the first attempts are the 1920 px and 1280 px
 *   ones, derived from the 250 px `thumbnailUrl` by swapping the width in its last path segment. 1920
 *   comes first because the fullscreen viewer never scales a photo up: at 1280 px the pictures stayed
 *   visibly smaller than the user's own photos (Tommy, 2026-10-16). Then the original, then the 250 px
 *   thumbnail itself, which is always small. A source narrower than a width answers that attempt with an
 *   error, which simply falls through.
 * - **Which hosts.** The URLs come back from the client, so each one passes its guard before any request
 *   (SSRF): `isWikimediaThumbnailUrl` for the thumbnail attempts, `isWikimediaUploadUrl` for the original.
 *   Admitting `thumb.wikimedia.org` here is a deliberate widening (12.2 Deviation 1): the live API hands
 *   its thumbnails out there, and it is Wikimedia's own host, as `upload.wikimedia.org` is.
 * - **No redirects** (DW-386). `redirect: "manual"`, and anything but a 200 (a 3xx included) is a
 *   failure, so a guarded URL can never be bounced to a host the guard would have refused.
 * - **Bounded.** The body is read with a counting reader and cancelled past 5 MB; 8 s per request, 15 s
 *   for the whole apply, at most four pictures at a time.
 * - **Sniffed.** Only bytes that are a JPEG, PNG or WebP by their signature are kept, and the type (and
 *   so the stored extension) comes from the bytes, never from the header or the URL.
 *
 * A picture that cannot be downloaded is skipped; it never fails the apply. Failures are logged once per
 * apply, by host and reason only: the file names would say which places the user is planning to visit.
 */

export const MAX_SUGGESTION_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_REQUEST_TIMEOUT_MS = 8000;
export const IMAGE_DOWNLOAD_BUDGET_MS = 15000;
const MAX_PARALLEL_DOWNLOADS = 4;

export type DownloadedSuggestionImage = { bytes: Buffer; contentType: string };

/** The wider standard thumbnail widths tried before the original, widest first. */
const WIDE_THUMBNAIL_WIDTHS = [1920, 1280] as const;

/** `…/thumb/<a>/<ab>/<name>/250px-<name>` → `…/<width>px-<name>`, query kept; `null` for any other form. */
const deriveWiderThumbnail = (thumbnailUrl: string, width: number): string | null => {
  try {
    const url = new URL(thumbnailUrl);
    const segments = url.pathname.split("/");
    const last = segments.at(-1) ?? "";
    if (!segments.includes("thumb") || !last.startsWith("250px-")) return null;
    segments[segments.length - 1] = `${width}px-${last.slice("250px-".length)}`;
    url.pathname = segments.join("/");
    return url.toString();
  } catch {
    return null;
  }
};

/** The attempts for one picture, in order, each already through its guard. Exported for the tests. */
export const downloadCandidates = (image: SuggestionImage): string[] => {
  const candidates: string[] = [];
  for (const width of WIDE_THUMBNAIL_WIDTHS) {
    const wide = deriveWiderThumbnail(image.thumbnailUrl, width);
    if (wide && isWikimediaThumbnailUrl(wide)) candidates.push(wide);
  }
  if (isWikimediaUploadUrl(image.originalUrl)) candidates.push(image.originalUrl);
  if (isWikimediaThumbnailUrl(image.thumbnailUrl)) candidates.push(image.thumbnailUrl);
  return [...new Set(candidates)];
};

class DownloadFailure extends Error {}

/** The body, or a `DownloadFailure` past the cap. Cancels the stream either way once done with it. */
const readBodyWithinLimit = async (body: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<Buffer> => {
  if (!body) throw new DownloadFailure("empty");
  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      if (!next.value) continue;
      total += next.value.byteLength;
      if (total > maxBytes) throw new DownloadFailure("too_large");
      chunks.push(Buffer.from(next.value));
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks);
};

const host = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return "invalid";
  }
};

type Deps = { fetchImpl: typeof fetch; signal: AbortSignal; userAgent: string; onFailure: (reason: string) => void };

const downloadOne = async (url: string, deps: Deps): Promise<DownloadedSuggestionImage | null> => {
  if (deps.signal.aborted) return null;
  // The per-request timer stays armed through the body read, not only until the headers arrive.
  const signal = AbortSignal.any([deps.signal, AbortSignal.timeout(IMAGE_REQUEST_TIMEOUT_MS)]);
  try {
    const response = await deps.fetchImpl(url, {
      method: "GET",
      redirect: "manual",
      cache: "no-store",
      headers: { "User-Agent": deps.userAgent },
      signal,
    });
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => undefined);
      deps.onFailure(`${host(url)} ${response.status}`);
      return null;
    }
    const bytes = await readBodyWithinLimit(response.body, MAX_SUGGESTION_IMAGE_BYTES);
    const contentType = sniffPhotoContentType(bytes);
    if (!contentType) {
      deps.onFailure(`${host(url)} not_an_image`);
      return null;
    }
    return { bytes, contentType };
  } catch (error) {
    const reason = error instanceof DownloadFailure ? error.message : error instanceof Error ? error.name : typeof error;
    deps.onFailure(`${host(url)} ${reason}`);
    return null;
  }
};

const downloadImage = async (image: SuggestionImage, deps: Deps) => {
  for (const url of downloadCandidates(image)) {
    const downloaded = await downloadOne(url, deps);
    if (downloaded) return downloaded;
  }
  return null;
};

/**
 * Each suggestion's pictures, in their order, with the ones that could not be downloaded left out. One
 * entry per input group. Never throws.
 */
export const downloadSuggestionImages = async (
  groups: SuggestionImage[][],
  {
    fetchImpl = fetch,
    signal,
    budgetMs = IMAGE_DOWNLOAD_BUDGET_MS,
  }: { fetchImpl?: typeof fetch; signal?: AbortSignal; budgetMs?: number } = {},
): Promise<DownloadedSuggestionImage[][]> => {
  const budget = AbortSignal.timeout(budgetMs);
  const failures: string[] = [];
  let failedImages = 0;
  const deps: Deps = {
    fetchImpl,
    signal: signal ? AbortSignal.any([budget, signal]) : budget,
    userAgent: getWikimediaUserAgent(),
    onFailure: (reason) => failures.push(reason),
  };

  const jobs = groups.flatMap((images, groupIndex) => images.map((image, imageIndex) => ({ image, groupIndex, imageIndex })));
  const results: (DownloadedSuggestionImage | null)[][] = groups.map((images) => images.map(() => null));
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next];
      next += 1;
      const downloaded = await downloadImage(job.image, deps);
      if (!downloaded) failedImages += 1;
      results[job.groupIndex][job.imageIndex] = downloaded;
    }
  };
  await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL_DOWNLOADS, jobs.length) }, worker));

  if (failedImages > 0) {
    console.warn("day suggestions apply: image downloads failed", {
      failed: failedImages,
      reasons: [...new Set(failures)],
    });
  }
  return results.map((group) => group.filter((entry): entry is DownloadedSuggestionImage => entry !== null));
};
