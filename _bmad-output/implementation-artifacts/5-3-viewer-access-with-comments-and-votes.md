# Story 5.3: Viewer Access With Comments and Votes

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a viewer,
I want to view the trip and add comments or votes,
so that I can contribute suggestions without changing core details.

## Acceptance Criteria

1. Given I have a viewer trip membership, when I open a shared trip, then I can load the same trip overview and day-level details that owners can see, including accommodations, day items, travel segments, and existing collaboration signals for that trip.
2. Given I have a viewer trip membership, when I attempt to edit protected trip data such as trip details, accommodations, day items, bucket-list items, travel segments, payments, imports, exports, or member management, then the request is rejected and no trip data is changed.
3. Given I have a viewer trip membership, when I add a comment to a supported trip element, then the comment is persisted with my user identity, is returned in subsequent reads, and is visible on that element to trip participants.
4. Given I have a viewer trip membership, when I add or change my vote on a supported trip element, then my vote is persisted, the latest state is reflected in the UI, and aggregate vote feedback is visible on that element.
5. Given a trip already has comments or votes on supported elements, when an owner, contributor, or viewer opens the trip, then those collaboration signals are shown in context without blocking the existing planning flows.
6. Given I am not a member of the trip, when I try to read or write comments or votes for that trip, then I receive the same inaccessible-trip behavior already used by the trip APIs.

## Tasks / Subtasks

- [x] Task 1: Add trip-scoped comment and vote persistence for viewer collaboration. (AC: 3, 4, 5, 6)
- [x] Add explicit Prisma models for collaboration feedback on trip elements instead of overloading existing day-plan or accommodation records with ad hoc JSON.
- [x] Model the feedback target so comments and votes can attach to the trip-level and day-level entities this story supports first, using the existing normalized schema and naming rules.
- [x] Enforce one active vote per user per target so viewers can change their vote without creating duplicate rows.
- [x] Add the necessary indexes, foreign keys, and migration files under `travelplan/prisma/migrations/*`, then regenerate the Prisma client.
- [x] Task 2: Extend repository and access helpers to separate read access from edit authority. (AC: 1, 2, 6)
- [x] Reuse the existing trip membership model in `travelplan/src/lib/repositories/tripRepo.ts` so viewers can read shared trip detail data but remain blocked from owner/contributor-only mutations.
- [x] Add focused repository helpers for collaboration reads and writes rather than scattering comment/vote logic across route handlers.
- [x] Preserve existing `401` for missing auth and existing inaccessible-trip behavior for authenticated users without trip access.
- [x] Task 3: Add REST API routes for comment and vote operations using current backend patterns. (AC: 2, 3, 4, 5, 6)
- [x] Add route handlers under the current trip API surface, for example a collaboration subtree such as `travelplan/src/app/api/trips/[id]/feedback/**/route.ts`, instead of inventing a parallel API namespace.
- [x] Validate payloads with Zod, keep the `{ data, error }` envelope, and enforce CSRF on state-changing requests.
- [x] Allow owner, contributor, and viewer memberships to read comments/votes, but allow viewer writes only for comment/vote records and not for core trip mutations.
- [x] Return collaboration payloads in a shape the existing trip UI can render without extra client-side joining work.
- [x] Task 4: Surface viewer-safe collaboration UI inside the current trip experience. (AC: 1, 3, 4, 5)
- [x] Extend the existing trip detail surfaces such as `TripTimeline.tsx` and day/detail cards instead of creating a separate viewer-only page.
- [x] Add a small suggestion/voting widget and comment entry/list UI that follows the UX guidance for contextual contributions on item detail cards.
- [x] Keep read-only viewers from seeing misleading owner/contributor editing controls; collaboration affordances should be clearly distinct from core edit actions.
- [x] Add EN/DE i18n strings for comments, votes, empty states, errors, and success feedback.
- [x] Task 5: Lock down viewer write boundaries across the existing trip API surface. (AC: 2, 6)
- [x] Audit the current `/api/trips/*` handlers and keep viewers blocked from all existing trip mutation endpoints until Story 5.4 grants contributor edit authority.
- [x] Add or reuse shared authorization helpers so the boundary is explicit and testable rather than duplicated inconsistently.
- [x] Make sure owner-only operations such as member management remain owner-only.
- [x] Task 6: Add regression coverage for viewer reads, collaboration writes, and forbidden core edits. (AC: 1, 2, 3, 4, 5, 6)
- [x] Add repository tests for collaboration target lookup, vote uniqueness, aggregate reads, and membership-gated access.
- [x] Add route tests proving viewers can read trip detail plus collaboration data, can create/update comments and votes, and cannot mutate protected trip resources.
- [x] Add UI tests for contextual rendering of comments/votes, viewer submission flows, and hidden/disabled edit controls.

## Dev Notes

### Developer Context

Story 5.1 introduced `TripMember` and made shared-trip reads possible through the main trip repository. Story 5.2 enforced first-login password changes for provisioned collaborators. Story 5.3 should build directly on that foundation: a viewer is now a legitimate authenticated trip member who may read shared trip data and contribute lightweight feedback, but must still be blocked from changing core planning data. The implementation should establish a durable collaboration model that Story 5.5 can later extend for editing a user’s own comments without requiring another schema rewrite.

### Technical Requirements

- Treat comments and votes as trip-scoped collaboration data, not as mutations to existing planning entities.
- Keep viewer permissions limited to read access plus comment/vote creation or update on supported targets. Viewers must remain unable to edit trip details, day content, accommodation records, travel segments, bucket-list items, sharing state, import/export flows, or other core data.
- Reuse the current membership model in Prisma rather than introducing another collaborator abstraction.
- Persist authorship for comments and user identity for votes so later stories can support `edit my own comment` and clear per-user vote state.
- Prefer explicit normalized tables over embedding comments or votes inside `contentJson`, free-form JSON columns, or client-only state.
- Keep one vote record per user per target. Changing a vote should update or replace the prior user vote, not append duplicates.
- Preserve CSRF validation, `{ data, error }` responses, route-handler structure, and existing auth/session behavior.
- Keep localized UI strings in `travelplan/src/i18n/en.ts` and `travelplan/src/i18n/de.ts`.
- Avoid introducing real-time infrastructure in this story. Existing refresh-driven behavior is acceptable per the product requirements.

### Architecture Compliance

- Continue using Next.js App Router route handlers under `travelplan/src/app/api/**/route.ts` for backend operations.
- Keep data access and membership-aware authorization logic in `travelplan/src/lib/repositories/` and related auth helpers, not duplicated inline in many handlers.
- Preserve Prisma as the source of truth for relational modeling and migrations.
- Preserve DB `snake_case`, API JSON `camelCase`, and TypeScript symbol naming conventions already established in the project.
- Follow the current trip detail loading path centered on `getTripWithDaysForUser` and extend it or add adjacent collaboration loaders, rather than building a separate viewer-trip retrieval path.
- Keep viewer authorization separate from contributor authorization so Story 5.4 can widen edit authority cleanly later instead of undoing viewer-specific assumptions.

### Library / Framework Requirements

- Target the versions already pinned in `travelplan/package.json`: `next@16.1.6`, `react@19.2.3`, `@mui/material@7.3.8`, `prisma@7.3.0`, `@prisma/client@7.3.0`, `react-hook-form@7.71.1`, `zod@4.1.11`, and `jose@6.1.0`.
- Keep API implementation in Next.js route handlers and request/response utilities that match the current `/api/trips/*` and `/api/auth/*` patterns.
- Reuse React Hook Form where a structured comment form is needed, matching the app’s current client form approach.
- Use Material UI components for comment input, vote controls, lists, badges, alerts, and empty states so the collaboration UI stays visually consistent with the rest of the app.
- Keep request validation in Zod and relational persistence in Prisma; do not add another form, validation, or ORM library for this story.

### File Structure Requirements

- Prisma schema and migration updates: `travelplan/prisma/schema.prisma`, `travelplan/prisma/migrations/*`
- Shared trip access and collaboration repository logic: `travelplan/src/lib/repositories/tripRepo.ts` or a new collaboration-focused repository in the same folder
- Trip detail route already used for shared reads: `travelplan/src/app/api/trips/[id]/route.ts`
- Existing member-management route to keep owner-only: `travelplan/src/app/api/trips/[id]/members/route.ts`
- Suggested collaboration route surface: `travelplan/src/app/api/trips/[id]/feedback/**/route.ts`
- Existing trip detail client surface to extend: `travelplan/src/components/features/trips/TripTimeline.tsx`
- Existing sharing surface for collaborator context: `travelplan/src/components/features/trips/TripShareDialog.tsx`
- i18n dictionaries: `travelplan/src/i18n/en.ts`, `travelplan/src/i18n/de.ts`
- Tests: extend or add files under `travelplan/test/` following current route/component naming conventions

### Testing Requirements

- Route test: a viewer membership can read shared trip detail data plus collaboration payloads for supported targets.
- Route test: a viewer can create a comment on a supported target and sees it returned on subsequent reads.
- Route test: a viewer can cast and later change a vote on a supported target without producing duplicate vote rows.
- Route test: a non-member authenticated user cannot read or write collaboration data for another user’s trip.
- Route test: a viewer cannot call protected core mutation endpoints such as trip update, day edits, stay edits, bucket-list edits, travel-segment edits, export/import, or member management.
- Repository test: collaboration queries aggregate comments/votes correctly for a target while preserving per-user vote uniqueness.
- UI test: the trip detail view renders contextual comments/votes for viewers and allows submitting feedback from the existing trip experience.
- UI test: viewer users do not receive owner/contributor edit affordances for protected trip mutations.

### Previous Story Intelligence

- Story 5.1 established `TripMember`, trip-scoped collaborator roles, and the owner-facing sharing dialog. Build on that structure rather than introducing a second sharing model.
- Story 5.1 also widened trip detail reads to collaborator memberships through the main trip repository. That means viewer read access is already partially enabled and should now be formalized instead of reimplemented.
- Story 5.2 enforced `mustChangePassword` before collaborators can access trip routes and APIs. Story 5.3 can therefore assume authenticated invited viewers reaching the app have already cleared the first-login gate.

### Git Intelligence Summary

- Recent commits are centered on Epic 5 collaboration work and continue the project pattern of extending existing route handlers, repository helpers, and Material UI trip surfaces.
- The codebase currently favors incremental extension of established trip APIs and components over parallel subsystems. This story should follow that pattern for comments and votes too.

### Latest Tech Information

- Local package versions in `travelplan/package.json` are the implementation target; do not upgrade framework or ORM versions as part of this story.
- The current official Next.js docs still position App Router route handlers as the standard request-handler surface, and the current Next.js docs site reflects version `16.1.6`.
- Next.js middleware documentation currently redirects to the `proxy` file-convention docs, which is relevant only as a reminder not to misuse middleware/proxy for business logic that belongs in trip route handlers and repository authorization.
- Prisma’s official many-to-many relation guidance remains consistent with the explicit relation style already used here via `TripMember`, which should continue to underpin trip-scoped collaboration access.
- Zod remains the validation layer for safe request parsing, and React Hook Form remains suitable for lightweight structured client forms in this codebase.

### Project Context Reference

No `project-context.md` file was found in this repository.

### Project Structure Notes

- `travelplan/src/lib/repositories/tripRepo.ts` already exposes `TripAccessRole` and membership-aware trip detail loading. That is the natural place to centralize viewer/contributor/owner collaboration permissions.
- `travelplan/src/app/api/trips/[id]/route.ts` currently permits shared trip reads but still allows only the established mutation flows. Story 5.3 should preserve read access and tighten mutation checks for viewers where needed.
- `travelplan/src/components/features/trips/TripTimeline.tsx` is already the owner-facing hub for trip detail rendering and is the best place to add in-context collaboration widgets rather than sending viewers to a separate screen.
- `travelplan/src/components/features/trips/TripShareDialog.tsx` already shows collaborator context and role labels; reuse its i18n and UX conventions for collaboration-related copy.
- The schema currently has no persisted comment or vote models, so this story needs a new durable data model rather than just wiring UI.

### References

- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/epics.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/architecture.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/ux-design-specification.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/prd.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/5-1-invite-viewer-or-contributor-by-email-with-temp-password.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/5-2-enforce-first-login-password-change.md`
- `/Users/tommy/Development/TravelPlan/travelplan/package.json`
- `/Users/tommy/Development/TravelPlan/travelplan/prisma/schema.prisma`
- `/Users/tommy/Development/TravelPlan/travelplan/src/lib/repositories/tripRepo.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/app/api/trips/[id]/route.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/app/api/trips/[id]/members/route.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/components/features/trips/TripTimeline.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/src/components/features/trips/TripShareDialog.tsx`
- [Next.js Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers)
- [Next.js Proxy file convention](https://nextjs.org/docs/app/api-reference/file-conventions/proxy)
- [Prisma many-to-many relations](https://www.prisma.io/docs/orm/prisma-schema/data-model/relations/many-to-many-relations)
- [React Hook Form `useForm`](https://react-hook-form.com/docs/useform)
- [Zod documentation](https://zod.dev/)

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Create-story workflow selected the next backlog item `5-3-viewer-access-with-comments-and-votes` from `_bmad-output/implementation-artifacts/sprint-status.yaml`.
- `project-context.md` was not present, so story context was built from planning artifacts, architecture docs, implementation artifacts, and the live codebase.
- Recent git history reviewed: `Story 5.2 enforce first login password change`, `Story 5.1 invite viewer or contributor`, `Story 4.6 Show Open Costs`, `Story 4.5 Payment Schedule`.
- Official references checked for current Next.js, Prisma, and Zod guidance; React Hook Form docs URL was included as a reference target even though direct page rendering in the browser tool failed.
- Added normalized `TripFeedbackTarget`, `TripFeedbackComment`, and `TripFeedbackVote` Prisma models plus `20260309090000_add_trip_feedback` migration and regenerated the Prisma client.
- Extended `getTripWithDaysForUser` and `/api/trips/[id]` to return trip/day collaboration payloads and the caller access role for viewer-safe rendering.
- Added collaboration repository helpers plus comment/vote route handlers under `travelplan/src/app/api/trips/[id]/feedback/**/route.ts`.
- Full regression suite passed with `npm test` after the collaboration changes and the viewer-boundary follow-up fixes; `npm run lint` completed with pre-existing warnings only.

### Completion Notes List

- Created the story for Epic 5’s next backlog item and marked it `ready-for-dev`.
- Captured viewer-read versus viewer-write boundaries explicitly so Story 5.4 can later expand contributor edit authority without undoing this story.
- Anchored the implementation in the current Prisma schema, trip repository, trip detail route, and trip timeline UI instead of describing hypothetical surfaces.
- Called out the need for normalized comment/vote persistence, membership-aware authorization helpers, and regression coverage for forbidden core edits.
- Implemented normalized trip feedback persistence, vote upsert semantics, feedback loaders, and feedback mutation routes for trip, trip day, accommodation, and day-plan-item targets.
- Added a viewer-safe timeline collaboration widget, hid owner-only trip controls for read-only viewers, and localized the new feedback UI strings in EN/DE.
- Added regression coverage for repository aggregation, feedback route access, viewer write restrictions on protected trip mutations, and timeline feedback rendering.
- Extended the feedback UI into the day experience so viewers can comment and vote on trip days, accommodations, and day-plan items without entering a separate viewer-only flow.
- Added explicit owner-only authorization helpers across the existing trip mutation API surface while preserving shared reads for trip detail and image galleries.
- Verified the full regression suite after the day-image route authorization fix; the story is ready for review.
- Moved trip access resolution into the shared `tripAccess` helper so feedback and core trip routes use one membership authority path.
- Closed the viewer boundary gap on `POST /api/trips/[id]/days/[dayId]/image` and added regression coverage for viewer denial on day image, day plan item, and travel segment mutations.
- Added a day-view UI regression proving viewers can submit collaboration feedback from the in-context detail surface while owner-only controls stay hidden.

### File List

- _bmad-output/implementation-artifacts/5-3-viewer-access-with-comments-and-votes.md
- travelplan/prisma/schema.prisma
- travelplan/prisma/migrations/20260309090000_add_trip_feedback/migration.sql
- travelplan/src/lib/db/prisma.ts
- travelplan/src/lib/repositories/tripRepo.ts
- travelplan/src/lib/repositories/tripFeedbackRepo.ts
- travelplan/src/lib/validation/tripFeedbackSchemas.ts
- travelplan/src/app/api/trips/[id]/route.ts
- travelplan/src/app/api/trips/[id]/feedback/comments/route.ts
- travelplan/src/app/api/trips/[id]/feedback/votes/route.ts
- travelplan/src/components/features/trips/TripTimeline.tsx
- travelplan/src/components/features/trips/TripDayView.tsx
- travelplan/src/components/features/trips/TripFeedbackPanel.tsx
- travelplan/src/i18n/en.ts
- travelplan/src/i18n/de.ts
- travelplan/src/lib/auth/tripAccess.ts
- travelplan/src/lib/repositories/accommodationRepo.ts
- travelplan/src/lib/repositories/dayPlanItemRepo.ts
- travelplan/test/tripFeedbackRepo.test.ts
- travelplan/test/tripFeedbackRoute.test.ts
- travelplan/test/tripAccommodationImagesRoute.test.ts
- travelplan/test/tripCollaborationRepo.test.ts
- travelplan/test/tripDayPlanItemImagesRoute.test.ts
- travelplan/test/tripDayImageRoute.test.ts
- travelplan/test/tripDayPlanItemsRoute.test.ts
- travelplan/test/tripDayViewLayout.test.tsx
- travelplan/test/travelSegmentRoute.test.ts
- travelplan/test/tripTimelineFeedback.test.tsx

### Change Log

- 2026-03-09: Completed Story 5.3 and moved it to review after adding normalized trip feedback persistence, viewer-safe trip/day collaboration UI, explicit owner-only mutation guards across the trip API, and full regression coverage.
- 2026-03-09: Fixed post-review issues by centralizing trip access resolution, blocking viewer day-image uploads at the route boundary, and adding missing viewer-boundary/day-view feedback regressions before moving the story to done.
