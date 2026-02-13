# Story 2.5: Add or Update Nightly Accommodation

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner,
I want to add or update one accommodation per night,
so that each night in the trip is covered.

## Acceptance Criteria

1. **Given** I am viewing a trip day  
   **When** I add an accommodation for that night  
   **Then** the accommodation is saved and linked to that night
2. **Given** an accommodation exists for the night  
   **When** I update it  
   **Then** the changes are saved
3. **Given** an accommodation exists for the night  
   **When** I remove it  
   **Then** the night is marked as missing accommodation

## Story Requirements

- Each trip day supports at most one accommodation entry (1:1 with `trip_days`).
- Users can create, edit, and remove the accommodation for a specific day.
- Removing an accommodation must immediately mark the day as missing accommodation (gap badge logic remains accurate).
- Do not introduce new navigation routes; extend the existing trip day view/timeline.
- Show accommodation presence status in the day view list only if already implemented by story 2.4 (reuse gap badges).
- Respect data naming conventions: DB snake_case, API JSON camelCase, ISO 8601 UTC dates.

## Tasks / Subtasks

- [x] Data model: add minimal accommodation details (AC: 1,2)
  - [x] Add required `name` field to `Accommodation` (mapped to `property_name`)
  - [x] Add optional `notes` field (mapped to `notes`) for freeform context (keep small)
- [x] Repository: accommodation CRUD scoped to user + trip + day (AC: 1,2,3)
  - [x] Add `lib/repositories/accommodationRepo.ts` with create/update/delete by `tripDayId`
  - [x] Validate `tripDayId` belongs to `tripId` and `userId`
- [x] API: accommodations endpoint (AC: 1,2,3)
  - [x] Add `POST /api/trips/[id]/accommodations` to create an accommodation for a day
  - [x] Add `PATCH /api/trips/[id]/accommodations` to update the accommodation for a day
  - [x] Add `DELETE /api/trips/[id]/accommodations` to remove the accommodation for a day
  - [x] All state-changing routes require CSRF validation
- [x] API: return accommodation in trip detail (AC: 1,2)
  - [x] Extend `GET /api/trips/[id]` response with `accommodation` per day (id + name + notes)
- [x] UI: day list accommodation editor (AC: 1,2,3)
  - [x] Add inline “Add stay” / “Edit stay” action in `TripTimeline`
  - [x] Implement a dialog/form to edit accommodation name/notes
  - [x] On delete, refresh trip detail so gap badges update
- [x] Tests (AC: 1,2,3)
  - [x] Repo tests for create/update/delete and trip/day ownership enforcement
  - [x] API tests for POST/PATCH/DELETE and response shape

## Dev Notes

- The day view is the trip detail timeline rendered by `TripTimeline`.
- Accommodations already exist as a minimal table from story 2.4; extend it without breaking gap detection.
- Use `tripDayId` to identify the target day; day IDs are already present in `GET /api/trips/[id]`.
- Keep accommodations 1:1 with trip days (unique `trip_day_id` already in schema).
- Preserve API envelope `{ data, error }` and use camelCase in JSON.
- Avoid new routes/screens; reuse the trip detail view and add a dialog for editing.

### Project Structure Notes

- Follow App Router conventions for API routes: `src/app/api/**/route.ts`.
- Data access stays in `src/lib/repositories/*` and Prisma only in `src/lib/db/prisma.ts`.
- UI components remain under `src/components/features/trips/*` (or add `features/accommodations` if needed).

### References

- Cite all technical details with source paths and sections, e.g. [Source: docs/<file>.md#Section]

## Dev Agent Record

### Agent Model Used

Codex (GPT-5)

### Debug Log References
- `npm test` (vitest run)
- `npm test` (vitest run) - 2026-02-13

### Completion Notes List
- Added accommodation name/notes fields with migration and regenerated Prisma client.
- Implemented scoped accommodation repo + API routes with CSRF validation and trip/day ownership checks.
- Extended trip detail payload and TripTimeline with add/edit stay dialog; gap badges refresh on save/delete.
- Added repo/route tests for accommodation CRUD and updated trip detail tests.
- Fixed missing-accommodation handling for blank names, clarified PATCH error responses, and reset dialog state; updated tests.

### File List
- _bmad-output/implementation-artifacts/2-5-add-or-update-nightly-accommodation.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- travelplan/prisma/schema.prisma
- travelplan/prisma/migrations/20260213180000_add_accommodation_details/migration.sql
- travelplan/src/app/api/trips/[id]/route.ts
- travelplan/src/app/api/trips/[id]/accommodations/route.ts
- travelplan/src/components/features/trips/TripAccommodationDialog.tsx
- travelplan/src/components/features/trips/TripEditDialog.tsx
- travelplan/src/components/features/trips/TripTimeline.tsx
- travelplan/src/generated/prisma/commonInputTypes.ts
- travelplan/src/generated/prisma/internal/class.ts
- travelplan/src/generated/prisma/internal/prismaNamespace.ts
- travelplan/src/generated/prisma/internal/prismaNamespaceBrowser.ts
- travelplan/src/generated/prisma/models/Accommodation.ts
- travelplan/src/i18n/en.ts
- travelplan/src/i18n/de.ts
- travelplan/src/lib/repositories/accommodationRepo.ts
- travelplan/src/lib/repositories/tripRepo.ts
- travelplan/src/lib/validation/accommodationSchemas.ts
- travelplan/test/accommodationRepo.test.ts
- travelplan/test/tripAccommodationRoute.test.ts
- travelplan/test/tripDetailRoute.test.ts
- travelplan/test/tripRepo.test.ts

### Change Log
- 2026-02-13: Implemented accommodation details, CRUD API, UI editor, and tests.
- 2026-02-13: Addressed code review findings for accommodation updates and gap detection.

## Developer Context

### Data Model (existing + updates)

- `Accommodation` already exists and is linked 1:1 to `TripDay`.
- Add fields:
  - `property_name` (required string; use `name` in Prisma model with `@map`)
  - `notes` (optional string; use `notes` in Prisma model with `@map`)
- Keep uniqueness on `trip_day_id`.
- Do not change `TripDay` relation shape or gap-detection logic.

### API Shape

Extend `GET /api/trips/[id]` day objects:

```ts
{
  id: string;
  date: string; // ISO 8601 UTC
  dayIndex: number;
  missingAccommodation: boolean;
  missingPlan: boolean;
  accommodation: {
    id: string;
    name: string;
    notes: string | null;
  } | null;
}
```

Accommodations endpoint (REST, CSRF-protected for state changes):

```ts
POST   /api/trips/[id]/accommodations
PATCH  /api/trips/[id]/accommodations
DELETE /api/trips/[id]/accommodations
```

**Request body (POST/PATCH):**

```ts
{
  tripDayId: string;
  name: string;
  notes?: string | null;
}
```

**Request body (DELETE):**

```ts
{
  tripDayId: string;
}
```

**Response:**

```ts
{ data: { accommodation: { id, name, notes, tripDayId } } | { deleted: true }, error: null }
```

### UI Behavior

- In `TripTimeline`, each day row shows:
  - Action button: `Add stay` if missing; `Edit stay` if present.
  - Keep gap badges from story 2.4; do not remove.
- Use a dialog form with MUI inputs for name and notes.
- After save/delete, refresh trip detail (reuse existing `loadTrip`).

### Validation Rules

- `name` is required and trimmed (min 1 char).
- `notes` is optional, limit to a reasonable length (e.g., 1000 chars).
- Reject requests if:
  - `tripDayId` is not part of the provided `tripId`
  - `tripId` does not belong to the current user

## Technical Requirements

- Prisma 7.3.0, SQLite 3.51.1; keep existing versions.
- Use REST API routes in `src/app/api/**/route.ts` and the `{ data, error }` envelope.
- Use `zod` for request validation in `src/lib/validation/*`.
- Use MUI for dialog and inputs (no custom modal stack).
- Keep dates ISO 8601 UTC when returned to the client.

## Architecture Compliance

- DB: snake_case via Prisma `@map`, API JSON camelCase.
- Data access only through repositories in `src/lib/repositories`.
- No new global state needed; keep local state in `TripTimeline`.
- Preserve existing security patterns (JWT auth, CSRF on writes).

## Library & Framework Requirements

- Next.js App Router only; no pages router additions.
- MUI (existing version in repo) for UI.
- React Hook Form optional; if used, keep version pinned.

## File Structure Requirements

- Update: `/Users/tommy/Development/TravelPlan/travelplan/prisma/schema.prisma`
- Add: `/Users/tommy/Development/TravelPlan/travelplan/src/lib/repositories/accommodationRepo.ts`
- Add: `/Users/tommy/Development/TravelPlan/travelplan/src/lib/validation/accommodationSchemas.ts`
- Add: `/Users/tommy/Development/TravelPlan/travelplan/src/app/api/trips/[id]/accommodations/route.ts`
- Update: `/Users/tommy/Development/TravelPlan/travelplan/src/lib/repositories/tripRepo.ts`
- Update: `/Users/tommy/Development/TravelPlan/travelplan/src/app/api/trips/[id]/route.ts`
- Update: `/Users/tommy/Development/TravelPlan/travelplan/src/components/features/trips/TripTimeline.tsx`
- Add: `/Users/tommy/Development/TravelPlan/travelplan/src/components/features/trips/TripAccommodationDialog.tsx`
- Tests (if suite exists):
  - `/Users/tommy/Development/TravelPlan/travelplan/test/accommodationRepo.test.ts`
  - `/Users/tommy/Development/TravelPlan/travelplan/test/tripAccommodationRoute.test.ts`

## Testing Requirements

- Manual verification:
  - Add stay to a day; badge “Missing stay” disappears.
  - Edit stay; list shows updated name.
  - Delete stay; badge reappears.
- Automated (if tests exist):
  - Repo: create/update/delete and ownership enforcement.
  - API: POST/PATCH/DELETE responses and CSRF validation.

## Previous Story Intelligence

- Story 2.4 already added `Accommodation` and `DayPlanItem` minimal models and missing flags in `GET /api/trips/[id]`.
- Do not break gap detection; keep `missingAccommodation` logic in sync with accommodation presence.

## Git Intelligence Summary

- Recent work focused on trip list/timeline and gap badges.
- No recent accommodation-specific endpoints; add new files without refactoring unrelated trip flows.

## Latest Technical Information

- Prisma 7.3.0 (repo-pinned) is the current target; do not upgrade during this story.  
- Next.js 16.1.6 is the current repo version; no upgrade in this story.  
- If checking for upgrades, do so outside this story and coordinate with full regression testing.

## Project Context Reference

- No `project-context.md` found. Use:
  - `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/epics.md`
  - `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/prd.md`
  - `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/architecture.md`
  - `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/ux-design-specification.md`

## Story Completion Status

- Status set to **ready-for-dev**.
- Completion note: Accommodation CRUD + UI dialog with gap badge synchronization.

## Implementation Plan

- Extend `Accommodation` model with `name` and optional `notes`.
- Add accommodation repo for scoped CRUD by `tripDayId`.
- Create accommodations API route with CSRF protection.
- Extend trip detail response with accommodation details.
- Add TripTimeline dialog for add/edit/delete and refresh trip data.
- Add tests for repository and API behavior.

## References

- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/epics.md#Story 2.5: Add or Update Nightly Accommodation`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/architecture.md#Project Structure & Boundaries`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/architecture.md#Implementation Patterns & Consistency Rules`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/ux-design-specification.md#Accommodation Table / Stay Grid`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/ux-design-specification.md#Gap Badges + Alerts`
