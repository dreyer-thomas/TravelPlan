import type { NextRequest } from "next/server";
import { apiError } from "@/lib/errors/apiError";
import { fail, ok } from "@/lib/http/response";
import { verifySessionJwt } from "@/lib/auth/jwt";

type NominatimResult = {
  lat?: string;
  lon?: string;
  display_name?: string;
};

const parseQuery = (request: NextRequest) => request.nextUrl.searchParams.get("q")?.trim() ?? "";

const getSessionUserId = async (request: NextRequest) => {
  const token = request.cookies.get("session")?.value;
  if (!token) {
    return null;
  }

  try {
    const payload = await verifySessionJwt(token);
    return payload.sub;
  } catch {
    return null;
  }
};

export const GET = async (request: NextRequest) => {
  const userId = await getSessionUserId(request);
  if (!userId) {
    return fail(apiError("unauthorized", "Authentication required"), 401);
  }

  const q = parseQuery(request);
  if (!q) {
    return fail(apiError("validation_error", "Search query is required"), 400);
  }

  if (q.length > 200) {
    return fail(apiError("validation_error", "Search query is too long"), 400);
  }

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
   * *Find*, and the explicit button stays for exactly that reason — a per-keystroke type-ahead is what
   * would not be free (Trap 5). The `User-Agent` header below is required by the same policy.
   */
  url.searchParams.set("limit", "5");

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": "TravelPlan/0.1 geocoding",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      return fail(apiError("server_error", "Unable to geocode location"), 502);
    }

    const body = (await response.json()) as NominatimResult[];

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

    return ok({ results });
  } catch {
    return fail(apiError("server_error", "Unable to geocode location"), 500);
  }
};
