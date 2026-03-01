# Story 2.28: Map Full Page View

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner,
I want a larger day-view map with a full-page map option and clickable markers,
so that I can review route details and item info without losing context.

## Acceptance Criteria

1. **Given** I am in the day view
   **When** I look at the map panel
   **Then** the map viewport is visibly larger than the current 220px height on desktop
   **And** the panel remains responsive on tablet/mobile.
2. **Given** I am in the day view
   **When** I click the map expand icon button (symbol-only)
   **Then** a full-page day map view opens for the same trip day.
3. **Given** the full-page day map is open
   **When** the map renders
   **Then** it shows the same ordered markers and polyline as the day map panel
   **And** it fits bounds to the available points.
4. **Given** a day map marker (red dot) represents a day item
   **When** I click the marker
   **Then** a small dialog opens showing that item’s title, description, and images
   **And** the content matches what is shown in the day timeline cards.
5. **Given** the marker represents a previous-night or current-night accommodation
   **When** I click it
   **Then** the dialog shows the accommodation name, notes/description (if any), and its images.
6. **Given** there are no mapped locations
   **When** I view either the panel or full-page map
   **Then** the existing empty-state messaging remains visible.
7. **Given** I close the map dialog or the full-page map
   **When** I return to the day view
   **Then** my scroll position and day view state are preserved.

## Tasks / Subtasks

- [ ] Increase the day map panel height in `TripDayLeafletMap` and the loading/empty states (AC: 1)
- [ ] Add an icon-only expand control in the day map panel header with accessible label + tooltip (AC: 2)
- [ ] Implement a full-page day map route (new page under day view routes) that reuses the day map data + rendering (AC: 2, 3, 6)
- [ ] Add marker click handling to open an item details dialog (AC: 4, 5)
- [ ] Ensure dialog content uses the same rendering logic as the timeline for plan item text and images (AC: 4, 5)
- [ ] Add i18n strings for the new button and dialog labels in EN/DE (AC: 2, 4, 5)
- [ ] Add/update UI tests for marker click -> dialog content and full-page map routing (AC: 2, 4)

## Dev Notes

- The day map currently renders in `TripDayMapPanel` -> `TripDayLeafletMap` with fixed 220px height.
- Ordered map points are built in `TripDayView` via `buildDayMapPanelData` from previous stay, plan items, and current stay.
- Timeline rendering logic for plan item descriptions lives in `TripDayView` (`PlanItemRichContent`, `parsePlanText`, `renderRichNode`).
- Plan item and accommodation images are already loaded in `TripDayView` via `planItemImagesById`, `accommodationImages`, and `previousAccommodationImages`.
- Marker icons are rendered via Leaflet `divIcon` in `TripDayLeafletMap`.

### Project Structure Notes

- Day view page: `travelplan/src/components/features/trips/TripDayView.tsx`
- Map panel: `travelplan/src/components/features/trips/TripDayMapPanel.tsx`
- Map rendering: `travelplan/src/components/features/trips/TripDayLeafletMap.tsx`
- i18n strings: `travelplan/src/i18n/en.ts`, `travelplan/src/i18n/de.ts`
- Proposed full-page route: `travelplan/src/app/(routes)/trips/[id]/days/[dayId]/map/page.tsx`

### References

- `_bmad-output/implementation-artifacts/3-5-day-view-map-panel-with-ordered-pins.md`
- `_bmad-output/planning-artifacts/ux-design-specification.md` (map views and modal patterns)
- `_bmad-output/planning-artifacts/architecture.md` (Leaflet, MUI, component boundaries)

## Developer Context

- The map panel is in the right column below the budget summary in `TripDayView`.
- The new dialog should mirror the timeline card content (title, rich description, images) to avoid divergent UI.
- Use existing map data ordering: previous stay -> day plan items -> current stay.

## Technical Requirements

- Use a single source of truth for map item metadata (title, description, images) and pass it to both panel and full-page map.
- Add marker click handlers in `TripDayLeafletMap` via `eventHandlers` and forward the clicked item id/kind back to `TripDayView`.
- The detail dialog should be a lightweight MUI `Dialog` or `Popover` with:
  - Title (item label)
  - Description body (rendered rich content for plan items; notes for accommodations)
  - Image strip (reuse `MiniImageStrip` and existing image arrays)
- The full-page map should reuse `TripDayLeafletMap` (or a thin wrapper) with a larger height (e.g., `calc(100vh - header)`)
  and preserve `FitToBounds` + `EnsureMapSized` behaviors.

## Architecture Compliance

- Keep all UI changes within `components/features/trips` and `app/(routes)`.
- No API or DB changes are required; use existing day detail payload.
- Maintain Material UI patterns for dialog and icon button styling.

## Library & Framework Requirements

- Continue using Leaflet and React-Leaflet already in the project.
- React-Leaflet `MapContainer` props are immutable after mount; if the full-page map needs different sizing or options, mount a separate instance or use a distinct React `key` when switching contexts.
- Leaflet 2.0 is in alpha and removes the global `L`; keep the project on Leaflet 1.9.x as already specified in architecture.

## File Structure Requirements

- Expected edits:
  - `travelplan/src/components/features/trips/TripDayView.tsx`
  - `travelplan/src/components/features/trips/TripDayMapPanel.tsx`
  - `travelplan/src/components/features/trips/TripDayLeafletMap.tsx`
  - `travelplan/src/app/(routes)/trips/[id]/days/[dayId]/map/page.tsx`
  - `travelplan/src/i18n/en.ts`
  - `travelplan/src/i18n/de.ts`
  - (Optional) new map dialog component under `travelplan/src/components/features/trips/`

## Testing Requirements

- Add a UI test to confirm clicking a map marker opens the details dialog and shows the item title + description.
- Add a UI test to confirm the full-page map route renders and shows the map container with markers.
- Manual check: panel map height increased and remains responsive at tablet/mobile widths.

## Previous Story Intelligence

- Story 2.27 focuses on typography changes; avoid introducing unrelated typography changes in this story.

## Latest Tech Information

- Leaflet 2.0 alpha introduces ESM-only distribution and removes the global `L` in core builds; keep the current Leaflet 1.9.x usage for compatibility with the existing `L` import pattern.
- React-Leaflet `MapContainer` props are immutable after initial mount; size/option changes should be done via remounting when needed.

## Project Context Reference

- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/epics.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/architecture.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/prd.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/ux-design-specification.md`

## Story Completion Status

- Status set to **ready-for-dev**.
- Completion note: Full-page day map and marker detail dialog requirements defined with UI + testing guidance.

## Dev Agent Record

### Agent Model Used

Codex (GPT-5)

### Debug Log References

- Created story context for day-view map expansion and marker details dialog.

### Completion Notes List

- Enlarge day map panel, add full-page map route, and wire marker click to details dialog.
- Reuse existing timeline rendering + image strips for consistent item previews.

### File List

- `_bmad-output/implementation-artifacts/2-28-map-full-page-view.md`
- `_bmad-output/implementation-artifacts/3-5-day-view-map-panel-with-ordered-pins.md`
- `_bmad-output/implementation-artifacts/2-27-change-font.md`
- `_bmad-output/planning-artifacts/epics.md`
- `_bmad-output/planning-artifacts/architecture.md`
- `_bmad-output/planning-artifacts/prd.md`
- `_bmad-output/planning-artifacts/ux-design-specification.md`
