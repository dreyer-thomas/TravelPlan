import type { NextRequest } from "next/server";
import { apiError } from "@/lib/errors/apiError";
import { fail, ok } from "@/lib/http/response";
import { CSRF_COOKIE_NAME, validateCsrf } from "@/lib/security/csrf";
import { createTripSchema } from "@/lib/validation/tripSchemas";
import { createTripWithDays, listTripsForUser } from "@/lib/repositories/tripRepo";
import { verifySessionJwt } from "@/lib/auth/jwt";

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

export const POST = async (request: NextRequest) => {
  const csrfCookie = request.cookies.get(CSRF_COOKIE_NAME)?.value;
  const csrfHeader = request.headers.get("x-csrf-token") ?? undefined;
  if (!validateCsrf(csrfCookie, csrfHeader)) {
    return fail(apiError("csrf_invalid", "Invalid CSRF token"), 403);
  }

  const userId = await getSessionUserId(request);
  if (!userId) {
    return fail(apiError("unauthorized", "Authentication required"), 401);
  }

  let rawPayload: unknown;
  try {
    rawPayload = await request.json();
  } catch {
    return fail(apiError("invalid_json", "Request body must be valid JSON"), 400);
  }

  const parsed = createTripSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return fail(apiError("validation_error", "Invalid trip details", parsed.error.flatten()), 400);
  }

  try {
    const { name, startDate, endDate } = parsed.data;
    const { trip, dayCount } = await createTripWithDays({
      userId,
      name,
      startDate,
      endDate,
    });

    return ok({
      trip: {
        id: trip.id,
        name: trip.name,
        startDate: trip.startDate.toISOString(),
        endDate: trip.endDate.toISOString(),
      },
      dayCount,
    });
  } catch {
    return fail(apiError("server_error", "Unable to create trip"), 500);
  }
};

export const GET = async (request: NextRequest) => {
  const userId = await getSessionUserId(request);
  if (!userId) {
    return fail(apiError("unauthorized", "Authentication required"), 401);
  }

  try {
    const trips = await listTripsForUser(userId);
    return ok({
      trips: trips.map((trip) => ({
        id: trip.id,
        name: trip.name,
        startDate: trip.startDate.toISOString(),
        endDate: trip.endDate.toISOString(),
        dayCount: trip.dayCount,
      })),
    });
  } catch {
    return fail(apiError("server_error", "Unable to load trips"), 500);
  }
};
