# Epic 6 Context: Usability Refinements

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Epic 6 sharpens screens that already exist. Every story is a focused usability fix on shipped functionality — cost attribution that double-counted, photo flows that differed between two surfaces that should feel the same, control rows that ate a band of chrome, a fullscreen viewer that never filled the screen, a time field that could not be typed on a phone. Almost nothing here adds product capability or changes the trip/day/stay/activity model; the value is that the day view and trip overview — the two screens used most, usually on a phone — become faster to scan and easier to operate. A large share of the later stories came out of first production use of the redesigned screens on a real trip, so they encode judgements that only became visible in use rather than defects in earlier work.

## Stories

- Story 6.1: Remove Trip Overview Header Feedback — **REMOVED** (feedback system discontinued)
- Story 6.2: Feedback as Chat — **REMOVED**
- Story 6.3: Optimize Comments — **REMOVED**
- Story 6.4: Fix Day View Accommodation Cost Duplication
- Story 6.5: Auto-Fill Travel Segments From Google Maps
- Story 6.6: Match Day Item Photo UX to Accommodations
- Story 6.7: Move or Swap Day Activities Between Dates
- Story 6.8: Export Day Itinerary PDF for Offline Use
- Story 6.9: Day Detail Refinements From First Production Use
- Story 6.10: Trip Overview Refinements From First Production Use
- Story 6.11: Day Navigation as Hero Chevrons, Print Into the Header Menu
- Story 6.12: One Fullscreen Photo Viewer — Correct Coverage, Paging, Keyboard Access
- Story 6.13: Accommodation Cards Editable Like Activities
- Story 6.14: Trip Controls Last on a Phone
- Story 6.15: Move and Swap Into the Day Overflow Menu
- Story 6.16: Walking and Cycling as Travel Modes
- Story 6.17: Travel Segment Dialog on a Phone
- Story 6.18: One Way to Enter a Time
- Story 6.19: Three Surfaces on the Day Hero
- Story 6.20: The Trips Link Moves Into the Header Menu
- Story 6.21: Shorter Labels on the Day Stat Strip

## Requirements & Constraints

- **Refinement first.** With one exception, no story introduces a data model, endpoint, migration, or permission change; a story touching a surface must leave everything else on it — timeline, coverage bar, travel segments, stays, bucket list, map panel, cost roll-up, print export — behaving exactly as before. Regression protection is a first-class acceptance concern.
- **The one exception is the travel-mode extension.** Adding walking and cycling widens a database-backed enum, so it needs a migration and must be strictly additive: existing rows keep their type, and the values must round-trip through the backup export/import format, which is bound to that enum.
- **Comments and voting are gone from the product.** The feedback data model, API routes, UI, and strings were deleted. Do not reintroduce or reference any of it; the three removed stories are historical record only.
- **Role gating is unchanged.** Editing affordances follow the existing planning-rights check: a viewer or contributor without planning rights gets no click target, no cursor change, no hover treatment, no edit glyph — a non-editable surface must not look actionable. Read actions (notably print/export) stay available to every role that can open the day and must not sit behind an owner-only guard. Where one menu mixes gating levels, each item renders only for a role the server would accept.
- **Bilingual and responsive throughout.** Every new or moved control must read well in German and English and work on desktop and phone; 390px is the reference phone width. Key parity between the two dictionaries is enforced by test, so any string removed by a story is removed from both, along with assertions pinning it, and no key is left orphaned or misleadingly named.
- **Accessibility floor.** Visible focus states, full keyboard operability, touch targets ≥44×44px, meaningful accessible names, no meaning carried by colour alone, text contrast targeting 4.5:1. A floor to hold, not a formal conformance claim.
- **Offline durability for the day export.** A generated PDF must survive with no network: no dependence on live application data or map requests after generation, readable in grayscale on a standard office printer, A4-optimized, one page where practical and at most two for normal use, long content compacted rather than overflowing.

## Technical Decisions

- **Design tokens are the source of truth.** Colours, radii, pill geometry, card treatment, on-photo chrome and scrims come from the approved design system rather than component-local literals. A variant that does not yet exist (e.g. a filled metadata pill alongside the soft one) is recorded back into the design system so the next screen reuses it.
- **Whole-card click targets use a stretched `<button>` overlay**, never `role="button"` on the card — ARIA's *Children Presentational: True* would collapse a card's title, notes and pills into one announced label. Card content is pointer-transparent while nested links and buttons stay above the overlay, so an inner action (open link, copy previous night, photo thumbnail) does its own thing instead of opening the editor.
- **Editability is signalled without a button.** Pointer devices get cursor, low-contrast background shift, border move to accent, and a fade-in edit glyph; under `@media (hover: none)` the same glyph is permanently visible at low emphasis. The glyph is decoration only — `aria-hidden`, never a control — so no extra tab stop returns. No custom cursor images.
- **Cost attribution belongs to the day that owns the stay.** A previous-night accommodation may stay visible for context but must not feed the following day's cost list or total.
- **Google Maps route import degrades gracefully.** When automatic duration/distance retrieval is unsupported for a mode, unavailable, or the adjacent items lack location data, the manual directions link remains and no incorrect values are prefilled. Car, walking and cycling import from Google's corresponding travel modes; ship and flight stay manual, and helper text names what does import rather than claiming car-only.
- **Move and swap never touch accommodations.** Stays remain attached to their original day. Same-day source/target is blocked with validation; a move that would overwrite a populated target requires explicit confirmation.
- **One fullscreen photo viewer.** Inline copies are deleted; call sites pass a collection plus a starting index, not a single URL. Exactly one darkened surface covers the screen (do not stack a custom fill over MUI's backdrop) and `100vw` is not used for it because it includes the scrollbar. Escape closes, arrows page, focus is trapped and returns to the originating thumbnail, alt text travels with the current image.
- **Thumbnail strips must be operable.** Any thumbnail carrying a click handler needs role, tab index, key handling, visible focus and an accessible name — in the mini strip and in the shared photo upload field, which serves three surfaces. Paging is what makes images beyond the visible thumbnails, including behind the "+N" indicator, reachable at all.
- **The global header menu stays auth-driven.** It is built from auth state alone and is not made trip- or day-aware; day-scoped actions live in the day page's own overflow menu, built from the same menu treatment so the two read as one idiom. A global entry to the trips list is legitimate because it depends only on being signed in. New-tab links keep `target="_blank"` with `rel="noopener noreferrer"`, menus close on selection, an overflow trigger that would open an empty menu is not rendered at all, and a link must never wrap a button.
- **One time-entry mechanism.** Every time-of-day field uses the native time control so phones offer their own picker; a numeric keypad on a `HH:mm` field is a defect because those keyboards have no colon. A duration is not a clock time and must not use the time control — it needs separate hours/minutes or an explicit minutes field. Stored and validated formats, defaults and validation messages are unchanged: this is how a value is entered, not what is accepted.
- **Layout blocks belong inside the layout grid.** A block in the trip's content column is placed in that column and inherits its padding rather than being appended after the grid with its own width or margin. Reordering across breakpoints must be structural — a CSS `order` cannot lift a nested card past its own column, and rendering the block twice with one copy hidden is not acceptable because it duplicates controls for assistive technology.

## UX & Interaction Patterns

- **One interaction rule per timeline.** Activity cards and both stay cards open their editor by clicking the card. Per-card pencils and the toolbar-level stay button are removed; an empty stay card is the way to add a stay, with an accessible name saying whether it adds or edits.
- **Metadata reads as one family.** Time and cost sit together in the card head, right-aligned, same pill geometry, the cost filled in accent with white text so the two are distinguishable at a glance — and from a primary button, which shares the fill.
- **The day hero carries the navigation and the actions.** Previous/next are chevrons on the photo using the established on-photo chrome and its white focus ring; at the first or last day the chevron is not rendered at all — no disabled control, nothing focusable in its place. The hero settles on exactly three controls in three corners (previous top-left, next top-right, `⋯` bottom-right), their edges aligned to each other, with the title block free of overlap. The header row and the old toolbar row are deleted rather than left as empty containers.
- **The `⋯` overflow is the day's action drawer.** Print, back-to-trip, move, swap and the day-image edit action collect there, grouped so the transfer actions stay adjacent and a read action does not sit between two write actions.
- **Headers and labels carry less.** The day header drops its breadcrumb (the day title already names the day); the trip overview drops the breadcrumb back to the trips list, though "not found" recovery panels keep their own button since a menu is not a recovery path. Redundant labels go: the coverage bar reads from its segments and legend, a single day's cost card says "costs today", the stat strip uses short fixed labels so a long stay name cannot make a grid row tall, and the travel dialog trades prose for short instructions.
- **Photo management is consistent.** Day-item photo handling matches the accommodation flow: same multi-file selection, same compact thumbnail-and-action presentation, same enlarged preview.
- **Rarely-used controls come last on a phone.** Where a single column makes DOM order the visual order, trip edit/delete sit after the information cards rather than between the day list and them.
- **The day export mirrors the day.** Chronological from the day-start stay through activities and travel segments to the end stay, compact image thumbnails, and a map section matching the timeline order — falling back to a placeholder instead of failing when maps or routing are unavailable.

## Cross-Story Dependencies

- **6.9 and 6.11 both restructure the day header** and must be sequenced, never run in parallel.
- **6.13 depends on 6.9** for the card hover treatment, overlay content handling, accessible-name helper and stretched-button overlay it reuses.
- **6.11 builds the day-local `⋯` overflow that 6.15 and 6.19 extend** — no second menu is introduced by either. 6.15 also depends on 6.13 having already removed the stay button from the timeline header; together they leave that header with its label and "+ Aktivität" alone.
- **The day print/export route from 6.8 is a prerequisite for 6.11**, which relocates its only entry point.
- **6.14 follows 6.10**, which moved the trip-controls card into the grid's left column; 6.14 reorders it below `md` only and must deliberately update 6.10's test asserting the card is a descendant of that column.
- **6.10 completes a placement pattern** the visual-redesign epic applied to the bucket-list card, and must not collide with it: left column ends with trip controls, right column with the gap alert.
- **6.16 touches the backup format** established by the export/import stories in the core-planning epic; a backup containing the new travel modes must import cleanly.
- **6.12 closes two standing deferred-work entries** on keyboard-inoperable thumbnails in the mini image strip and the shared photo upload field, plus the strip's unreachable overflow images.
- **Epic 6 refines screens delivered by the visual-redesign epic.** Token names, card treatments and on-photo chrome from there are inputs here; variants Epic 6 adds are recorded back into the design system.
