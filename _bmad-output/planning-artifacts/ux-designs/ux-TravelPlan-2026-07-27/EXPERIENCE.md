---
name: TravelPlan — Reise-Cockpit (Light)
status: final
sources:
  - ../../prd.md
  - ../../epics.md
  - ../../ux-design-specification.md
updated: 2026-07-30
---

# TravelPlan — Experience Spine

> Companion to `DESIGN.md` (same directory). This spine covers behavior, information architecture, voice, and flows; visual tokens (color, type, radius, spacing) are defined once in `DESIGN.md` and referenced here by `{path.to.token}`.

## Foundation

Web app, single product surface (no native apps). Per PRD (`sources[0]`, Project-Type Requirements): a responsive SPA targeting Chrome and Safari, desktop **and** mobile/tablet, desktop-first — "planning is desktop-first (keyboard and large-screen clarity), while mobile/tablet is optimized for quick reference and light edits during the trip" (`ux-design-specification.md`, superseded but consistent on this point).

This design pass mocked **desktop only** (fixed ~1080px browser-frame compositions for all nine surfaces). No mobile/tablet breakpoint, stacking behavior, or touch-specific layout was produced or approved in this pass — responsive behavior below desktop is inherited scope from the PRD but not yet specified by mockup. Flagged as an open gap for implementation/next design pass, not silently assumed.

No third-party UI system is named as inherited in this spine. The prior (superseded) spec named Material UI as the baseline component library; nothing in the discovery log revoked that as the underlying implementation library, but nothing in this pass confirms it either — the mockups are hand-built HTML/CSS, not MUI markup. Treat MUI-as-implementation-substrate as unconfirmed; `DESIGN.md` tokens are the source of truth for the rendered result regardless of which component library implements them.

All visual values (color, type, radius, spacing, shadow) live in `DESIGN.md`; this document specifies structure and behavior only.

## Information Architecture

| Surface | Reached from | Purpose |
|---|---|---|
| Trip Overview (Screen A) | Trips List row tap; default landing after opening a trip | Whole-trip status at a glance: hero, top-line stats, day-by-day list with per-day coverage, cost summary, route map, gap alert |
| Day Detail (Screen B) | Trip Overview day-row tap | One day in full: day-coverage Gantt bar, day stats, chronological timeline (previous-night checkout → activities/travel → check-in), day cost, day map, bucket list |
| Trips List (Screen C) | App landing after login | All of a user's trips as rows (status pill, cost-so-far, thumbnail); entry point to create a new trip |
| Share Dialog (Screen D) | "Reise teilen" action on Trip Overview | Modal — invite by email + role, manage existing collaborators' roles/removal |
| Login / Register (Screen E) | Unauthenticated entry | Split hero-photo + form; tab-switch between sign-in and registration on one screen |
| Trip erstellen (Screen F) | "Neue Reise" primary button on Trips List | Modal — create a new trip with name + date range only; this is deliberately the first, minimal step, not a full trip-setup wizard — everything else (accommodations, day plans, transport) is added afterward from the trip itself |
| Eintrag hinzufügen (Screen G) | Add/edit affordance on a Day Detail timeline card, or a day's empty slot | Modal — add or edit one accommodation ("Unterkunft") or activity ("Aktivität") entry for a specific day: type toggle, title, time range, optional cost/link, optional photos. This is the authoring action that actually closes a gap (see Key Flows, Flow 4) |
| Passwort zurücksetzen (Screen H) | "Passwort vergessen?" link on Login/Register | Two-step unauthenticated flow, same split hero-photo layout as Screen E: request reset email → set new password (FR4) |
| Form-Bausteine (Screen I) | — (not a routed surface) | Reference-only swatch sheet, not a screen a user ever lands on: the canonical button/input/select/checkbox states (default/focus/error) that back `DESIGN.md.Components` and every form row in Screens F/G/H and the Share Dialog |

**Bucket List and Day-Map are embedded panels inside Day Detail's sidebar, not separate surfaces or routes.** They correspond to real, already-existing product features (bucket list: epics.md Story 4.1/4.2; day map: Story 3.5) that were simply missing from earlier mockups in this pass and were added back as sidebar cards using existing card/map-preview conventions — no new navigation, no new route, no new visual language.

**Comments and voting intentionally have no surface, panel, or route anywhere in this table.** This is a deliberate, cited product-scope cut (Tommy's decision to remove comments/voting entirely, logged in `.memlog.md` and flagged separately for John/PM to process against Epic 5/6 backlog stories), not an omission — see also the note on Flow 3 below.

→ Composition reference: `mockups/trip-overview-day-detail.html` (Screens A, B), `mockups/trips-list-share-login.html` (Screens C, D, E), `mockups/forms-authoring.html` (Screens F, G, H, I). Spine wins on conflict.

## Voice and Tone

German UI copy throughout. Direct and warm, never corporate-generic — it names the specific day, place, or number rather than speaking abstractly.

| Do | Don't |
|---|---|
| "Handlungsbedarf: Tag 4 — Für Porto (15.9) ist noch keine Unterkunft hinterlegt." | "Warnung: Unvollständige Planung." |
| "Kosten bisher" | "Ausgabenübersicht" / "Budgetanalyse" |
| "Willkommen zurück, Thomas" | "Willkommen im Dashboard" |
| "Dein erstes Reise-Cockpit wartet." / "Reisen planen, die sich nicht wie Arbeit anfühlen." | "Die #1 Reiseplanungs-App" / feature-list marketing copy |
| "Vollständig geplant" / "1 Tag offen" | "Status: OK" / "Status: Fehler" |
| Names the concrete missing thing (day, place, item type). | Generic "error", "incomplete", or icon-only signal with no text. |

## Component Patterns

Behavioral. Visual specs live in `DESIGN.md.Components`.

| Component | Use | Behavioral rules |
|---|---|---|
| day-row gap indication | Trip Overview list | Row border/background switches to warn treatment ({colors.warn-border}/{colors.warn-bg}) when the day has no accommodation on record. Accommodation pill swaps from a plain accent-colored place name to a warn-colored "Keine Unterkunft" pill with alert icon. Mini coverage bar for that row always includes a hatched gap segment sized to the actual open-time proportion — never omitted just because the row is already flagged another way. |
| coverage-bar / gantt segment logic | Day Detail (full, with legend + 08:00–22:00 axis) and Trip Overview (mini, per day-row, unlabeled) | Segments render strictly chronological, proportional to real duration, using exactly four types in this fixed order of appearance: stay → travel → activity → travel → activity → ... → stay. Colors are fixed per type ({components.coverage-bar} in DESIGN.md) — never reassigned per trip or per day. A day with no accommodation shows a single oversized gap segment rather than many small ones — the bar communicates "this day is structurally incomplete," not just "some slivers of time are free." |
| activity timeline neutral-marker rule | Day Detail timeline | **Hard constraint carried from product data model, not a style preference:** every generic day-plan-item ("activity") node renders the same single neutral solid dot marker ({components.timeline.neutralMarkerSize}), with zero icon or emoji variation between activity types. This is because the data model has no activity-type/category field, and the product owner does not want to require one just to support per-type iconography. Do not infer or add a category field, dropdown, or icon picker to satisfy this pattern — implementers must not "complete" this into a typed icon system. Stay nodes (house icon) and travel-segment nodes (car icon) are the only two icon exceptions, and both are legitimate because they derive from real existing fields (item type = accommodation; `transportType` on the transport segment) — not from a field invented for icon purposes. Differentiation between individual activities happens only through title text and the photo strip below the card, never through marker shape or color. |
| photo-strip uniform-square rule | Any surface showing multiple images for one entity (day-plan tl-card, day-row day-photo, trip-row trip-photo) | Thumbnails are always uniform in size within their strip, fixed-width (`flex: 0 0 {components.photo-strip.thumbSize}` for a `tl-card`'s photo strip and the Eintrag-hinzufügen photo preview, or the surface's own leading-thumbnail token — `{components.day-row.photoSize}` / `{components.trip-row.photoSize}` — for a day-row/trip-row lead image; never `flex: 1`/stretched), left-aligned (never justified/spread across available width), square aspect ratio, center-cropped (equivalent to `object-fit: cover; object-position: center`), and always sharp-cornered ({rounded.photo} = 0) regardless of the radius of the card that contains them. |
| trip-row | Trips List (Screen C) | Whole row is a single navigation target to that trip's Trip Overview (same rule as `day-row` — see Interaction Primitives). State (gap / fully planned / upcoming / past) is fully data-driven and mirrors `day-row`'s gap logic one level up — see State Patterns "Trip status variants" row for the four pill treatments. Visual spec: `DESIGN.md.Components → trip-row`. |
| auth-tabs / type-tabs | Login/Register (Screen E) sign-in↔register toggle; Eintrag-hinzufügen (Screen G) Unterkunft↔Aktivität type toggle | Exactly one tab active at a time; switching is instant (no page navigation, no confirmation) and never discards values already entered in shared fields (Screen G's Titel/Zeitraum fields are shared between Unterkunft and Aktivität — only type-specific fields, if any, would reset on switch). Active-tab styling is the only interactive state currently mocked; hover/focus on tabs is not yet specified (see the general hover/focus gap below). Visual spec: `DESIGN.md.Components → auth-tabs`. |
| button (primary / secondary) | Every dialog/form footer (Trip erstellen, Eintrag hinzufügen, Share Dialog, Passwort zurücksetzen) | Exactly one primary (committing) action per dialog, paired with a secondary "Abbrechen"/cancel button whenever the action isn't trivially reversible. The primary button is never disabled-with-no-explanation for a missing required field — the offending field shows its own error state instead (see State Patterns), so the reason a save can't proceed is always visible on the field, not inferred from a grayed-out button. The Share Dialog's `Entfernen` (remove collaborator) action is a `button` variant — sized to the same 44px hit area as every other button, not a bare unpadded text link — closing the touch-target gap `review-accessibility.md` flagged; it keeps its link-like (text, no fill) visual treatment. Visual spec: `DESIGN.md.Components → button`. |
| input / select | Every form surface (Trip erstellen, Eintrag hinzufügen, Share Dialog invite row, Login/Register, Passwort zurücksetzen) | Focus and error are real, distinct visual states, not left to browser defaults — see `DESIGN.md.Components → input / select` for the exact swatch values. An input in error state always carries an inline error line directly below it, worded per Voice and Tone (names the concrete problem — "Bitte eine gültige E-Mail-Adresse angeben." — never a generic "Ungültige Eingabe"). |
| checkbox | Trip erstellen dialog (optional rows: notify collaborators, save as template) | The entire row (box + label) is the click/tap target and toggles state, not just the visible 20px box — consistent with the 44px touch-target floor. Visual spec: `DESIGN.md.Components → checkbox`. |
| hero-photo scrim-strengthening rule | Trip Overview hero, Day Detail hero, Login/Register side panel | Every hero photo carries the full 4-stop scrim defined in `DESIGN.md.components.hero-photo.scrim`, not just a simpler bottom-only fade. The top, lighter stop exists specifically because a real, unpredictable trip/day photo can place bright content (sky, snow, sunlit rock) directly behind header text that has no button-style background of its own (breadcrumb, kicker). This was learned empirically by swapping a real photo asset into a previously gradient-only mockup and finding the top text's contrast margin was thinner than the bottom title's. Any new hero photo — including ones not yet mocked (e.g. future trip cover photos chosen by users) — must keep this 4-stop treatment; a 3-stop, bottom-only scrim is not sufficient once real, user-supplied photography is in play. |
| redundant-stat removal principle | Every surface with a stat-strip | Before adding a new numeric readout to a screen, check whether that number (or a number it's directly derived from) is already visible elsewhere on the same screen. If so, do not add it again. This principle removed two things during discovery: the hero-photo "glass" stat-pills (duplicated the stat-strip directly beneath them, on both Screen A and B) and the entire "Heute im Überblick" sidebar card on Screen B (its three numbers were each already shown or directly derivable from the stat-strip and the coverage bar/legend/timeline). Apply this check to any new dashboard-style number before shipping it. |

## State Patterns

| State | Surface | Treatment |
|---|---|---|
| Missing accommodation / open-gap day | Trip Overview day-row; Day Detail (if viewing that day) | Row/card takes the warn border+background; accommodation slot shows "Keine Unterkunft" pill (warn, alert icon) instead of a place name; mini/full coverage bar shows a proportionally large hatched gap segment; sidebar `gap-alert` card on Trip Overview names the exact day and missing item ("Handlungsbedarf: Tag N — Für [Ort] ([Datum]) ist noch keine Unterkunft hinterlegt."). Trips List mirrors this at the trip level with a `trip-status.gap` pill ("N Tage offen", singularized to "1 Tag offen" for N=1). Viewed from the day-detail side, the timeline itself may still be partially filled (activities/travel present) even though the day is flagged — the gap is specifically about the accommodation slot, not the whole day. |
| Empty bucket list | Day Detail sidebar `bucket-list` card | **Not covered by any mockup in this pass — [ASSUMPTION].** Recommended treatment, consistent with Voice and Tone: a short, concrete empty message (e.g. "Noch keine Ideen gesammelt.") plus a pointer to the add action, inside the existing `card` shell — no illustration, no separate empty-state component invented. Flag for confirmation in the next review pass. |
| Fully-planned day | Trip Overview day-row; Day Detail | Plain white row/hero, no warn treatment anywhere. Mini/full coverage bar shows only stay/activity/travel segments with zero gap segment. Accommodation slot shows the actual place name in accent color with a house icon. |
| Trip status variants (Trips List) | Screen C `trip-row` | Four observed states, each a fixed pill treatment: gap (warn, "N Tage offen" / "1 Tag offen" for N=1), fully planned (accent, checkmark, "Vollständig geplant"), upcoming/unplanned (neutral gray, clock icon, "Bevorstehend · Planung offen"), past/completed (neutral gray, box icon, "Abgeschlossen", row rendered at reduced opacity ~0.78 to read as archival/read-only). |
| Read-only past trip | Trips List, and by extension any past trip opened | Visually deprioritized (opacity) in the list; per PRD FR37/epics.md Epic 2 scope, past trips are viewable as a read-only logbook — no edit affordances should render for a past trip's Trip Overview or Day Detail, though this interaction rule was not explicitly re-verified against the Screen A/B mockups (both mocked an active, in-progress trip). |
| Cold load / navigating to a trip | Trip Overview, Day Detail, Trips List — any surface that fetches trip data | **Not pixel-mocked in this pass — minimal convention only.** NFR1 sets a ~15s p95 load budget, so a blank screen or a bare full-page spinner would read as broken for a meaningful stretch of that window. Replace the surface's primary content region with a skeleton silhouette matching its own layout (stat-strip cells, day-row/trip-row shapes) rather than a generic spinner; a small inline spinner is acceptable only for short, sub-second actions (a dialog's primary button while it submits), never for a full page/route load. |
| Save-failure / error feedback | Any form dialog (Trip erstellen, Eintrag hinzufügen, Share Dialog invite, Login/Register, Passwort zurücksetzen) and any background write (export/import per FR33/FR34) | **Not pixel-mocked in this pass — minimal convention only.** Field-attributable problems (validation) render inline via the `input`/`select` error state (`DESIGN.md.Components → input`: border + background swap, icon + short-text hint below the field). Problems not attributable to one field (network failure, server error, failed export/import) render as a `{colors.warn}`-toned banner/toast at the top of the dialog or screen — icon + short concrete text per Voice and Tone (e.g. "Speichern fehlgeschlagen — bitte erneut versuchen." not "Ein Fehler ist aufgetreten"), and it must not auto-dismiss faster than a user can read it. |

## Interaction Primitives

- Entire `day-row` / `trip-row` is a single navigation target (click anywhere on the row, not just the title) — mockups render `cursor: default` throughout since they are static, but the intended affordance is a full-row click-through to Day Detail / Trip Overview respectively.
- `bucket-item`'s trailing "+" circle is a discrete add-to-day-plan action, separate from the row's own (non-existent) navigation — clicking the row text does nothing; only the "+" acts.
- Share Dialog's invite row (email input + role select + "Einladen" button) is a single-line compose-and-submit pattern; existing collaborators are listed below with a role badge and, for non-owners, an "Entfernen" action styled as a `button` variant (link-like visually, but a real ≥44×44px hit area — see `Component Patterns → button`, fixing the bare-text-link touch-target gap `review-accessibility.md` flagged) — no inline role-editing dropdown was mocked for existing collaborators, only remove.
- Login/Register is **one surface**, not two routes — `auth-tabs` toggles between sign-in and registration state within the same split hero+form layout, no page navigation.
- Map previews (`map-preview` on Trip Overview and Day Detail) are always paired with a text caption summarizing station count and a "Kartenvorschau öffnen" affordance to the full map (per PRD FR26/epics.md Story 3.6) — the preview itself is illustrative, not the only way to get the information.
- **Gap not covered by mockups:** hover, focus, active, and pressed states are not specified anywhere (all mock interactive elements use `cursor: default` as static illustrations). Implementation must author these per the Accessibility Floor below, using `DESIGN.md` accent/border tokens — this spine intentionally does not prescribe exact hover/focus visuals since none were reviewed/approved.

## Accessibility Floor

Behavioral floor only; visual contrast values live in `DESIGN.md`. **Stated conservatively on purpose:** the PRD explicitly downgraded its accessibility target from WCAG AA to "no formal accessibility standard required at this stage" (prd.md edit history, 2026-02-12) — do not present this system as AA-compliant or claim conformance to a level it was not designed or audited against.

Baseline commitments carried from the PRD's "basic best practices" language and epics.md's Additional Requirements:

- Every interactive element must be reachable and operable via keyboard; full keyboard navigation is an explicit epics.md requirement even though a formal WCAG level is not.
- Visible focus state required on all interactive elements (exact visual not yet specified by mockup — see Interaction Primitives gap above).
- Color is never the sole signal for a gap/warning state: every warn-colored element pairs color with an icon and short text label, and the coverage-bar's gap segment uses a hatch pattern in addition to color specifically so it doesn't rely on color perception alone.
- Touch targets ≥ 44×44px (epics.md Additional Requirements). As of this pass, `button`, `input`, `select`, and `tab`/`auth-tabs` all enforce a 44px min-height as their base spec (`DESIGN.md.Components`), including the previously undersized bucket-list "+" affordance and the Share Dialog's `Entfernen` action.
- Icon accessible naming: every status/decorative icon (gap-alert triangle, stay/travel/activity dot markers, trip-status check/clock/box icons, chevrons, upload/photo icons) is marked `aria-hidden="true"`, because its meaning is always duplicated in adjacent visible text — the same principle as the color-pairing rule above, applied to assistive-tech naming instead of sighted perception. An icon that is ever the *sole* carrier of information (none currently exist across the mocked surfaces) must instead get a real `aria-label` describing what it communicates, never `aria-hidden`.
- Map views are always paired with a text summary/caption (station count, place names) — the map is never the sole carrier of information a user needs.
- Tommy opted in to a dedicated accessibility-reviewer lens at the start of the Finalize step (memlog decision, v10 approval) — that review has not yet run as of this spine; treat the floor above as the pre-review baseline, not a final audit result.

## Key Flows

### Flow 1 — Tom spots a gap on Trip Overview (Tom, mid-afternoon, checking in on his Portugal trip)

1. Tom opens the Portugal Roadtrip trip (Trips List row → Trip Overview).
2. Hero photo + title confirm he's on the right trip; stat-strip immediately shows 12 Tage, 5 Stationen, €2.340 Kosten bisher, and — in warn color — **1 Offener Punkt**.
3. He scans the day-row list. Tag 04 (Porto) stands out on sight: warn-tinted border/background, and its mini coverage bar shows a visibly larger hatched gap segment than every other day.
4. Its accommodation slot reads "Keine Unterkunft" in a warn pill instead of a hotel name — confirming *what* is missing, not just *that* something is.
5. He glances at the sidebar `gap-alert` card for the specific instruction: "Handlungsbedarf: Tag 4 — Für Porto (15.9) ist noch keine Unterkunft hinterlegt."
6. **Climax:** Tom knows exactly which day and what's missing without opening Day Detail at all — the gap is legible from the trip-level screen alone, matching the PRD's stated "aha moment" (FR11/FR12-class gap detection: seeing which days are missing accommodations (FR11) or have an empty/placeholder plan (FR12), surfaced here at the list level).

Failure mode: if a day has *both* a missing accommodation and an underfilled plan, the mockups only demonstrate the accommodation gap explicitly — behavior for combined/multiple gap types on one row is not specified and should be confirmed before implementation.

### Flow 2 — Tom drills into a fully-planned day (Tom, reviewing Day 6 before departure)

1. From Trip Overview, Tom clicks the Tag 06 row (Panoramafahrt & Weinprobe) — its mini bar is fully solid, no gap segment, signaling this day is in good shape.
2. Day Detail opens: the day-hero photo shows only the title ("Tag 6 — Porto → Douro-Tal") and date, no stats crowding the photo.
3. Directly below, the full coverage panel shows the day's entire 08:00–22:00 structure at a glance: check-out, drive, panoramic stop, drive, lunch, drive, wine tasting, drive, check-in — legend confirms the color mapping, and there is no gap segment anywhere in the bar.
4. The stat-strip beneath gives the remaining top-line numbers (day 6/12, Fahrzeit gesamt, Ausgaben heute, Check-in Quinta) — none of which repeat what the coverage bar or hero already showed.
5. He scrolls the timeline itself for the narrative version of the same day: the previous-night checkout card (muted, "bereits bezahlt"), alternating plain travel-segment rows and activity cards (each with a neutral marker, a title, a cost, and 2–3 sharp-cornered photos), ending in the check-in card for that night's stay.
6. In the sidebar he checks "Kosten bisher · heute" (€110, itemized), the day map (route + pins for the day's stops), and the bucket list underneath it — sees "Livraria Lello" sitting unplanned and considers adding it to a future open day via its "+".
7. **Climax:** Tom can audit the same day both structurally (coverage bar) and narratively (timeline) without leaving the screen, and the bucket list sits one scroll away as a ready source for filling any day that still needs it.

### Flow 3 — Konni receives a shared trip and reviews it as a viewer (Konni, invited by Tom the night before departure)

1. Tom opens the Share Dialog from Trip Overview ("Reise teilen"), enters Konni's email, leaves the role as Viewer, and sends the invite.
2. Konni receives access, visits the Login/Register screen, and registers using the form beside the same hero-photo panel Tom saw when he first signed up — same warm, non-corporate framing ("Dein erstes Reise-Cockpit wartet.").
3. She lands on the Trips List, sees the Portugal Roadtrip row with its "1 Tag offen" status pill and cost-so-far figure, and opens it.
4. On Trip Overview she reads the same gap-alert Tom saw (missing Porto accommodation) but has no edit affordances available to her — Viewer role per PRD FR30 ("Viewers can see the trip plan but cannot edit core details"; the same permission is numbered FR23 in epics.md's own, differently-ordered FR scheme — prd.md is the citation of record here).
5. Note: the PRD's own Konni journey also has her "adding a comment or suggestion" at this point (PRD FR31) — that step is deliberately absent from this flow; see Information Architecture above for the cited comments/voting scope cut this reflects.
6. **Climax:** Konni is fully informed — she can see exactly what's set and what's still open on the trip — without any risk of her accidentally altering Tom's plan, matching the PRD's Konni journey ("feels included and informed without needing to manage the whole plan"), minus the now-removed comment/suggestion step noted above.

Note: the mockups show the Share Dialog's role selection (Viewer/Contributor) and the resulting role badges, but do not depict what a Viewer-role Trip Overview/Day Detail looks like with edit controls suppressed — that reduced-permission visual state is not yet mocked and should be confirmed in a follow-up pass.

### Flow 4 — Tom closes the Porto gap by adding the missing accommodation (Tom, continuing directly from Flow 1, same afternoon)

1. Continuing from Flow 1's climax, Tom clicks through from the sidebar `gap-alert` card (or the flagged Tag 04 day-row) into Day Detail for Porto.
2. He opens the "Eintrag hinzufügen" dialog from the day's timeline — the same modal used for any accommodation or activity entry on any day.
3. The dialog opens with the `Unterkunft` type-tab active by default (the `auth-tabs`-style two-tab toggle) — he doesn't need to switch tabs, since accommodation is exactly what's missing.
4. He fills Titel ("Quinta do Vallado"), the Von/Bis time range (check-in through the next day's check-out), and optionally a cost and a booking link; he drags two photos of the property into the photo-upload zone, which appear as sharp-cornered 56px preview thumbnails with individual remove-x affordances.
5. He clicks "Speichern" — the dialog's single primary action.
6. **Climax:** Back on Day Detail and Trip Overview, the gap is gone — Tag 04's day-row returns to the plain, fully-planned treatment, its mini coverage bar's hatched gap segment is replaced by a solid stay segment, the trip-level "Offene Punkte" stat drops by one, and the sidebar `gap-alert` card disappears entirely. This is the authoring loop the PRD's "Tom — Primary Success Path" journey names (create trip → add transport → add accommodations → fill day plans) and it directly closes the gap Flow 1 surfaced — the two flows together cover both halves of the gap-first narrative: spotting it, then closing it.

Failure mode: leaving a required field (Titel, Zeitraum) empty and clicking "Speichern" is not pixel-mocked; per the input error-state convention (see State Patterns), the offending field should show its inline error treatment rather than silently blocking the save.

### Flow 5 — Tom resets a forgotten password (Tom, returning after time away)

1. On the Login/Register screen, Tom clicks "Passwort vergessen?" and lands on Passwort zurücksetzen, Schritt 1 von 2 — the same split hero-photo + form layout as Login/Register.
2. He enters his email and clicks "Link zum Zurücksetzen senden".
3. He follows the emailed link (email delivery itself is outside this UI's scope) to Schritt 2 von 2, which confirms his email address and the link's remaining validity window ("Der Link ist noch 42 Minuten gültig").
4. He enters and confirms a new password and clicks "Passwort speichern".
5. **Climax:** A success note confirms he's been signed in automatically and redirected to his Trips List — no separate login step required — closing FR4 ("Users can reset their password via email") end-to-end, in the same warm, non-corporate voice as the rest of the auth surface ("Kein Problem — passiert den Besten.").

Failure mode: an expired/invalid reset link, or a password that fails the minimum-length rule, is not pixel-mocked; both should use the same inline `input` error-state convention as any other form (see State Patterns).
