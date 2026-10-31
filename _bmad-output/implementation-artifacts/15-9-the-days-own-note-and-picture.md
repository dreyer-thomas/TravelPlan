---
baseline_commit: 5d86bb8cfd313b041a9a69785b9dd8be32229f70
---

# Story 15.9: The Day's Own Note and Picture

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## ⛔ Prerequisites — read before starting

- **Stories 15.4, 15.7 and 15.8 are done.** `src/lib/mcp/tools/fileTools.ts` must have `get_file`, `attach_file` and `delete_file`, and `src/lib/mcp/fileLinkShapes.ts` must exist. Otherwise you are on the wrong base.
- **Source of truth:** Story 15.9 in `epics.md`, added 2026-10-31, and `sprint-change-proposal-2026-10-31-connector-day-and-route.md`. This story reverses one line in the "Out of scope" of 15.6 and 15.7: the day picture is now in scope. The trip's hero picture stays out of scope.
- **Sequencing note:** the proposal orders 15.10 before 15.9. Tommy asked for 15.9 to be created now. The two stories share no code, so either order works. If 15.10 has landed first, rebase onto it. Its only overlap is `server.ts` registration.
- **This story adds a migration.** Run `npx prisma generate` and commit the regenerated `src/generated/prisma/**`, as 15.4 did. Bump `PRISMA_SCHEMA_TAG` in `src/lib/db/prisma.ts` (see Task 1).

## Story

As someone planning with Claude,
I want Claude to read and change the day's own note and picture,
so that a day Claude planned also has its one-line summary and its picture without me opening the day details.

**FRs covered:** FR53, FR54, FR56 (day note and day picture, amended 2026-10-31), FR57.

## Acceptance Criteria

1. **`get_day` reads the day's own fields.** Besides everything it returns today, `get_day` returns:
   - `note`: string or `null`.
   - `image`: `null`, or `{ id, fileName, downloadUrl, width, height, updatedAt }`.
     - `downloadUrl` is signed with `w=1600`; `width` and `height` are the original oriented pixels, exactly as 15.8 builds them for activity images.
     - `id` is the **day picture's file id, which is the day's id** (see Design decision D1).
     - `updatedAt` is the day's `updatedAt`.
     - An external image URL, an unreadable file or a missing secret gives `downloadUrl`, `width` and `height` all `null`.
   - `updatedAt`: the day's `updatedAt`, ISO.
   - `aiChangedAt`: ISO or `null`.

   Every write tool that returns "the day as get_day shows it" carries the same fields, because they all go through `readDay` → `toLinkedPlannerDay`.

2. **`get_trip` gives presence only.** Per day it adds `hasNote` and `hasImage` (booleans), never the content.
   - `hasNote` is true when the note is non-blank after trimming.
   - `hasImage` is true when `imageUrl` is non-blank.

3. **`update_day(tripId, dayId, note, updatedAt)`** is a new write tool (`WRITE_TOOL_ANNOTATIONS`).
   - **Validation:** `note` is a string or `null`. It is trimmed. An empty result or `null` clears the note. More than 280 characters after trimming is refused with "note must be at most 280 characters" and nothing is written. This is the dialog's own rule (`dayNoteSchema` in `dayImageSchemas.ts`; reuse it, do not copy it).
   - **Stale stamp:** an `updatedAt` that is not the day's current `updatedAt` answers **"Day changed since you read it; read the day again"** and writes nothing. The comparison runs inside the write transaction.
   - **No-op:** a note equal to the stored note after normalisation answers success with `aiChangeId: null` and the day, and writes nothing (no `ai_changes` row, no marker).
   - **Scope of the write:** it changes `note` and `aiChangedAt` only. It **never touches `imageUrl`**.
   - **Errors:** an unknown day answers `Day not found`. A trip the user cannot write answers `Trip not found`.
   - **Result:** `{ aiChangeId, day }`, where `day` is the get_day shape.

4. **`attach_file(target: "day", id: dayId, …)` sets the day picture.**
   - `target` gains `"day"`. For it, `as` defaults to `"image"`. `as: "document"` is refused with "Day pictures must be images (JPEG, PNG or WebP)."
   - **Type check:** the type is decided by content only, through `sniffPhotoContentType`. A PDF, or anything else that does not sniff as JPEG/PNG/WebP, is refused with the same text.
   - **Unchanged 15.7 rules:**
     - exactly one of `contentBase64` or `url`
     - strict base64, at most 1 MiB decoded
     - a URL goes through `fileToolDeps.fetch` / `guardedFetch` (https on 443, public addresses after DNS and on every redirect, at most 3 redirects, 15 s, no credentials), at most 5 MiB (the image cap)
     - empty content is refused
     - the upload rate limit is `UPLOAD_RATE_LIMIT` per hour, spent just before the download
     - the fetch failure texts are the same
   - **Order of checks:**
     1. `startWrite`
     2. the day lookup (writer-scoped; `Day not found`)
     3. the `as` check
     4. the rate limit
     5. obtaining the bytes
     6. the sniff
     7. the disk write
     8. the transaction
   - **Storage:** the file goes into the same folder the dialog's upload writes to, `getTripDayUploadDir(tripId, dayId)`, with the URL form `/uploads/trips/<t>/days/<d>/<name>`.
     - The disk name is `day-<ms>-<rand>.<ext>`. It is deliberately **not** `day.<ext>` (see D2). The extension comes from the sniffed type.
     - The bytes are stored unchanged, as the dialog stores them: there is no image processing on upload in the app either, and `/f/` re-encodes when serving.
   - **Replace:** if the day already has a picture, it is replaced. The old file stays on disk for undo. It is **never deleted while any day still points at it** (Story 8.4).
   - `fileName` is still required by the schema but is not used for a day picture. The picture is known by its disk name, as images are.
   - **Rollback:** the written file is removed again on any refusal or throw after the disk write.
   - **Result:** `{ aiChangeId, file: { id: dayId, fileName, media: "image", mimeType, sizeBytes, updatedAt }, day }`.

5. **`delete_file` with the day picture's id** (the day's id, from `get_day`'s `image.id`) together with the day's `updatedAt`:
   - It removes the picture as the dialog's "Remove" does: `imageUrl` becomes `null`.
   - The file stays on disk for undo. This differs from the dialog, which unlinks it at once (see D2).
   - A stale `updatedAt` answers the existing `FILE_CHANGED` text.
   - A day without a picture answers `File not found`.
   - **Result:** `{ aiChangeId, deletedFileId: dayId, day }`.

6. **`get_file` with the day picture's id** returns it like any image:
   - `target: { type: "day", id: dayId }`, `media: "image"`.
   - The same containment rules apply (`resolveTripFilePath`).
   - An external URL gives `available: false`.
   - Its `downloadUrl` resolves through `/f/{dayId}` (`findFileForSignedLink` gains the day lookup).

7. **The 15.4 rails for every write.** Each write here (`update_day`, a day attach, a day delete):
   - writes exactly **one** `ai_changes` row in the write's own transaction, tied to the day (`tripDayId` = the day);
   - passes `requireReceipt: true`;
   - can be undone from the app's notice and through `undo_ai_change`, unless the day changed since. A changed `updatedAt` makes it stale (409 / "stale").
   - A trip the user cannot write answers *not found*.
   - **Undo** restores the previous `note`, `imageUrl` and `aiChangedAt`.
     - A picture the undo takes away (the connector's new file) is unlinked after commit, confined to `getTripDayUploadDir`.
     - A picture the undo brings back must still be on disk; if it is not, the undo is stale.

8. **The KI/AI marker (FR57).**
   - `trip_days.ai_changed_at` is set by a connector write to the note or picture.
   - It is **cleared by any app write** to the note or picture (both the `POST` and the `PATCH` of `/days/[dayId]/image`).
   - While it is set, the day view shows `<AiBadge>`:
     - next to the hero day title (the place where the note shows)
     - in the Tagesdetails dialog, next to its title
   - The badge goes away in local state as soon as an app save returns, without a reload.
   - **[default; FR57]**

9. **The notice.** The change appears in the day view's "AI changed this day" notice like any other, with labels in en and de.

10. **Kept files expire.** A replaced or removed day picture's file is unlinked when its change leaves the 14-day window, through the existing `sweepExpiredFileDeletions` path.
    - It is skipped while **any** `trip_days.image_url` or media row still names that URL.
    - The unlink is confined to that day's upload directory.

11. **Tests** cover:
    - reading note and picture (with `downloadUrl`/size), `hasNote`/`hasImage`
    - setting and clearing the note, the 280-character limit, a stale `updatedAt`, the no-op
    - a first picture (inline and by URL)
    - a replaced picture, with undo restoring the old one and its file still on disk
    - undo of a first picture removing the new file
    - a PDF refused, `as: "document"` refused
    - a picture removed, then undone
    - the marker set by the connector and cleared by the app's `PATCH` and `POST`
    - a view-only trip answering *not found* in all three tools
    - the expiry sweep keeping a file the day points at again
    - **the stamp round trip**: an app `PATCH` (which writes `updated_at` with raw SQL), then `get_day`, then `update_day` with that `updatedAt` succeeds (see D4)

12. **Production check** (Tommy, manual, after deploy): a day picture set by Claude from a URL appears in the day view with the KI badge, and undo in the app brings back the previous picture.

**Out of scope:** the trip's hero picture (trip-level) **[default]**; several pictures per day; changing the day's date; any change to the dialog's own upload processing.

## Tasks / Subtasks

- [x] **Task 1: Schema, migration, Prisma client** (AC 8)
  - [x] Add `aiChangedAt DateTime? @map("ai_changed_at")` to `model TripDay`, with the same comment as the 15.4 columns (`schema.prisma:186-188`).
  - [x] Write `prisma/migrations/20261101120000_add_trip_day_ai_changed_at/migration.sql` (or a later timestamp): one `ALTER TABLE "trip_days" ADD COLUMN "ai_changed_at" DATETIME;` with a header comment in the style of `20261029180000_add_ai_changes`.
  - [x] Run `npx prisma generate` and commit `src/generated/prisma/**`.
  - [x] Bump `PRISMA_SCHEMA_TAG` in `src/lib/db/prisma.ts` to `"2026-10-31-trip-day-ai-marker"`. Add `TripDay … aiChangedAt` to `cachedClientMatchesCurrentSchema`'s field probe, so a dev server holding an old client rebuilds.
  - [x] Do not export the column in backups. Check `exportTrip`/import in `tripRepo.ts`: day rows are written with explicit fields, so null is the default. Make sure no `...day` spread leaks it into the export JSON.

- [x] **Task 2: App writes clear the marker; app POST stops orphaning** (AC 8, D2)
  - [x] `updateTripDayImageForUser` (`tripRepo.ts:1385`) gets a required `origin: WriteOrigin` (the Epic 15 rule: every repository write takes it, no default).
    - When any `SET` clause is present, add `"ai_changed_at" = ?` with `aiChangedAtFor(origin, now)`. Both app callers pass `"user"`.
    - Return `aiChangedAt` in its result and its raw `SELECT`.
  - [x] `days/[dayId]/image/route.ts`:
    - Both handlers pass `origin: "user"` and return `aiChangedAt` (always `null` from the app) in `day`.
    - **`POST` only:** after a successful update, also remove `updated.previousImageUrl` when it does not name the same file as the new URL. Use `storedMediaUrlsNameSameFile` + `removeManagedMediaFile({ allowedDir: getTripDayUploadDir(tripId, dayId) })`, exactly as `PATCH` already does.
    - Reason: `removeExistingDayImageFiles` only knows `day.<ext>`, so a connector `day-<ms>-<rand>.<ext>` would be orphaned forever. Keep `removeExistingDayImageFiles` as it is.
  - [x] Read paths carrying the day meta:
    - `getTripWithDaysForUser`'s raw `dayMetaRows` query (`tripRepo.ts:1225-1234`) selects `ai_changed_at`, and the day mapping (~1283) returns `aiChangedAt`. Update the `TripWithDays` type.
    - `GET /api/trips/[id]` (`route.ts:64-80` and ~229) returns `aiChangedAt: day.aiChangedAt?.toISOString() ?? null`.
  - [x] `TripDayView.tsx`:
    - `TripDay` type (~328) gains `aiChangedAt?: string | null`.
    - `updateLocalDayMeta` (~3108) and its three callers (upload ~3185, note save ~3228, remove ~3271) set `aiChangedAt: null` from the response.

- [x] **Task 3: Badge in the day view** (AC 8)
  - [x] Render `{day?.aiChangedAt ? <AiBadge sx={{ ml: 1 }} /> : null}` next to the hero `dayTitle` (~3988).
    - The hero title is white on a photo, so check that the badge stays legible there. If the neutral pill disappears on dark photos, wrap it in the hero's existing text-shadow container. **Do not** add a new badge variant without Tommy.
    - Keep the `h5` heading's accessible name intact: put the badge **after** the `Typography`, not inside it, or verify that the name still reads "Day N: note" plus the badge's `aria-label`.
  - [x] In the Tagesdetails `DialogShell` (~5199), show the badge next to the title. If `DialogShell`'s `title` prop is a string only, put the badge at the top of the dialog body instead. Do not change `DialogShell`'s API for this.
  - [x] Extend the existing day-view or AiBadge test: the badge is shown with `aiChangedAt`, absent without it, and gone after a mocked note save.

- [x] **Task 4: Receipt kind `dayDetailsChanged`** (AC 7)
  - [x] `src/lib/trips/dayChangeReceipt.ts`: add the kind, additively at version 3, with a doc paragraph "Story 15.9 …" in the header block (lines ~75-90):
    ```ts
    | {
        kind: "dayDetailsChanged";
        /** The day's post-write stamp; the undo is stale once it moved. */
        updatedAt: T;
        previous: { note: string | null; imageUrl: string | null; aiChangedAt: T | null };
        /** The picture the write set (`null`: the write removed it, or did not touch it). */
        imageUrl: string | null;
      }
    ```
    The receipt's `tripDayId` is the day itself.
  - [x] Cover the new kind everywhere the existing kinds are handled:
    - every exhaustive `never` switch: the wire mapping (~544), `receiptHasSideEffects` (false), `summarizeDayChangeReceipt`
    - the strict schema in `dayChangeReceiptSchemas.ts` (~406-418)
  - [x] `dayPlanChangeRepo.ts`:
    - **`findInvalidity`** (new `dayDetailsInvalidity`):
      - no `movedItems`, no `removedTravelSegments`
      - `edited.imageUrl`, when non-null, is inside `getTripDayUploadDir(tripId, receipt.tripDayId)`: resolved parent equals that dir, i.e. `path.dirname(resolveStoredMediaPath(url)) === path.resolve(dir)`, the 8.4 rule
      - `previous.imageUrl` is `null`, external, or inside the trip's upload tree (`isInsideTripUploadTree`)
    - **Phase 1:**
      - Read the day (`id = receipt.tripDayId`, `tripId`). It must exist, `sameInstant(day.updatedAt, edited.updatedAt)` must hold, and `day.imageUrl` must equal `edited.imageUrl` when the write set a picture. Otherwise throw `UndoStaleError("day changed")`.
      - If `previous.imageUrl` is managed (non-null, not external) and differs from the current URL, its file must exist on disk (`fs.stat` on the resolved path). Otherwise throw `UndoStaleError("kept day picture missing")`.
      - Push `removedFiles: { storedUrl: day.imageUrl, allowedDir: getTripDayUploadDir(tripId, dayId) }` when the current URL is managed and differs from `previous.imageUrl`.
    - **Phase 2:** `tx.tripDay.updateMany({ where: { id, tripId, updatedAt: edited.updatedAt }, data: { note, imageUrl, aiChangedAt: previous… } })`. A `count !== 1` throws `UndoStaleError`.
  - [x] `dayChangeUndo.ts` needs no change: it already unlinks `removedFiles` after commit. Verify this.

- [x] **Task 5: Connector reads** (AC 1, 2, 6)
  - [x] `connectorReadRepo.ts`:
    - `PlannerDay` gains `note`, `imageUrl`, `updatedAt`, `aiChangedAt`. `getPlannerDayForUser` selects them in the target-day read (~184).
    - **See D4 before trusting Prisma's `updatedAt` here.**
  - [x] `PlannerFileRow.target` widens to `"activity" | "stay" | "day"`. `findFileForPlanner` adds a fifth parallel lookup:
    - `tx/prisma.tripDay.findFirst({ where: { id: fileId, tripId, trip: writerTripWhere(…), imageUrl: { not: null } } })`
    - mapped to `{ media: "image", target: "day", parentId: day.id, parentTitle: null, tripDayId: day.id, url, fileName: fileNameOfUrl(url), updatedAt, aiChangedAt }`
    - A blank `imageUrl` counts as none.
  - [x] `findFileForSignedLink` adds the same day lookup (no user filter, as its siblings) → `{ id: day.id, tripId, media: "image", url, fileName }`.
  - [x] `plannerShapes.ts` `toPlannerDay` adds `note`, `image` (built from a `FileLink` keyed by the day id, as `toFiles` builds images), `updatedAt` and `aiChangedAt`.
  - [x] `toTripOverview` adds `hasNote` and `hasImage`.
  - [x] `fileLinkShapes.ts` `toLinkedPlannerDay`: sign the day picture in the same `buildFileLinks` pass. Pass it as an extra `images` entry `{ id: day.id, imageUrl, updatedAt }`, so `readImageSizes` caches it like any other image.
  - [x] Tool descriptions (English, for the model):
    - `get_day`: mention `note` (≤280 chars), `image` and the day's `updatedAt`.
    - `UPDATED_AT_NOTE`: "Every activity, stay, leg and the day itself carries updatedAt…".
    - `get_trip`: mention `hasNote`/`hasImage`.
    - `get_file` / `delete_file` / `fileIdField`: "…or the day picture's id (get_day's image.id)".

- [x] **Task 6: Connector writes** (AC 3, 4, 5, 7)
  - [x] New `src/lib/repositories/connectorDayRepo.ts`. Tools never use Prisma (the Epic 15 rule). It holds two functions, each one `prisma.$transaction` with the writer clause on every read:
    - `updateDayNoteForConnector({ userId, tripId, dayId, note, expectedUpdatedAt, inTransaction })`
      - Re-read the day. Gone → `undefined`/`null` result (`Day not found`). A different stamp throws `ChangedSinceReadError`. An equal note → `{ status: "unchanged" }` with no hook call.
      - Otherwise `tx.tripDay.update({ data: { note, aiChangedAt: now } })`, then the `dayDetailsChanged` receipt with `imageUrl: day.imageUrl`, then `inTransaction(tx, { receipt, itemId: dayId })`.
    - `setDayImageForConnector({ userId, tripId, dayId, imageUrl: string | null, expectedUpdatedAt?: Date, inTransaction })`
      - Used by attach (`expectedUpdatedAt` undefined: a replace needs no stamp, per the AC) and delete (stamp required).
      - Delete of a day with no picture throws `ChangedSinceReadError` (→ `FILE_CHANGED`).
      - Sets `imageUrl` and `aiChangedAt: now` and records the receipt (`previous` = the row before).
    - Use Prisma's `update` (millisecond stamps), **not** the raw `CURRENT_TIMESTAMP` the app path uses.
  - [x] `src/lib/mcp/tools/dayWrite.ts` (new, modelled on `stayWrite.ts`): `registerDayWriteTools` with `update_day`. Register it in `server.ts` under `// Story 15.9.`
    - Reuse `startWrite`, `isCaller`, `recordChange(caller, "dayNoteChanged", dayId, subject, { requireReceipt: true })`, `writeErrorResult` and `readDay`.
    - Map `ChangedSinceReadError` to `"Day changed since you read it; read the day again"`. Add the constant `DAY_CHANGED_SINCE_READ` next to `CHANGED_SINCE_READ` in `activityWrite.ts`.
    - Subject: the new note, or the previous note when clearing; capped at 120 code points.
  - [x] `fileTools.ts`:
    - **Inputs:** `attachInput.target` → `z.enum(["activity", "stay", "day"])`, with descriptions updated (for `day`, `id` is the day's id from get_trip/get_day).
    - **`attach_file`:** branch early for `target === "day"`. Do not push the day through `findFileParentForPlanner`/`placementOf`; give it its own small helper, as `placementOf` is activity/stay-specific.
      - Write `day-<ms>-<rand>.<ext>` into `getTripDayUploadDir(tripId, dayId)`.
      - Call `setDayImageForConnector`, with `recordChange(caller, "dayImageSet", dayId, subjectOf(diskName), { requireReceipt: true })`.
      - Remove the written file on any throw.
    - **`delete_file`:** when `file.target === "day"`, call `setDayImageForConnector({ imageUrl: null, expectedUpdatedAt })` with action `"dayImageRemoved"`. **Never unlink here** (kept for undo).
    - **Exhaustiveness:** `fileMetadata` already maps `target`; make sure every `target` switch or ternary in this file handles `"day"` explicitly, with no fall-through into the stay branch.
  - [x] `aiChangeRepo.ts`:
    - Add `"dayNoteChanged" | "dayImageSet" | "dayImageRemoved"` to `AiChangeAction` with a "Story 15.9" doc line.
    - **Kept files:** widen `keptFileWhere` to the actions that can keep a file: `fileDeleted`, `dayImageSet` and `dayImageRemoved`. A `dayImageSet` without a previous picture keeps nothing; the sweep simply finds nothing to unlink.
    - **The sweep** handles `edited.kind === "dayDetailsChanged"`:
      - The candidate is `previous.imageUrl` when it is non-null, managed and differs from `edited.imageUrl`.
      - Skip it when `mediaRowNamesUrl(url)` **or** any `tripDay.imageUrl === url` (extend `mediaRowNamesUrl` to check `trip_days` too). This matters because the app's `day.jpg` name is reused by later app uploads.
      - Otherwise call `removeManagedMediaFile({ storedUrl, allowedDir: getTripDayUploadDir(row.tripId, receipt.tripDayId) })`.
    - Rename nothing public; keep `sweepExpiredFileDeletions` as the entry point.
  - [x] `aiChanges.ts` `SUMMARIES` and the `list_ai_changes` description list the three new actions:
    - `dayNoteChanged: (s) => \`Changed the day note to ${s}\``
    - `dayImageSet: (s) => \`Set the day picture ${s}\``
    - `dayImageRemoved: (s) => \`Removed the day picture ${s}\``

- [x] **Task 7: Notice labels** (AC 9)
  - [x] `AiChangesNotice.tsx` label map gains the three actions. Keys and texts:
    - `trips.aiChanges.dayNoteChanged`: "Day note changed: {title}" / „Tagesnotiz geändert: {title}"
    - `trips.aiChanges.dayImageSet`: "Day picture set: {title}" / „Tagesbild gesetzt: {title}"
    - `trips.aiChanges.dayImageRemoved`: "Day picture removed: {title}" / „Tagesbild entfernt: {title}"
  - [x] Add them to both `en.ts` and `de.ts`. The i18n parity test must stay green.
  - [x] Check that a successful undo from the notice refreshes the day meta (hero image, title, badge). If the notice's `onUndone` reloads only plan items, make it reload the trip detail fetch (`TripDayView.tsx:1046`).

- [x] **Task 8: Tests** (AC 11). New `test/mcpDayWriteTools.test.ts` (pattern: `test/mcpStayWriteTools.test.ts`, `test/mcpFileTools.test.ts`; helpers `mcpClient`, `connectorWriteFixtures`, `uploadFixtures`, the media root). Run every case for owner **and** contributor, plus a viewer → `Trip not found`.
  - [x] **Reads:**
    - `get_day` with no note/picture gives `note: null, image: null, aiChangedAt: null`.
    - With a PNG day picture, `image.downloadUrl` contains `w=1600` and fetching it through the `/f/` route handler answers 200 `image/…`.
    - An external day image URL gives `null` link fields.
    - `get_trip` `hasNote`/`hasImage`.
  - [x] **`update_day`:**
    - set, then clear (`""` and `null`)
    - 281 characters refused
    - stale stamp refused (row unchanged)
    - no-op gives `aiChangeId: null` and no row
    - `imageUrl` untouched
    - `aiChangedAt` set
    - undo restores the note and the marker (`null`)
  - [x] **`attach_file` day:**
    - first picture inline, and by URL through the real `guardedFetch` with fake deps (as `mcpFileTools.test.ts` does)
    - the file is in the day dir with a `day-` name
    - replace: the old file is still on disk; undo restores the old URL and unlinks the new file
    - undo of a first picture leaves `imageUrl: null` and no new file
    - PDF refused; `as: "document"` refused; nothing written in every refusal
    - undo stale after an app `PATCH` of the note
  - [x] **`delete_file` day:** the file is kept; undo restores it; a stale stamp is refused; a day with no picture answers `File not found`; undo is stale when the kept file was removed from disk.
  - [x] **`get_file` day:** `target.type === "day"`, the blob equals the bytes.
  - [x] **Sweep** (extend the existing `aiChangeRepo` sweep test):
    - a 15-day-old `dayImageRemoved` unlinks the kept file
    - the same, when the day points at that URL again, keeps it
  - [x] **Trip detail route** (`test/tripDetailRoute.test.ts`): each day carries `aiChangedAt` (`null` by default, an ISO string after a connector write). Update the exact day shapes there.
  - [x] **App route** (`test/tripDayImageRoute.test.ts`; keep `test/tripDayImageRollback.test.ts` green):
    - `PATCH` and `POST` clear `ai_changed_at`
    - `POST` over a connector picture removes the connector file
    - `POST` over `day.jpg` still behaves as before
  - [x] **Receipts** (`test/dayChangeReceipt.test.ts`):
    - round-trip of `dayDetailsChanged`
    - invalidity: an `imageUrl` outside the day dir, a `previous.imageUrl` into another trip, side effects present
  - [x] **D4 stamp round trip:** app `PATCH` note → `get_day` → `update_day` with that `updatedAt` succeeds.
  - [x] **Exact-shape tests:** update `mcpPlannerShapes.test.ts`, `mcpReadTools.test.ts`, `mcpFileLinks.test.ts` and every write-tool test that compares a whole day shape for the four new day fields. Keep them exact; do not loosen them to `toMatchObject`.

- [x] **Task 9: Verification** (in `travelplan/`)
  - [x] `npm run typecheck` is clean; `npm run lint` shows 0 errors and ≤80 warnings.
  - [x] `npm test`, `npm run check:migrations` and `npm run build` pass.

### Review Findings

- [x] [Review][Patch] Sweep can unlink a kept `day.<ext>` that a newer pending change still needs. The app reuses `day.<ext>`: app upload → connector replace (change 1 keeps `day.png`) → app upload again (`day.png`) → connector replace (change 2 keeps `day.png`). When change 1 expires, `mediaRowNamesUrl` finds no row naming `day.png`, so the sweep unlinks it and change 2's undo becomes stale early. Also skip the unlink when another not-undone kept-file change names the same URL as `previous.imageUrl` [travelplan/src/lib/repositories/aiChangeRepo.ts:328]
- [x] [Review][Patch] Clearing the note gives the summary "Changed the day note to "<old note>"", which says the opposite of what happened. Use wording that reads correctly for both set and clear, e.g. "Changed the day note: …", matching the app label "Day note changed: {title}" [travelplan/src/lib/mcp/tools/aiChanges.ts:44]
- [x] [Review][Patch] `update_day` caps `note` at `.max(2000)` in the input schema, so a note over 2000 raw characters gets a schema error instead of AC 3's "note must be at most 280 characters" [travelplan/src/lib/mcp/tools/dayWrite.ts:37]
- [x] [Review][Patch] AC 11 / Task 8 lists "a first picture (inline and by URL)", but there is no test for a first picture by URL. The URL path is only tested as a replace [travelplan/test/mcpDayWriteTools.test.ts:357]
- [x] [Review][Defer] Second-precision app stamps: two app saves in the same second share one `updated_at`, so `update_day` and the picture delete miss the second save (D4 known property, the app's raw `UPDATE` is out of scope) [travelplan/src/lib/repositories/connectorDayRepo.ts:58] — deferred, pre-existing
- [x] [Review][Defer] The app's raw read of `trip_days.updated_at` (`getTripWithDaysForUser`) parses the second-precision stamp as local time, so it is off by the UTC offset [travelplan/src/lib/repositories/tripRepo.ts] — deferred, pre-existing
- [x] [Review][Defer] Day-picture "still used" checks match URLs exactly: the sweep's `mediaRowNamesUrl`, the undo's removal and the app POST's previous-file cleanup. Another spelling of the same stored file, or a second day sharing the URL through `PATCH`, can still lose its file [travelplan/src/lib/repositories/aiChangeRepo.ts:295] — deferred, pre-existing

## Dev Notes

### Design decisions (defaults Tommy can overrule; the review will look here first)

- **D1: the day picture's file id is the day's id.**
  - A day has at most one picture and no media row, so there is no other stable id.
  - `get_file`, `delete_file` and `/f/{id}` find it with a fifth lookup next to the four media tables. Ids are cuids, unique across tables in practice; the existing comment at `connectorReadRepo.ts:612` relies on the same property.
  - **Consequence:** a signed link minted for picture A serves picture B if the picture is replaced before the link expires (≤ TTL). That is acceptable for a short-lived link to the same day's picture; record it as a known property, do not engineer around it.
  - `readImageSizes` caches by `(fileId, updatedAt)`, and every day write moves `updatedAt`, so sizes do not go stale.
- **D2: the connector writes a unique name, `day-<ms>-<rand>.<ext>`, not `day.<ext>`.**
  - The dialog's `POST` deletes every `day.*` before it writes (`removeExistingDayImageFiles`). A replace under the same name would overwrite the file the undo must bring back. AC says "the old file is kept for undo".
  - So the connector never reuses `day.<ext>`, and a connector delete leaves the file in place (unlike the dialog's `PATCH`, which unlinks at once and has no undo).
  - Kept files are swept after 14 days through the 15.7 sweep.
  - The app `POST` now also removes the *previous* URL's file (Task 2). Otherwise an app upload over a connector picture would orphan `day-<…>`. This is the only behavioural change to an app route, and it mirrors what `PATCH` already does.
  - The proposal text says "(DW-187 rule)". DW-187 in `deferred-work.md` is the missing orphan sweep. The intended rule is "kept for undo, removed by the expiry sweep, never while referenced", which is what this story implements. It does **not** resolve DW-187 in general.
- **D3: one receipt kind for note and picture** (`dayDetailsChanged`), three actions (`dayNoteChanged`, `dayImageSet`, `dayImageRemoved`).
  - The undo is the same operation for all three: put back `note`, `imageUrl` and `aiChangedAt` if the day has not moved since. The actions differ only in label and in whether a file may be kept.
  - A note-only write stores `imageUrl` = the unchanged current URL. Phase 1 then finds the current and previous URLs equal and unlinks nothing.
- **D4: `trip_days.updated_at` has two writers with different formats. Verify before you rely on it.**
  - The app's `updateTripDayImageForUser` writes `"updated_at" = CURRENT_TIMESTAMP` with raw SQL. In SQLite that is a TEXT `YYYY-MM-DD HH:MM:SS`, at second precision.
  - Prisma (`@updatedAt`, better-sqlite3 adapter) writes its own format, at millisecond precision.
  - This is presumably why `getTripWithDaysForUser` re-reads `image_url`, `note` and `updated_at` with `$queryRawUnsafe` and normalises `Date | string` (`tripRepo.ts:1225-1234`, `1283-1290`).
  - **Before** using `tx.tripDay.findFirst({ select: { updatedAt } })` for `get_day` and the stale check, prove with the AC 11 round-trip test that a day last written by the app reads back as a valid `Date`, and that the `updatedAt` the model gets back compares equal inside `update_day`.
  - If Prisma misreads the TEXT value, read the four day-meta columns with the same raw query plus normalisation in both `getPlannerDayForUser` and the connector transaction, and compare by epoch milliseconds (`sameInstant`).
  - Do **not** change the app's raw `UPDATE` to another format in this story. Out of scope; it has its own history (Story 8.4).
- **D5: the marker placement.**
  - There is no visible "Tagesdetails section" in the day view. The note shows in the hero title (`trips.dayView.titleWithNote`) and the picture is the hero background. The dialog *Tagesdetails bearbeiten* opens from the day menu.
  - So the badge goes next to the hero title and in that dialog. This is the proposal's 4.5 intent ("the existing KI/AI badge component … no new component").

### What exists, and what this story reuses

| Need | Existing | Use |
|---|---|---|
| Day image + note write | `updateTripDayImageForUser` (`tripRepo.ts:1385`), returns `previousImageUrl` | App path only; add `origin` |
| Day upload dir | `getTripDayUploadDir(tripId, dayId)` (`uploadPaths.ts`) | Connector placement, undo/sweep `allowedDir` |
| Safe unlink | `removeManagedMediaFile({ storedUrl, allowedDir, context })`, `storedMediaUrlsNameSameFile` (`mediaCleanup.ts`) | POST cleanup, undo, sweep |
| Note rule | `dayNoteSchema` inside `dayImageSchemas.ts` | Export it and reuse it in `update_day` |
| Bytes, sniff, fetch | `obtainBytes`, `sniffPhotoContentType`, `fileToolDeps.fetch`, `STRICT_BASE64` (`fileTools.ts`) | Day attach |
| Write rails | `startWrite`, `recordChange`, `readDay`, `writeErrorResult` (`activityWrite.ts:263-410`) | All three writes |
| Containment | `resolveTripFilePath` (`tripFilePath.ts`), `isInsideTripUploadTree` (`dayPlanChangeRepo.ts:189`) | get_file, invalidity |
| Links | `buildFileLinks`, `imageFileLink`, `readImageSizes` (`fileLinkShapes.ts`, `files/imageInfo.ts`) | Day picture link |
| Undo core | `undoInTransaction` phases (`dayPlanChangeRepo.ts` ~830 and ~1178), `runDayChangeUndo` (`dayChangeUndo.ts`) | New kind |
| Sweep | `sweepExpiredFileDeletions`, `keptFileWhere`, `mediaRowNamesUrl` (`aiChangeRepo.ts:93, 289-339`) | Kept day pictures |
| Badge | `AiBadge` (`components/ui/AiBadge.tsx`) | Hero + dialog |

### What must not change

- **The dialog's behaviour.** The upload limit (15 MB), the accepted types, the `day.<ext>` naming and the `PATCH` immediate unlink all stay as they are. The one exception is the POST's previous-file cleanup (D2).
- **Story 8.4's containment.** Every unlink goes through `removeManagedMediaFile` with an id-derived `allowedDir`; never a string prefix, never `fs.rm` of a directory.
- **Nothing about storage reaches the model** (15.7). No `/uploads` URL or disk path appears in any result. The day picture is named by id, `fileName` (its disk name) and `downloadUrl`.
- **Logging stays as in Epic 15:** tool, user, trip, outcome. Never the note, the base64 or the URL.
- **The trip hero picture is untouched.** `attach_file` gets no `"trip"` target.
- **`sprint-status.yaml`** is the orchestrator's; dev-story updates only this story's status line.

### Previous story intelligence (15.7, 15.8)

- 15.7's review caught a **stale-day race**: the change row's day was decided before the transaction. Here the day *is* the target, so re-read it inside the transaction and refuse when it is gone. Never trust the pre-transaction read for the receipt's `previous`.
- 15.7 established that **a failed cleanup must not mask a refusal**: `fs.rm(...).catch(() => undefined)`.
- 15.7 bounded the sweep (25 rows per call, oldest first, parse before delete). Keep that; the new kinds go through the same loop.
- 15.8: **exact-shape tests** compare whole day objects. Expect many write-tool tests to need the four new day fields. Update them; do not loosen them.
- 15.8: image links are signed only after a successful size read, and `readImageSizes` is cached. Add the day picture to the same batch; do not do a second disk pass.
- 8.4 (`sprint-status.yaml` history): **a URL prefix is not containment**, and **a note save must never delete the picture**. Your `update_day` writes `note` and `aiChangedAt` only. The AC 3 test asserts that `imageUrl` and the file are untouched.

### Git intelligence (last commits)

- `5d86bb8`: file links end in the served extension. The day picture link must too: it goes through `imageFileLink`, which already does this.
- `dd85166` (15.8): `/f/` route, `fileLinkShapes.ts`, `imageInfo.ts`. This is where the day lookup is added.
- `4653c59`: upload limit is now 50/h (`UPLOAD_RATE_LIMIT`). Use the constant, not a number. Notice OK button / `acknowledgedAt`: badges stay after acknowledge, so there is nothing to change for the day marker.

### Testing standards

- Vitest, real SQLite test DB through the existing setup, a real media root per suite (`uploadFixtures`).
- The MCP client goes through `test/helpers/mcpClient.ts`.
- SSRF and URL cases use the real `guardedFetch` with fake lookup/request deps (`test/guardedFetch.test.ts` `buildDeps`), never a network.
- Set `FILE_LINK_SECRET` as 15.8's suites do.

### Project Structure Notes

- **New files:**
  - `src/lib/mcp/tools/dayWrite.ts`
  - `src/lib/repositories/connectorDayRepo.ts`
  - `prisma/migrations/<ts>_add_trip_day_ai_changed_at/migration.sql`
  - `test/mcpDayWriteTools.test.ts`
- **Files to update:** see the Tasks.
- Naming follows the existing per-area tool files and `connector*Repo.ts`.
- No new dependency.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 15.9] and the Epic 15 rulings line (2026-10-31)
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-10-31-connector-day-and-route.md#2, #4.1, #4.5]
- [Source: _bmad-output/planning-artifacts/prd.md FR53, FR54, FR56, FR57 (amended 2026-10-31)]
- [Source: _bmad-output/implementation-artifacts/epic-15-context.md]
- [Source: _bmad-output/implementation-artifacts/spec-15-7-documents-and-images.md#Boundaries, #Design Notes]
- [Source: _bmad-output/implementation-artifacts/15-8-signed-download-links.md#Dev Notes]
- [Source: travelplan/src/app/api/trips/[id]/days/[dayId]/image/route.ts] (POST/PATCH, 8.4 comments)
- [Source: travelplan/src/lib/repositories/tripRepo.ts:1225-1290, 1385-1465]
- [Source: travelplan/src/lib/mcp/tools/fileTools.ts], [Source: travelplan/src/lib/repositories/connectorFileRepo.ts]
- [Source: travelplan/src/lib/repositories/connectorReadRepo.ts:141-200, 588-736]
- [Source: travelplan/src/lib/repositories/dayPlanChangeRepo.ts:125-190, 300-330, 660-800, 975-1000]
- [Source: travelplan/src/lib/repositories/aiChangeRepo.ts:40-93, 289-339]
- [Source: travelplan/src/components/features/trips/TripDayView.tsx:328, 2508, 3094-3275, 3636, 3988, 5199]

### Questions for Tommy (also listed in the completion report)

1. D1: is the day's id acceptable as the day picture's file id (a link can show a newer picture after a replace)?
2. D5: should the badge go next to the hero title and in the dialog, or only one of them?
3. Should the marker stay a default (FR57), or do you prefer to amend FR57 and rely on the notice (proposal open default 1)?

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (claude-opus-5-5), via bmad-dev-story, 2026-10-31.

### Debug Log References

- D4 probe (throwaway test, removed): Prisma's typed read of a `trip_days.updated_at` written by the app's raw `CURRENT_TIMESTAMP` returns the correct UTC instant (`2026-10-31T20:47:26.000Z`); the app's own raw `$queryRawUnsafe` read of the same value returns local time (`19:47:26Z` on a CET machine, one hour off). A raw read of a Prisma-written `DATETIME` (`ai_changed_at`) comes back as a correct `Date`.
- First full run of the new suite: the stale-stamp `delete_file` case passed a stamp the app had already overwritten, because two app saves in the same second share one second-precision stamp. See Completion Notes, "Known property".
- Mutation checks (each made a named test fail, then reverted): the `POST` previous-file cleanup removed; the "kept day picture missing" disk check removed; `trip_days` dropped from `mediaRowNamesUrl`.

### Completion Notes List

- Ultimate context engine analysis completed: comprehensive developer guide created (2026-10-31).
- **Task 1.** `TripDay.aiChangedAt` plus migration `20261101120000_add_trip_day_ai_changed_at` (one `ALTER TABLE`); Prisma client regenerated; `PRISMA_SCHEMA_TAG` = `2026-10-31-trip-day-ai-marker` with a `TripDay.aiChangedAt` field probe. The export writes day rows field by field, so the marker is not in backups.
- **Task 2.** `updateTripDayImageForUser` takes a required `origin` and writes `ai_changed_at` with every `SET`; both app handlers pass `"user"` and return `aiChangedAt`. The app `POST` now also removes the previous picture when it is another file (`storedMediaUrlsNameSameFile` + `removeManagedMediaFile` in the day's folder), as `PATCH` does. `getTripWithDaysForUser`, `TripDaySummary` and `GET`/`PATCH /api/trips/[id]` carry `aiChangedAt`. `TripDayView` keeps it in local state and clears it from every save response.
- **Task 3.** `<AiBadge>` right after the hero `h5` (the heading flows inline only while the badge is shown, so the hero's DOM and layout without it are unchanged and `tripDayViewLayout`'s title-block test holds; the heading's name stays "Day N: note") and in the day-details dialog through `DialogShell`'s existing `titleAdornment` slot (no API change). The pill is opaque, so it reads on any photo; no new variant.
- **Task 4.** Receipt kind `dayDetailsChanged` (version 3, additive) with wire mapping, strict schema, `dayDetailsInvalidity`, phase 1 (stamp, picture, kept file on disk, `removedFiles` in the day's folder) and phase 2 (conditional `updateMany`). `dayChangeUndo.ts` unchanged: it already unlinks `removedFiles` after commit. **Deviation:** the "picture must sit in the day's folder" rule applies only when the write's picture differs from the previous one (only then does undo remove it), so a note write over an external or imported picture keeps its undo.
- **Task 5.** `get_day` (and every write tool's day) gains `note`, `image` (file id = day id, signed `w=1600` in the same `buildFileLinks` pass), `updatedAt`, `aiChangedAt`; `get_trip` gains `hasNote`/`hasImage`. `findFileForPlanner` and `findFileForSignedLink` gain the day lookup. Descriptions updated.
- **Task 6.** New `connectorDayRepo.ts` (`updateDayNoteForConnector`, `setDayImageForConnector`; day re-read inside the transaction with the writer clause; Prisma `update`). New `dayWrite.ts` with `update_day` (registered under `// Story 15.9.`), reusing `dayNoteSchema` (exported) and mapping its failure to the AC's text. `attach_file` target `day` and `delete_file`/`get_file` with the day's id in `fileTools.ts` through two small helpers (`attachDayPicture`, `removeDayPicture`), never through `placementOf`. Actions `dayNoteChanged`, `dayImageSet`, `dayImageRemoved`; `keptFileWhere` widened to the two picture actions; the sweep handles `dayDetailsChanged` and `mediaRowNamesUrl` also checks `trip_days.image_url`. Note subject: computed inside the hook from the receipt's `previous.note`, so a cleared note is named by what was cleared.
- **Task 7.** Notice labels in en/de. A successful undo from the notice already reloads the whole trip detail (`reloadDayAfterAiUndo` → `loadDay`), which refreshes the hero, title and badge; no change needed.
- **Task 8.** New `test/mcpDayWriteTools.test.ts` (37 tests, owner and contributor, viewer, signed link through `/f/`); extended `aiChangeRepo`, `dayChangeReceipt`, `tripDayImageRoute`, `tripDetailRoute`, `tripDayViewAiChanges`, `mcpReadTools`, `mcpPlannerShapes`, `mcpRoute`, `tripRepo`. The `get_day` and write-tool day comparisons that passed unchanged did so because they compare activities/stays exactly and the day with `toMatchObject`; the `get_day` one now also pins the four new fields.
- **Task 9.** `npm run typecheck` clean; `npm run lint` 0 errors / 80 warnings (baseline); `npm test` 258 files / 4137 tests passed; `npm run check:migrations` passed; `npm run build` ok. The first full run caught one regression (the hero title wrapper broke `tripDayViewLayout`'s title-block test); fixed as described under Task 3, then re-run green.
- **Known property (D4, not changed here):** the app writes `trip_days.updated_at` at second precision. A model that reads a day and an app save landing in the same second share one stamp, so `update_day` / the picture delete would not see that save as a change. The window is under a second and closing it means changing the app's raw `UPDATE`, which D4 puts out of scope. Separately, the app's own raw read of that column (`getTripWithDaysForUser`) parses it as local time; harmless today because the app only uses it to cache-bust the picture URL. Both worth a deferred-work entry.
- **D1 consequence recorded:** a signed `/f/{dayId}` link minted for one picture serves the next one if the picture is replaced before the link expires.
- **Questions for Tommy** (unchanged from the story): D1 (day id as the picture's file id), D5 (badge in both places), whether the marker stays a default (FR57). AC 12 (production check) is Tommy's after deploy.

### File List

- `_bmad-output/implementation-artifacts/15-9-the-days-own-note-and-picture.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `travelplan/prisma/schema.prisma`
- `travelplan/prisma/migrations/20261101120000_add_trip_day_ai_changed_at/migration.sql` (new)
- `travelplan/src/generated/prisma/internal/class.ts`
- `travelplan/src/generated/prisma/internal/prismaNamespace.ts`
- `travelplan/src/generated/prisma/internal/prismaNamespaceBrowser.ts`
- `travelplan/src/generated/prisma/models/TripDay.ts`
- `travelplan/src/lib/db/prisma.ts`
- `travelplan/src/app/api/trips/[id]/days/[dayId]/image/route.ts`
- `travelplan/src/app/api/trips/[id]/route.ts`
- `travelplan/src/components/features/trips/AiChangesNotice.tsx`
- `travelplan/src/components/features/trips/TripDayView.tsx`
- `travelplan/src/i18n/de.ts`
- `travelplan/src/i18n/en.ts`
- `travelplan/src/lib/mcp/fileLinkShapes.ts`
- `travelplan/src/lib/mcp/plannerShapes.ts`
- `travelplan/src/lib/mcp/server.ts`
- `travelplan/src/lib/mcp/tools/activityWrite.ts`
- `travelplan/src/lib/mcp/tools/aiChanges.ts`
- `travelplan/src/lib/mcp/tools/dayWrite.ts` (new)
- `travelplan/src/lib/mcp/tools/fileTools.ts`
- `travelplan/src/lib/mcp/tools/tripRead.ts`
- `travelplan/src/lib/repositories/aiChangeRepo.ts`
- `travelplan/src/lib/repositories/connectorDayRepo.ts` (new)
- `travelplan/src/lib/repositories/connectorReadRepo.ts`
- `travelplan/src/lib/repositories/dayPlanChangeRepo.ts`
- `travelplan/src/lib/repositories/tripRepo.ts`
- `travelplan/src/lib/trips/dayChangeReceipt.ts`
- `travelplan/src/lib/validation/dayChangeReceiptSchemas.ts`
- `travelplan/src/lib/validation/dayImageSchemas.ts`
- `travelplan/test/mcpDayWriteTools.test.ts` (new)
- `travelplan/test/aiChangeRepo.test.ts`
- `travelplan/test/dayChangeReceipt.test.ts`
- `travelplan/test/mcpPlannerShapes.test.ts`
- `travelplan/test/mcpReadTools.test.ts`
- `travelplan/test/mcpRoute.test.ts`
- `travelplan/test/tripDayImageRoute.test.ts`
- `travelplan/test/tripDayViewAiChanges.test.tsx`
- `travelplan/test/tripDetailRoute.test.ts`
- `travelplan/test/tripRepo.test.ts`

### Change Log

- 2026-10-31: Story 15.9 implemented (bmad-dev-story): day note and picture through the connector (`update_day`, `attach_file`/`delete_file`/`get_file` with the day as target, `get_day`/`get_trip` fields), receipt kind `dayDetailsChanged`, `trip_days.ai_changed_at` with the badge on the hero and in the day-details dialog, app `POST` removes a replaced connector picture, kept pictures swept after 14 days.
