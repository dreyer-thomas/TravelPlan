---
baseline_commit: 62cb7b7
---

# Story 12.4: Take Them Over in Visiting Order

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As someone who has picked the ideas they like,
I want them added as activities in the order I would visit them, with times and travel legs,
so that the day is planned in one step and I can take it back if it is wrong.

**FRs covered:** FR45. **Depends on:** 12.3 (done, `08e7cbc`; its 4 review patches are **still uncommitted** in `TripDaySuggestionsDialog.tsx`, its test, `deferred-work.md`, `sprint-status.yaml` and the 12.3 story file), Epic 11 receipts (11.1–11.4, done).
Sources: [epics.md#Story 12.4](../planning-artifacts/epics.md); [sprint-change-proposal-2026-10-16.md](../planning-artifacts/sprint-change-proposal-2026-10-16.md) (R5–R7, D1, D2, D4); [12-1](12-1-ask-claude-what-the-day-could-hold.md) *Questions* 4; [12-2](12-2-pictures-for-each-suggestion.md) item 7, Deviation 1, *Questions* 3; [12-3](12-3-look-through-the-ideas-and-tick-the-good-ones.md) item 5; [11-1](11-1-travel-legs-that-leave-with-their-place-in-the-day.md) (receipt, undo, staleness table); DW-386 in [deferred-work.md](deferred-work.md).

All code paths below are relative to `travelplan/`. Line numbers were read on 2026-10-16 at `08e7cbc` plus the uncommitted 12.3 patches. `TV` = `src/components/features/trips/TripDayView.tsx` (5072 lines), `DPIR` = `src/lib/repositories/dayPlanItemRepo.ts`, `TSR` = `src/lib/repositories/travelSegmentRepo.ts`, `DCR` = `src/lib/repositories/dayPlanChangeRepo.ts`, `DSS` = `src/lib/validation/daySuggestionSchemas.ts`. Some repository files contain a byte that makes plain `grep` treat them as binary and print nothing; use `grep -a`.

## Read this first: where the epic's wording collides with the code

Every item was checked against the code, and each one changes what a task asks for. Items 1–4 are defaults that contradict the epic text; they are listed under *Questions* for Tommy.

1. **The default check-out is 10:00, not 09:00.** `DEFAULT_CHECK_OUT_TIME = "10:00"` and `resolveCheckOutTime` (`src/lib/trips/stayTimes.ts:11,18`) are what the timeline draws (TV:2172, :2402) and what the Epic 11 push uses server-side (`accommodationRepo.ts:396`, `TSR:379`). A chain starting at 09:00 would place the first activity *before* the check-out the timeline shows. **Default: use `resolveCheckOutTime`**, as 12.1 *Questions* 4 recommended. On day 1 without a previous stay (trip start), use `DEFAULT_CHECK_OUT_TIME` too. Amend the epic's AC text (Task 9).
2. **A time past 23:59 cannot be stored.** Times are `"HH:mm"` strings, hours ≤ 23 (`dayPlanItemSchemas.ts:58-68`), with `toTime > fromTime` (:109-115), and Epic 11 refuses rather than clamps (`dayPlanPush.ts` `past_midnight`, `LAST_MINUTE_OF_DAY` :78). The epic wants "warning, and applying is still allowed". **Default:** a suggestion whose computed `toTime` would pass 23:59 is created **without times** (`fromTime`/`toTime` null; the column is nullable and untimed activities already exist, they sort last per `dayPlanItemOrder.ts:67-86`). Every later one is untimed too. The preview marks those rows "ohne Uhrzeit" and shows the warning; applying stays allowed. Nothing is clamped and no duration is falsified.
3. **A leg without a duration cannot be stored.** `TravelSegment.durationMinutes` is `Int` NOT NULL (`prisma/schema.prisma:162`), the API demands `positive()` and car demands a distance (`travelSegmentSchemas.ts:31,44-50`), and the proposal promised no migration. **Default: when OSRM gives no value for a pair, that leg is not created** and the chain assumes 0 minutes there. The activities are still created. The notice counts only the legs that exist ("4 Aktivitäten und 0 Fahrten" never appears; see *Copy*). A fake `1` minute would be a lie the user later trusts.
4. **"Down to one transaction" includes network I/O that cannot sit inside a SQLite transaction.** OSRM and the image downloads run **before** the transaction; only writes run inside it (Task 5). The transaction re-reads the day and refuses with `409 day_plan_changed` if the basis the plan was computed on changed (item 9).
5. **The receipt cannot express this change today** (11.1 design, `src/lib/trips/dayChangeReceipt.ts`):
   - `edited.created` holds **one** `itemId` (:124-141);
   - undo of `created` refuses an item that has images or legs (`DCR:199-211`), which ours always may have;
   - `receiptHasSideEffects` is false for a plain create (:271-272), and `takeDayChangeReceipt` (TV:1354-1359) drops such a receipt, so no notice would appear.

   **So add one new `edited` kind, `suggestionsApplied`** (Task 4). Every switch over `edited.kind` ends in a `never` default, so the compiler finds each place: the type (:124-141), `mapReceipt` (:195-241), `summarizeDayChangeReceipt` (:282-314), `receiptHasSideEffects`, the Zod `editedSchema` (`src/lib/validation/dayChangeReceiptSchemas.ts:170-202`), `findInvalidity` (`DCR:99-163`) and the three phases of `undoInTransaction` (`DCR:179-382`). `version` stays `2`, as 11.3 and 11.4 added kinds the same way.
6. **Undo here must delete image files, and no undo does that today.** 11.1 §2 says "Do not add file unlinking to the item delete … undo depends on the files surviving" (DW-187). That rule protects a *deleted* item whose undo recreates rows pointing at the old files. Here the files belong to items this very change created, so nothing else can point at them once undo removes the rows. **Unlink only after the undo transaction commits**, with `removeManagedMediaFile` (`src/lib/trips/mediaCleanup.ts:61-116`, never throws, ENOENT is success), `allowedDir = getDayPlanItemImageUploadDir(tripId, dayId, itemId)`. Take the URLs from the rows read **inside** the transaction, never from the receipt. Do not touch the item delete route (DW-187 stays as it is).
7. **The dialog's `onApply` does not carry the mode, and the toggle may have changed since the search.** `onApply?: (picked) => void` (`TripDaySuggestionsDialog.tsx:62`). The legs must use the mode of the search that produced the list, not whatever the toggle shows now. Keep a `searchedMode` set when a result arrives. And because a preview step plus two fetches now live in the dialog, **replace `onApply` with `onApplied?: (receipt: SignedDayChangeReceiptWire) => void`** (use whatever the wire/signed type is named in `dayChangeReceipt.ts`/`dayChangeReceiptSignature.ts`). The dialog owns preview and apply; `TripDayView` only takes the receipt. The 12.3 dialog tests that use `onApply` move to `onApplied` (an allowed edit of that test file only).
8. **Two endpoints, one OSRM call.** The preview must exist before applying (AC 3), and FOSSGIS asks for "one request per explicit user action" (`dayRouteService.ts:31-33`). So `POST …/suggestions/preview` computes order, legs (one multi-point OSRM call) and times, and returns them. `POST …/suggestions/apply` receives the ordered suggestions **and the preview's leg values** back, recomputes the times from them with the same pure function, and writes. It does **not** call OSRM again, so what was previewed is exactly what lands. Client-supplied leg minutes and kilometres are harmless (a user may type any leg value by hand today) but bounded by the schema.
9. **Concurrency basis.** The preview returns `basis: { afterItemId: string | null; startTime: "HH:mm" }`: the last timed existing activity (or `null` when the chain starts at check-out) and the chain's start minute. Apply sends it back. Inside the transaction the server recomputes the basis from the current rows; any difference → `409 day_plan_changed` (reuse the code from `DayPlanChangedError`, `src/app/api/trips/[id]/day-plan-items/route.ts:50`). The dialog then re-runs the preview with a short note (*Copy* `planChanged`).
10. **OSRM has no per-leg helper.** `getDayRouteFromOsrm` (`src/lib/routing/dayRouteService.ts:113-123`) takes n points but returns one total; its `OsrmRoute` type (:61-67) ignores `legs[]`. **Additively** parse `routes[0].legs[i].duration/distance` and return an optional `legs: Array<{ distanceMeters: number | null; durationSeconds: number | null }>` on `DayRouteResult`. Keep every existing field and behaviour; `test/dayRouteService.test.ts`, `test/tripDayRoute.test.ts` and `test/travelSegmentRoutePreview.test.ts` stay green unedited. Any `DayRouteError` (including `routing_no_route` for one unreachable pair) means **all** legs unknown: no per-pair retry, by the fair-use rule.
11. **Leg values follow the leg dialog's rounding.** Minutes = `Math.max(1, Math.round(durationSeconds / 60))`, km rounded to 0.1, and a zero duration or zero distance counts as no route (`TripDayTravelSegmentDialog.tsx:535-549`). Map the mode `car → driving / CAR`, `walking → walking / WALKING`, `cycling → cycling / CYCLING`. The map exists only privately in `travel-segments/route-preview/route.ts:20-24`; export one shared constant from a pure module and use it in both places.
12. **Appending can remove a leg.** Legs are drawn only between consecutive timeline entries (`src/lib/trips/daySegmentPairs.ts:44-73`). If the last existing activity has a leg to tonight's stay, the new activities sit between them, so that leg is no longer drawn. Run the Epic 11 pattern inside the transaction: `readDrawnSegmentKeysInTransaction` before, `sweepNoLongerDrawnSegmentsInTransaction` after (`TSR:319-340`), then `findCheckInWarningInTransaction` (`dayPlanPushTransaction.ts:128-167`), then `buildReceipt` (:52-66). The swept leg lands in `removedTravelSegments`, the notice mentions it, and undo restores it. 11.1's rule "nothing creates a leg except undo" (11-1 story :338) gets a **deliberate exception** here: R7. Do **not** create a leg from the last new activity to tonight's stay; the epic does not ask for one.
13. **Images: the original is usually too big.** *(After the real run the 1920 px thumbnail is tried before the 1280 px one; see the Change Log.)* Commons originals are often 10–50 MB; the limit is 5 MB (`day-plan-items/images/route.ts:27`). Wikimedia serves only standard thumbnail widths (12-2 :183: …, 960, **1280**, 1920). **Default per image, first success wins:**
    1. the 1280 px thumbnail, derived from `thumbnailUrl` by replacing the `250px-` prefix of the **last path segment** (keep the query string). Only when `thumbnailUrl` has the `/thumb/…/250px-<name>` form; a ≤ 250 px source has no such form (12-2 Deviation 1);
    2. `originalUrl`;
    3. `thumbnailUrl` itself (250 px, always small).

    Each candidate must pass `isWikimediaThumbnailUrl` (attempts 1 and 3) or `isWikimediaUploadUrl` (attempt 2) (`DSS:180,189-190`) **before** any request. Both hosts are Wikimedia's own. The download check is widened to `thumb.wikimedia.org` on purpose and nowhere else; say so in the docblock (12-2 Deviation 1 asked for this decision). A source narrower than 1280 px answers an error for attempt 1, which simply falls through.
14. **DW-386: the download must not follow redirects and must be bounded.** No code in the repo sets `redirect:` yet. Use `fetch(url, { redirect: "manual", cache: "no-store", headers: { "User-Agent": getWikimediaUserAgent() }, signal })`. Any status other than 200 (3xx included) is a failure. Read the body with a capped reader (the loop of `readJsonBodyWithinLimit`, `src/lib/http/bodyLimit.ts:93-129`, generalised to bytes: stop and `reader.cancel()` past 5 MB). Accept only when `sniffPhotoContentType(bytes)` (`src/lib/trips/importPackage.ts:431`) gives jpeg/png/webp; the extension comes from the sniffed type, never from the header or the URL. Close DW-386.
15. **Item ids are unknown before the create, and files need them in their path.** Download all images into memory **before** the transaction (at most 8 × 3 buffers ≤ 5 MB each; run at most 4 downloads at a time, 15 s total budget via `AbortSignal.any` as in `suggestionImages.ts:288-331`, 8 s per request). Inside the transaction, after each item is created, write its files with `planDayPlanItemGalleryPhoto` (`src/lib/trips/importPhotos.ts:187-197`, same `img-…` naming) and create the `DayPlanItemImage` rows **sequentially** with `sortOrder` 1..k (the pair `(dayPlanItemId, sortOrder)` is unique, `schema.prisma:279`). Collect every written path; if the transaction throws, `removeWrittenPhotos(paths)` (`importPhotos.ts:275`). This is the import's own write-then-roll-back pattern. Check whether the Prisma interactive transaction needs a larger `timeout` than the 5 s default for 24 small writes; set it explicitly if so.
16. **No plain-text → Tiptap helper exists on the server.** The only builder is client-side `buildBucketListContentJson` (TV:965-978). Add `plainTextToTiptapDoc(text: string): string` to `src/lib/trips/planText.ts` (that file is deliberately callable from both runtimes; read its docblock :1-15). One paragraph per non-empty line; the result must pass `contentJson`'s renderable-content rule (`dayPlanItemSchemas.ts:7-39`). Do not refactor `buildBucketListContentJson`.
17. **Never trust the body's suggestions beyond what a user could type.** Re-validate each one with the bounds of `suggestionSchema` (`DSS:60-79`: title 1–120, description truncated to 600, label 1–200, lat/lng ranges, `durationMinutes` int 10–600), `verified` boolean, `images` ≤ 3, each URL through its guard (item 13); a failing URL drops that image, not the request. 1–8 suggestions (`MAX_SUGGESTIONS`, `DSS:82`). `verified` is not stored.
18. **Permission: writers only, unlike the search.** The search admits an ADMIN viewer (`refuseUnlessTripPlannerOrAdminReader`). Preview and apply are planning writes: `refuseUnlessTripWriter` (`src/lib/auth/tripAccess.ts:114-126`), and the repo uses the writer clause (`findTripDayForTripWriter`, `DPIR:266-275`). Neither endpoint calls Claude, so neither checks `isAiSuggestionsEnabled` nor counts against the daily limit.

## Acceptance Criteria

1. **Order** (pure, `src/lib/trips/suggestionPlan.ts`). The *origin* is the last timed existing activity's location if it has one, otherwise the previous night's stay's coordinates, otherwise the trip start's (the same rule as `getDaySuggestionContextForUser`, `tripRepo.ts:3876-3886`). The *end* is tonight's stay's coordinates.
   - Origin and end both known and more than 500 m apart: sort by the scalar projection onto origin→end (local equirectangular plane around the origin); ties keep list order.
   - End unknown, or within 500 m of the origin: nearest-neighbour tour from the origin (`haversineMeters`, `src/lib/geo/distance.ts:18-25`); ties keep list order.
   - Origin unknown: keep the dialog's list order.
2. **Time chain.** Start minute = the end of the last **timed** existing activity (`activityEndMinutes`, `dayPlanPush.ts:104-109`) if any, otherwise `resolveCheckOutTime(previousStay?.checkOutTime)` (item 1). For each suggestion in order: `fromTime = ceil5(previousEnd + legMinutes)`, `toTime = fromTime + ceil5(durationMinutes)`, where `legMinutes` is 0 when the leg is unknown (item 3). Untimed existing activities are ignored by the chain and never moved. No existing activity is moved.
3. **Preview.** Pressing *Übernehmen (n)* calls the preview endpoint and switches the dialog to a preview step: the ordered list with `fromTime–toTime`, the place label and, between rows, the leg ("12 min · 8,4 km", or "Fahrzeit unbekannt" when unknown). The first leg comes from the origin (named as in the route block: stay name, or the last activity's title). A row past 23:59 shows "ohne Uhrzeit" and the step shows the overflow warning (item 2). When OSRM failed, a calm note says legs could not be calculated and will be left out. The step's primary is *Hinzufügen* / *Add*; a text button *Zurück zur Auswahl* returns with ticks intact. While a request runs, both are disabled and the primary shows progress.
4. **Apply.** One transaction creates, per suggestion, a `DayPlanItem` with `title`, `contentJson` from the description (item 16), `locationLat/Lng/Label` from the (verified or not) suggestion, and the computed times or none. It creates a `TravelSegment` for every **known** leg: origin item → first (`ACCOMMODATION` previous stay, or `DAY_PLAN_ITEM` last timed activity; none when the origin is the trip start, which is not an item). The leg's *from* item is always the timeline neighbour, never the ordering origin: when a last timed activity exists but has no location, ordering falls back to the stay's coordinates (AC 1), but the first leg is unknown and not created, because a stay → first leg would not be adjacent (`TSR:346-363`). Then come the legs for each consecutive pair, in the search's mode, with OSRM minutes and km (item 11). Swept legs, the check-in warning and the receipt follow item 12.
5. **Images.** Each picked suggestion's images are downloaded per items 13–15 and linked as `DayPlanItemImage` in their order. A failed image is skipped and logged once (no URL in the log beyond the host); it never fails the apply. Zero images is fine.
6. **OSRM unavailable.** Activities are still created, unknown legs are not (item 3), and the chain treats them as 0 minutes.
7. **Receipt and notice.** The apply returns `{ receipt }` signed like every other receipt (`signDayChangeReceipt(toDayChangeReceiptWire(…), { tripId, userId })`). `TripDayView` takes it through `takeDayChangeReceipt`, reloads the day and closes the dialog. The `ActionNotice` reads e.g. "4 Aktivitäten und 3 Fahrten hinzugefügt" (plus the existing removed-leg and check-in-warning fragments when present). *Rückgängig* removes every created activity, leg, image row and image file in one undo request (item 6), and restores any swept leg.
8. **Undo staleness** for `suggestionsApplied`: refuse (`409 undo_stale`) if any created item is gone or its `updatedAt` changed, has an image not in the receipt, has any document, or is referenced by a leg not in the receipt; or if any created leg is gone or changed. Otherwise phase 2 deletes the created legs, then the items (`deleteDayPlanItemInTransaction`, which must then remove no further legs), then restores removed legs; phase 3 is the existing post-condition.
9. **Permissions.** Preview, apply and undo refuse a viewer like other planning writes (403 `forbidden`; non-participant 404); an ADMIN without write rights is refused (item 18). CSRF as everywhere.
10. **Errors in the dialog.** Preview or apply failures show in the existing warn banner and keep the ticks: `day_plan_changed` → re-run the preview with the `planChanged` note; `forbidden`/`unauthorized`/`csrf_invalid`/network → the existing `errors.*` keys; anything else → `errors.server`. A failed apply writes nothing.
11. **i18n.** `en.ts` and `de.ts` carry every new string (*Copy*); `test/i18nDictionaries.test.ts` stays green.
12. **Tests and gates.** As listed in Task 8. Full suite, `tsc --noEmit`, lint (0 errors, warning baseline 80), `check:migrations` (no migration), `next build` green. `audit:check` stays waived (DW-384).

## Tasks / Subtasks

- [x] **Task 0: Baseline.** Commit the 12.3 review patches first (they are uncommitted: the dialog, its test, `deferred-work.md`, `sprint-status.yaml`, the 12.3 story file; leave `.env` and the `dev.db.backup-*` file out), or confirm with Tommy. Run the suite and record the numbers (expected about 188 files / 3097+ tests).
- [x] **Task 1: Pure planning module (AC 1, 2)**: new `src/lib/trips/suggestionPlan.ts`, no React, no Prisma, no `server-only` (the dialog may import its types).
  - [x] 1.1 `orderSuggestions(points, origin, end)` per AC 1, returning indices. Constant `SAME_PLACE_METERS = 500`.
  - [x] 1.2 `ceilToFive(minutes)` and `chainTimes({ startMinute, legMinutes: (number | null)[], durations: number[] })` → per row `{ fromTime, toTime } | null` (null = past 23:59, item 2) plus `overflow: boolean`. Use `timeToMinutes`/`LAST_MINUTE_OF_DAY` from `dayPlanPush.ts`; export `minutesToTime` from there rather than writing a second one.
  - [x] 1.3 `SUGGESTION_MODE_ROUTING` = `{ car: { profile: "driving", transport: "car" }, … }` (item 11) and `legFromOsrm(seconds, meters)` → `{ durationMinutes, distanceKm } | null`. Switch `route-preview/route.ts:20-24` to the shared map.
  - [x] 1.4 Request/response Zod schemas in `src/lib/validation/daySuggestionApplySchemas.ts` (client-safe): preview `{ mode, suggestions }`; apply `{ mode, suggestions (in order), legs: ({ durationMinutes: int 1..1440, distanceKm: number > 0 ≤ 5000 | null } | null)[] (length n), basis }` (items 8, 9, 17).
- [x] **Task 2: OSRM legs (AC 6)**: extend `dayRouteService.ts` additively (item 10). New tests in `test/dayRouteService.test.ts` are allowed as **added** cases; existing cases unedited.
- [x] **Task 3: Image download (AC 5)**: new `src/lib/trips/suggestionImageDownload.ts` (`import "server-only"`). `downloadSuggestionImages(images, { fetchImpl, signal })` → `Array<{ bytes: Buffer; contentType } >` in order, failures skipped. Items 13–15. Injectable `fetchImpl` like `suggestionImages.ts`. Docblock: why 1280 px, why the thumb host is admitted, `redirect: "manual"`, the cap, the sniff.
- [x] **Task 4: Receipt kind `suggestionsApplied` (AC 7, 8)**
  - [x] 4.1 `dayChangeReceipt.ts`: `{ kind: "suggestionsApplied"; items: { itemId; updatedAt }[]; segments: { segmentId; updatedAt }[]; imageIds: string[] }`; `mapReceipt`, wire conversion, `receiptHasSideEffects` → true, `summarizeDayChangeReceipt` with the *Copy* keys (combine with the existing removed-leg and check-in fragments the same way other kinds do).
  - [x] 4.2 `dayChangeReceiptSchemas.ts`: strict schema, items 1–8, segments 0–8, imageIds 0–24, ids ≤ 128.
  - [x] 4.3 `DCR`: `findInvalidity` (all ids belong to this day), phase 1 staleness per AC 8, phase 2 order per AC 8, return the image URLs read in the transaction; the undo route unlinks them after commit (item 6).
- [x] **Task 5: Repo and routes (AC 4, 5, 9)**
  - [x] 5.1 New `src/lib/repositories/daySuggestionApplyRepo.ts`: `loadSuggestionPlanBasisForWriter(userId, tripId, dayId)` (writer scope; previous stay with `id`, `checkOutTime`, coordinates, name; tonight's stay coordinates; trip start; the last timed activity with id, title, location, end) and `applySuggestionsForTripDay(...)` (one `$transaction`: re-check basis → item 9, drawn keys, create items + files + image rows, create legs, sweep, check-in warning, `buildReceipt`). Do not reuse `getDaySuggestionContextForUser`: it lacks ids and `checkOutTime` and admits viewers.
  - [x] 5.2 `POST src/app/api/trips/[id]/days/[dayId]/suggestions/preview/route.ts` and `…/apply/route.ts`, `runtime = "nodejs"`. Check order like the suggestions route: CSRF → session → params → `refuseUnlessTripWriter` → JSON → schema → work. Preview returns `{ order, rows: [{ fromTime, toTime } | null], legs, basis, overflow, routingUnavailable, origin: { kind: "stay" | "activity" | "tripStart" | "none", label } }`. Apply: downloads (outside), then the repo, then `ok({ receipt })`. `DayPlanChangedError` → 409 `day_plan_changed`; others → 500 `server_error`.
- [x] **Task 6: Dialog and day view (AC 3, 7, 10)**
  - [x] 6.1 `TripDaySuggestionsDialog.tsx`: replace `onApply` with `onApplied` (item 7); add `searchedMode`; add `step: "choose" | "preview"`. *Übernehmen (n)* fetches the preview; the preview step per AC 3; *Hinzufügen* posts apply with the preview's legs and basis and calls `onApplied(receipt)`. Keep the 12.3 behaviours (abort on close for search **and** for preview/apply fetches, discard guard on ticks, fresh state per open). Update the docblock (the "no Übernehmen without `onApply`" bullet changes).
  - [x] 6.2 TV:4793-4805: pass `onApplied={(receipt) => { takeDayChangeReceipt(receipt); setSuggestionsOpen(false); void loadDay(); }}` following `handlePlanDialogSaved` (TV:1634-1647); rewrite the comment above it.
- [x] **Task 7: i18n** (*Copy*), German first.
- [x] **Task 8: Tests (AC 12)**. Write each red first.
  - [x] 8.1 `test/suggestionPlan.test.ts`: projection order (start ≠ end), NN tour (end missing; end within 500 m), unknown origin keeps order, ties; chain from check-out, from the 10:00 default, after the last timed activity (untimed ones ignored), ceil-to-5 on both legs and durations, unknown leg = 0, overflow → null rows from the first that passes 23:59.
  - [x] 8.2 `test/dayRouteService.test.ts` (added cases): `legs` parsed; missing `legs` leaves the field absent.
  - [x] 8.3 `test/suggestionImageDownload.test.ts`: the 1280 derivation and fallback order, a 3xx is a failure (not followed), > 5 MB cut off, a wrong sniff rejected, a URL failing the guard never fetched.
  - [x] 8.4 `test/daySuggestionApplyRoute.test.ts` (real test DB, like `dayPlanChangeUndo.test.ts`): items/legs/images created with the right times and modes; first leg from the stay and from the last activity; trip-start origin creates no first leg; OSRM failure → no legs, items created; a failed image download skips only that image; swept stay leg in the receipt; viewer 403, ADMIN-viewer 403, CSRF 403; changed basis → 409 and nothing written; overflow rows untimed. Mock OSRM and the download module.
  - [x] 8.5 Undo (in `test/dayPlanChangeUndo.test.ts` as added cases, or a new `test/suggestionsApplyUndo.test.ts`): undo removes everything incl. files on disk and restores the swept leg; stale when an item was edited, gained an image, gained a leg; a forged receipt 400.
  - [x] 8.6 `test/dayChangeReceipt.test.ts` (added cases): summary wording for 1/n activities and 0/1/n legs; `receiptHasSideEffects` true.
  - [x] 8.7 `test/tripDaySuggestionsDialog.test.tsx`: migrate `onApply` cases to `onApplied`; preview step renders order/times/legs/overflow/unknown-leg; *Zurück* keeps ticks; apply posts the searched mode (change the toggle after searching and assert the old mode is sent), legs and basis; `day_plan_changed` re-runs the preview; error mapping.
  - [x] 8.8 `test/tripDayViewSuggestionsEntry.test.tsx` (added case): an applied receipt shows the notice text and the undo button. The five other `tripDayView*.test.tsx` files stay unedited and green.
  - [x] 8.9 Mutation discipline: drop `redirect: "manual"`; skip the basis re-check; use the current toggle instead of `searchedMode`; omit file unlinking in undo; round with `Math.round`. Each must turn a test red. Record them in the Debug Log.
- [x] **Task 9: Docs and ledger.** `docs/deployment-configuration.md` *AI day suggestions*: on apply the server downloads from `thumb.wikimedia.org` and `upload.wikimedia.org` (no redirects, 5 MB cap) and calls OSRM once. Mark **DW-386** resolved. Amend epics.md Story 12.4's AC text for items 1–3 once Tommy confirms (*Questions*).
- [x] **Task 10: Gates and a real run.** All gates. Then, with Tommy, one real search plus apply on a test trip: check order, times, legs, pictures on the activities, the notice, and *Rückgängig* (activities, legs and the files under `MEDIA_STORAGE_ROOT` gone). Check the preview step at 390 px in DevTools device mode.

### Review Findings

Code review 2026-10-16 (Blind Hunter, Edge Case Hunter, Acceptance Auditor) over `62cb7b7..58b647c`.

- [x] [Review][Patch] The first leg from the trip's start is counted in the times but never stored: keep it in the chain and mark it in the preview as not saved as a leg (Tommy, 2026-10-16: option b) [`daySuggestionApplyRepo.ts:160-164`, `:265-274`; `TripDaySuggestionsDialog.tsx` preview step]
- [x] [Review][Patch] The chain starts after the activity that starts last, not the one that ends last: start after the latest end (Tommy, 2026-10-16: option a). Applied as: the times start at the latest end (`timedEndMinute`); the first leg, the ordering origin and `afterItemId` stay with the timeline's last entry, because that is the neighbour the timeline draws and a leg from the long activity would never be drawn [`daySuggestionApplyRepo.ts:99-102`]
- [x] [Review][Patch] Closing the dialog during *Hinzufügen* commits the change but drops the receipt (no notice, no undo, no `loadDay`); block closing while `planBusy === "apply"` [`TripDaySuggestionsDialog.tsx:135-142`]
- [x] [Review][Patch] The basis is too narrow: a retried or second-tab apply whose rows are all untimed passes it again (duplicate activities), and a changed origin location, swapped previous stay or changed tonight's stay is not noticed; extend `SuggestionPlanBasis` (e.g. day item count, first-leg origin id+point, end point) [`daySuggestionApplyRepo.ts:195`, `:211`]
- [x] [Review][Patch] The apply transaction reads the day without the writer clause (item 18, Task 5.1); only the route guards it [`daySuggestionApplyRepo.ts:209`]
- [x] [Review][Patch] A failed re-preview after `409 day_plan_changed` leaves the stale preview with *Hinzufügen* enabled, so each click is another 409; drop the stale preview (back to the choice step with the error) [`TripDaySuggestionsDialog.tsx:374-377`]
- [x] [Review][Patch] A search can be started while the preview is in flight; the late preview then opens for the replaced list. Gate the search submit on `planBusy` [`TripDaySuggestionsDialog.tsx:536`]
- [x] [Review][Patch] A rolled-back apply leaves the `day-plan-items/<id>/` directories it created; `rmdir` them in the catch after `removeWrittenPhotos` [`daySuggestionApplyRepo.ts:249`, `:315-317`]
- [x] [Review][Patch] `mapPlanError` shows "server error" for `not_found` (day deleted meanwhile) and `validation_error`; map them [`TripDaySuggestionsDialog.tsx:282-293`]
- [x] [Review][Patch] Stale wording after the 1920 px change: the module doc still reasons "the viewer never scales a photo up" (it now does), the test header says "1280 px first", and item 13 / *Questions* 4 still say 1280 first [`suggestionImageDownload.ts:17-21`]
- [x] [Review][Patch] epics.md Story 12.4 still says a leg is created "between each pair of consecutive new activities"; amend it to "where the timeline draws it" as the code and Completion Notes do [`_bmad-output/planning-artifacts/epics.md`]
- [x] [Review][Defer] No rate limit on preview (OSRM) and apply (up to 96 Wikimedia fetches) for a scripted writer [`suggestions/preview/route.ts:117`, `apply/route.ts:85`] — deferred, DW-389
- [x] [Review][Defer] Apply downloads (up to ~120 MB buffered) before the cheap basis check, so a stale apply pays the full download [`apply/route.ts:84-89`] — deferred, DW-390
- [x] [Review][Defer] The preview's OSRM call is not cancelled when the client aborts; `getDayRouteFromOsrm` takes no external signal [`suggestions/preview/route.ts:117-121`] — deferred, DW-391

## Dev Notes

### Copy (de / en)

| Key | de | en |
|---|---|---|
| `trips.suggestions.previewTitle` | So würde der Tag aussehen | This is how the day would look |
| `trips.suggestions.previewFrom` | Ab {origin} | From {origin} |
| `trips.suggestions.previewFromTripStart` | Ab Startort der Reise | From the trip's starting point |
| `trips.suggestions.legUnknown` | Fahrzeit unbekannt | Travel time unknown |
| `trips.suggestions.untimed` | ohne Uhrzeit | no time |
| `trips.suggestions.overflowWarning` | Das geht über Mitternacht hinaus. Was nicht mehr passt, wird ohne Uhrzeit angelegt. | This runs past midnight. Whatever no longer fits is added without a time. |
| `trips.suggestions.routingUnavailable` | Die Fahrzeiten ließen sich gerade nicht berechnen. Die Aktivitäten werden ohne Fahrten angelegt. | Travel times could not be calculated just now. The activities will be added without travel legs. |
| `trips.suggestions.back` | Zurück zur Auswahl | Back to the selection |
| `trips.suggestions.confirmApply` | Hinzufügen | Add |
| `trips.suggestions.planChanged` | Der Tag hat sich inzwischen geändert. Die Vorschau ist neu berechnet. | The day changed in the meantime. The preview has been recalculated. |
| `trips.dayChange.activitiesAddedOne` / `activitiesAdded` | 1 Aktivität hinzugefügt / {count} Aktivitäten hinzugefügt | 1 activity added / {count} activities added |
| `trips.dayChange.activitiesAndLegsAdded` | {activities} und {legs} hinzugefügt | {activities} and {legs} added |
| `trips.dayChange.activityCountOne` / `activityCount` | 1 Aktivität / {count} Aktivitäten | 1 activity / {count} activities |
| `trips.dayChange.legCountOne` / `legCount` | 1 Fahrt / {count} Fahrten | 1 travel leg / {count} travel legs |

With 0 legs use `activitiesAdded(One)`; otherwise `activitiesAndLegsAdded` with the two count fragments. `formatMessage` only substitutes `{name}`; plurals use singular twin keys (`src/i18n/provider.tsx:126-143`). The English leg word follows the existing "travel leg(s) removed" (`en.ts:717-718`). Distances use the German decimal comma in `de` (check how the leg dialog formats km, `formatDistanceKmInput`, `TripDayTravelSegmentDialog.tsx:137-140`).

### Current state of what this story changes

- **`TripDaySuggestionsDialog.tsx`** (585 lines): search, cards, ticks, footer count and an *Übernehmen (n)* shown only with `onApply` (:271-275), disabled at 0 and while searching. `mode` is live toggle state (:97). Abort on close via `controllerRef` (:106-121). Discard guard on ticks (:124). Must keep: everything 12.3 tested, including the abort semantics and the fresh state per open.
- **TV** passes no `onApply` (:4793-4805); `takeDayChangeReceipt` (:1354-1359), `handleUndoDayChange` (:1411-1472) and the `ActionNotice` (:3789-3824) already do everything the notice needs once the new kind reports side effects. `previousStay`/`currentStay` at :2108-2109.
- **`dayChangeReceipt.ts`, `dayChangeReceiptSchemas.ts`, `DCR`, the undo route**: 7 kinds today; adding the 8th must leave every existing kind's behaviour and test unchanged.
- **`dayRouteService.ts`**: one total per call; additive change only.

### Architecture compliance

- Envelope `ok(...)`/`fail(apiError(...), status)` (`src/lib/http/response.ts`, `src/lib/errors/apiError.ts`); route-local `requireCsrf` as in the suggestions route (:45-49).
- Network calls only on the server, with an explicit `User-Agent`, `cache: "no-store"` and an abort budget that stays armed through the body read (`nominatim.ts:109-145` comment).
- Media only under `MEDIA_STORAGE_ROOT` through `uploadPaths.ts` helpers; stored URL `/uploads/trips/<trip>/days/<day>/day-plan-items/<item>/<file>`, which undo's `isSafeStoredImageUrl` and `findInvalidity` accept.
- Client components import only client-safe modules (`suggestionPlan.ts`, the apply schemas, `DSS`), never `@/lib/ai/*` or anything `server-only`.
- No migration, no dependency, no env variable.

### Testing standards

Vitest 3.2 + Testing Library, `test/` folder, camelCase names. Route tests run against the real SQLite test DB, as the existing undo and day-plan-item tests do; read `test/dayPlanChangeUndo.test.ts` for its setup (users, trip, membership, CSRF cookie) and copy it. Mock network with `vi.mock` of the module or injected `fetchImpl`, never the real internet (12.2 lesson). Point `MEDIA_STORAGE_ROOT` at a temp dir in file tests and assert files exist and vanish. `renderWithProviders` and `stubFetch` for component tests.

### Previous story intelligence

- 12.1: 4 of 5 real suggestions came back **unverified**, so many applied activities will carry the AI's coordinates. Ordering and legs still work on them; the notice says nothing about it.
- 12.2: thumbnails are on `thumb.wikimedia.org`; the 250 px fallback is therefore the most reliable attempt. One real first picture was unrelated: pictures are hints.
- 12.3: real search about 15 s. Its review asked for the schema to be the single source of field bounds; do the same for the apply schemas (derive from `DSS` where possible).
- 11.x: every receipt-producing write follows the same seven steps (`DPIR:528-594`); the staleness table in the 11-1 story :313-326 is the model for AC 8.
- Gate baseline after 12.3: 188 files / 3097 tests, tsc 0, lint 0 errors / 80 warnings.

### Git intelligence

`f917a7a` (12.1) route, schemas, context loader; `072fe85` (12.2) `suggestionImages.ts`, URL guards; `08e7cbc` (12.3) the dialog and `DialogShell.fullScreenOnPhone`. Epic 11's receipt work is the pattern to copy for the transaction and the undo branch.

### Latest technical information (2026-10-16)

- `fetch` `redirect: "manual"` in Node (undici) returns the 3xx response itself (status 301–308, not an opaque-redirect filtered response as in browsers), so check `response.status === 200` explicitly.
- `AbortSignal.any` and `ReadableStream.getReader()` are available in the project's Node; both are already used.
- Wikimedia thumbnails: standard widths only since 2026-01; a width wider than the source returns an error rather than an upscale.

### Project Structure Notes

New: `src/lib/trips/suggestionPlan.ts`, `src/lib/trips/suggestionImageDownload.ts`, `src/lib/validation/daySuggestionApplySchemas.ts`, `src/lib/repositories/daySuggestionApplyRepo.ts`, `src/app/api/trips/[id]/days/[dayId]/suggestions/preview/route.ts`, `…/apply/route.ts`, tests per Task 8.
Updated: `dayRouteService.ts`, `dayPlanPush.ts` (export `minutesToTime`), `planText.ts`, `travel-segments/route-preview/route.ts` (shared map), `dayChangeReceipt.ts`, `dayChangeReceiptSchemas.ts`, `dayPlanChangeRepo.ts`, `day-plan-changes/undo/route.ts`, `TripDaySuggestionsDialog.tsx`, `TripDayView.tsx`, `en.ts`, `de.ts`, `docs/deployment-configuration.md`, `deferred-work.md` (DW-386), `epics.md` (Task 9).

### Questions for Tommy (not blocking; the defaults above apply)

1. **Start at 10:00, not 09:00 (item 1).** The timeline already shows 10:00 as the default check-out. Recommendation: 10:00, and correct the epic.
2. **Past midnight (item 2).** The time format cannot hold it. Default: those activities are added without times. Alternative: leave them out of the apply. Recommendation: without times, because nothing ticked gets lost.
3. **Legs when OSRM is down (item 3).** Default: no leg is created. Alternative: a migration making `durationMinutes` nullable, which touches the leg dialog, the timeline and Epic 11's push. Recommendation: no leg; the user can draw it later in the leg dialog, which fetches the route itself.
4. **Pictures at 1280 px (item 13).** *(Superseded after the real run: 1920 px is tried first, then 1280 px; see the Change Log.)* Default: the 1280 px Wikimedia thumbnail, falling back to the original and then to the 250 px one. That means downloads also come from `thumb.wikimedia.org`. Recommendation: yes; originals would mostly exceed 5 MB.

### References

- [epics.md — Story 12.4](../planning-artifacts/epics.md) · [sprint-change-proposal-2026-10-16.md](../planning-artifacts/sprint-change-proposal-2026-10-16.md) R5–R7, D1–D4
- `src/lib/trips/stayTimes.ts`; `src/lib/trips/dayPlanPush.ts:78-109`; `src/lib/trips/dayPlanItemOrder.ts:67-86`; `src/lib/repositories/dayPlanPushTransaction.ts:52-167`
- `src/lib/trips/dayChangeReceipt.ts:124-314`; `src/lib/validation/dayChangeReceiptSchemas.ts:119-223`; `src/lib/trips/dayChangeReceiptSignature.ts`; `DCR:72-411`; `src/app/api/trips/[id]/day-plan-changes/undo/route.ts`
- `DPIR:266-275, 458-595, 1088-1112`; `TSR:234-382, 450-536`; `src/lib/trips/daySegmentPairs.ts:44-73`
- `src/lib/routing/dayRouteService.ts:1-203`; `src/app/api/trips/[id]/travel-segments/route-preview/route.ts:20-24`; `TripDayTravelSegmentDialog.tsx:497-549`
- `DSS:9-190`; `src/lib/ai/suggestionImages.ts:42-331`; `src/app/api/trips/[id]/day-plan-items/images/route.ts:27-178`; `src/lib/trips/uploadPaths.ts:35-291`; `src/lib/trips/mediaCleanup.ts:61-143`; `src/lib/trips/importPhotos.ts:187-277`; `src/lib/trips/importPackage.ts:409-431`; `src/lib/http/bodyLimit.ts:93-129`
- `src/lib/repositories/tripRepo.ts:3793-3907`; `src/lib/auth/tripAccess.ts:114-165`; `src/lib/geo/distance.ts`
- TV:965-978, 1354-1472, 1634-1647, 2108-2109, 3789-3824, 4793-4805; `TripDaySuggestionsDialog.tsx`
- 11-1 story §2, :64-100, :313-338; 12-2 story :183, :196, Deviation 1; DW-187, DW-386

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (claude-opus-5-5), via bmad-dev-story, 2026-10-16.

### Debug Log References

- Task 0: the 12.3 code patches were already in `ec5e019`; only the 12.3 artifacts (story file, `deferred-work.md`, `sprint-status.yaml`) were uncommitted. Committed as `62cb7b7`, `.env` left out; `baseline_commit` set to it. Baseline suite: 188 files / 3101 tests green (the 12.3 review added 4 to the 3097 the story expected).
- Red first: `suggestionPlan`, the OSRM leg cases, `suggestionImageDownload` and the receipt cases were written and run red before the code. The two DB route suites and the dialog/entry cases were written after the code they test; the mutation checks below are their red evidence.
- Mutation discipline (8.9), each run and reverted, each turned a test red:
  1. drop `redirect: "manual"` → `suggestionImageDownload.test.ts` "takes the 1280 px thumbnail…" (asserts the init).
  2. skip the basis re-check in `applySuggestionsForTripDay` → `daySuggestionApplyRoute.test.ts` "refuses with 409 and writes nothing…".
  3. send the live toggle instead of `searchedMode` → `tripDaySuggestionsDialog.test.tsx` "applies in visiting order with the searched mode…".
  4. skip the file unlink in the undo route → `suggestionsApplyUndo.test.ts` "removes every activity, leg, picture row and file…".
  5. `Math.round` instead of `Math.ceil` in `ceilToFive` → 3 cases in `suggestionPlan.test.ts`.
- Two defects caught by the new suites: the preview route copied however many legs OSRM returned (a count mismatch made apply refuse its own preview with 400; now a mismatch is "routing unavailable", with a test); and the undo result gained a field that broke 12 unedited `toEqual({ status: "undone" })` pins in `dayPlanChangeUndo.test.ts`, so `removedImageFiles` is present only when there are files.
- Full suite: 192 files / 3170 tests green (baseline 188 / 3101). Gates: `tsc --noEmit` 0; lint 0 errors / 80 warnings (baseline unchanged); `check:migrations` passes (no migration); `next build` succeeds and lists `…/suggestions/preview` and `…/suggestions/apply` (no `server-only` import reached the dialog). `audit:check` waived (DW-384).

### Completion Notes List

- Tommy's answers to the *Questions* (2026-10-16): **1 → c**: a stored check-out always wins, a stay without one keeps the timeline's 10:00 default, and only a day with no stay the night before (the trip's first day) starts at **09:00** (`DAY_START_WITHOUT_STAY` in `suggestionPlan.ts`, pinned by the trip-start route case). **2 → yes** (untimed past 23:59). **3 → A** (no leg without an OSRM value). **4 → yes** (1280 px → original → 250 px). epics.md Story 12.4's AC text amended for 1–3.
- **Deviations from the story text, all small:**
  - `downloadSuggestionImages` takes one array of pictures **per suggestion** (`SuggestionImage[][]`) and returns the same shape, so the 4-at-a-time limit and the 15 s budget span the whole apply rather than one suggestion.
  - The apply schema accepts `distanceKm: null` on a leg as the story says, but refuses it for car (the leg route's rule, `transportTypeRequiresDistance`). `legFromOsrm` always yields a distance (at least 0.1 km), so the preview never produces such a leg.
  - The check-in warning runs on the apply even though nothing moves: `findCheckInWarningInTransaction` returns early without moves, so its body was split into `findCheckInWarningForOrderInTransaction` (the old function calls it; unchanged behaviour for 11.x).
  - Legs are created only where the **final** timeline draws them, not merely "for each consecutive pair": an existing untimed activity sorts between a timed new stop and an untimed (past-midnight) new stop, and a leg there would be born orphaned.
  - On the first day the trip start is the ordering origin and its leg is part of the time chain and shown in the preview, but no leg is stored (it is not an item), as AC4 says.
  - One i18n key beyond the *Copy* table: `trips.suggestions.legSummary` ("{minutes} min · {km} km"), km formatted with `Intl.NumberFormat` per language (decimal comma in German).
  - `suggestionSchema` in `daySuggestionSchemas.ts` is now exported, so the apply schema derives its bounds from it (12.3 review's single-source rule).
- `tripDayViewSuggestionsEntry.test.tsx` had one assertion pinning "Story 12.4 has not wired the apply yet" (no *Add* button); it now asserts *Add (0)* disabled. The five other `tripDayView*.test.tsx` files are unedited.
- DW-386 closed. Docs: one paragraph in *AI day suggestions* on what preview and apply send and download.
- Task 10: real search, apply and *Rückgängig* done by Tommy in Safari on the dev server, files checked on disk. **The 390 px check of the preview step was not done**; Tommy accepted it unchecked ("passt schon"), as in 12.3.

### File List

New:
- `travelplan/src/lib/trips/suggestionPlan.ts`
- `travelplan/src/lib/trips/suggestionImageDownload.ts`
- `travelplan/src/lib/validation/daySuggestionApplySchemas.ts`
- `travelplan/src/lib/repositories/daySuggestionApplyRepo.ts`
- `travelplan/src/app/api/trips/[id]/days/[dayId]/suggestions/preview/route.ts`
- `travelplan/src/app/api/trips/[id]/days/[dayId]/suggestions/apply/route.ts`
- `travelplan/test/suggestionPlan.test.ts`
- `travelplan/test/suggestionImageDownload.test.ts`
- `travelplan/test/daySuggestionApplyRoute.test.ts`
- `travelplan/test/suggestionsApplyUndo.test.ts`
- `travelplan/test/helpers/suggestionApplyFixtures.ts`

Modified:
- `travelplan/src/lib/routing/dayRouteService.ts`
- `travelplan/src/lib/trips/dayPlanPush.ts`
- `travelplan/src/lib/trips/planText.ts`
- `travelplan/src/lib/trips/dayChangeReceipt.ts`
- `travelplan/src/lib/validation/dayChangeReceiptSchemas.ts`
- `travelplan/src/lib/validation/daySuggestionSchemas.ts`
- `travelplan/src/lib/repositories/dayPlanChangeRepo.ts`
- `travelplan/src/lib/repositories/dayPlanPushTransaction.ts`
- `travelplan/src/app/api/trips/[id]/day-plan-changes/undo/route.ts`
- `travelplan/src/app/api/trips/[id]/travel-segments/route-preview/route.ts`
- `travelplan/src/components/features/trips/TripDaySuggestionsDialog.tsx`
- `travelplan/src/components/features/trips/TripDayView.tsx`
- `travelplan/src/components/ui/FullscreenPhotoViewer.tsx`
- `travelplan/src/i18n/de.ts`
- `travelplan/src/i18n/en.ts`
- `travelplan/test/dayRouteService.test.ts`
- `travelplan/test/dayChangeReceipt.test.ts`
- `travelplan/test/tripDaySuggestionsDialog.test.tsx`
- `travelplan/test/tripDayViewSuggestionsEntry.test.tsx`
- `docs/deployment-configuration.md`
- `_bmad-output/planning-artifacts/epics.md`
- `_bmad-output/implementation-artifacts/deferred-work.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/implementation-artifacts/12-4-take-them-over-in-visiting-order.md`

### Change Log

- 2026-10-16: Tasks 0–8 implemented and tested; Task 9 done except the epics.md amendment (waits for Tommy's answers to *Questions* 1–3). DW-386 closed. Task 10 (real run with Tommy, 390 px check) open, so the story stays in-progress.
- 2026-10-16: Tommy answered the four *Questions* (1c, 2 yes, 3A, 4 yes). Without a stay the night before, the chain now starts at 09:00; epics.md amended. Task 9 closed; Task 10 open.
- 2026-10-16: After Tommy's test run: the pictures on the added activities looked small in the fullscreen viewer, which never scales a photo up. All 16 stored files were 1280 px wide. The download now tries the 1920 px thumbnail first, then 1280 px, the original and 250 px (`WIDE_THUMBNAIL_WIDTHS`). An unrequested enlargement of the dialog thumbnails and of the timeline photo strip, made while the request was misunderstood, was reverted.
- 2026-10-16: Tommy's Safari showed every photo in the fullscreen viewer far too small (about 1/12 of its size), his own photos included once he looked. Not reproducible in Chrome or Playwright WebKit with the real markup. `FullscreenPhotoViewer` now gives the image the whole area inside its padding and fits it with `object-fit: contain`, so the size no longer depends on the intrinsic size the browser computes; photos smaller than the screen are scaled up. Outside this story's scope, done at Tommy's request.
- 2026-10-16: Real run by Tommy (Task 10): several searches and applies on the Neuseeland trip, pictures, legs and notice as expected; *Rückgängig* removed both activities and their files (checked on disk). On his request the undo route now also removes each activity's then-empty image directory (`rmdir`, never recursive), pinned in `suggestionsApplyUndo.test.ts`. Full suite before that last change: 192 files / 3170 tests; the undo suites after it: 55 green. Still open: the 390 px check of the preview step.
- 2026-10-16: The 10 image folders his test activities left behind (8 deleted one by one, 2 emptied by undo) were removed on Tommy's request; only folders under that day whose id has no row. 390 px accepted unchecked. Status → review.
- 2026-10-16: Code review (3 layers): 2 decisions (1b, 2a) and 9 patches applied, 3 deferred (DW-389–391), 12 dismissed. Basis gains a `fingerprint` (item count, first-leg origin and point, ordering origin, tonight's stay), so a repeated all-untimed apply and a moved origin answer 409; apply reads through the writer clause; the chain starts at the latest end on the day; the trip-start leg says "not saved as a leg"; the dialog cannot be closed during apply, starts no search while busy, drops a stale preview when the re-preview fails, and maps `not_found`/`validation_error`; a rolled-back apply removes its activity directories; epics.md amended. 192 files / 3180 tests, tsc 0, lint 0/80; 8 mutations each turn a test red.
