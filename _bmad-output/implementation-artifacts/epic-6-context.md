# Epic 6 Context: Usability Refinements

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Epic 6 is the epic where the product gets fixed by the person actually using it. It does not add capability — it repairs and simplifies the screens that already exist, mostly the day detail and trip overview, mostly as they behave on a phone. Its stories come from three places: earlier planning refinements, the first real production trip, and defects reported from a real German-language phone. The rule that binds them is that the core product model does not change: no new entities, no new endpoints unless a defect requires one, no new gating. What changes is where a control lives, how many controls there are, whether a click target is the whole card or a small corner of it, and whether a typed value survives being saved. Because these refinements touch the most-used surfaces, consistency across them matters more than any individual story's cleverness — a pattern introduced by one story is expected to be adopted by every sibling surface rather than living in one component.

## Stories

- Story 6.1: Remove Trip Overview Header Feedback — REMOVED/SUPERSEDED (historical only)
- Story 6.2: Feedback as Chat — REMOVED (historical only)
- Story 6.3: Optimize Comments — REMOVED (historical only)
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
- Story 6.27: A Comma Is a Decimal Point
- Story 6.28: Coordinates by Hand, and a Choice of Places
- Story 6.29: The Stay's Link on the Day Page
- Story 6.30: One Decimal for a Distance, a Comma in the Box

## Requirements & Constraints

- **Scope discipline.** These are presentation, placement, interaction and defect stories. Several explicitly cover no functional requirement at all. Do not introduce data-model fields, new capability, or new permission behaviour to satisfy a layout story.
- **Comments and voting are discontinued.** The whole feedback feature was removed by product decision. Never reintroduce comment or vote UI, data, or endpoints on any surface this epic touches.
- **Backup/export and restore remain capabilities** but have no trip-overview entry point after the redesign; they are reachable by API only until a new entry point is decided. Do not re-add UI for them here.
- **German is the working UI language**, with English as the second dictionary. Both must stay complete. Copy names the concrete thing (the day, the place, the number) and names outcomes rather than mechanisms — a confirmation's safe answer says what it preserves ("Eintrag behalten"), never "Abbrechen".
- **Phone-first verification.** 390px is the reference narrow width; a story that fixes a phone problem is not done until it is checked at that width. Support target is Chrome (desktop and mobile) and Safari (desktop and iOS). Responsive across desktop, tablet and phone.
- **Accessibility floor** (no formal WCAG level is claimed, and none should be): every interactive element keyboard-reachable and operable with a visible focus state; 44×44px minimum touch target for buttons, inputs, selects, tabs and chips; colour is never the sole signal (pair with icon and short text); every icon-only control carries an accessible name written like the copy around it; decorative icons are `aria-hidden`; photos that carry meaning get real alt text, redundant ones get empty alt; maps are always paired with a text summary.
- **Performance ceiling** is a ~15s p95 trip load — ample headroom, so do not add caching or indirection on suspicion.
- Localised numeric entry is a correctness requirement, not a nicety: a typed value must be saved as the value shown, and an unparseable value must produce a visible, blocking error rather than silently becoming "empty".

## Technical Decisions

- **Stack:** Next.js App Router + TypeScript, SQLite via Prisma, REST route handlers with Zod validation, Redux Toolkit for client state, React Hook Form for forms, TipTap for rich text, Leaflet 1.9.4 for maps, MUI as the component baseline under the project's own light design tokens.
- **Conventions:** DB identifiers `snake_case`, API JSON `camelCase`, dates ISO 8601 UTC, responses always in the `{ data, error }` envelope with stable error codes. Data access goes through the repository layer; the Prisma client is instantiated in exactly one place.
- **One implementation per rule.** This epic's recurring failure mode is a fix that lived in one component and was never propagated. Shared behaviour — decimal parsing, coordinate/place parsing, link safety, time entry, the dialog close control — belongs in one module that every surface calls, with local copies deleted in the same story.
- **Numeric input:** money and distance fields are text inputs with a decimal input mode and a shared comma-aware parser, never `type="number"` — a browser discards a comma before any code can see it. The parser accepts both dot and comma spellings including grouped forms, refuses genuinely ambiguous input rather than guessing, and never rounds or scales a non-money value like kilometres. Field-specific rules (such as a distance's decimal cap) are expressed at the field, not hard-coded into the shared helper. Input rules govern input only; values stored before a rule existed are left alone.
- **Dialogs:** one shared dialog shell owns the title row and its single `✕` close control; form dialogs carry no cancel button, destructive confirmations keep two equally weighted buttons. A dirty form confirms once before discarding; an untouched form closes silently. Tabbed dialogs hold the frame still with a *minimum* (never fixed) height, keep unmounted panels' values and validate their fields anyway, and on a failed save jump to and focus the first tab carrying an error, marking every erroring tab in colour, glyph and accessible name. Saving must never fail silently. A field-to-tab map should fail the build when a new field is added without one.
- **Links:** stored URLs are only rendered as links when the scheme is `http:` or `https:`, on every surface without exception, and external links open in a new tab with `rel="noreferrer noopener"`. Syntax-only URL validation does not establish scheme safety.
- **Uploaded media sits behind authentication** (not under the public static root). Any new media surface inherits that.
- **i18n hygiene:** when a story removes the last reader of a translation key, delete the key from both dictionaries.
- When a story deliberately reverses a rule recorded in the design or experience spine, it updates those documents in the same story rather than leaving the drift behind.

## UX & Interaction Patterns

- **One interaction rule per timeline.** A card is clicked anywhere to edit it — stays and activities alike. An interactive element inside a card (a booking link) must act alone without triggering the card's edit, by pointer and by keyboard, and must still work for a viewer who has no edit overlay at all.
- **Day hero** carries navigation and actions as corner glyph controls on the photo rather than a toolbar row; secondary day actions (print, move, swap) live behind the `⋯` overflow menu; app-level navigation such as the trips link lives in the header menu. Rarely-used trip controls sort to the very bottom on a phone.
- **Timeline vocabulary is fixed:** stay nodes carry a house icon, travel segments a transport icon and no card, and every generic activity gets one uniform neutral marker. There is no activity-type field and none may be invented to support per-type iconography.
- **Photo strips** are uniform, fixed-size, left-aligned, square, centre-cropped and sharp-cornered regardless of the containing card's radius; overflow uses a `+N` control. The fullscreen viewer genuinely fills the screen, pages through that entity's photos, and is keyboard-operable. Document attachments are labelled chips — the name is the content — and open in a new tab rather than the photo viewer.
- **Place lookup** never adopts a result silently: multiple candidates are offered as a ruled list of full display names inside a named group with a live-region count heading, a single candidate may be adopted directly, and activating a row resolves and dismisses in one gesture. All four place-resolving surfaces (trip create start/destination, activity dialog, accommodation dialog, bucket list) behave identically.
- **Stat strips** appear once per screen with short labels; before adding any number, check whether it is already visible on that screen. Warn styling is reserved for gap/open states.
- **Not permitted:** dark mode or a second token set, per-activity-type icons or emoji, comment/voting UI.

## Cross-Story Dependencies

- Story 6.30 depends on Story 6.27, which established the shared decimal parser; Story 6.28 is best sequenced after 6.27 for the same reason.
- Stories 6.24, 6.25 and 6.26 form a dialog-consistency chain: 6.22 tabbed the activity dialog, 6.24 stabilised and thinned it, 6.25 made the close control and the named-safe-answer rule app-wide, and 6.26 applies all of it to the accommodation dialog.
- Story 6.29 relies on the whole-card edit target introduced by Story 6.13, and its link-safety guard must cover the pre-existing unguarded trip-overview render site, not just the new ones.
- Story 6.15 places move/swap into the overflow menu introduced by Story 6.11.
- Story 6.5 depends on the routing/maps integration from the route-and-map epic; Story 6.8's day PDF depends on the day map and travel-segment work from the same epic and must still succeed when map or routing data is unavailable.
- Stories 6.9 onward refine the surfaces produced by the visual-redesign epic and must stay inside its token system rather than reintroducing bespoke styling.
- Contributors can now write to trips they do not own, which raises the stakes on any render-time safety guard or permission assumption these stories touch.
