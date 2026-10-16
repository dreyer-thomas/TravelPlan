import "server-only";
import { haversineMeters } from "@/lib/geo/distance";
import {
  nominatimThrottle,
  searchNominatim,
  type GeocodingCandidate,
  type NominatimThrottle,
} from "@/lib/geocoding/nominatim";
import type { DaySuggestion, ModelDaySuggestion } from "@/lib/validation/daySuggestionSchemas";

/**
 * Story 12.1, AC4. Checks each suggested place against Nominatim, and where a candidate lies within 2 km
 * of the model's coordinates, takes the geocoder's point and marks the suggestion `verified`.
 *
 * **Sequential, one request per second.** Nominatim's usage policy allows at most one request per second
 * per application - the same policy that keeps the explicit *Find* button in the activity form. A
 * `Promise.all` over eight suggestions would fire eight at once from the server's IP and risk a ban, so
 * the requests go one after another, each in a start slot booked on the process-wide `nominatimThrottle`.
 * That also spaces them around other searches and around `/api/geocode`.
 *
 * **A budget, not a promise.** The whole pass gets `budgetMs` (10 s). A request is started only if its
 * slot leaves at least `MIN_LOOKUP_MS` of the budget, and its timeout is the per-request 3.5 s or what is
 * left of the budget, whichever is less, so all eight suggestions can be tried. Once no slot fits, or the
 * client has gone (`signal`), the remaining suggestions keep the model's coordinates and
 * `verified: false`. A failed or timed-out lookup does the same for its own suggestion and the pass
 * carries on - verification never fails a search.
 *
 * **The model's label is kept.** Nominatim's `display_name` is long and noisy, and Story 12.4 stores the
 * label on the activity; only the coordinates are taken from the geocoder.
 *
 * `now`, `sleep` and `throttle` are injected so the tests run on a fake clock.
 */

export const VERIFY_MAX_DISTANCE_METERS = 2000;
export const MIN_LOOKUP_MS = 1000;
export const SUGGESTIONS_USER_AGENT = "TravelPlan/0.1 suggestions";

type Geocode = (input: {
  q: string;
  limit: number;
  userAgent: string;
  timeoutMs: number;
}) => Promise<GeocodingCandidate[]>;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const closestWithin = (origin: { lat: number; lng: number }, candidates: GeocodingCandidate[]) => {
  let best: { candidate: GeocodingCandidate; meters: number } | null = null;
  for (const candidate of candidates) {
    const meters = haversineMeters(origin, candidate);
    if (!best || meters < best.meters) {
      best = { candidate, meters };
    }
  }
  return best && best.meters <= VERIFY_MAX_DISTANCE_METERS ? best.candidate : null;
};

export const verifySuggestionLocations = async (
  suggestions: ModelDaySuggestion[],
  {
    geocode = searchNominatim,
    now = Date.now,
    sleep = defaultSleep,
    throttle = nominatimThrottle,
    signal,
    budgetMs = 10_000,
    perRequestTimeoutMs = 3_500,
  }: {
    geocode?: Geocode;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
    throttle?: NominatimThrottle;
    signal?: AbortSignal;
    budgetMs?: number;
    perRequestTimeoutMs?: number;
  } = {},
): Promise<DaySuggestion[]> => {
  const budgetEndsAt = now() + budgetMs;
  let stopped = false;
  const results: DaySuggestion[] = [];

  for (const suggestion of suggestions) {
    const slotAt = stopped || signal?.aborted ? null : throttle.book(now(), budgetEndsAt - MIN_LOOKUP_MS);
    if (slotAt === null) {
      stopped = true;
      results.push({ ...suggestion, verified: false });
      continue;
    }

    const wait = slotAt - now();
    if (wait > 0) {
      await sleep(wait);
    }
    if (signal?.aborted) {
      stopped = true;
      results.push({ ...suggestion, verified: false });
      continue;
    }

    try {
      const candidates = await geocode({
        q: suggestion.locationLabel,
        limit: 5,
        userAgent: SUGGESTIONS_USER_AGENT,
        timeoutMs: Math.min(perRequestTimeoutMs, budgetEndsAt - slotAt),
      });
      const match = closestWithin(suggestion, candidates);
      results.push(match ? { ...suggestion, lat: match.lat, lng: match.lng, verified: true } : { ...suggestion, verified: false });
    } catch {
      results.push({ ...suggestion, verified: false });
    }
  }

  return results;
};
