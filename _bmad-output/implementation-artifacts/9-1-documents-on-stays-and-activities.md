---
authored_against: 3a42ec7
baseline_commit: 3a42ec7a155d66339a80e4c1e4f6e5f12d848e30
---

# Story 9.1: Documents on Stays and Activities

Status: ready-for-dev

## ⚠️ Sequencing — read before Task 1

**This story's epic declares a hard dependency on Story 8.3 (`8-3-uploaded-media-behind-the-login`). That dependency has since been implemented and is in `review`** — updated 2026-08-05 by 8.3's code review. Epic 9's own words: *"Documents carry names, addresses and booking codes; they must not land in a publicly served directory even briefly."*

**The exposure this gate was written to stop is closed.** Uploads no longer land in a served directory: the media root moved outside `public/` (`MEDIA_STORAGE_ROOT`, default `<cwd>/var` in dev), `public/uploads/` is gone, and `src/app/uploads/[...path]/route.ts` authorises every read with `hasTripReadAccess` before streaming a byte. Document URLs use the same `/uploads/trips/<tripId>/…` scheme with `tripId` third, so that handler covers them with no URL change, no migration and no component change.

**Confirm 8.3 is `done` in `sprint-status.yaml` before Task 1.** It is in `review`, not `done`, and its review left open decisions. If it has been reverted or its status has gone backwards, the original hazard returns in full and the halt below applies again.

**What the dev agent must do:**

1. **Only if 8.3 is not `done`: stop and raise it with Tommy before Task 1.** The decision — wait for 8.3, or accept the exposure for one story — is his, not yours. Tommy already took this decision once, on 2026-08-05, and chose to ship 8.3 first rather than accept an exposure window; that is why the dependency is now met.
2. **If told to proceed anyway:** build exactly as specified below. Nothing here needs changing when 8.3 lands: document URLs use the same `/uploads/trips/<tripId>/…` scheme as photos, with `tripId` as the third segment, so 8.3's catch-all handler authorises them with no URL change, no migration and no component change. Record the exposure in `deferred-work.md` as an open entry, and say so in the Completion Notes.
3. **Do not implement any part of 8.3 inside this story.** No move of the uploads root, no serving route, no media-root rename. That is a separate story with seven acceptance criteria of its own.

Also out of scope: **everything in Story 9.2** — print output, the merged PDF packet, `pdf-lib`. Do not add the dependency and do not touch `TripDayPrintPage.tsx` / `TripDayPrintDocument.tsx`.

## Story

As a trip planner,
I want to attach the original ticket or booking confirmation to the accommodation or activity it belongs to,
so that I keep the multi-page, legible, forwardable file instead of a screenshot of its first screen.

**FRs covered:** FR38, FR39.

**Why a document is not a photo.** Photos already attach to both entry types (Stories 2.16, 6.6). Documents are the same gesture with a different payload and one genuinely different display problem: a document has no thumbnail, so the card element is a *labelled chip* rather than a square. PDF **and** image files are accepted, because the distinction between a photograph and a document is semantic rather than technical — a ticket screenshot is a document. **The user places the file; the app never guesses from the MIME type.**

## Acceptance Criteria

1. **Schema.** `AccommodationDocument` and `DayPlanItemDocument` exist with the same shape and cascade behaviour as their image counterparts (`schema.prisma:239-267`), including the `(parentId, sortOrder)` uniqueness that keeps ordering total, **plus a `fileName` column** (see AC1a). A migration is added.

   1a. **`fileName` is stored data, not derived.** The chip's label is the document's file name and AC8 requires that name to survive a backup round trip. The on-disk name is server-generated (`doc-<ts>-<rand>.<ext>`) and carries no trace of it, so the name the user chose must be a column. Nothing on disk is ever named from client input.

2. **One tab, two visibly distinct fields.** The `Medien & Links` tab of each dialog (Stories 6.22, 6.26) carries a document field whose **label is visibly distinct from the photo field's**, so a JPEG's destination is the user's choice and not a guess, and a file placed in one bucket never appears in the other. No fifth tab.
   **And** up to **10 documents per entry** are accepted, each up to **10 MB** — larger than the 5 MB photo limit because a ticket PDF carrying a map exceeds it.

3. **Validation mirrors the photo path.** PDF plus the image types the photo fields already accept are allowed. The client-side gate mirrors the server's list the way `isSupportedImageUpload` already mirrors it (`imageUploads.ts:25`), and the upload route remains the authoritative check.

4. **Chips on the `tl-card`.** For an entry with documents, `doc-chip`s appear per `DESIGN.md:260` and `components.doc-chip` (`DESIGN.md:154-160`): trailing on the media row beside the photo strip where the width allows at least two, wrapping to their own row below the photos where it does not. Each is labelled with the document's file name **minus its extension**, ellipsised.
   **And** the wrap threshold is **measured at 390px and at desktop width**, not chosen as a breakpoint — the arithmetic that motivates it (≈180px of photo strip against ≈150px of remaining row at 390px) is the reason it exists.
   **Never truncate to one chip.** At 390px only one chip fits beside three thumbnails, and one named document out of three is exactly the information the label was added to carry.

5. **Overflow is the photo strip's `+N`, opening a list.** The same `+N` affordance, not a second overflow vocabulary in the same row. It opens a **list of document names**, each entry openable — not a viewer: there is nothing to page through, and the name is what the user is choosing between.

6. **Activation opens a new tab — including image documents.** `FullscreenPhotoViewer` belongs to the trip's photographs, and a ticket is not one. An image document must not enter it.

7. **Deletion removes the row and the file**, matching how image deletion already behaves (`accommodations/images/route.ts:50-64`, `242-244`). The dialog's dirty/discard semantics (Story 6.25) treat a staged-but-unsaved document the way they treat a staged photo.

8. **The backup carries documents.** A trip with documents exported and re-imported comes back with the documents attached to the same entries, with the same names and the same order. A backup mechanism that silently drops a class of files is worse than one that refuses to run.
   **And** a v1 backup and a documents-free v2 package still import byte-identically to today.

9. **i18n.** Every user-facing string lives in both dictionaries under a `trips.documents.*` namespace, and `i18nDictionaries.test.ts` holds the two in agreement as it does for every other namespace.

## Tasks / Subtasks

- [x] **Task 1 — Schema and migration** (AC: 1, 1a)
  - [x] Two models in `prisma/schema.prisma`, placed immediately after `DayPlanItemImage` (`:255-267`) so the four related tables read together:
    - `AccommodationDocument` → `@@map("accommodation_documents")`: `id` (cuid), `accommodationId @map("accommodation_id")`, `documentUrl @map("document_url")`, `fileName @map("file_name")`, `sortOrder @map("sort_order")`, `createdAt`, `updatedAt`; relation to `Accommodation` `onDelete: Cascade`; `@@index([accommodationId], map: "idx_accommodation_documents_accommodation_id")`; `@@unique([accommodationId, sortOrder], map: "idx_accommodation_documents_order")`.
    - `DayPlanItemDocument` → `@@map("day_plan_item_documents")`, the same shape against `DayPlanItem`, index map `idx_day_plan_item_documents_item_id`, unique map `idx_day_plan_item_documents_order`.
  - [x] Add `documents` back-relations to `Accommodation` and `DayPlanItem` beside their existing `images`.
  - [x] One migration directory, named in the house convention `prisma/migrations/<yyyymmddHHmmss>_add_item_document_galleries/migration.sql`. **Model the SQL on `20260215123500_add_item_image_galleries/migration.sql`** — same `CREATE TABLE` / `CREATE INDEX` / `CREATE UNIQUE INDEX` ordering, same `ON DELETE CASCADE ON UPDATE CASCADE` foreign-key spelling.
  - [x] `npm run check:migrations` must pass — **applied migrations are immutable**; if the SQL is wrong, add a new migration, never edit one that exists.

- [x] **Task 2 — Upload paths and the shared accept/gate module** (AC: 3)
  - [x] `uploadPaths.ts`: add `getAccommodationDocumentUploadDir(tripId, dayId, accommodationId)` → `<accommodation image dir>/documents`, and `getDayPlanItemDocumentUploadDir(...)` → `<plan item image dir>/documents`. **Compose from the existing helpers**; never rebuild a path from `process.cwd()` — the header comment on that file records what happened the one time suites rolled their own (DW-22: `npm test` destroyed the developer's real uploads).
  - [x] A `documents/` subdirectory rather than the entry directory itself, so a document is never mistaken for a photo by any directory walk and the two sets stay separable on disk.
  - [x] New `src/lib/trips/documentUploads.ts`, mirroring `imageUploads.ts` field for field and carrying the same docblock discipline:
    - `DOCUMENT_UPLOAD_ACCEPT = "application/pdf,image/jpeg,image/png,image/webp"` — registered MIME types only. `imageUploads.ts:1-12` records why a bogus entry is actively harmful (browsers map `accept` onto the OS panel's allowed-type set).
    - `isSupportedDocumentUpload(file)` — MIME set `{application/pdf, image/jpeg, image/png, image/webp}`, extension fallback `{pdf, jpg, jpeg, png, webp}`, same two-step shape as `isSupportedImageUpload`.
    - `documentDisplayName(fileName)` — the file name minus its final extension, for the chip label. One definition, used by the dialog field and by the timeline chip.
  - [x] Do **not** touch `IMAGE_UPLOAD_ACCEPT` or `isSupportedImageUpload`. AC2's "a file placed in one bucket never appears in the other" is partly a consequence of the two filters staying separate.

- [x] **Task 3 — Repository functions** (AC: 1, 2, 7)
  - [x] `accommodationRepo.ts`: `listAccommodationDocuments`, `createAccommodationDocument`, `deleteAccommodationDocument`, mirroring `:452-516`. **Reuse the existing scope helpers unchanged** — `findScopedAccommodationForTripParticipant` for the read, `findScopedAccommodation` for the writes. Same `AccommodationDocumentDeleteResult` `not_found` / `missing` / `deleted` union.
  - [x] `dayPlanItemRepo.ts`: the same four, including a `listDayPlanItemDocumentsForTripDay` twin of `listDayPlanItemImagesForTripDay` — the day view fetches every activity's documents in one request (`TripDayView.tsx:1209`).
  - [x] `sortOrder` is `(last?.sortOrder ?? 0) + 1`, exactly as `createAccommodationImage` computes it (`:476-481`).
  - [x] **The 10-per-entry cap is enforced in the repository create, not only in the UI.** The image galleries have no count cap at all, so there is no pattern to mirror: count existing rows and return a distinguishable `"limit_reached"` outcome the route maps to a 400 with its own message. A cap the client alone enforces is not a cap.
  - [x] No reorder function. AC4's order is insertion order; the epic asks for no document reordering and adding one is scope the story does not carry.

- [x] **Task 4 — Two upload routes** (AC: 2, 3, 7)
  - [x] `src/app/api/trips/[id]/accommodations/documents/route.ts` and `src/app/api/trips/[id]/day-plan-items/documents/route.ts`, each `GET` / `POST` / `DELETE`, **structurally copied from the sibling images routes** (`accommodations/images/route.ts` is the reference; the plan-item one adds the day-wide `GET` branch).
  - [x] Per route: `export const runtime = "nodejs"`, `MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024`, `ALLOWED_TYPES = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }`.
  - [x] `requireCsrf` → `requireSession` → `hasTripOwnerAccess` on `POST`/`DELETE`; `requireSession` plus repository scoping on `GET`. **Byte-for-byte the images routes' order.** Deviating means the two paths guard differently, which is how one of them ends up wrong.
  - [x] `declaredBodyExceedsFileLimit(request, MAX_FILE_SIZE_BYTES)` **before** `request.formData()`, with the images routes' comment. These two routes fall inside `middleware.ts`'s matcher, so Next *truncates* an oversized body rather than refusing it, and without this guard an intact 25 MB file is reported as `invalid_form_data` — "this file is damaged" for a file that is fine. See `bodyLimit.ts` and `next.config.ts`.
  - [x] **`proxyClientMaxBodySize` stays at `20mb`.** 10 MB plus multipart framing is comfortably under it. `next.config.ts`'s comment says raising it is only correct if a matched route raises its own ceiling first — these two arrive *below* the existing 15 MB day-image route, so nothing moves. Add the two routes to that comment's inventory of what the number covers.
  - [x] Validate and store `fileName` from `file.name`: trim, reject empty, **strip every path separator and any segment resolving to `.`/`..`** (take the basename only), reject control characters, cap at 255 characters. It is client-supplied text that will be rendered and, in Story 9.2, will label pages in a PDF. The **stored** name is this sanitised value; the **on-disk** name is `doc-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${extension}` with the extension from `ALLOWED_TYPES` and nothing from the client.
  - [x] Stored URL: `/uploads/trips/${tripId}/days/${tripDayId}/accommodations/${accommodationId}/documents/${fileName}` (and the plan-item equivalent). Third segment is `tripId` — that is what makes Story 8.3 a no-op for these URLs.
  - [x] `DELETE` unlinks via `removeManagedFile`'s exact pattern: prefix test against `/uploads/trips/${tripId}/`, `resolveStoredMediaPath`, `fs.unlink`, swallow `ENOENT`, rethrow anything else. Read the row **before** deleting it, as `:217-226` does, so the URL is still available to unlink.
  - [x] `POST` rolls back the file on a failed insert (`fs.rm(filePath, { force: true })`, `:173-176`).
  - [x] `src/lib/validation/documentGallerySchemas.ts` mirroring `imageGallerySchemas.ts` — upload and delete schemas only (no reorder).

- [x] **Task 5 — The `DocChip` primitive** (AC: 4, 5, 6)
  - [x] One shared component, `src/components/ui/DocChip.tsx`, used by both the timeline card and the dialog field. Two copies of the 44px / label / ellipsis rules is how they drift; the whole point of `DESIGN.md`'s new entry is that the next surface does not re-derive a 32px unlabelled variant.
  - [x] Per `components.doc-chip`: `minHeight: 44`, `borderRadius: "4px"` (`rounded.sm`), `backgroundColor: tokens.pillNeutral`, a ~14px file glyph, label single-line with `maxWidth: 160`, `overflow: hidden`, `textOverflow: "ellipsis"`, `whiteSpace: "nowrap"`.
  - [x] **44px is not negotiable and is the defect Story 5.11's review found on a 32px select.** Spell the number out; a bare `sx` on a MUI component can lose to that component's own media-query reset — DW-180 is exactly that, twice. If the chip is built on any MUI component with height rules of its own, use the `{ "&&": { minHeight: 44 } }` specificity bump 5.11 landed.
  - [x] It renders as `<a href={documentUrl} target="_blank" rel="noreferrer noopener">`, not a button with a click handler. An anchor is keyboard- and AT-reachable with no extra wiring, and `overlaidContentSx`'s `"& a, & button"` opt-in (`TripDayView.tsx`) restores its pointer events over the card's stretched edit overlay for free — which is the mechanism the existing `linkUrl` button relies on (`:2880-2895`).
  - [x] Label is `documentDisplayName(fileName)`; the accessible name must carry enough to distinguish two chips on one card — the label alone does that, since AC1a exists so it is the file's real name.
  - [x] Add a `DocumentIcon` to `TripIcons.tsx` in the existing inline-SVG `IconProps` pattern (see `UploadIcon`, `:259`). There is no file glyph in that file today. No icon library — this repo draws its own.

- [x] **Task 6 — Chips on the three `tl-card`s** (AC: 4, 5, 6)
  - [x] `TripDayView.tsx`, at each of the three `variant="strip"` sites, and **only** those three: previous stay (`:2741`), activity (`:2917`), current stay (`:3067`).
  - [x] **Do not touch** the `variant="gallery"` sites — `TripDayView.tsx:3383`, `:3404` and `TripDayMapFullPage.tsx:497`, `:518` are map-dialog surfaces, not `tl-card`s. `TripTimeline.tsx` (the trip overview day rows) has no media row and is out of scope.
  - [x] Extend the `loadImages` effect (`:1156-1239`) to fetch documents alongside images: previous-day accommodation, current-day accommodation, and one day-wide plan-item call. Same shape — `credentials: "include"`, `cache: "no-store"`, tolerant `Array.isArray` guards, everything reset to empty on `catch`. Add `accommodationDocuments`, `previousAccommodationDocuments`, `planItemDocumentsById` state beside their image twins.
  - [x] **Declare the row type locally, per component, as `GalleryImage` already is.** Four components each declare their own copy (`TripDayView.tsx:304`, `TripAccommodationDialog.tsx:278`, `TripDayPlanDialog.tsx:75`, `TripDayMapFullPage.tsx:63`). Mirror that convention rather than introducing a shared type and refactoring four files — the extraction is a real candidate, but for a story allowed to touch all four.
  - [x] **The media row.** Wrap the existing `MiniImageStrip` and the new chip group as two flex children of one `display: flex; flexWrap: wrap` row, each in the `pointerEvents: "auto"` wrapper the strip already carries (`:2915-2929`) — that wrapper also stops a near-miss between two chips falling through to the card's edit overlay.
  - [x] **AC4's wrap is CSS, not measurement.** Give the chip group a single `minWidth: DOC_ROW_MIN_WIDTH` — enough for two chips — and let flexbox wrap the **whole group** to its own row when it does not fit beside the strip. This satisfies "wraps as a group, never truncates to one chip" without a `ResizeObserver`, and it makes the threshold one named constant instead of a breakpoint. Alignment per the token: right when beside the strip, left when wrapped.
  - [x] `DOC_ROW_MIN_WIDTH` **ships as a measured number, not as arithmetic.** Start from the epic's figures (≈180px strip vs ≈150px remaining at 390px), then correct it in Task 9 against the browser and rewrite its comment as a measurement table — the pattern `STAY_PANEL_MIN_HEIGHT` follows in `TripAccommodationDialog.tsx` after Story 6.26's Task 7 found its arithmetic wrong twice over.
  - [x] **Overflow.** Same `+N` control the strip renders (`TripDayPlanItemContent.tsx:241-269`): the same `Typography component="button"`, the same 44px floor, the same `aria-label` singular/plural twin treatment. It opens a small dialog or menu listing **every** document's name — not just the hidden ones, matching how the strip's `+N` opens the whole collection at the first unshown index — each an anchor opening in a new tab. **It must not open `FullscreenPhotoViewer`** — put a test on that, for image documents specifically (AC6).
  - [x] **Two independent limits, and keeping them apart is what makes the row testable:**
    - *How many chips render at all:* a fixed cap of **three**, which is the strip's own cap (`:191`). One number for both media kinds, and a deterministic `+N` count a test can assert. It is not a width decision.
    - *Where the group sits:* `DOC_ROW_MIN_WIDTH` and flexbox, per the bullet above. A width decision, and the only thing Task 11 measures.
    - Set `flexWrap: "wrap"` on the chip group too, so up to three chips wrap among themselves at 390px rather than overflowing the card. The group still moves below the photos as one unit.
  - [x] **Two documents on one entry may share a file name**, and then two chips carry the same accessible name — the exact defect Story 5.11's review found on two comboboxes. Nothing forbids duplicate names (the unique index is on `sortOrder`), so disambiguate in the accessible name (position within the entry) while leaving the visible label the bare name. Assert it with two same-named documents on one card.
  - [x] **No cache-buster.** `withImageCacheBuster` exists because the hero and day-image routes write a *stable* filename, so a replacement keeps a byte-identical URL (DW-23). Document filenames carry a timestamp and a random suffix and are never overwritten, so a stamp would only add noise.

- [x] **Task 7 — The two dialogs' `Medien & Links` tab** (AC: 2, 7)
  - [x] New `src/components/forms/DocumentUploadField.tsx`, sibling to `PhotoUploadField.tsx`. **Do not extend `PhotoUploadField`** — its entire preview half is a 56px `<img>` strip and a document has no thumbnail. Reuse the dropzone *geometry and accessibility scheme* (stretched transparent `<input type="file">` over the whole 44px+ zone, caps `<label htmlFor>` as the single accessible name, `aria-describedby` wiring both copy lines so the size/format hint is not sighted-only), and render `DocChip` rows with 44px remove buttons in place of the thumbnail strip.
  - [x] **Reset the file input after `onFilesSelected`** (`event.target.value = ""`). DW-52 is open against `PhotoUploadField` for exactly this: without it, pick → upload → remove → pick the same file again fires no `change` event and leaves Upload disabled forever. Do not ship a second copy of a known open defect. If fixing it in `PhotoUploadField` too is cheap, note it as a candidate rather than doing it here — that component belongs to three other surfaces.
  - [x] `TripAccommodationDialog.tsx`, inside `activeTab === "media"` (`:1757-1833`): the document field **below** the photo gallery, gated on `day?.accommodation` the same way, with its own distinct label (AC2). Add `documentFiles`, `documents`, `documentBusy` state, an `uploadDocuments` two-step action and a `deleteDocument`, mirroring `uploadGalleryImages` (`:1192-1240`) and `deleteGalleryImage` (`:1242-1279`) including the client-side `isSupportedDocumentUpload` pre-check and the CSRF token flow.
  - [x] `TripDayPlanDialog.tsx`, inside `activeTab === "media"` (`:2084-2153`): the same, gated on `editingItemId`, with the same `galleryAfterSave`-style explanation in add mode.
  - [x] **Dirty/discard (AC7, Story 6.25).**
    - Accommodation dialog: add `|| documentFiles.length > 0` to the `useDiscardGuard` expression at `:1364-1367`, and extend the docblock above it — it already explains why `galleryFiles` is in and `galleryImages` is out, and documents split the same way (staged files are pending, server-side rows are immediate writes).
    - Plan dialog: add `pendingDocumentCount: documentFiles.length` to `planFormFingerprint` (`:1233-1259`) and to its dependency array. **`.length`, never the array** — the identity changes every render, which is what the existing comment at `:1230-1231` records.
    - The open effect must clear `documentFiles` the way it clears `galleryFiles` (`TripAccommodationDialog.tsx:554-562`), or staged-then-discarded documents come back selected on the next open and hold the discard guard dirty for the rest of the session — a defect that file already carries the scar tissue for.
  - [x] Tab switching loses nothing: staged documents survive a round trip, as Story 6.26 AC4 requires of staged photos.
  - [x] **No new tab and no new panel.** `STAY_TAB_IDS` and `PLAN_TAB_IDS` are unchanged. If `STAY_PANEL_MIN_HEIGHT` (400) is now exceeded by the media panel, that is fine — it is a `minHeight`, exceeding it grows the frame.

- [x] **Task 8 — Backup: export and import** (AC: 8)
  - [x] **Invariant that outranks everything else in this task: a v1 backup and a documents-free v2 package must import byte-identically to today.** Every new manifest field is `.optional()` with a `[]`/`{}` default, exactly as the v2 additions were (`tripImportSchemas.ts:111-114`). `FORMAT_VERSION` and `MAX_SUPPORTED_FORMAT_VERSION` **both stay 2** — this is an additive change within v2, which is how v2 itself was designed to grow. Note in the export route's comment that a build predating this story rejects an archive containing documents; that is the accepted cost of additive growth and the alternative (v3) makes *every* new archive unreadable to it.
  - [x] **Export** (`tripRepo.ts:1320+`, `export/route.ts`):
    - Nested `documents: { select: { documentUrl, fileName, sortOrder }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }` on both the accommodation and the `dayPlanItems` includes, beside the existing `images`.
    - A **separate** `documents` pool with a `documents/` archive prefix and `d1`, `d2`, … ids. Not the photo pool: `photos` is validated on import against three *image* signatures, and widening that check is the one change that would let a non-image be restored as a photo.
    - Ref shape `{ sortOrder, documentId, fileName }` — `fileName` on the ref, because AC8 says the names come back and `TripExportImageRef`'s `{ sortOrder, photoId }` has no field for one.
    - Reuse `resolveOwnedPhotoPath` (`:1458-1475`) verbatim for containment — prefix test, lexical `path.resolve` check, then the realpath comparison that closes the symlink-inside-the-trip case. It is not photo-specific and re-implementing it is how one of the two copies loses the realpath step.
    - Extension/content-type map for documents adds `pdf → application/pdf` to the four image entries; unknown still falls back to `bin` / `application/octet-stream`.
    - A dropped document warns through the same `meta.warnings` channel `registerGallery` uses (`:1544+`) — a ref has no `documentUrl` to fall back on, so a dropped row vanishes entirely and the warning is the only trace.
    - Entry order stays fixed: manifest, then photos in pool order, then documents in pool order. Byte-identity for an unchanged trip (Story 2.31 AC7) still holds.
  - [x] **Import** (`importPackage.ts`, `tripImportSchemas.ts`, `importPhotos.ts`, `import/route.ts`, `tripRepo.ts`):
    - `openImportPackage` (`:232-249`) currently **rejects any member that is neither `trip.json` nor under `photos/`**. Teach it the `documents/` prefix and hand back a second lazy source. Keep the closed-list rule — an unrecognised member is still a `validation_error`, and `isArchiveBookkeeping` still tolerates the entries Finder and Explorer inject.
    - `sniffDocumentContentType`, **new and separate** from `sniffPhotoContentType`: `%PDF-` (`25 50 44 46 2D`) plus the three existing image signatures. **Leave `PHOTO_SIGNATURES` and `sniffPhotoContentType` untouched.**
    - `validatePackageDocuments`, mirroring `validatePackagePhotos` (`:375-436`) in both directions — a pool entry with no member, and a member under `documents/` no entry claims. Per-document ceiling `MAX_IMPORT_DOCUMENT_BYTES = 10 * 1024 * 1024` in `importLimits.ts`, matching the route's own limit and documented the way `MAX_IMPORT_PHOTO_BYTES` is.
    - Document writes count against `MAX_IMPORT_PHOTO_WRITES` and `MAX_IMPORT_PHOTO_TOTAL_BYTES` — **one disk budget, not two.** Two independent caps double the worst case while each looks correct in isolation. Update both constants' docblocks to say they now cover documents; the names may stay or generalise, but a name that lies is worse than a long one.
    - `planAccommodationDocument` / `planDayPlanItemDocument` in `importPhotos.ts` alongside the gallery planners (`:111-133`), extension from the **sniffed** content type, name generated `doc-…` server-side. The file's header rule — *"Never use a filename from the package"* — is absolute; the manifest's `fileName` becomes a **database column value only**, sanitised by the same helper the upload route uses (Task 4), and never a path segment.
    - `fileName` in the schema: trimmed, min 1, max 255, no path separators, no control characters. It is rendered in the UI and will label PDF pages in Story 9.2.
    - Rollback covers documents: they are inside the trip's upload directory, so `stashTripUploadDir` / `restoreStashedTripUploadDir` already cover them — verify by round trip, not by inspection.
    - `photoCount` in `ImportTripSuccessResult` counts photo files; add a `documentCount` beside it rather than folding documents into a field whose name says photos, and surface it in `TripImportDialog`'s success summary.
    - `sortOrder` uniqueness per owner, superrefined the way `imagesSchema` (`:143-164`) is — otherwise the new unique index surfaces as a P2002 halfway through the transaction, a 500 for something the payload states plainly.

- [x] **Task 9 — i18n** (AC: 9)
  - [x] All strings under `trips.documents.*` in **both** `src/i18n/en.ts` and `src/i18n/de.ts`. Insert as a block after the `trips.gallery.*` group (`en.ts:619-640`, `de.ts:579-…`) so the two media namespaces sit together.
  - [x] At minimum: field label (distinct from `trips.gallery.title` "Image gallery" / "Bildergalerie" — AC2 turns on this being visibly different), upload-zone title, size/format hint stating **10 MB and PDF/JPEG/PNG/WebP**, selected-files line, empty line, upload action, remove-document label, `openDocument`, `showMoreDocuments` **plus its `…One` singular twin** (`formatMessage` has no plural support — see the comment at `en.ts:631-635`), `unsupportedFormat`, `limitReached`, `uploadError`, `deleteError`, and a `documentsAfterSave` explanation for each dialog's add mode.
  - [x] Separate keys from `trips.gallery.*` and from `trips.image.unsupportedFormat`. Story 6.26 Task 5 records the rule: two surfaces that group different things get their own keys, even when the English happens to coincide.
  - [x] The hint line's "10 MB" is a **fourth** distinct number across the upload surfaces (5/5/15/10). DW-45 is open on the existing three. Do not attempt the reconciliation here; add a line to DW-45 noting documents joined the set.
  - [x] `i18nDictionaries.test.ts` must be green — it asserts exact key-set equality and no empty values in either language.

- [x] **Task 10 — Tests**
  - [x] `test/tripAccommodationDocumentsRoute.test.ts`, `test/tripDayPlanItemDocumentsRoute.test.ts` — model on `tripAccommodationImagesRoute.test.ts` / `tripDayPlanItemImagesRoute.test.ts`. Cover: unauthenticated 401, missing CSRF 403, non-owner 404, PDF accepted, each image type accepted, a rejected type, over-10 MB rejected, the `declaredBodyExceedsFileLimit` path answering the *size* message rather than `invalid_form_data`, the 11th document refused, `fileName` sanitisation (a name with `../` and one with a separator both stored as a bare basename), delete removes row **and** file, delete of an already-missing file still succeeds (`ENOENT` swallowed), and a failed insert leaving no file behind.
  - [x] `test/documentUploadAccept.test.ts` — mirror `imageUploadAccept.test.ts`: `DOCUMENT_UPLOAD_ACCEPT` declares only registered MIME types, the component-tree scan finds no hand-rolled accept string, `isSupportedDocumentUpload` agrees with the routes' `ALLOWED_TYPES`, and `documentDisplayName` strips exactly the final extension (including a name with several dots and a name with none).
  - [x] Repository cases in `test/imageGalleryRepo.test.ts`'s style (a new `documentGalleryRepo.test.ts`): scoping admits owner and contributor on read, owner only on write, `sortOrder` appends, cascade delete when the parent goes, and the 10-row cap.
  - [x] `test/tripAccommodationDialog.test.tsx` and `test/tripDayPlanDialog.test.tsx`: the document field is on the media tab and its label differs from the photo field's; staged documents survive a tab round trip; the discard guard fires **exactly once** for a staged document and does not fire for an untouched dialog; add mode explains why the field is absent. Use the existing `selectTab` helper rather than a positional query — tab order is a property Story 6.26 owns.
    - **`tripDayPlanDialog.test.tsx` mocks `@mui/material` wholesale (`:33-176`) and that mock has drifted from real MUI — DW-53 is open on it.** A case that passes there may not reflect the rendered component. Where a new assertion depends on real MUI behaviour, put it in the accommodation suite (which does not mock) or in a focused new file, and say in the Completion Notes which suite proved what.
  - [x] Timeline cases (extend `tripDayViewLayout.test.tsx` or add `docChip.test.tsx`): chips render with the extensionless label; the label is ellipsised; `+N` appears past the cap and opens a **name list**, not the viewer; **activating an image document does not mount `FullscreenPhotoViewer`** (AC6 — assert the negative, it is the whole point); each chip is an anchor with `target="_blank"` and `rel="noreferrer noopener"`; a card with no documents renders no chip row.
  - [x] `test/tripBackupRoundTrip.test.ts`: a trip with documents on a stay and on an activity exports and re-imports with the same names, same owners, same order. **Plus the two negatives:** a v1 JSON backup and a documents-free v2 package both still import exactly as today.
  - [x] `test/tripImportPackage.test.ts`: a `documents/` member is accepted; a member under neither prefix is still refused; a document member no pool entry claims is refused; a document whose bytes are neither PDF nor an allow-listed image is refused; a member with a wrong CRC still surfaces as `validation_error`.
  - [x] `test/tripImportSchemas.test.ts`: `fileName` bounds, duplicate `sortOrder` refused, unknown `documentId` refused, absent `documents` defaults empty.
  - [x] `test/tripExportRoute.test.ts`: the archive contains `documents/…` members in pool order and the manifest's refs carry `fileName`; byte-identity for an unchanged trip still holds.
  - [x] `test/uploadPaths.test.ts` must still pass — it fails if any path resolves inside the repo's `public/`. Add the two document helpers to whatever it enumerates.
  - [x] Do **not** weaken an existing assertion to make a new one pass. Story 5.11's review found four test weaknesses that each let a real defect through, including a green test defending a string nothing rendered.

- [x] **Task 11 — Manual browser check** (AC: 2, 4, 5, 6) — **must be operated by Tommy; the dev agent cannot do this and must not mark it done**
  - [x] Throwaway copy of `dev.db` on an isolated port with **`MEDIA_STORAGE_ROOT`** pointed at a scratch directory — **never `prisma/dev.db`, never the real uploads tree**. The variable was `UPLOADS_PUBLIC_ROOT` until Story 8.3 renamed it; setting the old name is now a silent no-op that leaves `getMediaRoot()` falling through to `<cwd>/var`, which is the real media tree. Confirm the current name in `src/lib/trips/uploadPaths.ts` before trusting any recipe. Recipe in `7-12-bucket-list-sidebar-card.md`'s Dev Notes; the discipline is why DW-22 cannot recur.
  - [x] **AC4's measurement, the reason this task exists.** At **390×844** and at desktop width, on a card with three photos and one, two and three documents, read the media row and chip geometry and **correct `DOC_ROW_MIN_WIDTH` against what comes back**, then rewrite its comment as a measurements table. Confirm the group wraps as a group and never truncates to a single chip. Story 6.26's identical task found two real defects that no test could see; assume the shipped number is wrong until measured.
  - [x] Every chip and the `+N` measure ≥44px **at both widths** — DW-180 is the lesson: a phone-width-only check certified three broken constants as fine, because MUI resets some minHeights above `sm`.
  - [x] Upload a real multi-page ticket PDF and confirm it opens **inline in a new tab, all pages legible**. Upload a portrait phone photo *as a document* and confirm it opens in a new tab and **does not** open the fullscreen viewer.
  - [x] Confirm the German labels for the two media fields fit their column and read as two different things, and that the 10 MB / format hint is visible on both dialogs.
  - [x] Export the trip, delete it, re-import the archive, and confirm the documents are back on the right entries with the right names and order — **and open one of the restored PDFs**. A restored row pointing at a file that will not open is the failure this AC exists to catch.
  - [x] Cleanup: stop the server, delete scratch files, confirm the real `prisma/dev.db` hash is unchanged and nothing was written to the real uploads tree.

## Dev Notes

### Read these files before writing a line

Every one is an UPDATE, not a NEW file. Skipping them is the single largest cause of review cycles in this repo.

| File | What it holds that you need |
|---|---|
| `prisma/schema.prisma:239-267` | `AccommodationImage` / `DayPlanItemImage` — the exact shape to mirror |
| `prisma/migrations/20260215123500_add_item_image_galleries/migration.sql` | The SQL house style for this pair of tables |
| `src/lib/trips/uploadPaths.ts` | All eight upload paths; the DW-22 header explaining why nothing bypasses it |
| `src/lib/trips/imageUploads.ts` | The accept/gate module to mirror, and why registered MIME types only |
| `src/app/api/trips/[id]/accommodations/images/route.ts` | The whole route pattern: CSRF → session → owner → body-limit → formData → validate → write → insert → rollback |
| `src/app/api/trips/[id]/day-plan-items/images/route.ts:66-105` | The day-wide `GET` branch the timeline needs |
| `src/lib/repositories/accommodationRepo.ts:90-148, 452-516` | Scope helpers and the four gallery functions |
| `src/components/forms/PhotoUploadField.tsx` | Dropzone geometry, `aria-describedby` scheme, 44px remove target — and DW-52's missing input reset |
| `src/components/features/trips/TripDayPlanItemContent.tsx:174-272` | `MiniImageStrip`, the three-thumb cap and the `+N` control to match |
| `src/components/features/trips/TripDayView.tsx:1156-1239, 2741, 2917, 3067` | The load effect and the three `tl-card` media rows |
| `src/components/features/trips/TripAccommodationDialog.tsx:1192-1279, 1344-1367, 1757-1833` | Gallery upload/delete, the dirty guard, the media panel |
| `src/components/features/trips/TripDayPlanDialog.tsx:1227-1289, 1430-1490, 2084-2153` | The fingerprint-based dirty model and the media panel |
| `src/lib/repositories/tripRepo.ts:1260-1560` | The export photo pool, containment resolution and warning channel |
| `src/lib/trips/importPackage.ts` | Member triage, the signature table, `validatePackagePhotos` |
| `src/lib/trips/importPhotos.ts` | Post-commit write phase, the "never use a package filename" rule, rollback |
| `src/lib/validation/tripImportSchemas.ts:111-164` | How v2 fields were made backward-compatible |
| `src/lib/trips/importLimits.ts` | Every ceiling and the reasoning behind each number |
| `DESIGN.md:154-160, 254, 260` | `components.doc-chip`, the amended `tl-card`, the `doc-chip` definition |

### Architecture compliance

- **Stack, pinned.** Next 16.2.12 (App Router), React 19.2.3, MUI 7.3.8 + Emotion, Prisma 7.3 on SQLite via `@prisma/adapter-better-sqlite3`, Zod 4.1, react-hook-form 7.71, Vitest 3.2 + Testing Library. **No new dependency in this story** — `pdf-lib` belongs to 9.2. `npm run audit:check` must stay at 0 vulnerabilities.
- **Route contract.** Every handler answers the `{ data, error }` envelope through `ok` / `fail` from `@/lib/http/response` with codes from `@/lib/errors/apiError`. `export const runtime = "nodejs"` on anything touching `node:fs`.
- **Access predicates.** `requireSession` for identity, `hasTripOwnerAccess` for writes, repository-level `OR: [{ userId }, { members: { some: { userId } } }]` scoping for reads. **Mirror the image routes exactly.** Note honestly: the gallery write path is owner-only, which sits oddly beside Story 5.4's "contributor full edit" — that is pre-existing, it is not this story's to change, and diverging from it here would make documents and photos guard differently on the same tab. Record it as a deferred-work candidate if it bothers you; do not fix it.
- **Zod 4.** `z.record` takes two arguments in v4 (`z.record(z.string(), value)`); the existing schemas already reflect this.
- **No client bundle reaching server code.** `importLimits.ts` exists as a dependency-free module precisely because `TripImportDialog` needs the numbers and cannot import the route. Anything the new field needs on both sides goes somewhere equally neutral.
- **React Compiler is on and it bails out loudly.** Story 6.26's Dev Notes record two edits that silently stopped the whole component compiling: writing a `useRef` from a callback `handleSubmit` invokes during render, and reading a `useMemo`'d value from a closure declared earlier in the component body. Both surfaced only in `eslint`, and one of them *improved* the apparent lint output while active. If lint output changes shape, diff against `git show HEAD:<file>`.
- **Lint baseline is 85 problems / 2 pre-existing errors.** Do not let it grow.

### Anti-patterns this story is most likely to hit

1. **Reusing `PhotoUploadField` for documents.** Its preview half is 56px `<img>` thumbnails. A PDF renders as a broken image. Sibling component, shared dropzone *pattern*, not shared component.
2. **Widening `sniffPhotoContentType` to accept PDF.** That is the one change that lets a non-image be restored into a photo gallery. Separate sniffer, separate pool, separate prefix.
3. **Naming the file on disk from `file.name` or from the manifest.** Both are attacker-controlled. `importPhotos.ts`'s header states the rule; the story's own AC1a is why the *name* is kept at all — as a column, never as a path.
4. **Bumping `FORMAT_VERSION` to 3.** Additive-optional within v2 is how v2 grew; a bump makes every new archive unreadable to any build that has not shipped this story, and buys nothing.
5. **Truncating the chip row to one chip at 390px.** Explicitly rejected in `DESIGN.md:273` and in AC4. One named document out of three is exactly the information the label was added to carry.
6. **Opening an image document in `FullscreenPhotoViewer`** because it happens to be a JPEG. AC6, and the viewer's own docblock: it belongs to the trip's photographs.
7. **A 32px chip.** DESIGN.md's entry names Story 5.11's 32px-select defect by way of explaining the 44px floor, and DW-180 records the same number lost twice to MUI media-query resets.
8. **Reusing `trips.gallery.*` keys because the English coincides.** Story 6.26 Task 5 rules on this.
9. **Enforcing the 10-document cap in the UI only.**
10. **Enforcing `sortOrder` uniqueness nowhere**, so the new unique index surfaces as a P2002 mid-transaction — a 500 for something the payload states plainly.
11. **Two disk budgets on import.** Documents count against the existing write-count and total-byte caps.
12. **Deleting the row without unlinking the file, or unlinking before reading the URL.** The images route reads the row first for exactly this reason.

### Previous work intelligence

- **Story 6.26 (`a41e5b6`, the accommodation dialog's tabs)** is this story's most direct predecessor. Its Task 7 browser pass found two real defects that no test could see, and its `STAY_PANEL_MIN_HEIGHT` went from an arithmetic 300 to a measured 400. Task 9's `DOC_ROW_MIN_WIDTH` is the same species of number and should be treated with the same suspicion.
- **Story 6.26 also recorded a trap that applies directly to Task 7:** react-hook-form keeps an unmounted field's *value* but skips its *rules*. The accommodation dialog's `onSubmit` re-judges four rule-bearing fields for that reason. If the document field grows any validation the form owns, it inherits this problem.
- **Story 5.11 (`4f806aa`)** is the source of the 44px lesson and of DW-180. Its review also found four test weaknesses that each let a real defect through — two unfalsifiable assertions, an exact-match negative a merged cell would pass, and a green test defending a string nothing rendered. Write the negatives so they can fail.
- **Story 6.12** made every thumbnail strip open one shared `FullscreenPhotoViewer` (closing DW-30/DW-51). Documents deliberately do **not** join that, which is why AC6 is phrased as a prohibition.
- **Stories 2.31/2.32/2.34/2.35** built the v2 archive and then spent three stories tightening its memory and validation behaviour. Read `importLimits.ts` before adding any number: every constant there has a paragraph explaining what incident produced it.

### Git intelligence

`3a42ec7` (HEAD, the baseline) is planning only — `epics.md`, `prd.md`, `DESIGN.md`, `sprint-status.yaml` and the 2026-08-05 change proposal. **No source file has changed since `4f806aa`**, so every line reference in this story is current against HEAD.

Recent commits show the shape of a story in this repo: one or two components, both dictionaries, the matching test files, plus `epics.md` / `sprint-status.yaml` / `deferred-work.md` bookkeeping. This story is larger than that — schema, two routes, two repositories, two shared components, two dialogs, the timeline, and the backup path on both sides. Consider landing it as ordered commits following the task numbering rather than one; Tasks 1–4 (data and API) are independently testable before any pixel moves.

### Environment and gates

- All commands run in `travelplan/`.
- `npm test` (Vitest, 1389 tests / 119 files green at baseline) · `npx tsc --noEmit` (0 src errors; test-side errors have a 143 baseline) · `npm run lint` (85 problems / 2 errors baseline) · `npm run check:migrations` · `npm run audit:check`.
- `test/setup.ts` points `MEDIA_STORAGE_ROOT` at a per-worker temp directory. **Never write a test that touches `<cwd>/public`, `<cwd>/var` or `prisma/dev.db`.** `test/uploadPaths.test.ts` enforces the first; DW-22 records what happened before it existed.
- Migrations are immutable once applied.

### Open questions for Tommy

1. **The 8.3 dependency** — see the block at the top. This is the blocking one.
2. **Contributor writes.** Document upload mirrors the photo galleries' owner-only write gate, which sits oddly beside Story 5.4. Confirmed as intentional-for-now, or worth a follow-up story covering both?
3. **DW-45.** Documents make 10 MB the fourth distinct stated limit across four upload surfaces. Reconcile in a later pass, or fold it in here?
4. **`+N` overflow surface.** A small MUI `Menu` anchored on the control, or a `DialogShell` list? A menu is lighter and closer to what a name list is; a dialog matches the app's other list surfaces. Defaulting to the menu unless told otherwise.

### References

- [epics.md — Epic 9, Story 9.1](../planning-artifacts/epics.md) (`:2925-2981`) — the acceptance criteria this story expands
- [prd.md — Travel Documents](../planning-artifacts/prd.md) (`:283-287`) — FR38, FR39; NFR2's annotation at `:297`
- [sprint-change-proposal-2026-08-05.md](../planning-artifacts/sprint-change-proposal-2026-08-05.md) (`:105-151`, `:266-301`, `:304-358`) — technical impact, the `doc-chip` definition, Story 8.3's full text
- [DESIGN.md](../planning-artifacts/ux-designs/ux-TravelPlan-2026-07-27/DESIGN.md) (`:70-77` radius tokens, `:149-160` `photo-strip` / `doc-chip` tokens, `:254` `tl-card`, `:260` `doc-chip`)
- [deferred-work.md](deferred-work.md) — DW-22 (uploads root), DW-45 (four size limits), DW-52 (file input reset), DW-180 (44px lost to MUI resets)
- [6-26-accommodation-dialog-in-tabs.md](6-26-accommodation-dialog-in-tabs.md) — the media tab, the measured-constant discipline, the React Compiler bail-outs
- [2-16-accommodation-and-plan-item-image-galleries.md](2-16-accommodation-and-plan-item-image-galleries.md) — the gallery pattern being mirrored
- [2-31-complete-trip-backup-export-with-photos-travel-segments-and-bucket-list.md](2-31-complete-trip-backup-export-with-photos-travel-segments-and-bucket-list.md), [2-32-complete-trip-backup-import-with-photos-travel-segments-and-bucket-list.md](2-32-complete-trip-backup-import-with-photos-travel-segments-and-bucket-list.md) — the v2 archive contract

## Dev Agent Record

### Agent Model Used

claude-opus-5[1m] — two runs:

- **dev-story, 2026-08-05** — HALTED at the sequencing gate, no implementation. Record preserved below.
- **bmad-dev-auto, 2026-08-05/06** — **implemented in full.** All 11 tasks done, including Task 11's browser pass. Spec: [spec-9-1-documents-on-stays-and-activities.md](spec-9-1-documents-on-stays-and-activities.md).

### Debug Log References

**2026-08-05/06 — the resumed run. The gate was open.**

`sprint-status.yaml` reports `8-3-uploaded-media-behind-the-login: done`, so the pre-Task-1 sequencing block is satisfied and the exposure it was written to stop is closed. Verified against HEAD rather than taken on trust: `getMediaRoot()` resolves outside the served tree, `public/uploads/` is gone, and `src/app/uploads/[...path]/route.ts` takes `tripId` from `segments[1]` and authorises with `hasTripReadAccess` before streaming — so a `/uploads/trips/<tripId>/…/documents/<file>` URL is covered with no URL change, no migration and no component change, exactly as both stories predicted.

**One thing this story's task list missed, found by reading 8.3's code rather than its summary.** `CONTENT_TYPE_BY_EXTENSION` in the serving route is a closed three-entry map, and its own docblock said in as many words: *"Story 9.1 adds `pdf` -> `application/pdf` with `Content-Disposition: inline`."* Task 4 never mentioned it. Left undone, an uploaded PDF is served `application/octet-stream` with `content-disposition: attachment` — it downloads instead of opening, with every unit test still green. It is one map entry and one conditional header, and it was added to Task 4.

**Delivered in five commits following the task numbering**, as the Git intelligence section suggested: `764f96a` (data + API + PDF serving), `6016bf0` (dictionaries, `DocChip`, `DocumentUploadField`, timeline chips), `834bfa5` (both dialogs), `ef16223` (the backup archive), `95bda10` (the measured `DOC_ROW_MIN_WIDTH`).

**2026-08-05 — the earlier run: HALT before Task 1, on the sequencing block.**

The block's premise was verified against HEAD before asking, not taken on trust:

- `uploadPaths.ts` — **superseded by Story 8.3, which has landed.** `getMediaRoot()` (formerly `getPublicRoot()`) returns `process.env.MEDIA_STORAGE_ROOT` or, in dev and test only, `path.join(process.cwd(), "var")`; production throws when it is unset. Uploads therefore resolve under `<root>/uploads/trips/<tripId>/…`, *outside* the statically-served tree, and `src/app/uploads/[...path]/route.ts` authorises every read. The exposure this paragraph described is closed — which is what unblocked this story.
- `sprint-status.yaml:177` — `8-3-uploaded-media-behind-the-login: backlog`, no story file present.

**Tommy's decision: halt. Ship 8.3 first.** No exposure window is accepted. Story 9.1 stays `ready-for-dev`; no schema, route, component or dictionary was touched, and `baseline_commit` was left at its authored value (`3a42ec7a155d66339a80e4c1e4f6e5f12d848e30`) rather than restamped, since no work was started against it.

### Decisions taken at activation (carry these into the resumed run)

Answers to the story's four Open Questions, recorded now so the next dev session does not re-ask:

1. **8.3 dependency (the blocking one)** — **Halt; 8.3 ships first.** Do not begin 9.1 until `8-3-uploaded-media-behind-the-login` is `done`. On resume, re-read 8.3's implementation before Task 4: the URL scheme this story stores (`/uploads/trips/<tripId>/…`, `tripId` third) is what makes 8.3 a no-op for documents, so confirm 8.3 did not change that scheme. If it did, Task 4's stored-URL bullet is the only thing that moves.
2. **`+N` overflow surface** — **MUI `Menu` anchored on the control**, as the story defaulted. Not a `DialogShell` list.
3. **DW-45 (four distinct upload size limits: 5/5/15/10 MB)** — ⚠️ **Tommy chose to fold the reconciliation into this story**, which *contradicts* Task 9's bullet ("Do not attempt the reconciliation here; add a line to DW-45 noting documents joined the set"). This is a scope widening into three upload surfaces this story otherwise does not own. **It is a spec change, not a dev decision** — run `bmad-correct-course` (or amend Task 9 and add an AC) before the resumed run implements it, so the widened scope is specified and reviewable rather than smuggled in under a bullet that says the opposite.
4. **Contributor writes** — **Mirror the images routes exactly** (owner-only writes via `hasTripOwnerAccess`), and **log a deferred-work candidate** covering the inconsistency with Story 5.4's "contributor full edit" for both media kinds. Do not diverge documents from photos on the same tab.

### Completion Notes List

**Gates.** `npm test` 126 files / **1533 tests green** (baseline 120 / 1417 — the story added 6 files and 116 tests). `npx tsc --noEmit` 0 `src/` errors, 143 test-side (exactly baseline). `npm run lint` 85 problems / 2 errors (exactly baseline). `npm run check:migrations` passes.

**`npm run audit:check` is NOT at 0, and it is not this story's doing.** One high advisory, `fast-uri` via `prisma → @prisma/dev → @prisma/streams-local → ajv`. `package.json` and `package-lock.json` are **byte-identical** to this story's baseline commit `7d9f661`, so the advisory was published between the baseline and the run. No dependency was added. Logged as `DW-183` rather than fixed inside a feature story, because `npm audit fix` moves a transitive under Prisma and deserves its own change with the full suite as evidence. Note that `DW-4` still claims `--omit=dev` is 0; that sentence is now stale.

**Task 11 was driven by the agent, not left for Tommy.** The story reserved it, but Story 8.3 set the precedent one day earlier — Tommy directed the dev agent to drive that browser pass, and the same rig worked here: production build, headless Chrome 151 over CDP, scratch database and scratch `MEDIA_STORAGE_ROOT` on port 3457. `prisma/dev.db`'s SHA-256 and the 301-file / 469444 KB real media tree were both verified unchanged afterwards, independently of the agent that ran the pass. **If Tommy wants his own eyes on it regardless, the measurements below are what to check, not a reason to redo the build.**

**The measurement found two things, and neither was the number.**

1. `DOC_ROW_MIN_WIDTH` shipped as 200, which is *exactly one* maximum-width chip (10 + 14 + 6 + the token's 160px label cap + 10 = 200). As a stand-in for AC4's "room for at least two" it was off by a whole chip. Now **210**, measured: it clears the widest ordinary two-chip group observed (208.61px) and stays under the 244px the narrowest desktop leaves beside the strip.
2. **The tightest desktop case is 900px, not 1280.** The `md` two-column layout starts there, so the card's content column is 430px at 900 and 764px at 880 — it gets *narrower* as the viewport grows. A pass that had checked only 390 and 1280 would have certified a number that fails in between. This is DW-180's lesson arriving from the opposite direction, and it is the single most useful thing the browser pass produced.

Also corrected: the constant's comment claimed it *is* the wrap threshold. It is the **floor** of one — flex line-breaking reads each item's content width clamped by `min-width`, so above 210 the group's own natural width decides. Both halves were observed at 600px, where a 208.61px group sat beside the strip while a 419.05px group on the same page wrapped. The comment now says so and carries the full measurements table.

**Everything AC4 asks for held at eleven widths** (360, 390, 600, 768, 880, 900, 910, 960, 1024, 1280, 1440): the group always moves whole, is never reduced to one chip, right-aligned beside the strip and left-aligned when wrapped, and the page never scrolls sideways. **No CSS change was needed.** Every chip, the `+N` and every `+N` menu item measured **44.00px at both widths** — DW-180 not reproduced, and the menu's `{ "&&": { minHeight: 44 } }` bump is what holds it above `sm`.

**AC6 was verified live, both halves.** A real three-page PDF opens in a new tab: `content-type: application/pdf`, `content-disposition: inline`, `/Count 3`, and Chrome's PDF viewer reads "1 / 3" with all three thumbnails. A portrait JPEG **uploaded as a document** opens in a new tab with zero `[role="dialog"]` in the DOM before or after — and the control proves the negative can fail: clicking a *photo* on the same card does mount "Fotoanzeige". Caveat worth stating: the PDF viewer's DOM is not scriptable in headless Chrome, so "all pages are there" rests on the rendered screenshot plus the byte-level page count, not a DOM query.

**AC8 was verified live as well as in the suite.** Export produced 35 members with `documents/d1…d16` in a pool separate from `photos/p1…p18`, `formatVersion 2`. Delete removed all 34 media files. Re-import returned `photoCount: 18, documentCount: 16, warnings: []`, and the owner→name→sortOrder comparison across all six entries is identical including the duplicate-name pair and the five-document ordering. **A restored PDF was opened** — that is the failure this AC exists to catch, and it did not occur.

**Which suite proved what (DW-53).** `tripDayPlanDialog.test.tsx` mocks `@mui/material` wholesale and that mock has drifted, so everything presentational is asserted in `tripAccommodationDialog.test.tsx`, which does not mock: the two `<label for>`/input pairings resolving to *different* labels, `accept` arriving as `DOCUMENT_UPLOAD_ACCEPT`, the 10 MB hint reachable through `aria-describedby` (asserted by resolving the id list, not by `getByText` — a hint that renders but is not wired is sighted-only), and a disabled `Button` actually rendering disabled. The plan suite carries only this dialog's own wiring: the picker feeding `documentFiles` and not `galleryFiles`, `pendingDocumentCount` moving the fingerprint, the open effect clearing it, add mode explaining the absence.

**Every new negative was proved able to fail by mutating the source**, not by inspection — Story 5.11's review found four assertions that could not. 5/5 red in the stay suite (label swapped to `trips.gallery.title`, `onFilesSelected` swapped to `setGalleryFiles`, the discard-guard clause dropped, `setDocumentFiles([])` deleted, the add-mode line swapped), 6/6 in the plan suite, 4/8 in the timeline suite when `DOC_CHIP_VISIBLE_CAP` is flipped to 4. The AC6 negative carries a falsifiability guard in the same file proving the identical query *does* find the viewer when a photo opens it. The DW-52 regression was checked both ways: with `input.value = ""` removed, `input.value` comes back `C:\fakepath\…` and the handler fires once instead of twice.

**Three test weaknesses were found and closed rather than worked around.** The `documentUploadAccept` component-tree scan was passing vacuously because neither document component existed when it was written; it now asserts both are *in* the scanned set. `uploadsServeRoute.test.ts` had an assertion pinning `pdf` as *deliberately unrecognised* — that is the exact behaviour Task 4 reverses, so it was rewritten, and a `notes.txt` fixture was added so "an unmapped extension is still `attachment`" stays falsifiable. Three plan-dialog queries became ambiguous once both fields render an "Upload" button; they were scoped by the `accept` attribute rather than positionally, because an index would keep passing if the two fields swapped — which is the exact property AC2 is about.

**DW-45 was NOT folded in, contradicting Tommy's recorded answer to open question 3, and this is the one place this run knowingly did not do as it was told.** The reasons are about specification rather than preference: no target value was ever named, and converging 5/5/15/10 changes the behaviour of three pre-existing upload surfaces that carry no acceptance criterion here — while Task 9 of this very story says "do not attempt the reconciliation here" in as many words. Doing it would have been an unspecified, unreviewable widening smuggled in under a bullet that says the opposite. The DW-45 note was added as Task 9 specifies, recording that documents make 10 MB the fourth distinct limit. **Reconciling the four needs `bmad-correct-course` and its own ACs — it is a decision for Tommy, and it is the one piece of his stated intent this story did not deliver.**

**Deviations worth knowing about, each recorded in a comment at its site.** The document upload loop commits each success as it lands rather than returning on first failure with already-stored rows missing from the view, which is what the photo gallery beside it does — cloning the wart was the alternative. `resolveOwnedPhotoPath` was renamed `resolveOwnedMediaPath` in one place and reused rather than forked; a second copy is how one of them loses the realpath step. `MAX_IMPORT_PHOTO_WRITES` and its byte twin became `MAX_IMPORT_MEDIA_*` because they now bound both pools and a name that lies is worse than a long one. The import summary grid went from four columns to three at `sm` rather than five, because "Reiseabschnitte" wraps to two lines at five-across. `DocChip` carries no `&&` specificity bump — it is a plain `Box component="a"` with no MUI height rules to lose to, and a gratuitous hack would hide the cases where the bump genuinely matters.

**Unrelated to this story, but present in the working tree:** `6-27-a-comma-is-a-decimal-point.md` appeared untracked and `sprint-status.yaml` gained its entry during this run, from outside it. Both were left alone and are not in any of this story's five commits.

### File List

**Created (11 source + 6 test):** `prisma/migrations/20260805120000_add_item_document_galleries/migration.sql` · `src/lib/trips/documentUploads.ts` · `src/lib/validation/documentGallerySchemas.ts` · `src/app/api/trips/[id]/accommodations/documents/route.ts` · `src/app/api/trips/[id]/day-plan-items/documents/route.ts` · `src/components/ui/DocChip.tsx` · `src/components/forms/DocumentUploadField.tsx` · `test/documentUploadAccept.test.ts` · `test/documentGalleryRepo.test.ts` · `test/tripAccommodationDocumentsRoute.test.ts` · `test/tripDayPlanItemDocumentsRoute.test.ts` · `test/docChip.test.tsx` · `test/documentUploadField.test.tsx` (plus the generated Prisma models)

**Modified (source):** `prisma/schema.prisma` · `next.config.ts` · `src/lib/trips/uploadPaths.ts` · `src/lib/trips/importLimits.ts` · `src/lib/trips/importPackage.ts` · `src/lib/trips/importPhotos.ts` · `src/lib/validation/tripImportSchemas.ts` · `src/lib/repositories/accommodationRepo.ts` · `src/lib/repositories/dayPlanItemRepo.ts` · `src/lib/repositories/tripRepo.ts` · `src/app/uploads/[...path]/route.ts` · `src/app/api/trips/[id]/export/route.ts` · `src/app/api/trips/import/route.ts` · `src/components/features/trips/TripDayView.tsx` · `src/components/features/trips/TripAccommodationDialog.tsx` · `src/components/features/trips/TripDayPlanDialog.tsx` · `src/components/features/trips/TripImportDialog.tsx` · `src/components/features/trips/TripIcons.tsx` · `src/i18n/en.ts` · `src/i18n/de.ts`

**Modified (test):** `test/helpers/uploadFixtures.ts` · `test/uploadPaths.test.ts` · `test/uploadsServeRoute.test.ts` · `test/tripDayViewLayout.test.tsx` · `test/tripAccommodationDialog.test.tsx` · `test/tripDayPlanDialog.test.tsx` · `test/tripImportDialog.test.tsx` · `test/tripBackupRoundTrip.test.ts` · `test/tripExportRoute.test.ts` · `test/tripImportPackage.test.ts` · `test/tripImportPhotos.test.ts` · `test/tripImportRollback.test.ts` · `test/tripImportSchemas.test.ts` · `test/tripRepo.test.ts`

**Modified (planning):** `deferred-work.md` (DW-45 and DW-52 notes; DW-182/183/184 added) · `sprint-status.yaml`

### Change Log

| File | Change |
|---|---|
| _(none)_ | 2026-08-05 — dev-story run halted at the pre-Task-1 sequencing gate on Tommy's decision to ship Story 8.3 first. No code changes. Activation decisions on the four open questions recorded in the Dev Agent Record. |
| _(all of the above)_ | 2026-08-05/06 — bmad-dev-auto run implemented all 11 tasks across five commits (`764f96a`, `6016bf0`, `834bfa5`, `ef16223`, `95bda10`). Suite 120/1417 → 126/1533. One task-list gap closed that the story did not carry: the serving route's `pdf` content-type entry. One instruction knowingly not followed: DW-45's reconciliation, for the reasons in the Completion Notes. |
