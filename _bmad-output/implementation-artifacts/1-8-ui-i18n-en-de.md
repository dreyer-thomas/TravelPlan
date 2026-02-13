# Story 1.8: UI i18n (English + German)

Status: ready-for-dev

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

- [ ] Add `preferredLanguage` to User model with default `en` and migrate DB.
- [ ] Create i18n dictionary files for `en` and `de`.
- [ ] Build a lightweight translation helper and provider (client + server-safe).
- [ ] Add language switcher to `HeaderMenu`.
- [ ] Persist language choice to user profile via API.
- [ ] Persist language choice in cookie for unauthenticated users.
- [ ] Update existing UI copy to use translation keys.
- [ ] Add tests for language preference persistence.

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

### Completion Notes List

- Added UI i18n story with EN/DE support and profile persistence.

### File List

- `/Users/tommy/Development/TravelPlan/_bmad-output/implementation-artifacts/1-8-ui-i18n-en-de.md`
