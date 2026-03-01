# Story 2.30: Day Plan Gannt Overview

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner,
I want a compact gantt-style day coverage bar shown for each day in the trip overview timeline,
so that I can compare how planned each day is without opening individual day views.

## Acceptance Criteria

1. **Given** I am on the trip overview timeline
   **When** a day card renders
   **Then** a compact gantt bar appears next to the day date/title area, using about 50% of the remaining horizontal space on desktop.
2. **Given** the gantt bar is shown in the overview
   **When** it renders
   **Then** it uses the same planned-segment rules as the day view gantt bar (accommodation check-in/out, plan item from/to, travel segment duration).
3. **Given** the screen is narrow (mobile/tablet)
   **When** the day card renders
   **Then** the gantt bar stacks below the date/title area or expands to full width without clipping.
4. **Given** a day has no planned segments
   **When** the gantt bar renders
   **Then** it displays an empty/unplanned baseline with an accessible text summary (no color-only meaning).
5. **Given** I edit accommodations, plan items, or travel segments for a day
   **When** I return to the trip overview (or the overview refreshes)
   **Then** the gantt bar reflects the latest saved data.
6. **Given** planned segments overlap
   **When** the overview gantt bar renders
   **Then** overlapping segments are merged into a single continuous planned block (no internal gaps).

## Tasks / Subtasks

- [x] Add a compact/overview mode for the gantt bar (or a wrapper component) that supports constrained width (AC: 1, 3)
- [x] Reuse existing segment calculation utilities from the day view gantt implementation (AC: 2, 6)
- [x] Render the gantt bar inside each trip timeline day card near the date/title area (AC: 1)
- [x] Ensure empty-day and accessibility summary behavior in the overview variant (AC: 4)
- [x] Update trip timeline day type usage to include time fields/travel segments for gantt computation (AC: 2)
- [x] Add/extend UI tests for trip overview day cards to assert gantt bar rendering and responsive layout (AC: 1, 3, 4, 6)

## Dev Notes

- Trip overview timeline list lives in `travelplan/src/components/features/trips/TripTimeline.tsx` and already receives day-level data from `/api/trips/[id]`.
- The API response already includes accommodation check-in/out times, day plan item from/to times, and travel segments; the TripTimeline type just needs to consume them.
- The day view gantt implementation and segment utilities are in:
  - `travelplan/src/components/features/trips/TripDayGanttBar.tsx`
  - `travelplan/src/components/features/trips/TripDayGanttSegments.ts`
- Prefer reusing existing gantt computation and rendering logic; avoid introducing any charting libraries.
- Keep overview layout calm and compact to preserve “overview-first” UX and avoid visual overload.

### Project Structure Notes

- Trip timeline component: `travelplan/src/components/features/trips/TripTimeline.tsx`
- Gantt utilities/components: `travelplan/src/components/features/trips/TripDayGanttBar.tsx`, `travelplan/src/components/features/trips/TripDayGanttSegments.ts`
- i18n strings if new labels are added: `travelplan/src/i18n/en.ts`, `travelplan/src/i18n/de.ts`
- Tests live under `travelplan/test/` (existing pattern from story 2.29)

### References

- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/2-29-day-plan-gannt.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/ux-design-specification.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/architecture.md`

## Developer Context

- The overview gantt bar should be visually smaller than the day view header bar; this is a per-day summary, not a primary focus.
- The layout target is “about half of the remaining space” next to the date/title area on desktop; use a flex container so it naturally shares space without hard pixel widths.
- Reuse the segment builder and merge logic from the day view gantt to guarantee consistent coverage rules across views.
- The overview should not introduce new API routes or DB changes; use existing trip detail payloads.

## Technical Requirements

- Accept a “compact/overview” rendering mode with reduced height and minimal labels.
- Segment sources (same as day view):
  - Previous-night accommodation: 00:00 → checkout
  - Current-night accommodation: check-in → 24:00
  - Day plan items: from → to
  - Travel segments: previous item end → end + duration
- Merge overlaps into continuous planned spans before rendering.
- Provide an accessible text summary of planned vs. unplanned time (even in compact mode).
- The overview variant must not assume full-width; it should adapt to parent container width without overflow.

## Architecture Compliance

- UI changes only; no API or DB changes required.
- Keep components under `components/features/trips/`.
- Follow MUI patterns and existing typography/spacing tokens.

## Library & Framework Requirements

- Continue using React + MUI.
- Do not add a new charting library; the gantt is a lightweight custom component.

## File Structure Requirements

- Expected edits:
  - `travelplan/src/components/features/trips/TripTimeline.tsx`
  - `travelplan/src/components/features/trips/TripDayGanttBar.tsx` (add compact mode) or a new `TripDayGanttOverviewBar.tsx`
  - `travelplan/src/components/features/trips/TripDayGanttSegments.ts`
  - `travelplan/src/i18n/en.ts`
  - `travelplan/src/i18n/de.ts`
  - `travelplan/test/*` (new/updated trip overview layout tests)

## Testing Requirements

- UI test: gantt bar renders in each day card in trip overview timeline.
- UI test: compact layout does not overflow and stacks correctly on small widths.
- Unit test (if needed): overview mode uses same segment merge logic as day view.
- Manual QA: verify day overview gantt updates after editing day view and returning to overview.

## Previous Story Intelligence

- Story 2.29 added the full day view gantt bar and segment utilities. Reuse those utilities to avoid logic drift.
- Story 2.29 also added i18n strings and tests in `travelplan/test/` for gantt rendering; follow the same test patterns.

## Git Intelligence Summary

- Recent commit `d569b39` introduced `TripDayGanttBar.tsx`, `TripDayGanttSegments.ts`, and related tests in `travelplan/test/`.
- `TripDayView.tsx` was updated to render the gantt bar in the day header; use similar patterns for the overview day cards.

## Project Context Reference

- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/epics.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/architecture.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/ux-design-specification.md`

## Story Completion Status

- Status set to **done**.
- Completion note: Overview gantt review fixes applied with coverage defaults, responsive stacking, and tests passing.

## Dev Agent Record

### Agent Model Used

Codex (GPT-5)

### Debug Log References

- Parsed user request: add gantt chart to trip overview day cards.
- Analyzed existing day view gantt implementation and trip timeline layout.
- Reused architectural and UX constraints for overview-first layout.

### Implementation Plan

- Extend `TripDayGanttBar` with a compact variant for constrained overview layouts.
- Build an overview gantt segment helper that reuses day view segment utilities.
- Render a compact gantt + summary in `TripTimeline` with merged spans for overlap.
- Add overview gantt UI and helper tests plus responsive assertions.

### Completion Notes List

- Added compact gantt variant and overview segment builder with merged coverage spans.
- Rendered overview gantt bars + planned/unplanned summaries in `TripTimeline` with responsive layout.
- Added overview gantt unit/UI tests and full regression run.
- Adjusted trip timeline header layout to ensure the day edit button remains visible on empty days.
- Added default overview check-in fallback to ensure accommodation coverage is consistent with day view rules.
- Switched trip timeline header to stack on small screens and removed hidden chips that consumed width.
- Extended gantt overview and timeline tests with layout assertions and updated missing-chip expectations.
- Tests: `npm test -- tripDayGanttOverviewData.test.ts`, `npm test -- tripTimelinePlan.test.tsx`.

### File List

- `_bmad-output/implementation-artifacts/2-30-day-plan-gannt-overview.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `travelplan/src/components/features/trips/TripDayGanttBar.tsx`
- `travelplan/src/components/features/trips/TripDayGanttOverviewData.ts`
- `travelplan/src/components/features/trips/TripTimeline.tsx`
- `travelplan/test/tripDayGanttBar.test.tsx`
- `travelplan/test/tripDayGanttOverviewData.test.ts`
- `travelplan/test/tripTimelinePlan.test.tsx`

## Change Log

- 2026-03-01: Added compact trip overview gantt rendering, merged-span coverage, and tests.
- 2026-03-01: Adjusted overview header layout to keep day edit button visible.
- 2026-03-01: Added overview gantt coverage defaults and responsive stacking updates with test adjustments.
