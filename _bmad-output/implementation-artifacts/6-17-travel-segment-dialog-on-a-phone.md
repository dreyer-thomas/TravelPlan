---
authored_against: ac03570
---

# Story 6.17: Travel Segment Dialog on a Phone

Status: ready-for-dev

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

- [ ] **Task 1 — The four strings** (AC: 1, 2)
  - [ ] `src/i18n/de.ts` and `en.ts`:
    - `trips.travelSegment.openLink`: "Open Maps" → "Maps"
    - `trips.travelSegment.calculateGoogleMapsRoute`: "Plan with Maps" → "Plan"
    - `trips.travelSegment.refreshGoogleMapsRoute`: "Plan with Maps" → "Plan"
    - `trips.travelSegment.googleMapsFallbackHelper`: delete
  - [ ] The two "Plan with Maps" keys are separate because one calculates and one refreshes. They now carry the same string — check whether both are still reachable; if one is dead, remove it rather than leaving two keys with one value.
  - [ ] Note the English dictionary already reads "Open Maps" and "Plan with Maps" in the German file — these are untranslated strings sitting in `de.ts`. Shortening them is the moment to decide whether German gets German words. "Maps" and "Plan" work in both, which may be why Tommy chose them.

- [ ] **Task 2 — The save key** (AC: 3)
  - [ ] `common.save` reads "Speichern" and is used in exactly one place: `TripDayTravelSegmentDialog.tsx`. Confirm with a grep before touching it.
  - [ ] Changing the value to "OK" is what was asked. Leaving it under a `common.` prefix is the risk: the next dialog that wants a save button will find `common.save`, use it, and ship an OK button.
  - [ ] Prefer renaming to `trips.travelSegment.save`. If the name stays, put the reason in the dictionary next to it.

- [ ] **Task 3 — The remaining helpers** (AC: 4)
  - [ ] Four survive: `googleMapsUnavailableHelper` ("Füge beiden benachbarten Einträgen Orte hinzu…"), `googleMapsCarOnlyHelper`, `googleMapsFallbackActive`, `googleMapsPrefillSuccess`.
  - [ ] Judge each: does it tell the user something they must act on, or does it explain the feature? The first is worth its lines on a phone; the second is not.
  - [ ] `googleMapsUnavailableHelper` is the strongest candidate to keep — it names the exact reason the button is inert and what to do about it.
  - [ ] `googleMapsCarOnlyHelper` will be rewritten by **Story 6.16** when walking and cycling gain route import. Coordinate: whichever lands second must not undo the other.

- [ ] **Task 4 — Layout at 390px** (AC: 5)
  - [ ] Shorter labels are most of the fix. Check what remains: the action row, the duration and distance fields, the link field.
  - [ ] Do not change field order, add breakpoints or restructure the form. If something still does not fit after the copy change, record it rather than redesigning the dialog inside a copy story.

- [ ] **Task 5 — Tests** (AC: 1, 2, 6)
  - [ ] `travelSegmentDialog.test.tsx` queries by visible text — every renamed label breaks a query. Update them.
  - [ ] `i18nDictionaries.test.ts` will fail if a key leaves one dictionary and not the other.
  - [ ] Assert the removed helper renders nowhere.
  - [ ] `npm test` green.

- [ ] **Task 6 — Manual check** (AC: 5)
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

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

### Change Log
