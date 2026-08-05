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
 * **A policy number again, as of Story 2.34.** It used to be a memory ceiling: the import buffered
 * the whole archive four times over — Next's middleware body buffer, `request.formData()`'s `File`,
 * the `Buffer` handed to `readZipMembers`, and every member copied out of it — so peak resident
 * memory ran roughly 3–4× the archive and this constant was really a statement about the box's RAM.
 * None of those four copies exists now: `/api/trips/import` is out of the middleware matcher, the
 * body is streamed to a temp file, the ZIP is read through a file descriptor, and members are
 * materialised one at a time. **For a ZIP body**, peak memory is bounded by the largest single
 * member, and what bounds *that* is `MAX_MEMBER_UNCOMPRESSED_BYTES` (64 MB) in `zipReader.ts`,
 * applied to a member's compressed *and* uncompressed declared size in `openZipArchive`'s
 * central-directory loop before anything is read or inflated — one member's worth for the STORE
 * members this app exports, two for a DEFLATE member re-zipped by a desktop tool, whose compressed
 * input has to stay live while the inflate runs. Not `MAX_IMPORT_PHOTO_BYTES` — that one
 * is applied by `validatePackagePhotos`, which sees a member's bytes only after `PhotoSource.read`
 * has already allocated them, so it never bounded an allocation at all. A single 378 KB DEFLATE
 * member declaring 398 MB produced 771 MB of peak RSS on 2026-08-03; the per-member cap is what
 * closed that, and capping the compressed side too is what stopped a member from declaring a
 * kilobyte while carrying 300 MB of payload `readMember` had to read before inflating it.
 *
 * The qualifier is load-bearing: a body that is *not* a ZIP takes the v1 branch, which materialises
 * it whole and again as a string. That is inherent to `JSON.parse` and is recorded as DW-142. Both
 * non-ZIP paths are at least bounded by this constant now — the `application/json` branch counts the
 * bytes it reads rather than trusting `content-length`, because taking the route out of the
 * middleware matcher removed the only ceiling that branch had.
 *
 * **Kept at 300 MB anyway, for three reasons that are not RAM.** Raising it is a bigger change than
 * it looks:
 *
 *   1. *Temp-file disk.* Each concurrent import occupies its own upload's worth of `/tmp` for the
 *      duration of the request, and that space is shared with everything else on the box.
 *   2. *Request duration.* An import is a single interactive Prisma transaction bounded at 120s
 *      (`tripRepo.ts`), plus a post-commit disk phase. A backup large enough to overrun that fails
 *      after doing all of the work, which is the worst outcome available.
 *   3. *The other limit moves with it, and it is not in this repo.* nginx's
 *      `client_max_body_size` lives on the server, so a raise here that is not mirrored there turns
 *      into a 413 from the proxy that this app never sees and cannot explain.
 *
 * What it does *not* protect against any more is the process being killed. The 2026-08-02 note that
 * "at ~600 MB the peak would exceed the box regardless of this constant" is obsolete — the peak no
 * longer tracks the archive at all. Should a real backup ever exceed 300 MB, the change is a
 * coordinated bump of the two numbers below, not a re-architecture.
 *
 * **Two limits must agree on this route, not three.** Next's `proxyClientMaxBodySize` used to be one
 * of them, but it is a ceiling on bodies the *middleware* buffers and `/api/trips/import` is no
 * longer in the matcher, so it does not apply to an import at all — it was lowered to 20 MB on
 * 2026-08-03 for the four image upload routes it does still cover. What is left:
 *   - this constant                                  300 MB  (what the handler accepts)
 *   - the reverse proxy's `client_max_body_size`     320m    (nginx defaults to 1 MB)
 *
 * The 20 MB gap is still the multipart framing, and the outer number still has to be the larger one:
 * whatever this app refuses, it must refuse with its own `file_too_large` message rather than have
 * the proxy refuse it first with a bare 413. A raise here is still a coordinated change with nginx,
 * which is not in this repo.
 */
export const MAX_IMPORT_PACKAGE_BYTES = 300 * 1024 * 1024;

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
 * Ceiling on one restored document (Story 9.1): **10 MB, matching the two document upload routes'
 * own `MAX_FILE_SIZE_BYTES` exactly** rather than the highest of a family.
 *
 * The photo ceiling above is a maximum over four routes because those four disagree (5/5/5/15 MB)
 * and import has to clear the most generous of them, or a photo the app itself accepted makes its
 * own backup unrestorable. Documents have no such spread: `accommodations/documents` and
 * `day-plan-items/documents` are the only writers of these rows and both allow 10 MB, so the same
 * reasoning lands on the number itself. Raising it to 15 for symmetry with the photo pool would
 * accept a document no route can produce and none can replace once it is restored.
 *
 * As with photos, nothing is weakened by the size alone: `sniffDocumentContentType` decides whether
 * a member is a PDF or an allow-listed image at all.
 */
export const MAX_IMPORT_DOCUMENT_BYTES = 10 * 1024 * 1024;

/**
 * Ceiling on how many files one import may write - **photos and documents together** (Story 9.1).
 *
 * The pools are deduplicated but *references* into them are not: one pooled photo named by N
 * gallery slots is written N times, so a small archive can plan an arbitrarily large amount of disk
 * I/O. The container's own 200 MB uncompressed cap does not bound that - the amplification lives in
 * the manifest, not in the bytes.
 *
 * 5000 sits above anything the export can plausibly produce (a 365-day trip carrying a day image
 * plus a dozen gallery slots every single day is ~4700) and turns an unbounded write count into a
 * bounded one.
 *
 * **One budget, not one per media kind.** Documents were added to this count rather than given a
 * cap of their own: two independent ceilings double the worst case while each still reads as
 * correct on its own, and the thing being bounded - files this process creates in one request - does
 * not care which pool a file came out of. The headroom above is wide enough that documents, capped
 * at 10 per entry, cannot meaningfully crowd photos out of it.
 */
export const MAX_IMPORT_MEDIA_WRITES = 5000;

/**
 * Ceiling on the total bytes one import may write to disk - again **photos and documents together**.
 *
 * `MAX_IMPORT_MEDIA_WRITES` bounds the *count* but not the volume: 5000 references × the 15 MB
 * per-photo ceiling is still ~75 GB from a package that cannot itself exceed `MAX_IMPORT_PACKAGE_BYTES`.
 * Only a byte cap closes that, because only it prices a reference by what the reference actually costs.
 *
 * Ten times `MAX_IMPORT_PACKAGE_BYTES`. A backup's *distinct* photo and document bytes are bounded
 * by the package, so a legitimate restore writes roughly what it carries; the only way past that is
 * real dedup, one file genuinely occupying many slots. 10x leaves that far more headroom than any
 * real trip needs while turning the worst case from "fills the disk" into a bounded 1 GB.
 *
 * Summed over both pools by `validatePackageMedia`, for the reason above: two caps of 1 GB apiece
 * are a 2 GB worst case wearing the label of a 1 GB one.
 */
export const MAX_IMPORT_MEDIA_TOTAL_BYTES = 10 * MAX_IMPORT_PACKAGE_BYTES;

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
