# Story 6.4: Fix Day View Accommodation Cost Duplication

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner,
I want the day-view cost area to count an overnight stay only on the day that owns that stay,
so that the daily total is accurate and the same accommodation cost is not shown again on the following day as previous-night context.

## Acceptance Criteria

1. Given a day view shows a previous-night accommodation that was already counted on the prior day, when the day-view cost area renders for the current day, then that previous-night accommodation cost is not included in the current day's cost list and it is not included in the current day's displayed total.
2. Given a day has a current-night accommodation with a saved cost, when the day-view cost area renders, then that current-night accommodation cost is included in the current day's cost list and total.
3. Given a day has day-plan items with costs, when the day-view cost area renders, then those item costs continue to appear unchanged and they continue to be included in the current day's displayed total.
4. Given a previous-night accommodation is shown in day view for timeline or context purposes, when the day-view page renders, then the accommodation card and hotel-time context remain visible and only the duplicated cost attribution is removed from the current day's cost area.
5. Given a day has no current-night accommodation cost and no day-plan item costs, when the day-view cost area renders, then it continues to show the existing zero-cost or empty-cost behavior without errors.

## Tasks / Subtasks

- [x] Task 1: Remove previous-night accommodation cost from the day-view budget entry list and total calculation. (AC: 1, 4, 5)
  - [x] Update the day-view budget-entry builder in `travelplan/src/components/features/trips/TripDayView.tsx` so previous-night accommodation remains visible in the page layout but is excluded from the day-view cost summary list.
  - [x] Keep the current-night accommodation and day-plan-item cost rows unchanged.
  - [x] Keep the local day total derived from the same visible entries so the list and total cannot drift apart.
- [x] Task 2: Preserve overnight context outside the duplicated cost summary. (AC: 4)
  - [x] Keep previous-night accommodation rendering, links, notes, feedback trigger, images, and hotel-time range behavior intact.
  - [x] Avoid broad refactors to trip-level totals, payment schedules, or non-day-view budget surfaces unless a shared helper absolutely requires a narrow compatibility adjustment.
- [x] Task 3: Add regression coverage for overnight cost attribution in day view. (AC: 1, 2, 3, 4, 5)
  - [x] Extend `travelplan/test/tripDayViewLayout.test.tsx` with a case where the selected day shows both a previous-night accommodation cost and a current-night accommodation cost.
  - [x] Assert that the previous-night accommodation label or card may still render, but its cost is not listed in the day-view cost summary for the selected day.
  - [x] Assert that the displayed day total reflects current-night accommodation plus day-plan-item costs only.
  - [x] Cover the zero-cost case so removing previous-night attribution does not regress the existing empty-state behavior.

## Dev Notes

### Developer Context

The current bug is in the day-view page's local cost summary behavior, not in the existence of previous-night accommodation itself. Day view intentionally shows the previous-night stay for overnight context and hotel-time coverage, but the user reports that its cost is being shown again on the following day even though that same stay was already counted on the prior day. The fix should therefore stay tightly scoped to cost attribution in the day-view summary area.

Story 2.8 introduced day and trip budget totals from accommodation costs, Story 2.19 extended totals to include day-plan-item costs, Story 2.22 established previous-night/current-night accommodation semantics in day view, and Story 2.25 reinforced that the previous-night stay is contextual and distinct from the current-night stay. Reuse those semantics rather than introducing a new accommodation ownership model.

### Technical Requirements

- Treat the current day's day-view cost area as an itemized summary of costs owned by that day: current-night accommodation plus day-plan-item costs.
- Do not count previous-night accommodation cost in the selected day's day-view summary even when the previous-night accommodation card is rendered for context.
- Keep the displayed day total computed from the same visible summary entries.
- Preserve all existing accommodation and day-plan-item labels, formatting, and currency display conventions.
- Do not change persistence, API payload shape, or database schema for this story unless implementation uncovers a narrow bug in a shared helper that directly affects the day-view cost area.
- Preserve trip-level totals and non-day-view budget behavior unless a failing regression proves they are coupled to the same bug.

### Architecture Compliance

- Keep the primary implementation localized to `travelplan/src/components/features/trips/TripDayView.tsx`.
- Preserve repository and API contracts under `travelplan/src/lib/repositories/tripRepo.ts` and `travelplan/src/app/api/trips/[id]/route.ts` unless a narrow consistency fix is required.
- Keep shared budget overview behavior in `travelplan/src/components/features/trips/TripCostOverview.tsx` unchanged unless the same attribution bug is confirmed there by test evidence.
- Maintain existing i18n usage from `travelplan/src/i18n/en.ts` and `travelplan/src/i18n/de.ts`; no new labels should be necessary if the fix is implemented by removing duplicate summary entries rather than renaming them.

### Library / Framework Requirements

- Stay on the currently pinned stack in `travelplan/package.json`, especially `next@16.1.6`, `react@19.2.3`, and `@mui/material@7.3.8`.
- Reuse existing React state and memoization patterns already present in `TripDayView.tsx`.
- Do not add dependencies for this story.

### File Structure Requirements

- Primary UI implementation: `travelplan/src/components/features/trips/TripDayView.tsx`
- Potentially relevant read-only contract reference: `travelplan/src/lib/repositories/tripRepo.ts`
- Potentially relevant API shape reference: `travelplan/src/app/api/trips/[id]/route.ts`
- Regression coverage: `travelplan/test/tripDayViewLayout.test.tsx`

### Testing Requirements

- UI regression test: selected day with previous-night accommodation cost and current-night accommodation cost only shows the current-night stay in the day-view cost summary.
- UI regression test: selected day with previous-night accommodation cost plus one or more priced day-plan items totals only current-night stay plus plan items.
- UI regression test: previous-night accommodation card and hotel-time context still render after the cost-summary fix.
- UI regression test: no-cost scenarios still show the existing `0.00` or empty-cost behavior without crashes.

### Previous Story Intelligence

- Story 2.19 explicitly defined day total behavior as visible accommodation cost plus day-plan-item costs; this story refines that rule for the day-view overnight split by making clear that "visible accommodation cost" for the selected day means the current-night stay, not the prior night's contextual card.
- Story 2.22 made previous-night accommodation part of the selected day's timeline context through checkout time and hotel-time display, which is why this bug can exist without changing the accommodation model itself.
- Story 2.25 preserved previous-night/current-night distinction when copying stays and intentionally avoided copying cost into the next night, reinforcing that overnight context and day ownership are separate concerns.

### Git Intelligence Summary

- Recent Epic 6 commits have been narrowly scoped UI refinements, so this story should stay as a targeted day-view fix instead of broad budget refactoring.
- The repository already has extensive day-view layout coverage in `tripDayViewLayout.test.tsx`; extend that suite rather than creating a separate ad hoc test file.
- Current implementation evidence shows the duplicate attribution seam lives in the local `budgetEntries` calculation inside `TripDayView.tsx`.

### Latest Tech Information

- No additional external technical research is required for this story. The change stays within the repo's pinned local stack and existing component patterns.

### Project Context Reference

No `project-context.md` file was found in this repository.

### Project Structure Notes

- `TripDayView.tsx` currently builds `budgetEntries` from `previousStay`, `planItems`, and `currentStay`, then derives `dayTotalCents` from those entries. That is the main implementation seam for removing duplicate previous-night cost attribution.
- `tripRepo.ts` computes `plannedCostSubtotal` from the current day's accommodation record plus day-plan-item costs. Day view currently derives its own local budget summary, so keep the local summary aligned with the intended ownership rule rather than introducing a second interpretation.
- `TripCostOverview.tsx` already itemizes only the current-day accommodation entry in day mode. Unless tests prove otherwise, use that as a consistency reference rather than changing it.

### References

- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/epics.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/prd.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/architecture.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/ux-design-specification.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/2-8-budget-totals-by-trip-and-by-day.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/2-19-day-plan-item-costs-roll-up-to-day-and-trip-totals.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/2-22-accommodation-check-in-and-check-out-times.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/2-25-copy-accommodation-from-previous-night.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/6-3-optimize-comments.md`
- `/Users/tommy/Development/TravelPlan/travelplan/src/components/features/trips/TripDayView.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/src/components/features/trips/TripCostOverview.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/src/lib/repositories/tripRepo.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/app/api/trips/[id]/route.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/test/tripDayViewLayout.test.tsx`

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Story `6-4-fix-day-view-accommodation-cost-duplication` was requested directly by the user and did not yet exist in `epics.md` or `sprint-status.yaml`, so the planning artifacts were updated first.
- No `project-context.md` file exists in this repository, so context came from the planning artifacts, Stories 2.8, 2.19, 2.22, 2.25, Story 6.3, and the current day-view and cost-overview implementation.
- `_bmad/core/tasks/validate-workflow.xml` is referenced by the BMAD workflow but is not present in this repository, so checklist validation could not be run through the expected task runner.
- Implementation seam confirmed locally in `TripDayView.tsx`: the day-view budget summary currently constructs entries from `previousStay`, `planItems`, and `currentStay`, which is where duplicate overnight attribution must be removed.
- Removed the `previousStay` budget-entry contribution in `TripDayView.tsx` and left the previous-night accommodation card/timeline rendering path intact.
- Validation run complete on 2026-03-11: `npm test` passed (`84` files, `453` tests); `npm run lint` passed with pre-existing repository warnings only.

### Completion Notes List

- Added Story 6.4 to Epic 6 in `epics.md` with acceptance criteria focused on removing duplicate previous-night accommodation cost from the day-view cost area.
- Created the ready-for-dev implementation context file for `6-4-fix-day-view-accommodation-cost-duplication` with guardrails aimed at a narrow day-view-only fix.
- Scoped the story to preserve overnight accommodation context, hotel-time rendering, and non-day-view budget behavior unless regression evidence proves a shared bug.
- Identified the main implementation seam in `TripDayView.tsx` and the primary regression test location in `tripDayViewLayout.test.tsx`.
- Updated `travelplan/src/components/features/trips/TripDayView.tsx` so the day summary itemization includes only current-night accommodation and priced day-plan items for the selected day.
- Added a regression test in `travelplan/test/tripDayViewLayout.test.tsx` covering a selected day with previous-night stay, current-night stay, and a priced plan item; the summary now excludes the previous-night row and totals `205.00` from current-night plus plan-item costs only.
- Preserved the previous-night accommodation card and hotel-time context display, and relied on the existing zero-cost regression coverage in `tripDayViewLayout.test.tsx` to confirm empty-cost behavior remains intact.

### File List

- _bmad-output/implementation-artifacts/6-4-fix-day-view-accommodation-cost-duplication.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- _bmad-output/planning-artifacts/epics.md
- travelplan/src/components/features/trips/TripDayView.tsx
- travelplan/test/tripDayViewLayout.test.tsx

## Change Log

- 2026-03-11: Added Story 6.4 "Fix Day View Accommodation Cost Duplication", created the ready-for-dev context story, and registered the story in sprint tracking.
- 2026-03-11: Removed previous-night accommodation from the day-view budget summary, added overnight-attribution regression coverage, and validated with full test suite plus lint.
