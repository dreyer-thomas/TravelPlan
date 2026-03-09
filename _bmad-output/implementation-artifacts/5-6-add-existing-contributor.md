# Story 5.6: Add Existing Contributor to Another Trip

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip owner,
I want to add an existing user as a contributor on another trip,
so that the same person can collaborate across multiple trips without duplicate-account errors.

## Acceptance Criteria

1. Given I am the trip owner and the entered email already belongs to an existing account that is not yet linked to the current trip, when I add that person as a contributor, then the system creates a new `TripMember` for the current trip and reuses the existing user account instead of returning `trip_member_existing_account`.
2. Given the entered email already belongs to an existing account that is already linked to the current trip, when I try to add that person again, then the request is rejected with the existing trip-specific duplicate-membership behavior and no second membership is created.
3. Given the entered email does not belong to an existing account, when I add that person through the share flow, then the current temp-password provisioning behavior from Story 5.1 still works unchanged.
4. Given an existing account is reused for a new trip membership, when the membership is created, then the existing password hash, `mustChangePassword` state, preferred language, and account identity remain unchanged.
5. Given an existing account is added to another trip, when that collaborator signs in with their existing credentials, then they can open both trips according to their trip-specific access roles.
6. Given I use the share dialog with an email that already belongs to an account, when the system can reuse that account, then the UI does not present a misleading “person already exists” blocker and instead communicates successful linking or a clear trip-specific duplicate message.
7. Given I am not the trip owner, when I attempt to add an existing account to the trip, then the request is rejected with the same owner-only behavior already used by the members route.

## Tasks / Subtasks

- [ ] Task 1: Reuse existing user accounts when creating trip memberships instead of treating them as invite conflicts. (AC: 1, 2, 4, 5)
  - [ ] Update `travelplan/src/lib/repositories/tripRepo.ts` so `createTripCollaboratorForOwner` distinguishes between `existing account, not yet linked` and `existing account, already linked`.
  - [ ] For an existing account that is not yet a member of the current trip, create a `TripMember` row with the requested role and return the refreshed collaborator list.
  - [ ] Preserve the current owner-email protection and current duplicate-membership protection.
- [ ] Task 2: Adjust the members API contract so existing-account reuse is a supported success path. (AC: 1, 2, 7)
  - [ ] Update `travelplan/src/app/api/trips/[id]/members/route.ts` so the owner can add an existing account to a new trip without receiving `trip_member_existing_account`.
  - [ ] Preserve session enforcement, CSRF validation, and the `{ data, error }` response envelope.
  - [ ] Keep `404` inaccessible-trip behavior for non-owners and keep duplicate-on-same-trip conflicts explicit.
- [ ] Task 3: Refine collaborator validation and flow rules for “new account” versus “existing account”. (AC: 1, 3, 4, 6)
  - [ ] Keep the temp-password requirement for brand-new accounts created through the owner invite flow.
  - [ ] Introduce a safe path for existing accounts where a temporary password is optional or ignored rather than required for success.
  - [ ] Ensure existing-account reuse never overwrites password hashes, password-change flags, or other user-level fields.
- [ ] Task 4: Update the share dialog so owners can successfully add existing accounts to more than one trip. (AC: 1, 2, 3, 6)
  - [ ] Update `travelplan/src/components/features/trips/TripShareDialog.tsx` so the form copy and error handling support both “create new collaborator account” and “link existing account to this trip”.
  - [ ] Remove the dead-end message that currently tells the owner to “use that account directly” when the actual intent is to attach that account to the current trip.
  - [ ] Keep the collaborator list refresh and success feedback aligned with the current dialog pattern and EN/DE i18n setup.
- [ ] Task 5: Preserve trip-scoped access rules and avoid scope creep into invitation redesign. (AC: 4, 5, 7)
  - [ ] Keep collaborator access modeled through `TripMember`; do not add a second membership model or a global contributor role.
  - [ ] Do not add email invitations, account search pages, password resets, role-editing, or collaborator removal in this story.
  - [ ] Keep cross-trip reuse limited to linking an existing `User` into another trip with a new trip-specific role.
- [ ] Task 6: Add regression coverage for existing-account reuse and same-trip duplicates. (AC: 1, 2, 3, 4, 5, 6, 7)
  - [ ] Add repository tests proving an existing account can be linked to a second trip without password or profile mutation.
  - [ ] Add route tests proving the owner can add an existing account to another trip, receives collaborator data, and the linked user can access the trip afterward.
  - [ ] Add route tests proving the same account still receives a conflict when already linked to the current trip and that non-owners remain blocked.
  - [ ] Add UI tests proving the share dialog surfaces the correct success/duplicate behavior for existing accounts and still supports the new-account temp-password path.

## Dev Notes

### Developer Context

Story 5.1 intentionally scoped the first collaboration flow to “new account plus temporary password” and explicitly rejected established existing-account emails to avoid overwriting credentials. The current repo and route still enforce that decision by returning `existing_account` whenever the email already exists, even if that user is not linked to the target trip yet.

That decision is now blocking the real product behavior: the same collaborator must be reusable across trips. The existing data model already supports this because `TripMember` is trip-scoped and only unique per `(tripId, userId)`. This story should therefore extend the share flow to reuse an existing `User` record while creating a new trip membership, not redesign the collaboration model.

### Technical Requirements

- Reuse the existing `User` record when the email already exists and is not yet linked to the current trip.
- Create only a new `TripMember` row for the second trip; do not create duplicate user accounts.
- Preserve existing user-level fields such as `passwordHash`, `mustChangePassword`, `preferredLanguage`, and `role`.
- Keep duplicate prevention scoped to the current trip via the existing unique `(tripId, userId)` constraint.
- Keep owner-only control for adding collaborators through the members route.
- Preserve the current temp-password onboarding path for new accounts created through Story 5.1.
- Do not require a global account search UI; typing the email into the existing share flow should be sufficient for this story.

### Architecture Compliance

- Keep trip membership creation in `travelplan/src/lib/repositories/tripRepo.ts`; that is already the central collaboration seam.
- Keep request handling in `travelplan/src/app/api/trips/[id]/members/route.ts`.
- Preserve `TripMember` as the trip-scoped authorization model and avoid mutating `User.role` to represent per-trip access.
- Keep the `{ data, error }` API envelope and current `404` inaccessible-trip behavior.
- Preserve existing DB and API naming conventions: DB `snake_case`, API JSON `camelCase`.

### Library / Framework Requirements

- Stay on the currently pinned stack in `travelplan/package.json`: `next@16.1.6`, `react@19.2.3`, `@mui/material@7.3.8`, `prisma@7.3.0`, `@prisma/client@7.3.0`, `react-hook-form@7.71.1`, `zod@4.1.11`, and `bcrypt@6.0.0`.
- Keep backend behavior in Next.js App Router route handlers and Prisma repository helpers.
- Keep form and dialog behavior aligned with the current Material UI + React Hook Form implementation in `TripShareDialog.tsx`.
- Keep validation in Zod; do not add a second validation path for this story.

### File Structure Requirements

- Collaboration repository: `travelplan/src/lib/repositories/tripRepo.ts`
- Members route: `travelplan/src/app/api/trips/[id]/members/route.ts`
- Collaborator validation: `travelplan/src/lib/validation/tripMemberSchemas.ts`
- Share dialog UI: `travelplan/src/components/features/trips/TripShareDialog.tsx`
- i18n dictionaries: `travelplan/src/i18n/en.ts`, `travelplan/src/i18n/de.ts`
- Membership model and unique constraint reference: `travelplan/prisma/schema.prisma`
- Tests: `travelplan/test/tripCollaborationRepo.test.ts`, `travelplan/test/tripMembersRoute.test.ts`, `travelplan/test/tripTimelineSharing.test.tsx`

### Testing Requirements

- Repository test: existing account not yet linked to the trip is reused and receives a new `TripMember`.
- Repository test: existing account reuse does not change password hash or `mustChangePassword`.
- Route test: owner can add an existing account to a second trip and receives collaborator list data.
- Route test: adding the same account twice to the same trip still returns the duplicate-membership conflict.
- Route test: non-owner users still cannot manage trip members.
- UI test: share dialog no longer shows the existing-account blocker for reusable accounts and instead reports success.
- UI test: new-account provisioning still requires temp-password input and continues to work.

### Previous Story Intelligence

- Story 5.1 created the correct trip-scoped membership model (`TripMember`) but intentionally deferred established-account onboarding.
- Story 5.2 already handles password changes for provisioned new accounts, which should remain untouched when reusing existing accounts.
- Story 5.4 preserved member management as owner-only, so this story should extend only the owner sharing flow rather than widening collaborator management permissions.

### Git Intelligence Summary

- The current collaboration implementation is already centralized in `tripRepo.ts`, `/api/trips/[id]/members`, and `TripShareDialog.tsx`, which means this story should extend the existing path instead of creating a second invite/link flow.
- Current tests explicitly lock in the undesired `existing_account` conflict, so those tests need to be updated to the new business rule and complemented with a same-trip duplicate regression.

### Latest Tech Information

- Local package versions in `travelplan/package.json` remain the implementation target for this story; do not bundle framework upgrades into the collaborator-reuse fix.
- Next.js App Router route handlers remain the correct server surface for the members endpoint: [Next.js Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers)
- Prisma’s relation and CRUD model is the right place to create a second `TripMember` for the same `User` across different trips while preserving the existing account row: [Prisma CRUD](https://www.prisma.io/docs/orm/prisma-client/queries/crud)
- Material UI dialog patterns remain suitable for the owner share flow without introducing a separate management screen: [MUI Dialog](https://mui.com/material-ui/react-dialog/)
- React Hook Form remains the current form-state layer in `TripShareDialog.tsx`: [React Hook Form `useForm`](https://react-hook-form.com/docs/useform)

### Project Context Reference

No `project-context.md` file was found in this repository.

### Project Structure Notes

- `createTripCollaboratorForOwner` currently returns `conflict/existing_account` for any pre-existing email after checking only for duplicate membership on the same trip. That is the core behavior this story needs to change.
- `TripShareDialog.tsx` currently maps `trip_member_existing_account` to a hard blocker message even though the data model already permits that user to be linked to another trip.
- `trip_members` already enforces uniqueness only on `(trip_id, user_id)`, which is exactly the constraint needed for “same user on many trips, once per trip”.
- The fix is primarily a repository/API/UI flow change, not a schema change.

### References

- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/epics.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/architecture.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/prd.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/5-1-invite-viewer-or-contributor-by-email-with-temp-password.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/5-4-contributor-full-edit-permissions.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/5-5-edit-own-comments.md`
- `/Users/tommy/Development/TravelPlan/travelplan/package.json`
- `/Users/tommy/Development/TravelPlan/travelplan/prisma/schema.prisma`
- `/Users/tommy/Development/TravelPlan/travelplan/src/lib/repositories/tripRepo.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/app/api/trips/[id]/members/route.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/lib/validation/tripMemberSchemas.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/components/features/trips/TripShareDialog.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/test/tripCollaborationRepo.test.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/test/tripMembersRoute.test.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/test/tripTimelineSharing.test.tsx`
- [Next.js Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers)
- [Prisma CRUD](https://www.prisma.io/docs/orm/prisma-client/queries/crud)
- [MUI Dialog](https://mui.com/material-ui/react-dialog/)
- [React Hook Form `useForm`](https://react-hook-form.com/docs/useform)

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Story key `5-6-add-existing-contributor` was provided directly by the user rather than discovered from `sprint-status.yaml`.
- The BMAD validation task runner `_bmad/core/tasks/validate-workflow.xml` referenced by the workflow is not present in this repository, so checklist validation could not be run through the expected task file.
- Story context was grounded in the existing Epic 5 planning artifacts and the live collaboration implementation in `tripRepo.ts`, `/api/trips/[id]/members`, `TripShareDialog.tsx`, and associated tests.

### Completion Notes List

- Created Story 5.6 as a follow-on to Story 5.1’s intentionally deferred existing-account onboarding gap.
- Framed the change as a trip-membership reuse fix, not a schema redesign.
- Preserved the current temp-password invite path for brand-new accounts while adding a success path for existing accounts on new trips.
- Kept duplicate prevention scoped to same-trip membership and preserved owner-only member management.

### File List

- _bmad-output/implementation-artifacts/5-6-add-existing-contributor.md
