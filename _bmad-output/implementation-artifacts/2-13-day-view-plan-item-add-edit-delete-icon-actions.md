# Story 2.13: Day View Plan Item Add Flow and Icon-Based Item Actions

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner,
I want a focused "Add plan item" flow and quick edit/delete controls on existing items,
so that I can add and manage day activities faster in day view.

## Acceptance Criteria

1. **Given** I am in day view  
   **When** I use the plan action  
   **Then** it is presented as an "Add plan item" action for creating a new item
2. **Given** I open "Add plan item"  
   **When** the add dialog opens  
   **Then** it only contains fields for creating a new item (content + optional link)  
   **And** it does not show the existing items list
3. **Given** a day already has plan items in day view  
   **When** I look at each plan item row  
   **Then** I see edit and delete icon actions on the item itself
4. **Given** I choose edit on an existing plan item  
   **When** the edit dialog opens  
   **Then** it uses the same form structure as add (content + optional link) prefilled with the item data  
   **And** it does not show the existing items list
5. **Given** I choose delete on an existing plan item  
   **When** I confirm delete  
   **Then** the item is removed and the day view list updates immediately
6. **Given** I use day view stay/plan actions  
   **When** buttons are rendered  
   **Then** action styling is aligned for accommodations and plan controls in day view (consistent hierarchy and affordance)

## Story Requirements

- Keep all existing API/repository behavior for day plan items; this story is a UI interaction refactor.
- Replace the current combined manage dialog behavior with explicit add and edit entry points.
- Move ongoing item management affordances to the item list itself (icon actions).
- Keep i18n coverage in EN/DE for any new labels/tooltips/aria text.
- Preserve accessibility: icon buttons need accessible labels and keyboard focus behavior.

## Tasks / Subtasks

- [x] Refactor day view plan primary action (AC: 1, 6)
  - [x] Update day view plan trigger text/intent to "Add plan item"
  - [x] Align accommodation and plan action button styling/placement in day view
- [x] Split plan item dialogs into add/edit modes (AC: 2, 4)
  - [x] Add mode-aware dialog props and title/submit text handling
  - [x] Ensure add dialog renders only the creation form (no existing-items list)
  - [x] Ensure edit dialog reuses same form with prefilled content/link
- [x] Add icon actions on existing item rows (AC: 3, 5)
  - [x] Render edit and delete icon buttons per plan item in day view list
  - [x] Wire edit icon to open edit mode for that item
  - [x] Wire delete icon to existing delete behavior and optimistic refresh
- [x] Accessibility and i18n (AC: 3, 6)
  - [x] Add EN/DE labels for new button text and icon tooltips/aria labels
  - [x] Verify keyboard and screen reader access for edit/delete icons
- [x] Tests (AC: 1-6)
  - [x] UI test: add dialog contains only create form and no existing-items list
  - [x] UI test: edit icon opens edit dialog with prefilled values
  - [x] UI test: delete icon removes item and updates visible list
  - [x] UI test: day view action labels for stay/plan are consistent with new copy

## Dev Notes

- The current behavior in `TripDayPlanDialog` mixes form and existing item list in one modal. This story intentionally separates concerns.
- Keep the existing API envelope and CSRF patterns unchanged.
- Prefer reusing one form component for add/edit to avoid drift.

## Developer Context

- Day view entry/action wiring currently lives in `travelplan/src/components/features/trips/TripDayView.tsx`.
- Day plan modal logic currently lives in `travelplan/src/components/features/trips/TripDayPlanDialog.tsx`.
- Existing day plan item list rendering is in day view timeline and already has plan item data loaded.

## Technical Requirements

- UI only; no Prisma schema changes, no repository contract changes, no new endpoints required.
- Keep existing endpoints:
  - `GET /api/trips/[id]/day-plan-items?tripDayId=...`
  - `POST /api/trips/[id]/day-plan-items`
  - `PATCH /api/trips/[id]/day-plan-items`
  - `DELETE /api/trips/[id]/day-plan-items`
- Use icon buttons for edit/delete (`IconButton`) with MUI icons and localized `aria-label`.

## Architecture Compliance

- UI changes remain under `src/components/features/trips/*`.
- Keep API and repository boundaries unchanged.
- Preserve camelCase API payloads and existing response envelope.

## Library & Framework Requirements

- Next.js App Router + React client components.
- Material UI components/icons for row-level actions.
- Keep TipTap editor usage for plan content input.

## File Structure Requirements

- Update `travelplan/src/components/features/trips/TripDayView.tsx`
- Update `travelplan/src/components/features/trips/TripDayPlanDialog.tsx`
- Optional add: `travelplan/src/components/features/trips/TripDayPlanItemForm.tsx` (if extraction helps shared add/edit form)
- Update i18n:
  - `travelplan/src/i18n/en.ts`
  - `travelplan/src/i18n/de.ts`
- Update/add tests:
  - `travelplan/test/tripDayViewLayout.test.tsx`
  - `travelplan/test/tripDayPlanDialog.test.tsx`

## Testing Requirements

- Manual:
  - Open day view, click "Add plan item", verify only add form is shown.
  - Add an item, verify it appears in day view list with edit/delete icons.
  - Click edit icon, verify prefilled form and successful update.
  - Click delete icon, verify item removal and updated list without full page reload.
- Automated:
  - Dialog mode tests for add/edit separation.
  - Day view row action tests for icon affordances and behavior.
  - i18n/aria checks for icon labels.

## Previous Story Intelligence

- Story 2.7 implemented plan item CRUD and dialog patterns.
- Story 2.12 moved plan/stay actions into day view and removed overview action buttons.
- This story refines interaction ergonomics without changing backend contracts.

## Git Intelligence Summary

- Existing implementation already centralizes day plan CRUD in `TripDayPlanDialog`.
- Refactor should preserve current fetch + CSRF + envelope patterns and focus on component responsibilities.

## Project Context Reference

- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/epics.md#Story 2.7: Create and Edit Day Plan Items With Links`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/epics.md#Story 2.12: Day View Detail Layout With Overview Toggle`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/ux-design-specification.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/2-7-create-and-edit-day-plan-items-with-links.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/2-12-day-view-detail-layout-with-overview-toggle.md`
- `/Users/tommy/Development/TravelPlan/travelplan/src/components/features/trips/TripDayView.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/src/components/features/trips/TripDayPlanDialog.tsx`

## Story Completion Status

- Status set to **ready-for-dev**.
- Completion note: Context story created for day view plan add/edit/delete interaction refactor with icon-based item actions and split add/edit flows.

## Dev Agent Record

### Agent Model Used

Codex (GPT-5)

### Debug Log References

- `npm test -- tripDayViewLayout.test.tsx` (red phase: failed on missing `Add plan item` action)
- `npm test -- tripDayPlanDialog.test.tsx tripDayViewLayout.test.tsx` (green phase for story-specific tests)
- `npm test` (full suite: 40 files, 125 tests passing)
- `npm run lint` (passes with existing baseline warnings)
- `npm test -- tripDayPlanDialog.test.tsx tripDayViewLayout.test.tsx` (post-review remediation verification)
- `npm test` (post-review remediation full suite: 40 files, 125 tests passing)

### Implementation Plan

- Convert `TripDayPlanDialog` from mixed manage modal to mode-driven form dialog (`add`/`edit`) with shared content/link form.
- Keep top day-view plan trigger as creation-only action (`Add plan item`) and move edit/delete affordances to each plan row.
- Implement row delete with optimistic UI update, confirm prompt, and existing CSRF + API envelope behavior.
- Add localized EN/DE keys for new copy, dialog titles, delete confirm, and icon-button aria/tooltips.
- Extend UI tests to validate add/edit dialog split, icon actions, and day-view action labeling.

### Completion Notes List

- Refactored `TripDayPlanDialog` to support explicit `add`/`edit` modes and removed embedded existing-items list from dialog content.
- Updated `TripDayView` to always present `Add plan item` as the primary plan action, preserving stay/plan action alignment.
- Added row-level edit/delete icon actions for plan items with localized accessible labels and keyboard-focusable `IconButton` controls.
- Wired edit icon to open dialog in edit mode with prefilled item content/link.
- Wired delete icon to optimistic removal + confirm flow using existing `DELETE /day-plan-items` endpoint and CSRF token handling.
- Added EN/DE localization keys for new plan action, dialog titles, icon aria labels, delete confirmation, and edit-mode guard error.
- Added/updated tests covering form-only add dialog, edit prefill behavior, row icon actions, and delete list refresh behavior.
- Hardened day-view delete rollback to restore only the failed item (prevents stale full-list rollback during concurrent delete interactions).
- Improved delete failure handling to show network-specific errors instead of reporting all exceptions as CSRF failures.
- Added day-view wiring test coverage proving edit icon opens dialog in `edit` mode with selected item prefilled.
- Recorded non-story workspace git changes (Codex cache files and upload fixtures) as out-of-scope for this story implementation.

### File List

- `_bmad-output/implementation-artifacts/2-13-day-view-plan-item-add-edit-delete-icon-actions.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `travelplan/src/components/features/trips/TripDayView.tsx`
- `travelplan/src/components/features/trips/TripDayPlanDialog.tsx`
- `travelplan/src/i18n/en.ts`
- `travelplan/src/i18n/de.ts`
- `travelplan/test/tripDayViewLayout.test.tsx`
- `travelplan/test/tripDayPlanDialog.test.tsx`
- `.codex/.codex-global-state.json` (out-of-scope workspace state)
- `.codex/models_cache.json` (out-of-scope workspace state)
- `.codex/vendor_imports/skills-curated-cache.json` (out-of-scope workspace state)
- `travelplan/public/uploads/trips/cmlmrreds000ewtdy1lcuh0tp/hero.webp` (out-of-scope fixture churn)
- `travelplan/public/uploads/trips/cmlmsq7ll000enadywmwfx37n/` (out-of-scope fixture churn)

## Change Log

- 2026-02-14: Implemented day-view plan-item UX refactor (add-only primary action, mode-based add/edit dialog, row icon edit/delete actions), updated EN/DE strings, and expanded UI tests for AC 1-6.
- 2026-02-14: Completed code-review remediation: fixed delete rollback/error handling edge cases, added edit-icon wiring test evidence, reconciled git/file-list documentation, and set story to done.
