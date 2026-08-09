---
title: 'Order staticRouteHelper by transport routability before mapsLink, and let unavailableHelper through in edit mode'
type: 'bugfix'
created: '2026-08-09'
status: 'done'
baseline_revision: '06fb626058bbbbef051f310f44aa69d8f6f65bdd'
final_revision: '2548184b2eeeded78ade4648ea4f58e6797d1d0a'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
---

<intent-contract>

## Intent

**Problem:** `staticRouteHelper` in `TripDayTravelSegmentDialog.tsx` tests `mapsLink` presence before transport routability, so add-mode Ship/Flight with an unplaced neighbour renders "Add a location to both adjacent items" — advice that cannot help a non-routable transport. It is also unconditionally `null` in edit mode, even though the unavailable-locations helper is the one helper that is actionable there too (the edit dialog otherwise gives no explanation for a disabled "Plan" button when a neighbour has no location).

**Approach:** Reorder the ternary to test `isRoutableTransportType(transportType)` first. Non-routable transport keeps rendering nothing in edit mode (the dynamic `routeHelper` Alert set in `handleGoogleMapsRoute` already covers that state) but renders `googleMapsManualModeHelper` in add mode regardless of `mapsLink`. Routable transport falls through to the existing `mapsLink`-presence check (`null` when present, `googleMapsUnavailableHelper` when absent) in both add and edit mode.

## Boundaries & Constraints

**Always:**
- Preserve the existing add-mode behavior for routable transports: `mapsLink` present renders no standing helper, `mapsLink` absent renders `googleMapsUnavailableHelper`.
- Preserve the existing edit-mode behavior for non-routable transports (Ship/Flight): the static helper stays `null`; `handleGoogleMapsRoute`'s `isEditing` branch at `TripDayTravelSegmentDialog.tsx:465` already sets the dynamic `routeHelper` Alert to `googleMapsManualModeHelper` when "Plan" is pressed, and that must remain the only place it appears in edit mode.
- Preserve the add-mode de-duplication from Story 6.17: the standing `googleMapsManualModeHelper` for Ship/Flight must not also appear as a `routeHelper` Alert after "Plan" is pressed in add mode (`handleGoogleMapsRoute`'s early return for non-routable transports does not set `routeHelper` when `!isEditing`).

**Block If:** (none — the fix is fully determined by the ledger entries and existing code conventions)

**Never:**
- Do not change `handleGoogleMapsRoute`, the route-preview fetch, or any Alert (`routeHelper`) logic — this bundle only reorders the `staticRouteHelper` ternary.
- Do not add a new translation key or new user-facing string — reuse `googleMapsManualModeHelper` and `googleMapsUnavailableHelper` exactly as they exist today.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Add mode, non-routable transport, unplaced neighbour(s) | `isEditing=false`, `transportType` = `ship` or `flight`, `mapsLink=null` | `staticRouteHelper` = `googleMapsManualModeHelper` (DW-114 fix) | No error |
| Add mode, non-routable transport, both neighbours placed | `isEditing=false`, `transportType` = `ship` or `flight`, `mapsLink` present | `staticRouteHelper` = `googleMapsManualModeHelper` (unchanged) | No error |
| Add mode, routable transport, both neighbours placed | `isEditing=false`, `transportType=car`, `mapsLink` present | `staticRouteHelper` = `null` (unchanged) | No error |
| Add mode, routable transport, unplaced neighbour(s) | `isEditing=false`, `transportType=car`, `mapsLink=null` | `staticRouteHelper` = `googleMapsUnavailableHelper` (unchanged) | No error |
| Edit mode, non-routable transport | `isEditing=true`, `transportType` = `ship` or `flight`, any `mapsLink` | `staticRouteHelper` = `null` (unchanged) | No error |
| Edit mode, routable transport, unplaced neighbour | `isEditing=true`, `transportType=car`, `mapsLink=null` | `staticRouteHelper` = `googleMapsUnavailableHelper` (DW-115 fix) | No error |
| Edit mode, routable transport, both neighbours placed | `isEditing=true`, `transportType=car`, `mapsLink` present | `staticRouteHelper` = `null` (unchanged) | No error |

</intent-contract>

## Code Map

- `travelplan/src/components/features/trips/TripDayTravelSegmentDialog.tsx:610-616` -- `staticRouteHelper` ternary to reorder.
- `travelplan/src/components/features/trips/TripDayTravelSegmentDialog.tsx:457-467` -- `handleGoogleMapsRoute`'s non-routable-transport branch, which already sets the dynamic `routeHelper` Alert to `googleMapsManualModeHelper` only `if (isEditing)`; confirms the edit-mode non-routable case must keep rendering `null` statically.
- `travelplan/test/travelSegmentDialog.test.tsx:1117-1147` -- `"renders no standing helper at all when editing an existing segment"`, exercises edit mode + car + placed neighbours (`mapsLink` present); must keep passing unchanged.
- `travelplan/test/travelSegmentDialog.test.tsx:1155-1189` -- `"keeps the two actionable helpers, shortened, in German"`, exercises add mode + unplaced (car, default) and add mode + placed + Flight; must keep passing unchanged.
- `travelplan/test/travelSegmentDialog.test.tsx:1225-1260` -- `"still explains the manual path as an alert when editing a ship or flight leg"`, exercises edit mode + flight + placed neighbours; must keep passing unchanged (asserts no standing helper, only the Alert after "Plan").

## Tasks & Acceptance

**Execution:**
- [x] `travelplan/src/components/features/trips/TripDayTravelSegmentDialog.tsx` -- Replace the `staticRouteHelper` ternary at `:610-616` with: `!isRoutableTransportType(transportType) ? (isEditing ? null : t("trips.travelSegment.googleMapsManualModeHelper")) : mapsLink ? null : t("trips.travelSegment.googleMapsUnavailableHelper")`. -- Tests routability first (DW-114) and lets `googleMapsUnavailableHelper` through in edit mode for routable transports with an unplaced neighbour (DW-115), while keeping edit-mode non-routable transports silent (the dynamic Alert already covers that state, see Code Map).
- [x] `travelplan/test/travelSegmentDialog.test.tsx` -- Add a test case (parametrized over `ship` and `flight` via `it.each`, matching the file's existing `it.each` convention) rendering the dialog in add mode with unplaced neighbours (`baseProps`, no `placedItems`), switching transport to the parametrized mode, and asserting `googleMapsManualModeHelper`'s text is shown while `googleMapsUnavailableHelper`'s text ("Add a location to both adjacent items.") is absent. -- Pins the DW-114 fix; no existing test covers add-mode + non-routable-transport + unplaced neighbours (the 6-17 no-location cases all run under the default `car`, per DW-114's ledger evidence).
- [x] `travelplan/test/travelSegmentDialog.test.tsx` -- Add a test case rendering the dialog in edit mode (`segment` set, `transportType: "car"`) with unplaced neighbours (`baseProps`, no `placedItems`) and asserting `googleMapsUnavailableHelper`'s text ("Add a location to both adjacent items.") is shown. -- Pins the DW-115 fix; the existing edit-mode standing-helper test (`:1117-1147`) only covers placed neighbours.

**Acceptance Criteria:**
- Given the add dialog with an unplaced neighbour and transport switched to Ship or Flight, when the dialog renders, then the standing helper shows `googleMapsManualModeHelper`, not `googleMapsUnavailableHelper`.
- Given the edit dialog for a `car` segment whose neighbour has since lost its location, when the dialog renders, then the standing helper shows `googleMapsUnavailableHelper`.
- Given the edit dialog for a Ship or Flight segment, when the dialog renders, then the standing helper is absent (unchanged) regardless of neighbour placement.

## Spec Change Log

## Review Triage Log

### 2026-08-09 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 6 (low 6)
- defer: 2 (low 2)
- reject: 2 (low 2)
- addressed_findings:
  - `[low]` `[patch]` The DW-115 test only covered `car`; broadened to `it.each` over `car`/`walking`/`cycling` (all reach the identical `isRoutableTransportType` branch) plus a German case, matching the file's bilingual-assertion convention.
  - `[low]` `[patch]` The DW-115 test's docblock described "a neighbour" losing its location (implying one), but the test left both neighbours unplaced; changed the test to place `fromItem` and leave only `toItem` unplaced, matching the docblock and pinning the more realistic scenario.
  - `[low]` `[patch]` Added a `toBeDisabled()` assertion on "Plan" to the DW-115 test — the motivating symptom (a disabled button with no explanation) was asserted only indirectly via the helper text before.
  - `[low]` `[patch]` The DW-114 test only asserted English strings; broadened to `it.each` over English and German (Ship/Flight × Schiff/Flug), matching the file's bilingual-assertion convention used elsewhere for helper text.
  - `[low]` `[patch]` `it.each` arrays for both new tests lacked `as const`, leaving parameters as widened `string` rather than the literal types the file's other `it.each` blocks use; added `as const`.
  - `[low]` `[patch]` The docblock above `staticRouteHelper` still described the pre-fix model (`isEditing` uniformly suppressing the helper); rewrote it to explain that `isEditing` now only gates the non-routable arm, and why, so the four-way ternary's shape doesn't invite reintroducing the DW-114/DW-115 bug.

Findings not actioned this pass:
- `defer`: editing an existing Ship/Flight segment whose neighbour has since lost its location still renders no standing helper and no reachable Alert (`isEditing ? null : manualModeHelper`, unconditional on `mapsLink`, byte-identical to pre-fix behaviour) — the same failure mode DW-115 fixed, left unfixed for non-routable transports; out of scope for both DW-114 (add-mode only) and DW-115 (scoped to `googleMapsUnavailableHelper`, not `googleMapsManualModeHelper`, in edit mode). Recorded on the ledger.
- `defer`: `googleMapsUnavailableHelper`'s "Add a location to **both** adjacent items" fires whenever `mapsLink` is falsy, including when only one neighbour is missing a location — pre-existing since the string was introduced, newly reachable in one more state (editing) by this bundle's intended fix but not itself changed; changing the copy was out of this bundle's Boundaries. Recorded on the ledger.
- `reject`: the manual-mode helper sentence is now hand-duplicated a fifth time across the test file with no shared constant — pre-existing pattern in this file (already duplicated 3 times before this diff), consistent with its established (if imperfect) style; not this bundle's concern to fix.
- `reject`: no test covers switching transport type mid-edit with an unplaced neighbour to confirm `staticRouteHelper` re-derives correctly — `staticRouteHelper` is a plain value recomputed every render from state already covered by React's own guarantees and by the per-condition tests added this pass; not a new interaction branch this diff introduces.

## Design Notes

The fix is a pure reorder of an existing four-way ternary; no new branches, keys, or state. `isRoutableTransportType` is already imported and used elsewhere in the same file (`:457`, `:613` today), so no new import is needed.

## Verification

**Commands:**
- `npm run --prefix travelplan test -- travelSegmentDialog` -- expected: all cases pass, including the two new ones. Actual: 68/68 pass.
- `npm run --prefix travelplan test -- travelSegmentDialog dayRouteService travelSegmentRoutePreview tripDayRoute i18nDictionaries` -- expected: no regressions in related routing/dialog suites. Actual: 248/248 pass.
- `npm run --prefix travelplan lint` -- expected: no new errors. Actual: 0 errors (79 pre-existing warnings, none in the touched files).
- `npm run --prefix travelplan typecheck` -- expected: clean. Actual: clean.

**Manual checks (if no CLI):**
- Full suite (`npm run --prefix travelplan test`) times out in this environment past 7 minutes without completing; not run this pass. The scoped run above covers every file this bundle touches or shares code with.

## Auto Run Result

**Status:** done

**Summary:** Reordered `staticRouteHelper` in `TripDayTravelSegmentDialog.tsx` to test transport routability before `mapsLink` presence (DW-114), and let `googleMapsUnavailableHelper` through in edit mode for routable transports (DW-115). Added the two ledger-motivated tests, then broadened and strengthened them per review (bilingual coverage, full routable-transport coverage, a disabled-button assertion, and a docblock rewrite), and recorded two newly-surfaced pre-existing gaps to the deferred-work ledger.

**Files changed:**
- `travelplan/src/components/features/trips/TripDayTravelSegmentDialog.tsx` -- reordered the `staticRouteHelper` ternary; rewrote its docblock to explain the new `isEditing` scoping and point at the residual gap it does not cover.
- `travelplan/test/travelSegmentDialog.test.tsx` -- added a DW-114 test (`it.each` over Ship/Flight × en/de) and a DW-115 test (`it.each` over car/walking/cycling, plus a German case), both asserting the standing helper text and, for DW-115, the disabled "Plan" button.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- appended two new `open` entries (see below).

**Review findings breakdown (pass 1):**
- patch (6, applied): DW-115 test coverage narrowed to `car` only, broadened to all three routable transports plus German; DW-115 test's docblock described one missing neighbour but the test left both unplaced, corrected to match; DW-115 test didn't assert the disabled "Plan" button, the concrete symptom motivating the fix; DW-114 test only covered English, added German; both new `it.each` arrays lacked `as const` typing; the `staticRouteHelper` docblock still described the pre-fix all-branches-null-when-editing model.
- defer (2, appended to ledger): editing an existing Ship/Flight segment with an unplaced neighbour still renders no standing helper and reaches no Alert (button disabled, same failure mode as DW-115, left open for non-routable transports -- confirmed byte-identical to pre-fix behavior, not caused by this diff); `googleMapsUnavailableHelper`'s "both adjacent items" copy is imprecise when only one neighbour is missing a location (pre-existing since the string was introduced, newly reachable in edit mode by this fix but not itself changed).
- reject (2, dropped): the manual-mode helper string is now hand-duplicated a fifth time in the test file with no shared constant -- consistent with the file's pre-existing (imperfect) convention, not this bundle's concern; no test covers switching transport type mid-edit -- `staticRouteHelper` is a plain derived value with no new interaction logic added.

**Verification performed:**
- `npm run --prefix travelplan test -- travelSegmentDialog` -- 68/68 pass.
- `npm run --prefix travelplan test -- travelSegmentDialog dayRouteService travelSegmentRoutePreview tripDayRoute i18nDictionaries` -- 248/248 pass.
- `npm run --prefix travelplan lint` -- 0 errors, 79 pre-existing warnings (unchanged baseline).
- `npm run --prefix travelplan typecheck` -- clean.
- Full suite (`npm run --prefix travelplan test`) timed out in this environment (pre-existing harness limitation, not exercised for this pass); the scoped run above covers every file this bundle touches or shares code with.

**Residual risks:** The two deferred gaps (silent disabled "Plan" button for edit-mode Ship/Flight with an unplaced neighbour; imprecise "both" wording when only one neighbour is missing a location) remain open and unmitigated in shipped code -- both are pre-existing, low-severity, and out of DW-114/DW-115's literal scope. No other residual risk identified.
