import type { NextRequest } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { verifySessionJwt } from "@/lib/auth/jwt";
import { apiError } from "@/lib/errors/apiError";
import { fail, ok } from "@/lib/http/response";
import { getTripDayByIdForUser, updateTripDayImageForUser } from "@/lib/repositories/tripRepo";
import { CSRF_COOKIE_NAME, validateCsrf } from "@/lib/security/csrf";
import { dayImageUpdateSchema } from "@/lib/validation/dayImageSchemas";

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
  params: Promise<{
    id?: string;
    dayId?: string;
  }>;
};

const requireCsrf = (request: NextRequest) => {
  const csrfCookie = request.cookies.get(CSRF_COOKIE_NAME)?.value;
  const csrfHeader = request.headers.get("x-csrf-token") ?? undefined;
  return validateCsrf(csrfCookie, csrfHeader);
};

const removeExistingDayImageFiles = async (uploadDir: string) => {
  const candidates = ["jpg", "jpeg", "png", "webp"].map((ext) => path.join(uploadDir, `day.${ext}`));
  await Promise.all(
    candidates.map(async (filePath) => {
      try {
        await fs.unlink(filePath);
      } catch (error) {
        if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
          return;
        }
        throw error;
      }
    }),
  );
};

export const POST = async (request: NextRequest, context: RouteContext) => {
  if (!requireCsrf(request)) {
    return fail(apiError("csrf_invalid", "Invalid CSRF token"), 403);
  }

  const userId = await getSessionUserId(request);
  if (!userId) {
    return fail(apiError("unauthorized", "Authentication required"), 401);
  }

  const { id: tripId, dayId } = await context.params;
  if (!tripId || !dayId) {
    return fail(apiError("not_found", "Trip day not found"), 404);
  }

  const day = await getTripDayByIdForUser({ userId, tripId, dayId });
  if (!day) {
    return fail(apiError("not_found", "Trip day not found"), 404);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return fail(apiError("invalid_form_data", "Request body must be valid form data"), 400);
  }

  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return fail(apiError("validation_error", "Day image file is required"), 400);
  }
  const noteRaw = formData.get("note");
  if (noteRaw !== null && typeof noteRaw !== "string") {
    return fail(apiError("validation_error", "Invalid day image note"), 400);
  }

  const trimmedNote = typeof noteRaw === "string" ? noteRaw.trim() : "";
  if (trimmedNote.length > 280) {
    return fail(apiError("validation_error", "Day note must be at most 280 characters"), 400);
  }
  const normalizedNote = trimmedNote.length > 0 ? trimmedNote : null;

  const extension = ALLOWED_TYPES[file.type];
  if (!extension) {
    return fail(apiError("validation_error", "Invalid day image type"), 400);
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return fail(apiError("validation_error", "Day image exceeds size limit"), 400);
  }

  const uploadDir = path.join(process.cwd(), "public", "uploads", "trips", tripId, "days", dayId);
  await fs.mkdir(uploadDir, { recursive: true });
  await removeExistingDayImageFiles(uploadDir);

  const fileName = `day.${extension}`;
  const filePath = path.join(uploadDir, fileName);
  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(filePath, buffer);

  const imageUrl = `/uploads/trips/${tripId}/days/${dayId}/${fileName}`;
  const updated = await updateTripDayImageForUser({
    userId,
    tripId,
    dayId,
    imageUrl,
    note: normalizedNote,
  });

  if (!updated) {
    await fs.rm(uploadDir, { recursive: true, force: true });
    return fail(apiError("not_found", "Trip day not found"), 404);
  }

  return ok({
    day: {
      id: updated.id,
      imageUrl: updated.imageUrl,
      note: updated.note,
      updatedAt: updated.updatedAt.toISOString(),
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

  const { id: tripId, dayId } = await context.params;
  if (!tripId || !dayId) {
    return fail(apiError("not_found", "Trip day not found"), 404);
  }

  let rawPayload: unknown;
  try {
    rawPayload = await request.json();
  } catch {
    return fail(apiError("invalid_json", "Request body must be valid JSON"), 400);
  }

  const parsed = dayImageUpdateSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return fail(apiError("validation_error", "Invalid day image payload", parsed.error.flatten()), 400);
  }

  try {
    const updated = await updateTripDayImageForUser({
      userId,
      tripId,
      dayId,
      imageUrl: parsed.data.imageUrl,
      note: parsed.data.note === undefined ? undefined : (parsed.data.note?.trim() || null),
    });

    if (!updated) {
      return fail(apiError("not_found", "Trip day not found"), 404);
    }

    const nextImageUrl = parsed.data.imageUrl;
    const dayUploadPathPrefix = `/uploads/trips/${tripId}/days/${dayId}/`;
    if (nextImageUrl === null || (typeof nextImageUrl === "string" && !nextImageUrl.startsWith(dayUploadPathPrefix))) {
      const uploadDir = path.join(process.cwd(), "public", "uploads", "trips", tripId, "days", dayId);
      await fs.rm(uploadDir, { recursive: true, force: true });
    }

    return ok({
      day: {
        id: updated.id,
        imageUrl: updated.imageUrl,
        note: updated.note,
        updatedAt: updated.updatedAt.toISOString(),
      },
    });
  } catch {
    return fail(apiError("server_error", "Unable to update day image"), 500);
  }
};
