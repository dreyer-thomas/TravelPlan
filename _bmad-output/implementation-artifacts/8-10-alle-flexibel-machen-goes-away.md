---
authored_against: aaf4c89
baseline_commit: aaf4c894f0760a055f570045d4e9ade87c7b0501
---

# Story 8.10: *Alle flexibel machen* Goes Away

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As someone whose trips are all migrated to durations,
I want the one-time *Alle flexibel machen* entry gone from the day menu,
so that the menu only offers what I still use.

**FRs covered:** None (removal of a migration aid from Story 13.3; FR43/FR46 unchanged).
**Depends on:** nothing. **Origin:** Tommy, 2026-10-21. See `_bmad-output/planning-artifacts/sprint-change-proposal-2026-10-21-day-email.md`.
**Order:** commit this story **before** 9.3 starts. 9.3 adds *Per E-Mail senden* to the same ⋯ menu, and the two diffs must stay separate.

## Acceptance Criteria

1. **Menu.** In the day view's ⋯ menu, for every role and for a day with or without FIXED activities, *Alle flexibel machen* / *Make all flexible* is not offered, and the confirmation dialog (`day-make-flexible-dialog`) no longer exists. The divider (`day-hero-overflow-divider`) still appears only when the planning group (day image, move, swap) and the output group (print, packet) are both non-empty, as `showDayMenuDivider` computes today minus the removed term.
2. **Code gone.** These are deleted, together with their tests:
   - the route `src/app/api/trips/[id]/day-plan-items/make-flexible/route.ts` and its directory;
   - `makeDayFlexibleForTripDay` and `DayMakeFlexibleResult` in `dayPlanItemRepo.ts`;
   - the `makeFlexible` `ScheduleEdit` member, its `planDaySchedule` branch, `convertedIds` and the `converted` field of `DaySchedulePlan` in `dayScheduleTransaction.ts`;
   - the `madeFlexible` receipt kind: type member and wire conversion in `dayChangeReceipt.ts`, the `receiptHasSideEffects` term and the summary branch, the Zod member in `dayChangeReceiptSchemas.ts`, and the **three** `madeFlexible` branches in `dayPlanChangeRepo.ts` (post-condition check, phase-1 staleness, phase-2 restore);
   - `dayMakeFlexibleSchema` / `DayMakeFlexibleInput` in `dayPlanItemSchemas.ts`;
   - in `TripDayView.tsx`: the `makeFlexibleOpen` state, `makeFlexibleInFlightRef`, `handleMakeDayFlexible`, the menu item, the dialog, the `makeFlexible` key of `dayMenuItemsVisible` and `fixedActivityCount`;
   - the keys `trips.dayView.makeFlexible*` (8 keys) **and** `trips.dayChange.madeFlexible` / `trips.dayChange.madeFlexibleOne` in both `en.ts` and `de.ts`.
3. **Nothing left.** `grep -rniE "makeFlexible|make-flexible|madeFlexible|made_flexible|Alle flexibel|Make all flexible"` over `src` and `test` finds nothing. Test file names are covered too: no file under `test/` contains `MakeFlexible` in its name.
4. **Route gone.** `POST /api/trips/{id}/day-plan-items/make-flexible` answers 404. Verified against `next start` (Task 6), because a deleted route cannot be imported into a vitest test.
5. **Import schema.** `tripImportSchemas.ts` keeps `durationMinutes: z.number().int().min(1)...` exactly, so exports made before or after the 13.1 migration still import. Its comment no longer names *Alle flexibel machen* as the reason. It now says that a migrated row can last one minute (Story 13.1) and that 5 is only the dialog's input rule.
6. **`fixedDurationOf` stays.** It is still used by the create/update path (`dayPlanItemRepo.ts` ~L483) and by the delete receipt (~L829). It and its three-assertion test remain; the test moves out of the deleted `dayScheduleMakeFlexible.test.ts` into a new `test/dayScheduleFixedDuration.test.ts`, with the same assertions. Its doc comment drops the *Alle flexibel machen* wording but keeps its meaning.
7. **Everything else from 13.3 and its neighbours behaves as before.** *Nach oben / Nach unten*, *Einfügen nach*, cross-day moves, park/schedule, applied suggestions and their undo pass their existing tests. The **only** edit allowed in a surviving test file is removing the line `expect(plan.converted).toEqual([]);` at `test/dayScheduleAppend.test.ts:57`, because the field it asserts on is removed by AC2. Any other surviving test that needs editing is a stop-and-report, not a fix.
8. **Gates.** `npm test`, `npm run typecheck`, `npm run lint` (no new errors against the baseline count), `npm run build` and `test/i18nDictionaries.test.ts` (en/de key parity) pass.

**Out of scope:** anything else in the day menu (9.3 adds its entry); FR42/FR43/FR46 behaviour; the import schema's minimum; planning-artifact edits (the correct course has already struck 13.3's criterion in `epics.md`).

## Tasks / Subtasks

- [x] **Task 0 — Baseline** (AC: 7, 8)
  - [x] Record `git rev-parse HEAD` as `baseline_commit` in this file's front matter.
  - [x] Run `npm test`, `npm run typecheck` and `npm run lint` once on the baseline and note the counts (tests/files, type errors, lint errors/warnings). AC8 is measured against these numbers. 8.9 closed at 3582 tests and lint 0 errors / 80 warnings, but take the numbers from your own run.
- [x] **Task 1 — UI** (AC: 1)
  - [x] `TripDayView.tsx`: remove the state (~L694–695), the `makeFlexible` comment paragraph and key in `dayMenuItemsVisible` (~L858–865) together with `fixedActivityCount`, the `makeFlexible` term in `showDayMenuDivider` (~L870), `makeFlexibleInFlightRef` + `handleMakeDayFlexible` (~L1617–1673), the menu item (~L3841–3854) and the dialog with its comment (~L5280–5306).
  - [x] The `Record<…>` type of `dayMenuItemsVisible` becomes `"dayImage" | "transfers" | "print" | "packet"`.
  - [x] After the edit, check that every import is still used (`formatMessage`, `Dialog`, `DialogActions`, `DialogContent`, `DialogTitleWithClose`, `Button`). They are almost certainly used elsewhere in this 5000-line file. Lint reports any import that is no longer used.
  - [x] The block comment above the menu items says `aria-haspopup="dialog" on the three that open one`. That still holds (day image, move, swap), so leave it.
- [x] **Task 2 — Route, repository, schedule plan** (AC: 2, 6)
  - [x] Delete `src/app/api/trips/[id]/day-plan-items/make-flexible/` (the whole directory).
  - [x] `dayPlanItemRepo.ts`: delete `DayMakeFlexibleResult` (~L114–115) and `makeDayFlexibleForTripDay` with its doc comment (~L886–955). Keep the `fixedDurationOf` and `DayPlanChangedError` imports; both have other users. Check the other imports the function used (`readScheduleInputInTransaction`, `readDrawnSegmentKeysInTransaction`, `finishActivityWriteInTransaction`, `planDaySchedule`) and keep each one that is still used elsewhere.
  - [x] `dayScheduleTransaction.ts`: delete the `makeFlexible` member of `ScheduleEdit` (~L158–163), the `case "makeFlexible"` (~L278–284), `convertedIds` (~L222–223), the `converted` field and its doc comment in `DaySchedulePlan` (~L200–201), its build-up (~L321, ~L329–330) and `converted` in the return (~L364). Read L315–365 first. The `converted.push` branch probably sits in an `if/else` with `appended` and `edited`, so remove only that arm and keep the rest of the classification as it is.
  - [x] `fixedDurationOf` doc comment: reword so it says what it is (a FIXED row's duration as the user saw it: span when both times read and end > start, else stored duration; no clamp, a migrated row may last one minute) without naming the removed feature.
  - [x] `dayPlanItemSchemas.ts`: delete `dayMakeFlexibleSchema` and `DayMakeFlexibleInput` (~L290–297).
- [x] **Task 3 — Receipt kind** (AC: 2)
  - [x] `dayChangeReceipt.ts`: delete the union member and its doc (~L189–200), the `case "madeFlexible"` in the wire conversion (~L329–338), the `receiptHasSideEffects` term and its `Story 13.3` doc line (~L392, ~L395), the summary branch (~L465–468) and its `Story 13.3` paragraph in the doc comment (~L436–437).
  - [x] `dayChangeReceiptSchemas.ts`: delete the `madeFlexible` member and its comment (~L227–250). Read the surrounding `z.discriminatedUnion`/`z.union` so the array stays well-formed.
  - [x] `dayPlanChangeRepo.ts`: delete the post-condition block (~L191–197), the phase-1 `case "madeFlexible"` (~L440–447) and the phase-2 `case "madeFlexible"` (~L562–580). The `never` defaults stay. TypeScript rejects any `case "madeFlexible"` that is left behind once the union member is gone, so `npm run typecheck` finds the last one.
- [x] **Task 4 — i18n** (AC: 2, 8)
  - [x] `en.ts` L338–345 and `de.ts` L316–323: the eight `trips.dayView.makeFlexible*` keys.
  - [x] `en.ts` L724–725 and `de.ts` L668–669: `trips.dayChange.madeFlexibleOne` and `trips.dayChange.madeFlexible`.
  - [x] Delete from both files in the same change. `i18nDictionaries.test.ts` checks parity.
- [x] **Task 5 — Tests and import comment** (AC: 3, 5, 6, 7)
  - [x] Delete `test/dayMakeFlexible.test.ts`, `test/dayMakeFlexibleConflict.test.ts`, `test/tripDayViewMakeFlexible.test.tsx`, `test/dayScheduleMakeFlexible.test.ts`.
  - [x] Before deleting `dayScheduleMakeFlexible.test.ts`, copy its `describe("fixedDurationOf …")` block (L84–90) into a new `test/dayScheduleFixedDuration.test.ts`, with the same three assertions and an import from `@/lib/repositories/dayScheduleTransaction`. Name the describe without "13.3 / flexible" wording.
  - [x] `test/dayChangeReceipt.test.ts`: delete the `describe("dayChangeReceipt, madeFlexible (Story 13.3 AC5)")` block (from ~L327) and any helper it alone uses (`converted(...)`). Keep helpers that other blocks share.
  - [x] `test/dayScheduleAppend.test.ts:57`: delete `expect(plan.converted).toEqual([]);`. This is the only edit allowed in a surviving test (AC7).
  - [x] `src/lib/validation/tripImportSchemas.ts` ~L491–494: reword the comment per AC5. Do not touch the schema line.
  - [x] Run the AC3 grep and confirm it is empty.
- [x] **Task 6 — Gates and a short browser check** (AC: 1, 4, 8)
  - [x] `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`. Compare with Task 0.
  - [x] Under `next start` (not `next dev`) on a copied database, never Tommy's own `prisma/dev.db` unless he says so: open a day with a FIXED activity as owner. The ⋯ menu shows back, day image, move, swap, divider, print and packet, and no *Make all flexible*. As a viewer: back, (no divider), print, packet. `curl -X POST` the old route with a valid session cookie and CSRF header → 404. Stop the server **by PID**, not with a broad `pkill`, because that killed Tommy's own dev server during 5.10.
  - [x] Undo of the remaining kinds: reorder an activity, then click *Rückgängig*. It still works.

## Dev Notes

### What this story is

A purely subtractive story. No migration, no schema change, no new dependency, no env var. The risk is not the deletion itself. The risk is **leaving half of it behind**, or **deleting something shared**. The correct-course inventory was incomplete: it did not list `dayPlanChangeRepo.ts` (three `madeFlexible` branches in the undo path), the `trips.dayChange.madeFlexible*` keys, `test/dayChangeReceipt.test.ts`, or `test/dayScheduleAppend.test.ts:57`. The list in AC2 and the tasks above comes from a fresh grep at `aaf4c89` and is complete for `src` and `test`:

```
src/app/api/trips/[id]/day-plan-items/make-flexible/route.ts   delete
src/components/features/trips/TripDayView.tsx                  edit
src/lib/repositories/dayPlanItemRepo.ts                        edit
src/lib/repositories/dayScheduleTransaction.ts                 edit
src/lib/repositories/dayPlanChangeRepo.ts                      edit  (missed by the proposal)
src/lib/trips/dayChangeReceipt.ts                              edit
src/lib/validation/dayPlanItemSchemas.ts                       edit
src/lib/validation/dayChangeReceiptSchemas.ts                  edit
src/lib/validation/tripImportSchemas.ts                        comment only
src/i18n/en.ts, src/i18n/de.ts                                 10 keys each
test/dayMakeFlexible.test.ts                                   delete
test/dayMakeFlexibleConflict.test.ts                           delete
test/dayScheduleMakeFlexible.test.ts                           delete (after moving fixedDurationOf's test)
test/tripDayViewMakeFlexible.test.tsx                          delete
test/dayChangeReceipt.test.ts                                  delete one describe  (missed by the proposal)
test/dayScheduleAppend.test.ts                                 delete one line      (missed by the proposal)
test/dayScheduleFixedDuration.test.ts                          NEW
```

Nothing in `_bmad-output/planning-artifacts/architecture.md`, the UX spec, `docs/` or `deploy/` names the feature, so no doc edit is needed.

### Keep — do not delete

- **`fixedDurationOf`** (`dayScheduleTransaction.ts:174`). Born in 13.3, but used by `toScheduleFields` for FIXED create/update (`dayPlanItemRepo.ts` ~L483) and by the delete receipt (~L829). Deleting it breaks creating a FIXED activity.
- **`DayPlanChangedError`**: used by every scheduled write.
- **`finishActivityWriteInTransaction`, `readScheduleInputInTransaction`, `readDrawnSegmentKeysInTransaction`**: shared by park, schedule, reorder, etc.
- **`trips.plan.scheduleModeFlexible`** ("Flexible"): the mode label in the activity dialog. It is not part of this feature, although grepping for "flexib" finds it.
- **Import minimum 1** in `tripImportSchemas.ts`. Old exports carry one-minute rows from the 13.1 migration.
- The `aria-haspopup` block comment in the menu ("the three that open one") stays true.

### Receipts in flight

Receipts are not stored. The server signs them (`dayChangeReceiptSignature.ts`), the client holds them, and `POST /day-plan-changes/undo` verifies and parses them with `dayChangeUndoSchema`. Suppose a browser still holds a `madeFlexible` receipt across the deploy and the user clicks *Rückgängig*. The parse fails and the user gets a `400 validation_error` and the generic undo error, with no write. That is acceptable: the window is the few seconds of a notice, and Tommy is the only one who used the feature. Do not add a compatibility branch.

### Exhaustiveness helps you

Every `switch` over `ScheduleEdit["kind"]` and `DayChangeReceipt["edited"]["kind"]` ends in a `const unhandled: never` default. Once the union members are gone, TypeScript reports each leftover `case "makeFlexible"` / `case "madeFlexible"` as not comparable. Delete the union members first (Task 2/3), then let `npm run typecheck` list the cases you missed.

### The menu after this story

| Role | Items |
|---|---|
| Owner / contributor | Back · Edit day details · Move activities · Swap activities · ─── · Print day · Download document packet |
| Viewer | Back · Print day · Download document packet (no divider: `showDayMenuDivider` is false with an empty planning group) |

The divider expression becomes `(dayImage || transfers) && (print || packet)`. `test/tripDayViewLayout.test.tsx` covers the divider. It must pass unchanged. The deleted `tripDayViewMakeFlexible.test.tsx` also asserted on the divider, but only for the removed item, so nothing is lost.

### Project conventions to follow

- Repo root for code is `travelplan/` (`/Users/tommy/Development/TravelPlan/travelplan`). Run all npm scripts there.
- Tests: vitest (`npm test` = `vitest run`), the route tests run against a real SQLite test DB, and component tests use Testing Library. There is nothing new to test beyond the moved `fixedDurationOf` test. Removal is proven by the grep, by the surviving suites and by the browser check.
- Comments in this code base cite the story that introduced a thing. When a comment's only content is "Story 13.3 adds makeFlexible", delete it. When a comment explains a shared thing and only mentions 13.3 along the way, reword it. Do not leave "(removed in 8.10)" tombstones in source. Git history records the removal.
- Commit message style: see recent commits (`8-9: …`, a dense summary line). The commit happens after review, as usual.

### Previous story intelligence (8.9, 8.8)

- 8.9 was dependency-only and closed at 3582 tests, typecheck clean, lint 0 errors / 80 warnings, build ok. Use your own Task 0 numbers as the baseline anyway.
- Browser passes in this epic run under `next start` against **cloned** data. 8.3's pass recorded that a broad `pkill` once killed Tommy's own dev server, so stop servers by PID.
- 8.8/8.9 left the production deploy to Tommy. This story needs no deploy step beyond the normal one. The removal goes live with the next deploy, 9.3's at the latest.

### References

- Story text: `_bmad-output/planning-artifacts/epics.md` → *Story 8.10* (L3636 ff.); the 13.3 criterion struck at ~L4476.
- Change proposal: `_bmad-output/planning-artifacts/sprint-change-proposal-2026-10-21-day-email.md` §1, §2 *Technical impact*, §4.5.
- Original feature: `_bmad-output/implementation-artifacts/13-3-putting-the-day-in-order.md`.
- Next story on the same menu: 9.3 *The Day in My Inbox* (epics.md, after 9.2).

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (claude-opus-5-5)

### Debug Log References

- **Baseline (Task 0, `aaf4c89`):** `npm test` 223 files / 3582 tests passed; `npm run typecheck` clean; `npm run lint` 0 errors / 80 warnings.
- **After:** `npm test` 220 files / 3559 tests passed. The drop is fully accounted for: 4 test files deleted (7 + 1 + 7 + 5 = 20 tests), the `madeFlexible` describe in `dayChangeReceipt.test.ts` (4 tests), and 1 test in the new `dayScheduleFixedDuration.test.ts`. 223 − 4 + 1 = 220 files and 3582 − 24 + 1 = 3559 tests. `typecheck` clean, `lint` 0 / 80 (unchanged), `build` exit 0. The 11 Turbopack trace warnings are the ones 8.9 documented and sit in untouched upload code. `i18nDictionaries.test.ts` (en/de parity) and `tripDayViewLayout.test.tsx` (divider) pass unchanged.
- **Stale generated types:** the first `typecheck` after the deletion failed only in `.next/types/validator.ts` and `.next/dev/types/validator.ts`. Both are generated route validators that still pointed at the deleted route. `npm run build` regenerated `.next/types`. `.next/dev/types` was deleted, and `next dev` recreates it. No dev server was running at the time. Tommy's next `next dev` start needs nothing extra.
- **AC3 grep:** `grep -rniE "makeFlexible|make-flexible|madeFlexible|made_flexible|Alle flexibel|Make all flexible" src test` → empty; `find test -iname "*MakeFlexible*"` → empty.
- **Task 6 browser pass, under `next start` (16.4.2) on port 3110:** run against an APFS clone of `prisma/dev.db` in the scratchpad, with an empty scratch `MEDIA_STORAGE_ROOT` and dummy SMTP variables (the 8.8 boot check requires them under `next start`). In the clone only, I set a throwaway password and added Konni as VIEWER on *Neuseeland*. Headless system Chrome at 390px, driven by `playwright-core` installed in the scratchpad (not in the project). Day 7 (2 FIXED, 2 FLEXIBLE):
  - Owner menu: Zurück zur Reise · Tagesdetails bearbeiten · Aktivitäten verschieben · Aktivitäten tauschen · ─── · Tag drucken · Dokumentenpaket herunterladen. No *flexib* text in the menu and no `day-make-flexible-dialog` ✓
  - Viewer menu: Back to trip · Print day · Download document packet. No divider (count 0) ✓
  - `POST /api/trips/{id}/day-plan-items/make-flexible` with session cookie + valid CSRF header → **404** for owner and viewer ✓ (AC4)
  - Reorder + undo: *Sky Tower* → *Nach oben* swaps it with *Queen Street*. *Rückgängig* then restores the original order exactly ✓ (run twice)
  - Errors: no page errors. The only 404s were the route probe and images missing from the empty scratch media root.
  - Server stopped by PID (90160, npx parent 90141), nothing left on 3110, and the `prisma/dev.db` SHA-1 was verified unchanged.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.
- **AC1 ✓** The menu item, its dialog, `makeFlexibleOpen`, `makeFlexibleInFlightRef`, `handleMakeDayFlexible` and `fixedActivityCount` are gone. `dayMenuItemsVisible` is `Record<"dayImage" | "transfers" | "print" | "packet", boolean>`, and the divider is `(dayImage || transfers) && (print || packet)`. All imports are still used (lint unchanged). The "three that open one" comment was left as is.
- **AC2 ✓** The route directory is deleted. `makeDayFlexibleForTripDay`/`DayMakeFlexibleResult` are gone; the shared helpers it used (`readScheduleInputInTransaction`, `readDrawnSegmentKeysInTransaction`, `finishActivityWriteInTransaction`, `planDaySchedule`, `fixedDurationOf`, `DayPlanChangedError`) all still have users and stay imported. In the schedule plan, the `makeFlexible` edit, `convertedIds`, the `converted` field and its build-up and return were removed; only the `converted` arm of the row classification went. The `madeFlexible` receipt kind was removed in every place: type, wire conversion, side-effect term, summary branch, Zod member, and all three `dayPlanChangeRepo.ts` branches. `dayMakeFlexibleSchema`/`DayMakeFlexibleInput` and the 10 i18n keys were removed in both languages.
- **AC3 ✓** The grep and the file-name check are empty.
- **AC4 ✓** The old route answers 404 under `next start` (see Debug Log).
- **AC5 ✓** The `tripImportSchemas.ts` schema line is untouched. The comment now says a row migrated by Story 13.1 can last one minute and that 5 is only the dialog's input rule.
- **AC6 ✓** `fixedDurationOf` is kept, with its doc comment reworded (meaning unchanged, no feature name). Its three assertions moved unchanged into `test/dayScheduleFixedDuration.test.ts` (`describe("fixedDurationOf")`).
- **AC7 ✓** The only edit to a surviving test is removing `expect(plan.converted).toEqual([]);` from `dayScheduleAppend.test.ts:57`. Deleting the whole `madeFlexible` describe in `dayChangeReceipt.test.ts` was mandated by AC2/Task 5. Its `converted` helper was local to that describe. All other suites pass unedited.
- **AC8 ✓** Test, typecheck, lint, build and i18n parity all pass (numbers in the Debug Log).
- The deletions are staged (`git rm`). The rest is unstaged and nothing is committed, as usual until after review. Per the story order, 8.10 should be committed before 9.3 starts.

### File List

- `travelplan/src/app/api/trips/[id]/day-plan-items/make-flexible/route.ts` (deleted)
- `travelplan/src/components/features/trips/TripDayView.tsx`
- `travelplan/src/lib/repositories/dayPlanItemRepo.ts`
- `travelplan/src/lib/repositories/dayScheduleTransaction.ts`
- `travelplan/src/lib/repositories/dayPlanChangeRepo.ts`
- `travelplan/src/lib/trips/dayChangeReceipt.ts`
- `travelplan/src/lib/validation/dayPlanItemSchemas.ts`
- `travelplan/src/lib/validation/dayChangeReceiptSchemas.ts`
- `travelplan/src/lib/validation/tripImportSchemas.ts`
- `travelplan/src/i18n/en.ts`
- `travelplan/src/i18n/de.ts`
- `travelplan/test/dayMakeFlexible.test.ts` (deleted)
- `travelplan/test/dayMakeFlexibleConflict.test.ts` (deleted)
- `travelplan/test/dayScheduleMakeFlexible.test.ts` (deleted)
- `travelplan/test/tripDayViewMakeFlexible.test.tsx` (deleted)
- `travelplan/test/dayScheduleFixedDuration.test.ts` (new)
- `travelplan/test/dayChangeReceipt.test.ts`
- `travelplan/test/dayScheduleAppend.test.ts`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/implementation-artifacts/8-10-alle-flexibel-machen-goes-away.md`

### Change Log

- 2026-10-21: Implemented Story 8.10. *Alle flexibel machen* is removed end to end (menu, dialog, route, repository function, schedule-plan edit, `madeFlexible` receipt kind incl. undo, schemas, 10 i18n keys, 4 test files and one describe); `fixedDurationOf` kept, its test moved to `dayScheduleFixedDuration.test.ts`; import-schema comment reworded. 3559 tests, typecheck, lint 0/80, build, browser pass under `next start`. Status → review.
- 2026-10-21: Code review (Blind Hunter, Edge Case Hunter, Acceptance Auditor): clean. 0 patch, 0 defer, 15 findings dismissed (already handled, spec-mandated, or verified false). Status → done.
