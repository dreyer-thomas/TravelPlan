# Epic 6 Context: Usability Refinements

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Epic 6 sharpens the screens that already exist. Every story here is a focused usability fix on shipped functionality — cost attribution that double-counted, photo flows that differed between two surfaces that should feel the same, controls that occupied a toolbar row nobody needed, a fullscreen viewer that never actually filled the screen. Nothing in this epic adds product capability or changes the trip/day/stay/activity model; the value is that the day view and trip overview — the two screens used most, often on a phone — become faster to scan and to operate. A large share of the later stories originated from Tommy's own first production use of the redesigned screens on a real trip, so they encode judgements that only became visible in use rather than defects in earlier work.

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

## Requirements & Constraints

- **Refinement only.** No story here introduces a data model, endpoint, migration, or permission change. Where a story touches a surface, everything else on that surface — timeline, coverage bar, travel segments, stays, bucket list, map panel, cost roll-up, print export — must behave exactly as before. Regression protection is a first-class acceptance concern, not an afterthought.
- **Comments and voting are gone from the product.** The feedback data model, API routes, UI, and i18n strings were deleted. Do not reintroduce, reference, or restore any of it; treat the three removed stories above as historical record only.
- **Role gating is unchanged.** Editing affordances follow the existing planning-rights check: a viewer or contributor without planning rights must get no click target, no cursor change, no hover treatment and no edit glyph — a non-editable surface must not look actionable. Read-only actions (notably printing/export) stay available to every role that can open the day, so they must not be placed behind an owner-only guard.
- **Bilingual and responsive throughout.** Every new or moved control must be understandable in both German and English and usable on both desktop and phone. Any UI string removed by a story is removed from both dictionaries, along with assertions that pin it.
- **Accessibility floor.** Visible focus states on all interactive elements, full keyboard operability, touch targets ≥44×44px, meaningful accessible names, and no meaning carried by color alone. Text contrast targets 4.5:1. This is a floor the epic must hold, not a formal conformance claim.
- **Offline durability for the day export.** A generated PDF must remain usable with no network: no dependence on live application data or map requests after generation, readable in grayscale on a standard office printer, A4-optimized, one page where practical and at most two for normal usage, with long content compacted rather than overflowing.

## Technical Decisions

- **Design tokens are the source of truth.** Colors, radii, pill geometry, card treatment, and on-photo chrome come from the approved design system rather than component-local literals. When a story needs a variant that does not yet exist (e.g. a filled metadata pill alongside the existing soft one), the variant is recorded in the design system so the next screen reuses it instead of inventing one.
- **Whole-card click targets use a stretched `<button>` overlay**, not `role="button"` on the card. ARIA gives `button` *Children Presentational: True*, which would collapse a card's title, notes and pills into a single announced label. Content is made pointer-transparent while nested links and buttons stay above the overlay, so an inner action (open link, copy previous night, photo thumbnail) does its own thing rather than opening the editor.
- **Editability must be signalled without a button.** On pointer devices: cursor, low-contrast background shift, border move to accent, and a fade-in edit glyph. Under `@media (hover: none)`: the same glyph permanently visible at low emphasis. The glyph is decoration only — `aria-hidden`, never a control — so no extra tab stop is reintroduced. No custom cursor images.
- **Cost attribution is owned by the day that owns the stay.** A previous-night accommodation may remain visible for timeline context but must not contribute to the following day's cost list or total.
- **Google Maps route import degrades gracefully.** When automatic retrieval of duration/distance is unavailable or the adjacent items lack location data, the manual directions link/button remains and no incorrect values are prefilled.
- **Moving or swapping activities never touches accommodations.** Stays stay attached to their original day. Same-day source/target is blocked with validation; a move that would overwrite a populated target day requires explicit confirmation.
- **The fullscreen photo viewer is one shared component.** All inline copies are deleted and call sites hand it a collection plus a starting index rather than a single URL. Exactly one darkened surface covers the screen (do not stack a custom fill over MUI's own backdrop), and `100vw` is not used for it because it includes the scrollbar width. Only Escape closes; arrows page; focus is trapped while open and returns to the originating thumbnail on close; alt text travels with the current image.
- **Thumbnail strips must be operable.** Thumbnails carrying click handlers need role, tab index, key handling, visible focus and an accessible name — in both the mini strip and the shared photo upload field, since the latter serves three surfaces. Paging is what makes images beyond the strip's visible thumbnails reachable at all, including via the "+N" indicator.
- **The global header menu stays global.** Day-scoped actions such as print live in the day page's own overflow menu, built from the same menu treatment so the two read as one idiom; the shared auth-driven menu is not made context-aware. New-tab links keep `target="_blank"` with `rel="noopener noreferrer"`, and the menu closes on selection.
- **Layout blocks belong inside the layout grid.** A block that belongs to the trip's content column is placed in that column and inherits its padding, rather than being appended after the grid and constrained with its own width or margin.

## UX & Interaction Patterns

- **One interaction rule per timeline.** Activity cards, previous-night stay cards and current-night stay cards all open their editor by clicking the card. Per-card pencil buttons and the toolbar-level stay edit button are removed; an empty stay card is the way to add a stay, with an accessible name that says whether it adds or edits.
- **Metadata reads as one family.** Time and cost sit together in the card head, right-aligned, using the same pill geometry with the cost filled in accent and white text so the two are distinguishable at a glance — and distinguishable from a primary button, which shares the fill.
- **The hero carries navigation.** Previous/next become chevrons inside the day photo, one per side, vertically centred, using the established on-photo chrome treatment with its white focus ring. At the first or last day the chevron is not rendered at all — no disabled control, nothing focusable left in its place. The toolbar row they vacate is deleted, not left empty.
- **Headers carry less.** The day header drops the breadcrumb (the day title below the hero already names the day) and splits its controls across the row, with a comfortably sized "back to trip" on the left. Redundant labels go: the coverage bar reads from its own segments and legend, and a single day's cost card says "costs today" rather than borrowing the trip-level "so far · today" construction.
- **Photo management is consistent.** Day-item photo handling matches the accommodation flow: same multi-file selection, same compact thumbnail-and-action presentation, same enlarged preview.
- **The day export mirrors the day.** Chronological order from the day-start accommodation through activities and travel segments to the end stay, compact image thumbnails, and a map section matching the timeline's sequence — falling back to a placeholder without failing the export when maps or routing are unavailable.

## Cross-Story Dependencies

- **6.9 and 6.11 both restructure the day header** — 6.9 removes the breadcrumb and moves "back to trip" left, 6.11 adds hero chevrons and a header overflow menu. They must be sequenced, never run in parallel.
- **6.13 depends on 6.9.** It reuses the card hover treatment, overlay content handling, accessible-name helper and stretched-button overlay that 6.9 built and verified; without 6.9 those primitives do not exist.
- **6.12 closes two standing deferred-work entries** covering keyboard-inoperable thumbnails in the mini image strip and in the shared photo upload field, plus the strip's unreachable overflow images.
- **6.10 completes a placement pattern** already applied to the bucket-list card by the visual-redesign epic: content-column blocks rendered after the grid get moved into it. It must not collide with that card — left column ends with trip controls, right column ends with the gap alert.
- **The day print/export route from 6.8 is a prerequisite for 6.11**, which relocates its only entry point.
- **Epic 6 refines screens delivered by the visual redesign epic.** Token names, card treatments and on-photo chrome established there are inputs here; where Epic 6 adds a variant, it is recorded back into the design system.
