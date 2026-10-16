import type { NextRequest } from "next/server";
import { apiError } from "@/lib/errors/apiError";
import { fail, ok } from "@/lib/http/response";
import { verifySessionJwt } from "@/lib/auth/jwt";
import { GeocodingError, nominatimThrottle, searchNominatim } from "@/lib/geocoding/nominatim";

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

  // The request, the five-candidate limit and the row filtering moved to `lib/geocoding/nominatim.ts`
  // unchanged (Story 12.1), so the day-suggestion verification can geocode without an HTTP hop. This
  // route keeps its session and query checks and its two failure statuses. It books a Nominatim slot
  // without waiting for it, so a suggestion verification running at the same time spaces around it.
  nominatimThrottle.book(Date.now());
  try {
    const results = await searchNominatim({ q });
    return ok({ results });
  } catch (error) {
    if (error instanceof GeocodingError) {
      return fail(apiError("server_error", "Unable to geocode location"), 502);
    }
    return fail(apiError("server_error", "Unable to geocode location"), 500);
  }
};
