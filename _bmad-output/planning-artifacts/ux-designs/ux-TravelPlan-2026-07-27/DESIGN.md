---
name: TravelPlan — Reise-Cockpit (Light)
description: A calm, photography-forward "light cockpit" system for TravelPlan — warm paper tones, forest-green structural accents, and a gap-first visual language across trip-planning surfaces.
status: final
updated: 2026-07-30
sources:
  - ../../prd.md
  - ../../epics.md
  - ../../ux-design-specification.md
colors:
  paper-outer: '#EFEAE0'
  paper: '#F7F4EC'
  card: '#FFFFFF'
  card-alt: '#FBF9F4'
  ink: '#2B2A26'
  ink-soft: '#6B675C'
  ink-muted: '#7A7667'
  border: '#E4DFD3'
  border-strong: '#D9D0BE'
  accent: '#4B6358'
  accent-2: '#7C9483'
  accent-soft: '#E7EDE7'
  travel-neutral: '#B9B2A0'
  warn: '#8A5A2B'
  warn-bg: '#F6ECE0'
  warn-bg-row: '#FBF6EE'
  warn-border: '#E3C7A2'
  pill-neutral: '#F1ECE1'
typography:
  fontStack:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif"
  display:
    fontFamily: '{typography.fontStack.fontFamily}'
    fontSize: 28px
    fontWeight: '900'
    letterSpacing: -0.4px
    lineHeight: '1.15'
  heading:
    fontFamily: '{typography.fontStack.fontFamily}'
    fontSize: 21px
    fontWeight: '900'
    letterSpacing: -0.3px
  metric-lg:
    fontFamily: '{typography.fontStack.fontFamily}'
    fontSize: 30px
    fontWeight: '900'
    letterSpacing: -0.5px
  card-title:
    fontFamily: '{typography.fontStack.fontFamily}'
    fontSize: 14.5px
    fontWeight: '700'
  kicker:
    fontFamily: '{typography.fontStack.fontFamily}'
    fontSize: 11px
    fontWeight: '800'
    letterSpacing: 0.14em
  label-caps:
    fontFamily: '{typography.fontStack.fontFamily}'
    fontSize: 10.5px
    fontWeight: '800'
    letterSpacing: 0.08em
  body:
    fontFamily: '{typography.fontStack.fontFamily}'
    fontSize: 13.5px
    fontWeight: '600'
  body-sm:
    fontFamily: '{typography.fontStack.fontFamily}'
    fontSize: 11.5px
    fontWeight: '600'
rounded:
  sm: 4px
  DEFAULT: 6px
  md: 8px
  lg: 10px
  xl: 12px
  full: 9999px
  photo: 0px
spacing:
  unit: 2px
  '1': 4px
  '2': 8px
  '3': 12px
  '4': 16px
  '5': 20px
  '6': 24px
  '7': 32px
  card-padding: 18px
  row-gap: 8px
  section-gap: 22px
  gutter-desktop: 32px
components:
  hero-photo:
    minHeight-trip: 300px
    minHeight-day: 210px
    scrim: 'linear-gradient(to top, rgba(20,18,14,.88) 0%, rgba(20,18,14,.54) 38%, rgba(20,18,14,.10) 66%, rgba(20,18,14,.26) 100%)'
    titleColor: '#FFFFFF'
    titleShadow: '0 2px 14px rgba(0,0,0,.35)'
    chromeBg: 'rgba(255,255,255,.18)'
    chromeBorder: 'rgba(255,255,255,.55)'
  day-row:
    photoSize: 72px
    photoRadius: '{rounded.photo}'
    radius: '{rounded.md}'
    border: '{colors.border-strong}'
    border-gap: '{colors.warn-border}'
    bg-gap: '{colors.warn-bg-row}'
  timeline:
    dotSize-major: 32px
    dotSize-travel: 22px
    neutralMarkerSize: 8px
    lineColor: '{colors.border-strong}'
  tl-card:
    radius: '{rounded.md}'
    border: '{colors.border-strong}'
    bg-stay: '{colors.card-alt}'
    photoStripThumb: 56px
    photoStripRadius: '{rounded.photo}'
  coverage-bar:
    height-full: 16px
    height-mini: 5px
    radius: '{rounded.sm}'
    seg-stay: '{colors.accent}'
    seg-activity: '{colors.accent-2}'
    seg-travel: '{colors.travel-neutral}'
    seg-gap: 'repeating-linear-gradient(45deg, {colors.warn-bg}, {colors.warn-bg} 4px, {colors.warn-border} 4px, {colors.warn-border} 8px)'
  stat-strip:
    cellPadding: '16px 24px'
    valueSize: '21px'
    valueWeight: '900'
    labelStyle: '{typography.label-caps}'
    divider: '{colors.border}'
  card:
    radius: '{rounded.md}'
    border: '{colors.border-strong}'
    padding: '{spacing.card-padding}'
    bg: '{colors.card}'
  badge-pill:
    tl-time-radius: '{rounded.sm}'
    tl-time-bg: '{colors.accent-soft}'
    # Second variant, same geometry: the accent moves from the text to the fill. Story 6.9 - a day
    # activity's cost sits on the card head's one line beside its time pill, and in the soft variant
    # the two read as a pair of time ranges at a glance. Filled, money is money. White on accent
    # measures 6.51:1.
    tl-cost-bg: '{colors.accent}'
    tl-cost-color: '#FFFFFF'
    role-badge-radius: 5px
    gap-badge-bg: '{colors.warn-bg}'
    gap-badge-color: '{colors.warn}'
  photo-strip:
    thumbSize: 56px
    radius: '{rounded.photo}'
    align: 'left'
    fit: 'cover / center'
  doc-chip:
    minHeight: 44px
    radius: '{rounded.sm}'
    bg: '{colors.pill-neutral}'
    glyphSize: 14px
    maxLabelWidth: 160px
    align: 'right (beside photo-strip) / left (wrapped row)'
  trip-row:
    photoSize: 96px
    photoRadius: '{rounded.photo}'
    radius: '{rounded.md}'
    border: '{colors.border-strong}'
    border-gap: '{colors.warn-border}'
    bg-gap: '{colors.warn-bg-row}'
    opacity-past: 0.78
    opacity-past-applies-to: 'photo + row border only - never the row, see Components.trip-row'
  button:
    minHeight: 44px
    radius: '{rounded.DEFAULT}'
    primaryBg: '{colors.accent}'
    primaryColor: '#FFFFFF'
    secondaryBg: '{colors.card}'
    secondaryBorder: '{colors.border-strong}'
  input:
    minHeight: 44px
    radius: '{rounded.DEFAULT}'
    bg: '{colors.card-alt}'
    border: '{colors.border-strong}'
    focusBorder: '{colors.accent}'
    focusRing: 'rgba(75,99,88,.18)'
    errorBorder: '#C97A3E'
    errorBg: '{colors.warn-bg}'
  select:
    minHeight: 44px
    radius: '{rounded.DEFAULT}'
    bg: '{colors.card}'
    border: '{colors.border-strong}'
  tab:
    minHeight: 44px
    radius: '{rounded.DEFAULT}'
    containerBg: '{colors.paper-outer}'
    containerPadding: 4px
    activeShadow: '0 1px 3px rgba(30,28,20,.12)'
  checkbox:
    boxSize: 20px
    boxRadius: 4px
    rowMinHeight: 44px
---

## Brand & Style

TravelPlan reads as a **light travel cockpit**: a calm, paper-toned instrument panel for a trip, not a scrapbook and not a spreadsheet. The direction is a deliberate merge of two rejected extremes explored during discovery — a dark, data-dense "Reise-Cockpit" mood board (too heavy, wrong light mode) and a plain, low-accent "Ruhiger Reisebegleiter" palette (too flat, no personality). What survived is the calm palette and sans-serif restraint of the latter, carrying the structural density — bordered cards, stat strips, a Gantt-style coverage bar — of the former, finished with real trip photography as the emotional anchor instead of any illustrated or gradient stand-in.

The posture is **quietly confident, gap-first, and non-corporate**. Every primary screen answers "what's set and what's still open" before anything else — the coverage bar, the gap badge, and the day-row status pill exist to make that answer visible without a click. Photography is allowed to be full-bleed and slightly imperfect (real crops, real scrims); the surrounding UI chrome stays disciplined, bordered, and typographically quiet. No serif type, no dark mode, no illustration — this system trusts flat color, weight contrast, and one accent hue family to carry the whole product.

**Source mockups** for every token and component in this file: `mockups/trip-overview-day-detail.html` (Trip Overview, Day Detail), `mockups/trips-list-share-login.html` (Trips List, Share Dialog, Login/Register), `mockups/forms-authoring.html` (Trip erstellen, Eintrag hinzufügen, Passwort zurücksetzen, and the Form-Bausteine primitive swatch sheet referenced throughout `Components` below). See `EXPERIENCE.md.Information Architecture` for the full surface-to-mockup map; this spine pair wins on any conflict with the mockups.

## Colors

The palette is warm and low-saturation, built around a single accent family plus one reserved warning hue — nothing decorative, every color earns a job.

- **{colors.paper-outer}** (`#EFEAE0`) is the outermost page background, visible only as the frame around the app surface. **{colors.paper}** (`#F7F4EC`) is the actual app background inside that frame — the two sit one shade apart to give the app a sense of a page laid on a table, without a visible seam or shadow.
- **{colors.card}** (`#FFFFFF`) is the surface for every card, row, tile, and dialog. **{colors.card-alt}** (`#FBF9F4`) is reserved for a small set of "quieter" surfaces: the previous-night/next-night stay tiles in the timeline and similar already-resolved, lower-attention content.
- **{colors.ink}** (`#2B2A26`) is primary text — titles, values, anything that should read as the main content. **{colors.ink-soft}** (`#6B675C`) is secondary text — labels, captions, subtext, breadcrumbs. **{colors.ink-muted}** (`#7A7667`) is tertiary/placeholder-level text (input placeholders, the mock URL bar, axis tick labels) — never used for anything the user must read to act. It was originally `#8A8677`, which measured 3.65:1 on {colors.card}; it was darkened to the lightest value that clears this system's 4.5:1 contrast target (4.55:1 on {colors.card}) while preserving the original's warm-grey channel relationship exactly, so nothing shifts toward a cold grey. 4.5:1 is a *target*, not a conformance claim — see EXPERIENCE.md.Accessibility Floor.
- **{colors.border}** (`#E4DFD3`) is the default hairline divider (topbar rule, stat-strip cell dividers). **{colors.border-strong}** (`#D9D0BE`) is the heavier 1px rule used to frame cards, rows, and tiles — this is the system's only depth cue for most surfaces (see Elevation & Depth).
- **{colors.accent}** (`#4B6358`, muted forest green) is the primary accent: primary buttons, the trip/day title kicker, accommodation ("stay") markers and pills, the dominant segment color in the coverage bar, map "endpoint" pins. **{colors.accent-2}** (`#7C9483`, lighter sage) is strictly secondary — it exists to distinguish "activity" from "stay" wherever both appear together (coverage-bar segments, map waypoint pins) and is never used for a primary action.
- **{colors.travel-neutral}** (`#B9B2A0`) is a deliberately reused neutral gray — first introduced as the breadcrumb separator, then reused as the "travel/transport segment" color in the coverage bar. This reuse is intentional: travel segments are connective tissue, not a destination in themselves, so they get the same visual weight as punctuation, not a third saturated accent.
- **{colors.warn}** / **{colors.warn-bg}** / **{colors.warn-border}** (muted terracotta, `#8A5A2B` / `#F6ECE0` / `#E3C7A2`) is reserved exclusively for the gap/open-item state: missing accommodation, unplanned time, "Handlungsbedarf" alerts, open-item counts. It is never used decoratively or for anything that isn't an actionable gap. **{colors.accent-soft}** (`#E7EDE7`) is the equivalent soft background for accent-colored badges and time pills (the non-warning counterpart to warn-bg).
- The warn family carries **two** background tints, and which one to use is decided by area, not by state. **{colors.warn-bg}** (`#F6ECE0`) is for small elements — status pills, gap badges, error input fills, the coverage-bar gap hatch. **{colors.warn-bg-row}** (`#FBF6EE`) is the weaker tint, used *only* as the whole-row fill on a gap `day-row` or `trip-row`: the same tint that reads as a light wash inside a pill reads as an alarming flood across a 96px-tall row, so the large-area fill steps down. Both mockups paint both row types with the row tint (`mockups/trips-list-share-login.html:173`, `mockups/trip-overview-day-detail.html:322`) and both pill types with the pill tint (`:209`, `:301`, `mockups/forms-authoring.html:865`).
- **{colors.pill-neutral}** (`#F1ECE1`) is the neutral pill track behind the `trip-status` states that are neither a gap nor fully planned — "bevorstehend" (upcoming) and "abgeschlossen" (past). Neither {colors.card-alt} nor {colors.warn-bg} substitutes: the first is a surface tone and disappears against a white row, the second would read the row as a warning.
- **Semantic aliases.** The system has no dedicated error/success/info hues — the four semantic slots the component library needs are aliased onto existing tokens rather than adding a fifth colour family: **error → {components.input.errorBorder}** (`#C97A3E`), **success → {colors.accent}**, **info → {colors.travel-neutral}**, **warning → {colors.warn}**. Two consequences are load-bearing. First, `accent` therefore carries two meanings (primary action *and* success); `accent-2` remains barred from primary actions, and the success *border* is the only place it appears semantically. Second, `{components.input.errorBorder}` is an **edge** colour, never a fill behind white text: white on `#C97A3E` is 3.31:1, so a destructive filled button steps to {colors.warn} `#8A5A2B` (5.87:1) and an inline error line is {colors.warn} too, per the `input` entry below. Nothing in the app renders MUI's stock `#d32f2f`, green or `#0288d1`.

## Typography

Sans-serif only, system stack ({typography.fontStack.fontFamily}) — no serif anywhere in the system. This was an explicit correction during discovery: an earlier direction paired a serif display face with the calm palette, and it was rejected in favor of an entirely sans-serif, weight-driven hierarchy across both screens.

Hierarchy is carried by **font-weight and size**, not by family changes: 900-weight for anything that is the primary answer on screen ({typography.display} trip/page titles, {typography.metric-lg} the big cost figure, stat-strip values), 800-weight for structural labels and kickers (uppercase, tracked 0.08–0.14em — {typography.kicker}, {typography.label-caps}), 700-weight for card/row titles ({typography.card-title}), and 600-weight for everything else (body copy, captions, subtext). Uppercase tracked labels are used only for structural metadata (section labels, stat labels, kickers, badges) — never for sentence-level copy.

All numeric values that appear in a list or need to be compared visually (stat-strip values, cost figures, coverage-axis times) use tabular figures so digits align in a column — this is a hard rule for any new numeric display, not just the ones in the mockups.

## Layout & Spacing

Spacing follows a fine, roughly 2px-atomic rhythm rather than a coarse 8pt grid: most gaps and paddings land on {spacing.1} (4px), {spacing.2} (8px), {spacing.3} (12px), {spacing.4} (16px), {spacing.5} (20px), {spacing.6} (24px), or {spacing.7} (32px), with a handful of larger one-off values for hero padding and page margins. Card interior padding is consistently {spacing.card-padding} (18px); list-row vertical rhythm is {spacing.row-gap} (8px) between rows; the desktop content gutter is {spacing.gutter-desktop} (32px) on the topbar/main-column/side-column.

The primary trip and day screens use a fixed two-column layout: a wider main column (timeline/day-list, ~1.7fr) and a narrower side column (cost card, map, gap alert, bucket list, ~1fr), separated by a single {colors.border} rule rather than a gutter-only split. This is a desktop-first layout; see `EXPERIENCE.md.Foundation` for the responsive stance and its open questions — this design pass did not produce mobile/tablet mockups.

## Elevation & Depth

The system is **flat and bordered by default** — nearly everything (cards, rows, tiles, the stat strip) is separated from its neighbors and background purely by a 1px {colors.border-strong} or {colors.border} rule, with no drop shadow. This keeps the dense, cockpit-like main screens calm and paper-like rather than layered.

Shadow is reserved for genuinely floating/overlay elements only: the browser-chrome mockup frame (`0 20px 50px rgba(30,28,20,.14)`), the share/login modal dialog (`0 24px 60px rgba(30,28,20,.18)`), and the active tab's micro-lift ({components.tab.activeShadow}, shared by `auth-tabs` and the Eintrag-hinzufügen `type-tabs`). If an element sits in the normal document flow — a card, a day-row, a stat cell, a timeline tile — it should never carry a shadow; if it visually detaches from the page (a modal, a popover), it should.

## Shapes

Two corner rules coexist deliberately: **photography is always sharp** ({rounded.photo}, `border-radius: 0`, applied without exception to every `day-photo`, `tl-photo`, and `trip-photo`), while **UI chrome is always soft** — buttons and inputs at {rounded.DEFAULT} (6px), cards/rows/tiles at {rounded.md} (8px), dialogs at {rounded.lg} (10px), circular elements (dots, avatars, the add-to-bucket-list button) at {rounded.full}. This contrast is a considered rule, not an inconsistency: a photo is a found object and is allowed to be a plain rectangle; every container the system itself draws around that photo keeps its own established radius. When adding a new component, decide first whether it *is* photography (radius 0) or *contains* photography (keeps its own card/row radius) — never split the difference.

## Components

- **hero-photo (with scrim)** — Full-bleed real photograph (`background-size: cover; background-position: center`) behind the trip title (Screen A, {components.hero-photo.minHeight-trip}) or day title (Screen B, {components.hero-photo.minHeight-day}) and, on the auth screen, a static marketing panel beside the login/register form. A 4-stop dark-to-transparent scrim ({components.hero-photo.scrim}) sits between photo and text: strongest (0.88 opacity) at the bottom where the title lives, near-transparent through the photo's midsection, and a light fourth stop (~0.26) at the very top to protect breadcrumb/kicker text from unpredictable bright photo content (sky, snow, sunlit rock). The hero shows **title, date/breadcrumb, and one navigation or action button only** — never stats (see Do's and Don'ts).
- **day-row** — Screen A's list unit: a bordered {rounded.md} row with a {components.day-row.photoSize} sharp-cornered day photo on the left, day-tag + title + sub-label in the middle, an accommodation/gap pill on the right, and a full-width mini coverage bar as an implicit fourth row beneath. Gap state swaps border/background to {components.day-row.border-gap}/{components.day-row.bg-gap} and the pill to the warn treatment.
- **tl-card / timeline** — Screen B's vertical day timeline: a continuous {colors.border-strong} line with three dot types — stay dots (house icon, {components.timeline.dotSize-major}), activity dots (one uniform neutral {components.timeline.neutralMarkerSize} solid marker, no icon), and travel-segment dots (car-icon SVG, {components.timeline.dotSize-travel}, no card — label-only row). Stay and activity nodes render as a {rounded.md} `tl-card` (time pill, title, cost, then a bottom media row: a `photo-strip` of 2–4 images leading, `doc-chip`s trailing, wrapping to a second row when the width cannot hold both); travel segments render as a plain icon+text row with no card and no photo.
- **coverage-bar / gantt** — A horizontal, proportionally-segmented bar over the day's clock (08:00–22:00 on Screen B, full version {components.coverage-bar.height-full} with legend + axis; unlabeled mini version {components.coverage-bar.height-mini} per day-row on Screen A). Exactly four segment types, always in this color mapping: stay = {colors.accent}, activity = {colors.accent-2}, travel = {colors.travel-neutral}, gap = a diagonal warn-hatch pattern (never a flat warn fill — the hatch keeps gap distinguishable from "stay" at a glance even at 5px height).
- **stat-strip** — A bordered, evenly-divided row of 3–4 cells (label + big tabular-nums value) directly under the hero photo (or under the coverage panel on Screen B). Used once per screen for the screen's top-line numbers; never duplicated elsewhere on the same screen (see Do's and Don'ts).
- **card** — The generic sidebar/content container: white, {rounded.md}, {colors.border-strong} border, {spacing.card-padding} padding, an uppercase {typography.label-caps} card-label at the top. Used for cost summaries, map previews, the gap alert, the day map, and the bucket list.
- **badge / pill** — Small rounded-{rounded.sm}-to-5px labels: the accent-colored time pill (`tl-time`), the trip/day status pill (`trip-status`, four states: warn "N Tage offen" / "1 Tag offen" for N=1 — correct German number agreement, not a fixed plural (gap), accent "vollständig geplant", neutral "bevorstehend" (upcoming) and "abgeschlossen" (past) — both on the {colors.pill-neutral} track, and both at full opacity even inside a past row — see `trip-row` below and EXPERIENCE.md.State Patterns for the full definition), and the role badge in the share dialog (contributor = filled accent, viewer = accent-soft, owner = warn-toned). Every warn-colored badge always pairs an icon + short text with the color — color is never the sole signal.
- **photo-strip** — 2–4 uniform, fixed-size, left-aligned, center-cropped, sharp-cornered ({rounded.photo}) thumbnails along the bottom of an activity/stay `tl-card`, or a single larger thumbnail as the leading element of a `day-row`/`trip-row`. Thumbnails are never stretched to fill available width — fixed `flex: 0 0 {components.photo-strip.thumbSize}` (56px) for a `tl-card`'s photo strip and the Eintrag-hinzufügen photo-upload preview; the day-row/trip-row leading thumbnail instead uses its own row-specific size ({components.day-row.photoSize} on Screen A, {components.trip-row.photoSize} on Screen C) — never `flex: 1`.
- **doc-chip / doc-row** — A non-image attachment (ticket, booking confirmation) on an activity/stay `tl-card`. A {rounded.sm} chip on the {colors.pill-neutral} track carrying a ~{components.doc-chip.glyphSize} file-type glyph and the document's name, single-line, ellipsised at {components.doc-chip.maxLabelWidth}. **The label is the content.** A `photo-strip` thumbnail identifies itself; a document does not, and three unlabelled squares would force the user to open each one to find the ticket with their own name on it — which is the case this component exists for, since tickets are commonly issued per person. Chips are {components.doc-chip.minHeight} tall, the same 44px floor every interactive element in this system carries: shorter reads as tidier and is the defect Story 5.11's review found on a 32px select. Since 44px is below the 56px photo strip, chips beside photos add no height to the card.

  Chips trail on the same bottom row as the `photo-strip` while the row can hold at least two of them; below that measured threshold the whole group wraps to its own row beneath the photos rather than truncating to one chip. Truncating was rejected: at 390px only one chip fits beside three thumbnails, and one named document out of three is exactly the information the label was added to carry.

  Overflow reuses the `+N` control the photo strip already uses — a second overflow vocabulary in the same row would read as a different kind of thing. It opens a **list of names**, not a viewer: there is nothing to page through, and the name is what the user is choosing between. Activating a chip opens the document in a new tab, including image documents — `FullscreenPhotoViewer` belongs to the trip's photographs, and a ticket is not one.
- **trip-row** — Trips List's (Screen C) row unit: a bordered {rounded.md} row with a {components.trip-row.photoSize} sharp-cornered trip photo on the left (larger than day-row's photo, for the higher-prominence landing surface), trip name + date-range/route sub-label in the middle, a `trip-status` pill (four states — see EXPERIENCE.md.State Patterns) and cost-so-far (tabular figures) trailing. Gap state swaps border/background to {components.trip-row.border-gap}/{components.trip-row.bg-gap}, matching `day-row`'s warn treatment. Past/completed state is the one place in the system where opacity ({components.trip-row.opacity-past}) substitutes for a color-based state change, rather than a warn/accent swap — used because "past" isn't a warning, it's a read-only archival state.

  The multiplier applies to the **trip photo and the row border only — never to the row itself**, so the row's name, sub-line and `trip-status` pill all render at full opacity. A row-level opacity inherits to every descendant, and the two text elements it hits hardest both drop below this system's 4.5:1 contrast target under it: the 12px {colors.ink-soft} sub-line goes 5.65:1 → 3.53:1, and the 11.5px bold "abgeschlossen" pill on {colors.pill-neutral} goes 4.79:1 → 3.11:1 (both the pill fill and its text composite at the multiplier, which is what a group opacity does). Raising the multiplier to its ≈0.90 break-even would make a past row nearly indistinguishable from an active one, and darkening {colors.ink-soft} enough to survive it would repaint every secondary-text surface in the app — so the fade is confined to the two purely decorative carriers. The border fades via a composited color rather than a nested opacity, which would inherit straight back down into the children.
- **auth-tabs** — The Login/Register (Screen E) sign-in/register toggle and the Eintrag-hinzufügen (Screen G) Unterkunft/Aktivität type toggle share one pattern: a {components.tab.containerBg} track with {components.tab.containerPadding} inner padding containing equal-width tabs at {components.tab.minHeight} each; the active tab gets a white fill and {components.tab.activeShadow}; inactive tabs are transparent with {colors.ink-soft} text.
- **button (primary / secondary)** — {components.button.minHeight} tall, {rounded.DEFAULT} radius, from the Form-Bausteine swatch sheet (`mockups/forms-authoring.html`). Primary: filled {components.button.primaryBg}, white text, 800-weight — the single committing action per dialog/screen (Neue Reise, Reise erstellen, Speichern, Einladen, Link zum Zurücksetzen senden). Secondary: {components.button.secondaryBg} fill, {components.button.secondaryBorder} border, 700-weight ink text — **the non-committing half of a pair, used only where both answers must stay visible on equal footing: destructive confirmations.** It is defined by its rank, not by the word on it; its label names the outcome it preserves ("Reise behalten"), never the mechanism ("Abbrechen") — see EXPERIENCE.md.Voice and Tone. A form dialog carries **no** secondary button: its dismissal is `icon-button.close` in the title row, because there the committing action has no consequential opposite worth the same visual weight. This supersedes the earlier rule that paired a secondary with every primary; it changed when the close affordance entered the system. A bare-text action that performs a real, consequential change (Share Dialog's `Entfernen`) is a `button` variant sized to the same {components.button.minHeight} hit area, not an unpadded inline text link — see Do's and Don'ts.
- **icon-button** — A square, label-less control carrying a single glyph. **The system had no entry for this and the implementation had many** — the day-hero overflow `⋯`, the day navigation chevrons, the day-image pencil, the activity dialog's delete — each invented locally with its own sizing. This is the shared definition they should converge on, not a new kind of thing.

  {components.button.minHeight} square (44×44px, the same floor every other interactive element carries), glyph ~20px optically centred, {rounded.DEFAULT} radius. At rest it draws **no fill and no border** when it sits on {colors.card}; on a photo it takes the on-photo chrome instead (see `hero-photo`). Colour is {colors.ink-soft} for dismissive and neutral actions, {colors.ink} for actions that change something, {colors.warn} only where the action is destructive *and* already confirmed elsewhere. Hover and focus follow the Accessibility Floor — the app-wide focus ring, never colour alone.

  **An `icon-button` always carries an accessible name.** The glyph is the affordance; the name is the word the glyph does not say, and it is written per Voice and Tone — "Planpunkt löschen", not "Löschen". A tooltip repeats it for sighted pointer users. An `icon-button` is never the *only* representation of an action a user could not otherwise discover.

  **`close`** — the first documented instance. Top right of a dialog's title row, vertically centred on the title's first line, glyph `✕`, {colors.ink-soft}. It closes without committing: the same outcome the footer's `Abbrechen` used to carry, moved out of the footer and shortened to a glyph. Every dialog has exactly one. See EXPERIENCE.md.State Patterns for what it must do when the form behind it is dirty.

- **input / select** — Text input: {components.input.minHeight} tall, {rounded.DEFAULT} radius, {components.input.border} border, {components.input.bg} background, {colors.ink-muted} placeholder. Three states, all from the Form-Bausteine swatch sheet: default; focus ({components.input.focusBorder} 2px border + `{components.input.focusRing}` outer ring, background lifts to {colors.card}); error (border → {components.input.errorBorder}, a close terracotta variant of {colors.warn-border}, background → {components.input.errorBg}), always paired with an inline error line below in {colors.warn} with a small alert icon — never color alone. Select: same {components.select.minHeight}/radius, {components.select.bg} background, 700-weight value text, trailing chevron.
- **checkbox** — {components.checkbox.boxSize} square visible box ({components.checkbox.boxRadius} radius, {colors.border-strong} border unchecked, {colors.accent} fill + white check glyph checked), inside a {components.checkbox.rowMinHeight}-tall clickable row — the whole row (box + label), not just the box, is the touch target.

### Photo Alt-Text

No formal WCAG target is claimed anywhere in this system (see EXPERIENCE.md.Accessibility Floor), but photography carries real meaning here — which trip, which day, which activity — so alt-text is a floor requirement, not an audit nicety. The mockups render every photo as a CSS `background-image` on a `<div>` (`hero-photo`, `day-photo`, `trip-photo`, `tl-photo`), which has no native alt mechanism at all — implementation must actively choose a text-alternative strategy per photo type, not carry the `<div>` approach forward as-is:

- **Decorative / redundant** — `hero-photo` (trip, day, and login/reset side panels), and the `day-row`/`trip-row` leading thumbnail: the adjacent title text already names the same entity ("Portugal Roadtrip", "Tag 4 — Porto"), so these get an empty alt (`alt=""` / `role="presentation"`) — a screen reader gains nothing from re-announcing them.
- **Meaning-bearing** — `tl-photo`/`photo-strip` images inside a stay/activity `tl-card`, and photo previews in the Eintrag-hinzufügen dialog: nothing else on screen identifies *which* photo of an activity this is, so these need a real alt string — minimally a generated one ("Foto zu {activity title}, Bild {n} von {total}"), with a user-entered caption as a future enhancement, not an MVP blocker.

## Do's and Don'ts

- **Do** keep photography sharp-cornered ({rounded.photo}) always, independent of the radius of the card/row that contains it.
- **Do** reserve {colors.warn}/{colors.warn-bg}/{colors.warn-border} exclusively for gap/open-item states — never as a decorative or "featured" accent.
- **Do** pair every warn-colored signal with an icon and short text label, not color alone (gap pills, gap-alert card, coverage-bar hatch pattern).
- **Do** check, before adding any new stat or number to a screen, whether it already appears elsewhere on that same screen — if so, don't add it again; see `EXPERIENCE.md.Component Patterns` → "redundant-stat removal principle" for the two prior removals this rule is based on.
- **Do** use one uniform neutral marker for every generic day-plan-item ("activity") node in the timeline — see `EXPERIENCE.md.Component Patterns` for the full rationale (no activity-type field exists in the data model, and none should be added just to support iconography).
- **Do** use real product photography with the 4-stop scrim for hero headers, not a CSS-gradient or illustrated placeholder — stress-tested against a real asset (`hero-mountains.jpg`); see `EXPERIENCE.md.Component Patterns` → "hero-photo scrim-strengthening rule" for why the top stop was added.
- **Don't** introduce dark mode, or a second dark-mode token set. A dark, "cockpit" direction was explored early in discovery and explicitly rejected in favor of this light, paper-toned palette — light is the only supported mode.
- **Don't** add per-activity-type icons or emoji to timeline nodes. This was tried (car/plate/wine-glass emoji per activity) and reversed in favor of one neutral marker for the same data-model reason above.
- **Don't** rebuild the budget panel as a progress-bar-with-target-and-remaining widget in these mockups' style. The simplified "Kosten bisher: €X" running-total treatment used here is a **visual-emphasis simplification for this design pass only** — it is not a product decision to remove the payment-schedule/monthly-view feature, which remains in the backlog as-is. Treat this as a display convention for the redesigned surfaces, not a scope change.
- **Don't** show comments or voting UI anywhere in these surfaces. Product direction (flagged separately for backlog processing, outside UX scope) is to remove comments/voting entirely; the mockups already correctly omit it.
- **Do** treat {components.button.minHeight}/{components.input.minHeight}/{components.select.minHeight}/{components.tab.minHeight} (all 44px) as the single, current source of truth for every interactive element's touch target — this supersedes the smaller, unlabeled paddings (~35–40px) present in earlier `direction-merged-light-cockpit` iterations and the original Share Dialog/Login mockup; the Form-Bausteine swatch sheet in `mockups/forms-authoring.html` is the corrected reference. The Share Dialog's `Entfernen` (remove collaborator) action is included in this fix: it now renders as a sized `button` variant, not a bare, unpadded text link.
