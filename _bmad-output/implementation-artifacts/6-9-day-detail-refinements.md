---
authored_against: b5720ca
closes_deferred: [DW-44]
baseline_commit: 4978db83e2b90f5b34af6e4a6351bc4e473f41be
---

# Story 6.9: Day Detail Refinements From First Production Use

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner using the redesigned day view on a real trip,
I want an activity's cost read as a tag beside its time, the whole activity clickable to edit, and the header stripped of duplicated navigation and redundant labels,
so that the screen I use most is faster to scan and easier to operate, particularly on a phone.

## Acceptance Criteria

1. **Cost as a filled tag.** An activity's cost moves from the card's trailing block to the top-right of the card head, right-aligned, on the same line as the time. It uses the `badge-pill` geometry the time pill already uses (4px radius, tabular figures) but is **filled** with `tokens.accent` `#4B6358` carrying white text. `DESIGN.md`'s `badge-pill` section records this as a second, filled variant alongside the existing soft one.
2. **Per-activity pencil removed.** The edit `IconButton` (`TripDayView.tsx:2215-2225`) and the `data-testid="day-plan-item-actions"` wrapper that exists only to hold it are deleted. The day-image edit action in the hero header is kept.
3. **Whole card opens the editor.** Clicking an activity card anywhere other than its interactive children opens that activity's edit dialog. The photo strip still opens the fullscreen viewer, the "open link" action still opens the link, and neither opens the editor.
4. **Editability is visible on a pointer device.** On hover: pointer cursor, low-contrast background shift, border to accent, and a small edit glyph fading in top-right. The glyph is `aria-hidden` decoration, never a `<button>`.
5. **Editability is visible on touch.** Under `@media (hover: none)` the same glyph is permanently visible at low emphasis (`tokens.inkMuted`). No custom cursor image is used on any device.
6. **Keyboard operable.** The card is focusable, activated by Enter and Space, shows a visible focus state, and carries an accessible name saying which activity it edits.
7. **Gated.** A viewer or contributor without planning rights gets no click-to-edit, no pointer cursor, no hover treatment and no glyph in either media mode.
8. **Header split.** The breadcrumb (`:1738-1760`) is removed. "Back to trip" moves into the left slot it vacates and is enlarged for touch; the day-image edit action stays right. A non-owner, for whom the edit action does not render, still sees the trip button on the left.
9. **Coverage label removed.** `trips.dayView.coverageTitle` no longer renders (`:1827-1829`) and the key is removed from both dictionaries along with any assertion pinning it.
10. **Cost card retitled.** `trips.dayView.costCardTitle` reads "Kosten heute" / "Costs today" in both dictionaries.
11. **Mobile overflow measured and closed.** The day page's horizontal overflow at 390px (DW-44) is measured at baseline. If it reproduces, it is fixed; if it does not, DW-44 is closed as already-resolved with the measurement as evidence — see Dev Notes, the described cause appears to have been fixed already.
12. **No functional change.** The timeline, coverage bar, travel segments, stays, bucket list, map panel, cost roll-up and print export all behave exactly as before.

## Tasks / Subtasks

- [x] **Task 1 — Cost pill** (AC: 1)
  - [x] Move the cost out of the trailing block (`TripDayView.tsx:2206-2212`) into the card head beside the time pill, right-aligned.
  - [x] Build it from the existing time-pill treatment (`:1126-1132`) with the fill swapped: `backgroundColor: tokens.accent`, white text. Keep tabular figures and the 4px radius.
  - [x] A card without a recorded cost renders no pill — do not emit an empty or zero one.
  - [x] Add the filled variant to `DESIGN.md`'s `badge-pill` block next to `tl-time-bg`.
  - [x] Confirm at a glance it does not read as a primary button (`theme.ts` `containedPrimary` is the same fill and text colour). Record the judgement in the Dev Agent Record.

- [x] **Task 2 — Card becomes the click target** (AC: 2, 3, 6, 7)
  - [x] Delete the edit `IconButton` and its `day-plan-item-actions` wrapper.
  - [x] Put the click handler on the card, calling the existing `handleOpenEditPlan(item)`. Do not invent a second edit path.
  - [x] The card's interactive children must not trigger it. Prefer `event.stopPropagation()` on the photo strip's and the link button's handlers over guessing at `event.target` in the card handler — the strip is a shared component (`TripDayPlanItemContent.tsx:149`) also used elsewhere, so change its call site here rather than its internals if that is what it takes.
  - [x] Keyboard: `role="button"`, `tabIndex={0}`, and a key handler for **both** Enter and Space (Space must also `preventDefault` or the page scrolls). Give it an accessible name from the activity's title — `trips.plan.editItemAria` already carries the right wording.
  - [x] Wrap all of it in the existing `canEditPlanning` check, the same gate the pencil used.

- [x] **Task 3 — Editability signal** (AC: 4, 5, 7)
  - [x] Hover, inside `@media (hover: hover)` per the precedent at `TripsDashboard.tsx:462-471`: pointer cursor, background to `tokens.cardAlt`, border to `theme.palette.primary.main`, glyph fades in.
  - [x] The glyph: a small pencil from `TripIcons.tsx` (add one if the module has none), `aria-hidden`, positioned top-right, **not** a button and not focusable.
  - [x] Inside `@media (hover: none)`: the glyph renders permanently in `tokens.inkMuted`, and no hover treatment applies.
  - [x] Neither branch applies when `canEditPlanning` is false.

- [x] **Task 4 — Header** (AC: 8)
  - [x] Delete the breadcrumb `Box` (`:1738-1760`) entirely — trip link, `/` separator and day label.
  - [x] Move the "back to trip" `Button` (`:1787`) out of the right-hand control group into the row's left slot. The row is already `justifyContent: "space-between"` (`:1714-1723`), so the layout follows.
  - [x] Enlarge it for touch. It is now the primary way out of this screen.
  - [x] Verify with the edit action absent (non-owner) that the trip button stays left rather than centring or snapping right.
  - [x] Note there is a second "back to trip" affordance at `:1660`. Leave it; this story does not touch it.

- [x] **Task 5 — Copy** (AC: 9, 10)
  - [x] Remove the `coverageTitle` `Typography` (`:1827-1829`) and the key from `en.ts` / `de.ts`.
  - [x] Retitle `costCardTitle` in both dictionaries. Only the string changes; the key stays.
  - [x] `i18nDictionaries.test.ts` asserts key parity between the two dictionaries — a key removed from one must go from both.

- [x] **Task 6 — DW-44** (AC: 11)
  - [x] **Measure first.** At baseline, load the day page at 390px and read `document.documentElement.scrollWidth - clientWidth`.
  - [x] If it is 0, DW-44 is already resolved: record the measurement, leave the code alone, and let the `closes_deferred` annotation close the entry. — **Not the case: it measured 25px, so it was fixed.**
  - [x] If it reproduces, find the actual overflowing element (`[...document.querySelectorAll('*')].filter(e => e.getBoundingClientRect().right > innerWidth)`) and fix that — the span DW-44 names already carries the full clip, so its diagnosis is stale.

- [x] **Task 7 — Tests** (AC: 1, 2, 3, 6, 7, 9, 10)
  - [x] Update `tripDayViewLayout.test.tsx` and any suite asserting the removed pencil, the cost's old position, `coverageTitle`, or the old cost-card string.
  - [x] Add: the cost pill renders in the card head with the accent fill; a card with no cost renders no pill; clicking the card calls the edit handler; clicking a thumbnail does not; Enter and Space both activate; no click handler, cursor or glyph when `canEditPlanning` is false.
  - [x] `npm test` green.

- [x] **Task 8 — Manual check** (AC: 4, 5, 8, 11)
  - [x] jsdom lays nothing out and has no media-query engine, so hover, the touch branch, the enlarged touch target and the overflow measurement all need a browser. Use a throwaway copy of `dev.db` on an isolated port — never `prisma/dev.db`. The working recipe is in `7-12-bucket-list-sidebar-card.md`'s Dev Notes.
  - [x] Check at 390px and at desktop width, as owner and as viewer.

### Review Findings

Code review 2026-08-01 (`bmad-code-review`, three parallel layers: adversarial, edge-case, acceptance).
Severity in brackets. Locations are post-change line numbers in the working tree.

**Decisions — all four resolved by Tommy on 2026-08-01, then applied**

- [x] [Review][Decision] **Card role → stretched-link overlay.** The card keeps no `role`, no `tabIndex` and no key handler; a `<button>` at `position: absolute; inset: 0; zIndex: 1` is the control. Content sits at `zIndex: 2` with `pointerEvents: "none"` and `"& a, & button": { pointerEvents: "auto" }`, the layering `TripsDashboard.tsx:573-586` already uses. This is what dissolved the three highest-ranked patches at once — see the note below.
- [x] [Review][Decision] **Zero cost → hidden.** Guard is now `item.costCents ?` rather than `typeof … === "number"`, so a recorded 0 renders no pill. Task 1 bullet 3 is now literally satisfied. Pinned by a new test.
- [x] [Review][Decision] **Trip name → accepted as absent.** Reason: the day page is only ever reached from its trip, so the back button is sufficient wayfinding — the name would be redundant chrome on a screen this story set out to strip. Recorded, not re-raised.
- [x] [Review][Decision] **Hybrid pointer → third media branch added.** `@media (any-pointer: coarse)` pins the glyph visible, placed after the `hover: hover` block because media queries add no specificity and source order decides. A deliberate deviation from AC5 as written, which named only `hover: none`.

**Deviation from AC3, AC6 and Task 2 as written, accepted with the overlay decision.** Task 2 prescribed `role="button"` + `tabIndex={0}` + a hand-rolled Enter/Space handler on the card, and `stopPropagation()` on the interactive children. That is the construction the review rejected: `role="button"` makes a container's contents presentational, and a key handler that inspects only `event.key` cannot tell its own activation from one bubbling up out of the link inside it. The overlay satisfies the same ACs by different means — Enter and Space become native button behaviour, and `stopPropagation` becomes unnecessary because a raised `<a>` receives the click itself and the overlay beneath it never fires. Both `stopPropagation` call sites were removed.

**Superseded findings (originally counted as three separate patches)**

- [x] [Review][Patch] [high] Enter on the "Open link" anchor opened the editor and cancelled the link — the key handler it depended on no longer exists.
- [x] [Review][Patch] [medium] Inline rich-text links in the notes opened the editor behind the new tab — `overlaidContentSx`'s `& a` opt-in raises every anchor above the overlay, including link marks rendered by `applyMarks`, which no handler on the card could have distinguished from ordinary text.
- [x] [Review][Patch] [medium] Drag-selecting text opened the editor. **The first attempt at this did not work and the browser pass caught it:** I had claimed the overlay dissolved the finding because no card-level click handler remains, but the mouse-up still landed on the overlay, and `pointerEvents: "none"` additionally stopped the drag from selecting anything — so selection regressed while the unwanted dialog stayed. Fixed properly on Tommy's call: the rich-text notes block alone takes its pointer events back (`day-plan-item-notes`). Re-measured in Chrome: dragging the notes now selects `"Rua das Janelas Verdes 9, Lisboa"` and opens no dialog; a plain click on the notes opens nothing; the title line, the card head and the dead space all still open the editor prefilled correctly; the inline link inside the notes still opens its tab. The accepted cost is that the description is no longer part of the click target.

**Original decision text, kept for the record**

- [x] [Review][Decision] **[high] `role="button"` on the card flattens its content in the accessibility tree** — ARIA specifies `button` as *Children Presentational: True*. With `role="button"` + `aria-label` on the card wrapper (`TripDayView.tsx:2226-2231`), the activity title, the rendered rich notes, the time pill, the new cost pill, the "Open link" anchor and the thumbnails all collapse into one leaf announced as `"Edit plan item: <title>, button"`. A **viewer** — who gets no `role` — still hears the full card, so the more-privileged user gets the degraded experience. The test at `:4435` asserts exactly this accessible name and reads as a pass. Options: (a) adopt the stretched-link overlay the story itself cites as precedent (`TripsDashboard.tsx:495-500` — an absolutely-positioned `inset: 0` child plus `&:has(:focus-visible)`, which needs no `role`, no `tabIndex` and no keydown handler and keeps the content readable); (b) `role="group"` on the card plus one real edit control — but that re-creates the nested control AC2 deleted; (c) accept the flattening and record it as deferred work.
- [ ] [Review][Decision] **[medium] A recorded cost of `0` renders a filled accent €0.00 pill** — the guard is `typeof item.costCents === "number"` (`TripDayView.tsx:2242`), carried over unchanged from the pencil era, so `costCents: 0` renders. Task 1 bullet 3 says "do not emit an empty or zero one". The new test only covers `costCents: null` (`test:4301`). This mattered less when cost was 13px plain text; as a filled accent pill a €0.00 is now the loudest thing in the card head. Options: (a) follow the task literally — `item.costCents ? …`, hiding €0; (b) keep €0 because "free" is meaningful information a planner deliberately recorded; (c) keep it but render zero in the soft variant.
- [ ] [Review][Decision] **[medium] The trip's name no longer appears anywhere on the day page** — the deleted breadcrumb was the only render of `detail.trip.name`; it is now referenced nowhere in `TripDayView.tsx`, and the day route (`src/app/(routes)/trips/[id]/days/[dayId]/page.tsx`) renders no trip context of its own. AC8 asked for the breadcrumb's removal and the code complies, but the stated rationale was that it "duplicated navigation" — true of the *link*, not of the *name*, which was information. A bookmarked or deep-linked day now identifies itself only as "Day 3" with a generic "← Back to trip". Options: (a) accept — the back button is enough; (b) put the trip name in the back button's label; (c) surface it in the hero title block.
- [ ] [Review][Decision] **[medium] A touchscreen laptop gets no editability signal at all** — the glyph is split into exactly two branches (`TripDayView.tsx:1252-1275`), per AC4/AC5. A hybrid device (touchscreen laptop, Windows tablet with trackpad) matches `hover: hover`, so the glyph is pinned to `opacity: 0` and only a *mouse* hover reveals it. A user touching that screen sees a card with no indication it is editable — the exact failure the touch branch exists to prevent, and a regression against the always-visible pencil this story deleted. Fix is a third branch on `@media (any-pointer: coarse)`, which deviates from the AC as written. Options: (a) add the `any-pointer: coarse` branch; (b) leave it as the AC specifies and record as deferred work.

**Patches**

- [x] [Review][Patch] [high] Enter on the card's "Open link" anchor opens the editor *and* cancels the link — `onKeyDown` has no `event.target === event.currentTarget` guard and calls `preventDefault()` unconditionally [travelplan/src/components/features/trips/TripDayView.tsx:1286-1294]
- [x] [Review][Patch] [medium] Inline rich-text links in an activity's notes bubble into the card handler, opening the editor behind the new tab — `applyMarks` renders a bare `<a target="_blank">` with no `stopPropagation`; only the standalone link Button and the photo strip were guarded [travelplan/src/components/features/trips/TripDayView.tsx:2269, TripDayPlanItemContent.tsx:61-68]
- [x] [Review][Patch] [medium] Drag-selecting text inside a card opens the editor on mouse-up — no `window.getSelection()?.isCollapsed` guard on a surface that now carries the title, rich notes, times and money [travelplan/src/components/features/trips/TripDayView.tsx:1286]
- [x] [Review][Patch] [medium] Four test assertions can never fail: `day-hero-breadcrumb` is a test id that never existed (verified against `git show HEAD`); `"Change day photo"` is not an accessible name in the codebase (the real one is `"Edit day details"`, used correctly at `:4331`); and both `getComputedStyle(card).cursor` reads sit inside `@media (hover: …)`, which jsdom does not apply — probed directly: `cursor` and `opacity` both return `""` while a non-media `color` resolves fine, so the viewer's "no pointer cursor" check passes on an editable card too [travelplan/test/tripDayViewLayout.test.tsx:4464, 4484, 4501, 4521]
- [x] [Review][Patch] [medium] DW-44's closure breaks the ledger's status vocabulary — every other closed entry reads `status: done <date>`; DW-44 now carries a ~200-word narrative in the field `bmad-loop-sweep` partitions on. The evidence is good and should stay; it belongs in `decision:` [_bmad-output/implementation-artifacts/deferred-work.md:339]
- [x] [Review][Patch] [low] The cost pill lost `whiteSpace: "nowrap"` — `costPillSx` derives from `timePillSx`, which has none; the `tlCostSx` it replaced did, so a long amount can now break mid-value in the `1fr auto` head row [travelplan/src/components/features/trips/TripDayView.tsx:1193-1197]
- [x] [Review][Patch] [low] The card head renders unconditionally and can be entirely empty — a viewer looking at an activity with no times and no cost gets a blank 12px band from `tlCardSx`'s `gap: 1.5`, which is the exact cost the photo strip three lines below was conditionally wrapped to avoid [travelplan/src/components/features/trips/TripDayView.tsx:2235-2264]
- [x] [Review][Patch] [low] Keyboard focus does not reveal the edit glyph — `:focus-visible` draws the ring but does not raise the glyph's opacity, so a keyboard user on a pointer device sees a focused card with no sign of what activating it does [travelplan/src/components/features/trips/TripDayView.tsx:1276-1279]
- [x] [Review][Patch] [low] An untitled activity's accessible name becomes its entire note body — `title` falls back to `preview = parsePlanText(item.contentJson)`, so the card announces `"Edit plan item: "` plus the whole flattened note on every focus. Cap the label input [travelplan/src/components/features/trips/TripDayView.tsx:2195, 1285]
- [x] [Review][Patch] [low] Missing `aria-haspopup="dialog"` on a control whose sole action is opening a dialog [travelplan/src/components/features/trips/TripDayView.tsx:1283]
- [x] [Review][Patch] [low] The Space case never asserts that Space activates — `planDialogMockState.lastProps` is reset only before the Enter case, and the dialog is already open by the time Space fires, so only `preventDefault` is checked. AC6's "activated by Enter **and** Space" is half-tested [travelplan/test/tripDayViewLayout.test.tsx:4442-4443]
- [x] [Review][Patch] [low] Cleanup bundle: the photo-strip wrapper's comment and the Dev Agent Record both justify the `itemImages.length > 0` guard by "an empty flex child's 6px gap" that cannot exist — `MiniImageStrip` already returns `null` for an empty array (`TripDayPlanItemContent.tsx:160-162`); the guard is fine, the stated reason is wrong. Plus `color: "#FFFFFF"` duplicates `theme.palette.primary.contrastText` (and the test hardcodes both `rgb()` values), and `position: "relative"` on the card is dead — nothing inside it is absolutely positioned [travelplan/src/components/features/trips/TripDayView.tsx:1195, 2229, 2288-2292]

**Deferred**

- [x] [Review][Defer] [low] The coverage block lost its only heading and its outline entry — AC9 required removing `coverageTitle`, so the code is compliant; the heading-structure concern is DW-31's, which this story explicitly excludes [travelplan/src/components/features/trips/TripDayView.tsx:1896-1898] — deferred, belongs to DW-31
- [x] [Review][Defer] [low] `canEditPlanning` defaults to `true` when `accessRole` is absent from the response (`:339`), so a malformed or extended payload makes every card an edit target. Pre-existing, and `isOwner` on the line above does the same — but this change widens the blast radius from a 28px pencil to the whole card [travelplan/src/components/features/trips/TripDayView.tsx:339] — deferred, pre-existing
- [x] [Review][Defer] [low] Cost is now styled two ways on the same timeline — the activity card's cost is a filled accent pill, the accommodation card's immediately below it stays plain bold `tlCostSx`. Newly created by AC1, but AC1 is scoped to activity cards by design and the accommodation card is not in this story [travelplan/src/components/features/trips/TripDayView.tsx:1193 vs 2385] — deferred, out of scope for this story

**Dismissed as noise** (6): the `AuthScreenShell` copy of the `width: 1` recipe (this story already opened DW-72 for it); Enter auto-repeat re-firing the handler (React bails on identical state); the AC8 test asserting `>= 44` against a code value of 48 (a floor assertion is the right assertion for an accessibility floor); the absence of a true overflow regression test for DW-44 (jsdom cannot measure overflow — the unit pin is the best available and the comment says so); "AC4/AC5 have no jsdom coverage" (true, but the story's Testing section directs them to a browser and the Dev Record tabulates the measurements — the vacuous *assertions* are kept as a patch above); the back button's hand-set `minHeight`/`paddingInline`/`fontSize` (a deliberate local override with a comment explaining why the theme cannot supply it).

**Post-patch state.** Full suite green at **96 files / 653 tests**, up 6 from the 647 the story recorded. `tsc --noEmit` holds at exactly **152** errors — verified equal to the `4978db8` baseline by stashing, and none in `TripDayView.tsx`. ESLint 0 errors on both changed files (7 warnings, all pre-existing: `react-hooks/set-state-in-effect` in untouched effects and two unused test params).

### Post-patch browser pass — 2026-08-01, Chrome 151 headless

Redone against the overlay structure. Environment: `git worktree` detached at `4978db8` with the four
changed files copied in, `node_modules` cloned with `cp -Rc`, `next dev -p 3099` against a **freshly
migrated, purpose-seeded** SQLite file in the session scratchpad — not a copy of `dev.db`, so no real
trip data was in scope at any point. `prisma/dev.db` verified byte-identical before and after
(`sha256 5255641c…`, 294912 bytes, mtime unchanged at Aug 1 17:47). Worktree, DB and both processes
removed. CDP driven by a hand-rolled client over Node 20's `--experimental-websocket` global.

Seeded four activities on one day, chosen to exercise the branches: full card (time + cost + standalone
link + **an inline rich-text link** + 2 photos), `costCents: 0`, no-time/no-cost, and untitled with a
long note.

**Structure and the AC1 pill** — card carries no `role` and no `tabindex`; the overlay is a
`<button type="button">` named `"Edit plan item: <title>"` with `aria-haspopup="dialog"`, inset by
exactly the 1px border on all four sides (`inset: 0` resolves against the padding box) and receiving
hit-tests both over dead space and over the title text. Cost pill `rgb(75, 99, 88)` / `rgb(255,255,255)`,
4px radius, `tabular-nums`, `nowrap`, top edge `783.9` — identical to the time pill's, so they share the
line. `costCents: 0` renders **no pill** (the decision, confirmed on the real page). The long note's
accessible name is capped: `"…find the mira…"`.

**AC4 pointer branch**

| | resting | hovered | after moving away |
|---|---|---|---|
| card background | `#FFFFFF` | `#FBF9F4` (`cardAlt`) | `#FFFFFF` |
| card border | `#D9D0BE` | `#4B6358` (accent) | `#D9D0BE` |
| glyph opacity | `0` | `1` | `0` |
| glyph colour | `#7A7667` | `#4B6358` | `#7A7667` |
| cursor | `pointer` | `pointer` | `pointer` |

The sibling card stayed at resting values in the same reading, so the rule is scoped to the card.

**AC5 touch branch, 390px** — `hover: none` confirmed live first. Glyph `opacity: 1` at `#7A7667`,
`cursor: auto`, no hover treatment. Back button **48.25 × 145.75px**. Overflow **0px**, not
horizontally scrollable. Both cost pills inside the viewport (`€1,280.00` right edge 336 of 390).

**The new `any-pointer: coarse` branch, with a control.** `Emulation.setEmulatedMedia` still does not
carry `hover`/`pointer` in Chrome 151, so the hybrid was produced in real touch mode by widening only
the `hover: hover` condition — the coarse match is genuine, not faked. Emitted order confirmed as
`hover: hover` (style tag 193) → `hover: none` (194) → `any-pointer: coarse` (195), equal specificity.
Readings taken after a 500ms settle, because the glyph's own 150ms opacity transition made the first
attempt at this measure a mid-flight value and the control caught it:

| step | state | glyph opacity |
|---|---|---|
| 0 | real touch, everything live | `1` |
| 1 | `hover: none` switched off — coarse alone | `1` |
| 2 | **hybrid**: `hover: hover` (opacity 0) *and* coarse (opacity 1) both live | `1` |
| 3 | control: coarse off, `hover: hover` alone | `0` |
| 4 | coarse back on | `1` |

Step 3 is what makes step 2 mean anything: without it, the `1` could have come from anywhere.

**AC6 keyboard, and the regression this review existed to catch.** Focus ring on the overlay measured
`2px solid rgb(75, 99, 88)` at `outline-offset: 2px`, `:focus-visible` matching, and the
`:has(:focus-visible)` rule raises the glyph to `1` in accent (`:has()` supported). Tab order inside a
card: overlay → inline note link → "Open link". No stop on the glyph.

| action | new tab opened | editor opened |
|---|---|---|
| **Enter on the focused "Open link" anchor** | **yes (1 → 2)** | **no** |
| Enter on the inline rich-text link | yes (2 → 3) | no |
| click the inline rich-text link | yes (1 → 2) | no |
| Enter on the overlay | — | yes, prefilled `Museu Nacional de Arte Antiga` |
| Space on the overlay | — | yes, and `scrollY` held at 400 |
| click card dead space | — | yes, prefilled correctly |
| click a thumbnail | — | no — the fullscreen viewer instead |

The first row is the finding. Under the pre-review code that keystroke cancelled the link and opened
the editor; it now opens the link and nothing else.

**The accessibility tree, which is why the pattern changed.** `Accessibility.getFullAXTree`, walking the
card's own subtree: the card is `generic` (not `button`) and carries **13 meaningful descendants** —
`StaticText "09:00 - 10:30"`, `StaticText "€45.00"`, the title paragraph, the note text, `link
"Reisefuehrer"`, `link "Open link"`, and both images. Under `role="button"` every one of those is
children-presentational and the subtree would have been the overlay's name alone.

**AC7 gate, viewer at 390px touch** — 0 overlays, 0 glyphs, 0 buttons inside any card, no `role`, no
`tabindex`, `cursor: auto`, and a real click on a card opened nothing. The no-time/no-cost card renders
**no head row at all** (`headPresent: false`), which is the empty-head patch confirmed on the real page.
Content `pointer-events: auto` for a viewer, so their card text stays selectable. Overflow 0px. No "Day
coverage" anywhere, no trip-name link.

**AC11** — overflow re-measured **0px at 1440px and 0px at 390px** on the patched build.

**Not re-checked in this pass:** the "Costs today" string did not appear in the viewer's 390px body text,
so AC10 rests on the jsdom assertion and dictionary parity rather than on this run. The contributor role
was not re-driven either — the gate is `canEditPlanning` and the viewer/owner ends were both measured.

**One finding, and it corrected something the patch round had claimed.** The overlay was supposed to
dissolve the drag-to-select finding. Measured, it did not — and the measurement is the only reason
this was caught, because the test suite was green either way:

| | selects text | opens the editor |
|---|---|---|
| before the patches | yes | yes |
| overlay, first attempt | **no** (`getSelection()` empty) | **yes** |
| after the notes fix | **yes** | **no** |

`pointerEvents: "none"` meant the drag never reached the text while the mouse-up still landed on the
overlay, so selection regressed and the unwanted dialog stayed. Resolved by giving the rich-text notes
block alone its pointer events back. Re-verified in a second browser pass, with the click target
checked for collapse in the same run:

| action | selects | editor |
|---|---|---|
| drag across the notes | `"Rua das Janelas Verdes 9, Lisboa"` | no |
| click the notes | — | no |
| click the title line | — | **yes** |
| click the card head / dead space | — | **yes**, prefilled `Museu Nacional de Arte Antiga` |
| click the inline link in the notes | — | no, opens its tab (1 → 2) |

The trade Tommy accepted: the description is no longer part of the click target. Everything else on the
card still is.

`prisma/dev.db` verified byte-identical after this second pass too (`sha256 5255641c…`, mtime unchanged).

### Pre-patch browser evidence (superseded)

**The browser pass needs redoing, and this is the one thing the green suite does not cover.** The Dev Agent Record's Chrome measurements were taken against the `role="button"` card, which no longer exists. What still holds unchanged: AC8's header (untouched by these patches), AC11's overflow numbers (the `VISUALLY_HIDDEN` fix is untouched), AC9/AC10's copy. What must be re-measured on the new structure: the hover reveal and the accent border (AC4), the touch branch **and the new `any-pointer: coarse` branch on a hybrid device** (AC5), the focus ring now drawn by the overlay rather than the card (AC6), Enter and Space on the "Open link" anchor actually opening the link (the bug these patches fix — jsdom cannot prove it, only a browser can), a thumbnail still opening the viewer through the `pointerEvents: auto` opt-in, and whether losing mouse text-selection inside the card is acceptable in use.

**Verified as claimed** (pre-patch audit of the story's own work). The full suite was green (96 files / 647 tests). `tsc --noEmit` holds at 152 pre-existing errors, none in `TripDayView.tsx` or the new test block. `theme.palette.primary.main === #4B6358 === DESIGN.md colors.accent`. `PencilIcon` pre-existed. `trips.dayView.coverageTitle` has zero remaining references and key parity holds. `AuthScreenShell.tsx:87` is genuinely the only surviving copy of the `width: 1` recipe. The `epics.md` modification is Story 6.10 only, as the File List states. ACs 1, 2, 5, 7, 9, 10 and 11 are satisfied as written; AC3, AC6 and AC12 carry the findings above.

## Dev Notes

### Where this comes from

These are six changes Tommy identified after using the redesigned day view on a real trip — the first feedback in this project's history that comes from production use rather than from comparing against a mockup. None is a defect in Story 7.3 or 7.11: each is a judgement that only became visible in use. Both design questions the list raised were settled by him on 2026-08-01 and are written into the ACs as decided, not open:

- the cost pill is **filled accent**, not another soft pill, so time and money are distinguishable at a glance (white on `#4B6358` measures 6.51:1);
- the per-activity pencil **goes away entirely** and the whole card becomes the target, with the hover/touch glyph replacing it as the visible signal.

### DW-44's diagnosis is stale — measure before fixing

The entry says a visually-hidden `<span>` carrying `trips.dayView.coverageAxisDescription` is "positioned but never clipped". At `b5720ca` that span (`TripDayView.tsx:1878-1892`) already carries the complete screen-reader-only treatment: `position: absolute`, `width: 1`, `height: 1`, `overflow: hidden`, `clip: rect(0 0 0 0)`, `whiteSpace: nowrap`, `border: 0` — which is exactly the fix the entry prescribes. Either the diagnosis was wrong, something else overflows, or it was fixed between 7.7's browser pass and now.

So Task 6 measures rather than patches. This story closes DW-44 either way — with a fix, or with evidence that it needs none. Do not "fix" a clip that is already there.

The reason it is folded into this story at all: it is the same page, the same coverage block AC9 edits, and this story is explicitly mobile-conscious.

### Traps

**1. The photo strip is shared.** `MiniImageStrip` (`TripDayPlanItemContent.tsx:149`) is used by more than this card. Making the card clickable must not change the strip's behaviour anywhere else — stop propagation at this call site, not inside the component.

**2. Space scrolls.** A `role="button"` div that handles Enter but not Space is a half-implementation; one that handles Space without `preventDefault` scrolls the page on every activation. Both are required.

**3. The glyph must not be focusable.** If it becomes a `<button>` or picks up a `tabIndex`, this story has re-created the nested control and the extra tab stop it set out to remove — with the added cost that the glyph is invisible until hover on pointer devices, so the tab stop would be a focus trap onto something the user cannot see.

**4. Key parity is enforced.** `i18nDictionaries.test.ts` compares the two dictionaries key-for-key. Removing `coverageTitle` from one only will fail it.

**5. `canEditPlanning`, not `isOwner`.** The pencil used `canEditPlanning`, which includes contributors. Substituting `isOwner` would silently remove a contributor's ability to edit activities.

**6. Do not use `prisma/dev.db` for Task 8.** It holds real trip data.

### Adjacent deferred work deliberately left out

Four entries touch this screen and are **not** in scope. Each is named here so a dev session does not fold one in on impulse:

- **DW-31** (the day-detail route has no `h1`–`h4`) — Tommy decided its approach on 2026-08-01: promote the day title to `h1`, re-level the section labels beneath it, update ~14 `level: 5` assertions. Coherent with Task 4's header work and the natural next story, but it is a document-outline concern rather than a usability one and would roughly double this story's test churn.
- **DW-30** (`MiniImageStrip` thumbnails are mouse-only) — the ledger assigns it to a photo-viewer story covering five call sites; extracting one fragments it. Note the tension AC3 creates: the card becomes keyboard-operable while the thumbnails inside it stay mouse-only.
- **DW-29** (total travel time counts travel the coverage bar refuses to draw) — decided, same file, not requested here.
- **DW-27** (`formatCost` diverges across screens) — AC10 changes the cost card's *title*, not its formatter.

### Testing

Vitest 3.2 + Testing Library, jsdom, via `test/helpers/renderWithProviders.tsx`. `tripDayViewLayout.test.tsx` is the main constraint. jsdom has no layout and no media-query matching, so ACs 4, 5, 8 and 11 can be asserted as style properties at best — prove them in the browser and say in the Dev Agent Record which was which.

### Project Structure Notes

Files touched: `src/components/features/trips/TripDayView.tsx` (the bulk), possibly `TripDayPlanItemContent.tsx` (propagation at the call site), `TripIcons.tsx` (a pencil glyph if absent), `src/i18n/en.ts` and `de.ts`, `DESIGN.md`, and the affected suites. No route, API, schema or data-model change.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 6.9]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-TravelPlan-2026-07-27/DESIGN.md] — `:139` `badge-pill`, `:122` `seg-stay` = `{colors.accent}`, `:206` accent's role
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-TravelPlan-2026-07-27/EXPERIENCE.md] — `:95` hover/focus assigned to implementation, `:104` visible focus baseline
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] — DW-44 (closed here), DW-27/29/30/31 (out of scope)
- [Source: travelplan/src/components/features/trips/TripsDashboard.tsx:462-471] — the established whole-row click-target pattern

## Dev Agent Record

### Agent Model Used

claude-opus-5[1m] (Claude Opus 5, 1M context), via `bmad-dev-story`.

### Debug Log References

Browser pass driven with a hand-rolled CDP client against headless Chrome (this repo has no
Playwright/Puppeteer and no `ws` dependency, so the driver speaks the DevTools protocol over a raw
WebSocket). Environment: `git worktree` detached at `4978db8`, `node_modules` cloned with `cp -Rc`,
`next dev -p 3099` against a **throwaway copy** of `dev.db` in the session scratchpad. `prisma/dev.db`
was never opened by the server — confirmed unchanged (294912 bytes, mtime Aug 1 17:47) after teardown.
The worktree, the DB copy and the server are all gone.

Two harness corrections worth recording for the next story that does this:

- `Emulation.setEmulatedMedia` does **not** carry `hover` / `pointer`. Chrome derives those from
  whether the primary pointer is a touchscreen, i.e. `Emulation.setTouchEmulationEnabled`. My first
  pass silently measured the `hover: hover` branch while believing it was on touch; every reading
  below is taken only after `matchMedia("(hover: none)")` confirms which branch is live.
- The login route is rate-limited at 3 attempts (as the story's notes warned). The pass is split into
  four runs with a dev-server restart between them, which clears the in-memory limiter.

### Completion Notes List

**AC1 — cost pill.** `costPillSx` is `timePillSx` with `color: "#FFFFFF"` and
`backgroundColor: theme.palette.primary.main`. Note the AC's `tokens.accent` does not exist: theme.ts
exposes the accent as `palette.primary.main` and its `tokens` object has `accentSoft` but no `accent`.
Same value (#4B6358), correct home. Measured in Chrome: `rgb(75, 99, 88)` on `rgb(255, 255, 255)`
text, 4px radius, `tabular-nums`, 21px from the head's right edge, on the time pill's line, and inside
the viewport at 390px for both a €45.00 and a €1,280.00 pill. A card with no `costCents` renders no
pill (third seeded activity: `costText: null`).

*The button judgement the AC asks for:* it does share `containedPrimary`'s accent fill and white
label, and nothing else a button in this system has — no 44px minimum, no 6px radius, no 20px inline
padding, and no baseline of its own. At 11px/800 in a 3px×8px pill sitting in a card head next to
another pill, it reads as a tag. The pairing that would actually be ambiguous is a filled pill at
button scale; this is not that. Recorded as acceptable, and the reasoning is in the code so the next
reader does not have to re-derive it.

**AC2 — pencil gone.** The `IconButton` and the `day-plan-item-actions` wrapper are both deleted. The
hero's day-image action is untouched and still renders for an owner.

**AC3 — whole card.** The card's `onClick` calls the existing `handleOpenEditPlan(item)` — no second
edit path. Propagation is stopped at the two call sites, not inside the shared component: the link
`Button` gets its own `onClick={(event) => event.stopPropagation()}`, and `MiniImageStrip` is wrapped
in a `Box` that does the same. The wrapper renders **only when the activity has photos**, so a
photo-less card does not pay for an empty flex child's 6px gap. Browser-confirmed with real mouse
events: clicking the card's dead space opens the editor prefilled with the right activity
(`titleValue: "Museu Nacional de Arte Antiga"`); clicking the 56px thumbnail opens the fullscreen
viewer and *not* the editor (`isViewer: true, isEditor: false`); clicking "Open link" opens no dialog
at all.

**AC4/AC5 — the editability signal, both capabilities.** Verified with `matchMedia` first, then read:

| | `hover: hover` resting | `hover: hover` hovered | `hover: none` (390px) |
|---|---|---|---|
| cursor | `pointer` | `pointer` | `auto` |
| card background | `#FFFFFF` | `#FBF9F4` (`cardAlt`) | `#FFFFFF` |
| card border | `#D9D0BE` | `#4B6358` (accent) | `#D9D0BE` |
| glyph opacity | `0` | `1` | `1` |
| glyph colour | — | `#4B6358` | `#7A7667` (`inkMuted`) |

Only the hovered card changes; its two siblings stayed at resting values in the same reading, so the
rule is scoped to the card and not to the list. No custom cursor image on any device — `cursor` is the
`pointer` keyword or nothing.

**AC6 — keyboard.** `role="button"`, `tabIndex={0}`, and an accessible name of
`"Edit plan item: <title>"`. Focus ring measured as `2px solid rgb(75, 99, 88)` at `outline-offset:
2px`, with `:focus-visible` matching. Enter opens the editor. Space opens the editor **and** `scrollY`
stayed at 150 across the activation, so the `preventDefault` is doing its job. The glyph is a `div`
with `aria-hidden="true"`, no `tabindex` and zero focusable descendants; the card's only inner tab stop
is the pre-existing "Open link" anchor.

*One deliberate deviation:* the AC says `trips.plan.editItemAria` "already carries the right wording",
but it read `"Edit plan item"` flat, which cannot satisfy "an accessible name saying **which** activity
it edits" — eight cards would announce identically. So the key gained a `{title}` placeholder in both
dictionaries (`"Edit plan item: {title}"` / `"Planpunkt bearbeiten: {title}"`) and is formatted with
the existing `formatMessage`, following `trips.dashboard.openTripAria`'s precedent. Same key, one
placeholder — not a new key and not a hardcoded string.

**AC7 — gated.** `canEditPlanning`, not `isOwner` (trap 5). A viewer's card carries no `role`, no
`tabindex`, `cursor: auto`, no glyph and no click handler — confirmed in **both** media modes, since a
gate that only holds on one pointer type is not a gate. A **contributor** keeps everything
(`role: "button"`, `tabIndex: "0"`, `cursor: pointer`, glyph present), which is the substitution the
story warned about.

**AC8 — header.** Breadcrumb deleted entirely. The back button now sits in a `day-hero-header-left`
slot at `leftOffsetPx: 0` from the row's left edge, measured **48.25px** tall × 145.75px wide (the
theme's floor is 44; `minHeight: 48` plus 22px inline padding and 15px type puts it past that). The
right-hand group is still rendered when empty so `space-between` keeps two flex children — verified
with a contributor, for whom the day-image action does not render: `dayImageAction: false` and
`backLinkInLeftSlot: true` in the same reading. The second back affordance at the not-found state was
left alone as instructed.

**AC9/AC10 — copy.** `coverageTitle` is gone from the component and from both dictionaries;
`costCardTitle` reads "Costs today" / "Kosten heute". Browser-confirmed: no "Day coverage" anywhere in
the rendered page, and the sidebar card's title element reads exactly `Costs today`.

**AC11 — DW-44 reproduced, diagnosed and fixed.** This is the finding of the story, so the numbers:

| | 390px | 1440px |
|---|---|---|
| baseline `4978db8` | **25px** overflow, page horizontally scrollable | **169px** overflow |
| after the fix | **0px**, not scrollable | **0px**, not scrollable |

**The story's premise was half right and half wrong, and the half that was wrong is the interesting
part.** The Dev Notes said the span already carries the complete screen-reader-only treatment and so
the diagnosis must be stale. Every property listed there *is* present — but the span's computed width
was **390px at 390px and 1440px at 1440px**, not 1px. The cause is a MUI system unit: in `sx`, a bare
numeric `width`/`height` between 0 and 1 is a *percentage*, so `width: 1, height: 1` compiled to
`width: 100%; height: 100%`. `clip` and `overflow: hidden` still hid the text, which is why nobody saw
it — but `clip` does not shrink an element's layout box, so the span went on occupying its container's
full width inside the scroll box and set `scrollWidth` by itself. DW-44's "positioned but never
clipped" was wrong about the mechanism (it *is* clipped) and right that this span was the culprit.

Fixed by replacing the inline recipe with one `VISUALLY_HIDDEN` constant using explicit `px` strings.
The same broken recipe appeared **twice** in this file — the second on the travel-segment edit button's
label, where it is currently harmless only because an `IconButton` is `position: relative` and 28px
wide, so its 100%×100% span cannot escape. Both call sites now share the constant; leaving the twin
would have re-introduced the bug the first time that button landed in a wider positioned container.
Pinned by a test that asserts the computed `width`/`height` are `1px` — jsdom cannot measure overflow,
so the unit is what gets guarded.

**AC12 — no functional change.** No route, API, schema or data-model change. Full suite green at
647 tests / 96 files, up 1 from the 646 at baseline. Typecheck holds at 152 pre-existing errors (all in
unrelated test files, none in anything this story touched — verified by stashing). ESLint: 0 errors on
every changed file; the repo's 2 pre-existing errors are both in untouched `src/theme.ts`.

**Proven in jsdom vs. proven in a browser.** jsdom carries the DOM contract: pill fill and geometry,
the absent pencil, the card's role/tabindex/accessible name, Enter and Space (via
`fireEvent` returning `false` for the prevented default), the viewer gate, the vanished breadcrumb, the
copy, and the `1px` unit. Everything that needs layout or a media-query engine was proven in Chrome and
is tabulated above: the hover reveal, the touch branch, the 48px touch target, and the overflow
measurement. Nothing in ACs 4, 5, 8 or 11 rests on a jsdom assertion alone.

**Scope note.** DW-31, DW-30, DW-29 and DW-27 were left out as the story directs. AC3 does sharpen
DW-30's tension: the card is now keyboard-operable while the thumbnails inside it remain mouse-only, so
a keyboard user can open the editor but still cannot open a photo.

### File List

- `travelplan/src/components/features/trips/TripDayView.tsx` — cost pill, whole-card edit target,
  hover/touch glyph, header split, coverage label removed, `VISUALLY_HIDDEN` constant (DW-44 fix)
- `travelplan/src/i18n/en.ts` — `coverageTitle` removed, `costCardTitle` retitled, `editItemAria`
  parameterised
- `travelplan/src/i18n/de.ts` — same three changes
- `travelplan/test/tripDayViewLayout.test.tsx` — 12 new cases; updated the assertions that pinned the
  pencil, the old cost position, `coverageTitle` and the old cost-card string
- `_bmad-output/planning-artifacts/ux-designs/ux-TravelPlan-2026-07-27/DESIGN.md` — filled `badge-pill`
  variant recorded as `tl-cost-bg` / `tl-cost-color`
- `_bmad-output/implementation-artifacts/deferred-work.md` — DW-44 closed with the measurements and the
  corrected diagnosis; DW-72 opened for the third copy of the same recipe in `AuthScreenShell.tsx`
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — status to `review`

Not mine: `_bmad-output/planning-artifacts/epics.md` also shows as modified. Story 6.10 was added to
epic 6 by another session while this one was running; nothing in it was touched here.

### Change Log

- 2026-08-01: Story 6.9 implemented. Activity cost becomes a filled accent pill in the card head; the
  per-activity pencil is replaced by a whole-card edit target with a hover/touch glyph, keyboard
  operation and the `canEditPlanning` gate; the hero breadcrumb is dropped and the enlarged back button
  takes the left slot; the coverage label is removed and the cost card retitled.
- 2026-08-01: DW-44 closed **with a fix, not as already-resolved**. Measured 25px of horizontal
  overflow at 390px (169px at 1440px) on the parent commit, traced it to `sx={{ width: 1 }}` compiling
  to `width: 100%` in the visually-hidden coverage-axis span, and fixed both instances of that recipe in
  the file via a shared `VISUALLY_HIDDEN` constant. Re-measured at 0px in both viewports.
