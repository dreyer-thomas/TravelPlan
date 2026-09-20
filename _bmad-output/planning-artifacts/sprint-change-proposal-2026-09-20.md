# Sprint Change Proposal — 2026-09-20

**Project:** TravelPlan
**Raised by:** Tommy
**Facilitated by:** John (PM) via `bmad-correct-course`
**Scope classification:** Moderate — new epic, two new stories, one PRD addition, one design-system addition, one schema migration. No implemented work reverted, no story renumbered.

---

## 1. Issue Summary

**Every foreign price is converted by hand before it can be entered.**

A cost field in TravelPlan is EUR and only EUR. Nothing on screen says so — there is no
currency control, no currency column in the schema, and no currency in the stored value.
EUR is an unstated convention carried entirely in the user's head.

That convention holds fine for a trip inside the euro area. It stops holding the moment
the trip is the one the PRD's own primary journey describes: *"Tom wants to plan a New
Zealand trip from 14.12 to 23.01."* Every hotel on booking.com quotes NZD, every activity
quotes NZD, and every one of those numbers has to be run through a converter in another
tab before it can be typed into the box. The app asks the user to do arithmetic it is
better placed to do.

The cost is not only the keystrokes. It is that the number which lands in the database is
**untraceable**. `184,06` records neither that it was `200,00 NZD` nor which rate produced
it, so it cannot be checked, corrected, or re-entered later without redoing the same
manual conversion. A wrong conversion is indistinguishable from a right one.

**Trigger:** No triggering story. This arrived as a product request during planning, after
Epic 9 closed. Category: *new requirement emerged from stakeholder*.

**Evidence:**

- `prisma/schema.prisma:178`, `:204`, `:225` — `Accommodation.costCents`, `DayPlanItem.costCents` and `CostPayment.amountCents` are bare `Int?`/`Int`. No currency column exists anywhere in the schema.
- `src/lib/trips/parseAmount.ts` — the shared money parser produces integer cents and has no concept of a currency. `formatCentsAsAmount` renders a bare number; `formatCost` next door applies a symbol from the locale, not from the data.
- Four money fields exist, not three: stay cost, stay payment amount, activity cost, activity payment amount — enumerated in Story 6.27, which fixed all of them together. `CostPayment` is one table surfacing in two dialogs.
- `src/lib/validation/accommodationSchemas.ts:92` and `src/lib/validation/dayPlanItemSchemas.ts:129` — `sum(payments.amountCents) === costCents` is enforced server-side on both entity types, as an exact integer equality.
- `src/lib/validation/tripImportSchemas.ts:381`, `:449` — the same equality is re-enforced on import (*"Payments must sum to costCents"*), so any conversion scheme that can break it also breaks restore.
- `src/app/api/geocode/route.ts` — the app already runs an authenticated server-side proxy to a free, keyless public API (Nominatim), with the usage-policy reasoning written into the file. The pattern for an outbound lookup exists and is documented.
- `prd.md:249-253` — *Budget Awareness (MVP-light)* covers totals, budget and runway. None of the three FRs mentions currency; the omission is silent rather than deliberate.
- `DESIGN.md:278` — the system defines `input` and `select` separately and nothing that composes the two into a single field.

---

## 2. Impact Analysis

### Epic impact

| Epic | Impact |
|---|---|
| Epic 10 (new) — Costs in Another Currency | Created. Receives Stories 10.1 and 10.2. |
| Epics 1–9 | No impact. No existing story is modified, reverted, or renumbered. |

Epic 9 is currently last in `epics.md` (the file ends at `:3351`), so Epic 10 is a pure
append. `sprint-status.yaml` is read in file order by the loop, so an `epic-10` block
placed after `epic-9` encodes 10.1 → 10.2 without anyone having to remember it.

**Why this is not a story inside Epic 2.** Epic 2 is closed and is the MVP planning epic;
its charter is *"create trips, manage day-by-day planning, accommodations, day plans, and
see planned costs"*. Currency entry is a new capability with a new external integration
and a schema migration, which is the same argument that produced Epic 9 rather than
extending Epic 2 with documents.

### Story impact

| Story | Change |
|---|---|
| 10.1 | **New.** Foreign-currency entry on all four money fields: rate lookup, schema, conversion, fallback, round-trip. |
| 10.2 | **New.** The stored rate made visible where a cost is read, so a converted figure is explainable without opening its dialog. |
| 6.27 | Shipped. Its shared parser (`parseAmount.ts`) is the layer 10.1 extends; the parser itself is not modified, it is *called with a currency context*. Its five-field enumeration is the authoritative list of what 10.1 must reach. |
| 6.30 | Shipped. `formatCentsAsAmount`'s locale handling and its documented `=== "de"` shortcut are directly in 10.1's path — see *Technical impact*. |
| 2.19 | Shipped. Cost roll-up to day and trip totals. Unaffected by design: totals continue to sum `costCents` and never see a foreign amount. |
| 2.31, 2.32 | Shipped. The v2 backup archive must learn to carry the new columns or a restore silently drops every conversion receipt. In 10.1, not deferred. |
| 7.13 | Shipped. The cost overview is one of 10.2's read surfaces. |
| 9.1, 9.2 | Shipped. No interaction. |

### Artifact conflicts

| Artifact | Required update |
|---|---|
| `prd.md` | One new FR (FR41) appended to *Budget Awareness (MVP-light)* at `:253`; `editHistory` entry. No NFR changes — the rate feed carries no personal data and adds no secret, so NFR2 and NFR3 are untouched. |
| `epics.md` | Requirements Inventory gains FR41; FR Coverage Map gains one line; Epic List gains an Epic 10 entry; new `## Epic 10` section appended after `:3351`. |
| `DESIGN.md` | New `money-field` component entry composing `input` + `select`, plus its caption and notice lines, and a `components.money-field` token block. |
| `sprint-status.yaml` | New `epic-10` block with 10.1, 10.2 and its retrospective, appended after the `epic-9` block. |
| `architecture.md` | *Integration Points → External Integrations* (`:453-456`) gains the ECB feed; *Data Architecture* (`:140-145`) unchanged in substance but the new columns are worth a line. No decision in *Core Architectural Decisions* is reversed: no new dependency, no new secret, no new service. |
| `ux-design-specification.md` | No change. It describes screens and flows at a level a field composition does not alter; the concrete definition belongs in `DESIGN.md`, matching the 2026-08-05 precedent for `doc-chip`. |
| `docs/deployment-*.md` | No change. Outbound HTTPS to a public host is already required by the Nominatim proxy. |

### Technical impact

**The payment-sum invariant is the whole design.**

`sum(payments.amountCents) === costCents` is enforced as exact integer equality in three
places — both mutation schemas and the import schema. Everything about how currency entry
should work follows from it, and getting it wrong produces entries the app will refuse to
save or restore.

Two conversions done independently cannot be relied on to sum. Convert `200,00 NZD` to a
cost and `100,00 NZD` twice to payments, each rounded on its own, and the halves can miss
the whole by a cent. Convert them on *different days*, at different rates, and they miss
by more. Either way the save fails, or worse, succeeds locally and fails on restore.

**Therefore the currency selector is per entry, not per field.** One selector on the
accommodation dialog governing its cost and all its payment rows; one on the activity
dialog doing the same. Four money fields, two selectors. This is a change from the
per-field framing this change was first described in, and it is a better design on its
own merits — a stay whose price is in NZD does not have payments in GBP — but the reason
it is not optional is the invariant.

With one currency per entry, the conversion is one operation on submit:

1. The user's amounts are parsed and the sum invariant is checked **in the entered
   currency**, before any conversion. A mismatch is the same error the user sees today,
   phrased in the currency they typed.
2. One rate is fetched for the whole submit.
3. `costCents = round(costOriginal / rate)`.
4. Each payment converts by the same rate, then the residual
   `costCents - sum(converted payments)` — at most a cent or two — is applied to the
   largest payment, ties broken toward the last. The invariant then holds by construction
   rather than by luck.

Storing the rate per entry rather than per row makes this structural: the schema cannot
express two rates on one entry, so no future change can reintroduce the drift.

**The rate source needs no key, no secret, and no new dependency.**

`https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml` is a ~3 KB document
carrying all 30 rates, published by the ECB against EUR — which is exactly the base this
app stores in. It requires no registration, no API key, and no third-party intermediary.
A server-side proxy at `src/app/api/exchange-rates/route.ts` mirrors the Nominatim route's
shape: session-gated, one outbound call, the app's error envelope.

**One correction to an assumption made while scoping this.** There is no weekend gap to
handle. The daily file does not disappear on a Saturday; it continues to serve the last
TARGET working day's rates with that publication date attached. The fallback path is
therefore narrower than first described — it exists for network failure, a non-200 or
unparseable response, and a currency outside the 30. That removes a branch rather than
adding one, and the stored `costRateDate` records which publication was actually used.

The response is cached in-process. Rates publish once daily around 16:00 CET, so a
per-dialog-open fetch would be thirty wasted requests for one number that has not moved.
The cache is the same courtesy the Nominatim route's comment argues for at length.

**What the 30 currencies do not cover.** VND, EGP, MAD, ARS, PEN and others are absent.
Tommy's decision is to accept that: an unlisted currency behaves exactly as an unreachable
service does — the selector does not offer it, the field is plain EUR, and the conversion
is done by hand as it is today. No regression, just an unclosed gap, named here so it is
not rediscovered as a bug.

**`formatCentsAsAmount` is the sharp edge on display.** Its own documentation records that
the decimal separator is a hand-written `=== "de"` ternary, and warns that a third
dictionary would render `120.50` beside a `0,00` placeholder. Rendering a *foreign* amount
walks into the neighbouring problem: JPY has no minor unit and KRW has none either, so
`(value / 100).toFixed(2)` renders `¥5000` as `5000,00`. Foreign amounts must render
through `Intl.NumberFormat` with the currency's own fraction digits. EUR fields keep the
existing function untouched — this adds a second path, it does not rewrite the first.

**Storage is uniform hundredths, deliberately.** `costOriginalAmount` stores the typed
value multiplied by 100 regardless of the currency's real ISO 4217 exponent — `¥5000`
becomes `500000`. This avoids shipping an exponent table for one display concern that
`Intl.NumberFormat` already solves, and it keeps the conversion arithmetic a single
integer division: `costCents = round(costOriginalAmount / rate)`.

**Rate direction must be written down and tested.** ECB publishes *units of foreign
currency per 1 EUR* — `USD 1.0856` means one euro buys 1.0856 dollars. The rate is stored
as published, un-inverted, so the stored number can be checked against the ECB's own page.
Division, not multiplication. This is the single likeliest place for a silent 1.18×
error, and it deserves an explicit test with a hand-checked figure rather than a
round-trip that would pass with the direction reversed.

**Default behaviour is unchanged.** The selector defaults to EUR. Choosing EUR writes no
metadata, performs no lookup, and stores exactly what it stores today. Every existing
entry keeps working, and a user who never leaves the euro area never sees a behaviour
change.

---

## 3. Recommended Approach

**Option 1 — Direct Adjustment: add an epic and two stories. Selected.**

Effort: Medium. Risk: Low.

Nothing shipped is wrong. Every cost field works as specified, the parser fixed in Story
6.27 is sound, and the payment invariant is doing its job. This is an additive capability
on top of a correct foundation, behind a selector that defaults to today's behaviour. The
schema change is five nullable columns and one migration, with no backfill: existing rows
are EUR entries with no conversion receipt, which is exactly what `NULL` means here.

**Option 2 — Potential Rollback: not viable, and nothing to roll back.**

No shipped story conflicts with this change. The one thing worth examining — whether
`costCents` should have been a currency-carrying type from the start — is not a rollback
question: EUR remains the single source of truth for every total, roll-up, budget runway,
overview and export, by Tommy's explicit decision. A multi-currency ledger is a different
product and is not being built.

**Option 3 — PRD MVP Review: not required.**

The MVP is long shipped. This adds one FR to a shipped section; it neither reduces scope
nor changes a goal. FR22–FR24 (totals, budget, runway) are untouched because they operate
on `costCents`, which continues to be EUR.

**Rationale.** The invariant analysis is what makes this Low risk rather than Medium. The
one genuine trap — two independent conversions that fail to sum — is closed structurally
by putting the currency and rate on the parent entry, so the schema itself cannot express
the broken state. The rest is a keyless GET, five nullable columns, and a field
composition, against a codebase that already has an authenticated outbound proxy to copy
and a shared money parser to extend.

---

## 4. Detailed Change Proposals

### 4.1 PRD — `_bmad-output/planning-artifacts/prd.md`

**Section: Functional Requirements → Budget Awareness (MVP-light), after `:253`**

```
OLD:
- FR22: Users can see a total of planned costs entered so far.
- FR23: Users can set a total trip budget.
- FR24: Users can see remaining budget (budget runway) based on planned costs.

NEW:
- FR22: Users can see a total of planned costs entered so far.
- FR23: Users can set a total trip budget.
- FR24: Users can see remaining budget (budget runway) based on planned costs.
- FR41: Users can enter a cost in a foreign currency and have the app convert it to EUR
  using a published daily exchange rate. EUR remains the stored value and the basis of
  every total, budget figure and export; the entered amount, its currency and the rate
  used are kept alongside it so the converted figure can be explained and corrected.
```

**Rationale:** The converted figure is a planning estimate, not a payment record — the
rate is the one published on the day of entry, not on the day of payment. The FR says
"convert" rather than "record what was paid" for exactly that reason.

**Section: frontmatter `editHistory`, after `:49`**

```
NEW:
  - date: '2026-09-20'
    changes: 'Added FR41 (foreign-currency cost entry converted to EUR at the ECB daily
      reference rate). EUR remains the single stored currency. See Sprint Change Proposal
      2026-09-20.'
```

### 4.2 Epics — `_bmad-output/planning-artifacts/epics.md`

- **Requirements Inventory:** add FR41 with the text above.
- **FR Coverage Map** (after `:124`): `FR41: Epic 10 - Costs in Another Currency`
- **Epic List** (after the Epic 9 entry): the Epic 10 heading and one-line charter below.
- **New `## Epic 10` section** appended after `:3351`.

```
## Epic 10: Costs in Another Currency

Users can type a price in the currency it was quoted in and have the app convert it to
EUR, keeping what was entered and the rate that was applied so the stored figure stays
explainable.

### Story 10.1: A Price in Another Currency

As someone planning a trip outside the euro area,
I want to type a price in the currency the booking site quoted,
So that I stop running every number through a converter in another tab before I can
enter it.

**FRs covered:** FR41

**Depends on:** nothing.

**Context:** Every cost field is EUR by unstated convention — no control, no column, no
stored currency. For the New Zealand trip the PRD uses as its primary journey, that means
hand-converting every hotel and every activity, and storing a number that can no longer
be checked against what was quoted.

The design is decided by an invariant that already exists:
`sum(payments.amountCents) === costCents` is enforced as exact integer equality in
`accommodationSchemas.ts:92`, `dayPlanItemSchemas.ts:129`, and again on import at
`tripImportSchemas.ts:381`. Two independently rounded conversions can miss each other by
a cent; two conversions at rates fetched on different days miss by more. So the currency
is chosen **once per entry**, not once per field, and one rate converts the cost and all
its payment rows in a single submit.

The rate source is the ECB's own daily reference file — keyless, ~3 KB, all 30 rates,
published against EUR, which is the base this app already stores in. It is reached through
a session-gated server-side proxy of the same shape as `api/geocode/route.ts`, whose
comment already argues the courtesy-caching case for the app's other keyless public API.

**Acceptance Criteria:**

**Given** an accommodation and a day plan item
**When** the schema gains currency metadata
**Then** `Accommodation` and `DayPlanItem` each carry nullable `costOriginalAmount`,
`costCurrency`, `costRate` and `costRateDate`, `CostPayment` carries a nullable
`amountOriginal`, and a migration is added with no backfill — `NULL` is the correct and
complete description of every existing row

**Given** the currency and rate live on the parent entry and only the amount on the
payment row
**When** a reviewer asks whether two rates can apply within one entry
**Then** the schema is the answer: it cannot express that state

**Given** the accommodation dialog and the activity dialog
**When** a currency other than EUR is selected
**Then** one selector governs that entry's cost field and every one of its payment rows,
and the 31 options are EUR first, then the ECB's 30 by code

**Given** EUR is selected, which is the default
**Then** no rate is fetched, no metadata is written, and the stored result is byte-for-byte
what the same input stores today

**Given** amounts typed in a foreign currency
**When** the form is submitted
**Then** the payment-sum check runs **in the entered currency, before conversion**, so a
mismatch is reported in the numbers the user typed rather than in converted cents

**Given** a valid foreign-currency entry
**When** it converts
**Then** one rate serves the whole submit, `costCents = round(costOriginalAmount / rate)`,
each payment converts by that same rate, and the residual
`costCents - sum(converted payments)` is applied to the largest payment, ties broken
toward the last — so the sum invariant holds by construction and the server schema is
satisfied without being relaxed

**Given** the ECB publishes units of foreign currency per one euro
**When** the conversion is implemented
**Then** the rate is stored exactly as published, un-inverted, so it can be checked against
the ECB's own page, and a test asserts one hand-checked figure end to end — a round-trip
test alone would pass with the direction reversed

**Given** the rate lookup fails — network error, non-200, unparseable XML — or a currency
is not among the 30
**Then** the field degrades to plain EUR entry with an inline notice, never a blocking
error and never a silent zero, and the notice uses the caption-plus-icon treatment rather
than the `input` error state, because the field is not invalid

**Given** rates publish once daily around 16:00 CET
**When** several dialogs are opened in a session
**Then** the proxy serves a cached document rather than one outbound request per open,
and the weekend needs no special case — the daily file continues to serve the last TARGET
working day's rates with that date attached, which is what `costRateDate` records

**Given** an entry saved in a foreign currency
**When** it is reopened
**Then** the dialog shows the original amount and currency, not the EUR figure, and
saving with nothing changed leaves the stored values and the metadata untouched — it does
not silently re-convert at today's rate, and it does not drop the receipt

**Given** currencies without a minor unit, such as JPY and KRW
**When** a foreign amount is rendered
**Then** it renders through `Intl.NumberFormat` with that currency's own fraction digits,
never through `formatCentsAsAmount`, whose fixed two decimals and documented `=== "de"`
separator shortcut are correct only for the EUR field it was written for

**Given** the v2 backup archive
**When** a trip is exported and restored
**Then** all five new columns survive the round trip, and the import schema's own
`Payments must sum to costCents` check still passes on converted data

**Given** both dictionaries
**When** the field ships
**Then** `en.ts` and `de.ts` carry every new string — the selector label, the converted
caption, the rate-unavailable notice — and no key is added to one dictionary only

### Story 10.2: The Rate That Was Used, Where the Cost Is Read

As someone reviewing a plan weeks after entering it,
I want to see that 184,06 € was 200,00 NZD at a stated rate,
So that I can tell a correct conversion from a wrong one without opening the dialog.

**FRs covered:** FR41 (the explainability half)

**Depends on:** Story 10.1.

**Context:** 10.1 stores the receipt; without this story it is only visible to someone
reading the database. The metadata exists precisely so a figure can be checked and
corrected, and a figure nobody can see is not checkable.

Scope is display only — no new storage, no new lookup, no change to any total. Every
figure on every surface stays EUR; the original is an annotation beneath it, in
`{colors.ink-soft}`, never a second number competing with the first.

**Acceptance Criteria:**

**Given** an entry converted from a foreign currency
**When** its cost is shown on the day timeline `tl-card` and in the cost overview
**Then** the EUR figure keeps its existing prominence and tabular figures, and the
original amount, currency and rate appear as secondary text beneath it

**Given** an entry entered directly in EUR
**Then** nothing is added — no empty annotation, no placeholder, no layout shift against
today's rendering

**Given** the printed day plan and the offline PDF packet
**When** a converted cost appears
**Then** the annotation prints with it, because the printed plan is the artefact most
likely to be read away from the app

**Given** the `card` and `tl-card` components at 390px
**When** the annotation is added
**Then** it does not push a cost onto a second line or displace the time pill, and the
layout is verified at that width rather than assumed
```

### 4.3 Design System — `DESIGN.md`

**New component entry under `## Components`:**

```
NEW:
- **money-field** — A cost amount and the currency it is quoted in, as one field: the
  standard `input` (44px, {rounded.DEFAULT}) with a trailing `select` (44px) carrying the
  currency code. The select defaults to EUR and is the *entry's* control, not the field's
  — one selector governs a stay's cost and all of its payment rows, so a payment row
  renders the amount input alone. Beneath, a single caption line in {colors.ink-soft}
  showing the converted EUR figure, present only when the currency is not EUR.

  **The rate-unavailable state is a notice, not an error.** It uses the caption slot in
  {colors.warn} with the same small alert icon the `input` error line carries, and leaves
  the border and background at their default values. The `input` error treatment
  ({components.input.errorBorder} + {components.input.errorBg}) is reserved for a value
  the user must fix; an unreachable rate feed is not that — the field is valid, it is
  simply EUR now.

  The currency code renders in tabular figures' company but is not itself numeric; the
  converted caption is, and follows the system's hard rule that any compared numeric value
  uses tabular figures.
```

Plus a `components.money-field` token block for the select width, the caption spacing, and
the icon size, following the `doc-chip` block's shape.

### 4.4 Architecture — `architecture.md`

**Section: Integration Points → External Integrations (`:453-456`)**

```
OLD:
**External Integrations:**
- Maps (future): `components/features/trips/` and `components/features/days/`
- Routing (future): server integration in `lib/services/maps.ts`

NEW:
**External Integrations:**
- Maps (future): `components/features/trips/` and `components/features/days/`
- Routing (future): server integration in `lib/services/maps.ts`
- Exchange rates: ECB `eurofxref-daily.xml`, reached through the session-gated proxy at
  `app/api/exchange-rates/route.ts` and cached in-process. Keyless and EUR-based; adds no
  dependency, no secret and no deployment step. Failure is non-blocking — see FR41.
```

No decision in *Core Architectural Decisions* is reversed. SQLite, Prisma Migrate, REST +
Zod, the auth model and the deployment shape are all unchanged.

### 4.5 Sprint Status — `_bmad-output/implementation-artifacts/sprint-status.yaml`

```
NEW (appended after the epic-9 block):
  epic-10: backlog
  10-1-a-price-in-another-currency: backlog
  10-2-the-rate-that-was-used: backlog
  epic-10-retrospective: optional
```

---

## 5. Implementation Handoff

**Scope classification: Moderate.** A new epic and backlog entries mean Product Owner /
Developer coordination, not a direct developer hand-off — but no replan, no architect
escalation, and no strategic question is open.

| Recipient | Responsibility |
|---|---|
| **PM (John)** | Apply §4.1 to `prd.md` and §4.2 to `epics.md`; append the `epic-10` block to `sprint-status.yaml`. |
| **UX (Sally)** | Apply §4.3 to `DESIGN.md` — the `money-field` entry and its token block — and confirm the 390px behaviour the two stories' criteria assume. |
| **Architect (Winston)** | Apply §4.4 to `architecture.md`. One paragraph; no decision review needed. |
| **Dev (Amelia)** | Story 10.1, then 10.2, via the usual `bmad-create-story` → `bmad-dev-story` path. |

**Success criteria:**

1. A price quoted in NZD is entered as NZD and stored as EUR, with no external converter.
2. A stay with a foreign cost and multiple payment rows saves, and restores from a backup, without tripping the sum invariant in any of its three enforcement sites.
3. An entry made in EUR behaves byte-for-byte as it does today.
4. With the ECB feed unreachable, every cost field still accepts a value.
5. Reopening a converted entry shows what was typed, and re-saving it unchanged changes nothing.
6. A converted figure is explainable from the screen it appears on.

**Open, and deliberately not closed here:**

- **The fourth column.** This proposal carries `costRateDate` in addition to the three columns agreed during scoping. It is what makes the receipt readable as *"0,9203 on 20.09.2026"* rather than a bare unexplained number, and it is what records which publication a weekend entry actually used. It is one nullable column and Tommy can cut it — the rest of the design does not depend on it.
- **The 30-currency ceiling.** VND, EGP, MAD, ARS and others fall to the manual path. Accepted knowingly. If a trip ever makes this bite, the way out is a keyed provider behind the same proxy route, which is a contained change precisely because the lookup sits behind one route from the start.
- **The rate is the entry day's, not the payment day's.** A cost entered in March and paid in August is recorded at March's rate. That is the agreed meaning of the number — a planning estimate — and `costOriginalAmount` plus `costRateDate` are what make a later correction possible if it ever matters.
