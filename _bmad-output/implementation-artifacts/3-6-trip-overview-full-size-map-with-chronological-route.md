# Story 3.6: Trip Overview Full-Size Map With Chronological Route

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner,
I want to open a full-size trip map from the trip overview,
so that I can inspect the full trip route in chronological order and review the linked stay or day item behind each place.

## Acceptance Criteria

1. **Given** I am viewing the trip overview map
   **When** I activate the full-size map action
   **Then** a full-size trip map opens for the current trip.
2. **Given** the full-size trip map is open
   **When** it renders
   **Then** it shows all trip places with valid locations
   **And** connects them in chronological order across the trip.
3. **Given** I click or tap a place marker on the full-size trip map
   **When** the marker popup opens
   **Then** it shows the linked accommodation or day item for that place.
4. **Given** a trip place is missing location data
   **When** the full-size trip map renders
   **Then** that place is excluded
   **And** the missing-location handling remains clear and non-blocking.
5. **Given** the trip overview mini map and the full-size trip map represent the same trip
   **When** I compare them
   **Then** the full-size map uses interaction and visual patterns consistent with the day full-page map where applicable.

## Tasks / Subtasks

- [x] Add a visible expand action to the trip overview map panel that opens a full-page trip map route for the current trip (AC: 1, 5)
  - [x] Reuse the same icon-button/tooltip interaction pattern established in the day map panel.
  - [x] Add the new trip-level full-page route under `src/app/(routes)/trips/[id]/map/page.tsx` with a back action to the trip overview.
- [x] Build canonical chronological trip map data instead of reusing the current overview marker order directly (AC: 2, 4)
  - [x] Sort days by `dayIndex` with date/id fallback, then derive the trip route order from the canonical trip/day/day-item sequence.
  - [x] Include accommodations and day items with valid locations, and exclude missing locations into the existing missing-location list/state.
  - [x] Avoid duplicate consecutive route points when the same stay would otherwise be represented twice across adjacent days.
- [x] Implement a full-page trip map component that reuses the existing Leaflet full-page pattern from the day map (AC: 1, 2, 5)
  - [x] Reuse `FitToBounds` and map sizing behavior already established in `TripDayLeafletMap` / `TripDayMapFullPage`.
  - [x] Render trip-level markers and a simple polyline connecting them in chronological order; do not introduce routing-service dependence in this story.
- [x] Add marker click popup behavior for trip-level map items (AC: 3, 5)
  - [x] Show accommodation name and notes for stay markers.
  - [x] Show day item label and rendered plan content for plan-item markers.
  - [x] Reuse existing popup/dialog content patterns where practical instead of creating a second map-specific content design.
- [x] Add i18n strings and test coverage for the new trip full-page map experience (AC: 1, 3, 4, 5)
  - [x] Add EN/DE labels for the expand action, full-page title/back label, and any popup labels.
  - [x] Add UI tests for launching the full-page trip map, marker click popup content, and chronological polyline rendering.
  - [x] Add or update tests covering missing-location behavior on the full-page trip map.

## Dev Notes

- Story `3.1` already introduced trip overview markers and missing-location handling in the trip timeline. Extend that behavior; do not reframe or replace it.
- Story `3.5` established ordered point generation and simple polyline behavior for day maps. Reuse that pattern for trip-level ordering.
- Story `2.28` established the existing full-page map route pattern, expand control pattern, and marker detail dialog behavior. The trip-level implementation should feel like the sibling of that day-map flow.
- The current `TripTimeline` overview map data is built by pushing `day.accommodation` before `day.dayPlanItems`, which is sufficient for overview markers but not reliable as chronological route order. This story must derive an explicit canonical trip order.
- `TripTimeline` trip detail data already includes accommodation `notes` and day plan item `contentJson`, so popup content can be rendered without inventing new core models. If image support is desired for parity with day full-page maps, prefer reusing existing image endpoints rather than adding duplicate payload fields.

### Project Structure Notes

- Trip overview entry point: `travelplan/src/components/features/trips/TripTimeline.tsx`
- Trip overview panel: `travelplan/src/components/features/trips/TripOverviewMapPanel.tsx`
- Current trip overview Leaflet map: `travelplan/src/components/features/trips/TripOverviewLeafletMap.tsx`
- Existing day full-page pattern: `travelplan/src/components/features/trips/TripDayMapFullPage.tsx`
- Existing generic day Leaflet map behavior: `travelplan/src/components/features/trips/TripDayLeafletMap.tsx`
- Existing map ordering helper: `travelplan/src/components/features/trips/TripDayMapPanel.tsx`
- Proposed new full-page route: `travelplan/src/app/(routes)/trips/[id]/map/page.tsx`
- Likely new component: `travelplan/src/components/features/trips/TripOverviewMapFullPage.tsx`
- Optional shared trip-map helper module if extraction is needed, but prefer extending existing trip map feature files over creating a parallel map subsystem.

### References

- [epics.md](/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/epics.md)
- [prd.md](/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/prd.md)
- [architecture.md](/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/architecture.md)
- [ux-design-specification.md](/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/ux-design-specification.md)
- [2-28-map-full-page-view.md](/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/2-28-map-full-page-view.md)
- [3-1-trip-overview-map-with-all-places.md](/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/3-1-trip-overview-map-with-all-places.md)
- [3-5-day-view-map-panel-with-ordered-pins.md](/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/3-5-day-view-map-panel-with-ordered-pins.md)

## Developer Context

### Existing Behavior To Reuse

- `TripOverviewMapPanel` already owns the overview card shell, empty state, and missing-location list.
- `TripOverviewLeafletMap` already owns trip-level marker rendering and bounds fitting for the mini map.
- `TripDayMapFullPage` already demonstrates:
  - full-page map route/page composition
  - back-button placement
  - marker click dialog handling
  - full-height map sizing
- `TripDayLeafletMap` already supports marker click handlers and simple polyline rendering.

### Data And Ordering Guardrails

- Do not treat the existing `overviewMapData.points` array in `TripTimeline` as the route order source. It is built for marker display, not trip chronology.
- Build trip-level ordered points from the canonical sequence:
  - days sorted by `dayIndex`, then date fallback, then id fallback
  - within each day, append day plan items in their stored order
  - append the day accommodation at the end of that day sequence when it has a location
- If the same accommodation would appear as consecutive identical route points across adjacent days, dedupe the duplicate point before drawing the polyline.
- Missing-location handling should stay aligned with Story `3.1`: excluded from the map, still discoverable to the user.

### Popup Content Guardrails

- For accommodation markers, popup content should use the existing stay label plus notes/description already available on trip detail.
- For day-item markers, popup content should use the same rich-text rendering approach used elsewhere for `contentJson`.
- Reuse the content/popup composition from the day full-page map where practical. Avoid a second divergent popup design for trip maps.

## Technical Requirements

- Use a simple polyline between ordered trip points in this story. Do not pull in OSRM or transport routing behavior.
- Prefer a shared trip-level map-item builder/helper so the overview panel and full-page trip map can share the same point metadata without duplicating label logic.
- The full-page trip map should reuse the existing Leaflet stack and full-page route pattern, not introduce a new map library or rendering path.
- Marker click handling should follow the same `eventHandlers` pattern already used in `TripDayLeafletMap`.
- If the full-page variant requires a different container size, mount a distinct map instance or key it explicitly rather than assuming mutable `MapContainer` props.

## Architecture Compliance

- Keep UI changes within `components/features/trips` and `app/(routes)`.
- Use the current App Router route conventions for the new full-page trip map route.
- Preserve existing API response envelopes and current trip detail loading flow. No new API surface should be added unless implementation proves a hard data gap.
- Continue using Material UI for panel chrome, icon buttons, dialogs, and empty states.

## Library & Framework Requirements

- Continue using Leaflet and React-Leaflet already present in the codebase.
- Stay on Leaflet `1.9.x` as documented in architecture; do not introduce Leaflet `2.0.0-alpha`.
- React-Leaflet `MapContainer` setup should follow the same constraints already documented in Story `2.28`; full-page and panel variants should be separate instances when size/layout differs materially.

## File Structure Requirements

- Expected edits:
  - `travelplan/src/components/features/trips/TripTimeline.tsx`
  - `travelplan/src/components/features/trips/TripOverviewMapPanel.tsx`
  - `travelplan/src/components/features/trips/TripOverviewLeafletMap.tsx`
  - `travelplan/src/app/(routes)/trips/[id]/map/page.tsx`
  - `travelplan/src/i18n/en.ts`
  - `travelplan/src/i18n/de.ts`
- Expected additions:
  - `travelplan/src/components/features/trips/TripOverviewMapFullPage.tsx`
- Optional extraction:
  - a small shared helper for ordered trip map items under `travelplan/src/components/features/trips/`

## Testing Requirements

- Add a UI test verifying the overview map panel exposes the expand action and routes to the full-page trip map.
- Add a UI test verifying the full-page trip map renders markers and a chronological polyline for a multi-day trip fixture.
- Add a UI test verifying marker click popup content differs correctly for accommodation vs day-item markers.
- Add a regression test verifying missing-location items remain excluded from the map and visible in the missing-location list/state.
- Manual check: full-page trip map works on desktop and mobile widths and matches the day full-page map interaction style.

## Previous Story Intelligence

- Story `3.5` already solved ordered pins plus simple polyline behavior without routing-service dependency. Mirror that approach at trip scope.
- Story `2.28` already solved the UI/interaction shape for map expansion and marker detail dialogs. Reuse that approach instead of inventing a new trip-map UX.
- Story `3.1` already established the trip overview map and missing-location handling, so this story should extend that baseline rather than rebuilding trip-map plumbing from scratch.

## Git Intelligence Summary

- The five most recent commits are for Epic 5 sharing/comment features, not maps. Do not assume recent branch work changed map conventions.
- Map-related implementation guidance should therefore come from the existing story artifacts and current source files, not recent commit history.

## Latest Tech Information

- Keep the implementation on the project’s existing Leaflet and React-Leaflet stack. The architecture and earlier map story context already warn against switching to Leaflet 2 alpha.
- Treat full-page and panel maps as separate mounted map instances when layout differs, consistent with the existing day full-page implementation guidance.

## Project Context Reference

- [epics.md](/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/epics.md)
- [architecture.md](/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/architecture.md)
- [prd.md](/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/prd.md)
- [ux-design-specification.md](/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/ux-design-specification.md)

## Story Completion Status

- Status set to **ready-for-dev**.
- Completion note: Comprehensive trip full-page map story context created with implementation guardrails, reuse targets, and testing expectations.

## Dev Agent Record

### Agent Model Used

Codex (GPT-5)

### Debug Log References

- Analyzed Epic 3 planning artifacts plus prior map stories `2.28`, `3.1`, and `3.5`.
- Reviewed current trip overview and day full-page map implementation files to anchor reuse guidance to the codebase.
- Implemented a shared canonical trip-map data builder to drive both the overview panel and the new full-page trip map route.
- Reused the existing Leaflet fit-bounds and icon-button expansion patterns instead of introducing a second trip-map rendering path.
- Addressed code review follow-ups by exposing popup navigation targets, tightening consecutive-stay dedupe semantics, and adding a `TripTimeline` route-wiring regression test.

### Implementation Plan

- Build shared chronological trip map point derivation so the overview panel and full-page map consume the same ordering, labels, and missing-location rules.
- Extend the existing overview map panel with the day-map expand affordance and add a sibling full-page trip map route/component.
- Reuse the existing Leaflet and dialog content patterns for polylines, marker click handling, and popup rendering, then validate with focused UI and regression tests.

### Completion Notes List

- Identified that the current trip overview map order is not guaranteed chronological and must not be reused as the route source.
- Anchored the new story to existing trip overview map components and the existing day full-page map interaction model.
- Captured explicit guardrails to avoid introducing OSRM/routing-service dependency or a second trip-map architecture.
- Added `/trips/[id]/map` with a back action, full-page trip map rendering, marker popups for stays and plan items, and shared chronological polyline data.
- Preserved missing-location handling across both trip overview map surfaces while excluding invalid points from the rendered route.
- Added regression coverage for the expand action, canonical ordering/deduping helper, full-page popup content, and missing-location behavior.
- Added a follow-up regression test to verify `TripTimeline` passes the full-page map route into the overview map panel.

### File List

- `_bmad-output/implementation-artifacts/3-6-trip-overview-full-size-map-with-chronological-route.md`
- `travelplan/src/app/(routes)/trips/[id]/map/page.tsx`
- `travelplan/src/components/features/trips/TripOverviewLeafletMap.tsx`
- `travelplan/src/components/features/trips/TripOverviewMapData.ts`
- `travelplan/src/components/features/trips/TripOverviewMapFullPage.tsx`
- `travelplan/src/components/features/trips/TripOverviewMapPanel.tsx`
- `travelplan/src/components/features/trips/TripTimeline.tsx`
- `travelplan/src/i18n/de.ts`
- `travelplan/src/i18n/en.ts`
- `travelplan/test/tripOverviewMapData.test.ts`
- `travelplan/test/tripOverviewMapFullPage.test.tsx`
- `travelplan/test/tripOverviewMapPanel.test.tsx`
- `travelplan/test/tripTimelinePlan.test.tsx`

## Change Log

- 2026-03-11: Added the trip full-page map route, shared canonical trip map ordering, popup handling, i18n labels, and regression coverage for Story 3.6.
- 2026-03-11: Fixed code review findings for popup navigation, consecutive-stay dedupe semantics, and `TripTimeline` map-route wiring coverage.
