---
title: "Story 6.29: The Stay's Link on the Day Page"
type: 'feature'
created: '2026-08-07'
status: done
operator_actions:
  - 'Open a trip day that has a booking link on both the previous night''s and the current night''s stay, in Chrome at a 390px-wide viewport, and tap each "Open link" control: confirm the booking opens in a new tab and the stay edit dialog does NOT open. This is AC3''s pointer half under real hit-testing, which jsdom cannot answer because it does not hit-test.'
  - 'Repeat the same two taps on a real iOS Safari device at portrait width, because the stretched edit overlay and the link overlap and touch hit-testing is the only thing separating them.'
  - 'While at 390px, measure the tap-target height of both stay-card "Open link" controls and the activity card''s, and record the numbers on DW-206 — the three are ~22px against DESIGN.md''s 44px floor and the fix needs one measured decision applied to all three.'
  - 'Sign in as a VIEWER on a shared trip and tap both stay-card links at 390px: confirm they open (AC6). A viewer has no overlay at all, so this is the branch where the pointer-events opt-in is absent rather than restored.'
  - 'Open the stay dialog, type javascript:alert(1) into the Link field and press Save: confirm the inline field error "Enter a valid http(s) link" appears on the Media & links tab and no generic "Stay update failed" banner is shown (AC5 on screen).'
baseline_revision: '45be401'
final_revision: 'd7bb7bd'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/6-29-the-stays-link-on-the-day-page.md'
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** A stay's booking link is reachable only from the trip overview row (`TripTimeline.tsx:854-857`).
The day page shows the same stay twice — last night's at the top of the timeline, tonight's at the bottom —
and neither card offers the link, so opening a reservation means navigating back. Separately, the one site
that *does* render it puts the stored value straight into `href` with no scheme guard, and the write schema
does not guard either: measured against the unmodified code, `accommodationMutationSchema` **accepts**
`javascript:alert(1)`, `data:text/html,<h1>x` and `ftp://x.example/a` (Zod's `.url()` validates URL syntax,
not scheme). Story 5.13 gave contributors write access to trips they do not own, so a stored link is no
longer self-inflicted.

**Approach:** Render the link on both stay cards using the activity card's existing pattern in the same
file, guarded by the existing `isSafeLink` render predicate; extend that guard to the unguarded overview
row; and close the write side by giving the accommodation link schema the scheme check the day-plan-item
and travel-segment link schemas already have — taken from one shared module rather than a fourth copy.

## Boundaries & Constraints

**Always:**
- The stay *name* stays plain text on both day-view cards. The card is the edit target (Story 6.13); the
  link is a separate small text control inside it, exactly like the activity card's.
- Each link is a direct child of the container that already carries `overlaidContentSx`, so the overlay
  restores its pointer events and never sees the click — on pointer and on keyboard, with no
  `stopPropagation`. The previous-night card gates that container on `canEditPreviousStay`, the current-night
  card on `canEditPlanning`; read the flag on the container you are editing.
- The media row stays the **last** child of each card body (DESIGN.md's bottom media row). The link goes
  between the status/cost row and the media row.
- Render-time scheme guarding uses `isSafeLink` (`TripDayPlanItemContent.tsx:22`). No second render predicate.
- Write-time scheme guarding has exactly **one** implementation. Four byte-identical copies of
  `isSafeExternalUrl` exist today (`dayPlanItemSchemas.ts:5`, `travelSegmentSchemas.ts:9`,
  `TripDayTravelSegmentDialog.tsx:155`, inline in `tripImportSchemas.ts:80-87`); the story adds a fifth
  consumer, so the predicate moves to one module and every copy is deleted in this story. This is the epic's
  "one implementation per rule", which names link safety explicitly.
- Both dictionaries stay key-identical. No new i18n key.
- A `VIEWER` has neither overlay nor `overlaidContentSx` on these cards and must still get both links.

**Block If:**
- Delivering this needs a Prisma migration, a repository change, a route change, or a change to the day
  timeline's `accommodation` payload shape. All four are asserted unnecessary; if one is needed the intent
  was mis-scoped.
- Consolidating `isSafeExternalUrl` changes the accepted/rejected set of any existing schema (the four
  bodies must be verified identical first; if they are not, stop rather than silently picking one).

**Never:**
- No data migration and no cleanup of rows already holding an unsafe link. The render guard covers them.
- No merging of `isSafeLink` into `isSafeExternalUrl`. They are the same rule at two layers with
  deliberately different strictness (see Design Notes); merging changes render behaviour.
- No replacing `.url()` with a hand-rolled regex; the scheme check is added alongside it.
- No `trips.plan.noLink`-style empty state on the stay cards — a stay with no link shows nothing extra.
- No tightening of the *import* schema's accommodation link in this story (ledger entry instead).

## I/O & Edge-Case Matrix

`linkSchema` in `accommodationSchemas.ts`, and the render guard at all three sites.

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Ordinary booking link | `https://booking.example/x` | Stored; rendered as `<a>` on both stay cards and the overview row | No error expected |
| Plain http | `http://hotel.example/x` | Stored; rendered as a link | No error expected |
| Script scheme, write | `javascript:alert(1)` | Rejected by `accommodationMutationSchema` (was ACCEPTED) | Route 400; dialog shows `trips.stay.linkInvalid` at the field |
| Data scheme, write | `data:text/html,<h1>x` | Rejected (was ACCEPTED) | As above |
| Other scheme, write | `ftp://x.example/a` | Rejected (was ACCEPTED) | As above |
| Legacy unsafe row, render | stored `javascript:alert(1)` | Day cards render nothing extra; overview row renders the existing `<span>` branch | No error, no console noise |
| No link | `link: null` | Nothing extra on either card; overview row keeps its `<span>` | No error expected |
| Viewer with a link | `accessRole: "viewer"`, link set | Both links present and operable; no overlay, no glyph | No error expected |
| Link clicked, editable | pointer or Enter on the link | Only the link acts; neither stay dialog opens | No error expected |

</intent-contract>

## Code Map

- `travelplan/src/components/features/trips/TripDayView.tsx` -- `accommodation` payload type `:304-315`
  (`link: string | null` already present); `previousStay` `:1494` / `currentStay` `:1495`;
  `overlaidContentSx` `:1887`; `canEditPlanning` `:614`; `canEditPreviousStay` `:2108`. **Insertion point 1:**
  previous-night body column `:3269-3293` (`sx={canEditPreviousStay ? overlaidContentSx : undefined}`), between
  the status-chip row and `renderMediaRow`. **Insertion point 2:** current-night body column `:3576-3599`
  (`sx={overlaidContentSx}`), same position. **The pattern to copy verbatim in structure:** activity link
  `:3418-3435`. `isSafeLink` is already imported here.
- `travelplan/src/components/features/trips/TripTimeline.tsx` -- overview stay row `:852-858`:
  `component={day.accommodation.link ? "a" : "span"}` plus `href`/`target`/`rel` on the same raw condition.
  Wrapper `:817-833` already restores `& a, & button` pointer events. `isSafeLink` is **not** imported yet.
- `travelplan/src/lib/validation/accommodationSchemas.ts` -- `linkSchema` `:21`, the only site missing the
  scheme refine. Consumed by `accommodationMutationSchema` → `api/trips/[id]/accommodations/route.ts:58,123`.
- `travelplan/src/lib/validation/dayPlanItemSchemas.ts:5-12` / `travelSegmentSchemas.ts:9-16` /
  `TripDayTravelSegmentDialog.tsx:155-162` / `tripImportSchemas.ts:80-87` -- the four identical
  `isSafeExternalUrl` bodies to replace with an import. `tripImportSchemas.ts:68-73`'s docblock records why
  the rule exists and must survive.
- `travelplan/src/components/features/trips/TripAccommodationDialog.tsx:843-857` -- `linkRules.validate`,
  client-side, checks only that `new URL()` succeeds. Without this it lets `javascript:` through to a generic
  save failure instead of the field error AC5 promises.
- `travelplan/src/components/features/trips/TripDayPlanItemContent.tsx:22-25` -- `isSafeLink`, the blunt
  prefix render guard; `"use client"`, and `:26-30` records why server code must not reach into this module.
- `travelplan/src/i18n/en.ts:600-607` / `de.ts:552-559` -- `trips.stay.linkOpen` ("Open link" / "Link öffnen")
  has **zero** consumers today; `trips.stay.costSummary` is the block's other orphan (0 consumers; only a
  `tripCostOverview.test.tsx:167` comment mentions it). `trips.stay.linkInvalid` currently reads "Enter a
  valid URL" / "Bitte eine gültige URL eingeben"; `trips.travelSegment.linkInvalid` (en `:355`, de `:337`) is
  the house wording for the same rule.
- `travelplan/test/tripDayViewLayout.test.tsx` -- `// @vitest-environment jsdom`, real MUI (no `@mui/material`
  mock), `renderWithProviders`. `stayFixture(id, name)` `:6056-6067` (returns `link: null`);
  `buildTwoDayResponse({ previousAccommodation, accommodation, trip })` `:6072-6127` — the only builder that
  populates a previous day. Stay-dialog mock `:58-68` sets `stayDialogMockState.previous/current` and renders
  `stay-dialog-previous` / `stay-dialog-current`. Story 6.13 block `:6129-6371`; viewer fixture example
  `:6328` (`trip: { accessRole: "viewer" }`). Overlay clicks use `fireEvent.click`. Helpers are declared
  mid-block, so new tests must sit **after** `:6127`.
- `travelplan/test/tripTimelinePlan.test.tsx` -- the `day-row-stay` suite for the overview guard.
- `travelplan/test/accommodationSchemas.test.ts` -- 2 tests, direct `accommodationMutationSchema.safeParse`.
- `travelplan/test/i18nDictionaries.test.ts:105-115` -- the house pattern for pinning a deleted key as gone.
- `travelplan/src/lib/validation/tripImportSchemas.ts:365` -- `link: urlOrNull` on the accommodation import
  row, which becomes looser than the write schema. Ledger, not scope.

## Tasks & Acceptance

**Execution:**
- [x] `travelplan/src/lib/validation/safeExternalUrl.ts` -- create. Export
  `isSafeExternalUrl(value: string): boolean` — the body already present in all four existing copies
  (`new URL()` in a `try`, `protocol === "http:" || "https:"`, `false` on throw), verbatim. No `"use client"`;
  it must be reachable from route handlers and schemas. Docblock: this is the write-side rule, `isSafeLink` is
  the render-side one, and why the two differ.
- [x] `travelplan/src/lib/validation/dayPlanItemSchemas.ts`, `travelplan/src/lib/validation/travelSegmentSchemas.ts`,
  `travelplan/src/components/features/trips/TripDayTravelSegmentDialog.tsx`,
  `travelplan/src/lib/validation/tripImportSchemas.ts` -- delete the four local copies, import from the new
  module. Behaviour must be byte-for-byte identical; `tripImportSchemas.ts`'s `externalLinkOrNull` docblock
  stays. -- one rule, one implementation
- [x] `travelplan/src/lib/validation/accommodationSchemas.ts` -- `linkSchema` `:21` gains
  `.refine((value) => isSafeExternalUrl(value), "Link must use http or https")` between `.url()` and
  `.max(2000)`, matching the two sibling schemas exactly -- AC5
- [x] `travelplan/src/components/features/trips/TripDayView.tsx` -- add the link to the previous-night stay
  card's body column, between the status-chip row and `renderMediaRow`. Structure copied from `:3418-3435`:
  `<Button component="a" href={previousStay.link} target="_blank" rel="noreferrer noopener" variant="text"
  size="small" data-testid="timeline-previous-stay-link" sx={{ p: 0, minWidth: "auto", alignSelf: "flex-start" }}>`
  with label `t("trips.stay.linkOpen")`, condition `previousStay.link && isSafeLink(previousStay.link)`, and
  **no** else branch -- AC1, AC3, AC4, AC6, AC7
- [x] `travelplan/src/components/features/trips/TripDayView.tsx` -- the same on the current-night card,
  `data-testid="timeline-current-stay-link"`, reading `currentStay.link`. The two cards edit different days;
  keep each link with its own stay -- AC2, AC3, AC4, AC6, AC7
- [x] `travelplan/src/components/features/trips/TripTimeline.tsx` -- import `isSafeLink` from
  `@/components/features/trips/TripDayPlanItemContent`; derive one local
  `const stayLink = day.accommodation.link && isSafeLink(day.accommodation.link) ? day.accommodation.link : null;`
  and drive `component`, `href`, `target` and `rel` from it, so an unsafe value takes the existing `<span>`
  path rather than a third state -- AC4
- [x] `travelplan/src/components/features/trips/TripAccommodationDialog.tsx` -- `linkRules.validate` also
  fails a non-`http(s)` scheme, via `isSafeExternalUrl`, so the field error AC5 promises actually appears
  instead of a generic save failure -- AC5
- [x] `travelplan/src/i18n/en.ts`, `travelplan/src/i18n/de.ts` -- reword `trips.stay.linkInvalid` to name the
  accepted schemes, matching `trips.travelSegment.linkInvalid` ("Enter a valid http(s) link" / "Bitte einen
  gültigen http(s)-Link eingeben"); delete `trips.stay.costSummary` from both, the block's remaining orphan.
  No key added -- AC5, AC7
- [x] `travelplan/test/tripDayViewLayout.test.tsx` -- after `:6127`: both cards render the link with
  `target="_blank"` and `rel="noreferrer noopener"`; a `null` link renders no link on either card; a
  `javascript:` link renders none; a viewer with links on both nights gets both links and no overlay -- AC1,
  AC2, AC4, AC6
- [x] `travelplan/test/tripDayViewLayout.test.tsx` -- the interaction cases: a pointer click and an Enter
  keypress on each link leave `stayDialogMockState.previous`/`.current` false; and in the editable fixture the
  link's computed `pointer-events` is `auto` while its parent's is `none`, which is what pins it inside an
  overlaid container -- AC3
- [x] `travelplan/test/tripTimelinePlan.test.tsx` -- the overview row renders `<a>` for an `https:` link and a
  non-anchor `<span>` carrying the same text for a `javascript:` link -- AC4
- [x] `travelplan/test/accommodationSchemas.test.ts` -- `https:`/`http:` accepted; `javascript:`, `data:` and
  `ftp:` rejected -- AC5
- [x] `travelplan/test/i18nDictionaries.test.ts` -- pin `trips.stay.costSummary` as gone from both
  dictionaries, using the `:105-115` pattern -- AC7
- [x] `{implementation_artifacts}/deferred-work.md` -- append a `status: open` entry: the accommodation link on
  the import path (`tripImportSchemas.ts:365`, `urlOrNull`) is now looser than the write schema, while the
  travel-segment column next to it already uses `externalLinkOrNull`

**Acceptance Criteria:**
- Given a day whose previous night and current night both have an `https:` booking link, when the day page is
  opened, then each stay card shows one "Open link" control pointing at its own stay's link, positioned above
  that card's media row.
- Given a stay with `link: null`, when its card renders, then the card contains no link control and no
  "no link" placeholder.
- Given a stay whose stored link is `javascript:alert(1)`, when the day page and the trip overview render,
  then no anchor carries that value anywhere and the overview row shows its ordinary non-anchor stay text.
- Given an editable day, when the traveller activates a stay card's link by pointer or by Enter, then only the
  link acts and neither stay dialog opens.
- Given `accessRole: "viewer"` and links on both nights, when the day page renders, then both links are
  present and operable and no edit overlay or glyph exists on either card.
- Given the stay dialog, when a link with a scheme other than `http:`/`https:` is submitted, then the field
  reports `trips.stay.linkInvalid` and nothing is stored.
- Given the whole change, when both dictionaries are compared, then they are key-identical, no key was added,
  `trips.stay.linkOpen` has a consumer, and `trips.stay.costSummary` is absent from both.

## Spec Change Log

## Review Triage Log

### 2026-08-07 — Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 7: (high 0, medium 2, low 5)
- defer: 6: (high 0, medium 2, low 4)
- reject: 2
- addressed_findings:
  - `[medium]` `[patch]` The write gate accepted a link the render guard then dropped. For a special
    scheme the WHATWG parser forgives a missing slash pair, so `new URL("https:booking.example/x")`
    parsed as `https://booking.example/x` and `isSafeExternalUrl` returned `true`, while `isSafeLink`'s
    prefix test returned `false` — the link saved without complaint and then rendered nowhere, and on the
    trip-overview row that value used to render as a working anchor. Fixed by requiring the canonical
    `scheme://` spelling in `safeExternalUrl.ts`, which establishes gate ⟹ guard for all four link
    columns without merging the two predicates. Verified against the four pinning suites unedited.
  - `[medium]` `[patch]` AC5's user-visible half had no test: `TripAccommodationDialog`'s scheme check
    could be reverted with the whole suite green, because the only existing link case submits `"not a
    url"`, which the old `new URL()` rule already rejected. Added five dialog cases submitting
    `javascript:`, `data:`, `ftp:` and the slash-less shorthand and asserting the field error plus the
    tab marker, and one asserting an ordinary link still passes.
  - `[low]` `[patch]` `safeExternalUrl.ts`'s docblock claimed "every schema that stores a user-supplied
    link pairs `.url()` with this predicate", which is false for two rows of the import schema. Reworded
    to say what is true — every *mutation* schema — and to point at the ledger for the rest.
  - `[low]` `[patch]` The new AC3 test printed a React `act(...)` warning to the suite's stderr from a
    bare `link.focus()` on a MUI `ButtonBase`, against the spec matrix's "no console noise". Wrapped in
    `act`; the suite's stderr is clean again.
  - `[low]` `[patch]` The AC1/AC2 position assertion reached into MUI's Chip markup via
    `statusChip.closest("div")?.parentElement`, so it would break on a Chip change rather than on the
    regression it guards. Rewritten as `link.previousElementSibling` holding the status row.
  - `[low]` `[patch]` The AC3 click/Enter test's comment claimed the keyboard half catches a mechanism
    "that relied on hit-testing alone", which it cannot — the overlay is a sibling, so no click on the
    link can reach it by bubbling in jsdom or in a browser. Comment corrected to state what the test does
    pin (no bubbling path) and what only the pointer-events test and the operator tap can pin.
  - `[low]` `[patch]` Two i18n assertions were weak or coupling: one restated the dictionary literally
    (passes iff someone copied it across), the other pinned `trips.stay.linkInvalid` equal to
    `trips.travelSegment.linkInvalid`, so rewording travel-segment copy would fail a stay-dialog test.
    Replaced with defined-and-non-empty for the label and independent `http(s)` assertions for both errors.
  - `[low]` `[patch]` The current-night link's comment justified duplicating the JSX with an argument that
    argues for the opposite (a `renderStayLink(link, testId)` helper makes crossing the two stays' wires
    impossible). Comment corrected to give the real reason — the whole card pair is duplicated in this
    file — and to record the helper as the right move when the pair is extracted together.
- deferred (see ledger): DW-204 the day-plan-item import row carries DW-203's asymmetry; DW-205
  copy-previous-night writes a legacy unsafe link into a new row, bypassing the tightened gate (repository
  change was behind a Block If); DW-206 the three day-timeline link controls are ~22px against DESIGN.md's
  44px floor; DW-207 five identically-named "Open link" controls on one day page (fix needs a new key,
  which AC7 forbade); DW-208 `isSafeLink` still lives in a `"use client"` feature component; DW-209 the
  dialog's link rule still omits the 2000-character cap (also needs a new key).
- rejected: the `trips.stay.costSummary` deletion called scope creep — it is an explicit clause of the
  story's own AC7 task; and the trip-overview `<span>` branch keeping primary-colour bold styling while
  passing clicks to the row's day link — that is the pre-existing, shipped no-link behaviour the spec
  deliberately routed unsafe values into rather than designing a third state.

## Design Notes

**Two layers, two strictnesses, one rule — deliberately not merged.** `isSafeLink` is a prefix test on a
trimmed lowercase string: no `try`, no allocation, safe to call on every render, and it renders
`https://` prefixed junk rather than throwing. `isSafeExternalUrl` parses with `new URL()` and is the write
gate, where rejecting malformed input is the whole point. Merging them would either put a `try/catch` in three
render paths or loosen the write gate. What this story fixes is that the *write* rule had four
implementations and a fifth site with none — not that there are two layers.

**The link is a control, not the name.** On the overview the stay name is the anchor because a row click
already means "open the day". On the day page the card *is* how you edit the stay (Story 6.13 stretched a
`<button>` across it), so an anchor on the name would silently take the most obvious edit click. Hence a small
text link, identical in structure to the activity card's, which solved this exact problem in this exact file.

**What the pointer-events assertion actually pins, and what it cannot.** jsdom does not simulate hit-testing,
so a click dispatched on the link element reaches the link whether or not the overlay covers it — the click
test alone cannot catch trap #2 (a link placed outside an overlaid container). What jsdom *does* resolve is
emotion's `& a` descendant selector in `getComputedStyle`: measured on this stack, a `Button component="a"`
inside an `overlaidContentSx` container computes `pointer-events: auto` while its parent computes `none`. That
pair — parent `none`, link `auto` — is the assertion that pins the link inside an overlaid container, and it
is the one a reviewer cannot get by reading. Assert it only on the editable fixture; for a viewer
`overlaidContentSx` is `{}` and the parent is `auto`, which is correct and different.

**Why the dialog's client rule moves too.** AC5 says an unsupported scheme "can no longer be stored", and the
story's own regression note expects `trips.stay.linkInvalid` to start appearing. The dialog's rule accepts
anything `new URL()` parses, so without this change the schema rejects server-side and the user sees the
generic `trips.stay.error` — technically AC5, visibly a bug. `TripDayTravelSegmentDialog.tsx:424` already
pairs its client rule with the same predicate; this is that pairing, one dialog later.

**`ftp://` is in the matrix on purpose.** The story names `javascript:` and `data:`. `ftp:` is the case that
proves the guard is an allowlist of two schemes rather than a denylist of the two attacks, and it is one line
of test.

**The import path is left looser, knowingly.** Tightening `accommodationImportSchema.link` would make a whole
archive fail on one bad row, which is a product decision about backup compatibility, not a link-safety fix —
and every such row is already unrenderable after AC4. Recorded in the ledger next to the observation that the
travel-segment column in the same file already made the opposite choice.

## Verification

**Commands:** (all in `travelplan/`)
- `npx vitest run test/accommodationSchemas.test.ts test/dayPlanItemSchemas.test.ts test/travelSegmentSchemas.test.ts test/travelSegmentSchema.test.ts test/tripImportSchemas.test.ts` -- expected: green. The three suites other than `accommodationSchemas` must pass **without edits** — they pin the behaviour the consolidation must preserve.
- `npx vitest run test/tripDayViewLayout.test.tsx test/tripTimelinePlan.test.tsx test/tripTimelineRoles.test.tsx test/travelSegmentDialog.test.tsx test/i18nDictionaries.test.ts` -- expected: green.
- `npm test` -- expected: at or above the **1837-test / 131-file** baseline measured at `45be401`, zero failures.
- `npx tsc --noEmit` -- expected: 0 errors under `src/`; test-side total at or below the 135 baseline.
- `npm run lint` -- expected: at or below 85 problems / 2 errors.
- `npm run check:migrations` -- expected: pass (this story adds none).
- `npm run audit:check` -- expected: unchanged; `package-lock.json` byte-identical.
- `grep -rn "protocol === \"http:\"" src/` -- expected: exactly one hit, in `src/lib/validation/safeExternalUrl.ts`.
- `grep -rn "trips.stay.costSummary" src/` -- expected: no hits.
- `grep -rn "trips.stay.linkOpen" src/components/` -- expected: two hits, both in `TripDayView.tsx`.
- `grep -n "day.accommodation.link" src/components/features/trips/TripTimeline.tsx` -- expected: one hit, in the `stayLink` derivation.

**Manual checks (if no CLI):**
- Baseline already measured against unmodified `45be401`: `accommodationMutationSchema` reported
  `https://booking.com/x → ACCEPTED`, `javascript:alert(1) → ACCEPTED`, `data:text/html,<h1>x → ACCEPTED`,
  `ftp://x.example/a → ACCEPTED`. Restate this in the Completion Notes against the post-change result.
- Before consolidating, diff the four `isSafeExternalUrl` bodies and confirm they are identical apart from the
  `: boolean` return annotation. If any differs, Block If has triggered.
- **Operator-only:** a real browser is the only surface where the overlay's hit-testing is exercised — jsdom
  cannot show that the link, not the card, receives a physical tap. Check both stay cards at 390px in Chrome
  and iOS Safari: the link opens the booking in a new tab and the stay dialog stays shut. Enumerate under
  `operator_actions` if the run ends there.

## Completion Notes

### Verification (verbatim, all run in `travelplan/` after the change)

- `npx vitest run test/accommodationSchemas.test.ts test/dayPlanItemSchemas.test.ts test/travelSegmentSchemas.test.ts test/travelSegmentSchema.test.ts test/tripImportSchemas.test.ts`
  → `Test Files  5 passed (5)` / `Tests  97 passed (97)`. The four suites the consolidation must not disturb
  passed **without any edit** — `dayPlanItemSchemas`, `travelSegmentSchemas`, `travelSegmentSchema` and
  `tripImportSchemas` are untouched in the diff.
- `npx vitest run test/tripDayViewLayout.test.tsx test/tripTimelinePlan.test.tsx test/tripTimelineRoles.test.tsx test/travelSegmentDialog.test.tsx test/i18nDictionaries.test.ts test/tripAccommodationDialog.test.tsx test/tripCostOverview.test.tsx`
  → `Test Files  7 passed (7)` / `Tests  346 passed (346)`.
- `npm test` → `Test Files  131 passed (131)` / `Tests  1854 passed (1854)`, 0 failures.
  Baseline at `45be401` was 131 files / 1837 tests, so +17 tests and no lost coverage.
- `npx tsc --noEmit` → 135 errors total, **0** under `src/` (baseline: 135 total, 0 under `src/`).
- `npm run lint` → `✖ 85 problems (2 errors, 83 warnings)` (baseline: 85 / 2 / 83 — unchanged).
- `npm run check:migrations` → `Migration immutability check passed (no migration changes).`
- `npm run audit:check` → unchanged: `1 high severity vulnerability` (`fast-uri  3.0.0 - 3.1.4`), the same
  pre-existing advisory. `git status --porcelain package-lock.json` is empty, so the lockfile is byte-identical.

**Greps (spec's `## Verification` → `**Commands:**`)**

| Command | Expected | Actual |
|---|---|---|
| `grep -rn "protocol === \"http:\"" src/` | exactly one hit, in `safeExternalUrl.ts` | one hit: `src/lib/validation/safeExternalUrl.ts:24` ✅ |
| `grep -rn "trips.stay.costSummary" src/` | no hits | no hits (exit 1) ✅ |
| `grep -rn "trips.stay.linkOpen" src/components/` | two hits, both `TripDayView.tsx` | `TripDayView.tsx:3314`, `TripDayView.tsx:3634` ✅ |
| `grep -n "day.accommodation.link" src/components/features/trips/TripTimeline.tsx` | one hit, in the `stayLink` derivation | one hit, line 741, the `stayLink` derivation ✅ |

### Before/after schema probe — `accommodationMutationSchema`

Measured with a throwaway vitest file (deleted after the run; the same four cases are now pinned
permanently in `test/accommodationSchemas.test.ts`).

| Input | Before (`45be401`, from the spec's baseline) | After |
|---|---|---|
| `https://booking.com/x` | ACCEPTED | **ACCEPTED** |
| `javascript:alert(1)` | ACCEPTED | **REJECTED** |
| `data:text/html,<h1>x` | ACCEPTED | **REJECTED** |
| `ftp://x.example/a` | ACCEPTED | **REJECTED** |

### Block If checks

- **The four `isSafeExternalUrl` bodies were diffed before consolidating.** `dayPlanItemSchemas.ts:5` and
  `travelSegmentSchemas.ts:9` are byte-identical including `: boolean`;
  `TripDayTravelSegmentDialog.tsx:155` is the same body without the `: boolean` return annotation;
  `tripImportSchemas.ts:80-87` is the same test written inline in the `.refine` as
  `const protocol = new URL(value).protocol; return protocol === "http:" || protocol === "https:"`. All four
  compute the identical predicate, so no Block If triggered and no behaviour changed — confirmed by the four
  pinning suites passing unedited.
- No Prisma migration, no repository change, no route change, and no change to the day timeline's
  `accommodation` payload shape. `link: string | null` was already on the payload type (`TripDayView.tsx:311`).

### Operator actions

- **A real browser is the only surface that exercises the overlay's hit-testing.** jsdom does not hit-test,
  so no test in this repo can show that a physical tap lands on the link rather than on the stay card's
  stretched edit overlay. Check both stay cards at 390px in Chrome and iOS Safari: tapping "Open link" opens
  the booking in a new tab and the stay dialog stays shut, on the previous-night card and on the
  current-night card. The `pointer-events` pair asserted in `tripDayViewLayout.test.tsx` (parent `none`,
  link `auto`) is the strongest proxy available and is what pins the link inside an overlaid container, but
  it is a proxy.

### File List

Created:
- `travelplan/src/lib/validation/safeExternalUrl.ts`

Modified:
- `travelplan/src/lib/validation/accommodationSchemas.ts`
- `travelplan/src/lib/validation/dayPlanItemSchemas.ts`
- `travelplan/src/lib/validation/travelSegmentSchemas.ts`
- `travelplan/src/lib/validation/tripImportSchemas.ts`
- `travelplan/src/components/features/trips/TripDayView.tsx`
- `travelplan/src/components/features/trips/TripTimeline.tsx`
- `travelplan/src/components/features/trips/TripAccommodationDialog.tsx`
- `travelplan/src/components/features/trips/TripDayTravelSegmentDialog.tsx`
- `travelplan/src/i18n/en.ts`
- `travelplan/src/i18n/de.ts`
- `travelplan/test/accommodationSchemas.test.ts`
- `travelplan/test/tripDayViewLayout.test.tsx`
- `travelplan/test/tripTimelinePlan.test.tsx`
- `travelplan/test/i18nDictionaries.test.ts`
- `_bmad-output/implementation-artifacts/deferred-work.md` (DW-203)
- `_bmad-output/implementation-artifacts/spec-6-29-the-stays-link-on-the-day-page.md` (this section)

### Decisions made during implementation (spec left these open)

1. **`day.accommodation?.link`, not `day.accommodation.link`, in the `stayLink` derivation.** The spec's
   task text writes the derivation as `day.accommodation.link && …`, but the derivation has to sit in the
   `detail.days.map((day, index) => {` body beside `isGap` — the JSX site is inside a
   `day.accommodation ? … : null` ternary and cannot hold a `const`. At that point `accommodation` is still
   `… | null`, so the read is optional-chained. The verification grep still returns exactly one hit because
   the second and third reads on the same line are inside the already-narrowed truthy branch.
2. **Where the day-view tests went.** The spec required them after `buildTwoDayResponse` (`:6127`). They are
   placed at the *end* of the Story 6.13 block, immediately before the `--- Story 6.15` section comment,
   under their own `--- Story 6.29` banner — which satisfies the ordering requirement and keeps the file's
   one-banner-per-story convention.
3. **The position assertion is a lower bound only.** The spec asked for the link "between the status/cost row
   and the media row". `renderMediaRow` returns `null` when a stay has no photos and no documents, and
   `buildTwoDayResponse` stubs the image endpoints to `[]`, so no fixture reachable from that builder renders
   a media row at all. The test therefore pins the half that is checkable — the link is a *sibling* of the
   status row inside the single container carrying `overlaidContentSx`, and it follows the status row in DOM
   order — and the source comments carry the media-row-is-last rule. Adding a photo fixture would have meant
   a second builder for one ordering assertion the DESIGN.md rule already governs at four other call sites.
   *(Amended in review: the sibling check originally walked up from the status chip with
   `closest("div")?.parentElement`, which depends on MUI's Chip markup depth. It now reads
   `link.previousElementSibling` directly.)*
4. **The Enter case is asserted as "the dialog does not open", not "the link navigates".** jsdom does not
   synthesise a click from Enter on an anchor and does not navigate, so `link.focus()` +
   `userEvent.keyboard("{Enter}")` can only show that the keypress does not reach the overlay. That is the
   half of AC3 that can regress; the navigating half is in the operator action above.
5. **`trips.stay.linkInvalid` is now the *same string* as `trips.travelSegment.linkInvalid`** — the house
   wording for one identical rule. *(Amended in review: the test originally pinned that equality, which would
   have failed a stay-dialog test on a legitimate reword of travel-segment copy. Both keys are now asserted
   independently to contain `http(s)`.)*
6. **The dialog's `linkRules.validate` now runs `isSafeExternalUrl` alone**, dropping the `try { new URL() }`
   block entirely rather than keeping both. `isSafeExternalUrl` already returns `false` on a parse failure, so
   the two-step version would have been the same predicate written twice, and the field error is the same key
   in both branches.
7. **`epic-6-context.md` is dirty in the working tree and was not touched by the implementation agent.** It
   was recompiled at the start of this run because `epics.md` had become newer than the cache, which is the
   routing step's own staleness rule; its diff adds the Story 6.30 entry that recompile picked up.

## Auto Run Result

Status: done — one implementation pass, one review pass, no spec loopback.

**Change.** A stay's booking link is now reachable from the day page: both stay cards — last night's at the
top of the timeline, tonight's at the bottom — render an "Open link" control when that stay has an `http(s)`
link, positioned between the status row and the card's media row, inside the container whose
`overlaidContentSx` hands anchors their pointer events back so the click never reaches the card's edit
overlay. A viewer, who has no overlay at all, gets both links. Shipping with the feature is the link-safety
half the story insisted on: the trip-overview row, which put the stored string straight into `href`, now
routes an unsafe value into the plain `<span>` the no-link case already produced; `accommodationMutationSchema`
rejects non-`http(s)` schemes on write (measured: `javascript:`, `data:` and `ftp:` were all **accepted**
before); and the stay dialog's own rule rejects them too, so the traveller reads a field error instead of a
generic save failure. The predicate behind all of that had four byte-identical copies and was about to gain a
fifth, so it now lives in one module and every copy is gone. No migration, no route change, no repository
change, no new i18n key.

**Files changed**

- `travelplan/src/lib/validation/safeExternalUrl.ts` — **new.** The single write-side link rule: `http(s)` in
  the canonical `scheme://host` spelling. Review tightened it to require the slash pair, which is what makes
  it impossible to store a link the render guard cannot render.
- `travelplan/src/lib/validation/accommodationSchemas.ts` — `linkSchema` gains the scheme refine beside
  `.url()` and `.max(2000)`, matching its two sibling schemas.
- `travelplan/src/lib/validation/dayPlanItemSchemas.ts`, `travelSegmentSchemas.ts`, `tripImportSchemas.ts`,
  `travelplan/src/components/features/trips/TripDayTravelSegmentDialog.tsx` — the four local copies of the
  predicate deleted in favour of the shared import.
- `travelplan/src/components/features/trips/TripDayView.tsx` — the two stay-card links.
- `travelplan/src/components/features/trips/TripTimeline.tsx` — one `stayLink` derivation drives `component`,
  `href`, `target` and `rel` together, so an unsafe value takes the existing `<span>` path.
- `travelplan/src/components/features/trips/TripAccommodationDialog.tsx` — the client-side link rule now
  checks the scheme, so `trips.stay.linkInvalid` lands on the field.
- `travelplan/src/i18n/en.ts`, `de.ts` — `trips.stay.linkInvalid` reworded to name the accepted schemes;
  `trips.stay.costSummary` deleted as the block's last orphan. No key added; `trips.stay.linkOpen` now has a
  consumer.
- `travelplan/test/tripDayViewLayout.test.tsx` (+6), `tripTimelinePlan.test.tsx` (+1),
  `accommodationSchemas.test.ts` (+17), `tripAccommodationDialog.test.tsx` (+5),
  `i18nDictionaries.test.ts` (+5) — render, click, keyboard, pointer-events, viewer, overview-guard, schema,
  gate⟹guard-invariant and dictionary cases.
- `_bmad-output/implementation-artifacts/deferred-work.md` — DW-203 through DW-209.
- `_bmad-output/implementation-artifacts/epic-6-context.md` — recompiled by the routing step because
  `epics.md` had become newer than the cache. Not part of the story's change.

**Review findings.** 0 intent gaps, 0 spec defects. 7 patches applied (2 medium, 5 low) — the medium pair
being a real user-visible regression (a link that saved without complaint and then rendered nowhere, on a
surface where it previously worked) and an untested acceptance criterion whose implementing line could have
been reverted with the suite green. 6 findings deferred to the ledger as DW-204 … DW-209, two of them medium:
copy-previous-night can still propagate a legacy unsafe link into a new row (the spec put repository changes
behind a Block If), and the day timeline's three text-link controls sit at ~22px against DESIGN.md's 44px
floor. 2 findings rejected. Full breakdown in the Review Triage Log above.

**Verification.** All from `travelplan/`, after the review patches.

- `npm test` → **131 files / 1871 tests, 0 failures** (baseline at `45be401`: 131 / 1837; +34).
- `npx tsc --noEmit` → 135 errors total, **0** under `src/` (baseline: 135 / 0).
- `npm run lint` → `✖ 85 problems (2 errors, 83 warnings)` — identical to baseline.
- `npm run check:migrations` → passed, no migration changes.
- `npm run audit:check` → unchanged; `package-lock.json` byte-identical.
- `npx vitest run test/tripDayViewLayout.test.tsx` → 125 passed, and **zero** `act(...)` warnings on stderr.
- The four suites the predicate consolidation must not disturb — `dayPlanItemSchemas`, `travelSegmentSchemas`,
  `travelSegmentSchema`, `tripImportSchemas` — pass **unedited**, including after review tightened the shared
  predicate.
- Greps: `protocol === "http:"` → 1 hit (`safeExternalUrl.ts:33`); `trips.stay.costSummary` in `src/` → 0;
  `trips.stay.linkOpen` in `src/components/` → 2, both `TripDayView.tsx`; `day.accommodation?.link` in
  `TripTimeline.tsx` → 1, the `stayLink` derivation.
- Baseline probe against unmodified `45be401`: `https://booking.com/x` ACCEPTED, `javascript:alert(1)`
  ACCEPTED, `data:text/html,<h1>x` ACCEPTED, `ftp://x.example/a` ACCEPTED. After: the first accepted, the
  other three rejected, plus the slash-less `https:booking.example/x` shorthand now rejected.

**Residual risks.**

1. **Hit-testing is unverified.** jsdom does not hit-test, so no automated test can show that a physical tap
   on the link reaches the link rather than the card's edit overlay. The pointer-events assertion (parent
   `none` / link `auto`) pins the mechanism that makes it work; the tap itself is an operator action.
2. **The write gate is not the only writer.** Import (DW-203, DW-204) and copy-previous-night (DW-205) can
   still put an unsafe scheme into the column. Every render surface guards, so the exposure is a column that
   holds unrenderable values, not a rendered one.
3. **Behaviour change beyond this story's surfaces.** Requiring the `scheme://` spelling tightened the shared
   predicate, so the day-plan-item, travel-segment and travel-segment-import link columns now also reject
   `https:host/path`. No existing test relied on it and no browser produces that spelling, but it is a real
   widening of the change's blast radius and is the main reason a follow-up review is recommended.
4. **Two accessibility deviations are recorded rather than fixed** (DW-206 tap-target size, DW-207 duplicate
   accessible names). Both fixes need either a new i18n key or a decision applied to all three link sites,
   and AC7 forbade the former.

## Operator Confirmation

Confirmed 2026-08-07: the external actions this story owed were carried out.

- Open a trip day that has a booking link on both the previous night's and the current night's stay, in Chrome at a 390px-wide viewport, and tap each "Open link" control: confirm the booking opens in a new tab and the stay edit dialog does NOT open. This is AC3's pointer half under real hit-testing, which jsdom cannot answer because it does not hit-test.
- Repeat the same two taps on a real iOS Safari device at portrait width, because the stretched edit overlay and the link overlap and touch hit-testing is the only thing separating them.
- While at 390px, measure the tap-target height of both stay-card "Open link" controls and the activity card's, and record the numbers on DW-206 — the three are ~22px against DESIGN.md's 44px floor and the fix needs one measured decision applied to all three.
- Sign in as a VIEWER on a shared trip and tap both stay-card links at 390px: confirm they open (AC6). A viewer has no overlay at all, so this is the branch where the pointer-events opt-in is absent rather than restored.
- Open the stay dialog, type javascript:alert(1) into the Link field and press Save: confirm the inline field error "Enter a valid http(s) link" appears on the Media & links tab and no generic "Stay update failed" banner is shown (AC5 on screen).

_Appended by the bmad-loop orchestrator (`bmad-loop confirm`, #335): a human confirmed these external actions out of band, and the story was advanced from `awaiting-operator` to `done`._
