---
title: 'Detect zero-distance OSRM routes as no-route, not success or generic failure'
type: 'bugfix'
created: '2026-08-09'
status: 'done'
baseline_revision: '1eca2aacc33c619b73e347650ddbbd2bd01ee9f1'
review_loop_iteration: 0
followup_review_recommended: false
final_revision: 'cbd16519e426967ffa0b4d9c7e22eda42d4f615f'
context: []
warnings: []
---

<intent-contract>

## Intent

**Problem:** When no routable network exists near either point, OSRM snaps both requested coordinates to the same distant node and answers `code: "Ok"` with `distance: 0, duration: 0`. `dayRouteService.ts`'s success path passes this through unflagged, so the caller cannot distinguish it from a real (short) route, and the travel-segment dialog's `> 0` guards then collapse it, and a genuinely partial result (valid duration, non-numeric distance), into one generic "Route import failed" message that discards data the server did send.

**Approach:** In `dayRouteService.ts`'s success path, detect a zero-distance/zero-duration OSRM answer between coordinates that are not all identical and throw the existing `DayRouteError('routing_no_route', ...)` for it, the same way `NoRoute`/`NoSegment` already are. In `TripDayTravelSegmentDialog.tsx`'s route-preview handler, split the collapsed branch so a zero-distance/zero-duration result reaching the success path reads as "no route for this mode", and a result where only one of duration/distance is a valid number fills in that field instead of discarding both.

## Boundaries & Constraints

**Always:**
- Preserve existing behavior for `NoRoute`/`NoSegment`/non-`Ok` codes, empty route lists, and invalid geometry — this change only adds a new detection inside the already-`Ok`, already-has-a-route branch.
- The zero-distance check in `dayRouteService.ts` must not fire when all requested points share the same coordinates — a real zero-length route (e.g. two day items pinned at the same spot) is a legitimate answer, not a routing failure.
- In the dialog, when neither duration nor distance is a usable number, keep the existing generic fallback message (`googleMapsFallbackActive`).
- Reuse the existing `routing_no_route` / `googleMapsNoRouteForMode` code and message; do not introduce a new error code or translation key for the zero-distance case.

**Block If:** (none — the fix is fully determined by the ledger entries and existing code conventions)

**Never:**
- Do not touch the Google Maps auto-fill path, the manual (ship/flight) path, or any code outside `dayRouteService.ts`'s success branch and the route-preview handler in `TripDayTravelSegmentDialog.tsx`.
- Do not add a new user-facing message for the "partial fill" case — silently fill in whichever field arrived.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Zero route between distinct points | OSRM `code:"Ok"`, `distance:0`, `duration:0`, requested points not all equal | `getDayRouteFromOsrm` throws `DayRouteError('routing_no_route', ...)` | Caller's existing `routing_no_route` handling (404 at both API routes) |
| Zero route between identical points | OSRM `code:"Ok"`, `distance:0`, `duration:0`, all requested points equal | Resolves normally with `distanceMeters: 0, durationSeconds: 0` | No error |
| Normal non-zero route | OSRM `code:"Ok"`, `distance:12345`, `duration:1800` | Resolves normally, unchanged | No error |
| Dialog receives zero/zero success | `route.distanceMeters === 0 && route.durationSeconds === 0` from a 200 response | `googleMapsNoRouteForMode` helper text shown, no fields changed | Treated like the `routing_no_route` branch above it |
| Dialog receives valid duration, non-numeric distance | `route.durationSeconds` a number, `route.distanceMeters` not a number | Duration field filled in, distance field left untouched, prefill success helper shown | No error |
| Dialog receives valid distance, non-numeric duration | `route.distanceMeters` a number, `route.durationSeconds` not a number | Distance field filled in, duration field left untouched, prefill success helper shown | No error |
| Dialog receives neither as a number | Both non-numeric | `googleMapsFallbackActive` shown, no fields changed | Unchanged existing behavior |

</intent-contract>

## Code Map

- `travelplan/src/lib/routing/dayRouteService.ts:141-164` -- success path where `code: "Ok"` responses are turned into a `DayRouteResult`; add the zero-distance/zero-duration-between-distinct-points check here, before the `return`.
- `travelplan/src/components/features/trips/TripDayTravelSegmentDialog.tsx:474-524` -- `handleGoogleMapsRoute`, specifically the `> 0`-guarded block at `:501-508`, which needs splitting into the three outcomes above.
- `travelplan/src/i18n/en.ts:420-421`, `travelplan/src/i18n/de.ts:406-407` -- existing `googleMapsNoRouteForMode` string, reused as-is for the dialog's zero-route branch.
- `travelplan/test/dayRouteService.test.ts` -- existing test file for `getDayRouteFromOsrm`; add cases for the new zero-distance detection and the identical-points exemption.
- `travelplan/test/travelSegmentDialog.test.tsx` -- existing dialog-level test suite (238 cases); contains a pre-existing test pinning the exact pre-fix `handleGoogleMapsRoute` partial-result behavior this bundle changes -- must be updated, not just added to. Added during finalization; not found by the initial file search since its filename doesn't match the component's.

## Tasks & Acceptance

**Execution:**
- [x] `travelplan/src/lib/routing/dayRouteService.ts` -- In the success path (around line 160, after the polyline length check and before building the return value), add a check: compute the straight-line distance between the requested `points` (see Design Notes helper); if not all points are within `ZERO_ROUTE_PROXIMITY_METERS` of the first point, and `route.distance === 0` and `route.duration === 0`, throw `new DayRouteError("routing_no_route", "No route available for this travel mode")`. -- This is the DW-113 fix: a zero-length route between points that are genuinely far apart is OSRM's way of saying "nothing routable near here", not a real answer, and must be detected the same way `NoRoute`/`NoSegment` already are.
- [x] `travelplan/src/lib/routing/dayRouteService.ts` -- Change the existing `distanceMeters`/`durationSeconds` mapping in the return value from `typeof route.distance === "number" ? route.distance : null` to also require `route.distance >= 0` (same for `duration`), so a malformed negative or non-finite (`NaN`) upstream value maps to `null` instead of flowing through as a number. -- Closes the sanitization gap the dialog's old `> 0` guard used to cover incidentally; `>= 0` still admits a legitimate `0`.
- [x] `travelplan/src/components/features/trips/TripDayTravelSegmentDialog.tsx` -- In `handleGoogleMapsRoute`, replace the `> 0`-guarded `hasDuration`/`hasDistance` block (`:501-508`) with: parse `durationSeconds`/`distanceMeters` as `typeof === "number"` (no `> 0` floor -- `dayRouteService.ts` now guarantees non-negative values); if both are `0`, set `googleMapsNoRouteForMode` and return; if neither is a number, set `googleMapsFallbackActive` and return; otherwise fill in `setDurationInput`/`setDistanceKm` only for whichever field is a number, then proceed with the existing link/prefill-success logic below. Keep the explanatory comment on the zero/zero branch short and point at `dayRouteService.ts`'s comment rather than restating the OSRM-snapping mechanism. -- This is the DW-116 fix: after the service change, a zero/zero success response reaching this branch is a same-location (or near-same-location) route, and the message must not claim import failed; a genuinely one-sided partial result must not discard the field that did arrive.
- [x] `travelplan/test/dayRouteService.test.ts` -- Add: (1) a test that a `code:"Ok"`, `distance:0, duration:0` response between two points ~150km apart throws `routing_no_route`; (2) a test that the same zero/zero response between two bit-identical points resolves normally with `distanceMeters: 0, durationSeconds: 0`; (3) a test that the same zero/zero response between two points a few meters apart (e.g. two independently-geocoded spots in the same building, not bit-identical) also resolves normally rather than throwing -- this is the case the proximity threshold exists for; (4) a test that a negative `distance` or `duration` in an otherwise-`Ok` response with real geometry maps to `null`, not the raw negative number. -- Pins the exact boundary the fix depends on, matching this file's existing `it.each`/`toMatchObject` conventions.
- [x] `travelplan/test/travelSegmentDialog.test.tsx` -- Pre-existing dialog-level test suite discovered during finalization (not originally listed in Code Map -- an earlier file-search missed it because its filename doesn't match the component's). Updated `"keeps manual values when route lookup returns only partial route details"`, which pinned the exact pre-fix behavior DW-116 exists to correct (`durationSeconds: 8100, distanceMeters: null` used to show `ROUTE_IMPORT_FAILED` and discard the duration); it now asserts the duration is filled in and the manual distance is kept. Added a new test for a `200` response with `durationSeconds: 0, distanceMeters: 0` asserting the no-route-for-mode message, not a successful zero import. -- Without this the diff would have shipped alongside a contradicting, still-passing regression test for the exact behavior this bundle changes.

**Acceptance Criteria:**
- Given two coordinates roughly 150km apart with no routable network between them, when `getDayRouteFromOsrm` is called and OSRM answers `code:"Ok"` with `distance:0, duration:0`, then it throws `DayRouteError` with code `routing_no_route`.
- Given two bit-identical coordinates, when `getDayRouteFromOsrm` is called and OSRM answers `code:"Ok"` with `distance:0, duration:0`, then it resolves with `distanceMeters: 0, durationSeconds: 0` (no throw).
- Given two coordinates a few meters apart (within `ZERO_ROUTE_PROXIMITY_METERS`) but not bit-identical, when `getDayRouteFromOsrm` is called and OSRM answers `code:"Ok"` with `distance:0, duration:0`, then it resolves with `distanceMeters: 0, durationSeconds: 0` (no throw) -- this is the DW-116 hotel/restaurant-in-the-same-building scenario.
- Given an OSRM response with a negative `distance` or `duration` value, when `getDayRouteFromOsrm` is called, then the corresponding result field is `null`, not the raw negative number.
- Given the route-preview fetch in the dialog succeeds with `distanceMeters: 0, durationSeconds: 0`, when `handleGoogleMapsRoute` processes the response, then `routeHelper` is set to `googleMapsNoRouteForMode` and neither `durationInput` nor `distanceKm` is changed.
- Given the route-preview fetch succeeds with a numeric `durationSeconds` and a non-numeric `distanceMeters`, when `handleGoogleMapsRoute` processes the response, then `durationInput` is updated from the received duration, `distanceKm` is left unchanged, and `routeHelper` is set to `googleMapsPrefillSuccess`.
- Given the route-preview fetch succeeds with neither field numeric, when `handleGoogleMapsRoute` processes the response, then `routeHelper` is set to `googleMapsFallbackActive` and neither input field is changed.

## Spec Change Log

### 2026-08-09 — Review pass 1 (bad_spec)
- Triggering finding: the original Design Notes/Tasks defined "distinct points" via bit-exact `lat`/`lng` equality (`points.every((point) => point.lat === points[0].lat && point.lng === points[0].lng)`). Two independent, converging reviews (Blind Hunter, Edge Case Hunter) showed this boundary will essentially never fire for the actual motivating case in DW-116 -- two day items independently geocoded in the same building (e.g. a hotel and a restaurant inside it) will almost never share bit-identical coordinates, so the zero-distance/zero-duration answer between them would be misclassified as `routing_no_route` and rejected, which is the opposite of what DW-116 asked for ("an everyday case" that must not read as failure).
- Known-bad state avoided: shipping a fix whose own boundary condition inverts correctness for its primary motivating scenario -- the DW-116 same-building example would regress from "silently wrong success" to "actively wrong rejection".
- Amendment: replaced bit-exact coordinate equality with a proximity check (straight-line distance from the first point, threshold `ZERO_ROUTE_PROXIMITY_METERS`) in the Tasks & Acceptance and Design Notes sections (both outside `<intent-contract>`). The `<intent-contract>` itself was not changed -- it already only said "distinct coordinate pairs" without mandating exact-equality semantics, so this is a refinement of an under-specified operational definition, not a change of intent. Also folded in two moot `patch`-severity findings from the same review pass while re-deriving: (a) tightening `distanceMeters`/`durationSeconds` mapping to reject negative/non-finite values (was: any `typeof === "number"`, allowing a malformed negative value through once the `> 0` dialog guard was removed); (b) trimming the dialog's zero/zero comment to reference `dayRouteService.ts` instead of restating its rationale.
- KEEP: the three-way split in the dialog (zero/zero -> `googleMapsNoRouteForMode`; neither a number -> `googleMapsFallbackActive`; otherwise fill in whichever field is present) is correct and must survive re-derivation unchanged. The throw's placement in `dayRouteService.ts` (after the polyline/geometry validation, before the `return`) and its reuse of the existing `routing_no_route` code/message are correct and must survive unchanged. The two already-passing dialog acceptance criteria for the fallback and partial-fill cases are unaffected by this amendment and must not be re-litigated.

## Review Triage Log

### 2026-08-09 — Review pass
- intent_gap: 0
- bad_spec: 1 (high 1)
- patch: 3 (medium 1, low 2)
- defer: 2 (low 2)
- reject: 5 (low 5)
- addressed_findings:
  - `[high]` `[bad_spec]` The `dayRouteService.ts` "distinct points" check used bit-exact lat/lng equality, which would not fire for realistic same-location points (e.g. two independently-geocoded spots in the same building) and would wrongly reject the exact DW-116 motivating scenario as `routing_no_route`. Amended the spec to use a proximity threshold instead of exact equality (see Spec Change Log), and folded two moot `patch` findings (negative/non-finite value guard; comment duplication) into the same re-derivation since they touch the same code paths.

Findings not actioned this pass (moot -- code is being reverted and re-derived; the two `patch` items above were folded into the amended spec, everything else stands as recorded):
- `defer`: no dialog-level (`TripDayTravelSegmentDialog.tsx`) automated test coverage exists for any of its branches, including the ones this change touches -- pre-existing, no test file for this component exists today.
- `defer`: the same `dayRouteService.ts` zero-distance check also governs the N-point `days/[dayId]/route/route.ts` day-route endpoint (not just the 2-point travel-segment lookup), which has no dedicated test coverage for this boundary either.
- `reject`: the OSRM-snapping mechanism described in the service's comment (and cited in DW-113's own ledger evidence) is asserted without an inline citation; the ledger entry's measured evidence already substantiates it.
- `reject`: the first new `dayRouteService.test.ts` case mocked distinct geometry coordinates alongside `distance:0/duration:0`, which is less representative of literal OSRM node-snapping than repeating the same coordinate -- the test still correctly exercises the code path, which depends only on `points` and `route.distance`/`route.duration`, not on `geometry.coordinates`.
- `reject`: showing `googleMapsNoRouteForMode` for a legitimate zero-length same-location route is imprecise copy, but functionally inert -- `combineDurationToMinutes`'s `total > 0` floor and the save-time `distanceValue <= 0` rejection both already require the user to enter real values before saving, regardless of which message is shown.
- `reject`: the `hasDuration`/`hasDistance` guard change from `||` to `&&`, and leaving the unfilled field untouched on a partial result, are both explicitly specified by this spec's Tasks & Acceptance and Boundaries ("a partial route... fills in the field it did receive"; "do not add a new user-facing message for the partial fill case") -- working as intended, not a defect.

### 2026-08-09 — Review pass 2
- intent_gap: 0
- bad_spec: 0
- patch: 5 (medium 1, low 4)
- defer: 1 (low 1)
- reject: 2 (low 2)
- addressed_findings:
  - `[medium]` `[patch]` A lone zero in exactly one field (e.g. `distanceMeters: 0` with a valid nonzero `durationSeconds`) bypassed both the zero/zero branch and the fallback branch and fell through to "success", prefilling an unsavable `0` under a `googleMapsPrefillSuccess` message. Changed the guard from `durationSeconds === 0 && distanceMeters === 0` to `(hasDuration && durationSeconds === 0) || (hasDistance && distanceMeters === 0)` so a zero in *either* present field routes to `googleMapsNoRouteForMode` instead.
  - `[low]` `[patch]` `metersBetween`'s naive `lng` subtraction computed ~40000km for two points a few metres apart on opposite sides of the antimeridian (e.g. Fiji), which would wrongly reject a legitimate near-location zero/zero as `routing_no_route`. Added `wrapLongitudeDelta` to normalize the longitude delta into `(-180, 180]` before use, with a covering test.
  - `[low]` `[patch]` The `>= 0` sanitization guard admitted `Infinity` (`typeof Infinity === "number"` and `Infinity >= 0` are both true). Added `Number.isFinite(...)` to both the `distanceMeters` and `durationSeconds` mapping, with covering tests.
  - `[low]` `[patch]` The 50m proximity threshold itself had no test near the boundary (existing tests used ~1.2m and ~150km, both far from 50m). Added a paired test at ~33m (resolves) and ~67m (throws) with comfortable margins to avoid floating-point boundary flakiness.
  - `[low]` `[patch]` The dialog's zero/zero-branch comment ("not a failure") read as contradicting the fact that the branch still shows a no-route-style message, which both review passes flagged. Reworded to explain why a zero is never worth importing regardless of framing (this app never accepts a zero duration/distance at save time), removing the apparent contradiction without changing behavior.

Findings not actioned this pass (moot -- see reasoning inline; nothing here required a spec amendment or code revert):
- `defer`: `allPointsNearFirst` anchors every point to `points[0]` rather than checking pairwise/mutual proximity. Harmless for the 2-point travel-segment caller (this bundle's target), but the same shared function backs the N-point `days/[dayId]/route/route.ts` day-route endpoint, where a star-pattern or drifting-chain arrangement of points could misclassify. Pre-existing generalization gap in a shared function, surfaced incidentally; out of scope for this bundle's Code Map (scoped to the 2-point case), worth a dedicated look.
- `reject`: showing `googleMapsNoRouteForMode` for the legitimate near-location case is, per both review passes, the only zero/zero case that can reach the dialog post-fix, and reviewers read this as the service-side fix having "no visible effect". Verified against `validate()` (`travelplan/src/components/features/trips/TripDayTravelSegmentDialog.tsx:404-435`): duration must always be `> 0` (`combineDurationToMinutes`) and distance must be `> 0` whenever required or entered, for every routable mode -- so a `0`/`0` result can never be saved regardless of which message is shown. The message change (no-route explanation, not "import failed") directly answers DW-116's actual complaint ("told import failed and that retrying is worth trying, which it never is") without inviting a retry. Kept the existing behavior; only the now-misleading comment was patched (see addressed_findings above).

### 2026-08-09 — Post-review correction (finalization)
Both `defer` entries logged after Review pass 1 claiming "no dialog-level (`TripDayTravelSegmentDialog.tsx`) automated test coverage exists" were **wrong**. Running the broader test suite during finalization (beyond the `dayRouteService`-scoped command in `## Verification`) surfaced `travelplan/test/travelSegmentDialog.test.tsx` (238 tests) and `travelplan/test/travelSegmentRoutePreview.test.ts` (13 tests) -- neither found by the file-search used while planning, because neither filename matches the component's name. One of them, `"keeps manual values when route lookup returns only partial route details"`, was failing: it pinned the exact pre-fix behavior (`durationSeconds: 8100, distanceMeters: null` &rarr; generic failure, duration discarded) that this bundle exists to change, last touched during story 6.17 -- the same story whose review produced DW-116. Updated that test to assert the new correct behavior and added one new test for the zero/zero-success case (see the added `## Tasks & Acceptance` row). Full suite (2163 tests, one file excluded as a pre-existing Prisma-migration-lock flake unrelated to this change and confirmed to pass in isolation), lint, and typecheck are all clean as of this note. Lesson for future planning in this repo: a component's test file does not reliably share its name (`travelSegmentDialog.test.tsx` vs. `TripDayTravelSegmentDialog.tsx`) -- search by import (`grep -rl "<ComponentName>"`), not by filename pattern.

## Design Notes

The zero-distance check belongs after the existing `route`/`coordinates`/`polyline` guards (which already throw `routing_invalid_response` for malformed geometry) and before the final `return`, so it only evaluates once a structurally valid route is confirmed. The boundary is a proximity check, not exact equality -- DW-116's own motivating example (two day items in the same building) will practically never produce bit-identical requested coordinates, only nearby ones:

```ts
const ZERO_ROUTE_PROXIMITY_METERS = 50;
const EARTH_RADIUS_METERS = 6371000;
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

// Equirectangular approximation: accurate enough at the scale this threshold operates on (tens of
// metres), far simpler than full haversine, and this codebase has no existing geo-distance helper.
const metersBetween = (a: RoutingPoint, b: RoutingPoint) => {
  const meanLat = toRadians((a.lat + b.lat) / 2);
  const x = toRadians(b.lng - a.lng) * Math.cos(meanLat);
  const y = toRadians(b.lat - a.lat);
  return EARTH_RADIUS_METERS * Math.sqrt(x * x + y * y);
};

const allPointsNearFirst = points.every(
  (point) => metersBetween(points[0], point) <= ZERO_ROUTE_PROXIMITY_METERS,
);
if (!allPointsNearFirst && route.distance === 0 && route.duration === 0) {
  throw new DayRouteError("routing_no_route", "No route available for this travel mode");
}
```

`points` (the function's own input parameter, not the response) is the right thing to compare — it is the caller's requested coordinates, independent of how OSRM snapped them. 50m comfortably covers "two pins in the same building or small plaza" (DW-116's example) while still catching DW-113's ~150km mid-Atlantic case by a wide margin; there is no evidence requiring a more precise value, so do not over-tune it.

For the sanitization tightening, change the return mapping from:
```ts
distanceMeters: typeof route.distance === "number" ? route.distance : null,
durationSeconds: typeof route.duration === "number" ? route.duration : null,
```
to:
```ts
distanceMeters: typeof route.distance === "number" && route.distance >= 0 ? route.distance : null,
durationSeconds: typeof route.duration === "number" && route.duration >= 0 ? route.duration : null,
```
`>= 0` also excludes `NaN` (every comparison with `NaN` is `false`), but not `Infinity` (`Infinity >= 0` is `true`) -- review pass 2 added an explicit `Number.isFinite(...)` alongside `>= 0` to close that gap.

## Verification

**Commands:**
- `npm run --prefix travelplan test -- dayRouteService` -- expected: all `dayRouteService.test.ts` cases pass. Actual: 26/26 pass.
- `npm run --prefix travelplan test -- travelSegmentDialog travelSegmentRoutePreview tripDayRoute` -- expected: all dialog- and API-route-level cases pass, including the updated partial-fill test and the new zero-length test. Actual: 239/239 pass across the affected suites.
- `npm run --prefix travelplan test` (full suite) -- expected: no regressions elsewhere. Actual: 2163/2163 pass; one file (`tripCostOverview.test.tsx`) failed on a Prisma-migration-lock timeout in the full run and passed cleanly re-run in isolation -- a pre-existing test-harness concurrency flake, not caused by this change.
- `npm run --prefix travelplan lint` -- expected: no new lint errors in the changed files. Actual: 0 errors (79 pre-existing warnings elsewhere, none in the touched files).
- `npm run --prefix travelplan typecheck` -- expected: no new type errors. Actual: clean.

**Manual checks (if no CLI):**
- Read the updated `handleGoogleMapsRoute` branch and confirm all three outcomes (zero/zero, one-sided partial, neither) are reachable and distinct, and that the existing `routing_no_route` branch above it (`:492-495`) is untouched.

### 2026-08-09 — Review pass 3
- intent_gap: 0
- bad_spec: 0
- patch: 2 (medium 1, low 1)
- defer: 2 (low 2)
- reject: 2 (low 2)
- addressed_findings:
  - `[medium]` `[patch]` `TripDayTravelSegmentDialog.tsx`'s new lone-zero guard (`(hasDuration && durationSeconds === 0) || (hasDistance && distanceMeters === 0)`, added review pass 2) had no dedicated test — only the symmetric zero/zero case was covered. Added `travelSegmentDialog.test.tsx` test `"reports a lone zero distance with a valid duration as no route for this mode"` asserting `distanceMeters: 0` with a real nonzero `durationSeconds` routes to `googleMapsNoRouteForMode`, not a partial-fill success.
  - `[low]` `[patch]` The comment above the lone-zero guard (`TripDayTravelSegmentDialog.tsx:507-511`) said a `0` here "only ever" comes from both points resolving to the same graph node, which describes the symmetric case the service enforces but not the lone-zero case the guard directly below it exists to catch. Reworded to cover both without changing behavior.

Findings not actioned this pass (moot — see reasoning inline):
- `reject`: showing `googleMapsNoRouteForMode` for a legitimate zero-length same-location route reads as imprecise copy ("no route" when a route was found, just an unsavable one) — already raised and accepted as a functionally-inert tradeoff in review pass 2 (`validate()` blocks saving a zero regardless of message); nothing new this pass.
- `reject`: the 50m proximity boundary tests use ~33m/~67m margins rather than the literal `<=50m` edge — deliberate, per the tests' own comments, to avoid floating-point boundary flakiness; the `<=` comparison itself is unambiguous and not a realistic adversarial input surface.

Two `defer` findings from this pass, both pre-existing gaps surfaced incidentally and out of this bundle's Code Map (scoped to the 2-point dialog path), appended to `deferred-work.md`:
- `formatDistanceKmInput`'s one-decimal-km rounding silently reduces distances under ~50m to a `"0"` string, bypassing the dialog's exact-zero guard (which checks `=== 0` on the raw meters value) for any nonzero-but-small `distanceMeters`. Pre-existing: identical under the pre-fix `> 0` guard, since e.g. `distanceMeters: 40` also satisfied `40 > 0`.
- The N-point `days/[dayId]/route/route.ts` endpoint shares `getDayRouteFromOsrm`/`allPointsNearFirst` with the 2-point dialog but has none of the dialog's extra lone-zero mitigation, and `allPointsNearFirst` anchors every point to `points[0]` rather than checking pairwise proximity — both already flagged as out-of-scope in this spec's pass-1 and pass-2 Review Triage Log entries, recorded here as a ledger entry for the first time.


## Auto Run Result

**Status:** done (follow-up review pass on a `done` spec, triggered by re-invocation)

**Summary:** Re-reviewed the already-shipped zero-distance-detection fix (`bcdc4b2`) with two independent adversarial passes (Blind Hunter, Edge Case Hunter). Found and auto-fixed two small gaps in the diff itself; deferred two pre-existing, out-of-scope gaps in a shared function to the ledger; rejected two already-litigated tradeoffs as moot.

**Files changed this pass:**
- `travelplan/src/components/features/trips/TripDayTravelSegmentDialog.tsx` — reworded the lone-zero-guard comment so it accounts for the asymmetric case, not just the symmetric zero/zero case.
- `travelplan/test/travelSegmentDialog.test.tsx` — added a regression test for a lone zero in exactly one field (`distanceMeters: 0` with a real nonzero `durationSeconds`) routing to `googleMapsNoRouteForMode`.
- `_bmad-output/implementation-artifacts/deferred-work.md` — appended two new `open` entries (see below).

**Review findings breakdown (pass 3):**
- patch (2, applied): dialog comment overstated what the service guarantees; new lone-zero dialog guard had no dedicated regression test.
- defer (2, appended to ledger): `formatDistanceKmInput` rounds small nonzero distances to `"0"`, bypassing the dialog's exact-zero guard (pre-existing, unrelated to this diff); the N-point day-route endpoint shares the zero-detection service function but has none of the dialog's lone-zero mitigation, and `allPointsNearFirst` only anchors to `points[0]` rather than checking pairwise proximity (both pre-existing, previously flagged only inside this spec's own triage log, now recorded on the ledger).
- reject (2, dropped): "no route" message shown for a real-but-unsavable same-location zero route reads as imprecise copy — already accepted as functionally inert in pass 2; the 50m proximity boundary tests use comfortable margins rather than the literal edge — deliberate, to avoid floating-point flakiness.

**Verification performed:**
- `npm run --prefix travelplan test -- travelSegmentDialog dayRouteService travelSegmentRoutePreview tripDayRoute` — 105/105 pass, including the new lone-zero regression test.
- `npm run --prefix travelplan test` (full suite) — 2164/2164 pass; `tripCostOverview.test.tsx` failed on the same pre-existing Prisma-migration-lock timeout documented in the original Verification section, confirmed to pass cleanly in isolation.
- `npm run --prefix travelplan lint` — 0 errors, 79 pre-existing warnings (unchanged baseline).
- `npm run --prefix travelplan typecheck` — clean.

**Residual risks:** The two deferred gaps (sub-50m distance rounding to `"0"`; N-point endpoint's weaker zero-detection and anchor-only proximity check) remain open and unmitigated in shipped code — both are pre-existing, low-severity, and out of this bundle's scope. No other residual risk identified.
