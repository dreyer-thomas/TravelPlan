# Story 2.32: Complete Trip Backup Import With Photos, Travel Segments, and Bucket List

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner,
I want to import a complete trip backup including travel segments, bucket list items, and photos,
so that I can fully restore a trip, including its media, on this or another system.

## ⚠️ Blocking Dependency — Read First

**Story 2.31 (`2-31-complete-trip-backup-export-with-photos-travel-segments-and-bucket-list`) is `backlog` and has no spec file. It produces the package this story consumes. Do not start 2.32 until 2.31 has shipped the v2 export.**

The package format contract is specified in full below (§ Package Format Contract v2). It is the *binding* contract for both stories. If 2.31 shipped a format that differs from this section in any way, **stop and escalate** rather than writing a parser against a guessed shape — a silent mismatch means backups that cannot be restored, which is the exact failure this feature exists to prevent.

Verify before starting:

```bash
grep -n "FORMAT_VERSION" travelplan/src/app/api/trips/\[id\]/export/route.ts   # must read 2
```

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

Single `.json` file. `meta.formatVersion` is `2`. Everything v1 had is unchanged; v2 only **adds** fields, all of which are optional so a v1 file still parses (AC2).

```jsonc
{
  "meta": { "exportedAt": "…Z", "appVersion": "0.1.0", "formatVersion": 2 },

  // NEW in v2 — content-addressable photo pool. Keys are opaque ids chosen by the
  // exporter. Entities reference photos by id so identical bytes are stored once.
  "photos": {
    "p1": { "contentType": "image/jpeg", "data": "<base64, no data: prefix>" }
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

Why multipart and not JSON-in-body: the current `TripImportDialog` does `JSON.parse(text)` client-side and then `JSON.stringify` it back into the request body. With base64 photos in the payload that holds three copies of a potentially 100 MB string in browser memory. Attaching the `File` directly to a `FormData` avoids the client-side parse entirely.

## The Three Things Most Likely To Be Got Wrong

1. **Travel segment id remapping.** `TravelSegment.fromItemId` / `toItemId` hold real `Accommodation.id` / `DayPlanItem.id` values. Import generates *new* cuids for every row. Segments written with the source ids point at nothing. You must build a `Map<sourceId, newId>` while creating each day's accommodation and plan items, then resolve `fromItemId`/`toItemId` through it. A segment whose endpoint is not in the map is a **validation failure**, not a row to skip.
2. **No writes before validation is complete (AC3).** Base64 decoding, `contentType` allow-listing and per-photo size checks are part of validation and must happen **before** the transaction opens and before any `fs.writeFile`. "References photo data that cannot be read" is an explicit AC.
3. **Overwrite must clean the filesystem too (AC5).** `tx.tripDay.deleteMany` cascades rows but touches nothing on disk, and it does **not** cascade to `TripBucketListItem` (that FK is on `Trip`, not `TripDay`). Both are new obligations in this story.

## Tasks / Subtasks

- [ ] **Task 1 — Extend the import validation schema to v2** (AC: 1, 2, 3)
  - [ ] Edit `travelplan/src/lib/validation/tripImportSchemas.ts`. Every new field is `.optional()` with a `null`/`[]` default so a v1 payload still parses — this is AC2 and it is enforced by keeping `test/tripImportSchemas.test.ts`'s existing cases green.
  - [ ] `photoSchema`: `{ contentType: z.enum(["image/jpeg","image/png","image/webp"]), data: z.string().min(1) }`. Allow-list matches `ALLOWED_TYPES` in the three upload routes exactly — do not widen it.
  - [ ] `photos: z.record(z.string().min(1), photoSchema).optional().default({})` on the payload root.
  - [ ] Decode-and-size check inside a `superRefine` on the root: for each entry, `Buffer.from(data, "base64")` must round-trip (`buf.toString("base64") === data.replace(/=+$/,"")`-equivalent check, or re-encode compare) and `buf.byteLength` must be `> 0` and `<= 5 * 1024 * 1024`. 5 MB is `MAX_FILE_SIZE_BYTES`, identical in all three upload routes. Reject with a `validation_error`, never a 500.
  - [ ] Add `imagesSchema = z.array(z.object({ sortOrder: z.number().int().min(0), photoId: z.string().min(1) })).optional().default([])` to both `accommodationImportSchema` and `dayPlanItemImportSchema`. `superRefine`: `sortOrder` values must be unique within one owner (`@@unique([accommodationId, sortOrder])` / `@@unique([dayPlanItemId, sortOrder])` will otherwise throw a P2002 mid-transaction).
  - [ ] Add `heroPhotoId` (trip) and `imagePhotoId` (day), each `z.string().min(1).nullable().optional().default(null)`.
  - [ ] Add `travelSegments` to `tripDayImportSchema`, defaulting to `[]`. Enums are the **API-level lowercase** forms (`accommodation` / `dayPlanItem`, `car` / `ship` / `flight`) — see `TravelSegmentDetail` in `travelSegmentRepo.ts:4-17`. `durationMinutes: z.number().int().positive()`, `distanceKm` nullable non-negative number, `linkUrl` nullable.
  - [ ] Add `bucketListItems` to `tripImportSchema`, defaulting to `[]`: `title` required non-empty, `description` / `positionText` nullable, `location` reuses the existing `locationSchema`.
  - [ ] Root `superRefine` cross-reference checks — **all of these are AC3 validation errors, not runtime failures**:
    - every `photoId` / `heroPhotoId` / `imagePhotoId` referenced anywhere exists as a key in `photos`
    - within each day, every `travelSegments[].fromItemId` / `toItemId` resolves to that same day's `accommodation.id` (when `fromItemType === "accommodation"`) or to one of that day's `dayPlanItems[].id`
    - the `(fromItemType, fromItemId, toItemType, toItemId)` tuple is unique within a day (mirrors `@@unique` `idx_travel_segments_pair`)
  - [ ] Keep the existing v1 rules untouched: full day coverage of the date range, unique `dayIndex`, payments summing to `costCents`, `fromTime`/`toTime` pairing.

- [ ] **Task 2 — Photo staging + path helpers** (AC: 1, 3, 5)
  - [ ] Add `travelplan/src/lib/trips/importPhotos.ts`. Do **not** add a new upload-path convention — reuse `getTripUploadDir`, `getTripDayUploadDir`, `getAccommodationImageUploadDir`, `getDayPlanItemImageUploadDir` from `src/lib/trips/uploadPaths.ts`. Those resolve through `UPLOADS_PUBLIC_ROOT`, which is what keeps `npm test` from deleting the developer's real uploads (see the docstring at `uploadPaths.ts:3-18` — this has already destroyed live files once).
  - [ ] **Security: never use a filename from the package.** Generate server-side with the exact existing convention: `` `img-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${extension}` `` where `extension` comes from the `contentType` allow-list (`image/jpeg`→`jpg`, `image/png`→`png`, `image/webp`→`webp`). A package-supplied name is attacker-controlled path-traversal input.
  - [ ] Write files **after** the DB transaction commits, because the final URL contains the newly generated `tripId` / `dayId` / `accommodationId`. Track every written absolute path in an array; on any write failure, `fs.rm(…, { force: true })` every path already written **and** delete the created/updated trip so AC3's "no partial data" holds for the disk-write phase too.
  - [ ] URLs written into `imageUrl` columns must match the upload routes byte-for-byte, e.g. `/uploads/trips/{tripId}/days/{dayId}/accommodations/{accommodationId}/{fileName}`.

- [ ] **Task 3 — Repository: extend `importTripFromExportForUser`** (AC: 1, 2, 5)
  - [ ] Edit `travelplan/src/lib/repositories/tripRepo.ts` (`createImportedDays` at `:1302`, `importTripFromExportForUser` at `:1401`). Extend in place — do not fork a second import path.
  - [ ] `createImportedDays` returns an id map. Suggested shape: `{ dayIdBySourceId, accommodationIdBySourceId, dayPlanItemIdBySourceId, imageTargets: [...] }` where `imageTargets` records `{ kind, tripDayId, ownerId, sortOrder, photoId }` for the post-commit write phase.
  - [ ] **Travel segments** — create *after* both the accommodation and all plan items of that day exist, inside the same transaction, resolving `fromItemId`/`toItemId` through the id map. Map the lowercase enums up to Prisma's `ACCOMMODATION` / `DAY_PLAN_ITEM` and `CAR` / `SHIP` / `FLIGHT` (there are existing `toPrismaItemType` / `toPrismaTransportType` helpers in `travelSegmentRepo.ts` — reuse or mirror them; do not invent a third mapping).
  - [ ] Do **not** call `createTravelSegmentForTripDay`. It re-runs `ensureSegmentItemsExist` adjacency validation against live ordering and takes its own `userId`/`tripId` guard; inside an import transaction it is both wrong and unusable. Write via `tx.travelSegment.create`.
  - [ ] **Bucket list items** — `tx.tripBucketListItem.createMany` scoped to the new/target trip. Trim `title`; `cleanOptionalString` semantics for `description` / `positionText` (see `bucketListRepo.ts:107-130`).
  - [ ] **Image rows** — `tx.accommodationImage.create` / `tx.dayPlanItemImage.create` with the final URL computed from the generated ids. `sortOrder` comes from the package.
  - [ ] **Hero / day image resolution**, in this precedence order:
    1. `heroPhotoId` / `imagePhotoId` present → write the file, store the **new** URL.
    2. Absent but the v1 `heroImageUrl` / `imageUrl` string present → store the string verbatim (v1 behavior, AC2).
    Never keep the old `/uploads/trips/{sourceTripId}/…` string when photo bytes are available — on another system it is a dead link, and on the same system it points into a *different* trip's directory that gets deleted with that trip.
  - [ ] **Overwrite mode** (`:1433-1497`) additionally must, inside the transaction: `tx.tripBucketListItem.deleteMany({ where: { tripId: targetTrip.id } })`. `tx.tripDay.deleteMany` already cascades days → accommodations / plan items / travel segments / images / payments; bucket list items hang off `Trip` and are **not** cascaded.
  - [ ] **Overwrite mode, filesystem:** before writing new files, `fs.rename` the target's `getTripUploadDir(targetTripId)` to a sibling temp path; on full success `fs.rm` it, on any failure rename it back. A plain `fs.rm` first would make a later failure unrecoverable.
  - [ ] Preserve every existing behavior: `sortImportDays` ordering, `toAccommodationStatus` mapping, payments back-fill from `costCents` when `payments` is absent, `target_trip_not_conflict` / `target_trip_not_found` errors, conflict detection by name.

- [ ] **Task 4 — Import route: accept the package** (AC: 1, 2, 3, 4)
  - [ ] Edit `travelplan/src/app/api/trips/import/route.ts`. Keep the current order of guards: CSRF (403) → session (401) → parse (400) → validate (400) → import.
  - [ ] Branch on content type. `multipart/form-data` → read the `file` part, `await file.text()`, `JSON.parse` (400 `invalid_json` on throw), then feed the same `tripImportRequestSchema`; `strategy` and `targetTripId` arrive as sibling form fields. `application/json` → the existing path, byte-for-byte unchanged.
  - [ ] Add `MAX_IMPORT_PACKAGE_BYTES = 100 * 1024 * 1024` and reject a larger `file.size` with a `validation_error` 400 before reading it into memory.
  - [ ] Keep `export const runtime = "nodejs"` — `node:fs` and `Buffer` are required.
  - [ ] Return the existing success envelope plus counts the UI can confirm against: `{ trip, dayCount, mode, travelSegmentCount, bucketListItemCount, photoCount }`.
  - [ ] Map the new failure modes: photo write failure → `server_error` 500 (after cleanup); everything schema-detectable → `validation_error` 400.

- [ ] **Task 5 — Extend the export route to v2** *(only if Story 2.31 did not already do it — verify first, do not duplicate)* (AC: 1)
  - [ ] `travelplan/src/app/api/trips/[id]/export/route.ts` `FORMAT_VERSION` must be `2` and `getTripExportForUser` must emit `photos`, `travelSegments`, `bucketListItems`, `images`, `heroPhotoId`, `imagePhotoId`. If `grep FORMAT_VERSION` already shows `2`, this task is **done by 2.31** — check the box, note it in Dev Agent Record, and change nothing.

- [ ] **Task 6 — Restore a reachable UI entry point** (AC: 6)
  - [ ] There is **no import entry point in the product today.** Story 7.8 AC3 deleted the "Import JSON" button and the `TripImportDialog` mount from `TripTimeline.tsx`; PRD FR34 records the capability as "retained and functional; UI entry point removed… No user-facing entry point exists until one is decided." `deferred-work.md:93` records the dialog's zero-call-site state and says the surface that reconnects it inherits that note.
  - [ ] **Place it on the trips list, not the trip overview.** Import creates or replaces a whole trip, so it belongs where trips are listed (`travelplan/src/components/features/trips/TripsDashboard.tsx`), and 7.8 removed it from the overview deliberately — putting it back there would revert a shipped decision. Confirm with Tommy before building if you disagree (see Open Questions).
  - [ ] Update `TripImportDialog.tsx`: **drop the `tripId` prop.** Line 167 currently falls back to `conflictTargetTripId ?? conflicts[0]?.id ?? tripId` — on a trips-list surface there is no ambient trip, and that final `?? tripId` was always wrong (it could overwrite the trip you were merely *viewing*). The target must come only from the server-returned conflict set.
  - [ ] Switch the dialog's submit to `FormData` (append `file`, and `strategy` / `targetTripId` when set); delete the client-side `JSON.parse` / `readFileText` path. Widen `accept` to `application/json,.json`.
  - [ ] Surface photo/segment/bucket counts in the success feedback so a user can see the media actually came across.
  - [ ] `TripImportDialog.tsx` is one of the 12 files on the scoped `react-hooks/set-state-in-effect` `"warn"` list in `eslint.config.mjs` (`deferred-work.md:8`). Editing it does not lift that scope — do not "fix" the effect pattern here and do not widen the downgrade.
  - [ ] Localize every new string in **both** `src/i18n/en.ts` and `src/i18n/de.ts`. The 14 `trips.import.*` keys already exist (`en.ts:161-174`) — reuse them, add only what is genuinely new. Deleting orphans from both dictionaries is the established convention (7.3); `test/i18nDictionaries.test.ts` enforces parity.
  - [ ] Update `deferred-work.md:93` — the dialog now has a production call site again.

- [ ] **Task 7 — Tests** (AC: 1, 2, 3, 4, 5, 6)
  - [ ] `test/tripImportSchemas.test.ts` — extend: v2 payload accepted; v1 payload still accepted unchanged (AC2 regression guard); undecodable base64 rejected; disallowed `contentType` rejected; photo over 5 MB rejected; dangling `photoId` rejected; travel segment referencing an id not on its own day rejected; duplicate segment tuple rejected; duplicate image `sortOrder` rejected.
  - [ ] `test/tripImportRoute.test.ts` — **keep all seven existing JSON-body tests passing untouched** (that is the v1 wire-compat proof), then add multipart cases: v2 package success; oversize package 400; malformed multipart 400; conflict + overwrite via multipart.
  - [ ] `test/tripRepo.test.ts` — extend: travel segment endpoints resolve to the **newly created** row ids, not the source ids (assert `fromItemId` equals the imported accommodation's real id); bucket list items restored; image rows created with correct `sortOrder` and a URL containing the new trip/day/owner ids; overwrite removes previous bucket list items; overwrite leaves no orphaned `TravelSegment` / `AccommodationImage` rows; transaction rollback on forced failure writes nothing (extend the existing rollback test rather than adding a parallel one).
  - [ ] New `test/tripImportPhotos.test.ts` — files land under `UPLOADS_PUBLIC_ROOT`; a package-supplied filename cannot escape the trip directory; failure mid-write removes every file already written; overwrite removes the target trip's old directory.
  - [ ] `test/tripImportDialog.test.tsx` — update for the `FormData` submit and the removed `tripId` prop.
  - [ ] `test/tripsDashboard.test.tsx` — import control present for the owner, absent where it should be.
  - [ ] `test/i18nDictionaries.test.ts` passes (EN/DE parity).
  - [ ] Run `npm test` (full suite) and `npm run lint`. Report both counts in Dev Agent Record — the 7.8 spec explicitly required verification claims to be checked facts, not assumptions.

- [ ] **Task 8 — Manual verification**
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
| `src/lib/repositories/tripRepo.ts` | `getTripExportForUser` `:1135`, `createImportedDays` `:1302`, `importTripFromExportForUser` `:1401` | + segments, bucket list, image rows, id map, FS cleanup on overwrite |
| `src/app/api/trips/[id]/export/route.ts` | `FORMAT_VERSION = 1`, owner-only, JSON download | v2 — **owned by Story 2.31** |
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
- `travelplan/src/lib/trips/importPhotos.ts` *(new)*
- `travelplan/src/app/api/trips/import/route.ts`
- `travelplan/src/app/api/trips/[id]/export/route.ts` *(only if 2.31 left it at v1)*
- `travelplan/src/components/features/trips/TripImportDialog.tsx`
- `travelplan/src/components/features/trips/TripsDashboard.tsx`
- `travelplan/src/i18n/en.ts`, `travelplan/src/i18n/de.ts`
- `travelplan/test/tripImportSchemas.test.ts`, `tripImportRoute.test.ts`, `tripRepo.test.ts`, `tripImportDialog.test.tsx`, `tripsDashboard.test.tsx`
- `travelplan/test/tripImportPhotos.test.ts` *(new)*
- `_bmad-output/implementation-artifacts/deferred-work.md`

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
- Base64 via Node's built-in `Buffer`; filesystem via `node:fs/promises`. Do **not** add a zip/tar library — that is the reason the package format is a single JSON file with an embedded photo pool rather than an archive. This repo's posture on dependencies is conservative (see the ESLint/`brace-expansion` entry in `deferred-work.md:9`).

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
- `Buffer.from(str, "base64")` is lenient — it silently ignores invalid characters rather than throwing. A round-trip re-encode comparison is the only reliable way to detect corrupt base64, which AC3 requires you to detect.

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

1. **Package format.** This spec commits to a single JSON file with a base64 photo pool (zero new dependencies) rather than a real archive. Epic 2.31's AC says "e.g., an archive containing a JSON manifest plus photo files" — the binding requirement is a single portable file, which this satisfies. If you want a genuine `.zip`, it needs a new dependency and both 2.31 and 2.32 change.
2. **UI placement.** Task 6 puts the import control on the **trips list**, since import creates a whole trip and Story 7.8 removed it from the trip overview deliberately. Confirm, or name a different surface.
3. **Sequencing.** 2.31 is `backlog` with no spec. Should 2.31 be specced and shipped first (recommended), or should the two be merged into one story so the format contract cannot drift between them?

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

## Change Log

- 2026-08-01: Created Story 2.32 ready-for-dev context file — v2 package format contract, travel-segment id remapping, photo restore with filesystem cleanup, v1 backward compatibility, and UI entry-point restoration.
