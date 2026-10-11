---
baseline_commit: 7780dfb52ac0e5d0b0a9ca7e4c2e5e9043df7219
---

# Story 11.2: The Rest of the Day Moves Back With It

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As someone inserting a stop or letting an activity run longer,
I want every later activity pushed back just as far as it has to go,
so that I do not have to retime the rest of the day one entry at a time, working out the travel time in my head.

**FRs covered:** FR42 (push rule). **Depends on:** Story 11.1 (done), whose change receipt this story extends. **Bundles** DW-216.
Sources: [epics.md#Story 11.2](../planning-artifacts/epics.md), [sprint-change-proposal-2026-10-10.md](../planning-artifacts/sprint-change-proposal-2026-10-10.md) §2 *Technical impact* (rules 1–4, 6, 7; *Server-side and in one transaction*), §5 *Decisions recorded* (2, 3, 4a, 4b, 6, 7), DESIGN.md `action-notice` (warning line), EXPERIENCE.md *Change with side effects* (refusals stay in the dialog).

All code paths below are relative to `travelplan/`. Line numbers were read in the working tree **after** Story 11.1 (11.1 is not yet committed; baseline commit `7780dfb` plus the 11.1 diff).

## Read this first: what the epic's wording assumes that the code does not

Each item was checked against the working tree. Each one changes what a task asks for.

1. **Times are always present on an API write.** `dayPlanItemMutationSchema` requires `fromTime` and `toTime` and refuses `toTime <= fromTime` (`src/lib/validation/dayPlanItemSchemas.ts:70-113`). Untimed activities, and activities with a `fromTime` but no `toTime` or an inverted pair, exist only from imports and older rows. So "an untimed one given a time" is a PATCH of an imported row, and "clearing times" is not reachable (11.1 recorded the same). The pure function still has to handle the imported shapes when they appear as *other* activities on the day (see *The push rule, precisely*).
2. **Several of Story 11.1's tests reach an order change by retiming an activity past its neighbour.** That route to reordering is exactly what this story removes (ruling 6). `retimeAAfterB` in `test/dayPlanChangeUndo.test.ts:125-137` (A 09:00 → 13:30, past B at 12:00) now **keeps A first and pushes B and C**, and sweeps nothing. `test/dayPlanChangeSweep.test.ts:124` ("sweeps the legs a retime breaks when it changes the order") now pushes instead of sweeping. These are sanctioned rewrites (see *Existing tests this story deliberately changes*). Order changes are still reachable through creation, an untimed row gaining a time, and delete.
3. **`HH:MM` has no 24:00.** `normalizeTime` caps hours at 23 (`dayPlanItemSchemas.ts:58-68`), so the largest storable end is `23:59`. Midnight refusal means: any shifted `fromTime` or `toTime` above `23:59` (1439 minutes).
4. **The check-in warning needs data the receipt does not carry.** The notice renders only what the day view holds. Put the warning into the receipt (it is signed with the rest; undo ignores it). "The night's stay" is `day.accommodation` (`TripDay.accommodation`, `prisma/schema.prisma`; `currentStay` in `TripDayView.tsx:1989`). "Explicit" means a non-empty stored `checkInTime`; the 16:00 default lives only in the client (`TripDayView.tsx:743`, `resolveStayTime` at `:1986`) and must never trigger the warning.
5. **The predecessor message points at *Nach oben*, which only ships in Story 11.3.** The epic rules the copy this way. Write it as ruled; if 11.3 has not shipped when this one does, the message names a control that does not exist yet. That is a known, accepted gap until 11.3 lands (it is the next story). Do not build *Nach oben* here.
6. **The dialog has no code-to-message branch for refusals that name another activity.** `TripDayPlanDialog.tsx:1614-1658` maps `validation_error` field errors and otherwise calls `resolveApiError(code, fallback)` (`:1269-1288`), which knows only generic codes. The two new refusals need their own branch, with the activity's title from `error.details`.
7. **A refused save must write nothing, including on the conversion path.** `convertBucketListItemToDayPlanItemForTripDay` deletes the bucket-list row inside its transaction (`dayPlanItemRepo.ts:623-631`). The push plan, and both refusals, must be decided **before the first write** of every path.
8. **DW-216's "three copies" is now one.** `tripRepo.ts` and `travelSegmentRepo.ts` already import the canonical `compareDayPlanItemsByStartTime` (`src/lib/trips/dayPlanItemOrder.ts:67`). The one surviving private copy is `dayPlanItemRepo.ts:391-407`, used by `listDayPlanItemsForTripDay` (`:499`). The canonical one also accepts `Date | string` and returns `0` on an unknown `createdAt`; with Prisma `Date`s the result is identical.

## Acceptance Criteria

1. **AC1: The push walk.**
   - **Trigger:** a timed activity is created (both create paths), retimed or extended through POST or PATCH on `/api/trips/{id}/day-plan-items`.
   - **Walk:** starting at the edited activity, walk the following *timed* activities in day order. For each next activity, its earliest allowed start is `prev.end + leg(prev → next).durationMinutes`, or `prev.end` if no such leg exists. If it starts earlier than that, it moves to exactly that start and keeps its duration.
   - **Leg:** the stored `TravelSegment` from `prev` to `next` (directional, `DAY_PLAN_ITEM` both ends). In the post-change order these two are consecutive, so any such row is drawn. A leg the same change sweeps (11.1) never counts.
2. **AC2: The walk stops at the first activity that fits.** When an activity already starts at or after its earliest allowed start, the walk stops there and no activity after it moves.
3. **AC3: Never pull forward.** A shortened activity, an activity moved later with slack to spare, and a deleted activity move no other activity earlier. DELETE never runs the walk.
4. **AC4: Untimed activities are skipped.** Activities with no `fromTime` are not walked, never acquire a time and never stop the walk.
5. **AC5: The predecessor refusal.**
   - **When:** a PATCH of an already-timed activity gives it a start that the canonical comparator would place before its timed predecessor (the timed activity directly before it in the day's current order). That is `newFrom < predecessor.fromTime`, or an equal start where the comparator's `createdAt`/`id` tiebreak would put the edited one first.
   - **Response:** `409` with code `day_plan_before_predecessor` and `details: { predecessorId, predecessorTitle, predecessorFromTime }`. Nothing is written.
   - **Dialog:** an inline error on the start-time field naming the predecessor and pointing to *Nach oben* (strings in Task 8). The dialog stays open.
   - **An overlap with the predecessor's end alone is accepted,** as today.
6. **AC6: Moving past the successor keeps the place.** A PATCH whose new start falls after its successor's start is accepted. The activity keeps its position; the successor and everything after it are pushed by the walk.
7. **AC7: Insertion sets the position.** A new activity, or an untimed activity given a time, is placed where the canonical comparator sorts it, and the walk runs from it. It never moves its predecessor.
8. **AC8: Midnight refusal.**
   - **When:** the walk would move any activity's `fromTime` or `toTime` past `23:59`.
   - **Response:** `409` with code `day_plan_past_midnight` and `details: { itemId, itemTitle }` naming the first activity that would not fit. Nothing is written, no leg is swept, no bucket-list row is consumed.
   - **Dialog:** an error in the dialog's error banner (`serverError`) naming that activity. The dialog stays open.
9. **AC9: The check-in warning.**
   - **When:** the change moved at least one other activity, the day has a stay with an explicit `checkInTime`, and the last timed activity's end (after the push), plus the duration of a drawn leg from it to that stay, is later than `checkInTime`.
   - **Then:** the change is saved, the receipt carries `checkInWarning: { accommodationId, checkInTime }`, and the `action-notice` shows a warning line in `{colors.warn}` (`ActionNotice`'s existing `warning` prop).
   - **Never:** for an assumed (default 16:00) check-in, or for a change that moved nothing.
   - **Drawn leg to the stay:** only when the last timed activity is the last activity on the timeline (no untimed activities after it). Otherwise count no leg.
10. **AC10: Moved activities are in the receipt and undone with the rest.**
    - The receipt lists every moved activity as `{ itemId, previousFromTime, previousToTime, previousUpdatedAt, updatedAt }` (`updatedAt` after the write).
    - `receiptHasSideEffects` is true when anything moved or any leg was removed.
    - The summary reads "3 Aktivitäten verschoben" / "1 Aktivität verschoben", before the legs part: "3 Aktivitäten verschoben · 1 Fahrt entfernt".
    - *Rückgängig* restores each moved activity's `fromTime`, `toTime` and `updatedAt` in the same transaction as everything 11.1 restores, and refuses (`409 undo_stale`) if any moved activity's `updatedAt` differs from the receipt.
11. **AC11: Server-side, in the edit's own transaction.** The walk reads the day's items and legs through `tx`, inside the same `prisma.$transaction` as the edit, and writes every move there. The client renders the server's result (`handlePlanDialogSaved` already reloads the day) and never computes times itself.
12. **AC12: DW-216.** The private comparator copy in `dayPlanItemRepo.ts` is removed. `listDayPlanItemsForTripDay` and the walk use the canonical `compareDayPlanItemsByStartTime`. DW-216 is closed in the ledger.
13. **AC13: A pure, tested push function.** The rule is one pure function over the day's timeline (no Prisma, no I/O), unit-tested for at least: slack absorbed with no push; a chain push; a push stopping mid-day; untimed activities skipped; a leg's duration counted; the midnight refusal; the predecessor refusal.
14. **AC14: Unchanged surfaces.** Moving activities between days (6.7, 6.23, `swapDayPlanItemsBetweenTripDays`), import/restore, and the travel-segment routes do not run the walk. A moved-in activity may overlap the target day, as today.
15. **AC15: Both dictionaries.** Every new key is in both `src/i18n/en.ts` and `src/i18n/de.ts`; `test/i18nDictionaries.test.ts` stays green.

## Tasks / Subtasks

- [x] **Task 0: Baseline.** In `travelplan/`, run `npm test`, `npm run typecheck`, `npm run lint`. Record file/test counts and lint problems. Expected from 11.1's close: 163 files / 2668 tests, typecheck 0, lint 80 warnings. (AC: all)

- [x] **Task 1: DW-216** (AC: 12)
  - [x] Delete the private `compareDayPlanItemsByStartTime` in `dayPlanItemRepo.ts:391-407`; import the canonical one from `@/lib/trips/dayPlanItemOrder`.
  - [x] Update the docblock in `dayPlanItemOrder.ts:28-32`, which still says "exactly one private copy survives … (DW-216)".
  - [x] Ledger: set DW-216 (`deferred-work.md:1373`) to `status: done 2026-10-1x` with `resolution: resolved by Story 11.2 …`, matching neighbouring closed entries.

- [x] **Task 2: The pure push function** (AC: 1, 2, 4, 5, 6, 7, 8, 13)
  - [x] New `src/lib/trips/dayPlanPush.ts`, no Prisma import (same rule as `dayChangeReceipt.ts`). Suggested API:

    ```ts
    export type PushItem = { id: string; title: string | null; fromTime: string | null; toTime: string | null; createdAt: Date | string };
    export type PushLeg = { fromItemId: string; toItemId: string; durationMinutes: number }; // DAY_PLAN_ITEM → DAY_PLAN_ITEM only
    export type PushEdit =
      | { kind: "insert"; item: PushItem }                                   // create, or an untimed row gaining a time
      | { kind: "retime"; itemId: string; fromTime: string; toTime: string }; // an already-timed row
    export type PushMove = { itemId: string; previousFromTime: string; previousToTime: string | null; fromTime: string; toTime: string | null };
    export type PushPlan =
      | { status: "ok"; order: PushItem[]; moves: PushMove[] }      // order = post-change, post-push timed+untimed order
      | { status: "before_predecessor"; predecessor: { id: string; title: string | null; fromTime: string } }
      | { status: "past_midnight"; item: { id: string; title: string | null } };
    export const planDayPush = (input: { items: PushItem[]; legs: PushLeg[]; edit: PushEdit }): PushPlan;
    ```
  - [x] Order with the canonical `compareDayPlanItemsByStartTime`. For `retime`, the edited row **keeps its index** in the current order (do not re-sort); check the predecessor first (AC5), then walk from it. For `insert` (including an untimed row given a time: remove it from the list first, then insert it), sort it in, then walk from it.
  - [x] Minutes arithmetic with a local `HH:MM` ↔ minutes helper; format back with zero padding. Do not import from `dayPlanItemSchemas.ts` (its `toMinutes` is private and the module pulls Zod into the client).
  - [x] Return `moves` only for activities other than the edited one, in walk order.
  - [x] Pure, deterministic, no `Date.now()`. Unit-test it before wiring it in (Task 9).

- [x] **Task 3: Wire the walk into the three write paths** (AC: 1, 5, 6, 7, 8, 9, 11)
  - [x] In `dayPlanItemRepo.ts`, inside each transaction and **before its first write**:
    1. read the day's items (`id, title, fromTime, toTime, createdAt, updatedAt`) and the day's `DAY_PLAN_ITEM → DAY_PLAN_ITEM` segments through `tx`;
    2. call `planDayPush`;
    3. on a refusal, return it as a new result status (no write has happened, so the transaction commits nothing).
  - [x] Paths and edit kinds:
    - `createDayPlanItemForTripDay` (`:502-561`): `insert`. The new row's `createdAt` is not known before the create; pass `new Date()` taken once in the transaction (it sorts last among equal starts, which is where a fresh row sorts today). After the create, use its real id when applying the plan's moves.
    - `convertBucketListItemToDayPlanItemForTripDay` (`:563-652`): `insert`, decided **before** `deleteBucketListItemForTripInTransaction` and before the create. A refusal leaves the idea in place.
    - `updateDayPlanItemForTripDay` (`:654-734`): `retime` if `existing.fromTime` is set, `insert` if it is null.
    - `deleteDayPlanItemInTransaction`: **no walk** (AC3).
  - [x] Apply each move as `tx.dayPlanItem.updateMany({ where: { id, tripDayId, updatedAt: <read updatedAt> }, data: { fromTime, toTime, updatedAt: now } })`, with one `const now = new Date()` per transaction. On `count !== 1` throw a typed error so the whole transaction rolls back (another write slipped in), and map it in the route to `409 day_plan_changed` (Task 8 string). Story 11.1 pinned that Prisma 7 honours an explicit `updatedAt` on `updateMany`, so `now` is the post-write value the receipt records.
  - [x] Order inside the transaction: read → plan → `drawnBefore` (11.1) → edit write → payments → moves → sweep (11.1) → check-in warning → receipt. The pushes keep the order, so the sweep result is the same before or after them; running it after is what keeps the sweep reading the final day.
  - [x] Check-in warning (AC9): only when `moves.length > 0`. Read `day.accommodation` (`id`, `checkInTime`) through `tx`; skip when `checkInTime` is null or blank. Take the last timed activity of the final order; if it is also the last activity on the day, add the duration of a stored leg `DAY_PLAN_ITEM(last) → ACCOMMODATION(stay)` if one exists. Compare in minutes (the sum may pass 1440; compare numerically, never format it).
  - [x] Result types gain `{ status: "before_predecessor"; predecessor } | { status: "past_midnight"; item }`. `createDayPlanItemForTripDay` currently returns `DayPlanItemCreateResult | null`; widen it to a union and keep `null` for "not your day" so the route's existing `!created` branch is unchanged.

- [x] **Task 4: Extend the receipt** (AC: 9, 10)
  - [x] `src/lib/trips/dayChangeReceipt.ts`:
    - add `movedItems: MovedItemRow<T>[]` (always present, possibly empty) with `{ itemId; previousFromTime: string | null; previousToTime: string | null; previousUpdatedAt: T; updatedAt: T }`;
    - add optional `checkInWarning?: { accommodationId: string; checkInTime: string }`;
    - bump `version` to `2` (a v1 receipt held by a client across a deploy is then refused as `400 → unavailable`, which 11.1's client already handles — better than misreading it);
    - extend `mapReceipt` for both new fields;
    - `receiptHasSideEffects`: `removedTravelSegments.length > 0 || movedItems.length > 0`;
    - `summarizeDayChangeReceipt`: moved part first, then legs, joined with `" · "`;
    - new `checkInWarningText(receipt, t)` returning the formatted warning or `undefined`.
    - Update the module docblock ("In this story, a removed leg is the only side effect").
  - [x] `buildReceipt` in `dayPlanItemRepo.ts:413-424` takes `movedItems` and `checkInWarning`. DELETE passes `[]`.
  - [x] `src/lib/validation/dayChangeReceiptSchemas.ts`: `version: z.literal(2)`; `movedItems: z.array(movedItemSchema).max(MAX_LEGS)` with `.strict()` rows (ids bounded, times `nullableText()`, stamps ISO); `checkInWarning` optional and strict. Keep the "no business rules re-applied" stance.

- [x] **Task 5: Undo restores moved activities** (AC: 10)
  - [x] `dayPlanChangeRepo.ts`:
    - **`findInvalidity`:** refuse duplicate `movedItems` ids, and a moved id equal to the edited item's id.
    - **Staleness (phase 1):** each moved item exists on `receipt.tripDayId` with `updatedAt` equal (epoch ms) to the receipt's `updatedAt`, else `UndoStaleError`.
    - **Reverse (phase 2):** after the edited item is restored and before legs are recreated, for each moved item `updateMany({ where: { id, tripDayId, updatedAt }, data: { fromTime: previousFromTime, toTime: previousToTime, updatedAt: previousUpdatedAt } })`, `count === 1` or throw.
    - **Post-condition (phase 3):** unchanged; restoring times restores the original order, so the drawn sets hold.
  - [x] Update the module docblock's phase description.
  - [x] No route change in `day-plan-changes/undo/route.ts` beyond what the schema brings.

- [x] **Task 6: Routes** (AC: 5, 8)
  - [x] `src/app/api/trips/[id]/day-plan-items/route.ts`, POST and PATCH: map the new statuses before the success body:
    - `before_predecessor` → `fail(apiError("day_plan_before_predecessor", "Start is before the previous activity", { predecessorId, predecessorTitle, predecessorFromTime }), 409)`
    - `past_midnight` → `fail(apiError("day_plan_past_midnight", "The change would push an activity past midnight", { itemId, itemTitle }), 409)`
    - the concurrent-edit error from Task 3 → `409 day_plan_changed`.
  - [x] Success bodies unchanged: `dayPlanItem` + signed `receipt`.

- [x] **Task 7: Client** (AC: 5, 8, 9, 10)
  - [x] `TripDayPlanDialog.tsx` save error branch (`:1614-1658`), before the generic fallback:
    - `day_plan_before_predecessor`: set `fieldErrors.fromTime` to `formatMessage(t("trips.plan.beforePredecessor"), { title })` and `revealFirstError` so the times tab is shown and the field focused;
    - `day_plan_past_midnight`: `setServerError(formatMessage(t("trips.plan.pastMidnight"), { title }))`;
    - `day_plan_changed`: `setServerError(t("trips.plan.dayChangedConflict"))`.
    - `title` is `details.predecessorTitle` / `details.itemTitle`, or `t("trips.plan.untitledActivity")` when null or blank (imported rows can be untitled).
  - [x] `TripDayView.tsx` `<ActionNotice>` (`:3679-3692`): pass `warning={undoWithdrawn ? undefined : checkInWarningText(dayChange.receipt, t)}`. Nothing else in the view changes: `takeDayChangeReceipt` already uses `receiptHasSideEffects`, and `handlePlanDialogSaved` already reloads the day.
  - [x] Do not compute or preview pushed times on the client (AC11).

- [x] **Task 8: Strings** (AC: 15). Both dictionaries, same relative order, next to the `trips.dayChange.*` block (`de.ts:627-633`) and the `trips.plan.*` save keys:

  | Key | de | en |
  |---|---|---|
  | `trips.dayChange.itemsMovedOne` | 1 Aktivität verschoben | 1 activity moved |
  | `trips.dayChange.itemsMoved` | {count} Aktivitäten verschoben | {count} activities moved |
  | `trips.dayChange.checkInWarning` | Die Ankunft in der Unterkunft liegt nach dem Check-in um {time}. | You will reach your stay after its {time} check-in. |
  | `trips.plan.beforePredecessor` | Beginnt vor „{title}“. Eine Zeitänderung ändert die Reihenfolge nicht – nutze „Nach oben“. | Starts before "{title}". A time change keeps the order – use "Move up". |
  | `trips.plan.pastMidnight` | „{title}“ würde über Mitternacht hinaus verschoben. Nichts wurde gespeichert. | "{title}" would be pushed past midnight. Nothing was saved. |
  | `trips.plan.dayChangedConflict` | Der Tag wurde gerade geändert. Bitte erneut speichern. | The day was just changed. Please save again. |
  | `trips.plan.untitledActivity` | Aktivität ohne Titel | Untitled activity |

  German comment on `itemsMovedOne` like the one on `legsRemovedOne` (no plural rules in `formatMessage`). The English label "Move up" must match 11.3's menu item when it ships.

- [x] **Task 9: Tests** (AC: all). See *Testing*. The pure-function tests are written and green before Task 3.
- [x] **Task 10: Record.** Final gates against Task 0; DW-216 closed (Task 1); in the Completion Notes, list every existing test whose expectation changed, and why.

### Review Findings

Code review 2026-10-11 (Blind Hunter, Edge Case Hunter, Acceptance Auditor). 1 decision, 2 patches, 3 deferred, 10 dismissed.

- [x] [Review][Decision] The +1-minute tie shift goes beyond the spec — A pushed zero-length (imported, `toTime` null) row tying with an older-`createdAt` row that already fits moves that row one minute (`dayPlanPush.ts:153-160`), which conflicts with AC2 ("no activity after it moves") and AC1 ("exactly that start"). It is the smallest shift that keeps the order. The alternatives are refusing the change or accepting the reorder. Whatever is ruled must also cover the push branch (next patch). **Resolved 2026-10-11 (Tommy): keep the +1-minute shift; it applies to the push branch too. Dev Notes amended.**
- [x] [Review][Patch] The tie guard is missing when the next row is itself pushed: it lands exactly on a pushed zero-length row's start, and an older `createdAt` flips the order. Reproduced: A 09:00–10:00, Z 10:00–null (newest), C 10:30–11:30 (oldest); retime A to 09:00–11:00 → Z 11:00, C 11:00, and re-sorting gives A, C, Z. The property test covers only the fits branch [travelplan/src/lib/trips/dayPlanPush.ts:152-162]
- [x] [Review][Patch] A PATCH that leaves the times unchanged still runs the walk: a title- or notes-only save pushes successors that already overlapped (an overlap AC5 accepted, a move-in under AC14, an import), or is refused with `day_plan_past_midnight`. A retime whose times equal the stored ones should plan no moves [travelplan/src/lib/trips/dayPlanPush.ts:117-136, travelplan/src/lib/repositories/dayPlanItemRepo.ts:844-851]
- [x] [Review][Defer] Legacy rows with an unreadable start, or an overnight pair whose end counts as its start, stop the walk or let the next row overlap them [travelplan/src/lib/trips/dayPlanPush.ts:92-97, :150] — deferred, imported data only (DW-371)
- [x] [Review][Defer] Undo can restore a moved activity on top of one created after the push (overlap, possible tie reorder), because staleness covers only rows on the receipt [travelplan/src/lib/repositories/dayPlanChangeRepo.ts] — deferred (DW-372)
- [x] [Review][Defer] A lost race that surfaces as a Prisma transaction error (P2034/P2028, SQLITE_BUSY) returns 500, not `409 day_plan_changed` [travelplan/src/app/api/trips/[id]/day-plan-items/route.ts] — deferred, single-process better-sqlite3 (DW-373)

## Dev Notes

### The push rule, precisely

- **Timed** = `fromTime` non-empty (the comparator's own test). Untimed rows sort after every timed row, so consecutive timed rows are always consecutive on the timeline. A leg between them is therefore always drawable.
- **End of an activity** = `toTime` in minutes if `toTime` is set and later than `fromTime`; otherwise `fromTime` (zero length). The second case occurs only in imported rows (`toTime` null, or an overnight `23:00–01:00` pair).
- **Shift** = `earliest - start`. A moved activity's `fromTime` and `toTime` (if set) both move by the shift, so the duration is kept and an imported odd pair keeps its shape.
- **Midnight** = any shifted `fromTime` or `toTime` > 1439. Refuse and name that activity (`past_midnight`). Do not clamp.
- **Order is preserved, no tie can flip.** A pushed activity starts at `prev.end + leg ≥ prev.end`. With a positive-length predecessor that is strictly after `prev.start`. With a zero-length predecessor and no leg, `earliest = prev.start ≤ next.start` already, so nothing moves. So the canonical comparator's order after the push equals the plan's `order`. Assert this in a test by re-sorting the result.
- **Predecessor check (retime only)** = `compareDayPlanItemsByStartTime({ ...edited, fromTime: newFrom }, predecessor) < 0` → refuse. Using the comparator rather than `<` covers the equal-start tie, where `createdAt` decides.
- **Ruling (code review, 2026-10-11): the one tie the argument above misses.** A *moved* zero-length row (imported, `toTime` null or an overnight pair) can end up with the same start as the next timed row. If the comparator would sort that next row first (older `createdAt`), the next row moves to one minute past the tie, the smallest shift that keeps the order. This holds both when the next row already fits (the one exception to AC2) and when it is pushed itself. It is reachable only with imported rows.
- **Insert never refuses on order.** It slots where it sorts.
- **The edited activity itself is never moved by the walk.** Its own times are what the user typed and the schema validated.

Worked example (success criterion 1): A 09:00–10:00, B 10:30–11:30, C 12:00–13:00, D 16:00–17:00, leg B→C 20 min. Insert M 10:00–11:30. Order A, M, B, C, D. B: earliest 11:30 → 11:30–12:30 (moved). C: earliest 12:30 + 20 = 12:50 → 12:50–13:50 (moved). D: earliest 13:50, starts 16:00 → stop. Receipt: 2 moved. A→B, if it existed, is swept (11.1) → "2 Aktivitäten verschoben · 1 Fahrt entfernt".

### The receipt, version 2 (wire form)

```ts
type DayChangeReceipt = {
  version: 2;
  tripDayId: string;
  edited: /* unchanged from 11.1 */;
  removedTravelSegments: TravelSegmentRow[];
  movedItems: { itemId: string; previousFromTime: string | null; previousToTime: string | null; previousUpdatedAt: string; updatedAt: string }[];
  consumedBucketListItem?: TripBucketListItemRow;
  checkInWarning?: { accommodationId: string; checkInTime: string };
};
```

`previousUpdatedAt` is beyond the proposal's "previous `fromTime` and `toTime`". It is required by success criterion 3 ("byte for byte on every touched row"), which 11.1's undo tests enforce with a whole-database `toEqual`.

### What must not regress

- **11.1's whole receipt/undo contract**: signing (`dayChangeReceiptSignature.ts`; canonical form sorts keys, so new fields need no signer change), staleness, post-condition, the `unavailable`/`stale` client states, and the AC7 discard points.
- **The sweep's "only what this change un-drew" rule.** Pushes do not change the order, so they cannot un-draw anything. If a test shows a push sweeping a leg, the order changed and that is a bug.
- **Story 6.23's non-healing rule.** Pushing never creates a leg.
- **Writer clause** on every path (Story 5.13), unchanged.
- **Moves between days and the whole-day transfer** (`moveDayPlanItemToTripDay`, `moveDayPlanItemsBetweenTripDays`, `swapDayPlanItemsBetweenTripDays`): no walk, no receipt.
- **Import / restore** (Story 2.35, 8.5 AC8): writes rows directly, never through these repository functions. Confirmed: nothing else in `src` calls `createDayPlanItemForTripDay` or `updateDayPlanItemForTripDay`.
- **DELETE's optimistic removal** in `handleDeletePlan`: still correct, because a delete never moves anything.
- **The orphan list (8.5)**: unchanged.

### Existing tests this story deliberately changes

These assert behaviour that ruling 6 reverses. Rewrite each to the new rule and cite the supersession in its docblock. This is the one sanctioned exception to "never edit an expectation to match":

- `test/dayPlanChangeSweep.test.ts:124` "sweeps the legs a retime breaks when it changes the order": the retime now keeps the order and pushes. Rewrite it as "a retime past the successor keeps the order, pushes, and sweeps nothing", and keep a sweep case that reaches an order change by **insertion** (the existing create and untimed cases may already cover it).
- `test/dayPlanChangeUndo.test.ts` `retimeAAfterB` (`:125-137`) and its callers (the update undo at `:177`, the stale-after-PATCH case at `:271`, and any route case that uses it): A at 13:30 now pushes B and C instead of sweeping two legs. Either change the helper to an order-changing path that still exists (for example, give an untimed row a time), or keep it and assert the moved items. **Keep at least one undo case where the update moves other activities**, which is the new coverage AC10 needs.
- `test/dayPlanChangeUndo.test.ts` receipts with `version: 1` in tamper/forgery fixtures: change to `2`.
- Any case in `test/dayPlanItemRepo.test.ts`, `test/tripDayPlanItemsRoute.test.ts` or the 11.1 suites that creates or retimes activities whose times now trigger a push or a refusal. Example: creating an earlier activity whose end overlaps an existing later one now moves the later one. **Classify every newly red test** in the Completion Notes as either (a) a fixture whose times incidentally collide, fixed by changing the fixture times, not the assertion, or (b) an assertion of the superseded order-by-retime rule, rewritten as above. Anything else is a regression.

Any red test in `tripDayViewOrphanSegments.test.tsx`, `tripDayViewLayout.test.tsx`, `tripDayViewDayChange.test.tsx` (stubbed fetch) or the move-between-days suites is a regression. Do not edit it to pass.

### Testing

`vitest` (`npm test`; serial, a single fork) against real SQLite (`test/setup.ts`), no repository mocks. Component suites use `// @vitest-environment jsdom`, `renderWithProviders`, `stubFetch`/`mockFetchResponse` (`test/helpers/mockFetch.ts`). Route suites build `NextRequest` with `createSessionJwt` and `routeContext(tripId)` (`test/helpers/routeContext.ts`). Reuse the fixtures in `test/dayPlanChangeSweep.test.ts` / `dayPlanChangeUndo.test.ts` (`createItem`, `createLeg`, `seedDay`, `databaseState`).

- **`test/dayPlanPush.test.ts`** (new, pure; write first):
  - slack absorbed, no push;
  - chain push (B and C both move);
  - push stops mid-day (D has slack and stays; nothing after D moves);
  - untimed activities skipped and never given a time;
  - a leg's duration counted (and a leg in the reverse direction, C→B, not counted);
  - midnight refusal names the first activity that would not fit, for both `toTime` and a zero-length (`toTime` null) row;
  - predecessor refusal, including the equal-start tie decided by `createdAt`;
  - retime past the successor keeps the place and pushes;
  - insert slots by time and never moves its predecessor;
  - an untimed row given a time is treated as an insert;
  - shortening and moving later with slack move nothing;
  - property: re-sorting the result with `compareDayPlanItemsByStartTime` yields the plan's order.
- **`test/dayPlanChangePush.test.ts`** (new; repository plus route):
  - create pushes and the receipt lists `movedItems` with previous and post-write stamps; the DB matches;
  - update extends and pushes; update shortens and moves nothing;
  - delete moves nothing;
  - `before_predecessor` → 409 with details, **database unchanged** (whole-DB snapshot);
  - `past_midnight` → 409 with details, database unchanged; on the conversion path the bucket-list row still exists;
  - check-in warning: present with explicit `checkInTime`; absent with null `checkInTime`; absent when nothing moved; leg-to-stay duration counted only when that leg is drawn;
  - `listDayPlanItemsForTripDay` returns the canonical order (DW-216);
  - a concurrent `updatedAt` change between read and move write rolls back (simulate with `vi.mock` + `importActual`, as `dayPlanChangeSweepRollback.test.ts` does) → 409 `day_plan_changed`, nothing written.
- **`test/dayPlanChangeUndo.test.ts`** additions: undo of a create and of an update that moved activities restores every row identical (whole-DB `toEqual`, including `updatedAt`); stale when a moved activity was edited since; tampered `movedItems` (duplicate id, the edited id) → 400.
- **`test/dayChangeReceipt.test.ts`** additions: side effects with only moved items; summary ordering and singular/plural in both languages; `checkInWarningText`; wire round trip with the new fields.
- **`test/tripDayPlanDialog.test.tsx`** additions: 409 `day_plan_before_predecessor` shows the field error with the predecessor's title and keeps the dialog open; `day_plan_past_midnight` shows the banner with the title; a null title uses `untitledActivity`; `onSaved` is not called on any of them.
- **`test/tripDayViewDayChange.test.tsx`** additions: a receipt with moved items shows the notice with the moved summary; a receipt with `checkInWarning` shows the warning line; the warning disappears in the stale state.

### Project Structure Notes

- **No schema change, no migration, no new dependency.** No `sortOrder` column: the proposal's central design point, which depends on the order-preservation argument above.
- **New files:** `src/lib/trips/dayPlanPush.ts`, `test/dayPlanPush.test.ts`, `test/dayPlanChangePush.test.ts`.
- **Modified:** `dayPlanItemRepo.ts`, `dayPlanChangeRepo.ts`, `dayPlanItemOrder.ts` (docblock only), `dayChangeReceipt.ts`, `dayChangeReceiptSchemas.ts`, `day-plan-items/route.ts`, `TripDayPlanDialog.tsx`, `TripDayView.tsx` (one prop), both dictionaries, the tests named above, `deferred-work.md`.
- **Ignore `.kilo/worktrees/fern-bugle/`**, a stale copy of the app.
- Stack (unchanged, no upgrade): Next 16.2, React 19.2, MUI 7.3, Prisma 7.3 (SQLite), Zod 4.1, Vitest 3.2. No external research needed: no new library or API is involved.

### Previous story intelligence (11.1)

- The receipt is **signed** (HMAC, trip + user). The undo route verifies the signature after the Zod parse, and the canonical form sorts keys, so adding fields needs no signer change. Tamper tests must **re-sign** their forgeries to reach the schema and ownership checks (see the existing tamper block in `dayPlanChangeUndo.test.ts:535-620`).
- Prisma 7 honours an explicit `updatedAt` on `create`, `createMany` and `updateMany`. Use `updateMany` with an explicit value, not `update`.
- Post-condition (a) was tightened to "pair drawn" in review. Keep it.
- Client receipt states are `ready | pending | stale | unavailable`; 400/404 on undo withdraw the action. A v1 receipt after this deploy lands in `unavailable`, which is acceptable.
- `isForeignTripUploadUrl` no longer exists; media containment uses `uploadPaths.ts` primitives (already in `dayPlanChangeRepo.ts`).
- "Not verified in a real browser" was 11.1's open caveat. The notice now gains a second line, so check its wrapping at 390px if a browser pass is done.

### References

- Epic and ACs: [epics.md#Story 11.2](../planning-artifacts/epics.md); rules and rulings: [sprint-change-proposal-2026-10-10.md §2, §5](../planning-artifacts/sprint-change-proposal-2026-10-10.md)
- Previous story: [11-1-travel-legs-that-leave-with-their-place-in-the-day.md](11-1-travel-legs-that-leave-with-their-place-in-the-day.md) (receipt shape, staleness table, review findings)
- Order rule: `src/lib/trips/dayPlanItemOrder.ts`; drawn pairs: `src/lib/trips/daySegmentPairs.ts`; timeline: `travelSegmentRepo.ts` `buildSegmentTimelineInTransaction`
- Component: `src/components/ui/ActionNotice.tsx` (`warning` prop, `theme.palette.warning.main`); DESIGN.md `action-notice`; EXPERIENCE.md *Change with side effects*
- API envelope: `src/lib/http/response.ts`, `src/lib/errors/apiError.ts`
- Ledger: DW-216 (closed here), DW-370 (ms-granularity staleness, unchanged), DW-320 (print omits orphans, unchanged)

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (`claude-opus-5-5`), via bmad-dev-story, 2026-10-11.

### Debug Log References

- Task 0 baseline: the run was started in the background and overlapped the first edits (receipt v2), so its 28 failures across 4 files are contaminated and not a baseline. 11.1's recorded close stands as the baseline: 163 files / 2668 tests green, typecheck 0, lint 80 warnings. The overlapping run reported the same file and test counts (163 / 2668), and its lint was 80 warnings.
- Interim full run, after the sanctioned rewrites and before the new suites: 164 files / 2697 tests green. No existing test outside the five classified below went red.
- Final gates: **166 files / 2720 tests green**, `npm run typecheck` 0 errors, `npm run lint` 80 warnings / 0 errors (unchanged).
- Mutation check: removing the `updatedAt` condition from the move write turns `dayPlanChangePushConflict.test.ts` red. Restored and re-verified.

### Completion Notes List

- **Pure rule** (`src/lib/trips/dayPlanPush.ts`): `planDayPush` orders with the canonical comparator. A retime keeps its index and is refused (`before_predecessor`) when the comparator would put it before its timed predecessor. An insert slots in where it sorts. The walk runs `prev.end + leg(prev→next)` over the following timed rows, stops at the first that fits, refuses past 23:59 (`past_midnight`, first activity that would not fit), and never moves the edited row or an untimed one. Rows with unreadable times stop the walk (conservative; imported data only). 19 unit tests, including the story's worked example and a re-sort property check.
- **Decision beyond the spec (please review): the one tie the story's "no tie can flip" argument misses.** If an imported zero-length row (`toTime` null) is pushed onto the exact start of the next row, and that next row has an earlier `createdAt`, the comparator would put the next row first and reorder the day. Example: A runs 09:00–11:00, Z (zero-length, created last) is pushed to 11:00, and C (11:00–12:00, created earlier) already starts at 11:00. The walk then moves the next row **one minute** past the tie (C becomes 11:01–12:01). That is the smallest shift that keeps the order. This only happens with imported zero-length rows. It is pinned by a unit test and covered by the property test.
- **Wiring** (`dayPlanItemRepo.ts`): every path plans the push first, through `tx`, before its first write. So a refusal writes nothing, and on the conversion path the idea is still there. Order inside the transaction: plan → drawnBefore → edit write → payments → moves → sweep → check-in warning → receipt. Moves are `updateMany` conditional on the `updatedAt` read for the plan, all stamped with one `now`. A miss throws `DayPlanChangedError`, which rolls back and is mapped to `409 day_plan_changed`. Create plans with a placeholder id and `createdAt = now`. Update uses `retime` for a timed row and `insert` for an untimed one. DELETE passes `movedItems: []`.
- **Check-in warning**: only when something moved and `accommodation.checkInTime` is non-blank and readable. The arrival time is the last timed activity's end, plus the stored `DAY_PLAN_ITEM → ACCOMMODATION` leg only when that activity is the day's last. The comparison is in plain minutes.
- **Receipt v2**: `movedItems` (always present), optional `checkInWarning`, `version: 2`. Mapping, side effects, summary (moved part first) and `checkInWarningText` updated. The schema has strict rows and still re-applies no business rules. A v1 receipt is now 400 (pinned).
- **Undo**: `findInvalidity` refuses duplicate moved ids and the edited id listed as moved. Phase 1 checks each moved row's stamp. Phase 2 restores times and `previousUpdatedAt` conditionally, after the edited item and before the legs. The undo route itself is unchanged.
- **Route**: `before_predecessor` / `past_midnight` → 409 with the details named in AC5/AC8. `DayPlanChangedError` → 409 `day_plan_changed`. Success bodies are unchanged.
- **Client**: the dialog has a field error on *From* for `before_predecessor` (the times tab is revealed and the field focused), a banner for `past_midnight` and `day_plan_changed`, and `untitledActivity` for a null or blank title. The day view passes `warning={undoWithdrawn ? undefined : checkInWarningText(...)}`. The client never computes times.
- **DW-216 closed**: the private comparator copy is deleted, `listDayPlanItemsForTripDay` uses the canonical one, the `dayPlanItemOrder.ts` docblock is updated, and the ledger entry is marked done 2026-10-11.
- **Known, accepted gap (per the story):** the predecessor message points at *Nach oben* / "Move up", which ships with Story 11.3.
- **Not verified in a real browser.** The notice's second line has not been checked at 390px.
- **Test-file deviation:** the concurrent-write case is in its own file (`test/dayPlanChangePushConflict.test.ts`), not in `dayPlanChangePush.test.ts`, because `vi.mock` applies to a whole file. `test/helpers/createDayPlanItem.ts` was added so the suites that build fixtures through `createDayPlanItemForTripDay` narrow the widened result and fail loudly on an unexpected refusal.

**Existing tests whose expectations changed, classified as the story requires** (no other existing test went red):

1. `test/dayPlanChangeSweep.test.ts` "sweeps the legs a retime breaks when it changes the order" → **(b) superseded rule.** Rewritten as "a retime past the successor keeps the order, pushes, and sweeps nothing". Order-change sweep coverage stays with the create and untimed-gains-time cases.
2. `test/dayPlanChangeUndo.test.ts` "undoes an update…", "refuses after a later PATCH…", "refuses when someone has drawn a new leg…", "refuses when the undo would orphan a leg…", "refuses when an endpoint of a removed leg has been deleted…" → **(b).** They all used `retimeAAfterB`. It is replaced by `seedDayWithUntimed` + `timeUBetweenBAndC` (an untimed row given a time, which still reorders). Each case keeps its intent, and the removed or orphaned pair is now B→C / U→C.
3. `test/tripDayPlanItemsRoute.test.ts` "returns a change receipt on POST, PATCH and DELETE…" → **(b).** The PATCH moved Museum past Park. It now asserts that Park is pushed to 18:20 (`movedItems`, ISO stamp) and no leg is swept, and that the later DELETE removes that still-existing leg. Its `version: 1` pin became `version: 2`.
4. `version: 1` fixtures in `test/dayChangeReceipt.test.ts` and `test/tripDayViewDayChange.test.tsx` → version 2 plus `movedItems: []` (the type change the story names).
5. Type-only: `createDayPlanItemForTripDay` call sites in `dayPlanChangeSweep`, `dayPlanChangeUndo` and `dayPlanItemRepo` tests now go through the narrowing helper. No assertion changed.

No case of type (a), a fixture whose times incidentally collided, occurred.

### File List

- `_bmad-output/implementation-artifacts/11-2-the-rest-of-the-day-moves-back-with-it.md` (modified)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified)
- `_bmad-output/implementation-artifacts/deferred-work.md` (modified: DW-216 closed)
- `travelplan/src/lib/trips/dayPlanPush.ts` (new)
- `travelplan/src/lib/trips/dayPlanItemOrder.ts` (modified, docblock only)
- `travelplan/src/lib/trips/dayChangeReceipt.ts` (modified)
- `travelplan/src/lib/validation/dayChangeReceiptSchemas.ts` (modified)
- `travelplan/src/lib/repositories/dayPlanItemRepo.ts` (modified)
- `travelplan/src/lib/repositories/dayPlanChangeRepo.ts` (modified)
- `travelplan/src/app/api/trips/[id]/day-plan-items/route.ts` (modified)
- `travelplan/src/components/features/trips/TripDayPlanDialog.tsx` (modified)
- `travelplan/src/components/features/trips/TripDayView.tsx` (modified, one prop and import)
- `travelplan/src/i18n/de.ts` (modified)
- `travelplan/src/i18n/en.ts` (modified)
- `travelplan/test/dayPlanPush.test.ts` (new)
- `travelplan/test/dayPlanChangePush.test.ts` (new)
- `travelplan/test/dayPlanChangePushConflict.test.ts` (new)
- `travelplan/test/helpers/createDayPlanItem.ts` (new)
- `travelplan/test/dayPlanChangeSweep.test.ts` (modified)
- `travelplan/test/dayPlanChangeUndo.test.ts` (modified)
- `travelplan/test/dayPlanItemRepo.test.ts` (modified, helper only)
- `travelplan/test/tripDayPlanItemsRoute.test.ts` (modified)
- `travelplan/test/dayChangeReceipt.test.ts` (modified)
- `travelplan/test/tripDayPlanDialog.test.tsx` (modified)
- `travelplan/test/tripDayViewDayChange.test.tsx` (modified)

### Change Log

- 2026-10-11: Story 11.2 implemented. Server-side push walk in the edit's own transaction, the two 409 refusals and the `day_plan_changed` conflict, receipt v2 (`movedItems`, `checkInWarning`) with undo, the dialog and notice changes, and DW-216 closed. Status ready-for-dev → in-progress → review.
- 2026-10-11: Code review (bmad-code-review). The decision was resolved by keeping the +1-minute tie shift, now also applied when the next row is pushed (Dev Notes amended). Two patches were applied in `dayPlanPush.ts`: the tie guard now covers the push branch, and a retime with unchanged times plans nothing. Three items were deferred (DW-371, DW-372, DW-373) and 10 were dismissed. The fixture of the existing test "counts a leg's duration in its own direction only" changed (category (a)): it started the walk with an unchanged retime, so A now starts at 09:00–09:45, and its assertions are unchanged. 166 files / 2723 tests green, typecheck 0, lint 80 warnings unchanged. Status review → done.
