# Story 4.6: Show Open Costs by Month

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner,
I want to switch the trip cost overview between the existing day list and a monthly payment list,
so that I can clearly see which open costs I need to pay in each month.

## Acceptance Criteria

1. Given I am on the trip cost overview page, when the page loads, then I can switch between a `Days` view and a `Months` view.
2. Given I remain in the `Days` view, when the page renders, then the existing day-based cost overview behavior remains available unchanged.
3. Given I switch to the `Months` view, when scheduled payments exist, then they are grouped by calendar month using each payment due date and the month groups are ordered chronologically.
4. Given I switch to the `Months` view, when an accommodation or day plan item has a cost but no split payment schedule, then it also appears in the month view using the entered date when known.
5. Given a month section is shown, when it contains open items, then each row displays a clear label, the relevant date, and the amount.
6. Given a month section contains open items, when it is rendered, then it shows the summed monthly total of all displayed items.
7. Given an accommodation or day plan item already has scheduled payment rows, when the `Months` view is rendered, then the base cost is not shown a second time.
8. Given there are no relevant open items for any month, when I open the `Months` view, then I see a clear empty state.
9. Given I switch between `Days` and `Months`, when the view changes, then no payment or cost data is modified and the trip planned total remains unchanged.

## Tasks / Subtasks

- [x] Task 1: Extend the cost overview UI with a view switcher.
  - [x] Add a segmented control, tabs, or equivalent toggle in `TripCostOverview.tsx` for `Days` and `Months`.
  - [x] Keep the existing day table rendering intact behind the `Days` mode.
  - [x] Add EN/DE i18n strings for the new mode labels, monthly headers, monthly total label, and monthly empty state.
- [x] Task 2: Build a monthly cost view model from trip detail data.
  - [x] Derive monthly groups from accommodation and day-plan-item payment data returned by the trip detail API.
  - [x] Ensure items with explicit `payments` use those rows as the source of truth for monthly entries.
  - [x] Ensure unscheduled costs appear once using an entered-date fallback when known.
  - [x] Sort months chronologically and sort entries inside each month by relevant date, then stable secondary key.
- [x] Task 3: Reconcile "open costs" behavior without changing persistence semantics.
  - [x] Treat the monthly view as a planning view over currently stored payable entries; do not introduce payment-completion persistence in this story.
  - [x] Do not show duplicate rows for the same base cost when scheduled payments already exist.
  - [x] Preserve all existing trip/day total calculations and cost overview route behavior.
- [x] Task 4: Adjust trip-detail normalization only if required for correct month placement.
  - [x] Review the fallback payment normalization in `tripRepo.ts` and use the item/accommodation entered date when known for non-scheduled costs.
  - [x] If the UI needs additional metadata to do this correctly, extend the trip detail payload in an additive, backward-compatible way.
  - [x] Keep API envelope and existing consumers stable.
- [x] Task 5: Add regression coverage for both modes.
  - [x] Update `tripCostOverview.test.tsx` to cover switching modes, month grouping, monthly totals, and empty state.
  - [x] Add coverage for scheduled payments and non-scheduled costs coexisting without duplicates.
  - [x] Update route/page tests only if labels or structure require it.

## Dev Notes

### Developer Context

Story 4.3 introduced the full-page trip cost overview at `/trips/[id]/costs`, and Story 4.5 added payment schedules to both accommodations and day plan items. The trip detail API already exposes `payments` arrays for both entity types and already synthesizes a single fallback payment when no explicit schedule exists. This story should extend the existing cost overview UX rather than invent a separate payment data flow.

### Technical Requirements

- Reuse the existing `/api/trips/[id]` payload as the primary data source for both views.
- Use payment rows as the canonical source for month grouping when they exist.
- For non-scheduled costs, use the entered date when known; if current payload normalization does not preserve that correctly, fix the normalization server-side or add additive metadata needed by the UI.
- Do not add payment completion tracking, paid flags, or new persistence models in this story.
- Do not change `plannedCostTotal`, `plannedCostSubtotal`, or existing cost aggregation math.
- Keep the monthly view read-only; switching modes must never mutate data.

### Architecture Compliance

- Keep the cost overview route at `src/app/(routes)/trips/[id]/costs/page.tsx`.
- Keep feature UI under `src/components/features/trips/`.
- Keep repository/API output additive and backward compatible if trip detail data needs to change.
- Preserve API envelope `{ data, error }` and existing camelCase payload naming.
- Continue to use UTC-safe date handling for grouping and display.

### Library / Framework Requirements

- Continue using Material UI layout primitives already used in `TripCostOverview.tsx`.
- Preserve the existing `useI18n()` and `formatMessage()` patterns.
- Follow the current React client-component approach in `TripCostOverview.tsx`; this story is a UI extension, not a routing rewrite.

### File Structure Requirements

- Route page: `travelplan/src/app/(routes)/trips/[id]/costs/page.tsx`
- Main UI: `travelplan/src/components/features/trips/TripCostOverview.tsx`
- Trip detail normalization: `travelplan/src/lib/repositories/tripRepo.ts`
- Route tests: `travelplan/test/tripCostOverviewPage.test.tsx`
- Component tests: `travelplan/test/tripCostOverview.test.tsx`
- i18n strings: `travelplan/src/i18n/en.ts`, `travelplan/src/i18n/de.ts`

### Testing Requirements

- Component test: user can switch between `Days` and `Months`.
- Component test: scheduled payments are grouped under the correct month and monthly totals are correct.
- Component test: unscheduled accommodation/day-item costs appear once in the correct month.
- Component test: an item with explicit payment rows is not duplicated as a base cost row.
- Component test: empty monthly view shows a dedicated empty state.
- Regression test: existing day-table rendering still works as before.

### Previous Story Intelligence

Story 4.5 intentionally kept `costCents` as the total cost while storing payment schedules alongside the cost-bearing entities. Story 4.3 already established the cost overview route and test harness. The safest implementation path is to extend that surface and reuse the existing trip detail payload instead of adding a new endpoint or parallel state.

### Git Intelligence Summary

Recent commits show the cost overview and payment schedule work landed immediately before this story. Expect the implementation to concentrate in `TripCostOverview.tsx`, `tripRepo.ts`, i18n files, and existing cost overview tests rather than spreading across unrelated trip screens.

### Latest Tech Information

No external web research was performed for this story. Current local project conventions and existing implementation files are sufficient for the required change.

### Project Context Reference

No `project-context.md` was found in the repository.

### Project Structure Notes

- `TripCostOverview.tsx` already fetches `/api/trips/${tripId}` and renders the day-based table.
- `tripRepo.ts` already includes `payments` on accommodations and day plan items and synthesizes fallback single-payment rows for unscheduled costs.
- The route page is a thin wrapper with a back button and should likely remain that way.

### References

- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/epics.md` (Epic 4 and Story 4.5/4.6 context)
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/architecture.md` (REST, MUI, i18n, repository/API conventions)
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/ux-design-specification.md` (mode switching, overview-first UX, responsive behavior)
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/4-3-cost-analysis.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/4-5-payment-schedule.md`
- `/Users/tommy/Development/TravelPlan/travelplan/src/app/(routes)/trips/[id]/costs/page.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/src/components/features/trips/TripCostOverview.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/src/lib/repositories/tripRepo.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/i18n/en.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/i18n/de.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/test/tripCostOverview.test.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/test/tripCostOverviewPage.test.tsx`

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `npm test -- tripCostOverview.test.tsx`
- `npm test`
- `npm run lint`
- `npx eslint src/components/features/trips/TripCostOverview.tsx src/i18n/en.ts src/i18n/de.ts test/tripCostOverview.test.tsx`

### Completion Notes List

- Created as a new net-new story requested after Story 4.5.
- Scoped as a cost-overview UI extension with minimal backend adjustment only if required for correct month assignment of unscheduled costs.
- Added a `Days` / `Months` tab switcher to `TripCostOverview.tsx` while preserving the existing day-table rendering and trip total behavior.
- Built a client-side monthly grouping model from trip detail payments, using scheduled payment rows as source of truth and falling back to the trip day date for unscheduled costs without duplicating base costs.
- Added EN/DE translations for the new mode labels, empty state, and month total copy.
- Expanded `tripCostOverview.test.tsx` to cover mode switching, chronological month grouping, monthly totals, duplicate prevention, empty month state, and day-view regression.
- Reviewed `tripRepo.ts` fallback needs and kept the API contract unchanged because the existing trip day date already provides the required month placement context for unscheduled costs.
- Full regression passed with `366` tests green; `npm run lint` reported pre-existing repository warnings only.
- Senior review fixes added explicit coverage for unscheduled accommodation month placement and verified `Days`/`Months` switching remains read-only without extra fetches.
- Story documentation was synchronized with git reality by including the epic definition update and recording the review outcome.

### File List

- _bmad-output/implementation-artifacts/4-6-show-open-costs.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- _bmad-output/planning-artifacts/epics.md
- travelplan/src/components/features/trips/TripCostOverview.tsx
- travelplan/src/i18n/en.ts
- travelplan/src/i18n/de.ts
- travelplan/test/tripCostOverview.test.tsx

## Change Log

- 2026-03-08: Added month-based open-cost overview mode, translations, and regression coverage; story is ready for review.
- 2026-03-08: Senior review fixes added missing regression coverage, synchronized the file list, and marked the story done.

## Senior Developer Review (AI)

- Reviewer: Tommy
- Date: 2026-03-08
- Outcome: Approve

### Summary

- Verified AC1-AC9 against the shipped implementation in `TripCostOverview.tsx` and the trip-detail fallback normalization in `tripRepo.ts`.
- Confirmed the implementation already satisfied the functional requirements, but the original review uncovered two regression-test gaps and one story file-list discrepancy.
- Added regression coverage for unscheduled accommodation fallback placement in the month view and for read-only mode switching back to the day view without additional fetches.

### Findings Resolved

- Added AC4 coverage for unscheduled accommodation costs appearing once in the correct month.
- Added AC9 coverage proving `Days`/`Months` switching preserves rendered day data and does not trigger extra network mutation/reload behavior.
- Updated the Dev Agent Record file list to include `_bmad-output/planning-artifacts/epics.md`, which was part of the actual git delta.

### Validation

- `cd /Users/tommy/Development/TravelPlan/travelplan && npm test -- tripCostOverview.test.tsx`
- `cd /Users/tommy/Development/TravelPlan/travelplan && npm test -- tripCostOverviewPage.test.tsx`
- `cd /Users/tommy/Development/TravelPlan/travelplan && npm run lint -- src/components/features/trips/TripCostOverview.tsx src/i18n/en.ts src/i18n/de.ts test/tripCostOverview.test.tsx`
- `cd /Users/tommy/Development/TravelPlan/travelplan && npm test`
