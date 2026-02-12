# Story 1.7: How It Works Section

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a prospective user,
I want a clear “How it works” section on the home page,
so that I quickly understand the product before signing up.

## Acceptance Criteria

1. **Given** I am signed out
   **When** I click “See how it works”
   **Then** I am taken to a “How it works” section on the home page

2. **Given** I am signed in with a valid session cookie
   **When** I open the home page
   **Then** the “How it works” section is hidden
   **And** the “See how it works” link is hidden

3. **Given** the “How it works” section is visible
   **When** I scroll the page
   **Then** the section presents a concise 3–5 step explanation aligned to the UX baseline

## Tasks / Subtasks

- [x] Add a “How it works” section to the home page with 3–5 steps (AC: #1, #3)
- [x] Wire the “See how it works” link to the section anchor (AC: #1)
- [x] Hide the “See how it works” link and section when a session cookie exists (AC: #2)
- [x] Ensure styling matches the existing calm/clear UX baseline (AC: #3)

## Dev Notes

- Keep the section on the home page (no separate route).
- Use the session cookie presence to toggle visibility.
- Content should be concise and readable on desktop and mobile.

### Project Structure Notes

- App Router only.
- Use existing CSS module for home page styling.

### References

- UX baseline: `_bmad-output/planning-artifacts/ux-design-specification.md#Design-System-Foundation`

## Technical Requirements

- UI: MUI baseline styles and existing home page CSS tokens.
- Keep layout consistent with the current home page design language.

## File Structure Requirements

- `src/app/page.tsx`
- `src/app/page.module.css`

## Testing Requirements

- No automated tests required for static content unless a test harness exists.

## Story Completion Status

- Status: review
- Completion note: Story created for How it works section and signed-in hiding behavior.

## Dev Agent Record

### Agent Model Used

gpt-5 (Codex)

### Implementation Plan

- Update home page CTA anchor to target the new How It Works section.
- Add signed-out-only How It Works section with 4 steps and supportive copy.
- Style the new section with existing palette and typography tokens.

### Debug Log References

2026-02-12: Story created for how-it-works home section with signed-in hiding behavior.

### Completion Notes List

- Implemented a signed-out-only How It Works section with four steps and updated CTA anchor.
- Redirect signed-in users from `/` to `/trips` via middleware so the How It Works section and CTA are not shown for valid sessions.
- Added middleware coverage for home redirects and signed-out access.
- Collapsed the How It Works section behind the CTA button and increased spacing between the intro and cards.
- Tests run: not run after latest UI toggle changes.

### File List

- _bmad-output/implementation-artifacts/1-7-how-it-works-section.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- travelplan/src/components/HomeHero.tsx
- travelplan/src/middleware.ts
- travelplan/src/app/page.module.css
- travelplan/src/app/page.tsx
- travelplan/test/middleware.test.ts

## Change Log

- 2026-02-12: Added How It Works section, anchor wiring, and signed-in hiding behavior; refreshed home page styling.
- 2026-02-12: Redirect signed-in users from `/` to `/trips` and added middleware tests for home behavior.
- 2026-02-12: Collapsed How It Works behind CTA toggle and increased spacing between intro and cards.
