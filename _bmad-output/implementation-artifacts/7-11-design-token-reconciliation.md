---
---

# Story 7.11: Design Token Reconciliation — Contrast, Focus, and Literal Cleanup

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer and as a keyboard or low-vision user,
I want the design tokens established in Story 7.1 to be the single source of truth for color, contrast, and focus across every screen,
so that retheming does not require editing component bodies, and so that the focus and contrast baseline `EXPERIENCE.md` commits to is actually met.

## Acceptance Criteria

1. **Row-fill gap token.** `theme.ts`, `globals.css` and `DESIGN.md` gain a distinct token for the whole-row gap fill (`#FBF6EE`), separate from `warn-bg` `#F6ECE0`, which keeps serving pills, badges, error inputs and coverage segments. `DESIGN.md`'s `day-row.bg-gap` (`:104`) and `trip-row.bg-gap` (`:152`) both reference the new token.
2. **Neutral pill token.** `#F1ECE1` — used by all three mockups for the `upcoming` and `past` status pills, absent from `DESIGN.md` entirely — gains a token in the same three places.
3. **No colors exported from the icon module.** `ROW_GAP_BG` (`TripIcons.tsx:230`) and `NEUTRAL_PILL_BG` (`:239`) are deleted, and their three call sites read the new tokens instead. The rendered result of AC1–AC3 is pixel-identical to today: this corrects the specification to describe the shipped design, it does not restyle anything.
4. **`inkMuted` contrast.** `tokens.inkMuted` is darkened from `#8A8677` (3.65:1 on `tokens.card`) to at least 4.5:1 on `tokens.card`, applied at the token level. `DESIGN.md`'s color table records the new value.
5. **Past-row archival treatment.** At `TripsDashboard.tsx:454` the `opacity` moves off the row and onto the trip photo and the row border; the row's text and status pill render at full opacity. `DESIGN.md`'s `trip-row` entry records the split. `tokens.inkSoft` is unchanged.
6. **Keyboard focus on contained buttons.** `theme.ts` gains a `MuiButton` `&.Mui-focusVisible` treatment so every `variant="contained"` button in the app shows a visible focus indicator, and `src/components/features/auth/authSubmitSx.ts` is deleted — with its non-focus `mt: "6px"` preserved at the five call sites (see Dev Notes).
7. **`error` and `success` palette entries.** `theme.ts` gains both, drawn from existing values (`colors.errorBorder` `#C97A3E` and `colors.accent` `#4B6358`), so `<Alert severity="error">` and `severity="success"` stop rendering MUI's default `#d32f2f` and green. No component-local `sx` override is added to achieve this.
8. **Icon style-prop typing.** `TripIcons.tsx`'s `IconProps` (`:12`) types `sx` as `SxProps<Theme>` rather than `object`, so style-key typos are caught at every one of its 13 icon call sites. (The glyph *extraction* half of this entry is already resolved — see Dev Notes.)
9. **No functional change.** Every screen's behavior, data flow, routing and i18n is unchanged. This story touches the theme, three component files, the two token files and `DESIGN.md`.

## Tasks / Subtasks

- [ ] **Task 1 — Add the three new token values** (AC: 1, 2, 4)
  - [ ] `src/theme.ts`: add `warnBgRow: "#FBF6EE"` and `pillNeutral: "#F1ECE1"` to the `colors` object; change `inkMuted` to the new darker value.
  - [ ] Add `warnBgRow` and `pillNeutral` to **all three** places the token contract is declared: the `Palette["tokens"]` interface (`:6-19`), the `palette.tokens` object (`:158-171`), and `src/app/globals.css`'s `:root` block as `--color-warn-bg-row` / `--color-pill-neutral`. Update `--color-ink-muted` there too.
  - [ ] Miss any one of the three and either TypeScript fails or a CSS consumer silently reads an undefined variable.

- [ ] **Task 2 — Retire the icon-module color exports** (AC: 3)
  - [ ] Replace `ROW_GAP_BG` at `TripsDashboard.tsx:451`, `:465` and `TripTimeline.tsx:623` with `tokens.warnBgRow`.
  - [ ] Replace `NEUTRAL_PILL_BG` at `TripsDashboard.tsx:212`, `:218` with `tokens.pillNeutral`.
  - [ ] Delete both exports and their docblocks from `TripIcons.tsx` (`:222-239`) and drop them from the import lists in `TripsDashboard.tsx` (`:14`, `:16`) and `TripTimeline.tsx` (`:22`).
  - [ ] `HERO_SCRIM` (`TripIcons.tsx:211`) stays exactly where it is — see Dev Notes.

- [ ] **Task 3 — Past-row treatment** (AC: 5)
  - [ ] At `TripsDashboard.tsx:454`, remove `opacity: isPast ? 0.78 : 1` from the row `sx`.
  - [ ] Apply `opacity: 0.78` to the trip photo element and to the row's `borderColor` (via a composited color, not a nested `opacity` that would inherit to children).
  - [ ] Replace the existing comment at `:452-453` — it currently asserts the opposite rule ("opacity is the whole treatment for a past row") and would otherwise read as a contradiction of the code beneath it.
  - [ ] Update `test/tripsDashboard.test.tsx:269` (see Dev Notes — this assertion **will** fail).

- [ ] **Task 4 — Focus treatment for contained buttons** (AC: 6)
  - [ ] Add a `&.Mui-focusVisible` block to `theme.ts`'s `MuiButton.styleOverrides.root` using the ring already proven on the auth screens: `outline: 2px solid ${colors.ink}`, `outlineOffset: 2px`.
  - [ ] Delete `src/components/features/auth/authSubmitSx.ts`.
  - [ ] At each of the five auth pages, replace `sx={AUTH_SUBMIT_SX}` with `sx={{ mt: "6px" }}` and drop the import: `login/page.tsx:198`, `register/page.tsx:243`, `forgot-password/page.tsx:164`, `reset-password/page.tsx:245`, `first-login-password/page.tsx:167`.
  - [ ] Verify the ring is visible on a non-auth contained button (e.g. the trips-list "Neue Reise" action) — that is the whole point of moving it.

- [ ] **Task 5 — `error` and `success` palette entries** (AC: 7)
  - [ ] Add `error: { main: colors.errorBorder }` and `success: { main: colors.accent }` to `theme.ts`'s `palette`.
  - [ ] Add an `MuiAlert` `styleOverrides` treatment consistent with the card idiom (see Dev Notes on the `MuiPaper` border interaction).
  - [ ] Update the two now-stale docblocks that justify their existence by the absence of this palette entry: `FormNotice.tsx:14-17` and `TripCreateForm.tsx:408`. **Do not** migrate either component onto `<Alert>` — see Scope boundary.

- [ ] **Task 6 — Icon style-prop typing** (AC: 8)
  - [ ] In `TripIcons.tsx:12`, change `type IconProps = { sx?: object }` to use `SxProps<Theme>`, importing both types from `@mui/material/styles`.
  - [ ] This tightens all 13 icons at once. Expect the compiler to surface pre-existing style-key typos at call sites — fix them; each one is a style that has never been applied.
  - [ ] Do **not** move any glyph. All four named in the deferred entry already live in this file; `TripTimeline.tsx:17-26` imports them.

- [ ] **Task 7 — Update `DESIGN.md`** (AC: 1, 2, 4, 5)
  - [ ] Color table: add the two new tokens, update `ink-muted`.
  - [ ] `day-row.bg-gap` (`:104`) and `trip-row.bg-gap` (`:152`) → the new token reference.
  - [ ] `trip-row` (`:146-153`): record that opacity applies to photo and border, not to text; update the prose at `:241` that currently states opacity is the entire treatment.

- [ ] **Task 8 — Tests** (AC: 3, 5, 6, 7)
  - [ ] Fix the failing past-row assertion; add one that the row's text is **not** at reduced opacity.
  - [ ] Assert the gap row still renders `#FBF6EE` after the token swap (guards the pixel-identical claim in AC3).
  - [ ] Assert `theme.palette.error.main` and `success.main` are the token values, not MUI defaults.
  - [ ] Run the full suite: `npm test`. Several existing files assert token colors and will surface any unintended ripple.

## Dev Notes

### Baseline, and what lands before this story

`baseline_commit: 1ac8c5f` — Story 7.7's implementation (`a4f553b`) plus this story's planning commit. Every line number below was read at that tree. Sanity check: `src/components/forms/` (`FormField`, `FormNotice`, `PhotoUploadField`) and `src/components/ui/DialogShell.tsx` must exist and `src/components/features/auth/AuthField.tsx` must not. If that does not hold you are on the wrong baseline and the file map below will not match.

**Stories 7.8 and 7.9 land between that baseline and this story**, and both touch files this story touches — 7.8 owns `TripTimeline.tsx`'s lower sections and the trip-controls block, 7.9 shares `TripIcons.tsx`. This story is sequenced last in Epic 7 for exactly that reason. Expect the line numbers cited here to have drifted by the time you run; treat them as locators, not addresses, and re-grep for the symbol (`ROW_GAP_BG`, `AUTH_SUBMIT_SX`, `opacity: isPast`) rather than trusting the number. The *substance* of every finding below was verified at `1ac8c5f`.

### The two design decisions are settled — do not re-open them

Both were decided by Tommy on 2026-08-01 and are recorded in `_bmad-output/planning-artifacts/sprint-change-proposal-2026-08-01.md`.

**Gap background:** the mockups deliberately use two values — `#FBF6EE` for whole-row fills, `#F6ECE0` for pills, badges, error inputs and coverage segments (a weaker tint over a larger area). `DESIGN.md` was the inconsistent source: `:104` pointed `day-row.bg-gap` at `warn-bg` while `:152` hardcoded `#FBF6EE` for `trip-row`, despite both mockups painting both rows the same. **The shipped code is correct.** The fix is a second token, not a collapse to one value. Mockup evidence: `trip-overview-day-detail.html:322`, `trips-list-share-login.html:173` (rows) vs `:209`, `:301`, `forms-authoring.html:865` (small elements).

**Past row:** both affected elements pass 4.5:1 at full opacity and fail only under the multiplier — the 12px `inkSoft` sub-line goes 5.65:1 → ≈3.5:1, the 11.5px bold "Completed" pill on `#F1ECE1` goes 4.79:1 → ≈3.3:1. Raising opacity to the ≈0.90 break-even makes a past row nearly indistinguishable from an active one; darkening `inkSoft` to survive the multiplier would need ≈`#5A564F` and repaint every secondary-text surface in the app. Hence: opacity on the photo and border only. **`tokens.inkSoft` stays `#6B675C`.**

### Do not claim WCAG conformance

`prd.md:205-207` states: *"No formal accessibility standard required at this stage; follow basic best practices (contrast, focus states, keyboard access)."* The AA target was **removed** deliberately (`prd.md` change history, 2026-02-12), and `EXPERIENCE.md:99` instructs: *"do not present this system as AA-compliant or claim conformance to a level it was not designed or audited against."*

So: 4.5:1 is this story's **engineering target** under the PRD's "basic best practices (contrast)" clause. Write it that way in comments and in the Dev Agent Record. Do not add "WCAG AA compliant" to any docstring, changelog entry or UI copy. The focus-state work (AC6) needs no such hedge — `EXPERIENCE.md:104` makes visible focus an unconditional baseline commitment.

### Traps

**1. `AUTH_SUBMIT_SX` does two things.** Beyond the focus ring it carries `mt: "6px"`. Deleting the file without replacing that margin silently shifts all five auth submit buttons up 6px. Task 4 preserves it inline.

**2. One test will fail and it is supposed to.** `test/tripsDashboard.test.tsx:269` asserts `expect(row).toHaveStyle({ opacity: "0.78" })` on the row element. AC5 moves that opacity off the row. Update the assertion to target the photo; do not restore the row opacity to make it pass.

**3. Adding `palette.error` has a wide blast radius.** The deferred entry named only `TripShareDialog`, but there are ~20 `<Alert>` call sites across 15 component files and ~27 `helperText`/`FormHelperText` usages. MUI derives error helper-text color from `palette.error.main`, so form validation text across the app changes color too. That is the intended outcome — but verify it screen by screen rather than assuming, and list the affected surfaces in the Dev Agent Record.

**4. `Alert` renders on `Paper`.** `theme.ts:245-252` gives every `MuiPaper` root `border: "1px solid rgba(17, 18, 20, 0.08)"`, which already applies to alerts today. Any `MuiAlert` border you add composes with it — check the rendered result rather than reading the override in isolation. This is the same `MuiPaper` constraint Stories 7.3, 7.8 and 7.9 each had to work around.

**5. Two components exist *because* `palette.error` is missing.** `FormNotice.tsx` (7.7) and the inline notice in `TripCreateForm.tsx` both carry docblocks stating they are deliberately not `<Alert severity="error">` because the palette has no `error` entry. Once AC7 lands those justifications are false. **Update the docblocks; do not convert the components.** They use the warn family per `DESIGN.md`, which remains the right treatment for form-level notices — converting them is a separate UX decision about which of the two error idioms wins app-wide, and it is not in this story.

**6. `inkMuted` has a live workaround.** `TripDayView.tsx:1138` carries the comment *"inkSoft rather than inkMuted: inkMuted is 3.65:1 on card white and already carries a deferred…"*. Once AC4 lands that comment is stale. Either update it or migrate the site back to `inkMuted` — but decide consciously and record which. The 10px coverage-axis tick labels at `TripDayView.tsx:1861` are the site the original deferred entry named.

**7. Tokens live in two files.** `theme.ts`'s `colors` object and `globals.css`'s `:root` block are independent copies of the same palette. Nothing enforces their agreement. Change one, change both.

### Deliberately out of scope

- **`HERO_SCRIM`** (`TripIcons.tsx:211`). The original 7.2 deferred entry named it, but it has since become one shared export consumed by four components (`AuthScreenShell`, `TripDayView`, `TripTimeline`, and its own module) — it is already centralised, and it is a gradient rather than a color token. Leave it.
- **`DAY_ROW_GAP_BG`** does not exist. The 7.2 entry named `TripTimeline.tsx:153`; Story 7.4 consolidated it into `TripIcons.tsx` as `ROW_GAP_BG`. Do not go looking for it.
- **The glyph extraction is already done.** The 7.2 entry asked for `HouseIcon`, `WarningTriangleIcon`, `ChevronRightIcon` and `ShareGlyphIcon` to move out of `TripTimeline.tsx`. They already live in `TripIcons.tsx` (`:14`, `:37`, `:53`, `:118`) and `TripTimeline.tsx:17-26` imports them — Stories 7.4 through 7.7 did the work incidentally. Only the weak `sx?: object` typing survives, and it was never limited to those four: `IconProps` (`:12`) governs all 13 icons in the module. AC8 is that residual.
- **Any `<Alert>` markup change.** AC7 changes the palette the alerts draw from, nothing else. `EXPERIENCE.md` calls the error-banner treatment "not pixel-mocked — minimal convention only"; 7.8 and 7.9 both left these banners alone.
- **The `MiniImageStrip` / `PhotoUploadField` keyboard defects**, the day-page 25px overflow, the CSRF duplication, `formatCost` divergence, and the i18n plural gap. All are in `deferred-work.md` with other homes.
- **`theme.ts`'s blanked `shadows` array.** AC6 adds an outline-based focus ring; it does not restore `shadows[6]`. Whether the array should stay blanked is a separate design question.

### Testing

Vitest 3.2 + Testing Library, jsdom. Render through `test/helpers/renderWithProviders.tsx` so the real theme is applied — several suites (`tripsDashboard`, `tripTimeline*`, `tripShareDialog`, `formPrimitives`) assert token colors directly and are the safety net for the AC3 pixel-identical claim.

Note that jsdom does not implement `:focus-visible`, so AC6 cannot be asserted end-to-end in the suite. Assert the theme object carries the override, and verify the visible ring manually in a browser on both an auth screen and one non-auth contained button. Record both in the Dev Agent Record.

### Project Structure Notes

Files touched: `src/theme.ts`, `src/app/globals.css`, `src/components/features/trips/TripIcons.tsx`, `TripsDashboard.tsx`, `TripTimeline.tsx`, the five `src/app/(auth)/auth/*/page.tsx` pages, `src/components/forms/FormNotice.tsx` (docblock only), `src/components/features/trips/TripCreateForm.tsx` (docblock only), plus `DESIGN.md` and the affected tests. One file deleted: `src/components/features/auth/authSubmitSx.ts`.

No new directories, no new dependencies, no route or API change, no i18n key added or removed.

### Deferred-work entries this story closes

Seven entries, from the code reviews of 7-2, 7-3, 7-4, 7-5 and 7-6:

| Entry (abbreviated) | AC |
|---|---|
| New hardcoded hex/rgba literals contradict 7.1's token foundation | 1, 3 |
| Design-system color constants live in an icon module | 2, 3 |
| `inkMuted` fails AA at the size it is used | 4 |
| Past-row `opacity: 0.78` drops 12px `inkSoft` below AA | 5 |
| Every `variant="contained"` MUI button has no visible keyboard focus state | 6 |
| Alerts are the one surface left on stock MUI colours | 7 |
| Four one-off SVG icon components inlined in `TripTimeline.tsx` | 8 — extraction half already resolved by 7.4–7.7; only the typing remains |

`closes_deferred:` frontmatter is **not** set on this story: `deferred-work.md` is still in the legacy pre-DW format with no `DW-<n>` ids to reference. Once the ledger migration has run, add the ids; until then a later `bmad-loop sweep` closes these entries by verifying them against this story's commit.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 7.11]
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-08-01.md#4.3] — both design decisions, with rationale
- [Source: _bmad-output/planning-artifacts/prd.md#Accessibility Level] — no formal standard; basic best practices
- [Source: ux-designs/ux-TravelPlan-2026-07-27/DESIGN.md] — `:14-25` color table, `:98-104` day-row, `:146-153` trip-row, `:241` archival prose, `:249` no-WCAG-claim
- [Source: ux-designs/ux-TravelPlan-2026-07-27/EXPERIENCE.md#Accessibility Floor] — `:99` conformance caveat, `:104` visible focus commitment
- [Source: ux-designs/ux-TravelPlan-2026-07-27/mockups/trips-list-share-login.html:173,209-211]
- [Source: ux-designs/ux-TravelPlan-2026-07-27/mockups/trip-overview-day-detail.html:322]
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] — the seven entries, under the 7-2/7-3/7-4/7-5/7-6 review sections

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

### Change Log
