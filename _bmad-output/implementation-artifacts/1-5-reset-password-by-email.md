# Story 1.5: Reset Password by Email

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a logged-out user,
I want to reset my password via email,
so that I can regain access to my account.

## Acceptance Criteria

1. **Given** I am logged out
   **When** I request a password reset with my email
   **Then** I receive a reset link or code

2. **Given** I have a valid reset link or code
   **When** I set a new password
   **Then** I can sign in with the new password

3. **Given** I use an invalid or expired reset link or code
   **When** I attempt to reset my password
   **Then** I see an error and the password is not changed

## Tasks / Subtasks

- [x] Add password reset data model (tokens + expiry + used) and migrate DB (AC: #2, #3)
- [x] Add API route to request reset, returning success envelope without account enumeration (AC: #1)
- [x] Add API route to confirm reset using token + new password validation (AC: #2, #3)
- [x] Add UI: forgot password request page (email input + success state) (AC: #1)
- [x] Add UI: reset password page (token + new password) with error handling (AC: #2, #3)
- [x] Add CSRF enforcement for both request and confirm routes (AC: #1, #2, #3)
- [x] Add tests for request/confirm routes, including invalid/expired tokens (AC: #2, #3)

## Dev Notes

- Avoid account enumeration: always return `{ data: { success: true }, error: null }` for reset requests, even if email is unknown.
- Use single-use, cryptographically strong tokens with a short expiration window (e.g., 60 minutes).
- Store only a hash of the reset token in the DB; never store raw tokens.
- Mark tokens as used and prevent reuse.
- All state-changing requests must validate CSRF (cookie + header).

### Project Structure Notes

- App Router only: API routes under `src/app/api/**/route.ts`.
- Auth helpers in `src/lib/auth/*` and security utilities in `src/lib/security/*`.
- Validation schemas in `src/lib/validation/*`.
- UI routes under `src/app/(routes)/auth/*`.

### References

- Epic 1 / Story 1.5: `_bmad-output/planning-artifacts/epics.md#Story-1.5-Reset-Password-by-Email`
- Architecture: `_bmad-output/planning-artifacts/architecture.md#Authentication-&-Security`
- Architecture: `_bmad-output/planning-artifacts/architecture.md#API-&-Communication-Patterns`
- Architecture: `_bmad-output/planning-artifacts/architecture.md#Project-Structure-&-Boundaries`
- UX baseline: `_bmad-output/planning-artifacts/ux-design-specification.md#Design-System-Foundation`
- PRD: `_bmad-output/planning-artifacts/prd.md#Functional-Requirements`

## Developer Context (Read This First)

- CSRF protection exists via `CSRF_COOKIE_NAME = "csrf_token"` and `validateCsrf` in `src/lib/security/csrf.ts`.
- Auth routes already follow the `{ data, error }` envelope using `ok`/`fail` from `src/lib/http/response.ts`.
- Password hashing utilities are in `src/lib/auth/bcrypt.ts`.
- JWT session cookie is `session` and is set/cleared via `src/lib/auth/session.ts`.
- Tests use Vitest and instantiate `NextRequest` directly in `test/*.test.ts`.

## Technical Requirements

- Auth: JWT in HTTP-only cookie (SameSite=Lax; Secure in prod); do not alter session behavior for reset.
- Security: CSRF protection for reset request and confirm routes.
- API: REST response envelope `{ data, error }` with camelCase JSON.
- Dates: ISO 8601 UTC strings if any date values are returned (avoid returning token expiry to client unless needed).
- Password policy: keep current constraints (8-72 characters).

## Architecture Compliance

- API routes should live under:
  - `src/app/api/auth/password-reset/request/route.ts`
  - `src/app/api/auth/password-reset/confirm/route.ts`
- Use `{ data: { success: true }, error: null }` on successful request/confirm.
- On invalid/expired token, return `{ data: null, error: { code, message, details } }` with 400.
- Do not introduce a different error envelope or auth helper.

## Library / Framework Requirements

- Next.js App Router (current baseline; do not upgrade in this story).
- Prisma `7.3.0`, `@prisma/client` `7.3.0`, SQLite `3.51.1`.
- `bcrypt` `6.0.0` for password hashing.
- `zod` `4.1.11` for request validation.

## File Structure Requirements

- `prisma/schema.prisma`
- `prisma/migrations/*`
- `src/app/api/auth/password-reset/request/route.ts`
- `src/app/api/auth/password-reset/confirm/route.ts`
- `src/app/(routes)/auth/forgot-password/page.tsx`
- `src/app/(routes)/auth/reset-password/page.tsx`
- `src/lib/validation/authSchemas.ts`
- `src/lib/auth/passwordReset.ts` (new helper module for token creation/validation)
- `test/passwordResetRequestRoute.test.ts`
- `test/passwordResetConfirmRoute.test.ts`

## Testing Requirements

- Request route returns success envelope even for unknown email.
- Request route rejects missing/invalid CSRF with 403 envelope.
- Confirm route rejects invalid/expired token with 400 envelope and does not change password.
- Confirm route updates password hash and allows login with new password.

## Previous Story Intelligence

- Story 1.4 enforced CSRF on logout and used `{ data, error }` envelope consistently.
- Story 1.2 register/login routes use Zod validation and return detailed validation errors.
- Keep auth behavior consistent with existing login/register patterns to avoid regressions.

## Git Intelligence Summary

- Recent commits: `Story 1.4 Sign out`, `Story 1.2 register user - Bugfix`, `Story 1.2 register user`, `Story 1.1 Initial project generation`, `Initial commit`.
- Most recent auth work added CSRF flow and header menu logout; reuse those patterns.

## Latest Tech Information (Web Research)

- OWASP guidance: use cryptographically strong, single-use, expiring tokens; return consistent messages for existing/non-existing accounts; do not change the account until a valid token is presented.
- Next.js Route Handlers must live under the `app` directory in `route.ts` files; use standard HTTP methods for request/confirm endpoints.
- Prisma 7.3.0 includes a stability fix for `better-sqlite3` adapter; stay aligned with the pinned version unless explicitly upgrading.
- bcrypt 6.0.0 drops Node <= 16 support and switches to prebuilt binaries; no code changes required but keep the pinned version.
- jose supports `SignJWT` and `jwtVerify` for JWT flows (already in use).

## Project Context Reference

- Epics: `_bmad-output/planning-artifacts/epics.md`
- Architecture: `_bmad-output/planning-artifacts/architecture.md`
- PRD: `_bmad-output/planning-artifacts/prd.md`
- UX: `_bmad-output/planning-artifacts/ux-design-specification.md`

## Story Completion Status

- Status: review
- Completion note: Password reset flow implemented with CSRF enforcement and test coverage; full test suite passing.

## Dev Agent Record

### Agent Model Used

gpt-5 (Codex)

### Debug Log References

2026-02-12: Generated story context for password reset flow with architecture, UX, and security guardrails.
2026-02-12: Verified auth patterns (CSRF + envelope) and identified schema changes for reset tokens.

### Implementation Plan

- Extend Prisma schema with password reset token storage (hashed token, expiry, used).
- Add reset request route with non-enumerating responses and CSRF enforcement.
- Add reset confirm route with token validation and password update.
- Add UI pages for request and confirm.
- Add test coverage for request/confirm routes and invalid/expired tokens.

### Completion Notes List

- Prepared reset flow guardrails, schema expectations, and API/UI structure.
- Implemented password reset token storage, request/confirm routes, and UI pages with CSRF enforcement.
- Added password reset request/confirm tests (invalid/expired tokens, success, CSRF) and updated test migration locking.
- Tests: `npm test`.
- Added password reset email dispatch stub with reset link construction.
- Added rate limiting to reset request/confirm routes and invalidated all unused tokens on successful reset.
- Extended expired-token test to assert password remains unchanged.

### File List

- _bmad-output/implementation-artifacts/1-5-reset-password-by-email.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- travelplan/prisma/schema.prisma
- travelplan/prisma/migrations/20260212211000_add_password_reset_tokens/migration.sql
- travelplan/src/lib/auth/passwordReset.ts
- travelplan/src/lib/notifications/email.ts
- travelplan/src/lib/validation/authSchemas.ts
- travelplan/src/app/api/auth/password-reset/request/route.ts
- travelplan/src/app/api/auth/password-reset/confirm/route.ts
- travelplan/src/app/(routes)/auth/forgot-password/page.tsx
- travelplan/src/app/(routes)/auth/reset-password/page.tsx
- travelplan/test/passwordResetRequestRoute.test.ts
- travelplan/test/passwordResetConfirmRoute.test.ts
- travelplan/test/setup.ts
- travelplan/src/generated/prisma/browser.ts
- travelplan/src/generated/prisma/client.ts
- travelplan/src/generated/prisma/commonInputTypes.ts
- travelplan/src/generated/prisma/internal/class.ts
- travelplan/src/generated/prisma/internal/prismaNamespace.ts
- travelplan/src/generated/prisma/internal/prismaNamespaceBrowser.ts
- travelplan/src/generated/prisma/models.ts
- travelplan/src/generated/prisma/models/User.ts
- travelplan/src/generated/prisma/models/PasswordResetToken.ts

## Change Log

- 2026-02-12: Implemented password reset flow (tokens, routes, UI), added CSRF enforcement and tests, updated Prisma schema/migration.
- 2026-02-12: Added reset email stub, rate limiting, token invalidation, and improved reset tests.
