---
title: 'React hooks effect hygiene: remount the trip dialogs per open (DW-3, DW-211)'
type: 'refactor'
created: '2026-08-08'
status: 'done'
baseline_revision: 'd30735b'
final_revision: '72aeb28'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: [multiple-goals, oversized]
---

<intent-contract>

## Intent

**Problem:** Four trip dialogs are mounted permanently by their parents and visibility is driven by an `open` prop, so each one carries a hand-maintained reset-on-open effect that clears a cluster of setters — the genuine `react-hooks/set-state-in-effect` anti-pattern DW-3 kept, and the reason `eslint.config.mjs` still downgrades that rule across 12 files. Two of those effects additionally answer `exhaustive-deps` with a blanket `eslint-disable-next-line` to keep `language` out of their deps (DW-211), which switches the rule off for every other reactive value those ~35- and ~100-line effects read.

**Approach:** Give each dialog a fresh mount per open — the parent passes a `key` that changes on the open edge — so the reset clusters become plain initial state and can be deleted. In `TripDayPlanDialog` the one effect that must survive (it re-seeds once the TipTap instance appears) reads `language` from a ref captured at mount, so its blanket suppression goes too; in `TripAccommodationDialog` the whole seed effect disappears into `useForm`'s existing `defaultValues`. Then narrow the scoped `"warn"` in `eslint.config.mjs` to exactly the files that still report, with a comment recording what those remaining sites are.

## Boundaries & Constraints

**Always:**
- Remount on the **open edge only** — the instance must survive close so MUI's exit transition still plays, and mount with `open` already true so the enter transition plays.
- Every state the deleted reset cluster cleared must reach the same value through a `useState` initial value (lazy initializer where it is derived from props) or, for react-hook-form, through `useForm({ defaultValues })`.
- Preserve each dialog's dirty/discard baseline exactly: `TripDayPlanDialog.openFingerprint`, `TripAccommodationDialog`'s `isDirty` measured against the form defaults plus `openLocationKey`, `TripDayTravelSegmentDialog.openedValues`, `TripShareDialog.dirtyFields`.
- Seeded values keep capturing `language` **at open time**, not reactively; the cost-field placeholders stay live-reactive.
- Rewrite, do not delete, the "this dialog is never unmounted" comments — after this change they are false and would mislead the next reader.
- `eslint.config.mjs`'s `files:` list must be derived from an actual lint run, not from this spec.

**Block If:**
- Removing a reset cluster cannot be made green without changing user-visible dialog behaviour (e.g. a test proves state must persist across a close/reopen of the *same* entity).
- The lint run after the change reports a `set-state-in-effect` site in a file **not** already in the current 12-file list.

**Never:**
- Do not unmount the dialogs on close (no `{open && <Dialog/>}`), do not add `keepMounted`, and do not touch the guarded async-load effects, `TripDayPlanDialog`'s payment-normalisation effects, or any of the other eight files in the eslint list.
- Do not edit `_bmad-output/implementation-artifacts/deferred-work.md`.
- Do not mutate or read a ref during render (`react-hooks/refs`); the new hook must be pure render-phase state adjustment.
- Do not blanket-downgrade any rule, and do not add new `eslint-disable` comments.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Open edge | `open` goes `false` → `true` | `useOpenInstanceKey` returns a new key; dialog remounts with `open` true | No error expected |
| Close edge | `open` goes `true` → `false` | Key unchanged; same instance closes and its exit transition plays | No error expected |
| Steady state | `open` unchanged across renders | Key unchanged; no remount, no state loss mid-edit | No error expected |
| Carry-over hazard | Stay/activity A opened, a place candidate list left unanswered, closed, stay/activity B opened | B's dialog shows no candidates, tab back on the first tab, no staged photos or documents, no pre-selected move target | No error expected |
| Language switch mid-edit | Dialog open with typed edits, UI language toggled | Seeded values and the dirty baseline are unchanged; no discard prompt on an untouched form | No error expected |
| Seed before editor | `TripDayPlanDialog` mounts with `editor === null` | Raw content stored, then re-seeded canonically and `openFingerprint` re-taken when the instance appears | No error expected |

</intent-contract>

## Code Map

- `travelplan/src/components/ui/DialogShell.tsx` -- the shell all four dialogs already import; new `useOpenInstanceKey` belongs beside it (note: `useDiscardGuard` actually lives in `DiscardChangesDialog.tsx`)
- `travelplan/src/components/features/trips/TripDayView.tsx` -- mounts `TripAccommodationDialog` ×2 (`:3749`, `:3760`), `TripDayTravelSegmentDialog` (`:3771`), `TripDayPlanDialog` (`:3791`), all inside `{detail && day && (…)}`
- `travelplan/src/components/features/trips/TripTimeline.tsx` -- mounts `TripShareDialog` (`:1046`) inside `{detail && (…)}`
- `travelplan/src/components/features/trips/TripDayPlanDialog.tsx` -- reset cluster + seed effect `:821-923`, blanket suppression `:922`, `openFingerprint` `:600/:913/:1466`, `language` from `useI18n()` `:580`
- `travelplan/src/components/features/trips/TripAccommodationDialog.tsx` -- seed effect `:590-655` (12 setters + `reset()`), blanket suppression `:654`, duplicate seed already in `useForm` defaults `:437-473`, guard `:1711-1720`
- `travelplan/src/components/features/trips/TripDayTravelSegmentDialog.tsx` -- reset effect `:323-336`, `openedValues` memo `:283-295`, close-only ref cleanup `:530-535`
- `travelplan/src/components/features/trips/TripShareDialog.tsx` -- `!open` reset branch `:192-206` inside the loader effect `:191-265`
- `travelplan/eslint.config.mjs` -- scoped `"warn"` block, `files:` list of 12
- `travelplan/test/tripDayPlanDialog.test.tsx:3460`, `travelplan/test/tripAccommodationDialog.test.tsx:2090` -- carry-over tests that `rerender` the *same* instance and therefore depend on the reset effects
- `travelplan/test/dialogCloseAffordance.test.tsx`, `travelplan/test/travelSegmentDialog.test.tsx`, `travelplan/test/tripShareDialog.test.tsx`, `travelplan/test/tripTimelineSharing.test.tsx` -- regression surface

## Tasks & Acceptance

**Execution:**
- [x] `travelplan/src/components/ui/DialogShell.tsx` -- export `useOpenInstanceKey(open: boolean): number`, implemented as render-phase state adjustment over a single `useState({ open, key })` (no refs), returning a key that increments only on the `false → true` edge -- one shared, testable definition of "this open is a new instance"
- [x] `travelplan/src/components/features/trips/TripDayView.tsx` -- call the hook once per dialog (`stayOpen`, `previousStayOpen`, `segmentDialogOpen`, `planDialogMode !== null`) and pass the result as `key` on the four call sites -- makes every open a fresh instance without touching any of the ~9 opener call sites
- [x] `travelplan/src/components/features/trips/TripTimeline.tsx` -- same for `TripShareDialog` / `shareOpen`
- [x] `travelplan/src/components/features/trips/TripDayTravelSegmentDialog.tsx` -- delete the reset effect; seed the nine states with lazy initializers from `openedValues`, and `seededLinkRef`/`routePrefilledRef` from their open-time values; drop the now-dead close-only `autoPrefillTriggeredRef` cleanup -- removes the file's only `set-state-in-effect` site
- [x] `travelplan/src/components/features/trips/TripShareDialog.tsx` -- delete the eight setters in the `!open` branch (their `useState` initials already match); keep the `generationRef`/`removedIdsRef` cleanup on close, moving it to its own `[open]` effect if that keeps the loader effect readable -- removes the file's only site while preserving the in-flight-response guard
- [x] `travelplan/src/components/features/trips/TripAccommodationDialog.tsx` -- delete the seed effect whole: the 12 setters become `useState` initials (lazy for `resolvedLocation` and `locationQuery`), the `reset({…})` is already duplicated verbatim in `useForm`'s `defaultValues`; the blanket `exhaustive-deps` suppression goes with it -- resolves DW-211 for this file without needing a language ref
- [x] `travelplan/src/components/features/trips/TripDayPlanDialog.tsx` -- delete the 12-setter reset cluster (`:822-846`), moving `loadingInit`'s initial value to `true`; keep only the seed half of the effect, reading `language` from a `useRef(language)` captured at mount instead of from the closure, and delete the blanket `exhaustive-deps` suppression so the rule stays live for the rest of the effect -- resolves DW-211 for this file and removes the reset anti-pattern while preserving the editor-appears re-seed
- [x] `travelplan/eslint.config.mjs` -- after a real lint run, narrow `files:` to exactly the files that still report `react-hooks/set-state-in-effect`, and replace the comment with an accurate account: the remaining sites are async data-load effects (some guarded with a cancel flag, where the rule is a known false positive; the rest set loading/result state after an await) plus `TripDayPlanDialog`'s payment normalisation and its editor-appears re-seed -- so the next reader does not re-derive it
- [x] `travelplan/test/dialogOpenInstanceKey.test.tsx` (new) -- unit-test `useOpenInstanceKey` against the first three I/O Matrix rows
- [x] `travelplan/test/tripDayPlanDialog.test.tsx`, `travelplan/test/tripAccommodationDialog.test.tsx` -- update the two carry-over tests to drive a changing `key` the way the parent now does, with a comment naming where the contract moved; keep the assertions unchanged

**Acceptance Criteria:**
- Given the four dialogs, when `npx eslint --format json .` is run from `travelplan/`, then `react-hooks/set-state-in-effect` reports no site in `TripDayTravelSegmentDialog.tsx` or `TripShareDialog.tsx`, and no site at the former reset clusters in `TripDayPlanDialog.tsx` or `TripAccommodationDialog.tsx`.
- Given `eslint.config.mjs`, when the scoped block is read, then every entry in `files:` still reports at least one `set-state-in-effect` site and no reporting file is missing from the list.
- Given the whole repo, when lint is run, then `react-hooks/exhaustive-deps` reports no new site and no `eslint-disable` for it remains in `TripDayPlanDialog.tsx` or `TripAccommodationDialog.tsx`.
- Given `npm test`, when the suite runs, then it passes with no test skipped or weakened relative to `main`.
- Given a dialog opened, edited, and dismissed with `✕`, when the form differs from what it opened with, then the discard prompt still appears — and does not appear for an untouched form, including one where the language was switched while it was open.

## Spec Change Log

No bad_spec loopback occurred; this section is empty by design.

## Review Triage Log

### 2026-08-08 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 7: (high 1, medium 2, low 4)
- defer: 4: (high 0, medium 1, low 3)
- reject: 4: (high 0, medium 0, low 4)
- addressed_findings:
  - `[high]` `[patch]` All four dialogs are siblings in one children array and every `useOpenInstanceKey` counter starts at `0`, so four children were handed `key={0}` at once. Both reviewers reproduced React's duplicate-key error empirically; one measured 21 leaked instances — with undestroyed TipTap editors and un-run fetch cleanups — after 10 open/close cycles. Keys are now namespaced (`stay-`, `previous-stay-`, `segment-`, `plan-`), with the hazard recorded on the hook and at the call site.
  - `[medium]` `[patch]` `TripDayView`'s deep-link effect can call `setSelectedPlanItem` on an already-open plan dialog (a client-side nav to another `?open=plan&itemId=`), which re-seeds the form through the surviving seed effect while the previous activity's tab, staged photos, staged documents and candidate list all survive — the exact leak this story removes, arriving by another door. `useOpenInstanceKey` gained an `identity` argument, consulted only while open so the close edge (which clears the selection in the same commit) still leaves the instance alive for its exit transition.
  - `[medium]` `[patch]` Deleting `key={...}` from `TripDayView` left the whole suite green, so nothing covered the production wiring. Added a `TripDayView`-level test counting stub mounts across open → close → open, and proved it load-bearing by removing the key and observing only that test fail.
  - `[low]` `[patch]` The `eslint.config.mjs` inventory advertises itself as saving the next reader from re-deriving the list, then omitted `TripDayView`'s bucket-list load — one of the unguarded async loads it flags as real findings. Corrected.
  - `[low]` `[patch]` `TripShareDialog` kept `reset(defaultValues)` on the close edge after its eight setters were deleted, making it the only visible mutation there: the invite fields would blank while the collaborator list and banners stayed populated, fading out half-cleared. Removed; the ref guards it sat beside are retained.
  - `[low]` `[patch]` The hook's test omitted the one row that holds for a different reason than the others — a first render with `open` already true. Added, plus two rows for `identity`.
  - `[low]` `[patch]` `TripDayPlanDialog`'s seed-effect comment claimed all twelve deleted setters had their reasons moved onto the declarations; four had not. Claim narrowed to the three that record shipped defects.

### 2026-08-08 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 7: (high 0, medium 1, low 6)
- defer: 5: (high 0, medium 1, low 4)
- reject: 13: (high 0, medium 0, low 13)
- addressed_findings:
  - `[medium]` `[patch]` Only one of the five `key` call sites was covered. The previous pass added a `TripDayView`-level test for the plan dialog and proved it load-bearing, but deleting `key` from the current-stay, previous-stay or segment call site — or from `TripShareDialog`'s in `TripTimeline` — still left the whole suite green, on the four dialogs whose reset effects had just been deleted. Added a mount-per-open test per remaining site (`tripDayViewLayout.test.tsx` ×2, new `tripTimelineShareInstanceKey.test.tsx`), each verified by removing the key and observing exactly that test fail (`expected 1 to be 2`). The stay test reads both counters after every step, so it also fails if the two stay dialogs are ever given the same namespace.
  - `[low]` `[patch]` The plan dialog's `identity` was `selectedPlanItem?.id ?? "add"`, which names two different bucket-list ideas identically: `handleAddBucketToDay` sets a new prefill with `selectedPlanItem` at `null`, so a second idea opened over the first would reuse its instance — the leak the identity argument was added to close, through the one door it left open. Unreachable today only because the modal covers the bucket panel. Identity now falls through to `planDialogPrefill?.bucketListItemId`.
  - `[low]` `[patch]` `TripTimeline` passed the bare number as `key` where `TripDayView` namespaces. It is the only keyed dialog on that screen so nothing collides, but its two unkeyed siblings sit in the same array and every counter starts at `0` — the first of them to be keyed reproduces the duplicate-key failure the previous pass fixed. Namespaced to `share-…`, with the reason at the hook call.
  - `[low]` `[patch]` `TripShareDialog`'s loader effect still listed `reset` after the `reset(defaultValues)` it existed for was removed from the `!open` branch — a dependency nothing in the effect reads, in a file this story touched for dependency hygiene. Removed, with a note on why it was there.
  - `[low]` `[patch]` `TripAccommodationDialog`'s new seed comment claimed `openLocationKey` and the lazy seeds "cannot drift apart". They can: the seeds freeze at mount and `openLocationKey` re-derives from the live `day` prop. Narrowed to what actually holds, and the condition it rests on recorded as DW-265.
  - `[low]` `[patch]` `eslint.config.mjs`'s inventory named `TripImportDialog`'s surviving reset cluster but attached no ticket, unlike the DW-211 reference three lines above — describing a permanent state of affairs rather than a tracked one. Now points at DW-266.
  - `[low]` `[patch]` `dialogOpenInstanceKey.test.tsx` did not cover an identity that changes while the dialog is *closed* — the gap between its two identity rules, where the recorded identity goes stale by design. Added, asserting the open edge records it and bumps exactly once.

## Design Notes

The dialogs were deliberately never unmounted, and the reset clusters are the scar tissue for that: comments at `TripDayPlanDialog.tsx:830-838` and `TripAccommodationDialog.tsx:604-616` each record a shipped defect where staged photos, documents, or an unanswered place-candidate list leaked from one entity's dialog into the next. Keying on the open edge removes the cause rather than the symptom, and keeps both transitions:

```tsx
export function useOpenInstanceKey(open: boolean): number {
  const [instance, setInstance] = useState({ open, key: 0 });
  if (open !== instance.open) {
    setInstance({ open, key: open ? instance.key + 1 : instance.key });
  }
  return instance.key;
}
```

Render-phase adjustment, not an effect, so `set-state-in-effect` does not apply and no ref is read during render. The key changes in the same commit as `open` flipping true, so the new instance mounts already-open (enter transition plays) and the close leaves the key alone (exit transition plays on the surviving instance).

DW-211 asked for a `language` ref in both dialogs. It is still the right shape in `TripDayPlanDialog`, whose seed effect must survive to re-run when the TipTap instance appears (`TripDayPlanDialog.tsx:774-802`). In `TripAccommodationDialog` the effect disappears entirely, so mount-time initialisation captures the open-time language by construction and no ref is needed — strictly better than the recorded plan, and noted here so the deviation is not read as an omission.

## Verification

**Commands:**
- `cd travelplan && npx eslint --format json .` -- expected: no new errors; `set-state-in-effect` count drops from 21 by exactly the removed clusters, with zero sites outside the narrowed `files:` list
- `cd travelplan && npm test` -- expected: full Vitest suite green
- `cd travelplan && npx tsc --noEmit` -- expected: no new error in any touched file (the repo has a known non-zero baseline, DW-95)

## Auto Run Result

Status: done

### Implemented change

Follow-up review pass over the already-shipped change (`d30735b..09feeb9`). No intent gap and no spec defect: the mount-per-open design holds, and neither reviewer found a behavioural regression in it. What this pass fixed is the gap between what the design depends on and what anything checks — four of the five `key` call sites had no test, so the mechanism that replaced four deleted reset effects could have been removed silently — plus three small correctness/hygiene holes in the wiring and two comments that claimed more than the code does.

### Files changed (this pass)

- `travelplan/src/components/features/trips/TripDayView.tsx` -- the plan dialog's instance identity falls through to the bucket-list prefill, so two different ideas are two instances
- `travelplan/src/components/features/trips/TripTimeline.tsx` -- share dialog key namespaced to `share-…`, with the sibling-collision reason at the hook call
- `travelplan/src/components/features/trips/TripShareDialog.tsx` -- orphaned `reset` dependency removed from the loader effect
- `travelplan/src/components/features/trips/TripAccommodationDialog.tsx` -- seed comment narrowed to what holds, pointing at DW-265 for what does not
- `travelplan/eslint.config.mjs` -- the `TripImportDialog` line now points at DW-266
- `travelplan/test/tripDayViewLayout.test.tsx` -- mount counters on the stay and segment stubs; one test per remaining `TripDayView` call site
- `travelplan/test/tripTimelineShareInstanceKey.test.tsx` (new) -- the same for `TripShareDialog`, in its own file because the existing sharing suite renders the real dialog end to end
- `travelplan/test/dialogOpenInstanceKey.test.tsx` -- the identity-changed-while-closed row
- `_bmad-output/implementation-artifacts/deferred-work.md` -- DW-264 … DW-268 appended (new entries only; no existing entry read, re-opened or rewritten)

### Review findings

7 patches applied (1 medium, 6 low) — see the Review Triage Log. 5 deferred as DW-264 (language switch destroys an open dialog through `TripDayView`'s loading skeleton — pre-existing, and the reason the `languageAtOpen` machinery is unobservable in composition), DW-265 (`TripAccommodationDialog` seeds once per mount but measures dirtiness against the live `day`; latent behind DW-264), DW-266 (`TripImportDialog` still carries the reset cluster), DW-267 (no dialog-level close-and-reopen test for the segment and share dialogs), DW-268 (`prefillRouteOnOpen` has no caller anywhere).

13 rejected. The two worth naming, because both were argued as regressions and neither is: deleting `setLoading(false)` and `setRemovingMemberIds([])` from `TripShareDialog`'s close edge was called a "spinner fading out instead of content", but restoring them re-creates exactly the visible mid-exit mutation the `reset(defaultValues)` removal was accepted for — a stable spinner fading out beats a body that swaps to an empty list for 195ms. The rest were design consequences already recorded in the I/O matrix (two-pass seed per open, TipTap rebuilt per open), pre-existing conditions (the `tsc`/`eslint` baselines, the `vi.unstubAllGlobals()` placement this file has used throughout), or module-placement and comment-density preferences the spec's Code Map and the repo's conventions already settle.

### Verification performed

- `npm test` -- 134 files, 1990 tests, all passing, none skipped (133/1986 before this pass: +1 file, +4 tests).
- Each new test proven load-bearing by deleting the key it guards and re-running: `stay-`, `previous-stay-`, `segment-` and `share-` each produce exactly one failure, `expected 1 to be 2`, in exactly the new test. Keys restored and re-verified in place afterwards.
- `npx eslint --format json .` -- 2 errors, 79 warnings; `set-state-in-effect` 17 across the same 10 files, `exhaustive-deps` 7 at the same lines. Identical to the pre-pass state, so removing the `reset` dependency introduced nothing and the narrowed `files:` list is still exact.
- `npx tsc --noEmit` -- 164 errors, and 9 in `tripDayViewLayout.test.tsx`, both identical to the pre-pass baseline measured by stashing this pass's changes and re-running. The new test file contributes none.

### Residual risks

- Still not verified in a browser. The transition argument (enter on the new instance, exit on the surviving one) rests on the keying and the hook's unit tests; jsdom does not run MUI transitions.
- DW-264 and DW-265 are related and one masks the other: the loading skeleton that destroys an open dialog is also what keeps `TripAccommodationDialog`'s stale-seed divergence unreachable. Whoever fixes the first should read the second in the same sitting, or fixing a real bug will expose a latent one.
- `TripDayPlanDialog` still builds and tears down a TipTap editor per open. Unchanged by this pass, no latency measured.
