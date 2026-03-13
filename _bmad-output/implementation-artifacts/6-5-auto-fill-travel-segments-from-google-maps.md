# Story 6.5: Auto-Fill Travel Segments From Google Maps

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner,
I want the travel-segment flow between adjacent timeline items to reuse Google Maps directions automatically when possible,
so that I do not need to manually copy duration and distance into the travel dialog for each route.

## Acceptance Criteria

1. Given two adjacent timeline items in day view both have usable locations, when I choose the Google Maps route action from the travel segment between them, then the system uses the previous item as origin and the next item as destination and the travel-segment dialog opens with the route result already filled in when automatic import is supported.
2. Given an automatic route result is successfully retrieved for a car trip, when the dialog opens or refreshes from the Google Maps action, then the duration field is prefilled from that result, the distance field is prefilled from that result, and the Google Maps link for that exact route remains available in the dialog.
3. Given the route cannot be imported automatically because required data is missing or the implementation path is not feasible, when I trigger the Google Maps route action, then I still get the Google Maps directions button or link that existed previously and I can continue the manual workflow of checking Google Maps and entering the values myself.
4. Given one or both adjacent items do not have enough location data for directions, when I open the travel segment, then the automatic Google Maps action is disabled or unavailable and the dialog does not show incorrect prefilled travel values.
5. Given I am editing an existing travel segment that already has saved values, when I trigger the Google Maps route action again, then I can refresh the dialog values from the current adjacent locations without breaking the existing ability to manually edit and save the segment.
6. Given I use the travel-segment dialog on desktop or mobile, when the Google Maps route action or fallback is shown, then the controls remain understandable and usable in both languages and on both screen sizes.

## Tasks / Subtasks

- [x] Task 1: Confirm the delivery path for Google Maps reuse and preserve the fallback manual workflow. (AC: 1, 3, 4)
  - [x] Validate whether the repo can legally and technically auto-fill duration and distance from a supported Google Maps integration path without requiring a brittle scrape of consumer Google Maps pages.
  - [x] If direct auto-import is not practical within current constraints, restore the prior visible Google Maps calculation action so the manual copy workflow is available again from the travel-segment entry point.
  - [x] Keep the origin/destination derivation tied to the adjacent previous/next timeline items introduced in Story 2.23.
- [x] Task 2: Extend the travel-segment dialog/action flow for automatic prefilling where feasible. (AC: 1, 2, 5, 6)
  - [x] Add a visible action in the travel-segment UI that requests route calculation from the adjacent items' locations.
  - [x] Prefill duration and distance for `car` when a route result is available, while keeping manual edits possible before save.
  - [x] Preserve or refresh the generated Google Maps link so the user can still inspect the route externally.
- [x] Task 3: Handle unavailable or partial route data safely. (AC: 3, 4, 5)
  - [x] Do not overwrite saved manual values with empty or invalid route results.
  - [x] Show a localized helper/error state when automatic import cannot run and route the user to the manual Google Maps fallback instead.
  - [x] Keep non-car transport handling coherent; if the auto-fill path is car-only, make that explicit in the UI and avoid populating incompatible fields for ship/flight.
- [x] Task 4: Add localization and regression coverage for the new route action and fallback behavior. (AC: 1, 2, 3, 4, 5, 6)
  - [x] Update `travelplan/src/i18n/en.ts` and `travelplan/src/i18n/de.ts` with labels, helper copy, and fallback/error states.
  - [x] Add dialog tests covering prefill success, missing-location disablement, and fallback manual behavior.
  - [x] Add route or integration tests for any new server/API layer introduced to support automatic route import.

## Dev Notes

### Developer Context

Story 2.23 introduced travel segments with manual duration/distance entry and a generated Google Maps directions link built from adjacent item locations. The user reports that an earlier version exposed a more explicit Google Maps calculation action, where the previous adjacent item and next adjacent item were used as start and end points and the user manually copied the route details back into the dialog.

Story 6.5 should restore that ease of use. The preferred outcome is automatic prefilling of duration and distance into the travel-segment dialog after invoking the Google Maps route action. If that requires an unstable or unsupported integration path, the story still succeeds by reintroducing the dedicated Google Maps calculation action and preserving the manual copy workflow.

The key product requirement is not "Google branding in the UI"; it is reducing friction when planning travel between adjacent items. Stay focused on adjacent-item origin/destination derivation, safe prefilling, and a reliable fallback rather than over-expanding into a full routing engine story.

### Technical Requirements

- Reuse the existing adjacent-item location logic already present in `TripDayTravelSegmentDialog.tsx` via `buildGoogleMapsLink(fromItem, toItem)`.
- Do not scrape consumer Google Maps HTML pages in the browser or server as the primary implementation; use only a stable supported integration path if automatic import is attempted.
- Preserve current travel-segment persistence and validation rules from Story 2.23:
  - duration is required
  - distance is required only for `car`
  - manual edits remain allowed before save
- Keep the existing `linkUrl` field behavior so a Google Maps directions URL can still be stored even when values are manually edited.
- If an automatic import path needs a server endpoint, keep it narrow and read-only for route lookup; do not entangle it with travel-segment CRUD.
- If no supported auto-import path is available in the current stack/configuration, explicitly implement the manual fallback UX rather than leaving the user with only a plain link field.

### Architecture Compliance

- Primary UI seam: `travelplan/src/components/features/trips/TripDayTravelSegmentDialog.tsx`
- Travel-segment entry-point state: `travelplan/src/components/features/trips/TripDayView.tsx`
- Existing persistence/API contract: `travelplan/src/app/api/trips/[id]/travel-segments/route.ts`
- Existing validation/repository references: `travelplan/src/lib/validation/travelSegmentSchemas.ts`, `travelplan/src/lib/repositories/travelSegmentRepo.ts`
- Keep any new route-lookup code isolated from the CRUD route unless there is a compelling architecture reason to share a helper.

### Library / Framework Requirements

- Stay on the current pinned stack in `travelplan/package.json`, especially `next@16.1.6`, `react@19.2.3`, and `@mui/material@7.3.8`.
- Reuse current React/MUI dialog and button patterns already used in the travel-segment editor.
- Do not add a dependency that only exists to scrape or automate Google Maps pages.

### File Structure Requirements

- Primary UI change: `travelplan/src/components/features/trips/TripDayTravelSegmentDialog.tsx`
- Day-view wiring if needed: `travelplan/src/components/features/trips/TripDayView.tsx`
- Localized copy: `travelplan/src/i18n/en.ts`, `travelplan/src/i18n/de.ts`
- Existing dialog coverage to extend: `travelplan/test/travelSegmentDialog.test.tsx`
- Existing day-view coverage to extend: `travelplan/test/tripDayViewLayout.test.tsx`
- Add a focused route test only if a new route-lookup endpoint is introduced.

### Testing Requirements

- UI test: adjacent items with locations expose the Google Maps route action and keep the directions link available.
- UI test: successful route-prefill flow updates duration and distance defaults before save.
- UI test: missing-location pairs disable or hide the auto-fill action and leave manual fields untouched.
- UI test: fallback manual mode still exposes a Google Maps action/link when automatic import is unavailable.
- UI test: editing an existing segment can refresh from the current adjacent route without breaking manual edits or save.
- Manual check: German and English labels are understandable and the dialog remains usable on mobile widths.

### Previous Story Intelligence

- Story 2.23 already established the adjacent-item model and the generated Google Maps directions link; build on that instead of inventing a new route source.
- Story 2.24 and Story 2.29 already depend on travel-segment duration semantics, so any prefill change must continue to produce the same valid duration data expected by time tags and gantt calculations.
- Story 5.4 widened contributor editing permissions to travel segments, so any new route action should respect the same authorization boundaries as existing segment editing.

### Git Intelligence Summary

- The current implementation already contains a `mapsLink` derived from adjacent items, but there is no dedicated route-calculation action and no automatic duration/distance import.
- The lowest-risk implementation starts in `TripDayTravelSegmentDialog.tsx`, where the dialog already initializes default values and can safely host a refresh/prefill action.
- Existing automated coverage already exercises dialog save behavior and day-view travel-segment updates; extend those suites instead of creating an isolated testing strategy.

### Latest Tech Information

- No external research was performed for this story context. Treat any automatic Google Maps import path as implementation-dependent and validate it against supported APIs, current project configuration, and legal constraints before coding it.

### Project Context Reference

No `project-context.md` file was found in this repository.

### References

- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/epics.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/architecture.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/prd.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/ux-design-specification.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/2-23-day-view-travel-segments-between-items.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/2-24-travel-segment-time-tags.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/2-29-day-plan-gannt.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/5-4-contributor-full-edit-permissions.md`
- `/Users/tommy/Development/TravelPlan/travelplan/src/components/features/trips/TripDayTravelSegmentDialog.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/src/components/features/trips/TripDayView.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/test/travelSegmentDialog.test.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/test/tripDayViewLayout.test.tsx`

## Story Completion Status

- Status set to **done**.
- Completion note: Google Maps route actions now auto-prefill car travel segments through a narrow route-preview endpoint, while preserving localized manual fallback behavior and editable saved values.

## Dev Agent Record

### Agent Model Used

Codex (GPT-5)

### Debug Log References

- User requested a new Epic 6 story to restore or improve the Google Maps travel-calculation flow between adjacent day-view items.
- Existing Epic 6 backlog, Story 2.23 travel-segment context, sprint tracker, and current day-view/dialog implementation seams were reviewed before drafting the story.
- Current implementation confirmed to derive a Google Maps directions URL from `fromItem` and `toItem`, but not to import duration or distance automatically.
- Story was intentionally scoped with a preferred automatic-prefill outcome and an explicit manual-workflow fallback to avoid blocking delivery on unsupported integration details.
- Confirmed the repo already had a stable OSRM-backed routing service, so automatic prefilling was implemented through a new read-only travel-segment route-preview endpoint instead of any Google Maps scraping path.
- Full regression suite passed after the dialog, i18n, and route-preview changes; repo lint completed with only pre-existing warnings outside this story's scope.

### Completion Notes List

- Added Story 6.5 to Epic 6 in `epics.md` with acceptance criteria covering automatic prefilling, exact-route Google Maps reuse, missing-location behavior, and fallback manual workflow.
- Created the ready-for-dev implementation context file for `6-5-auto-fill-travel-segments-from-google-maps` anchored to the existing travel-segment dialog and day-view wiring.
- Registered the story in the sprint tracker as the next Epic 6 backlog item with status `ready-for-dev`.
- Preserved an explicit guardrail against brittle Google Maps scraping and directed implementation toward supported integration or the restored manual button path.
- Added a `route-preview` API under `travelplan/src/app/api/trips/[id]/travel-segments/route-preview/route.ts` that returns duration and distance from the existing OSRM routing service for authorized users.
- Updated `TripDayTravelSegmentDialog.tsx` to expose calculate/refresh Google Maps actions, prefill `car` duration and distance on successful route lookup, preserve the generated Google Maps link, and keep localized fallback/helper states for missing data or unsupported transport types.
- Added English and German travel-segment copy for the new route actions and fallback states, plus regression coverage for dialog behavior and the new route-preview endpoint.
- Code review fixes added a dedicated Google Maps route action at the day-view entry point, preserved imported routes with sampled Google Maps waypoints, and rejected partial route-prefill payloads instead of mixing stale and fresh values.
- Added regression coverage for the new day-view route action handoff and for partial route-preview fallback behavior.

## File List

- _bmad-output/implementation-artifacts/6-5-auto-fill-travel-segments-from-google-maps.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- travelplan/src/app/api/trips/[id]/travel-segments/route-preview/route.ts
- travelplan/src/components/features/trips/TripDayTravelSegmentDialog.tsx
- travelplan/src/i18n/de.ts
- travelplan/src/i18n/en.ts
- travelplan/src/lib/validation/travelSegmentRouteLookupSchemas.ts
- travelplan/test/travelSegmentDialog.test.tsx
- travelplan/test/tripDayViewLayout.test.tsx
- travelplan/test/travelSegmentRoutePreview.test.ts

### Change Log

- 2026-03-13: Added Story 6.5 "Auto-Fill Travel Segments From Google Maps", created the ready-for-dev context story, and registered the story in sprint tracking.
- 2026-03-13: Implemented Google Maps route actions with OSRM-backed car prefill, localized fallback messaging, and route-preview regression coverage; story moved to review.
- 2026-03-13: Applied code-review fixes for entry-point route prefilling, route-specific Google Maps link preservation, and partial-route fallback safety; extended dialog and day-view regression coverage.
