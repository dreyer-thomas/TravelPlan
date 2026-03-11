# Story 6.2: Feedback as Chat

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip participant,
I want comment dialogs to behave like a chat surface with comment deletion for my own messages,
so that conversation feels natural and I can fully manage feedback I authored.

## Acceptance Criteria

1. Given I open a comments dialog for a supported feedback target, when the dialog renders, then the existing comments appear above the composer area and the composer for a new comment is anchored at the bottom of the dialog.
2. Given a target has multiple comments, when the comments are rendered in the dialog, then they are shown in chronological order with the oldest at the top and the newest at the bottom, and the newest saved comment appears closest to the composer area.
3. Given I add a new comment, when the save succeeds, then the new comment appears at the bottom of the comment list without requiring a page refresh.
4. Given I view the comments dialog on desktop or mobile, when the chat layout is shown, then the dialog visually reads like a messaging surface with a distinct message history area and a bottom composer, and the layout remains usable and accessible on smaller screens.
5. Given I authored a comment on a supported feedback target, when I view that comment in the dialog, then I can discover a delete action for my own comment in addition to the existing edit action.
6. Given I delete my own comment, when the delete succeeds, then the comment is removed completely from the UI and persisted storage, and the updated comment count is reflected anywhere that feedback target is summarized.
7. Given I did not author a comment, when I view that comment, then I cannot delete it, and attempts to delete another participant's comment are rejected without mutating stored data.
8. Given I use a comments dialog that also supports voting, when the chat-style comment layout is introduced, then the existing vote controls continue to work without regressing day-plan-item voting behavior.

## Tasks / Subtasks

- [x] Task 1: Rework the dialog body into a chat-style layout. (AC: 1, 2, 4, 8)
  - [x] Update `travelplan/src/components/features/trips/TripFeedbackPanel.tsx` so the message history and composer are visually separated instead of rendering the composer above the list.
  - [x] Keep comments ordered chronologically in the rendered list so the newest comment sits nearest the composer.
  - [x] Preserve current dialog open/close behavior, focus handling, and vote controls for targets that still support voting.
- [x] Task 2: Add a delete-my-comment flow across repository and API layers. (AC: 5, 6, 7)
  - [x] Extend `travelplan/src/lib/repositories/tripFeedbackRepo.ts` with a delete helper that confirms trip access, enforces `authorId === userId`, deletes the targeted `TripFeedbackComment`, and returns the refreshed `FeedbackSummary`.
  - [x] Add a `DELETE` handler under `travelplan/src/app/api/trips/[id]/feedback/comments/[commentId]/route.ts` using the existing session, CSRF, validation, and `{ data, error }` response conventions.
  - [x] Preserve the current inaccessible-resource behavior so non-members or non-authors do not gain information about other users' comment IDs beyond the existing patterns.
- [x] Task 3: Surface author-only delete controls in the chat UI. (AC: 5, 6, 7)
  - [x] Show delete actions only on comments authored by the current user.
  - [x] Keep the existing edit flow available for authored comments; this story adds deletion rather than replacing editing.
  - [x] Ensure summary counts and visible message history refresh immediately after a successful delete.
- [x] Task 4: Add chat-oriented presentation details and copy. (AC: 1, 2, 3, 4)
  - [x] Add EN/DE i18n strings for delete affordances, delete errors, and any chat-layout labels or helper text required by the new UI.
  - [x] Use Material UI layout primitives already present in the feature to create a clear history area and bottom composer without introducing a new component library.
  - [x] Keep empty-state behavior usable when no comments exist yet.
- [x] Task 5: Add regression coverage for chat ordering and deletion. (AC: 2, 3, 5, 6, 7, 8)
  - [x] Add repository tests for successful author deletion and rejected non-author deletion.
  - [x] Add route tests for delete success, delete rejection, invalid access, and refreshed payload shape.
  - [x] Add UI tests proving the composer is rendered at the bottom, comments remain chronological, newly posted comments land at the bottom, and only authored comments expose edit/delete actions.
  - [x] Add UI tests proving the updated comment count propagates to the compact trigger after create or delete actions.

## Dev Notes

### Developer Context

Story 4.7 already moved feedback into a dialog-based interaction, and Story 5.5 added author-only comment editing. Story 6.2 should refine that existing dialog into a chat-style surface and extend the same ownership model to support full deletion of authored comments. This is not a new collaboration subsystem; it is a focused UX and comment-lifecycle enhancement on top of the current feedback architecture.

Story 6.1 removed trip-header feedback because it was the least valuable surface. That leaves day, accommodation, and day-plan-item dialogs as the main feedback touchpoints, so this story should improve those dialogs directly rather than reintroducing any trip-header feedback pattern.

### Technical Requirements

- Keep chronological rendering in the dialog: oldest comment at the top, newest at the bottom.
- Anchor the new-comment composer at the bottom of the dialog so it behaves like a chat application.
- Preserve current comment creation, comment editing, and day-plan-item voting behavior.
- Delete must be a true removal of the `TripFeedbackComment` row, not a soft-hide in the UI only.
- Enforce that only the original author may delete a comment, even if other trip members can read the target.
- Keep the existing `FeedbackSummary` refresh pattern so comment counts and lists update in place after create, edit, or delete actions.
- Do not expand scope into moderation tools, delete-any-comment permissions, bulk actions, or realtime syncing.

### Architecture Compliance

- Keep trip access enforcement in the existing auth/repository flow rather than adding frontend-only permission checks.
- Extend the current feedback API subtree under `travelplan/src/app/api/trips/[id]/feedback/**`.
- Preserve Prisma as the source of truth for comment persistence and keep feedback summary mapping in `travelplan/src/lib/repositories/tripFeedbackRepo.ts`.
- Keep feature UI changes within `travelplan/src/components/features/trips/`.
- Reuse the existing feedback payload instead of adding a separate comments endpoint or secondary query layer for chat rendering.

### Library / Framework Requirements

- Target the versions pinned in `travelplan/package.json`, especially `next@16.1.6`, `react@19.2.3`, `@mui/material@7.3.8`, `prisma@7.3.0`, `@prisma/client@7.3.0`, and `zod@4.1.11`.
- Use existing Material UI dialog, list, button, divider, and text-field primitives for the chat layout and delete affordances.
- Keep API request handling in Next.js App Router route handlers under `travelplan/src/app/api/trips/[id]/feedback/**`.
- Keep validation and error-envelope patterns aligned with the current feedback create/edit routes.

### File Structure Requirements

- Primary UI surface: `travelplan/src/components/features/trips/TripFeedbackPanel.tsx`
- Existing comment create route: `travelplan/src/app/api/trips/[id]/feedback/comments/route.ts`
- Existing comment edit route to extend with delete support: `travelplan/src/app/api/trips/[id]/feedback/comments/[commentId]/route.ts`
- Feedback persistence and summary aggregation: `travelplan/src/lib/repositories/tripFeedbackRepo.ts`
- Validation schemas if delete-specific input or helper changes are needed: `travelplan/src/lib/validation/tripFeedbackSchemas.ts`
- Existing consumer surfaces that should continue to work after the dialog redesign: `travelplan/src/components/features/trips/TripTimeline.tsx` and `travelplan/src/components/features/trips/TripDayView.tsx`
- i18n dictionaries: `travelplan/src/i18n/en.ts`, `travelplan/src/i18n/de.ts`
- Tests: extend the current files under `travelplan/test/`, especially `tripFeedbackPanel.test.tsx`, `tripFeedbackRoute.test.ts`, and `tripFeedbackRepo.test.ts`

### Testing Requirements

- Repository test: an authored comment can be deleted and the refreshed summary no longer includes that comment.
- Repository test: deleting another participant's comment is rejected and leaves persisted data unchanged.
- Route test: `DELETE /api/trips/[id]/feedback/comments/[commentId]` succeeds for the author and returns the refreshed feedback payload.
- Route test: delete requests from a non-author, non-member, or invalid comment ID follow the established forbidden/not-found behavior and do not mutate stored data.
- UI test: the dialog renders the composer at the bottom of the visual layout and keeps existing comments above it.
- UI test: comments remain chronological and a newly posted comment appears at the bottom of the list.
- UI test: authored comments show edit and delete actions; non-authored comments do not.
- UI test: deleting a comment updates the compact feedback trigger count and keeps the dialog usable afterward.
- UI test: day-plan-item vote controls still work in the dialog after the chat-layout refactor.

### Previous Story Intelligence

- Story 4.7 established the compact-trigger-plus-dialog interaction and should remain the structural base for this work.
- Story 5.5 already solved author-only comment mutation for edits. Reuse that ownership pattern, route shape, and summary refresh behavior instead of inventing a parallel delete flow.
- Story 5.7 narrowed voting to day-plan items, so chat-layout changes must not accidentally re-enable votes on day or accommodation surfaces.
- Story 6.1 removed trip-header feedback, which means this story should focus on the remaining dialog surfaces only.

### Git Intelligence Summary

- Recent work in this area consistently extends the existing feedback subsystem in place rather than creating alternate components or APIs.
- The current repository already exposes enough comment identity and authorship data for author-only delete controls, so the main gaps are a repository delete helper, a `DELETE` route path, and UI actions in `TripFeedbackPanel.tsx`.
- Recent Epic 6 work stayed narrowly scoped to usability refinements, so this story should keep the backend change minimal and directly tied to the dialog behavior.

### Latest Tech Information

- Next.js App Router route handlers remain the correct request surface for scoped feedback mutations such as comment deletion: [Next.js Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers)
- Prisma CRUD operations remain the correct persistence mechanism for deleting a single normalized comment record in the repository layer: [Prisma CRUD](https://www.prisma.io/docs/orm/prisma-client/queries/crud)
- Material UI `Dialog` remains the correct accessibility baseline for this in-context modal interaction and supports the requested mobile/desktop dialog behavior: [MUI Dialog](https://mui.com/material-ui/react-dialog/)

### Project Context Reference

No `project-context.md` file was found in this repository.

### Project Structure Notes

- `TripFeedbackPanel.tsx` currently renders the composer before the comment list, so the chat-style ordering change is localized and should not require a second dialog component tree.
- The existing comment model already includes `id`, `author.id`, `createdAt`, and `updatedAt`, which is sufficient for author-only delete affordances and chronological rendering without schema changes.
- The current comment update route lives at `travelplan/src/app/api/trips/[id]/feedback/comments/[commentId]/route.ts`; adding delete there keeps comment mutation concerns in one place.
- `TripTimeline.tsx` and `TripDayView.tsx` already consume refreshed feedback summaries, so the compact trigger count should continue to update if the delete response preserves the current payload shape.

### References

- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/epics.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/architecture.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/ux-design-specification.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/4-7-comments-in-dialog.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/5-5-edit-own-comments.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/6-1-remove-trip-overview-header-feedback.md`
- `/Users/tommy/Development/TravelPlan/travelplan/package.json`
- `/Users/tommy/Development/TravelPlan/travelplan/src/components/features/trips/TripFeedbackPanel.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/src/app/api/trips/[id]/feedback/comments/[commentId]/route.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/lib/repositories/tripFeedbackRepo.ts`
- [Next.js Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers)
- [Prisma CRUD](https://www.prisma.io/docs/orm/prisma-client/queries/crud)
- [MUI Dialog](https://mui.com/material-ui/react-dialog/)

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Implementation Plan

- Rework `TripFeedbackPanel` into a two-zone chat layout with a scrollable history area, bottom composer, and author-only edit/delete actions while keeping vote controls intact for day-plan items.
- Extend the feedback repository and existing comment mutation route with author-enforced delete support that returns the refreshed summary payload and preserves current not-found/forbidden behavior.
- Add focused regression coverage in repository, route, and panel tests, then run targeted and full-suite validation before marking the story ready for review.

### Debug Log References

- Dev-story auto-selected `6-2-feedback-as-chat` from `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/sprint-status.yaml` as the first `ready-for-dev` story.
- No `project-context.md` file exists, so implementation context came from this story, prior feedback stories `4-7`, `5-5`, `6-1`, current feedback code, and existing feedback tests.
- Targeted red-phase tests first failed on the missing delete repository/API flow and the missing chat-layout test hooks, then passed after the repository, route, UI, and i18n changes landed.
- `_bmad/core/tasks/validate-workflow.xml` is referenced by the BMAD workflow but is not present in this repository, so checklist validation could not be run through the expected task runner.
- Code-review fixes restored visible compact-trigger comment labels, added auto-scroll-to-latest behavior for chat history, and added the missing invalid-comment-id delete route coverage before re-running the full suite.

### Completion Notes List

- Reworked `TripFeedbackPanel` into a chat-style dialog with a distinct message history surface, a bottom-anchored composer, chronological message rendering, and preserved vote controls for day-plan-item feedback.
- Added author-only comment deletion in `tripFeedbackRepo` and `DELETE /api/trips/[id]/feedback/comments/[commentId]`, preserving existing inaccessible-trip behavior for non-members and forbidden behavior for non-authors.
- Added EN/DE strings for delete actions, delete errors, and chat helper copy, and kept the existing author-only edit flow alongside the new delete action.
- Added regression coverage for repository deletion, route deletion, chronological chat ordering, composer placement, author-only edit/delete visibility, and compact trigger count refresh after create/delete.
- Validation: `npm test -- --run test/tripFeedbackRepo.test.ts test/tripFeedbackRoute.test.ts test/tripFeedbackPanel.test.tsx` passed; `npm test` passed with 451/451 tests; `npm run lint` passed with pre-existing warnings only.
- Code-review follow-up fixed the compact trigger to show visible comment summary copy again, added auto-scroll to the newest message in the chat history, and added explicit delete-route coverage for invalid comment IDs.
- Validation after review fixes: `npm test -- --run test/tripFeedbackPanel.test.tsx test/tripFeedbackRoute.test.ts test/tripFeedbackRepo.test.ts` passed; `npm test` passed with 452/452 tests.

### File List

- _bmad-output/implementation-artifacts/6-2-feedback-as-chat.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- travelplan/src/app/api/trips/[id]/feedback/comments/[commentId]/route.ts
- travelplan/src/components/features/trips/TripFeedbackPanel.tsx
- travelplan/src/i18n/de.ts
- travelplan/src/i18n/en.ts
- travelplan/src/lib/repositories/tripFeedbackRepo.ts
- travelplan/test/tripFeedbackPanel.test.tsx
- travelplan/test/tripFeedbackRepo.test.ts
- travelplan/test/tripFeedbackRoute.test.ts

## Change Log

- 2026-03-11: Implemented chat-style feedback dialog layout, author-only comment deletion across repository/API/UI layers, and regression coverage for ordering, ownership, and count refresh behavior.
- 2026-03-11: Applied code-review follow-up fixes for compact trigger labeling, chat auto-scroll behavior, and invalid delete-route coverage; story moved to done after green full-suite validation.
