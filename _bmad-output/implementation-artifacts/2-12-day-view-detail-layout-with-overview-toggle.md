# Story 2.12: Day View Detail Layout With Overview Toggle

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner,
I want a dedicated day view for detailed planning,
so that I can keep the overview compact while focusing on one day at a time.

## Acceptance Criteria

1. **Given** I am viewing the trip overview
   **When** I select a day or choose the day view action
   **Then** I see a day view for that specific date
   **And** the overview remains the primary navigation surface
2. **Given** I am in day view
   **When** I review the layout
   **Then** the left-side timeline lists the day in chronological order
   **And** it starts with the previous night accommodation, includes day activities, and ends with the current night accommodation
3. **Given** I am in day view
   **When** I review the right-side panel
   **Then** I see the day budget total with itemized entries
   **And** the day map panel below (pins + chronological connection)
4. **Given** I am in the trip overview
   **When** I look for per-day actions
   **Then** I see only a day selection entry point (no per-day action buttons)

## Story Requirements

- Overview stays compact and scannable for 2-3 weeks; day view holds details.
- Day view is reachable from overview via day selection and/or a day view button.
- All existing actions for accommodations and day plan items move to day view.
- Timeline order: previous night accommodation, activities (day plan items), current night accommodation.
- Right panel: budget summary (total + itemized entries), map panel below.
- No changes to API/repo; this is a UI and layout change.

## Tasks / Subtasks

- [x] Add a day view layout in the trip detail route (side panel, modal, or split view).
- [x] Implement day selection from overview to open the day view.
- [x] Move per-day actions (accommodation + plan items) into day view timeline.
- [x] Remove per-day action buttons from overview timeline.
- [x] Add day budget summary panel with itemized entries.
- [x] Integrate the day map panel (Story 3.5) into the right column.
- [x] Add empty states for days with no accommodations or plan items.
- [x] Update i18n labels for new day view UI.
- [x] Add UI tests for day view open/close and action relocation (if UI tests exist).

## Dev Notes

- Preserve existing overview rendering for quick scan; avoid expanding detail in overview.
- Keep navigation consistent with existing trip detail page and routing patterns.
- Consider keeping overview visible while day view is open (split layout) to reduce context loss.

## Developer Context

- Trip overview is rendered in `TripTimeline` on `/trips/[id]`.
- Accommodation and day plan items dialogs already exist; relocate triggers to day view.
- Budget totals exist as a story (2.8); day view should show day total and itemized lines once data is available.

## Technical Requirements

- **UI**
  - Introduce a day view container within `TripTimeline` or a new component.
  - Keep overview list stable; day view should not reorder days.
  - Budget panel reads from existing totals and day item costs (accommodations + plan items if present).
- **Navigation**
  - Selecting a day sets active day context for the day view.
  - Provide a clear close/back action to return to overview-only mode.

## Architecture Compliance

- UI changes live in `src/components/features/trips/*`.
- No new API routes required for this story.
- Keep naming conventions and i18n patterns consistent.

## Library & Framework Requirements

- Next.js App Router and Material UI.
- Use existing dialogs/components for accommodation and day plan items.

## File Structure Requirements

- Update `travelplan/src/components/features/trips/TripTimeline.tsx`.
- Add `travelplan/src/components/features/trips/TripDayView.tsx` (or similar) if needed.
- Update i18n: `travelplan/src/i18n/en.ts`, `travelplan/src/i18n/de.ts`.

## Testing Requirements

- UI smoke test: open day view from overview.
- UI smoke test: actions present in day view and removed from overview.
- Visual check: overview stays compact and day view layout matches requirements.

## Project Context Reference

- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/epics.md#Story 2.12: Day View Detail Layout With Overview Toggle`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/ux-design-specification.md#Day Plan Timeline`

## Story Completion Status

- Status set to **done**.
- Completion note: Day view detail layout, overview toggle/navigation, action relocation, budget/map right panel, i18n updates, and UI tests are implemented and passing.

## Dev Agent Record

### Agent Model Used

Codex (GPT-5)

### Debug Log References

N/A

### Completion Notes List

- Implemented day selection entry points from `TripTimeline` to `/trips/[id]/days/[dayId]` while keeping overview compact.
- Reworked `TripDayView` into a full two-column detail layout with chronological timeline (previous night stay, activities, current night stay).
- Relocated per-day stay/plan actions into day view and wired them to existing `TripAccommodationDialog` and `TripDayPlanDialog`.
- Added day budget summary with itemized lines and computed day total from captured costs, plus empty states for no timeline/budget data.
- Integrated `TripDayMapPanel` below budget summary using chronological timeline items as map input.
- Expanded EN/DE i18n dictionaries for day-view navigation, timeline, and budget copy.
- Updated UI tests for overview action relocation and day-view detail layout.
- Verified full suite passes: `npm test` (40 files, 123 tests).

### File List

- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/2-12-day-view-detail-layout-with-overview-toggle.md`
- `/Users/tommy/Development/TravelPlan/travelplan/src/components/features/trips/TripTimeline.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/src/components/features/trips/TripDayView.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/src/i18n/en.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/i18n/de.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/test/tripTimelinePlan.test.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/test/tripDayViewLayout.test.tsx`
