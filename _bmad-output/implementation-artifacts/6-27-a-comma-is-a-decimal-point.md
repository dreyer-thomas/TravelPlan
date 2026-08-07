---
authored_against: 3be7c37
baseline_commit: 3be7c37
---

# Story 6.27: A Comma Is a Decimal Point

Status: awaiting-operator

## ⚠️ Read before Task 1 — this is a silent-data-loss bug, not an input annoyance

**Reported from a real German phone on 2026-08-05:** editing an accommodation, typing `12,50` into the
cost field. The keyboard offers a comma, the field refuses it, and a period cannot be typed at all.

**What actually happens is worse than a refusal.** The chain, verified in the source:

1. `TripAccommodationDialog.tsx:1620-1621` sets `type="number"` **and** `inputMode: "decimal"`. Those
   two contradict each other: `inputMode="decimal"` is what asks a German keyboard for a comma, and
   `type="number"` is what rejects it — HTML requires a `.` for a valid floating-point value.
2. On `badInput` a browser reports `value === ""`. The comma never reaches React.
3. `costRules.validate` (`:707-708`) opens with `if (!trimmed) return true` — an empty cost is legal,
   because "no price" is a real state. **So no error is shown.**
4. `parseAmountToCents` (`:298-305`) tests `^\d+(\.\d{1,2})?$` and returns `null`.

Net effect: the stay saves with **no cost at all**, silently, while the field looked filled. The user
gets no error and no hint that anything was dropped. This story's first job is that this can never
again happen quietly.

**The fix already exists in this repo, one field deep.** `TripDayPlanDialog`'s *activity cost* field is
already `type="text"` + `inputMode="decimal"` (`:1980-1981`) and has a parser that handles comma, dot
and thousands separators (`:409-437`). A comma works there. It was never propagated, and four fields
were left behind:

| Field | `type` today | Comma on a phone |
|---|---|---|
| Activity → Cost (`TripDayPlanDialog:1980`) | `text` + `decimal` | ✅ works — **the model to copy** |
| Activity → Payment amount (`TripDayPlanDialog:2027`) | `number` | ❌ |
| **Stay → Cost (`TripAccommodationDialog:1620`)** | `number` | ❌ **the reported bug** |
| Stay → Payment amount (`TripAccommodationDialog:1660`) | `number` | ❌ |
| Travel segment → Distance km (`TripDayTravelSegmentDialog:725`) | `number` | ❌ |

**Two facts that make this embarrassing rather than merely broken, and both belong in the story's own
justification:**

- **The app already promises comma support in its own copy.** `de.ts:486`
  `"trips.plan.costHelper": "Optionaler Betrag (z. B. 10,00 oder 10.00)"` — and `en.ts:523` says the
  same. That promise is kept at exactly one of the five fields. `trips.stay.costHelper` (`de.ts:545`)
  makes no promise, which is the only reason the stay field is not also lying.
- **The repo already documented this exact bug class and then did not apply the lesson.**
  `TripDayTravelSegmentDialog.tsx:652-660` carries a docblock from Story 6.18 that names it precisely:
  *"a comma-decimal typed on a German keyboard both look filled on screen and arrive here empty, which
  the empty-box-means-zero rule below would then save as a silent zero."* That reasoning was applied to
  the duration fields in that same file — and **not** to the distance field twenty lines below it.

**Out of scope:** currency selection (EUR is hardcoded app-wide, recorded as deferred work), the
`formatCost`/`TripTimeline`/`TripDayView` formatter duplication (recorded in `deferred-work.md`, owned
by whichever story next touches those screens), and any server-side schema change — see AC6.

## Story

As a traveller entering prices on my phone in German,
I want the comma my keyboard gives me to be accepted as the decimal separator,
so that a price I typed is the price that gets saved, and nothing is dropped without telling me.

**FRs covered:** None new. This repairs already-shipped behaviour across Epic 2's budget fields
(Stories 2.6, 2.8, 2.19) and Epic 6's dialog work (6.17, 6.18, 6.22, 6.26), and closes the gap between
`trips.plan.costHelper`'s promise and four fields that do not keep it.

## Acceptance Criteria

1. **A comma is accepted as the decimal separator in every money and decimal field.** `12,50`,
   `12.50`, `12`, and `1.234,50` / `1,234.50` all reach the server as the same integer cent value they
   would have if typed with a period. This holds for all five fields in the table above — the four
   broken ones and the one that already works, which must not regress.

   1a. **`type="number"` is the root cause and has to go, not just be paired with better parsing.** A
   parser cannot fix this: with `type="number"` the browser hands the handler `""` and the comma is
   gone before any code runs. Each of the four fields becomes `type="text"` with
   `inputMode="decimal"` — `inputMode` is what actually narrows the phone keyboard, and it is already
   what the working field uses. Remove `min: 0` and `step: 0.01` from those `htmlInput` objects at the
   same time: both are inert on a text input and leaving them behind implies a validation that is no
   longer there.

   1b. **`readOnly: paymentMode !== "split"` must be preserved** on both payment-amount fields
   (`TripAccommodationDialog:1662`, `TripDayPlanDialog:2029`). It is what stops the single-payment row
   being edited directly, and it is unrelated to the `type` change. Dropping it would let a user edit
   a total that is supposed to mirror the cost field.

2. **Nothing is ever saved silently different from what was typed.** An unparseable amount produces a
   **visible field error** and blocks the save; it must not fall through to "empty means no cost".

   2a. **The empty-versus-invalid distinction is the substance of this AC.** Today `costRules` treats
   both as valid, because with `type="number"` they were indistinguishable — invalid input *arrived*
   as empty. Once the field is `type="text"`, `"abc"` and `"12,,5"` arrive intact and must be rejected
   with `trips.stay.costInvalid`, while `""` stays valid and means "no cost". These are now two
   different states and the code must treat them as two.

3. **One parser, in one place.** The comma-aware parser currently living in `TripDayPlanDialog`
   (`:409-437`) moves to `src/lib/trips/` and becomes the single implementation. Both dialogs' local
   copies are deleted — `TripAccommodationDialog`'s (`:298-305`) is the weaker one and disappears
   entirely rather than being patched in place.

   3a. **It belongs beside `formatCost.ts`, which is the same subject in the other direction.**
   `formatCost` renders cents to a locale string; this parses a locale string to cents. Name the module
   so that relationship is obvious (`parseAmount.ts` alongside `formatCost.ts`, or fold both into one
   `money.ts` — the dev agent chooses, but the two must sit together and the choice must be stated in
   the Completion Notes).

   3b. **Do not weaken the parser while moving it.** It currently handles the ambiguous
   both-separators case by treating whichever appears **last** as the decimal separator
   (`:418-422`), which is what makes `1.234,50` and `1,234.50` both work. Keep that. It also strips
   whitespace (`:413`), which matters because a phone keyboard's number row can insert a thin space.

4. **The distance field is the same bug with a different symptom, and is fixed with the same change.**
   `TripDayTravelSegmentDialog:725` is `type="number"` with `step: 0.1`. `12,5` km arrives empty, and
   because `validate()` then reports `trips.travelSegment.distanceRequired` (`:398-400`), the user at
   least *sees* an error — so this one loses data less quietly than the money fields, but it still
   refuses a legitimate value. `Number.parseFloat(distanceKm)` at `:398` must go through the shared
   parser's decimal normalisation, **not** through `parseAmountToCents` — a distance is not money and
   must not be rounded to two decimals or multiplied by 100. Export a normalisation helper the two
   can share, or a separate `parseDecimal`; state which in the Completion Notes.

5. **The helper text stops lying and starts helping.** `trips.stay.costHelper` currently says only
   `"Betrag eingeben (optional)"`. Bring the two cost helpers into line so both name the accepted
   forms the way `trips.plan.costHelper` already does, in **both** `de.ts` and `en.ts`.

   5a. **The `placeholder="0.00"` is wrong in German** (`TripAccommodationDialog:1622`,
   `TripDayPlanDialog:1982`). It should render `0,00` under `de`. The dialogs already have `language`
   available for `formatCost`; use it rather than hardcoding. This is small and it is the first thing a
   German user sees telling them which separator the field wants.

6. **No server-side or schema change, verified rather than assumed.** `accommodationSchemas.ts:52` and
   `dayPlanItemSchemas.ts:101` take `costCents` as a non-negative integer, and the API contract is
   cents — so the whole of this story is client-side parsing and input type. Confirm by running the
   existing schema and route suites unmodified: `accommodationSchemas.test.ts`,
   `dayPlanItemSchemas.test.ts`, `tripAccommodationRoute.test.ts`, `tripDayPlanItemsRoute.test.ts`. If
   any needs an edit, something changed that should not have.

7. **The split-payment total check keeps working in both dialogs.** Payments must still add up to the
   cost, and the existing assertion for it must pass unmodified —
   `tripAccommodationDialog.test.tsx:352` (`"blocks save when split payments do not match the total
   cost"`) types `100.00` into the cost field at `:392`. With comma parsing in place, a `100,00` total
   split into `50,00` + `50,00` must also validate. Add that as a case; do not change the existing one.

8. **Every field is tested with a comma, and the tests can actually fail.** See AC8a for why this is
   the criterion most likely to be satisfied dishonestly.

   8a. **A jsdom test *can* reproduce this bug — verified — but only if it asserts the saved value.**
   Measured while writing this story: in jsdom, `fireEvent.change` on a `type="number"` input with
   `"26,00"` yields `value === ""`, exactly as a real browser does. So a test that types `12,50` into
   the stay cost field and asserts `requestBody.costCents === 1250` **fails against today's code** and
   passes after the fix. That is the shape every new case must take.
   **What jsdom does *not* reproduce is `validity.badInput`** — it stays `false` where a real browser
   sets it `true`. So no implementation may depend on reading `badInput`, and no test may assert it.
   **And the trap that let this bug survive:** `tripDayPlanDialog.test.tsx:520` already types `"26,00"`
   and asserts `2600` — but against the *activity cost* field, the one field that was already
   `type="text"`. The comma path was tested exactly where it already worked. Do not add the new cases
   only where they will pass.

   8b. **Assert the attributes too, not only the behaviour.** Because jsdom's sanitisation is the only
   thing standing between a passing test and a broken phone, each of the five fields gets a direct
   assertion that its rendered input carries `type="text"` and `inputMode="decimal"`. Without it, a
   future refactor that puts `type="number"` back would break every German phone while the
   behavioural tests — which would then receive `""` and could be made to pass by re-adding
   "empty is valid" — might not catch it.

9. **The two dialogs' cost fields behave identically.** They are the same control on two surfaces, and
   after this story a user cannot tell them apart by what they accept. `tripAccommodationDialog.test.tsx:32`
   and `tripDayPlanDialog.test.tsx:407` already carry byte-identical `costField()` helpers with a
   comment saying so; the parity is asserted, not assumed.

## Tasks / Subtasks

- [ ] **Task 1 — Extract the shared parser** (AC: 3, 3a, 3b, 4)
  - [ ] Create the new module in `src/lib/trips/`, beside `formatCost.ts`. Move
        `parseAmountToCents` from `TripDayPlanDialog.tsx:409-437` **verbatim** first, then add the
        decimal-only helper AC4 needs. Do not rewrite the separator logic while moving it.
  - [ ] Write the module docblock in this repo's voice: why a comma-aware parser exists at all (the
        2026-08-05 phone report), that `formatCost` is its inverse, and the one-sentence version of
        AC3b — last-separator-wins is what makes `1.234,50` and `1,234.50` both parse.
  - [ ] Delete `TripAccommodationDialog.tsx:298-305`'s `parseAmountToCents` and point its call sites
        at the shared one. Delete `TripDayPlanDialog.tsx:409-437` likewise. **Two copies go away; none
        is left behind as a "temporary" fallback.**
  - [ ] `formatCents` (`TripAccommodationDialog:296`) and `formatCentsAsAmount`
        (`TripDayPlanDialog:407`) are the same one-liner under two names. Fold them in too while the
        module is open — they are the read path for the fields being changed.

- [ ] **Task 2 — Fix the four fields** (AC: 1, 1a, 1b)
  - [ ] `TripAccommodationDialog.tsx:1620-1621` — cost. `type="text"`,
        `slotProps={{ htmlInput: { inputMode: "decimal" } }}`. `min`/`step` removed.
  - [ ] `TripAccommodationDialog.tsx:1660-1663` — payment amount. Same change, **keeping**
        `readOnly: paymentMode !== "split"`.
  - [ ] `TripDayPlanDialog.tsx:2027-2030` — payment amount. Same, same `readOnly` preserved.
  - [ ] `TripDayTravelSegmentDialog.tsx:725-728` — distance. `type="text"`,
        `inputMode="decimal"`, drop `inputProps={{ min: 0, step: "0.1" }}`. Note this file uses the
        older `inputProps` spelling rather than `slotProps.htmlInput`; match whichever the surrounding
        file uses rather than mixing both in one component.
  - [ ] Leave `TripDayPlanDialog.tsx:1980-1981` alone. It is already correct and is the reference.

- [ ] **Task 3 — Validation tells the truth** (AC: 2, 2a)
  - [ ] `costRules.validate` (`TripAccommodationDialog:704-724`): route through the shared parser.
        Empty → valid. Unparseable → `t("trips.stay.costInvalid")`. Over `maxCostCents` (`:703`,
        `100000000`) → `t("trips.stay.costTooHigh")`. The `^\d+(\.\d{1,2})?$` regex at `:709` is
        replaced by the parser's own judgement — do not keep both, or a comma passes one and fails the
        other.
  - [ ] Do the same for the payment-amount rows in both dialogs, and for
        `TripDayTravelSegmentDialog`'s `distanceKm` branch (`:390-400`).
  - [ ] Re-check the day-plan dialog's `fieldErrors.costCents` path — it has its own validation
        separate from `react-hook-form`; both dialogs must end up rejecting the same strings.

- [ ] **Task 4 — Copy and placeholders** (AC: 5, 5a)
  - [ ] `trips.stay.costHelper` in `de.ts:545` and `en.ts:593`: name the accepted forms, matching
        `trips.plan.costHelper`'s existing shape. Keep "optional" — it is true and load-bearing.
  - [ ] Locale-aware placeholder for both cost fields (`0,00` under `de`, `0.00` under `en`).
  - [ ] **Do not add a new dictionary key if an existing one fits.** Story 8.3's notes record that
        this repo's stories usually touch both dictionaries; a story that adds keys nobody renders is
        a recorded past mistake.

- [ ] **Task 5 — Tests** (AC: 1, 2, 7, 8, 8a, 8b, 9)
  - [ ] `test/` gets a unit suite for the new parser module: `12,50`, `12.50`, `12`, `1.234,50`,
        `1,234.50`, `0`, `""` → null, `"abc"` → null, `"12,,5"` → null, `"-1"` → null, `"12,555"` →
        null (three decimals), and a value above `maxCostCents`. Plus the decimal (non-money) helper
        AC4 needs, including that it does **not** round to two places.
  - [ ] `tripAccommodationDialog.test.tsx`: type `12,50` into the cost field and assert the request
        body carries `costCents: 1250`. **Run it before the fix and confirm it fails** — record that in
        the Completion Notes, per AC8a.
  - [ ] The split case from AC7: `100,00` total, `50,00` + `50,00` rows, saves. And the existing
        `:352` case passes unmodified.
  - [ ] `travelSegmentDialog.test.tsx`: `12,5` km saves as `12.5`, and does **not** produce
        `distanceRequired`.
  - [ ] `tripDayPlanDialog.test.tsx`: the payment-amount row accepts a comma. Leave the existing
        `:520` cost case untouched — it is the one that already passed and is now the parity anchor.
  - [ ] AC8b's attribute assertions: for each of the five fields, `toHaveAttribute("type", "text")`
        and `toHaveAttribute("inputmode", "decimal")`. Note the DOM attribute is lowercase
        `inputmode` even though the React prop is `inputMode`.
  - [ ] Do not weaken any existing assertion to make a new one pass. Story 5.11's review found four
        test weaknesses that each let a real defect through.

- [ ] **Task 6 — Confirm the server is untouched** (AC: 6)
  - [ ] Run `accommodationSchemas.test.ts`, `dayPlanItemSchemas.test.ts`,
        `tripAccommodationRoute.test.ts`, `tripDayPlanItemsRoute.test.ts` and confirm all pass
        **unmodified**. `git diff --stat` on those four files must be empty.

- [ ] **Task 7 — Phone check, on a real German keyboard** (AC: 1, 5a) — **must be operated by Tommy**
  - [ ] The bug was found on a phone and only a phone can confirm it is gone: the keyboard layout is
        the whole point, and neither jsdom nor a desktop browser reproduces it.
  - [ ] With the device language set to **German**, on all five fields: the numeric keypad appears, the
        comma key produces a comma, and the saved value is correct after reopening the dialog.
  - [ ] Confirm the placeholder shows `0,00` and the helper text names the accepted forms.
  - [ ] Confirm the payment-amount row is still **read-only** unless "split" is selected (AC1b).
  - [ ] Check one English-locale pass too: a period must still work, and nothing about the English
        keyboard changed.
  - [ ] Recipe for a safe throwaway environment in `7-12-bucket-list-sidebar-card.md`'s Dev Notes:
        copy of `dev.db`, isolated port, `MEDIA_STORAGE_ROOT` at a scratch directory — **never**
        `prisma/dev.db` and never the real media tree.

## Dev Notes

### Read these files before writing a line

| File | What it holds that you need |
|---|---|
| `src/components/features/trips/TripDayPlanDialog.tsx:409-437, 1980-1982, 2027-2030` | The parser to move, the field that already works, and the payment row that does not |
| `src/components/features/trips/TripAccommodationDialog.tsx:296-305, 703-724, 1615-1664` | The weaker parser, `costRules`, and both broken fields |
| `src/components/features/trips/TripDayTravelSegmentDialog.tsx:647-733` | Story 6.18's docblock naming this exact bug, and the distance field it was not applied to |
| `src/components/forms/FormField.tsx` | Spreads `...rest` straight into MUI's `TextField`, so `type` and `slotProps` pass through untouched — no change needed here |
| `src/lib/trips/formatCost.ts` | The inverse operation and the module the new one sits beside |
| `src/i18n/de.ts:486, 545-547` and `en.ts:523, 593-595` | The helper text that already promises comma support, and the one that does not |
| `test/tripDayPlanDialog.test.tsx:389-390, 407, 519-542` | The `"26,00"` case that already passes, the `costField()` helper, and the tab-selection harness |
| `test/tripAccommodationDialog.test.tsx:28-32, 352-408` | The byte-identical `costField()` helper and the split-payment total case that must not change |
| `src/lib/validation/accommodationSchemas.ts:52-90`, `dayPlanItemSchemas.ts:101` | The server contract: integer cents. Confirms AC6 needs no change |

### Architecture compliance

- **Stack, pinned.** Next 16.2.12 (App Router), React 19.2.3, MUI 7.3.8 + Emotion, Zod 4.1,
  Vitest 3.2. **No new dependency** — this is `String.prototype.replace` and `Number.parseFloat`.
  Resist reaching for `Intl.NumberFormat.formatToParts` to derive the separator: the parser must accept
  **both** separators regardless of locale, because a German user on an English-locale browser still
  has a comma on their keyboard. Locale decides how a value is *rendered* (`formatCost`), never what is
  *accepted*.
- **`components/forms/*` is where form components live** (`architecture.md:399-402`); the new module is
  a pure function and belongs in `src/lib/trips/`, not there.
- **Dialog tests are jsdom, per-file.** Every one starts with `// @vitest-environment jsdom` — the
  suite default is `environment: "node"` (`vitest.config.ts:9`). A new `.test.tsx` without that first
  line fails in a way that looks like a React problem.
- **Fields are addressed through `getByLabelText`,** because `FormField`'s `htmlFor`/`id` pair *is* the
  accessible name and there is no floating label. Uppercase comes from CSS, so the i18n string is what
  the query matches.
- **Lint baseline is 85 problems / 2 pre-existing errors.** Do not let it grow.

### Anti-patterns this story is most likely to hit

1. **Fixing the parser and leaving `type="number"`.** The most likely wrong outcome, because the
   parser change is the satisfying part and it makes unit tests pass. The comma still never arrives.
   AC1a exists for this.
2. **Adding comma handling to `TripAccommodationDialog`'s local parser** instead of deleting it. Then
   there are three parsers and the next field to be added copies whichever is nearest.
3. **Keeping the `^\d+(\.\d{1,2})?$` regex alongside the parser.** A comma passes the parser and fails
   the regex, so the field rejects exactly the input this story exists to accept.
4. **Losing `readOnly: paymentMode !== "split"`** while rewriting the `htmlInput` object.
5. **Running `parseAmountToCents` on the distance field.** It rounds to two decimals and multiplies by
   100. A distance is not money.
6. **Testing the comma only where it already worked** — the activity cost field. AC8a.
7. **Asserting `validity.badInput`.** jsdom reports `false` where browsers report `true`; a test built
   on it proves nothing and passes for the wrong reason.
8. **Deriving the accepted separator from the locale.** A German keyboard on an `en-US` browser still
   sends a comma. Accept both, always.
9. **Treating an unparseable amount as empty.** That is precisely today's bug, and after AC1a's change
   it becomes reachable with visible input — so it must become an error, not a silent zero.
10. **Uppercasing an i18n string** for the label. CSS does that; `getByLabelText` matches
    `textContent`.
11. **Adding a dictionary key nothing renders.** Story 5.11's review found a green test defending
    exactly that.

### Previous work intelligence

- **Story 6.18 ("one way to enter a time") is the direct precedent and the reason this bug is
  documented but unfixed.** Its docblock at `TripDayTravelSegmentDialog.tsx:652-660` names the German
  comma-decimal failure and the empty-box-means-zero consequence, and its fix — `type="text"` +
  `inputMode` — is exactly what this story propagates. It applied that fix to the duration fields and
  not to the distance field in the same file. Read that docblock before Task 2; it argues the case
  better than this story does, and it also records that **iOS's bare `type="number"` yields the
  numbers-and-punctuation keyboard**, which is why `inputMode` is the part that matters.
- **Story 6.26 restructured `TripAccommodationDialog` into tabs**, which is why the cost field now
  lives inside `activeTab === "cost"` (`:1604`). Tests must select the tab before the field exists —
  `tripDayPlanDialog.test.tsx:519` shows the `selectTab("cost")` idiom, and
  `tripAccommodationDialog.test.tsx` has its own equivalent.
- **Story 6.22 did the same for `TripDayPlanDialog`**, and its `costField()` helper is byte-identical
  to the accommodation one — the comment at `tripAccommodationDialog.test.tsx:28-31` says so
  explicitly. That duplication is the parity anchor AC9 leans on; do not deduplicate it as a
  side-quest.
- **Story 7.13 folded `TripCostOverview` into `formatCost.ts`** and recorded that `TripTimeline.tsx`
  and `TripDayView.tsx` still carry local copies of the formatter. That is *rendering*, not parsing,
  and stays out of scope — but it is why the new module belongs next to `formatCost.ts` rather than
  inventing a third location.
- **Story 8.3's review (2026-08-05) found that a jsdom/unit suite can be fully green while the real
  surface is broken**, because every test talked to the layer beneath the problem. The same shape of
  mistake is available here: jsdom sanitises `type="number"` but does not model `badInput`, and no
  test can type on a German keyboard. Hence Task 7.

### Git intelligence

`3be7c37` is HEAD and contains Story 8.3 plus its review patches — `uploadPaths.ts`, the new
`/uploads` route, `instrumentation.ts`, `mediaRootBoot.ts` and the deployment docs. **None of it
touches any file this story needs**, so every line reference here is current against HEAD. The three
dialogs were last changed by `a41e5b6` (6-26), `def8618` (6-25) and `4f806aa` (5-11).

Recent commits show the shape of a story in this repo: one or two components, both dictionaries, the
matching test files, plus `epics.md` / `sprint-status.yaml` / `deferred-work.md` bookkeeping. This
story matches that shape exactly — three components, one new lib module, both dictionaries, four test
files.

### Environment and gates

- All commands run in `travelplan/`.
- `npm test` — baseline **1417 tests / 120 files green**, measured at `3be7c37`, ~185 s.
- `npx tsc --noEmit` — 0 `src` errors; test-side errors have a 143 baseline.
- `npm run lint` — 85 problems / 2 errors baseline.
- `npm run audit:check` — 1 high, **pre-existing** (`GHSA-7p8r-x3mc-p8w7`, `fast-uri` via `prisma`);
  `package-lock.json` is byte-identical to baseline. Do not try to fix it here.
- `npm run check:migrations` — this story adds no migration; it must still pass.
- **`MEDIA_STORAGE_ROOT` now exists** (Story 8.3) and the server refuses to start in production
  without it. Irrelevant to this story's code, but Task 7's throwaway environment needs it set.

### Open questions for Tommy

1. **Module name.** `parseAmount.ts` beside `formatCost.ts`, or one `money.ts` holding both
   directions? AC3a leaves it to the dev agent; say now if you have a preference, it is a rename
   afterwards.
2. **Thousands separators in input.** The moved parser accepts `1.234,50`. Worth keeping, or is
   accepting only the plain forms simpler to reason about? Keeping it is free — the code exists and
   works — but it is the one part of the parser nobody asked for.
3. **The `distanceKm` decimal place.** `step: "0.1"` implied one decimal. The shared decimal helper
   will not enforce a limit unless told to. Cap it at one decimal, or leave it open?
4. **Bookkeeping:** this is a bug fix in an epic whose stories are all `done` and whose retrospective
   is `done`. Fine as 6-27, or would you rather it sat in its own maintenance epic?

### References

- [epics.md — Epic 6: Usability Refinements](../planning-artifacts/epics.md) (`:1403`) — the epic this
  extends; no existing story covers numeric input
- [6-18-one-way-to-enter-a-time.md](6-18-one-way-to-enter-a-time.md) — the precedent, and the docblock
  that names this bug
- [6-26-accommodation-dialog-in-tabs.md](6-26-accommodation-dialog-in-tabs.md) — why the cost field is
  behind a tab
- [6-22-activity-dialog-in-tabs.md](6-22-activity-dialog-in-tabs.md) — the same for the day-plan dialog
- [7-13-cost-overview-redesign.md](7-13-cost-overview-redesign.md) — `formatCost.ts`, the inverse
  operation
- [deferred-work.md](deferred-work.md) — the formatter duplication and the hardcoded-EUR entry, both
  out of scope here

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

## Change Log

## Operator Pass — 2026-08-07

Run by Tommy on a real German phone plus a desktop pass, against a throwaway copy of `dev.db` on an
isolated port (`MEDIA_STORAGE_ROOT` pointed at an empty scratch directory; the real database and the
303-file media tree were never opened). Every result below was read back out of the database rather
than taken from the screen.

| Field | Entered | Stored |
|---|---|---|
| Stay cost (the reported defect) | `120,50` | `cost_cents = 12050` |
| Stay payment amounts (split) | `60,50` / `60,00` | `6050` / `6000`, sum `12050`, difference `0` |
| Activity cost | `2,50` | `cost_cents = 250` |
| Travel-segment distance | `60,5` | `distance_km = 60.5` — **not** `60` |

The distance row is the one that would have regressed silently: `Number.parseFloat("12,5")` returns
`12`, so moving that field to `type="text"` without the shared parser would newly have truncated it.

**AC-by-AC:**

- German numeric keypad offers a comma under `inputMode="decimal"`, and the comma reaches React — the
  whole premise of the defect. **Confirmed on device.**
- Placeholder renders `0,00` under German and `0.00` under English; helper line names both forms.
  **Confirmed.**
- Payment rows stay read-only until *In mehrere Zahlungen aufteilen* is selected. **Confirmed.**
- Unparseable input is a visible, blocking error (`trips.stay.costInvalid`), not a silent save with no
  cost. **Confirmed** — this is the empty-versus-invalid distinction the story exists for.
- Dot-decimal input still works on all five fields. **Confirmed on desktop.**

**Not covered, stated rather than glossed:** the English-*device* keyboard was not exercised — no
English phone was at hand. What that leaves unverified is whether an English numeric keypad offers a
period, which is an OS keyboard property this story does not touch. The application-side path was
covered two ways instead: a parser table (`"60.5"` → `60.5`, `"1,234.50"` → `1234.5` / `123450`,
`"12000"` → `12000`) and a full desktop pass typing periods into all five fields.

**A defect in the instruction, not in the app:** operator action 6 asks for `abc` to be typed into the
cost field *on the phone*. That is not performable — `inputMode="decimal"` yields a keypad with no
letters, which is the measure working as intended. The case was produced on the desktop instead. The
wording should be corrected so the next operator pass does not stall on it; paste is the reachable
mobile path.

### Decisions taken

**Operator action 8 — numbering.** Stays `6.27`. The story file, spec, board, commits and ledger all
say 6.27, and the "closed epic" premise no longer holds: Epic 6 now carries 6.28 and 6.29. The missing
`epics.md` entry was written, so the file runs 6.26 → 6.27 → 6.28 → 6.29 without a gap.

**Operator action 9 — distance grouping.** **Cap `distanceKm` at one decimal.** Measured against the
parser rather than argued: a *lone* three-digit group is read as a fraction in **both** spellings —
`"1,000"` → `1` and `"1.000"` → `1`. Two separators are handled correctly (`"1.234,50"` → `1234.5`).
So "one thousand kilometres" silently becomes one kilometre, either way it is typed. A one-decimal cap
turns both into a visible refusal, and rejects `60,12345` with them. 100 m resolution is beyond what
trip planning uses. Tommy's words: *"wir sind 12000 km von zu Hause weg, da messe ich keine Meter"*.

Two consequences to carry into the follow-up: this contradicts the intent contract's current
requirement that `12,555` parse as a distance (a spec amendment, not a dev decision), and the cap also
rejects `1.234,50` km at two decimals — `1234,5` remains the way to write it.

**Raised during the pass, not yet decided.** `formatCentsAsAmount` writes `120.50` into the edit field
under every locale while the placeholder beside it renders `0,00`. It is deliberate and documented
(*"it stays dot-decimal because that is what an unedited round-trip must hand back"*), but that reason
is weaker after this story: the parser now accepts both, so a comma value round-trips too. No data is
at risk — it is a cosmetic inconsistency in a story whose whole subject is German number entry.
