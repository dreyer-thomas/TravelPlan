# Story 2.3: Edit or Delete Trip Details

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner,
I want to edit or delete a trip,
so that I can keep my plans accurate and clean.

## Acceptance Criteria

1. **Given** I am viewing a trip
   **When** I update the trip name or date range
   **Then** the trip is updated
   **And** the day entries are adjusted to match the new date range
2. **Given** I delete a trip
   **When** I confirm deletion
   **Then** the trip and all its associated data are removed

## Story Requirements

- Implement the user-requested UX change to reduce emphasis on the trip creation form.
- The trips page should primarily show existing trips; creation happens in a modal dialog opened by an explicit action.
- Provide an “Add trip” button that opens a dialog (name + date range).
- If there are no trips, show an empty-state message that explains how to add one.
- Keep the current create-trip API, validation, and CSRF flow unchanged.
- Keep list ordering by start date (ascending), matching existing behavior.
- NOTE: This story now includes a UI change not explicitly captured in the epic text; create a follow-up story if edit/delete functionality is still required after this UX change.

## Tasks / Subtasks

- [x] Replace inline create form on the trips dashboard with an “Add trip” button.
- [x] Add a modal dialog that contains the trip creation form (name + start/end dates).
- [x] Ensure modal manages focus, close behavior (escape + close button), and submission states.
- [x] Update empty state copy to instruct how to add a trip.
- [x] Verify that successful creation closes the dialog and updates the list.

## Dev Notes

- Current implementation renders `TripCreateForm` directly in `TripsDashboard` above the list. The request is to move this into a dialog and make the list the primary focus. (Sources: `TripsDashboard`, `TripCreateForm`)
- MUI is the baseline design system; use its `Dialog`/`DialogTitle`/`DialogContent`/`DialogActions` and button hierarchy. (Source: UX spec, Architecture)
- UX patterns: modal dialog with clear primary action, focus trapping, and empty-state guidance are explicitly recommended. (Source: UX spec)

### Project Structure Notes

- Feature UI components live under `src/components/features/trips/*`.
- Route page uses `src/app/(routes)/trips/page.tsx` and renders `TripsDashboard`.

### References

- `/Users/tommy/Development/TravelPlan/travelplan/src/components/features/trips/TripsDashboard.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/src/components/features/trips/TripCreateForm.tsx`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/ux-design-specification.md#Modal and Overlay Patterns`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/ux-design-specification.md#Empty and Loading States`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/architecture.md#Frontend Architecture`

## Developer Context

- The `TripsDashboard` currently renders creation form + list; update the layout so the list is the main focus, with a single primary CTA to add a trip.
- The create flow uses CSRF via `/api/auth/csrf` and POST to `/api/trips`; keep this as-is.
- The list already handles loading, error, and empty states; update empty state copy and add CTA placement.
- For accessibility, the modal must trap focus and allow escape to close, consistent with the UX spec. (Source: UX spec)

## Technical Requirements

- **UI/UX**
  - Replace inline `TripCreateForm` display with a `Button` labeled “Add trip”.
  - Create a `TripCreateDialog` (new component or refactor `TripCreateForm` into a dialog wrapper) that renders the same form fields.
  - Dialog should include:
    - Title: “Create a new trip”
    - Short helper text (re-use existing copy)
    - Primary action: “Create trip”
    - Secondary action: “Cancel”
  - When there are zero trips, display an empty-state message plus the “Add trip” button.
  - On successful creation: close dialog, clear form, and update the list.

- **Data / API**
  - No changes to API routes or repository functions.
  - Continue to use `GET /api/trips` for list refresh and `POST /api/trips` for creation.

- **State & Error Handling**
  - Preserve existing error and success messages inside the dialog.
  - If CSRF initialization fails, surface the same error in-dialog.

## Architecture Compliance

- Keep API calls in the client component and use existing API envelope `{ data, error }` and error helpers.
- Use Material UI components for dialog and buttons.
- Maintain project structure: components under `src/components/features/trips/*`, routes under `src/app/(routes)/trips/*`.

## Library & Framework Requirements

- **Next.js App Router** only; no legacy pages routing.
- **Material UI** for dialog and buttons.
- **React Hook Form** remains the form handler; do not replace.

## File Structure Requirements

- Update: `/Users/tommy/Development/TravelPlan/travelplan/src/components/features/trips/TripsDashboard.tsx`
- Update or refactor: `/Users/tommy/Development/TravelPlan/travelplan/src/components/features/trips/TripCreateForm.tsx`
- Optional new component: `/Users/tommy/Development/TravelPlan/travelplan/src/components/features/trips/TripCreateDialog.tsx`
- No backend changes expected.

## Testing Requirements

- Manual verification steps (required):
  - Open trips page with zero trips: empty-state text and “Add trip” button visible.
  - Open dialog, validate required fields, create a trip, dialog closes, list updates.
  - Refresh page: trip persists and list is sorted by start date.
- Automated tests (optional): Add a component test for dialog open/close and submit if UI testing setup already exists.

## Previous Story Intelligence

- Trips list already uses MUI `List` and `Paper` components and renders loading/error/empty states in `TripsDashboard`.
- `TripCreateForm` already manages CSRF fetching, client-side validation, and server error mapping; reuse it inside the dialog to avoid duplication.

## Git Intelligence Summary

- Recent commits focus on auth/menu and home content; no recent changes to trip UI. Proceed without expected merge conflicts in trips components.

## Latest Technical Information

- Prisma ORM 7.3.0 release (Jan 21, 2026) includes adapter updates and performance improvements; repo currently pins Prisma 7.3.0 and should remain on that version for this story. citeturn1search0
- MUI npm package page shows `@mui/material` 7.3.2 and `@mui/material-nextjs` 7.3.2; repo currently uses 7.3.8, so do not upgrade in this UI-only story unless explicitly requested. citeturn6search3turn6search2
- React Hook Form npm page shows 7.62.0; repo pins 7.71.1, so keep current version for this story. citeturn5search0
- Zod npm page shows 4.1.5; repo pins 4.1.11, so keep current version for this story. citeturn5search5

## Project Context Reference

- No `project-context.md` found in repo. Use references in `epics.md`, `prd.md`, `architecture.md`, and `ux-design-specification.md`.

## Story Completion Status

- Status set to **review**.
- Completion note: Ultimate context engine analysis completed - comprehensive developer guide created.

## Dev Agent Record

### Agent Model Used

Codex (GPT-5)

### Debug Log References

N/A

### Implementation Plan

- Add edit and delete controls to the trip detail view.
- Implement trip update/delete endpoints with CSRF validation and day-range adjustment.
- Extend trip repository with update/delete helpers.
- Add route/repository tests for update/delete flows.
- Clean up dialog actions to match UX hierarchy.

### Completion Notes List

- Added edit and delete dialogs to the trip timeline view.
- Implemented PATCH/DELETE `/api/trips/[id]` with CSRF validation and day-range regeneration.
- Extended trip repository with update/delete helpers.
- Fixed dialog action hierarchy and ensured success messaging is visible before close.
- Added route/repository tests for update/delete flows.
- Tests: `npm test`.

### File List

- `src/app/(routes)/trips/page.tsx`
- `src/app/api/trips/[id]/route.ts`
- `src/components/features/trips/TripCreateDialog.tsx`
- `src/components/features/trips/TripDeleteDialog.tsx`
- `src/components/features/trips/TripEditDialog.tsx`
- `src/components/features/trips/TripTimeline.tsx`
- `src/lib/repositories/tripRepo.ts`
- `src/lib/validation/tripSchemas.ts`
- `test/tripDetailRoute.test.ts`
- `test/tripRepo.test.ts`

### Change Log

- 2026-02-12: Added edit/delete trip functionality with API support and tests; refined create dialog UX.
