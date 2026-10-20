---
authored_against: 9df5656
baseline_commit: 9df5656
---

# Story 7.15: Weekday on Every Day Date

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner,
I want to see the weekday next to each day's date on the trip overview and in the day view,
so that I can tell weekends, market days and closing days apart at a glance without counting along a calendar.

**FRs covered:** none. This is a display refinement of the FR9/FR22 screens built in this epic (7.2, 7.3), not a new capability. Added 2026-10-20 at Tommy's request.

## Acceptance Criteria

The example dates below are **real calendar days**. The epic text used "Montag, 9. August 2026", but 9 Aug 2026 is a **Sunday**. These ACs use the correct weekday, and they use what `Intl` actually prints, which includes the CLDR period after the German short weekday ("So.", not "So"). See Dev Notes → "What `Intl` really prints".

1. **Overview day rows (short).** On the trip overview (`TripTimeline.tsx`), each day row's date line reads `Tag 3 · So., 9.8.` in German and `Day 3 · Sun, 8/9` in English. The weekday is the abbreviated weekday from `Intl.DateTimeFormat` in the UI language (`weekday: "short"`). The line is `labelCaps` (uppercase), so on screen it shows `TAG 3 · SO., 9.8.`. That is expected. The tests check `textContent`, which is not uppercased.
2. **No extra wrap at 390px.** At 390px width the day row's date line does not wrap any more than it does today. If the longer string breaks between the weekday and the date, keep it on one line (for example with a no-break space after the comma, as 7.14 did for "km"). Checked in the real run (Task 6). jsdom does not lay out text, so a test cannot prove this.
3. **Accommodation dialog subtitle (short).** The accommodation dialog's day subtitle (`TripAccommodationDialog.tsx`, `trips.stay.daySubtitle`) uses the **same** short weekday format as the overview rows, through the **one** shared formatter (`formatShortDate`): `Day 1 · Sun, 11/1` / `Tag 1 · So., 1.11.` for `2026-11-01`.
4. **Day-view hero (long).** In the day view (`TripDayView.tsx`), the date under the hero title reads `Sonntag, 9. August 2026` in German and `Sunday, August 9, 2026` in English (`weekday: "long"`, `month: "long"`, `day: "numeric"`, `year: "numeric"`).
5. **Whole-day transfer picker (long).** In the whole-day transfer dialog in the day view, each target day option reads `Tag 5 · Dienstag, 11. August 2026` / `Day 5 · Tuesday, August 11, 2026`. It uses the same long formatter as the hero.
6. **Print sheet (long).** The day print sheet (`TripDayPrintDocument.tsx`) prints `Montag, 10. August 2026` in German and `Monday, August 10, 2026` in English, both in the header and in the footer. 10 Aug 2026 really is a Monday.
7. **UTC calendar day.** Every formatter in this story keeps `timeZone: "UTC"`. A day stored as `2026-08-09T00:00:00.000Z` shows Sunday the 9th even when the process or browser time zone is `America/Los_Angeles`. Without the UTC option it would show `Sa., 8.8.` (checked on Node 24.19).
8. **Malformed date (short).** If `day.date` is malformed, the overview row and the accommodation subtitle drop the short date, weekday included, as they do today. The row keeps `Day 2` with no dangling `·`, the dialog shows no subtitle, and nothing throws.
9. **Malformed date (long).** The shared long formatter returns `null` for a malformed value instead of throwing. Today `Intl…format(new Date(""))` throws a `RangeError` in the hero, the picker and the print sheet. When it returns `null`, the hero leaves out the date line, the picker option shows only `Tag 5` with no `·`, and the print sheet leaves the date empty.
10. **Out of scope, unchanged.** These keep their current format: the trip's start–end range in the overview header (`Dec 1, 2026 - Dec 2, 2026`), the "Handlungsbedarf" gap alert (`… day 2 (Dec 2, 2026).`), the cost overview's per-day dates (`TripCostOverview`), and the *Meine Reisen* dashboard. Their existing tests stay green **unchanged**.
11. **No API, schema or dictionary change.** All dates come from the payload the screens already load. No i18n key is added or changed. `trips.stay.daySubtitle` (`{dayLabel} · {date}`) and `trips.dayView.title` already compose the strings.

## Tasks / Subtasks

- [x] **Task 0: Baseline** (all ACs)
  - [x] In `travelplan/` at `9df5656`, run `npm test`, `npm run typecheck` and `npm run lint` and record the results. The last recorded run (7.14 review) was 219 files / 3527 tests, typecheck clean, lint 0 errors / 80 warnings.
- [x] **Task 1: Short formatter gets the weekday** (AC1, AC3, AC7, AC8)
  - [x] In `src/lib/trips/formatShortDate.ts`, add `weekday: "short"` to the options. Keep `month: "numeric"`, `day: "numeric"`, `timeZone: "UTC"`, the `null` return for an unparseable value, and the name. Both call sites (`TripTimeline.tsx:916`, `TripAccommodationDialog.tsx:1924`) then pick up the change without being edited.
  - [x] Update the docblock: the examples become `"Sun, 8/9"` / `"So., 9.8."`, and it says the weekday is in the same UTC zone as the date.
  - [x] If AC2's real run shows a break after the comma, replace the space in Intl's `", "` literal with U+00A0 (`formatToParts`, or `.replace(", ", ", ")`). Do this only if the run shows the break, and record which one it was. Do not add it pre-emptively without a reason in the Completion Notes.
- [x] **Task 2: Shared long formatter** (AC4, AC5, AC6, AC7, AC9)
  - [x] Create `src/lib/trips/formatLongDate.ts` next to `formatShortDate.ts`, with the same shape: `formatLongDate(value: string, language: Language): string | null`. Use `INTL_LOCALES[language]` and `{ weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }`, and the same `new Date(value)` + `Number.isNaN(getTime())` guard. Mirror `formatShortDate`'s docblock style and explain why it returns `null`.
  - [x] `TripDayView.tsx:909-918`: remove the local `formatDate` `useMemo`. It hardcodes `language === "de" ? "de-DE" : "en-US"`, which is the duplication `INTL_LOCALES` exists to remove. Call `formatLongDate(…, language)` in both places that use it:
    - Hero (`:3937`): render the `<Typography>` only when the result is not `null`.
    - Transfer picker option (`:5095`): show `· {date}` only when the result is not `null`, like the overview row's `shortDate ? \`· ${shortDate}\` : null`.
    - Grep to confirm `formatDate` has no third reader. Today there are exactly 3 occurrences: the definition and 2 uses.
  - [x] `TripDayPrintDocument.tsx:189-198`: replace the inline `Intl.DateTimeFormat` with `formatLongDate(day.date, language) ?? ""`. Update the comment above it, which today says the options "are untouched". It should now say that the weekday was added (Story 7.15) and that `timeZone: "UTC"` still holds. Both readers (`:355` header, `:734` footer) stay as they are.
- [x] **Task 3: Unit tests for the two formatters** (AC1, AC3–AC9)
  - [x] New `test/formatDayDates.test.ts` (or one file per formatter, whichever you prefer). Cover:
    - `2026-08-09T00:00:00.000Z` gives short `Sun, 8/9` / `So., 9.8.` and long `Sunday, August 9, 2026` / `Sonntag, 9. August 2026`;
    - `2026-08-10` long gives `Monday, August 10, 2026` / `Montag, 10. August 2026`;
    - `""` and `"not-a-date"` give `null` from both formatters, with no throw;
    - **TZ guard (AC7):** set `process.env.TZ = "America/Los_Angeles"` in the test (restore it in `afterEach`) and assert that both formatters still give Sunday the 9th. Node re-reads `TZ` at runtime. Check once by hand that the test fails if you remove `timeZone: "UTC"`, so you know it catches the regression. Without the option, the result in LA was `Sa., 8.8.`.
- [x] **Task 4: Re-point the existing pins** (AC1, AC3, AC4, AC6, AC10)
  These assertions pin the old strings and **must** change. The dates and weekdays are verified:
  - [x] `test/tripTimelinePlan.test.tsx:196-197`: `"· 12/1"` becomes `"· Tue, 12/1"` (2026-12-01 is a Tuesday). Keep the malformed-date half (`:198-201`) **unchanged**, because it is AC8.
  - [x] `test/tripAccommodationDialog.test.tsx:1516` `"Day 1 · 11/1"` becomes `"Day 1 · Sun, 11/1"`. `:1535` `"Tag 1 · 1.11."` becomes `"Tag 1 · So., 1.11."`. The malformed case (`:1537+`) stays unchanged.
  - [x] `test/tripDayViewLayout.test.tsx:2208` `"Dec 1, 2026"` becomes `"Tuesday, December 1, 2026"`. `:7383` `"Dec 2, 2026"` becomes `"Wednesday, December 2, 2026"`. Read the 7383 comment: it is about the date being the last line of the title block. That claim still holds, so keep the comment's point.
  - [x] `test/tripDayPrintDocument.test.tsx:788` `"10. August 2026"` becomes `"Montag, 10. August 2026"`, and update the comment at `:785-787` (`August 10, 2026` becomes `Monday, August 10, 2026`). Grep the file for any English `August 10, 2026` text assertion and update it too. None was found at authoring time.
  - [x] **Do not touch:** `test/formPrimitives.test.tsx` (`"Day 3 · 5/12"` is a literal prop, not a formatter output), `test/tripCostOverview.test.tsx` (`Dec 1, 2026` etc., out of scope), `test/tripTimelineRoles.test.tsx:327` (header range), and `test/tripTimelinePlan.test.tsx:1060` (gap alert). If any of these goes red, you changed something out of scope (AC10).
- [x] **Task 5: New component pins** (AC4, AC5, AC9)
  - [x] Transfer picker: no test renders its options today. Add one, for example in `tripDayViewLayout.test.tsx` next to the existing day-transfer coverage, or in whichever file already opens the `trips.dayTransfer.*` dialog (grep `dayTransfer.moveAction`). Open the dialog and assert that an `<option>` reads `Day 2 · Wednesday, December 2, 2026` for a three-day fixture. Use `buildThreeDayResponse` if it fits.
  - [x] Hero malformed: render the day view with `day.date: ""`. The page renders (heading present), there is no `RangeError`, and no date line is shown. If the fixture builder makes this awkward, pin it at the unit level instead (Task 3), and add only a smoke render if it is cheap.
  - [x] German hero: one assertion of `Sonntag, …` or `Dienstag, 1. Dezember 2026` with `language="de"` (`renderWithProviders` / `Providers language="de"`, as the accommodation test does).
- [x] **Task 6: Gates and real run** (AC2, all)
  - [x] `npm test`, `npm run typecheck`, `npm run lint` (0 errors, warnings no higher than 80), `npm run build`.
  - [x] Real run with Tommy, desktop and **390px**: overview rows (AC2: no new wrap in the `labelCaps` line, and look at the longest German weekday "DO., 10.12." in a row with a long note), the hero (long German "Donnerstag, 10. Dezember 2026" under a long title), the transfer picker, the accommodation dialog subtitle, and a print preview. Record what you saw in the Completion Notes.

### Review Findings

- [x] [Review][Patch] Stray whitespace edit outside the story: `const isDayGap =Boolean(…)` lost its space after `=` [travelplan/src/components/features/trips/TripDayView.tsx:3587]
- [x] [Review][Patch] Rewritten `formatShortDate` docblock line runs to ~150 chars, not rewrapped to the block's ~100 [travelplan/src/lib/trips/formatShortDate.ts:16]
- [x] [Review][Patch] Malformed-hero test is weak: `heading.nextElementSibling?.textContent ?? ""` passes when there is no sibling and `/2026|day,/` misses other text; assert on the whole hero instead [travelplan/test/tripDayViewLayout.test.tsx:7290]
- [x] [Review][Patch] Print sheet: no test for AC9's malformed-date fallback (empty, no throw), and the English weekday (`Monday, August 10, 2026`) is never pinned [travelplan/test/tripDayPrintDocument.test.tsx:780]

## Dev Notes

### What `Intl` really prints (checked on Node v24.19.0, 2026-10-20)

| value | locale | short (`weekday:"short"`, `month/day numeric`) | long (`weekday/month long`, `day`, `year`) |
|---|---|---|---|
| 2026-08-09 | de-DE | `So., 9.8.` | `Sonntag, 9. August 2026` |
| 2026-08-09 | en-US | `Sun, 8/9` | `Sunday, August 9, 2026` |
| 2026-11-01 | de-DE / en-US | `So., 1.11.` / `Sun, 11/1` | `Sonntag, 1. November 2026` / `Sunday, November 1, 2026` |
| 2026-12-01 | de-DE / en-US | `Di., 1.12.` / `Tue, 12/1` | `Dienstag, 1. Dezember 2026` / `Tuesday, December 1, 2026` |
| 2026-12-02 | de-DE / en-US | `Mi., 2.12.` / `Wed, 12/2` | `Mittwoch, 2. Dezember 2026` / `Wednesday, December 2, 2026` |

`formatToParts` for de-DE short gives `weekday "So."`, `literal ", "`, `day "9"`, `literal "."`, `month "8"`, `literal "."`. The period after the weekday is CLDR data, not a bug. The epic's ruling ("Mo, 9.8.") was written without it. The ACs say "abbreviated weekday from `Intl`", so this story ships `Intl`'s output. If Tommy wants it without the period, that is a follow-up decision (see Questions). Do **not** strip it on your own.

Browsers ship their own ICU. Chrome, Firefox and Safari all print `So.` for de-DE short, but the tests run on Node's ICU. Pin the exact strings in tests anyway: they are what Node prints, and the repo already pins `Intl` output this way (`10. August 2026`, `1.234,5 km`).

### Current state of the files this story touches

- **`src/lib/trips/formatShortDate.ts`**: one export, `formatShortDate(value, language): string | null`. Options `month/day numeric, timeZone UTC`, locale `INTL_LOCALES[language]`. Its two callers are `TripTimeline.tsx:916` (day row, rendered at `:1003` as `{shortDate ? \`· ${shortDate}\` : null}` inside a `labelCaps` `Typography`) and `TripAccommodationDialog.tsx:1922-1928` (`daySubtitle` `useMemo`, drops the subtitle on `null`). It has no unit test file today. Its coverage comes through those two components.
- **`TripDayView.tsx:909-918`**: `formatDate` `useMemo`, `month: "short", day, year, timeZone UTC`, locale hardcoded via `language === "de"`. No guard: a malformed date throws. Two readers: the hero `:3937` (13px/600 white text under the `display` h5, inside the block that `HERO_TITLE_RIGHT_CLEARANCE` keeps clear of the controls) and the transfer `<option>` `:5095` (native select, `SelectProps={{ native: true }}`). Do not touch the sibling `formatCost` `useMemo` at `:920`.
- **`TripDayPrintDocument.tsx:189-198`**: inline `formattedDate`, `month long, day, year, UTC`, `INTL_LOCALES[language]`. It is rendered in the header (`:355`, 12px #444) and the footer (`:734`). It is computed in the component body, not in a `useMemo`, so keep it simple.

What must keep working: the malformed-date fallbacks of the two short-date sites (they are pinned), the 7.9/13.2 hero layout (plan-conflict block below the date, title clearance), and print readiness (`onReady`). This story touches nothing near the image wait logic.

### Traps

- **UTC (AC7).** This is the epic's named trap. Every date here is a calendar day stored at midnight UTC. Leave out `timeZone: "UTC"` and anyone west of UTC sees the previous day **and** the previous weekday. All three current formatters already set it, so keep it in both shared formatters. Task 3's TZ test is the guard.
- **Wrong weekday in the epic's examples.** 9 Aug 2026 is a Sunday. Never copy `Montag, 9. August 2026` into a test, because it would fail, and "fixing" it by faking the date would be worse. Use the table above.
- **Do not widen the scope.** `TripCostOverview`, the header date range and the gap alert also format dates, and some of them use similar inline `Intl` calls. Tommy ruled them out (AC10). Do not move them onto the new formatters "while you're at it", because their tests would change, and that is how you can tell scope crept.
- **One short formatter.** AC3 requires the overview and the dialog to share one function. Change `formatShortDate` in place. Do not add a `formatShortDateWithWeekday` beside it, because that would leave a second format for the next caller to pick wrongly.
- **`labelCaps` uppercases.** The row will show `TAG 3 · SO., 9.8.`. That is the existing treatment of that line, not something to work around.

### Testing

Vitest with jsdom per file, single fork (`vitest.config.ts`). Component tests use `renderWithProviders` / `<Providers language=…>` and `stubFetch`/`vi.stubGlobal("fetch", …)`. No TZ is set globally in `vitest.config.ts` or `test/setup.ts`, so the TZ test must set and restore `process.env.TZ` itself. Pin exact strings. `getByText` matches the whole text of a node, so the hero assertion must be the full long date.

### Project Structure Notes

- New: `src/lib/trips/formatLongDate.ts`, `test/formatDayDates.test.ts` (or split per formatter).
- Modified: `src/lib/trips/formatShortDate.ts`, `src/components/features/trips/TripDayView.tsx`, `src/components/features/trips/TripDayPrintDocument.tsx`, `test/tripTimelinePlan.test.tsx`, `test/tripAccommodationDialog.test.tsx`, `test/tripDayViewLayout.test.tsx`, `test/tripDayPrintDocument.test.tsx`.
- Unchanged but affected: `TripTimeline.tsx` and `TripAccommodationDialog.tsx` get the weekday through `formatShortDate` with no code change, unless AC2 needs the NBSP.
- No i18n, API, schema or migration change.

### Previous story intelligence (7.14)

- 7.14's real run at 390px found a wrap that no test could see ("5.869,8 / km"). It was fixed with U+00A0, and the German test pinned the raw `textContent` with ` `, because `toHaveTextContent` normalises whitespace. If Task 1's NBSP is needed, pin it the same way.
- `formatShortDate` came out of DW-54/DW-55 (the accommodation subtitle used to throw on a bad date). Keep the `null` contract. Task 2 extends it to the long dates.
- Recent commit style: `7-15: <title> - <summary>; review patches …; status done`.

### Latest tech information

No library changes. `Intl.DateTimeFormat` `weekday` option: `"long" | "short" | "narrow"`. It is stable everywhere the app runs (Node 24, evergreen browsers). No research beyond the ICU check above was needed.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 7.15: Weekday on Every Day Date]
- [Source: travelplan/src/lib/trips/formatShortDate.ts]
- [Source: travelplan/src/components/features/trips/TripDayView.tsx:909, :3937, :5095]
- [Source: travelplan/src/components/features/trips/TripDayPrintDocument.tsx:189-198, :355, :734]
- [Source: travelplan/src/components/features/trips/TripTimeline.tsx:916, :1003]
- [Source: travelplan/src/components/features/trips/TripAccommodationDialog.tsx:1917-1928]
- [Source: travelplan/src/i18n/index.ts:26 INTL_LOCALES]
- [Source: _bmad-output/implementation-artifacts/7-14-planned-distance-on-the-trip-overview.md, Completion Notes (390px NBSP)]

### Tommy's rulings (2026-10-20)

1. Mixed format: short weekday on the overview and in the accommodation dialog, long weekday with the month written out in the day view and on the print sheet.
2. Scope: overview day rows, day-view hero, print sheet, accommodation dialog subtitle, whole-day transfer target picker. The header range, gap alert, cost overview and dashboard are excluded.

### Questions for Tommy (do not block dev)

- German short weekday: `Intl` prints `So., 9.8.` (with a period). The epic example had `Mo, 9.8.`. This story ships the `Intl` form. Is that acceptable, or do you want the period removed?

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (claude-opus-5-5), bmad-dev-story

### Debug Log References

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.
- **Task 0 baseline (9df5656):** 219 files / 3527 tests collected, typecheck clean, lint 0 errors / 80 warnings. The run reported 2 failures in 1 file, but source and test edits for this story landed while it was still running (it took 397s), so those 2 are not a clean baseline signal. The full suite after the change is fully green (below).
- **Task 1:** `formatShortDate` gains `weekday: "short"`. Name, `null` contract, `timeZone: "UTC"` and both callers are unchanged. The docblock now has the new examples and the UTC weekday note. **NBSP not applied:** it depends on AC2's real run, which has not happened yet.
- **Task 2:** new `src/lib/trips/formatLongDate.ts` (`weekday/month long, day, year, UTC`, same `null` guard). `TripDayView`: the local `formatDate` `useMemo` (with its hardcoded `de-DE`/`en-US`) is removed, leaving 0 `formatDate` references. The hero renders the date `Typography` only when `heroDate` is non-null (computed after the early returns, next to `dayTitle`). The picker option shows ` · {date}` only when the date is non-null. `TripDayPrintDocument`: `formattedDate = formatLongDate(day.date, language) ?? ""`, the comment is rewritten, and the now-unused `INTL_LOCALES` import is dropped. Header and footer readers are untouched.
- **Task 3:** `test/formatDayDates.test.ts` has 5 tests: short and long in en/de, 2026-08-10 long, `""`/`"not-a-date"` give null from both, and the LA TZ guard. Checked by hand: deleting `timeZone: "UTC"` from both formatters fails the TZ test with `Received "Sa., 8.8."`. Then restored.
- **Task 4:** re-pointed exactly the four listed pins (`· Tue, 12/1`, `Day 1 · Sun, 11/1`, `Tag 1 · So., 1.11.`, `Tuesday, December 1, 2026`, `Wednesday, December 2, 2026`, `Montag, 10. August 2026`, with the print comment updated). Malformed halves are untouched. The out-of-scope files (`formPrimitives`, `tripCostOverview`, `tripTimelineRoles`, gap alert) needed no edit and stay green (AC10).
- **Task 5:** new `describe("Story 7.15 weekday on the day dates")` in `tripDayViewLayout.test.tsx`: the transfer picker options `Day 2 · Wednesday, December 2, 2026` / `Day 3 · Thursday, December 3, 2026` (three-day fixture), the German hero `Dienstag, 1. Dezember 2026`, and the malformed hero (`date: ""`), which renders the heading with no date line and no throw.
- **Task 6 gates:** `npm test` 220 files / 3535 tests all passing (+1 file, +8 tests), typecheck clean, lint 0 errors / 80 warnings (unchanged), `npm run build` OK. **Open:** the real run with Tommy (desktop + 390px: overview rows, hero, picker, accommodation subtitle, print preview). It decides AC2 and whether the NBSP subtask applies.
- No API, schema or i18n change (AC11).
- **Real run, part 1 (Tommy, 2026-10-20, overview at 390px, NZ trip, German):** the rows read `TAG 1 · MO. 14.12.` and `TAG 2 · DI. 15.12.`. Both are one line with no new wrap, so **AC2 holds and the NBSP subtask is not needed**. 14 Dec 2026 is a Monday, correct. Note: the browser's ICU prints `Mo. 14.12.` (no comma), while Node prints `Mo., 14.12.`, the string the tests pin. Both are `Intl` output. There is no hydration risk because the rows render client-side after the fetch. - **Real run, part 2 (Tommy, 2026-10-20, day view at 390px, Tag 5 of the NZ trip):** the hero shows `Freitag, 18. Dezember 2026` (correct weekday) on one line under a four-line title (`Tag 5: Rundfahrt (Tane Mahuta, Koutu Boulders, Rainbow Falls)`), clear of the ⋯ control. The title clearance from 7.9/13.2 is intact (AC4).
- **Real run, part 3 (Tommy, 2026-10-20, transfer picker, NZ trip):** the native list shows `Tag 15 · Montag, 28. Dezember 2026` … `Tag 41 · Samstag, 23. Januar 2027`. Weekdays checked across the year change (31.12.2026 Thursday, 1.1.2027 Friday, 23.1.2027 Saturday), and the longest option `Tag 18 · Donnerstag, 31. Dezember 2026` fits (AC5).
- **Real run, part 4 (Tommy, 2026-10-20, accommodation dialog at 390px):** the subtitle reads `Tag 4 · Do. 17.12.` (17.12.2026 is a Thursday). It is identical in form to the overview rows, browser ICU without the comma, which confirms the shared short formatter (AC3).
- **Real run, part 5 (Tommy, 2026-10-20, print preview, desktop, Tag 5):** the sheet header reads `Freitag, 18. Dezember 2026` under the title (AC6). The footer, in a second screenshot, also reads `Freitag, 18. Dezember 2026`.
- **Open follow-up (not blocking):** Tommy has not yet ruled on the period after the German short weekday (`MO.` / `Do.`). The story ships `Intl`'s output per the ACs. Removing it would be a follow-up change.

### File List

- travelplan/src/lib/trips/formatShortDate.ts (modified)
- travelplan/src/lib/trips/formatLongDate.ts (new)
- travelplan/src/components/features/trips/TripDayView.tsx (modified)
- travelplan/src/components/features/trips/TripDayPrintDocument.tsx (modified)
- travelplan/test/formatDayDates.test.ts (new)
- travelplan/test/tripTimelinePlan.test.tsx (modified)
- travelplan/test/tripAccommodationDialog.test.tsx (modified)
- travelplan/test/tripDayViewLayout.test.tsx (modified)
- travelplan/test/tripDayPrintDocument.test.tsx (modified)
- _bmad-output/implementation-artifacts/sprint-status.yaml (modified)
- _bmad-output/implementation-artifacts/7-15-weekday-on-every-day-date.md (modified)

### Change Log

- 2026-10-20: Story created (bmad-create-story). The epic's example weekday was corrected (9 Aug 2026 = Sunday) and the German short form was aligned with `Intl` output (`So.`).
- 2026-10-20: Implementation (bmad-dev-story). Weekday added through `formatShortDate` and the new shared `formatLongDate`. Hero, picker and print sheet tolerate a malformed date. Tests re-pointed and added. All automated gates green. Waiting on the real run (AC2) before review.
- 2026-10-20: Code review (bmad-code-review): 4 low patches applied (isDayGap whitespace, formatShortDate docblock rewrap, malformed-hero test asserts on the whole hero, print sheet pins the English weekday and the malformed-date fallback). 15 dismissed, 0 deferred. 220 files / 3537 tests, typecheck clean, lint 0/80. Status done.
- 2026-10-20: Real run done with Tommy (overview, hero, picker and accommodation dialog at 390px, print preview). AC2 holds without an NBSP. Status set to review.
