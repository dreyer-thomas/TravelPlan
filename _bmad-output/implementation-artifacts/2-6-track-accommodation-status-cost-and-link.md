# Story 2.6: Track Accommodation Status, Cost, and Link

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner,
I want to mark an accommodation as planned or booked and capture cost and link,
so that I can track status and spending.

## Acceptance Criteria

1. **Given** I am editing a night's accommodation
   **When** I set status to planned or booked
   **Then** the status is saved and displayed
2. **Given** I enter a cost value
   **When** I save the accommodation
   **Then** the cost is stored and included in totals
3. **Given** I enter an external link
   **When** I save the accommodation
   **Then** the link is stored and accessible from the accommodation

## Story Requirements

- Extend the existing accommodation (1:1 with `trip_days`) with:
  - `status` (planned | booked) required
  - `costCents` optional integer value suitable for aggregation
  - `link` optional external URL
- Preserve existing accommodation name/notes fields and day-level gap detection.
- Do not introduce new routes; reuse the trip timeline day editor dialog.
- Cost must be aggregated into a trip-level total (for future budget views).
- All new API fields must be camelCase; DB columns snake_case.

## Tasks / Subtasks

- [x] Data model: extend Accommodation fields (AC: 1,2,3)
  - [x] Add `status` enum (PLANNED, BOOKED) with default `PLANNED`
  - [x] Add `cost_cents` (Int, nullable)
  - [x] Add `link_url` (String, nullable)
- [x] Repository: extend accommodation CRUD (AC: 1,2,3)
  - [x] Accept status, costCents, link in create/update
  - [x] Enforce trip/day ownership checks unchanged
  - [x] Add helper to compute total accommodation cost per trip (cents)
- [x] API: update accommodations endpoint (AC: 1,2,3)
  - [x] Extend request/response schema with `status`, `costCents`, `link`
  - [x] Preserve CSRF validation and `{ data, error }` envelope
- [x] API: update trip detail response (AC: 2)
  - [x] Include accommodation fields per day (status/cost/link)
  - [x] Include `accommodationCostTotalCents` (sum of day costs)
- [x] UI: extend TripAccommodationDialog (AC: 1,2,3)
  - [x] Add status select (planned/booked)
  - [x] Add cost input with basic validation
  - [x] Add link input (URL) and ensure it is clickable in display
- [x] UI: display accommodation status/cost/link (AC: 1,2,3)
  - [x] Show status and cost in the day row summary or detail panel
  - [x] Render link as external anchor (new tab) when present
- [x] Tests (AC: 1,2,3)
  - [x] Repo tests for status/cost/link persistence and totals
  - [x] API tests for validation and response shape
  - [x] Trip detail test for totals and per-day fields

## Dev Notes

- Reuse the existing accommodation dialog and i18n keys; extend with new labels.
- Maintain gap-badge behavior from story 2.4 (missing if no accommodation or name empty).
- Treat cost as optional; absence should not affect missing-accommodation logic.
- Keep URL handling safe: validate format, trim, and allow null.

### Project Structure Notes

- API routes in `src/app/api/**/route.ts` only.
- Repositories in `src/lib/repositories/*` and Prisma only in `src/lib/db/prisma.ts`.
- UI under `src/components/features/trips/*`.

### References

- Cite all technical details with source paths and sections.

## Developer Context

### Data Model

- `Accommodation` exists and is 1:1 with `TripDay`.
- Add fields (suggested):
  - `status` (enum) mapped to `status`
  - `costCents` (Int) mapped to `cost_cents`
  - `link` (String?) mapped to `link_url`
- Default status to `PLANNED` for existing rows.

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
    status: "planned" | "booked";
    costCents: number | null;
    link: string | null;
  } | null;
}
```

Accommodation endpoint (REST, CSRF-protected):

```ts
POST   /api/trips/[id]/accommodations
PATCH  /api/trips/[id]/accommodations
DELETE /api/trips/[id]/accommodations
```

Request body (POST/PATCH):

```ts
{
  tripDayId: string;
  name: string;
  notes?: string | null;
  status: "planned" | "booked";
  costCents?: number | null;
  link?: string | null;
}
```

Response:

```ts
{ data: { accommodation: { id, name, notes, status, costCents, link, tripDayId } }, error: null }
```

Trip detail response adds:

```ts
{ data: { trip: { accommodationCostTotalCents: number | null } }, error: null }
```

### UI Behavior

- Trip timeline day row shows:
  - Status badge (planned/booked)
  - Cost if present (format from cents to display)
  - Link icon or text when link exists (open in new tab)
- Dialog fields:
  - Status select with planned/booked
  - Cost input (numeric)
  - Link input (URL)

### Validation Rules

- `status` required and must be one of `planned` or `booked`.
- `costCents` optional; if provided, must be an integer >= 0 with sensible max.
- `link` optional; if provided, must be a valid URL and length-limited.

## Technical Requirements

- Keep Prisma 7.3.0 and SQLite 3.51.1 (no upgrades).
- Maintain REST API envelope `{ data, error }`.
- Use Zod for request validation in `src/lib/validation/*`.
- Preserve CSRF checks on all state-changing routes.

## Architecture Compliance

- DB: snake_case columns; API JSON: camelCase.
- Repositories enforce user/trip/day ownership.
- No new routes or global state.

## Library & Framework Requirements

- Next.js App Router only; no Pages router additions.
- MUI for dialog, select, and inputs.
- React Hook Form is already used in `TripAccommodationDialog`.

## File Structure Requirements

- Update: `travelplan/prisma/schema.prisma`
- Add migration: `travelplan/prisma/migrations/*_add_accommodation_status_cost_link/migration.sql`
- Update: `travelplan/src/lib/repositories/accommodationRepo.ts`
- Update: `travelplan/src/lib/repositories/tripRepo.ts`
- Update: `travelplan/src/lib/validation/accommodationSchemas.ts`
- Update: `travelplan/src/app/api/trips/[id]/accommodations/route.ts`
- Update: `travelplan/src/app/api/trips/[id]/route.ts`
- Update: `travelplan/src/components/features/trips/TripAccommodationDialog.tsx`
- Update: `travelplan/src/components/features/trips/TripTimeline.tsx`
- Update i18n: `travelplan/src/i18n/en.ts`, `travelplan/src/i18n/de.ts`
- Tests (if suite exists):
  - `travelplan/test/accommodationRepo.test.ts`
  - `travelplan/test/tripAccommodationRoute.test.ts`
  - `travelplan/test/tripDetailRoute.test.ts`

## Testing Requirements

- Manual:
  - Set status planned/booked; verify display in day row.
  - Save cost; verify total updates and day row shows formatted cost.
  - Save link; verify link opens in new tab.
- Automated:
  - Repo: status/cost/link persisted and aggregated correctly.
  - API: validation errors for bad status/cost/link.
  - Trip detail: accommodation fields + cost total included.

## Previous Story Intelligence

- Story 2.5 added the accommodation dialog and CRUD endpoints.
- Keep 1:1 accommodation per trip day; do not change gap-detection logic.
- Reuse `TripTimeline` and `TripAccommodationDialog` patterns.

## Git Intelligence Summary

- Recent commits updated trip detail endpoints, gap badges, and accommodation dialog.
- Accommodation CRUD lives in `src/app/api/trips/[id]/accommodations/route.ts` with CSRF protection.
- Trip detail response and `TripTimeline` were recently extended; minimize refactors.

## Latest Technical Information

- Repo-pinned versions (from `travelplan/package.json`):
  - Next.js 16.1.6
  - Prisma 7.3.0
  - React Hook Form 7.71.1
  - MUI 7.3.8
  - Zod 4.1.11
  - jose 6.1.0
  - bcrypt 6.0.0
- Do not upgrade versions in this story; keep repo-pinned versions.

## Project Context Reference

No `project-context.md` found. Use:
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/epics.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/prd.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/architecture.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/ux-design-specification.md`

## Story Completion Status

- Status set to **review**.
- Completion note: accommodation status/cost/link added with totals support.

## Dev Agent Record

### Agent Model Used

Codex (GPT-5)

### Debug Log References
- `npm test` (vitest run) - failed (Prisma client mismatch)
- `npx prisma generate`
- `npm test` (vitest run) - 2026-02-13
- `npm run lint` (warnings only)

### Completion Notes List
- Added accommodation status/cost/link fields with migration and regenerated Prisma client.
- Extended accommodation repo CRUD and trip detail aggregation to expose status, cost, link, and trip-level totals.
- Updated accommodation API routes, schemas, and trip detail response to include new fields and totals.
- Updated TripAccommodationDialog and TripTimeline UI to capture/display status, cost, and link with new i18n labels.
- Added repo and API tests for status/cost/link validation, persistence, and trip totals.
- Code review fixes: removed accidental migration, untracked prisma dev.db, and added noopener on external stay links.

### File List
- _bmad-output/implementation-artifacts/2-6-track-accommodation-status-cost-and-link.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- travelplan/prisma/schema.prisma
- travelplan/prisma/migrations/20260213190000_add_accommodation_status_cost_link/migration.sql
- travelplan/src/app/api/trips/[id]/accommodations/route.ts
- travelplan/src/app/api/trips/[id]/route.ts
- travelplan/src/components/features/trips/TripAccommodationDialog.tsx
- travelplan/src/components/features/trips/TripEditDialog.tsx
- travelplan/src/components/features/trips/TripTimeline.tsx
- travelplan/src/generated/prisma/commonInputTypes.ts
- travelplan/src/generated/prisma/enums.ts
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

### Change Log
- 2026-02-13: Added accommodation status/cost/link support across DB, repo, API, UI, and tests; exposed trip-level totals.
- 2026-02-13: Code review fixes for migration cleanup, dev.db untracking, and external link hardening.

## References

- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/epics.md#Story 2.6: Track Accommodation Status, Cost, and Link`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/architecture.md#Implementation Patterns & Consistency Rules`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/architecture.md#Project Structure & Boundaries`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/ux-design-specification.md#Accommodation Table / Stay Grid`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/ux-design-specification.md#Gap Badges + Alerts`
