# Validation Report — TravelPlan

- **DESIGN.md:** `_bmad-output/planning-artifacts/ux-designs/ux-TravelPlan-2026-07-27/DESIGN.md`
- **EXPERIENCE.md:** `_bmad-output/planning-artifacts/ux-designs/ux-TravelPlan-2026-07-27/EXPERIENCE.md`
- **Run at:** 2026-07-30T20:47:29Z

## Overall verdict

The pair is internally consistent, decision-dense, and clearly derived from a real, well-documented discovery process (`.memlog.md` corroborates every major visual call). Where it applies, it applies cleanly: token references resolve, German copy strings match verbatim across both files and both mockups, and section shapes follow the canonical order. But the spine specifies only the "read/reconnaissance" half of the product — five view-oriented surfaces built from an already-mostly-planned demo trip — while the entire authoring half (create trip, add accommodation, edit a day plan, password reset, any form/button/input primitive, loading/error/empty states) is either unmocked or unmentioned. Combined with two incorrect PRD FR citations and two unresolvable `{size}`-style token placeholders, a downstream consumer can source-extract the *viewing* surfaces with confidence but has no contract at all for the *editing* surfaces that make up most of the PRD's functional requirements.

The accessibility reviewer shifts the picture further, and specifically toward the surfaces the rubric already flagged as thin. Against the PRD's own stated pragmatic baseline (44×44px touch targets, strong contrast, no color-only signaling), the color system holds up well — but the approved mockups' actual interactive-element CSS falls well under the 44px floor almost everywhere (the bucket-list "+" affordance is roughly half the required size in both dimensions), meaning-bearing icons carry no accessible-name convention beyond one inconsistent example, and photography that both documents themselves call semantically meaningful has zero alt-text guidance anywhere. None of this is unique to the accessibility lens — it lands squarely on the same unmocked-primitives and unspecified-states gaps the rubric found — but it adds a second, independent line of evidence that the spine's thin spots (Component coverage, State coverage) are exactly where real users would be hurt first.

## Category verdicts

- Flow coverage — thin
- Token completeness — adequate
- Component coverage — thin
- State coverage — thin
- Visual reference coverage — adequate
- Bloat & overspecification — adequate
- Inheritance discipline — thin
- Shape fit — adequate

## Findings by severity

### Critical (3)

**Flow coverage** — No Key Flow covers PRD's "Tom — Primary Success Path" journey (EXPERIENCE.md `Key Flows`, lines 98–129; `Foundation`, lines 15–23)
Flow 1 and Flow 2 both review an already-planned trip; neither demonstrates FR5, FR13–FR21, or FR25 authoring interactions, and no add/edit form is mocked or specified anywhere.
Fix: add a flow (or extend Flow 1 past its current climax) that walks through actually closing the Porto gap — opening the accommodation form and saving it — or explicitly declare authoring flows out of scope for this pass in `Foundation`.
Source: `review-rubric.md`

**Flow coverage** — FR4 (password reset via email) has zero representation (EXPERIENCE.md IA table line 33; `Interaction Primitives` line 81)
Login/Register (Screen E) is described only as a sign-in/register tab toggle; no "forgot password" link, screen, or state is mocked or mentioned.
Fix: add a minimal password-reset flow/state, or note the omission explicitly as a scoped-out gap.
Source: `review-rubric.md`

**Accessibility** — The bucket-add "+" affordance is roughly half the required touch-target size (`.working/direction-merged-light-cockpit-v10.html` line ~589-603)
`.bucket-add` (width:24px; height:24px) is the sole way to add a bucket-list idea into a day plan — the most-repeated, most consequential violation of the epics.md "touch targets ≥ 44×44px" floor in the whole set.
Fix: keep the visual 24px glyph but expand the hit area to ≥44×44px via padding/transparent hit-slop, or wrap it in a button with `min-width/min-height: 44px`.
Source: `review-accessibility.md`

### High (10)

**Flow coverage** — Flow 3's climax silently diverges from the sourced PRD Konni journey's climax (EXPERIENCE.md lines 121–129; DESIGN.md lines 212–213)
The divergence is real and intentional (comments/voting removal decision documented in DESIGN.md and `.memlog.md`), but Flow 3 gives no inline pointer to that decision.
Fix: add one cross-reference sentence in Flow 3 to the comments/voting removal decision.
Source: `review-rubric.md`

**Component coverage** — `trip-row` and `auth-tabs` have no dedicated DESIGN.md or EXPERIENCE.md rows (DESIGN.md lines 190–199; EXPERIENCE.md lines 56–64, 73, 78–81)
Used with real, distinct behavior but only get incidental mentions; trip-row's states are scattered across State Patterns rather than given their own pattern row.
Fix: add explicit rows for both, even if by cross-reference to the established day-row pattern.
Source: `review-rubric.md`

**Component coverage** — No DESIGN.md Components entry for any interactive form primitive (button, input, select, dialog — Screens C/D/E)
Only the dialog's shadow value and corner radius are indirectly implied; this is the visual-spec side of the missing-authoring-flow gap.
Fix: add minimal button/input/dialog rows, or explicitly state these inherit an external library's defaults.
Source: `review-rubric.md`

**State coverage** — No cold-load/loading state specified for any surface (EXPERIENCE.md State Patterns, lines 65–74)
No skeleton, spinner, or placeholder is defined, despite NFR1's explicit 15-second p95 load target making the loading experience load-bearing.
Fix: add a loading-state row, even minimal.
Source: `review-rubric.md`

**State coverage** — No error/save-failure state specified anywhere (EXPERIENCE.md State Patterns)
Network failure, failed save, failed export/import are all unspecified despite FR33/FR34 and general CRUD being core MVP scope.
Fix: add a minimal error-feedback convention consistent with the Voice and Tone table's style.
Source: `review-rubric.md`

**Inheritance discipline** — EXPERIENCE.md's PRD FR citations are unreliable (EXPERIENCE.md line 126, line 107)
Line 126 cites "PRD FR23" for the Viewer read-only permission, but PRD's actual FR23 is "budget target" — correct citation is PRD FR30, carried instead from epics.md's differently-numbered FR23. Line 107's "FR10/FR11-class gap detection" is similarly imprecise.
Fix: audit every FR citation in EXPERIENCE.md against prd.md directly, correct FR23→FR30 and FR10/11→FR11/12, and add a caveat about the source numbering mismatch.
Source: `review-rubric.md`

**Accessibility** — Nearly every button, input, and select computes well under 44px tall (both mockup files — `.share-btn`, `.primary-btn`, `.auth-submit`, `.input`, `.select`, `.auth-tab`, etc.)
The requirement and the approved v10 mockups silently disagree — neither DESIGN.md nor EXPERIENCE.md flags the shortfall.
Fix: bump interactive-element vertical padding system-wide, or add an explicit note that mockup CSS is illustrative only and implementation must hit 44px via min-height/hit-area.
Source: `review-accessibility.md`

**Accessibility** — Share Dialog's "Entfernen" (remove collaborator) is a bare text link with no padding (`additional-screens-trips-list-share-login.html` line ~303-308)
Smallest, least forgiving target in the set, performing a destructive/consequential action (revoking access).
Fix: give it a padded button hit area (≥44×44px) even if it keeps a link-like visual style, same as bucket-add.
Source: `review-accessibility.md`

**Accessibility** — Photography carries no alt-text guidance anywhere (hero-photo, day-photo, tl-photo, trip-photo across both mockups + DESIGN.md §hero-photo)
All photo surfaces are CSS background-image on divs, not img elements — no native alt mechanism exists, and DESIGN.md anticipates future user-uploaded photos without addressing text alternatives.
Fix: add a "Photo alt-text" subsection to EXPERIENCE.md — decorative alt="" where adjacent title text already names the entity; real generated alt for tl-photos/photo-strip images.
Source: `review-accessibility.md`

**Accessibility** — Meaning-bearing icons have no accessible-name convention (~20+ inline `<svg>` icons across both mockups)
Only the neutral activity-dot is explicitly marked decorative; every other meaningful icon has neither `aria-hidden` nor a label.
Fix: add one line to the Accessibility Floor — status/meaning icons are decorative (`aria-hidden="true"`) since meaning is always duplicated in adjacent text; icons that are the sole information carrier need a real `aria-label`.
Source: `review-accessibility.md`

### Medium (13)

**Token completeness** — `{size}` is not a resolvable token path (DESIGN.md Components line 199; EXPERIENCE.md Component Patterns line 61)
Fix: replace with real paths, e.g. `{components.photo-strip.thumbSize}` and a distinct token for the row-leading thumbnail.
Source: `review-rubric.md`

**Token completeness** — Malformed token reference mixes file-path prefix and backticks (EXPERIENCE.md line 60)
Fix: replace with `{components.timeline.neutralMarkerSize}`.
Source: `review-rubric.md`

**Token completeness** — No contrast ratio/target stated for load-bearing color combinations (Accessibility Floor; `.memlog.md` v9)
Fix: state an informal threshold (e.g., scrim's darkest stop ≥4.5:1, top stop ≥3:1) so a future photo swap is verifiable.
Source: `review-rubric.md`

**Visual reference coverage** — DESIGN.md never links to either `.working/*.html` file (EXPERIENCE.md IA line 37)
Fix: add the same (or a shorter) pointer to DESIGN.md, ideally near Components.
Source: `review-rubric.md`

**State coverage** — Trips List's true zero-state isn't covered (EXPERIENCE.md IA line 31; State Patterns lines 65–74)
Fix: add a "no trips yet" row.
Source: `review-rubric.md`

**State coverage** — Login/Register has no validation/error state (EXPERIENCE.md State Patterns)
Fix: add a minimal auth-error state row.
Source: `review-rubric.md`

**Inheritance discipline** — Key Flow titles are not verbatim from PRD's named journeys (EXPERIENCE.md Key Flows)
Fix: keep PRD names as flow subtitles or add an explicit journey→flow coverage table.
Source: `review-rubric.md`

**Shape fit** — No "Responsive & Platform" section despite PRD requiring desktop and mobile/tablet (EXPERIENCE.md Foundation)
Fix: add a minimal placeholder Responsive & Platform section so the gap is structurally visible.
Source: `review-rubric.md`

**Accessibility** — `ink-muted` on paper/card falls below the ~4.5:1 body-text threshold, used for coverage-axis time labels (`direction-merged-light-cockpit-v10.html` line 303)
Fix: bump coverage-axis label color to `ink-soft` (#6B675C, ~4.8–5.6:1).
Source: `review-accessibility.md`

**Accessibility** — Hero-photo header zone contrast is self-acknowledged but unverified beyond one test photo (mockup rationale comment lines 662-666)
Fix: add a minimum-scrim-opacity floor at the top stop, or require a client-side average-luminance check on uploaded hero photos.
Source: `review-accessibility.md`

**Accessibility** — Stay vs. activity coverage-bar segments distinguished by color alone at row level, no legend (`.day-row`/`.trip-row` mini bars, Screen A)
Fix: add a compact inline legend/key for Screen A, or give segments distinct subtle patterns the way gap already gets a hatch.
Source: `review-accessibility.md`

**Accessibility** — Focus-state guidance stops at "must author these," no concrete default; clipping risk on rounded containers (EXPERIENCE.md Interaction Primitives; Accessibility Floor)
Fix: add a concrete default focus ring (e.g. 2px solid `{colors.accent}`, 2px offset) and flag clipping risk on `.browser`/rounded containers.
Source: `review-accessibility.md`

**Accessibility** — Owner role badge reuses the warn/terracotta palette otherwise hard-reserved for gap/error states (`additional-screens-trips-list-share-login.html` lines 290-301)
Fix: give Owner a neutral/ink-toned badge, preserving warn exclusively for actual gaps.
Source: `review-accessibility.md`

### Low (10)

**Flow coverage** — Flow 2 and Flow 3 have no explicit failure/error path
Source: `review-rubric.md`

**Token completeness** — Several frontmatter tokens defined but never referenced in body prose (`rounded.xl`, `spacing.unit`, `spacing.section-gap`, `components.badge-pill.*`, `components.stat-strip.*`)
Source: `review-rubric.md`

**Component coverage** — `stat-strip` and `card` lack their own EXPERIENCE.md pattern row
Source: `review-rubric.md`

**State coverage** — Hover/focus/active/pressed states and reduced-permission Viewer UI remain unmocked (self-disclosed)
Source: `review-rubric.md`

**Visual reference coverage** — Approved mockups live only in `.working/` alongside 14 superseded files; `mockups/` sits empty
Source: `review-rubric.md`

**Bloat & overspecification** — A few DESIGN.md Do's and Don'ts bullets read as mini case-studies rather than crisp rules
Source: `review-rubric.md`

**Bloat & overspecification** — Two EXPERIENCE.md Component Patterns rows lean toward editorial register (but rationale is load-bearing)
Source: `review-rubric.md`

**Accessibility** — Warn-pairing rule (icon + text, never color alone) verified consistent — no issue, noted for completeness
Source: `review-accessibility.md`

**Accessibility** — Map previews consistently paired with text caption — no issue, noted for completeness
Source: `review-accessibility.md`

**Accessibility** — Empty-bucket-list state is explicitly marked [ASSUMPTION] with a concrete recommended treatment (EXPERIENCE.md State Patterns table)
Good practice, low risk as-is, but worth confirming in the next review pass as the doc itself already requests.
Source: `review-accessibility.md`

## Reviewer files

- `review-rubric.md`
- `review-accessibility.md`
