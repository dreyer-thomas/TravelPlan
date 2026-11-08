import type { NextRequest } from "next/server";
import { apiError } from "@/lib/errors/apiError";
import { fail } from "@/lib/http/response";
import { refuseUnlessTripWriter } from "@/lib/auth/tripAccess";
import { requireSession } from "@/lib/auth/sessionGuard";
import { CSRF_COOKIE_NAME, validateCsrf } from "@/lib/security/csrf";
import type { PackingItemDetail } from "@/lib/repositories/packingListRepo";

/**
 * Stories 16.1/16.2. Helpers shared by the packing list routes (`packing-items` and
 * `packing-items/day-links`). Not a route file: Next only serves `route.ts`.
 */

export type RouteContext = {
  params: Promise<{
    id?: string;
  }>;
};

const requireCsrf = (request: NextRequest) => {
  const csrfCookie = request.cookies.get(CSRF_COOKIE_NAME)?.value;
  const csrfHeader = request.headers.get("x-csrf-token") ?? undefined;
  return validateCsrf(csrfCookie, csrfHeader);
};

const parseJson = async (request: NextRequest) => {
  try {
    return await request.json();
  } catch {
    return null;
  }
};

/** The item as JSON: dates as ISO strings, `days` ascending by `dayIndex`. */
export const toWire = (item: PackingItemDetail) => ({
  ...item,
  days: item.days.map((day) => ({ id: day.id, dayIndex: day.dayIndex, date: day.date.toISOString() })),
  createdAt: item.createdAt.toISOString(),
  updatedAt: item.updatedAt.toISOString(),
  aiChangedAt: item.aiChangedAt?.toISOString() ?? null,
});

/** CSRF, session, trip id and the writer gate (viewer 403, outsider 404), then the JSON body. */
type WriteGate = { response: Response } | { response?: undefined; userId: string; tripId: string; rawPayload: unknown };

export const authorizeWrite = async (request: NextRequest, context: RouteContext): Promise<WriteGate> => {
  if (!requireCsrf(request)) {
    return { response: fail(apiError("csrf_invalid", "Invalid CSRF token"), 403) };
  }

  const auth = await requireSession(request);
  if (auth.response) {
    return { response: auth.response };
  }
  const userId = auth.session.sub;

  const { id: tripId } = await context.params;
  if (!tripId) {
    return { response: fail(apiError("not_found", "Trip not found"), 404) };
  }
  const refusal = await refuseUnlessTripWriter(userId, tripId, "Trip not found");
  if (refusal) {
    return { response: refusal };
  }

  const rawPayload = await parseJson(request);
  if (!rawPayload) {
    return { response: fail(apiError("invalid_json", "Request body must be valid JSON"), 400) };
  }

  return { userId, tripId, rawPayload: rawPayload as unknown };
};
