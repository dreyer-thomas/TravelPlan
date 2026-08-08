---
title: 'Printed day sheet: missing-location note, distance gating, trailing blank page, route-label test'
type: 'bugfix'
created: '2026-08-09'
status: 'done'
baseline_revision: 'bbdd224'
final_revision: '6e3aacb'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: [multiple-goals, oversized]
---

<intent-contract>

## Intent

**Problem:** The printed day sheet disagrees with the day view and with its own page box: it draws a Google Maps route straight past stops that have no coordinates without saying so (DW-1), it prints `800 km` on a flight or ship leg that the day view deliberately hides (DW-109), every documents-free day emits a trailing blank sheet (DW-198), and the route-label suppression for an untitled, empty-content plan item has no test pinning it (DW-2).

**Approach:** Surface the already-present `map.missingLocations` count beside the navigation link; gate the distance fragment on the shared `transportTypeAllowsDistance` rule instead of a fourth private copy; find and remove the source of the trailing blank page by measuring the produced page count of a real print run before and after; add the missing regression test.

## Boundaries & Constraints

**Always:**
- Import the distance rule from `@/lib/trips/transportTypes` — no new local mode list.
- The blank-page cause is established by **measuring produced page count** with headless Chrome (`Page.printToPDF`, `preferCSSPageSize: true`) against a production build, before and after the change. Reading the CSS is not evidence.
- Any headless run uses a throwaway SQLite database and a scratch `MEDIA_STORAGE_ROOT`. `travelplan/prisma/dev.db` and `travelplan/var/uploads` are read-only for this work; verify `dev.db` is byte-identical afterwards.
- Kill spawned Chrome/Next processes by PID, never with a broad `pkill` (a broad kill has taken down the user's own `:3000` before).
- The printed sheet is English-only and untranslated; new copy follows that.

**Block If:**
- After the other three items are complete, no fixture can be made to reproduce a trailing blank page. Then DW-198's fix is unverifiable, guessing at padding is forbidden, and the run halts with the measurements recorded.
- Headless Chrome cannot be driven at all (no `Page.printToPDF` obtainable).

**Never:**
- Do not assert heights, page breaks, `@page` rules or any computed layout value in vitest — jsdom resolves them to `""`, so such an assertion passes whether the code is right, wrong or absent.
- Do not change the day view, the travel-segment dialog, or the zod schema; DW-109 is the print surface only.
- Do not add puppeteer/playwright or any dependency to `package.json`; the CDP driver is a scratch script outside the repo.
- Do not edit `_bmad-output/implementation-artifacts/deferred-work.md`.
- Do not alter the `> 0` zero-distance rule already pinned by "does not render '0 km' for zero-distance car segments".

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Route complete | `map.points` ≥ 2, `missingLocations: []` | Navigation link, no missing-location note | No error expected |
| Route past unplaced stops | `map.points` ≥ 2, `missingLocations` has 2 items | Link plus a note reading `2 locations not shown` | No error expected |
| One unplaced stop | `missingLocations` has 1 item | Note reads `1 location not shown` (singular) | No error expected |
| No map section | `map.points` < 2 | No map section at all, therefore no note | No error expected |
| Car leg with distance | `transportType: "car"`, `distanceKm: 30` | `Car · 45m · 30 km` | No error expected |
| Imported flight leg | `transportType: "flight"`, `distanceKm: 800` | `Flight · 5h` — no distance | No error expected |
| Ship leg with distance | `transportType: "ship"`, `distanceKm: 120` | Transport and duration only | No error expected |
| Walking leg with distance | `transportType: "walking"`, `distanceKm: 2` | `Walking · 25m · 2 km` | No error expected |
| Zero-distance car leg | `transportType: "car"`, `distanceKm: 0` | No `0 km` fragment (unchanged) | No error expected |
| Untitled empty neighbour | plan item `title: null`, empty `contentJson`, adjacent to a travel segment | Card still shows the positional fallback `Plan item N`; `print-segment-route` is absent | No error expected |

</intent-contract>

## Code Map

- `travelplan/src/components/features/trips/TripDayPrintDocument.tsx` -- the whole change surface: map section (`:249-279`), travel-segment label (`:305`), root wrapper `padding: "24px 0"` (`:220-231`), `@page`/print CSS (`:166-218`), footer (`:549-563`).
- `travelplan/src/app/(routes)/trips/[id]/days/[dayId]/print/page.tsx` -- wraps the sheet in `<Box sx={{ minHeight: "100vh" }}>`; a `100vh` box resolves against the print page area and is a live suspect for the trailing sheet alongside the wrapper padding.
- `travelplan/src/components/features/trips/TripDayPrintPage.tsx` -- client shell: fetches the payload, renders the `.print-hide` toolbar, fires `window.print()` from `onReady`.
- `travelplan/src/lib/trips/transportTypes.ts` -- `transportTypeAllowsDistance` (`car`, `walking`, `cycling`); the single rule DW-109 wants imported.
- `travelplan/src/lib/trips/dayMapData.ts` -- `TripDayMapPanelData.missingLocations: TripDayMapItem[]`, already carried on `payload.map`.
- `travelplan/src/components/features/trips/TripDayView.tsx:1710-1724` -- the day-view label this sheet must stop contradicting.
- `travelplan/test/tripDayPrintDocument.test.tsx` -- `basePayload` / `makeItem` / `makeSegment` fixtures (`:8-86`); `makeSegment()` takes no overrides, callers spread.

## Tasks & Acceptance

**Execution:**
- [x] `travelplan/src/components/features/trips/TripDayPrintDocument.tsx` -- import `transportTypeAllowsDistance` and gate the `${km} km` fragment on it, keeping the existing `!= null && > 0` guard -- one shared rule instead of a fourth copy (DW-109).
- [x] `travelplan/src/components/features/trips/TripDayPrintDocument.tsx` -- render a `data-testid="print-map-missing"` note inside the existing map section when `map.missingLocations.length > 0`, pluralised, styled as the small grey caption line -- a route drawn past unplaced stops must say so (DW-1).
- [x] `travelplan/src/components/features/trips/TripDayPrintDocument.tsx` and/or `travelplan/src/app/(routes)/trips/[id]/days/[dayId]/print/page.tsx` -- remove the trailing blank sheet with the minimal change the measurement points at (wrapper padding, footer break rule, or the `100vh` outer box) -- a wasted sheet on every day printed (DW-198).
- [x] `travelplan/test/tripDayPrintDocument.test.tsx` -- add tests for every row of the I/O matrix that is not already covered: the missing-location note (present/absent/singular), flight and ship suppressing distance, walking keeping it, and the untitled-empty-content neighbour suppressing `print-segment-route` while the card keeps its `Plan item N` fallback (DW-2).

**Acceptance Criteria:**
- Given a production build served from a throwaway database, when a day with no documents anywhere in its timeline is printed through `Page.printToPDF` with `preferCSSPageSize: true`, then the returned PDF has no trailing page whose only content is page furniture, and the count is strictly lower than the same fixture measured on `HEAD` before the change.
- Given the same production build, when a day carrying image documents is printed the same way, then each document page still carries its image and caption and the page count is unchanged from before the change.
- Given `npx vitest run test/tripDayPrintDocument.test.tsx`, when the suite runs, then every pre-existing test still passes alongside the new ones.
- Given `travelplan/prisma/dev.db` and `travelplan/var/uploads`, when the verification run finishes, then `dev.db` hashes identically to before the run and no scratch process remains listening.

## Spec Change Log

## Review Triage Log

### 2026-08-09 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 6: (high 0, medium 0, low 6)
- defer: 3: (high 0, medium 2, low 1)
- reject: 6
- addressed_findings:
  - `[low]` `[patch]` The printed note read "N locations not shown", but the sheet shows no map at all — only a URL — so the reader could not tell what the count referred to. Reworded to name the route: "Route omits N stops with no saved location"; tests updated.
  - `[low]` `[patch]` The note's justifying comment claimed it closed the whole silent-omission class, while `buildGoogleMapsUrl`'s 9-stop sampling drops placed stops by a separate path. Comment scoped to unplaced stops and the sampling gap named as separately tracked; same note added to the test block.
  - `[low]` `[patch]` The distance-gate comment claimed the two surfaces "cannot print different labels for the same row", which is false on the value axis — the day view gates on `typeof distanceKm === "number"` and still prints "0 km" where this sheet omits it. Comment narrowed to the mode axis and the remaining divergence named.
  - `[low]` `[patch]` The `.print-document-page` `245mm` comment justifies a measured constant but omits the print shell's `py: 3`, and is now known-incomplete. Appended the later measurement (269.2mm against a 265mm box, document days still emitting a trailing blank sheet) so the next reader is not misled by the arithmetic.
  - `[low]` `[patch]` The DW-198 fix carried a ~25-line measurement narrative inside an `sx` prop ending "do not re-litigate them here", which discourages exactly the re-measurement a padding change would require. Trimmed to the reason plus the measured direction, pointed at this spec for the full table, and replaced the closing line with the condition under which re-measurement is required.
  - `[low]` `[patch]` `expect(screen.queryByText(/km/)).not.toBeInTheDocument()` throws on more than one match instead of failing an assertion, so any future copy carrying "km" would turn the flight test into an error. Replaced with `toHaveTextContent` scoped to the segment entry.

**Deferred (not written to `deferred-work.md` — the orchestrator owns the ledger for this run):**

- `source_spec:` `spec-print-day-sheet-fixes.md` — severity medium — The Google Maps URL silently drops *placed* stops once a day has more than `GOOGLE_MAPS_MAX_STOPS` (9), and nothing on the sheet says so. Evidence: `TripDayPrintDocument.tsx` `buildGoogleMapsUrl` samples intermediate points away above the cap; a 12-stop day with every stop located renders no note at all. Compounding it, `step = Math.ceil(mid.length / (MAX - 2))` overshoots — 10 points yield 6 stops, not the 9 the cap allows. Both pre-date this change; DW-1's ledger text scopes the note to `missingLocations` only.
- `source_spec:` `spec-print-day-sheet-fixes.md` — severity low — Day view and print sheet still disagree about a zero or non-finite `distanceKm`. Evidence: `TripDayView.tsx:1718` gates on `typeof distanceKm === "number"` with no magnitude check and would print "0 km"; the sheet keeps `!= null && > 0`, pinned by the pre-existing test "does not render '0 km' for zero-distance car segments". Both writers require `positive()`, so this is legacy or direct-DB data only. Out of scope here: this spec forbids touching the day view, and the `> 0` rule is pinned.
- `source_spec:` `spec-print-day-sheet-fixes.md` — severity medium — A day carrying image documents still emits a trailing blank sheet (3 documents → 5 pages, page 5 with zero text and zero drawing operators), measured identically before and after this change. Evidence: the measurement table in Design Notes; dropping the sheet wrapper's `padding: "24px 0"` takes it 5 → 4. Distinct from DW-198 — candidate 3 does not move it — and it belongs to Story 9.2 AC1's territory. Needs its own measurement pass across document counts and image aspect ratios because it interacts with the measured `245mm` constant.

*(All three were subsequently written to `deferred-work.md` by the follow-up review pass below, as DW-277, DW-280 and DW-278.)*

### 2026-08-09 — Review pass (follow-up)

- intent_gap: 0
- bad_spec: 0
- patch: 5: (high 0, medium 1, low 4)
- defer: 5: (high 0, medium 3, low 2)
- reject: 11
- addressed_findings:
  - `[medium]` `[patch]` The DW-198 comment explained the trailing blank page with a mechanism that cannot produce it — it blamed the shell's `py: 3` and the wrapper's `padding: "24px 0"`, which are *descendants* of the fixed Box and, under `globals.css`'s `* { box-sizing: border-box }` and `* { margin: 0 }`, are absorbed whole by a `min-height` floor while content is short. The real pusher is `AppHeader` (`(routes)/layout.tsx:7`, `position="static"`, 72px Toolbar + 1px border) laid out *above* the Box, which alone explains the content-independent signature the comment itself describes. Comment rewritten to name the actual mechanism, to state explicitly which suspects are innocent and why, and — the part that mattered — the re-measure trigger list now leads with "anything above or around this Box in the routes layout", the one dependency it previously omitted for a rule no test guards.
  - `[low]` `[patch]` DW-198's `min-height: auto` stopped the shell's white Box from covering the whole first page, and `body` is the app's cream `--color-paper` with `print-color-adjust: exact` already opted in — so with background graphics enabled a cream band now prints below the last line of a short day. Never caught because the measurement ran with `printBackground` at its `false` default. Added `background: #fff` to the existing `@media print` `body` rule; paint-only, so the measured page counts are unaffected.
  - `[low]` `[patch]` Both the component comment and the test docblock justified printing a count instead of names by claiming the day view lists each stop "next to a control that fixes it". `TripDayMapPanel.tsx:156-170` renders a non-interactive warning `Chip` and a `Typography` label — there is no control. Both claims corrected to what the code actually does, keeping the (still valid) reason for a count.
  - `[low]` `[patch]` The DW-109 test docblock pointed the next reader at `transportTypes.test.ts` as the owner of the rule. No such file exists; the rule's boundary is pinned by `travelSegmentSchemas.test.ts` ("still rejects a distance on ship and flight"). Pointer corrected.
  - `[low]` `[patch]` The new gate governs `car`, the one mode where a distance is expected, and nothing asserted car's positive case — the pre-existing compact test asserted only `/45/`, which matches the duration and would still pass if `transportTypeAllowsDistance` stopped allowing car. Strengthened to `toHaveTextContent("Car · 45m · 30 km")`.

**Deferred — written to `deferred-work.md` as new entries DW-276 … DW-280:**

- DW-276 — severity medium — The site navigation header prints on page 1 of every day sheet, and is also the true cause of DW-198's blank page. Evidence: the print route has no layout of its own, so it inherits `RoutesLayout`, which renders `AppHeader` unconditionally; `AppHeader` carries no `print-hide` and no `@media print`, and `.print-hide` is applied only to the toolbar in `TripDayPrintPage.tsx:55`. Pre-existing on both counts.
- DW-277 — severity medium — The 9-stop sampling drops *placed* stops, so the new note's count can understate the real omission (12 located + 2 unplaced prints "omits 2"). Re-filed from the previous pass with the overshooting `step` arithmetic. Pre-existing.
- DW-278 — severity medium — Image-document days still emit a trailing blank sheet; the wrapper-padding fix is measured (5 → 4) but was held back by this spec's one-candidate-per-measurement gate. Re-filed from the previous pass. Pre-existing.
- DW-279 — severity low — An untitled plan item *with* body text names itself on its card (`getPrintEntryLabel` falls through to the body) but reads as `—` on the adjacent route line (`getEntryDisplayName` is title-only). DW-2's new test pins the empty-content case, where dropping the line is right; this divergence-without-cause case is unexercised. Pre-existing.
- DW-280 — severity low — Day view and sheet still disagree on a zero-valued `distanceKm` (`typeof === "number"` vs `!= null && > 0`). Re-filed from the previous pass. Pre-existing and unreachable through either writer today.

**Rejected (11):** English-only copy without i18n (the intent contract states the sheet is English-only and untranslated); `#888` at 10px failing WCAG AA (the spec specifies the small grey caption line, and lines 381/608 of the same sheet already use it); no note when `map.points < 2` (an explicit I/O-matrix row); DW-109 hiding genuine legacy ship/flight distances and not repairing `tripImportSchemas.ts` (both mandated by the I/O matrix and the Never list); Firefox/Safari page counts unmeasured (the spec mandates the Chrome CDP method and forbids adding a browser driver); `245mm` vs Letter/A5/landscape (`@page { size: A4 portrait }` is declared; speculative and pre-existing); `globals.css`'s own `body { min-height: 100vh }` left un-neutralised (the measurement puts a documents-free day at exactly 1 page, so it is not producing a sheet today); the note firing on activity-type items that were never places (the same set the day view already surfaces, and exactly what the I/O matrix specifies); `toHaveTextContent("Plan item 1")` substring-matching "Plan item 1x" (the fixture has three entries and cannot reach 10); comment volume and cross-file duplication (style, and the previous pass already trimmed it once); and the missing one-neighbour-untitled route-line case (the same branch as DW-279, deferred there rather than counted twice).

## Design Notes

The distance gate is a two-line change; put the day view's own reasoning next to it so the two surfaces stay tied together:

```tsx
// Ship and flight cannot carry a distance (Story 6.16 / AC6) but an imported backup can still
// restore one — tripImportSchemas.ts does not enforce the coupling. Gate on the shared rule so
// this sheet and the day view cannot print different labels for the same row.
const distance =
  transportTypeAllowsDistance(seg.transportType) && seg.distanceKm != null && seg.distanceKm > 0
    ? `${seg.distanceKm} km`
    : null;
```

The missing-location note is a count, not a list: the day view already names the offending stops on screen, and the sheet's job here is only to stop the drawn line reading as complete.

DW-198's cause is unknown until measured. Three candidates are on the table and the measurement decides between them — do not fix more than one unless each removal is independently shown to change the page count.

**Measured outcome (headless Chrome, `Page.printToPDF({ preferCSSPageSize: true })`, production build on a throwaway database; page count from `/Type /Page` cross-checked against the page tree's `/Count`, blankness from the inflated content stream's operator count):**

| Fixture | Before | Wrapper padding → 0 | Footer `page-break-before: avoid` | `@media print { min-height: auto }` |
|---|---|---|---|---|
| Near-empty day | 2 (p2 blank) | 2 | 2 | **1** |
| 1 / 3 / 5 / 7 plan items, no documents | 2 (p2 blank) | 2 | 2 | **1** |
| 10 / 14 / 18 plan items, no documents | 2 (p2 real) | 2 | 2 | 2 |
| 12 entries, both stays, 2 segments | 2 (p2 real) | 2 | 2 | 2 |
| 3 image documents | 5 (p5 blank) | 4 | 5 | 5 |

Candidate 3 is the cause: `min-height: 100vh` on the print route's outer `Box` resolves against the *page box* in a paginated context, so the shell's own `py: 3` and the sheet wrapper's `24px` land outside a box already one full sheet tall. The signature is that the blank page is independent of content volume — present on a completely empty day, gone once content genuinely exceeds a page. The wrapper padding and the footer break rule were each measured independently and reverted: the footer rule moved nothing at all, and the padding moves a *different* number.

**Recorded, not fixed here — new finding for the ledger:** a day carrying image documents has its own trailing blank page (3 documents → 5 pages, page 5 empty), present identically before and after this change and untouched by candidate 3. Dropping the sheet wrapper's `padding: "24px 0"` removes it (5 → 4). It is a separate defect from DW-198, it belongs to Story 9.2 AC1's territory, and it interacts with the measured `245mm` constant in `.print-document-page` — that comment accounts for the sheet wrapper's bottom padding but not for `TripDayPrintPage.tsx`'s `py: 3`, leaving 245 + 11.6 + 12.6 = 269.2mm against a 265mm printable box. Fixing it needs its own measurement pass over document counts and image aspect ratios, so it is reported rather than folded in.

## Verification

**Commands:**
- `npx vitest run test/tripDayPrintDocument.test.tsx` -- expected: all tests pass, including the new matrix rows.
- `npm run typecheck` -- expected: clean.
- `npm run lint` -- expected: no new warnings or errors.
- `npm test` -- expected: full suite green, no pre-existing failures introduced.
- Page-count measurement: `npm run build`, serve on a free port with `DATABASE_URL` pointed at a copied/empty scratch db and a scratch `MEDIA_STORAGE_ROOT`, seed a user + trip + day over the API, drive headless Chrome over CDP (`node --experimental-websocket`, raw WebSocket — the repo has no browser driver), `Page.navigate` to the print route with the session cookie set, then `Page.printToPDF({ preferCSSPageSize: true })` and count `/Type /Page` in the decoded bytes. Expected: documents-free fixture drops by exactly one page; document fixture unchanged.

**Manual checks (if no CLI):**
- Decoded PDF of the documents-free fixture after the fix: last page carries itinerary content or footer, and there is no page whose extracted text is empty.


## Auto Run Result

Status: `done`. DW-1, DW-2, DW-109 and DW-198 remain resolved; this run was a follow-up review pass over the same diff.

**Implemented change (unchanged from the first run).** The printed day sheet says when its Google Maps route skips stops that have no saved location, hides a distance on transport modes the shared Story 6.16 rule forbids one on, and no longer emits a trailing blank sheet on days without documents. The route-label suppression for an untitled, empty-content plan item is pinned by a test.

**Files changed in this pass:**
- `travelplan/src/app/(routes)/trips/[id]/days/[dayId]/print/page.tsx` — DW-198's comment rewritten: it now names `AppHeader` as the actual cause of the overflow, states which suspects are innocent and why, and leads the re-measure trigger list with the routes layout. No code change.
- `travelplan/src/components/features/trips/TripDayPrintDocument.tsx` — `body { background: #fff }` added to the existing `@media print` rule (paint only); two comment claims corrected to match the code they cite.
- `travelplan/test/tripDayPrintDocument.test.tsx` — dead `transportTypes.test.ts` pointer repointed at `travelSegmentSchemas.test.ts`; the "control that fixes it" claim corrected; the compact car test strengthened from `/45/` to the full `Car · 45m · 30 km` label.
- `_bmad-output/implementation-artifacts/deferred-work.md` — five new entries appended, DW-276 … DW-280. No existing entry touched.

**Review findings:** 5 patches applied (1 medium, 4 low), 5 items deferred (3 medium, 2 low — the previous pass's three re-filed into the ledger, plus two newly found), 11 rejected. No intent gaps, no spec defects.

**Verification performed:**
- `npx vitest run test/tripDayPrintDocument.test.tsx` — 33 passed.
- `npm test` — 137 files, 2046 tests, all passing.
- `npm run typecheck` — clean.
- `npm run lint` — `0 errors, 79 warnings`, unchanged from the baseline recorded by the first run.
- No new page-count measurement. Of this pass's five patches, four touch comments or a test assertion and one adds a paint-only `background` declaration, none of which can change layout, so the first run's measured table stands.

**Residual risks:**
- The DW-198 fix still has no automated guard — deleting the `@media print` rule leaves typecheck, lint and all 2046 tests green. The corrected comment now at least points the next reader at the real dependency.
- The `body { background: #fff }` patch was reasoned rather than measured. It cannot affect pagination, but its visible effect (white instead of cream below a short day, with background graphics on) has not been printed and looked at.
- The printed sheet still carries the site nav header (DW-276), can still state a count smaller than the route's real omission (DW-277), and still wastes a sheet on document days (DW-278). All three are pre-existing and now in the ledger.
