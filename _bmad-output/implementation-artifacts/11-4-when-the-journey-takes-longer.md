---
baseline_commit: b9df833de44ef463b91664a1feb6614b5990eab7
---

# Story 11.4: When the Journey Takes Longer

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As someone who finds out a drive takes longer than I planned, or that I leave the hotel later,
I want the activities after it pushed back just as far as they have to go,
so that my day never shows me arriving somewhere after I am supposed to be there.

**FRs covered:** FR42 (legs and check-out, widened 2026-10-11). **Depends on:** Stories 11.1, 11.2 and 11.3 (all done, committed in `b9df833`). It reuses the walk, the receipt, the undo endpoint, the `action-notice` and the midnight refusal; it builds no second copy of any of them.
Sources: [epics.md#Story 11.4](../planning-artifacts/epics.md), [sprint-change-proposal-2026-10-11.md](../planning-artifacts/sprint-change-proposal-2026-10-11.md) §2 *Technical impact* rules 8–12, the receipt kinds, *Where the notice appears*, §5 success criteria; [prd.md FR42](../planning-artifacts/prd.md); EXPERIENCE.md *Change with side effects*; architecture.md *Day recalculation receipts*.

All code paths below are relative to `travelplan/`. Line numbers were read at `b9df833` (11.1–11.3 committed; the working tree differs only in planning artifacts).

## Read this first: what the epic's wording assumes that the code does not

Each item was checked against the code. Each one changes what a task asks for.

1. **A check-out can only be edited from the *next* day.** The stay dialog renders exactly one time field. `stayType="current"` renders and sends only `checkInTime`, and `stayType="previous"` (opened from day N+1 for last night's stay) renders and sends only `checkOutTime` (`TripAccommodationDialog.tsx:1068-1076`, `:1441-1446`). So in today's UI, a check-out change is always made **from the pushed day**. The receipt's `tripDayId` is the day being viewed, and the notice is the ordinary one. The epic's AC for *"a check-out edit made from the stay's own day"* can only be reached through the API today. Build it anyway (Task 7: the summary names the other day whenever `receipt.tripDayId !== day.id`) and pin it with a pure summary test. **Do not** add a check-out field to the current-stay dialog: that would be a UX change nobody asked for (see *Questions* at the end).
2. **The default check-out lives in three places, not one.** `TripDayView.tsx:757` (`defaultCheckOutTime = "10:00"`), `TripAccommodationDialog.tsx:354` (`DEFAULT_CHECK_OUT = "10:00"`) and `TripDayGanttOverviewData.ts:44` (parameter default `"10:00"`). The proposal names only the first. Rule 9 says *"one shared constant for client and server"*, so all three must read the new constant (Task 1). The check-in default `"16:00"` is duplicated in the same three places. Move it into the same module while you are there: it costs nothing and keeps the pair together. It has no server reader.
3. **"Resolved" check-out means the timeline's rule, not just a fallback for `null`.** The client's `resolveStayTime` is `value && value.trim() ? value : fallback` (`TripDayView.tsx:2081`, `TripDayGanttOverviewData.ts:36`). An empty or whitespace string resolves to the default, exactly like `null`. The server must use the same rule through one shared helper (`resolveCheckOutTime(value)` beside the constant). A stored value that `timeToMinutes` cannot read (an odd import) walks nothing. That matches the walk's own rule for unreadable times (`dayPlanPush.ts:137-139`, DW-371).
4. **The push helpers are private to `dayPlanItemRepo.ts`, and importing them from `travelSegmentRepo.ts` would make a cycle.** `PlannedPush`, `readPushInputInTransaction`, `applyPushMovesInTransaction`, `findCheckInWarningInTransaction` and `buildReceipt` sit in `dayPlanItemRepo.ts:440-580`, unexported. `DayPlanChangedError` sits at `:88`. `dayPlanItemRepo.ts` imports `travelSegmentRepo.ts` (`:11-16`). **Move** them, unchanged, into a new module `src/lib/repositories/dayPlanPushTransaction.ts` that imports from `travelSegmentRepo.ts` **only as types** (`import type { TransactionClient }`). `dayPlanItemRepo.ts`, `travelSegmentRepo.ts` and `accommodationRepo.ts` all import from there. `dayPlanItemRepo.ts` keeps re-exporting `DayPlanChangedError` and `DayPlanPushRefusal`, so `src/lib/http/dayPlanPushResponses.ts:3` and every test import stay valid. This is a move, not a rewrite: the 11.2/11.3 suites must stay green unedited.
5. **The existing conflict tests hook a module boundary, so keep the calls crossing one.** `dayPlanChangePushConflict.test.ts:19`, `dayPlanChangeReorderConflict.test.ts:19` and `dayPlanChangeSweepRollback.test.ts:14` `vi.mock("@/lib/repositories/travelSegmentRepo")` and wrap `readDrawnSegmentKeysInTransaction`. That only intercepts calls made **from another module**. Do not move the drawn-set read or the sweep into `dayPlanPushTransaction.ts`, and do not change how `dayPlanItemRepo.ts` calls them. The new leg/stay conflict test needs its own hook. Have the new code call `readPushInputInTransaction` **through the new module's export** (it is in another module from `travelSegmentRepo.ts`/`accommodationRepo.ts`, so it naturally is), and mock *that* in the new conflict test.
6. **Today the leg writes are not transactions, and their adjacency check reads outside.** `createTravelSegmentForTripDay`/`updateTravelSegmentForTripDay` (`travelSegmentRepo.ts:417-479`) run `ensureSegmentItemsExist` through the global client (`buildSegmentTimeline` → `prisma`, `:258-266`, `:329-345`) and then write with `prisma.travelSegment.create/update`. 11.4 puts read, adjacency, plan, write and moves in one `prisma.$transaction`, so `ensureSegmentItemsExist` must take `tx` and use `buildSegmentTimelineInTransaction(tx, …)`. The writer clause (`findTripDayForTripWriter`) stays outside and first, as on every other write. `P2002` from the leg write still propagates out of the transaction, and the route keeps mapping it to `409 travel_segment_exists` (`travel-segments/route.ts:134-136`, `:213-215`).
7. **The stay update also reads outside its transaction.** `updateAccommodationForTripDay` reads `existing` with the global client (`accommodationRepo.ts:365`), then opens the transaction (`:410`). The previous check-out goes into the receipt, so the read moves inside, as 11.1 did for activities (`dayPlanItemRepo.ts:850-853`).
8. **`POST /accommodations` is an upsert.** `createAccommodationForTripDay` (`accommodationRepo.ts:291`) updates an existing stay on the same day. The dialog POSTs only when the day has no stay (`TripAccommodationDialog.tsx:1450`), and rule 10 rules that *creating never pushes*. So **only PATCH runs the walk**. POST (including its update arm) and `copyAccommodationFromPreviousNight` stay untouched and push nothing (AC4).
9. **Undo's post-condition would refuse a `legCreated` undo as written.** Phase 3 protects *"every leg not in the receipt that was drawn before the undo"* (`dayPlanChangeRepo.ts:164-167`, `:262-273`). The created leg is drawn before the undo and is not in `removedTravelSegments`, so deleting it would trip *"undo would orphan a leg it did not delete"*. Exclude the receipt's own `segmentId` from `protectedLegs` for `legCreated` and `legUpdated` (Task 4).
10. **`findInvalidity` and the phase-1/phase-2 chains assume an edited *activity*.** `const editedId = edited.kind === "deleted" ? edited.previous.id : edited.itemId` (`dayPlanChangeRepo.ts:124`) will not type-check with kinds that have no `itemId`. The phase-1 and phase-2 `if/else if` chains (`:170-195`, `:214-239`) have no branch for them. Restructure both: the *"edited item listed as moved"* rule applies to `created | updated | deleted` only, and each chain gets explicit branches (or a `switch` with a `never` default) so a new kind can never fall through into another kind's write.
11. **The leg save updates the view locally and never reloads it.** `handleTravelSegmentSaved` (`TripDayView.tsx:1160-1188`) merges the returned segment into `travelSegments`, `day` and `detail.days`, and calls `setDayChange(null)`. Moved activities would stay at their old times on screen. With a receipt that moved something, it must take the receipt and `await loadDay({ silent: true })` (Task 8). Both stay dialogs' `onSaved` call `setDayChange(null)` then `loadDay()` (`:4693-4697`, `:4707-4711`). They must take the receipt instead.
12. **The leg dialog relays the server's raw English message.** `TripDayTravelSegmentDialog.tsx:608` sets `body.error?.message`. The two new refusals need translated text: `day_plan_past_midnight` → `trips.plan.pastMidnight` with the title (it already ends *"Nichts wurde gespeichert."*), and `day_plan_changed` → `trips.plan.dayChangedConflict`. Both keys already exist (`de.ts:604-605`). Copy the plan dialog's handling (`TripDayPlanDialog.tsx:1655-1674`), including the untitled fallback `trips.plan.untitledActivity`. The stay dialog's fallthrough is `resolveApiError` (`TripAccommodationDialog.tsx:1549`). Add the same two branches before it.

## Acceptance Criteria

Notation as in 11.2/11.3: *timed* = `fromTime` non-empty; *end* = `activityEndMinutes`; *the walk* = `walkFrom` in `dayPlanPush.ts:121-170`; *order* = `compareDayPlanItemsByStartTime`.

1. **AC1: A leg between two activities pushes.** **Given** a leg A→B between two activities, **when** it is created, or updated with a longer `durationMinutes` or different endpoints, **then** the walk runs from A with the leg's **new** duration counted for A→B. B's earliest start is `end(A) + leg`. Slack absorbs the change, the walk stops at the first activity that fits, untimed activities are skipped, and nothing moves earlier.
2. **AC2: A leg from last night's stay pushes from the check-out.** **Given** a leg from the previous night's stay S to the day's first activity F, **when** it is created or updated (longer, or different endpoints), **then** F's earliest start is `checkOut(S) + leg`. `checkOut(S)` is `resolveCheckOutTime(S.checkOutTime)`, i.e. the stored value, or `DEFAULT_CHECK_OUT_TIME` (`"10:00"`, the constant the timeline draws with) when none is stored. From F on, the walk is AC1's. *Tommy's case:* S check-out 09:00, car leg 3 h 15 min, F 12:10–13:10 → F 12:15–13:15, and the walk continues.
3. **AC3: A later check-out pushes the next day.** **Given** a stay on day N, **when** it is updated (PATCH) so that its **resolved** check-out is later than before, **then** the walk runs on the next trip day (the smallest `dayIndex` greater than N's, the inverse of `buildSegmentTimelineInTransaction`'s nearest-lower rule) from its first timed activity F. F's earliest start is the new check-out plus the stored leg S→F if one exists and is drawn (F is the first entry of that day's order), or the check-out alone. If there is no next day (the last night), or the next day has no timed activity, nothing runs.
4. **AC4: Creating or copying a stay pushes nothing.** `POST /accommodations` (including its upsert's update arm) and `POST /accommodations/copy` are unchanged and return no receipt.
5. **AC5: No move without a reason.** Nothing moves for a shorter leg with the same endpoints, an update that changes only transport type, distance or link, a deleted leg, an earlier or unchanged resolved check-out, a PATCH without `checkOutTime`, or a leg that arrives at tonight's stay (`toItemType` accommodation). Nothing moves either for a leg that leaves an untimed activity or arrives at one. *"Nothing moves"* means the walk is **not run**. Running it on a day that already overlaps could push things the user did not touch, so this is gated, not left to the walk.
6. **AC6: Midnight.** **Given** a leg or check-out save whose walk would put any activity's `fromTime` or `toTime` past `23:59`, **then** nothing is written (neither the leg, nor the stay, nor any time), the route answers `409 day_plan_past_midnight` with `details: { itemId, itemTitle }` via the existing `pastMidnightResponse`, and the leg dialog or the stay dialog shows `trips.plan.pastMidnight` naming that activity and stays open.
7. **AC7: Activity edits are unchanged.** An activity create, update or reorder (11.2, 11.3) still ignores the stay: a first activity moved to 08:00 while check-out is 09:00 is accepted with no move. `planDayPush` and `planDayReorder` behave byte-for-byte as before. Their suites stay green unedited.
8. **AC8: The receipt.** A leg create or update returns `{ segment, receipt }` (signed, as the other writes do), always, even when nothing moved. A stay PATCH returns `{ accommodation, receipt }`, where `receipt` is present only when AC3's walk ran (resolved check-out later and a next day exists), and absent otherwise. The receipt is `version: 2` with one of three new `edited` kinds:
   - `{ kind: "legCreated"; segmentId; updatedAt }`, where `updatedAt` is the leg's post-write stamp;
   - `{ kind: "legUpdated"; segmentId; updatedAt; previous: TravelSegmentRow }`, where `previous` is the full stored row before the write, including its stamps;
   - `{ kind: "stayCheckOutChanged"; accommodationId; updatedAt; previousCheckOutTime: string | null; previousUpdatedAt }`, where `previousCheckOutTime` is the **stored** value (not the resolved one) and `tripDayId` is the **pushed** day.

   `movedItems` lists every moved activity (11.2's shape). `removedTravelSegments` is always `[]`, because a leg or stay save never changes the order, so 11.1's sweep has nothing to remove (rule 12). `checkInWarning` is computed on the pushed day exactly as 11.2 AC9 does. The notice appears only when something moved (`receiptHasSideEffects` is unchanged for these kinds).
9. **AC9: Undo.** *Rückgängig* restores, in one transaction through the existing undo endpoint: every moved activity (times and `updatedAt`), and the leg (deleted if `legCreated`; restored to `previous` in full, `updatedAt` included, if `legUpdated`) or the stay's `checkOutTime` and `updatedAt` (`stayCheckOutChanged`). Afterwards the database reads exactly as before the save (whole-DB `toEqual`, including `updatedAt`, for a save that changed nothing else; see *Testing*). The stay's other saved fields (name, cost, payments, status, …) are **kept** as saved. If any named row changed since (a moved activity, the leg, the stay), undo is refused as `409 undo_stale` and nothing is written.
10. **AC10: Tampered receipts.** Re-signed forgeries are refused with `400`: a leg-kind receipt with a non-empty `removedTravelSegments` or a `consumedBucketListItem`; a `legUpdated` whose `previous.id !== segmentId` or whose `previous.tripDayId !== tripDayId`; a `stayCheckOutChanged` with non-empty `removedTravelSegments` or a `consumedBucketListItem`. A `stayCheckOutChanged` whose accommodation is not the stay of the night before `tripDayId` on this trip is refused as `stale` (it is checked inside the transaction, see Task 4).
11. **AC11: A check-out edit that pushed another day.** **Given** a receipt whose `tripDayId` is not the day being viewed (a check-out change on day N that pushed day N+1, API-only today, see Read-this-first §1), **then** the notice's summary names the pushed day: *"3 Aktivitäten an Tag 5 verschoben"* / *"3 activities moved on day 5"* (singular forms too), and *Rückgängig* works from the day being viewed.
12. **AC12: Concurrency.** Every move is written conditionally on the `updatedAt` the plan read (`applyPushMovesInTransaction`). A miss throws `DayPlanChangedError`, the whole transaction (leg or stay included) rolls back, and the route answers `409 day_plan_changed`. Both dialogs show `trips.plan.dayChangedConflict` and stay open.
13. **AC13: The planner entry point.** One new pure function in `dayPlanPush.ts`, `planDayPushFrom`, over the existing `walkFrom` (no second walk). It is unit-tested for at least: a longer leg absorbed by slack; a chain push from a leg; a stay leg with a stored check-out and with the default; a later check-out with and without a leg; an earlier check-out moving nothing (the repository's gate, tested at repository level); the midnight refusal; untimed first activity → nothing; Tommy's case.
14. **AC14: One shared default.** `DEFAULT_CHECK_OUT_TIME` (and `DEFAULT_CHECK_IN_TIME`) live in one module with no Prisma import. `TripDayView.tsx`, `TripAccommodationDialog.tsx`, `TripDayGanttOverviewData.ts` and the server all read them. No `"10:00"` literal for a check-out remains in `src/` outside that module.
15. **AC15: Unchanged surfaces.** The leg DELETE, accommodation POST/DELETE/copy, moving between days, import and restore are untouched. The leg dialog's `travel_segment_exists` hint (8.5 AC7) still shows on a create conflict.
16. **AC16: Both dictionaries.** Every new key is in both `src/i18n/en.ts` and `src/i18n/de.ts`. `test/i18nDictionaries.test.ts` stays green.

## Tasks / Subtasks

- [x] **Task 0: Baseline.** In `travelplan/`, run `npm test`, `npm run typecheck`, `npm run lint` to completion before the first edit. Expected from 11.3's close: 169 files / 2773 tests, typecheck 0, lint 80 warnings (0 errors). (AC: all)

- [x] **Task 1: One shared stay-time default** (AC: 2, 3, 14)
  - [x] New `src/lib/trips/stayTimes.ts` (no Prisma import, client-safe): `export const DEFAULT_CHECK_OUT_TIME = "10:00"`, `export const DEFAULT_CHECK_IN_TIME = "16:00"`, and `export const resolveStayTime = (value: string | null | undefined, fallback: string) => (value && value.trim() ? value : fallback)` plus `resolveCheckOutTime = (value) => resolveStayTime(value, DEFAULT_CHECK_OUT_TIME)`. Docblock: why one module (rule 9, Read-this-first §2).
  - [x] `TripDayView.tsx:756-757`: use the constants. Its local `resolveStayTime` (`:2081`) may import the shared one; behaviour identical.
  - [x] `TripAccommodationDialog.tsx:353-354`: use the constants.
  - [x] `TripDayGanttOverviewData.ts:36-44`: use the shared `resolveStayTime` and the constants as parameter defaults.
  - [x] Grep check: no check-out `"10:00"` literal left in `src/` outside `stayTimes.ts`.

- [x] **Task 2: The planner entry point** (AC: 1, 2, 3, 6, 13). Write the unit tests first (see *Testing*).
  - [x] In `src/lib/trips/dayPlanPush.ts` add:

    ```ts
    export type PushStart =
      /** A leg A→B: walk from A; `legs` already holds the leg's new duration. */
      | { kind: "afterItem"; itemId: string }
      /** Last night's stay: the day's first activity may start no earlier than `minute + legMinutes`. */
      | { kind: "afterCheckOut"; minute: number; legMinutes: number };

    export const planDayPushFrom = (input: { items: PushItem[]; legs: PushLeg[]; start: PushStart }): PushPlan;
    ```
    It returns only `ok` or `past_midnight` (never `before_predecessor`).
  - [x] `afterItem`: sort with the comparator, find the index (absent → throw, as `planDayPush` does; the repository checks first), then `walkFrom(order, index, buildLegMinutes(legs), false)`. An untimed or unreadable A gives the walk nothing (`walkFrom` breaks at `:133` / `:139`), so nothing moves.
  - [x] `afterCheckOut`: sort. Prepend a virtual zero-length row `{ id: CHECK_OUT_ID ("\u0000checkout", the `NEW_ITEM_ID` idiom), title: null, fromTime: minutesToTime(minute), toTime: null, createdAt: new Date(0) }`. Add `legMinutes` under `legKey(CHECK_OUT_ID, order[0].id)`, run `walkFrom(virtual, 0, legMinutes, false)`, then drop the virtual row from `order`. `startMoved = false` keeps the tie guard off for the virtual row. If `order[0]` is untimed, the walk breaks at once.
  - [x] Pure, no clock. Update the module docblock: the walk now has three entry points; the *"Legs to or from a stay never take part"* comment on `PushLeg` (`:45`) becomes *"…never take part in `planDayPush`/`planDayReorder`; `planDayPushFrom`'s `afterCheckOut` carries the stay leg as a number"* (11.2 narrowed by 11.4).
  - [x] `planDayPush` and `planDayReorder` are not touched.

- [x] **Task 3: Receipt kinds** (AC: 8, 10, 11)
  - [x] `src/lib/trips/dayChangeReceipt.ts`: add to `DayChangeEdited<T>`:
    ```ts
    | { kind: "legCreated"; segmentId: string; updatedAt: T }
    | { kind: "legUpdated"; segmentId: string; updatedAt: T; previous: TravelSegmentRow<T> }
    | { kind: "stayCheckOutChanged"; accommodationId: string; updatedAt: T; previousUpdatedAt: T; previousCheckOutTime: string | null }
    ```
    Add `mapReceipt` cases (convert the stamps; `previous` through `mapStamps`). `receiptHasSideEffects` unchanged (these kinds have side effects only through `movedItems`). Docblock: Story 11.4 paragraph (additive, so version stays 2, the same argument as 11.3).
  - [x] `summarizeDayChangeReceipt(receipt, t, options?: { otherDayIndex?: number })`: when `otherDayIndex` is set, the moved part uses `trips.dayChange.itemsMovedOnDayOne` / `trips.dayChange.itemsMovedOnDay` with `{ count, day }`. Everything else is unchanged. Existing callers pass no options.
  - [x] `src/lib/validation/dayChangeReceiptSchemas.ts`: three strict variants in `editedSchema` (`segmentId`/`accommodationId`: `idSchema`; stamps: `isoDateSchema`; `previous`: the existing `travelSegmentRowSchema`; `previousCheckOutTime`: `nullableText()`). `version` stays `z.literal(2)`.

- [x] **Task 4: Undo accepts the three kinds** (AC: 9, 10)
  - [x] `dayPlanChangeRepo.ts` `findInvalidity`: compute `editedId` only for `created | updated | deleted`, and apply *"edited item listed as moved"* only to them. For `legCreated | legUpdated | stayCheckOutChanged`: refuse a non-empty `removedTravelSegments` (*"side effect a leg or stay save never has"*). `consumedBucketListItem` is already refused by the non-create rule. For `legUpdated`: refuse `previous.id !== segmentId` and `previous.tripDayId !== tripDayId`.
  - [x] `undoInTransaction`, phase 0 (the `protectedLegs` read, `:164-167`): exclude `edited.segmentId` for the two leg kinds (Read-this-first §9).
  - [x] Phase 1 (staleness, before any write):
    - `legCreated`/`legUpdated`: `tx.travelSegment.findFirst({ where: { id: segmentId, tripDayId } })` must exist with `updatedAt === edited.updatedAt`, else stale.
    - `stayCheckOutChanged`: the accommodation must exist on this trip (`where: { id, tripDay: { tripId } }`), must be the stay of the nearest lower `dayIndex` before `tripDayId` (the same lookup `buildSegmentTimelineInTransaction` does, `travelSegmentRepo.ts:230-239`), and must have `updatedAt === edited.updatedAt`, else stale.
  - [x] Phase 2: `legCreated` → `tx.travelSegment.deleteMany({ where: { id, tripDayId, updatedAt } })`, which must be `count === 1`. `legUpdated` → `updateMany` with the same condition, `data` = every column of `previous` except `id` (including `createdAt` and `updatedAt`), which must be `count === 1`. A `P2002` (another leg now holds the old pair) is already mapped to stale (`:298`). `stayCheckOutChanged` → `tx.accommodation.updateMany({ where: { id, updatedAt }, data: { checkOutTime: previousCheckOutTime, updatedAt: previousUpdatedAt } })`, which must be `count === 1`. Do this before the moved-items loop; the order among these does not matter for phase 3, because restoring times restores the order.
  - [x] Make both phase chains exhaustive (`switch` + `never` default, or explicit `else if` per kind with a final `never` check). No kind may fall into another's branch (Read-this-first §10).
  - [x] Phase 3 unchanged otherwise. Update the module docblock with a Story 11.4 paragraph.

- [x] **Task 5: Shared transaction helpers + the recalculation** (AC: 1–3, 5, 6, 8, 12)
  - [x] New `src/lib/repositories/dayPlanPushTransaction.ts`. **Move** (do not copy) from `dayPlanItemRepo.ts`: `DayPlanChangedError`, `DayPlanPushRefusal` (type), `buildReceipt`, `PlannedPush`, `readPushInputInTransaction`, `applyPushMovesInTransaction`, `findCheckInWarningInTransaction`. Export them. `dayPlanItemRepo.ts` imports them and re-exports `DayPlanChangedError` and `DayPlanPushRefusal` (Read-this-first §4). Only `import type` from `travelSegmentRepo.ts`.
  - [x] Add to the same module:
    ```ts
    export const planPushFromInTransaction = async (
      tx, tripDayId,
      start: PushStart,
      legOverride?: { replaceSegmentId?: string; leg: PushLeg },   // the leg as it will be after the write
    ): Promise<PlannedPush | { status: "past_midnight"; item }>
    ```
    It reads through `readPushInputInTransaction` (extend its leg select with `id` so the override can drop the old row by id). It applies the override (drop the row whose id is `replaceSegmentId`, then add `leg` if it is activity→activity), calls `planDayPushFrom`, and returns `PlannedPush` with `readUpdatedAt`, exactly as `planPushInTransaction` does.
  - [x] Keep `planPushInTransaction` (11.2) where it is or move it too. Either way, its behaviour does not change.

- [x] **Task 6: The leg writes** (AC: 1, 2, 5, 6, 8, 12, 15)
  - [x] `travelSegmentRepo.ts`: `ensureSegmentItemsExist(tx, params)` reads with `buildSegmentTimelineInTransaction(tx, …)` and also returns the timeline index of each endpoint (the walk needs to know whether `from` is the previous-night stay, which is always timeline index 0 when it is an accommodation, and whether `to` is an activity).
  - [x] `createTravelSegmentForTripDay`: the writer clause first (unchanged). Then one `prisma.$transaction`: adjacency (`missing`/`not_adjacent`, nothing written). Then decide the walk start: from an activity to an activity → `{ kind: "afterItem", itemId: fromItemId }` with the override leg. From an accommodation to an activity → read that stay's `checkOutTime` through `tx`, and `minute = timeToMinutes(resolveCheckOutTime(...))`. If that is `null`, there is no walk. Otherwise `{ kind: "afterCheckOut", minute, legMinutes: durationMinutes }`. To an accommodation → no walk. Plan (refusal → return `{ status: "past_midnight", item }` before any write). Then `const now = new Date()`, `tx.travelSegment.create`, `applyPushMovesInTransaction`, `findCheckInWarningInTransaction`, and `buildReceipt(tripDayId, { kind: "legCreated", segmentId, updatedAt: segment.updatedAt }, [], movedItems, { checkInWarning })`. When no walk runs, `movedItems` is `[]` and `checkInWarning` is undefined (it only follows a move).
  - [x] `updateTravelSegmentForTripDay`: same shape. `existing` is read **inside** the transaction (it is the receipt's `previous`). The walk runs only when the endpoints differ from `existing`, or `durationMinutes > existing.durationMinutes` (AC5). The plan uses the override with `replaceSegmentId: segmentId`. Receipt: `{ kind: "legUpdated", segmentId, updatedAt: updated.updatedAt, previous: existing }`.
  - [x] Result types gain `| { status: "past_midnight"; item: { id: string; title: string | null } }`, and the success variants gain `receipt: DayChangeReceipt`.
  - [x] `deleteTravelSegmentForTripDay` unchanged.
  - [x] `travel-segments/route.ts` POST and PATCH: wrap the repository call in `withPushConflict` (→ `dayChangedResponse()`). Map `past_midnight` → `pastMidnightResponse(item)`. Success → `ok({ segment: {…as today}, receipt: signDayChangeReceipt(toDayChangeReceiptWire(receipt), { tripId, userId }) })`. Keep the `P2002` → `409 travel_segment_exists` mapping (it now sits in the `catch` around `withPushConflict`, since that rethrows non-conflict errors). Update the route docblock: the travel-segment routes now run the walk (11.2 AC14 narrowed by 11.4).

- [x] **Task 7: The stay write** (AC: 3, 4, 5, 6, 8, 12)
  - [x] `accommodationRepo.ts` `updateAccommodationForTripDay`: move the `existing` read inside the transaction (Read-this-first §7). Decide the walk before any write: only when `params.checkOutTime !== undefined` and `timeToMinutes(resolveCheckOutTime(params.checkOutTime)) > timeToMinutes(resolveCheckOutTime(existing.checkOutTime))`. Both sides must be readable; an unreadable side means no walk. Then find the next day: `tx.tripDay.findFirst({ where: { tripId, dayIndex: { gt: stayDay.dayIndex } }, orderBy: [{ dayIndex: "asc" }, { date: "asc" }] })`; none means no walk. On that day, find the stored leg `ACCOMMODATION existing.id → DAY_PLAN_ITEM` that is drawn: its `toItemId` is the first row of the day's canonical order, and that row is timed. Pass `legMinutes` = its duration, or 0. Plan with `{ kind: "afterCheckOut", minute: newCheckOut, legMinutes }` **on the next day's id**. A refusal returns `{ status: "past_midnight", item }` before any write.
  - [x] Then the existing write (stay update, payments), then `applyPushMovesInTransaction(tx, nextDayId, …)`, `findCheckInWarningInTransaction(tx, nextDayId, planned)`, and `buildReceipt(nextDayId, { kind: "stayCheckOutChanged", accommodationId, updatedAt: accommodation.updatedAt, previousUpdatedAt: existing.updatedAt, previousCheckOutTime: existing.checkOutTime }, [], movedItems, { checkInWarning })`. `AccommodationUpdateResult`'s `updated` variant gains `receipt?: DayChangeReceipt` (present iff the walk ran), and the result gains a `past_midnight` variant.
  - [x] `accommodations/route.ts` PATCH: `withPushConflict`, `pastMidnightResponse`, and `ok({ accommodation, ...(receipt ? { receipt: signDayChangeReceipt(…) } : {}) })`. POST, DELETE and the copy route are untouched (AC4).

- [x] **Task 8: The day view and the two dialogs** (AC: 6, 8, 11, 12)
  - [x] `TripDayTravelSegmentDialog.tsx`: `onSaved: (segment, receipt: SignedDayChangeReceiptWire | null) => void`, and pass `body.data.receipt ?? null`. Before the generic `setServerError(body.error?.message …)` (`:608`), handle `409 day_plan_past_midnight` (`formatMessage(t("trips.plan.pastMidnight"), { title })`, with `details.itemTitle?.trim() || t("trips.plan.untitledActivity")`) and `409 day_plan_changed` (`t("trips.plan.dayChangedConflict")`). The dialog stays open on both. Keep the create-only `travel_segment_exists` hint first.
  - [x] `TripAccommodationDialog.tsx`: `onSaved: (receipt: SignedDayChangeReceiptWire | null) => void`, and pass `body.data?.receipt ?? null` (POST never has one). Add the same two 409 branches before `resolveApiError` (`:1549`), shown in `serverError`.
  - [x] `TripDayView.tsx`:
    - `handleTravelSegmentSaved(segment, receipt)`: replace `setDayChange(null)` with `takeDayChangeReceipt(receipt)`. Keep the local merge. If `receipt?.movedItems.length`, also `await loadDay({ silent: true })` (guarded by `currentDayIdRef`) so moved times show. The server's times are rendered; nothing is computed client-side (11.2 AC11).
    - Both `TripAccommodationDialog` `onSaved`s: `(receipt) => { takeDayChangeReceipt(receipt); set…Open(false); loadDay(); }`. `loadDay` does not clear `dayChange`.
    - The `<ActionNotice>` summary (`:3780`): pass `{ otherDayIndex }` when `dayChange.receipt.tripDayId !== day.id`. Look up `dayIndex` in `detail.days` by id, and if it is not found, fall back to the plain summary.
  - [x] `handleUndoDayChange` needs no change: it posts the receipt as-is and reloads the current day, which also refreshes the stay's check-out shown on it.

- [x] **Task 9: Strings** (AC: 16). Both dictionaries, same relative order, next to `trips.dayChange.itemsMoved`:

  | Key | de | en |
  |---|---|---|
  | `trips.dayChange.itemsMovedOnDayOne` | 1 Aktivität an Tag {day} verschoben | 1 activity moved on day {day} |
  | `trips.dayChange.itemsMovedOnDay` | {count} Aktivitäten an Tag {day} verschoben | {count} activities moved on day {day} |

  No other new keys: the refusals reuse `trips.plan.pastMidnight`, `trips.plan.untitledActivity` and `trips.plan.dayChangedConflict`.

- [x] **Task 10: Tests** (AC: all). See *Testing*. Pure-function tests green before Task 5.
- [x] **Task 11: Record.** Final gates against Task 0. In the Completion Notes, list any existing test whose expectation changed and why. Expected: only `onSaved` call assertions in the two dialog suites, if they check arguments, and the `travelSegmentRoute`/`tripAccommodationRoute` suites only if they assert the exact `data` keys (they do not at `b9df833`). State whether a real-browser pass was done.

### Review Findings

Code review 2026-10-11, reviewed in full (Blind Hunter, Edge Case Hunter, Acceptance Auditor): 0 decision-needed, 5 patch, 2 defer, 18 dismissed.

- [x] [Review][Patch] **Undoing a `legUpdated` receipt can write back a leg whose old endpoint no longer exists.** A leg PATCH changes its endpoints. Later, one of the old endpoint activities is deleted; the sweep does not touch the leg, because the leg now points at the new endpoints. Undo then restores `previous` in full, pointing at the deleted activity: a dangling leg, stored as a success. Fix: in phase 3, require that the restored leg is drawn (the same rule `removedTravelSegments` already follows), or else throw `UndoStaleError`. Add a regression test. [travelplan/src/lib/repositories/dayPlanChangeRepo.ts:318]
- [x] [Review][Patch] **A later check-out returns a no-move receipt when the next day has no timed activity.** AC3 says "nothing runs" in that case. `planCheckOutPushInTransaction` still walks an empty or untimed day, so `stayCheckOutChanged` comes back with `movedItems: []`. Fix: return `null` when `first?.fromTime` is empty. Add a repository test for that day shape. [travelplan/src/lib/repositories/accommodationRepo.ts:411]
- [x] [Review][Patch] **The leg-save reload does not do what Task 8 says.** `void loadDay({ silent: true })` is neither awaited nor guarded by `currentDayIdRef`, and it is fired *before* the local merge. Fix: do the local merge, then reload guarded by the day (as the other handlers do). [travelplan/src/components/features/trips/TripDayView.tsx:1352]
- [x] [Review][Patch] **Tests the spec asks for are missing.**
  - The stay dialog's `trips.plan.untitledActivity` fallback for `day_plan_past_midnight`.
  - The route-level POST "no receipt" test, run on a day that **has** a next day with timed activities. The current one uses the last day, so it would pass even if POST pushed.
  - Undo of a `stayCheckOutChanged` receipt is `stale` when a moved activity changed.
  - AC11: click *Rückgängig* on the cross-day notice, then assert the undo POST and the reload. The test now stops at "button enabled".
  - In `tripDayViewLegPush`, assert that the reload's times are shown.
  [travelplan/test/tripAccommodationDialog.test.tsx, test/dayPlanChangeStayPush.test.ts, test/dayPlanChangeUndo.test.ts, test/tripDayViewLegPush.test.tsx]
- [x] [Review][Patch] **Leftover aliases.** `DEFAULT_CHECK_IN = DEFAULT_CHECK_IN_TIME` and `DEFAULT_CHECK_OUT = DEFAULT_CHECK_OUT_TIME` keep a second name for the shared constants. Use the `stayTimes.ts` names directly. [travelplan/src/components/features/trips/TripAccommodationDialog.tsx:354]
- [x] [Review][Defer] **On a cross-day receipt, the check-in warning does not name the pushed day.** Only the moved-count text gets `otherDayIndex`. Today this is API-only (Read-this-first §1). [travelplan/src/lib/trips/dayChangeReceipt.ts:313] — deferred, depends on the current-stay check-out question
- [x] [Review][Defer] **When a check-out pushes another day past midnight, the refusal names the activity but not its day.** `pastMidnightResponse` carries no day. Today this is API-only (Read-this-first §1). [travelplan/src/components/features/trips/TripAccommodationDialog.tsx:1560] — deferred, depends on the current-stay check-out question

## Dev Notes

### The walk from a leg, precisely

- **Activity → activity** (A→B, adjacent by the route's own rule, so B directly follows A in the order): `walkFrom(order, index(A), legs-with-new-leg, false)`. B's earliest is `end(A) + newDuration`. If B already fits, the walk stops (slack absorbed). Otherwise B shifts keeping its duration, and the walk continues with the stored legs after B, exactly as 11.2.
- **Previous-night stay → first activity F**: the stay is timeline index 0, so F is the first activity in the canonical order. If F is untimed, the whole day is untimed (timed rows sort first) and nothing runs. Otherwise F's earliest is `checkOut + newDuration`, and the walk continues from F.
- **Anything → tonight's stay**: no walk.
- **A leg from or to an untimed activity**: `walkFrom` breaks immediately. No special case is needed, but pin it with a test.

### The check-out walk, precisely

`prevResolved = resolveCheckOutTime(existing.checkOutTime)` and `newResolved = resolveCheckOutTime(params.checkOutTime)`, both as minutes. Walk only if both are readable and `new > prev`. Examples (pin each):

| Stored before → after | Resolved | Walk? |
|---|---|---|
| `null` → `"11:00"` | 10:00 → 11:00 | yes |
| `"08:00"` → `null` | 08:00 → 10:00 | yes |
| `"11:00"` → `null` | 11:00 → 10:00 | no (earlier) |
| `null` → `"10:00"` | 10:00 → 10:00 | no (unchanged) |
| `"11:00"` → `"09:00"` | earlier | no |
| field absent from PATCH | – | no |

**Worked example (Tommy's, success criterion 1):** Day 5. Glenfern Villas (day 4's stay) check-out `09:00`. Leg Glenfern → Fantail Falls, car, 60 min → 3 h 15 min (195). Fantail Falls 12:10–13:10, then a Haast walk 13:30–14:00 with a 30 min leg Fantail → Haast. Earliest for Fantail = 09:00 + 195 = 12:15 → 12:15–13:15. Earliest for Haast = 13:15 + 30 = 13:45 → 13:45–14:15. The next activity fits, so the walk stops. Notice: *"2 Aktivitäten verschoben"*. *Rückgängig* restores the 60 min leg (full row) and both times.

### The receipt for these writes (wire form)

```ts
{
  version: 2,
  tripDayId,                                   // the day whose activities moved (for a stay: the NEXT day)
  edited:
    | { kind: "legCreated", segmentId, updatedAt }
    | { kind: "legUpdated", segmentId, updatedAt, previous: TravelSegmentRow }
    | { kind: "stayCheckOutChanged", accommodationId, updatedAt, previousUpdatedAt, previousCheckOutTime },
  removedTravelSegments: [],                   // always
  movedItems: [...],                           // 11.2's shape
  checkInWarning?: {...},                      // 11.2 AC9, on the pushed day
}
```

`previousUpdatedAt` on `stayCheckOutChanged` is not in the proposal's sketch. It is needed because the proposal says undo restores the check-out *"and `updatedAt`"*, and AC9's whole-DB `toEqual` includes the stay's stamp. Note the trade-off in the docblock: a save that changed the name too gets the old stamp back with the new name, which is the accepted cost of *"revert only what caused the side effect"*.

### What must not regress

- **`planDayPush` / `planDayReorder`** and their suites (`dayPlanPush.test.ts`, `dayPlanChangePush*.test.ts`, `dayPlanChangeReorder*.test.ts`) stay green and unedited. The helper move (Task 5) is a move.
- **The three conflict/rollback suites that mock `travelSegmentRepo`** (Read-this-first §5) keep working unedited.
- **11.1's sweep** is not run by leg/stay saves. They never reorder, and `removedTravelSegments` is `[]`.
- **Story 8.5**: adjacency (`not_adjacent` → 400), the `travel_segment_exists` 409 and its create-only hint, the orphan list. **Story 6.23's non-healing rule**: nothing creates a leg except the user's own save.
- **The writer clause** (5.13) in every repository function. The owner-or-contributor gate in every route.
- **Undo's 11.1–11.3 behaviour**: every existing case in `dayPlanChangeUndo.test.ts` stays green unedited, including the post-condition (now with the self-leg exclusion only for leg kinds).
- **The stay dialog's field-error mapping** (Story 6.26's guard, `TripAccommodationDialog.tsx:1478-1500`) is unchanged. The new branches sit after the `validation_error` block.
- **Accommodation delete/copy, import/restore, moves between days**: untouched.

Any red test in `tripDayViewOrphanSegments.test.tsx`, `tripDayViewDayChange.test.tsx`, `tripDayViewReorder.test.tsx`, `travelSegmentDialog.test.tsx`, `tripAccommodationDialog.test.tsx`, `accommodationRepo.test.ts`, `accommodationDeleteRollback.test.ts`, `dayPlanChangeUndo.test.ts` or the gantt suites is a regression. Do not edit it to pass. The exception is a dialog test that asserts `onSaved`'s exact arguments; record it.

### Testing

`vitest` (`npm test`; serial, single fork) against real SQLite (`test/setup.ts`), with no repository mocks except the documented `vi.mock` conflict pattern. Component suites use `// @vitest-environment jsdom`, `renderWithProviders`, `stubFetch`/`mockFetchResponse` (`test/helpers/mockFetch.ts`). Route suites build `NextRequest` with `createSessionJwt` and `routeContext(tripId)`. Reuse the fixtures in `test/dayPlanChangeUndo.test.ts` (`createItem`, `createLeg`, `databaseState`, `seedDay`). For stay undo, extend a local `databaseState` with `accommodations: prisma.accommodation.findMany(...)` and `days`. A two-day trip needs a second `tripDay` with `dayIndex: 2` and a stay on day 1.

- **`test/dayPlanPush.test.ts`** (extend; write first): every case in AC13 plus Tommy's worked example; `afterItem` from an untimed row → no moves; `afterCheckOut` with an untimed first row → no moves; midnight names the activity; `planDayPush`'s existing cases untouched.
- **`test/stayTimes.test.ts`** (new, small): `resolveStayTime` for `null`, `""`, `"  "`, `"09:30"`; the constants' values.
- **`test/dayPlanChangeLegPush.test.ts`** (new; repository + route): create and update push and return the receipt (kind, `previous` row, `movedItems`, stamps) with the DB matching; shorter, unchanged-duration, type-only and link-only updates move nothing; a leg to tonight's stay moves nothing; stay leg with stored and default check-out; `past_midnight` → 409 with details and the **whole DB unchanged** (no leg row created, no leg updated); `not_adjacent` and `travel_segment_exists` still answer as before; a viewer gets 404; the check-in warning appears with an explicit `checkInTime`; a response always carries a `receipt`.
- **`test/dayPlanChangeStayPush.test.ts`** (new): PATCH later check-out pushes day N+1 (with and without a drawn stay leg; a stored but undrawn stay leg is ignored); the table of the check-out walk; the last night pushes nothing and returns no receipt; POST (create and its upsert arm) and copy push nothing; `past_midnight` → 409, the stay unchanged; the receipt's `tripDayId` is N+1.
- **`test/dayPlanChangeLegPushConflict.test.ts`** (new; own file): `vi.mock("@/lib/repositories/dayPlanPushTransaction")` wrapping `readPushInputInTransaction` to bump a to-be-pushed row's `updatedAt` through the same `tx` after reading. Then the leg save → `409 day_plan_changed`, and the leg is not written. Do the same for the stay PATCH, where the stay is not updated.
- **`test/dayPlanChangeUndo.test.ts`** additions: undo of `legCreated` (the leg is gone, times are restored, the whole DB `toEqual`); undo of `legUpdated` (the full row is back, `updatedAt` included); undo of `stayCheckOutChanged` on a check-out-only PATCH with no payments (the whole DB `toEqual`, stays included); a stay save that also changed the name keeps the name and restores the check-out; stale when the leg, the stay or a moved activity changed since; the re-signed tamper cases from AC10 → 400; a `stayCheckOutChanged` naming another day's stay → stale.
- **`test/dayChangeReceipt.test.ts`** additions: all three kinds round-trip through wire; `receiptHasSideEffects` is false with empty `movedItems` and true with moves; `summarizeDayChangeReceipt` with `otherDayIndex` in both languages, singular and plural.
- **`test/travelSegmentDialog.test.tsx`** additions: `onSaved` receives the receipt; 409 `day_plan_past_midnight` shows the translated message naming the activity (and the untitled fallback), and the dialog stays open; 409 `day_plan_changed` shows `dayChangedConflict`.
- **`test/tripAccommodationDialog.test.tsx`** additions: the same two refusals in the previous-stay dialog; `onSaved` receives the receipt.
- **`test/tripDayViewDayChange.test.tsx`** additions (or a new `tripDayViewLegPush.test.tsx`): a leg save whose receipt moved activities shows the notice with the count and reloads the day; a leg save with no moves shows no notice; a previous-stay save with a receipt shows the notice; a receipt with another day's `tripDayId` shows the *"an Tag N"* summary (inject it through the stay dialog's stubbed PATCH response).

### Project Structure Notes

- **No schema change, no migration, no new dependency.** `TravelSegment` and `Accommodation` already carry `updatedAt` (`schema.prisma:164`, `:191`).
- **New files:** `src/lib/trips/stayTimes.ts`, `src/lib/repositories/dayPlanPushTransaction.ts`, `test/stayTimes.test.ts`, `test/dayPlanChangeLegPush.test.ts`, `test/dayPlanChangeStayPush.test.ts`, `test/dayPlanChangeLegPushConflict.test.ts` (and optionally `test/tripDayViewLegPush.test.tsx`).
- **Modified:** `src/lib/trips/dayPlanPush.ts`, `src/lib/trips/dayChangeReceipt.ts`, `src/lib/validation/dayChangeReceiptSchemas.ts`, `src/lib/repositories/dayPlanItemRepo.ts` (helpers moved out, re-exports), `src/lib/repositories/dayPlanChangeRepo.ts`, `src/lib/repositories/travelSegmentRepo.ts`, `src/lib/repositories/accommodationRepo.ts`, `src/app/api/trips/[id]/travel-segments/route.ts`, `src/app/api/trips/[id]/accommodations/route.ts`, `src/components/features/trips/TripDayView.tsx`, `TripDayTravelSegmentDialog.tsx`, `TripAccommodationDialog.tsx`, `TripDayGanttOverviewData.ts`, both dictionaries, and the test files named above.
- **Ignore `.kilo/worktrees/fern-bugle/`**, a stale copy of the app.
- Stack (unchanged, no upgrade): Next 16.2, React 19.2, MUI 7.3, Prisma 7.3 (SQLite), Zod 4.1, Vitest 3.2. No external research needed: no new library or API.

### Previous story intelligence (11.1–11.3)

- **Receipts are signed** (HMAC, trip + user). Tamper tests must re-sign forgeries to reach the schema and the ownership checks (the existing tamper block in `dayPlanChangeUndo.test.ts`).
- **Prisma 7 honours an explicit `updatedAt`** on `updateMany`. `applyPushMovesInTransaction` and undo rely on it. Use it for the stay and leg restores too.
- **A save that changes no times plans nothing** (11.2's review patch). AC5 is the same principle for legs and check-outs, so gate before calling the planner.
- **Refusal UI order:** 11.3 learned that `loadDay()` clears the view's error (`TripDayView.tsx:1001`). The refusals here are shown **inside the dialogs**, which stay open, so that trap does not apply. Do not reload the day on a refused leg or stay save.
- **Deferred and still open:** DW-371 (unreadable rows stop the walk; same here), DW-372 (undo can restore over a row created since; applies equally), DW-373 (SQLite busy / P2034 → 500; the new routes use the same `withPushConflict`), DW-374/375 (late responses and discard-up-front, shared by every write handler).
- **Not verified in a real browser** has been the caveat of 11.1–11.3. This story adds no new control. If a browser pass is done, re-run Tommy's exact case end to end.

### Git intelligence

`b9df833 11-1, 11-2, 11-3: day changes with legs, push and reorder` holds all of Epic 11 so far, and `7780dfb`/`3604d9d` are bug fixes before it. `git diff b9df833` therefore shows only this story's code changes (plus the uncommitted planning artifacts from the 2026-10-11 course correction: `prd.md`, `epics.md`, `architecture.md`, `EXPERIENCE.md`, `sprint-status.yaml`, the proposal). Record the file list explicitly anyway.

### Questions for Tommy (not blocking; the defaults above apply)

1. Check-out is editable only from the next day's *previous stay* dialog. Should it also be editable from the stay's own day? The cross-day notice (AC11) exists for that case, but no UI reaches it today. Default: no UI change in 11.4.
2. A stay save that changed the name **and** the check-out gets the old `updatedAt` back on undo, with the new name kept. Default: accept (it follows the proposal's *"revert only what caused the side effect"*).

### References

- Epic and ACs: [epics.md#Story 11.4](../planning-artifacts/epics.md); rules: [sprint-change-proposal-2026-10-11.md §2](../planning-artifacts/sprint-change-proposal-2026-10-11.md)
- Previous stories: [11-1](11-1-travel-legs-that-leave-with-their-place-in-the-day.md), [11-2](11-2-the-rest-of-the-day-moves-back-with-it.md), [11-3](11-3-one-place-earlier-one-place-later.md)
- Walk: `src/lib/trips/dayPlanPush.ts` (`walkFrom` `:121`); order: `src/lib/trips/dayPlanItemOrder.ts`; timeline: `travelSegmentRepo.ts` `buildSegmentTimelineInTransaction` `:211`
- Push helpers today: `dayPlanItemRepo.ts:88`, `:440-580`; HTTP helpers: `src/lib/http/dayPlanPushResponses.ts`
- Undo: `dayPlanChangeRepo.ts` (`findInvalidity` `:92`, `undoInTransaction` `:158`)
- Client: `TripDayView.tsx` (`takeDayChangeReceipt` `:1368`, `handleTravelSegmentSaved` `:1160`, dialogs `:4685-4729`, notice `:3764-3790`); `TripDayTravelSegmentDialog.tsx:554-617`; `TripAccommodationDialog.tsx:1410-1556`; plan dialog refusals `TripDayPlanDialog.tsx:1655-1674`
- Component: `src/components/ui/ActionNotice.tsx`; EXPERIENCE.md *Change with side effects*

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (claude-opus-5-5), via bmad-dev-story, 2026-10-11.

### Debug Log References

- Baseline (Task 0): 169 files / 2773 tests, typecheck 0, lint 80 warnings / 0 errors — matched 11.3's close.
- React-compiler lint error after Task 8 (`react-hooks/preserve-manual-memoization` on `handleRemoveOrphanSegment`): `handleTravelSegmentSaved` referenced `takeDayChangeReceipt` before its `useCallback` declaration. Fixed by moving `handleTravelSegmentSaved` below `takeDayChangeReceipt` (no behaviour change).
- One extra lint warning (81) after Task 1: `react-hooks/exhaustive-deps` treats a local `const x = "10:00"` as stable but not an alias of an import. Fixed by dropping the local `defaultCheckInTime`/`defaultCheckOutTime` aliases in `TripDayView.tsx` and using the module constants directly (and out of the dep arrays). Lint back to 80.
- Test-side fixes during Task 10 only (no production change): a fixture that built an invalid `10:60`; a sequential-update loop whose first (shorter) save made the next same-length save a legitimate lengthening; `verifyDayChangeReceipt` returns the receipt, not a boolean.

### Completion Notes List

- **Task 1.** `src/lib/trips/stayTimes.ts` holds `DEFAULT_CHECK_OUT_TIME`, `DEFAULT_CHECK_IN_TIME`, `resolveStayTime` and `resolveCheckOutTime`. `TripDayView.tsx`, `TripAccommodationDialog.tsx`, `TripDayGanttOverviewData.ts` and the server read them; no `"10:00"`/`"16:00"` literal remains in `src/` outside that module (grep-checked).
- **Task 2.** `planDayPushFrom` (`afterItem` / `afterCheckOut`) over the existing `walkFrom`; the check-out is a zero-length stand-in (`"\u0000checkout"`) that never leaves the function. `planDayPush`/`planDayReorder` untouched; their tests unedited.
- **Task 3.** Three additive receipt kinds (`legCreated`, `legUpdated`, `stayCheckOutChanged`), `mapReceipt` cases, strict schema variants; version stays 2. `summarizeDayChangeReceipt` takes `{ otherDayIndex }`.
- **Task 4.** Undo: `findInvalidity` computes the edited id only for the activity kinds; the leg/stay kinds refuse a non-empty `removedTravelSegments` (and a bucket row, by the existing rule); `legUpdated` refuses a foreign `previous`. Both phase chains are now exhaustive `switch`es with a `never` default. The receipt's own leg is excluded from the post-condition's protected set (mutation-checked: removing the exclusion fails the `legCreated` undo). `stayCheckOutChanged` must name last night's stay for the pushed day (nearest lower `dayIndex`), else `stale`.
- **Task 5.** The push helpers **moved** unchanged to `src/lib/repositories/dayPlanPushTransaction.ts` (type-only import of `travelSegmentRepo.ts`); `dayPlanItemRepo.ts` re-exports `DayPlanChangedError` and `DayPlanPushRefusal`. The leg select gained `id`. New `planPushFromInTransaction(tx, tripDayId, start, legOverride?)`. `planPushInTransaction` stays in `dayPlanItemRepo.ts`, unchanged.
- **Task 6.** Leg create/update: writer clause outside, then one transaction (adjacency through `tx`, plan, write, moves, check-in warning, receipt). Update walks only on new endpoints or a longer duration (mutation-checked). The unused global-client `buildSegmentTimeline` wrapper was removed (its only caller was the adjacency check); four comments that named it now name `buildSegmentTimelineInTransaction`. Route: `withPushConflict`, `pastMidnightResponse`, signed `receipt` always; `P2002 → 409 travel_segment_exists` unchanged.
- **Task 7.** Stay PATCH reads `existing` inside its transaction and walks the next day only for a later resolved check-out (both sides readable) with a next day; the stay leg counts only when drawn. `receipt` present iff the walk ran. POST/copy/DELETE untouched.
- **Task 8.** Both dialogs pass the receipt and translate `day_plan_past_midnight` (with the untitled fallback) and `day_plan_changed`, staying open. The view takes the receipt from leg and stay saves, reloads silently after a leg save that moved activities, and names the other day in the summary when the receipt's day is not the viewed one.
- **Task 9.** `trips.dayChange.itemsMovedOnDayOne` / `itemsMovedOnDay` in both dictionaries.
- **Task 10.** New: `test/stayTimes.test.ts`, `test/dayPlanChangeLegPush.test.ts` (17), `test/dayPlanChangeStayPush.test.ts` (18), `test/dayPlanChangeLegPushConflict.test.ts` (2), `test/tripDayViewLegPush.test.tsx` (4). Extended: `dayPlanPush.test.ts` (+16 `planDayPushFrom` cases incl. Tommy's), `dayChangeReceipt.test.ts` (+4), `dayPlanChangeUndo.test.ts` (+10), `travelSegmentDialog.test.tsx` (+5), `tripAccommodationDialog.test.tsx` (+4).
  - The conflict test mocks `planPushFromInTransaction`, not `readPushInputInTransaction` as the story suggested: a `vi.mock` only intercepts calls that cross a module boundary, and `readPushInputInTransaction` is called from inside `dayPlanPushTransaction.ts`. `planPushFromInTransaction` is called from `travelSegmentRepo.ts`/`accommodationRepo.ts` and sits in the same window (after the read, before any write).
- **Task 11 / regressions.** No existing test expectation changed; the existing suites only gained imports and appended cases. The two dialog suites' existing `onSaved` assertions check calls, not arguments, so none needed editing. Final gates: see Change Log.
- **Not verified in a real browser.** Tommy's case is pinned at planner, repository and route level only.
- Open questions from the story (check-out editable from the stay's own day; old `updatedAt` on a stay save that also renamed it) were left at their stated defaults.

### File List

New:
- travelplan/src/lib/trips/stayTimes.ts
- travelplan/src/lib/repositories/dayPlanPushTransaction.ts
- travelplan/test/stayTimes.test.ts
- travelplan/test/dayPlanChangeLegPush.test.ts
- travelplan/test/dayPlanChangeStayPush.test.ts
- travelplan/test/dayPlanChangeLegPushConflict.test.ts
- travelplan/test/tripDayViewLegPush.test.tsx

Modified:
- travelplan/src/lib/trips/dayPlanPush.ts
- travelplan/src/lib/trips/dayChangeReceipt.ts
- travelplan/src/lib/validation/dayChangeReceiptSchemas.ts
- travelplan/src/lib/validation/tripImportSchemas.ts (comment only: renamed function reference)
- travelplan/src/lib/repositories/dayPlanItemRepo.ts
- travelplan/src/lib/repositories/dayPlanChangeRepo.ts
- travelplan/src/lib/repositories/travelSegmentRepo.ts
- travelplan/src/lib/repositories/accommodationRepo.ts
- travelplan/src/app/api/trips/[id]/travel-segments/route.ts
- travelplan/src/app/api/trips/[id]/accommodations/route.ts
- travelplan/src/components/features/trips/TripDayView.tsx
- travelplan/src/components/features/trips/TripDayTravelSegmentDialog.tsx
- travelplan/src/components/features/trips/TripAccommodationDialog.tsx
- travelplan/src/components/features/trips/TripDayGanttOverviewData.ts
- travelplan/src/i18n/de.ts
- travelplan/src/i18n/en.ts
- travelplan/test/dayPlanPush.test.ts
- travelplan/test/dayChangeReceipt.test.ts
- travelplan/test/dayPlanChangeUndo.test.ts
- travelplan/test/travelSegmentDialog.test.tsx
- travelplan/test/tripAccommodationDialog.test.tsx
- _bmad-output/implementation-artifacts/sprint-status.yaml
- _bmad-output/implementation-artifacts/11-4-when-the-journey-takes-longer.md

### Change Log

- 2026-10-11: Story 11.4 implemented (Tasks 0–11). Leg saves and a later previous-night check-out now push the day through the shared walk, return a v2 receipt with three new kinds, and are undoable through the existing endpoint. Gates: 174 files / 2856 tests green (baseline 169 / 2773), typecheck 0, lint 80 warnings / 0 errors (baseline 80).
- 2026-10-11: Code review (bmad-code-review): 5 patches applied (legUpdated undo refuses a restored leg that would not be drawn; no check-out walk or receipt for an empty or untimed next day; leg-save reload after the local merge, guarded by the day; missing tests added; check-in/out aliases removed). 2 deferred (DW-377, DW-378), 18 dismissed. Gates: 174 files / 2861 tests green, typecheck 0, lint 80 warnings / 0 errors. Status review -> done.
