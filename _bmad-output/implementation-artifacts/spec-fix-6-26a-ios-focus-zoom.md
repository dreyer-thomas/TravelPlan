---
title: 'Fix 6.26a iOS Focus Zoom — Editable Controls Below the 16px Threshold'
type: 'bugfix'
created: '2026-08-04'
status: 'review'
route: 'one-shot'
---

## Intent

**Problem:** Tapping a text field in the activity dialog on a phone zooms the page in, and it stays zoomed after the field is left — so the dialog's own tab bar and footer buttons sit outside the visual viewport and have to be pinched back out by hand before anything else can be used. Reported against the activity dialog; the cause is app-wide and every form in the app has it.

**Cause:** iOS Safari zooms the viewport whenever a focused editable control's font is **smaller than 16px**, and does not zoom back out on blur. No control in this app sets a font size of its own, so all of them inherit 13.5px:

- MUI spreads `typography.body1` (13.5px, `DESIGN.md.typography.body`) onto `InputBase`'s root, and the input slot's `font: inherit` passes it to every `<input>` and `<textarea>`.
- `CssBaseline` puts the same 13.5px on `body`, which the activity dialog's rich-text `contenteditable` inherits — it carries no size at all.

The design system's *body* size was, silently, also its *control* size. `DESIGN.md`'s `input` entry specifies `minHeight`, radius, fill, borders and focus ring, and **no type size** — so this was inheritance, not a decision.

**Approach:** One shared override in `theme.ts`, applied to the three slots a caret can land in, raising them to exactly 16px on touch devices only.

## Decisions

**Not `maximum-scale=1` / `user-scalable=no`.** One line in the viewport meta stops the auto-zoom and is what most search results suggest. It also removes pinch-zoom for every user on every screen, failing WCAG 1.4.4 — not acceptable in an app already held to 44px targets and AA contrast.

**A pointer query, not a width query.** `@media (max-width: 599.95px)` was the first attempt and misses the case: an iPhone in landscape reports ~932px of viewport width, above any phone breakpoint, and Safari zooms there just the same. `(hover: none) and (pointer: coarse)` asks the question that matters and is orientation-independent. Desktop is untouched at every width, so the composition the 2026-07-27 pass actually approved and mocked is unchanged.

**16px exactly, not a margin above it.** The threshold is `< 16px`, so equality is the fix. The test parses the number rather than matching the string, so a later tidy to 15.5px fails on the value.

**The `Select` is included, and is not a zoom fix.** MUI's `Select` display is a `div` with `role="combobox"`, not a native `<select>`, so Safari has nothing to zoom for. It shares a field row with the check-in time input, and a 13.5px select beside a 16px input is a visible mismatch.

**Cost, accepted:** a control grows by roughly one line-box difference — about 4px per field — on phones. Forms are marginally taller there. The alternative was a zoom the user has to undo by hand.

## Suggested Review Order

- [`travelplan/src/theme.ts`](../../travelplan/src/theme.ts) — `TOUCH_ZOOM_SAFE_FONT_SIZE` and its three consumers: `MuiInputBase.input`, `MuiSelect.select`, and `MuiCssBaseline`'s `.tiptap-editor` rule
- [`travelplan/test/theme.test.tsx`](../../travelplan/test/theme.test.tsx) — one case pinning the threshold and the query on all three slots

## Verification

- `npx vitest run` — full suite green, including the 104-case day-view suite that renders these controls
- `tsc` over `src/` — 0 errors; `eslint` — no new findings
- **Not verified: an actual iPhone.** jsdom evaluates no media queries and has no visual viewport to zoom, so neither half of the mechanism is observable in a test — the assertions cover the threshold and the query, which are the parts that rot silently. What still needs a device:
  - Tap the activity dialog's title field **and** its rich-text description on an iPhone, in portrait *and* landscape, and confirm the page does not zoom.
  - Confirm pinch-zoom still works — the whole reason the viewport-meta route was rejected.
  - Check the 390px height cost across the tabbed dialogs; the stay dialog's `STAY_PANEL_MIN_HEIGHT` was computed at 44px-per-input and its own browser measurement (story 6.26, task 7) is still outstanding, so measure the two together.
