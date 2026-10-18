---
baseline_commit: e0643cd29b22946f5d80d1cf9a6aaf4a5958d8ab
---

# Story 13.2: When the Plan Doesn't Work Out

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As someone with a booked ferry and a full morning,
I want to see, on the day and in the trip overview, when my plan no longer adds up,
so that I fix it while planning instead of finding out on the road.

**FRs covered:** FR47. **Depends on:** Story 13.1 (done). Epic 14 stories 14.1 and 14.2 are done and added two more refusing writes (schedule "+", park); 14.4 is ready-for-dev and touches the same files (see *Sequencing*).
Sources: [epics.md#Story 13.2](../planning-artifacts/epics.md); [sprint-change-proposal-2026-10-17.md](../planning-artifacts/sprint-change-proposal-2026-10-17.md) (*Rulings superseded* 4a/4b, rules 5 and 6, *UX impact* `plan-conflict`, success criterion 3, decisions 3 and 4); [architecture.md](../planning-artifacts/architecture.md) *Data Architecture* "Activities planned by duration" (l.146: conflicts derived on read, never stored; null times mean *does not fit*) and *API & Communication Patterns* "Parking and scheduling" (l.170: removing a receipt field needs no version bump); `ux-designs/ux-TravelPlan-2026-07-27/DESIGN.md` `plan-conflict` (l.308), `day-row` gap state (l.100-106, l.266), gap badge tokens (l.147-148), warn rules (l.234-235, l.336); `EXPERIENCE.md` *Plan does not work out* (l.90); [13-1](13-1-just-say-how-long.md) (*Read this first* §7, §15; review D1); [14-1](14-1-one-kind-of-entry.md), [14-2](14-2-park-it-for-another-day.md); DW-375, DW-377, DW-378, DW-394 in [deferred-work.md](deferred-work.md).

All code paths below are relative to `travelplan/`. Line numbers were read on 2026-10-18 at `e0643cd`. Abbreviations: `TV` = `src/components/features/trips/TripDayView.tsx`, `TT` = `src/components/features/trips/TripTimeline.tsx`, `DS` = `src/lib/trips/daySchedule.ts`, `DST` = `src/lib/repositories/dayScheduleTransaction.ts`, `DPIR` = `src/lib/repositories/dayPlanItemRepo.ts`, `TSR` = `src/lib/repositories/travelSegmentRepo.ts`, `DCRc` = `src/lib/trips/dayChangeReceipt.ts`, `TR` = `src/lib/repositories/tripRepo.ts`. `grep` treats `tripRepo.ts` and some other repository files as binary, so use `grep -a` or `rg`.

## Read this first: decisions this file takes

Each item was checked against the code. Items marked **(Q)** are defaults that Tommy should confirm; they are repeated under *Questions*.

1. **Conflicts are derived on the server, once, and shipped in the trip payload.** Both the day view and the trip overview load `GET /api/trips/{id}` (`TV:981`, `TT`), built by `getTripWithDaysForUser` (`TR:1080-1316`). Add a per-day field `planConflicts` there, computed by a new pure helper from `scheduleDay`. Do **not** call `scheduleDay` in the two client components:
   - the payload maps a stay with a blank name to `accommodation: null` (`TR:1239-1248`), but the transaction's previous stay ignores the name (`DST:101-149`). Client-side derivation from the payload would get the day start wrong on such a day. On the server you read the raw rows and can use the transaction's rule exactly;
   - one derivation, unit-tested once, instead of two copies of the input assembly (`TV:2046` and `TT:816-911` each find "the previous day" differently from the transaction's *nearest lower `dayIndex`*);
   - precedent: `missingAccommodation` and `missingPlan` are derived the same way in the same mapper.

   The field is derived on every read and never stored (no schema change, no migration).

2. **The helper.** New pure module `src/lib/trips/planConflicts.ts` (no Prisma, no `server-only`, so the client may import its types):
   ```ts
   export type DayPlanConflict =
     | { kind: "late"; itemId: string; title: string | null; fromTime: string; reachableAt: string; lateMinutes: number }
     | { kind: "overflow"; itemId: string; title: string | null };
   export const derivePlanConflicts = (input: ScheduleInput): DayPlanConflict[]
   ```
   - It calls `scheduleDay(input)` and maps `conflicts` to `late` (with `lateMinutes = timeToMinutes(reachableAt) − timeToMinutes(fromTime)`) and `overflow` ids to `overflow`, ordered by the day's order (the input's `items` order).
   - Overlapping fixed activities are already `late` conflicts in `scheduleDay` (the cursor is `max(cursor, end)` of the earlier one). Do not add a third kind.
   - Also add a builder `buildScheduleInput({ items, legs, previousStay })` that maps rows to `ScheduleItem` / `ScheduleLeg` and resolves `dayStartMinute` with `resolveDayStartMinute` (`src/lib/trips/stayTimes.ts:33`). Make `readScheduleInputInTransaction`'s caller path (`DST:120-147`) use the same builder, so the read and the write cannot drift. Keep legs in `createdAt` ascending order (first leg per pair wins, `DS:111`).

3. **Previous stay on read = the write's rule.** In `getTripWithDaysForUser`, `trip.days` is ordered by `[dayIndex, date]`. The previous stay of day *k* is the raw `accommodation` row (id, `checkOutTime`, **regardless of its name**) of the nearest earlier day with a lower `dayIndex`; `null` if that day has no accommodation or there is no earlier day. That is what `DST:101-149` does. Add a test with a blank-named stay to pin it. Make sure the `select` in `getTripWithDaysForUser` carries `accommodation.id` and `checkOutTime` even when the name is blank (it does today; the blank check is in the mapper).

4. **The count.** "Der Plan geht nicht auf · N" counts **marked activities**: one per `late` conflict, one per `overflow` row. This is exactly the number of cards that carry a marker, so the number on the hero and on the day row can be checked by counting cards. **(Q1)**

5. **Every overflow row carries the marker, not only the first.** The epic's AC (current text) says "each carries 'Passt nicht mehr in den Tag'"; the proposal and DESIGN.md said "the first". The epic wins. Rationale: each of those cards has no time pill, and without a line it would look like an untimed activity.

6. **What happens to past-midnight at write time.** `planDaySchedule` (`DST:294-302`) returns `past_midnight` for a new overflow. Delete that block and the `DaySchedulePastMidnight` type. A write that pushes rows past 23:59 now stores them with `fromTime`/`toTime` null (`scheduleDay` already does that, rule 5), and `applyScheduleChangesInTransaction` already writes null as-is (`DST:355`). A FIXED activity always keeps its times (the 400 schema error for a fixed *end* after 23:59, `dayPlanItemSchemas.ts:216`, is an input check and **stays**).

   Every writer that could refuse loses that arm (list in *Current state*). Each repo result type loses `DayPlanPushRefusal` / `TravelSegmentPastMidnight` / the accommodation variant, so the compiler finds every caller. `refusalOf` (`DPIR:535`) and its `NEW_ITEM_ID → ""` mapping go if nothing else uses them.

7. **Receipt: the moved rows include those that lost their times; no new field.** A row whose times go from `09:00–10:00` to null is a changed row and already lands in `movedItems` with its previous times (`DST` builds changes from time differences), so undo restores it, and the notice counts it as moved. Check that `summarizeDayChangeReceipt` and `receiptHasSideEffects` treat "now null" as a time change (they compare `fromTime`/`toTime`; null ≠ "09:00", so they do). A **created** row that does not fit is not moved, and gets no notice of its own. The persistent card and hero markers tell the user after the reload. **(Q2)**

   Do **not** add overflow to `planConflicts` in the receipt. Its shape requires `fromTime`/`reachableAt`, and the persistent marker makes a one-off notice line redundant.

8. **Check-in warning removed without a receipt version bump.** Remove `checkInWarning` from `DayChangeReceipt`, `buildReceipt`'s extras, the zod receipt schema (`dayChangeReceiptSchemas.ts:258, 279`), `mapReceipt` (`DCRc:338`), `checkInWarningText` (`DCRc:447-454`), `findCheckInWarningForOrderInTransaction` / `findCheckInWarningInTransaction` / `movedAnyTimes` (`DST:393-448`), and every caller (list in *Current state*). Version stays **3**. This is the 14.1 precedent (architecture l.170; `consumedBucketListItem` removed without a bump): a receipt still held by a browser that carries `checkInWarning` now fails the `.strict()` parse with 400, which the client already shows as "undo unavailable". Add a schema test for exactly that, next to the 14.1 one (`test/dayChangeReceipt.test.ts:211`). Update the receipt header comments (`DCRc:16-19, 42-43, 355`).

9. **Where the markers go and who sees them.**
   - **Card:** a `plan-conflict` line in the card body, after the title (`TV:4555` body Box), outside every `canEditPlanning` gate, with `overlaidContentSx` so it sits above the writer's edit overlay like the gap pill does. Not in the head row: the head row is not rendered for a viewer when there is no time and no cost (`TV:4442`), which is exactly the overflow case.
   - **Day hero:** a `warnBg` pill under the date in the title block (`TV:3890-3909`). DESIGN.md l.265 says the hero carries no stats; l.308 makes this pill the explicit exception. Visible to every role.
   - **Overview day row** (`TT:929-975`, `data-testid="timeline-day-card"`; there is no literal `day-row` testid): the row takes the gap state (`warnBorder` / `warnBgRow`, `TT:964, 967`) when it has a missing stay **or** a plan conflict, and the conflict pill sits in the title area (`TT:1004-1024`, where *Plan fehlt* already sits). The stay link stays: a day can have a stay and a broken plan. If both, both pills show.
   - **Not changed:** the "Open items" stat and `openDaysCount`/`firstGapDay` (`TT:554-555, 775-790`), the sidebar gap-alert card (`TT:1195-1215`), the dashboard's trip status (`TripsDashboard.tsx`). They stay about missing stays. **(Q3)**
   - Print, gantts, maps, the suggestions preview: unchanged (out of scope; the gantt already omits untimed rows).

10. **Read-derivation on a day the server has not recomputed.** Since 13.1 every write recomputes its day, so stored times equal `scheduleDay`'s output, with two known exceptions until 13.3: a flexible row moved to another day keeps its old times until that day's next write (13.1 §11), and undo of `parked`/`scheduled` does not recompute (DW-396). On such a day the derived conflicts describe the **recomputed** schedule, while the card pill shows the **stored** times. Accept it: the next write on the day aligns them, and 13.3 closes the move gap. Do not try to "fix" stored times on read (reads never write).

11. **Copy.** Use `formatActivityDuration` (`src/lib/trips/activityDuration.ts:8`, 14.1) for the lateness ("40 Min", "1 Std 10 Min"), not a new formatter.

## Acceptance Criteria

1. **Derived on read, never stored.** `GET /api/trips/{id}` returns, for each day, `planConflicts: DayPlanConflict[]` (§2), computed by `derivePlanConflicts` from the day's items in `sortOrder`, its legs in `createdAt` order, and last night's stay by the write path's rule (§3). It is `[]` for a day that works. No column, table or migration is added. The same function serves the day view and the trip overview, because both read this payload.
2. **The three kinds.**
   - A FIXED activity reached after its start (a flexible chain running into it, or an earlier fixed activity overlapping it) is `late`, with `reachableAt` (capped at 23:59, as in 13.1 D1) and `lateMinutes`.
   - Every FLEXIBLE activity that does not fit before 23:59 is `overflow`.
   - A FIXED activity after an overflow is not reported as `late` (unchanged `scheduleDay` behaviour).
   - Arriving at the night's stay after its check-in time is never a conflict.
3. **Card marker.** A card with a conflict shows a `plan-conflict` line (`data-testid="plan-conflict"`) in `warn` colour with `WarningTriangleIcon` (`TripIcons.tsx:66`), never colour alone:
   - `late`: "Erreichbar erst 12:40 (40 Min zu spät)" / "Reachable only at 12:40 (40 min late)";
   - `overflow`: "Passt nicht mehr in den Tag" / "No longer fits in the day".

   A card without a conflict shows no line. An overflow card shows no time pill (as today).
4. **Day hero.** A day with at least one conflict shows a `warnBg` pill in the hero title block (`data-testid="day-hero-plan-conflict"`): `WarningTriangleIcon` + "Der Plan geht nicht auf · 2" / "The plan doesn't work out · 2", the number per §4. No pill on a day without conflicts.
5. **Overview day row.** A day row with at least one conflict takes the gap border and background, as for a missing stay, and shows a pill (`data-testid="day-row-plan-conflict-pill"`) in the `day-row-gap-pill` style (`TT:1042-1060`: `warnBg`, `warning.main`, 11.5 px, 700, radius 6 px, `WarningTriangleIcon`) with the same text and count as the hero. The stay link or the missing-stay pill is unchanged. A row without conflicts and with a stay looks exactly as today.
6. **Past midnight is saved.** A write that pushes flexible activities past 23:59 succeeds:
   - those activities and every later flexible one are stored with `fromTime`/`toTime` null; their `durationMinutes` is untouched; FIXED activities keep their times;
   - when a later write makes room (shorten, delete, park, an earlier check-out, a shorter leg), their times are recomputed exactly from their durations;
   - the receipt lists each previously timed row that lost its times in `movedItems`, and *Rückgängig* restores them exactly (whole-DB `toEqual`).
7. **The refusal is gone.** `day_plan_past_midnight`, `pastMidnightResponse`, `DaySchedulePastMidnight` and every refusal arm are removed from: activity create, update, delete, reorder, schedule "+" (14.1), park (14.2), leg create, update and delete, and the check-out change. `trips.plan.pastMidnight` is removed from both dictionaries. Each client branch that handled the code (TV and the three dialogs) is removed. `rg -n "past_midnight|pastMidnight|PastMidnight" src test` finds nothing (a `daySchedule.ts` comment that mentions midnight in prose is fine).
8. **The check-in warning is gone** (§8): no producer, no receipt field, no text helper, no notice line, no key (`trips.dayChange.checkInWarning`). The notice's `warning` is `planConflictText(...)` alone. A v3 receipt that still carries `checkInWarning` is refused by the undo route with 400. `rg -n "checkInWarning|CheckInWarning" src` finds nothing; in `test` it finds only the refusal tests (receipt schema and undo route) and Task 4's "the receipt has no `checkInWarning` key" assertions (amended in code review, 2026-10-18).
9. **Viewers.** An owner, a contributor and a viewer see the same markers on cards, hero and day row. The notice itself stays writer-only, as today.
10. **Dictionaries.** `en.ts` and `de.ts` carry every key in the *Copy* table; the two removed keys are gone from both; `test/i18nDictionaries.test.ts` stays green.

## Tasks / Subtasks

- [x] **Task 0: Baseline** (all AC)
  - [x] Run the full suite, `tsc --noEmit` and lint, and record the counts. 14.2 ended at 203 files / 3320 tests, `tsc` 0, lint 0 errors / 79 warnings.
  - [x] Set `baseline_commit` in this file's frontmatter (add a frontmatter block as 13.1 has). Leave `.env` and the two deleted `prisma/dev.db.backup-*` files out of every commit (they are Tommy's working-tree changes).
- [x] **Task 1: `planConflicts.ts`, test first** (AC 1, 2)
  - [x] Create `src/lib/trips/planConflicts.ts` with `DayPlanConflict`, `derivePlanConflicts` and `buildScheduleInput` (§2).
  - [x] `test/planConflicts.test.ts` (red first), factory style as in `test/daySchedule.test.ts`:
    - a flexible chain reaching a 12:30 ferry at 12:40 → `late`, `reachableAt` "12:40", `lateMinutes` 10 (the 13.1 success criterion 3 day);
    - two overlapping fixed activities → the second is `late`;
    - a fixed activity reached exactly at its start → no conflict;
    - overflow: two flexible rows past 23:59 → two `overflow` entries in order; a fixed row after them → no `late`;
    - a late arrival reachable only after midnight → `reachableAt` "23:59" (13.1 D1);
    - a leg into tonight's stay that arrives after an explicit check-in → nothing;
    - a working day → `[]`;
    - `buildScheduleInput` with no previous stay (09:00), a stay without check-out (10:00), a stay with check-out, and a blank-named stay (still counts, §3).
- [x] **Task 2: Payload** (AC 1, 9)
  - [x] In `getTripWithDaysForUser` (`TR:1080-1316`), compute `planConflicts` per day from the already-loaded rows (items sorted with `compareDayPlanItemsByOrder`, the day's `travelSegments` in `createdAt` order, previous stay per §3). Do not add a query per day; everything is already selected (check `checkOutTime` and `accommodation.id` are in the select). Add the field to `TripDaySummary` (`TR:186`).
  - [x] Map it through `src/app/api/trips/[id]/route.ts`, which maps days in **two** places (next to `missingAccommodation` at l.75 and l.225). Both must carry `planConflicts`.
  - [x] Make `readScheduleInputInTransaction` build its `ScheduleInput` through `buildScheduleInput` (§2).
  - [x] `test/tripDetailRoute.test.ts`: a day with a late ferry and an overflow row returns both conflicts; a working day returns `[]`; a viewer gets the same field; the blank-named stay case.
- [x] **Task 3: Remove the midnight refusal** (AC 6, 7)
  - [x] `DST`: delete l.294-302 and `DaySchedulePastMidnight` (l.59); `DaySchedulePlan` becomes the ok shape only (or keep the `status: "ok"` tag if removing it churns too much; your call, but no second arm).
  - [x] Repos: `DPIR` (create l.670, update l.947, delete l.1034, reorder l.1097, schedule l.772, park l.854; the result unions l.85-123; doc comments l.83, 738, 820), `TSR` (l.53, 59/65/72, create l.497, update l.551, delete l.593), `accommodationRepo.ts` (l.52, 57, 463).
  - [x] Routes: `day-plan-items/route.ts` (l.20, 172-173, 279, 355), `day-plan-items/park/route.ts` (l.7, 22, 95), `day-plan-items/schedule/route.ts` (l.7, 22, 95), `day-plan-items/reorder/route.ts` (l.7, 25, 100), `travel-segments/route.ts` (l.19, 26, 164, 259, 334), `accommodations/route.ts` (l.13, 188). Remove `pastMidnightResponse` from `src/lib/http/dayPlanPushResponses.ts` and update its header comment.
  - [x] Client: `TV` l.1377 (schedule), l.1553 (reorder), l.1645 (park), l.1720 (delete, incl. the comment at l.1718); `TripDayPlanDialog.tsx:1895`; `TripAccommodationDialog.tsx:1557`; `TripDayTravelSegmentDialog.tsx:588`. Keep their generic-error and `day_plan_changed` handling intact.
  - [x] Tests: turn every refusal case into a *saved* case rather than deleting it, with a one-line comment "Story 13.2: past midnight is saved, not refused":
    - `dayPlanChangePush.test.ts` describes at l.287 ("refusals write nothing"), l.331 ("a row that already does not fit never blocks"), l.405 (its l.426 POST and l.449 schedule "+");
    - `dayPlanChangeReorder.test.ts:250`; `dayPlanChangeLegPush.test.ts` l.388/391 and l.483; `dayPlanChangeStayPush.test.ts` l.300 and l.413;
    - UI: `tripDayViewReorder.test.tsx:461`, `tripDayViewDayChange.test.tsx:539`, `tripDayViewLayout.test.tsx:938`, `tripDayPlanDialog.test.tsx:1956`, `tripAccommodationDialog.test.tsx:2814`, `travelSegmentDialog.test.tsx:2203` — these asserted the refusal banner; delete the banner assertion and keep (or drop, if nothing remains) the case.
  - [x] New repo cases (in `dayPlanChangePush.test.ts` or a new `dayPlanChangePastMidnight.test.ts`): a create that overflows saves with null times; an edit that pushes two flexible rows past 23:59 stores both null, keeps their durations, lists them in `movedItems`, and undo restores the day (`toEqual`); then a shortening write gives them their times back exactly; a park (14.2) and a "+" (14.1) on a full day both succeed; a leg update and a later check-out that overflow succeed. Park had no midnight test at all.
- [x] **Task 4: Remove the check-in warning** (AC 8)
  - [x] Producers: `DST` l.3, 67/76, 393-448; `DPIR` l.28, 557/568 (`finishActivityWriteInTransaction`); `TSR` l.18, 401, 404; `accommodationRepo.ts` l.10, 502, 515; `daySuggestionApplyRepo.ts` l.7, 364-365, 377.
  - [x] Receipt: `DCRc` type l.212, field l.224, `mapReceipt` l.338, `checkInWarningText` l.447-454, header comments; schema `dayChangeReceiptSchemas.ts` l.258, 279.
  - [x] `TV` l.77 import and the notice `warning` (l.3957-3966): `undoWithdrawn ? undefined : planConflictText(dayChange.receipt, t) || undefined`.
  - [x] Tests to delete or rewrite: `dayPlanChangePush.test.ts` describe "the check-in warning (Story 11.2 AC9)" (l.496) — delete; `dayPlanChangeReorder.test.ts` l.153 helper type and the case at l.327 — delete the case; `dayPlanChangeLegPush.test.ts` l.308 — delete, and drop the assertion at l.290; `daySuggestionApplyRoute.test.ts` l.356 — delete; `dayChangeReceipt.test.ts` l.5 import, l.110 case, the warning half of l.117, the fixture at l.461-465; `tripDayViewDayChange.test.tsx` l.598 — delete, l.623 — rewrite as "shows a new plan conflict as the warning line". Replace each deleted repo case with one assertion that the receipt has no `checkInWarning` key on the same scenario, so the removal is pinned.
  - [x] Add the strict-schema refusal test (§8) at the route level in `dayPlanChangeUndo.test.ts`: a signed v3 receipt with `checkInWarning` → 400, nothing written.
- [x] **Task 5: Card marker** (AC 3, 9)
  - [x] `TV`: extend the client `TripDay` type (l.324-386) with `planConflicts`. Index them by `itemId` once per render (`useMemo`).
  - [x] In the card body (l.4555), after the title: `plan-conflict` line — `display: inline-flex`, `gap: 0.5`, `WarningTriangleIcon` 14 px, `body2`, `color: theme.palette.warning.main`, `fontWeight: 600`, with `overlaidContentSx` for writers. Text per AC3, via `formatMessage` and `formatActivityDuration`.
  - [x] Tests in `tripDayViewLayout.test.tsx` (new describe "(Story 13.2 AC3, AC9)"): a late fixed card shows "Reachable only at 12:40 (40 min late)"; an overflow card shows "No longer fits in the day" and no time pill; a card without conflict has no `plan-conflict`; a viewer sees both lines. Feed the fixture's `planConflicts` directly (the client does not derive).
- [x] **Task 6: Day hero pill** (AC 4, 9)
  - [x] `TV` l.3890-3909: under the date, when `planConflicts.length > 0`, a pill `day-hero-plan-conflict`: `backgroundColor: tokens.warnBg`, `color: theme.palette.warning.main`, `WarningTriangleIcon`, 12 px / 700, `borderRadius: 6px`, `px: 1`, `py: 0.5`, `mt: 1`, `alignSelf: "flex-start"`. It sits inside `HERO_TITLE_RIGHT_CLEARANCE`, so it never runs under the overflow control. Check at 390 px with a long day title.
  - [x] Tests: pill with the count for a day with one late and one overflow ("· 2"); none for a working day; present for a viewer.
- [x] **Task 7: Overview day row** (AC 5, 9)
  - [x] `TT`: add `planConflicts` to the local `TripDay` type (l.79-129). `const hasPlanConflict = day.planConflicts.length > 0`; the row border and background use `isGap || hasPlanConflict` (l.964, 967); the stay column keeps `isGap` alone (l.1026-1086).
  - [x] The pill `day-row-plan-conflict-pill` in the title area (l.1004-1024), same `sx` as `day-row-gap-pill` (l.1042-1060) — extract that `sx` into one const and use it for both pills.
  - [x] Tests in `tripTimelinePlan.test.tsx` (next to l.735): a conflicting day with a stay shows the warn row, the stay link and the conflict pill with "· 2"; a day with both a missing stay and a conflict shows both pills; a working day looks as before. In `tripTimelineRoles.test.tsx`: a viewer sees the conflict pill.
- [x] **Task 8: i18n** (AC 10): add the *Copy* keys, remove `trips.plan.pastMidnight` and `trips.dayChange.checkInWarning` from both files.
- [x] **Task 9: Gates and the real run**
  - [x] Full suite, `tsc --noEmit` 0, lint 0 errors (warnings ≤ 79), `next build`. No migration, so `check:migrations` must be unchanged.
  - [x] Both `rg` checks of AC7 and AC8.
  - [x] Mutation checks (each applied, run, reverted; each must turn a test red):
    1. Drop `!overflowed` from the late check in `scheduleDay`.
    2. Derive the read-side previous stay from the mapped `accommodation` (blank name → null).
    3. Put the card marker inside the `canEditPlanning` gate.
    4. Count conflicts on the hero as `late` only.
    5. Leave null-timed rows out of `movedItems`.
  - [x] Real run with Tommy on the dev server (Safari, then 390 px):
    - a 12:30 ferry after a long flexible chain: card line, hero pill and overview row;
    - lengthen an activity until two flexible ones pass midnight: the save succeeds, both cards say "Passt nicht mehr in den Tag", *Rückgängig* restores them;
    - shorten it again: the times come back;
    - a viewer account sees the same markers;
    - arriving at a stay after its check-in shows nothing.
  - [x] Ledger: close DW-377 and DW-378 (moot: the warning and the refusal are gone). Re-read DW-375 and DW-394 and annotate: the refusal part no longer exists, the rest stays open.

### Review Findings

Code review 2026-10-18 (Blind Hunter, Edge Case Hunter, Acceptance Auditor). 1 decision (resolved to a patch), 5 patches, 0 deferred, 13 dismissed. All 5 patches applied; the orphan-leg delete was left alone, because an orphan is never drawn and cannot change a conflict. After the patches: 205 files / 3347 tests, `tsc` 0, lint 0/79; the reload rule was mutation-checked (both new day-view tests turn red under the old rule).

- [x] [Review][Patch] `lateMinutes` from the uncapped reach (decision resolved by Tommy, 2026-10-18: option a) — keep `reachableAt` capped at 23:59 for display, carry the uncapped minute out of `scheduleDay` and compute `lateMinutes` from it, so a 23:30 booking reached at 01:00 reads "23:59 (1 h 30 min late)". [`src/lib/trips/planConflicts.ts:103`, `src/lib/trips/daySchedule.ts:154`]
- [x] [Review][Patch] Conflict markers go stale after a write that changes only a fixed row's lateness. A leg save, an orphan-leg delete or an activity delete reloads the day only when `receipt.movedItems` is non-empty (or, for a delete, when the day already had conflicts). A fixed row never moves, so a leg that makes the ferry late, or a shorter leg that fixes it, leaves the card line and hero pill showing the old state while the notice shows the new one. Also reload when `receipt.planConflicts` is non-empty or the day had conflicts before. [`src/components/features/trips/TripDayView.tsx:1437`, `:1316`, `:1729`]
- [x] [Review][Patch] AC6 lists delete among the writes that give times back, but no test proves it. Add a case next to shorten and park. [`test/dayPlanChangePastMidnight.test.ts`]
- [x] [Review][Patch] AC8's `rg` sentence ("finds only that one refusal test") contradicts Task 4's key-absence assertions. The real result is 2 refusal tests plus 4 key-absence assertions (Debug Log). Amend the AC text to what is true. [this file, AC8]
- [x] [Review][Patch] The new `planConflicts` / `planConflictByItemId` memos sit between the comment "Stable while the dialog is open…" and the `ideaDialogItem` line it describes. Move them above the comment. [`src/components/features/trips/TripDayView.tsx:646-653`]

## Dev Notes

### Copy (de / en)

| Key | de | en |
|---|---|---|
| `trips.planConflict.lateBy` | Erreichbar erst {reachable} ({late} zu spät) | Reachable only at {reachable} ({late} late) |
| `trips.planConflict.overflow` | Passt nicht mehr in den Tag | No longer fits in the day |
| `trips.planConflict.dayBadge` | Der Plan geht nicht auf · {count} | The plan doesn't work out · {count} |

`{late}` comes from `formatActivityDuration` ("40 Min", "1 Std 10 Min" / "40 min", "1 h 10 min"). Removed: `trips.plan.pastMidnight`, `trips.dayChange.checkInWarning`. Kept: `trips.dayChange.planConflict` (the notice line for a *new* late conflict, 13.1). Dictionaries are flat `"a.b.c": "…"` maps; `formatMessage` fills `{x}` (`src/i18n/index.ts`).

### Current state of what this story changes

- **`scheduleDay`** (`DS:120-167`) already does everything the read side needs: late conflicts with `reachableAt` capped at 23:59, overflow ids, null times for overflow rows, no late conflict after an overflow. **Do not change `daySchedule.ts`** apart from comments that mention "until 13.2" (`DS:138`).
- **`planDaySchedule`** (`DST:210-348`) schedules before and after the edit; its only refusal is the new-overflow block at l.294-302. `newConflicts` (l.341-345) and `toPlanConflicts` (l.389) stay for the notice.
- **Writers that refuse today** and their client handlers: see Task 3. Writers that never refused (move to another day, whole-day move/swap, suggestion apply, undo) are untouched. Suggestion apply already stores overflow rows FLEXIBLE with null times (12.4 / 13.1 §12).
- **Readers of null times** already cope: card (no pill, `TV:4442/4490`), gantt (`TripDayGanttSegments.ts:77-82` skips), print (`TripDayPrintDocument.tsx:579-581`), import validator (both null or both set). Nothing to change there.
- **The notice** is writer-only (`TV:3919`: `dayChange && canEditPlanning`). Its `warning` today joins `planConflictText` and `checkInWarningText` (`TV:3957-3966`).
- **Missing-stay treatment you copy:** overview row `TT:964-967` (`warnBorder`/`warnBgRow`), pill `TT:1042-1060`; day view `TV:4615-4722` (current-night node, `day-detail-gap-pill`). Tokens in `src/theme.ts:75-81`, exposed as `theme.palette.tokens.warnBg` / `warnBgRow` / `warnBorder` (l.237-239); `warn` = `palette.warning.main`.
- **What must be preserved:** the receipt, undo (all kinds incl. `parked`, `scheduled`, `suggestionsApplied`), the sweep, `day_plan_changed` race handling, 13.1's notice line for new late conflicts, the 400 for a fixed end after 23:59, the missing-stay treatments everywhere, the `day-row-gap-pill` testid and text.

### Sequencing with 14.4

14.4 (*One Way to Another Day*, ready-for-dev) removes the single-activity move (`moveDayPlanItemToTripDay`, the `day-plan-items/move` route and the dialog's "anderer Tag") and touches `DPIR`, `TV` and the dialogs. Whichever lands second rebases. There is no logical overlap: the move path never refused past midnight. If 14.4 is already merged when you start, skip any line reference above that points into the removed move code.

### Architecture compliance

- Conflicts derived on read by a pure function, never stored (architecture l.146). The server stays the only place that computes times; the client renders the payload (13.1 rule "the client never computes times" — it does not compute conflicts either).
- A `FIXED` activity always has both times; a `FLEXIBLE` one has them exactly when it fits.
- Receipt version stays 3 (architecture l.170 precedent).
- Error envelope `{ error: { code, message, details } }`; writer gates unchanged (`refuseUnlessTripWriter`).
- Pure modules stay free of Prisma and `server-only`.

### Testing standards

- Vitest 3, `globals`, single fork, real SQLite per worker (`test/setup.ts` runs `prisma migrate deploy`). Tests flat in `test/`, `describe` names carry "(Story 13.2 ACn)".
- Component tests: `// @vitest-environment jsdom`, `@testing-library/react` 16, `test/helpers/renderWithProviders.tsx`. Integration tests call repos and route handlers with real requests (`test/helpers/routeContext.ts`).
- Seed days as the app would write them with `test/helpers/settleSeededDay.ts` (13.1), so stored times equal the schedule.
- Red first for `planConflicts.test.ts` and the new past-midnight repo cases.

### Previous story intelligence

- 13.1: make new optional receipt fields absent when empty (not relevant here — this story adds none, only removes one). The notice counts only rows whose times changed; null counts as a change.
- 13.1 review D1: late arrival after midnight is reported with `reachableAt` 23:59. Keep it.
- 13.1 §7 and Q3: the "only a new overflow refuses" rule was the interim; it is what you delete.
- 14.1/14.2: `"+"` and park were built with the refusal arm "as delete does"; both arms go. 14.2 review: refusal tests must assert their text — the replacement *saved* tests must assert the stored null times and the card marker text, not just "no error".
- 14.2: a lost response after commit reloads the day; keep that path intact when you remove the `past_midnight` branch next to it (`TV:1645-1660`).
- Tommy checks in Safari and at 390 px.

### Git intelligence

Recent commits are one per story: `13-1: …`, `14-1: …`, `14-2: …` (`e0643cd`, `f4957e3`, `aacfd32`, `ed2da94`), each with a bullet body and the co-author line. 14.2 touched `TV`, `DPIR`, `dayPlanChangeRepo.ts`, `DCRc` and the receipt schema heavily, so re-read those around the cited lines before editing. No dependency changes are needed.

### Latest technical information (2026-10-18)

No new library and no migration. Next.js, Prisma 7.3 with `@prisma/adapter-better-sqlite3`, MUI and Vitest as pinned in `package.json`. No `@mui/icons-material` in `src`; use `TripIcons.tsx`.

### Project Structure Notes

- New: `src/lib/trips/planConflicts.ts`, `test/planConflicts.test.ts` (and optionally `test/dayPlanChangePastMidnight.test.ts`).
- No file is deleted. `src/lib/http/dayPlanPushResponses.ts` keeps `withPushConflict` and `dayChangedResponse`.

### Questions for Tommy (not blocking; the defaults above apply)

1. **The count (§4).** "Der Plan geht nicht auf · 3" counts every marked activity: each one reached late and each one that no longer fits. OK, or should a run of activities past midnight count once?
2. **No notice for a new activity that does not fit (§7).** If you add an activity that ends up past midnight, the save succeeds and the card shows "Passt nicht mehr in den Tag", but no notice appears (nothing else moved). Enough, or should the notice say it?
3. **Overview extras (§9).** The "Open items" count, the sidebar alert and the dashboard's "N Tage offen" stay about missing stays only. Should a broken plan count there too?

### References

- [epics.md — Story 13.2](../planning-artifacts/epics.md), Epic 13 section
- [sprint-change-proposal-2026-10-17.md](../planning-artifacts/sprint-change-proposal-2026-10-17.md): *Rulings superseded*, rules 5 and 6, *UX impact*, success criterion 3, decisions 3 and 4
- [architecture.md](../planning-artifacts/architecture.md): l.146 (Data Architecture), l.169-170 (receipts, Epic 14 precedent)
- [prd.md](../planning-artifacts/prd.md): FR47 (l.260)
- `ux-designs/ux-TravelPlan-2026-07-27/DESIGN.md` l.100-106, 147-148, 234-235, 265-266, 308, 336; `EXPERIENCE.md` l.81, 89, 90
- [13-1](13-1-just-say-how-long.md), [14-1](14-1-one-kind-of-entry.md), [14-2](14-2-park-it-for-another-day.md), [14-4](14-4-one-way-to-another-day.md)
- [deferred-work.md](deferred-work.md): DW-375, DW-377, DW-378, DW-394, DW-396

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (claude-opus-5-5), bmad-dev-story, 2026-10-18.

### Debug Log References

- Baseline: my first run overlapped the first edits (my mistake: I edited files while it ran), so its failure count is not a clean baseline. Its totals match 14.2's recorded end state (203 files / 3320 tests, `tsc` 0, lint 0 errors / 79 warnings), so those are the baseline used here.
- Red first: `test/planConflicts.test.ts` was turned red by stubbing `scheduleDay`'s result in `derivePlanConflicts` (4 failed), then restored (13 passed).
- Mutation checks (Task 9), each applied, run and reverted:
  1. `!overflowed` dropped in `scheduleDay` → 2 failed (`planConflicts`, `daySchedule`).
  2. Read-side previous stay from the name-checked accommodation → 1 failed (`tripDetailRoute` blank-named stay).
  3. Card marker inside `canEditPlanning` → 1 failed (viewer/contributor case).
  4. Hero count of `late` only → 2 failed (en and de hero counts).
  5. Null-timed rows left out of `changes`/`movedItems` → 4 failed (`dayPlanChangePastMidnight`, `dayPlanChangePush`).
- Final gates: 205 files / 3338 tests passed, `tsc --noEmit` 0, lint 0 errors / 79 warnings, `next build` OK, `check:migrations` passed (no migration changes). `daySchedule.ts` was unchanged at that point; it changed afterwards for the real-run ruling, see Completion Notes.
- `rg -n "past_midnight|pastMidnight|PastMidnight" src test`: no hits. `rg -n "checkInWarning|CheckInWarning" src`: no hits. In `test` it finds the two refusal tests (receipt schema and undo route) plus four "the receipt has no `checkInWarning` key" assertions. Task 4 asks for those assertions, and AC8's "only that one refusal test" cannot hold alongside them.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created (bmad-create-story, 2026-10-18).
- **Derivation (AC1, AC2).** New pure `src/lib/trips/planConflicts.ts`: `DayPlanConflict`, `derivePlanConflicts` (maps `scheduleDay`'s conflicts/overflow in day order, `lateMinutes` from `reachableAt − fromTime`), `buildScheduleInput`, and the shared pieces `toScheduleItem`, `toScheduleLeg`, `scheduleInputFor`. `getTripWithDaysForUser` computes `planConflicts` per day from the rows it already loads (no extra query), with last night's stay found by the writes' rule (nearest lower `dayIndex`, raw row, name ignored). Both day mappings in `GET/PATCH /api/trips/[id]` carry it. `planDaySchedule` and `readScheduleInputInTransaction` now build their input with the same helpers, so the read and the write cannot drift.
- **Past midnight saved (AC6, AC7).** Removed the new-overflow block and `DaySchedulePastMidnight` from `planDaySchedule` (`DaySchedulePlan` is the ok shape only, no `status` tag), every repository refusal arm (activity create/update/delete/reorder/schedule/park, leg create/update/delete, check-out), `DayPlanPushRefusal`, `TravelSegmentPastMidnight`, `refusalOf`, `pastMidnightResponse` and every route branch, and the client branches in `TripDayView` and the three dialogs. `NEW_ITEM_ID` stays because the create still uses it as a stand-in id. A row that loses its times is a change like any other: it is in `movedItems` with its previous times, and undo restores it.
- **Check-in warning removed (AC8).** Producer, `movedAnyTimes`, receipt field and type, `mapReceipt` arm, `checkInWarningText`, zod field, suggestion-apply caller, and the notice's second line are all gone. The receipt stays v3, and a v3 receipt carrying the field gets 400 at the undo route (new test).
- **UI (AC3-AC5, AC9).** The card `plan-conflict` line sits in the card body after the title, outside every planning gate. The hero pill `day-hero-plan-conflict` sits in the title block under the date. The overview row takes the warn state for `isGap || hasPlanConflict`, the stay column keeps `isGap`, and the pill `day-row-plan-conflict-pill` shares the extracted `dayRowWarnPillSx` with `day-row-gap-pill`. Copy is per the table and uses `formatActivityDuration`.
- **One addition beyond the task list:** an optimistic delete reloads the day when the day had conflicts, as it already did when rows moved. Without the reload, deleting a late booking that moved nothing would leave the hero count stale until the next load.
- **Questions Q1-Q3:** the defaults are implemented (count = marked activities, no notice for a created row that does not fit, overview extras unchanged). Tommy has not answered them yet.
- **Real run passed (Tommy, 2026-10-18)** on the New Zealand trip in `dev.db`, in Safari and at 390 px. Covered: late ferry and overflow (day 39), switching fixed to flexible (days 1, 7, 9, 11), undo and shortening past midnight, delete, park and "+", viewer, check-in, the overview row and 390 px. It produced one ruling (see the next note).
- **Finding without a code change:** the orphaned legs Tommy saw on day 11 (Hobbiton → Te Waihou, 41 min) are pre-existing data from the 16.10. import/restore. They were not created by the fixed→flexible switch, which changes no order and no leg. The read-only scan found the same kind of orphan on 16 days. 11.1's sweep leaves orphans that a write did not create, by design. Tommy chose to leave both the old orphans and the rule as they are for now. The proposal (sweep every undrawn leg on each write, in the receipt so undo restores it, plus a one-off cleanup and an import filter) is parked.
- **Real-run ruling (Tommy, 2026-10-18): the day start never makes a booking late.** A 00:00–12:30 booking on day 1, with no stay the night before, was reported "9 Std zu spät" against the assumed 09:00 start. `scheduleDay`'s late check now reads `busyUntil`, the end of the last activity actually on the day. A fixed row with nothing before it is never late, even with a leg from last night's stay. Overlapping bookings and a flexible row placed before a booking still report. No computed time changes. This reverses 13.1's "fixed first row the day start cannot reach" case; `daySchedule.test.ts` has 6 new cases and `planConflicts.test.ts` has Tommy's case. The marker and the 13.1 notice line both follow the new rule. After the change: 205 files / 3344 tests, `tsc` 0, lint 0/79.
- Ledger: DW-377 and DW-378 are closed as moot. DW-375 and DW-394 are annotated (the refusal half is gone; the rest stays open).

### File List

- `travelplan/src/lib/trips/planConflicts.ts` (new)
- `travelplan/src/lib/trips/daySchedule.ts` (real-run ruling)
- `travelplan/test/daySchedule.test.ts`
- `travelplan/src/lib/repositories/tripRepo.ts`
- `travelplan/src/app/api/trips/[id]/route.ts`
- `travelplan/src/lib/repositories/dayScheduleTransaction.ts`
- `travelplan/src/lib/repositories/dayPlanItemRepo.ts`
- `travelplan/src/lib/repositories/travelSegmentRepo.ts`
- `travelplan/src/lib/repositories/accommodationRepo.ts`
- `travelplan/src/lib/repositories/daySuggestionApplyRepo.ts`
- `travelplan/src/lib/trips/dayChangeReceipt.ts`
- `travelplan/src/lib/validation/dayChangeReceiptSchemas.ts`
- `travelplan/src/lib/http/dayPlanPushResponses.ts`
- `travelplan/src/app/api/trips/[id]/day-plan-items/route.ts`
- `travelplan/src/app/api/trips/[id]/day-plan-items/park/route.ts`
- `travelplan/src/app/api/trips/[id]/day-plan-items/schedule/route.ts`
- `travelplan/src/app/api/trips/[id]/day-plan-items/reorder/route.ts`
- `travelplan/src/app/api/trips/[id]/travel-segments/route.ts`
- `travelplan/src/app/api/trips/[id]/accommodations/route.ts`
- `travelplan/src/components/features/trips/TripDayView.tsx`
- `travelplan/src/components/features/trips/TripTimeline.tsx`
- `travelplan/src/components/features/trips/TripDayPlanDialog.tsx`
- `travelplan/src/components/features/trips/TripAccommodationDialog.tsx`
- `travelplan/src/components/features/trips/TripDayTravelSegmentDialog.tsx`
- `travelplan/src/i18n/en.ts`
- `travelplan/src/i18n/de.ts`
- `travelplan/test/planConflicts.test.ts` (new)
- `travelplan/test/dayPlanChangePastMidnight.test.ts` (new)
- `travelplan/test/helpers/settleSeededDay.ts`
- `travelplan/test/tripDetailRoute.test.ts`
- `travelplan/test/dayPlanChangePush.test.ts`
- `travelplan/test/dayPlanChangeReorder.test.ts`
- `travelplan/test/dayPlanChangeLegPush.test.ts`
- `travelplan/test/dayPlanChangeStayPush.test.ts`
- `travelplan/test/dayPlanChangeUndo.test.ts`
- `travelplan/test/dayChangeReceipt.test.ts`
- `travelplan/test/daySuggestionApplyRoute.test.ts`
- `travelplan/test/travelSegmentDialog.test.tsx`
- `travelplan/test/tripAccommodationDialog.test.tsx`
- `travelplan/test/tripDayPlanDialog.test.tsx`
- `travelplan/test/tripDayViewDayChange.test.tsx`
- `travelplan/test/tripDayViewLayout.test.tsx`
- `travelplan/test/tripDayViewReorder.test.tsx`
- `travelplan/test/tripTimelinePlan.test.tsx`
- `travelplan/test/tripTimelineRoles.test.tsx`
- `_bmad-output/implementation-artifacts/deferred-work.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`

### Change Log

- 2026-10-18: Implemented Story 13.2. Plan conflicts are derived on read and shown on the cards, the day hero and the overview row. The past-midnight refusal and the check-in warning are removed, and the receipt stays v3. All gates are green.
- 2026-10-18: Real-run ruling: the day start never makes a booking late (`scheduleDay` late check via `busyUntil`; no time changes).
- 2026-10-18: Real run passed; status review.
- 2026-10-18: Code review (bmad-code-review): 5 patches applied (uncapped `lateMinutes`, reload when a write changes the day's conflicts, AC6 delete test, AC8 wording, memo placement), 0 deferred, 13 dismissed. Status done.
