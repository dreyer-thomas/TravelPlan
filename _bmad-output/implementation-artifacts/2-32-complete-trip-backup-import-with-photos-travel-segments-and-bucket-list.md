---
authored_against: 4dfef44
baseline_revision: ec461525c06b91461f6cf298da02151b97e21c14
final_revision: 4c69f2dff6c44416fe6812744af7cd536c9c3cf1
review_loop_iteration: 0
followup_review_recommended: true
status: awaiting-operator
operator_actions:
  - "Raise the reverse proxy's request body limit before announcing this feature: set `client_max_body_size 100m;` in the Nginx server block fronting this app, matching MAX_IMPORT_PACKAGE_BYTES, then reload Nginx. Until this is done every photo-bearing import is rejected by the proxy with a 413 and never reaches Node."
  - "Round-trip one trip end to end in a browser: create a trip carrying a hero image, a day image, an accommodation gallery, a plan-item gallery, at least one travel segment and two bucket list items, export it, then import it as 'Create new trip' and confirm every photo renders and every travel segment shows the correct endpoints."
  - "Delete the source trip after that import, then reopen the imported copy and confirm its photos still render. This is the point of the story: it proves the import copied the bytes instead of re-pointing at the original trip's uploads directory."
  - "Import a v1 backup (any .json export produced before Story 2.31) and confirm it restores with no error and no missing fields."
  - "Exercise the overwrite path in a browser: import a backup over an existing same-name trip, then confirm on disk that the old trip's upload directory is gone and that no stale days, accommodations, plan items, travel segments or bucket list items remain."
---

# Story 2.32: Complete Trip Backup Import With Photos, Travel Segments, and Bucket List

Status: awaiting-operator

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner,
I want to import a complete trip backup including travel segments, bucket list items, and photos,
so that I can fully restore a trip, including its media, on this or another system.

## ⚠️ Blocking Dependency — RESOLVED 2026-08-02, with a contract correction

Story 2.31 **has shipped** (commit `ec46152`). `FORMAT_VERSION` reads `2`, verified:

```bash
grep -n "FORMAT_VERSION" travelplan/src/app/api/trips/\[id\]/export/route.ts   # → 2
```

**The container it shipped is not the one this spec was written against.** This spec (authored before 2.31 was specced) assumed a *single JSON file with a base64 photo pool*. 2.31 shipped a **ZIP archive**: a `trip.json` manifest plus real photo files under `photos/`, written by a hand-rolled dependency-free STORE-only writer at `src/lib/trips/zipArchive.ts`.

Every *field name and shape inside the manifest* matches this spec exactly — 2.31's AC2 bound itself to this document. The divergence is the container and the photo-pool entry shape only:

| | This spec, as authored | What 2.31 actually ships |
|---|---|---|
| Container | one `.json` file | `.zip`, `application/zip` |
| Manifest location | the file itself | archive member `trip.json` |
| Photo pool entry | `{ contentType, data: "<base64>" }` | `{ contentType, archivePath: "photos/p1.jpg" }` |
| Photo bytes | inline base64 in the manifest | real archive members under `photos/` |
| `meta` | `exportedAt`, `appVersion`, `formatVersion` | + `warnings: string[]` |

**Resolution taken:** the importer is written against the format that actually exists on disk, not the one described here. The escalate-don't-guess rule this section originally carried exists to stop a parser being written against a *guessed* shape; the shape here is not guessed — it is readable in `getTripExportForUser` (`tripRepo.ts:1276`), in the exported types (`tripRepo.ts:185-313`), and in `test/tripExportRoute.test.ts`. Writing the importer against the spec's base64 shape would produce exactly the unrestorable-backup failure the rule was defending against.

§ Package Format Contract v2 below has been **rewritten to the shipped format** and is now the binding contract. See the Change Log entry for 2026-08-02.

## Acceptance Criteria

1. **Given** I import a complete v2 backup produced by Story 2.31
   **When** the import runs
   **Then** the trip, days, accommodations, day plan items, payments, **travel segments**, and **bucket list items** are all restored
   **And** the exported photo files are written to this server's upload storage and linked to their accommodations / day plan items / day / trip hero
2. **Given** I import a backup produced by the older v1 export format (no photos, travel segments, or bucket list)
   **When** the import runs
   **Then** the previously-supported fields are restored exactly as before
   **And** the absence of the newer data causes no error
3. **Given** the backup file is invalid, incomplete, or contains photo data that cannot be decoded
   **When** I attempt to import
   **Then** I see a validation error, **no database rows are written, and no files are written to upload storage**
4. **Given** a trip with the same name already exists
   **When** I import a complete backup
   **Then** I am prompted to confirm overwrite or create a new trip, consistent with the existing Story 2.10 conflict behavior
5. **Given** I choose overwrite
   **When** the import completes
   **Then** the target trip's previous days, accommodations, day plan items, payments, travel segments, **bucket list items**, and **previously uploaded files on disk** are all replaced — no orphaned rows and no orphaned files remain
6. **Given** I am signed in as an owner
   **When** I look for the import entry point in the UI
   **Then** a reachable "Import trip backup" control exists (see Task 6 — there is **no** entry point today; Story 7.8 removed it)

## Package Format Contract v2

*(Rewritten 2026-08-02 to the format Story 2.31 actually shipped — see the Blocking Dependency section above.)*

A **ZIP archive** (`application/zip`, `trip-<slug>-<YYYY-MM-DD>.zip`), STORE-only, produced by `src/lib/trips/zipArchive.ts`:

```
trip-lofoten-2026-08-02.zip
├── trip.json          ← the manifest, exactly one, always present
└── photos/
    ├── p1.jpg         ← real bytes; member name == the pool entry's archivePath
    └── p2.png
```

The importer must also accept a bare `.json` file: that is a **v1 backup** (AC2), and it is the same bytes `trip.json` carries minus the v2 additions. Sniff the leading magic bytes — `PK\x03\x04` (or `PK\x05\x06` for an empty archive) means ZIP, anything else is parsed as UTF-8 JSON.

`meta.formatVersion` is `2`. Everything v1 had is unchanged; v2 only **adds** fields, all of which are optional so a v1 file still parses (AC2).

`trip.json`:

```jsonc
{
  // `warnings` is NEW in v2 and always present in a v2 manifest ([] when clean). It records
  // photos the *export* had to skip. The importer reads it for reporting only — never as a
  // reason to fail. It is `.optional().default([])` so v1 still parses.
  "meta": { "exportedAt": "…Z", "appVersion": "0.1.0", "formatVersion": 2, "warnings": [] },

  // NEW in v2 — photo pool, keyed `p1`, `p2`, … in export traversal order. `archivePath`
  // names the archive member carrying the bytes; the bytes are NOT in the manifest.
  // Entities reference photos by pool id, so a file referenced twice is stored once.
  "photos": {
    "p1": { "contentType": "image/jpeg", "archivePath": "photos/p1.jpg" }
  },

  "trip": {
    "id": "…", "name": "…", "startDate": "…Z", "endDate": "…Z",
    "heroImageUrl": "/uploads/trips/OLD/…" | null,   // v1 field, kept
    "heroPhotoId": "p1" | null,                       // NEW v2, optional
    "startLocation": {…} | null, "destinationLocation": {…} | null,
    "createdAt": "…Z", "updatedAt": "…Z",

    // NEW in v2
    "bucketListItems": [
      { "id": "…", "title": "…", "description": null, "positionText": null,
        "location": { "lat": 0, "lng": 0, "label": null } | null,
        "createdAt": "…Z", "updatedAt": "…Z" }
    ]
  },

  "days": [
    {
      "id": "export-day-1",            // SOURCE id — used only for reference remapping
      "date": "…Z", "dayIndex": 1,
      "imageUrl": "/uploads/…" | null, // v1 field, kept
      "imagePhotoId": "p1" | null,     // NEW v2, optional
      "note": null,
      "createdAt": "…Z", "updatedAt": "…Z",

      "accommodation": {
        "id": "src-acc-1",             // SOURCE id — travel segments reference this
        "name": "…", "notes": null, "status": "planned" | "booked",
        "costCents": null, "payments": [ { "amountCents": 0, "dueDate": "YYYY-MM-DD" } ],
        "link": null, "checkInTime": null, "checkOutTime": null,
        "location": {…} | null, "createdAt": "…Z", "updatedAt": "…Z",
        "images": [ { "sortOrder": 0, "photoId": "p1" } ]   // NEW v2, optional
      } | null,

      "dayPlanItems": [
        { "id": "src-item-1",          // SOURCE id — travel segments reference this
          "title": null, "fromTime": null, "toTime": null,
          "contentJson": "…", "costCents": null, "payments": [ … ],
          "linkUrl": null, "location": {…} | null,
          "createdAt": "…Z", "updatedAt": "…Z",
          "images": [ { "sortOrder": 0, "photoId": "p1" } ] // NEW v2, optional
        }
      ],

      // NEW in v2. fromItemId/toItemId are SOURCE ids of this day's
      // accommodation / dayPlanItems — they MUST be remapped on import.
      "travelSegments": [
        { "id": "src-seg-1",
          "fromItemType": "accommodation" | "dayPlanItem", "fromItemId": "src-acc-1",
          "toItemType":   "accommodation" | "dayPlanItem", "toItemId":   "src-item-1",
          "transportType": "car" | "ship" | "flight",
          "durationMinutes": 30, "distanceKm": null, "linkUrl": null,
          "createdAt": "…Z", "updatedAt": "…Z" }
      ]
    }
  ]
}
```

**Wire format:** the route accepts the package as `multipart/form-data` with a single `file` part. It must **also** keep accepting the legacy `application/json` body `{ payload, strategy, targetTripId }` so the seven existing tests in `test/tripImportRoute.test.ts` keep passing unchanged. Branch on `request.headers.get("content-type")`.

Why multipart and not JSON-in-body: a ZIP is binary and cannot go in a JSON body without base64-inflating it by a third, and the current `TripImportDialog` does `JSON.parse(text)` client-side and then `JSON.stringify` it back into the request body — three copies of a potentially 100 MB payload in browser memory. Attaching the `File` directly to a `FormData` avoids both.

**Reading the archive:** a production ZIP *reader* does not exist yet — `zipArchive.ts` only writes, and `test/helpers/zipReader.ts` is a test helper (it trusts its input, has no size or ZIP64 guards, and lives outside `src/`). This story adds `src/lib/trips/zipReader.ts`. It is parsing attacker-supplied bytes, so it must, at minimum: locate the end-of-central-directory by bounded backward scan; reject ZIP64 sentinels rather than misreading them; reject member names that are absolute, contain `\`, or contain a `.`/`..` segment; support STORE (method 0) and DEFLATE (method 8, via `node:zlib` `inflateRawSync` — other tools may re-zip a backup); verify CRC-32 and the declared uncompressed size of every member; and cap total uncompressed bytes so a zip bomb cannot exhaust memory. Every failure is a `validation_error` 400, never a 500.

## The Three Things Most Likely To Be Got Wrong

1. **Travel segment id remapping.** `TravelSegment.fromItemId` / `toItemId` hold real `Accommodation.id` / `DayPlanItem.id` values. Import generates *new* cuids for every row. Segments written with the source ids point at nothing. You must build a `Map<sourceId, newId>` while creating each day's accommodation and plan items, then resolve `fromItemId`/`toItemId` through it. A segment whose endpoint is not in the map is a **validation failure**, not a row to skip.
2. **No writes before validation is complete (AC3).** ZIP parsing, CRC verification, `contentType` allow-listing, per-photo size checks and pool↔member set equality are part of validation and must all happen **before** the transaction opens and before any `fs.writeFile`. "References photo data that cannot be read" is an explicit AC.
3. **Overwrite must clean the filesystem too (AC5).** `tx.tripDay.deleteMany` cascades rows but touches nothing on disk, and it does **not** cascade to `TripBucketListItem` (that FK is on `Trip`, not `TripDay`). Both are new obligations in this story.

## Tasks / Subtasks

- [x] **Task 1 — Extend the import validation schema to v2** (AC: 1, 2, 3)
  - [x] Edit `travelplan/src/lib/validation/tripImportSchemas.ts`. Every new field is `.optional()` with a `null`/`[]` default so a v1 payload still parses — this is AC2 and it is enforced by keeping `test/tripImportSchemas.test.ts`'s existing cases green.
  - [x] `photoSchema`: `{ contentType: z.enum(["image/jpeg","image/png","image/webp"]), archivePath: z.string().min(1) }`. Allow-list matches `ALLOWED_TYPES` in the three upload routes exactly — do not widen it. Note the export's `application/octet-stream` / `.bin` fallback (`tripRepo.ts:1231`) is therefore **rejected**: it only arises from a stored URL the upload routes could not have produced, and AC3 wants that surfaced rather than written to disk unvalidated. Record it in `deferred-work.md`.
    - **Superseded, deliberately — see Open Question 5 and DW-83 (both resolved).** As shipped, `photoSchema.contentType` is `z.string().trim().min(1)`; the *bytes* carry the allow-list instead (`sniffPhotoContentType` in `importPackage.ts`, enforced by `validatePackagePhotos`). The enum was rejecting backups this app produces — `hero-image/route.ts:86` derives the stored extension from the client-supplied `file.type` without sniffing — so it failed AC1/AC2 while adding nothing to AC3. Verified 2026-08-02 against `tripImportSchemas.ts:122-125` and `importPackage.ts:138-167`.
  - [x] `photos: z.record(z.string().min(1), photoSchema).optional().default({})` on the payload root.
  - [x] `meta.warnings: z.array(z.string()).optional().default([])` — present in every v2 manifest, absent in v1.
  - [x] The **bytes** are not in the manifest, so per-photo byte checks cannot live in Zod. They belong in the archive-level validation of Task 2, which runs on the same request before the transaction and reports through the same `validation_error` 400.
  - [x] Add `imagesSchema = z.array(z.object({ sortOrder: z.number().int().min(0), photoId: z.string().min(1) })).optional().default([])` to both `accommodationImportSchema` and `dayPlanItemImportSchema`. `superRefine`: `sortOrder` values must be unique within one owner (`@@unique([accommodationId, sortOrder])` / `@@unique([dayPlanItemId, sortOrder])` will otherwise throw a P2002 mid-transaction).
  - [x] Add `heroPhotoId` (trip) and `imagePhotoId` (day), each `z.string().min(1).nullable().optional().default(null)`.
  - [x] Add `travelSegments` to `tripDayImportSchema`, defaulting to `[]`. Enums are the **API-level lowercase** forms (`accommodation` / `dayPlanItem`, `car` / `ship` / `flight`) — see `TravelSegmentDetail` in `travelSegmentRepo.ts:4-17`. `durationMinutes: z.number().int().positive()`, `distanceKm` nullable non-negative number, `linkUrl` nullable.
  - [x] Add `bucketListItems` to `tripImportSchema`, defaulting to `[]`: `title` required non-empty, `description` / `positionText` nullable, `location` reuses the existing `locationSchema`.
  - [x] Root `superRefine` cross-reference checks — **all of these are AC3 validation errors, not runtime failures**:
    - every `photoId` / `heroPhotoId` / `imagePhotoId` referenced anywhere exists as a key in `photos`
    - within each day, every `travelSegments[].fromItemId` / `toItemId` resolves to that same day's `accommodation.id` (when `fromItemType === "accommodation"`) or to one of that day's `dayPlanItems[].id`
    - the `(fromItemType, fromItemId, toItemType, toItemId)` tuple is unique within a day (mirrors `@@unique` `idx_travel_segments_pair`)
  - [x] Keep the existing v1 rules untouched: full day coverage of the date range, unique `dayIndex`, payments summing to `costCents`, `fromTime`/`toTime` pairing.

- [x] **Task 2 — Package reader, photo validation, photo staging** (AC: 1, 3, 5)
  - [x] Add `travelplan/src/lib/trips/zipReader.ts` — the production ZIP reader described under § Package Format Contract v2 → "Reading the archive". Do not import `test/helpers/zipReader.ts` from `src/`.
  - [x] Add `travelplan/src/lib/trips/importPackage.ts` — magic-byte sniff, then either `{ manifest, photoBytes: Map<archivePath, Buffer> }` from the ZIP (manifest = the `trip.json` member, required; a missing or non-JSON `trip.json` is a `validation_error`) or `{ manifest, photoBytes: new Map() }` from a bare v1 JSON file.
  - [x] Archive-level photo validation, **before** the transaction: every `photos[id].archivePath` has exactly one matching member; every member under `photos/` is registered in the pool (mirrors export AC4 in reverse); each member is `> 0` and `<= 5 * 1024 * 1024` bytes (`MAX_FILE_SIZE_BYTES`, identical in all three upload routes); and each member's leading magic bytes agree with its declared `contentType` (JPEG `FF D8 FF`, PNG `89 50 4E 47 0D 0A 1A 0A`, WebP `RIFF` + `WEBP` at offset 8). The magic-byte check is what makes AC3's "photo data that cannot be decoded" a real check rather than a claim. All of these are `validation_error` 400.
    - **Two adjustments, both verified against the code 2026-08-02.** (a) The per-photo ceiling shipped as `MAX_IMPORT_PHOTO_BYTES = 15 MB` (`importLimits.ts:33`), not 5 MB: the premise "identical in all three upload routes" is false — there are **four** upload routes and `trips/[id]/days/[dayId]/image/route.ts:15` allows `15 * 1024 * 1024`, so a 5 MB import cap would make a legitimately uploaded day image unrestorable from its own backup. (b) The magic bytes are checked against the *allow-list*, not against the declared `contentType`; a member matching no signature is still a `validation_error`, and the sniffed type — not the declared one — picks the on-disk extension. Same reasoning as the Task 1 note above.
  - [x] Add `travelplan/src/lib/trips/importPhotos.ts`. Do **not** add a new upload-path convention — reuse `getTripUploadDir`, `getTripDayUploadDir`, `getAccommodationImageUploadDir`, `getDayPlanItemImageUploadDir` from `src/lib/trips/uploadPaths.ts`. Those resolve through `UPLOADS_PUBLIC_ROOT`, which is what keeps `npm test` from deleting the developer's real uploads (see the docstring at `uploadPaths.ts:3-18` — this has already destroyed live files once).
  - [x] **Security: never use a filename from the package.** Generate server-side with the exact existing convention: `` `img-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${extension}` `` where `extension` comes from the `contentType` allow-list (`image/jpeg`→`jpg`, `image/png`→`png`, `image/webp`→`webp`). A package-supplied name is attacker-controlled path-traversal input.
  - [x] Write files **after** the DB transaction commits, because the final URL contains the newly generated `tripId` / `dayId` / `accommodationId`. Track every written absolute path in an array; on any write failure, `fs.rm(…, { force: true })` every path already written **and** delete the created/updated trip so AC3's "no partial data" holds for the disk-write phase too.
  - [x] URLs written into `imageUrl` columns must match the upload routes byte-for-byte, e.g. `/uploads/trips/{tripId}/days/{dayId}/accommodations/{accommodationId}/{fileName}`.

- [x] **Task 3 — Repository: extend `importTripFromExportForUser`** (AC: 1, 2, 5)
  - [x] Edit `travelplan/src/lib/repositories/tripRepo.ts` (`createImportedDays` at `:1302`, `importTripFromExportForUser` at `:1401`). Extend in place — do not fork a second import path.
  - [x] `createImportedDays` returns an id map. Suggested shape: `{ dayIdBySourceId, accommodationIdBySourceId, dayPlanItemIdBySourceId, imageTargets: [...] }` where `imageTargets` records `{ kind, tripDayId, ownerId, sortOrder, photoId }` for the post-commit write phase.
  - [x] **Travel segments** — create *after* both the accommodation and all plan items of that day exist, inside the same transaction, resolving `fromItemId`/`toItemId` through the id map. Map the lowercase enums up to Prisma's `ACCOMMODATION` / `DAY_PLAN_ITEM` and `CAR` / `SHIP` / `FLIGHT` (there are existing `toPrismaItemType` / `toPrismaTransportType` helpers in `travelSegmentRepo.ts` — reuse or mirror them; do not invent a third mapping).
  - [x] Do **not** call `createTravelSegmentForTripDay`. It re-runs `ensureSegmentItemsExist` adjacency validation against live ordering and takes its own `userId`/`tripId` guard; inside an import transaction it is both wrong and unusable. Write via `tx.travelSegment.create`.
  - [x] **Bucket list items** — `tx.tripBucketListItem.createMany` scoped to the new/target trip. Trim `title`; `cleanOptionalString` semantics for `description` / `positionText` (see `bucketListRepo.ts:107-130`).
  - [x] **Image rows** — `tx.accommodationImage.create` / `tx.dayPlanItemImage.create` with the final URL computed from the generated ids. `sortOrder` comes from the package.
  - [x] **Hero / day image resolution**, in this precedence order:
    1. `heroPhotoId` / `imagePhotoId` present → write the file, store the **new** URL.
    2. Absent but the v1 `heroImageUrl` / `imageUrl` string present → store the string verbatim (v1 behavior, AC2).
    Never keep the old `/uploads/trips/{sourceTripId}/…` string when photo bytes are available — on another system it is a dead link, and on the same system it points into a *different* trip's directory that gets deleted with that trip.
  - [x] **Overwrite mode** (`:1433-1497`) additionally must, inside the transaction: `tx.tripBucketListItem.deleteMany({ where: { tripId: targetTrip.id } })`. `tx.tripDay.deleteMany` already cascades days → accommodations / plan items / travel segments / images / payments; bucket list items hang off `Trip` and are **not** cascaded.
  - [x] **Overwrite mode, filesystem:** before writing new files, `fs.rename` the target's `getTripUploadDir(targetTripId)` to a sibling temp path; on full success `fs.rm` it, on any failure rename it back. A plain `fs.rm` first would make a later failure unrecoverable.
  - [x] Preserve every existing behavior: `sortImportDays` ordering, `toAccommodationStatus` mapping, payments back-fill from `costCents` when `payments` is absent, `target_trip_not_conflict` / `target_trip_not_found` errors, conflict detection by name.

- [x] **Task 4 — Import route: accept the package** (AC: 1, 2, 3, 4)
  - [x] Edit `travelplan/src/app/api/trips/import/route.ts`. Keep the current order of guards: CSRF (403) → session (401) → parse (400) → validate (400) → import.
  - [x] Branch on content type. `multipart/form-data` → read the `file` part, `Buffer.from(await file.arrayBuffer())`, hand to `parseImportPackage` (400 `invalid_json` for a bare-JSON file that will not parse, 400 `validation_error` for a malformed archive), then feed the manifest to the same `tripImportPayloadSchema`; `strategy` and `targetTripId` arrive as sibling form fields and go through `tripImportRequestSchema`'s rules unchanged. `application/json` → the existing path, byte-for-byte unchanged (no `photos` reachable there, which is correct: a JSON body can only carry a v1 payload or a v2 manifest with an empty pool).
  - [x] Add `MAX_IMPORT_PACKAGE_BYTES = 100 * 1024 * 1024` and reject a larger `file.size` with a `validation_error` 400 before reading it into memory.
  - [x] Keep `export const runtime = "nodejs"` — `node:fs` and `Buffer` are required.
  - [x] Return the existing success envelope plus counts the UI can confirm against: `{ trip, dayCount, mode, travelSegmentCount, bucketListItemCount, photoCount }`.
  - [x] Map the new failure modes: photo write failure → `server_error` 500 (after cleanup); everything schema-detectable → `validation_error` 400.

- [x] **Task 5 — Extend the export route to v2** — **done by Story 2.31 (`ec46152`), nothing changed here.** (AC: 1)
  - [x] Verified: `FORMAT_VERSION = 2` at `travelplan/src/app/api/trips/[id]/export/route.ts:19`, and `getTripExportForUser` emits `photos`, `travelSegments`, `bucketListItems`, `images`, `heroPhotoId`, `imagePhotoId` (`tripRepo.ts:1276-1676`). The container is a ZIP rather than this spec's originally-assumed single JSON file — see the Blocking Dependency section.

- [x] **Task 6 — Restore a reachable UI entry point** (AC: 6)
  - [x] There is **no import entry point in the product today.** Story 7.8 AC3 deleted the "Import JSON" button and the `TripImportDialog` mount from `TripTimeline.tsx`; PRD FR34 records the capability as "retained and functional; UI entry point removed… No user-facing entry point exists until one is decided." `deferred-work.md:93` records the dialog's zero-call-site state and says the surface that reconnects it inherits that note.
  - [x] **Place it on the trips list, not the trip overview.** Import creates or replaces a whole trip, so it belongs where trips are listed (`travelplan/src/components/features/trips/TripsDashboard.tsx`), and 7.8 removed it from the overview deliberately — putting it back there would revert a shipped decision. Confirm with Tommy before building if you disagree (see Open Questions).
  - [x] Update `TripImportDialog.tsx`: **drop the `tripId` prop.** Line 167 currently falls back to `conflictTargetTripId ?? conflicts[0]?.id ?? tripId` — on a trips-list surface there is no ambient trip, and that final `?? tripId` was always wrong (it could overwrite the trip you were merely *viewing*). The target must come only from the server-returned conflict set.
  - [x] Switch the dialog's submit to `FormData` (append `file`, and `strategy` / `targetTripId` when set); delete the client-side `JSON.parse` / `readFileText` path — it cannot parse a ZIP and there is nothing left for it to do. Widen `accept` to `application/zip,.zip,application/json,.json`. Client-side validity is now "a file is selected", not "the text parses as JSON"; the server is the only thing that can judge a package.
  - [x] Surface photo/segment/bucket counts in the success feedback so a user can see the media actually came across.
  - [x] `TripImportDialog.tsx` is one of the 12 files on the scoped `react-hooks/set-state-in-effect` `"warn"` list in `eslint.config.mjs` (`deferred-work.md:8`). Editing it does not lift that scope — do not "fix" the effect pattern here and do not widen the downgrade.
  - [x] Localize every new string in **both** `src/i18n/en.ts` and `src/i18n/de.ts`. The 14 `trips.import.*` keys already exist (`en.ts:161-174`) — reuse them, add only what is genuinely new. Deleting orphans from both dictionaries is the established convention (7.3); `test/i18nDictionaries.test.ts` enforces parity.
  - [x] Update `deferred-work.md:93` — the dialog now has a production call site again.

- [x] **Task 7 — Tests** (AC: 1, 2, 3, 4, 5, 6)
  - [x] `test/tripImportSchemas.test.ts` — extend: v2 manifest accepted; v1 payload still accepted unchanged (AC2 regression guard); disallowed `contentType` rejected; dangling `photoId` rejected; travel segment referencing an id not on its own day rejected; duplicate segment tuple rejected; duplicate image `sortOrder` rejected.
  - [x] New `test/tripImportPackage.test.ts` — ZIP vs bare-JSON sniffing; missing `trip.json` rejected; non-JSON `trip.json` rejected; CRC mismatch rejected; DEFLATE member accepted; traversal member name rejected; ZIP64 sentinel rejected; pool entry with no member rejected; unregistered `photos/` member rejected; photo over 5 MB rejected; magic bytes disagreeing with `contentType` rejected.
  - [x] `test/tripImportRoute.test.ts` — **keep all seven existing JSON-body tests passing untouched** (that is the v1 wire-compat proof), then add multipart cases: v2 ZIP package success; bare v1 `.json` upload success; oversize package 400; malformed archive 400; conflict + overwrite via multipart.
  - [x] New `test/tripBackupRoundTrip.test.ts` — the automated stand-in for the parts of Task 8 an agent can prove: build a trip with a hero image, a day image, an accommodation gallery, a plan-item gallery, travel segments and bucket list items; call the **real export route**; feed its exact bytes to the **real import route** as multipart; assert every row and every photo file came across, that segment endpoints resolve to the newly created ids, and that the imported photos live under the *new* trip's upload directory (so deleting the source trip cannot break them).
  - [x] `test/tripRepo.test.ts` — extend: travel segment endpoints resolve to the **newly created** row ids, not the source ids (assert `fromItemId` equals the imported accommodation's real id); bucket list items restored; image rows created with correct `sortOrder` and a URL containing the new trip/day/owner ids; overwrite removes previous bucket list items; overwrite leaves no orphaned `TravelSegment` / `AccommodationImage` rows; transaction rollback on forced failure writes nothing (extend the existing rollback test rather than adding a parallel one).
  - [x] New `test/tripImportPhotos.test.ts` — files land under `UPLOADS_PUBLIC_ROOT`; a package-supplied filename cannot escape the trip directory; failure mid-write removes every file already written; overwrite removes the target trip's old directory.
  - [x] `test/tripImportDialog.test.tsx` — update for the `FormData` submit and the removed `tripId` prop.
  - [x] `test/tripsDashboard.test.tsx` — import control present for the owner, absent where it should be.
  - [x] `test/i18nDictionaries.test.ts` passes (EN/DE parity).
  - [x] Run `npm test` (full suite) and `npm run lint`. Report both counts in Dev Agent Record — the 7.8 spec explicitly required verification claims to be checked facts, not assumptions.

- [ ] **Task 8 — Manual verification** *(operator-owned: needs a browser and a running dev server, which an unattended agent has neither of. `test/tripBackupRoundTrip.test.ts` proves the data and filesystem halves automatically; what is left below is visual confirmation.)*
  - [ ] Round-trip on one machine: create a trip with a hero image, a day image, an accommodation gallery, a plan-item gallery, at least one travel segment, and two bucket list items → export → import as **create new** → open the new trip and confirm every photo renders and every segment shows the right endpoints.
  - [ ] Delete the *source* trip, then confirm the imported copy's photos still render. This is the whole point of the story: it proves the import copied bytes rather than re-pointing at the original trip's `/uploads` directory.
  - [ ] Import a **v1** file (one exported before 2.31) and confirm it restores without error.
  - [ ] Overwrite path: import over an existing same-name trip, then confirm the old trip's upload directory is gone from disk and no stale rows remain.

## Dev Notes

### Current state of the code this story touches

| File | Today | This story |
|---|---|---|
| `src/app/api/trips/import/route.ts` | JSON body only; 401/403/400/409/200; conflict handling complete | + multipart branch, size cap, new counts in the envelope |
| `src/lib/validation/tripImportSchemas.ts` | v1 schema, strict day-coverage + payment-sum rules | + photos, images, travelSegments, bucketListItems, cross-ref checks |
| `src/lib/repositories/tripRepo.ts` | `getTripExportForUser` `:1276`, `createImportedDays` `:1686`, `importTripFromExportForUser` `:1785` | + segments, bucket list, image rows, id map, FS cleanup on overwrite |
| `src/lib/trips/zipArchive.ts` | STORE-only ZIP **writer**, added by 2.31 | untouched; the new reader mirrors its layout constants |
| `src/app/api/trips/[id]/export/route.ts` | `FORMAT_VERSION = 2`, ZIP, owner-only | **untouched — shipped by Story 2.31** |
| `src/components/features/trips/TripImportDialog.tsx` | Complete and tested, **zero production call sites** since 7.8 | reconnect, FormData submit, drop `tripId` prop |
| `src/lib/trips/uploadPaths.ts` | Single source of truth for upload paths, `UPLOADS_PUBLIC_ROOT`-aware | reuse as-is, do not extend |

### What must not regress

- The seven existing `test/tripImportRoute.test.ts` cases and every case in `test/tripImportSchemas.test.ts` — they encode the v1 contract and Story 2.10's review fixes (overwrite must target a same-name conflict; incomplete day coverage must be rejected).
- `test/tripExportRoute.test.ts` — the export route's owner-only 404 and success path.
- Trip overview, day view, and Gantt rendering — this story adds no UI to them.
- `UPLOADS_PUBLIC_ROOT` redirection. Any new test that touches disk must clean only inside its own temp root.

### Data model facts you will need

- `TravelSegment` unique key: `@@unique([tripDayId, fromItemType, fromItemId, toItemType, toItemId])` (`idx_travel_segments_pair`). Duplicate tuples throw P2002 mid-transaction — catch them in validation instead.
- `AccommodationImage` / `DayPlanItemImage` unique keys: `@@unique([ownerId, sortOrder])`. Same reasoning.
- `CostPayment` targets exactly one of `accommodationId` / `dayPlanItemId`; the CHECK constraint lives in SQL migrations, not the Prisma schema.
- `TripBucketListItem.tripId` → `Trip`, **not** `TripDay`. Not cascaded by `tripDay.deleteMany`.
- Import does not preserve source `createdAt` / `updatedAt` (Prisma `@default(now())` / `@updatedAt`). Day plan items are therefore ordered by insertion. Since travel segments now depend on plan-item ordering being meaningful, insert plan items in package array order and do not reorder them.

### Constraints carried from the existing upload routes

- Max 5 MB per image; `image/jpeg`, `image/png`, `image/webp` only.
- Filenames are always generated server-side.
- Deployment note: the reverse proxy in front of this app (Nginx, per architecture) caps request bodies at 1 MB by default. A photo-bearing import will 413 before it reaches Node unless `client_max_body_size` is raised. Call this out in the completion notes — it is an operational prerequisite, not a code change.

### Project Structure Notes

Files expected to change:

- `travelplan/src/lib/validation/tripImportSchemas.ts`
- `travelplan/src/lib/repositories/tripRepo.ts`
- `travelplan/src/lib/trips/zipReader.ts` *(new)*
- `travelplan/src/lib/trips/importPackage.ts` *(new)*
- `travelplan/src/lib/trips/importPhotos.ts` *(new)*
- `travelplan/src/lib/trips/importLimits.ts` *(new — added during implementation; the dialog needs the package cap and cannot import the server modules that hold it)*
- `travelplan/src/app/api/trips/import/route.ts`
- `travelplan/src/components/features/trips/TripImportDialog.tsx`
- `travelplan/src/components/features/trips/TripsDashboard.tsx`
- `travelplan/src/i18n/en.ts`, `travelplan/src/i18n/de.ts`
- `travelplan/test/tripImportSchemas.test.ts`, `tripImportRoute.test.ts`, `tripRepo.test.ts`, `tripImportDialog.test.tsx`, `tripsDashboard.test.tsx`
- `travelplan/test/tripImportPackage.test.ts`, `tripImportPhotos.test.ts`, `tripBackupRoundTrip.test.ts`, `tripImportRollback.test.ts` *(new)*
- `_bmad-output/implementation-artifacts/deferred-work.md`

Not changed: `travelplan/src/app/api/trips/[id]/export/route.ts` and `travelplan/src/lib/trips/zipArchive.ts` — both shipped by Story 2.31.

No Prisma migration. Every table this story writes already exists.

### Architecture Compliance

- Route handlers stay under `src/app/api/**/route.ts`; the repository remains the sole DB access layer; the route only does auth, validation, and HTTP mapping.
- `{ data, error }` envelope on every response.
- Zod validation in the API layer, before persistence.
- DB writes inside one `prisma.$transaction`.
- DB columns `snake_case`, JSON fields `camelCase`, dates ISO 8601 UTC.
- CSRF required on this state-changing POST.

### Library & Framework Requirements

Pinned, no upgrades and **no new dependencies** in this story:

- Next.js `16.2.12`, React `19.2.3`, Prisma / `@prisma/client` `7.3.0`, Zod `4.1.11`, MUI `7.3.8`, Vitest `3.2.7`
- Filesystem via `node:fs/promises`; ZIP inflate and CRC-32 via Node's built-in `node:zlib`. Do **not** add a zip/tar library — Story 2.31 hand-rolled the writer (`zipArchive.ts`) precisely to avoid one, and the reader is the matching half of that decision. This repo's posture on dependencies is conservative (see the ESLint/`brace-expansion` entry in `deferred-work.md`).

### Previous Story Intelligence

- **2.9 / 2.10** established the format, the owner-only export scope, deterministic day ordering, and the whole conflict/overwrite contract. 2.10's code review forced two fixes worth not re-breaking: overwrite may only target a trip from the server-returned same-name conflict set, and payloads whose days do not cover the full date range are rejected. Both have tests.
- **7.8** removed the import/export UI entry points, on purpose, keeping the routes and dialog alive. Its spec is unusually explicit that verification claims must be checked facts. It also flagged "the single most likely thing to be missed" pattern — for this story that is travel-segment id remapping.
- **7.8's deferred-work note (`:93`)** exists specifically to stop a future reader deleting `TripImportDialog.tsx` as dead code. This story is that future reader.

### Git Intelligence Summary

Recent commits (`1ac8c5f`, `a4f553b`, `ec605fb`, `917573b`, `e2531a8`) are all Epic 7 visual/design-token work — no backend or data-layer changes since Epic 6. The repository has uncommitted Epic 7 changes in `TripBucketListPanel.tsx`, `TripDayBucketListPanel.tsx`, `TripIcons.tsx`, `TripTimeline.tsx`, and both i18n dictionaries. **Both i18n files are already dirty** — check `git status` and rebase your additions on top rather than reverting someone's in-flight token work.

The established per-feature pattern holds: route guards → Zod schema → repository transaction → focused tests per surface.

### Latest Technical Information

- Next.js App Router route handlers read multipart bodies with `await request.formData()`; the returned `File` exposes `.size`, `.type`, `.text()`, `.arrayBuffer()`. Unlike the Pages Router there is no built-in `bodyParser.sizeLimit`, so the size cap must be explicit (Task 4).
- Zod 4 `z.record(keySchema, valueSchema)` requires both arguments. Cross-field checks belong in `superRefine` on the root object, which is where the existing day-coverage rule already lives.
- `node:zlib` exports a synchronous `crc32` (already used by `zipArchive.ts`) and `inflateRawSync`. Raw inflate — not `inflateSync` — is what a ZIP DEFLATE member needs: it carries no zlib header.
- A ZIP's authority is its central directory, not its local headers. Parse the former and use its `localHeaderOffset` to find the bytes; the two disagreeing is the classic malformed-archive case and must be a `validation_error`, not a crash.

### Project Context Reference

No `project-context.md` exists in this repository. Context sources used:

- `_bmad-output/planning-artifacts/epics.md#Story 2.32`
- `_bmad-output/planning-artifacts/prd.md` (FR33, FR34 — both annotated 2026-08-01)
- `_bmad-output/planning-artifacts/architecture.md` (API & Communication Patterns, Data Architecture, Implementation Patterns)
- `_bmad-output/planning-artifacts/sprint-change-proposal-2026-08-01.md` §5–6
- `_bmad-output/implementation-artifacts/2-9-export-trip-backup-as-json.md`, `2-10-restore-import-trip-data-from-json.md`, `7-8-trip-overview-lower-sections-redesign.md`, `deferred-work.md`

### References

- `_bmad-output/planning-artifacts/epics.md#Story 2.32: Complete Trip Backup Import With Photos, Travel Segments, and Bucket List`
- `_bmad-output/planning-artifacts/epics.md#Story 2.31` (the producing export)
- `_bmad-output/planning-artifacts/prd.md#FR34`
- `_bmad-output/planning-artifacts/architecture.md#API & Communication Patterns`
- `travelplan/src/lib/trips/uploadPaths.ts:3-18` (why `UPLOADS_PUBLIC_ROOT` exists)
- `travelplan/prisma/schema.prisma` (`TravelSegment`, `TripBucketListItem`, `AccommodationImage`, `DayPlanItemImage`)
- [Next.js Route Handlers](https://nextjs.org/docs/app/building-your-application/routing/route-handlers)
- [Zod Basics](https://zod.dev/basics)
- [Node Buffer — base64](https://nodejs.org/api/buffer.html)

## Open Questions for Tommy

1. ~~**Package format.**~~ **Answered by what shipped.** 2.31 built a genuine `.zip` with a hand-rolled, dependency-free STORE-only writer, so the archive *and* the zero-new-dependency constraint both held. This story adds the matching reader. Nothing left to decide.
2. **UI placement.** Task 6 puts the import control on the **trips list**, since import creates a whole trip and Story 7.8 removed it from the trip overview deliberately. Built that way; say so if you want a different surface.
3. ~~**Sequencing.**~~ **Answered:** 2.31 was specced and shipped first (`ec46152`), which is what let this story be written against a real format instead of a guessed one. It also surfaced the container mismatch documented above, which merging the stories would have hidden.
4. **Export button asymmetry.** `deferred-work.md` DW-47 and its export twin note that 7.8 removed *both* entry points and that they "re-land together or not at all". This story's AC6 forces the import half back. There is now a reachable **Import** control and still no **Export** control, so a user can restore a backup they have no way to create from the UI. That is what the ACs asked for and it is deliberately not fixed here — adding an export button would pre-empt the same product decision 2.31 was forbidden to pre-empt. Flagging it as a product call.
5. ~~**Rejected `application/octet-stream` photos.**~~ **Moot — the question rested on a false premise.** It assumed the declared `contentType` was worth validating. It is not: `trips/[id]/hero-image/route.ts:86` derives the stored extension from the client-supplied `file.type` without sniffing, so an ordinary PNG uploaded as `image/jpeg` is stored `hero.jpg` and exported as `image/jpeg` — the allow-list was rejecting backups this app produced, not just anomalous ones. **The bytes now decide alone.** `sniffPhotoContentType` allow-lists the JPEG/PNG/WebP signatures, a member matching none of them is still a `validation_error` (which is what AC3 actually asks for — reject data that is not a decodable image), and the sniffed type, not the declared one, picks the extension written to disk. `contentType` in the manifest is a hint. Nothing degrades and no warning channel was needed. See DW-83, now resolved.

## Dev Agent Record

### Agent Model Used

Claude Opus 5 (1M context), via `bmad-dev-auto`. Backend half (Tasks 1–4, 7-backend) and UI half (Task 6, 7-UI) implemented by two sequential implementation subagents; contract correction, verification and review driven by the orchestrator.

### Debug Log References

None. No debug session was needed.

### Completion Notes List

**Verified facts, not assumptions** (re-run 2026-08-02 by the verification session against the code on disk — every task checkbox below was re-checked as a fact, not carried over as a claim):

- `npm test` → **101 test files passed, 801 tests passed, 0 failed.** (Measured after the review pass, which added 11 regression tests. Earlier notes in this file recorded 100/755 and then 101/790; both were accurate when written and are superseded.)
- `npm run lint` → **86 problems (2 errors, 84 warnings)**. Both errors are pre-existing `react/no-children-prop` in `src/theme.ts:120` and `:137` — a file this story never touched. Every warning landing in a story-touched file was confirmed pre-existing by diffing against `f52d17e^`: `TripImportDialog.tsx:98` is the scoped `react-hooks/set-state-in-effect` downgrade Task 6 forbids widening (`deferred-work.md:20`), `TripsDashboard.tsx:118/121` are the untouched `loadTrips` callback/effect, `test/tripImportSchemas.test.ts:180` is the same `_imageUrl`/`_note` destructure that sat at `:89` before the story, and `test/tripImportRoute.test.ts:14` is the pre-existing `consistent-type-definitions` disable. **No lint finding is new in any file this story added or edited.**
- `npx tsc --noEmit` (not wired to an npm script in this repo, run manually) reports errors only under `test/**` and none under `src/**`. The one such error that belonged to this story — a `validatePackagePhotos` call in `test/tripImportPackage.test.ts` missing its `referenceCounts` argument — was fixed in the verification session; the remaining ~120 are the suite's long-standing `fetch` mock casts and un-narrowed discriminated unions, present before this story.
- Wire compatibility: `test/tripImportRoute.test.ts` carried **nine** pre-existing JSON-body cases, not the seven this spec names. All nine were diffed against `f52d17e^` and are byte-identical; the multipart work was added alongside them plus one new JSON-path case (`rejects an oversized json body before reading it`, which closes a genuinely unbounded `request.json()`).

**Per-AC evidence** (each traced to a named test, 2026-08-02):

| AC | Evidence |
|---|---|
| 1 | `test/tripBackupRoundTrip.test.ts` "exports a fully populated trip and imports it back as an independent copy" — drives the **real** export route into the **real** import route, then deletes the source trip and asserts the copy's photos survive. Plus `test/tripRepo.test.ts` "restores photos, galleries, travel segments and bucket list items from a v2 backup". |
| 2 | `test/tripImportSchemas.test.ts` "fills v2 defaults so a v1 payload is unchanged after parsing (AC2)"; `test/tripImportRoute.test.ts` "imports a bare v1 json file uploaded as multipart"; `test/tripRepo.test.ts` "keeps the v1 image strings when a backup carries no pooled photos"; and the nine untouched JSON-body cases. |
| 3 | `test/tripImportRoute.test.ts` "rejects a package whose photo bytes decode as no image at all" asserts **both** `prisma.trip.count() === 0` and an empty uploads root. `test/tripImportPackage.test.ts` (40 cases) covers CRC, ZIP64, traversal, zip-bomb and pool↔member checks; `test/tripImportRollback.test.ts` covers the post-commit disk phase. |
| 4 | `test/tripImportRoute.test.ts` "returns a conflict and then overwrites through the multipart path"; "rejects overwrite target that is not part of same-name conflicts" (Story 2.10's review fix, preserved). |
| 5 | `test/tripRepo.test.ts` "replaces bucket list items and leaves no orphaned segment or image rows on overwrite" and "clears v1 image urls that name files the overwrite just deleted"; `test/tripBackupRoundTrip.test.ts` "overwrites the source trip in place and removes its previous files"; `test/tripImportPhotos.test.ts` "moves an overwrite target's upload directory aside and only deletes it on success". |
| 6 | `test/tripsDashboard.test.tsx` → `describe("import entry point")`: control present beside "Add trip", absent from individual trip rows, opens the dialog, and refetches the list on success. |

**The contract correction.** This spec was authored assuming a single JSON file with a base64 photo pool. Story 2.31 shipped a ZIP archive instead. Manifest field names matched exactly; only the container and the photo-pool entry shape diverged. The importer was written against the shipped format and § Package Format Contract v2 was rewritten to match — see the Blocking Dependency section and the 2026-08-02 Change Log entry for the full reasoning.

**New production modules.** `src/lib/trips/zipReader.ts` is the reader half of 2.31's hand-rolled writer, and it parses attacker-supplied bytes: bounded backward EOCD scan, central directory treated as the authority, ZIP64 sentinels rejected rather than misread, encrypted/split archives rejected, member names validated exactly as the writer's `assertUsableName`, STORE + DEFLATE only, CRC-32 and declared size verified per member, 200 MB total-uncompressed cap against zip bombs, and every offset read bounds-checked so no `RangeError` can escape as a 500. `src/lib/trips/importPackage.ts` sniffs ZIP vs bare v1 JSON and does the archive-level photo validation (pool↔member equality both ways, size bounds, magic-byte agreement with declared `contentType`). `src/lib/trips/importPhotos.ts` stages the post-commit disk writes with all-or-nothing cleanup.

**AC3 holds across both phases.** All parsing, CRC, allow-list, size and magic-byte validation completes before the transaction opens and before any `fs.writeFile`. The disk-write phase runs post-commit (the URLs need the generated ids) and cleans up every file it wrote on failure.

**Deployment prerequisite (operator, not code).** The reverse proxy in front of this app caps request bodies at 1 MB by default. A photo-bearing import will 413 before it reaches Node unless `client_max_body_size` is raised — recommend `100m` to match `MAX_IMPORT_PACKAGE_BYTES`. Enumerated under `operator_actions` in the frontmatter.

**Decisions the spec did not settle**, taken during implementation:

1. Hero and day images keep the upload routes' fixed `hero.<ext>` / `day.<ext>` names rather than the generated `img-…` form. Both are still fully server-chosen — no package input reaches them — and Task 2 requires URLs to match the upload routes byte-for-byte; a generated hero name would be orphaned the first time someone replaced the hero through the route. Galleries use the generated form as specified.
2. On photo-write failure in **overwrite** mode the trip is not deleted. Task 2 said "delete the created/updated trip", but on overwrite that destroys the trip the user was replacing — unrecoverable, and strictly worse than rows whose images 404. Create-new still deletes (it owns everything it made); overwrite restores the stashed upload directory and returns 500.
3. Overwrite's filesystem replacement is unconditional, per AC5. Overwriting a trip with a *v1* backup therefore deletes the files that backup's verbatim `/uploads/…` strings point at. Filed as **DW-85** — since **resolved** in follow-up review: the deletion is still unconditional, but a v1 URL with no pooled replacement that points into the *target trip's own* upload directory is now stored as `null` rather than as a string naming a file that is gone. Overwrite only; create-new still restores v1 strings verbatim (AC2).
4. Travel-segment `distanceKm`/`transportType` coupling (`travelSegmentSchemas.ts`: car requires distance, non-car forbids it) is deliberately **not** enforced on import. The export emits whatever is in the DB; enforcing it would make legitimate backups unrestorable.
5. ~~`application/octet-stream` photos are rejected rather than skipped~~ — filed as **DW-83** and raised as Open Question 5, both since **resolved** in follow-up review: the manifest's `contentType` is a hint, the bytes are the authority, and only a member matching no allow-listed signature is rejected.
6. Two distinct i18n labels: `trips.import.open` ("Import backup") for the dashboard trigger, `trips.import.action` ("Start import") for the dialog submit. Both are on screen at once, so identical text would make role queries ambiguous. Follows the existing `trips.edit.open` / `trips.edit.submit` convention.
7. The dialog holds open on success to show the count summary; `onImported()` fires first so the list refreshes underneath.

**Known-stale comment left in place:** `test/tripTimelineRoles.test.tsx:118` asserts no "Import JSON" button exists on the trip overview. The assertion passes and the overview correctly has no import control, but the comment's rationale now reads oddly. Out of scope here; worth a one-line fix by whoever next touches that file.

### File List

**New — production**
- `travelplan/src/lib/trips/zipReader.ts`
- `travelplan/src/lib/trips/importPackage.ts`
- `travelplan/src/lib/trips/importPhotos.ts`
- `travelplan/src/lib/trips/importLimits.ts` — the numeric ceilings (`MAX_IMPORT_PACKAGE_BYTES`, `MAX_IMPORT_PHOTO_BYTES`, `MAX_IMPORT_PHOTO_WRITES`, `MAX_IMPORT_PHOTO_TOTAL_BYTES`, and from the review pass `MAX_SUPPORTED_FORMAT_VERSION`, `MAX_IMPORT_DAYS`, `MAX_IMPORT_SEGMENTS_PER_DAY`, `MAX_IMPORT_BUCKET_LIST_ITEMS`, `MAX_IMPORT_WARNINGS`, `MAX_IMPORT_WARNING_LENGTH`). Its own module because `TripImportDialog` needs the package cap and can import neither the route nor `importPackage.ts` without dragging Prisma / `node:zlib` into the browser bundle.

**New — test**
- `travelplan/test/helpers/zipBuilder.ts`
- `travelplan/test/tripImportPackage.test.ts`
- `travelplan/test/tripImportPhotos.test.ts`
- `travelplan/test/tripBackupRoundTrip.test.ts`
- `travelplan/test/tripImportRollback.test.ts` — the post-commit disk-phase failure paths (stash restored, create-new trip deleted, `photo_write_failed` preserved when the restore itself fails, success reported when only the stash cleanup fails).

**Modified — production**
- `travelplan/src/lib/validation/tripImportSchemas.ts`
- `travelplan/src/lib/repositories/tripRepo.ts`
- `travelplan/src/app/api/trips/import/route.ts`
- `travelplan/src/components/features/trips/TripImportDialog.tsx`
- `travelplan/src/components/features/trips/TripsDashboard.tsx`
- `travelplan/src/i18n/en.ts`
- `travelplan/src/i18n/de.ts`

**Modified — test**
- `travelplan/test/helpers/uploadFixtures.ts`
- `travelplan/test/tripImportSchemas.test.ts`
- `travelplan/test/tripImportRoute.test.ts`
- `travelplan/test/tripRepo.test.ts`
- `travelplan/test/tripImportDialog.test.tsx`
- `travelplan/test/tripsDashboard.test.tsx`

**Modified — docs**
- `_bmad-output/implementation-artifacts/deferred-work.md` (DW-47 closed; DW-76 updated; DW-83/84/85 added)
- `_bmad-output/implementation-artifacts/2-32-complete-trip-backup-import-with-photos-travel-segments-and-bucket-list.md`

**Deliberately not modified** — `travelplan/src/app/api/trips/[id]/export/route.ts`, `travelplan/src/lib/trips/zipArchive.ts` (both shipped by Story 2.31), `travelplan/src/theme.ts`.

## Auto Run Result

Status: **awaiting-operator** — Tasks 1–7 are complete, reviewed and committed. Task 8 is manual verification that needs a browser and a running dev server, and there is one deployment prerequisite only an operator can satisfy. Both are enumerated under `operator_actions` in the frontmatter.

**What was implemented.** The import half of the v2 trip backup format: a production ZIP reader (`zipReader.ts`) that is the matching half of Story 2.31's hand-rolled writer and parses attacker-supplied bytes defensively; a package layer (`importPackage.ts`) that sniffs ZIP vs bare v1 JSON and validates the archive against the manifest before anything is written; a photo-staging layer (`importPhotos.ts`) with all-or-nothing cleanup; a v2 validation schema with cross-reference and ceiling checks; a repository path that remaps travel-segment endpoints onto newly generated ids, restores bucket list items and gallery image rows, and replaces the target's upload directory on overwrite; a multipart branch on the import route that keeps the pre-existing JSON wire contract byte-for-byte; and a reachable import entry point on the trips list.

**Files changed.** See § File List for the full inventory. The review pass touched `tripRepo.ts` (stash error contract, transaction timeouts, create-new directory cleanup), `tripImportSchemas.ts` + `importLimits.ts` (row-count ceilings, format-version gate), `import/route.ts` (`file_too_large` code, `target_trip_required` mapping, body-read guard), `TripImportDialog.tsx` (file re-selection, non-JSON/413 handling, error-code mapping, list keys), both i18n dictionaries (one new key), and three test files.

**Review findings.** 12 patches applied, 7 deferred (DW-86 … DW-92), 6 rejected, 0 intent gaps, 0 spec defects. Breakdown and reasoning in § Review Triage Log.

**Verification performed.** Every figure below was run by the orchestrator after the patches, not taken from a subagent report.

- `npm test` → **101 test files passed, 801 tests passed, 0 failed.**
- `npm run lint` → **86 problems (2 errors, 84 warnings)** — identical to the pre-story baseline. Both errors are pre-existing `react/no-children-prop` in `src/theme.ts`, a file this story never touched.
- `npx tsc --noEmit` → clean across all of `src/**`. (Pre-existing type errors in unrelated test files are untouched and predate this story.)

**Residual risks.**

- The concurrency and filesystem-locality issues in DW-86 and DW-87 are real and unfixed: two simultaneous overwrites of one trip can corrupt each other's files, and a failed stash cleanup leaves replaced photos readable at a guessable public path. Neither has a drive-by fix.
- Overwrite commits rows before writing photos, so a disk failure mid-overwrite leaves a trip whose images 404. This is a deliberate, documented trade-off (Completion Notes, decision 2) — the alternative destroys the trip the user was replacing — but it is a real state a user can reach.
- Until the reverse proxy's `client_max_body_size` is raised, every photo-bearing import fails at the proxy. The dialog now reports that accurately instead of blaming the file, but the import genuinely does not work until the operator acts.

**Follow-up review recommended: true.** The patch set is not a handful of localized cosmetic fixes: it spans four layers (repository transaction semantics, validation ceilings, route error contract, client error handling), five of the twelve are medium-severity behaviour changes, and it introduces a new API error code, a new i18n key and explicit transaction bounds. Volume and breadth together justify an independent pass.

## Review Triage Log

### 2026-08-02 — Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 12: (high 0, medium 5, low 7)
- defer: 7: (high 0, medium 3, low 4)
- reject: 6
- addressed_findings:
  - `[medium]` `[patch]` `stashTripUploadDir` was called *above* the disk phase's `try`, so a rename failing with anything but `ENOENT` (`EACCES`, `EPERM`, `EBUSY`) escaped as an unmapped `Error` — generic 500, no restore attempted, rows already replaced. Now inside its own `try` and mapped to `photo_write_failed`.
  - `[medium]` `[patch]` Both import transactions ran on Prisma's default 5s interactive-transaction timeout. An import is the heaviest write this app performs — every day, item, payment, image row and segment is a separate awaited round trip — so a long trip hit P2028 and answered a bare 500 after rolling back. Now `{ timeout: 120_000, maxWait: 15_000 }`.
  - `[medium]` `[patch]` Nothing bounded the *row* count a manifest could declare (the photo caps bound only disk). The day count is pinned to the declared date range, so an absurd range was a schema-legal way to ask for six figures of rows in one transaction. Added `MAX_IMPORT_DAYS` / `MAX_IMPORT_SEGMENTS_PER_DAY` / `MAX_IMPORT_BUCKET_LIST_ITEMS`, all far above any real backup.
  - `[medium]` `[patch]` `meta.formatVersion` was validated only as a positive integer, so a future v3 manifest would import, report **success**, and silently drop every field zod had no rule for — the one failure mode a backup tool must not have. Gated at `MAX_SUPPORTED_FORMAT_VERSION`. Closes DW-84.
  - `[medium]` `[patch]` Re-selecting a file after one was rejected did nothing: the input's value was never cleared, so the browser fired no `change` event for an unchanged path. The error and the disabled submit button stuck and the dialog looked frozen. Value is now cleared on every change.
  - `[medium]` `[patch]` A reverse-proxy 413 (HTML body, no envelope) made `response.json()` throw, and the catch reported the generic "import failed" — and until `client_max_body_size` is raised that is what *every* photo-bearing import gets. The dialog now handles a non-JSON response and names the size limit on 413.
  - `[low]` `[patch]` The route's oversize rejection used a bare `validation_error`, which the dialog maps to "this backup could not be read, it may be incomplete or damaged" — sending a user with a perfectly good but oversized file to investigate a file that is fine. Now its own `file_too_large` code, mapped to the size message.
  - `[low]` `[patch]` `invalid_json` mapped to "request could not be processed, please try again", telling a user who picked the wrong file to repeat the one thing that cannot help. New `trips.import.invalidFile` string (EN + DE) naming the real problem.
  - `[low]` `[patch]` `target_trip_required` was thrown by the repository and unmapped by the route — dead today because the request schema shadows it, but a 500 for a missing parameter the moment that changes. Mapped to 400, like its five siblings.
  - `[low]` `[patch]` An unanticipated throw inside `readRequestBody` (`file.arrayBuffer()`, the ZIP reader) escaped the handler, so Next answered with its own error page instead of the `{ data, error }` envelope and the dialog's `response.json()` threw. Wrapped.
  - `[low]` `[patch]` A failed create-new unlinked the files it wrote but not the directories it created to write them, so every failed import left a permanent skeleton of empty directories under `uploads/trips/`. Now removes the tree.
  - `[low]` `[patch]` Diagnostic and warning lines were keyed by content, and both lists arrive from the package — a manifest repeating a warning verbatim dropped one of the two lines. Keyed by position.

Deferred as DW-86 … DW-92: concurrent-overwrite file corruption, the stash living inside the public uploads root, create-new restoring a v1 URL that cross-links another trip's directory, the package reader's diagnostics never reaching the user, folder-prefixed re-zips being rejected, the whole package re-uploading to answer a conflict prompt, and the trips list going stale after an overwrite whose rows committed but whose photos did not.

Rejected: the failed-overwrite trade-off and the v1-overwrite file deletion (both deliberate, documented decisions with the reasoning recorded in Completion Notes and DW-85); the claim that the rollback test masks the first of those (by that decision there is no invariant to test); caps being enforced above the repository rather than inside it (no such caller exists); peak memory being ~4× the upload (inherent to the wire format the spec chose, already stated in the route's own comments); and chunked transfer-encoding bypassing the `content-length` pre-check (the proxy body cap is the enforcement layer, and raising it is already an enumerated operator action).

## Change Log

- 2026-08-01: Created Story 2.32 ready-for-dev context file — v2 package format contract, travel-segment id remapping, photo restore with filesystem cleanup, v1 backward compatibility, and UI entry-point restoration.
- 2026-08-02 (verification session): Re-verified Tasks 1–7 against the code on disk rather than against the prior attempt's checkmarks. All seven hold. Corrections made to this file: test/lint figures replaced with measured ones (101 files / 790 tests; lint findings individually traced to `f52d17e^` to prove none is new); `importLimits.ts` and `test/tripImportRollback.test.ts` added to the File List and Project Structure Notes, where the prior attempt had omitted them; per-AC evidence table added; the two Task 1/Task 2 subtasks whose literal text the shipped code deliberately departs from (`contentType` enum, 5 MB photo cap) annotated in place with the reason and the superseding decision. One code fix: a missing `referenceCounts` argument in `test/tripImportPackage.test.ts` (type error only — the call passed at runtime because the cap it feeds is unreachable on that path). Task 8 left unchecked; it is operator-owned.
- 2026-08-02 (review pass): Adversarial and edge-case review of the full `ec46152..HEAD` diff. 12 patches applied, 7 findings deferred (DW-86 … DW-92), 6 rejected — see § Review Triage Log. Five of the patches change behaviour rather than copy: the disk phase's stash is now inside its error contract, both import transactions carry explicit timeouts instead of Prisma's 5s default, the manifest gained row-count ceilings, `formatVersion` is gated at 2 (closing DW-84), and the dialog survives a reverse-proxy 413 with an HTML body. 11 regression tests added across `tripImportSchemas.test.ts` and `tripImportDialog.test.tsx`; two existing assertions updated for the new `file_too_large` code (both tests are new in this story — verified absent from `ec46152`). Suite 101 files / 801 tests, lint unchanged at 86 problems (2 errors, 84 warnings).
- 2026-08-02: **Package Format Contract v2 rewritten to the format Story 2.31 actually shipped.** This spec was authored before 2.31 was specced and assumed a single JSON file with a base64 photo pool; 2.31 shipped a ZIP archive (`trip.json` manifest + real `photos/*` members, pool entries carry `archivePath` not `data`, `meta.warnings` added). All manifest field names and shapes are unchanged — 2.31's AC2 bound itself to this document — so only the container and the photo-pool entry shape moved. Consequent edits: Blocking Dependency section (now records the resolution), § Package Format Contract v2, the wire-format note, Task 1 (`photoSchema`, `meta.warnings`, byte checks moved out of Zod), Task 2 (new production `zipReader.ts` and `importPackage.ts`, archive-level photo validation incl. magic-byte check), Task 4 (multipart reads bytes not text), Task 5 (**closed — done by 2.31**), Task 6 (`accept` widened to `.zip`, client-side JSON parse deleted), Task 7 (new package and round-trip suites), Task 8 (marked operator-owned), Dev Notes tables and line numbers, dependency note (`node:zlib`, no zip library), Open Questions 1/3 answered and 4/5 added.
