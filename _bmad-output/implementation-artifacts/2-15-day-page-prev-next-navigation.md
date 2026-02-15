# Story 2.15: Day Page Prev/Next Navigation

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner,
I want Previous and Next buttons on the day page,
so that I can move through days quickly without going back to the overview.

## Acceptance Criteria

1. **Given** I am on a day page
   **When** I click `Next`
   **Then** I navigate to the next chronological day in the same trip
2. **Given** I am on a day page
   **When** I click `Previous`
   **Then** I navigate to the previous chronological day in the same trip
3. **Given** I am on the first day
   **When** the page renders
   **Then** `Previous` is disabled or hidden
4. **Given** I am on the last day
   **When** the page renders
   **Then** `Next` is disabled or hidden
5. **Given** I navigate with Prev/Next
   **When** the destination day loads
   **Then** day detail content (timeline, budget, map, actions) is shown for that target day

## Story Requirements

- Navigation order follows existing day chronology (`dayIndex` then date fallback).
- Navigation stays scoped to the current trip.
- Keep current day page route pattern and deep-link support.
- Preserve current action behavior on day view (accommodation/day plan controls).
- No backend schema changes required for this story.

## Tasks / Subtasks

- [ ] Day context shaping (AC: 1,2,3,4)
  - [ ] Ensure day page has previous/next day references from ordered trip days.
  - [ ] Expose neighbor day IDs needed for route navigation.
- [ ] UI controls (AC: 1,2,3,4)
  - [ ] Add `Previous`/`Next` controls to day page header.
  - [ ] Apply disabled/hidden states at trip boundaries.
  - [ ] Keep controls responsive on mobile and desktop.
- [ ] Routing and state (AC: 1,2,5)
  - [ ] Navigate with App Router to sibling day route without leaving trip context.
  - [ ] Ensure destination day data refreshes correctly.
- [ ] i18n updates (AC: 1,2,3,4)
  - [ ] Add EN/DE labels and accessible text for prev/next controls.
- [ ] Tests (AC: 1,2,3,4,5)
  - [ ] UI tests for middle-day navigation in both directions.
  - [ ] UI tests for first/last day boundary behavior.
  - [ ] Route-level or component tests confirming correct target day rendered.

## Dev Notes

- Prefer server-provided neighbor IDs over client-side recomputation to avoid ordering drift.
- Keep keyboard accessibility for navigation controls.
- If there are unsaved inline edits on day page, preserve existing save/discard behavior before routing.

## Technical Requirements

- Next.js App Router + existing day route structure.
- No Prisma migration expected.
- Keep existing data-fetch and ownership patterns.

## Architecture Compliance

- UI changes in `src/components/features/trips/*`.
- Route/page updates under `src/app/(routes)/trips/[id]/days/[dayId]/`.
- i18n updates in EN/DE dictionaries only.

## File Structure Requirements

- Update day page route component under `travelplan/src/app/(routes)/trips/[id]/days/[dayId]/`
- Update `travelplan/src/components/features/trips/TripDayView.tsx` (or adjacent day header component)
- Update i18n files: `travelplan/src/i18n/en.ts`, `travelplan/src/i18n/de.ts`
- Add/extend UI tests in `travelplan/test/*`

## Testing Requirements

- Manual:
  - Navigate middle day with Previous and Next.
  - Confirm first day blocks Previous and last day blocks Next.
  - Confirm day-specific timeline/budget/map updates each navigation.
- Automated:
  - Navigation interaction tests.
  - Boundary-state tests.
  - Correct route target rendering tests.

## Story Completion Status

- Status set to **ready-for-dev**.
- Completion note: Story context drafted from stakeholder request and aligned to day-view architecture.

