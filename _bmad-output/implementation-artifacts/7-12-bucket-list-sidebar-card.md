---
baseline_revision: e66c8e4
final_revision: f2702b7
status: done
followup_review_recommended: true
operator_actions:
  - "Seed an isolated SQLite DB on a non-default port (never travelplan/prisma/dev.db - it holds real trip data; follow the worktree isolation precedent from Stories 7.2, 7.3, 7.8, 7.9 and 7.11) and start the dev server against it. Note the login route is rate-limited: repeated logins return 429."
  - "Add at least 8 bucket-list items to a trip you own, and give most of them BOTH a description and a position/location so the rows are the fully populated three-line shape the height cap was derived from. Include one item with a long title (60+ characters) so you can see what wrapping does in the narrow sidebar column."
  - "Open that trip's overview at a desktop width and confirm the bucket list is now the third card in the right-hand sidebar, below 'Route' - not a full-width block at the bottom of the page - and that it has exactly ONE border, no doubled edge."
  - "Expand the card and count how many rows are visible before the cut. The cap is 400.125px, derived as 72.75px per fully populated row x 5.5, and the acceptance criterion asks for roughly 5-6 rows with a half row visible at the cut. If wrapping makes it show noticeably fewer (3-4) or more (7+), change ONLY the BUCKET_LIST_VISIBLE_ROWS constant in travelplan/src/components/features/trips/TripBucketListPanel.tsx, update the expected value in the tripBucketListPanel.test.tsx drift pin, and record the measured row height and the new value in the Dev Agent Record."
  - "With the card expanded, confirm the card header, the entry-count line and the round + add button all stay visible and stationary while the rows scroll underneath them. If the whole card scrolls instead, the cap landed on the card Box rather than on the List."
  - "Tab to the row list and confirm the arrow keys and Page Up/Page Down scroll it, that Tab continues onward into the row edit/delete buttons rather than cycling inside the list, and that Shift+Tab leaves it cleanly. Then judge whether the extra tab stop the list introduces is acceptable - it is present at every viewport width, including below md where nothing actually scrolls."
  - "Narrow the window below 900px and confirm the overview collapses to one column and the bucket list is NO LONGER capped or internally scrollable there - the card should grow to its full content height with only the page scrolling. A scrollbar inside the card at phone width is the exact failure AC5 forbids."
  - "Delete every bucket-list item and confirm the empty card is compact: the label, the count line and one short empty message, with no reserved blank space, no filler and no illustration. It should be visibly the shortest card in the sidebar."
  - "Decide the sidebar ordering. The bucket list is now inserted between 'Route' and the amber 'Handlungsbedarf' gap alert, because the story prescribed 'directly after the map panel' - which puts a reference panel above an actionable warning. If you want the gap alert to stay adjacent to the map, move the bucket-list block in TripTimeline.tsx below the firstGapDay block; the containment test asserts ancestry rather than sibling index, so nothing breaks."
  - "With a screen reader (VoiceOver: Cmd+F5), tab onto the expanded row list and confirm the duplicated announcement is tolerable - the card heading says 'Bucket list', then the list announces itself as 'Bucket list, list, N items'. If it grates, delete the aria-label line on the List in TripBucketListPanel.tsx and the toHaveAccessibleName assertion in tripBucketListPanel.test.tsx; the tab stop then has no name, which is the trade-off."
  - "Share the trip with a second account as a viewer and again as a contributor, sign in as each, and confirm neither sees a bucket-list card anywhere on the trip overview. Automated tests cover this, but the mount moved, so confirm it once for real."
  - "If every check above passes, edit _bmad-output/implementation-artifacts/7-12-bucket-list-sidebar-card.md: tick both of Task 6's subtasks to [x], set status: done in BOTH the frontmatter and the body's 'Status:' line, change the '## Auto Run Result' Status line to done, set 7-12-bucket-list-sidebar-card to done in sprint-status.yaml, and append a Change Log entry dated with the verification date. (DW-66 tracks why this bookkeeping is manual; 7-9 and 7-11 both drifted on exactly this step, so please do not add a third.)"
---

# Story 7.12: Bucket List as a Trip Overview Sidebar Card

Status: awaiting-operator

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner,
I want the trip-level bucket list to sit in the trip overview's sidebar alongside the cost and route cards,
so that my collected ideas read as one of the overview's reference panels instead of a full-width block trailing off the bottom of the page.

## Acceptance Criteria

1. **Relocation.** `TripBucketListPanel` renders inside the trip overview's side column, below `TripOverviewMapPanel`, instead of outside the layout grid. Its owner-only gating is preserved exactly: a viewer and a contributor see no bucket-list card.
2. **Bounded height.** Expanded, the card grows with its content to roughly 5–6 rows, then holds a maximum height and scrolls internally. The cap is derived from the row metric, not written as a magic pixel value.
3. **Scroll accessibility.** The scroll container is reachable and operable by keyboard and does not trap focus.
4. **Compact empty state.** With no items, the card shows the existing `trips.bucketList.empty` line inside the card shell — no minimum height, no filler, no illustration.
5. **Responsive.** Below `md` the overview is a single column; there the height cap does not apply, so no scroll region is nested inside the page's own scroll.
6. **No functional change.** Collapse/expand, add, edit, delete, add-to-day-plan and Story 4.4's collapsed-by-default count line all behave exactly as today.
7. **Spec updated.** `EXPERIENCE.md` records the bucket list as Screen A's third sidebar card, and its `[ASSUMPTION]` marker for the empty bucket-list state (`:81`) is replaced by the confirmed treatment including the compactness constraint.

## Tasks / Subtasks

- [x] **Task 1 — Move the mount** (AC: 1)
  - [x] `TripTimeline.tsx:785` currently renders `{isOwner ? <TripBucketListPanel tripId={detail.trip.id} /> : null}` *after* the layout grid's closing tag. Move that expression inside the side column, directly after `<TripOverviewMapPanel … />`.
  - [x] Move the whole ternary, not just the component — the `isOwner` guard is the gating AC1 requires and `tripTimelineRoles.test.tsx` asserts it.
  - [x] Do **not** add a card shell. Story 7.8 already gave the panel `tokens.card` / `borderStrong` / 8px / 18px padding; wrapping it again would double the border.
  - [x] Check the side column's vertical rhythm: the cost card and map panel are separated by the column's existing gap. The bucket list must join that rhythm, not introduce a second spacing rule.

- [x] **Task 2 — Bound the expanded height** (AC: 2, 3, 5)
  - [x] The rows render through MUI `List` / `ListItem`. Put `maxHeight` + `overflowY: "auto"` on the `List`, not on the card `Box` — the card's header and add affordance must stay visible while the rows scroll.
  - [x] Derive the cap from the row metric rather than hardcoding: measure one `ListItem`'s height (padding + line-height as the component actually renders it) and express the cap as that value × 5.5, so a half row is visible at the cut and the list reads as scrollable. Record the measured row height and the resulting value in the Dev Agent Record.
  - [x] Scope the cap to `md` and up. At `xs`/`sm` the overview collapses to one column (`TripTimeline.tsx:459`) and a capped scroll region there nests a scroll inside the page's own — AC5 forbids it. Use the same breakpoint the grid uses, not a new one.
  - [x] Give the scroll container `tabIndex={0}` so it is keyboard-scrollable. Note the trade-off in the Dev Agent Record: this adds a tab stop before the rows. It is the standard fix and AC3 requires operability, but a reviewer should see it was a decision.

- [x] **Task 3 — Empty state** (AC: 4)
  - [x] `TripBucketListPanel.tsx:394` computes `emptyState`; `:473-475` renders `trips.bucketList.empty`. Confirm the card carries no `minHeight` and that the empty branch renders only the label, the count line and the empty message.
  - [x] The cap from Task 2 must not become a floor — `maxHeight` only, never `height`.

- [x] **Task 4 — Update the design spec** (AC: 7)
  - [x] `EXPERIENCE.md`'s Information Architecture: add the bucket list to Screen A's sidebar contents, mirroring how `:39` already describes it for Screen B.
  - [x] `EXPERIENCE.md:81`: replace the `[ASSUMPTION]` marker and its "Flag for confirmation in the next review pass" note with the confirmed treatment — short empty message inside the card shell, no illustration, **and the card stays compact**. Attribute the confirmation to 2026-08-01.

- [x] **Task 5 — Tests** (AC: 1, 2, 4, 6)
  - [x] `tripTimelineRoles.test.tsx` already asserts the viewer/contributor cases. Re-run and fix any that depended on the panel's position in the DOM rather than its presence.
  - [x] `tripBucketListPanel.test.tsx` (7 tests) covers collapse/expand, the add dialog, the 44px hit area, `:last-child` divider suppression and list-role preservation. All must still pass unchanged — if one breaks, the move changed behaviour it should not have.
  - [x] Add: the panel renders inside the side column (assert an ancestor relationship, not a sibling index); the empty card carries no `minHeight`; the `List` carries `overflowY: auto` with a `maxHeight` at `md` and neither below it.
  - [x] Run the full suite: `npm test`.

- [ ] **Task 6 — Manual check** (AC: 2, 3, 5)
  - [ ] jsdom does not lay out, so AC2 and AC5 cannot be proven there. Seed a throwaway copy of `dev.db` on an isolated port (never `prisma/dev.db` — it holds real trip data; see Dev Notes) with **at least 8 bucket-list items**, and confirm: the card caps and scrolls at `md`+, scrolls by keyboard, does not cap at `xs`, and that an empty card is compact.
  - [ ] Record measured values in the Dev Agent Record.

## Dev Notes

### Why this story exists

The bucket list appears in **no Screen A mockup at all**. `mockups/trip-overview-day-detail.html` gives Screen A exactly two `side-col` cards — "Kosten bisher" and "Route" — and draws the bucket list only in Screen B's sidebar (`:1070`). `EXPERIENCE.md:39` explains why Screen B has it: the bucket list and day map "correspond to real, already-existing product features … that were **simply missing from earlier mockups in this pass** and were added back as sidebar cards using existing card conventions." That reasoning was never carried over to Screen A, so the panel stayed where it had always been — full width, below the grid.

Story 7.8 restyled it in place, exactly as its scope prescribed, and did not touch placement. This story finishes the job. It is not a defect in 7.8.

### The two constraints are Tommy's, decided 2026-08-01

- **Height:** grow to ~5–6 rows, then cap and scroll. His words: at twenty collected ideas an unbounded card becomes "optisch übermächtig" next to the day list.
- **Empty state:** no large white card when there is nothing in it.

The second one settles the open `[ASSUMPTION]` at `EXPERIENCE.md:81`, which had proposed an empty-state treatment and asked for confirmation in a later review pass. Task 4 replaces the marker; leaving it standing would invite the next reader to re-open a settled question.

### Current state at `33abbdf`

- `TripTimeline.tsx:459` — the layout grid: `gridTemplateColumns: { xs: "1fr", md: "1.7fr 1fr" }`, `gap: { xs: 2, md: 0 }`.
- The side column is the grid's second child and already contains the cost card and `TripOverviewMapPanel` (`:747`).
- `TripTimeline.tsx:785` — `{isOwner ? <TripBucketListPanel tripId={detail.trip.id} /> : null}`, outside the grid.
- `TripBucketListPanel.tsx` — card shell already correct (`tokens.card`, `1px solid tokens.borderStrong`, `8px`, `18px` padding), header with `labelCaps` `component="h5"` title plus a count line, a 44×44 add affordance, and rows through `List`/`ListItem`.

### Traps

**1. The card shell already exists.** 7.8 put it there. Wrapping the panel in another `Box` with a border is the obvious mistake and produces a double edge — the same class of problem 7.11's `MuiAlert` work had to reason about.

**2. `isOwner` must travel with the component.** Moving only `<TripBucketListPanel />` and leaving the ternary behind would render the panel for viewers and contributors, silently reversing gating that `tripTimelineRoles.test.tsx` asserts and that Story 7.8's operator pass verified in a browser.

**3. `maxHeight`, never `height`.** AC4 wants a compact empty card. A fixed `height` would satisfy AC2 and break AC4 in the same line.

**4. The breakpoint must be the grid's.** `TripTimeline.tsx:459` uses `md`. Introducing `sm` or a raw media query for the cap creates a window where the layout is stacked but the list is still capped — exactly the nested-scroll case AC5 forbids.

**5. Collapsed by default.** Story 4.4 made the panel start collapsed with a count line. So the cap only ever applies once the user expands, and an automated test that never expands will not exercise it.

**6. Do not use `prisma/dev.db` for the manual check.** It holds Tommy's real trip data. The precedent from Stories 7.2, 7.3, 7.8, 7.9 and 7.11 is a throwaway copy on an isolated port. For 7.11's verification this was done as: copy `prisma/dev.db` to a scratch path, `git worktree add` a detached checkout, copy `node_modules` into it with `cp -Rc` (APFS clone, ~6s), then run `npx next dev -p 3099` with `DATABASE_URL=file:<copy>` and `UPLOADS_PUBLIC_ROOT=<scratch>/public`. A second `next dev` in the *same* directory is refused by Next 16, which is why the worktree is needed. Note the login route is rate-limited — repeated logins return 429.

### Testing

Vitest 3.2 + Testing Library, jsdom, rendered through `test/helpers/renderWithProviders.tsx`. `tripBucketListPanel.test.tsx` and `tripTimelineRoles.test.tsx` are the two suites that constrain this change; both were extended by Story 7.8 and are the regression net for AC1 and AC6.

jsdom computes no layout, so `maxHeight`/`overflowY` can only be asserted as style properties, never as observed clipping. AC2, AC3 and AC5 need Task 6's browser pass to be genuinely verified — assert the styles in the suite, prove the behaviour in the browser, and say which is which in the Dev Agent Record.

### Project Structure Notes

Files touched: `src/components/features/trips/TripTimeline.tsx` (move the mount), `src/components/features/trips/TripBucketListPanel.tsx` (height cap, empty-state check), `EXPERIENCE.md`, and the two test suites. No new files, no new dependencies, no route, API, schema or i18n change.

### Sequencing

Runs after 7.11, which also touches `TripTimeline.tsx`. At the time of writing 7.11 is committed (`33abbdf`) but still `awaiting-operator`; its confirm adds one further commit that touches no source file.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 7.12]
- [Source: ux-designs/ux-TravelPlan-2026-07-27/EXPERIENCE.md] — `:39` sidebar-card rationale, `:81` the empty-state `[ASSUMPTION]`
- [Source: ux-designs/ux-TravelPlan-2026-07-27/mockups/trip-overview-day-detail.html:1070] — bucket list as a Screen B sidebar card
- [Source: _bmad-output/implementation-artifacts/7-8-trip-overview-lower-sections-redesign.md] — the restyle this story builds on

## Dev Agent Record

### Agent Model Used

claude-opus-5[1m] (Claude Code implementation agent)

### Debug Log References

- `npx vitest run test/tripBucketListPanel.test.tsx test/tripTimelineRoles.test.tsx` — baseline before any edit to the suites: 15 passed (7 + 8). Re-run after the source move and the two new panel cases plus the new roles case: 18 passed (9 + 9).
- `npm test` — 96 files, 635 tests, all passed.
- `npm run lint` — 2 errors, 85 warnings. Both errors are pre-existing in `src/theme.ts` (`react/no-children-prop` at `:120` and `:137`), untouched by this story. Zero problems reported in any file this story changed.
- `npx tsc --noEmit` — 152 errors, all pre-existing in unrelated test files (the `as unknown as typeof fetch` stubbing pattern in `tripDayPlanItemsRoute.test.ts`, `tripDetailRoute.test.ts`, `bucketListRoute.test.ts` and 20 others). Zero errors in `TripTimeline.tsx`, `TripBucketListPanel.tsx`, `tripBucketListPanel.test.tsx` or `tripTimelineRoles.test.tsx`. There is no dedicated typecheck script; `tsconfig.json` includes `test/`, which is where the whole baseline lives.
- A throwaway probe test (`test/__probe.test.tsx`, created and deleted) dumped the Emotion CSS for the expanded `List` to establish exactly how MUI serialises a responsive `sx`. Result, verbatim:
  - `.css-1siz0h-MuiList-root{list-style:none;margin:0;padding:0;position:relative;}` — base rule, **no** `max-height`
  - `@media (min-width:0px){.css-1siz0h-MuiList-root{max-height:none;overflow-y:visible;}}`
  - `@media (min-width:900px){.css-1siz0h-MuiList-root{max-height:346.5px;overflow-y:auto;}}`
  This is why the new responsive assertion reads the CSSOM rather than `toHaveStyle`, and why it expects the `xs` value under `(min-width:0px)` rather than in the base rule: MUI routes an `xs` key through `breakpoints.up("xs")`, which is a 0px-floor media query, not an unconditional declaration.

### Completion Notes List

**Derived row height and cap (AC2).** Named module-level constants in `TripBucketListPanel.tsx`; no pixel literal in the `sx`:

| Constant | Value | Where it comes from |
|---|---|---|
| `BUCKET_ROW_LINE_HEIGHT` | 1.5 | MUI `body1`; `theme.ts:214` overrides only `fontSize`/`fontWeight`, so the default line-height survives |
| `BUCKET_ROW_TITLE_FONT_SIZE_PX` | 12.5 | the row title's `sx` |
| `BUCKET_ROW_SUBLINE_FONT_SIZE_PX` | 11 | the description and location lines' `sx` |
| `BUCKET_ROW_SUBLINE_OFFSET_PX` | 1 | each subline's `mt: "1px"` |
| `BUCKET_ROW_TEXT_HEIGHT_PX` | **53.75** | 12.5×1.5 + 2 × (11×1.5 + 1) |
| `BUCKET_ROW_ACTION_HIT_AREA_PX` | 44 | the row's edit/delete `IconButton`s' 44px touch floor |
| `BUCKET_ROW_PADDING_Y_PX` | 9 | `ListItem` `padding: "9px 0"`, counted twice |
| `BUCKET_ROW_DIVIDER_PX` | 1 | `ListItem` `borderBottom: "1px solid"` |
| `BUCKET_ROW_HEIGHT_PX` | **72.75** | max(53.75, 44) + (9 × 2) + 1 |
| `BUCKET_LIST_VISIBLE_ROWS` | 5.5 | five full rows plus half of the sixth, so the cut falls mid-row and reads as scrollable |
| `BUCKET_LIST_MAX_HEIGHT_PX` | **400.125** | 72.75 × 5.5 |

The row is `alignItems: "center"`, so its height is whichever is taller — the stacked text block or the 44px button hit area. For a fully populated row (title + description + location) the **text** wins at 53.75px, which is why the line-height term is load-bearing and why Task 2 asked for it explicitly. A row with no description is 36.25px of text, so there the 44px hit area wins and the row is 63px; the cap shows ~6.3 of those, still inside AC2's "roughly 5–6". A row whose text wraps in the narrow sidebar column is taller again and the cap shows correspondingly fewer — wrapping is not computable here, so the cap is deliberately an approximation and Task 6's browser pass is what judges whether it lands.

**Corrected during the review pass.** The first implementation derived the cap as 44 + 18 + 1 = 63px → 346.5px on the stated grounds that the hit area is taller than the text. That is false: `body1`'s `lineHeight: 1.5` survives `theme.ts`'s partial override, so a description-bearing row is 72.75px and the 346.5px cap would have shown 4.76 of them, not 5.5. The line-height term Task 2 named was simply not measured.

**Verification status per AC — style-asserted vs. behaviourally proven.** jsdom performs no layout and evaluates no media queries, so nothing about clipping or scrolling can be observed there.

- **Style-asserted only, behaviour NOT proven:** AC2 (the cap exists as a `max-height` declaration carrying the derived value; that the card actually stops growing and the rows actually clip is unobserved), AC3 (`tabIndex="0"` and an accessible name are asserted as attributes; that arrow/Page keys actually scroll the box and that focus is not trapped is unobserved), AC5 (the cap is asserted to be absent below `md` as CSS; that the stacked single-column layout therefore nests no scroll region is unobserved).
- **Behaviourally proven in jsdom:** AC1 (ancestor relationship + the owner-only gating), AC4 (the empty branch renders exactly the label, count line and empty message, and no authored `min-height` exists in any Emotion rule for the card or its descendants — the assertion reads the CSSOM, so it is blind to a `style` attribute; MUI's `Collapse` does set an inline `min-height: 0px`, which is not a floor and is deliberately out of scope), AC6 (the 7 pre-existing panel tests pass unchanged), AC7 (document edit).
- **Behaviourally proven in a browser:** none. Task 6 was deliberately not attempted — this repo has no browser automation (no Playwright/Puppeteer) and `prisma/dev.db` holds real trip data, so seeding and driving it is an operator action. Task 6's checkbox is left unticked and no measured on-screen values are recorded below. AC2, AC3 and AC5 are not fully discharged until that pass runs; the concrete things to look at are: with ≥8 items the card caps at ~400px of list and scrolls internally while the header/count/add button stay put; the list scrolls by keyboard once focused; at `xs` the card is uncapped; an empty card is compact.

**Decisions a reviewer should scrutinise.**

1. **`aria-label` on the `List`.** `tabIndex={0}` makes the list focusable, and a focusable element with no accessible name is an a11y defect, so the list reuses the existing `trips.bucketList.title` key (no new i18n key). The cost is that the list now duplicates the card's visible heading as its own name, so a screen reader says "Bucket list, list, 8 items" right after announcing the "Bucket list" heading. Judged the lesser problem than an unnamed tab stop. All 7 pre-existing tests still pass with it, and no test queries `getByLabelText("Bucket list")`.
2. **`tabIndex={0}` adds a tab stop** before the rows' edit/delete buttons. This is the standard fix for a keyboard-operable scroll region (AC3) and traps nothing, but it does lengthen the tab order of the sidebar by one for every owner.
3. **Placement before the gap alert.** Task 1 prescribes "directly after `TripOverviewMapPanel`", which puts the bucket list *above* the `firstGapDay` warn alert. That demotes an actionable warning below a reference panel. Following the task as written; if the alert should stay last-but-one, that is a one-line reorder and the new ancestor test survives it deliberately (it asserts containment, not index).
4. **The spacing wrapper.** The side column has no flex `gap` — its rhythm is sibling `mb: 2` / `mt: 2`. The panel already owns its card shell (Story 7.8), so it is wrapped in a margin-only `<Box sx={{ mt: 2 }}>`: no border, no background, no padding, so no double edge (Trap 1).
5. **The responsive-CSS assertion technique.** There was no precedent in the suite for asserting a breakpoint-scoped `sx` value — the only `min-width` hits (`tripTimelinePlan.test.tsx:47`, `tripTimelineSharing.test.tsx:39`) mock `window.matchMedia` for JS-side `useMediaQuery`, which cannot see CSS Emotion emits. The new helper walks `document.styleSheets` through the CSSOM (`CSSMediaRule`/`CSSStyleRule`) rather than regexing style text, so it is not brittle on whitespace, declaration order or vendor prefixes. It is coupled to MUI's default `md` = 900px, which the test names as a constant with a comment.

### File List

- `travelplan/src/components/features/trips/TripTimeline.tsx` — moved the bucket-list mount into the side column; added `data-testid` to the side column.
- `travelplan/src/components/features/trips/TripBucketListPanel.tsx` — derived height constants; `maxHeight`/`overflowY`/`tabIndex`/`aria-label` on the row `List`.
- `travelplan/test/tripTimelineRoles.test.tsx` — added the side-column ancestor case.
- `travelplan/test/tripBucketListPanel.test.tsx` — added the CSSOM helper and two cases (compact empty card, capped/scrollable list at `md` only).
- `_bmad-output/planning-artifacts/ux-designs/ux-TravelPlan-2026-07-27/EXPERIENCE.md` — Screen A sidebar contents; the embedded-panels paragraph; the empty-bucket-list State Patterns row.

### Change Log

| Change | Location | AC |
|---|---|---|
| Side column gains `data-testid="trip-overview-side-column"` (precedent: `trip-controls-card` in the same file) | `TripTimeline.tsx:707-711` | 1 |
| `{isOwner ? <TripBucketListPanel …/> : null}` moved out of `TripTimeline.tsx:785` (sibling of the layout grid) into the side column, after `TripOverviewMapPanel` and before the `firstGapDay` alert, wrapped in a margin-only `<Box sx={{ mt: 2 }}>` to join the column's existing 16px sibling rhythm. Ternary moved whole, so gating is unchanged (Trap 2). | `TripTimeline.tsx:756-765`; removal at former `:784` | 1, 6 |
| Added `BUCKET_ROW_ACTION_HIT_AREA_PX` / `BUCKET_ROW_PADDING_Y_PX` / `BUCKET_ROW_DIVIDER_PX` / `BUCKET_ROW_HEIGHT_PX` (63) and exported `BUCKET_LIST_VISIBLE_ROWS` (5.5) / `BUCKET_LIST_MAX_HEIGHT_PX` (346.5), with a comment explaining that the 44px hit area rather than the text sets the row height | `TripBucketListPanel.tsx:61-80` | 2 |
| Row `List` gains `maxHeight: { xs: "none", md: BUCKET_LIST_MAX_HEIGHT_PX }` and `overflowY: { xs: "visible", md: "auto" }` — on the `List`, not the card `Box`, so header/count/add stay visible; `md` is the grid's own breakpoint (Trap 4); `maxHeight` only, never `height` (Trap 3). Existing `"& > li:last-child"` rule untouched. | `TripBucketListPanel.tsx:511-519` | 2, 5 |
| Row `List` gains `tabIndex={0}` and `aria-label={t("trips.bucketList.title")}` (existing key, no new i18n) | `TripBucketListPanel.tsx:513-514` | 3 |
| Verified no `minHeight` and no `height` on the card shell or any wrapper — the only `height` values in the file are the 44px/24px icon boxes. No change needed; now pinned by a test. | `TripBucketListPanel.tsx` | 4 |
| Screen A's Purpose now lists the sidebar explicitly: "…and a sidebar of cost summary, route map, bucket list, gap alert" | `EXPERIENCE.md:29` | 7 |
| The embedded-panels paragraph now scopes each panel to its surfaces: bucket list on both Trip Overview and Day Detail, day map on Day Detail only. Rationale prose left intact. | `EXPERIENCE.md:39` | 7 |
| `[ASSUMPTION]` marker and "Flag for confirmation in the next review pass." replaced by the confirmed treatment (Tommy's decision, 2026-08-01), including the compactness constraint — no minimum height, no filler; Surface column now covers both sidebar cards | `EXPERIENCE.md:81` | 7 |
| Added: bucket list renders inside the side column (ancestor assertion, not sibling index) | `tripTimelineRoles.test.tsx:134-154` | 1 |
| Added: `emotionDeclarations` CSSOM helper for asserting breakpoint-scoped `sx` (no prior precedent in the suite) | `tripBucketListPanel.test.tsx:9-74` | 2, 5 |
| Added: empty card is compact — no `min-height` on the card or any element inside the panel, no `height`/`max-height` on the card | `tripBucketListPanel.test.tsx:230-262` | 4 |
| Added: expanded `List` carries `overflow-y: auto` + the derived `max-height` under `(min-width:900px)`, `none`/`visible` under `(min-width:0px)`, nothing in the base rule and no third breakpoint; plus `tabIndex`/accessible name | `tripBucketListPanel.test.tsx:264-308` | 2, 3, 5 |

## Review Triage Log

### 2026-08-01 — Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 9: (high 0, medium 3, low 6)
- defer: 4: (high 0, medium 2, low 2)
- reject: 9: (high 0, medium 0, low 9)
- addressed_findings:
  - `[medium]` `[patch]` The row metric omitted the line-height term Task 2 explicitly asked for. The comment claimed the 44px hit area is taller than the row's text; it is not — the row `Typography`s are `body1` and `theme.ts:214` overrides only `fontSize`/`fontWeight`, so MUI's `lineHeight: 1.5` survives and a fully populated row is 53.75px of text. The 346.5px cap would have shown 4.76 description-bearing rows, not the specified 5.5. Rederived as `max(text, hitArea) + 2×padding + divider` = 72.75px → **400.125px**, with the line-height terms as named constants and the false rationale replaced by the real one, including an explicit statement that wrapping in the narrow sidebar column makes the cap an approximation that only Task 6 can judge.
  - `[medium]` `[patch]` `EXPERIENCE.md:81`'s rewritten row asserted that "the same decision caps the expanded card's height" for both the Trip Overview *and* Day Detail bucket-list cards. Day Detail's card is a different component (`TripDayBucketListPanel.tsx:62`) with no `maxHeight`, no overflow and no collapse, so the spec documented behaviour that does not ship. Scoped the cap sentence to Trip Overview, described the breakpoint rule, and stated plainly that Day Detail is not capped and should be treated as open work — recorded as DW-70.
  - `[medium]` `[patch]` `EXPERIENCE.md:29` and `:39` described the bucket list as part of Screen A's sidebar with no role qualifier, while the code gates it on `isOwner` (as AC1 requires). A reader building from the spec would render a card that never appears for two of three roles. Both passages now say owner-only, and `:29` spells out what a viewer and a contributor actually see.
  - `[low]` `[patch]` Trap 3 ("`maxHeight`, never `height`") was unguarded on the one element that carries the cap. The empty-state test walks descendants for `min-height`, but the empty branch renders no `<List>` at all, so a `height` or `minHeight` on the list — the exact regression the trap names — was checked by nothing. Added both assertions to the populated/expanded case where the list exists.
  - `[low]` `[patch]` The Dev Agent Record claimed AC4 was behaviourally proven as "no `min-height` … on any element inside the panel". The CSSOM helper reads Emotion's stylesheets only and is blind to the `style` attribute, and MUI's `Collapse` does set an inline `min-height: 0px`. Scoped the claim to authored `sx` rules and recorded the blind spot in both the record and the test comment, rather than broadening the helper and trading a precise guard for false positives.
  - `[low]` `[patch]` `BUCKET_LIST_VISIBLE_ROWS` was exported but imported nowhere — dead public surface on a component module. Un-exported; only `BUCKET_LIST_MAX_HEIGHT_PX` is consumed.
  - `[low]` `[patch]` The new roles test asserted containment twice (`within(...).getByTestId(...)` then `sideColumn.contains(panel)`). Dropped the redundant line.
  - `[low]` `[patch]` The empty-state test read `getByText("No bucket list items yet.")` synchronously after the expand click, although the empty branch is gated on `!loading`. Wrapped in `waitFor` so a slower fetch flush cannot make it flake.
  - `[low]` `[patch]` `EXPERIENCE.md:81` flipped from `[ASSUMPTION]` to "Confirmed treatment" with no pointer to where the decision lives, while the paragraph two rows above cites `.memlog.md` for its own. Added the citation to this story file, so the confirmation is at least as traceable as the assumption it replaced.

Deferred: DW-67 (empty message renders alongside the load-error alert), DW-68 (`countLine` has no singular form), DW-69 (`tripTimelineRoles.test.tsx` leaks its `fetch` stub on a failing assertion), DW-70 (Day Detail's bucket list is still unbounded).

Rejected, with reasons, so they are not re-raised: making `tabIndex` breakpoint-conditional (Task 2 prescribed `tabIndex={0}` and asked only that the trade-off be recorded; conditional focusability needs `useMediaQuery` and an SSR/hydration cost to remove a dead tab stop); `overflow-y: auto` promoting `overflow-x` to `auto` (the text block is `minWidth: 0` with `overflowWrap: "anywhere"` and the action group is ~98px in a ~250px column, so horizontal overflow is not reachable); scrollbar-gutter misalignment between the scrolled rows and the header's add button (cosmetic, platform-dependent); the gap alert sitting below the bucket list (Task 1 prescribed the position — forwarded to the operator instead, so it is judged on screen rather than argued on paper); adding a fade or "N more" overflow cue (new design, in no AC); broadening the CSSOM helper to nested selectors, pseudo-classes and `styleOverrides` (trades a precise guard for false positives); past-trip read-only affordances (pre-existing, app-wide, and already flagged as unverified in `EXPERIENCE.md` itself); the 1px of divider billed to the last row whose divider is suppressed (inside an approximation the comment now labels as one); and `expect(BUCKET_LIST_MAX_HEIGHT_PX).toBe(400.125)` being a tautology (kept deliberately as a drift pin on the arithmetic — the comment now says so and points AC2's real verification at Task 6).

## Auto Run Result

Status: awaiting-operator

### What was implemented

The trip-level bucket list moved from a full-width block below the trip-overview layout grid into the overview's side column, where it becomes the third sidebar card after the cost summary and the route map. Its expanded row list now caps at a height derived from the row metric (400.125px = 72.75px per row × 5.5 rows) and scrolls internally at `md` and up, using the same breakpoint the overview grid itself uses so the cap is released wherever the layout is a single column. The card is focusable so the scroll region is keyboard-operable. The empty card is unchanged and stays compact — no floor was introduced anywhere. Owner-only gating is byte-for-byte the same ternary, moved whole. `EXPERIENCE.md` now records the bucket list as a Screen A sidebar card and replaces its open `[ASSUMPTION]` about the empty state with Tommy's confirmed treatment.

### Files changed

- `travelplan/src/components/features/trips/TripBucketListPanel.tsx` — derived-height constants (line-height, font sizes, hit area, padding, divider) and the breakpoint-scoped `maxHeight`/`overflowY`, `tabIndex` and `aria-label` on the row `List`.
- `travelplan/src/components/features/trips/TripTimeline.tsx` — bucket-list mount moved into the side column behind a margin-only wrapper; side column gains a `data-testid`.
- `travelplan/test/tripBucketListPanel.test.tsx` — CSSOM helper for asserting breakpoint-scoped `sx`, plus the compact-empty-card and capped-list cases.
- `travelplan/test/tripTimelineRoles.test.tsx` — side-column containment case.
- `_bmad-output/planning-artifacts/ux-designs/ux-TravelPlan-2026-07-27/EXPERIENCE.md` — Screen A sidebar contents (owner-only), the embedded-panels paragraph, and the empty-bucket-list State Patterns row.
- `_bmad-output/implementation-artifacts/deferred-work.md` — DW-67 … DW-70.

### Review findings

9 patches applied (3 medium, 6 low), 4 deferred (DW-67 … DW-70), 9 rejected. No intent gaps, no spec defects, no repair loopback. The load-bearing patch: the first implementation derived the cap from the 44px touch floor on the false premise that it exceeds the row's text, but `body1`'s `lineHeight: 1.5` survives `theme.ts`'s partial override, so a fully populated row is 53.75px of text and 72.75px overall. The cap moved from 346.5px to 400.125px. Two further patches corrected `EXPERIENCE.md` claims that did not match shipped code — a height cap attributed to Day Detail's uncapped card, and a Screen A sidebar card described without its owner-only gate.

### Verification

- `npm test` — 96 files, 635 tests, all passed (target suites 7→9 and 8→9; the 15 pre-existing cases pass unchanged, which is AC6).
- `npx eslint` on the four changed files — 0 errors, 3 warnings, all pre-existing and unrelated (`react-hooks/incompatible-library` on `react-hook-form`'s `watch`, `set-state-in-effect` on `loadTrip`, one unused disable directive).
- `npx tsc --noEmit` — 152 errors, every one pre-existing in 23 unrelated test files; none in any file this story touched. Repo baseline, unchanged.
- Static verification only for the visual behaviour: jsdom neither lays out nor evaluates media queries, so AC2, AC3 and AC5 are asserted as CSS declarations and attributes, never as observed clipping, scrolling or focus movement.

### Residual risks

1. **The cap's row count is unproven.** 5.5 rows assumes each row's text fits on one line. In the sidebar's ~250px text column, titles (up to 120 chars) and unbounded descriptions wrap with `overflowWrap: "anywhere"`, so real rows can be 2–4× taller and the card would show noticeably fewer than 5–6. Only the browser pass can settle it; if it lands wrong, `BUCKET_LIST_VISIBLE_ROWS` is the single constant to change.
2. **AC3 is asserted, not exercised.** `tabIndex="0"` and an accessible name are present; that arrow and Page keys actually scroll the box, and that focus is not trapped, is unobserved.
3. **The extra tab stop exists at every width**, including below `md` where nothing scrolls.
4. **The gap alert now sits below the bucket list.** Task 1 prescribed the position, so it was followed, but it does place an actionable warning beneath a reference panel.
5. **`aria-label` duplicates the card heading**, so a screen reader says "Bucket list" twice in succession. Judged better than an unnamed tab stop; one line to revert.

## Operator Confirmation

Confirmed 2026-08-01: the external actions this story owed were carried out.

- Seed an isolated SQLite DB on a non-default port (never travelplan/prisma/dev.db - it holds real trip data; follow the worktree isolation precedent from Stories 7.2, 7.3, 7.8, 7.9 and 7.11) and start the dev server against it. Note the login route is rate-limited: repeated logins return 429.
- Add at least 8 bucket-list items to a trip you own, and give most of them BOTH a description and a position/location so the rows are the fully populated three-line shape the height cap was derived from. Include one item with a long title (60+ characters) so you can see what wrapping does in the narrow sidebar column.
- Open that trip's overview at a desktop width and confirm the bucket list is now the third card in the right-hand sidebar, below 'Route' - not a full-width block at the bottom of the page - and that it has exactly ONE border, no doubled edge.
- Expand the card and count how many rows are visible before the cut. The cap is 400.125px, derived as 72.75px per fully populated row x 5.5, and the acceptance criterion asks for roughly 5-6 rows with a half row visible at the cut. If wrapping makes it show noticeably fewer (3-4) or more (7+), change ONLY the BUCKET_LIST_VISIBLE_ROWS constant in travelplan/src/components/features/trips/TripBucketListPanel.tsx, update the expected value in the tripBucketListPanel.test.tsx drift pin, and record the measured row height and the new value in the Dev Agent Record.
- With the card expanded, confirm the card header, the entry-count line and the round + add button all stay visible and stationary while the rows scroll underneath them. If the whole card scrolls instead, the cap landed on the card Box rather than on the List.
- Tab to the row list and confirm the arrow keys and Page Up/Page Down scroll it, that Tab continues onward into the row edit/delete buttons rather than cycling inside the list, and that Shift+Tab leaves it cleanly. Then judge whether the extra tab stop the list introduces is acceptable - it is present at every viewport width, including below md where nothing actually scrolls.
- Narrow the window below 900px and confirm the overview collapses to one column and the bucket list is NO LONGER capped or internally scrollable there - the card should grow to its full content height with only the page scrolling. A scrollbar inside the card at phone width is the exact failure AC5 forbids.
- Delete every bucket-list item and confirm the empty card is compact: the label, the count line and one short empty message, with no reserved blank space, no filler and no illustration. It should be visibly the shortest card in the sidebar.
- Decide the sidebar ordering. The bucket list is now inserted between 'Route' and the amber 'Handlungsbedarf' gap alert, because the story prescribed 'directly after the map panel' - which puts a reference panel above an actionable warning. If you want the gap alert to stay adjacent to the map, move the bucket-list block in TripTimeline.tsx below the firstGapDay block; the containment test asserts ancestry rather than sibling index, so nothing breaks.
- With a screen reader (VoiceOver: Cmd+F5), tab onto the expanded row list and confirm the duplicated announcement is tolerable - the card heading says 'Bucket list', then the list announces itself as 'Bucket list, list, N items'. If it grates, delete the aria-label line on the List in TripBucketListPanel.tsx and the toHaveAccessibleName assertion in tripBucketListPanel.test.tsx; the tab stop then has no name, which is the trade-off.
- Share the trip with a second account as a viewer and again as a contributor, sign in as each, and confirm neither sees a bucket-list card anywhere on the trip overview. Automated tests cover this, but the mount moved, so confirm it once for real.
- If every check above passes, edit _bmad-output/implementation-artifacts/7-12-bucket-list-sidebar-card.md: tick both of Task 6's subtasks to [x], set status: done in BOTH the frontmatter and the body's 'Status:' line, change the '## Auto Run Result' Status line to done, set 7-12-bucket-list-sidebar-card to done in sprint-status.yaml, and append a Change Log entry dated with the verification date. (DW-66 tracks why this bookkeeping is manual; 7-9 and 7-11 both drifted on exactly this step, so please do not add a third.)

_Appended by the bmad-loop orchestrator (`bmad-loop confirm`, #335): a human confirmed these external actions out of band, and the story was advanced from `awaiting-operator` to `done`._
