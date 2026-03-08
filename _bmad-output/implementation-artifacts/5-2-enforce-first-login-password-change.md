# Story 5.2: Enforce First-Login Password Change

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a newly invited user,
I want to change my temporary password on first login,
so that my account is secure.

## Acceptance Criteria

1. Given an invited collaborator account has `mustChangePassword = true`, when the user signs in with the temporary password, then login succeeds, the session is established, and the client is directed to the mandatory password-change flow instead of the trips app.
2. Given a signed-in user still has `mustChangePassword = true`, when they try to open protected trip pages or trip APIs, then access is blocked until the password-change step is completed.
3. Given the invited user submits a valid new password in the mandatory password-change flow, when the change is saved, then the password hash is updated, `mustChangePassword` is set to `false`, and the user can continue into the app with a fresh valid session.
4. Given the invited user submits an invalid new password, when they attempt to save it, then they see validation feedback and the password-change requirement remains active.
5. Given a user has already completed the first-login password change, when they sign in again, then they enter the normal app flow with no forced-password-change interruption.
6. Given a regular owner or collaborator account does not require a first-login password change, when they use the app, then existing auth, trip access, and password-reset flows continue to work without regression.

## Tasks / Subtasks

- [x] Task 1: Carry first-login-password-change state through the session layer. (AC: 1, 2, 5)
  - [x] Extend `travelplan/src/lib/auth/jwt.ts` so the session payload can include `mustChangePassword` alongside `sub` and `role`.
  - [x] Update `travelplan/src/app/api/auth/login/route.ts` to issue the session JWT with the persisted `mustChangePassword` value already read from Prisma.
  - [x] Keep the login response body flag for the client, but treat the JWT/session claim as the server-side source used for route guarding.
- [x] Task 2: Add a dedicated authenticated first-login password-change flow. (AC: 1, 3, 4)
  - [x] Add a new authenticated endpoint such as `travelplan/src/app/api/auth/first-login-password/route.ts` that reads the current session, validates the new password with the existing `passwordSchema`, updates `User.passwordHash`, and clears `mustChangePassword`.
  - [x] Reissue the session cookie from that endpoint with `mustChangePassword: false` after the change succeeds so the user is not stuck in the forced-flow loop.
  - [x] Reuse existing bcrypt, CSRF, `{ data, error }`, and rate-limit patterns already used by login and password-reset routes.
- [x] Task 3: Build the forced-change UI by reusing current auth-page patterns. (AC: 1, 3, 4, 5)
  - [x] Add a dedicated page such as `travelplan/src/app/(routes)/auth/first-login-password/page.tsx` instead of overloading the token-based reset screen with mixed concerns.
  - [x] Reuse the current `forgot-password` / `reset-password` page structure, MUI form patterns, CSRF fetching, i18n provider usage, and inline validation style.
  - [x] On successful login from `travelplan/src/app/(routes)/auth/login/page.tsx`, route users with `mustChangePassword` to the forced-change page and route everyone else to `/`.
- [x] Task 4: Enforce the gate across the protected app, not just in the login client. (AC: 2, 5, 6)
  - [x] Update `travelplan/src/middleware.ts` to redirect authenticated users whose session claim has `mustChangePassword = true` away from `/trips` routes and into the forced-change page.
  - [x] Ensure the forced-change page itself remains reachable while the rest of the trip area stays blocked.
  - [x] Add server-side protection in protected API handlers used by the trip app so a flagged user cannot bypass the UI by calling `/api/trips/*` directly with a valid session cookie.
- [x] Task 5: Preserve and integrate existing auth/password-reset behavior cleanly. (AC: 3, 5, 6)
  - [x] Share password validation and password-hashing helpers with `travelplan/src/app/api/auth/password-reset/confirm/route.ts` instead of duplicating password update logic.
  - [x] Keep the token-based reset flow for forgotten passwords intact; this story is for authenticated first-login enforcement, not a replacement for password reset.
  - [x] Decide explicitly whether password-reset confirmation should also clear `mustChangePassword`; document and test that behavior so the auth model is unambiguous.
- [x] Task 6: Add regression coverage for the forced-flow end to end. (AC: 1, 2, 3, 4, 5, 6)
  - [x] Add login page tests proving invited users are redirected to the forced-change page while regular users still land in the normal app flow.
  - [x] Add route tests for the new authenticated password-change endpoint covering success, validation failure, missing session, CSRF failure, and reissued session state.
  - [x] Add middleware tests proving flagged sessions are redirected away from `/trips` and non-flagged sessions are not.
  - [x] Add trip API tests proving flagged sessions are blocked from protected trip endpoints until the password-change step is completed.

## Dev Notes

### Developer Context

Story 5.1 added collaborator provisioning and the persisted `User.mustChangePassword` flag, but the current app still treats a successful login as a normal authenticated session. The login route already returns `mustChangePassword`, yet neither the middleware nor the protected trip routes enforce it. Story 5.2 therefore needs to turn that stored flag into a real gate across login, routing, and protected APIs without breaking the existing owner and collaborator access model introduced in 5.1.

The current repo also deliberately blocks inviting already-existing accounts through the temp-password flow. That means this story should focus on newly provisioned collaborator accounts created by Story 5.1 and should not expand scope into the unresolved established-account invitation design.

### Technical Requirements

- Treat `mustChangePassword` as authoritative persisted state on `User`, not as a client-only condition.
- Enforce the gate on the server as well as the client. A redirect from the login page alone is insufficient because protected APIs and direct navigation to `/trips` would still be reachable.
- Prefer a dedicated authenticated first-login password-change endpoint over reusing the token-based reset-confirm route directly. The first-login flow already has an authenticated session and does not need a reset token.
- Reissue or refresh the session after clearing `mustChangePassword`; otherwise middleware and route handlers may continue to read stale forced-change state.
- Keep CSRF validation on the new password-change endpoint and preserve the existing `{ data, error }` response envelope.
- Keep password rules aligned with `passwordSchema` in `travelplan/src/lib/validation/authSchemas.ts`.
- Keep bcrypt-based hashing through the existing helper in `travelplan/src/lib/auth/bcrypt.ts`.
- Preserve the current `401` behavior for missing auth and add a clear blocked-state response for authenticated users who still must change their password, such as `403` with a dedicated error code like `password_change_required`.
- Do not weaken trip authorization boundaries while adding this gate. Owner, viewer, and contributor access decisions remain separate from first-login enforcement.

### Architecture Compliance

- Protected browser routing is currently handled in `travelplan/src/middleware.ts`; extend that logic rather than introducing a parallel auth-guard system.
- Session verification currently happens through `travelplan/src/lib/auth/jwt.ts`; that is the right place to centralize any new JWT claim typing for `mustChangePassword`.
- Protected trip APIs currently read the session cookie and call `verifySessionJwt` directly in route handlers such as `travelplan/src/app/api/trips/[id]/route.ts` and `travelplan/src/app/api/trips/[id]/members/route.ts`. Reuse that established pattern or factor it into a shared helper instead of inventing ad hoc checks per page.
- Keep auth routes under `travelplan/src/app/api/auth/**/route.ts` and auth pages under `travelplan/src/app/(routes)/auth/**/page.tsx`.
- Preserve naming conventions: DB `snake_case`, API JSON `camelCase`, code symbols `camelCase` / `PascalCase`.

### Library / Framework Requirements

- Stay on the versions already pinned in `travelplan/package.json`: `next@16.1.6`, `react@19.2.3`, `@mui/material@7.3.8`, `prisma@7.3.0`, `@prisma/client@7.3.0`, `react-hook-form@7.71.1`, `zod@4.1.11`, `bcrypt@6.0.0`, and `jose@6.1.0`.
- Keep the implementation in Next.js App Router route handlers and pages, matching the existing login, logout, forgot-password, and reset-password patterns.
- Reuse React Hook Form for the new forced-change page, matching the current auth pages’ validation and submit-flow structure.
- Keep Material UI page structure and alert/field/button patterns consistent with the existing auth screens so this feels like part of the same auth system, not a one-off screen.

### File Structure Requirements

- Session/JWT typing: `travelplan/src/lib/auth/jwt.ts`
- Session cookie handling: `travelplan/src/lib/auth/session.ts`
- Login route: `travelplan/src/app/api/auth/login/route.ts`
- New forced-change route: `travelplan/src/app/api/auth/first-login-password/route.ts`
- Existing token reset route to align with or reuse logic from: `travelplan/src/app/api/auth/password-reset/confirm/route.ts`
- Auth validation schemas: `travelplan/src/lib/validation/authSchemas.ts`
- Login page redirect behavior: `travelplan/src/app/(routes)/auth/login/page.tsx`
- New forced-change page: `travelplan/src/app/(routes)/auth/first-login-password/page.tsx`
- Middleware gate: `travelplan/src/middleware.ts`
- Protected trip APIs to gate: `travelplan/src/app/api/trips/[id]/route.ts` and related `/api/trips/*` handlers that should not be usable before the password change is complete
- Optional shared session helper if extracted: `travelplan/src/lib/auth/sessionGuard.ts` or similar under `src/lib/auth/`

### Testing Requirements

- Route test: successful login for a user with `mustChangePassword = true` still returns `200`, sets a session cookie, and includes the flag in both the response and the session behavior.
- Page/component test: login UI routes flagged users to the forced-change page and routes regular users to the normal app destination.
- Middleware test: a session carrying `mustChangePassword = true` is redirected from `/trips` routes to the forced-change page.
- Middleware test: a normal authenticated session still reaches `/trips` unchanged.
- New route test: authenticated forced password change succeeds, updates the stored password hash, clears `mustChangePassword`, and refreshes the session state.
- New route test: missing session returns `401`.
- New route test: invalid CSRF returns `403`.
- New route test: invalid new password returns `400` with validation details.
- Trip API test: a flagged session is blocked from protected trip data access until the first-login password change is completed.
- Regression test: the existing token-based forgot/reset-password flow still works after the first-login flow is introduced.

### Previous Story Intelligence

- Story 5.1 already created the `mustChangePassword` persistence hook and proved it through login-route and collaborator-route tests, so Story 5.2 should build directly on that state instead of adding another onboarding flag.
- Story 5.1 intentionally rejected existing-account invites with `trip_member_existing_account`; do not expand 5.2 into solving that separate invitation design gap.
- Trip detail reads now allow collaborator memberships through the main repository and trip route. First-login enforcement must sit above that access model so invited collaborators cannot reach shared trip data before changing the temporary password.

### Git Intelligence Summary

- Recent commits are `Story 5.1 invite viewer or contributor`, `Story 4.6 Show Open Costs`, and `Story 4.5 Payment Schedule`.
- The project has been evolving by extending existing route handlers, repository helpers, and MUI pages rather than introducing alternate stacks or duplicate surfaces.
- Follow that same pattern here: extend the existing auth/session system and the protected trip entry points cleanly instead of bolting on a disconnected onboarding flow.

### Latest Tech Information

- Local package versions in `travelplan/package.json` should be treated as the implementation target for this story; do not upgrade framework versions as part of first-login enforcement.
- Keep Next.js auth handling in App Router pages, middleware, and route handlers consistent with the official platform guidance already used in this app.
- Keep session token work in `jose`, request validation in Zod, and form handling in React Hook Form rather than mixing in new auth/form libraries for a small incremental story.
- Official references to keep aligned with:
  - [Next.js Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers)
  - [Next.js Middleware](https://nextjs.org/docs/app/building-your-application/routing/middleware)
  - [Prisma ORM Docs](https://www.prisma.io/docs)
  - [Zod Docs](https://zod.dev/)
  - [React Hook Form Docs](https://react-hook-form.com/docs)

### Project Context Reference

No `project-context.md` file was found in this repository.

### Project Structure Notes

- `travelplan/src/middleware.ts` currently only checks whether the session JWT is valid and redirects signed-out users away from `/trips`; it does not yet understand forced password changes.
- `travelplan/src/lib/auth/jwt.ts` currently signs only `{ sub, role }`; Story 5.2 must either extend that payload or introduce an equivalent shared guard that can cheaply enforce `mustChangePassword`.
- `travelplan/src/app/api/auth/login/route.ts` already reads `mustChangePassword` from Prisma and returns it in the response body, so the missing piece is enforcement rather than persistence.
- `travelplan/src/app/(routes)/auth/reset-password/page.tsx` is token-centric and expects a reset token field; that screen should be used as a stylistic/reference pattern, not copied verbatim for first-login enforcement.
- `travelplan/src/app/api/auth/password-reset/confirm/route.ts` already contains password-update mechanics that should be factored or mirrored carefully to avoid divergent password-change behavior.
- Protected trip routes and APIs currently rely on session presence plus authorization, for example `travelplan/src/app/api/trips/[id]/route.ts` and `travelplan/src/app/api/trips/[id]/members/route.ts`. Those are key bypass points that must be covered by this story.
- `travelplan/src/lib/navigation/authMenu.ts` only distinguishes authenticated vs signed-out state. If the forced-change page needs different top-level navigation behavior, implement that intentionally rather than letting flagged users appear fully “inside” the app.

### References

- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/epics.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/architecture.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/prd.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/ux-design-specification.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/5-1-invite-viewer-or-contributor-by-email-with-temp-password.md`
- `/Users/tommy/Development/TravelPlan/travelplan/package.json`
- `/Users/tommy/Development/TravelPlan/travelplan/prisma/schema.prisma`
- `/Users/tommy/Development/TravelPlan/travelplan/src/lib/auth/jwt.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/lib/auth/session.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/lib/validation/authSchemas.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/lib/validation/tripMemberSchemas.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/lib/repositories/tripRepo.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/app/api/auth/login/route.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/app/api/auth/password-reset/confirm/route.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/app/api/trips/[id]/route.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/app/api/trips/[id]/members/route.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/app/(routes)/auth/login/page.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/src/app/(routes)/auth/forgot-password/page.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/src/app/(routes)/auth/reset-password/page.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/src/app/(routes)/trips/page.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/src/app/(routes)/trips/[id]/page.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/src/components/AppHeader.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/src/components/HeaderMenu.tsx`
- `/Users/tommy/Development/TravelPlan/travelplan/src/lib/navigation/authMenu.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/src/middleware.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/test/loginRoute.test.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/test/passwordResetConfirmRoute.test.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/test/tripMembersRoute.test.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/test/tripDetailRoute.test.ts`
- `/Users/tommy/Development/TravelPlan/travelplan/test/middleware.test.ts`
- [Next.js Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers)
- [Next.js Middleware](https://nextjs.org/docs/app/building-your-application/routing/middleware)
- [Prisma ORM Docs](https://www.prisma.io/docs)
- [Zod Docs](https://zod.dev/)
- [React Hook Form Docs](https://react-hook-form.com/docs)

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Create-story workflow selected the next backlog item `5-2-enforce-first-login-password-change` from `_bmad-output/implementation-artifacts/sprint-status.yaml`.
- Manual validation was used because `_bmad/core/tasks/validate-workflow.xml` is referenced by the BMAD workflow but is not present in this repository.
- Ran targeted regression cycles with `npm test -- loginRoute.test.ts tripDetailRoute.test.ts firstLoginPasswordRoute.test.ts middleware.test.ts passwordResetConfirmRoute.test.ts loginPage.test.tsx`.
- Ran review-fix regressions with `npm test -- firstLoginPasswordRoute.test.ts tripExportRoute.test.ts bucketListRoute.test.ts tripDetailRoute.test.ts middleware.test.ts`.
- Ran full repository validation with `npm test` after review fixes.

### Implementation Plan

- Extend the JWT/session contract with `mustChangePassword` and centralize request-session parsing in a shared auth guard.
- Add a dedicated authenticated first-login password-change route and page, then redirect flagged users there immediately after login.
- Enforce the flag in middleware for `/`, `/trips`, `/auth/first-login-password`, and `/api/trips/*`, with handler-level trip detail protection for direct route coverage.
- Reuse one password-update helper for both first-login password changes and token-based reset confirmation, explicitly clearing `mustChangePassword` in both cases.
- Prove the behavior with login page, middleware, trip API, first-login route, and password-reset regression tests.

### Completion Notes List

- Added `mustChangePassword` to the session JWT contract, issued it from login, and used that claim as the authoritative server-side gate.
- Implemented `/api/auth/first-login-password` plus a dedicated `/auth/first-login-password` page that validates, hashes, saves, and reissues the session with `mustChangePassword: false`.
- Enforced the forced-change flow in middleware across `/`, `/trips`, `/auth/first-login-password`, and `/api/trips/*`, and mirrored the rule in the trip detail route handler.
- Shared password-update mechanics with the token reset-confirm route and decided that completing a reset also clears `mustChangePassword`, because the user has established a new secret.
- Added regression coverage for login routing, middleware blocking, trip API blocking, first-login route success/failure paths, and reset-confirm clearing behavior.
- Review fixes closed the remaining gaps by rejecting reuse of the temporary password and enforcing `mustChangePassword` in the remaining protected `/api/trips/*` handlers.
- Added review regression coverage for same-password rejection and forced-change blocking on export and bucket-list endpoints.
- Full validation completed: `npm test` passed with 78/78 files and 394/394 tests.

### File List

- _bmad-output/implementation-artifacts/sprint-status.yaml
- _bmad-output/implementation-artifacts/5-2-enforce-first-login-password-change.md
- travelplan/src/lib/auth/jwt.ts
- travelplan/src/lib/auth/sessionGuard.ts
- travelplan/src/lib/auth/passwordUpdate.ts
- travelplan/src/lib/validation/authSchemas.ts
- travelplan/src/app/api/auth/login/route.ts
- travelplan/src/app/api/auth/password-reset/confirm/route.ts
- travelplan/src/app/api/auth/first-login-password/route.ts
- travelplan/src/app/(routes)/auth/login/page.tsx
- travelplan/src/app/(routes)/auth/first-login-password/page.tsx
- travelplan/src/app/api/trips/route.ts
- travelplan/src/app/api/trips/import/route.ts
- travelplan/src/app/api/trips/[id]/export/route.ts
- travelplan/src/app/api/trips/[id]/route.ts
- travelplan/src/app/api/trips/[id]/members/route.ts
- travelplan/src/app/api/trips/[id]/day-plan-items/route.ts
- travelplan/src/app/api/trips/[id]/day-plan-items/images/route.ts
- travelplan/src/app/api/trips/[id]/bucket-list-items/route.ts
- travelplan/src/app/api/trips/[id]/accommodations/route.ts
- travelplan/src/app/api/trips/[id]/accommodations/copy/route.ts
- travelplan/src/app/api/trips/[id]/accommodations/images/route.ts
- travelplan/src/app/api/trips/[id]/travel-segments/route.ts
- travelplan/src/app/api/trips/[id]/hero-image/route.ts
- travelplan/src/app/api/trips/[id]/days/[dayId]/image/route.ts
- travelplan/src/app/api/trips/[id]/days/[dayId]/route/route.ts
- travelplan/src/i18n/en.ts
- travelplan/src/i18n/de.ts
- travelplan/src/middleware.ts
- travelplan/test/tripExportRoute.test.ts
- travelplan/test/bucketListRoute.test.ts
- travelplan/test/loginRoute.test.ts
- travelplan/test/tripDetailRoute.test.ts
- travelplan/test/firstLoginPasswordRoute.test.ts
- travelplan/test/passwordResetConfirmRoute.test.ts
- travelplan/test/middleware.test.ts
- travelplan/test/loginPage.test.tsx

## Senior Developer Review (AI)

- Review date: 2026-03-08
- Outcome: **Approved after fixes**
- High/Medium findings fixed:
  - The first-login password-change route now rejects reusing the temporary password.
  - Remaining protected `/api/trips/*` handlers now enforce `mustChangePassword` through the shared session guard instead of trusting any valid JWT.
  - Regression coverage now proves forced-change blocking beyond the trip-detail route.
- Verification:
  - `npm test -- firstLoginPasswordRoute.test.ts tripExportRoute.test.ts bucketListRoute.test.ts tripDetailRoute.test.ts middleware.test.ts` passed (`43/43`).
  - `npm test` passed (`394/394`).

## Change Log

- 2026-03-08: Implemented Story 5.2 first-login password enforcement across session JWTs, middleware, authenticated password change, trip API blocking, and regression coverage.
- 2026-03-08: Completed code-review fixes for Story 5.2 by blocking temporary-password reuse, enforcing the gate in remaining trip handlers, adding regression tests, and moving the story to done.
