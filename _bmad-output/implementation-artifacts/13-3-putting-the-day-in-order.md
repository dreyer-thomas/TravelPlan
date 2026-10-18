---
baseline_commit: a65c89490067f95f902dd5f1c7ee3ee85f3d350a
---

# Story 13.3: Putting the Day in Order

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As someone who has the right activities but not yet the right sequence,
I want to move flexible activities up and down, past bookings if needed, and drop a new one in where it belongs,
so that the order is mine to set and the times follow from it.

**FRs covered:** FR43 (amended). **Depends on:** Story 13.1 (done). 13.2, 14.1 and 14.2 are done; 14.4 is ready-for-dev and removes one of the move paths this story would otherwise have to touch (see *Sequencing with 14.4*).

Sources: [epics.md#Story 13.3](../planning-artifacts/epics.md); [sprint-change-proposal-2026-10-17.md](../planning-artifacts/sprint-change-proposal-2026-10-17.md) (13.3 row l.62, superseded 11.3 note l.207, decisions 7, 8, 9 l.450-452); [prd.md](../planning-artifacts/prd.md) FR43 (l.258); [architecture.md](../planning-artifacts/architecture.md) *Data Architecture* "Activities planned by duration" (l.146) and *API & Communication Patterns* "Day recalculation receipts" / "Parking and scheduling" (receipt v3; new kinds need no version bump); `ux-designs/ux-TravelPlan-2026-07-27/DESIGN.md` `schedule-mode` (l.306), `button` (l.282: destructive confirmation pair); `EXPERIENCE.md` button row (l.71: safe button names what it keeps), *Change with side effects* (l.89); [13-1](13-1-just-say-how-long.md) *Read this first* §10, §11, §13, §16; [13-2](13-2-when-the-plan-doesnt-work-out.md) §10; [14-2](14-2-park-it-for-another-day.md) (the newest write + receipt + undo pattern); [14-4](14-4-one-way-to-another-day.md); DW-375, DW-376 in [deferred-work.md](deferred-work.md).

All code paths below are relative to `travelplan/`. Line numbers were read on 2026-10-18 on the working tree at `e0643cd` plus the uncommitted 13.2 changes. Re-read them; they drift. Abbreviations:

| Short | Path |
|---|---|
| `TV` | `src/components/features/trips/TripDayView.tsx` |
| `PD` | `src/components/features/trips/TripDayPlanDialog.tsx` |
| `DS` | `src/lib/trips/daySchedule.ts` |
| `DST` | `src/lib/repositories/dayScheduleTransaction.ts` |
| `DPIR` | `src/lib/repositories/dayPlanItemRepo.ts` |
| `DCR` | `src/lib/repositories/dayPlanChangeRepo.ts` (undo) |
| `DCRc` | `src/lib/trips/dayChangeReceipt.ts` |
| `DCRS` | `src/lib/validation/dayChangeReceiptSchemas.ts` |
| `DPIS` | `src/lib/validation/dayPlanItemSchemas.ts` |

**Search caveat:** plain `grep` treats `tripRepo.ts` and some other repositories as binary. Use `grep -a` or `rg`.

## Read this first: decisions this file takes

Each item was checked against the code. Items marked **(Q)** are defaults for Tommy to confirm; they are repeated under *Questions*.

1. **Most of the reorder already exists (13.1 §10).** Today:
   - `reorderDayPlanItemForTripDay` (`DPIR:1045-1078`) swaps a FLEXIBLE row with its neighbour, **fixed or flexible**, through `planDaySchedule(state, { kind: "swap" })` (`DST:226-231`). It recomputes, sweeps the legs (`finishActivityWriteInTransaction`, `DPIR:525-550`) and returns a v3 `reordered` receipt. A FIXED row itself is refused as `409 day_plan_not_reorderable` (`DPIR:1065`).
   - The menu (`TV:4476-4478`) offers *Nach oben / Nach unten* only on FLEXIBLE rows that have a neighbour in that direction.
   - Undo of `reordered` works (`dayPlanChangeUndo.test.ts:872`).

   So AC1 is mostly a matter of **pinning** it with tests (a flexible row swapped past a fixed booking, in both directions). What is still missing for AC1/AC2 is the menu's explanatory line for fixed rows and a stale route comment (`reorder/route.ts:23-25` still lists pre-13.1 refusal reasons). **Do not rewrite the reorder.**

   A swap does **not** re-place the fixed neighbour by time (13.1 §10, rule 4 applies only when a row becomes fixed or its start changes). After *Nach oben* past a 12:00 ferry, the flexible row sits before the ferry and may make it late; that is a 13.2 conflict, shown, not refused.

2. **The fixed row's menu line.** Where a FLEXIBLE row shows *Nach oben / Nach unten*, a FIXED row shows one non-interactive line, "Feste Zeit — Platz ergibt sich aus der Uhrzeit", before *Parken*.
   - It is **not** a `MenuItem disabled`: MUI dims a disabled item to 0.38 opacity, which fails contrast, and a focusable item that does nothing is noise for keyboard users. Render a `<li role="presentation">` (e.g. `Box component="li"`) with `data-testid="day-plan-item-fixed-order-hint"`, `ink-soft` colour, `body2`, the same horizontal padding as `DAY_MENU_ITEM_SX` (`TV:854`), and the lock glyph the time pill already uses for fixed rows (13.1), `aria-hidden`.
   - Shown for every FIXED row, whatever its position. Writers only (the whole menu is `canEditPlanning`, `TV:4481`).
   - This makes DW-376 moot: the client now offers a move exactly where the server accepts one (FLEXIBLE with a neighbour). Close it in the ledger.

3. ***Einfügen nach* is a create parameter, planned inside the transaction.** There is no position parameter anywhere today (`DPIS:156`, `DPIR:631-706`); a new FLEXIBLE row is appended by `planDaySchedule`'s `insert` (`items.push`, `DST:204-208`).
   - API: `dayPlanItemMutationSchema` gains `afterItemId: z.string().min(1).nullable().optional()`. In the `superRefine` (`DPIS:175`): `afterItemId` is allowed only on a create with `scheduleMode === "FLEXIBLE"`; with FIXED or a missing mode (= FIXED, 13.1 §14) it is a 400 validation error. The PATCH path ignores the field entirely (reject it in the PATCH schema or strip it; an edit keeps its position, 13.1 §13).
   - Plan: the `insert` edit gains `afterId?: string | null`. `null`/absent → `items.push` as today. Otherwise `items.splice(indexOf(afterId) + 1, 0, item)`. FIXED inserts ignore it (they are placed by time).
   - Repo: `createDayPlanItemForTripDay` passes `afterItemId` through. **Before planning**, if `afterItemId` is set and not among `state.rows` (deleted, parked or moved meanwhile), throw `DayPlanChangedError` → `409 day_plan_changed`. Reason: the dialog listed a row the day no longer has; the existing stale handling reloads the day, which is the honest answer. Do not silently append. **(Q4)**
   - The receipt is the normal `created` receipt. Inserting in the middle moves the later flexible rows, so they land in `movedItems` and the notice reads "3 Aktivitäten verschoben" with *Rückgängig*. Undo of `created` already restores moved rows (it is the same path as a FIXED create placed mid-day). No new receipt kind.
   - Bucket "+" (14.1), suggestion apply (12.4/13.4) and the bucket-list routes are unchanged; they keep appending.

4. ***Einfügen nach* in the dialog.** `PD` gets no list of the day's activities today: its `TripDay` is `{ id, date, dayIndex }` (`PD:72-76`), props at `PD:430-459`.
   - New optional prop `dayActivities?: Array<{ id: string; title: string | null; fromTime: string | null; toTime: string | null }>`, in day order. `TV` passes its ordered plan items (the same array the cards render, already in `sortOrder` through `compareDayPlanItemsByOrder`) at the dialog render (`TV:4989-5004`).
   - Shown only when **all** hold: `mode === "create"`, a day placement (not parked), `scheduleMode === "FLEXIBLE"`, and `dayActivities.length > 0`. Not for edits (they use *Nach oben / Nach unten*), not for FIXED (placed by time), not in parked mode. **(Q3)**
   - Control: a MUI `TextField select` (same `input` height and radius as the duration field), label "Einfügen nach", `data-testid="plan-insert-after"`, in the *Wann & Wo* panel directly after the `plan-expected-times` line (`PD:2815-2819`) and before the location block (`PD:2881`). Options: first "Am Ende" (value `""`, the default), then each activity in order as "{title} · {from}–{to}"; without times just the title; an untitled one uses `trips.plan.untitledActivity`.
   - State resets to "Am Ende" each time the dialog opens. Switching to *Feste Zeit* hides the select; the payload then carries no `afterItemId`. The payload carries `afterItemId` only when the value is non-empty.
   - The "wird nach dem Speichern berechnet" line stays as it is; the client never computes times (13.1).
   - Changing the select counts as input for the discard guard, like every other field (check `useDiscardGuard`'s dirty check picks it up, or add it).
   - The dialog's existing 409 `day_plan_changed` handling covers AC3's stale case; verify it reloads and shows its stale message.

5. **Moves between days: recompute both days; the order travels with the day. (Q1)** Since 13.1 these paths re-point rows and renumber, but **never recompute times** (`DPIR:1080-1097` comment, 13.1 §11, 13.2 §10). The paths:
   - **Whole-day move** `moveDayPlanItemsBetweenTripDays` (`DPIR:1192-1238`): deletes all legs on both days, deletes the target's activities, re-points the source's, renumbers the target. The target day *becomes* the source day's list, so "appended" has nothing to append to.
   - **Whole-day swap** `swapDayPlanItemsBetweenTripDays` (`DPIR:1240-1288`): deletes all legs on both days, swaps `tripDayId`, renumbers both.
   - **Single move** `moveDayPlanItemToTripDay` (`DPIR:1117-1190`, Story 6.23): already appends a FLEXIBLE row and places a FIXED one with `placeFixedItem`; renumbers both days; no recompute. **Removed by 14.4** (see *Sequencing*).

   Rule for this story:
   - The two whole-day paths keep each day's order exactly as it travelled (13.1 §11 comments: "each day's order travels with it"). They do **not** re-place FIXED rows by time: the list was a valid order on its old day, and re-sorting the user's sequence because the day start changed would be a surprise. A fixed row that the new day start makes unreachable becomes a 13.2 conflict.
   - After the re-point and renumber, **recompute every day whose rows changed** (target for move; both for swap; source and target for the single move while it exists) inside the same transaction, with a new helper (point 6). The source day of a whole-day move is empty and needs nothing.
   - No receipt, no undo (epic: "undo for this path remains out of scope, as in Epic 11"). The responses stay as they are.
   - Since both whole-day paths delete all legs on both days, there is nothing to sweep. The single move's referencing-leg removal stays as it is; run the recompute **after** it.

6. **One recompute helper.** Add to `DST` (next to `applyScheduleChangesInTransaction`):
   ```ts
   /** Story 13.3. Recomputes a day as it now stands; no receipt. For writes without undo (moves between days). */
   export const recomputeDayInTransaction = async (tx, tripId: string, tripDayId: string, now: Date): Promise<void>
   ```
   It runs `readScheduleInputInTransaction` → `planDaySchedule(state, { kind: "none" })` → `applyScheduleChangesInTransaction(tx, tripDayId, plan.changes, now)`. It reads **after** the re-point, so the conditional writes use the `updatedAt` values it just read; a miss still throws `DayPlanChangedError`, which rolls the transfer back. Make sure the transfer route maps that to `409 day_plan_changed` (wrap the call in `withPushConflict`, `src/lib/http/dayPlanPushResponses.ts:17`) rather than a 500.

   `kind: "none"` already exists (`DST:138`) and compares against the stored rows (`DST:274-297`), so `changes` contains exactly the rows whose times or `sortOrder` differ from what `scheduleDay` now computes. Rows that no longer fit get `null` times (13.2). A row normalised to FLEXIBLE (FIXED without valid times) is written as FLEXIBLE, as for every other write.

7. ***Alle flexibel machen* is a new write with its own receipt kind.** Every existing activity became FIXED in the 13.1 migration; this is the one step that releases a whole day.
   - **Route:** `POST /api/trips/[id]/day-plan-items/make-flexible`, body `{ tripDayId }` (`dayMakeFlexibleSchema` in `DPIS`). Gate as the 14.x routes: CSRF, `requireSession`, `refuseUnlessTripWriter` (viewer 403, non-participant 404), JSON, schema, `withPushConflict(() => makeDayFlexibleForTripDay(...))`. Copy `day-plan-items/park/route.ts` for the shape. Response `ok({ receipt: signDayChangeReceipt(toDayChangeReceiptWire(receipt), { tripId, userId }) })`.
   - **Repo** `makeDayFlexibleForTripDay({ userId, tripId, tripDayId })` in `DPIR`, following park's order (14.2 §2): writer check → `not_found`; in the transaction: `readScheduleInputInTransaction`; the FIXED rows of `state.rows` (in order); none → throw `DayPlanChangedError` (the menu offers the action only when a fixed row exists, so zero means the day changed under the user); plan; `now`; `readDrawnSegmentKeysInTransaction`; write each converted row; `finishActivityWriteInTransaction` with the new edited kind.
   - **Duration of a converted row:** `toTime − fromTime` when both parse and the end is after the start, else its stored `durationMinutes`. That is `scheduleFieldsOf`'s rule (`DPIR:482-503`) and 14.2 §3's; reuse one helper rather than writing it a third time (extract `fixedDurationOf(row)` if none exists). No clamp to 5 (14.2 §3).
   - **Plan:** add a `ScheduleEdit` kind `{ kind: "makeFlexible"; itemIds: string[] }`. In `planDaySchedule` it replaces each named item with `{ ...item, scheduleMode: "FLEXIBLE", durationMinutes: <rule above> }` in place (order unchanged; no `placeFixedItem`). The converted rows are edited rows, not side effects: keep them out of `changes` and return them in a new field `converted: PlannedRow[]` on `DaySchedulePlan` (empty for every other kind). Internally generalise `editedId` to a set; `edited` keeps its meaning for the single-row kinds. Update the exhaustive switch.
   - **Own-row write:** for each converted row, `updateMany({ where: { id, tripDayId, updatedAt: previous.updatedAt, scheduleMode: "FIXED" }, data: { scheduleMode: "FLEXIBLE", durationMinutes, fromTime, toTime, sortOrder, updatedAt: now } })`; a count of 0 throws `DayPlanChangedError`.
   - **Receipt kind** in `DayChangeEdited` (`DCRc:146-196`), version stays **3** (architecture: new kinds need no bump):
     ```ts
     | {
         kind: "madeFlexible";
         items: Array<{
           itemId: string;
           updatedAt: T; // post-write stamp
           previous: { durationMinutes: number; fromTime: string | null; toTime: string | null; sortOrder: number; updatedAt: T };
         }>;
       }
     ```
     The previous mode is always FIXED, so it is not stored. Rows that were already FLEXIBLE and moved (gaps close, rule 2) go into `movedItems` as usual.
   - **Every exhaustive place** must handle it: the zod schema (`DCRS`, next to `parked` at l.207-220; non-empty `items`, `.strict()`), `toDayChangeReceiptWire` / `mapReceipt` (`DCRc`, `case "parked"` at l.307 is the model), `receiptHasSideEffects` (true: the day's times changed), `summarizeDayChangeReceipt` (point 8), and in `DCR`: `findInvalidity` (non-empty, no duplicate ids, no id also in `movedItems`), phase 1 staleness (each item's `updatedAt` on the receipt's `tripDayId`, as for moved rows), phase 2 restore (each item back to `FIXED`, its previous duration, times, `sortOrder` and `updatedAt`, conditional on the post-write `updatedAt`), then the moved rows as usual. `tsc` finds every switch with a `never` default; grep for `"parked"` to find the ones without.
   - **No legs change** by themselves, but the sweep still runs through `finishActivityWriteInTransaction`. In practice nothing is swept, because the order does not change.

8. **Notice copy for *Alle flexibel machen*.** `summarizeDayChangeReceipt` leads with "3 Aktivitäten flexibel gemacht" (one: "1 Aktivität flexibel gemacht"), then the usual moved count for the *other* rows (the converted ones are never in `movedItems`), then removed legs. `TV`'s handler passes nothing extra (no title).

9. **The day-menu entry and its confirmation.**
   - In the day hero overflow menu (`TV:3746-3910`), a new item "Alle flexibel machen" directly after "Aktivitäten tauschen" (`TV:3844`) and above the divider, following the block comment's rules (`TV:3790-3809`): planning items above the divider, no `aria-label`, `aria-haspopup="dialog"` because it opens one. `data-testid="day-menu-make-flexible"`.
   - Visible only when `canEditPlanning` **and** the day has at least one FIXED activity. Add a key to `dayMenuItemsVisible` (`TV:833-838`) rather than an inline condition, so `showDayMenuDivider` (`TV:840`) stays right.
   - It opens a destructive-style confirmation built like `TripBucketListPanel.tsx:469-498` (`Dialog maxWidth="xs"`, two buttons on equal footing, the safe one naming what it keeps, per `EXPERIENCE.md` l.71 and `DESIGN.md` l.282), `data-testid="day-make-flexible-dialog"`. Title "Alle Aktivitäten flexibel machen?". Body: "{count} Aktivitäten mit fester Zeit behalten ihre Dauer und Reihenfolge. Ihre Zeiten berechnet danach die App." Buttons: "Feste Zeiten behalten" (closes) and "Alle flexibel machen" (confirms). Not `window.confirm`.
   - The handler `handleMakeDayFlexible` mirrors `handleReorderPlan` (`TV:1533-1593`): close the dialog, an in-flight ref, clear error, notice and `dayChange`, POST, `takeDayChangeReceipt(receipt)`, `loadDay({ silent: true })`. 409 `day_plan_changed` → a stale message and a reload; anything else → an error message. No time arithmetic on the client.

10. **What must be preserved.** The receipt v3 and every existing kind, undo for all kinds, the sweep, `day_plan_changed` race handling, 13.2's conflict markers (they come from the trip payload; a reload after each of these writes updates them), the whole-day transfer's overwrite confirmation and its responses, *Parken*, the bucket "+" (appends), the 400 for a fixed end after 23:59.

## Acceptance Criteria

1. **Up and down move a flexible activity past anything.** Given a FLEXIBLE activity with a neighbour in a direction, FIXED or FLEXIBLE, *Nach oben* / *Nach unten* swaps it with that neighbour, the day is recomputed (the fixed neighbour keeps its times), legs that are no longer consecutive are swept, and the notice offers *Rückgängig*, which restores the day exactly (whole-DB `toEqual`). The first activity offers no *Nach oben*, the last no *Nach unten*.
2. **A fixed activity is not moved by these controls.** Its menu shows no *Nach oben* / *Nach unten*; it shows the line "Feste Zeit — Platz ergibt sich aus der Uhrzeit" (`day-plan-item-fixed-order-hint`, not focusable), then *Parken*. The server still refuses a reorder of a FIXED row with `409 day_plan_not_reorderable`.
3. ***Einfügen nach*.** The dialog for a **new FLEXIBLE** activity on a day shows `plan-insert-after`, listing the day's activities in order after the default "Am Ende". Saving with "Am Ende" appends as today. Saving with an activity places the new one directly after it; the later flexible activities move later and are listed in the receipt; the notice reports the count and *Rückgängig* removes the new activity and restores the day exactly. The select is absent for edits, for *Feste Zeit*, in parked mode and on an empty day. The API refuses `afterItemId` on a FIXED create with 400 and answers `409 day_plan_changed` (nothing written) when the named activity is no longer on the day.
4. **Moves between days recompute.** After a whole-day move, the target day's activities keep the source's order and their times are recomputed from the target day's start (last night's stay there) inside the same transaction; after a whole-day swap, both days are recomputed. FIXED activities keep their times; flexible ones that no longer fit are stored without times (13.2). There is still no receipt and no undo for these paths. If the single-activity move (6.23) still exists when this story is implemented, it recomputes source and target too; if 14.4 has removed it, nothing is needed.
5. ***Alle flexibel machen*.** On a day with at least one FIXED activity, a writer finds "Alle flexibel machen" in the day menu. After confirming, every FIXED activity on the day becomes FLEXIBLE with its current duration (`toTime − fromTime`), the order is unchanged, the day is recomputed (gaps before them close), and the notice reads "N Aktivitäten flexibel gemacht" plus the moved count of the others, with *Rückgängig*, which restores modes, durations, times, order and stamps exactly (whole-DB `toEqual`) and refuses as `409 undo_stale` if any named row changed. "Feste Zeiten behalten" changes nothing. The item is absent on a day without a FIXED activity and for a viewer; the route answers a viewer 403, a non-participant 404, and a day without FIXED activities `409 day_plan_changed`.
6. **Dictionaries.** `en.ts` and `de.ts` carry every key in the *Copy* table; `test/i18nDictionaries.test.ts` stays green.
7. **Regression.** Full suite, `tsc --noEmit` 0, lint 0 errors (warnings not above the baseline), `next build`. No schema change, no migration (`check:migrations` unchanged).

## Tasks / Subtasks

- [x] **Task 0: Baseline** (AC 7)
  - [x] Run the full suite, `tsc --noEmit` and lint and record the counts (13.2 ended at 205 files / 3347 tests, `tsc` 0, lint 0/79).
  - [x] Add a frontmatter block with `baseline_commit` as 13.1 and 13.2 have. Leave `.env` and the two deleted `prisma/dev.db.backup-*` files out of every commit (Tommy's working-tree changes).
  - [x] Check whether 14.4 has landed (`ls src/app/api/trips/[id]/day-plan-items/move`). Record it in the Debug Log; it decides Task 4's last bullet.
- [x] **Task 1: Reorder pinned, fixed-row hint** (AC 1, 2)
  - [x] `dayPlanChangeReorder.test.ts`: a FLEXIBLE row moved *up* past a FIXED 12:00 ferry (the ferry keeps its times, the flexible row now runs before it, receipt `reordered`, undo `toEqual`); the same *down* past a fixed row; a swap that makes the ferry late carries the conflict in `receipt.planConflicts`. Check first whether `:166`/`:190` already cover a fixed neighbour; add only what is missing.
  - [x] Fix the stale header comment in `reorder/route.ts:23-25` (the only refusal is a FIXED row or no neighbour).
  - [x] `TV` menu (`TV:5242-5267`): for a FIXED row render the hint (§2) before *Parken*. Use the item's mode, which the menu state already derives (`TV:4476`); add it to `planItemMenu` state if needed.
  - [x] `tripDayViewReorder.test.tsx`: a FIXED card's menu shows the hint text, no *Nach oben* / *Nach unten*, and *Parken*; the hint is not a `menuitem`; a FLEXIBLE card between two FIXED ones offers both moves.
- [x] **Task 2: *Einfügen nach*, server** (AC 3)
  - [x] `DPIS`: `afterItemId` with the refine (§3). Schema tests: allowed on FLEXIBLE create; 400 on FIXED and on a missing mode.
  - [x] `DST`: `insert` gains `afterId`; unit tests in `test/daySchedule*.test.ts` or a new `test/dayScheduleInsertAfter.test.ts` (after the first row, after the last row = append, FIXED ignores it).
  - [x] `DPIR` `createDayPlanItemForTripDay` and the POST route: pass it through; missing `afterItemId` on the day → `DayPlanChangedError`.
  - [x] Repo/route tests (new `test/dayPlanItemInsertAfter.test.ts`, `databaseState()` style from `dayPlanChangeReorder.test.ts:105-109`): A, B, C flexible; create D after A → order A, D, B, C, B and C in `movedItems`, the notice summary "2 activities moved"; undo → `toEqual` the day before; `afterItemId` of a parked row and of a row on another day → 409, nothing written; a FIXED create with `afterItemId` → 400.
- [x] **Task 3: *Einfügen nach*, dialog** (AC 3)
  - [x] `PD`: prop `dayActivities`, the select per §4, payload field, reset on open, discard guard.
  - [x] `TV`: pass the ordered plan items to the dialog.
  - [x] `tripDayPlanDialog.test.tsx`: shown for a new flexible activity with "Am Ende" selected; option labels with and without times and untitled; hidden for edit, for *Feste Zeit*, parked mode and an empty day; the POST body carries `afterItemId` only when chosen; switching to *Feste Zeit* drops it.
- [x] **Task 4: Moves between days recompute** (AC 4)
  - [x] `DST`: `recomputeDayInTransaction` (§6).
  - [x] `moveDayPlanItemsBetweenTripDays`: recompute the target after the renumber. `swapDayPlanItemsBetweenTripDays`: recompute both. Update their 13.1 comments and the `renumberDayInTransaction` docblock (`DPIR:1080-1084`, "which Story 13.3 adds").
  - [x] `day-activity-transfer/route.ts`: wrap both calls in `withPushConflict`; `DayPlanChangedError` → 409 `day_plan_changed`.
  - [x] `dayActivityTransferRoute.test.ts` (keep every existing case green, unmodified): a flexible chain moved from a day with a 08:00 check-out to a day with a 10:30 check-out starts at 10:30; a swap recomputes both days; a FIXED row keeps its times and becomes `late` in the trip payload's `planConflicts` when unreachable; a flexible chain that no longer fits is stored with null times.
  - [x] Only if the single move still exists: recompute source and target in `moveDayPlanItemToTripDay` after the leg removal, update its doc comment (`DPIR:1112-1115`), one test in `dayPlanItemRepo.test.ts`.
- [x] **Task 5: *Alle flexibel machen*, server** (AC 5)
  - [x] `DST`: `makeFlexible` edit kind and `converted` (§7); unit tests: a day of three FIXED rows with gaps becomes a tight chain from the day start; a mixed day keeps the order; an already-flexible row after them moves earlier and is a `change`, a converted row never is.
  - [x] Receipt kind `madeFlexible`: type, zod schema, wire mapping, `receiptHasSideEffects`, `summarizeDayChangeReceipt`, `findInvalidity`, undo phases 1 and 2 (§7). `dayChangeReceipt.test.ts`: schema accepts a valid one, refuses an empty `items`, an unknown field, a duplicate id; summary text one/many plus moved count.
  - [x] Repo `makeDayFlexibleForTripDay` + route `make-flexible/route.ts` + `dayMakeFlexibleSchema`.
  - [x] Tests in a new `test/dayMakeFlexible.test.ts`: the conversion (modes, durations from `toTime − fromTime`, a 1-minute migrated row stays 1, order unchanged, times recomputed); a row past 23:59 stored null; undo restores the whole DB (`toEqual`); undo after an edit of one converted row → 409 `undo_stale`, nothing written; tampered receipts (empty items, an id also in `movedItems`) → 400; a day without FIXED rows → 409; viewer 403, outsider 404, bad CSRF 403, contributor allowed; a race (copy the `vi.mock` of `readDrawnSegmentKeysInTransaction` from `dayPlanItemParkConflict.test.ts:17-36`) → 409, nothing written.
- [x] **Task 6: *Alle flexibel machen*, day view** (AC 5)
  - [x] `TV`: the menu item, its visibility key, the confirmation dialog and `handleMakeDayFlexible` (§9).
  - [x] Tests (in `tripDayViewDayChange.test.tsx` or a new `tripDayViewMakeFlexible.test.tsx`): the item shows for an owner and a contributor on a day with a FIXED row, not on an all-flexible day, not for a viewer; it has `aria-haspopup="dialog"`; "Feste Zeiten behalten" posts nothing; confirming posts `{ tripDayId }`, shows "3 activities made flexible" with *Undo*, and reloads the day; a 409 shows the stale message and reloads.
- [x] **Task 7: i18n** (AC 6): every key in *Copy*, both files.
- [x] **Task 8: Gates and the real run** (AC 7)
  - [x] Full suite, `tsc --noEmit` 0, lint 0 errors (≤ baseline warnings), `next build`, `check:migrations` unchanged.
  - [x] Mutation checks (apply, run, revert; each must turn a test red):
    1. Ignore `afterId` in the `insert` plan (always append).
    2. Leave the converted rows in `changes` instead of `converted`.
    3. Skip phase 1 staleness for `madeFlexible` items.
    4. Drop the recompute after a whole-day swap.
    5. Render the fixed-row hint as a `MenuItem`.
  - [x] Real run with Tommy on the dev server (Safari, then 390 px):
    - a migrated all-FIXED day: *Alle flexibel machen*, confirm, the gaps close, *Rückgängig* restores it;
    - a flexible row moved up past a booked ferry; the ferry stays put and turns late if it must;
    - a new activity with *Einfügen nach* in the middle of the day; the later ones move;
    - a whole-day move onto a day with a different check-out; the times follow the new start;
    - a fixed row's menu shows the hint.
  - [x] Ledger: close DW-376 (moot, §2). Leave DW-375 open (unchanged by this story).

### Review Findings

Code review 2026-10-18 (Blind Hunter, Edge Case Hunter, Acceptance Auditor): 1 decision-needed (resolved: accepted deviation), 6 patch (all applied; patches 1 and 2 share one fix, the chosen id counts only while the select shows it), 1 defer (DW-399), 19 dismissed. After the patches: 211 files / 3406 tests, tsc 0, lint 0/79; each new test turns red with its fix reverted.

- [x] [Review][Decision] Mutation check 3 (skip the `madeFlexible` phase-1 staleness loop) stays green — Task 8 says each mutation must turn a test red. Phase 2's conditional `updateMany` refuses the same stale row and the transaction rolls back, so the two phases are not distinguishable from outside. Either accept the redundancy as a recorded deviation, or add a test that observes phase 1 on its own (e.g. a spy proving no restore write is attempted before the refusal). [travelplan/src/lib/repositories/dayPlanChangeRepo.ts] — resolved 2026-10-18 (Tommy): accepted as a recorded deviation; phase 1 is a redundant guard behind phase 2's conditional writes.
- [x] [Review][Patch] A hidden *Einfügen nach* choice keeps the form dirty: the fingerprint counts `insertAfterId` even when the select is hidden (*Feste Zeit*), so closing asks the discard question about a value that would not be saved; fingerprint it only while `showInsertAfter` [travelplan/src/components/features/trips/TripDayPlanDialog.tsx:2006]
- [x] [Review][Patch] The select can show "Am Ende" while sending a stale id: when `dayActivities` reloads without the chosen activity, the native select falls back to its first option but the state keeps the old id and the save answers 409; reset `insertAfterId` when it is no longer among `dayActivities` [travelplan/src/components/features/trips/TripDayPlanDialog.tsx:2865]
- [x] [Review][Patch] The whole-day move/swap can now answer `409 day_plan_changed` (§6), but `handleSubmitTransfer` shows the generic move/swap error over a stale day; reload and show the day-changed message on that code [travelplan/src/components/features/trips/TripDayView.tsx:1974]
- [x] [Review][Patch] `afterItemId` is not trimmed (siblings use `.trim().min(1)`), so a blank id passes as a valid id and is answered as a race (409) instead of 400 [travelplan/src/lib/validation/dayPlanItemSchemas.ts]
- [x] [Review][Patch] No test pins *Einfügen nach* hidden in parked mode (Task 3, AC3) [travelplan/test/tripDayPlanDialog.test.tsx]
- [x] [Review][Patch] The new `renumberDayInTransaction` doc says it writes "without touching `updatedAt`", but `DayPlanItem.updatedAt` is `@updatedAt`, which Prisma stamps on `updateMany`; correct the comment [travelplan/src/lib/repositories/dayPlanItemRepo.ts:1165]
- [x] [Review][Defer] The race paths of the cross-day recompute (`withPushConflict` → 409 in `day-activity-transfer` and `day-plan-items/move`, rollback of re-point and renumber) have no test [travelplan/src/app/api/trips/[id]/day-activity-transfer/route.ts] — deferred (DW-399)

## Dev Notes

### Copy (de / en)

| Key | de | en |
|---|---|---|
| `trips.plan.fixedOrderHint` | Feste Zeit — Platz ergibt sich aus der Uhrzeit | Fixed time — its place follows from the time |
| `trips.plan.insertAfter` | Einfügen nach | Insert after |
| `trips.plan.insertAtEnd` | Am Ende | At the end |
| `trips.plan.insertAfterOption` | {title} · {range} | {title} · {range} |
| `trips.dayView.makeFlexibleAction` | Alle flexibel machen | Make all flexible |
| `trips.dayView.makeFlexibleTitle` | Alle Aktivitäten flexibel machen? | Make all activities flexible? |
| `trips.dayView.makeFlexibleBody` | {count} Aktivitäten mit fester Zeit behalten ihre Dauer und Reihenfolge. Ihre Zeiten berechnet danach die App. | {count} activities with a fixed time keep their duration and order. The app then works out their times. |
| `trips.dayView.makeFlexibleBodyOne` | 1 Aktivität mit fester Zeit behält ihre Dauer und ihren Platz. Ihre Zeit berechnet danach die App. | 1 activity with a fixed time keeps its duration and place. The app then works out its time. |
| `trips.dayView.makeFlexibleKeep` | Feste Zeiten behalten | Keep fixed times |
| `trips.dayView.makeFlexibleConfirm` | Alle flexibel machen | Make all flexible |
| `trips.dayView.makeFlexibleStale` | Der Tag wurde inzwischen geändert. Die Ansicht ist aktualisiert. | The day has changed meanwhile. The view has been refreshed. |
| `trips.dayView.makeFlexibleError` | Die Aktivitäten konnten nicht flexibel gemacht werden. | The activities could not be made flexible. |
| `trips.dayChange.madeFlexibleOne` | 1 Aktivität flexibel gemacht | 1 activity made flexible |
| `trips.dayChange.madeFlexible` | {count} Aktivitäten flexibel gemacht | {count} activities made flexible |

`{range}` is "11:20–12:20" (en dash, as the time pill). Before adding the stale/error keys, check whether an existing generic key (`trips.plan.reorderStale` reads "the view has been refreshed") already says exactly this; reuse it if so and drop the two new ones. Dictionaries are flat `"a.b.c": "…"` maps; `formatMessage` fills `{x}` (`src/i18n/index.ts`).

### Current state of what this story changes

- **Reorder:** route `reorder/route.ts` (L49-104; `not_reorderable` → 409 `day_plan_not_reorderable`, `reordered` → `{ receipt }`); repo `DPIR:1045-1078`; client `handleReorderPlan` `TV:1533-1593`, menu `TV:5242-5267` (items hidden, not disabled; *Parken* always), enable logic `TV:4476-4478`; keys `trips.plan.moveUp`/`moveDown`/`reorderStale`/`reorderUnavailable`/`reorderError` (de.ts L606-612).
- **`scheduleDay`** (`DS:133`): input items in order, no `sortOrder` field; FIXED with valid times keep them; flexible rows chain from the cursor; overflow → null. `placeFixedItem` `DS:197-211`. **Do not change `daySchedule.ts`.** Every change in this story is in `DST`'s plan, the repositories and the UI.
- **`planDaySchedule`** (`DST:183-306`): before/after schedules; `changes` = rows other than the edited one whose times, `sortOrder` or FIXED normalisation differ from the stored row; `newConflicts`.
- **Create:** `DPIS:156` schema (no position), route `day-plan-items/route.ts:95` → `createDayPlanItemForTripDay` `DPIR:631-706` (`NEW_ITEM_ID` `DPIR:476`; `sortOrder` = `plan.edited.sortOrder`).
- **Dialog:** *Wann & Wo* `PD:2782-2950`: `plan-schedule-mode` (2797-2808, hidden when parked), flexible duration + `plan-expected-times` (2815-2819), fixed fields + `plan-fixed-end-kind` (2863-2877), location (2881).
- **Transfer/swap:** `day-activity-transfer/route.ts` (move needs `confirmOverwrite` on a non-empty target, L79-88); repos `DPIR:1192-1288`; client `handleSubmitTransfer` `TV:1849`, dialog `TV:5058-5102`.
- **Day menu:** `TV:3720-3910` (`day-hero-overflow`, items back, day image, transfer, swap, divider, print, packet), visibility record `TV:833-838`, divider `TV:840`, item sx `TV:854`, rules comment `TV:3790-3809`.
- **Undo:** `DCR` `findInvalidity` L130-211, `undoInTransaction` L279-583 (phase 1 staleness ~L386-404, phase 2 per-kind ~L441-547, phase 3 drawn-leg check), all scoped to the receipt's one `tripDayId`.
- **Notice:** `summarizeDayChangeReceipt` `DCRc:401-444` (counts only rows whose *times* changed; `reordered` excludes the pair); `ActionNotice` render `TV:3966-4015`.

### Sequencing with 14.4

14.4 (*One Way to Another Day*, ready-for-dev) deletes `moveDayPlanItemToTripDay`, the `day-plan-items/move` route and the dialog's "anderer Tag", and touches `TV`, `PD` and `DPIR`. **Recommended: implement 14.4 first.** Then Task 4's last bullet disappears and `PD` has fewer props to step around (`moveTargetDays`, `onMove`). If 13.3 goes first, recompute in the single move as Task 4 says, and 14.4 deletes that code with the rest. Either way, whichever lands second rebases; there is no logical conflict.

### Architecture compliance

- The server is the only place that computes times; the client sends order and mode, never times (13.1).
- Order is `sortOrder`, dense per day, renumbered in the write's transaction; every write plans before its first write and writes conditionally on the `updatedAt` it read (`DST` header L20-38).
- Receipts stay version 3; `madeFlexible` is a new kind, as `scheduled` and `parked` were (architecture "Parking and scheduling").
- Conflicts stay derived on read (13.2); nothing in this story stores one.
- New routes follow the 14.x gate (`refuseUnlessTripWriter`) and the error envelope `{ error: { code, message, details } }`.

### Library / framework

No new dependency. Next.js App Router route handlers, Prisma 7.3 interactive transactions (SQLite), zod 4 (`superRefine` as in `DPIS:175`), MUI (`Menu`, `TextField select`, `Dialog`). Use the existing components: `DialogTitleWithClose`, `ActionNotice`, the bucket panel's two-button confirmation shape.

### Testing standards

- Vitest, per-worker SQLite (`test/setup.ts`), `fileParallelism: false`. Each suite defines its own `resetDatabase`, `createUser`, `createTrip`, `send` and `databaseState()`; copy them from `dayPlanChangeReorder.test.ts` or `dayPlanItemPark.test.ts`. Shared helpers in `test/helpers/` (`settleSeededDay`, `routeContext`, `renderWithProviders`, `mockFetch`).
- Seeds made with `prisma.dayPlanItem.create` default to FIXED / 15 min / `sortOrder` 0; use `settleSeededDay(tripDayId, { flexible: [...] })` to give them real schedule fields and computed times before a write test.
- "Restores exactly" means a whole-DB `toEqual` of `databaseState()` before the write and after the undo.
- UI tests feed fixtures directly; the client derives nothing.

### Previous story intelligence

- 13.1: the plan-before-write rule (a row deleted inside a transaction cannot be planned afterwards); dense renumbering puts renumber-only rows into `movedItems` (they do not count in the notice); the comparator's tiebreak exists only for seeds.
- 13.2: a reload after a write is what updates the conflict markers; a write that only changes a fixed row's lateness must still reload (review patch). All three new writes here reload the day after success.
- 14.2: the newest end-to-end example (route → repo → receipt kind → three exhaustive switches → undo → client handler → notice). Copy its structure for *Alle flexibel machen*. Its review deferred DW-396/397 (undo after a later create; never-drawn legs); do not widen them here.
- Recurring review findings in this epic: stale line references in comments, i18n keys missing in one file, notices that miss a reload. Check all three before handing over.

### Git intelligence

Recent commits: `e0643cd` 14-2 park, `f4957e3` 14-1 bucket entries as activities, `aacfd32`/`ed2da94` 13-1. The working tree carries 13.2 (done, not yet committed). Commit messages follow `13-3: <summary>; status <status>`.

### Project Structure Notes

- New route folder `src/app/api/trips/[id]/day-plan-items/make-flexible/route.ts`, beside `park/`, `schedule/`, `reorder/`.
- New tests in `test/` (flat, as all others).
- No new component file is required; if the confirmation dialog grows past ~40 lines inside `TV` (5000+ lines), extracting it to `src/components/features/trips/DayMakeFlexibleDialog.tsx` is fine.

### Questions (defaults applied; Tommy to confirm)

1. **Whole-day move and swap keep the order as it travelled** and only recompute times (§5). The epic's "flexible appended, fixed placed by time" applies literally only to the single move, which 14.4 removes. Alternative: re-place each FIXED row by time on its new day.
2. **14.4 before 13.3** (*Sequencing*). If you want 13.3 first, the single move gets a recompute that 14.4 then deletes.
3. ***Einfügen nach* only for new flexible activities** on a day. Not for edits (up/down covers them) and not for fixed ones (placed by time).
4. **A vanished *Einfügen nach* target answers 409 and reloads** rather than silently appending.
5. ***Alle flexibel machen* is offered only on a day with a fixed activity**, behind a two-button confirmation even though it can be undone (the epic asks for a confirmation).

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (claude-opus-5-5)

### Debug Log References

- Baseline at `a65c894` plus the working tree: 205 files / 3354 tests, `tsc` 0, lint 0 errors / 79 warnings. (The baseline run overlapped the first reorder-test edit, so a few of the 3354 may already be this story's.)
- 14.4 has **not** landed (`day-plan-items/move` still exists), so Task 4's single-move recompute was done; 14.4 deletes it with the rest.
- Questions Q1-Q5: the defaults were applied as written (whole-day move/swap keep the order and only recompute; 13.3 before 14.4 as asked; *Einfügen nach* only for new flexible activities; a vanished target is 409 and reloads; *Alle flexibel machen* behind a confirmation, only on a day with a FIXED row).
- After: 211 files / 3402 tests, `tsc` 0, lint 0 errors / 79 warnings (two new warnings in the new UI test removed), `next build` passes, `check:migrations` unchanged (no schema change).
- Mutation checks (applied, run, reverted): 1 ignore `afterId` → red (3 tests); 2 converted rows also in `changes` → red (8); 4 drop the swap recompute → red (1); 5 hint as a `MenuItem` → red (2). **3 skip phase-1 staleness for `madeFlexible` → stays green**: phase 2 restores each converted row conditionally on its post-write `updatedAt`, so an edited row still ends as `undo_stale` with everything rolled back. The phase-1 check is defence in depth with no observable difference, exactly as it is for `movedItems`. Kept, not tested separately.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.
- Task 1: the reorder was already correct (13.1 §10); pinned with three repo tests (up and down past a fixed ferry with whole-DB undo, and a swap that makes the ferry late carrying `planConflicts`). Route header comment fixed. The fixed-row hint is a module-level `FixedOrderHint` (`li role="presentation"`, no `tabindex`, lock glyph, ink-soft body2). It sets MUI's `muiSkipListHighlight` static so the menu's first focus lands on *Parken*, not on the hint (pinned).
- Task 2: `afterItemId` on the create schema (refused for FIXED / no mode; the PATCH schema refuses it as `z.undefined`), `insert.afterId` in the plan, and the repo reads the day first and throws `DayPlanChangedError` when the target is not on it (parked, another day, gone → 409, nothing written).
- Task 3: `dayActivities` and a new optional `onDayChanged` prop on the dialog. The existing 409 handling did **not** reload (the dialog only showed its message), so for a create the dialog now calls `onDayChanged` (TV: silent `loadDay`) and resets the select to "Am Ende". Edits are excluded so a reload can never re-seed an open edit. The select uses `FormField select` (native), is in the dirty fingerprint, and starts at "Am Ende" on every open.
- Task 4: `recomputeDayInTransaction` in `DST`; whole-day move recomputes the target, swap both days, and the 6.23 single move both days after the leg removal. All three routes wrap the call in `withPushConflict` (409 `day_plan_changed`).
- Task 5: `makeFlexible` edit kind with `converted` on the plan; `fixedDurationOf` extracted into `DST` and reused by `scheduleFieldsOf` and park. New receipt kind `madeFlexible` (v3) through the type, wire mapping, zod schema (non-empty, strict, unique ids), side effects, summary, `findInvalidity`, undo phases 1 and 2. Repo `makeDayFlexibleForTripDay`, route `POST day-plan-items/make-flexible`, `dayMakeFlexibleSchema`.
- Task 6: day-menu item after *Aktivitäten tauschen* (visibility key `makeFlexible`, feeds the divider), two-button confirmation (singular body for one row), `handleMakeDayFlexible` in the shape of `handleReorderPlan` (reloads on success, 409 and 404).
- Task 7: all 14 keys in both dictionaries. No existing stale key said exactly "the view has been refreshed" for this case, so the two new ones were kept.
- Ledger: DW-376 closed (moot); DW-375 left open.
- Real run passed 2026-10-18 (Tommy, dev server): Alle flexibel machen with undo, a flexible row up past a booking, Einfügen nach, a whole-day move, the fixed-row hint. (First attempt was on the wrong server; nothing to fix.)

### File List

- `_bmad-output/implementation-artifacts/13-3-putting-the-day-in-order.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/implementation-artifacts/deferred-work.md`
- `travelplan/src/app/api/trips/[id]/day-activity-transfer/route.ts`
- `travelplan/src/app/api/trips/[id]/day-plan-items/make-flexible/route.ts` (new)
- `travelplan/src/app/api/trips/[id]/day-plan-items/move/route.ts`
- `travelplan/src/app/api/trips/[id]/day-plan-items/reorder/route.ts`
- `travelplan/src/app/api/trips/[id]/day-plan-items/route.ts`
- `travelplan/src/components/features/trips/TripDayPlanDialog.tsx`
- `travelplan/src/components/features/trips/TripDayView.tsx`
- `travelplan/src/i18n/de.ts`
- `travelplan/src/i18n/en.ts`
- `travelplan/src/lib/repositories/dayPlanChangeRepo.ts`
- `travelplan/src/lib/repositories/dayPlanItemRepo.ts`
- `travelplan/src/lib/repositories/dayScheduleTransaction.ts`
- `travelplan/src/lib/trips/dayChangeReceipt.ts`
- `travelplan/src/lib/validation/dayChangeReceiptSchemas.ts`
- `travelplan/src/lib/validation/dayPlanItemSchemas.ts`
- `travelplan/test/dayActivityTransferRoute.test.ts`
- `travelplan/test/dayChangeReceipt.test.ts`
- `travelplan/test/dayMakeFlexible.test.ts` (new)
- `travelplan/test/dayMakeFlexibleConflict.test.ts` (new)
- `travelplan/test/dayPlanChangeReorder.test.ts`
- `travelplan/test/dayPlanItemInsertAfter.test.ts` (new)
- `travelplan/test/dayPlanItemSchemas.test.ts`
- `travelplan/test/dayScheduleInsertAfter.test.ts` (new)
- `travelplan/test/dayScheduleMakeFlexible.test.ts` (new)
- `travelplan/test/tripDayPlanDialog.test.tsx`
- `travelplan/test/tripDayViewMakeFlexible.test.tsx` (new)
- `travelplan/test/tripDayViewReorder.test.tsx`

### Change Log

- 2026-10-18: Implemented via bmad-dev-story. Reorder pinned and the fixed-row hint; *Einfügen nach* (`afterItemId` on create, dialog select, stale reload); moves between days recompute (whole-day move, swap, 6.23 single move); *Alle flexibel machen* with receipt kind `madeFlexible` and undo; 14 i18n keys; DW-376 closed. Gates green.
- 2026-10-18: Real run passed; status review.
- 2026-10-18: Code review (bmad-code-review): mutation 3 accepted as a recorded deviation; 6 patches applied (*Einfügen nach* counts and sends a choice only while the select shows it, whole-day move/swap reloads on `409 day_plan_changed` with its own message (2 new i18n keys), `afterItemId` trimmed, parked-mode test, renumber comment); DW-399 deferred. Status done.
