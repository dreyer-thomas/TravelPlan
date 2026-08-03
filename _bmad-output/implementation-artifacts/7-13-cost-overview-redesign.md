---
authored_against: 096291f
closes_deferred: [DW-27]
baseline_revision: d93164b2f487f14e6c85f6f8d860901f01261ed7
status: awaiting-operator
review_loop_iteration: 0
final_revision: 86ae0e094e841f48fec013bf63f60115252e1ce4
followup_review_recommended: true
warnings: []
operator_actions:
  - "Do Task 8 in a real browser, on a throwaway copy of dev.db on an isolated port — never prisma/dev.db. The recipe is in the Dev Notes of _bmad-output/implementation-artifacts/7-12-bucket-list-sidebar-card.md. Everything below is unverifiable in jsdom, which lays nothing out."
  - "Click the cost figure on a trip's overview to reach this screen and watch the transition: the page must stay on the warm paper background the rest of the app uses. If the screen goes dark slate on the way in, AC1 did not land."
  - "Switch to the Months tab and judge the month groups: they must read as quieter groups nested inside the one card, not as a stack of separate cards. This is AC3 and it is a judgement about depth that no assertion can make — if it reads as a box-in-a-box, say so."
  - "Check the per-day table's column alignment at desktop width and again at 390px. The amounts carry tabular numerals so figures should line up digit-for-digit; the table scrolls horizontally below 640px rather than reflowing, which is deliberate."
  - "Exercise all three empty states — a trip with no days, a day with no cost entries, and the Months tab on a trip with no scheduled payments — plus the not-found branch via a made-up trip id in the URL. Confirm each sits on the token card and reads like the equivalent state elsewhere in the app."
  - "Look at the trip total in the bottom-right of the card and judge its prominence: it is now 14.5px, the same rank as a month group's heading, while the figure you clicked to get here is 30px. No acceptance criterion covers this and its rank is unchanged from before the redesign, so it was deliberately left alone — decide whether the screen's headline number should outrank the rest, and it becomes its own small story if so. Recorded as deferred work."
  - "Set the app to German and confirm the amounts read '1.234,50 €' with the symbol trailing, on both tabs and in the trip total. A unit test pins this, but confirm the real rendered width does not wrap awkwardly in the table's right-hand column."
  - "If every check passes, tick Task 8 in this spec, set status: done in the frontmatter and Status: done in the body, and set 7-13-cost-overview-redesign to done in sprint-status.yaml."
---

# Story 7.13: Cost Overview Redesign — Per-Day and Per-Month Lists

Status: awaiting-operator

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner checking what a trip costs,
I want the cost overview to match the rest of the redesigned app,
so that opening it from the trip overview does not drop me onto a screen from before the redesign.

## Acceptance Criteria

1. **Page shell.** `src/app/(routes)/trips/[id]/costs/page.tsx` no longer hardcodes `backgroundColor: "#2f343d"`; it uses the same token page shell as the trip overview it was opened from. No hex literal remains in the page component.
2. **Card treatment.** All three `Paper elevation={1}` wrappers (loading `:323`, not-found `:336`, main `:355`) become token card `Box`es — `tokens.card`, `1px solid tokens.borderStrong`, 8px radius, `card-padding` — with no elevation and no hardcoded `#ffffff`.
3. **Nested groups.** The per-month `Paper variant="outlined"` groups (`:469`) read as a nested group inside the card, not as a second card: no elevation, no competing radius, and `tokens.border` instead of a raw `divider`.
4. **Labels.** Section titles move from `Typography variant="h6" fontWeight={600}` to the `label-caps` card-label in `tokens.inkSoft`, and the document outline descends without skipping. **Amended 2026-08-03** (see Spec Change Log): this covers the main card's section title. The not-found branch's title is governed by AC8 instead and takes `variant="heading"` in `tokens.ink` — a dead end reached by a stale URL is a page title, not a card label. No `h6 fontWeight={600}` survives either way.
5. **Per-day table.** The `Table` stays a table — this is tabular data — and is restyled onto the token idiom: token borders, `:last-child` divider suppression, tabular numerals on the figures.
6. **Formatter converged (DW-27).** This screen uses the currency-aware `formatCost` the other two screens use, dropping the `trips.stay.costSummary` "Cost: {value}" wrapper. `test/tripCostOverview.test.tsx:137`, which pins the old form, is updated.
7. **DW-27's residue recorded.** All three `formatCost` copies hardcode EUR with no trip-level currency field. That half is **not** fixed here; it is appended to `deferred-work.md` as its own entry so it is not silently carried by DW-27's closure.
8. **States.** The loading skeleton, not-found branch, error alert and the three empty states (`trips.costOverview.empty`, `emptyDay`, `emptyMonths`) each match the treatment already shipped on the screens this one is reached from.
9. **No functional change.** The cost roll-up, day grouping, month grouping, back link and trip total all behave exactly as before. This story is visual only.

## Tasks / Subtasks

- [x] **Task 1 — The page shell** (AC: 1)
  - [x] `src/app/(routes)/trips/[id]/costs/page.tsx` wraps everything in `<Box sx={{ backgroundColor: "#2f343d", minHeight: "100vh" }}>`. Replace it with the shell `trips/[id]/page.tsx` uses.
  - [x] It already renders `TripDayMapBackButton`, which Story 7.9 restyled onto token colors and a 44px target — leave that component alone.
  - [x] Note that `trips.costOverview.back` reads "← Zurück zur Reise" and the button navigates to `/trips/{id}` — correct as-is, unlike the day-map label 7.9 had to fix.

- [x] **Task 2 — The three card wrappers** (AC: 2, 8)
  - [x] Loading (`:323`), not-found (`:336`) and main (`:355`) each carry `Paper elevation={1} sx={{ p: 3, borderRadius: 3, background: "#ffffff" }}`. Replace all three with a `Box` on the token card treatment.
  - [x] Use a `Box`, not a `Paper`: `theme.ts:245-252` gives every `MuiPaper` root a `1px solid rgba(17,18,20,0.08)` border that composes with any border you add. Stories 7.3, 7.8 and 7.9 each hit this.
  - [x] The skeleton's shape stays; only its container changes.

- [x] **Task 3 — Labels and outline** (AC: 4)
  - [x] `Typography variant="h6" fontWeight={600}` at `:338` and `:358` become `variant="labelCaps"` in `tokens.inkSoft`. — **Amended 2026-08-03:** `:358` (the main card label) as written; `:338` (the not-found title) takes `variant="heading"` in `tokens.ink` under AC8. See Spec Change Log.
  - [x] Custom typography variants carry **no `variantMapping`**, so `<Typography variant="labelCaps">` renders a `<span>` unless you pass `component=`. Stories 7.2, 7.3, 7.8 and 7.9 each had to be told this.
  - [x] Follow 7.3's rule — card labels are the page title's level plus one. Establish what the page title is here first; the screen may have no `h1` at all, in which case the card label is the page's only heading and takes `component="h1"`, as 7.9 decided for the map screens.

- [x] **Task 4 — Per-day table** (AC: 5)
  - [x] Keep MUI `Table` / `TableHead` / `TableRow` / `TableCell` (`:386-430`). This is genuinely tabular — day, items, day total — and a table is both semantically correct and more accessible than a div grid. Do not convert it to the row idiom used for day lists.
  - [x] Restyle it: token border colors, the `:last-child` divider suppression the bucket list and cost summary already use, and `fontVariantNumeric: "tabular-nums"` on the amount column so figures align, matching `TripTimeline.tsx`'s cost rows.
  - [x] The `TableCell sx={{ fontWeight: 600 }}` header cells adopt the `label-caps` treatment rather than a bare weight.

- [x] **Task 5 — Per-month groups** (AC: 3)
  - [x] `:469` renders each month as `Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}` **inside** the main card. Two nested bordered surfaces read as two cards.
  - [x] Make it a nested group: token border, no elevation, and a radius that does not compete with the 8px card around it.
  - [x] Replace any raw `borderColor: "divider"` with `tokens.border`.

- [x] **Task 6 — Converge the formatter** (AC: 6, 7)
  - [x] `:245-251` builds amounts as `formatMessage(t("trips.stay.costSummary"), { amount: formatCost(...) })`, producing "Cost: 160.00" where Day Detail and the trip overview render "€160.00".
  - [x] Switch to the currency-aware formatter those two use (`style: "currency", currency: "EUR"`). Prefer extracting one shared helper over adding a fourth copy — but if extraction pulls in more than this screen, converge locally and say so in the Dev Agent Record. — no extraction needed: `src/lib/trips/formatCost.ts` already existed (Story 7.4) and this screen now imports it.
  - [x] Update `test/tripCostOverview.test.tsx:137`, which pins the old string.
  - [x] Append a new `### DW-<n>` entry to `deferred-work.md`: every `formatCost` copy hardcodes EUR, there is no trip-level currency field, and a trip priced in another currency renders wrong on every screen. Do not fold that into DW-27's closure — DW-27 is about the divergence, which this story does fix. — DW-151.

- [x] **Task 7 — Tests** (AC: 1, 2, 5, 6)
  - [x] Update `test/tripCostOverview.test.tsx` and `test/tripCostOverviewPage.test.tsx` for the new strings and containers.
  - [x] Add a hex guard for this component and its page, matching the one Stories 7.9 and 7.11 use, so the literals cannot come back.
  - [x] Assert the table is still a `table` with its three column headers — the restyle must not quietly drop the semantics.
  - [x] `npm test` green.

- [ ] **Task 8 — Manual check** (AC: 1, 3, 5, 8)
  - [ ] jsdom lays nothing out. Open the screen from the trip overview's cost figure and confirm no dark inversion on the way in, that the month groups read as nested rather than as separate cards, and that the table's columns align at both desktop and 390px.
  - [ ] Exercise all three empty states and the not-found branch.
  - [ ] Throwaway copy of `dev.db` on an isolated port — never `prisma/dev.db`. Recipe in `7-12-bucket-list-sidebar-card.md`'s Dev Notes.

## Dev Notes

### The redesign pass missed this screen entirely

`TripCostOverview.tsx` is 519 lines with **zero** `tokens.` references. Reached by clicking the trip's cost figure on the trip overview (`TripTimeline.tsx:420`), it is the only screen in the app still rendering the pre-redesign vocabulary.

Story 7.9's context asserts its two map screens were *"the last two unredesigned screens in the app."* That was wrong. Tommy found this one in production use on 2026-08-01.

**The page shell is the third instance of a defect 7.9 thought it had fully fixed.** Its AC1 read: *"both map pages hardcode `backgroundColor: '#2f343d'` — a dark slate absent from the token palette, so enlarging a map inverts the app's entire value scheme mid-flow."* The cost page hardcodes the same value, for the same reason, and was not in scope. Worth knowing when reading 7.9's spec as a reference: its treatment is right, its census was not.

### No mockup covers this screen

`DESIGN.md`'s source-mockup list covers Screens A–H; none is a cost surface. Like 7.9, this story derives everything from patterns already shipped — the `card` shell, the `label-caps` card-label, the token page shell, tabular numerals — and introduces no new visual language. If a value seems to need inventing, that is a signal to go find where it already exists.

### Keep the table

The per-day list is a real MUI `Table`. It is tempting to convert it to the div-based row idiom the day list and bucket list use, for consistency. Don't: this is tabular data with three columns and a header row, a table conveys that to assistive technology, and no AC asks for the change. Restyle it in place.

### Traps

**1. `Box`, not `Paper`.** The global `MuiPaper` border override composes with anything you add. Every Epic 7 story that touched a `Paper` had to work around it.

**2. `component=` on custom variants.** `labelCaps` has no `variantMapping` and silently renders a `<span>`. Four previous stories were caught by this.

**3. Two bordered surfaces nested.** The month groups sit inside the main card. Giving them the same card treatment produces a box-in-a-box; they need a quieter nested treatment.

**4. Don't over-close DW-27.** It has two halves: the divergence (fixed here) and the EUR hardcoding across all three copies (not fixed here — it needs a trip currency field). Task 6 splits them explicitly. Closing the whole entry would bury a real gap.

**5. `TripDayMapBackButton` is shared.** It is used by both map screens and this page. Story 7.9 restyled it; touching it again changes three screens.

### Testing

Vitest 3.2 + Testing Library, jsdom, via `test/helpers/renderWithProviders.tsx`. Two suites constrain this: `tripCostOverview.test.tsx` (including the `:137` string pin Task 6 must update) and `tripCostOverviewPage.test.tsx`. The hex guard in Task 7 is the mechanical protection against the literals returning — 7.9 and 7.11 both use that pattern.

### Project Structure Notes

Files touched: `src/app/(routes)/trips/[id]/costs/page.tsx`, `src/components/features/trips/TripCostOverview.tsx`, the two test suites, and `deferred-work.md` (one new entry per AC7). No route, API, schema or i18n change beyond dropping the `trips.stay.costSummary` wrapper at this call site — the key itself stays, it has other readers.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 7.13]
- [Source: travelplan/src/app/(routes)/trips/[id]/costs/page.tsx] — the `#2f343d` shell
- [Source: travelplan/src/components/features/trips/TripCostOverview.tsx:323,336,355,469] — the four `Paper`s
- [Source: _bmad-output/implementation-artifacts/7-9-full-page-map-screens-redesign.md] — the same shell fix, and the pattern-derivation approach for a screen with no mockup
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] — DW-27

## Dev Agent Record

### Agent Model Used

claude-opus-5[1m], via `bmad-dev-auto`.

### Debug Log References

- `npx vitest run` — 110 files, 1126 tests, all passing (baseline at `d93164b` was 110 / 1124; the two added are the component hex guard and the page hex guard).
- `npx vitest run test/tripCostOverview.test.tsx test/tripCostOverviewPage.test.tsx` — 6 passing.
- `npm run lint` — 85 problems (2 errors, 83 warnings), identical to baseline. Both errors are the pre-existing `react/no-children-prop` pair in `theme.ts:120,137` (DW-134). `npx eslint` over the five touched files alone is clean.
- `npx tsc --noEmit` — 143 errors, identical to baseline, none in a touched file. All are `TS2352`/`TS2339` fetch-mock cast complaints across 24 existing test files.

### Completion Notes List

- **No formatter extraction was needed.** Task 6 offered extraction-or-converge-locally, but the shared helper already existed: `src/lib/trips/formatCost.ts`, landed by Story 7.4 and already used by `TripsDashboard.tsx`. This screen now imports it, which takes the copy count from four to two (`TripTimeline.tsx:220`, `TripDayView.tsx:539` still hold local copies). That file's docblock, which named `TripCostOverview.tsx` as a third copy, was corrected — comment only, no behaviour change.
- **Deviation from Task 3 for the not-found title (`:338`); AC4 amended to record it.** Task 3 sends both `h6 fontWeight={600}` titles to the `label-caps` card-label, but AC8 governs the not-found branch, and a 10.5px uppercase muted label is not a page title — a dead end reached by a stale URL has to be legible. The nearest *redesigned* precedent for this exact key is `TripOverviewMapFullPage.tsx:149`, `variant="heading" component="h1"` in `tokens.ink`, which is what shipped. Note the precedent is a sibling redesigned screen, **not** literally "the screen this one is reached from": review correctly pointed out that the referrer is the trip overview (`TripTimeline.tsx:420`), whose own not-found copy is still the un-redesigned `h6` and therefore cannot be the target. AC4 and Task 3 were amended to record the carve-out rather than leaving the code silently at odds with them; no `h6 fontWeight={600}` survives anywhere in the file. Rationale is also a comment at the call site.
- **The loading branch renders the real label, not a skeleton bar.** Review flagged that keeping `Skeleton variant="text" width="40%" height={32}` — sized for the retired 20px `h6` — in front of a 10.5px caps label reproduces exactly what `TripOverviewMapFullPage.tsx:134-139` deliberately avoids, and leaves the screen with no heading while it loads. The skeleton for the title is gone; the label renders during load and only the content below it is skeletoned. AC8.
- **Secondary text now speaks one vocabulary.** All seven `color="text.secondary"` sites — including AC8's three empty states — became `sx={{ color: tokens.inkSoft }}`, matching every shipped redesigned surface. There is no pixel change (`text.secondary` resolves to the same `inkSoft`), but the file no longer mixes the pre-redesign spelling with the token one.
- **The outline now descends h1 → h2.** The main card label is the screen's only `h1` (there is no page title above the card, as 7.9 established for the map screens); the per-month group titles became `variant="cardTitle" component="h2"`. Table column headers are `th`, not headings, so they do not enter the outline.
- **Nested-group treatment.** The month groups are `tokens.cardAlt` + `1px solid tokens.border` + 6px radius + 16px padding — `cardAlt` being the quieter nested surface already shipped in `TripsDashboard.tsx:515`, `TripShareDialog.tsx:624` and `DialogShell.tsx:105`, and 6px the radius that does not compete with the card's 8px. No new value was invented.
- **`trips.stay.costSummary` is now orphaned, and the spec's premise for keeping it was wrong.** Task 6's Project Structure Notes say "the key itself stays, it has other readers" — this screen's four call sites were in fact its last readers. The key is still defined in `src/i18n/en.ts:570` and `de.ts:540` and is now referenced by nothing in `src/`. It was left in place because the spec explicitly scopes out i18n changes beyond dropping the wrapper at these call sites; removing two message-file lines is not a call this story should make unilaterally. Recorded as **DW-152**.
- **Three existing ledger entries were annotated, not just appended to.** DW-27 is closed for its divergence half with a `resolution:` line naming DW-151 as the surviving half. DW-58 (the `card` token bundle, "duplicated in six components") gets a `seen-again:` line: this story adds the seventh copy, plus a second bundle (`nestedGroupSx`) with three copies of its own. DW-132 (the not-found panel, "duplicated verbatim") gets one too: the two copies are no longer verbatim, because this story restyled one of them.
- **Task 8 is not attempted.** It is a manual browser check on a throwaway database, which no agent in this run can perform. Its checkboxes are deliberately unticked and its content is enumerated under `operator_actions` in the frontmatter. Nothing about the run's own verification depends on it: jsdom lays nothing out, so the nesting judgement, the column alignment at 390px and the absence of a dark inversion on the way in are all unproven by the suite.
- **Every change is paint.** `buildDayEntries`, `buildMonthlyGroups`, both comparators, the fetch/`useEffect` block, tab state, the back link and the totals arithmetic are untouched (AC9). The two pre-existing behavioural tests — chronological month grouping with split payments, and single-fetch tab-state preservation — pass unmodified apart from the currency glyph in their string pins.

### File List

- [travelplan/src/app/(routes)/trips/[id]/costs/page.tsx](../../travelplan/src/app/(routes)/trips/[id]/costs/page.tsx) — dropped the `#2f343d` shell for the token page shell (AC1)
- [travelplan/src/components/features/trips/TripCostOverview.tsx](../../travelplan/src/components/features/trips/TripCostOverview.tsx) — four `Paper`s to token surfaces, `label-caps` labels, restyled table, nested month groups, shared formatter (AC2–AC6, AC8, AC9)
- [travelplan/src/lib/trips/formatCost.ts](../../travelplan/src/lib/trips/formatCost.ts) — docblock corrected; the copy count is two, not three
- [travelplan/test/tripCostOverview.test.tsx](../../travelplan/test/tripCostOverview.test.tsx) — `renderWithProviders`, currency string pins, table-semantics assertions, component hex guard
- [travelplan/test/tripCostOverviewPage.test.tsx](../../travelplan/test/tripCostOverviewPage.test.tsx) — page-shell hex guard
- [deferred-work.md](deferred-work.md) — DW-151 (EUR hardcoded app-wide, no trip currency field); DW-27's remaining half

### Change Log

| Date | Change |
| --- | --- |
| 2026-08-03 | Tasks 1–7 implemented; DW-27's divergence half closed, its EUR half recorded as DW-151. Task 8 (manual browser check) owed to the operator. |
| 2026-08-03 | Review pass: 12 patches applied, 5 items deferred, 4 rejected. See Review Triage Log. |

## Spec Change Log

### 2026-08-03 — AC4 carved out for the not-found title

- **Triggering finding:** AC4/Task 3 send both `h6 fontWeight={600}` titles to the `label-caps` card-label, while AC8 requires the not-found branch to match the treatment already shipped on the surrounding screens. Both cover the not-found title and they ask for different things, so the spec could not be satisfied literally as written.
- **What was amended:** AC4 and Task 3 only, to state that AC4 governs the main card's section title and AC8 governs the not-found title, which takes `variant="heading"` in `tokens.ink`. No other AC, task or Dev Note was touched, and the story's scope is unchanged.
- **Known-bad state avoided:** rendering "Trip not found" — the message a user sees after following a stale or shared URL — as 10.5px uppercase muted label text, on a screen with no other heading. That is what a literal reading of Task 3 produces.
- **Why no implementation loopback:** the shipped code already is what the amended spec asks for, so re-deriving it would reproduce it unchanged. The amendment ratifies the shipped choice rather than redirecting it; the correction owed was to the spec text and to the Dev Agent Record's citation, both of which were made. Recorded here so the next reader does not re-litigate it.
- **KEEP for any future re-derivation:** the `Box`-not-`Paper` rule and the exact shipped `cardSx` values; `component=` on every custom-variant heading; the `Table` element and its three `columnheader`s; the shared `formatCost` import rather than a fourth copy; the h1 → h2 outline; and the positive style assertions — the negative source-text guard alone cannot see a surface that loses a token.

## Review Triage Log

### 2026-08-03 — Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 12: (high 0, medium 3, low 9)
- defer: 5: (high 0, medium 2, low 3)
- reject: 4: (high 0, medium 0, low 4)
- addressed_findings:
  - `[medium]` `[patch]` The loading branch kept a text skeleton sized for the retired 20px `h6` in front of a 10.5px caps label, and left the screen with no heading at all while loading — the two things `TripOverviewMapFullPage.tsx:134-139` documents itself as avoiding. Replaced with the real `labelCaps component="h1"` label; only the content below is skeletoned now.
  - `[medium]` `[patch]` Both new tests were negative-only: the source-text hex guard passes just as happily if a surface loses `backgroundColor` entirely or takes the wrong token, so AC2, AC3 and AC4's heading levels had no positive coverage at all. Added `toHaveStyle` assertions for the card bundle and the nested month group (fill, border colour, radius, padding), plus `getByRole("heading", { level: 1 })` / `level: 2` and a caps-treatment assertion on a column header — the `component=` trap the story says caught four previous stories was previously untested.
  - `[medium]` `[patch]` AC6 is a *currency* switch, not a number switch, and every string pin was `en-US` — a formatter hardcoding the symbol in front would have passed. Added a `de` render asserting `1.234,50 €` with the symbol in the locale's trailing position.
  - `[low]` `[patch]` The error alert is named by AC8 and had no coverage on this screen. Added a failed-load test asserting the alert, its message, the surviving card shell and the absence of the table.
  - `[low]` `[patch]` AC8's three empty states, and four other secondary-text sites, still read `color="text.secondary"` while every shipped redesigned surface uses `tokens.inkSoft`. Converted all seven; no pixel change, one vocabulary.
  - `[low]` `[patch]` The hex guard matched only `#hex`, `rgb()` and `hsl()`, so `background: "white"` or `oklch(...)` would reintroduce the defect with the guard green. Extended to named colours and every modern colour-function notation, and the comments now state what the guard cannot see instead of claiming the literals "cannot come back".
  - `[low]` `[patch]` Both guards resolved their paths from `process.cwd()`, turning into an unrelated ENOENT if vitest is invoked from the repo root. Switched to `resolve(__dirname, "..")`, the idiom already used by `typographySansSerif.test.ts:5`.
  - `[low]` `[patch]` AC4 and AC8 both governed the not-found title and asked for different things, and the Dev Agent Record justified the choice by citing "the screens this one is reached from" when the referrer is actually the trip overview, whose own copy is un-redesigned. Amended AC4 and Task 3 to record the carve-out, corrected the citation, and logged the reasoning in the Spec Change Log.
  - `[low]` `[patch]` The Completion Notes claimed the orphaned `trips.stay.costSummary` key was "recorded as deferred work" when no such entry existed. Appended DW-152 and pointed the note at it.
  - `[low]` `[patch]` `closes_deferred: [DW-27]` was declared but DW-27 was still `status: open`, and DW-151 reasons explicitly about DW-27's closure not covering the EUR half. Annotated DW-27 `status: done 2026-08-03` with a `resolution:` line naming DW-151 as the surviving half.
  - `[low]` `[patch]` DW-58 ("the `card` token bundle is now literally duplicated in six components") gained a seventh copy from this story, plus a second bundle, with the entry left untouched. Added a `seen-again:` line naming both.
  - `[low]` `[patch]` DW-132 ("the not-found panel is duplicated verbatim") became factually wrong when this story restyled one of the two copies. Added a `seen-again:` line recording the divergence and which copy is now the correct extraction target.

## Auto Run Result

Status: awaiting-operator — every part of this story an agent can take is done, committed and verified. Task 8 is a manual browser check and is owed to the operator; see `operator_actions` in the frontmatter.

### What was implemented

The cost overview was the last screen in the app still rendering the pre-redesign vocabulary — 519 lines with zero `tokens.` references, reached by clicking the trip's cost figure. It now speaks the same language as the screens around it: the page shell no longer paints itself `#2f343d` (so enlarging costs no longer inverts the app's value scheme mid-flow), all three card wrappers are `Box`es on the shipped token card treatment instead of `Paper elevation={1}` over `#ffffff`, the per-month groups read as nested groups rather than a second card, section titles are the `label-caps` card-label, and the per-day list stays a real `Table` — restyled onto token borders with tabular numerals, not converted to a div grid. Amounts come from the shared currency-aware `formatCost`, so the same figure no longer reads "€160.00" on Day Detail and "Cost: 160.00" here. Nothing about the cost roll-up, day or month grouping, tab state, back link or totals arithmetic changed.

### Files changed

- `travelplan/src/app/(routes)/trips/[id]/costs/page.tsx` — the `#2f343d` shell becomes the token page shell (AC1)
- `travelplan/src/components/features/trips/TripCostOverview.tsx` — four `Paper`s to token surfaces, `label-caps` labels with explicit `component=`, restyled table, nested month groups, shared formatter, one secondary-text vocabulary (AC2–AC6, AC8, AC9)
- `travelplan/src/lib/trips/formatCost.ts` — docblock corrected: two local copies remain, not three
- `travelplan/test/tripCostOverview.test.tsx` — `renderWithProviders`, currency pins, table semantics, positive token-style and heading-level assertions, German locale, error branch, component colour guard
- `travelplan/test/tripCostOverviewPage.test.tsx` — page-shell colour guard
- `_bmad-output/implementation-artifacts/deferred-work.md` — DW-151 (EUR hardcoded, no trip currency field), DW-152 (orphaned i18n key), DW-27 closed for its divergence half, `seen-again:` on DW-58 and DW-132, five review defers
- `_bmad-output/implementation-artifacts/7-13-cost-overview-redesign.md` — AC4/Task 3 amendment, Dev Agent Record, Spec Change Log, Review Triage Log

### Review findings

12 patches applied, 5 items deferred, 4 rejected, 0 intent gaps, 0 spec loopbacks. The patches are itemised in the Review Triage Log. The rejections: the per-render `cardSx`/`nestedGroupSx` object identities (matches the shipped precedent, no measurable consequence); the `sx={{ typography: "labelCaps" }}` spelling on the `th`s (verified to resolve the custom variant correctly, and the natural form inside a table cell); the loss of the "Cost:" prefix on per-item figures as an assistive-text regression (AC6 mandates it and the currency glyph carries the meaning next to its item label); and `authored_against` differing from `baseline_revision` (expected — the spec was authored against an earlier revision).

### Verification

- `npx vitest run` — 110 files, **1128 tests, all passing**. Baseline at `d93164b` was 110 / 1124; the four added are the two colour guards, the German-locale render and the error branch.
- `npm run lint` — 85 problems (2 errors, 83 warnings), identical to baseline. Both errors are the pre-existing `react/no-children-prop` pair in `theme.ts:120,137` (DW-134). `npx eslint` over the touched files alone is clean.
- `npx tsc --noEmit` — 143 errors, identical to baseline, none in a touched file (all pre-existing fetch-mock casts across 24 test files).
- Manual inspection: verified the shipped `cardSx` values against `TripOverviewMapFullPage.tsx:66-72` and `TripTimeline.tsx:952`, `18px` against `--spacing-card-padding` in `globals.css:40`, `cardAlt` as the nested-surface token against its three existing users, and that `trips.stay.costSummary` has no remaining reader in `src/`.

### Residual risks

- **Nothing here has been seen in a browser.** jsdom lays nothing out, so the three things the story asked a human to judge are unproven by the suite: that the month groups read as nested rather than as separate cards, that the table's columns align at 390px as well as desktop, and that no dark inversion appears on the way in. `operator_actions` enumerates them.
- **AC8's empty and error states are structurally verified, not visually.** Their containers and colours are asserted; their layout is not.
- **The trip total is now the least prominent figure on its own screen** (`cardTitle` 14.5px, against the 30px/900 figure the user clicked to get here). Rank is unchanged from before the redesign and no AC or mockup covers it, so it was left alone deliberately — deferred, and on the operator checklist.
- **The colour guards are proxies.** They read source text, so a colour lifted into a constant in another file, or a hex after a `//` inside a string literal on the same line, passes. The positive style assertions added in review cover the surfaces that matter; the guards are the backstop, not the proof.
