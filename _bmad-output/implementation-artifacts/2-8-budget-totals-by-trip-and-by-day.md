# Story 2.8: Budget Totals by Trip and by Day

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner,
I want to see planned costs by day and in total,
so that I can track my budget as I plan.

## Acceptance Criteria

1. **Given** accommodations have costs
   **When** I view a trip
   **Then** I see the total planned cost
2. **Given** accommodations have costs for a specific day
   **When** I view that day
   **Then** I see the planned cost subtotal for that day

## Story Requirements

- Budget totals are derived from accommodation costs already stored by stories 2.5 and 2.6.
- Trip total and day subtotal must be shown in existing trip/day UI contexts without adding parallel cost data stores.
- Totals must tolerate empty/null costs and treat missing values as excluded from numeric aggregation.
- API contracts must remain camelCase and wrapped in `{ data, error }`.
- DB schema naming remains snake_case.
- Existing day view and overview behavior from story 2.12/2.13 must remain intact.

## Tasks / Subtasks

- [x] Repository aggregation support (AC: 1,2)
  - [x] Add/extend repository methods to compute trip-level and per-day accommodation cost totals.
  - [x] Ensure ownership checks remain in place for all aggregation reads.
  - [x] Avoid N+1 query patterns when returning day subtotals.
- [x] API exposure (AC: 1,2)
  - [x] Return total planned cost in trip detail payload.
  - [x] Return day planned subtotal in day view payload.
  - [x] Preserve envelope and error mapping conventions.
- [x] UI wiring (AC: 1,2)
  - [x] Display trip-level planned total in trip overview context.
  - [x] Display day-level planned subtotal in day detail context.
  - [x] Keep UI consistent with existing MUI typography and summary panels.
- [x] i18n and formatting (AC: 1,2)
  - [x] Add EN/DE labels for budget total and day subtotal.
  - [x] Use consistent currency formatting utility/path already used by trip UI.
- [x] Tests (AC: 1,2)
  - [x] Repository tests for aggregation correctness (mixed null/number values).
  - [x] API tests for response shape and totals.
  - [x] UI tests for rendering totals in overview/day views.

## Dev Notes

- Follow App Router conventions; API routes remain under `src/app/api/**/route.ts`.
- Keep data access in `src/lib/repositories/*` via Prisma client from `src/lib/db/prisma.ts`.
- Reuse accommodation cost field introduced by stories 2.5 and 2.6.
- Keep summary logic server-driven; UI should render returned values, not recompute full totals from raw lists.
- Preserve existing gap logic and day-plan behavior from stories 2.4 and 2.7.

### Project Structure Notes

- Likely touch points (confirm against current implementation):
  - `travelplan/src/lib/repositories/tripRepo.ts`
  - `travelplan/src/app/api/trips/[id]/route.ts`
  - `travelplan/src/components/features/trips/TripTimeline.tsx`
  - `travelplan/src/components/features/trips/TripDayView.tsx` (or equivalent story 2.12/2.13 day detail component)
  - `travelplan/src/i18n/en.ts`
  - `travelplan/src/i18n/de.ts`
  - `travelplan/test/tripRepo.test.ts`
  - `travelplan/test/tripDetailRoute.test.ts`
  - `travelplan/test/*day*budget*.test.tsx` or nearest existing day view test file

### References

- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/epics.md#Story 2.8: Budget Totals by Trip and by Day`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/prd.md#Budget Awareness (MVP-light)`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/architecture.md#Implementation Patterns & Consistency Rules`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/architecture.md#Project Structure & Boundaries`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/ux-design-specification.md#Budget Runway Summary`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/2-7-create-and-edit-day-plan-items-with-links.md`
- [Next.js Route Handlers](https://nextjs.org/docs/app/building-your-application/routing/route-handlers)
- [Prisma Aggregate Queries](https://www.prisma.io/docs/orm/prisma-client/queries/aggregation-grouping-summarizing)
- [Prisma ORM 7.3.0](https://www.prisma.io/blog/prisma-orm-7-3-0)
- [MUI Versions](https://mui.com/versions/)

## Developer Context

### Data Model

- No new budget table is required.
- Use existing accommodation cost field as source of truth.
- Maintain current Prisma model and naming conventions unless a concrete schema gap is discovered during implementation.

### API Shape

- Trip detail payload must include `plannedCostTotal` (number).
- Day detail payload must include `plannedCostSubtotal` (number).
- Responses must remain:
  - Success: `{ data: <payload>, error: null }`
  - Error: `{ data: null, error: { code, message, details } }`

### UI Behavior

- Trip overview displays a clear total planned cost.
- Day view displays a clear subtotal for the selected day.
- If no costs exist, display zero-state value (for example `0`) rather than blank.

### Validation Rules

- Costs must remain numeric and non-negative per existing accommodation validation.
- Aggregation results must never return `NaN`/`null` to UI.

## Technical Requirements

- Keep pinned stack decisions from architecture:
  - Next.js App Router
  - Prisma ORM 7.3.x line
  - SQLite persistence
  - Zod-based API validation
- Do not introduce dependency upgrades in this story.

## Architecture Compliance

- DB fields: snake_case.
- API JSON fields: camelCase.
- Repository pattern must enforce user ownership boundaries.
- Date/time formatting remains ISO 8601 UTC where applicable.

## Library & Framework Requirements

- Use existing Next.js route handlers and server logic patterns.
- Use existing MUI summary components/typography for visual consistency.
- Keep Redux/global state impact minimal; prefer existing fetch/data flow patterns.

## File Structure Requirements

- Modify only existing budget-relevant repository/API/UI files where possible.
- Avoid creating duplicate feature modules for budget totals.
- Keep tests in established `travelplan/test/` conventions.

## Testing Requirements

- Repository tests:
  - Mixed accommodation cost sets (nulls + values)
  - Zero-cost scenarios
  - Ownership boundary checks
- API tests:
  - Trip total present and numeric
  - Day subtotal present and numeric
  - Error envelope unaffected
- UI tests:
  - Trip total displays correctly
  - Day subtotal displays correctly
  - Empty/no-cost days show zero state

## Previous Story Intelligence

- Story 2.7 established strong API/repository/test conventions for trip-day scoped features.
- Reuse existing dialog/view wiring patterns and i18n key style.
- Keep compatibility with story 2.13 day-view action model (overview remains compact, detail actions in day view).

## Git Intelligence Summary

- Recent commits focused on timeline/day-view evolution (`Story 2.13 day view plan items`) and day-plan CRUD (`Story 2.7`).
- Budget work should align to those evolved UI boundaries, not reintroduce old overview action patterns.

## Latest Technical Information

- Next.js App Router route handlers remain current implementation guidance for API routes.  
  Source: https://nextjs.org/docs/app/building-your-application/routing/route-handlers
- Prisma Client aggregate/group-by query docs remain the canonical approach for server-side totals.  
  Source: https://www.prisma.io/docs/orm/prisma-client/queries/aggregation-grouping-summarizing
- Prisma 7.3.0 release confirms active 7.x line used by project architecture.  
  Source: https://www.prisma.io/blog/prisma-orm-7-3-0
- MUI 7 is current stable major line; continue with repo-aligned MUI 7 usage.  
  Source: https://mui.com/versions/

## Project Context Reference

No `project-context.md` was found. Story context uses:
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/epics.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/prd.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/architecture.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/ux-design-specification.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/2-7-create-and-edit-day-plan-items-with-links.md`

## Story Completion Status

- Status set to **done**.
- Completion note: Implemented server-driven planned cost totals/subtotals across repository, API, and UI with EN/DE labels.

## Dev Agent Record

### Agent Model Used

Codex (GPT-5)

### Debug Log References

### Completion Notes List

- Story selected from sprint backlog in sequence: `2-8-budget-totals-by-trip-and-by-day`.
- Epic/PRD/architecture/UX and previous story were analyzed to derive implementation guardrails.
- Latest technical references verified for Next.js route handlers, Prisma aggregation, and MUI major line.
- Implemented repository-calculated `plannedCostTotal` and per-day `plannedCostSubtotal` in `tripRepo`, preserving owner-scoped reads.
- Extended `/api/trips/[id]` GET/PATCH payloads to expose `plannedCostTotal` and `plannedCostSubtotal` while preserving envelope/error behavior.
- Updated trip overview/day detail UI to render planned totals from API payload values.
- Added EN/DE i18n key for trip planned total label and reused existing cost formatting.
- Added/updated repository, API, and UI tests for numeric totals and zero-state rendering.
- Code review fixes applied:
  - Normalized budget aggregation to exclude hidden/blank accommodation records from totals/subtotals.
  - Removed redundant day-plan API round trip in day view by reusing trip detail payload items.
  - Aligned day summary total with visible itemized budget entries.
- Validation completed:
  - `npm test` => 40 files, 126 tests passed.
  - `npm run lint` => 0 errors (warnings present, pre-existing and out-of-scope for this story).
  - `npm test -- test/tripRepo.test.ts test/tripDetailRoute.test.ts test/tripTimelinePlan.test.tsx test/tripDayViewLayout.test.tsx` => 4 files, 21 tests passed.

### Senior Developer Review (AI)

- Date: 2026-02-14
- Outcome: Changes requested issues fixed (2 HIGH, 2 MEDIUM addressed in code/tests and artifacts).
- Validation scope: Story 2.8 implementation files and related tests only.

### File List

- _bmad-output/implementation-artifacts/2-8-budget-totals-by-trip-and-by-day.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- travelplan/src/lib/repositories/tripRepo.ts
- travelplan/src/app/api/trips/[id]/route.ts
- travelplan/src/components/features/trips/TripTimeline.tsx
- travelplan/src/components/features/trips/TripDayView.tsx
- travelplan/src/i18n/en.ts
- travelplan/src/i18n/de.ts
- travelplan/test/tripRepo.test.ts
- travelplan/test/tripDetailRoute.test.ts
- travelplan/test/tripTimelinePlan.test.tsx
- travelplan/test/tripDayViewLayout.test.tsx

## Change Log

- 2026-02-14: Implemented Story 2.8 budget totals by trip/day (repository aggregation, API exposure, UI rendering, i18n labels, and tests).
- 2026-02-14: Applied code review fixes for Story 2.8 (aggregation visibility alignment, day-view budget consistency, and day-plan fetch simplification).
