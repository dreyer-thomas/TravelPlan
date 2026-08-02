---
authored_against: 096291f
baseline_revision: e990d3fea252913b9a5d324548b3e16c3905e2fb
final_revision: 7723158627a1bbe194d8928665d41dd41dd16c39
review_loop_iteration: 0
followup_review_recommended: true
status: awaiting-operator
operator_actions:
  - "Confirm the fix on screen at a desktop width (Task 3, AC2/AC6). Open a trip overview at ~1400px and check that the trip-controls card's left and right edges line up with a day row's. At the baseline the card spanned ~1152px against the day rows' ~697px — a ~455px overhang — and that overhang is what must be gone. Also confirm the left column now ends with the controls card, the right with the gap alert, and that nothing full-width remains below them."
  - "Make the spacing call above the card. It inherits the day rows' 8px trailing margin, while the sidebar uses 16px between cards, so the card sits half as far from the day list as the sidebar cards sit from each other. Decide whether 8px reads right. If it does not, say so rather than patching it: adding a margin contradicts Task 1 and fails the new test in `travelplan/test/tripTimelineRoles.test.tsx`, so the change needs a deliberate spec amendment."
  - "Check the phone layout and accept or reject the reordering (Task 3, AC4). Below the `md` breakpoint the overview is one column and DOM order is visual order, so Edit/Delete moved from the bottom of the page to directly under the day list, above the cost summary, map and bucket list. The card's width is unchanged, as AC4 requires; its position is not. This is the same trade Story 7.12 made for the bucket list. Confirm it is acceptable, or open a follow-up story — do not treat it as a defect of this one."
  - "Use a throwaway copy of `dev.db` on an isolated port for the checks above — never `prisma/dev.db`. The working recipe is in the Dev Notes of `_bmad-output/implementation-artifacts/7-12-bucket-list-sidebar-card.md`."
  - "When the three checks pass, tick Task 3's subtasks in this spec and set `status: done`."
---

# Story 6.10: Trip Overview Refinements From First Production Use

Status: awaiting-operator

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner using the redesigned trip overview on a real trip,
I want the trip-controls block to line up with the day list above it,
so that the page ends on a clean edge instead of a block that runs wider than everything it sits under.

## Acceptance Criteria

1. **Relocation.** The trip-controls card (`TripTimeline.tsx:802`, `data-testid="trip-controls-card"`) renders inside the layout grid's **left column**, below the day list, instead of after the grid closes.
2. **Width follows the column.** Its rendered width matches a day row's, achieved by inheriting the column's existing padding — **not** by adding a `width`, `maxWidth` or margin of its own.
3. **Gating unchanged.** The `canEditPlanning || isOwner` guard moves with it, so a viewer still sees no empty bordered card.
4. **Single column untouched.** Below `md` the overview is one column; the card spans it exactly as today. The misalignment this story fixes exists only in the two-column layout.
5. **Treatment unchanged.** Story 7.8's card treatment — `tokens.card`, `1px solid tokens.borderStrong`, 8px radius, 18px padding, outlined Edit/Delete buttons with no destructive red — is untouched.
6. **Both columns end cleanly.** The left column ends with the controls card, the right with the gap alert, and no full-width block remains after the grid.

## Tasks / Subtasks

- [x] **Task 1 — Move the block** (AC: 1, 2, 3, 6)
  - [x] `TripTimeline.tsx:800-822` renders `{canEditPlanning || isOwner ? (<Box data-testid="trip-controls-card" …/>) : null}` *after* the layout grid's closing tag. Move the whole conditional inside the grid's **first** child — the left column `Box` at `:462` — as its last element, after the day list.
  - [x] Move the entire ternary, not just the card. The guard is AC3 and `tripTimelineRoles.test.tsx` asserts it.
  - [x] Add no width constraint of any kind. The left column already carries `p: { xs: 0, md: "22px 28px 22px 0" }`; the card inherits that and lands at the day rows' width by construction. A `maxWidth` would satisfy AC2 today and drift the first time the grid changes.
  - [x] Check the vertical rhythm where the card now sits: the day list ends with its own spacing, and the card must not introduce a second gap rule on top of it.

- [x] **Task 2 — Tests** (AC: 1, 2, 3)
  - [x] Assert the controls card is a **descendant of the left column**, not a sibling of the grid. Assert ancestry, not sibling index — Story 7.12 established that pattern and it survives reordering.
  - [x] Keep the existing role assertions in `tripTimelineRoles.test.tsx` green: viewer sees no card and no empty container; owner sees Edit + Delete; contributor sees Edit only.
  - [x] jsdom computes no layout, so AC2 cannot be proven there — assert the card carries no `width`/`maxWidth`/`margin` of its own instead, which is the property that makes the width correct.
  - [x] `npm test` green.

- [ ] **Task 3 — Manual check** (AC: 2, 4, 6) — **OWED TO THE OPERATOR.** No browser automation exists in this repo (no Playwright/Puppeteer/Cypress; `npm run` offers only `dev`/`build`/`start`/`lint`/`test`), and jsdom computes no layout, so the rendered-width claim cannot be proven by an agent. See `operator_actions` in the frontmatter.
  - [ ] At a desktop width, confirm the card's left and right edges line up with a day row's. At the baseline the grid measures `725.328px / 426.656px` at a 1400px viewport, and a day row is ~697px after the column's 28px right padding, while the card spans the full ~1152px — that ~455px difference is the defect.
  - [ ] Below `md`, confirm nothing changed.
  - [ ] Use a throwaway copy of `dev.db` on an isolated port — never `prisma/dev.db`. The working recipe is in `7-12-bucket-list-sidebar-card.md`'s Dev Notes.

## Dev Notes

### Why this exists

The trip overview's grid is `1.7fr 1fr` (`TripTimeline.tsx:456-460`). The day list occupies the left column, which carries `p: "22px 28px 22px 0"`. The controls card renders *outside* the grid entirely and therefore spans the full container — roughly 455px wider than everything above it, and it is the last thing on the page.

This is the same structural situation the bucket list was in before Story 7.12: a block belonging to the trip's content column, rendered after the grid rather than inside it. Story 7.8 restyled this card onto the token card treatment and left placement alone, because placement was not in its scope. Tommy noticed it in production use.

### Traps

**1. Do not constrain the width.** The whole point is that the column already knows the right width. A `maxWidth: 697` would be correct today and wrong the moment the grid ratio or padding changes.

**2. `canEditPlanning || isOwner`, both halves.** Contributors get Edit but not Delete; owners get both; viewers get no card at all. Moving only the inner `Box` and leaving the conditional behind would render an empty bordered card for viewers — precisely the defect Story 7.8 Task 5 fixed and its comment at `:799-800` records.

**3. Story 7.12 moved the bucket list into the right column.** The left column now ends with the day list and the right with the gap alert. After this story the left ends with the controls card. Nothing should remain after the grid.

### Testing

Vitest 3.2 + Testing Library, jsdom, via `test/helpers/renderWithProviders.tsx`. `tripTimelineRoles.test.tsx` is the constraint — it holds the role assertions Story 7.8 added and 7.12 preserved.

### Project Structure Notes

One file: `src/components/features/trips/TripTimeline.tsx`, plus the affected test. No new files, no route, API, i18n or schema change.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 6.10]
- [Source: travelplan/src/components/features/trips/TripTimeline.tsx:456-460] — the grid
- [Source: travelplan/src/components/features/trips/TripTimeline.tsx:800-822] — the block to move
- [Source: _bmad-output/implementation-artifacts/7-12-bucket-list-sidebar-card.md] — the same move, for the bucket list

## Dev Agent Record

### Agent Model Used

Claude Opus 5 (1M context), via `bmad-dev-auto`.

### Debug Log References

- `npm test` → `Test Files 101 passed (101)` / `Tests 803 passed (803)`.
- `npx eslint` on all four changed files → `✖ 1 problem (0 errors, 1 warning)`; the warning is the pre-existing `react-hooks/set-state-in-effect` on `loadTrip` at `TripTimeline.tsx:196`, untouched by this story.
- `npx tsc --noEmit` → 143 errors, identical count on the baseline `e990d3f`, none in any file this story touches. Logged as DW-95.
- Mutation checks, run to prove the new assertions bite and reverted immediately:
  - column `sx` set to `p: 0` → the width case fails. (Before the review patches this mutation left all tests green — the mechanism AC2 depends on had no coverage at all.)
  - the card relocated above the timeline heading, still inside the column → the placement case fails. (Before the patches this also passed.)

### Completion Notes List

1. **The move is exact.** The whole `{canEditPlanning || isOwner ? … : null}` ternary — guard included — moved from after the grid's closing tag to the last position inside the day column. The card's `sx` and children are byte-identical; only indentation changed. AC3 and AC5 therefore hold by construction, not by re-derivation.

2. **No width, by design.** Nothing was added to the card. The day column's `p: { xs: 0, md: "22px 28px 22px 0" }` is what puts every block in that column — day rows and card alike — at the same width. The review found this mechanism was asserted nowhere, so `tripTimelineRoles.test.tsx` now pins the column's padding as well as the card's absence of constraints; either half alone passes while the card is misaligned.

3. **Vertical rhythm: 8px, deliberately.** The day rows each carry a trailing `marginBottom: "8px"` (including the last), so 8px already separates the list from the card and no margin was added — Task 1 explicitly forbids stacking a second gap rule. Worth knowing: the sidebar's card-to-card gap is 16px (`mb: 2` / `mt: 2`), so the controls card sits half as far from the day list as the sidebar cards sit from each other. Whether that reads right on screen is a visual call, and it is item 2 of the operator actions.

4. **Mobile ordering changed, and it is inherent to AC1.** Below `md` the grid is one column and DOM order is visual order, so Edit/Delete moved from the page bottom to directly under the day list, above the cost summary, map and bucket list. AC4's binding claim — that the card spans the single column exactly as today — still holds; its position does not. This is the same trade Story 7.12 accepted when it moved the bucket list into the right column, so it was not treated as a defect, but it is a real change to the phone layout and it is item 3 of the operator actions.

5. **New `data-testid`.** The day column had none; `trip-overview-main-column` mirrors the sibling `trip-overview-side-column` that Story 7.12 added for the same reason.

6. **A latent bug in the CSSOM test helper, found by fixing another.** Extending the walker to recurse `@supports`/`@layer`/`@container` by testing for `cssRules` broke every assertion using it: in jsdom a `CSSStyleRule` also carries a (usually empty, always truthy) `cssRules`, so every style rule was classified as a group and skipped, and the negative assertions passed vacuously. The shared helper now matches style rules first and recurses only what is left.

### File List

- [travelplan/src/components/features/trips/TripTimeline.tsx](../../travelplan/src/components/features/trips/TripTimeline.tsx) — controls card moved into the day column; `data-testid="trip-overview-main-column"` added to that column.
- [travelplan/test/tripTimelineRoles.test.tsx](../../travelplan/test/tripTimelineRoles.test.tsx) — two new cases (placement + ordering, column padding + card constraints); `afterEach` global-stub cleanup.
- [travelplan/test/helpers/emotionStyles.ts](../../travelplan/test/helpers/emotionStyles.ts) — **new.** Shared CSSOM reader: `emotionDeclarations` (one property, split by media condition) and `emotionDeclaredProperties` (every declared property, flattened).
- [travelplan/test/tripBucketListPanel.test.tsx](../../travelplan/test/tripBucketListPanel.test.tsx) — its local copy of the walker deleted in favour of the shared helper.

## Auto Run Result

Status: `awaiting-operator` — every part an agent can take is complete and verified; Task 3 is a rendered-layout check and this repo has no browser automation.

**What changed.** The trip-controls card (Edit / Delete) rendered after the trip overview's layout grid closed, so it spanned the full container — roughly 455px wider than the day rows it sat under, and it was the last thing on the page. Its entire conditional now renders as the last child of the grid's day column, which is what makes its width match a day row's. One component, one structural move, no route, API, i18n or schema change.

**Files changed**

| File | Change |
|---|---|
| `travelplan/src/components/features/trips/TripTimeline.tsx` | The `canEditPlanning \|\| isOwner` ternary and its card moved from after the grid into the day column as its last child; that column gained `data-testid="trip-overview-main-column"`. |
| `travelplan/test/tripTimelineRoles.test.tsx` | New placement/ordering case and column-padding/card-constraint case; `afterEach` stub cleanup; now imports the shared CSSOM helper. |
| `travelplan/test/helpers/emotionStyles.ts` | New shared CSSOM reader, replacing a 45-line fork that existed in two test files. |
| `travelplan/test/tripBucketListPanel.test.tsx` | Local walker deleted, imports the shared helper. |

**Review findings.** 7 patches applied (2 medium, 5 low), 1 deferred, 12 rejected. No intent gaps, no spec defects, no repair loopbacks. The two medium patches are the substantive ones: the review proved by mutation that neither the column padding (the mechanism AC2 rests on) nor the card's document position (AC1 and AC6) was asserted by anything — mutating either left the suite green. Both are now mutation-verified to fail. The rest tighten the test helper and remove three assertions that could not fail. Full breakdown in the triage log below.

**Verification performed**

- `npm test` — 803 passed / 803, 101 files.
- `npx eslint` on the four changed files — 0 errors, 1 pre-existing warning unrelated to this story.
- `npx tsc --noEmit` — 143 errors, unchanged from baseline, none in the changed files (DW-95).
- Two mutation checks, both now caught, both reverted (see Debug Log References).
- **Not verified: the rendered result.** jsdom computes no layout and this repo has no Playwright/Puppeteer/Cypress; `npm run` offers only `dev`, `build`, `start`, `lint`, `test`. The tests pin the properties that produce the correct width, not the width. Task 3 remains owed.

**Residual risks**

1. **The alignment itself is unconfirmed on screen.** The reasoning is sound and the causal properties are pinned, but nobody has looked at the page. This is operator action 1.
2. **8px vs 16px gap.** The card inherits the day rows' 8px rhythm; the sidebar's card-to-card gap is 16px. If it reads tight, the fix is a spacing decision, not a structural one — and adding a margin would contradict Task 1 and fail the new test, so it needs a deliberate call. Operator action 2.
3. **Phone layout reordered.** Edit/Delete moved from page bottom to mid-page below `md`, an unavoidable consequence of AC1 and the same trade Story 7.12 made. Operator action 3.
4. **Accessibility, unassessed.** Delete trip now sits inside the section headed "Timeline", a scope mismatch for a trip-level destructive action, and keyboard tab order changed accordingly. Not covered by any AC and not treated as a defect of this story; flagged for whoever next touches the overview's heading structure.

## Review Triage Log

### 2026-08-02 — Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 7: (high 0, medium 2, low 5)
- defer: 1: (high 0, medium 0, low 1)
- reject: 12
- addressed_findings:
  - `[medium]` `[patch]` The column padding that AC2 depends on was asserted nowhere — mutating the column's `sx` to `p: 0` left all 11 tests green, so the story's central mechanism could be deleted silently. Added an assertion pinning `22px 28px 22px 0px` under the `md` condition; mutation now fails as it should.
  - `[medium]` `[patch]` Document position was unasserted — the placement case checked membership only, so rendering the card *above* the timeline heading passed both new tests while violating AC1 ("below the day list") and AC6 ("the left column ends with the controls card"). Replaced with `lastElementChild` plus `compareDocumentPosition` against the last day row; mutation-verified.
  - `[low]` `[patch]` Three assertions could not fail: `getAllByTestId(...).length > 0` (the query already throws on zero), the side-column `queryByTestId(...)` null check (disjoint subtrees, and `getByTestId` already throws on duplicates), and one redundant `within()` identity check. Removed, replaced by the real ordering assertions above.
  - `[low]` `[patch]` 45 lines of CSSOM walker forked verbatim from `tripBucketListPanel.test.tsx`. Extracted to `test/helpers/emotionStyles.ts`; both test files now share one implementation, so the fix below landed once instead of twice.
  - `[low]` `[patch]` The walker recursed `@media` only, so a declaration nested in `@supports`, `@layer` or `@container` was invisible and the negative width assertions passed vacuously. Now recurses any grouping rule — matching style rules *first*, because jsdom gives `CSSStyleRule` a truthy empty `cssRules` that would otherwise swallow every rule (caught by the suite going red).
  - `[low]` `[patch]` The forbidden-property list omitted logical and flex equivalents, so `inline-size`, `flex-basis` or `margin-inline` could reintroduce the misalignment with the test green. Extended to 15 properties.
  - `[low]` `[patch]` Trailing `vi.unstubAllGlobals()` per case is skipped when an assertion throws, leaking the stubbed `fetch` and turning one real failure into a cascade. Added a describe-level `afterEach`.
- deferred:
  - `[low]` DW-95 — 143 pre-existing `tsc --noEmit` errors and no `typecheck` script; identical on baseline, none in this story's files.
- escalated to the operator rather than patched (recorded here so they are not dropped silently):
  - `[low]` Mobile reordering: below `md` the card moved from page bottom to mid-page. Inherent to AC1, precedented by Story 7.12, and AC4's binding claim (that it spans the single column exactly as today) still holds. Operator action 3.
  - `[low]` The gap above the card is the day rows' 8px, where the sidebar uses 16px between cards. Adding a margin would contradict Task 1 and fail the new test, so it needs a deliberate visual call. Operator action 2.

### Change Log
