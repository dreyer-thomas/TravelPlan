---
baseline_commit: f4957e328390aff2157d234310cef228da20ad39
---

# Story 14.2: Park It for Another Day

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As someone whose day holds more than it can,
I want to move an activity out of the day into the bucket list with one action,
so that the day works again and the activity waits, complete, for a day that has room.

**FRs covered:** FR48. **Depends on:** Story 14.1 (done 2026-10-18 at `f4957e3`: parked activities, `parkedDayPlanItemsWhere`, the `scheduled` receipt kind, `day-plan-items/schedule`, the Day Detail bucket panel).

Sources:
- [epics.md#Story 14.2](../planning-artifacts/epics.md)
- [sprint-change-proposal-2026-10-17-bucket-parking.md](../planning-artifacts/sprint-change-proposal-2026-10-17-bucket-parking.md): *Technical impact* (Receipts and undo), *UX impact*, §5 success criteria 1–3, *Decisions recorded* 2 and 8, §6 *Architecture Review*
- [architecture.md](../planning-artifacts/architecture.md): *API & Communication Patterns* "Parking and scheduling" (line 170), *Data Architecture* "Activities without a day" (line 147)
- `ux-designs/ux-TravelPlan-2026-07-27/EXPERIENCE.md:91` (*Parking an activity*)
- [14-1-one-kind-of-entry.md](14-1-one-kind-of-entry.md)

All code paths below are relative to `travelplan/`. Line numbers were read on 2026-10-18 at `f4957e3`.

| Short | Path |
|---|---|
| `TV` | `src/components/features/trips/TripDayView.tsx` (5179 lines) |
| `DPIR` | `src/lib/repositories/dayPlanItemRepo.ts` |
| `DCR` | `src/lib/repositories/dayPlanChangeRepo.ts` |
| `DST` | `src/lib/repositories/dayScheduleTransaction.ts` |
| `DCRc` | `src/lib/trips/dayChangeReceipt.ts` |
| `DCRS` | `src/lib/validation/dayChangeReceiptSchemas.ts` |
| `TSR` | `src/lib/repositories/travelSegmentRepo.ts` |

**Search caveat (from 14.1):** plain `grep` treats some repos as binary and prints nothing. Use `grep -a`.

## Read this first: where the epic's wording meets the code

Each point was checked against the code. Items marked **(Q)** are defaults for Tommy to confirm; they are repeated under *Questions*.

1. **This story is a sibling of 14.1's schedule, run backwards.** Almost everything exists:
   - delete's planning and leg handling: `deleteDayPlanItemForTripDay` (`DPIR:901-955`) and `deleteDayPlanItemInTransaction` (`DPIR:582-617`);
   - the recompute and receipt tail: `finishActivityWriteInTransaction` (`DPIR:530-564`);
   - 14.1's route and client handler to mirror: `day-plan-items/schedule/route.ts` and `handleScheduleBucketItem` (`TV:1346-1400`);
   - 14.1's undo kind `scheduled` in all three exhaustive switches.

   No schema change and no migration. The parked `CHECK` from 14.1 (`trip_day_id IS NULL` ⇒ FLEXIBLE, null times, `sort_order = 0`) is the guard the park write must satisfy.

2. **The park write, inside one transaction.** Add `parkDayPlanItemForTripDay({ userId, tripId, tripDayId, itemId })` to `DPIR`, next to `scheduleParkedDayPlanItemForTripDay`. It follows `deleteDayPlanItemForTripDay`'s order, with the delete replaced by an update. Everything is read and planned before the first write:
   1. `findTripDayForTripWriter` outside the transaction → `not_found`.
   2. `readScheduleInputInTransaction(tx, tripId, tripDayId)`; the row must be in `state.rows`, else `missing`.
   3. Read the row itself: `findFirst({ where: { id: itemId, tripDayId }, select: { id, title, scheduleMode, durationMinutes, sortOrder, fromTime, toTime, updatedAt } })`. This is `previous`.
   4. `planDaySchedule(state, { kind: "remove", itemId })`. `past_midnight` returns the refusal, as delete does.
   5. `readDrawnSegmentKeysInTransaction(tx, tripId, tripDayId)` → `drawnBefore`.
   6. The park itself: `updateMany({ where: { id: itemId, tripDayId, updatedAt: previous.updatedAt }, data: { tripDayId: null, scheduleMode: "FLEXIBLE", durationMinutes: <point 3>, fromTime: null, toTime: null, sortOrder: 0, updatedAt: now } })`. A count of 0 throws `DayPlanChangedError` (409 `day_plan_changed`).
   7. `removeTravelSegmentsReferencingItemInTransaction(tx, [tripDayId], "DAY_PLAN_ITEM", itemId)` (`TSR:437`), exactly as delete does.
   8. `finishActivityWriteInTransaction(tx, { tripId, tripDayId, drawnBefore, now }, plan, edited, { removedTravelSegments: referencing })`. It applies the other rows' changes, sweeps the legs the new order no longer draws, and merges both leg sets once each.
   9. Return `{ status: "parked", item, receipt }` with `item` as `toDetail` builds it (now `tripDayId: null`).

   Why the `updatedAt` condition in step 6 when delete has none: delete snapshots the whole row for undo and is unconditional by id and day. Park keeps the row, and its receipt names the `updatedAt` it wrote, so a concurrent edit between read and write must lose cleanly, as schedule's does (`DPIR:771`).

   **Do not call `deleteDayPlanItemInTransaction`, and do not copy the row anywhere.** The architecture's rule is that parking changes `tripDayId` and the schedule columns only. Images, documents and payments are untouched, so their ids stay the same.

3. **Duration of a parked activity.** A FLEXIBLE one keeps `durationMinutes`. A FIXED one gets `toTime − fromTime` when both times parse and the end is after the start, else its stored `durationMinutes`. That is the same rule `scheduleFieldsOf` uses (`DPIR:487-505`), so in practice it equals the stored value. Compute it anyway, so a row whose stored duration drifted (13.1's backfill) parks with what the user saw.

   Use `timeToMinutes` as `scheduleFieldsOf` does. **No clamp.** A migrated fixed row may last 1 minute (`DCRS:106`). The parked dialog's duration field then asks for at least 5 on the next save. That is acceptable and is noted for review, not fixed here.

4. **The receipt kind is the architecture's, verbatim.** Add it to `DayChangeEdited` (`DCRc:137`):

   ```ts
   | {
       kind: "parked";
       itemId: string;
       updatedAt: T; // post-park stamp
       previous: {
         tripDayId: string;
         scheduleMode: DayChangeScheduleMode;
         durationMinutes: number;
         sortOrder: number;
         fromTime: string | null;
         toTime: string | null;
         updatedAt: T;
       };
     }
   ```

   - The receipt's `tripDayId` is the day that was recomputed (never null), and `DayPlanItemRow.tripDayId` stays `string` (architecture).
   - `version` stays `3`.
   - `movedItems` holds the later rows that moved earlier or were renumbered; `removedTravelSegments` holds the referencing legs plus the swept ones.

   Wire it through everything that switches on the kind:
   - `mapReceipt` (`DCRc:224`): convert `updatedAt` and `previous.updatedAt`.
   - The zod union (`DCRS:164`): `.strict()`, `previous` `.strict()`, `tripDayId: idSchema`, `scheduleMode: z.enum(["FLEXIBLE","FIXED"])`, `durationMinutes`/`sortOrder` as `dayPlanItemColumns` has them (`DCRS:107-109`), times `nullableText()`, stamps `isoDateSchema`.
   - `findInvalidity` (`DCR:126`), both undo phases (`DCR:308`, `DCR:390`): see point 6.
   - `receiptHasSideEffects` (`DCRc:327`): **true** for `parked`, always. The activity left the day, and the notice is the only way to take it back, even when nothing else moved. This is the same reasoning as `scheduled`.
   - `summarizeDayChangeReceipt` (`DCRc:356`): see point 7.

   The exhaustive `never` defaults make the compiler find every switch. Do not silence one with a cast.

5. **The route.** Add `POST /api/trips/[id]/day-plan-items/park/route.ts`, a copy of `schedule/route.ts` in shape:
   - CSRF;
   - `requireSession`;
   - `refuseUnlessTripWriter` (viewer 403 `forbidden`, non-participant 404), the same gate as schedule and the bucket list, per 14.1's deviation 1;
   - zod `dayPlanItemParkSchema = { itemId, tripDayId }` `.strict()` in `dayPlanItemSchemas.ts`, beside `dayPlanItemScheduleSchema` (`:257`);
   - `withPushConflict` → `dayChangedResponse()`;
   - `past_midnight` → `pastMidnightResponse`;
   - `not_found` and `missing` → 404;
   - success `ok({ item: { ...item, createdAt: ISO }, receipt: signDayChangeReceipt(toDayChangeReceiptWire(receipt), { tripId, userId }) })`;
   - a logged 500 in the `catch`, as the schedule route's review patch added.

   **Deviation from the architecture's `{ itemId }`:** the body also carries `tripDayId`. The park is then conditional on the activity still being on the day the user is looking at. Without it, a park sent from a stale tab would follow the activity to whatever day another tab moved it to. `move` (`DPIR:1045-1051`) and `schedule` both carry the day for the same reason.

6. **Undo of `parked`** (`DCR`). Keep it a mirror of `scheduled`:
   - **`findInvalidity`:**
     - `edited.previous.tripDayId === receipt.tripDayId`, else "item on another day";
     - add `parked` to the `editedId` kinds (`DCR:155-160`), so `movedItems` naming the parked item is "edited item listed as moved";
     - `removedTravelSegments` may be non-empty: they are the legs the park removed. The existing per-leg day and duplicate checks apply.
   - **Phase 1 (stale):** the item exists with `{ id: itemId, tripId, tripDayId: null }` and `updatedAt === edited.updatedAt`. Then the generic `movedItems` and removed-leg checks run as they do for every kind.
     - New pictures or documents added while it was parked do **not** make it stale: nothing is deleted, and they come back to the day with it (symmetry with `scheduled`).
     - An edit in the bucket dialog **does** make it stale (its `updatedAt` changes), and so does scheduling it somewhere with "+".
   - **Phase 2:** first the conditional `updateMany({ where: { id: itemId, tripId, tripDayId: null, updatedAt: edited.updatedAt }, data: { tripDayId: previous.tripDayId, scheduleMode: previous.scheduleMode, durationMinutes: previous.durationMinutes, sortOrder: previous.sortOrder, fromTime: previous.fromTime, toTime: previous.toTime, updatedAt: previous.updatedAt } })`, with count ≠ 1 → `UndoStaleError`. Then the generic `movedItems` restore and the leg re-creation run unchanged.
     - **No** `renumberDayInTransaction`. `movedItems` carries every renumbered row's `previousSortOrder`, and the item gets its own back, so the order is restored exactly. A renumber would only hide a missing `movedItems` entry. This differs from `scheduled`, where the item leaves the day.
   - **Phase 3** needs no change. The restored legs must be drawn on the final timeline, which holds once the item is back in its place. A leg the user drew *across* the gap after parking (A→C where the parked B was) is a protected leg that the undo would un-draw, so the undo refuses as stale. That is correct: undo never overwrites a later edit.
   - **The route:** `undo/route.ts` needs no change. `parked` removes no files.
   - **Client:** after a successful undo of `parked`, reload the bucket list, as for `scheduled` (`TV:1476-1478`).

7. **The notice.** The epic's text is „Wasserfall" geparkt, plus the moved count if any.
   - `summarizeDayChangeReceipt` leads with `trips.dayChange.parked` („{title}" geparkt) for a `parked` receipt. The generic moved and leg parts follow it, as for every kind.
   - So a park that removed a leg reads „Wasserfall" geparkt · 2 Aktivitäten verschoben · 1 Fahrt entfernt. The leg part is what delete shows today, and parking deletes legs the user typed, so it must not happen in silence (6.23 AC4's reasoning) **(Q2)**.
   - **The title:** the receipt carries no title, and after the reload the activity is no longer in `planItems`, so `TV`'s `scheduledTitle` lookup (`TV:3858-3867`) cannot find it. Capture the title **before** the request, from `planItemsRef.current`. Use the same rule as the card (`TV:4336-4337`): `title?.trim()` or the content preview. Hold it in the state 14.1 added for the schedule notice (`scheduledIdea`, `{ id, title }`).
   - Generalise the option: rename `summarizeDayChangeReceipt`'s `scheduledTitle` to `itemTitle`, and `scheduledIdea` to `noticeItem`. Both kinds read it. Update 14.1's tests that pass `scheduledTitle`; there are only a few (`grep -an scheduledTitle test src`). Do not add a second, parallel option.

8. **The menu.** The epic AC says *Parken* is chosen from the activity's menu. Today that is the card's overflow menu (Story 11.3, `TV:5097-5116`), and its trigger renders only when the activity can move up or down (`TV:4348-4351`, `showItemMenu`). So a FIXED activity, or a lone one, has no trigger.
   - **Change the gate:** `showItemMenu = canEditPlanning`. Every activity a writer sees gets the trigger. 11.3's AC4 ("absent when it would open an empty menu") still holds, because *Parken* is always in it.
   - **Menu state:** `planItemMenu` keeps `canMoveUp`/`canMoveDown` and needs nothing new.
   - **Placement:** *Parken* is the last item, after *Nach oben* / *Nach unten*, with `sx={DAY_MENU_ITEM_SX}` and no `aria-label` (11.3's rule). No divider.
   - **The dialog:** *Auf anderen Tag verschieben* lives in the dialog footer as "anderer Tag" (`TripDayPlanDialog.tsx:2476-2494`), not in this menu. The UX line "next to *Auf anderen Tag verschieben*" is read as "a sibling action". Do not add *Parken* to the dialog footer: at 390 px it already holds "anderer Tag", the trash glyph and OK **(Q1)**.
   - **Tests that change:** two tests in `test/tripDayViewReorder.test.tsx` pin the old gate: `:216` "never on a fixed one" and `:228` "no trigger on a lone activity". Rewrite them for the new rule: a writer sees a trigger on every card; a fixed or lone card's menu holds only *Parken*. **Do not delete them.**

9. **The client handler.** Add `handleParkPlanItem(itemId)` to `TV`, modelled on `handleReorderPlan` (`TV:1520-1587`) and `handleScheduleBucketItem`:
   - **Before any await:** close the menu (`setPlanItemMenu(null)`), check `canEditPlanning` and `day`, claim an in-flight ref, `setError(null)`, `setPlanMoveNotice(null)`, `setDayChange(null)`, and capture the title (point 7).
   - **Request:** `POST /api/trips/${tripId}/day-plan-items/park` with `{ itemId, tripDayId: day.id }` and the CSRF header.
   - **Late answer:** drop the response when `currentDayIdRef.current` has changed.
   - **Success:** `setNoticeItem({ id, title })`, `takeDayChangeReceipt(receipt)`, `await loadDay({ silent: true })`.
   - **Refusals** (reload first, then set the message, because `loadDay` clears the error):
     - 409 `day_plan_changed` → `trips.plan.parkStale`;
     - 409 `day_plan_past_midnight` → `trips.plan.pastMidnight` with the title from `details`;
     - 404 → `resolveApiError(code, t("trips.plan.parkError"))`;
     - anything else → the same fallback.
   - **Network failure:** `resolveApiError("network_error", t("trips.plan.parkError"))`.
   - **`finally`:** release the ref and `void loadBucketListItems()`. On success the activity joined the list. On a refusal or a lost answer the list is still the trip's, so it reloads on every path, as 14.1's review patch made `handleScheduleBucketItem` do.

   **Not optimistic.** The server decides the recompute, and the day reloads to show it (11.3's rule). Costs and "Kosten bisher" come from the reloaded day; parked costs count in no total (14.1 AC3), so €25 leaves the day's totals on the reload.

10. **No confirmation.** Parking is undoable, so there is no `window.confirm` (decision 8). The menu item acts at once.

11. **What must not change:**
    - delete, its receipt and DW-187 (delete keeps files);
    - move between days (6.23) and its notice;
    - reorder (11.3) and its refusals;
    - the `scheduled` kind and its undo;
    - the bucket panels;
    - every reader that goes through the day (they already exclude parked rows, 14.1 AC3);
    - viewer access to the day view.

## Acceptance Criteria

1. **Park.** An owner or contributor chooses *Parken* from an activity's overflow menu on Day Detail. In one transaction, the activity (same row, same id):
   - leaves the day: `tripDayId` null, FLEXIBLE, times null, `sortOrder` 0;
   - keeps its duration. A FIXED one gets `toTime − fromTime`; a FLEXIBLE one keeps `durationMinutes`.
   - loses its travel legs, both the ones that reference it and the ones that are no longer consecutive (swept);
   - leaves the day recomputed: later flexible activities move earlier, and the remaining rows are renumbered densely.

   Its title, description, link, location, cost, payments, pictures and documents are unchanged (same rows, same ids). It appears in the Day Detail bucket list without a page reload. No confirmation is asked.
2. **Trigger.** Every activity card shows the overflow trigger to an owner or contributor, including a FIXED one and a lone one. Its menu holds *Nach oben* / *Nach unten* where they apply, and always *Parken* as the last item.
3. **Notice.** After a park, the `action-notice` reads *„{title}" geparkt*, followed by the moved count if any and the removed-leg count if any (" · "-joined, the existing parts), and offers *Rückgängig*. The notice appears even when nothing else moved.
4. **Undo.** *Rückgängig* restores the day exactly: the activity's day, mode, duration, times, order and `updatedAt`, every moved or renumbered row, and every removed leg with its id. A test compares the whole database before and after with `toEqual`. The bucket list is reloaded.
   - Undo is refused with `409 undo_stale` if the parked activity was edited or scheduled since, if any moved row changed, if a removed leg exists again, or if restoring would un-draw a leg created since.
   - New pictures or documents on the parked activity do **not** refuse undo; they come back to the day with it.
5. **Receipt.** The receipt is `version: 3` with `edited: { kind: "parked", itemId, updatedAt, previous: { tripDayId, scheduleMode, durationMinutes, sortOrder, fromTime, toTime, updatedAt } }`, `strict` on the wire. A tampered receipt is refused with 400 and writes nothing. That covers `previous.tripDayId` ≠ the receipt's day, the parked item listed in `movedItems`, and an unknown field.
6. **Round trip.** A parked activity scheduled onto **another** day with the bucket row's "+" (14.1) arrives with the same pictures, documents, costs, payments, link, description and duration it had before parking: same ids, and a whole-row compare apart from the day, schedule columns and stamps. A FIXED 10:00–12:00 activity comes back as FLEXIBLE with 120 minutes.
7. **Roles.** A viewer sees no overflow trigger and so no *Parken*. `POST …/day-plan-items/park` answers 403 to a viewer and 404 to a non-participant, and writes nothing. A missing CSRF token gets 403.
8. **Refusals.**
   - An activity no longer on the named day (moved, parked or deleted elsewhere) gets 404 and writes nothing.
   - A concurrent change gets `409 day_plan_changed` and writes nothing; the day reloads and says so (`trips.plan.parkStale`).
   - Any other failure shows `trips.plan.parkError`.
   - After any refusal, the bucket list is reloaded too.
9. **Dictionaries.** `en.ts` and `de.ts` carry every new string (`i18nDictionaries.test.ts` stays green).
10. **Regression.** Every other suite stays green: `tsc --noEmit` 0, lint 0 errors, `next build`. Delete, move, reorder, schedule and their undos behave exactly as after 14.1.

## Tasks / Subtasks

- [x] **Task 0: Baseline** (AC 10)
  - [x] Run the suite, `tsc`, lint and build at `f4957e3`, and record the counts. 14.1 ended at 200 files / 3278 tests, `tsc` 0, lint 0 errors / 79 warnings.
- [x] **Task 1: Receipt kind `parked`, red first** (AC 5; point 4)
  - [x] `DCRc`: the type, `mapReceipt`, `receiptHasSideEffects` (true), and the header docblock paragraph ("Story 14.2 adds `parked` …"), as 14.1 added its own.
  - [x] `DCRS`: the strict schema member.
  - [x] `test/dayChangeReceipt.test.ts`:
    - wire round trip of a `parked` receipt;
    - `receiptHasSideEffects` is true with empty `movedItems` and legs;
    - the schema refuses an extra field in `previous`, a null `previous.tripDayId`, and a missing `previous.updatedAt`.
- [x] **Task 2: Repository write** (AC 1, 8; points 2, 3)
  - [x] `DPIR`: `DayPlanItemParkResult = not_found | missing | DayPlanPushRefusal | { status: "parked"; item; receipt }`, and `parkDayPlanItemForTripDay`, with a docblock in the style of `scheduleParkedDayPlanItemForTripDay`'s.
  - [x] A test file, `test/dayPlanItemPark.test.ts`. Seed with direct `prisma.dayPlanItem.create`, with `tripId` on every seed (14.1 point 11). It covers:
    - a flexible activity in the middle of three: later ones move earlier by its duration plus the leg; `sortOrder` is dense; the parked row matches the CHECK;
    - a FIXED 10:00–12:00 parks with 120 minutes;
    - referencing legs (into and out of it) and a swept leg (the stay leg un-drawn when the last activity parks) are all in `removedTravelSegments`, each once;
    - images, documents and payments are the same rows (`toEqual` before and after);
    - the parked row appears in `parkedDayPlanItemsWhere(tripId)` and not in `listDayPlanItemsForTripDay`;
    - `missing` for an item on another day, and for an already parked one;
    - `not_found` for a viewer's call (the writer clause);
    - a concurrent `updatedAt` change makes the write throw `DayPlanChangedError` and leaves nothing written. Use the `dayPlanChangePushConflict.test.ts` pattern.
- [x] **Task 3: Undo** (AC 4, 5; point 6)
  - [x] `DCR`: `findInvalidity`, phase 1, phase 2, and the header docblock paragraph.
  - [x] `test/dayPlanChangeUndo.test.ts`, a new `describe("undo of a parked activity (Story 14.2 AC4)")` next to 14.1's `scheduled` block, reusing `databaseState`, `seedDay` and `PAST`. It covers:
    - exact restore of the whole DB with `toEqual`, on a day where the park moved two rows and removed a referencing leg and a swept stay leg;
    - exact restore of a FIXED activity (mode, times, duration);
    - stale after a bucket edit (bump `updatedAt`);
    - stale after it was scheduled onto another day;
    - stale when a leg was drawn across its gap;
    - **not** stale after an image upload while parked (seed a `parked/` image row); after undo the image row is still attached;
    - invalid (400 through the route) for a `previous.tripDayId` of another day and for the item listed as moved.
- [x] **Task 4: Route** (AC 7, 8; point 5)
  - [x] `src/lib/validation/dayPlanItemSchemas.ts`: `dayPlanItemParkSchema`.
  - [x] `src/app/api/trips/[id]/day-plan-items/park/route.ts`.
  - [x] Route tests, in `test/tripDayPlanItemsRoute.test.ts` beside 14.1's schedule-route cases, or a new `test/dayPlanItemParkRoute.test.ts`:
    - owner 200 with a signed receipt that the undo route accepts;
    - contributor 200;
    - viewer 403;
    - outsider 404;
    - no CSRF 403;
    - invalid JSON 400;
    - extra field 400 (`.strict()`);
    - wrong day 404;
    - `day_plan_changed` 409.
- [x] **Task 5: Round trip with scheduling** (AC 6)
  - [x] One test: an activity with two images, a document, a split payment, a link and a rich description is parked from day 1 and then scheduled with `scheduleParkedDayPlanItemForTripDay` onto day 2. Assert:
    - every child row has the same id and columns;
    - `contentJson`, `linkUrl`, cost fields and location are equal;
    - `durationMinutes` is kept, and a FIXED source arrives FLEXIBLE.
- [x] **Task 6: Day view** (AC 1, 2, 3, 4, 7, 8; points 7, 8, 9, 10)
  - [x] `TV`:
    - the `showItemMenu` gate;
    - the *Parken* `MenuItem`;
    - `handleParkPlanItem`;
    - the rename `scheduledIdea` → `noticeItem`;
    - the notice's `itemTitle` for both kinds;
    - the bucket reload after undo of `parked`.
    - Update the 11.3 comment at `TV:4345-4347`, which says the menu is only for moving.
  - [x] `DCRc`: `summarizeDayChangeReceipt`'s `itemTitle` option and the `parked` part. Update 14.1's callers and tests of `scheduledTitle`.
  - [x] `test/tripDayViewReorder.test.tsx`: rewrite `:216` and `:228` (point 8). Add new cases:
    - *Parken* is the last item on every card;
    - it is named exactly *Parken* in German;
    - choosing it closes the menu before the request;
    - it posts `{ itemId, tripDayId }` with the CSRF header;
    - there is no `window.confirm`;
    - one request on a double click.
  - [x] `test/tripDayViewLayout.test.tsx`, or the `tripDayViewDayChange` harness:
    - the notice text with the title of an activity no longer on the reloaded day;
    - the moved count appended;
    - *Rückgängig* posts the receipt and reloads the bucket list;
    - the `day_plan_changed`, 404 and network messages;
    - the bucket list reloaded after a refusal;
    - a viewer sees no trigger.
  - [x] `test/dayChangeReceipt.test.ts`: the summary for `parked`, with and without moved rows and legs, in de and en.
- [x] **Task 7: Dictionaries** (AC 9)
  - [x] Add the keys under *Copy*. `i18nDictionaries.test.ts` stays green.
- [x] **Task 8: Gates and real run** (AC 10)
  - [x] Full suite, `tsc`, lint, `next build`. No migration, so `check:migrations` is unchanged; run it anyway.
  - [x] Mutation checks, each applied, run, then reverted. Each must turn the suite red:
    1. the park writes the stored `durationMinutes` for a FIXED row instead of `toTime − fromTime` (seed a drifted row);
    2. the park skips `removeTravelSegmentsReferencingItemInTransaction`;
    3. undo of `parked` does not restore `previous.sortOrder`;
    4. phase 1 of `parked` does not check `updatedAt`;
    5. `receiptHasSideEffects` is false for `parked`.
  - [x] Real run with Tommy (`dev.db` needs no migration) (2026-10-18, passed):
    - on an overloaded day, park a 2-hour activity with pictures, a PDF and €25 as a **contributor**. Check that the later flexible activities move earlier, €25 leaves the day's cost, and the activity is in the bucket list with its thumbnail and "2 Std";
    - *Rückgängig* restores the day;
    - park again, then "+" it onto another day: the pictures, ticket and €25 are back;
    - park a FIXED activity;
    - a viewer sees no trigger;
    - 390 px check of the menu.

### Review Findings

Code review 2026-10-18 (Blind Hunter, Edge Case Hunter, Acceptance Auditor): 0 decision-needed, 4 patch (all applied), 3 defer (DW-396 to DW-398), 16 dismissed.

- [x] [Review][Patch] Editing the just-parked idea from its Day Detail pencil leaves a *Rückgängig* that can only answer `undo_stale` (the save changes the row's `updatedAt`); end the undo window when the saved idea is the one the live receipt parked [travelplan/src/components/features/trips/TripDayView.tsx:4970]
- [x] [Review][Patch] A lost park response (network drop or an HTML 502 after the server committed) leaves the card on the day while the `finally` shows the same idea in the bucket list; reload the day before setting the network message, only when an answer arrived but could not be read (with no answer a reload would replace the day with its load error) [travelplan/src/components/features/trips/TripDayView.tsx:1657]
- [x] [Review][Patch] The 404 and network day-view tests assert only that an alert exists, not its text (Task 6, AC8) [travelplan/test/tripDayViewReorder.test.tsx:590]
- [x] [Review][Patch] No undo-route test for a `parked` receipt with an unknown field (AC5 "refused with 400 and writes nothing"; only the schema test covers it) [travelplan/test/dayPlanChangeUndo.test.ts]
- [x] [Review][Defer] Undo of a park after a later create duplicates `sortOrder` (DW-396, same shape as DW-392) [travelplan/src/lib/repositories/dayPlanChangeRepo.ts:491] — deferred, pre-existing
- [x] [Review][Defer] A park that removed a never-drawn referencing leg can never be undone (DW-397, as delete) [travelplan/src/lib/repositories/dayPlanChangeRepo.ts:553] — deferred, pre-existing
- [x] [Review][Defer] Bucket-list reloads have no sequencing guard (DW-398) [travelplan/src/components/features/trips/TripDayView.tsx] — deferred, pre-existing

## Dev Notes

### Copy (de / en)

| Key | de | en |
|---|---|---|
| `trips.plan.parkAction` (new) | Parken | Park |
| `trips.dayChange.parked` (new) | „{title}" geparkt | "{title}" parked |
| `trips.plan.parkStale` (new) | Der Tag wurde gerade geändert – die Aktivität wurde nicht geparkt. | The day was just changed – the activity was not parked. |
| `trips.plan.parkError` (new) | Konnte nicht geparkt werden – bitte erneut versuchen. | Could not be parked – please try again. |

`de.ts` uses „…" (U+201E / U+201C) in `trips.dayChange.scheduled` (`de.ts:659`); match it exactly. The en string escapes `"` as `scheduled` does (`en.ts:724`). The moved and leg parts reuse `trips.dayChange.itemsMoved*` and `legsRemoved*` unchanged.

### Current state of what this story changes

| Area | Today (after 14.1) | After |
|---|---|---|
| Overflow trigger | only on FLEXIBLE cards with a neighbour | on every card, for writers |
| Overflow menu | *Nach oben*, *Nach unten* | plus *Parken* (last) |
| Day → bucket list | not possible | `POST day-plan-items/park`, receipt `parked` |
| Receipt kinds | … `scheduled`, `suggestionsApplied` | plus `parked` |
| Notice title option | `scheduledTitle` | `itemTitle` (scheduled and parked) |

### Architecture compliance

- **No copy between tables:** the park is one `updateMany` of the same row (code-review check from the proposal).
- **One transaction:** the park, the leg removal, the sweep and the recompute all happen in one transaction, conditional on `updatedAt` (`DayPlanChangedError` → 409 `day_plan_changed`). Refusals are decided before the first write (11.2 §7).
- **Parked invariant:** a parked row is FLEXIBLE, has null times, `sortOrder` 0 and no legs. The DB CHECK enforces the first three; the leg removal in step 7 enforces the last.
- **Readers:** reached through the day, so they need no change (14.1 AC3).
- **Validation and errors:** zod at the API layer, `.strict()`. The error envelope is `{ error: { code, message, details } }`.
- **Pure modules:** `DCRc` stays free of Prisma and `server-only` (the client imports it).
- **Stack:** SQLite with Prisma 7.3 and `@prisma/adapter-better-sqlite3`; interactive transactions (5 s default). `@updatedAt` is overwritten automatically on `update`, so set `updatedAt: now` explicitly on the park and `previous.updatedAt` on the undo, as schedule and its undo do.

### Testing standards

- **Runner and layout:** Vitest 3, `globals`, single fork, real SQLite per worker (`test/setup.ts` runs `prisma migrate deploy`). Tests sit flat in `test/`. `describe` names carry "(Story 14.2 ACn)".
- **Component tests:** `// @vitest-environment jsdom`, `@testing-library/react` 16, `test/helpers/renderWithProviders.tsx`, `test/helpers/mockFetch.ts`. `tripDayViewReorder.test.tsx` already stubs `TripDayPlanDialog` and has the menu harness; extend it.
- **Route tests:** real requests (`test/helpers/routeContext.ts`), as in `dayPlanChangeUndo.test.ts:768-800`.
- **Seeds:** every direct `prisma.dayPlanItem.create` carries `tripId` (14.1). `test/helpers/tripIdOfDay.ts` exists for helpers that only have a day id.
- **Red first:** the receipt schema, the park write and the `parked` undo.

### Previous story intelligence (14.1, 13.1, 11.x)

- **14.1 review patch 2:** an append can un-draw the last-activity→stay leg, and that leg lands in `removedTravelSegments`. Parking the first activity removes the leg from last night's stay to it, and parking the last one removes its leg to tonight's stay. Both are referencing legs (step 7), so both land in `removedTravelSegments`, and the undo recreates them. Do **not** add a `findInvalidity` rule against removed legs for `parked`.
- **14.1 review patch 10:** the notice title must not depend on the reloaded day. That is why point 7 captures the title before the request.
- **14.1 review patch 11:** reload the bucket list in `finally`, and handle `day_plan_changed` like other day writes.
- **14.1 review patch 12:** log in the route's `catch`.
- **13.1:** add receipt fields as optional and absent when empty, or existing `toEqual` pins break. `parked` is a new kind, so no existing pin changes, except the `scheduledTitle` rename in summary tests.
- **13.1:** `scheduleFieldsOf` is the rule for a FIXED row's duration (point 3).
- **11.3:** close the menu before acting; one in-flight ref; reload, then set the error.
- **11.1 AC7:** every write on the day ends the earlier undo window (`setDayChange(null)` before the request).
- **Open ledger entries:** DW-370, DW-372, DW-374 and DW-375 (undo and receipt races) stay open. Do not widen them.
- **Tommy's checks:** he checks in Safari and wants a 390 px check of new UI.

### Git intelligence

Recent commits:
- `f4957e3` 14-1: implementation, review patches, done
- `aacfd32` 13-1: real run
- `ed2da94` 13-1: implementation

Commit style is `14-2: …`. No dependency changes are needed. The working tree has unrelated changes to `.env` and two deleted `dev.db` backups; leave them alone.

### Latest technical information (2026-10-18)

No new library and no web research needed. Prisma 7.3: `updateMany` with `updatedAt` in `where` is the house pattern for conditional writes. It returns `{ count }` and never throws on a miss.

### Project Structure Notes

New files:
- `src/app/api/trips/[id]/day-plan-items/park/route.ts`
- `test/dayPlanItemPark.test.ts` (and the route test file, if separate)

Modified:
- `DPIR`, `DCR`, `DCRc`, `DCRS`
- `src/lib/validation/dayPlanItemSchemas.ts`
- `TV`
- `src/i18n/de.ts`, `src/i18n/en.ts`
- the tests named in the tasks

No schema, migration or `TripDayPlanDialog` change.

### Questions for Tommy (not blocking; the defaults apply)

1. **Where *Parken* lives (point 8).** Only in the card's overflow menu (⋮), which now shows on every card, including fixed ones. It is not added to the dialog footer next to "anderer Tag", because space at 390 px is tight. OK?
2. **Removed legs in the notice (point 7).** The notice reads „Wasserfall" geparkt · 2 Aktivitäten verschoben · 1 Fahrt entfernt. The epic names only the moved count, but deleting legs silently would break 6.23's rule. OK?
3. **A very short fixed activity (point 3).** A fixed activity shorter than 5 minutes (only possible from 13.1's migration) parks with its real length. The bucket dialog then asks for at least 5 minutes on its next save. OK?

### References

- [epics.md: Story 14.2](../planning-artifacts/epics.md), Epic 14 section
- [sprint-change-proposal-2026-10-17-bucket-parking.md](../planning-artifacts/sprint-change-proposal-2026-10-17-bucket-parking.md): §2 *Receipts and undo* and *UX impact*, §5 success criteria 1–3, §6
- [architecture.md](../planning-artifacts/architecture.md): "Parking and scheduling" (the `parked` kind and route), "Activities without a day", "Day recalculation receipts"
- `EXPERIENCE.md:91` *Parking an activity*
- [14-1-one-kind-of-entry.md](14-1-one-kind-of-entry.md): points 5, 6 and 14, review patches 2 and 10–12, deviation 1
- [deferred-work.md](deferred-work.md): DW-370, DW-372, DW-374, DW-375

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (`claude-opus-5-5`), bmad-dev-story, 2026-10-18.

### Debug Log References

- **Baseline (Task 0).** The baseline run started at `f4957e3` but overlapped the first edits (it already counted the new receipt tests: 200 files / 3289 tests, 1 failure from the in-flight `scheduledTitle` rename). So it is not a clean baseline. 14.1's recorded end state stands as the reference: 200 files / 3278 tests, `tsc` 0, lint 0 errors / 79 warnings.
- **Final gates (Task 8).** 203 files / 3315 tests all green, `tsc --noEmit` 0, lint 0 errors / 79 warnings (unchanged), `next build` compiles and lists `ƒ /api/trips/[id]/day-plan-items/park`, `check:migrations` passed (no migration changes).
- **Mutation checks (Task 8), each applied, run, reverted:**
  1. FIXED park writes the stored `durationMinutes`: **red** (drifted-row test).
  2. Park skips `removeTravelSegmentsReferencingItemInTransaction`: **survived at first.** The sweep already removes every *drawn* leg naming the activity. The explicit removal matters only for a referencing leg that was never drawn (e.g. C→B against the order). Added "removes a leg naming it that was never drawn": now **red**.
  3. Undo of `parked` skips `previous.sortOrder`: **red** (whole-DB `toEqual`).
  4. Phase 1 of `parked` skips the `updatedAt` check: **survives, equivalent mutation.** Phase 2's restore is itself `updateMany` conditional on `updatedAt` and throws `UndoStaleError` on a miss, so the outcome (`stale`, nothing written) is identical. Not observable from outside, as for `scheduled`.
  5. `receiptHasSideEffects` false for `parked`: **red** (receipt and day-view suites).

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created (bmad-create-story, 2026-10-18).
- **Receipt kind `parked`** (`DCRc`, `DCRS`): the architecture's shape verbatim, `version` stays 3, strict on the wire (`previous` strict too), `receiptHasSideEffects` always true. `mapReceipt` converts both stamps.
- **`parkDayPlanItemForTripDay`** (`DPIR`): `findTripDayForTripWriter` → read state → row must be on the day → plan `remove` → `drawnBefore` → conditional `updateMany` (count 0 → `DayPlanChangedError`) → remove referencing legs → `finishActivityWriteInTransaction` (recompute, sweep, receipt). One row update, no copy, no `deleteDayPlanItemInTransaction`. FIXED duration is `toTime − fromTime` (no clamp); the receipt's `previous` keeps the stored values so undo restores them byte for byte.
- **Undo** (`DCR`): `findInvalidity` checks `previous.tripDayId` and treats `parked`'s `itemId` as the edited id; phase 1 requires the row parked on this trip with the park's stamp (media added while parked do not refuse); phase 2 restores day, mode, duration, order, times and stamp conditionally, then the generic moved-row and leg restore. No renumber.
- **Route** `POST /api/trips/[id]/day-plan-items/park` with `dayPlanItemParkSchema` (`{ itemId, tripDayId }`, strict): CSRF, session, `refuseUnlessTripWriter`, `withPushConflict`, `past_midnight`, 404 for `not_found`/`missing`, logged 500.
- **Day view** (`TV`): `showItemMenu = canEditPlanning`; *Parken* is the menu's last item (`DAY_MENU_ITEM_SX`, no `aria-label`, no divider, no confirm); `handleParkPlanItem` closes the menu, claims `parkInFlightRef`, ends the undo window, captures the title with the card's rule, posts, drops a late answer, reloads the day, then sets the refusal message, and reloads the bucket list in `finally`. `scheduledIdea` → `noticeItem`; the summary option is now `itemTitle` (scheduled and parked). A parked title comes only from the captured value. The bucket list reloads after undo of `parked` too.
- **Copy:** `trips.plan.parkAction`, `trips.plan.parkStale`, `trips.plan.parkError`, `trips.dayChange.parked` in de and en, as in the table (de quotes „…“).
- **Tests changed for the new gate:** `tripDayViewReorder.test.tsx` "never on a fixed one" and "no trigger on a lone activity" rewritten (every card has a trigger; fixed and lone menus hold only *Parken*), plus the menu-item lists and the German names. `tripDayViewLayout.test.tsx` "decorative, non-focusable edit glyph" counted the card's buttons as 1; a lone card now also has the overflow trigger, so it asserts the overlay plus that trigger and nothing else.
- **For review:**
  - Undoing a park that removed a referencing leg that was never drawn (mutation 2's case) is refused as `undo_stale`, because phase 3 will not recreate a leg the timeline does not draw. Delete and its undo already behave this way, so this is consistent and not changed here.
  - Q3 holds as specified: a FIXED row under 5 minutes (13.1 migration) parks with its real length.
- **Extension on Tommy's request (2026-10-18): edit ideas on Day Detail.** Before, editing an idea worked only on the overview (14.1's Q3 ruling kept it there). With *Parken*, ideas now arrive from the day itself, so Tommy asked for editing there too. Each Day Detail bucket row has a pencil that opens the same parked `TripDayPlanDialog` in edit mode (no `onDelete`, so deleting stays on the overview with its confirmation). A save, or a picture change in the dialog, reloads the bucket list. The overview's `BucketListItem` type and `toDialogItem` moved to `src/lib/trips/bucketListItem.ts` so both panels share them.
- **Extension on Tommy's request (2026-10-18): row actions reveal like the activity card's edit glyph.** On the overview (edit, delete) and on Day Detail (edit, the row's "+" to schedule), the buttons are hidden on a pointer device until the row is hovered, always visible under `hover: none` and `any-pointer: coarse`, and visible while focused. They keep their space (`opacity`), so nothing shifts. The header "+" (*Idee hinzufügen*) stays visible: it belongs to no row, and the empty list's message points to it. The rule lives in one place, `bucketRowActionReveal.ts`, and a shared test helper checks the authored rules in both suites (jsdom matches no media queries). Removing the styles turns both suites red (checked by mutation).
- **Answered for Tommy:** after park and "+", the legs are gone and must be drawn again. That is intended: legs belong to neighbour pairs, are never re-created by the app (6.23), and "+" appends at the end. *Rückgängig* right after the park is the way to restore them. Remembering legs across a park would be a separate story.
- **Questions Q1–Q3:** implemented with the defaults (Parken only in the card menu; removed legs in the notice; no clamp). Awaiting Tommy's confirmation.
- **Real run (Task 8), 2026-10-18.** Tommy reported the checks as passed ("Die Tests waren in Ordnung"). He named in particular: the activity parked, the later activities moved earlier, the day's total no longer held its price, and after "+" it was back as before. No problems reported.
- **Still open, not blocking:** Tommy has not yet explicitly confirmed Q1–Q3 (the defaults stand as implemented), and whether the bucket card's header "+" (*Idee hinzufügen*) should also reveal on hover (it stays visible for now).

### File List

- `travelplan/src/app/api/trips/[id]/day-plan-items/park/route.ts` (new)
- `travelplan/src/components/features/trips/TripBucketListPanel.tsx`
- `travelplan/src/components/features/trips/TripDayBucketListPanel.tsx`
- `travelplan/src/components/features/trips/TripDayView.tsx`
- `travelplan/src/components/features/trips/bucketRowActionReveal.ts` (new)
- `travelplan/src/i18n/de.ts`
- `travelplan/src/i18n/en.ts`
- `travelplan/src/lib/repositories/dayPlanChangeRepo.ts`
- `travelplan/src/lib/repositories/dayPlanItemRepo.ts`
- `travelplan/src/lib/trips/bucketListItem.ts` (new)
- `travelplan/src/lib/trips/dayChangeReceipt.ts`
- `travelplan/src/lib/validation/dayChangeReceiptSchemas.ts`
- `travelplan/src/lib/validation/dayPlanItemSchemas.ts`
- `travelplan/test/dayChangeReceipt.test.ts`
- `travelplan/test/dayPlanChangeUndo.test.ts`
- `travelplan/test/dayPlanItemPark.test.ts` (new)
- `travelplan/test/dayPlanItemParkConflict.test.ts` (new)
- `travelplan/test/dayPlanItemParkRoute.test.ts` (new)
- `travelplan/test/helpers/bucketRowActionReveal.ts` (new)
- `travelplan/test/tripBucketListPanel.test.tsx`
- `travelplan/test/tripDayViewLayout.test.tsx`
- `travelplan/test/tripDayViewReorder.test.tsx`
- `_bmad-output/implementation-artifacts/14-2-park-it-for-another-day.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`

### Change Log

- 2026-10-18: Tasks 0–7 and the Task 8 gates and mutation checks done: `parked` receipt kind, park write, undo, route, day-view menu and handler, dictionaries, tests. 203 files / 3315 tests, tsc 0, lint 0/79, build OK. Real run with Tommy outstanding; status stays in-progress.
- 2026-10-18: Real run passed (Tommy). Status review.
- 2026-10-18: On Tommy's request: edit ideas from Day Detail's bucket list, and bucket row actions (overview and Day Detail) reveal on hover like the activity glyph. 203 files / 3317 tests, tsc 0, lint 0/79, build OK.
- 2026-10-18: Code review: 4 patches applied (idea edit ends a park undo it made stale, reload after an unreadable park answer, refusal tests assert their text, unknown-field receipts refused through the undo route), 3 deferred (DW-396 to DW-398), 16 dismissed. 203 files / 3320 tests, tsc 0, lint 0/79. Status done.
