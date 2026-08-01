---
authored_against: 096291f
---

# Story 6.13: Accommodation Cards Editable Like Activities

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner editing a day,
I want the two accommodation cards to open their editor by clicking the card, exactly as activities now do,
so that the timeline has one interaction rule instead of three, and the stay I am looking at is the stay I edit.

## Acceptance Criteria

1. **Both cards are the target.** Clicking the previous-night or current-night card anywhere other than an interactive child opens the dialog its current control opens — `setPreviousStayOpen` / `setStayOpen`. The dialogs themselves are unchanged.
2. **Same mechanism as 6.9.** A stretched `<button>` overlay, not `role="button"` on the card, for the reason 6.9 recorded.
3. **Inline button removed.** The previous-night card's edit/add `Button` (`TripDayView.tsx:2173-2185`) is deleted, so no timeline card carries a visible edit control.
4. **Toolbar button removed.** The stay edit/add button in the toolbar (`:2130-2143`) is deleted. Move, swap and add-plan-item stay.
5. **Empty cards add.** With no accommodation on record, clicking the card opens the same add dialog the removed button opened, and the accessible name says whether it adds or edits.
6. **Copy-previous still works.** The "Vorherige Nacht kopieren" button inside the current-night card (`:2450`) runs its own action and does not open the editor.
7. **Same editability signal.** Hover treatment and edit glyph on a pointer device, permanently visible glyph under `@media (hover: none)` — identical to activity cards, so all three card kinds signal the same way.
8. **Same gating.** No overlay, cursor, hover treatment or glyph without `canEditPlanning`.
9. **Nothing else changes.** Timeline, coverage bar, travel segments, stay dialogs, cost roll-up and the copy action behave exactly as before.

## Tasks / Subtasks

- [ ] **Task 1 — Reuse 6.9's pattern, do not re-derive it** (AC: 1, 2, 7, 8)
  - [ ] Everything needed already exists in this file and was verified in a browser by 6.9: `editableActivityCardSx` (`:1264`), `overlaidContentSx` (`:1314`), `editLabelFor` (`:1325`), `EDIT_GLYPH_CLASS`, and the stretched `<button>` at `:2283-2300`.
  - [ ] Read 6.9's comment block at `:2260-2270` before writing anything. It records why the overlay exists rather than `role="button"` on the card — ARIA gives `button` *Children Presentational: True*, which would collapse the card's title, notes and pills into a single announced label. 6.9 built it the wrong way first and rebuilt it during verification.
  - [ ] If the three helpers are activity-specific in naming only, rename rather than copy. A second set of near-identical helpers is how the two card kinds drift apart later.

- [ ] **Task 2 — Previous-night card** (AC: 1, 3, 5)
  - [ ] `:2163-2186`. Wrap the card in the overlay, calling `setPreviousStayOpen(true)`.
  - [ ] Delete the inline `Button` at `:2173-2185` — both the edit branch and the add branch.
  - [ ] The card renders `trips.dayView.previousNightEmpty` when `previousStay` is null but `previousDay` exists. That empty card must be clickable and open the add dialog.
  - [ ] Keep the existing outer condition: the card is only actionable when `previousDay && canEditPlanning`. With no previous day there is nothing to edit.

- [ ] **Task 3 — Current-night card** (AC: 1, 4, 5, 6)
  - [ ] `:2439-2452`. Same overlay, calling `setStayOpen(true)`.
  - [ ] Delete the toolbar button at `:2130-2143`. Leave the move, swap and add-plan-item buttons beside it alone.
  - [ ] The "Vorherige Nacht kopieren" button sits **inside** this card. `overlaidContentSx` already sets `pointerEvents: "none"` on content and `auto` on `a, button`, so it keeps working — reuse that, do not special-case it.
  - [ ] Verify the copy action after the change: it is the one nested control in either card, and the only place AC6 can fail.

- [ ] **Task 4 — Accessible names** (AC: 5)
  - [ ] `editLabelFor` composes from `trips.plan.editItemAria` ("edit activity …"). Stay cards need their own wording, and it must distinguish add from edit — an empty card and a filled one look alike, so the name is the only signal for a screen reader.
  - [ ] Add keys to **both** dictionaries; `i18nDictionaries.test.ts` enforces parity.
  - [ ] Check whether `trips.stay.editAction` / `addAction` still have readers once both buttons are gone. If not, remove them from both dictionaries.

- [ ] **Task 5 — Tests** (AC: 1, 3, 4, 5, 6, 8)
  - [ ] Update `tripDayViewLayout.test.tsx` and any suite asserting either removed button.
  - [ ] Add: clicking each card opens its dialog; clicking "Vorherige Nacht kopieren" runs the copy and does **not** open the editor; an empty card opens the add dialog; no overlay renders without `canEditPlanning`.
  - [ ] Assert the timeline exposes no button named by `trips.stay.editAction` — that is the mechanical check that both are gone.
  - [ ] `npm test` green.

- [ ] **Task 6 — Manual check** (AC: 6, 7)
  - [ ] jsdom has no media-query engine, so the hover and touch branches need a browser. Confirm all three card kinds — activity, previous night, current night — behave and look identical on hover and on touch.
  - [ ] Exercise the copy-previous button by mouse and by keyboard, since it is the nested control most likely to be swallowed.
  - [ ] Throwaway copy of `dev.db` on an isolated port — never `prisma/dev.db`. Recipe in `7-12-bucket-list-sidebar-card.md`'s Dev Notes.

## Dev Notes

### Why the timeline has three rules today

Story 6.9 made activity cards click-to-edit and removed their pencil. The accommodation cards were not in its scope, so what is left is:

| Card | How you edit it |
|---|---|
| Activity | Click the card. No visible button. |
| Previous night | A `Button` with a pencil **inside** the card (`:2173`). |
| Current night | Nothing on the card. A button in the toolbar **above the timeline** (`:2130`). |

The second is why the card now stands out — it is the only one in the timeline still carrying a control. The third is worse in use: the card you are looking at and the control you press are in different places, which is what Tommy reported.

### This is an application of a verified pattern, not a new one

6.9's overlay was built, found wrong, and rebuilt during its browser verification. The record of that is in the code at `:2260-2280` and in 6.9's change log. Two things it learned:

- `role="button"` on the card makes its contents presentational, so a screen reader announces the whole card as one label. A viewer, who gets no role, would hear the card's structure while a contributor heard one line of it.
- A real `<button>` overlay leaves Enter and Space to the browser — no `onKeyDown`, no `preventDefault`, and therefore no way to swallow a keystroke meant for a link inside the card.

Applying it here should be mechanical. Deviating from it should not happen without reading why it looks the way it does.

### Traps

**1. The copy-previous button is the one nested control.** Activity cards had three (photo strip, link, notes links); these cards have one. It is also the easiest to forget, because it only renders when `canCopyPreviousStay` — a day with no previous stay, or one that already has its own, will not show it. Test with a day that does.

**2. Two different dialogs.** `setPreviousStayOpen` edits *yesterday's* accommodation from today's screen; `setStayOpen` edits today's. Wiring both cards to the same handler would be a silent data bug that no visual check catches.

**3. The empty-card case is the add path.** Removing the buttons removes the only "add accommodation" entry point. If an empty card is not clickable, adding a stay becomes impossible — a capability regression disguised as a cleanup. AC5 exists for exactly this.

**4. `previousDay && canEditPlanning`.** The previous-night card's control has a two-part condition today. The overlay needs the same one, not just `canEditPlanning`.

### Testing

Vitest 3.2 + Testing Library, jsdom, via `test/helpers/renderWithProviders.tsx`. `tripDayViewLayout.test.tsx` is the constraint; 6.9 reworked it heavily, so read it before adding. Hover and the touch branch are browser-only.

### Project Structure Notes

One component: `src/components/features/trips/TripDayView.tsx`. Plus `src/i18n/en.ts` and `de.ts` (new accessible-name keys, possibly two removals), and the affected suite. No route, API, schema or dialog change.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 6.13]
- [Source: travelplan/src/components/features/trips/TripDayView.tsx:1264,1314,1325] — the three helpers to reuse
- [Source: travelplan/src/components/features/trips/TripDayView.tsx:2260-2300] — the overlay and the comment explaining it
- [Source: travelplan/src/components/features/trips/TripDayView.tsx:2130-2143,2173-2186,2439-2452] — the two buttons to remove and the two cards to convert
- [Source: _bmad-output/implementation-artifacts/6-9-day-detail-refinements.md] — the pattern's origin and the rebuild it went through

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

### Change Log
