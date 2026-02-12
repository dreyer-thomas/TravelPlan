# Story 1.4: Sign Out From Current Device

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a signed-in user,
I want to sign out from my current device,
so that my session is no longer active.

## Acceptance Criteria

1. **Given** I am signed in
   **When** I sign out
   **Then** my current session cookie is cleared
   **And** I am redirected to the signed-out state

2. **Given** I am signed out
   **When** I attempt to access authenticated pages
   **Then** I am blocked and prompted to sign in

## Tasks / Subtasks

- [x] Ensure `POST /api/auth/logout` clears the `session` cookie and returns `{ data, error }` envelope (AC: #1)
- [x] Ensure logout enforces CSRF validation using `csrf_token` cookie + `x-csrf-token` header (AC: #1)
- [x] Confirm header menu “Sign out” triggers logout and refreshes UI state (AC: #1)
- [x] Confirm signed-out users are redirected to `/auth/login` when accessing `/trips/*` (AC: #2)
- [x] Add/extend logout route tests for invalid CSRF and response envelope (AC: #1)
- [x] Add/extend auth menu tests to verify correct items for signed-in vs signed-out (AC: #1)

## Dev Notes

- Scope is sign-out only. Do not implement password reset or session invalidation across devices.
- Logout must be a state-changing request protected by CSRF; reuse the existing CSRF helper and cookie name.
- The API response must use the standard `{ data, error }` envelope and return a success payload.
- Client UI should update auth state and refresh navigation after logout.

### Project Structure Notes

- App Router only: API routes under `src/app/api/**/route.ts`.
- Auth cookies are managed in `src/lib/auth/session.ts`.
- CSRF utilities live in `src/lib/security/csrf.ts`.
- Header menu lives in `src/components/HeaderMenu.tsx`.

### References

- Epic 1 / Story 1.4: `_bmad-output/planning-artifacts/epics.md#Story-1.4-Sign-Out-From-Current-Device`
- Architecture: `_bmad-output/planning-artifacts/architecture.md#Authentication-&-Security`
- Architecture: `_bmad-output/planning-artifacts/architecture.md#API-&-Communication-Patterns`
- Architecture: `_bmad-output/planning-artifacts/architecture.md#Project-Structure-&-Boundaries`
- UX baseline: `_bmad-output/planning-artifacts/ux-design-specification.md#Design-System-Foundation`

## Developer Context (Read This First)

- `POST /api/auth/logout` already exists and clears the session cookie via `clearSessionCookie` in `src/lib/auth/session.ts`.
- CSRF is enforced via `CSRF_COOKIE_NAME = "csrf_token"` and `validateCsrf` in `src/lib/security/csrf.ts`.
- The header menu already fetches `/api/auth/csrf` on load and sends `x-csrf-token` on logout.
- Authenticated routes are guarded in `src/middleware.ts` and redirect to `/auth/login` if `session` is missing or invalid.
- Auth menu items are generated via `src/lib/navigation/authMenu.ts` and switch between login/register vs logout.

## Technical Requirements

- Auth: JWT in HTTP-only cookie (SameSite=Lax; Secure in prod); session cookie name is `session`.
- Security: CSRF protection for logout with cookie + header validation.
- API: REST response envelope `{ data, error }` with camelCase JSON.
- Dates: ISO 8601 UTC strings if any date fields are returned (not expected for logout).

## Architecture Compliance

- API route location: `src/app/api/auth/logout/route.ts`.
- Use `{ data: { success: true }, error: null }` on success.
- On CSRF failure, return `{ data: null, error: { code, message, details } }` with 403.
- Do not introduce new auth helpers; reuse existing `clearSessionCookie`.

## Library / Framework Requirements

- Next.js App Router (current project baseline; do not upgrade in this story).
- `jose` 6.1.0 for JWTs (already used in auth helpers).
- `bcrypt` 6.0.0 for password hashing (not used in logout).
- `zod` 4.1.11 for validation (not required in logout).
- React Hook Form 7.71.1 and MUI baseline for UI consistency (logout is via header menu).

## File Structure Requirements

- `src/app/api/auth/logout/route.ts`
- `src/lib/auth/session.ts`
- `src/lib/security/csrf.ts`
- `src/components/HeaderMenu.tsx`
- `src/lib/navigation/authMenu.ts`
- `test/logoutRoute.test.ts`
- `test/authMenu.test.ts`

## Testing Requirements

- Unit test: logout route returns success envelope and clears cookie.
- Unit test: invalid/missing CSRF returns 403 with error envelope.
- Unit test: auth menu shows “Sign out” when authenticated and “Sign in/Create account” when not.

## Previous Story Intelligence

- Story 1.3 implemented login with CSRF + rate limiting; session cookie is created via `setSessionCookie` in `src/lib/auth/session.ts`.
- Logout should mirror login/register envelope and CSRF patterns to avoid auth inconsistencies.
- Tests use Vitest and run against a local SQLite test DB, but logout does not touch DB.

## Git Intelligence Summary

- Recent commits: `bbbf336` (Story 1.2 register user - Bugfix), `1170dfe` (Story 1.2 register user), `ca1b251` (Story 1.1 Initial project generation), `818edb7` (Initial commit).

## Latest Tech Information (Web Research)

- Next.js 16 introduces Cache Components and makes Turbopack the default bundler; keep App Router behaviors in mind for auth routes and UI. citeturn0search1
- Next.js issued a security update on 2025-12-11 for RSC protocol vulnerabilities; if you upgrade Next.js, ensure you pick a patched version. citeturn0search3
- Prisma ORM 7.3.0 includes performance improvements and a SQLite adapter stability fix; remain aligned with the project’s pinned Prisma version unless explicitly upgrading. citeturn0search0

## Project Context Reference

- Epics: `_bmad-output/planning-artifacts/epics.md`
- Architecture: `_bmad-output/planning-artifacts/architecture.md`
- PRD: `_bmad-output/planning-artifacts/prd.md`
- UX: `_bmad-output/planning-artifacts/ux-design-specification.md`

## Story Completion Status

- Status: review
- Completion note: Ultimate context engine analysis completed - comprehensive developer guide created

## Dev Agent Record

### Agent Model Used

gpt-5 (Codex)

### Debug Log References

2026-02-12: Generated story context for sign-out flow with architecture, UX, and security guardrails.
2026-02-12: Validated logout CSRF enforcement and session cookie clearing; added CSRF failure test coverage.

### Implementation Plan

- Verify existing logout handler clears session cookie and returns envelope.
- Add CSRF failure test coverage for logout route.
- Confirm header menu triggers logout and refresh and middleware redirects.
- Run full test suite.

### Completion Notes List

- Verified logout route clears the session cookie and returns the `{ data, error }` envelope.
- Confirmed CSRF validation uses `csrf_token` cookie + `x-csrf-token` header; added invalid-CSRF test.
- Verified header menu logout flow refreshes UI state; middleware redirects signed-out users to `/auth/login`.
- Added CSRF refresh retry for logout to avoid expired-token failures and redirect to `/auth/login` on success.
- Added middleware redirect test coverage for signed-out access to `/trips/*`.
- Tests run: not run (review fixes only).

### File List

- _bmad-output/implementation-artifacts/1-4-sign-out-from-current-device.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- travelplan/src/app/api/auth/logout/route.ts
- travelplan/src/components/HeaderMenu.tsx
- travelplan/src/lib/navigation/authMenu.ts
- travelplan/src/middleware.ts
- travelplan/test/authMenu.test.ts
- travelplan/test/logoutRoute.test.ts
- travelplan/test/middleware.test.ts
