---
title: 'Timeline card layout: one breakpoint token behind data-layout and the grid'
type: 'refactor'
created: '2026-08-15'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: true
context: []
warnings: ['oversized']
baseline_revision: '8128a5922c0b3010effd31e6f0382f58aca83679'
final_revision: 'e813754a99f256b0d05a5adcf12a43389295feaf'
---

<intent-contract>

## Intent

**Problem:** `TripTimeline.tsx:909` stamps `data-layout={isNarrowLayout ? "stacked" : "inline"}` from `useMediaQuery(theme.breakpoints.down("sm"))` (`:177`), while the `sx` block seven lines below makes the same stacked-vs-inline decision through its own `{ xs, sm }` `gridTemplateColumns` / `gridTemplateAreas` (`:916-920`). Two independently written `sm` references decide one layout, so editing the grid to a different breakpoint leaves the attribute reporting the old answer — and `test/tripTimelinePlan.test.tsx:1095` and `:1106`, the only consumers of the attribute, keep passing while the rendered CSS has moved (DW-14).

**Approach:** Per the 2026-08-08 ledger decision, keep the attribute as a declared jsdom shim but remove the duplication: introduce one module-level breakpoint-key constant that both the `useMediaQuery` call and the two responsive `sx` objects read, so a future breakpoint change moves attribute and CSS together. Then make the coupling legible by cross-referencing the three sites — the attribute, the grid block, and the test assertions — from each other.

## Boundaries & Constraints

**Always:**
- Both the `useMediaQuery` argument and the `sm` keys of `gridTemplateColumns` and `gridTemplateAreas` must resolve from a single named constant, so changing that constant is the only edit needed to move the layout switch.
- Keep the constant a breakpoint *key* (`"sm"`), not a pixel number — the `sx` responsive objects are keyed by breakpoint name, and a raw px value could not be used as an `sx` key.
- Keep the emitted DOM identical for both layouts: `data-layout="stacked"` below the `sm` bound and `"inline"` at or above it, with the same `xs`/`sm` grid templates as today.
- Comments at the attribute site, at the grid block, and in the test must each name the other two sites. Anchor the test reference by file **and** test name as well as line number, since line numbers drift.
- Match the house comment style already used in `TripTimeline.tsx`, `DialogShell.tsx`, `AuthScreenShell.tsx` and `TripCreateForm.tsx`: prose sentences, backticked identifiers, dated decision / `DW-` ids.
- State in the attribute comment why this `useMediaQuery` does not contradict the "pure sx breakpoints" convention repeated in those three files: it stamps a test-visible attribute and drives no styling.

**Block If:** None — the mechanism and the wording obligations are both fixed by the 2026-08-08 ledger decision.

**Never:**
- Do not remove `data-layout`, and do not rewrite the two existing assertions in `test/tripTimelinePlan.test.tsx` — they must pass unchanged.
- Do not replace the jsdom assertion with a browser-level (Playwright) layout check, and do not add a Playwright harness; that remains DW-14's deferred follow-up, not this change.
- Do not touch `isTwoColumnLayout` (`:189`) or its DW-106/DW-107 comment block — separate, already-resolved concern.
- Do not change `theme.ts` or add a `breakpoints` override; MUI defaults (`sm = 600`) stay as they are.
- Do not modify the `matchMedia` stubs in `tripTimelinePlan.test.tsx`, `tripTimelineRoles.test.tsx`, `tripTimelineSharing.test.tsx` or `tripTimelineControlsFocus.test.tsx`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Narrow viewport | Viewport 375px (below the `sm` bound), timeline rendered | Each `timeline-day-card` carries `data-layout="stacked"`; grid uses the `xs` template `"56px 1fr"` / `'"photo title" "stay stay" "cov cov"'` | No error expected |
| Wide viewport | Viewport 1280px (at/above the `sm` bound) | Each `timeline-day-card` carries `data-layout="inline"`; grid uses the `sm` template `"72px 1fr 190px"` / `'"photo title stay" "cov cov cov"'` | No error expected |
| `useMediaQuery` mocked to `false` | `tripTimelineControlsFocus.test.tsx` mock resolves `max-width` queries to `false` | Attribute is `"inline"`, exactly as before this change | No error expected |

</intent-contract>

## Code Map

- `travelplan/src/components/features/trips/TripTimeline.tsx` -- `:177` `isNarrowLayout` declaration (sole consumer is `:909`); `:909` the `data-layout` attribute; `:916-920` the `gridTemplateColumns` / `gridTemplateAreas` responsive objects; **`:980-981` the day-card photo's `width` / `height: { xs: 56, sm: 72 }`** — the same card-layout decision, hardcoding `sm`, with `56`/`72` mirroring the grid's first column. `theme` from `useTheme()` at `:143`.
- `travelplan/test/helpers/emotionStyles.ts` -- `emotionPropertyConditions(element, property)` (`:142`) returns `{ base, media[] }`: which media conditions declare a property, read from the emitted Emotion CSSOM. Its own docstring names DW-14 and claims to exist because jsdom's CSSOM lists `grid-template-columns` in `Array.from(rule.style)` while `getPropertyValue` returns `""`. **That claim was measured false in review pass 4** — `emotionDeclarations` (`:106`) returns the real declared text for both grid shorthands here — so the stronger reading is available and the day-card pin uses it. The docstring and the one remaining caller that rests on it are DW-339. **Either way jsdom _can_ see which breakpoint the card grid is keyed to.**
- `travelplan/test/tripTimelineRoles.test.tsx` -- `:724` `it("declares the grid's own column split under the same \`md\` condition the mount point is keyed to")` uses `emotionPropertyConditions` (`:742`) on the sibling overview grid for exactly this purpose; its comment calls it "DW-14's failure mode, closed for the one declaration that now carries structural weight". The pattern to copy.
- `travelplan/test/tripTimelinePlan.test.tsx` -- `setMatchMedia` (`:41-62`) parses the px bound out of the query string; `setViewport` (`:1080-1084`); test `"keeps timeline cards readable when viewport changes between mobile and desktop widths"` (`:1033-1109`) holds the two assertions at `:1095` and `:1106`. Note `addEventListener` is a bare `vi.fn()` that never fires, so the two assertions only hold because of the explicit `rerender` between them.
- `travelplan/src/theme.ts` -- `createTheme` at `:206`, no `breakpoints` override, so `sm = 600`, `breakpoints.down("sm")` is `max-width: 599.95px` and `breakpoints.up("sm")` is `min-width: 600px` — the `sm` `sx` key uses the latter. Read-only reference.
- `travelplan/test/tripTimelineControlsFocus.test.tsx` -- `:36-64` mocks `useMediaQuery` by `min-width`/`max-width`. Read-only reference; note its `:57` comment calls `data-layout` "cosmetic", which is why the new comments must not restate that framing.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- DW-106 is `status: done 2026-08-09`: `useMediaQuery` is sanctioned **only** where a breakpoint decides which subtree mounts. `isNarrowLayout` does not mount anything, so it is not covered by that sanction. Read-only reference; do not edit.

## Tasks & Acceptance

**Execution:**
- [x] `travelplan/src/components/features/trips/TripTimeline.tsx` -- declare the shared constant typed as a breakpoint key, `const TIMELINE_CARD_LAYOUT_BREAKPOINT: Exclude<Breakpoint, "xs"> = "sm";` (`Breakpoint` from `@mui/material`), placed immediately above the component -- the annotation, not `as const`, is what rejects a pixel number or a collision with the literal `xs` key. Do not write `as const`: on a `const`-declared string literal it is a no-op, and a comment justifying it would be inventing a reason.
- [x] `travelplan/src/components/features/trips/TripTimeline.tsx` -- derive the attribute as the exact complement of the `sx` key: `const isNarrowLayout = !useMediaQuery(theme.breakpoints.up(TIMELINE_CARD_LAYOUT_BREAKPOINT));` -- `down("sm")` is `max-width: 599.95px` while the `sm` key applies from `min-width: 600px`, so the old `down()` form leaves a sub-pixel band (fractional `devicePixelRatio`, browser zoom) where the attribute says `inline` and the `xs` template renders. `up()` negated has no such band.
- [x] `travelplan/src/components/features/trips/TripTimeline.tsx` -- use the constant as the computed key in **every** `sm`-keyed rule that belongs to the day card: `gridTemplateColumns` and `gridTemplateAreas` (`:916-920`) **and** the photo's `width` / `height` (`:980-981`) -- `56`/`72` are the grid's own first-column widths, so a constant that moved the grid but not the photo would leave the photo overflowing its track. Leave the trip-stats strip (`:723`, `:727`, `:735`) alone: different region, not this card's decision.
- [x] `travelplan/src/components/features/trips/TripTimeline.tsx` -- add the paired comments at the `data-layout` attribute and at the grid block, **kept tight** (target ~4-6 lines each, not a paragraph apiece): each names the other site, the shared constant, and the test by file + test name + line. At the attribute, state plainly that this `useMediaQuery` is *outside* DW-106's sanction (which covers only breakpoints deciding which subtree mounts) and is kept anyway as a deliberate jsdom shim per the 2026-08-08 DW-14 decision -- avoid the ambiguous phrasing "is no exception to". Do not write that the attribute is "cosmetic". Do not claim the keys' dependency runs from the `sx` site to the attribute; both follow the constant. Preserve the existing "The xs template must name every area the children use…" comment sitting directly above the templates -- it explains a real rendering bug and must not be pushed below new bookkeeping.
- [x] `travelplan/test/tripTimelinePlan.test.tsx` -- add a short comment beside the two `data-layout` assertions: they are a jsdom approximation, they read the attribute rather than the templates, and per the 2026-08-08 DW-14 decision the executable pin lives in the new `tripTimelineRoles.test.tsx` case below. Also note that `setMatchMedia`'s listeners never fire, so both assertions hold only because of the `rerender` between them -- an implementation that read the viewport once at mount would pass both.
- [x] `travelplan/test/tripTimelineRoles.test.tsx` -- add one test that pins the day card's `grid-template-columns` media condition with `emotionPropertyConditions`, modelled on the existing `"declares the grid's own column split under the same \`md\` condition the mount point is keyed to"` case (`:724`) -- this is the executable half. Without it, an editor who reverts a computed key to a literal `sm:` leaves the constant in place and every test green, which is DW-14's original complaint ("the test still passes") reproduced. Assert the condition matches the `sm` bound (`min-width:600px`), and comment why the assertion is written against the emitted condition rather than the declaration value (jsdom returns `""` from `getPropertyValue` for that shorthand).

**Acceptance Criteria:**
- Given the unchanged assertions at `tripTimelinePlan.test.tsx:1095`/`:1106`, when the suite runs, then both pass and neither assertion was edited.
- Given an editor replaces any computed `[TIMELINE_CARD_LAYOUT_BREAKPOINT]` key in the card's `sx` with a literal different from the constant, when the suite runs, then the new `tripTimelineRoles.test.tsx` case fails.
- Given the constant is changed to another breakpoint key, when the component renders, then the `useMediaQuery` bound, both grid templates and the photo's `width`/`height` all move together with no other edit.
- Given the constant is assigned a pixel number, when `npm run typecheck` runs, then it fails.
- Given a developer reading the attribute, the grid block or the test, when they follow its comment, then it names the other sites, and no comment claims jsdom cannot see the templates or that the attribute is cosmetic.
- Given the full suite, typecheck and lint, when run, then all three pass with no new warnings.

## Spec Change Log

### 2026-08-15 — Review pass 1 (bad_spec)

**Triggering findings:** (1) The comments asserted "Nothing in the jsdom suite can see these templates", which is false — `test/helpers/emotionStyles.ts:142` `emotionPropertyConditions` exists for exactly this, names DW-14 in its docstring, and `tripTimelineRoles.test.tsx:724` already applies it to the sibling overview grid. (2) The "single switch" claim was untrue: the day-card photo's `width`/`height: { xs: 56, sm: 72 }` (`:980-981`) is the same decision, still hardcoded. (3) Nothing executable enforced the coupling, so reverting a computed key to a literal left every test green — DW-14's original complaint verbatim.

**Amended:** Code Map now lists `emotionStyles.ts`, the `tripTimelineRoles.test.tsx` precedent, the photo `sx`, and DW-106's closed status. Tasks now require the photo keys, an `Exclude<Breakpoint, "xs">` annotation instead of the no-op `as const`, `!up()` instead of `down()` for the sub-pixel band, an explicit comment-length budget with a do-not-say list, and a new executable `emotionPropertyConditions` pin. ACs are now falsifiable rather than descriptive.

**Known-bad state avoided:** a documentation-only change that restates DW-14's defect in ~28 lines of prose while leaving it mechanically unguarded, and that grounds its central promise in a claim the repo's own test helper contradicts.

**KEEP:** the shared-constant mechanism itself, and the choice of a breakpoint *key* over a pixel value, were right — re-derive both. Keep the constant name `TIMELINE_CARD_LAYOUT_BREAKPOINT`. Keep the three-way cross-reference (attribute ↔ grid ↔ test), and keep citing the test by name as well as by line. Keep the two existing `data-layout` assertions untouched.

## Review Triage Log

### 2026-08-15 — Review pass

- intent_gap: 0
- bad_spec: 3: (high 1, medium 2, low 0)
- patch: 5: (high 0, medium 0, low 5)
- defer: 1: (high 0, medium 0, low 1)
- reject: 7
- addressed_findings:
  - `[high]` `[bad_spec]` Comments claimed jsdom cannot observe the grid templates, and nothing executable enforced the new coupling; `emotionPropertyConditions` disproves the claim and supplies the guard. Spec amended to require the pin in `tripTimelineRoles.test.tsx`; implementation looped back.
  - `[medium]` `[bad_spec]` "Single switch" overclaimed — the day-card photo's `{ xs: 56, sm: 72 }` still hardcoded `sm`. Spec amended to bring the photo keys under the constant.
  - `[medium]` `[bad_spec]` `down("sm")` (`max-width:599.95px`) is not the complement of the `sm` `sx` key (`min-width:600px`), leaving a sub-pixel band where attribute and CSS disagree. Spec amended to require `!useMediaQuery(up(...))`.

### 2026-08-15 — Review pass 2

- intent_gap: 0
- bad_spec: 0
- patch: 8: (high 0, medium 3, low 5)
- defer: 0
- reject: 6
- addressed_findings:
  - `[medium]` `[patch]` The `down()`→`!up()` inversion silently broke the `useMediaQuery` discriminator in `tripTimelineControlsFocus.test.tsx` — it routes on `query.includes("min-width")`, which `up("sm")` now satisfies, so `isNarrowLayout` became `!mockIsTwoColumnLayout` instead of the pinned `false` its comment still claimed. Routed on the `md` bound specifically and rewrote the comment. Exactly the drift class this change exists to remove.
  - `[medium]` `[patch]` The pin covered `grid-template-columns` only, while the comment claimed both keys were protected; reverting `gridTemplateAreas` alone stayed green and renders three columns against a two-column area template at 600-899px. Added a second assertion and corrected the comment.
  - `[medium]` `[patch]` The `!up()` inversion itself had no coverage — reverting it passed the whole suite, since the existing case probes only 375 and 1280. Added `"stamps \`stacked\` right up to the \`sm\` bound and \`inline\` exactly on it"` at 599.98/600; verified it fails under `down()`.
  - `[low]` `[patch]` Plan-test comment claimed a mount-latched viewport read "would pass both"; it would fail the `inline` assertion. Reworded.
  - `[low]` `[patch]` New test used `{ missingAccommodation: false, accommodation: null }` — a state the server cannot produce, unique among the file's 19 fixtures. Changed to `true`.
  - `[low]` `[patch]` Pin comment sat above `alignItems`, reading as an annotation on it; moved above the templates it describes.
  - `[low]` `[patch]` New test gated on the fetch call rather than the rendered card, risking an opaque `classList` error instead of a missing-element failure. Switched to `findAllByTestId`.
  - `[low]` `[patch]` Cited line numbers went stale as the edits shifted them; all seven cross-references re-verified against the final file.

### 2026-08-15 — Review pass 3 (follow-up)

- intent_gap: 0
- bad_spec: 0
- patch: 10: (high 0, medium 4, low 6)
- defer: 2: (high 0, medium 0, low 2)
- reject: 6
- addressed_findings:
  - `[medium]` `[patch]` The photo's `sm` keys were guarded by nothing: mutating them to `md:` left the **whole** suite green, so AC "any computed key replaced by a different literal fails the roles case" was false for one of the three sites, and a 56px photo in a 72px track over 600-899px would have shipped silently. Extended the roles pin to the photo's `width`/`height` via `day-row-photo`; all three sites now fail their mutation.
  - `[medium]` `[patch]` Negating `up()` also negated MUI's `defaultMatches`, so any render without `matchMedia` — SSR, plus four suites that stub none — stamped `stacked` where `down("sm")` stamped `inline`, against the "keep the emitted DOM identical" boundary. Added `{ defaultMatches: true }` and a case pinning it (`"stamps \`inline\` when no \`matchMedia\` exists to ask"`); nothing had covered the default before.
  - `[medium]` `[patch]` The rewritten `tripTimelineControlsFocus.test.tsx` mock answered `true` to everything that was not literally `min-width:900px` — `max-width` queries and non-width ones (`prefers-reduced-motion`, `hover`, `print`) alike — the design its sibling `setViewportWidth` explicitly rejects. Narrowed to `min-width` only, so the whole answer set describes one coherent viewport.
  - `[medium]` `[patch]` That mock hardcoded MUI's serialization and default `md` value; had either changed, the branch would have gone unreachable and left `mockIsTwoColumnLayout` inert while the DW-107 cases still claimed to cross `md` — a silent pass, not a failure. Now derived from `createTheme().breakpoints.up("md")`.
  - `[low]` `[patch]` That mock's comment credited `tripTimelineRoles.test.tsx` with pinning `data-layout`; roles pins the CSS conditions, `tripTimelinePlan.test.tsx` pins the attribute. Corrected — naming the wrong site is the failure mode this change exists to prevent.
  - `[low]` `[patch]` The grid comment claimed "putting a literal back here fails there rather than staying green"; a literal `sm:` is currently identical and stays green. Reworded to the true claim: it fails once the literal names a breakpoint other than the constant's.
  - `[low]` `[patch]` "Both keys below are the constant `data-layout` above negates" — the attribute negates the media-query result, not the constant, and an attribute negates nothing. Reworded.
  - `[low]` `[patch]` The photo comment said a drifting key "overflows the track"; a 56px photo in a 72px track under-fills it. Reworded, and the comment now names its new pin.
  - `[low]` `[patch]` The new plan case left `matchMedia` installed at 600px and `innerWidth` at 600 for everything after it (`setMatchMedia` uses `Object.defineProperty`, which `vi.unstubAllGlobals()` does not undo). Added a describe-level `afterEach` restore; the property also needed `configurable: true`, without which vitest's own environment teardown threw an unhandled error.
  - `[low]` `[patch]` The new case queried the card synchronously after a `waitFor` that resolves when the request is *issued*, risking a missing-element failure instead of the attribute assertion. Switched to `findAllByTestId`.

### 2026-08-15 — Review pass 4 (follow-up)

- intent_gap: 0
- bad_spec: 0
- patch: 5: (high 0, medium 2, low 3)
- defer: 4: (high 0, medium 0, low 4)
- reject: 9
- addressed_findings:
  - `[medium]` `[patch]` The roles pin asserted *which* condition declares each property and never *what* it declares, on the stated grounds that jsdom answers `""` from `getPropertyValue` for the grid shorthands — measured false. Two value mutations were green: the photo's `sm` size moved to `80` against a `72px` track, and the `sm` columns cut to `"72px 1fr"` under a three-column area template (the very auto-placement overflow the comment above the templates warns about). Rewrote all four assertions onto `emotionDeclarations` as ordered condition→value pairs; both mutations now fail. This also closes the finding recorded as **DW-337** in pass 3 — flagged for the orchestrator, not edited in the ledger.
  - `[medium]` `[patch]` The `tripTimelineControlsFocus.test.tsx` mock's fallback answered `true` to *any* `min-width` query regardless of its bound, so it only happened to describe one viewport because `sm` and `md` are the only two queried; an `up("lg")` anywhere would have made it report "narrower than `md`" and "wider than `lg`" at once — the impossible state its own comment forbids. Replaced with a width comparison against `md`/`md - 1` derived from `breakpoints.values`, which also drops the dependency on MUI's query serialization and makes the comment's "same rule as `setViewportWidth`" true rather than aspirational.
  - `[low]` `[patch]` The new `afterEach` reasoned that cleanup belongs there because a failed assertion must not leak state, then omitted `vi.unstubAllGlobals()` — which every case in the file still calls on its own last line, i.e. the line a failure skips. Moved it into the hook; the per-case calls are idempotent and stay.
  - `[low]` `[patch]` The `sm`-bound case's fixture still paired `missingAccommodation: false` with `accommodation: null`, the impossible server state pass 2 corrected in its sibling. Set to `true`.
  - `[low]` `[patch]` Seven cross-file line citations went stale as this pass shifted the test files; all re-verified against the final files (`:1191/:1196`, `:1249`, `:1120/:1131`, `:755`, `:935`, `:951/:954`, `:81-96`).

## Design Notes

The `sx` responsive objects are keyed by breakpoint *name*, so the shared token is the key `"sm"`, not `600`. Type it rather than `as const` — a `const`-declared string literal already has the literal type, so `as const` buys nothing, while the annotation rejects both a pixel number and `"xs"` (which would collide with the literal `xs` key):

```ts
const TIMELINE_CARD_LAYOUT_BREAKPOINT: Exclude<Breakpoint, "xs"> = "sm";
// ...
gridTemplateColumns: { xs: "56px 1fr", [TIMELINE_CARD_LAYOUT_BREAKPOINT]: "72px 1fr 190px" },
```

The attribute must be the complement of the `sx` key, not a second query that happens to sit next to it: `breakpoints.up("sm")` is `min-width: 600px` — the exact condition under which the `sm` template applies — so `!useMediaQuery(up(BP))` is true precisely when the `xs` template renders. `down("sm")` (`max-width: 599.95px`) leaves `[599.95, 600)` unclaimed by both.

Two halves, two guards: the shared constant makes drift impossible for the keys that use it, and the `emotionPropertyConditions` pin makes a *removal* of that sharing fail loudly. Neither alone closes DW-14 — the constant can be edited away, and the pin only reads one declaration.

## Verification

**Commands:**
- `cd travelplan && npx vitest run test/tripTimelinePlan.test.tsx test/tripTimelineRoles.test.tsx` -- expected: all tests pass, including the two unedited `data-layout` assertions and the new `emotionPropertyConditions` pin.
- Negative check (revert after): temporarily replace the grid's computed key with a literal `md:` and re-run `test/tripTimelineRoles.test.tsx` -- expected: the new pin **fails**. A guard that cannot fail is not a guard.
- `cd travelplan && npm test` -- expected: full suite green, no regression in the other `matchMedia`-stubbing timeline tests.
- `cd travelplan && npm run typecheck` -- expected: no TypeScript errors from the computed `sx` keys.
- `cd travelplan && npm run lint` -- expected: clean.

**Manual checks (if no CLI):**
- `git diff` shows exactly one `"sm"` literal for this layout decision (the constant), and each of the three sites' comments names the other two.

**Mutation results (re-run in full at review pass 4).** Every guard was mutated and re-run against all three suites; all seven fail, so none is decorative:

| Mutation | Expected | Result |
|----------|----------|--------|
| Photo `sm` value `72` → `80` (track stays `72px`) | roles pin fails | ✅ 1 failed (was green before pass 4) |
| `gridTemplateColumns` `sm` value → `"72px 1fr"` (areas still name three) | roles pin fails | ✅ 1 failed (was green before pass 4) |
| Photo `width`/`height` key → `md:` | roles pin fails | ✅ 1 failed (was green before pass 3) |
| `gridTemplateAreas` key → `md:` | roles pin fails | ✅ 1 failed |
| `gridTemplateColumns` key → `md:` | roles pin fails | ✅ 1 failed |
| `!useMediaQuery(up(BP))` → `useMediaQuery(down(BP))` | `sm`-bound case fails | ✅ 2 failed |
| Drop `{ defaultMatches: true }` | no-`matchMedia` case fails | ✅ 1 failed (was green across all 151 files before pass 3) |

The first two are the value-level half. Before pass 4 the pin read conditions only, so both mutations shipped a visibly broken card — a 56px photo in a 72px track, and three columns under a two-column area template — with all 43 tests in the three suites green.


## Auto Run Result

Status: done (review pass 4 — follow-up review, no implementation loopback)

**Change.** DW-14's duplicated breakpoint is closed by one module-level `TIMELINE_CARD_LAYOUT_BREAKPOINT: Exclude<Breakpoint, "xs"> = "sm"` in `TripTimeline.tsx`, read by the `data-layout` media query and by all four of the day card's `sm`-keyed `sx` declarations, with the attribute derived as `!useMediaQuery(up(BP), { defaultMatches: true })` so it is the exact complement of the `sm` key rather than a second query beside it. The coupling is documented at all three sites and, since this pass, pinned by value as well as by breakpoint.

**Files changed in pass 4** (production code untouched except comment text):
- `travelplan/test/tripTimelineRoles.test.tsx` — the day-card pin now reads `emotionDeclarations` and asserts ordered condition→value pairs for `grid-template-columns`, `grid-template-areas` and the photo's `width`/`height`; comment rewritten off the false `getPropertyValue` premise.
- `travelplan/test/tripTimelineControlsFocus.test.tsx` — `useMediaQuery` mock answers every width query from one width (`md` / `md - 1`, read from `breakpoints.values`) instead of matching bounds one at a time.
- `travelplan/test/tripTimelinePlan.test.tsx` — `vi.unstubAllGlobals()` moved into the `afterEach`; impossible `missingAccommodation: false` / `accommodation: null` fixture corrected.
- `travelplan/src/components/features/trips/TripTimeline.tsx` — stale line citations only.
- `_bmad-output/implementation-artifacts/deferred-work.md` — DW-339 … DW-342 appended.

**Findings breakdown (pass 4).** 5 patches applied (2 medium, 3 low), 4 deferred (DW-339 `emotionStyles.ts` docblock states a jsdom limitation that does not exist; DW-340 the overview grid's `md` is still written twice; DW-341 `setMatchMedia` matches non-width queries; DW-342 a DW-107 negative assertion cannot fail), 9 rejected.

**For the orchestrator:** DW-337 (opened in pass 3, "the pin asserts conditions, never values") is resolved by this pass — its evidence recorded the value assertion as possibly unreachable, and it is not. The ledger entry was left untouched per the invocation's new-entries-only instruction.

**Verification.**
- `npx vitest run test/tripTimelinePlan.test.tsx test/tripTimelineRoles.test.tsx test/tripTimelineControlsFocus.test.tsx` → 43 passed.
- `npm test` → 151 files, 2383 tests, all passing.
- `npm run typecheck` → clean. `npm run lint` → 0 errors, 79 warnings, identical to the stashed baseline (no new warnings).
- Seven-mutation matrix re-run in full; every guard fails under its mutation (table above).
- All seven cross-file line citations re-verified against the final files.

**Residual risks.** The `tripTimelineControlsFocus.test.tsx` mock rewrite is not observed by any assertion in that file — reverting it to the previous form leaves its 4 cases green — so it rests on reasoning about coherence rather than on coverage. Its `md` value comes from MUI's defaults via `actual.createTheme()`, not from `@/theme`; the two agree today because `theme.ts` declares no `breakpoints` override, and if that changes the DW-107 cases fail loudly rather than silently. `data-layout` itself remains a test-only attribute carrying a live `matchMedia` subscription (DW-338).
