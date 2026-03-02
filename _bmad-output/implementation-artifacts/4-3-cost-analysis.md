# Story 4.3: Cost Overview From Trip Total

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner,
I want to open a full-page cost overview from the trip total in the trip overview header,
so that I can review all day costs, their line items, and the trip sum in one place.

## Acceptance Criteria

1. Given I am viewing a trip overview, when I click the total planned cost in the header summary, then I am navigated to a full-page cost overview for that trip.
2. Given I am on the cost overview page, then I see a table listing every trip day with its date (or day label) in column 1, all cost positions for that day (each showing name + cost) in column 2, and the day sum in column 3.
3. Given a day has accommodation cost, then it appears as a cost position labeled with the accommodation name (e.g., "Previous night: {name}" or "Current night: {name}" depending on the day’s context).
4. Given a day has day plan items with costs, then each appears as a cost position labeled with the day plan item title (fallback label if title missing) and its cost.
5. Given a cost value is missing for a position, then the position is shown with a “no cost captured” label/value (consistent with day view budget list behavior).
6. Given the table is rendered, then a trip total sum is displayed below the table and matches the existing planned total shown in the trip overview header.
7. Given I view the cost overview on mobile, then the layout remains readable (table can stack or scroll horizontally) without loss of data.

## Tasks / Subtasks

- [x] Task 1: Add a new full-page route for the trip cost overview (e.g., `/trips/[id]/costs`).
  - [x] Subtask 1.1: Reuse the trip detail API (`/api/trips/[id]`) to fetch days, accommodations, and day plan items with costs.
  - [x] Subtask 1.2: Add a back navigation control consistent with map full-page view patterns.
- [x] Task 2: Build cost overview table UI (MUI) that renders days, cost positions (name + cost), and day sum.
  - [x] Subtask 2.1: Align cost labels and fallback text with existing day view budget labels and i18n.
  - [x] Subtask 2.2: Show missing costs with the same “no cost captured” label as day view.
  - [x] Subtask 2.3: Show trip total below the table using the same formatter as planned total in `TripTimeline`.
- [x] Task 3: Add navigation affordance from the trip overview header planned total to the cost overview page.
  - [x] Subtask 3.1: Make the planned total in `TripTimeline` a link/button with accessible label and focus state.
- [x] Task 4: Add i18n strings (EN/DE) for cost overview title, column headers, empty/missing states, and summary labels.
- [x] Task 5: Add tests for route rendering, navigation, and cost table rendering (including missing costs).

## Dev Notes

### Developer Context

Trip overview currently shows a planned total in `TripTimeline.tsx` (header summary). The trip detail API already returns per-day `plannedCostSubtotal`, accommodations (with `costCents`), and day plan items (with `costCents`). Day view budget list uses labels like “Previous night: {name}”, “Current night: {name}”, and fallback “Activity {index}”. Align cost overview labels and missing-cost text with these existing patterns for consistency.

### Technical Requirements

- Add a new route under `src/app/(routes)/trips/[id]/costs/page.tsx` (or equivalent) for the full-page cost overview.
- Use the existing API envelope and `TripTimeline` data format from `/api/trips/[id]`.
- Reuse formatting utilities from `TripTimeline` or `TripDayView` for currency and date labels where possible.
- Keep API and data access unchanged unless a missing field prevents the overview (avoid new endpoints unless necessary).
- Render all trip days in chronological order using `dayIndex`/date order from the API response.
- Preserve existing naming conventions: DB snake_case, API camelCase, UI labels via i18n.

### Architecture Compliance

- Follow API envelope `{ data, error }` and `apiError` patterns.
- Keep UI components in `components/features/trips/` if you create a reusable cost overview component.
- Routes must live under `src/app/(routes)` and be server component pages with client child component if needed.
- Do not introduce new state management for this view; local state + fetch is sufficient.

### Library / Framework Requirements

- MUI components for layout (Table or Stack + Box for mobile-friendly table).
- Use existing i18n provider `useI18n` and `formatMessage` helpers.
- Keep formatting consistent with `TripTimeline` (`formatCost`) and `TripDayView` budget label helpers.

### File Structure Requirements

- Route page: `travelplan/src/app/(routes)/trips/[id]/costs/page.tsx`
- UI component (if extracted): `travelplan/src/components/features/trips/TripCostOverview.tsx`
- Navigation trigger: `travelplan/src/components/features/trips/TripTimeline.tsx`
- i18n strings: `travelplan/src/i18n/en.ts`, `travelplan/src/i18n/de.ts`
- Tests: `travelplan/test/*` (match existing patterns for TripTimeline and page routes)

### Testing Requirements

- UI test: planned total is clickable and routes to cost overview.
- UI test: cost overview table lists days with correct labels and sums.
- UI test: missing cost shows “no cost captured” text.
- Snapshot/DOM test: trip total is displayed below the table and matches API total.

### Previous Story Intelligence

Story 4.2 added bucket list integration in day view and updated TripTimeline with icon-only edit actions and i18n. Follow the same MUI styling patterns and i18n structure used there.

### Git Intelligence Summary

Recent work touched `TripTimeline.tsx`, `TripDayView.tsx`, and i18n strings for trip planning features. Reuse patterns for formatting, date labels, and header summary layout.

### Latest Tech Information

- Material UI: ^7.3.8 (already in repo).
- Next.js: 16.1.6 (already in repo).
- Zod: ^4.1.11.
- Prisma: ^7.3.0.

### Project Context Reference

No `project-context.md` found in the repository.

### Project Structure Notes

- Trip overview page: `travelplan/src/app/(routes)/trips/[id]/page.tsx` uses `TripTimeline`.
- Trip detail API: `travelplan/src/app/api/trips/[id]/route.ts`.
- Trip timeline UI (planned total display): `travelplan/src/components/features/trips/TripTimeline.tsx`.
- Day view budget labels: `travelplan/src/components/features/trips/TripDayView.tsx` and i18n keys under `trips.dayView.*`.

### References

- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/epics.md` (Epic 4 context; new story addition)
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/prd.md` (Budget awareness FRs)
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/architecture.md` (stack + patterns)
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/ux-design-specification.md` (overview-first UX, navigation rail)
- `/Users/tommy/Development/TravelPlan/travelplan/src/components/features/trips/TripTimeline.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/src/app/api/trips/[id]/route.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/lib/repositories/tripRepo.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/components/features/trips/TripDayView.tsx`

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

### Implementation Plan

- Reuse `/api/trips/[id]` to build the cost overview route and data model.
- Render a responsive MUI table with day labels, cost positions, and day totals aligned to day view labels.
- Link the trip planned total to the cost overview page with accessible navigation.
- Add i18n strings and tests for routing and table rendering.

### Completion Notes List

- ✅ Added cost overview route and table UI with day/position totals and missing-cost labels.
- ✅ Linked TripTimeline planned total to the new cost overview page.
- ✅ Added EN/DE i18n strings and tests for routing, navigation, and cost table rendering.
- ✅ Review fixes: trip total label now avoids duplicate “Cost:” prefix; added responsive table wrapper test assertion.
- ✅ Tests: `npm test`

### File List

- travelplan/src/app/(routes)/trips/[id]/costs/page.tsx
- travelplan/src/components/features/trips/TripCostOverview.tsx
- travelplan/src/components/features/trips/TripDayView.tsx
- travelplan/src/components/features/trips/TripTimeline.tsx
- travelplan/src/i18n/de.ts
- travelplan/src/i18n/en.ts
- travelplan/test/tripCostOverview.test.tsx
- travelplan/test/tripCostOverviewPage.test.tsx
- travelplan/test/tripTimelinePlan.test.tsx

### Change Log

- 2026-03-02: Added trip cost overview page/table, navigation from planned total, i18n, and tests.
- 2026-03-02: Review fixes: trip total label cleanup + responsive table wrapper assertion; full test run.

## Senior Developer Review (AI)

- Findings addressed: Trip total label now uses the raw formatted amount to avoid “Trip total: Cost: …” duplication.
- Findings addressed: Cost overview table wrapper is explicitly scrollable on narrow viewports and covered by a test assertion.
- Tests run: `npm test`
