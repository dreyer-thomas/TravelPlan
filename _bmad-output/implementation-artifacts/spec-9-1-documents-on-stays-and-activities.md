---
title: 'Story 9.1 — Documents on Stays and Activities'
type: 'feature'
created: '2026-08-05'
status: 'done'
baseline_revision: '7d9f661eaa6ee523bedb27abeb307979b96d43d7'
final_revision: 'a750f3fe6eea3c9d29b4d97356ca18e396669741'
test_baseline: '120 files / 1417 tests green'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/9-1-documents-on-stays-and-activities.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-9-context.md'
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** A ticket or booking confirmation can only be attached to a stay or activity as a *photo*, so a multi-page PDF becomes a screenshot of its first screen. Photos and documents are the same gesture with a different payload, and one genuinely different display problem: a document has no thumbnail, so it needs a labelled chip rather than a square.

**Approach:** Two new tables mirroring the existing image galleries (plus a `fileName` column, because the on-disk name is server-generated), two upload routes copied structurally from the image routes, a shared `DocChip` primitive on the three timeline `tl-card`s, a document field on both dialogs' existing `Medien & Links` tab, and a separate `documents/` pool in the v2 backup archive. Story 8.3 already moved media out of the served tree, so the stored URL scheme needs no change.

## Boundaries & Constraints

**Always:**
- Stored URL is `/uploads/trips/${tripId}/days/${tripDayId}/{accommodations|day-plan-items}/${entityId}/documents/${fileName}` — `tripId` third, so `src/app/uploads/[...path]/route.ts` authorises it unchanged.
- Every path comes from `uploadPaths.ts` helpers composed together; never rebuilt from `process.cwd()` (DW-22).
- The on-disk name is `doc-${Date.now()}-${rand}.${ext}` with the extension from the route's own `ALLOWED_TYPES`. Nothing on disk is ever named from client or package input. The user's `fileName` is a sanitised **column value only**.
- Route order is byte-for-byte the image routes': `requireCsrf` → `requireSession` → `hasTripOwnerAccess` → `declaredBodyExceedsFileLimit` → `formData()` → validate → write → insert → roll back the file on a failed insert.
- The 10-per-entry cap is enforced in the repository create, not only in the UI.
- Backup changes are additive within v2: every new manifest field `.optional()` with a `[]`/`{}` default; `FORMAT_VERSION` and `MAX_SUPPORTED_FORMAT_VERSION` both stay `2`.
- Documents count against the existing `MAX_IMPORT_PHOTO_WRITES` / `MAX_IMPORT_PHOTO_TOTAL_BYTES` — one disk budget, not two.
- Every chip and the `+N` control measures ≥44px at 390px **and** at desktop width; use the `{ "&&": { minHeight: 44 } }` specificity bump if built on a MUI component (DW-180).
- Applied migrations are immutable. A wrong migration is fixed by adding a new one.

**Block If:**
- Nothing. All four of the story's open questions were answered on 2026-08-05 and are recorded under "Decisions carried in" below. Story 8.3 is `done` in `sprint-status.yaml`, so the pre-Task-1 sequencing gate is satisfied and must not halt this run again.

**Never:**
- Do not touch `IMAGE_UPLOAD_ACCEPT`, `isSupportedImageUpload`, `PHOTO_SIGNATURES`, `sniffPhotoContentType`, or the `photos` pool. Separate filter, separate sniffer, separate pool, separate `documents/` prefix — widening the photo checks is the one change that lets a non-image be restored as a photograph.
- Do not open a document in `FullscreenPhotoViewer`, including an image document.
- Do not extend `PhotoUploadField` — its preview half is a 56px `<img>` strip and a PDF renders as a broken image. Sibling component, shared dropzone *pattern*.
- Do not add a document reorder function, a fifth tab, a new panel, a cache-buster, a PDF rasteriser, or any new npm dependency (`pdf-lib` belongs to Story 9.2).
- Do not touch the `variant="gallery"` strip sites (`TripDayView.tsx:3383`, `:3404`, `TripDayMapFullPage.tsx:497`, `:518`) or `TripTimeline.tsx`.
- Do not touch Story 9.2's surface: `TripDayPrintPage.tsx`, `TripDayPrintDocument.tsx`, print output, the merged packet.
- Do not bump `proxyClientMaxBodySize` — 10 MB arrives below the existing 15 MB day-image route.
- Do not weaken an existing assertion to make a new one pass.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Upload a PDF | `POST` documents route, owner session, valid CSRF, 2 MB `application/pdf`, `file.name = "Ticket Rom.pdf"` | 201-equivalent `ok({ document })`; row carries `fileName: "Ticket Rom.pdf"`, `documentUrl` ends `/documents/doc-<ts>-<rand>.pdf`; file on disk under the entry's `documents/` subdir | No error expected |
| Upload an image *as a document* | Same, `image/jpeg` | Accepted; stored with `.jpg`; it never appears in the photo gallery | No error expected |
| Rejected type | `text/plain`, name `notes.txt` | `400 validation_error` "Invalid document type" | Route is authoritative; client pre-check gives the same reason first |
| Over 10 MB, honest `content-length` | 25 MB PDF | `400 validation_error` with the **size** message | `declaredBodyExceedsFileLimit` runs before `formData()`, so it is not reported as `invalid_form_data` |
| Over 10 MB, no `content-length` | 12 MB PDF | `400 validation_error` size message | `file.size > MAX_FILE_SIZE_BYTES` check |
| 11th document on one entry | Entry already has 10 rows | `400 validation_error` "Document limit reached"; the file just written is removed | Repository returns `"limit_reached"`; route maps it and calls `fs.rm(filePath, { force: true })` |
| Hostile file name | `file.name = "../../etc/passwd"` | Stored `fileName` is `passwd`; on-disk name is the generated `doc-…` | Basename only; separators, `.`/`..` segments and control characters stripped/rejected; empty after trim → 400; capped at 255 chars |
| Delete a document | `DELETE` with a valid `documentId` | Row gone **and** file unlinked | Row is read *before* deletion so the URL survives; `ENOENT` on unlink is swallowed, anything else rethrows |
| Delete when the file is already gone | Row exists, file missing | `ok({ deleted: true })` | `ENOENT` swallowed |
| Non-owner / no session / no CSRF | Contributor, anonymous, missing header | 404 / 401 / 403 respectively | Same shapes the image routes return |
| Open a PDF from a chip | Authenticated `GET /uploads/trips/<id>/…/documents/doc-….pdf` | `200`, `content-type: application/pdf`, `content-disposition: inline` | Unauthenticated → 401; no read access → 404 |
| Export a trip with documents | Trip has 2 stay documents, 1 activity document | Archive holds `documents/d1.pdf`, `d2.…`, `d3.…` after the photo members; manifest refs carry `{ sortOrder, documentId, fileName }` | A document whose file is missing is dropped with a `meta.warnings` line |
| Import that archive | The archive above | Documents back on the same entries, same names, same order; `documentCount` in the success summary | A `documents/` member no pool entry claims → `validation_error`; bytes matching no allow-listed signature → `validation_error` |
| Import a v1 backup | v1 JSON, no `documents` key | Imports exactly as today | `documents` defaults `[]`/`{}` |
| Import a documents-free v2 package | Today's archive | Byte-for-byte the same result as today | Additive-optional fields only |

</intent-contract>

## Code Map

**Data**
- `prisma/schema.prisma:239-267` -- `AccommodationImage` / `DayPlanItemImage`, the exact shape to mirror; back-relations at `:190` and `:212`
- `prisma/migrations/20260215123500_add_item_image_galleries/migration.sql` -- the SQLite house style (`CREATE TABLE` ×2, then `CREATE INDEX` / `CREATE UNIQUE INDEX` ×2, `ON DELETE CASCADE ON UPDATE CASCADE`)
- `scripts/check-migration-immutability.sh` -- enforces `^<14 digits>_[a-z0-9_]+/migration\.sql$` and refuses any edit to an existing migration

**Upload plumbing**
- `src/lib/trips/uploadPaths.ts:94,97` -- `getAccommodationImageUploadDir(tripId, dayId, accommodationId)` / `getDayPlanItemImageUploadDir(tripId, dayId, dayPlanItemId)`; `resolveStoredMediaPath:133`; DW-22 header
- `src/lib/trips/imageUploads.ts` -- the accept/gate module to mirror field for field
- `src/lib/http/bodyLimit.ts` -- `declaredBodyExceedsFileLimit`
- `next.config.ts` -- `proxyClientMaxBodySize: "20mb"` and the comment's route inventory ("the four image upload routes, and only them")

**API**
- `src/app/api/trips/[id]/accommodations/images/route.ts` -- the whole reference pattern, including the local `requireCsrf` / `parseJson` / `removeManagedFile` helpers
- `src/app/api/trips/[id]/day-plan-items/images/route.ts:67-109` -- the day-wide `GET` branch (`tripDayId` required, `dayPlanItemId` optional)
- `src/app/uploads/[...path]/route.ts:51-71` -- `CONTENT_TYPE_BY_EXTENSION`; **its docblock already names this story as the one that adds `pdf`**
- `src/lib/validation/imageGallerySchemas.ts` -- schema shape to mirror

**Repositories**
- `src/lib/repositories/accommodationRepo.ts:99-132` (scope helpers), `:452-516` (list/create/delete)
- `src/lib/repositories/dayPlanItemRepo.ts:197-230` (scope helpers), `:747-831` (list, `listDayPlanItemImagesForTripDay`, create, delete)

**UI**
- `src/components/features/trips/TripDayPlanItemContent.tsx:174-272` -- `MiniImageStrip`; the cap is a bare literal `3`; the `+N` `Typography component="button"` with `minWidth/minHeight: 44` and the singular/plural `aria-label` ternary
- `src/components/features/trips/TripDayView.tsx:304` (`GalleryImage`), `:444-446` (gallery state), `:1156-1239` (`loadImages`), `:1636-1642` (`overlaidContentSx`, the `"& a, & button"` opt-in), `:2740`, `:2916`, `:3066` (the three `pointerEvents: "auto"` strip wrappers), `:3363` (the single `FullscreenPhotoViewer` mount)
- `src/components/forms/PhotoUploadField.tsx` -- dropzone geometry, the stretched transparent `<input type="file">`, the `aria-describedby` scheme, the 44px remove target; **and DW-52's missing `event.target.value = ""`**
- `src/components/features/trips/TripAccommodationDialog.tsx:76` (`STAY_TAB_IDS`), `:266` (`STAY_PANEL_MIN_HEIGHT`), `:372` (`galleryFiles`), `:558-562` (open-effect reset), `:1192-1279` (upload/delete), `:1345-1367` (`useDiscardGuard`), `:1757-1829` (media panel — link **then** gallery)
- `src/components/features/trips/TripDayPlanDialog.tsx:89` (`PLAN_TAB_IDS`), `:473-524` (`pendingPhotoCount` + `planFormFingerprint`), `:1227-1252` (`currentFingerprint`), `:1430-1520` (upload/delete), `:2084-2153` (media panel — gallery **then** link)
- `src/components/features/trips/TripIcons.tsx:258-267` -- `UploadIcon`, the inline-SVG pattern; `IconProps` at `:27` is module-private; there is **no** file glyph
- `src/theme.ts:222-238` -- `palette.tokens.pillNeutral` already exists; `rounded.sm` (4px) has no token surface, write it as a literal

**Backup**
- `src/lib/repositories/tripRepo.ts:1260-1279` (extension map), `:217-225` (`TripExportPhoto`, `TripExportImageRef`), `:1320-1403` (include tree), `:1409-1441` (pool state + `warnOnce` / `warnGalleryDropOnce`), `:1443-1475` (`resolveOwnedPhotoPath`), `:1477-1573` (`registerPhoto`, `registerGallery`, traversal order), `:351-374` (`ImportTripSuccessResult`), `:2353-2416` (post-commit disk phase)
- `src/app/api/trips/[id]/export/route.ts:19,79-91` -- `FORMAT_VERSION`, the fixed entry order, the deterministic zip timestamp
- `src/lib/trips/importPackage.ts:42-46` (prefixes), `:148-166` (`isArchiveBookkeeping`), `:188-270` (`openImportPackage` triage), `:309-345` (signatures/sniffer), `:347-436` (`validatePackagePhotos`)
- `src/lib/trips/importPhotos.ts:11-37` (the "never use a package filename" header), `:70-87` (`generateGalleryFileName`), `:89-133` (`planAccommodationGalleryPhoto` / `planDayPlanItemGalleryPhoto`), `:135-226` (write phase, stash/restore)
- `src/lib/validation/tripImportSchemas.ts:111-164` (v2 additive block, `imagesSchema` superRefine), `:391-414` (`formatVersion` bound), `:451-471` / `:521-539` / `:670-676` / `:709-735` (photo reference walk and caps)
- `src/lib/trips/importLimits.ts` -- every ceiling and its reasoning
- `src/components/features/trips/TripImportDialog.tsx:40-49,396-423` -- the four-cell success summary

**i18n**
- `src/i18n/en.ts:619-640` / `src/i18n/de.ts` -- flat dotted keys; the `trips.gallery.*` block to insert after
- `test/i18nDictionaries.test.ts` -- exact key-set equality, no empty values

## Tasks & Acceptance

**Execution:**

- [ ] `prisma/schema.prisma` -- add `AccommodationDocument` and `DayPlanItemDocument` after `DayPlanItemImage` (`:267`), identical to their image twins plus `fileName @map("file_name")`, with `@@index` maps `idx_accommodation_documents_accommodation_id` / `idx_day_plan_item_documents_item_id` and `@@unique` maps `idx_accommodation_documents_order` / `idx_day_plan_item_documents_order`; add `documents` back-relations beside `images` on `Accommodation` and `DayPlanItem` -- AC1, AC1a
- [ ] `prisma/migrations/<yyyymmddHHmmss>_add_item_document_galleries/migration.sql` -- one new migration modelled on the image-gallery one, same statement order and FK spelling -- immutability is enforced by `npm run check:migrations`
- [ ] `src/lib/trips/uploadPaths.ts` -- add `getAccommodationDocumentUploadDir` / `getDayPlanItemDocumentUploadDir`, each **composed from** its image-dir twin plus a `documents` segment, so a directory walk can never mistake a document for a photo -- AC3
- [ ] `src/lib/trips/documentUploads.ts` -- NEW, mirroring `imageUploads.ts`: `DOCUMENT_UPLOAD_ACCEPT = "application/pdf,image/jpeg,image/png,image/webp"` (registered MIME types only), `isSupportedDocumentUpload` (MIME set + extension fallback, same two-step shape), `documentDisplayName(fileName)` (strips exactly the final extension) -- AC3, AC4
- [ ] `src/lib/validation/documentGallerySchemas.ts` -- NEW, mirroring `imageGallerySchemas.ts`; upload and delete schemas only, no reorder
- [ ] `src/lib/repositories/accommodationRepo.ts` -- add `listAccommodationDocuments` / `createAccommodationDocument` / `deleteAccommodationDocument`, reusing `findScopedAccommodationForTripParticipant` for the read and `findScopedAccommodation` for the writes unchanged; `sortOrder = (last?.sortOrder ?? 0) + 1`; create returns a `"limit_reached"` outcome at 10 existing rows -- AC1, AC2, AC7
- [ ] `src/lib/repositories/dayPlanItemRepo.ts` -- the same three plus `listDayPlanItemDocumentsForTripDay`, twinning `listDayPlanItemImagesForTripDay` so the day view fetches every activity's documents in one request -- AC1, AC2, AC7
- [ ] `src/app/api/trips/[id]/accommodations/documents/route.ts` -- NEW `GET`/`POST`/`DELETE`, structurally copied from the sibling images route; `MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024`, `ALLOWED_TYPES = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }`; sanitise and store `fileName`; roll back the file on a failed insert and on `limit_reached` -- AC2, AC3, AC7
- [ ] `src/app/api/trips/[id]/day-plan-items/documents/route.ts` -- NEW, the same plus the day-wide `GET` branch -- AC2, AC3, AC7
- [ ] `src/app/uploads/[...path]/route.ts` -- add `pdf: "application/pdf"` to `CONTENT_TYPE_BY_EXTENSION` and set `content-disposition: inline` when the resolved type is `application/pdf`. **Its own docblock names this story as the one that does it.** Without it a PDF is served `application/octet-stream` with `content-disposition: attachment` and downloads instead of opening -- AC6
- [ ] `next.config.ts` -- extend the comment's route inventory to name the two document routes at 10 MB. The number does not move: 10 MB sits below the existing 15 MB day-image route
- [ ] `src/components/features/trips/TripIcons.tsx` -- add `DocumentIcon` in the existing inline-SVG pattern (`SvgIcon`, `aria-hidden`, `viewBox="0 0 24 24"`, the `sx` array merge). No icon library -- AC4
- [ ] `src/components/ui/DocChip.tsx` -- NEW shared primitive used by both the timeline card and the dialog field: `minHeight: 44` (with the `&&` bump if it lands on a MUI component), `borderRadius: "4px"`, `backgroundColor: tokens.pillNeutral`, ~14px `DocumentIcon`, label single-line `maxWidth: 160` with `overflow: hidden` / `textOverflow: "ellipsis"` / `whiteSpace: "nowrap"`. Renders as `<a href={documentUrl} target="_blank" rel="noreferrer noopener">` so `overlaidContentSx`'s `"& a, & button"` opt-in restores its pointer events for free -- AC4, AC5, AC6
- [ ] `src/components/features/trips/TripDayView.tsx` -- declare a local `GalleryDocument` row type beside `GalleryImage` (per-component, as the existing convention is); add `accommodationDocuments` / `previousAccommodationDocuments` / `planItemDocumentsById` state; extend the `loadImages` effect with the three document fetches in the same tolerant shape; at each of the three `variant="strip"` sites wrap the strip and a new chip group as two flex children of one `display: flex; flexWrap: "wrap"` media row, each inside a `pointerEvents: "auto"` wrapper; give the chip group `minWidth: DOC_ROW_MIN_WIDTH` and `flexWrap: "wrap"` so it wraps **as a group**, never truncating to one chip; cap rendered chips at three and reuse the strip's `+N` control, which opens a MUI `Menu` of **every** document's name, each an anchor -- AC4, AC5, AC6
- [ ] `src/components/forms/DocumentUploadField.tsx` -- NEW sibling of `PhotoUploadField`, reusing its dropzone geometry and `aria-describedby` scheme but rendering `DocChip` rows with 44px remove buttons instead of a thumbnail strip. **Reset the file input after `onFilesSelected` (`event.target.value = ""`)** — DW-52 is open against `PhotoUploadField` for exactly this and a second copy must not ship -- AC2, AC7
- [ ] `src/components/features/trips/TripAccommodationDialog.tsx` -- inside `activeTab === "media"`, below the photo gallery and gated on `day?.accommodation` the same way, add the document field with a label visibly distinct from `trips.gallery.title`; add `documentFiles` / `documents` / `documentBusy` state, `uploadDocuments` and `deleteDocument` mirroring the gallery pair including the CSRF flow and the client-side pre-check; add `|| documentFiles.length > 0` to the `useDiscardGuard` expression and extend its docblock; clear `documentFiles` in the open effect beside `setGalleryFiles([])` -- AC2, AC7
- [ ] `src/components/features/trips/TripDayPlanDialog.tsx` -- the same inside `activeTab === "media"`, gated on `editingItemId`, with its own add-mode explanation; add `pendingDocumentCount: documentFiles.length` to `PlanFormValues`, to `planFormFingerprint` and to `currentFingerprint`'s dependency array — **`.length`, never the array** -- AC2, AC7
- [ ] `src/lib/repositories/tripRepo.ts` -- export side: nested `documents: { select: { documentUrl, fileName, sortOrder }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }` on both includes; a **separate** `documents` pool with a `documents/` prefix and `d1`, `d2`, … ids; `TripExportDocumentRef = { sortOrder, documentId, fileName }`; reuse `resolveOwnedPhotoPath` verbatim for containment; extension map adds `pdf → application/pdf`; drops warn through the same `meta.warnings` channel; entry order stays manifest → photos → documents -- AC8
- [ ] `src/app/api/trips/[id]/export/route.ts` -- append the document members after the photo members in pool order; `FORMAT_VERSION` stays `2`; note in the comment that a build predating this story rejects an archive containing documents, and why that is the accepted cost of additive growth -- AC8
- [ ] `src/lib/trips/importPackage.ts` -- teach `openImportPackage` the `documents/` prefix and hand back a second lazy source, keeping the closed-list rule; add `sniffDocumentContentType` (`%PDF-` = `25 50 44 46 2D`, plus the three image signatures) **separate from** `sniffPhotoContentType`; add `validatePackageDocuments` mirroring `validatePackagePhotos` in both directions -- AC8
- [ ] `src/lib/trips/importLimits.ts` -- add `MAX_IMPORT_DOCUMENT_BYTES = 10 * 1024 * 1024` documented the way `MAX_IMPORT_PHOTO_BYTES` is; update the `MAX_IMPORT_PHOTO_WRITES` and `MAX_IMPORT_PHOTO_TOTAL_BYTES` docblocks to say they now cover documents too -- AC8
- [ ] `src/lib/trips/importPhotos.ts` -- add `planAccommodationDocument` / `planDayPlanItemDocument` beside the gallery planners, extension from the **sniffed** type, name generated `doc-…` server-side; the manifest's `fileName` never becomes a path segment -- AC8
- [ ] `src/lib/validation/tripImportSchemas.ts` -- a `documentsSchema` mirroring `imagesSchema` including the per-owner `sortOrder` superRefine, plus a `fileName` rule (trim, 1–255, no path separators, no control characters); `documents` pool record; extend the reference walk and the write-count cap to documents; every new field `.optional()` with a default -- AC8
- [ ] `src/lib/repositories/tripRepo.ts` (import side) + `src/app/api/trips/import/route.ts` + `src/components/features/trips/TripImportDialog.tsx` -- plan and write document files in the post-commit phase (rollback already covers them, since they sit inside the trip upload dir); add `documentCount` beside `photoCount` in `ImportTripSuccessResult`, the success envelope and the dialog summary -- AC8
- [ ] `src/i18n/en.ts`, `src/i18n/de.ts` -- a `trips.documents.*` block inserted after `trips.gallery.*` in both: field label (distinct from `trips.gallery.title`), upload-zone title, a size/format hint stating 10 MB and PDF/JPEG/PNG/WebP, selected-files line, empty line, upload action, remove label, `openDocument`, `showMoreDocuments` **plus its `…One` singular twin**, `unsupportedFormat`, `limitReached`, `uploadError`, `deleteError`, and a `documentsAfterSave` line for each dialog's add mode. Separate keys from `trips.gallery.*` even where the English coincides -- AC9
- [ ] `test/` -- the suites enumerated under Verification below, covering every row of the I/O matrix -- all ACs
- [ ] `_bmad-output/implementation-artifacts/deferred-work.md` -- add a line to DW-45 recording that documents make 10 MB the fourth distinct stated limit; log a new candidate for the owner-only gallery/document write gate sitting oddly beside Story 5.4's "contributor full edit"
- [ ] **Browser measurement pass** -- `DOC_ROW_MIN_WIDTH` ships as a **measured** number with a measurements-table comment, not as arithmetic. Drive a production build with headless Chrome over CDP against a throwaway database and a scratch `MEDIA_STORAGE_ROOT`, exactly as Story 8.3's Task 8 did; never touch `prisma/dev.db` or the real media tree -- AC2, AC4, AC5, AC6

**Acceptance Criteria:**

- Given an entry with three photos and three documents, when the day view renders at 390×844, then the chip group wraps to its own row below the photo strip as a whole group and never truncates to a single chip; at desktop width the chips trail on the same row as the strip.
- Given an entry with more than three documents, when the card renders, then exactly three chips plus the strip's own `+N` control appear, and activating `+N` opens a list of **every** document's name — not `FullscreenPhotoViewer`.
- Given a document whose file is a JPEG, when its chip is activated, then it opens in a new tab and `FullscreenPhotoViewer` does not mount.
- Given two documents on one entry sharing a file name, when the card renders, then the two chips carry distinguishable accessible names (position within the entry) while the visible labels stay the bare names.
- Given the `Medien & Links` tab of either dialog, when it is opened, then the document field's label is visibly distinct from the photo field's, and a file placed in one bucket never appears in the other.
- Given a staged-but-unsaved document, when the dialog is dismissed, then the discard guard fires exactly once; and given an untouched dialog, it does not fire at all.
- Given staged documents, when the user switches tabs and comes back, then the staged selection survives.
- Given a dialog that is closed with staged documents discarded, when it is reopened, then no document is still selected.
- Given a trip with documents on a stay and on an activity, when it is exported and re-imported, then the documents come back on the same entries with the same names and the same order, and one of the restored PDFs opens.
- Given a v1 JSON backup or a documents-free v2 package, when it is imported, then the result is identical to today's.
- Given every user-facing string added, when `i18nDictionaries.test.ts` runs, then the two dictionaries hold exact key-set equality with no empty values.

## Spec Change Log

## Review Triage Log

### 2026-08-06 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 7: (high 1, medium 2, low 4)
- defer: 8: (high 0, medium 7, low 1)
- reject: 1: (high 0, medium 0, low 1)
- addressed_findings:
  - `[high]` `[patch]` `tripDayId` / entity id reached `path.join` with no segment check, and `POST` builds the entry's `documents` directory *before* the repository confirms the entry exists — so a traversal in either field created directories outside `MEDIA_STORAGE_ROOT` and wrote a file into them, and the failed insert removed only the file. Fixed by validating both as single safe path segments in `documentGallerySchemas.ts`, reusing `uploadPaths.ts`'s own `isSafeMediaSegment` rather than restating it; asserted at the filesystem boundary in both route suites, because a 400 alone does not prove the refusal preceded `fs.mkdir`.
  - `[medium]` `[patch]` `ALLOWED_TYPES[file.type]` was both weaker and stricter than the client gate it claims to mirror: an index lookup on an object literal reaches `Object.prototype`, so `file.type = "constructor"` returned a truthy *function* and bypassed the allow-list, while a case variant (`APPLICATION/PDF`) or a browser reporting no type at all was refused after `isSupportedDocumentUpload` had accepted it on the file name. Replaced in both routes with a `resolveUploadExtension` modelled on `days/[dayId]/image/route.ts`: lowercased MIME, `hasOwnProperty`, then the name-extension fallback.
  - `[medium]` `[patch]` The import writes document rows directly inside its transaction and never calls the repository creates, so the "cap enforced in the repository, not only in the UI" invariant had an uncapped second writer — a hand-edited manifest could land hundreds of rows on one stay and leave the entry permanently full. Added `.max(MAX_DOCUMENTS_PER_ENTRY)` to `documentsSchema`. The existing write-cap test piled 4998 documents on one entry to prove the shared disk budget; refixtured onto photos (which have no per-entry cap) so it still proves that a document costs a write, without going green on the wrong rule.
  - `[low]` `[patch]` `sanitizeDocumentFileName` truncated by UTF-16 code unit, so a 255-unit cut landing between the halves of an astral character stored a lone surrogate — U+FFFD in the chip, a bare `\udXXX` escape in the backup, and a name Story 9.2 will print onto a PDF page. The trailing half is now dropped.
  - `[low]` `[patch]` The chip row's `+N` promised a popup with `aria-haspopup="menu"` and never reported whether it was open, so it announced the same thing in both directions. Added `aria-expanded`, keyed on which entry opened the one shared `Menu` mount; `aria-controls` deliberately omitted, since the list does not exist while the menu is closed.
  - `[low]` `[patch]` Four callbacks in the two dialogs bound `document` as a parameter in files whose error-focus effects call `document.getElementById` — the exact trap the change's own comment in `TripDayView.tsx` warns against. Renamed to `documentRow`.
  - `[low]` `[patch]` Three comments stated something untrue: the loader's "Five requests" (it makes six), and `importPhotos.ts` naming `validatePackageDocuments` as the guard that ran when production calls `validatePackageMedia`. Corrected, and `validatePackageDocuments`' docblock now says what its twin's already did — that the route does not call it.

### 2026-08-06 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 5: (high 0, medium 1, low 4)
- defer: 3: (high 1, medium 1, low 1)
- reject: 7: (high 0, medium 5, low 2)
- addressed_findings:
  - `[medium]` `[patch]` Both dialogs discriminated the one actionable upload failure by matching the route's bare English literal `"Document limit reached"`, with nothing linking the four sites. The routes answer `validation_error` for a rejected type, an oversized file, an unusable name **and** the cap, so the message is the only discriminator — and a reword on the route side would have silently downgraded "up to 10 per entry" to "please try again", an instruction to retry a condition retrying cannot fix, with every test still green. Replaced with `DOCUMENT_LIMIT_ERROR_MESSAGE` exported from `documentUploads.ts`, which both routes and both dialogs already import.
  - `[low]` `[patch]` The whole-package media-write budget reported its overflow at `path: ["photos"]`, although `requirePooledDocument` increments the same counter — so a manifest overflowing it on documents alone pointed the reader at a pool that can be empty. Now `path: []`, the package itself, with the shared budget named in a comment.
  - `[low]` `[patch]` The chip group's `minWidth: DOC_ROW_MIN_WIDTH` clamps the flex item's used main size **up**, so `space-between` right-aligns the group's 210px box while the chips are left-packed inside it — a single 63.81px chip ends ~146px short of the card's right edge at 1280px, and the declaration's comment claimed DESIGN.md `:160`'s right-alignment outright. The layout is left as shipped: the `min-width` that decides *whether* the group wraps is the same thing that stops it shrink-wrapping once it has not, and `justifyContent: "flex-end"` would indent the *wrapped* group ~134px from the left at 390px — a larger deviation than the one it fixes. The comment now states what the declaration actually delivers, why the obvious override is worse, and that the container-query fix is DW-193. **Recorded as a patch because that is the action this pass took; the residual visual gap is tracked as DW-193 rather than left in a comment alone.**
  - `[low]` `[patch]` `MAX_DOCUMENTS_PER_ENTRY` became a backup-compatibility constraint when the previous pass applied it as `.max()` on the manifest — lowering it would refuse every backup already written from an entry carrying more than the new value, including backups this build produced. Recorded at both ends: the constant's own docblock (where a change would be attempted) and `documentsSchema`'s.
  - `[low]` `[patch]` Four comments and citations stated something untrue. `uploadPaths.ts` named "the export pool builder" as a directory walk that relies on the `documents/` separation — nothing in `src/` calls `readdir` at all, and the export builder walks Prisma rows; `documentsSchema`'s docblock described "500 rows on one stay" in the indicative as current behaviour when the `.max()` on the next line closes it; `TripIcons.tsx` cited `DESIGN.md:157` (`bg`) for the 14px glyph size, which is `:158`; `DocumentUploadField.tsx` cited `:266` (trip-row prose) for the 44px floor, which is `:155`.
  - Deferred as new ledger entries: DW-194 (removing a day image `fs.rm`s the whole day upload tree, destroying every gallery photo and document on that day with the rows intact — pre-existing for photos, far costlier now), DW-195 (a non-`ENOENT` unlink error is rethrown after the row has committed, so the user is told "removal failed" for media that is gone), DW-196 (`fs.mkdir` runs before the repository confirms the entry exists, leaving empty directory trees on `not_found`). All three are byte-identical in shape on the image routes the spec required these to be copied from, and all three want a fix scoped to all four media routes.
  - Rejected: four findings restating already-open entries (DW-185 stale media loader, DW-188 non-transactional cap and P2002, DW-189 upload trusts the declared MIME while the import sniffs bytes — including the zero-length-file variant, DW-191 test-only pool validators); `FORMAT_VERSION` staying `2`, which the intent contract mandates and the export route's comment already argues; the two enforced limits appearing as literals in the German and English strings, which is the app-wide convention and lands with DW-45's limit reconciliation; and a partial upload leaving its unsent tail staged, which is deliberate so the tail can be retried.

## Design Notes

**Decisions carried in** (answered by Tommy on 2026-08-05, recorded in the story's Dev Agent Record — do not re-ask):

1. **The 8.3 dependency** — satisfied. `8-3-uploaded-media-behind-the-login: done`. Media lives outside `public/`, `src/app/uploads/[...path]/route.ts` authorises every read with `hasTripReadAccess`, and it takes `tripId` from `segments[1]`, so a `…/documents/<file>` URL is covered with no URL change, no migration and no component change. Verified against HEAD, not taken on trust.
2. **`+N` overflow surface** — a MUI `Menu` anchored on the control, not a `DialogShell` list.
3. **Contributor writes** — mirror the image routes exactly (owner-only writes via `hasTripOwnerAccess`) and log a deferred-work candidate for the inconsistency with Story 5.4. Do not diverge documents from photos on the same tab.
4. **DW-45** — Tommy's recorded answer was to fold the four-limit reconciliation (5/5/15/10 MB) into this story, which directly contradicts the story's own Task 9 ("do not attempt the reconciliation here"). **It is not done here**, for two reasons that are about specification rather than preference: no target value was ever named, and it would change the behaviour of four pre-existing upload surfaces that carry no acceptance criterion in this story. The DW-45 note is added as Task 9 specifies; the reconciliation needs `bmad-correct-course` and its own ACs. This is called out in the Completion Notes rather than smuggled in under a bullet that says the opposite.

**The one thing the story file misses.** `src/app/uploads/[...path]/route.ts`'s `CONTENT_TYPE_BY_EXTENSION` is a closed three-entry map, and its docblock says in as many words: *"Story 9.1 adds `pdf` -> `application/pdf` with `Content-Disposition: inline`."* Story 9.1's own task list never mentions it. Left undone, an uploaded PDF is served `application/octet-stream` with `content-disposition: attachment` — it downloads rather than opening, which fails the "opens inline in a new tab, all pages legible" criterion while every unit test still passes. It is one map entry and one conditional header, and it belongs in Task 4.

**Why `fileName` is a column.** The chip's label is the document's name and the backup must round-trip it. The on-disk name is `doc-<ts>-<rand>.<ext>` and carries no trace of what the user called the file, so the name has to be stored. It is rendered in the UI and will label PDF pages in Story 9.2, which is why its validation is strict at both entry points (upload route and import schema) and why it is never, at either one, a path segment.

**Why the wrap is CSS and not a measurement.** AC4 asks for "beside the strip while at least two chips fit, otherwise below it". A `ResizeObserver` would make that a runtime computation; a single `minWidth: DOC_ROW_MIN_WIDTH` on the chip group inside a wrapping flex row gets the same behaviour from the layout engine and reduces the threshold to one named constant. Two limits stay deliberately apart: **how many chips render** is a fixed cap of three (the strip's own), a deterministic number a test can assert; **where the group sits** is `DOC_ROW_MIN_WIDTH`, and it is the only thing the browser pass measures. `STAY_PANEL_MIN_HEIGHT` is the precedent — Story 6.26 found its arithmetic wrong twice over and it shipped as a measured 400.

**Why an anchor and not a button.** `overlaidContentSx` on the timeline card sets `pointerEvents: "none"` with an `"& a, & button"` opt-in. An `<a href target="_blank">` is therefore keyboard- and AT-reachable and pointer-live over the card's stretched edit overlay with no extra wiring — the same mechanism the existing `linkUrl` control relies on.

**React Compiler is on and bails out loudly.** Story 6.26 recorded two edits that silently stopped a whole component compiling: writing a `useRef` from a callback `handleSubmit` invokes during render, and reading a `useMemo`'d value from a closure declared earlier in the body. Both surfaced only in `eslint`. If lint output changes shape, diff against `git show HEAD:<file>`.

## Verification

**Commands** (all run in `travelplan/`):
- `npx tsc --noEmit` -- expected: 0 `src/` errors; test-side errors must not exceed the 143 baseline
- `npm run lint` -- expected: no growth beyond the 85 problems / 2 pre-existing errors baseline
- `npm run check:migrations` -- expected: pass; the new migration is the only added file and matches the required name shape
- `npm test` -- expected: green, with the baseline (1404 tests / 120 files) plus the new suites and no weakened assertion
- `npm run audit:check` -- expected: 0 vulnerabilities; no new dependency was added

**New and extended suites:**
- `test/tripAccommodationDocumentsRoute.test.ts`, `test/tripDayPlanItemDocumentsRoute.test.ts` -- every row of the I/O matrix's route half, modelled on the image-route suites
- `test/documentUploadAccept.test.ts` -- mirrors `imageUploadAccept.test.ts`: registered MIME types only, no hand-rolled accept string in the component tree, agreement with the routes' `ALLOWED_TYPES`, and `documentDisplayName` stripping exactly the final extension (several dots, and none)
- `test/documentGalleryRepo.test.ts` -- scoping admits owner and contributor on read and owner only on write, `sortOrder` appends, cascade delete when the parent goes, and the 10-row cap
- `test/uploadsServeRoute.test.ts` -- extend: a `.pdf` is served `application/pdf` with `content-disposition: inline`, and the image cases are unchanged
- `test/tripAccommodationDialog.test.tsx`, `test/tripDayPlanDialog.test.tsx` -- the field is on the media tab with a label differing from the photo field's; staged documents survive a tab round trip; the discard guard fires exactly once and not at all for an untouched dialog; add mode explains the absence. **`tripDayPlanDialog.test.tsx` mocks `@mui/material` wholesale and that mock has drifted (DW-53)** — any assertion depending on real MUI behaviour goes in the accommodation suite or a focused new file, and the Completion Notes say which suite proved what
- `test/tripDayViewLayout.test.tsx` or a new `test/docChip.test.tsx` -- extensionless ellipsised labels; `+N` past the cap opening a name list; **activating an image document does not mount `FullscreenPhotoViewer`** (assert the negative); each chip is an anchor with `target="_blank"` and `rel="noreferrer noopener"`; no chip row when there are no documents; two same-named documents get distinguishable accessible names
- `test/tripBackupRoundTrip.test.ts` -- documents round-trip with names, owners and order, **plus** the two negatives (v1 JSON, documents-free v2)
- `test/tripImportPackage.test.ts` -- a `documents/` member is accepted; a member under neither prefix is still refused; an unclaimed document member is refused; a document that is neither PDF nor an allow-listed image is refused; a wrong CRC still surfaces as `validation_error`
- `test/tripImportSchemas.test.ts` -- `fileName` bounds, duplicate `sortOrder` refused, unknown `documentId` refused, absent `documents` defaults empty
- `test/tripExportRoute.test.ts` -- `documents/…` members in pool order, refs carrying `fileName`, byte-identity for an unchanged trip still holding
- `test/uploadPaths.test.ts` -- must still pass; add the two document helpers to whatever it enumerates (it fails if any path resolves inside the repo's `public/`)
- `test/i18nDictionaries.test.ts` -- green

**Browser pass (measurement, not a smoke test):** production build, throwaway database copy, scratch `MEDIA_STORAGE_ROOT`, headless Chrome over CDP. At **390×844** and at desktop width, on a card with three photos and one, two and three documents: read the media row and chip geometry, **correct `DOC_ROW_MIN_WIDTH` against what comes back**, and rewrite its comment as a measurements table. Confirm every chip and the `+N` measures ≥44px **at both widths**. Confirm a real multi-page PDF opens inline in a new tab with all pages legible, and that a portrait photo uploaded *as a document* opens in a new tab without mounting the fullscreen viewer. Confirm the German labels for the two media fields fit their column and read as two different things. Export, delete, re-import, and open one of the restored PDFs. Then stop the server, delete the scratch files, and confirm `prisma/dev.db`'s hash is unchanged and nothing was written to the real media tree.

## Auto Run Result

Status: done
Blocking condition: none

**What this run was.** A follow-up review pass over the whole of Story 9.1 (`7d9f661` → HEAD, 62 files, 12,098 insertions), requested because the previous pass recommended one. No spec repair and no intent gap: the second reading confirmed the feature as specified and found no deviation from the intent contract.

**What the feature is.** Documents on stays and activities, end to end: two tables mirroring the image galleries plus a `fileName` column, two upload routes, PDF serving with `content-disposition: inline`, a shared `DocChip` on the three timeline cards with a three-chip cap and a `+N` menu, a `DocumentUploadField` on both dialogs' `Medien & Links` tab, and a separate `documents/` pool through the v2 backup archive in both directions. `FORMAT_VERSION` stays `2` and every new manifest field is `.optional()` with a default, so a v1 JSON backup and a documents-free v2 package import exactly as before.

**Files changed in this pass** (7 source files, no test changes — every patch is behaviour-preserving or comment-only, and the existing 1,539 assertions cover them unchanged):
- `src/lib/trips/documentUploads.ts` — new exported `DOCUMENT_LIMIT_ERROR_MESSAGE`; `MAX_DOCUMENTS_PER_ENTRY`'s docblock now records that lowering it breaks existing backups
- `src/app/api/trips/[id]/accommodations/documents/route.ts`, `.../day-plan-items/documents/route.ts` — the cap refusal answers with the shared constant
- `src/components/features/trips/TripAccommodationDialog.tsx`, `TripDayPlanDialog.tsx` — match on the shared constant instead of a bare literal
- `src/lib/validation/tripImportSchemas.ts` — media-write overflow reported against the package rather than the `photos` pool; `documentsSchema`'s docblock rewritten so it reads as the cap's justification rather than as a description of a hole the next line closes
- `src/components/features/trips/TripDayView.tsx` — the media row's alignment comment now states what `space-between` plus a clamped `min-width` actually delivers, and why the obvious override is worse
- `src/lib/trips/uploadPaths.ts` — the `documents/` rationale no longer claims an existing directory walk depends on it; nothing in `src/` calls `readdir`
- `src/components/features/trips/TripIcons.tsx`, `src/components/forms/DocumentUploadField.tsx` — two DESIGN.md line citations corrected
- `_bmad-output/implementation-artifacts/deferred-work.md` — DW-193 … DW-196 appended as new entries; no existing entry touched

**Review findings.** Two adversarial reviewers ran in parallel over the full diff (generated Prisma client excluded); 15 findings after dedup. 5 patched, 3 deferred, 7 rejected, 0 intent gaps, 0 spec repairs. Every claim was re-verified against the tree before triage, and two reviewer claims did not survive it: the day-image `fs.rm` and the pre-`create` `fs.mkdir` were both presented as new hazards, and both are byte-identical in the image routes at the baseline — they are recorded as pre-existing (DW-194, DW-196) rather than as this story's defects. Four findings were rejected as restatements of entries this feature's earlier passes already opened (DW-185, DW-188, DW-189, DW-191).

**Verification** (all in `travelplan/`):
- `npx tsc --noEmit` — 0 `src/` errors; 143 test-side errors, exactly the recorded baseline
- `npm run lint` — 85 problems / 2 errors, exactly the baseline; no React Compiler bail-out
- `npm test` — 126 files / 1,539 tests green, unchanged from the previous pass; no assertion weakened, none added
- `npm run check:migrations` — passed
- `npm run audit:check` — **1 high, not 0**: `fast-uri` through `prisma`. `package.json` and `package-lock.json` are byte-identical to baseline `7d9f661`, so this is DW-183 and is not duplicated.

**Residual risks.**
- The browser measurement pass that produced `DOC_ROW_MIN_WIDTH` ran two passes ago and was not repeated: no patch in this pass alters a rendered value, and the one layout-adjacent finding (DW-193) was deliberately left as shipped. That pass measured the wrap decision at eleven widths and never measured chip alignment inside the group, which is how DW-193 survived it.
- DW-194 is the heaviest open item reachable from this feature: one click on "remove day image" unlinks every photo and every document on that day with the rows left intact. It predates the story and predates the galleries' current shape, but documents raise the cost per occurrence to up to 10 MB of irrecoverable booking confirmations.
- DW-185, DW-188, DW-189, DW-195 and DW-196 are open and reachable from the shipped feature. All five are shapes shared with the image galleries and all five want one change scoped to all four media routes, not a documents-only fix.
- `_bmad-output/implementation-artifacts/6-27-a-comma-is-a-decimal-point.md` is untracked and belongs to a different story; it was left alone and is not in this commit.
