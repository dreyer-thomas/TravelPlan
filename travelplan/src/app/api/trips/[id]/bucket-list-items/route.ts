import type { NextRequest } from "next/server";
import { apiError } from "@/lib/errors/apiError";
import { fail, ok } from "@/lib/http/response";
import { CSRF_COOKIE_NAME, validateCsrf } from "@/lib/security/csrf";
import {
  createBucketListItemForTrip,
  deleteBucketListItemForTrip,
  listBucketListItemsForTrip,
  updateBucketListItemForTrip,
} from "@/lib/repositories/bucketListRepo";
import {
  bucketListDeleteSchema,
  bucketListMutationSchema,
  bucketListUpdateSchema,
} from "@/lib/validation/bucketListSchemas";
import { requireSession } from "@/lib/auth/sessionGuard";

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

const normalizeLocation = (location: { lat: number; lng: number; label?: string | null } | null | undefined) =>
  location && typeof location.lat === "number" && typeof location.lng === "number"
    ? {
        lat: location.lat,
        lng: location.lng,
        label: location.label?.trim() || null,
      }
    : null;

export const GET = async (request: NextRequest, context: RouteContext) => {
  const auth = await requireSession(request);
  if (auth.response) {
    return auth.response;
  }
  const userId = auth.session.sub;

  const { id: tripId } = await context.params;
  if (!tripId) {
    return fail(apiError("not_found", "Trip not found"), 404);
  }

  try {
    const items = await listBucketListItemsForTrip({ userId, tripId });
    if (!items) {
      return fail(apiError("not_found", "Trip not found"), 404);
    }

    return ok({
      items: items.map((item) => ({
        id: item.id,
        tripId: item.tripId,
        title: item.title,
        description: item.description,
        positionText: item.positionText,
        location: item.location,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      })),
    });
  } catch {
    return fail(apiError("server_error", "Unable to load bucket list items"), 500);
  }
};

export const POST = async (request: NextRequest, context: RouteContext) => {
  if (!requireCsrf(request)) {
    return fail(apiError("csrf_invalid", "Invalid CSRF token"), 403);
  }

  const auth = await requireSession(request);
  if (auth.response) {
    return auth.response;
  }
  const userId = auth.session.sub;

  const { id: tripId } = await context.params;
  if (!tripId) {
    return fail(apiError("not_found", "Trip not found"), 404);
  }

  const rawPayload = await parseJson(request);
  if (!rawPayload) {
    return fail(apiError("invalid_json", "Request body must be valid JSON"), 400);
  }

  const parsed = bucketListMutationSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return fail(apiError("validation_error", "Invalid bucket list item", parsed.error.flatten()), 400);
  }

  try {
    const item = await createBucketListItemForTrip({
      userId,
      tripId,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      positionText: parsed.data.positionText ?? null,
      location: normalizeLocation(parsed.data.location ?? null),
    });

    if (!item) {
      return fail(apiError("not_found", "Trip not found"), 404);
    }

    return ok({
      item: {
        id: item.id,
        tripId: item.tripId,
        title: item.title,
        description: item.description,
        positionText: item.positionText,
        location: item.location,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      },
    });
  } catch {
    return fail(apiError("server_error", "Unable to save bucket list item"), 500);
  }
};

export const PATCH = async (request: NextRequest, context: RouteContext) => {
  if (!requireCsrf(request)) {
    return fail(apiError("csrf_invalid", "Invalid CSRF token"), 403);
  }

  const auth = await requireSession(request);
  if (auth.response) {
    return auth.response;
  }
  const userId = auth.session.sub;

  const { id: tripId } = await context.params;
  if (!tripId) {
    return fail(apiError("not_found", "Trip not found"), 404);
  }

  const rawPayload = await parseJson(request);
  if (!rawPayload) {
    return fail(apiError("invalid_json", "Request body must be valid JSON"), 400);
  }

  const parsed = bucketListUpdateSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return fail(apiError("validation_error", "Invalid bucket list item", parsed.error.flatten()), 400);
  }

  try {
    const updated = await updateBucketListItemForTrip({
      userId,
      tripId,
      itemId: parsed.data.itemId,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      positionText: parsed.data.positionText ?? null,
      location: normalizeLocation(parsed.data.location ?? null),
    });

    if (updated.status === "not_found") {
      return fail(apiError("not_found", "Trip not found"), 404);
    }

    if (updated.status === "missing") {
      return fail(apiError("not_found", "Bucket list item not found"), 404);
    }

    return ok({
      item: {
        id: updated.item.id,
        tripId: updated.item.tripId,
        title: updated.item.title,
        description: updated.item.description,
        positionText: updated.item.positionText,
        location: updated.item.location,
        createdAt: updated.item.createdAt.toISOString(),
        updatedAt: updated.item.updatedAt.toISOString(),
      },
    });
  } catch {
    return fail(apiError("server_error", "Unable to update bucket list item"), 500);
  }
};

export const DELETE = async (request: NextRequest, context: RouteContext) => {
  if (!requireCsrf(request)) {
    return fail(apiError("csrf_invalid", "Invalid CSRF token"), 403);
  }

  const auth = await requireSession(request);
  if (auth.response) {
    return auth.response;
  }
  const userId = auth.session.sub;

  const { id: tripId } = await context.params;
  if (!tripId) {
    return fail(apiError("not_found", "Trip not found"), 404);
  }

  const rawPayload = await parseJson(request);
  if (!rawPayload) {
    return fail(apiError("invalid_json", "Request body must be valid JSON"), 400);
  }

  const parsed = bucketListDeleteSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return fail(apiError("validation_error", "Invalid bucket list item", parsed.error.flatten()), 400);
  }

  try {
    const deleted = await deleteBucketListItemForTrip({
      userId,
      tripId,
      itemId: parsed.data.itemId,
    });

    if (deleted.status === "not_found") {
      return fail(apiError("not_found", "Trip not found"), 404);
    }

    if (deleted.status === "missing") {
      return fail(apiError("not_found", "Bucket list item not found"), 404);
    }

    return ok({ deleted: true });
  } catch {
    return fail(apiError("server_error", "Unable to delete bucket list item"), 500);
  }
};
