/**
 * Nominatim search, extracted from `/api/geocode` (Story 12.1) so a server module can geocode too - the
 * day-suggestion verification is the first caller that is not the route.
 *
 * **Moved, not rewritten.** The row-filtering block below is the route's, comments included;
 * `test/geocodeRoute.test.ts` stays unedited and green as the proof. What the extraction adds is
 * what a second caller needs and the route never had:
 *
 *   - `fetchImpl`, the OSRM/ECB injection pattern, so tests pass a fake instead of stubbing a global;
 *   - a timeout (3.5 s, the OSRM/ECB default) - the route had none, so a hung Nominatim held the request
 *     open for as long as the socket allowed;
 *   - a typed `GeocodingError`, so a caller can tell "Nominatim is down" from a bug; and
 *   - `userAgent`, because Nominatim's usage policy asks each application to identify itself and the
 *     suggestion verification is a different use from an interactive *Find*. It defaults to the
 *     route's string so `/api/geocode` is unchanged.
 *
 * A body that is not JSON is deliberately **not** a `GeocodingError`: the route answered that with a
 * 500 before the extraction and still does.
 */

export type GeocodingErrorCode = "geocoding_unavailable";

export class GeocodingError extends Error {
  code: GeocodingErrorCode;

  constructor(code: GeocodingErrorCode, message: string) {
    super(message);
    this.name = "GeocodingError";
    this.code = code;
  }
}

export type GeocodingCandidate = {
  lat: number;
  lng: number;
  label: string;
};

type NominatimResult = {
  lat?: string;
  lon?: string;
  display_name?: string;
};

export const GEOCODING_USER_AGENT = "TravelPlan/0.1 geocoding";

export const NOMINATIM_MIN_INTERVAL_MS = 1000;

/**
 * Nominatim's one-request-per-second limit applies to the whole server, not to one caller (Story 12.1
 * review). Every caller books a start slot here: `book` returns the earliest start at or after `now` that
 * is at least `minIntervalMs` after the previous booking, or `null` (booking nothing) if that start would
 * be later than `latestStartAt`. The caller waits until the slot before sending.
 *
 * `/api/geocode` books its slot but does not wait: one *Find* per click is the user's own pace, and the
 * booking alone is enough for a suggestion verification running at the same time to space around it.
 */
export const createNominatimThrottle = (minIntervalMs = NOMINATIM_MIN_INTERVAL_MS) => {
  let nextSlotAt = 0;
  return {
    book(now: number, latestStartAt = Number.POSITIVE_INFINITY): number | null {
      const slotAt = Math.max(now, nextSlotAt);
      if (slotAt > latestStartAt) {
        return null;
      }
      nextSlotAt = slotAt + minIntervalMs;
      return slotAt;
    },
  };
};

export type NominatimThrottle = ReturnType<typeof createNominatimThrottle>;

// On `globalThis` like the rate-limit store, so a dev-server module reload does not reset the spacing.
const globalForNominatim = globalThis as unknown as { nominatimThrottle?: NominatimThrottle };
export const nominatimThrottle = globalForNominatim.nominatimThrottle ?? createNominatimThrottle();
globalForNominatim.nominatimThrottle = nominatimThrottle;

export const searchNominatim = async ({
  q,
  limit = 5,
  userAgent = GEOCODING_USER_AGENT,
  fetchImpl = fetch,
  timeoutMs = 3500,
}: {
  q: string;
  limit?: number;
  userAgent?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<GeocodingCandidate[]> => {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", q);
  url.searchParams.set("format", "jsonv2");
  /**
   * Story 6.28, the half that fixes the reported "it only ever offers wrong places". This asked with
   * `limit=1` and the callers adopted `body[0]` unconditionally, so there was exactly one candidate and
   * the user never saw it *as* a candidate — it was simply pinned. For a street address that is usually
   * right; for an activity name ("Sky Tower", "Hafenrundfahrt") Nominatim returns the best *name* match
   * anywhere on earth.
   *
   * Raising the limit costs nothing under Nominatim's usage policy: it is still **one** request per
   * search, and the explicit *Find* button stays for exactly that reason — a per-keystroke type-ahead is
   * what would not be free (Trap 5). Callers that send several searches in a row space them through
   * `nominatimThrottle` below. The `User-Agent` header below is required by the same policy.
   */
  url.searchParams.set("limit", String(limit));

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  // The timer stays armed through the body read, not just the headers: a response that stalls
  // mid-body is as hung as one that never answers.
  let body: NominatimResult[];
  try {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "GET",
        headers: {
          "User-Agent": userAgent,
        },
        cache: "no-store",
        signal: controller.signal,
      });
    } catch {
      // A network failure and our own abort land here alike; neither is the caller's fault.
      throw new GeocodingError("geocoding_unavailable", "Unable to geocode location");
    }

    if (!response.ok) {
      throw new GeocodingError("geocoding_unavailable", "Unable to geocode location");
    }

    try {
      body = (await response.json()) as NominatimResult[];
    } catch (error) {
      // An abort during the read is the timeout; anything else is a body that is not JSON, which the
      // route has always answered with a 500 and so is rethrown untyped.
      if (controller.signal.aborted) {
        throw new GeocodingError("geocoding_unavailable", "Unable to geocode location");
      }
      throw error;
    }
  } finally {
    clearTimeout(timeout);
  }

  /**
   * Every usable row, in Nominatim's own relevance order, and an **empty array** where a single nulled
   * candidate used to be. The old singular field is deleted rather than shipped alongside this one: a
   * compatibility shim would let one of the five call sites keep the old "adopt whatever came back"
   * branch, which is the defect this story exists to remove.
   *
   * A row is dropped when its coordinates are missing or unparseable — the same two conditions that
   * used to null the whole answer — rather than the entire response being discarded because the first
   * row was unusable.
   */
  const results = (Array.isArray(body) ? body : []).flatMap((row) => {
    /*
      The row itself before its fields (6.28 follow-up review). `body` is upstream JSON with a declared
      type and no runtime guarantee: a `null` or a bare string among the rows made `row.lat` throw, and
      the throw landed in the outer `catch` — a 500 and *every* usable candidate lost, where the
      pre-story `body[0]` path answered 200 with no result. The array guard above already makes this
      point about the response; the same has to hold per row.
    */
    if (!row || typeof row !== "object") {
      return [];
    }

    /*
      `String(...).trim()` rather than `Number(row.lat)` alone: `Number(" ")` is `0`, and a whitespace-only
      `lat` is truthy, so a blank upstream coordinate passed both the presence and the finiteness test and
      became a selectable candidate pinned in the Gulf of Guinea. Trimming first turns it into `NaN`,
      which is what the finiteness check was always meant to catch.
    */
    const rawLat = typeof row.lat === "string" ? row.lat.trim() : row.lat;
    const rawLng = typeof row.lon === "string" ? row.lon.trim() : row.lon;
    if (!rawLat || !rawLng) {
      return [];
    }

    const lat = Number(rawLat);
    const lng = Number(rawLng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return [];
    }

    /*
      `locationSchemas.ts`'s own bounds, applied here rather than only on the write (6.28 review).
      Finiteness alone let an out-of-range upstream row become a selectable candidate whose save then
      failed server-side with `validation_error` about numbers the user never typed and cannot correct —
      the same class of dead end the parser's range check exists to prevent on the typed path. The
      rejected alternative was clamping to ±90/±180, which would pin a place that is not the one the row
      described. A row Nominatim could not spell is dropped exactly like a row with no coordinates.
    */
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return [];
    }

    // Per candidate, not once for the response: `label` is what the caller stores, and
    // `locationSchemas.ts` caps it at 200 characters, so the slice has to survive the mapping.
    return [{ lat, lng, label: (row.display_name?.trim() || q).slice(0, 200) }];
  });

  return results;
};
