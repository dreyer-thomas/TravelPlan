import type { NextRequest } from "next/server";
import { verifySessionJwt } from "@/lib/auth/jwt";
import { apiError } from "@/lib/errors/apiError";
import { fail, ok } from "@/lib/http/response";
import { importTripFromExportForUser } from "@/lib/repositories/tripRepo";
import { CSRF_COOKIE_NAME, validateCsrf } from "@/lib/security/csrf";
import { tripImportRequestSchema } from "@/lib/validation/tripImportSchemas";

export const runtime = "nodejs";

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

  const parsed = tripImportRequestSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return fail(apiError("validation_error", "Invalid import payload", parsed.error.flatten()), 400);
  }

  try {
    const imported = await importTripFromExportForUser({
      userId,
      payload: parsed.data.payload,
      strategy: parsed.data.strategy,
      targetTripId: parsed.data.targetTripId,
    });

    if (imported.outcome === "conflict") {
      return fail(
        apiError("trip_name_conflict", "Trip with same name already exists", {
          conflicts: imported.conflicts,
          strategyRequired: true,
        }),
        409
      );
    }

    return ok({
      trip: {
        id: imported.trip.id,
        name: imported.trip.name,
        startDate: imported.trip.startDate.toISOString(),
        endDate: imported.trip.endDate.toISOString(),
        heroImageUrl: imported.trip.heroImageUrl,
      },
      dayCount: imported.dayCount,
      mode: imported.mode,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "target_trip_not_found") {
      return fail(apiError("not_found", "Target trip not found for overwrite"), 404);
    }
    if (error instanceof Error && error.message === "target_trip_not_conflict") {
      return fail(apiError("trip_name_conflict", "Target trip must be selected from name conflicts"), 409);
    }

    return fail(apiError("server_error", "Unable to import trip"), 500);
  }
};
