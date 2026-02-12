# Story 1.2: Register With Email and Password

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a new user,
I want to create an account with email and password,
so that I can access my private trips.

## Acceptance Criteria

1. **Given** I am logged out
   **When** I submit a valid email and password (and accept data-consent)
   **Then** my account is created and I am signed in with a session cookie
   **And** I see a success state

2. **Given** I submit an invalid email format
   **When** I attempt to register
   **Then** I see a validation error and my account is not created

3. **Given** I submit a weak or empty password
   **When** I attempt to register
   **Then** I see a validation error and my account is not created

4. **Given** the email is already registered
   **When** I attempt to register
   **Then** I see an error indicating the account exists

5. **Given** I do not consent to data storage
   **When** I attempt to register
   **Then** I am blocked with a validation error and no account is created

## Tasks / Subtasks

- [x] Define user data model and constraints in Prisma (email unique, password hash, role, created/updated timestamps) (AC: #1, #4)
- [x] Add Prisma migration and client setup for SQLite (AC: #1)
- [x] Add auth validation schemas (email, password, consent) in `src/lib/validation/authSchemas.ts` (AC: #1-#5)
- [x] Implement register API route `src/app/api/auth/register/route.ts` with Zod validation, error envelope, and rate limiting (AC: #1-#5)
- [x] Hash passwords with bcrypt and store only hash; never store plaintext (AC: #1)
- [x] Issue JWT via `jose` and set HTTP-only cookie (SameSite=Lax; Secure in prod) (AC: #1)
- [x] Implement CSRF protection for the register POST (AC: #1)
- [x] Build registration UI at `src/app/(routes)/auth/register/page.tsx` using React Hook Form + MUI baseline (AC: #1-#5)
- [x] Display inline validation errors and server error states (AC: #2-#5)
- [x] Add basic tests for validation and API error envelope (AC: #2-#5)

## Dev Notes

- Scope: registration only. Do not implement login, logout, or password reset flows here.
- Registration should normalize email (trim + lower-case) before uniqueness check.
- Password policy is not explicitly defined; use a minimal secure rule (e.g., min 8 chars, max 72 for bcrypt) and document it in validation.
- Consent requirement is mandated by PRD (GDPR). Implement a required checkbox at registration.

### Project Structure Notes

- App Router only: API routes under `src/app/api/**/route.ts`.
- Use `src/lib/validation/*` for Zod schemas.
- Use `src/lib/auth/*` for JWT, bcrypt, and session helpers.
- Use `src/lib/http/response.ts` (or create) to enforce `{ data, error }` envelope.

### References

- Epic 1 / Story 1.2: `_bmad-output/planning-artifacts/epics.md#Story-1.2-Register-With-Email-and-Password`
- Architecture: `_bmad-output/planning-artifacts/architecture.md#Authentication-&-Security`
- Architecture: `_bmad-output/planning-artifacts/architecture.md#API-&-Communication-Patterns`
- Architecture: `_bmad-output/planning-artifacts/architecture.md#Project-Structure-&-Boundaries`
- PRD (GDPR + consent): `_bmad-output/planning-artifacts/prd.md#Compliance-&-Regulatory-(GDPR)`
- UX baseline: `_bmad-output/planning-artifacts/ux-design-specification.md#Design-System-Foundation`

## Developer Context (Read This First)

- The project is already initialized in `travelplan/` (Next.js 16.1.6, React 19.2.3, App Router, `src/` dir, `@/*` alias). Do not create a new app.
- Follow architecture patterns strictly: REST API, Zod validation, JWT cookie auth, error envelope `{ data, error }`.
- Use Material UI as the baseline component system; keep UI clean and calm per UX spec.

## Technical Requirements

- Auth: JWT in HTTP-only cookie (SameSite=Lax; Secure in prod), bcrypt for hashing, role-based access (owner/viewer).
- Security: CSRF protection for state-changing requests; basic rate limiting on auth endpoints.
- Validation: Zod schemas for request payloads and response shaping.
- API: REST with `{ data, error }` envelope and camelCase JSON.
- DB: SQLite via Prisma Migrate; DB naming `snake_case`.
- Dates: ISO 8601 UTC strings for API responses.

## Architecture Compliance

- API route location: `src/app/api/auth/register/route.ts`.
- Data access must go through `src/lib/repositories/*` if repo layer is introduced; Prisma client only in `src/lib/db/prisma.ts`.
- Error responses must use `{ data: null, error: { code, message, details } }`.
- Use naming conventions: DB `snake_case`, API JSON `camelCase`.

## Library / Framework Requirements

- `zod` 4.1.11 for validation (architecture baseline).
- `bcrypt` 6.0.0 for password hashing (architecture baseline).
- `jose` 6.1.0 for JWTs (architecture baseline).
- Prisma CLI + client 7.3.0 (architecture baseline).
- React Hook Form 7.71.1 for form handling (UX baseline).
- Use Material UI components for form inputs, buttons, and alerts.

## File Structure Requirements

- `src/app/api/auth/register/route.ts`
- `src/app/(routes)/auth/register/page.tsx`
- `src/lib/auth/jwt.ts`, `src/lib/auth/bcrypt.ts`, `src/lib/auth/session.ts` (if not already created)
- `src/lib/validation/authSchemas.ts`
- `src/lib/errors/apiError.ts` and `src/lib/http/response.ts` (if not already created)
- `prisma/schema.prisma` (user model, unique email)

## Testing Requirements

- Unit tests for Zod validation (valid/invalid email, weak password, missing consent).
- API handler tests for error envelope and duplicate email handling.
- If test framework not yet set up, add minimal tests or document the gap.

## Previous Story Intelligence

- Story 1.1 created the Next.js app in `travelplan/` with `src/` and App Router.
- Tailwind was disabled at init; Material UI is the intended baseline.
- Do not alter `next.config.ts` unless required; document any deviations.

## Git Intelligence Summary

- Most recent commit: `ca1b251` (Story 1.1 initial project generation).
- No existing auth logic or Prisma setup yet.

## Latest Tech Information (Web Research)

- Next.js 16.1.6 is a recent LTS patch with backported bug fixes; keep this version unless upgrading deliberately. (Research date: 2026-02-12)
- Prisma 7.3.0 adds query compilation options and SQLite adapter stability fixes; matches the architecture baseline. (Research date: 2026-02-12)
- `jose` 6.1.0 is current on npm and remains dependency-free; safe to use for JWTs. (Research date: 2026-02-12)
- `bcrypt` 6.0.0 is current; it drops support for Node <=16, which is fine for Node 24 LTS. (Research date: 2026-02-12)
- Zod npm shows a 4.1.x line; keep the project-pinned 4.1.11 for consistency unless a coordinated upgrade is planned. (Research date: 2026-02-12)

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

2026-02-12: Implemented Prisma schema + migration, auth validation, register API, CSRF, rate limiting, JWT cookie session, UI form, and tests.
2026-02-12: Addressed code review findings (Prisma version alignment, dotenv dependency, client generate hook, P2002 handling, portable test DB).

### Completion Notes List

- Implemented SQLite-backed Prisma user model + migration; added Prisma config and adapter for Prisma 7 client.
- Added Zod validation, bcrypt hashing, JWT session cookie, CSRF + rate limiting, and register API error envelope.
- Built registration UI with React Hook Form + MUI and inline/server error handling.
- Tests added for validation and register API error envelope + duplicate email handling.
- Code review fixes: aligned Prisma adapter version, added dotenv and postinstall Prisma generate, handled duplicate email race, portable test DB setup.
- Tests: `npm run test`, `npm run lint`.

### File List

- _bmad-output/implementation-artifacts/1-2-register-with-email-and-password.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- travelplan/.env
- travelplan/package.json
- travelplan/package-lock.json
- travelplan/prisma.config.ts
- travelplan/prisma/schema.prisma
- travelplan/prisma/dev.db
- travelplan/prisma/test.db
- travelplan/prisma/migrations/20260212164546_init/migration.sql
- travelplan/prisma/migrations/migration_lock.toml
- travelplan/src/app/api/auth/csrf/route.ts
- travelplan/src/app/api/auth/register/route.ts
- travelplan/src/app/(routes)/auth/register/page.tsx
- travelplan/src/generated/prisma/
- travelplan/src/lib/auth/bcrypt.ts
- travelplan/src/lib/auth/jwt.ts
- travelplan/src/lib/auth/session.ts
- travelplan/src/lib/db/prisma.ts
- travelplan/src/lib/errors/apiError.ts
- travelplan/src/lib/http/response.ts
- travelplan/src/lib/security/csrf.ts
- travelplan/src/lib/security/rateLimit.ts
- travelplan/src/lib/validation/authSchemas.ts
- travelplan/test/authSchemas.test.ts
- travelplan/test/registerRoute.test.ts
- travelplan/test/setup.ts
- travelplan/vitest.config.ts

### Change Log

- 2026-02-12: Implemented registration flow, Prisma setup/migration, auth utilities, CSRF + rate limiting, UI, and tests.
- 2026-02-12: Fixed review findings (Prisma version/dep, postinstall generate, duplicate email race, portable tests).
