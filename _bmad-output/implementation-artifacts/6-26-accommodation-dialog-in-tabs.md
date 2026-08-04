---
authored_against: def8618
baseline_commit: def8618e98dcc9ef95e53376b5c15977a5c241db
---

# Story 6.26: The Accommodation Dialog in Tabs

Status: review

## Story

As a trip planner on a phone,
I want the accommodation dialog split into tabs the way the activity dialog already is,
so that the second-longest form on the day screen stops being one scroll through everything.

## Acceptance Criteria

1. **Four tabs, and no tab holds a single field.** `Basisdaten` (Name, Status, Check-in *or* Check-out), `Zahlung` (Kosten, Zahlungsart, Zahlungszeilen), `Ort & Notizen` (Ortssuche + Koordinatenzeile, Notizen), `Medien & Links` (Link, Bildergalerie). The link moves out of the basics column and onto the media tab for the reason Story 6.22 moved the activity dialog's: the gallery is gated on a saved stay, so on its own that tab would be empty while adding one.
2. **A validation error selects its own tab and focuses its field.** The dialog switches to the first tab in tab order that carries an error and puts the caret on the offending control — including when the user is already standing on that tab. Saving never fails silently: a server error naming a field the form does not surface raises the banner instead of marking nothing.
3. **Every tab with an error is marked**, in colour, in a glyph and in the tab's accessible name — not in colour alone. The marker clears as soon as the field is fixed rather than standing until the next save.
4. **Tab switching loses nothing.** Typed values, the resolved location and files staged for upload all survive a round trip, and Story 6.25's dirty-form confirmation still asks exactly once.
5. **The frame holds still.** A minimum height under the panels, as Story 6.24 put under the activity dialog. A minimum and never a fixed height: the payment rows and the photo strip are both unbounded.
6. **The error→tab map is total.** A tenth form field with no tab is a compile error.
7. **Nothing about behaviour changes.** Every field saves what it saved, every validation message is preserved, and the two dialogs' tab chrome is the same control — this story changes where fields sit, not what they do.

## Tasks / Subtasks

- [x] **Task 1 — The tab bar and the four panels** (AC: 1, 7)
  - [x] `STAY_TAB_IDS` is the order; `Tabs` renders from it and the error walk sorts by it, so "the first tab that owns an error" is decided in one place.
  - [x] Chrome copied from `TripDayPlanDialog` deliberately — the pill switch `theme.ts` already encodes, indicator off. Two dialogs on the same day screen splitting their fields into tabs that *looked* different would read as two unrelated mechanisms.
  - [x] The tablist sits outside the `<form>`. A `Tab` is a `<button>`; keeping it out means no future default can turn a tab switch into a save.
  - [x] Cost left the time row, so the row pairs the status select with the time instead. A lone 44px time input across a 520px dialog was the alternative.
  - [x] `Select` gained an `id`, which lands on the `role="combobox"` element — the focus target a `status` error needs.

- [x] **Task 2 — Errors find their tab** (AC: 2, 3, 6)
  - [x] `STAY_ERROR_TAB` is `Record<keyof AccommodationFormValues, StayTabId>`, so AC6 is the compiler's job. `stayErrorFocusId` is total over the same union via a `never` default, so a new field needs a tab *and* a focus target.
  - [x] Three reveal paths, because three different things know about an error: react-hook-form's own rule failures (`handleSubmit`'s invalid callback), the manual `setError` calls inside `onSubmit` (which cannot read `errors` back — their own `setError` has not applied yet), and the server's field errors.
  - [x] `hasStayError` special-cases `payments`: react-hook-form stores a block-level `{ message }` there for the sum mismatch and a sparse *array* for the per-row messages, and a sparse array is truthy even when empty of both.
  - [x] The silent-failure guard Story 6.22 needed: the accommodation schema has keys this form does not surface (`tripDayId`, `location`) and `details.fieldErrors` may be absent, so an unmappable server error raises `trips.stay.error` rather than marking nothing.

- [x] **Task 3 — The rules that stopped running** (AC: 2, 7)
  - [x] **The trap, found by the AC2 test rather than by inspection.** react-hook-form keeps an unmounted field's *value* (`shouldUnregister` defaults to false, which is what makes AC4 work) but skips its *rules*. Pressing `Save` from `Kosten` therefore sent an empty stay name — `required` — to the server, and the validation_error came back for a field the user could not see.
  - [x] The four rule-bearing fields are re-judged in `onSubmit`, where `values` carries everything regardless of what is mounted. The rule objects are reused rather than their logic re-implemented, so there is still one definition of "valid" per field.
  - [x] Only the time field `stayType` actually renders is judged. The other carries the dialog's default, is never sent, and an error on it would name a field this surface does not show.
  - [x] Failures are collected before any `setError`, so the first one is picked in *tab* order rather than in check order.

- [x] **Task 4 — The floor** (AC: 5)
  - [x] `STAY_PANEL_MIN_HEIGHT = 300`, on the form element so one element carries the number and a fifth panel would inherit it.
  - [x] **This number is arithmetic over the panels' composition, not a browser measurement** — see the constant's comment for the table and the re-measure recipe. Story 6.24's first figures came from one sampled activity and were wrong; this one has not been sampled at all yet. It is the one open item on this story.
  - [x] `minHeight`, never `height`, and the test asserts the distinction rather than grepping the source.

- [x] **Task 5 — i18n** (AC: 1, 3)
  - [x] `trips.stay.tabsLabel`, `tabBasics`, `tabCost`, `tabPlace`, `tabMedia`, `tabWithErrors`, `galleryAfterSave` in both dictionaries. Separate keys from `trips.plan.*` rather than shared ones: the two surfaces group different fields and `tabsLabel` names its own subject. Same split `trips.stay.initError` / `trips.plan.initError` already uses.
  - [x] `i18nDictionaries.test.ts` enforces parity; green.

- [x] **Task 6 — Tests** (AC: 1, 2, 3, 4, 5)
  - [x] `tripAccommodationDialog.test.tsx`: three existing cases now reach fields on other tabs and say so through a `selectTab` helper rather than by index — the tab *order* is a property this story owns, and a positional query would pass through a reordering that moved a field to the wrong section.
  - [x] Six new cases: the four sections and their contents; the add-mode media tab; error→tab selection + marker + focus + the marker clearing; the payment path two tabs from the save; the value round trip; the floor being a minimum.
  - [x] `dialogCloseAffordance.test.tsx` needed no change — both of its accommodation cases work on the name field, which is on the tab every open starts on. That is a fact worth having checked rather than assumed: it is the suite that holds Story 6.25's dirty-form guard.

- [ ] **Task 7 — Manual browser check** (AC: 1, 5, 7) — **not done; this is what `review` is waiting on**
  - [ ] Throwaway copy of `dev.db` on an isolated port — never `prisma/dev.db`. Recipe in `7-12-bucket-list-sidebar-card.md`'s Dev Notes.
  - [ ] At 1400x1000 and at 390x844, click through all four tabs and read `document.querySelector('[role="tabpanel"]').getBoundingClientRect().height`, on more than one stay. **Correct `STAY_PANEL_MIN_HEIGHT` against what comes back** and rewrite the table in its comment with measurements instead of arithmetic.
  - [ ] Confirm the four German labels fit one 390px row: "Basisdaten", "Zahlung", "Ort & Notizen", "Medien & Links" — longer than the activity dialog's set, which needed the per-tab padding cut to 6px to fit.
  - [ ] Open a stay with split payments and several rows; confirm the `Zahlung` panel exceeds the floor and scrolls rather than being clipped.
  - [ ] Stage photos on `Medien & Links`, switch tabs, come back, and confirm the selection is still there and Upload still posts.

## Dev Notes

**Why the two dialogs are not one component.** The obvious move after this story is to extract the tab machinery both dialogs now carry. It was not done, and the reason is that the two halves that look alike are the two that differ most: `TripDayPlanDialog` keeps its errors in three hand-rolled `useState` stores and needs a `PlanErrorKey` union spanning them, while this dialog's errors are react-hook-form's `FieldErrors`, keyed by the form's own fields — so `keyof AccommodationFormValues` *is* the error-key set and there is no second union to maintain. A shared abstraction would have to be generic over both error models, and the shared part left over is the `sx` block on `Tabs`. That is a real extraction candidate for a story allowed to touch both files; it is not this one.

**One label to decide.** The cost tab is called **`Zahlung`**, from the "Zahlungsinformationen" the request named, shortened because four labels share one 390px row. The activity dialog calls the identical section — amount, payment mode, payment rows — **`Kosten`**. Two sibling dialogs on the same day screen naming the same section differently is exactly the drift this repo writes stories against, and it is a one-word change in either direction: rename `trips.stay.tabCost` to "Kosten" / "Cost" for consistency, or rename `trips.plan.tabCost` to match this one. Left as it stands because the request named this word; raised here because the inconsistency was not part of what was asked for.

**One doc drift, left alone deliberately.** `EXPERIENCE.md`'s Interaction Primitives table has a single `auth-tabs / type-tabs` row, and it still lists only the two surfaces the 2026-07-27 pass mocked: Login/Register (Screen E) and the Eintrag-hinzufügen type toggle (Screen G). Two *form* dialogs now split their fields into tabs, which is a different use of the same primitive. Its stated behaviour — "exactly one tab active at a time; switching is instant and never discards values already entered" — is satisfied by both, so nothing in the row is *wrong*; it is incomplete. Story 6.22 did not sync it either, so bringing it up to date covers two stories and belongs to a pass that can also decide whether "form-tabs" wants its own row. Recorded here rather than silently edited.

**The React Compiler bail-out, worth knowing about before the next change.** Two of this story's edits made the compiler stop compiling the whole component, and neither was obvious from the code:

- Writing a `useRef` from a callback passed to `handleSubmit(...)` — `Cannot access refs during render`, because `handleSubmit` is invoked during render. Fixed by holding the pending focus target in state instead, which also removed the separate nonce.
- Reading a `useMemo`'d rule object from a closure **declared earlier in the component body** — `Existing memoization could not be preserved`, three times. Fixed by moving the three rule definitions above `onSubmit`. The bodies are byte-identical.

Both surfaced only in `eslint`, both reported as errors on lines that looked fine, and the second one downgraded two pre-existing `set-state-in-effect` findings from errors to warnings while it was active — so a bail-out can make the lint output look *better*. Compare against `git show HEAD:<file>` when this file's lint output changes shape.

**What is duplicated on purpose.** The `Tabs` `sx`, the `aria-controls`-only-when-selected rule, and the warning-triangle marker are copied from `TripDayPlanDialog` verbatim. Each has a comment saying why it is what it is, because a copy with the reasoning left behind is how the two surfaces drift apart.

## Change Log

| File | Change |
|---|---|
| `src/components/features/trips/TripAccommodationDialog.tsx` | Four tabs, error→tab map, focus resolver, unmounted-rule re-run, panel floor |
| `src/i18n/de.ts`, `src/i18n/en.ts` | Seven `trips.stay.*` keys |
| `test/tripAccommodationDialog.test.tsx` | Three cases adapted, six added |
| `_bmad-output/planning-artifacts/epics.md` | Story 6.26 |
| `_bmad-output/implementation-artifacts/sprint-status.yaml` | `6-26-accommodation-dialog-in-tabs: review` |
