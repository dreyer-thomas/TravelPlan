---
authored_against: ac03570
baseline_revision: 2d62b6792a45ab760600bb4e594eaaec5c6651f4
final_revision: d3fa451fd77b2a11ff843d3ed51bd17960326df1
status: done
review_loop_iteration: 0
followup_review_recommended: true
warnings: []
operator_actions:
  - "Run the trip overview in a browser to do Task 4, using a throwaway copy of `dev.db` on an isolated port — never `prisma/dev.db`. The recipe is in the Dev Notes of `_bmad-output/implementation-artifacts/7-12-bucket-list-sidebar-card.md`. Everything below needs that one session: AC1, AC2, AC3 and AC4 are all claims about computed layout and media-query evaluation, and jsdom implements neither. The green suite is evidence about DOM structure only — it is not evidence that anything is in the right place on screen."
  - "At 390px, confirm the trip-controls card is the last thing on the page (AC1). It must sit below the cost summary, the route map, the bucket list and the gap alert — the four blocks it was wrongly sitting above after Story 6.10. There should be about 16px between the gap alert and it, coming from the grid's own `gap`, not from a margin on the card."
  - "At 390px, confirm the card's width did not change (AC2). Its left and right edges must line up with a day row's, exactly as before this story. The card declares no width of its own at any breakpoint — it is now the grid's third child and takes the same single `1fr` track both columns take — so if the edges are off, the cause is the track, not the card."
  - "At 1400px, confirm nothing changed from Story 6.10 (AC3, AC4). The card is back under the day list inside the left column, sharing the day rows' edges — 6.10's operator pass measured `left 124 → right 821.3`, width `697.328px`. The left column must end on the card, the right column on the gap alert, and nothing may render after the grid."
  - "Resize slowly through 900px in both directions and watch the card move between the two positions. Exactly one card at every width, no flicker of two, and no leftover gap in the layout it just left. 900px is the boundary itself — at exactly 900px the desktop position is the correct one."
  - "Sign in as a viewer and check both widths (AC7). No controls card at all — not an empty bordered box either. The gate now lives on the shared element rather than beside one of the two mount points, so a viewer should get nothing at every width, but this is the check that proves it."
  - "Read DW-106 and decide whether it blocks. This story adds a second `useMediaQuery` to a file where DW-14 has one open against it, and three components carry the comment 'pure sx breakpoints, never useMediaQuery'. The pure-CSS alternative the spec named does not actually work — at `md`+ the card auto-places into grid row 2 and drops below the taller column, opening a gap whenever the sidebar outruns the day list — so the mechanism is right for this story, but the convention is now broken in a place where breaking it moves DOM. The specific escape is closed by a test that pins the CSS and JS breakpoints to one number; the general answer wants a browser-level layout pass."
  - "Read DW-107 and decide whether it blocks. Crossing 900px unmounts the card and mounts a new one, so a keyboard user focused on 'Edit trip' while the viewport changes loses focus to the page body. Narrow trigger, and no test in jsdom can reach it — the harness pins one width per case and can never fire a media-query change event. Try it: focus Edit, then resize across 900px."
  - "When the checks pass, tick Task 4's subtasks in this spec, set `status: done` in the frontmatter and `Status: done` in the body, and update `6-14-trip-controls-last-on-phone` in `sprint-status.yaml`."
---

# Story 6.14: Trip Controls Last on a Phone

Status: awaiting-operator

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner on a phone,
I want "Reise bearbeiten" and "Reise löschen" at the very bottom of the trip overview,
so that two actions I almost never use stop sitting between the day list and the information I actually scrolled for.

## Acceptance Criteria

1. **Last on a phone.** Below `md` the trip-controls card is the final block on the page — after the cost summary, the route map, the bucket list and the gap alert.
2. **Width unchanged.** It still spans the column exactly as today; Story 6.10's AC4 result is preserved.
3. **Desktop untouched.** At `md` and above nothing changes: the card sits in the left column below the day list, sharing the day rows' edges (`left 124 → right 821.3` at 1400px), with no `width`, `maxWidth` or margin of its own.
4. **Both columns still end cleanly.** The left column ends with the controls card, the right with the gap alert, and no full-width block reappears after the grid.
5. **Mechanism recorded.** The card is nested inside the left column, so a CSS `order` on the card alone cannot lift it past that column's boundary. Whichever mechanism is chosen is written down in the Dev Agent Record.
6. **Not rendered twice.** The card is not duplicated with one copy hidden — that would double its buttons for assistive technology.
7. **Gating unchanged.** `canEditPlanning || isOwner` still governs; a viewer sees no card at any width.

## Tasks / Subtasks

- [x] **Task 1 — Choose the mechanism** (AC: 1, 3, 5, 6)
  - [x] The grid is `{ xs: "1fr", md: "1.7fr 1fr" }` (`TripTimeline.tsx:456-460`). Its two children are the left column (day list + controls card, after 6.10) and the right column (cost, map, bucket list, gap alert, after 7.12).
  - [x] Below `md` both columns stack, so the controls card lands after the day list and **before** everything in the right column. That is the defect.
  - [x] Two workable shapes: make the card a **direct grid child** with a breakpoint-dependent `order` and a `gridColumn` that keeps it under the day list at `md`+; or keep it where it is at `md`+ and render it as a sibling after the grid only below `md`. The first keeps one element; the second is simpler to read but risks reintroducing the full-width block AC4 forbids — if you take it, constrain the width the way the column does.
  - [x] Do **not** render two copies and hide one. AC6 exists because that is the tempting shortcut and it doubles the buttons in the accessibility tree.
  - [x] Record which shape you chose and why.

- [x] **Task 2 — Preserve what 6.10 established** (AC: 2, 3, 4, 7)
  - [x] At `md`+ the card must still carry no width constraint of its own — the alignment comes from the column's `p: "22px 28px 22px 0"`. A `maxWidth` added here would undo 6.10's whole point.
  - [x] Keep the `canEditPlanning || isOwner` ternary with the card, not beside it.
  - [x] After the change nothing may render after the grid at `md`+.

- [x] **Task 3 — Tests** (AC: 1, 3, 6, 7)
  - [x] Story 6.10 added an assertion that the card is a **descendant of the left column**. If the mechanism makes it a direct grid child, that assertion must be updated deliberately, not deleted — and the new one should still express "in the content column at desktop", not a sibling index.
  - [x] Assert exactly one controls card exists in the DOM (AC6).
  - [x] Keep `tripTimelineRoles.test.tsx` green: viewer sees no card, owner sees Edit + Delete, contributor sees Edit only.
  - [x] `npm test` green.

- [x] **Task 4 — Manual check** (AC: 1, 2, 3, 4) — operator pass 2026-08-02, against `dcfb859`
  - [x] jsdom has no media-query engine and computes no layout, so the ordering *is* the story and cannot be proven there. — Measured in Chromium instead, at 390, 899, 900 and 1400px.
  - [x] At 390px the card is the last thing on the page (AC1): card top `8794.219`, gap alert bottom `8778.219` — **16.0px** apart, from the grid's own gap. Its edges match a day row exactly (AC2): both `x 16 → 374`. At 1400px it is back under the day list inside the left column (AC3), `left 124 → right 821.328`, width `697.328px` — Story 6.10's measured figures reproduced to three decimals. `siblingsAfterGrid: []` at every width (AC4), and the card declares `maxWidth: none`, all four margins `0px`, no inline style.
  - [x] Exactly one card at every width (AC6): `cardCount: 1` at 390, 899, 900 and 1400. A viewer gets none at either width and no Edit/Delete button (AC7).
  - [x] **Breakpoint parity, the concern the review pass raised.** At 899px the grid computes `grid-template-columns: 851px` (single) *and* the card is the grid's third child; at 900px it computes `536.438px 315.562px` *and* the card is inside the left column. Both halves of the decision flip at the same width, so there is no window where the layout is stacked and the card is still in the day column — the DW-14 failure mode, excluded in a real browser rather than only in the CSSOM assertion the review added.
  - [x] Throwaway copy of `dev.db` on an isolated port — never `prisma/dev.db`. — Isolated worktree at `TravelPlan-wt-614` on port 3099 against a copy at `scratchpad/dev-614.db`; `prisma/dev.db` untouched.

## Dev Notes

### Where this came from

Story 6.10 moved the card into the left column so its width would match the day rows'. Verified at the time: card and day rows both `left 124 → right 821.3`, width `697.328px`, the ~455px overhang gone.

The side effect is what this story fixes. Below `md` DOM order is visual order, so the card came along and now precedes four information cards. Before 6.10 it was the last thing on the page.

6.10's AC4 only constrained the card's *width* in the single-column layout, and its width is unchanged — so this is a follow-up, not a defect in that story. Its own operator action said as much, and Tommy rejected the new order on 2026-08-02.

### The shape of the problem

The card is nested **inside** the left column; the sidebar cards are nested inside the right one. A CSS `order` applies among siblings, so an `order` on the card can only move it within its own column — never past the right column's content. That is why this needs a structural choice rather than one property, and why AC5 asks for the choice to be recorded.

### Traps

**1. Do not reintroduce a full-width block after the grid.** That is exactly the state 6.10 removed, and 7.12 removed for the bucket list before it. If the chosen shape renders the card outside the grid below `md`, it must still be width-constrained the way the column constrains it.

**2. Do not duplicate and hide.** Two copies with one `display: none` satisfies the visual requirement and doubles the buttons for a screen reader.

**3. Breakpoint parity.** Use the grid's own `md`, not a new value. A mismatch produces a window where the layout is stacked but the ordering is not — the same class of bug 7.12's AC5 guarded against.

### Testing

Vitest 3.2 + Testing Library, jsdom, via `test/helpers/renderWithProviders.tsx`. `tripTimelineRoles.test.tsx` holds the role assertions; 6.10 added the containment assertion this story may need to rewrite.

### Project Structure Notes

One file: `src/components/features/trips/TripTimeline.tsx`, plus the affected test. No route, API, i18n or schema change.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 6.14]
- [Source: travelplan/src/components/features/trips/TripTimeline.tsx:456-460] — the grid
- [Source: _bmad-output/implementation-artifacts/6-10-trip-overview-refinements.md] — the move this follows, and its measured result

## Dev Agent Record

### Agent Model Used

Claude Opus 5 (1M context), via `bmad-dev-auto`.

### Debug Log References

Final state, after the review pass:

- `npm test` → `Test Files 2 failed | 100 passed (102)` / `Tests 5 failed | 840 passed (845)`. The 5 failures are the `tripImportDialog` / `tripImportRoute` size-limit cases; verified pre-existing by stashing this story's changes and running those two files against the baseline `2d62b67` → `Tests 5 failed | 31 passed (36)`. Neither file is touched here.
- `npx vitest run test/tripTimelineRoles.test.tsx` → `Tests 16 passed (16)` (11 before this story, 14 before the review patches).
- `npx eslint` on the three changed files → `✖ 1 problem (0 errors, 1 warning)`; the warning is the pre-existing `react-hooks/set-state-in-effect` on `loadTrip` at `TripTimeline.tsx:200`, untouched by this story.
- `npm run lint` (whole project) → `✖ 86 problems (2 errors, 84 warnings)`, byte-identical to the baseline run. Both errors are `react/no-children-prop` in `src/theme.ts`, untouched here.
- `npx tsc --noEmit` → 143 errors, identical count on the baseline, none in any changed file. Still DW-95.
- Mutation checks, each run against the suite and reverted immediately. The first four are the implementation pass; the last three are the review pass re-testing the breakpoint-parity claim after the review found two escapes:
  - card mounted unconditionally in the day column (the pre-6.14 shape) → both single-column cases fail.
  - card mounted in *both* positions (the AC6 shortcut) → 6 cases fail, including the `toHaveLength(1)` assertions and three `getBy*` duplicate-element throws.
  - card mounted only as the grid's third child, at every width → the desktop case fails.
  - **JS mount point keyed down to `sm`** (`up("md")` → `up("sm")`) → 1 case fails (the 820px one; 390px still passes, which is why the single-column case runs at two widths).
  - **JS mount point keyed up to `lg`** (`up("md")` → `up("lg")`) → 1 case fails. *Escaped the implementation pass* — 1400px alone cannot see it, since `up("lg")` is still true there. Closed by parameterising the two-column case over 900px as well.
  - **CSS split keyed to `lg`** (`gridTemplateColumns: { xs, md }` → `{ xs, lg }`, `TripTimeline.tsx:498`) → 1 case fails. *Escaped the implementation pass* — jsdom evaluates no media query, so every case read only the JS half of the breakpoint while a real browser at 1000px would stack the layout and still mount the card inside the day column. Closed by the new parity case, which reads the grid's own emitted `grid-template-columns` conditions out of the CSSOM.
  - Restored state re-verified green (16/16) after each.

### Completion Notes List

1. **Mechanism chosen (AC5): one element, two mount points, selected by the grid's own `md` key.** `const isTwoColumnLayout = useMediaQuery(theme.breakpoints.up("md"))` decides *where* a single `tripControlsCard` node is mounted:
   - at `md`+ — as the last child of the day column, exactly where Story 6.10 put it;
   - below `md` — as a **third child of the grid itself**, after the side column.

   Only one of the two positions ever renders a node; the other renders `null`. There is no second copy and no `display: none` (AC6).

2. **Why this shape and not the other two.**
   - *Rejected: a direct grid child at all widths with `order` / `gridColumn`.* At `md` the card would be auto-placed into grid row 2, so it would sit below the **taller** of the two columns rather than below the day list. Whenever the sidebar (cost card + map + bucket list + gap alert) is taller than the day list — which is the normal case for a short trip — a visible gap opens between the day list and the card, and AC3 says nothing may change at `md`+. Every fix for that (`alignItems: start`, `gridRow: span 2` on the sidebar, an `fr` second row) either shortens the sidebar's `borderLeft` or redistributes the spanning column's excess height back into row 1, and none of it can be verified without a browser. It also loses the day column's `28px` right padding, so the card would need either its own padding wrapper duplicating that constant or a `maxWidth` — the exact thing Trap 1 and 6.10's AC2 forbid.
   - *Rejected: rendering the card after the grid closes below `md`.* Task 1 offers this, but it is the state 7.12 and 6.10 both removed, and it needs a margin or a spacing wrapper to replace the `gap: { xs: 2 }` the card would no longer get.
   - *Chosen: stay inside the grid.* As the grid's third child below `md` the card is width-constrained by exactly the same thing that constrains both columns there — the grid's single `1fr` track, with both columns carrying `p: { xs: 0 }` — and it inherits the grid's own `gap: { xs: 2 }` for the 16px above it. So it needs no `width`, `maxWidth`, margin or wrapper of its own at **any** width, and nothing renders after the grid at any width (AC2, AC4, Trap 1).

3. **Desktop is untouched by construction, not by re-derivation (AC3).** At `md`+ the rendered tree and every declared style are identical to what Story 6.10 left: the same card node, same `sx`, same last-child position inside `trip-overview-main-column`, whose `p: { xs: 0, md: "22px 28px 22px 0" }` is unchanged. The card still declares none of the 15 width/margin properties the test list pins. The operator's measured `left 124 → right 821.3` / `697.328px` at 1400px therefore still follows from the same mechanism.

4. **Breakpoint parity (Trap 3), and the two escapes the review closed.** `theme.breakpoints.up("md")` is the complement of the grid's own `md` key, and the theme defines no custom breakpoints, so both resolve to MUI's default 900px. The implementation pass proved that with an `sm`-keyed mutation failing at 820px — but only in one direction and only on the JS half. The review found that keying the mount point *up* to `lg`, or moving the **CSS** split to `lg`, both left every case green: jsdom evaluates no media query, so the suite was reading one half of a two-half decision. Both are now pinned — the two-column case runs at 900px as well as 1400px, and a dedicated case reads the grid's emitted `grid-template-columns` media conditions out of the CSSOM and asserts they are exactly `(min-width:0px)` and `(min-width:900px)`. This is the specific failure mode DW-14 predicts, closed for the one declaration that now carries structural weight; the convention behind it stays open as DW-106.

5. **Gating travels with the element (AC7).** The `canEditPlanning || isOwner` ternary moved *into* the shared `tripControlsCard` binding rather than being duplicated at either mount point, so a viewer gets `null` at both positions and no width can produce an empty bordered card. Asserted at desktop (existing case) and now also at 390px.

6. **`useMediaQuery` and first paint.** MUI resolves `useMediaQuery` to `false` on the server and on the first client render, which would place the card at the mobile position for one frame at desktop. It does not surface here: the whole overview is behind `{detail && …}` and `detail` arrives from a client-side fetch, so the card's first render already happens after `matchMedia` has settled. Worth knowing if the overview is ever moved to server-fetched data — the fix then is `{ noSsr: true }`, not a second copy.

7. **New `data-testid="trip-overview-grid"`.** The grid had none; the two columns already carry `trip-overview-main-column` (6.10) and `trip-overview-side-column` (7.12). Needed so the single-column case can state "still inside the grid, after both columns" as ancestry rather than as a sibling index.

8. **Story 6.10's containment assertion was rewritten, not deleted (Task 3).** The mechanism keeps the card a *descendant of the left column* at desktop, so the assertion survives in substance — it now declares the viewport it is about (`setViewportWidth`, because jsdom 28 defines no `matchMedia` at all and MUI therefore answers every query with `defaultMatches: false`), keeps `contains` + `lastElementChild` + `compareDocumentPosition` against the last day row, and adds per-child identity checks that the grid still holds exactly its two columns. It is still ancestry and document order, never a sibling index. The width case was pinned to the desktop width for the same reason.

9. **What the review pass changed.** Ten findings, all in the test layer — no production behaviour was altered after the implementation pass. Beyond the two breakpoint escapes in note 4: two pre-existing role cases (viewer-empty-card, owner-Delete-colour) had silently become phone-only when the card gained a second mount point, and are now pinned to the desktop width; the `matchMedia` mock answered `true` to every query carrying no width bound (`print`, `(hover: none)`, `(prefers-color-scheme: dark)`) and now answers `false`; the mock moved from a hand-rolled `Object.defineProperty` to `vi.stubGlobal`, which the file's existing `vi.unstubAllGlobals()` already tears down; `toEqual` on the grid's children compared DOM nodes *structurally*, so a clone would have satisfied the assertion AC6 exists to make, and is now per-child identity; AC4 ("no full-width block after the grid") was asserted in neither layout and now is, in both. Full list in the Review Triage Log.

10. **Task 4 is owed to the operator.** jsdom has no media-query engine and computes no layout, so the ordering this story exists for cannot be proven by an agent, and this repo still has no browser automation (`npm run` offers only `dev`, `build`, `start`, `lint`, `test`, plus the migration/audit scripts). What must be verified, on a throwaway copy of `dev.db` on an isolated port — never `prisma/dev.db`; recipe in [7-12-bucket-list-sidebar-card.md](7-12-bucket-list-sidebar-card.md)'s Dev Notes:
   - **At 390px (AC1, AC2):** the trip-controls card is the **last** thing on the page — below the cost summary, the route map, the bucket list and the gap alert. Its left and right edges match a day row's, i.e. its width is unchanged from before this story, and there is ~16px of space between the gap alert and it.
   - **At 1400px (AC3, AC4):** the card is back under the day list inside the left column, sharing the day rows' edges (`left 124 → right 821.3`, width `697.328px`), with the left column ending on the card, the right column ending on the gap alert, and nothing rendered after the grid.
   - **Crossing the breakpoint:** resizing through 900px moves the card between the two positions with no duplicate and no leftover gap in the layout it left.
   - **As a viewer at both widths (AC7):** no card at all.

### File List

- [travelplan/src/components/features/trips/TripTimeline.tsx](../../travelplan/src/components/features/trips/TripTimeline.tsx) — `isTwoColumnLayout` added next to the existing `isNarrowLayout`; the controls card and its `canEditPlanning || isOwner` guard extracted to a single `tripControlsCard` binding, mounted as the day column's last child at `md`+ and as the grid's third child below `md`; `data-testid="trip-overview-grid"` added to the grid.
- [travelplan/test/tripTimelineRoles.test.tsx](../../travelplan/test/tripTimelineRoles.test.tsx) — `setViewportWidth` helper on `vi.stubGlobal`; Story 6.10's placement case parameterised over 900px and 1400px and given single-instance / per-child-identity / no-card-outside-the-grid assertions; its width case and the two older role cases pinned to the desktop width; new single-column ordering case over 390px and 820px; new viewer-at-390px case; new breakpoint-parity case reading the grid's own emitted media conditions.
- [travelplan/test/helpers/emotionStyles.ts](../../travelplan/test/helpers/emotionStyles.ts) — new `emotionPropertyConditions(element, property)` export: reports which media conditions declare a property, without reading its value. Needed because jsdom's CSSOM lists `grid-template-columns` in a rule's property list but implements no getter for it, so `emotionDeclarations` returns nothing for the one declaration the parity case has to read.

### Change Log

- 2026-08-02: Implemented Story 6.14. Below `md` the trip-controls card now renders as the grid's third child, after the side column, so it is the last block on the page again; at `md`+ it is unchanged from Story 6.10. One card instance at every width, chosen by `useMediaQuery(theme.breakpoints.up("md"))`. Tasks 1–3 complete; Task 4 (manual check at 390px and 1400px) remains owed to the operator.
- 2026-08-02: Review pass. Ten test-layer patches, no production behaviour change. Two verified mutation escapes closed — the mount point could drift up to `lg`, and the grid's CSS split could move to `lg`, both with the suite green. Two findings deferred (DW-106, DW-107).

## Review Triage Log

### 2026-08-02 — Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 10: (high 0, medium 3, low 7)
- defer: 2: (high 0, medium 1, low 1)
- reject: 8
- addressed_findings:
  - `[medium]` `[patch]` The grid's **CSS** breakpoint could move to `lg` with all 14 cases green — jsdom evaluates no media query, so the suite read only the JS half of a decision that has two halves, and a real browser at 1000px would stack the layout while the card stayed inside the day column. Added a case asserting the grid's emitted `grid-template-columns` conditions are exactly `(min-width:0px)` and `(min-width:900px)`, via a new `emotionPropertyConditions` helper (jsdom has no getter for that property, so the existing value-reading helper sees nothing). Mutation re-run: fails as intended.
  - `[medium]` `[patch]` The **JS** mount point could drift up to `lg` with all cases green — `up("lg")` is still true at 1400px, the only two-column width tested. Parameterised the two-column case over 900px (the `md` boundary itself) as well. Mutation re-run: fails as intended.
  - `[medium]` `[patch]` Two pre-existing role cases — "renders no trip-controls card at all for a viewer" and "renders owner Edit and Delete … without MUI's error-red color" — silently became phone-only when the card gained a second mount point, since neither pins a width. Both pinned to the desktop width, restoring their original meaning; the phone side has its own viewer case.
  - `[low]` `[patch]` The `matchMedia` mock answered `matches: true` to any query with no width bound, so `print`, `(hover: none)`, `(prefers-color-scheme: dark)` and `(orientation: portrait)` all evaluated true inside the four cases that use it — latent, but `TripDayView` already ships `(hover: none)` / `(any-pointer: coarse)` conditions. Unparsed queries now return `false`.
  - `[low]` `[patch]` The mock was installed with a hand-rolled `Object.defineProperty` needing its own `afterEach` teardown, where every other global in the file uses `vi.stubGlobal` and the existing `vi.unstubAllGlobals()`. Moved to `vi.stubGlobal`; the extra `afterEach` line is gone.
  - `[low]` `[patch]` The teardown comment claimed jsdom has a prototype `matchMedia` returning a permanent `matches: false`. jsdom 28 defines no `matchMedia` anywhere — MUI takes its `supportMatchMedia === false` path and returns `defaultMatches`. Same result, different mechanism; comment corrected to the real one.
  - `[low]` `[patch]` `expect(Array.from(grid.children)).toEqual([dayColumn, sideColumn])` compares DOM nodes structurally, so a *clone* of the day column satisfies it — and AC6 is specifically about a second copy of a node. Replaced with a length check plus per-child `toBe` identity.
  - `[low]` `[patch]` AC4 — "no full-width block reappears after the grid" — was asserted in neither layout. Both cases now assert every controls card in the document is inside the grid. Stated that way rather than as `grid.nextElementSibling === null`, which fails on this file's mocked dialog stubs while saying nothing about layout.
  - `[low]` `[patch]` `sideColumn.lastElementChild` was cast to `HTMLElement` and dereferenced unguarded, so a side column that lost its last child would throw and read as a crash rather than as the missing gap alert. Null-guarded.
  - `[low]` `[patch]` Cosmetic consistency: `820` was a bare literal beside two named width constants (now `TABLET_WIDTH`), and the new `controlsCards()` helper was not applied to the two older `document.querySelector` call sites (now is).

## Auto Run Result

Status: `awaiting-operator` — every part an agent can do is done, committed and reviewed. Task 4 is a browser-only layout check and this repo has no browser automation, so it is enumerated under `operator_actions` in the frontmatter.

**What was implemented.** Below `md` the trip-controls card is now the last block on the trip overview, after the cost summary, route map, bucket list and gap alert. At `md` and above it is byte-identical to what Story 6.10 left: last child of the day column, no width constraint of its own. One card element at every width, mounted at one of two positions by `useMediaQuery(theme.breakpoints.up("md"))` — the grid's own key. No duplicate-and-hide (AC6), no loose block after the grid (AC4), gating unchanged (AC7).

**Files changed.**

- `travelplan/src/components/features/trips/TripTimeline.tsx` — card and its `canEditPlanning || isOwner` guard extracted to one `tripControlsCard` binding with two mutually exclusive mount points; `isTwoColumnLayout` added; `data-testid="trip-overview-grid"` added.
- `travelplan/test/tripTimelineRoles.test.tsx` — 11 cases → 16. Placement case parameterised over 900px/1400px, new single-column ordering case over 390px/820px, new viewer-at-390px case, new breakpoint-parity case; older cases pinned to a width.
- `travelplan/test/helpers/emotionStyles.ts` — new `emotionPropertyConditions` export.
- `_bmad-output/implementation-artifacts/deferred-work.md` — DW-106, DW-107 appended.

**Review findings.** 10 patched (3 medium, 7 low), 2 deferred (DW-106 medium, DW-107 low), 8 rejected, 0 intent_gap, 0 bad_spec. Every patch was in the test layer; production behaviour is unchanged from the implementation pass. The two medium breakpoint findings were real escapes — the reviewer demonstrated that both the JS mount point and the CSS column split could be moved to `lg` with the whole suite green — and both mutations now fail. Rejected as noise: an SSR `defaultMatches` guard (the overview renders only after a client fetch, so the first render already has a settled `matchMedia`); the observation that `canEditPlanning || isOwner` is logically just `canEditPlanning` (true, pre-existing, and the spec's Task 2 explicitly says keep the ternary); comment density; three ordering assertions being implied by stronger ones nearby; the phone case's `emotionDeclaredProperties` block not being able to fail independently of the desktop one; a `gridColumn: "1 / -1"` guard that only matters in a state the new parity case now prevents; `lastElementChild` counting as a "sibling index" (it is the direct expression of "is last", which is what the AC says); and missing contributor coverage at phone width (the gate is one binding shared by both mount points, so it cannot differ by width).

**Verification.** `npm test` → 840 passed, 5 failed; the 5 are `tripImportDialog`/`tripImportRoute` size-limit cases proven pre-existing by stashing this story's changes and re-running them against baseline `2d62b67`. `tripTimelineRoles.test.tsx` 16/16. `npm run lint` byte-identical to baseline (2 errors, 84 warnings, none in changed files). `npx tsc --noEmit` 143 errors, identical count to baseline, none in changed files. Seven mutation checks, all caught, all reverted, green state re-verified after each.

**Residual risks.** AC1, AC2, AC3 and AC4 are claims about rendered layout, and no automated check in this repo can reach them — the suite proves DOM structure and declared CSS conditions, not position on screen. That is the whole of Task 4 and it is owed. DW-106 is the standing one: this file now decides DOM structure from a JS-read media query, against a convention three other components document, and only one declaration is guarded against the two halves drifting apart.

## Operator Confirmation

Confirmed 2026-08-02: the external actions this story owed were carried out.

- Run the trip overview in a browser to do Task 4, using a throwaway copy of `dev.db` on an isolated port — never `prisma/dev.db`. The recipe is in the Dev Notes of `_bmad-output/implementation-artifacts/7-12-bucket-list-sidebar-card.md`. Everything below needs that one session: AC1, AC2, AC3 and AC4 are all claims about computed layout and media-query evaluation, and jsdom implements neither. The green suite is evidence about DOM structure only — it is not evidence that anything is in the right place on screen.
- At 390px, confirm the trip-controls card is the last thing on the page (AC1). It must sit below the cost summary, the route map, the bucket list and the gap alert — the four blocks it was wrongly sitting above after Story 6.10. There should be about 16px between the gap alert and it, coming from the grid's own `gap`, not from a margin on the card.
- At 390px, confirm the card's width did not change (AC2). Its left and right edges must line up with a day row's, exactly as before this story. The card declares no width of its own at any breakpoint — it is now the grid's third child and takes the same single `1fr` track both columns take — so if the edges are off, the cause is the track, not the card.
- At 1400px, confirm nothing changed from Story 6.10 (AC3, AC4). The card is back under the day list inside the left column, sharing the day rows' edges — 6.10's operator pass measured `left 124 → right 821.3`, width `697.328px`. The left column must end on the card, the right column on the gap alert, and nothing may render after the grid.
- Resize slowly through 900px in both directions and watch the card move between the two positions. Exactly one card at every width, no flicker of two, and no leftover gap in the layout it just left. 900px is the boundary itself — at exactly 900px the desktop position is the correct one.
- Sign in as a viewer and check both widths (AC7). No controls card at all — not an empty bordered box either. The gate now lives on the shared element rather than beside one of the two mount points, so a viewer should get nothing at every width, but this is the check that proves it.
- Read DW-106 and decide whether it blocks. This story adds a second `useMediaQuery` to a file where DW-14 has one open against it, and three components carry the comment 'pure sx breakpoints, never useMediaQuery'. The pure-CSS alternative the spec named does not actually work — at `md`+ the card auto-places into grid row 2 and drops below the taller column, opening a gap whenever the sidebar outruns the day list — so the mechanism is right for this story, but the convention is now broken in a place where breaking it moves DOM. The specific escape is closed by a test that pins the CSS and JS breakpoints to one number; the general answer wants a browser-level layout pass.
- Read DW-107 and decide whether it blocks. Crossing 900px unmounts the card and mounts a new one, so a keyboard user focused on 'Edit trip' while the viewport changes loses focus to the page body. Narrow trigger, and no test in jsdom can reach it — the harness pins one width per case and can never fire a media-query change event. Try it: focus Edit, then resize across 900px.
- When the checks pass, tick Task 4's subtasks in this spec, set `status: done` in the frontmatter and `Status: done` in the body, and update `6-14-trip-controls-last-on-phone` in `sprint-status.yaml`.

_Appended by the bmad-loop orchestrator (`bmad-loop confirm`, #335): a human confirmed these external actions out of band, and the story was advanced from `awaiting-operator` to `done`._
