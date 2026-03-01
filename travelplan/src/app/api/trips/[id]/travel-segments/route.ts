import type { NextRequest } from "next/server";
import { apiError } from "@/lib/errors/apiError";
import { fail, ok } from "@/lib/http/response";
import { CSRF_COOKIE_NAME, validateCsrf } from "@/lib/security/csrf";
import { verifySessionJwt } from "@/lib/auth/jwt";
import { Prisma } from "@/generated/prisma/client";
import {
  createTravelSegmentForTripDay,
  deleteTravelSegmentForTripDay,
  listTravelSegmentsForTripDay,
  updateTravelSegmentForTripDay,
} from "@/lib/repositories/travelSegmentRepo";
import {
  travelSegmentDeleteSchema,
  travelSegmentMutationSchema,
  travelSegmentUpdateSchema,
} from "@/lib/validation/travelSegmentSchemas";

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

export const GET = async (request: NextRequest, context: RouteContext) => {
  const userId = await getSessionUserId(request);
  if (!userId) {
    return fail(apiError("unauthorized", "Authentication required"), 401);
  }

  const { id: tripId } = await context.params;
  if (!tripId) {
    return fail(apiError("not_found", "Trip not found"), 404);
  }

  const tripDayId = request.nextUrl.searchParams.get("tripDayId") ?? "";
  if (!tripDayId.trim()) {
    return fail(apiError("validation_error", "Trip day is required"), 400);
  }

  try {
    const segments = await listTravelSegmentsForTripDay({ userId, tripId, tripDayId });
    if (!segments) {
      return fail(apiError("not_found", "Trip day not found"), 404);
    }

    return ok({
      segments: segments.map((segment) => ({
        id: segment.id,
        tripDayId: segment.tripDayId,
        fromItemType: segment.fromItemType,
        fromItemId: segment.fromItemId,
        toItemType: segment.toItemType,
        toItemId: segment.toItemId,
        transportType: segment.transportType,
        durationMinutes: segment.durationMinutes,
        distanceKm: segment.distanceKm,
        linkUrl: segment.linkUrl,
        createdAt: segment.createdAt.toISOString(),
        updatedAt: segment.updatedAt.toISOString(),
      })),
    });
  } catch {
    return fail(apiError("server_error", "Unable to load travel segments"), 500);
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

  const parsed = travelSegmentMutationSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return fail(apiError("validation_error", "Invalid travel segment", parsed.error.flatten()), 400);
  }

  const linkUrl = parsed.data.linkUrl?.trim() ?? null;

  let segmentResult;
  try {
    segmentResult = await createTravelSegmentForTripDay({
      userId,
      tripId,
      tripDayId: parsed.data.tripDayId,
      fromItemType: parsed.data.fromItemType,
      fromItemId: parsed.data.fromItemId,
      toItemType: parsed.data.toItemType,
      toItemId: parsed.data.toItemId,
      transportType: parsed.data.transportType,
      durationMinutes: parsed.data.durationMinutes,
      distanceKm: parsed.data.distanceKm ?? null,
      linkUrl: linkUrl && linkUrl.length > 0 ? linkUrl : null,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return fail(apiError("travel_segment_exists", "Travel segment already exists"), 409);
    }
    return fail(apiError("server_error", "Unable to save travel segment"), 500);
  }

  if (segmentResult.status === "not_found") {
    return fail(apiError("not_found", "Trip day not found"), 404);
  }
  if (segmentResult.status === "missing") {
    return fail(apiError("not_found", "Travel segment items not found"), 404);
  }
  if (segmentResult.status === "not_adjacent") {
    return fail(apiError("validation_error", "Travel segment must connect adjacent items"), 400);
  }

  const segment = segmentResult.segment;

  return ok({
    segment: {
      id: segment.id,
      tripDayId: segment.tripDayId,
      fromItemType: segment.fromItemType,
      fromItemId: segment.fromItemId,
      toItemType: segment.toItemType,
      toItemId: segment.toItemId,
      transportType: segment.transportType,
      durationMinutes: segment.durationMinutes,
      distanceKm: segment.distanceKm,
      linkUrl: segment.linkUrl,
      createdAt: segment.createdAt.toISOString(),
      updatedAt: segment.updatedAt.toISOString(),
    },
  });
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

  const parsed = travelSegmentUpdateSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return fail(apiError("validation_error", "Invalid travel segment", parsed.error.flatten()), 400);
  }

  const linkUrl = parsed.data.linkUrl?.trim() ?? null;

  let updated;
  try {
    updated = await updateTravelSegmentForTripDay({
      userId,
      tripId,
      tripDayId: parsed.data.tripDayId,
      segmentId: parsed.data.segmentId,
      fromItemType: parsed.data.fromItemType,
      fromItemId: parsed.data.fromItemId,
      toItemType: parsed.data.toItemType,
      toItemId: parsed.data.toItemId,
      transportType: parsed.data.transportType,
      durationMinutes: parsed.data.durationMinutes,
      distanceKm: parsed.data.distanceKm ?? null,
      linkUrl: linkUrl && linkUrl.length > 0 ? linkUrl : null,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return fail(apiError("travel_segment_exists", "Travel segment already exists"), 409);
    }
    return fail(apiError("server_error", "Unable to save travel segment"), 500);
  }

  if (updated.status === "not_found") {
    return fail(apiError("not_found", "Trip day not found"), 404);
  }

  if (updated.status === "missing") {
    return fail(apiError("not_found", "Travel segment not found"), 404);
  }

  if (updated.status === "not_adjacent") {
    return fail(apiError("validation_error", "Travel segment must connect adjacent items"), 400);
  }

  return ok({
    segment: {
      id: updated.segment.id,
      tripDayId: updated.segment.tripDayId,
      fromItemType: updated.segment.fromItemType,
      fromItemId: updated.segment.fromItemId,
      toItemType: updated.segment.toItemType,
      toItemId: updated.segment.toItemId,
      transportType: updated.segment.transportType,
      durationMinutes: updated.segment.durationMinutes,
      distanceKm: updated.segment.distanceKm,
      linkUrl: updated.segment.linkUrl,
      createdAt: updated.segment.createdAt.toISOString(),
      updatedAt: updated.segment.updatedAt.toISOString(),
    },
  });
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

  const parsed = travelSegmentDeleteSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return fail(apiError("validation_error", "Invalid travel segment", parsed.error.flatten()), 400);
  }

  let deleted;
  try {
    deleted = await deleteTravelSegmentForTripDay({
      userId,
      tripId,
      tripDayId: parsed.data.tripDayId,
      segmentId: parsed.data.segmentId,
    });
  } catch {
    return fail(apiError("server_error", "Unable to delete travel segment"), 500);
  }

  if (deleted.status === "not_found") {
    return fail(apiError("not_found", "Trip day not found"), 404);
  }

  if (deleted.status === "missing") {
    return fail(apiError("not_found", "Travel segment not found"), 404);
  }

  return ok({ deleted: true });
};
