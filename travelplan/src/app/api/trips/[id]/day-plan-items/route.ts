import type { NextRequest } from "next/server";
import { apiError } from "@/lib/errors/apiError";
import { fail, ok } from "@/lib/http/response";
import { CSRF_COOKIE_NAME, validateCsrf } from "@/lib/security/csrf";
import { verifySessionJwt } from "@/lib/auth/jwt";
import {
  createDayPlanItemForTripDay,
  deleteDayPlanItemForTripDay,
  listDayPlanItemsForTripDay,
  updateDayPlanItemForTripDay,
} from "@/lib/repositories/dayPlanItemRepo";
import {
  dayPlanItemDeleteSchema,
  dayPlanItemMutationSchema,
  dayPlanItemUpdateSchema,
} from "@/lib/validation/dayPlanItemSchemas";

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
    const items = await listDayPlanItemsForTripDay({ userId, tripId, tripDayId });
    if (!items) {
      return fail(apiError("not_found", "Trip day not found"), 404);
    }

    return ok({
      items: items.map((item) => ({
        id: item.id,
        tripDayId: item.tripDayId,
        contentJson: item.contentJson,
        linkUrl: item.linkUrl,
        location: item.location,
        createdAt: item.createdAt.toISOString(),
      })),
    });
  } catch {
    return fail(apiError("server_error", "Unable to load day plan items"), 500);
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

  const parsed = dayPlanItemMutationSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return fail(apiError("validation_error", "Invalid day plan item", parsed.error.flatten()), 400);
  }

  const linkUrl = parsed.data.linkUrl?.trim() ?? null;
  const location = parsed.data.location ?? null;
  const normalizedLocation =
    location && typeof location.lat === "number" && typeof location.lng === "number"
      ? {
          lat: location.lat,
          lng: location.lng,
          label: location.label?.trim() || null,
        }
      : null;

  const item = await createDayPlanItemForTripDay({
    userId,
    tripId,
    tripDayId: parsed.data.tripDayId,
    contentJson: parsed.data.contentJson,
    linkUrl: linkUrl && linkUrl.length > 0 ? linkUrl : null,
    location: normalizedLocation,
  });

  if (!item) {
    return fail(apiError("not_found", "Trip day not found"), 404);
  }

  return ok({
    dayPlanItem: {
      id: item.id,
      tripDayId: item.tripDayId,
      contentJson: item.contentJson,
      linkUrl: item.linkUrl,
      location: item.location,
      createdAt: item.createdAt.toISOString(),
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

  const parsed = dayPlanItemUpdateSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return fail(apiError("validation_error", "Invalid day plan item", parsed.error.flatten()), 400);
  }

  const linkUrl = parsed.data.linkUrl?.trim() ?? null;
  const location = parsed.data.location ?? null;
  const normalizedLocation =
    location && typeof location.lat === "number" && typeof location.lng === "number"
      ? {
          lat: location.lat,
          lng: location.lng,
          label: location.label?.trim() || null,
        }
      : null;

  const updated = await updateDayPlanItemForTripDay({
    userId,
    tripId,
    tripDayId: parsed.data.tripDayId,
    itemId: parsed.data.itemId,
    contentJson: parsed.data.contentJson,
    linkUrl: linkUrl && linkUrl.length > 0 ? linkUrl : null,
    location: normalizedLocation,
  });

  if (updated.status === "not_found") {
    return fail(apiError("not_found", "Trip day not found"), 404);
  }

  if (updated.status === "missing") {
    return fail(apiError("not_found", "Day plan item not found"), 404);
  }

  return ok({
    dayPlanItem: {
      id: updated.item.id,
      tripDayId: updated.item.tripDayId,
      contentJson: updated.item.contentJson,
      linkUrl: updated.item.linkUrl,
      location: updated.item.location,
      createdAt: updated.item.createdAt.toISOString(),
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

  const parsed = dayPlanItemDeleteSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return fail(apiError("validation_error", "Invalid day plan item", parsed.error.flatten()), 400);
  }

  const deleted = await deleteDayPlanItemForTripDay({
    userId,
    tripId,
    tripDayId: parsed.data.tripDayId,
    itemId: parsed.data.itemId,
  });

  if (deleted.status === "not_found") {
    return fail(apiError("not_found", "Trip day not found"), 404);
  }

  if (deleted.status === "missing") {
    return fail(apiError("not_found", "Day plan item not found"), 404);
  }

  return ok({ deleted: true });
};
