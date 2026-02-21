# Story 2.18: Rich Text Editor Formatting and Rendered Day Items

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner,
I want formatting options in the day-entry editor (for example image, italic, bold, lists, and links),
so that I can structure richer notes and see the same formatting rendered in day item cards.

## Acceptance Criteria

1. **Given** I open add/edit for a day plan item
   **When** the editor is shown
   **Then** I can access formatting controls including italic and image insertion in addition to existing rich-text actions
2. **Given** I apply formatting in the editor
   **When** I save the day plan item
   **Then** formatting is persisted in stored content without losing existing data compatibility
3. **Given** a day plan item contains formatted content
   **When** it is rendered in day view timeline cards
   **Then** the visible content reflects formatting (for example italic text and embedded images) instead of plain-text stripping
4. **Given** an older day plan item without new formatting
   **When** it renders in day view
   **Then** it continues to display correctly with no regression
5. **Given** I use mobile or desktop
   **When** formatted content is rendered in cards
   **Then** layout remains readable and images stay constrained to the card width

## Story Requirements

- Extend the day plan editor toolbar to expose required formatting controls (minimum: italic + image).
- Preserve existing serialization approach for day plan item `contentJson`.
- Replace plain-text-only preview rendering in day timeline cards with safe rich-text rendering from stored document JSON.
- Do not introduce unsafe HTML rendering; rendering must stay schema-driven and sanitized.
- Keep existing add/edit/delete day plan flows and i18n behavior unchanged.

## Tasks / Subtasks

- [x] Extend day plan editor formatting controls (AC: 1)
  - [x] Add italic action if not exposed in current toolbar
  - [x] Add image insertion flow using existing image URL/gallery approach where possible
  - [x] Keep keyboard/editor behavior stable for current shortcuts and link insertion
- [x] Persist and validate formatted day-plan content (AC: 2, 4)
  - [x] Ensure API validation accepts document structures with formatting marks and image nodes used by the editor
  - [x] Confirm create/update endpoints store and return formatted content without data loss
- [x] Render formatted content in day cards (AC: 3, 5)
  - [x] Replace `parsePlanText(...)` summary-only rendering with rich-text renderer for card body
  - [x] Constrain inline images/media for responsive card layout
  - [x] Keep link behavior and item actions (edit/delete) intact
- [x] Add regression and feature coverage tests (AC: 1-5)
  - [x] Component test for toolbar controls visibility and save behavior
  - [x] Day view test to assert formatted text (italic) and images render in timeline items
  - [x] Regression test for legacy plain items still rendering

## Dev Notes

- Current plain-text extraction is in `travelplan/src/components/features/trips/TripDayView.tsx` via `parsePlanText(...)`; this should remain only where a short label is required (for example map/budget labels), not as primary card content.
- Editor implementation is in `travelplan/src/components/features/trips/TripDayPlanDialog.tsx`; align toolbar configuration with TipTap usage already present in the project.
- Story 2.16 already introduced image galleries for plan items. Reuse existing image patterns where feasible to avoid parallel image mechanisms.

## Technical Requirements

- Stack remains Next.js + React + Material UI + TipTap 3.
- No schema-breaking migration required unless editor data shape mandates it.
- Maintain compatibility with existing `dayPlanItemSchemas` validation and repository contracts.

## Architecture Compliance

- UI/editor changes stay in `src/components/features/trips/*`.
- Validation/API changes (if needed) stay in:
  - `travelplan/src/lib/validation/dayPlanItemSchemas.ts`
  - `travelplan/src/app/api/trips/[id]/day-plan-items/route.ts`
- No unrelated route/repository behavior changes.

## Library & Framework Requirements

- Use TipTap node/mark extensions already present in project dependencies.
- Continue to use MUI components for toolbar/buttons/layout.
- Avoid `dangerouslySetInnerHTML`; render from structured editor document.

## File Structure Requirements

- `travelplan/src/components/features/trips/TripDayPlanDialog.tsx`
- `travelplan/src/components/features/trips/TripDayView.tsx`
- `travelplan/src/lib/validation/dayPlanItemSchemas.ts` (if required)
- `travelplan/test/tripDayPlanDialog.test.tsx`
- `travelplan/test/tripDayViewLayout.test.tsx`

## Testing Requirements

- Manual:
  - Create and edit a day plan item with italic text and an image.
  - Verify the same formatting renders in day timeline cards.
  - Verify old plain entries still render.
  - Verify mobile layout keeps rendered images within card bounds.
- Automated:
  - Unit/component coverage for editor controls and persistence.
  - Day view rendering test for formatted output (text marks + images).
  - Regression coverage for legacy entries and actions.

## Previous Story Intelligence

- Story 2.7 established day plan item rich-text persistence with links.
- Story 2.13 established add/edit/delete flows and icon actions in day view.
- Story 2.16 introduced plan-item image galleries; avoid duplicating image storage flows.
- Story 2.17 moved day timeline to card-based rendering; ensure formatted content works inside this card layout.

## Git Intelligence Summary

- Recent work touched `TripDayView.tsx` heavily for card layout and media previews.
- Keep changes focused and test-backed to reduce regression in timeline interactions.

## Latest Technical Information

- TipTap supports marks/nodes for italic and image in current major line used by project; prefer extension-driven rendering over HTML injection.
- Preserve JSON document compatibility to avoid migration churn.

## Project Context Reference

- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/epics.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/architecture.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/ux-design-specification.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/2-7-create-and-edit-day-plan-items-with-links.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/2-13-day-view-plan-item-add-edit-delete-icon-actions.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/2-16-accommodation-and-plan-item-image-galleries.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/2-17-day-timeline-cards-and-gray-accommodation-background.md`

## Story Completion Status

- Status set to **ready-for-dev**.
- Completion note: Context story created for rich-text formatting controls and formatted day-item rendering.

## Dev Agent Record

### Agent Model Used

Codex (GPT-5)

### Debug Log References

- Implemented TipTap toolbar actions (bold/italic/bullets/link/image) and image node extension support in `TripDayPlanDialog`.
- Replaced summary-only day card content with safe schema-driven rich renderer in `TripDayView` and constrained inline image layout.
- Extended day plan content validation to accept image-node-only docs while keeping empty docs invalid.
- Added regression and feature tests for toolbar actions, rich card rendering, schema acceptance, and API persistence.
- Review fixes: enforced `http(s)` URL safety in `dayPlanItemSchemas` for `linkUrl` and image-node `src`, and guarded rendered external links in `TripDayView`.
- Review fixes: replaced per-item day-plan gallery requests with a batched day-level fetch in the day-plan image API + `TripDayView`.
- Review fixes: localized rich-render image alt fallback using `trips.plan.inlineImageAlt`.
- Validation: `npm test` passed (55 files, 225 tests). `npm run lint` reports pre-existing repo errors unrelated to this story.

### Completion Notes List

- Added editor toolbar controls in the day plan dialog for bold, italic, bullets, link insertion, and image insertion.
- Added TipTap image node support so inserted image URLs persist in `contentJson`.
- Implemented schema-driven rich content rendering in timeline cards (marks, lists, links, and inline images) without unsafe HTML injection.
- Kept `parsePlanText(...)` for budget/map labels while rendering full rich content in card bodies.
- Added image-node-aware validation and API route test coverage to confirm formatted content round-trips without data loss.
- Added regression tests confirming legacy plain-text entries still render correctly.
- Fixed code review findings: blocked non-`http(s)` external URLs at validation/render boundaries and removed day-plan image N+1 requests via batched retrieval.
- Added regression tests for unsafe URL rejection and day-level plan-image batch API behavior.

### File List

- `_bmad-output/implementation-artifacts/2-18-rich-text-editor-formatting-and-rendered-day-items.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `travelplan/src/components/features/trips/TripDayPlanDialog.tsx`
- `travelplan/src/components/features/trips/TripDayView.tsx`
- `travelplan/src/app/api/trips/[id]/day-plan-items/images/route.ts`
- `travelplan/src/lib/validation/dayPlanItemSchemas.ts`
- `travelplan/src/lib/repositories/dayPlanItemRepo.ts`
- `travelplan/src/i18n/en.ts`
- `travelplan/src/i18n/de.ts`
- `travelplan/test/tripDayPlanDialog.test.tsx`
- `travelplan/test/tripDayViewLayout.test.tsx`
- `travelplan/test/dayPlanItemSchemas.test.ts`
- `travelplan/test/tripDayPlanItemsRoute.test.ts`
- `travelplan/test/tripDayPlanItemImagesRoute.test.ts`

## Change Log

- 2026-02-21: Implemented rich text editor toolbar/image insertion, rich day card rendering, validation updates, and regression coverage for Story 2.18.
- 2026-02-21: Applied code-review fixes for URL safety, batched day-plan image loading, and localized rich-render image fallback text; updated coverage and revalidated with full test suite.
