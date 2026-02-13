# Story 2.4: See Planning Gaps in Day View

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner,
I want to see which days are missing accommodations or plans,
so that I can quickly fill the gaps.

## Acceptance Criteria

1. **Given** I am viewing a trip
   **When** any day has no accommodation for its night
   **Then** that day is flagged as missing accommodation
2. **Given** I am viewing a trip
   **When** any day has no day plan items
   **Then** that day is flagged as missing a plan

## Story Requirements

- Surface gap indicators directly in the day list for a trip (day view).
- A day is "missing accommodation" when there is no accommodation record for that day.
- A day is "missing plan" when there are zero day plan items for that day.
- Gap indicators must be visible in the day list without opening a detail view.
- Do not introduce new navigation or a new page; extend the existing trip day list.
- Indicators must not rely on color alone; include text labels.

## Tasks / Subtasks

- [x] Extend the data model to support gap detection (accommodations + day plan items).
- [x] Update trip detail API to return per-day gap flags.
- [x] Render gap badges in the trip day list.
- [x] Add tests for gap detection in repository/service layer (if tests exist in repo).

## Dev Notes

### Current UI

- The day view is rendered in `TripTimeline` and lists days using MUI `ListItem`.
- The trip detail API is `GET /api/trips/[id]` and already returns `days`.

### Gap Detection Strategy

- Add relations from `TripDay` to `Accommodation` and `DayPlanItem` to support counts.
- Use per-day counts to derive flags:
  - `missingAccommodation = accommodationCount === 0`
  - `missingPlan = planItemCount === 0`
- Include flags (or counts) in the API response so the UI stays simple.

### UX Guidance

- Use MUI `Chip` or `Badge` components for missing indicators.
- Keep the day list readable: day label on the left, gap badges on the right.
- Example labels:
  - "Missing stay"
  - "Missing plan"

## Developer Context

### Data Model (new)

Add minimal tables that can be expanded in stories 2.5 (accommodations) and 2.7 (day plan items):

- `accommodations` table
  - 1-to-1 with `trip_days` (one accommodation per night)
  - Minimal fields for now: `id`, `trip_day_id`, `created_at`, `updated_at`
  - Enforce uniqueness on `trip_day_id`
- `day_plan_items` table
  - 1-to-many with `trip_days`
  - Minimal fields for now: `id`, `trip_day_id`, `created_at`, `updated_at`

These are intentionally minimal so later stories can extend fields without reworking relations.

### API Shape

Add fields to `GET /api/trips/[id]` response per day:

```ts
{
  id: string;
  date: string;
  dayIndex: number;
  missingAccommodation: boolean;
  missingPlan: boolean;
}
```

### UI Updates

- Update `TripTimeline` list rows to show missing badges.
- Avoid changing navigation, routing, or list ordering.

## Technical Requirements

- **Data / Prisma**
  - Add models `Accommodation` and `DayPlanItem` with `tripDayId` foreign keys.
  - Enforce `accommodations` uniqueness for `tripDayId`.
  - Keep DB naming conventions (`snake_case` in schema via `@map`).

- **Repository**
  - Extend `getTripWithDaysForUser` to return per-day counts for accommodations and plan items.
  - Derive missing flags at the repository or API layer.

- **API**
  - Update `GET /api/trips/[id]` to include missing flags in `days` items.
  - Keep API envelope `{ data, error }` unchanged.

- **UI**
  - Display missing gap indicators in the day list with clear labels.
  - Keep list layout consistent with MUI patterns used elsewhere.

## Architecture Compliance

- Follow App Router and `app/api/**/route.ts` conventions.
- Keep data access inside `lib/repositories/*`.
- Use MUI components and follow UX spec guidelines for status and badges.
- Respect naming and response format rules in `architecture.md`.

## Library & Framework Requirements

- Next.js App Router only.
- Prisma ORM 7.3.0, SQLite 3.51.1.
- Redux Toolkit 2.11.2 (no new global state needed for this story).
- MUI for UI components.

## File Structure Requirements

- Update: `/Users/tommy/Development/TravelPlan/travelplan/prisma/schema.prisma`
- Update: `/Users/tommy/Development/TravelPlan/travelplan/src/lib/repositories/tripRepo.ts`
- Update: `/Users/tommy/Development/TravelPlan/travelplan/src/app/api/trips/[id]/route.ts`
- Update: `/Users/tommy/Development/TravelPlan/travelplan/src/components/features/trips/TripTimeline.tsx`
- Optional tests: `/Users/tommy/Development/TravelPlan/travelplan/test/*` (if test suite already exists)

## Testing Requirements

- Manual verification (required):
  - Open a trip with no accommodations or plan items: each day shows both missing badges.
  - After adding accommodation/plan items in later stories, badges disappear accordingly.
- Automated tests (optional):
  - Repository test for counts/flags if test suite is present.

## Previous Story Intelligence

- Story 2.3 added edit/delete trip functionality and tests; trip detail API already exists and is used by `TripTimeline`.
- Do not change list ordering or existing day list layout beyond adding badges.

## Git Intelligence Summary

- Recent commits are focused on auth and home content; trip feature code has not been recently changed, so merge risk is low.

## Latest Technical Information

- Prisma ORM latest stable is 7.3.0; repo pins 7.3.0 and should remain on that version for this story.
- MUI latest stable is 7.3.2; repo uses 7.3.8 already, so do not upgrade as part of this story.
- React Hook Form latest stable is 7.62.0; repo pins 7.71.1, keep current version.
- Zod latest stable is 4.3.6; repo pins 4.1.11, keep current version.
- `jose` latest stable is 6.1.0; repo pins 6.1.0, keep current version.
- `bcrypt` latest stable is 5.1.1; repo pins 6.0.0, keep current version.
- Leaflet latest stable is 1.9.4; keep this version when map work begins later.

## Project Context Reference

- No `project-context.md` found in repo. Use `epics.md`, `prd.md`, `architecture.md`, and `ux-design-specification.md` for context.

## Story Completion Status

- Status set to **review**.
- Completion note: Implemented gap detection across data model, API, and UI; tests added and passing.

## Dev Agent Record

### Agent Model Used

Codex (GPT-5)

### Debug Log References

N/A

### Implementation Plan

- Add `Accommodation` and `DayPlanItem` Prisma models with `trip_day_id` relations and indexes.
- Extend trip repository to compute per-day missing flags using relation presence/counts.
- Surface missing flags in trip detail API and render MUI chips in `TripTimeline`.
- Add repo and API tests to verify missing flag behavior.

### Completion Notes List

- Added accommodations/day plan items tables and migration with `trip_day_id` relations.
- Extended trip detail repository + API to return `missingAccommodation` and `missingPlan` per day.
- Rendered missing gap chips in the trip day list with text labels.
- Tests: `npm test` (pass). Lint: `npm run lint` (warnings only: unused eslint-disable directives in `TripTimeline.tsx`, `createTripRoute.test.ts`, `tripDetailRoute.test.ts`).
- Review fixes: renamed accommodation unique index to match naming conventions; added PATCH test assertions for gap flags; reconciled File List.

### File List

- `.gitignore`
- `package.json`
- `package-lock.json`
- `prisma/dev.db`
- `prisma/schema.prisma`
- `prisma/migrations/20260212205014_add_trips/migration.sql`
- `prisma/migrations/20260213090000_add_gap_models/migration.sql`
- `src/lib/repositories/tripRepo.ts`
- `src/lib/validation/tripSchemas.ts`
- `src/app/api/trips/route.ts`
- `src/app/api/trips/[id]/route.ts`
- `src/app/api/auth/csrf/route.ts`
- `src/app/layout.tsx`
- `src/app/(routes)/layout.tsx`
- `src/app/(routes)/trips/page.tsx`
- `src/app/(routes)/trips/[id]/page.tsx`
- `src/components/AppHeader.tsx`
- `src/components/HeaderMenu.tsx`
- `src/components/features/trips/TripsDashboard.tsx`
- `src/components/features/trips/TripCreateDialog.tsx`
- `src/components/features/trips/TripCreateForm.tsx`
- `src/components/features/trips/TripDeleteDialog.tsx`
- `src/components/features/trips/TripTimeline.tsx`
- `test/setup.ts`
- `test/createTripRoute.test.ts`
- `test/tripsDashboard.test.tsx`
- `test/tripRepo.test.ts`
- `test/tripDetailRoute.test.ts`
- `src/generated/prisma/browser.ts`
- `src/generated/prisma/client.ts`
- `src/generated/prisma/commonInputTypes.ts`
- `src/generated/prisma/internal/class.ts`
- `src/generated/prisma/internal/prismaNamespace.ts`
- `src/generated/prisma/internal/prismaNamespaceBrowser.ts`
- `src/generated/prisma/models.ts`
- `src/generated/prisma/models/Accommodation.ts`
- `src/generated/prisma/models/DayPlanItem.ts`
- `src/generated/prisma/models/Trip.ts`
- `src/generated/prisma/models/TripDay.ts`
- `src/generated/prisma/models/User.ts`

### Change Log

- 2026-02-13: Added trip day gap detection models, API fields, UI badges, and tests for missing accommodation/plan.
- 2026-02-13: Review fixes for index naming, PATCH gap flag assertions, and File List reconciliation.

### References

- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/epics.md#Story 2.4: See Planning Gaps in Day View`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/prd.md#Day-by-Day Planning`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/architecture.md#Implementation Patterns & Consistency Rules`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/architecture.md#Project Structure & Boundaries`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/ux-design-specification.md#Gap Badges + Alerts`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/ux-design-specification.md#Navigation Patterns`
- `/Users/tommy/Development/TravelPlan/travelplan/src/components/features/trips/TripTimeline.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/src/app/api/trips/[id]/route.ts`
