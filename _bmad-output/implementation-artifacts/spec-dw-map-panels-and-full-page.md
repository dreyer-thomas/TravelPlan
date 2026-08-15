---
title: 'Map panels and full-page maps: caption, error/empty contradiction, day identity, height'
type: 'bugfix'
created: '2026-08-15'
status: 'done'
baseline_revision: '5bc1fa197612f71fdcce0e141d46e3260cfba4d0'
final_revision: '7fb83fac2edf1762b368a2f874a2e7ab3d4571db'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: ['multiple-goals', 'oversized']
---

<intent-contract>

## Intent

**Problem:** Four map surfaces fall short of the standard `TripDayMapPanel` already meets (DW-15, DW-56, DW-57, DW-59): the trip overview preview has no text caption and its populated wrapper has no border/background; all four surfaces gate the "no mapped places" empty state on point count alone, so a failed load shows an error banner and a contradicting empty state together; the full-page day map names neither the day nor the trip; and one copied `FULL_PAGE_MAP_HEIGHT = "calc(100vh - 220px)"` under-measures the real chrome on both full-page screens, so both scroll.

**Approach:** Port the proven `TripDayMapPanel` caption pattern to `TripOverviewMapPanel` and give its populated wrapper the same bordered card fill the empty state uses; add a load-error guard to the empty-state condition on all four surfaces; wrap the full-page day map's caps label in the trip map's title stack and add a `Day {index}` subline; and split the height constant into a per-file value sized from a real browser measurement.

## Boundaries & Constraints

**Always:** Reuse the existing `TripDayMapPanel` caption markup, `fontSize: "11.5px" / fontWeight: 600 / tokens.inkSoft` rhythm, and its `expandHref && points.length > 0` gating. Every new user-visible string gets both an `en.ts` and a `de.ts` entry, placed beside the sibling keys of its block. Counts come from the `points` array the component already holds, never from a second source. Use design tokens (`tokens.border`, `tokens.inkSoft`, `palette.background.default`) — no colour literals.

**Block If:** The full-page screens cannot be reached in an isolated browser at all, so neither height constant can be measured (state the attempted procedure and the failure).

**Never:** Do not change the map libraries, the marker/route logic, `buildTripOverviewMapData` / `buildDayMapPanelData`, or the marker dialogs. Do not touch the deferred-work ledger. Do not replace the fixed-offset height approach with a measured/observer-driven layout.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Overview preview, many points | `points.length = 5`, `expandHref` set | Caption link "5 stops · open the full map" below the map, `href = expandHref`; wrapper has 1px `tokens.border` on `palette.background.default` | No error expected |
| Overview preview, one point | `points.length = 1`, `expandHref` set | Caption reads the singular key, no `{count}` placeholder left in the output | No error expected |
| Overview preview, no points | `points.length = 0` | Dashed empty state, no caption | No error expected |
| Overview preview, no expand target | `points.length = 3`, `expandHref` undefined | Map renders, no caption (nothing to link to) | No error expected |
| Any surface, load failed | points empty **and** load error set | Error alert only — no empty-state panel | Error alert is the sole message |
| Any surface, genuinely empty | points empty, no load error | Empty state renders as today | No error expected |
| Full-page day map, day loaded | `day.dayIndex = 3` | Caps label plus `Day 3` subline in one `gap={0.75}` column | No error expected |
| Full-page day map, day not loaded | `day` null | Caps label only, no subline, no `Day undefined` | No error expected |

</intent-contract>

## Code Map

- `travelplan/src/components/features/trips/TripOverviewMapPanel.tsx` -- caption + populated-wrapper border + empty-state guard (DW-15, DW-56)
- `travelplan/src/components/features/trips/TripDayMapPanel.tsx` -- reference caption implementation at :121-143; receives the same empty-state guard (DW-56)
- `travelplan/src/components/features/trips/TripOverviewMapFullPage.tsx` -- `FULL_PAGE_MAP_HEIGHT` :58, `Alert` :159, empty-state condition :180; its title stack :163-178 is the pattern DW-57 copies
- `travelplan/src/components/features/trips/TripDayMapFullPage.tsx` -- `FULL_PAGE_MAP_HEIGHT` :75, `Alert` :405, lone caps label :412-414, empty-state condition :416
- `travelplan/src/components/features/trips/TripTimeline.tsx` -- renders `TripOverviewMapPanel` at :1157; owns the load `error` state (:154)
- `travelplan/src/components/features/trips/TripDayView.tsx` -- renders `TripDayMapPanel` at :4222; its `error` state (:557) is shared with action errors, so a load-scoped flag is needed
- `travelplan/src/i18n/en.ts` / `de.ts` -- `trips.overviewMap.*` block (en :512-522, de :480-490); `trips.dayView.mapCaption*` (en :286-287, de :270-271) is the wording to mirror
- `travelplan/test/tripOverviewMapPanel.test.tsx`, `tripDayMapPanel.test.tsx`, `tripOverviewMapFullPage.test.tsx`, `tripDayMapFullPage.test.tsx` -- suites to extend

## Tasks & Acceptance

**Execution:**
- [x] `travelplan/src/i18n/en.ts` + `de.ts` -- add `trips.overviewMap.mapCaption` / `trips.overviewMap.mapCaptionOne` beside the other `trips.overviewMap.*` keys, wording mirroring the day-map caption (`"{count} stops · open the full map"` / `"1 stop · open the full map"`; de `"{count} Stationen · Vollkarte öffnen"` / `"1 Station · Vollkarte öffnen"`) -- one caption vocabulary across all map surfaces
- [x] `travelplan/src/components/features/trips/TripOverviewMapPanel.tsx` -- add the caption link below the map (copy `TripDayMapPanel.tsx:121-143`, gated on `expandHref && points.length > 0`), give the populated wrapper `border: "1px solid"`, `borderColor: tokens.border`, `backgroundColor: theme.palette.background.default` (the mockup's `#F7F4EC` paper fill; there is no `tokens.paper`, precedent at `TripDayView.tsx:2588`), and add an optional `loadError?: boolean` prop that suppresses the empty state -- DW-15 + DW-56
- [x] `travelplan/src/components/features/trips/TripDayMapPanel.tsx` -- add the same optional `loadError?: boolean` prop and `&& !loadError` on the empty-state branch -- DW-56, the fourth surface
- [x] `travelplan/src/components/features/trips/TripTimeline.tsx` -- pass `loadError={Boolean(error)}` to `TripOverviewMapPanel` -- wires the guard to the only error that panel's parent raises
- [x] `travelplan/src/components/features/trips/TripDayView.tsx` -- add a load-scoped boolean state set only in `loadDay`'s failure paths (cleared where `setError(null)` runs at the start of the load) and pass it as `loadError` -- the shared `error` state also carries save/upload failures, which must not blank the map's empty state
- [x] `travelplan/src/components/features/trips/TripOverviewMapFullPage.tsx` -- change the empty-state condition to `mapData.points.length === 0 && !error`; set `FULL_PAGE_MAP_HEIGHT` to `"calc(100vh - 428px)"` (220 + the measured 208px overhang) with a comment recording the measurement -- DW-56, DW-59
- [x] `travelplan/src/components/features/trips/TripDayMapFullPage.tsx` -- same `&& !error` guard; wrap the caps label in a `display="flex" flexDirection="column" gap={0.75}` Box and add, when `day` is non-null, a `fontSize: "11.5px" / fontWeight: 600 / color: tokens.inkSoft` subline rendering `formatMessage(t("trips.dayView.title"), { index: day.dayIndex })`; set `FULL_PAGE_MAP_HEIGHT` to its own value (start from `"calc(100vh - 400px)"` — the measured 373 plus the new subline and its gap — and finalize from the browser measurement) -- DW-56, DW-57, DW-59
- [x] `travelplan/test/tripOverviewMapPanel.test.tsx` -- cover the caption in plural and singular form (assert the resolved `href` and that no `{count}` placeholder survives), its absence with zero points and with no `expandHref`, and that the empty state does not render when `loadError` is set
- [x] `travelplan/test/tripDayMapPanel.test.tsx` + `tripOverviewMapFullPage.test.tsx` + `tripDayMapFullPage.test.tsx` -- assert no empty state renders alongside an error on each surface (full-page suites drive it through a failing fetch, so the error alert is asserted present and the empty title absent); add a case asserting the day full-page subline renders `Day {index}` for a loaded day
- [x] Browser measurement -- bring up the app on an isolated port against a throwaway DB copy (runbook in `7-12-bucket-list-sidebar-card.md:109`), open both full-page map screens at 1440×1080 and 1280×620 on a surface whose card shows no missing-locations list and no routing warning, read `document.documentElement.scrollHeight - document.documentElement.clientHeight`, and adjust each constant until it is 0 -- DW-59's acceptance

**Acceptance Criteria:**
- Given a trip overview panel with mapped points and an expand target, when it renders, then a caption link stating the point count and the open-full-map action sits below the map and points at `expandHref`, and the populated map wrapper carries a 1px `tokens.border` on the `background.default` paper fill.
- Given any of the four map surfaces whose data failed to load, when it renders, then the error message is the only status shown and no "no mapped places / no locations" panel appears.
- Given the full-page day map with its day loaded, when it renders, then the caps card label is followed by a `Day {index}` subline in the panel-caption rhythm, and the trip's own screen keeps its existing trip-name subline unchanged.
- Given either full-page map screen on a card with no missing-locations list, when it is opened at 1440×1080 and again at 1280×620, then `document.documentElement.scrollHeight - document.documentElement.clientHeight` is 0.
- Given the full German dictionary, when the new keys are looked up, then `de.ts` has an entry for every new `en.ts` key.

## Spec Change Log

## Review Triage Log

### 2026-08-15 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 9: (high 0, medium 3, low 6)
- defer: 14: (high 0, medium 3, low 11)
- reject: 7: (high 1, medium 2, low 4)
- addressed_findings:
  - `[medium]` `[patch]` The new 1px frame on `TripOverviewMapPanel`'s populated wrapper clipped the bottom 2px of the map: `globals.css` puts everything in `border-box`, so a 150px wrapper with a border has a 148px content box while the map was still told 150. Introduced `MAP_PREVIEW_HEIGHT`/`MAP_PREVIEW_BORDER` and pass the content height; browser-confirmed wrapper 150 / map 148, card footprint unchanged.
  - `[medium]` `[patch]` The unplanned SSR fix (the static Leaflet import that made `/trips/{id}/days/{dayId}/map` a 500) shipped with no regression test, and every existing suite mocks `react-leaflet`, so a revert would stay green. Added `test/tripMapServerRender.test.ts`, a node-environment suite that imports all four map surfaces unmocked; verified it fails with the real `ReferenceError: window is not defined` when the static import is restored.
  - `[medium]` `[patch]` `calc(100vh - 324px)` goes to zero or negative below a ~330px viewport, handing Leaflet a container with no height. Both constants are now `max(240px, calc(100vh - 324px))`.
  - `[low]` `[patch]` The empty-state guard was written as a duplicated-condition nested ternary on the two full-page screens and a different shape on the two panels; the comment also quoted `&& !error`, which appears nowhere in the code. All four surfaces now use one nesting, and the comments explain why the ledger's literal `&& !error` cannot be used (it falls through to the map arm and hands Leaflet an empty bounds).
  - `[low]` `[patch]` `fullViewportFloor.ts` re-implemented `stripComments` rather than importing `hardcodedColour.ts`'s — the exact fork DW-219 existed to remove. Now imported; the inherited limits are documented.
  - `[low]` `[patch]` The floor guard's regex only matched a bare quoted `100vh`, missing `minHeight: { xs: "100vh" }` and template literals. Broadened, with `calc(` excluded so the map's own constant stays legal; ten spellings checked.
  - `[low]` `[patch]` Two line citations were invalidated by this same commit (`TripDayMapPanel.tsx:121-143`) or off by ten (`TripDayView.tsx:2588`). Replaced with stable prose references.
  - `[low]` `[patch]` Both page shells were left with a no-op `<Box>` once `minHeight` was removed. Collapsed to the `Container`, keeping the explanatory comment.
  - `[low]` `[patch]` The floor guard is applied to two of the six pages carrying `minHeight: "100vh"`; the helper now records why the other four are out of its scope.

### 2026-08-15 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 6: (high 0, medium 1, low 5)
- defer: 4: (high 0, medium 2, low 2)
- reject: 6: (high 0, medium 0, low 6)
- addressed_findings:
  - `[medium]` `[patch]` `FULL_PAGE_MAP_HEIGHT`'s band table asserted a 66px header, but `AppHeader` is `position="static"` with `Toolbar sx={{ minHeight: 72 }}` and a 1px AppBar bottom border — 73px, with no `MuiToolbar` override anywhere in `theme.ts` to reduce it. Every other band in the table re-derives correctly from source, so the real chrome is 331px and the shipped 324 left the page scrolling by 7px: the exact defect DW-59 was filed about, under a comment claiming a browser measurement of zero. Both constants are now 331, the table is corrected band by band with each one traced to its source, and the comments record that over-subtracting costs unused pixels while under-subtracting costs a scrollbar, so the next reader errs in the safe direction.
  - `[low]` `[patch]` The `max()` floor was documented as engaging "below a viewport of about 330px", the point at which the raw subtraction would reach zero — but with a 240px floor it takes over from about 571px down, so the comment understated by 234px the range in which the page is allowed to scroll. Corrected in both files.
  - `[low]` `[patch]` `MAP_PREVIEW_BORDER` was declared and then used only in the map's height subtraction, while the frame itself was the literal `"1px solid"`. Two spellings of one number, with a comment asserting they were linked; the border is now built from the constant, so thickening it cannot silently clip the route again.
  - `[low]` `[patch]` The floor guard's regex stops at the first comma, which made it blind to the multi-breakpoint responsive spelling (`minHeight: { xs: "50vh", md: "100vh" }`) even though the previous pass recorded it as covered — verified against the old pattern, which returns false for both the inline and multi-line forms. A second branch now scans inside a `minHeight: { … }` group, and the guard finally has its own suite (`test/fullViewportFloor.test.ts`, 11 positive and 6 negative spellings plus a missing-file case), matching the precedent `hardcodedColour.test.ts` set for a shared guard whose every real call site is clean.
  - `[low]` `[patch]` `tripMapServerRender.test.ts` caught only the static-import spelling of the 500 it documents: `dynamic()` does not evaluate its factory at import time, so a regression to `ssr: true` — or to an omitted options object, whose default is `ssr: true` — would leave the suite green while the route 500s again. Added a source assertion that all four surfaces reach their Leaflet child through `dynamic(…, { ssr: false })`.
  - `[low]` `[patch]` The day full-page suite's negative subline assertion hardcoded `/^Day \d/`, contradicting the dictionary-composed convention its own sibling assertion states two lines earlier; a reworded key would have made it pass vacuously. Rebuilt from `trips.dayView.title`.

### 2026-08-15 — Review pass (second follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 8: (high 0, medium 0, low 8)
- defer: 4: (high 0, medium 1, low 3)
- reject: 16: (high 0, medium 2, low 14)
- addressed_findings:
  - `[low]` `[patch]` The DW-59 floor guard's `calc(` exclusion applied to the whole `minHeight: { … }` group, so the first `calc()` inside the braces masked every later value and `minHeight: { xs: "calc(100vh - 40px)", md: "100vh" }` went unseen — not an exotic spelling, since the map's own height *is* a `calc()`, so an author mixing it with a plain floor writes exactly this. The exclusion is now per breakpoint value. Verified against the old pattern first (returns false for both the inline and multi-line forms) and against every previously pinned spelling; two positives and two negatives added, including the responsive form of the map's own `max(240px, calc(…))`, comma and all.
  - `[low]` `[patch]` The same guard's docblock presented an exhaustive audit — "Four other pages … still set `minHeight: "100vh"`" — and there are five. The missing one is `days/[dayId]/print/page.tsx`, whose own comment records DW-198: a blank trailing print sheet caused by this identical `100vh` + 73px-header interaction. The one prior occurrence of the bug class was absent from the enumeration meant to guide future widening, and it is also the one page where the floor is the correct answer. Both facts now recorded.
  - `[low]` `[patch]` `tripMapServerRender.test.ts` validated only the *first* Leaflet `dynamic()` per file (`exec`) and scanned comments as if they were code. A surface growing a second Leaflet child with `ssr: true` would have kept the suite green while the route 500s again, and a commented-out correct call could vouch for live code that was wrong. Now `matchAll` over every call with `stripComments` applied; both mutations checked to confirm the new form rejects what the old one accepted.
  - `[low]` `[patch]` The day full-page suite's comment claimed "the caps label remains this screen's only h1" while asserting only that the label *is* a heading — which holds equally if the subline were given a heading role too. The negative half is now asserted.
  - `[low]` `[patch]` The "no day loaded" case asserted the absence of `Day undefined`, a string the code cannot produce: `formatMessage` substitutes `{index}` only when the value is defined and leaves the placeholder verbatim otherwise. The regression the comment names — a literal `Day {index}` on screen — was unasserted. Added against the raw template.
  - `[low]` `[patch]` `TripDayMapFullPage.tsx`'s gate comment carried the same misconception, stating that `day.dayIndex` on a null day "would print Day undefined". It throws; it is the defensive `day?.dayIndex` spelling that prints the literal placeholder. Corrected to name both failure modes the gate actually prevents.
  - `[low]` `[patch]` `test/tripOverviewMapFullPage.test.tsx` still described the AppHeader as 66px — the stale figure the previous pass existed to correct, surviving in the comment on the assertion that guards the correction. Now 73.
  - `[low]` `[patch]` The floor guard's missing-file case used a bare `.toThrow()`, which any throw satisfies including the helper's own assertion failing for an unrelated reason. Matched on `ENOENT`.

## Design Notes

The `loadError` guard on the two preview panels is defence-in-depth, not a live bug fix: `TripTimeline` and `TripDayView` both null out `detail` on a failed load and gate their whole body on it, so today the panel is unmounted when the error alert shows. DW-56 asked for all four surfaces to share one rule, and the panel-level guard is what makes the rule true of the component rather than of its current callers. Keep the wiring in both parents so the prop is exercised, and note it in the run result.

The two full-page constants keep the same identifier in each file deliberately — they are per-file values, not a shared export, because the two screens have different chrome (the trip map's trip-name subline, and now the day map's day subline). A comment in each file must record which measurement produced the number so the next change re-measures rather than copies.

## Verification

**Commands:**
- `cd travelplan && npx vitest run test/tripOverviewMapPanel.test.tsx test/tripDayMapPanel.test.tsx test/tripOverviewMapFullPage.test.tsx test/tripDayMapFullPage.test.tsx` -- expected: all pass
- `cd travelplan && npm test` -- expected: full suite green, no pre-existing failures introduced
- `cd travelplan && npm run lint` -- expected: clean
- `cd travelplan && npm run typecheck` -- expected: clean

**Manual checks (if no CLI):**
- Isolated browser pass on both full-page map screens at 1440×1080 and 1280×620: no vertical scrollbar, `scrollHeight - clientHeight === 0`, the day map shows its `Day N` subline, and the map fills the space below the label without being clipped.


## Auto Run Result

Status: done (second follow-up review pass; `review_loop_iteration` 0, no loopback taken)

**What this pass changed.** The story was already `done`. This was an independent review of the whole DW-15/56/57/59 diff against `5bc1fa1`, run through two parallel reviewers with no shared context and no knowledge of the previous passes. Nothing traced back into the intent contract and nothing needed a spec amendment: the contract held, and so did the code. Every finding that survived verification was in the *guards* the previous pass built, not in the behaviour they guard — which is the expected shape once a story's own defects are out, and the reason the follow-up recommendation drops to false below.

Eight patches, all low, one production file among them and only a comment in it. The two that changed what the suite actually catches:

- The DW-59 floor guard's `calc(` exclusion was applied to the whole `minHeight: { … }` group, so the first `calc()` inside the braces hid everything after it. `minHeight: { xs: "calc(100vh - 40px)", md: "100vh" }` — the mixed object an author writes when reaching for the map's own `calc()` at one breakpoint and a plain floor at another — passed the guard silently. Both reviewers found it independently. The exclusion is now per breakpoint value, verified against the old pattern before and every previously pinned spelling after.
- `tripMapServerRender.test.ts` read only the first Leaflet `dynamic()` in each file and treated comments as code, so a second child with `ssr: true` — or a commented-out correct call above a wrong live one — kept the suite green while the route 500s. Now `matchAll` with `stripComments`; both mutations checked to confirm the new form rejects what the old accepted.

The rest are accuracy fixes in the places a later reader would trust: a docblock that undercounted the pages carrying the floor and so omitted DW-198, the one prior occurrence of its own bug class; a comment still saying 66px in the test guarding the 66→73 correction; two assertions whose comments claimed more than they checked; and one source comment naming a failure mode the code cannot produce.

**Files changed**
- `travelplan/test/helpers/fullViewportFloor.ts` — per-value `calc(` exclusion in the responsive branch; docblock corrected to five pages and the print sheet's DW-198 precedent
- `travelplan/test/fullViewportFloor.test.ts` — two calc-masked positives, two calc negatives, `ENOENT`-matched missing-file case (11/6 → 13/8)
- `travelplan/test/tripMapServerRender.test.ts` — `matchAll` over every Leaflet `dynamic()` with comments stripped
- `travelplan/test/tripDayMapFullPage.test.tsx` — subline asserted *not* to be a heading; raw-template assertion for the leaked-placeholder regression
- `travelplan/test/tripOverviewMapFullPage.test.tsx` — 66px → 73px
- `travelplan/src/components/features/trips/TripDayMapFullPage.tsx` — gate comment corrected (comment only; no behaviour change)
- `_bmad-output/implementation-artifacts/deferred-work.md` — DW-348 … DW-351 appended

**Findings breakdown.** 8 patched (all low), 4 deferred (1 medium, 3 low), 16 rejected.

Rejected, with reasons: five findings restate ledger entries this story already opened — the chrome that varies (DW-344), viewport units and breakpoints (DW-345), the unframed day panel (DW-346), the missing `loading` fallback (DW-347) — and re-deferring them would only churn the ledger. Three concern the `loadError` guard's unreachable paths (stale points, a missing-locations list, a flag cleared on silent refresh): all three require the panel to be mounted after a failed load, and both parents null their detail and gate their whole body on it, which the Design Notes already record as why the guard is defence-in-depth. The remainder were spec-directed choices objected to on taste (the new caption keys, `Boolean(error)` at the timeline call site, the two links to one href, literals matching their own file's local convention), a claimed contradiction between the two constants' docblocks that is really one being more specific than the other, and a floor-regex "false positive" on `max(100vh, …)` that is a genuine floor and correctly flagged.

Deferred as DW-348 … DW-351: nothing pins the 331px band table, so the part of DW-59 that was actually wrong still has no automated guard while the secondary cause now has a whole suite (medium — a theme edit silently restores the scroll, and `Toolbar minHeight: 72` is a minimum the header can exceed on its own); the floor guard is a two-file literal-path scan, blind to a floor reached through an identifier or introduced in the shared layout; the SSR guard names its four surfaces by hand, so a fifth ships the same 500 unguarded; and DW-15's content-box arithmetic — the fix for a clipped route that already regressed once — has no assertion behind it.

**Verification.** `npm test` — 153 files, 2425 tests, all pass (2421 before; the four added are the new regex spellings). `npm run typecheck` — clean. `npm run lint` — 0 errors, 79 warnings, the same pre-existing set, none in touched files. The seven affected suites also run in isolation: 90 pass. Both regex changes were mutation-checked rather than trusted: the floor pattern was run against the old and new forms over 21 spellings, and the SSR pattern against a synthetic second `ssr: true` call and a commented-out decoy.

**Residual risks.** Unchanged from the previous pass and still the significant one: the 331px constant is derived from source, not measured. No browser is available in this session and the repo carries no Playwright, so the acceptance criterion's `scrollHeight - clientHeight === 0` has never been re-read since the correction. The direction is the safe one — over-subtracting costs unused pixels, under-subtracting costs a scrollbar — and DW-348 now records that nothing will catch a drift in the meantime. DW-344 remains the reason a green reading, when someone can take one, would only describe the card in its plainest state.
