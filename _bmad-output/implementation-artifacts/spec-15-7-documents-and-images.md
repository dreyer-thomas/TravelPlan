---
title: 'Story 15.7: Documents and Images'
type: 'feature'
created: '2026-10-29'
status: 'awaiting-operator'
baseline_revision: 'a2996a1'
final_revision: '1f6a753'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-15-context.md'
warnings: ['oversized']
operator_actions:
  - 'Deploy this revision to production with MCP_ENABLED=true (no migration: this story adds no schema change).'
  - 'In Claude, with the TravelPlan connector connected, ask it to attach a ticket PDF by https URL to an activity on a day; confirm the document chip shows the KI/AI badge on that activity in the day view.'
  - 'Open that day''s document packet (and optionally email the day) and confirm the attached ticket is included.'
---

<intent-contract>

## Intent

**Problem:** The connector can plan activities, stays, legs and costs, but cannot read the tickets already attached nor attach new ones. Tickets Claude finds still have to be uploaded by hand, or they miss the day packet and the day email.

**Approach:** Add three connector tools on the 15.4 rails:
- `get_file` returns a document or image as an MCP embedded resource.
- `attach_file` takes inline base64 or an https URL (through the 15.1 guarded fetcher). It checks the type by content and writes into the same folders and rows as the app's uploads.
- `delete_file` removes the row and keeps the file for undo.

Two new receipt kinds, `fileAttached` and `fileDeleted`, make both writes undoable for 14 days.

## Boundaries & Constraints

**Always:**
- **Access:** every tool gates with `startWrite` / `requireWritableTrip`, so viewer-only, unknown or foreign trips answer `Trip not found`.
  - An unknown file id, or one not on this trip, answers `File not found`.
  - An unknown target answers `Activity not found` / `Stay not found`.
  - Tools never use Prisma. New DB code lives in repositories.
- **File identity:** a file id is the id of a row in one of four tables: `DayPlanItemDocument`, `DayPlanItemImage`, `AccommodationDocument` or `AccommodationImage`.
  - A new `connectorReadRepo.findFileForPlanner({userId, tripId, fileId})` returns `{media: "document"|"image", target: "activity"|"stay", parentId, parentTitle, tripDayId: string|null, url, fileName, updatedAt, aiChangedAt}` or `null`.
  - `tripDayId` is null for a parked activity. For an image, `fileName` is the URL's last segment (`fileNameOfUrl`).
  - `get_day` file entries gain `updatedAt` (ISO), next to `id` and `fileName`.
- **`get_file(tripId, fileId)`** (read-only annotations):
  - It resolves the stored URL to disk only inside the trip's upload tree. The path must lie inside `getTripUploadDir(tripId)` both lexically and after `fs.realpath`, as `dayPacket.ts` checks.
  - If the URL is outside the tree, external, or missing on disk, it answers metadata only, with `available: false`, and reads nothing.
  - The metadata is `{id, fileName, media, target: {type, id}, mimeType, sizeBytes, updatedAt, aiChangedAt, available}`.
  - `mimeType` is sniffed from the content (`sniffDocumentContentType`) and falls back to the extension.
  - Up to 10 MB (`fs.stat` first), the content is `[text JSON metadata, {type:"resource", resource:{uri:"travelplan://trips/<tripId>/files/<fileId>", mimeType, blob: base64}}]`, with `structuredContent` = metadata.
  - Over 10 MB it returns metadata only (`available: true`) and adds a `note` saying the file is too large to transfer.
- **`attach_file(tripId, target: "activity"|"stay", id, fileName, as?: "document"|"image" = "document", contentBase64? | url?)`:**
  - Exactly one of `contentBase64` and `url` is given; otherwise the call is refused.
  - **Order of checks:**
    1. `startWrite`
    2. the target lookup (writer-scoped)
    3. `sanitizeDocumentFileName(fileName)`, refusing when nothing usable is left
    4. for a document, a pre-check of the 10-document limit (`MAX_DOCUMENTS_PER_ENTRY`, refusal `DOCUMENT_LIMIT_ERROR_MESSAGE`)
    5. the upload rate limit: `checkRateLimit("mcp-upload:<userId>", 20, 3_600_000)`, refusing with "Upload limit reached (20 per hour); try again later."
    6. obtaining the bytes
    7. the type check
    8. the disk write
    9. the transactional row insert
  - **Limits:**
    - Inline content must be strict base64 with at most 1 MiB decoded.
    - A URL download is capped at 10 MiB for a document and 5 MiB for an image (the app's image limit).
    - Empty content is refused.
  - **URL:** `guardedFetch(url, {maxBytes: limit, timeoutMs: 15_000, maxRedirects: 3})`, called through an exported `fileToolDeps.fetch` seam.
    - A non-2xx status is refused with "The download failed (HTTP <status>)."
    - Each `GuardedFetchFailure` maps to a short reason:
      - `invalid_url`: "Only https URLs on port 443 with a host name are accepted."
      - `blocked_address`: "That address is not public."
      - `too_large`: "The file is larger than <N> MB."
      - `timeout`: "The download took longer than 15 seconds."
      - `redirect` / `too_many_redirects`: "Too many redirects."
      - `dns_failed` / `network`: "The download failed."
    - Every failure writes nothing.
  - **Type by content only:**
    - A document must sniff as PDF, JPEG, PNG or WebP (`sniffDocumentContentType`).
    - An image must sniff as JPEG, PNG or WebP (`sniffPhotoContentType`).
    - The name, the URL and the server's `content-type` are ignored.
    - The refusal names the accepted types.
    - The on-disk extension comes from the sniffed type.
  - **Placement:** the folders and URL forms are exactly those of the app's POST routes.
    - Activity on a day: `getDayPlanItem{Document,Image}UploadDir` and `/uploads/trips/<t>/days/<d>/day-plan-items/<i>[/documents]/<name>`.
    - Parked activity: `getParkedDayPlanItem…UploadDir` and `/uploads/trips/<t>/parked/day-plan-items/<i>[/documents]/<name>`.
    - Stay: `getAccommodation{Document,Image}UploadDir` and the app's stay URL form.
    - The disk name is `doc-<ms>-<rand>.<ext>` or `img-<ms>-<rand>.<ext>`.
    - The bytes are written unchanged; the app does no image processing either.
    - The file is removed again on any refusal or throw after it was written.
  - **Write:** one transaction in a new `src/lib/repositories/connectorFileRepo.ts` `attachFileForConnector`.
    - Re-read the parent, scoped to trip and writer. If it is gone, or (for an activity) its `tripDayId` differs from the one the folder was built from, throw `ChangedSinceReadError`.
    - Enforce the document limit (`limit_reached`).
    - Set `sortOrder` to max+1.
    - Create the row with `aiChangedAt = now` and the stored `fileName` (documents).
    - Build the `fileAttached` receipt (only when the parent has a day) and call `inTransaction`.
  - **Result:** `{aiChangeId, file: {id, fileName, media, mimeType, sizeBytes, updatedAt}, day?}`, where `day` is the `get_day` shape of the parent's day when it has one.
- **`delete_file(tripId, fileId, updatedAt)`** (destructive annotations):
  - One transaction (`deleteFileForConnector`): re-read the row inside it. A missing row, or a different stamp (`sameInstant`), throws `ChangedSinceReadError`. Then delete the row, build the `fileDeleted` receipt with the full row snapshot (when the parent has a day), and call the hook.
  - **Parent with a day:** the file stays on disk for undo.
  - **Parked activity:** there is no receipt, so no undo. The file is removed after commit exactly as the app's DELETE route does (`resolveManagedItemMediaDir` + `removeManagedMediaFile`).
  - **Result:** `{aiChangeId, deletedFileId, day?}`.
- **`ai_changes`:**
  - New actions are `fileAttached` and `fileDeleted`. `tripDayId` is the parent's day (null when parked). The subject is the file name, capped at 120 code points.
  - Day-bound writes pass `requireReceipt: true`.
  - Notice labels:
    - "File attached: {title}" / „Datei angehängt: {title}"
    - "File deleted: {title}" / „Datei gelöscht: {title}"
  - Also add English `SUMMARIES` in `aiChanges.ts`, and list the new actions in its description.
- **Receipt kinds** (additive, version 3; every exhaustive switch, wire mapping, strict schema, `receiptHasSideEffects`, `summarizeDayChangeReceipt`, `findInvalidity` and undo phases cover them):
  - `fileAttached {target, media, parentId, fileId, url, updatedAt}`
    - `tripDayId` is the parent's day.
  - `fileDeleted {target, media, previous}`
    - `previous` is the existing `DayPlanItemImageRow`, `DayPlanItemDocumentRow`, `StayImageRow` or `StayDocumentRow` matching `target` and `media`.
  - **`findInvalidity`** requires all of these:
    - no moved items and no removed legs
    - `previous`/`parentId` consistent
    - the URL inside the trip's upload tree (`isInsideTripUploadTree`), except an external image URL in `fileDeleted`
- **Undo of `fileAttached`:**
  - Phase 1 is stale when the row is gone, its stamp or parent changed.
  - Phase 2 is a conditional `deleteMany` (id + `updatedAt`) on the row.
  - The undone result carries `removedFiles: {storedUrl, allowedDir}[]`.
    - `allowedDir` is the parent's own folder: `resolveManagedItemMediaDir` for activities; the stay's `getAccommodation…UploadDir` built from the URL's day segment (`readStoredMediaDayId`) for stays.
    - `runDayChangeUndo` unlinks those files after commit with `removeManagedMediaFile`. Failures are logged and never turn the undo into an error.
- **Undo of `fileDeleted`:**
  - Phase 1 is stale when any of these holds:
    - the parent is gone
    - the id exists again
    - a document's parent already holds 10 documents
    - the kept file is missing on disk (non-external URLs)
  - Phase 2 recreates the row with its id, stamps, `aiChangedAt` and `fileName`. It keeps the original `sortOrder` when free, otherwise it uses max+1.
- **Kept-file expiry:**
  - `insertAiChangeInTransaction`'s retention `deleteMany` no longer deletes rows with `action: "fileDeleted"`, `undoneAt: null` and a non-null receipt.
  - A new `sweepExpiredFileDeletions(now)` in `aiChangeRepo` handles those rows. It reads the expired ones, deletes them, and then, after the delete, unlinks each kept file. It skips a file whose URL a media row references again, and confines each unlink to the parent folder as in undo.
  - `startWrite` calls it best-effort: errors are logged and never fail the tool.
- **Badge:**
  - The GET handlers of the four app media routes add `aiChangedAt` to each document and image.
  - `DocChip` gains `aiChanged?: boolean` and renders `<AiBadge>` after the label.
  - The day view passes it for activity and stay document chips.

**Block If:** none. The open choices are decided in Design Notes.

**Never:**
- touching `sprint-status.yaml`
- changing any app route's write behaviour or the client-held receipts
- day images or trip hero images
- OCR or reading ticket contents server-side
- trusting the file name, URL extension or response `content-type` for the type
- logging argument contents (base64 or URL)
- following redirects outside `guardedFetch`
- returning storage paths or `/uploads` URLs to the model

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Inline PDF to activity | activity on day 1, `contentBase64` of a small PDF, `fileName` "ticket.pdf" | document row with `aiChangedAt`, file under the activity's documents folder, `ai_changes` `fileAttached`; the day packet for day 1 includes it; undo removes row and file | — |
| URL image to stay | stay day 2, `as: "image"`, URL stub returns PNG with `content-type: text/html` | image row on the stay, PNG on disk, receipt `fileAttached` | — |
| Too large | inline >1 MiB decoded; URL document >10 MiB (`too_large`) | refused | nothing written, no row, no file |
| Wrong type, PDF name | `fileName` "ticket.pdf", bytes are HTML | refused naming PDF/JPEG/PNG/WebP | nothing written |
| SSRF | URL `https://127.0.0.1/x`; host resolving to `10.0.0.5`; host resolving to `169.254.169.254`; public host redirecting to a host resolving to `192.168.1.1` | refused (`invalid_url` / `blocked_address`) | nothing written |
| Limit | activity with 10 documents | refused with `DOCUMENT_LIMIT_ERROR_MESSAGE` | no fetch, nothing written |
| Upload rate | 21st attach in one hour | refused | — |
| get_file | small PDF; file >10 MiB on disk; row whose URL points into another trip | resource blob equal to bytes; metadata only; metadata `available: false` | — |
| delete + undo | document on day 1 | row gone, file kept; undo restores row (id, name, order, marker) | stale if the parent was deleted |
| Expiry | `fileDeleted` row 15 days old, not undone | the next connector write's sweep deletes the row and unlinks the file | — |
| Viewer | any of the three tools | `Trip not found` | — |

</intent-contract>

## Code Map

- `travelplan/src/lib/mcp/tools/stayWrite.ts`: the model for a new tools file (`registerTool`, `runTool`, `startWrite`/`isCaller`, `recordChange(..., {requireReceipt})`, `writeErrorResult`, `readDay`, `toolResult`).
- `travelplan/src/lib/mcp/toolRuntime.ts`: annotations, `TRIP_NOT_FOUND`, `idSchema`, `toolResult`. `src/lib/mcp/server.ts`: registration.
- `travelplan/src/lib/security/rateLimit.ts`: `checkRateLimit(key, limit, windowMs)`.
- `travelplan/src/lib/http/guardedFetch.ts`: `guardedFetch(url, options, deps)` and the `GuardedFetchFailure` reasons.
- `travelplan/src/lib/trips/importPackage.ts`: `sniffDocumentContentType` and `sniffPhotoContentType`. `src/lib/trips/documentUploads.ts`: `MAX_DOCUMENTS_PER_ENTRY`, `DOCUMENT_LIMIT_ERROR_MESSAGE`, `sanitizeDocumentFileName`.
- `travelplan/src/lib/trips/uploadPaths.ts`: the upload directory helpers, `resolveStoredMediaPath`, `mediaPathIsInside`, `getTripUploadDir`, `resolveManagedItemMediaDir`, `readStoredMediaDayId`, `isExternalMediaUrl`. `src/lib/trips/mediaCleanup.ts`: `removeManagedMediaFile`.
- `travelplan/src/lib/trips/dayPacket.ts` (lines ~79–112): the lexical and realpath containment pattern for `get_file`.
- `travelplan/src/app/api/trips/[id]/{day-plan-items,accommodations}/{documents,images}/route.ts`: the app's upload folders and URL forms (POST), the delete cleanup (DELETE), and the GET response mapping (gains `aiChangedAt`).
- `travelplan/src/lib/repositories/connectorReadRepo.ts` (`mediaSelect`) + `src/lib/mcp/plannerShapes.ts` (`toFiles`, `fileNameOfUrl`): add file `updatedAt` and `findFileForPlanner`.
- `travelplan/src/lib/trips/dayChangeReceipt.ts`, `src/lib/validation/dayChangeReceiptSchemas.ts`: the kinds, the media row types and schemas, the wire switch, `receiptHasSideEffects`, `summarizeDayChangeReceipt`.
- `travelplan/src/lib/repositories/dayPlanChangeRepo.ts`: `findInvalidity`, `undoInTransaction` phases (as `stayCreated`/`stayDeleted` do), `isInsideTripUploadTree`, the undone result type. `src/lib/trips/dayChangeUndo.ts`: post-commit removal.
- `travelplan/src/lib/repositories/aiChangeRepo.ts`: `AiChangeAction`, `insertAiChangeInTransaction` retention, the new sweep. `src/lib/mcp/tools/aiChanges.ts`, `src/components/features/trips/AiChangesNotice.tsx`, `src/i18n/{en,de}.ts`: actions and labels.
- `travelplan/src/components/ui/DocChip.tsx`, `src/components/ui/AiBadge.tsx`, `src/components/features/trips/TripDayView.tsx` (`GalleryDocument` type ~462, document fetches ~2065/2107/2158, `DocChip` ~2884).
- Tests: `test/helpers/{mcpClient,connectorWriteFixtures,uploadFixtures}.ts` (widen `content` typing for resource blocks), `test/mcpStayWriteTools.test.ts` (pattern), `test/guardedFetch.test.ts` (`buildDeps` fakes for DNS/request), `test/tripDayDocumentPacketRoute.test.ts` (packet), `test/dayChangeReceipt*.test.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/trips/dayChangeReceipt.ts` + `src/lib/validation/dayChangeReceiptSchemas.ts`: the `fileAttached` and `fileDeleted` kinds, their types, wire mapping, strict schemas, and the side-effects and summary cases.
- [x] `src/lib/repositories/dayPlanChangeRepo.ts`: `findInvalidity`, undo phases 1 and 2 for both kinds, and `removedFiles` in the undone result. `src/lib/trips/dayChangeUndo.ts`: unlink `removedFiles` after commit.
- [x] `src/lib/repositories/connectorFileRepo.ts` (new): `attachFileForConnector` and `deleteFileForConnector`, each with `inTransaction`.
- [x] `src/lib/repositories/connectorReadRepo.ts` + `src/lib/mcp/plannerShapes.ts`: `findFileForPlanner` and file `updatedAt` in `get_day`.
- [x] `src/lib/repositories/aiChangeRepo.ts`: the new actions, the retention exclusion, `sweepExpiredFileDeletions`. `src/lib/mcp/tools/activityWrite.ts` `startWrite`: call the sweep best-effort.
- [x] `src/lib/mcp/tools/fileTools.ts` (new): `get_file`, `attach_file`, `delete_file`, `fileToolDeps`. Register them in `server.ts`.
- [x] `src/lib/mcp/tools/aiChanges.ts`, `AiChangesNotice.tsx`, `en.ts`, `de.ts`: the two actions and their labels.
- [x] The four media GET routes, `DocChip.tsx`, `TripDayView.tsx`: `aiChangedAt` and the badge on document chips.
- [x] Tests, new `test/mcpFileTools.test.ts`:
  - every matrix row, for owner and contributor
  - SSRF through the real `guardedFetch` with fake lookup and request deps
  - the packet including a connector-attached document (`buildDayPacket` or the packet route)
- [x] Tests, existing:
  - extend the receipt tests (round-trip, invalidity of both kinds)
  - extend an `aiChangeRepo` or sweep test (expiry)
  - extend a `DocChip` or day-view test (badge)
  - update `get_day` expectations for file `updatedAt`

**Acceptance Criteria:**
- Given a successful `attach_file` or `delete_file`, then exactly one `ai_changes` row exists for it, written in the same transaction. An attached row has `aiChangedAt` set.
- Given `undo_ai_change` on a `fileAttached` change, then the row and its file are gone. Given it on a `fileDeleted` change, then the row is back and the day packet includes the document again.
- Given any refusal in `attach_file`, then no row exists, no file remains in the target folder, and (for refusals before the rate-limit step) no upload slot is used.
- Given the full suite, then typecheck, lint (no new warnings over the baseline of 80), all tests, `check:migrations` and the build pass.

## Spec Change Log

## Review Triage Log

### 2026-10-29 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 6 (high 0, medium 2, low 4)
- defer: 0
- reject: 16 (high 0, medium 3, low 13)
- addressed_findings:
  - `[medium]` `[patch]` **Stale day in `delete_file`.** The change row's day and `requireReceipt` came from the read before the transaction. A parent parked or moved in between could store a change with a mismatched day, or silently lose its undo and remove the file at once. `deleteFileForConnector` now takes `expectedTripDayId` and refuses a vanished or moved parent with "changed since you read it". A test covers it.
  - `[medium]` `[patch]` **Unbounded sweep, orphaned files.** The expiry sweep ran without a bound on a write's request path, and it deleted rows before reading their receipts, so an unreadable receipt orphaned its file without a trace. It now takes at most 25 rows per call, oldest first, and parses before deleting. An unreadable receipt is logged with its change id. Tests cover both.
  - `[low]` `[patch]` **Image names.** An image's change subject used the model's name, which `get_day` never shows. Images now use the stored disk name everywhere, the document-name check no longer refuses image attaches, and the `fileName` description says so.
  - `[low]` `[patch]` **Masked refusals.** A failed cleanup `fs.rm` after a refused attach could mask the refusal; it is now `.catch`ed.
  - `[low]` `[patch]` **Comment placement.** The `aiChangedAt` doc comments were glued onto the `updatedAt` line in four detail types; they now sit on their own line.

## Design Notes

- **Image size cap.** The PRD says "same types and limits as the app". The app caps item and stay images at 5 MB and documents at 10 MB, so a URL image is capped at 5 MiB and a URL document at 10 MiB. Inline content is 1 MiB for both, which keeps the base64 body under the 2 MB `/api/mcp` cap.
- **`as` defaults to `document`.** Tickets are the main case, and a screenshot of a ticket is a document in the app too. A PDF sent `as: "image"` is refused by the photo sniff.
- **Parked activities get no undo.** Every bucket-list connector write already stores `receipt: null` (receipts need a day). An attach or delete there is listed without undo. Because nothing could restore a parked delete, its file is removed at once, like the app does.
- **Kept files are swept, not deleted inside the insert transaction.** An unlink inside a transaction that later rolls back would break a still-valid undo. Excluding these rows from the generic retention `deleteMany` stops them disappearing before their files are cleaned. The sweep runs on every connector write. Rows go first, files after: a crash between the two leaves an orphaned file, never a row whose file is gone.
- **The rate slot is spent before the download.** The 20/hour bound exists to cap outbound fetches and disk writes, so the attempt counts once it reaches the fetch. Earlier refusals (unknown target, bad name, full entry) do not count.
- **Badge scope.** Document chips get the badge, because the ticket is what the production check looks for. Image thumbnails have no label slot and stay unchanged; the marker is still stored and undo restores it.

## Verification

**Commands (in `travelplan/`):**
- `npm run typecheck`: expected clean.
- `npm run lint`: expected 0 errors and ≤80 warnings.
- `npx vitest run test/mcpFileTools.test.ts test/dayChangeReceipt.test.ts test/mcpStayWriteTools.test.ts test/mcpRoute.test.ts`: expected pass.
- `npm test && npm run check:migrations && npm run build`: expected pass.

## Auto Run Result

Status: awaiting-operator

**Summary:** Three connector tools for files:
- `get_file`: an embedded resource up to 10 MB, metadata only above that or when the file is outside the trip's upload tree.
- `attach_file`: inline base64 up to 1 MiB, or an https URL through the guarded fetcher (10 MiB for documents, 5 MiB for images). The type is judged by content only. It enforces the 10-document limit, sanitises names, allows 20 uploads per hour, and writes into the app's own folders, so the day packet and the day email pick documents up.
- `delete_file`: the file stays on disk for undo; a parked activity's file is removed at once, without undo.

The new receipt kinds `fileAttached` and `fileDeleted` cover validation, `findInvalidity` and the undo phases. An attach-undo removes the file after commit. Kept files of expired deletions are cleaned by a bounded sweep on connector writes. The notice gets labels for both actions in en and de, and document chips show the KI/AI badge.

**Files** (under `travelplan/`):
- New:
  - `src/lib/mcp/tools/fileTools.ts`: the three tools
  - `src/lib/repositories/connectorFileRepo.ts`: transactional attach and delete
  - `test/mcpFileTools.test.ts`
- Receipts and undo: `dayChangeReceipt.ts`, `dayChangeReceiptSchemas.ts`, `dayPlanChangeRepo.ts`, `dayChangeUndo.ts`
- Reads: `connectorReadRepo.ts` (`findFileForPlanner`, `findFileParentForPlanner`), `plannerShapes.ts` (file `updatedAt`)
- AI changes: `aiChangeRepo.ts` (actions, retention exclusion, `sweepExpiredFileDeletions`), `activityWrite.ts` (`startWrite` runs the sweep), `aiChanges.ts`, `server.ts`
- UI:
  - the four media GET routes (`aiChangedAt`)
  - `dayPlanItemRepo.ts`, `accommodationRepo.ts` (detail types)
  - `DocChip.tsx`, `TripDayView.tsx`, `AiChangesNotice.tsx`, `en.ts`/`de.ts`
- Tests extended: `aiChangeRepo`, `dayChangeReceipt`, `docChip`, `connectorReadRepo`, `mcpPlannerShapes`, `mcpReadTools`, `mcpRoute`, `helpers/mcpClient.ts`

**Review:** 6 patched (2 medium, 4 low), 0 deferred, 16 rejected. The rejected ones include:
- the sweep runs only on connector writes (by design)
- `get_file` response size (spec)
- the rate slot counted before base64 decoding (spec order)
- the stored document name may carry another extension than the content (app parity)
- duplicated sortOrder logic in the connector repository
- a full-row snapshot without `select`
- no in-use check before unlinking after undo (URLs are unique random names)
- no image-thumbnail badge (Design Notes)
- confining the undo's kept file to the parent folder: tried and reverted, because it would refuse undo for files at legitimate older paths, while the restored row only names the URL it already had

**Follow-up review recommended:** false. The fixes are localized and each one is tested.

**Verification** (in `travelplan/`):
- `npm run typecheck`: clean
- `npm run lint`: 0 errors, 80 warnings (the baseline)
- `npm test`: 253 files, 4040 passed
- `npm run check:migrations`: passed
- `npm run build`: succeeded

**Residual risks:**
- Kept files are only swept when connector writes happen.
- `get_file` can return about 13 MB of base64 per call.
- The production acceptance (a ticket attached by URL appears with the badge and in the packet) is Tommy's manual step; see `operator_actions`.
