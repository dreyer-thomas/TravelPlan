# Story 6.6: Match Day Item Photo UX to Accommodations

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner,
I want day item photo management to work like the accommodation photo flow,
so that adding and managing photos feels consistent and easier across the day view.

## Acceptance Criteria

1. Given I edit a day item that already supports image galleries, when I open its dialog, then the photo section uses the same interaction pattern as the accommodation dialog for selecting and uploading files and I do not have to use a more cumbersome or separate workflow than accommodations.
2. Given I select multiple photos for a day item, when I upload them, then the system accepts the same multi-file add behavior used for accommodations and the uploaded images appear in the saved gallery for that day item.
3. Given a day item already has uploaded photos, when the photo list is shown in the dialog, then it uses the same compact thumbnail-and-action presentation as accommodations and it remains easy to review and remove photos without extra text-heavy controls.
4. Given I click a photo thumbnail for a day item, when I want to inspect it, then the same enlarged preview behavior used by accommodations is available.
5. Given day item photos already exist from earlier stories, when this UX refinement is implemented, then existing image persistence, ordering, authorization, and day-view mini-strip rendering continue to work and accommodation photo behavior remains unchanged.
6. Given I use the day item photo flow on desktop or mobile, when I add or manage photos, then the controls remain understandable and usable in both languages and on both screen sizes.

## Tasks / Subtasks

- [x] Task 1: Align the day item gallery upload affordance with the accommodation gallery pattern. (AC: 1, 2, 6)
  - [x] Update `TripDayPlanDialog.tsx` to accept multi-file selection the same way `TripAccommodationDialog.tsx` does.
  - [x] Replace the current single-file upload state with the same selected-files summary and one-click upload flow used by accommodations.
  - [x] Keep CSRF, auth, and existing route contracts intact while reusing the current day-plan-item gallery endpoint.
- [x] Task 2: Match the day item gallery list presentation to accommodations without regressing existing behavior. (AC: 3, 4, 5, 6)
  - [x] Render saved day item images with the same compact thumbnail row and remove-icon affordance used by accommodations.
  - [x] Preserve fullscreen preview-on-thumbnail-click behavior and keep lazy-loaded thumbnails.
  - [x] Remove or simplify text-heavy per-image controls that make day item photo management feel busier than accommodation photo management.
- [x] Task 3: Preserve gallery data semantics and existing output surfaces. (AC: 5)
  - [x] Keep persisted day-plan-item image ordering stable and compatible with existing `sortOrder` handling and tests.
  - [x] Do not change accommodation gallery behavior, persistence schema, or API contracts as part of this story.
  - [x] Keep day-view mini-strip rendering and `+N` overflow behavior unchanged for saved day item images.
- [x] Task 4: Update localization and regression coverage for the refined day item photo UX. (AC: 1, 2, 3, 4, 5, 6)
  - [x] Update `travelplan/src/i18n/en.ts` and `travelplan/src/i18n/de.ts` only where the day item gallery copy needs to match the accommodation interaction.
  - [x] Extend `travelplan/test/tripDayPlanDialog*.test*` or equivalent coverage for multi-file selection, upload, thumbnail preview, and compact remove actions.
  - [x] Extend `travelplan/test/tripDayViewLayout.test.tsx` only as needed to prove saved gallery output remains unchanged.

## Dev Notes

### Developer Context

This is a targeted Epic 6 usability refinement, not a new gallery capability story. Story 2.16 already delivered gallery persistence for both accommodations and day plan items, but the current dialog UX has drifted: accommodations now provide a cleaner multi-file upload flow and lighter thumbnail/remove interaction, while day plan items still use a more cumbersome single-file, text-heavy management pattern.

The implementation goal is to copy the accommodation gallery interaction model into the day item dialog. Reuse the accommodation UX shape rather than inventing a third photo-management pattern. Keep the scope tightly focused on the day-plan-item edit dialog and preserve the existing gallery data model, endpoints, and day-view rendering.

### Technical Requirements

- Reuse the existing day-plan-item gallery API at `POST/DELETE/PATCH /api/trips/[id]/day-plan-items/images`; do not introduce a new gallery endpoint.
- Preserve the current `GalleryImage` data shape and `sortOrder` semantics already used by day-plan-item image persistence.
- Move day item uploads from single-file selection to the same multi-file selection/upload pattern already used in `TripAccommodationDialog.tsx`.
- Match the saved-image UI to the accommodation gallery pattern: compact thumbnail row, click-to-preview, and icon-first remove action.
- Avoid broad refactors of the plan-item editor, rich text editor, or non-photo item fields.

### Architecture Compliance

- Primary implementation seam: `travelplan/src/components/features/trips/TripDayPlanDialog.tsx`
- Reference interaction source: `travelplan/src/components/features/trips/TripAccommodationDialog.tsx`
- Existing API contract to preserve: `travelplan/src/app/api/trips/[id]/day-plan-items/images/route.ts`
- Existing validation and repository logic to preserve: `travelplan/src/lib/validation/imageGallerySchemas.ts`, `travelplan/src/lib/repositories/dayPlanItemRepo.ts`
- Keep API envelope conventions as `{ data, error }` and maintain the current auth + CSRF behavior.

### Library / Framework Requirements

- Stay on the current pinned UI stack in `travelplan/package.json`, especially `next@16.1.6`, `react@19.2.3`, `@mui/material@7.3.8`, and `react-hook-form@7.71.1`.
- Reuse the current MUI dialog, button, typography, and image-box patterns already present in the accommodation and day-item dialogs.
- Do not add dependencies for drag-and-drop uploads or gallery widgets as part of this refinement.

### File Structure Requirements

- Primary UI file: `travelplan/src/components/features/trips/TripDayPlanDialog.tsx`
- Reference-only comparison file: `travelplan/src/components/features/trips/TripAccommodationDialog.tsx`
- Supporting i18n updates if needed: `travelplan/src/i18n/en.ts`, `travelplan/src/i18n/de.ts`
- Existing gallery route to preserve: `travelplan/src/app/api/trips/[id]/day-plan-items/images/route.ts`
- Tests to extend: `travelplan/test/tripDayViewLayout.test.tsx` plus any focused `TripDayPlanDialog` or route coverage already present in `travelplan/test/*`

### Testing Requirements

- UI test: day item gallery accepts multiple selected files before upload and submits them through the existing image endpoint flow.
- UI test: saved day item gallery rows use compact thumbnail/remove controls consistent with accommodations.
- UI test: clicking a saved day item image still opens the fullscreen preview.
- Regression test: existing day item gallery persistence and day-view mini-strip rendering still work after the dialog UX change.
- Manual check: English and German labels remain understandable on desktop and mobile widths.

### Previous Story Intelligence

- Story 2.16 established the shared image-gallery persistence model for accommodations and day plan items, including ownership checks, upload/delete/reorder routes, and day-view mini-strip rendering.
- Story 2.14 established the project's image upload conventions and the expectation that image changes should update the UI immediately without leaving stale preview state behind.
- The current codebase shows that accommodation gallery UX has evolved into the cleaner reference interaction while day item gallery UX has not yet been brought up to the same standard.

### Git Intelligence Summary

- Recent Epic 6 commits have stayed tightly scoped to targeted usability refinements rather than large data-model changes.
- The lowest-risk implementation path is to adapt `TripDayPlanDialog.tsx` toward the gallery interaction already implemented in `TripAccommodationDialog.tsx`.
- Current `TripDayPlanDialog.tsx` still uses single-file selection plus text-heavy move/delete controls, which matches the user’s reported usability issue.

### Latest Tech Information

- No external web research was performed for this story context.
- Local repo versions from `travelplan/package.json` confirm the current implementation baseline: Next.js `16.1.6`, React `19.2.3`, Material UI `7.3.8`, Prisma `7.3.0`, and Zod `4.1.11`.

### Project Context Reference

No `project-context.md` file was found in this repository.

### References

- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/epics.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/architecture.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/prd.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/ux-design-specification.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/2-14-add-image-to-day.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/2-16-accommodation-and-plan-item-image-galleries.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/6-5-auto-fill-travel-segments-from-google-maps.md`
- `/Users/tommy/Development/TravelPlan/travelplan/src/components/features/trips/TripAccommodationDialog.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/src/components/features/trips/TripDayPlanDialog.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/src/app/api/trips/[id]/day-plan-items/images/route.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/lib/repositories/dayPlanItemRepo.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/lib/validation/imageGallerySchemas.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/test/tripDayViewLayout.test.tsx`

## Story Completion Status

- Status set to **ready-for-dev**.
- Completion note: Ready-for-dev context created for a narrow Epic 6 UX refinement that aligns day item photo management with the existing accommodation gallery behavior.

## Dev Agent Record

### Agent Model Used

Codex (GPT-5)

### Implementation Plan

- Replace the day-item gallery's single-file state and upload action with the accommodation-style multi-file batch flow while preserving the existing image route, CSRF handling, and auth contract.
- Swap the saved-image controls in `TripDayPlanDialog.tsx` from move-up/move-down text actions to the accommodation-style compact thumbnail row with icon-only remove and existing fullscreen preview.
- Extend focused dialog tests for multi-file upload, compact saved-image actions, and fullscreen preview; rely on the existing `tripDayViewLayout.test.tsx` mini-strip regression to validate unchanged day-view output.

### Debug Log References

- User requested a new Epic 6 story because adding photos to day items feels worse than the accommodation photo flow.
- Existing planning artifacts and sprint tracking did not yet contain this story, so Story 6.6 was added before generating the implementation context.
- Current code inspection confirmed the usability gap is in `TripDayPlanDialog.tsx`, not the day-level image dialog: accommodations already support multi-file upload and compact thumbnail/remove controls, while day items still use a more cumbersome photo workflow.
- Architecture and UX guidance both support keeping this as a focused consistency refinement rather than a new media feature.
- The workflow's validator task file `_bmad/core/tasks/validate-workflow.xml` was not present in this repository, so checklist validation could not be executed through the BMAD validator.
- Implemented the day-item gallery refinement directly in `travelplan/src/components/features/trips/TripDayPlanDialog.tsx` without touching the gallery API route, persistence schema, or accommodation dialog behavior.
- Added a localized selected-file summary key for the day-item gallery in `en.ts` and `de.ts` after review found the new summary text was hard-coded in English.
- Ran focused validation on `tripDayPlanDialog.test.tsx` and `tripDayViewLayout.test.tsx`, then ran the full `npm test` suite and `npm run lint` baseline.
- Senior Developer Review (AI) found and fixed missing on-demand CSRF fetch parity, untranslated gallery selection copy, and partial multi-file upload UI drift in `TripDayPlanDialog.tsx`, with regression tests added for each case.

### Completion Notes List

- Added Story 6.6 to Epic 6 in `epics.md` with acceptance criteria centered on day-item photo UX parity with accommodations.
- Created the ready-for-dev context file for `6-6-match-day-item-photo-ux-to-accommodations` with implementation guardrails aimed at reusing the accommodation gallery interaction model.
- Registered the story in sprint tracking with status `ready-for-dev`.
- Scoped the story to the day-plan-item dialog UX only, explicitly preserving gallery persistence, auth, and day-view rendering behavior.
- Updated `TripDayPlanDialog.tsx` to support accommodation-style multi-file selection, selected-file count feedback, sequential upload through the existing day-plan-item image endpoint, and state reset after upload.
- Matched the accommodation dialog's on-demand CSRF token fetch for gallery upload/delete actions so day-item gallery actions no longer silently no-op when initial token loading fails.
- Localized the selected-file summary for the refined gallery flow in both English and German.
- Preserved already-uploaded gallery thumbnails in the dialog if a later file in the same batch fails, keeping client state aligned with persisted uploads.
- Replaced day-item gallery move-up/move-down text controls with the compact thumbnail-plus-delete-icon presentation while preserving lazy thumbnails and fullscreen preview behavior.
- Added dialog regression coverage for multi-file upload, compact gallery controls, preview behavior, on-demand CSRF recovery, partial upload failure handling, and localized selection copy; existing `tripDayViewLayout.test.tsx` coverage verified day-view mini-strip and `+N` overflow output stayed unchanged.
- Verified `npm test` passed across the full repo (`85` files, `463` tests) and `npm run lint` completed with only the repository's pre-existing warnings.

## File List

- _bmad-output/implementation-artifacts/6-6-match-day-item-photo-ux-to-accommodations.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- _bmad-output/planning-artifacts/epics.md
- travelplan/src/components/features/trips/TripDayPlanDialog.tsx
- travelplan/src/i18n/en.ts
- travelplan/src/i18n/de.ts
- travelplan/test/tripDayPlanDialog.test.tsx

### Change Log

- 2026-03-16: Added Story 6.6 "Match Day Item Photo UX to Accommodations", created the ready-for-dev context story, and registered the story in sprint tracking.
- 2026-03-16: Implemented accommodation-style multi-file day-item gallery UX, added focused dialog regression coverage, and moved Story 6.6 to review.
- 2026-03-16: Fixed Senior Developer Review findings for Story 6.6 by restoring CSRF parity, localizing gallery selection copy, preserving partial-upload UI state, and extending regression tests.

## Senior Developer Review (AI)

- 2026-03-16: Review found 4 issues in the day-item gallery refinement: missing on-demand CSRF token recovery for upload/delete actions, untranslated selected-file summary copy, partial multi-file upload UI desynchronization after later-file failure, and test coverage gaps for those cases.
- 2026-03-16: Fixed all High and Medium findings in `TripDayPlanDialog.tsx`, `tripDayPlanDialog.test.tsx`, `en.ts`, and `de.ts`.
- 2026-03-16: Focused verification passed with `npm test -- tripDayPlanDialog.test.tsx` and `npm test -- tripDayViewLayout.test.tsx`.
