---
authored_against: def8618
baseline_commit: def8618e98dcc9ef95e53376b5c15977a5c241db
---

# Story 6.26: The Accommodation Dialog in Tabs

Status: done

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
  - [x] `STAY_PANEL_MIN_HEIGHT = 400` (was 300 until Task 7 measured it), on the form element so one element carries the number and a fifth panel would inherit it.
  - [x] **Measured in a browser, on two stays and two widths** — see the constant's comment for the table. It shipped as arithmetic (300) and the arithmetic was wrong twice over: it assumed a 44px input at 13.5px type, which fix 6.26a invalidates, and it was desktop-only, missing that the basics row stacks at `xs`. Story 6.24's first figures came from one sampled activity and were wrong the same way; this one was sampled on two.
  - [x] `minHeight`, never `height`. The unit test's `height` assertion was vacuous (jsdom resolves `height` to `""` for every element) and was replaced in review with a check on the exported `STAY_PANEL_FLOOR_SX`; the real proof is the browser pass, where `Kosten` grew to a *used* height of 467.4px against a 300px floor instead of clipping.

- [x] **Task 5 — i18n** (AC: 1, 3)
  - [x] `trips.stay.tabsLabel`, `tabBasics`, `tabCost`, `tabPlace`, `tabMedia`, `tabWithErrors`, `galleryAfterSave` in both dictionaries. Separate keys from `trips.plan.*` rather than shared ones: the two surfaces group different fields and `tabsLabel` names its own subject. Same split `trips.stay.initError` / `trips.plan.initError` already uses.
  - [x] `i18nDictionaries.test.ts` enforces parity; green.

- [x] **Task 6 — Tests** (AC: 1, 2, 3, 4, 5)
  - [x] `tripAccommodationDialog.test.tsx`: three existing cases now reach fields on other tabs and say so through a `selectTab` helper rather than by index — the tab *order* is a property this story owns, and a positional query would pass through a reordering that moved a field to the wrong section.
  - [x] Six new cases: the four sections and their contents; the add-mode media tab; error→tab selection + marker + focus + the marker clearing; the payment path two tabs from the save; the value round trip; the floor being a minimum.
  - [x] `dialogCloseAffordance.test.tsx` needed no change — both of its accommodation cases work on the name field, which is on the tab every open starts on. That is a fact worth having checked rather than assumed: it is the suite that holds Story 6.25's dirty-form guard.

- [x] **Task 7 — Manual browser check** (AC: 1, 5, 7) — **done 2026-08-04**, operated by Tommy against a throwaway copy of `dev.db` on port 3099 (never `prisma/dev.db`). Found and fixed two real defects; see Browser Pass Results below.
  - [x] Throwaway copy of `dev.db` on an isolated port — never `prisma/dev.db`. Recipe in `7-12-bucket-list-sidebar-card.md`'s Dev Notes.
  - [x] At 1400x1000 and at 390x844, click through all four tabs and read `document.querySelector('[role="tabpanel"]').getBoundingClientRect().height`, on more than one stay. **Correct `STAY_PANEL_MIN_HEIGHT` against what comes back** and rewrite the table in its comment with measurements instead of arithmetic.
  - [x] Confirm the four German labels fit one 390px row: "Basisdaten", "Zahlung", "Ort & Notizen", "Medien & Links" — longer than the activity dialog's set, which needed the per-tab padding cut to 6px to fit.
  - [x] Open a stay with split payments and several rows; confirm the `Zahlung` panel exceeds the floor and scrolls rather than being clipped.
  - [x] Stage photos on `Medien & Links`, switch tabs, come back, and confirm the selection is still there and Upload still posts.

### Review Findings

Code review 2026-08-04 (`bmad-code-review`, three parallel layers: Blind Hunter, Edge Case Hunter, Acceptance Auditor). 35 raw findings, 25 after dedup. Every behavioural claim below was reproduced against the real component in jsdom before being recorded.

**Decisions — resolved by Tommy, 2026-08-04**

- [x] [Review][Decision] **`location` has no entry in the error→tab map, and it is a reachable server error** — `locationSchemas.ts` caps `location.label` at 200 characters, and `handleLookupLocation` writes the geocoder's label into `resolvedLocation` untruncated; Nominatim display names pass 200 routinely. **Resolved: map it to Place.** `location` → `place`, focus `${prefix}-place`, via a second small map keyed by *payload* field rather than by form field — `STAY_ERROR_TAB` stays keyed to `keyof AccommodationFormValues` so AC6's compile check is untouched. `tripDayId` remains unmappable and banner-only. Rationale: the Place tab does surface the coordinate line, so AC2's "a field the form does not surface" does not describe `location`.
- [x] [Review][Decision] **`trips.stay.tabCost` says "Zahlung"/"Payment" while the shipped `trips.plan.tabCost` says "Kosten"/"Cost"** — same three fields, two sibling dialogs on one day screen, two names. **Resolved: rename this story's key to "Kosten"/"Cost"** to match the already-shipped activity dialog. Settles the drift the story's Dev Notes raised, and restores agreement between the key name `tabCost` and its value. Departs from the word the original request used, deliberately: two names for one section on one screen is the drift this repo writes stories against.

**Patches**

- [x] [Review][Patch] Tab error markers never appear for react-hook-form's own rule failures — `useMemo` over rhf's mutated-in-place `errors` object never recomputes [`TripAccommodationDialog.tsx:1151`]
- [x] [Review][Patch] Errors on unmounted tabs stay invisible until every mounted-tab error is cleared — the two validation passes are mutually exclusive [`TripAccommodationDialog.tsx:1306` / `:715-739`]
- [x] [Review][Patch] Unmappable server field errors are set on the form anyway, wedging `handleSubmit` into `onInvalid` permanently — every later Save is a silent no-op [`TripAccommodationDialog.tsx:865`]
- [x] [Review][Patch] Block-level `payments` errors (`sumMismatch`, `minRows`, `costRequired`) never clear when the field is fixed — marker and message stand until the next save [`TripAccommodationDialog.tsx:750,806`]
- [x] [Review][Patch] Row-level `payments` errors survive a split→single mode switch — the Cost tab stays marked for a row that no longer exists [`TripAccommodationDialog.tsx:429-453`]
- [x] [Review][Patch] The selected errored tab loses the colour channel — MUI's `.Mui-selected` rule outranks the root `sx`, so the auto-selected tab renders `primary.main` not `warning.main` [`TripAccommodationDialog.tsx:1285`]
- [x] [Review][Patch] `nameRules` (`required`, lenient on whitespace) contradicts the re-run's `!values.name.trim()` — the error clears itself when the user types another space [`TripAccommodationDialog.tsx:719,1153-1158`]
- [x] [Review][Patch] Client validation now runs after a CSRF network round trip, and a token failure masks the field error [`TripAccommodationDialog.tsx:690` vs `:715`]
- [x] [Review][Patch] `STAY_PANEL_MIN_HEIGHT`'s comment contradicts its own table (table says `Medien` ≈ 307, floor is 300) and names panels that do not exist in the UI (`Kosten`, `Medien` vs shipped `Zahlung`, `Medien & Links`) [`TripAccommodationDialog.tsx:203-231`]
- [x] [Review][Patch] `MuiSelect.select`'s touch override is redundant and its justification is factually wrong — the combobox display already carries `MuiInputBase-input`, verified [`theme.ts:434-443`]
- [x] [Review][Patch] `theme.test.tsx` asserts that the underlying defect still exists — `body1.fontSize < 16` fails for anyone who correctly raises the design system's body size [`theme.test.tsx:173`]
- [x] [Review][Patch] Menu options are not covered by the touch override — `MuiMenuItem-root` carries no input class, so an open dropdown's options sit below the field that owns them [`theme.ts`]
- [x] [Review][Patch] The new AC2 test's docstring asserts the opposite of Task 3 and of the source comment it is testing — rhf does *not* judge an unmounted field [`tripAccommodationDialog.test.tsx`]
- [x] [Review][Patch] The floor test's second assertion is vacuous — jsdom resolves `height` to `""` for every element, so it passes whatever the component sets [`tripAccommodationDialog.test.tsx`]
- [x] [Review][Patch] AC4's own named items are unasserted — staged upload files, `resolvedLocation` (the test reads the search box, not the resolved state) and "asks exactly once" [`tripAccommodationDialog.test.tsx`]
- [x] [Review][Patch] AC2's third reveal path (server field errors) has no test — Task 2 names three paths, six cases cover two [`tripAccommodationDialog.test.tsx`]
- [x] [Review][Patch] Map `location` → `place` via a payload-keyed side map, focus `${prefix}-place` (from the decision above) [`TripAccommodationDialog.tsx:862-892`]
- [x] [Review][Patch] Rename `trips.stay.tabCost` to "Kosten"/"Cost" (from the decision above) [`i18n/de.ts`, `i18n/en.ts`]
- [x] [Review][Patch] `STAY_ERROR_TAB`'s docstring overstates what the type buys — nothing ties a key's tab to the panel its field actually renders in; mapping `notes` → `"media"` compiles and produces the exact failure the map exists to prevent [`TripAccommodationDialog.tsx:88-92`]

**Deferred**

- [x] [Review][Defer] `STAY_PANEL_MIN_HEIGHT = 300` is unmeasured, and this same diff invalidates the arithmetic behind it [`TripAccommodationDialog.tsx:231`] — deferred to Task 7, DW-172
- [x] [Review][Defer] Native constraint validation pre-empts the whole mechanism when the offending field is on the active tab [`TripAccommodationDialog.tsx:1426,1583`] — deferred, pre-existing, DW-173
- [x] [Review][Defer] The focus effect fails open with no fallback and no diagnostic [`TripAccommodationDialog.tsx:414-419`] — deferred, documented as deliberate, DW-174
- [x] [Review][Defer] German tab-label fit at 390px is unverified, and the error triangle reflows the label mid-session [`TripAccommodationDialog.tsx:1239-1289`] — deferred to Task 7, DW-175
- [x] [Review][Patch] The **activity** dialog's selected errored tab lost the warning colour too [`TripDayPlanDialog.tsx:1703`] — raised as DW-176, then **applied on Tommy's call in the same session**, because fixing one half and not the other would itself have broken AC7's "the two dialogs' tab chrome is the same control". Both now carry the `&.Mui-selected` override; DW-176 is `resolved`, not open. Pinned in both suites — the stay suite asserts the *computed* colour against real MUI (verified to fail as `rgb(75, 99, 88)`, i.e. `primary.main`), the plan suite can only assert the override is present because it stubs `@mui/material` and has no cascade to measure.

**One spec reconciliation.** AC1 and Task 7 name the second tab `Zahlung`, which was the shipped label and is no longer. The decision above renamed it to `Kosten` / "Cost" to match the already-shipped `trips.plan.tabCost`. The AC text is left as written — it records what was asked for — but the label to look for in the browser pass is **`Kosten`**, and it is *shorter* than `Zahlung`, which relaxes rather than tightens Task 7's 390px fit check. One incidental confirmation the rename was right: `tripAccommodationDialog.test.tsx` now needs the same `costField()` helper that `tripDayPlanDialog.test.tsx` has carried since Story 6.22, because "Cost" is the accessible name of both a tab and a field on both surfaces.

**Dismissed** (2): `timeRules` called unreachable because both fields are `type="time"` — defensive depth is correct, a pasted or server-supplied value can still reach it. The touch pointer query also matching Android/Windows tablet — deliberate and documented, and 16px controls are no worse there.

## Browser Pass Results (Task 7, 2026-08-04)

Operated by Tommy on a throwaway copy of `dev.db` served on port 3099 with `UPLOADS_PUBLIC_ROOT` pointed at a scratch directory. Two real stays from the Neuseeland trip, deliberately different: **Hot Water Beach** (3 payments → split mode, no notes) and **Tutukaka** (2 payments, 102-character notes). Measured via `getBoundingClientRect().height` on `[role="tabpanel"]` per tab. Raw JSON for all four runs is in the session scratch directory.

### Panel heights, measured

| panel | 747px | 390px · HWB | 390px · Tutukaka |
|---|---|---|---|
| `Basisdaten` | 194.4 | 289.5 | 289.5 |
| `Ort & Notizen` | 231.9 | 359.0 | **399.0** |
| `Medien & Links` | 355.2 | 358.8 | 358.8 |
| `Kosten` | 467.4 | 1015.8 | 762.3 |

`clipped` was `false` on every panel in every run — exceeding the floor grows the frame, it never cuts content off.

Widths above `sm` (600px) all reproduce the 747px column, because the dialog is `width={520}`: panel content width does not change with the viewport above that breakpoint. So 747px is a valid desktop sample and 1400px was not additionally needed.

### Two defects found, both fixed and re-measured

**1. `STAY_PANEL_MIN_HEIGHT` was 300 and is now 400.** The review had already found the old comment self-contradictory (its own table put `Medien & Links` above the floor); the measurement confirmed it and showed the arithmetic was worse than that — `Medien & Links` is 355–359, not ~307. 400 was chosen because it puts **three of the four panels at exactly the floor at both widths**, which is what AC5 asks for. Only `Kosten` exceeds it, which AC5 exempts explicitly. Confirmed after the change: `Basisdaten` 400, `Ort & Notizen` 400, `Medien & Links` 400, `Kosten` 762.3. For scale, the activity dialog's measured equivalent is 475 — 300 beside 475 would have read as two different frames.

**2. `Basisdaten` was truncated at 390px** — the check Task 7 existed to make, failing on both stays. At 390px each tab is 62.5px wide, leaving ~50px inside the padding, and `Basisdaten` is ~68px as one word. The other three labels fit *only* because they contain spaces and may wrap. Fixed with a soft hyphen (U+00AD) after `Basis` in the German dictionary, so the word gains the same ability to break; the visible word is unchanged when it does not break, and the shared `Tabs` `sx` is untouched, so AC7's "same control" still holds. Smaller type and reduced padding were both measured as insufficient (the word is ~18px too wide) and both would have diverged the chrome from the sibling. Confirmed after the change: `truncated: false` on all four labels, `allOnOneRow: true`.

### Fix 6.26a, verified on screen

`controlFontSize` reads **`16px`** under touch emulation at 390px and `13.5px` on desktop — exactly the intent, and something no test could show, since jsdom evaluates no media queries. The iOS-device half of 6.26a (tap a field and the rich-text editor on a real iPhone, portrait and landscape, confirm no zoom and that pinch-zoom still works) remains outstanding and is recorded as such in its own spec file; it does not block this story.

### AC4's photo staging, verified end to end

Checked on both dialogs. Files landed intact (`1008x672` and `1020x680` PNGs, full byte counts) and the database rows persisted with correct `sort_order`, appended after the existing images rather than overwriting them — two rows on the activity dialog, one on the accommodation dialog, each surviving tab switches and the save. Thumbnails rendered as placeholders during the session, which was an artefact of the isolation setup (`UPLOADS_PUBLIC_ROOT` pointed at a scratch directory that Next does not serve `/uploads` from), not a defect: the pre-existing photos served with HTTP 200 throughout.

### Noted, not part of this story

- `[tiptap warn]: Duplicate extension names found: ['link']` on every day-view load — the rich-text editor registers its link extension twice. Unrelated to 6.26; recorded as DW-178.
- The auth forms submit credentials in a URL query string when JS has not hydrated. Found because the operator's password was written to a dev log in plaintext during this session. Recorded as DW-177; the log was redacted immediately.

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
