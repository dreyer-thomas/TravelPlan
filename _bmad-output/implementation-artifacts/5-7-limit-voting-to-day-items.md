# Story 5.7: Limit Voting to Day Items

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip participant,
I want days and accommodations to stay commentable without voting,
so that lightweight discussion remains available while voting is reserved for concrete day-item suggestions.

## Acceptance Criteria

1. Given I view a day entry in the trip overview, when the feedback trigger is rendered, then I still see the existing comment access for that day and I do not see vote counts or vote actions for the day itself.
2. Given I open the day view for a specific day, when the day-level feedback trigger is rendered, then I can still read and add comments for the day and I do not see vote counts or vote actions for the day itself.
3. Given I view an accommodation that supports feedback, when its feedback trigger is rendered, then I can still read and add comments for that accommodation and I do not see vote counts or vote actions for that accommodation.
4. Given I view a day plan item that supports feedback, when its feedback trigger is rendered, then the existing comments and voting behavior remains available.
5. Given a client attempts to submit a vote for a `tripDay` or `accommodation` feedback target, when the request reaches the feedback API, then the request is rejected as unsupported and no vote state is created or changed for that target.
6. Given comments already exist on day, accommodation, or day plan item targets, when the updated UI is loaded, then those comments remain visible through the current compact dialog flow without data loss or regression of existing comment permissions.
7. Given older vote rows already exist for day or accommodation targets, when the updated UI is loaded, then those vote controls are no longer shown for those targets and the story does not require deleting historical rows as part of this change.
8. Given I view trip-level feedback that is not part of the day-entry or accommodation surfaces, when the page renders, then that behavior remains unchanged unless explicitly covered by a later story.

## Tasks / Subtasks

- [ ] Task 1: Introduce explicit feedback capabilities per target type. (AC: 1, 2, 3, 4, 8)
  - [ ] Add or reuse a shared target-capability definition so `tripDay` and `accommodation` targets are comment-only while `dayPlanItem` keeps comments plus votes.
  - [ ] Preserve current trip-level behavior unless this story explicitly touches it.
  - [ ] Keep the decision centralized instead of hard-coding different behavior separately in each component and route.
- [ ] Task 2: Restrict unsupported vote writes at the backend boundary. (AC: 5, 7)
  - [ ] Update `travelplan/src/app/api/trips/[id]/feedback/votes/route.ts` and the supporting validation/repository flow so votes for `tripDay` and `accommodation` targets are rejected before persistence.
  - [ ] Preserve the current `{ data, error }` envelope, session checks, CSRF validation, and inaccessible-trip handling.
  - [ ] Avoid schema or migration work unless the implementation uncovers a hard blocker; this story should primarily be capability enforcement rather than data-model redesign.
- [ ] Task 3: Update the reusable feedback UI so comment-only targets no longer show voting affordances. (AC: 1, 2, 3, 4, 6, 7)
  - [ ] Extend `travelplan/src/components/features/trips/TripFeedbackPanel.tsx` so it can render comment-only targets without upvote/downvote chips, vote counts, or vote-specific trigger text.
  - [ ] Preserve the current compact trigger plus dialog interaction introduced by Story 4.7 and the comment-edit behavior introduced by Story 5.5.
  - [ ] Keep day plan item targets on the existing full comments-and-votes presentation.
- [ ] Task 4: Apply the new target rules to the current trip surfaces. (AC: 1, 2, 3, 4, 8)
  - [ ] Update `travelplan/src/components/features/trips/TripTimeline.tsx` so day entries in the trip overview remain commentable but no longer show voting.
  - [ ] Update `travelplan/src/components/features/trips/TripDayView.tsx` so the day-level feedback surface and accommodation feedback surfaces are comment-only.
  - [ ] Keep day plan item feedback unchanged in `TripDayView.tsx`.
- [ ] Task 5: Preserve collaboration boundaries and existing comment permissions. (AC: 5, 6, 8)
  - [ ] Keep owner, contributor, and viewer comment permissions unchanged from the current collaboration model.
  - [ ] Do not expand scope into deleting historical votes, introducing moderation, or changing trip-member roles.
  - [ ] Do not alter unrelated trip-level feedback behavior unless implementation evidence makes that unavoidable and the story is updated accordingly.
- [ ] Task 6: Add regression coverage for UI and route enforcement. (AC: 1, 2, 3, 4, 5, 6, 7, 8)
  - [ ] Add route tests proving votes for `tripDay` and `accommodation` targets are rejected while `dayPlanItem` votes still succeed.
  - [ ] Add UI tests proving day entries in `TripTimeline.tsx` show comment access without vote counts or vote actions.
  - [ ] Add UI tests proving day-level and accommodation feedback in `TripDayView.tsx` are comment-only while day item feedback still shows comments and voting.
  - [ ] Add regression tests proving comment creation and editing still work on day and accommodation targets after the capability split.

## Dev Notes

### Developer Context

Story 5.3 introduced comments and votes across trip, day, accommodation, and day-plan-item targets through a normalized feedback system. Story 4.7 then moved that interaction into compact dialog triggers, and Story 5.5 added edit-my-own-comment support. This new story is a behavior refinement: voting should now be reserved for day plan items, while days and accommodations remain commentable.

The important implementation detail is that the existing feedback system is largely target-agnostic today. This story therefore needs a clear capability layer so the UI and API agree on which targets are comment-only versus comment-plus-vote. The change should not be implemented as a visual-only tweak that still allows unsupported votes through the API.

### Technical Requirements

- Treat `tripDay` and `accommodation` targets as comment-only surfaces.
- Keep `dayPlanItem` targets on the existing comment-plus-vote behavior.
- Preserve comment functionality on:
  - day entries in `TripTimeline.tsx`
  - the day-level surface in `TripDayView.tsx`
  - accommodation surfaces in `TripDayView.tsx`
- Preserve the compact feedback dialog flow and current comment-edit behavior.
- Reject unsupported vote submissions for `tripDay` and `accommodation` targets at the route/repository boundary; do not rely on hidden buttons alone.
- Avoid destructive cleanup of historical vote rows for now. Existing unsupported vote data can remain stored but should no longer drive visible day/accommodation voting controls in this story.
- Keep trip-level feedback behavior unchanged unless the product explicitly broadens this scope later.

### Architecture Compliance

- Keep backend request handling in Next.js App Router route handlers under `travelplan/src/app/api/trips/**/route.ts`.
- Keep capability and target-resolution logic centralized in the feedback validation/repository layer rather than duplicated across multiple UI components.
- Preserve Prisma as the persistence source of truth and avoid schema churn for this scoped rule change.
- Keep localized strings in `travelplan/src/i18n/en.ts` and `travelplan/src/i18n/de.ts` if trigger or dialog copy needs to change when vote counts disappear.

### Library / Framework Requirements

- Target the versions already pinned in `travelplan/package.json`: `next@16.1.6`, `react@19.2.3`, `@mui/material@7.3.8`, `prisma@7.3.0`, `@prisma/client@7.3.0`, `react-hook-form@7.71.1`, `zod@4.1.11`, and `jose@6.1.0`.
- Keep the feedback UI in the current Material UI component stack and reuse the existing compact trigger/dialog structure.
- Keep request validation in Zod and feedback persistence in Prisma; do not introduce a parallel feature flag or alternate API surface for this rule change.

### File Structure Requirements

- Reusable feedback UI: `travelplan/src/components/features/trips/TripFeedbackPanel.tsx`
- Trip overview timeline surface: `travelplan/src/components/features/trips/TripTimeline.tsx`
- Day view surface: `travelplan/src/components/features/trips/TripDayView.tsx`
- Vote route: `travelplan/src/app/api/trips/[id]/feedback/votes/route.ts`
- Feedback validation schemas: `travelplan/src/lib/validation/tripFeedbackSchemas.ts`
- Feedback repository logic: `travelplan/src/lib/repositories/tripFeedbackRepo.ts`
- i18n dictionaries: `travelplan/src/i18n/en.ts`, `travelplan/src/i18n/de.ts`
- Tests: extend current feedback route/component files under `travelplan/test/`

### Testing Requirements

- Route test: a vote for a `tripDay` target is rejected.
- Route test: a vote for an `accommodation` target is rejected.
- Route test: a vote for a `dayPlanItem` target still succeeds and returns the expected summary.
- UI test: trip overview day entries still expose comments but no longer render vote counts or vote actions.
- UI test: day view day-level feedback remains commentable without vote controls.
- UI test: accommodation feedback remains commentable without vote controls.
- UI test: day item feedback still exposes both comments and voting.
- UI test: comment editing on day and accommodation targets still works after the capability change.

### Previous Story Intelligence

- Story 4.7 already established the compact trigger/dialog interaction for feedback; reuse it rather than creating a new comments-only component tree.
- Story 5.3 introduced the normalized feedback targets and vote persistence that this story now needs to narrow by target type.
- Story 5.5 extended the same shared feedback panel with comment-edit capabilities; do not regress that authored-comment flow while removing votes from some targets.

### Git Intelligence Summary

- The current collaboration implementation is centralized around `TripFeedbackPanel.tsx`, the feedback API subtree, and `tripFeedbackRepo.ts`, so this story should remain an incremental refinement of those seams rather than a redesign.
- Existing regression coverage already exercises feedback routes and trip/day surfaces, which makes those tests the correct place to lock in the new comment-only-versus-voting split.

### Latest Tech Information

- Local package versions in `travelplan/package.json` remain the implementation target for this story; no dependency upgrade is needed for the feedback-scope change.
- Next.js App Router route handlers remain the correct server surface for the feedback endpoints: [Next.js Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers)
- Prisma remains the correct persistence layer for enforcing supported-target behavior around feedback rows without adding a second storage path: [Prisma CRUD](https://www.prisma.io/docs/orm/prisma-client/queries/crud)
- Material UI dialog and chip primitives remain appropriate for the compact feedback trigger and dialog behavior already in use: [MUI Dialog](https://mui.com/material-ui/react-dialog/)

### Project Context Reference

No `project-context.md` file was found in this repository.

### Project Structure Notes

- `TripFeedbackPanel.tsx` currently assumes votes are always available whenever a feedback summary exists, so this component needs an explicit capability input instead of relying purely on target presence.
- `TripTimeline.tsx` and `TripDayView.tsx` already decide which target type is being rendered, making them the right places to pass comment-only versus comment-plus-vote behavior into the shared panel.
- `travelplan/src/app/api/trips/[id]/feedback/votes/route.ts` currently accepts supported feedback targets generically; this story should tighten that contract so UI and backend rules cannot drift apart.
- `tripFeedbackRepo.ts` and `tripFeedbackSchemas.ts` are the likely central seams for supported-target validation and should stay aligned with any UI capability map.

### References

- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/epics.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/architecture.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/ux-design-specification.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/4-7-comments-in-dialog.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/5-3-viewer-access-with-comments-and-votes.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/5-5-edit-own-comments.md`
- `/Users/tommy/Development/TravelPlan/travelplan/package.json`
- `/Users/tommy/Development/TravelPlan/travelplan/src/components/features/trips/TripFeedbackPanel.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/src/components/features/trips/TripTimeline.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/src/components/features/trips/TripDayView.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/src/app/api/trips/[id]/feedback/votes/route.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/lib/repositories/tripFeedbackRepo.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/lib/validation/tripFeedbackSchemas.ts`
- [Next.js Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers)
- [Prisma CRUD](https://www.prisma.io/docs/orm/prisma-client/queries/crud)
- [MUI Dialog](https://mui.com/material-ui/react-dialog/)

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Story key `5-7-limit-voting-to-day-items` was created from a new user-requested change rather than auto-discovered from the current sprint backlog.
- `project-context.md` was not present, so story context was built from planning artifacts, existing Epic 5 implementation stories, and the live feedback UI/API code.
- The BMAD validation task runner `_bmad/core/tasks/validate-workflow.xml` referenced by the workflow is not present in this repository, so checklist validation could not be run through the expected task file.

### Completion Notes List

- Created Story 5.7 as a follow-on collaboration refinement that keeps comments on days and accommodations while narrowing voting to day plan items.
- Scoped the change across UI and API layers so unsupported day/accommodation votes are blocked, not merely hidden.
- Preserved trip-level feedback behavior as out of scope for this request.

### File List

- _bmad-output/implementation-artifacts/5-7-limit-voting-to-day-items.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- _bmad-output/planning-artifacts/epics.md
