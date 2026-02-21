# Story 2.19: Day Plan Item Costs Roll Up to Day and Trip Totals

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner,
I want each day plan entry to have an optional cost field,
so that day and trip budget totals include both accommodation costs and day-entry costs.

## Acceptance Criteria

1. **Given** I add or edit a day plan item
   **When** I enter a valid cost
   **Then** the item is saved with that cost value
2. **Given** a day contains day plan items with costs
   **When** I open day view
   **Then** each item cost is shown in the day summary list and included in the day total
3. **Given** a trip contains day plan item costs across multiple days
   **When** I open trip overview/details
   **Then** the trip planned total includes accommodation costs plus all day plan item costs
4. **Given** a day plan item has no cost
   **When** totals are calculated
   **Then** the item contributes `0` and no error occurs
5. **Given** existing data without day-item costs
   **When** users view or edit trips
   **Then** behavior remains backward compatible with no regressions

## Story Requirements

- Introduce optional `costCents` for day plan items.
- Enforce numeric non-negative validation for day-item costs.
- Extend repository aggregation logic to sum:
  - Day total = visible accommodation cost + sum(day plan item costs)
  - Trip total = sum(all visible day totals)
- Preserve existing envelope/API conventions and ownership checks.
- Keep UI and i18n style aligned with existing budget presentation.

## Tasks / Subtasks

- [ ] Data model and migration (AC: 1, 4, 5)
  - [ ] Add nullable cost column for day plan items in Prisma schema + migration
  - [ ] Regenerate Prisma client
- [ ] Validation and API contract updates (AC: 1, 4, 5)
  - [ ] Extend day-plan mutation schema to accept optional non-negative cost
  - [ ] Include `costCents` in create/update/list API payloads
- [ ] Repository aggregation updates (AC: 2, 3, 4)
  - [ ] Persist/retrieve day plan item costs in repository methods
  - [ ] Update day subtotal and trip total calculations to include day plan item costs
  - [ ] Keep existing owner scoping and hidden/missing visibility logic
- [ ] UI changes (AC: 1, 2, 3)
  - [ ] Add cost input to `TripDayPlanDialog` add/edit flow
  - [ ] Show day item costs in day summary itemization
  - [ ] Ensure trip-level planned total reflects combined costs
- [ ] Tests and regression coverage (AC: 1-5)
  - [ ] Repository tests for mixed null/number day-item costs
  - [ ] API tests for `costCents` roundtrip and totals
  - [ ] UI tests for day subtotal and trip total including day-item costs

## Dev Notes

- Story 2.8 currently computes totals from accommodation only; this story extends that logic.
- Day summary entries in `TripDayView.tsx` already support itemization; include day-plan-item costs there.
- Keep map labels and non-budget fields unchanged.

## Technical Requirements

- Maintain existing Next.js + Prisma + MUI + Zod architecture.
- No breaking API shape changes beyond additive `costCents` fields.
- Use integer cents consistently across DB/API/UI.

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
  - `travelplan/src/components/features/trips/TripTimeline.tsx` (if trip total displayed there)

## Library & Framework Requirements

- Reuse existing MUI form controls and cost formatting patterns.
- Keep validation in Zod and data access in repository layer.

## File Structure Requirements

- Prefer extending existing files/modules, not introducing parallel budget modules.
- Keep all tests in established `travelplan/test/` locations.

## Testing Requirements

- Manual:
  - Add day plan item with cost and verify day total update.
  - Add multiple day items with costs across days and verify trip total update.
  - Verify empty-cost items remain valid and excluded from totals.
- Automated:
  - Repository aggregation tests for combined accommodation + day-item costs.
  - API tests for payload and computed totals.
  - UI tests for day summary itemization and trip total rendering.

## Previous Story Intelligence

- Story 2.7 introduced day plan item CRUD and payload shape.
- Story 2.8 introduced day/trip totals from accommodation costs only.
- Story 2.13 and 2.17 shaped current day card UI and summary panel behavior.
- Story 2.18 (ready-for-dev) extends day-entry formatting; keep compatibility with parallel editor updates.

## Git Intelligence Summary

- Budget and day-view code paths are actively used and test-covered; keep this change isolated and fully regression-tested.

## Latest Technical Information

- No new external library requirements.
- Continue integer-cent handling to avoid floating-point currency issues.

## Project Context Reference

- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/epics.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/prd.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/architecture.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/2-7-create-and-edit-day-plan-items-with-links.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/2-8-budget-totals-by-trip-and-by-day.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/2-13-day-view-plan-item-add-edit-delete-icon-actions.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/2-17-day-timeline-cards-and-gray-accommodation-background.md`

## Story Completion Status

- Status set to **ready-for-dev**.
- Completion note: Context story created for day-plan-item costs and aggregated budget roll-up at day and trip levels.

## Dev Agent Record

### Agent Model Used

Codex (GPT-5)

### Debug Log References

- Story authoring only (no implementation commands executed).

### Completion Notes List

- Defined additive cost model for day plan items.
- Specified roll-up behavior for day and trip totals.
- Added compatibility and regression constraints.

### File List

- `_bmad-output/implementation-artifacts/2-19-day-plan-item-costs-roll-up-to-day-and-trip-totals.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`

