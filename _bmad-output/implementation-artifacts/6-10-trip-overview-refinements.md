---
authored_against: 096291f
---

# Story 6.10: Trip Overview Refinements From First Production Use

Status: ready-for-dev

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

- [ ] **Task 1 — Move the block** (AC: 1, 2, 3, 6)
  - [ ] `TripTimeline.tsx:800-822` renders `{canEditPlanning || isOwner ? (<Box data-testid="trip-controls-card" …/>) : null}` *after* the layout grid's closing tag. Move the whole conditional inside the grid's **first** child — the left column `Box` at `:462` — as its last element, after the day list.
  - [ ] Move the entire ternary, not just the card. The guard is AC3 and `tripTimelineRoles.test.tsx` asserts it.
  - [ ] Add no width constraint of any kind. The left column already carries `p: { xs: 0, md: "22px 28px 22px 0" }`; the card inherits that and lands at the day rows' width by construction. A `maxWidth` would satisfy AC2 today and drift the first time the grid changes.
  - [ ] Check the vertical rhythm where the card now sits: the day list ends with its own spacing, and the card must not introduce a second gap rule on top of it.

- [ ] **Task 2 — Tests** (AC: 1, 2, 3)
  - [ ] Assert the controls card is a **descendant of the left column**, not a sibling of the grid. Assert ancestry, not sibling index — Story 7.12 established that pattern and it survives reordering.
  - [ ] Keep the existing role assertions in `tripTimelineRoles.test.tsx` green: viewer sees no card and no empty container; owner sees Edit + Delete; contributor sees Edit only.
  - [ ] jsdom computes no layout, so AC2 cannot be proven there — assert the card carries no `width`/`maxWidth`/`margin` of its own instead, which is the property that makes the width correct.
  - [ ] `npm test` green.

- [ ] **Task 3 — Manual check** (AC: 2, 4, 6)
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

### Debug Log References

### Completion Notes List

### File List

### Change Log
