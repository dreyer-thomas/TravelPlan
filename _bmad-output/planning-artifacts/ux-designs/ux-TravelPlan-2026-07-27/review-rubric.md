# Spine Pair Review — TravelPlan

## Overall verdict

The pair is internally consistent, decision-dense, and clearly derived from a real, well-documented discovery process (`.memlog.md` corroborates every major visual call). Where it applies, it applies cleanly: token references resolve, German copy strings match verbatim across both files and both mockups, and section shapes follow the canonical order. But the spine specifies only the "read/reconnaissance" half of the product — five view-oriented surfaces built from an already-mostly-planned demo trip — while the entire authoring half (create trip, add accommodation, edit a day plan, password reset, any form/button/input primitive, loading/error/empty states) is either unmocked or unmentioned. Combined with two incorrect PRD FR citations and two unresolvable `{size}`-style token placeholders, a downstream consumer can source-extract the *viewing* surfaces with confidence but has no contract at all for the *editing* surfaces that make up most of the PRD's functional requirements.

## 1. Flow coverage — thin

Checked EXPERIENCE.md's three Key Flows against the PRD's three named user journeys (Tom — Primary Success Path; Tom — Edge Case (Gaps & Recovery); Konni — Viewer + Light Contributor). All three flows have a named protagonist, numbered steps, and a bolded climax beat.

### Findings
- **critical** No Key Flow covers PRD's "Tom — Primary Success Path" journey (create trip → add transport → add accommodations → fill day plans). Flow 1 and Flow 2 both review an *already-planned* trip; neither demonstrates FR5, FR13–FR21, or FR25 authoring interactions, and no add/edit form is mocked or specified anywhere. (EXPERIENCE.md `Key Flows`, lines 98–129; `Foundation`, lines 15–23) *Fix:* add a flow (or extend Flow 1 past its current climax) that walks through actually closing the Porto gap — opening the accommodation form and saving it — or explicitly declare authoring flows out of scope for this pass in `Foundation`.
- **critical** FR4 ("Users can reset their password via email") has zero representation in either file. Login/Register (Screen E) is described only as a sign-in/register tab toggle; no "forgot password" link, screen, or state is mocked or mentioned. (EXPERIENCE.md IA table row, line 33; `Interaction Primitives`, line 81) *Fix:* add a minimal password-reset flow/state, or note the omission explicitly as a scoped-out gap.
- **high** Flow 3's climax silently diverges from the sourced PRD Konni journey's climax. PRD: "She adds a comment or a suggestion when she finds a good idea, or proposes an accommodation option." EXPERIENCE.md Flow 3: "Konni is fully informed... without any risk of her accidentally altering Tom's plan." The divergence is real and intentional (Tommy's comments/voting removal decision, documented in DESIGN.md `Do's and Don'ts` and `.memlog.md`), but Flow 3 itself gives no inline pointer to that decision — a reader of Key Flows alone can't tell this is a deliberate scope cut vs. an oversight. (EXPERIENCE.md lines 121–129; DESIGN.md lines 212–213) *Fix:* add one cross-reference sentence in Flow 3 to the comments/voting removal decision.
- **low** Flow 2 and Flow 3 have no explicit failure/error path (data-load failure, permission-boundary violation). Flow 3 does carry a closing "Note" about the unmocked reduced-permission Viewer UI, which softens this, but it isn't framed as a failure branch the way Flow 1's is. *Fix:* add a one-line failure note to each for consistency, or accept as scoped for these review-only flows.

## 2. Token completeness — adequate

Extracted every `{path.to.token}` in both files' frontmatter and prose (see command output below) and checked resolution against the YAML frontmatter.

### Findings
- **medium** `{size}` is used in DESIGN.md (`Components` → photo-strip, line 199) and EXPERIENCE.md (`Component Patterns` → photo-strip rule, line 61) but is not a resolvable path — there is no top-level `size` frontmatter key, and the two usages actually stand in for two different concrete values (the day-row/trip-row leading thumbnail vs. the 56px photo-strip thumb). *Fix:* replace with real paths, e.g. `{components.photo-strip.thumbSize}` for the strip case and a distinct token for the row-leading thumbnail.
- **medium** EXPERIENCE.md line 60 contains a malformed reference: `{typography/DESIGN.md \`components.timeline.neutralMarkerSize\`}` — mixes a file-path prefix and backticks inside the braces, not valid `{path.to.token}` syntax. *Fix:* replace with `{components.timeline.neutralMarkerSize}`.
- **medium** No contrast ratio/target is stated anywhere for load-bearing color combinations, even though `.memlog.md` records real empirical contrast testing on the hero scrim (v9: "top breadcrumb text over sunlit rock had thin contrast margin -- fixed by adding a light 4th scrim stop"). The Accessibility Floor explains *why* AA conformance isn't claimed but never turns that empirical finding into a checkable target. *Fix:* state even an informal threshold (e.g., "scrim's darkest stop must keep white title text ≥4.5:1; top stop ≥3:1 for kicker/breadcrumb text") so a future photo swap is verifiable.
- **low** Several frontmatter tokens are defined but never referenced in body prose of either file: `rounded.xl`, `spacing.unit`, `spacing.section-gap`, most of `components.badge-pill.*`, all of `components.stat-strip.*`. Not a resolution failure (frontmatter is directly consumable without prose narration), but a consumer skimming prose only would miss that they exist / are in active use.
- All color tokens carry hex values — no critical misses there.

## 3. Component coverage — thin

Extracted every component name mentioned in DESIGN.md `Components`, EXPERIENCE.md `Component Patterns`/`State Patterns`/`Interaction Primitives`, and the two mockup files, then cross-checked each has both a visual row (DESIGN.md) and a behavioral row (EXPERIENCE.md).

### Findings
- **high** `trip-row` (Screen C) and `auth-tabs` (Screen E) are used with real, distinct behavior but have no dedicated DESIGN.md `Components` row — only incidental mentions (the photo-strip bullet name-drops `trip-row`; `Elevation & Depth` mentions only the active auth-tab's shadow value). Neither has an EXPERIENCE.md `Component Patterns` row either (auth-tab toggle gets one sentence in `Interaction Primitives`; trip-row's states are covered but scattered across `State Patterns` rather than given their own pattern row). (DESIGN.md lines 190–199; EXPERIENCE.md lines 56–64, 73, 78–81) *Fix:* add explicit rows for both, even if by cross-reference to the established `day-row` pattern.
- **high** No DESIGN.md `Components` entry exists for any interactive form primitive — button, text input, select, or generic dialog/modal shell — despite these appearing throughout Screens C/D/E (Neue Reise CTA, Einladen button, email input, role select, the Share Dialog shell itself). Only the dialog's shadow value and corner radius are indirectly implied via `Elevation & Depth`/`Shapes`. This is the visual-spec side of Flow-coverage finding #1 (no authoring UI was mocked). *Fix:* add minimal `button`/`input`/`dialog` rows, or explicitly state these inherit an external library's defaults — the Foundation section leaves MUI-as-implementation-substrate "unconfirmed," which isn't enough for an implementer to know where to look.
- **low** `stat-strip` and `card` have DESIGN.md visual rows but no EXPERIENCE.md `Component Patterns` row of their own — their only behavioral coverage is the adjacent "redundant-stat removal principle," a placement rule rather than a component-behavior spec. Likely fine (both are static containers) but worth one line confirming no interaction exists.

## 4. State coverage — thin

Walked all 5 IA surfaces (Trip Overview, Day Detail, Trips List, Share Dialog, Login/Register) against the applicable state set (empty, cold-load, focus, error, permission-denied; offline is out of scope per PRD's explicit "no offline requirement").

### Findings
- **high** No cold-load/loading state is specified for any surface (no skeleton, spinner, or placeholder), despite NFR1's explicit 15-second p95 load target making the loading experience load-bearing. (EXPERIENCE.md `State Patterns`, lines 65–74) *Fix:* add a loading-state row, even minimal.
- **high** No error/save-failure state is specified anywhere (network failure, failed save, failed export/import), despite FR33/FR34 and general CRUD being core MVP scope. No toast/banner/inline-error convention exists in either file. *Fix:* add a minimal error-feedback convention consistent with the `Voice and Tone` table's style.
- **medium** Trips List's true zero-state (brand-new user, zero trips, first landing after login) isn't covered — a real first-run case for the app's actual landing surface. (EXPERIENCE.md IA line 31; `State Patterns` lines 65–74) *Fix:* add a "no trips yet" row.
- **medium** Login/Register has no validation/error state (wrong password, duplicate email, empty required field) despite being a security-relevant surface. *Fix:* add a minimal auth-error state row.
- **low** (self-disclosed, listed for completeness) Hover/focus/active/pressed states are explicitly flagged as unspecified in `Interaction Primitives` (line 83), and the reduced-permission Viewer UI is explicitly flagged as unmocked in Flow 3. Both are transparently called out rather than silently assumed — good practice — but remain real coverage gaps a downstream consumer must still resolve.

## 5. Visual reference coverage — adequate

Listed all files in `mockups/`, `wireframes/`, `imports/`, and `.working/`, and checked what the spines link to.

### Findings
- **medium** DESIGN.md, the primary visual spec, never links to either `.working/*.html` file anywhere in its body — only EXPERIENCE.md's Information Architecture section carries the single composition-reference line (line 37). A consumer opening only DESIGN.md has no path back to the source visuals. *Fix:* add the same (or a shorter) pointer to DESIGN.md, ideally near `Components`.
- **low** The two Tommy-approved files (`direction-merged-light-cockpit-v10.html`, `additional-screens-trips-list-share-login.html`) live only in `.working/` alongside 14 superseded iteration files, with nothing marking "final" vs. "superseded" other than the spine's citation — while a parallel `mockups/` folder sits empty. *Fix:* consider copying/symlinking the two approved files into `mockups/` so the empty folder doesn't mislead a consumer who checks there first.
- Not a defect: `mockups/`, `wireframes/`, `imports/` are empty but contain no orphans (nothing to find).
- Not a defect: "Spine wins on conflict" is stated exactly once, as required, at line 37.
- Verified: hex colors, gap-alert copy ("Handlungsbedarf: Tag 4"), status-pill copy, and the auth-tab shadow value (`0 1px 3px rgba(30,28,20,0.12)`) all match between the spine text and the two mockup HTML files — cross-references that exist do resolve correctly.

## 6. Bloat & overspecification — adequate

### Findings
- **low** A few DESIGN.md `Do's and Don'ts` bullets (redundant-stat-removal, real-photography) read as mini case-studies with discovery-history narrative rather than crisp one-line rules — defensible under DESIGN.md's allowed editorial voice, but denser than the "hard rule" framing the rest of the section uses.
- **low** Two EXPERIENCE.md `Component Patterns` rows (hero-photo scrim-strengthening; activity timeline neutral-marker) carry "this was learned empirically by..." narrative that leans toward DESIGN.md's editorial register rather than pure behavioral rule — though in both cases the rationale is load-bearing (it justifies a "must keep doing this" constraint for future photos/data), so it isn't pure decoration.
- No findings of pixel-specs duplicating tokens, bulk source restatement, or sections no downstream consumer would read — both files are unusually tight for their length.

## 7. Inheritance discipline — thin

### Findings
- **high** EXPERIENCE.md's PRD FR citations are unreliable. Line 126 cites "PRD FR23" for the Viewer read-only permission, but PRD's actual FR23 is "Users can set a total trip budget" — the correct citation is PRD FR30 ("Viewers can see the trip plan but cannot edit core details"). The value cited is right, the label is wrong: it appears to have been carried from **epics.md's own, differently-numbered FR23** (which does say the correct thing), meaning prd.md and epics.md use non-matching FR numbering schemes throughout and the spine blends citations from both without flagging the mismatch. Line 107's "FR10/FR11-class gap detection" is similarly imprecise — PRD FR10 is just "view as day-by-day list"; the actual gap-detection FRs are FR11 (missing accommodation) and FR12 (empty plan). *Fix:* audit every FR citation in EXPERIENCE.md against prd.md directly (not epics.md), correct FR23→FR30 and FR10/11→FR11/12, and add a caveat that prd.md and epics.md number FRs differently so future edits don't reintroduce the error.
- **medium** Key Flow titles are not verbatim from PRD's named journeys (PRD: "Tom — Primary Success Path," "Tom — Edge Case (Gaps & Recovery)," "Konni — Viewer + Light Contributor"; EXPERIENCE.md: "Flow 1 — Tom spots a gap on Trip Overview," etc.). This compounds Flow-coverage finding #1: because the names don't map 1:1, the missing "Primary Success Path" flow isn't self-evident from a title scan. *Fix:* either keep the PRD names as flow subtitles or add an explicit journey→flow coverage table.
- Otherwise strong: `sources` frontmatter resolves in both files (`../../prd.md`, `../../epics.md`, `../../ux-design-specification.md` all exist and are reachable from the workspace directory). Component names are used consistently between DESIGN.md and EXPERIENCE.md (day-row, coverage-bar, tl-card, hero-photo, photo-strip all match verbatim). German UI copy strings (`Handlungsbedarf`, `Keine Unterkunft`, `Vollständig geplant`, `Kosten bisher`, `N Tage offen`) are identical across DESIGN.md, EXPERIENCE.md, and both mockup HTML files — no glossary drift found.

## 8. Shape fit — adequate

### Findings
- DESIGN.md section order matches the canonical order exactly (Brand & Style → Colors → Typography → Layout & Spacing → Elevation & Depth → Shapes → Components → Do's and Don'ts). Strong.
- EXPERIENCE.md has all 8 required-default sections present (Foundation, IA, Voice and Tone, Component Patterns, State Patterns, Interaction Primitives, Accessibility Floor, Key Flows). Strong.
- **medium** No "Responsive & Platform" section (required-when-applicable per the shadcn reference example), despite the PRD explicitly requiring desktop **and** mobile/tablet responsive support. `Foundation` does transparently disclose that only desktop was mocked and frames it as "an open gap... not silently assumed" — good practice — but the section itself is still structurally absent, leaving zero breakpoint/stacking guidance. *Fix:* add a minimal placeholder Responsive & Platform section ("no breakpoints specified yet — desktop only") so the gap is structurally visible, not just mentioned in a Foundation sentence.
- No invented sections requiring justification; both files stick to canonical/default shapes.

## Mechanical notes

- **Frontmatter completeness:** both files' YAML frontmatter parse cleanly; `name`, `status`, `sources`, `updated` present in both; DESIGN.md additionally carries `description`, `colors`, `typography`, `rounded`, `spacing`, `components` per spec.
- **No Mermaid diagrams** appear in either spine file (unlike `ux-design-specification.md`, which has three) — not required by the spec, not a defect, just noted for completeness.
- **FR-numbering mismatch between sources:** `prd.md` and `epics.md` use entirely different FR numbering schemes for overlapping requirements (e.g., prd.md's FR23 = budget target; epics.md's FR23 = viewer read-only permission). This is a pre-existing source inconsistency, not something the UX spine created, but the spine's citations (see Inheritance discipline, finding 1) inherited it silently. Any downstream consumer citing "FRxx" from this spine should verify against prd.md directly.
- **Broken/unresolvable token syntax:** `{size}` (DESIGN.md:199, EXPERIENCE.md:61) and `{typography/DESIGN.md \`components.timeline.neutralMarkerSize\`}` (EXPERIENCE.md:60) — see Token completeness findings.
- **Name consistency:** component names, German copy strings, and color hex values all cross-checked against both `.working/*.html` mockups and found consistent — no drift detected in what *was* specified, only in what was left unspecified.
