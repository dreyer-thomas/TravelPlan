# Story 1.8: UI i18n (English + German)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want to choose English or German for the UI,
so that the app displays text in my preferred language.

## Acceptance Criteria

1. **Given** I open the header menu
   **When** I choose English or German
   **Then** the UI updates immediately to that language
2. **Given** I am signed in
   **When** I select a language
   **Then** the preference is saved in my profile and persists across sessions
3. **Given** I am not signed in
   **When** I select a language
   **Then** the preference is saved locally and applies until I sign in
4. **Given** the UI renders
   **When** text comes from the product UI
   **Then** it is translated; user-entered content is not translated

## Story Requirements

- UI copy must be translated for all current screens and future UI strings.
- Language switcher lives in the hamburger menu.
- Preference is saved to the user profile (DB).
- Static translations only (no auto-translate).

## Tasks / Subtasks

- [x] Add `preferredLanguage` to User model with default `en` and migrate DB.
- [x] Create i18n dictionary files for `en` and `de`.
- [x] Build a lightweight translation helper and provider (client + server-safe).
- [x] Add language switcher to `HeaderMenu`.
- [x] Persist language choice to user profile via API.
- [x] Persist language choice in cookie for unauthenticated users.
- [x] Update existing UI copy to use translation keys.
- [x] Add tests for language preference persistence.

## Dev Notes

- Translate UI strings only. User-entered content (trip names, notes, etc.) stays as-is.
- Keep API error codes unchanged; map to localized UI messages in components.
- Default language: `en`.
- Use a cookie (e.g., `lang`) for initial render and for unauthenticated users.
- On login, if profile has `preferredLanguage`, overwrite cookie.

## Developer Context

- UI strings exist across Home, Auth, Trips, and Dialog components.
- Header menu already exists and is the right place for the toggle.

## Technical Requirements

- **DB**
  - Add `preferredLanguage` to `User` with allowed values `en` | `de`.
  - Default: `en`.
- **API**
  - Add `PATCH /api/users/me` (or `/api/users/me/language`) to update `preferredLanguage`.
  - Require valid session; return updated user.
- **i18n**
  - Add dictionary files (e.g., `src/i18n/en.ts`, `src/i18n/de.ts`).
  - Add helper `t(key)` and a provider that reads initial language from cookie.
  - Ensure server and client rendering use the same initial language.
- **UI**
  - Add language switch in `HeaderMenu`.
  - Replace hardcoded strings with translation keys in:
    - `src/app/page.tsx` + `src/components/HomeHero.tsx`
    - Auth pages (`login`, `register`, `forgot-password`, `reset-password`)
    - Trips pages and dialogs
    - Header menu labels

## Architecture Compliance

- Keep translations colocated under `src/i18n/`.
- Use existing auth + session validation patterns for profile updates.
- Keep UI changes within component files; no business logic on client.

## Library & Framework Requirements

- Use existing Next.js + React setup.
- Add a small internal i18n utility (no heavy external framework unless needed).

## File Structure Requirements

- New: `src/i18n/en.ts`, `src/i18n/de.ts`, `src/i18n/index.ts`.
- New API route for language preference.
- Update `HeaderMenu` and all UI components with translations.

## Testing Requirements

- API test: language update requires auth and persists in DB.
- UI test: switching language updates visible text.

## Project Context Reference

- The app uses App Router and MUI. Keep i18n solution compatible with both.

## Story Completion Status

- Status set to **ready-for-dev**.
- Completion note: Story drafted with i18n scope and persistence.

## Dev Agent Record

### Agent Model Used

Codex (GPT-5)

### Debug Log References

N/A

### Implementation Plan

- Add `PreferredLanguage` enum and `preferredLanguage` column with default `en` in Prisma schema.
- Add migration to introduce `preferred_language` with default `en`.
- Add schema test covering column presence and default.

### Completion Notes List

- Added UI i18n story with EN/DE support and profile persistence.
- Added `preferredLanguage` to the User schema with default `en` and a migration.
- Added a schema test for `preferred_language` default.
- Tests: `npm test -- userLanguageSchema.test.ts`
- Tests: `npm test`
- Added i18n dictionary scaffolding for `en` and `de`.
- Added i18n dictionary test coverage.
- Tests: `npm test -- i18nDictionaries.test.ts`
- Tests: `npm test`
- Added i18n helper utilities (language resolution + translate fallback) and provider.
- Added server helper for cookie-based language resolution.
- Added i18n helper/provider tests.
- Tests: `npm test -- i18nHelpers.test.ts i18nProvider.test.tsx`
- Tests: `npm test`
- Added language switcher menu item in `HeaderMenu` with nested language selection menu.
- Wrapped app layout with `I18nProvider` and server-resolved language.
- Added language label translations for menu.
- Added HeaderMenu language switcher test.
- Tests: `npm test -- headerMenuLanguageSwitcher.test.tsx`
- Tests: `npm test`
- Added user language update API route with validation + auth/CSRF checks.
- Wired language switcher to persist preference for authenticated users.
- Added language API validation schema and tests.
- Tests: `npm test -- userLanguageRoute.test.ts`
- Tests: `npm test`
- Added client-side cookie persistence on language change for signed-out users.
- Added language cookie tests.
- Tests: `npm test -- languageCookie.test.ts languageCookiePersistence.test.tsx`
- Tests: `npm test`
- Replaced UI copy with translation keys across Home, Auth, Trips, and dialogs.
- Added full EN/DE translations for current UI strings and error messages.
- Updated server and client components to use localized labels and dates.
- Updated TripsDashboard test to wrap i18n provider and adjust timing.
- Tests: `npm test`
- Added authenticated language persistence test in header menu.
- Tests: `npm test`
- Story complete. Full test suite passing.
- Added language preference cookie sync on login and language update API.
- Added language save error state in header menu and localized load error for trips dashboard.
- Updated language switcher labels to use translations consistently.
- Tests: `npm test -- loginRoute.test.ts userLanguageRoute.test.ts headerMenuLanguageSwitcher.test.tsx languageCookiePersistence.test.tsx`

### File List

- `_bmad-output/implementation-artifacts/1-8-ui-i18n-en-de.md`
- `_bmad-output/implementation-artifacts/1-7-how-it-works-section.md`
- `_bmad-output/implementation-artifacts/2-5-add-or-update-nightly-accommodation.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `docs/project-overview.md`
- `travelplan/prisma/schema.prisma`
- `travelplan/prisma/migrations/20260213113500_add_preferred_language/migration.sql`
- `travelplan/src/generated/prisma/commonInputTypes.ts`
- `travelplan/src/generated/prisma/enums.ts`
- `travelplan/src/generated/prisma/internal/class.ts`
- `travelplan/src/generated/prisma/internal/prismaNamespace.ts`
- `travelplan/src/generated/prisma/internal/prismaNamespaceBrowser.ts`
- `travelplan/src/generated/prisma/models/User.ts`
- `travelplan/src/i18n/index.ts`
- `travelplan/src/i18n/en.ts`
- `travelplan/src/i18n/de.ts`
- `travelplan/src/i18n/provider.tsx`
- `travelplan/src/i18n/server.ts`
- `travelplan/src/app/api/auth/login/route.ts`
- `travelplan/src/lib/validation/userSchemas.ts`
- `travelplan/src/lib/auth/bcrypt.ts`
- `travelplan/src/lib/navigation/authMenu.ts`
- `travelplan/src/components/LanguageSwitcherMenuItem.tsx`
- `travelplan/src/components/HeaderMenu.tsx`
- `travelplan/src/components/HomeHero.tsx`
- `travelplan/src/components/AppHeader.tsx`
- `travelplan/src/app/layout.tsx`
- `travelplan/src/app/page.tsx`
- `travelplan/src/app/(routes)/trips/page.tsx`
- `travelplan/src/app/(routes)/trips/[id]/page.tsx`
- `travelplan/src/components/features/trips/TripsDashboard.tsx`
- `travelplan/src/components/features/trips/TripCreateDialog.tsx`
- `travelplan/src/components/features/trips/TripCreateForm.tsx`
- `travelplan/src/components/features/trips/TripEditDialog.tsx`
- `travelplan/src/components/features/trips/TripDeleteDialog.tsx`
- `travelplan/src/components/features/trips/TripTimeline.tsx`
- `travelplan/src/app/(routes)/auth/login/page.tsx`
- `travelplan/src/app/(routes)/auth/register/page.tsx`
- `travelplan/src/app/(routes)/auth/forgot-password/page.tsx`
- `travelplan/src/app/(routes)/auth/reset-password/page.tsx`
- `travelplan/src/app/api/users/me/language/route.ts`
- `travelplan/test/userLanguageSchema.test.ts`
- `travelplan/test/i18nDictionaries.test.ts`
- `travelplan/test/i18nHelpers.test.ts`
- `travelplan/test/i18nProvider.test.tsx`
- `travelplan/test/headerMenuLanguageSwitcher.test.tsx`
- `travelplan/test/loginRoute.test.ts`
- `travelplan/test/userLanguageRoute.test.ts`
- `travelplan/test/languageCookie.test.ts`
- `travelplan/test/languageCookiePersistence.test.tsx`
- `travelplan/test/tripsDashboard.test.tsx`

## Change Log

- 2026-02-13: Completed UI i18n support with language persistence, translations, and tests.
- `travelplan/src/components/HeaderMenu.tsx`
- `travelplan/src/components/HomeHero.tsx`
- `travelplan/src/components/AppHeader.tsx`
- `travelplan/src/lib/navigation/authMenu.ts`
- `travelplan/src/app/page.tsx`
- `travelplan/src/app/(routes)/trips/page.tsx`
- `travelplan/src/app/(routes)/trips/[id]/page.tsx`
- `travelplan/src/components/features/trips/TripsDashboard.tsx`
- `travelplan/src/components/features/trips/TripCreateDialog.tsx`
- `travelplan/src/components/features/trips/TripCreateForm.tsx`
- `travelplan/src/components/features/trips/TripEditDialog.tsx`
- `travelplan/src/components/features/trips/TripDeleteDialog.tsx`
- `travelplan/src/components/features/trips/TripTimeline.tsx`
- `travelplan/src/app/(routes)/auth/login/page.tsx`
- `travelplan/src/app/(routes)/auth/register/page.tsx`
- `travelplan/src/app/(routes)/auth/forgot-password/page.tsx`
- `travelplan/src/app/(routes)/auth/reset-password/page.tsx`
- `travelplan/test/tripsDashboard.test.tsx`
- `travelplan/test/headerMenuLanguageSwitcher.test.tsx`
