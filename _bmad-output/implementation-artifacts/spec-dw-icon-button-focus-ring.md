---
title: 'The app-wide focus ring reaches icon buttons'
type: 'bugfix'
created: '2026-08-10'
status: 'done'
baseline_revision: '823fae2'
review_loop_iteration: 0
final_revision: '681d364'
followup_review_recommended: false
context:
  - '{project-root}/.bmad-loop/runs/20260810-183633-664f/bundles/dw-icon-button-focus-ring/intent.md'
warnings: [oversized]
---

<intent-contract>

## Intent

**Problem:** `theme.ts:377` is the app's only theme-level `&.Mui-focusVisible` rule and it sits inside the `MuiButton` block. MUI's `IconButton` is a different component that inherits none of it, and `ButtonBase` ships `outline: 0` — so an icon-only control shows nothing at all under keyboard focus unless it says so itself. Seven of the app's twenty `IconButton`s say nothing, the header's `aria-label="Open menu"` hamburger among them (DW-65, DW-154). EXPERIENCE.md's Accessibility Floor makes a visible focus state unconditional and DESIGN.md's `icon-button` entry names the ring explicitly ("Hover and focus follow the Accessibility Floor — the app-wide focus ring, never colour alone"). The thirteen that do carry a ring say it four separate times in four files, which is the drift DW-154 predicted.

**Approach:** State the ring once, at `MuiIconButton.styleOverrides.root` in `theme.ts`, with the same `2px solid {colors.ink}` at `2px` offset the `MuiButton` rule uses. Then delete the two per-site copies Story 6.24 added under protest, having confirmed the on-photo white ring still overrides the new theme rule.

## Boundaries & Constraints

**Always:**
- The override goes on `MuiIconButton`, not `MuiButtonBase`. `ButtonBase` is also the base of `Button`, `MenuItem`, `Tab` and `Checkbox`, all of which the theme already styles deliberately; scoping to the component named in both ledger entries changes only icon buttons.
- Same geometry and same token as `MuiButton`: `outline: 2px solid ${colors.ink}`, `outlineOffset: "2px"`. No new token, no new value.
- The on-photo white ring wins. `ON_PHOTO_CHROME` (`TripIcons.tsx`) must still resolve to `2px solid #FFFFFF` on the day-hero chevrons/overflow and all three `FullscreenPhotoViewer` controls — an ink ring on a hero photo is ink-on-near-black. **Verified empirically before this spec was written:** with the theme rule in place, a bare `IconButton` goes `0px` → `2px solid #2B2A26` and an `ON_PHOTO_CHROME` one resolves to `2px solid #FFFFFF`, because MUI injects `sx` after `styleOverrides`. The tests must pin this, not re-discover it.
- Comments in `theme.ts` follow the file's convention: rationale-first, backticked identifiers, and an explicit argument for why the rule lives in the theme rather than at the call sites.

**Block If:**
- The on-photo ring stops overriding the theme rule for any of its seven consumers.

**Never:**
- Do not touch `ROW_ICON_BUTTON_SX` (`AdminUsersList.tsx:635-641`) or `rowActionButtonSx` (`TripBucketListPanel.tsx:639-647`). They are DW-50's fix, not Story 6.24's; both are pinned by existing tests, one of them through `&:focus-visible` rather than `&.Mui-focusVisible`. They become redundant, not wrong — removing them is a separate decision and is out of this bundle's stated intent.
- Do not change the ring's colour, width or offset for any control that already has one, and do not remove `ON_PHOTO_CHROME`'s ring.
- Do not fix the unrelated defects visible in the same files — the header hamburger's 32×32 hit area is below the 44px floor and is not this bundle's.
- Do not edit `{implementation_artifacts}/deferred-work.md`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Previously ringless icon button | Header hamburger, map-expand, bucket-list chevron/add, day-add, travel-segment edit — `.Mui-focusVisible` applied | `outline` computes to `2px solid #2B2A26`, `outline-offset` `2px` | No error expected |
| Same button, unfocused | No `.Mui-focusVisible` class | `outline` still computes to `0px` — the ring is conditional, nothing gains a resting outline | No error expected |
| On-photo control | Day-hero chevron / viewer close, `ON_PHOTO_CHROME` spread into `sx`, `.Mui-focusVisible` applied | `outline` computes to `2px solid #FFFFFF` — `sx` outranks the theme | No error expected |
| Story 6.24's two controls after their `sx` is deleted | Shared dialog `✕`, activity-dialog delete | Unchanged from today: `2px solid #2B2A26` at `2px`, now sourced from the theme | No error expected |
| Non-icon `ButtonBase` descendants | `MenuItem`, `Tab`, `Checkbox`, `Button` | Focus treatment unchanged — the override is scoped to `MuiIconButton` | No error expected |

</intent-contract>

## Code Map

- `travelplan/src/theme.ts` -- `colors` at `:56-86` (`ink` = `#2B2A26` at `:61`); `MuiButton` block `:359-406` with the model `&.Mui-focusVisible` at `:377-380`. `components` ordering is thematic, not alphabetical — the new `MuiIconButton` block belongs immediately after `MuiButton` closes at `:406`, before `MuiTextField`.
- `travelplan/src/components/ui/DialogCloseButton.tsx:54-72` -- Story 6.24's first per-site ring, with a comment that names DW-154 and says the theme override "is a sweep of its own". This is that sweep.
- `travelplan/src/components/features/trips/TripDayPlanDialog.tsx:2024-2037` -- Story 6.24's second copy, on the activity dialog's delete glyph.
- `travelplan/src/components/features/trips/TripIcons.tsx:488-501` -- `ON_PHOTO_CHROME`. Its docstring says "two of the three consumers here are MUI `Button`s"; there are seven consumers and one is a `Button`.
- Previously ringless sites: `HeaderMenu.tsx:254`, `TripBucketListPanel.tsx:680,690`, `TripDayBucketListPanel.tsx:103`, `TripDayMapPanel.tsx:68`, `TripOverviewMapPanel.tsx:47`, `TripDayView.tsx:2259`. All sit on card/paper or the near-white app bar, so an ink ring is the right one everywhere.
- `travelplan/test/theme.test.tsx:118-137` -- the `MuiButton` ring assertion; the `MuiIconButton` one belongs beside it.
- `travelplan/test/formPrimitives.test.tsx:385-409` and `travelplan/test/dialogCloseAffordance.test.tsx:125-147` -- both assert `0px` → `2px solid #2B2A26` on Story 6.24's controls and both keep passing, but their docstrings describe the per-site fix being deleted.
- `travelplan/test/helpers/renderWithProviders.tsx` -- the `ThemeProvider` wrapper every render-based assertion needs.

## Tasks & Acceptance

**Execution:**
- [x] `travelplan/src/theme.ts` -- add `MuiIconButton: { styleOverrides: { root: { "&.Mui-focusVisible": { outline: \`2px solid ${colors.ink}\`, outlineOffset: "2px" } } } }` directly after the `MuiButton` block, with a comment stating why `IconButton` inherits nothing from the rule above it, why the scope is `MuiIconButton` rather than `MuiButtonBase`, and that `sx` still outranks it so the on-photo chrome keeps its white ring -- DW-65, DW-154: one statement replaces four.
- [x] `travelplan/src/components/ui/DialogCloseButton.tsx` -- delete the `&.Mui-focusVisible` block and the paragraph of comment that exists to justify its being per-site; keep the rest of the `sx` (size, radius, colour) -- the comment's own condition ("a `MuiIconButton` theme override would close it") is now met.
- [x] `travelplan/src/components/features/trips/TripDayPlanDialog.tsx` -- same deletion on the delete glyph's `sx`, keeping size/radius/colour -- second of Story 6.24's two copies.
- [x] `travelplan/src/components/features/trips/TripIcons.tsx` -- rewrite `ON_PHOTO_CHROME`'s docstring: the ring it overrides now comes from `MuiIconButton` as well as `MuiButton`, and the consumer count is seven (six `IconButton`s, one `Button`) -- the docstring is the only place the override relationship is written down, and it is currently wrong about who it protects.
- [x] `travelplan/test/theme.test.tsx` -- assert the `MuiIconButton` root override equals the `MuiButton` one, beside the existing AC6 test -- pins that the two rings cannot drift apart at the theme level.
- [x] `travelplan/test/iconButtonFocusRing.test.tsx` -- new suite covering the matrix through rendered components, not the theme object: at least one previously ringless real control (the header hamburger) going `0px` → `2px solid #2B2A26`; an `ON_PHOTO_CHROME` `IconButton` resolving to `2px solid #FFFFFF` under the same theme; a `MenuItem` (or `Tab`) proving the override did not leak to other `ButtonBase` descendants -- jsdom cannot match `:focus-visible`, so add the `Mui-focusVisible` class directly, the pattern `dialogCloseAffordance.test.tsx:125-147` already uses.
- [x] `travelplan/test/formPrimitives.test.tsx`, `travelplan/test/dialogCloseAffordance.test.tsx` -- update the two docstrings that describe the ring as declared per-site, so they say the theme now supplies it and the assertion is that the shared control still gets it -- the assertions stay byte-identical; only the explanation was invalidated.

- [x] `travelplan/src/components/features/trips/TripDayView.tsx` -- rewrite the two comment lines at `:2847` that justified the hero overflow's explicit 44px sizing with "the theme ... has no MuiIconButton override" -- **added during implementation**: this change makes that sentence false, and the sizing rationale it carries is still correct (the override carries focus and no geometry). Comment only; no code, no behaviour, eslint count unchanged.

**Acceptance Criteria:**
- Given a keyboard user tabbing to the header's "Open menu" hamburger, when `.Mui-focusVisible` is applied, then its computed `outline` is `2px solid #2B2A26` at `2px` offset — where before this change it was `0px` (DW-65).
- Given every `IconButton` in `src/`, when none is focused, then each still computes `outline: 0px`, so no control gains a resting outline.
- Given the day-hero chevrons, the day-hero overflow and all three `FullscreenPhotoViewer` controls, when focus-visible, then their ring is still `2px solid #FFFFFF` and not the theme's ink one (DW-154's stated precondition).
- Given `MenuItem`, `Tab`, `Checkbox` and `Button`, when focus-visible, then their focus treatment is exactly what it was before this change.
- Given the whole change, when `npm run lint && npm run typecheck && npm run test` runs, then all three pass and no pre-existing suite regresses — in particular the two Story 6.24 suites, which must keep passing unedited in their assertions.

## Spec Change Log

## Review Triage Log

### 2026-08-10 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 13: (high 0, medium 1, low 12)
- defer: 4: (high 0, medium 3, low 1)
- reject: 2
- addressed_findings:
  - `[medium]` `[patch]` The new suite pinned a *known* Accessibility-Floor violation as expected behaviour: `MenuItem`/`Tab`/`Checkbox` were asserted `toBe("0px")` after `Mui-focusVisible`, while the test's own docstring conceded that having no focus state there is an open question against EXPERIENCE.md:107. Whoever closed that gap would have been met by a failure from a test filed under `IconButton` scope. The claim worth making is "this override did not leak", so the assertion is now `not.toBe(INK_RING)` and the test is renamed accordingly. Re-verified that it still fails when the override is widened to `MuiButtonBase`.
  - `[low]` `[patch]` **The stated precedence mechanism was wrong in three places.** `theme.ts`, `TripIcons.tsx` and the new suite all claimed the on-photo white ring wins because "both rules compile to a two-class selector, so specificity ties and injection order decides". Measured against MUI 7.3.11: the element carries **one** emotion class and both rules are emitted under the *identical* selector in the same stylesheet (`.css-1goytsd-MuiButtonBase-root-MuiIconButton-root.Mui-focusVisible`, ink then white), `sx` second because it is the final style argument in the `styled()` composition. So it is last-declaration-wins on MUI's internal composition order, not a cross-class cascade. All three corrected to say that, since the wrong model was being reasoned *from* ("anything that moved this ring into a theme override of its own would lose that guarantee").
  - `[low]` `[patch]` The theme comment claimed "every icon-only control in the app computed to no visible focus indicator at all". False in both directions, and both now stated: the override reaches *more* than the hand-written sites (MUI composes `IconButton` internally, so `Alert`'s `onClose` slot — `AdminUsersList`'s error alert — takes the ring, measured `0px` → `2px solid #2B2A26`; the blast radius is not bounded by `grep '<IconButton'`), and *less* than "every icon-only control" (the glyph buttons built as `Box component="button"` in `DocChip`, `PhotoUploadField`, `DocumentUploadField` and `TripDayPlanItemContent` carry their own `:focus-visible` rings and this selector cannot see them).
  - `[low]` `[patch]` Added a test rendering `<Alert severity="error" onClose>` and asserting the ink ring on its close slot — the MUI-internal `IconButton` case had no coverage, and it is the reason `theme.test.tsx` must keep geometry out of the override.
  - `[low]` `[patch]` The rewritten `ON_PHOTO_CHROME` docstring replaced one inaccuracy with another: it said all seven consumers sit on `HERO_SCRIM`, but `FullscreenPhotoViewer` never imports the scrim — its three controls sit on that viewer's own `rgba(0, 0, 0, 0.92)` backdrop. Corrected, since the docstring is what a future change to `HERO_SCRIM`'s stops would be read against.
  - `[low]` `[patch]` The theme comment listed "the hamburger, the map-expand controls, the bucket-list actions" as the seven previously-ringless sites — that glosses six. All seven are now named (`HeaderMenu`, both map panels, both `TripBucketListPanel` controls, `TripDayBucketListPanel`, and `TripDayView`'s travel-segment edit glyph), so the count and the list agree.
  - `[low]` `[patch]` Four comments at the two surviving per-site sites still asserted the pre-change world — `AdminUsersList.tsx` ("`theme.ts` has no `MuiIconButton` override", twice) and `TripBucketListPanel.tsx` ("the app-wide `MuiIconButton` fix reserved for DW-65", twice). This change makes all four false, the same defect already repaired in `TripDayView.tsx`. Corrected, and each now records that its ring is a *duplicate* which `sx` lets silently outrank the theme. **Note this touches two files the spec's Boundaries said not to touch:** the `sx` objects themselves are byte-identical, and only prose this change falsified was edited — the reading is that repairing collateral is not the same as reopening DW-50's decision, but it is a judgment call and is flagged as one.
  - `[low]` `[patch]` `expect(theme.components?.MuiButtonBase).toBeUndefined()` failed on any `MuiButtonBase` entry at all, so a ring-neutral `disableRipple` default would have broken a test about focus-ring drift. Narrowed to "no focus rule at the base".
  - `[low]` `[patch]` `expect(Object.keys(iconButton)).toEqual(["&.Mui-focusVisible"])` froze the whole override to one key, while its own comment argued only against geometry — and DESIGN.md:272's unmet 44×44 floor for `icon-button` makes a future geometry discussion likely. Narrowed to forbid geometry keys specifically.
  - `[low]` `[patch]` `expect(iconButtons.length).toBe(3)` made a test about resting outlines fail whenever `HeaderMenu` gains an icon control. Relaxed to `toBeGreaterThanOrEqual(3)`, which is all the following loop needs.
  - `[low]` `[patch]` The new suite assigned `global.fetch` directly in `beforeEach` with no teardown — the practice DW-69 is open against. Moved onto the house `stubFetch` helper with `vi.unstubAllGlobals()` in `afterEach`, so the file no longer depends silently on `vitest.config.ts`'s `fileParallelism: false`.
  - `[low]` `[patch]` `probesSettled`, a counter incremented inside the mock's `json()`, coupled the header test to the stub's internals and would have hung for the full 15s timeout if `HeaderMenu`'s probe changed shape. Replaced with `expect(fetchMock).toHaveBeenCalled()`.
  - `[low]` `[patch]` The on-photo assertions turn on style *ordering*, but run under `renderWithProviders` (`ThemeProvider` only) while production also wraps `AppRouterCacheProvider` and `CssBaseline`. A future emotion cache option (`enableCssLayer`, `prepend`, a different key) could reorder MUI's output in the browser and leave every assertion green. Recorded in the suite docstring as a second reason the browser pass is owed, rather than changing the house render helper.

**Deviation from step-04, stated rather than silent:** the four `defer` findings were **not** appended to `deferred-work.md`. This invocation forbids editing the ledger ("the orchestrator records resolution"), so they are recorded under `## Auto Run Result` → *Deferred for the ledger* instead, for the orchestrator to enter.

**One patch was attempted and withdrawn.** The review found that `TripDayPlanDialog`'s `plan-delete-action` trash glyph — the one destructive icon-only control, and the second of the two per-site rings this change deletes — has no test anywhere in `test/` that renders it and reads its ring. Rendering it under real MUI was attempted in the new suite (it cannot go in `tripDayPlanDialog.test.tsx`, which mocks `@mui/material` wholesale, so a computed style measured there would be the mock's). The render hangs indefinitely: no suite in the repo has ever mounted this dialog under real MUI, and it pulls leaflet in through a dynamic import that the existing harnesses all stub the whole dialog out to avoid. A hanging test is worse than the gap, so the attempt was reverted and the finding was reclassified `defer` rather than left as a silent patch.

### 2026-08-10 — Review pass (follow-up)

- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 0, medium 0, low 4)
- defer: 6: (high 0, medium 3, low 3)
- reject: 7
- addressed_findings:
  - `[low]` `[patch]` **The precedence mechanism was still wrong, in the direction that made it look safer than it is.** The previous pass corrected "specificity ties and injection order decides" to "both rules are emitted under the identical selector *in the same stylesheet*, `sx` second — so it is last-declaration-wins on MUI's composition order, not injection order". Measured again this pass by dumping the emitted `<style>` tags under MUI 7.3.11: the selector is indeed identical, but the two rules land in **two separate `<style>` elements** (ink at index 16, white at 18). So the mechanism *is* insertion order — just same-class rather than cross-class. That distinction is load-bearing rather than pedantic: within-sheet declaration order is robust, whereas document insertion order is exactly what an emotion cache option (`prepend`, `insertionPoint`, `enableCssLayer`) perturbs, which is the risk the suite's own docstring already warns about. Corrected in all three places (`theme.ts`, `TripIcons.tsx`, the suite), which now agree with each other and with that warning.
  - `[low]` `[patch]` The new suite's no-leak docstring asserted that "`MenuItem`, `Tab` and `Checkbox` having no visible focus state at all is its own open question". Measured: `MenuItem` **does** take a focus treatment — MUI's default `rgba(0, 0, 0, 0.12)` background, which this theme does not remove — while `Tab` and `Checkbox` change nothing at all. The claim was the stated rationale for asserting `not.toBe(INK_RING)` rather than `toBe(NO_RING)`, so a false premise was carrying a correct decision. Rewritten to say which of the three are actually inert; the assertion is unchanged and is now additionally justified by the fact that `toBe(NO_RING)` would already be false for `MenuItem`.
  - `[low]` `[patch]` **Both of `theme.test.tsx`'s new negative guards could go vacuous without failing.** Each scanned `Object.keys` of a value cast to `Record<string, unknown>`: `Object.keys` of a function is `[]`, and MUI permits any `styleOverrides` slot to be a `({ theme }) => ({...})` callback, so the idiomatic form for theme access would have silently disabled both — and neither descended into a nested block, so geometry added one level down inside `&.Mui-focusVisible` was invisible to the geometry guard the `theme.ts` comment cites as bounding the override's blast radius. Both now serialise the whole `styleOverrides` block through a `serialisedOverrides` helper that asserts against function-valued slots rather than stringifying them away, so the callback case fails loudly instead of skipping. Verified by mutation: a nested `minHeight: 44` fails, and converting `root` to a callback fails.
  - `[low]` `[patch]` The on-photo stand-in rendered `sx={{ ...ON_PHOTO_CHROME }}`, but the day-hero chevrons it claims to cover compose **two** objects — `{ ...ON_PHOTO_CHROME, ...HERO_CHEVRON_BACKING, ... }` (`TripDayView.tsx:2809`, `:2829`). Object spread is last-key-wins, so a focus key arriving in the second spread would clobber the white ring before the cascade saw it. It carries `backgroundColor` and `&:hover` only, so the test was correct by luck. Now models production's two-spread shape, and — since `HERO_CHEVRON_BACKING` is module-local to `TripDayView` and cannot be imported — states plainly that what is pinned is the *shape* being harmless today, not that the real constant stays that way.

**Deferred as ledger entries this pass:** DW-292 through DW-297. Unlike the first pass, this invocation permits appending to `deferred-work.md` as long as existing entries are untouched, so the four findings the first pass could only record in prose (drift guard, `MuiRadio`, the bucket-add ring ratio, `plan-delete-action` coverage) are now filed alongside two new ones (the owed browser pass; the hamburger's 32×32 hit area). Verified append-only: the sole deletions in the ledger diff are the orchestrator's own pre-existing DW-65/DW-154 status flips.

**Rejected (7).** Prose counts that nothing pins ("seven hand-written", "the twenty in `src/`") — all verified correct today and cheap to reread. `@mui/material` being `^7.3.8` rather than pinned to the 7.3.11 the comments cite — those comments state what was *measured*, which is accurate, and the lockfile plus the suite catch a drifting minor. The serialisation-sensitivity of `not.toBe(INK_RING)` if jsdom ever emits `rgb(43, 42, 38)` — the positive assertions fail loudly under the same change. Asserting `boxShadow`/`border` in the resting-state check — not a plausible failure mode of an outline-only override. The `:focus-visible` vs `.Mui-focusVisible` predicate nuance in `TripBucketListPanel`'s comment — true in every browser the app targets, and the substantive half of that finding is filed as DW-292. A test asserting `theme-registry.tsx` passes no cache options — speculative, and the risk is now stated in three places and tracked by DW-296. "Three suites now assert the same ring" — the two docstring rewrites are honest that their assertions are unchanged, which is the point of them.


## Design Notes

`MuiButtonBase` was the alternative both ledger entries mention. It is rejected: `Button`, `MenuItem`, `Tab` and `Checkbox` all extend `ButtonBase` and all four already carry deliberate theme treatment, so a base-level ring would silently restyle focus on four component families to fix one. `MuiIconButton` is the smallest scope that closes both entries.

The precedence question DW-154 flags as the thing to check was settled by measurement before this spec was written, in a throwaway jsdom probe (since deleted) using a `createTheme` carrying only the proposed override:

```
BARE  before: "0px"   after: "2px solid #2B2A26" offset "2px"
PHOTO after:  "2px solid #FFFFFF"
```

Both `&.Mui-focusVisible` rules compile to a two-class selector, so specificity ties and injection order decides — MUI emits `sx` after `styleOverrides`. This is the same mechanism by which `ON_PHOTO_CHROME` already overrides the `MuiButton` ring for `TripTimeline`'s share button today, so the change adds no new reliance.

## Verification

**Commands:**
- `cd travelplan && npx vitest run test/theme.test.tsx test/iconButtonFocusRing.test.tsx test/dialogCloseAffordance.test.tsx test/formPrimitives.test.tsx test/tripBucketListPanel.test.tsx` -- expected: all pass, including the two DW-50 suites whose per-site rings this change deliberately leaves in place.
- `cd travelplan && npm run typecheck` -- expected: exit 0.
- `cd travelplan && npm run lint` -- expected: no new errors or warnings, compared **per touched file** against the `823fae2` copy of that file.
- `cd travelplan && npm run test` -- expected: the full suite passes; compare against the pre-change baseline and treat any newly failing file as a regression.

**Manual checks (if no CLI):**
- jsdom evaluates no `:focus-visible`, so the rendered ring on a real browser is asserted by class substitution, not by tabbing. A browser pass over the header hamburger and one day-hero chevron remains owed and must be reported as owed, not as done.


## Auto Run Result

Status: done
Bundle: `dw-icon-button-focus-ring` — DW-65, DW-154
Pass: follow-up review of an already-`done` spec (no implementation loopback; `823fae2` remains the baseline)

**What the change is.** Unchanged from the first run and re-verified here: one
`MuiIconButton.styleOverrides.root` rule in `theme.ts` carrying the same `2px solid {colors.ink}` at `2px`
offset the `MuiButton` rule above it has always carried, so the seven hand-written `<IconButton`s that
computed to no visible focus indicator — the header's "Open menu" hamburger among them (DW-65) — now show
one. Story 6.24's two per-site copies are deleted; `ON_PHOTO_CHROME`'s white ring still overrides the new
rule, which is the precondition DW-154 named.

**What this pass changed.** Four low-severity patches, no behaviour change, no code path touched.
- `travelplan/src/theme.ts`, `travelplan/src/components/features/trips/TripIcons.tsx`,
  `travelplan/test/iconButtonFocusRing.test.tsx` — the precedence mechanism, corrected for the second
  time and this time measured directly. The two rules do share one generated selector, but they land in
  **two separate `<style>` elements**, so what decides is emotion's document insertion order. The
  previous wording ("in the same stylesheet") implied within-sheet declaration order, which is robust;
  insertion order is not, and is precisely what a cache option in `theme-registry.tsx` would perturb.
  All three now say the same true thing and agree with the suite's existing cache-ordering warning.
- `travelplan/test/iconButtonFocusRing.test.tsx` — the no-leak docstring no longer claims `MenuItem` has
  no focus state (it takes MUI's default `rgba(0,0,0,0.12)` background; only `Tab` and `Checkbox` are
  inert), and the on-photo stand-in now models the two-spread `sx` the day-hero chevrons actually use.
- `travelplan/test/theme.test.tsx` — both negative guards rebuilt. They previously scanned `Object.keys`
  of a possibly-function value and never descended into nested blocks, so a `({ theme }) => ({...})`
  slot or a `minHeight` one level down inside `&.Mui-focusVisible` would have disabled them silently.

**Review findings.** 4 patches applied (0 high, 0 medium, 4 low), 6 deferred, 7 rejected, 0 intent gaps,
0 spec loopbacks. See the Review Triage Log's follow-up entry.

**Deferred work.** Filed as **DW-292 … DW-297** in `deferred-work.md`, append-only — the four the first
pass could only record in prose (no drift guard on the two surviving per-site rings; `Radio` has no focus
indicator at all; the bucket-add controls' 48px ring around a 24px disc; `plan-delete-action` has no
rendered guard because `TripDayPlanDialog` cannot be mounted under real MUI) plus two surfaced this pass
(the owed browser pass, filed nowhere; the hamburger's 32×32 hit area). The first run's
*Deferred for the ledger* prose section is superseded by those entries and is not reproduced here.

**Verification.**
- `npm run typecheck` → exit 0.
- `npx eslint` on the four patched files → clean, 0 errors and 0 warnings.
- `npm run test` → **144 files / 2211 tests passing**, identical to the pre-patch run. No suite regressed
  and no test count moved: every patch was a comment, a docstring, or a strengthened guard.
- The two rebuilt guards were mutation-checked rather than assumed: adding `minHeight: 44` *inside*
  `&.Mui-focusVisible` fails the test, and converting `styleOverrides.root` to a callback fails it. Both
  passed under the previous key-scanning form.
- The precedence correction was measured, not reasoned: a throwaway probe (since deleted) rendered
  `<IconButton sx={{...ON_PHOTO_CHROME}}>` and dumped every emitted `<style>` tag — the identical selector
  `.css-1goytsd-MuiButtonBase-root-MuiIconButton-root.Mui-focusVisible` appears twice, ink at index 16 and
  white at index 18. The same probe measured `MenuItem`/`Tab`/`Checkbox`/`Radio` focus states.

**Residual risks.** Unchanged from the first run, and none of them was closed by this pass:
- **The browser pass is still owed and is still not done.** jsdom implements no `:focus-visible`, so every
  assertion substitutes the class MUI would apply. Now tracked as DW-296 rather than only in prose.
- **The on-photo inversion rests on emotion's insertion order** across two separate style elements — a
  weaker footing than the previous wording implied. Pinned by tests, stated accurately in three places,
  and the browser-side half is DW-296.
- **The blast radius is wider than the audit that justified it**: MUI composes `IconButton` internally, so
  the ring lands on controls no app code names (`Alert`'s close slot today). Correct by the Accessibility
  Floor, and the reason `theme.test.tsx` now forbids geometry anywhere in the override, not just at `root`.
- Icon-only controls built as `Box component="button"` still carry six hand-copied rings outside this
  selector's reach, and the five DW-50 row buttons carry duplicates with nothing guarding them (DW-292).
