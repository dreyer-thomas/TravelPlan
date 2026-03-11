# Story 6.3: Optimize Comments

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip participant,
I want comment indicators and comment actions to use a more compact visual format,
so that day and trip planning surfaces stay easier to scan and each comment bubble uses less space.

## Acceptance Criteria

1. Given a comment indicator is rendered for a day item, a day overview surface, or a day in the trip overview, when the indicator shows the number of comments, then it displays only the numeric count and does not append text such as `Kommentar`, `Kommentare`, `comment`, or `comments`.
2. Given the compact comment indicator is rendered in any supported surface, when the count is `0`, `1`, or greater than `1`, then the visible trigger still stays compact and the accessible name continues to communicate the comment purpose and count.
3. Given I view a comment that I authored inside the comments dialog, when the available comment actions are rendered, then the edit action is shown as a pen icon instead of the text `Kommentar bearbeiten` and the delete action is shown as a trash icon instead of the text `Kommentar löschen`.
4. Given the edit and delete icons are shown for my own comment, when the comment bubble is rendered, then both icons are placed to the right of the comment text content and the message bubble uses less horizontal space than the current text-button layout.
5. Given I do not own a comment, when I view that comment in the dialog, then I do not see the edit or delete icons for that comment and the existing ownership restrictions remain unchanged.
6. Given I use the compact comment trigger or the icon-only comment actions on desktop or mobile, when I interact with them, then the controls remain clearly clickable and keyboard accessible and screen readers still receive meaningful labels for opening comments, editing, and deleting.

## Tasks / Subtasks

- [x] Task 1: Replace visible comment-count copy with a number-only trigger across all existing feedback entry points. (AC: 1, 2, 6)
  - [x] Update `travelplan/src/components/features/trips/TripFeedbackPanel.tsx` so the visible trigger text renders only the numeric count while preserving a descriptive accessible name for the button.
  - [x] Keep the same compact-trigger behavior for comment-only targets and vote-capable targets; only the visible label format changes.
  - [x] Verify the change flows through every existing `TripFeedbackPanel` usage, including trip overview day cards in `TripTimeline.tsx` and day/accommodation/day-plan-item surfaces in `TripDayView.tsx`.
- [x] Task 2: Convert authored-comment edit and delete actions from text buttons to icon buttons. (AC: 3, 5, 6)
  - [x] Replace the visible `commentEditAction` and `commentDeleteAction` button text with icon-only controls in `TripFeedbackPanel.tsx`.
  - [x] Keep explicit `aria-label` values for both actions so icon-only controls remain accessible.
  - [x] Preserve the existing author-only visibility rules and delete/edit request flow without changing API behavior.
- [x] Task 3: Move authored-comment action icons into the message row to reduce bubble width. (AC: 4, 6)
  - [x] Refactor the comment bubble layout so the text block and authored action icons share a single horizontal row or compact action rail aligned to the right of the message content.
  - [x] Keep long comment text readable and wrapping correctly without the action icons overlapping or forcing layout breakage on narrow screens.
  - [x] Preserve the current inline edit state and composer behavior introduced in Story 6.2.
- [x] Task 4: Update i18n and accessibility support for the compact UI. (AC: 2, 3, 6)
  - [x] Adjust `travelplan/src/i18n/en.ts` and `travelplan/src/i18n/de.ts` so visible count copy can be number-only while the button `aria-label` still conveys "open comments" plus the count.
  - [x] Keep edit/delete accessible labels meaningful for screen readers even though the visible controls become icon-only.
  - [x] Avoid removing any localized strings still required by the edit form, error handling, or dialog titles.
- [x] Task 5: Add regression coverage for the compact comment trigger and icon-only actions. (AC: 1, 2, 3, 4, 5, 6)
  - [x] Update `travelplan/test/tripFeedbackPanel.test.tsx` to assert number-only visible trigger copy, preserved accessible names, and icon-only author actions.
  - [x] Extend `travelplan/test/tripTimelineFeedback.test.tsx` and any relevant day-view tests so trip overview days and day-level feedback surfaces keep the compact visible comment count.
  - [x] Add UI assertions that the authored action icons remain unavailable on comments from other participants and that the chat layout stays usable after the layout change.

## Dev Notes

### Developer Context

Story 5.5 already compacted the trip-overview placement of day feedback triggers, and Story 6.2 turned the dialog into a chat-like surface with author-only edit and delete actions. Story 6.3 is a narrow visual refinement on top of that work: keep the same feedback behavior and permissions, but remove unnecessary visible words from comment counts and replace long action text with icon-only affordances that consume less space.

This is not a new feedback capability. No repository, route, validation, or persistence changes should be required unless the UI reveals an unexpected dependency. The primary goal is tighter presentation on day cards, day view surfaces, and inside the chat bubbles themselves.

### Technical Requirements

- Visible comment-trigger copy must render only the numeric count for all existing supported targets that use `TripFeedbackPanel`.
- The trigger's accessible name must continue to communicate the action and count even when the visible label is reduced to a number.
- Author-only comment actions in the dialog must render as icon buttons for edit and delete rather than visible text buttons.
- The icon buttons must sit to the right of the rendered comment text so the bubble becomes more compact horizontally.
- Preserve current comment creation, editing, deletion, dialog open/close behavior, and day-plan-item voting behavior.
- Preserve current ownership restrictions: only authored comments may show edit/delete controls.
- Keep the inline edit experience usable; switching the resting state to icon actions must not break the existing edit form controls.
- Do not introduce backend changes, new comment actions, moderation behavior, or a second feedback component path for this story.

### Architecture Compliance

- Keep the change localized to the existing feedback UI in `travelplan/src/components/features/trips/TripFeedbackPanel.tsx`.
- Preserve current `TripFeedbackPanel` consumers in `travelplan/src/components/features/trips/TripTimeline.tsx` and `travelplan/src/components/features/trips/TripDayView.tsx`; the compact trigger should arrive through the shared component instead of one-off per-surface rewrites.
- Keep localized copy in `travelplan/src/i18n/en.ts` and `travelplan/src/i18n/de.ts`.
- Preserve the current API and repository flow under `travelplan/src/app/api/trips/[id]/feedback/**` and `travelplan/src/lib/repositories/tripFeedbackRepo.ts`; this story should not require changes there.

### Library / Framework Requirements

- Stay on the versions already pinned in `travelplan/package.json`, especially `next@16.1.6`, `react@19.2.3`, and `@mui/material@7.3.8`.
- Reuse existing Material UI primitives already present in `TripFeedbackPanel.tsx`, especially `IconButton`, `Button`, `Paper`, `List`, `ListItemText`, and `SvgIcon`.
- Keep the icon-only affordances accessible through Material UI button semantics and explicit `aria-label` values instead of introducing a new icon library.

### File Structure Requirements

- Shared feedback trigger and dialog UI: `travelplan/src/components/features/trips/TripFeedbackPanel.tsx`
- Existing trip overview surface that consumes the shared trigger: `travelplan/src/components/features/trips/TripTimeline.tsx`
- Existing day view surfaces for day, accommodation, and day-plan-item feedback: `travelplan/src/components/features/trips/TripDayView.tsx`
- Localized strings: `travelplan/src/i18n/en.ts`, `travelplan/src/i18n/de.ts`
- Existing feedback tests to extend: `travelplan/test/tripFeedbackPanel.test.tsx`, `travelplan/test/tripTimelineFeedback.test.tsx`

### Testing Requirements

- UI test: the visible trigger content shows only the numeric comment count while the trigger accessible name still announces comment purpose and count.
- UI test: comment-only targets and vote-capable targets both keep the compact visible count format.
- UI test: authored comments render icon-only edit and delete controls with accessible labels; non-authored comments do not render those controls.
- UI test: the authored comment layout places the action icons to the right of the comment text without breaking text wrapping.
- UI test: compact count rendering appears in trip overview day cards and day-view feedback surfaces that consume `TripFeedbackPanel`.
- UI test: the existing edit, delete, create, and vote flows still work after the UI compaction changes.

### Previous Story Intelligence

- Story 5.5 already identified comment-trigger density as a usability issue and moved the day feedback trigger into a more compact day-card row. Story 6.3 continues that same density goal by shortening the visible label further.
- Story 6.2 already introduced author-only delete support and a chat layout inside `TripFeedbackPanel`. Reuse that component structure and ownership model instead of redesigning feedback interactions.
- Current i18n strings still contain visible singular/plural comment label copy and long visible edit/delete action labels. Those are the most direct places to slim down the UI.

### Git Intelligence Summary

- Recent Epic 6 commits stayed focused on targeted usability refinements without expanding scope into new data models or APIs.
- The current code already centralizes comment trigger rendering and authored action rendering in `TripFeedbackPanel.tsx`, which makes this story a low-risk shared-component refinement.
- Existing tests already cover compact trigger text, edit/delete actions, and feedback flows, so regression coverage should be an incremental extension rather than a new test strategy.

### Latest Tech Information

- No additional external technical research is required for this story. The work stays within the already pinned local stack and existing Material UI components in the repository.

### Project Context Reference

No `project-context.md` file was found in this repository.

### Project Structure Notes

- `TripFeedbackPanel.tsx` currently computes visible comment labels via `noComments`, `commentCountSingular`, and `commentCountPlural`, and it currently renders authored comment actions as visible text buttons. Those are the main implementation seams for this story.
- Because `TripTimeline.tsx` and `TripDayView.tsx` both consume the shared feedback panel, changing the visible trigger content inside `TripFeedbackPanel` should update all requested surfaces consistently.
- Existing tests in `tripFeedbackPanel.test.tsx` currently assert visible strings like `1 comment` and `2 comments`; those expectations will need to be updated to the new number-only display while preserving accessibility assertions.

### References

- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/epics.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/architecture.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/ux-design-specification.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/5-5-edit-own-comments.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/6-2-feedback-as-chat.md`
- `/Users/tommy/Development/TravelPlan/travelplan/package.json`
- `/Users/tommy/Development/TravelPlan/travelplan/src/components/features/trips/TripFeedbackPanel.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/src/components/features/trips/TripTimeline.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/src/components/features/trips/TripDayView.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/src/i18n/en.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/i18n/de.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/test/tripFeedbackPanel.test.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/test/tripTimelineFeedback.test.tsx`

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Story `6-3-optimize-comments` was requested directly by the user and did not yet exist in `epics.md` or `sprint-status.yaml`, so the planning artifacts were updated first and the context story was then generated from the user-provided requirement plus existing Epic 5/6 feedback context.
- No `project-context.md` file exists in this repository, so context came from the planning artifacts, Story 5.5, Story 6.2, the current feedback UI implementation, and existing feedback tests.
- `_bmad/core/tasks/validate-workflow.xml` is referenced by the BMAD workflow but is not present in this repository, so checklist validation could not be run through the expected task runner.
- Implemented Story 6.3 by keeping the shared `TripFeedbackPanel` API intact and limiting code changes to the existing feedback UI, localized dictionaries, and regression tests.
- Full repository validation completed with `npm test` passing; `npm run lint` completed with pre-existing warnings only and no new errors introduced by this story.
- Code review fixes tightened mobile touch targets for the compact feedback trigger and icon-only comment actions, hardened author email wrapping in compact bubbles, and strengthened the compact-count regression assertion.

### Completion Notes List

- Added Story 6.3 to Epic 6 in `epics.md` with scoped acceptance criteria covering number-only comment counts, icon-only comment actions, and compact authored-message layout.
- Created the ready-for-dev implementation context file for `6-3-optimize-comments` with implementation seams, guardrails, and regression expectations tied to the existing shared feedback UI.
- Kept scope intentionally narrow: shared UI and i18n changes only, with no planned backend or persistence changes unless implementation uncovers an unexpected dependency.
- Replaced the visible feedback trigger label with a localized compact count while preserving descriptive `aria-label` strings for zero, singular, and plural comment states.
- Converted authored comment edit/delete controls to icon-only `IconButton` actions, moved them into the message row, and added stable test hooks to verify compact bubble layout.
- Extended regression coverage across shared feedback panel, trip timeline, and day view surfaces; full `vitest` suite passed with 452/452 tests.
- Follow-up review fixes preserved AC6 on touch devices by enforcing 44px minimum targets for the trigger and authored action icons and ensured compact bubbles still wrap long author emails safely.
- Strengthened the compact-trigger regression test so vote totals can no longer mask a missing visible comment count.

### File List

- _bmad-output/implementation-artifacts/6-3-optimize-comments.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- _bmad-output/planning-artifacts/epics.md
- travelplan/src/components/features/trips/TripFeedbackPanel.tsx
- travelplan/src/i18n/en.ts
- travelplan/src/i18n/de.ts
- travelplan/test/tripFeedbackPanel.test.tsx
- travelplan/test/tripTimelineFeedback.test.tsx
- travelplan/test/tripDayViewLayout.test.tsx

## Change Log

- 2026-03-11: Added Story 6.3 "Optimize Comments" to Epic 6, created the ready-for-dev context story, and registered the story in sprint tracking.
- 2026-03-11: Implemented compact numeric feedback triggers, icon-only authored comment actions, localized compact count support, and regression coverage across feedback surfaces; story moved to review.
- 2026-03-11: Applied code review fixes for mobile touch targets, compact bubble wrapping resilience, and compact-count regression coverage; story moved to done.
