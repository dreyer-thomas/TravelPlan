---
baseline_commit: d9f96be1e647d87fe2f51a4ca4b5c9cb2a06a768
---

# Story 13.1: Just Say How Long

Status: in-progress

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As someone filling a day,
I want to give each activity only how long I want to spend there,
so that the app works out every start and end from the check-out and the travel times, and I never add up times again.

**FRs covered:** FR42 (rewritten), FR46. **Depends on:** Epic 11 (receipt, undo, sweep, `action-notice`; done), Epic 12 (done). Architecture review by Winston done 2026-10-17 (architecture.md *Data Architecture* and the receipt line, both uncommitted).
Sources: [epics.md#Story 13.1](../planning-artifacts/epics.md); [sprint-change-proposal-2026-10-17.md](../planning-artifacts/sprint-change-proposal-2026-10-17.md) (*Technical impact*, rules 1–7, *UX impact*, *Decisions recorded*); [architecture.md](../planning-artifacts/architecture.md) *Data Architecture* ("Activities planned by duration") and *API & Communication Patterns* ("Day recalculation receipts"); `DESIGN.md` `schedule-mode`, time-pill lock glyph; [11-1](11-1-travel-legs-that-leave-with-their-place-in-the-day.md) (receipt, undo, sweep); [11-2](11-2-the-rest-of-the-day-moves-back-with-it.md) (push rule being replaced); [11-3](11-3-one-place-earlier-one-place-later.md) (reorder); [11-4](11-4-when-the-journey-takes-longer.md) (leg and check-out push); [12-4](12-4-take-them-over-in-visiting-order.md) (`chainTimes`, `DAY_START_WITHOUT_STAY`); DW-371, DW-372 in [deferred-work.md](deferred-work.md).

All code paths below are relative to `travelplan/`. Line numbers were read on 2026-10-17 at `cbe8f31`. Abbreviations: `TV` = `src/components/features/trips/TripDayView.tsx` (5083 lines), `PD` = `src/components/features/trips/TripDayPlanDialog.tsx` (3040 lines), `DPIR` = `src/lib/repositories/dayPlanItemRepo.ts`, `TSR` = `src/lib/repositories/travelSegmentRepo.ts`, `DCR` = `src/lib/repositories/dayPlanChangeRepo.ts`, `DPPT` = `src/lib/repositories/dayPlanPushTransaction.ts`, `DCRc` = `src/lib/trips/dayChangeReceipt.ts`. `grep` treats `tripRepo.ts` and some other repository files as binary and prints nothing, so use `grep -a`.

## Read this first: where the epic's wording collides with the code

Each item was checked against the code. Each one changes or sharpens what a task asks for. Items marked **(Q)** are defaults that Tommy should confirm; they are repeated under *Questions*.

1. **The rule as one function, and the order as a column.** Today, order is derived (`compareDayPlanItemsByStartTime`, `src/lib/trips/dayPlanItemOrder.ts:67`: `fromTime`, untimed last, then `createdAt`, then `id`) and a walk pushes rows later (`src/lib/trips/dayPlanPush.ts`: `planDayPush` l.212, `planDayReorder` l.284, `planDayPushFrom` l.368). After this story:
   - order is `sortOrder`, renumbered densely (0…n−1) per day inside every write's transaction;
   - times are the output of one pure `scheduleDay`;
   - `dayPlanPush.ts` is deleted.

   Move its shared helpers (`LAST_MINUTE_OF_DAY`, `timeToMinutes`, `minutesToTime`, `activityEndMinutes`) into the new `src/lib/trips/daySchedule.ts`. `suggestionPlan.ts` imports `minutesToTime` and `LAST_MINUTE_OF_DAY` from there.

2. **The comparator keeps a tiebreak, on purpose.** The proposal says `compareDayPlanItemsByOrder` = `sortOrder`, then `id`. But 32 test files seed rows with `prisma.dayPlanItem.create(...)` directly (142 calls). With a schema default of `sortOrder = 0` they all tie, and `id` would scramble their time order. So define the comparator as: `sortOrder` ascending, then **today's start-time order as the tiebreak** (`fromTime` with untimed last, `createdAt`, `id`). Keep that logic as a private helper inside `dayPlanItemOrder.ts`. Remove the export `compareDayPlanItemsByStartTime` as the AC demands.

   In production, ties cannot occur because `sortOrder` is dense, so this deviates from the proposal only where it cannot be observed. Say so in the docblock.

3. **Schema defaults are required, and they must match the SQL.** SQLite needs a `DEFAULT` to add a `NOT NULL` column. Prisma must see the same default, or `prisma migrate diff` drifts and every direct test seed fails to compile. Use these defaults:
   - `scheduleMode DayPlanItemScheduleMode @default(FIXED)`
   - `durationMinutes Int @default(15)`
   - `sortOrder Int @default(0)`

   Every production write path sets all three explicitly. The defaults exist only for seeds and for the `ALTER TABLE`.

4. **"`durationMinutes` (≥ 5)" cannot hold for every existing row.** `prisma/dev.db` has one activity from 08:00 to 08:01. The AC's whole-DB invariance forbids changing its times, and architecture says a fixed row's duration equals `toTime − fromTime`. **Default (Q1):** the minimum of 5 is an **input** rule, in the zod schema for the dialog and API. The migration stores the true difference, here 1, and there is no DB `CHECK` constraint.

5. **Legacy time shapes.** These shapes are untimed, half-timed (only one of the two times), and `toTime ≤ fromTime`. `dev.db` has none of them: 76 rows, all valid. The import validator rejects the last two (`tripImportSchemas.ts:454-480`), but suggestion apply creates untimed rows past midnight (12.4).

   **Default (Q2):** a row counts as *timed* only when both times are readable and `toTime > fromTime`. Every other row becomes `FLEXIBLE` with 15 minutes. This matches the proposal's "every untimed activity", which is widened to "not validly timed". It also closes DW-371, whose walk only existed for those shapes.

   Inside `scheduleDay`, a `FIXED` row without two readable times is scheduled **as if flexible** (defensive; it can only come from a seed). The repository normalises it to `FLEXIBLE` on the next write of its day.

6. **The migration gives untimed rows times only where they fit.** Architecture: "untimed rows … appended after the day's last end without leg times; `scheduleDay` … normalises such a day on its next write". Precisely:
   - start = the latest `to_time` among the day's timed rows, or `10:00` when the day has none;
   - each untimed row in old comparator order takes `start + 15·k` to `start + 15·(k+1)`;
   - a row whose end would pass `23:59` keeps both times `NULL`.

   That `NULL` is the 13.2 state *does not fit in the day*. It already exists today (12.4 overflow), and every reader already handles it.

7. **Midnight in this story: refuse only a *new* overflow (Q3).** The AC keeps today's `day_plan_past_midnight` refusal until 13.2. But `scheduleDay` already applies rule 5 (overflowing flexible rows get `null` times), because 13.2 needs exactly that. A day can already hold rows that do not fit (item 6, 12.4 overflow). A blanket refusal would make every write on such a day fail.

   **Rule:** compute the schedule of the day **before** the write (same inputs, no edit) and **after** it. Refuse with `409 day_plan_past_midnight`, naming the first such row, only if some flexible row has times in the *before* schedule (or is the edited or created row) and `null` times in the *after* schedule. Rows that were already `null` stay `null` and never block. The refusal is decided **before the first write**, as in 11.2 (§7 of its *Read this first*: the bucket conversion deletes a row inside the transaction).

8. **Leg delete has no transaction, no recompute and no receipt today** (`TSR:601-621`), but the AC lists it. Give it the same shape as the other writes:
   - a transaction;
   - the before/after schedule;
   - a receipt with a **new `edited` kind `legDeleted`** `{ segmentId, previous: TravelSegmentRow }`.

   Undo re-creates the leg with its old id and stamps. If the pair exists again, `P2002` is already mapped to `stale`, as for removed legs. The kind must be added everywhere a `never` default forces it (see Task 5).

   The only UI that deletes a leg is `handleRemoveOrphanSegment` (TV:1186). An orphan leg is never drawn, so it never changes the schedule. Wire its receipt through `takeDayChangeReceipt` anyway (it will normally be dropped as side-effect-free). There is no other leg-delete UI to change.

9. **Delete and both check-out directions now move rows.** Today, delete runs no push (`DPIR:801`), and the check-out push runs only for a *later* check-out and skips a next day whose first row is untimed (`accommodationRepo.ts:386-412`). After this story:
   - both recompute;
   - an earlier check-out pulls flexible rows earlier;
   - the receipt on a check-out change still names the **next** day (`tripDayId` = that day), as in 11.4.

10. **Reorder (*Nach oben / Nach unten*) must change in this story, because `planDayReorder` is removed.** The minimal rule, which 13.3 then dresses up:
    - a reorder swaps the two rows' `sortOrder`, recomputes and sweeps;
    - it is offered only on a **FLEXIBLE** row, with any neighbour;
    - a `FIXED` row is refused server-side as `409 day_plan_not_reorderable` (the code exists) and gets no up/down in the menu (`canMoveUp`/`canMoveDown`, TV:4285-4286, today based on `fromTime`).

    13.3 adds the menu's explanatory line for fixed rows, *Einfügen nach*, *Alle flexibel machen*, and the move-to-day recompute. A swap does **not** re-place a fixed neighbour by time (rule 4 applies only when a row *becomes* fixed or its fixed start changes).

11. **Move to another day (6.7, 6.23, transfer, swap) is 13.3's, except for `sortOrder` (Q4).** These paths run no push today (`DPIR:903`, `:958`, `:1004`). Here, they only keep the invariant on both days:
    - on the target day, a moved `FLEXIBLE` row gets the next `sortOrder` at the end, and a `FIXED` row is placed by its start (`placeFixedItem`, item 13);
    - both days are renumbered densely.

    **No recompute** in 13.1. A flexible row moved to another day keeps its old times until that day's next write. Record this as a known interim gap that 13.3 closes.

12. **Suggestion apply stays as 12.4 except for the new columns (Q5).** 13.4 turns suggestions into flexible activities and deletes `chainTimes`/`planStartMinute`. Here, `applySuggestionsForTripDay` (`daySuggestionApplyRepo.ts:244`):
    - writes each timed row as `FIXED` with `durationMinutes = toTime − fromTime`;
    - writes each overflow row (`null` times) as `FLEXIBLE` with its rounded suggested duration;
    - appends `sortOrder` in visiting order after the day's current last row;
    - runs **no** `scheduleDay`.

    So the epic's "a suggestion without a chosen position → a flexible one is appended" is delivered by 13.4, not here. Bucket-list take-over follows the normal create.

13. **"Placed by time", precisely (rule 4).** A row that is created `FIXED`, switched to `FIXED`, or whose `FIXED` start changes is placed by a pure `placeFixedItem`:
    - remove the row from the order;
    - schedule the rest;
    - insert the row after the last row whose **computed** start is ≤ the row's start, or at position 0 if there is none;
    - rows with `null` computed times count as later than everything.

    It never refuses. This replaces `day_plan_before_predecessor` (`dayPlanPushResponses.ts:28`, `PD:1659`, `trips.plan.beforePredecessor`). Remove that code path and its key from both dictionaries, because nothing can produce it any more.

    A `FIXED` edit that keeps the same start, and every `FLEXIBLE` edit, keeps the row's position. A new `FLEXIBLE` row is appended.

14. **Old-shape payloads stay valid.** Many route and repository tests post `{ fromTime, toTime }` without a mode. The schema treats a payload **without** `scheduleMode` as `FIXED` with those times. That keeps the 11.x suites' payloads valid and makes every pre-existing scenario a fixed-activity scenario, which is exactly what the migration makes of real data.

15. **Conflicts in the notice.** `ActionNotice` takes one `warning?: string` (`src/components/ui/ActionNotice.tsx:22`), filled today by `checkInWarningText` (TV:3800-3821). The receipt gains an optional, signed, undo-ignored `planConflicts: Array<{ itemId; title; fromTime; reachableAt }>`, holding only conflicts that are **new** with this write (the item had no conflict before, or is reached later than before).

    A new `planConflictText(receipt, t)` joins one sentence per conflict with `" · "`. The notice shows it before the check-in warning, joined the same way. `receiptHasSideEffects` (DCRc:291) becomes true when `planConflicts` is non-empty; otherwise a plain create that runs into a ferry would show no notice.

    The check-in warning itself stays until 13.2 removes it. `findCheckInWarningForOrderInTransaction` (DPPT:141) is fed the new order.

16. **The receipt goes to version 3, and moved rows include renumbered ones.** Dense renumbering after a delete or a placement changes `sortOrder` (and `updatedAt`) of rows whose times did not change. Undo must restore them, and staleness must cover them.

    So `movedItems` lists every row whose `fromTime`, `toTime` **or** `sortOrder` changed, each with `previousSortOrder` in addition to today's fields. `DayPlanItemSnapshot` (used by `updated` and `deleted`) gains `scheduleMode`, `durationMinutes` and `sortOrder`, so undo of an edit or a delete restores mode and duration.

    The **notice count** ("3 Aktivitäten verschoben") counts only rows whose **times** changed, never the edited row. A reorder keeps 11.3's rule of excluding the swapped pair. `dayChangeReceiptSchema` takes `z.literal(3)`; a v2 receipt is `400` (receipts are client-held and short-lived).

17. **Day start, one helper.** `planStartMinute` (`daySuggestionApplyRepo.ts:153`) and the push code each resolve it today. Move `DAY_START_WITHOUT_STAY = "09:00"` from `suggestionPlan.ts:28` into `src/lib/trips/stayTimes.ts`, and add `resolveDayStartMinute(previousStay: { checkOutTime: string | null } | null): number`. Last night's stay is the accommodation of the nearest lower `dayIndex` day (the `buildSegmentTimelineInTransaction` query, TSR:252-262). If that day has no accommodation, or there is no earlier day, the result is 09:00. `planStartMinute` keeps its own first branch (latest timed end) until 13.4 and calls the helper for the rest.

18. **Which legs count.** A leg counts only if it is **drawn**, meaning its two endpoints are consecutive in the day's timeline (`daySegmentPairs.ts:44-73`, last night's stay → rows in `sortOrder` → tonight's stay). In practice that means:
    - between rows `i−1` and `i`, a leg from `i−1` to `i`;
    - for the first row, a leg from last night's stay to it.

    If several legs share a pair, the first one read wins (today's `buildLegMinutes`, `dayPlanPush.ts:116`). Leg create and update evaluate the **new** leg value, as `planPushFromInTransaction`'s `legOverride` does today (DPPT:189).

## Acceptance Criteria

1. **Migration.** One migration, `prisma/migrations/20261017120000_add_day_plan_item_schedule/migration.sql`, hand-written SQL only:
   - adds `schedule_mode TEXT NOT NULL DEFAULT 'FIXED'`, `duration_minutes INTEGER NOT NULL DEFAULT 15` and `sort_order INTEGER NOT NULL DEFAULT 0`;
   - sets every validly timed row (both times `HH:MM` with `to > from`) to `FIXED` with `duration_minutes = to − from` in minutes;
   - sets every other row to `FLEXIBLE`/15, with times per *Read this first* §6;
   - sets `sort_order = ROW_NUMBER() OVER (PARTITION BY trip_day_id ORDER BY <old comparator>) − 1`, so untimed rows land after timed ones in their former relative order;
   - adds the index `idx_day_plan_items_trip_day_sort_order` on `(trip_day_id, sort_order)`, not unique.

   `fromTime`/`toTime` stay nullable. `schema.prisma` declares enum `DayPlanItemScheduleMode { FLEXIBLE FIXED }` and the three fields with the defaults of §3. `npx prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma` reports no difference. `npm run check:migrations` passes, so no older migration is touched.
2. **Migration invariance.** A migration test applies every earlier migration to a fresh SQLite file, seeds rows, applies the new one, and asserts:
   - for each day whose rows were all timed: every column of every `day_plan_items` row except the three new ones is exactly as before (whole-table `toEqual`), every row is `FIXED` with the right duration, and `sort_order` follows the old comparator;
   - untimed rows (and §5's shapes) become `FLEXIBLE`/15 with appended times, and keep `NULL` times where they pass 23:59;
   - `sort_order` is dense per day.
3. **Recompute on every write.** Each of these writes recomputes the affected day with `scheduleDay` inside its own transaction and stores only the rows that changed:
   - activity create (including bucket take-over), update and delete;
   - travel leg create, update and delete;
   - last night's stay's check-out change, in either direction (recomputes the next day);
   - reorder.

   The schedule:
   - the day starts at `resolveDayStartMinute` plus the drawn leg from last night's stay to the first row;
   - a `FLEXIBLE` row starts at the cursor plus the drawn leg from its predecessor and lasts `durationMinutes`, and the cursor moves to its end;
   - a `FIXED` row keeps its times, and the cursor moves to `max(cursor, its end)`.
4. **Pull forward.** When a flexible row's predecessor gets shorter or is deleted, or its leg gets shorter or is deleted, or the check-out moves earlier, it and the flexible rows after it move earlier. No gap is ever left before a flexible row. A gap before a fixed row stays, as waiting time.
5. **Collisions warn and never refuse.** A row is in conflict when it is reached late, meaning `cursor + leg > fromTime`. This happens when a flexible chain reaches a fixed row late, or when two fixed rows overlap. In either case the save succeeds, the fixed row does not move, and the receipt's `planConflicts` names each *new* conflict (§15). The notice shows "Fähre beginnt um 12:00, erreichbar erst um 12:40".
6. **Midnight (until 13.2).** A write that would leave a previously timed flexible row (or the created one) without room before 23:59 is refused as `409 day_plan_past_midnight` with today's details `{ itemId, itemTitle }`, and nothing is written (§7). Rows that already did not fit stay untimed and do not block, including on their own edit (Tommy, review 2026-10-17).
7. **Fixed placement.** A row that becomes `FIXED`, or whose `FIXED` start changes, is placed by `placeFixedItem` (§13). No save is refused for its position. `day_plan_before_predecessor`, its response helper, the dialog's branch and `trips.plan.beforePredecessor` are removed.
8. **Dialog.** *Wann & Wo* starts with a `schedule-mode` toggle, *Flexibel* / *Feste Zeit*. *Flexibel* is the default for every new activity, including a bucket take-over.
   - *Flexibel* shows one duration in hours and minutes, prefilled with 1 h for a new activity, and the read-only line "Voraussichtlich 11:20 – 12:20". The line uses the row's stored times when the row is flexible and timed; otherwise it reads "wird nach dem Speichern berechnet".
   - *Feste Zeit* shows the start and a small switch *Ende* / *Dauer*, with the matching field.
   - An empty duration (both boxes empty) saves as 15 minutes. A duration under 5 minutes is a field error.
   - A fixed end must be after the start and not past 23:59, including one computed from start plus duration. Otherwise it is a field error.
9. **Mode switch keeps the duration.**
   - Fixed → flexible: the duration field takes `toTime − fromTime` (from the current inputs if they are valid, otherwise from the stored row).
   - Flexible → fixed: start and end take the row's currently computed times (stored times; empty for a new or untimed row), and the duration is kept for the *Dauer* form.
   - The server stores `durationMinutes = toTime − fromTime` for every `FIXED` write.
10. **Placement of new rows.** A new `FLEXIBLE` activity (dialog or bucket take-over) is appended at the end of the day. A new `FIXED` one is placed by time (AC7). Suggestion apply: §12.
11. **Time pill.** A flexible row's pill shows its stored (computed) times, as today. A fixed row's pill shows a 12 px lock glyph in `ink-soft` before the times. The lock comes from a new `LockIcon` in `TripIcons.tsx` and carries an accessible label "Feste Zeit". A row without times shows no pill, as today.
12. **Receipt v3 and undo.**
   - The receipt lists every row whose times or `sortOrder` the write changed, each with `previousFromTime`, `previousToTime`, `previousSortOrder`, `previousUpdatedAt` and `updatedAt`.
   - `updated` and `deleted` snapshots carry mode, duration and `sortOrder`.
   - The notice reports "3 Aktivitäten verschoben" (rows whose times changed, never the edited one).
   - *Rückgängig* restores the day exactly, proven by a whole-DB `toEqual` for create, update (both mode switches), delete, leg create, update and delete, a check-out change (both directions) and reorder.
   - Undo refuses with `409 undo_stale` if any named row has changed since.
   - A v2 receipt is `400`.
13. **One order everywhere.** `compareDayPlanItemsByOrder` (§2) is the only comparator. These all read `sortOrder` through it:
    - the trip payload (`getTripWithDaysForUser`, `tripRepo.ts:1253`);
    - print and the document packet (`getTripDayPrintPayloadForUser`, `tripRepo.ts:1605`);
    - `listDayPlanItemsForTripDay` (`DPIR:515`);
    - the segment timeline and sweep (`TSR:269`);
    - the check-out path (`accommodationRepo.ts:411`);
    - the suggestion context and apply (`tripRepo.ts:3891`, `daySuggestionApplyRepo.ts:119,337`);
    - the day view (TV:1066-1093) and the overview gantt (`TripTimeline.tsx:835-840`);
    - **`getDayRoutePointsForUser`** (`tripRepo.ts:3682-3776`). It orders by `createdAt` today, a bug; fetch the rows and sort them with the comparator.

    The API payloads that carry day plan items include `scheduleMode`, `durationMinutes` and `sortOrder`. `compareDayPlanItemsByStartTime` no longer exists.
14. **One pure rule.** `scheduleDay` and `placeFixedItem` live in `src/lib/trips/daySchedule.ts` (no Prisma, no clock). `planDayPush`, `planDayReorder`, `planDayPushFrom` and `dayPlanPush.ts` are gone. Unit tests cover:
    - day start from a stored check-out, from the 10:00 default, and from 09:00 without a stay;
    - a stay leg counted, and an undrawn leg ignored;
    - a flexible chain;
    - pull-forward on shortening and on delete;
    - a fixed row kept with waiting time before it;
    - a late arrival at a fixed row;
    - two overlapping fixed rows;
    - placement by time (including ties and a `null`-time row);
    - overflow past 23:59 (rule 5);
    - a FIXED row without times scheduled as flexible (§5);
    - idempotence (scheduling a scheduled day changes nothing);
    - the proposal's success criteria 1 and 2 verbatim.
15. **Import keeps the invariant.** A backup import, which today carries no schedule fields, gives each imported row `scheduleMode`, `durationMinutes` and `sortOrder` by the migration's rule, through one pure TS helper with the same cases as the migration test. (13.4 adds the fields to the export and the round-trip.)
16. **Dictionaries.** `en.ts` and `de.ts` carry every new key in the *Copy* table, and `trips.plan.beforePredecessor` is gone from both. `test/i18nDictionaries.test.ts` stays green.

## Tasks / Subtasks

- [x] **Task 0: Baseline** (all AC)
  - [x] The planning artifacts for Epics 13 and 14 are uncommitted (`epics.md`, `prd.md`, `architecture.md`, `DESIGN.md`, `EXPERIENCE.md`, both 2026-10-17 proposals, `sprint-status.yaml`, this file). Commit them first, as their own commit, and leave `.env` out (as in 12.4). Set `baseline_commit` in this file's frontmatter.
  - [x] Run the full suite, `tsc --noEmit` and lint, and record the counts. 12.4 ended at 192 files / 3180 tests, lint 0 errors / 80 warnings.
- [x] **Task 1: `scheduleDay` and `placeFixedItem`, test first** (AC 3, 4, 5, 7, 14)
  - [x] Create `src/lib/trips/daySchedule.ts`:
    - Move `LAST_MINUTE_OF_DAY`, `timeToMinutes`, `minutesToTime` and `activityEndMinutes` here from `dayPlanPush.ts`.
    - Types: `ScheduleItem = { id; title: string | null; scheduleMode: "FLEXIBLE" | "FIXED"; durationMinutes: number; fromTime: string | null; toTime: string | null }`, and `ScheduleLeg = { fromKey: string; toKey: string; durationMinutes: number }`, where a key is an item id or the stay's accommodation id.
  - [x] `scheduleDay({ dayStartMinute, previousStayId, items /* in sortOrder */, legs })` returns `{ rows: Array<{ id; fromTime: string | null; toTime: string | null }>, conflicts: Array<{ itemId; title; fromTime; reachableAt }>, overflow: string[] }`.
    - A conflict's `reachableAt` is `cursor + leg` as `HH:MM`.
    - Once a flexible row overflows, every later flexible row has `null` times (rule 5), and its id is in `overflow`.
    - A fixed row whose reachable minute would be past 23:59 (it comes after an overflow) is **not** reported as a late-arrival conflict. The overflow already describes that day, and 13.2 shows it. So `reachableAt` is always a valid `HH:MM`. Test this case.
  - [x] `placeFixedItem({ ...same input, itemId })` returns the new index (§13).
  - [x] Rewrite `test/dayPlanPush.test.ts` as `test/daySchedule.test.ts`, covering every case in AC14. Keep the factory style (`item(...)`, `leg(...)`, string assertions such as `"b 11:30–12:30"`). Run it red first.
- [x] **Task 2: Day start and order helpers** (AC 3, 13)
  - [x] Add `DAY_START_WITHOUT_STAY` and `resolveDayStartMinute` to `stayTimes.ts` (§17), with cases in `test/stayTimes.test.ts`. `suggestionPlan.ts` re-imports the constant.
  - [x] Add `compareDayPlanItemsByOrder` to `dayPlanItemOrder.ts` (§2) and remove the `compareDayPlanItemsByStartTime` export. `DayPlanItemOrderable` gains `sortOrder: number`. Update `test/dayPlanItemOrder.test.ts`.
  - [x] Switch every consumer listed in AC13 to the new comparator, and add `sortOrder` to each Prisma `select` that feeds it. Fix `getDayRoutePointsForUser`, and add a case to `test/tripDayRoute.test.ts` in which `createdAt` order differs from `sortOrder`.
- [x] **Task 3: Schema and migration** (AC 1, 2)
  - [x] Add the enum and fields to `schema.prisma` (§3) and the index. Generate the migration with `npx prisma migrate dev --create-only --name add_day_plan_item_schedule`, then replace its body with hand-written SQL in the style of `20260308173000_add_cost_payment_sort_order` (`WITH ranked AS (... ROW_NUMBER() ...) UPDATE ...`), with `--` comments that explain §4–§6.
    - Minutes from `HH:MM`: `CAST(substr(t,1,2) AS INTEGER)*60 + CAST(substr(t,4,2) AS INTEGER)`.
    - Back to text: `printf('%02d:%02d', m/60, m%60)`.
    - Check how Prisma 7 with the better-sqlite3 adapter stores `created_at` in this DB (text or integer), and order by it accordingly so the result matches the TS comparator.
  - [x] Write `test/migrationDayPlanItemSchedule.test.ts`. No migration test exists yet, so this one sets the pattern.
    - Create a temporary file DB with `better-sqlite3` (already a dependency of the adapter).
    - `exec` every `prisma/migrations/*/migration.sql` before the new one, in name order.
    - Insert raw rows: two all-timed days (one with rows created out of time order), one mixed day, and one day near midnight with untimed rows.
    - Snapshot, `exec` the new migration, and assert AC2.
  - [x] Run `prisma migrate diff` (AC1) and `npm run check:migrations`.
  - [x] Run the migration on a copy of `prisma/dev.db` and confirm that all 76 rows keep their times (`sqlite3` before/after diff of `id, from_time, to_time`). Do not migrate `dev.db` itself without asking Tommy.
- [x] **Task 4: Transaction helper replacing the push** (AC 3–7, 12)
  - [x] Rename `DPPT` to `src/lib/repositories/dayScheduleTransaction.ts`, or rewrite it in place.
    - Keep `DayPlanChangedError` and `buildReceipt`, now with version 3 and `planConflicts`.
    - Replace `readPushInputInTransaction`, `applyPushMovesInTransaction`, `planPushFromInTransaction` and `findCheckInWarningInTransaction`'s input.
  - [x] Add `readScheduleInputInTransaction(tx, tripId, tripDayId)`, which reads:
    - the rows with `id, title, scheduleMode, durationMinutes, fromTime, toTime, sortOrder, createdAt, updatedAt`, sorted with the comparator;
    - last night's stay (`id`, `checkOutTime`);
    - the legs that touch the day.
  - [x] Add `planScheduleInTransaction(input, edit)`. It is pure apart from the read: it applies the edit to the in-memory order (insert, update, remove, swap, leg override or check-out override), places a fixed row if needed, schedules **before** and **after**, and returns:
    - `{ status: "ok", order, changes, newConflicts }`, or
    - `{ status: "past_midnight", item }` (§7).
  - [x] Add `applyScheduleChangesInTransaction(tx, tripDayId, planned, now)`. It writes `fromTime`, `toTime`, `sortOrder`, `updatedAt` (and normalises `FIXED` without times to `FLEXIBLE`, §5) with the existing optimistic `updateMany where { id, tripDayId, updatedAt }` → `DayPlanChangedError`. It returns `MovedItemRow[]` for every changed row except the edited one.
- [x] **Task 5: Receipt v3** (AC 12, 5)
  - [x] `DCRc`:
    - `version: 3`;
    - `MovedItemRow` gains `previousSortOrder`;
    - `DayPlanItemSnapshot` gains `scheduleMode`, `durationMinutes`, `sortOrder`;
    - new `edited` kind `legDeleted`;
    - optional `planConflicts`.

    Update `mapReceipt`, `summarizeDayChangeReceipt` (count time changes only, §16), `receiptHasSideEffects`, and the new `planConflictText`.
  - [x] `src/lib/validation/dayChangeReceiptSchemas.ts`: `z.literal(3)`, the new fields, and the `legDeleted` branch.
  - [x] `DCR`:
    - `findInvalidity`: add the `legDeleted` kind.
    - Phase 1 staleness: covers every moved row.
    - Phase 2: restores `fromTime`, `toTime`, `sortOrder`, `updatedAt` for moved rows. `updated` restores mode and duration from the snapshot, and `deleted` recreates them. `legDeleted` re-creates the leg.
    - Phase 3 (drawn legs): reads the order by `sortOrder`.

    Each `switch` over `edited.kind` ends in a `never` default, so the compiler finds every place.
  - [x] `test/dayChangeReceipt.test.ts`: round-trip v3, refuse v2, test the counts and `planConflictText`.
- [x] **Task 6: Rewire the write paths, one at a time, each with its route tests** (AC 3–7, 10, 12)
  - [x] **Activity create and bucket take-over** (`DPIR:519`, `:597`): FLEXIBLE is appended, FIXED is placed; then sweep, receipt, conflicts. `NEW_ITEM_ID` stays as the stand-in for the new row before it has an id.
  - [x] **Activity update** (`DPIR:699`): handles mode switches, placement on fixed start change, and the `previous` snapshot with the new fields.
  - [x] **Activity delete** (`DPIR:801`, `deleteDayPlanItemInTransaction` l.458): new recompute with pull-forward; moved rows go into the receipt.
  - [x] **Reorder** (`DPIR:841`, `day-plan-items/reorder/route.ts`): swap `sortOrder` (FLEXIBLE only, otherwise `not_reorderable`), recompute, sweep (§10).
  - [x] **Leg create, update and delete** (`TSR:497`, `:538`, `:601`). Recompute with the leg override; no sweep on leg writes (rule 12 in 11.4). Leg delete gets the new transaction, receipt and route response `{ data: { deleted: true, receipt? } }` (§8). Drop the old "push only if the duration grew" guard (TSR:561-566): every leg change recomputes.
  - [x] **Check-out change** (`accommodationRepo.ts:386`, PATCH route): recompute the next day in both directions; drop the "untimed first row" and "only later" guards.
  - [x] **Move to another day, transfer, swap** (`DPIR:903`, `:958`, `:1004`): `sortOrder` placement and renumbering of both days only (§11).
  - [x] **Suggestion apply** (`daySuggestionApplyRepo.ts`): the new columns only (§12).
  - [x] **Import** (`tripRepo.ts:2747-2768`): one pure `legacyScheduleFields(items)` helper sets the three fields (AC15), with cases mirroring the migration test in `test/tripImport*.test.ts`.
  - [x] Remove `day_plan_before_predecessor` from `dayPlanPushResponses.ts` (keep `pastMidnightResponse`, `withPushConflict`, `dayChangedResponse`), and delete `dayPlanPush.ts`.
- [x] **Task 7: API schema and payloads** (AC 8, 9, 13)
  - [x] `dayPlanItemSchemas.ts`: `dayPlanItemMutationSchema` accepts `scheduleMode?: "FLEXIBLE" | "FIXED"`, `durationMinutes?: int`, and times that are optional for FLEXIBLE.
    - **Missing mode** means FIXED with both times required (§14).
    - **FLEXIBLE**: `durationMinutes` int 5–1439, default 15 when omitted; any times sent are ignored.
    - **FIXED**: `fromTime` is required, plus `toTime` or `durationMinutes`. `toTime` wins if both are sent. The end must be > start and ≤ 23:59; otherwise the field error goes on `toTime` or `durationMinutes`. The server derives the stored duration.
  - [x] Cases go in `test/dayPlanItemSchemas.test.ts`.
  - [x] Add the three fields to the day plan item mappers: `src/app/api/trips/[id]/route.ts:103-104,244-245`, `day-plan-items/route.ts:74-75,193-194,293-294`, and the `tripRepo.ts` payload types and mapping (1253-1263, print payload).
- [x] **Task 8: Dialog** (AC 8, 9, 16)
  - [x] `PD`: add `scheduleMode`, `durationHours`, `durationMinutes` and `fixedEndKind` (`"end" | "duration"`) to the state. Add them to `PlanFormValues` (l.473), `planFormFingerprint` and the seed effect (l.1005-1070), or the discard guard misses them.
    - Seeds: edit takes the row's mode and duration (a fixed one splits `toTime − fromTime`); add and bucket prefill take FLEXIBLE with 1 h.
  - [x] The toggle sits at the top of the *Wann & Wo* panel (l.2552). Copy the `ToggleButtonGroup exclusive fullWidth` pill pattern from `TripDaySuggestionsDialog.tsx:511-548`, which ignores `null` on re-press. Apply DESIGN.md `schedule-mode`: input height and radius, selected segment in `accentSoft` with `ink` at weight 700.
  - [x] Add `data-testid="plan-schedule-mode"` and `plan-expected-times`.
  - [x] For the duration pair, reuse the hours/minutes boxes from `TripDayTravelSegmentDialog.tsx:770-816`. Move `splitMinutesToDuration` and `combineDurationToMinutes` (l.132, l.159) into a shared pure module (e.g. `src/lib/trips/durationInput.ts`) and import them in both dialogs. The leg dialog's behaviour and tests must stay unchanged. For an activity, both boxes empty means 15, not invalid.
  - [x] Keep the existing native `type="time"` inputs for *Feste Zeit*, because the tests drive them (comment l.2561).
  - [x] Payload (l.1557):
    - FLEXIBLE sends `{ scheduleMode, durationMinutes }`;
    - FIXED sends `{ scheduleMode, fromTime, toTime }` or `{ scheduleMode, fromTime, durationMinutes }`.
  - [x] Map the `validation_error` field `durationMinutes` to the duration pair, and add `durationMinutes: "whenWhere"` to `PLAN_ERROR_TAB` (l.159) and `PlanFieldErrors` (l.130).
  - [x] Remove the `day_plan_before_predecessor` branch (l.1659).
  - [x] `test/tripDayPlanDialog.test.tsx` mocks `@mui/material` wholesale (DW-53). Add `ToggleButton` and `ToggleButtonGroup` to that mock with minimal faithful behaviour (aria-pressed, onChange with value). Add cases for the default mode, the 1 h prefill, an empty duration giving 15, under 5 giving an error, the switch in both directions, both expected-times lines, and both fixed forms.
- [x] **Task 9: Day view** (AC 11, 5, 10, 13)
  - [x] Client item types (TV:693 area and the payload types) gain `scheduleMode`, `durationMinutes` and `sortOrder`. Sort with `compareDayPlanItemsByOrder` (TV:1066-1093, `TripTimeline.tsx:835-840`).
  - [x] Time pill (TV:4337): `LockIcon` before the times for FIXED. Add `LockIcon` to `TripIcons.tsx` in the existing `SvgIcon` style (aria-hidden), and put the label "Feste Zeit" on the pill via a visually hidden span or `aria-label`.
  - [x] Set `canMoveUp` and `canMoveDown` (TV:4285-4286) by `scheduleMode === "FLEXIBLE"` with a neighbour present (§10).
  - [x] Notice (TV:3800-3821): `warning` = `planConflictText` and `checkInWarningText`, joined with `" · "` and omitted when both are empty.
  - [x] `handleRemoveOrphanSegment` (TV:1186) passes a returned receipt to `takeDayChangeReceipt`.
  - [x] Tests: extend `tripDayViewDayChange.test.tsx` (conflict warning), `tripDayViewReorder.test.tsx` (no up/down on a fixed row, available on a flexible row next to a fixed one) and `tripDayViewLayout.test.tsx` (lock on a fixed pill, none on a flexible one).
- [x] **Task 10: Rewrite the Epic 11 suites against the new rule** (all AC)
  - [x] These suites keep their scenarios and change their expectations only where pull-forward, placement or the removed refusal apply:
    - `dayPlanChangePush.test.ts`, `dayPlanChangePushConflict.test.ts`
    - `dayPlanChangeReorder*.test.ts`
    - `dayPlanChangeLegPush*.test.ts`, `dayPlanChangeStayPush.test.ts`
    - `dayPlanChangeSweep*.test.ts`, `dayPlanChangeUndo.test.ts`
    - `suggestionsApplyUndo.test.ts`, `daySuggestionApplyRoute.test.ts`
    - `tripDetailRoute.test.ts:301,338`, `tripDayDocumentPacketRoute.test.ts:353`, `tripDayViewOrphanSegments.test.tsx`
  - [x] Each changed expectation gets a one-line comment naming the 13.1 rule that changed it. Do not delete a scenario.
  - [x] Add to `dayPlanChangeUndo.test.ts` the whole-DB `toEqual` cases from AC12 (its `databaseState()` at l.99 also needs the new columns, which it gets for free from `findMany`).
  - [x] Add one end-to-end repo test for the proposal's success criteria 1–3 and 5: check-out 09:00, a 30-minute stay leg, flexible activities of 1 h, 2 h and 30 min with 20-minute legs, reading 09:30–10:30, 10:50–12:50 and 13:10–13:40; shortening the second to 1 h gives 12:10–12:40; a fixed ferry at 12:30 after the chain gives a conflict (12:30, not 12:00: at 12:00 rule 4 places it before the third activity; Tommy, review 2026-10-17), its time unchanged and the save succeeding; one undo restores everything.
- [x] **Task 11: i18n** (AC 16): add the *Copy* table to both files and remove `trips.plan.beforePredecessor`.
- [ ] **Task 12: Gates and the real run**
  - [x] Full suite, `tsc --noEmit` 0, lint 0 errors (warnings no higher than the baseline), `check:migrations`, `next build`.
  - [x] Mutation checks (8.9 discipline). Make each change, run, and revert it; each must turn a test red:
    1. Drop the leg in the flexible start.
    2. Keep the cursor at the fixed row's end instead of `max(cursor, end)`.
    3. Refuse every overflow instead of only new ones.
    4. Order the route points by `createdAt` again.
    5. Leave `previousSortOrder` out of undo phase 2.
    6. Swap a FIXED row on reorder.
  - [ ] Real run with Tommy on the dev server, after he agrees to migrate `dev.db`:
    - the migration leaves every visible time unchanged;
    - a new flexible activity is computed;
    - shortening pulls rows forward;
    - a fixed ferry collision shows the warning;
    - undo works;
    - the dialog is checked at 390 px.
  - [x] Close DW-371 (the walk is gone). Leave DW-372 open, but re-read it: a new row before a moved one now renumbers it and makes undo stale; a row appended after it does not.

### Review Findings

Code review 2026-10-17 (Blind Hunter, Edge Case Hunter, Acceptance Auditor), uncommitted changes on `d9f96be`.

- [x] [Review][Decision] A fixed booking reached only after midnight is never reported — resolved (Tommy): report it with `reachableAt` capped at 23:59; became a patch.
- [x] [Review][Decision] An edited row that already had no times does not refuse its own save — resolved (Tommy): keep the code's reading; AC6 amended.
- [x] [Review][Decision] Success criterion 3 was changed from a 12:00 ferry to 12:30 — resolved (Tommy): 12:30 accepted; Task 10 amended.
- [x] [Review][Patch] A fixed booking reached after midnight raises a conflict, with `reachableAt` capped at 23:59 (D1) [src/lib/trips/daySchedule.ts:140]
- [x] [Review][Patch] `planStartMinute` does not call `resolveDayStartMinute` (§17) [src/lib/repositories/daySuggestionApplyRepo.ts:166]
- [x] [Review][Patch] The print payload is missing `scheduleMode` and `durationMinutes`, and does not map `sortOrder` (AC13, Task 7) [src/lib/repositories/tripRepo.ts:1460,1617]
- [x] [Review][Patch] Switching flexible → fixed keeps the old inputs for a new or untimed row instead of clearing them (AC9) [src/components/features/trips/TripDayPlanDialog.tsx:1473]
- [x] [Review][Patch] Orphan-leg delete takes the receipt but does not reload when it moved times; on a migrated day the first write recomputes, so the screen keeps stale times [src/components/features/trips/TripDayView.tsx:1348]
- [x] [Review][Patch] An activity delete refused with `day_plan_past_midnight` shows only the generic error, not the `pastMidnight` text with the title [src/components/features/trips/TripDayView.tsx:1620]
- [x] [Review][Patch] The client lets a flexible duration over 23:59 (up to 999 h) through; the server then returns the English "Duration must end within the day" [src/components/features/trips/TripDayPlanDialog.tsx:1527]
- [x] [Review][Defer] Undoing a delete after a later create duplicates `sortOrder` (DW-372 family) [src/lib/repositories/dayPlanChangeRepo.ts] — deferred, pre-existing
- [x] [Review][Defer] Undo does not restore `scheduleMode` on a row normalised to FLEXIBLE (only reachable from a seed) [src/lib/repositories/dayScheduleTransaction.ts:373] — deferred, pre-existing
- [x] [Review][Defer] Creating, copying or deleting last night's stay does not recompute the next day; only a check-out change does [src/lib/repositories/accommodationRepo.ts:296,521,630] — deferred, pre-existing
- [x] [Review][Defer] The edited or created row's write is unconditional, and rows inserted concurrently are outside the read set, so `sortOrder` can collide [src/lib/repositories/dayScheduleTransaction.ts:366] — deferred, pre-existing

## Dev Notes

### Copy (de / en)

| Key | de | en |
|---|---|---|
| `trips.plan.scheduleModeLabel` | Planung | Scheduling |
| `trips.plan.scheduleModeFlexible` | Flexibel | Flexible |
| `trips.plan.scheduleModeFixed` | Feste Zeit | Fixed time |
| `trips.plan.durationHoursLabel` | Dauer (Std.) | Duration (h) |
| `trips.plan.durationMinutesLabel` | Dauer (Min.) | Duration (min) |
| `trips.plan.durationEmptyHint` | Leer lassen = 15 Min. | Leave empty for 15 min |
| `trips.plan.durationTooShort` | Mindestens 5 Minuten. | At least 5 minutes. |
| `trips.plan.durationInvalid` | Bitte eine gültige Dauer eingeben. | Please enter a valid duration. |
| `trips.plan.fixedEndKindEnd` | Ende | End |
| `trips.plan.fixedEndKindDuration` | Dauer | Duration |
| `trips.plan.fixedEndsAfterMidnight` | Endet nach Mitternacht. | Ends after midnight. |
| `trips.plan.expectedTimes` | Voraussichtlich {range} | Expected {range} |
| `trips.plan.expectedAfterSave` | wird nach dem Speichern berechnet | calculated after saving |
| `trips.dayChange.planConflict` | {title} beginnt um {start}, erreichbar erst um {reachable} | {title} starts at {start}, reachable only at {reachable} |
| `trips.dayView.fixedTimeLabel` | Feste Zeit | Fixed time |

`{range}` is "11:20 – 12:20" (en dash with spaces). An empty title uses `trips.plan.untitledActivity`. The dictionaries are flat `"a.b.c": "…"` maps, and `formatMessage` fills `{x}` (`src/i18n/index.ts`). The key `trips.plan.pastMidnight` stays until 13.2.

### Current state of what this story changes

- **Push walk** (`dayPlanPush.ts`, 396 lines) only ever moves rows later and stops at the first row that fits or is untimed. `planDayReorder` swaps the times of a pair. `planDayPushFrom` starts after an item or after the check-out, with a stand-in row `"\u0000checkout"`. All of it goes; the new rule has no stop condition, only one forward pass.
- **Write sequence today** (each pushing write, one `prisma.$transaction`, decided before the first write):
  1. `readDrawnSegmentKeysInTransaction`
  2. the write
  3. `applyPushMovesInTransaction`
  4. `sweepNoLongerDrawnSegmentsInTransaction` (TSR:319)
  5. `findCheckInWarningInTransaction`
  6. `buildReceipt`
  7. the route signs it (`signDayChangeReceipt`, `dayChangeReceiptSignature.ts:49`) and `withPushConflict` maps `DayPlanChangedError` to `409 day_plan_changed`.

  **Keep this shape.** Only steps 3 and 5 change their input.
- **Receipt** is HMAC-signed, client-held, never stored, at version 2 with eight `edited` kinds (DCRc:128). The undo route is `POST /api/trips/{id}/day-plan-changes/undo`. The repo is `undoDayPlanChangeForTrip` (DCR:488), which runs three phases (staleness, reverse, drawn-leg post-condition) and compares instants with `sameInstant`.
- **Client:**
  - `takeDayChangeReceipt` (TV:1354) keeps a receipt only if it has side effects.
  - `handleUndoDayChange` (TV:1416) maps `undo_stale` and `unavailable`.
  - Dialogs return receipts through `onSaved(receipt)`.
  - The day reloads after every save, so the client never computes times. Keep it that way: the dialog's "Voraussichtlich" line shows stored times only.
- **What must be preserved:**
  - 11.1's sweep and its rollback;
  - undo of every existing kind, including `suggestionsApplied` and its file unlinking after commit;
  - the `day_plan_changed` race handling;
  - the leg route preview;
  - the gantts, which read stored times only: `TripDayGanttSegments.ts:74-86` skips rows without both times;
  - print (`TripDayPrintDocument.tsx:579-581`);
  - the cost overview;
  - `TripDayMapFullPage`;
  - the export, whose order and fields stay unchanged until 13.4.

### Architecture compliance

- Duration is the source of truth for FLEXIBLE rows. `fromTime`/`toTime` are stored as the computed result, and the server recomputes them on every write that can affect them, in the same transaction.
- `FIXED` always has both times. A `FLEXIBLE` row has times exactly when it fits, and `null` means *does not fit*.
- `sortOrder` is dense per day, indexed, not unique.
- Conflicts are derived and never stored. The receipt carries only the write's *new* ones, for the notice (13.2 derives them on read).
- Zod at the API layer. The error envelope is `{ error: { code, message, details } }`.
- Writers only: `findTripDayForTripWriter` / `refuseUnlessTripWriter`, unchanged.
- SQLite, Prisma 7.3, `@prisma/adapter-better-sqlite3`. Interactive transactions default to a 5 s timeout. A day recompute writes at most one row per activity, but check a 30-row day.

### Testing standards

- Vitest 3, `globals`, single fork, real SQLite per worker (`test/setup.ts` runs `prisma migrate deploy`, so the new migration runs on every test DB). Tests sit flat in `test/`, with `describe` names carrying "(Story 13.1 ACn)".
- Component tests use `// @vitest-environment jsdom`, `@testing-library/react` 16 and `test/helpers/renderWithProviders.tsx`.
- Integration tests call repos and route handlers with real requests (`test/helpers/routeContext.ts`).
- Red first for `daySchedule`, the migration test and the receipt.

### Previous story intelligence

- 12.4: undo results pinned with `toEqual` broke when a field was added. Make new receipt fields **optional and absent when empty** (`planConflicts`), as `removedImageFiles` was.
- 12.4: legs are created only where the final timeline draws them. Since this story changes how the timeline orders (by `sortOrder`), `suggestionPlan`'s leg rule must read the same comparator.
- 11.2 §7: decide refusals before the first write, because the bucket conversion deletes a row.
- 11.x reviews left DW-372 (undo onto a newer row), DW-374 and DW-375 (client receipt races) open. Do not widen them; do not try to fix them here.
- Tommy runs the real check in Safari and wants a 390 px check of new dialog parts.

### Git intelligence

The last commits are 12.2–12.4 polish (`cbe8f31`, `23b427c`, `58b647c`, `e8dcafd`, `62cb7b7`). They use one commit per task or finding, with the message prefix `13-1: …`. No dependency changes are needed for this story: `better-sqlite3` is already installed through the adapter, so use it from the migration test.

### Latest technical information (2026-10-17)

No new library. Prisma 7.3 on SQLite stores an enum as `TEXT`, and `migrate dev --create-only` produces a file you may edit before it is applied. Never edit it once committed (`check:migrations`). SQLite has supported `ROW_NUMBER() OVER (PARTITION BY …)` since 3.25; the project pins 3.51.1.

### Project Structure Notes

- New files:
  - `src/lib/trips/daySchedule.ts`
  - `src/lib/trips/durationInput.ts`
  - `src/lib/repositories/dayScheduleTransaction.ts` (if renamed)
  - `prisma/migrations/20261017120000_add_day_plan_item_schedule/migration.sql`
  - `test/daySchedule.test.ts`
  - `test/migrationDayPlanItemSchedule.test.ts`
- Deleted: `src/lib/trips/dayPlanPush.ts`, `test/dayPlanPush.test.ts` (its cases are rewritten, not dropped).
- Pure modules stay free of Prisma and of `server-only` (the client imports `DCRc` and `dayPlanItemOrder.ts`).

### Questions for Tommy (not blocking; the defaults above apply)

1. **Short fixed rows (§4).** One existing activity lasts 1 minute (08:00–08:01). Default: keep it, and require ≥ 5 minutes only on input. Alternative: widen it to 5 minutes in the migration, which changes one visible time.
2. **Broken legacy times (§5).** Rows with only one time or with end ≤ start (none in `dev.db`) become flexible 15-minute activities at the end of the day. OK?
3. **Midnight before 13.2 (§7).** Refuse only when a write pushes an activity *newly* past midnight; activities that already do not fit stay without times and do not block saves. OK, or should 13.2 come straight after 13.1?
4. **Move to another day (§11).** A flexible activity moved to another day keeps its old times until that day's next save, until 13.3 recomputes both days. Acceptable for the gap between 13.1 and 13.3?
5. **Suggestions (§12).** Until 13.4, applied suggestions arrive as *fixed* activities with their chained times (overflow ones as flexible). OK as an interim?

### References

- [epics.md — Story 13.1](../planning-artifacts/epics.md), Epic 13 section; supersession markers on 11.2, 11.3, 11.4 and 12.4
- [sprint-change-proposal-2026-10-17.md](../planning-artifacts/sprint-change-proposal-2026-10-17.md): Technical impact, rules 1–7, success criteria, decisions 1–10
- [architecture.md](../planning-artifacts/architecture.md): Data Architecture "Activities planned by duration"; API & Communication Patterns "Day recalculation receipts"
- `ux-designs/ux-TravelPlan-2026-07-27/DESIGN.md`: `schedule-mode`, time-pill lock; `EXPERIENCE.md`: *Change with side effects*
- [11-1](11-1-travel-legs-that-leave-with-their-place-in-the-day.md), [11-2](11-2-the-rest-of-the-day-moves-back-with-it.md), [11-3](11-3-one-place-earlier-one-place-later.md), [11-4](11-4-when-the-journey-takes-longer.md), [12-4](12-4-take-them-over-in-visiting-order.md)
- [deferred-work.md](deferred-work.md): DW-216 (done), DW-371, DW-372, DW-374, DW-375, DW-53

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (`claude-opus-5-5`), bmad-dev-story, 2026-10-17.

### Debug Log References

- Baseline (Task 0, after the planning commit `d9f96be`): 192 files / 3183 tests green, `tsc --noEmit` 0, lint 0 errors / 80 warnings. (The story text said 3180; the suite had grown by 3 since 12.4.)
- After: 195 files / 3219 tests green (three new files and one deleted), `tsc --noEmit` 0, lint 0 errors / 80 warnings, `check:migrations` passed, `next build` passed.
- `prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma` reports nothing for `day_plan_items`. It still reports two redefinitions, `cost_payments` and `trip_members`, which it reports identically against the baseline schema (`git show HEAD:…/schema.prisma`): pre-existing drift, not this story's. The new columns are declared last in the model, because SQLite's `ADD COLUMN` appends and Prisma otherwise wants to redefine the table for column order.
- Migration dry run on a copy of `prisma/dev.db` (scratchpad): `id, from_time, to_time` identical before and after for all 76 rows; all 76 became `FIXED`, minimum duration 1 (the 08:00–08:01 row of §4). `dev.db` itself is **not** migrated.
- Mutation checks (each applied, run, reverted; all red): (1) drop the leg in the flexible start → 7 failures in `daySchedule.test.ts`; (2) cursor = fixed end instead of `max` → 1; (3) refuse every overflow → 1 in `dayPlanChangePush.test.ts`; (4) route points by `createdAt` → 1 in `tripDayRoute.test.ts`; (5) `previousSortOrder` left out of undo phase 2 → 11 in `dayPlanChangeUndo.test.ts`; (6) swap a FIXED row on reorder → 1 in `dayPlanChangeReorder.test.ts`.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created (bmad-create-story, 2026-10-17).
- **Defaults taken for Q1–Q5** (not yet confirmed by Tommy): the 5-minute minimum is an input rule only (Q1); legacy shapes become FLEXIBLE/15 (Q2); only a *new* overflow refuses (Q3); a move to another day only places and renumbers (Q4); suggestions apply as FIXED/overflow-FLEXIBLE (Q5).
- **Rule.** `src/lib/trips/daySchedule.ts`: `scheduleDay` (one forward pass, rules 1–3 and 5) and `placeFixedItem` (rule 4). `dayPlanPush.ts`, `dayPlanPushTransaction.ts` and `test/dayPlanPush.test.ts` are deleted; the helpers moved as asked. `resolveDayStartMinute` and `DAY_START_WITHOUT_STAY` live in `stayTimes.ts`; an unreadable stored check-out resolves to 10:00.
- **Order.** `compareDayPlanItemsByOrder` (`sortOrder`, then the old start-time order as a private tiebreak, §2) is the only comparator; every AC13 consumer uses it, and `getDayRoutePointsForUser` no longer orders by `createdAt`. The 11.4 check-out path no longer needs a comparator at all.
- **Migration.** Hand-written SQL in `20261017120000_add_day_plan_item_schedule`. I wrote it directly rather than through `prisma migrate dev --create-only`, because that command connects to and checks `dev.db`, which I was not to touch without Tommy. Rows are ordered FIXED first, then FLEXIBLE, each by the old comparator, with `julianday(created_at)` so both ISO and `CURRENT_TIMESTAMP` stamps sort by instant (Prisma 7 writes ISO text, `2026-10-16T16:10:54.700+00:00`). `test/migrationDayPlanItemSchedule.test.ts` sets the pattern for migration tests (earlier migrations `exec`ed into a temp file; FKs off for the seed) and also requires `legacyScheduleFields` (the import's TS rule, AC15) to give the same answer as the SQL. `better-sqlite3` has no type declarations installed, so the test loads it through `createRequire` with a small local type rather than adding a dev dependency.
- **Transaction.** `src/lib/repositories/dayScheduleTransaction.ts` replaces DPPT: `readScheduleInputInTransaction`, the pure `planDaySchedule(state, edit)` (named so because it takes no `tx`; the story called it `planScheduleInTransaction`), `applyScheduleChangesInTransaction`. The midnight refusal compares the schedule before and after the edit (§7); a row being created counts too. Deviation: an *edited* row that already did not fit does not refuse its own save (a title edit on it would otherwise be refused); only rows that had times before, or the new row, do.
- **Receipt v3.** `movedItems` also carries the new `fromTime`/`toTime` (beyond the AC's list) so the notice counts only rows whose times changed and `receiptHasSideEffects` ignores a pure renumbering. New kind `legDeleted`; optional `planConflicts` (absent when empty). The check-in warning still fires only after a write that moved some row's times.
- **Write paths.** Create and bucket take-over (FLEXIBLE appended, FIXED placed), update (placement only when FIXED is new or its start changed), delete (now pulls forward; may refuse `past_midnight` in the edge case where removing a row makes a stored but undrawn leg drawn; the route handles it), reorder (FLEXIBLE only, any neighbour, `not_reorderable` for FIXED), leg create/update/delete (every leg change recomputes; leg delete got a transaction, a receipt and `{ deleted, receipt }`), check-out in both directions (an unchanged resolved check-out returns no receipt; an empty next day now returns a receipt that moves nothing), moves between days (place and renumber only), suggestion apply (§12), import (`legacyScheduleFields`). The repo params keep `scheduleMode`/`durationMinutes` optional (absent = FIXED with the given times, as §14 says for the API), so existing callers compile unchanged.
- **API.** `dayPlanItemMutationSchema` takes `scheduleMode`, `durationMinutes` and optional times, with the rules of Task 7 (no transforms, because the update schema `safeExtend`s it; the repo derives `toTime` for the start + duration form). Payloads carry the three fields. `day_plan_before_predecessor`, `pushRefusalResponse` and `trips.plan.beforePredecessor` are gone.
- **Dialog.** Toggle, duration boxes (helpers moved to `src/lib/trips/durationInput.ts`, leg dialog unchanged), expected-times line from stored times only, *Ende*/*Dauer* switch that carries the value across, payload per mode, client checks for empty (15), under 5, unreadable and past-midnight durations, server `durationMinutes` errors on Wann & Wo. All four schedule values are in the dirty fingerprint.
- **Day view.** Lock glyph (`LockIcon`, 12 px, `ink-soft`) plus a visually hidden "Feste Zeit" on FIXED pills; up/down only for FLEXIBLE rows with a neighbour; the notice warning joins `planConflictText` and the check-in warning; a delete whose receipt moved rows now reloads the day (the optimistic removal could not show the pull-forward); the orphan-leg removal hands its receipt to `takeDayChangeReceipt` (which had to move above that handler to avoid a temporal-dead-zone read).
- **Tests rewritten (Task 10).** The Epic 11 suites keep every scenario. Where a scenario was about rows moving, those rows are now FLEXIBLE through the new `test/helpers/settleSeededDay.ts`, which numbers a seeded day like the migration and stores the schedule's times, so the seed is a day the app could have written. Changed expectations carry a comment naming the 13.1 rule. Notable changes: shortening and deleting now pull forward; a fixed retime past its successor is placed by time and sweeps (11.1's behaviour again); untimed rows are flexible and get times; an earlier check-out moves the next day; the 12.4 apply no longer creates the first leg when a former untimed row is the day's last row (§12 appends after it).
- **New tests.** `daySchedule.test.ts` (32), `migrationDayPlanItemSchedule.test.ts` (8), `tripImportLegacySchedule.test.ts` (6), `daySchedulePlanByDuration.test.ts` (success criteria 1–3 and 5; the ferry is booked at 12:30, because at 12:00 rule 4 places it before the third activity, computed 12:10; at 12:30 it follows the chain and is reachable at 12:40, the proposal's figure), the AC12 undo cases (both mode switches, delete, leg delete and its staleness, earlier check-out, a stale renumbered row), schema, receipt v3, dialog (11), day view (lock, conflict notice) and route-points order.
- **Ledger.** DW-371 closed. DW-372 re-read and annotated, still open.
- **Open: the real run (Task 12).** Not done: it needs Tommy's agreement to migrate `prisma/dev.db` and a session in Safari, including the 390 px check of the new dialog parts. Story stays `in-progress` until then.

### File List

New:
- `travelplan/prisma/migrations/20261017120000_add_day_plan_item_schedule/migration.sql`
- `travelplan/src/lib/trips/daySchedule.ts`
- `travelplan/src/lib/trips/durationInput.ts`
- `travelplan/src/lib/trips/legacySchedule.ts`
- `travelplan/src/lib/repositories/dayScheduleTransaction.ts`
- `travelplan/test/daySchedule.test.ts`
- `travelplan/test/daySchedulePlanByDuration.test.ts`
- `travelplan/test/migrationDayPlanItemSchedule.test.ts`
- `travelplan/test/tripImportLegacySchedule.test.ts`
- `travelplan/test/helpers/settleSeededDay.ts`

Deleted:
- `travelplan/src/lib/trips/dayPlanPush.ts`
- `travelplan/src/lib/repositories/dayPlanPushTransaction.ts`
- `travelplan/test/dayPlanPush.test.ts`

Modified:
- `travelplan/prisma/schema.prisma`
- `travelplan/src/generated/prisma/` (regenerated: `commonInputTypes.ts`, `enums.ts`, `internal/class.ts`, `internal/prismaNamespace.ts`, `internal/prismaNamespaceBrowser.ts`, `models/DayPlanItem.ts`)
- `travelplan/src/app/api/trips/[id]/route.ts`
- `travelplan/src/app/api/trips/[id]/day-plan-items/route.ts`
- `travelplan/src/app/api/trips/[id]/travel-segments/route.ts`
- `travelplan/src/app/api/trips/[id]/days/[dayId]/suggestions/apply/route.ts`
- `travelplan/src/components/features/trips/TripDayPlanDialog.tsx`
- `travelplan/src/components/features/trips/TripDayTravelSegmentDialog.tsx`
- `travelplan/src/components/features/trips/TripDayView.tsx`
- `travelplan/src/components/features/trips/TripIcons.tsx`
- `travelplan/src/components/features/trips/TripTimeline.tsx`
- `travelplan/src/i18n/de.ts`, `travelplan/src/i18n/en.ts`
- `travelplan/src/lib/http/dayPlanPushResponses.ts`
- `travelplan/src/lib/repositories/accommodationRepo.ts`
- `travelplan/src/lib/repositories/dayPlanChangeRepo.ts`
- `travelplan/src/lib/repositories/dayPlanItemRepo.ts`
- `travelplan/src/lib/repositories/daySuggestionApplyRepo.ts`
- `travelplan/src/lib/repositories/travelSegmentRepo.ts`
- `travelplan/src/lib/repositories/tripRepo.ts`
- `travelplan/src/lib/trips/dayChangeReceipt.ts`
- `travelplan/src/lib/trips/dayPlanItemOrder.ts`
- `travelplan/src/lib/trips/printDocuments.ts`
- `travelplan/src/lib/trips/stayTimes.ts`
- `travelplan/src/lib/trips/suggestionPlan.ts`
- `travelplan/src/lib/validation/dayChangeReceiptSchemas.ts`
- `travelplan/src/lib/validation/dayPlanItemSchemas.ts`
- Tests: `dayChangeReceipt`, `dayPlanChangeLegPush`, `dayPlanChangeLegPushConflict`, `dayPlanChangePush`, `dayPlanChangeReorder`, `dayPlanChangeReorderConflict`, `dayPlanChangeStayPush`, `dayPlanChangeSweep`, `dayPlanChangeUndo`, `dayPlanItemOrder`, `dayPlanItemSchemas`, `daySuggestionApplyRoute`, `stayTimes`, `tripDayDocumentPacketRoute`, `tripDayPlanItemsRoute`, `tripDayRoute`, `tripDetailRoute` (`.test.ts`); `tripDayPlanDialog`, `tripDayViewDayChange`, `tripDayViewLayout`, `tripDayViewLegPush`, `tripDayViewOrphanSegments`, `tripDayViewReorder` (`.test.tsx`), all under `travelplan/test/`
- `_bmad-output/implementation-artifacts/deferred-work.md` (DW-371 closed, DW-372 note)
- `_bmad-output/implementation-artifacts/sprint-status.yaml`

### Change Log

- 2026-10-17: Planning artifacts for Epics 13 and 14 committed (`d9f96be`); story started.
- 2026-10-17: Tasks 1–11 and the Task 12 gates done: schedule rule, stored order, migration, receipt v3, every write path, dialog, day view, tests, dictionaries. Real run with Tommy outstanding.
- 2026-10-17: Code review (Blind Hunter, Edge Case Hunter, Acceptance Auditor). Decisions D1–D3 resolved by Tommy: AC6 and Task 10 amended, and the after-midnight conflict added. 7 patches applied with 5 new tests: 195 files / 3224 tests, tsc 0, lint 0/80. DW-392 to DW-395 deferred. Status stays in-progress until Task 12 (the real run) and Q1–Q5.
