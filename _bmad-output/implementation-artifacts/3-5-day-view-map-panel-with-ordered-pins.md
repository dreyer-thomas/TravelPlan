# Story 3.5: Day View Map Panel With Ordered Pins

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner,
I want a day-view map that displays all places in chronological order,
so that I can understand the day route at a glance.

## Acceptance Criteria

1. **Given** a day has a previous-night accommodation, activities, and a current-night accommodation
   **When** I open the day view map panel
   **Then** I see pins for each place in chronological order
   **And** the pins are connected in that order
2. **Given** a day is missing a location for any place
   **When** the map renders
   **Then** the missing place is excluded and flagged as missing location
3. **Given** the day has only start/end locations
   **When** I view the map
   **Then** I see a simple two-point line with ordered markers

## Story Requirements

- This is a day view map panel (not the full routing service story).
- Use Leaflet map patterns already planned for trip/day maps.
- Connection is a simple polyline between ordered points (no OSRM routing yet).
- Map should fit bounds to all included points.

## Tasks / Subtasks

- [x] Add day map panel component for ordered pins and polyline.
- [x] Build ordered point list: previous night accommodation -> day plan items -> current night accommodation.
- [x] Exclude items without location and surface a missing-location flag or label.
- [x] Fit map viewport to included points.
- [x] Add loading/empty states (no locations available).
- [x] Add i18n labels for map panel and missing-location warnings.
- [x] Add UI smoke test for ordered pin rendering (if UI tests exist).

## Dev Notes

- Avoid OSRM dependency for this story; use a straight-line polyline between points.
- Reuse map container setup from other map stories once implemented.
- Keep map panel dimensions responsive (right column in day view).

## Developer Context

- Day view layout is introduced in Story 2.12.
- This panel sits in the day view right column below the budget summary.
- Location data will come from accommodations and day plan items once those models store locations.

## Technical Requirements

- **UI**
  - New component under `src/components/features/trips/` (e.g., `TripDayMapPanel.tsx`).
  - Accepts ordered points and renders markers + polyline.
  - Shows a compact legend or list of excluded items.

## Architecture Compliance

- UI components under `src/components/features/trips/`.
- No API changes required in this story.

## Library & Framework Requirements

- Leaflet for map rendering.
- Material UI for panels and empty state styling.

## File Structure Requirements

- Add `travelplan/src/components/features/trips/TripDayMapPanel.tsx` (or similar).
- Update i18n: `travelplan/src/i18n/en.ts`, `travelplan/src/i18n/de.ts`.

## Testing Requirements

- UI smoke test: ordered pins + polyline render for a mocked day.
- Visual check: missing-location items are excluded and flagged.

## Project Context Reference

- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/epics.md#Story 3.5: Day View Map Panel With Ordered Pins`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/ux-design-specification.md#Route Map`

## Story Completion Status

- Status set to **done**.
- Completion note: Day view map panel now consumes location fields from day data when present, renders ordered markers/polyline, and keeps missing-location handling.

## Dev Agent Record

### Agent Model Used

Codex (GPT-5)

### Debug Log References

N/A

### Implementation Plan

- Build map panel component with ordered points, polyline, bounds fit, and empty/loading states.
- Integrate map panel into day view right column with placeholder data wiring.
- Add i18n strings and UI smoke test coverage.
- Stabilize TripDayPlanDialog test mocks to keep the full test suite passing.

### Completion Notes List

- Implemented `TripDayMapPanel` with ordered markers, polyline, bounds fitting, empty state, and missing-location list.
- Integrated the map panel into the day view layout.
- Added map panel i18n labels in English and German.
- Added UI smoke test for ordered pin rendering.
- Stabilized TripDayPlanDialog test mocks to avoid hangs in the full suite.
- Fixed day-view map integration to use real location fields from API payloads when available instead of hardcoded `null` values.
- Strengthened `TripDayView` layout test to validate marker/polyline rendering from location-enabled payloads.
- Cleaned `TripDayPlanDialog` MUI mocks to remove invalid DOM prop warnings during test execution.
- Tests: `npm test -- tripDayMapPanel.test.tsx tripDayViewLayout.test.tsx tripDayPlanDialog.test.tsx`.

### File List

- `travelplan/package.json`
- `travelplan/package-lock.json`
- `travelplan/src/components/features/trips/TripDayMapPanel.tsx`
- `travelplan/src/components/features/trips/TripDayView.tsx`
- `travelplan/src/i18n/en.ts`
- `travelplan/src/i18n/de.ts`
- `travelplan/test/tripDayMapPanel.test.tsx`
- `travelplan/test/tripDayViewLayout.test.tsx`
- `travelplan/test/tripDayPlanDialog.test.tsx`

## Senior Developer Review (AI)

### Reviewer

Tommy (AI-assisted review)

### Date

2026-02-14

### Outcome

Approved after fixes.

### Findings Addressed

- Resolved map integration gap by wiring day map input to optional `location` fields from stays and day plan items.
- Resolved test realism issue by sanitizing mocked MUI props to avoid React invalid DOM attribute warnings.
- Verified map marker/polyline behavior with location-enabled payload in day view layout test.

### Notes

- Workspace contains unrelated in-progress changes outside this story; review and fixes were constrained to Story 3.5 files listed above.

## Change Log

- 2026-02-14: Senior review fixes applied (map location wiring, test coverage improvement, mock cleanup); story moved to `done`.
