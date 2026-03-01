# Story 2.25: Copy Accommodation From Previous Night

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner,
I want to copy the previous night’s accommodation into the current night,
so that I can quickly apply the same stay across multiple days without re-entering details.

## Acceptance Criteria

1. **Given** I am viewing a trip day in day view  
   **When** a previous-night accommodation exists and the current night has no accommodation  
   **Then** I can trigger a “Copy previous night” action for the current night
2. **Given** I use “Copy previous night”  
   **When** the action completes  
   **Then** the current-night accommodation is created/updated with the previous night’s details
3. **Given** the accommodation is copied  
   **When** the new current-night accommodation is created  
   **Then** the cost is **not** copied (cost remains empty/null)
4. **Given** the previous-night accommodation includes optional fields (link, notes, status, check-in/out times, location)  
   **When** the copy completes  
   **Then** those fields are copied to the current night except cost
5. **Given** there is no previous-night accommodation  
   **When** I view the current-night accommodation area  
   **Then** the copy action is not shown or is disabled
6. **Given** a current-night accommodation already exists  
   **When** I view the current-night accommodation area  
   **Then** the copy action is not shown (remove the current-night stay to enable copy)
7. **Given** I copy an accommodation  
   **When** I return to day view  
   **Then** the timeline reflects the updated current-night accommodation without a full refresh

## Tasks / Subtasks

- [x] UI: add “Copy previous night” action in current-night accommodation section (AC: 1, 5, 6)
- [x] API/repo: add server-side copy operation scoped to day+user (AC: 2)
- [x] Copy rules: clone all accommodation fields except cost (AC: 3-4)
- [x] Update day view state after copy without full refresh (AC: 7)

## Dev Notes

- Use existing accommodation edit/save flow and day view data refresh patterns.
- The copy action should be a small secondary/tertiary button near the current-night accommodation header/actions.
- The copy should be allowed only when a previous-night accommodation exists and user has edit permissions.
- Preserve UX consistency with other day view actions and avoid adding new dialogs unless necessary.

### Project Structure Notes

- UI: `travelplan/src/components/features/trips/TripDayView.tsx` and related accommodation dialog if needed.
- API: add a dedicated route under `travelplan/src/app/api/trips/[id]/accommodations/*` or reuse existing action patterns.
- Repo: `travelplan/src/lib/repositories/accommodationRepo.ts` for copy helper.
- Validation: add/extend Zod schema under `travelplan/src/lib/validation/*` if new endpoint required.

### References

- `_bmad-output/implementation-artifacts/2-5-add-or-update-nightly-accommodation.md` (accommodation day view flow)
- `_bmad-output/implementation-artifacts/2-6-track-accommodation-status-cost-and-link.md` (fields and persistence)
- `_bmad-output/implementation-artifacts/2-22-accommodation-check-in-and-check-out-times.md` (time fields)
- `_bmad-output/planning-artifacts/architecture.md` (project structure and API patterns)
- `_bmad-output/planning-artifacts/ux-design-specification.md` (button hierarchy, day view patterns)

## Technical Requirements

- Copy source is the previous-night accommodation for the current day (same day view context).
- Copy all fields except `costCents` (set to null/empty).
- Preserve `status`, `link`, `notes`, `checkInTime`, `checkOutTime`, and `location` if present.
- Ensure the copy operation respects trip ownership and day scoping.
- Keep response shape consistent with existing `{ data, error }` envelope.

## Architecture Compliance

- Use repository layer for data access; do not bypass with direct Prisma calls in API.
- Keep API routes under `app/api/**/route.ts` and validation in `lib/validation/*`.
- Preserve existing camelCase JSON and ISO date conventions.

## Library & Framework Requirements

- Material UI for UI controls.
- Zod for validation if adding a new API endpoint.
- No new dependencies.

## File Structure Requirements

- Keep UI updates within existing trip/day feature modules.
- Keep tests under `travelplan/test/` with existing patterns.

## Testing Requirements

- UI: verify copy action visibility rules and successful copy behavior in day view.
- API: copy endpoint returns updated accommodation and respects access control.
- Regression: ensure cost is not copied while other fields are.

## Previous Story Intelligence

- Story 2.5 established accommodation CRUD and day view flow.
- Story 2.6 defined accommodation fields (status, cost, link) and their display.
- Story 2.22 introduced check-in/out times in day view and defaults.

## Git Intelligence Summary

- Recent work focuses on day view enhancements; keep this feature localized and avoid broad refactors.
- Follow existing API/repo patterns for day view updates.

## Project Context Reference

- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/epics.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/architecture.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/prd.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/ux-design-specification.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/2-5-add-or-update-nightly-accommodation.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/2-6-track-accommodation-status-cost-and-link.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/2-22-accommodation-check-in-and-check-out-times.md`

## Story Completion Status

- Status set to **review**.
- Completion note: Copy-from-previous-night accommodation defined with cost exclusion and day view UX scope.

## Dev Agent Record

### Agent Model Used

Codex (GPT-5)

### Debug Log References

- Built story context for accommodation copy action and field rules.

### Completion Notes List

- Copy action defined in day view with overwrite behavior and cost exclusion.
- API/repo pattern required for secure copy operation.
- Tests required for visibility, access, and field copying.
- Added current-night copy action button gated by previous-night stay presence.
- Added UI tests for copy-action visibility.
- Added repository copy helper and API endpoint for previous-night copy.
- Added repo and API route tests for copy operation.
- Updated copy behavior to exclude cost while preserving optional fields.
- Wired copy action to call API and update day view state without reload.
- Added UI coverage for post-copy state update.
- Tests: `npm test`; `npm test -- tripDayViewLayout.test.tsx`; `npm test -- accommodationRepo.test.ts tripAccommodationCopyRoute.test.ts`.
- Restricted copy action visibility to only show when current-night accommodation is empty.
- Adjusted AC6 to keep copy action hidden when a current-night stay exists.
- Allowed previous-day index 0 during copy and added repo coverage.
- Added copy route access-control tests (unauthorized, csrf, non-owner).
- Out-of-scope workspace changes present (not part of this story): `.codex/*`, `_bmad-output/implementation-artifacts/2-27-change-font.md`.

### File List

- `_bmad-output/implementation-artifacts/2-25-copy-accommodation-from-previous-night.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `travelplan/src/components/features/trips/TripDayView.tsx`
- `travelplan/src/i18n/en.ts`
- `travelplan/src/i18n/de.ts`
- `travelplan/test/tripDayViewLayout.test.tsx`
- `travelplan/src/lib/repositories/accommodationRepo.ts`
- `travelplan/src/lib/validation/accommodationSchemas.ts`
- `travelplan/src/app/api/trips/[id]/accommodations/copy/route.ts`
- `travelplan/test/accommodationRepo.test.ts`
- `travelplan/test/tripAccommodationCopyRoute.test.ts`
