---
title: 'Singular twins for the count keys that still render "1 days"'
type: 'bugfix'
created: '2026-08-15'
status: 'done'
baseline_revision: 'f37e6d4'
final_revision: 'b262945'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: [oversized]
---

<intent-contract>

## Intent

**Problem:** `formatMessage` (`src/i18n/index.ts:55-59`) is a plain `{key}` regex substituter with no plural support, so a count-bearing key has exactly one wording. Three keys are still consumed unguarded and render ungrammatically at `count === 1`: `trips.dashboard.dayCount` → "1 days" / "1 Tage" (dashboard row subtitle and timeline Duration tile), `trips.bucketList.countLine` → "1 entries" / "1 Einträge" (the collapsed card's default state), and `trips.create.success` → "Trip created with 1 days." / "Reise mit 1 Tagen erstellt." (found by sweeping every `{count}` key).

**Approach:** Follow the singular-twin convention this codebase already uses seven times over (`statusGapOne`, `sublineOne`, `mapCaptionOne`, `missingLocationsOne`, `showMoreImagesOne`, `showMoreDocumentsOne`): add a sibling `…One` key holding a hardcoded literal to both dictionaries, and branch on `count === 1` at each call site. Do not introduce a plural helper — a second mechanism beside seven existing twins would be the inconsistency, not the fix.

## Boundaries & Constraints

**Always:** Add every new key to BOTH `en.ts` and `de.ts` (`i18nDictionaries.test.ts:22-27` asserts key-set parity). Place each twin immediately after its plural sibling. `…One` values contain a literal `1` and NO `{count}` placeholder. Branch shape at the call site mirrors `TripsDashboard.tsx:241-243`: `count === 1 ? t("…One") : formatMessage(t("…"), { count })`.

**Block If:** The sweep turns up a count key whose correct singular is not derivable from the existing en/de wording.

**Never:** Do not touch `formatMessage`, `translate`, or the provider — no ICU/plural-rules engine. Do not change the existing plural strings' wording. Do not change `trips.gallery.selectedFiles` / `trips.documents.selectedFiles`: their `{count} file(s)` form is a deliberate, documented choice for visible-only labels (see the contrasting comments at `en.ts:734-735` and `en.ts:766-767`). Do not touch keys where the count sits in parentheses and reads correctly at any value (`trips.share.accessLabel`, `trips.location.resultsLabel`, `users.registered.countLabel`, `admin.users.countLabel`), nor `trips.import.issuesTruncated` ("and 1 more" / "und 1 weitere" are both grammatical). Do not edit the deferred-work ledger.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Dashboard row, one-day trip | `trip.dayCount === 1` | Subtitle reads `… · 1 day` (en) / `… · 1 Tag` (de) | No error expected |
| Dashboard row, multi-day trip | `trip.dayCount === 13` | Unchanged: `13 days` / `13 Tage` | No error expected |
| Timeline Duration tile, one-day trip | `detail.trip.dayCount === 1` | Tile reads `1 day` / `1 Tag` | No error expected |
| Bucket list collapsed, one item | `items.length === 1` | Count line reads `1 entry` / `1 Eintrag` | No error expected |
| Bucket list collapsed, zero items | `items.length === 0` | Unchanged: `0 entries` / `0 Einträge` | No error expected |
| Trip created spanning one day | `body.data.dayCount === 1` | Toast reads `Trip created with 1 day.` / `Reise mit 1 Tag erstellt.` | No error expected |

</intent-contract>

## Code Map

- `travelplan/src/i18n/index.ts:55-59` -- `formatMessage`; read-only, explains why twins exist
- `travelplan/src/i18n/en.ts:124,147,534` -- plural keys needing twins; `:134` is the precedent
- `travelplan/src/i18n/de.ts:120,142,499` -- German counterparts; `:129` is the precedent
- `travelplan/src/components/features/trips/TripsDashboard.tsx:687` -- `dayCount` in the row subtitle; `:241-243` is the branch precedent
- `travelplan/src/components/features/trips/TripTimeline.tsx:743` -- `dayCount` in the Duration stat tile
- `travelplan/src/components/features/trips/TripBucketListPanel.tsx:628` -- `entryCountLabel` from `items.length`
- `travelplan/src/components/features/trips/TripCreateForm.tsx:331` -- success toast from `body.data.dayCount`
- `travelplan/test/helpers/renderWithProviders.tsx` -- German is selected only via `renderWithProviders(ui, { language: "de" })`

## Tasks & Acceptance

**Execution:**
- [x] `travelplan/src/i18n/en.ts` -- add `trips.dashboard.dayCountOne` = `"1 day"`, `trips.create.successOne` = `"Trip created with 1 day."`, `trips.bucketList.countLineOne` = `"1 entry"`, each directly after its plural sibling with a one-line comment matching the existing twins' style -- gives each key a grammatical singular
- [x] `travelplan/src/i18n/de.ts` -- add the same three keys: `"1 Tag"`, `"Reise mit 1 Tag erstellt."`, `"1 Eintrag"` -- keeps en/de key parity and fixes the German wording
- [x] `travelplan/src/components/features/trips/TripsDashboard.tsx` -- branch the subtitle's `dayCount` substitution on `trip.dayCount === 1` -- the row that shows "1 days" beside a pill correctly saying "1 day open"
- [x] `travelplan/src/components/features/trips/TripTimeline.tsx` -- branch the Duration tile on `detail.trip.dayCount === 1` -- second consumer of the same key
- [x] `travelplan/src/components/features/trips/TripBucketListPanel.tsx` -- branch `entryCountLabel` on `items.length === 1` -- default collapsed state
- [x] `travelplan/src/components/features/trips/TripCreateForm.tsx` -- branch the success toast on `body.data.dayCount === 1` -- sweep finding
- [x] `travelplan/test/i18nDictionaries.test.ts` -- add a `describe` block asserting, across both dictionaries, that the three plural keys contain `{count}` and the three `…One` keys contain no `{` -- mirrors the DW-230 pattern at `:909-931`
- [x] `travelplan/test/tripsDashboard.test.tsx` -- assert the one-day row subtitle in en and de -- covers the primary DW-16 call site
- [x] `travelplan/test/tripTimelinePlan.test.tsx` -- assert the Duration tile at `dayCount: 1` in en and de -- this file currently never renders German, so add the `{ language: "de" }` render
- [x] `travelplan/test/tripBucketListPanel.test.tsx` -- assert the collapsed count line with one item in en and de -- covers DW-68
- [x] `travelplan/test/tripCreateForm.test.tsx` -- assert the success toast for a one-day trip in en and de -- covers the sweep finding

**Acceptance Criteria:**
- Given the finished change, when `npm test` runs, then it passes, including the pre-existing exact-string assertions on `"2 days"` (`tripTimelinePlan.test.tsx:974`) and `"2 entries"` (`tripBucketListPanel.test.tsx:75`), which must keep passing unmodified.
- Given a reader of `en.ts` and `de.ts`, when they scan the `{count}` keys, then every key whose count can be 1 and whose wording would be ungrammatical has an adjacent `…One` sibling, and no call site substitutes such a key without an `=== 1` branch.
- Given the change, when `git diff src/i18n/index.ts` is inspected, then it is empty — no plural engine was introduced.

## Spec Change Log

## Review Triage Log

### 2026-08-15 — Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 6: (high 0, medium 2, low 4)
- defer: 3: (high 0, medium 1, low 2)
- reject: 11: (high 0, medium 0, low 11)
- addressed_findings:
  - `[medium]` `[patch]` The plural arm of `trips.create.success` was entirely untested — inverting the new ternary to `!== 1` left the whole suite green while telling every multi-day trip it was "created with 1 day." Replaced the two singular-only cases with an `it.each` over `en/de × 1/4` days, and verified by mutation that all four fail when the condition is inverted.
  - `[medium]` `[patch]` The dashboard row subtitle's plural day count was likewise unpinned (only `dayCount: 1` was asserted; the `"3 days open"` assertion at `:359` is a different key on a different element). Collapsed the two duplicated 18-line cases into one `it.each` over `en/de × 1/6` days; mutation-verified.
  - `[low]` `[patch]` Those dashboard assertions anchored `/· 1 day$/` on the shared fixture's `startLocationLabel`/`destinationLocationLabel` defaulting to `null`, since the component appends the route after the day count. Pinned both to `null` in the local fixture so a future default cannot fail these for an unrelated reason.
  - `[low]` `[patch]` The new dictionary test was a hardcoded three-key allowlist, the fourth such list in the file, leaving six of the ten `…One` twins uncovered. Added a derived case asserting every key ending in `One` has its plural sibling in both dictionaries. Kept the explicit `{count}` assertions: `trips.dashboard.sublineOne` legitimately retains `{gapTripCount}`, so "a twin carries no placeholder" is true of these three keys but not of the convention.
  - `[low]` `[patch]` The two new timeline cases added trailing `vi.unstubAllGlobals()` calls that the file's own comment at `:74-79` documents as unnecessary and tolerated only as legacy. Removed both; the `afterEach` covers them.
  - `[low]` `[patch]` The `<intent-contract>` "Never" clause cited `en.ts:734-735` / `:766-767` for the deliberate `{count} file(s)` exemption; those comments are about `imageAlt` and `openDocument` and say nothing about plurals. The exemption is sound but its support is at `en.ts:774-776` and `:740-744`. Contract left unmodified (read-only); correction recorded in Design Notes for the next sweep.

## Design Notes

Naming: `…One` suffix, matching all seven existing twins. (`trips.plan.moveSuccessWithSegment` drops a trailing `s` instead, but only because it is one arm of a three-way `>1 / ===1 / 0` branch; it is not the general convention.)

Branch shape — copy `TripsDashboard.tsx:241-243` verbatim in structure:

```tsx
trip.dayCount === 1
  ? t("trips.dashboard.dayCountOne")
  : formatMessage(t("trips.dashboard.dayCount"), { count: trip.dayCount })
```

`TripsDashboard.tsx:687` builds a template literal, so hoist the branch into a `const dayCountLabel` above the JSX rather than inlining a ternary inside `${…}`.

German singulars: `Tage → Tag`, `Einträge → Eintrag`, and `Reise mit {count} Tagen erstellt. → Reise mit 1 Tag erstellt.` (dative singular, no `-n`).

**Citation correction (review pass 1).** The `<intent-contract>` "Never" clause cites `en.ts:734-735` and `en.ts:766-767` as documenting the deliberate `{count} file(s)` form. Those two comments are about `trips.gallery.imageAlt` and `trips.documents.openDocument` respectively and say nothing about plurals. The exemption itself stands, but its actual support is the `showMoreDocuments` comment at `en.ts:774-776` — "it takes the codebase's singular-twin treatment rather than a written-out `(s)` a screen reader would spell out" — and its `showMoreImages` counterpart at `en.ts:740-744`. Both draw the line explicitly: read-aloud strings get a twin, visible-only labels may keep `(s)`. `selectedFiles` is visible-only in both dialogs, so it keeps `(s)`. Use these line references, not the contract's, in any future sweep.

## Verification

**Commands:**
- `cd travelplan && npx vitest run test/i18nDictionaries.test.ts test/tripsDashboard.test.tsx test/tripTimelinePlan.test.tsx test/tripBucketListPanel.test.tsx test/tripCreateForm.test.tsx` -- expected: all pass
- `cd travelplan && npm run typecheck` -- expected: exit 0
- `cd travelplan && npm run lint` -- expected: exit 0
- `cd travelplan && npm test` -- expected: full suite green, no pre-existing test edited except to add cases
- `cd travelplan && grep -n '{count}' src/i18n/en.ts src/i18n/de.ts` -- expected: manual read confirms every remaining `{count}` key is either guarded by an `=== 1` branch, deliberately `(s)`-formed, or grammatical at 1

## Auto Run Result

Status: done

### Implemented change

Three `{count}` keys were substituted unguarded and rendered ungrammatically at one. Each received a singular twin in both dictionaries, following the `…One` convention this codebase already used seven times, and each of the four call sites now branches on `count === 1`. `src/i18n/index.ts` is untouched — no plural engine was introduced.

| Key | en | de |
|---|---|---|
| `trips.dashboard.dayCountOne` | `1 day` | `1 Tag` |
| `trips.create.successOne` | `Trip created with 1 day.` | `Reise mit 1 Tag erstellt.` |
| `trips.bucketList.countLineOne` | `1 entry` | `1 Eintrag` |

DW-16 covers `dayCount` (both consumers); DW-68 covers `countLine`; `trips.create.success` was found by the dictionary sweep the intent asked for.

### Files changed

- `travelplan/src/i18n/en.ts` -- three twins, each after its plural sibling, with a WHY comment in the file's voice
- `travelplan/src/i18n/de.ts` -- same three keys, German values and German comments; en/de `…One` parity verified
- `travelplan/src/components/features/trips/TripsDashboard.tsx` -- `dayCountLabel` hoisted above the JSX and branched, keeping the subtitle template literal readable
- `travelplan/src/components/features/trips/TripTimeline.tsx` -- Duration stat tile branched on `detail.trip.dayCount`
- `travelplan/src/components/features/trips/TripBucketListPanel.tsx` -- `entryCountLabel` branched on `items.length`
- `travelplan/src/components/features/trips/TripCreateForm.tsx` -- success toast branched on `body.data.dayCount`
- `travelplan/test/i18nDictionaries.test.ts` -- placeholder assertions for the three pairs, plus a derived case covering all ten twins
- `travelplan/test/tripsDashboard.test.tsx` -- `it.each` over en/de × 1/6 days on the row subtitle
- `travelplan/test/tripTimelinePlan.test.tsx` -- one-day Duration tile in en and de; this file's first German render
- `travelplan/test/tripBucketListPanel.test.tsx` -- collapsed count line at one item, en and de
- `travelplan/test/tripCreateForm.test.tsx` -- `it.each` over en/de × 1/4 days on the success notice

### Review findings

- **Patches applied: 6** (2 medium, 4 low) — see the Review Triage Log. The two medium ones closed a real gap: as first written, the new tests pinned only the singular arm, so inverting either new condition left the suite green.
- **Deferred: 3** — not written to the ledger, because this invocation forbade editing it. For the orchestrator to record:
  1. *(medium)* Nothing prevents the next count key from shipping unguarded. There are now ten hand-copied `count === 1 ? t(k + "One") : formatMessage(t(k), { count })` call sites, and an unbranched `formatMessage` call type-checks and lints cleanly. This story exists because exactly that happened three times. A `tCount(t, key, n)` helper would keep the twin-key storage convention and remove only the copy-paste; the intent explicitly permitted either shape, and twins were chosen for consistency with the seven existing sites.
  2. *(low)* `trips.import.issuesTruncated` — German `"und {count} weitere"` at one. The correct ending depends on the elided referent's gender, which neither the key nor its heading ("Das hat der Server gefunden") names: "weitere" is right for *Meldung*/*Zeile*, "weiteres" for *Problem*, "weiterer" for *Hinweis*. Not derivable from the dictionary alone — needs a native-speaker decision on the referent.
  3. *(low)* `trips.dashboard.dayCount`/`dayCountOne` is consumed by `TripTimeline`'s Duration tile, so a `trips.dashboard.*` key names a surface it does not belong to. Pre-existing on the plural key; this change doubled it. Note `en.ts:355-357` argues the opposite case for `durationHours`/`ganttHours`, though that argument turned on the two surfaces needing different German registers, which does not apply here.
- **Rejected: 11** — chiefly three edge-case findings that `dayCount` may arrive undefined (it is typed non-optional `number` in all three components and comes from routes this app owns; the pre-change code had identical exposure); a challenge to the twin-vs-helper decision that the intent explicitly sanctioned; and several style points where the diff deliberately follows the target file's established idiom.

### Verification

- `npm test` -- 153 files, 2444 tests passed (2439 before the review patches). The pre-existing exact-string assertions on `"2 days"` and `"2 entries"` pass unmodified.
- `npm run typecheck` -- exit 0
- `npm run lint` -- 0 errors, 79 warnings; byte-identical to the pre-change baseline
- Mutation check -- inverting both new conditions to `!== 1` fails all 8 new dashboard and create-form cases; sources restored and re-verified
- `git diff -- src/i18n/index.ts` -- empty
- Sweep audit -- all 17 `{count}` keys in `en.ts` accounted for: nine now have `…One` twins behind an `=== 1` branch, six are excluded by the spec (parenthesized counts and the deliberate `(s)` form), `moveSuccessWithSegments` is already one arm of a three-way branch, and `issuesTruncated` is deferred above

### Residual risks

The guard against regression is convention plus tests, not a mechanism — deferred item 1. The German wordings are single-source (no native review in this run), though all three are unambiguous: `Tag`, `Eintrag`, and the dative singular `mit 1 Tag`.
