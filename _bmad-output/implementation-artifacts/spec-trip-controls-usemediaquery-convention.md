---
title: 'Trip-controls useMediaQuery: sanctioned exception + focus restore across the md remount'
type: 'bugfix'
created: '2026-08-09'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
baseline_revision: '399d2ae9354571a31da4bf7ec9ec556ad88948a1'
final_revision: '91bea06b61b5c2e109ae561be1d61801912bec76'
---

<intent-contract>

## Intent

**Problem:** `TripTimeline.tsx`'s `isTwoColumnLayout` (`useMediaQuery`) decides which of two JSX slots mounts the trip-controls card, contradicting the "pure sx breakpoints, never `useMediaQuery`" comment repeated in `DialogShell.tsx`, `AuthScreenShell.tsx` and `TripCreateForm.tsx` (DW-106). Because the two slots are different React tree positions, crossing `md` unmounts the card in one slot and mounts a fresh instance in the other; a keyboard user focused on "Edit trip", "Delete trip" or "Export backup" loses focus to `<body>` when that happens, e.g. on tablet rotation (DW-107).

**Approach:** Per the 2026-08-08 decision recorded against DW-106, write the exception where the three convention comments live: `useMediaQuery` may decide *which subtree mounts*, never how a mounted one looks; name the trip-controls card as the case. For DW-107, keep the two-mount-point design (already justified in `TripTimeline.tsx`'s existing comment above `tripControlsCard` — a single CSS `order`-based mount point cannot cross grid parents) and instead track which of the card's three buttons last held focus, then restore focus to that button's new instance when a re-render leaves `document.activeElement` on `<body>`.

## Boundaries & Constraints

**Always:**
- Update all three existing "pure sx breakpoints, never useMediaQuery" comments (`DialogShell.tsx:233`, `AuthScreenShell.tsx:192`, `TripCreateForm.tsx:520`) so none of them contradict `TripTimeline.tsx`'s code; each should state the narrowed rule (styling stays pure-sx; a breakpoint that decides which subtree mounts is sanctioned) rather than a blanket "never".
- Add the exception statement itself at `TripTimeline.tsx`'s `isTwoColumnLayout` declaration (~line 159), naming the 2026-08-08 decision and DW-106/DW-107, since that is the one call site the exception actually covers.
- Restore focus only when it would otherwise land on `<body>` as a direct result of the mount-point swap — never steal focus from an element the user is still interacting with elsewhere in the tree.
- Preserve the existing DOM output, props and behavior of the three buttons (Edit/Delete/Export) for every case that isn't the focus-loss transition itself.

**Block If:** None identified — the decision and fix approach are both already fixed by the 2026-08-08 ledger decision.

**Never:**
- Do not touch `isNarrowLayout` (`TripTimeline.tsx:155`) or the `data-layout` attribute it drives — that is DW-14's separate, still-open concern about a cosmetic attribute re-deriving the breakpoint, not this bundle's scope.
- Do not consolidate the trip-controls card to a single mount point — `TripTimeline.tsx`'s existing comment above `tripControlsCard` already establishes why a pure-sx `order`/`gridColumn` alternative reopens a visible sidebar-height gap at `md`+; the 2026-08-08 decision sanctions the two-mount-point mechanism rather than replacing it.
- Do not attempt to make the jsdom `matchMedia` harness in `test/tripTimelineRoles.test.tsx` fire real "change" events to drive the crossing through MUI's own `useMediaQuery` subscription — that gap is explicitly reserved for the browser-level (Playwright) pass DW-14 already owns; this fix's regression test may mock `useMediaQuery` directly instead.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Edit button focused, crosses `md` downward | `isTwoColumnLayout: true → false` while "Edit trip" is `document.activeElement` | New "Edit trip" instance (single-column slot) receives focus; `document.activeElement` is never left on `<body>` | N/A |
| Delete or Export button focused, crosses `md` | Same transition, focus on "Delete trip" or "Export backup" | Same button's new instance receives focus | N/A |
| No control focused when crossing `md` | Focus outside the card (e.g. a day row link) when the breakpoint flips | Focus is left exactly where it was; nothing is stolen | N/A |
| Card absent (viewer role) | `canEditPlanning` and `isOwner` both false, breakpoint flips | No-op: nothing to restore, no thrown error from a null ref | N/A |

</intent-contract>

## Code Map

- `travelplan/src/components/features/trips/TripTimeline.tsx:159` -- `isTwoColumnLayout` declaration: add the sanctioned-exception comment naming the 2026-08-08 decision.
- `travelplan/src/components/features/trips/TripTimeline.tsx:448-519` -- `tripControlsCard`: add refs on the three buttons, an `onFocus` per button recording which one is focused, and a `useEffect` keyed on `isTwoColumnLayout` that restores focus when it was lost to `<body>`.
- `travelplan/src/components/ui/DialogShell.tsx:231-233` -- update the convention comment.
- `travelplan/src/components/features/auth/AuthScreenShell.tsx:189-193` -- update the convention comment.
- `travelplan/src/components/features/trips/TripCreateForm.tsx:518-523` -- update the convention comment.
- `travelplan/test/tripTimelineControlsFocus.test.tsx` (new) -- regression test driving the crossing via a mocked `useMediaQuery` (see Never: does not touch the `matchMedia` harness in `tripTimelineRoles.test.tsx`).

## Tasks & Acceptance

**Execution:**
- [x] `travelplan/src/components/features/trips/TripTimeline.tsx` -- add the sanctioned-exception comment at the `isTwoColumnLayout` declaration, naming DW-106 and the 2026-08-08 decision -- resolves DW-106's "write the exception down" instruction at its one real call site.
- [x] `travelplan/src/components/features/trips/TripTimeline.tsx` -- add `editButtonRef`/`deleteButtonRef`/`exportButtonRef` (`useRef<HTMLButtonElement>(null)`) and a `lastFocusedControlRef` (`useRef<"edit" | "delete" | "export" | null>(null)`); wire each of the three buttons with its `ref` and an `onFocus` that sets `lastFocusedControlRef.current`; add a `useEffect` keyed on `[isTwoColumnLayout]` that, when `lastFocusedControlRef.current` is set and `document.activeElement === document.body`, calls `.focus()` on the matching ref's current node -- resolves DW-107. (Refs/effect placed next to `isTwoColumnLayout`, ahead of the component's `loading`/`notFound` early returns, rather than beside `tripControlsCard` as first sketched — that region is downstream of the early returns and hooks there would violate rules-of-hooks. Cross-reference comments left at both spots.)
- [x] `travelplan/src/components/ui/DialogShell.tsx` -- reword the comment at line ~233 to state the narrowed rule instead of a blanket "never useMediaQuery".
- [x] `travelplan/src/components/features/auth/AuthScreenShell.tsx` -- reword the comment at line ~192 the same way.
- [x] `travelplan/src/components/features/trips/TripCreateForm.tsx` -- reword the comment at line ~520 the same way.
- [x] `travelplan/test/tripTimelineControlsFocus.test.tsx` -- new file: mock `@mui/material`'s `useMediaQuery` so a test can flip `isTwoColumnLayout` via `rerender`; assert that focusing "Edit trip", then crossing the breakpoint, leaves focus on the new "Edit trip" instance rather than `<body>`; add one more case for a control other than Edit (e.g. Export) to cover the ref-selection branch. Also added a third, negative case (focus outside the card is left untouched).

**Acceptance Criteria:**
- Given "Edit trip" (or Delete/Export) is focused and the layout crosses `md` in either direction, when the trip-controls card remounts at its other slot, then focus lands on the new instance of the same button, never on `<body>`.
- Given no trip-controls button is focused when the layout crosses `md`, when the card remounts, then whatever was focused beforehand stays focused.
- Given the three "pure sx breakpoints, never useMediaQuery" comments in `DialogShell.tsx`, `AuthScreenShell.tsx` and `TripCreateForm.tsx`, when read next to `TripTimeline.tsx`'s `isTwoColumnLayout`, then they no longer contradict each other — all four state the same narrowed rule.

## Design Notes

The two mount points stay: the existing comment above `tripControlsCard` (lines 448-455) already explains why a single CSS-only mount point reopens a sidebar-height gap at `md`+, and the 2026-08-08 decision sanctions the JS-mount-point mechanism rather than asking for a replacement. The fix here is narrowly about the *consequence* of that already-sanctioned unmount/remount — focus — not about avoiding the remount itself.

`lastFocusedControlRef` is never cleared on blur. The `document.activeElement === document.body` check at restore time is what keeps this safe: focus can only be on `<body>` right after this transition if the previously-focused node was just removed from the DOM (nothing else in this component's tree unmounts when `isTwoColumnLayout` changes), so a stale ref value is harmless — it only fires when there is in fact nothing else focused to protect.

## Spec Change Log

## Review Triage Log

### 2026-08-09 — Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 3 (low 3)
- defer: 0
- reject: 9 (low 9)
- addressed_findings:
  - `[low]` `[patch]` The comment justifying the never-cleared `lastFocusedControlRef` claimed a stale ref is "harmless" without qualification; both reviewers correctly noted `document.activeElement === document.body` can be true for reasons unrelated to this component's remount (e.g. a deliberate blur to blank page space), which the original wording didn't acknowledge. Reworded the comment in `TripTimeline.tsx` to name the false-positive window explicitly and explain why it's accepted rather than solved (narrower and no worse in consequence than the `<body>`-stuck bug this effect exists to fix) — no behavior change.
  - `[low]` `[patch]` The new test file's `useMediaQuery` mock returned the same boolean regardless of which query MUI called, so `isNarrowLayout` (`down("sm")`) and `isTwoColumnLayout` (`up("md")`) could report an impossible simultaneous state. Fixed: the mock now routes on the query string (`min-width` → the controlled value, everything else → `false`), matching how `tripTimelineRoles.test.tsx`'s own `setViewportWidth` already discriminates by query.
  - `[low]` `[patch]` Only the Edit and Export branches of the three-way `refByControl` restore map had regression coverage; Delete was untested. Added a fourth case mirroring the Edit/Export ones for the Delete button.
  - `[low]` `[reject]` "Export button disabled mid-request when the crossing happens makes `.focus()` a silent no-op, never retried" — real but exceptionally narrow (requires an in-flight export *and* a breakpoint crossing *and* focus on that specific button simultaneously); consequence is identical to the base bug already judged non-blocking in the DW-107 ledger entry (focus stays lost, one Tab recovers). Disproportionate to fix given how narrow it is.
  - `[low]` `[reject]` "A permission change (`isOwner`/`canEditPlanning`) coinciding with the crossing leaves a stale ref pointing at a now-`null` target" — this is exactly the "Card absent" scenario the spec's I/O & Edge-Case Matrix already names as an accepted no-op (`.current?.focus()` on `null` is a guaranteed-safe no-op by language semantics, not a runtime risk).
  - `[low]` `[reject]` "Plain `useEffect` instead of `useLayoutEffect` leaves a paint frame where focus is visibly on `<body>`" — the spec's own instructions named this exact tradeoff explicitly ("deliberate choice, don't second-guess") to avoid a real SSR warning in this "use client" component; not a miss.
  - `[low]` `[reject]` "Three inline `onFocus` closures are reallocated every render" — idiomatic React, negligible cost for three buttons; not worth the indirection of memoizing them.
  - `[low]` `[reject]` "The sanctioned-exception explanation is now duplicated across four files instead of one shared doc" — matches this codebase's established convention (no `CONVENTIONS.md`/`CLAUDE.md` exists; every one of the three pre-existing comments already carried its own local copy before this change) rather than a gap this bundle introduced.
  - `[low]` `[reject]` "The fix is bespoke to these three buttons rather than extracted into a reusable focus-restore hook" — premature abstraction for the pattern's one current call site.
  - `[low]` `[reject]` "The restore effect's dependency array doesn't include `canEditPlanning`/`isOwner`" — the effect never reads those values, and the behavior when they change is the same accepted no-op as the permission-change finding above; no actual defect.
  - `[low]` `[reject]` "Redundant `not.toBe(document.body)` assertions after already asserting the new button has focus" — harmless defensive redundancy, common test style, not worth the diff.
  - `[low]` `[reject]` "No test covers a viewer role, where the card and all three refs are absent" — overlaps the permission-change finding above; `.current?.focus()` on a `null` ref is guaranteed safe by language semantics, so there is no behavior left to verify at runtime.

## Verification

**Commands:**
- `cd travelplan && npm run typecheck` -- expected: no new type errors.
- `cd travelplan && npm run lint` -- expected: clean.
- `cd travelplan && npx vitest run test/tripTimelineControlsFocus.test.tsx test/tripTimelineRoles.test.tsx` -- expected: all pass, including the new focus-restore cases.

## Auto Run Result

Status: done

**Summary:** Resolves DW-106 and DW-107. `TripTimeline.tsx`'s `isTwoColumnLayout` now carries a comment naming it the sanctioned exception (2026-08-08 decision) to "pure sx breakpoints, never useMediaQuery" — a breakpoint may decide which subtree mounts, never how a mounted one looks — and the three other convention comments (`DialogShell.tsx`, `AuthScreenShell.tsx`, `TripCreateForm.tsx`) are reworded to the same narrowed rule so none of the four contradict each other anymore. Separately, crossing `md` unmounts the trip-controls card at one JSX slot and mounts a fresh instance at the other (two different React tree positions), which previously dropped keyboard focus to `<body>` if the user had "Edit trip", "Delete trip" or "Export backup" focused. Fixed by tracking which of the three buttons last held focus and restoring it via a `useEffect` keyed on `isTwoColumnLayout`, scoped to fire only when focus has actually landed on `<body>` so it never steals focus from something else in the tree.

**Files changed:**
- `travelplan/src/components/features/trips/TripTimeline.tsx` — sanctioned-exception comment at `isTwoColumnLayout`; three button refs + `lastFocusedControlRef` + restore `useEffect`, placed ahead of the component's early returns per rules-of-hooks; `ref`/`onFocus` wired onto the Edit/Delete/Export buttons.
- `travelplan/src/components/ui/DialogShell.tsx`, `travelplan/src/components/features/auth/AuthScreenShell.tsx`, `travelplan/src/components/features/trips/TripCreateForm.tsx` — reworded the "pure sx breakpoints, never useMediaQuery" comment to the narrowed rule; no code behavior changed.
- `travelplan/test/tripTimelineControlsFocus.test.tsx` (new) — 4 regression cases: focus restored across the crossing for each of Edit/Delete/Export, and a negative case proving focus outside the card is left untouched. Drives the crossing via a query-aware `useMediaQuery` mock rather than the `matchMedia`-based harness in `tripTimelineRoles.test.tsx`, which cannot fire a live change event (see that file's own note).

**Review findings:** 3 patch (all applied, all low), 9 reject (all low), 0 defer, 0 bad_spec, 0 intent_gap. Both Blind Hunter and Edge Case Hunter independently flagged the same core tension — `lastFocusedControlRef` is never cleared, so `document.activeElement === document.body` is a heuristic for "this remount just happened," not a proof — and the original comment overstated that heuristic as certain. Fixed by rewording the comment to name the narrow false-positive window and why it's accepted (same or better outcome than the pre-fix `<body>`-stuck bug, still narrower than the case this effect targets). Also patched: the new test's `useMediaQuery` mock answered every query identically, letting `isNarrowLayout` and `isTwoColumnLayout` report an impossible simultaneous state — now routes on the query string; and the Delete button had no direct regression coverage — added a fourth test case. Nine findings rejected: several described consequences already explicitly named as accepted no-ops in this spec's own I/O & Edge-Case Matrix (permission change mid-crossing, viewer role) or explicitly pre-decided tradeoffs in the spec's own instructions (plain `useEffect` over `useLayoutEffect`); the rest were premature-abstraction or cosmetic-style suggestions (extracting a reusable hook for a single call site, memoizing three trivial closures, consolidating four independently-commented call sites into a shared doc this codebase doesn't have) disproportionate to a low-severity, narrow-trigger fix.

**Verification:** `npm run typecheck` clean; `npm run lint` clean (0 errors, 79 warnings — identical to the pre-change baseline, confirmed by diff); `npx vitest run test/tripTimelineControlsFocus.test.tsx test/tripTimelineRoles.test.tsx` — 2 files, 25/25 passing (21 pre-existing + 4 new).

**Residual risk:** Low. The accepted false-positive window (a stale `lastFocusedControlRef` re-focusing a control after an unrelated, deliberate blur to `<body>`) is documented in code rather than eliminated — narrower than, and no worse in consequence than, the bug DW-107 opened against. `isNarrowLayout`/`data-layout` (DW-14) remains untouched and open, as scoped.
