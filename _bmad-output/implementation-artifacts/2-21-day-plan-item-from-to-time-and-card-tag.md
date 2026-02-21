# Story 2.21: Day Plan Item From/To Time and Card Tag

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner,
I want every day plan item to include a from time and a to time,
so that each entry clearly shows its scheduled time window.

## Acceptance Criteria

1. **Given** I create or edit a day plan item
   **When** either `fromTime` or `toTime` is missing
   **Then** save is blocked with validation errors
2. **Given** I create or edit a day plan item
   **When** I provide valid `fromTime` and `toTime`
   **Then** both values are persisted with the item
3. **Given** I create or edit a day plan item
   **When** `toTime` is equal to or earlier than `fromTime`
   **Then** save is blocked with a validation error
4. **Given** a day plan item has valid `fromTime` and `toTime`
   **When** it is shown in day view
   **Then** the card shows a time-range tag formatted as `HH:mm - HH:mm`
5. **Given** I update `fromTime` or `toTime`
   **When** I save and reopen day view
   **Then** the card tag reflects the updated range
6. **Given** legacy day plan items may not yet have times
   **When** they are loaded in day view
   **Then** UI renders without regression, and edit/save enforces required times

## Story Requirements

- Add `fromTime` and `toTime` fields to day plan items.
- Enforce required values for create/update in validation and UI.
- Enforce ordering rule: `toTime` must be strictly later than `fromTime`.
- Render a visible time-range tag on each day plan card in day view.
- Keep existing title, rich content, cost, and link behaviors unchanged.
- Preserve backward compatibility for loading legacy records during migration.

## Tasks / Subtasks

- [ ] Data model and migration (AC: 2, 6)
  - [ ] Add day plan item `fromTime` and `toTime` columns in Prisma schema + migration
  - [ ] Decide storage shape (recommended: time-only string `HH:mm` or normalized minute-of-day integer)
  - [ ] Define migration strategy for existing rows (nullable transition + app enforcement)
- [ ] Validation and API updates (AC: 1, 2, 3, 5)
  - [ ] Extend day-plan Zod schema to require both times
  - [ ] Add cross-field validation (`toTime > fromTime`)
  - [ ] Include both time fields in API create/update/list payloads
- [ ] Repository updates (AC: 2, 5, 6)
  - [ ] Persist/read both times in `dayPlanItemRepo`
  - [ ] Ensure trip detail routes include the new fields
- [ ] UI updates (AC: 1, 3, 4, 5)
  - [ ] Add `from` and `to` time inputs to `TripDayPlanDialog`
  - [ ] Show inline validation messages for missing/invalid ranges
  - [ ] Add time-range tag on day plan item card in `TripDayView`
- [ ] Tests (AC: 1-6)
  - [ ] Validation tests for required fields and ordering rules
  - [ ] API tests for time range roundtrip
  - [ ] UI tests for dialog validation and tag rendering format
  - [ ] Regression tests for legacy items without times

## Dev Notes

- Day item rendering currently centers on title/content/cost; add a dedicated time tag element without replacing existing content blocks.
- Keep formatting consistent with current MUI chip/tag patterns used elsewhere in day and timeline views.
- If time-only DB type is not available in current Prisma/provider setup, store as canonical `HH:mm` strings and validate strictly.

## Technical Requirements

- Time format displayed and stored in canonical 24-hour `HH:mm`.
- Validation must reject invalid values (`24:00`, `9:7`, non-time strings).
- Cross-field rule must be deterministic and timezone-independent for same-day items.
- No new third-party dependency is required.

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
  - `travelplan/src/i18n/en.ts`
  - `travelplan/src/i18n/de.ts`

## Library & Framework Requirements

- Reuse existing MUI form controls and error presentation style.
- Keep validation in Zod and persistence in repository layer.
- Keep i18n-driven labels and helper messages.

## File Structure Requirements

- Extend current day-plan item modules only.
- Keep tests under existing `travelplan/test/` structure.

## Testing Requirements

- Manual:
  - Add item with missing times and confirm validation blocks save.
  - Add item with valid range and verify tag on day card.
  - Edit times and verify updated tag.
  - Verify legacy items still display and can be updated.
- Automated:
  - Schema tests for required/ordered time fields.
  - API route tests for create/update/list payload with times.
  - Component tests for dialog validation and card tag render.

## Previous Story Intelligence

- Story 2.7 established day plan item CRUD flow.
- Story 2.13 established day-view action and card editing patterns.
- Story 2.18 established rich content rendering in day cards.
- Story 2.20 introduced required title and title-first card scanning.

## Git Intelligence Summary

- Day-plan implementation is concentrated in dialog, day view, and repo/schema layers.
- Keep this change scoped to existing pathways to minimize regressions.

## Latest Technical Information

- No external package changes required for time input/tag rendering.
- Native HTML/MUI time input plus Zod validation is sufficient.

## Project Context Reference

- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/epics.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/architecture.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/prd.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/2-7-create-and-edit-day-plan-items-with-links.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/2-13-day-view-plan-item-add-edit-delete-icon-actions.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/2-18-rich-text-editor-formatting-and-rendered-day-items.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/2-20-day-entry-title-in-day-view-and-cost-list.md`

## Story Completion Status

- Status set to **ready-for-dev**.
- Completion note: Context story created for required from/to times and day-card time-range tags.

## Dev Agent Record

### Agent Model Used

Codex (GPT-5)

### Debug Log References

- Added story context and sprint tracking entry for 2.21.

### Completion Notes List

- Defined required from/to time fields and validation rules.
- Added explicit card tag rendering requirements with canonical format.
- Added migration and legacy compatibility guardrails.

### File List

- `_bmad-output/planning-artifacts/epics.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/implementation-artifacts/2-21-day-plan-item-from-to-time-and-card-tag.md`
