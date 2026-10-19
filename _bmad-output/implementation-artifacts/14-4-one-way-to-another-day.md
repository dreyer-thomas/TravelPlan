---
baseline_commit: dd33e5092a7ddc9e84026eaf03f2eb2c9cab6eb5
---
# Story 14.4: One Way to Another Day

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As someone rearranging a trip,
I want one way to take an activity to another day,
so that the day's controls say one thing each and the way I use can always be undone.

**Origin:** Tommy, 2026-10-18, during the real run of 14.2. The activity dialog's "anderer Tag" (Story 6.23) does what *Parken* (14.2) followed by the bucket row's "+" (14.1) now does, but without undo. Tommy chose to **remove** it rather than move it into the ⋮ menu beside *Parken*.

**FRs covered:** none new. FR21/FR23 (activity management) stay covered: an activity still reaches another day, through FR48 (park) and FR35/FR36 (schedule from the bucket list). **Depends on:** 14.2 (in review at the time of writing; do not start before its code review is through).

Sources:
- [epics.md#Story 14.4](../planning-artifacts/epics.md) (added with this story)
- [epics.md#Story 6.23](../planning-artifacts/epics.md) (the feature being removed), [6-23-move-a-single-activity-to-another-day.md](6-23-move-a-single-activity-to-another-day.md)
- [14-2-park-it-for-another-day.md](14-2-park-it-for-another-day.md), [14-1-one-kind-of-entry.md](14-1-one-kind-of-entry.md)

All code paths below are relative to `travelplan/`. Line numbers were read on 2026-10-18 on the uncommitted 14.2 working tree; re-read them, they will drift once 14.2 is committed and reviewed.

| Short | Path |
|---|---|
| `TV` | `src/components/features/trips/TripDayView.tsx` |
| `PD` | `src/components/features/trips/TripDayPlanDialog.tsx` |
| `DPIR` | `src/lib/repositories/dayPlanItemRepo.ts` |
| `DPIS` | `src/lib/validation/dayPlanItemSchemas.ts` |

**Search caveat (from 14.1):** plain `grep` treats some repos as binary and prints nothing. Use `grep -a`.

## Read this first: what goes and what stays

1. **Two features share the word "move". Only one goes.**
   - **Goes:** moving **one** activity to another day. Story 6.23: the dialog footer's "anderer Tag", its picker dialog, `POST /api/trips/[id]/day-plan-items/move`, `moveDayPlanItemToTripDay`.
   - **Stays, untouched:** the **whole-day** transfer (Story 6.7). That is `POST …/day-activity-transfer`, `moveDayPlanItemsBetweenTripDays`, `swapDayPlanItemsBetweenTripDays`, the day menu's transfer dialog and `transferTargetOptions` / `buildDayLabel` in `TV`. Do not touch it. Its "move" *replaces* the target day, which is exactly why 6.23 got its own route; the two must never be confused (6.23's Trap 1).
   - **Stays:** *Nach oben* / *Nach unten* (`trips.plan.moveUp` / `moveDown`, `reorder/`). They share the `trips.plan.move` key prefix and nothing else.

2. **Why removal is safe.** *Parken* + "+" covers 6.23's acceptance criteria, and adds undo:

   | 6.23 AC | After this story |
   |---|---|
   | AC1: offered on an existing activity, not while creating, not for a viewer | *Parken* in the card's ⋮ menu (14.2 AC2), writers only |
   | AC2: appends, never replaces the target day | "+" appends (14.1 point 8) |
   | AC3: images, payments, link, location arrive unchanged | same row, same id (14.1 AC8, 14.2 AC6) |
   | AC4: referencing legs removed and the user told | park removes them; the notice says „· 1 Fahrt entfernt" (14.2 AC3) |
   | AC5: no leg invented on arrival | "+" invents none |
   | AC6: delete cleans legs too | delete is unchanged |

   The one thing lost is the single step when the target day is known. Tommy accepted that.
   A FIXED activity now arrives FLEXIBLE with its duration (14.2 point 3), where 6.23 placed it by its time. Tommy saw this in the 14.2 run; it is intended.

3. **Delete the route and the repository function, do not just hide the button.** Leaving `day-plan-items/move` in place keeps a write path with no UI, no undo and its own leg rules, which every later story would have to keep in step (Epic 11 already had to exempt it). **(Q1)**

4. **The media-path tests must survive, re-pointed at park + schedule.** Two route tests exist because an activity's files do **not** follow it between days: the stored URL keeps naming the upload day while the row names the new day (Story 8.4 AC9). They currently create that state with `moveDayPlanItemToTripDay`:
   - `test/tripDayPlanItemImagesRoute.test.ts` (~`:549-640`, "removes the file of a photo uploaded before the activity was moved to another day");
   - `test/tripDayPlanItemDocumentsRoute.test.ts` (~`:655-700`, the document twin).

   The state still arises after this story: park on day 1, then "+" onto day 2 leaves exactly the same row/URL mismatch (and the whole-day transfer does too). Rewrite both to reach it with `parkDayPlanItemForTripDay` then `scheduleParkedDayPlanItemForTripDay`, keep every assertion, and update their docblocks. **Do not delete them.** The same applies to `test/dayPlanItemTripIdConsistency.test.ts:95`: replace the single move with park + schedule onto `days[2]`, keep `expectConsistent`.

5. **Comments that cite `moveDayPlanItemToTripDay` as the reason for a rule.** The rule stays; its example changes to park + schedule (and the whole-day transfer). Update, don't delete, the reasoning:
   - `src/app/api/trips/[id]/day-plan-items/images/route.ts` (~`:261`);
   - `src/app/api/trips/[id]/day-plan-items/documents/route.ts` (~`:322`);
   - `src/lib/trips/uploadPaths.ts` (~`:257`, also carries a stale line reference `dayPlanItemRepo.ts:660-698`);
   - `src/lib/repositories/travelSegmentRepo.ts` (~`:423`, the list of callers of `removeTravelSegmentsReferencingItemInTransaction`: activities now come from delete and park).

## Acceptance Criteria

1. **No single-activity move in the UI.** The activity dialog no longer offers "anderer Tag" (footer) or the *Auf anderen Tag verschieben* picker, for any role or placement. The footer holds the trash glyph and OK as before, at 390 px too.
2. **No single-activity move on the server.** `POST /api/trips/[id]/day-plan-items/move` no longer exists (the folder is deleted; Next answers 404/405 as for any missing route). `moveDayPlanItemToTripDay`, `SingleDayPlanItemMoveParams`, `SingleDayPlanItemMoveResult`, `dayPlanItemMoveSchema` and `DayPlanItemMoveInput` are deleted. **(Q1)**
3. **The day view loses only the move's plumbing.** `handleMovePlanItem`, `planMoveTargetDays`, `dayLabelById`, the `planMoveNotice` state with its success `Alert` and every `setPlanMoveNotice(null)`, and the `moveTargetDays` / `onMove` props on the plan dialog are gone. Every other write handler behaves exactly as before.
4. **The whole-day transfer is unchanged.** Moving or swapping all activities of a day works and its tests pass unmodified.
5. **Another day is still reachable.** An activity with pictures, a document, a split payment and a link can be parked on day 1 and scheduled onto day 2 with everything attached (already pinned by 14.2 AC6; it stays green).
6. **Media cleanup still finds files uploaded on an earlier day.** The two Story 8.4 AC9 route tests pass, now reaching the moved state through park + schedule (point 4).
7. **Dictionaries.** The keys used only by the removed feature are deleted from `en.ts` and `de.ts`: `trips.plan.moveAction`, `moveDialogTitle`, `moveDescription`, `moveWarning`, `moveConfirm`, `moveError`, `moveFallbackDay`, `moveSuccess`, `moveSuccessWithSegment`, `moveSuccessWithSegments`. `trips.plan.moveUp` / `moveDown` and every `trips.dayTransfer.*` key stay. `i18nDictionaries.test.ts` stays green (its 6.23 wording assertions go with the keys).
8. **Regression.** Full suite, `tsc --noEmit` 0, lint 0 errors (warnings not above the count before the story), `next build`, `check:migrations` (no migration). No schema change.

## Tasks / Subtasks

- [x] **Task 0: Baseline** (AC 8)
  - [x] Suite, `tsc`, lint, build on the commit you start from; record the counts. 14.2 ended at 203 files / 3317 tests, `tsc` 0, lint 0 errors / 79 warnings.
- [x] **Task 1: Re-point the tests that only used the move as a setup** (AC 5, 6; point 4). Do this **first**, while the move still exists, so each rewritten test is shown green before the function it used is deleted.
  - [x] `tripDayPlanItemImagesRoute.test.ts` and `tripDayPlanItemDocumentsRoute.test.ts`: park + schedule instead of `moveDayPlanItemToTripDay`; same assertions (`imageUrl`/`documentUrl` still names the upload day; the delete removes the file). The schedule needs the item parked first, and a two-day trip.
  - [x] `dayPlanItemTripIdConsistency.test.ts`: the "create, move to another day, whole-day move and swap" case parks and schedules instead; rename the case accordingly.
- [x] **Task 2: Dialog** (AC 1; `PD`)
  - [x] Remove `PlanMoveTargetDay`, `PlanItemMoveOutcome`, the `moveTargetDays` / `onMove` props and their docblocks (`:400-447`), the `moveOpen` / `moveTargetDayId` / `moving` / `movingRef` state (`:733-740`), `canMove` (`:1349-1356`), `closeMovePicker` / `moveGuard` / `handleMoveConfirm` (`:2024-2079`), the footer button (`:2474-2495`), the picker dialog and its `DiscardChangesDialog {...moveGuard.dialogProps}` (`:3240-3303`).
  - [x] `isBusy` (`:1347`) loses `moving`. The seed docblock (`:1068-1080`) lists `moveOpen`, `moveTargetDayId` among cleared states; drop them from the list. The placement docblock (`:426`, "moving to another day is not offered") loses that clause.
  - [x] Keep the footer's layout comment true (6.24 AC8 mentions "one text label and one 44px glyph": after this story it is the glyph and OK). Check the footer at 390 px.
- [x] **Task 3: Day view** (AC 3, 4; `TV`)
  - [x] Remove `handleMovePlanItem` (`:1910-1965`), `planMoveTargetDays` (`:1825`), `dayLabelById` (`:1840-1846`), the `PlanItemMoveOutcome` import (`:63`), the dialog props (`:4951-4952`), the `planMoveNotice` state (`:686-692`), its `Alert` (`:3590`) and every `setPlanMoveNotice(null)` (handlers for schedule, reorder, park, delete, transfer, suggestions apply, day change effect). `grep -an planMoveNotice` must return nothing.
  - [x] Leave `transferTargetOptions` and `buildDayLabel`: the whole-day transfer uses them.
- [x] **Task 4: Server** (AC 2)
  - [x] Delete `src/app/api/trips/[id]/day-plan-items/move/` (the folder).
  - [x] `DPIR`: delete `moveDayPlanItemToTripDay` (`:1147-1230`), `SingleDayPlanItemMoveParams` (`:167`), `SingleDayPlanItemMoveResult` (`:274`) and its docblock. Remove imports that become unused (`placeFixedItem`, `hasValidTimes`, `resolveDayStartMinute` only if nothing else uses them; check with `tsc` and lint).
  - [x] `DPIS`: delete `dayPlanItemMoveSchema` and `DayPlanItemMoveInput` (`:274-298`) with the 6.23 docblock.
  - [x] Update the four comments in point 5.
- [x] **Task 5: Tests of the removed feature** (AC 1, 2, 3)
  - [x] Delete: `tripDayPlanItemsRoute.test.ts` `describe("POST /day-plan-items/move")` (`:1324-1590`) and the `MOVE_POST` import; `dayPlanItemRepo.test.ts` single-move cases (`:840-1150`, the ones calling `moveDayPlanItemToTripDay`; keep "removes the travel segments referencing a deleted activity" at `:1152`, which is 6.23 AC6 and still true); `tripDayPlanDialog.test.tsx` `describe("moving the activity to another day")` (`:2056-2420`); `tripDayViewLayout.test.tsx` move cases (`:3333-3734`, "moves one activity…", "reports a move…", "names a single removed…", "hands a failed move's reason…") and "withholds the move handler from a viewer" (`:3935`).
  - [x] Adjust: the `TripDayPlanDialog` stubs in `tripDayViewLayout.test.tsx` (`:23-41`, `:119`, `:149-160`) and `tripBucketListPanel.test.tsx` (`:31`, `:212`) drop `onMove` / `moveTargetDays`; the parked-dialog render in `tripDayPlanDialog.test.tsx` (~`:4368`) drops the two props.
  - [x] Add one test each: the activity dialog in edit mode renders no "Another day" / "anderer Tag" button for an owner (`tripDayPlanDialog.test.tsx`), and `TV` passes no `onMove` to the plan dialog (`tripDayViewLayout.test.tsx`, the stub's `lastProps`).
- [x] **Task 6: Dictionaries** (AC 7)
  - [x] Delete the ten keys from `en.ts` and `de.ts`, with their 6.23/6.24 comments; delete the `moveAction` / `moveDialogTitle` assertions in `i18nDictionaries.test.ts` (`:426-429`).
  - [x] `grep -an "trips.plan.move" src test` afterwards shows only `moveUp` / `moveDown`.
- [x] **Task 7: Planning artifacts** (done with this story file, 2026-10-18)
  - [x] `epics.md`: Story 14.4 added after 14.3; Story 6.23's section carries "Removed by Story 14.4 (2026-10-18)". 6.23's ACs are left as history.
- [x] **Task 8: Gates and real run** (AC 8)
  - [x] Full suite, `tsc`, lint, `next build`, `check:migrations`.
  - [x] `grep -an "day-plan-items/move\|moveDayPlanItemToTripDay\|onMove\|moveTargetDays\|planMoveNotice" src test` returns nothing.
  - [x] Real run with Tommy: the activity dialog shows no "anderer Tag" (owner and contributor, 390 px in Safari); the day menu's whole-day move and swap still work; park on one day, "+" on another, pictures and PDF still open, and deleting a picture there removes it.


### Review Findings

Code review 2026-10-19 (Blind Hunter, Edge Case Hunter, Acceptance Auditor): 0 decision-needed, 4 patch, 0 defer, 17 dismissed. All 4 patches applied 2026-10-19 (German dialog now rendered in the absence test); 213 files / 3432 tests, lint 0 errors / 79 warnings.

- [x] [Review][Patch] `PLAN_FOOTER_SX` docblock still describes the removed button: "the row is `anderer Tag` + a 44px trash glyph + `OK`" and the 174px + 64px / "longer than 'anderer Tag'" overflow reasoning (Task 2: keep the footer's layout comment true) [travelplan/src/components/features/trips/TripDayPlanDialog.tsx:290]
- [x] [Review][Patch] `deleteDayPlanItemInTransaction` docblock says "Like the move below, the existence check *is* the write"; the move it points at was deleted (point 5) [travelplan/src/lib/repositories/dayPlanItemRepo.ts:554]
- [x] [Review][Patch] The new "no 'Another day' action" dialog test renders `language="en"` only, so its `anderer Tag` assertion passes whether or not the button exists; render the German dialog too (Task 5) [travelplan/test/tripDayPlanDialog.test.tsx:2072]
- [x] [Review][Patch] Rewritten comment lines were not rewrapped (146-197 chars against the ~110 of their blocks) [travelplan/src/app/api/trips/[id]/day-plan-items/images/route.ts:263, documents/route.ts:324, travelplan/src/lib/trips/uploadPaths.ts:261, TripDayPlanDialog.tsx:1052]

## Dev Notes

### Copy

No new strings. Ten keys are removed (AC 7).

### What must not change

- the whole-day transfer (6.7) and its dialog, route, repo functions and tests;
- *Nach oben* / *Nach unten*;
- delete, its confirmation and its leg cleanup (6.23 AC6 lives on in delete);
- *Parken*, "+", their receipts and undo;
- media cleanup's rule that the folder comes from the stored URL, not the request's day (8.4 AC9);
- the dialog's other footer controls (trash glyph, OK) and its discard guard.

### Architecture compliance

- One way per job: after this story the only single-activity day change is park + schedule, both with receipts and undo (Epic 11's rule that a write which removes legs must say so and be undoable now holds for every path that moves one activity).
- No schema or migration change. `TravelSegment` still has no FK to its endpoints; `removeTravelSegmentsReferencingItemInTransaction` keeps its callers delete and park.
- Validation, error envelope, CSRF and access gates are unchanged on every remaining route.

### Testing standards

Vitest 3, real SQLite per worker, tests flat in `test/`, `describe` names carry "(Story 14.4 ACn)" for new cases. Component tests use the existing stubs. Re-point before delete (Task 1 before Task 4), so the media tests are never red for a reason other than the code under test.

### Previous story intelligence

- **14.2:** park and schedule are the replacement; their repo functions are `parkDayPlanItemForTripDay` and `scheduleParkedDayPlanItemForTripDay`. `test/dayPlanItemPark.test.ts` already holds the round-trip test (AC 5).
- **14.1:** media of a parked activity may live under `days/<id>/…` or `parked/…`; `resolveManagedItemMediaDir` accepts both. The re-pointed tests exercise the `days/<upload day>/` case.
- **13.1 (Epic 13 AC "moved to another day"):** after this story only the whole-day transfer is left under that AC.
- **11.1:** 6.23 was explicitly "not routed through the receipt"; that exemption disappears with the route.
- **Big-file edits:** `TV` is over 5000 lines. Use exact-match edits; never a `sed` with a computed line address (an empty address applies to every line; this happened in 14.2 and had to be repaired).

### Git intelligence

Commit style `14-4: …`. Start from the commit that carries 14.2's code review. The working tree may hold unrelated changes to `.env` and deleted `dev.db` backups; leave them alone.

### Latest technical information

No library change, no research needed. Deleting a route folder in the Next.js App Router is enough to remove the endpoint; `next build` lists the routes and must no longer show `/api/trips/[id]/day-plan-items/move`.

### Project Structure Notes

Deleted: `src/app/api/trips/[id]/day-plan-items/move/route.ts`.
Modified: `PD`, `TV`, `DPIR`, `DPIS`, the images and documents routes (comments), `uploadPaths.ts`, `travelSegmentRepo.ts` (comments), `en.ts`, `de.ts`, the tests named in Tasks 1 and 5, `epics.md`.

### Questions for Tommy (not blocking; the defaults apply)

1. **Route and repository function.** Removed completely (default), not only the button. A kept route would be a write without UI and without undo. OK?
2. **A fixed activity on its way to another day** now arrives flexible with its duration (14.2 point 3) instead of keeping its time, and has to be set to fixed again on the new day if needed. You saw this in the 14.2 run. OK as is?

### References

- [epics.md: Story 14.4, Story 6.23, Story 14.2](../planning-artifacts/epics.md)
- [6-23-move-a-single-activity-to-another-day.md](6-23-move-a-single-activity-to-another-day.md)
- [14-2-park-it-for-another-day.md](14-2-park-it-for-another-day.md): AC1–AC6, Completion Notes (the edit-on-Day-Detail and reveal additions)
- [14-1-one-kind-of-entry.md](14-1-one-kind-of-entry.md): points 8 and 14

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (claude-opus-5-5), bmad-dev-story, 2026-10-19

### Debug Log References

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created (bmad-create-story, 2026-10-18).
- **Task 0 baseline (dd33e50):** 213 files / 3459 tests, `tsc` 0, lint 0 errors / 79 warnings.
- **Task 1 first:** the two Story 8.4 AC9 media tests and the tripId consistency case now reach the moved state through `parkDayPlanItemForTripDay` + `scheduleParkedDayPlanItemForTripDay`, every assertion kept, plus one that the row really is on the later day. Shown green (26/26) while `moveDayPlanItemToTripDay` still existed, then the function was deleted.
- **Tasks 2-4:** dialog footer button, picker dialog, its discard guard, the move state/handlers/props and types removed from `TripDayPlanDialog`; `handleMovePlanItem`, `planMoveTargetDays`, `dayLabelById`, `planMoveNotice` (state, Alert, 7 resets plus the day-change and save resets) removed from `TripDayView`; route folder `day-plan-items/move/`, `moveDayPlanItemToTripDay`, both its types, `dayPlanItemMoveSchema` / `DayPlanItemMoveInput` deleted. The four comments in point 5 now cite park + schedule and the whole-day transfer; also the reorder route's "beside `move/`" and the repo import comment.
- **Deviation from the story text:** `buildDayLabel` in `TV` was *not* used by the whole-day transfer (its picker formats labels inline); after the move left it was dead and lint flagged it, so it was removed. `transferTargetOptions` stays. Imports that became unused were removed: `Dialog`, `DialogActions`, `DialogContent`, `TextField`, `DialogTitleWithClose`, `useDiscardGuard` (dialog) and `hasValidTimes`, `placeFixedItem`, `resolveDayStartMinute` (repo).
- **Task 5:** the story's list missed one caller: `dayActivityTransferRoute.test.ts` had a case "the single-activity move (6.23) recomputes the source and the target"; it tested the removed function and was deleted with its import. The file's whole-day cases are otherwise unmodified (AC4). New tests: dialog in edit mode for an owner shows no "Another day" / "anderer Tag" (`tripDayPlanDialog.test.tsx`); `TV` hands the dialog no `onMove` / `moveTargetDays` for an owner (`tripDayViewLayout.test.tsx`, the former viewer case turned into an owner case since no role gets the props now). Mutation: passing an `onMove` from `TV` again turns the day-view test red.
- **Task 6:** ten keys removed from `en.ts` and `de.ts` with their 6.23/6.24 comments; the 6.23 wording test in `i18nDictionaries.test.ts` became a Story 14.4 AC7 test that the ten keys are absent and `moveUp`/`moveDown`/`dayTransfer.moveAction` remain.
- **Task 8 gates:** 213 files / 3432 tests green (27 tests of the removed feature deleted, 2 added); lint 0 errors / 79 warnings (same as baseline); `next build` OK, route list without `/day-plan-items/move`; `check:migrations` passed, no schema change. `tsc --noEmit`: 0 errors in `src` and `test`; the one remaining error is in the gitignored, `next dev`-generated `.next/dev/types/validator.ts`, which still names the deleted route and is rewritten the next time `next dev` starts (no dev server was running; the cache was left alone).
- **Grep gate:** `day-plan-items/move|moveDayPlanItemToTripDay|onMove|moveTargetDays|planMoveNotice` in `src` returns nothing; in `test` it returns only the two `not.toHaveProperty("onMove" / "moveTargetDays")` assertions of the new AC3 test. `trips.plan.move` outside `moveUp`/`moveDown` appears only in the AC7 absence list.
- **Real run (2026-10-19):** passed, confirmed by Tommy ("it was ok"): no "anderer Tag" in the dialog, whole-day move and swap, park + "+" with pictures and PDF. Q1/Q2: defaults applied (route removed completely; fixed activity arrives flexible), not explicitly answered.

### File List

- travelplan/src/app/api/trips/[id]/day-plan-items/move/route.ts (deleted)
- travelplan/src/app/api/trips/[id]/day-plan-items/images/route.ts (comment)
- travelplan/src/app/api/trips/[id]/day-plan-items/documents/route.ts (comment)
- travelplan/src/app/api/trips/[id]/day-plan-items/reorder/route.ts (comment)
- travelplan/src/components/features/trips/TripDayPlanDialog.tsx
- travelplan/src/components/features/trips/TripDayView.tsx
- travelplan/src/lib/repositories/dayPlanItemRepo.ts
- travelplan/src/lib/repositories/travelSegmentRepo.ts (comment)
- travelplan/src/lib/trips/uploadPaths.ts (comment)
- travelplan/src/lib/validation/dayPlanItemSchemas.ts
- travelplan/src/i18n/en.ts
- travelplan/src/i18n/de.ts
- travelplan/test/tripDayPlanItemImagesRoute.test.ts
- travelplan/test/tripDayPlanItemDocumentsRoute.test.ts
- travelplan/test/dayPlanItemTripIdConsistency.test.ts
- travelplan/test/tripDayPlanItemsRoute.test.ts
- travelplan/test/dayPlanItemRepo.test.ts
- travelplan/test/dayActivityTransferRoute.test.ts
- travelplan/test/tripDayPlanDialog.test.tsx
- travelplan/test/tripDayViewLayout.test.tsx
- travelplan/test/tripBucketListPanel.test.tsx
- travelplan/test/i18nDictionaries.test.ts
- _bmad-output/implementation-artifacts/14-4-one-way-to-another-day.md
- _bmad-output/implementation-artifacts/sprint-status.yaml

### Change Log

- 2026-10-19: Single-activity move (Story 6.23) removed: dialog action and picker, day-view plumbing, `POST day-plan-items/move`, repo function, schema, ten dictionary keys and their tests; media and tripId tests re-pointed at park + schedule. Gates green; real run passed (Tommy). Status review.
- 2026-10-19: Code review: 4 patches applied (footer docblock, dangling "move below" comment, German absence render, comment rewrap), 17 dismissed. Status done.
