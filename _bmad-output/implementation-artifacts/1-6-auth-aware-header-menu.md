# Story 1.6: Auth-Aware Header Menu

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a signed-in user,
I want login/register hidden and sign out available in a header menu,
so that the home page reflects my authenticated state without cluttering the hero.

## Acceptance Criteria

1. **Given** I am signed out
   **When** I open the home page
   **Then** I see Login and Register links in a header hamburger menu
   **And** I do not see a Sign out option

2. **Given** I am signed in with a valid session cookie
   **When** I open the home page
   **Then** Login and Register are hidden in the header menu
   **And** I see a Sign out option in the header menu

3. **Given** I click Sign out
   **When** the request succeeds
   **Then** my session cookie is cleared
   **And** I return to the home page in a signed-out state

## Tasks / Subtasks

- [x] Add a top-level header with a hamburger menu on the home page (AC: #1, #2)
- [x] Implement an auth-aware menu that toggles Login/Register vs Sign out based on session cookie (AC: #1, #2)
- [x] Add a sign-out API route that clears the session cookie and returns `{ data, error }` (AC: #3)
- [x] Wire Sign out menu item to call the sign-out route and refresh state (AC: #3)
- [x] Add tests for sign-out API route success and envelope shape (AC: #3)

## Dev Notes

- Keep the hero CTA unchanged; auth controls must live in the header hamburger menu.
- Follow existing auth utilities in `src/lib/auth/session.ts` for cookie handling.
- Use `{ data, error }` envelope for API responses.
- The presence of the `session` cookie is the initial signal for menu state (server-rendered if possible).

### Project Structure Notes

- App Router only: API routes under `src/app/api/**/route.ts`.
- Use `src/lib/http/response.ts` for `{ data, error }` envelope.
- Use Material UI components for menu + icon button.

### References

- Architecture: `_bmad-output/planning-artifacts/architecture.md#Authentication-&-Security`
- Architecture: `_bmad-output/planning-artifacts/architecture.md#API-&-Communication-Patterns`
- UX baseline: `_bmad-output/planning-artifacts/ux-design-specification.md#Design-System-Foundation`

## Technical Requirements

- Auth: JWT in HTTP-only cookie; session cookie name is `session`.
- Security: CSRF for state-changing requests if applicable to sign-out.
- API: REST with `{ data, error }` envelope and camelCase JSON.
- UI: MUI baseline components; keep layout calm and minimal.

## File Structure Requirements

- `src/app/page.tsx` (header + hamburger menu)
- `src/app/api/auth/logout/route.ts`
- `src/lib/auth/session.ts` (reuse)

## Testing Requirements

- API handler tests for sign-out envelope and cookie clearing.

## Story Completion Status

- Status: done
- Completion note: Created story for auth-aware header menu.

## Dev Agent Record

### Agent Model Used

gpt-5 (Codex)

### Debug Log References

2026-02-12: Story created for auth-aware header menu with sign-out in hamburger menu.
2026-02-12: Implemented auth-aware header menu, logout API, and tests; `npm test`.
2026-02-12: Lint pass; `npm run lint`.

### Completion Notes List

- New story added to cover header menu auth state + sign-out flow.
- Added header menu with auth-aware items, logout API with CSRF, and supporting tests.
- Tests: `npm test`.
- Lint: `npm run lint`.
- Review fixes: redirect to home after sign-out, restore hero CTA visibility, align menu labels with AC, update File List.
- Tests not rerun after review fixes.

### File List

- _bmad-output/implementation-artifacts/1-6-auth-aware-header-menu.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- _bmad-output/implementation-artifacts/1-3-sign-in-with-email-and-password.md
- _bmad-output/implementation-artifacts/1-4-sign-out-from-current-device.md
- _bmad-output/implementation-artifacts/1-7-how-it-works-section.md
- travelplan/.gitignore
- travelplan/src/app/page.tsx
- travelplan/src/app/page.module.css
- travelplan/src/app/(routes)/auth/login/page.tsx
- travelplan/src/app/(routes)/auth/register/page.tsx
- travelplan/src/app/(routes)/trips/page.tsx
- travelplan/src/components/HeaderMenu.tsx
- travelplan/src/app/api/auth/csrf/route.ts
- travelplan/src/app/api/auth/login/route.ts
- travelplan/src/app/api/auth/logout/route.ts
- travelplan/src/app/api/auth/register/route.ts
- travelplan/src/lib/auth/jwt.ts
- travelplan/src/lib/auth/session.ts
- travelplan/src/lib/navigation/authMenu.ts
- travelplan/src/lib/validation/authSchemas.ts
- travelplan/test/authMenu.test.ts
- travelplan/test/authSchemas.test.ts
- travelplan/test/loginRoute.test.ts
- travelplan/test/logoutRoute.test.ts
- travelplan/test/middleware.test.ts
