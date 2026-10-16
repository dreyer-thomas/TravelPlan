import "server-only";
import {
  isWikimediaThumbnailUrl,
  isWikimediaUploadUrl,
  type DaySuggestion,
  type SuggestionImage,
  type VerifiedDaySuggestion,
} from "@/lib/validation/daySuggestionSchemas";

/**
 * Story 12.2. Up to three pictures of each suggested place, looked up on Wikimedia after verification.
 *
 * **Wikimedia only, never AI URLs, no attribution** (D4, Tommy 2026-10-16). Every URL here comes from a
 * Wikimedia API answer; the model has no URL field to fill (`modelSuggestionsSchema`). No author or
 * licence is kept, because the app is private and the pictures are shown only to the trip's members.
 *
 * **After verification, on its point.** Commons geosearch within 1 km is only as good as the point it is
 * given, and verification replaces the model's point with the geocoder's when it finds the place. So the
 * route runs model, then verification, then this. Where verification found nothing, the model's point is
 * used anyway: skipping those would leave most cards bare (4 of 5 in the first real call).
 *
 * **Two sources, in a fixed order.** The English Wikipedia article's lead image first (`wikiTitle`, then
 * `title` if that found nothing), then Commons files near the point, nearest first. One article has one
 * lead image, so geosearch supplies the rest; `prop=images` is not used because it returns every flag,
 * icon and map on the page.
 *
 * **250 px thumbnails.** Since January 2026 Wikimedia serves only standard widths (…, 120, 250, 330, …),
 * rounds any other width up, and rejects a hotlinked non-standard one. The cards want at most 320 px, so
 * the largest standard width under that is asked for.
 *
 * **In parallel, unlike Nominatim.** Nominatim allows one request per second per application, which is
 * why verification is sequential. Wikimedia's API has no such rule at this volume (two to three requests
 * per suggestion, about 16-24 per search), and each request names itself and a contact in the
 * `User-Agent`, as its access policy asks. So all suggestions are looked up at once, under one 8 s budget:
 * when it runs out, the requests still open are aborted and each suggestion keeps what had arrived.
 *
 * **Never fails a search.** Every failure, from a 503 to a body that is not JSON, means "no pictures from
 * this source", and the step as a whole answers `images: []` rather than throwing.
 */

/** The largest standard Wikimedia width at or under the cards' 320 px (see above). */
export const THUMBNAIL_WIDTH = 250;
/** Two or three pictures to judge a place at a glance (FR44); more would crowd the card. */
export const MAX_IMAGES_PER_SUGGESTION = 3;
/** About a city block's walk around the point; wider brings in the next district's landmarks. */
export const GEOSEARCH_RADIUS_METERS = 1000;
/** Enough candidates to survive the MIME filter and the deduplication and still fill three slots. */
export const GEOSEARCH_LIMIT = 10;
/** The image step's share of the reverse proxy's 90 s: model 60 s + verification 10 s + this = 78 s. */
export const IMAGE_LOOKUP_BUDGET_MS = 8000;
/** What the media pipeline and every browser handle. Commons namespace 6 also holds PDFs, SVGs, audio and video. */
export const ALLOWED_IMAGE_MIME = ["image/jpeg", "image/png", "image/webp"] as const;
/** English, because the prompt asks the model for the English article's title (`prompt.ts`). */
export const WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php";
/** Commons holds the files every Wikipedia uses, so its geosearch finds pictures of places with no article. */
export const COMMONS_API = "https://commons.wikimedia.org/w/api.php";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "0.0.0.0"]);

/**
 * `<client>/<version> (<contact>)`, as Wikimedia's API access policy asks; a request without a contact
 * may be blocked without notice. The contact is the app's public URL (`APP_BASE_URL`, the variable the
 * password-reset email already uses) when there is one. Read on every call, like `lib/ai/config.ts`.
 */
export const getWikimediaUserAgent = () => {
  const raw = process.env.APP_BASE_URL?.trim() ?? "";
  let contact = "self-hosted; no public URL";
  try {
    const url = new URL(raw);
    if ((url.protocol === "https:" || url.protocol === "http:") && !LOCAL_HOSTS.has(url.hostname)) {
      contact = url.origin;
    }
  } catch {
    // Unset or not a URL: the fallback stands.
  }
  return `TravelPlan/0.1 (suggestion images; ${contact})`;
};

type Candidate = {
  /** `File:Name_with_underscores.jpg`, the key both sources are deduplicated on. */
  fileName: string;
  thumbnailUrl: string;
  originalUrl: string;
  mime: string;
};

type RequestDeps = {
  fetchImpl: typeof fetch;
  signal?: AbortSignal;
  userAgent: string;
  /** Told why a request gave nothing (an HTTP status or an error class name), so the search can log it. */
  onFailure?: (reason: string) => void;
};

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object";

const isAllowedMime = (mime: unknown): mime is string =>
  typeof mime === "string" && (ALLOWED_IMAGE_MIME as readonly string[]).includes(mime);

// Pageimages gives `Foo bar.jpg`, geosearch `File:Foo bar.jpg`, either may already use underscores.
const toFileKey = (name: string) => `File:${name.trim().replace(/^File:/, "").replace(/ /g, "_")}`;

/** The answer's JSON, or `null` for anything else - a non-OK status, a network failure, an abort, bad JSON. */
const getJson = async (
  api: string,
  params: Record<string, string>,
  { fetchImpl, signal, userAgent, onFailure }: RequestDeps,
) => {
  if (signal?.aborted) {
    return null;
  }
  const url = new URL(api);
  url.search = new URLSearchParams({ action: "query", format: "json", formatversion: "2", ...params }).toString();
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { "User-Agent": userAgent },
      cache: "no-store",
      signal,
    });
    if (!response.ok) {
      onFailure?.(`HTTP ${response.status}`);
      return null;
    }
    return (await response.json()) as unknown;
  } catch (error) {
    onFailure?.(error instanceof Error ? error.name : typeof error);
    return null;
  }
};

const pagesOf = (body: unknown): unknown[] => {
  if (!isObject(body) || !isObject(body.query) || !Array.isArray(body.query.pages)) {
    return [];
  }
  return body.query.pages;
};

/*
  Pageimages returns no MIME type, so it is read off the original's file extension. The extension is a
  file name Commons enforces against the content, so it is a fair stand-in, and anything it does not name
  as JPEG, PNG or WebP (an SVG coat of arms is a common lead image) is dropped.
*/
const mimeFromExtension = (source: string) => {
  const extension = new URL(source).pathname.split(".").pop()?.toLowerCase();
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  return null;
};

const sourceOf = (value: unknown) => (isObject(value) && typeof value.source === "string" ? value.source : null);

/*
  With no thumbnail in the answer, the original may stand in only when it is known to be no wider than a
  thumbnail. A wide source without one (a failed render) is dropped rather than handing a card a file of
  tens of MB.
*/
const isNarrowEnough = (width: unknown) => typeof width === "number" && width <= THUMBNAIL_WIDTH;

/** The English Wikipedia article's lead image, or `null`. Never throws. */
export const fetchPageImage = async ({ title, ...deps }: RequestDeps & { title: string }): Promise<Candidate | null> => {
  // `titles` is a `|`-separated list, so a pipe in the model's text would ask for several pages and the
  // first one would win. A pipe is not a legal title character, so there is nothing to look up.
  if (title.includes("|")) {
    return null;
  }
  const body = await getJson(
    WIKIPEDIA_API,
    {
      redirects: "1",
      prop: "pageimages|pageprops",
      piprop: "thumbnail|original|name",
      pithumbsize: String(THUMBNAIL_WIDTH),
      titles: title,
    },
    deps,
  );
  const page = pagesOf(body).find(isObject);
  if (!page || page.missing || (isObject(page.pageprops) && page.pageprops.disambiguation !== undefined)) {
    return null;
  }
  const originalUrl = sourceOf(page.original);
  if (typeof page.pageimage !== "string" || !originalUrl) {
    return null;
  }
  const thumbnailUrl =
    sourceOf(page.thumbnail) ?? (isObject(page.original) && isNarrowEnough(page.original.width) ? originalUrl : null);
  if (!thumbnailUrl || !isWikimediaUploadUrl(originalUrl) || !isWikimediaThumbnailUrl(thumbnailUrl)) {
    return null;
  }
  const mime = mimeFromExtension(originalUrl);
  if (!mime) {
    return null;
  }
  return { fileName: toFileKey(page.pageimage), thumbnailUrl, originalUrl, mime };
};

/** Commons files within 1 km of the point, nearest first. Never throws. */
export const fetchNearbyCommonsImages = async ({
  lat,
  lng,
  ...deps
}: RequestDeps & { lat: number; lng: number }): Promise<Candidate[]> => {
  const body = await getJson(
    COMMONS_API,
    {
      generator: "geosearch",
      ggscoord: `${lat}|${lng}`,
      ggsradius: String(GEOSEARCH_RADIUS_METERS),
      ggsnamespace: "6",
      ggslimit: String(GEOSEARCH_LIMIT),
      prop: "imageinfo",
      iiprop: "url|mime|size",
      iiurlwidth: String(THUMBNAIL_WIDTH),
    },
    deps,
  );
  const rows = pagesOf(body).flatMap((row) => {
    if (!isObject(row) || typeof row.title !== "string" || !Array.isArray(row.imageinfo)) {
      return [];
    }
    const info: unknown = row.imageinfo[0];
    if (!isObject(info) || typeof info.url !== "string" || !isAllowedMime(info.mime)) {
      return [];
    }
    const originalUrl = info.url;
    const thumbnailUrl =
      typeof info.thumburl === "string" ? info.thumburl : isNarrowEnough(info.width) ? originalUrl : null;
    if (!thumbnailUrl || !isWikimediaUploadUrl(originalUrl) || !isWikimediaThumbnailUrl(thumbnailUrl)) {
      return [];
    }
    const index = typeof row.index === "number" ? row.index : Number.POSITIVE_INFINITY;
    return [{ index, candidate: { fileName: toFileKey(row.title), thumbnailUrl, originalUrl, mime: info.mime } }];
  });
  // With `formatversion=2`, `query.pages` is a list in page-id order, not distance order; the
  // generator's `index` (from -1 upwards on the live API) is the distance rank.
  return rows.sort((a, b) => a.index - b.index).map((row) => row.candidate);
};

// Wikipedia titles are case-sensitive after the first letter, so only spacing is ignored.
const normaliseTitle = (title: string | undefined) => (title ?? "").trim().replace(/\s+/g, " ");

/** One suggestion's pictures: lead image first, then nearby Commons files, deduplicated, at most 3. */
export const findSuggestionImages = async (
  suggestion: VerifiedDaySuggestion,
  deps: RequestDeps,
): Promise<SuggestionImage[]> => {
  const wikiTitle = normaliseTitle(suggestion.wikiTitle);
  const title = normaliseTitle(suggestion.title);

  const pageImageChain = async () => {
    const first = wikiTitle || title;
    const found = first ? await fetchPageImage({ title: first, ...deps }) : null;
    if (found || !wikiTitle || !title || title === wikiTitle) {
      return found;
    }
    return fetchPageImage({ title, ...deps });
  };

  const [pageImage, nearby] = await Promise.all([
    pageImageChain(),
    fetchNearbyCommonsImages({ lat: suggestion.lat, lng: suggestion.lng, ...deps }),
  ]);

  const seen = new Set<string>();
  const images: SuggestionImage[] = [];
  for (const candidate of [...(pageImage ? [pageImage] : []), ...nearby]) {
    if (images.length >= MAX_IMAGES_PER_SUGGESTION) {
      break;
    }
    if (seen.has(candidate.fileName)) {
      continue;
    }
    seen.add(candidate.fileName);
    images.push({ thumbnailUrl: candidate.thumbnailUrl, originalUrl: candidate.originalUrl });
  }
  return images;
};

const withoutImages = (suggestions: VerifiedDaySuggestion[]): DaySuggestion[] =>
  suggestions.map((suggestion) => ({ ...suggestion, images: [] }));

/**
 * Every suggestion with its `images`, in the input order and otherwise unchanged. All lookups run at once
 * under one budget; `signal` (the client's request) aborts them too. Never throws.
 */
export const attachSuggestionImages = async (
  suggestions: VerifiedDaySuggestion[],
  {
    fetchImpl = fetch,
    signal,
    budgetMs = IMAGE_LOOKUP_BUDGET_MS,
  }: {
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
    budgetMs?: number;
  } = {},
): Promise<DaySuggestion[]> => {
  const budget = new AbortController();
  const timer = setTimeout(() => budget.abort(), budgetMs);
  const failures: string[] = [];
  try {
    // An already-aborted `signal` needs no check of its own: the combined signal is aborted too, and
    // `getJson` sends nothing on an aborted signal.
    const deps: RequestDeps = {
      fetchImpl,
      signal: signal ? AbortSignal.any([budget.signal, signal]) : budget.signal,
      userAgent: getWikimediaUserAgent(),
      onFailure: (reason) => failures.push(reason),
    };
    const images = await Promise.all(suggestions.map((suggestion) => findSuggestionImages(suggestion, deps)));
    if (failures.length > 0) {
      // One line per search, statuses and class names only. Without it a Wikimedia block (a 403 or 429
      // over the User-Agent) would empty every card with nothing in the log to say why.
      console.warn("day suggestions: image lookups failed", {
        failed: failures.length,
        reasons: [...new Set(failures)],
      });
    }
    return suggestions.map((suggestion, index) => ({ ...suggestion, images: images[index] }));
  } catch (error) {
    // Belt and braces: everything above is already non-throwing, so only a bug lands here, and even then
    // a search the operator has paid for must not turn into a 500 over its pictures. The route also
    // guards the call, in case this ever regresses.
    console.warn("day suggestions: image step failed", { name: error instanceof Error ? error.name : typeof error });
    return withoutImages(suggestions);
  } finally {
    clearTimeout(timer);
  }
};
