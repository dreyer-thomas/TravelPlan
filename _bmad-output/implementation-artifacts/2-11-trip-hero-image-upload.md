# Story 2.11: Trip Hero Image Upload

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner,
I want to upload a hero image for a trip during creation or editing,
so that the trips overview and trip header feel more visual and recognizable.

## Acceptance Criteria

1. **Given** I create a trip and select a hero image
   **When** the trip is created
   **Then** the image is uploaded to the server and stored for that trip
2. **Given** I edit a trip and upload a new hero image
   **When** I save the change
   **Then** the new image replaces the previous one for that trip
3. **Given** a trip has a hero image
   **When** I view the trips overview or trip detail header
   **Then** the hero image is displayed with a cover crop
4. **Given** a trip has no hero image
   **When** I view the trips overview or trip detail header
   **Then** a default placeholder (world map) is shown

## Story Requirements

- Image source is user upload during trip creation or edit.
- Images are saved on the server in a directory and served as static assets.
- If no image exists, show a placeholder (world map).
- Cropping can be handled via CSS `object-fit: cover` (no user crop UI).

## Tasks / Subtasks

- [x] Add a placeholder asset (world map) in `public/images/`.
- [x] Extend Trip model to store `heroImageUrl` (or `heroImagePath`) and migrate DB.
- [x] Add API endpoint to upload/replace a hero image for a trip.
- [x] Update trip create flow to optionally upload a hero image after creation.
- [x] Update trip edit flow to upload/replace the hero image.
- [x] Return `heroImageUrl` in `GET /api/trips` and `GET /api/trips/[id]`.
- [x] Update trips overview to render hero images (with placeholder fallback).
- [x] Update trip detail header to render hero image (with placeholder fallback).
- [x] Add tests for upload validation and API responses.

## Dev Notes

- Use `request.formData()` in App Router API to handle file uploads.
- Use `fs/promises` and `path` to write to disk. Ensure runtime is Node (`export const runtime = "nodejs"`).
- Store files under `public/uploads/trips/<tripId>/hero.<ext>` so they are served at `/uploads/trips/<tripId>/hero.<ext>`.
- Validate file type (`image/jpeg`, `image/png`, `image/webp`) and size (suggest 5MB limit).
- On replace: overwrite existing file; keep only one hero image per trip.
- On trip delete: remove the associated upload directory (best-effort cleanup).

## Developer Context

- Trips list and trip detail already exist (`TripsDashboard`, `TripTimeline`).
- The create flow is JSON-based today; handle uploads via a follow-up call after creation.
- Authentication is required for all `/trips/**` routes and API endpoints.
- API responses use the `{ data, error }` envelope.

## Technical Requirements

- **DB**
  - Add `heroImageUrl` (string, nullable) to Trip.
  - Store a relative URL (e.g., `/uploads/trips/<tripId>/hero.jpg`).
- **API**
  - Add `POST /api/trips/[id]/hero-image`:
    - Accepts multipart form data with `file`.
    - Validates file type and size.
    - Writes file to `/public/uploads/trips/<tripId>/hero.<ext>`.
    - Updates `heroImageUrl` on Trip.
    - Returns updated trip summary including `heroImageUrl`.
  - Update `GET /api/trips` and `GET /api/trips/[id]` to include `heroImageUrl`.
- **UI**
  - Trip create dialog: add optional file input; after create, upload if file selected.
  - Trip edit dialog: add file input to replace hero image.
  - Trips overview: show thumbnail image in each trip list card.
  - Trip detail header: show a wide hero image header area.
  - Fallback to placeholder if `heroImageUrl` is null.

## Architecture Compliance

- API routes under `src/app/api/**/route.ts`.
- DB access via `src/lib/repositories/*`.
- Use existing API error helpers and response envelope.

## Library & Framework Requirements

- **Next.js App Router** with `request.formData()`.
- **Material UI** for layout and components.
- No new upload library required unless absolutely necessary.

## File Structure Requirements

- New API route: `src/app/api/trips/[id]/hero-image/route.ts`.
- Update repo: `src/lib/repositories/tripRepo.ts`.
- Update UI: `TripsDashboard`, `TripTimeline`, `TripCreateForm`, `TripEditDialog`.
- Add placeholder asset in `public/images/`.

## Testing Requirements

- API test: rejects unauthenticated upload (401).
- API test: rejects invalid file types or oversized files (400).
- API test: successful upload returns updated `heroImageUrl`.
- UI smoke test: placeholder shown when `heroImageUrl` is null.

## Project Context Reference

- Use existing auth session checks and API envelope patterns from `src/app/api/trips/*`.

## Story Completion Status

- Status set to **ready-for-dev**.
- Completion note: Story drafted with upload, storage, and UI requirements.

## Dev Agent Record

### Agent Model Used

Codex (GPT-5)

### Debug Log References

N/A

### Completion Notes List

- Added new trip hero image upload story with DB, API, UI, and testing scope.
- Added world map placeholder asset and a smoke test asserting the placeholder file exists.
- Added `heroImageUrl` to the Trip model with a migration and updated Prisma client/test coverage.
- Added hero image upload API route with validation, storage, and response tests.
- Added optional hero image upload in trip create flow with UI + test coverage.
- Added hero image replacement support in trip edit dialog with tests.
- Added hero image URL in trip list/detail API responses with tests.
- Added hero image thumbnails with placeholder fallback in trips overview plus UI test.
- Added trip detail hero header image with placeholder fallback and test update.
- Added upload validation and API response tests for hero image upload endpoint.
- Code review fixes: verify trip ownership before hero image file I/O, clean up uploads on trip delete, added coverage for cleanup and unauthorized upload safeguards.
- Tests: `npm test -- tripHeroImageRoute.test.ts tripDetailRoute.test.ts`.

### File List

- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/2-11-trip-hero-image-upload.md`
- `/Users/tommy/Development/TravelPlan/travelplan/public/images/world-map-placeholder.svg`
- `/Users/tommy/Development/TravelPlan/travelplan/test/heroImagePlaceholder.test.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/prisma/migrations/20260214173724_add_trip_hero_image/migration.sql`
- `/Users/tommy/Development/TravelPlan/travelplan/prisma/schema.prisma`
- `/Users/tommy/Development/TravelPlan/travelplan/src/generated/prisma/commonInputTypes.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/generated/prisma/enums.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/generated/prisma/internal/class.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/generated/prisma/internal/prismaNamespace.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/generated/prisma/internal/prismaNamespaceBrowser.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/generated/prisma/models/Trip.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/test/tripRepo.test.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/app/api/trips/[id]/hero-image/route.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/lib/repositories/tripRepo.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/test/tripHeroImageRoute.test.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/components/features/trips/TripCreateForm.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/src/i18n/en.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/i18n/de.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/test/tripCreateForm.test.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/src/components/features/trips/TripEditDialog.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/test/tripEditDialogHeroImage.test.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/src/app/api/trips/route.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/app/api/trips/[id]/route.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/lib/repositories/tripRepo.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/test/tripDetailRoute.test.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/test/tripListRoute.test.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/components/features/trips/TripsDashboard.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/test/tripsDashboard.test.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/src/components/features/trips/TripTimeline.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/test/tripTimelinePlan.test.tsx`
