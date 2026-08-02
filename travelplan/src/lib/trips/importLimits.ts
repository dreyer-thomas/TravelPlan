/**
 * Numeric ceilings shared by the import route, the package reader, the import schema and the
 * import dialog.
 *
 * Their own dependency-free module because the client half needs them too: `TripImportDialog` can
 * import neither the route (that would drag Prisma and `node:fs` into the browser bundle) nor
 * `importPackage.ts` (which reaches `node:zlib` through the ZIP reader). Duplicating the literal is
 * how the dialog came to promise "100 MB" in two languages while the server enforced its own copy.
 */

/**
 * Ceiling on an uploaded backup.
 *
 * The App Router has no `bodyParser.sizeLimit` equivalent, so nothing caps a request body unless
 * the handler does.
 *
 * Deployment note: the reverse proxy in front of this app caps request bodies at 1 MB by default.
 * A photo-bearing import will 413 before it reaches Node unless `client_max_body_size` is raised.
 */
export const MAX_IMPORT_PACKAGE_BYTES = 100 * 1024 * 1024;

/**
 * Ceiling on one restored photo: the **maximum** of the four upload routes' own
 * `MAX_FILE_SIZE_BYTES`, not the minimum.
 *
 * `trips/[id]/days/[dayId]/image` allows 15 MB; `trips/[id]/hero-image`,
 * `trips/[id]/accommodations/images` and `trips/[id]/day-plan-items/images` allow 5 MB. Import has
 * to clear the highest of them, because a photo any route accepted can end up in an export - an
 * 8 MB day image would otherwise upload fine and then make its own backup unrestorable. Nothing is
 * weakened by the generosity: the byte sniff, not the size, is what decides whether a member is an
 * image at all.
 */
export const MAX_IMPORT_PHOTO_BYTES = 15 * 1024 * 1024;

/**
 * Ceiling on how many files one import may write.
 *
 * The photo pool is deduplicated but *references* into it are not: one pooled photo named by N
 * gallery slots is written N times, so a small archive can plan an arbitrarily large amount of disk
 * I/O. The container's own 200 MB uncompressed cap does not bound that - the amplification lives in
 * the manifest, not in the bytes.
 *
 * 5000 sits above anything the export can plausibly produce (a 365-day trip carrying a day image
 * plus a dozen gallery slots every single day is ~4700) and turns an unbounded write count into a
 * bounded one.
 */
export const MAX_IMPORT_PHOTO_WRITES = 5000;

/**
 * Ceiling on the total bytes one import may write to disk.
 *
 * `MAX_IMPORT_PHOTO_WRITES` bounds the *count* but not the volume: 5000 references × the 15 MB
 * per-photo ceiling is still ~75 GB from a package that cannot itself exceed 100 MB. Only a byte
 * cap closes that, because only it prices a reference by what the reference actually costs.
 *
 * Ten times `MAX_IMPORT_PACKAGE_BYTES`. A backup's *distinct* photo bytes are bounded by the
 * package, so a legitimate restore writes roughly what it carries; the only way past that is real
 * dedup, one photo genuinely occupying many gallery slots. 10x leaves that far more headroom than
 * any real trip needs while turning the worst case from "fills the disk" into a bounded 1 GB.
 */
export const MAX_IMPORT_PHOTO_TOTAL_BYTES = 10 * MAX_IMPORT_PACKAGE_BYTES;

/**
 * The newest package format this app can read.
 *
 * Bounding it is what stops a future format importing "successfully" while Zod quietly strips every
 * field it has no rule for.
 */
export const MAX_SUPPORTED_FORMAT_VERSION = 2;

/**
 * Row-count ceilings on a manifest.
 *
 * The photo caps bound the *disk* an import can consume; nothing bounded the *rows*. A manifest is
 * JSON, so 100 MB of it can declare an enormous trip - and the day count is pinned to the declared
 * date range, which means a 300-year range is a schema-legal way to ask for ~110,000 day rows. All
 * of it lands in one interactive transaction. These are deliberately far above anything a real
 * backup contains: a 20-year trip, 200 travel segments in a single day and a 5000-entry bucket
 * list are all already absurd, so the caps only ever fire on manifests that were not exported.
 */
export const MAX_IMPORT_DAYS = 7300;
export const MAX_IMPORT_SEGMENTS_PER_DAY = 200;
export const MAX_IMPORT_BUCKET_LIST_ITEMS = 5000;

/** Bounds on `meta.warnings`, which is echoed back to the client verbatim. */
export const MAX_IMPORT_WARNINGS = 500;
export const MAX_IMPORT_WARNING_LENGTH = 1000;
