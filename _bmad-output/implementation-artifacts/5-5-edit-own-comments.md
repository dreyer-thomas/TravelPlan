# Story 5.5: Edit Own Comments

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a contributor or viewer,
I want to edit my own comments and see trip-overview comments placed more compactly,
so that I can refine my feedback and scan more days on screen at once.

## Acceptance Criteria

1. Given I created a comment on a supported trip feedback target, when I edit that comment and save, then the updated comment body is persisted and visible anywhere that feedback target is rendered.
2. Given I try to edit a comment authored by another trip participant, when I attempt to save changes, then the request is blocked and no comment content changes.
3. Given I am a viewer or contributor with trip access, when I open an existing comment that I authored, then I can discover an edit action in the current feedback UI without losing the existing comment and vote functionality.
4. Given I submit an invalid edit such as an empty or overlong comment body, when the request is validated, then I receive the existing validation-style error response and the original comment remains unchanged.
5. Given I am not a member of the trip, when I try to edit any comment on that trip, then I receive the same inaccessible-trip behavior already used by the trip APIs.
6. Given I view the trip overview timeline, when a day card shows accommodation status and planned/open time information, then the comments trigger is rendered on the same right-side summary row beside those indicators instead of below them so each day card uses less vertical space.

## Tasks / Subtasks

- [x] Task 1: Add repository support for editing a feedback comment while enforcing author ownership. (AC: 1, 2, 4, 5)
  - [x] Extend `travelplan/src/lib/repositories/tripFeedbackRepo.ts` with an `updateTripFeedbackComment` helper that resolves the comment, confirms the caller still has trip access, and only allows updates when `authorId === userId`.
  - [x] Reuse the existing normalized `TripFeedbackComment` persistence model and `updatedAt` column instead of adding a parallel audit or draft table.
  - [x] Return the refreshed `TripFeedbackSummary` payload for the edited target so the current trip detail UI can update in place without extra client-side joins.
- [x] Task 2: Add an authenticated route for comment edits under the existing trip feedback API subtree. (AC: 1, 2, 4, 5)
  - [x] Add a route handler under `travelplan/src/app/api/trips/[id]/feedback/comments/[commentId]/route.ts` or an equivalent resource-shaped endpoint that fits the current App Router API conventions.
  - [x] Enforce session and CSRF checks on the edit route, preserve the `{ data, error }` response envelope, and reuse Zod validation for the updated comment body.
  - [x] Distinguish `404` inaccessible-trip or missing-comment results from `403`/validation-style ownership failures only if that matches the repository’s current inaccessible-resource pattern; do not leak other users’ comment existence.
- [x] Task 3: Extend the existing feedback validation layer for edit payloads without weakening comment constraints. (AC: 1, 4)
  - [x] Reuse the current max length and non-empty trimming rules from `tripFeedbackCommentSchema` so create and edit stay aligned.
  - [x] Add or extract a focused schema for comment edits if needed, but keep the supported target types and body constraints consistent with the create flow.
  - [x] Preserve the current target resolution rules for trip, trip day, accommodation, and day plan item feedback targets.
- [x] Task 4: Surface edit-my-comment affordances inside `TripFeedbackPanel` without regressing current comment/vote behavior. (AC: 1, 3, 4)
  - [x] Show an edit action only on comments authored by the current user; comments from other participants must remain read-only.
  - [x] Reuse the current dialog-based feedback surface so editing happens in context, not on a separate page or modal stack.
  - [x] Support an inline or dialog-local edit state that pre-fills the existing comment body, allows save/cancel, and updates the rendered comment list after a successful response.
  - [x] Add EN/DE i18n strings for edit labels, save/cancel copy, and edit-specific error states while preserving current accessibility labeling.
- [x] Task 4a: Reposition the trip-overview comments trigger to reduce day-card height without removing existing feedback functionality. (AC: 6)
  - [x] Update `travelplan/src/components/features/trips/TripTimeline.tsx` so each day card renders the comments trigger on the right side of the same metadata row that contains the accommodation booking tag and planned/open time summary.
  - [x] Preserve the existing comments-and-votes dialog behavior from `TripFeedbackPanel`; this is a layout change, not a behavior redesign.
  - [x] Keep the row usable on smaller widths by allowing sensible wrapping or responsive stacking without pushing the comments trigger back into its own full-width row by default.
- [x] Task 5: Preserve collaboration boundaries and avoid accidental scope creep into broader comment management. (AC: 2, 5)
  - [x] Keep viewers and contributors limited to editing only their own comment text; do not add delete, moderator, or edit-any-comment capabilities in this story.
  - [x] Keep votes, trip planning mutations, member management, and contributor/owner write boundaries unchanged from Stories 5.3 and 5.4.
  - [x] Ensure the edit flow does not require or imply real-time syncing, notification logic, or comment history/versioning.
- [x] Task 6: Add regression coverage for author edits, forbidden edits, and UI behavior. (AC: 1, 2, 3, 4, 5)
  - [x] Add route tests proving viewers and contributors can edit their own comments on supported targets and receive updated payloads.
  - [x] Add route tests proving attempts to edit another user’s comment, a non-member trip’s comment, or an invalid payload fail without mutating stored data.
  - [x] Add repository tests for ownership enforcement and summary refresh after comment edits.
  - [x] Add UI tests for `TripFeedbackPanel` covering author-only edit controls, edit/save/cancel flows, and preservation of existing vote/comment interactions.

## Dev Notes

### Developer Context

Story 5.3 introduced normalized trip feedback targets, comments, and votes plus the shared `TripFeedbackPanel` UI used in trip and day-level surfaces. Story 5.4 widened core planning mutations for contributors, but feedback comments are still create-only for all participants. Story 5.5 should extend that existing collaboration system so viewers and contributors can refine their own feedback without changing the ownership model or reopening broader trip-edit permissions.

The current feedback repository already stores `authorId`, `createdAt`, and `updatedAt` on `TripFeedbackComment`, which means this story is primarily about exposing safe update behavior through the repository, route layer, and UI. The implementation should remain inside the existing feedback subsystem and avoid building a second comment-management path.

There is also a small timeline-density refinement requested for the trip overview: the day-level comments trigger should move into the existing right-side day summary row next to the accommodation booking tag and planned/open time summary. That change should reduce vertical card height while preserving the same feedback entry point and responsive behavior.

### Technical Requirements

- Treat comment editing as an update to existing `TripFeedbackComment` rows, not as delete-and-recreate behavior. Preserving stable comment IDs and timestamps matters for consistent UI refresh and future auditability.
- Enforce that only the original `authorId` may edit a comment, even if other trip members can read the same target.
- Require current trip membership before allowing a comment edit. A user who loses trip access must not retain comment-edit privileges through stale IDs alone.
- Reuse existing trimming and length validation (`1..1000` chars) for edited comment bodies.
- Preserve the current CSRF validation, session enforcement, and `{ data, error }` API envelope patterns.
- Do not introduce delete-comment, moderator tools, edit history, optimistic concurrency, or realtime synchronization in this story.
- Keep votes and non-feedback trip mutations unchanged.
- In `TripTimeline.tsx`, move the day-level comments trigger into the compact right-side metadata row beside the accommodation status chip and planned/open time summary so the default overview shows more days per viewport.
- Preserve accessibility and readability after the layout move; if the row wraps on narrow screens, it should still read as one compact metadata group rather than reverting to a large separate comments block.

### Architecture Compliance

- Keep trip-access resolution in `travelplan/src/lib/auth/tripAccess.ts` and repository-level feedback ownership checks in `travelplan/src/lib/repositories/tripFeedbackRepo.ts`.
- Keep backend request handling in Next.js App Router route handlers under `travelplan/src/app/api/trips/**/route.ts`.
- Preserve Prisma as the source of truth for feedback persistence; `TripFeedbackComment.updatedAt` should remain the canonical edit timestamp.
- Keep localized UI strings in `travelplan/src/i18n/en.ts` and `travelplan/src/i18n/de.ts`.
- Extend the existing `TripFeedbackPanel.tsx` dialog experience rather than creating a separate comment editor component tree unless the current component becomes too tangled to maintain.
- Keep the trip-overview layout refinement in `travelplan/src/components/features/trips/TripTimeline.tsx`; `TripDayView.tsx` should not be restyled unless required for consistency by the implementation.

### Library / Framework Requirements

- Target the versions already pinned in `travelplan/package.json`: `next@16.1.6`, `react@19.2.3`, `@mui/material@7.3.8`, `prisma@7.3.0`, `@prisma/client@7.3.0`, `react-hook-form@7.71.1`, `zod@4.1.11`, and `jose@6.1.0`.
- Keep API implementation in Next.js route handlers that match the current `/api/trips/[id]/feedback/**` structure.
- Reuse Material UI dialog, list, text field, alert, and button patterns already present in `TripFeedbackPanel`.
- Keep validation in Zod and persistence in Prisma; do not add a second validation or state-management library for this scoped enhancement.

### File Structure Requirements

- Feedback repository and summary mapping: `travelplan/src/lib/repositories/tripFeedbackRepo.ts`
- Existing create-comment route to keep aligned with edit behavior: `travelplan/src/app/api/trips/[id]/feedback/comments/route.ts`
- New edit route surface: `travelplan/src/app/api/trips/[id]/feedback/comments/[commentId]/route.ts`
- Shared access helpers: `travelplan/src/lib/auth/tripAccess.ts`
- Feedback validation schemas: `travelplan/src/lib/validation/tripFeedbackSchemas.ts`
- Existing feedback UI: `travelplan/src/components/features/trips/TripFeedbackPanel.tsx`
- Trip/day surfaces that already render feedback: `travelplan/src/components/features/trips/TripTimeline.tsx`, `travelplan/src/components/features/trips/TripDayView.tsx`
- i18n dictionaries: `travelplan/src/i18n/en.ts`, `travelplan/src/i18n/de.ts`
- Tests: extend current files under `travelplan/test/`, especially `tripFeedbackRoute.test.ts` and `tripFeedbackPanel.test.tsx`

### Testing Requirements

- Repository test: editing a comment authored by the caller updates the body and returns the refreshed summary with the same comment ID.
- Repository test: editing a comment authored by another user is rejected and leaves the original body unchanged.
- Route test: a viewer can edit their own comment on a supported target.
- Route test: a contributor can edit their own comment on a supported target.
- Route test: non-members cannot edit comments on a private trip.
- Route test: invalid edit bodies are rejected and do not mutate stored comments.
- UI test: `TripFeedbackPanel` renders an edit affordance only for the current user’s comments.
- UI test: save and cancel flows preserve the surrounding dialog behavior, including vote controls and focus management.
- UI test: the trip overview day card renders the comments trigger in the compact right-side metadata row next to the accommodation/planning summary and does not reintroduce the previous tall stacked layout.

### Previous Story Intelligence

- Story 5.3 deliberately persisted feedback authorship so later work could support “edit my own comment” without schema churn. Reuse that groundwork instead of redesigning feedback storage.
- Story 5.3 also established the feedback API subtree and dialog-based `TripFeedbackPanel`; this story should extend those paths, not bypass them.
- Story 4.7 already moved comments into dialog-based interactions to keep cards compact. This timeline adjustment should continue that direction by improving day-card density in the trip overview.
- Story 5.4 widened contributor permissions for core trip planning data but left collaboration feedback as a separate concern. Story 5.5 must not let contributor edit authority blur into comment ownership rules; both viewers and contributors may edit only their own comments.

### Git Intelligence Summary

- Recent collaboration work follows the project pattern of extending existing route handlers, repository helpers, and UI surfaces rather than creating alternate subsystems.
- The current feedback code already exposes all data needed for edits except the update path itself: comment IDs, `author.id`, and `updatedAt` are already returned to the client.
- The present gap is concentrated in four places: repository update logic, an edit route, author-aware UI state in `TripFeedbackPanel`, and a small trip-overview layout adjustment in `TripTimeline.tsx`.

### Latest Tech Information

- Local package versions in `travelplan/package.json` are the implementation target for this story; do not bundle framework upgrades into the comment-edit feature.
- Next.js App Router route handlers remain the correct request-handler surface for this change: [Next.js Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers)
- Prisma update operations should continue to drive persistence for `TripFeedbackComment` edits inside the existing repository layer: [Prisma CRUD](https://www.prisma.io/docs/orm/prisma-client/queries/crud)
- Material UI’s existing dialog pattern remains appropriate for in-context comment editing in the current feedback panel: [MUI Dialog](https://mui.com/material-ui/react-dialog/)
- React Hook Form is already in the dependency set, but unless the feedback editor becomes materially more complex, a lightweight local-state edit flow is sufficient and consistent with the current component structure: [React Hook Form `useForm`](https://react-hook-form.com/docs/useform)

### Project Context Reference

No `project-context.md` file was found in this repository.

### Project Structure Notes

- `travelplan/src/lib/repositories/tripFeedbackRepo.ts` already centralizes target lookup, membership checks, summary aggregation, and comment creation. That is the correct place to add author-checked comment updates.
- `travelplan/src/app/api/trips/[id]/feedback/comments/route.ts` currently exposes only `POST`, so an edit route should stay adjacent to that surface to preserve API discoverability and conventions.
- `TripFeedbackPanel.tsx` already renders comment IDs, author emails, and `updatedAt` values in the response model, but it has no author-aware editing state. The component should be extended rather than replaced.
- `travelplan/test/tripFeedbackRoute.test.ts` and `travelplan/test/tripFeedbackPanel.test.tsx` already cover the create-comment/vote flows and are the right regression anchors for this story.
- The current feedback payload includes `author.id`, which gives the UI enough information to decide whether to show an edit affordance if the current user ID is available through the existing trip/session data flow.
- `TripTimeline.tsx` currently renders a day-level `TripFeedbackPanel` below the accommodation summary block. The requested UI refinement is to move that trigger into the right-side summary row beside the booking tag and planned/open time indicators so each day card becomes shorter.

### References

- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/epics.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/prd.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/architecture.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/ux-design-specification.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/5-3-viewer-access-with-comments-and-votes.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/5-4-contributor-full-edit-permissions.md`
- `/Users/tommy/Development/TravelPlan/travelplan/package.json`
- `/Users/tommy/Development/TravelPlan/travelplan/prisma/schema.prisma`
- `/Users/tommy/Development/TravelPlan/travelplan/src/lib/auth/tripAccess.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/lib/repositories/tripFeedbackRepo.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/lib/validation/tripFeedbackSchemas.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/app/api/trips/[id]/feedback/comments/route.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/components/features/trips/TripFeedbackPanel.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/src/components/features/trips/TripTimeline.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/src/components/features/trips/TripDayView.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/test/tripFeedbackRoute.test.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/test/tripFeedbackPanel.test.tsx`
- [Next.js Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers)
- [Prisma CRUD](https://www.prisma.io/docs/orm/prisma-client/queries/crud)
- [MUI Dialog](https://mui.com/material-ui/react-dialog/)
- [React Hook Form `useForm`](https://react-hook-form.com/docs/useform)

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Create-story workflow selected the next backlog item `5-5-edit-own-comments` from `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/sprint-status.yaml`.
- `project-context.md` was not present, so story context was built from planning artifacts, previous Epic 5 implementation stories, the current feedback/comment code, and existing tests.
- `_bmad/core/tasks/validate-workflow.xml` is referenced by the BMAD workflow but is not present in this repository, so checklist validation could not be run through the expected task runner.

### Completion Notes List

- Created Story 5.5 as a scoped extension of the existing trip feedback subsystem rather than a new collaboration surface.
- Anchored the implementation in the current normalized feedback schema, repository aggregation logic, App Router feedback routes, and `TripFeedbackPanel` dialog UI.
- Preserved the established collaboration boundary: viewers and contributors may edit only their own comments, while other trip mutations and ownership rules remain unchanged.
- Identified the main implementation seams as repository ownership checks, a comment-edit route, edit-state UI, a trip-overview layout refinement in `TripTimeline.tsx`, and regressions for author-only behavior plus compact card placement.
- Implemented `updateTripFeedbackComment`, the new `PUT /api/trips/[id]/feedback/comments/[commentId]` route, and a dedicated edit-body Zod schema while preserving the existing feedback envelope and not-found behavior for non-members.
- Added `currentUserId` to trip detail payloads, wired author-aware edit controls into `TripFeedbackPanel`, and passed that identity through `TripTimeline` and `TripDayView` so only authored comments show edit actions.
- Moved the trip timeline comments trigger into the right-side metadata row and added regression coverage for repository, route, panel, and timeline behavior.
- Review follow-up fixes: restored the trip-level feedback trigger in `TripTimeline`, moved the accommodation status chip and planned/open summary into the same compact day metadata row as the comments trigger, and added comment-specific edit button labels for assistive tech.
- Validation: `npm test` passed with 429/429 tests; `npm run lint` passed with pre-existing warnings only.

### File List

- _bmad-output/implementation-artifacts/5-5-edit-own-comments.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- travelplan/src/app/api/trips/[id]/feedback/comments/[commentId]/route.ts
- travelplan/src/app/api/trips/[id]/route.ts
- travelplan/src/components/features/trips/TripDayView.tsx
- travelplan/src/components/features/trips/TripFeedbackPanel.tsx
- travelplan/src/components/features/trips/TripTimeline.tsx
- travelplan/src/i18n/de.ts
- travelplan/src/i18n/en.ts
- travelplan/src/lib/repositories/tripFeedbackRepo.ts
- travelplan/src/lib/validation/tripFeedbackSchemas.ts
- travelplan/test/tripFeedbackPanel.test.tsx
- travelplan/test/tripFeedbackRepo.test.ts
- travelplan/test/tripFeedbackRoute.test.ts
- travelplan/test/tripTimelineFeedback.test.tsx

## Change Log

- 2026-03-09: Implemented author-only comment editing across repository, API, and UI; moved the trip timeline feedback trigger into the compact metadata row; added repository, route, panel, and timeline regression coverage; validated with full test suite and lint.
