---
title: 'Green static gates: clean lint, a typecheck gate, and shared test helpers'
type: 'chore'
created: '2026-08-08'
status: 'done'
baseline_revision: '12fa7758cfa4678c481138e9aa94127a7f5fd258'
final_revision: 'd56cf3a92e2731657db88cf473d98ea8be7dbeca'
baseline_tests: '134 files / 1990 tests passing'
final_tests: '137 files / 2038 tests passing'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: ['multiple-goals', 'oversized']
---

<intent-contract>

## Intent

**Problem:** `npm run lint` exits 1 on two `react/no-children-prop` errors in `src/theme.ts`, and there is no `typecheck` script at all — so `npx tsc --noEmit` sits at **164 errors across 21 test files**, unmeasured and free to grow, and a genuine new type error is indistinguishable from the baseline. Separately, the hardcoded-colour test guard is copy-pasted into four suites, and the two older copies carry a strictly weaker regex than the two newer ones, so a guard improvement reaches only the newest screens.

**Approach:** Fix the two lint errors, drive `tsc --noEmit` to zero, add `typecheck` to `package.json` alongside `lint`, and extract the duplicated guards into `test/helpers/`. The bulk of the type debt is one mechanical shape (see Design Notes: the ledger's stated diagnosis is wrong), so it resolves via one shared `routeContext` helper plus a small number of local fixes.

## Boundaries & Constraints

**Always:**
- Every change is types-only or test-only. No application runtime behaviour changes.
- `npm run test` stays fully green — the same number of passing tests before and after, with no test skipped, weakened, or deleted to make a gate pass.
- Never silence a type error with `any`, `@ts-ignore`, `@ts-expect-error`, or by loosening `tsconfig.json` (`strict`, `include`, `exclude` stay as they are). Fix the type, or cast only where an existing repo idiom already casts and the cast is provably safe.
- New helpers match `test/helpers/` house style: named `export const` arrow functions, no default export, a file-header JSDoc stating *why this is shared and what breaks without it*, imported as `from "./helpers/<name>"`.
- Source-text guards resolve paths from `__dirname`, never `process.cwd()`.

**Block If:**
- Driving `tsc --noEmit` to zero would require changing `scripts/audit-check.mjs` runtime code (as opposed to adding a declaration file beside it) — the security gate's implementation is not in scope.
- Extracting the stronger colour regex makes any of the four colour tests fail, i.e. a scanned source file genuinely contains a hardcoded colour. That is a real finding about the source, not a test change to make.

**Never:**
- Do not enable `checkJs`, do not pin CI action SHAs, do not add a lint/typecheck GitHub workflow, and do not touch the 83 pre-existing lint *warnings* — all separate concerns.
- Do not delete `test/zz-hero-diagnostic.test.tsx` even though it asserts almost nothing; fix its cast and leave the question of its existence alone.
- Do not edit `_bmad-output/implementation-artifacts/deferred-work.md`.
- Do not "fix" the deliberate, heavily-documented mock-state types in `test/tripDayViewLayout.test.tsx:18-44` by widening them.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| `mockFetchResponse` default | `mockFetchResponse({ data: 1 })` | `{ ok: true, status: 200 }`, `json()` resolves the body | No error expected |
| `mockFetchResponse` failure | `mockFetchResponse(body, { status: 404 })` | `ok` derived `false` from status ≥ 400 | No error expected |
| `mockFetchResponse` explicit ok | `mockFetchResponse(body, { status: 500, ok: true })` | explicit `ok` wins over the derived value | No error expected |
| `mockFetchResponse` non-JSON body | `mockFetchResponse(undefined, { json: () => Promise.reject(new Error("bad")) })` | the supplied `json` replaces the default; awaiting it rejects | Caller's own assertion |
| `mockFetchResponse` headers | `mockFetchResponse(body, { headers: { "content-disposition": "attachment" } })` | a real `Headers`; `.get("content-disposition")` returns it, `.get("absent")` returns `null` | No error expected |
| `routeContext` | `routeContext("trip-1")` | `{ params: Promise.resolve({ id: "trip-1" }) }`, assignable to the handlers' `RouteContext` | No error expected |
| Colour guard, clean source | source with no colour literal | assertion passes | No error expected |
| Colour guard, hex in a comment | `// see #1234` only | passes — comments stripped first | No error expected |
| Colour guard, `oklch()` in code | `color: oklch(0.7 0.1 20)` | fails — the union regex matches | Test fails, as intended |

</intent-contract>

## Code Map

- `travelplan/src/theme.ts:120,137` -- the two `react/no-children-prop` errors; `checkboxIcon` (single child) and `checkboxCheckedIcon` (array of two children) pass `children` inside the `createElement` props object.
- `travelplan/package.json:5-16` -- scripts block; `lint` is the only static gate, no `tsc` invocation exists.
- `travelplan/test/bucketListRoute.test.ts:37-42` -- **the canonical `routeContext` helper already exists here**, with a JSDoc explaining the exact bug; its own 14 erroring sites never call it. Promote verbatim.
- `travelplan/test/{tripDayPlanItemsRoute,bucketListRoute,tripDetailRoute,tripAccommodationRoute,travelSegmentRoute,tripAccommodationCopyRoute,tripHeroImageRoute,dayActivityTransferRoute}.test.ts` -- the 90 `{ params: { id: X } }` sites (24/14/13/12/11/6/5/5).
- `travelplan/test/travelSegmentRoutePreview.test.ts`, `tripBackupRoundTrip.test.ts:181` -- error-free reference files already using `params: Promise.resolve(...)` (137 such sites repo-wide).
- `travelplan/scripts/audit-check.mjs:336,391,442,588` -- untyped `.mjs` exports whose `= []` defaults infer `never[]`; source of 28 of `auditCheckScript.test.ts`'s 29 errors. **Add `scripts/audit-check.d.mts`; do not edit this file.**
- `travelplan/test/auditCheckScript.test.ts:931` -- the 29th error, `spawnSync` env typing.
- `travelplan/test/{tripDayPlanDialog,tripAccommodationDialog,tripDayViewLayout}.test.tsx` -- `as unknown as typeof fetch` applied to the *variable* instead of the `vi.stubGlobal` call, so every later `.mock` access is TS2339 and cascades to implicit-any callbacks.
- `travelplan/test/adminUsersList.test.tsx:131`, `tripShareDialog.test.tsx:64` -- error-free reference for the correct cast placement (cast at the `stubGlobal` call site, variable keeps its `Mock` type).
- `travelplan/test/{tripRepo,tripCollaborationRepo}.test.ts` -- discriminated-union results read without narrowing; `tripRepo.test.ts:2071,2154,2216,2273,2341` show the house guard idiom.
- `travelplan/test/{tripCostOverview,tripCostOverviewPage}.test.tsx` -- the **stronger** guard copy (regex + `stripComments` byte-identical, md5 `f30d14b4…`).
- `travelplan/test/{tripDayMapFullPage,tripOverviewMapFullPage}.test.tsx` -- the **weaker** copy (byte-identical to each other, md5 `4521214…`), and the only two using `resolve(process.cwd(), …)`.
- `travelplan/test/helpers/` -- 6 existing helpers, no barrel, no fetch or Response builder yet; `emotionStyles.ts` is a runtime CSSOM reader, a different axis — do not put an `fs`-reading guard inside it.

## Tasks & Acceptance

**Execution:**
- [x] `travelplan/src/theme.ts` -- in `checkboxIcon` and `checkboxCheckedIcon`, move `children` out of the props object and pass it as trailing `createElement` argument(s) (spread the array for the checked icon so each child keeps its existing `key`) -- clears both lint errors without changing rendered output.
- [x] `travelplan/test/helpers/routeContext.ts` -- new helper exporting `routeContext(id: string)` returning `{ params: Promise.resolve({ id }) }`, plus the `RouteContext` type it satisfies; carry over the JSDoc from `bucketListRoute.test.ts:37-41` explaining the Next async-`params` contract -- one place for the shape all `[id]` route handlers take.
- [x] `travelplan/test/{tripDayPlanItemsRoute,bucketListRoute,tripDetailRoute,tripAccommodationRoute,travelSegmentRoute,tripAccommodationCopyRoute,tripHeroImageRoute,dayActivityTransferRoute}.test.ts` -- replace all 90 `{ params: { id: X } }` literals and the 7 `as unknown as { params: Promise<…> }` casts in `tripDayPlanItemsRoute.test.ts:1462-1632` with `routeContext(X)`; delete the now-duplicated local `routeContext` in `bucketListRoute.test.ts` -- clears 90 errors and removes the casts that were hiding the same bug.
- [x] `travelplan/scripts/audit-check.d.mts` -- new ambient declaration for the exports `auditCheckScript.test.ts` imports (`collectFindings`, `evaluate`, `formatReport`, `reportPlausibilityError` and the rest), typing the option bags and array members properly instead of `never[]` -- clears 28 errors with zero edits to the security gate's runtime code. Verify TypeScript actually prefers the `.d.mts` over the `allowJs` inference before moving on.
- [x] `travelplan/test/auditCheckScript.test.ts:931` -- type the `spawnSync` env object as `NodeJS.ProcessEnv` -- clears the last TS2769 in the file.
- [x] `travelplan/test/helpers/mockFetch.ts` -- new helper exporting `mockFetchResponse(body?, init?)` per the I/O matrix (typed `MockResponseInit` with optional `ok`, `status`, `json`, `headers`, `blob`) and `stubFetch(mock)`, which installs the mock via `vi.stubGlobal` and returns it with its `Mock` type intact -- the cast lives in one place, so `.mock.calls` stays typed at every call site.
- [x] `travelplan/test/{tripDayPlanDialog,tripAccommodationDialog,tripDayViewLayout,tripTimelineSharing,zz-hero-diagnostic,tripEditDialogHeroImage}.test.tsx` -- route the fetch stubs through `stubFetch` / `mockFetchResponse` (or, where the stub is route-aware and awkward to reshape, at minimum move the cast to the `stubGlobal` call site) -- clears the 5 TS2352 casts and the ~15 `.mock`/implicit-any cascade errors.
- [x] `travelplan/test/tripDayViewLayout.test.tsx` -- replace `input.url` with `String(input)` at the 4 `RequestInfo | URL` sites (`:177`, `:2266`, `:2369`, `:2498`); hoist `const item = props.item` above the JSX at `:140` to keep the null guard; give the `lastProps = null` reset at `:3873` the declared type so `:3935-3936` stop narrowing to `never` -- clears 4 + 1 + 2 errors without touching the documented mock-state type.
- [x] `travelplan/test/{tripRepo,tripCollaborationRepo}.test.ts` -- narrow the discriminated-union results before the 9 property reads (`tripRepo` `:1947-1950`, `:2005-2006`; `tripCollaborationRepo` `:44`, `:50`, `:120`). Prefer a guard that *throws* on the unexpected outcome over the file's existing `if (result.outcome !== "imported") return;`, which passes vacuously; leave the 5 existing `return` guards alone -- clears 9 errors while keeping the assertions meaningful.
- [x] `travelplan/test/tripOverviewMapPanel.test.tsx` -- add the required `kind` (`"accommodation" | "planItem"`), `dayId`, `href`, `order` to the inline point fixtures at `:27`, `:38` and `kind` to the missing-location fixture, with values consistent with the assertions already in the test -- clears 3 TS2739 + 1 TS2741.
- [x] `travelplan/test/tripDayLeafletMap.test.tsx` -- annotate `TEST_POINTS` as `TripDayMapPoint[]` (imported from `@/lib/trips/dayMapData`) so `kind` and `position` stop widening to `string`/`number[]` -- clears 1 TS2322 and catches future drift.
- [x] `travelplan/test/tripDayMapPanel.test.tsx` -- add `"data-testid"?: string` to the `react-leaflet` mock prop types read at `:45`, `:50` -- clears 2 TS7053.
- [x] `travelplan/test/dayRouteService.test.ts` -- drop the type argument from `.rejects.toMatchObject<Partial<DayRouteError>>(…)` at `:310`, `:331`, `:353`, hoisting the expected object into a typed `const` so the shape stays compile-checked -- clears 3 TS2558.
- [x] `travelplan/test/tripDetailRoute.test.ts` -- add `missingAccommodation: boolean; missingPlan: boolean` to the inline `ApiEnvelope` day type used at `:627` -- clears 2 TS2339.
- [x] `travelplan/test/helpers/hardcodedColour.ts` -- new helper exporting `HARDCODED_COLOUR` (the stronger union regex verbatim from `tripCostOverview.test.tsx:82-83`), `stripComments` (byte-identical in all four copies today), and `expectNoHardcodedColour(relativePath)` resolving from `__dirname`; document both known blind spots (a colour lifted into another file's constant; a hex after `//` inside a string literal) -- one guard improvement now reaches every screen.
- [x] `travelplan/test/{tripCostOverview,tripCostOverviewPage,tripDayMapFullPage,tripOverviewMapFullPage}.test.tsx` -- delete all four local `HARDCODED_COLOUR`/`stripComments`/`repoRoot` copies and call the helper, keeping each suite's existing `describe`/`it` titles and scanned path; fix the older pair's stale comment claiming it guards "either page component" when each guards one -- removes the weaker variants and the `process.cwd()` coupling.
- [x] `travelplan/package.json` -- add `"typecheck": "tsc --noEmit"` next to `lint` -- makes the gate runnable and measurable in the dev loop, matching `lint`'s position as a plain npm script (no new CI workflow, per Boundaries).

**Acceptance Criteria:**
- Given a clean tree on the changed branch, when `npm run lint` runs, then it exits 0 with zero errors (warnings may remain).
- Given a clean tree, when `npm run typecheck` runs, then it exits 0 and reports zero errors.
- Given a clean tree, when `npm run test` runs, then every test passes and the passing count is not lower than before the change.
- Given `npm run typecheck` from either `travelplan/` or a subdirectory, when it runs, then the result is identical — no check depends on the invocation directory.
- Given a developer greps the repo for `HARDCODED_COLOUR`, when they inspect the results, then the regex is defined exactly once, in `test/helpers/hardcodedColour.ts`, and the four suites import it.
- Given a new hardcoded `oklch()` colour is introduced into any of the four scanned source files, when the suites run, then the corresponding colour test fails.
- Given `scripts/audit-check.mjs`, when its diff is inspected, then it is unchanged.

## Spec Change Log

## Review Triage Log

### 2026-08-08 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 10: (high 0, medium 4, low 6)
- defer: 3: (high 0, medium 2, low 1)
- reject: 13: (high 0, medium 2, low 11)
- addressed_findings:
  - `[medium]` `[patch]` `test/tripExportRoute.test.ts:88` kept a byte-equivalent duplicate of the new shared `routeContext`, with 24 call sites — the helper's own claim of "one file instead of ninety-seven" was false on arrival, and the duplicate would have gone stale silently at the next contract change. Swept onto the shared helper; the local copy is gone and the repo now has exactly one definition.
  - `[medium]` `[patch]` `test/helpers/routeContext.ts` asserted that `id` is the only params key under `src/app/api/trips/[id]/**`. Four handlers under `days/[dayId]/` (`route`, `print`, `image`, `documents/packet`) also declare `dayId`, and because both keys are optional `Promise<{id?: string}>` is assignable to `Promise<{id?: string; dayId?: string}>` — so misuse type-checks and then fails the handler's params schema, answering 400 from the wrong branch. JSDoc corrected to name the four handlers and warn that the compiler will not catch this. `tripId` also made optional so the absent-segment guard the handlers carry stays expressible.
  - `[medium]` `[patch]` Nothing asserted the newly consolidated colour guard or the response builder. The four screen suites scan clean files, so they only ever exercise the passing path: `HARDCODED_COLOUR` could be weakened, or `expectNoHardcodedColour` reduced to a no-op, with all four staying green — which left the acceptance criterion "a new `oklch()` fails the corresponding test" unverifiable from the suite. Added `test/hardcodedColour.test.ts` and `test/mockFetch.test.ts` (37 cases) covering the I/O matrix, the regex's positives *and* its deliberate negatives, and a negative path case pinned to `src/theme.ts`, which cannot become colour-free.
  - `[medium]` `[patch]` `scripts/audit-check.d.mts` declared `Finding.severity/title/url/range` as `string`, but `collectFindings` substitutes its placeholder with `??` (`audit-check.mjs:368-372`), which fires only on `null`/`undefined` — a registry-supplied `severity: 7` passes straight through. The declaration asserted a sanitisation step the security gate does not perform, and forbade any test from pinning the pass-through. Widened those four to `unknown`; `package` and `advisoryId` stay `string` because the script builds them.
  - `[low]` `[patch]` `mockFetchResponse` derived `ok` from `status < 400`, so a 3xx would have reported `ok: true` where a real `Response` reports `false`. No fixture sends a 3xx today, which is why it needed asserting rather than discovering. Derivation is now `status >= 200 && status < 300`, pinned by a test that compares against a real `Response`.
  - `[low]` `[patch]` `test/helpers/mockFetch.ts`'s header claimed a stub could no longer "resolve a body the component cannot read". `body` is `unknown`, so only the envelope became checkable — renaming an API field still breaks no fixture at compile time. Corrected to state exactly what the helper buys and what it does not.
  - `[low]` `[patch]` `scripts/audit-check.d.mts`'s `AuditReport` was a closed four-key interface while its own header argues the report is untrusted input carrying arbitrary keys. An inline fixture with any extra npm key (`summary`, `actions`) trips excess-property checking, and the next person reaches for the cast this file exists to avoid. Opened with an index signature.
  - `[low]` `[patch]` The three failure stubs in `test/tripEditDialogHeroImage.test.tsx` became `ok: false` with a defaulted `status: 200` — an incoherent response, and now the shape of every failed hero-image fixture. Harmless today (nothing reads `.status` there) but a trap for the first `status === 413` branch. Given explicit 500s, which derive `ok: false` on their own.
  - `[low]` `[patch]` `test/tripOverviewMapPanel.test.tsx`'s new fixture factory reimplemented `buildTripOverviewMapData`'s `href` construction for four fields the suite never reads, with a dead `href: ""` — a second implementation nothing compares against. Reduced to inert placeholders, with the reasoning recorded so nobody restores the mirror.
  - `[low]` `[patch]` `test/helpers/hardcodedColour.ts`'s `repoRoot` actually named the *package* root, and it is the only documentation a caller gets about what its argument is relative to — a caller following the name passes `travelplan/src/...` and gets `ENOENT` instead of an assertion. Renamed to `packageRoot` and the parameter documented.

### 2026-08-08 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 10: (high 0, medium 4, low 6)
- defer: 5: (high 0, medium 2, low 3)
- reject: 11: (high 0, medium 0, low 11)
- addressed_findings:
  - `[medium]` `[patch]` `test/tripDayViewLayout.test.tsx` — five stub *factories* (`buildDayResponse`, `buildTwoDayResponse` and three siblings) still carried `as unknown as typeof fetch` on their **return**, which is the exact placement `helpers/mockFetch.ts` documents as "worse, because it looks like it works": the factory's type became `typeof fetch`, so `.mock` was gone for all ~100 callers and the first person wanting `buildDayResponse({}).mock.calls` would reach for another cast. Casts dropped; the two remaining call-site casts in the file converted to `stubFetch`. The file the story converted now holds zero.
  - `[medium]` `[patch]` `test/helpers/mockFetch.ts` claimed to be "the one place the cast to `typeof fetch` is allowed to live". `grep -c` counts ~104 across two dozen suites — they are the *safe* placement, so not bugs, but the header stated an invariant a reader would be wrong to trust and that no follow-up work could be measured against. Rewritten to state the scope it actually has.
  - `[medium]` `[patch]` `test/helpers/routeContext.ts` claimed "a future change to the handlers' contract fails in one file instead of ninety-seven". 136 sites still spelled the context inline, seven of them inside suites this story converted — and the spec's completeness grep could not see any of them, because it searches only for the broken bare-object spelling while these hold a real promise. The seven in-scope sites converted (`tripDayPlanItemsRoute`, `tripDetailRoute` ×3, `tripAccommodationRoute`, `tripHeroImageRoute` ×2); the nine converted suites now hold no inline copy, and the header states what the remaining 129 mean.
  - `[medium]` `[patch]` `src/theme.ts:120-166` was the only production change in an 11.3k-line commit and nothing asserted its output: no suite references `checkboxIcon`/`checkboxCheckedIcon`, and the one suite that renders a themed `Checkbox` says nothing about its SVG. Dropping a trailing `createElement` argument during the rewrite would have deleted the tick — leaving a filled square that still reads as "checked" — with the whole suite green. Added `test/themeCheckboxIcons.test.tsx`: both children surviving, the tick's `d`, the two token fills, and the absence of a `children` attribute.
  - `[low]` `[patch]` The four `input.url` → `String(input)` conversions silently dropped `Request` support: `String(new Request(url))` is `"[object Request]"`, so every `url.includes("/api/…")` branch in a route-aware stub falls through to its catch-all. Neither spelling handled both members (`input.url` was `undefined` for a `URL`), so this is a lateral move rather than a regression, but it is one worth closing at the boundary. Added `requestUrl` to the helper, pinned by tests that compare it against `String()`, and applied it at the four sites. The ~50 pre-existing `String(input)` sites are DW-272.
  - `[low]` `[patch]` `test/tripEditDialogHeroImage.test.tsx` was the one converted suite left on `global.fetch = … as unknown as typeof fetch` — invisible to `vi.unstubAllGlobals()`, and the only converted suite with no teardown at all, so its stub outlived the file. Routed through `stubFetch` with an `afterEach`.
  - `[low]` `[patch]` `test/helpers/routeContext.ts` justified `tripId`'s optionality with "a test that covers that guard needs a context whose params resolve to `{}`" — and no such test existed, so the widening was unpaid-for and `routeContext(maybeUndefined)` would silently answer from the not-found branch. Added the absent-segment case to `tripDetailRoute.test.ts`, which reaches `route.ts:31`'s `if (!tripId)` guard, and documented the cost the optionality carries.
  - `[low]` `[patch]` `test/hardcodedColour.test.ts`'s case titled "fails, naming the file *and the literal*" asserted only the file name. The half a developer actually needs — which literal tripped the guard — was unpinned, so a rewrite back to `expect(source).not.toMatch(...)`, the form the helper argues against precisely because it names no literal, would have kept it green. Both halves now matched, the literal by shape so re-ordering the palette cannot break it.
  - `[low]` `[patch]` `test/helpers/hardcodedColour.ts` documented two blind spots, both false *negatives*, and neither of the other two real limits: `stripComments` treats a block-comment opener inside a string literal as a real one (deleting everything to the next terminator, colours included), and the unanchored hex branch is a false *positive* on any hex-lettered fragment anchor (`href="#facade"`). Both documented and both pinned in `hardcodedColour.test.ts`, so they read as recorded decisions rather than as bugs someone discovers.
  - `[low]` `[patch]` `test/mockFetch.test.ts`'s eight-line rationale for why the response contract needs its own suite sat immediately above the `afterEach` teardown hook — in the one file whose purpose is documenting the shared contract, the documentation was anchored to the cleanup. Moved onto the `describe` it explains.

### 2026-08-09 — Review pass (third)
- intent_gap: 0
- bad_spec: 0
- patch: 9: (high 0, medium 6, low 3)
- defer: 2: (high 0, medium 1, low 1)
- reject: 7: (high 0, medium 1, low 6)
- addressed_findings:
  - `[medium]` `[patch]` `test/themeCheckboxIcons.test.tsx` — the case titled "passes children as arguments, not as a prop" was inert, and its comment was factually wrong. Verified by rendering both spellings side by side: `createElement("svg", {…, children: kids})` and `createElement("svg", {…}, ...kids)` produce byte-identical `innerHTML`, and `children` is a reserved prop React never forwards to a host element, so the string appears in neither. The case therefore passed on the *pre-fix* code and could never catch the regression it named. Removed rather than repaired, because no assertion distinguishes the two spellings — `react/no-children-prop` is the only guard against the props-object form returning, which is why it is a lint rule — and the reasoning recorded in the file so nobody writes it again. The suite's real guard, a child dropped during the rewrite, is the rendered-shape cases, which are untouched.
  - `[medium]` `[patch]` `test/helpers/mockFetch.ts` claimed `stubFetch` "is the only cast in the files this helper landed with". False on arrival for the third pass running: `test/tripAccommodationDialog.test.tsx` — one of the six — still held seven `as unknown as typeof fetch`. This time the claim was made true rather than reworded: all seven converted to `stubFetch`, the file now holds zero `vi.stubGlobal("fetch", …)`, and all six suites verify at zero. The header now names the grep that checks it and says plainly why it should be re-run rather than believed.
  - `[medium]` `[patch]` `test/helpers/mockFetch.ts` — `stubFetch`'s `<T extends Mock>` constrained nothing: bare `Mock` defaults to `Mock<(...args: any[]) => any>`, so `stubFetch(vi.fn(async () => 42))` compiled and installed a number as the global `fetch`, failing later inside the component on `response.json is not a function` with nothing pointing at the stub. Constrained to the real `fetch` signature. Verified both directions: `tsc --noEmit` stays at **0 errors** repo-wide across all ~160 install sites, and the bad mock above now fails with TS2345 at the call site. (Recorded as DW-271 by the previous pass on the stated grounds that tightening "would immediately error at every install site" and fail the zero-error gate — that prediction is measurably wrong, so the fix is free. Ledger left untouched; flagged to the orchestrator below.)
  - `[medium]` `[patch]` `test/helpers/routeContext.ts` took `tripId?: string`, so `routeContext(maybeUndefined)` compiled and answered from the handler's not-found branch — a status-only assertion passing for the wrong reason. The helper documented this hazard at length and then shipped it. Worse, it was a regression for one suite: `test/tripExportRoute.test.ts` deleted a local helper whose parameter was **required** and took the optional import in its place, so nine call sites lost a guarantee they had. Split into a required `routeContext(tripId: string)` and a named `absentSegmentContext()`, which is the only case whose point is the missing segment. The one caller converted; the mistake is now unspellable.
  - `[medium]` `[patch]` `test/tripEditDialogHeroImage.test.tsx` discarded `stubFetch`'s return and recovered the mock three times as `global.fetch as ReturnType<typeof vi.fn>` — which resolves to `Mock<(...args: any[]) => any>`, so `.mock.calls` destructured to `any` and every assertion reading it was unchecked. That is the exact defect `stubFetch` exists to prevent, re-introduced by a second cast in the file the previous pass converted *to* the helper. The return is now held in a typed `let`, and the three `typeof input === "string" ? input : input.toString()` reads went onto `requestUrl` with it — `input.toString()` on a `Request` is `"[object Request]"`, the same hole `requestUrl` was added to close.
  - `[medium]` `[patch]` `test/tripRepo.test.ts` and `test/tripCollaborationRepo.test.ts` — `expectImportedResult`/`expectCreatedCollaborator` were justified by the claim that the `if (result.outcome !== "imported") return;` form "skips every assertion after it and the test still passes". Not true at a single site in either file: all five surviving early-return guards, and both converted sites, are preceded by `expect(result.outcome).toBe(…)`, which fails first. The spec's own task carried the same premise ("which passes vacuously"). The helpers are still right, for a different reason — the narrowing no longer *depends* on a neighbouring `expect` that a paste or a reword can drop — so the code stands and the docblocks now say that instead of a claim that would send the next reader to sweep five guards on a false premise.
  - `[low]` `[patch]` `test/hardcodedColour.test.ts`'s negative case asserted the thrown message matches `…[\s\S]*#[0-9a-fA-F]{3,8}`, directly under a comment claiming "the literal is matched by shape rather than by value so re-ordering the palette cannot break this test". The regex pinned it to a *hex*, i.e. to whichever literal comes first in `src/theme.ts` — today `#EFEAE0` on line 57. Turn that one entry into `rgba(…)` and the case fails while the guard works perfectly. Broadened to every branch `HARDCODED_COLOUR` can report, which is what the comment already promised.
  - `[low]` `[patch]` `test/themeCheckboxIcons.test.tsx` asserted `stroke` is `"#D9D0BE"` under the comment "The border token, not a literal" — it was a literal, and `#4B6358` beside it too. A palette change would have broken a suite that has no opinion on the palette. Both read off the theme now (`palette.tokens.borderStrong`, `palette.primary.main`); the tick's `#FFFFFF` stays spelled out because `theme.ts` spells it out too and there is no token to read.
  - `[low]` `[patch]` `test/helpers/hardcodedColour.ts` enumerated three ways a colour escapes the guard and missed two more, both in the named-colour branch: it requires a `'` or `"`, so `` color: `white` `` passes, and it is case-sensitive, so `"White"` and `"WHITE"` pass where `"white"` fails. Verified against the exported regex. The pair is easy to miss because the hex branch is unquoted and behaves the opposite way — `` `#fff` `` *is* caught. Both documented and pinned in `hardcodedColour.test.ts`, including the asymmetry itself, so they read as recorded limits rather than as bugs discovered one half at a time.

## Design Notes

**The ledger's diagnosis of DW-95 is wrong, and the correction matters for how this is fixed.** DW-95 states the errors are "overwhelmingly one shape: hand-rolled `fetch` stubs typed as `{ ok, status, json }` … missing the following properties from type 'Response'". Verified against the actual output: only **5** of 164 errors carry that message. The real distribution is:

| Cause | Errors |
|---|---|
| `{ params: { id } }` where handlers take `params: Promise<{ id?: string }>` | **90** |
| Untyped `.mjs` inference in `auditCheckScript.test.ts` (already recorded as DW-262) | **28** |
| `as unknown as typeof fetch` cast placed on the variable, killing `.mock` (+ implicit-any cascade) | ~15 |
| `Response`-shape stubs — the family DW-95 actually describes | 5 |
| Remaining local one-offs (unions, fixtures, mock prop types, generics) | ~26 |

`vi.stubGlobal`'s value parameter is `any`, so the ~89 `{ ok, status, json }` literals were never type-checked at all — which is why they produce no errors and why a `mockFetchResponse` helper alone would have moved the count by 5. The helper is still built, because the intent names it and because it is what makes those 89 literals checkable going forward; it is simply not the lever. The two levers are `routeContext` (90) and the `.d.mts` (28).

**Why the whole 164 and not just the bundle's share:** a `typecheck` script that exits 1 is not a gate — it recreates exactly the "diff the output by hand" trap DW-95 and DW-134 both describe. That necessarily absorbs DW-262's 28 errors. This is incidental resolution, worth surfacing to the orchestrator; do not edit the ledger to record it.

**Colour guard extraction is verified safe.** Applying the stronger regex to all four scanned sources yields 0 matches (strong and weak both 0 on each file) — the two older-scanned page shells are pure MUI structural wrappers with no colour props and no comments. `stripComments` is byte-identical in all four copies, so it extracts as-is. The `process.cwd()` → `__dirname` change is a real robustness fix, not cosmetic: `vitest.config.ts` sets no `test.root`, so the two older guards throw `ENOENT` if vitest is invoked from anywhere but `travelplan/`.

**Golden example — the cast placement that keeps `.mock` typed:**

```ts
// Broken (current): the variable loses its Mock type, so every later .mock is TS2339.
const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => body })) as unknown as typeof fetch;
vi.stubGlobal("fetch", fetchMock);

// Correct: cast at the boundary only. `stubFetch` from the new helper does exactly this.
const fetchMock = vi.fn(async () => mockFetchResponse(body));
stubFetch(fetchMock);
expect(fetchMock.mock.calls[0]?.[0]).toContain("/api/trips");  // still typed
```

**Note for the reviewer:** `test/zz-hero-diagnostic.test.tsx` is a diagnostic scratch suite that `console.log`s computed styles and asserts almost nothing. Its cast is fixed here; whether the file should exist is a separate question and a fair deferred-work candidate.

## Verification

**Commands:**
- `cd travelplan && npm run lint` -- expected: exit 0, "0 errors" (warnings tolerated).
- `cd travelplan && npm run typecheck` -- expected: exit 0, no output.
- `cd travelplan && npm run test` -- expected: exit 0, all suites pass, passing count ≥ the pre-change count (capture it first).
- `cd travelplan && npx vitest run test/tripCostOverview.test.tsx test/tripCostOverviewPage.test.tsx test/tripDayMapFullPage.test.tsx test/tripOverviewMapFullPage.test.tsx` -- expected: all four colour guards pass through the shared helper.
- `cd travelplan && npx vitest run test/hardcodedColour.test.ts test/mockFetch.test.ts` -- expected: passes; these assert the shared guard and the response contract directly, since the four screen suites only ever exercise the passing path.
- ~~`cd travelplan/test && npx vitest run --root .. tripDayMapFullPage.test.tsx` -- expected: passes, proving the `__dirname` resolution is invocation-independent.~~ **Not reachable, corrected during review:** `test/setup.ts:8-9` resolves the test DB and migrate lock from `process.cwd()`, so *every* suite dies in global setup outside `travelplan/`, independent of the colour guard. The `__dirname` change is still correct and removes one of the two couplings, but its benefit cannot be demonstrated end-to-end until `test/setup.ts` is fixed (recorded as a deferred finding). Invocation-independence of the guard itself is asserted instead by `test/hardcodedColour.test.ts`, which resolves its paths through the helper.
- `git diff --stat -- travelplan/scripts/audit-check.mjs` -- expected: empty.
- `grep -rn 'HARDCODED_COLOUR' travelplan/test travelplan/src` -- expected: definition only in `test/helpers/hardcodedColour.ts`, plus import sites.
- `grep -rn 'params: { id' travelplan/test` -- expected: zero matches.
- `grep -rn '@ts-ignore\|@ts-expect-error\|as any' travelplan/test travelplan/scripts` -- expected: no new matches introduced by this change.

## Auto Run Result

Status: `done`

### Implemented change

Three static-gate goals delivered together, because a `typecheck` script that exits 1 is not a gate: the two `react/no-children-prop` errors in `src/theme.ts` are fixed, `npx tsc --noEmit` is driven from **164 errors to 0**, `"typecheck": "tsc --noEmit"` is wired into `package.json` beside `lint`, and the four copy-pasted hardcoded-colour guards — two carrying a strictly weaker regex — are one shared helper. Every change is types-only or test-only apart from the two `createElement` calls in `theme.ts`, whose rendered output is unchanged and is now asserted.

The type debt resolved through two levers rather than the one the ledger named: `test/helpers/routeContext.ts` (90 errors, plus 7 casts hiding the same bug) and `scripts/audit-check.d.mts` (28 errors, with the security gate's runtime code untouched). `mockFetchResponse` — the helper DW-95 proposed — accounted for 5, and is built anyway because it is what makes ~267 previously-unchecked fixtures checkable going forward.

### Files changed

**New**
- `travelplan/test/helpers/routeContext.ts` — `routeContext(tripId)` and `absentSegmentContext()`, the context shape all `[id]` route handlers take.
- `travelplan/test/helpers/mockFetch.ts` — `mockFetchResponse` (typed envelope), `stubFetch` (the cast at the boundary, constrained to `fetch`'s signature), `requestUrl` (URL out of all three `RequestInfo | URL` members).
- `travelplan/test/helpers/hardcodedColour.ts` — the stronger colour regex, `stripComments`, `expectNoHardcodedColour`, resolving from `__dirname`.
- `travelplan/scripts/audit-check.d.mts` — hand-maintained declarations for the security gate's exports, replacing `never[]` inference. No byte of `audit-check.mjs` changed.
- `travelplan/test/hardcodedColour.test.ts`, `travelplan/test/mockFetch.test.ts` — the contracts the four screen suites and ~267 fixtures depend on but never exercise, including every documented blind spot.
- `travelplan/test/themeCheckboxIcons.test.tsx` — covers the only production change in the commit, previously asserted by nothing.

**Modified**
- `travelplan/src/theme.ts` — `children` moved out of both `createElement` props objects and passed as trailing arguments.
- `travelplan/package.json` — `typecheck` script.
- 9 route suites — 97 route contexts onto `routeContext`; the duplicate local helpers in `bucketListRoute` and `tripExportRoute` deleted.
- 7 component suites — fetch stubs onto `mockFetchResponse` / `stubFetch`; casts off variables and factories. All six suites the helper landed in now hold zero `as unknown as typeof fetch`.
- 4 screen suites — local colour guards deleted, helper imported, the `process.cwd()` coupling removed.
- 8 further suites — local type fixes (union narrowing, fixture completeness, mock prop types, generic arguments).

### Review findings

Three passes, every one with `intent_gap: 0` and `bad_spec: 0` — no loopback was needed.

| | pass 1 | pass 2 | pass 3 |
|---|---|---|---|
| patched | 10 (4 medium, 6 low) | 10 (4 medium, 6 low) | 9 (6 medium, 3 low) |
| deferred | 3 | 5 (DW-269…273) | 2 (DW-274, DW-275) |
| rejected | 13 | 11 | 7 |

Pass 3's shape differs from its predecessors: where passes 1 and 2 mostly corrected false invariants asserted in the new helpers' own headers, this pass found three defects in the *code*. A guard test that could never fail (`themeCheckboxIcons`, verified by rendering both spellings), an unconstrained generic that let any mock install as `fetch` (`stubFetch`), and an untyped re-cast that reintroduced the very defect the helper was added to prevent (`tripEditDialogHeroImage`). Two header-invariant corrections remain, and one of them — `mockFetch.ts`'s "only cast" claim, false for the third consecutive pass — was resolved by making the claim true rather than by rewording it again.

Rejected findings were verified individually and dropped for cause: the missing CI gate and the duplicated colour-guard fixture are already DW-269 and DW-273; the absent `text`/`clone`/`bodyUsed` on `mockFetchResponse` and the open index signature on `AuditReport` are documented deliberate decisions, the latter made by pass 2 for a stated reason; a claim that `audit-check.d.mts` makes divergence undetectable is wrong for the name-drift case, since the test suite imports those names from the `.mjs` at runtime and ESM throws on a missing export (the residual signature-drift gap is DW-275).

Deferred (both new ledger entries; no existing entry touched):
- **DW-274** *(medium)* — `RouteContext` declared privately in 22 handlers, exported by none, so the test helper is a 23rd copy the compiler cannot tie to any of them. This is the root cause of the cross-handler hazard `routeContext.ts` documents and cannot enforce.
- **DW-275** *(low)* — `audit-check.d.mts` shadows the implementation for type resolution, so signature drift in the security gate is undetectable (name drift is not — the runtime import catches it).

**For the orchestrator, on DW-271:** this pass fixed it. DW-271 recorded `stubFetch`'s unconstrained generic and deferred the fix on the stated grounds that tightening "would immediately error at every install site whose stub is typed narrowly … i.e. it fails the zero-error gate this sweep just established". That prediction is measurably wrong: the constraint was applied and `tsc --noEmit` stays at 0 errors across all ~160 install sites, while `stubFetch(vi.fn(async () => 42))` now fails with TS2345. The ledger entry is left exactly as written, per the invocation instruction; its status is the orchestrator's to resolve.

### Verification

- `npm run lint` — **0 errors**, 79 warnings (pre-existing; untouched per Boundaries).
- `npm run typecheck` — **0 errors**.
- `npm run test` — **137 files / 2038 tests, all passing**. Baseline was 134/1990; the previous pass finished at 137/2036. Net +2 this pass: three cases added to `hardcodedColour.test.ts` (two regex holes, one asymmetry), one inert case removed from `themeCheckboxIcons.test.tsx`.
- `stubFetch` constraint verified in both directions — 0 errors repo-wide with it applied, TS2345 on a deliberately bad mock.
- Children-in-props vs trailing-arguments equivalence verified by rendering both and comparing `innerHTML` (identical; neither contains `children`), which is what established the removed case as inert.
- Named-colour regex holes verified against the exported `HARDCODED_COLOUR`: `` `white` `` → false, `"White"` → false, `"WHITE"` → false, `"white"` → true, `` `#fff` `` → true.
- `grep -rn 'params: { id' test/` — 0 matches. `grep -rn 'routeContext()' test/` — 0 matches.
- `HARDCODED_COLOUR` defined exactly once, in `test/helpers/hardcodedColour.ts`.
- `git diff --stat -- travelplan/scripts/audit-check.mjs` — empty; the security gate's runtime code is unchanged.
- `as unknown as typeof fetch` in the six suites the helper landed in — 0 each. Repo-wide: 91 occurrences across 26 files, all at the safe `vi.stubGlobal` argument position, recorded as separate work in the helper's header.

### Residual risks

- The gate is a snapshot, not a floor: nothing in CI runs `lint`, `typecheck` or `test` (DW-269), and `tsconfig.json` pulls in `.next` generated types so the checked file set depends on whether `next build` has run (DW-270). Both are out of scope by the spec's own Never list.
- `scripts/audit-check.d.mts` remains hand-maintained against a `.js` implementation with `checkJs` off. Name drift fails the suite; signature drift does not (DW-275).
- ~50 route-aware stubs outside this change still resolve their URL with `String(input)`, which mis-reads a `Request` (DW-272). Unreachable today — nothing under `src/` constructs one.
- The colour guard's five documented limits are pinned as tests, so improving the regex will fail those cases by design; that is intended, but whoever improves it should expect to update the pins rather than read them as regressions.
