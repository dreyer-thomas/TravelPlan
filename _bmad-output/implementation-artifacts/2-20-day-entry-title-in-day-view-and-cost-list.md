# Story 2.20: Day Entry Title in Day View and Cost List

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner,
I want every day plan entry to have a required title,
so that day view is easier to scan and cost bookings use clear text labels.

## Acceptance Criteria

1. **Given** I create or edit a day plan item
   **When** I try to save with an empty title
   **Then** save is blocked and a validation message is shown
2. **Given** I create or edit a day plan item
   **When** I provide a valid title and save
   **Then** the title is persisted with that day plan item
3. **Given** a day plan item has a title
   **When** I view the day timeline card
   **Then** the title is rendered in **bold** text in the item card
4. **Given** a day plan item has a cost
   **When** I view the day budget entries list
   **Then** the corresponding cost booking label uses the day plan item title (not a parsed content preview)
5. **Given** I change a day plan item title
   **When** I view day cards and day budget entries after save
   **Then** both locations display the updated title
6. **Given** legacy day plan items may not have a title yet
   **When** they are loaded
   **Then** the UI remains stable and edit/save enforces title before persisting changes

## Story Requirements

- Introduce a required `title` field for day plan items across validation, API, repository, and UI layers.
- Keep existing `contentJson` rich-text behavior intact; title is a separate concise field, not derived from rich content.
- Render title in bold in day plan item cards in day view.
- Use `title` as the label text for day plan item entries in the day budget list.
- Preserve existing owner scoping and data access constraints.
- Ensure backward-compatible handling for existing records without title during transition.

## Tasks / Subtasks

- [x] Data model and migration (AC: 1, 2, 6)
  - [x] Add `title` column for day plan items in Prisma schema and migration
  - [x] Decide migration strategy for existing rows (temporary nullable + app validation, or safe default backfill)
- [x] Validation and API updates (AC: 1, 2, 5, 6)
  - [x] Extend day-plan schemas to require non-empty trimmed title on create/update
  - [x] Include `title` in API request/response payloads
- [x] Repository updates (AC: 2, 5, 6)
  - [x] Persist/read `title` in `dayPlanItemRepo` and trip detail aggregations
  - [x] Keep current behavior unchanged for non-title fields
- [x] Day view UI updates (AC: 3, 4, 5)
  - [x] Add title input to `TripDayPlanDialog` add/edit flow
  - [x] Show title as bold text on day plan cards in `TripDayView`
  - [x] Replace budget list label fallback for day plan items to prefer stored `title`
- [x] Test coverage (AC: 1-6)
  - [x] Schema tests for required title
  - [x] API tests for title roundtrip create/update/list
  - [x] UI tests for bold title rendering and budget label usage
  - [x] Regression test for legacy items without title

## Dev Notes

- Current day budget labels for day plan items are derived from `parsePlanText(item.contentJson)` in day view. This story changes that label source to stored item title.
- The day card currently renders rich content body from `contentJson`; keep that rendering and add a separate bold title line.
- Keep i18n and MUI patterns consistent with existing dialogs and day-view components.

## Technical Requirements

- Keep stack conventions: Next.js App Router, React, TypeScript, Prisma, Zod, MUI.
- Title should be trimmed and validated as non-empty; set a reasonable max length (recommendation: 120 chars).
- No unsafe HTML rendering changes; rich content remains schema-driven.

## Architecture Compliance

- Expected touch points:
  - `travelplan/prisma/schema.prisma`
  - `travelplan/prisma/migrations/*`
  - `travelplan/src/lib/validation/dayPlanItemSchemas.ts`
  - `travelplan/src/lib/repositories/dayPlanItemRepo.ts`
  - `travelplan/src/lib/repositories/tripRepo.ts`
  - `travelplan/src/app/api/trips/[id]/day-plan-items/route.ts`
  - `travelplan/src/app/api/trips/[id]/route.ts`
  - `travelplan/src/components/features/trips/TripDayPlanDialog.tsx`
  - `travelplan/src/components/features/trips/TripDayView.tsx`

## Library & Framework Requirements

- Reuse existing MUI input components and form validation patterns.
- Keep Zod as the source of request validation rules.
- Keep budget formatting utilities unchanged; only label source changes.

## File Structure Requirements

- Extend existing trip/day-plan modules; do not create parallel title-only modules.
- Keep tests in current `travelplan/test/` locations.

## Testing Requirements

- Manual:
  - Create day plan item without title and verify validation error.
  - Create with title and verify bold title in day card.
  - Add cost and verify budget list label equals title.
  - Edit title and verify budget label and card title both update.
- Automated:
  - Validation tests for required title.
  - API route tests for title in create/update/list payloads.
  - Component tests for bold title rendering and budget list label source.
  - Regression test behavior for legacy items without title.

## Previous Story Intelligence

- Story 2.7 established day plan item CRUD and payload flow.
- Story 2.13 established day-view plan item action patterns.
- Story 2.18 established rich content rendering for day items; keep title separate from rich body.
- Story 2.19 established day-plan-item cost integration in day budget entries.

## Git Intelligence Summary

- Recent work concentrated in `TripDayPlanDialog.tsx`, `TripDayView.tsx`, and day-plan schema/repository files.
- Keep changes scoped to existing day-plan item flow to minimize regression risk.

## Latest Technical Information

- No new external dependencies are required for this story.
- Continue storing money as integer cents and reuse current formatting helpers.

## Project Context Reference

- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/epics.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/architecture.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/prd.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/2-7-create-and-edit-day-plan-items-with-links.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/2-13-day-view-plan-item-add-edit-delete-icon-actions.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/2-18-rich-text-editor-formatting-and-rendered-day-items.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/2-19-day-plan-item-costs-roll-up-to-day-and-trip-totals.md`

## Story Completion Status

- Status set to **done**.
- Completion note: Implementation and senior code review follow-up fixes completed.

## Dev Agent Record

### Agent Model Used

Codex (GPT-5)

### Debug Log References

- Added nullable `title` column via Prisma migration `20260221173000_add_day_plan_item_title` for backward-compatible legacy rows.
- Regenerated Prisma client and wired `title` through day-plan validation, repositories, trip aggregation/export/import mappings, and trip/day-plan APIs.
- Updated day-plan dialog and day-view rendering so title is required on save, shown in bold on timeline cards, and used as budget label source.
- Added review follow-up tests for API empty-title validation, GET title assertions, dialog title validation messaging, and 120-char schema boundary.
- Ran full regression suite with Vitest: `231 passed`.

### Completion Notes List

- Implemented required trimmed title validation (`1..120`) in day-plan mutation schemas.
- Added API payload roundtrip for `title` in day-plan item list/create/update and trip day detail response.
- Persisted `title` in `dayPlanItemRepo` and trip repository detail/export/import flows.
- Added title input in `TripDayPlanDialog` and server validation error handling for title field.
- Updated `TripDayView` to render a bold title line and use stored title for day budget labels with safe fallback for legacy null titles.
- Added/updated automated tests for schema, repo, API, and UI behavior, including title roundtrip and budget label usage.
- Closed code-review coverage gaps by asserting `title` in day-plan GET API responses and adding explicit empty-title rejection tests.
- Documented concurrent non-story workspace deltas in senior review notes for transparency.

### File List

- `_bmad-output/implementation-artifacts/2-20-day-entry-title-in-day-view-and-cost-list.md`
- `travelplan/prisma/schema.prisma`
- `travelplan/prisma/migrations/20260221173000_add_day_plan_item_title/migration.sql`
- `travelplan/src/lib/validation/dayPlanItemSchemas.ts`
- `travelplan/src/lib/repositories/dayPlanItemRepo.ts`
- `travelplan/src/lib/repositories/tripRepo.ts`
- `travelplan/src/lib/validation/tripImportSchemas.ts`
- `travelplan/src/app/api/trips/[id]/day-plan-items/route.ts`
- `travelplan/src/app/api/trips/[id]/route.ts`
- `travelplan/src/components/features/trips/TripDayPlanDialog.tsx`
- `travelplan/src/components/features/trips/TripDayView.tsx`
- `travelplan/src/i18n/en.ts`
- `travelplan/src/i18n/de.ts`
- `travelplan/src/generated/prisma/internal/class.ts`
- `travelplan/src/generated/prisma/internal/prismaNamespace.ts`
- `travelplan/src/generated/prisma/internal/prismaNamespaceBrowser.ts`
- `travelplan/src/generated/prisma/models/DayPlanItem.ts`
- `travelplan/test/dayPlanItemSchemas.test.ts`
- `travelplan/test/dayPlanItemRepo.test.ts`
- `travelplan/test/tripDayPlanItemsRoute.test.ts`
- `travelplan/test/tripDayPlanDialog.test.tsx`
- `travelplan/test/tripDayViewLayout.test.tsx`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`

## Change Log

- 2026-02-21: Implemented Story 2.20 day-plan-item title support end-to-end, added migration/client regeneration, updated UI rendering/validation, and expanded automated coverage.
- 2026-02-21: Senior review fixes applied for title validation/test coverage gaps; full suite rerun and story status moved to done.

## Senior Developer Review (AI)

### Reviewer

Tommy

### Date

2026-02-21

### Outcome

Approve

### Findings Addressed

- Added API-level regression coverage for empty-title rejection on create (`travelplan/test/tripDayPlanItemsRoute.test.ts`).
- Added GET contract assertions for `title` in day-plan list responses (`travelplan/test/tripDayPlanItemsRoute.test.ts`).
- Added UI regression test asserting title validation messaging and blocked completion when server returns `validation_error` for title (`travelplan/test/tripDayPlanDialog.test.tsx`).
- Added schema boundary test for title length (`120` accepted, `121` rejected) (`travelplan/test/dayPlanItemSchemas.test.ts`).
- Recorded concurrent workspace deltas outside Story 2.20 scope during review (`.codex/*`, planning artifact and next-story draft changes) to preserve traceability.

### Validation

- `npm test` (in `travelplan/`): `55` files, `231` tests passed.
