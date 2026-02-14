# Story 2.7: Create and Edit Day Plan Items With Links

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner,
I want to add multiple day plan items with rich text and links,
so that I can capture notes and references for each day.

## Acceptance Criteria

1. **Given** I am viewing a trip day  
   **When** I add a day plan item with rich text  
   **Then** the item is saved for that day
2. **Given** I add a link to a day plan item  
   **When** I save the item  
   **Then** the link is stored and accessible
3. **Given** I edit or delete a day plan item  
   **When** I save changes  
   **Then** the updates are reflected in the day plan

## Story Requirements

- Day plan items are per `TripDay` and support multiple items per day.
- Each item stores rich text content and an optional external link.
- Missing-plan logic stays: a day is missing a plan when it has zero day plan items.
- All new API fields must be camelCase; DB columns snake_case.
- Reuse existing trip timeline patterns and dialogs; no new global state.

## Change Request Note (2026-02-14)

- Day plan item creation/editing should move into the new day view timeline when Story 2.12 is implemented.
- The overview timeline should become a compact scan and remove per-day action buttons.
- Keep existing API/repository behavior; this is a UI relocation and layout change.

## Tasks / Subtasks

- [x] Data model: extend `DayPlanItem` (AC: 1,2,3)
  - [x] Add `contentJson` (text) for TipTap doc JSON
  - [x] Add `linkUrl` (nullable string)
- [x] Repository: day plan item CRUD (AC: 1,2,3)
  - [x] List items for a trip day (ordered by createdAt ASC)
  - [x] Create/update/delete with trip ownership checks
- [x] Validation: add Zod schemas (AC: 1,2,3)
  - [x] Validate `contentJson` as non-empty JSON string
  - [x] Validate `linkUrl` as optional URL
- [x] API: day plan item endpoints (AC: 1,2,3)
  - [x] `GET /api/trips/[id]/day-plan-items?tripDayId=...`
  - [x] `POST /api/trips/[id]/day-plan-items`
  - [x] `PATCH /api/trips/[id]/day-plan-items`
  - [x] `DELETE /api/trips/[id]/day-plan-items`
  - [x] Preserve CSRF validation and `{ data, error }` envelope
- [x] UI: day plan items in trip timeline (AC: 1,2,3)
  - [x] Add “Plan” action per day and a dialog to manage items
  - [x] TipTap editor for rich text content
  - [x] Link input and display as external anchor
- [x] i18n: add EN/DE labels (AC: 1,2,3)
- [x] Tests (AC: 1,2,3)
  - [x] Repo tests for create/update/delete + ownership
  - [x] API tests for validation and response shape
  - [x] UI smoke test for add/edit/delete (if UI tests exist)

## Dev Notes

- Follow App Router conventions; API routes live under `src/app/api/**/route.ts`.
- Use Prisma only via `src/lib/db/prisma.ts`; repositories live in `src/lib/repositories/*`.
- Preserve the `{ data, error }` API envelope and CSRF validation for state-changing routes.
- Keep missing-plan logic based on zero day plan items; do not change the gap rules.
- Use TipTap 3 for rich text; store editor document JSON as a string.
- External links must open in a new tab with `rel="noreferrer noopener"`.

### Project Structure Notes

- Align with architecture-required structure and naming:
  - DB snake_case; API JSON camelCase.
  - API under `src/app/api/`.
  - UI in `src/components/features/trips/`.
  - Validation schemas in `src/lib/validation/`.
  - Repo logic in `src/lib/repositories/`.

### References

- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/epics.md#Story 2.7: Create and Edit Day Plan Items With Links`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/architecture.md#Project Structure & Boundaries`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/architecture.md#Implementation Patterns & Consistency Rules`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/ux-design-specification.md#Day Plan Timeline`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/ux-design-specification.md#Form Patterns`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/ux-design-specification.md#Navigation Patterns`
- `/Users/tommy/Development/TravelPlan/travelplan/package.json`
- `/Users/tommy/Development/TravelPlan/travelplan/src/components/features/trips/TripTimeline.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/src/lib/repositories/tripRepo.ts`
- `https://nextjs.org/blog/next-16`
- `https://www.prisma.io/blog/prisma-orm-7-3-0`
- `https://mui.com/versions/`
- `https://github.com/ueberdosis/tiptap/releases`

## Developer Context

### Data Model

- `DayPlanItem` exists with `trip_day_id`, `created_at`, `updated_at`.
- Extend with:
  - `contentJson` (TEXT) mapped to `content_json` (required).
  - `linkUrl` (String?) mapped to `link_url` (optional).
- `TripDay` already has `dayPlanItems` relation; missing-plan is computed from count.

### API Shape

Add a day plan items route under the trip:

```
GET    /api/trips/[id]/day-plan-items?tripDayId=...
POST   /api/trips/[id]/day-plan-items
PATCH  /api/trips/[id]/day-plan-items
DELETE /api/trips/[id]/day-plan-items
```

Request body (POST/PATCH):

```
{
  tripDayId: string;
  contentJson: string; // TipTap document JSON string
  linkUrl?: string | null;
}
```

Response:

```
{ data: { dayPlanItem: { id, tripDayId, contentJson, linkUrl, createdAt } }, error: null }
```

List response:

```
{ data: { items: [ { id, tripDayId, contentJson, linkUrl, createdAt } ] }, error: null }
```

### UI Behavior

- Add “Plan” action per day row in `TripTimeline`.
- Open a dialog that lists items for the selected day and allows add/edit/delete.
- Use TipTap editor for rich text; store its JSON doc string in `contentJson`.
- Render link as an external anchor when present.

### Validation Rules

- `contentJson` required; must be valid JSON string with non-empty content.
- `linkUrl` optional; if present, must be a valid URL and length-limited.

## Technical Requirements

- Keep Prisma 7.3.0 and SQLite 3.51.1 (no upgrades).
- Maintain REST API envelope `{ data, error }`.
- Use Zod for request validation in `src/lib/validation/*`.
- Preserve CSRF checks on all state-changing routes.

## Architecture Compliance

- DB: snake_case columns; API JSON: camelCase.
- Repositories enforce user/trip/day ownership checks.
- No new API surface outside `src/app/api/**/route.ts`.
- Dates in responses use ISO 8601 UTC strings.

## Library & Framework Requirements

- Next.js App Router only; no Pages router additions.
- MUI for dialog and inputs.
- TipTap 3 for rich text (`@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-link`).
- React Hook Form if needed for dialog inputs (align with existing patterns).
- Do not upgrade dependencies; align with `travelplan/package.json`.

## File Structure Requirements

- Update: `travelplan/prisma/schema.prisma`
- Add migration: `travelplan/prisma/migrations/*_add_day_plan_item_content_link/migration.sql`
- Add repo: `travelplan/src/lib/repositories/dayPlanItemRepo.ts`
- Update: `travelplan/src/lib/repositories/tripRepo.ts` (ensure missingPlan based on count remains)
- Add validation: `travelplan/src/lib/validation/dayPlanItemSchemas.ts`
- Add API: `travelplan/src/app/api/trips/[id]/day-plan-items/route.ts`
- Update UI: `travelplan/src/components/features/trips/TripTimeline.tsx`
- Add UI: `travelplan/src/components/features/trips/TripDayPlanDialog.tsx`
- Update i18n: `travelplan/src/i18n/en.ts`, `travelplan/src/i18n/de.ts`
- Tests:
  - `travelplan/test/dayPlanItemRepo.test.ts`
  - `travelplan/test/tripDayPlanItemsRoute.test.ts`
  - `travelplan/test/tripDetailRoute.test.ts` (ensure missingPlan flips when items exist)

## Testing Requirements

- Manual:
  - Add a day plan item with rich text; verify persistence and display.
  - Add a link; verify it opens in a new tab.
  - Edit and delete items; verify list updates and missing-plan flag changes.
- Automated:
  - Repo: create/update/delete with ownership enforcement.
  - API: validation errors for invalid `contentJson`/`linkUrl`.
  - Trip detail: missingPlan should be false when any item exists.

## Previous Story Intelligence

- Story 2.6 extended the trip timeline and dialogs without introducing new global state.
- Reuse the dialog pattern and i18n key style from `TripAccommodationDialog`.
- Keep gap badge logic consistent with story 2.4.

## Git Intelligence Summary

- Recent commits focus on trip timeline, accommodation CRUD, and gap badges.
- Follow existing API patterns in `tripRepo` and `TripTimeline` to minimize refactors.

## Latest Technical Information

- Next.js 16 is the current major release and is already pinned in the repo (16.1.6).  
  Source: https://nextjs.org/blog/next-16
- Next.js security advisory (CVE-2025-66478) recommends upgrading all 15.x/16.x apps.  
  This story must not upgrade; track for a dedicated security bump.  
  Source: https://nextjs.org/blog
- Prisma ORM 7.3.0 is current and matches the repo pin.  
  Source: https://www.prisma.io/blog/prisma-orm-7-3-0
- MUI v7 is the stable major; repo pin is 7.3.8.  
  Source: https://mui.com/versions/
- TipTap 3 is the current major; latest v3.x is on the releases page.  
  Source: https://github.com/ueberdosis/tiptap/releases
- Do not upgrade versions in this story.

## Project Context Reference

No `project-context.md` found. Use:
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/epics.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/prd.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/architecture.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/ux-design-specification.md`

## Story Completion Status

- Status set to **review**.
- Completion note: day plan items implemented end-to-end with API, UI, i18n, and tests; full test suite passing.

## Dev Agent Record

### Agent Model Used

Codex (GPT-5)

### Debug Log References

### Implementation Plan

- Extend `DayPlanItem` schema with `content_json` and `link_url`, plus migration.
- Update trip day fixture data to include `contentJson` for missing-plan checks.

### Completion Notes List

- Story 2.7 context created with data model, API, UI, and testing guardrails.
- Latest tech notes included; versions pinned to repo and no upgrades.
- Data model updated with `content_json`/`link_url` and migration; tests updated to include `contentJson` fixtures; `npm test`.
- Added day plan item repository CRUD + ordering with ownership checks; repo tests added; `npm test`.
- Added day plan item validation schemas with JSON/link checks and tests; `npm test`.
- Added day plan item API routes with CSRF + envelope; route tests added; `npm test`.
- Added day plan items UI (TripTimeline + TripDayPlanDialog) with TipTap content, link display, and plan actions; i18n labels; date input normalization; hydration and SSR fixes; `npm test`.
- Added TripTimeline plan UI smoke test; removed hanging dialog test; `npm test`.
- Code review fixes: removed per-day plan/stay actions from TripTimeline overview, enforced non-empty TipTap JSON validation, and added TripDayPlanDialog add/edit/delete smoke test.

### File List

- _bmad-output/implementation-artifacts/2-7-create-and-edit-day-plan-items-with-links.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- travelplan/prisma/migrations/20260213193000_add_day_plan_item_content_link/migration.sql
- travelplan/prisma/schema.prisma
- travelplan/src/generated/prisma/commonInputTypes.ts
- travelplan/src/generated/prisma/enums.ts
- travelplan/src/generated/prisma/internal/class.ts
- travelplan/src/generated/prisma/internal/prismaNamespace.ts
- travelplan/src/generated/prisma/internal/prismaNamespaceBrowser.ts
- travelplan/src/generated/prisma/models/Accommodation.ts
- travelplan/src/generated/prisma/models/DayPlanItem.ts
- travelplan/src/lib/repositories/dayPlanItemRepo.ts
- travelplan/src/app/api/trips/[id]/day-plan-items/route.ts
- travelplan/src/lib/validation/dayPlanItemSchemas.ts
- travelplan/test/dayPlanItemSchemas.test.ts
- travelplan/test/tripDayPlanItemsRoute.test.ts
- travelplan/test/tripDetailRoute.test.ts
- travelplan/test/dayPlanItemRepo.test.ts
- travelplan/test/tripRepo.test.ts
- travelplan/src/components/features/trips/TripDayPlanDialog.tsx
- travelplan/src/components/features/trips/TripTimeline.tsx
- travelplan/src/components/features/trips/TripCreateForm.tsx
- travelplan/src/components/features/trips/TripEditDialog.tsx
- travelplan/src/i18n/en.ts
- travelplan/src/i18n/de.ts
- travelplan/test/tripTimelinePlan.test.tsx
- travelplan/test/tripDayPlanDialog.test.tsx
- travelplan/package.json
- travelplan/package-lock.json
