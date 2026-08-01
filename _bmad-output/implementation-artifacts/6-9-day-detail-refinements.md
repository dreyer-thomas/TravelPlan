---
baseline_commit: b5720ca
closes_deferred: [DW-44]
---

# Story 6.9: Day Detail Refinements From First Production Use

Status: ready-for-dev

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

- [ ] **Task 1 — Cost pill** (AC: 1)
  - [ ] Move the cost out of the trailing block (`TripDayView.tsx:2206-2212`) into the card head beside the time pill, right-aligned.
  - [ ] Build it from the existing time-pill treatment (`:1126-1132`) with the fill swapped: `backgroundColor: tokens.accent`, white text. Keep tabular figures and the 4px radius.
  - [ ] A card without a recorded cost renders no pill — do not emit an empty or zero one.
  - [ ] Add the filled variant to `DESIGN.md`'s `badge-pill` block next to `tl-time-bg`.
  - [ ] Confirm at a glance it does not read as a primary button (`theme.ts` `containedPrimary` is the same fill and text colour). Record the judgement in the Dev Agent Record.

- [ ] **Task 2 — Card becomes the click target** (AC: 2, 3, 6, 7)
  - [ ] Delete the edit `IconButton` and its `day-plan-item-actions` wrapper.
  - [ ] Put the click handler on the card, calling the existing `handleOpenEditPlan(item)`. Do not invent a second edit path.
  - [ ] The card's interactive children must not trigger it. Prefer `event.stopPropagation()` on the photo strip's and the link button's handlers over guessing at `event.target` in the card handler — the strip is a shared component (`TripDayPlanItemContent.tsx:149`) also used elsewhere, so change its call site here rather than its internals if that is what it takes.
  - [ ] Keyboard: `role="button"`, `tabIndex={0}`, and a key handler for **both** Enter and Space (Space must also `preventDefault` or the page scrolls). Give it an accessible name from the activity's title — `trips.plan.editItemAria` already carries the right wording.
  - [ ] Wrap all of it in the existing `canEditPlanning` check, the same gate the pencil used.

- [ ] **Task 3 — Editability signal** (AC: 4, 5, 7)
  - [ ] Hover, inside `@media (hover: hover)` per the precedent at `TripsDashboard.tsx:462-471`: pointer cursor, background to `tokens.cardAlt`, border to `theme.palette.primary.main`, glyph fades in.
  - [ ] The glyph: a small pencil from `TripIcons.tsx` (add one if the module has none), `aria-hidden`, positioned top-right, **not** a button and not focusable.
  - [ ] Inside `@media (hover: none)`: the glyph renders permanently in `tokens.inkMuted`, and no hover treatment applies.
  - [ ] Neither branch applies when `canEditPlanning` is false.

- [ ] **Task 4 — Header** (AC: 8)
  - [ ] Delete the breadcrumb `Box` (`:1738-1760`) entirely — trip link, `/` separator and day label.
  - [ ] Move the "back to trip" `Button` (`:1787`) out of the right-hand control group into the row's left slot. The row is already `justifyContent: "space-between"` (`:1714-1723`), so the layout follows.
  - [ ] Enlarge it for touch. It is now the primary way out of this screen.
  - [ ] Verify with the edit action absent (non-owner) that the trip button stays left rather than centring or snapping right.
  - [ ] Note there is a second "back to trip" affordance at `:1660`. Leave it; this story does not touch it.

- [ ] **Task 5 — Copy** (AC: 9, 10)
  - [ ] Remove the `coverageTitle` `Typography` (`:1827-1829`) and the key from `en.ts` / `de.ts`.
  - [ ] Retitle `costCardTitle` in both dictionaries. Only the string changes; the key stays.
  - [ ] `i18nDictionaries.test.ts` asserts key parity between the two dictionaries — a key removed from one must go from both.

- [ ] **Task 6 — DW-44** (AC: 11)
  - [ ] **Measure first.** At baseline, load the day page at 390px and read `document.documentElement.scrollWidth - clientWidth`.
  - [ ] If it is 0, DW-44 is already resolved: record the measurement, leave the code alone, and let the `closes_deferred` annotation close the entry.
  - [ ] If it reproduces, find the actual overflowing element (`[...document.querySelectorAll('*')].filter(e => e.getBoundingClientRect().right > innerWidth)`) and fix that — the span DW-44 names already carries the full clip, so its diagnosis is stale.

- [ ] **Task 7 — Tests** (AC: 1, 2, 3, 6, 7, 9, 10)
  - [ ] Update `tripDayViewLayout.test.tsx` and any suite asserting the removed pencil, the cost's old position, `coverageTitle`, or the old cost-card string.
  - [ ] Add: the cost pill renders in the card head with the accent fill; a card with no cost renders no pill; clicking the card calls the edit handler; clicking a thumbnail does not; Enter and Space both activate; no click handler, cursor or glyph when `canEditPlanning` is false.
  - [ ] `npm test` green.

- [ ] **Task 8 — Manual check** (AC: 4, 5, 8, 11)
  - [ ] jsdom lays nothing out and has no media-query engine, so hover, the touch branch, the enlarged touch target and the overflow measurement all need a browser. Use a throwaway copy of `dev.db` on an isolated port — never `prisma/dev.db`. The working recipe is in `7-12-bucket-list-sidebar-card.md`'s Dev Notes.
  - [ ] Check at 390px and at desktop width, as owner and as viewer.

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

### Debug Log References

### Completion Notes List

### File List

### Change Log
