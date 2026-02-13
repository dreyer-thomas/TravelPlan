# Story 2.2: View Trips List and Open Trip Timeline

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner,
I want to see my trips and open a trip,
so that I can access the full day-by-day timeline.

## Acceptance Criteria

1. **Given** I am signed in
   **When** I open the trips list
   **Then** I see all of my trips
2. **Given** I select a trip
   **When** I open it
   **Then** I see the day-by-day list for that trip

## Story Requirements

- Trip list must show all trips for the signed-in user.
- Selecting a trip must navigate to a trip timeline view.
- Trip timeline must render the full set of trip days in order.
- All trip data must remain private to the owning user.

## Tasks / Subtasks

- [x] Add API route to fetch a single trip with its days (user-scoped)
- [x] Add repository helper to load trip + days for a user
- [x] Create trip detail page that renders the timeline (day-by-day list)
- [x] Link trips list items to the trip detail page
- [x] Add empty, loading, and not-found states for the trip timeline
- [x] Add API tests for trip detail fetch (auth, not found, ownership)
- [x] Add repository test for day ordering (ascending by dayIndex/date)

## Dev Notes

- This story relies on the existing trip creation flow (Story 2.1) that already generates `trip_days` records.
- Trips list already exists in `TripsDashboard` and is fed by `GET /api/trips`. The list items are not yet navigable.
- Use the established API envelope `{ data, error }` and error codes defined in `src/lib/errors/apiError.ts`.
- Dates must remain ISO 8601 UTC strings in API responses.

## Developer Context

- Authentication is required for all `/trips/**` routes. Middleware already redirects unauthenticated users to `/auth/login`.
- API reads must verify the session cookie and scope all queries by `user_id` to prevent cross-tenant access.
- Use `verifySessionJwt` to derive `userId` and reuse the same session parsing pattern in API routes.
- GET requests do not require CSRF validation; keep CSRF checks for state-changing endpoints only.
- The day list should be chronological and stable (order by `dayIndex` then `date`).

## Technical Requirements

- **API**
  - Add `GET /api/trips/[id]` to return a trip detail payload plus its day list.
  - Response shape:
    - `{ data: { trip: { id, name, startDate, endDate, dayCount }, days: [{ id, date, dayIndex }] }, error: null }`
  - `404` if the trip does not exist or does not belong to the user.
  - `401` if no valid session cookie is present.
- **Repository**
  - Add `getTripWithDaysForUser(userId, tripId)` in `src/lib/repositories/tripRepo.ts`.
  - Use Prisma `include: { days: { orderBy: { dayIndex: "asc" } }, _count: { select: { days: true } } }`.
- **UI**
  - Add `src/app/(routes)/trips/[id]/page.tsx` that renders trip header + day-by-day list.
  - Provide a back link to `/trips`.
  - Render empty state if day list is empty (defensive).
  - Add loading/skeleton state if using client data fetching.
- **Navigation**
  - Update `TripsDashboard` list items to navigate to `/trips/[id]` (use `ListItemButton` + Next.js `Link`).

## Architecture Compliance

- API routes must live under `src/app/api/**/route.ts`.
- Use `src/lib/http/response.ts` for `{ data, error }` envelopes.
- Use `src/lib/errors/apiError.ts` for standardized error codes.
- Keep DB access in `src/lib/repositories/*` and Prisma client in `src/lib/db/prisma.ts`.
- Maintain naming conventions: DB `snake_case`, API JSON `camelCase`, UTC dates.

## Library & Framework Requirements

- **Next.js App Router** for route + API definitions.
- **Material UI** for list/timeline visuals and layout.
- **Prisma** for data access.
- **Zod** not required in this story (no request payload).

## File Structure Requirements

- New API file: `src/app/api/trips/[id]/route.ts`.
- Update repository: `src/lib/repositories/tripRepo.ts`.
- New UI route: `src/app/(routes)/trips/[id]/page.tsx`.
- Optional UI component: `src/components/features/trips/TripTimeline.tsx`.
- Tests live in `travelplan/test/*` and follow existing Vitest patterns.

## Testing Requirements

- API tests (Vitest):
  - returns trip + days for owning user
  - rejects unauthenticated requests (401)
  - returns 404 for non-existent or other-user trip
- Repository test:
  - days returned in ascending `dayIndex` order

## Previous Story Intelligence

- Trip creation already generates `trip_days` records with `dayIndex` starting at 1.
- `GET /api/trips` already returns `dayCount`; keep this consistent with the day list response.
- Session auth and API error envelopes are already established in `src/app/api/trips/route.ts`.

## Git Intelligence Summary

- Recent commits focused on auth flows and home/trips page layout (`src/app/page.tsx`, `src/components/*`).
- API routes follow the Next.js `route.ts` pattern and use shared error/response helpers.
- Tests use Vitest + Prisma with per-worker SQLite databases (see `travelplan/test/setup.ts`).

## Latest Technical Information

- Next.js `v16.1.6` is the latest stable in the 16.1 line and is a bug-fix backport release. Align any App Router usage with this line and keep patched versions current. [Source: vercel/next.js GitHub release]
- Prisma `v7.3.0` is the current stable and includes performance and adapter updates; keep Prisma CLI and client versions matched. [Source: Prisma 7.3.0 release blog]
- MUI `v7.3.7` is the current stable for Material UI. [Source: mui/material-ui GitHub releases]
- Redux Toolkit `v2.11.0` is the current stable. [Source: reduxjs/redux-toolkit GitHub releases]
- React Hook Form `v7.68.0` is the current stable. [Source: react-hook-form GitHub releases]
- Zod `v4.3.2` is the current stable for Zod v4. [Source: colinhacks/zod GitHub releases]
- TipTap `v3.12.1` is the current stable for the TipTap 3 line. [Source: ueberdosis/tiptap GitHub releases]

## Project Context Reference

- No `project-context.md` found in repo. Use references in `epics.md`, `prd.md`, `architecture.md`, and `ux-design-specification.md`.

## Story Completion Status

- Status set to **ready-for-dev**.
- Completion note: Ultimate context engine analysis completed - comprehensive developer guide created.

## Dev Agent Record

### Agent Model Used

Codex (GPT-5)

### Debug Log References

N/A

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.
- Implemented trip detail API and UI timeline with loading/empty/not-found states, plus navigation from trips list.
- Added repo helper for user-scoped trip details and tests for API and ordering. Tests run: `npm test`.
- Added missing 404 test for non-existent trip detail.
- Added day ordering tie-breaker test for dayIndex/date.
- Updated File List to match git changes.
- Tests run: `npm test -- tripDetailRoute.test.ts tripRepo.test.ts`.

### Change Log

- Marked story ready for review (Date: 2026-02-12).
- Applied code review fixes and updated tests (Date: 2026-02-12).

### File List

- `/Users/tommy/Development/TravelPlan/travelplan/.gitignore`
- `/Users/tommy/Development/TravelPlan/travelplan/package-lock.json`
- `/Users/tommy/Development/TravelPlan/travelplan/package.json`
- `/Users/tommy/Development/TravelPlan/travelplan/prisma/dev.db`
- `/Users/tommy/Development/TravelPlan/travelplan/prisma/migrations/20260212205014_add_trips/migration.sql`
- `/Users/tommy/Development/TravelPlan/travelplan/prisma/schema.prisma`
- `/Users/tommy/Development/TravelPlan/travelplan/src/app/(routes)/layout.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/src/app/(routes)/trips/page.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/src/app/(routes)/trips/[id]/page.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/src/app/api/auth/csrf/route.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/app/api/trips/[id]/route.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/app/api/trips/route.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/app/layout.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/src/components/AppHeader.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/src/components/HeaderMenu.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/src/components/features/trips/TripCreateForm.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/src/components/features/trips/TripTimeline.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/src/components/features/trips/TripsDashboard.tsx`
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
- `/Users/tommy/Development/TravelPlan/travelplan/src/lib/repositories/tripRepo.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/lib/validation/tripSchemas.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/test/createTripRoute.test.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/test/setup.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/test/tripDetailRoute.test.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/test/tripRepo.test.ts`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/2-1-create-trip-with-date-range-and-auto-generated-days.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/2-2-view-trips-list-and-open-trip-timeline.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/2-3-edit-or-delete-trip-details.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/sprint-status.yaml`
