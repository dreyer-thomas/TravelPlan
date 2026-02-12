# Story 1.7: How It Works Section

Status: ready-for-dev

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

- [ ] Add a “How it works” section to the home page with 3–5 steps (AC: #1, #3)
- [ ] Wire the “See how it works” link to the section anchor (AC: #1)
- [ ] Hide the “See how it works” link and section when a session cookie exists (AC: #2)
- [ ] Ensure styling matches the existing calm/clear UX baseline (AC: #3)

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

- Status: ready-for-dev
- Completion note: Story created for How it works section and signed-in hiding behavior.

## Dev Agent Record

### Agent Model Used

gpt-5 (Codex)

### Debug Log References

2026-02-12: Story created for how-it-works home section with signed-in hiding behavior.

### Completion Notes List

- New story added to cover how-it-works section and signed-in hiding rules.

### File List

- _bmad-output/implementation-artifacts/1-7-how-it-works-section.md
