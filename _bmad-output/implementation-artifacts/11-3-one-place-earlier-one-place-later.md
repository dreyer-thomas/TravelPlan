---
baseline_commit: 7780dfb52ac0e5d0b0a9ca7e4c2e5e9043df7219
---

# Story 11.3: One Place Earlier, One Place Later

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As someone who decides two stops would be better the other way round,
I want to move an activity up or down one place,
so that I can change the order of my day without retyping both sets of times.

**FRs covered:** FR43. **Depends on:** Stories 11.1 (done) and 11.2 (done). It reuses the leg sweep, the change receipt, the undo endpoint and the push walk; it builds no second copy of any of them.
Sources: [epics.md#Story 11.3](../planning-artifacts/epics.md), [sprint-change-proposal-2026-10-10.md](../planning-artifacts/sprint-change-proposal-2026-10-10.md) §2 *11.3 is a swap plus rule 1*, rules 1, 5, 6, success criterion 4, decision 5; [prd.md FR43](../planning-artifacts/prd.md); EXPERIENCE.md *Change with side effects* and *icon-button*; DESIGN.md `action-notice`, `icon-button`.

All code paths below are relative to `travelplan/`. Line numbers were read in the working tree **after** Story 11.2 (11.1 and 11.2 are not yet committed; baseline commit `7780dfb` plus their diffs).

## Read this first: what the epic's wording assumes that the code does not

Each item was checked against the working tree. Each one changes what a task asks for.

1. **There is no "activity's overflow menu" today.** The epic says *"chosen from its menu"* and *"the activity's overflow menu … existing menu conventions"*. An activity card (`TripDayView.tsx:4136-4260`) has **no** menu: the whole card is a stretched edit overlay (`data-testid="day-plan-item-edit-overlay"`, `:4171-4180`), and its head row holds only the time pill, the cost pill and the edit glyph (`:4190-4226`). Moving to another day (6.23) and deleting live in the edit dialog. The only `<Menu>`s in the file are the day hero's (`:3475`) and the document overflow (`:4772`). **This story adds a per-activity overflow trigger and menu** (Task 6). The conventions it must follow are the day hero menu's and the document menu's: a 44×44 `IconButton`, `aria-haspopup="menu"` + `aria-expanded` + `aria-controls`, an accessible name, items with `sx={{ "&&": { minHeight: 44 } }}` (DW-180), one shared `<Menu>` mount for all cards (like `documentMenu`), and closing the menu before acting (Story 5.11's close-before-act). Use **`MoreVerticalIcon`** (`TripIcons.tsx:167`): its docblock rules that vertical is the row-level idiom and horizontal the page-level one.
2. **The trigger must sit above the edit overlay.** The head row is wrapped in `overlaidContentSx` (`:2488-2495`): `pointerEvents: "none"` with `"& a, & button": { pointerEvents: "auto" }`, `zIndex: 2` over the overlay's `zIndex: 1`. An `IconButton` renders a `<button>`, so it takes its clicks back automatically and the overlay never fires. **No `stopPropagation`** is needed or wanted (the file's documented rule, `:2478-2487`).
3. **The receipt has no shape for a swap.** `DayChangeEdited` (`dayChangeReceipt.ts:108-111`) is `created | updated | deleted`, and undo's `findInvalidity` refuses a receipt whose edited item is also listed in `movedItems` (`dayPlanChangeRepo.ts:117-124`). A swap edits two rows' times and nothing else. This story adds a fourth kind, `{ kind: "reordered"; itemId; neighbourId }`, and lists **both** swapped activities in `movedItems` together with every pushed one (see *The receipt for a swap*). `movedItems` already restores `fromTime`, `toTime` and `updatedAt` byte for byte, so undo needs **no new write path**, only the new kind's validity rules.
4. **No version bump.** 11.2 bumped to `version: 2` because a v1 receipt lacked `movedItems` and would have been misread. Adding a union member is additive: every v2 receipt a client holds across this deploy still parses and still undoes correctly. Keep `version: 2`.
5. **The proposal says the leg B→A "never exists at that point, because rule 5 has just deleted every leg touching the pair". That is not quite true.** 11.1's sweep deletes only legs that were drawn *before* the change and are not drawn after it. A pre-existing undrawn leg B→A (an orphan from a restore, 8.5 AC5) survives, and after the swap B and A are consecutive, so it becomes drawn. The push rule as 11.2 built it already counts "the stored leg from `prev` to `next`" whenever the two are consecutive (11.2 AC1), so the swap simply passes all activity-to-activity legs to the planner exactly as `planPushInTransaction` does. The epic's AC ("a leg is not reversed automatically") holds: nothing **creates** or **flips** a leg. Pin this case in a unit test.
6. **`loadDay()` clears the day view's error.** `loadDay` calls `setError(null)` first thing (`TripDayView.tsx:985`). A refused swap that sets an error and *then* reloads would wipe its own message. Await the reload, then set the error (Task 7).
7. **The client order is the server order.** `loadDay` sorts `planItems` with the canonical `compareDayPlanItemsByStartTime` (`TripDayView.tsx:1065`), the same comparator the repository and the push planner use. So "has a timed neighbour above/below" can be read off `planItems` on the client to decide which items to offer. The server **re-decides** the neighbour itself inside the transaction and never trusts the client's view.
8. **The name `swap…` is taken.** `swapDayPlanItemsBetweenTripDays` (`dayPlanItemRepo.ts:1070`) is the whole-day transfer between two days (6.7). To avoid the `common.save` naming trap the move route's docblock warns about, call this feature **reorder** everywhere in code: `planDayReorder`, `reorderDayPlanItemForTripDay`, `day-plan-items/reorder`, `edited.kind: "reordered"`. "Swap" stays a word in comments for what happens to the pair.

## Acceptance Criteria

1. **AC1: *Nach oben*.**
   - **Given** a timed activity B whose timed predecessor in the day's canonical order is A,
   - **when** *Nach oben* is chosen from B's menu,
   - **then** B takes A's start and keeps its own duration; A starts at B's new end, plus the duration of a stored leg B→A if one exists, and keeps its own duration; and the 11.2 push walk runs from A over the activities after the pair.
   - The day's first start and both durations are preserved, slack between the pair is absorbed, and slack after it is kept (the walk stops at the first activity that already fits, 11.2 AC2).
2. **AC2: *Nach unten*.** *Nach unten* on A, whose timed successor is B, is the same swap of the same pair and produces the identical result as *Nach oben* on B.
3. **AC3: Legs.** Every leg that is drawn before the swap and no longer drawn after it is deleted in the same transaction by 11.1's sweep. That includes the leg A→B between the swapped pair, a stay→A leg (now stay→B is consecutive) and a B→C leg (now A→C is consecutive). No leg is created or reversed.
4. **AC4: Which controls are offered.**
   - *Nach oben* only on a timed activity whose directly preceding activity in the canonical order is timed; *Nach unten* only on a timed activity whose directly following activity is timed.
   - An untimed activity gets neither. The first timed activity gets no *Nach oben*; the last timed activity gets no *Nach unten*.
   - When an activity is offered neither, **its overflow trigger is not rendered** (a menu that opens empty is a dead control).
   - The trigger and its items are rendered only for users with planning rights (`canEditPlanning`); a viewer sees no trigger, and the route refuses them like every other planning write (404 from the owner-or-contributor gate, then the repository's writer clause).
5. **AC5: The server re-decides.** The route takes `{ tripDayId, itemId, direction: "up" | "down" }`. The repository reads the day inside the transaction and finds the neighbour itself. If the item is missing it answers `404`. If the item is untimed, has no timed neighbour in that direction, either row of the pair has a start time `timeToMinutes` cannot read (imported data), or the swap would hit the predecessor-side tie (*The swap, precisely* step 5), it answers `409 day_plan_not_reorderable` and writes nothing.
6. **AC6: Midnight.** A swap whose own arithmetic or whose push would put any `fromTime` or `toTime` past `23:59` answers `409 day_plan_past_midnight` with `details: { itemId, itemTitle }` naming that activity (11.2's code and shape), and writes nothing: no time, no swept leg.
7. **AC7: Order is what the user asked for.** After a successful swap, re-sorting the day with `compareDayPlanItemsByStartTime` puts B directly before A, and everything else in its previous relative order. The one tie the arithmetic cannot rule out (a zero-length imported B, no leg, so A would start exactly at B's start while an older `createdAt` sorts A first) is settled the way 11.2's review ruled: A moves **one minute** later. Pinned by a test.
8. **AC8: The receipt.** The response is `{ receipt }` (signed, as on the other writes), where `edited` is `{ kind: "reordered", itemId, neighbourId }` and `movedItems` lists A, B and every pushed activity, each with previous times and previous and post-write `updatedAt`. Removed legs are in `removedTravelSegments`. A check-in warning is computed exactly as on the other writes (11.2 AC9) and travels in `checkInWarning`.
9. **AC9: The notice.** After a successful swap the `action-notice` appears (a swap always has side effects). Its summary starts with "Reihenfolge geändert" / "Order changed", followed by the count of **other** moved activities (excluding the pair) and the removed legs, joined with `" · "`: e.g. "Reihenfolge geändert · 2 Aktivitäten verschoben · 1 Fahrt entfernt". The warning line appears when `checkInWarning` is present.
10. **AC10: Undo.** *Rückgängig* restores both swapped activities' times, every pushed activity and every deleted leg in one transaction, through the existing undo endpoint, and the day reads exactly as before (whole-DB `toEqual`, including `updatedAt`). If any moved activity changed since, undo is refused (`409 undo_stale`) and nothing is written. A tampered receipt (`neighbourId` equal to `itemId`, either id absent from `movedItems`, a `consumedBucketListItem`) is `400`.
11. **AC11: Concurrency.** Every time write is conditional on the `updatedAt` read for the plan (11.2's `applyPushMovesInTransaction`); a miss rolls the whole transaction back and answers `409 day_plan_changed`.
12. **AC12: A pure, tested reorder function.** The swap is one pure function in `dayPlanPush.ts` that reuses the 11.2 walk (no second copy of it), unit-tested for at least: up and down give the same result; slack between the pair absorbed; slack after the pair kept; a push after the pair (overlapping pair); a stored B→A leg counted; the midnight refusal (on the pair and on a pushed row); no timed neighbour → refusal; the zero-length tie; and the re-sort property.
13. **AC13: Menu conventions.** The overflow trigger is a 44×44 `IconButton` with `MoreVerticalIcon`, an accessible name naming the activity, `aria-haspopup="menu"`, `aria-expanded`, `aria-controls` while open. Each item has the 44px floor via `'&&'` (DW-180). The menu closes before the request is sent.
14. **AC14: Unchanged surfaces.** Create, update and delete behave exactly as after 11.2. Moving between days (6.7, 6.23), import/restore and the travel-segment routes are untouched. The edit overlay still opens the dialog on a click anywhere on the card except the new trigger.
15. **AC15: Both dictionaries.** Every new key is in both `src/i18n/en.ts` and `src/i18n/de.ts`; `test/i18nDictionaries.test.ts` stays green. The English item label is exactly "Move up" (already quoted by `trips.plan.beforePredecessor`, `en.ts:662`), the German exactly „Nach oben" (`de.ts:603`).

## Tasks / Subtasks

- [x] **Task 0: Baseline.** In `travelplan/`, run `npm test`, `npm run typecheck`, `npm run lint`. Record file/test counts and lint problems. Expected from 11.2's close: 166 files / 2723 tests, typecheck 0, lint 80 warnings. Let the baseline finish before the first edit (11.2's overlapped and was unusable). (AC: all)

- [x] **Task 1: The pure reorder function** (AC: 1, 2, 5, 6, 7, 12)
  - [x] In `src/lib/trips/dayPlanPush.ts`, extract the walk loop of `planDayPush` (`:146-202`) into a private helper, e.g. `walkFrom(order, startIndex, legMinutes, startMoved): { status: "ok"; moves } | past_midnight`, that mutates/returns the order and the moves. `planDayPush` calls it with `startMoved = false` exactly as today. **Behaviour of `planDayPush` must not change**: `test/dayPlanPush.test.ts` stays green untouched.
  - [x] Add:

    ```ts
    export type ReorderDirection = "up" | "down";
    export type ReorderPlan =
      | { status: "ok"; order: PushItem[]; moves: PushMove[]; itemId: string; neighbourId: string }
      | { status: "not_reorderable" }
      | { status: "past_midnight"; item: { id: string; title: string | null } };
    export const planDayReorder = (input: { items: PushItem[]; legs: PushLeg[]; itemId: string; direction: ReorderDirection }): ReorderPlan;
    ```
  - [x] Algorithm (see *The swap, precisely*): sort with the canonical comparator; find the item (absent → throw, as `planDayPush` does for a retime; the repository checks existence first); neighbour at `index - 1` (up) or `index + 1` (down). Both must be timed and both starts readable, else `not_reorderable`. Let `first` be the earlier of the pair, `second` the later. `second` shifts by `first.start - second.start`; `first` shifts so it starts at `end(second') + leg(second → first)`, plus one minute if the comparator would still sort `first` before `second'` (AC7). Midnight-check both. Place `second'` at the pair's lower index and `first'` at the upper; refuse the predecessor-side tie (`not_reorderable`, *The swap, precisely* step 5); then `walkFrom(order, upperIndex, legMinutes, true)`.
  - [x] `moves` lists **both** pair rows first (`second`, then `first`), even if a shift is 0, then the walk's moves in walk order.
  - [x] Pure, deterministic, no clock. Update the module docblock (the "that is Story 11.3's *Nach oben*" line becomes a description of the reorder).

- [x] **Task 2: Receipt kind `reordered`** (AC: 8, 9, 10)
  - [x] `src/lib/trips/dayChangeReceipt.ts`: add `| { kind: "reordered"; itemId: string; neighbourId: string }` to `DayChangeEdited`; a `case "reordered"` in `mapReceipt` (nothing to convert, copy it); `receiptHasSideEffects` also true for `edited.kind === "reordered"`; `summarizeDayChangeReceipt` puts `t("trips.dayChange.reordered")` first for that kind and counts moved items **excluding** `itemId` and `neighbourId` (filter by id, do not subtract 2). Update the docblock.
  - [x] `src/lib/validation/dayChangeReceiptSchemas.ts`: add the strict variant `z.object({ kind: z.literal("reordered"), itemId: idSchema, neighbourId: idSchema }).strict()` to `editedSchema`. `version` stays `z.literal(2)`.
  - [x] Signing needs no change (canonical form sorts keys).

- [x] **Task 3: Undo accepts `reordered`** (AC: 10)
  - [x] `dayPlanChangeRepo.ts` `findInvalidity`: for `reordered`, refuse `itemId === neighbourId`, refuse when either id is not in `movedItems`, and skip the "edited item listed as moved" rule (it applies to the other three kinds only). The existing "bucket-list row on a non-create" rule already refuses a `consumedBucketListItem`.
  - [x] `undoInTransaction`: phase 1 and phase 2 do nothing for the edited item of a `reordered` receipt; the `movedItems` loops (`:187-190`, `:231-237`) already check and restore both rows. Make the `if/else if/else` chains exhaustive so `reordered` does not fall into the `deleted` branch (the current `else` at `:182` and `:222` would treat it as a delete). Use an explicit `else if (edited.kind === "deleted")` or a `switch` with a `never` default.
  - [x] Phase 3 unchanged: restoring times restores the order, so the legs restore drawn.
  - [x] Update the module docblock.

- [x] **Task 4: Repository** (AC: 3, 5, 6, 8, 11)
  - [x] `dayPlanItemRepo.ts`, new `reorderDayPlanItemForTripDay({ userId, tripId, tripDayId, itemId, direction })`:
    - `findTripDayForTripWriter` first (Story 5.13's writer clause) → `{ status: "not_found" }`.
    - In one `prisma.$transaction`, **before the first write**: check the item exists on `tripDayId` (`{ status: "missing" }`); read items and `DAY_PLAN_ITEM → DAY_PLAN_ITEM` legs exactly as `planPushInTransaction` does (`:463-486`; refactor the read into a shared helper rather than copying it); call `planDayReorder`; return `not_reorderable` / `past_midnight` without writing.
    - Then: `const now = new Date()`; `drawnBefore = readDrawnSegmentKeysInTransaction(...)`; `applyPushMovesInTransaction(tx, tripDayId, planned, now)` (it already writes conditionally and throws `DayPlanChangedError`); `sweepNoLongerDrawnSegmentsInTransaction`; `findCheckInWarningInTransaction`; `buildReceipt(tripDayId, { kind: "reordered", itemId, neighbourId }, removed, movedItems, { checkInWarning })`.
    - Result: `{ status: "not_found" } | { status: "missing" } | { status: "not_reorderable" } | { status: "past_midnight"; item } | { status: "reordered"; receipt }`.
  - [x] `PlannedPush` already fits (`order`, `moves`, `readUpdatedAt`); reuse it.

- [x] **Task 5: Route** (AC: 4, 5, 6, 8, 11)
  - [x] New `src/app/api/trips/[id]/day-plan-items/reorder/route.ts`, `POST` only, sitting beside `move/` (6.23), with a docblock that says why it is its own route and why it is not called "swap" (Read-this-first §8).
  - [x] Guard order = `day-plan-items/route.ts` POST: CSRF (`403 csrf_invalid`), session, `hasTripOwnerOrContributorAccess` (`404 not_found`), JSON (`400 invalid_json`), schema (`400 validation_error`).
  - [x] New `dayPlanItemReorderSchema` in `src/lib/validation/dayPlanItemSchemas.ts`: `{ tripDayId, itemId }` trimmed non-empty like `dayPlanItemDeleteSchema`, plus `direction: z.enum(["up", "down"])`.
  - [x] Map: `not_found` → 404 "Trip day not found"; `missing` → 404 "Day plan item not found"; `not_reorderable` → `409 day_plan_not_reorderable`; `past_midnight` → 409 with 11.2's exact code and `details` (extract `pushRefusalResponse`'s midnight branch into something both routes can call, or export it from a small shared module; do not copy the strings); `DayPlanChangedError` → `409 day_plan_changed` (reuse the same helper pattern as `withPushConflict`); success → `ok({ receipt: signDayChangeReceipt(toDayChangeReceiptWire(receipt), { tripId, userId }) })`.
  - [x] A thrown non-conflict error → `500 server_error`, as the undo route does.

- [x] **Task 6: The activity overflow menu** (AC: 4, 13, 14)
  - [x] In `TripDayView.tsx`, compute per item, from `planItems` (already canonically sorted): `canMoveUp = Boolean(item.fromTime) && index > 0 && Boolean(planItems[index - 1].fromTime)`, `canMoveDown = Boolean(item.fromTime) && Boolean(planItems[index + 1]?.fromTime)`. Timed means `fromTime` non-empty, the comparator's own test; do **not** use the time pill's `fromTime && toTime` condition.
  - [x] In the card head (`data-testid="day-plan-item-head"`, `:4190`), in the right-hand cluster beside the edit glyph, render — only when `canEditPlanning && (canMoveUp || canMoveDown)` — an `IconButton` with `MoreVerticalIcon`, `data-testid="day-plan-item-overflow"`, `aria-label={formatMessage(t("trips.plan.itemActionsAria"), { title: capLabel(title) })}`, `aria-haspopup="menu"`, `aria-expanded={planItemMenu?.itemId === item.id}`, `aria-controls` set only while open, and an explicit `width: 44, height: 44` (the theme's `MuiIconButton` override carries no geometry; see the comment at `:3443-3446`). Keep the head row's `1fr auto` layout from overflowing at 390px.
  - [x] One shared `<Menu id="day-plan-item-overflow-menu">` mount next to the document menu (`:4772`), driven by new state `planItemMenu: { anchorEl; itemId; canMoveUp; canMoveDown } | null`. Name the list with `slotProps={{ list: { "aria-label": … } }}` as the document menu does. Items, each `sx={{ "&&": { minHeight: 44 } }}`, rendered only when allowed: `t("trips.plan.moveUp")` → `handleReorderPlan(itemId, "up")`, `t("trips.plan.moveDown")` → `"down"`. No `aria-label` on the items (the visible label is the name, WCAG 2.5.3, as the day hero menu rules).
  - [x] Close the menu in the same places the day menu closes: on day change (`:714`) and when `canEditPlanning` turns false. Anchor on a node that unmounts (the trigger disappears after a reorder that makes the item first) is cleared by closing first in the handler.

- [x] **Task 7: The client handler** (AC: 4, 9, 11)
  - [x] `handleReorderPlan(itemId, direction)`, a `useCallback` modelled on `handleDeletePlan` (`:1431-1505`) and `handleUndoDayChange`:
    - guard `!canEditPlanning || !day`; an in-flight ref claimed synchronously (two quick clicks must not send two swaps; the second would swap back);
    - `setPlanItemMenu(null)` **before** the request (close-before-act); `setError(null)`; `setPlanMoveNotice(null)`; `setDayChange(null)` (11.1 AC7: a write on the day discards the earlier receipt);
    - `POST /api/trips/${tripId}/day-plan-items/reorder` with CSRF header, `{ tripDayId: day.id, itemId, direction }`;
    - success: if still on the same day (`currentDayIdRef`), `takeDayChangeReceipt(body.data?.receipt ?? null)` and `await loadDay({ silent: true })` (it refetches the items **and** the travel segments, `:1068`, so swept legs disappear);
    - `409 day_plan_past_midnight`: `await loadDay({ silent: true })` first, then `setError(formatMessage(t("trips.plan.pastMidnight"), { title }))`, with `title` from `details.itemTitle` or `t("trips.plan.untitledActivity")` (reuse 11.2's keys);
    - `409 day_plan_changed`: await the reload, then `setError(t("trips.plan.reorderStale"))`;
    - `409 day_plan_not_reorderable`: await the reload, then `setError(t("trips.plan.reorderUnavailable"))`. This is usually a view that is out of date (another contributor changed the day), and rarely the predecessor-side tie;
    - anything else / network: `setError(resolveApiError(code, t("trips.plan.reorderError")))`.
    - No optimistic reorder and no client-side time computation (11.2 AC11): the server's result is rendered.
  - [x] The `<ActionNotice>` block (`:3670-3692`) needs no change: `summarizeDayChangeReceipt` and `checkInWarningText` carry the new kind.

- [x] **Task 8: Strings** (AC: 15). Both dictionaries, same relative order. Put the `trips.plan.*` keys next to `trips.plan.beforePredecessor` and the `trips.dayChange.*` key at the head of that block:

  | Key | de | en |
  |---|---|---|
  | `trips.plan.moveUp` | Nach oben | Move up |
  | `trips.plan.moveDown` | Nach unten | Move down |
  | `trips.plan.itemActionsAria` | Weitere Aktionen für {title} | More actions for {title} |
  | `trips.plan.itemActionsMenu` | Aktionen für den Planpunkt | Plan item actions |
  | `trips.plan.reorderStale` | Der Tag wurde gerade geändert – die Reihenfolge wurde nicht geändert. | The day was just changed – the order was not changed. |
  | `trips.plan.reorderUnavailable` | Diese Aktivität lässt sich hier nicht verschieben. Die Ansicht wurde aktualisiert. | This activity cannot be moved here. The view has been refreshed. |
  | `trips.plan.reorderError` | Reihenfolge konnte nicht geändert werden – bitte erneut versuchen. | Could not change the order – please try again. |
  | `trips.dayChange.reordered` | Reihenfolge geändert | Order changed |

- [x] **Task 9: Tests** (AC: all). See *Testing*. The pure-function tests are written and green before Task 4.
- [x] **Task 10: Record.** Final gates against Task 0. In the Completion Notes, list any existing test whose expectation changed and why (none is expected; see *What must not regress*). Note whether a real-browser pass at 390px was done for the new trigger in the card head.

### Review Findings

- [x] [Review][Patch] A 404 from the reorder route (activity deleted elsewhere) does not reload the day, so the gone card and its menu stay and every retry 404s again. Reload, then set the error, as the 409 branches do [travelplan/src/components/features/trips/TripDayView.tsx:1508]
- [x] [Review][Patch] The dev's extra refusal (an imported overnight `toTime` on `second` going below 00:00 → `not_reorderable`) has no unit test and is missing from the route docblock's refusal list [travelplan/src/lib/trips/dayPlanPush.ts:298]
- [x] [Review][Patch] Test gaps in `tripDayViewReorder.test.tsx`: the menu closing when `canEditPlanning` turns false; the `day_plan_changed` / `day_plan_not_reorderable` branches asserting that the day reloaded; the trigger's 44×44 size [travelplan/test/tripDayViewReorder.test.tsx]. Reload assertions and the 44×44 test added, plus a 404 test. The rights-loss menu close is not pinned: the harness cannot reload the day while the modal menu is open, so the render-time guard (`TripDayView.tsx:780`) stays untested
- [x] [Review][Defer] A late reorder response can overwrite the receipt of a write made while it was in flight (edit dialog save, delete) and start a second racing `loadDay` [travelplan/src/components/features/trips/TripDayView.tsx:1484] — deferred, the same pattern as every other write handler in the view (DW-374)
- [x] [Review][Defer] A refused or failed reorder has already discarded the earlier change's undo receipt, although nothing was written [travelplan/src/components/features/trips/TripDayView.tsx:1467] — deferred, the 11.1 AC7 discard-up-front contract shared by all write handlers (DW-375)
- [x] [Review][Defer] The menu offers moves the server refuses deterministically (predecessor-side tie, overnight below 00:00, unreadable start); the user gets "view refreshed" and the same offer again [travelplan/src/components/features/trips/TripDayView.tsx:4238] — deferred, rare legacy/tie shapes (DW-376)
- [x] [Review][Defer] Undo of a reorder can restore the pair over an activity created in the gap since. Already tracked as DW-372, which now covers reorders too
- [x] [Review][Defer] A SQLite busy/P2034 error on the reorder transaction returns 500, not `409 day_plan_changed`. Already tracked as DW-373; the reorder route uses the same `withPushConflict`

## Dev Notes

### The swap, precisely

Notation as in 11.2: *timed* = `fromTime` non-empty; *end* = `toTime` if readable and after `fromTime`, else `fromTime` (zero length; `activityEndMinutes`). `first` is the earlier of the pair in the canonical order, `second` the later; the user's item is either one, depending on direction.

1. **`second'`** = `second` shifted by `δ₂ = first.start − second.start` (≤ 0). Both `fromTime` and `toTime` (when readable) shift, so its duration and any odd imported shape are kept, the same rule the walk uses. It never moves later, so it can never cross midnight.
2. **`first'`** starts at `s₁ = end(second') + leg(second → first)` (stored `DAY_PLAN_ITEM → DAY_PLAN_ITEM`, directional; 0 if none). **Tie guard:** if `compareDayPlanItemsByStartTime({ ...first, fromTime: fmt(s₁) }, second') < 0`, use `s₁ + 1`. This can only happen when `end(second') = second'.start` (zero-length `second`, no leg) and `first.createdAt` is older. `first` shifts by `s₁ − first.start` (≥ 0, because `s₁ ≥ second'.start = first.start`). Midnight-check both shifted times → `past_midnight` naming `first`.
3. **Order:** `second'` takes the pair's lower index, `first'` the upper. Everything else keeps its index.
4. **Walk:** 11.2's walk from `first'` with `previousMoved = true` (so its zero-length tie guard covers `first'` too). It stops at the first activity that fits, refuses past midnight naming the activity, never touches untimed rows.

**Why the order holds, and the one place it does not.** `second'.start = first.start`, which is ≥ the start of the row P directly before the pair, because the day was ordered. When the two are equal, the comparator falls back to `createdAt`: P sorted before `first` on that tie, but `second` may be older than P, and then `second'` would sort *before* P. That is the **predecessor-side tie**. Refuse it with `not_reorderable` (step 5 below). Shifting P or `second'` would move something earlier than the pair's start, which the proposal never allows. It needs three rows with exactly the same start and a specific `createdAt` order. Pin it with a unit test, and let the property test catch anything else.

5. **Predecessor-side check** (before the walk): if `lowerIndex > 0` and `compareDayPlanItemsByStartTime(second', order[lowerIndex − 1]) < 0`, return `not_reorderable`.

**Worked examples** (put each in `test/dayPlanPush.test.ts`):

- *Slack absorbed, slack after kept* (success criterion 4): A 09:00–10:00, B 10:30–11:00, C 11:30–12:30. *Nach oben* on B → B 09:00–09:30, A 09:30–10:30, C stays (earliest 10:30 ≤ 11:30). Moves: B, A. Notice: "Reihenfolge geändert".
- *Push after the pair*: A 09:00–11:00, B 10:00–10:30 (overlaps A, accepted since 11.2 AC5), C 11:00–12:00. *Nach oben* on B → B 09:00–09:30, A 09:30–11:30, C earliest 11:30 → 11:30–12:30. Notice: "Reihenfolge geändert · 1 Aktivität verschoben".
- *Midnight*: A 21:00–23:00, B 22:00–23:30. *Nach oben* on B → A would be 22:30–00:30 → `past_midnight` naming A, nothing written.
- *Reverse leg counted*: A 09:00–10:00, B 10:00–11:00, stored undrawn leg B→A 20 min → B 09:00–10:00, A 10:20–11:20.
- *Down equals up*: *Nach unten* on A in any example above gives byte-identical `order` and `moves`.
- *Legs* (repository test, AC3): stay→A, A→B, B→C stored and drawn; after *Nach oben* on B, all three are in `removedTravelSegments`; nothing new is stored.

### The receipt for a swap (wire form)

```ts
{
  version: 2,                       // unchanged; additive kind
  tripDayId,
  edited: { kind: "reordered", itemId /* the activity the user moved */, neighbourId },
  removedTravelSegments: [...],     // 11.1
  movedItems: [second, first, ...pushed], // both pair rows always; previous times + both stamps
  checkInWarning?: {...},           // 11.2 AC9, same computation
}
```

Undo is then *exactly* 11.2's moved-items restore plus 11.1's leg recreation; there is no edited-item write. That is why both pair rows must always be in `movedItems`, even with a zero shift: the invariant "a reordered receipt names two rows that are both in `movedItems`" is what `findInvalidity` checks.

### What must not regress

- **`planDayPush` behaviour.** The extraction of the walk is a refactor; `test/dayPlanPush.test.ts` and `test/dayPlanChangePush*.test.ts` must stay green without edits.
- **11.1/11.2's receipt contract**: signing, staleness, post-condition, `unavailable`/`stale` client states, AC7 discard points, `version: 2`.
- **The sweep's "only what this change un-drew" rule.** A pre-existing orphan that the swap makes drawn survives (and is counted by the walk, Read-this-first §5).
- **Story 6.23's non-healing rule.** Reordering never creates a leg.
- **The writer clause** (Story 5.13) on the repository; the owner-or-contributor gate on the route.
- **The edit overlay.** Clicking the card anywhere except the trigger still opens the edit dialog; the trigger never opens it. `tripDayViewLayout.test.tsx` and the overlay tests in the day-view suites must stay green unedited.
- **Card head layout for viewers.** `showCardHead` (`:4148`) is unchanged; a viewer's untimed, cost-free card still has no head row.
- **Moves between days, import/restore**: untouched.

Any red test in `tripDayViewOrphanSegments.test.tsx`, `tripDayViewLayout.test.tsx`, `tripDayViewDayChange.test.tsx`, `dayPlanChangeUndo.test.ts`, `dayPlanPush.test.ts` or the move-between-days suites is a regression. Do not edit it to pass.

### Testing

`vitest` (`npm test`; serial, single fork) against real SQLite (`test/setup.ts`), no repository mocks. Component suites use `// @vitest-environment jsdom`, `renderWithProviders`, `stubFetch`/`mockFetchResponse` (`test/helpers/mockFetch.ts`). Route suites build `NextRequest` with `createSessionJwt` and `routeContext(tripId)` (`test/helpers/routeContext.ts`). Reuse the fixtures in `test/dayPlanChangeSweep.test.ts`, `dayPlanChangeUndo.test.ts` and `dayPlanChangePush.test.ts` (`createItem`, `createLeg`, `seedDay`, `databaseState`) and `test/helpers/createDayPlanItem.ts`.

- **`test/dayPlanPush.test.ts`** (extend; write first): every worked example above; up/down equivalence; no timed neighbour (first up, last down, untimed item, untimed neighbour) → `not_reorderable`; unreadable start → `not_reorderable`; the zero-length tie (+1 min); the predecessor-side tie → `not_reorderable`; midnight on a pushed row names that row; property: for random small days and every allowed (item, direction), re-sorting `order` with the comparator yields `order`, and B is directly before A.
- **`test/dayPlanChangeReorder.test.ts`** (new; repository + route): success writes the times, the receipt (`edited.kind`, both pair rows first in `movedItems`, stamps), and the DB matches; legs swept (AC3), none created; a pre-existing undrawn B→A survives and is counted; `past_midnight` → 409 with details, **whole-DB snapshot unchanged**; `not_reorderable` → 409, DB unchanged; missing item → 404; viewer → 404; CSRF → 403; bad `direction` → 400; check-in warning present with explicit `checkInTime`.
- **`test/dayPlanChangeReorderConflict.test.ts`** (new; own file because `vi.mock` is file-wide, as 11.2 did): a concurrent `updatedAt` change between read and write → `409 day_plan_changed`, nothing written.
- **`test/dayPlanChangeUndo.test.ts`** additions: undo of a reorder with a push and a swept leg restores the whole DB identically (`toEqual`, including `updatedAt`); stale when a pair row or a pushed row was edited since; tampered (re-signed) receipts: `neighbourId === itemId`, an id missing from `movedItems`, a `consumedBucketListItem` → 400.
- **`test/dayChangeReceipt.test.ts`** additions: `reordered` round-trips through wire; `receiptHasSideEffects` true; summary "Reihenfolge geändert", "Reihenfolge geändert · 1 Aktivität verschoben · 1 Fahrt entfernt", in both languages, counting moved items excluding the pair.
- **`test/tripDayViewReorder.test.tsx`** (new, jsdom, stubbed fetch): the trigger is absent for a viewer, for an untimed activity and for a lone timed one; the first timed activity's menu has only *Nach unten*, the last only *Nach oben*, a middle one both; trigger has the accessible name, `aria-haspopup`, `aria-expanded` toggling; items are named exactly "Nach oben"/"Nach unten" (de) and render the 44px `&&` rule; choosing an item closes the menu, POSTs `{ tripDayId, itemId, direction }` with the CSRF header, shows the notice with "Reihenfolge geändert", and reloads the day; a 409 `day_plan_past_midnight` shows the error naming the activity **after** the reload (Read-this-first §6) and no notice; `day_plan_changed` shows `reorderStale`; clicking the trigger does not open the edit dialog; a double click sends one request.

### Project Structure Notes

- **No schema change, no migration, no new dependency, no `sortOrder` column** (the proposal's central design point; the reorder keeps the comparator order true by construction).
- **New files:** `src/app/api/trips/[id]/day-plan-items/reorder/route.ts`, `test/dayPlanChangeReorder.test.ts`, `test/dayPlanChangeReorderConflict.test.ts`, `test/tripDayViewReorder.test.tsx`.
- **Modified:** `src/lib/trips/dayPlanPush.ts`, `src/lib/trips/dayChangeReceipt.ts`, `src/lib/validation/dayChangeReceiptSchemas.ts`, `src/lib/validation/dayPlanItemSchemas.ts`, `src/lib/repositories/dayPlanItemRepo.ts`, `src/lib/repositories/dayPlanChangeRepo.ts`, `src/app/api/trips/[id]/day-plan-items/route.ts` (only if the midnight response helper is extracted from it), `src/components/features/trips/TripDayView.tsx`, both dictionaries, `test/dayPlanPush.test.ts`, `test/dayPlanChangeUndo.test.ts`, `test/dayChangeReceipt.test.ts`.
- **Ignore `.kilo/worktrees/fern-bugle/`**, a stale copy of the app.
- Stack (unchanged, no upgrade): Next 16.2, React 19.2, MUI 7.3, Prisma 7.3 (SQLite), Zod 4.1, Vitest 3.2. No external research needed: no new library or API is involved.

### Previous story intelligence (11.1, 11.2)

- **Receipts are signed** (HMAC, trip + user). Tamper tests must re-sign forgeries to reach the schema and ownership checks (existing tamper block in `dayPlanChangeUndo.test.ts`).
- **Prisma 7 honours an explicit `updatedAt`** on `updateMany`; `applyPushMovesInTransaction` relies on it. Reuse it rather than writing a second conditional-update loop.
- **The +1-minute tie shift** was Tommy's ruling in 11.2's review (keep the order with the smallest shift). This story applies the same rule to the pair (AC7). The predecessor-side tie is refused instead because the only fix would move a row earlier than the pair's start, which the proposal never allows.
- **A retime with unchanged times plans nothing** (11.2 review patch). Not relevant to reorder, which always changes two rows, but do not route reorder through `planDayPush`'s retime branch.
- **Deferred and still open:** DW-371 (legacy unreadable rows stop the walk; the reorder refuses on an unreadable pair, consistent), DW-372 (undo can restore on top of a row created after the change; applies to reorder receipts equally, unchanged), DW-373 (a Prisma transaction error under contention returns 500, unchanged).
- **Not verified in a real browser** was 11.1's and 11.2's caveat. This story adds a control to every planner's card head; if a browser pass is done, measure the trigger at 44×44 at 390px and at 747px (DW-180's lesson: MUI's `sm` reset only shows above phone width), and check that a long title still wraps beside the pills.

### Git intelligence

Last commits (`7780dfb bugfix 2`, `3604d9d bugfix`, `b2a1c1c 10-2`, `5c44eb0 10-1`, `075fc2f 8-2`) predate Epic 11; 11.1 and 11.2 are uncommitted in the working tree. Do not rely on `git diff HEAD` to see only this story's changes: record this story's file list explicitly.

### References

- Epic and ACs: [epics.md#Story 11.3](../planning-artifacts/epics.md); rules: [sprint-change-proposal-2026-10-10.md §2, §3 success criteria, §5 decision 5](../planning-artifacts/sprint-change-proposal-2026-10-10.md)
- Previous stories: [11-1-travel-legs-that-leave-with-their-place-in-the-day.md](11-1-travel-legs-that-leave-with-their-place-in-the-day.md), [11-2-the-rest-of-the-day-moves-back-with-it.md](11-2-the-rest-of-the-day-moves-back-with-it.md)
- Push rule: `src/lib/trips/dayPlanPush.ts`; order: `src/lib/trips/dayPlanItemOrder.ts`; drawn pairs: `src/lib/trips/daySegmentPairs.ts`; sweep: `travelSegmentRepo.ts` `sweepNoLongerDrawnSegmentsInTransaction`
- Menu precedents: day hero menu `TripDayView.tsx:3443-3630` (`DAY_MENU_ITEM_SX` `:809`), document menu `:4772-4810`; icons `TripIcons.tsx:143-176`
- Component: `src/components/ui/ActionNotice.tsx`; DESIGN.md `action-notice`, `icon-button`; EXPERIENCE.md *Change with side effects*, *icon-button*
- API envelope: `src/lib/http/response.ts`, `src/lib/errors/apiError.ts`

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (claude-opus-5-5), via bmad-dev-story, 2026-10-11.

### Debug Log References

- Task 0 baseline: 166 files / 2723 tests green, typecheck 0, lint 80 warnings (0 errors). Ran to completion before the first edit.
- Final gates: 169 files / 2770 tests green (+3 files, +47 tests), typecheck 0, lint 80 warnings (0 errors), unchanged.
- One red during development, in the new component suite only: asserting `aria-expanded` on another card's trigger via `getByRole` while the menu was open returned null, because MUI's modal menu hides the page from the accessibility tree. The assertion now finds the other triggers by test id. Not a product defect.
- Mutation checks (each change reverted after): dropping the reorder in-flight guard fails the double-click test; setting the past-midnight error before the reload fails the refusal test; removing either new `findInvalidity` rule for `reordered` fails its tamper test; removing the interloper from the conflict suite turns its 409 into a 200.

### Completion Notes List

- **Pure function (AC1, 2, 5, 6, 7, 12).** `dayPlanPush.ts`: the walk loop of `planDayPush` is now the private `walkFrom(order, startIndex, legMinutes, startMoved)`, with `buildLegMinutes`, `shiftItem` and `toMove` as small helpers. `planDayPush` calls it with `startMoved = false`, and its 21 existing tests pass with no test changes. The new `planDayReorder` sorts the day, finds the neighbour, shifts `second` to `first`'s start, puts `first` at `end(second') + leg(second→first)` (one minute later when the comparator would still sort `first` first), refuses the predecessor-side tie, then walks from `first'` with `startMoved = true`. `moves` lists `second` first, then `first`, then the walk's moves.
- **One case the spec did not cover:** shifting `second` earlier can push an imported overnight `toTime` (for example `23:00–01:00`) below `00:00`. `shiftItem` treats a value under 0 as out of the day, and `planDayReorder` answers `not_reorderable`. It cannot happen with the push's later shifts, so `planDayPush` behaves exactly as before.
- **Receipt (AC8, 9).** New edited kind `{ kind: "reordered", itemId, neighbourId }`, still `version: 2`. It has a strict schema variant. `receiptHasSideEffects` is always true for it. The summary starts with `trips.dayChange.reordered` and counts moved items by id, leaving out the pair.
- **Undo (AC10).** `findInvalidity` refuses `itemId === neighbourId` and a pair that is not in `movedItems`, and skips the "edited item listed as moved" rule only for `reordered`. The existing non-create rule already refuses a `consumedBucketListItem`. In phases 1 and 2 the `else` branches are now explicit `else if (edited.kind === "deleted")`, so a reorder never falls into the delete path. The pair is checked and restored through the existing moved-items loops.
- **Repository (AC3, 5, 6, 8, 11).** New `reorderDayPlanItemForTripDay`. The writer clause comes first. Then one transaction does: existence check (`missing`), `readPushInputInTransaction` (the read `planPushInTransaction` now shares), plan, return any refusal before writing, then `applyPushMovesInTransaction`, `sweepNoLongerDrawnSegmentsInTransaction`, `findCheckInWarningInTransaction` and `buildReceipt`.
- **Route (AC4, 5, 6, 8, 11).** New `POST day-plan-items/reorder`. Guards run in the same order as the items POST. `dayPlanItemReorderSchema` validates the body. Refusals map to `404` / `409 day_plan_not_reorderable` / `409 day_plan_past_midnight` / `409 day_plan_changed` / `500`. The push-refusal helpers (`pastMidnightResponse`, `pushRefusalResponse`, `withPushConflict`, `dayChangedResponse`) moved out of `day-plan-items/route.ts` into the new `src/lib/http/dayPlanPushResponses.ts`, because a route module may export only its handlers. Their strings and shapes are unchanged.
- **UI (AC4, 9, 13, 14).** `TripDayView.tsx`: each card computes `canMoveUp` / `canMoveDown` from `planItems`. A 44×44 `MoreVerticalIcon` `IconButton` appears in the head row's right-hand cluster only when `canEditPlanning` is true and at least one move is allowed. It has a negative block margin so the head row stays the same height. One shared `<Menu id="day-plan-item-overflow-menu">` holds the items, which use `DAY_MENU_ITEM_SX` (`&&`). The menu closes on a day change and when planning rights drop. `handleReorderPlan` closes the menu first, uses a synchronous in-flight ref, discards the earlier receipt, posts, then takes the receipt and reloads; on a refusal it reloads first and then sets the error.
- **Strings (AC15).** Eight keys added to both dictionaries, next to `trips.plan.untitledActivity` and at the head of the `trips.dayChange.*` block. `i18nDictionaries.test.ts` is green.
- **Existing tests whose expectations changed:** none. `test/dayPlanPush.test.ts`, `test/dayChangeReceipt.test.ts` and `test/dayPlanChangeUndo.test.ts` only gained cases. Their import lists grew to take the new exports. Every regression suite the story names (`tripDayViewOrphanSegments`, `tripDayViewLayout`, `tripDayViewDayChange`, `dayPlanChangeUndo`, `dayPlanPush`, move-between-days) is green and unedited apart from those additions.
- **Real-browser pass: not done.** The 44×44 trigger at 390px and 747px, and long-title wrapping beside the pills, are unmeasured. Like 11.1 and 11.2, this story is verified in jsdom only. jsdom does confirm that the items declare `min-height: 44px` at doubled-class specificity, but it cannot lay anything out.

### File List

New:
- travelplan/src/app/api/trips/[id]/day-plan-items/reorder/route.ts
- travelplan/src/lib/http/dayPlanPushResponses.ts
- travelplan/test/dayPlanChangeReorder.test.ts
- travelplan/test/dayPlanChangeReorderConflict.test.ts
- travelplan/test/tripDayViewReorder.test.tsx

Modified:
- travelplan/src/lib/trips/dayPlanPush.ts
- travelplan/src/lib/trips/dayChangeReceipt.ts
- travelplan/src/lib/validation/dayChangeReceiptSchemas.ts
- travelplan/src/lib/validation/dayPlanItemSchemas.ts
- travelplan/src/lib/repositories/dayPlanItemRepo.ts
- travelplan/src/lib/repositories/dayPlanChangeRepo.ts
- travelplan/src/app/api/trips/[id]/day-plan-items/route.ts
- travelplan/src/components/features/trips/TripDayView.tsx
- travelplan/src/i18n/en.ts
- travelplan/src/i18n/de.ts
- travelplan/test/dayPlanPush.test.ts
- travelplan/test/dayChangeReceipt.test.ts
- travelplan/test/dayPlanChangeUndo.test.ts
- _bmad-output/implementation-artifacts/11-3-one-place-earlier-one-place-later.md
- _bmad-output/implementation-artifacts/sprint-status.yaml

## Change Log

- 2026-10-11: Implemented Story 11.3 (*Nach oben* / *Nach unten*): pure `planDayReorder` over the extracted 11.2 walk; receipt kind `reordered` (version stays 2) and its undo rules; `reorderDayPlanItemForTripDay` and `POST day-plan-items/reorder`; the activity overflow trigger and shared menu in the day view; 8 strings per language. Shared push-refusal HTTP helpers extracted to `src/lib/http/dayPlanPushResponses.ts`. 169 files / 2770 tests green, typecheck 0, lint 80 warnings unchanged. Status → review.
- 2026-10-11: Code review (bmad-code-review). 3 patches applied: a 404 reorder reloads the day before showing the error; the overnight below-00:00 refusal is in the route docblock and pinned by a unit test; UI tests for reload-on-refusal, 404 and the trigger's 44×44. Deferred DW-374..376; DW-372/373 now cover reorders too. 14 dismissed. 169 files / 2773 tests green, typecheck 0, lint 80 warnings unchanged. Status → done.
