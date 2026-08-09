---
title: 'Trip accommodation dialog day-subtitle: shared formatter + invalid-date guard'
type: 'bugfix'
created: '2026-08-09'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
baseline_revision: '0ebcaeddd257f2fc5788b117a42a29132fbfd365'
final_revision: '5000671'
---

<intent-contract>

## Intent

**Problem:** `TripAccommodationDialog.tsx`'s `daySubtitle` builds `` `${dayLabel} · ${date}` `` by hardcoded template literal (violates the project's "interpolate with `formatMessage`, never template-literal concatenation" rule, and bakes the `·` separator/ordering into JS instead of the dictionary) and its inline `Intl.DateTimeFormat(...).format(new Date(day.date))` throws `RangeError` on a malformed `day.date`, white-screening the dialog with no error boundary above it.

**Approach:** Extract `TripTimeline.tsx`'s local `formatShortDate` into a shared module (`src/lib/trips/formatShortDate.ts`, alongside the existing `formatCost.ts` precedent), have it guard the date parse the same way `TripDayPlanDialog.tsx`'s `toDateOnly` guards the same field (return `null` instead of throwing), and use it from both `TripTimeline.tsx` and `TripAccommodationDialog.tsx`. In the dialog, compose the subtitle with `formatMessage` against a new `trips.stay.daySubtitle` key instead of a template literal, and drop the subtitle entirely when the date is invalid.

## Boundaries & Constraints

**Always:**
- Preserve current rendered output for every valid `day.date` in both `TripTimeline.tsx` (day-row date, line ~824) and `TripAccommodationDialog.tsx` (dialog subtitle) — this is a refactor + guard, not a formatting change.
- The shared formatter takes the raw date string and a `Language`, and returns `string | null`; `null` means "could not parse", never a thrown exception.
- New i18n key(s) added to both `src/i18n/en.ts` and `src/i18n/de.ts` (dictionaries are flat `Record<string, string>` keyed alphabetically-ish by feature prefix — insert near the other `trips.stay.*` / `trips.timeline.*` keys).
- Remove the stale doc-comment above `daySubtitle` in `TripAccommodationDialog.tsx` (~line 1603-1608) that says the `Intl` call "is inlined rather than shared because... Story 7.8 owns [TripTimeline.tsx]... extracting it is a follow-up once 7.8 lands" — Story 7.8 is done, so extract now, and let the comment reflect the guard/shared-formatter rationale if a comment is still warranted.

**Block If:** None identified — both ledger entries fold into one mechanical fix with no open design decision.

**Never:**
- Do not change the visible separator, ordering, or date format for either language — this is a plumbing fix, not a copy change.
- Do not add a try/catch around the `Intl.DateTimeFormat` call as the guard; use the same `Number.isNaN(parsed.getTime())` check `toDateOnly` uses, inside the shared formatter.
- Do not touch `formatCost.ts`, `formatDate`/`buildDateRange` in `TripTimeline.tsx`, or any other formatter in that file beyond `formatShortDate`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Valid date, English | `day.date = "2026-08-09"`, `language = "en"` | `formatShortDate` returns `"8/9"`; dialog subtitle renders `"Day 3 · 8/9"` | No error expected |
| Valid date, German | `day.date = "2026-08-09"`, `language = "de"` | `formatShortDate` returns `"9.8."`; dialog subtitle renders `"Tag 3 · 9.8."` | No error expected |
| Malformed date | `day.date = ""` or non-parseable string | `formatShortDate` returns `null`; `daySubtitle` returns `null` and `DialogShell` renders with no subtitle line | No throw, no white screen |

</intent-contract>

## Code Map

- `travelplan/src/lib/trips/formatCost.ts` -- existing precedent for a shared per-trip formatter module; mirror its shape (function taking `Language`, doc-comment style) for the new file.
- `travelplan/src/lib/trips/formatShortDate.ts` (new) -- shared `month/day` formatter extracted from `TripTimeline.tsx:176-184`, with the invalid-date guard.
- `travelplan/src/components/features/trips/TripTimeline.tsx:176-184,824` -- delete local `formatShortDate` useMemo; import the shared one; call site passes `language` explicitly and stays a no-op for valid dates.
- `travelplan/src/components/features/trips/TripAccommodationDialog.tsx:1601-1618` -- `daySubtitle` useMemo: call shared `formatShortDate`, return `null` when it does; else compose via `formatMessage(t("trips.stay.daySubtitle"), { dayLabel, date })`. Remove the stale Story-7.8-blocked doc-comment.
- `travelplan/src/i18n/en.ts:459` / `de.ts:443` (near `trips.timeline.dayLabel`) -- add `"trips.stay.daySubtitle": "{dayLabel} · {date}"` (identical value both languages, matching current hardcoded behavior; the point is that it is now a dictionary entry, not JS).
- `travelplan/test/tripAccommodationDialog.test.tsx` -- add coverage for the subtitle's happy path and the invalid-date drop.

## Tasks & Acceptance

**Execution:**
- [x] `travelplan/src/lib/trips/formatShortDate.ts` -- create `formatShortDate(value: string, language: Language): string | null`, parsing via `new Date(value)`, returning `null` on `Number.isNaN(parsed.getTime())`, else `Intl.DateTimeFormat(language === "de" ? "de-DE" : "en-US", { month: "numeric", day: "numeric", timeZone: "UTC" }).format(parsed)` -- single source of truth for both call sites, guarded like `toDateOnly`.
- [x] `travelplan/src/components/features/trips/TripTimeline.tsx` -- remove the local `formatShortDate` `useMemo` (~176-184); import the shared function; update the call at `:824` to `formatShortDate(day.date, language)` -- removes the duplicate, keeps the render path a no-op for valid dates.
- [x] `travelplan/src/i18n/en.ts` and `travelplan/src/i18n/de.ts` -- add `"trips.stay.daySubtitle": "{dayLabel} · {date}"` next to `trips.timeline.dayLabel` in each file -- gives the composite a real key per Task 7's i18n rule.
- [x] `travelplan/src/components/features/trips/TripAccommodationDialog.tsx` -- rewrite the `daySubtitle` `useMemo` (~1601-1618) to import the shared `formatShortDate`, return `null` when it returns `null`, and otherwise build the string with `formatMessage(t("trips.stay.daySubtitle"), { dayLabel, date })`; delete the now-stale doc-comment about Story 7.8 blocking the extraction -- resolves DW-54 and DW-55 together.
- [x] `travelplan/test/tripAccommodationDialog.test.tsx` -- add a test asserting the dialog subtitle text for a valid `day.date`, and a test asserting no subtitle text (and no thrown error) when `day.date` is malformed -- locks in both fixes.

**Acceptance Criteria:**
- Given a stay dialog opened for a day with a valid `date`, when the dialog renders, then the subtitle reads `"{dayLabel} · {shortDate}"` sourced from `trips.stay.daySubtitle`, in both English and German.
- Given a stay dialog opened for a day whose `date` is empty or unparseable, when the dialog renders, then no subtitle is shown and no exception is thrown.
- Given the trip timeline renders day rows with valid dates, when compared to current behavior, then the rendered short date is unchanged (no regression from the extraction).

## Spec Change Log

## Review Triage Log

### 2026-08-09 — Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 3 (low 3)
- defer: 1 (low 1)
- reject: 6 (low 6)
- addressed_findings:
  - `[low]` `[patch]` `TripTimeline.tsx`'s day-row call site rendered a dangling `"· "` with no date when `formatShortDate` returned `null` for a malformed `day.date` — both reviewers flagged this independently. Fixed by computing `shortDate` once per row and rendering `` `· ${shortDate}` `` only when non-null; added a regression test in `tripTimelinePlan.test.tsx` covering both the valid- and malformed-date rows in the same render.
  - `[low]` `[patch]` The new `formatShortDate.ts` re-hardcoded the `language === "de" ? "de-DE" : "en-US"` ternary instead of reusing the existing `INTL_LOCALES` map (`src/i18n/index.ts`) built for exactly this purpose. Fixed: now reads `INTL_LOCALES[language]`.
  - `[low]` `[patch]` The doc-comment (both in `formatShortDate.ts` and the preserved comment in `TripAccommodationDialog.tsx`) claimed the null-guard "mirrors `toDateOnly`" — inaccurate, since `toDateOnly` falls back to today's date on a bad parse rather than returning `null`; a materially different failure mode. Fixed the wording in both places to say the *parse check* is the same technique while the fallback intentionally differs.
  - `[low]` `[defer]` The `language === "de" ? "de-DE" : "en-US"` locale ternary is still hand-duplicated in `TripsDashboard.tsx`, `TripDayView.tsx`, `TripCostOverview.tsx`, and `TripTimeline.tsx`'s own `formatDate`/`formatCost`, instead of all reading `INTL_LOCALES`. Pre-existing, not caused by this change, and out of this spec's explicit "Never" boundary (do not touch `formatCost.ts`/`formatDate`). Per this run's invocation instructions the deferred-work ledger is not edited directly by this session — flagging here for the orchestrator to record.
  - `[low]` `[reject]` "The i18n key is byte-identical across `en.ts`/`de.ts`, so the indirection buys nothing yet" — this is exactly what the spec's "Always" boundary specifies (preserve current rendered separator/ordering); the point of the key is to stop hardcoding the composition in JS, not to introduce a translation difference that doesn't exist.
  - `[low]` `[reject]` "`TripTimeline.tsx`'s day rows still compose `dayLabel`/date via JSX, not the new `trips.stay.daySubtitle` key" — different structural shape (two separate JSX nodes, one of them colored, not a single interpolated string); never in scope per the ledger entries, which name only the accommodation dialog's sub-line.
  - `[low]` `[reject]` "Malformed-date test coverage only exercises `date: ""`, not `null`/`undefined`" — `day.date` is typed `string`; the spec's own I/O matrix scopes "malformed" to `""` or a non-parseable string, which is what's tested.
  - `[low]` `[reject]` "`daySubtitle`'s `useMemo` deps `[day, language, t]` are harder to eyeball now that two library calls sit inside" — no actual staleness bug; `formatShortDate`/`formatMessage` are pure functions, not state, so the dependency list is complete.
  - `[low]` `[reject]` "No test guards against a typo'd i18n key" — pre-existing gap in the dictionary system generally (no such guard exists anywhere in the codebase today), not introduced by this change.
  - `[low]` `[reject]` "Removing `TripTimeline`'s `useMemo` wrapper means `Intl.DateTimeFormat` is constructed on every render instead of only on `language` change" — flagged by the reviewer itself as low confidence; matches how every other formatter in this codebase (`formatCost.ts`, etc.) is already called, not a regression.

## Design Notes

`formatCost.ts`'s doc-comment records that it isn't yet the *only* copy of its formatter (`TripTimeline.tsx`/`TripDayView.tsx` still duplicate it) and explains why. `formatShortDate.ts` should follow the same convention: state plainly that this one *is* now the single source (both known call sites are migrated in this same change), and name the guard's provenance (`toDateOnly`) so a future reader doesn't wonder why the return type is nullable.

## Verification

**Commands:**
- `cd travelplan && npm run typecheck` -- expected: no new type errors.
- `cd travelplan && npm run lint` -- expected: clean.
- `cd travelplan && npx vitest run test/tripAccommodationDialog.test.tsx test/tripTimelinePlan.test.tsx test/tripTimelineRoles.test.tsx test/tripTimelineSharing.test.tsx test/tripTimelineShareInstanceKey.test.tsx` -- expected: all pass, including new subtitle tests.

## Auto Run Result

Status: done

**Summary:** Resolves DW-54 and DW-55. Extracted the `month`/`day` short-date formatter duplicated in `TripTimeline.tsx` into a new shared `formatShortDate(value, language)` module that returns `null` instead of throwing on an unparseable date. `TripAccommodationDialog.tsx`'s `daySubtitle` now uses it, dropping the subtitle on an invalid date instead of throwing `RangeError`, and composes the subtitle via `formatMessage` against a new `trips.stay.daySubtitle` i18n key instead of a hardcoded template literal.

**Files changed:**
- `travelplan/src/lib/trips/formatShortDate.ts` (new) — shared, null-safe short-date formatter; reads locale from the existing `INTL_LOCALES` map.
- `travelplan/src/components/features/trips/TripTimeline.tsx` — removed the local `formatShortDate` duplicate; day-row call site now drops its `·` separator cleanly when the shared formatter returns `null`.
- `travelplan/src/components/features/trips/TripAccommodationDialog.tsx` — `daySubtitle` rewritten to use the shared formatter and the new i18n key; removed the stale Story-7.8-blocked doc-comment.
- `travelplan/src/i18n/en.ts`, `travelplan/src/i18n/de.ts` — added `trips.stay.daySubtitle` key.
- `travelplan/test/tripAccommodationDialog.test.tsx` — 3 new tests: subtitle composition in English and German, subtitle dropped without throwing on a malformed date.
- `travelplan/test/tripTimelinePlan.test.tsx` — 1 new test: day-row short date renders correctly, and a malformed date drops the date without a dangling separator (review-driven, see below).

**Review findings:** 3 patch (all applied), 1 defer, 6 reject. Both Blind Hunter and Edge Case Hunter independently caught the same real gap — `TripTimeline.tsx`'s call site didn't handle the shared formatter's new `null` case, which would have rendered a dangling `"Day 1 · "` on a malformed date instead of dropping the date cleanly (reachability nil, same as DW-55 itself, but inconsistent with the guard's whole point). Fixed, with a regression test added. Also patched: the new module re-hardcoded a locale ternary that `INTL_LOCALES` already centralizes, and a doc-comment inaccurately claimed the guard "mirrors" `toDateOnly` (which substitutes today's date rather than returning `null` — a different fallback). One item deferred: the same locale ternary is still duplicated in three other files, pre-existing and out of this spec's scope — not written to the ledger directly per this run's invocation instructions (orchestrator to record). Six findings rejected as either spec-mandated behavior, out of scope, or noise (see Review Triage Log for detail).

**Verification:** `npm run typecheck` clean; `npm run lint` clean (0 errors, only pre-existing unrelated warnings); `npx vitest run` across the 5 targeted test files — 100/100 passing, including all 4 new tests.

**Residual risk:** None identified. The one deferred finding (locale-ternary duplication) is pre-existing and cosmetic-scale; `day.date`'s API contract makes the guarded malformed-date path unreachable in practice per DW-55's own original note.
