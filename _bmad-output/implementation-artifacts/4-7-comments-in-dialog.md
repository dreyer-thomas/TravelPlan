# Story 4.7: Comments in Dialog

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip participant,
I want comments and pro/con feedback shown as a compact summary that opens a dialog,
so that the main planning UI stays focused while discussion remains easy to access.

## Acceptance Criteria

1. Given I open a trip surface that supports collaboration feedback, when the page renders, then the full inline comments panel is no longer shown by default on the day, accommodation, or day-plan-item card.
2. Given a feedback-supported card is rendered, when I look at the lower area of that card, then I see a compact comments trigger with a comments symbol and a human-readable comment count label.
3. Given a target has no comments, when the compact trigger is rendered, then the label reads `no comments`.
4. Given a target has one or more comments, when the compact trigger is rendered, then the label uses the correct singular or plural form such as `1 comment` or `5 comments`.
5. Given a target has pro or con votes, when the compact trigger is rendered, then it also shows thumbs up and thumbs down indicators with their current counts.
6. Given I activate the compact trigger, when the dialog opens, then I can see the existing full comments and voting experience for that target without leaving the current page.
7. Given I add a comment or cast a vote inside the dialog, when the action succeeds, then the dialog content and the compact summary counts update to reflect the latest saved state.
8. Given I close the dialog, when focus returns to the page, then I remain in the same trip context and scroll position.
9. Given I use the UI on mobile or desktop, when the dialog is opened, then it remains usable, accessible, and visually subordinate to the main planning layout.

## Tasks / Subtasks

- [x] Task 1: Refactor the current feedback UI into a reusable dialog-based experience.
  - [x] Keep the existing comment list, comment form, and vote actions from `TripFeedbackPanel.tsx`, but separate the full panel body from the compact summary trigger.
  - [x] Introduce a dialog wrapper component that can host the existing feedback interactions without changing backend request behavior.
  - [x] Preserve current success/error handling and CSRF fetch behavior.
- [x] Task 2: Replace dominant inline feedback rendering with compact summaries in the trip UI. (AC: 1, 2, 3, 4, 5, 8)
  - [x] Update `TripDayView.tsx` so the day card uses the compact trigger instead of the inline panel.
  - [x] Update `TripDayView.tsx` so accommodation and day-plan-item cards that support feedback also use the compact trigger.
  - [x] Review `TripTimeline.tsx` and convert any still-inline feedback surfaces there to the same compact pattern for consistency.
- [x] Task 3: Add the compact summary design details and copy. (AC: 2, 3, 4, 5)
  - [x] Render a comment icon without adding a new icon library dependency if the existing `SvgIcon` approach is sufficient.
  - [x] Add EN/DE i18n strings for `no comments`, singular/plural comment counts, dialog title text if needed, and any accessibility labels.
  - [x] Keep pro/con counts visually lighter than primary planning content while remaining readable.
- [x] Task 4: Preserve existing collaboration behavior while changing presentation only. (AC: 6, 7)
  - [x] Do not change the persistence model, route structure, access rules, or supported target types introduced by Story 5.3.
  - [x] Keep updates additive to the current `FeedbackSummary` flow so counts refresh locally after comment/vote actions.
- [x] Task 5: Add regression coverage for the dialog interaction pattern. (AC: 1, 5, 6, 7, 8, 9)
  - [x] Add component tests proving inline panels are replaced by the compact trigger.
  - [x] Add component tests proving the trigger shows `no comments` and correct counts for non-empty states.
  - [x] Add component tests proving the dialog opens, supports comment/vote submission, updates summary counts, and closes back to the same surface.
  - [x] Add responsive/accessibility checks for dialog labeling and focus return where practical in the existing test harness.

## Dev Notes

### Developer Context

Story 5.3 already delivered persisted comments and pro/con voting across trip, day, accommodation, and day-plan-item targets. The issue now is presentation, not capability: the current `TripFeedbackPanel` is rendered inline and visually dominates the planning surfaces. This story should convert that inline block into a compact entry point plus dialog while preserving the existing collaboration behavior and data flow.

### Technical Requirements

- Treat this as a UI refinement on top of the existing feedback system, not a new collaboration feature.
- Preserve current comment creation, vote updates, CSRF handling, and API routes under `/api/trips/[id]/feedback/*`.
- Keep comment and vote counts derived from the current `FeedbackSummary` payload; do not add duplicate summary endpoints.
- Use a compact summary row containing:
  - comment icon
  - comment count text
  - thumbs-up count
  - thumbs-down count
- The summary trigger should sit at the lower area of the relevant card so it reads as secondary metadata rather than primary card content.
- Reuse current in-memory update patterns so successful dialog actions update the visible summary immediately.
- Do not expand scope into editing/deleting comments; Story 5.5 already covers comment editing.

### Architecture Compliance

- Keep backend behavior unchanged unless a strictly additive response-shape improvement is required for the compact summary UI.
- Keep feature UI in `travelplan/src/components/features/trips/`.
- Reuse the existing trip detail payload and `FeedbackSummary` structure rather than adding a separate feedback-fetch layer for the dialog.
- Preserve current access-role behavior for owner, contributor, and viewer users.

### Library / Framework Requirements

- Continue using the project’s pinned stack in `travelplan/package.json`, especially `next@16.1.6`, `react@19.2.3`, and `@mui/material@7.3.8`.
- Use Material UI dialog primitives for the modal interaction and follow current app conventions for `Paper`, `Chip`, `Button`, `Typography`, and `SvgIcon`.
- Preserve the current `useI18n()` pattern and existing EN/DE dictionary structure.
- Do not add `@mui/icons-material` just for this story; use the current inline `SvgIcon` approach unless there is already an approved icon dependency in the codebase.

### File Structure Requirements

- Current inline feedback component to refactor: `travelplan/src/components/features/trips/TripFeedbackPanel.tsx`
- Day-level/detail integration: `travelplan/src/components/features/trips/TripDayView.tsx`
- Timeline/overview integration: `travelplan/src/components/features/trips/TripTimeline.tsx`
- i18n strings: `travelplan/src/i18n/en.ts`, `travelplan/src/i18n/de.ts`
- Component tests: extend or add files under `travelplan/test/` for timeline/day-view feedback behavior

### Testing Requirements

- Component test: compact feedback trigger renders instead of the full inline panel on supported cards.
- Component test: zero-comment state shows `no comments`.
- Component test: non-zero state shows the correct comment count text plus up/down vote counts.
- Component test: opening the trigger shows the full feedback UI in a dialog.
- Component test: posting a comment or vote from the dialog updates the rendered summary counts.
- Component test: closing the dialog keeps the user on the same page context and returns focus to the trigger.
- Responsive regression test: dialog remains usable in narrow/mobile layout.

### Previous Story Intelligence

Story 5.3 established the collaboration data model, API routes, and current `TripFeedbackPanel` rendering pattern. That means this story should stay heavily UI-focused and avoid reopening backend modeling decisions. Story 5.5 is already reserved for editing existing comments, so keep this story focused on relocating and reframing the current feedback interaction.

### Git Intelligence Summary

Recent story artifacts show a project pattern of refining established trip UI surfaces in place instead of creating alternate screens. The safest implementation path is to refactor `TripFeedbackPanel` into smaller reusable pieces and swap inline rendering for compact triggers inside the existing `TripDayView` and `TripTimeline` components.

### Latest Tech Information

- Local implementation targets remain the versions pinned in `travelplan/package.json`; no dependency upgrade is needed for this story.
- Official Next.js guidance continues to support App Router route handlers for the existing feedback APIs, which means this story should remain a frontend/UI change rather than a routing redesign.
- Official Material UI guidance continues to support `Dialog`, `Chip`, `Badge`, and `SvgIcon` for accessible modal and compact metadata patterns, which fits the requested interaction without introducing a new UI library.

### Project Context Reference

No `project-context.md` was found in the repository.

### Project Structure Notes

- `TripDayView.tsx` currently renders `TripFeedbackPanel` inline for day, accommodation, and day-plan-item surfaces.
- `TripTimeline.tsx` also still renders `TripFeedbackPanel` inline on trip/day surfaces, so consistency work is likely required there too.
- `TripFeedbackPanel.tsx` currently mixes summary, form, vote chips, and comment list into one always-expanded component. Splitting it into a compact trigger and a dialog body will reduce duplication and keep state handling localized.

### References

- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/epics.md` (Epic 4 insertion point and surrounding story sequence)
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/architecture.md` (role boundaries, repository/API conventions, Material UI stack)
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/prd.md` (viewer/comment requirement context)
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/ux-design-specification.md` (Material UI dialogs, responsive behavior, viewer contribution flow)
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/5-3-viewer-access-with-comments-and-votes.md`
- `/Users/tommy/Development/TravelPlan/travelplan/package.json`
- `/Users/tommy/Development/TravelPlan/travelplan/src/components/features/trips/TripFeedbackPanel.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/src/components/features/trips/TripDayView.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/src/components/features/trips/TripTimeline.tsx`
- [Next.js Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers)
- [Material UI Dialog](https://mui.com/material-ui/react-dialog/)
- [Material UI Chip](https://mui.com/material-ui/react-chip/)
- [Material UI Badge](https://mui.com/material-ui/react-badge/)

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Create-story invoked with explicit story key `4-7-comments-in-dialog` rather than auto-selecting the next backlog item.
- Existing feedback implementation context pulled from `5-3-viewer-access-with-comments-and-votes.md`, `TripFeedbackPanel.tsx`, `TripDayView.tsx`, and `TripTimeline.tsx`.
- Planning tracker update applied in `_bmad-output/implementation-artifacts/sprint-status.yaml` because no separate `sprint-planning.yaml` exists in this repository.
- Refactored `TripFeedbackPanel.tsx` into a compact summary trigger plus dialog body while keeping the existing CSRF-backed comment and vote requests unchanged.
- Added focused regression coverage for compact feedback rendering, dialog submission flows, focus return, and mobile full-screen dialog behavior.

### Implementation Plan

- Split the old always-expanded feedback panel into a compact trigger and a reusable dialog body within `TripFeedbackPanel.tsx`.
- Preserve the existing `FeedbackSummary` update flow so parent surfaces keep local counts in sync after dialog actions.
- Extend component and page-level tests to cover compact rendering on day and timeline surfaces plus dialog interaction behavior.

### Completion Notes List

- Replaced the inline feedback block with a compact summary trigger that shows comment text plus up/down counts and opens the full interaction in a Material UI dialog.
- Preserved the existing comment create and vote update requests, CSRF handling, target types, and in-memory `FeedbackSummary` refresh flow.
- Added EN/DE strings for compact count copy and dialog accessibility labels without adding any new icon dependency.
- Added regression coverage in `tripFeedbackPanel.test.tsx`, `tripDayViewLayout.test.tsx`, and `tripTimelineFeedback.test.tsx` for compact rendering, dialog behavior, live summary updates, focus return, and mobile full-screen usage.
- Review follow-up fixes added unique accessible labels per feedback surface and strengthened day/timeline assertions so each supported card proves the inline panel was replaced.
- Git review note: the worktree contained unrelated pre-existing modifications outside Story 4.7; the File List below tracks the files owned or updated by this story after review remediation.
- Full validation passed with `npm test` and `npm run lint` (`eslint` reported pre-existing warnings only, no errors).

### File List

- _bmad-output/implementation-artifacts/4-7-comments-in-dialog.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- travelplan/src/components/features/trips/TripFeedbackPanel.tsx
- travelplan/src/components/features/trips/TripDayView.tsx
- travelplan/src/components/features/trips/TripTimeline.tsx
- travelplan/src/i18n/en.ts
- travelplan/src/i18n/de.ts
- travelplan/test/tripFeedbackPanel.test.tsx
- travelplan/test/tripDayViewLayout.test.tsx
- travelplan/test/tripTimelineFeedback.test.tsx

## Change Log

- 2026-03-09: Implemented compact feedback summaries with dialog-based comments/votes, added i18n support, and expanded regression coverage for day and timeline collaboration surfaces.
- 2026-03-09: Review remediation added target-specific accessibility labels, strengthened feedback regression coverage, and documented dirty-worktree context for story traceability.
