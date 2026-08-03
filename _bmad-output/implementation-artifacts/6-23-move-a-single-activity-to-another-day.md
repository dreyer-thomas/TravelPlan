---
authored_against: 5c89567
baseline_revision: 1cb5a847158f6df23b7fffd9570b8a6c7c81e770
status: done
review_loop_iteration: 0
final_revision: 55068b1f9bca04920f759a04433b236b55386a54
followup_review_recommended: true
warnings: []
operator_actions:
  - "Do Task 7 in a real browser, on a throwaway copy of dev.db on an isolated port — never prisma/dev.db. The recipe is in the Dev Notes of _bmad-output/implementation-artifacts/7-12-bucket-list-sidebar-card.md. AC3 is the reason the story exists and it is the one thing a unit test can assert but not convince anyone of."
  - "Move an activity that has images, a cost split across several payment rows, a link and a location, and confirm on the target day that every one of them is there — the photos in the gallery, the payment rows in order with the same due dates, the link live, the map pin in the right place. If any of them is missing, stop: that is AC3 failing and it is the whole story."
  - "Move an activity that sits between two others with travel segments on both sides. Confirm both days read correctly afterwards, that no segment was invented on the target day, and that the green line names how many were removed ('2 travel segments removed', and '1 travel segment removed' when only one goes — the singular is its own key)."
  - "Check the target day's own travel time after that move, and expect it to be wrong: if the activity landed between two activities that already had a segment between them, that segment is now drawn by nothing but still counted in 'Fahrzeit'. This is DW-148, it is pre-existing (creating or retiming an activity does the same), and it is deferred, not fixed. Record the number so the ledger entry has a measurement, and do not treat it as a regression from this story."
  - "Delete an activity that has a travel segment and watch the 'Fahrzeit' stat drop immediately, without reloading the page. Before this story the minutes stayed on screen — and in the database — forever. That is AC6."
  - "Open the activity dialog at a 390px viewport in German and look at the footer: it now carries Abbrechen, 'Auf anderen Tag verschieben', Löschen and Speichern. Judge whether four controls in that row still read cleanly under 6.22's tab bar, and say so if they do not — the fix would be a layout story, not an edit here."
  - "Try the move as a viewer (a share link with view-only access): the action must be absent from the dialog, not present-but-disabled."
  - "If every check passes, tick Task 7 in this spec, set status: done in the frontmatter and Status: done in the body, and set 6-23-move-a-single-activity-to-another-day to done in sprint-status.yaml."
---

# Story 6.23: Move a Single Activity to Another Day

Status: awaiting-operator

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner,
I want to move one activity to a different day,
so that a plan that turned out to fit better elsewhere can be rearranged instead of retyped.

## Acceptance Criteria

1. **One activity, chosen day.** The activity dialog offers "Auf anderen Tag verschieben" for an activity that already exists. It is absent while creating a new one — there is nothing to move yet.
2. **The target day is appended to, never replaced.** The activities already on the target day are untouched. This is the opposite of the existing day-level move, which deletes them.
3. **Everything attached travels with it.** Title, description, times, cost, payment rows, link, location, and all images arrive on the new day unchanged. Nothing has to be re-entered — that is the point of the story.
4. **Travel segments that reference the moved activity are removed, on both days, and the user is told what went.** They carry a duration, a distance and possibly a link that the user typed, so their removal is reported rather than silent.
5. **No segment is invented on the target day.** The activity arrives unconnected; guessing a transport mode and a duration to its new neighbours would be fabricating data.
6. **The same removal is applied when an activity is deleted.** Deleting one today leaves its segments behind, and `totalTravelMinutes` keeps counting them — measured, see Dev Notes. Whatever helper this story writes for moving is used for deleting too.
7. **Ordering on the target day is deliberate.** The moved activity lands in a defined, sensible position among the activities already there, including when it has no start time, and the choice is recorded. *(Amended 2026-08-03 during review — see the Spec Change Log. As written this AC said "gets a `sortOrder`"; `DayPlanItem` has no such column, so the criterion named an impossible mechanism rather than the outcome it wanted.)*
8. **Same permission as the existing transfer.** `canEditPlanning` governs; a viewer sees no such action.
9. **The day-level move and swap are unchanged.** Both keep their current behaviour, including the replace semantics of "move".

## Tasks / Subtasks

- [x] **Task 1 — A new repository function, not an extension of the old one** (AC: 2, 3, 7)
  - [x] `moveDayPlanItemsBetweenTripDays` (`dayPlanItemRepo.ts:505`) **deletes the target day's items** before moving the source day's across. It is a whole-day replace wearing the name "move". Reusing or parameterising it is the one shortcut that would destroy data.
  - [x] Write `moveDayPlanItemToTripDay({ userId, tripId, itemId, targetTripDayId })`. Reuse `findTransferTripDaysForWriter` for the access check — both days must belong to a trip the user may write.
  - [x] The move itself is a single `update` of `tripDayId`. Images (`day_plan_item_images`) and payments (`cost_payments`) reference the item by foreign key, so they follow with no work. Confirm that rather than assuming it, and say so in the Dev Agent Record — it is the whole of AC3.
  - [x] Reject moving to the day the activity is already on, the way the existing functions reject `same_day`.

- [x] **Task 2 — The travel segments are the hard part** (AC: 4, 5, 6)
  - [x] `TravelSegment` has **no foreign key to `DayPlanItem`**: `fromItemId`/`toItemId` are plain strings paired with a `fromItemType`/`toItemType` discriminator (`prisma/schema.prisma`). There is no cascade. Nothing cleans up after a moved or deleted activity unless this story does.
  - [x] On the source day, find every segment where (`fromItemType = DAY_PLAN_ITEM` and `fromItemId = itemId`) or (`toItemType = DAY_PLAN_ITEM` and `toItemId = itemId`), and delete them. Return what was deleted so the UI can report it (AC4).
  - [x] Do **not** heal the chain by joining the moved activity's two former neighbours. Their transport mode, duration and distance are unknowable; a fabricated segment is worse than a visible gap the user can fill.
  - [x] Do **not** create a segment on the target day either, for the same reason (AC5).
  - [x] Extract this as one helper — `removeTravelSegmentsReferencing(tx, tripDayId, itemId)` or similar — and call it from **both** the new move and the existing delete at `dayPlanItemRepo.ts:501` (AC6). Fixing the delete path is a few lines once the helper exists, and leaving it unfixed would mean the app cleans up after a move but not after a delete.
  - [x] Mind the unique index `[tripDayId, fromItemType, fromItemId, toItemType, toItemId]` if anything is ever re-created.

- [x] **Task 3 — Where it lands on the target day** (AC: 7)
  - [x] ~~`DayPlanItem` has a `sortOrder` and no unique constraint on it; items are read `orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]`.~~ **False, corrected 2026-08-03 during review.** `DayPlanItem` has no `sortOrder` column (`prisma/schema.prisma:185-206`); ordering is a `fromTime` → `createdAt` → `id` comparator. See the Spec Change Log and the Completion Notes.
  - [x] Two defensible answers: append (max + 1), or insert by `fromTime` so a 09:00 activity lands among the morning entries. The second is friendlier and is what a user moving a *timed* activity would expect; the first is simpler and never surprising.
  - [x] Whichever is chosen, an activity with no time must still get a defined position. Record the choice and why.

- [x] **Task 4 — The API** (AC: 1, 2, 8)
  - [x] `day-activity-transfer/route.ts` is the day-level endpoint and `dayActivityTransferSchema` its payload (`operation: "move" | "swap"`). Decide whether this becomes a third operation there or its own route, and say why. A third operation on a schema whose other two are whole-day is a naming trap of the kind `common.save` was.
  - [x] Same guards as the neighbours: CSRF, session, write access, then validation.
  - [x] Return enough for AC4: the moved item's id, the new day's id, and the removed segments' count or ids.

- [x] **Task 5 — The dialog** (AC: 1, 3, 4, 8)
  - [x] The entry point is the activity dialog, decided with Tommy on 2026-08-02. The alternative — a `⋯` on every activity card — was rejected: the card is a single stretched `<button>` (`day-plan-item-edit-overlay`), so a second control inside it needs the overlay technique from 6.9 or it disappears for assistive technology, and Epic 6 spent five stories removing controls from these screens.
  - [x] The action belongs in the dialog's action area, not among the fields. **Story 6.22 splits this dialog into four tabs** — an action in the footer is unaffected by that, but read 6.22 before placing anything.
  - [x] Reuse the target-day picker the day-level transfer already renders (`trips.dayTransfer.targetLabel`, `TripDayView.tsx:3093`). Exclude the current day.
  - [x] After a successful move: close the dialog, leave the day the user is on, and say what happened — including how many travel segments were removed (AC4). A silent success is wrong here, because something the user typed was deleted.
  - [x] New i18n keys in both dictionaries; `i18nDictionaries.test.ts` enforces parity.

- [x] **Task 6 — Tests** (AC: 2, 3, 4, 6, 8, 9)
  - [x] Repository: the target day's existing activities survive (AC2 — the assertion that catches the destructive shortcut); images and payments follow the item; segments referencing the item are gone from the source day; segments not referencing it are untouched; moving to the same day is rejected.
  - [x] **The delete path too** (AC6): deleting an activity removes its segments. Assert `totalTravelMinutes` no longer counts them.
  - [x] Route: CSRF, session, write access, validation, and a viewer refused.
  - [x] Dialog: the action is absent when creating, present when editing, absent for a viewer; a successful move reports the removed segments.
  - [x] `npm test` green.

- [ ] **Task 7 — Manual check** (AC: 3, 4)
  - [ ] Move an activity that has images, a cost with split payments, a link and a location, and confirm every one of them is on the new day. AC3 is the whole reason the story exists and it is the one thing a unit test can assert but not convince anyone of.
  - [ ] Move an activity that sits between two others with travel segments on both sides, and confirm both days read correctly afterwards and that the message names what was removed.
  - [ ] Throwaway copy of `dev.db` on an isolated port — never `prisma/dev.db`. Recipe in `7-12-bucket-list-sidebar-card.md`'s Dev Notes.

## Dev Notes

### What was asked

Tommy on 2026-08-02: *"Ich will manchmal eine Aktivität auf einen anderen Tag verschieben, weil die dort besser reinpasst. Das kann ich aktuell noch nicht. Nur ganze Tage. Das sollten wir noch ermöglichen, weil man sonst alles neu eingeben muss."*

The last clause is the acceptance criterion in disguise: the value is not the move, it is not retyping. AC3 is therefore the one that must not be compromised.

### The existing "move" is a replace

`moveDayPlanItemsBetweenTripDays` does this, in a transaction:

```ts
await tx.travelSegment.deleteMany({ where: { tripDayId: { in: [source, target] } } });
await tx.dayPlanItem.deleteMany({ where: { id: { in: targetItems.map(i => i.id) } } });   // <-- the target day's activities
await tx.dayPlanItem.updateMany({ where: { id: { in: sourceItems.map(i => i.id) } }, data: { tripDayId: target } });
```

For a whole day that is defensible — Story 6.7 chose it deliberately. For one activity it would delete everything already on the destination. Trap 1 exists because the function's *name* invites exactly that reuse.

### A defect this story has to face, and should fix while it is there

`TravelSegment` references activities by plain string id with a type discriminator, and cascades only on `tripDayId`. So nothing cleans up after an activity that leaves a day — and today nothing does.

Measured on 2026-08-02 against `5c89567`, through the app's own API:

| | activities on the day | "Fahrzeit" |
|---|---|---|
| before | 2 | 5h 30m |
| after deleting the activity the segment points at | 1 | **5h 30m** |

The segment row survives, still pointing at the deleted activity. `totalTravelMinutes` (`TripDayView.tsx:1250-1257`) sums **every** segment on the day, so it keeps counting those 330 minutes — while `segmentsByKey` (`:714`) only ever looks up pairs the timeline actually draws, so the segment is never rendered and there is no way to see or remove it. It is invisible, permanent, and wrong.

This story would multiply that defect on every move. AC6 asks it to fix the cause once, in a helper both paths call, rather than solve it for moving and leave it for deleting.

### What travels for free

Images and payments reference the activity by foreign key, so a single `update` of `tripDayId` carries them. Location, times, cost, link and the rich-text description are columns on the activity itself. So AC3 is nearly free — which is worth knowing before anyone starts writing copy logic.

### Traps

**1. Do not reuse `moveDayPlanItemsBetweenTripDays`.** It deletes the target day's activities. The name says move; the body says replace.

**2. There is no cascade.** `TravelSegment` has no FK to `DayPlanItem`. Every segment cleanup in this story is manual, on both the move and the delete path.

**3. Do not invent a segment.** Neither by joining the moved activity's former neighbours nor by connecting it to its new ones. Transport mode and duration are the user's knowledge, not the app's.

**4. The removal is not silent.** A segment holds a duration, a distance and sometimes a link that someone typed. AC4 asks for it to be reported, not just done.

**5. The card is one button.** `day-plan-item-edit-overlay` is a stretched `<button>` covering the whole activity card. This is why the action went into the dialog; anything placed *on* the card has to solve the same nested-interactive problem 6.9 solved and 6.20 removed.

### Testing

Vitest 3.2 + Testing Library, jsdom. `dayPlanItemRepo.test.ts`, `tripDayPlanItemsRoute.test.ts` and `tripDayPlanDialog.test.tsx` are the constraints. `i18nDictionaries.test.ts` enforces key parity.

### Project Structure Notes

`src/lib/repositories/dayPlanItemRepo.ts`, an API route under `src/app/api/trips/[id]/`, `src/components/features/trips/TripDayPlanDialog.tsx`, `src/lib/validation/dayPlanItemSchemas.ts` (or the transfer schema), both dictionaries, and the affected suites. No schema change and no migration.

### Sequencing

Touches `TripDayPlanDialog.tsx`, which **Story 6.22** restructures into tabs. They do not conflict — this adds an action to the dialog's footer, 6.22 reorganises its fields — but whichever lands second should read the other first.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 6.23]
- [Source: travelplan/src/lib/repositories/dayPlanItemRepo.ts:505-549] — the day-level move, and why it cannot be reused
- [Source: travelplan/src/lib/repositories/dayPlanItemRepo.ts:501] — the delete that leaves segments behind
- [Source: travelplan/prisma/schema.prisma] — `TravelSegment`, referencing activities by plain string
- [Source: travelplan/src/components/features/trips/TripDayView.tsx:1250-1257] — `totalTravelMinutes`, which counts orphans
- [Source: _bmad-output/implementation-artifacts/6-22-activity-dialog-in-tabs.md] — the other story in this dialog

## Spec Change Log

### 2026-08-03 — AC7 and Task 3 named a column that does not exist

- **Triggering finding:** review found that the code satisfies AC7's *intent* but not its *letter*: AC7 asked for a `sortOrder` and Task 3 asserted the column and its `orderBy`. `DayPlanItem` has no `sortOrder` (`prisma/schema.prisma:185-206`); `sortOrder` exists on `DayPlanItemImage`, `AccommodationImage` and `CostPayment`, which is the likely source of the error.
- **Amended:** AC7 now states the outcome (a defined, sensible position, including for an untimed activity, with the choice recorded) instead of prescribing a mechanism. Task 3's first bullet is struck through and corrected in place rather than deleted, so the record of what the spec claimed survives.
- **Known-bad state avoided:** implementing AC7 literally would have required a migration the story forbids, and would have created a second ordering authority competing with a `fromTime` → `createdAt` → `id` comparator that three repositories already agree on.
- **No code was reverted or re-derived.** The delivered behaviour was already the correct reading of the criterion and is unchanged by this amendment; only the spec text moved. Recorded here rather than run through a repair loop because a loopback would have re-produced identical code.
- **KEEP:** the no-write ordering (a moved activity's position follows from `fromTime`, so a 09:00 activity lands among its new day's morning entries), and both tests that pin it — the timed case and the untimed case.

## Operator Pass — 2026-08-03, against `d93164b`

Chromium, German, 390px, isolated worktree on port 3099 against a copy of `dev.db`.

- **AC3 — the reason the story exists, confirmed field by field.** An activity carrying a link, 12000 cents, **two payment rows**, **three images**, a location and a time was moved from day 1 to day 3. On the target day: title, `from_time` 10:30, cost, link and location intact; both payment rows present with the **same amounts, due dates and sort order**; all three images. Nothing was re-entered.
- **AC4:** the message read "Aktivität auf Tag 3 · 16. Dez. 2026 verschoben. **1 Reiseabschnitt entfernt.**" — the singular key, correctly chosen.
- **AC5:** zero travel segments existed afterwards. None was invented on the target day.
- **AC6 — and this closes the defect measured on 2026-08-02.** Deleting an activity that had a 95-minute segment: "Fahrzeit" went **1h 35m → 0m**, the `DELETE` answered `{"deleted":true,"removedTravelSegmentIds":["seg-ac6"]}`, and the database held **0 segments**. The same operation a day earlier left the row in place and the minutes on screen permanently.
- **Viewer (action 7):** a viewer sees **no** edit affordance at all, so the action is unreachable rather than disabled.
- The target-day list starts at Tag 2 — the current day is excluded.

**Action 6, the judgement asked for:** at 390px the dialog footer stacks its four controls on **four separate rows** — `Änderungen speichern` (y=585), `Löschen` (640), `Auf anderen Tag verschieben` (694), `Abbrechen` (749) — roughly 215px of footer beneath 6.22's tab bar. Not broken, but generous.

**Two limits of this pass, stated rather than glossed:** AC2 was only weakly exercised, because the target day was empty and there was nothing to preserve — the unit tests carry that one. Action 4's DW-148 measurement was not taken for the same reason.

**A false finding, recorded so it is not repeated:** a first AC6 attempt driven through the UI reported "Fahrzeit unchanged". The deletion had not happened — the confirmation control was not hit. Verified through the API instead, which is the path the UI calls.

## Dev Agent Record

### Agent Model Used

Claude Opus 5

### Debug Log References

Run from `travelplan/`, each compared against the pre-change baseline rather than read in isolation
(captured by `git stash push --include-untracked`, running the gate, and popping):

- `npx tsc --noEmit` — **143 errors, the same count and the same normalised set as baseline.** All are
  in `test/*.ts(x)` and pre-date this story; **none in `src/`, and none added.** Five new ones did
  appear on the first pass and were removed rather than accepted: four came from
  `planDialogMockState.lastProps?.…` read outside a callback (TypeScript narrows the property to
  `null` after the test's own `lastProps = null`, so the optional-chain branch is `never` — the
  existing tests only get away with it because they read inside `waitFor`), and one from
  `fetchMock.mock.calls` under this repo's `as unknown as typeof fetch` idiom. Both were rewritten to
  the shapes the suite already uses.
- `npm run lint` — `✖ 85 problems (2 errors, 83 warnings)`, **identical to baseline**. Two new
  warnings appeared and were both removed: a `useEffect` clearing the move notice on day change (moved
  to the render-time reset-on-prop-change block `TripDayView` already runs for `dayMenuAnchor`, which
  is React's own prescription and what the file's existing comment argues for), and an unused
  `SelectProps` binding in the MUI mock (folded into the mock's `MUI_ONLY_PROPS` filter instead).
  Both pre-existing errors are `react/no-children-prop` in `theme.ts`.
- `npm test` — `Test Files 110 passed (110) · Tests 1119 passed (1119)`, up from 1095 at 6.22's
  landing. +24: `dayPlanItemRepo.test.ts` 18 → 25, `tripDayPlanItemsRoute.test.ts` 22 → 29,
  `tripDayPlanDialog.test.tsx` 28 → 35, `tripDayViewLayout.test.tsx` 96 → 99.
- No dev server and no browser were started, and `prisma/dev.db` was not touched.

**After the review pass (2026-08-03).** Same three gates, same baselines: `npx tsc --noEmit` **143
errors**, the baseline set exactly — three new ones appeared while writing the review tests and all
three were removed rather than accepted (two from reading a `{ moved }` union off a `vi.hoisted`
property this file widens to `never`, rewritten as two flat fields; one from a `let release: (() =>
void) | null` that TypeScript narrows to `null` at the call site, given a no-op initial value
instead). `npm run lint` **85 problems (2 errors, 83 warnings)**, identical to baseline. `npm test`
**110 files / 1124 tests passing**, +5 over the implementation pass: `tripDayViewLayout.test.tsx`
99 → 102 (the singular-segment message, the failed move's reason travelling back instead of alerting
behind the dialog, and the delete path's travel-time drop without a reload),
`tripDayPlanDialog.test.tsx` 35 → 37 (the pre-move warning, and a double-clicked confirm posting
once). Still no dev server, no browser, and `prisma/dev.db` untouched.

### Completion Notes List

**Task 3's premise is wrong, and the correction is the whole of AC7. `DayPlanItem` has no
`sortOrder` column.** The task says it does and that items are read
`orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]`. Neither is true of this schema — checked
directly in `prisma/schema.prisma:185-206`, which lists `id, tripDayId, title, fromTime, toTime,
contentJson, costCents, linkUrl, locationLat/Lng/Label, createdAt, updatedAt` and nothing else.
(`sortOrder` does exist on `DayPlanItemImage`, `AccommodationImage` and `CostPayment`, which is the
likely source of the confusion.) The column the task names cannot be written because it does not
exist, and the story says no schema change and no migration.

**So the ordering decision is: insert by `fromTime`, achieved with no write at all.** Every reader of
a day's activities already sorts them the same way, through a comparator duplicated verbatim in
`dayPlanItemRepo.ts` (`compareDayPlanItemsByStartTime`), `tripRepo.ts:447` (which is what the day
view actually renders, via `getTripWithDaysForUser`), and `travelSegmentRepo.ts`
(`comparePlanItemsByStartTime`): **`fromTime` ascending, then `createdAt`, then `id`.** A moved 09:00
activity therefore lands among its new day's morning entries the moment its `tripDayId` changes —
which is Task 3's second option, the friendlier one, for free. Task 3's other half is satisfied too:
an activity with no `fromTime` still gets a *defined* position, because the comparator sorts untimed
items after every timed one and then breaks ties on `createdAt` and `id`, which is a total order.
Both halves are pinned by tests (`appends a single activity…` asserts `["Moved", "Target Existing"]`
on the target day; `gives a moved activity without a start time a defined position…` asserts
`["Afternoon", "Untimed"]`).

The alternative — adding a `sortOrder` column so the story could "choose" — was rejected: it is a
migration the story forbids, and it would introduce a second, competing ordering authority next to a
comparator three files already agree on.

**AC3 confirmed, not assumed.** `prisma/schema.prisma`: `DayPlanItemImage.dayPlanItemId` is
`@relation(fields: [dayPlanItemId], references: [id], onDelete: Cascade)` onto `DayPlanItem`, and
`CostPayment.dayPlanItemId` is the same. Both point at the **item row**, not at the day — so a single
`update` of `tripDayId` on that row carries them with no further work, and nothing has to be copied.
Title, description (`contentJson`), `fromTime`/`toTime`, `costCents`, `linkUrl` and
`locationLat`/`Lng`/`Label` are columns on the row itself. The repository test asserts all of it after
a real move: two payment rows in order, two images in order, and every scalar column.

**Task 4 — its own route, not a third operation.** `POST /api/trips/[id]/day-plan-items/move`.
`dayActivityTransferSchema`'s two operations are whole-day, and its `"move"` *deletes the target
day's activities* before reassigning. This operation appends to the target day — the exact opposite —
and putting the two behind one word would be the `common.save` naming trap the task warns about: the
next reader would reasonably assume all three share semantics, and the one who "unifies" them would
destroy data. The payload differs too (it needs an `itemId`), so a third member would have made
`sourceTripDayId`/`targetTripDayId` mean different things per branch. Sitting under
`day-plan-items/` also puts the endpoint next to the resource it moves. Guard order matches the
neighbours: CSRF → session → write access → validation. Write-access failure answers **403
`unauthorized`** (the day-level transfer's code) rather than `day-plan-items`' 404, because AC8 makes
this the transfer's permission.

**AC6 — the shared helper, and what it actually fixes.**
`removeTravelSegmentsReferencingDayPlanItem(tx, tripDayIds, itemId)` in `dayPlanItemRepo.ts` deletes
every segment on the named days whose `fromItemType`/`fromItemId` or `toItemType`/`toItemId` names the
activity, and returns the ids. It is called from both `moveDayPlanItemToTripDay` **and**
`deleteDayPlanItemForTripDay`, which now runs inside a transaction so a delete can never leave an
orphan behind. It takes `tripDayIds` (plural) rather than the single `tripDayId` the task sketched,
because AC4 says the segments go from *both* days and one call is cheaper than two; the delete path
passes `[tripDayId]`.

The delete-path regression test reproduces the story's own measurement rather than counting rows: a
`totalTravelMinutesForDay` helper sums `durationMinutes` over **every** segment on the day, which is
exactly what `TripDayView`'s `totalTravelMinutes` does and exactly why the orphan was invisible
(`segmentsByKey` only resolves pairs the timeline draws) yet permanently counted. Day total goes
350 → 20 after deleting the activity a 330-minute segment pointed at; before this change it stayed
350 forever.

Nothing is invented on either day (AC5): the moved activity's two former neighbours are **not**
joined, and no segment is created on the target day. Because nothing is ever re-created, the unique
index `[tripDayId, fromItemType, fromItemId, toItemType, toItemId]` cannot be violated by this story
— it is only ever deleted from. Both are asserted (`removes only the travel segments that reference
the moved activity and invents none`).

**AC9 — the day-level move and swap are untouched.** `moveDayPlanItemsBetweenTripDays` and
`swapDayPlanItemsBetweenTripDays` were not edited, `dayActivityTransferSchema` was not edited, and
`day-activity-transfer/route.ts` was not edited. Their five existing tests in
`dayPlanItemRepo.test.ts` and all five in `dayActivityTransferRoute.test.ts` still pass unchanged,
including the one that asserts the replace semantics (`expect(await
prisma.dayPlanItem.findUnique({ where: { id: targetItem.id } })).toBeNull()`).

**Where the action sits (Task 5).** `TripDayPlanDialog`'s footer, beside Delete, as a `variant="text"`
button in `tokens.ink` — outside all four of 6.22's tab panels, because moving is an operation on the
whole activity and putting it on `Wann & Wo` would say it belongs to that tab's fields. It opens a
second, small `Dialog` holding the day-level transfer's own picker (`trips.dayTransfer.targetLabel`,
native `select`), with the current day already excluded by the caller. A nested dialog rather than an
expanding block for the same reason: an expanding block would have to live inside a tab. 6.22's
`DialogActions` region, error→tab machinery and panels are otherwise untouched.

**Who owns the message (AC4).** The dialog closes on success, so the sentence cannot live in it.
`TripDayView` owns the request, the reload and the notice. The notice is a `severity="success"` Alert
above the day, in three variants: `trips.plan.moveSuccess` when nothing was removed,
`moveSuccessWithSegment` for one and `moveSuccessWithSegments` for more — a clean move does not
mention travel segments at all, and one segment is not reported as "1 travel segment(s)". It is set
*after* the reload, so a reload that fails shows its own error instead of a success line above a
blank day, and it is cleared on navigation to a sibling day, on a delete, on a dialog save and on the
day-level transfer. A **failed** move is reported inside the dialog instead, because the day screen
is behind a dialog the user is still standing in front of — and it carries the caller's *specific*
message back through `PlanItemMoveOutcome` rather than resolving to a generic retry prompt, since
"your session has expired" and "please try again" ask for different things.

**AC8.** Both `onMove` and `moveTargetDays` are withheld when `!canEditPlanning`, so the action is
absent rather than disabled — the same mechanism `onDelete` uses. `canMove` also requires
`editingItemId` (absent while creating, AC1) and at least one candidate day (a one-day trip has
nowhere to go). Covered at three layers: the repo returns `not_found` for a viewer, the route answers
403 `unauthorized`, and the dialog renders no button.

**Test-suite changes worth knowing about.** The MUI mock in `tripDayPlanDialog.test.tsx` gained a
`select` branch for `TextField` — without it the mock hands `<option>` children to a void `<input>`
and React throws. `tripDayViewLayout.test.tsx`'s plan-dialog mock gained a "Move plan item" button
that stands in for the whole picker by moving to the first candidate the screen offered, which is what
lets that suite test the half of AC4 the dialog cannot (request → reload → sentence). Two `beforeEach`
blocks (`dayPlanItemRepo.test.ts`, `tripDayPlanItemsRoute.test.ts`) gained `travelSegment`,
`dayPlanItemImage`, `tripMember` and `accommodation` cleanup — strictly more cleanup, no existing
assertion relaxed.

**One additive API change beyond the story.** `DELETE /day-plan-items` now returns
`removedTravelSegmentIds` alongside `deleted: true`, and `DayPlanItemDeleteResult`'s `deleted` variant
carries the same field. *(Corrected during review: this paragraph originally said nothing read the
field "because the day view reloads after a delete either way". It does not — `handleDeletePlan` is
optimistic and no reload follows it, so without these ids the client kept the deleted segments in
state and "Fahrzeit" went on counting them for the rest of the session. `handleDeletePlan` now prunes
them, which is AC6's client half and makes the field load-bearing rather than symmetric decoration.)*

**Task 7 is owed to the operator.** It is a browser pass on a throwaway `dev.db` copy, and this
session started neither a dev server nor a browser. AC3 and AC4 are asserted by tests but, as the task
says, a unit test cannot convince anyone that a photo and a split payment schedule really arrived on
the other day.

### File List

- `travelplan/src/lib/repositories/dayPlanItemRepo.ts` — modified. New
  `removeTravelSegmentsReferencingDayPlanItem` helper and a local `TransactionClient` type (same idiom
  as `bucketListRepo.ts`); new `moveDayPlanItemToTripDay` and its `SingleDayPlanItemMoveResult` type;
  `deleteDayPlanItemForTripDay` now runs in a transaction and calls the helper, and its `deleted`
  result carries `removedTravelSegmentIds`. `moveDayPlanItemsBetweenTripDays` and
  `swapDayPlanItemsBetweenTripDays` are untouched.
- `travelplan/src/lib/validation/dayPlanItemSchemas.ts` — modified. New `dayPlanItemMoveSchema` /
  `DayPlanItemMoveInput`. `dayActivityTransferSchema` untouched.
- `travelplan/src/app/api/trips/[id]/day-plan-items/move/route.ts` — **added.** `POST`, guarded
  CSRF → session → write access → validation.
- `travelplan/src/app/api/trips/[id]/day-plan-items/route.ts` — modified. `DELETE` now returns
  `removedTravelSegmentIds`.
- `travelplan/src/components/features/trips/TripDayPlanDialog.tsx` — modified. `moveTargetDays` /
  `onMove` props, `canMove`, `moveOpen`/`moveTargetDayId`/`moving` state (reset on every open),
  `handleMoveConfirm`, the footer button, and the nested target-day dialog. Tabs, panels and the
  error→tab machinery unchanged.
- `travelplan/src/components/features/trips/TripDayView.tsx` — modified. `planMoveNotice` state and
  its Alert, `planMoveTargetDays` derived from the existing `transferTargetOptions`,
  `handleMovePlanItem`, the two new dialog props gated on `canEditPlanning`, and the notice reset
  folded into the existing render-time day-change block. The day-level transfer dialog is untouched.
- `travelplan/src/i18n/en.ts` — added `trips.plan.moveAction`, `moveDialogTitle`, `moveDescription`,
  `moveWarning`, `moveConfirm`, `moveError`, `moveFallbackDay`, `moveSuccess`,
  `moveSuccessWithSegment`, `moveSuccessWithSegments`.
- `travelplan/src/i18n/de.ts` — the same ten keys; the action reads "Auf anderen Tag verschieben".
- `travelplan/test/dayPlanItemRepo.test.ts` — modified. `totalTravelMinutesForDay` helper, stricter
  `beforeEach`, six move tests and the AC6 delete-path regression. 18 → 25.
- `travelplan/test/tripDayPlanItemsRoute.test.ts` — modified. Stricter `beforeEach` and a
  `POST /day-plan-items/move` describe block (contributor move, CSRF, session, viewer, same-day,
  missing item id, unknown item). 22 → 29.
- `travelplan/test/tripDayPlanDialog.test.tsx` — modified. `select` support in the MUI `TextField`
  mock; a "moving the activity to another day" describe block (present when editing, absent when
  creating, absent without a handler, absent with no other day, the full picker→confirm flow, the
  failure path, the German wording). 28 → 35.
- `travelplan/test/tripDayViewLayout.test.tsx` — modified. `moveTargetDays`/`onMove` recorded by the
  plan-dialog mock plus a "Move plan item" button; three tests (the AC4 message with segments, the
  message without, and the viewer's withheld handler). 96 → 99, then 99 → 102 in the review pass.

**Added in the review pass, on top of the above:**

- `travelplan/src/lib/repositories/dayPlanItemRepo.ts` — the move and the delete now decide inside
  their transaction, with `updateMany`/`deleteMany` scoped by `[id, tripDayId]` and a `count` check,
  so neither can race a concurrent write into the wrong day or a P2025.
- `travelplan/src/components/features/trips/TripDayPlanDialog.tsx` — exported
  `PlanItemMoveOutcome`; `onMove` returns it and a failure renders the caller's own message; a
  `movingRef` double-submit guard; `galleryBusy` added to the Move button's `disabled`; the
  `trips.plan.moveWarning` line in the picker.
- `travelplan/src/components/features/trips/TripDayView.tsx` — `handleDeletePlan` prunes
  `removedTravelSegmentIds` from `travelSegments`; `handleMovePlanItem` returns the outcome instead
  of alerting behind the dialog, sets the notice after the reload, resolves the day label against
  every day of the trip with a fallback phrase, and opens with the `canEditPlanning` guard its
  siblings use; the notice is cleared by delete, save and the day-level transfer as well.
- `travelplan/src/app/api/trips/[id]/day-plan-items/route.ts` — the comment claiming nothing reads
  `removedTravelSegmentIds` replaced; the client does.
- `travelplan/test/tripDayPlanDialog.test.tsx` — the MUI mock's `select` branch now forwards
  `aria-invalid`/`inputProps`/`slotProps.htmlInput`; two tests added. 35 → 37.
- `travelplan/test/dayPlanItemRepo.test.ts` — the wrong-source-day move now also asserts the activity
  did not move.

## Review Triage Log

### 2026-08-03 — Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 12: (high 0, medium 4, low 8)
- defer: 3: (high 0, medium 2, low 1)
- reject: 8: (high 0, medium 0, low 8)
- addressed_findings:
  - `[medium]` `[patch]` **The delete path's fix never reached the user.** The server removed the segments, but `handleDeletePlan` is optimistic and nothing reloads the day afterwards, so `travelSegments` kept the deleted rows and "Fahrzeit" went on counting their minutes for the rest of the session — AC6's defect moved out of the database and into the session. The route's comment justifying the dead payload ("the day view reloads after a delete either way") was simply false. `handleDeletePlan` now prunes the returned `removedTravelSegmentIds` from state, which makes that payload load-bearing; comment corrected; new view test drives "Travel time" 2h 10m → 0m with no reload.
  - `[medium]` `[patch]` **A failed move showed the wrong message on the wrong surface.** The specific reason went to the page-level error Alert *behind* the open dialog, while the dialog itself showed a generic "please try again" — so a user whose session had expired was invited to retry the one action that could not succeed, with the diagnosis hidden underneath. `onMove` now returns `PlanItemMoveOutcome` (`{ moved: true } | { moved: false; message }`); the dialog renders the caller's message and the screen no longer alerts behind itself.
  - `[medium]` `[patch]` **A move discarded unsaved edits in the dialog, silently, and disclosed the segment removal only afterwards.** Both are now said before the move, in the picker: `trips.plan.moveWarning` states that unsaved changes are not carried and that travel segments to the activity's neighbours are removed on both days. AC4's own principle — do not remove something the user typed in silence — applied to the warning, not just the receipt. `moveDescription` also gained the title and description it had omitted.
  - `[medium]` `[patch]` **The move was not atomic with its own precondition.** The existence check ran outside the transaction and the write was `update({ where: { id } })`, so a second tab that had already moved the activity elsewhere would have this one drag it out of a third day while sweeping segments on the wrong two — and a concurrent delete threw P2025 out of a route with no `catch`, a 500 where a 404 belonged. Both `moveDayPlanItemToTripDay` and `deleteDayPlanItemForTripDay` now decide inside the transaction with `updateMany`/`deleteMany` scoped by `[id, tripDayId]` and a `count` check. Repo test extended to assert the wrongly-named item did not move.
  - `[low]` `[patch]` `{count} travel segment(s) removed` broke the rule this codebase documents twice in `en.ts` — `formatMessage` has no plural support, so every count-bearing string carries its own singular twin. Added `moveSuccessWithSegment` in both dictionaries; one segment (the common case, for an activity at either end of a day) now reads "1 travel segment removed". New test.
  - `[low]` `[patch]` The success notice was set *before* the reload, so a failed reload showed a green "Activity moved to Day 4" above a blank day and a red error. It is now set after `loadDay()`.
  - `[low]` `[patch]` The notice was cleared only on day navigation and on the next move, so it sat above unrelated later work — including failures. Now also cleared by delete, by a dialog save and by the day-level transfer.
  - `[low]` `[patch]` The target day's label was looked up in the *filtered* candidate list with `?? ""`, so a divergence produced "Activity moved to ." It now resolves against every day of the trip, with `trips.plan.moveFallbackDay` ("another day") when it still cannot.
  - `[low]` `[patch]` The Move button stayed live during an in-flight gallery upload. Each remaining photo posts against the *source* day, so a move committed mid-upload 404s them all — and the dialog is gone by then, so the error is never seen. Now disabled on `galleryBusy` as well.
  - `[low]` `[patch]` `handleMoveConfirm` guarded on `editingItemId`/`onMove`/`moveTargetDayId` but not on `moving`, and two clicks in one tick both run before React re-renders. Added a `movingRef` guard, the same shape Delete on this surface already uses. New test asserts a single call.
  - `[low]` `[patch]` `handleMovePlanItem` was the only new write handler without the `if (!canEditPlanning) return;` its siblings all open with — and `canEditPlanning` defaults to `true` when `accessRole` is absent. Added; defence in depth, the server already refused.
  - `[low]` `[patch]` The MUI mock's new `select` branch dropped `aria-invalid`, `inputProps` and `slotProps.htmlInput`, which the `<input>` branch forwards — invisible today, and silently untestable for the next select field that carries validation. Forwarded.
  - `[low]` `[bad_spec-as-patch]` AC7 and Task 3 named a `sortOrder` column that does not exist. Spec text amended in place, no code reverted or re-derived — the delivered behaviour was already the criterion's correct reading, so a repair loop would have re-produced identical code. Full record in the Spec Change Log.

**Deferred:** DW-148 (inserting an activity strands its new neighbours' segment — pre-existing, reachable today by creating or retiming an activity, and the fix is a day-wide segment/timeline reconciliation across create, update *and* move), DW-149 (`deleteAccommodationForTripDay` has no segment sweep — the `ACCOMMODATION` half of the same enum), DW-150 (the ordering comparator is copied verbatim into three repositories, and AC7 now depends on them agreeing).

**Rejected as noise:** `moveTargetDayId` outliving its option (degrades to a 404 with a message); the picker unmounting mid-move if the candidate list empties; a cancelled picker keeping its selection; `TransactionClient` duplicated from `bucketListRepo`; the sweep's `orderBy` on an unordered id set; `parseJson`'s falsy-body conflation (a copied convention, identical in every sibling route); the delete confirmation not naming the segments (AC4 scopes the reporting to the move, and "Travel time" now visibly drops); the three-secondary-button footer at 390px — not rejected as wrong, but it is a rendered-pixel judgement and belongs to Task 7, so it became an operator action instead.

### Change Log

| Date | Change |
|---|---|
| 2026-08-03 | Review pass: 12 findings patched (4 medium — the delete path's segment removal never reaching client state so "Fahrzeit" kept counting it; a failed move showing a generic message in the dialog while the specific one sat on the covered page behind it; unsaved edits discarded and the segment removal disclosed only after the fact; the move's precondition checked outside its own transaction), 3 deferred as DW-148/149/150, 8 rejected. AC7 and Task 3 corrected in place — they named a `sortOrder` column that does not exist; no code was reverted, because the delivered behaviour was already the criterion's correct reading. Gates re-run at baseline: `tsc` 143, `lint` 85, `npm test` 1124/1124. |
| 2026-08-03 | Tasks 1–6 implemented. New `moveDayPlanItemToTripDay` repository function (append-only, never a reuse of the day-level replace) behind a new `POST /api/trips/[id]/day-plan-items/move` route, reached from a footer action in the activity dialog with the day-level transfer's own target-day picker. Travel segments referencing the activity are removed on both days through a shared helper that the **delete** path now calls too, closing the orphaned-segment defect that kept `totalTravelMinutes` counting travel to activities that no longer exist. Ordering on the target day needs no write: `DayPlanItem` has no `sortOrder` column and every reader sorts by `fromTime` then `createdAt` then `id` — Task 3's premise corrected in the Completion Notes. Gates: `tsc` 143 errors (baseline, none in `src/`), `lint` 85 problems (baseline), `npm test` 1119/1119 across 110 files. Task 7 (browser check for AC3/AC4) left for the operator. |

## Auto Run Result

Status: awaiting-operator — Tasks 1–6 are done and reviewed; Task 7 is a browser pass no agent can perform, enumerated under `operator_actions`.

### What was built

One activity can now be moved to another day of the same trip, from a footer action in the activity
dialog. The target day is **appended to**, never replaced — deliberately not the day-level "move",
whose `deleteMany` on the target day's activities makes it a whole-day replace wearing the name move.
Everything attached to the activity travels with it through a single `update` of `tripDayId`, because
images and cost payments are foreign keys onto the item row rather than onto the day. Travel segments
that referenced the activity are deleted on both days and reported to the user; none is invented on
either side. The same removal now runs on the **delete** path, which previously left segments behind
that `totalTravelMinutes` counted forever and nothing ever drew.

### Files changed

| File | Change |
|---|---|
| `travelplan/src/lib/repositories/dayPlanItemRepo.ts` | `removeTravelSegmentsReferencingDayPlanItem` helper; new `moveDayPlanItemToTripDay`; `deleteDayPlanItemForTripDay` now transactional and calls the helper. Both decide inside their transaction, scoped by `[id, tripDayId]`. |
| `travelplan/src/lib/validation/dayPlanItemSchemas.ts` | `dayPlanItemMoveSchema` — its own schema, not a third operation on the whole-day transfer. |
| `travelplan/src/app/api/trips/[id]/day-plan-items/move/route.ts` | **New.** `POST`, guarded CSRF → session → write access → validation. |
| `travelplan/src/app/api/trips/[id]/day-plan-items/route.ts` | `DELETE` returns `removedTravelSegmentIds`, which the client now consumes. |
| `travelplan/src/components/features/trips/TripDayPlanDialog.tsx` | Footer action, nested target-day picker with a pre-move warning, `PlanItemMoveOutcome`, busy and double-submit guards. 6.22's tabs untouched. |
| `travelplan/src/components/features/trips/TripDayView.tsx` | The request, the reload, the success notice and its lifecycle; the delete path's segment pruning; `canEditPlanning` gating. |
| `travelplan/src/i18n/en.ts`, `de.ts` | Ten keys each, singular and plural twins for the count-bearing one. |
| `travelplan/test/*` (4 suites) | +29 tests over the 6.22 baseline. |

### Review

Two adversarial reviewers, run in parallel without prior context. **0 intent_gap, 0 bad_spec,
12 patched** (4 medium: the delete fix never reaching client state; a failed move's specific reason
rendered on the surface the dialog covers; unsaved edits discarded with disclosure only after the
fact; the move's precondition checked outside its own transaction), **3 deferred** (DW-148, DW-149,
DW-150), **8 rejected.** AC7 and Task 3 were corrected in the spec — they named a `sortOrder` column
that does not exist — without reverting code, since the delivered ordering was already the
criterion's correct reading. Full triage above.

`followup_review_recommended: true` — the patches changed a prop contract (`onMove`), the delete
path's client behaviour and the transaction boundaries of two repository functions. That is more than
localized polish and benefits from an independent pass.

### Verification

- `npm test` — 110 files, **1124 tests passing** (1095 at 6.22's landing).
- `npx tsc --noEmit` — **143 errors, the baseline set**; all in `test/`, none in `src/`, none added.
- `npm run lint` — **85 problems (2 errors, 83 warnings)**, identical to baseline.
- No dev server, no browser, `prisma/dev.db` untouched.

### Residual risks

- **DW-148 is live and reachable through this feature.** Moving an activity into a gap between two
  activities that already have a segment between them strands that segment: no longer drawn, still
  counted in "Fahrzeit", and `createTravelSegmentForTripDay` will refuse to re-create the pair, so
  the day cannot be repaired through the UI. Pre-existing — creating or retiming an activity does the
  same today — and the fix is a day-wide reconciliation across create, update and move, which is its
  own story. An operator action asks for the number to be recorded.
- **AC3 has never been seen.** It is asserted at the repository layer against a real SQLite database,
  which is strong evidence, but no photo, payment schedule or map pin has been looked at on a target
  day in a browser. That is Task 7.
- **The dialog footer now carries four controls at 390px**, under 6.22's tab bar. jsdom computes no
  layout, so nothing in the suite can judge it.

## Operator Confirmation

Confirmed 2026-08-03: the external actions this story owed were carried out.

- Do Task 7 in a real browser, on a throwaway copy of dev.db on an isolated port — never prisma/dev.db. The recipe is in the Dev Notes of _bmad-output/implementation-artifacts/7-12-bucket-list-sidebar-card.md. AC3 is the reason the story exists and it is the one thing a unit test can assert but not convince anyone of.
- Move an activity that has images, a cost split across several payment rows, a link and a location, and confirm on the target day that every one of them is there — the photos in the gallery, the payment rows in order with the same due dates, the link live, the map pin in the right place. If any of them is missing, stop: that is AC3 failing and it is the whole story.
- Move an activity that sits between two others with travel segments on both sides. Confirm both days read correctly afterwards, that no segment was invented on the target day, and that the green line names how many were removed ('2 travel segments removed', and '1 travel segment removed' when only one goes — the singular is its own key).
- Check the target day's own travel time after that move, and expect it to be wrong: if the activity landed between two activities that already had a segment between them, that segment is now drawn by nothing but still counted in 'Fahrzeit'. This is DW-148, it is pre-existing (creating or retiming an activity does the same), and it is deferred, not fixed. Record the number so the ledger entry has a measurement, and do not treat it as a regression from this story.
- Delete an activity that has a travel segment and watch the 'Fahrzeit' stat drop immediately, without reloading the page. Before this story the minutes stayed on screen — and in the database — forever. That is AC6.
- Open the activity dialog at a 390px viewport in German and look at the footer: it now carries Abbrechen, 'Auf anderen Tag verschieben', Löschen and Speichern. Judge whether four controls in that row still read cleanly under 6.22's tab bar, and say so if they do not — the fix would be a layout story, not an edit here.
- Try the move as a viewer (a share link with view-only access): the action must be absent from the dialog, not present-but-disabled.
- If every check passes, tick Task 7 in this spec, set status: done in the frontmatter and Status: done in the body, and set 6-23-move-a-single-activity-to-another-day to done in sprint-status.yaml.

_Appended by the bmad-loop orchestrator (`bmad-loop confirm`, #335): a human confirmed these external actions out of band, and the story was advanced from `awaiting-operator` to `done`._
