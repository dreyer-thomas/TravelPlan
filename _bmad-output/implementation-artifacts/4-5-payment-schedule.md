# Story 4.5: Payment Schedule for Costs

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner,
I want to split a cost into a downpayment and one or more planned payments with amounts and dates,
so that the total cost reflects how I pay over time.

## Acceptance Criteria

1. Given I am creating or editing an accommodation cost or day plan item cost, when the cost section is shown, then I can choose between “Pay all now” and “Split into multiple payments.”
2. Given I choose “Pay all now,” when I save, then a single payment is stored with amount equal to the total cost and a date (defaulted, but editable).
3. Given I choose “Split into multiple payments,” when the form renders, then at least two payment rows are available and I can add or remove additional payment rows.
4. Given I enter payments, when the sum of all payment amounts does not equal the total cost amount, then I see a validation error and cannot save.
5. Given I enter payments, when any payment is missing a date or amount, then I see a validation error and cannot save.
6. Given I am editing an existing cost with no prior payment schedule, when the cost dialog opens, then it defaults to “Pay all now” with a single payment equal to the current cost.
7. Given I save a cost with a payment schedule, when I reopen the accommodation or day plan item dialog, then the payment schedule is loaded and editable.
8. Given I update a payment schedule, when I save, then the persisted payment list reflects the current rows and amounts (no stale rows remain).

## Tasks / Subtasks

- [x] Task 1: Add persistent payment schedule data model for costs.
  - [x] Subtask 1.1: Add a new Prisma model for cost payments with `amount_cents`, `due_date`, and a relation to either `accommodations` or `day_plan_items`.
  - [x] Subtask 1.2: Add indexes and constraints to prevent orphaned rows and enforce one target (accommodation OR day plan item).
  - [x] Subtask 1.3: Create migration and regenerate Prisma client types.
- [x] Task 2: Extend repositories to store and load payment schedules.
  - [x] Subtask 2.1: Update accommodation repository create/update to accept a payment list and persist it in a transaction.
  - [x] Subtask 2.2: Update day plan item repository create/update to accept a payment list and persist it in a transaction.
  - [x] Subtask 2.3: Ensure trip detail queries include payment schedules for accommodations and day plan items.
- [x] Task 3: Update API validation and routes.
  - [x] Subtask 3.1: Extend Zod schemas to accept `payments: [{ amountCents, dueDate }]` and validate sum equals `costCents`.
  - [x] Subtask 3.2: Update `/api/trips/[id]/accommodations` and `/api/trips/[id]/day-plan-items` to read/write the payment list.
  - [x] Subtask 3.3: Keep API envelope `{ data, error }` and return updated payment data on success.
- [x] Task 4: Update UI for cost entry in accommodation and day plan item dialogs.
  - [x] Subtask 4.1: Add a toggle for “Pay all now” vs “Split into multiple payments.”
  - [x] Subtask 4.2: Add a payments editor UI (amount + date per row, add/remove row).
  - [x] Subtask 4.3: Implement client-side validation for sum equals total cost and required fields.
  - [x] Subtask 4.4: Ensure schedule loads correctly when editing existing costs.
- [x] Task 5: Keep exports/imports consistent.
  - [x] Subtask 5.1: Update export JSON and import schema to include payment schedules.
  - [x] Subtask 5.2: Add fallback for existing data with no payments (treated as single payment).
- [x] Task 6: Tests.
  - [x] Subtask 6.1: Add UI tests for split payment validation and save behavior for accommodation and day plan item dialogs.
  - [x] Subtask 6.2: Add repository or API tests to ensure payment rows are replaced correctly on update.
  - [x] Subtask 6.3: Add export/import tests covering payment schedules.

## Dev Notes

### Developer Context

Costs currently live directly on `Accommodation.costCents` and `DayPlanItem.costCents`. This story adds a payment schedule without changing the meaning of `costCents` (it remains the total cost). The schedule must persist alongside these entities and load into the existing edit dialogs for accommodations and day plan items.

### Technical Requirements

- Store payments as integers in cents and dates as ISO 8601 (date-only) strings in API responses.
- Validation must enforce `sum(payments.amountCents) === costCents` when `costCents` is set.
- Allow multiple payments, but require at least two rows when “Split into multiple payments” is selected.
- Use transactional writes when saving an accommodation or day plan item with payments to avoid partial updates.
- When updating, replace the full payment list for that cost (delete old rows, create new rows) to avoid stale entries.

### Architecture Compliance

- Keep DB `snake_case`, API `camelCase`, and date formats per architecture rules.
- Preserve REST API envelope `{ data, error }` and error format `{ error: { code, message, details } }`.
- Keep feature UI under `src/components/features/trips/*` and repositories under `src/lib/repositories/*`.

### Library / Framework Requirements

- Material UI for the payments editor layout (TextField, Button, IconButton, Stack/Box).
- React Hook Form usage in `TripAccommodationDialog.tsx` should be preserved (extend with controlled fields if needed).
- Keep existing i18n patterns in `src/i18n/en.ts` and `src/i18n/de.ts`.

### File Structure Requirements

- Prisma schema: `travelplan/prisma/schema.prisma`
- Accommodation repo: `travelplan/src/lib/repositories/accommodationRepo.ts`
- Day plan item repo: `travelplan/src/lib/repositories/dayPlanItemRepo.ts`
- Trip detail aggregation: `travelplan/src/lib/repositories/tripRepo.ts`
- Accommodation API route: `travelplan/src/app/api/trips/[id]/accommodations/route.ts`
- Day plan item API route: `travelplan/src/app/api/trips/[id]/day-plan-items/route.ts`
- Validation schemas: `travelplan/src/lib/validation/accommodationSchemas.ts`, `travelplan/src/lib/validation/dayPlanItemSchemas.ts`
- UI dialogs: `travelplan/src/components/features/trips/TripAccommodationDialog.tsx`, `travelplan/src/components/features/trips/TripDayPlanDialog.tsx`
- Export/import schemas: `travelplan/src/lib/validation/tripImportSchemas.ts` and export logic under `travelplan/src/lib/repositories/tripRepo.ts`
- i18n strings: `travelplan/src/i18n/en.ts`, `travelplan/src/i18n/de.ts`
- Tests: `travelplan/test/*`

### Testing Requirements

- UI test: split payments for accommodation validates sum and blocks save if mismatch.
- UI test: split payments for day plan item validates sum and blocks save if mismatch.
- UI test: payment schedule loads when editing an existing cost.
- API/repo test: updating payments replaces prior rows (no duplicates).
- Export/import test: payment schedules round-trip correctly.

### Previous Story Intelligence

Story 4.3 (cost overview) depends on `costCents` totals. Keep totals unchanged so the cost overview remains correct without needing a redesign. Story 4.4 updated `TripTimeline` and i18n patterns; follow the same MUI spacing and i18n conventions.

### Git Intelligence Summary

Recent commits show cost overview and bucket list UI changes in `TripTimeline.tsx` and `TripCostOverview.tsx`. Avoid breaking total cost display and planned total calculations.

### Latest Tech Information

- Next.js latest release is 16.1.1; ensure security patches are applied (16.0.7+ for 16.x). 
- Prisma latest release is 7.2.0 (current architecture pins 7.3.0; avoid upgrading unless required).
- Redux Toolkit latest release is 2.11.0.
- React Hook Form latest release is 7.68.0.
- Zod latest release is 4.3.5.
- MUI latest release is 7.3.7.

### Project Context Reference

No `project-context.md` found in the repository.

### Project Structure Notes

- Trip overview uses `TripTimeline.tsx` and cost totals are derived from trip detail API data.
- Day view uses `TripDayView.tsx` with `TripDayPlanDialog` for day items and `TripAccommodationDialog` for stays.
- Trip detail API is the canonical source for accommodations, day plan items, and cost totals.

### References

- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/epics.md` (Story 4.5 definition)
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/prd.md` (FR14, FR21 budget awareness)
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/architecture.md` (stack + patterns)
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/ux-design-specification.md` (overview-first, progressive disclosure)
- `/Users/tommy/Development/TravelPlan/travelplan/prisma/schema.prisma`
- `/Users/tommy/Development/TravelPlan/travelplan/src/app/api/trips/[id]/accommodations/route.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/app/api/trips/[id]/day-plan-items/route.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/components/features/trips/TripAccommodationDialog.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/src/components/features/trips/TripDayPlanDialog.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/src/lib/validation/accommodationSchemas.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/lib/validation/dayPlanItemSchemas.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/lib/repositories/tripRepo.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/lib/repositories/accommodationRepo.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/lib/repositories/dayPlanItemRepo.ts`

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

### Completion Notes List

- ✅ Added `CostPayment` persistence with one-target constraint and transactional updates.
- ✅ Extended repositories, API routes, validation, and export/import to carry payment schedules with cost totals unchanged.
- ✅ Added payment schedule UI for accommodations and day plan items with split/single validation and load-on-edit.
- ✅ Updated tests to cover new payments workflow and ensured dialogs and cost overview expectations match.
- ✅ Added a follow-up migration with explicit `sort_order` persistence so same-date payment rows round-trip in user-defined order without rewriting the original payment migration.
- ✅ Tightened payment due-date validation to reject impossible calendar dates across API and import paths.
- ✅ Added regression coverage for the SQL one-target constraint so future Prisma migration drift is caught by tests instead of production.

### Tests

- `cd /Users/tommy/Development/TravelPlan/travelplan && npx prisma generate`
- `cd /Users/tommy/Development/TravelPlan/travelplan && npm test -- accommodationRepo.test.ts dayPlanItemRepo.test.ts tripRepo.test.ts dayPlanItemSchemas.test.ts tripImportSchemas.test.ts accommodationSchemas.test.ts`
- `cd /Users/tommy/Development/TravelPlan/travelplan && npm test`

### File List

- /Users/tommy/Development/TravelPlan/travelplan/prisma/schema.prisma
- /Users/tommy/Development/TravelPlan/travelplan/prisma/migrations/20260308120020_add_cost_payments/migration.sql
- /Users/tommy/Development/TravelPlan/travelplan/prisma/migrations/20260308173000_add_cost_payment_sort_order/migration.sql
- /Users/tommy/Development/TravelPlan/travelplan/src/lib/repositories/accommodationRepo.ts
- /Users/tommy/Development/TravelPlan/travelplan/src/lib/repositories/dayPlanItemRepo.ts
- /Users/tommy/Development/TravelPlan/travelplan/src/lib/repositories/tripRepo.ts
- /Users/tommy/Development/TravelPlan/travelplan/src/app/api/trips/[id]/accommodations/route.ts
- /Users/tommy/Development/TravelPlan/travelplan/src/app/api/trips/[id]/day-plan-items/route.ts
- /Users/tommy/Development/TravelPlan/travelplan/src/app/api/trips/[id]/route.ts
- /Users/tommy/Development/TravelPlan/travelplan/src/lib/validation/accommodationSchemas.ts
- /Users/tommy/Development/TravelPlan/travelplan/src/lib/validation/dateOnly.ts
- /Users/tommy/Development/TravelPlan/travelplan/src/lib/validation/dayPlanItemSchemas.ts
- /Users/tommy/Development/TravelPlan/travelplan/src/lib/validation/tripImportSchemas.ts
- /Users/tommy/Development/TravelPlan/travelplan/src/generated/prisma/browser.ts
- /Users/tommy/Development/TravelPlan/travelplan/src/generated/prisma/client.ts
- /Users/tommy/Development/TravelPlan/travelplan/src/generated/prisma/internal/class.ts
- /Users/tommy/Development/TravelPlan/travelplan/src/generated/prisma/internal/prismaNamespace.ts
- /Users/tommy/Development/TravelPlan/travelplan/src/generated/prisma/internal/prismaNamespaceBrowser.ts
- /Users/tommy/Development/TravelPlan/travelplan/src/generated/prisma/models.ts
- /Users/tommy/Development/TravelPlan/travelplan/src/generated/prisma/models/Accommodation.ts
- /Users/tommy/Development/TravelPlan/travelplan/src/generated/prisma/models/CostPayment.ts
- /Users/tommy/Development/TravelPlan/travelplan/src/generated/prisma/models/DayPlanItem.ts
- /Users/tommy/Development/TravelPlan/travelplan/src/components/features/trips/TripAccommodationDialog.tsx
- /Users/tommy/Development/TravelPlan/travelplan/src/components/features/trips/TripDayPlanDialog.tsx
- /Users/tommy/Development/TravelPlan/travelplan/src/components/features/trips/TripDayView.tsx
- /Users/tommy/Development/TravelPlan/travelplan/src/components/features/trips/TripTimeline.tsx
- /Users/tommy/Development/TravelPlan/travelplan/src/i18n/en.ts
- /Users/tommy/Development/TravelPlan/travelplan/src/i18n/de.ts
- /Users/tommy/Development/TravelPlan/travelplan/test/tripAccommodationDialog.test.tsx
- /Users/tommy/Development/TravelPlan/travelplan/test/tripDayPlanDialog.test.tsx
- /Users/tommy/Development/TravelPlan/travelplan/test/tripAccommodationRoute.test.ts
- /Users/tommy/Development/TravelPlan/travelplan/test/tripDayPlanItemsRoute.test.ts
- /Users/tommy/Development/TravelPlan/travelplan/test/tripDetailRoute.test.ts
- /Users/tommy/Development/TravelPlan/travelplan/test/dayPlanItemSchemas.test.ts
- /Users/tommy/Development/TravelPlan/travelplan/test/tripRepo.test.ts
- /Users/tommy/Development/TravelPlan/travelplan/test/tripImportSchemas.test.ts
- /Users/tommy/Development/TravelPlan/travelplan/test/accommodationSchemas.test.ts
- /Users/tommy/Development/TravelPlan/travelplan/test/accommodationRepo.test.ts
- /Users/tommy/Development/TravelPlan/travelplan/test/dayPlanItemRepo.test.ts
- /Users/tommy/Development/TravelPlan/travelplan/test/tripDayViewLayout.test.tsx
- /Users/tommy/Development/TravelPlan/travelplan/test/tripCostOverview.test.tsx
- /Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/4-5-payment-schedule.md
