# Story 2.23: Day View Travel Segments Between Items

Status: done

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

- [x] Data model and migration (AC: 1-5)  
- [x] Add travel segment entity with `fromItemId`, `toItemId`, `transportType`, `durationMinutes`, `distanceKm?`, `link?`.  
- [x] Define how to store references for accommodation/day items uniformly.  
- [x] Validation and API updates (AC: 2-5)  
- [x] Add Zod schema for travel segment create/update with required duration and conditional distance for `car`.  
- [x] Add API routes for travel segment CRUD in day context.  
- [x] Repository updates (AC: 2-5)  
- [x] Persist/read travel segments and include them in day view payloads.  
- [x] UI updates (AC: 1-5)  
- [x] Render compact, unframed travel segment regions between adjacent items.  
- [x] Add dialog to edit transport type, duration, distance (car only), and link.  
- [x] Default dialog values to `car` and `30 min`.  
- [x] Add Google Maps directions link based on adjacent item locations.  
- [x] Tests (AC: 1-5)  
- [x] Schema tests for duration required and distance conditional.  
- [x] Repo/API tests for segment roundtrip.  
- [x] UI tests for rendering and dialog validation.  

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

- Status set to **review**.  
- Completion note: Travel segments implemented with persistence, validation, UI editing, and automated coverage.  

## Dev Agent Record

### Agent Model Used

Codex (GPT-5)

### Debug Log References

- Added TravelSegment Prisma model, enums, and migration.  
- Implemented validation, repository, API routes, and day-view payload updates.  
- Built day-view travel segment UI + dialog with Google Maps link helper and defaults.  
- Added schema, API, and UI tests for travel segments.  
- Restored travel segment link entry and default map link handling, plus adjacency validation and API error handling.  

### Completion Notes List

- Implemented travel segment persistence with item-type references and trip-day scoping.  
- Added CRUD API and Zod validation with conditional distance rules.  
- Inserted compact travel segment regions between timeline items and added edit dialog defaults and maps link helper.  
- Ensured segment entry point renders between previous-night accommodation and first day item.  
- Restored travel segment link field with Google Maps default and validation.  
- Tests: `npm test`.  

### Change Log

- 2026-03-01: Implemented travel segments across data model, API/repo, UI dialog, i18n, and tests.  
- 2026-03-01: Re-added link entry + adjacency validation + API conflict handling for travel segments.  

### File List

- `_bmad-output/implementation-artifacts/sprint-status.yaml`  
- `_bmad-output/implementation-artifacts/2-23-day-view-travel-segments-between-items.md`  
- `travelplan/prisma/schema.prisma`  
- `travelplan/prisma/migrations/20260301105118_add_travel_segments/migration.sql`  
- `travelplan/src/app/api/trips/[id]/route.ts`  
- `travelplan/src/app/api/trips/[id]/travel-segments/route.ts`  
- `travelplan/src/components/features/trips/TripDayTravelSegmentDialog.tsx`  
- `travelplan/src/components/features/trips/TripDayView.tsx`  
- `travelplan/src/generated/prisma/browser.ts`  
- `travelplan/src/generated/prisma/client.ts`  
- `travelplan/src/generated/prisma/commonInputTypes.ts`  
- `travelplan/src/generated/prisma/enums.ts`  
- `travelplan/src/generated/prisma/internal/class.ts`  
- `travelplan/src/generated/prisma/internal/prismaNamespace.ts`  
- `travelplan/src/generated/prisma/internal/prismaNamespaceBrowser.ts`  
- `travelplan/src/generated/prisma/models.ts`  
- `travelplan/src/generated/prisma/models/TripDay.ts`  
- `travelplan/src/generated/prisma/models/TravelSegment.ts`  
- `travelplan/src/i18n/de.ts`  
- `travelplan/src/i18n/en.ts`  
- `travelplan/src/lib/repositories/travelSegmentRepo.ts`  
- `travelplan/src/lib/repositories/tripRepo.ts`  
- `travelplan/src/lib/validation/travelSegmentSchemas.ts`  
- `travelplan/test/travelSegmentDialog.test.tsx`  
- `travelplan/test/travelSegmentRoute.test.ts`  
- `travelplan/test/travelSegmentSchema.test.ts`  
- `travelplan/test/travelSegmentSchemas.test.ts`  
- `travelplan/test/tripDayViewLayout.test.tsx`  
