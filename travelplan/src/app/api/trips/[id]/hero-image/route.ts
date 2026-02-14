import type { NextRequest } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";
import { apiError } from "@/lib/errors/apiError";
import { fail, ok } from "@/lib/http/response";
import { CSRF_COOKIE_NAME, validateCsrf } from "@/lib/security/csrf";
import { verifySessionJwt } from "@/lib/auth/jwt";
import { getTripByIdForUser, updateTripHeroImageForUser } from "@/lib/repositories/tripRepo";

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
  }>;
};

const requireCsrf = (request: NextRequest) => {
  const csrfCookie = request.cookies.get(CSRF_COOKIE_NAME)?.value;
  const csrfHeader = request.headers.get("x-csrf-token") ?? undefined;
  return validateCsrf(csrfCookie, csrfHeader);
};

const removeExistingHeroFiles = async (uploadDir: string) => {
  const candidates = ["jpg", "jpeg", "png", "webp"].map((ext) => path.join(uploadDir, `hero.${ext}`));
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
    })
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

  const { id: tripId } = await context.params;
  if (!tripId) {
    return fail(apiError("not_found", "Trip not found"), 404);
  }

  const trip = await getTripByIdForUser(userId, tripId);
  if (!trip) {
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
    return fail(apiError("validation_error", "Hero image file is required"), 400);
  }

  const extension = ALLOWED_TYPES[file.type];
  if (!extension) {
    return fail(apiError("validation_error", "Invalid hero image type"), 400);
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return fail(apiError("validation_error", "Hero image exceeds size limit"), 400);
  }

  const uploadDir = path.join(process.cwd(), "public", "uploads", "trips", tripId);
  await fs.mkdir(uploadDir, { recursive: true });
  await removeExistingHeroFiles(uploadDir);

  const fileName = `hero.${extension}`;
  const filePath = path.join(uploadDir, fileName);
  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(filePath, buffer);

  const heroImageUrl = `/uploads/trips/${tripId}/${fileName}`;
  const updated = await updateTripHeroImageForUser({ userId, tripId, heroImageUrl });

  if (!updated) {
    await fs.rm(uploadDir, { recursive: true, force: true });
    return fail(apiError("not_found", "Trip not found"), 404);
  }

  return ok({
    trip: {
      id: updated.id,
      name: updated.name,
      startDate: updated.startDate.toISOString(),
      endDate: updated.endDate.toISOString(),
      dayCount: updated.dayCount,
      heroImageUrl: updated.heroImageUrl,
    },
  });
};
