# Story 2.16: Accommodation and Plan Item Image Galleries

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner,
I want to upload images for accommodations and day plan items,
so that day view shows visual context beside each item.

## Acceptance Criteria

1. **Given** I am editing an accommodation or day plan item  
   **When** I upload image files  
   **Then** images are stored and linked to that entity
2. **Given** an accommodation or plan item has no images  
   **When** day view renders  
   **Then** no image block is shown and layout remains clean
3. **Given** an accommodation or plan item has one image  
   **When** day view renders  
   **Then** one thumbnail is shown beside the item
4. **Given** an accommodation or plan item has multiple images  
   **When** day view renders  
   **Then** a mini-strip of up to 3 thumbnails is shown beside the item
5. **Given** an accommodation or plan item has more than 3 images  
   **When** day view renders  
   **Then** the mini-strip shows 3 thumbnails and a `+N` indicator
6. **Given** I remove or reorder images  
   **When** I save changes  
   **Then** day view reflects the updated image set/order
7. **Given** I am not authorized for the trip  
   **When** I try to upload/remove/reorder images  
   **Then** the API blocks the request

## Story Requirements

- Image input is file upload (not URL-only).
- Support `0..n` images for both:
  - nightly accommodation
  - day plan item
- Persist deterministic image order per entity for stable mini-strip rendering.
- Reuse existing upload conventions from Story 2.14 (allowed image types, auth/CSRF patterns, file storage handling).
- Preserve existing accommodation/day-plan CRUD and map/location behavior.

## Tasks / Subtasks

- [ ] Data model and migration (AC: 1, 4, 5, 6)
  - [ ] Add image gallery persistence for accommodation images with ordering.
  - [ ] Add image gallery persistence for day plan item images with ordering.
  - [ ] Keep DB naming snake_case and Prisma mappings consistent with existing schema style.
- [ ] Repository updates (AC: 1, 6, 7)
  - [ ] Add scoped create/list/delete/reorder methods for accommodation images.
  - [ ] Add scoped create/list/delete/reorder methods for day plan item images.
  - [ ] Enforce ownership boundaries via `userId + tripId + dayId + item` scoping.
- [ ] Validation and API routes (AC: 1, 6, 7)
  - [ ] Add Zod schemas for upload/remove/reorder payloads.
  - [ ] Add/extend authenticated, CSRF-protected routes for accommodation image gallery operations.
  - [ ] Add/extend authenticated, CSRF-protected routes for day plan item image gallery operations.
  - [ ] Return API responses in `{ data, error }` envelope.
- [ ] Day view UI rendering (AC: 2, 3, 4, 5, 6)
  - [ ] Render thumbnails beside accommodation entries and plan items in day view timeline.
  - [ ] No images -> render no image block.
  - [ ] One image -> render single thumbnail.
  - [ ] Multiple images -> render mini-strip up to 3 thumbnails + optional `+N`.
  - [ ] Keep responsive behavior clean on mobile and desktop.
- [ ] Edit dialog UX (AC: 1, 6)
  - [ ] Add upload/remove/reorder controls to `TripAccommodationDialog`.
  - [ ] Add upload/remove/reorder controls to `TripDayPlanDialog`.
  - [ ] Keep save/error/loading UX consistent with existing dialogs.
- [ ] i18n and tests (AC: 1-7)
  - [ ] Add EN/DE copy for gallery actions and validation errors.
  - [ ] Add repository tests for ownership + order persistence.
  - [ ] Add route tests for auth/CSRF/validation and happy paths.
  - [ ] Add UI tests for 0/1/many rendering and mini-strip behavior.

## Dev Notes

- Prioritize incremental extension of existing day image upload patterns to avoid duplicate storage logic.
- Keep image rendering lightweight (lazy loading thumbnails).
- Avoid introducing global state; keep dialog/day-view local state patterns consistent with existing implementation.
- Make sure export/import behavior is explicitly considered if image metadata must be included in backups.

## Technical Requirements

- Keep current stack and versions already pinned in repo (`next`, `prisma`, `leaflet`, `mui`) with no dependency upgrades in this story.
- Continue Next.js App Router route handlers under `src/app/api/**/route.ts`.
- Continue Prisma + SQLite conventions and Zod validation.
- Continue authenticated + CSRF-protected state-changing APIs.

## Architecture Compliance

- API JSON camelCase, DB snake_case.
- Repository logic in `src/lib/repositories/*`.
- Validation in `src/lib/validation/*`.
- Trip feature UI in `src/components/features/trips/*`.

## File Structure Requirements

- Update `travelplan/prisma/schema.prisma`
- Add migration under `travelplan/prisma/migrations/*`
- Update/add repositories under `travelplan/src/lib/repositories/`
- Update/add routes under:
  - `travelplan/src/app/api/trips/[id]/accommodations/`
  - `travelplan/src/app/api/trips/[id]/day-plan-items/`
- Update UI:
  - `travelplan/src/components/features/trips/TripAccommodationDialog.tsx`
  - `travelplan/src/components/features/trips/TripDayPlanDialog.tsx`
  - `travelplan/src/components/features/trips/TripDayView.tsx`
- Update i18n:
  - `travelplan/src/i18n/en.ts`
  - `travelplan/src/i18n/de.ts`
- Add/extend tests in `travelplan/test/*`

## Testing Requirements

- Manual:
  - Upload none/one/many images for accommodation and plan item; verify day view output.
  - Reorder images and confirm mini-strip order updates.
  - Remove all images and verify layout returns to no-image state.
- Automated:
  - Repo tests for ownership and ordering.
  - Route tests for auth/CSRF/validation/upload/remove/reorder.
  - UI tests for 0/1/many mini-strip and `+N` indicator behavior.

## Previous Story Intelligence

- Story 2.5 established accommodation CRUD and ownership boundaries.
- Story 2.7 established day plan item CRUD/dialog patterns.
- Story 2.14 established image upload handling patterns and related review fixes.

## Git Intelligence Summary

- Current implementation centralizes day timeline rendering in `TripDayView` and edit flows in `TripAccommodationDialog`/`TripDayPlanDialog`.
- Reusing those files is the lowest-risk path for this change.

## Latest Technical Information

- Keep Leaflet line and map-related dependencies unchanged for this story.
- Keep existing app upload/file handling conventions; no platform migration in this story.

## Project Context Reference

- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/epics.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/prd.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/architecture.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/ux-design-specification.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/2-5-add-or-update-nightly-accommodation.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/2-7-create-and-edit-day-plan-items-with-links.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/2-14-add-image-to-day.md`

## Story Completion Status

- Status set to **ready-for-dev**.
- Completion note: New Epic 2 story created for accommodation/day-plan image galleries with 0/1/many rendering and mini-strip behavior.

## Dev Agent Record

### Agent Model Used

Codex (GPT-5)

### Completion Notes List

- Captured explicit requirement: file upload only (not URL-only).
- Captured explicit gallery requirement: support no image, one image, and multiple images.
- Captured explicit day-view rendering rule: 2-3 thumbnail mini-strip for multi-image items.
- Added sprint tracking entry for Story 2.16 in Epic 2.

### File List

- `_bmad-output/implementation-artifacts/2-16-accommodation-and-plan-item-image-galleries.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
