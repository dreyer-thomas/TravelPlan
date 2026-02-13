# Story 2.1: Create Trip With Date Range and Auto-Generated Days

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner,
I want to create a trip with a name and date range,
so that my trip is set up with a full set of days to plan.

## Acceptance Criteria

1. **Given** I am signed in
   **When** I create a trip with a name, start date, and end date
   **Then** the trip is created
   **And** a day entry is auto-generated for every date in the range
2. **Given** I submit an invalid or empty name
   **When** I attempt to create the trip
   **Then** I see a validation error and the trip is not created
3. **Given** I submit an invalid date range
   **When** I attempt to create the trip
   **Then** I see a validation error and the trip is not created

## Tasks / Subtasks

- [x] Define data model for trips and trip days
- [x] Create Prisma migration for new tables
- [x] Implement create-trip API route with validation and auth
- [x] Implement trip creation repository helper (transaction + day generation)
- [x] Add trip create UI and hook into API
- [x] Update trips list to include new trip
- [x] Add tests for create-trip flow

## Story Requirements

- Trip creation requires a **name**, **start date**, and **end date**.
- On success, the system must **auto-generate one day entry for every date** in the inclusive date range.
- Validation must prevent creation if the **name is empty/invalid** or if the **date range is invalid**.

## Developer Context

- **Authenticated only:** All trip data is private. Creation must require a valid session cookie.
- **CSRF required:** All state-changing requests must enforce CSRF validation (same approach as auth routes).
- **API envelope:** Use `{ data, error }` envelope from `src/lib/http/response.ts`.
- **Naming rules:** DB uses `snake_case`; API JSON uses `camelCase`; dates are **ISO 8601 UTC**.
- **Do not invent new patterns:** follow existing `lib/` helpers and `app/api/**/route.ts` structure.

## Technical Requirements

- **Prisma + SQLite:** Add `trips` and `trip_days` models.
  - Suggested fields (align to naming rules):
    - `trips`: `id` (cuid), `user_id` (FK), `name`, `start_date`, `end_date`, `created_at`, `updated_at`
    - `trip_days`: `id` (cuid), `trip_id` (FK), `date`, `day_index`, `created_at`, `updated_at`
  - Enforce FK `trip_days.trip_id -> trips.id` with cascade delete.
  - Store dates as `DateTime` and serialize to ISO 8601 UTC in API responses.
- **Transaction required:** Create trip + all trip days in a **single transaction** to avoid partial state.
- **Date range logic:** Inclusive range from `startDate` to `endDate`. Reject `startDate > endDate`.
- **Validation:** Use Zod for request validation. Validate:
  - `name` is non-empty (trimmed)
  - `startDate` and `endDate` are valid ISO 8601 strings
  - `startDate <= endDate`
- **Performance:** Use bulk creation (`createMany`) for days; avoid per-day inserts.

## Architecture Compliance

- **Project structure:**
  - API route: `src/app/api/trips/route.ts` (POST create)
  - Repo: `src/lib/repositories/tripRepo.ts`
  - Validation: `src/lib/validation/tripSchemas.ts`
  - UI: `src/app/(routes)/trips/page.tsx` and components under `src/components/features/trips/`
- **Error handling:** Use `apiError` with consistent `code` values. Return HTTP 400 for validation, 401/403 for auth.
- **Auth/session:** Use existing session utilities (`src/lib/auth/*`) and CSRF helpers.

## Library & Framework Requirements

- **Next.js App Router** with API routes in `app/api/**/route.ts`.
- **Prisma 7.3.x** with `@prisma/adapter-better-sqlite3` (already configured).
- **Zod 4.1.11** for validation.
- **Material UI** for UI components and form controls.

## File Structure Requirements

- Keep all DB access in `lib/repositories/*` and Prisma client in `lib/db/prisma.ts`.
- Do not place API logic in UI components; keep UI thin and call API or server action.

## Testing Requirements

- Add API tests for:
  - valid creation returns trip + correct day count
  - invalid name rejected
  - invalid date range rejected
  - unauthenticated request rejected
- Add repository test for transaction: no days created if trip creation fails.

## UX Notes (from UX Specification)

- Trip creation is a primary action; UI should be **simple and low-friction**.
- Desktop-first layout with responsive stacking for mobile.
- Use clear validation messages and immediate feedback; do not rely on color alone.

## References

- Epics: `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/epics.md` (Epic 2, Story 2.1)
- PRD: `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/prd.md` (Trip Management, Day-by-Day Planning)
- Architecture: `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/architecture.md` (Project Structure, API patterns, DB conventions)
- UX: `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/ux-design-specification.md` (Design System, Navigation Rail, Responsive)

## Project Structure Notes

- Follow the existing auth route pattern in `src/app/api/auth/*` for request parsing, CSRF validation, and error handling.
- Use `src/lib/http/response.ts` for response envelopes.

## Latest Technical Information

- **Next.js security advisories:** Ensure the installed Next.js version meets the patched versions for the 2025 CVEs (or later). Review and align to the official advisory list before release deployments. citeturn3search0
- **Prisma 7.3.0:** Confirm Prisma CLI and client stay aligned to the 7.3.x line that introduces extended configuration capabilities; keep CLI/client versions matched. citeturn3search2
- **Leaflet mapping:** The stable Leaflet release remains 1.9.4; avoid alpha branches for production mapping features. citeturn3search3

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

### Completion Notes List

- Story context authored with architecture + UX constraints and current code patterns.
- Defined Trip and TripDay Prisma models with user relation and day records.
- Created Prisma migration for trips and trip_days tables.
- Implemented create-trip API route with CSRF + session auth, validation, and trip/day creation.
- Added trip validation schema, trip repository helper, and create-trip API tests.
- Tests: `npm test`
- Added repository transaction test ensuring no trip days are created on failure.
- Tests: `npm test`
- Added trip creation form UI and wired it to the /api/trips endpoint with CSRF handling.
- Tests: `npm test`
- Added trips dashboard list backed by new /api/trips GET and repository list helper.
- Stabilized test isolation by using per-worker test databases.
- Tests: `npm test`
- Added API and repository tests covering trip creation success, validation, auth, and transaction safety.
- Tests: `npm test`
- Review fixes: enforce UTC date display, improve CSRF bootstrap error handling, align index naming, ignore local Prisma DB, sync sprint status.
- Tests: not run (review fixes only)
- Story complete and ready for review. All tasks satisfied.
- Tests: `npm test`

### File List

- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/2-1-create-trip-with-date-range-and-auto-generated-days.md`
- `/Users/tommy/Development/TravelPlan/travelplan/prisma/schema.prisma`
- `/Users/tommy/Development/TravelPlan/travelplan/prisma/migrations/20260212205014_add_trips/migration.sql`
- `/Users/tommy/Development/TravelPlan/travelplan/prisma/dev.db`
- `/Users/tommy/Development/TravelPlan/travelplan/src/app/api/trips/route.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/lib/repositories/tripRepo.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/lib/validation/tripSchemas.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/generated/prisma/browser.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/generated/prisma/client.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/generated/prisma/commonInputTypes.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/generated/prisma/internal/class.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/generated/prisma/internal/prismaNamespace.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/generated/prisma/internal/prismaNamespaceBrowser.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/generated/prisma/models.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/generated/prisma/models/User.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/generated/prisma/models/Trip.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/generated/prisma/models/TripDay.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/test/createTripRoute.test.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/test/tripRepo.test.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/components/features/trips/TripCreateForm.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/src/app/(routes)/trips/page.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/src/components/features/trips/TripsDashboard.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/src/app/api/trips/route.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/lib/repositories/tripRepo.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/test/setup.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/.gitignore`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/sprint-status.yaml`
