---
baseline_commit: 075fc2ff20708bb3d2819b863d69cabb8286244b
---

# Story 10.1: A Price in Another Currency

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As someone planning a trip outside the euro area,
I want to type a price in the currency the booking site quoted,
so that I stop running every number through a converter in another tab before I can enter it.

## Acceptance Criteria

1. **Schema.** `Accommodation` and `DayPlanItem` each carry nullable `costOriginalAmount` (Int), `costCurrency` (String), `costRate` (Float) and `costRateDate` (String, `YYYY-MM-DD`); `CostPayment` carries a nullable `amountOriginal` (Int). One new migration, **no backfill** — `NULL` is the correct and complete description of every existing row.
2. **The schema cannot express two rates in one entry.** Currency and rate live only on the parent (`Accommodation` / `DayPlanItem`); the payment row carries only `amountOriginal`. There is no currency or rate column on `cost_payments`, and none is added.
3. **One selector per entry.** The accommodation dialog and the activity dialog each have exactly one currency selector, on the `cost` tab, governing that entry's cost field **and every one of its payment rows**. Payment rows render an amount input alone — no selector of their own. Options are EUR first, then the ECB codes from `ECB_CURRENCIES` in published order.
4. **EUR is the default and changes nothing.** With EUR selected: no rate request is issued, all five metadata columns are written `null`, and the stored `costCents` / `payments` are byte-for-byte what the same input stores today. Every existing test that saves a EUR cost passes unmodified.
5. **The payment-sum check runs in the entered currency, before conversion.** `sum(payment originals) === costOriginalAmount` is checked client-side on the typed values, and a mismatch reports `trips.payments.sumMismatch` against the numbers the user typed — never against converted cents.
6. **One rate per submit, and the EUR invariant holds by construction.** `costCents = Math.round(costOriginalAmount / rate)`; each payment converts by that **same** rate; the residual `costCents - sum(converted payments)` is added to the payment with the largest `amountOriginal`, ties broken toward the **last** such row. `sum(payments.amountCents) === costCents` is then satisfied without relaxing any server schema.
7. **Rate direction is stored as published and proved by a hand-checked figure.** ECB publishes units of foreign currency per **one euro**, so the operation is **division**. `costRate` stores the published number un-inverted. A test asserts one hand-checked end-to-end figure (`100,00 USD` at `1.1460` → `8726` cents); a round-trip-only test is not sufficient, because it passes with the direction reversed.
8. **Uniform hundredths storage.** `costOriginalAmount` and `amountOriginal` store the typed value × 100 regardless of the currency's ISO 4217 exponent — `¥5000` stores as `500000`. No exponent table is shipped.
9. **Failure degrades, never blocks.** On network error, non-200, unparseable XML, or a selected code absent from the fetched document: the field behaves as plain EUR entry with an inline notice. Never a blocking error, never a silent zero, never a `0` rate. The notice uses the caption slot in `{components.money-field.noticeColor}` with the small alert icon — **not** the `input` error border/background.
10. **The proxy caches.** `GET /api/exchange-rates` serves an in-process cached document; opening several dialogs in one session issues at most one outbound ECB request per TTL window. No weekend special case — the daily file keeps serving the last TARGET working day's rates with that `time` attached, and that value is what `costRateDate` records.
11. **Reopening shows what was typed, and an unchanged save changes nothing.** A foreign-currency entry reopens with its original amount and currency in the fields (not the EUR figure); saving with nothing edited writes back the identical `costCents`, `payments`, and all five metadata values — no re-fetch, no re-conversion at today's rate, no dropped receipt.
12. **Foreign amounts render through `Intl.NumberFormat`.** With the currency's own default fraction digits — never through `formatCentsAsAmount`, whose fixed two decimals and `=== "de"` separator shortcut are correct only for the EUR field it was written for. `¥5000` must not render `5000,00`.

    **Amended 2026-09-20, code review of this story.** This applies to amounts *displayed*, not to the editable boxes. A text input has to hold a string the user can type back and `parseAmountToCents` can read; `Intl`'s `5.000 ¥` is neither, so the cost box and the payment-row boxes keep `formatCentsAsAmount` and the currency is shown by the selector beside them. `formatForeignAmount` is the renderer for every display surface, and since 10.1 changes no display surface (see *Explicitly out of scope*), its first production caller arrives with **Story 10.2**. The `¥5000` case is held by `test/convertCost.test.ts` until then.
13. **Backup round trip.** All five columns survive export → import in the v2 archive (additive, no `formatVersion` bump), and `tripImportSchemas.ts`'s own `Payments must sum to costCents` check still passes on converted data.
14. **Both dictionaries.** Every new string exists in `en.ts` **and** `de.ts`. `test/i18nDictionaries.test.ts` already fails the build on a one-sided key — do not work around it.

### AC correction carried into this story

The epic and the 2026-09-20 sprint change proposal say "the ECB's **30**" currencies and "**31** options". **Verified against the live feed on 2026-09-20: the document carries 29 currencies.** `BGN` is gone (Bulgaria adopted the euro on 2026-01-01), as `HRK` went in 2023. The list is a moving target and **no test may pin its length**; `ECB_CURRENCIES` is a constant that may be edited later without breaking anything. AC3 is written against the constant, not against a count.

## Tasks / Subtasks

- [x] **Task 1 — Schema and migration (AC: 1, 2)**
  - [x] `prisma/schema.prisma`: add to **both** `Accommodation` and `DayPlanItem`:
        `costOriginalAmount Int? @map("cost_original_amount")`,
        `costCurrency String? @map("cost_currency")`,
        `costRate Float? @map("cost_rate")`,
        `costRateDate String? @map("cost_rate_date")`.
        Add to `CostPayment`: `amountOriginal Int? @map("amount_original")`. Place each beside the existing `costCents` / `amountCents` line.
  - [x] New folder `prisma/migrations/20260920120000_add_cost_currency_metadata/migration.sql` (name must match `^[0-9]{14}_[a-z0-9_]+$` — `scripts/check-migration-immutability.sh` enforces it, and it also fails if you touch any existing migration). Nine `ALTER TABLE … ADD COLUMN` statements, all nullable, **no DEFAULT, no UPDATE, no backfill**.
  - [x] Run `npx prisma generate` (it is the `postinstall` hook) so `src/generated/prisma/**` picks the columns up. Do not hand-edit `src/generated/`.

- [x] **Task 2 — Exchange-rate service (AC: 7, 9, 10)**
  - [x] New `src/lib/rates/exchangeRateService.ts`. Model it on `src/lib/routing/dayRouteService.ts` — same shape: injectable `fetchImpl = fetch`, `timeoutMs` with an `AbortController`, `cache: "no-store"`, a `"TravelPlan/0.1 exchange-rates"` `User-Agent`, and a typed error class.
  - [x] Export `ECB_CURRENCIES` — the 29 codes in ECB's published order (see Dev Notes for the verbatim list) — and `type EcbRates = { date: string; rates: Record<string, number> }`.
  - [x] Parse the XML **with a regex**, not a library: there is no XML parser in `package.json` and none is to be added (the whole point of this feed is "no new dependency"). The document's attributes use **single** quotes; accept both. Verbatim structure is in Dev Notes.
  - [x] Throw a typed `ExchangeRateError("rates_unavailable" | "rates_invalid_response", …)` on non-200, timeout, missing `time`, or zero parsed rows. Drop an individual `<Cube>` whose `rate` is not a finite positive number rather than failing the document (the per-row-drop rule `api/geocode/route.ts` already follows).
  - [x] In-process cache: a module-level `{ fetchedAtMs, value }` with a **30-minute** TTL. Cache successes only — never cache a failure, or one outage blackholes the feature for half an hour. Export a test-only reset so suites do not leak state across files (`fileParallelism: false`, one fork, so module state *does* persist between tests in a run).

- [x] **Task 3 — Proxy route (AC: 9, 10)**
  - [x] New `src/app/api/exchange-rates/route.ts`, `GET` only. Copy the auth shape from `src/app/api/geocode/route.ts`'s sibling pattern but use `requireSession(request)` from `@/lib/auth/sessionGuard` (the newer helper; geocode predates it and open-codes `verifySessionJwt`). Return `ok({ date, rates })`, `fail(apiError("rates_unavailable", …), 502)` on upstream failure.
  - [x] **Do not add the path to `src/proxy.ts`'s `config.matcher`.** `/api/exchange-rates` is not under `/api/trips`, so the proxy never sees it — the route self-guards, exactly like `/api/geocode` and `/api/users`. Adding it to the matcher would change `proxy.test.ts`'s pinned matcher set for no gain.

- [x] **Task 4 — Conversion and formatting helpers (AC: 5, 6, 7, 8, 12)**
  - [x] New `src/lib/trips/convertCost.ts`, pure and dependency-free:
        `convertEntryToCents({ costOriginalAmount, payments, rate })` returning `{ costCents, payments: [{ amountCents, amountOriginal }] }`, implementing AC6's residual rule exactly.
        `formatForeignAmount(amountOriginal, currency, language)` → `new Intl.NumberFormat(INTL_LOCALES[language], { style: "currency", currency }).format(amountOriginal / 100)` with **no** `minimumFractionDigits`/`maximumFractionDigits` — the omission is the whole of AC12.
  - [x] Use `INTL_LOCALES` from `@/i18n`, not a `language === "de" ? "de-DE" : "en-US"` ternary. Ten such ternaries are already open debt (DW-281); do not add the eleventh.
  - [x] Guard: after residual allocation, assert every `amountCents >= 0` and `sum === costCents`. Cover the negative-residual case (it is real — see the worked example in Dev Notes).

- [x] **Task 5 — Shared currency validation block (AC: 1, 2, 5, 6, 13)**
  - [x] New `src/lib/validation/costCurrencySchemas.ts` exporting the four-field block plus the refinements, so the rule is written **once** and imported by `accommodationSchemas.ts`, `dayPlanItemSchemas.ts` and `tripImportSchemas.ts`. Three hand-copied versions is how the existing `sum(payments) === costCents` rule ended up with three call sites that must be kept in step.
  - [x] Rules, all-or-nothing: either all four parent fields are `null`/absent, or all four are present with `costCurrency` matching `/^[A-Z]{3}$/` and `!== "EUR"`, `costRate` finite and `> 0`, `costRateDate` a valid `YYYY-MM-DD` (reuse `isValidDateOnly` from `@/lib/validation/dateOnly`), `costOriginalAmount` a non-negative int.
  - [x] When the parent carries a currency, **every** payment must carry `amountOriginal`, and `sum(amountOriginal) === costOriginalAmount`. When it does not, no payment may carry `amountOriginal`.
  - [x] Wire into `accommodationMutationSchema` and `dayPlanItemMutationSchema` inside their existing `.superRefine(…)` blocks, **after** the existing `total !== costCents` check. Do not weaken or remove that check — it is the invariant this whole design exists to satisfy.

- [x] **Task 6 — Repositories (AC: 1, 11, 13)**
  - [x] `src/lib/repositories/accommodationRepo.ts`: add the four fields to `AccommodationDetail`, to `AccommodationMutationParams`, to `toDetail`'s input type and output, and to both the `upsert` `create`/`update` bodies in `createAccommodationForTripDay` and to `updateAccommodationForTripDay`. Add `amountOriginal` to the `costPayment.createMany` mapping and to every `findMany({ select: { amountCents: true, dueDate: true } })` — there are four such selects across the two repos.
  - [x] `src/lib/repositories/dayPlanItemRepo.ts`: the same, across **three** write paths — `createDayPlanItemForTripDay`, `updateDayPlanItemForTripDay`, and `convertBucketListItemToDayPlanItemForTripDay` (easy to miss; it is a full third create). Plus `listDayPlanItemsForTripDay`'s select.
  - [x] `src/lib/repositories/tripRepo.ts`, **three** places:
        (a) the trip-detail query's `accommodation` / `dayPlanItems` selects around `:1059-1095`, and the matching `TripDayDetail` type around `:167-195`;
        (b) `getTripExportForUser`'s selects around `:1745-1800` **and** the payload mapping at `:2137-2212` (note both the accommodation and the item branch synthesize a payment row from `costCents` when `payments` is empty — that synthesized row must carry `amountOriginal: <the parent's costOriginalAmount>` when the parent has a currency, or a single-payment foreign entry exports a row that fails its own import check);
        (c) `createImportedDays` at `:2545` / `:2635` (the two `create` calls) and `:2607-2630` / `:2694-2716` (the two `costPayment.createMany` blocks, including their identical synthesize-from-`costCents` fallbacks).
  - [x] `TripExportPayload`'s accommodation and dayPlanItem member types around `:420-455`.
  - [x] Leave `copyAccommodationFromPreviousNight` alone: it already sets `costCents: null`, so there is no cost to carry and no metadata to copy.

- [x] **Task 7 — API routes (AC: 1)**
  - [x] `src/app/api/trips/[id]/accommodations/route.ts` (POST and PATCH) and `src/app/api/trips/[id]/day-plan-items/route.ts`: pass the four parsed fields through to the repository params. These routes destructure field-by-field from `parsed.data`, so a field not named here is silently dropped — that is the single most likely way this story ships half-working.

- [x] **Task 8 — `MoneyField` component (AC: 3, 9, 12)**
  - [x] New `src/components/forms/MoneyField.tsx`, beside `FormField.tsx` / `FormNotice.tsx` (`architecture.md:399-402` puts form components under `components/forms/*`).
  - [x] Compose the existing `FormField` with a trailing MUI `Select` — do not reimplement the input. Tokens: `minHeight 44`, select width `92px`, gap `8px`, caption gap `6px`, caption colour `theme.palette.tokens.inkSoft`, notice colour `theme.palette.warning.main`, icon `WarningTriangleIcon` at 14. **No hex, rgb, hsl or quoted colour name anywhere** — `test/helpers/hardcodedColour.ts` is a shared guard four screen suites run and it matches quoted named colours too.
  - [x] Props carry a `currency` + `onCurrencyChange` pair that is **optional**: a payment row renders the same component with the selector omitted, which is how AC3's "one selector per entry" is expressed in code rather than in a comment.
  - [x] Caption slot renders exactly one of: the converted EUR figure (currency ≠ EUR, rate known), the rate-unavailable notice (rate lookup failed), or the field's existing `hint`. Nothing when EUR — **no reserved height**, so a EUR field's layout is unchanged.

- [x] **Task 9 — Accommodation dialog (AC: 3, 4, 5, 6, 9, 11)**
  - [x] `TripAccommodationDialog.tsx`. Add `costCurrency: string` to `AccommodationFormValues` — and therefore to `STAY_ERROR_TAB` (`Record<StayErrorKey, StayTabId>` is total over `keyof AccommodationFormValues`, so **omitting it is a compile error**, by design) mapping to `"cost"`, and to `stayErrorFocusId`.
  - [x] Extend the `day.accommodation` prop type (`:56-66`) with the four fields and `payments[].amountOriginal`; seed `defaultValues` (`:521-541`) from them. Seed the cost box and each payment row from `costOriginalAmount` / `amountOriginal` when a currency is present, else from `costCents` / `amountCents` as today. `buildDefaultPayments` (`:347-367`) takes the extra input.
  - [x] Lazy rate fetch: issue `GET /api/exchange-rates` on the **first** move off EUR and cache it in component state for the dialog's life. Never on open, never while EUR is selected (AC4).
  - [x] In `onSubmit`, insert the currency branch **after** the existing per-row parse loop and **replace** the `total !== costCents` comparison's operands with the entered-currency ones when a foreign currency is active. Keep the EUR path's code path literally unchanged.
  - [x] Unchanged-save rule (AC11): if `costCurrency` is unchanged from the loaded entry **and** neither the cost box nor any payment amount is dirty, reuse the loaded `costRate` / `costRateDate` and send the loaded `costCents` / `amountCents` — do not fetch, do not re-round. `dirtyFields` from react-hook-form is already used in this file for `checkInTime` / `checkOutTime`; use the same source.
  - [x] Switching a foreign entry **to** EUR clears all five columns to `null` and treats the typed numbers as EUR. Say so in a comment — a reader will otherwise assume the receipt is preserved.

- [x] **Task 10 — Activity dialog (AC: 3, 4, 5, 6, 9, 11)**
  - [x] `TripDayPlanDialog.tsx`, the same work against its different machinery: errors live in three hand-rolled `useState` stores, not react-hook-form. Add `costCurrency` to `PlanFieldErrors` if it can fault (and therefore to `PLAN_ERROR_TAB`, same total-`Record` compile guard) and to `PlanFormValues` (`:455-470`) so the dirty fingerprint covers it — a currency change that does not dirty the form would let `✕` discard silently.
  - [x] Extend the `DayPlanItem` prop type (`:72-83`) and the open-effect seed at `:895-910`.

- [x] **Task 11 — Carry the fields to the activity dialog through `TripDayView` (AC: 11)**
  - [x] `TripDayView.tsx:944-957` maps the API day into `planItems`, and `planItems` is what feeds `TripDayPlanDialog`'s `item` prop. **That mapping does not copy `payments` at all today**, so a split schedule already reopens as a single row. Add `payments` *and* the four currency fields to it, and to the `DayPlanItem` type at `:363-373` and the day type at `:330-345`.
  - [x] This is not optional polish: without it a foreign split-payment activity reopens as one synthesized row and an unchanged save silently rewrites its schedule and its receipt, which is a direct AC11 failure.
  - [x] The **stay** dialog needs no equivalent change — it receives `day` straight through (`:4258-4281`), so the repo/type work in Task 6 is enough there.

- [x] **Task 12 — Import/export schemas (AC: 13)**
  - [x] `src/lib/validation/tripImportSchemas.ts`: add the four fields to `accommodationImportSchema` (`:347-388`) and `dayPlanItemImportSchema` (`:389-455`), and `amountOriginal` to both inline payment schemas. All `.optional().default(null)` — **additive within v2, no `formatVersion` bump** (`:546-549` states the rule for `documents`; follow it verbatim). A v1 or pre-10.1 v2 archive must import exactly as it does today.
  - [x] Apply the shared refinement from Task 5 alongside each existing `Payments must sum to costCents` check. Do not replace that check.

- [x] **Task 13 — i18n (AC: 14)**
  - [x] Add to **both** `src/i18n/en.ts` and `src/i18n/de.ts`, flat dot-keys in the `trips.*` block beside `trips.payments.*`:
        `trips.money.currencyLabel`, `trips.money.convertedCaption` (uses `{value}` + `formatMessage`), `trips.money.rateUnavailable`, `trips.money.rateDateCaption`.
  - [x] Reuse `trips.payments.sumMismatch` for the entered-currency mismatch — its text ("Payments must add up to the total cost") is currency-neutral and already correct. Do not add a parallel key.

- [x] **Task 14 — Tests**
  - [x] New `test/convertCost.test.ts` — AC6/AC7/AC8: the hand-checked `100,00 USD @ 1.1460 → 8726`; the positive-residual split; the negative-residual tie case; the JPY hundredths case; `formatForeignAmount` rendering `¥5000` with zero fraction digits under both languages.
  - [x] New `test/exchangeRateService.test.ts` — parse the verbatim fixture in Dev Notes, single-quoted attributes, the `time` value; a malformed row dropped while the rest survive; non-200 → `rates_unavailable`; TTL cache issues one outbound call for two reads; a failure is **not** cached.
  - [x] New `test/exchangeRatesRoute.test.ts` — modelled on `test/geocodeRoute.test.ts`: 401 without a session cookie, 200 with one, 502 on upstream failure. Use `stubFetch`/`mockFetchResponse` from `test/helpers/mockFetch.ts` and put the cast on the `vi.stubGlobal` argument, never on the variable.
  - [x] Extend `test/accommodationSchemas.test.ts` and `test/dayPlanItemSchemas.test.ts` — partial metadata rejected, `amountOriginal` sum mismatch rejected, a clean EUR payload still accepted.
  - [x] Extend `test/tripBackupRoundTrip.test.ts` with one foreign-currency stay and one foreign-currency activity, asserting all five columns survive and the import's own sum check passes.
  - [x] Extend `test/tripAccommodationDialog.test.tsx` / `test/tripDayPlanDialog.test.tsx` — EUR default issues no rate request; selecting a currency converts and shows the caption; a failing rate fetch shows the notice and still saves in EUR; reopening a foreign entry shows the original amount.
  - [x] `npm run lint && npm run typecheck && npm test` all clean. `npm run check:migrations` must pass.

### Review Findings

Adversarial code review, 2026-09-20. Three layers (Blind Hunter, Edge Case Hunter, Acceptance Auditor), all three completed. Every finding below was re-verified against the working tree before it was rated; severities are this review's, not the layers'.

Build state at review time: `npm test` 2547 passed / 157 files, `typecheck` clean, `lint` 0 errors, `check:migrations` passes (but see the note under *Deferred* — the new migration is untracked, so that check is currently vacuous).

#### Decision needed

- [x] [Review][Decision] **A failed rate lookup on an *existing* foreign entry silently rewrites stored money as euros** — **Resolved 2026-09-20, option (a): degrade only when the entry carries no stored receipt; block the save with a field message when it does.** Patched.

  **Correction found while writing the regression test.** Two of the three review layers described this as reachable by editing the amount of a stored foreign entry during an outage. It is not: `rateFor` already falls back to the stored rate whenever the selected code still matches the loaded entry, so an unchanged-currency edit re-converts at the rate it was priced at and loses nothing. The reachable case is a **change of currency** while the feed is down — the new code has no stored rate, and degrading would then write the typed foreign number into `costCents` and null the receipt explaining the old price. The guard is written against that case, and both behaviours are now pinned by tests. — `TripAccommodationDialog.tsx:1272` and `TripDayPlanDialog.tsx:1452` both end the converted branch with an empty `else`, commented "that is AC9 in one line". For a **new** entry that is right. For an entry already stored as `$100.00 → 8726 c`, reopened, amount corrected to `$101.00` with ECB unreachable, it saves `costCents = 10100` with all five columns `null` — the price silently becomes €101.00 and the receipt is destroyed. AC9 ("failure degrades, never blocks") and AC11 ("no dropped receipt") both apply and point opposite ways; the spec does not resolve the collision. Options: (a) keep degrading, but only when the entry has no stored receipt, and block the save with a field message when it does; (b) keep the stored rate as the fallback for an unchanged currency and degrade only for a *new* currency; (c) accept current behaviour and amend AC9 to say so explicitly.
- [x] [Review][Decision] **AC12 vs. the input box: `¥5000` reopens as `5000.00`** — **Resolved 2026-09-20, option (a): AC12 is amended to exempt editable inputs; the `Intl` renderer lands in 10.2.** Becomes a patch (spec text only, no code change). — `seedCostBox` and `buildDefaultPayments` render the foreign amount with `formatCentsAsAmount`, the exact `(value/100).toFixed(2)` + `language === "de"` function AC12 names and forbids; `test/tripDayPlanDialog.test.tsx` pins `toHaveValue("5000.00")`, which under `de` is the `5000,00` AC12 says must not appear. The dev's reason (in the `seedCostBox` comment) is sound for an editable field — an `Intl`-formatted `5.000 ¥` cannot be typed back — but `formatForeignAmount` is then never called with a real foreign currency anywhere in production: both call sites pass the literal `"EUR"`. So AC12 is satisfied by no production surface. Options: (a) amend AC12 to exempt editable inputs and note the renderer lands in 10.2; (b) keep the box raw but drop the trailing `.00` for zero-exponent currencies; (c) treat it as an AC12 failure and rework.
- [x] [Review][Decision] **`trips.money.rateDateCaption` exists in both dictionaries and has zero consumers** — **Resolved 2026-09-20, option (a): wire it into the `MoneyField` caption beside the converted figure.** Becomes a patch. — `src/i18n/en.ts:711` "Rate of {date}", `src/i18n/de.ts:638` "Kurs vom {date}"; `grep` over `src/` finds no reader. Showing the receipt on read surfaces is 10.2, but the spec puts in-dialog display inside 10.1 ("10.1 stores the metadata and shows it only inside the two dialogs"), so `costRateDate` is stored, exported, imported and round-trip-tested while the user can never see which day's rate explains their price. Options: (a) wire it into the `MoneyField` caption beside the converted figure; (b) delete both keys as scaffolding and let 10.2 reintroduce them.
- [x] [Review][Decision] **AC4's "every existing test that saves a EUR cost passes unmodified" is false — six suites were edited** — **Resolved 2026-09-20, option (a): make `amountOriginal` optional outbound and revert the six suites, restoring AC4 literally.** Becomes a patch. — `accommodationRepo`, `dayPlanItemRepo`, `tripRepo`, `tripAccommodationRoute`, `tripDayPlanItemsRoute`, `tripDetailRoute`. Cause: `PaymentDetail` makes `amountOriginal` **required outbound**, so a EUR entry's payload is no longer byte-identical. This was a design choice, not a forced consequence — emitting the column only when non-null would have kept AC4 literally true. Options: (a) make `amountOriginal` optional outbound and revert those six suites; (b) amend AC4 to cover additive outbound columns.

#### Patch

- [x] [Review][Patch] Server `costCurrency` fieldError plants an error on an unregistered field and permanently deadlocks the stay dialog's Save [travelplan/src/components/features/trips/TripAccommodationDialog.tsx:133] — `costCurrency` was added to `STAY_ERROR_TAB`, so the mapper's `if (baseKey in STAY_ERROR_TAB)` guard calls `setError("costCurrency", …)`; but unlike `paymentMode` (hidden `register` at `:2237`) it is never registered and nothing renders `errors.costCurrency`. The file's own comment at `:1394-1408` documents this exact defect: an error under an unregistered key is never revalidated, and `handleSubmit` then routes to the invalid callback on every later press — the dialog is dead until closed and reopened, with no message shown. Reachable from both `refineCostCurrency` issues, which use `path: ["costCurrency"]`. Fix: register it (hidden input, mirroring `paymentMode`) or move it to `STAY_PAYLOAD_ERROR_TAB`. Folding in: `AccommodationFormValues.costCurrency` is currently written by `handleCurrencyChange` and never read — registering it gives it a real job instead of dirty-tracking only.
- [x] [Review][Patch] The cost ceiling is applied to the *typed foreign* value, blocking ordinary weak-currency prices [travelplan/src/components/features/trips/TripAccommodationDialog.tsx:969] — `costRules` still rejects `cents > maxCostCents` on the raw box, and runs at `:1106` via `collectRuleFailures` *before* the currency branch at `:1210`. The new comment at `:1252` claims the ceiling "moves to the converted value rather than being dropped"; it was added at `:1258`, not moved, so both now fire. Dev Notes line 223 is explicit that this gate "applies to the *EUR* value and is **unaffected**". `2.000.000` IDR (≈ €98) is refused with `trips.stay.costTooHigh`. Fix: skip the ceiling inside `costRules` when `entryCurrency.isForeign`; the post-conversion check already covers it.
- [x] [Review][Patch] Stay dialog's `unchanged` fast path emits an unsaveable payload when row counts differ [travelplan/src/components/features/trips/TripAccommodationDialog.tsx:1238] — `if (storedPayments.length === paymentsPayload.length) { …remap… }` has no `else`. When the lengths differ, `costCents` has already been set to the stored **converted** figure at `:1236` while `paymentsPayload` still holds the **typed originals** with no `amountOriginal`. The server answers both "Payment total must match cost" and "Every payment must carry its original amount" about numbers the user never touched — and that 400 names `payments`, then `costCurrency`, hitting the deadlock above. The activity dialog gets this right: its `paymentsUnchanged` at `TripDayPlanDialog.tsx:1395-1401` compares lengths *and* each stored original *inside* the `unchanged` predicate. Fix: mirror that predicate into the stay dialog.
- [x] [Review][Patch] `copyAccommodationFromPreviousNight` nulls `costCents` but leaves the four new currency columns on the target row [travelplan/src/lib/repositories/accommodationRepo.ts:493] — the `data` object sets `costCents: null` and omits `costOriginalAmount` / `costCurrency` / `costRate` / `costRateDate`, so on the `update` arm of the `upsert` the target day's own previous receipt survives against a null cost. That is precisely the shape `refineCostCurrency` refuses ("Currency metadata requires a cost"), so the stay can never be saved from the dialog again; `getTripExportForUser` also emits it verbatim, and the archive then fails its own import — breaking the AC13 round trip. Not caught because this function was never touched while the schema gained the columns. Fix: add the four `null`s to `data`.
- [x] [Review][Patch] A currency absent from a successfully-fetched document produces no notice, then saves the typed amount as euros [travelplan/src/components/forms/useEntryCurrency.ts:135] — `selectCurrency` fires `loadRates()` and never asks whether the *selected* code is in the document; on success `setUnavailable(false)` runs, and `loadRates` short-circuits on `if (rates) return rates` so a second selection never re-evaluates. The exported `unavailable` (`:171`) is therefore `false`, the field shows no caption and no notice, and at submit `ensureRate` returns `null` and the dialog closes before the notice can paint. AC9 names this case verbatim: "a selected code absent from the fetched document: the field behaves as plain EUR entry **with an inline notice**". Fix: after `loadRates` resolves in `selectCurrency`, set `unavailable` when `rateFor(next, document)` is null.
- [x] [Review][Patch] A stored currency outside `ECB_CURRENCIES` renders a blank, unusable selector [travelplan/src/components/forms/MoneyField.tsx:129] — `<Select value={currency}>` with options `["EUR", ...ECB_CURRENCIES]` and no fallback `MenuItem`. `currencyCodeSchema` accepts any non-EUR `/^[A-Z]{3}$/`, and the constant is a moving target the story says may be edited freely (BGN left on 2026-01-01, HRK in 2023) — so an entry saved before a delisting, or imported from an older archive, reopens with an empty box, a MUI out-of-range warning, and no way to see or re-select its currency. Fix: render a fallback `MenuItem` when `currency` is not in the list. (Tightening `currencyCodeSchema` to the constant instead would be wrong — it would make editing `ECB_CURRENCIES` invalidate stored data, which the AC correction explicitly rules out.)
- [x] [Review][Patch] No in-flight dedupe in the rate service: concurrent cold-cache requests each hit ECB [travelplan/src/lib/rates/exchangeRateService.ts:152] — the cache is read at `:152` and written only after the response parses at `:182`, so N requests arriving within one cold window issue N outbound calls to the public courtesy feed this module exists to protect. The client hook already solves this with an `inFlight` ref (`useEntryCurrency.ts:80`); the service has no equivalent. AC10's "at most one outbound ECB request per TTL window" is literally false under concurrency. Fix: a module-level in-flight promise, same shape as the hook's.
- [x] [Review][Patch] Toggling the payment schedule re-prices an untouched foreign stay at today's rate [travelplan/src/components/features/trips/TripAccommodationDialog.tsx:722] — the single-mode sync effect calls `setValue("payments.0.amount", …, { shouldDirty: paymentSyncSettled.current })`, which is `true` once values have settled. Switching split → single → back without editing a number marks `payments` dirty, so `paymentsDirty` at `:1215` is true, `unchanged` is false, and the save re-fetches and rewrites `cost_rate`, `cost_rate_date` and `cost_cents` — the silent re-pricing the surrounding comments say is prevented. Fix: compare against the stored originals rather than relying on `dirtyFields` (the same change as the row-count patch above).
- [x] [Review][Patch] `dayPlanItemImportSchema`'s top-level `return` skips the new currency refinement [travelplan/src/lib/validation/tripImportSchemas.ts:448] — `if (hasFromTime !== hasToTime) { ctx.addIssue(…); return; }` sits above `refineCostCurrency(value, ctx)` at `:491`, contradicting the stated reason the sum check was nested ("each existing check moved into a nested function so its returns stay local"). Impact is small — the record is already rejected — but the import report shows one fault where there are two, and the second reappears on the next attempt. Fix: nest that branch like the others.
- [x] [Review][Patch] `MoneyField` labels its selector twice and ships an untranslated default [travelplan/src/components/forms/MoneyField.tsx:112] — a `<Typography component="label" htmlFor={`${id}-currency`}>` *and* `inputProps={{ "aria-label": currencyLabel }}` on a non-native MUI `Select`. The `aria-label` wins for the accessible name and MUI puts the `htmlFor` target on a hidden input, so clicking the visible word does not open the menu — unlike every other labelled field in these dialogs. The default `currencyLabel = "Currency"` is also an English literal in a component both callers always pass a translated string to. Fix: drop the redundant `aria-label` and the default.
- [x] [Review][Patch] Duplicate `useWatch` subscriptions on `costCents` and `payments` [travelplan/src/components/features/trips/TripAccommodationDialog.tsx:647] — `costValueWatch` / `paymentsWatch` were added five lines above the pre-existing `costInput` / `watchedPayments` at `:678-679`, watching the same two names. Four subscriptions where two would do, and the next reader has to work out which pair is authoritative. Fix: use the existing pair for the captions.

#### Deferred

- [x] [Review][Defer] The server never checks that the stored euro figure follows from the stored rate [travelplan/src/lib/validation/costCurrencySchemas.ts:76] — deferred, hardening debt not required by any AC (DW-355)
- [x] [Review][Defer] `originalAmountSchema` has no upper bound while `costSchema` caps `costCents` [travelplan/src/lib/validation/costCurrencySchemas.ts:41] — deferred, pre-existing DW-249 family (DW-356)
- [x] [Review][Defer] Live conversion captions round per box and so disagree with the stored residual sweep by a cent [travelplan/src/components/features/trips/TripAccommodationDialog.tsx:658] — deferred, cosmetic (DW-357)
- [x] [Review][Defer] `buildDefaultPayments` mixes currencies across rows when a foreign parent has a row with `amountOriginal: null` [travelplan/src/components/features/trips/TripAccommodationDialog.tsx:389] — deferred, only reachable through the copy-path defect being patched above (DW-358)
- [x] [Review][Defer] `convertEntryToCents` can throw straight through an unwrapped async submit handler [travelplan/src/lib/trips/convertCost.ts:104] — deferred, the throw is argued unreachable (DW-359)
- [x] [Review][Defer] The activity dialog's currency tests drive a mocked native `<select>`, the stay dialog's drive the real MUI menu [travelplan/test/tripDayPlanDialog.test.tsx] — deferred, coverage asymmetry not a defect (DW-360)
- [x] [Review][Defer] `check:migrations` reports "no migration changes" because the new migration folder is untracked [travelplan/scripts/check-migration-immutability.sh] — deferred, resolves itself when the work is staged; noted so the green tick is not mistaken for coverage (DW-361)

#### Verification after patching

`npm test` 2562 passed / 157 files (15 new tests), `typecheck` clean, `lint` 0 errors, `check:migrations` passes. The fifteen patches are pinned by new tests in `exchangeRateService`, `accommodationRepo`, `moneyField`, `tripImportSchemas`, `tripAccommodationDialog` and `tripDayPlanDialog`. AC4 is now literally true again: `accommodationRepo.test.ts`, `dayPlanItemRepo.test.ts`, `tripRepo.test.ts`, `tripAccommodationRoute.test.ts` and `tripDayPlanItemsRoute.test.ts` are byte-identical to their pre-10.1 state, restored with `git checkout`. `tripDetailRoute.test.ts` keeps its four added key-set entries — those are the parent entity's columns, which AC11 requires, not the payment row AC4 is about.

#### Dismissed (6)

Read surfaces not showing foreign amounts (explicitly Story 10.2, Dev Notes line 221); no `formatVersion` bump on the additive v2 archive (AC13 says additive); the ECB regex parser's fragility (documented design choice, degrades safely to the AC9 path); `__resetExchangeRateCacheForTests` exported from a production module (documented, standard for this repo's `fileParallelism: false` setup); the route returning `rates_invalid_response` where Task 3's prose said `rates_unavailable` (documented in the route, and the client treats both identically); "the activity dialog applies no ceiling to the converted cost" (the stated mechanism is wrong — `dayPlanItemSchemas` has no `.max` on `costCents` at all; the real gap is pre-existing DW-249).

## Dev Notes

### The invariant is the design — read this before writing any code

`sum(payments.amountCents) === costCents` is enforced as **exact integer equality** in three places: `accommodationSchemas.ts:92`, `dayPlanItemSchemas.ts:129`, and `tripImportSchemas.ts:381` / `:449`. Two independently rounded conversions can miss each other by a cent; two conversions at rates fetched on different days miss by more. Either way the save is refused — or succeeds locally and fails on restore.

Everything else follows: **one currency and one rate per entry**, chosen once, applied to the cost and to every payment row in a single submit, with the residual swept into the largest row. Do not relax any of the three server checks. Do not put a currency column on `cost_payments`. If you find yourself needing either, the design has drifted.

### ECB feed — verified 2026-09-20, verbatim

`https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml`, ~1.5 KB, no key, no registration.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
	<gesmes:subject>Reference rates</gesmes:subject>
	<gesmes:Sender>
		<gesmes:name>European Central Bank</gesmes:name>
	</gesmes:Sender>
	<Cube>
		<Cube time='2026-09-18'>
			<Cube currency='USD' rate='1.1460'/>
			<Cube currency='JPY' rate='180.94'/>
			…
		</Cube>
	</Cube>
</gesmes:Envelope>
```

Note: **single-quoted attributes**, tab-indented, three nested elements all named `Cube`. The date is the `time` attribute on the middle `Cube` — that string is what goes into `costRateDate` unchanged.

`ECB_CURRENCIES`, in published order, as observed on 2026-09-20 (**29**, not the 30 the epic says — `BGN` left the list when Bulgaria adopted the euro on 2026-01-01, as `HRK` did in 2023):

```
USD JPY CZK DKK GBP HUF PLN RON SEK CHF ISK NOK TRY AUD BRL CAD CNY
HKD IDR ILS INR KRW MXN MYR NZD PHP SGD THB ZAR
```

Do not assert the length of this list in a test. It will change again.

### Rate direction — the one likely silent error

ECB publishes **units of foreign currency per one euro**. `USD 1.1460` means one euro buys 1.1460 dollars. Therefore:

```
costCents = Math.round(costOriginalAmount / rate)     // DIVIDE
```

Store `costRate` **exactly as published, un-inverted**, so the number in the database can be checked against ECB's own page. A round-trip test (`convert then unconvert`) passes with the direction reversed — that is why AC7 demands a hand-checked absolute figure instead.

### Worked examples for the conversion tests

**Hand-checked, AC7:** `100,00 USD` → `costOriginalAmount = 10000`, rate `1.1460`.
`10000 / 1.1460 = 8726.003…` → `costCents = 8726` (= 87,26 €).

**Positive residual, AC6:** same cost, split `33,33 / 33,33 / 33,34 USD`.
- originals `3333 / 3333 / 3334`, sum `10000` ✓ (checked *before* conversion)
- converted `2908 / 2908 / 2909`, sum `8725`
- residual `8726 − 8725 = +1` → largest original is `3334` (row 3) → `2910`
- final `2908 + 2908 + 2910 = 8726` ✓

**Negative residual with a tie:** cost `100,00` at a synthetic rate of `3`, split `50,00 / 50,00`.
- `costCents = round(10000/3) = 3333`; converted `1667 / 1667`, sum `3334`
- residual `−1`; the two originals tie → **the last** takes it → `1666`
- final `1667 + 1666 = 3333` ✓

The residual is signed. Code that only handles a positive one is wrong.

**No minor unit, AC8/AC12:** `¥5000` → `costOriginalAmount = 500000` (× 100 regardless of JPY's zero exponent). At rate `180.94`: `500000 / 180.94 = 2763.35…` → `2763` cents.
Display: `new Intl.NumberFormat("de-DE", { style: "currency", currency: "JPY" }).format(5000)` → `5.000 ¥`. Passing `minimumFractionDigits: 2` renders `5.000,00 ¥`, a price that never existed — which is exactly why `formatCost.ts` must not be reused here.

### Patterns to copy, not reinvent

| Need | Copy from | Why |
|---|---|---|
| Outbound service module | `src/lib/routing/dayRouteService.ts` | Injectable `fetchImpl`, `AbortController` timeout, `cache: "no-store"`, `User-Agent`, typed error class. This is the house shape for an external call. |
| Session-gated public-API proxy | `src/app/api/geocode/route.ts` | Same job. Its comments argue the courtesy-caching case. **But** use `requireSession` from `@/lib/auth/sessionGuard`, not geocode's open-coded `verifySessionJwt` — geocode predates the helper. |
| Dropping a bad row instead of the response | `api/geocode/route.ts`'s `flatMap` | One unparseable `<Cube>` must not cost the other 28 rates. |
| Label + input + hint/error triple | `src/components/forms/FormField.tsx` | `MoneyField` composes it. Do not re-style an input. |
| Money parsing | `parseAmountToCents` in `src/lib/trips/parseAmount.ts` | Already accepts both separators regardless of locale, caps at 2 decimals, returns integer hundredths. **It is currency-agnostic and needs no change** — call it with a currency context, do not modify it. |
| Locale tag | `INTL_LOCALES` in `@/i18n` | Not a `=== "de"` ternary. |
| `fetch` stubbing in tests | `test/helpers/mockFetch.ts` | Cast on the `vi.stubGlobal` argument, never on the variable, or `.mock.calls` degrades to `any` and your assertions stop checking anything. |

### Files being modified — current state and what must be preserved

- **`TripAccommodationDialog.tsx` (2308 lines).** react-hook-form owns errors; `StayErrorKey = keyof AccommodationFormValues`, and `STAY_ERROR_TAB` is a *total* `Record` over it — adding a form field without a tab entry will not compile, which is the intended guard. `onSubmit` already runs three gates over the cost (`register`'s `costRules`, `collectRuleFailures` for unmounted tabs, then a submit-time re-parse — the third is dead code, DW-250, leave it alone). Preserve: the `revealError` → tab-select → focus chain, the `paymentsErrorSignature` effect that clears block-level payment errors on edit, and the `dirtyFields`-gated `checkInTime` / `checkOutTime` payload keys.
- **`TripDayPlanDialog.tsx` (2761 lines).** Three hand-rolled `useState` error stores (`fieldErrors`, `paymentRowErrors`, `paymentError`), `PlanFormValues` is the dirty fingerprint, `PLAN_ERROR_TAB` is the same total-`Record` guard. Preserve the fingerprint's completeness — a value the user can change that is not in `PlanFormValues` is a value `✕` will discard without asking.
- **`TripDayView.tsx` (4563 lines).** Only the day→`planItems` mapping and two type declarations. Do not touch the `formatCost` call sites or the timeline/`tl-card` rendering — that is **Story 10.2**, and this story must leave every existing figure rendering byte-identically.
- **`tripRepo.ts` (3688 lines).** Three separate concerns in one file (detail query, export, import). The export and import both carry a **synthesize-a-payment-row-from-`costCents`** fallback; both need `amountOriginal` threaded into the synthesized row, or a single-payment foreign entry round-trips into a row that fails its own import refinement.
- **`parseAmount.ts`, `formatCost.ts`.** **Not modified.** `formatCentsAsAmount` stays EUR-shaped and `formatCost` stays EUR-hardcoded; AC12 adds a *second* path, it does not rewrite the first.

### Explicitly out of scope

- **Display of the receipt on read surfaces** — timeline `tl-card`, cost overview, print sheet, offline packet. That is **Story 10.2** in full. 10.1 stores the metadata and shows it only inside the two dialogs.
- **A per-trip currency (DW-217).** Every total, roll-up, budget figure and export stays EUR. `formatCost`'s hardcoded `currency: "EUR"` is correct here and stays.
- **An upper bound on the activity cost field or on payment rows (DW-249).** Open debt, not this story — but note that `costOriginalAmount` for a weak currency (IDR at ~20 425 per EUR) reaches large hundredths quickly; the existing `maxCostCents = 100000000` gate on the stay cost applies to the *EUR* value and is unaffected.
- **Converging the ten `de-DE`/`en-US` ternaries (DW-281).** Just do not add an eleventh.
- **Currencies outside the ECB list** (VND, EGP, MAD, ARS, PEN …). Accepted gap, decided in the 2026-09-20 proposal: the selector does not offer them and the user converts by hand, exactly as today.

### Project Structure Notes

- All paths are under `travelplan/` (repo root holds `_bmad`, `_bmad-output`, `deploy`, `docs`, `travelplan`).
- `architecture.md:392-406`: routes in `app/api/**/route.ts` only; data access only via `lib/repositories/*`; Prisma client only in `lib/db/prisma.ts`; Zod validation in `lib/validation/*`; form components in `components/forms/*`. The new service sits in `lib/rates/` beside `lib/routing/` — the existing per-external-service convention, and it is what `architecture.md:459` already names as this feed's home.
- `architecture.md:459` already records this integration. No architecture edit is needed.
- `DESIGN.md:191-198` carries the `components.money-field` token block and `:288-296` the component entry — both already applied by UX. Read them; do not invent tokens.
- Node `>=24 <25`, Next 16.2.12, React 19.2.3, Prisma 7.3, Zod 4.1, MUI 7.3, Vitest 3.2. **No new dependency is to be added by this story** — that is a stated reason the ECB feed was chosen over a keyed provider.

### Testing standards

- `vitest run` via `npm test`; `environment: "node"` by default, jsdom opted into per file with `// @vitest-environment jsdom` at the top. Component suites render through `test/helpers/renderWithProviders.tsx`.
- `fileParallelism: false`, `maxForks: 1` — module-level state (your rate cache) **persists across test files in a run**. Export a reset and call it in `beforeEach`.
- Real SQLite per worker via `test/setup.ts`; repository and route suites hit the real database and clean up in `beforeEach`.
- Guard suites that will fail you if you are careless: `test/i18nDictionaries.test.ts` (key parity, no empty values), `test/hardcodedColour.test.ts` + `test/helpers/hardcodedColour.ts` (no literal colours in screen source), `test/proxy.test.ts` (the matcher set is pinned — do not edit `config.matcher`), `npm run check:migrations` (migrations are immutable once committed).

### References

- [Source: `_bmad-output/planning-artifacts/epics.md#Epic 10: Costs in Another Currency`] — Story 10.1 statement and all fourteen Given/When/Then criteria.
- [Source: `_bmad-output/planning-artifacts/sprint-change-proposal-2026-09-20.md#2. Impact Analysis`] — the invariant argument, the per-entry decision, the rate-direction warning, the uniform-hundredths decision, and the accepted 30-currency ceiling.
- [Source: `_bmad-output/planning-artifacts/prd.md:256`] — FR41.
- [Source: `_bmad-output/planning-artifacts/architecture.md:459`] — the ECB integration point; `:392-406` — boundaries and file organisation.
- [Source: `_bmad-output/planning-artifacts/ux-designs/ux-TravelPlan-2026-07-27/DESIGN.md:191-198, :288-296`] — `components.money-field` tokens and the component entry, including the notice-not-error rule.
- [Source: `travelplan/src/lib/validation/accommodationSchemas.ts:92`, `dayPlanItemSchemas.ts:129`, `tripImportSchemas.ts:381,449`] — the three enforcement sites of the payment-sum invariant.
- [Source: `travelplan/src/lib/routing/dayRouteService.ts`] — the outbound-service shape to copy.
- [Source: `travelplan/src/app/api/geocode/route.ts`] — the session-gated keyless-proxy precedent and the per-row-drop rule.
- [Source: `travelplan/src/lib/trips/parseAmount.ts`] — `parseAmountToCents` (unchanged) and `formatCentsAsAmount`'s documented `=== "de"` limitation.
- [Source: `_bmad-output/implementation-artifacts/deferred-work.md` DW-217, DW-249, DW-250, DW-281] — adjacent open debt, all out of scope, listed so it is not accidentally adopted or accidentally worsened.
- [Source: live fetch of `https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml`, 2026-09-20] — document structure, `time='2026-09-18'`, and the 29-currency list.

## Dev Agent Record

### Agent Model Used

claude-opus-5[1m] (Claude Opus 5, 1M context) via `bmad-dev-story`.

### Debug Log References

Implemented in one pass, red-green per task. The session was paused once at the user's request
mid-Task 9 and resumed; nothing was left half-applied at the pause point.

Six things the story did not name that the codebase required:

1. **`src/app/api/trips/[id]/route.ts` had the same field-by-field trap as the two mutation routes.**
   Task 7 names only `accommodations/route.ts` and `day-plan-items/route.ts`, but the trip-detail
   payload (both its GET and PATCH branches) also destructures member by member, and it is what feeds
   `TripDayView` and therefore both dialogs. Without the four fields there, AC11 fails before it is
   visible anywhere. Its pinned key-set test grew four keys as a result.
2. **Four `.superRefine` blocks had early `return`s that skipped the new rule.** In
   `accommodationSchemas`, `dayPlanItemSchemas` and both import schemas the existing cents check
   returns early for a cost-less entry, so calling `refineCostCurrency` after it - as Task 5 says -
   left "metadata present, `costCents` null" accepted. Each existing check moved into a nested
   function so its returns stay local and the currency rule always runs. No existing check changed.
3. **`refineCostCurrency` needed a "metadata requires a cost" rule** for that same shape, which the
   story's rule list does not state.
4. **The import fields are `.optional()` without `.default(null)`.** A default makes them *required*
   on the parsed type, which the archive shape is consumed as - by `createImportedDays` and by a
   dozen fixtures describing pre-10.1 packages. Absent and `null` are equivalent to every reader.
5. **`planFormFingerprint`'s field list and `currentFingerprint`'s dependency array both needed
   `costCurrency`.** Task 10 says to add it to `PlanFormValues`; that alone is not enough, because the
   fingerprint is a hand-written list and the memo a hand-written dep array. Missing either one means
   `✕` discards a currency change without asking. Covered by a test.
6. **`useEntryCurrency` needed a `seedCurrency` separate from `selectCurrency`.** Restoring a saved
   currency through the selecting path issued a rate request on every open of a foreign entry -
   AC4's "no request unless asked" and AC11's "no re-fetch" both broken by one line that reads like
   housekeeping.

One shared helper beyond the task list: `src/components/forms/useEntryCurrency.ts`. The two dialogs
disagree about everything else - react-hook-form against three hand-rolled `useState` stores - but
must agree exactly on when a rate is fetched, what a failure does, and which rate a submit converts
at. Hand-copying that is how the `sum(payments) === costCents` rule ended up with three call sites.

**Deliberately not done.** `formatCost.ts` and `parseAmount.ts` are untouched; `formatCentsAsAmount`
is still used to seed the *boxes* (it emits the separator-correct plain string a field is typed back
into, and `amountOriginal` is hundredths exactly as `amountCents` is), while `formatForeignAmount` is
the only renderer of a foreign amount *for display*. No read surface changed - that is Story 10.2.
`src/proxy.ts` is untouched. No dependency was added.

### Completion Notes List

- **AC1-AC2** One migration, `20260920120000_add_cost_currency_metadata`: nine nullable columns, no
  DEFAULT, no backfill. Verified applied against a fresh database and with `npm run check:migrations`.
  `cost_payments` gains `amount_original` and nothing else - no currency column, no rate column.
- **AC3** One selector per entry, on the cost tab, expressed structurally: `MoneyField`'s
  `currency` + `onCurrencyChange` pair is optional, and a payment row is rendered without it, so a row
  cannot grow a selector. Options are EUR then `ECB_CURRENCIES` in published order.
- **AC4** All 63 existing accommodation-dialog tests and all 95 existing activity-dialog tests pass
  **unmodified**. A EUR save issues no rate request and sends `payments` with no `amountOriginal` key.
- **AC5** The payment-sum check still runs on the typed values, before conversion, reporting
  `trips.payments.sumMismatch`. Tested in both dialogs.
- **AC6** `convertEntryToCents` applies one rate to cost and every row, sweeping the signed residual
  into the largest original, ties to the last. It asserts the reconciliation before returning.
- **AC7** `test/convertCost.test.ts` pins the hand-checked `100,00 USD @ 1.1460 -> 8726`; the rate is
  stored un-inverted and the operation is division.
- **AC8** `¥5000` stores as `500000`. No exponent table anywhere.
- **AC9** A dead feed degrades to euro entry with a caption-slot notice in `warning.main` and the
  14px alert icon - never the input's error border/background, never a block, never a `0` rate.
  Failures are never cached.
- **AC10** 30-minute in-process cache, successes only. Tested for one outbound call across two reads,
  a re-fetch past the TTL, and a failure that is not cached. No weekend special case.
- **AC11** A foreign entry reopens with its typed amount and currency and issues no request; an
  unchanged save writes back the identical cents, payments and all five metadata values, using the
  *stored* rate. Tested in both dialogs with a deliberately stale stored rate.
- **AC12** `formatForeignAmount` passes no fraction-digit options and resolves the locale through
  `INTL_LOCALES` - no eleventh `=== "de"` ternary (DW-281).
- **AC13** Both new round-trip tests go through the real export and import routes, so a refinement
  failure surfaces as a 400. One covers a foreign stay and a split foreign activity; the other proves
  a euro trip still restores with all five columns `null`.
- **AC14** Four new keys in both dictionaries; `trips.payments.sumMismatch` reused rather than
  duplicated. `test/i18nDictionaries.test.ts` passes.

**Verification:** `npm run lint` 0 errors (80 warnings, all pre-existing - 82 before this story),
`npm run typecheck` clean, `npm run check:migrations` passes, `npm test` **2547 passed / 157 files**.

New tests: `convertCost` (12), `exchangeRateService` (11), `exchangeRatesRoute` (4), `moneyField`
(10), plus 9 accommodation-dialog, 7 activity-dialog, 2 backup-round-trip and 19 schema cases.

Five existing suites needed assertion updates, all for the same reason - `payments` rows now carry
`amountOriginal` and the trip-detail payload carries the four columns, both additive and both
required by the ACs. No existing behaviour was changed to make a test pass.



### File List

Paths relative to the repository root.

**New**

- `travelplan/prisma/migrations/20260920120000_add_cost_currency_metadata/migration.sql`
- `travelplan/src/lib/rates/exchangeRateService.ts`
- `travelplan/src/app/api/exchange-rates/route.ts`
- `travelplan/src/lib/trips/convertCost.ts`
- `travelplan/src/lib/validation/costCurrencySchemas.ts`
- `travelplan/src/components/forms/MoneyField.tsx`
- `travelplan/src/components/forms/useEntryCurrency.ts`
- `travelplan/test/exchangeRateService.test.ts`
- `travelplan/test/exchangeRatesRoute.test.ts`
- `travelplan/test/convertCost.test.ts`
- `travelplan/test/moneyField.test.tsx`

**Modified**

- `travelplan/prisma/schema.prisma`
- `travelplan/src/app/api/trips/[id]/accommodations/route.ts`
- `travelplan/src/app/api/trips/[id]/day-plan-items/route.ts`
- `travelplan/src/app/api/trips/[id]/route.ts`
- `travelplan/src/components/features/trips/TripAccommodationDialog.tsx`
- `travelplan/src/components/features/trips/TripDayPlanDialog.tsx`
- `travelplan/src/components/features/trips/TripDayView.tsx`
- `travelplan/src/i18n/en.ts`
- `travelplan/src/i18n/de.ts`
- `travelplan/src/lib/repositories/accommodationRepo.ts`
- `travelplan/src/lib/repositories/dayPlanItemRepo.ts`
- `travelplan/src/lib/repositories/tripRepo.ts`
- `travelplan/src/lib/validation/accommodationSchemas.ts`
- `travelplan/src/lib/validation/dayPlanItemSchemas.ts`
- `travelplan/src/lib/validation/tripImportSchemas.ts`
- `travelplan/test/accommodationRepo.test.ts`
- `travelplan/test/accommodationSchemas.test.ts`
- `travelplan/test/dayPlanItemRepo.test.ts`
- `travelplan/test/dayPlanItemSchemas.test.ts`
- `travelplan/test/tripAccommodationDialog.test.tsx`
- `travelplan/test/tripAccommodationRoute.test.ts`
- `travelplan/test/tripBackupRoundTrip.test.ts`
- `travelplan/test/tripDayPlanDialog.test.tsx`
- `travelplan/test/tripDayPlanItemsRoute.test.ts`
- `travelplan/test/tripDetailRoute.test.ts`
- `travelplan/test/tripRepo.test.ts`

**Regenerated** (`npx prisma generate`, the `postinstall` hook - never hand-edited)

- `travelplan/src/generated/prisma/**`

## Change Log

| Date | Change |
|---|---|
| 2026-09-20 | Story 10.1 implemented. Nine nullable columns in one migration; ECB rate service, cached proxy and conversion helpers; shared currency validation wired into the two mutation schemas and both import schemas; the receipt threaded through all three repositories, three API routes and both dialogs; `MoneyField` and the shared `useEntryCurrency` hook; four i18n keys in both dictionaries. Status ready-for-dev → review. |
