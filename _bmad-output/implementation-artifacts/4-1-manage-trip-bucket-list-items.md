# Story 4.1: Manage Trip Bucket List Items

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner, I want to add, view, and delete bucket list items at the trip level so that I can capture ideas without assigning them to a specific day yet.

## Acceptance Criteria

1. Given I am viewing a trip overview, when I open the bucket list view, then I see existing bucket list items ordered alphabetically by title.
2. Given I add a bucket list item with title, description, and position text, when I save the item, then the item is added to the bucket list and the app attempts to geocode the position text.
3. Given the position text cannot be geocoded, when I save the item, then the position text is retained and the item is saved without lat/long.
4. Given I delete a bucket list item, when I confirm deletion, then the item is removed from the bucket list.

## Tasks / Subtasks

- [x] Task 1: Data model + migration for trip-level bucket list items.
- [x] Task 2: Repository functions for list, create, update, delete with alphabetical ordering.
- [x] Task 3: API routes under `/api/trips/[id]/bucket-list-items` with CSRF on mutations, ApiEnvelope responses, and validation.
- [x] Task 4: UI bucket list view on trip overview with add/edit dialog, delete confirmation, and geocode lookup via `/api/geocode`.
- [x] Task 5: i18n strings for bucket list labels, errors, and empty states in `en.ts` and `de.ts`.
- [x] Task 6: Tests for repository + API route behaviors and ordering.

## Dev Notes

### Developer Context

Bucket list items are a trip-level collection shown from the trip overview. The existing codebase uses Next.js App Router API routes, Prisma repositories, MUI UI components, and client-side fetch with ApiEnvelope responses. Geocoding already exists via `/api/geocode` (Nominatim), and location inputs are normalized through `locationInputSchema`. Follow existing patterns used by day plan items and accommodations for form handling, CSRF, and location search. The trip overview UI lives in `TripTimeline.tsx`, which already renders map and day list panels and is the likely host for the bucket list view.

### Technical Requirements

- Add Prisma model for bucket list items tied to `Trip` (tripId FK) with `title`, `description`, `positionText`, optional `locationLat`, `locationLng`, `locationLabel`, and timestamps.
- Store position text even if geocoding fails; lat/lng nullable.
- API must order items alphabetically by title.
- Mutations must enforce CSRF and authenticated user ownership (trip belongs to user).
- Use ApiEnvelope `{ data, error }` responses and `apiError` codes consistent with existing routes.
- Validate payloads with Zod schemas (title required, max lengths, optional description/position text, optional location object).
- UI should surface empty state, list items, and allow add/edit/delete.

### Architecture Compliance

- DB naming: `snake_case` columns and plural table name.
- API JSON: `camelCase` fields; error envelope matches `{ data: null, error }`.
- Files: API under `src/app/api/**/route.ts`, repos under `src/lib/repositories`, validation under `src/lib/validation`.
- Use existing CSRF utilities in `src/lib/security/csrf`.
- Keep dates as ISO 8601 UTC strings on API responses.

### Library / Framework Requirements

- Continue using MUI components and styling patterns already in trip overview UI.
- Use React Hook Form for dialog inputs if consistent with existing dialogs (TripCreate, TripEdit, TripAccommodation).
- Reuse existing location search UX from trip create / plan dialog with `/api/geocode`.

### File Structure Requirements

- `travelplan/prisma/schema.prisma` for new model and migration.
- `travelplan/src/lib/repositories/bucketListRepo.ts` (new) or similar naming aligned with existing repos.
- `travelplan/src/lib/validation/bucketListSchemas.ts` (new).
- `travelplan/src/app/api/trips/[id]/bucket-list-items/route.ts` (new).
- `travelplan/src/components/features/trips/TripBucketListPanel.tsx` (new) and integrate into `travelplan/src/components/features/trips/TripTimeline.tsx`.
- `travelplan/src/i18n/en.ts` and `travelplan/src/i18n/de.ts` for labels/messages.
- `travelplan/test/*` for repo/route/UI tests following existing patterns.

### Testing Requirements

- Repository unit test for alphabetical ordering and CRUD (`travelplan/test/bucketListRepo.test.ts`).
- Route tests for list/create/delete validation and ownership (`travelplan/test/bucketListRoute.test.ts`).
- UI test for empty state and list rendering if time allows (`travelplan/test/tripBucketListPanel.test.tsx`).

### Previous Story Intelligence

No previous story in Epic 4. This is the first story for bucket list functionality.

### Git Intelligence Summary

Recent commits touched trip overview and day view components (`TripTimeline.tsx`, `TripDayView.tsx`, map panels, gantt). Follow existing visual structure, Paper styling, and i18n patterns used there for consistent UI. Recent tests exist for timeline and map panels; mirror these patterns for bucket list tests.

### Latest Tech Information

- Material UI current stable is v7.3.8; stick to the current v7 series already in `package.json`.
- Leaflet 2.0 is still alpha and introduces breaking changes (ESM-only, no global `L`); stay on Leaflet 1.9.x for production stability.
- Nominatim public API requires a custom User-Agent/Referer and a hard limit of 1 request/sec; ensure UI geocoding calls remain lightweight and use the existing server route that sets a custom UA.

### Project Context Reference

No `project-context.md` found in the repository.

### Project Structure Notes

- Actual codebase is under `travelplan/src` (no Redux store folder). Trip overview UI is `TripTimeline.tsx` and map panels are in `components/features/trips`.
- Validation schemas live under `src/lib/validation` and routes return ApiEnvelope via `src/lib/http/response`.

### References

- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/epics.md` (Epic 4, Story 4.1 acceptance criteria)
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/prd.md` (FR30/FR31, idea capture scope)
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/architecture.md` (stack, naming, API envelope)
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/ux-design-specification.md` (overview-first UX, navigation rail patterns)
- `/Users/tommy/Development/TravelPlan/travelplan/src/components/features/trips/TripTimeline.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/src/app/api/geocode/route.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/lib/validation/locationSchemas.ts`

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

### Implementation Plan

- Add `TripBucketListItem` model to Prisma schema with snake_case mappings and FK to `Trip`.
- Create SQLite migration for `trip_bucket_list_items` table with index on `trip_id`.
- Add repository CRUD + ordering for bucket list items and corresponding tests.
- Add bucket list validation schemas and API route with CSRF + ApiEnvelope responses.
- Add trip overview bucket list panel with add/edit/delete + geocode lookup.
- Add bucket list i18n strings in English/German dictionaries.

### Completion Notes List

- Task 1: Added trip bucket list model + migration; ran `npm test`.
- Task 2: Added bucket list repo + tests; ran `npm test`.
- Task 3: Added bucket list API route + validation + route tests; ran `npm test`.
- Task 4: Added trip bucket list panel + dialog + delete confirmation; ran `npm test`.
- Task 5: Added bucket list i18n strings; ran `npm test`.
- Task 6: Confirmed repo + route tests for bucket list behaviors and ordering; ran `npm test`.
- Bucket list save now attempts geocode when position text is provided; persists text without coords if no result.

### File List

- travelplan/prisma/schema.prisma
- travelplan/prisma/migrations/20260301143000_add_trip_bucket_list_items/migration.sql
- travelplan/src/lib/repositories/bucketListRepo.ts
- travelplan/src/lib/validation/bucketListSchemas.ts
- travelplan/src/app/api/trips/[id]/bucket-list-items/route.ts
- travelplan/test/bucketListRepo.test.ts
- travelplan/test/bucketListRoute.test.ts
- travelplan/src/components/features/trips/TripBucketListPanel.tsx
- travelplan/src/components/features/trips/TripTimeline.tsx
- travelplan/test/tripTimelinePlan.test.tsx
- travelplan/src/i18n/en.ts
- travelplan/src/i18n/de.ts
- travelplan/src/generated/prisma/browser.ts
- travelplan/src/generated/prisma/client.ts
- travelplan/src/generated/prisma/internal/class.ts
- travelplan/src/generated/prisma/internal/prismaNamespace.ts
- travelplan/src/generated/prisma/internal/prismaNamespaceBrowser.ts
- travelplan/src/generated/prisma/models.ts
- travelplan/src/generated/prisma/models/Trip.ts
- travelplan/src/generated/prisma/models/TripBucketListItem.ts
### Story Completion Status

Status set to **review**.
