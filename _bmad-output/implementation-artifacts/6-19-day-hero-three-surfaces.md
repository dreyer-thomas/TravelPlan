---
authored_against: dcfb859
---

# Story 6.19: Three Surfaces on the Day Hero

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner on a phone,
I want the day hero to carry three controls in three corners instead of a row of buttons,
so that the photo reads as a photo and the controls stop competing with the title for the same band.

## Acceptance Criteria

1. **Three surfaces, no more.** The hero carries exactly three interactive controls: previous day (top-left), next day (top-right), and the `⋯` overflow (bottom-right). Nothing else sits on the photo.
2. **Back to the trip moves into the menu.** The "← Zurück zur Reise" button leaves the hero and becomes the first item of the `⋯` menu, keeping its `href={/trips/${tripId}}` and its accessible name.
3. **Right edges agree.** The `⋯` and the next-day chevron share one right edge, to the pixel, at every breakpoint. Today they do not: the `⋯` inherits the hero's padding (16px at `xs`, 32px at `md`) while the chevron is absolutely positioned at `right: 8`.
4. **The header row is gone, not emptied.** With its only child moved, the row is removed rather than left as an empty flex container reserving height.
5. **The title survives losing its ceiling.** The title block is bottom-anchored and grows upward on a long note (28px/900, notes run to 280 chars). With the header row gone it may now reach the top corners, and with the `⋯` at the bottom-right it may reach that corner too. Neither control may be overlapped or made un-tappable, and no title text may render underneath one.
6. **The chevrons do not get less legible.** Measured against `HERO_SCRIM`, moving them from the vertical centre to the top corners drops the scrim behind them from ~0.35 to ~0.19 alpha — a 45% loss, on controls DW-98 already measured at 2.41:1. After this story they must read no worse than they do today; whatever achieves that is recorded.
7. **A missing neighbour still renders nothing.** No disabled chrome on the first or last day, as established by 6.11.
8. **Gating unchanged.** Every role that can open the day can still reach print and can still get back to the trip. Only the items 6.15 gated stay gated.
9. **Tab order follows the eye.** Previous, next, then the `⋯` — matching the new positions, as 6.11 did for the old ones.

## Tasks / Subtasks

- [ ] **Task 1 — Move the back button into the menu** (AC: 2, 4, 8)
  - [ ] The button is at `TripDayView.tsx:1944-1957`, a `Button component={Link}` inside `day-hero-header-left`.
  - [ ] It becomes a `MenuItem component={Link} href={/trips/${tripId}}` in the `⋯` menu. It is a link, like print — but an in-app link, so **no** `target="_blank"` / `rel`. Print's props stay on print.
  - [ ] Put it first. It is the way off the screen, and after 6.15 the menu holds planning actions that are not.
  - [ ] Once it is gone, `day-hero-header-row` and `day-hero-header-left` have no children. Delete both. The comment at `:1918-1925` and the one at `:1959-1961` describe a two-slot row that no longer exists — remove them rather than leaving a fourth stale version. Both have already been rewritten twice.
  - [ ] `t("trips.dayView.back")` opens with an arrow glyph ("← Zurück zur Reise"). In a menu the arrow is decoration for a shape that is no longer there. Decide whether it stays and say why; an existing test pins the exact accessible name, so this is a deliberate change or none at all.

- [ ] **Task 2 — Reposition the three controls** (AC: 1, 3, 9)
  - [ ] Previous day: `top: 8` / `left: 8`. Next day: `top: 8` / `right: 8`. Both lose `top: "50%"` and `transform: translateY(-50%)` (`:2059-2098`).
  - [ ] The `⋯` becomes absolutely positioned at `bottom: 8` / `right: 8`, out of the flex flow it lives in today.
  - [ ] AC3 is satisfied by construction if all three use the same `8`. Do not reintroduce the hero padding on any of them — that is the discrepancy being fixed.
  - [ ] DOM order: previous, next, `⋯`. Position comes from `top`/`left`/`right`/`bottom`, so DOM order is free to serve the keyboard.
  - [ ] `zIndex: 3` for all three, one above the title block, for the reason `:2051-2054` gives: at equal `zIndex` the later sibling wins hit-testing, which leaves a control looking present and partly dead to the touch.

- [ ] **Task 3 — Give the title back its clearance** (AC: 5)
  - [ ] The title block is `mt: "auto"`, `zIndex: 2`, full width (`:2101`). It was safe because the header row occupied the top in normal flow and nothing occupied the bottom-right. This story removes the first guarantee and breaks the second.
  - [ ] Two edges to solve: the top corners, which a long note can now reach, and the bottom-right, where the `⋯` now sits over the title's last line.
  - [ ] `zIndex` alone is not enough. It fixes painting and hit-testing; it does not stop text from running visibly under a translucent button. The title needs real clearance — right padding at least, and a top bound.
  - [ ] Test with the longest note the field allows (280 chars), not a short one. A short title hides this entirely.

- [ ] **Task 4 — Hold the chevrons' legibility** (AC: 6)
  - [ ] `HERO_SCRIM` is a four-stop `to top` gradient: `.88` at the bottom, `.54` at 38%, `.10` at 66%, `.26` at the top. The weakest band is the upper middle.
  - [ ] Computed for a 210px hero: the chevrons move from ~0.351 alpha to ~0.193; the `⋯` moves from ~0.161 to ~0.752. The `⋯` gains 4.7×, the chevrons lose 45%.
  - [ ] So this story improves one control and degrades two. DW-98 measured white-on-hero at 2.41:1 for the chevrons over a light photo — already under the 3:1 floor for non-text contrast.
  - [ ] `ON_PHOTO_CHROME` carries its own `rgba(255,255,255,.18)` fill and `.55` border, so the scrim is not the only thing holding them. Measure whether that is enough at the new position over a light photo before adding anything.
  - [ ] If it is not, the fix belongs to the control (a stronger local backing) and not to `HERO_SCRIM` — changing the gradient would move every other hero in the app.
  - [ ] Record the measured before/after. This is the one AC that can be satisfied by accident and look fine.

- [ ] **Task 5 — Tests** (AC: 1, 2, 4, 7, 8, 9)
  - [ ] `tripDayViewLayout.test.tsx` is the constraint and has been reworked by 6.9, 6.11, 6.13 and 6.15. Read it before adding.
  - [ ] Assert the hero contains exactly three interactive controls (AC1).
  - [ ] Assert no button or link named by `trips.dayView.back` renders in the hero, and that the menu contains one.
  - [ ] Assert `day-hero-header-row` no longer exists.
  - [ ] Keep the role assertions green: viewer reaches print and back-to-trip; the 6.15 items stay gated.
  - [ ] Assert the first day renders no previous chevron and the last no next chevron.
  - [ ] `npm test` green.

- [ ] **Task 6 — Manual check** (AC: 3, 5, 6)
  - [ ] jsdom computes no layout, so AC3, AC5 and AC6 are browser-only. Say in the Dev Agent Record which claims the suite supports and which the browser pass does.
  - [ ] At 390px and at 1400px: measure the right edge of the `⋯` and of the next-day chevron and confirm they are equal (AC3).
  - [ ] Open a day whose note runs to the full 280 characters and confirm no text sits under a control.
  - [ ] Over a light photo — sky, snow, sunlit rock — check all three controls.
  - [ ] Throwaway copy of `dev.db` on an isolated port — never `prisma/dev.db`. Recipe in `7-12-bucket-list-sidebar-card.md`'s Dev Notes.

## Dev Notes

### What was asked

Tommy on 2026-08-02, after using the day screen on a phone: *"Auf dem Handy stört es nun sehr, dass so viele Buttons da rumliegen. Wir verlegen den 'Zurück zur Reise' auch in das '...' Menü. Das '...' Menü legen wir nach rechts unten und die buttons für den nächsten Tag und vorherigen Tag nach links und rechts oben. Bitte achte darauf, dass der '...' Button und der nächster-Tag Button gleich rechts liegen. Aktuell sind die etwas verschoben zueinander. Damit sollte das Bild nur noch drei Flächen haben."*

The misalignment he noticed is real and measurable: the `⋯` sits inside `day-hero-header-row` and inherits the hero's `padding` (16px at `xs`, 32px at `md`), while the chevrons are absolutely positioned at `right: 8`. So they differ by 8px on a phone and 24px on a desktop.

### This is the third pass over the same header

6.11 put the chevrons on the hero and the print action into a page-local `⋯`. 6.15 moved move, swap and the day-image edit into that menu, emptying the right slot down to the `⋯` alone. This story empties the left slot too and repositions what is left.

Each pass has rewritten the same two comments. This one should remove them rather than write a fourth version, because the two-slot row they describe stops existing here.

### The scrim makes this asymmetric — and that is the finding

`HERO_SCRIM` is not uniform. Alpha by position, measured from the bottom: `.88` at 0%, `.54` at 38%, `.10` at 66%, `.26` at 100%. Moving a control changes how much dark backing it has, and the two moves in this story go in opposite directions:

| Control | Position today | Alpha | Position after | Alpha | |
|---|---|---|---|---|---|
| `⋯` | header row, ~44px from top | 0.161 | `bottom: 8` | **0.752** | 4.7× better |
| chevrons | vertical centre | 0.351 | `top: 8` | **0.193** | 45% worse |

The `⋯` was in the worst place on the hero and moves to the best. The chevrons were in a reasonable place and move to a poor one. AC6 exists so the second half is not shipped silently — DW-98 already has them at 2.41:1, and this makes that number worse, not better.

### Two menus, one rule

This story puts "back to the trip" into the page-local `⋯`. Story 6.20 puts "all trips" into the global `HeaderMenu`. That is not inconsistent, and the rule is worth stating because the next such request will need it:

**A navigation target that needs this trip or this day belongs in the page-local menu. One that needs nothing belongs in the global menu.** `/trips/${tripId}` needs the trip id, so it cannot live in `HeaderMenu` — which is exactly the reasoning 6.11 used to justify building the local menu in the first place. `/trips` needs nothing.

### The cost, stated once

Back-to-trip becomes two taps instead of one, and it is the primary way off this screen. That is the trade Tommy asked for and it is not re-opened here. Two things soften it: the browser's own back gesture is unchanged, and the chevrons — the navigation used far more often within a trip — get *more* prominent, not less.

### Traps

**1. The header row is load-bearing today.** The comment at `:1918` records why it is in normal flow rather than absolutely positioned: out of flow it reserved no height and a long note grew the title upward until it ran under the row. Removing the row removes that reservation. The problem it was solving does not disappear — it moves to the top corners, where the chevrons now are.

**2. `zIndex` is not clearance.** Raising the controls above the title fixes painting order and hit-testing. It does not stop the title from rendering visibly beneath a translucent 44px button. AC5 needs real space, not stacking.

**3. Do not change `HERO_SCRIM`.** It is shared with the trip hero and its four stops are documented in `DESIGN.md`. If the chevrons need more backing at the top, that belongs to the chevrons.

**4. Do not gate the `⋯`.** Unchanged from 6.15's trap 1b, and now stronger: with back-to-trip inside, gating the trigger would strand a viewer on the day screen with no route out.

**5. Three controls, one shared constant.** AC3 is trivially satisfied if all three read the same offset and trivially broken if one is written as `8` and another as `theme.spacing(1)` that later changes. Consider one named value.

### Testing

Vitest 3.2 + Testing Library, jsdom, via `test/helpers/renderWithProviders.tsx`. `tripDayViewLayout.test.tsx` is the constraint. AC3, AC5 and AC6 are browser-only — jsdom has no layout engine and no pixels.

### Project Structure Notes

One component: `src/components/features/trips/TripDayView.tsx`, plus its suite. Possibly `src/i18n/*.ts` if the back label's arrow glyph changes. No route, API or schema change.

### Sequencing

**After 6.15**, which is what leaves the `⋯` alone in the right slot and establishes the menu's gating. Building this first would conflict directly.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 6.19]
- [Source: travelplan/src/components/features/trips/TripDayView.tsx:1944-1957] — the back button to move
- [Source: travelplan/src/components/features/trips/TripDayView.tsx:2059-2098] — the two chevrons
- [Source: travelplan/src/components/features/trips/TripIcons.tsx:347] — `HERO_SCRIM`, the four stops
- [Source: _bmad-output/implementation-artifacts/6-11-day-nav-chevrons-and-print-menu.md] — the menu, the chevrons, and DW-98
- [Source: _bmad-output/implementation-artifacts/6-15-move-swap-into-overflow.md] — the story this follows

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

### Change Log
