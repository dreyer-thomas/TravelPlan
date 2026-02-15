# Story 2.15: Day Page Prev/Next Navigation

Status: done

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

- [x] Day context shaping (AC: 1,2,3,4)
  - [x] Ensure day page has previous/next day references from ordered trip days.
  - [x] Expose neighbor day IDs needed for route navigation.
- [x] UI controls (AC: 1,2,3,4)
  - [x] Add `Previous`/`Next` controls to day page header.
  - [x] Apply disabled/hidden states at trip boundaries.
  - [x] Keep controls responsive on mobile and desktop.
- [x] Routing and state (AC: 1,2,5)
  - [x] Navigate with App Router to sibling day route without leaving trip context.
  - [x] Ensure destination day data refreshes correctly.
- [x] i18n updates (AC: 1,2,3,4)
  - [x] Add EN/DE labels and accessible text for prev/next controls.
- [x] Tests (AC: 1,2,3,4,5)
  - [x] UI tests for middle-day navigation in both directions.
  - [x] UI tests for first/last day boundary behavior.
  - [x] Route-level or component tests confirming correct target day rendered.

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

- Status set to **done**.
- Completion note: Prev/Next day navigation implemented with chronological neighbor resolution, boundary disabled states, localized labels/aria text (EN/DE), and expanded component tests.

## Dev Agent Record

### Debug Log

- 2026-02-15: Added failing tests for middle-day navigation, boundary disable states, and destination day rendering refresh.
- 2026-02-15: Implemented chronological day ordering (`dayIndex` then date fallback then id), computed previous/next neighbors, and rendered responsive header controls.
- 2026-02-15: Added EN/DE i18n keys for prev/next labels and accessible navigation text.
- 2026-02-15: Applied code-review auto-fixes: centralized day ordering comparator, added German navigation/ARIA test coverage, and ignored runtime upload artifacts from git status noise.

### Completion Notes

- Implemented AC 1-5 in `TripDayView` with sibling-day route links and disabled boundary controls.
- Preserved existing day-view deep-link behavior and action controls (stay/day-plan/image flows unchanged).
- Refactored duplicated day ordering logic into one shared comparator path to prevent drift.
- Added explicit DE test assertions for Prev/Next labels and ARIA text.
- Automated validation run:
  - `npm test -- tripDayViewLayout.test.tsx` (pass)
  - `npm test` (pass, 49 files / 194 tests)
  - `npm run lint` (pass with pre-existing warnings only; no errors)

## File List

- travelplan/src/components/features/trips/TripDayView.tsx
- travelplan/.gitignore
- travelplan/src/i18n/en.ts
- travelplan/src/i18n/de.ts
- travelplan/test/tripDayViewLayout.test.tsx
- _bmad-output/implementation-artifacts/sprint-status.yaml
- _bmad-output/implementation-artifacts/2-15-day-page-prev-next-navigation.md

## Change Log

- 2026-02-15: Added day-page prev/next navigation, boundary handling, localized nav copy, and regression tests for route-target rendering.
- 2026-02-15: Code review follow-up applied (ordering dedup, DE coverage, upload artifact git-noise mitigation) and status promoted to done.

## Senior Developer Review (AI)

- Outcome: **Approve**
- Fixed issues:
  - Consolidated duplicated day-order comparator logic in `TripDayView`.
  - Added German (`de`) automated coverage for previous/next labels and ARIA navigation text.
  - Removed stale dictionary key and ignored runtime uploads to avoid story/git discrepancy noise.
- Validation:
  - `npm test -- tripDayViewLayout.test.tsx` passed (8/8)
  - `npm test` passed (49 files / 194 tests)
  - `npm run lint` passed with existing warnings only
