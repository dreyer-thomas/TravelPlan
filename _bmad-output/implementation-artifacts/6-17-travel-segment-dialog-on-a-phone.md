---
authored_against: ac03570
baseline_revision: 72825cbacae80476ee15aab09d7e30360267abb0
final_revision: 01d072721333a996df5e71e73d8ad5d2a88dea5f
status: done
review_loop_iteration: 0
warnings: []
followup_review_recommended: false
operator_actions:
  - "Start the app against a throwaway copy of dev.db on an isolated port — never prisma/dev.db. The recipe is in 7-12-bucket-list-sidebar-card.md's Dev Notes."
  - "At a 390px viewport, in German, open a travel segment between two items that both have locations. Confirm Maps, Plan, Abbrechen and OK sit on one row, no label wraps mid-word, and neither the dialog nor the page shows a horizontal scrollbar. If the row wraps, record which label wrapped — the expected culprit is Abbrechen, which is common.cancel and out of this story's scope."
  - "Repeat the same 390px check on the edit dialog of an existing segment: it is the only place refreshGoogleMapsRoute renders, and only a browser shows the two keys at their real widths."
  - "Repeat both checks at 390px in English."
  - "Open a segment where neither neighbour has a location. Confirm exactly one line under the form — 'Füge beiden Nachbareinträgen einen Ort hinzu.' — that it does not wrap to three lines, and that the Plan button is disabled."
  - "With both neighbours placed, choose Auto or Zu Fuß and press Plan. Confirm the alert 'Die Routendaten wurden aus Maps übernommen.' appears once and that duration and distance are filled in."
  - "With both neighbours placed, switch the mode to Schiff or Flug. Confirm the manual-mode helper appears exactly once — not both as grey text under the form and again as an info alert — and note how many lines it takes at 390px; at 103 characters it is the longest surviving helper."
  - "Add a new car segment between two placed items and confirm there is now no standing grey text under the link field at all — the removed 'Öffne die Route in Google Maps und übertrage…' line."
  - "If every check passes, tick Task 6 in this spec, set status: done in the frontmatter and Status: done in the body, and set 6-17-travel-segment-dialog-on-a-phone to done in sprint-status.yaml."
---

# Story 6.17: Travel Segment Dialog on a Phone

Status: awaiting-operator

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner adding a leg on my phone,
I want short button labels and less explanatory prose,
so that the dialog fits the screen instead of wrapping its controls.

## Acceptance Criteria

1. **Four strings, as specified.** `openLink` → "Maps"; `calculateGoogleMapsRoute` and `refreshGoogleMapsRoute` → "Plan"; the save action → "OK"; `googleMapsFallbackHelper` removed. Both dictionaries, since `i18nDictionaries.test.ts` enforces parity.
2. **The removed key is deleted**, not orphaned, and any assertion pinning it is updated.
3. **`common.save` does not stay misnamed.** It has exactly one reader — this dialog. Giving a key called `common.save` the value "OK" is a trap for the next dialog that reaches for it, so it is renamed to something dialog-specific or the change is recorded where the next reader will see it.
4. **The other helpers reviewed.** `googleMapsUnavailableHelper`, `googleMapsCarOnlyHelper`, `googleMapsFallbackActive` and `googleMapsPrefillSuccess` are each judged by the same standard; whatever is kept still says what the user needs at the moment it appears.
5. **Fits at 390px.** No label wraps mid-word, no horizontal scrollbar, and the controls sit on one row where they fit.
6. **Nothing functional changes.** Every field, validation rule, route call and save path behaves as before.

## Tasks / Subtasks

- [x] **Task 1 — The four strings** (AC: 1, 2)
  - [x] `src/i18n/de.ts` and `en.ts`: all four applied, identically in both dictionaries.
    - `trips.travelSegment.openLink`: "Open Maps" → "Maps"
    - `trips.travelSegment.calculateGoogleMapsRoute`: "Plan with Maps" → "Plan"
    - `trips.travelSegment.refreshGoogleMapsRoute`: "Plan with Maps" → "Plan"
    - `trips.travelSegment.googleMapsFallbackHelper`: deleted from both dictionaries, reader removed
  - [x] Both keys are reachable — they are the two arms of the ternary at `TripDayTravelSegmentDialog.tsx:650-652`, `isEditing` selecting between them. Neither is dead, so both are kept. See Completion Note 3.
  - [x] German gets the same three words. "Maps", "Plan" and "OK" are used unchanged in German; a comment in each dictionary records that this is a decision, not the leftover untranslated English `de.ts` actually held. See Completion Note 2.

- [x] **Task 2 — The save key** (AC: 3)
  - [x] Confirmed by grep across `src/` and `test/`, including template-literal key construction: exactly one reader, `TripDayTravelSegmentDialog.tsx:663`. The only two computed keys in the codebase are `language.${…}` and `trips.travelSegment.transport.${…}`; neither can reach a `common.` key. No test pinned `common.save` by name.
  - [x] Renamed to `trips.travelSegment.save` = "OK" in both dictionaries; `common.save` deleted, not left orphaned. `common.cancel` and `common.close` are untouched and still genuinely shared.
  - [x] A comment sits where `common.save` used to be in both dictionaries, so the next reader looking for it finds out where the value went and why it is not `common.`.

- [x] **Task 3 — The remaining helpers** (AC: 4)
  - [x] All four judged and all four kept, three of them shortened. `googleMapsCarOnlyHelper` no longer exists under that name — Story 6.16 landed first and renamed it to `googleMapsManualModeHelper`; that key was judged in its place. Per-key reasoning in Completion Note 4.
  - [x] Standard applied per key: the sentence that told the user what to do stayed, the sentence that explained the feature went.
  - [x] `googleMapsUnavailableHelper` kept, shortened from 86 to 45 characters in German. The imperative survives; the purpose clause ("um eine Google-Maps-Route zu berechnen") is now carried by the disabled "Plan" button two rows below it.
  - [x] Story 6.16 read first, not reverted. Its AC5 — the helper "names the modes that do import" and never claims car-only — is preserved verbatim and is now pinned by a test. Only the trailing clause the visible "Maps" button already makes was cut. See Completion Note 5.

- [x] **Task 4 — Layout at 390px** (AC: 5) — as far as a static pass reaches; the measurement itself is Task 6
  - [x] What remains checked statically, not measured. The action row is the only row this story changes and it is still the tightest one; "Abbrechen" is now the longest label in it and this story does not own it (`common.cancel` really is shared). Arithmetic and the residual risk are in Completion Note 7.
  - [x] No field order, breakpoint or structural change. The only structural edit is that the standing-helper `Typography` is no longer rendered when there is no helper to put in it — a removal, not a restructure.

- [x] **Task 5 — Tests** (AC: 1, 2, 6)
  - [x] 17 queries updated in `travelSegmentDialog.test.tsx` (6 × "Save", 10 × "Plan with Maps", 1 × "Open Maps") plus seven helper-text assertions. 20 cases → 28.
  - [x] It would **not** have. `i18nDictionaries.test.ts` asserted only that the two objects exist; nothing in the repo compared their key sets, and `translate()` returns the key itself when it is missing, so a half-applied rename would have shipped the literal string `trips.travelSegment.save` to one language silently. The parity check the spec assumed now exists. 1 case → 13. See Completion Note 6.
  - [x] Asserted in both languages, against the literal deleted strings rather than against the key — see Completion Note 6 for why a key-based query would have passed no matter what.
  - [x] `npm test` green: 102 files, 918 tests, 0 failures.

- [ ] **Task 6 — Manual check** (AC: 5) — **owed to the operator**; jsdom computes no layout and evaluates no media query, and this repo has no browser automation. Enumerated in Completion Note 8.
  - [ ] Open the dialog at 390px in both languages — German strings are longer and are the constraint.
  - [ ] Check the states that surface the surviving helpers: no locations on either neighbour, and a successful prefill.
  - [ ] Throwaway copy of `dev.db` on an isolated port — never `prisma/dev.db`. Recipe in `7-12-bucket-list-sidebar-card.md`'s Dev Notes.

## Dev Notes

### What was asked, verbatim

Tommy on 2026-08-02, after using the dialog on a phone: *"Die Texte sind zu lang. Mein Vorschlag wäre aus 'Open Maps' => 'Maps', 'Plan with Maps' => 'Plan', 'Speichern' => 'OK'. Zudem entferne diesen Text 'Öffne die Route in Google Maps und …'."*

The removed helper reads in full: *"Öffne die Route in Google Maps und übertrage Dauer und Entfernung anschließend manuell in dieses Formular."* It explains a workflow the user is already performing by the time they read it.

### `common.save` is the one real trap here

It is named as though it were shared and is not — one reader, this dialog. So changing its value is safe *today* and dangerous *later*: the name is an invitation. This is the same class of problem as `baseline_commit` earlier in this project's history — a name that promises one thing while a consumer assumes another.

### Two stories touch the same helper

Story **6.16** rewrites `googleMapsCarOnlyHelper` because walking and cycling gain route import, which makes "nur für Auto-Abschnitte" false. This story reviews the same key for length. Whichever lands second must read the other's change rather than reverting it.

### Traps

**1. Key parity is enforced.** `i18nDictionaries.test.ts` compares the two dictionaries key-for-key. A key deleted from one only will fail it.

**2. Tests query by visible text.** `travelSegmentDialog.test.tsx` finds controls by their labels. Renaming a label without updating the query produces a failure that looks like a broken control.

**3. Do not redesign the form.** This is a copy story. If shorter labels are not enough, that is a finding, not licence to restructure a dialog that works.

### Testing

Vitest 3.2 + Testing Library, jsdom, via `test/helpers/renderWithProviders.tsx`. `travelSegmentDialog.test.tsx` and `i18nDictionaries.test.ts` are the two constraints. Layout at 390px is browser-only.

### Project Structure Notes

`src/i18n/en.ts`, `src/i18n/de.ts`, `src/components/features/trips/TripDayTravelSegmentDialog.tsx`, and the two suites. No route, schema or validation change.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 6.17]
- [Source: travelplan/src/i18n/de.ts:303-330] — the travel-segment string block
- [Source: travelplan/src/i18n/de.ts:532] — `common.save`, one reader
- [Source: _bmad-output/planning-artifacts/epics.md#Story 6.16] — the other story touching `googleMapsCarOnlyHelper`

## Operator Pass — 2026-08-02, against `0ab5e0e`

Chromium at 390px, isolated worktree on port 3099 against a copy of `dev.db`; `prisma/dev.db` untouched.

- **Action row, German (AC5):** `Maps` `Plan` `Abbrechen` `OK` on **one row** (tops 654/655), each label a single line box, none overflowing. Page 390/390 — no horizontal scrollbar, in the dialog or on the page.
- **Edit dialog** (the only place `refreshGoogleMapsRoute` renders): identical.
- **English:** `Maps` `Plan` `Cancel` `OK` — same result. `Abbrechen`, flagged as the likely wrapper because it is `common.cancel` and out of scope, fits at 84px.
- **No locations:** "Füge beiden Nachbareinträgen einen Ort hinzu." renders **once, on one line**; `Plan` is disabled; the `Maps` link is absent.
- **After Plan:** "Die Routendaten wurden aus Maps übernommen." appears **exactly once**; duration and distance filled (04:44 / 484.4).
- **Ship/Flight (AC4):** the manual-mode helper renders **exactly once**, never twice — 3 lines as standing grey text in the *add* dialog, 4 lines as an info alert in the *edit* dialog after pressing Plan. The review's split holds.
- **New car segment:** no standing grey text besides the link-field helper. The removed "Öffne die Route in Google Maps und übertrage…" is gone.

Coordination with 6.16 confirmed: `googleMapsCarOnlyHelper` is now `googleMapsManualModeHelper` and reads "deckt Auto, zu Fuß und Fahrrad ab" — 6.17 shortened against that version rather than reverting it. `common.save` was **renamed** to `trips.travelSegment.save`, with a test pinning its absence.

## Dev Agent Record

### Agent Model Used

Claude Opus 5 (1M context), via `bmad-dev-auto`.

### Debug Log References

- `npm test` (from `travelplan/`) → `Test Files 102 passed (102)` / `Tests 918 passed (918)`. **No failures at all.** The 5 `tripImportDialog` / `tripImportRoute` size-limit failures recorded as pre-existing by Stories 6.14 and 6.15 are gone from the baseline; nothing was stashed, because nothing failed to attribute.
- `npx vitest run test/i18nDictionaries.test.ts test/travelSegmentDialog.test.tsx` → `Tests 41 passed (41)`. `travelSegmentDialog.test.tsx` 20 → 28 cases; `i18nDictionaries.test.ts` 1 → 13.
- `npx eslint` on the five changed files → `✖ 1 problem (0 errors, 1 warning)`. The warning is the pre-existing `react-hooks/set-state-in-effect` on the dialog's open-reset effect at `TripDayTravelSegmentDialog.tsx:251`, which this story does not touch — its nearest edit is 262 lines below it.
- `npx tsc --noEmit` → 143 errors, the same count Story 6.14 recorded against its baseline, and **none in any of the five changed files** (grepped by path). Still DW-95.
- Dictionary key counts: 524 → 523 in both languages (`common.save` and `googleMapsFallbackHelper` out, `trips.travelSegment.save` in), key sets identical.
- Mutation checks, each run against `i18nDictionaries.test.ts` + `travelSegmentDialog.test.tsx` (41 green) and reverted immediately. All eight were caught:
  - `openLink` back to "Open Maps" in **`de.ts` only** → 3 fail. The half-applied case, which nothing in the repo could catch before this story.
  - `refreshGoogleMapsRoute` back to "Plan with Maps" in `en.ts` → 18 fail.
  - `common.save` restored in both dictionaries and read again by the dialog → 12 fail.
  - `googleMapsFallbackHelper` re-added to both dictionaries and re-rendered in the branch it used to occupy → 3 fail. The escape this specifically closes: without the new "renders no standing helper" cases, re-adding the key would have been invisible.
  - `googleMapsPrefillSuccess` back to its long wording in both dictionaries → 3 fail.
  - `googleMapsManualModeHelper` reverted to a car-only claim, i.e. undoing Story 6.16 → 4 fail.
  - `trips.travelSegment.save` dropped from **`de.ts` only** → 5 fail (parity + the paired-value cases).
  - `googleMapsUnavailableHelper` reverted in **`de.ts` only** → 2 fail.
  - Restored state re-verified at 41/41 after the last one.
- **Process note, for whoever reads this next.** The first two mutations were reverted with `git checkout -- src/i18n/de.ts`, which discarded this story's own uncommitted edits along with the mutation. Caught immediately and re-applied; the remaining six used file copies in the scratchpad instead. Nothing was lost, but `git checkout` is the wrong revert tool for a mutation check on an uncommitted change.

After the review pass (see the Review Triage Log):

- `npx vitest run test/travelSegmentDialog.test.tsx test/i18nDictionaries.test.ts` → `Tests 47 passed (47)`. `travelSegmentDialog.test.tsx` 28 → 30 cases; `i18nDictionaries.test.ts` 13 → 17.
- `npm test` → `Test Files 102 passed (102)` / `Tests 924 passed (924)`.
- Ninth mutation check, on the review's one production fix: reverting `if (isEditing) setRouteHelper(…)` to the unconditional call at `TripDayTravelSegmentDialog.tsx:394` → 2 fail, both of them the cases written for it (`toHaveLength(1)` in the add dialog, and the `getByText` tightened from `getAllByText` in the ship/flight case). Restored from a scratchpad copy and re-verified at 47/47.
- `npx eslint` on the five changed files and `npx tsc --noEmit` re-run after the patches: unchanged — 1 warning, 143 errors, none in a changed file.

### Completion Notes List

1. **AC1, the four strings.** Applied identically in both dictionaries: `openLink` "Open Maps" → "Maps"; `calculateGoogleMapsRoute` and `refreshGoogleMapsRoute` "Plan with Maps" → "Plan"; the save action → "OK"; `googleMapsFallbackHelper` deleted, key and reader. Character counts, en → / de →: `openLink` 9→4 / 9→4, the two route keys 14→4 / 14→4, save 4→2 / 9→2, `googleMapsFallbackHelper` 83→0 / 107→0.

2. **AC1, and the German question Task 1 asked.** `de.ts` held untranslated English for `openLink` and both route keys. Rather than translate them into longer German, all three plus the new save key are the *same word* in both dictionaries — "Maps", "Plan" and "OK" are used unchanged in German, which is what makes them the right answer here rather than a shortcut. Both dictionaries carry a comment saying this is a decision, so the next person to notice `de.ts` holding English words does not "fix" it. A test pins the four key/value pairs to being equal across the two dictionaries, so translating them back is a deliberate act with a failing test attached.

3. **AC1, Task 1's dead-key question: both keys kept, neither is dead.** `calculateGoogleMapsRoute` and `refreshGoogleMapsRoute` are the two arms of the `isEditing` ternary at `TripDayTravelSegmentDialog.tsx:650-652`. Both are reachable — add vs. edit — so the "if one is dead, remove it" branch of Task 1 does not apply. The observation worth recording is the one the spec anticipated: the ternary now renders the same word either way, so it looks collapsible and is not. Two different actions happen to share a word today; collapsing them would make re-splitting them a change in three files instead of two. The ternary is untouched (AC6) and carries a comment saying so. The test suite covers both arms separately — the add case and the edit case each assert "Plan" — because only one key is reachable at a time and a single case would let the other drift.

4. **AC4, each of the four helpers judged.** Standard applied: the sentence telling the user what to do stayed; the sentence explaining the feature went. All four were kept — none was purely explanatory once its context was accounted for — and three were shortened. German lengths, which are the constraint:
   - `googleMapsUnavailableHelper` — **kept, 86 → 45.** The strongest of the four, as the spec predicted: it appears exactly when the "Plan" button is inert, and it names the fix. "Füge beiden Nachbareinträgen einen Ort hinzu." The dropped clause ("um eine Google-Maps-Route zu berechnen") stated the purpose, which the disabled button labelled "Plan" two rows below now carries.
   - `googleMapsManualModeHelper` (Story 6.16's rename of `googleMapsCarOnlyHelper`) — **kept, 161 → 103.** Two sentences. The first names which modes import and which do not; the second says ship and flight are entered manually. Both are load-bearing — the first is Story 6.16's AC5 (see note 5). What went is the third clause, "Google Maps kannst du weiterhin zum Nachschlagen öffnen", which describes the "Maps" button sitting visibly in the same dialog.
   - `googleMapsFallbackActive` — **kept, 117 → 68**, and made *truthful* as well as shorter. It has four call sites (`!response.ok`, `body.error`, a route with a missing duration or distance, and the `catch`), and only one of them is "not available in this build". The old text asserted a cause it usually did not have. Now: "Routenimport fehlgeschlagen. Trage Dauer und Entfernung manuell ein." — accurate at all four sites, and the action is unchanged.
   - `googleMapsPrefillSuccess` — **kept, 125 → 43.** Worth keeping: it is the only confirmation that three form fields changed under the user, which matters most to someone not watching the fields. The dropped half, "Du kannst sie vor dem Speichern weiter bearbeiten", explains that text fields are editable.
   - Not in AC4's list and deliberately untouched: `googleMapsNoRouteForMode` (109 chars, German), which Story 6.16 added after this spec was written. It is actionable and it is the newest considered copy in the file; AC4 enumerates four keys and this is not one of them. Recorded rather than acted on.

5. **Story 6.16 was read first and is not reverted.** 6.16 landed before this story and had already renamed `googleMapsCarOnlyHelper` to `googleMapsManualModeHelper` and added `googleMapsNoRouteForMode` — so the key Task 3 names no longer exists, and the successor was judged in its place. 6.16's AC5 is "stops saying 'nur für Auto-Abschnitte' **and names the modes that do import**". Both halves survive the shortening intact: the surviving text still reads "deckt Auto, zu Fuß und Fahrrad ab". Only the trailing lookup clause was cut. This is now pinned by a test that asserts, in both languages, that the helper contains each of the three importing modes and matches none of `/nur für Auto|car only|car-only/i`; the mutation check that reverts it to a car-only claim fails 4 cases.

6. **AC2, and a false premise in the spec worth flagging.** AC1 and Task 5 both say key parity is enforced by `i18nDictionaries.test.ts`. It was not. That file asserted only that `en` and `de` are objects — 4 lines, 1 case — and nothing else in the repo compares the key sets either: `Dictionary` is `Record<string, string>`, so TypeScript accepts any keys, and `translate()` returns the key itself on a miss, so a key removed from one dictionary renders the literal string `trips.travelSegment.save` on screen rather than failing anything. Since this story removes two keys and adds one, the guard the spec assumed was built: key-set equality, no empty values, plus explicit cases for `common.save` being absent, `googleMapsFallbackHelper` being absent, the four short labels being equal across languages, the surviving German helpers being under their length budget, and 6.16's helper staying truthful. The two single-dictionary mutations (M1, M7) are the ones that would previously have escaped.
   Asserting the deleted helper "renders nowhere" is done against the **literal old strings, in both languages**, not against the key — a `queryByText(t("…googleMapsFallbackHelper"))` would have queried for the key name itself and passed forever. The state asserted is the exact one that used to render it: adding a leg, a routable mode, both neighbours placed. Nothing standing renders there now, which is the visible result of the story.

7. **AC5 and AC6, and what a static pass can and cannot say.** AC6 holds by construction: no field, validation rule, route call, request or save path was touched. The only behavioural edit is that the standing-helper `Typography` is not rendered at all when there is no helper for it, instead of rendering an element around an empty branch. Every one of the 918 tests passes, including all of Story 6.16's route-import cases.
   AC5 cannot be settled here. jsdom computes no layout and evaluates no media query, and this repo has no browser automation (`npm run` offers `dev`, `build`, `start`, `lint`, `test`, plus the migration and audit scripts). What can be said statically: the dialog is `fullWidth maxWidth="sm"`, so at a 390px viewport its paper is about 326px wide and `DialogActions` has roughly 310px of usable row. That row now holds "Maps", "Plan", a `flex: 1` spacer, "Abbrechen" and "OK", with 8px between each — on the order of 330px of buttons, against about 430px before this story. So the change is a large improvement and is plausibly still marginal, and the tightest remaining item is **"Abbrechen"**, which this story does not own: it comes from `common.cancel`, which unlike `common.save` genuinely is shared across dialogs and must not be shortened from inside a travel-segment story. If the row still does not fit, that is the finding — recorded here per Task 4 rather than fixed by restructuring a dialog inside a copy story.

8. **What is owed to the operator (Task 6, AC5).** One browser session, on a **throwaway copy of `dev.db` on an isolated port — never `prisma/dev.db`**; the recipe is in [7-12-bucket-list-sidebar-card.md](7-12-bucket-list-sidebar-card.md)'s Dev Notes. At **390px, in both languages, German first** — German is the constraint and is the language Tommy uses:
   - **The action row.** Open a travel segment on a day where both neighbours have locations. "Maps", "Plan", "Abbrechen" and "OK" must sit on one row, no label wrapping mid-word and no horizontal scrollbar on the dialog or the page. If it wraps, note *which* label wrapped — see note 7: the expected culprit is "Abbrechen", and shortening it is a separate story because `common.cancel` is genuinely shared.
   - **The same row in the edit dialog**, which is the only place `refreshGoogleMapsRoute` renders. It should be identical — both keys now read "Plan" — but the two are separate keys and only the browser shows them in their real widths.
   - **The state that surfaces `googleMapsUnavailableHelper`:** a segment where **neither neighbour has a location**. Expect exactly one line under the form, "Füge beiden Nachbareinträgen einen Ort hinzu.", and the "Plan" button disabled. Confirm the line does not wrap to three.
   - **The state that surfaces `googleMapsPrefillSuccess`:** both neighbours placed, pick Auto (or Zu Fuß), press "Plan", let the import succeed. Expect the info alert "Die Routendaten wurden aus Maps übernommen." and duration and distance filled in.
   - **The state that surfaces `googleMapsManualModeHelper`:** both neighbours placed, switch the mode to Schiff or Flug. Two sentences, and this is the longest surviving helper at 103 characters — the one most likely to cost visible height on a phone.
   - **Confirm the deleted helper is really gone from the screen.** Add a new car segment between two placed items: there should now be **no** standing grey text under the link field at all — the "Öffne die Route in Google Maps und übertrage…" line is the one Tommy asked to remove.
   - **The rest of the form, unchanged but worth a glance while you are there** (Task 4): the duration and distance fields, and the link field, which holds a long Google Maps URL.
   - When the checks pass, tick Task 6 in this spec, set `status: done` in the frontmatter and `Status: done` in the body, and update `6-17-travel-segment-dialog-on-a-phone` in `sprint-status.yaml`.

### File List

- [travelplan/src/i18n/en.ts](../../travelplan/src/i18n/en.ts) — `openLink` → "Maps"; both route keys → "Plan"; `googleMapsFallbackHelper` deleted; `googleMapsUnavailableHelper`, `googleMapsManualModeHelper`, `googleMapsFallbackActive` and `googleMapsPrefillSuccess` shortened; `common.save` deleted and replaced by `trips.travelSegment.save` = "OK", with comments at both sites recording why.
- [travelplan/src/i18n/de.ts](../../travelplan/src/i18n/de.ts) — the same six changes, in German, plus the note that the three action labels are now deliberately the same word in both dictionaries rather than the untranslated English `de.ts` previously held.
- [travelplan/src/components/features/trips/TripDayTravelSegmentDialog.tsx](../../travelplan/src/components/features/trips/TripDayTravelSegmentDialog.tsx) — the standing helper extracted to a `staticRouteHelper` binding that is `null` for the common case, so its `Typography` renders only when there is a helper; the `googleMapsFallbackHelper` branch removed; the save button reads `trips.travelSegment.save`; a comment on the add/edit route-label ternary recording that both keys are reachable and both now say "Plan".
- [travelplan/test/travelSegmentDialog.test.tsx](../../travelplan/test/travelSegmentDialog.test.tsx) — 17 label queries and 7 helper-text assertions updated; 20 → 28 cases in the implementation pass, → 30 after the review, the new ones covering the three short labels in the add and edit dialogs in both languages, the deleted helper rendering nowhere in either language in both states, the two surviving actionable helpers in German, and the manual-mode helper appearing exactly once in the add dialog and still appearing when editing. Review pass also added the `afterEach` stub teardown and removed two self-referential assertions.
- [travelplan/test/i18nDictionaries.test.ts](../../travelplan/test/i18nDictionaries.test.ts) — 1 → 13 cases in the implementation pass, → 17 after the review. The key-set parity check the spec assumed already existed, plus no-empty-values, explicit cases for this story's two removals, the paired short labels, Story 6.16's helper staying truthful, and a per-key length budget covering all five helpers in **both** languages.

### Change Log

- 2026-08-02: Implemented Story 6.17. Four strings shortened ("Maps", "Plan", "OK"), `googleMapsFallbackHelper` deleted key and reader, three surviving helpers shortened and one of them corrected, `common.save` renamed to `trips.travelSegment.save`. No functional change. Tasks 1–5 complete; Task 6, the 390px browser check, is owed to the operator.
- 2026-08-02: Added real key-set parity enforcement to `i18nDictionaries.test.ts`, which the spec assumed existed and which did not. Eight mutation checks, all caught, all reverted, green state re-verified.
- 2026-08-02: Review pass. Six patches — one production fix (the manual-mode helper no longer renders twice in the add dialog) and five test-layer corrections. Six findings deferred as DW-114 … DW-119, four rejected. Suite 918 → 924.

## Review Triage Log

### 2026-08-02 — Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 6: (high 0, medium 1, low 5)
- defer: 6: (high 0, medium 1, low 5)
- reject: 4: (high 0, medium 1, low 3)
- addressed_findings:
  - `[medium]` `[patch]` **The dialog's longest helper rendered twice at once.** In the add dialog with both neighbours placed and the mode set to Schiff or Flug, `staticRouteHelper` already stood under the form with `googleMapsManualModeHelper`, and pressing "Plan" made `handleGoogleMapsRoute` set the *identical* string as an info `Alert` on top of it — roughly four extra wrapped lines at 390px, in the story whose entire purpose is vertical space. The old suite documented it rather than catching it: two cases used `getAllByText(...).length > 0`, and `getAll` is only needed when there is more than one match. Fixed at `TripDayTravelSegmentDialog.tsx:386-395` by setting the Alert only when `isEditing` — the edit dialog renders no standing helper, so there it is still the only explanation — with `isEditing` added to the `useCallback` dependency list. Both `getAllByText` assertions tightened to `getByText`, and two new cases pin the fix in both directions: exactly one copy in the add dialog after pressing "Plan", and the Alert still present when editing a flight leg. Mutation check: reverting the guard fails 2 cases.
  - `[low]` `[patch]` **The 390px length budget skipped the two longest strings and only measured German.** The new budget test pinned `googleMapsUnavailableHelper` (45), `googleMapsPrefillSuccess` (43) and `googleMapsFallbackActive` (68) and left `googleMapsManualModeHelper` (103 de / 93 en) and `googleMapsNoRouteForMode` (108 de / **110 en**) unbounded — so the longest helper in the dialog could have grown to any length with the suite green, while re-adding four words to the shortest failed. The German-only premise is also false for `googleMapsNoRouteForMode`, where English is the longer of the two. Replaced with a five-key `it.each` table applied to **both** dictionaries; the two long keys are budgeted at their current length, so neither can grow. The keys themselves are DW-117.
  - `[low]` `[patch]` **Two assertions compared a local literal to itself.** `expect(manualHelper).toContain("zu Fuß und Fahrrad")` and `.not.toContain("nur für Auto")` were run against a string literal declared 12 lines above, so they held regardless of what the dictionary or the component contained — while their comment claimed they pinned Story 6.16's AC5. Deleted, with a pointer to `i18nDictionaries.test.ts`, which pins that invariant against the dictionary and is the only place it can be asserted meaningfully.
  - `[low]` `[patch]` **The fetch stub leaked out of any test that failed.** Every case in `travelSegmentDialog.test.tsx` ended with `vi.unstubAllGlobals()` as its last statement, which an assertion throw skips — and the file had no `afterEach`. The new `it.each(["en", "de"])` cases made it concrete: a failure in the `en` run left the stub installed for the `de` run, so the first real cause of a red suite would be buried under an unrelated cascade. One `afterEach` added at the describe level; the 21 trailing calls left in place as belt-and-braces.
  - `[low]` `[patch]` **A parameterised case ignored its own parameter.** "renders no standing helper for a routable leg between two placed items" was parameterised over `["en", REMOVED_FALLBACK_HELPER_EN]` / `["de", …_DE]`, then asserted both language constants unconditionally in the body, so the second tuple element was fully subsumed and the two runs were identical. Reduced to the language parameter alone.
  - `[low]` `[patch]` **The parity guard was three assertions where one is stronger.** The two `filter(key => !(key in en))` passes were implied by the `toEqual` that followed them and used `in`, which walks the prototype chain — a key named `toString` would have satisfied them. Reduced to the single `toEqual` on the sorted key lists, whose diff already names the offending keys, and the two absence cases switched to `Object.prototype.hasOwnProperty.call`.

Deferred (`DW-114` … `DW-119` in [deferred-work.md](deferred-work.md)): the standing helper testing `mapsLink` before routability, so ship and flight are told to add locations that cannot help them (`DW-114`); the edit dialog leaving a permanently disabled "Plan" button unexplained (`DW-115`); a zero-length or partial route reported as "Route import failed", same root as `DW-113` but a different surface (`DW-116`, medium); `googleMapsNoRouteForMode` never being judged against AC4's standard (`DW-117`); "Plan" discarding a hand-pasted link before the non-routable early return (`DW-118`); and the external Maps action's two-word accessible name with no new-tab announcement (`DW-119`). The first two were left out deliberately rather than overlooked: both would change which helper appears in a reachable state, and AC6 plus Trap 3 forbid a copy story making that call unannounced.

Rejected: **"the arithmetic says AC5 may still not be met"** — true, and already recorded as Completion Note 7 and as the operator action below; it is a residual risk, not a defect to patch. **"German should read 'Planen', not 'Plan'"** — contradicts AC1 and Tommy's verbatim request. **"'OK' is an outlier against `trips.stay.save` / `trips.plan.saveUpdate`"** — also the verbatim request; the suggested `aria-label="Save travel segment"` mitigation would give the button an accessible name that does not contain its visible label, a WCAG 2.5.3 Label-in-Name failure that is worse than what it replaces (the narrower accessible-name point is `DW-119`). **"add a duplicate-key check and wire `lint` into `npm test`"** — a real gap in the toolchain, not in this diff.

## Auto Run Result

Status: **awaiting-operator** — every part an agent can take is complete and committed; AC5 is a browser measurement and this repo has no browser automation.

**What was implemented.** The travel-segment dialog's copy, shortened so the dialog fits a phone. `openLink` → "Maps", both route keys → "Plan", the save action → "OK", `googleMapsFallbackHelper` deleted key and reader, and the four surviving helpers judged against AC4's standard — all kept, three shortened, one (`googleMapsFallbackActive`) also corrected, since it claimed "not available in this build" at four call sites where only one had that cause. `common.save` was renamed to `trips.travelSegment.save` rather than left as a `common.`-prefixed key whose value is "OK". No field, validation rule, route call or save path changed.

**Files changed**

- [travelplan/src/i18n/en.ts](../../travelplan/src/i18n/en.ts) — six string changes, one key removed, one added, comments recording both decisions.
- [travelplan/src/i18n/de.ts](../../travelplan/src/i18n/de.ts) — the same, in German, plus the note that the three action labels are the same word in both dictionaries by decision.
- [travelplan/src/components/features/trips/TripDayTravelSegmentDialog.tsx](../../travelplan/src/components/features/trips/TripDayTravelSegmentDialog.tsx) — `staticRouteHelper` binding so the helper block renders only when there is a helper; the deleted branch removed; the save button re-keyed; the review's duplicate-Alert guard.
- [travelplan/test/travelSegmentDialog.test.tsx](../../travelplan/test/travelSegmentDialog.test.tsx) — 20 → 30 cases; queries re-pointed at the new labels, the deleted helper pinned absent in both languages, the duplicate-helper regression pinned in both directions, `afterEach` stub teardown.
- [travelplan/test/i18nDictionaries.test.ts](../../travelplan/test/i18nDictionaries.test.ts) — 1 → 17 cases. The key-set parity guard the spec assumed existed and which did not, plus the per-key length budget across both languages.
- [deferred-work.md](deferred-work.md) — `DW-114` … `DW-119`.

**Review findings.** 6 patched (1 medium, 5 low), 6 deferred (1 medium, 5 low), 4 rejected, 0 intent gaps, 0 spec defects.

**Verification.** `npm test` → `Test Files 102 passed (102)` / `Tests 924 passed (924)`, run twice — once after implementation at 918, once after the review patches. `npx eslint` on the five changed files → 1 problem, 0 errors; the single warning is the pre-existing `react-hooks/set-state-in-effect` at `TripDayTravelSegmentDialog.tsx:251` (DW-3), 140 lines from the nearest edit. `npx tsc --noEmit` → 143 errors, the same count Story 6.14 recorded, none in any changed file (DW-95). Nine mutation checks in total, all caught and all reverted with the green state re-verified: eight in the implementation pass, plus the review's guard revert, which failed exactly the two cases written for it.

**Follow-up review recommended:** false. The review pass changed one line of production behaviour — suppressing a duplicated string — under two new tests covering both the add and the edit path, plus five test-layer corrections that add no behaviour. Narrow, localized and mutation-verified.

**Residual risks.**

1. **AC5 is unproven, and the arithmetic is marginal.** ~330px of buttons against ~310px of usable row (Completion Note 7). The change is a large improvement over the ~430px before it and may still not fit on one line. If it wraps, the expected culprit is "Abbrechen" — `common.cancel`, genuinely shared, and out of scope here. That would be a finding for a follow-up story, not licence to restructure this dialog.
2. **`googleMapsFallbackActive` now says "Route import failed"** at a call site where nothing failed — two neighbours pinned at the same coordinates return a legitimate zero-length route. More truthful than the text it replaced at three of four sites, less so at the fourth. Tracked as `DW-116`.
3. **Two reachable helper states were left as they are** on purpose, because fixing them changes behaviour a copy story promised not to change: `DW-114` and `DW-115`.

## Operator Confirmation

Confirmed 2026-08-02: the external actions this story owed were carried out.

- Start the app against a throwaway copy of dev.db on an isolated port — never prisma/dev.db. The recipe is in 7-12-bucket-list-sidebar-card.md's Dev Notes.
- At a 390px viewport, in German, open a travel segment between two items that both have locations. Confirm Maps, Plan, Abbrechen and OK sit on one row, no label wraps mid-word, and neither the dialog nor the page shows a horizontal scrollbar. If the row wraps, record which label wrapped — the expected culprit is Abbrechen, which is common.cancel and out of this story's scope.
- Repeat the same 390px check on the edit dialog of an existing segment: it is the only place refreshGoogleMapsRoute renders, and only a browser shows the two keys at their real widths.
- Repeat both checks at 390px in English.
- Open a segment where neither neighbour has a location. Confirm exactly one line under the form — 'Füge beiden Nachbareinträgen einen Ort hinzu.' — that it does not wrap to three lines, and that the Plan button is disabled.
- With both neighbours placed, choose Auto or Zu Fuß and press Plan. Confirm the alert 'Die Routendaten wurden aus Maps übernommen.' appears once and that duration and distance are filled in.
- With both neighbours placed, switch the mode to Schiff or Flug. Confirm the manual-mode helper appears exactly once — not both as grey text under the form and again as an info alert — and note how many lines it takes at 390px; at 103 characters it is the longest surviving helper.
- Add a new car segment between two placed items and confirm there is now no standing grey text under the link field at all — the removed 'Öffne die Route in Google Maps und übertrage…' line.
- If every check passes, tick Task 6 in this spec, set status: done in the frontmatter and Status: done in the body, and set 6-17-travel-segment-dialog-on-a-phone to done in sprint-status.yaml.

_Appended by the bmad-loop orchestrator (`bmad-loop confirm`, #335): a human confirmed these external actions out of band, and the story was advanced from `awaiting-operator` to `done`._
