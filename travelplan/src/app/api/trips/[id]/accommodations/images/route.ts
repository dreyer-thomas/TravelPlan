import type { NextRequest } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { verifySessionJwt } from "@/lib/auth/jwt";
import { apiError } from "@/lib/errors/apiError";
import { fail, ok } from "@/lib/http/response";
import {
  createAccommodationImage,
  deleteAccommodationImage,
  listAccommodationImages,
  reorderAccommodationImages,
} from "@/lib/repositories/accommodationRepo";
import { CSRF_COOKIE_NAME, validateCsrf } from "@/lib/security/csrf";
import {
  accommodationImageDeleteSchema,
  accommodationImageReorderSchema,
  accommodationImageUploadSchema,
} from "@/lib/validation/imageGallerySchemas";

export const runtime = "nodejs";

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

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
  params: Promise<{ id?: string }>;
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

const removeManagedFile = async (tripId: string, imageUrl: string) => {
  const prefix = `/uploads/trips/${tripId}/`;
  if (!imageUrl.startsWith(prefix)) {
    return;
  }
  const filePath = path.join(process.cwd(), "public", imageUrl);
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
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
  const accommodationId = request.nextUrl.searchParams.get("accommodationId") ?? "";
  if (!tripDayId.trim() || !accommodationId.trim()) {
    return fail(apiError("validation_error", "Trip day and accommodation are required"), 400);
  }

  const images = await listAccommodationImages({
    userId,
    tripId,
    tripDayId,
    accommodationId,
  });
  if (!images) {
    return fail(apiError("not_found", "Accommodation not found"), 404);
  }

  return ok({
    images: images.map((image) => ({
      id: image.id,
      accommodationId: image.accommodationId,
      imageUrl: image.imageUrl,
      sortOrder: image.sortOrder,
    })),
  });
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

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return fail(apiError("invalid_form_data", "Request body must be valid form data"), 400);
  }

  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return fail(apiError("validation_error", "Image file is required"), 400);
  }

  const parsed = accommodationImageUploadSchema.safeParse({
    tripDayId: formData.get("tripDayId"),
    accommodationId: formData.get("accommodationId"),
  });
  if (!parsed.success) {
    return fail(apiError("validation_error", "Invalid gallery upload payload", parsed.error.flatten()), 400);
  }

  const extension = ALLOWED_TYPES[file.type];
  if (!extension) {
    return fail(apiError("validation_error", "Invalid image type"), 400);
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return fail(apiError("validation_error", "Image exceeds size limit"), 400);
  }

  const fileName = `img-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${extension}`;
  const uploadDir = path.join(
    process.cwd(),
    "public",
    "uploads",
    "trips",
    tripId,
    "days",
    parsed.data.tripDayId,
    "accommodations",
    parsed.data.accommodationId,
  );
  await fs.mkdir(uploadDir, { recursive: true });
  const filePath = path.join(uploadDir, fileName);
  await fs.writeFile(filePath, Buffer.from(await file.arrayBuffer()));
  const imageUrl = `/uploads/trips/${tripId}/days/${parsed.data.tripDayId}/accommodations/${parsed.data.accommodationId}/${fileName}`;

  const created = await createAccommodationImage({
    userId,
    tripId,
    tripDayId: parsed.data.tripDayId,
    accommodationId: parsed.data.accommodationId,
    imageUrl,
  });
  if (!created) {
    await fs.rm(filePath, { force: true });
    return fail(apiError("not_found", "Accommodation not found"), 404);
  }

  return ok({
    image: {
      id: created.id,
      accommodationId: created.accommodationId,
      imageUrl: created.imageUrl,
      sortOrder: created.sortOrder,
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

  const parsed = accommodationImageDeleteSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return fail(apiError("validation_error", "Invalid gallery delete payload", parsed.error.flatten()), 400);
  }

  const existingImages = await listAccommodationImages({
    userId,
    tripId,
    tripDayId: parsed.data.tripDayId,
    accommodationId: parsed.data.accommodationId,
  });
  if (!existingImages) {
    return fail(apiError("not_found", "Accommodation not found"), 404);
  }
  const existing = existingImages.find((entry) => entry.id === parsed.data.imageId) ?? null;

  const deleted = await deleteAccommodationImage({
    userId,
    tripId,
    tripDayId: parsed.data.tripDayId,
    accommodationId: parsed.data.accommodationId,
    imageId: parsed.data.imageId,
  });
  if (deleted.status === "not_found") {
    return fail(apiError("not_found", "Accommodation not found"), 404);
  }
  if (deleted.status === "missing") {
    return fail(apiError("not_found", "Image not found"), 404);
  }

  if (existing?.imageUrl) {
    await removeManagedFile(tripId, existing.imageUrl);
  }

  return ok({ deleted: true });
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

  const parsed = accommodationImageReorderSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return fail(apiError("validation_error", "Invalid gallery reorder payload", parsed.error.flatten()), 400);
  }

  const reordered = await reorderAccommodationImages({
    userId,
    tripId,
    tripDayId: parsed.data.tripDayId,
    accommodationId: parsed.data.accommodationId,
    order: parsed.data.order,
  });
  if (reordered.status === "not_found") {
    return fail(apiError("not_found", "Accommodation not found"), 404);
  }
  if (reordered.status === "missing") {
    return fail(apiError("validation_error", "Invalid gallery reorder request"), 400);
  }

  return ok({ reordered: true });
};
