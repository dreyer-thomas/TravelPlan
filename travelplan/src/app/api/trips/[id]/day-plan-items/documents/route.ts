import type { NextRequest } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { apiError } from "@/lib/errors/apiError";
import { fail, ok } from "@/lib/http/response";
import { declaredBodyExceedsFileLimit } from "@/lib/http/bodyLimit";
import { hasTripOwnerAccess } from "@/lib/auth/tripAccess";
import {
  createDayPlanItemDocument,
  deleteDayPlanItemDocument,
  listDayPlanItemDocuments,
  listDayPlanItemDocumentsForTripDay,
} from "@/lib/repositories/dayPlanItemRepo";
import { CSRF_COOKIE_NAME, validateCsrf } from "@/lib/security/csrf";
import {
  dayPlanItemDocumentDeleteSchema,
  dayPlanItemDocumentUploadSchema,
} from "@/lib/validation/documentGallerySchemas";
import { requireSession } from "@/lib/auth/sessionGuard";
import { sanitizeDocumentFileName } from "@/lib/trips/documentUploads";
import { getDayPlanItemDocumentUploadDir, resolveStoredMediaPath } from "@/lib/trips/uploadPaths";

export const runtime = "nodejs";

/**
 * 10 MB, twice the gallery's 5 MB. A ticket PDF carrying a map or a boarding pass with a large
 * barcode routinely exceeds the photo limit, and refusing the one file the feature exists to hold
 * would make the field decorative. It stays below the day-image route's 15 MB, so
 * `proxyClientMaxBodySize` does not move - see `next.config.ts`.
 */
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
/**
 * The extension is looked up here and never taken from the client. PDF plus the three image types the
 * photo fields already accept: a screenshot of a ticket is a document, and which bucket it goes in is
 * the user's decision rather than something inferred from a MIME type.
 */
const ALLOWED_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
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

const removeManagedFile = async (tripId: string, documentUrl: string) => {
  const prefix = `/uploads/trips/${tripId}/`;
  if (!documentUrl.startsWith(prefix)) {
    return;
  }
  const filePath = resolveStoredMediaPath(documentUrl);
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
  if (!tripDayId.trim()) {
    return fail(apiError("validation_error", "Trip day is required"), 400);
  }

  // Without `dayPlanItemId` this answers for the whole day, which is what the day view needs: it
  // renders a media row per activity and would otherwise issue one request per card.
  const documents = dayPlanItemId.trim()
    ? await listDayPlanItemDocuments({
        userId,
        tripId,
        tripDayId,
        dayPlanItemId,
      })
    : await listDayPlanItemDocumentsForTripDay({
        userId,
        tripId,
        tripDayId,
      });
  if (!documents) {
    return fail(apiError("not_found", dayPlanItemId.trim() ? "Day plan item not found" : "Trip day not found"), 404);
  }

  return ok({
    documents: documents.map((document) => ({
      id: document.id,
      dayPlanItemId: document.dayPlanItemId,
      documentUrl: document.documentUrl,
      fileName: document.fileName,
      sortOrder: document.sortOrder,
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
  if (!(await hasTripOwnerAccess(userId, tripId))) {
    return fail(apiError("not_found", "Day plan item not found"), 404);
  }

  // Before `formData()` below - not before the buffering, which the middleware already did. Over
  // `proxyClientMaxBodySize` (20 MB since Story 2.34) that buffer is *truncated*, not refused, so
  // `formData()` throws and an oversized-but-intact upload becomes `invalid_form_data`. The size is
  // the real problem and this is the message that says so. See `bodyLimit.ts`.
  if (declaredBodyExceedsFileLimit(request, MAX_FILE_SIZE_BYTES)) {
    return fail(apiError("validation_error", "Document exceeds size limit"), 400);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return fail(apiError("invalid_form_data", "Request body must be valid form data"), 400);
  }

  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return fail(apiError("validation_error", "Document file is required"), 400);
  }

  const parsed = dayPlanItemDocumentUploadSchema.safeParse({
    tripDayId: formData.get("tripDayId"),
    dayPlanItemId: formData.get("dayPlanItemId"),
  });
  if (!parsed.success) {
    return fail(apiError("validation_error", "Invalid document upload payload", parsed.error.flatten()), 400);
  }

  const extension = ALLOWED_TYPES[file.type];
  if (!extension) {
    return fail(apiError("validation_error", "Invalid document type"), 400);
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return fail(apiError("validation_error", "Document exceeds size limit"), 400);
  }

  // The name the user chose, kept because the chip is labelled with it and the backup round-trips it.
  // Sanitised before it is stored, and never used to build a path: it is rendered in the UI and will
  // label PDF pages in Story 9.2. Refused rather than silently replaced when nothing usable is left,
  // so an unnamed document cannot appear as a chip with no label.
  const storedFileName = sanitizeDocumentFileName(typeof file.name === "string" ? file.name : "");
  if (!storedFileName) {
    return fail(apiError("validation_error", "Document file name is required"), 400);
  }

  const diskFileName = `doc-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${extension}`;
  const uploadDir = getDayPlanItemDocumentUploadDir(tripId, parsed.data.tripDayId, parsed.data.dayPlanItemId);
  await fs.mkdir(uploadDir, { recursive: true });
  const filePath = path.join(uploadDir, diskFileName);
  await fs.writeFile(filePath, Buffer.from(await file.arrayBuffer()));
  const documentUrl = `/uploads/trips/${tripId}/days/${parsed.data.tripDayId}/day-plan-items/${parsed.data.dayPlanItemId}/documents/${diskFileName}`;

  const created = await createDayPlanItemDocument({
    userId,
    tripId,
    tripDayId: parsed.data.tripDayId,
    dayPlanItemId: parsed.data.dayPlanItemId,
    documentUrl,
    fileName: storedFileName,
  });
  if (created.status === "not_found") {
    await fs.rm(filePath, { force: true });
    return fail(apiError("not_found", "Day plan item not found"), 404);
  }
  if (created.status === "limit_reached") {
    // The file is already on disk at this point and no row will ever reference it, so it is removed
    // here or it is orphaned for good - nothing else knows it exists.
    await fs.rm(filePath, { force: true });
    return fail(apiError("validation_error", "Document limit reached"), 400);
  }

  return ok({
    document: {
      id: created.document.id,
      dayPlanItemId: created.document.dayPlanItemId,
      documentUrl: created.document.documentUrl,
      fileName: created.document.fileName,
      sortOrder: created.document.sortOrder,
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
  if (!(await hasTripOwnerAccess(userId, tripId))) {
    return fail(apiError("not_found", "Day plan item not found"), 404);
  }

  const rawPayload = await parseJson(request);
  if (!rawPayload) {
    return fail(apiError("invalid_json", "Request body must be valid JSON"), 400);
  }

  const parsed = dayPlanItemDocumentDeleteSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return fail(apiError("validation_error", "Invalid document delete payload", parsed.error.flatten()), 400);
  }

  // Read *before* the delete: the row is the only record of where the file is, so a delete-first
  // ordering leaves the bytes on disk with nothing left pointing at them.
  const existingDocuments = await listDayPlanItemDocuments({
    userId,
    tripId,
    tripDayId: parsed.data.tripDayId,
    dayPlanItemId: parsed.data.dayPlanItemId,
  });
  if (!existingDocuments) {
    return fail(apiError("not_found", "Day plan item not found"), 404);
  }
  const existing = existingDocuments.find((entry) => entry.id === parsed.data.documentId) ?? null;

  const deleted = await deleteDayPlanItemDocument({
    userId,
    tripId,
    tripDayId: parsed.data.tripDayId,
    dayPlanItemId: parsed.data.dayPlanItemId,
    documentId: parsed.data.documentId,
  });
  if (deleted.status === "not_found") {
    return fail(apiError("not_found", "Day plan item not found"), 404);
  }
  if (deleted.status === "missing") {
    return fail(apiError("not_found", "Document not found"), 404);
  }

  if (existing?.documentUrl) {
    await removeManagedFile(tripId, existing.documentUrl);
  }

  return ok({ deleted: true });
};
