---
authored_against: ac03570
---

# Story 6.15: Move, Swap and Day-Image Edit Into the Day Overflow Menu

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner on a phone,
I want "Aktivitäten verschieben", "Aktivitäten tauschen" and the day-image edit behind the `⋯` menu that already holds print,
so that the timeline header carries one primary action instead of a wrapping row, and the hero header carries one control instead of two.

## Acceptance Criteria

1. **Relocated.** Move and swap render as items in the existing `⋯` overflow menu; the two buttons are gone from the timeline section header. No second menu is introduced.
2. **Day-image edit moves too.** The `isOwner` pencil beside the `⋯` (`TripDayView.tsx:1963-1977`) becomes a menu item, so the hero's right slot holds the `⋯` alone — roughly 52px reclaimed in the header row.
3. **Three gating levels, per item.** A viewer sees print alone; a contributor sees print plus move and swap; an owner sees all four. Each item appears only for a role the server would accept.
4. **Mixed item kinds behave correctly.** Print keeps `target="_blank"` and `rel="noopener noreferrer"`; move and swap open their existing dialogs; the menu closes on any selection.
5. **No empty menu.** If no item would render for a role, the `⋯` trigger does not render either.
6. **Header reduced.** After this story and 6.13, the timeline section header carries its label and "+ Aktivität" alone, and does not wrap at 390px.
7. **Nothing else changes.** The transfer dialogs, the day-details dialog, the print document, the timeline and every gating rule behave as before.

## Tasks / Subtasks

- [ ] **Task 1 — Move the two buttons into the menu** (AC: 1, 3)
  - [ ] The buttons are in the timeline section header (`TripDayView.tsx:2225-2253` at the baseline), both wrapped in `canEditPlanning`, calling `handleOpenTransferDialog("move")` and `("swap")`.
  - [ ] The menu is the one Story 6.11 built: `dayMenuAnchor` state, the `⋯` `IconButton` in the hero header's right slot, and a `Menu` holding one print `MenuItem`. Extend it — do not create a second.
  - [ ] Move and swap are **action** items (`onClick` + close), unlike print which is `component={Link}`. Both kinds are ordinary `MenuItem`s; keep print's link props on print only.
  - [ ] Delete the two buttons from the header once the items exist.
  - [ ] Keep `handleOpenTransferDialog` exactly as it is. This story changes how it is reached.

- [ ] **Task 2 — Move the day-image edit in as well** (AC: 2, 6)
  - [ ] `TripDayView.tsx:1963-1977` renders it as an `IconButton` with `ON_PHOTO_CHROME`, 44×44, `aria-label={t("trips.dayImage.editAction")}`, opening `setDayMetaOpen(true)`. Make it a `MenuItem` calling the same setter.
  - [ ] Once it is gone the right slot holds only the unconditional `⋯`. The comment at `:1959-1961` — "rendered even when empty so the row keeps two flex children" — describes a workaround that no longer has a purpose. Story 6.11 already had to revisit it once; finish it here rather than leaving a third stale version.
  - [ ] Keep the `isOwner` condition on the *item*, not on the menu.
  - [ ] The dialog it opens is Story 7.7's surface — do not touch it.

- [ ] **Task 3 — Gate per item, not per menu** (AC: 3, 5)
  - [ ] Three levels: the day image needs `isOwner`, move and swap need `canEditPlanning`, print needs nothing beyond being able to open the day. A viewer therefore sees one item, a contributor three, an owner four.
  - [ ] Guard the `⋯` trigger on "at least one item would render". Today it is unconditional because print always renders; once items become conditional that assumption has to be stated rather than inherited.
  - [ ] The trigger itself stays outside every role condition (6.11 AC6) — only the *items* are gated. Wrapping the trigger in `isOwner` because the day-image item moved in would take print away from viewers.

- [ ] **Task 4 — Ordering inside the menu** (AC: 3)
  - [ ] Move and swap are a pair and belong adjacent. Whether they sit above or below print is a judgement; make it and say so in the Dev Agent Record.
  - [ ] Consider a divider between the planning actions and print, since they differ in kind — one changes the trip, the other opens a document. `HeaderMenu.tsx` has no divider to copy, so this is a new decision rather than a pattern to follow.

- [ ] **Task 5 — Tests** (AC: 1, 2, 3, 5)
  - [ ] Update any suite asserting the two buttons by their visible labels.
  - [ ] Add: the menu holds four items for an owner, three for a contributor and one for a viewer; selecting move opens the transfer dialog in move mode and swap in swap mode; the day-image item opens the day-details dialog; the header exposes no button named by `trips.dayTransfer.moveAction`, `swapAction` or `trips.dayImage.editAction`.
  - [ ] Assert the hero's right slot contains exactly one control.
  - [ ] `npm test` green.

- [ ] **Task 6 — Manual check** (AC: 2, 6)
  - [ ] At 390px confirm the timeline header sits on one line with its label and "+ Aktivität", the hero header carries the back button and a single `⋯`, and the menu opens with each item doing what it says.
  - [ ] Check all three roles: viewer sees print alone, contributor sees three items, owner sees four.
  - [ ] Throwaway copy of `dev.db` on an isolated port — never `prisma/dev.db`. Recipe in `7-12-bucket-list-sidebar-card.md`'s Dev Notes.

## Dev Notes

### What this completes

The timeline section header held four `canEditPlanning`-gated buttons. Story 6.13 removed the accommodation one, since both stay cards became clickable. This story removes move and swap, leaving "+ Aktivität" alone — the one action that belongs in a section header, because it creates what the section lists.

Story 6.11 built the destination and its rationale: a page-local `⋯` rather than an entry in the global `HeaderMenu`, because that menu is built from `getAuthMenuItems(authState)` and knows nothing about this trip or this day. The same reasoning covers move, swap and the day-image edit, all of which need this day.

Tommy extended the ask on 2026-08-02: the `isOwner` pencil sitting beside the `⋯` should go in too. That leaves the hero's right slot with one 44px control instead of two plus their 8px gap — about 52px, which matters most at 390px where the German "← Zurück zur Reise" already competes for the row.

### The gating changes shape

Until now the menu had exactly one item and it was ungated, so the `⋯` could be unconditional. This story gives it **three** levels at once — `isOwner` for the day image, `canEditPlanning` for move and swap, and none for print — so its contents become role-dependent for the first time. That is why AC5 exists: a role that can do none of them must not get a trigger that opens an empty surface. There is no such role today, since anyone who can open the day can print, but the guard should be written from what the items say rather than from today's role table.

### Traps

**1. Two kinds of item in one menu.** Print is a link with `target`/`rel`; move, swap and the day-image edit are handlers. Applying print's props to all four would open the dialogs in a new tab; applying none would strip print's.

**1b. Do not gate the trigger.** The day-image item is `isOwner`, and moving it into the menu makes it tempting to wrap the `⋯` in the same condition. That would remove print from viewers and contributors — the exact regression 6.11 AC6 was written to prevent.

**2. Do not touch `HeaderMenu.tsx` or `authMenu.ts`.** Story 6.11 AC5 kept them out of scope and the same holds here.

**3. The transfer dialog has two modes.** `handleOpenTransferDialog` takes `"move"` or `"swap"`. Wiring both items to one mode is a silent bug that looks right until someone uses it.

### Testing

Vitest 3.2 + Testing Library, jsdom, via `test/helpers/renderWithProviders.tsx`. `tripDayViewLayout.test.tsx` is the constraint; 6.9, 6.11 and 6.13 have each reworked it, so read it before adding.

### Project Structure Notes

`src/components/features/trips/TripDayView.tsx` and the affected suite. Possibly no i18n change at all — `trips.dayTransfer.moveAction` / `swapAction` become menu labels rather than button labels and keep their strings. No route, API or schema change.

### Sequencing

After **6.11** (which built the menu) and **6.13** (which empties the same header of its accommodation button). Both are `done`, so this is unblocked.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 6.15]
- [Source: travelplan/src/components/features/trips/TripDayView.tsx:2225-2253] — the two buttons to move
- [Source: _bmad-output/implementation-artifacts/6-11-day-nav-chevrons-and-print-menu.md] — the menu and why it is page-local

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

### Change Log
