---
authored_against: 096291f
closes_deferred: [DW-27]
---

# Story 7.13: Cost Overview Redesign — Per-Day and Per-Month Lists

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner checking what a trip costs,
I want the cost overview to match the rest of the redesigned app,
so that opening it from the trip overview does not drop me onto a screen from before the redesign.

## Acceptance Criteria

1. **Page shell.** `src/app/(routes)/trips/[id]/costs/page.tsx` no longer hardcodes `backgroundColor: "#2f343d"`; it uses the same token page shell as the trip overview it was opened from. No hex literal remains in the page component.
2. **Card treatment.** All three `Paper elevation={1}` wrappers (loading `:323`, not-found `:336`, main `:355`) become token card `Box`es — `tokens.card`, `1px solid tokens.borderStrong`, 8px radius, `card-padding` — with no elevation and no hardcoded `#ffffff`.
3. **Nested groups.** The per-month `Paper variant="outlined"` groups (`:469`) read as a nested group inside the card, not as a second card: no elevation, no competing radius, and `tokens.border` instead of a raw `divider`.
4. **Labels.** Section titles move from `Typography variant="h6" fontWeight={600}` to the `label-caps` card-label in `tokens.inkSoft`, and the document outline descends without skipping.
5. **Per-day table.** The `Table` stays a table — this is tabular data — and is restyled onto the token idiom: token borders, `:last-child` divider suppression, tabular numerals on the figures.
6. **Formatter converged (DW-27).** This screen uses the currency-aware `formatCost` the other two screens use, dropping the `trips.stay.costSummary` "Cost: {value}" wrapper. `test/tripCostOverview.test.tsx:137`, which pins the old form, is updated.
7. **DW-27's residue recorded.** All three `formatCost` copies hardcode EUR with no trip-level currency field. That half is **not** fixed here; it is appended to `deferred-work.md` as its own entry so it is not silently carried by DW-27's closure.
8. **States.** The loading skeleton, not-found branch, error alert and the three empty states (`trips.costOverview.empty`, `emptyDay`, `emptyMonths`) each match the treatment already shipped on the screens this one is reached from.
9. **No functional change.** The cost roll-up, day grouping, month grouping, back link and trip total all behave exactly as before. This story is visual only.

## Tasks / Subtasks

- [ ] **Task 1 — The page shell** (AC: 1)
  - [ ] `src/app/(routes)/trips/[id]/costs/page.tsx` wraps everything in `<Box sx={{ backgroundColor: "#2f343d", minHeight: "100vh" }}>`. Replace it with the shell `trips/[id]/page.tsx` uses.
  - [ ] It already renders `TripDayMapBackButton`, which Story 7.9 restyled onto token colors and a 44px target — leave that component alone.
  - [ ] Note that `trips.costOverview.back` reads "← Zurück zur Reise" and the button navigates to `/trips/{id}` — correct as-is, unlike the day-map label 7.9 had to fix.

- [ ] **Task 2 — The three card wrappers** (AC: 2, 8)
  - [ ] Loading (`:323`), not-found (`:336`) and main (`:355`) each carry `Paper elevation={1} sx={{ p: 3, borderRadius: 3, background: "#ffffff" }}`. Replace all three with a `Box` on the token card treatment.
  - [ ] Use a `Box`, not a `Paper`: `theme.ts:245-252` gives every `MuiPaper` root a `1px solid rgba(17,18,20,0.08)` border that composes with any border you add. Stories 7.3, 7.8 and 7.9 each hit this.
  - [ ] The skeleton's shape stays; only its container changes.

- [ ] **Task 3 — Labels and outline** (AC: 4)
  - [ ] `Typography variant="h6" fontWeight={600}` at `:338` and `:358` become `variant="labelCaps"` in `tokens.inkSoft`.
  - [ ] Custom typography variants carry **no `variantMapping`**, so `<Typography variant="labelCaps">` renders a `<span>` unless you pass `component=`. Stories 7.2, 7.3, 7.8 and 7.9 each had to be told this.
  - [ ] Follow 7.3's rule — card labels are the page title's level plus one. Establish what the page title is here first; the screen may have no `h1` at all, in which case the card label is the page's only heading and takes `component="h1"`, as 7.9 decided for the map screens.

- [ ] **Task 4 — Per-day table** (AC: 5)
  - [ ] Keep MUI `Table` / `TableHead` / `TableRow` / `TableCell` (`:386-430`). This is genuinely tabular — day, items, day total — and a table is both semantically correct and more accessible than a div grid. Do not convert it to the row idiom used for day lists.
  - [ ] Restyle it: token border colors, the `:last-child` divider suppression the bucket list and cost summary already use, and `fontVariantNumeric: "tabular-nums"` on the amount column so figures align, matching `TripTimeline.tsx`'s cost rows.
  - [ ] The `TableCell sx={{ fontWeight: 600 }}` header cells adopt the `label-caps` treatment rather than a bare weight.

- [ ] **Task 5 — Per-month groups** (AC: 3)
  - [ ] `:469` renders each month as `Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}` **inside** the main card. Two nested bordered surfaces read as two cards.
  - [ ] Make it a nested group: token border, no elevation, and a radius that does not compete with the 8px card around it.
  - [ ] Replace any raw `borderColor: "divider"` with `tokens.border`.

- [ ] **Task 6 — Converge the formatter** (AC: 6, 7)
  - [ ] `:245-251` builds amounts as `formatMessage(t("trips.stay.costSummary"), { amount: formatCost(...) })`, producing "Cost: 160.00" where Day Detail and the trip overview render "€160.00".
  - [ ] Switch to the currency-aware formatter those two use (`style: "currency", currency: "EUR"`). Prefer extracting one shared helper over adding a fourth copy — but if extraction pulls in more than this screen, converge locally and say so in the Dev Agent Record.
  - [ ] Update `test/tripCostOverview.test.tsx:137`, which pins the old string.
  - [ ] Append a new `### DW-<n>` entry to `deferred-work.md`: every `formatCost` copy hardcodes EUR, there is no trip-level currency field, and a trip priced in another currency renders wrong on every screen. Do not fold that into DW-27's closure — DW-27 is about the divergence, which this story does fix.

- [ ] **Task 7 — Tests** (AC: 1, 2, 5, 6)
  - [ ] Update `test/tripCostOverview.test.tsx` and `test/tripCostOverviewPage.test.tsx` for the new strings and containers.
  - [ ] Add a hex guard for this component and its page, matching the one Stories 7.9 and 7.11 use, so the literals cannot come back.
  - [ ] Assert the table is still a `table` with its three column headers — the restyle must not quietly drop the semantics.
  - [ ] `npm test` green.

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

### Debug Log References

### Completion Notes List

### File List

### Change Log
