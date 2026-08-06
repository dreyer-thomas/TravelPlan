import { z } from "zod";
import { isSafeMediaSegment } from "@/lib/trips/uploadPaths";

/**
 * Mirrors `imageGallerySchemas.ts`, minus the reorder pair: document order is insertion order and
 * Story 9.1 adds no way to change it, so there is no payload to describe.
 *
 * The uploaded file's name is not validated here. It arrives on the `File` rather than as a form
 * field, and it is sanitised by `sanitizeDocumentFileName` in `documentUploads.ts` - one helper the
 * routes and the backup importer share, rather than a rule that exists once per entry point.
 */
const entityIdSchema = z.string().trim().min(1);

/**
 * An id that the upload route joins into a filesystem path.
 *
 * `tripDayId` and the entity id are both path components of the entry's `documents` directory, and
 * `POST` builds that directory - `fs.mkdir(..., { recursive: true })` and `fs.writeFile` - *before*
 * the repository has confirmed the entry exists. Validated only as "non-empty string", a `tripDayId`
 * of `../../..` therefore creates directories outside `MEDIA_STORAGE_ROOT` and writes a file into
 * them; the failed insert removes the file afterwards but never the directories. The scope check
 * cannot be the guard here because it runs too late, and this is not the serve route's problem
 * either: the traversal arrives in a form field rather than in the URL.
 *
 * `isSafeMediaSegment` is the module's own definition of "safe as one path component", reused rather
 * than restated so this pair cannot drift from the serve route's rule - see its docblock in
 * `uploadPaths.ts` for why one decoded segment is not the same thing as one path component. No real
 * id contains a separator, a `.`/`..` or a NUL, so nothing legitimate is refused.
 */
const mediaSegmentIdSchema = entityIdSchema.refine(isSafeMediaSegment, {
  message: "Identifier must be a single safe path segment",
});

export const accommodationDocumentUploadSchema = z.object({
  tripDayId: mediaSegmentIdSchema,
  accommodationId: mediaSegmentIdSchema,
});

export const accommodationDocumentDeleteSchema = z.object({
  tripDayId: mediaSegmentIdSchema,
  accommodationId: mediaSegmentIdSchema,
  // Not a path segment: the delete resolves its file from the stored `documentUrl` on the row.
  documentId: entityIdSchema,
});

export const dayPlanItemDocumentUploadSchema = z.object({
  tripDayId: mediaSegmentIdSchema,
  dayPlanItemId: mediaSegmentIdSchema,
});

export const dayPlanItemDocumentDeleteSchema = z.object({
  tripDayId: mediaSegmentIdSchema,
  dayPlanItemId: mediaSegmentIdSchema,
  documentId: entityIdSchema,
});
