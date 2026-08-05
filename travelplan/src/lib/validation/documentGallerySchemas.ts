import { z } from "zod";

/**
 * Mirrors `imageGallerySchemas.ts`, minus the reorder pair: document order is insertion order and
 * Story 9.1 adds no way to change it, so there is no payload to describe.
 *
 * The uploaded file's name is not validated here. It arrives on the `File` rather than as a form
 * field, and it is sanitised by `sanitizeDocumentFileName` in `documentUploads.ts` - one helper the
 * routes and the backup importer share, rather than a rule that exists once per entry point.
 */
const entityIdSchema = z.string().trim().min(1);

export const accommodationDocumentUploadSchema = z.object({
  tripDayId: entityIdSchema,
  accommodationId: entityIdSchema,
});

export const accommodationDocumentDeleteSchema = z.object({
  tripDayId: entityIdSchema,
  accommodationId: entityIdSchema,
  documentId: entityIdSchema,
});

export const dayPlanItemDocumentUploadSchema = z.object({
  tripDayId: entityIdSchema,
  dayPlanItemId: entityIdSchema,
});

export const dayPlanItemDocumentDeleteSchema = z.object({
  tripDayId: entityIdSchema,
  dayPlanItemId: entityIdSchema,
  documentId: entityIdSchema,
});
