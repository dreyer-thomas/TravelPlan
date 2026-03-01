# Story 2.29: Day Plan Gannt

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner,
I want a gantt-style day overview bar in the day view header that visualizes planned time blocks,
so that I can instantly see which parts of the day are planned and which are still open.

## Acceptance Criteria

1. **Given** I am in the day view
   **When** I look at the overview/header area
   **Then** I see a horizontal 24-hour gantt bar for the current day.
2. **Given** the day has a previous-night accommodation with a checkout time
   **When** the gantt bar renders
   **Then** the time from 00:00 to checkout is shown as a planned segment.
3. **Given** the day has a current-night accommodation with a check-in time
   **When** the gantt bar renders
   **Then** the time from check-in to 24:00 is shown as a planned segment.
4. **Given** the day has plan items with from/to times
   **When** the gantt bar renders
   **Then** each plan item is shown as a planned segment at its time range.
5. **Given** the day has travel segments with a duration between adjacent items
   **When** the gantt bar renders
   **Then** each travel segment is shown as a planned segment starting at the previous item’s end time and lasting for its duration.
6. **Given** a planned segment overlaps another segment
   **When** the gantt bar renders
   **Then** the segments are merged into a single continuous planned block (no visual gaps inside overlap).
7. **Given** a day has time with no planned accommodation, travel segment, or plan item coverage
   **When** the gantt bar renders
   **Then** those unplanned periods are shown as blank/white.
8. **Given** the gantt bar is displayed
   **When** I view it with assistive technologies
   **Then** it includes a textual summary of planned vs. unplanned hours and does not rely on color alone.
9. **Given** I add/edit/delete accommodations, plan items, or travel segments in day view
   **When** I save changes
   **Then** the gantt bar updates immediately to reflect the new planned coverage.
10. **Given** the day is fully planned (24 hours covered)
    **When** the gantt bar renders
    **Then** a clear “fully planned” indicator is shown near the bar.

## Tasks / Subtasks

- [x] Add a day header gantt component in day view overview/header area (AC: 1)
- [x] Compute planned segments from previous stay (00:00 to checkout) and current stay (check-in to 24:00) (AC: 2, 3)
- [x] Compute planned segments from day plan items using from/to times (AC: 4)
- [x] Compute planned segments for travel segments using previous item end + duration (AC: 5)
- [x] Merge overlapping segments and derive unplanned gaps (AC: 6, 7)
- [x] Add textual planned/unplanned summary and fully planned indicator (AC: 8, 10)
- [x] Wire updates to day edits so the bar re-renders on save (AC: 9)
- [x] Add EN/DE strings for gantt labels and summary (AC: 8, 10)
- [x] Add UI tests for segment calculation and rendering (AC: 1-7, 9, 10)

## Dev Notes

- Day view data already includes:
  - Previous-night and current-night accommodation with check-in/out times (Story 2.22)
  - Day plan items with from/to times (Story 2.21)
  - Travel segments between adjacent items with duration (Story 2.23)
- The gantt bar should be visually calm and compact, aligned with the overview/header area to preserve the “overview-first” UX.
- Use the existing day view data model; no API changes are required.

### Project Structure Notes

- Day view container: `travelplan/src/components/features/trips/TripDayView.tsx`
- Day timeline and travel segments live in the same component; use those data structures to build planned segments.
- i18n strings: `travelplan/src/i18n/en.ts`, `travelplan/src/i18n/de.ts`
- If a new component is needed, place it under `travelplan/src/components/features/trips/` and keep naming consistent (PascalCase).

### References

- `_bmad-output/planning-artifacts/ux-design-specification.md` (overview-first, set vs. open, status clarity)
- `_bmad-output/planning-artifacts/architecture.md` (component boundaries, MUI usage)
- `_bmad-output/implementation-artifacts/2-21-day-plan-item-from-to-time-and-card-tag.md`
- `_bmad-output/implementation-artifacts/2-22-accommodation-check-in-and-check-out-times.md`
- `_bmad-output/implementation-artifacts/2-23-day-view-travel-segments-between-items.md`

## Developer Context

- The gantt bar belongs in the day view overview/header area (not in the timeline list) so users can assess completeness at a glance.
- Planned coverage comes from three sources only: accommodation times, travel segment durations, and plan item time ranges.
- If a travel segment is missing a duration or the adjacent item is missing a time, that segment should not render and should count as unplanned time.

## Technical Requirements

- Build a single list of planned segments in minutes-from-midnight (0-1440), then merge overlaps.
- Accommodation segments:
  - Previous stay: 00:00 to checkout time (if checkout exists)
  - Current stay: check-in time to 24:00 (if check-in exists)
- Plan item segments: from time to to time.
- Travel segment segments: previous item end time to end time + duration (only if both exist).
- Render the gantt bar with a fixed 24-hour baseline and planned segments overlay; unplanned time remains blank/white.
- Provide an accessible summary string, e.g., “Planned 14h 30m, Unplanned 9h 30m.”

## Architecture Compliance

- Keep changes within UI components under `components/features/trips` and the day view route.
- No new API routes or DB changes.
- Follow MUI patterns and existing spacing/typography system.

## Library & Framework Requirements

- Continue using React + MUI as the UI foundation.
- Do not introduce new charting libraries; the gantt bar should be a lightweight custom component.

## File Structure Requirements

- Expected edits:
  - `travelplan/src/components/features/trips/TripDayView.tsx`
  - (New) `travelplan/src/components/features/trips/TripDayGanttBar.tsx`
  - `travelplan/src/i18n/en.ts`
  - `travelplan/src/i18n/de.ts`
  - `travelplan/test/*` (new UI tests for day gantt bar)

## Testing Requirements

- Unit test for segment builder: merge overlaps, gaps, and travel duration handling.
- UI test that gantt bar renders 24-hour baseline and planned segments.
- UI test that fully planned indicator shows when coverage reaches 24 hours.
- Manual QA: verify updates after editing accommodation times, plan item times, and travel segments.

## Previous Story Intelligence

- Story 2.28 touched `TripDayView` and map-related UI; avoid regressions in the day view header layout when adding the gantt bar.

## Latest Tech Information

- MUI X does not currently provide a Gantt chart component; implement a lightweight custom gantt bar to avoid unnecessary dependencies.

## Project Context Reference

- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/epics.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/architecture.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/ux-design-specification.md`

## Story Completion Status

- Status set to **done**.
- Completion note: Review fixes applied (merged gantt spans, i18n aria label, updated tests).

## Change Log

- 2026-03-01: Implemented day header gantt bar, segment calculation utilities, summary/indicator text, and UI tests.
- 2026-03-01: Merged gantt spans for AC6 compliance, fixed gantt ordering, added i18n aria label, updated tests.

## Dev Agent Record

### Agent Model Used

Codex (GPT-5)

### Debug Log References

- Created story context from user request and existing day view data model.
- Added TripDayGanttBar component and header render; updated layout test.
- Tests: `npm test`.
- Added stay segment builder and unit tests for stay coverage.
- Tests: `npm test -- tripDayGanttSegments`, `npm test`.
- Added plan item segment builder and unit tests for day plan item time ranges.
- Tests: `npm test -- tripDayGanttSegments`, `npm test`.
- Added travel segment planned coverage calculation and unit tests for travel segments.
- Tests: `npm test -- tripDayGanttSegments`, `npm test`.
- Added segment merge + coverage summary utilities (planned minutes and gaps).
- Tests: `npm test -- tripDayGanttSegments`, `npm test`.
- Added gantt summary text + fully planned indicator with new i18n strings and layout tests.
- Tests: `npm test -- tripDayViewLayout`, `npm test`.
- Added UI test to confirm gantt summary updates after saving a travel segment (state update flow).
- Tests: `npm test -- tripDayViewLayout`, `npm test`.
- Added gantt segment render test for merged segments and segment DOM marker.
- Tests: `npm test -- tripDayViewLayout`, `npm test`.
- Added previous-night checkout fallback for gantt coverage and reran tests.
- Tests: `npm test -- tripDayViewLayout`, `npm test`.
- Added per-source gantt colors with data-kind markers and updated tests.
- Tests: `npm test -- tripDayGanttSegments`, `npm test -- tripDayViewLayout`, `npm test`.
- Fixed gantt travel segments to use previous-night checkout fallback in travel coverage.
- Tests: `npm test -- tripDayViewLayout`, `npm test`.
- Merged gantt spans for rendering, fixed gantt ordering, localized aria label, updated gantt layout test.
- Tests: `npm test -- tripDayViewLayout`.

### Completion Notes List

- Generated story context with acceptance criteria, technical requirements, and test plan.
- Added a day header gantt bar component and rendered it in the day view header.
- Added a layout test asserting the gantt bar renders in the header.
- Added stay-only planned segment calculation and wired it into the gantt bar.
- Added unit tests for stay segment calculations.
- Added plan item planned segment calculation and included it in gantt segments.
- Added unit tests for plan item segments.
- Added travel segment planned coverage calculation (uses previous item end time plus duration).
- Added unit tests for travel segment calculations.
- Added merge logic for overlapping/contiguous segments and coverage summary (planned minutes + gaps).
- Added unit tests for merge and gap derivation.
- Added planned/unplanned summary and fully planned indicator in day view header.
- Added EN/DE strings for gantt summary and duration formatting.
- Added layout tests covering summary text and fully planned indicator.
- Added layout test ensuring gantt summary updates after travel segment save.
- Added layout test for merged gantt segments and segment DOM markers.
- Story complete; full test suite run.
- Added previous-night checkout fallback in gantt coverage.
- Added colored gantt segments by source (stay/plan/travel) and data-kind markers for tests.
- Fixed travel segment coverage to respect previous-night checkout fallback.
- Updated gantt bar to render merged spans, fixed ordering, and localized aria label.
- Updated gantt layout test to assert merged spans.

### File List

- `_bmad-output/implementation-artifacts/2-29-day-plan-gannt.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `travelplan/src/components/features/trips/TripDayGanttBar.tsx`
- `travelplan/src/components/features/trips/TripDayGanttSegments.ts`
- `travelplan/src/components/features/trips/TripDayView.tsx`
- `travelplan/src/i18n/en.ts`
- `travelplan/src/i18n/de.ts`
- `travelplan/test/tripDayViewLayout.test.tsx`
- `travelplan/test/tripDayGanttSegments.test.ts`
