---
authored_against: dcfb859
---

# Story 6.21: Shorter Labels on the Day Stat Strip

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner on a phone,
I want the four stat cells under the day photo to carry short labels,
so that one long hotel name stops making half the strip tall.

## Acceptance Criteria

1. **Three labels shorten.** `statTravelTime` → "Fahrzeit" / "Travel time"; `statSpendToday` → "Ausgaben" / "Spend"; the check-in cell reads "Check-in" / "Check-in" with no name.
2. **The accommodation name leaves the label entirely.** The cell's label is the same string whether or not a stay exists, so no user-supplied text can set the strip's height.
3. **The existing generic key is what remains.** `trips.dayView.statCheckInGeneric` already holds exactly "Check-in" for the no-stay case. It becomes the only label; a second key with the same value is not introduced.
4. **`statCheckIn` is deleted, not orphaned**, from both dictionaries.
5. **The cell still distinguishes its two states.** Without a stay the value is `trips.timeline.noAccommodation` in the warning colour; with one it is the check-in time or an em dash in ink. That behaviour is unchanged — only the label stops varying.
6. **Nothing else in the strip changes.** `statDay` and its value, the grid, the borders, the cell padding and the label typography are untouched.
7. **No wrapping at 390px.** None of the four labels wraps, and the two grid rows are the height of their content rather than of one long name.

## Tasks / Subtasks

- [ ] **Task 1 — The two straightforward strings** (AC: 1)
  - [ ] `src/i18n/de.ts:245-246` and `en.ts:246-247`:
    - `trips.dayView.statTravelTime`: "Fahrzeit gesamt" → "Fahrzeit"; "Total travel time" → "Travel time"
    - `trips.dayView.statSpendToday`: "Ausgaben heute" → "Ausgaben"; "Spend today" → "Spend"
  - [ ] Both drop a qualifier that carried meaning — "gesamt" said the figure is the sum of every segment, "heute" said it is this day and not the trip. Both remain true from context: the cell sits in a strip of day-level facts directly under the day's photo. This is an accepted loss, recorded here so it is not rediscovered as a defect.

- [ ] **Task 2 — Collapse the check-in label** (AC: 1, 2, 3, 4, 5)
  - [ ] `TripDayView.tsx:2306-2310` renders `statStay ? formatMessage(t("...statCheckIn"), { name: statStay.name }) : t("...statCheckInGeneric")`.
  - [ ] Collapse to `t("trips.dayView.statCheckInGeneric")` unconditionally. This is not a new string — it is the branch that already exists, now taken always.
  - [ ] **Do not delete `statStay`.** The label stops using it, but `checkInStatValue` (`:1901-1905`) and the value's colour (`:2313`) still do. Removing it would take the cell's two states with it.
  - [ ] Delete `trips.dayView.statCheckIn` from both dictionaries once nothing reads it. Grep to confirm; it has one call site today.
  - [ ] Consider whether `statCheckInGeneric` should lose the "Generic" in its name now that there is no specific variant to be generic against. Renaming touches both dictionaries and one call site; either choice is fine, but make it deliberately.

- [ ] **Task 3 — Reconsider the defensive wrap** (AC: 7)
  - [ ] `statLabelSx` (`:1264`) carries `overflowWrap: "anywhere"`. It exists so a long accommodation name breaks rather than overflowing — that is, it exists for the exact string this story removes.
  - [ ] After this story every label is a short fixed word from the dictionary, so nothing can trigger it in either language. Keep it or drop it, and say which and why. Keeping it is defensible as insurance for a future language; dropping it is defensible as removing a workaround whose cause is gone. What is not defensible is leaving it unexamined.

- [ ] **Task 4 — Tests** (AC: 1, 2, 4, 5)
  - [ ] No suite pins any of these three labels today — verified by grep — so this story adds coverage rather than repairing it.
  - [ ] Assert the check-in label is identical with and without an accommodation (AC2). This is the assertion that would have caught the original problem.
  - [ ] Assert the cell's *value* still differs between the two states, in text and in colour intent (AC5) — the label collapsing must not quietly take the distinction with it.
  - [ ] `i18nDictionaries.test.ts` fails if `statCheckIn` leaves one dictionary only.
  - [ ] `npm test` green.

- [ ] **Task 5 — Manual check** (AC: 7)
  - [ ] At 390px the strip is two columns of two (`gridTemplateColumns: { xs: "repeat(2, 1fr)", sm: "repeat(4, 1fr)" }`). Confirm no label wraps and both rows are short.
  - [ ] Open a day whose accommodation has a long name — the case that motivated this — and confirm the strip no longer reacts to it at all.
  - [ ] Check German, which has the longer words.
  - [ ] Throwaway copy of `dev.db` on an isolated port — never `prisma/dev.db`. Recipe in `7-12-bucket-list-sidebar-card.md`'s Dev Notes.

## Dev Notes

### What was asked

Tommy on 2026-08-02: *"Im Dayscreen unter dem Bild sind 4 Felder mit wichtigen Daten. Die Texte sind etwas lang, das macht es auf dem Handy schwieriger. 'Fahrzeit gesamt' => 'Fahrzeit', 'Ausgaben heute' => 'Ausgaben', 'Check-in <Ort>' => 'Check-in' (Also Ort weglassen. Das sorgt am Handy dafür, dass diese Zelle sehr groß werden kann, wenn der Text lang ist)."*

### Why the check-in cell is the real one

The other two are a preference. This one is a layout defect with a mechanism:

The strip is a CSS grid, two columns at `xs`. Row two holds **spend** and **check-in**. Grid rows size to their tallest cell, so a long accommodation name in the check-in label does not make that one cell tall — it makes **both** cells in the row tall, spend included. `statLabelSx` carries `overflowWrap: "anywhere"`, so the name breaks mid-word rather than overflowing, which converts an overflow into vertical growth. That is the behaviour Tommy is describing.

Removing user-supplied text from the label removes the mechanism, not just this instance of it.

### Nothing is lost with the name

The accommodation's name still appears twice on the same screen: as the label of its timeline segment (`:1038`, `label: currentStay.name`) and in the cost breakdown (`:1727`, `budgetItemCurrentNight` → "Aktuelle Nacht: {name}"). The stat label was the third occurrence and the only one that could not control its own width.

### An inconsistency this uncovers, deliberately left alone

`dayTotalCents` is rendered twice on the day screen: in this stat cell, labelled "Ausgaben heute", and in the cost card at `:2783`, titled "Kosten heute" with the subtitle "bisher erfasste Ausgaben, Tag {index}". Same number, two nouns, both with "heute".

Shortening one of them to "Ausgaben" does not create ambiguity — the two were already inconsistent, and the card's own subtitle already says which day it means. Whether the app should say "Ausgaben" or "Kosten" for this figure is a separate question worth a deferred-work entry rather than an unplanned rename inside a copy story.

### Traps

**1. `statStay` outlives its label.** The ternary at `:2307-2309` disappears; the variable it tests does not. It still drives `checkInStatValue` and the value's colour. Deleting it because "the label no longer needs it" removes the cell's distinction between "no accommodation" and "check-in unset".

**2. Two keys, one value.** `statCheckInGeneric` already holds "Check-in". Adding a new key with the same string, or keeping `statCheckIn` around unused, both leave the dictionaries worse than before a story whose whole subject is the dictionaries.

**3. The wrap rule is a leftover.** `overflowWrap: "anywhere"` was insurance against the string being removed here. Task 3 asks for a decision, not a default.

**4. This is a copy story.** If the strip still does not fit at 390px after the labels shorten, that is a finding for a new story, not licence to restructure the grid.

### Testing

Vitest 3.2 + Testing Library, jsdom, via `test/helpers/renderWithProviders.tsx`. `tripDayViewLayout.test.tsx` is the natural home; `i18nDictionaries.test.ts` enforces key parity. Grid heights are browser-only — jsdom computes no layout, so AC7 belongs to the manual pass.

### Project Structure Notes

`src/i18n/de.ts`, `src/i18n/en.ts`, `src/components/features/trips/TripDayView.tsx`, and the affected suites. No route, API or schema change.

### Sequencing

Independent of 6.19 and 6.20. It touches `TripDayView.tsx` like 6.19 does, but a different region — the stat strip at `:2255-2318` rather than the hero — so the two only conflict if both are in flight at once.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 6.21]
- [Source: travelplan/src/components/features/trips/TripDayView.tsx:2255-2318] — the four cells
- [Source: travelplan/src/components/features/trips/TripDayView.tsx:1264] — `statLabelSx` and its wrap rule
- [Source: travelplan/src/i18n/de.ts:245-248] — the three labels
- [Source: travelplan/src/components/features/trips/TripDayView.tsx:1038,1727] — where the stay name still appears

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

### Change Log
