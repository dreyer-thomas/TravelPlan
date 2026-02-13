import type { NextRequest } from "next/server";
import { apiError } from "@/lib/errors/apiError";
import { fail, ok } from "@/lib/http/response";
import { CSRF_COOKIE_NAME, validateCsrf } from "@/lib/security/csrf";
import { verifySessionJwt } from "@/lib/auth/jwt";
import {
  createAccommodationForTripDay,
  deleteAccommodationForTripDay,
  updateAccommodationForTripDay,
} from "@/lib/repositories/accommodationRepo";
import { accommodationDeleteSchema, accommodationMutationSchema } from "@/lib/validation/accommodationSchemas";

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

type RouteContext = {
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

export const POST = async (request: NextRequest, context: RouteContext) => {
  if (!requireCsrf(request)) {
    return fail(apiError("csrf_invalid", "Invalid CSRF token"), 403);
  }

  const userId = await getSessionUserId(request);
  if (!userId) {
    return fail(apiError("unauthorized", "Authentication required"), 401);
  }

  const { id: tripId } = await context.params;
  if (!tripId) {
    return fail(apiError("not_found", "Trip not found"), 404);
  }

  const rawPayload = await parseJson(request);
  if (!rawPayload) {
    return fail(apiError("invalid_json", "Request body must be valid JSON"), 400);
  }

  const parsed = accommodationMutationSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return fail(apiError("validation_error", "Invalid accommodation details", parsed.error.flatten()), 400);
  }

  const notes = parsed.data.notes?.trim();

  const accommodation = await createAccommodationForTripDay({
    userId,
    tripId,
    tripDayId: parsed.data.tripDayId,
    name: parsed.data.name,
    notes: notes ? notes : null,
  });

  if (!accommodation) {
    return fail(apiError("not_found", "Trip day not found"), 404);
  }

  return ok({ accommodation });
};

export const PATCH = async (request: NextRequest, context: RouteContext) => {
  if (!requireCsrf(request)) {
    return fail(apiError("csrf_invalid", "Invalid CSRF token"), 403);
  }

  const userId = await getSessionUserId(request);
  if (!userId) {
    return fail(apiError("unauthorized", "Authentication required"), 401);
  }

  const { id: tripId } = await context.params;
  if (!tripId) {
    return fail(apiError("not_found", "Trip not found"), 404);
  }

  const rawPayload = await parseJson(request);
  if (!rawPayload) {
    return fail(apiError("invalid_json", "Request body must be valid JSON"), 400);
  }

  const parsed = accommodationMutationSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return fail(apiError("validation_error", "Invalid accommodation details", parsed.error.flatten()), 400);
  }

  const notes = parsed.data.notes?.trim();

  const accommodationResult = await updateAccommodationForTripDay({
    userId,
    tripId,
    tripDayId: parsed.data.tripDayId,
    name: parsed.data.name,
    notes: notes ? notes : null,
  });

  if (accommodationResult.status === "not_found") {
    return fail(apiError("not_found", "Trip day not found"), 404);
  }

  if (accommodationResult.status === "missing") {
    return fail(apiError("not_found", "Accommodation not found"), 404);
  }

  return ok({ accommodation: accommodationResult.accommodation });
};

export const DELETE = async (request: NextRequest, context: RouteContext) => {
  if (!requireCsrf(request)) {
    return fail(apiError("csrf_invalid", "Invalid CSRF token"), 403);
  }

  const userId = await getSessionUserId(request);
  if (!userId) {
    return fail(apiError("unauthorized", "Authentication required"), 401);
  }

  const { id: tripId } = await context.params;
  if (!tripId) {
    return fail(apiError("not_found", "Trip not found"), 404);
  }

  const rawPayload = await parseJson(request);
  if (!rawPayload) {
    return fail(apiError("invalid_json", "Request body must be valid JSON"), 400);
  }

  const parsed = accommodationDeleteSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return fail(apiError("validation_error", "Invalid accommodation details", parsed.error.flatten()), 400);
  }

  const deleted = await deleteAccommodationForTripDay({
    userId,
    tripId,
    tripDayId: parsed.data.tripDayId,
  });

  if (!deleted) {
    return fail(apiError("not_found", "Trip day not found"), 404);
  }

  return ok({ deleted: true });
};
