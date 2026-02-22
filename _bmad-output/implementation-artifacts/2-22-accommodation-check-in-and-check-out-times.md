# Story 2.22: Accommodation Check-in and Check-out Times

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner,
I want to set check-in and check-out times for accommodations in day view,
so that I can model when I am at the hotel around the day plan.

## Acceptance Criteria

1. **Given** I am viewing a trip day in day view  
   **When** I edit the previous-night accommodation entry  
   **Then** I can set a checkout time for that accommodation  
   **And** the time is saved with that accommodation
2. **Given** I am viewing a trip day in day view  
   **When** I edit the current-night accommodation entry  
   **Then** I can set a check-in time for that accommodation  
   **And** the time is saved with that accommodation
3. **Given** an accommodation is created without a time  
   **When** I view the accommodation time fields  
   **Then** checkout defaults to `10:00` for the previous-night accommodation  
   **And** check-in defaults to `16:00` for the current-night accommodation
4. **Given** check-in and check-out times are set for a day  
   **When** I view the day view timeline context  
   **Then** the time from midnight to checkout is considered hotel time for the previous night  
   **And** the time from check-in to midnight is considered hotel time for the current night
5. **Given** I edit accommodation times to any values  
   **When** I save  
   **Then** the system stores the times without enforcing ordering validation

## Story Requirements

- Add `checkInTime` and `checkOutTime` fields to accommodations scoped to day view only.  
- Defaults: `10:00` checkout (previous night), `16:00` check-in (current night).  
- Persist times per accommodation record and roundtrip through repository and API.  
- Day view should treat `00:00 -> checkOutTime` as hotel time for previous night and `checkInTime -> 24:00` as hotel time for current night.  
- No ordering validation between checkout and check-in.  
- Preserve existing accommodation status, cost, link, and image behaviors.  
- Keep backwards compatibility for existing accommodations that have no times.

## Tasks / Subtasks

- [x] Data model and migration (AC: 1-5)  
- [x] Add nullable `check_in_time` and `check_out_time` columns to accommodations in Prisma schema + migration.  
- [x] Decide storage shape (recommended: canonical `HH:mm` strings, matching day plan time handling).  
- [x] Define defaults at UI/form layer (and ensure server uses defaults when missing if needed).  
- [x] Validation and API updates (AC: 1-5)  
- [x] Extend accommodation Zod schema to accept optional time strings in `HH:mm` format.  
- [x] Include `checkInTime` and `checkOutTime` in accommodation create/update/list payloads.  
- [x] Repository updates (AC: 1-5)  
- [x] Persist/read new time fields in `accommodationRepo` and any trip/day aggregation payloads.  
- [x] UI updates (AC: 1-5)  
- [x] Add checkout time input for previous-night accommodation in `TripDayView` dialog flow.  
- [x] Add check-in time input for current-night accommodation in `TripDayView` dialog flow.  
- [x] Display stored times in the day view accommodation cards/sections as appropriate.  
- [x] Ensure defaults appear when times are missing.  
- [x] Tests (AC: 1-5)  
- [x] Schema/repo tests for time roundtrip and default behavior.  
- [x] UI tests for time inputs and persisted values.  
- [x] Regression coverage for legacy accommodations without times.

## Dev Notes

- Day view already separates previous-night and current-night accommodations; use that split to decide which time field is shown/edited in each section.  
- Align time format and input behavior with Story 2.21 (`HH:mm` strings) to keep consistency and reduce new parsing logic.  
- This story is day-view-only; do not add new fields to other views unless already shared by the day view components.  
- No ordering validation is required even if checkout is later than check-in.  

## Technical Requirements

- Time values are stored and displayed in canonical 24-hour `HH:mm`.  
- Times are optional in storage; UI should surface defaults when missing.  
- No new third-party dependency is required; reuse existing MUI time inputs and validation patterns.  

## Architecture Compliance

- Expected touch points:  
- `travelplan/prisma/schema.prisma`  
- `travelplan/prisma/migrations/*`  
- `travelplan/src/lib/validation/accommodationSchemas.ts`  
- `travelplan/src/lib/repositories/accommodationRepo.ts`  
- `travelplan/src/app/_actions/accommodations.ts`  
- `travelplan/src/components/features/trips/TripAccommodationDialog.tsx`  
- `travelplan/src/components/features/trips/TripDayView.tsx`  
- `travelplan/src/i18n/en.ts`  
- `travelplan/src/i18n/de.ts`  

## Library & Framework Requirements

- Reuse Material UI form controls and error presentation style.  
- Keep validation in Zod and persistence in repository layer.  
- Keep i18n-driven labels and helper messages.  

## File Structure Requirements

- Extend existing accommodation modules only.  
- Keep tests under existing `travelplan/test/` structure.  

## Testing Requirements

- Manual:  
- Add/update accommodations for previous and current nights and verify default times populate.  
- Save times and verify they persist after reload.  
- Ensure no validation errors when checkout is later than check-in.  
- Verify legacy accommodations without times still render and are editable.  
- Automated:  
- Schema tests for optional time fields and `HH:mm` parsing.  
- Repo/API tests for time roundtrip and defaults.  
- UI tests for dialog inputs and day view display.

## Previous Story Intelligence

- Story 2.21 established the `HH:mm` time handling pattern and validation structure for day plan items; mirror this format and UI conventions.  
- Day view layout already separates previous-night and current-night accommodation sections; use that split to determine which time field applies.  

## Git Intelligence Summary

- Recent work centers on map/seed trip changes; accommodation changes should stay localized to schema/repo/UI for day view.  

## Latest Technical Information

- No external package changes required for time input or display.  

## Project Context Reference

- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/epics.md`  
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/architecture.md`  
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/prd.md`  
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/ux-design-specification.md`  
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/2-21-day-plan-item-from-to-time-and-card-tag.md`  

## Story Completion Status

- Status set to **review**.  
- Completion note: Implemented check-in/out times for day-view accommodations with defaults, timeline ranges, and full roundtrip persistence.

## Dev Agent Record

### Agent Model Used

Codex (GPT-5)

### Debug Log References

- Added Story 2.22 to epics and sprint status.  
- Created story file with requirements, tasks, and architecture guardrails.  
- Implemented accommodation time fields across schema, API, repo, UI, and tests.  
- Ran full test suite and regenerated Prisma client.

### Completion Notes List

- Added optional `checkInTime`/`checkOutTime` columns and migrations with Prisma client regeneration.  
- Extended accommodation validation, repository, trip detail/export, and import flows to roundtrip `HH:mm` times.  
- Updated day view and accommodation dialog to edit previous/current stay times with defaults and timeline ranges.  
- Added/updated tests covering schema validation, repo/API roundtrip, UI defaults, and timeline display.  
- Adjusted stay time persistence to avoid overwriting missing values, preserved times on partial updates, and normalized import time parsing.  
- Added API tests for time ordering tolerance and patch omission preservation.  
- Tests: `npm test -- tripAccommodationRoute.test.ts`.

### File List

- `travelplan/prisma/schema.prisma`  
- `travelplan/prisma/migrations/20260222153000_add_accommodation_time_fields/migration.sql`  
- `travelplan/src/generated/prisma`  
- `travelplan/src/lib/validation/accommodationSchemas.ts`  
- `travelplan/src/lib/validation/tripImportSchemas.ts`  
- `travelplan/src/lib/repositories/accommodationRepo.ts`  
- `travelplan/src/lib/repositories/tripRepo.ts`  
- `travelplan/src/app/api/trips/[id]/route.ts`  
- `travelplan/src/app/api/trips/[id]/accommodations/route.ts`  
- `travelplan/src/app/layout.tsx`  
- `travelplan/src/components/features/trips/TripAccommodationDialog.tsx`  
- `travelplan/src/components/features/trips/TripDayView.tsx`  
- `travelplan/src/components/features/trips/TripDayPlanDialog.tsx`  
- `travelplan/src/components/features/trips/TripTimeline.tsx`  
- `travelplan/src/i18n/en.ts`  
- `travelplan/src/i18n/de.ts`  
- `travelplan/test/accommodationRepo.test.ts`  
- `travelplan/test/tripAccommodationRoute.test.ts`  
- `travelplan/test/tripAccommodationDialog.test.tsx`  
- `travelplan/test/tripDayViewLayout.test.tsx`  
- `travelplan/test/tripRepo.test.ts`  
- `travelplan/test/tripImportSchemas.test.ts`  
- `_bmad-output/implementation-artifacts/sprint-status.yaml`  
- `_bmad-output/implementation-artifacts/2-22-accommodation-check-in-and-check-out-times.md`  

### Change Log

- 2026-02-22: Added accommodation check-in/out times with UI defaults, timeline ranges, and full persistence plus tests.
- 2026-02-22: Review fixes for time persistence, import normalization, and API test coverage.
