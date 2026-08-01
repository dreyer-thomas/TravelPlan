---
baseline_commit: 1ac8c5f
---

# Story 2.31: Complete Trip Backup Export With Photos, Travel Segments, and Bucket List

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner,
I want to export a complete backup of my trip that includes travel segments, bucket list items, and the uploaded photos themselves,
so that I have a fully self-contained backup that does not depend on the original server's file storage.

## Acceptance Criteria

1. **The export is a ZIP archive.** `GET /api/trips/[id]/export` returns `application/zip` with `Content-Disposition: attachment; filename="trip-<slug>-<YYYY-MM-DD>.zip"`. The archive contains a manifest at `trip.json` plus zero or more photo files under `photos/`. It opens in Finder, Windows Explorer, and `unzip` without warnings.
2. **The manifest is a superset of the v1 payload.** `trip.json` keeps every field the current JSON export emits (`meta`, `trip`, `days[]` with `accommodation` and `dayPlanItems[]` including `payments[]`), at the same paths and with the same names, and adds `meta.warnings`, the top-level `photos` pool, `trip.heroPhotoId`, `trip.bucketListItems[]`, `days[].imagePhotoId`, `images[]` on each accommodation and day-plan item, and per-day `travelSegments[]`. `meta.formatVersion` becomes `2`. Field names match Story 2.32's `## Package Format Contract v2` exactly.
3. **Photo bytes travel with the manifest.** Every `/uploads/`-hosted image the trip owns — trip hero image, per-day image, accommodation gallery images, day-plan-item gallery images — is written into the archive as a real file and registered in the `photos` pool, and the owning record references it by pool id. A record with no photo, and a trip with no photos at all, exports successfully with an empty pool, no `photos/` members, and no error.
4. **Pool and archive agree exactly.** For every `photos` entry there is exactly one archive member at its `archivePath`, no archive member under `photos/` is unregistered, and every `heroPhotoId` / `imagePhotoId` / `images[].photoId` in the manifest resolves to a `photos` key. An image row whose file is missing on disk is omitted from the pool, its reference is `null` (or its `images[]` entry dropped), and a line is appended to `meta.warnings` — it never fails the export and never leaves a dangling reference.
5. **Only files the trip owns are readable.** A stored `imageUrl` is archived only if its resolved absolute path lies inside `getTripUploadDir(tripId)`. Anything else — a traversal sequence, an absolute path, another trip's directory, an external `http(s)` URL — gets no pool entry and a `null` reference, keeps its URL in the surviving v1 field, and is never read from disk.
6. **Non-owners are blocked.** Ownership, auth, and not-found behavior are unchanged from today: `401` without a session, `403` for `mustChangePassword`, `404` for a trip the caller does not own — including for viewers and contributors, who own no trips.
7. **The export stays deterministic.** Two exports of an unchanged trip produce byte-identical archives. `meta.exportedAt` remains `trip.updatedAt`, entry order is fixed, and every ZIP timestamp is derived from `trip.updatedAt` rather than the clock.
8. **No new UI, no new dependency, no schema change.** This story adds no button, no i18n key, and no npm package. It is read-only against the database and adds no migration.

## Tasks / Subtasks

- [ ] **Task 1 — Write the ZIP writer** (AC: 1, 7)
  - [ ] New file `src/lib/trips/zipArchive.ts`. Export `createZipStream(entries: ZipEntry[], modifiedAt: Date): ReadableStream<Uint8Array>` where `ZipEntry = { name: string; source: { kind: "buffer"; data: Buffer } | { kind: "file"; path: string } }`.
  - [ ] Compression method **0 (STORE) only**. Photos are already-compressed JPEG/PNG/WebP; deflating them buys nothing and adds a failure mode. `compressedSize === uncompressedSize` for every entry.
  - [ ] CRC-32 comes from `zlib.crc32(buffer)` (`node:zlib`). It is present and typed on the pinned toolchain — verified against Node 20.19.2 / `@types/node` 20.19.43, and it survives the Node 24 bump in Story 8.1. **Do not hand-roll a CRC table.**
  - [ ] Byte layout — get these exact, a wrong offset produces an archive that some tools open and others reject:
    - Local file header, 30 bytes + name: `0` sig `0x04034b50`; `4` versionNeeded `20`; `6` flags `0x0800`; `8` method `0`; `10` dosTime; `12` dosDate; `14` crc32; `18` compressedSize; `22` uncompressedSize; `26` nameLength; `28` extraLength `0`; then the UTF-8 name bytes, then the file bytes.
    - Central directory header, 46 bytes + name: `0` sig `0x02014b50`; `4` versionMadeBy `20`; `6` versionNeeded `20`; `8` flags `0x0800`; `10` method `0`; `12` dosTime; `14` dosDate; `16` crc32; `20` compressedSize; `24` uncompressedSize; `28` nameLength; `30` extraLength `0`; `32` commentLength `0`; `34` diskStart `0`; `36` internalAttrs `0`; `38` externalAttrs `0`; `42` localHeaderOffset; then the name bytes.
    - End of central directory, 22 bytes: `0` sig `0x06054b50`; `4` diskNumber `0`; `6` cdStartDisk `0`; `8` entriesThisDisk; `10` entriesTotal; `12` cdSize; `16` cdOffset; `20` commentLength `0`.
    - All multi-byte integers little-endian (`Buffer#writeUInt16LE` / `writeUInt32LE`).
  - [ ] DOS timestamp from `modifiedAt`, read in **UTC** so the output does not shift with the server's timezone: `dosTime = (h << 11) | (min << 5) | (sec >> 1)`, `dosDate = ((year - 1980) << 9) | (month << 5) | day` with `month` 1-12. Clamp `year` to `>= 1980` — the DOS epoch cannot represent anything earlier.
  - [ ] Entry names use forward slashes, no leading slash, no `.` or `..` segments. Flag bit 11 (`0x0800`) declares the names UTF-8.
  - [ ] **Stream, one file buffered at a time.** For a `file` source, `fs.readFile` it, compute its CRC, emit local header + bytes, then drop the buffer before starting the next entry. STORE requires the CRC and size *before* the header, so each file must be fully read — but never more than one at a time. Buffering the whole archive would put a 5 MB × image-count spike on a self-hosted box.
  - [ ] **No ZIP64.** Guard before streaming: throw if any entry is `>= 0xFFFFFFFF` bytes, if the running local-header offset would reach `0xFFFFFFFF`, or if there are more than `0xFFFF` entries. Unreachable in practice under the 5 MB per-image cap, but a silent overflow writes a corrupt archive.
  - [ ] Omit `Content-Length` at the route (Task 4). Sizes are knowable from `fs.stat` up front, but a file that changes between stat and read would make the declared length a lie; chunked transfer is correct and costs nothing here.

- [ ] **Task 2 — Extend the export payload builder** (AC: 2, 3, 5)
  - [ ] `getTripExportForUser` (`src/lib/repositories/tripRepo.ts:1135-1292`) and its `TripExportPayload` type (`:180-228`). Keep every existing field and its ordering; this is additive.
  - [ ] Add per-day `travelSegments[]`. Include them in the same Prisma `include` as `dayPlanItems`, `orderBy: [{ createdAt: "asc" }, { id: "asc" }]`, and map the enums to the wire vocabulary the rest of the app already uses: `ACCOMMODATION`→`accommodation`, `DAY_PLAN_ITEM`→`dayPlanItem`, `CAR`/`SHIP`/`FLIGHT`→`car`/`ship`/`flight`. Copy the mapping helpers' shape from `travelSegmentRepo.ts:80-91`; do not invent a second spelling.
  - [ ] Each segment emits `{ id, fromItemType, fromItemId, toItemType, toItemId, transportType, durationMinutes, distanceKm, linkUrl, createdAt, updatedAt }`. **`fromItemId`/`toItemId` are the `id` values of the exported `accommodation` / `dayPlanItems` records.** Say so in a code comment: Story 2.32 regenerates every cuid on import and can only rewire segments by matching these against the exported record ids. Dropping them, or emitting positional indexes instead, silently breaks the import half.
  - [ ] Add `trip.bucketListItems[]` — **inside `trip`**, not at the top level (that is where 2.32's schema expects it), because `TripBucketListItem` is trip-scoped, not day-scoped (`prisma/schema.prisma`, `trip_bucket_list_items.trip_id`). Fields `{ id, title, description, positionText, location, createdAt, updatedAt }` with `location` shaped like every other location in this payload (`{ lat, lng, label } | null`, null when either coordinate is null). Order **`title asc, createdAt asc, id asc`** — identical to `listBucketListItemsForTrip` (`bucketListRepo.ts:99-102`) so the export matches what the UI shows.
  - [ ] Add gallery metadata: `accommodation.images[]` and `dayPlanItems[].images[]`, each entry exactly `{ sortOrder, photoId }`, from a nested `images` include ordered `sortOrder asc, createdAt asc` (the ordering `tripRepo.ts:993-999` already uses). No `id`, no `imageUrl` — see Dev Notes → "Manifest shape".
  - [ ] Add `trip.heroPhotoId` and `days[].imagePhotoId`, each a pool id or `null`. **Leave `trip.heroImageUrl` and `days[].imageUrl` exactly where they are** — a v1 reader and the existing import schema (`tripImportSchemas.ts:55-65`, `:200`) both still read them.
  - [ ] Build the top-level `photos` pool here, in the repository, not in the route — it is part of the payload contract. Assign keys `p1`, `p2`, … in **deterministic traversal order**: hero, then day by day (day image, then accommodation gallery in `sortOrder`, then each plan item's gallery in `sortOrder`). Dedupe on the resolved absolute file path so one file referenced twice yields one pool entry and one archive member.
  - [ ] Pool value is `{ contentType, archivePath }` with `archivePath = \`photos/${poolId}.${ext}\``. `ext` is the lowercased extension of the stored URL restricted to `jpg`, `jpeg`, `png`, `webp` — the set the upload routes accept (`accommodations/images/route.ts:25-29`); anything else → `bin`. `contentType` is that extension mapped back through the same table (`jpg`/`jpeg`→`image/jpeg`, `png`→`image/png`, `webp`→`image/webp`, `bin`→`application/octet-stream`).
  - [ ] Return the resolved on-disk path for each pooled photo alongside the payload, so the route can stream it without re-deriving anything: `getTripExportForUser` returns `{ payload, photoFiles: { archivePath: string; filePath: string }[] }`, in pool-key order. **This changes the function's return type** — it has three call sites in tests (`test/tripRepo.test.ts:237`, `:613`, `:668`) plus the route; update all of them.

- [ ] **Task 3 — Gate every disk read on the trip's own upload directory** (AC: 5)
  - [ ] Before a stored `imageUrl` earns a pool entry it must pass, in this order: it starts with `/uploads/trips/<tripId>/`; `resolvePublicFilePath` (`src/lib/trips/uploadPaths.ts:42-43`) resolves it; and `path.resolve` of the result is inside `path.resolve(getTripUploadDir(tripId))` — compare with a trailing-separator prefix check so `.../trips/abc-evil` cannot pass as `.../trips/abc`. Failing any check → no pool entry, the reference is `null` (or the `images[]` entry is dropped), the URL stays in its surviving v1 field, and nothing is read.
  - [ ] The prefix check alone is the pattern `removeManagedFile` already uses (`accommodations/images/route.ts:49-52`), and it is **not sufficient here**. That function only unlinks; this one reads bytes into a file the user downloads. `/uploads/trips/<tripId>/../../../etc/passwd` satisfies the prefix and escapes the directory, so the resolved-path containment check is the control that matters. Today every `imageUrl` is server-constructed and no route accepts a caller-supplied one, so this is defense in depth — but the export is the first code that reads arbitrary DB-stored paths off disk on request, and it hands the result to the caller.
  - [ ] External `http(s)` image URLs are legal in this schema (`dayImageUrlOrNull`, `tripImportSchemas.ts:55-65`, accepts either a `/uploads/` path or a URL). They are not fetched — no pool entry, URL preserved. A backup does not go out to the network.
  - [ ] A row that passes every check but whose file is gone (`ENOENT`) gets no pool entry and no `photoFiles` row, and appends a string to `meta.warnings`. Stat once during payload assembly rather than discovering it mid-stream; a header already on the wire cannot be retracted. AC4's invariant — every pool entry has a member, every reference has a pool entry — is what makes 2.32's validation a set comparison, so it must hold here too.

- [ ] **Task 4 — Convert the route to emit the archive** (AC: 1, 4, 6, 7, 8)
  - [ ] `src/app/api/trips/[id]/export/route.ts`. Bump `FORMAT_VERSION` `1` → `2` (`:17`). Keep `APP_VERSION` (`:16`), `toSafeSlug` (`:19-27`), the `requireSession` → `hasTripOwnerAccess` → `404` order (`:30-42`), and the `try`/`catch` → `500 server_error` wrapper (`:73-75`) as they are.
  - [ ] Keep `meta.exportedAt = <trip>.updatedAt` (`:53`) and its comment — the expression becomes `exported.payload.trip.updatedAt` under Task 2's return shape, but the value must not change. It is what makes AC7 possible and `tripExportRoute.test.ts:77` pins it.
  - [ ] Build the manifest buffer with `JSON.stringify(...)` and no indentation (matching today, and byte-stable), then assemble entries in fixed order: `trip.json` first, then `photoFiles` in pool-key order (`p1`, `p2`, …), which the repository already returns sorted.
  - [ ] Pass `new Date(exported.payload.trip.updatedAt)` as the writer's `modifiedAt`. Using `new Date()` here reintroduces exactly the non-determinism Story 2.9's review removed.
  - [ ] Response: `new Response(stream, { status: 200, headers: { "content-type": "application/zip", "content-disposition": \`attachment; filename="${fileName}"\` } })` with `fileName = \`trip-${toSafeSlug(name)}-${datePart}.zip\``. `runtime = "nodejs"` (`:8`) stays — `fs` and `zlib` need it.
  - [ ] `datePart` keeps deriving from a fresh `new Date().toISOString().slice(0, 10)` (`:50-51`). The filename is not archive content, so it does not affect AC7's byte-identity, and the existing filename regex tests assume a current date.
  - [ ] **This replaces the JSON response; it does not add a second format.** No `?format=` switch, no dual code path. One export shape is the whole point of the story, and Story 2.32 is specified against v2 while separately accepting a v1 file on import.

- [ ] **Task 5 — Tests** (AC: 1-7)
  - [ ] New `test/helpers/zipReader.ts` — a minimal in-process reader: locate the EOCD, walk the central directory, and return `{ name, crc32, compressedSize, uncompressedSize, flags, localHeaderOffset, data }` per entry. Both suites below import it; do not let a second copy grow inside a test file.
  - [ ] New `test/tripZipArchive.test.ts`, unit-level, no HTTP: build an archive from two buffer entries and one file entry; parse it back with `zipReader`; assert every signature, that each central-directory `localHeaderOffset` lands on a `0x04034b50`, that each stored CRC equals `zlib.crc32` of the extracted bytes, that `compressedSize === uncompressedSize`, that flag bit 11 is set, and that the extracted bytes round-trip. Assert byte-identical output for two runs with the same `modifiedAt`, and differing output for a different one. Assert the ZIP64 guard throws rather than truncating. Parse it in-process — do not shell out to `unzip`; the suite must not depend on host tooling.
  - [ ] Rewrite the happy path in `test/tripExportRoute.test.ts:35-80`: `content-type` is `application/zip`, `content-disposition` matches `/^attachment; filename="trip-paris-rome-2026-\d{4}-\d{2}-\d{2}\.zip"$/`, and the body is read via `Buffer.from(await response.arrayBuffer())` and parsed with `test/helpers/zipReader.ts`.
  - [ ] Keep all four negative cases exactly as they are — unauthenticated `401` (`:82-89`), `mustChangePassword` `403` (`:91-115`), non-owner `404` (`:117-146`), invalid token `401` (`:148-154`). They assert the JSON error envelope, which is unchanged: only the success path becomes a ZIP.
  - [ ] Keep the filename-injection case (`:156-180`) and re-point it at `.zip`. A CRLF in a trip name must still not reach the header.
  - [ ] New route cases: a trip with travel segments and bucket list items round-trips both into `trip.json` with the documented ordering and nesting (`bucketListItems` under `trip`); segment `fromItemId`/`toItemId` equal the exported accommodation/plan-item `id`s on the same day; a photo-bearing trip yields one archive member per `photos` entry with **no unregistered member and no dangling reference** (assert the set equality in both directions); a trip with no photos yields exactly one member (`trip.json`), `photos: {}`, and `200`; a DB row whose file was deleted from disk yields a `null` reference, a `meta.warnings` entry, and `200`; an `imageUrl` hand-written to `/uploads/trips/<tripId>/../../escape.png` yields no pool entry and no member; an `https://` day image yields `imagePhotoId: null` with `imageUrl` preserved; the same file referenced by two records yields one pool entry and one member; two consecutive exports of the same trip return byte-identical bodies.
  - [ ] Write photo fixtures the way `test/tripAccommodationImagesRoute.test.ts:14-25` does — `getTripsUploadRoot()`, `fs.rm(..., { recursive: true, force: true })` in `beforeEach`, files written under the upload-path helpers. `test/setup.ts` redirects `UPLOADS_PUBLIC_ROOT` to a per-worker temp dir; **never** build a path with `process.cwd() + "/public"`. The header comment in `uploadPaths.ts:3-18` records what happened the last time a suite did that.
  - [ ] Extend `test/tripRepo.test.ts` — `:174` (payload completeness) gains `travelSegments`, `trip.bucketListItems`, `images[]`, `heroPhotoId`, `imagePhotoId`, and the `photos` pool with its `archivePath` naming; `:587` and `:623` (ordering, payment order) keep passing against the new return shape. Add bucket-list ordering, pool-key assignment order, dedupe-by-path, and segment endpoint-id assertions.
  - [ ] Run `npm test` in full before declaring done, plus `npm run lint`. `getTripExportForUser`'s changed return type will surface at every call site — that is the point.

- [ ] **Task 6 — Record what this story deliberately does not do**
  - [ ] Append a `Deferred from: 2-31-...` section to `_bmad-output/implementation-artifacts/deferred-work.md` noting that the export has **no user-facing entry point**: Story 7.8 removed the "Export JSON" button (its AC3) and PRD FR33/FR34 record "No user-facing entry point exists until one is decided." This story delivers the contract behind that decision and does not pre-empt it. Cross-reference the existing `TripImportDialog.tsx` zero-call-site entry from 7.8 (`deferred-work.md:91-93`) — the same surface will re-land both or neither.
  - [ ] Update PRD FR33's parenthetical to note the format is now a v2 ZIP archive with photos. Leave the "no user-facing entry point" sentence in place.
  - [ ] Record the Story 2.32 delta in the same `deferred-work.md` section, copying the four bullets from Dev Notes → "Where this diverges from Story 2.32's spec as written". 2.32 is already `ready-for-dev` against a base64-in-JSON container; its dev session must see this before it starts. **Do not edit `2-32-…md` itself** — amending another story's spec from inside this one is how two specs end up disagreeing about who changed what.

## Dev Notes

### Baseline, and what lands before this story

`baseline_commit: 1ac8c5f`. Per `sprint-change-proposal-2026-08-01.md:344-348` the order is 7-7 → 7-8 → 7-9 → 7-11 → **2-31** → 2-32 → 8-1. Re-read the export route and `tripRepo.ts` at your actual HEAD before quoting the line numbers above.

**Story 7.8 is in flight and uncommitted at baseline.** It deletes `handleExport`, `triggerDownload`, `extractAttachmentFilename`, the `TripImportDialog` mount, and the `trips.export.*` / `trips.import.success` i18n keys from `TripTimeline.tsx`. It touches no route, no repository, and no schema — so it changes nothing this story depends on. But it does mean that when you finish, **the only way to reach the export is to request the URL directly.** That is intended (AC8, Task 6). Do not add a button, and do not treat the absence of one as an incomplete implementation.

### The format decision is settled — do not re-open it

Hand-rolled STORE-only ZIP, no new dependency. Considered and rejected:

- **A zip library** (`fflate`, `jszip`, `archiver`). Story 6.8 set the precedent explicitly — "browser print flow rather than adding `jspdf`, `react-pdf`, or screenshot-based export tooling" — and `npm run audit:check` runs `npm audit --omit=dev --audit-level=low`, so every runtime dependency is a standing obligation. A STORE-only writer is ~120 lines against a frozen 1989 spec.
- **Base64 photos inside the JSON.** One file with no ZIP code, but ~33% inflation and the whole payload resident as a string. The epic AC names an archive ("a JSON manifest plus photo files"); a base64 blob is not that.
- **DEFLATE.** JPEG/PNG/WebP are already entropy-coded; deflating them typically *grows* them and buys a second failure mode. The manifest is the only compressible member and it is small.

### Manifest shape (v2) — this is Story 2.32's input contract, do not improvise it

**Story 2.32's spec already exists** (`2-32-…md`, `## Package Format Contract v2`) and is `ready-for-dev`. It was authored against the same v2 field names below. Emit them exactly — a rename here silently invalidates a spec that is already queued behind this one. Additions marked `+`; everything unmarked is v1 and keeps its exact path and name.

```jsonc
{
  "meta": { "exportedAt", "appVersion", "formatVersion": 2, "+ warnings": [] },

  // + Photo pool. Keys are opaque exporter-chosen ids; entities reference photos
  //   by id. Each value names an archive member instead of carrying bytes inline.
  "photos": { "p1": { "contentType": "image/jpeg", "archivePath": "photos/p1.jpg" } },

  "trip": { "id", "name", "startDate", "endDate",
            "heroImageUrl",          // v1 field, kept verbatim
            "+ heroPhotoId": "p1" | null,
            "startLocation", "destinationLocation", "createdAt", "updatedAt",
            "+ bucketListItems": [ { "id", "title", "description", "positionText",
                                     "location", "createdAt", "updatedAt" } ] },

  "days": [ { "id", "date", "dayIndex",
              "imageUrl",            // v1 field, kept verbatim
              "+ imagePhotoId": "p1" | null,
              "note", "createdAt", "updatedAt",
              "accommodation": { …v1 fields…,
                "+ images": [ { "sortOrder": 0, "photoId": "p1" } ] } | null,
              "dayPlanItems": [ { …v1 fields…,
                "+ images": [ { "sortOrder": 0, "photoId": "p1" } ] } ],
              "+ travelSegments": [ { "id", "fromItemType", "fromItemId",
                                      "toItemType", "toItemId", "transportType",
                                      "durationMinutes", "distanceKm", "linkUrl",
                                      "createdAt", "updatedAt" } ] } ]
}
```

Three things that are easy to get subtly wrong:

- **`bucketListItems` lives inside `trip`,** not at the top level. 2.32 adds it to `tripImportSchema`, not to the root schema.
- **Image entries carry `{ sortOrder, photoId }` only** — no `id`, no `imageUrl`. The source image row's id is not needed by the importer, and its old `/uploads/` URL is meaningless on the target server. The record's `sortOrder` is what must survive.
- **`photos` is a map, not an array,** and `contentType` comes from the extension mapping in Task 2, restricted to the three types the upload routes accept.

`meta.warnings` is **always present, `[]` when clean** — an optional field would make a consumer branch on absence for no reason. It is additive: 2.32's schema ignores it. A record with no photo has `heroPhotoId`/`imagePhotoId` `null` and `images: []` — never an omitted key. `photos` is `{}` for a trip with no photos.

### Where this diverges from Story 2.32's spec as written

2.32's `## Package Format Contract v2` says "Single `.json` file" and embeds photo bytes as base64 in `photos[id].data`, and its Open Item #1 asserts that a real `.zip` "needs a new dependency." That premise is wrong — `node:zlib` ships `crc32` and STORE needs no compressor — and Tommy settled the container as a hand-rolled ZIP on 2026-08-01, after that spec was written.

Everything else in 2.32 survives unchanged: the pool indirection, `heroPhotoId` / `imagePhotoId` / `images[].photoId`, `bucketListItems` under `trip`, per-day `travelSegments`, the cross-reference validation, and the whole id-remapping design. **Do not edit `2-32-…md` from this story** — it is a separate spec with its own status. The delta it needs is recorded for its own dev session:

- `photos[id]` is `{ contentType, archivePath }`, not `{ contentType, data }`.
- The uploaded package is a `.zip`; the manifest is the member `trip.json`; photo bytes are the members named by `archivePath`.
- Its base64 decode-and-round-trip validation is replaced by ZIP member extraction plus CRC verification; its 5 MB per-photo cap and `contentType` allow-list still apply, to the extracted bytes.
- Its Open Item #1 is closed: the format is a ZIP and no dependency was added.

### Traps

- **`trip.updatedAt` is the clock for everything.** `meta.exportedAt`, the DOS timestamps in both headers of every entry. One stray `new Date()` inside the writer or the route breaks AC7, and AC7 is the property that lets a user diff two backups.
- **Two places store each entry's crc/sizes.** The local header and the central directory. Compute once per entry, write both from the same values. Divergence yields an archive that `unzip` opens and Windows refuses, or vice versa — the failure is tool-dependent, which is why the test parses the central directory back rather than trusting one extractor.
- **`removeManagedFile`'s prefix check is not a containment check.** See Task 3. Copy the intent, not the implementation.
- **`getTripExportForUser`'s return type changes.** Three test call sites plus the route. TypeScript will find them; do not paper over it with a cast.
- **`payments[]` fallback synthesis stays.** `tripRepo.ts:1234-1244` and `:1267-1277` synthesize a single payment from `costCents` when no `CostPayment` rows exist. That behavior is load-bearing for round-trip fidelity against 2.10's import (`tripImportSchemas.ts:95-114` requires payments to sum to `costCents`). Leave it alone.
- **Nested `include` for images, not the print path's separate queries.** `getTripDayPrintData` issues separate `accommodationImage` / `dayPlanItemImage` queries (`tripRepo.ts:970-999`) because it needs the *previous* day's accommodation, which its main query does not reach. The export walks one trip top-down and has no such constraint — a nested `images` include is correct and cheaper.
- **`TravelSegment` has a unique constraint on `(tripDayId, fromItemType, fromItemId, toItemType, toItemId)`.** Not this story's problem — but note it in the payload comment, because 2.32 will hit it if its remap collapses two distinct old ids onto one new one.

### Deliberately out of scope

- Any UI, i18n key, or component test. See Task 6. Note that Story 2.32's AC6 *does* require an "Import trip backup" control — the pair is deliberately asymmetric for now, and if that reads wrong to you it is a question for Tommy, not something to fix by adding an export button here.
- The import side. Story 2.32 consumes this format; do not start it, do not relax `tripImportSchemas.ts` in anticipation, and do not edit `2-32-…md`.
- `TripMember` collaborators. A backup restores a trip, not accounts.
- ZIP64, encryption, DEFLATE, multi-disk. Guard against the first (Task 1); the rest are out.
- Any Prisma migration. The export is read-only.
- Re-serving `heroImageUrl`/`imageUrl` rewritten to archive-relative paths. Both keep their stored value; `archivePath` is the sidecar that carries portability. Rewriting them in place would break every v1 reader for no gain.

### Testing

`vitest`, `environment: "node"`, `fileParallelism: false`, one fork (`vitest.config.ts`). `test/setup.ts` migrates a per-worker SQLite file and redirects `UPLOADS_PUBLIC_ROOT` — read its header comment before touching any filesystem path in a test. Tests live flat in `travelplan/test/` as `<subject>.test.ts`; the only shared-helper precedent is `test/helpers/renderWithProviders.tsx`, so putting the ZIP reader in `test/helpers/zipReader.ts` fits.

### Project Structure Notes

- New: `travelplan/src/lib/trips/zipArchive.ts`, `travelplan/test/tripZipArchive.test.ts`, `travelplan/test/helpers/zipReader.ts`
- Changed: `travelplan/src/lib/repositories/tripRepo.ts`, `travelplan/src/app/api/trips/[id]/export/route.ts`, `travelplan/test/tripExportRoute.test.ts`, `travelplan/test/tripRepo.test.ts`
- Docs: `_bmad-output/implementation-artifacts/deferred-work.md`, `_bmad-output/planning-artifacts/prd.md`
- Placement follows `architecture.md:241-255` — route handlers under `app/api/**/route.ts`, data access in `lib/repositories/`, shared utilities in `lib/`. `zipArchive.ts` sits beside `uploadPaths.ts` in `lib/trips/` because it exists to serve trip file export.
- Naming per `architecture.md:229-239`: camelCase JSON fields, `SCREAMING_SNAKE_CASE` constants, ISO 8601 UTC dates (`architecture.md:262-265`).
- The `{ data, error }` envelope (`architecture.md:258-260`) applies to the **error** responses only. The success body is a file download, exactly as Story 2.9 established (`2-9-export-trip-backup-as-json.md:107`).

### Pinned stack

Next `16.2.12`, React `19.2.3`, Prisma `7.3.0`, `zod` `4.1.11`, MUI `7.3.8`, `better-sqlite3` `12.6.2`, Node 20.19.2 at baseline (24 after Story 8.1). No upgrades, no additions. `zlib.crc32` and `Buffer` are the only new APIs, both built in and both available on 20 and 24.

### References

- `_bmad-output/planning-artifacts/epics.md#Story 2.31: Complete Trip Backup Export With Photos, Travel Segments, and Bucket List`
- `_bmad-output/implementation-artifacts/2-32-complete-trip-backup-import-with-photos-travel-segments-and-bucket-list.md#Package Format Contract v2` — **the authority on v2 field names.** Already `ready-for-dev`; read it before writing the payload builder, and read Dev Notes → "Where this diverges" for the one thing in it that is now wrong.
- `_bmad-output/planning-artifacts/epics.md#Story 2.32` — the consumer; its "older export format" AC is why v1 field paths are preserved
- `_bmad-output/planning-artifacts/prd.md:272-273` — FR33/FR34 and the parked entry-point decision
- `_bmad-output/planning-artifacts/sprint-change-proposal-2026-08-01.md:332`, `:344-348`, `:360` — this story's sequencing and the note that the format contract deserves attention against shipped 2.9/2.10
- `_bmad-output/planning-artifacts/architecture.md#Implementation Patterns & Consistency Rules`, `#Project Structure & Boundaries`
- `_bmad-output/implementation-artifacts/2-9-export-trip-backup-as-json.md` — the v1 contract and its determinism review finding
- `_bmad-output/implementation-artifacts/2-10-restore-import-trip-data-from-json.md` — the import contract v2 must stay compatible with
- `_bmad-output/implementation-artifacts/7-8-trip-overview-lower-sections-redesign.md` AC3, Task 6 — the entry-point removal
- `_bmad-output/implementation-artifacts/6-8-export-day-itinerary-pdf-for-offline-use.md` Task 2 — the no-new-library precedent
- PKWARE APPNOTE 6.3.10, §4.3.7 (local header), §4.3.12 (central directory), §4.3.16 (EOCD) — https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT
- `node:zlib` `crc32` — https://nodejs.org/docs/latest-v20.x/api/zlib.html#zlibcrc32data-value (added v20.15.0)
- MDN `Content-Disposition` — https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Disposition

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

### Change Log

- 2026-08-01: Story context created. Format (STORE-only hand-rolled ZIP) and scope (API + format, no UI entry point) settled with Tommy before authoring.
