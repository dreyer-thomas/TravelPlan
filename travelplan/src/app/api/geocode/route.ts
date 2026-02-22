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
  url.searchParams.set("limit", "1");

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
    const first = body[0];
    if (!first || !first.lat || !first.lon) {
      return ok({ result: null });
    }

    const lat = Number(first.lat);
    const lng = Number(first.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return ok({ result: null });
    }

    const rawLabel = first.display_name?.trim() || q;
    const label = rawLabel.slice(0, 200);

    return ok({
      result: {
        lat,
        lng,
        label,
      },
    });
  } catch {
    return fail(apiError("server_error", "Unable to geocode location"), 500);
  }
};
