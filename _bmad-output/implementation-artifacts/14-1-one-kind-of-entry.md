---
baseline_commit: aacfd32
---

# Story 14.1: One Kind of Entry

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As someone collecting ideas for a trip,
I want a bucket-list entry to be a full activity that simply has no day yet,
so that pictures, documents, costs and duration are never lost on the way to a day and back.

**FRs covered:** FR30 (amended), FR31 (amended); PRD FR35/FR36. **Depends on:** Story 13.1 (done 2026-10-17: `scheduleMode`, `durationMinutes`, `sortOrder`, `scheduleDay`, receipt v3). Architecture review by Winston done 2026-10-18 (uncommitted at the time of writing).

Sources:
- [epics.md#Story 14.1](../planning-artifacts/epics.md)
- [sprint-change-proposal-2026-10-17-bucket-parking.md](../planning-artifacts/sprint-change-proposal-2026-10-17-bucket-parking.md): *Technical impact*, *UX impact*, *Decisions recorded*, and **§6 Architecture Review**
- [architecture.md](../planning-artifacts/architecture.md): *Data Architecture* "Activities without a day"; *API & Communication Patterns* "Parking and scheduling"
- `ux-designs/ux-TravelPlan-2026-07-27/DESIGN.md` `bucket-item`, and `EXPERIENCE.md` bucket-list rows
- [13-1-just-say-how-long.md](13-1-just-say-how-long.md)

All code paths below are relative to `travelplan/`. Line numbers were read on 2026-10-18 at `aacfd32`.

Abbreviations:

| Short | Path |
|---|---|
| `TV` | `src/components/features/trips/TripDayView.tsx` (5149 lines) |
| `PD` | `src/components/features/trips/TripDayPlanDialog.tsx` (3334 lines) |
| `BLP` | `src/components/features/trips/TripBucketListPanel.tsx` (975 lines) |
| `DBLP` | `src/components/features/trips/TripDayBucketListPanel.tsx` (136 lines) |
| `DPIR` | `src/lib/repositories/dayPlanItemRepo.ts` |
| `DCR` | `src/lib/repositories/dayPlanChangeRepo.ts` |
| `DST` | `src/lib/repositories/dayScheduleTransaction.ts` |
| `DCRc` | `src/lib/trips/dayChangeReceipt.ts` |
| `DCRS` | `src/lib/validation/dayChangeReceiptSchemas.ts` |
| `TR` | `src/lib/repositories/tripRepo.ts` |

**Search caveat:** plain `grep` treats `tripRepo.ts` (and some other repos) as binary and silently prints nothing. Use `grep -a`.

## Read this first: where the epic's wording meets the code

Each point was checked against the code, and each one changes or sharpens a task. Items marked **(Q)** are defaults for Tommy to confirm; they are repeated under *Questions*.

1. **Every trip-level reader already excludes parked rows.** Cost totals, the dashboard's raw SQL aggregate (`TR:819-846`, `JOIN trip_days`), `getTripWithDaysForUser`, the gantt, route, map, print, packet and suggestion context all reach activities *through the day* (`tripDay: { tripId }`, `trip.days[].dayPlanItems`). A row with `tripDayId = null` cannot appear in them. **Do not add filters to them.**

   The AC is proven by a test, not by edits. The rule is that only bucket-list reads query `DayPlanItem.tripId`, always with `tripDayId: null`, through `parkedDayPlanItemsWhere(tripId)`. Add `plannedDayPlanItemsWhere(tripId)` (`{ tripId, tripDayId: { not: null } }`) for any future reader by `tripId`. Export both from `DPIR`.

   "Budget runway" does not exist in the code. The day-view budget entries are per day.

2. **Who sees the bucket list is already right.** The proposal says 7.12 made the overview card owner-only. That stopped being true with Story 5.13:
   - `TripTimeline.tsx:1182-1186` gates the card by `canEditPlanning` (owner or contributor).
   - `TV` gates the Day Detail panel the same way.
   - `bucket-list-items/route.ts` uses `refuseUnlessTripWriter` (viewer 403, outsider 404).

   The roles AC is a **regression guard**. Keep the gates and add tests that pin them.

3. **Parked writes stay on `/api/trips/[id]/bucket-list-items`.** The day-plan-items routes require `tripDayId` everywhere, and they return day receipts. Per the architecture, the bucket route keeps its gate and switches to the activity payload. These writes recompute no day, so they return no receipt.

   Scheduling is a new sibling route: `POST /api/trips/[id]/day-plan-items/schedule` with `{ itemId, tripDayId }`, returning `{ data: { item, receipt } }`. It sits next to `move` and `reorder`.

4. **"+" schedules directly; no dialog opens (Q1).** Today "+" opens `PD` prefilled, and Save converts the row (`TV:1001`, `handleAddBucketToDay`). The AC wants the *same activity* to move, so there is nothing to fill in.

   "+" calls the schedule route. The day reloads, the bucket list reloads, and the `ActionNotice` shows *„Wasserfall" eingeplant* with *Rückgängig*. Remove these:
   - `PlanDialogPrefill.bucketListItemId`
   - `buildBucketListPrefill` and `buildBucketListContentJson` (`TV:976-1008`)
   - `bucketListItemId` in `dayPlanItemMutationSchema` (`dayPlanItemSchemas.ts:114`)
   - the conversion `convertBucketListItemToDayPlanItemForTripDay` (`DPIR:696-791`) and the route branch (`day-plan-items/route.ts:136, 162-184`)

   The JSON builder survives only as SQL in the migration and as a TS twin in the import (point 9).

5. **Scheduling uses 13.1's insert path.** Use `planActivityWriteInTransaction(tx, tripId, tripDayId, { kind: "insert", item: { id: item.id, title, scheduleMode: "FLEXIBLE", durationMinutes, fromTime: null, toTime: null } })`. Then write the existing row with a conditional `updateMany({ where: { id, tripId, tripDayId: null, updatedAt: <read> } })`, setting:
   - `tripDayId`
   - `sortOrder`, `fromTime` and `toTime` from `plan.edited`
   - `scheduleMode: "FLEXIBLE"`

   A count of 0 throws `DayPlanChangedError` (409 `day_plan_changed`). Then call `finishActivityWriteInTransaction(..., { kind: "scheduled", itemId, updatedAt, previousUpdatedAt })`.

   A new overflow refuses as `day_plan_past_midnight` with the title, exactly as the conversion does today. 13.2 changes that for every write (Q2). Check that `planDaySchedule`'s `insert` does not depend on `NEW_ITEM_ID` for anything beyond identity (`DST:213-300`).

6. **The `scheduled` receipt must produce a notice.** `receiptHasSideEffects` (`DCRc:327`) is false for a plain `created`, so the take-over shows no notice today. For `scheduled` it must return **true**, because the AC wants *Rückgängig* even when nothing moved. `summarizeDayChangeReceipt` (`DCRc:356`) gets a `scheduled` text that names the title. The receipt does not carry the title, so the client passes it as an option, the way `otherDayIndex` is passed.

   After a successful undo of `scheduled`, `TV`'s `handleUndoDayChange` reloads the bucket list. This replaces the `consumedBucketListItem` check at `TV:1470`.

7. **Media.** Every media path in `PD` needs a `day` (`PD:1230, 1240, 1262, 2229, 2289, 2346, 2411`), and the repo gates `findScopedDayPlanItem*` (`DPIR:325, 346`) scope through the day. Make these changes:
   - **Schemas:** `tripDayId` becomes **optional** in `imageGallerySchemas.ts:27-42` and `documentGallerySchemas.ts:46-55`. GET `?tripDayId` also becomes optional when `dayPlanItemId` is given. Absent means the item must be parked.
   - **Gates:** they scope by `{ id: dayPlanItemId, tripId, tripDayId: tripDayId ?? null, trip: <writer or participant clause via the new relation> }`. The day-wide list functions (`list…ForTripDay`) stay as they are.
   - **Upload directory:** taken from the item's *current* place. Add `getParkedDayPlanItemImageUploadDir(tripId, itemId)` (`<trip>/parked/day-plan-items/<itemId>`) and `getParkedDayPlanItemDocumentUploadDir` (`…/documents`) to `uploadPaths.ts`. The URL becomes `/uploads/trips/<tripId>/parked/day-plan-items/<itemId>/…`.
   - **Delete:** replace `readStoredMediaDayId` (`uploadPaths.ts:279`) with one helper, e.g. `resolveManagedItemMediaDir({ storedUrl, tripId, itemId, kind: "image" | "document" })`. It returns the URL's own folder when that folder is `days/<anyDayId>/day-plan-items/<itemId>[/documents]` or `parked/day-plan-items/<itemId>[/documents]` under this trip, and `null` otherwise (logged and skipped, as today).
   - **Callers:** image DELETE, document DELETE, and the `suggestionsApplied` undo cleanup (`day-plan-changes/undo/route.ts:101-113`) all use it. The undo stops building the folder from `receipt.tripDayId`.
   - **Old pictures:** an activity that was on a day keeps its `days/<d>/…` URLs and can delete them.
   - **Serving:** `src/app/uploads/[...path]/route.ts` checks only the trip and segment safety, so `parked/` is served with no change. Add a test that proves it.

8. **The dialog in parked mode.** Add a prop `placement: "day" | "parked"` (default `"day"`). In parked mode `day` is `null`. Then:
   - **Wann & Wo:** the schedule toggle, the fixed-time fields and the expected-times line are not rendered. Only the duration fields (`PD:1425`) and the place search remain. A new idea starts at **60 min** (as new activities do today, `PD:1091`); an edit starts at the stored duration.
   - **Payload:** `{ title, contentJson, durationMinutes, cost…, payments, linkUrl, location }` with no mode, times or `tripDayId`. POST or PATCH (`itemId`) goes to `/api/trips/${tripId}/bucket-list-items`.
   - **Media:** calls omit `tripDayId`. Add mode still shows the "after save" hints (`PD:3202-3216`), unchanged (DW-153).
   - **Subtitle:** `trips.bucketList.title` instead of "Tag n" (`PD:1345`).
   - **Not offered:** move (`moveTargetDays` and `onMove` not passed) and *Feste Zeit*.
   - **Delete:** offered in edit mode through the existing `onDelete` prop. The parent shows the bucket list's delete confirmation, which stays.
   - **Payments:** `defaultDueDate` falls back to today, as it already does without a day (`PD:832`).
   - **Save errors:** `validation_error` mapping is unchanged.

   `PD` must not call `/day-plan-items` in parked mode. A test spies on `fetch` to prove it.

9. **The migration's JSON must equal the old client builder exactly.** `buildBucketListContentJson` (`TV:976`):
   - It trims description and position text.
   - It includes the position text only when there are **no coordinates** (`!item.location`, i.e. `location_lat IS NULL OR location_lng IS NULL` per `toDetail`; check `bucketListRepo.ts:72`).
   - It falls back to the trimmed title when both are empty.
   - It emits `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":…}]},…]}`.

   In SQL, use `json_object('type','doc','content', json_array(…))` with `json_object('type','paragraph','content', json_array(json_object('type','text','text', x)))`. SQLite's `json_object` keeps key order and escapes like `JSON.stringify` for the texts that occur (check quotes, backslashes, umlauts, emoji, newlines).

   JS `trim()` also strips tabs, newlines and NBSP, while SQL `trim(x)` strips spaces only. Use `trim(x, ' ' || char(9,10,13,160))`, and pin any remaining difference in the migration test.

   Keep a TS twin, `buildParkedContentJson`, in `src/lib/trips/parkedItemContent.ts` (pure, no Prisma). The backup import uses it, and the migration test runs both and compares them byte for byte.

10. **The table rebuild, and what it must keep.** SQLite cannot drop `NOT NULL`, so `day_plan_items` is rebuilt using the `prisma/migrations/20260301105118_add_travel_segments/migration.sql:19-59` pattern.

    Write the new table exactly as Prisma would generate it from the new schema, so that `prisma migrate diff --from-migrations … --to-schema …` reports nothing for `day_plan_items`. Column order follows the model; put `trip_id` where the model declares it. The new table has:
    - `trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE`
    - `trip_day_id TEXT NULL REFERENCES trip_days(id) ON DELETE CASCADE`
    - every 13.1 column with its default
    - the parked `CHECK` (architecture)

    Recreate `idx_day_plan_items_trip_day_id` and `idx_day_plan_items_trip_day_sort_order`, and add `idx_day_plan_items_trip_id_trip_day_id`.

    `cost_payments`, `day_plan_item_images` and `day_plan_item_documents` reference `day_plan_items(id)` by name. With `PRAGMA foreign_keys=OFF` and a rename, they keep working. End with `PRAGMA foreign_key_check` and `PRAGMA foreign_keys=ON`. The `cost_payments` one-target CHECK lives on `cost_payments` and is untouched.

    Prisma cannot express the CHECK. Add a comment in `schema.prisma` like the one on `CostPayment`. A test inserts a violating row and expects SQLite to refuse it.

11. **144 direct test seeds need `tripId`.** `grep -rao "prisma.dayPlanItem.create(" test` finds 144 calls in 32 files, and all of them fail to typecheck once `tripId` is required. Prisma cannot default it.

    Do it as one mechanical pass. Each seed already has the trip in scope; it creates the day from it. Add `tripId` next to `tripDayId`. Do not invent a DB trigger or make the column optional to dodge this.

    The production creates also need `tripId`:
    - `DPIR:642`
    - `daySuggestionApplyRepo.ts:292`
    - `TR:2777` (import)
    - `DCR:198/402` (undo restore: take `tripId` from the undo's params; the receipt snapshot does not carry it, and `DayPlanItemRow` stays unchanged)

12. **Backup.** Today the export walks days only (`TR:1819`, `getTripExportForUser`), so parked rows would silently drop out of backups. Per the architecture:
    - `FORMAT_VERSION` stays 2 (`export/route.ts:38`, additive rule at `:20-37`).
    - The export writes `trip.parkedDayPlanItems[]` in the day-item shape (`TripExportPayload`, `TR:413-496`), with images, documents, payments, `scheduleMode` and `durationMinutes`. It no longer writes `bucketListItems`.
    - The import schema (`tripImportSchemas.ts:519-544`) accepts `parkedDayPlanItems` (optional, default `[]`) and keeps accepting legacy `bucketListItems`. Each legacy item becomes a parked activity: FLEXIBLE, 15 min, `buildParkedContentJson`.
    - Parked media are written under `parked/` (`importPhotos.ts:187-226`: the plan helpers take `tripDayId: string | null`).
    - Overwrite import deletes the trip's parked rows explicitly (today `TR:3209` deletes bucket rows).
    - The import result's `bucketListItemCount` (`TR:535`, `import/route.ts:387`, `TripImportDialog.tsx:442`) keeps its name and counts parked activities, so the dialog text needs no change.
    - Limits: reuse `MAX_IMPORT_BUCKET_LIST_ITEMS` for the sum of both lists.
    - The export does not carry `sortOrder` for parked rows; it is always 0.

13. **Imported day items still get legacy schedule fields.** 13.1 left the day-item export without `scheduleMode`, `durationMinutes` or `sortOrder`. That gap belongs to 13.4 and is not widened or fixed here. Parked items *do* carry `durationMinutes`, because otherwise a round trip would turn a 2-hour idea into 15 minutes. On import, a parked item without a duration (impossible from this version) gets 15.

14. **Undo of `scheduled`.**
    - **`findInvalidity` (`DCR:117`):** `movedItems` must not name the item; `removedTravelSegments` must be empty.
    - **Phase 1 (stale):**
      - the item exists with `tripDayId = receipt.tripDayId` and the receipt's `updatedAt`;
      - no `TravelSegment` references it as `fromItemId`/`toItemId`;
      - the usual `movedItems` checks run (normally empty, because an appended flexible activity moves nobody).

      New pictures or documents do **not** make it stale. Unlike `created`, nothing is deleted.
    - **Phase 2:**
      - conditional `updateMany` back to `tripDayId: null`, `FLEXIBLE`, times null, `sortOrder: 0`, `updatedAt: previousUpdatedAt`;
      - then `renumberDayInTransaction` for the day;
      - then the generic `movedItems` restore.
    - Wire the new kind through all three exhaustive switches (`DCRc:285`, `DCR:354`, `DCR:459`) and the zod union (`DCRS`, `.strict()`).
    - Remove `consumedBucketListItem`, `TripBucketListItemRow` and `bucketListRowSchema`, plus their branches (`DCR:188-191, 368-373, 385-386`).
    - Leave `version: z.literal(3)` as it is; it does not need to change.
    - Do **not** add the `parked` kind. That is 14.2.

15. **Deleting a parked activity** goes through `DELETE /bucket-list-items` with `{ itemId }` and keeps its confirmation dialog (`BLP:943-972`). Inside one transaction it:
    1. reads the image and document URLs;
    2. runs `deleteMany({ id, tripId, tripDayId: null })` (the cascade removes images, documents and payments);
    3. after commit, calls `removeManagedMediaFile` for each URL with the dir from point 7;
    4. then runs `fs.rmdir` on the empty `parked/day-plan-items/<id>` folders, ignoring `ENOENT` and `ENOTEMPTY`.

    Day-item delete is unchanged (DW-187).

16. **Bucket-list read shape.** `GET /bucket-list-items` returns, per parked activity: `{ id, title, durationMinutes, location: { lat, lng, label } | null, firstImageUrl: string | null, updatedAt }`, plus whatever the edit dialog needs to open.

    The dialog's `item` is a `DayPlanItem` (`PD:78-98`), so either return the full detail per row (contentJson, cost, payments, linkUrl), or let the dialog fetch one item. **Return the full detail.** The list is small, and it matches how `TV` passes `selectedPlanItem`.

    Order: `title asc, createdAt asc, id asc`, as today (`bucketListRepo.ts:101`). `firstImageUrl` comes from `images: { orderBy: { sortOrder: "asc" }, take: 1 }` in the same query. The trip overview has no per-item image fetch, and no extra request per row is allowed.

## Acceptance Criteria

1. **Migration.** `DayPlanItem` gains `tripId` (not null, FK trips, cascade, backfilled from its day), and `tripDayId` becomes nullable (still cascade). Every `TripBucketListItem` becomes a `DayPlanItem` with:
   - the **same id**;
   - `tripDayId = null`, `FLEXIBLE`, `durationMinutes = 15`, `sortOrder = 0`, times null;
   - its title, `location_lat/lng/label`, `created_at` and `updated_at`;
   - `content_json` built exactly as `buildBucketListContentJson` built it.

   `TripBucketListItem` is dropped. A SQL `CHECK` refuses a row with `trip_day_id IS NULL` unless it is FLEXIBLE with null times and `sort_order = 0`. Every pre-existing activity row is unchanged in every old column (whole-table compare in the migration test).
2. **Migration test.** For a seeded set of bucket rows, each new row carries the same title, place and text, and the JSON equals the TS builder's output byte for byte. The seed covers: description only; position text with and without coordinates; both empty; quotes, backslash, umlauts, emoji, a newline; and leading and trailing whitespace including a tab.
3. **Parked invariant and readers.** A parked activity is FLEXIBLE, has no times and no legs. One integration test seeds a trip with a planned activity (cost €10) and a parked activity (cost €25, coordinates, an image). It asserts the parked one appears in **none** of these:
   - `getTripWithDaysForUser`: days, cost totals, `plannedCostTotal`
   - the dashboard aggregate (`listTripsForUser`)
   - the overview map and gantt data
   - the day route points
   - the day print payload and the document packet
   - the suggestion context
4. **Bucket list on both surfaces.** The trip overview card and the Day Detail panel list the trip's parked activities in alphabetical order (`title`, then `createdAt`, then `id`). Each row (`bucket-item`) shows:
   - the first picture as a **40 px square, `border-radius: 0`** thumbnail if there is one, and no placeholder otherwise;
   - the title (body, 600);
   - one meta line in `ink-soft`: duration and place separated by " · " ("1 Std · Gullfoss"). With no place it shows the duration only.

   The overview card's height cap, collapse and compact empty state (7.12) are unchanged.
5. **Roles.** Owner and contributor see the bucket list on both surfaces and can add, edit, delete and schedule. A viewer sees no bucket list on either surface. The API refuses a viewer with 403 on every method of `bucket-list-items` and `day-plan-items/schedule`, and refuses a non-participant with 404.
6. **Add and edit through the activity dialog.** *Idee hinzufügen* (overview card "+", and the Day Detail panel's add action if present; see Task 7) and a row's edit action open `TripDayPlanDialog` in parked mode:
   - *Wann & Wo* shows only duration and place, and *Feste Zeit* is not offered;
   - *Was*, *Kosten* and *Medien & Links* work as on a day;
   - Save writes to `bucket-list-items`, never to `day-plan-items`;
   - no receipt, no day reload.

   The old inline bucket dialog in `BLP` is deleted.
7. **Media on parked activities.** A picture or document added to a parked activity is stored under `uploads/trips/<tripId>/parked/day-plan-items/<itemId>/` (`…/documents/`), is served, and can be deleted. Pictures and documents an activity got on an earlier day keep their URLs, still display, and can be deleted. A URL outside the item's own folder (another item, another trip, `..`) is refused and logged.
8. **Schedule with "+".** The "+" on a Day Detail bucket row moves the **same** activity (same id, pictures, documents, costs, payments, link, description, duration) onto this day. It is appended at the end as FLEXIBLE, the day is recomputed in the same transaction, and the activity leaves the bucket list. The notice reads *„{title}" eingeplant* (plus the usual warning texts if any) with *Rückgängig*. Undo returns it to the bucket list exactly: `tripDayId` null, FLEXIBLE, times null, `sortOrder` 0, previous `updatedAt` (whole-DB `toEqual` before vs. after). Undo refuses with `409 undo_stale` if the activity was edited or a leg now references it. A new overflow past 23:59 refuses as `day_plan_past_midnight`, as today.
9. **Receipt.** Receipts stay `version: 3` with the new kind `{ kind: "scheduled", itemId, updatedAt, previousUpdatedAt }`. `consumedBucketListItem`, `TripBucketListItemRow` and `bucketListRowSchema` are gone. A v3 receipt that still carries `consumedBucketListItem` is refused (400), which the client shows as "undo unavailable".
10. **Delete.** Deleting a parked activity (with confirmation) removes the row, its images, documents and payments, and its files.
11. **Backup export.** Parked activities are exported in `trip.parkedDayPlanItems` with all their data, including pictures, documents (files in the ZIP), payments and duration. `bucketListItems` is no longer written.
12. **Backup import.**
    - A backup from before this change, with `bucketListItems`, imports each item as a parked activity by the migration's rule.
    - A backup with parked activities round-trips exactly (`tripBackupRoundTrip`: a parked activity with two images, a document, a split payment and 120 minutes).
    - Overwrite import replaces the trip's parked activities instead of doubling them.
13. **Dictionaries.** `en.ts` and `de.ts` carry every new string (`i18nDictionaries.test.ts` stays green). Keys that only the old bucket dialog used are removed: `addTitle`, `editTitle`, `saveNew`, `saveUpdate`, `saveError`, `titleLabel`, `descriptionLabel`, `positionLabel`, plus `locationMissing` (the meta line drops the place instead). Keep a key if Task 7 reuses it.
14. **Regression.** Every other suite stays green: `tsc --noEmit` 0, lint 0 errors, `check:migrations`, `next build`. Day activities behave exactly as after 13.1.

## Tasks / Subtasks

- [x] **Task 0: Baseline** (AC 14)
  - [x] Run the suite, `tsc`, lint and build at `aacfd32`, and record the counts. 13.1 ended at 195 files / 3224 tests.
  - [x] Copy `prisma/dev.db` to the scratchpad for the dry run. **Do not migrate `dev.db`** until Tommy agrees (13.1 precedent; he keeps a backup, `dev.db.before-14-1`).
- [x] **Task 1: Migration and its test, red first** (AC 1, 2)
  - [x] `schema.prisma`:
    - `DayPlanItem.tripId` with relation `trip Trip @relation(…, onDelete: Cascade)`;
    - `tripDayId String?` and `tripDay TripDay?`;
    - `@@index([tripId, tripDayId], map: "idx_day_plan_items_trip_id_trip_day_id")`;
    - `Trip.dayPlanItems DayPlanItem[]`; remove `Trip.bucketListItems` and the `TripBucketListItem` model;
    - a comment describing the CHECK (point 10).
  - [x] `src/lib/trips/parkedItemContent.ts`: `buildParkedContentJson({ title, description, positionText, hasCoordinates })`. Pure. Port it from `TV:976`.
  - [x] `prisma/migrations/20261018120000_day_plan_items_without_day/migration.sql`, hand-written as 13.1 did (`migrate dev --create-only` touches `dev.db`). The steps:
    1. a header comment;
    2. the rebuild (point 10);
    3. `INSERT … SELECT` from `trip_bucket_list_items` (point 9);
    4. `DROP TABLE "trip_bucket_list_items"`;
    5. the indexes;
    6. `foreign_key_check`.
  - [x] `test/migrationDayPlanItemsWithoutDay.test.ts`, following `test/migrationDayPlanItemSchedule.test.ts`: `better-sqlite3` via `createRequire`, applying migrations up to the previous one, then seeding, then applying this one. It covers:
    - the whole-table compare of pre-existing rows (all old columns, plus `trip_id` equal to the day's trip);
    - the bucket rows (AC 2 cases);
    - JSON equal to `buildParkedContentJson`;
    - CHECK refusal;
    - deleting a trip cascades its parked rows;
    - deleting a day still cascades its activities.
  - [x] `prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma` shows nothing new for `day_plan_items`. The `cost_payments` and `trip_members` drift existed before.
  - [x] Dry run on the scratchpad copy of `dev.db`: every activity's old columns are identical, and every former bucket row is present.
- [x] **Task 2: Make it compile: `tripId` everywhere** (AC 14; point 11)
  - [x] Production creates: `DPIR:642`, `daySuggestionApplyRepo.ts:292`, `TR:2777`, `DCR:198/402`.
  - [x] The 144 test seeds (one mechanical pass), plus `test/helpers/*` fixtures that create items (`suggestionApplyFixtures.ts`, `packetFixtures.ts`, `settleSeededDay.ts` if it creates).
  - [x] Types that now see `tripDayId: string | null`:
    - `toDetail` (`DPIR:367-390`) gets `tripDayId: string | null`;
    - narrow at day-only consumers (`day-plan-items/route.ts:72, 301`) instead of widening `DayPlanItemRow` (`DCRc`), which stays `string`.
  - [x] `test/dayPlanItemTripIdConsistency.test.ts`: every write path (create, move between days, day transfer move and swap, suggestion apply, import, undo restore, schedule) leaves `tripId === tripDay.tripId`.
- [x] **Task 3: Predicates and the reader-exclusion test** (AC 3; point 1)
  - [x] Export `parkedDayPlanItemsWhere` and `plannedDayPlanItemsWhere` from `DPIR`, with a docblock stating the rule.
  - [x] `test/parkedItemsExcludedFromTripReaders.test.ts` (AC 3). Change no reader unless this test proves it leaks.
- [x] **Task 4: Bucket-list repository and route on parked activities** (AC 4, 5, 6, 10; points 3, 15, 16)
  - [x] Rewrite `src/lib/repositories/bucketListRepo.ts` over `dayPlanItem`, keeping the writer clause (`:58`) through the new `trip` relation:
    - `listParkedDayPlanItemsForTrip` (point 16);
    - `createParkedDayPlanItem` (FLEXIBLE, duration from the payload, `sortOrder` 0, times null, payments as `DPIR` writes them);
    - `updateParkedDayPlanItem` (conditional on `{ id, tripId, tripDayId: null }`; never touches mode or times);
    - `deleteParkedDayPlanItem` (point 15).
  - [x] Delete `findBucketListItemForTrip` (no callers), `findBucketListItemForTripInTransaction` and `deleteBucketListItemForTripInTransaction`.
  - [x] `src/lib/validation/bucketListSchemas.ts`: the parked payload. Derive it from the activity fields in `dayPlanItemSchemas.ts`: title 1–120, `contentJson` renderable, `durationMinutes` 5–1439 (empty → 15 on the client, as `readActivityDuration`), cost, currency and payments with the same refinements, `linkUrl`, `location`. It has **no** `tripDayId`, `scheduleMode`, `fromTime` or `toTime`, and stays `.strict()` so a stray `fromTime` is a 400. Share the refinements; do not copy them.
  - [x] `bucket-list-items/route.ts`: same four methods and gates (`refuseUnlessTripWriter`, CSRF). Responses are `{ data: { item } }` and `{ data: { items } }`, with no receipt.
  - [x] Rewrite `test/bucketListRepo.test.ts` and `test/bucketListRoute.test.ts` against the new model. Keep every scenario: roles, 404 for a foreign trip, validation, order.
- [x] **Task 5: Schedule route and receipt kind** (AC 8, 9; points 4, 5, 6, 14)
  - [x] `DPIR`: `scheduleParkedDayPlanItemForTripDay({ userId, tripId, tripDayId, itemId })`. Return `not_found | day_plan_past_midnight refusal | scheduled { item, receipt }`.
  - [x] `src/app/api/trips/[id]/day-plan-items/schedule/route.ts`: POST, CSRF, `hasTripOwnerOrContributorAccess` (as `move`), zod `{ itemId, tripDayId }` `.strict()`, signed receipt (`signDayChangeReceipt`), errors as in `move/route.ts`.
  - [x] `DCRc`, `DCRS`, `DCR`, `DST` (`buildReceipt`): add `scheduled`; remove `consumedBucketListItem` everywhere; handle the exhaustive switches. Then:
    - `receiptHasSideEffects` is true for `scheduled`;
    - `summarizeDayChangeReceipt` takes an optional `scheduledTitle` and returns `trips.dayChange.scheduled`.
  - [x] Remove the conversion: `DPIR:696-791`, its result and params types (`:115-119, :177`), the route branch, the schema field, and `TV` prefill.
  - [x] Tests:
    - `dayPlanChangeUndo.test.ts` gains the `scheduled` cases: exact restore with a whole-DB `toEqual`; stale after an edit; stale after a leg is added; **not** stale after an image upload.
    - `dayChangeReceipt.test.ts`: schema and kind, refusal of `consumedBucketListItem`.
    - `tripDayPlanItemsRoute.test.ts`: replace the conversion cases with the schedule route; the 403 and 404 roles; past midnight.
    - A test that a parked item with two images, a document and two payments keeps all of them, with the same ids, after scheduling.
- [x] **Task 6: Media for parked activities** (AC 7; point 7)
  - [x] `uploadPaths.ts`: the parked dirs and `resolveManagedItemMediaDir`; remove `readStoredMediaDayId` once it has no callers.
  - [x] The images and documents routes and schemas use optional `tripDayId`; the repo gates scope by `{ id, tripId, tripDayId ?? null }`.
  - [x] Undo cleanup (`undo/route.ts:101-113`) uses the new helper.
  - [x] Tests for both routes:
    - upload, list and delete on a parked item (path under `parked/`);
    - delete of a `days/<old>/…` image after the item was parked (seed the row with `tripDayId: null` and an old-day URL);
    - refusal of a URL from another item and from another trip;
    - `GET /uploads/trips/<id>/parked/…` served to a viewer, refused to an outsider.
- [x] **Task 7: Dialog in parked mode and the two panels** (AC 4, 5, 6, 8, 13; points 4, 6, 8)
  - [x] `PD`: the `placement` prop (point 8).
  - [x] `BLP`:
    - delete the inline dialog, its geocoding, form state, discard guard and the dialog-only imports;
    - "+" (`addAction`, de text *Idee hinzufügen*) and the row edit open `PD` with `placement="parked"`, `day={null}`, and `item` = the row's detail;
    - `onSaved` reloads the list;
    - `onDelete` opens the existing delete confirmation;
    - rows become `bucket-item` (thumbnail, title, meta line), with the edit and delete buttons kept on the right;
    - re-derive `BUCKET_LIST_ROW_HEIGHT_PX` (`:83-100`) for the 40 px thumbnail row, so the 5.5-row cap still holds. Check `test/tripBucketListPanel.test.tsx`'s height assertions.
  - [x] `DBLP`: `bucket-item` rows; "+" calls `onSchedule(item)`. Day Detail has no add or edit action today. Do not add one; the overview is where ideas are added (Q3).
  - [x] `TV`:
    - `loadBucketListItems` reads the new shape;
    - `handleScheduleBucketItem` posts to `/day-plan-items/schedule`, then `takeDayChangeReceipt(receipt)`, `loadDay()` and `loadBucketListItems()`. On a refusal it shows the `pastMidnight` text or the generic error the way delete does (`TV:1620`);
    - `handleUndoDayChange` reloads the bucket list when `receipt.edited.kind === "scheduled"`;
    - the notice passes `scheduledTitle`.
  - [x] A thumbnail component, `BucketItemThumbnail` (40 px, `borderRadius: 0`, `alt` = title, `loading="lazy"`), shared by both panels. Put it next to `DBLP` or in `TripDayPlanItemContent.tsx`; `MiniImageStrip` is 56 px and multi-image, so do not bend it.
  - [x] Duration text: add `formatActivityDuration(minutes, t)` in `src/lib/trips/activityDuration.ts` with keys `trips.duration.hours` ("{hours} Std" / "{hours} h"), `trips.duration.minutes` ("{minutes} Min" / "{minutes} min"), and `trips.duration.hoursMinutes` ("{hours} Std {minutes} Min" / "{hours} h {minutes} min"). Leave the print view's `formatDuration` and `TV:510` alone (no drive-by refactors).
  - [x] Tests:
    - `tripBucketListPanel.test.tsx` (rewritten): rows, thumbnail present and absent, meta line with and without place, dialog opens in parked mode, delete confirmation, roles via `tripTimelineRoles.test.tsx`;
    - `tripDayPlanDialog.test.tsx`: parked mode shows no toggle, no fixed time and no expected times; payload shape and URL; media calls without `tripDayId`; no `/day-plan-items` fetch;
    - `tripDayViewLayout.test.tsx`: the "+" schedules, the notice text and undo reload;
    - `dialogCloseAffordance.test.tsx`: drop the old bucket dialog case and cover `PD` parked.
- [x] **Task 8: Backup** (AC 11, 12; points 12, 13)
  - [x] Export: `parkedDayPlanItems` in the payload type and in `getTripExportForUser`, with media into the photo and document pools (`resolveOwnedMediaPath` is trip-level, so no change).
  - [x] Import schema: `parkedDayPlanItems` (item shape without times, with `durationMinutes`) and legacy `bucketListItems`; the limits.
  - [x] `createImportedDays` stays per day. Add `createImportedParkedItems`, which replaces `createImportedBucketListItems` (`TR:2965`). The `importPhotos.ts` plan helpers take a null day and write to `parked/`.
  - [x] Overwrite deletes parked rows (`TR:3209`).
  - [x] Tests:
    - `tripBackupRoundTrip.test.ts` (AC 12 item);
    - `tripImportSchemas.test.ts` (both lists, limits);
    - `tripImportRoute.test.ts` (legacy file with `bucketListItems`, which gives parked activities with the migration's JSON);
    - `tripExportRoute.test.ts` (no `bucketListItems` key);
    - `tripImportRollback.test.ts` (a failed import also removes `parked/` files).
- [x] **Task 9: Dictionaries and docs** (AC 13)
  - [x] New keys in `en.ts` and `de.ts` (see *Copy*); remove the dead keys (AC 13); `i18nDictionaries.test.ts` stays green.
  - [x] Fix the stale comments that name the bucket model or panels: `theme.ts:389, 422-426, 573`, and the `trips.location.selectRequired` comment.
- [x] **Task 10: Gates and real run** (AC 14)
  - [x] Full suite, `tsc`, lint, `check:migrations`, `next build`.
  - [x] Mutation checks, each applied, run, then reverted. Each must turn the suite red:
    1. the bucket-list read without `tripDayId: null`;
    2. undo of `scheduled` without restoring `previousUpdatedAt`;
    3. the media rule accepting any folder under the trip;
    4. the migration's position text included even with coordinates;
    5. the export leaving out parked items.
  - [x] Real run with Tommy, after he agrees to migrate `dev.db` (backup first) (2026-10-18, all checks passed):
    - every former bucket idea is listed with its text and place;
    - add an idea with two pictures, a PDF, €25 and 2 h on the overview as a **contributor**;
    - "+" on a day: it is appended, the pictures, ticket and €25 count on that day;
    - *Rückgängig*: it is back in the list and €25 has left "Kosten bisher";
    - a viewer sees no bucket list;
    - 390 px check of the dialog in parked mode and of the rows.

### Review Findings

Code review 2026-10-18 (Blind Hunter, Edge Case Hunter, Acceptance Auditor; production diff only, tests checked by the Auditor). 16 patch, 0 decision, 0 defer, 10 dismissed. All 16 applied the same day: tsc 0, lint 0 errors (79 warnings, unchanged), 200 files / 3278 tests (+7: undo with a swept stay leg, the CHECK surviving later migrations, a stable dialog item, the editor delete waiting for the confirmation, three on parked import validation, and payments cleared with the cost). New key `trips.bucketList.scheduleStale` (de/en). `BucketItemThumbnail` dropped its `title` prop (`alt=""`).

- [x] [Review][Patch] **High.** The overview edit dialog re-seeds on every panel render and loses unsaved edits. `toDialogItem(dialog.item)` makes a new object each render, the seed effect depends on `item`, and `onDayWrite → loadItems()` re-renders the panel after any picture or document upload or removal. Fix: memoise the dialog item or keep it in state [travelplan/src/components/features/trips/TripBucketListPanel.tsx:469]
- [x] [Review][Patch] **High.** Undo of "+" is always refused on a day with a leg to tonight's stay. Appending the idea un-draws last-activity→stay, `finishActivityWriteInTransaction` sweeps it into `removedTravelSegments`, and the validator refuses any `scheduled` receipt that has removed legs. Undo phase 2 already recreates removed legs generically (line ~507), so drop the check and add an undo test with a swept leg [travelplan/src/lib/repositories/dayPlanChangeRepo.ts:195]
- [x] [Review][Patch] **High.** Import validation ignores `parkedDayPlanItems` media. `requirePooledPhoto` and `requirePooledDocument`, `plannedMediaWrites`, and `countPhotoReferences`/`countDocumentReferences` only walk `days[].dayPlanItems`. An unknown id fails inside the transaction (500, not 400), and parked media bypass the media-write and byte caps [travelplan/src/lib/validation/tripImportSchemas.ts:686]
- [x] [Review][Patch] **Medium.** Delete from the overview editor closes the editor before the confirmation is answered. `onDelete` returns `true` straight away, so cancelling the confirmation loses the editor and its unsaved edits. On a day, the editor stays open [travelplan/src/components/features/trips/TripBucketListPanel.tsx:470]
- [x] [Review][Patch] **Medium.** The `day_plan_items_parked_check` CHECK lives only in hand-written SQL. A future Prisma "redefine table" migration would drop it silently. Add a test that reads `sqlite_master` and asserts the constraint exists on the test DB [travelplan/prisma/migrations/20261018120000_day_plan_items_without_day/migration.sql]
- [x] [Review][Patch] Imported parked `durationMinutes` accepts 1–4. Use the shared 5–1439 bounds [travelplan/src/lib/validation/tripImportSchemas.ts:539]
- [x] [Review][Patch] An imported parked item may have no title, which gives a blank row the bucket API then refuses to save. Require a trimmed title of 1–120 characters in `parkedDayPlanItemImportSchema` [travelplan/src/lib/validation/tripImportSchemas.ts:425]
- [x] [Review][Patch] The import's `parkedDayPlanItems`/`bucketListItems` arrays have no per-array `.max`, so the combined refine runs only after full parse and superRefine [travelplan/src/lib/validation/tripImportSchemas.ts:575]
- [x] [Review][Patch] The imported parked `locationLabel` is not cleaned. Use `cleanImportedOptionalString` as the legacy path does [travelplan/src/lib/repositories/tripRepo.ts:3069]
- [x] [Review][Patch] The "scheduled" notice reads "untitled activity" until `loadDay` lands, and for good if the reload fails. Carry the title from the schedule response or `item.title` instead of looking it up in `planItems` [travelplan/src/components/features/trips/TripDayView.tsx:3845]
- [x] [Review][Patch] `handleScheduleBucketItem` has two gaps. A non-JSON response skips the bucket-list reload. A 409 `day_plan_changed` shows a generic error with the day state still stale. Reload the list in `finally`, and handle the conflict as the other day writes do [travelplan/src/components/features/trips/TripDayView.tsx:1343]
- [x] [Review][Patch] The schedule route's bare `catch` returns 500 without logging the error [travelplan/src/app/api/trips/[id]/day-plan-items/schedule/route.ts]
- [x] [Review][Patch] Deleting an idea whose media were uploaded while it sat on a day leaves empty `days/<d>/day-plan-items/<id>[/documents]` folders. `rmdir` the `resolveManagedItemMediaDir` folders too [travelplan/src/app/api/trips/[id]/bucket-list-items/route.ts:115]
- [x] [Review][Patch] A bucket PATCH with `costCents: null` and `payments` absent keeps the old `CostPayment` rows. Only API clients can reach this; the dialog always sends payments. Clear the payments when the cost is null [travelplan/src/lib/repositories/bucketListRepo.ts:151]
- [x] [Review][Patch] `BucketItemThumbnail` uses `alt={title}` beside the same title, so screen readers say it twice. Use `alt=""` [travelplan/src/components/features/trips/BucketItemThumbnail.tsx]
- [x] [Review][Patch] The stale comment about the "add to this day" conversion on the Day Detail bucket panel should go (Task 9) [travelplan/src/components/features/trips/TripDayView.tsx:4772]

Dismissed (10):
- **PATCH resets duration to 15.** Documented "absent means 15", and the dialog always sends a duration.
- **Delete path "never throws".** `removeManagedMediaFile` handles its own errors.
- **Undo renumber vs `movedItems`.** Scheduling only appends.
- **Position text dropped when coordinates exist.** The spec mandates it (AC1, point 9).
- **Parked costs not in trip totals.** That is AC3.
- **Media scope with `tripDayId` omitted.** By design: absent means parked.
- **Migration inner join drops orphans.** The real run counted 79/79.
- **Legacy-import timestamps.**
- **Legacy trim vs raw copy.** No practical difference.
- **Schedule route gate.** Deviation 1 is accepted; it is what AC5 requires.

## Dev Notes

### Copy (de / en)

| Key | de | en |
|---|---|---|
| `trips.bucketList.addAction` (changed) | Idee hinzufügen | Add idea |
| `trips.bucketList.empty` (unchanged) | Noch keine Bucket-List-Einträge. | (unchanged) |
| `trips.bucketList.addToDayAction` (changed) | Auf diesen Tag einplanen | Schedule on this day |
| `trips.bucketList.scheduleError` (new) | Konnte nicht eingeplant werden. Bitte erneut versuchen. | Could not be scheduled. Please try again. |
| `trips.plan.addIdeaDialogTitle` (new) | Idee hinzufügen | Add idea |
| `trips.plan.editIdeaDialogTitle` (new) | Idee bearbeiten | Edit idea |
| `trips.dayChange.scheduled` (new) | „{title}" eingeplant | "{title}" scheduled |
| `trips.duration.hours` (new) | {hours} Std | {hours} h |
| `trips.duration.minutes` (new) | {minutes} Min | {minutes} min |
| `trips.duration.hoursMinutes` (new) | {hours} Std {minutes} Min | {hours} h {minutes} min |

Delete keys `deleteTitle`, `deleteBody`, `deleteConfirm`, `deleteKeep`, `deleteError` stay. Check `de.ts` for its quote characters: the dictionary uses „…" in other notices.

### Current state of what this story changes

| Area | Today | After |
|---|---|---|
| Model | `TripBucketListItem` (title, description, position text, location) | `DayPlanItem` with `tripDayId = null` |
| Read | `bucketListRepo.listBucketListItemsForTrip` | the same route; parked activities with first image and duration |
| Add / edit | inline dialog in `BLP` (3 fields + geocode) | `PD` in parked mode (all tabs) |
| "+" | opens `PD` prefilled; Save converts (new id) and deletes the bucket row | direct move, same id; receipt `scheduled` |
| Undo of "+" | deletes the new item, recreates the bucket row | moves it back to the list |
| Media | day folders only | plus `parked/`; one URL-derived delete rule |
| Backup | `bucketListItems` | `parkedDayPlanItems`; legacy `bucketListItems` still read |

**What must not change:** day writes and their receipts (13.1), the day-wide image and document lists, move and transfer between days, the 11.x undo kinds, the 7.12 card behaviour (cap, collapse, compact empty state), viewer access to everything else, and DW-187 (day-item delete keeps files).

### Architecture compliance

- Parking and scheduling change `tripDayId` and the schedule columns only. **No path copies an activity between tables** (code-review check).
- Scheduling recomputes the day in the same transaction as the move. Conditional writes on `updatedAt`. 409 `day_plan_changed` on a race.
- Zod at the API layer, `.strict()`. The error envelope is `{ error: { code, message, details } }`.
- Writers only: `refuseUnlessTripWriter` / `hasTripOwnerOrContributorAccess` plus the repo's writer clause. Readers of files go through `hasTripReadAccess` in the uploads route.
- Pure modules (`parkedItemContent.ts`, `activityDuration.ts`, `DCRc`) stay free of Prisma and `server-only`.
- SQLite, Prisma 7.3, `@prisma/adapter-better-sqlite3`, interactive transactions (5 s default).

### Testing standards

- Vitest 3, `globals`, single fork, real SQLite per worker (`test/setup.ts` runs `prisma migrate deploy`, so the migration runs on every test DB). Tests sit flat in `test/`, with `describe` names carrying "(Story 14.1 ACn)".
- Component tests use `// @vitest-environment jsdom`, `@testing-library/react` 16 and `test/helpers/renderWithProviders.tsx`.
- Route tests use real requests (`test/helpers/routeContext.ts`).
- Red first: the migration test, `parkedItemContent`, the `scheduled` undo, and the reader-exclusion test.
- The bucket tests are **rewritten, not deleted** (proposal). Keep every scenario that still has a meaning.

### Previous story intelligence (13.1, 12.4, 11.x)

- 13.1: add new receipt fields as **optional and absent when empty**, or `toEqual` pins break. `scheduled` is a new kind, so no existing pin changes; removing `consumedBucketListItem` breaks the pins that carried it, and those are the conversion tests you rewrite anyway.
- 13.1: new Prisma columns go last in the model, or `migrate diff` wants a redefine. Here the table is rebuilt anyway, so write the `CREATE TABLE` in model order and declare `tripId` in the model where you put it in SQL.
- 13.1: the migration was hand-written and tested with `better-sqlite3` through `createRequire` (no types installed). Reuse that harness.
- 13.1: `dev.db` is migrated only by Tommy, after a backup.
- 13.1 Q4: a move between days only places and renumbers (13.3 fixes that). Not touched here.
- 11.2 §7: decide refusals before the first write.
- DW-372, DW-374 and DW-375 (undo and receipt races) stay open. Do not widen them.
- Tommy checks in Safari and wants a 390 px check of new dialog parts.

### Git intelligence

The recent commits are `aacfd32` (13-1 real run, done), `ed2da94` (13-1 implementation and review patches) and `d9f96be` (Epic 13 and 14 planning). Commit style is one commit per task or finding, with the prefix `14-1: …`. No dependency changes are needed.

### Latest technical information (2026-10-18)

- No new library.
- SQLite 3.51.1 has JSON1 built in. `json_object` and `json_array` produce compact JSON with keys in argument order. A nested `json_object` result is embedded as JSON, not as a string, but only when passed directly, not through a subquery's text column (wrap with `json()` if in doubt).
- Prisma 7.3: a relation filter on a nullable relation (`tripDay: { tripId }`) excludes rows whose `tripDayId` is null. That is why the existing readers are safe.

### Project Structure Notes

New files:
- `prisma/migrations/20261018120000_day_plan_items_without_day/migration.sql`
- `src/lib/trips/parkedItemContent.ts`
- `src/lib/trips/activityDuration.ts`
- `src/app/api/trips/[id]/day-plan-items/schedule/route.ts`
- a thumbnail component
- tests: `migrationDayPlanItemsWithoutDay`, `parkedItemsExcludedFromTripReaders`, `dayPlanItemTripIdConsistency`, and the schedule route

Removed:
- the `TripBucketListItem` model
- the conversion function and the route branch
- the `BLP` inline dialog
- `readStoredMediaDayId` (once it has no callers)

### Questions for Tommy (not blocking; the defaults apply)

1. **"+" without a dialog (point 4).** "+" moves the idea onto the day at once, and *Rückgängig* takes it back. Today it opens the dialog first. OK?
2. **Midnight (point 5).** Until 13.2, scheduling an idea that no longer fits before 23:59 is refused with the same message as adding an activity. OK?
3. **Adding ideas on Day Detail.** Today Day Detail only schedules; ideas are added on the overview. Keep it that way?
4. **Meta line without a place.** It shows only the duration. "Keine Koordinaten gespeichert" disappears. OK?
5. **Deleting an idea deletes its files** (architecture). There is no undo, and the confirmation stays. OK?

### References

- [epics.md: Story 14.1](../planning-artifacts/epics.md), Epic 14 section; supersession markers on 4.1, 4.2 and 7.12
- [sprint-change-proposal-2026-10-17-bucket-parking.md](../planning-artifacts/sprint-change-proposal-2026-10-17-bucket-parking.md) §2 *Technical impact*, §5 success criteria 2, 5 and 6, §6 *Architecture Review*
- [architecture.md](../planning-artifacts/architecture.md): "Activities without a day"; "Parking and scheduling"; "Day recalculation receipts"
- `DESIGN.md` `bucket-item`, the photography corner rule (line 261); `EXPERIENCE.md` lines 29, 39, 83, 97
- [13-1-just-say-how-long.md](13-1-just-say-how-long.md): migration harness, receipt v3, write paths
- [deferred-work.md](deferred-work.md): DW-153, DW-187, DW-372, DW-374, DW-375

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (claude-opus-5-5), bmad-dev-story, 2026-10-18.

### Debug Log References

- Baseline at `aacfd32`: 195 files / 3224 tests, `tsc` 0, lint 0 errors / 80 warnings.
- Migration dry run on a scratchpad copy of `dev.db`: all 79 activities identical in every old column, every `trip_id` equal to its day's trip, both bucket ideas present as parked activities, `foreign_key_check` and `integrity_check` clean. `dev.db` itself is **not** migrated.
- `prisma migrate diff --from-migrations … --to-schema …`: nothing for `day_plan_items`; only the known `cost_payments` / `trip_members` drift.
- Final: 200 files / 3269 tests, `tsc` 0, lint 0 errors / 79 warnings, `check:migrations` passed, `next build` ok.
- Mutation checks, each red, each reverted: (1) bucket read without `tripDayId: null` → 2 failed; (2) undo of `scheduled` without `previousUpdatedAt` → 2 failed; (3) media rule accepting any folder under the trip → 2 failed; (4) migration keeping position text with coordinates → 2 failed; (5) export leaving out parked items → 6 failed.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created (bmad-create-story, 2026-10-18).
- **Migration** (`20261018120000_day_plan_items_without_day`): table rebuilt in Prisma's own DDL plus the parked CHECK; bucket rows inserted with the same id, 15 min, FLEXIBLE, `sort_order` 0. The SQL `json_object` output equals `buildParkedContentJson` byte for byte on all 12 seeded cases (quotes, backslash, umlauts, emoji, newline, tab, NBSP, U+2003/U+FEFF/U+3000). `trim` is given JavaScript's full whitespace set, not only tab/LF/CR/NBSP, so no difference is left to pin.
- **Readers**: none changed; `parkedItemsExcludedFromTripReaders.test.ts` proves the parked row never reaches detail, costs, dashboard, route, print/packet or suggestion context. `parkedDayPlanItemsWhere` / `plannedDayPlanItemsWhere` exported from `dayPlanItemRepo.ts`.
- **Bucket list** is `bucketListRepo.ts` over parked `DayPlanItem` rows; payload schema built from the shared activity field schemas and refinements (`refinePaymentTotal`, `refineDurationInRange` lifted out of `dayPlanItemSchemas.ts`), `.strict()`. Delete removes the files after commit by the URL-derived rule and `rmdir`s the empty `parked/` folders.
- **Schedule**: `scheduleParkedDayPlanItemForTripDay` + `POST day-plan-items/schedule`. Receipt kind `scheduled` through type, wire mapping, schema, invalidity, both undo phases; `consumedBucketListItem` and the conversion are gone. Undo restores the whole DB (`toEqual`), is stale after an edit or a leg, not after a new picture.
- **Media**: `resolveManagedItemMediaDir` is the one delete rule for the image and document routes, the parked delete and the apply-undo cleanup. Uploads go to the item's current place (`parked/` when it has none).
- **UI**: `TripDayPlanDialog` `placement="parked"`; overview panel opens it for add/edit, rows are `bucket-item`; Day Detail "+" schedules directly and the notice reads „{title}" eingeplant with Rückgängig; undo reloads the bucket list.
- **Backup**: export writes `trip.parkedDayPlanItems` (media pooled after every day's, so existing pool ids keep their order); import reads it and legacy `bucketListItems` (migration rule), one shared limit; overwrite deletes parked rows.
- **Deviations from the story text, each deliberate:**
  1. The schedule route gates with `refuseUnlessTripWriter`, not `hasTripOwnerOrContributorAccess` "as `move`": `move` answers 403 to a non-participant too, and AC5 wants 403 viewer / 404 outsider.
  2. Reading a *parked* item's media uses the writer clause (viewers see no bucket list, AC5); a planned item's stays the participant clause.
  3. `readStoredMediaDayId` stays: the accommodation image and document routes still call it.
  4. The dialog's whole `prefill` prop went, not only `bucketListItemId`: nothing else ever set a prefill, so it would have been dead code.
  5. The notice's `scheduledTitle` is read from the reloaded day's activities by the receipt's item id, instead of a separate piece of state.
  6. The parked export entry has no `fromTime`/`toTime` (the import side has none either) and carries `scheduleMode: "FLEXIBLE"` in the stored spelling. A cost without payment rows exports one row due on the trip's first day (no day of its own).
  7. GET media with only `dayPlanItemId` now means "a parked item", so a planned item addressed without its day answers 404 where it used to answer 400; the skip log line now says "names no folder of this activity". Two existing route tests were updated for this.
  8. The rewritten overview panel tripped `react-hooks/set-state-in-effect` (the old one had escaped analysis); its mount effect now applies a fetched result after the await, as `AdminUsersList` does.
- **Seeds**: 138 direct seeds got `tripId` by a mechanical pass; seven seed helpers that receive only a day id use `test/helpers/tripIdOfDay.ts`.
- **Real run (Task 10), 2026-10-18.** Tommy backed up `dev.db` (`dev.db.before-14-1`), migrated it with `prisma migrate deploy`, and went through every check (idea "Reiseidee" with pictures, PDF, cost and duration as a contributor; "+" onto a day; *Rückgängig*; viewer; 390 px): all passed.
- **Seen during the real run, not caused by 14.1:** the browser logged `[tiptap warn]: Duplicate extension names found: ['link']`. TipTap 3's StarterKit (3.29.1) already includes Link, and `TripDayPlanDialog` added its own `Link.configure(...)` on top. **Fixed on Tommy's request:** `StarterKit.configure({ link: false })` (StarterKit registers Link only when `link !== false`), the StarterKit mock in `test/setup.ts` and four dialog suites gained a `configure`, and `tripDayPlanDialog.test.tsx` pins `{ link: false }`.
- **Q1, Q2 confirmed** by Tommy. **Q3 changed** by Tommy: ideas can also be added on Day Detail. `TripDayBucketListPanel` got a header "+" (*Idee hinzufügen*, the overview's control) that opens the same parked dialog; `TripDayView` renders it only while open, and a save reloads the bucket list. The idea goes to the list, not onto the day; editing stays on the overview. Test in `tripDayViewLayout.test.tsx`. Q4 and Q5 confirmed by Tommy as implemented (2026-10-18).

### File List

New:
- `travelplan/prisma/migrations/20261018120000_day_plan_items_without_day/migration.sql`
- `travelplan/src/app/api/trips/[id]/day-plan-items/schedule/route.ts`
- `travelplan/src/components/features/trips/BucketItemThumbnail.tsx`
- `travelplan/src/lib/trips/activityDuration.ts`
- `travelplan/src/lib/trips/parkedItemContent.ts`
- `travelplan/test/activityDuration.test.ts`
- `travelplan/test/dayPlanItemTripIdConsistency.test.ts`
- `travelplan/test/helpers/tripIdOfDay.ts`
- `travelplan/test/migrationDayPlanItemsWithoutDay.test.ts`
- `travelplan/test/parkedItemMedia.test.ts`
- `travelplan/test/parkedItemsExcludedFromTripReaders.test.ts`

Modified (source):
- `travelplan/prisma/schema.prisma`
- `travelplan/src/generated/prisma/**` (regenerated; `models/TripBucketListItem.ts` deleted)
- `travelplan/src/app/api/trips/[id]/bucket-list-items/route.ts`
- `travelplan/src/app/api/trips/[id]/day-plan-changes/undo/route.ts`
- `travelplan/src/app/api/trips/[id]/day-plan-items/documents/route.ts`
- `travelplan/src/app/api/trips/[id]/day-plan-items/images/route.ts`
- `travelplan/src/app/api/trips/[id]/day-plan-items/route.ts`
- `travelplan/src/components/features/trips/TripBucketListPanel.tsx`
- `travelplan/src/components/features/trips/TripDayBucketListPanel.tsx`
- `travelplan/src/components/features/trips/TripDayPlanDialog.tsx`
- `travelplan/src/components/features/trips/TripDayView.tsx`
- `travelplan/src/i18n/de.ts`
- `travelplan/src/i18n/en.ts`
- `travelplan/src/lib/repositories/bucketListRepo.ts`
- `travelplan/src/lib/repositories/dayPlanChangeRepo.ts`
- `travelplan/src/lib/repositories/dayPlanItemRepo.ts`
- `travelplan/src/lib/repositories/dayScheduleTransaction.ts`
- `travelplan/src/lib/repositories/daySuggestionApplyRepo.ts`
- `travelplan/src/lib/repositories/tripRepo.ts`
- `travelplan/src/lib/trips/dayChangeReceipt.ts`
- `travelplan/src/lib/trips/importPhotos.ts`
- `travelplan/src/lib/trips/uploadPaths.ts`
- `travelplan/src/lib/validation/bucketListSchemas.ts`
- `travelplan/src/lib/validation/dayChangeReceiptSchemas.ts`
- `travelplan/src/lib/validation/dayPlanItemSchemas.ts`
- `travelplan/src/lib/validation/documentGallerySchemas.ts`
- `travelplan/src/lib/validation/imageGallerySchemas.ts`
- `travelplan/src/lib/validation/tripImportSchemas.ts`
- `travelplan/src/theme.ts`
- `travelplan/test/setup.ts`, `travelplan/test/tripDayPlanDialogMockMuiDialogImport.test.ts`, `travelplan/test/tripDayPlanDialogMockMuiImport.test.ts`, `travelplan/test/tripDayPlanDialogImportWithMocks.test.tsx` (StarterKit mock)

Modified (tests):
- `travelplan/test/accommodationDeleteRollback.test.ts`, `accommodationRepo.test.ts`, `bucketListRepo.test.ts` (rewritten), `bucketListRoute.test.ts` (rewritten), `dayActivityTransferRoute.test.ts`, `dayChangeReceipt.test.ts`, `dayPlanChangeLegPush.test.ts`, `dayPlanChangeLegPushConflict.test.ts`, `dayPlanChangePush.test.ts`, `dayPlanChangePushConflict.test.ts`, `dayPlanChangeReorder.test.ts`, `dayPlanChangeReorderConflict.test.ts`, `dayPlanChangeStayPush.test.ts`, `dayPlanChangeSweep.test.ts`, `dayPlanChangeSweepRollback.test.ts`, `dayPlanChangeUndo.test.ts`, `dayPlanItemRepo.test.ts`, `dayPlanItemSchemas.test.ts`, `daySuggestionContextRepo.test.ts`, `daySuggestionsRoute.test.ts`, `dialogCloseAffordance.test.tsx`, `documentGalleryRepo.test.ts`, `helpers/suggestionApplyFixtures.ts`, `imageGalleryPersistence.test.ts`, `imageGalleryRepo.test.ts`, `travelSegmentRoute.test.ts`, `tripBackupRoundTrip.test.ts`, `tripBucketListPanel.test.tsx` (rewritten), `tripDayDocumentPacketRoute.test.ts`, `tripDayPlanDialog.test.tsx`, `tripDayPlanItemDocumentsRoute.test.ts`, `tripDayPlanItemImagesRoute.test.ts`, `tripDayPlanItemsRoute.test.ts`, `tripDayPrintRoute.test.ts`, `tripDayRoute.test.ts`, `tripDayViewLayout.test.tsx`, `tripDetailRoute.test.ts`, `tripExportRoute.test.ts`, `tripImportRollback.test.ts`, `tripImportRoute.test.ts`, `tripImportSchemas.test.ts`, `tripRepo.test.ts`, `tripsListRoute.test.ts`, `uploadPaths.test.ts` (all under `travelplan/test/`)

Tracking:
- `_bmad-output/implementation-artifacts/14-1-one-kind-of-entry.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`

### Change Log

- 2026-10-18: Q4, Q5 confirmed by Tommy; all five questions settled.
- 2026-10-18: TipTap duplicate `link` fixed; Q3 changed by Tommy (add ideas on Day Detail too), Q1/Q2 confirmed. 200 files / 3271 tests, tsc 0, lint 0 errors.
- 2026-10-18: Real run passed (dev.db migrated, all checks). TipTap duplicate-`link` warning noted as pre-existing. Status review.
- 2026-10-18: Tasks 0–9 and the Task 10 gates done (bmad-dev-story): migration and its byte-for-byte test, `tripId` everywhere, reader-exclusion proof, bucket list on parked activities, schedule route and `scheduled` receipt, parked media, parked dialog and both panels, backup export/import, dictionaries. 200 files / 3269 tests, `tsc` 0, lint 0/79, build ok, 5 mutations red. Real run with Tommy and Q1–Q5 outstanding; status stays in-progress.
