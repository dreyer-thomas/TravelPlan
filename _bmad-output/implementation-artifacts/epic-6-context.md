# Epic 6 Context: Usability Refinements

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Epic 6 sharpens screens that already work. It carries no new product capability: every story fixes a defect, relocates a control, or makes an existing interaction consistent with one already established elsewhere in the app. Its source of truth is production use — Tommy planning a real trip, mostly on a phone — rather than a mockup comparison, so the recurring themes are phone ergonomics (fewer wrapping toolbars, operable inputs, one long form split into tabs), one interaction rule per card kind instead of three, and correctness in the places where the visible number turned out to be wrong. The bar for a story here is that everything else on the screen keeps behaving exactly as before.

## Stories

- Story 6.1: Remove Trip Overview Header Feedback — REMOVED/SUPERSEDED (feedback system discontinued)
- Story 6.2: Feedback as Chat — REMOVED (feedback system discontinued)
- Story 6.3: Optimize Comments — REMOVED (feedback system discontinued)
- Story 6.4: Fix Day View Accommodation Cost Duplication
- Story 6.5: Auto-Fill Travel Segments From Google Maps
- Story 6.6: Match Day Item Photo UX to Accommodations
- Story 6.7: Move or Swap Day Activities Between Dates
- Story 6.8: Export Day Itinerary PDF for Offline Use
- Story 6.9: Day Detail Refinements From First Production Use
- Story 6.10: Trip Overview Refinements From First Production Use
- Story 6.11: Day Navigation as Hero Chevrons, Print Into the Header Menu
- Story 6.12: One Fullscreen Photo Viewer — Coverage, Paging, Keyboard Access
- Story 6.13: Accommodation Cards Editable Like Activities
- Story 6.14: Trip Controls Last on a Phone
- Story 6.15: Move and Swap Into the Day Overflow Menu
- Story 6.16: Walking and Cycling as Travel Modes
- Story 6.17: Travel Segment Dialog on a Phone
- Story 6.18: One Way to Enter a Time
- Story 6.19: Three Surfaces on the Day Hero
- Story 6.20: The Trips Link Moves Into the Header Menu
- Story 6.21: Shorter Labels on the Day Stat Strip
- Story 6.22: The Activity Dialog in Tabs
- Story 6.23: Move a Single Activity to Another Day
- Story 6.24: A Calmer Activity Dialog
- Story 6.25: Close Is a Cross, and Keeping Is Named
- Story 6.26: The Accommodation Dialog in Tabs
- Story 6.27: A Comma Is a Decimal Point — story spec exists, but the epics file has no entry for it
- Story 6.28: Coordinates by Hand, and a Choice of Places
- Story 6.29: The Stay's Link on the Day Page

## Requirements & Constraints

- **Presentation-only is the default contract.** Most stories declare that they relocate, relabel, or restyle and change nothing else. Every acceptance set ends with a "none of it changes" clause covering the timeline, coverage bar, travel segments, stays, bucket list, map panel, cost roll-up and print export. Treat any behavioural side effect as a regression.
- **The comments/voting feature is discontinued.** No comment or vote UI may be reintroduced on any surface. Stories 6.1–6.3 are historical record only.
- **Role gating is never widened by a refinement.** Editing affordances follow the existing planning-rights check; a non-editable surface must not look actionable (no cursor, hover, glyph or overlay). Read actions such as print stay available to every role that can open the day.
- **Bilingual parity is enforced.** Every user-facing string exists in both dictionaries, and key parity is asserted by test. When a story removes a label, the key is deleted from both dictionaries and any assertion pinning it is updated — orphaned keys are a defect.
- **Phone-first success criteria.** Several stories name 390px as the width where the problem is real: no wrapping control rows, no horizontal scrollbar, no label wrapping mid-word, no control rendered over title text.
- **Keyboard and touch floor.** Every interactive element is reachable and operable by keyboard with a visible focus state and an accessible name; touch targets are ≥44×44px. Color is never the sole signal.
- **Layout numbers are measured, not derived.** This project's history is explicit that guessed layout arithmetic does not survive a browser; heights and thresholds are established by a browser pass and recorded.
- **Additive schema changes only.** Where a story touches the data model, existing rows keep their current values, the stored/validated format is unchanged where possible, and backup export/import must round-trip the new values.

## Technical Decisions

- **Design authority.** The visual system is the Light Cockpit spine (`DESIGN.md` / `EXPERIENCE.md` under `_bmad-output/planning-artifacts/ux-designs/ux-TravelPlan-2026-07-27/`), which supersedes the older `ux-design-specification.md` palette and typography for anything Epic 6 touches. Light mode only; flat and bordered rather than shadowed; photography sharp-cornered, UI chrome rounded; a single accent family with warn reserved exclusively for gaps and open items. When a story establishes a new variant (a filled pill, an icon-button, a close control), `DESIGN.md` is updated with it rather than the variant living only in code.
- **Hover, focus, active and pressed states are unspecified by the mockups on purpose.** Implementation authors them from existing tokens, following the precedent already set by whole-row click targets in the app.
- **Whole-card click targets use a stretched `<button>` overlay, not `role="button"` on the card.** ARIA's *Children Presentational: True* would collapse a card's title, notes and pills into one announced label. Content is `pointerEvents: none` with links and buttons lifted above the overlay so nested actions keep their own behaviour.
- **Page-local overflow menus, not the global header menu.** The global auth menu is built from auth state alone and knows nothing about a trip or a day, so day-scoped actions (print, move, swap, day-image edit) live in the day page's own `⋯` menu built from the same menu treatment. A menu that would render no items must not render its trigger.
- **Shared primitives over inlined copies.** Where a behaviour is duplicated across components (the fullscreen photo viewer, place/coordinate parsing, time input), consolidate into one owner and delete the copies; parsing logic lives in exactly one module, never re-implemented in a component.
- **Tabbed dialogs must not weaken validation.** React Hook Form skips rules for fields whose panel is unmounted while keeping their values, so a tabbed dialog validates every field regardless of the active tab, switches to the first tab carrying an error, focuses it, and marks every erroring tab in colour, glyph and accessible name. The error-key-to-tab map is exhaustive at compile time so a later field fails the build rather than silently losing its marker.
- **Dialog frames are stabilised with a minimum height, never a fixed one** — MUI centres the dialog, so a panel height swing moves the tab bar under the user's cursor.
- **Input controls model what they hold.** A time of day uses the native time control; a duration does not, because a clock control would reinterpret `01:30` as half past one. Numeric entry accepts the German comma rather than silently discarding it — ambiguity is refused with a message naming the accepted spelling, never resolved by guessing.
- **Link rendering is scheme-guarded.** URL-syntax validation alone accepts `javascript:` and `data:`; only `http:`/`https:` may render as a link, guarded at render on every surface, with external links opening in a new tab with `rel="noopener noreferrer"`.
- **Deleting or moving an item cleans up what referenced it.** Travel segments that reference a removed or relocated activity are removed and the user is told; no segment is ever invented on arrival, because transport mode and duration are the user's knowledge.

## UX & Interaction Patterns

- **One interaction rule for timeline cards.** Activity, previous-night stay and current-night stay cards all open their editor by clicking the card. No card in the timeline carries a visible edit button; the section header keeps only the action that creates what the section lists.
- **Editability must be visible without a button.** A pointer device gets a hover treatment plus an edit glyph that fades in at the card's top-right; under `@media (hover: none)` the same glyph is permanently visible at low emphasis. The glyph is decoration (`aria-hidden`), never a nested control.
- **The day hero carries controls in its corners** — previous/next chevrons and the page-local `⋯` — using the on-photo chrome treatment so they stay legible over arbitrary user photography. An unavailable chevron is not rendered at all rather than rendered disabled, so nothing focusable remains in its place.
- **Dismissal is a close glyph in the dialog title row, not a footer cancel button.** Form dialogs carry no secondary cancel; destructive confirmations keep two buttons and name the safe answer by its outcome ("keep this trip") rather than by its mechanism. A dirty form confirms once before discarding; an untouched form closes silently.
- **The fullscreen photo viewer is one darkened surface** covering the viewport (not `100vw`, which includes the scrollbar), pages through the whole collection with the position stated, closes only on Escape, keeps focus trapped while open and returns it to the thumbnail that opened it.
- **Place selection presents alternatives.** A search that matches several candidates offers a choice rather than adopting the first result silently.
- **Labels are short and concrete.** Helper prose that explains a field is removed rather than shortened where the field explains itself; error text names what went wrong in concrete terms.

## Cross-Story Dependencies

- **6.9 → 6.13 → 6.15.** 6.9 builds the click-to-edit card pattern (overlay, hover treatment, capped accessible name) for activities; 6.13 reuses it for both stay cards and removes their buttons; 6.15 then finds the timeline header reduced enough to move the remaining move/swap actions into the menu.
- **6.9 and 6.11 both restructure the day hero header** — sequence them, do not run them in parallel.
- **6.11 → 6.15 → 6.19.** 6.11 creates the day page's `⋯` overflow; 6.15 extends it with move, swap and the day-image edit; 6.19 adds the back-to-trip action as its first item and settles the hero's three-corner layout.
- **6.10 → 6.14.** 6.10 moves the trip-controls card into the grid's left column for desktop alignment; 6.14 then fixes the single-column order that change produced. 6.10's test asserting the card's position must be updated deliberately, not deleted.
- **6.22 → 6.24 → 6.26.** The activity dialog is tabbed, then stabilised and its footer reduced; the accommodation dialog follows the same pattern and inherits the frame-height and validation decisions.
- **6.25 is a precondition for the dialog work** — it establishes the close-glyph pattern and the dirty-form confirmation that 6.24 and 6.26 rely on, and it updates `DESIGN.md`/`EXPERIENCE.md` to match.
- **6.27 → 6.28.** 6.28 prefers to land after 6.27, which establishes the decimal-comma parsing rule it reuses for coordinates. Note 6.27 has a story spec but no entry in the epics file.
- **6.13 → 6.29.** 6.29 adds stay booking links to cards whose whole surface became the edit target in 6.13, so the link must escape the overlay for both pointer and keyboard.
- **6.16 depends on the backup format** established by the trip export/import stories, whose schema is bound to the transport-type enum.
- **6.12 closes two deferred-work entries by name** (the keyboard-inoperable thumbnails in the mini image strip and in the shared photo upload field), so both components are in scope, not one.
