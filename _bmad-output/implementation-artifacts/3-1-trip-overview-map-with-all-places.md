# Story 3.1: Trip Overview Map With All Places

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner,
I want to see all trip places on a single overview map,
so that I can visualize the full journey at a glance.

## Acceptance Criteria

1. **Given** a trip has accommodations and day plan items with locations
   **When** I open the trip overview map
   **Then** all places are shown as markers on the map
2. **Given** a place is missing location data
   **When** the map renders
   **Then** the place is excluded and flagged for missing location

## Story Requirements

- Add location support for both:
  - accommodations
  - day plan items
- Location shape must be consistent across DB/API/UI (lat/lng numeric, optional label).
- Existing accommodation and day-plan CRUD behavior must remain intact.
- API contracts remain camelCase with `{ data, error }` envelope.
- DB naming remains snake_case.
- Day map behavior from Story 3.5 must remain compatible.

## Tasks / Subtasks

- [x] Data model and migrations (AC: 1,2)
  - [x] Add location fields for accommodation records.
  - [x] Add location fields for day plan item records.
  - [x] Add Prisma migration and regenerate client.
- [x] Validation and repository updates (AC: 1,2)
  - [x] Extend Zod schemas for location payload input/updates.
  - [x] Persist/retrieve location fields in accommodation/day-plan repositories.
  - [x] Preserve owner-boundary checks for all location writes/reads.
- [x] API exposure (AC: 1,2)
  - [x] Include location fields in accommodation/day-plan mutation endpoints.
  - [x] Return location fields in trip detail/day-plan list payloads used by map views.
  - [x] Preserve existing error mapping and response envelopes.
- [x] UI input and overview map wiring (AC: 1,2)
  - [x] Add location inputs to accommodation dialog.
  - [x] Add location inputs to day-plan-item dialog.
  - [x] Render trip overview map with all available places and missing-location list.
- [x] i18n and UX copy (AC: 1,2)
  - [x] Add EN/DE labels and helper/error text for location input and missing-location indicators.
- [x] Tests (AC: 1,2)
  - [x] Repository tests for location persistence and ownership boundaries.
  - [x] API route tests for location request/response shape.
  - [x] UI tests for location input and overview-map marker/missing behavior.

## Dev Notes

- Reuse existing map plumbing from Story 3.5 (`TripDayMapPanel` patterns) where possible; avoid duplicate map abstractions.
- Keep location optional to avoid blocking existing flows.
- For missing coordinates, show clear UI indicator instead of hard failures.
- Prefer incremental extension of existing dialogs/routes over creating parallel location endpoints.

### Project Structure Notes

- Likely touch points:
  - `travelplan/prisma/schema.prisma`
  - `travelplan/src/lib/validation/accommodationSchemas.ts`
  - `travelplan/src/lib/validation/dayPlanItemSchemas.ts`
  - `travelplan/src/lib/repositories/accommodationRepo.ts`
  - `travelplan/src/lib/repositories/dayPlanItemRepo.ts`
  - `travelplan/src/app/api/trips/[id]/accommodations/route.ts`
  - `travelplan/src/app/api/trips/[id]/day-plan-items/route.ts`
  - `travelplan/src/app/api/trips/[id]/route.ts`
  - `travelplan/src/components/features/trips/TripAccommodationDialog.tsx`
  - `travelplan/src/components/features/trips/TripDayPlanDialog.tsx`
  - `travelplan/src/components/features/trips/TripTimeline.tsx` (overview entry point)
  - `travelplan/src/i18n/en.ts`
  - `travelplan/src/i18n/de.ts`

### References

- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/epics.md#Story 3.1: Trip Overview Map With All Places`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/prd.md#Transport & Routing`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/architecture.md#Implementation Patterns & Consistency Rules`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/architecture.md#Project Structure & Boundaries`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/3-5-day-view-map-panel-with-ordered-pins.md`

## Developer Context

### Data Model

- Introduce explicit location fields for both Accommodation and DayPlanItem.
- Keep schema optional for backward compatibility with existing records.
- Use deterministic field names and shared mapping helpers to avoid drift between models.

### API Shape

- Include location in relevant payloads using camelCase.
- Suggested response field shape:
  - `location: { lat: number, lng: number } | null`
- Maintain success/error envelope conventions:
  - Success: `{ data: <payload>, error: null }`
  - Error: `{ data: null, error: { code, message, details } }`

### UI Behavior

- Users can enter/edit location for accommodation and plan items.
- Overview map renders all places that contain valid location.
- Missing locations appear in a clear missing list/state.

### Validation Rules

- Latitude range: `-90..90`
- Longitude range: `-180..180`
- Reject partial coordinates (lat-only or lng-only).
- Never return malformed location objects to UI.

## Technical Requirements

- Keep pinned stack decisions:
  - Next.js App Router
  - Prisma ORM 7.3.x line
  - SQLite persistence
  - Zod validation
- No dependency upgrades in this story.

## Architecture Compliance

- DB fields: snake_case.
- API JSON fields: camelCase.
- Repository pattern enforces user ownership boundaries.
- Existing route-handler conventions and CSRF/session patterns remain unchanged.

## Library & Framework Requirements

- Use existing route handlers and repository patterns.
- Reuse existing map component strategy (Leaflet + current panel patterns).
- Keep UI consistent with existing MUI dialogs/forms.

## File Structure Requirements

- Extend existing feature modules; do not create parallel location-only modules.
- Keep tests under established `travelplan/test/` conventions.

## Testing Requirements

- Repository tests:
  - create/update/read location for accommodations and plan items
  - null/missing location handling
  - ownership boundary checks
- API tests:
  - accepts valid location payload
  - rejects invalid coordinates
  - returns location in detail/list responses
- UI tests:
  - location fields render in both dialogs
  - overview map includes markers for located places
  - missing-location indicator appears for unlocated places

## Previous Story Intelligence

- Story 3.5 introduced day-view map and marker ordering behavior; align data shape with that panel contract.
- Stories 2.5/2.7 established accommodation/day-plan CRUD and validation conventions to preserve.

## Git Intelligence Summary

- Recent commits established day-view map and trip/day planning CRUD conventions.
- Implement location as additive changes to current APIs/components to avoid regressions.

## Latest Technical Information

- Keep using Next.js Route Handlers and existing Leaflet integration approach already present in the codebase.

## Project Context Reference

No `project-context.md` was found. Story context uses:
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/epics.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/prd.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/architecture.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/ux-design-specification.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/3-5-day-view-map-panel-with-ordered-pins.md`

## Story Completion Status

- Status set to **done**.
- Completion note: Review findings addressed (geocode auth, clear-location UX, location type consistency, and story documentation sync).

## Dev Agent Record

### Agent Model Used

Codex (GPT-5)

### Debug Log References

- `npm test -- test/dayPlanItemSchemas.test.ts test/accommodationRepo.test.ts test/dayPlanItemRepo.test.ts`
- `npm test -- test/dayPlanItemSchemas.test.ts test/accommodationRepo.test.ts test/dayPlanItemRepo.test.ts test/tripAccommodationRoute.test.ts test/tripDayPlanItemsRoute.test.ts test/tripDetailRoute.test.ts test/tripTimelinePlan.test.tsx test/tripDayPlanDialog.test.tsx test/tripAccommodationDialog.test.tsx test/tripOverviewMapPanel.test.tsx`
- `npm test -- test/tripAccommodationRoute.test.ts test/tripDayPlanDialog.test.tsx`
- `npm test`
- `npm test -- test/tripOverviewMapPanel.test.tsx test/tripAccommodationDialog.test.tsx test/tripDayPlanDialog.test.tsx test/tripDetailRoute.test.ts test/tripDayPlanItemsRoute.test.ts test/tripAccommodationRoute.test.ts test/geocodeRoute.test.ts`

### Completion Notes List

- Story selected and aligned to requested location implementation scope.
- Story reframed to include end-to-end location persistence and trip overview map behavior.
- Added optional location columns for accommodations/day plan items in Prisma schema and migration, then regenerated Prisma client.
- Added shared location validation with coordinate range checks and partial-coordinate rejection; propagated through accommodation and day-plan schemas.
- Extended accommodation/day-plan repositories and trip detail repository output to persist and return normalized location objects while preserving ownership checks.
- Exposed location fields in accommodation and day-plan API routes and included location-bearing day plan items in trip detail responses.
- Added location inputs to both dialogs and implemented trip overview map rendering with missing-location indicators.
- Added EN/DE copy for location labels/helpers/errors and overview-map labels.
- Added/updated repository, API, and UI tests for location persistence, request/response shape, dialog inputs, and overview map marker/missing behavior.
- Full regression suite passed: `131` tests.
- Review fixes applied:
  - Secured `/api/geocode` behind authenticated session checks.
  - Added explicit clear-location actions in stay and day-plan dialogs.
  - Normalized day-view accommodation location type to include optional `label`.
  - Synced story status and sprint tracking to final state.

### File List

- _bmad-output/implementation-artifacts/3-1-trip-overview-map-with-all-places.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- travelplan/prisma/schema.prisma
- travelplan/prisma/migrations/20260214223800_add_location_fields/migration.sql
- travelplan/src/generated/prisma/commonInputTypes.ts
- travelplan/src/generated/prisma/internal/class.ts
- travelplan/src/generated/prisma/internal/prismaNamespace.ts
- travelplan/src/generated/prisma/internal/prismaNamespaceBrowser.ts
- travelplan/src/generated/prisma/models/Accommodation.ts
- travelplan/src/generated/prisma/models/DayPlanItem.ts
- travelplan/src/lib/validation/locationSchemas.ts
- travelplan/src/lib/validation/accommodationSchemas.ts
- travelplan/src/lib/validation/dayPlanItemSchemas.ts
- travelplan/src/lib/repositories/accommodationRepo.ts
- travelplan/src/lib/repositories/dayPlanItemRepo.ts
- travelplan/src/lib/repositories/tripRepo.ts
- travelplan/src/app/api/trips/[id]/accommodations/route.ts
- travelplan/src/app/api/trips/[id]/day-plan-items/route.ts
- travelplan/src/app/api/trips/[id]/route.ts
- travelplan/src/app/api/geocode/route.ts
- travelplan/src/components/features/trips/TripAccommodationDialog.tsx
- travelplan/src/components/features/trips/TripDayMapPanel.tsx
- travelplan/src/components/features/trips/TripDayPlanDialog.tsx
- travelplan/src/components/features/trips/TripDayView.tsx
- travelplan/src/components/features/trips/TripTimeline.tsx
- travelplan/src/components/features/trips/TripOverviewMapPanel.tsx
- travelplan/src/app/layout.tsx
- travelplan/src/middleware.ts
- travelplan/src/i18n/en.ts
- travelplan/src/i18n/de.ts
- travelplan/test/accommodationRepo.test.ts
- travelplan/test/dayPlanItemRepo.test.ts
- travelplan/test/dayPlanItemSchemas.test.ts
- travelplan/test/geocodeRoute.test.ts
- travelplan/test/tripAccommodationRoute.test.ts
- travelplan/test/tripDayMapPanel.test.tsx
- travelplan/test/tripDayPlanItemsRoute.test.ts
- travelplan/test/tripDetailRoute.test.ts
- travelplan/test/tripTimelinePlan.test.tsx
- travelplan/test/tripDayPlanDialog.test.tsx
- travelplan/test/tripAccommodationDialog.test.tsx
- travelplan/test/tripOverviewMapPanel.test.tsx

## Senior Developer Review (AI)

- Date: 2026-02-14
- Outcome: Changes Requested -> Fixed
- Fixed items:
  - [HIGH] Added auth guard to `/api/geocode` to prevent unauthenticated abuse.
  - [MEDIUM] Added clear controls to remove previously selected locations in both dialogs.
  - [MEDIUM] Unified day-view location typing to match cross-layer location shape.
  - [MEDIUM] Corrected story status/documentation inconsistencies and completed file list.

## Change Log

- 2026-02-14: Addressed code-review findings (auth hardening for geocode, clear-location UX, location type consistency, and documentation/sprint sync).
