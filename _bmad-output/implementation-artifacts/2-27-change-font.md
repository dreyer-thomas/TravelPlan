# Story 2.27: Change Font to Sans-Serif

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner,
I want the UI to use a clean sans-serif font instead of the current serif headings,
so that the interface feels modern, readable, and consistent across screens.

## Acceptance Criteria

1. **Given** I view any page with headings (H1–H6)
   **When** the page renders
   **Then** all headings use a sans-serif font (no serif fallback is used).
2. **Given** I view body text or form inputs
   **When** the page renders
   **Then** body typography uses the same sans-serif family as the headings (or a compatible sans-serif stack).
3. **Given** I open the marketing/landing page
   **When** I view the hero, section titles, and cards
   **Then** no element uses `Fraunces` or any serif font.
4. **Given** the app runs on Windows, macOS, and iOS
   **When** fonts resolve
   **Then** the stack falls back gracefully to common sans-serif fonts (e.g., Calibri/Arial) without layout breakage.
5. **Given** I run the app after the change
   **When** the UI loads
   **Then** there is no visual regression caused by mixed serif/sans usage.

## Tasks / Subtasks

- [ ] Identify all font assignments using serif display fonts (AC: 1, 3)
- [ ] Update the font stack to a sans-serif family with Calibri/Arial fallbacks (AC: 1, 2, 4)
- [ ] Remove or replace all explicit `Fraunces` usage in CSS and theme typography (AC: 1, 3)
- [ ] Verify landing page and core app pages render with the new sans-serif stack (AC: 5)

## Dev Notes

- Current theme defines headings with `Fraunces` and body with `Source Sans 3`.
- The request is to remove the serif headings and standardize on a sans-serif font (Calibri/Arial or similar).
- Keep MUI theme typography and global CSS aligned so headings and body are consistent.

### Project Structure Notes

- MUI theme typography: `travelplan/src/theme.ts`.
- Global font family and heading styles: `travelplan/src/app/globals.css`.
- Landing page overrides: `travelplan/src/app/page.module.css`.
- Layout root (if adding `next/font` variables): `travelplan/src/app/layout.tsx`.

### References

- `_bmad-output/planning-artifacts/ux-design-specification.md` (typography system and design direction)
- `_bmad-output/planning-artifacts/architecture.md` (theme + component boundaries)

## Technical Requirements

- Replace all `Fraunces` references with a sans-serif stack (Calibri/Arial preferred; include safe fallbacks).
- Align `--font-display` and `--font-body` (or equivalent) to the same sans-serif family.
- Update MUI `theme.typography` so headings do not specify a serif font.
- Ensure CSS module styles on the landing page do not reintroduce serif fonts.
- Do not introduce new font loading dependencies unless needed; if using `next/font`, use the App Router API.

## Architecture Compliance

- Keep changes confined to styling/theme files and the landing page module.
- No API, DB, or state changes.

## Library & Framework Requirements

- If you decide to use `next/font`, follow the App Router font module usage and CSS variable approach.
- Material UI typography should use `theme.typography.fontFamily` for global sans-serif assignment.

## File Structure Requirements

- Expected edits limited to:
  - `travelplan/src/theme.ts`
  - `travelplan/src/app/globals.css`
  - `travelplan/src/app/page.module.css`
  - (Optional) `travelplan/src/app/layout.tsx`

## Testing Requirements

- Visual check: headings and body text render in sans-serif on at least one main app view and the landing page.
- Visual check: no serif font appears in hero, section titles, or cards.

## Previous Story Intelligence

- Story 2.26 focused on day view UI; keep changes scoped to typography to avoid regressions in the day view layout.

## Project Context Reference

- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/epics.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/architecture.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/prd.md`
- `/Users/tommy/Development/TravelPlan/_bmad-output/planning-artifacts/ux-design-specification.md`

## Story Completion Status

- Status set to **ready-for-dev**.
- Completion note: Serif display font removed; UI standardized on sans-serif stack.

## Dev Agent Record

### Agent Model Used

Codex (GPT-5)

### Debug Log References

- Created story context for replacing serif typography with sans-serif font stack.

### Completion Notes List

- Update theme + global CSS + landing page overrides to use sans-serif only.
- Verify no serif font remains in headings or body.

### File List

- `_bmad-output/implementation-artifacts/2-27-change-font.md`
- `_bmad-output/implementation-artifacts/2-26-move-day-item-delete-into-dialog.md`
- `_bmad-output/planning-artifacts/epics.md`
- `_bmad-output/planning-artifacts/architecture.md`
- `_bmad-output/planning-artifacts/prd.md`
- `_bmad-output/planning-artifacts/ux-design-specification.md`
