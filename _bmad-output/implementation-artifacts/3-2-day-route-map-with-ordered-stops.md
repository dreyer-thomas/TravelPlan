# Story 3.2: Day Route Map With Ordered Stops

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner,
I want to see a day route that starts at the day start point and ends at the night accommodation,
so that I can visualize the full travel plan with stops in order.

## Acceptance Criteria

1. **Given** a day has a start location, intermediate places, and a night accommodation location  
   **When** I open the day route map  
   **Then** I see a single route with ordered stops and sub-destinations
2. **Given** a day has no intermediate places  
   **When** I open the day route map  
   **Then** I see a route from start to night accommodation only
3. **Given** routing is unavailable from the OSRM service  
   **When** I open the day route map  
   **Then** I see a clear error state and the map does not crash

## Story Requirements

- Build on existing day map panel behavior from Story 3.5 (ordered markers, missing-location handling).
- Use existing location model introduced in Story 3.1 for accommodations and day plan items.
- Introduce routing geometry retrieval (OSRM) for the day route while keeping marker order deterministic.
- Keep fallback behavior explicit: if routing fails, preserve markers and show user-facing routing error state.
- Keep compatibility with current day view timeline and budget panels.

## Tasks / Subtasks

- [x] Routing service integration (AC: 1, 2, 3)
  - [x] Add a server-side routing helper/service that requests route geometry from OSRM for ordered points.
  - [x] Normalize routing response to a UI-safe shape (polyline coordinates + distance/duration if available).
  - [x] Handle timeouts/network/invalid-response failures with typed error mapping.
- [x] API layer for day routing (AC: 1, 2, 3)
  - [x] Add authenticated route endpoint under `src/app/api/**/route.ts` conventions for day routing data.
  - [x] Validate inputs with Zod and return `{ data, error }` envelope consistently.
  - [x] Ensure owner-boundary checks prevent cross-user route data access.
- [x] Day map UI upgrade (AC: 1, 2, 3)
  - [x] Extend day map panel to consume either routed geometry or fallback ordered polyline.
  - [x] Add visible routing-unavailable state text without breaking existing map rendering.
  - [x] Preserve missing-location chips/list behavior from Story 3.5.
- [x] i18n and copy updates (AC: 3)
  - [x] Add EN/DE strings for routing unavailable and retry/help text.
- [x] Tests (AC: 1, 2, 3)
  - [x] Service tests for successful OSRM mapping and failure modes.
  - [x] API tests for validation, auth, and error envelopes.
  - [x] UI tests for routed line display, two-point route, and graceful error state.

## Dev Notes

- Reuse existing map rendering components (`TripDayMapPanel`, `TripDayLeafletMap`) and extend, do not fork.
- Keep routing call server-side; do not expose third-party routing keys/config directly in client code.
- Story 3.4 later formalizes routing setup/fallback strategy globally; keep this story implementation compatible and incremental.
- Avoid regressions in day view interactions (plan item edit/delete, stay edit, day image controls).

### Project Structure Notes

- Likely touch points:
  - `travelplan/src/components/features/trips/TripDayMapPanel.tsx`
  - `travelplan/src/components/features/trips/TripDayLeafletMap.tsx`
  - `travelplan/src/components/features/trips/TripDayView.tsx`
  - `travelplan/src/app/api/geocode/route.ts` (reference pattern for external map requests + auth)
  - `travelplan/src/app/api/trips/[id]/days/[dayId]/route/route.ts` (recommended new endpoint)
  - `travelplan/src/lib/validation/` (routing request schemas)
  - `travelplan/src/lib/` service module for routing client adapter
  - `travelplan/src/i18n/en.ts`
  - `travelplan/src/i18n/de.ts`
  - `travelplan/test/` route/service/UI test files

### References

- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/epics.md#Story 3.2: Day Route Map With Ordered Stops`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/epics.md#Story 3.4: Routing Service Setup and Fallback Strategy`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/architecture.md#Implementation Patterns & Consistency Rules`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/architecture.md#Project Structure & Boundaries`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/3-1-trip-overview-map-with-all-places.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/3-5-day-view-map-panel-with-ordered-pins.md`

## Developer Context

### Story Foundation

- Epic: Route & Map-Based Planning (Epic 3).
- This story connects existing ordered map points to routed geometry for daily travel visualization.
- User value is route clarity per day, including no-stop days and robust fallback behavior.

### Existing Implementation Intelligence

- Story 3.1 already established optional location fields for accommodation and day plan items in DB/API/UI.
- Story 3.5 already renders ordered markers and straight-line polyline with missing-location indicators.
- Current code has authenticated geocoding endpoint (`/api/geocode`) and Leaflet-based day map components ready for extension.

## Technical Requirements

- Keep API envelope standard: success `{ data, error: null }`, failure `{ data: null, error }`.
- Preserve camelCase API JSON and snake_case DB constraints.
- Keep map stack aligned to current project dependencies (`leaflet@1.9.4`, `react-leaflet@5.x`).
- Route endpoint must enforce authenticated user context and ownership constraints.
- Routing failures must be non-fatal to map UI (error state + still-rendered points where possible).

## Architecture Compliance

- Route handlers remain under `src/app/api/**/route.ts`.
- Validation remains in Zod schemas under `src/lib/validation`.
- Shared integration logic belongs in `src/lib` service/repository style modules.
- UI changes remain inside existing trips feature components.

## Library & Framework Requirements

- Next.js App Router route handlers for server integration.
- Leaflet + React Leaflet for map rendering and overlays.
- Zod for request/response-safe validation and parsing.
- OSRM HTTP API contract for route geometry retrieval.

## File Structure Requirements

- Extend existing trips feature files; avoid introducing duplicate map components.
- Keep routing-specific integration isolated to service + API modules with clear boundaries.
- Keep tests in existing `travelplan/test/` organization.

## Testing Requirements

- Service unit tests:
  - maps ordered coordinates to OSRM request format
  - handles OSRM unavailable/timeout/invalid payload conditions
- API tests:
  - rejects unauthenticated calls
  - rejects malformed coordinate input
  - returns normalized route payload on success
  - returns stable error envelope on routing failure
- UI tests:
  - displays routed line with ordered stops
  - displays two-point route for start/end only day
  - displays routing error state without crashing map container

## Previous Story Intelligence

- From 3.1: location objects are optional and already normalized across stays and plan items; preserve this exact shape.
- From 3.5: ordered point construction and missing-location UX are stable and should be reused as-is.

## Git Intelligence Summary

- Main branch history is currently concentrated on Epic 1/2 stories; map/routing behavior should be implemented with minimal disruption to existing trip/day flows.
- Existing day view code centralizes timeline, summary, and map panel in `TripDayView`; route-map enhancements should stay within this integration point.

## Latest Technical Information

- Next.js route handlers and server-first data fetching patterns remain the recommended integration model for API endpoints.
- Leaflet 1.9.x is the stable line; avoid 2.0 alpha APIs.
- OSRM route API supports `driving` profile and `polyline`/GeoJSON geometry output suitable for map overlays.

## Project Context Reference

No `project-context.md` was found. Story context uses:
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/epics.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/prd.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/architecture.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/ux-design-specification.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/3-1-trip-overview-map-with-all-places.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/3-5-day-view-map-panel-with-ordered-pins.md`

## Story Completion Status

- Status set to **done** after code-review fixes were applied and verified.
- Completion note: Day route OSRM integration delivered with secured API route, deterministic fallback rendering, and full regression pass.

## Dev Agent Record

### Agent Model Used

Codex (GPT-5)

### Debug Log References

- `npm test -- test/dayRouteService.test.ts test/tripDayRoute.test.ts test/tripDayMapPanel.test.tsx test/tripDayViewLayout.test.tsx`
- `npm test -- test/dayRouteService.test.ts test/tripDayRoute.test.ts test/tripDayMapPanel.test.tsx test/tripDayViewLayout.test.tsx` (22/22 passing after review fixes)
- `npm test` (204/204 passing)
- `npm run lint` (warnings only, no errors)

### Completion Notes List

- Added `travelplan/src/lib/routing/dayRouteService.ts` to fetch OSRM geometry, normalize route polyline shape, and map typed failures (`routing_unavailable`, `routing_invalid_response`).
- Added `travelplan/src/app/api/trips/[id]/days/[dayId]/route/route.ts` with session auth, Zod param validation, owner-boundary route-point lookup, and stable `{ data, error }` response envelope.
- Extended `travelplan/src/lib/repositories/tripRepo.ts` with `getDayRoutePointsForUser` to build ordered route points from previous-night stay, plan items, and current-night stay.
- Updated `TripDayView`, `TripDayMapPanel`, and `TripDayLeafletMap` to consume routed polyline when available and preserve fallback marker/polyline rendering with visible routing-unavailable copy.
- Added EN/DE i18n keys for routing unavailable state.
- Added/updated tests for service mapping/failure modes, route API auth/ownership/error envelope, and UI routed/fallback behavior.
- Code review fix: hardened route/polyline parsing against non-finite coordinate values to avoid invalid map render input.
- Code review fix: added explicit timeout-mapping coverage in `dayRouteService` tests.
- Code review fix: added API validation-path test for malformed route params (`validation_error`, HTTP 400).
- Code review sync: documented unrelated workspace change file observed during review run for file-list transparency.

### File List

- `travelplan/src/lib/routing/dayRouteService.ts`
- `travelplan/src/lib/validation/dayRouteSchemas.ts`
- `travelplan/src/lib/repositories/tripRepo.ts`
- `travelplan/src/app/api/trips/[id]/days/[dayId]/route/route.ts`
- `travelplan/src/components/features/trips/TripDayLeafletMap.tsx`
- `travelplan/src/components/features/trips/TripDayMapPanel.tsx`
- `travelplan/src/components/features/trips/TripDayView.tsx`
- `travelplan/src/i18n/en.ts`
- `travelplan/src/i18n/de.ts`
- `travelplan/test/dayRouteService.test.ts`
- `travelplan/test/tripDayRoute.test.ts`
- `travelplan/test/tripDayMapPanel.test.tsx`
- `travelplan/test/tripDayViewLayout.test.tsx`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/implementation-artifacts/3-2-day-route-map-with-ordered-stops.md`
- `_bmad-output/implementation-artifacts/2-16-accommodation-and-plan-item-image-galleries.md`
