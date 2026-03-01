# Story 2.24: Travel Segment Time Tags

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner,
I want travel segments to show a time range based on the prior item’s end time and the segment duration,
so that I can see when travel would happen and plan the day flow more precisely.

## Acceptance Criteria

1. **Given** I am viewing a trip day in day view  
   **When** a travel segment exists between two adjacent items  
   **Then** the segment shows a time tag in the format `HH:mm - HH:mm` derived from the previous item’s end time plus duration
2. **Given** the previous item is a day plan item  
   **When** it has a `toTime` value  
   **Then** the travel segment start time uses that `toTime`
3. **Given** the previous item is a previous-night accommodation  
   **When** it has a checkout time set  
   **Then** the travel segment start time uses that checkout time  
   **And** if no checkout time is set, it uses the default checkout time used elsewhere in day view
4. **Given** the previous item has no end time available  
   **When** the travel segment renders  
   **Then** no time tag is shown for that segment (label and actions still render)
5. **Given** a travel segment duration pushes the end time past midnight  
   **When** the time tag is calculated  
   **Then** the end time is capped at `24:00`
6. **Given** I edit or create a travel segment  
   **When** I return to day view  
   **Then** the time tag reflects the latest duration and previous item end time without a full refresh

## Tasks / Subtasks

- [ ] UI: compute and render time tag for travel segments (AC: 1-6)
- [ ] Use previous item end time: day plan item `toTime` or previous-night accommodation checkout (AC: 2-3)
- [ ] Handle missing end time by hiding the tag (AC: 4)
- [ ] Cap computed end time at `24:00` (AC: 5)
- [ ] Ensure tag updates after segment save without full refresh (AC: 6)

## Dev Notes

- Build on the existing day view travel segment UI; the time tag should align with the existing time chips used for day plan items and accommodations.
- Use existing time conventions: `HH:mm` display and default accommodation times already defined in day view.
- Travel segment duration is already stored as minutes; compute end time from start + duration at render time.
- No data model or API changes are required.
- Keep the travel segment row compact and unframed.

## Technical Requirements

- Compute time tag using previous item end time (`toTime` for day plan item, checkout for previous-night accommodation).
- Format time tag as `HH:mm - HH:mm`.
- Cap the computed end time at `24:00`.
- Do not show a time tag if the start time is missing or invalid.
- No persistence or schema changes; UI-only change.

## Architecture Compliance

- Use existing component boundaries and patterns.
- Keep changes localized to `travelplan/src/components/features/trips/TripDayView.tsx`.
- Preserve existing API response shapes and repository behavior.

## Library & Framework Requirements

- Continue using Material UI for the chip/time tag.
- No new dependencies; reuse existing formatting utilities or local helpers.

## File Structure Requirements

- Touch only the day view feature module unless a local helper must be added.
- Do not alter API or schema for this story.

## Testing Requirements

- Update or add UI test coverage for travel segment time tag rendering (e.g., `tripDayViewLayout.test.tsx`).
- Validate that the tag hides when the previous item has no end time.
- Validate the capped `24:00` behavior for long durations.

## Previous Story Intelligence

- Story 2.23 introduced travel segments and their day view placement; keep the segment row compact and reuse existing label/layout patterns.
- Story 2.21 established time tags with `HH:mm - HH:mm` formatting for day plan items; align the travel segment time tag with that format.
- Story 2.22 set default accommodation check-in/out times; reuse the default checkout time when previous-night checkout is unset.

## Git Intelligence Summary

- Recent commits focus on travel segments and accommodation time handling; this change should be a localized UI update in the day view.
- Avoid touching API/repo layers to prevent regressions in travel segment persistence.

## Project Context Reference

- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/epics.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/architecture.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/prd.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/ux-design-specification.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/2-23-day-view-travel-segments-between-items.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/2-21-day-plan-item-from-to-time-and-card-tag.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/2-22-accommodation-check-in-and-check-out-times.md`

## Story Completion Status

- Status set to **ready-for-dev**.
- Completion note: Travel segment time tags defined with render-time calculation and UI-only scope.

## Dev Agent Record

### Agent Model Used

Codex (GPT-5)

### Debug Log References

 - Built story context for travel segment time tags based on prior travel segment, time tag, and accommodation time stories.
 - Identified UI-only scope and primary touch point in `TripDayView`.

### Completion Notes List

 - Story defines time tag calculation from previous item end time and travel duration.
 - UI-only change; no schema/API updates required.
 - Test updates called out for time tag rendering and edge cases.

### File List

 - `_bmad-output/implementation-artifacts/2-24-travel-segment-time-tags.md`
 - `_bmad-output/implementation-artifacts/2-23-day-view-travel-segments-between-items.md`
 - `_bmad-output/implementation-artifacts/2-21-day-plan-item-from-to-time-and-card-tag.md`
 - `_bmad-output/implementation-artifacts/2-22-accommodation-check-in-and-check-out-times.md`
 - `_bmad-output/planning-artifacts/epics.md`
 - `_bmad-output/planning-artifacts/architecture.md`
 - `_bmad-output/planning-artifacts/prd.md`
 - `_bmad-output/planning-artifacts/ux-design-specification.md`
