# Story 1.3: Sign In With Email and Password

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a returning user,
I want to sign in with my email and password,
so that I can access my trips.

## Acceptance Criteria

1. **Given** I am logged out
   **When** I submit valid credentials
   **Then** I am signed in with a session cookie
   **And** I can access authenticated pages

2. **Given** I submit invalid credentials
   **When** I attempt to sign in
   **Then** I see an error and remain logged out

## Tasks / Subtasks

- [x] Add login validation schema in `src/lib/validation/authSchemas.ts` (AC: #1, #2)
- [x] Implement login API route `src/app/api/auth/login/route.ts` with Zod validation, CSRF check, rate limiting, and `{ data, error }` envelope (AC: #1, #2)
- [x] Normalize email before lookup (trim + lower-case) to match registration behavior (AC: #1)
- [x] Verify password with bcrypt and return generic invalid-credentials error on mismatch (AC: #2)
- [x] Issue JWT via `jose` and set HTTP-only session cookie (SameSite=Lax; Secure in prod) (AC: #1)
- [x] Build login UI at `src/app/(routes)/auth/login/page.tsx` using React Hook Form + MUI baseline (AC: #1, #2)
- [x] Fetch CSRF token from `GET /api/auth/csrf` and send `x-csrf-token` on submit (AC: #1)
- [x] Display inline validation errors and server error states (AC: #2)
- [x] Add tests for login schema and login API error envelope + invalid credentials (AC: #1, #2)

## Dev Notes

- Scope: sign-in only. Do not implement logout or password reset here.
- Use a single error message for invalid credentials to avoid user enumeration.
- Rate limit login attempts per IP (match the registration endpoint pattern).
- Keep response shape consistent with the `{ data, error }` envelope.

### Project Structure Notes

- App Router only: API routes under `src/app/api/**/route.ts`.
- Use `src/lib/validation/*` for Zod schemas.
- Use `src/lib/auth/*` for JWT, bcrypt, and session helpers.
- Use `src/lib/http/response.ts` for `{ data, error }` envelope.

### References

- Epic 1 / Story 1.3: `_bmad-output/planning-artifacts/epics.md#Story-1.3-Sign-In-With-Email-and-Password`
- Architecture: `_bmad-output/planning-artifacts/architecture.md#Authentication-&-Security`
- Architecture: `_bmad-output/planning-artifacts/architecture.md#API-&-Communication-Patterns`
- Architecture: `_bmad-output/planning-artifacts/architecture.md#Project-Structure-&-Boundaries`
- UX baseline: `_bmad-output/planning-artifacts/ux-design-specification.md#Design-System-Foundation`

## Developer Context (Read This First)

- The project already includes a registration flow with CSRF and rate limiting. Reuse the existing helpers in `src/lib/security/*` and `src/lib/auth/*`.
- Session cookie is named `session` and is set via `setSessionCookie` in `src/lib/auth/session.ts`.
- The Prisma client lives at `src/lib/db/prisma.ts` and outputs to `src/generated/prisma`.
- Keep UI aligned with the Material UI baseline and the calm/clear UX direction.

## Technical Requirements

- Auth: JWT in HTTP-only cookie (SameSite=Lax; Secure in prod), bcrypt for password verification, role-based access (owner/viewer).
- Security: CSRF protection for state-changing requests; basic rate limiting on auth endpoints.
- Validation: Zod schemas for request payloads and response shaping.
- API: REST with `{ data, error }` envelope and camelCase JSON.
- DB: SQLite via Prisma Migrate; DB naming `snake_case`.
- Dates: ISO 8601 UTC strings for API responses.

## Architecture Compliance

- API route location: `src/app/api/auth/login/route.ts`.
- Prisma client only in `src/lib/db/prisma.ts`.
- Error responses must use `{ data: null, error: { code, message, details } }`.
- Use naming conventions: DB `snake_case`, API JSON `camelCase`.

## Library / Framework Requirements

- `zod` 4.1.11 (project baseline; upgrade only with a coordinated dependency sweep).
- `bcrypt` 6.0.0 for password verification.
- `jose` 6.1.0 for JWTs.
- Prisma CLI + client 7.3.0.
- React Hook Form 7.71.1 for form handling.
- Material UI 7.3.8 baseline components.

## File Structure Requirements

- `src/app/api/auth/login/route.ts`
- `src/app/(routes)/auth/login/page.tsx`
- `src/lib/validation/authSchemas.ts` (add login schema)
- `src/lib/auth/jwt.ts`, `src/lib/auth/bcrypt.ts`, `src/lib/auth/session.ts` (reuse)
- `src/lib/security/csrf.ts`, `src/lib/security/rateLimit.ts` (reuse)

## Testing Requirements

- Unit tests for login schema (valid/invalid email, missing password).
- API handler tests for invalid credentials and error envelope consistency.
- If test framework changes, document the gap explicitly.

## Previous Story Intelligence

- Story 1.2 created the Prisma `User` model with unique email + password hash and implemented `POST /api/auth/register` with CSRF + rate limiting.
- CSRF helper exists in `src/lib/security/csrf.ts` and endpoint at `GET /api/auth/csrf`.
- Session cookies are issued by `setSessionCookie` in `src/lib/auth/session.ts`.
- Tests are using Vitest with a local SQLite `test.db` and a `DATABASE_URL` override in `test/setup.ts`.

## Git Intelligence Summary

- Recent commits: `bbbf336` (Story 1.2 register user - Bugfix), `1170dfe` (Story 1.2 register user), `ca1b251` (Story 1.1 Initial project generation), `818edb7` (Initial commit).

## Latest Tech Information (Web Research)

- Next.js 16 introduces Cache Components and makes Turbopack the default bundler; keep App Router behaviors in mind when touching auth pages. (Source: Next.js 16 blog, 2025-10-21)
- Next.js 16.1.6 is listed as the latest release in package registries; keep the project pinned to 16.1.6 unless you deliberately upgrade. (Source: package registry listings)
- Prisma ORM 7.3.0 improves query compilation and includes a stability fix for the better-sqlite3 adapter, aligning with our SQLite stack. (Source: Prisma 7.3.0 release post)
- `jose` 6.1.0 is published on npm and remains dependency-free; continue using it for JWT signing. (Source: npm package listing)

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

2026-02-12: Generated story context for sign-in flow with full architecture, UX, and security guardrails.
2026-02-12: Added login validation schema with normalized email + password constraints; tests updated; `npm test`.
2026-02-12: Added login API route with CSRF, rate limiting, validation, and error envelope; tests updated; `npm test`.
2026-02-12: Verified login email normalization uses schema trim/lowercase before lookup; `npm test`.
2026-02-12: Added invalid-credentials login test and verified bcrypt mismatch handling; `npm test`.
2026-02-12: Added login success test asserting session cookie issuance; `npm test`.
2026-02-12: Built login page shell with React Hook Form + MUI baseline; `npm test`.
2026-02-12: Added CSRF token fetch + header on login submit; `npm test`.
2026-02-12: Added inline validation + server error handling for login form; `npm test`.
2026-02-12: Completed login schema + API error envelope tests (validation, csrf, invalid credentials); `npm test`.
2026-02-12: Marked story as review and updated sprint status.
2026-02-12: Lint pass; `npm run lint`.
2026-02-12: Added login hardening (constant-time verify, prisma error envelope, rate-limit fallback) and added protected trips route + middleware.
2026-02-12: Added JSON parsing guard in login UI and gitignored prisma test DB.

### Completion Notes List

- Story context includes CSRF + rate limit alignment with registration.
- Login requirements align with existing Prisma user model and JWT session cookie approach.
- Test expectations call out Vitest + SQLite test DB setup for parity with Story 1.2.
- Implemented login validation schema and added schema tests (email normalization + required password).
- Implemented login API route with CSRF + rate limiting and validation error handling.
- Ensured login email normalization matches registration behavior via schema pipeline.
- Added login invalid-credentials test covering bcrypt mismatch handling.
- Added login success test to confirm session cookie set on JWT issuance.
- Built login UI form shell with RHF + MUI components.
- Added CSRF token fetch and submit header for login form.
- Added inline validation and server error handling for login form.
- Completed login schema + API error envelope tests (validation + invalid credentials).
- Tests: `npm test`.
- Lint: `npm run lint`.
- Hardened login endpoint (constant-time credential check, envelope on prisma errors, rate-limit fallback).
- Added `/trips` authenticated page and middleware gate.
- Guarded login UI JSON parsing and network errors.
- Gitignored `prisma/test.db` and untracked file from git index.

### File List

- _bmad-output/implementation-artifacts/1-3-sign-in-with-email-and-password.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- travelplan/.gitignore
- travelplan/src/lib/validation/authSchemas.ts
- travelplan/src/lib/auth/jwt.ts
- travelplan/src/app/api/auth/login/route.ts
- travelplan/src/app/(routes)/auth/login/page.tsx
- travelplan/src/app/(routes)/trips/page.tsx
- travelplan/src/middleware.ts
- travelplan/test/authSchemas.test.ts
- travelplan/test/loginRoute.test.ts
