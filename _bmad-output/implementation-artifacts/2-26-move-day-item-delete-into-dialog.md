# Story 2.26: Move Day Item Delete Into Dialog

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner,
I want deletion of day plan items to be moved into the edit dialog,
so that I don’t accidentally delete items by misclicking small adjacent buttons.

## Acceptance Criteria

1. **Given** I am viewing a trip day in day view  
   **When** I look at a day plan item card  
   **Then** the inline delete icon button is no longer shown on the card
2. **Given** I open the edit dialog for a day plan item  
   **When** the dialog is displayed  
   **Then** a “Delete” action is available in the dialog footer, aligned to the lower left of the “Save changes” action
3. **Given** I click “Delete” in the dialog  
   **When** I confirm the deletion (if confirmation is required)  
   **Then** the day plan item is removed and the dialog closes
4. **Given** I delete a day plan item  
   **When** I return to day view  
   **Then** the timeline and budget list update without a full page refresh
5. **Given** I open the dialog for a new (unsaved) day plan item  
   **When** the dialog shows actions  
   **Then** the “Delete” action is not shown

## Tasks / Subtasks

- [ ] UI: remove inline delete icon from day plan item card (AC: 1)
- [ ] UI: add delete action to day plan item dialog footer (AC: 2, 5)
- [ ] Behavior: wire delete action to existing delete flow and close dialog (AC: 3)
- [ ] State update: ensure day view updates without full refresh (AC: 4)

## Dev Notes

- Preserve existing delete confirmation behavior if present; do not introduce accidental deletes.
- Keep dialog actions aligned with Material UI patterns (secondary left, primary right).
- Maintain existing keyboard and accessibility behavior.

### Project Structure Notes

- Day view list cards: `travelplan/src/components/features/trips/TripDayView.tsx`.
- Dialog for day plan items: `travelplan/src/components/features/trips/TripDayPlanDialog.tsx`.
- No API or schema changes required.

### References

- `_bmad-output/implementation-artifacts/2-13-day-view-plan-item-add-edit-delete-icon-actions.md` (current edit/delete icon behavior)
- `_bmad-output/implementation-artifacts/2-21-day-plan-item-from-to-time-and-card-tag.md` (day item UI patterns)
- `_bmad-output/planning-artifacts/ux-design-specification.md` (button hierarchy, dialog patterns)
- `_bmad-output/planning-artifacts/architecture.md` (component boundaries)

## Technical Requirements

- Remove the inline delete icon from the day item card; keep edit icon.
- Add a dialog footer “Delete” button only when editing an existing item.
- Reuse existing delete confirmation and delete API call.
- Ensure post-delete state updates the day view and budget summary without full refresh.
- UI-only changes; no data model or API changes.

## Architecture Compliance

- Keep changes in feature components; no new shared utilities required.
- Maintain existing API response formats and repository boundaries.

## Library & Framework Requirements

- Material UI dialog/actions for placement and styling.
- No new dependencies.

## File Structure Requirements

- Update only `TripDayView.tsx` and `TripDayPlanDialog.tsx` unless a small shared helper already exists.

## Testing Requirements

- UI test: delete icon is removed from day item card.
- UI test: delete action appears in edit dialog only for existing items.
- UI test: delete from dialog removes item and updates view.

## Previous Story Intelligence

- Story 2.13 added the existing edit/delete icon actions and day view patterns.
- Story 2.21 established day item card structure and time tag UX.

## Git Intelligence Summary

- Day view changes are recent; keep this as a small UI adjustment to avoid regressions.

## Project Context Reference

- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/epics.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/architecture.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/prd.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/ux-design-specification.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/2-13-day-view-plan-item-add-edit-delete-icon-actions.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/2-21-day-plan-item-from-to-time-and-card-tag.md`

## Story Completion Status

- Status set to **ready-for-dev**.
- Completion note: Delete action moved into day plan item dialog; inline card delete removed.

## Dev Agent Record

### Agent Model Used

Codex (GPT-5)

### Debug Log References

- Built story context for moving delete action into day item dialog.

### Completion Notes List

- Remove inline delete icon; add dialog delete action for existing items only.
- Maintain confirmation and refreshless state updates.

### File List

- `_bmad-output/implementation-artifacts/2-26-move-day-item-delete-into-dialog.md`
- `_bmad-output/implementation-artifacts/2-13-day-view-plan-item-add-edit-delete-icon-actions.md`
- `_bmad-output/implementation-artifacts/2-21-day-plan-item-from-to-time-and-card-tag.md`
- `_bmad-output/planning-artifacts/epics.md`
- `_bmad-output/planning-artifacts/architecture.md`
- `_bmad-output/planning-artifacts/prd.md`
- `_bmad-output/planning-artifacts/ux-design-specification.md`
