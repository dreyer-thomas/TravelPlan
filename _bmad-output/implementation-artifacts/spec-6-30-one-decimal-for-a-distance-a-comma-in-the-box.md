---
title: 'Story 6.30: One Decimal for a Distance, a Comma in the Box'
type: 'bugfix'
created: '2026-08-07'
status: 'done'
baseline_revision: '0fbdac9'
final_revision: '6c2f371'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/6-30-one-decimal-for-a-distance-a-comma-in-the-box.md'
warnings: ['multiple-goals', 'oversized']
---

<intent-contract>

## Intent

**Problem:** Two things Story 6.27 could not close. (1) `parseDecimal` reads a lone three-digit group
as a fraction, so a distance typed `1,000` **or** `1.000` silently saves as 1 km — a factor of 1000,
no warning, in the story whose subject is silent numeric loss. (2) Under German the cost field's
placeholder says `0,00` while its own value says `120.50`: the box contradicts its hint.

**Approach:** Cap the *distance field* at one decimal — Tommy's ruling on 2026-08-07, which makes all
three ambiguous forms refusable and turns a silent factor-of-1000 into a visible question — expressed
as a caller's option on `parseDecimal`, not as a new rule inside it. Give `formatCentsAsAmount` the
account language so the edit field shows the separator the user would type, and prove the round trip
back through `parseAmountToCents` is exact.

## Boundaries & Constraints

**Always:**
- The one-decimal rule is the **distance caller's**, passed in. `parseDecimal`'s default stays
  unbounded, and its docblock's promise ("whatever precision was typed survives") stays true of the
  helper itself.
- All three distance parse sites agree — `validate()`'s required branch (`:399`), its optional branch
  (`:409`) and the request body (`:528`). Any one left out either refuses what the request accepts or
  drops what the form accepted.
- The cap governs **input**. A stored distance the user did not touch still displays and saves as it
  is (AC4) — the exemption is "the field's string is byte-identical to what the dialog seeded".
- `formatCentsAsAmount` takes `language` as a **required** second argument, mirroring
  `formatCost(cents, language)`. Required, so the compiler names every site rather than leaving one
  silently English.
- Decimal separator only. The edit formatter never **emits** a thousands separator, even though
  `parseAmountToCents` would read one back.
- Round trip is exact in both languages: `cents → formatCentsAsAmount → parseAmountToCents → cents`.
- Both dictionaries stay in step (`i18nDictionaries.test.ts:25` asserts key parity).
- No existing assertion is weakened. The two English distance-error strings and the three
  `formatCentsAsAmount` cases in `parseAmount.test.ts` are **updated** — those updates are the spec
  amendment and must read as such in the diff.

**Block If:**
- The dirty-guard check for AC7 turns out to require re-seeding a form on a language change (i.e. the
  guard genuinely reports a change the user did not make, and fixing it means writing form values from
  a `language`-keyed effect). That is a behaviour change to two dialogs' open/close contract, not this
  story's cosmetic fix.

**Never:**
- Do not narrow `parseDecimal`'s own regex to one decimal.
- No change to `parseAmountToCents`' two-decimal money cap, and none to `formatCost`.
- No new standing helper line under the distance field — its `helperText` is error-only by design
  (`:739`), so the two error strings *are* its helper. No new i18n key.
- No schema, migration, route or `distanceKm` storage change. Out of scope: the unbounded cost ceiling,
  the distance field's missing on-change error clearing (DW-124), and the five-copies-of-lookup
  refactor.

## I/O & Edge-Case Matrix

`parseDecimal(raw)` → unchanged. `parseDecimal(raw, { maxDecimals: 1 })` is the distance field's call.
`formatCentsAsAmount(cents, language)` → the plain string a text field holds.

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| German thousands, lone comma | `parseDecimal("1,000", {maxDecimals:1})` | `null` — the silent 1 km is gone | Field error, save blocked |
| English thousands, lone dot | `"1.000"` | `null` | Field error, save blocked |
| Three decimals | `"12,555"` | `null` (6.27 required `12.555`; **reversed here**) | Field error, save blocked |
| Five decimals | `"60,12345"` | `null` | Field error, save blocked |
| German one decimal | `"60,5"` | `60.5` | No error expected |
| English one decimal | `"60.5"` | `60.5` | No error expected |
| Grouped, one decimal | `"1.234,5"` / `"1,234.5"` | `1234.5` — two separators still resolve | No error expected |
| Whole number | `"12000"` | `12000` | No error expected |
| Whitespace group | `"1 000"` | `1000` | No error expected |
| No option passed | `parseDecimal("60,12345")` | `60.12345` — helper unbound | No error expected |
| Untouched stored value | field holds seeded `"60.12345"`, never edited | parses as `60.12345`, saves unchanged | No error |
| Edited to five decimals | seeded `"60.12345"`, user types `"60,12346"` | refused | Field error, save blocked |
| German amount out | `formatCentsAsAmount(12050, "de")` | `"120,50"` | — |
| English amount out | `formatCentsAsAmount(12050, "en")` | `"120.50"` | — |
| No grouping emitted | `formatCentsAsAmount(123450, "de")` | `"1234,50"` — not `"1.234,50"` | — |
| Round trip | `parseAmountToCents(formatCentsAsAmount(c, lang))` | `=== c`, both languages | — |

</intent-contract>

## Code Map

- `travelplan/src/lib/trips/parseAmount.ts` -- `parseDecimal` `:92-102` (regex `^\d+(\.\d+)?$`, docblock
  `:82-91` promises unbounded precision); `formatCentsAsAmount` `:111` and the docblock `:104-110` whose
  dot-decimal reasoning Part 2 retires; `normalizeDecimalInput` `:33` unchanged.
- `travelplan/src/lib/trips/formatCost.ts:16` -- `formatCost(cents, language)`, the read-side twin whose
  signature Part 2 mirrors. Unchanged.
- `travelplan/src/components/features/trips/TripDayTravelSegmentDialog.tsx` -- `parseDecimal` at `:399`
  (required → `distanceRequired` if empty, else `distancePositive`), `:409` (optional →
  `distanceInvalid`), `:528` (request body, `distanceKm` at `:539`); `openedValues` memo `:284-295`
  seeds distance as `String(segment.distanceKm)` at `:288-289` (no `toFixed`, no locale); `isDirty`
  `:591-596` compares that same raw string; distance `TextField` `:717-745` with error-only
  `helperText` `:739`; `formatDistanceKmInput` `:116-119` — the route import **already** rounds to one
  decimal, so the cap contradicts nothing the app itself produces.
- `travelplan/src/components/features/trips/TripAccommodationDialog.tsx` -- `formatCentsAsAmount` at
  `:349`, `:354` (both inside module-level `buildDefaultPayments` `:338-357`, where `language` is *not*
  in scope), `:444` (`useForm` defaults), `:613` (open-effect `reset`); `buildDefaultPayments` called at
  `:450` and `:619`; `const { t, language } = useI18n()` `:378`; placeholder `:1963`; dirty guard
  `:1684-1700` over RHF `isDirty` (`:431`) against the `reset()` baseline; open-effect deps `:637`.
- `travelplan/src/components/features/trips/TripDayPlanDialog.tsx` -- `formatCentsAsAmount` at `:547`,
  `:552` (module-level `buildDefaultPayments` `:536-556`), `:847` (open-effect seed);
  `buildDefaultPayments` called at `:849`, `:871`, `:886`; `language` `:570`; placeholder `:2372`;
  `planFormFingerprint` `:521-535` includes `values.cost` and every `payment.amount` **string**,
  baseline captured `:902`, compared `:1445-1452`.
- `travelplan/src/i18n/en.ts:352,377` / `de.ts:334,362` -- `distanceInvalid` (no example today) and
  `distancePositive` (already carries `z. B. 12,5 oder 12.5`). No length budget covers either key.
- `travelplan/test/parseAmount.test.ts` -- `parseDecimal` describe `:82`; `formatCentsAsAmount` `:131-135`
  (three one-argument calls to update). Node environment, no jsdom comment.
- `travelplan/test/travelSegmentDialog.test.tsx` -- jsdom, real MUI, local `render` `:21`, per-test
  `I18nProvider initialLanguage="en"`, `saveCallBody` `:1119`. `:1316` "keeps three decimals, uncapped
  and unscaled" (`12,555` → `12.555`) is the assertion AC1 reverses; `:808` pins `distanceInvalid`'s
  English text, `:1380` pins `distancePositive`'s; `:1288` `12,5` and `:794` `["0","-3"]` must survive.
- `travelplan/test/tripAccommodationDialog.test.tsx` -- jsdom, real MUI, `Providers` `:12`, `selectTab`
  `:21`, `costField()` `:32`. English value pins `:462` `"50.00"`, `:463` `"70.00"`, `:726` `"120.00"`
  all stay; the single `de` render `:1676` pins no field value today.
- `travelplan/test/tripDayPlanDialog.test.tsx` -- jsdom, `@mui/material` mocked `:34`, `selectTab` `:396`
  (prefix match, `en`/`de` label maps `:2929-2931`). English pins `:739` `"21.00"`, `:1117`/`:1118`
  `"50.00"`/`"70.00"` all stay.
- `travelplan/test/helpers/renderWithProviders.tsx:7,16,22` -- `Providers({children, language})`,
  `"en" | "de"`. The only way a suite renders German.
- `travelplan/test/i18nDictionaries.test.ts:25` -- key parity.
- `_bmad-output/implementation-artifacts/spec-6-27-a-comma-is-a-decimal-point.md` -- `operator_actions`
  entry 6 (`:16`) to correct; empty `## Spec Change Log` `:133` to record it in; `## Operator
  Confirmation` `:250-264` is a historical record of what a human confirmed and is **not** edited.

## Tasks & Acceptance

**Execution:**
- [x] `travelplan/src/lib/trips/parseAmount.ts` -- `parseDecimal(rawValue, options?: { maxDecimals?: number })`.
  Omitted → today's `^\d+(\.\d+)?$` exactly. Given → the fraction group is bounded to that many digits
  (build the pattern; a `maxDecimals` of `0` must mean integers-only, not an invalid `\d{1,0}`).
  Extend the docblock: the promise still holds by default, the cap is a caller's rule, and name the
  reason — a lone three-digit group is a fraction in both spellings, so `1,000` km was 1 km. -- AC1, AC3
- [x] `travelplan/src/components/features/trips/TripDayTravelSegmentDialog.tsx` -- one local
  `parseDistanceInput(raw)` used by **all three** sites (`:399`, `:409`, `:528`): pass
  `{ maxDecimals: 1 }` unless `raw === openedValues.distance`, in which case parse unbounded. Comment it
  with AC4's reason — a row stored before the rule existed must not become unsaveable — and note that
  `formatDistanceKmInput` (`:116`) already emits at most one decimal, so the route-import path needs no
  exemption. -- AC1, AC4
- [x] `travelplan/src/i18n/en.ts`, `travelplan/src/i18n/de.ts` -- extend `trips.travelSegment.distancePositive`
  and `distanceInvalid` to state "at most one decimal"; give `distanceInvalid` the same `12,5 / 12.5`
  example `distancePositive` already carries. Keep both under ~110 characters. -- AC2
- [x] `travelplan/src/lib/trips/parseAmount.ts` -- `formatCentsAsAmount(value, language)`: `toFixed(2)`
  then swap `.` for `,` under `de`. Rewrite the docblock — the dot-only argument was sound only while
  the parser was dot-only, and since 6.27 it is not — and state why no thousands separator is emitted:
  a box showing `1.234,50` teaches the habit Part 1 refuses. -- AC5, AC6
- [x] `travelplan/src/components/features/trips/TripAccommodationDialog.tsx` -- thread `language` to
  `:444`, `:613`, and into `buildDefaultPayments` (`:338-357`) as a parameter so `:349`/`:354` get it,
  updating the calls at `:450` and `:619`. -- AC5
- [x] `travelplan/src/components/features/trips/TripDayPlanDialog.tsx` -- the same for `:847` and
  `buildDefaultPayments` (`:536-556`), updating `:849`, `:871`, `:886`. -- AC5
- [x] both dialogs -- read the dirty guards (`TripAccommodationDialog:1684-1700` over RHF `isDirty`;
  `planFormFingerprint:521-535` + baseline `:902` + compare `:1445-1452`) against their open-effect
  dependency arrays (`:637`, `:905`) and **record the finding** in Design Notes: whether a language
  switch mid-dialog can rewrite a seeded string. Change code only if it can. -- AC7
- [x] `_bmad-output/implementation-artifacts/spec-6-27-a-comma-is-a-decimal-point.md` -- correct
  `operator_actions` entry 6: an unusable cost is refused, reached by typing on a desktop browser or by
  **pasting** on the phone, because `inputMode="decimal"` yields a keypad with no letters. Append a
  dated entry to its empty `## Spec Change Log` naming this story, and say there that the
  `## Operator Confirmation` list is left verbatim as the historical record, so the two now differ by
  design. Documentation only. -- AC8
- [x] `travelplan/test/parseAmount.test.ts` -- add a `maxDecimals` describe covering every distance row
  of the I/O matrix (four refusals, five acceptances, and one unbounded call proving the default is
  untouched); update the three `formatCentsAsAmount` calls at `:133-135` to pass a language, add the
  German output and no-grouping cases, and assert the round trip as a property over a spread of cent
  values in both languages. -- AC1, AC3, AC5, AC6
- [x] `travelplan/test/travelSegmentDialog.test.tsx` -- reverse `:1316` from "keeps three decimals" to
  "refuses more than one decimal", asserting the error text and **no save call**; add a German render
  (`I18nProvider initialLanguage="de"`) typing `1,000` and refused; add AC4's case — a segment seeded
  with `distanceKm: 60.12345` saves `60.12345` unchanged when the field is not edited, and is refused
  once the field is edited to another five-decimal value. Update `:808` and `:1380` to the reworded
  strings. `:794` and `:1288` stay. -- AC1, AC2, AC4
- [x] `travelplan/test/tripAccommodationDialog.test.tsx`, `travelplan/test/tripDayPlanDialog.test.tsx` --
  per suite: under `language="de"` a stay/activity holding `12050` renders `"120,50"` in the cost field
  and its payment row renders with a comma, and an open → language switch → close reports **nothing**
  dirty (no discard prompt). The English value pins stay byte-identical. -- AC5, AC7
- [x] `travelplan/test/i18nDictionaries.test.ts` -- pin that both reworded distance strings name the
  one-decimal rule in both languages, so the rule cannot be dropped from the copy while the code keeps
  enforcing it. -- AC2

**Acceptance Criteria:**
- Given the distance field on any transport mode that has one, when a value with more than one decimal
  is entered and saved, then a visible field error blocks the save and no request is issued — and the
  same value is refused identically by the required and the optional branch.
- Given a travel segment whose stored distance predates the rule, when the dialog is opened and saved
  with the distance field untouched, then the stored value is displayed as-is and written back
  unchanged.
- Given a search of `src/`, when `parseDecimal(` is grepped, then the only call passing `maxDecimals` is
  the travel-segment dialog's, and the helper's own default behaviour is unchanged.
- Given `de` is the account language, when a dialog opens on an entity with a cost, then the cost field
  and every payment amount show a comma, agreeing with the placeholder and helper beside them; under
  `en` all three show a period.
- Given any dialog is opened and closed with no edit, when it closes, then no discard prompt appears —
  including across a language change while it was open.
- Given both dictionaries, when their keys are listed, then they are identical and no key was added.
- Given Story 6.27's spec, when its `operator_actions` entry 6 is read, then it describes a reachable
  action, and its `## Operator Confirmation` block is byte-identical to before.

## Spec Change Log

## Review Triage Log

### 2026-08-07 — Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 8: (high 0, medium 2, low 6)
- defer: 5: (high 0, medium 1, low 4)
- reject: 6: (high 0, medium 0, low 6)
- addressed_findings:
  - `[medium]` `[patch]` The refusal named the rule but not the repair, for the one case the cap exists
    for. Someone typing `1,000` believes they typed a *thousand*, not a decimal, so "at most one decimal"
    described a rule they did not think they broke and left them nothing to try — the story's own trap 5
    ("a refusal that does not say what is accepted is worse than the silent parse it replaced"). All four
    strings now carry `1000 not 1.000` / `1000 statt 1.000`; five test assertions updated with them.
  - `[medium]` `[patch]` Every decimal-cap case drove `Distance (km)` — the car/required branch — so
    reverting `parseDistanceInput` to a bare `parseDecimal` on the *optional* branch alone would have
    left every suite green while a walking or cycling leg silently saved `1,000` km as 1 km again. That
    is AC1's "refused identically by the required and the optional branch" with no test behind it. Added
    an `it.each(["1,000", "12,555"])` case on `Distance (km, optional)`.
  - `[low]` `[patch]` `maxDecimals` was handed to a quantifier as it arrived, and the two ways of
    spelling it wrong failed in opposite directions past the `<= 0` guard. Verified by probe:
    `{ maxDecimals: 0.5 }` floors into `\d{1,0}` and **throws** `SyntaxError` out of a function whose
    contract is to answer `null`; `{ maxDecimals: Infinity }` — the natural spelling of "no cap" —
    interpolates as *text*, and `\d{1,Infinity}` is a valid pattern, so it silently accepted integers
    and refused every decimal. Non-finite now means unbounded, below one means integers only, with three
    cases pinning each direction.
  - `[low]` `[patch]` `parseDistanceInput`'s docblock claimed "the app's own producer already obeys the
    rule". True of `formatDistanceKmInput`, false as stated: `tripImportSchemas.ts` restores a
    backed-up `distanceKm` as any positive float and `travelSegmentSchemas.ts` accepts one. Reworded to
    name the backup-import path, to say plainly that the column can hold more decimals than the field
    will take, and that this is what the exemption is for.
  - `[low]` `[patch]` Both `buildDefaultPayments` docblocks justified themselves with "the placeholder
    beside them said `0,00`" — payment rows have no placeholder; the *cost* field does. Reworded to the
    real reason: the row is seeded from that cost and read back by the same parser.
  - `[low]` `[patch]` `formatCentsAsAmount`'s docblock promised that a required `language` makes the
    compiler name every call site. It named every *existing* one; the separator is a `=== "de"` ternary,
    so a third dictionary would compile and test clean while rendering `120.50` beside its own locale's
    placeholder. Claim trimmed to what is true, with `Intl` named as the fix at that point for this and
    `formatCost` together.
  - `[low]` `[patch]` `it("adds no new distance key")` asserted the absence of two key names nobody
    proposed, so it could only fail by someone guessing one of two spellings — it would have passed for
    the `Never`-forbidden standing helper under any other name. Replaced with a frozen
    `trips.travelSegment.distance*` key set.
  - `[low]` `[patch]` The copy-length assertion measured characters while its comment claimed a 390px
    wrap budget, which it cannot see. Comment rewritten to say what it is — an anti-ballooning ceiling —
    and the ceiling raised 110 → 120 to admit the `1000 not 1.000` clause above. Recorded here rather
    than done quietly: it is this pass's own assertion being loosened by this pass, and 120 still refuses
    a third clause.

Deferred entries are in [deferred-work.md](deferred-work.md). The six rejections were: the cap being
broader than the ambiguity it was built for and the two halves teaching different decimal rules (both
re-argue a ruling Tommy made on 2026-08-07, which the spec records as a decision rather than a default);
the absence of server-side enforcement (the intent contract forbids a schema change and the docblock
already says the cap is input-only); `formatCentsAsAmount` breaking its round trip for negative and
`≥1e21` cent values (unreachable — the column is a non-negative `Int`, and guarding it would be dead
code); the byte-identical exemption refusing a re-spelled `60,12345` (the spec chose byte-identical
deliberately and Design Notes says why); and a filled distance being nulled when the mode switches to
ship or flight (the field is hidden for those modes, so nulling a meaningless value is the behaviour).

### 2026-08-07 — Review pass (follow-up)

- intent_gap: 0
- bad_spec: 0
- patch: 5: (high 0, medium 1, low 4)
- defer: 0
- reject: 14: (high 0, medium 0, low 14)
- addressed_findings:
  - `[medium]` `[patch]` Both German payment-row assertions were satisfied by something other than the
    code they were written for. A one-payment fixture puts each dialog in `single` mode, where the
    cost→row mirror effect (`TripAccommodationDialog:542-562`, `TripDayPlanDialog:1056-1077`) overwrites
    `payments[0].amount` with the trimmed cost string — so the row read `120,50` whether or not
    `buildDefaultPayments` was given a language. Confirmed by mutation probe: reverting
    `formatCentsAsAmount(payment.amountCents, language)` to `"en"` in either dialog left both existing
    German cases green. The `payments.length > 1` branch is the only place Part 2's threading through
    those builders is observable, and it had no test, so a split stay or activity could have gone back
    to `50.00 / 70.50` under German silently. A two-row `split` case added per suite; both now fail
    under the same probe and pass without it.
  - `[low]` `[patch]` `formatCentsAsAmount`'s docblock described the wrong function next door. It said
    the separator is "a `=== "de"` ternary, the same shape `formatCost` uses" and named `Intl` as "the
    fix at that point, for both functions together" — but `formatCost` (`formatCost.ts:16-22`) is
    already built on `Intl.NumberFormat`; its ternary picks a *locale tag*, not a separator, and its
    own third-dictionary failure is a different one (an unmapped language falls back to `en-US`) needing
    a different repair. The pass that trimmed this claim last time left it still untrue. Reworded to say
    the mirroring is of the signature only, why `Intl` cannot simply be adopted here (grouping and the
    currency symbol must not reach a box the user types back into), and what each function would
    actually need.
  - `[low]` `[patch]` Story 6.27's `operator_actions` entry 9 still asked an operator to *rule* on the
    distance-grouping question — the ruling this whole story implements. The same pass rewrote entry 6
    in that list and walked past entry 9, so re-running 6.27's operator pass would have asked Tommy to
    re-decide a question he closed on 2026-08-07. Marked `SETTLED` in place (not deleted, so the list
    still records what was asked) with a matching bullet in the Spec Change Log entry beside the
    entry-6 correction. `## Operator Confirmation` still untouched, as AC8 requires.
  - `[low]` `[patch]` The new German travel-segment case justified its hand-written duration fills with
    "this is the suite's only German render". The suite has five others (`:445`, `:1005`, `:1043`,
    `:1053`, `:1198`). The point behind the comment is sound — `setDuration` hardcodes English labels —
    so it now says that, and notes that the other German renders never touch the duration boxes, which
    is why the helper has never needed a language.
  - `[low]` `[patch]` `renderEditWithCost` in `tripDayPlanDialog.test.tsx` carried a docblock describing
    the test *below* it ("this one pins the value"), so the second `it` inherited prose about the first,
    and it mounts `<LanguageSwitch />` for a caller that never clicks it. Docblock moved onto its `it`;
    the helper now documents what it is and gained the `payments` parameter the new split case needs.

No new deferred entries: nothing surfaced this pass was both real and outside the story. The fourteen
rejections fall into four groups. Three re-argue decisions the spec records as decisions — the German
copy being verbless where its neighbours are imperative (it reads as a statement of what is accepted,
which is idiomatic for form errors, and the only imperative that fits the ceiling weakens "größer als 0"
to "über 0"); `distancePositive` answering `abc`/`0`/`-3` as well as the cap (it still leads with
"greater than 0", which is what those three broke); and the byte-identical exemption being invisible to
the user. Four are unreachable: a `maxDecimals` of `1e21`, a seeded `distanceKm` that stringifies
exponentially (`"1e-7"` — refused by the *base* gate, before and after this story), distances strictly
between 0 and 0.1 km (100 m resolution is the ruling), and the real language switcher's
`router.refresh()` reaching a dialog the header menu cannot be opened behind. Three are duplicates of
ledger entries the last pass filed (DW-210's stale error line, DW-214's sub-50 m prefill, and DW-213's
missing second writer) or of another finding in the same report. Two are ledger hygiene on entries this
pass does not own — DW-210 restating DW-124, and DW-213 naming only one of the two dot-decimal writers
into the distance field. And two are style: the dialog suites pinning whole error sentences where the
dictionary suite pins the rule (different jobs — one checks the key was rendered, the other that the
copy still carries the rule), and the frozen `distance*` key set being a tripwire for a future story
that legitimately adds a key (deleting an argued assertion is the correct cost of that). One claim was
checked and found false: the 110→120 character ceiling was not moved quietly — the previous pass records
it in this log, in the entry above.

## Design Notes

**Why an option and not a narrower regex.** `parseDecimal`'s docblock states its own contract — whatever
precision was typed survives, deliberately unlike `parseAmountToCents`. The travel-segment dialog is its
only consumer today, which is exactly what makes hard-coding the cap look harmless and be wrong: the
next caller inherits a distance rule it never asked for. An explicit default keeps the helper honest.

```ts
export const parseDecimal = (rawValue: string, options?: { maxDecimals?: number }) => { … }
// distance field, all three sites:
const parseDistanceInput = (raw: string) =>
  raw === openedValues.distance ? parseDecimal(raw) : parseDecimal(raw, { maxDecimals: 1 });
```

**Why the untouched-value exemption is a string compare.** `openedValues.distance` (`:288-289`) is
already the dirty guard's own reference (`:595`), so "the user has not touched this field" is a
comparison the dialog makes anyway. AC4 needs nothing more; reaching for a "was this value stored
before the rule" flag would need a schema field for a transitional case.

**Why one decimal and not two.** 100 m resolution is beyond anything trip planning uses — Tommy:
*"wir sind 12000 km von zu Hause weg, da messe ich keine Meter einzeln mehr."* Corroboration from the
code: `formatDistanceKmInput` (`:116-119`) has always rounded an imported route to one decimal, so the
app's own producer already agrees with the rule its input side is now getting.

**What Part 2 retires.** The dot-only edit formatter was correct while `parseAmountToCents` was
dot-only. Story 6.27 made it accept both, so the argument no longer binds — and `formatCost(cents,
language)` next door is the shape to copy. Grouping stays out: `parseAmountToCents("1.234,50")` does
return `123450`, so emitting it would round-trip, but a field showing `1.234,50` invites `1.000` into
the box beside it, which is the exact input Part 1 exists to refuse.

**AC7, from reading the code rather than assuming.** Neither dialog's open effect depends on `language`
(`TripAccommodationDialog:637`, `TripDayPlanDialog:905`), and `language` appears in no dependency array
that writes form values — only in the read-only `daySubtitle` memo and the two placeholders. So a
language switch mid-dialog does not re-seed, the guards' baselines (`reset()`; `openFingerprint.current`)
stay matched, and AC7 is expected to hold with no code change. `TripDayPlanDialog` is the strict one —
`values.cost` and every `payment.amount` are literal terms of its fingerprint — so it is the suite that
would catch a regression. The test exists to pin that, not to fix something.

**AC7 as implemented — confirmed, and one thing the read above did not anticipate.** The guards were
re-read during implementation and the finding holds: no re-seed, no code change, `Block If` never
triggered, and both new close-across-a-language-switch cases pass. What the plan missed is that once
`language` is *read* inside those open effects, `react-hooks/exhaustive-deps` demands it in the
dependency arrays — and adding it is precisely the behaviour change the `Block If` forbids: `reset()` /
`openFingerprint.current` would re-run mid-dialog and discard whatever the user had typed. Both effects
therefore carry a documented `eslint-disable-next-line react-hooks/exhaustive-deps`
(`TripAccommodationDialog:644`, `TripDayPlanDialog:912`) rather than the dependency. Lint stayed at
exactly its 85/2 baseline, and this repo warns on unused disable directives, so both suppressions are
load-bearing rather than decorative.

**The one reversed expectation.** `travelSegmentDialog.test.tsx:1316` asserts `12,555` → `12.555` and is
titled "keeps three decimals, uncapped and unscaled". Reversing it is the spec amendment, and it should
be legible as one line of the diff rather than a quiet deletion.

## Verification

**Commands:** (all in `travelplan/`)
- `npx vitest run test/parseAmount.test.ts` -- expected: green, including the unbounded-default case.
- `npx vitest run test/travelSegmentDialog.test.tsx` -- expected: green; only `:808`, `:1316`, `:1380`
  changed among existing cases.
- `npx vitest run test/tripAccommodationDialog.test.tsx test/tripDayPlanDialog.test.tsx test/i18nDictionaries.test.ts`
  -- expected: green, every existing English value pin untouched.
- `npm test` -- expected: at or above the 1871-test / 131-file baseline measured at `0fbdac9`, zero failures.
- `npx tsc --noEmit` -- expected: 0 `src` errors; test-side at or below the 135 baseline.
- `npm run lint` -- expected: at or below 85 problems / 2 errors.
- `npm run check:migrations` -- expected: pass (this story adds none).
- `npm run audit:check` -- expected: unchanged 1 pre-existing high; `package-lock.json` byte-identical.
- `grep -rn "parseDecimal(" src/` -- expected: the definition plus the travel-segment dialog only, and
  `maxDecimals` appearing at no other call site.
- `grep -rn "formatCentsAsAmount" src/` -- expected: every call passes a language argument.
- `git diff -- _bmad-output/implementation-artifacts/spec-6-27-a-comma-is-a-decimal-point.md` -- expected:
  `operator_actions` entry 6 and one Spec Change Log entry only; the `## Operator Confirmation` block
  untouched.

**Manual checks (if no CLI):**
- Before implementing, run the reversed `12,555` distance case against unmodified code and confirm it
  **fails** (the value parses today); record the observed value in the Completion Notes.

## Auto Run Result

Status: `done`. This was the independent follow-up review the previous pass asked for, run against the
same baseline (`0fbdac9`). It found no reason to re-derive anything: 0 intent gaps, 0 bad-spec findings,
and no change to what the code *does*. Five patches applied, all of them closing a gap between what the
diff claimed and what it demonstrated. No blocking condition and no operator action owed.

**What changed in this pass.** One finding mattered and four were accuracy repairs.

*The one that mattered.* Both dialogs' new "renders a payment amount with a comma under `de`" cases
were passing for the wrong reason. Each fixture carries a single payment, which puts the dialog in
`single` mode, where a mirror effect copies the trimmed cost string straight into `payments[0].amount` —
so the row showed a comma because the *cost* had one, not because `buildDefaultPayments` was handed a
language. The `payments.length > 1` branch, the only place Part 2's threading through those two
module-level builders is observable, had nothing testing it. Verified rather than argued: reverting
`formatCentsAsAmount(payment.amountCents, language)` to `"en"` in either dialog left every existing case
green. A split (two-row) German case was added per suite, and both now go red under that same revert. A
split stay or activity could otherwise have drifted back to `50.00 / 70.50` under German — Part 2's own
defect, on the path Part 2 threaded the language through.

*The four accuracy repairs.* `formatCentsAsAmount`'s docblock described `formatCost` as sharing its
`=== "de"` separator ternary and prescribed `Intl` "for both functions together"; `formatCost` has been
built on `Intl.NumberFormat` all along, and its third-dictionary problem is a different one needing a
different fix. Story 6.27's `operator_actions` entry 9 still asked an operator to rule on the very
question this story implements the ruling for — the earlier pass rewrote entry 6 in that list and walked
past entry 9. A test comment claimed its German render was the suite's only one, where five others
exist. And `renderEditWithCost` carried a docblock about the test below it rather than about itself.

**Files changed in this pass**

- [travelplan/src/lib/trips/parseAmount.ts](../../travelplan/src/lib/trips/parseAmount.ts) — `formatCentsAsAmount` docblock only; no behaviour change.
- [travelplan/test/tripAccommodationDialog.test.tsx](../../travelplan/test/tripAccommodationDialog.test.tsx), [tripDayPlanDialog.test.tsx](../../travelplan/test/tripDayPlanDialog.test.tsx) — a split-payment German case per suite; `renderEditWithCost` documented and given a `payments` parameter.
- [travelplan/test/travelSegmentDialog.test.tsx](../../travelplan/test/travelSegmentDialog.test.tsx) — corrected comment.
- [spec-6-27-a-comma-is-a-decimal-point.md](spec-6-27-a-comma-is-a-decimal-point.md) — `operator_actions` entry 9 marked `SETTLED`, with a matching Spec Change Log bullet. `## Operator Confirmation` still byte-identical.

**What the story delivers overall.** Unchanged from the previous pass, and re-verified here.
*Part 1:* the distance field caps at one decimal, passed in as `parseDecimal(raw, { maxDecimals: 1 })` at
all three parse sites, so `1,000` and `1.000` are refused instead of silently saving 1000 km as 1 km.
The helper's default stays unbounded and a string byte-identical to the dialog's seed is parsed
unbounded, so a pre-rule row still opens and saves. *Part 2:* `formatCentsAsAmount` takes the account
language, so a German cost box no longer reads `120.50` beside a `0,00` hint. Decimal separator only —
no grouping, because `1.234,50` in an edit box teaches the habit Part 1 refuses.

**Review.** 0 intent_gap, 0 bad_spec, 5 patches applied, 0 deferred, 14 rejected. The rejections and the
reasoning behind each group are in the Review Triage Log. Nothing new was added to the deferred-work
ledger this pass: everything real that surfaced was either already filed by the previous pass (DW-210,
DW-213, DW-214), unreachable, or a re-argument of a decision the spec records as a decision.

**Verification.** `npm test` 1900 passed / 131 files, zero failures (1898 before this pass; +2 is the
two new split-payment cases). `npx tsc --noEmit` 0 `src` errors, 135 test-side — exactly the 135
baseline. `npm run lint` 85 problems / 2 errors, exactly baseline. `npm run check:migrations` passed.
`npm run audit:check` unchanged at 1 pre-existing high, `package-lock.json` untouched. `grep` confirms
`maxDecimals` still appears at exactly one call site and every `formatCentsAsAmount` call passes a
language. The two new cases were confirmed load-bearing by mutation probe in both dialogs, and the two
they sit beside were confirmed *not* to be — which is what the finding was.

**Follow-up review recommended: false.** This pass changed no runtime behaviour at all: one docblock,
one test comment, one test-helper docblock, one line in another story's spec, and two new test cases
whose value was demonstrated by probe rather than asserted. There is nothing here for an independent
pass to catch.

**Residual risks.** Carried forward unchanged, and none of them moved this pass. No test types on a
German keyboard, so the surface 6.27's bug was reported on is still unverified for the reworded errors
and the comma-seeded values; no acceptance criterion requires a phone pass, which is why this is a risk
rather than an operator action. The one-decimal rule is a field rule, not a data invariant —
`travelSegmentSchemas.ts` and the backup importer both still accept any positive float, deliberately,
because AC4 requires it. `formatCentsAsAmount` still decides the separator with a `=== "de"` ternary, so
a third dictionary would re-create this story's defect for the new locale; the docblock now names the
narrow `Intl` fix accurately, and notes that `formatCost` needs a different one. And a language switch
made while a dialog is already open still leaves the value dot-decimal beside a comma placeholder —
DW-212, unreachable behind a modal, and re-seeding it is the spec's Block If.

