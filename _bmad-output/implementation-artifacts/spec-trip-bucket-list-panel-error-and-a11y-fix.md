---
title: 'Trip bucket list panel: surfaced load errors and separated edit/delete hit areas'
type: 'bugfix'
created: '2026-08-09'
status: 'done'
baseline_revision: '8fb2d3d'
final_revision: 'a8ef304'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: [multiple-goals]
---

<intent-contract>

## Intent

**Problem:** `TripBucketListPanel` is default-collapsed and hoists an entry count into the always-visible header, but `loadError` lives only inside the `Collapse`, so a load failure shows a lying "0 entries" with no visible error until the user expands (DW-48). Separately, the row-level edit/delete `IconButton`s sit `gap: 0.25` (2px) apart with no `:focus-visible` treatment, short of WCAG 2.2 target-size guidance (DW-50).

**Approach:** Render the error `Alert` outside the `Collapse` (always visible) and suppress the count line while `loadError` is set. Widen the edit/delete button gap to `gap: 1` (8px) and add a local `&:focus-visible` outline to both `IconButton`s, matching the pattern already used elsewhere in this codebase (`DocChip.tsx`, `PhotoUploadField.tsx`) rather than the app-wide `MuiIconButton` theme fix reserved for DW-65.

## Boundaries & Constraints

**Always:**
- Keep the error `Alert` inside the same outer `Box` as the header row and the `Collapse`, so it is visible regardless of `isCollapsed`.
- Suppress `entryCountLabel` while `loadError` is truthy — do not render both a count and an error simultaneously.
- Use the existing local-`sx` `&:focus-visible` pattern (see `DocChip.tsx:103`, `PhotoUploadField.tsx:266`) for the edit/delete buttons: `outline: `2px solid ${tokens.ink}`, outlineOffset: "2px"`. Do not touch `theme.ts`.
- Leave the header's toggle/add `IconButton` pair (`gap: 0.75`, already ≥8px) untouched.

**Block If:** none identified.

**Never:**
- Do not modify `theme.ts`'s `MuiIconButton` styleOverrides — that is DW-65's reserved scope; duplicating it here would conflict with that fix.
- Do not change `loading`/`emptyState` rendering position — they stay inside `Collapse`.
- Do not edit `_bmad-output/implementation-artifacts/deferred-work.md`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Load fails while collapsed | `GET .../bucket-list-items` rejects/errors, `isCollapsed: true` | Error `Alert` visible; no "0 entries" count line rendered | No error expected |
| Load fails while expanded | same fetch failure, `isCollapsed: false` | Error `Alert` visible both above and inside the expanded region (same alert, not duplicated) | No error expected |
| Load succeeds | items returned normally | Count line renders as before; no `Alert` | No error expected |
| Row buttons focus | tab to edit button, then delete button | Each shows a `2px solid` ink outline with `2px` offset on `:focus-visible` | No error expected |
| Row buttons spacing | rendered row | Computed gap between the two `IconButton`s is `8px` (theme spacing `1`) | No error expected |

</intent-contract>

## Code Map

- `travelplan/src/components/features/trips/TripBucketListPanel.tsx:644-699` -- header row; count line (`entryCountLabel`) needs gating on `!loadError`
- `travelplan/src/components/features/trips/TripBucketListPanel.tsx:701-702` -- `Collapse` wrapper currently contains `loadError`'s `Alert`; move the alert outside
- `travelplan/src/components/features/trips/TripBucketListPanel.tsx:784-801` -- row action `Box` (`gap: 0.25`) and its two `IconButton`s, need wider gap + `&:focus-visible`
- `travelplan/test/tripBucketListPanel.test.tsx` -- existing suite; mocks fetch via `mockBucketListFetch`, uses `renderWithProviders`

## Tasks & Acceptance

**Execution:**
- [x] `travelplan/src/components/features/trips/TripBucketListPanel.tsx` -- move the `loadError` `Alert` out of `Collapse` (render it right after the header row, before `Collapse`) and gate `entryCountLabel`'s `Typography` on `!loadError` -- fixes DW-48
- [x] `travelplan/src/components/features/trips/TripBucketListPanel.tsx` -- change the row-actions `Box`'s `gap: 0.25` to `gap: 1` and add `"&:focus-visible": { outline: `2px solid ${tokens.ink}`, outlineOffset: "2px" }` to both the edit and delete `IconButton` `sx` props -- fixes DW-50
- [x] `travelplan/test/tripBucketListPanel.test.tsx` -- add coverage for the I/O matrix above (error-while-collapsed, error-while-expanded, gap width, focus-visible outline)

**Acceptance Criteria:**
- Given the bucket-list fetch fails and the panel is collapsed, when the panel renders, then an error `Alert` is visible and no entry-count text is shown.
- Given the bucket-list fetch fails, when the panel is expanded, then the same error `Alert` remains visible (not duplicated) and no stale item list or empty-state text appears in its place.
- Given the bucket-list fetch succeeds, when the panel renders, then the count line appears as before and no `Alert` is present.
- Given a row's edit or delete button receives keyboard focus, when `:focus-visible` matches, then that button shows a `2px solid` outline in the `tokens.ink` color with `2px` offset.
- Given a rendered row, when the edit and delete buttons are inspected, then the computed gap between them is `8px`.

## Verification

**Commands:**
- `cd travelplan && npx vitest run test/tripBucketListPanel.test.tsx` -- expected: all tests pass, including new ones
- `cd travelplan && npx tsc --noEmit` -- expected: no type errors
- `cd travelplan && npx eslint src/components/features/trips/TripBucketListPanel.tsx` -- expected: no lint errors

## Spec Change Log

## Review Triage Log

### 2026-08-09 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 3 (low 3, medium 0, high 0)
- defer: 2 (low 2, medium 0, high 0)
- reject: 6 (low 6, medium 0, high 0)
- addressed_findings:
  - `[low]` `[patch]` Blind Hunter: the new `focusVisibleOutline` test helper re-implemented the CSSOM stylesheet walk that `test/helpers/emotionStyles.ts` already provides (`visitRulesFor`), creating the second divergent copy that helper's own docblock says it exists to prevent. Extended `emotionStyles.ts` with a reusable `emotionPseudoClassStyle(element, pseudoClass)` (parameterizing `visitRulesFor` with a `selectorSuffix`) and rewired the test to use it, deleting the local duplicate.
  - `[low]` `[patch]` Blind Hunter: the edit and delete `IconButton`s each carried an identical, hand-duplicated `sx` object (44px box + `&:focus-visible` outline), able to silently drift apart in a future one-button edit. Hoisted a shared `rowActionButtonSx` constant in the component and pointed both buttons at it.
  - `[low]` `[patch]` Blind Hunter: the new gap-width test hedged with `expect([style.gap, style.columnGap]).toContain("8px")` instead of asserting the one property jsdom actually resolves for a flex `gap` shorthand. Verified empirically (`style.gap` is `"8px"`, `columnGap`/`rowGap` are empty) and simplified the assertion to `expect(style.gap).toBe("8px")`.
  - `[low]` `defer` Blind Hunter: a persisted load-error `Alert` (now always visible per DW-48) offers no retry action — `loadItems` only runs once from a mount effect. Pre-existing, out of DW-48/DW-50's scope; not written to `deferred-work.md` per this run's explicit "do not edit the ledger" instruction — flagged here for the orchestrator to record.
  - `[low]` `defer` Blind Hunter: `resolveApiError`'s mapped codes (`unauthorized`, `csrf_invalid`, `server_error`, `invalid_json`, `forbidden`) remain untested at the bucket-list load site — the new coverage only exercises the unmapped-code fallback. Pre-existing gap (the switch is unchanged by this fix, only its rendering position moved); not written to `deferred-work.md` per this run's explicit "do not edit the ledger" instruction — flagged here for the orchestrator to record.
  - `[low]` `reject` Blind Hunter: hardcoded literal expected values in the new tests (`"2px solid #2B2A26"`, `"8px"`) instead of deriving from theme tokens. Consistent with this exact test file's established convention (e.g. the pre-existing "44x44 hit area" test already hardcodes `"rgb(138, 90, 43)"`) — not a deviation.
  - `[low]` `reject` Blind Hunter: `LOAD_ERROR_TEXT` hardcodes the English copy instead of importing it from `src/i18n/en.ts`. Consistent with this file's established convention of asserting literal rendered English strings throughout (e.g. `"No bucket list items yet."`, `"No coordinates selected"`) — not a deviation.
  - `[low]` `reject` Blind Hunter: claimed the sibling `TripDayBucketListPanel.tsx` has the same 2px-gap/no-focus-visible defect and is left unaddressed. Verified: that file has a single `IconButton` (add-to-day), no adjacent edit/delete pair — the claim does not hold against the actual code.
  - `[low]` `reject` Blind Hunter: `deferred-work.md` is not updated to close DW-48/DW-50. Intentional — this run's explicit instruction is that the orchestrator records resolution, not this session.
  - `[low]` `reject` Blind Hunter: the `Alert`'s live-region announcement/focus-management for screen-reader users is unverified. Speculative — MUI's `role="alert"` already gives a live-region announcement, no concrete failure demonstrated, flagged by the reviewer itself as "left as an assumption."
  - `[low]` `reject` Blind Hunter: the code comment frames 8px as "the" WCAG 2.2 fix rather than "a" conforming spacing. Phrasing nitpick, reviewer's own words call it "not consequential to the implementation."
  - Edge Case Hunter: no findings (`[]`).

## Auto Run Result

Status: done

**Summary:** Fixed DW-48 (bucket-list load errors were swallowed while the panel was collapsed, showing a lying "0 entries" header) and DW-50 (row edit/delete buttons sat 2px apart with no `:focus-visible` treatment) in `TripBucketListPanel.tsx`. Added a shared pseudo-class CSSOM test helper along the way, incidentally fixing three review-flagged patch findings.

**Files changed:**
- `travelplan/src/components/features/trips/TripBucketListPanel.tsx` -- moved the `loadError` `Alert` outside `Collapse`, gated the header count line and `emptyState` on `!loadError`, widened the row-action gap to 8px, hoisted a shared `rowActionButtonSx` with a `&:focus-visible` outline for both edit/delete `IconButton`s
- `travelplan/test/tripBucketListPanel.test.tsx` -- added coverage for load-error-while-collapsed, load-error-while-expanded (no duplicate alert, no stale empty-state text), success path (no alert), row-action gap width, and focus-visible outlines on both row buttons
- `travelplan/test/helpers/emotionStyles.ts` -- added `emotionPseudoClassStyle(element, pseudoClass)`, generalizing the existing `visitRulesFor` walk with an optional selector suffix, so pseudo-class-scoped `sx` rules (e.g. `&:focus-visible`) can be read back out of Emotion's CSSOM without a second divergent stylesheet-walk implementation

**Review findings breakdown** (Blind Hunter + Edge Case Hunter, deduplicated):
- 3 patch (all low severity, fixed): duplicated CSSOM-walk test helper → extended shared `emotionStyles.ts` helper instead; duplicated row-button `sx` objects → hoisted to `rowActionButtonSx`; gap-width test hedged between two CSS properties → simplified to the one jsdom actually resolves
- 2 defer (both low severity): no retry action for a persisted load error; `resolveApiError`'s mapped error codes (`unauthorized`, `csrf_invalid`, `server_error`, `invalid_json`, `forbidden`) remain untested at this load site. **Not written to `deferred-work.md`** per this run's explicit instruction that the orchestrator records ledger resolution — both are detailed in the Review Triage Log above for the orchestrator to add.
- 6 reject: hardcoded literal test assertions and hardcoded English copy (both consistent with this test file's established convention), a mischaracterized claim about `TripDayBucketListPanel.tsx` sharing the gap defect (verified false — that file has only one `IconButton`), the ledger not being updated (intentional), unverified screen-reader/focus-management speculation, and a phrasing nitpick in a code comment.

**Verification performed:**
- `npx vitest run test/tripBucketListPanel.test.tsx` -- 26/26 passed
- `npx vitest run test/docChip.test.tsx test/tripTimelineRoles.test.tsx` -- 26/26 passed (regression check on the other two consumers of `test/helpers/emotionStyles.ts`)
- `npx tsc --noEmit` -- no errors
- `npx eslint src/components/features/trips/TripBucketListPanel.tsx test/tripBucketListPanel.test.tsx test/helpers/emotionStyles.ts` -- 0 errors, 2 pre-existing warnings on untouched lines

**Residual risks:** Low. The two deferred findings (no retry affordance, untested mapped error codes) are both pre-existing and low severity — they don't regress from this change, they're just now easier to notice because the error is more visible. `theme.ts` was verified untouched, so DW-65's app-wide `MuiIconButton` scope remains clean for whoever picks it up next.

**Commit:** `a8ef304` — "sweep trip-bucket-list-panel-error-and-a11y-fix: DW-48, DW-50 via bmad-dev-auto"
