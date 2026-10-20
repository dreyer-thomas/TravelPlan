---
authored_against: 178b25f
baseline_commit: 178b25f
---

# Story 7.14: Planned Distance on the Trip Overview

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner looking at the whole trip,
I want to see how many kilometres I have planned, in total and per mode of transport,
so that I can judge the trip's travel load at a glance without adding up the legs day by day.

**FRs covered:** FR50 (added 2026-10-19)

## Acceptance Criteria

1. **Card.** On the trip overview (`TripTimeline`), a card titled "Strecken" / "Distance" sits in the side column **directly below the "Kosten bisher" card** and above the route map panel. It uses the same token card treatment as the cost card. Its headline figure is the total of all known kilometres, and below that comes a short subtitle such as "geplante Fahrten · gesamte Reise".
2. **Rows per mode.** Below the headline there is one row per mode of transport that occurs in the trip's counted legs, in `TRANSPORT_TYPES` order (car, ship, flight, walking, cycling, train, bus). A mode with no counted legs gets no row. Each row shows the mode's localised name (`trips.travelSegment.transport.*`, already present), its kilometres, its number of legs and its summed travel time.
3. **No distance.** If none of a mode's counted legs has a distance (always the case for flight and ship, and possible for every other mode except car), its row shows the number of legs and the travel time and **no kilometre figure**. It must not show "0 km".
4. **Known kilometres only.** Kilometres are the sum of the `distanceKm` values that are set. A leg without a distance still counts towards its mode's number of legs and travel time. The card shows no hint about legs with a missing distance (Tommy, 2026-10-19).
5. **Only drawn legs count.** A stored leg is counted only if the day's timeline draws it: the same rule the overview's Gantt bars already apply (`buildDrawnDaySegmentPairKeys` / `isDrawnDaySegment` over the endpoint order *previous night's stay → the day's activities in `compareDayPlanItemsByOrder` order → this night's stay*). An orphaned leg counts for nothing: not for kilometres, not for the number of legs, not for the travel time.
6. **Header figure.** The fourth figure in the overview's header strip, today "Offene Punkte" / "Open items" (`openDaysCount`), is replaced by the total known kilometres under the label "Gesamtstrecke" / "Total distance". It is the same number as the card's headline. The figure keeps the strip's existing typography (21px, 900, tabular numerals, `tokens.ink`). The warning colour leaves with the open-items count.
7. **Gap information preserved.** The "Handlungsbedarf: Tag X" / "Action needed" gap alert in the side column is unchanged. It remains the place that reports days without a stay.
8. **Formatting.** Kilometres are rounded to at most one decimal place **after summing** (never per leg) and formatted with `Intl.NumberFormat` in the UI language (`de-DE` / `en-US`, as `formatCost` does), with no trailing ",0". Examples: `1.234,5 km`, `6.682 km`, `0 km`. Travel times use the existing `formatDurationSummary` (`trips.dayView.ganttHours*` / `ganttMinutes`). Hours are **not** wrapped into days: 31 h stays "31h".
9. **Empty trip.** A trip with no counted legs shows "0 km" in the header. Its card shows "0 km" as the headline plus one muted empty-state line (e.g. "Noch keine Fahrten geplant."). It shows no rows.
10. **All roles.** Owner, contributor and viewer all see the card and the header figure. Both are read-only and need no new permission check.
11. **Dashboard untouched.** The *Meine Reisen* dashboard (`TripsDashboard.tsx`) and its `trips.dashboard.statOpenItems` figure are unchanged.
12. **No API / schema change.** All figures come from the `GET /api/trips/{id}` payload the screen already loads (`days[].travelSegments[]`: `transportType`, `durationMinutes`, `distanceKm`).

## Tasks / Subtasks

- [x] **Task 0: Baseline** (all ACs)
  - [x] Run `npm test`, `npm run typecheck` and `npm run lint` in `travelplan/` at `178b25f` and record the results. The last recorded run (12.5) was 218 files / 3511 tests, lint 0 errors / 80 warnings.
- [x] **Task 1: One derivation of a day's drawn legs** (AC5)
  - [x] Extract the per-day block that `TripTimeline.tsx` builds inline today (about `:851-871`: `orderedPlanItems`, then `dayEndpoints`, then `buildDrawnDaySegmentPairKeys`, then `drawnTravelSegments`) into a pure function in `src/lib/trips/`. Suggested names: `tripTravelSummary.ts` with `selectDrawnTravelSegments(day, previousDay)`. Type the inputs structurally (only the fields it reads), so that the component's local `TripDay` type fits without being exported.
  - [x] Make the Gantt loop call this function, so the bar and the new totals cannot drift apart. That is the whole point of `daySegmentPairs.ts`. Read its header comment. `orderedPlanItems` is still needed by the Gantt code (`planItems:`), so return it too or keep the sort and pass it in. Do not sort twice in two different ways.
  - [x] The existing test "keeps an orphaned travel leg out of a day's overview coverage bar" (`test/tripTimelinePlan.test.tsx:267`) must stay green and unchanged.
- [x] **Task 2: The summary function** (AC2, AC3, AC4, AC5, AC8)
  - [x] Add `summarizeTripTravel(days)` to the same module. It walks the days with their previous day, counts only drawn legs, and returns `{ totalKm: number; byMode: { transportType, legCount, durationMinutes, distanceKm: number | null }[] }`. `distanceKm` is `null` when none of the mode's legs has a distance, so AC3 is a data fact, not a rendering guess. `byMode` follows `TRANSPORT_TYPES` order and leaves out modes with zero legs.
  - [x] Skip a leg whose `transportType` fails `isTransportType`, so a bad row cannot crash the card (the column is bare TEXT, see `transportTypes.ts`). Do not invent an "other" row.
  - [x] Round once, at the end: `Math.round(sum * 10) / 10` for each mode and for the total. Compute the total from the unrounded leg sum, not from the rounded per-mode values.
  - [x] Unit tests in `test/tripTravelSummary.test.ts` cover:
    - mixed modes;
    - a leg with `distanceKm: null` in a mode that has other distances (counts towards legs and time, not km);
    - flight only, which gives `distanceKm: null`;
    - an orphaned leg, which is excluded from all three numbers;
    - a leg from the previous night's stay that *is* drawn (the first leg of a day);
    - float noise such as `0.1 + 0.2`, which must give `0.3`;
    - an unknown `transportType`, which is skipped;
    - no days or no legs, which gives `totalKm: 0` and `byMode: []`.
- [x] **Task 3: Header figure** (AC6, AC7, AC8, AC9)
  - [x] In the header strip (`TripTimeline.tsx` about `:794-807`), replace the "Offene Punkte" cell with the total distance. Keep the cell's padding and borders as they are.
  - [x] `openDaysCount` (`:571`) loses its only reader in the header. Remove it if nothing else reads it. `firstGapDay`, which drives the gap alert, stays.
  - [x] Add a `formatDistanceKm` next to `formatCost` (`:297`): a `useMemo` that uses `Intl.NumberFormat(language === "de" ? "de-DE" : "en-US", { maximumFractionDigits: 1 })` and appends ` ${t("trips.travelSegment.kmSuffix")}`.
- [x] **Task 4: The card** (AC1, AC2, AC3, AC9, AC10)
  - [x] Insert the card between the cost card (it ends about `:1175`) and `<TripOverviewMapPanel …>`. Copy the cost card's shell: `tokens.card`, `1px solid tokens.borderStrong`, 8px radius, 18px padding, `mb: 2`, `labelCaps` h5 title, `metricLg` headline, `body2` subtitle, and the `:last-child` divider rows.
  - [x] Row layout: the mode name on the left, and on the right, in `fontVariantNumeric: "tabular-nums"`, `"<km> · <n> Fahrten · <duration>"`. Leave out the km part when `distanceKm === null`. Build the legs count from a singular/plural pair of keys, as `dayCountOne` / `dayCount` do.
  - [x] Compute the summary once per render, with `useMemo` over `detail?.days`. Mind the early returns: hooks must sit above `loading` / `notFound`, as the existing comments at `:592` explain.
  - [x] The card renders for every role (no `canEditPlanning` guard).
- [x] **Task 5: i18n** (all ACs)
  - [x] Add the new keys to both `src/i18n/de.ts` and `src/i18n/en.ts`, under `trips.timeline.*`, next to `costSummary*`:
    - `statTotalDistance`: "Gesamtstrecke" / "Total distance"
    - `distanceSummaryTitle`: "Strecken" / "Distance"
    - `distanceSummarySubtitle`: "geplante Fahrten · gesamte Reise" / "planned travel · whole trip"
    - `distanceLegCountOne`: "1 Fahrt" / "1 leg"
    - `distanceLegCount`: "{count} Fahrten" / "{count} legs"
    - `distanceEmpty`: "Noch keine Fahrten geplant." / "No travel planned yet."
    - "Fahrt" / "Fahrten" is the established German term (Story 11.1).
  - [x] Remove `trips.timeline.statOpenItems` from both dictionaries once it has no reader. **Do not touch** `trips.dashboard.statOpenItems`.
  - [x] `test/i18nDictionaries.test.ts` must stay green, because the two dictionaries have to keep the same keys.
- [x] **Task 6: Component tests** (AC1–AC10)
  - [x] `test/tripTimelinePlan.test.tsx:1047-1048` and `:1198` assert "Open items". Re-point them at "Total distance" with the fixture's expected km. Do not delete them.
  - [x] Add a render test with a fixture of at least two days. It needs car legs with distances, one walking leg without a distance, one flight and one orphaned car leg. Assert that:
    - the header and the card headline show the same total;
    - the car row shows the km, the legs and the time;
    - the flight row has no "km";
    - the orphan's km is absent from the total.
  - [x] Add an empty-trip test: the header shows "0 km", the card shows the empty line and no rows.
  - [x] Add a German-locale assertion for one formatted total (for example "1.234,5 km"), because 7.13's review caught tests that only ever pinned en-US on a locale-sensitive story.
  - [x] Add a viewer-role render that shows the card (`tripTimelineRoles.test.tsx` has the role fixtures).
- [x] **Task 7: Gates + real run**
  - [x] Run test, typecheck, lint (0 errors, warnings ≤ baseline) and `npm run build`.
  - [x] Real run with Tommy on the New Zealand trip in dev.db. That trip holds orphaned legs on about 16 days, so the card's car km must be **lower** than a naive `SELECT SUM(distance_km)` over that trip's segments. Record both numbers in the Completion Notes. Check the 390px layout: the card stacks in the side column, and the header strip goes 2×2.

### Review Findings

- [x] [Review][Patch] Flight/ship legs with a stored distance (restored backup or legacy row — `tripImportSchemas.ts` deliberately does not enforce the mode/distance coupling) are added to `totalKm` and get a km figure on their row; the day view hides that same distance via `transportTypeAllowsDistance` (`TripDayView.tsx:2538`). Apply the same guard and pin it in a unit test [travelplan/src/lib/trips/tripTravelSummary.ts:109]
- [x] [Review][Patch] The German-locale test pins the no-break space as an invisible raw U+00A0 literal; write it as `"1.234,5 km"` so a formatter cannot silently turn it into a plain space [travelplan/test/tripTimelinePlan.test.tsx:1361]

## Dev Notes

### Current state of the files this story touches

- **`travelplan/src/components/features/trips/TripTimeline.tsx`** (1277 lines)
  - `:66-131`: local types. `TripDay.travelSegments?` is optional and already carries `transportType: TransportType`, `durationMinutes` and `distanceKm: number | null`.
  - `:297`: `formatCost`, a locale-aware `Intl.NumberFormat`. It is the model for `formatDistanceKm`.
  - `:369`: `formatDurationSummary(minutes)`. Reuse it as is.
  - `:571`: `openDaysCount`. Its only reader is the header cell at `:794-807`.
  - `:750-808`: the header strip, a 4-column grid (2×2 on xs). The cells are Dauer, Stationen, the Kosten bisher link, and Offene Punkte. The fourth cell has no right border and no bottom border; keep it that way.
  - `:833-930`: the day loop. `orderedPlanItems`, `dayEndpoints`, `drawnPairKeys` and `drawnTravelSegments` are computed inline per day. This is the logic Task 1 extracts.
  - `:1135-1176`: the side-column cost card, the template for the new card.
  - `:1178`: `TripOverviewMapPanel`. The new card goes between `:1176` and `:1178`.
- **`travelplan/src/lib/trips/daySegmentPairs.ts`**: the drawn-leg rule. Import it; do not copy it.
- **`travelplan/src/lib/trips/dayPlanItemOrder.ts`**: `compareDayPlanItemsByOrder`. The overview sorts with it because the payload order is not a contract (see the comment at `:844-853`).
- **`travelplan/src/lib/trips/transportTypes.ts`**: `TRANSPORT_TYPES` (display order), `isTransportType`. Flight and ship never carry a distance; walking, cycling, train and bus may; car must.
- **`travelplan/src/i18n/{de,en}.ts`**: the transport names already exist (`trips.travelSegment.transport.*`), and so does `trips.travelSegment.kmSuffix`.

### Why the drawn-leg rule matters here (do not skip)

`TravelSegment` rows have no foreign key and no adjacency check. When a day is reordered, a leg whose endpoints are no longer neighbours stays stored as an *orphan*. The day view lists it under "Verwaiste Fahrten" as **not counted**. Removing old orphans automatically was explicitly parked by Tommy on 2026-10-18. dev.db has them on about 16 days of the New Zealand trip. Across all trips, dev.db holds 107 car legs and 6,682 km, and that figure includes orphans. A naive sum would report kilometres the day view refuses to count. The same class of bug made Story 8.5 extract `daySegmentPairs.ts` (the "7h 45m vs 7h 30m" incident in its header).

The first leg of a day may start at the **previous day's** stay. That is why the endpoint list needs `previousDay.accommodation`, and why `summarizeTripTravel` must walk the days in order with their predecessor. `detail.days` comes ordered by `dayIndex`.

### Distance formatting

There is no shared display formatter for distances today: `TripDayView.tsx:2539` and `TripDayPrintDocument.tsx:465` print the raw `${distanceKm} km`. Story 6.30 limited *input* to one decimal, so single legs are clean, but sums of floats are not (`0.1 + 0.2`). Round after summing. Do not refactor the day view or print formatting in this story; that is out of scope.

### Traps

- **Hooks after early returns.** `TripTimeline` has `loading` / `notFound` early returns. The new `useMemo` must sit above them (see the DW-107 comment at about `:592`).
- **Two "Offene Punkte" keys.** `trips.timeline.statOpenItems` goes away. `trips.dashboard.statOpenItems` is a different key on a different screen and stays (AC11).
- **Headline vs header.** Both must come from the same `summary.totalKm`, never from two computations.
- **No "0 km" row** for flight or ship (AC3). Do not render a km figure just because `0` is falsy-but-defined. The data says `null` for that reason.
- **Epic 7's charter** says it adds no capability. This story is the recorded exception (see epics.md, Epic 7 summary). Do not "fix" that line.

### Testing

Vitest + Testing Library. `renderWithProviders` defaults to English. For the German assertion, use whatever language override `tripTimelinePlan.test.tsx` or `i18nProvider.test.tsx` already use; do not invent a new mechanism. The pure function gets plain unit tests, with no React.

### Project Structure Notes

- New file: `travelplan/src/lib/trips/tripTravelSummary.ts`, a pure, dependency-free module that client components can import (the same constraint as `transportTypes.ts`: no zod).
- New test: `travelplan/test/tripTravelSummary.test.ts`.
- Modified: `TripTimeline.tsx`, `src/i18n/de.ts`, `src/i18n/en.ts`, `test/tripTimelinePlan.test.tsx`, and possibly `test/tripTimelineRoles.test.tsx`.

### References

- Epic and ACs: [Source: _bmad-output/planning-artifacts/epics.md#Story 7.14]
- FR50: [Source: _bmad-output/planning-artifacts/prd.md, Transport & Routing]
- Drawn-leg rule: [Source: travelplan/src/lib/trips/daySegmentPairs.ts]
- Transport modes and distance rules: [Source: travelplan/src/lib/trips/transportTypes.ts]
- Card template: [Source: travelplan/src/components/features/trips/TripTimeline.tsx:1135-1176]
- Orphaned legs parked: memory `orphan-legs-cleanup-parked` (2026-10-18)

### Tommy's rulings (2026-10-19)

1. Per mode, show km + number of legs + travel time.
2. "Planned" = every leg entered between activities and stays. No status is introduced.
3. Sum only known km, with no missing-distance hint.
4. Replace the trip overview header's "Offene Punkte". The Meine Reisen dashboard stays as is.
5. Story placed in Epic 7 as 7.14.

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (claude-opus-5-5), bmad-dev-story, 2026-10-19

### Debug Log References

- Baseline at 178b25f: 218 files / 3513 tests passed (the story's "3511" was a stale count, not a regression), typecheck clean, lint 0 errors / 80 warnings.
- After: 219 files / 3526 tests passed (+1 file, +13 tests), typecheck clean, lint 0 errors / 80 warnings (= baseline), `npm run build` OK.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created
- Task 1: `selectDrawnTravelSegments(day, previousDay)` in `src/lib/trips/tripTravelSummary.ts` now holds the per-day block the Gantt loop had inline (comparator sort → endpoint list → `buildDrawnDaySegmentPairKeys` → filter). It is generic over the item/segment types, so `TripTimeline`'s local `TripDay` fits without being exported. It returns `orderedPlanItems` too, so the Gantt code sorts once. The Story 8.5 rationale comment moved with the code. The orphan coverage-bar test is unchanged and green.
- Task 2: `summarizeTripTravel(days)` reuses that function for every day plus its predecessor. It skips modes outside `isTransportType` and non-finite distances. Rounding happens once, at the end: per mode, and for the total from the unrounded leg sum. A test pins the case where those differ (0.04 + 0.04: modes 0/0, total 0.1). `distanceKm: null` means the mode has no distance anywhere.
- Task 3: the header's fourth cell shows `formatDistanceKm(travelSummary.totalKm)` under "Gesamtstrecke"/"Total distance", in `tokens.ink`; the warning colour is gone. `openDaysCount` was removed (no reader left). `firstGapDay` and the gap alert are untouched.
- Task 4: the card sits between the cost card and `TripOverviewMapPanel`, with the same shell and `:last-child` divider rows. Each row reads `"<km> · <n> legs · <duration>"`, and the km part is dropped when `distanceKm === null`. It has no role guard. `useMemo` sits above the `loading`/`notFound` early returns. Header and card read the same `travelSummary.totalKm`.
- Task 5: the six keys were added to de/en, and `trips.timeline.statOpenItems` was removed from both. `trips.dashboard.statOpenItems` is untouched.
- Task 6: the two "Open items" assertions were re-pointed to "Total distance" → "0 km" (both fixtures have no legs; the gap alert is still asserted). The new `Story 7.14 planned distance` block covers: a mixed trip (car 1,234.5 km · 2 legs · 31h, so hours are not wrapped into days; flight and walking rows with no km; a 5,000 km orphan absent from both figures), German formatting (`1.234,5 km`, "Auto", "2 Fahrten", "1 Fahrt"), and the empty trip ("0 km", empty line, no rows). The viewer case in `tripTimelineRoles.test.tsx` asserts that the card and the header figure render.
- Task 7, dev.db cross-check (Neuseeland, `cmvb5zplz000286dyqk0u0ah0`). Naive `SUM(distance_km)` per mode: car 107 legs / 6,682.4 km, train 2 / 969.7, walking 5 / 2.1, flight 1 / —. Through `summarizeTripTravel` over the same rows: car **91 legs / 4,898 km** (16 orphaned car legs excluded), train 2 / 969.7, walking 5 / 2.1, flight 1 / no km. **Total 5,869.8 km.** Car is lower than the naive sum, as AC5 requires. This ran the real module over raw DB rows (with the DB's uppercase enums mapped to the wire shape), not through the browser.
- Real run, desktop (Tommy's screenshot, 2026-10-19, German UI). Header "GESAMTSTRECKE 5.869,8 km" and the card headline "5.869,8 km" agree. Rows: Auto 4.898 km · 91 Fahrten · 83h 54m; Flug 1 Fahrt · 7h 59m (no km); Zu Fuß 2,1 km · 5 Fahrten · 1h; Bahn 969,7 km · 2 Fahrten · 10h 20m. All four match the dev.db cross-check above. The card sits between "Kosten bisher" and the map panel.
- Real run, 390px (Tommy's screenshots, 2026-10-19). The header strip goes 2×2 (Dauer | Stationen / Kosten bisher | Gesamtstrecke). The Strecken card stacks between Kosten bisher and Route in the single column, and its rows fit on one line. **Defect found and fixed:** the header cell broke "5.869,8 / km" over two lines, because the formatter joined number and unit with a plain space. `formatDistanceKm` now uses U+00A0, the same no-break space `Intl`'s currency style puts before "€" (the reason "19.184,58 €" never broke). The German-locale test pins the raw `textContent` "1.234,5\u00A0km", since `toHaveTextContent` normalises whitespace and could not catch a regression. Gates re-run after the fix: 219 files / 3526 tests, typecheck clean, lint 0 errors / 80 warnings, build OK.

### File List

- travelplan/src/lib/trips/tripTravelSummary.ts (new)
- travelplan/test/tripTravelSummary.test.ts (new)
- travelplan/src/components/features/trips/TripTimeline.tsx (modified)
- travelplan/src/i18n/de.ts (modified)
- travelplan/src/i18n/en.ts (modified)
- travelplan/test/tripTimelinePlan.test.tsx (modified)
- travelplan/test/tripTimelineRoles.test.tsx (modified)
- _bmad-output/implementation-artifacts/sprint-status.yaml (modified)

### Change Log

- 2026-10-19: Implemented Tasks 0–6 and the automated gates of Task 7 (shared drawn-leg derivation, trip travel summary, header total distance replacing open items, distance card, i18n, tests). Real run on desktop and 390px with Tommy; the unit wrap at 390px was fixed with a no-break space. Status review.
- 2026-10-19: Code review (Blind Hunter, Edge Case Hunter, Acceptance Auditor): 0 decision-needed, 2 patch, 0 defer, 18 dismissed. Patched: `summarizeTripTravel` ignores a distance stored on a flight/ship (`transportTypeAllowsDistance`, matching the day view) with a unit test; the German-locale test writes the no-break space as `\u00A0`. Gates: 219 files / 3527 tests, typecheck clean, lint 0 errors / 80 warnings. Status done.
