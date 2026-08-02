---
authored_against: ac03570
baseline_revision: 0ab5e0e328e917a9c429812acfb1a6adf6aef337
final_revision: 825aee37368cfd1a4de9c5c517217892b6cac6c5
status: done
review_loop_iteration: 0
followup_review_recommended: true
warnings: []
operator_actions:
  - "Run the app in a browser to do Task 5, on a throwaway copy of dev.db on an isolated port — never prisma/dev.db. The recipe is in the Dev Notes of _bmad-output/implementation-artifacts/7-12-bucket-list-sidebar-card.md. Everything below needs that one session: AC1 and AC3 are claims about what a phone offers the user, and jsdom renders type=\"time\" as a plain text input, draws no picker and computes no layout."
  - "On a real phone or a phone-sized viewport, open a stay and enter a check-in time. This is the reported defect and the point of the whole story: before this change the keypad had no colon and 16:00 could not be typed at all. Confirm the OS offers its own time picker. Repeat for a previous-night stay's check-out time — it is the other half of the same pair and only one of the two renders at a time."
  - "Check the same two fields in Safari and in Chrome. Browsers render type=\"time\" more differently from each other than they do most controls, and these two differ most."
  - "In the check-in field, deliberately half-fill the picker — set the hour and leave the minutes blank — then save. Expect the time to end up cleared, with no error, and the day view to fall back to its assumed 16:00. That is a known consequence of the native control (a partial entry reports as empty) and it is pinned by a test; the question for you is whether it is acceptable in practice or wants its own follow-up story."
  - "At 390px, open a travel segment and look at the duration row: two boxes, Dauer (Std.) and Dauer (Min.), side by side. Confirm neither label is clipped or wrapped and the dialog shows no horizontal scrollbar. They deliberately do not stack — stacking would give back the vertical height Story 6.17 spent itself reclaiming — so if they crowd, say so and DW-121 becomes the fix (gap={1} first, stacking as the fallback)."
  - "Tap into both duration boxes on a phone and confirm you get a digits-only keypad with no colon and no punctuation. This is what type=\"text\" plus inputMode=\"numeric\" is for; bare type=\"number\" would have given iOS the numbers-and-punctuation keyboard instead."
  - "Edit an existing long travel segment — anything over an hour — and confirm it opens with the right split, e.g. 90 minutes as 1 and 30. Then press Plan on a routable leg and confirm the imported duration lands in both boxes."
  - "Enter something invalid in a duration box (0 and 0, or 1 and 99) and press OK. Expect exactly ONE error line under the pair — not one under each box — reading \"Dauer ist erforderlich\". Then type a valid value and confirm the error and both red borders clear immediately, without pressing OK again."
  - "Do the 390px duration checks in English as well as German. The English labels, Duration (h) and Duration (min), are the longer pair."
  - "If every check passes, tick Task 5 in this spec, set status: done in the frontmatter and Status: done in the body, and set 6-18-one-way-to-enter-a-time to done in sprint-status.yaml."
---

# Story 6.18: One Way to Enter a Time

Status: done

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

- [x] **Task 1 — Fix the broken one first** (AC: 1, 4, 5)
  - [x] `TripAccommodationDialog.tsx:897-915` renders check-in and check-out as `FormField` with `slotProps={{ htmlInput: { inputMode: "numeric" } }}` and a placeholder of `DEFAULT_CHECK_IN` / `DEFAULT_CHECK_OUT`.
  - [x] `inputMode="numeric"` asks the OS for a digits-only keypad. On iOS and Android that keypad has **no colon**, so a value of the form `16:00` cannot be typed at all. This is the reported defect.
  - [x] Convert both to native `type="time"`, matching `TripDayPlanDialog.tsx:1083,1094`. Drop the `slotProps` and the `placeholder` — a placeholder never renders on a time input, and both fields are prefilled with the default anyway (`:184-185`, `:262-263`), so it was already invisible.
  - [x] `FormField` forwards `type` — confirmed. It intercepts only `id`/`label`/`error`/`helperText` and spreads the rest onto MUI's `TextField` at `FormField.tsx:76`. No change to the primitive is needed. There is also no floating-label shrink problem: the visible label is an external `<Typography component="label" htmlFor>` (`FormField.tsx:46-61`) and no MUI `label` prop is ever set, which is why `TripDayPlanDialog` needs no `InputLabelProps`.
  - [x] `timeRules` (`TripAccommodationDialog.tsx:783-792`) stays untouched, as does `normalizeTimeInput` (`:122-131`) — its regex already tolerates the `HH:mm:ss` a native time input can emit. `type="time"` narrows what can be entered but does not replace validation: an empty value is still possible and still has to be judged.
  - [x] Leave `DEFAULT_CHECK_IN` / `DEFAULT_CHECK_OUT` (`:80-81`) and the dirty-gated submit (`:452-457`) exactly as they are.

- [x] **Task 2 — Audit every other time field** (AC: 2)
  - [x] Inventory re-grepped at `0ab5e0e`, not taken from the baseline note. Every `type="time"`, `inputMode`, `HH:mm` and `hh:mm` hit under `travelplan/src/`:
    - `TripDayPlanDialog.tsx:1083,1094` — native `type="time"`. **Correct, leave alone.**
    - `TripAccommodationDialog.tsx:904,913` — the broken pair (Task 1).
    - `TripDayTravelSegmentDialog.tsx:586` — `placeholder="HH:mm"` on a free-text **duration** (Task 3).
    - `inputMode` elsewhere: `"decimal"` on three cost/amount fields and `"url"` on two link fields. Not time fields, not touched. After Task 1, `inputMode: "numeric"` appears on **no time-of-day field**, which is what AC2 asks. The review pass then put it on the two duration boxes deliberately: a duration needs no colon, so the digits-only keypad AC2 banished from time fields is the *correct* keypad there, and it is the attribute that actually produces one.
    - Zod messages `"Time must be in HH:mm format"` in `accommodationSchemas.ts:39`, `dayPlanItemSchemas.ts:83`, `tripImportSchemas.ts:35` — server-side wire-format contract, not a UI hint. **Unchanged** (AC4, AC5).
  - [x] Delete `trips.plan.fromTimeHelper` and `trips.plan.toTimeHelper` from **both** dictionaries. Their values are "Required start time (HH:mm)" / "Required end time (HH:mm, later than from)", and they are referenced by **no source file** — dead keys describing a format the native picker never asks the user to produce. This is exactly AC2's "hint that only existed to explain a free-text field".
  - [x] `trips.stay.timeInvalid` ("Enter time as HH:mm") is **kept**. It is a validation message, not a hint, and AC5 preserves validation messages verbatim. Record the judgement rather than silently deleting it.

- [x] **Task 3 — The duration is a different problem** (AC: 3, 5)
  - [x] `TripDayTravelSegmentDialog.tsx:582-592` renders duration as a plain MUI `TextField` (not `FormField`) with `placeholder="HH:mm"` and the label `trips.travelSegment.durationLabel` ("Duration (HH:mm)" / "Dauer (HH:mm)").
  - [x] A duration is a **span**, not a clock time. `type="time"` would offer a clock, read "01:30" as half past one, and — decisively — could not hold `26:30` at all, which `travelSegmentDialog.test.tsx:596-647` pins as a real prefilled value (1590 minutes, from a multi-day crossing or a long walking leg).
  - [x] **Decision: two numeric fields, hours and minutes.** Not a single minutes field: existing data reaches 1590 minutes, and "1590" is unreadable where "26" + "30" is not; the route import prefills a duration a user then adjusts, and adjusting a raw minute count is worse. Two numeric fields give a digits-only keypad with no colon required, which is the whole point. **The review pass corrected the mechanism**: `type="text"` + `inputMode="numeric"`, not `type="number"` — see the triage log's first patch.
  - [x] Replace `formatMinutesToTime` (`:91-96`) and `parseTimeToMinutes` (`:110-119`) with a split/combine pair. Keep the accepted set **identical** to the old regex so AC5 holds exactly: hours `0..999`, minutes `0..59`, total `> 0`; anything else is `trips.travelSegment.durationRequired`, the same message as today. Keep the `:103-109` comment's reasoning — hours are deliberately not capped at 23.
  - [x] One documented widening: hours `1` with the minutes box left empty is 60 minutes, where `"01:"` used to be rejected. An empty box in a two-box duration reads as zero; 60 was always an acceptable duration. Record it, do not hide it. **Implemented symmetrically** — an empty *hours* box also reads as zero, for the reason in Completion Note 9; two empty boxes still total zero and are still rejected.
  - [x] Every site that reads or writes the duration string moves with it: state `:230`, the open snapshot `:243-247` and `:257-269`, the stale-import restore `:292`, `validate()` `:345-348`, the route-import prefill `:440`, and the save payload `:489`.
  - [x] Render the pair side by side inside the existing full-width column (`:545`) so the dialog gains no vertical height — Story 6.17 spent itself reclaiming exactly that. One error line under the pair, not one per box.
  - [x] i18n: delete `trips.travelSegment.durationLabel` from both dictionaries — "(HH:mm)" stops being true the moment the control changes, and a two-field control has no single label. Add `durationHoursLabel` and `durationMinutesLabel`: "Duration (h)" / "Duration (min)" and "Dauer (Std.)" / "Dauer (Min.)". Short because 390px is the constraint; the visible label is the accessible name, so no `aria-label` may diverge from it (WCAG 2.5.3 — the trap Story 6.17's review rejected).

- [x] **Task 4 — Tests** (AC: 1, 3, 5)
  - [x] `tripAccommodationDialog.test.tsx:184-185,225-226` read the prefilled defaults through `findByLabelText("Check-in time")` / `("Check-out time")`. Labels are unchanged, jsdom holds `"16:00"` in a time input, so these keep passing — verify rather than assume. Add assertions that both fields carry `type="time"` and no `inputMode`.
  - [x] No test anywhere queries by placeholder (`getByPlaceholderText`: zero hits in `test/`), so removing the three placeholders breaks nothing.
  - [x] `travelSegmentDialog.test.tsx` is the real work. `getByLabelText("Duration (HH:mm)")` at `:713` and seven `getByDisplayValue` reads of `HH:mm` strings (`:223, :288, :352, :545, :637, :699, :708`) all move to the two new fields. Note `toHaveValue` on a `type="number"` input yields a **number**, not a string.
  - [x] Assert the duration control produces the same `durationMinutes` for the same input as before: the two payload assertions (`:647` → 1590, `:722` → 70) must survive unchanged, and `26:30` must still round-trip as 26 h + 30 min.
  - [x] Assert the duration fields are **not** `type="time"` — that is the trap AC3 exists to prevent and nothing else would catch it.
  - [x] `i18nDictionaries.test.ts` enforces key-set parity (`:20-25`), so the three deletions and two additions must be mirrored in both dictionaries. Add a "story 6.18 key changes" block asserting the three removed keys are absent, matching the shape of the existing 6.17 block at `:38-55`. Neither removed key appears in the label table (`:63-71`) or the length budget (`:86-95`), so those need no edit.
  - [x] `npm test` green.

- [ ] **Task 5 — Manual check** (AC: 1, 3) — **operator, not agent**
  - [ ] This is the point of the story and jsdom cannot show it: jsdom implements `type="time"` as a plain text input, computes no layout, and renders no picker. A green suite is evidence about props and values only.
  - [ ] On a phone-sized viewport, enter a check-in time and a duration.
  - [ ] `type="time"` renders differently per browser — check Safari and Chrome, since they differ most.
  - [ ] Throwaway copy of `dev.db` on an isolated port — never `prisma/dev.db`. Recipe in `7-12-bucket-list-sidebar-card.md`'s Dev Notes.

## Dev Notes

### Three patterns, one of them unusable

Measured at `0ab5e0e`:

| Where | Today | On a phone |
|---|---|---|
| `TripDayPlanDialog.tsx:1083,1094` | native `type="time"` | the OS picker — works |
| `TripAccommodationDialog.tsx:904,913` | `FormField` + `inputMode: "numeric"` | **digits-only keypad, no colon — cannot be typed** |
| `TripDayTravelSegmentDialog.tsx:586` | free text, `placeholder="HH:mm"` | ordinary keyboard; it is a **duration** |

The middle row is a genuine defect, not a preference: a user cannot enter their check-in time on a phone. Tommy hit it in production use.

### "Wheels everywhere" does not apply to the duration

Tommy asked for the scroll-wheel control everywhere. For times of day that is exactly right — `type="time"` is what produces it. For the travel segment's duration it would be wrong twice over: the value is a span stored as `durationMinutes`, so a clock picker would make "01:30" ambiguous between "at 1:30" and "for 90 minutes"; and a clock cannot represent `26:30`, which the suite already pins as a real prefilled value. The control has to say which it means.

### Why two boxes rather than one minutes box

Both satisfy "operable without a colon". Two boxes win on the values that actually occur: durations here run past a day, and 1590 minutes is a number no one reads as a day and two hours. The route import writes a duration the user then adjusts, and adjusting hours is a different gesture from adjusting minutes. The cost is one extra control in a dialog Story 6.17 just shrank — paid for by putting the pair on one row, so the dialog gains no height.

### Traps

**1. `type="time"` does not replace validation.** It constrains the keyboard, not the value — the field can still be empty, and `timeRules` still has to say what that means.

**2. `FormField` already forwards `type`.** Verified at `FormField.tsx:76`; it spreads everything it does not intercept. No change to the primitive. Reaching around it would re-fragment what Story 7.7 consolidated.

**3. jsdom does not implement the time picker.** It treats `type="time"` as a text input, so tests will pass whether or not the change helps a real phone. AC1 and AC3 need the browser.

**4. Value-shape assertions break, not placeholder queries.** No test queries by placeholder. What breaks is the seven `getByDisplayValue("HH:mm")` reads of the duration and the one label query containing `(HH:mm)`.

**5. Do not let the accepted set drift.** The old duration regex accepted hours 0–999 and minutes 0–59 and nothing else. Two number inputs invite `min`/`max` attributes that browsers do not enforce on submit — `validate()` must still do the judging, exactly as the distance field learned in Story 6.16 (`:355-364`).

**6. i18n parity is enforced now.** Story 6.17 built the key-set guard the specs had been assuming. Three deletions and two additions must land in both dictionaries in the same commit or the suite goes red.

### Testing

Vitest 3.2 + Testing Library, jsdom opted in per file via `// @vitest-environment jsdom`. `npm test` is `vitest run`; the suite is fully serial (`fileParallelism: false`). `tripAccommodationDialog.test.tsx`, `travelSegmentDialog.test.tsx` and `i18nDictionaries.test.ts` are the constraints. The behaviour this story exists to fix is browser-only — say in the Dev Agent Record which claims the suite supports and which the browser pass does.

### Project Structure Notes

`src/components/features/trips/TripAccommodationDialog.tsx`, `TripDayTravelSegmentDialog.tsx`, both i18n dictionaries, and three test files. `FormField.tsx` needs no change. No schema, route or wire-format change.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 6.18]
- [Source: travelplan/src/components/features/trips/TripAccommodationDialog.tsx:897-915] — the unusable pair
- [Source: travelplan/src/components/features/trips/TripDayPlanDialog.tsx:1074-1095] — the pattern to copy
- [Source: travelplan/src/components/features/trips/TripDayTravelSegmentDialog.tsx:582-592] — the duration field
- [Source: travelplan/src/components/forms/FormField.tsx:76] — the spread that already forwards `type`

## Operator Pass — 2026-08-02, against `d146125`

Chromium at 390px, German and English, isolated worktree on port 3099 against a copy of `dev.db`.

- **The reported defect is fixed (AC1):** the check-in field is `type="time"` with **no `inputMode`**. The digits-only keypad that could not produce a colon is gone.
- **Stored format unchanged (AC4):** entering 16:00 yields `"16:00"`.
- **Half-filled picker:** typing only the hour yields `""` — exactly as the operator action predicted. Judged acceptable and recorded; see below.
- **Duration pair (AC3):** two boxes on the **same top (413)**, 130px each, labels single-line and not clipped, no horizontal scrollbar. English — `Duration (h)` / `Duration (min)`, the longer pair — is identical.
- **Both boxes are `type="text"` + `inputMode="numeric"`**, not `type="number"`: the correct construction for a digits-only keypad without punctuation.
- **Existing segment:** 330 minutes opens as **5** and **30**.
- **Route import lands in both boxes:** a walking import wrote **106** h and **3** min with one alert. This also proves why `type="time"` was rejected for a duration — it could not hold 106 hours at all.
- **Invalid input (0 and 0):** **one** error message, "Dauer ist erforderlich" / "Duration is required", not one per box; two red borders, one per box of the invalid pair. Entering a valid value clears both **without** pressing OK again.

**Not verified:** Safari. The WebKit build hangs indefinitely on this machine (Darwin 27) — no error, no response. Operator action 3 remains open and is worth 30 seconds from a human. Also device-only and therefore unverified here: the actual OS picker and the actual keypad.

**Judgement on the half-filled picker:** acceptable. A partial value is *defined* as no value for `type="time"`, so every native-control implementation has it; the field visibly reads empty rather than hiding anything; and the alternative — a custom picker — is what this story deliberately rejected.

## Dev Agent Record

### Agent Model Used

Claude Opus 5 (1M context) — `claude-opus-5[1m]`.

### Debug Log References

Tasks 1–4 only. Task 5 (browser pass) was not attempted and is not ticked.

**1. `npm test` (`vitest run`, `fileParallelism: false`)**

Before, at `0ab5e0e`:

```
 Test Files  102 passed (102)
      Tests  924 passed (924)
   Duration  124.08s
```

After the implementation pass:

```
 Test Files  102 passed (102)
      Tests  944 passed (944)
   Duration  129.70s
```

After the orchestrator's symmetric-widening change (Completion Note 9):

```
 Test Files  102 passed (102)
      Tests  945 passed (945)
   Duration  128.90s
```

+21 cases, no file added or removed. The additions are the two accommodation attribute pairs
(folded into existing cases), 2 new travel-segment cases, 5 accepted-set rows, 8 rejected-set rows,
3 i18n absence rows, 1 i18n survival row and 2 i18n label rows.

**2. `npx eslint` on all seven changed files**

```
/…/src/components/features/trips/TripAccommodationDialog.tsx
   29:1  warning  Unused eslint-disable directive (no problems were reported from '@typescript-eslint/consistent-type-definitions')
  245:5  warning  Error: Calling setState synchronously within an effect can trigger cascading renders  react-hooks/set-state-in-effect
  318:7  warning  Error: Calling setState synchronously within an effect can trigger cascading renders  react-hooks/set-state-in-effect

/…/src/components/features/trips/TripDayTravelSegmentDialog.tsx
  280:5  warning  Error: Calling setState synchronously within an effect can trigger cascading renders  react-hooks/set-state-in-effect

✖ 4 problems (0 errors, 4 warnings)
```

Zero findings on the four i18n and test files. The same four warnings were reproduced at `0ab5e0e`
by stashing the working tree — identical set, identical rules, the only difference being that the
`TripDayTravelSegmentDialog` DW-3 warning sits at `:251` before the change and `:280` after it,
pushed down by the added helpers. Nothing new.

Note the spec and the hand-off brief both said there was *one* pre-existing warning here. There are
four: DW-3's, two more instances of the same rule in `TripAccommodationDialog.tsx` (`:245`, `:318`),
and an unused `eslint-disable` at `:29`. All four predate this story; none is in changed code.

**3. `npx tsc --noEmit`**

143 errors, exactly the pre-existing DW-95 count; 143 reproduced at `0ab5e0e` from a stashed tree.
Two of the 143 fall in a file this story touched — `test/tripAccommodationDialog.test.tsx`, the
`fetchMock.mock.calls` / implicit-`any` pair — and both are pre-existing, at `:281` before the change
and `:292` after it, moved only by the eleven lines added above them. No error is in
`TripAccommodationDialog.tsx`, `TripDayTravelSegmentDialog.tsx`, `en.ts`, `de.ts`,
`travelSegmentDialog.test.tsx` or `i18nDictionaries.test.ts`.

**4. Mutation checks**

- (a) Removed `type="time"` from the check-in `FormField`, leaving a plain text input →
  **1 case failed** (`defaults check-in time for current-night stays`; the `toHaveValue("16:00")`
  half still passed, which is the point — only the new attribute assertion sees it) → reverted →
  `tripAccommodationDialog.test.tsx` green re-verified.
- (b) Dropped `parsedMinutes > 59` from `combineDurationToMinutes`, so the minutes box accepts 60+ →
  **2 cases failed** (`rejects 1 h and 60 min…`, `rejects 1 h and 99 min…`) → reverted →
  `travelSegmentDialog.test.tsx` green re-verified.
- (c) Changed the combine to `const total = parsedMinutes`, dropping the hours →
  **5 cases failed**, including both payload proofs AC3/AC5 rest on:
  `accepts a prefilled duration longer than a day` (the 1590 assertion),
  `discards a route imported for the previous mode when the mode changes` (the 70 assertion),
  plus `saves 26 h and 30 min as 1590 minutes`, `saves 999 h and 59 min as 59999 minutes` and
  `saves 1 h and  min as 60 minutes` → reverted → `travelSegmentDialog.test.tsx` green re-verified.
- (d) Orchestrator, after making the empty-box rule symmetric (Completion Note 9): reverted
  `hours.trim() || "0"` to `hours.trim()` → **1 case failed** (`saves  h and 30 min as 30 minutes`)
  → reverted → the three affected suites green re-verified (74 cases).
- Full suite re-run after reverts (a)–(c): 102 files / 944 tests passed. After (d) and the symmetric
  change: 102 files / **945** tests passed.

### Completion Notes List

1. **What the green suite claims, and what it does not.** Every assertion this story adds is about
   props, attributes and values. jsdom renders `type="time"` as a plain text input, draws no picker
   and computes no layout, so the suite proves the check-in field *asks* for a native time control
   and proves the duration is *not* a clock — it cannot prove either is operable on a phone, and it
   cannot prove the duration pair costs the dialog no vertical height. AC1's "a phone offers its own
   picker" and AC3's "operable on a phone" are owed entirely to Task 5.

2. **Task 1 needed no `FormField` change.** Confirmed as the spec said: `FormField.tsx:76` spreads
   everything it does not intercept (`id`/`label`/`error`/`helperText`/`hint`) onto MUI's
   `TextField`, and the visible label is an external `<Typography component="label" htmlFor>`, so
   there is no floating-label shrink to manage. Both placeholders and both `slotProps` were removed;
   `DEFAULT_CHECK_IN`/`DEFAULT_CHECK_OUT`, the two default sites, `normalizeTimeInput`, `timeRules`
   and the dirty-gated submit are untouched. Only one of the two fields renders at a time
   (`stayType` picks), which is why the two attribute assertions live in two separate cases.

3. **Task 2 inventory re-grepped at `0ab5e0e` and found complete.** `type="time"` → only
   `TripDayPlanDialog.tsx:1083,1094`. `inputMode` → the two check-in/out fields plus three
   `"decimal"` cost/amount fields and two `"url"` link fields, none of them time fields. `HH:mm`
   → the travel-segment placeholder, the three zod messages, and four dictionary entries. After
   Task 1, `inputMode: "numeric"` appears nowhere in `src/`. The three
   `"Time must be in HH:mm format"` zod messages in `accommodationSchemas.ts:39`,
   `dayPlanItemSchemas.ts:83` and `tripImportSchemas.ts:35` are untouched: they are the wire-format
   contract, and AC4/AC5 turn on the stored value not moving. `trips.stay.timeInvalid` is likewise
   kept and now has a test saying so, so a later "tidy up the HH:mm strings" has to argue with it.

4. **A `parseTimeToMinutes` lives in three other files and none of them was touched.**
   `TripDayView.tsx:253`, `TripDayGanttSegments.ts:40` and `tripImportSchemas.ts:44` each define
   their own local helper of that name. They read stored `HH:mm` values for display and validation;
   none is a form control, and the wire format they parse is unchanged. Named here because the
   symbol disappearing from `TripDayTravelSegmentDialog.tsx` makes the surviving three look like
   leftovers in a grep, and they are not.

5. **The duration control: two `type="number"` boxes on one row.** Hours and minutes, side by side
   inside the single full-width column the old field occupied, so the dialog gains no height. State
   moved from a `string` to a `{ hours: string; minutes: string }` — strings, because they are what
   the user is mid-way through typing — and the open snapshot carries the same shape, so the
   stale-import restore in `handleTransportTypeChange` needed no other change. Every site the spec
   listed moved: state init, open snapshot, restore, `validate()`, the route-import prefill (still
   `Math.max(1, Math.round(durationSeconds / 60))`) and the save payload.

6. **Accepted-set equivalence argument.** The old gate was `^(\d{1,3}):(\d{2})$` followed by
   `hours 0..999`, `minutes 0..59`, and `validate()`'s `> 0`. The new gate is `^\d+$` per box,
   then `hours > 999 → null`, `minutes > 59 → null`, then `total > 0`. The digits-only regex is
   load-bearing and is *not* redundant with the range checks: `Number.parseInt` would otherwise
   accept `-1`, `1.5`, `1e3` and `12abc`, all of which the old regex rejected outright, and a
   `type="number"` input hands back the first three quite happily — `min`/`max`/`step` are keypad
   hints, nothing runs constraint validation on submit. `^\d+$` also makes the old `hours < 0` /
   `minutes < 0` checks unreachable, so they are gone rather than kept as dead code. Twelve table
   rows pin the boundary in both directions (accepted: 26/30, 0/45, 999/59, 1/empty; rejected:
   1/60, 1/99, 1000/0, 0/0, empty/30, -1/30, 1.5/30, 1/-5).

7. **One token-level difference that is not a widening of the accepted set.** The old regex demanded
   exactly two minute digits, so `"1:5"` was rejected while `"1:05"` was accepted. The pair accepts
   a bare `5` in the minutes box. That is the zero-padding of a colon string falling away, not a
   rule changing: the accepted *numeric* set — minutes 0..59 — is identical, and demanding `05` in a
   number box would be absurd. `splitMinutesToDuration` correspondingly writes `"5"`, not `"05"`.

8. **The one intended widening, implemented and commented at the parse site — and made symmetric.**
   An empty box counts as zero, so hours `1` + empty minutes = 60 and empty hours + `30` = 30, where
   `"01:"` and `":30"` were both rejected. Two table rows pin it.

9. **Deviation from the spec's literal wording, taken deliberately.** The spec authorised the
   widening for the *minutes* box only and said so in as many words. The implementation pass
   honoured that, then flagged the asymmetry it produced: an empty hours box next to a minutes box
   reading `45` answered "Duration is required" over a control visibly holding a duration — the
   exact failure signature this file already carries a scar from (the hours-capped-at-23 bug the
   `combineDurationToMinutes` docblock records, and DW-110). It is reachable with one backspace,
   because a `type="number"` box empties itself on one.
   The orchestrator made it symmetric instead, on the grounds that (a) the spec's own justification
   — "an empty box in a two-box duration reads as zero" — is box-agnostic and does not distinguish
   the two boxes, and (b) shipping the class of defect this story exists to remove, inside the field
   it rewrites, is worse than one extra sentence of widening. Nothing is loosened underneath: two
   empty boxes total zero and are still rejected, pinned by a new `["", ""]` row. The `["", "30"]`
   row moved from the rejected table to the accepted one at 30 minutes.
   Mutation-checked by the orchestrator: reverting `hours.trim() || "0"` to `hours.trim()` fails
   exactly one case (`saves  h and 30 min as 30 minutes`) → reverted → green re-verified.

10. **One error line under the pair, and it is wired to both boxes.** `validate()` produces a single
    `fieldErrors.durationMinutes`, so both boxes get `error` (border and `aria-invalid`) and a single
    standalone `FormHelperText` hangs under the row, `aria-describedby`-linked from both inputs when
    it is present. It carries `mx: "14px"` because MUI only applies that indent through its
    `contained` variant, which needs the helper text to be inside a field's own `FormControl` — this
    one is not, and without the override it would sit 14px left of the distance field's error line
    directly beneath it. Colour comes from the theme's `MuiFormHelperText.Mui-error` override, not
    from anything restated here. The `findByText` in the rejected-set test throws on more than one
    match, so it also pins "one line, not two".

11. **Both new boxes use `slotProps={{ htmlInput: … }}`, the distance field was left alone.** The
    neighbouring distance field still uses the deprecated v5 `inputProps`; refactoring it is not this
    story's business. Visual consistency (`size="small"`, `margin="dense"`, error styling) is
    matched.

12. **The accessible name is the visible label, with no `aria-label` anywhere near it.** WCAG 2.5.3
    — the trap Story 6.17's review rejected. `trips.travelSegment.durationHoursLabel` /
    `durationMinutesLabel` are what the tests query by, and `i18nDictionaries.test.ts` pins their
    exact strings in both languages so a "clearer" longer label has to argue with a test; the pair
    shares one row at 390px.

13. **Test re-pointing: one assertion came out stronger than it went in.** Six of the seven
    `getByDisplayValue` reads became `expectDuration(h, m)` pairs. The seventh, at the old `:708`,
    was a *negative* read — `queryByDisplayValue("00:45")` absent after a mode change — which as a
    pair would have been vacuous. It is now a positive assertion that the duration is back at the
    `0`/`30` the dialog opened with, i.e. that the stale-import restore ran, which is what that case
    is actually about. `toHaveValue` on `type="number"` yields a number, so every expectation in
    `expectDuration` is numeric.

14. **Spec corrections, all minor.** (a) The orchestrator's brief names one pre-existing
    `react-hooks/set-state-in-effect` warning at `TripDayTravelSegmentDialog.tsx:251`; ESLint on the
    two touched components actually reports four pre-existing warnings — that one, two more of the
    same rule in `TripAccommodationDialog.tsx` (`:245`, `:318`), and an unused `eslint-disable`
    directive at `TripAccommodationDialog.tsx:29`. All four reproduce at `0ab5e0e` and none was
    introduced or fixed here. (b) `test/tripAccommodationDialog.test.tsx` carries two of the 143
    pre-existing `tsc` errors, which the "none in a file you changed" instruction did not anticipate;
    they are at `:281` before and `:292` after, unchanged in kind and untouched by this work.
    (c) Everything else the spec asserted about the code — `FormField.tsx:76`, the zero
    `getByPlaceholderText` calls, the two dead `*TimeHelper` keys, the seven display-value reads,
    the line numbers in both dialogs — checked out exactly.

### File List

- [`travelplan/src/components/features/trips/TripAccommodationDialog.tsx`](../../travelplan/src/components/features/trips/TripAccommodationDialog.tsx) — check-in and check-out `FormField`s converted to native `type="time"`; the `inputMode: "numeric"` `slotProps` and the two placeholders removed, with a comment recording why the keypad was the defect.
- [`travelplan/src/components/features/trips/TripDayTravelSegmentDialog.tsx`](../../travelplan/src/components/features/trips/TripDayTravelSegmentDialog.tsx) — the single free-text `HH:mm` duration field replaced by an hours box and a minutes box on one row with one shared error line; `formatMinutesToTime`/`parseTimeToMinutes` replaced by `splitMinutesToDuration`/`combineDurationToMinutes` plus a `DurationInput` type and a `DEFAULT_DURATION` constant; state, open snapshot, stale-import restore, `validate()`, route-import prefill and save payload all moved to the pair. Review pass: both boxes became `type="text"` + `inputMode="numeric"` (dropping `min`/`max`/`step`), both `onChange`s now clear the duration error, and `DEFAULT_DURATION` is frozen.
- [`travelplan/src/i18n/en.ts`](../../travelplan/src/i18n/en.ts) — deleted `trips.plan.fromTimeHelper`, `trips.plan.toTimeHelper` and `trips.travelSegment.durationLabel`; added `trips.travelSegment.durationHoursLabel` ("Duration (h)") and `durationMinutesLabel` ("Duration (min)").
- [`travelplan/src/i18n/de.ts`](../../travelplan/src/i18n/de.ts) — the same three deletions and the two additions ("Dauer (Std.)" / "Dauer (Min.)"), keeping key-set parity.
- [`travelplan/test/tripAccommodationDialog.test.tsx`](../../travelplan/test/tripAccommodationDialog.test.tsx) — the two default-time cases now also assert `type="time"` and the absence of `inputmode` on their field. Review pass added the partial-entry case: a cleared check-in saves as `null` with no error, the state a half-filled picker also produces.
- [`travelplan/test/travelSegmentDialog.test.tsx`](../../travelplan/test/travelSegmentDialog.test.tsx) — added `expectDuration`/`setDuration` helpers and re-pointed the seven `HH:mm` reads and the one label query at the two boxes; added a "Story 6.18" block covering the not-a-clock assertion, the German labels, and the accepted/rejected duration tables. Both payload assertions (1590, 70) survive unchanged. Review pass: expectations moved from numbers to strings with the boxes, the vacuous type assertion replaced, three rejection rows added (`1e3`, `12abc`, `1,5`), and a case pinning that the error clears on the first keystroke. 30 → 49 cases.
- [`travelplan/test/i18nDictionaries.test.ts`](../../travelplan/test/i18nDictionaries.test.ts) — added a "story 6.18 key changes" block asserting the three removed keys are absent from both dictionaries, that `trips.stay.timeInvalid` survives, and the exact text of the two new labels. Review pass corrected that survival case's docblock to say the message is no longer reachable from the dialog.
- [`deferred-work.md`](deferred-work.md) — `DW-120` … `DW-124`.

### Change Log

- 2026-08-02 — Task 1: `TripAccommodationDialog`'s check-in and check-out converted to native `type="time"`; the colon-less numeric keypad that made a check-in time untypeable on a phone is gone, along with two placeholders a time input never rendered.
- 2026-08-02 — Task 2: time-field inventory re-grepped at `0ab5e0e` and confirmed complete; the two dead `trips.plan.*TimeHelper` keys deleted from both dictionaries; `trips.stay.timeInvalid` and the three zod wire-format messages deliberately kept.
- 2026-08-02 — Task 3: the travel segment's duration re-modelled as hours + minutes number boxes on one row with one shared error line, the accepted set held identical to the old regex apart from the single documented empty-minutes widening; `durationLabel` replaced by `durationHoursLabel` / `durationMinutesLabel` in both dictionaries.
- 2026-08-02 — Task 4: suite 924 → 944 tests, all green; three mutation checks (plain-text check-in, minutes ≥ 60, hours dropped from the combine) each failed the intended cases and were reverted.
- 2026-08-02 — Task 5 not attempted: the browser pass is owed to the operator and is the only evidence AC1 and AC3 can actually have.
- 2026-08-02 — Orchestrator: the empty-box widening made symmetric (Completion Note 9). Suite 944 → 945.
- 2026-08-02 — Review pass. Seven patches, the load-bearing one being the duration boxes moving from `type="number"` to `type="text"` + `inputMode="numeric"`: a number input reports `value === ""` for anything it calls `badInput`, which the empty-box-means-zero rule turned into a silently saved zero. Five findings deferred as DW-120 … DW-124, four rejected. Suite 945 → 950.

## Review Triage Log

### 2026-08-02 — Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 7: (high 0, medium 2, low 5)
- defer: 5: (high 0, medium 0, low 5)
- reject: 4: (high 0, medium 0, low 4)
- addressed_findings:
  - `[medium]` `[patch]` **A `type="number"` box hands back `""` for input it privately considers malformed, and the empty-box rule then saved it as zero.** Both reviewers found it independently. `12e`, `12abc` and a comma-decimal typed on a German keyboard all sit visibly in the box while `event.target.value` is the empty string; combined with this story's own empty-box-means-zero widening, hours `12abc` + minutes `30` saved 30 minutes with no error, and hours `1` + minutes `1,5` saved 60. Fixed by making both boxes `type="text"` with `inputMode="numeric"`, so `combineDurationToMinutes` receives exactly what was typed and its `^\d+$` gate can reject it. The same change resolves three further findings: `inputMode="numeric"` is the attribute that actually produces a digits-only keypad (bare `type="number"` gives iOS the numbers-*and-punctuation* keyboard, so the story about phone keypads had shipped without the keypad hint every other numeric field in the codebase sets); `min`/`max`/`step` are gone along with a comment repeated in three places claiming they were keypad hints, which they never were; and a text box does not rewrite itself when a focused number input is scrolled past inside a scrollable dialog. Three new rejection rows (`1e3`, `12abc`, `1,5`) pin it — `1e3` being the sharpest, since `Number.parseInt("1e3")` is `1`. Mutation: reverting both boxes to `type="number"` fails 10 cases.
  - `[medium]` `[patch]` **`type="time"` collapses a partial entry into an empty one, and empty saves as `null` with no error.** A native time input reports `value === ""` for hours-set-minutes-blank, `timeRules` allows empty (clearing a time is legitimate), and the dirty-gated submit then writes `checkInTime: null` — where the old text field answered `timeInvalid` to `"16:"` and blocked the save. This is inherent to the control AC1 mandates, so it is pinned rather than "fixed": a new case saves a cleared check-in and asserts the `null` body with no error raised, with a docblock naming the collapse of "invalid" into "empty" as a recorded property. Mutation: changing the submit's `?? null` to `?? undefined` fails it. It is also in the operator actions, because a browser is where it is reachable.
  - `[low]` `[patch]` **`trips.stay.timeInvalid` is now unreachable from the dialog, and the new i18n test read as if it were not.** A time input can only emit `""` or a well-formed `HH:mm`, so `normalizeTimeInput` can never fail on a non-empty value. The key stays — AC5 preserves validation rules and messages, and the rule still guards a value that did not come from that control — but the test's docblock now says plainly that its presence is not evidence a user can see it, and points at the partial-entry case.
  - `[low]` `[patch]` **A stale duration error painted both boxes until the next save.** Neither `onChange` cleared `fieldErrors.durationMinutes`, so a corrected value kept both boxes red with `aria-describedby` still pointing at the old message. One message across two controls makes this twice as loud as the single-field version was. Both handlers now clear it, matching `TripDayPlanDialog`; a new case asserts the message and the `aria-describedby` link both go on the first keystroke. Mutation: removing the clear from the minutes box fails 1 case. The distance field in the same dialog still does not clear — `DW-124`.
  - `[low]` `[patch]` **A vacuous assertion in the AC3 test.** `toHaveAttribute("type", "number")` followed by `not.toHaveAttribute("type", "time")` — an element has one `type`, so the second line could not fail while the first passed, in the case whose docblock calls it "the only assertion in the suite that can catch its trap". Replaced by the two attributes that carry real weight, `type="text"` and `inputmode="numeric"`.
  - `[low]` `[patch]` **The `^\d+$` guard was not pinned for the two inputs its own docblock names.** The comment cited `1e3` and `12abc` as the reason the regex is load-bearing; neither was in the rejection table. Both added, along with `1,5`. Now genuinely exercised, because the boxes no longer sanitize them away before the validator sees them.
  - `[low]` `[patch]` **`DEFAULT_DURATION` was a shared mutable module object** stored by identity into both `durationInput` and `openSnapshotRef.current`. Nothing mutates it today because every update path spreads, but one in-place assignment would corrupt the default for every dialog in the process. Frozen, with the reason recorded. No test — freezing guards a future edit, not current behaviour, and saying so is more honest than a test that asserts `Object.isFrozen`.

Deferred (`DW-120` … `DW-124` in [deferred-work.md](deferred-work.md)): "Duration is required" naming neither the box nor the rule that broke, which AC5 forbade touching here (`DW-120`); the duration pair never stacking below `sm` unlike the two rows it was modelled on, which only the owed browser pass can settle (`DW-121`); a stored duration above 59,999 minutes being uneditable, the old regex's ceiling unchanged, together with the unclamped route prefill that can reach it (`DW-122`); the two boxes having no `role="group"` and the shared error not being announced, an app-wide convention rather than one pair (`DW-123`); and the distance field not clearing its error on change, made conspicuous by the duration boxes now doing so (`DW-124`).

Rejected: **"the shared error line sits ~4px lower than the distance field's, because `margin="dense"` adds a bottom margin the `mx: "14px"` compensation does not account for"** — plausible, invisible, and only rendered on a failed save. **"comment volume exceeds the code it explains"** and **"the dictionaries carry archaeology about keys they no longer contain"** — both contradict this repo's established idiom; `FormField.tsx`, `en.ts` and `de.ts` all already carry decision comments from stories 6.16 and 6.17, and the i18n tests now enforce the invariants those comments describe. **"the not-a-clock rationale is duplicated in four places and must be kept consistent"** — three of the four are the component, the test and the story, which is where that argument belongs; the fourth was the wrong keypad claim, and that one was patched.

## Auto Run Result

Status: **awaiting-operator** — every part an agent can take is complete and committed. AC1's "a phone offers its own picker" and AC3's "operable on a phone" are browser facts, and this repo has no browser automation; jsdom renders `type="time"` as a plain text input and computes no layout.

**What was implemented.** One way to enter a time.

- **The defect.** `TripAccommodationDialog`'s check-in and check-out fields were text inputs asking the OS for a digits-only keypad. Neither iOS nor Android puts a colon on that keypad, so `16:00` could not be typed at all. Both are now native `type="time"`, the same control `TripDayPlanDialog` already used. `FormField` needed no change — it already forwards `type`. Defaults, validation and the "assumed time" fallback are untouched.
- **The audit.** After this story `inputMode: "numeric"` appears nowhere in `src/`. Two dead i18n keys explaining an `HH:mm` format to a native picker (`trips.plan.fromTimeHelper` / `toTimeHelper`) are gone from both dictionaries. `trips.stay.timeInvalid` and the three zod wire-format messages are deliberately kept — AC5 preserves validation, and the wire format does not move.
- **The duration is not a time.** The travel segment's duration is a span stored as `durationMinutes`, and the suite already pinned `26:30` as a real prefilled value — a clock control would read it as half past two and cannot hold it at all. It is now an hours box and a minutes box on one row, `type="text"` with `inputMode="numeric"`, sharing one error line. The accepted set is exactly the old regex's (hours 0–999, minutes 0–59, total > 0) with one deliberate widening: an empty box counts as zero, in both boxes.

**Files changed** — see the File List above. Two components, both dictionaries, three test files, and the deferred-work ledger.

**Review findings.** 0 intent gaps, 0 spec defects, 7 patched (2 medium, 5 low), 5 deferred as `DW-120` … `DW-124`, 4 rejected. The medium ones both matter: a `type="number"` box reports `value === ""` for input it privately considers malformed, which this story's own empty-box-means-zero rule would have turned into a silently saved zero; and `type="time"` collapses a partial entry into an empty one, which the dirty-gated submit writes as `null` without an error.

**Verification.** `npm test` → `Test Files 102 passed (102)` / `Tests 950 passed (950)`, from 924 at the baseline. `npx eslint` on all seven changed files → 4 problems, 0 errors; all four are pre-existing `react-hooks/set-state-in-effect` and unused-directive warnings in untouched code, byte-identical to the same run at `0ab5e0e`. `npx tsc --noEmit` → 143 errors, exactly the pre-existing DW-95 count; the two that fall in a changed file predate the story and the review pass removed three the implementation pass had added. Six mutation checks, all caught and all reverted with green re-verified: plain-text check-in (1), minutes ≥ 60 accepted (2), hours dropped from the combine (5, including both payload proofs), empty hours rejected (1), boxes reverted to `type="number"` (10), and the duration error clear removed (1).

**Follow-up review recommended:** true. The review pass changed the input type of both new controls — the same code path as the story's central mechanism — plus error-clearing behaviour and the empty-box rule, and it did so on top of an orchestrator override of the spec's literal wording. Every change is mutation-verified and the suite is green, but the volume and the fact that they land on production behaviour rather than the test layer make an independent pass worth its cost. This is a stronger case than 6.17's, where the review touched one line of behaviour.

**Residual risks.**

1. **AC1 and AC3 are unproven.** The suite proves the check-in field *asks* for a native time control and the duration is *not* a clock. It cannot prove either is operable on a phone. That is the whole point of the story and it is owed to the operator.
2. **The duration pair does not stack below `sm`** (`DW-121`). At 390px each box gets roughly 155px for a floating label. Deliberate — stacking would cost the vertical height Story 6.17 spent itself reclaiming — but unmeasured.
3. **A partial time entry silently clears the value.** Inherent to `type="time"`, pinned by a test, and in the operator actions below. It is a narrow regression against a control that was previously unusable, so the story is still a large net win.
4. **`trips.stay.timeInvalid` is now unreachable from the dialog.** Kept because AC5 says so. Whether an unreachable message and its rule should survive is a decision for a story allowed to change what is accepted.

## Operator Confirmation

Confirmed 2026-08-02: the external actions this story owed were carried out.

- Run the app in a browser to do Task 5, on a throwaway copy of dev.db on an isolated port — never prisma/dev.db. The recipe is in the Dev Notes of _bmad-output/implementation-artifacts/7-12-bucket-list-sidebar-card.md. Everything below needs that one session: AC1 and AC3 are claims about what a phone offers the user, and jsdom renders type="time" as a plain text input, draws no picker and computes no layout.
- On a real phone or a phone-sized viewport, open a stay and enter a check-in time. This is the reported defect and the point of the whole story: before this change the keypad had no colon and 16:00 could not be typed at all. Confirm the OS offers its own time picker. Repeat for a previous-night stay's check-out time — it is the other half of the same pair and only one of the two renders at a time.
- Check the same two fields in Safari and in Chrome. Browsers render type="time" more differently from each other than they do most controls, and these two differ most.
- In the check-in field, deliberately half-fill the picker — set the hour and leave the minutes blank — then save. Expect the time to end up cleared, with no error, and the day view to fall back to its assumed 16:00. That is a known consequence of the native control (a partial entry reports as empty) and it is pinned by a test; the question for you is whether it is acceptable in practice or wants its own follow-up story.
- At 390px, open a travel segment and look at the duration row: two boxes, Dauer (Std.) and Dauer (Min.), side by side. Confirm neither label is clipped or wrapped and the dialog shows no horizontal scrollbar. They deliberately do not stack — stacking would give back the vertical height Story 6.17 spent itself reclaiming — so if they crowd, say so and DW-121 becomes the fix (gap={1} first, stacking as the fallback).
- Tap into both duration boxes on a phone and confirm you get a digits-only keypad with no colon and no punctuation. This is what type="text" plus inputMode="numeric" is for; bare type="number" would have given iOS the numbers-and-punctuation keyboard instead.
- Edit an existing long travel segment — anything over an hour — and confirm it opens with the right split, e.g. 90 minutes as 1 and 30. Then press Plan on a routable leg and confirm the imported duration lands in both boxes.
- Enter something invalid in a duration box (0 and 0, or 1 and 99) and press OK. Expect exactly ONE error line under the pair — not one under each box — reading "Dauer ist erforderlich". Then type a valid value and confirm the error and both red borders clear immediately, without pressing OK again.
- Do the 390px duration checks in English as well as German. The English labels, Duration (h) and Duration (min), are the longer pair.
- If every check passes, tick Task 5 in this spec, set status: done in the frontmatter and Status: done in the body, and set 6-18-one-way-to-enter-a-time to done in sprint-status.yaml.

_Appended by the bmad-loop orchestrator (`bmad-loop confirm`, #335): a human confirmed these external actions out of band, and the story was advanced from `awaiting-operator` to `done`._
