---
authored_against: ac03570
---

# Story 6.14: Trip Controls Last on a Phone

Status: ready-for-dev

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

- [ ] **Task 1 — Choose the mechanism** (AC: 1, 3, 5, 6)
  - [ ] The grid is `{ xs: "1fr", md: "1.7fr 1fr" }` (`TripTimeline.tsx:456-460`). Its two children are the left column (day list + controls card, after 6.10) and the right column (cost, map, bucket list, gap alert, after 7.12).
  - [ ] Below `md` both columns stack, so the controls card lands after the day list and **before** everything in the right column. That is the defect.
  - [ ] Two workable shapes: make the card a **direct grid child** with a breakpoint-dependent `order` and a `gridColumn` that keeps it under the day list at `md`+; or keep it where it is at `md`+ and render it as a sibling after the grid only below `md`. The first keeps one element; the second is simpler to read but risks reintroducing the full-width block AC4 forbids — if you take it, constrain the width the way the column does.
  - [ ] Do **not** render two copies and hide one. AC6 exists because that is the tempting shortcut and it doubles the buttons in the accessibility tree.
  - [ ] Record which shape you chose and why.

- [ ] **Task 2 — Preserve what 6.10 established** (AC: 2, 3, 4, 7)
  - [ ] At `md`+ the card must still carry no width constraint of its own — the alignment comes from the column's `p: "22px 28px 22px 0"`. A `maxWidth` added here would undo 6.10's whole point.
  - [ ] Keep the `canEditPlanning || isOwner` ternary with the card, not beside it.
  - [ ] After the change nothing may render after the grid at `md`+.

- [ ] **Task 3 — Tests** (AC: 1, 3, 6, 7)
  - [ ] Story 6.10 added an assertion that the card is a **descendant of the left column**. If the mechanism makes it a direct grid child, that assertion must be updated deliberately, not deleted — and the new one should still express "in the content column at desktop", not a sibling index.
  - [ ] Assert exactly one controls card exists in the DOM (AC6).
  - [ ] Keep `tripTimelineRoles.test.tsx` green: viewer sees no card, owner sees Edit + Delete, contributor sees Edit only.
  - [ ] `npm test` green.

- [ ] **Task 4 — Manual check** (AC: 1, 2, 3, 4)
  - [ ] jsdom has no media-query engine and computes no layout, so the ordering *is* the story and cannot be proven there.
  - [ ] At 390px: the controls card is the last thing on the page. At 1400px: it is under the day list, edges matching a day row, and nothing follows the grid.
  - [ ] Throwaway copy of `dev.db` on an isolated port — never `prisma/dev.db`. Recipe in `7-12-bucket-list-sidebar-card.md`'s Dev Notes.

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

### Debug Log References

### Completion Notes List

### File List

### Change Log
