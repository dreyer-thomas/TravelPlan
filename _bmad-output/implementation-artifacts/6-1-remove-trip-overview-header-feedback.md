# Story 6.1: Remove Trip Overview Header Feedback

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip participant,
I want the trip overview header to focus on core trip context instead of comments or voting,
so that the overview feels cleaner and the least useful feedback surface is removed.

## Acceptance Criteria

1. Given I open a trip overview, when the trip header renders, then I do not see a comments trigger, comment count, vote count, or vote action in the header area.
2. Given trip-level feedback data already exists for the trip, when the overview header renders after this change, then the header still does not show feedback UI and the story does not require deleting existing feedback rows.
3. Given I view day entries, accommodations, or day-plan items that still support feedback, when those surfaces render, then their existing feedback behavior remains unchanged unless explicitly updated by a later story.
4. Given the trip overview header still shows core summary content such as title, date range, hero image, overview map, or sharing actions, when the feedback section is removed, then the remaining layout stays usable on desktop and mobile without empty gaps or broken alignment.

## Tasks / Subtasks

- [x] Task 1: Remove trip-level feedback controls from the trip overview header surface. (AC: 1, 2)
  - [x] Identify the current header component or header section inside the trip overview flow that renders the trip-level `TripFeedbackPanel` or its compact trigger.
  - [x] Remove that header-level feedback rendering without changing the supported target definitions for other surfaces.
  - [x] Ensure the header no longer reserves spacing, placeholder labels, or alignment for removed feedback UI.
- [x] Task 2: Preserve non-header feedback behavior. (AC: 2, 3)
  - [x] Keep day, accommodation, and day-plan-item feedback rendering unchanged in `TripTimeline.tsx`, `TripDayView.tsx`, and related components unless implementation uncovers an unintended dependency.
  - [x] Do not add cleanup or migration work for existing trip-level feedback rows in this story.
  - [x] Keep existing comment and vote APIs unchanged unless a small guard is required to prevent a now-unreachable header-only interaction path.
- [x] Task 3: Tighten the trip overview layout after removal. (AC: 4)
  - [x] Reflow the header stack or summary row so removal of feedback does not leave visual dead space on desktop.
  - [x] Verify the mobile layout still reads cleanly and does not create awkward wrapping or spacing regressions.
  - [x] Preserve current hero image, title, date, map, and share affordances.
- [x] Task 4: Add regression coverage for the removed header feedback surface. (AC: 1, 2, 3, 4)
  - [x] Add a component or page-level test proving the trip overview header no longer renders trip-level feedback UI.
  - [x] Add a regression test proving day-level and item-level feedback surfaces still render as before.
  - [x] Add a layout-oriented assertion, where practical in the existing test harness, that the header still renders its core summary content after feedback removal.

## Dev Notes

### Developer Context

Epic 5 introduced collaboration feedback across trip surfaces, and later stories narrowed voting to day plan items while keeping comments on days and accommodations. The remaining trip-level feedback in the trip overview header is now considered low-value and visually noisy. This story is a usability cleanup only: remove that header feedback surface, but do not redesign the broader collaboration model.

### Technical Requirements

- Remove comments and voting affordances from the trip overview header only.
- Preserve existing feedback behavior for day entries, accommodations, and day-plan items.
- Do not delete or migrate existing trip-level feedback rows in this story.
- Avoid backend churn unless the implementation reveals a necessary guard for an orphaned header-specific interaction.
- Keep responsive behavior intact after the header UI is simplified.

### Architecture Compliance

- Prefer a localized UI change in the current trip overview surface instead of altering repository contracts or feedback storage.
- Keep the implementation inside existing trip feature components under `travelplan/src/components/features/trips/`.
- Preserve the current `{ data, error }` API conventions and normalized feedback persistence unless a minimal follow-up fix is strictly required.

### File Structure Requirements

- Likely trip overview surface: `travelplan/src/components/features/trips/TripTimeline.tsx`
- Shared feedback UI: `travelplan/src/components/features/trips/TripFeedbackPanel.tsx`
- Trip detail payload source if needed: `travelplan/src/app/api/trips/[id]/route.ts`
- Tests: extend the current trip overview and feedback coverage under `travelplan/test/`

### Testing Requirements

- UI test: trip overview header does not render a trip-level feedback trigger after the change.
- UI test: day-level feedback surfaces in the overview remain available.
- UI test: day view and day item feedback behavior remains unchanged.
- UI test: core trip header content still renders correctly after feedback removal.

### Previous Story Intelligence

- Story 5.3 introduced trip-level feedback into the shared trip experience.
- Story 4.7 moved feedback into compact dialog triggers to reduce UI weight.
- Story 5.7 removed voting from days and accommodations, leaving day-plan items as the main voting surface.
- This story continues that direction by removing the lowest-value trip-header feedback surface entirely.

### Project Structure Notes

- `TripTimeline.tsx` is the most likely place where trip-level overview feedback is wired into the header area.
- `TripFeedbackPanel.tsx` should not need a redesign; this story likely removes one usage site.
- Existing timeline/day-view tests should be the regression anchor so the change stays narrowly scoped.

### References

- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/epics.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/4-7-comments-in-dialog.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/5-3-viewer-access-with-comments-and-votes.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/5-7-limit-voting-to-day-items.md`
- `/Users/tommy/Development/TravelPlan/travelplan/src/components/features/trips/TripTimeline.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/src/components/features/trips/TripFeedbackPanel.tsx`

## Dev Agent Record

### Agent Model Used

Bob, Scrum Master

### Debug Log References

- Story was created from an explicit user request to start a new Epic 6 for future usability refinements.
- Existing collaboration story artifacts were reviewed to keep this story aligned with the current feedback model and terminology.
- Sprint tracker was updated so Epic 6 and Story 6.1 are visible as a planned, ready-for-dev backlog item.
- Confirmed the only trip-level feedback mount lived in the `TripTimeline.tsx` header summary row.
- Verified day, accommodation, and day-plan-item feedback mounts remain in `TripTimeline.tsx` and `TripDayView.tsx`.
- Ran focused regressions for `tripTimelineFeedback.test.tsx` and `tripDayViewLayout.test.tsx`, then ran the full `vitest` suite and `eslint`.

### Implementation Plan

- Remove the header-level `TripFeedbackPanel` usage from `TripTimeline.tsx` without changing shared feedback capabilities or API contracts.
- Tighten the affected header row layout so the date metadata no longer reserves space for the removed control.
- Extend overview and day-view tests to prove header feedback is absent while day-level and day-plan-item feedback remain available.

### Completion Notes List

- Created Epic 6 as a dedicated container for future usability improvements.
- Scoped Story 6.1 narrowly to removing the trip overview header feedback surface.
- Preserved day, accommodation, and day-plan-item feedback as out of scope for this story.
- Explicitly avoided data cleanup or collaboration-model redesign in this story.
- Removed the trip-level `TripFeedbackPanel` from the trip overview header and collapsed the header metadata row to avoid dead space.
- Added regression assertions that the trip overview still shows the title, date range, and overview map while day feedback remains available.
- Added day-view regression coverage that day-level and day-plan-item feedback triggers still render after the overview cleanup.
- Validation passed with `npm test` (`84/84` files, `445/445` tests). `npm run lint` completed with pre-existing warnings only.

## File List

- travelplan/src/components/features/trips/TripTimeline.tsx
- travelplan/test/tripTimelineFeedback.test.tsx
- travelplan/test/tripDayViewLayout.test.tsx

## Change Log

- 2026-03-11: Removed trip overview header feedback UI, preserved non-header feedback surfaces, and added regression coverage for overview and day-view feedback behavior.
