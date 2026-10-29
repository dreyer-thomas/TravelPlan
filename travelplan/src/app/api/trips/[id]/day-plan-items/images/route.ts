import type { NextRequest } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { apiError } from "@/lib/errors/apiError";
import { fail, ok } from "@/lib/http/response";
import { declaredBodyExceedsFileLimit } from "@/lib/http/bodyLimit";
import { refuseUnlessTripWriter } from "@/lib/auth/tripAccess";
import {
  createDayPlanItemImage,
  deleteDayPlanItemImage,
  listDayPlanItemImages,
  listDayPlanItemImagesForTripDay,
  reorderDayPlanItemImages,
} from "@/lib/repositories/dayPlanItemRepo";
import { CSRF_COOKIE_NAME, validateCsrf } from "@/lib/security/csrf";
import {
  dayPlanItemImageDeleteSchema,
  dayPlanItemImageReorderSchema,
  dayPlanItemImageUploadSchema,
} from "@/lib/validation/imageGallerySchemas";
import { requireSession } from "@/lib/auth/sessionGuard";
import { removeManagedMediaFile } from "@/lib/trips/mediaCleanup";
import {
  getDayPlanItemImageUploadDir,
  getParkedDayPlanItemImageUploadDir,
  resolveManagedItemMediaDir,
} from "@/lib/trips/uploadPaths";

export const runtime = "nodejs";

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
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

  const tripDayId = request.nextUrl.searchParams.get("tripDayId") ?? "";
  const dayPlanItemId = request.nextUrl.searchParams.get("dayPlanItemId") ?? "";
  // Story 14.1: a parked activity (on the bucket list) has no day and is asked for by its id alone; the
  // day-wide list still needs its day.
  if (!tripDayId.trim() && !dayPlanItemId.trim()) {
    return fail(apiError("validation_error", "Trip day is required"), 400);
  }

  const images = dayPlanItemId.trim()
    ? await listDayPlanItemImages({
        userId,
        tripId,
        tripDayId: tripDayId.trim() || null,
        dayPlanItemId,
      })
    : await listDayPlanItemImagesForTripDay({
        userId,
        tripId,
        tripDayId,
      });
  if (!images) {
    return fail(apiError("not_found", dayPlanItemId.trim() ? "Day plan item not found" : "Trip day not found"), 404);
  }

  return ok({
    images: images.map((image) => ({
      id: image.id,
      dayPlanItemId: image.dayPlanItemId,
      imageUrl: image.imageUrl,
      sortOrder: image.sortOrder,
    })),
  });
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
  const refusal = await refuseUnlessTripWriter(userId, tripId, "Day plan item not found");
  if (refusal) {
    return refusal;
  }

  // Before `formData()` below - not before the buffering, which the proxy already did. Over
  // `proxyClientMaxBodySize` (20 MB since Story 2.34) that buffer is *truncated*, not refused, so
  // `formData()` throws and an oversized-but-intact upload becomes `invalid_form_data`. The size is
  // the real problem and this is the message that says so. See `bodyLimit.ts`.
  if (declaredBodyExceedsFileLimit(request, MAX_FILE_SIZE_BYTES)) {
    return fail(apiError("validation_error", "Image exceeds size limit"), 400);
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

  const parsed = dayPlanItemImageUploadSchema.safeParse({
    // Story 14.1: absent for a parked activity.
    tripDayId: formData.get("tripDayId") ?? undefined,
    dayPlanItemId: formData.get("dayPlanItemId"),
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
  // Story 14.1: into the item's current place - its day, or `parked/` for a bucket-list idea. The repository
  // write below is scoped by that same place, so a request naming the wrong one is refused and the file
  // removed again.
  const { tripDayId, dayPlanItemId } = parsed.data;
  const uploadDir = tripDayId
    ? getDayPlanItemImageUploadDir(tripId, tripDayId, dayPlanItemId)
    : getParkedDayPlanItemImageUploadDir(tripId, dayPlanItemId);
  await fs.mkdir(uploadDir, { recursive: true });
  const filePath = path.join(uploadDir, fileName);
  await fs.writeFile(filePath, Buffer.from(await file.arrayBuffer()));
  const imageUrl = tripDayId
    ? `/uploads/trips/${tripId}/days/${tripDayId}/day-plan-items/${dayPlanItemId}/${fileName}`
    : `/uploads/trips/${tripId}/parked/day-plan-items/${dayPlanItemId}/${fileName}`;

  const created = await createDayPlanItemImage({
    userId,
    tripId,
    origin: "user",
    tripDayId: parsed.data.tripDayId,
    dayPlanItemId: parsed.data.dayPlanItemId,
    imageUrl,
  });
  if (!created) {
    await fs.rm(filePath, { force: true });
    return fail(apiError("not_found", "Day plan item not found"), 404);
  }

  return ok({
    image: {
      id: created.id,
      dayPlanItemId: created.dayPlanItemId,
      imageUrl: created.imageUrl,
      sortOrder: created.sortOrder,
    },
  });
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
  const refusal = await refuseUnlessTripWriter(userId, tripId, "Day plan item not found");
  if (refusal) {
    return refusal;
  }

  const rawPayload = await parseJson(request);
  if (!rawPayload) {
    return fail(apiError("invalid_json", "Request body must be valid JSON"), 400);
  }

  const parsed = dayPlanItemImageDeleteSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return fail(apiError("validation_error", "Invalid gallery delete payload", parsed.error.flatten()), 400);
  }

  const existingImages = await listDayPlanItemImages({
    userId,
    tripId,
    tripDayId: parsed.data.tripDayId,
    dayPlanItemId: parsed.data.dayPlanItemId,
  });
  if (!existingImages) {
    return fail(apiError("not_found", "Day plan item not found"), 404);
  }
  const existing = existingImages.find((entry) => entry.id === parsed.data.imageId) ?? null;

  const deleted = await deleteDayPlanItemImage({
    userId,
    tripId,
    tripDayId: parsed.data.tripDayId,
    dayPlanItemId: parsed.data.dayPlanItemId,
    imageId: parsed.data.imageId,
  });
  if (deleted.status === "not_found") {
    return fail(apiError("not_found", "Day plan item not found"), 404);
  }
  if (deleted.status === "missing") {
    return fail(apiError("not_found", "Image not found"), 404);
  }

  // Post-commit, so the row is already gone whatever happens here: `removeManagedMediaFile` logs a
  // non-`ENOENT` errno instead of throwing (Story 8.4 / DW-195). It used to rethrow, which turned a
  // completed deletion into a 500 and a "removal failed" message about a row that no longer existed.
  //
  // The directory is the entry's own. It is **not** "strictly narrower" than the `/uploads/trips/<tripId>/`
  // string test it replaces, and saying so would be a containment claim that is false on its own terms: it
  // is narrower on nesting and traversal (which that prefix admitted into any file in the trip - AC8) and
  // deliberately *wider* on spelling (a `//uploads/…` value failed the prefix test and passes this one,
  // because the decision is made on the resolved path rather than on the string). Its day segment comes
  // from the **stored URL**, not from `parsed.data.tripDayId` (AC9). This route is where that
  // distinction bites hardest: parking an activity and scheduling it onto another day (Story 14.2, 14.1),
  // and the whole-day transfer, reassign its `tripDayId` without moving a file or rewriting a URL, so for
  // any activity that has ever changed day the request's day is not the day its photos are under.
  // Building the directory from it answered
  // `200 { deleted: true }` and left the bytes orphaned - see `readStoredMediaDayId`. `null` means the URL
  // names nothing under this trip's days, so there is no file of ours to remove - and that skip is logged.
  // Story 14.1: the one rule for every activity media delete (`resolveManagedItemMediaDir`), which also
  // accepts the item's `parked/` folder. `null` means the URL names no folder of this activity under this
  // trip, so there is no file of ours to remove - and that skip is logged.
  if (existing?.imageUrl) {
    const allowedDir = resolveManagedItemMediaDir({
      storedUrl: existing.imageUrl,
      tripId,
      itemId: parsed.data.dayPlanItemId,
      kind: "image",
    });
    if (allowedDir) {
      await removeManagedMediaFile({
        storedUrl: existing.imageUrl,
        allowedDir,
        context: "day plan item image delete",
      });
    } else {
      // Logged, not skipped in silence. `null` here means the stored URL names no folder of this activity -
      // a value drifted, imported or migrated from somewhere else - so there is no file of ours to remove
      // and the `200` is right. Saying nothing is not: the outcome is a committed row delete with bytes
      // left on disk and nothing naming them, which is exactly the outcome the containment refusal and an
      // `EACCES` produce, and both of those log. A silent skip here is how an earlier iteration's orphans
      // went unnoticed under a green suite.
      //
      // It logs the ids and not `storedUrl` alone, because this branch fires precisely when the URL names
      // some *other* trip - so the URL is the one value that cannot lead back to the row whose bytes were
      // abandoned. The trip and entity ids are what make it findable.
      console.error("day plan item image delete: stored media url names no folder of this activity", {
        tripId,
        dayPlanItemId: parsed.data.dayPlanItemId,
        imageId: parsed.data.imageId,
        storedUrl: existing.imageUrl,
      });
    }
  }

  return ok({ deleted: true });
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
  // Reordering had no route gate at all before Story 5.13; it was safe only because
  // `reorderDayPlanItemImages` resolved through an owner-only scope. That scope is now the writer clause,
  // so without a gate here a viewer's refusal would come back from the repository as a 404 and silently
  // break AC6 on this one verb.
  const refusal = await refuseUnlessTripWriter(userId, tripId, "Day plan item not found");
  if (refusal) {
    return refusal;
  }

  const rawPayload = await parseJson(request);
  if (!rawPayload) {
    return fail(apiError("invalid_json", "Request body must be valid JSON"), 400);
  }

  const parsed = dayPlanItemImageReorderSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return fail(apiError("validation_error", "Invalid gallery reorder payload", parsed.error.flatten()), 400);
  }

  const reordered = await reorderDayPlanItemImages({
    userId,
    tripId,
    tripDayId: parsed.data.tripDayId,
    dayPlanItemId: parsed.data.dayPlanItemId,
    order: parsed.data.order,
  });
  if (reordered.status === "not_found") {
    return fail(apiError("not_found", "Day plan item not found"), 404);
  }
  if (reordered.status === "missing") {
    return fail(apiError("validation_error", "Invalid gallery reorder request"), 400);
  }

  return ok({ reordered: true });
};
