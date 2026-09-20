import type { NextRequest } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { apiError } from "@/lib/errors/apiError";
import { fail, ok } from "@/lib/http/response";
import { declaredBodyExceedsFileLimit } from "@/lib/http/bodyLimit";
import { refuseUnlessTripWriter } from "@/lib/auth/tripAccess";
import {
  createAccommodationDocument,
  deleteAccommodationDocument,
  listAccommodationDocuments,
} from "@/lib/repositories/accommodationRepo";
import { CSRF_COOKIE_NAME, validateCsrf } from "@/lib/security/csrf";
import {
  accommodationDocumentDeleteSchema,
  accommodationDocumentUploadSchema,
} from "@/lib/validation/documentGallerySchemas";
import { requireSession } from "@/lib/auth/sessionGuard";
import { DOCUMENT_LIMIT_ERROR_MESSAGE, sanitizeDocumentFileName } from "@/lib/trips/documentUploads";
import { removeManagedMediaFile } from "@/lib/trips/mediaCleanup";
import { getAccommodationDocumentUploadDir, readStoredMediaDayId } from "@/lib/trips/uploadPaths";

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

/** Extensions accepted when the browser reports no or an unhelpful MIME type. Mirrors the client gate. */
const ALLOWED_NAME_EXTENSIONS = new Set(["pdf", "jpg", "jpeg", "png", "webp"]);

/**
 * Resolves the on-disk extension, the same way `days/[dayId]/image/route.ts` does.
 *
 * Three things a bare `ALLOWED_TYPES[file.type]` lookup gets wrong, and none of them is theoretical.
 * A MIME type is case-insensitive, so `APPLICATION/PDF` misses. A browser reports no type at all for
 * some pickers and drops, and `isSupportedDocumentUpload` - the client gate - already falls back to
 * the file name in exactly that case, so without the same fallback here the field accepts a PDF and
 * the route then refuses it with a message the user cannot act on. And an index lookup on an object
 * literal reaches `Object.prototype`: `file.type = "constructor"` returns a *function*, which is
 * truthy, so the allow-list is bypassed and the generated name ends in the source of `Object`.
 * `hasOwnProperty` is what closes that, not a truthiness test.
 */
const resolveUploadExtension = (file: { type?: string; name?: string }) => {
  const normalizedType = (file.type ?? "").toLowerCase();
  if (Object.prototype.hasOwnProperty.call(ALLOWED_TYPES, normalizedType)) {
    return ALLOWED_TYPES[normalizedType];
  }

  const name = typeof file.name === "string" ? file.name : "";
  const ext = name.includes(".") ? name.split(".").pop()?.toLowerCase() : undefined;
  if (!ext || !ALLOWED_NAME_EXTENSIONS.has(ext)) {
    return null;
  }
  return ext === "jpeg" ? "jpg" : ext;
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
  const accommodationId = request.nextUrl.searchParams.get("accommodationId") ?? "";
  if (!tripDayId.trim() || !accommodationId.trim()) {
    return fail(apiError("validation_error", "Trip day and accommodation are required"), 400);
  }

  const documents = await listAccommodationDocuments({
    userId,
    tripId,
    tripDayId,
    accommodationId,
  });
  if (!documents) {
    return fail(apiError("not_found", "Accommodation not found"), 404);
  }

  return ok({
    documents: documents.map((document) => ({
      id: document.id,
      accommodationId: document.accommodationId,
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
  const refusal = await refuseUnlessTripWriter(userId, tripId, "Accommodation not found");
  if (refusal) {
    return refusal;
  }

  // Before `formData()` below - not before the buffering, which the proxy already did. Over
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

  const parsed = accommodationDocumentUploadSchema.safeParse({
    tripDayId: formData.get("tripDayId"),
    accommodationId: formData.get("accommodationId"),
  });
  if (!parsed.success) {
    return fail(apiError("validation_error", "Invalid document upload payload", parsed.error.flatten()), 400);
  }

  const extension = resolveUploadExtension(file);
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
  const uploadDir = getAccommodationDocumentUploadDir(tripId, parsed.data.tripDayId, parsed.data.accommodationId);
  await fs.mkdir(uploadDir, { recursive: true });
  const filePath = path.join(uploadDir, diskFileName);
  await fs.writeFile(filePath, Buffer.from(await file.arrayBuffer()));
  const documentUrl = `/uploads/trips/${tripId}/days/${parsed.data.tripDayId}/accommodations/${parsed.data.accommodationId}/documents/${diskFileName}`;

  const created = await createAccommodationDocument({
    userId,
    tripId,
    tripDayId: parsed.data.tripDayId,
    accommodationId: parsed.data.accommodationId,
    documentUrl,
    fileName: storedFileName,
  });
  if (created.status === "not_found") {
    await fs.rm(filePath, { force: true });
    return fail(apiError("not_found", "Accommodation not found"), 404);
  }
  if (created.status === "limit_reached") {
    // The file is already on disk at this point and no row will ever reference it, so it is removed
    // here or it is orphaned for good - nothing else knows it exists.
    await fs.rm(filePath, { force: true });
    return fail(apiError("validation_error", DOCUMENT_LIMIT_ERROR_MESSAGE), 400);
  }

  return ok({
    document: {
      id: created.document.id,
      accommodationId: created.document.accommodationId,
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
  const refusal = await refuseUnlessTripWriter(userId, tripId, "Accommodation not found");
  if (refusal) {
    return refusal;
  }

  const rawPayload = await parseJson(request);
  if (!rawPayload) {
    return fail(apiError("invalid_json", "Request body must be valid JSON"), 400);
  }

  const parsed = accommodationDocumentDeleteSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return fail(apiError("validation_error", "Invalid document delete payload", parsed.error.flatten()), 400);
  }

  // Read *before* the delete: the row is the only record of where the file is, so a delete-first
  // ordering leaves the bytes on disk with nothing left pointing at them.
  const existingDocuments = await listAccommodationDocuments({
    userId,
    tripId,
    tripDayId: parsed.data.tripDayId,
    accommodationId: parsed.data.accommodationId,
  });
  if (!existingDocuments) {
    return fail(apiError("not_found", "Accommodation not found"), 404);
  }
  const existing = existingDocuments.find((entry) => entry.id === parsed.data.documentId) ?? null;

  const deleted = await deleteAccommodationDocument({
    userId,
    tripId,
    tripDayId: parsed.data.tripDayId,
    accommodationId: parsed.data.accommodationId,
    documentId: parsed.data.documentId,
  });
  if (deleted.status === "not_found") {
    return fail(apiError("not_found", "Accommodation not found"), 404);
  }
  if (deleted.status === "missing") {
    return fail(apiError("not_found", "Document not found"), 404);
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
  // from the **stored URL**, not from `parsed.data.tripDayId` (AC9). Nothing moves an
  // accommodation between days today, so the two agree here - but the stored URL is the authority on
  // where a file actually is, and reading it the same way on all four routes is what stops this one
  // acquiring the AC9 orphan the day a mover is added: see `readStoredMediaDayId`. `null` means the URL names nothing under this trip's days, so there is no
  // file of ours to remove - and that skip is logged rather than silent, see below.
  const storedDayId = existing?.documentUrl ? readStoredMediaDayId(existing.documentUrl, tripId) : null;
  if (existing?.documentUrl) {
    if (storedDayId) {
      await removeManagedMediaFile({
        storedUrl: existing.documentUrl,
        allowedDir: getAccommodationDocumentUploadDir(tripId, storedDayId, parsed.data.accommodationId),
        context: "accommodation document delete",
      });
    } else {
      // Logged, not skipped in silence. `null` here means the stored URL names no day under this trip -
      // a value drifted, imported or migrated from somewhere else - so there is no file of ours to remove
      // and the `200` is right. Saying nothing is not: the outcome is a committed row delete with bytes
      // left on disk and nothing naming them, which is exactly the outcome the containment refusal and an
      // `EACCES` produce, and both of those log. A silent skip here is how an earlier iteration's orphans
      // went unnoticed under a green suite.
      //
      // It logs the ids and not `storedUrl` alone, because this branch fires precisely when the URL names
      // some *other* trip - so the URL is the one value that cannot lead back to the row whose bytes were
      // abandoned. The trip and entity ids are what make it findable.
      console.error("accommodation document delete: stored media url names no day under this trip", {
        tripId,
        accommodationId: parsed.data.accommodationId,
        documentId: parsed.data.documentId,
        storedUrl: existing.documentUrl,
      });
    }
  }

  return ok({ deleted: true });
};
