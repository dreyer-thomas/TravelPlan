---
authored_against: ac03570
---

# Story 6.18: One Way to Enter a Time

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner on a phone,
I want every time field to use the same control I can actually operate,
so that entering a check-in time stops being impossible.

## Acceptance Criteria

1. **Check-in and check-out become native time inputs.** `TripAccommodationDialog`'s two fields use the same `type="time"` control `TripDayPlanDialog` already uses, so a phone offers its own picker. Existing validation, the `DEFAULT_CHECK_IN` / `DEFAULT_CHECK_OUT` defaults and the "assumed time" behaviour are preserved.
2. **One control for every time of day.** After this story a grep for `inputMode: "numeric"` on a time field returns nothing, and any `HH:mm` hint that only existed to explain a free-text field is gone with it.
3. **Duration is modelled as a duration.** The travel segment's duration uses separate hours and minutes, or an explicit minutes field — **not** `type="time"`, which would silently reinterpret "01:30" as half past one. Whatever is chosen is operable on a phone without typing a colon.
4. **Stored format unchanged.** `type="time"` always yields `HH:mm` regardless of display locale, so the stored and validated values are identical. No migration, no data rewrite.
5. **Rules unchanged.** Every validation message, required rule and default still applies. This story changes how a value is entered, not what is accepted.

## Tasks / Subtasks

- [ ] **Task 1 — Fix the broken one first** (AC: 1, 4, 5)
  - [ ] `TripAccommodationDialog.tsx:896-915` renders check-in and check-out as `FormField` with `slotProps={{ htmlInput: { inputMode: "numeric" } }}` and a placeholder of `DEFAULT_CHECK_IN` / `DEFAULT_CHECK_OUT`.
  - [ ] `inputMode="numeric"` asks the OS for a digits-only keypad. On iOS and Android that keypad has **no colon**, so a value of the form `16:00` cannot be typed at all. This is the reported defect.
  - [ ] Convert both to native `type="time"`, matching `TripDayPlanDialog.tsx:1083,1094`.
  - [ ] `FormField` wraps MUI's `TextField` — check it forwards `type` before assuming. If it does not, that is a one-line addition to the primitive, not a reason to bypass it.
  - [ ] `timeRules` (the RHF validation) stays. `type="time"` narrows what can be entered but does not replace validation — an empty value is still possible and still has to be judged.

- [ ] **Task 2 — Audit every other time field** (AC: 2)
  - [ ] Known inventory at the baseline: `TripDayPlanDialog.tsx:1083,1094` native `type="time"` (correct, leave alone); `TripAccommodationDialog.tsx:900,908` the broken pair; `TripDayTravelSegmentDialog.tsx:437` a free-text duration (Task 3).
  - [ ] Re-grep rather than trusting that list — `type="time"`, `inputMode`, `HH:mm`, `hh:mm` across `src/`.
  - [ ] Remove `HH:mm` hints that only existed to explain a free-text field. `trips.plan.fromTimeHelper` and `toTimeHelper` say "(HH:mm)" beside fields that are already native pickers, so the hint describes a format the control no longer asks the user to produce.

- [ ] **Task 3 — The duration is a different problem** (AC: 3)
  - [ ] `TripDayTravelSegmentDialog.tsx:433-440` renders duration as a plain `TextField` with `placeholder="HH:mm"` and the label `trips.travelSegment.durationLabel` ("Dauer (HH:mm)").
  - [ ] A duration is a **span**, not a clock time. `type="time"` would offer a clock and read "01:30" as half past one rather than ninety minutes — it would look like a fix and store the wrong thing.
  - [ ] Choose a control that models a span and is operable without a colon: two numeric fields (hours, minutes), or a single minutes field with a label that says so. Record the choice and why.
  - [ ] The stored value is `durationMinutes` (an `Int` in the schema), so whatever the control, the conversion happens at the form boundary as it does today. AC4 is free here.
  - [ ] Update `durationLabel` — "(HH:mm)" stops being true the moment the control changes.

- [ ] **Task 4 — Tests** (AC: 1, 3, 5)
  - [ ] `tripAccommodationDialog.test.tsx` and `travelSegmentDialog.test.tsx` fill these fields. jsdom implements `type="time"` as a plain input, so existing `fireEvent.change` calls with `"16:00"` keep working — but a query that finds the field by its `HH:mm` placeholder will not.
  - [ ] Assert the accommodation fields carry `type="time"` and no `inputMode`.
  - [ ] Assert the duration control produces the same `durationMinutes` for the same input as before.
  - [ ] `npm test` green.

- [ ] **Task 5 — Manual check** (AC: 1, 3)
  - [ ] This is the point of the story and jsdom cannot show it: on a phone-sized viewport, enter a check-in time and a duration.
  - [ ] `type="time"` renders differently per browser — check Safari and Chrome, since they differ most.
  - [ ] Throwaway copy of `dev.db` on an isolated port — never `prisma/dev.db`. Recipe in `7-12-bucket-list-sidebar-card.md`'s Dev Notes.

## Dev Notes

### Three patterns, one of them unusable

Measured at the baseline:

| Where | Today | On a phone |
|---|---|---|
| `TripDayPlanDialog.tsx:1083,1094` | native `type="time"` | the OS picker — works |
| `TripAccommodationDialog.tsx:900,908` | `FormField` + `inputMode: "numeric"` | **digits-only keypad, no colon — cannot be typed** |
| `TripDayTravelSegmentDialog.tsx:437` | free text, `placeholder="HH:mm"` | ordinary keyboard; it is a **duration** |

The middle row is a genuine defect, not a preference: a user cannot enter their check-in time on a phone. Tommy hit it in production use.

### "Wheels everywhere" does not apply to the duration

Tommy asked for the scroll-wheel control everywhere. For times of day that is exactly right — `type="time"` is what produces it. For the travel segment's duration it would be wrong: the value is a span stored as `durationMinutes`, and a clock picker would make "01:30" ambiguous between "at 1:30" and "for 90 minutes". The control has to say which it means.

That is why AC3 asks for a different shape rather than the same one, and why this is called out here rather than discovered during implementation.

### Traps

**1. `type="time"` does not replace validation.** It constrains the keyboard, not the value — the field can still be empty, and `timeRules` still has to say what that means.

**2. Check `FormField` forwards `type`.** It is Story 7.7's primitive wrapping MUI's `TextField`. If it filters props, adding `type` to it is the fix; reaching around it re-fragments what 7.7 consolidated.

**3. jsdom does not implement the time picker.** It treats `type="time"` as a text input, so tests will pass whether or not the change helps a real phone. AC1 and AC3 need the browser.

**4. Placeholder-based test queries break.** Removing `placeholder="HH:mm"` breaks any `getByPlaceholderText` that relied on it.

### Testing

Vitest 3.2 + Testing Library, jsdom. `tripAccommodationDialog.test.tsx` and `travelSegmentDialog.test.tsx` are the constraints. The behaviour this story exists to fix is browser-only — say in the Dev Agent Record which claims the suite supports and which the browser pass does.

### Project Structure Notes

`src/components/features/trips/TripAccommodationDialog.tsx`, `TripDayTravelSegmentDialog.tsx`, possibly `src/components/forms/FormField.tsx` (prop forwarding), both i18n dictionaries (the `HH:mm` hints and `durationLabel`), and the two suites. No schema, route or format change.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 6.18]
- [Source: travelplan/src/components/features/trips/TripAccommodationDialog.tsx:896-915] — the unusable pair
- [Source: travelplan/src/components/features/trips/TripDayPlanDialog.tsx:1083,1094] — the pattern to copy
- [Source: travelplan/src/components/features/trips/TripDayTravelSegmentDialog.tsx:433-440] — the duration field

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

### Change Log
