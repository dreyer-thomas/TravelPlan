---
authored_against: dcfb859
baseline_revision: d146125553ead80e1825d2702b25bf23a9ccec69
final_revision: 23fe4330ef4566739fa60e5c38d14ab35f9e1d86
status: awaiting-operator
review_loop_iteration: 0
followup_review_recommended: true
warnings: []
operator_actions:
  - "Run the app in a browser to do Task 5 — Task 6 in this spec — on a throwaway copy of dev.db on an isolated port, never prisma/dev.db. The recipe is in the Dev Notes of _bmad-output/implementation-artifacts/7-12-bucket-list-sidebar-card.md. Everything below needs that one session: AC3, AC5 and AC6 are the three acceptance criteria this story exists for and all three are rendered-pixel claims, which jsdom cannot make. It computes no layout and does not resolve MUI's responsive sx at all."
  - "At 390px and again at 1400px, open any middle day and measure the right edge of the ⋯ button and the right edge of the next-day chevron. Confirm they are equal to the pixel. This is AC3 and the whole reason the story was raised: the two were 8px apart on a phone and 24px apart on a desktop because the ⋯ inherited the hero's padding. All three controls now read one shared 8px constant, so they should agree by construction — measure it anyway, because construction is exactly what the suite already checked."
  - "Open a day whose note runs to the full 280 characters, at 390px and at 1400px. Confirm no part of the title or the date line renders underneath any of the three controls — the two top corners and the bottom-right. This is AC5. The clearance is bought with the hero's 60px top padding and a responsive right padding on the title, neither of which jsdom resolves, so the browser is the only place the claim can be checked. Confirm too that the whole note is still visible and the date line is not cut off: the alternative implementation would have clipped the title block, and the date is its last line."
  - "Over a genuinely bright photo — sky, snow, sunlit rock — look at all three controls on the same day. This is AC6 and the story warns it is the one that can be satisfied by accident and still look fine. The two chevrons now carry a dark translucent fill instead of the white one, which the arithmetic puts at 3.64:1 against 1.98:1 today; confirm they read as controls rather than as smudges, and that the ⋯ at the bottom does too."
  - "Check the same day over a dark photo as well. The dark fill is expected to sink into a dark backdrop — what should still delineate each chevron is its white border. Confirm the controls are still findable; if they are not, that is the trade-off going the wrong way and wants its own follow-up story rather than a change here."
  - "Open the ⋯ menu as an owner and confirm the order reads: Back to trip, Edit day details, Move activities, Swap activities, a divider, Print day. Then confirm a viewer sees only Back to trip and Print day, with no divider stranded between them."
  - "Confirm the arrow glyph decision reads correctly to you. \"← Back to trip\" is now \"Back to trip\" in both English and German, because the arrow pointed at a top-left button that no longer exists. The same key is shared by the day-not-found card, which also loses its arrow — glance at that screen too. If you want the arrow kept, say so: it is one string per locale plus three tests."
  - "If every check passes, tick Task 6 in this spec, set status: done in the frontmatter and Status: done in the body, and set 6-19-day-hero-three-surfaces to done in sprint-status.yaml."
---

# Story 6.19: Three Surfaces on the Day Hero

Status: awaiting-operator

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

- [x] **Task 1 — Move the back button into the menu** (AC: 2, 4, 8)
  - [x] The button is at `TripDayView.tsx:1944-1957`, a `Button component={Link}` inside `day-hero-header-left`.
  - [x] It becomes a `MenuItem component={Link} href={/trips/${tripId}}` in the `⋯` menu. It is a link, like print — but an in-app link, so **no** `target="_blank"` / `rel`. Print's props stay on print.
  - [x] Put it first. It is the way off the screen, and after 6.15 the menu holds planning actions that are not.
  - [x] Once it is gone, `day-hero-header-row` and `day-hero-header-left` have no children. Delete both. The comment at `:1918-1925` and the one at `:1959-1961` describe a two-slot row that no longer exists — remove them rather than leaving a fourth stale version. Both have already been rewritten twice.
  - [x] `t("trips.dayView.back")` opens with an arrow glyph ("← Zurück zur Reise"). In a menu the arrow is decoration for a shape that is no longer there. Decide whether it stays and say why; an existing test pins the exact accessible name, so this is a deliberate change or none at all.

- [x] **Task 2 — Reposition the three controls** (AC: 1, 3, 9)
  - [x] Previous day: `top: 8` / `left: 8`. Next day: `top: 8` / `right: 8`. Both lose `top: "50%"` and `transform: translateY(-50%)` (`:2059-2098`).
  - [x] The `⋯` becomes absolutely positioned at `bottom: 8` / `right: 8`, out of the flex flow it lives in today.
  - [x] AC3 is satisfied by construction if all three use the same `8`. Do not reintroduce the hero padding on any of them — that is the discrepancy being fixed.
  - [x] DOM order: previous, next, `⋯`. Position comes from `top`/`left`/`right`/`bottom`, so DOM order is free to serve the keyboard.
  - [x] `zIndex: 3` for all three, one above the title block, for the reason `:2051-2054` gives: at equal `zIndex` the later sibling wins hit-testing, which leaves a control looking present and partly dead to the touch.

- [x] **Task 3 — Give the title back its clearance** (AC: 5)
  - [x] The title block is `mt: "auto"`, `zIndex: 2`, full width (`:2101`). It was safe because the header row occupied the top in normal flow and nothing occupied the bottom-right. This story removes the first guarantee and breaks the second.
  - [x] Two edges to solve: the top corners, which a long note can now reach, and the bottom-right, where the `⋯` now sits over the title's last line.
  - [x] `zIndex` alone is not enough. It fixes painting and hit-testing; it does not stop text from running visibly under a translucent button. The title needs real clearance — right padding at least, and a top bound.
  - [x] Test with the longest note the field allows (280 chars), not a short one. A short title hides this entirely.

- [x] **Task 4 — Hold the chevrons' legibility** (AC: 6)
  - [x] `HERO_SCRIM` is a four-stop `to top` gradient: `.88` at the bottom, `.54` at 38%, `.10` at 66%, `.26` at the top. The weakest band is the upper middle.
  - [x] Computed for a 210px hero: the chevrons move from ~0.351 alpha to ~0.193; the `⋯` moves from ~0.161 to ~0.752. The `⋯` gains 4.7×, the chevrons lose 45%.
  - [x] So this story improves one control and degrades two. DW-98 measured white-on-hero at 2.41:1 for the chevrons over a light photo — already under the 3:1 floor for non-text contrast.
  - [x] `ON_PHOTO_CHROME` carries its own `rgba(255,255,255,.18)` fill and `.55` border, so the scrim is not the only thing holding them. Measure whether that is enough at the new position over a light photo before adding anything.
  - [x] If it is not, the fix belongs to the control (a stronger local backing) and not to `HERO_SCRIM` — changing the gradient would move every other hero in the app.
  - [x] Record the measured before/after. This is the one AC that can be satisfied by accident and look fine.

- [x] **Task 5 — Tests** (AC: 1, 2, 4, 7, 8, 9)
  - [x] `tripDayViewLayout.test.tsx` is the constraint and has been reworked by 6.9, 6.11, 6.13 and 6.15. Read it before adding.
  - [x] Assert the hero contains exactly three interactive controls (AC1).
  - [x] Assert no button or link named by `trips.dayView.back` renders in the hero, and that the menu contains one.
  - [x] Assert `day-hero-header-row` no longer exists.
  - [x] Keep the role assertions green: viewer reaches print and back-to-trip; the 6.15 items stay gated.
  - [x] Assert the first day renders no previous chevron and the last no next chevron.
  - [x] `npm test` green.

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

claude-opus-5

### Debug Log References

All commands run from `travelplan/`.

| Command | Outcome |
|---|---|
| `npx vitest run test/tripDayViewLayout.test.tsx` | **94 passed / 94** (93 before the last test was added). The story's own constraint suite. |
| `npm test` (`vitest run`) | **102 files, 958 tests, all passed.** |
| `npx tsc --noEmit` | 174 diagnostic lines, **0 of them in `src/`**. Proved pre-existing: `git stash -u` on a clean tree gives the same 174 lines, and `npx tsc --noEmit \| grep -cE "^src/"` is `0` both before and after. All of them are long-standing `test/**` fixture-typing errors (`Promise<{id?}>` params, `fetch` mock shapes) untouched by this story. |
| `npm run lint` (`eslint`) | 86 problems (2 errors, 84 warnings) — **byte-identical to the stashed baseline**. Both errors are in `src/theme.ts` (`react/no-children-prop`), which this story does not touch. `npx eslint` over the four files this story changed reports **0 errors**; its 7 warnings are all pre-existing (`react-hooks/set-state-in-effect` in `TripDayView.tsx`'s route effect, two unused test-mock params). |
| jsdom capability probe (temporary `console.log`, removed) | `getComputedStyle` on the hero returns `""` for `paddingTop`/`paddingLeft` and `""` for the title block's `paddingRight`, because MUI compiles responsive `sx` values into `@media` rules that jsdom does not resolve. Non-responsive declarations *do* resolve (`marginTop: "auto"`, `right: "8px"`, `zIndex: "3"`). This is what decides which half of AC3/AC5 the suite can hold and which is owed to the browser. |

One expected stderr line remains in the suite: `Not implemented: navigation to another Document`, emitted when the AC2 test clicks the new back-to-trip item. It is an in-app link with no `target`, so jsdom attempts a real navigation. Print does not produce it only because print carries `target="_blank"`.

### Completion Notes List

**AC1 — Three surfaces, no more.** PASS, automated. The hero's children are the scrim (`aria-hidden`, not interactive), the two chevrons, the `⋯`, and the title block. Test *"carries exactly three interactive controls on the photo, in the order the corners read (AC1, AC9)"* counts `hero.querySelectorAll("a[href], button")` rather than doing three positive lookups, so a fourth control added later fails it. Both element kinds are counted because the chevrons are `IconButton component={Link}` (role `link`) and the `⋯` is a real `button`. Test *"leaves the hero holding the overflow alone…"* covers the single-day case (one control).

**AC2 — Back to the trip moves into the menu.** PASS, automated. The `Button component={Link}` is now a `MenuItem component={Link} href={/trips/${tripId}}` with `sx={DAY_MENU_ITEM_SX}` and `onClick={handleDayMenuClose}`, first in the menu, with no `target`/`rel` — print keeps those. Test *"moves back-to-trip off the photo and into the menu, and removes the row it sat in (AC2, AC4)"* asserts: neither role named "Back to trip" inside `day-hero`; exactly one such `menuitem`; it is `menu`'s first item; `tagName === "A"`; `href === "/trips/trip-1"`; no `target`, no `rel`; and that activating it closes the menu.

*The arrow-glyph decision, and how it squares with AC2's "keeping its accessible name":* **the "← " prefix is dropped, in both locales.** Reason: the glyph was never decoration in general, it was decoration *for a shape* — a button pinned to the top-left corner of the hero, pointing back out of it. That shape no longer exists. In a vertical menu the row is a destination in a list, and an arrow on the first row of five reads as an affordance the row does not have. The command's name is unchanged — "Back to trip" / "Zurück zur Reise" — so AC2's requirement that the item still be *named the same thing* holds; what changed is a decorative character, deliberately, with the two pinning tests updated in the same commit rather than worked around. Both locales move together (a comment in `en.ts` says so and `de.ts` points at it) because nothing in this repo compares the EN and DE key sets, and one locale keeping the arrow would give the same row two shapes. Knock-on, accepted: the day-not-found card shares this key and loses its arrow too — correct for the same reason, it is a standalone action inside a card, not an edge-anchored back link. `trips.detail.back`, `trips.costOverview.back` and `trips.overviewMap.back` keep theirs; they are still edge-anchored back links.

*Menu order and the divider.* Final order is `Back to trip` · `Edit day details` · `Move activities` · `Swap activities` · `---` · `Print day`. `showDayMenuDivider` is **unchanged** — `(dayImage || transfers) && print` — so back-to-trip does not feed it. Rationale recorded in the code: the divider keeps exactly the meaning 6.15 gave it (it separates the day-changing group from print), back-to-trip is placed above that group as the menu's escape hatch and belongs to neither, and giving it a rule of its own would draw a separator between the only two entries a viewer sees. A viewer therefore gets `[Back to trip, Print day]` with no divider — the "never floats to the top, never an empty group above it" property is preserved by construction.

**AC3 — Right edges agree.** PARTIAL: **construction + declared-value test automated; the measured claim is browser-only.** One module constant `HERO_CONTROL_INSET = 8` is read by all three controls, and all three are absolutely positioned against the hero's padding box, so nothing inherits the hero's `16px`/`32px` inline padding any more — that inheritance *was* the 8px/24px discrepancy Tommy reported. Test *"pins all three hero controls to the same 8px inset (AC3, as far as jsdom can see)"* asserts `next.right === overflow.right === "8px"`, `previous.left === "8px"`, `position: absolute` on all three, `top: "8px"` on both chevrons, `bottom: "8px"` on the `⋯`, and empty `transform` (the old `translateY(-50%)` is gone). **Owed to the operator:** the rendered right edges at 390px and at 1400px. jsdom computes no layout.

**AC4 — The header row is gone, not emptied.** PASS, automated. `day-hero-header-row`, `day-hero-header-left` and `day-hero-header-right` are deleted from the JSX, along with both stale comments (`:1918-1925` and `:1959-1967`), rather than a fourth rewrite. The `<Menu>` survives and stays correctly anchored — it anchors via `anchorEl={dayMenuAnchor}`, not by DOM nesting, and it portals, so its new position as a direct child of the hero changes nothing. Same test as AC2 asserts all three test ids are absent; the count-based AC1 assertion is what makes "removed" distinguishable from "emptied".

**AC5 — The title survives losing its ceiling.** PARTIAL: **the non-clipping half automated; the geometry is browser-only.** Two real clearances, not `zIndex`:
- *Top bound* — the hero's `padding-top` goes from `22px` to `HERO_CONTROL_BAND` = `HERO_CONTROL_INSET (8) + HERO_CONTROL_SIZE (44) + HERO_CONTROL_GAP (8)` = **60px**, which is 8px below the chevrons' bottom edge at `y = 52`. This works because the title block is now the hero's *only* in-flow child: while the title is short `mt: auto` absorbs all the slack and the change is invisible; once the title is tall enough to fill the hero, `mt: auto` collapses to 0 and the padding becomes a hard ceiling — the hero grows taller instead of the title climbing into the corners.
- *Right bound* — `pr` on the title block, `{ xs: 44px, md: 28px }`, derived as `HERO_CONTROL_BAND − HERO_PADDING_INLINE[bp]` (60−16, 60−32). The `⋯` reaches 52px in from the hero's inner right edge while the title block stops at the hero's inline padding, so what the title gives back is the difference plus the gap.

*Approach justified (Task 3 asked for a choice):* **padding, not `maxHeight`/`overflow`.** The title block holds the title *and* the date line beneath it, so any clip applied to the block eats the date first — it is the block's last line — and would silently truncate the note in the accessible name without changing anything visible in a screenshot. Padding cannot clip: a long title just makes the hero taller, which is what it already did. Test *"keeps the whole 280-character title and its date line alongside all three controls (AC5)"* renders the longest note the field allows and asserts the heading still carries all 280 characters and the date line still renders — that is precisely the assertion a `maxHeight`/`overflow` implementation would fail. **Owed to the operator:** whether any text visually overlaps a control at 390px and 1400px with a 280-char note; jsdom resolves neither the responsive padding (probe above) nor any pixel.

**AC6 — The chevrons do not get less legible.** PASS by arithmetic; the rendered check is browser-only. Model: photo `#FAFAF8` (the figure DW-98 used) → `HERO_SCRIM` at the control's centre → the control's own fill → white glyph, 210px hero, control centres at 30px from the relevant edge.

*Scrim alpha at each position (interpolating the four stops, measured from the bottom):* chevrons `50% → 0.351`, `85.7% → 0.193`; `⋯` `~79% → 0.161`, `14.3% → 0.752`. These reproduce the story's table exactly.

**Every row below is the rendered composite** — photo → scrim → *the button's own fill* → white glyph. That third step is the one this analysis originally dropped and the review caught; the figures were re-derived independently before this record was finalised. It matters because DW-98's headline **2.41:1 is a scrim-only number**: it measures white against the scrimmed photograph with no button painted on it. The chevron does paint one, and being white (`rgba(255,255,255,.18)`) it lightens its own backdrop, so what a user actually sees today is worse than DW-98 records.

| Control | State | Composite behind the glyph | Contrast vs `#FFFFFF` |
|---|---|---|---|
| chevrons | centre, **scrim only** — DW-98's model, not a rendered state | `rgb(169,168,166)` | 2.37:1 (DW-98 records 2.41:1 for `rgb(168,167,164)`; the 0.04 is rounding — the model is confirmed identical) |
| chevrons | **today, as rendered** (centre, white `.18` fill) | `rgb(185,184,182)` | **1.98:1** |
| chevrons | moved to `top: 8`, scrim only | `rgb(206,205,203)` | 1.59:1 |
| chevrons | moved to `top: 8`, white `.18` fill — *the do-nothing option* | `rgb(215,214,212)` | **1.45:1** — the fill makes it worse, being white on white |
| chevrons | **moved, shipped** (`HERO_CHEVRON_BACKING`, `rgba(20,18,14,.38)` replacing the white fill) | `rgb(135,134,131)` | **3.64:1** at the glyph centre; **3.31:1** at the weakest point of the 44px band the button spans (scrim alpha 0.143 at `y = 52`) |
| `⋯` | **today, as rendered** (header row, white `.18` fill) | `rgb(230,230,228)` | **1.25:1** |
| `⋯` | **moved to `bottom: 8`**, unchanged chrome (white `.18` fill) | `rgb(109,108,105)` | **5.26:1** |

Like-for-like — rendered today against rendered after — the shipped state is **better on all three controls**: chevrons **1.98 → 3.64**, past the 3:1 non-text floor they have never met; `⋯` **1.25 → 5.26** with no help at all. Answering Task 4's explicit question — *is `ON_PHOTO_CHROME`'s own fill enough at the new position?* — **no, and it is the larger of the two problems**: the move costs the chevrons 1.98 → 1.59 in scrim, but the white fill costs a further 1.59 → 1.45 on top of it. That is why the fix replaces the fill rather than layering over it, which also keeps the arithmetic single-valued. It also confirms the story's "the `⋯` needs nothing": at 5.26:1 it is clear of the floor.

*The dark-photo case, which Task 4 did not ask for and which a light-photo-only analysis would have shipped unexamined.* Over `#000`, the dark fill sinks the disc into its backdrop — disc-vs-backdrop falls **1.58:1 → 1.03:1** — while the glyph itself improves (13.05:1 → 19.91:1). What delineates the control there is **not the fill in either version**: at 1.58:1 the white one never did the job either. It is `ON_PHOTO_CHROME`'s `rgba(255,255,255,.55)` border, which composites to `rgb(142,142,141)` and reads at **6.26:1** against that backdrop. The border and the white focus ring are kept on the chevrons for exactly that reason, and the shipped state is no worse than today over dark photography on any measure that carries the control.

*Do the three corners still read as one system?* Yes — this was checked because swapping one control's fill invites a polarity split. Over the light photo the chevrons land at `rgb(135,134,131)` and the `⋯` at `rgb(109,108,105)`: two mid-dark discs and one slightly darker, all with white glyphs. Over the dark photo they are `rgb(10,9,7)` and `rgb(17,15,12)`. No corner inverts against the others at any point.

Trap 3 respected: **`HERO_SCRIM` is untouched.** The backing is a local constant in `TripDayView.tsx`, applied to the two chevrons only. `&:hover` is overridden to `rgba(20,18,14,.52)` so the state change stays in the same direction instead of flashing white. **Owed to the operator:** confirm over a real bright photo (sky, snow, sunlit rock) that the two chevrons read as controls and not as smudges. This is the AC the story warns can be "satisfied by accident and look fine".

**AC7 — A missing neighbour still renders nothing.** PASS, automated. Unchanged `previousDay ? … : null` / `nextDay ? … : null`. The pre-existing test *"renders no previous chevron on the first day and no next chevron on the last day"* still passes untouched (it asserts absence three ways). Added *"renders no chevron for a missing neighbour, leaving the overflow alone on the photo (AC1, AC7)"*, which restates it through the hero's control **count** — a disabled button would still render and would pass a test-id check on a differently-named node, but not a count of two.

**AC8 — Gating unchanged.** PASS, automated. `hasDayMenuItems` is **removed** and the `⋯` trigger renders unconditionally (`open={Boolean(dayMenuAnchor)}`), which is the form Trap 4 requires: the menu's first item is ungated, so the menu can never be empty, and gating the trigger would now strand a viewer with no route off the day screen. `dayMenuItemsVisible` keeps its three gated fields exactly as 6.15 left them and back-to-trip is deliberately not among them — it has no gate to mirror.

The `hasDayMenuItems` conjunct on the `Menu`'s `open` prop went with it, and the review corrected the reasoning first recorded here. Dropping it is a behavioural **no-op**, but not because this story made the trigger unconditional: `hasDayMenuItems` was `Object.values({ dayImage, transfers, print: true }).some(Boolean)` with `print` a **literal `true`**, so it was tautologically true for every role and had never suppressed anything. It read as a guard without being one. The detached-`anchorEl` hole it was written for is real and **still open** — `loadDay()` re-enters the loading state with `dayId` unchanged on a transfer submit or an accommodation save, and `notFound` swaps the hero out the same way; neither trips the `dayId`-change reset that clears the anchor. It is pre-existing, this story neither introduces nor worsens it, and it is now recorded as **DW-125** with the actual fix (clear the anchor where the hero unmounts) rather than papered over with a term that never worked. New parameterised test *"leaves %s able to reach both print and the way back to the trip (AC8)"* runs owner/contributor/viewer and asserts each reaches the trigger, back-to-trip (with its href) and print, while move/swap appear for exactly the two editing roles and the day-image edit for the owner alone.

**AC9 — Tab order follows the eye.** PASS, automated. DOM order is previous → next → `⋯`; nothing in the hero carries a `tabindex`, so tab order is DOM order. Asserted as an ordered array identity against the three test ids in the AC1/AC9 test, and again in the AC7 test for both boundary days. This is the class of regression that is invisible in a screenshot — position comes entirely from `top`/`left`/`right`/`bottom`.

**Task 6 left unticked.** Not attempted: no browser, and jsdom has no layout engine. **What the automated suite supports:** AC1, AC2, AC4, AC7, AC8, AC9 in full; AC3 and AC5 as declared-value and non-clipping claims only; AC6 as arithmetic. **What is owed to a human browser pass:** AC3's measured right edges at 390px and 1400px; AC5's "no text under a control" with a 280-character note at both widths; AC6's read over real bright photography.

*Existing tests changed, and why:*
- `"renders the day view page layout for a selected day"` — asserted `getByRole("link", { name: "← Back to trip" })` on the page. The control is no longer on the page at all (a closed MUI Menu is not mounted). Inverted to `queryByRole(… "Back to trip") → not.toBeInTheDocument()`, which is now the stronger claim; the item's presence in the menu is asserted in the 6.19 block.
- `"drops the hero breadcrumb and moves the trip button into the left slot (AC8)"` (Story 6.9) → renamed *"drops the hero breadcrumb, leaving one route back to the trip rather than two (AC8)"*. Its breadcrumb half is untouched and still the point; its left-slot half asserted a container this story deletes, and is replaced by "exactly one back-to-trip menu item".
- `"keeps the trip button in the left slot for a non-owner with no day-image action (AC8)"` → *"gives a non-owner the same single route back to the trip (AC8)"*, for the same reason. It also asserted `justifyContent: "space-between"` on the deleted row.
- `"opens the hero overflow menu to a print link…"` and `"gives a viewer the hero overflow and its print link…"` — both scoped their queries to `day-hero-header-row`. Rescoped to `day-hero`, which is now the enclosing surface and is a *stricter* scope for the "the overflow has not drifted below the hero" claim these were written for.
- `"leaves the hero's right slot holding the overflow alone…"` (6.15) → *"leaves the hero holding the overflow alone…"*: `day-hero-header-right` is gone, so the count is taken over the hero. The fixture is a single-day trip, so this is genuinely "one button on the photo".
- The three 6.15 menu-order tests — `"Back to trip"` prepended to each expected sequence. The viewer test is renamed and its no-divider assertion is kept and re-justified (two items, no group to separate).

### File List

- [`../../travelplan/src/components/features/trips/TripDayView.tsx`](../../travelplan/src/components/features/trips/TripDayView.tsx) — modified: the three controls, the menu item, the deleted header row, the six new constants
- [`../../travelplan/src/i18n/en.ts`](../../travelplan/src/i18n/en.ts) — modified: `trips.dayView.back` loses its arrow glyph
- [`../../travelplan/src/i18n/de.ts`](../../travelplan/src/i18n/de.ts) — modified: the same, in lockstep
- [`../../travelplan/test/tripDayViewLayout.test.tsx`](../../travelplan/test/tripDayViewLayout.test.tsx) — modified: the 6.19 block, plus the eight existing tests the change legitimately invalidated
- [`deferred-work.md`](deferred-work.md) — appended DW-125 and DW-126, both pre-existing and surfaced by this review

### Review Triage Log

### 2026-08-02 — Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 8: (high 0, medium 3, low 5)
- defer: 2: (high 0, medium 1, low 1)
- reject: 6
- addressed_findings:
  - `[medium]` `[patch]` The recorded AC6 arithmetic omitted the button's own fill from every baseline, so "2.41 → 3.64" compared a scrim-only *before* against a fully-composited *after*. AC6's deliverable is the record itself, so both the `HERO_CHEVRON_BACKING` doc block and the Completion Notes were re-derived independently: rendered like-for-like the chevrons go **1.98 → 3.64** and the `⋯` **1.25 → 5.26** (not 8.64). The conclusion survives; the numbers supporting it did not. Also added the dark-photo case the light-photo-only analysis had shipped unexamined — the disc does sink into a dark backdrop (1.58 → 1.03), and it is the `.55` white border at 6.26:1, not the fill, that carries the control there.
  - `[medium]` `[patch]` The AC5 test named *"…alongside all three controls"* used the single-day fixture, which leaves both neighbours null and therefore renders **no chevrons at all** — the two top corners that `HERO_CONTROL_BAND` exists to protect were tested by nothing in the suite. Switched to the three-day fixture on day 2 with the 280-char note, and the assertion is now an ordered identity over all three controls.
  - `[medium]` `[patch]` The diff deleted the `minHeight >= 44` assertion along with the hero button it guarded and put nothing back, leaving `DAY_MENU_ITEM_SX` — a deliberate codebase-wide floor — entirely unasserted. Restored as a loop over every item in the menu, since the floor is the menu's rather than any one item's.
  - `[low]` `[patch]` The comment justifying `open={Boolean(dayMenuAnchor)}` was false in both halves: `hasDayMenuItems` was tautologically true (`print: true`) and had never guarded anything, and the unmount path it dismissed as covered is not covered. Rewritten to say what is actually true and to point at DW-125.
  - `[low]` `[patch]` `HERO_TITLE_RIGHT_CLEARANCE` subtracted two independently-movable constants unclamped; wider inline padding would emit a negative `padding-right`, which is an invalid declaration the parser drops silently, removing the title's clearance with nothing raised and no test able to see it. Clamped at 0.
  - `[low]` `[patch]` `HERO_PADDING_INLINE` was documented as existing to match the panel below the hero, but the panel hardcoded its own copy — the exact drift the diff argues against three constants earlier. The panel now reads the constant.
  - `[low]` `[patch]` The AC3 test asserted `right: 8px` on all three controls without pinning `position: relative` on the hero they resolve against; removing it would destroy AC3 with every assertion still green. Pinned.
  - `[low]` `[patch]` `buildThreeDayResponse(trip)` and `buildDayResponse(day, trip)` took `Record<string, unknown>` first with opposite meanings, so `buildThreeDayResponse({ note })` would compile and silently write the note onto the trip — precisely the call the AC5 fix above needed. Converted to an options object with an explicit `day` channel, identity re-applied after the spread so the three days keep distinct ids.
  - `[low]` `[defer]` DW-125 — the overflow menu can outlive its trigger and anchor to a detached node. Pre-existing; the guard that appeared to cover it never did.
  - `[medium]` `[defer]` DW-126 — a non-404 day fetch error renders no hero and therefore no route back to the trip. Pre-existing, but this story made the hero menu the sole such route.

Rejected, with reasons, so they are not re-raised: (1) *"the three controls now carry two different fills, one near-white and two dark"* — the arithmetic behind it conflated the `⋯`'s bottom position with the chevrons' top one; recomputed, the `⋯` renders `rgb(109,108,105)` against the chevrons' `rgb(135,134,131)`, and no corner inverts against another on either a light or a dark photo. (2) *"the day screen now has zero links to its parent trip"* — true, and it is the trade Tommy asked for; the spec closes it under "The cost, stated once". (3) *"AC2 says the accessible name is kept and the arrow was dropped"* — Task 1 explicitly delegated that decision; the name is unchanged and only a decorative glyph went. (4) *"back-to-trip should be separated from the day-changing items by a divider"* — the spec says "Put it first", and 6.15 owns what the divider means. (5) *"the 60px band is reserved even on a single-day trip that renders no chevrons"* — true and cosmetic; a constant ceiling keeps every hero the same shape, and the degenerate case costs whitespace above a title, not a defect. (6) *"three of nine ACs ship unverified"* — that is the operator pass this story hands over, not a finding.

### Change Log

| Date | Change |
|---|---|
| 2026-08-02 | Implemented Tasks 1–5: back-to-trip moved into the `⋯` menu as its first item; `day-hero-header-row`/`-left`/`-right` deleted; the three controls repositioned to `top-left` / `top-right` / `bottom-right` off one `HERO_CONTROL_INSET`; the title given a real 60px ceiling and a responsive right clearance; a dark local backing added to the chevrons for AC6. |
| 2026-08-02 | Dropped the `← ` glyph from `trips.dayView.back` in both locales; updated the three tests pinning the old name. |
| 2026-08-02 | Review pass: 8 patches applied (AC6 arithmetic re-derived and corrected, AC5 test switched to a three-day fixture, the deleted 44px floor assertion restored, a false `open=` comment rewritten, the derived padding clamped, the panel wired to the shared inline-padding constant, the AC3 containing block pinned, the test-fixture parameter trap removed). 2 pre-existing issues deferred as DW-125 and DW-126. |
| 2026-08-02 | Verification after patches: `npm test` 102 files / **959 passed**; `npx tsc --noEmit` **0 errors in `src/`**; `npx eslint` over the four changed files **0 errors** (7 pre-existing warnings). Task 6 left unticked and handed to the operator. |
- `../../_bmad-output/implementation-artifacts/6-19-day-hero-three-surfaces.md` — this file

No new files. No route, API or schema change, as the story's Project Structure Notes predicted.

### Change Log

- 2026-08-02 — `TripDayView.tsx`: added module-level `HERO_CONTROL_INSET` (8), `HERO_CONTROL_SIZE` (44), `HERO_CONTROL_GAP` (8), `HERO_CONTROL_BAND` (60), `HERO_PADDING_INLINE`, `HERO_TITLE_RIGHT_CLEARANCE` and `HERO_CHEVRON_BACKING`, each with the arithmetic that produced it in its docstring (Trap 5: one shared offset, not a literal in one place and a `theme.spacing` call in another).
- 2026-08-02 — `TripDayView.tsx`: deleted `day-hero-header-row`, `day-hero-header-left`, `day-hero-header-right` and the two comments describing the two-slot row, rather than rewriting them a fourth time (AC4).
- 2026-08-02 — `TripDayView.tsx`: the back-to-trip `Button component={Link}` became the `⋯` menu's first `MenuItem component={Link}`, in-app (no `target`/`rel`) (AC2).
- 2026-08-02 — `TripDayView.tsx`: removed `hasDayMenuItems` and its guard on the menu's `open`; the `⋯` trigger now renders unconditionally, because back-to-trip is ungated and the menu can no longer be empty (AC8, Trap 4). `dayMenuItemsVisible` and `showDayMenuDivider` are otherwise unchanged.
- 2026-08-02 — `TripDayView.tsx`: repositioned all three controls to the corners — prev `top/left: 8`, next `top/right: 8`, `⋯` `bottom/right: 8`, all `zIndex: 3`, all reading `HERO_CONTROL_INSET`; chevrons lost `top: 50%` and `translateY(-50%)`; DOM order set to prev → next → `⋯` (AC1, AC3, AC9).
- 2026-08-02 — `TripDayView.tsx`: hero `padding-top` 22px → 60px (`HERO_CONTROL_BAND`) as the title's ceiling, and `pr: { xs: 44px, md: 28px }` on the title block as its right clearance; padding chosen over `maxHeight`/`overflow` so the date line can never be clipped (AC5).
- 2026-08-02 — `TripDayView.tsx`: added `HERO_CHEVRON_BACKING` (`rgba(20,18,14,.38)` fill, `.52` on hover) to the two chevrons only, restoring 2.41:1 → 3.64:1 over a near-white photo and clearing the 3:1 non-text floor. `HERO_SCRIM` untouched (AC6, Trap 3).
- 2026-08-02 — `i18n/en.ts`, `i18n/de.ts`: dropped the leading "← " from `trips.dayView.back` in both locales, with the reason recorded at the EN entry and cross-referenced from DE.
- 2026-08-02 — `tripDayViewLayout.test.tsx`: added six tests for AC1/AC3/AC5/AC7/AC9, the AC2/AC4 move, the DE label, and a parameterised AC8 role sweep; updated eight existing tests whose scopes or expected strings this story legitimately changed. Suite: 94 passed.

## Auto Run Result

Status: **awaiting-operator** — implemented, reviewed and patched as far as an agent can take it. Task 6 is a browser pass and needs a human.

### What changed

The day hero now carries exactly three interactive controls, one per corner: the previous-day chevron top-left, the next-day chevron top-right, and the `⋯` overflow bottom-right. The "Back to trip" button left the photo and became the first item of the `⋯` menu, and the two-slot header row it lived in was deleted rather than emptied. All three controls are absolutely positioned off a single `HERO_CONTROL_INSET = 8`, which is what makes the `⋯` and the next-day chevron share a right edge at every breakpoint — the misalignment that prompted the story came from the `⋯` inheriting the hero's responsive inline padding instead. The title block, having lost the header row that used to be its ceiling, gets a real one: the hero's top padding becomes the 60px band a corner control claims, and the title takes a responsive right padding so its last line cannot run under the `⋯`. The two chevrons take a dark translucent fill, because moving them to the top corners costs them scrim and the existing white fill was making light-on-light worse.

### Files changed

| File | What |
|---|---|
| [`travelplan/src/components/features/trips/TripDayView.tsx`](../../travelplan/src/components/features/trips/TripDayView.tsx) | The three repositioned controls, the new menu item, the deleted header row and its two stale comments, six derived layout constants, and a local dark backing for the chevrons. |
| [`travelplan/src/i18n/en.ts`](../../travelplan/src/i18n/en.ts) · [`de.ts`](../../travelplan/src/i18n/de.ts) | `trips.dayView.back` drops its `← ` glyph in both locales; the wording, and so the accessible name, is unchanged. |
| [`travelplan/test/tripDayViewLayout.test.tsx`](../../travelplan/test/tripDayViewLayout.test.tsx) | The 6.19 block (control count and order, the relocated menu item, the deleted row, both boundary days, per-role reachability, the 280-char title), plus the eight existing tests this change legitimately invalidated. |
| [`deferred-work.md`](deferred-work.md) | DW-125 and DW-126 appended — both pre-existing, both surfaced by this review. |

### Review findings

8 patches applied (3 medium, 5 low), 2 deferred, 6 rejected. No `intent_gap` and no `bad_spec`, so no spec loopback and no re-derivation. Full detail in the Review Triage Log above; the load-bearing one is that the AC6 contrast baselines had omitted the button's own fill, which made the recorded before/after a comparison between two different models. Re-derived independently: the conclusion holds and the chevrons still clear the 3:1 floor for the first time, but like-for-like the improvement is 1.98 → 3.64, not 2.41 → 3.64, and the `⋯` reads 5.26:1 rather than 8.64:1.

### Verification

| Check | Outcome |
|---|---|
| `npm test` | 102 files, **959 tests, all passed** |
| `npx vitest run test/tripDayViewLayout.test.tsx` | **94 / 94** |
| `npx tsc --noEmit` | **0 errors in `src/`**; the `test/**` diagnostics are pre-existing and unchanged against the stashed baseline |
| `npx eslint` over the four changed files | **0 errors**, 7 warnings, all pre-existing |
| AC6 contrast arithmetic | Recomputed independently of the implementation (sRGB → linear, WCAG 2.x, four-stop scrim interpolation) rather than taken on trust — which is how the baseline error was found |

### Residual risks

- **AC3, AC5 and AC6 are the three ACs this story exists for, and all three are rendered-pixel claims.** jsdom computes no layout and does not resolve MUI's responsive `sx`, so the suite holds their inputs — declared offsets, the un-clipped 280-char title, the arithmetic — and not their output. They are the operator actions below.
- **The 60px ceiling assumes a 44px control at an 8px inset.** It is derived from those constants rather than written as a literal, so it follows them, but a control that grows past 44px without the band following would reopen AC5.
- **Back to the trip is now two taps** and there is no other in-app route to it from this screen (see DW-126 for the error state, where there is none at all). That is the trade the story asked for and is not re-opened here.
