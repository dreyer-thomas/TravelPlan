---
title: 'Story 6.27: A Comma Is a Decimal Point'
type: 'bugfix'
created: '2026-08-07'
status: 'awaiting-operator'
baseline_revision: 'b759ec3'
final_revision: 'da25d1d'
review_loop_iteration: 0
followup_review_recommended: true
operator_actions:
  - 'Set a phone to German and open a stay dialog on it; type 12,50 into the cost field and confirm the numeric keypad offers a comma, the comma appears in the box, and the saved cost reads 12,50 after closing and reopening the dialog.'
  - 'Repeat that comma check on the four remaining fields — the stay payment amount, the activity cost, the activity payment amount, and the travel-segment distance in km — confirming each accepts the comma and saves the value it displayed.'
  - 'Confirm the cost placeholder renders 0,00 under German and that the helper line under both cost fields names the accepted forms (Optionaler Betrag (z. B. 10,00 oder 10.00)).'
  - 'Confirm the payment-amount row is still read-only unless "Aufteilen" (split) is selected, on both the stay and the activity dialog.'
  - 'Switch the device to English and confirm a period still works on all five fields and nothing about the English keyboard changed.'
  - 'Type abc into the stay cost field on the phone and confirm the save is blocked with a visible error rather than the stay saving with no cost.'
  - 'Run the phone pass against a throwaway environment only — a copy of dev.db on an isolated port with MEDIA_STORAGE_ROOT pointed at a scratch directory, never prisma/dev.db and never the real media tree (recipe in 7-12-bucket-list-sidebar-card.md Dev Notes).'
  - 'Decide Story 6.27 open question 4: whether this bug fix stays numbered 6.27 inside a closed epic or moves to a maintenance epic, and add the matching entry to epics.md — the epics file currently jumps 6.26 to 6.28.'
  - 'Rule on the deferred distance-grouping question (DW entry from this spec): cap distanceKm at one decimal, which makes both 1,000 and 12,555 rejectable, or keep it uncapped and accept that a lone three-digit group is read as a decimal.'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/6-27-a-comma-is-a-decimal-point.md'
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** Four numeric inputs are `type="number"`, so a comma typed on a German keyboard is
discarded by the browser before React sees it — the handler receives `""`. For the two money fields
whose validation treats empty as "no cost", the stay saves with **no cost at all**, silently, while
the box looked filled. Reported from a real German phone on 2026-08-05 against the stay cost field.

**Approach:** Take the fix that already exists one field deep — the activity cost field is `type="text"`
+ `inputMode="decimal"` with a comma-aware parser — promote that parser to a shared module beside
`formatCost.ts`, apply the input-type change to the four fields left behind, and make validation
distinguish "empty" (legal, means no cost) from "unparseable" (a visible, blocking error).

## Boundaries & Constraints

**Always:**
- Both separators are accepted regardless of locale. A German keyboard on an `en-US` browser still
  sends a comma. Locale decides *rendering* (`formatCost`), never what is *accepted*.
- `type="number"` is the root cause; a better parser alone cannot fix it. Each of the four fields
  becomes `type="text"` with `inputMode="decimal"`, and `min`/`step` go with it (inert on a text
  input, and they imply a validation that is no longer there).
- `readOnly: paymentMode !== "split"` is preserved on both payment-amount fields.
- Exactly one parser implementation survives, in `src/lib/trips/`. Both local copies are deleted, not
  patched, and none is left as a fallback.
- Distance is not money: it must not be rounded to two decimals nor multiplied by 100.
- Every user-facing string exists in both `de.ts` and `en.ts` (`i18nDictionaries.test.ts:25` asserts
  key parity). No key is added that nothing renders.
- No existing assertion is weakened to make a new one pass.

**Block If:**
- The API contract turns out not to be integer cents, i.e. any of the four route/schema suites named
  in Verification needs an edit to pass.

**Never:**
- No `validity.badInput` read in `src/`, and no test asserting it — jsdom reports `false` where a real
  browser reports `true`.
- No `Intl.NumberFormat.formatToParts` locale sniffing to decide the accepted separator.
- No new dependency; no schema, migration or server-side change.
- Out of scope: currency selection (EUR hardcoded app-wide — DW-151), the `TripTimeline`/`TripDayView`
  local `formatCost` copies (DW-151/DW-27), the two dialogs' byte-identical `costField()` test helpers
  (they are the parity anchor — do not deduplicate), and adding a maximum to the activity cost field
  (only the stay has `maxCostCents` today).

## I/O & Edge-Case Matrix

`parseAmountToCents(raw)` → cents | `null`; `parseDecimal(raw)` → number | `null`.

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| German decimal | `"12,50"` | `parseAmountToCents` → `1250` | No error expected |
| English decimal | `"12.50"` | `1250` | No error expected |
| Whole number | `"12"` | `1200` | No error expected |
| German thousands | `"1.234,50"` | `123450` — last separator wins | No error expected |
| English thousands | `"1,234.50"` | `123450` — last separator wins | No error expected |
| Thin space from a phone keypad | `"1 234,50"` (U+202F) | `123450` — `\s` strips it | No error expected |
| Zero | `"0"` | `0` (distinct from `null`) | No error expected |
| Empty | `""` / `"   "` | `null` | Caller decides: cost → valid, means "no cost" |
| Letters | `"abc"` | `null` | Field error, save blocked |
| Double separator | `"12,,5"` | `null` | Field error, save blocked |
| Negative | `"-1"` | `null` | Field error, save blocked |
| Three decimals (money) | `"12,555"` | `null` | Field error, save blocked |
| Three decimals (distance) | `"12,555"` | `parseDecimal` → `12.555` — no 2-dp cap | No error expected |
| German distance | `"12,5"` | `parseDecimal` → `12.5` (**not** `12`, which `Number.parseFloat` returns) | No error expected |
| Above the stay ceiling | `"1000000.01"` | parses to `100000001` cents | Stay cost field: `trips.stay.costTooHigh` |

</intent-contract>

## Code Map

- `travelplan/src/lib/trips/parseAmount.ts` -- **new.** The single parser, beside its inverse `formatCost.ts`.
- `travelplan/src/lib/trips/formatCost.ts` -- the inverse operation (cents → locale string); unchanged, but names the neighbourhood.
- `travelplan/src/components/features/trips/TripDayPlanDialog.tsx` -- `formatCentsAsAmount` (`:428`) and the comma-aware `parseAmountToCents` (`:430-458`) to move out; activity cost field `:2203-2220` (already correct, the reference); payment amount `:2254-2268` (`type="number"`); inline validation `:1153-1230`; cost→payment mirror `:1055-1075`.
- `travelplan/src/components/features/trips/TripAccommodationDialog.tsx` -- `formatCents` (`:321`) and the dot-only `parseAmountToCents` (`:323-330`) to delete; inline `(x/100).toFixed(2)` duplicates `:440-443`, `:605-608`; `maxCostCents` `:809`; `costRules` `:810-830`; `collectRuleFailures` `:883-902`; submit re-parse `:975-981`; payments `:986-1044`; stay cost field `:1838-1846`; payment amount `:1878-1887`.
- `travelplan/src/components/features/trips/TripDayTravelSegmentDialog.tsx` -- Story 6.18's docblock naming this exact bug `:647-666`; `validate()` `:389-420`; request body `:529-539`; distance field `:717-732` (the file's only `inputProps` usage).
- `travelplan/src/components/forms/FormField.tsx` -- spreads `...rest` into MUI `TextField`, so `type`, `placeholder` and `slotProps` pass through. No change.
- `travelplan/src/i18n/de.ts` (`:490`, `:549`), `travelplan/src/i18n/en.ts` (`:527`, `:597`) -- the helper that promises comma support and the one that does not. `trips.stay.costHelper` exists in both dictionaries and **is rendered nowhere** — the stay cost field has no `hint`.
- `travelplan/test/tripAccommodationDialog.test.tsx` -- `selectTab` `:21`, `costField()` `:32`, split-payment case `:353` typing `"100.00"` at `:393`. Real MUI, not mocked.
- `travelplan/test/tripDayPlanDialog.test.tsx` -- `vi.mock("@mui/material")` `:34-311` (its `TextField` stub spreads `slotProps.htmlInput` and `...rest` onto a real `<input>`, so attributes are assertable); `selectTab` `:390-402`; `costField()` `:442`; the `"26,00"` case `:618` and `:738` — both against the field that already worked.
- `travelplan/test/travelSegmentDialog.test.tsx` -- `stubSaveFetch` `:412`, `saveCallBody` `:1119`, the `["0","-3"]` distance case `:794`. No comma case anywhere.
- `travelplan/test/i18nDictionaries.test.ts:25` -- key parity between the dictionaries.
- `travelplan/vitest.config.ts:9` -- `environment: "node"`; jsdom is opt-in per file via a line-1 comment.

## Tasks & Acceptance

**Execution:**
- [x] `travelplan/src/lib/trips/parseAmount.ts` -- create; export `parseAmountToCents`, `parseDecimal`, `normalizeDecimalInput` and `formatCentsAsAmount`. Move `TripDayPlanDialog:430-458`'s body **verbatim** as the starting point, then factor the separator resolution out as `normalizeDecimalInput` so the money and distance paths share it. Docblock in this repo's voice: the 2026-08-05 phone report, `formatCost` as the inverse, and last-separator-wins as what makes `1.234,50` and `1,234.50` both parse. -- one owner, so the next numeric field copies from somewhere correct.
- [x] `travelplan/src/components/features/trips/TripDayPlanDialog.tsx` -- delete `formatCentsAsAmount` and `parseAmountToCents`, import from the shared module; payment amount → `type="text"`, `htmlInput: { readOnly: paymentMode !== "split", inputMode: "decimal" }` (`min`/`step` gone); destructure `language` from `useI18n` and make the cost placeholder `0,00` under `de`; leave the activity cost field otherwise untouched. -- it is the reference field and must not regress.
- [x] `travelplan/src/components/features/trips/TripDayPlanDialog.tsx` -- payment-row validation (`:1199-1211`): a filled-but-unparseable amount reports `trips.payments.amountInvalid`, an empty one keeps `trips.payments.amountRequired`. -- "required" is false copy for a box the user can see is full.
- [x] `travelplan/src/components/features/trips/TripAccommodationDialog.tsx` -- delete `formatCents` and the local `parseAmountToCents`, import the shared ones, and replace the two inline `(x/100).toFixed(2)` copies with `formatCentsAsAmount`; `costRules.validate` routes through `parseAmountToCents` (empty → `true`; `null` → `trips.stay.costInvalid`; `> maxCostCents` → `trips.stay.costTooHigh`) with the `^\d+(\.\d{1,2})?$` regex **removed**, not kept alongside; same `amountInvalid`/`amountRequired` split as the plan dialog. -- keeping both gates would fail exactly the input this story exists to accept.
- [x] `travelplan/src/components/features/trips/TripAccommodationDialog.tsx` -- stay cost → `type="text"`, `htmlInput: { inputMode: "decimal" }`, `hint={t("trips.stay.costHelper")}`, locale-aware placeholder; payment amount → same change **keeping** `readOnly: paymentMode !== "split"`. -- `language` is already destructured at `:379`.
- [x] `travelplan/src/components/features/trips/TripDayTravelSegmentDialog.tsx` -- distance → `type="text"` with `slotProps={{ htmlInput: { inputMode: "decimal" } }}`, dropping `inputProps={{ min: 0, step: "0.1" }}`; both `validate()` (`:398`, `:407`) and the request body (`:529-539`) go through `parseDecimal` instead of `Number.parseFloat`. Extend the 6.18 docblock, or add a sibling comment at the distance field, recording that the fix it argued for now covers this field too. -- `Number.parseFloat("12,5")` returns `12`, so on a text input the old call would newly and silently truncate.
- [x] `travelplan/src/i18n/de.ts`, `travelplan/src/i18n/en.ts` -- rewrite `trips.stay.costHelper` to name the accepted forms in `trips.plan.costHelper`'s shape, keeping "optional"; add `trips.payments.amountInvalid`. -- two dictionaries, always in step.
- [x] `travelplan/test/parseAmount.test.ts` -- new node-environment suite covering every row of the I/O matrix, including that `parseDecimal` does not cap decimals and does not multiply by 100.
- [x] `travelplan/test/tripAccommodationDialog.test.tsx` -- `12,50` into the stay cost field asserts `costCents: 1250` in the request body; `100,00` split into `50,00` + `50,00` saves; `"abc"` shows `trips.stay.costInvalid` and blocks the save; the `:353` split-mismatch case stays byte-identical.
- [x] `travelplan/test/tripDayPlanDialog.test.tsx` -- the payment-amount row accepts a comma; the `:618`/`:738` cost cases stay untouched.
- [x] `travelplan/test/travelSegmentDialog.test.tsx` -- `12,5` km saves as `12.5` and produces no `distanceRequired`; the `["0","-3"]` case at `:794` stays untouched.
- [x] all four dialog/parser test files -- for each of the five fields, assert the rendered input carries `type="text"` and the lowercase DOM attribute `inputmode="decimal"`.

**Acceptance Criteria:**
- Given a German user on any of the five fields, when they type a comma decimal and save, then the value reaching the API is the same integer cents (or float km) a period would have produced, and the activity cost field that already worked still does.
- Given a filled but unparseable amount, when the user saves, then a visible field error appears, the save is blocked, and nothing is written — it never falls through to "empty means no cost".
- Given an empty cost field, when the user saves, then it remains valid and means "no cost", exactly as today.
- Given the stay cost field is rendered, when its helper line is read, then it names the accepted forms in both languages and the previously orphaned `trips.stay.costHelper` key is the one rendering.
- Given `de` is active, when either cost field is empty, then its placeholder reads `0,00`; under `en` it reads `0.00`.
- Given a search of `src/`, when `parseAmountToCents` is grepped, then exactly one implementation exists and it lives in `src/lib/trips/`.
- Given the four server-side suites in Verification, when they run unmodified, then all pass and `git diff --stat` over those four files is empty.

## Spec Change Log

## Review Triage Log

### 2026-08-07 — Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 0, medium 2, low 2)
- defer: 5: (high 0, medium 1, low 4)
- reject: 9: (high 0, medium 0, low 9)
- addressed_findings:
  - `[medium]` `[patch]` `normalizeDecimalInput` stripped **all** whitespace, so `"12 50"` welded into `1250` and would have saved a hundred times the price with no error — this story's own defect in another key, and newly reachable on four more fields. The strip is now limited to whitespace standing where a thousands separator stands (a digit, whitespace, then exactly three digits); anything else survives into the caller's gate and is rejected visibly. Three new parser cases pin it, plus `"1 234 567,89"` for the multi-group form.
  - `[medium]` `[patch]` The travel-segment **required**-distance branch answered `distanceRequired` for a filled-but-unparseable value — the same lie the diff had just removed from the payment rows. Split into empty → `distanceRequired`, filled-but-unusable → the new `trips.travelSegment.distancePositive` in both dictionaries, with a case asserting `abc` no longer reports "required".
  - `[low]` `[patch]` `trips.stay.costInvalid` and `trips.plan.costInvalid` named only the two-decimal cap, so the widened set of now-reachable rejections (`abc`, `1,234`) was answered with a message about decimals. Both reworded in both dictionaries to name the accepted forms; the two assertions pinning the old strings were updated, not weakened. Also removes the pre-existing `gueltigen` typo in the German plan string.
  - `[low]` `[patch]` The German case asserted only copy, so no test saved a comma under the dictionary the bug was actually reported in. Extended to type `12,50` and assert `costCents: 1250` under `de`.

## Design Notes

**Module shape** (AC3a's choice, made here): `parseAmount.ts` **beside** `formatCost.ts`, not a merged
`money.ts`. Merging would rewrite the import in `TripsDashboard.tsx` and `TripCostOverview.tsx` for no
behavioural gain, and `parseAmount` also serves a non-money caller (distance), which a file called
`money.ts` would misname.

```ts
/** Resolves the decimal separator; last one wins, so 1.234,50 and 1,234.50 both work. */
const normalizeDecimalInput = (raw: string): string | null => { … } // → "1234.50" | null
export const parseAmountToCents = (raw: string) => { /* normalize, ^\d+(\.\d{1,2})?$, ×100, round */ };
export const parseDecimal = (raw: string) => { /* normalize, ^\d+(\.\d+)?$, Number.parseFloat */ };
```

**Why `parseDecimal` and not `parseAmountToCents` for distance** (AC4): the money parser rounds to two
decimals and multiplies by 100. Distance keeps whatever precision was typed — `step: "0.1"` implied one
decimal but nothing ever enforced it (the comment at `:403-406` says so), so leaving it uncapped is the
change-nothing option and is what this story takes.

**Why the payment rows get a new key.** Today an unparseable payment amount is indistinguishable from an
empty one, because `type="number"` delivered both as `""` — so one message covered both. After the type
change they are two states, and answering "Payment amount is required" to a box the user can see
contains `abc` is the same class of lie AC5 removes from the helper text. Two rendered keys, both tested.

**Why the stay helper gains a `hint` prop.** `trips.stay.costHelper` is in both dictionaries and rendered
nowhere — the orphan-key defect Story 5.11's review found, sitting in the exact field this story is about.
Rewriting the string without rendering it would leave the promise unkept.

**jsdom is load-bearing and partial.** `fireEvent.change` on a `type="number"` input with `"26,00"` yields
`value === ""` in jsdom exactly as in a browser, so a test asserting the saved value fails today and passes
after the fix — that is the shape every new behavioural case must take. jsdom does **not** model
`validity.badInput`, which is why nothing may read or assert it, and why the attribute assertions exist:
they are the only thing that catches a future refactor putting `type="number"` back.

## Verification

**Commands:** (all in `travelplan/`)
- `npx vitest run test/parseAmount.test.ts` -- expected: all green.
- `npx vitest run test/tripAccommodationDialog.test.tsx test/tripDayPlanDialog.test.tsx test/travelSegmentDialog.test.tsx test/i18nDictionaries.test.ts` -- expected: all green, no existing case modified.
- `npx vitest run test/accommodationSchemas.test.ts test/dayPlanItemSchemas.test.ts test/tripAccommodationRoute.test.ts test/tripDayPlanItemsRoute.test.ts` -- expected: green **and** `git diff --stat` over those four files empty. If any needs an edit, Block If has triggered.
- `npm test` -- expected: at or above the 1417-test / 120-file baseline, zero failures.
- `npx tsc --noEmit` -- expected: 0 `src` errors; test-side errors at or below the 143 baseline.
- `npm run lint` -- expected: at or below 85 problems / 2 errors.
- `npm run check:migrations` -- expected: pass (this story adds none).
- `npm run audit:check` -- expected: unchanged 1 pre-existing high; `package-lock.json` byte-identical.
- `grep -rn "parseAmountToCents\|formatCentsAsAmount\|formatCents\b" src/` -- expected: definitions only in `src/lib/trips/parseAmount.ts`.
- `grep -rn "badInput" src/ test/` -- expected: no hits.

**Manual checks (if no CLI):**
- Before implementing, run the new `12,50` stay-cost case against unmodified code and confirm it **fails**; record the observed value in the Completion Notes (AC8a).
- **Operator-only (Task 7 of the story, cannot be done by an agent):** a real German-language phone is the
  only surface that exercises the keyboard layout this bug lives in. Enumerated under `operator_actions`.

## Auto Run Result

Status: `awaiting-operator`. No blocking condition — everything an agent can do is done, committed as
`da25d1d`, and only Task 7's real-German-phone pass remains. That pass is enumerated under
`operator_actions` in the frontmatter.

**What changed.** A comma typed on a German keyboard never reached React: four inputs were
`type="number"`, so the browser called the comma `badInput` and handed the handler `""`, and the two
money fields whose validation reads empty as "no price" saved with no cost at all, silently. The
comma-aware parser that already lived one field deep in `TripDayPlanDialog` moved to
`src/lib/trips/parseAmount.ts`, beside its inverse `formatCost.ts`, and is now the only implementation
— both local copies are gone. The four fields left behind became `type="text"` + `inputMode="decimal"`,
and validation learned to tell an empty box from an unusable one.

**Files changed**

- `travelplan/src/lib/trips/parseAmount.ts` — **new.** `normalizeDecimalInput`, `parseAmountToCents`, `parseDecimal`, `formatCentsAsAmount`.
- `travelplan/src/components/features/trips/TripAccommodationDialog.tsx` — two local helpers deleted; `costRules` routes through the parser with its regex removed; stay cost and payment amount become decimal text inputs; the orphaned `trips.stay.costHelper` is finally rendered.
- `travelplan/src/components/features/trips/TripDayPlanDialog.tsx` — two local helpers deleted; payment amount becomes a decimal text input; locale-aware cost placeholder; payment rows distinguish missing from invalid.
- `travelplan/src/components/features/trips/TripDayTravelSegmentDialog.tsx` — distance becomes a decimal text input and goes through `parseDecimal` in both `validate()` and the request body; the file stops mixing `inputProps` with `slotProps`.
- `travelplan/src/i18n/de.ts`, `travelplan/src/i18n/en.ts` — `trips.stay.costHelper` and both `costInvalid` strings reworded; `trips.payments.amountInvalid` and `trips.travelSegment.distancePositive` added.
- `travelplan/test/parseAmount.test.ts` — **new**, 18 cases over the I/O matrix.
- `travelplan/test/tripAccommodationDialog.test.tsx`, `tripDayPlanDialog.test.tsx`, `travelSegmentDialog.test.tsx` — 14 new cases, including a `type`/`inputmode` assertion on each of the five fields.

**Review.** 0 intent_gap, 0 bad_spec, 4 patches applied, 5 deferred, 9 rejected. Details in the Review
Triage Log; deferred entries are in [deferred-work.md](deferred-work.md).

**Verification.** `npm test` 1699 passed / 130 files (baseline at `b759ec3` was 1667/129 — the spec's
1417/120 figure was measured four stories earlier and is stale). `npx tsc --noEmit` 0 `src` errors, 135
test-side against a 143 baseline. `npm run lint` 85 problems / 2 errors, exactly baseline.
`npm run check:migrations` passed. `npm run audit:check` unchanged at 1 pre-existing high.
The four server-side suites passed **unmodified** and `git diff --stat` over them was empty, so the
Block If never triggered. AC8a's red test was observed before the fix: the `12,50` stay-cost case
failed with `expected null to be 1250` — `costCents` arrived as `null`, which is the reported defect
rather than an error.

**Follow-up review recommended: true.** The review pass introduced new parser logic — the
thousands-position whitespace rule — and split a validation branch, neither of which has been through
an independent pass. Two of the four patches were medium-consequence silent-data or misleading-message
paths of exactly the class this story exists to remove.

**Residual risks.** No test can type on a German keyboard, so the keyboard layout itself — the surface
the bug was reported on — is unverified until the operator pass runs. jsdom does not model
`validity.badInput`, which is why nothing reads or asserts it and why the per-field `type`/`inputmode`
assertions exist. The distance-grouping ambiguity (`1,000` km read as 1 km) is deferred rather than
patched, because no rule separates it from `12,555`, which the intent contract requires to parse.
