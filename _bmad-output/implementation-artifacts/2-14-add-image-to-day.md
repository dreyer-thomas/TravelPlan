# Story 2.14: Add Image to Day

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner,
I want to add an image to a trip day,
so that I can visually capture places and plans for that date.

## Acceptance Criteria

1. **Given** I am viewing a specific day detail page
   **When** I upload/select an image for that day
   **Then** the image is saved and displayed on that day
2. **Given** a day already has an image
   **When** I replace or remove it
   **Then** the day reflects the updated image state immediately
3. **Given** I reopen the trip later
   **When** I navigate back to that day
   **Then** the previously saved day image is still present
4. **Given** I am not authorized for the trip
   **When** I try to update a day image
   **Then** the API blocks the request

## Story Requirements

- Day image is attached to `TripDay` (not trip-level hero image).
- Reuse existing image upload/display patterns from Story 2.11 where possible.
- Keep ownership checks at repository and route level.
- Support clear empty state when no day image is set.
- Do not regress day-plan, accommodation, budget, map, or export/import behavior.

## Tasks / Subtasks

- [x] Data model and migration (AC: 1,2,3)
  - [x] Add nullable `imageUrl` on `TripDay` mapped to snake_case DB column.
  - [x] Add Prisma migration and update test fixtures.
- [x] Repository support (AC: 1,2,3,4)
  - [x] Add method to update/remove `TripDay.imageUrl` with `userId + tripId + dayId` ownership constraints.
  - [x] Ensure day detail retrieval includes day image URL.
- [x] Validation schemas (AC: 1,2,4)
  - [x] Add Zod schema for day image update payload.
  - [x] Validate URL length/format and allow `null` for removal.
- [x] API route(s) (AC: 1,2,4)
  - [x] Add/extend day-level route to set/remove image.
  - [x] Preserve auth and CSRF handling for state-changing operations.
- [x] UI day page integration (AC: 1,2,3)
  - [x] Add image upload control in day view header/overview panel.
  - [x] Render image preview with replace/remove actions.
  - [x] Add loading and error states consistent with existing UI patterns.
- [x] i18n updates (AC: 1,2)
  - [x] Add EN/DE keys for day image labels/actions/errors.
- [x] Tests (AC: 1,2,3,4)
  - [x] Repo tests for ownership and update/remove behavior.
  - [x] Route tests for auth/validation/error paths.
  - [x] UI tests for upload, replace, remove, and persisted render.

## Dev Notes

- Keep API JSON camelCase and DB columns snake_case.
- Prefer composition with existing trip image utilities/components to avoid parallel implementations.
- Ensure removed image does not leave stale preview in client state.

## Technical Requirements

- Next.js App Router route handlers only.
- Prisma + SQLite stack remains unchanged.
- Keep API envelope conventions where applicable and existing error behavior consistency.
- Dates continue in ISO 8601 UTC where serialized.

## Architecture Compliance

- API under `src/app/api/**/route.ts`.
- Repository logic under `src/lib/repositories/*`.
- Validation in `src/lib/validation/*`.
- UI in `src/components/features/trips/*`.

## File Structure Requirements

- Update `travelplan/prisma/schema.prisma`
- Add migration under `travelplan/prisma/migrations/*`
- Update/add repository files under `travelplan/src/lib/repositories/`
- Update/add route handlers under `travelplan/src/app/api/trips/[id]/days/[dayId]/`
- Update day view UI in `travelplan/src/components/features/trips/TripDayView.tsx` (or day-image component)
- Update i18n files: `travelplan/src/i18n/en.ts`, `travelplan/src/i18n/de.ts`
- Add/extend tests in `travelplan/test/*`

## Testing Requirements

- Manual:
  - Add image to day, refresh, verify persistence.
  - Replace image and verify preview/source update.
  - Remove image and verify empty state.
- Automated:
  - Repo ownership enforcement.
  - Route auth + validation handling.
  - UI interaction and persisted render.

## Story Completion Status

- Status set to **done**.
- Completion note: Day image support and adversarial code-review fixes implemented and validated across data model, repository, API, UI, i18n, export/import, and tests.

## Dev Agent Record

### Agent Model Used

Codex (GPT-5)

### Debug Log References

- `npm test -- tripRepo.test.ts` (red/green for model + repository support)
- `npm test -- dayImageSchemas.test.ts` (red/green for validation schema)
- `npm test -- tripDayImageRoute.test.ts` (red/green for API route)
- `npm test -- tripDayViewLayout.test.tsx` (red/green for day view image UX)
- `npm test -- tripDayViewLayout.test.tsx tripDayImageRoute.test.ts tripRepo.test.ts dayImageSchemas.test.ts tripDetailRoute.test.ts` (targeted regression)
- `npm test` (full suite: 49 files, 182 tests passing)
- `npm run lint` (passes with existing baseline warnings unrelated to this story)

### Implementation Plan

- Add `TripDay.imageUrl` as nullable persisted field and migrate SQLite schema.
- Extend repository contract to update/remove day image with strict `userId + tripId + dayId` ownership scoping.
- Add day-image payload validation (`url | null`) with bounded length.
- Add day-level API route for state-changing image updates with auth + CSRF + envelope consistency.
- Integrate day image preview/edit/remove controls in `TripDayView` with optimistic local state updates and error handling.
- Add EN/DE i18n strings and comprehensive repo/route/UI tests for AC 1-4.

### Completion Notes List

- Added `image_url` persistence for `TripDay` in Prisma schema and migration `20260215003300_add_trip_day_image`.
- Added repository support in `tripRepo`:
  - day detail now includes `day.imageUrl`
  - new `updateTripDayImageForUser(...)` enforces ownership constraints.
- Added validation schema `dayImageUpdateSchema` (`imageUrl: string(url,max 2000) | null`).
- Added API handler `PATCH /api/trips/[id]/days/[dayId]/image` with auth, CSRF, validation, and not-found ownership protection.
- Updated trip detail API mapping to return `day.imageUrl` in day payload.
- Added day image UI controls in `TripDayView`:
  - persisted preview render,
  - replace via file upload + save action,
  - remove action to clear image,
  - loading/error handling consistent with existing day view patterns.
- Added EN/DE i18n keys for day image labels/actions/errors.
- Added automated tests:
  - repo tests for update/remove/ownership and detail exposure,
  - route tests for auth/csrf/validation/not-found/success,
  - UI test for persisted render + replace + remove flow.

## File List

> Note: This File List is scoped to Story 2.14 implementation files; the branch currently also contains unrelated in-progress changes for other stories.

- `_bmad-output/implementation-artifacts/2-14-add-image-to-day.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `travelplan/prisma/schema.prisma`
- `travelplan/prisma/migrations/20260215003300_add_trip_day_image/migration.sql`
- `travelplan/src/lib/repositories/tripRepo.ts`
- `travelplan/src/lib/validation/dayImageSchemas.ts`
- `travelplan/src/lib/validation/tripImportSchemas.ts`
- `travelplan/src/app/api/trips/[id]/route.ts`
- `travelplan/src/app/api/trips/[id]/days/[dayId]/image/route.ts`
- `travelplan/src/components/features/trips/TripDayView.tsx`
- `travelplan/src/i18n/en.ts`
- `travelplan/src/i18n/de.ts`
- `travelplan/test/tripRepo.test.ts`
- `travelplan/test/dayImageSchemas.test.ts`
- `travelplan/test/tripDayImageRoute.test.ts`
- `travelplan/test/tripDayViewLayout.test.tsx`
- `travelplan/test/tripImportSchemas.test.ts`

## Change Log

- 2026-02-15: Implemented Story 2.14 day image support across Prisma model/migration, repository, validation, API route, day view UI, i18n, and automated tests; set story status to `review`.
- 2026-02-15: Code review auto-fixes applied for Story 2.14: export/import now includes day image/note, upload-note validation now returns errors (no silent truncation), PATCH cleanup now removes stale local upload files when switching to external URLs, and implementation notes corrected to file-upload behavior.
- 2026-02-15: Story status moved to `done` after code-review fixes and targeted regression suite pass.

## Senior Developer Review (AI)

- Review outcome: **Approved after fixes**.
- High issue fixed: day image/day note are now exported and imported, preventing backup/restore data loss.
- Medium issues fixed:
  - upload-note validation now rejects out-of-range values instead of silent truncation,
  - stale local upload cleanup now runs when switching from local upload image to external URL,
  - implementation note corrected from URL-replace claim to file-upload behavior,
  - File List scope clarified for mixed-story branch context.
- Verification run: `npm test -- tripRepo.test.ts tripDayImageRoute.test.ts tripImportSchemas.test.ts dayImageSchemas.test.ts tripDayViewLayout.test.tsx` (47/47 passing).
