# Story 5.1: Invite Viewer or Contributor by Email With Temp Password

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip owner,
I want to add a viewer or contributor by email with a temporary password,
so that I can grant access without sending email invitations yet.

## Acceptance Criteria

1. Given I am the trip owner, when I add a person with email, role (`viewer` or `contributor`), and a temporary password, then the account is created if needed and linked to the selected trip with the chosen role.
2. Given the entered email is invalid, when I attempt to save the invite, then I see a validation error and no user or membership is created.
3. Given the entered email already belongs to an account that is already linked to the trip, when I attempt to add the same person again, then I see a conflict error and no duplicate membership is created.
4. Given the entered email already belongs to an existing account that is not yet linked to the trip, when I add that person to the trip through this temp-password flow, then I see a conflict error and no password or membership is changed for that account.
5. Given I am not the trip owner, when I attempt to add a viewer or contributor to the trip, then the request is rejected and no membership or password change is applied.
6. Given a collaborator has been added successfully, when I view the trip sharing UI, then I can see the collaborator email and assigned trip role.
7. Given the account was provisioned through this temp-password flow, when the collaborator later signs in, then the account state indicates that a first-login password change is still required for Story 5.2 to enforce.

## Tasks / Subtasks

 - [x] Task 1: Add a trip-scoped collaboration model in Prisma.
 - [x] Introduce a dedicated trip membership model such as `TripMember` or `TripCollaborator` instead of overloading `users.role`.
 - [x] Add a trip membership role enum that supports at least `VIEWER` and `CONTRIBUTOR`.
 - [x] Add uniqueness constraints so one user can have at most one membership per trip.
 - [x] Add fields needed to support the temp-password onboarding flow for Story 5.2, such as a `mustChangePassword` flag on `User` or equivalent persisted state.
 - [x] Generate the Prisma client and add migration coverage for the new tables/columns.
- [x] Task 2: Extend backend validation and invitation APIs.
 - [x] Add Zod schemas for invite payload validation with normalized email, allowed trip roles, and password rules aligned with existing auth constraints.
 - [x] Implement a dedicated route for trip membership creation under the existing trip API surface, preserving the `{ data, error }` envelope and CSRF protection.
 - [x] Ensure only the trip owner can create memberships for that trip.
- [x] Reject existing-account emails in this story's temp-password flow so no established account password is overwritten.
 - [x] Hash any supplied temporary password with the existing bcrypt helper instead of storing or logging it in plain text.
 - [x] Set first-login-password-change state during successful invite provisioning.
 - [x] Return additive collaborator data needed by the UI after creation.
 - [x] Task 3: Extend repository access patterns for shared trips.
 - [x] Refactor owner-only trip lookup helpers so they can later support trip membership reads and writes without duplicating authorization logic.
 - [x] Preserve existing owner semantics for destructive trip actions in this story; do not broaden edit/delete access yet.
 - [x] Add a read helper that returns collaborators for the sharing UI and can act as the foundation for Stories 5.3 and 5.4.
 - [x] Keep unauthorized access behavior aligned with current API patterns (`404` for inaccessible trips, `401` for missing auth).
 - [x] Task 4: Add the owner-facing sharing UI to the trip screen.
 - [x] Add a sharing entry point to the existing trip detail experience rather than inventing a separate page.
 - [x] Build a dialog or panel for entering email, selecting `viewer` or `contributor`, and setting a temporary password.
 - [x] Show the current collaborator list with email and assigned role after loading or successful invite creation.
 - [x] Add EN/DE i18n strings for invite labels, role labels, validation messages, success feedback, and collaborator list copy.
 - [x] Task 5: Add regression coverage across schema, repository, route, and UI layers.
 - [x] Add Prisma/repository tests for membership creation, duplicate prevention, existing-user reuse, and owner-only enforcement.
 - [x] Add API route tests for validation errors, unauthorized/forbidden access, duplicate membership conflicts, and successful collaborator creation.
 - [x] Add UI tests for the share dialog flow and collaborator list rendering.
 - [x] Add a login-related regression test that proves invited accounts are marked for required password change without enforcing the redirect yet.

## Dev Notes

### Developer Context

Epic 5 starts a new collaboration capability, but the current application is strictly owner-centric. The current Prisma schema only models `User`, `Trip`, and trip-owned planning entities, and trip access is enforced everywhere through `trip.userId`. Story 5.1 therefore needs to establish the collaboration data model and owner-facing provisioning flow without prematurely implementing all viewer/contributor runtime permissions. The output of this story should make Stories 5.2, 5.3, and 5.4 straightforward rather than forcing another schema rewrite.

### Technical Requirements

- Do not treat `User.role` as the collaborator role for this feature. It is currently a coarse global enum and cannot correctly represent per-trip access.
- Introduce trip-scoped membership records so one user can be owner on one trip and collaborator on another.
- Preserve existing session, CSRF, rate-limit, bcrypt, and JWT patterns already used in the auth routes.
- Temporary passwords must be hashed with the existing bcrypt helper and must never be persisted or returned in plain text after request handling.
- Persist explicit first-login-password-change state now so Story 5.2 can enforce it without redesigning auth again.
- Prevent duplicate membership rows for the same trip/user pair, and reject established existing-account emails in this temp-password flow to avoid credential takeover.
- Keep this story scoped to provisioning and visibility of collaborators. Do not implement comments, votes, or contributor edit authority yet.
- Maintain current inaccessible-trip behavior in trip APIs: unauthenticated requests return `401`, authenticated users without access should continue to receive `404` where the current pattern already does that.

### Architecture Compliance

- Keep API handlers under `travelplan/src/app/api/**/route.ts`.
- Keep reusable authorization and membership lookup logic in `travelplan/src/lib/repositories/` or a closely related `lib/auth` helper, not inlined across route handlers.
- Preserve the API envelope shape `{ data, error }` from `src/lib/http/response.ts`.
- Preserve naming conventions: DB `snake_case`, API JSON `camelCase`.
- Treat this as an additive schema/API change. Existing trip CRUD, export/import, and cost flows must keep working unchanged for owners.

### Library / Framework Requirements

- Use the existing stack already pinned in the project: Next.js App Router route handlers, React 19, Prisma ORM 7, Material UI 7, Zod 4, and bcrypt 6.
- Follow the current Next.js route-handler approach used in `src/app/api/auth/*` and `src/app/api/trips/[id]/*`.
- Keep UI implementation aligned with the current Material UI + client component patterns used in `TripTimeline.tsx`, dialogs, and trip management forms.
- Reuse the i18n dictionary pattern in `src/i18n/en.ts` and `src/i18n/de.ts`.

### File Structure Requirements

- Prisma schema and migration: `travelplan/prisma/schema.prisma`, `travelplan/prisma/migrations/*`
- Suggested repository layer additions: `travelplan/src/lib/repositories/tripRepo.ts` or a new collaborator-focused repository module in the same folder
- Trip invite route: `travelplan/src/app/api/trips/[id]/members/route.ts` or equivalently scoped trip-sharing route under `/api/trips/[id]/...`
- Auth validation updates: `travelplan/src/lib/validation/authSchemas.ts` or a new dedicated collaboration validation module
- Owner-facing trip UI entry point: `travelplan/src/components/features/trips/TripTimeline.tsx`
- Suggested new UI component: `travelplan/src/components/features/trips/TripShareDialog.tsx`
- i18n updates: `travelplan/src/i18n/en.ts`, `travelplan/src/i18n/de.ts`
- Tests: add or extend files under `travelplan/test/` following current route/component naming conventions

### Testing Requirements

- Route test: owner can add a new viewer to a trip and receives collaborator data in the response.
- Route test: owner attempting to add an existing-account email receives a conflict and no password or membership is changed.
- Route test: duplicate membership on the same trip returns a conflict error.
- Route test: non-owner authenticated user cannot provision collaborators for someone else’s trip.
- Route test: invalid email, invalid role, and invalid temporary password return validation errors.
- Repository test: trip access helpers can resolve collaborator membership without regressing owner reads.
- UI test: owner can open the share dialog, submit valid data, and see the collaborator in the rendered list.
- Regression test: successful invite provisioning marks `mustChangePassword` (or equivalent) for Story 5.2.

### Previous Story Intelligence

Story 4.6 continued the existing pattern of extending current trip/detail surfaces instead of adding parallel endpoints or alternate data flows. That pattern matters here too: collaboration should extend the current trip detail experience and repository layer rather than creating disconnected share-only APIs or a duplicate trip-loading path.

### Git Intelligence Summary

Recent commits are concentrated in the trip cost overview and payment-schedule area, which reinforces that the codebase has been evolving by extending established trip routes, repository helpers, and Material UI screens. There is no recent collaboration foundation in git history, so this story should establish the minimal durable primitives cleanly in one place.

### Latest Tech Information

- The local project is already pinned to `next@16.1.6`, `react@19.2.3`, `@mui/material@7.3.8`, `prisma@7.3.0`, `@prisma/client@7.3.0`, `zod@4.1.11`, and `bcrypt@6.0.0` in `travelplan/package.json`.
- Official docs currently describe Next.js App Router Route Handlers as the standard way to implement server request handlers for route segments, which matches the existing `/api/auth/*` and `/api/trips/*` code structure.
- Official Prisma docs continue to position Prisma ORM as the schema/migration/client layer for relational data access, which is the correct place to introduce trip memberships and onboarding flags.
- Official Material UI docs remain aligned with the existing component-driven approach used across the app, so the sharing UI should stay in the current dialog/panel idiom rather than introducing a different UI system.
- Official Zod docs continue to support the same schema-first request validation style already used in this codebase; keep collaboration payload validation there instead of hand-rolled parsing.

### Project Context Reference

No `project-context.md` file was found in this repository.

### Project Structure Notes

- Current trip authorization is owner-only through repository filters like `where: { id: tripId, userId }` in `tripRepo.ts`.
- `TripTimeline.tsx` is the current owner-facing hub for trip actions and is the right place to surface sharing controls.
- Auth/session infrastructure already exists in `src/lib/auth/*`, including bcrypt hashing, JWT session cookies, and password-reset utilities.
- There is already a development/test email outbox in `src/lib/notifications/email.ts`; do not build a second notification abstraction for this story.
- The current schema only has `UserRole = OWNER | VIEWER`; contributor support should be modeled at trip-membership scope, not by mutating that global enum alone.

### References

- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/epics.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/architecture.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/ux-design-specification.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/prd.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/4-6-show-open-costs.md`
- `/Users/tommy/Development/TravelPlan/travelplan/package.json`
- `/Users/tommy/Development/TravelPlan/travelplan/prisma/schema.prisma`
- `/Users/tommy/Development/TravelPlan/travelplan/src/lib/repositories/tripRepo.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/app/api/trips/[id]/route.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/app/api/auth/register/route.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/app/api/auth/login/route.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/lib/auth/passwordReset.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/lib/notifications/email.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/lib/validation/authSchemas.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/components/features/trips/TripTimeline.tsx`
- [Next.js Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers)
- [React Documentation](https://react.dev/)
- [Prisma ORM Docs](https://www.prisma.io/docs)
- [Material UI Docs](https://mui.com/material-ui/getting-started/)
- [Zod Docs](https://zod.dev/)

## Change Log

- 2026-03-08: Story created with collaboration data-model guidance, owner-only invite flow scope, and implementation guardrails for Epic 5 kickoff.
- 2026-03-08: Implemented trip-scoped collaborator provisioning, owner-only sharing UI, and regression coverage for invite provisioning.
- 2026-03-08: Code review fixes aligned collaborator IDs, enabled collaborator trip reads, and blocked existing-account password overwrites pending a safer invite flow.
- 2026-03-08: Story scope accepted as new-account-only temp-password provisioning; existing-account collaborator onboarding deferred to a safer future flow.

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Story creation workflow executed from `_bmad/bmm/workflows/4-implementation/create-story`
- Added Prisma migration `20260308225500_add_trip_memberships` and regenerated the Prisma client for `TripMember` plus `mustChangePassword`.
- Added collaborator repository helpers, invite validation, `/api/trips/[id]/members` route coverage, and login regression assertions for password-change state.
- Ran `npm test` with 378 passing tests and `npm run lint` with the existing warning baseline only.
- Hardened collaborator provisioning to reject established existing-account emails instead of overwriting their passwords, aligned collaborator IDs to membership IDs, and widened trip-detail reads to collaborator memberships.
- Ran `npm test` with 379 passing tests after the code-review fixes.

### Completion Notes List

- Created the Epic 5 kickoff story from the next backlog item in `sprint-status.yaml`.
- Marked the story and sprint tracker as `ready-for-dev`.
- Scoped the implementation around a new trip-scoped membership model instead of reusing the existing global `User.role`.
- Captured concrete backend, UI, validation, and test entry points from the current codebase.
- Referenced official framework/library docs for the current stack alongside local package versions.
- Added `TripMember` plus `TripMemberRole`, persisted `User.mustChangePassword`, and shipped migration-backed Prisma client updates.
- Implemented owner-only collaborator provisioning that normalizes email, hashes temporary passwords, blocks duplicate memberships, and returns collaborator list data.
- Added `TripShareDialog` to `TripTimeline` with EN/DE copy and live collaborator list refresh after successful invites.
- Verified collaborator provisioning, duplicate handling, owner-only enforcement, collaborator trip-detail reads, UI flow, and login password-change state through targeted and full-suite tests.
- Code review follow-up: collaborator creation now returns membership IDs consistently across create/list responses.
- Code review follow-up: collaborator memberships can read trip detail data through the main trip route.
- Code review follow-up: existing-account invites are blocked to avoid cross-account password takeover; this reduced-safe scope is accepted for Story 5.1 and established-account onboarding is deferred.

### File List

- _bmad-output/implementation-artifacts/5-1-invite-viewer-or-contributor-by-email-with-temp-password.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- travelplan/prisma/migrations/20260308225500_add_trip_memberships/migration.sql
- travelplan/prisma/schema.prisma
- travelplan/src/app/api/auth/login/route.ts
- travelplan/src/app/api/trips/[id]/members/route.ts
- travelplan/src/components/features/trips/TripShareDialog.tsx
- travelplan/src/components/features/trips/TripTimeline.tsx
- travelplan/src/generated/prisma/browser.ts
- travelplan/src/generated/prisma/client.ts
- travelplan/src/generated/prisma/commonInputTypes.ts
- travelplan/src/generated/prisma/enums.ts
- travelplan/src/generated/prisma/internal/class.ts
- travelplan/src/generated/prisma/internal/prismaNamespace.ts
- travelplan/src/generated/prisma/internal/prismaNamespaceBrowser.ts
- travelplan/src/generated/prisma/models.ts
- travelplan/src/generated/prisma/models/PasswordResetToken.ts
- travelplan/src/generated/prisma/models/Trip.ts
- travelplan/src/generated/prisma/models/TripMember.ts
- travelplan/src/generated/prisma/models/User.ts
- travelplan/src/i18n/de.ts
- travelplan/src/i18n/en.ts
- travelplan/src/lib/db/prisma.ts
- travelplan/src/lib/repositories/tripRepo.ts
- travelplan/src/lib/validation/authSchemas.ts
- travelplan/src/lib/validation/tripMemberSchemas.ts
- travelplan/test/loginRoute.test.ts
- travelplan/test/tripCollaborationRepo.test.ts
- travelplan/test/tripDetailRoute.test.ts
- travelplan/test/tripMembersRoute.test.ts
- travelplan/test/tripTimelineSharing.test.tsx
