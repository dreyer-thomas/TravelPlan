---
title: 'Trips list: SQL aggregates, a bounded page, and a deterministic sort'
type: 'refactor'
created: '2026-08-15'
status: 'done'
baseline_revision: 'e6f211097e5a99bd395e4caf0645d1481d3226a5'
final_revision: 'd33b413e1429d47265ce73480eda368b954653b5'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: [oversized]
---

<intent-contract>

## Intent

**Problem:** `listTripsForUser` (`travelplan/src/lib/repositories/tripRepo.ts`) includes every `TripDay` with its `accommodation` and all `dayPlanItems` for every trip the account can reach, with no `take`, purely to derive four integers in JS; since the `where` became owner-OR-member the size of that fetch is decided partly by other accounts. Its `orderBy: { startDate: "asc" }` also has no tiebreaker, so same-day trips come back in an undefined order that the client comparator cannot reproduce.

**Approach:** Drop the `days` include; derive `dayCount`, `openDayCount`, `planItemCount` and `plannedCostTotal` from one grouped SQL aggregate keyed by `trip_id`. Cap the `findMany` with a generous `take`, return the total matching count alongside the page, and render a "showing N of M" line on the dashboard when the cap bites. Give both the repository `orderBy` and the client `buildTripComparator` an `id` tiebreaker.

## Boundaries & Constraints

**Always:**
- Behaviour of the four derived numbers stays identical, including the visible-accommodation rule: a stay whose name trims to empty contributes neither cost nor "has accommodation" (it counts as an open day and adds no cost). The blank test must match JavaScript `String.prototype.trim` semantics, not SQLite's default space-only `trim(X)`.
- `plannedCostTotal` stays in cents = Σ(visible accommodation `costCents`) + Σ(all day plan item `costCents`), treating `NULL` as 0. `CostPayment` rows are not part of it.
- Keep the `where: { OR: [{ userId }, { members: { some: { userId } } }] }` filter, the `members` sub-select with `take: 1`, and `deriveTripAccessRole`'s drop-the-row rule for a revoked membership.
- The aggregate query must be bounded by the same page the `findMany` returned — never a scan keyed only by `userId`.
- Every new user-facing string gets the same key in both `src/i18n/en.ts` and `src/i18n/de.ts`.
- Raw SQL must be parameterised (`prisma.$queryRaw` tagged template / `Prisma.join`), never string-concatenated ids.

**Block If:**
- Nothing here requires a human decision. The cap value, the placement of the "showing N of M" line, and the aggregate technique are all decided in this spec.

**Never:**
- Do not build a pager, infinite scroll, page-number UI, or any `skip`/cursor parameter — the agreed resolution is a documented cap plus a total, not pagination.
- Do not compute the aggregates from the fetched page's relations (that is the defect), and do not reintroduce a per-trip query loop.
- Do not change the client-side status ladder, the stat strip's populations, or the past-trips-last ordering rule.
- Do not edit `_bmad-output/implementation-artifacts/deferred-work.md`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Trip with no days | trip row, zero `TripDay` | `dayCount 0`, `openDayCount 0`, `planItemCount 0`, `plannedCostTotal 0` (no aggregate row exists for it) | No error expected |
| Day with no accommodation row | 1 day, no stay | day counts as open; contributes 0 cost | No error expected |
| Day with blank-named accommodation | stay `name: "   "`, `costCents: 12000` | day counts as open; its 12000 is **excluded** from `plannedCostTotal` | No error expected |
| Day with named accommodation | stay `name: "Hotel"`, `costCents: 12000` | day is not open; 12000 included | No error expected |
| Plan items with null costs | 3 items, costs `null, 500, null` | `planItemCount 3`; 500 added to `plannedCostTotal` | No error expected |
| Result set exceeds the cap | more matching trips than `TRIPS_LIST_LIMIT` | exactly `TRIPS_LIST_LIMIT` rows, in `(startDate asc, id asc)` order; `totalCount` = full match count | No error expected |
| Two trips share a `startDate` | trips A and B, same `startDate` | stable, repeatable order by ascending `id` on both server and client | No error expected |
| Membership revoked between the two reads | row matches the `where`, `members: []`, not owned | row dropped from `trips`; `totalCount` may exceed `trips.length` by one | No error expected |
| Aggregate query throws | DB error | `GET /api/trips` answers 500 `server_error` as today | Existing route `try/catch` |

</intent-contract>

## Code Map

- `travelplan/src/lib/repositories/tripRepo.ts` -- `TripSummary` (line ~66) and `listTripsForUser` (line ~658): the query, the JS derivation, the `orderBy`.
- `travelplan/src/app/api/trips/route.ts` -- `GET` (line ~75): maps `TripSummary[]` to the wire DTO; sole caller.
- `travelplan/src/components/features/trips/TripsDashboard.tsx` -- wire `TripSummary` type (~31), `buildTripComparator` (~76), `loadTrips` (~118), header/subline (~229, ~392), list container (~448-510).
- `travelplan/src/i18n/en.ts` / `de.ts` -- flat dotted keys; `trips.dashboard.*` block.
- `travelplan/prisma/schema.prisma` -- table/column maps used by the raw aggregate: `trips`, `trip_days(trip_id)`, `accommodations(trip_day_id, property_name, cost_cents)`, `day_plan_items(trip_day_id, cost_cents)`.
- `travelplan/test/tripsListRoute.test.ts` -- real-SQLite route suite; pins the per-trip key set and the shared-trip labelling test that currently matches by name.
- `travelplan/test/tripRepo.test.ts` -- repo suite (`describe("tripRepo")`), real DB; currently does not cover `listTripsForUser`.
- `travelplan/test/tripsDashboard.test.tsx` -- jsdom suite; `mockTripsResponse` is the fetch payload fixture.
- `travelplan/test/i18nDictionaries.test.ts` -- fails if a key exists in only one language.

## Tasks & Acceptance

**Execution:**
- [x] `travelplan/src/lib/repositories/tripRepo.ts` -- export `TRIPS_LIST_LIMIT = 200` and a `TripListPage = { trips: TripSummary[]; totalCount: number }`; change `listTripsForUser` to return `TripListPage`. Drop the `days` include, keep the `where` and the `members` sub-select. Select the page with `orderBy: [{ startDate: "desc" }, { id: "desc" }]` + `take: TRIPS_LIST_LIMIT`, then reverse it in JS so the function still returns `(startDate asc, id asc)` — the cap must discard the *oldest* trips, never the upcoming ones. Run `prisma.trip.count({ where })` for `totalCount`. Export a `buildTripAggregateQuery(tripIds): Prisma.Sql` returning the grouped aggregate, and read it with `$queryRaw`; zero ids ⇒ skip the query. -- Removes the O(days × items) fetch, bounds the page at the archival end, and makes the sort deterministic.
- [x] `travelplan/src/app/api/trips/route.ts` -- destructure `{ trips, totalCount }` and add `totalCount` as a sibling of `trips` in the payload; per-trip keys unchanged. -- The client needs M to render "showing N of M".
- [x] `travelplan/src/components/features/trips/TripsDashboard.tsx` -- add `totalCount` state read from the payload (defaulting to the received row count when absent, so an older server still renders nothing extra); bump it in `handleTripCreated` alongside the optimistic row; give `buildTripComparator` the `id` tiebreaker; render a `data-testid="trips-showing-count"` line directly above the list, whenever `!loading && !error && totalCount > trips.length` — with **no** `trips.length > 0` guard; and narrow `listEmpty` to `totalCount === 0` so the "no trips yet" card cannot contradict a non-zero total. -- Makes the cap visible and keeps client order in agreement with the server.
- [x] `travelplan/src/i18n/en.ts` + `travelplan/src/i18n/de.ts` -- add `trips.dashboard.showingCount` (`{shown}`/`{total}`) and its singular twin `trips.dashboard.showingCountOne` (`{total}`) to both, following the `subline`/`sublineOne` convention. -- `shown` can be 1 when the drop-the-row rule empties a capped page; German verb agreement breaks without the twin.
- [x] `travelplan/test/tripRepo.test.ts` -- add a `listTripsForUser` block covering the I/O matrix rows: aggregates against a fixture with a no-stay day, a blank-named stay carrying a cost, a named stay with a cost, plan items with null and non-null costs, and JS-vs-SQLite trim characters (tab, NBSP, ideographic space); a zero-day trip; the cap plus `totalCount`, asserting the cap keeps the **latest**-starting trips; the `(startDate, id)` tiebreaker with **explicit ids inserted in descending order** so insertion order cannot masquerade as id order; a cross-check that the same fixture's `openDayCount` and `plannedCostTotal` agree with `getTripWithDaysForUser`'s JS derivation; and a `vi.spyOn(prisma.trip, "findMany")` assertion that the query carries no `days` include. -- Pins the aggregates, the cap's direction, the tiebreaker (mutation-proof), the two-language blank rule, and the regression the whole change exists to prevent.
- [x] `travelplan/test/tripRepo.test.ts` (query plan) -- `EXPLAIN QUERY PLAN` the `Prisma.Sql` from `buildTripAggregateQuery` via `$queryRawUnsafe` and assert the plan contains no full `SCAN` of `day_plan_items` or `trip_days`. -- The reviewed first attempt left the plan-item subquery unbounded; SQLite materialised the whole table on every dashboard load and only a plan assertion catches that returning.
- [x] `travelplan/test/tripsListRoute.test.ts` -- rewrite "returns an owned trip and a shared one as two separately labelled entries" to assert result *positions* for the two same-`startDate` fixtures, with explicit ids created in descending order; assert `totalCount` on the payload; and add a test that the route answers 500 `server_error` when the aggregate query throws. -- The suite currently documents the non-determinism instead of forbidding it, and matrix row 9 is unexercised.
- [x] `travelplan/test/tripsDashboard.test.tsx` -- extend `mockTripsResponse` with `totalCount`; test that the "showing N of M" line appears when `totalCount` exceeds the rows, is absent when it does not, is absent when the field is missing, and renders with zero rows and a non-zero total (no "no trips yet" card in that state); and add a client-ordering test feeding two same-`startDate` trips in descending-id order and asserting the rendered rows come out ascending by id. -- The cap is only useful if the user is told, and AC4's client half was previously unverified.

**Acceptance Criteria:**
- Given an account reaching 30 trips of 30 days with 10 plan items each, when `GET /api/trips` runs, then no query in the chain returns a `TripDay`, `Accommodation` or `DayPlanItem` row (the four derived integers come from aggregates), and the four values equal what the previous relation-tree derivation produced for the same fixture.
- Given day plan items belonging to trips outside the returned page, when the aggregate runs, then its query plan performs no full scan of `day_plan_items` — the subquery is bounded by the page's trip ids, not merely joined after the fact.
- Given more matching trips than `TRIPS_LIST_LIMIT`, when the list is fetched, then exactly `TRIPS_LIST_LIMIT` trips are returned, they are the `TRIPS_LIST_LIMIT` **latest**-starting ones, they are ordered `(startDate asc, id asc)`, and `totalCount` reports the full number of matching trips.
- Given a payload whose `totalCount` exceeds the number of rows, when the dashboard renders, then a "showing N of M" line is visible above the list — including when the row count is zero, in which case the empty-state card is not rendered; given `totalCount` equal to the row count, then no such line is rendered.
- Given two trips with the same `startDate` whose ids sort opposite to their creation order, when the list is fetched twice, then both responses place them in ascending-id order, and re-sorting on the client with `buildTripComparator` leaves that order unchanged.
- Given the repository `orderBy`'s `id` tiebreaker is removed, when the repo and route suites run, then at least one test fails — the tiebreaker tests must be mutation-proof rather than passing on cuid monotonicity.
- Given the existing `tripsListRoute` and `tripsDashboard` suites, when the change lands, then every previously passing assertion still passes apart from the deliberately rewritten tests.

## Spec Change Log

### 2026-08-15 — Review pass 1 (bad_spec loopback)

**Triggering findings.** Both reviewers independently proved, with `EXPLAIN QUERY PLAN` on a real DB, that the plan-item pre-aggregation subquery this spec's own Design Notes prescribed carries no `WHERE`, so SQLite materialises the entire `day_plan_items` table on every dashboard load (~95 ms with 400k foreign rows vs ~1 ms bounded) — violating this spec's "Always: the aggregate query must be bounded by the same page" constraint and defeating the story's purpose. Both also found that `take` on an ascending `startDate` truncates the *upcoming* end of the list, the one the dashboard exists to show. Mutation testing showed all three new tiebreaker tests still pass with `{ id: "asc" }` removed (cuid is time-monotonic and SQLite returns rowid order, so insertion order masqueraded as id order), and AC4's client-side half had no test at all. Smaller: the `trips.length > 0` render guard suppressed the advisory line in matrix row 8's state and left the "no trips yet" card contradicting a non-zero total; `handleTripCreated` did not bump `totalCount`; `shown === 1` is reachable and breaks German verb agreement; three comments overstated their claims (`bigint`, "re-sorting is a no-op", one-directional drift).

**What was amended.** Design Notes now carry the bounded subquery with its own `WHERE`, the descending-select-then-reverse cap, the honest `Number(...)` rationale, the bind-parameter note, the corrected no-op/drift wording, and the `buildTripAggregateQuery` extraction that makes the plan testable. The task list gained the singular i18n twin, the `handleTripCreated` bump, the render-guard removal plus the `listEmpty` narrowing, descending-id fixtures, the `getTripWithDaysForUser` cross-check, the `findMany`-has-no-`days`-include spy, the query-plan test, and the 500-on-aggregate-throw test. Four acceptance criteria were added or sharpened, including a mutation-proofness criterion for the tiebreaker tests.

**Known-bad state avoided.** Shipping a "performance" change that moves an unbounded scan from the wire into the database while claiming in a docstring that it is bounded; and a cap that, on the day it bites, hides every trip the user came for behind a 13px grey line.

**KEEP (must survive re-derivation).** The `JS_TRIM_CHARACTERS` constant and its two-argument `trim(X, Y)` usage, verified against tab/NBSP/ideographic-space fixtures — that is the only spelling that matches `String.prototype.trim`. The `Promise.all` of `findMany` + `count`. The empty-`tripIds` early return before `IN ()`. The `deriveTripAccessRole`-filtered id list as the aggregate's key (a strict subset of the page, so a revoked row is never aggregated). `Prisma.join` for the ids, never interpolation. The optional-`totalCount` client fallback to the received row count for a not-yet-redeployed server. The comment density and voice of the first attempt, which matched the file. The `data-testid="trips-showing-count"` hook, and the existing new tests for aggregates, the trim set, the zero-day trip, the cap's length/total, and owner-OR-member scoping.

### 2026-08-15 — Correction to this spec, recorded after review pass 2 (no loopback)

Review pass 1 recorded a `bigint` finding, and the Design Notes below were amended to say "do not claim the driver returns `bigint`; `@prisma/adapter-better-sqlite3` returns `number`". **That amendment is wrong and the code is right.** Measured against this database, a raw statement's computed `COUNT`/`SUM` columns arrive as `bigint` — the adapter has no schema to consult for them. `TripAggregateRow` therefore declares `number | bigint` and the `Number(...)` coercions are load-bearing, not defensive: without them the route dies at `JSON.stringify` with "Do not know how to serialize a BigInt", a 500 on the dashboard's only fetch. Anyone reconciling the code against the Design Notes must treat the code as the authority on this one point.

Two Design Notes instructions also produced defects that were patched rather than re-derived, and should be read with their corrections: narrowing `listEmpty` to `totalCount === 0` alone admits a *different* contradiction (a zero total beside a non-empty page), so the shipped condition is `totalCount === 0 && trips.length === 0`; and "assert the plan contains no full `SCAN`" is not a testable invariant, because SQLite's access-path choice is cost-based — the shipped test drops `sqlite_stat1` (matching production, which never runs `ANALYZE`), seeds its own fixture, and forbids `SCAN` of `day_plan_items` and `accommodations` by name while allowing a scan of the bounded materialised subquery.

## Review Triage Log

### 2026-08-15 — Review pass
- intent_gap: 0
- bad_spec: 12: (high 2, medium 6, low 4)
- patch: 0
- defer: 0
- reject: 3: (high 0, medium 1, low 2)
- addressed_findings:
  - `[high]` `[bad_spec]` Plan-item subquery unbounded — `MATERIALIZE p / SCAN day_plan_items` on every load; Design Notes now prescribe a `WHERE t.trip_id IN (...)` inside the subquery, plus an `EXPLAIN QUERY PLAN` test and an acceptance criterion.
  - `[high]` `[bad_spec]` `take` on ascending `startDate` discards the upcoming trips; Design Notes now prescribe descending select + `reverse()`, with an acceptance criterion that the cap keeps the latest-starting trips.
  - `[medium]` `[bad_spec]` All three tiebreaker tests pass with the tiebreaker removed; task list now requires explicit descending-id fixtures, and a mutation-proofness acceptance criterion was added.
  - `[medium]` `[bad_spec]` AC4's client-side half untested; dashboard test task now requires a rendered-order test.
  - `[medium]` `[bad_spec]` No test enforces AC1's "no `TripDay`/`Accommodation`/`DayPlanItem` row"; task list now requires a `vi.spyOn(prisma.trip, "findMany")` assertion that the `days` include is gone.
  - `[medium]` `[bad_spec]` Blank-stay and cost rules now exist in SQL and in `getTripWithDaysForUser`'s JS with nothing holding them together; task list now requires a cross-check on one fixture.
  - `[medium]` `[bad_spec]` `trips.length > 0` render guard suppressed the line in matrix row 8 and left the "no trips yet" card contradicting a non-zero total; task list now removes the guard and narrows `listEmpty` to `totalCount === 0`.
  - `[medium]` `[bad_spec]` `handleTripCreated` did not bump `totalCount`, so the line went stale and then vanished; now an explicit task.
  - `[low]` `[bad_spec]` `shown === 1` is reachable and breaks German verb agreement; `showingCountOne` added to the task list.
  - `[low]` `[bad_spec]` Comment claimed the driver returns `bigint`; Design Notes now state the coercion as insurance, not observation.
  - `[low]` `[bad_spec]` Comment claimed re-sorting the page is a no-op, which is false for any account with a past trip; Design Notes now scope the claim to same-day ties.
  - `[low]` `[bad_spec]` Drift between the three unsynchronised reads was documented in one direction only; Design Notes now require both, plus a bind-parameter note on `TRIPS_LIST_LIMIT`.
  - Rejected: the sub-line and stat-strip labels speaking for the whole account while the page is truncated (the ledger decision explicitly chose a documented cap plus an advisory line over pagination, and this spec's Never forbids changing the stat populations); an untestable-without-invasive-mocking assertion for the membership-revoked-mid-read race, already covered in steady state; the SQLite-only `trim(X, Y)` portability note, on a `provider = "sqlite"`-only datasource.

### 2026-08-15 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 9: (high 0, medium 4, low 5)
- defer: 0
- reject: 3: (high 0, medium 0, low 3)
- addressed_findings:
  - `[medium]` `[patch]` The query-plan test failed when run standalone and asserted a data-dependent property. Root cause was a persistent `sqlite_stat1` left in the shared test DB by a reviewer's own `ANALYZE`, which survives `deleteMany` and process boundaries. The test now drops `sqlite_stat1` (matching production, which never runs `ANALYZE`), seeds its own fixture including plan items outside the page, forbids `SCAN` of `day_plan_items`/`accommodations` **by name** while allowing a scan of the bounded materialised subquery, and positively pins the three index searches. Proven to pass standalone and in-file, and to fail under both removal mutations.
  - `[medium]` `[patch]` `listEmpty` narrowed to `totalCount === 0` alone let the "No trips yet" card render above real rows when a trip is created between the unsynchronised `findMany` and `count`. Now `totalCount === 0 && trips.length === 0`, with the overstated "can never contradict" comment corrected.
  - `[medium]` `[patch]` The AC1 spy checked `include` only, so a `select`-based rewrite could restore the O(days × items) fetch with every assertion still green. It now merges `include` and `select`, filters to Trip's relation fields, and asserts exactly `["members"]`; mutation-verified both ways.
  - `[medium]` `[patch]` Only 3 of `JS_TRIM_CHARACTERS`' 25 code points were exercised, so deleting one was silent. A new test sweeps the BMP for what `String.prototype.trim` strips, reads the constant out of `buildTripAggregateQuery(...).values[0]` so it pins the production value, and asserts per-character agreement with SQL `trim`, plus negative controls; mutation-verified in both directions.
  - `[low]` `[patch]` `total === 1` printed "Showing 0 of 1 trips" / "0 von 1 Reisen werden angezeigt". Added a third key in both languages, selected before the `shown === 1` twin. Named `…TotalSingular` rather than `…TotalOne` because `i18nDictionaries.test.ts` derives twins by stripping a trailing `One` and would have demanded a dead base key; the deviation is documented in both dictionaries.
  - `[low]` `[patch]` Hoisting the authorisation filter into an untyped `const where` disabled excess-property checking on the one expression that decides which accounts' trips a caller sees. Annotated `Prisma.TripWhereInput`; verified a `memberz` typo is TS2561 again.
  - `[low]` `[patch]` Exported `buildTripAggregateQuery` gave `Prisma.join([])`'s opaque error on an empty array. Explicit guard, named message, documented precondition, pinned by a test.
  - `[low]` `[patch]` The `buildTripAggregateQuery` docstring misattributed `MATERIALIZE p` to the unbounded plan and promised "no `SCAN` line at all" as a data-independent guarantee. Rewritten against `EXPLAIN QUERY PLAN` measured at 0/2/200/1000/5000 trips with and without `ANALYZE`, including the counter-example plan.
  - `[low]` `[patch]` Regression tests added for the two behaviour patches, with anchored regexes after the English case was found to pass by substring under mutation.
  - Rejected: the optimistic create rendering 201 rows against a 200 cap until the next refetch (self-healing, and the line stays truthful about what is on screen); `aria-live` on the advisory line (it is static page content in document order beside the list, not a status update, and announcing it on every load would be noise); the cap dropping in-progress trips for an account with more than `TRIPS_LIST_LIMIT` future-starting trips (unreachable at 200, and every cap has some victim).

### 2026-08-15 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 6: (high 0, medium 1, low 5)
- defer: 1: (high 0, medium 1, low 0)
- reject: 12: (high 0, medium 3, low 9)
- addressed_findings:
  - `[medium]` `[patch]` Every claim that only bites at a full page was documentation rather than coverage: `TRIPS_LIST_LIMIT`'s 402-host-parameter budget and the plan docstring's "measured for 1- and 200-id pages" were both unexercised, since the only plan test binds a single id. Added a test that builds the statement with `TRIPS_LIST_LIMIT` ids, asserts the bind count is `2N + 2`, executes it (over SQLite's ceiling that throws "too many SQL variables" rather than returning empty), and re-asserts the bound plan shape at that size.
  - `[low]` `[patch]` `TripListPage.trips`' JSDoc said "at most `TRIPS_LIST_LIMIT` rows, ordered `(startDate asc, id asc)`", which reads as *the first 200* — it is the **latest**-starting 200, the whole point of the descending-select-then-reverse pair, and that rule lived only in an inline comment a consumer of the exported type never sees. Rewritten to state which end the cap keeps, and that the drop-the-row rule runs after the cap without backfilling, so the length is an upper bound.
  - `[low]` `[patch]` `buildTripComparator`'s docstring claimed "server and client now agree on **same-day ties**" flatly; the comparator negates the tiebreaker for the past group, so same-day past trips render descending — the reverse of the repository contract, by design, as the same docstring's third paragraph explains without ever correcting the claim. Claim narrowed to the defined-and-repeatable property plus a section-by-section statement, and the previously untested past-section tie order is now pinned by its own test.
  - `[low]` `[patch]` The plan test asserted `toContain("MATERIALIZE p")` directly beneath its own docstring's note that `MATERIALIZE p` "is not evidence of anything here — it appears whether or not the subquery carries its `WHERE`". An assertion that by the author's account cannot distinguish pass from fail can only fail spuriously; removed, with the docstring stating why it is deliberately not asserted.
  - `[low]` `[patch]` `handleTripCreated` deduped the optimistic row by id but bumped `totalCount` unconditionally, so a re-delivered create response left the total one high and drew "showing N of N+1" over a page that was in fact complete. Unlike the server's three unsynchronised reads this drift is avoidable two lines from the dedupe that already exists. Now bumped only for an unseen id, read before either setter so a replayed `setTrips` updater cannot fire the side effect twice; regression test added.
  - `[low]` `[patch]` The empty-account route test is the only one reaching the `tripIds.length === 0` short-circuit and asserted `trips` alone, leaving `totalCount === 0` unpinned at the route boundary — an omitted field would serialise away into the client's row-count fallback and read correctly on exactly this fixture. Now asserted.
  - Deferred: DW-352 — the header sub-line and the three stat-strip figures still quote the capped page as the whole account, and `statTotalCost` is labelled "Costs so far (all trips)" while summing at most 200 rows. Real and newly caused by the cap, but this spec's Never forbids changing the stat populations and the fix is a labelling decision across all four figures at once.
  - Rejected: the advisory line firing on a revoked-membership drop rather than only on truncation (matrix row 8's designed behaviour, and the line stays truthful about what is on screen); replacing the `count` with a `take: LIMIT + 1` sentinel (cheaper, but it cannot say "of 240", and the intent contract requires the total); `buildTripAggregateQuery` being exported for the plan test and guarding a precondition production cannot reach (the export is what makes the plan testable against the real statement, and the guard was itself a pass-2 patch); the unrestored `DROP TABLE IF EXISTS sqlite_stat1` (the pass-2 fix, and absence is the state production runs in); the untested `1 of 1` singular-key coupling (unreachable while the render guard holds); no repository test producing `trips: [], totalCount > 0` (already rejected in pass 1 as untestable without invasive mocking); the permanent optional `totalCount` client fallback (an explicit pass-1 KEEP for a not-yet-redeployed server); the optimistic create rendering 201 rows against a 200 cap and the missing `aria-live` (both explicitly rejected in pass 2); an `endDate`-first `orderBy` so a long in-progress trip with an early `startDate` survives the cap (contradicts the acceptance criterion pinning latest-*starting*, and unreachable below 200 trips); and a bind-budget guard inside `buildTripAggregateQuery` for a caller that does not exist (the new full-page test covers the real risk).

## Design Notes

The aggregate is one statement, keyed by `trip_id`. Plan items are pre-aggregated in a subquery so the `LEFT JOIN` cannot multiply day rows (`accommodations.trip_day_id` is unique, so that join is 1:1), and **the subquery carries its own `WHERE` on the same trip ids**. That `WHERE` is not redundant: SQLite cannot push the outer `WHERE d.trip_id IN (...)` into an aggregate subquery, so without it the plan is `MATERIALIZE p / SCAN day_plan_items` — every plan item in the database grouped on every dashboard load, which is the exact cost this change exists to remove, merely relocated from the wire into the DB. With it, the plan is `SEARCH … USING INDEX idx_trip_days_trip_id` / `SEARCH … USING COVERING INDEX`.

```sql
SELECT d.trip_id AS tripId,
       COUNT(*) AS dayCount,
       SUM(CASE WHEN a.trip_day_id IS NULL OR trim(a.property_name, ?) = '' THEN 1 ELSE 0 END) AS openDayCount,
       SUM(COALESCE(p.itemCount, 0)) AS planItemCount,
       SUM(CASE WHEN a.trip_day_id IS NOT NULL AND trim(a.property_name, ?) <> ''
                THEN COALESCE(a.cost_cents, 0) ELSE 0 END
           + COALESCE(p.costTotal, 0)) AS plannedCostTotal
FROM trip_days d
LEFT JOIN accommodations a ON a.trip_day_id = d.id
LEFT JOIN (SELECT i.trip_day_id, COUNT(*) AS itemCount, SUM(COALESCE(i.cost_cents, 0)) AS costTotal
           FROM day_plan_items i
           JOIN trip_days t ON t.id = i.trip_day_id
           WHERE t.trip_id IN (...)
           GROUP BY i.trip_day_id) p ON p.trip_day_id = d.id
WHERE d.trip_id IN (...) GROUP BY d.trip_id
```

The id list is therefore bound twice, both times via `Prisma.join`. Build this as an exported `buildTripAggregateQuery(tripIds): Prisma.Sql` so the plan test can `EXPLAIN QUERY PLAN` the very string production runs (`$queryRawUnsafe("EXPLAIN QUERY PLAN " + sql.sql, ...sql.values)`).

The `?` is a module constant spelling out, as `\uXXXX` escapes, exactly the code points `String.prototype.trim` strips: `U+0009`-`U+000D`, `U+0020`, `U+00A0`, `U+1680`, `U+2000`-`U+200A`, `U+2028`, `U+2029`, `U+202F`, `U+205F`, `U+3000`, `U+FEFF`. SQLite's one-argument `trim(X)` strips spaces only, which would silently reclassify a tab-only stay name as non-blank; the two-argument form takes exactly that set. A trip with no days produces no row, so default all four to 0. Coerce each column with `Number(...)` — but do not claim the driver returns `bigint`; `@prisma/adapter-better-sqlite3` returns `number`, so state the coercion as cheap insurance against a driver or `safeIntegers` change, not as an observed fact.

**Which end the cap keeps.** `take` applied to an ascending `startDate` retains the *oldest* trips, and the dashboard's whole ordering rule pushes past trips to the bottom as archival — so an account over the cap would lose exactly the upcoming trips the surface exists to show, and "Active trips" could read 0. Select descending and reverse:

```ts
const page = await prisma.trip.findMany({ where, orderBy: [{ startDate: "desc" }, { id: "desc" }], take: TRIPS_LIST_LIMIT, include: { … } });
page.reverse(); // the contract is still (startDate asc, id asc); only the truncated end changes
```

Also record on `TRIPS_LIST_LIMIT` that it doubles as a bind-parameter budget: the aggregate binds the id list twice plus two trim strings, so the constant must stay well under SQLite's host-parameter ceiling.

Client tiebreaker — the past section is the exact reverse of the ascending order, so the tiebreaker reverses with it. Compare ids with `<`/`>` rather than `localeCompare`, matching SQLite's BINARY collation:

```ts
const delta = new Date(a.startDate).getTime() - new Date(b.startDate).getTime();
const ordered = delta !== 0 ? delta : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
return aPast ? -ordered : ordered;
```

Do not describe the client re-sort as "a no-op" — it is not: it moves past trips to the end and reverses them. The accurate claim is narrower: the two sides now agree on *same-day ties*.

Three unsynchronised reads. `findMany`, `count` and the aggregate are not one transaction (`Promise.all` is not a transaction), so `totalCount` can drift **either way** — ahead when the drop-the-row rule removes a revoked membership or a trip is created mid-read, behind when one is deleted. Say both directions wherever this is commented; the drift only ever mis-decides whether a grey advisory line is drawn.

## Verification

**Commands:**
- `cd travelplan && npx vitest run test/tripRepo.test.ts test/tripsListRoute.test.ts test/tripListRoute.test.ts test/tripsDashboard.test.tsx test/i18nDictionaries.test.ts` -- expected: all pass.
- `cd travelplan && npm run typecheck` -- expected: no errors.
- `cd travelplan && npm run lint` -- expected: no new errors.
- `cd travelplan && npm test` -- expected: full suite green.


## Auto Run Result

Status: done — follow-up review pass over an already-shipped change. No code was re-derived; the implementation from `e554216` stands.

**Summary of implemented change.** `listTripsForUser` no longer drags every `TripDay`, `Accommodation` and `DayPlanItem` of every reachable trip across the wire to count four integers in JS. It returns a `TripListPage` — a page capped at `TRIPS_LIST_LIMIT = 200`, selected descending and reversed so the cap discards the *oldest* trips, plus a `totalCount` over the same `where` — and derives `dayCount`, `openDayCount`, `planItemCount` and `plannedCostTotal` from one grouped SQL aggregate keyed by `trip_id`, bounded on the page's ids in both the outer statement and its plan-item subquery. Both the repository `orderBy` and the client `buildTripComparator` gained an `id` tiebreaker, and the dashboard renders a "showing N of M" line when the page is not the whole account.

**Files changed in this pass.**
- `travelplan/src/lib/repositories/tripRepo.ts` — corrected `TripListPage.trips`' JSDoc to say which 200 rows the cap keeps and that the count is an upper bound.
- `travelplan/src/components/features/trips/TripsDashboard.tsx` — `handleTripCreated` bumps `totalCount` only for an id not already on screen, read outside the `setTrips` updater; `buildTripComparator`'s docstring narrowed to a claim that holds section by section.
- `travelplan/test/tripRepo.test.ts` — added a full-`TRIPS_LIST_LIMIT`-page bind-and-plan test; removed the self-contradicting `MATERIALIZE p` assertion.
- `travelplan/test/tripsDashboard.test.tsx` — added the past-section same-day tie-order test and the re-delivered-create-response regression test.
- `travelplan/test/tripsListRoute.test.ts` — the empty-account test now pins `totalCount === 0`.
- `_bmad-output/implementation-artifacts/deferred-work.md` — appended DW-352.

**Review findings breakdown.** intent_gap 0, bad_spec 0, patch 6 (1 medium, 5 low, all applied), defer 1 (DW-352), reject 12. Neither reviewer found a correctness defect; every surviving finding was a documentation accuracy or test-coverage gap. Nine of the twelve rejections were findings already adjudicated in passes 1 and 2 and re-raised here.

**Verification performed.**
- `npx vitest run test/tripsDashboard.test.tsx test/i18nDictionaries.test.ts` — 194 passed (52 dashboard tests, up from 50).
- `npx vitest run test/tripRepo.test.ts test/tripsListRoute.test.ts test/tripListRoute.test.ts` — 87 passed (71 repo tests, up from 70).
- `npm run typecheck` — clean.
- `npx eslint` over the five changed files — 0 errors, 2 warnings, both pre-existing at baseline (`react-hooks/exhaustive-deps` and `react-hooks/set-state-in-effect` on `TripsDashboard.tsx`, the latter tracked as DW-3).
- `npm test` — 153 files, 2470 tests, all green.

**Residual risks.**
- DW-352 is live on any account over 200 trips: the header sub-line and three stat-strip figures describe the capped page while `statTotalCost`'s label claims "all trips". Deferred rather than fixed because this spec's Never forbids changing the stat populations.
- The plan-shape assertions pin SQLite planner output strings and index names. They are now exercised at both 1 and 200 ids, but a `better-sqlite3` or SQLite version bump can still redden them without any behaviour regression; the docstring says so explicitly.
- The `trips: [], totalCount > 0` state — which justifies the two-counter `listEmpty`, the unguarded advisory line and the `showingCountTotalSingular` key — remains covered only by hand-built component fixtures, not by a database-level test. Reproducing it needs invasive mocking of a mid-read race; rejected in pass 1 and again here.
