---
baseline_commit: 33abbdf
---

# Story 7.12: Bucket List as a Trip Overview Sidebar Card

Status: ready-for-dev

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

- [ ] **Task 1 — Move the mount** (AC: 1)
  - [ ] `TripTimeline.tsx:785` currently renders `{isOwner ? <TripBucketListPanel tripId={detail.trip.id} /> : null}` *after* the layout grid's closing tag. Move that expression inside the side column, directly after `<TripOverviewMapPanel … />`.
  - [ ] Move the whole ternary, not just the component — the `isOwner` guard is the gating AC1 requires and `tripTimelineRoles.test.tsx` asserts it.
  - [ ] Do **not** add a card shell. Story 7.8 already gave the panel `tokens.card` / `borderStrong` / 8px / 18px padding; wrapping it again would double the border.
  - [ ] Check the side column's vertical rhythm: the cost card and map panel are separated by the column's existing gap. The bucket list must join that rhythm, not introduce a second spacing rule.

- [ ] **Task 2 — Bound the expanded height** (AC: 2, 3, 5)
  - [ ] The rows render through MUI `List` / `ListItem`. Put `maxHeight` + `overflowY: "auto"` on the `List`, not on the card `Box` — the card's header and add affordance must stay visible while the rows scroll.
  - [ ] Derive the cap from the row metric rather than hardcoding: measure one `ListItem`'s height (padding + line-height as the component actually renders it) and express the cap as that value × 5.5, so a half row is visible at the cut and the list reads as scrollable. Record the measured row height and the resulting value in the Dev Agent Record.
  - [ ] Scope the cap to `md` and up. At `xs`/`sm` the overview collapses to one column (`TripTimeline.tsx:459`) and a capped scroll region there nests a scroll inside the page's own — AC5 forbids it. Use the same breakpoint the grid uses, not a new one.
  - [ ] Give the scroll container `tabIndex={0}` so it is keyboard-scrollable. Note the trade-off in the Dev Agent Record: this adds a tab stop before the rows. It is the standard fix and AC3 requires operability, but a reviewer should see it was a decision.

- [ ] **Task 3 — Empty state** (AC: 4)
  - [ ] `TripBucketListPanel.tsx:394` computes `emptyState`; `:473-475` renders `trips.bucketList.empty`. Confirm the card carries no `minHeight` and that the empty branch renders only the label, the count line and the empty message.
  - [ ] The cap from Task 2 must not become a floor — `maxHeight` only, never `height`.

- [ ] **Task 4 — Update the design spec** (AC: 7)
  - [ ] `EXPERIENCE.md`'s Information Architecture: add the bucket list to Screen A's sidebar contents, mirroring how `:39` already describes it for Screen B.
  - [ ] `EXPERIENCE.md:81`: replace the `[ASSUMPTION]` marker and its "Flag for confirmation in the next review pass" note with the confirmed treatment — short empty message inside the card shell, no illustration, **and the card stays compact**. Attribute the confirmation to 2026-08-01.

- [ ] **Task 5 — Tests** (AC: 1, 2, 4, 6)
  - [ ] `tripTimelineRoles.test.tsx` already asserts the viewer/contributor cases. Re-run and fix any that depended on the panel's position in the DOM rather than its presence.
  - [ ] `tripBucketListPanel.test.tsx` (7 tests) covers collapse/expand, the add dialog, the 44px hit area, `:last-child` divider suppression and list-role preservation. All must still pass unchanged — if one breaks, the move changed behaviour it should not have.
  - [ ] Add: the panel renders inside the side column (assert an ancestor relationship, not a sibling index); the empty card carries no `minHeight`; the `List` carries `overflowY: auto` with a `maxHeight` at `md` and neither below it.
  - [ ] Run the full suite: `npm test`.

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

### Debug Log References

### Completion Notes List

### File List

### Change Log
