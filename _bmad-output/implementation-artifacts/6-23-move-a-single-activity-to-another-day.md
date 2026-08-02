---
authored_against: 5c89567
---

# Story 6.23: Move a Single Activity to Another Day

Status: ready-for-dev

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
7. **Ordering on the target day is deliberate.** The moved activity gets a `sortOrder` that places it sensibly among the activities already there, and the choice is recorded.
8. **Same permission as the existing transfer.** `canEditPlanning` governs; a viewer sees no such action.
9. **The day-level move and swap are unchanged.** Both keep their current behaviour, including the replace semantics of "move".

## Tasks / Subtasks

- [ ] **Task 1 — A new repository function, not an extension of the old one** (AC: 2, 3, 7)
  - [ ] `moveDayPlanItemsBetweenTripDays` (`dayPlanItemRepo.ts:505`) **deletes the target day's items** before moving the source day's across. It is a whole-day replace wearing the name "move". Reusing or parameterising it is the one shortcut that would destroy data.
  - [ ] Write `moveDayPlanItemToTripDay({ userId, tripId, itemId, targetTripDayId })`. Reuse `findTransferTripDaysForWriter` for the access check — both days must belong to a trip the user may write.
  - [ ] The move itself is a single `update` of `tripDayId`. Images (`day_plan_item_images`) and payments (`cost_payments`) reference the item by foreign key, so they follow with no work. Confirm that rather than assuming it, and say so in the Dev Agent Record — it is the whole of AC3.
  - [ ] Reject moving to the day the activity is already on, the way the existing functions reject `same_day`.

- [ ] **Task 2 — The travel segments are the hard part** (AC: 4, 5, 6)
  - [ ] `TravelSegment` has **no foreign key to `DayPlanItem`**: `fromItemId`/`toItemId` are plain strings paired with a `fromItemType`/`toItemType` discriminator (`prisma/schema.prisma`). There is no cascade. Nothing cleans up after a moved or deleted activity unless this story does.
  - [ ] On the source day, find every segment where (`fromItemType = DAY_PLAN_ITEM` and `fromItemId = itemId`) or (`toItemType = DAY_PLAN_ITEM` and `toItemId = itemId`), and delete them. Return what was deleted so the UI can report it (AC4).
  - [ ] Do **not** heal the chain by joining the moved activity's two former neighbours. Their transport mode, duration and distance are unknowable; a fabricated segment is worse than a visible gap the user can fill.
  - [ ] Do **not** create a segment on the target day either, for the same reason (AC5).
  - [ ] Extract this as one helper — `removeTravelSegmentsReferencing(tx, tripDayId, itemId)` or similar — and call it from **both** the new move and the existing delete at `dayPlanItemRepo.ts:501` (AC6). Fixing the delete path is a few lines once the helper exists, and leaving it unfixed would mean the app cleans up after a move but not after a delete.
  - [ ] Mind the unique index `[tripDayId, fromItemType, fromItemId, toItemType, toItemId]` if anything is ever re-created.

- [ ] **Task 3 — Where it lands on the target day** (AC: 7)
  - [ ] `DayPlanItem` has a `sortOrder` and no unique constraint on it; items are read `orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]`.
  - [ ] Two defensible answers: append (max + 1), or insert by `fromTime` so a 09:00 activity lands among the morning entries. The second is friendlier and is what a user moving a *timed* activity would expect; the first is simpler and never surprising.
  - [ ] Whichever is chosen, an activity with no time must still get a defined position. Record the choice and why.

- [ ] **Task 4 — The API** (AC: 1, 2, 8)
  - [ ] `day-activity-transfer/route.ts` is the day-level endpoint and `dayActivityTransferSchema` its payload (`operation: "move" | "swap"`). Decide whether this becomes a third operation there or its own route, and say why. A third operation on a schema whose other two are whole-day is a naming trap of the kind `common.save` was.
  - [ ] Same guards as the neighbours: CSRF, session, write access, then validation.
  - [ ] Return enough for AC4: the moved item's id, the new day's id, and the removed segments' count or ids.

- [ ] **Task 5 — The dialog** (AC: 1, 3, 4, 8)
  - [ ] The entry point is the activity dialog, decided with Tommy on 2026-08-02. The alternative — a `⋯` on every activity card — was rejected: the card is a single stretched `<button>` (`day-plan-item-edit-overlay`), so a second control inside it needs the overlay technique from 6.9 or it disappears for assistive technology, and Epic 6 spent five stories removing controls from these screens.
  - [ ] The action belongs in the dialog's action area, not among the fields. **Story 6.22 splits this dialog into four tabs** — an action in the footer is unaffected by that, but read 6.22 before placing anything.
  - [ ] Reuse the target-day picker the day-level transfer already renders (`trips.dayTransfer.targetLabel`, `TripDayView.tsx:3093`). Exclude the current day.
  - [ ] After a successful move: close the dialog, leave the day the user is on, and say what happened — including how many travel segments were removed (AC4). A silent success is wrong here, because something the user typed was deleted.
  - [ ] New i18n keys in both dictionaries; `i18nDictionaries.test.ts` enforces parity.

- [ ] **Task 6 — Tests** (AC: 2, 3, 4, 6, 8, 9)
  - [ ] Repository: the target day's existing activities survive (AC2 — the assertion that catches the destructive shortcut); images and payments follow the item; segments referencing the item are gone from the source day; segments not referencing it are untouched; moving to the same day is rejected.
  - [ ] **The delete path too** (AC6): deleting an activity removes its segments. Assert `totalTravelMinutes` no longer counts them.
  - [ ] Route: CSRF, session, write access, validation, and a viewer refused.
  - [ ] Dialog: the action is absent when creating, present when editing, absent for a viewer; a successful move reports the removed segments.
  - [ ] `npm test` green.

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

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

### Change Log
