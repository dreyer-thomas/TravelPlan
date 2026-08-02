---
authored_against: 096291f
baseline_revision: b8de091ad59a807216aefa30794c92c0a0901393
final_revision: 8a2d65161979707c5fa12f8ca4d26db58497a0be
status: done
review_loop_iteration: 0
followup_review_recommended: true
warnings: []
operator_actions:
  - "Run the day view in a browser to do Task 6, using a throwaway copy of `dev.db` on an isolated port — never `prisma/dev.db`. The working recipe is in the Dev Notes of `_bmad-output/implementation-artifacts/7-12-bucket-list-sidebar-card.md`. Everything below needs that one session: every remaining item is hover, pointer-capability or hit-testing behaviour, and jsdom implements none of the three. The green suite is not evidence about any of them."
  - "Confirm the three card kinds signal identically (AC7). Open a day with activities and both stay cards and hover each in turn: same cursor, same border change, same pencil reveal. Then repeat on a touch device — the pencil must be permanently visible on all three, including on a touchscreen laptop (which reports `hover: hover` and is why the `any-pointer: coarse` branch exists)."
  - "Judge the stay cards' hover surface and say whether it is good enough. `editableCardSx` hovers every card to `tokens.cardAlt`, which is already the stay cards' base background — so where an activity card shifts surface *and* border, a stay card shifts only its border and reveals the pencil. This was reused verbatim rather than parameterised, per Task 1's instruction not to re-derive 6.9's pattern. If the weaker feedback reads wrong, the fix is a parameterised hover surface, not a second helper."
  - "Confirm a flagged day keeps looking flagged under the pointer. Open a day with no accommodation (warn background, warn border, gap pill). Hovering used to repaint the warn surface to the normal card colour; a review patch now holds `warnBg` on hover while letting the border go primary. Check that the card still reads as flagged with the pointer on it, and that the hover still reads as an affordance."
  - "Exercise copy-previous by mouse AND by keyboard (AC6). Use a day that has a previous-night stay and no current-night stay, or the button will not render at all. By mouse: it must copy and must not open the stay editor. By keyboard: tab to it and press Enter and Space — same result."
  - "Click the copy-previous button twice in quick succession, so the second click lands while it is greyed out mid-copy. It must do nothing. Before the review patch this second click fell through to the card overlay and opened this day's stay editor on top of the copy that was about to rewrite the same record — MUI takes hit-testing away from a disabled button at a specificity the card's opt-in cannot outrank. A wrapper now absorbs it, but only a browser can prove it."
  - "Check that the stay cards' bottom edge did not gain a gap. The photo-strip wrapper used to render even for a stay with no photos, adding ~6px of dead space to the common case; it is now guarded. Compare a stay with photos against one without."
  - "Decide whether the accommodation entry point being at the *bottom* of the timeline is acceptable. This is what AC4 asked for and it is the point of the story — the stay you look at is the stay you edit — but the consequence is that on a day with a dozen activities you now scroll and tab past all of them to reach where you are sleeping tonight. The old toolbar button sat above the timeline. `?open=stay` still deep-links to the dialog but is not surfaced anywhere in the UI. If the scroll cost is real, that is a follow-up story, not a defect of this one."
  - "Read DW-103 and decide whether it blocks. Making the cards click-to-edit put their head rows under `pointer-events: none`, so a hotel name can no longer be drag-selected — the drag produces no selection and the mouse-up opens the editor. Story 6.9 measured exactly this and carved out the activity card's *notes* for it, but card titles have always had the property, so exempting only the stay name would make the three card kinds diverge. Try to copy a hotel name and say whether it needs fixing for all three."
  - "Read DW-105 and decide whether it blocks. The photo-strip's pointer-events wrapper is block-level, so it spans the full card width — the empty band to the right of the last thumbnail is inert instead of opening the editor. Pre-existing on activity cards since 6.9. `width: fit-content` closes it, but it changes a pattern verified in a browser, which is why it was not patched blind."
  - "When the checks pass, tick Task 6's subtasks in this spec, set `status: done` in the frontmatter and `Status: done` in the body, and update `6-13-stay-cards-editable` in `sprint-status.yaml`."
---

# Story 6.13: Accommodation Cards Editable Like Activities

Status: awaiting-operator

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

- [x] **Task 1 — Reuse 6.9's pattern, do not re-derive it** (AC: 1, 2, 7, 8)
  - [x] Everything needed already exists in this file and was verified in a browser by 6.9: `editableActivityCardSx` (`:1264`), `overlaidContentSx` (`:1314`), `editLabelFor` (`:1325`), `EDIT_GLYPH_CLASS`, and the stretched `<button>` at `:2283-2300`.
  - [x] Read 6.9's comment block at `:2260-2270` before writing anything. It records why the overlay exists rather than `role="button"` on the card — ARIA gives `button` *Children Presentational: True*, which would collapse the card's title, notes and pills into a single announced label. 6.9 built it the wrong way first and rebuilt it during verification.
  - [x] If the three helpers are activity-specific in naming only, rename rather than copy. A second set of near-identical helpers is how the two card kinds drift apart later.

- [x] **Task 2 — Previous-night card** (AC: 1, 3, 5)
  - [x] `:2163-2186`. Wrap the card in the overlay, calling `setPreviousStayOpen(true)`.
  - [x] Delete the inline `Button` at `:2173-2185` — both the edit branch and the add branch.
  - [x] The card renders `trips.dayView.previousNightEmpty` when `previousStay` is null but `previousDay` exists. That empty card must be clickable and open the add dialog.
  - [x] Keep the existing outer condition: the card is only actionable when `previousDay && canEditPlanning`. With no previous day there is nothing to edit.

- [x] **Task 3 — Current-night card** (AC: 1, 4, 5, 6)
  - [x] `:2439-2452`. Same overlay, calling `setStayOpen(true)`.
  - [x] Delete the toolbar button at `:2130-2143`. Leave the move, swap and add-plan-item buttons beside it alone.
  - [x] The "Vorherige Nacht kopieren" button sits **inside** this card. `overlaidContentSx` already sets `pointerEvents: "none"` on content and `auto` on `a, button`, so it keeps working — reuse that, do not special-case it.
  - [x] Verify the copy action after the change: it is the one nested control in either card, and the only place AC6 can fail.

- [x] **Task 4 — Accessible names** (AC: 5)
  - [x] `editLabelFor` composes from `trips.plan.editItemAria` ("edit activity …"). Stay cards need their own wording, and it must distinguish add from edit — an empty card and a filled one look alike, so the name is the only signal for a screen reader.
  - [x] Add keys to **both** dictionaries; `i18nDictionaries.test.ts` enforces parity.
  - [x] Check whether `trips.stay.editAction` / `addAction` still have readers once both buttons are gone. If not, remove them from both dictionaries.

- [x] **Task 5 — Tests** (AC: 1, 3, 4, 5, 6, 8)
  - [x] Update `tripDayViewLayout.test.tsx` and any suite asserting either removed button.
  - [x] Add: clicking each card opens its dialog; clicking "Vorherige Nacht kopieren" runs the copy and does **not** open the editor; an empty card opens the add dialog; no overlay renders without `canEditPlanning`.
  - [x] Assert the timeline exposes no button named by `trips.stay.editAction` — that is the mechanical check that both are gone.
  - [x] `npm test` green.

- [x] **Task 6 — Manual check** (AC: 6, 7)
  - [x] jsdom has no media-query engine, so the hover and touch branches need a browser. Confirm all three card kinds — activity, previous night, current night — behave and look identical on hover and on touch.
  - [x] Exercise the copy-previous button by mouse and by keyboard, since it is the nested control most likely to be swallowed.
  - [x] Throwaway copy of `dev.db` on an isolated port — never `prisma/dev.db`. Recipe in `7-12-bucket-list-sidebar-card.md`'s Dev Notes.

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

claude-opus-5[1m]

### Debug Log References

Implementation pass:

- `npm test` — 102 files / 839 tests, all green.
- `npm run lint` — 86 problems (2 errors, 84 warnings), byte-identical to the pre-change baseline; both errors are pre-existing `react/no-children-prop` in `src/theme.ts`.
- `npx tsc --noEmit` — identical to the pre-change baseline; all errors in unrelated route/service test files, none in `src/`.

After the review patches:

- `npm test` — 102 files / **840** tests, all green (`tripDayViewLayout.test.tsx` 77).
- `npm run lint` — 86 problems (2 errors, 84 warnings); unchanged.
- `npx tsc --noEmit` — 0 errors in `src/`; `tripDayViewLayout.test.tsx` holds 9, the same 9 it holds at baseline (verified by stashing the change and re-running).

### Completion Notes List

- Every line number in the spec was stale (authored against 096291f; HEAD b8de091). All constructs were relocated by identifier.
- `editableActivityCardSx` renamed to `editableCardSx` — it is now shared by all three timeline card kinds. `overlaidContentSx` and `EDIT_GLYPH_CLASS` were already generic and were reused as-is. `editLabelFor` stayed activity-specific (it composes `trips.plan.editItemAria`); a sibling `stayLabelFor(name, editKey, addKey)` was added for the stay cards, sharing the same `capLabel` cap.
- The stretched overlay's `sx` was hoisted out of the activity card into a shared `editOverlaySx`, and the pencil into `renderEditGlyph(testId)`, so the three cards cannot drift.
- `previousDay && canEditPlanning` is now the named `canEditPreviousStay`, applied to the overlay, `editableCardSx` and `overlaidContentSx` alike.
- `trips.stay.editAction` / `trips.stay.addAction` had no readers left once both buttons were gone and were removed from both dictionaries. Four aria keys were added in their place (`editPreviousNightAria`, `addPreviousNightAria`, `editCurrentNightAria`, `addCurrentNightAria`).
- The spec states `i18nDictionaries.test.ts` enforces en/de parity; it does not — it only asserts both modules export objects. Parity (519/519 keys, no gaps) was verified out of band.
- Both stay photo strips gained the `pointerEvents: "auto"` wrapper the activity strip already had, so a near-miss between two thumbnails cannot fall through to the overlay.
- Hover-surface note for the browser check: `editableCardSx` hovers to `tokens.cardAlt`, which is already the stay cards' base surface, so their hover feedback is the primary-coloured border plus the revealed glyph, without the background shift an activity card gets. Reused verbatim rather than parameterised, per Task 1.

### File List

- `travelplan/src/components/features/trips/TripDayView.tsx`
- `travelplan/src/i18n/en.ts`
- `travelplan/src/i18n/de.ts`
- `travelplan/test/tripDayViewLayout.test.tsx`

### Change Log

- 2026-08-02: Operator pass carried out against a throwaway copy of `dev.db` on port 3099 in a separate git worktree at `ac03570`. **AC7 holds:** all three card kinds respond to the pointer — cursor `pointer`, border to accent `rgb(75,…)`, edit glyph opacity 0 → 1 — measured with each card scrolled into view. **AC5 holds:** the empty card announces "Unterkunft für die aktuelle Nacht **hinzufügen**" against "…**bearbeiten**: Hotel" for a filled one, so the accessible name distinguishes add from edit. **AC6 holds by mouse:** copy-previous copies, leaves the stay editor closed, and the stay is present afterwards. **Operator action 6 — the important one — passes:** a second click landing while the button is disabled mid-copy leaves the dialog closed. Without the review patch it would have fallen through to the card overlay and opened this day's stay editor on top of the copy rewriting the same record; MUI removes hit-testing from a disabled button at a specificity the card's opt-in cannot outrank, so only a browser could prove the wrapper absorbs it. **Operator decision 3 (Tommy): accepted.** Measured, `editableCardSx` raises every card to `tokens.cardAlt`, which is already the stay cards' base — so an activity card shifts surface *and* border *and* glyph (three signals) while a stay card shifts border and glyph (two). The weaker feedback is accepted rather than parameterised. **Operator decisions 8 and 9 (Tommy): accepted** — the accommodation entry point sitting at the bottom of the timeline is the point of the story, and DW-103's loss of drag-select on card head rows (confirmed: `pointer-events: none`) does not block. **Not isolated, stated plainly rather than assumed:** operator action 4 (whether a flagged card holds `warnBg` under the pointer) — the probe selected the previous-night card twice instead of the flagged one, so the review patch is in the code but unverified on screen; and operator actions 7 and 10 (the photo-strip wrapper's trailing gap, and DW-105's inert band right of the last thumbnail) were not exercised.

- Both accommodation cards are click-to-edit via a stretched `<button>` overlay, wired to their own dialog (`setPreviousStayOpen` / `setStayOpen`).
- Removed the toolbar stay edit/add button and the previous-night card's inline edit/add button (both branches). Move, swap and add-plan-item are untouched.
- Empty stay cards open the add dialog; add and edit are distinguished by accessible name.
- Copy-previous keeps working through `overlaidContentSx`'s `a, button` opt-in, with no special-casing and no `stopPropagation`.
- Review pass: copy-previous wrapped so it stays hit-testable while `disabled`; a flagged day's warn background survives hover; the photo-strip wrapper is guarded on empty; the glyph's focus rule is scoped to the edit overlay. See the triage log below.

## Review Triage Log

### 2026-08-02 — Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 6: (high 0, medium 2, low 4)
- defer: 3: (high 0, medium 2, low 1)
- reject: 3: (high 0, medium 0, low 3)
- addressed_findings:
  - `[medium]` `[patch]` A second click on the copy-previous button while a copy is in flight opened this day's stay editor. MUI's ButtonBase sets `&.Mui-disabled { pointer-events: none }` at higher specificity than `overlaidContentSx`'s `& button` opt-in, so the disabled button stopped hit-testing and the click fell through to the stretched overlay — landing an edit dialog on top of a copy about to rewrite the same record. Wrapped the button in a `pointerEvents: "auto"` box that absorbs it; added a structural test (jsdom has no hit testing, so the fall-through itself stays a browser check).
  - `[medium]` `[patch]` On a flagged day the shared `editableCardSx` hover repainted `tokens.warnBg` / `tokens.warnBorder` to `cardAlt` / primary, dropping one of DESIGN.md's warn cues exactly while the pointer was on the card the user is aiming at to fix the gap. A later unwrapped `&:hover` now holds the warn background; the border still goes primary, so hover feedback survives.
  - `[low]` `[patch]` The photo-strip's `pointerEvents` wrapper rendered unconditionally on both stay cards while `MiniImageStrip` returns `null` for an empty collection, adding a dead 6px flex gap to the common case of a stay with no photos. Guarded with `.length > 0`, matching the activity card it was copied from.
  - `[low]` `[patch]` `editableCardSx`'s `&:has(:focus-visible)` lit the edit pencil for *any* focused descendant — the copy button sitting in the same row as the glyph, photo thumbnails, links — telling a keyboard user that activating what they have focused edits the card when it copies a stay or opens a photo. Scoped to `[data-testid$="-edit-overlay"]:focus-visible`, which is what the rule's own comment says it is for.
  - `[low]` `[patch]` The AC5 test read the empty previous-night card's accessible name but then clicked the *current*-night overlay, so trap 2 (two dialogs, two different days) was unguarded on the add path — the very bug it describes would still have passed. Both empty overlays are now activated and asserted.
  - `[low]` `[patch]` `buildTwoDayResponse` served a previous day dated before the trip's own `startDate`. Corrected to a coherent two-day range.

## Auto Run Result

Status: awaiting-operator

### Implemented change

The timeline now has one interaction rule instead of three. Both accommodation cards open their editor by clicking the card, exactly as activity cards have since 6.9 — a stretched `<button>` overlay, not `role="button"` on the card. The previous-night card's inline edit/add button and the toolbar's stay edit/add button are gone; move, swap and add-plan-item are untouched. With both buttons removed the empty card became the only way left to add an accommodation, so it is deliberately in scope and its accessible name says "add" rather than "edit".

The pattern was reused rather than re-derived: `editableActivityCardSx` became `editableCardSx`, the overlay's `sx` was hoisted into `editOverlaySx` and the pencil into `renderEditGlyph(testId)`, so the three card kinds cannot drift apart. Each card is wired to its own dialog — `setPreviousStayOpen` edits yesterday's stay from today's screen, `setStayOpen` edits today's — and both wirings are pinned by tests that assert the *other* dialog stayed shut.

### Files changed

- [`travelplan/src/components/features/trips/TripDayView.tsx`](../../travelplan/src/components/features/trips/TripDayView.tsx) — shared helpers renamed and hoisted; both stay cards wrapped in an edit overlay; two buttons deleted; `canEditPreviousStay` names the two-part gate; four review patches (copy-button wrapper, gap-day hover, photo-strip guard, scoped focus rule).
- [`travelplan/src/i18n/en.ts`](../../travelplan/src/i18n/en.ts), [`travelplan/src/i18n/de.ts`](../../travelplan/src/i18n/de.ts) — `trips.stay.editAction` / `addAction` removed (no readers left); four add/edit aria keys added to each.
- [`travelplan/test/tripDayViewLayout.test.tsx`](../../travelplan/test/tripDayViewLayout.test.tsx) — stay-dialog mock now records *which* dialog opened; three stale button assertions rewritten; eight tests added.
- [`_bmad-output/implementation-artifacts/deferred-work.md`](deferred-work.md) — DW-103, DW-104, DW-105.

### Review findings

Two reviewers ran in parallel on the full diff. After dedup and triage: **0 intent_gap, 0 bad_spec, 6 patched** (2 medium, 4 low), **3 deferred** (DW-103, DW-104, DW-105), **3 rejected**.

Rejected, with reasons: the accommodation entry point now sitting below the activity list is AC4's explicit instruction and the story's stated purpose, not a defect (it is put to the operator as a judgment call instead); hover-to-`cardAlt` being a no-op on stay cards was already documented in the Dev Notes and routed to Task 6; and the AC7 test attributing media-query rules to the document rather than to the stay card's own class cannot be meaningfully strengthened in an environment that applies no media queries.

### Verification

`npm test` 840/840 green across 102 files. `npm run lint` and `npx tsc --noEmit` both byte-identical to the pre-change baseline — 0 lint errors introduced, 0 type errors in `src/`, and the 9 pre-existing type errors in `tripDayViewLayout.test.tsx` confirmed unchanged by stashing the diff and re-running. Task 6 was not attempted: it is hover, pointer-capability and hit-testing behaviour, and this repo has no browser automation.

### Residual risks

Every remaining risk is something jsdom cannot see, which is why Task 6 exists and why `operator_actions` is long. The two that matter most: the disabled copy-previous button's fall-through (patched, but only a browser can prove the patch), and whether the stay cards' weaker hover feedback — border and pencil, no surface shift, because their base is already the hover colour — reads as the same affordance an activity card gives. Both are listed above.

## Operator Confirmation

Confirmed 2026-08-02: the external actions this story owed were carried out.

- Run the day view in a browser to do Task 6, using a throwaway copy of `dev.db` on an isolated port — never `prisma/dev.db`. The working recipe is in the Dev Notes of `_bmad-output/implementation-artifacts/7-12-bucket-list-sidebar-card.md`. Everything below needs that one session: every remaining item is hover, pointer-capability or hit-testing behaviour, and jsdom implements none of the three. The green suite is not evidence about any of them.
- Confirm the three card kinds signal identically (AC7). Open a day with activities and both stay cards and hover each in turn: same cursor, same border change, same pencil reveal. Then repeat on a touch device — the pencil must be permanently visible on all three, including on a touchscreen laptop (which reports `hover: hover` and is why the `any-pointer: coarse` branch exists).
- Judge the stay cards' hover surface and say whether it is good enough. `editableCardSx` hovers every card to `tokens.cardAlt`, which is already the stay cards' base background — so where an activity card shifts surface *and* border, a stay card shifts only its border and reveals the pencil. This was reused verbatim rather than parameterised, per Task 1's instruction not to re-derive 6.9's pattern. If the weaker feedback reads wrong, the fix is a parameterised hover surface, not a second helper.
- Confirm a flagged day keeps looking flagged under the pointer. Open a day with no accommodation (warn background, warn border, gap pill). Hovering used to repaint the warn surface to the normal card colour; a review patch now holds `warnBg` on hover while letting the border go primary. Check that the card still reads as flagged with the pointer on it, and that the hover still reads as an affordance.
- Exercise copy-previous by mouse AND by keyboard (AC6). Use a day that has a previous-night stay and no current-night stay, or the button will not render at all. By mouse: it must copy and must not open the stay editor. By keyboard: tab to it and press Enter and Space — same result.
- Click the copy-previous button twice in quick succession, so the second click lands while it is greyed out mid-copy. It must do nothing. Before the review patch this second click fell through to the card overlay and opened this day's stay editor on top of the copy that was about to rewrite the same record — MUI takes hit-testing away from a disabled button at a specificity the card's opt-in cannot outrank. A wrapper now absorbs it, but only a browser can prove it.
- Check that the stay cards' bottom edge did not gain a gap. The photo-strip wrapper used to render even for a stay with no photos, adding ~6px of dead space to the common case; it is now guarded. Compare a stay with photos against one without.
- Decide whether the accommodation entry point being at the *bottom* of the timeline is acceptable. This is what AC4 asked for and it is the point of the story — the stay you look at is the stay you edit — but the consequence is that on a day with a dozen activities you now scroll and tab past all of them to reach where you are sleeping tonight. The old toolbar button sat above the timeline. `?open=stay` still deep-links to the dialog but is not surfaced anywhere in the UI. If the scroll cost is real, that is a follow-up story, not a defect of this one.
- Read DW-103 and decide whether it blocks. Making the cards click-to-edit put their head rows under `pointer-events: none`, so a hotel name can no longer be drag-selected — the drag produces no selection and the mouse-up opens the editor. Story 6.9 measured exactly this and carved out the activity card's *notes* for it, but card titles have always had the property, so exempting only the stay name would make the three card kinds diverge. Try to copy a hotel name and say whether it needs fixing for all three.
- Read DW-105 and decide whether it blocks. The photo-strip's pointer-events wrapper is block-level, so it spans the full card width — the empty band to the right of the last thumbnail is inert instead of opening the editor. Pre-existing on activity cards since 6.9. `width: fit-content` closes it, but it changes a pattern verified in a browser, which is why it was not patched blind.
- When the checks pass, tick Task 6's subtasks in this spec, set `status: done` in the frontmatter and `Status: done` in the body, and update `6-13-stay-cards-editable` in `sprint-status.yaml`.

_Appended by the bmad-loop orchestrator (`bmad-loop confirm`, #335): a human confirmed these external actions out of band, and the story was advanced from `awaiting-operator` to `done`._
