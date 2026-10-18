---
baseline_commit: 624bcb5b51fd5520e189f91aeb486d88666b4090
---

# Story 13.4: Suggestions and Backups Speak in Durations

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As someone taking over AI suggestions or restoring a backup,
I want them to arrive as flexible activities with their durations,
so that they behave like everything else on the day.

**FRs covered:** FR45 (amended), FR46. **Depends on:** Story 13.1 (done). 13.2 and 13.3 are done. 14.3 (*Park the Suggestions Too*, backlog) depends on this story and extends the same apply (see *Leave room for 14.3*).

Sources: [epics.md#Story 13.4](../planning-artifacts/epics.md) (l.4136); [sprint-change-proposal-2026-10-17.md](../planning-artifacts/sprint-change-proposal-2026-10-17.md) (l.40, 42, 63, 65; rule 5 l.104); [prd.md](../planning-artifacts/prd.md) FR45 (l.307), FR46 (l.259); [architecture.md](../planning-artifacts/architecture.md) *Data Architecture* "Activities planned by duration" and *API & Communication Patterns* "Parking and scheduling" (l.170: receipt v3, new behaviour needs no bump); [13-1](13-1-just-say-how-long.md) §12, §15, §17; [13-2](13-2-when-the-plan-doesnt-work-out.md); [13-3](13-3-putting-the-day-in-order.md) (the newest plan-kind pattern: `makeFlexible` / `converted`); [12-4](12-4-take-them-over-in-visiting-order.md) (the apply being rewritten).

All code paths below are relative to `travelplan/`. Line numbers were read on 2026-10-18 at `624bcb5`. Re-read them; they drift. Abbreviations:

| Short | Path |
|---|---|
| `DS` | `src/lib/trips/daySchedule.ts` |
| `DST` | `src/lib/repositories/dayScheduleTransaction.ts` |
| `SAR` | `src/lib/repositories/daySuggestionApplyRepo.ts` |
| `SP` | `src/lib/trips/suggestionPlan.ts` |
| `SAS` | `src/lib/validation/daySuggestionApplySchemas.ts` |
| `PRV` | `src/app/api/trips/[id]/days/[dayId]/suggestions/preview/route.ts` |
| `APL` | `src/app/api/trips/[id]/days/[dayId]/suggestions/apply/route.ts` |
| `DCR` | `src/lib/repositories/dayPlanChangeRepo.ts` (undo) |
| `TR` | `src/lib/repositories/tripRepo.ts` |
| `TIS` | `src/lib/validation/tripImportSchemas.ts` |
| `LS` | `src/lib/trips/legacySchedule.ts` |
| `SD` | `src/components/features/trips/TripDaySuggestionsDialog.tsx` |

**Search caveat:** plain `grep` treats `tripRepo.ts` and some other repositories as binary and prints nothing. Use `grep -a` or `rg`.

## Read this first: decisions this file takes

Each item was checked against the code. Items marked **(Q)** are defaults for Tommy to confirm; they are repeated under *Questions*.

### Part A: suggestions

1. **What exists today (13.1 §12, interim).** `applySuggestionsForTripDay` (`SAR:255-384`) computes times with `chainTimes` (`SP:84-112`) from `planStartMinute` (`SAR:164-168`, the latest timed end, else the day start). It writes each chained row as **FIXED** at those times, each overflow row as FLEXIBLE with null times, and appends `sortOrder` after the day's last row. It runs **no** `scheduleDay`. The preview (`PRV:140-144`) runs the same `chainTimes`. Three faults follow, and this story removes all three:
   - `chainTimes` rounds each **start** up to 5 minutes; `scheduleDay` does not. After the next write to the day, the times change.
   - The chain starts after the last **timed** row, and the first leg leaves from it (`lastTimed`, `SAR:126-133`). But the rows are appended after the last row **of any kind**. With an untimed row at the end (an overflow row since 13.2), the first leg is never drawn and is not created. `daySuggestionApplyRoute.test.ts:190-213` pins this as the interim behaviour ("13.4 rewrites the apply").
   - Applied rows are FIXED, so they do not move when the day changes. The epic wants them FLEXIBLE.

2. **One planner for preview and apply: a new plan kind.** Add to `ScheduleEdit` (`DST:138-162`):
   ```ts
   /**
    * Story 13.4. Applied suggestions: each item FLEXIBLE, appended in the given order after the day's last
    * row; `legs` are put first so they win their pair, as a leg save's are.
    */
   | { kind: "append"; items: ScheduleItem[]; legs: ScheduleLeg[] }
   ```
   In `planDaySchedule`: `items.push(...edit.items)`, `legs = [...edit.legs, ...state.legs]`, and record the ids in a new `appendedIds` set. In the result loop (`DST:308-336`), rows in `appendedIds` go to a new field **`appended: PlannedRow[]`** on `DaySchedulePlan` (empty for every other kind), never to `changes`. This copies 13.3's `converted` (`DST:194-195, 214-215, 313-316`). Update the exhaustive switch. `edited` stays `null` for this kind. **Do not change `daySchedule.ts`.**

3. **The planner itself** lives in `SAR`, so both routes call one function:
   ```ts
   export const planSuggestionAppend = (
     state: ScheduleDayState,
     durations: number[],                    // already rounded (point 4)
     legMinutes: (number | null)[],          // the leg *into* each suggestion, from the preview
   ): DaySchedulePlan
   ```
   - Stand-in ids: `` `\u0000suggestion:${index}` `` (the `NEW_ITEM_ID` idea, `dayPlanItemRepo.ts:487`). No stored leg can name them.
   - Items: `{ id, title: null, scheduleMode: "FLEXIBLE", durationMinutes, fromTime: null, toTime: null }`.
   - Legs: the leg into stand-in `i` comes from `i − 1`'s stand-in. For `i = 0` it comes from **the day's last row** (`state.rows.at(-1)?.id`), or from last night's stay (`state.previousStay?.id`) when the day is empty, or from nothing (trip start, no stay). Add a leg only when its minutes are known **and** its `from` key exists. `scheduleDay` counts the leg into row 0 only from `previousStayId`, and into row `n` only from row `n − 1` (`DS:146-147`), so this matches what it reads.
   - The result's `appended[i]` gives the times and `sortOrder` of suggestion `i`.

4. **Duration.** One helper in `SP`, reusable by 14.3:
   ```ts
   /** Story 13.4. A suggestion's stored duration: rounded up to five minutes, inside the activity range. */
   export const suggestionDurationMinutes = (minutes: number) =>
     Math.min(MAX_ACTIVITY_DURATION_MINUTES, Math.max(MIN_ACTIVITY_DURATION_MINUTES, ceilToFive(minutes)));
   ```
   `suggestionSchema` bounds it to 10-600 (`daySuggestionSchemas.ts:75`), so the clamp is only a guard. `ceilToFive` stays. Import the two limits from `dayPlanItemSchemas.ts` as `SAR` already does (`SAR:23-26`); check that the import adds no cycle (`dayPlanItemSchemas` must not import `SP`).

5. **Remove `chainTimes` and `planStartMinute`** (AC). `ChainedTimes` is used by `SAS:2, 110` as the preview row type. Rename it `SuggestionTimes` (`{ fromTime: string; toTime: string }`) in `SP` and use it in `SAS`. Remove `timedEndMinute` from `SuggestionPlanContext` and the `chainTimes` describe block from `test/suggestionPlan.test.ts` (keep `ceilToFive`; add cases for `suggestionDurationMinutes`). The unused imports `LAST_MINUTE_OF_DAY`, `minutesToTime`, `activityEndMinutes`, `timeToMinutes` go wherever they become unused (lint will name them).

6. **The context follows the day's last row, not the last timed one.** In `readPlanContext` (`SAR:89-151`), `lastTimed` becomes **`lastItem`**: the last row in `compareDayPlanItemsByOrder`, timed or not (an overflow row counts). `planOrderingOrigin`, `planFirstLegPoint`, `planOrigin` and `planFirstLegFrom` (`SAR:175-203`) read `lastItem` exactly as they read `lastTimed` today. The fallbacks stay: a last row without a place has an unknown first leg (no fallback); ordering then falls back to last night's stay, then the trip start. Update the module docblock (`SAR:35-62`): "The chain starts when the last timed activity has ended …" is no longer true.

7. **The basis: `startTime` goes, the planned times join the fingerprint.** Apply recomputes from the day as it stands in its transaction. The basis exists so that what lands is what the preview showed (12.4 item 9), and a repeated apply is refused. New rule:
   - `planBasis(context, plan)` returns `{ afterItemId: context.lastItem?.id ?? null, fingerprint }`. The fingerprint keeps `items:`, `from:`, `order:` and `end:`, and adds `times:` followed by the planned rows joined by `,`, each `HH:MM-HH:MM`, or `-` for a row that does not fit.
   - `suggestionPlanBasisSchema` (`SAS:53-60`, `.strict()`) loses `startTime`. The fingerprint's max of 512 still holds: at most 8 rows (`MAX_SUGGESTIONS`) × 12 chars is about 100, plus about 150 for the rest. Raise it to 1024 if a test with long ids says otherwise.
   - Apply: plan, then compare `planBasis(context, plan)` with the request's basis; any difference throws `DayPlanChangedError` → `409 day_plan_changed`. The dialog already re-previews on that 409 (`SD:44, 352, 390`).
   - So a change of last night's check-out, of an earlier row's duration, or of the legs between preview and apply now gives 409, where today it applied stale times. The client treats `basis` as opaque (`SD:380`), so the dialog code is unchanged. Only test fixtures carry `startTime`: `tripDaySuggestionsDialog.test.tsx:57`, `daySuggestionApplyRoute.test.ts` (several), and possibly `tripDayViewSuggestionsEntry.test.tsx`.

8. **Preview (`PRV`).** After the OSRM call, read the day with `readScheduleInputInTransaction(prisma, tripId, dayId)`. Its `tx` parameter only uses `tx.tripDay`. If `prisma` does not type-check against `TransactionClient`, narrow the parameter to `Pick<TransactionClient, "tripDay">`, as `readPlanContext` does (`SAR:64`). The route already ran `refuseUnlessTripWriter`, and the context read before it still applies the writer clause. Then call `planSuggestionAppend(state, ordered.map(s => suggestionDurationMinutes(s.durationMinutes)), legs.map(l => l?.durationMinutes ?? null))`. Answer:
   - `rows`: `plan.appended.map(r => r.fromTime && r.toTime ? { fromTime, toTime } : null)`;
   - `overflow`: `rows.some(r => r === null)`;
   - `basis`: `planBasis(planContext, plan)`.

   The `SuggestionPreview` shape keeps every field except `basis.startTime`, so `SD` renders it unchanged.

9. **Starts are no longer rounded to five minutes, on purpose.** The preview will show e.g. 10:03–11:33 where it showed 10:05–11:35. That is what `scheduleDay` stores and keeps after every later write. Durations are still rounded up to 5 (point 4).

10. **The first leg from the trip's start no longer counts (Q1).** With no stay last night and an empty day, the first leg leaves from the trip's start (`origin.kind === "tripStart"`). Today `chainTimes` counts it, but apply stores no leg for it (nothing on the day can carry it), so the next write drops it anyway. `scheduleDay` cannot see an unstored leg, so the preview and apply now start at 09:00 without it. The dialog keeps showing the leg row with its note. Change the note's text to say the leg also does not count (*Copy*), and fix the comment at `SD:782-783` ("the leg counts in the times" is no longer true).

11. **The apply transaction (`SAR:255-384`), new order:**
    1. `context = readPlanContext(tx, …)`; `null` → return `null`.
    2. `state = readScheduleInputInTransaction(tx, tripId, tripDayId)`.
    3. `durations` per point 4; `plan = planSuggestionAppend(state, durations, legs.map(…))`.
    4. `planBasis(context, plan)` ≠ request basis → `DayPlanChangedError`.
    5. `now = new Date()`; `drawnBefore = readDrawnSegmentKeysInTransaction(…)`.
    6. Create each activity: `scheduleMode: "FLEXIBLE"`, `durationMinutes: durations[i]`, `fromTime/toTime/sortOrder` from `plan.appended[i]`. Keep `createdAt: new Date(base + index)` (harmless, keeps creation order readable). Pictures as today.
    7. `movedItems = await applyScheduleChangesInTransaction(tx, tripDayId, plan.changes, now)` (point 12).
    8. Sweep as today (typically the leg last row → tonight's stay).
    9. Legs as today, each only where the final timeline draws it (`SAR:335-360`). With the first leg now from the day's last row, every known leg is drawn. Keep the guard anyway: it is cheap and protects against a stand-in mismatch.
    10. `buildReceipt(tripDayId, { kind: "suggestionsApplied", … }, removed, movedItems, { planConflicts: toPlanConflicts(plan.newConflicts) })`. Appended FLEXIBLE rows cannot make an earlier FIXED row late, so this is normally empty; pass it anyway so the receipt is honest.
    
    Remove the 13.1 §12 comment at `SAR:275-277`.

12. **The recompute may move existing rows, so `movedItems` is allowed on this kind.** Appending never changes the times of earlier rows on a *settled* day. But not every day is settled:
    - a legacy backup's import leaves FLEXIBLE rows at times the legacy rule chose, "normalised by `scheduleDay` on the day's next write" (13.1 AC1, `LS:12-14`);
    - seeded or migrated `sortOrder`s may not be dense;
    - a FIXED row without readable times is normalised to FLEXIBLE.
    
    The apply is that next write. So:
    - `DCR` `findInvalidity` (`DCR:204-211`): delete the rule `if (receipt.movedItems.length > 0) return "side effect an apply never has"` and its comment "An apply only appends: it never moves an existing activity". Add instead: no `movedItems[].itemId` may equal a created `items[].itemId` (`"applied item listed as moved"`).
    - Phase 1 (`DCR:416-419`) and phase 2 (`DCR:571-582`) already check and restore `movedItems` for every kind. Phase 2 deletes the created rows first with `deleteDayPlanItemInTransaction` (`dayPlanItemRepo.ts:582-617`), which is a plain delete with no recompute, so restoring the moved rows afterwards works. No other undo change.
    - Update the `DCR` header paragraph on 12.4 (`DCR:51-57`) with one sentence on this.

13. **Overflow follows 13.2.** Rows that do not fit get null times from `scheduleDay` (rule 5) and are stored that way. The trip payload's `planConflicts` lists them as `overflow` on the next read, and the day view reloads after apply (`TripDayView.tsx:5172-5179`, `void loadDay()`), so the markers appear with no client change. The dialog's warning `suggestions-overflow` stays.

14. **Leave room for 14.3.** 14.3 will add parked suggestions to the same apply and the same receipt. Keep `planSuggestionAppend` taking only the suggestions that go onto the day, and `suggestionDurationMinutes` exported. Build nothing for parking here.

### Part B: backups

15. **What exists today.** The export (`TR:1850ff`, builder at `TR:2294-2340`) writes each day activity without `scheduleMode`, `durationMinutes` or `sortOrder`, in `createdAt, id` order (`TR:1938-1939`). The import (`TR:2857-2880`) always runs `legacyScheduleFields` (`LS:42-91`). Parked activities already carry `scheduleMode: "FLEXIBLE"` and `durationMinutes` (14.1, `TR:500-508, 2414-2425`). `FORMAT_VERSION` is 2 (`export/route.ts:38`), and `MAX_SUPPORTED_FORMAT_VERSION` matches.

16. **Export (AC: the three fields).** Each day activity gains `scheduleMode`, `durationMinutes` and `sortOrder`:
    - Add `scheduleMode: true, durationMinutes: true, sortOrder: true` to the day-item `select` at `TR:1938ff`.
    - **`sortOrder` is exported as the activity's position in `compareDayPlanItemsByOrder` order, not the raw column.** On every real day the two are equal: dense, renumbered on every write. Seeded rows tie at `sortOrder` 0, and many tests create them with `prisma.dayPlanItem.create` (the round-trip suite's "Port, Airport, Hotel" day, `tripBackupRoundTrip.test.ts:670-690`). The raw value would export three zeros, which point 17 refuses as duplicates. The position always describes the order the app shows.
    - Keep the **array order** as it is (`createdAt, id`). The legacy rule's tiebreak reads array order as creation order, and changing it buys nothing now that `sortOrder` travels.
    - Types: `TripExportPayload["days"][number]["dayPlanItems"][number]` gains `scheduleMode: "FIXED" | "FLEXIBLE"; durationMinutes: number; sortOrder: number`. `TripExportParkedDayPlanItem` (`TR:504`) must add `"sortOrder" | "scheduleMode" | "durationMinutes"` to its `Omit` (a parked row's `sortOrder` is not carried, as its docblock says). Fix that docblock's "unlike on a day item until Story 13.4".
    - `FORMAT_VERSION` **stays 2**: the fields are additive, as travel segments, the bucket list and documents were. Add one paragraph to its docblock: a build from before this story strips the three fields (Zod drops unknown keys) and applies the legacy rule, so such a build restores every activity with its times but FIXED. Nothing is refused. That is the documented price of additive v2 growth.

17. **Import validation (`TIS`).** Add the fields to `dayPlanItemImportSchema` only, **not** to the shared `dayPlanItemImportFields` (`TIS:422-449`). The parked schema spreads those fields (`TIS:532-544`) and must not gain a `sortOrder`. Add them with `.extend(...)` before the `superRefine` at `TIS:488-490`, or as a separate object spread.
    - `scheduleMode: z.enum(["FIXED", "FLEXIBLE"]).optional()`
    - `durationMinutes: z.number().int().min(1).max(MAX_ACTIVITY_DURATION_MINUTES).optional()`. The minimum is **1**, not 5: *Alle flexibel machen* keeps a migrated 1-minute row at 1 minute (13.3 §7), and the migration makes FIXED rows of any length. 5 is an input rule for the dialog only (13.1 Q1).
    - `sortOrder: z.number().int().min(0).optional()`
    - Per day, in `tripDayImportSchema` (`TIS:546-562`, add a `superRefine`) or in the root walk (`TIS:840ff`, where each day's items are already iterated): **either every activity of the day carries all three fields, or none carries any.** Otherwise add an issue at `days[i].dayPlanItems[j]` with the message `"Schedule fields must be on every activity of a day or on none"`. Also, `sortOrder`s within a day must be distinct: `"Duplicate activity sortOrder detected: {n}"`, as images do (`TIS:154-164`).
    - The existing time checks stay: both times or none, end after start (`TIS:497-521`).

18. **Import write (`TR:2857-2880`).** Per day:
    - **No schedule fields** (a backup from before this story): `legacyScheduleFields` exactly as today. AC4's first half is already true, so pin it, do not rewrite it.
    - **With schedule fields:** a new pure helper next to `legacyScheduleFields` in `LS`, `carriedScheduleFields(items)`, with one entry per input in input order:
      - `sortOrder`: the item's rank when sorted by the carried `sortOrder` (densify: 0, 2, 7 → 0, 1, 2; already dense stays as it is).
      - `FIXED` with valid times (`hasValidTimes`, `DS:74`): FIXED, carried duration, times unchanged.
      - `FIXED` **without** two valid times: **FLEXIBLE**, carried duration, times as carried (null). This is the same normalisation every write applies (13.1 §5). A hand-edited file, or an export of a seeded row, can produce it; refusing it would refuse the round-trip suite's own seeds.
      - `FLEXIBLE`: carried duration, times as carried (null means *does not fit*, 13.2).
    - **No recompute on import**, as in 13.1. The stored times are the exported ones, which is what "round-trips exactly" requires. A hand-edited inconsistency is normalised by the day's next write, like a legacy import.
    - Update the comment at `TR:2858-2861` ("a backup carries no schedule fields until 13.4") and `LS:4-8` ("before Story 13.4, which adds the fields").

19. **What "round-trips exactly" means here.** Import gives every activity a new id and does not keep `createdAt` (`TR:2857` comment). So exactness is per day, over the ordered list of `(title, scheduleMode, durationMinutes, fromTime, toTime, sortOrder)`: export → import → export gives the same lists, and the imported rows in the database equal the source rows on those columns. Pin it on a day that has every shape: FIXED, FLEXIBLE with computed times, a FLEXIBLE 1-minute row, a FLEXIBLE overflow row with null times, and an order that differs from creation order (create C, then insert A before it, or use reorder).

### Part C: what must be preserved

20. The receipt stays v3. Undo of every kind stays as it is, including `suggestionsApplied` and its file cleanup after commit (`APL` / undo route). Keep the sweep, the `day_plan_changed` handling in `SD`, the one OSRM request per preview, picture download outside the transaction with cleanup on failure (`SAR:376-383`), the writer clause in `readPlanContext`, the import of old backups (every existing `tripImport*` and `tripBackupRoundTrip` case green), the parked export/import, and the export's byte-determinism (`tripExportRoute.test.ts`).

## Acceptance Criteria

1. **Applied suggestions are flexible and appended.** Applying selected suggestions creates each as a `FLEXIBLE` activity with its suggested duration rounded up to 5 minutes, appended in visiting order after the day's last activity, timed or not. Legs are created as today, the first one from the day's last activity (or last night's stay on an empty day). The day is recomputed through `planDaySchedule` in the same transaction. The times stored are `scheduleDay`'s: starts are not rounded.
2. **The preview shows what lands.** The preview's rows are the times `planSuggestionAppend` produces, the same function the apply runs. After an apply, each created activity's stored `fromTime`/`toTime` equals its preview row. `chainTimes` and `planStartMinute` no longer exist (`rg "chainTimes|planStartMinute" src test` is empty).
3. **A changed day is refused.** If anything that changes the planned times moved between preview and apply (last night's check-out, an earlier activity's duration, a new activity, the first leg's origin, tonight's stay), apply answers `409 day_plan_changed` and writes nothing. A second apply of the same preview is refused too.
4. **Overflow is a 13.2 conflict.** Suggestions that do not fit before 23:59 are stored FLEXIBLE with null times and their durations. The preview says so (`overflow: true`, its rows `null`), and after the apply the trip payload lists them as `overflow` conflicts.
5. **Undo restores exactly.** *Rückgängig* after an apply restores the whole database (`toEqual`), including the case where the recompute moved or renumbered existing rows, which are listed in `movedItems`. A receipt listing a created activity also as moved is refused with 400.
6. **Export carries the schedule.** Each day activity in a backup carries `scheduleMode`, `durationMinutes` and `sortOrder`, where `sortOrder` is its position in the day's order. Parked activities are unchanged. `formatVersion` stays 2. Two exports of an unchanged trip are still byte-identical.
7. **Import, old and new.** A backup without the fields imports as today: timed activities FIXED, untimed FLEXIBLE/15, order by the old comparator. A backup with the fields restores mode, duration, times and order exactly (point 19). A FIXED activity without times is restored as FLEXIBLE. A day whose activities carry the fields only partly, or carry duplicate `sortOrder`s, is refused with `400 validation_error` and nothing is written.
8. **Dictionaries.** `en.ts` and `de.ts` carry the changed key in *Copy*. `test/i18nDictionaries.test.ts` stays green.
9. **Regression.** Full suite, `tsc --noEmit` 0, lint 0 errors (warnings not above the baseline), `next build`. No schema change, no migration (`check:migrations` unchanged).

## Tasks / Subtasks

- [x] **Task 0: Baseline** (AC 9)
  - [x] Run the full suite, `tsc --noEmit` and lint, and record the counts (13.3 ended at 211 files / 3406 tests, `tsc` 0, lint 0/79).
  - [x] Add a frontmatter block with `baseline_commit`, as 13.1-13.3 have. Leave `.env` and the two deleted `prisma/dev.db.backup-*` files out of every commit (they are Tommy's working-tree changes).
- [x] **Task 1: The `append` plan kind** (AC 1, 2)
  - [x] `DST`: the `append` edit, `appended` on `DaySchedulePlan` (empty for every other kind), the exhaustive switch (§2). Update the module header list if it enumerates the kinds' callers.
  - [x] New `test/dayScheduleAppend.test.ts`: append to an empty day with a stay (the first leg from the stay counts); append after a FIXED row with waiting time; append after an overflow row (all appended rows `null`); a chain that overflows midway (rows after the first `null` are `null`); appended rows never in `changes`; an unsettled stored row (stale times or `sortOrder` 0, 5) lands in `changes`.
- [x] **Task 2: Suggestion planner, preview** (AC 1, 2, 3)
  - [x] `SP`: `suggestionDurationMinutes`; delete `chainTimes`; rename `ChainedTimes` → `SuggestionTimes` (and in `SAS`); update the module docblock (`SP:1-15`, the *Times* bullet).
  - [x] `SAR`: `lastItem` in place of `lastTimed`, remove `timedEndMinute` and `planStartMinute`, add `planSuggestionAppend` (§3), `planBasis(context, plan)` (§7), and update the docblock.
  - [x] `SAS`: `suggestionPlanBasisSchema` without `startTime`.
  - [x] `PRV`: §8. Update its docblock if it mentions the chain.
- [x] **Task 3: Apply** (AC 1, 3, 4, 5)
  - [x] `SAR` `applySuggestionsForTripDay` in the order of §11.
  - [x] `APL` docblock: "The times are recomputed from the legs sent back with the preview's own function" → the day is recomputed with the same planner.
  - [x] `DCR`: §12 (relax, add the moved-vs-created rule, header sentence).
- [x] **Task 4: Dialog copy** (Q1)
  - [x] `SD:782-783` comment; `trips.suggestions.legNotSaved` text in both dictionaries (*Copy*). No other dialog change.
- [x] **Task 5: Suggestion tests**
  - [x] `test/suggestionPlan.test.ts`: drop `chainTimes`; add `suggestionDurationMinutes` (rounds up, 600 stays 600, a multiple of five is left alone).
  - [x] `test/daySuggestionApplyRoute.test.ts`: rewrite the time expectations to `scheduleDay`'s (no rounding of starts), FLEXIBLE instead of FIXED, and drop the `basis.startTime` assertions. Rewrite `:190` ("untimed ones are ignored"): the untimed row is now the last row, the first leg leaves from it and is created. Keep `:215` (latest end: two overlapping FIXED rows, the chain starts at 18:00 plus the leg). New cases:
    - preview rows equal the stored times after the apply (AC 2);
    - a check-out change between preview and apply → 409, nothing written (AC 3);
    - an apply onto an unsettled day (seed a FLEXIBLE row with stale times, or non-dense `sortOrder`) → `movedItems` non-empty, undo → whole-DB `toEqual` the state before (AC 5);
    - overflow rows FLEXIBLE with null times and the trip payload's `planConflicts` listing them (AC 4).
  - [x] `test/suggestionsApplyUndo.test.ts`: the forged-receipt case (`:158`) gains a receipt with a created id also in `movedItems` → 400. Check that no case relies on "movedItems must be empty".
  - [x] Fixtures with `startTime`: `tripDaySuggestionsDialog.test.tsx:57`, `tripDayViewSuggestionsEntry.test.tsx` and the route suite. Update the dialog's trip-start leg-note test to the new copy.
- [x] **Task 6: Export** (AC 6)
  - [x] `TR` select, builder and types (§16); `export/route.ts` `FORMAT_VERSION` docblock paragraph.
  - [x] `test/tripExportRoute.test.ts`: the three fields on a day item; a day of three seeded rows tying at `sortOrder` 0 exports 0, 1, 2 in the comparator's order; parked items carry no `sortOrder`. Check the existing pinned shapes (`:46` type, the parked key expectations) and extend them; do not loosen them.
- [x] **Task 7: Import** (AC 7)
  - [x] `TIS` (§17). Tests in `test/tripImportSchemas.test.ts`: all-or-none per day; duplicate `sortOrder`; `durationMinutes` 0 and 1440 refused, 1 accepted; an old backup (no fields) still valid.
  - [x] `LS` `carriedScheduleFields` (§18). Cases in `test/tripImportLegacySchedule.test.ts` (or a new `test/tripImportCarriedSchedule.test.ts`): densify, FIXED kept, FIXED without times → FLEXIBLE, FLEXIBLE with null times kept.
  - [x] `TR` import write: choose the path per day.
  - [x] `test/tripBackupRoundTrip.test.ts`: a new case per §19 through the real export and import routes. Build the source day with real write paths or `settleSeededDay` (`test/helpers/settleSeededDay.ts`), so the rows have real schedule fields: a FIXED row, flexible rows with computed times, a 1-minute flexible row, an overflow row with null times, and an order different from creation order. Compare the ordered column lists of source and restored days, and of the two exports. Every existing case stays green unmodified.
- [x] **Task 8: Stale comments and i18n** (AC 8)
  - [x] `rg -n "13\.4" src` must only show unrelated hits (`proxy.ts:99` is "13.4 MB"). Known: `SAR:275`, `TR:501`, `TR:2860`, `LS:6`, and `test/tripImportLegacySchedule.test.ts:5`.
  - [x] *Copy* in both dictionaries.
- [x] **Task 9: Gates and the real run** (AC 9)
  - [x] Full suite, `tsc --noEmit` 0, lint 0 errors (≤ baseline warnings), `next build`, `check:migrations` unchanged.
  - [x] Mutation checks (apply, run, revert; each must turn a test red):
    1. `planSuggestionAppend` takes the first leg from the last *timed* row instead of the last row.
    2. Skip `applyScheduleChangesInTransaction` in the apply.
    3. Drop `times:` from the fingerprint.
    4. Export the raw `sortOrder` column instead of the position.
    5. The import ignores carried fields (always `legacyScheduleFields`).
    6. Keep the `movedItems.length > 0` refusal in `findInvalidity`.
  - [x] Real run with Tommy on the dev server (Safari, then 390 px):
    - suggestions applied to a day with activities: they appear as flexible (no lock), times follow the last activity, legs drawn, *Rückgängig* removes all of it;
    - more suggestions than fit: the extra ones show "Passt nicht mehr in den Tag", and the day hero shows the conflict;
    - change last night's check-out in a second tab between preview and *Hinzufügen*: the dialog re-previews with its note;
    - export a trip, import it as a new trip: the days look the same (lock pills, times, order); import an older backup (any `.zip` made before this story): it restores as before.

### Review Findings

Code review 2026-10-18 (Blind Hunter, Edge Case Hunter, Acceptance Auditor): 0 decision-needed, 2 patch, 0 defer, 19 dismissed. No AC violated.

- [x] [Review][Patch] `FORMAT_VERSION` docblock overstates what an older build restores: it says "every activity with its times and order, but FIXED", while the legacy rule makes an untimed (overflow) row FLEXIBLE/15 with new times and orders by the old comparator [travelplan/src/app/api/trips/[id]/export/route.ts:38-41]
- [x] [Review][Patch] Test passes the raw fixture duration to `planSuggestionAppend` instead of `suggestionDurationMinutes(...)`, which agrees with the apply only while the fixture is a multiple of five [travelplan/test/dayPlanItemTripIdConsistency.test.ts:134]

## Dev Notes

### Copy (de / en)

| Key | de | en |
|---|---|---|
| `trips.suggestions.legNotSaved` (changed) | zählt nicht und wird nicht als Fahrt gespeichert | not counted and not saved as a leg |

No other new or removed key. Dictionaries are flat `"a.b.c": "…"` maps (`src/i18n/de.ts:739`, `en.ts:804`).

### Current state of what this story changes

- **Preview:** `PRV:92-155`: context → `orderSuggestions` → one OSRM call → `chainTimes` → `{ order, rows, legs, basis, overflow, routingUnavailable, origin }`.
- **Apply:** `APL:84-100` downloads the pictures, then calls `applySuggestionsForTripDay` (`SAR:255`); `DayPlanChangedError` → `dayChangedResponse()`.
- **Plan context:** `SAR:69-151` (`SuggestionPlanContext`, `readPlanContext` through the writer clause), helpers `SAR:164-222`.
- **Schedule:** `DS:133-186` `scheduleDay`; `DST:204-345` `planDaySchedule`; `DST:352-383` `applyScheduleChangesInTransaction`; `DST:91-135` `readScheduleInputInTransaction`.
- **Undo of `suggestionsApplied`:** invalidity `DCR:204-211`, phase 1 `DCR:235-275` + moved `DCR:416-419`, phase 2 `DCR:545-562` + moved `DCR:571-582`.
- **Dialog:** `SD:761-863` renders `rows` (`times ? "from–to" : untimed`), the overflow alert, the trip-start note.
- **Export:** day items `TR:1938-1960` (select), `TR:2294-2340` (builder); parked `TR:2414-2425`; type `TR:476-497`, `TR:500-508`.
- **Import:** `TIS:422-544` (fields, day item, parked), `TIS:546-562` (day), root walk `TIS:657ff`; write `TR:2857-2880`; `LS` whole file.

### Architecture compliance

- The server is the only place that computes times; preview and apply use one planner over `planDaySchedule` → `scheduleDay` (13.1). The client still computes nothing.
- Order is `sortOrder`, dense per day, written by the plan; every write plans before its first write and writes other rows conditionally on the `updatedAt` it read (`DST` header).
- Receipts stay version 3 (architecture l.170: no bump for new behaviour). `suggestionsApplied` keeps its shape; only its invalidity rule changes.
- Conflicts stay derived on read (13.2); nothing stores one.
- Backup format: additive within v2, as every field since 2.31.

### Library / framework

No new dependency. Next.js App Router route handlers, Prisma 7.3 interactive transactions (SQLite), zod 4 (`.extend`, `superRefine`, `.strict()`), Vitest. Nothing in this story depends on a library version newer than what is installed, so no web research was needed.

### Testing standards

- Vitest, per-worker SQLite (`test/setup.ts`), `fileParallelism: false`. The suggestion suites share `test/helpers/suggestionApplyFixtures.ts` (seed, session, the three endpoints) and mock OSRM and the picture download per file (`vi.mock`).
- Seeds made with `prisma.dayPlanItem.create` default to FIXED / 15 min / `sortOrder` 0. Use `settleSeededDay(tripDayId, { flexible: [...] })` for real schedule fields, or leave a day unsettled on purpose for the AC 5 case.
- "Restores exactly" means a whole-DB `toEqual` of `databaseState()` before the write and after the undo (copy `databaseState` from `dayMakeFlexible.test.ts` or `dayPlanChangeReorder.test.ts`).
- Round-trip tests go through the real export and import routes (`tripBackupRoundTrip.test.ts` header explains why).

### Previous story intelligence

- 13.1: plan before the first write; `NEW_ITEM_ID` stand-ins; dense renumbering puts renumber-only rows into `movedItems` (they do not count in the notice); the import got `legacyScheduleFields` with the migration's cases.
- 13.2: a reload after a write is what updates the conflict markers. The apply already reloads.
- 13.3: the newest plan kind (`makeFlexible` → `converted`). Copy its shape for `append` → `appended`. Its review deferred DW-399 (race paths of the cross-day recompute); do not widen it here.
- Recurring review findings in this epic: stale line references and "until 13.x" comments, i18n keys missing in one file, notices or views that miss a reload, mutation checks that stay green because a second guard catches the same case (13.3 mutation 3). Check all of these before handing over.

### Git intelligence

Recent commits: `624bcb5` / `bae6d99` 13-3, `a65c894` 13-2, `e0643cd` 14-2, `f4957e3` 14-1. Commit messages follow `13-4: <summary>; status <status>`.

### Project Structure Notes

- No new route or component. Possible new test files: `test/dayScheduleAppend.test.ts`, `test/tripImportCarriedSchedule.test.ts` (flat in `test/`, as all others).
- `carriedScheduleFields` goes in `src/lib/trips/legacySchedule.ts` next to its sibling, so the import's two rules live in one module.

### Questions (defaults applied; Tommy to confirm)

1. **The first leg from the trip's start no longer counts in the times** (§10). Today it counts in the preview and the stored times, but is never saved, so the next write to the day drops it anyway. Default: it no longer counts, the preview still shows it, and the note reads "zählt nicht und wird nicht als Fahrt gespeichert". Alternative: do not show that leg at all.
2. **Starts are not rounded to five minutes any more** (§9). Suggestions may start at 10:03. Rounding them would make them differ from every other flexible activity and from their own times after the next write. Default: no rounding.
3. **A FIXED activity without times in a backup is restored as FLEXIBLE**, not refused (§18). Only a hand-edited file or a test seed produces one.
4. **No recompute on import** (§18): carried times are stored as they are, so the round trip is exact. A hand-edited inconsistency is fixed by the day's next write, as for a legacy import.

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (claude-opus-5-5)

### Debug Log References

- Baseline at `624bcb5`: 211 files / 3406 tests, `tsc` 0, lint 0 errors / 79 warnings. The baseline run overlapped the first `planBasis` edit, so its one failure (`dayPlanItemTripIdConsistency.test.ts:137`) was this story's in-flight change, not a pre-existing fault.
- Questions Q1-Q4: the defaults were applied as written (the trip-start leg is shown but neither counted nor stored; starts are not rounded; a FIXED row without times is restored FLEXIBLE; no recompute on import).
- After: 213 files / 3426 tests, `tsc` 0, lint 0 errors / 79 warnings (baseline), `next build` passes, `check:migrations` unchanged (no schema change, no migration).
- Mutation checks (applied, run, reverted), all red: 1 first leg from the last *timed* row → red (1 test); 2 skip `applyScheduleChangesInTransaction` → red (2); 3 drop `times:` from the fingerprint → red (3, including the behavioural check-out/duration 409 case, not only the pinned fingerprint strings; a first attempt that removed only the `times:` prefix was a wrong mutation and was redone); 4 export the raw `sortOrder` → red (4); 5 import always legacy → red (1); 6 keep the `movedItems.length > 0` refusal → red (2). The new moved-vs-created rule was also mutated on its own (rule → `null`): the signed forged-receipt case goes red.

### Completion Notes List

- Task 1: `append` edit kind and `appended` on `DaySchedulePlan` in `dayScheduleTransaction.ts`, copied from 13.3's `makeFlexible` / `converted`; the appended legs go first so they win their pair. `daySchedule.ts` unchanged. New `dayScheduleAppend.test.ts` (6 cases).
- Task 2: `suggestionDurationMinutes` in `suggestionPlan.ts`; `chainTimes` and `ChainedTimes` removed (`SuggestionTimes` in their place). In `daySuggestionApplyRepo.ts`: `lastItem` replaces `lastTimed` (the day's last row in order, timed or not), `timedEndMinute` and `planStartMinute` removed, `planSuggestionAppend` (stand-in ids `\u0000suggestion:i`, first leg from the last row, else last night's stay, else none) and `planBasis(context, plan)` with `times:` in the fingerprint; `startTime` gone from the basis schema. The preview reads the day with `readScheduleInputInTransaction(prisma, …)` (types fine without narrowing) and answers the planner's rows. `rg "chainTimes|planStartMinute" src test` is empty.
- Task 3: the apply runs §11's order: context, schedule state, plan, basis check, create FLEXIBLE rows at the planned times and `sortOrder`, `applyScheduleChangesInTransaction`, sweep, drawn legs, receipt with `movedItems` and `planConflicts`. Undo: `findInvalidity` now allows `movedItems` on `suggestionsApplied` but refuses one that names a created activity (`"applied item listed as moved"`); header sentence added. Phases 1 and 2 needed no change (AC5 case green with whole-DB `toEqual`).
- Task 4: `trips.suggestions.legNotSaved` changed in both dictionaries; the dialog comment updated. No other dialog change.
- Task 5: route suite rewritten to the schedule rule's times (09:42 instead of 09:45 etc.), FLEXIBLE, no `startTime`; the old ":190" case now pins that the untimed seed is the last row, the first leg leaves from it and is created, and the seed is normalised and listed in `movedItems`. New cases: preview rows equal stored times; check-out change and earlier-duration change → 409 with nothing written; unsettled day → `movedItems`, undo restores exactly; overflow rows FLEXIBLE with null times and listed as `overflow` in the trip payload. Undo suite: a properly signed receipt with a created id in `movedItems` → 400. No undo case relied on empty `movedItems`.
- Task 6: export carries `scheduleMode`, `durationMinutes`, `sortOrder` (position by `compareDayPlanItemsByOrder`, array order unchanged); parked type omits all three and keeps its own; `FORMAT_VERSION` stays 2 with a docblock paragraph. Export test pins the fields, the 0/0/0 seed tie exporting positions, a raw 7 exporting as 3, and parked items without `sortOrder`.
- Task 7: import schema fields on the day item only, all-or-none and distinct `sortOrder` per day (issues at `days[i].dayPlanItems[j]`); `carriedScheduleFields` next to `legacyScheduleFields`; the import write picks the path per day. A route test pins 400 `validation_error` with nothing written; a round-trip case through both real routes pins exactness on a day with FIXED, computed FLEXIBLE, a 1-minute row, an overflow row and a non-creation order (it also asserts the seeded day is one the schedule rule leaves unchanged). Every existing import and round-trip case green unmodified.
- Task 8: stale "until 13.4" comments removed (`SAR` §12 comment and docblock, `TR` parked-type docblock and import comment, `LS` header, the route test); `rg "13\.4" src` only shows `proxy.ts` "13.4 MB", an SVG path, and the new "Story 13.4" notes. The `DST` header now names the suggestion apply among its callers.
- Real run passed 2026-10-18 (Tommy, dev server, Safari and 390 px): suggestions applied flexible with the preview's times and undo, overflow markers and hero conflict, re-preview after a check-out change in a second tab, the first-day trip-start leg note, export → import as a new trip identical, an older backup restored as before.

### File List

- `_bmad-output/implementation-artifacts/13-4-suggestions-and-backups-speak-in-durations.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `travelplan/src/app/api/trips/[id]/days/[dayId]/suggestions/apply/route.ts`
- `travelplan/src/app/api/trips/[id]/days/[dayId]/suggestions/preview/route.ts`
- `travelplan/src/app/api/trips/[id]/export/route.ts`
- `travelplan/src/components/features/trips/TripDaySuggestionsDialog.tsx`
- `travelplan/src/i18n/de.ts`
- `travelplan/src/i18n/en.ts`
- `travelplan/src/lib/repositories/dayPlanChangeRepo.ts`
- `travelplan/src/lib/repositories/dayScheduleTransaction.ts`
- `travelplan/src/lib/repositories/daySuggestionApplyRepo.ts`
- `travelplan/src/lib/repositories/tripRepo.ts`
- `travelplan/src/lib/trips/legacySchedule.ts`
- `travelplan/src/lib/trips/suggestionPlan.ts`
- `travelplan/src/lib/validation/daySuggestionApplySchemas.ts`
- `travelplan/src/lib/validation/tripImportSchemas.ts`
- `travelplan/test/dayPlanItemTripIdConsistency.test.ts`
- `travelplan/test/dayScheduleAppend.test.ts` (new)
- `travelplan/test/daySuggestionApplyRoute.test.ts`
- `travelplan/test/suggestionPlan.test.ts`
- `travelplan/test/suggestionsApplyUndo.test.ts`
- `travelplan/test/tripBackupRoundTrip.test.ts`
- `travelplan/test/tripDaySuggestionsDialog.test.tsx`
- `travelplan/test/tripDayViewSuggestionsEntry.test.tsx`
- `travelplan/test/tripExportRoute.test.ts`
- `travelplan/test/tripImportCarriedSchedule.test.ts` (new)
- `travelplan/test/tripImportRoute.test.ts`
- `travelplan/test/tripImportSchemas.test.ts`

### Change Log

- 2026-10-18: Implemented via bmad-dev-story. Suggestions apply FLEXIBLE through the new `append` plan kind shared by preview and apply (`chainTimes`/`planStartMinute` removed, first leg from the day's last row, planned times in the basis, `movedItems` allowed on `suggestionsApplied` but never a created row); `legNotSaved` copy; export carries `scheduleMode`/`durationMinutes`/`sortOrder` (position), import restores them exactly or applies the legacy rule per day. Gates green.
- 2026-10-18: Real run passed; status review.
