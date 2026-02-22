# Story 2.23: Day View Travel Segments Between Items

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner,
I want to add travel segments between each pair of adjacent day items,
so that I can plan the time needed to move between locations.

## Acceptance Criteria

1. **Given** I am viewing a trip day in day view  
   **When** I look between adjacent timeline items (previous-night accommodation, day items, current-night accommodation)  
   **Then** I see a compact travel segment region between each pair
2. **Given** I open a travel segment between two adjacent items  
   **When** I save a transport type and duration  
   **Then** the travel segment is stored and shown in the day view
3. **Given** I choose transport type `car`  
   **When** I save the travel segment  
   **Then** I can enter a distance in kilometers and it is stored
4. **Given** I choose a transport type that is not `car`  
   **When** I save the travel segment  
   **Then** distance is not required
5. **Given** adjacent items have locations  
   **When** I open the travel segment  
   **Then** I can trigger a Google Maps directions link using those locations

## Story Requirements

- Add travel segments between each adjacent pair of timeline items in day view only.  
- The segment region is visually small and unframed to avoid dominating the timeline.  
- Transport types: `flight`, `ship`, `car`.  
- Duration is always required.  
- Distance (km) is required only for `car`.  
- Default values: `car` and `30 min`.  
- Travel segment should be tied to the two adjacent items, not the day as a whole.  
- Provide a Google Maps directions link using adjacent item locations; allow manual entry via the dialog.  
- Preserve existing day view layout, items, and accommodation behavior.  

## Tasks / Subtasks

- [ ] Data model and migration (AC: 1-5)  
- [ ] Add travel segment entity with `fromItemId`, `toItemId`, `transportType`, `durationMinutes`, `distanceKm?`, `link?`.  
- [ ] Define how to store references for accommodation/day items uniformly.  
- [ ] Validation and API updates (AC: 2-5)  
- [ ] Add Zod schema for travel segment create/update with required duration and conditional distance for `car`.  
- [ ] Add API routes for travel segment CRUD in day context.  
- [ ] Repository updates (AC: 2-5)  
- [ ] Persist/read travel segments and include them in day view payloads.  
- [ ] UI updates (AC: 1-5)  
- [ ] Render compact, unframed travel segment regions between adjacent items.  
- [ ] Add dialog to edit transport type, duration, distance (car only), and link.  
- [ ] Default dialog values to `car` and `30 min`.  
- [ ] Add Google Maps directions link based on adjacent item locations.  
- [ ] Tests (AC: 1-5)  
- [ ] Schema tests for duration required and distance conditional.  
- [ ] Repo/API tests for segment roundtrip.  
- [ ] UI tests for rendering and dialog validation.  

## Dev Notes

- Day view already orders previous-night accommodation -> day items -> current-night accommodation; use this order to place travel segments.  
- Keep the segment UI subtle (small height, no card frame) to avoid visual overload.  
- Duration should be stored as minutes; show a human-friendly display in the UI.  
- Travel segment should not be a full transport planning tool; it is manual entry only.  

## Technical Requirements

- Store duration as integer minutes; display as `HH:mm` or `Xh Ym` according to existing UI conventions.  
- Distance stored as numeric km for `car` only.  
- Link field should be a URL string; default to Google Maps directions.  
- No new third-party dependency required.  

## Architecture Compliance

- Expected touch points:  
- `travelplan/prisma/schema.prisma`  
- `travelplan/prisma/migrations/*`  
- `travelplan/src/lib/validation/*`  
- `travelplan/src/lib/repositories/*`  
- `travelplan/src/app/api/trips/[id]/*`  
- `travelplan/src/components/features/trips/TripDayView.tsx`  
- `travelplan/src/components/features/trips/*`  
- `travelplan/src/i18n/en.ts`  
- `travelplan/src/i18n/de.ts`  

## Library & Framework Requirements

- Reuse Material UI controls and validation patterns.  
- Keep validation in Zod and persistence in repository layer.  
- Keep i18n-driven labels and helper messages.  

## File Structure Requirements

- Extend existing day view and trip feature modules only.  
- Keep tests under existing `travelplan/test/` structure.  

## Testing Requirements

- Manual:  
- Create travel segment between items; verify it appears and persists.  
- Confirm duration required; distance required only for `car`.  
- Verify Google Maps link uses adjacent item locations.  
- Automated:  
- Schema tests for conditional distance.  
- API tests for create/update/list.  
- UI tests for rendering and dialog validation.  

## Previous Story Intelligence

- Story 2.21 established time handling and UI patterns for time inputs.  
- Story 2.22 adds accommodation times and day-view-specific inputs.  

## Git Intelligence Summary

- Recent work focuses on maps and seed-trip; keep this story localized to day view and data model changes.  

## Latest Technical Information

- No external package changes required.  

## Project Context Reference

- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/epics.md`  
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/architecture.md`  
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/prd.md`  
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/ux-design-specification.md`  
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/2-21-day-plan-item-from-to-time-and-card-tag.md`  
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/2-22-accommodation-check-in-and-check-out-times.md`  

## Story Completion Status

- Status set to **ready-for-dev**.  
- Completion note: Context story created for manual travel segments between adjacent day view items.  

## Dev Agent Record

### Agent Model Used

Codex (GPT-5)

### Debug Log References

- Added Story 2.23 to epics and sprint status.  
- Created story file with requirements, tasks, and architecture guardrails.  

### Completion Notes List

- Travel segments are manual, day-view-only, and tied to adjacent items with required duration and conditional distance.  

### File List

- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/epics.md`  
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/sprint-status.yaml`  
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/2-23-day-view-travel-segments-between-items.md`  
