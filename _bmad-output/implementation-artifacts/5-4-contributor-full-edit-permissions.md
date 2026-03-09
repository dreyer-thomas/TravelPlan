# Story 5.4: Contributor Full Edit Permissions

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a contributor,
I want to edit trip data like the owner,
so that I can help maintain the plan directly.

## Acceptance Criteria

1. Given I have a contributor role, when I edit trip details, accommodations, or day plans, then my changes are saved and visible.

## Tasks / Subtasks

- [x] Task 1: Widen trip write authorization from owner-only to owner-or-contributor for the intended planning surfaces. (AC: 1)
  - [x] Replace owner-only guards based on `hasTripOwnerAccess` with a shared owner-or-contributor authorization helper for trip detail updates, accommodations, day plan items, and travel segments.
  - [x] Keep member management, collaborator provisioning, and any invite-management flows owner-only even after contributor edit authority is added.
  - [x] Keep non-member behavior unchanged so unauthorized users still receive the same inaccessible-trip result pattern.
- [x] Task 2: Centralize trip access rules so contributor writes do not fragment across route handlers. (AC: 1)
  - [x] Extend `travelplan/src/lib/auth/tripAccess.ts` to expose explicit read, owner-only, and owner-or-contributor checks from the single `TripAccessRole` source.
  - [x] Reuse those helpers across `/api/trips/*` mutation handlers instead of duplicating ad hoc role logic per route.
  - [x] Preserve the current owner, viewer, contributor naming and `TripMemberRole` mapping already used by the repository and UI.
- [x] Task 3: Allow contributors to edit top-level trip details through the existing detail flow. (AC: 1)
  - [x] Update `travelplan/src/app/api/trips/[id]/route.ts` `PATCH` handling so contributors can edit trip name and date range through the existing `updateTripWithDays` path.
  - [x] Confirm the response continues to return `accessRole`, feedback payloads, and the existing `{ data, error }` envelope without contract drift.
  - [x] Keep trip deletion owner-only unless product scope explicitly says otherwise.
- [x] Task 4: Allow contributors to manage accommodations and day plan items in the existing day workflow. (AC: 1)
  - [x] Update the accommodation routes under `travelplan/src/app/api/trips/[id]/accommodations/**` so contributors can create, update, and delete accommodation data already available to owners.
  - [x] Update the day plan item routes under `travelplan/src/app/api/trips/[id]/day-plan-items/**` so contributors can create, edit, and delete day items through the same schemas and repository helpers already used by owners.
  - [x] Keep viewer restrictions intact; viewers must remain collaboration-only users as established in Story 5.3.
- [x] Task 5: Allow contributors to manage day-level travel planning artifacts that support editable trip plans. (AC: 1)
  - [x] Update `travelplan/src/app/api/trips/[id]/travel-segments/route.ts` so contributors can create, edit, and delete travel segments.
  - [x] Review related planning mutation routes such as accommodation copy helpers and enable contributor access only where it is necessary to make “edit trip data like the owner” true for day planning.
  - [x] Keep export/import and other high-risk actions intentionally scoped; if they remain owner-only, document that boundary clearly in the story and tests so “like the owner” does not get implemented carelessly.
- [x] Task 6: Surface contributor editing affordances in the existing trip UI while preserving viewer-safe read-only behavior. (AC: 1)
  - [x] Update `travelplan/src/components/features/trips/TripTimeline.tsx` so contributor users see the same edit controls owners use for trip details and planning actions, while viewers remain read-only for core mutations.
  - [x] Update `travelplan/src/components/features/trips/TripDayView.tsx` so contributor users can open the existing accommodation, day plan, and travel-segment dialogs without owner-only gating.
  - [x] Preserve the Story 5.3 collaboration widgets and keep the UI role distinctions explicit enough that viewers do not see edit actions they still cannot perform.
- [x] Task 7: Add regression coverage for contributor writes and preserved owner/viewer boundaries. (AC: 1)
  - [x] Add route tests proving contributors can update trip details, accommodations, day plan items, and travel segments on shared trips.
  - [x] Add route tests proving viewers are still blocked from those same core mutation endpoints and owners still retain access.
  - [x] Add UI tests proving contributor sessions expose edit affordances in timeline/day views while viewer sessions continue to hide them.

## Dev Notes

### Developer Context

Story 5.1 already created the `TripMember` model and provisioning flow for both `viewer` and `contributor` roles. Story 5.3 then formalized the read-versus-write split by allowing viewers to read trip data and create feedback while keeping all core trip mutations owner-only. Story 5.4 should now widen the existing core planning mutation surfaces for contributors without undoing the clear viewer restrictions or creating a second authorization model.

The live codebase already exposes contributor as a first-class membership value in Prisma, validation, repositories, and UI payloads, but the route layer still overwhelmingly checks `hasTripOwnerAccess`. That means the implementation is primarily an authorization-widening and UI-unhiding story, not a new schema story. The safest approach is to centralize role checks once and then apply them consistently across the trip mutation surface that contributors are supposed to use.

### Technical Requirements

- Treat `TripAccessRole` in `travelplan/src/lib/auth/tripAccess.ts` as the authoritative role resolution for owner, contributor, and viewer behavior.
- Do not add a new collaborator role, new table, or alternative sharing model. `TripMember.role` already models the needed distinction.
- Reuse the existing route handlers, repositories, Zod schemas, and dialogs for mutations instead of creating contributor-specific APIs or screens.
- Expand contributor authority only to the trip-planning mutation surfaces required by the story: trip detail edits, accommodations, day plan items, and supporting travel segments.
- Preserve owner-only restrictions for member management and other high-risk ownership actions unless explicitly included in this story’s acceptance scope.
- Preserve viewer restrictions from Story 5.3. Viewers must remain able to read and collaborate with comments/votes only, not edit core planning data.
- Keep CSRF validation, session enforcement, and `{ data, error }` response envelopes unchanged across updated routes.
- Preserve existing `404` inaccessible-trip behavior for authenticated users who do not have the required access to mutate a shared trip.

### Architecture Compliance

- Keep access resolution in `travelplan/src/lib/auth/tripAccess.ts`; that is the natural place to add a contributor-capable write helper such as owner-or-contributor access.
- Keep trip CRUD logic in the existing Next.js App Router route handlers under `travelplan/src/app/api/trips/**/route.ts`.
- Continue routing trip reads through `getTripWithDaysForUser` and related repository helpers in `travelplan/src/lib/repositories/tripRepo.ts`; do not create a separate contributor trip-loading path.
- Preserve the established file and naming conventions: database `snake_case`, API JSON `camelCase`, TypeScript `camelCase` / `PascalCase`.
- Keep UI changes in the current trip experience, especially `TripTimeline.tsx` and `TripDayView.tsx`, instead of creating a separate contributor-only interface.

### Library / Framework Requirements

- Stay on the currently pinned stack in `travelplan/package.json`: `next@16.1.6`, `react@19.2.3`, `@mui/material@7.3.8`, `prisma@7.3.0`, `@prisma/client@7.3.0`, `react-hook-form@7.71.1`, `zod@4.1.11`, and `jose@6.1.0`.
- Keep backend changes in Next.js App Router route handlers, following the existing `/api/trips/*` pattern rather than adding a separate RPC layer.
- Reuse Material UI dialogs, actions, alerts, and buttons already present in the trip planning views.
- Keep validation in Zod and persistence in Prisma; no new validation, ORM, or form library should be introduced for this authorization-expansion story.

### File Structure Requirements

- Access helpers: `travelplan/src/lib/auth/tripAccess.ts`
- Membership-aware trip loading and collaborator logic: `travelplan/src/lib/repositories/tripRepo.ts`
- Trip detail read/update route: `travelplan/src/app/api/trips/[id]/route.ts`
- Member-management route that should remain owner-only: `travelplan/src/app/api/trips/[id]/members/route.ts`
- Accommodation mutation routes: `travelplan/src/app/api/trips/[id]/accommodations/route.ts`, `travelplan/src/app/api/trips/[id]/accommodations/copy/route.ts`
- Day plan item mutation routes: `travelplan/src/app/api/trips/[id]/day-plan-items/route.ts`
- Travel segment mutation route: `travelplan/src/app/api/trips/[id]/travel-segments/route.ts`
- Image and export/import routes to review for scope boundaries: `travelplan/src/app/api/trips/[id]/hero-image/route.ts`, `travelplan/src/app/api/trips/[id]/days/[dayId]/image/route.ts`, `travelplan/src/app/api/trips/[id]/day-plan-items/images/route.ts`, `travelplan/src/app/api/trips/[id]/accommodations/images/route.ts`, `travelplan/src/app/api/trips/[id]/export/route.ts`
- Timeline and day-view UI surfaces: `travelplan/src/components/features/trips/TripTimeline.tsx`, `travelplan/src/components/features/trips/TripDayView.tsx`
- Role-selection and collaborator copy reference: `travelplan/src/components/features/trips/TripShareDialog.tsx`
- Tests: extend existing files under `travelplan/test/`, especially route tests already covering viewer denial and timeline/day-view role behavior

### Testing Requirements

- Route test: a contributor membership can update trip details through `PATCH /api/trips/[id]`.
- Route test: a contributor can create, update, and delete accommodations on a shared trip.
- Route test: a contributor can create, update, and delete day plan items on a shared trip.
- Route test: a contributor can create, update, and delete travel segments on a shared trip.
- Route test: viewers remain blocked from those same core trip mutation endpoints.
- Route test: member-management routes remain owner-only even for contributors.
- UI test: contributor sessions show trip-edit and day-edit controls in `TripTimeline` and `TripDayView`.
- UI test: viewer sessions continue hiding owner/contributor edit controls while still showing collaboration widgets from Story 5.3.

### Previous Story Intelligence

- Story 5.1 already provisioned both `viewer` and `contributor` memberships through the owner sharing flow, so Story 5.4 should reuse that role model rather than extending the invitation design.
- Story 5.2 enforced first-login password changes for provisioned collaborators before they can use shared trip access. Contributors reaching this story’s flows should therefore already be fully authenticated collaborators.
- Story 5.3 established the strict boundary that viewers may read and leave feedback but may not mutate core trip data. Story 5.4 must widen contributor rights without regressing that viewer boundary.

### Git Intelligence Summary

- Recent local commits are still centered on nearby collaboration work and bug fixes, which matches the existing pattern of extending current route handlers and UI surfaces rather than introducing alternate subsystems.
- The codebase already exposes contributor in types and payloads, but most mutation endpoints still gate on `hasTripOwnerAccess`. That is the dominant implementation pattern this story needs to change consistently.

### Latest Tech Information

- Local package versions in `travelplan/package.json` are the implementation target; do not bundle framework upgrades into this story.
- Next.js App Router route handlers remain the correct request-handler surface for these trip mutations: [Next.js Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers)
- Prisma relation modeling should continue to use the current explicit relational structure already present in `Trip`, `TripMember`, `TripDay`, `Accommodation`, and `DayPlanItem`: [Prisma Relations](https://www.prisma.io/docs/orm/prisma-schema/data-model/relations)
- Zod remains the request-validation layer already used by the trip routes: [Zod Docs](https://zod.dev/)
- React Hook Form remains the established structured form library in this codebase when existing dialogs/pages already depend on form state handling: [React Hook Form `useForm`](https://react-hook-form.com/docs/useform)

### Project Context Reference

No `project-context.md` file was found in this repository.

### Project Structure Notes

- `travelplan/src/lib/auth/tripAccess.ts` already resolves `owner`, `viewer`, and `contributor`, but only exports `hasTripReadAccess` and `hasTripOwnerAccess`. Story 5.4 should extend that shared helper layer rather than scattering contributor checks directly into each route.
- `travelplan/src/app/api/trips/[id]/route.ts` already returns `accessRole` in the trip payload, and `TripTimeline.tsx` / `TripDayView.tsx` already consume that field to hide controls from read-only collaborators. Contributors can therefore be surfaced by adjusting the same existing gating logic rather than designing a new UI branch.
- The mutation surface that still uses `hasTripOwnerAccess` includes trip detail updates, accommodations, day plan items, travel segments, export, image uploads, and member management. The story should widen only the planning-edit subset intentionally and leave the rest owner-only unless product scope explicitly requires more.
- `travelplan/src/components/features/trips/TripShareDialog.tsx` already exposes contributor as a selectable collaborator role, so the missing behavior is downstream authorization and UI enablement, not invite UX.
- Existing tests already prove viewer-denial behavior for several routes, which makes them the right starting point for contributor-success regressions and viewer-boundary preservation.

### References

- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/epics.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/architecture.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/prd.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/ux-design-specification.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/5-2-enforce-first-login-password-change.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/5-3-viewer-access-with-comments-and-votes.md`
- `/Users/tommy/Development/TravelPlan/travelplan/package.json`
- `/Users/tommy/Development/TravelPlan/travelplan/prisma/schema.prisma`
- `/Users/tommy/Development/TravelPlan/travelplan/src/lib/auth/tripAccess.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/lib/repositories/tripRepo.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/lib/validation/tripMemberSchemas.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/app/api/trips/[id]/route.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/app/api/trips/[id]/members/route.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/app/api/trips/[id]/accommodations/route.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/app/api/trips/[id]/accommodations/copy/route.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/app/api/trips/[id]/day-plan-items/route.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/app/api/trips/[id]/travel-segments/route.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/components/features/trips/TripTimeline.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/src/components/features/trips/TripDayView.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/src/components/features/trips/TripShareDialog.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/test/tripTimelineFeedback.test.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/test/tripDayViewLayout.test.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/test/tripDayPlanItemsRoute.test.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/test/travelSegmentRoute.test.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/test/tripMembersRoute.test.ts`
- [Next.js Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers)
- [Prisma Relations](https://www.prisma.io/docs/orm/prisma-schema/data-model/relations)
- [Zod Docs](https://zod.dev/)
- [React Hook Form `useForm`](https://react-hook-form.com/docs/useform)

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Create-story workflow selected the next backlog item `5-4-contributor-full-edit-permissions` from `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/sprint-status.yaml`.
- Manual validation was used because `_bmad/core/tasks/validate-workflow.xml` is referenced by the BMAD workflow but is not present in this repository.
- Story context was grounded in the current planning artifacts, previous Epic 5 implementation stories, and the live route/UI/auth codebase.

### Completion Notes List

- Story 5.4 is framed as an authorization-expansion story, not a schema or invitation-model story.
- The primary implementation risk is inconsistent route-level widening; centralizing contributor-capable authorization in `tripAccess.ts` is the main guardrail.
- Viewer restrictions from Story 5.3 are explicitly preserved, while member management remains owner-only.
- The story calls out the existing route and UI surfaces that already contain role-aware behavior so the developer can extend the current system instead of inventing parallel contributor flows.
- Added `canTripAccessRoleRead`, `canTripAccessRoleManageTrip`, and `hasTripOwnerOrContributorAccess`, then applied the shared write check to trip detail, accommodation, day plan item, travel segment, and accommodation-copy mutation routes.
- Widened repository write lookups for trip updates, accommodations, day plan items, travel segments, and previous-night accommodation copy to admit contributor memberships while leaving export, images, member management, and trip deletion owner-only.
- Updated `TripTimeline` and `TripDayView` so contributors can use trip/day planning edit affordances, while owner-only controls such as import/share/delete, bucket list editing, and day metadata/image editing remain hidden from contributors.
- Added contributor-success and owner/viewer-boundary regression coverage across route and UI tests; targeted contributor specs passed and the full Vitest suite passed (`420` tests).
- `npm run lint -- .` completed with the repository’s existing warning backlog and no lint errors.
- Code review fixes restored viewer read access on the day-plan item and travel-segment listing endpoints while keeping contributor write access intact.
- Added listing regressions for shared-trip viewers and contributors so participant reads are now covered at both the route and repository layers.

### File List

- _bmad-output/implementation-artifacts/5-4-contributor-full-edit-permissions.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- travelplan/src/app/api/trips/[id]/accommodations/copy/route.ts
- travelplan/src/app/api/trips/[id]/accommodations/route.ts
- travelplan/src/app/api/trips/[id]/day-plan-items/route.ts
- travelplan/src/app/api/trips/[id]/route.ts
- travelplan/src/app/api/trips/[id]/travel-segments/route.ts
- travelplan/src/components/features/trips/TripDayView.tsx
- travelplan/src/components/features/trips/TripTimeline.tsx
- travelplan/src/lib/auth/tripAccess.ts
- travelplan/src/lib/repositories/accommodationRepo.ts
- travelplan/src/lib/repositories/dayPlanItemRepo.ts
- travelplan/src/lib/repositories/travelSegmentRepo.ts
- travelplan/src/lib/repositories/tripRepo.ts
- travelplan/test/travelSegmentRoute.test.ts
- travelplan/test/tripAccommodationCopyRoute.test.ts
- travelplan/test/tripAccommodationRoute.test.ts
- travelplan/test/tripDayPlanItemsRoute.test.ts
- travelplan/test/tripDayViewLayout.test.tsx
- travelplan/test/tripDetailRoute.test.ts
- travelplan/test/tripMembersRoute.test.ts
- travelplan/test/tripTimelineFeedback.test.tsx

## Change Log

- 2026-03-09: Expanded contributor write access across trip planning routes and repositories, preserved owner-only high-risk actions, and added regression coverage for contributor UI and API behavior.
- 2026-03-09: Fixed review findings by restoring participant read access for day-plan item and travel-segment listings and adding viewer/contributor read regressions.
