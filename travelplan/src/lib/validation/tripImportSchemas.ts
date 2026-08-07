import { z } from "zod";
import { MAX_DOCUMENTS_PER_ENTRY, sanitizeDocumentFileName } from "@/lib/trips/documentUploads";
import {
  MAX_IMPORT_BUCKET_LIST_ITEMS,
  MAX_IMPORT_DAYS,
  MAX_IMPORT_MEDIA_WRITES,
  MAX_IMPORT_SEGMENTS_PER_DAY,
  MAX_IMPORT_WARNING_LENGTH,
  MAX_IMPORT_WARNINGS,
  MAX_SUPPORTED_FORMAT_VERSION,
} from "@/lib/trips/importLimits";
import { isValidDateOnly } from "@/lib/validation/dateOnly";
import { isSafeExternalUrl } from "@/lib/validation/safeExternalUrl";

const ISO_UTC_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;
const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const HHMM_TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;
/** C0 plus DEL, written as escapes: the literal characters have no business in a source file. */
const CONTROL_CHARACTER_REGEX = /[\x00-\x1f\x7f]/;
const MINUTES_PER_HOUR = 60;

const normalizeTime = (raw: string): string | null => {
  const value = raw.trim();
  const match = value.match(/^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d{1,3})?)?$/);
  if (!match) return null;

  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
};

const importTimeFieldSchema = z.string().transform((value, context): string | typeof z.NEVER => {
  const normalized = normalizeTime(value);
  if (!normalized) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Time must be in HH:mm format",
    });
    return z.NEVER;
  }
  return normalized;
});

const optionalImportTimeSchema = z.union([importTimeFieldSchema, z.null()]).optional().default(null);

const parseTimeToMinutes = (value: string) => {
  const [hours, minutes] = value.split(":").map((part) => Number.parseInt(part, 10));
  return hours * MINUTES_PER_HOUR + minutes;
};

const isoUtcDate = z
  .string()
  .trim()
  .refine((value) => ISO_UTC_REGEX.test(value), "Date must be ISO 8601 UTC")
  .refine((value) => !Number.isNaN(Date.parse(value)), "Date must be valid ISO 8601 UTC");
const dateOnlySchema = z
  .string()
  .trim()
  .refine((value) => DATE_ONLY_REGEX.test(value), "Date must be YYYY-MM-DD")
  .refine((value) => isValidDateOnly(value), "Date must be a valid YYYY-MM-DD value");

const urlOrNull = z
  .union([z.string().trim().url("URL must be valid"), z.null()])
  .transform((value) => (typeof value === "string" ? value.trim() : value));

/**
 * `urlOrNull` plus the guards `travelSegmentSchemas.ts` puts on the same column.
 *
 * `z.string().url()` parses `javascript:` and `data:` happily - it only asks whether `new URL()`
 * succeeds. The mutation route never lets such a value into `TravelSegment.linkUrl`, so import is
 * the only writer that could, and a column with one trusted writer and one untrusted one is a
 * column with an untrusted writer. The 2000-character cap comes from the same schema.
 */
const externalLinkOrNull = z
  .union([
    z
      .string()
      .trim()
      .url("Link must be a valid URL")
      .refine((value) => isSafeExternalUrl(value), "Link must use http or https")
      .max(2000, "Link must be at most 2000 characters"),
    z.null(),
  ])
  .transform((value) => (typeof value === "string" ? value.trim() : value));

const dayImageUrlOrNull = z
  .union([z.string().trim(), z.null()])
  .refine(
    (value) => {
      if (value === null) return true;
      if (value.startsWith("/uploads/")) return true;
      return z.string().url("URL must be valid").safeParse(value).success;
    },
    { message: "URL must be valid" },
  )
  .transform((value) => (typeof value === "string" ? value.trim() : value));

const optionalLabelSchema = z.union([z.string().trim(), z.null()]);

const locationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  label: optionalLabelSchema,
});

/**
 * Everything below this line is v2 (Story 2.32). Every field is `.optional()` with a null/[]/{}
 * default, which is what keeps a v1 backup parsing unchanged - AC2 in one sentence.
 */

/**
 * One entry of the manifest's photo pool.
 *
 * The bytes are *not* here: `archivePath` names the archive member that carries them, so per-photo
 * byte checks (size, magic bytes) cannot live in Zod at all. They run in `validatePackagePhotos`
 * against the same request, before the transaction, and report through the same 400.
 *
 * `contentType` is any non-empty string on purpose - it is a hint, not a decision. The bytes are
 * what `sniffPhotoContentType` allow-lists, and they are also what picks the extension on disk, so
 * an enum here would only reject packages whose bytes are perfectly fine: the export falls back to
 * `application/octet-stream` for a stored URL with an unrecognised extension, and this very
 * importer can create such a row (a v1 `imageUrl` is written verbatim, so `/uploads/.../day.jfif`
 * survives a round trip and comes back out as octet-stream).
 */
const photoSchema = z.object({
  contentType: z.string().trim().min(1),
  archivePath: z.string().trim().min(1),
});

const photoIdOrNull = z.union([z.string().trim().min(1), z.null()]).optional().default(null);

/**
 * Gallery references. `sortOrder` uniqueness is checked per owner because
 * `@@unique([accommodationId, sortOrder])` / `@@unique([dayPlanItemId, sortOrder])` would otherwise
 * surface as a P2002 halfway through the import transaction - a 500 for something the payload
 * states plainly.
 */
const imagesSchema = z
  .array(
    z.object({
      sortOrder: z.number().int().min(0),
      photoId: z.string().trim().min(1),
    }),
  )
  .optional()
  .default([])
  .superRefine((images, ctx) => {
    const seen = new Set<number>();
    for (const image of images) {
      if (seen.has(image.sortOrder)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate image sortOrder detected: ${image.sortOrder}`,
        });
        return;
      }
      seen.add(image.sortOrder);
    }
  });

/**
 * One entry of the manifest's document pool (Story 9.1). Same shape as `photoSchema`, and
 * deliberately a *separate* record: the two pools are validated against different signature lists
 * and different per-file ceilings, and merging them is the one change that would let a PDF be
 * restored into a photo gallery.
 */
const documentPoolSchema = z.object({
  contentType: z.string().trim().min(1),
  archivePath: z.string().trim().min(1),
});

/**
 * The name the user gave the document, on its way to the `file_name` column and nowhere else.
 *
 * Rejecting rather than quietly repairing is the point. This value is rendered in the UI and Story
 * 9.2 will print it onto PDF pages, so a manifest that states a path where a name belongs is a
 * manifest whose author should be told, not one whose input should be silently rewritten - the
 * import route's error envelope is the only channel that reaches them.
 *
 * The last word still goes to `sanitizeDocumentFileName`, **the same function the two upload routes
 * use**, imported rather than reimplemented: two copies of a sanitiser is how one of them loses a
 * rule. The explicit refusals above it are not redundant with it - they are what turns "a separator
 * would have been stripped" into "a separator is refused" - but whatever survives them is put to the
 * shared function anyway, so a case only it knows about (a bare `.` or `..`, a name that is nothing
 * but trimmable space) cannot reach a column, and the value the repository writes is byte-for-byte
 * what an upload of the same name would have written.
 */
const documentFileNameSchema = z
  .string()
  .trim()
  .min(1, "Document fileName is required")
  .max(255, "Document fileName must be at most 255 characters")
  .transform((value, context): string | typeof z.NEVER => {
    if (value.includes("/") || value.includes("\\")) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Document fileName must not contain a path separator",
      });
      return z.NEVER;
    }
    if (CONTROL_CHARACTER_REGEX.test(value)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Document fileName must not contain control characters",
      });
      return z.NEVER;
    }
    const sanitized = sanitizeDocumentFileName(value);
    if (sanitized === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Document fileName is not a usable file name",
      });
      return z.NEVER;
    }
    return sanitized;
  });

/**
 * Document references, mirroring `imagesSchema` including its `sortOrder` uniqueness check -
 * `@@unique([accommodationId, sortOrder])` / `@@unique([dayPlanItemId, sortOrder])` exist on the
 * document tables too, so without it the new index surfaces as a P2002 halfway through the import
 * transaction: a 500 for something the payload states plainly.
 *
 * `fileName` rides on the reference rather than on the pool entry, because it belongs to the *row*
 * and not to the bytes: one pooled document referenced by two entries is one file with two names,
 * and the pool has no field that could hold both.
 *
 * **The per-entry cap is enforced here as well as in the repository create** - the `.max()` below -
 * which `imagesSchema` needs no equivalent of because photos have no cap at all. It has to be restated
 * on this path because the import does not go through `createAccommodationDocument` /
 * `createDayPlanItemDocument`: it writes rows inside the import transaction, so the cap those two
 * enforce is not a cap here. Without the `.max()` a hand-edited manifest listing 500 references at
 * distinct `sortOrder`s *would* land 500 rows on one stay, and nothing in the UI could recover from
 * it - the field's Upload button is disabled at 10 rows and the route answers the cap message for
 * every further upload, so the entry would be permanently full. The only other ceiling on this path is
 * `MAX_IMPORT_MEDIA_WRITES`, a whole-package budget of 5000, which 500 rows on one stay never reaches.
 *
 * One consequence of restating it here, because it is not obvious from either side: `MAX_DOCUMENTS_PER_ENTRY`
 * is now a **backup-compatibility constraint** and not only a policy knob. Lowering it would refuse
 * every backup already written from an entry carrying more than the new value, including backups this
 * build produced. Raising it is safe; lowering it needs a migration story for existing archives.
 */
const documentsSchema = z
  .array(
    z.object({
      sortOrder: z.number().int().min(0),
      documentId: z.string().trim().min(1),
      fileName: documentFileNameSchema,
    }),
  )
  .max(MAX_DOCUMENTS_PER_ENTRY, `At most ${MAX_DOCUMENTS_PER_ENTRY} documents per entry`)
  .optional()
  .default([])
  .superRefine((documents, ctx) => {
    const seen = new Set<number>();
    for (const document of documents) {
      if (seen.has(document.sortOrder)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate document sortOrder detected: ${document.sortOrder}`,
        });
        return;
      }
      seen.add(document.sortOrder);
    }
  });

/**
 * Travel segments carry the **API-level lowercase** vocabulary (see `TravelSegmentDetail`), not
 * Prisma's enum spellings; the repository maps them up.
 *
 * `fromItemId` / `toItemId` are the *source* record ids and are resolved against the package's own
 * records in the root `superRefine`. Story 2.35 split what used to be one verdict in two: an endpoint
 * naming a record the importer cannot wire *on this day* is still a validation error, while one
 * naming no record anywhere in the package is an orphan the importer drops and counts. See the
 * `checkEndpoint` block below for which is which and why.
 */
const travelSegmentImportSchema = z
  .object({
    id: z.string().trim().min(1),
    fromItemType: z.enum(["accommodation", "dayPlanItem"]),
    fromItemId: z.string().trim().min(1),
    toItemType: z.enum(["accommodation", "dayPlanItem"]),
    toItemId: z.string().trim().min(1),
    // Story 6.16 widened this. It is an *accept-more* change, so every backup written before that
    // story still parses; only the reverse (a v2 backup carrying "walking"/"cycling" opened by a
    // pre-6.16 build) is unsupported, which the story accepts.
    transportType: z.enum(["car", "ship", "flight", "walking", "cycling"]),
    durationMinutes: z.number().int().positive(),
    // `positive`, not `nonnegative`: `travelSegmentMutationSchema` rejects `0`, so a zero-distance
    // row imported here could never be saved again from the dialog that owns it.
    distanceKm: z.union([z.number().positive(), z.null()]).optional().default(null),
    linkUrl: externalLinkOrNull.optional().default(null),
    // Accepted but unused: Prisma owns `created_at` / `updated_at` on insert, exactly as v1 import
    // already did for every other record.
    createdAt: isoUtcDate.optional(),
    updatedAt: isoUtcDate.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.fromItemType === value.toItemType && value.fromItemId === value.toItemId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["toItemId"],
        message: "Travel segment must connect two different items",
      });
    }

    // Deliberately **not** enforced: `travelSegmentSchemas.ts` couples `transportType` to
    // `distanceKm` (car requires a distance, non-car forbids one). The export emits whatever is in
    // the database, so enforcing the coupling here would make legitimate backups unrestorable over
    // a rule that was added after those rows were written. See Completion Note 4 in the story.
  });

/**
 * Lengths match `bucketListSchemas.ts` exactly (120 / 1000 / 200), measured after trimming just as
 * the live schema measures them.
 *
 * Import is the only writer that could exceed them, and an over-length item is worse than a
 * rejected one: it renders fine and then fails every save from the panel that owns it, with no hint
 * that the length is what the API objects to.
 */
const bucketListItemImportSchema = z.object({
  id: z.string().trim().min(1).optional(),
  title: z
    .string()
    .trim()
    .min(1, "Bucket list title is required")
    .max(120, "Bucket list title must be at most 120 characters"),
  description: z
    .union([z.string().trim().max(1000, "Bucket list description must be at most 1000 characters"), z.null()])
    .optional()
    .default(null),
  positionText: z
    .union([z.string().trim().max(200, "Bucket list position text must be at most 200 characters"), z.null()])
    .optional()
    .default(null),
  location: z.union([locationSchema, z.null()]).optional().default(null),
  createdAt: isoUtcDate.optional(),
  updatedAt: isoUtcDate.optional(),
});

const accommodationImportSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1, "Accommodation name is required"),
  notes: z.union([z.string(), z.null()]),
  status: z.enum(["planned", "booked"]),
  costCents: z.union([z.number().int().nonnegative(), z.null()]),
  payments: z
    .array(
      z.object({
        amountCents: z.number().int().nonnegative(),
        dueDate: dateOnlySchema,
      }),
    )
    .optional(),
  link: urlOrNull,
  checkInTime: optionalImportTimeSchema,
  checkOutTime: optionalImportTimeSchema,
  location: z.union([locationSchema, z.null()]),
  createdAt: isoUtcDate,
  updatedAt: isoUtcDate,
  images: imagesSchema,
  documents: documentsSchema,
}).superRefine((value, ctx) => {
  const payments = value.payments ?? [];
  if (payments.length === 0) return;
  if (value.costCents === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["payments"],
      message: "Payments require a costCents value",
    });
    return;
  }
  const total = payments.reduce((sum, payment) => sum + payment.amountCents, 0);
  if (total !== value.costCents) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["payments"],
      message: "Payments must sum to costCents",
    });
  }
});

const dayPlanItemImportSchema = z
  .object({
    id: z.string().trim().min(1),
    title: z.union([z.string().trim().min(1).max(120), z.null()]).optional().default(null),
    fromTime: z.union([z.string().trim().regex(HHMM_TIME_REGEX), z.null()]).optional().default(null),
    toTime: z.union([z.string().trim().regex(HHMM_TIME_REGEX), z.null()]).optional().default(null),
    contentJson: z.string().trim().min(1, "contentJson is required"),
    costCents: z.union([z.number().int().nonnegative(), z.null()]).optional().default(null),
    payments: z
      .array(
        z.object({
          amountCents: z.number().int().nonnegative(),
          dueDate: dateOnlySchema,
        }),
      )
      .optional(),
    linkUrl: urlOrNull,
    location: z.union([locationSchema, z.null()]),
    createdAt: isoUtcDate,
    updatedAt: isoUtcDate,
    images: imagesSchema,
    documents: documentsSchema,
  })
  .superRefine((value, ctx) => {
    const hasFromTime = typeof value.fromTime === "string";
    const hasToTime = typeof value.toTime === "string";

    if (hasFromTime !== hasToTime) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["fromTime"],
        message: "fromTime and toTime must both be set or both be null",
      });
      return;
    }

    if (value.fromTime !== null && value.toTime !== null) {
      const fromTime = value.fromTime;
      const toTime = value.toTime;
      if (parseTimeToMinutes(toTime) <= parseTimeToMinutes(fromTime)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["toTime"],
          message: "toTime must be later than fromTime",
        });
      }
    }

    const payments = value.payments ?? [];
    if (payments.length === 0) return;
    if (value.costCents === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["payments"],
        message: "Payments require a costCents value",
      });
      return;
    }
    const total = payments.reduce((sum, payment) => sum + payment.amountCents, 0);
    if (total !== value.costCents) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["payments"],
        message: "Payments must sum to costCents",
      });
    }
  });

const tripDayImportSchema = z.object({
  id: z.string().trim().min(1),
  date: isoUtcDate,
  dayIndex: z.number().int().min(1),
  imageUrl: dayImageUrlOrNull.optional().default(null),
  imagePhotoId: photoIdOrNull,
  note: z.union([z.string().trim().max(280), z.null()]).optional().default(null),
  createdAt: isoUtcDate,
  updatedAt: isoUtcDate,
  accommodation: z.union([accommodationImportSchema, z.null()]),
  dayPlanItems: z.array(dayPlanItemImportSchema),
  travelSegments: z
    .array(travelSegmentImportSchema)
    .max(MAX_IMPORT_SEGMENTS_PER_DAY, `A day may carry at most ${MAX_IMPORT_SEGMENTS_PER_DAY} travel segments`)
    .optional()
    .default([]),
});

const tripImportSchema = z
  .object({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1, "Trip name is required"),
    startDate: isoUtcDate,
    endDate: isoUtcDate,
    heroImageUrl: z.union([z.string().trim(), z.null()]),
    heroPhotoId: photoIdOrNull,
    startLocation: z.union([locationSchema, z.null()]).optional(),
    destinationLocation: z.union([locationSchema, z.null()]).optional(),
    createdAt: isoUtcDate,
    updatedAt: isoUtcDate,
    // Trip-scoped, so it lives inside `trip` and mirrors where the export puts it.
    bucketListItems: z
      .array(bucketListItemImportSchema)
      .max(MAX_IMPORT_BUCKET_LIST_ITEMS, `A trip may carry at most ${MAX_IMPORT_BUCKET_LIST_ITEMS} bucket list items`)
      .optional()
      .default([]),
  })
  .refine((data) => new Date(data.startDate).getTime() <= new Date(data.endDate).getTime(), {
    message: "Start date must be before or equal to end date",
    path: ["endDate"],
  });

export const tripImportPayloadSchema = z.object({
  meta: z.object({
    exportedAt: isoUtcDate,
    appVersion: z.string().trim().min(1),
    // Bounded above, not merely positive. Reading a format this app does not know is not a harmless
    // no-op: Zod strips the fields it has no rule for, so a future v3 backup would import, report
    // success, and silently drop whatever v3 added - the one failure mode a backup tool must never
    // have. Refusing to read it is the honest answer.
    formatVersion: z
      .number()
      .int()
      .positive()
      .max(MAX_SUPPORTED_FORMAT_VERSION, "Backup was written by a newer version of this app"),
    // Present in every v2 manifest (`[]` when clean), absent in v1. Read for reporting only - a
    // warning records what the *export* skipped and is never a reason to fail an import.
    //
    // Bounded because it is echoed back verbatim in the success envelope and rendered by the
    // dialog: unbounded, a hand-built manifest turns a 200 into an arbitrarily large response.
    warnings: z
      .array(z.string().max(MAX_IMPORT_WARNING_LENGTH))
      .max(MAX_IMPORT_WARNINGS)
      .optional()
      .default([]),
  }),
  photos: z.record(z.string().min(1), photoSchema).optional().default({}),
  // Additive within v2 (Story 9.1): `{}` when absent, which is every v1 backup and every v2 package
  // written before this story. That default is the whole of "imports exactly as today".
  documents: z.record(z.string().min(1), documentPoolSchema).optional().default({}),
  trip: tripImportSchema,
  days: z
    .array(tripDayImportSchema)
    .min(1, "At least one day is required")
    .max(MAX_IMPORT_DAYS, `A backup may cover at most ${MAX_IMPORT_DAYS} days`),
}).superRefine((input, ctx) => {
  const start = new Date(input.trip.startDate);
  const end = new Date(input.trip.endDate);
  const expectedDays = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
  if (input.days.length !== expectedDays) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Trip days are incomplete for the selected trip date range",
      path: ["days"],
    });
  }

  const seenDayIndexes = new Set<number>();
  for (const day of input.days) {
    if (seenDayIndexes.has(day.dayIndex)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate dayIndex detected: ${day.dayIndex}`,
        path: ["days"],
      });
      break;
    }
    seenDayIndexes.add(day.dayIndex);
  }

  // --- v2 cross-reference checks -------------------------------------------------------------
  // All of these are AC3 validation errors on purpose. Each one describes a package that would
  // otherwise fail *inside* the transaction - as a null dereference, a P2002, or a travel segment
  // silently wired to nothing - which is a 500 for a problem the payload states in plain sight.

  /**
   * One planned file per *reference*, which is exactly what the repository goes on to write: a pool
   * is deduplicated, the references into it are not. Counting here rather than in
   * `validatePackageMedia` is what puts the cap before the transaction - that function only sees the
   * pools and the archive members, neither of which says how many times a file is used.
   *
   * **Photos and documents share the counter** (Story 9.1), because they share the budget: what is
   * bounded is files this request creates on disk, and that number does not care which pool a file
   * came out of. Two counters would double the worst case while each still read as correct.
   */
  let plannedMediaWrites = 0;

  const requirePooledPhoto = (photoId: string | null, path: (string | number)[]) => {
    if (photoId === null) return;
    plannedMediaWrites += 1;
    if (!Object.prototype.hasOwnProperty.call(input.photos, photoId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Unknown photo reference: ${photoId}`,
        path,
      });
    }
  };

  const requirePooledDocument = (documentId: string, path: (string | number)[]) => {
    plannedMediaWrites += 1;
    if (!Object.prototype.hasOwnProperty.call(input.documents, documentId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Unknown document reference: ${documentId}`,
        path,
      });
    }
  };

  requirePooledPhoto(input.trip.heroPhotoId, ["trip", "heroPhotoId"]);

  /**
   * The package's records, indexed by the order the *importer* walks its days.
   *
   * `sortImportDays` in `tripRepo.ts` sorts by `dayIndex`, then `date`, and `accommodationIdBySourceId`
   * is declared outside that loop and filled as each day is created - so an accommodation endpoint can
   * be resolved exactly when its day has already been processed, whatever position it holds in this
   * array. That comparator is mirrored here rather than trusting `input.days`' order, because the two
   * are independent: a package whose days are written out of order would otherwise have its perfectly
   * ordinary previous-night segments read as forward references, which is the same false positive
   * Story 2.35 exists to remove, one layer down.
   *
   * The *first* position wins for an id declared twice. Nothing forbids two days from naming the same
   * source id (the duplicate check above is per-day), and the importer's map holds whichever of them
   * was written most recently - so "declared at or before this day" is the honest question, and the
   * earliest declaration is what answers it.
   */
  const importOrderedDays = input.days
    .map((day, arrayIndex) => ({ day, arrayIndex }))
    .sort((left, right) =>
      left.day.dayIndex !== right.day.dayIndex
        ? left.day.dayIndex - right.day.dayIndex
        : new Date(left.day.date).getTime() - new Date(right.day.date).getTime(),
    );

  /**
   * An array rather than a `Map`, so that "every day has a position" is true by construction:
   * `importOrderedDays` is a permutation of `input.days`, so every index in range is assigned and the
   * lookup below needs no fallback. A `Map` would have wanted one, and the only safe default is `0` -
   * which reads every accommodation not on the first day as a forward reference and refuses a
   * restorable archive. Fail-closed on a bookkeeping bug is precisely this story's bug.
   */
  const importPositionByArrayIndex: number[] = [];
  const accommodationImportPosition = new Map<string, number>();
  /** Every source record id in the package, of either kind - what tells an orphan from a misfiled reference. */
  const knownRecordIds = new Set<string>();
  importOrderedDays.forEach(({ day, arrayIndex }, position) => {
    importPositionByArrayIndex[arrayIndex] = position;
    if (day.accommodation) {
      knownRecordIds.add(day.accommodation.id);
      if (!accommodationImportPosition.has(day.accommodation.id)) {
        accommodationImportPosition.set(day.accommodation.id, position);
      }
    }
    for (const item of day.dayPlanItems) {
      knownRecordIds.add(item.id);
    }
  });

  input.days.forEach((day, dayIndex) => {
    requirePooledPhoto(day.imagePhotoId, ["days", dayIndex, "imagePhotoId"]);

    day.accommodation?.images.forEach((image, imageIndex) => {
      requirePooledPhoto(image.photoId, ["days", dayIndex, "accommodation", "images", imageIndex, "photoId"]);
    });
    day.accommodation?.documents.forEach((document, documentIndex) => {
      requirePooledDocument(document.documentId, [
        "days",
        dayIndex,
        "accommodation",
        "documents",
        documentIndex,
        "documentId",
      ]);
    });
    day.dayPlanItems.forEach((item, itemIndex) => {
      item.images.forEach((image, imageIndex) => {
        requirePooledPhoto(image.photoId, [
          "days",
          dayIndex,
          "dayPlanItems",
          itemIndex,
          "images",
          imageIndex,
          "photoId",
        ]);
      });
      item.documents.forEach((document, documentIndex) => {
        requirePooledDocument(document.documentId, [
          "days",
          dayIndex,
          "dayPlanItems",
          itemIndex,
          "documents",
          documentIndex,
          "documentId",
        ]);
      });
    });

    // Source record ids are the keys travel segments are remapped through, and the map is built as
    // the records are created. Two records on one day sharing an id therefore do not merely
    // duplicate data: the second overwrites the first in that map, and every segment naming the id
    // wires itself to whichever row happened to be written last. Checked on every day, segments or
    // not - a payload that cannot name its own records unambiguously is not restorable.
    const seenRecordIds = new Set<string>();
    if (day.accommodation) {
      seenRecordIds.add(day.accommodation.id);
    }
    day.dayPlanItems.forEach((item, itemIndex) => {
      if (seenRecordIds.has(item.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate record id within a day: ${item.id}`,
          path: ["days", dayIndex, "dayPlanItems", itemIndex, "id"],
        });
      }
      seenRecordIds.add(item.id);
    });

    if (day.travelSegments.length === 0) return;

    /**
     * Can this day's segments be wired to the record an endpoint names? Three answers, not two.
     *
     * `TravelSegment.tripDayId` scopes the row, and this check used to read that as "both endpoints
     * must be records of *this* day". For plan items that is still exactly right. For accommodations
     * it was wrong, and it made every multi-day trip planned with the app unrestorable: `previousStay`
     * (`TripDayView.tsx`) deliberately offers **last night's** accommodation as the start of today's
     * first leg, and stores that segment on *today's* day. Story 2.35 is that false positive - 27 of
     * the 36 rejections on Tommy's production archive, across 17 of its 41 days.
     *
     * **Accommodations widen to "this day or any earlier one", not to "exactly one day back".** The
     * feature is one day back, but the rule is not, for two reasons. The importer's map is trip-wide
     * and filled in day order, so *any* earlier day already resolves - a tighter rule would be
     * validation refusing packages the importer restores perfectly, which is the bug being fixed
     * rather than a stricter version of it. And "one day back" is not stable over a trip's life:
     * `previousDay` is a position in the ordered day list at the moment the segment was written, and
     * the row outlives shifting a trip's date range or deleting a day between the two.
     *
     * **Never a later day.** The map is trip-wide but order-dependent: a forward reference is not in
     * it yet when this day's segments are written, so it cannot be resolved at all. That is a
     * validation error rather than a skip, because the package *does* contain the record - it is a
     * misfiled reference the payload states plainly, not the missing one AC2 drops.
     *
     * **What "any earlier one" costs, stated rather than discovered.** The live app only ever *writes*
     * a distance-1 reference: `buildSegmentTimeline` (`travelSegmentRepo.ts`) offers the immediately
     * preceding day's accommodation and nothing further back, and `TripDayView` draws only endpoint
     * pairs that timeline contains. So a restored distance-2-or-more reference is a row the timeline
     * will not draw, `ensureSegmentItemsExist` answers `missing` for, and `totalTravelMinutes` counts
     * anyway - the invisible-but-counted shape Story 6.23 set out to stop creating. Accepted knowingly:
     * such a row can only be *in* a package because the source database already held it (delete a day
     * between the two and a distance-1 reference becomes distance-2 in place, with no import involved),
     * and a restore that silently dropped it would make the backup differ from what was backed up. The
     * skip path is for endpoints naming nothing; it is not a repair pass for rows the app mislays. The
     * pre-existing pathology those rows land in is recorded in `deferred-work.md`.
     *
     * **An id that names nothing in the package at all is an orphan, and no longer an error.** Those
     * are rows left behind by activities deleted before Story 6.23 fixed the cause, so every database
     * older than 2026-08-03 holds some. The importer drops the segment and reports the count through
     * `meta.warnings`; refusing the whole archive over one dead row is what made a backup a
     * reassurance rather than a backup.
     */
    const dayImportPosition = importPositionByArrayIndex[dayIndex];
    const planItemIds = new Set(day.dayPlanItems.map((item) => item.id));

    type EndpointCheck =
      | { verdict: "resolves" }
      /** Names no record anywhere in the package: the importer skips the segment and counts it. */
      | { verdict: "orphan" }
      | { verdict: "invalid"; message: string };

    const checkEndpoint = (
      itemType: "accommodation" | "dayPlanItem",
      itemId: string,
      field: "fromItemId" | "toItemId",
    ): EndpointCheck => {
      const misfiled = (message: string): EndpointCheck => ({ verdict: "invalid", message });
      const notOnThisDay = `Travel segment ${field} does not match any record on this day: ${itemId}`;

      if (itemType === "accommodation") {
        const declaredAt = accommodationImportPosition.get(itemId);
        // Known as *something*, just not as an accommodation - a wrong `itemType`, which the importer
        // would look up in the wrong map and never resolve.
        if (declaredAt === undefined) {
          return knownRecordIds.has(itemId) ? misfiled(notOnThisDay) : { verdict: "orphan" };
        }
        if (declaredAt > dayImportPosition) {
          return misfiled(`Travel segment ${field} names an accommodation from a later day: ${itemId}`);
        }
        return { verdict: "resolves" };
      }

      if (planItemIds.has(itemId)) return { verdict: "resolves" };
      return knownRecordIds.has(itemId) ? misfiled(notOnThisDay) : { verdict: "orphan" };
    };

    const seenPairs = new Set<string>();
    day.travelSegments.forEach((segment, segmentIndex) => {
      const from = checkEndpoint(segment.fromItemType, segment.fromItemId, "fromItemId");
      if (from.verdict === "invalid") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: from.message,
          path: ["days", dayIndex, "travelSegments", segmentIndex, "fromItemId"],
        });
      }
      const to = checkEndpoint(segment.toItemType, segment.toItemId, "toItemId");
      if (to.verdict === "invalid") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: to.message,
          path: ["days", dayIndex, "travelSegments", segmentIndex, "toItemId"],
        });
      }

      // Mirrors `idx_travel_segments_pair`.
      const pair = `${segment.fromItemType}:${segment.fromItemId}->${segment.toItemType}:${segment.toItemId}`;
      if (seenPairs.has(pair)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Duplicate travel segment endpoints detected within a day",
          path: ["days", dayIndex, "travelSegments", segmentIndex],
        });
      }
      seenPairs.add(pair);
    });
  });

  if (plannedMediaWrites > MAX_IMPORT_MEDIA_WRITES) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Backup plans ${plannedMediaWrites} media files, more than the ${MAX_IMPORT_MEDIA_WRITES} one import may write`,
      // The package, not a pool. `plannedMediaWrites` counts photo *and* document references against
      // one shared budget (Story 9.1), so a manifest that overflows it on documents alone would be
      // reported against `photos` — pointing the reader at a pool that can be empty.
      path: [],
    });
  }
});

export const tripImportConflictStrategySchema = z.enum(["overwrite", "createNew"]);

export const tripImportRequestSchema = z
  .object({
    payload: tripImportPayloadSchema,
    strategy: tripImportConflictStrategySchema.optional(),
    targetTripId: z.string().trim().min(1).optional(),
  })
  .superRefine((input, ctx) => {
    if (input.strategy === "overwrite" && !input.targetTripId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "targetTripId is required for overwrite strategy",
        path: ["targetTripId"],
      });
    }

    if (input.strategy !== "overwrite" && input.targetTripId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "targetTripId is only allowed for overwrite strategy",
        path: ["targetTripId"],
      });
    }
  });

export type TripImportPayloadInput = z.infer<typeof tripImportPayloadSchema>;
export type TripImportConflictStrategy = z.infer<typeof tripImportConflictStrategySchema>;
export type TripImportRequestInput = z.infer<typeof tripImportRequestSchema>;

/**
 * How many files each pool id will produce, keyed by photo id.
 *
 * The same walk the root `superRefine` does to count planned writes, exposed so the byte-volume cap
 * in `validatePackagePhotos` can price each reference by the size of the member behind it. Kept
 * here rather than duplicated there because this module already owns the shape of a payload; a
 * second walk somewhere else is a second thing to update when the shape gains a photo field.
 */
export const countPhotoReferences = (payload: TripImportPayloadInput): Map<string, number> => {
  const counts = new Map<string, number>();

  const record = (photoId: string | null) => {
    if (photoId === null) return;
    counts.set(photoId, (counts.get(photoId) ?? 0) + 1);
  };

  record(payload.trip.heroPhotoId);
  for (const day of payload.days) {
    record(day.imagePhotoId);
    day.accommodation?.images.forEach((image) => record(image.photoId));
    for (const item of day.dayPlanItems) {
      item.images.forEach((image) => record(image.photoId));
    }
  }

  return counts;
};

/**
 * The same walk for the document pool (Story 9.1), and its own function rather than a second return
 * value from the one above.
 *
 * The two pools are priced separately because they are sized separately - a document is measured
 * against `MAX_IMPORT_DOCUMENT_BYTES` and a photo against `MAX_IMPORT_PHOTO_BYTES` - and only the
 * *total* is shared. One map keyed by id across both pools would collide the moment an id spelling
 * appeared in each.
 *
 * There is no document twin of `heroPhotoId` or `imagePhotoId`: a document only ever hangs off a
 * stay or an activity, which is why this walk is two lines shorter than its sibling.
 */
export const countDocumentReferences = (payload: TripImportPayloadInput): Map<string, number> => {
  const counts = new Map<string, number>();

  const record = (documentId: string) => {
    counts.set(documentId, (counts.get(documentId) ?? 0) + 1);
  };

  for (const day of payload.days) {
    day.accommodation?.documents.forEach((document) => record(document.documentId));
    for (const item of day.dayPlanItems) {
      item.documents.forEach((document) => record(document.documentId));
    }
  }

  return counts;
};
