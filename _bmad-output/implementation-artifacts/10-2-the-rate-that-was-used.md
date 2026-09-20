---
baseline_commit: 5c44eb02a5aea65be3c906a70928d2f85bd25bff
---

# Story 10.2: The Rate That Was Used, Where the Cost Is Read

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As someone reviewing a plan weeks after entering it,
I want to see that 184,06 € was 200,00 NZD at a stated rate,
so that I can tell a correct conversion from a wrong one without opening the dialog.

## Scope corrections carried into this story

Two of the four surfaces the epic names do not behave the way its wording assumes. Both were
verified against the working tree at `5c44eb0` before this story was written. Read these before
reading the ACs — they change what AC5 and AC6 ask for.

**1. The printed day plan renders no cost at all today.** `TripDayPrintDocument.tsx` (686 lines) has
zero money rendering: it never imports `formatCost`, never calls `Intl.NumberFormat` with
`style: "currency"`, and never reads `stay.costCents` or `item.costCents` — although the print
payload already carries `costCents` on both (`tripRepo.ts:256-268`, `:270-281`). So the epic's
"*when* a converted cost appears **then** the annotation prints with it" can never fire: there is no
figure to print beneath. Taken literally the AC is vacuous.

It is not read literally here. The stated reason — "the printed plan is the artefact most likely to
be read away from the app" — is an argument for the cost being legible on paper, and an annotation
with nothing above it is not a thing that can exist. **AC5 therefore adds the EUR cost figure to the
print sheet's two entry cards and annotates it.** `costCents` is already selected and typed on that
payload and merely never rendered, so this completes a path that is nine-tenths built rather than
opening a new one. The four currency columns are the genuinely missing part (Task 4).

**2. The offline PDF packet is out of scope, and this is a reduction against the epic.** The packet
is not a rendering of the day plan. `buildDocumentPacket` (`packetPdf.ts:665-848`) emits a label page
followed by the document itself, per attached document, and the only text it ever draws is four
strings in `drawLabelPage` (`:412-461`): a heading, the entry label, the file name, and a failure
sentence. It has no itinerary, no entries and no cost figures, so there is no converted cost in it to
annotate. Putting a price onto a label page whose job is to announce "this is the Hilton booking PDF"
would be inventing a new content type, not satisfying an AC.

Three further facts make it a separate piece of work rather than a line of code:

- `toWinAnsiText` (`packetPdf.ts:126-143`) replaces every character outside `0x20–0x7E` and
  `0xA0–0xFF` with `?`. **`€` and `≈` both degrade to `?`** — deliberately, per the docblock at
  `:98-122`, because WinAnsi maps `\x80-\x9F` by different code points than Unicode and admitting
  them means carrying a transcoding table. Money text in the packet needs that decision made first.
- `drawLabelPage` has no `y = 0` floor check (`printDocuments.ts:60-66`). Extra lines pushed onto a
  fixed-height label page are still drawn, below the paper, with no change to page count or size.
- `printDocuments.ts` is document-only and must stay free of any `"use client"` module below it
  (`:16-21`), because the Node route handler imports it. Threading per-entry costs through
  `PacketDocument` is a change to that contract.

**Do not touch the packet in this story.** File the gap as deferred work (Task 9) so the reduction is
recorded rather than silently dropped.

## Acceptance Criteria

1. **One renderer, one rule, every surface.** A single pure helper decides whether an annotation
   exists and what it says. It returns `null` unless `amountOriginal`, `costCurrency` and `costRate`
   are all present and valid; no surface re-implements that test. The amount renders through
   **`formatForeignAmount`** (`convertCost.ts:114-140`) — Story 10.1's AC12, as amended on
   2026-09-20, names it "the renderer for every display surface" and says its first production caller
   arrives with this story. Do not change it, and do not add `minimumFractionDigits` to it: `¥5000`
   must render `5.000 ¥`, never `5.000,00 ¥`.

2. **A converted entry is annotated where its cost is read.** On the day timeline's activity
   `tl-card` and stay `tl-card`, in the day's cost breakdown list, and in the cost overview's
   per-entry and per-payment rows, the EUR figure keeps its existing prominence, weight and tabular
   figures, and the original amount, currency and rate appear as secondary text beneath it in
   `{colors.ink-soft}` with tabular figures.

3. **A EUR entry is untouched.** No annotation, no empty element, no placeholder, no reserved height,
   no change to any existing spacing. A day with no foreign entry renders byte-identically to today.
   Every existing assertion in `tripDayViewLayout.test.tsx`, `tripCostOverview.test.tsx` and
   `tripDayPrintDocument.test.tsx` passes **unmodified** except where this story deliberately adds a
   figure (AC5), and the diff to those files is additive.

4. **No aggregate is ever annotated.** The day stat strip's spend cell, the day cost card total, the
   cost overview's day subtotal, its month total and its trip total are sums over entries that may
   carry different currencies, and there is no single original amount for them. They render exactly
   as today. This is a rule about what the annotation means, not an omission to be tidied up later.

5. **The printed day plan carries the cost and its annotation.** The stay card and the plan-item card
   on the print sheet render the EUR cost when one is recorded, and the annotation beneath it when
   the entry is converted. The print payload is extended to carry the four currency columns. See
   *Scope corrections* above for why this AC adds the figure rather than only annotating it.

6. **The offline PDF packet is unchanged.** `packetPdf.ts`, `printDocuments.ts` and the packet route
   are not modified, and `documentPacketPdf.test.ts` / `tripDayDocumentPacketRoute.test.ts` pass
   untouched. The gap is recorded as a deferred-work entry, not left implicit.

7. **~~A payment row annotates from its own amount and its parent's rate.~~ SUPERSEDED by the code
   review of 2026-09-20 — a payment row carries no receipt at all.** A row's stored `amountCents` is
   not `round(amountOriginal / rate)`: `convertEntryToCents` sweeps a signed rounding residual into
   the largest row so that `sum(payments) === costCents` stays exact, so one row is routinely a cent
   away from what its own figures divide to, and a receipt there contradicts the figure above it.
   Entry-level rows — the days tab, and a months-tab row synthesized from an entry's own cost — keep
   their receipt, because there the euro figure *is* `round(original / rate)` by construction. The
   original wording follows, for the record: In the cost overview's
   months tab a row is a `CostPayment`, so its original figure is `payment.amountOriginal`, while the
   currency and rate come from the parent entry — the schema has no currency on `cost_payments` and
   none is added. When a foreign parent has a payment row whose `amountOriginal` is absent, that row
   renders **no annotation**; it is never reconstructed by dividing. `PaymentDetail.amountOriginal`
   is optional outbound (`paymentDetail.ts:20-32`), so absence is a normal wire state, not a fault.

8. **The annotation follows the gate above it.** The activity card renders its cost on a truthiness
   check (`item.costCents ?`, `TripDayView.tsx:3960`, so a recorded `0` prints nothing) while the
   stay card uses `typeof … === "number"` (`:4145`, so `0` prints `€0.00`). The annotation sits inside
   whichever gate it belongs to. An annotation with no figure above it is a defect.

9. **390px holds.** At 390px the annotation does not push a cost onto a second line, does not displace
   or shrink the time pill, and does not introduce horizontal overflow. A `tl-card`'s content width at
   that viewport is **290px** (measured table, `TripDayView.tsx:110-153`), and the activity card's
   head is a `1fr auto` grid whose trailing cell is content-sized — a wide annotation there squeezes
   the title. Verified in a browser at 390px, not asserted in jsdom, which lays nothing out.

10. **Both dictionaries.** Every new key exists in `en.ts` **and** `de.ts`.
    `test/i18nDictionaries.test.ts` fails the build on a one-sided key — do not work around it. Any
    new key drawn on the print sheet is added to its `DAY_PRINT_KEYS` list (`:799-822`); **no key is
    added to `PACKET_LABEL_KEYS`**, which would assert a WinAnsi constraint this story does not need.

## Tasks / Subtasks

- [x] **Task 1 — The shared annotation helper (AC: 1, 7)**
  - [x] Add to `src/lib/trips/convertCost.ts`, beside `formatForeignAmount`, which is already that
        module's stated display half ("rendering a foreign amount back out for display", `:1-3`):
        ```ts
        export const formatExchangeRate = (rate: number, language: Language) => …
        export const formatCostOriginal = (
          receipt: { amountOriginal?: number | null; currency?: string | null; rate?: number | null },
          language: Language,
          template: string,
        ): string | null => …
        ```
  - [x] `formatCostOriginal` returns `null` unless `amountOriginal` is a finite number, `currency` is
        a non-empty string and `rate` is finite and `> 0`. Otherwise `formatMessage(template, {
        amount: formatForeignAmount(amountOriginal, currency, language), rate:
        formatExchangeRate(rate, language) })`.
  - [x] **Wording is a parameter, not a `t` lookup.** `printDocuments.ts:55-58` already establishes
        this shape for a module both a client screen and a Node route consume, and it keeps
        `convertCost.ts` pure and directly testable. Pass `t("trips.money.originalCaption")` in.
  - [x] `formatExchangeRate` uses `INTL_LOCALES[language]` with `{ minimumFractionDigits: 2,
        maximumFractionDigits: 5 }` and **no** `style: "currency"` — the rate is a ratio, not money.
        Five digits covers the ECB's widest published precision; two keeps `1.5` from printing as a
        bare `1,5`. Do not add an eleventh `=== "de"` ternary (DW-281).
  - [x] Do not modify `formatForeignAmount`, `formatCost` or `parseAmount.ts`. `formatCost` stays
        EUR-hardcoded (DW-217 is explicitly out of scope).
  - [x] **One test hook, spelled the same on every surface: `data-testid="cost-original-annotation"`.**
        Five render sites across three files will each be tempted to invent their own, and a suite
        that cannot ask one question of every surface is how AC3's "no annotation on a EUR entry"
        ends up proven on one screen and assumed on the rest.

- [x] **Task 2 — i18n (AC: 10)**
  - [x] Add to **both** dictionaries, beside the existing `trips.money.*` block
        (`en.ts:708-719`, `de.ts:635-642`):
        `"trips.money.originalCaption"` — en `"{amount} at {rate}"`, de `"{amount} zu {rate}"`.
  - [x] Add to **both** dictionaries in the `trips.dayPrint.*` block for Task 5's figure:
        `"trips.dayPrint.cost"` — en `"Cost: {value}"`, de `"Kosten: {value}"`.
  - [x] Do **not** reuse `trips.money.convertedCaption` (`"≈ {value}"`). It points the other way — in
        the dialogs it shows the EUR equivalent of a foreign amount typed into the box, and this story
        shows the foreign original beneath a EUR figure. One key serving both directions would make
        either one's wording unchangeable.
  - [x] Do **not** render `costRateDate` on these surfaces. The AC names "the original amount,
        currency and rate"; the publication date stays where Story 10.1 put it, on `MoneyField`'s
        second caption line in the dialog (`MoneyField.tsx:205-219`). A third value on a 290px card is
        the layout risk AC9 exists to prevent, and the date is one dialog-open away.
  - [x] Add `"trips.dayPrint.cost"` to `DAY_PRINT_KEYS` in `test/i18nDictionaries.test.ts:799-822`.
        Leave `PACKET_LABEL_KEYS` alone.

- [x] **Task 3 — Day timeline (AC: 2, 3, 4, 8, 9)**
  - [x] `TripDayView.tsx`. **No type or plumbing work is needed for the two cards**: Story 10.1
        already landed the four fields on the day type (`:318-334`), the plan-item type (`:335-358`),
        the `DayPlanItem` state shape (`:372-389`) and the `planItems` mapping (`:959-986`), and
        `currentStay` (`:1809-1811`) is `day.accommodation` assigned wholesale. `item.costCurrency` is
        in hand at line 3960 today.
  - [x] **Activity card**, `:3948-3968`. The head is `tlCardTopSx`, a `grid` of `"1fr auto"` with
        `alignItems: "center"` (`:2227-2232`); the trailing `auto` cell is a flex row holding
        `[cost pill][edit glyph]`. Put the annotation inside that trailing cell as a column beneath
        the pill — `[column: (row: pill, glyph) / annotation]` — so the glyph stays beside the pill.
        Give the column `minWidth: 0` and the annotation `overflowWrap: "anywhere"`; do **not** give
        it `whiteSpace: "nowrap"`, which `costPillSx` carries for the pill's own reasons (`:2176`).
  - [x] Gate it on the same `item.costCents ?` truthiness as the pill (AC8), inside the existing
        conditional so a costless activity is untouched.
  - [x] **Stay card**, `:4136-4148`. The cost sits in a `flexWrap: "wrap"` status row beside the
        booked/planned `Chip`, and that row is the first child of a `flexDirection: "column"; gap:
        0.75` stack. Insert the annotation as the **next sibling of the status row**, not inside it —
        inside puts it beside the amount on the same wrap line, not beneath. Gate on the same
        `typeof currentStay.costCents === "number"` (AC8).
  - [x] The previous-night stay card (`:3769-3830`) renders no cost, so it gets nothing. Note the
        "these two cards are duplicated wholesale" comment at `:4149-4160` before editing either.
  - [x] **Cost breakdown list**, `:4226-4254`. This is the one site needing real data work:
        `budgetEntries` (`:2849-2871`) builds `{ id; label; amountCents }` and drops every currency
        field. Widen that object to carry `costOriginalAmount`, `costCurrency` and `costRate` from
        `item` and from `currentStay`, **and widen the type predicate in the `knownBudgetEntries`
        filter (`:2873-2879`) in lockstep** — it is an explicit `entry is { id; label; amountCents:
        number }`, so a stale predicate silently narrows the new fields back off.
  - [x] The `li` is `display: flex; justifyContent: space-between`. Wrap the amount in a
        `Box sx={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}` so the
        annotation sits under it and stays right-aligned. Keep `whiteSpace: "nowrap"` on the amount.
  - [x] **Do not annotate** the stat-strip spend cell (`:3583-3593`) or the cost card total
        (`:4197-4212`) — both render `dayTotalCents` (AC4). The stat strip is additionally a grid
        whose row is as tall as its tallest cell, inside an `overflow: hidden` wrapper (`:3142`); a
        second line there is the exact defect Story 6.21 removed. Read `:2200-2211` before touching it.
  - [x] Style the annotation from the file's own secondary-text pattern — `fontSize: 11, fontWeight:
        600, color: tokens.inkSoft`, plus `fontVariantNumeric: "tabular-nums"` (DESIGN.md:241 makes
        tabular figures a hard rule for any new numeric display). The orphan-segment label at
        `:3684-3689` is the closest in-file precedent. **No colour literals** — `tokens.inkSoft` only.
  - [x] A plain `Typography` is click-through under `overlaidContentSx` (`:2307-2314`), so the card
        stays one edit target. Do not give it `pointerEvents: "auto"`.

- [x] **Task 4 — Print payload (AC: 5)**
  - [x] `src/lib/repositories/tripRepo.ts`. Add `costOriginalAmount`, `costCurrency`, `costRate`,
        `costRateDate` to **all four** of: `PRINT_ACCOMMODATION_SELECT` (`:1377-1389`), the plan-item
        select (`:1431-1443`), `toPrintStay` (`:1557-1571`) and the plan-item mapper (`:1576-1589`).
  - [x] Add the same four to the `TripDayPrintStay` (`:256-268`) and `TripDayPrintPlanItem`
        (`:270-281`) types. `costRateDate` is `string | null`, not a `Date` — match `TripDaySummary`
        (`:168-205`), which already carries all four and is the shape to copy.
  - [x] Do **not** add the `payments` relation to this payload. The print sheet shows an entry's cost,
        not its schedule, and pulling a relation nothing renders is cost with no benefit.
  - [x] `tripRepo.ts` contains a NUL byte around offset 74688, so plain `grep` treats it as binary and
        prints nothing. Use `rg` or `grep -a` on this file.

- [x] **Task 5 — Print sheet (AC: 5, 3)**
  - [x] `TripDayPrintDocument.tsx`. Import `formatCost` from `@/lib/trips/formatCost` (the shared one
        — this file has no local copy and must not grow one) and `formatCostOriginal` from
        `@/lib/trips/convertCost`. `language` and `t` are already in hand at `:94`.
  - [x] **Stay card**, `:481-500`: render the cost after the check-in/check-out line and before
        `stay.notes`, when `typeof stay.costCents === "number"` **and `entry.kind ===
        "currentStay"`**.
  - [x] That second condition is load-bearing and is the one part of this task a reader will get
        wrong. Unlike the day view, where the previous-night card is separate JSX that renders no cost
        (`TripDayView.tsx:3769-3830`), the print sheet draws **both** stay kinds through this one
        block and distinguishes them only inside it, for check-in against check-out. Rendering the
        cost unconditionally would print the same nightly rate on two consecutive days' sheets — once
        as tonight's stay and again as tomorrow's previous night — which reads as a double charge on
        the artefact least able to explain itself. Tonight's stay only, matching the screen.
  - [x] **Plan-item card**, `:544-555`: render the cost after the `label` line and before
        `description`, when `typeof item.costCents === "number"`.
  - [x] Both use `formatMessage(t("trips.dayPrint.cost"), { value: formatCost(cents, language) })`,
        then the annotation beneath when `formatCostOriginal` returns non-null.
  - [x] Match the file's existing idiom exactly: plain `<div>` with an inline `style={{}}` object, no
        MUI, no `sx`. The neighbouring secondary lines are `{ fontSize: "11px", color: "#555" }` and
        `{ fontSize: "11px", color: "#444", marginTop: "2px" }` — use the same shape for the
        annotation. This file is **not** covered by `expectNoHardcodedColour` (it already carries
        `background: #fff` in its print CSS at `:228`), so a hex here is consistent rather than a
        violation; do not introduce `theme.palette` into a document that deliberately has no MUI.
  - [x] Do not touch the `<style>` block at `:217-283`. Its own comment warns: no backticks anywhere
        inside it, because it is a JS template literal and one would end it.

- [x] **Task 6 — Cost overview (AC: 2, 3, 4, 7)**
  - [x] `TripCostOverview.tsx`. **Widen the local `TripDay` type first** (`:42-61`). The API already
        sends all five columns (`api/trips/[id]/route.ts:77-99` and `:113-119`, fed by
        `getTripWithDaysForUser`'s selects at `tripRepo.ts:1075-1094` / `:1097-1120`), but the
        response is cast through `ApiEnvelope<TripDetail>` at `:277`, so the data is present at
        runtime and invisible to TypeScript. Mirror `TripDayView.tsx:318-358`: four optional nullable
        fields plus `payments?: { amountCents; dueDate; amountOriginal?: number | null }[]`.
        **No API, route or repository change is needed here** — only the client type and the render.
  - [x] **Days tab.** Carry the three receipt fields onto `DayEntry` (`:74-78`) in `buildDayEntries`
        (`:111-133`), from `item` at `:117-121` and from `day.accommodation` at `:125-130`. Annotate
        the per-entry amount at `:474-482`. That cell is the `auto` column of a
        `minmax(0, 1fr) auto` grid with `alignItems: "baseline"`, so wrap amount + annotation in a
        right-aligned column rather than adding a third grid child.
  - [x] **Months tab.** ~~Carry `currency` and `rate` **from the parent entry** and `amountOriginal`
        **from the payment row**~~ — **amended by the code review**: the two *payment* push sites
        (accommodation `:142-150`, item `:167-175`) carry no receipt fields at all, so
        `formatCostOriginal` answers `null` there as a fact about the data rather than a rule the
        render site has to remember. Only the two *fallback* sites (`:152-158`, `:180-186`), which
        synthesize from the entry's own `costCents`, carry them. The two fallback rows synthesize from the
        entry's own `costCents`, so their original is the entry's `costOriginalAmount`; the two
        payment rows use `payment.amountOriginal`, which may be absent (AC7 — render nothing, never
        divide). Annotate the amount at `:546-552`.
  - [x] **Do not annotate** the day subtotal (`:489-498`), the month total (`:518-528`) or the trip
        total (`:333`, `:562-568`) — all aggregates (AC4).
  - [x] Style from this file's own secondary pattern: `variant="body2"` with
        `sx={{ color: tokens.inkSoft, fontVariantNumeric: "tabular-nums" }}`. **This file *is* covered
        by `expectNoHardcodedColour`** (`test/tripCostOverview.test.tsx:78`) — tokens only, and note
        the guard also rejects quoted named colours.
  - [x] `TripTimeline.tsx` and `TripsDashboard.tsx` are **not touched**. Every cost they render is an
        aggregate (`plannedCostTotal`, `accommodationCostTotalCents`, a per-trip total), and
        `TripTimeline`'s `TripDay` type carries no per-entry cost at all. Leave its local duplicate
        `formatCost` (`:278-287`) alone; converging the copies is DW-27/DW-217, not this story.

- [x] **Task 7 — Tests (AC: 1-8, 10)**
  - [x] Extend `test/convertCost.test.ts`: `formatCostOriginal` returns `null` for each missing or
        invalid field (absent amount, absent currency, `rate` of `0`, negative rate, `NaN`), renders
        the hand-checked `200,00 NZD` case in both languages, and renders a JPY amount with **no**
        fraction digits — the `¥5000` case AC12 has been holding in this suite since 10.1 now has a
        production caller. Pin `formatExchangeRate` separately, including that it emits no currency
        symbol and that German gets a decimal comma.
  - [x] Extend `test/tripDayViewLayout.test.tsx`: a foreign activity's card shows the EUR pill **and**
        the annotation; a foreign stay shows both; the breakdown list row shows both; a EUR day
        renders **no** annotation element anywhere; the two totals carry none even when every entry on
        the day is foreign. Query the annotation by a new `data-testid`, not by text.
  - [x] Extend `test/tripCostOverview.test.tsx`: a foreign entry annotates in the days tab; a foreign
        payment row annotates in the months tab from its own `amountOriginal`; a foreign parent whose
        payment row has no `amountOriginal` renders that row with no annotation; the day subtotal,
        month total and trip total are never annotated. Its fixtures build `payments: [{ amountCents,
        dueDate }]` at `:106`, `:114`, `:128`, `:280`, `:305`, `:312` — extend, do not rewrite.
  - [x] Extend `test/tripDayPrintDocument.test.tsx`: the sheet prints the EUR cost for tonight's stay
        and for a plan item, prints the annotation for a converted one, prints neither for
        `costCents: null` (the value both existing fixtures use at `:33` and `:49`), and prints the
        cost with no annotation for a EUR entry. Add a German case — DW-230 made the whole sheet
        translated and the suite already guards that.
  - [x] Pin the previous-night rule explicitly: a **previous-stay** card with a cost prints **no**
        cost and no annotation. The existing suite already queries these by
        `data-testid="print-timeline-entry"` with `data-kind` (`TripDayPrintDocument.tsx:465-466`),
        so the two kinds are separable without new hooks. Without this case the shared-block trap in
        Task 5 regresses silently.
  - [x] Extend `test/tripDayPrintRoute.test.ts`: the payload carries the four currency columns on both
        a stay and a plan item. It asserts nothing about cost fields today, which is how Task 4's
        omission would otherwise ship invisibly.
  - [x] Extend `test/i18nDictionaries.test.ts`: both new keys present in both languages, and
        `trips.money.originalCaption` contains both `{amount}` and `{rate}` in both — the
        placeholder-presence pattern already used for `{count}` at `:962-999`. Add a length ceiling
        on the rendered annotation's template so a "clearer" longer wording has to argue with a test;
        the stat-strip ceiling at `:340-350` is the precedent, and AC9's 290px is the reason.
  - [x] `test/documentPacketPdf.test.ts`, `test/tripDayDocumentPacketRoute.test.ts` and
        `test/documentPacketLastResortLabel.test.ts` must pass **unmodified** (AC6).
        `test/printDocuments.test.ts` was originally listed here too; the code review of 2026-09-20
        **accepted** its modification, so the bullet no longer claims it. Task 4 requires the four new
        payload fields to be required, matching `TripDaySummary`, and that file's `stay`/`item`
        factories are typed as the payload's own types, so `typecheck` fails without eleven lines of
        `null` defaults. No assertion, `it(` or `describe(` was touched, and AC6 itself never named
        that file.
  - [x] `npm run lint && npm run typecheck && npm test` all clean. No new dependency.

- [x] **Task 8 — Browser verification at 390px (AC: 9)**
  - [x] jsdom lays nothing out, so no assertion in Task 7 proves AC9 — `tripDayViewLayout.test.tsx`
        says so itself at `:7727`. Verify in a real browser at 390px, in **German** (the longer words,
        per `:5343`), on a day carrying a foreign stay and a foreign activity with a long title:
        the cost stays on one line, the time pill is neither displaced nor shrunk, the card title is
        not squeezed onto an extra line, and the page has no horizontal overflow.
  - [x] Check the cost overview's months tab at 390px too — its entry grid collapses to a single
        column at `xs` (`:534`), so the annotation lands under a full-width amount there.
  - [x] Record what was measured in the Dev Agent Record. If it does not hold, the fix is the
        annotation's wrapping, not the cost's.

- [x] **Task 9 — Record the packet gap (AC: 6)**
  - [x] Add one entry to `_bmad-output/implementation-artifacts/deferred-work.md` in the house format
        (`source_spec`, `origin`, `location`, `severity`, `summary`, `evidence`, `status: open`),
        recording that the offline PDF packet shows no costs and therefore no conversion receipt, and
        naming the three obstacles from *Scope corrections* above: the packet carries no itinerary,
        `toWinAnsiText` degrades `€` and `≈` to `?`, and `drawLabelPage` has no page-floor check.
  - [x] `severity: low` — the packet's job is to carry documents offline and it does that; the
        receipt is reachable on the printed sheet, which is the artefact AC5 covers.

### Review Findings

Adversarial code review, 2026-09-20. Three parallel layers (Blind Hunter, Edge Case Hunter,
Acceptance Auditor) against the diff from `5c44eb0`. 18 findings after deduplication, 4 dismissed.
Gates re-verified independently at review time: `npm run lint` 0 errors / 80 warnings (baseline),
`npm run typecheck` clean, `npm test` 157 files / 2599 tests passing.

**Decisions needed**

- [x] [Review][Decision — RESOLVED: annotate the parent only] A split payment's receipt does not reconcile with the euro figure above it — `convertEntryToCents` sweeps a signed rounding residual into the largest row so that `sum(payments) === costCents` holds exactly, so a row's stored `amountCents` is not always `round(amountOriginal / rate)`. AC7 mandates annotating each row from its own `amountOriginal` and the parent's rate, so the months tab prints the swept figure beside a receipt that cannot reproduce it. Verified by execution: `costOriginalAmount: 10000` at `1.8563` split `5000`/`5000` stores rows of `2694` and `2693`, and both are annotated `NZ$50.00 at 1.8563` while `50.00 / 1.8563 = 26.9353`. At most one cent per sweep, and the totals remain exact. This is DW-357's root cause reaching a read surface — note that the story excluded DW-357 on the grounds that it "reads stored values only and cannot reproduce it", which no longer holds. The new fixture (2×10000 at 1.8563) has a zero residual, so the suite does not reach it. Options: suppress the annotation on payment rows of a split schedule, annotate the parent entry only, accept and fold into DW-357, or accept as designed. [`TripCostOverview.tsx:188`, `:222`, rendered `:644`]
- [x] [Review][Decision — RESOLVED: a zero cost is a euro entry] A zero-cost foreign activity prints on paper what the screen deliberately hides — `refineCostCurrency` refuses `costCents: null` with a receipt but permits `costCents: 0`, so a foreign entry of `NZ$0.00` is storable with complete metadata. AC8 blesses the activity card's truthiness gate (`item.costCents ?`, renders nothing) while Task 5 prescribes `typeof item.costCents === "number"` for the print card (renders). The sheet therefore prints `Kosten: 0,00 €` with `0,00 NZ$ zu 1,8563` for an entry the day view shows as having no cost. Both gates are spec-mandated; the divergence between them appears unintended. The stay card is unaffected (it uses `typeof` on both surfaces). [`TripDayPrintDocument.tsx:122` vs `TripDayView.tsx:4042`]
- [x] [Review][Decision — RESOLVED: reworded to `{rate}/EUR`] The receipt never states which direction the rate runs — the stored rate is ECB units of foreign currency per one euro, so `NZ$200.00 at 1.8563` beside `€107.74` requires the reader to divide. A reader who multiplies gets `€371.26` and concludes the stored figure is wrong. The dialogs carry a currency selector and a rate-date caption for context; the four read surfaces carry neither, and the print sheet is the artefact the story itself calls least able to explain itself. German `zu` reads as "to/into", i.e. as a conversion target rather than a rate. Note the new 8-character wording ceiling in `i18nDictionaries.test.ts` leaves no room for `" je EUR"` or `" per EUR"`, so changing this means changing that test too. Options: reword both keys and raise the ceiling, add the direction once per surface rather than per row, or accept. [`en.ts:723`, `de.ts:646`]
- [x] [Review][Decision — RESOLVED: accepted, Task 7 bullet corrected] `test/printDocuments.test.ts` was modified although its Task 7 bullet says it must pass unmodified — eleven lines of `null` defaults added to the `stay` and `item` factories. Self-disclosed in the Completion Notes and genuinely forced: Task 4 requires the four new payload fields to be required, matching `TripDaySummary`, and those factories are typed as the payload's own types, so `typecheck` fails without them. No assertion, `it(` or `describe(` was touched, and AC6 proper names only `documentPacketPdf.test.ts` and `tripDayDocumentPacketRoute.test.ts`. Needs an accept-or-revert rather than a code change: accepting means correcting the bullet's text; reverting means making the payload fields optional, which contradicts Task 4. [`test/printDocuments.test.ts:38-43`, `:60-64`]

**Patches**

- [x] [Review][Patch — APPLIED] The days tab renders a receipt under a dash — `renderCostAnnotation(entry)` is called unconditionally beneath a cell that resolves to `"-"` with `data-testid="cost-missing"` when `entry.amountCents === null`, producing the annotation-without-a-figure case the file's own comments call a defect. Held off today only by `refineCostCurrency`'s "Currency metadata requires a cost" in a different layer; nothing in the renderer enforces it. The other sites are safe because their amount is never null, not because they gate — so this is the one place a figure can be absent while its receipt renders. Fix: gate on `entry.amountCents !== null`. [`travelplan/src/components/features/trips/TripCostOverview.tsx:571`]
- [x] [Review][Patch — APPLIED] `trips.money.originalCaption` is drawn on the print sheet but absent from `DAY_PRINT_KEYS` — `renderCost` calls `t("trips.money.originalCaption")` and draws it, so the sheet now draws two new keys, not one; only `trips.dayPrint.cost` was registered. The list's docblock states its criterion is "Every key the print sheet draws" and it already carries six `trips.travelSegment.*` keys for exactly that reason, and the comment added beside the new entry — "Nothing else on the sheet renders money" — is false as written. Coverage is not actually lost: the story's own new block asserts the same existence and non-emptiness per language, which is all `DAY_PRINT_KEYS` asserts. Registry hygiene, one line plus the comment. [`travelplan/test/i18nDictionaries.test.ts:826`]
- [x] [Review][Patch — APPLIED] `renderCostAnnotation` reads `tokens` from above its own `const` — the helper is declared at `:284` and dereferences `tokens.inkSoft` at `:295`, while `const tokens = theme.palette.tokens` is at `:303`. Safe today only because the closure is not invoked until JSX evaluation, and it splits the component's hook block. Any refactor that evaluates it eagerly — a `useMemo`, an early return, or memoising it the way `TripDayView.tsx:849` already does with `tokens.inkSoft` in its dep array — throws `ReferenceError: Cannot access 'tokens' before initialization` at render. `TripDayView` places the same helper after its `tokens`; this file is the odd one out. Fix: move the helper below `useTheme()`. [`travelplan/src/components/features/trips/TripCostOverview.tsx:284`]
- [x] [Review][Patch — APPLIED] The annotation's style override is typed `sx?: Record<string, unknown>` — spread into a `Typography`'s `sx`, so a misspelled property, a wrong unit type or a nonsense value passes silently and does nothing. The three call sites each pass a different hand-tuned override, and the file's own comments record that those differences were arrived at by measuring at 390px, which is exactly the kind of value a typo would quietly discard. Fix: type it `SxProps<Theme>`. [`travelplan/src/components/features/trips/TripDayView.tsx:852`]

**Deferred**

- [x] [Review][Defer] A stored rate outside the 2–5 fraction-digit window truncates, or prints `at 0,00` [`travelplan/src/lib/trips/convertCost.ts:154`] — deferred, recorded as DW-363
- [x] [Review][Defer] A zero-exponent currency with a fractional hundredths amount misstates the original [`travelplan/src/lib/trips/convertCost.ts:126`] — deferred, recorded as DW-364
- [x] [Review][Defer] A long receipt breaks mid-number on the two cards and overflows in the breakdown list [`travelplan/src/components/features/trips/TripDayView.tsx:4052`, `:4243`, `:4342`] — deferred, recorded as DW-365
- [x] [Review][Defer] The cost overview's receipt fields are optional against a cast envelope, so a wire-shape change silently removes the annotation [`travelplan/src/components/features/trips/TripCostOverview.tsx:53-63`] — deferred, pre-existing pattern, recorded as DW-366
- [x] [Review][Defer] The receipt has no programmatic association with the amount it explains [`travelplan/src/components/features/trips/TripCostOverview.tsx:565`] — deferred, recorded as DW-367
- [x] [Review][Defer] AC3's "byte-identically" is unevidenced — the EUR-path wrappers are emitted unconditionally [`travelplan/src/components/features/trips/TripDayView.tsx:4036`, `:4342`] — deferred, recorded as DW-368

**What was applied, 2026-09-20**

All four decisions were resolved by Tommy and all seven resulting patches applied. Gates after the
patches: `npm run lint` 0 errors / 80 warnings (unchanged baseline), `npm run typecheck` clean,
`npm test` **157 files / 2602 tests passing** — three tests more than the story shipped with.

- **Months tab payment rows carry no receipt** (`TripCostOverview.tsx`). The two payment push sites
  no longer carry `costOriginalAmount`, `costCurrency` or `costRate`; the two entry-level fallback
  sites keep them. AC7 and Task 6 amended above. The suite gained a case at the residual itself
  (200,00 NZD split 50,00/50,00 → rows of 2694 and 2693), which the original fixture could not reach
  because its 100,00/100,00 split has a zero residual.
- **A zero cost is a euro entry** (`costCurrencySchemas.ts`, both dialogs). `refineCostCurrency` now
  refuses a complete receipt on a cost of `0` as well as `null`, and both dialogs degrade to euro when
  the converted cost is zero, so a user typing `0,00` under a foreign currency never meets that
  refusal. Nothing in the suite covered this, so a case was added to `tripImportSchemas.test.ts`.
- **The caption names the rate's denominator**: en `"{amount} at {rate}/EUR"`, de
  `"{amount} zu {rate}/EUR"`. The literal wording is exactly 8 characters in both, so the existing
  width ceiling passes unchanged. Nine assertions across three suites were updated to the new string;
  `convertCost.test.ts` was left alone, as it supplies its own template and tests the helper rather
  than the wording.
- **The days tab gates its annotation** on `amountCents !== null`, **`trips.money.originalCaption` is
  registered in `DAY_PRINT_KEYS`** with the false "nothing else renders money" comment corrected,
  **`renderCostAnnotation` moved below its `tokens` const**, and **the style override is typed
  `SxProps<Theme>`**.

**⚠ AC9's browser measurement is stale — accepted as a known gap, 2026-09-20.** `/EUR` adds roughly
24px to every annotation, and the longest one in the Dev Agent Record's table measured at **290px —
the full `tl-card` content width at 390px**, with nothing to spare. The recorded pass therefore
predates the string it measured: it was taken against `{amount} at {rate}`, before the code review
reworded the caption.

Tommy's call on closing this review was to **accept the risk rather than re-measure**, so the story
is `done` with this gap open rather than held in `in-progress`. It is not evidence that AC9 holds —
it is a decision not to spend the cycle confirming it. The 2602 passing tests say nothing either way:
jsdom lays nothing out, which is the whole reason Task 8 made AC9 a browser step.

If the receipt does wrap at 390px, the fix is the annotation's wrapping, not the cost's — the rule
Task 8 already gives. Tracked as **DW-369** so it is discoverable from the ledger rather than only
from this file.

**Dismissed (4)**

- An invalid stored currency degrading to a bare number that reads as euros — disproved at review time: `Intl` accepts any well-formed three-letter code and renders it literally (`2,00 XYZ`), throwing only on codes that are not three letters, which `currencyCodeSchema`'s `/^[A-Z]{3}$/` already forbids. The `catch` fallback is unreachable from stored data.
- AC3's "the diff to those files is additive" breached in three lines — two `payments?` type widenings and one import gaining `afterEach`. Disclosed in the Completion Notes; no assertion touched.
- The print annotation uses `#777` where Task 5 named `#555`/`#444` — a deliberate lighter tone under the line it annotates, already used elsewhere in the file, which is correctly outside `expectNoHardcodedColour`.
- The cost line placed between an activity's title and its description on the print card — Task 5 prescribes exactly that position ("after the `label` line and before `description`").

## Dev Notes

### What is already done, and what is genuinely missing

Story 10.1 stopped at the dialog boundary on purpose ("Display of the receipt on read surfaces …
That is **Story 10.2** in full"). The plumbing is further along than that implies, and knowing which
half is done is most of this story:

| Surface | Data in hand? | Work |
|---|---|---|
| Day timeline, both cards | **Yes** — types and mapping all landed in 10.1 | Render only |
| Day cost breakdown list | **No** — `budgetEntries` drops every currency field | Widen object + filter predicate, then render |
| Cost overview, both tabs | **Yes on the wire, no in the local type** — the cast hides it | Widen the client type, then render |
| Print sheet | **No** — four columns absent from the payload, and no cost is rendered at all | Repo select + mappers + types, then render figure **and** annotation |
| PDF packet | n/a — no costs, no itinerary | Out of scope, recorded as deferred work |
| `TripTimeline`, `TripsDashboard` | n/a — every figure is an aggregate | Untouched |

**Nothing in this story changes an API route, a validation schema, the Prisma schema, or the backup
archive.** If you find yourself editing one, the design has drifted. There is no migration.

### The direction inverts, and that is the whole trap

In the dialogs the caption shows the **EUR equivalent of a foreign amount the user typed**:
`formatForeignAmount(cents, "EUR", language)` at `TripAccommodationDialog.tsx:668` and
`TripDayPlanDialog.tsx:934` — both pass the literal `"EUR"`. Here the figure is EUR and the
annotation is the **foreign original**, so `formatForeignAmount` is finally called with a real
currency code. Its non-EUR path has exactly one consumer today, `test/convertCost.test.ts:87-104`.
That is why AC1 forbids touching it and why the JPY case matters: this story is the first time a
zero-exponent currency reaches a screen.

`trips.money.convertedCaption` (`"≈ {value}"`) reads as if it were reusable because it is
directionally neutral. It is not reusable — it belongs to the other direction, and sharing it would
freeze both wordings together.

### Patterns to copy, not reinvent

| Need | Copy from | Why |
|---|---|---|
| Foreign amount rendering | `formatForeignAmount`, `convertCost.ts:114-140` | Already exists, already correct for zero-exponent currencies. AC12 names it the display renderer. |
| Caption styling and stacking | `MoneyField.tsx:184-219` | The shipped in-dialog treatment: 11px, weight 600, `inkSoft`, `tabular-nums`, `mt: 6px`. Echo it; do not import it — `MoneyField` is a form control. |
| Secondary line on the day view | `TripDayView.tsx:3684-3689` | 11px / 600 / `tokens.inkSoft` under a 12.5px / 700 / `tokens.ink` primary. The file's own house pattern. |
| Secondary line on the print sheet | `TripDayPrintDocument.tsx:487-497` | Inline `style`, 11px, `#555` / `#444`. That file has no MUI and no token access by design. |
| Wording as a parameter | `printDocuments.ts:55-58` | Keeps `convertCost.ts` pure and usable from a Node route as well as a client screen. |
| Locale tag | `INTL_LOCALES` from `@/i18n` | Not a `=== "de"` ternary. Ten are already open debt (DW-281). |

### Design system

- `{colors.ink-soft}` `#6B675C` is "secondary text — labels, captions, subtext" (DESIGN.md:226), read
  in code as `theme.palette.tokens.inkSoft` / `tokens.inkSoft`. Hex literals are legal **only** in
  `src/theme.ts` and in files the colour guard does not cover.
- DESIGN.md:241 — tabular figures are "a hard rule for any new numeric display, not just the ones in
  the mockups". The annotation is a compared numeric value. It takes them.
- DESIGN.md:239 — 600-weight for captions and subtext.
- DESIGN.md:294 — "A foreign amount is rendered through `Intl.NumberFormat` with its own currency's
  fraction digits". This is the design system's own statement of AC1.
- DESIGN.md:290's "no empty slot and no reserved height" is written for the dialog field and is
  exactly AC3's rule for the read surfaces.
- **DESIGN.md says nothing about print** — there is no print token block anywhere in the design
  system. Print styling lives only in `TripDayPrintDocument.tsx`'s own `<style>` block.

### The colour guard covers some of these files and not others

`expectNoHardcodedColour` (`test/helpers/hardcodedColour.ts`) rejects any 3–8 digit hex, any
`rgb/rgba/hsl/…(`, and quoted named colours. It runs on **`TripCostOverview.tsx`**
(`test/tripCostOverview.test.tsx:78`) and on `MoneyField.tsx`. It does **not** run on
`TripDayView.tsx` or `TripDayPrintDocument.tsx`. Use tokens on the day view regardless — it is a MUI
component with `tokens` in scope and a literal there would be a new deviation. The print document is
the deliberate exception.

### Testing standards

- `vitest run` via `npm test`. `environment: "node"` by default; component suites opt into jsdom with
  `// @vitest-environment jsdom` at the top and render through `test/helpers/renderWithProviders.tsx`.
- `fileParallelism: false`, `maxForks: 1` — module state persists across files in a run.
- Repository and route suites hit a real SQLite database per worker via `test/setup.ts`.
- `test/i18nDictionaries.test.ts` enforces exact key parity between dictionaries and rejects empty
  values. It is the guard that catches a one-sided key.
- jsdom measures nothing, which is why AC9 is a browser step rather than an assertion. Do not write a
  test that appears to prove a width; `tripDayViewLayout.test.tsx:7727` explains why one would lie.

### Explicitly out of scope

- **The offline PDF packet** (AC6) — see *Scope corrections*.
- **A per-trip currency (DW-217)** and **converging the three `formatCost` copies (DW-27)**. Every
  total stays EUR; `formatCost`'s hardcoded `currency: "EUR"` is correct here and stays.
- **Annotating any aggregate** (AC4). Not a simplification to revisit — a sum over mixed currencies
  has no original amount.
- **`costRateDate` on read surfaces** — deliberate, see Task 2.
- **DW-357**, the one-cent disagreement between the dialogs' live per-box captions and the stored
  residual sweep. This story reads stored values only and cannot reproduce it.
- **The eleventh `de-DE`/`en-US` ternary (DW-281).** Just do not add one.

### Project Structure Notes

- All paths are under `travelplan/`; the repo root holds `_bmad`, `_bmad-output`, `deploy`, `docs`.
- `architecture.md:392-406`: routes only in `app/api/**/route.ts`, data access only via
  `lib/repositories/*`, Zod validation in `lib/validation/*`, form components in `components/forms/*`.
  This story adds no route, no schema and no form component; the helper belongs in `lib/trips/`
  beside the rest of the money code.
- No architecture edit is needed. `architecture.md:459` already records the ECB integration, and this
  story adds no integration.
- Node `>=24 <25`, Next 16.2.12, React 19.2.3, Prisma 7.3, Zod 4.1, MUI 7.3, Vitest 3.2.
  **No new dependency.**

### References

- [Source: `_bmad-output/planning-artifacts/epics.md#Epic 10: Costs in Another Currency`] — Story 10.2's statement and its four Given/When/Then criteria.
- [Source: `_bmad-output/planning-artifacts/sprint-change-proposal-2026-09-20.md:369-405`] — the same four criteria; `:75` names the cost overview as a 10.2 read surface.
- [Source: `_bmad-output/implementation-artifacts/10-1-a-price-in-another-currency.md`] — AC12 and its 2026-09-20 amendment (the `formatForeignAmount` contract and the first-production-caller note); the *Explicitly out of scope* list that defers every read surface to this story.
- [Source: `travelplan/src/lib/trips/convertCost.ts:114-140`] — `formatForeignAmount`, the mandated display renderer.
- [Source: `travelplan/src/components/forms/MoneyField.tsx:184-219`] — the shipped caption treatment to echo.
- [Source: `travelplan/src/components/features/trips/TripDayView.tsx:110-153`] — the measured `tl-card` content-width table; 290px at 390px.
- [Source: `travelplan/src/lib/repositories/tripRepo.ts:1377-1389, :1431-1443, :1557-1589, :256-281`] — the print payload's four omissions; `:168-205` is the shape to copy.
- [Source: `travelplan/src/lib/repositories/paymentDetail.ts:20-32`] — `amountOriginal` is optional outbound, which is why AC7's absent case is normal.
- [Source: `travelplan/src/lib/trips/packetPdf.ts:98-143, :412-461`] — `toWinAnsiText`'s character classes and the four strings the packet draws; the evidence behind AC6.
- [Source: `_bmad-output/planning-artifacts/ux-designs/ux-TravelPlan-2026-07-27/DESIGN.md:226, :239, :241, :290, :294`] — ink-soft's role, caption weight, the tabular-figures hard rule, the no-reserved-height rule, and the `Intl` fraction-digits rule.
- [Source: `_bmad-output/implementation-artifacts/deferred-work.md` DW-27, DW-217, DW-281, DW-357] — adjacent open debt, all out of scope, listed so none is accidentally adopted or worsened.

## Dev Agent Record

### Agent Model Used

Claude Opus 5 (1M context), via `bmad-dev-story`.

### Debug Log References

`npm run lint` — 0 errors, 80 warnings. The 80 is the **unchanged** baseline, verified by diffing a
sorted warning list against a `git stash` of `src/` and `test/`: same count both sides, and every
line of that diff is a line-number shift caused by this story's insertions. (Story 8.2's note records
79; that figure is stale, not a regression introduced here.)

`npm run typecheck` — clean.

`npm test` — 157 files, 2599 tests, all passing.

### Completion Notes List

**AC1 — one renderer, one rule.** `formatExchangeRate` and `formatCostOriginal` are in
`convertCost.ts` beside `formatForeignAmount`. `formatCostOriginal` is the single place that decides
whether a receipt exists; the four render sites in three files each call it and none re-implements
the test. The wording is passed in as a template rather than looked up, so the module stays pure and
is consumed unchanged by a client screen and by the print sheet. `formatForeignAmount`, `formatCost`
and `parseAmount.ts` are untouched; the JPY zero-exponent case is pinned in three suites and verified
on screen (`5.000 ¥ zu 172,50`).

**AC5 — the print sheet.** Confirmed against the running app that this story's two claims hold
end-to-end: `GET /api/trips/vtrip1/days/vday1/print` now carries all four currency columns on both a
stay and a plan item, and the sheet draws `Kosten: 538,70 €` with `10.000,00 NZ$ zu 1,8563` beneath.

**AC5's trap, verified in the browser rather than only in jsdom.** The sheet draws both stay kinds
through one block. With a `previousStay` that carries `cost_cents` **and** a full NZD receipt, the
rendered previous-night card shows no `Kosten:` line and no annotation, while the current-stay card
shows both. Without the `entry.kind === "currentStay"` condition this would print the same nightly
rate on two consecutive days' sheets.

**AC9 — measured in Chrome at 390px, in German, not asserted in jsdom.** Driven against a real dev
server on a seeded day carrying a foreign stay, a long-titled foreign activity
("Ganztagesausflug zur Halbinsel Otago mit Albatrosbeobachtung") and a JPY activity:

| Claim | Measurement |
|---|---|
| No horizontal overflow | `scrollWidth` 390 = `clientWidth` 390 on the day view, the costs days tab and the costs months tab; zero elements wider than the viewport on the day view |
| The cost stays on one line | All six day-view annotations render at 1 line (143.8px, 102.4px, 290px, 143.8px, 102.4px, 143.8px); all four on each costs tab likewise 1 line |
| The time pill is neither displaced nor shrunk | 96px / 1 line — **identical** to the same day re-measured with the four currency columns nulled |
| The card title is not squeezed | 290px, 2 lines and 1 line — **identical** to that same EUR baseline |
| A EUR day carries nothing | 0 annotation elements in the EUR baseline, 6 with the receipts present |
| Token and figures | computed `color: rgb(107, 103, 92)` = `#6B675C` = `tokens.inkSoft`; `font-variant-numeric: tabular-nums` |

**One layout fix came out of that pass, and it is the reason AC9 is a browser step.** The day's cost
breakdown list first rendered two of its three receipts over two lines (heights of 33px against a
16.5px line) while the label beside them still had room: the row is `space-between`, and with
`minWidth: 0` plus `overflowWrap: "anywhere"` the amount column shrank in proportion with the label
instead of the label yielding. Fixed on the annotation's side, as the story directs — that column is
now `flexShrink: 0` with a `maxWidth: "65%"` cap and no `overflowWrap` override, so the label absorbs
the shrinking and the receipt stays on one line, while the cap keeps a pathological value wrapping
rather than overflowing. The two `tl-card`s keep `minWidth: 0` + `overflowWrap: "anywhere"`, which is
what the story asks for there and which measured at one line regardless. Re-measured after the fix:
6/6 day-view annotations on one line, still no overflow.

**AC3 / AC6 — nothing was loosened to make this pass.** No assertion was removed or edited in any
suite: across `tripDayViewLayout.test.tsx`, `tripCostOverview.test.tsx`,
`tripDayPrintDocument.test.tsx` and `printDocuments.test.ts` the diff removes **zero** lines matching
`expect(`, `it(` or `describe(`. The three non-additive lines in the whole change are two type
widenings (a `payments?` row gaining an optional `amountOriginal`) and one import line gaining
`afterEach`. `packetPdf.ts`, `printDocuments.ts` and the packet route are untouched, and
`documentPacketPdf.test.ts`, `tripDayDocumentPacketRoute.test.ts` and
`documentPacketLastResortLabel.test.ts` are untouched and pass.

**One deliberate deviation from a Task 7 bullet, flagged for review.** That bullet lists
`test/printDocuments.test.ts` among the files that must pass *unmodified*. It could not stay
byte-identical: Task 4 requires the four new print-payload fields to match `TripDaySummary`, which
declares them **required**, and that file's `stay`/`item` factories are typed as the payload's own
types, so `npm run typecheck` failed on them. Eleven lines of `null` defaults were added to the two
factories — no assertion touched, no behaviour changed, and AC6 itself names only
`documentPacketPdf.test.ts` and `tripDayDocumentPacketRoute.test.ts` as untouched. The alternative
was making the payload fields optional, which contradicts Task 4's explicit "match `TripDaySummary`"
instruction and would weaken the contract. Flagged rather than silently absorbed; reversing it is
Tommy's call.

**Scope discipline.** No API route, no validation schema, no Prisma schema, no migration and no
backup-archive change — matching the story's own drift test. `TripTimeline.tsx` and
`TripsDashboard.tsx` are untouched. No new dependency. DW-217, DW-27, DW-281 and DW-357 were neither
adopted nor worsened; no eleventh `=== "de"` ternary was added.

**Verification hygiene.** The browser pass ran against a **copy** of `prisma/dev.db` in the scratch
directory, with `DATABASE_URL` overridden for the dev server, so the maintainer's own dev database
was never migrated, seeded or otherwise written — confirmed unchanged afterwards (same size, mtime
still 6 Aug). The session was minted with the app's own signer for the existing account; **no
password was read, used or changed.** The scratch database, the token and the dev server were
removed when the pass finished.

**AC6 — the packet gap is recorded**, not implied: `DW-362` in `deferred-work.md`, `severity: low`,
naming all three obstacles (no itinerary to annotate, `toWinAnsiText` degrading both `€` and `≈` to
`?`, and `drawLabelPage`'s missing `y = 0` floor check).

### File List

Source:

- `travelplan/src/lib/trips/convertCost.ts` — added `formatExchangeRate` and `formatCostOriginal`
- `travelplan/src/lib/repositories/tripRepo.ts` — four currency columns added to the print payload's two selects, two mappers and two types (purely additive: 33 insertions, 0 deletions)
- `travelplan/src/components/features/trips/TripDayView.tsx` — shared annotation renderer; activity card, stay card and cost breakdown list; `budgetEntries` and its type predicate widened
- `travelplan/src/components/features/trips/TripCostOverview.tsx` — local `TripDay` type widened; days tab and months tab annotated; four `buildMonthlyGroups` push sites carry the receipt
- `travelplan/src/components/features/trips/TripDayPrintDocument.tsx` — renders the EUR cost and the receipt on both entry cards
- `travelplan/src/i18n/en.ts` — `trips.money.originalCaption`, `trips.dayPrint.cost`
- `travelplan/src/i18n/de.ts` — the same two keys

Tests:

- `travelplan/test/convertCost.test.ts` — `formatExchangeRate` and `formatCostOriginal`
- `travelplan/test/tripDayViewLayout.test.tsx` — day timeline receipts, both aggregates unannotated, the two gates
- `travelplan/test/tripCostOverview.test.tsx` — both tabs, the absent-`amountOriginal` payment row, the three aggregates
- `travelplan/test/tripDayPrintDocument.test.tsx` — cost and receipt on the sheet, the previous-night rule, a German case, the JPY case
- `travelplan/test/tripDayPrintRoute.test.ts` — the payload carries the four columns on a stay and a plan item
- `travelplan/test/i18nDictionaries.test.ts` — both keys in both languages, placeholder presence, the wording's width ceiling
- `travelplan/test/printDocuments.test.ts` — factory defaults only (see the deviation note above)

Artefacts:

- `_bmad-output/implementation-artifacts/deferred-work.md` — DW-362
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — status
- `_bmad-output/implementation-artifacts/10-2-the-rate-that-was-used.md` — this file

## Change Log

| Date | Change |
|---|---|
| 2026-09-20 | Story drafted. Two scope corrections carried in: the print sheet renders no cost today (AC5 adds the figure), and the PDF packet has no cost surface to annotate (AC6 removes it from scope, recorded as deferred work). |
| 2026-09-20 | All nine tasks implemented. One shared helper (`formatCostOriginal`) behind every surface; receipts on the day timeline's two cards and its breakdown list, both cost-overview tabs, and the printed sheet — which now renders the EUR cost it never rendered before. No aggregate annotated. AC9 measured in Chrome at 390px in German against an EUR baseline of the same day: no overflow, every receipt on one line, time pill and card title byte-identical to the baseline. One layout fix came out of that pass (the breakdown list's amount column no longer shrinks with its label). Packet untouched; gap filed as DW-362. 2599 tests pass, typecheck clean, lint warnings unchanged from baseline. |
