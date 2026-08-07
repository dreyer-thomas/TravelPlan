---
authored_against: b57d3d2
baseline_commit: b57d3d261eace0af083d0aa6921ce63c5967ae76
---

# Story 6.30: One Decimal for a Distance, a Comma in the Box

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Where this came from

Story 6.27's operator pass, run on a real German phone on 2026-08-07. The fix itself held — every one of the five fields took a comma and stored the value it displayed, read back out of the database rather than off the screen. Two things surfaced during that pass that 6.27 could not close: one it had explicitly deferred for a human ruling, one nobody had noticed until a person sat in front of it.

Both are small. Both live in the two files 6.27 already touched. Neither is a defect in what 6.27 shipped.

## Part 1 — a distance gets one decimal

**Ruled by Tommy on 2026-08-07**, closing the question 6.27 parked as operator action 9.

The evidence was measured against the parser rather than argued:

```
parseDecimal("1,000")  → 1        ← "one thousand kilometres" typed the German way
parseDecimal("1.000")  → 1        ← and typed the English way
parseDecimal("1.234,50") → 1234.5 ← two separators: correctly understood
parseDecimal("60,12345") → 60.12345
```

A **lone** three-digit group is read as a fraction in *both* spellings. So "1000 km" silently becomes 1 km whichever way a user writes it — a factor of 1000, with no warning, in a story whose whole subject is silent numeric loss. Two separators are handled correctly, which is why this is narrow rather than systemic.

Capping at one decimal makes all three ambiguous forms refusable and turns the silent error into a visible question. Tommy's reasoning: *"wir sind 12000 km von zu Hause weg, da messe ich keine Meter einzeln mehr."* 100 m resolution is beyond anything trip planning uses.

**This amends the intent contract.** 6.27's spec currently requires `12,555` to parse as a distance — the row is in its I/O matrix and is marked done. That expectation is deliberately reversed here. It is a spec amendment, recorded as one, not smuggled in as a dev detail.

## Part 2 — the amount in the box speaks the account's language

Raised during the same pass. Under German the placeholder renders `0,00` while the value beside it renders `120.50`. The field says one thing and its own hint says another.

It is deliberate and documented:

```ts
/** … it stays dot-decimal because that is what an unedited round-trip must hand
 *  back to `parseAmountToCents`. `formatCost` is for reading, this is for editing. */
export const formatCentsAsAmount = (value: number) => (value / 100).toFixed(2);
```

The reason was sound when it was written and is weaker now — **because of 6.27**. It binds only if the parser is dot-only, and since 6.27 `parseAmountToCents` takes both. `120,50` round-trips exactly as well as `120.50`.

No data is at risk; this is cosmetic. But it is a cosmetic inconsistency in the one story that exists because German number entry was broken, and it was the first thing a German user noticed after the fix landed.

## Story

As someone entering numbers in German,
I want a distance to refuse precision it cannot mean, and an amount to be shown the way I would write it,
so that the fields finish the job Story 6.27 started.

## Acceptance Criteria

1. **AC1** — A distance with more than one decimal is refused with a visible, blocking error. `1,000`, `1.000`, `12,555` and `60,12345` are all refused; `60,5`, `60.5`, `1234,5` and `12000` are all accepted.
2. **AC2** — The refusal names the rule. The distance helper and error strings state that at most one decimal is accepted, in both dictionaries.
3. **AC3** — The general decimal parser stays general. The one-decimal rule is a distance rule, expressed so that a future non-distance caller is not silently bound by it.
4. **AC4** — An existing stored distance with more decimals (this scratch pass produced `60.12345`) still **displays and saves** unchanged if untouched. The cap governs input, not stored history.
5. **AC5** — Under German, an existing amount renders in the edit field with a comma (`120,50`); under English with a period (`120.50`). Placeholder, helper and value agree.
6. **AC6** — Whatever the formatter emits, `parseAmountToCents` re-parses to the identical cent value. An open-and-save with no edit changes nothing, in both languages.
7. **AC7** — Opening a dialog, switching account language, and closing it does not report unsaved changes that the user did not make.
8. **AC8** — Story 6.27's operator instruction 6 is corrected in its spec: typing `abc` into a cost field is not performable on a phone, because `inputMode="decimal"` yields a keypad with no letters. Paste is the reachable mobile path; the desktop is the simpler one.

## Tasks / Subtasks

- [ ] `src/lib/trips/parseAmount.ts` — give `parseDecimal` (`:92`) an explicit maximum-decimals option rather than hard-coding one decimal into it. Its regex is `/^\d+(\.\d+)?$/`, unbounded by design, and its docblock explains that a distance keeps whatever precision was typed — that reasoning stays true for the helper; only the distance caller changes. Today the sole consumer is the travel-segment dialog, so a bare cap would look harmless and would quietly bind the next caller — AC1, AC3
- [ ] `src/components/features/trips/TripDayTravelSegmentDialog.tsx` — apply the cap at the three `parseDecimal` sites: `validate()` at `:407` and `:417`, and the request body at `:536`. All three must agree, or the form accepts what the request then drops — AC1
- [ ] `src/i18n/en.ts`, `src/i18n/de.ts` — extend `trips.travelSegment.distancePositive` and `distanceInvalid` to name the one-decimal rule. Both already carry examples (`z. B. 12,5 oder 12.5`) which remain correct — AC2
- [ ] `src/lib/trips/parseAmount.ts` — `formatCentsAsAmount` (`:111`) takes the account language, mirroring `formatCost(cents, language)` in `formatCost.ts:16`, which is its read-side twin and already does exactly this. **Decimal separator only — no thousands separator.** An edit field with grouping invites the ambiguity Part 1 is closing; `parseAmountToCents` handles grouped input, but nothing should *emit* it — AC5, AC6
- [ ] `src/components/features/trips/TripAccommodationDialog.tsx` (5 call sites) and `TripDayPlanDialog.tsx` (4) — pass the language through. `useI18n()` is already in scope in both — AC5
- [ ] Both dialogs — check the unsaved-changes guard. Each folds the form values into a dirty model; a formatter whose output depends on language means a language switch rewrites a field the user never touched. Verify against the guard's actual comparison rather than assuming — AC7
- [ ] `_bmad-output/implementation-artifacts/spec-6-27-a-comma-is-a-decimal-point.md` — correct operator instruction 6. A documentation fix, no code — AC8
- [ ] `test/` — the parser table: the four refusals and the four acceptances from AC1, plus the round-trip property from AC6 in both languages. This is a pure function, so the table is where the rules become explicit — AC1, AC6
- [ ] `test/` — the dialog cases: a distance with two decimals shows the error and blocks the save; an amount renders with a comma under German and a period under English; open-switch-close reports nothing dirty — AC1, AC5, AC7
- [ ] `test/` — AC4's negative: a segment already holding `60.12345` renders and re-saves unchanged when the distance field is not edited

## Dev Notes

### The cap is a caller's rule, not the parser's

`parseDecimal`'s docblock states its own contract: *"Whatever precision was typed survives"*, and explains that it is deliberately **not** `parseAmountToCents`, which caps at two decimals and multiplies by 100. That distinction is load-bearing — it is why the distance field does not round or scale.

So do not edit the regex to `\.\d{1}`. The rule belongs to the distance field. An option with an explicit default keeps the helper honest and makes the next caller state its own intent. The travel-segment dialog is the only consumer today, which is exactly what makes a silent hard-coding easy and wrong.

### Three call sites, not one

`TripDayTravelSegmentDialog.tsx` parses the distance three times: twice in `validate()` (`:407` for the car-required branch, `:417` for the optional branch) and once when building the request body (`:536`). Story 6.27 already had to touch all three. If the cap lands in `validate()` only, the form refuses and the request body would still accept a pasted value on a path that skips validation — and if it lands in the body only, the user gets no error at all.

### Round-trip is the property that matters for Part 2

AC6 is the one that keeps Part 2 from becoming a data bug. The chain must close:

```
cents → formatCentsAsAmount(cents, language) → parseAmountToCents(…) → the same cents
```

Verified for the German output already: `parseAmountToCents("120,50")` returns `12050`. Assert it as a property over a range of values in both languages rather than spot-checking two.

The reason for **no thousands separator** is the same one Part 1 exists for: `parseAmountToCents("1.234,50")` does return `123450`, so emitting a grouped form would work — but a field that shows `1.234,50` invites a user to type `1.000` into the field next to it. Keep the edit representation minimal; `formatCost` is where grouping belongs, and it is already used for every read-only display.

### The dirty guard is the trap

Both dialogs compare current values against the values captured when the dialog opened. `TripAccommodationDialog` uses a value comparison; `TripDayPlanDialog` uses a fingerprint. If `costCents` is seeded through a language-dependent formatter, then changing the account language while a dialog is open rewrites that field's string without the user touching it, and the guard may report unsaved changes on close.

This is AC7. It may already be a non-issue — the language cannot usually change mid-dialog — but "usually" is not a test. Read the guard, decide, and record which it was.

### What must not regress

- **Story 6.27's five fields.** The whole comma path is freshly verified against the database; nothing here may narrow it. `120,50` → `12050`, `60,50`/`60,00` → `6050`/`6000`, `2,50` → `250`, `60,5` → `60.5`.
- **The two-decimal money cap.** `parseAmountToCents` refuses three decimals and that is correct. Part 1 changes the *distance* rule only.
- **`formatCost`.** The read-side formatter already localises and is used across the overview, day view and cost pages. It is the model here, not a file to change.

### Traps

1. **Capping inside `parseDecimal`.** Works today, because there is one caller. Binds every future caller silently, and contradicts the helper's own documented contract.
2. **Capping in one of the three parse sites.** Produces either a form that refuses what the request would have accepted, or a request that drops what the form accepted.
3. **Emitting a thousands separator from the edit formatter.** Round-trips fine, teaches the user the exact habit Part 1 refuses.
4. **Treating AC4 as obvious.** A stored `60.12345` predates the rule. Input validation must not reach backwards and turn an untouched row into a save-blocking error.
5. **Shipping Part 1 without the helper text.** A refusal that does not say what is accepted is worse than the silent parse it replaced, because the user has no next move.

### Testing

`vitest` (`npm test`), suites under `travelplan/test/`. The parser cases are a node-environment table; the dialog cases use `renderWithProviders` with `// @vitest-environment jsdom`. Story 6.27's suites are the regression net for the comma path and must pass unmodified except where AC1 deliberately changes an expectation — that one changed expectation is the spec amendment, and it should be visible as such in the diff.

Record the full-suite baseline before starting and report it after.

### Project Structure Notes

No new files, no new dependency, no migration, no route or schema change. One shared helper module, one dialog for Part 1, two dialogs for Part 2, both dictionaries, one documentation correction in a spec file.

### References

- The operator pass that produced both items: [Source: _bmad-output/implementation-artifacts/6-27-a-comma-is-a-decimal-point.md#Operator Pass — 2026-08-07]
- The intent contract this amends: [Source: _bmad-output/implementation-artifacts/spec-6-27-a-comma-is-a-decimal-point.md]
- The read-side formatter to mirror: `travelplan/src/lib/trips/formatCost.ts:16`
- Epic definition: [Source: _bmad-output/planning-artifacts/epics.md#Story 6.30: One Decimal for a Distance, a Comma in the Box]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

### Change Log
