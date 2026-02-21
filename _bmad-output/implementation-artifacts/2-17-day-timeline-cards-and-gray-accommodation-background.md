# Story 2.17: Day Timeline Cards and Gray Accommodation Background

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner,
I want each day entry shown as its own card with accommodation visually separated,
so that the day timeline is easier to scan and understand.

## Acceptance Criteria

1. **Given** I am viewing a trip timeline
   **When** days are rendered
   **Then** each day entry is displayed as its own white card container
2. **Given** a day entry contains accommodation information
   **When** accommodation is shown
   **Then** the accommodation section background is light gray `#F2F2F2`
3. **Given** accommodation is shown in day cards
   **When** I scan the timeline
   **Then** no label or badge is added for highlighting and color-only distinction is used
4. **Given** I use desktop or mobile layout
   **When** day cards and accommodation sections render
   **Then** spacing, contrast, and layout remain consistent and readable
5. **Given** a day has no accommodation
   **When** the day card renders
   **Then** missing-accommodation behavior remains unchanged (chips/indicators still work)

## Story Requirements

- Card background must be white (`#FFFFFF`) for each day entry.
- Accommodation subsection background must be `#F2F2F2`.
- Keep existing day actions, chips, links, and navigation behavior.
- Keep timeline data ordering and business logic unchanged (visual-only enhancement).
- Preserve existing i18n behavior (no new text copy required for this story).

## Tasks / Subtasks

- [x] Refactor timeline day list rendering into per-day card containers (AC: 1, 4)
  - [x] Replace single list-row styling with isolated card layout per day
  - [x] Ensure mobile stacking and desktop spacing are preserved
- [x] Add accommodation subsection surface styling (AC: 2, 3)
  - [x] Wrap accommodation display area in a background container using `#F2F2F2`
  - [x] Keep chip/link behavior unchanged and accessible
- [x] Preserve existing conditional states (AC: 5)
  - [x] Verify missing accommodation and missing plan indicators still render
  - [x] Verify days without accommodation do not render empty gray blocks
- [x] Add/update UI tests for timeline visual structure (AC: 1-5)
  - [x] Assert each day renders as a distinct card
  - [x] Assert accommodation subsection uses gray background when present
  - [x] Assert no new labels/badges are introduced for this styling change

## Dev Notes

- Primary implementation target is `travelplan/src/components/features/trips/TripTimeline.tsx`.
- Prefer extracting a small presentational subcomponent for a day card if it reduces JSX nesting and test complexity.
- Use theme-friendly styling patterns already used in the codebase (`sx`, `Paper`, `Box`) and avoid hard-to-maintain inline duplication.

## Technical Requirements

- Keep existing stack and package versions unchanged.
- Maintain Next.js App Router + MUI component approach.
- Do not introduce API, database, or repository changes for this story.

## Architecture Compliance

- UI-only change in feature component layer: `src/components/features/trips/*`.
- No route handler, repository, or schema updates.
- Maintain existing design language and component conventions from Epic 2 day/timeline stories.

## Library & Framework Requirements

- Material UI surfaces/layout primitives (`Paper`, `Box`, `List`, `ListItem`) should remain the styling foundation.
- Keep existing i18n and interaction wiring in place.

## File Structure Requirements

- Update `travelplan/src/components/features/trips/TripTimeline.tsx`.
- Update/add tests in `travelplan/test/tripTimelinePlan.test.tsx` (or closest timeline-focused UI test file).

## Testing Requirements

- Manual:
  - Open a trip timeline with multiple days and verify each day is a separate white card.
  - Verify accommodation area appears with `#F2F2F2` background when present.
  - Verify no additional labels/badges were added for this styling change.
  - Verify mobile and desktop views remain readable.
- Automated:
  - UI tests for day-card container rendering per day.
  - UI tests for gray accommodation section rendering only when accommodation exists.
  - Regression checks for existing missing-accommodation/missing-plan indicators.

## Previous Story Intelligence

- Story 2.12 introduced the overview/day-view split and emphasized overview scanability.
- Story 2.16 touched day presentation density with image strips and should be considered for visual spacing consistency.

## Git Intelligence Summary

- Recent implementation work has been iterative UI bug-fix commits; keep this change isolated to timeline rendering to reduce regression risk.
- Existing timeline day rendering currently uses `ListItem` rows in a single list; introducing per-day card wrappers is the lowest-risk path for this visual change.

## Latest Technical Information

- No external library/API updates required. This story is a local UI composition and styling adjustment.

## Project Context Reference

- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/epics.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/architecture.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/ux-design-specification.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/2-12-day-view-detail-layout-with-overview-toggle.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/2-16-accommodation-and-plan-item-image-galleries.md`

## Story Completion Status

- Status set to **review**.
- Completion note: Timeline day entries now render as separate cards with conditional gray accommodation surfaces; automated tests updated and passing.

## Dev Agent Record

### Agent Model Used

Codex (GPT-5)

### Debug Log References

- `npm test -- tripTimelinePlan.test.tsx` (RED then GREEN verification)
- `npm test` (full suite)
- `npx eslint src/components/features/trips/TripTimeline.tsx test/tripTimelinePlan.test.tsx`
- `npm run lint` (repo has pre-existing unrelated lint errors)
- `npm test -- tripTimelinePlan.test.tsx` (post-review fixes)
- `npm test` (post-review full suite: 217 passed)

### Completion Notes List

- Refactored timeline day rendering into per-day white card containers in `TripTimeline`.
- Added conditional accommodation surface wrapper with background `#F2F2F2` and preserved existing chip/link behavior.
- Preserved missing-accommodation and missing-plan warning chip behavior without rendering empty gray sections.
- Added UI regression test to assert day-card count, accommodation surface conditional rendering, and no new accommodation label/badge text.
- Fixed accommodation rendering guard to use accommodation data as source-of-truth even if `missingAccommodation` flag is stale.
- Added viewport-change regression coverage to ensure timeline card readability and interaction affordances remain stable across mobile/desktop widths.
- Confirmed unrelated pre-existing workspace changes exist outside this story scope; Story 2.17 file list remains scoped to story-owned artifacts.
- Verified tests:
  - `npm test -- tripTimelinePlan.test.tsx` passes (5 tests)
  - `npm test` full suite passes (217 tests)

### File List

- `_bmad-output/implementation-artifacts/2-17-day-timeline-cards-and-gray-accommodation-background.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `travelplan/src/components/features/trips/TripTimeline.tsx`
- `travelplan/test/tripTimelinePlan.test.tsx`

## Change Log

- 2026-02-21: Implemented Story 2.17 timeline card visual update and tests; moved story to `review`.
- 2026-02-21: Code review fixes applied (accommodation guard + responsive regression coverage); moved story to `done`.
