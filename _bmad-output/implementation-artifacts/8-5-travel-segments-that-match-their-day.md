---
authored_against: 84fd6fb
baseline_commit: 84fd6fb94d399bda42765a576c3061a003f3e402
---

# Story 8.5: Travel Segments That Match Their Day

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## What this bundles

Four ledger entries about travel segments that no longer match the day they belong to. Three of them **produce** such rows; the fourth is what living with them costs.

| Entry | Severity | Role |
|---|---|---|
| DW-79 | medium | Producer — deleting a stay leaves segments pointing at it |
| DW-215 | medium | The same defect, found again from the other side |
| DW-148 | medium | Producer — inserting or retiming an activity strands its neighbours' segment |
| DW-151 | medium | Consequence — stranded rows are counted, undrawable, and unremovable |

**DW-79 already carries a recorded decision** (2026-08-09). DW-148 and DW-151 both end with "needs its own story, and a decision" — this is that story, and the decision is proposed below.

## ⛔ This was reported from production

On 2026-08-07 the owner deleted an activity, watched a travel segment disappear that should have survived, and then could not re-create the route between two activities: the app answered **"Travel segment already exists"**.

That is DW-151 exactly. `POST` refuses because the `@@unique([tripDayId, fromItemType, fromItemId, toItemType, toItemId])` row is genuinely there — while `buildSegmentTimeline` no longer produces that endpoint pair, so the day view never draws it and `ensureSegmentItemsExist` answers `missing` for any attempt to edit or delete it. The row is real, invisible, counted in "Fahrzeit", and unreachable through every control the UI offers.

## The distinction this story is built on

The two producers are **not** the same case, and the fix must not treat them alike:

**An endpoint ceased to exist** — the stay was deleted. The segment describes a journey to a place that is gone. Nothing can repair it and nobody can supply the missing half. *Delete the segment.* This is what `dayPlanItemRepo` already does for activities and what DW-79's recorded decision asks for.

**Both endpoints still exist, only adjacency changed** — an activity was inserted between A and B, or retimed so the order changed. The segment still describes a real journey the user measured: a transport mode, a duration, a distance. None of that is derivable. *Keep it and show it,* so the user can decide.

Story 6.23 already argued the second half of this, in the comment above the helper this story extends:

> It deliberately does **not** heal the chain by joining the removed activity's two former neighbours … transport mode, duration and distance are the user's knowledge, and a fabricated segment is worse than a visible gap.

Silently deleting a stranded segment on insertion is the same mistake pointing the other way: it destroys measured knowledge because the timeline moved. So the rule is *endpoint gone → delete; adjacency changed → surface*.

## Story

As someone planning a day,
I want the travel legs on that day to be the ones I can see and change,
so that a stay I deleted or an activity I inserted does not leave minutes in my travel time that nothing on the screen can account for.

## Acceptance Criteria

1. **AC1** — Deleting an accommodation removes every travel segment whose endpoint was that accommodation, in the same transaction as the delete.
2. **AC2** — The cleanup is expressed once for both endpoint types rather than as a second near-identical helper. `TravelSegmentItemType` has exactly two members and both are now handled by the same code path.
3. **AC3** — Inserting an activity between two others, retiming one so the order changes, or moving one away, does **not** delete the neighbours' segment. The row survives with its transport mode, duration and distance intact.
4. **AC4** — A segment whose endpoints exist but are no longer adjacent is visible on the day as an orphaned leg, showing what it records, with a control that removes it.
5. **AC5** — The day's travel-time total counts exactly the segments the timeline draws. An orphaned leg is reported separately or not at all — never folded silently into "Fahrzeit".
6. **AC6** — An orphaned leg can be deleted through the UI. `ensureSegmentItemsExist` answering `missing` must no longer be what stands between the user and their own row.
7. **AC7** — Creating a segment for a pair that already has one still refuses, but the refusal names the real reason and the day now offers a way to reach the existing row. "Travel segment already exists" against an invisible row is the bug, not the message.
8. **AC8** — Import fidelity is unchanged: Story 2.35 deliberately restores segments rather than dropping them, and a restored orphan surfaces through AC4 rather than being discarded on the way in.

## Tasks / Subtasks

- [ ] `src/lib/repositories/dayPlanItemRepo.ts` — generalise `removeTravelSegmentsReferencingDayPlanItem` (`:286`) to take an `itemType` alongside the id, so it serves both members of `TravelSegmentItemType`. DW-215 asks for this decision explicitly: one type-agnostic helper, not a second copy. Move it somewhere both repositories can reach — AC2
- [ ] `src/lib/repositories/accommodationRepo.ts` — `deleteAccommodationForTripDay` (`~:413`) is a bare `prisma.accommodation.delete` with no transaction and no segment cleanup. Wrap it and call the shared helper with `ACCOMMODATION`, mirroring what the activity path already does. Per DW-79's recorded decision — AC1, AC2
- [ ] `src/lib/repositories/travelSegmentRepo.ts` — a day's segments must be classifiable as *drawn* or *orphaned*. `buildSegmentTimeline` (`:197`) already produces the ordered endpoint list and `ensureSegmentItemsExist` (`:250`) already computes adjacency (`toIndex !== fromIndex + 1`); expose that judgement for a whole day rather than for one candidate pair — AC4, AC5
- [ ] `src/lib/repositories/travelSegmentRepo.ts` — allow **deletion** of a segment whose endpoints are non-adjacent or absent. Creation must keep refusing (`not_adjacent` is a correct answer for a new pair); removal must not, or AC6 cannot hold. Separate the two paths' use of `ensureSegmentItemsExist` — AC6, AC7
- [ ] `src/components/features/trips/TripDayView.tsx` — `totalTravelMinutes` currently reduces over every fetched segment while `segmentsByKey` draws only the timeline's pairs (`:868-877`). Compute the total from the drawn set — AC5
- [ ] `src/components/features/trips/TripDayView.tsx` — render orphaned legs. They belong near the day's travel figures rather than inside the timeline, because they have no position in it; each shows its endpoints as recorded, its mode and duration, and a remove control — AC4, AC6
- [ ] `src/i18n/en.ts`, `src/i18n/de.ts` — strings for the orphaned-leg row and its removal, in both dictionaries — AC4
- [ ] `test/` — the producer cases: deleting a stay removes its segments (the mirror of `dayPlanItemRepo.test.ts`'s existing "removes the travel segments referencing a deleted activity so the day stops counting them"); inserting an activity between two others leaves the neighbours' segment intact — AC1, AC3
- [ ] `test/` — the consequence cases: a non-adjacent segment is excluded from the total, rendered as an orphaned leg, and deletable through the route. **Write the deletion case first and watch it fail** — today it answers `missing` — AC5, AC6
- [ ] `test/` — the production reproduction: a day with A→B, insert M between them, assert the day view offers a way to resolve A→B rather than answering "already exists" with nothing on screen — AC7

## Dev Notes

### Why "already exists" is unreachable today

Three pieces have to line up for the reported symptom:

1. `buildSegmentTimeline` builds the day's ordered endpoints — this day's stay and plan items, plus the *immediately preceding* day's accommodation and nothing further back (`dayIndex: { lt }`, `orderBy` desc, `findFirst`).
2. `ensureSegmentItemsExist` accepts a pair only when `toIndex === fromIndex + 1`. Anything else is `missing` or `not_adjacent` — and both the edit and the delete path go through it.
3. The database still holds the row, guarded by `@@unique([tripDayId, fromItemType, fromItemId, toItemType, toItemId])`.

So the row blocks creation while every read and every mutation the UI can issue declines to see it. Note point 1's second half: deleting a day between a segment's endpoints silently turns a drawable distance-1 previous-stay reference into an undrawable distance-2 one, with nothing deleted at all.

### The consequence half needs the producers fixed first, but not only

Fixing the producers (AC1, AC3) stops new orphans. It does **not** clean up the rows already in the database — Tommy's production trip has at least one — and this story deliberately does not migrate them. AC4's orphaned-leg row is what makes existing ones resolvable by the person who owns them, which is safer than a migration guessing which rows were meant.

### What must not regress

- **Story 6.23's non-healing rule.** `removeTravelSegmentsReferencingDayPlanItem`'s docblock states it does not join the removed activity's former neighbours and does not create anything on the target day. Generalising the helper must not quietly add healing.
- **`createTravelSegmentForTripDay`'s adjacency refusal.** A *new* segment for a non-adjacent pair is still wrong. Only removal is being widened.
- **Import fidelity (AC8).** Story 2.35 restores segments as backed up, on purpose: "a restore that discarded them would make the backup differ from what was backed up." Do not add a drop-on-import.
- **The `@@unique` constraint.** DW-79 notes that Story 2.32's id remapping will hit it if a remap ever collapses two old ids onto one new one. Not this story's job, but do not remove the constraint to make anything here easier.
- **The writer clause.** `buildSegmentTimeline` and the repositories carry Story 5.13's `OR: [{ userId }, { members: { some: { userId, role: "CONTRIBUTOR" } } }]`. A contributor may delete an orphaned leg exactly as they may delete a segment.

### Traps

1. **Deleting stranded segments on insert because it is simpler.** That is the decision this story explicitly declines — see the distinction above. It destroys a duration and distance the user measured, at the moment they merely retime an activity.
2. **Adding a second `removeTravelSegmentsReferencingAccommodation`.** DW-215 names this as the thing to avoid; the enum has two members and one helper should serve both.
3. **Widening `ensureSegmentItemsExist` for every caller.** Creation must keep refusing non-adjacent pairs. Only the delete path changes.
4. **Fixing the total without surfacing the rows.** Excluding orphans from "Fahrzeit" alone makes them *invisible and uncounted* rather than *invisible and counted* — the user still cannot delete them, and the "already exists" refusal still has no explanation.
5. **Treating DW-79 and DW-215 as two pieces of work.** They are the same defect recorded by two reviews from different angles. Both close together.

### Testing

`vitest` (`npm test`), suites under `travelplan/test/`. `dayPlanItemRepo.test.ts` already contains the activity-side precedent for AC1 and is the model for the stay-side case. Component cases use `renderWithProviders` with `// @vitest-environment jsdom`.

The AC6 deletion test must fail before the change — today the route answers `missing`. A green-from-the-start version of that test proves nothing.

Record the full-suite baseline before starting and report it after.

### Project Structure Notes

No new dependency, no migration, no schema change — the `@@unique` constraint and the FK-less endpoint columns stay as they are. One helper generalised and relocated, one repository gaining a transaction, one repository gaining a day-level classification, one component's total corrected plus a new row type, and both dictionaries.

### References

- The four ledger entries: DW-79, DW-215, DW-148, DW-151 in `_bmad-output/implementation-artifacts/deferred-work.md`
- The non-healing rule to preserve: [Source: _bmad-output/implementation-artifacts/6-23-move-a-single-activity-to-another-day.md]
- Import fidelity: [Source: _bmad-output/implementation-artifacts/2-35-import-accepts-a-valid-backup.md]
- Adjacency and timeline construction: `travelplan/src/lib/repositories/travelSegmentRepo.ts:197-264`
- Epic definition: [Source: _bmad-output/planning-artifacts/epics.md#Story 8.5: Travel Segments That Match Their Day]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

### Change Log
