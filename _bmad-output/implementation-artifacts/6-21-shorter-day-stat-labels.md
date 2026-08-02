---
authored_against: dcfb859
baseline_revision: 86b252663997c28fde52c31b89ab2a1ac4c2de85
final_revision: cc72a92b7d534b4729d820d0d3cf43190436c87a
status: done
review_loop_iteration: 0
followup_review_recommended: false
warnings: []
operator_actions:
  - "Run the app in a browser to do Task 5, on a throwaway copy of dev.db on an isolated port — never prisma/dev.db. The recipe is in the Dev Notes of _bmad-output/implementation-artifacts/7-12-bucket-list-sidebar-card.md. AC7 is the only one of the seven acceptance criteria that needs that session, and nothing in the suite can substitute: jsdom computes no layout at all, so no test can see whether a label wraps."
  - "At a 390px viewport, open a day and look at the four-cell strip under the photo. Confirm none of the four labels wraps to a second line and that both grid rows are the height of their content. Check German first — it has the longer words and is the language this turns on."
  - "Note what a failure looks like, because it is quiet: overflowWrap: \"anywhere\" was deliberately removed from the labels, and the strip's wrapper sets overflow: hidden, so a label that no longer fits is clipped at the cell edge with no ellipsis rather than visibly spilling. Look for a label that reads as cut off. If you see one, that is a copy fix or a new story — per Trap 4 it is not licence to restructure the grid."
  - "Open a day whose accommodation has a long name — the case that started this — and confirm the strip does not react to it at all. Specifically watch the spend cell next to check-in: it used to grow in sympathy because a grid row is as tall as its tallest cell, and that is the defect this story exists to remove. This is the only direct proof it is gone."
  - "Confirm the check-in cell still tells its two states apart in the browser: a booked stay shows the check-in time in ink, a day with no accommodation shows \"Keine Unterkunft\" in the warning tone. The label is now identical in both cases by design (AC2) — it is the value that must still differ."
  - "While on a day with no accommodation, look at whether \"Keine Unterkunft\" itself wraps and grows row 2. It is 16 characters at 21px in a ~130px cell, so it probably does. That is DW-135, deliberately out of scope here, but this is the cheapest moment to confirm or dismiss it — and it is arguably a more common trigger of the original complaint than a long hotel name."
  - "Also check the strip at a 600px viewport, not only at 390px. At sm the grid goes to four columns, which makes each cell about 89px — narrower than on the phone. That is the tightest point for \"TRAVEL TIME\" (~86px) and no acceptance criterion or test covers it."
  - "If every check passes, tick Task 5 in this spec, set status: done in the frontmatter and Status: done in the body, and set 6-21-shorter-day-stat-labels to done in sprint-status.yaml."
---

# Story 6.21: Shorter Labels on the Day Stat Strip

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner on a phone,
I want the four stat cells under the day photo to carry short labels,
so that one long hotel name stops making half the strip tall.

## Acceptance Criteria

1. **Three labels shorten.** `statTravelTime` → "Fahrzeit" / "Travel time"; `statSpendToday` → "Ausgaben" / "Spend"; the check-in cell reads "Check-in" / "Check-in" with no name.
2. **The accommodation name leaves the label entirely.** The cell's label is the same string whether or not a stay exists, so no user-supplied text can set the strip's height.
3. **The existing generic key is what remains.** `trips.dayView.statCheckInGeneric` already holds exactly "Check-in" for the no-stay case. It becomes the only label; a second key with the same value is not introduced.
4. **`statCheckIn` is deleted, not orphaned**, from both dictionaries.
5. **The cell still distinguishes its two states.** Without a stay the value is `trips.timeline.noAccommodation` in the warning colour; with one it is the check-in time or an em dash in ink. That behaviour is unchanged — only the label stops varying.
6. **Nothing else in the strip changes.** `statDay` and its value, the grid, the borders, the cell padding and the label typography are untouched.
7. **No wrapping at 390px.** None of the four labels wraps, and the two grid rows are the height of their content rather than of one long name.

## Tasks / Subtasks

- [x] **Task 1 — The two straightforward strings** (AC: 1)
  - [x] `src/i18n/de.ts:245-246` and `en.ts:246-247`:
    - `trips.dayView.statTravelTime`: "Fahrzeit gesamt" → "Fahrzeit"; "Total travel time" → "Travel time"
    - `trips.dayView.statSpendToday`: "Ausgaben heute" → "Ausgaben"; "Spend today" → "Spend"
  - [x] Both drop a qualifier that carried meaning — "gesamt" said the figure is the sum of every segment, "heute" said it is this day and not the trip. Both remain true from context: the cell sits in a strip of day-level facts directly under the day's photo. This is an accepted loss, recorded here so it is not rediscovered as a defect.

- [x] **Task 2 — Collapse the check-in label** (AC: 1, 2, 3, 4, 5)
  - [x] `TripDayView.tsx:2306-2310` renders `statStay ? formatMessage(t("...statCheckIn"), { name: statStay.name }) : t("...statCheckInGeneric")`.
  - [x] Collapse to `t("trips.dayView.statCheckInGeneric")` unconditionally. This is not a new string — it is the branch that already exists, now taken always.
  - [x] **Do not delete `statStay`.** The label stops using it, but `checkInStatValue` (`:1901-1905`) and the value's colour (`:2313`) still do. Removing it would take the cell's two states with it.
  - [x] Delete `trips.dayView.statCheckIn` from both dictionaries once nothing reads it. Grep to confirm; it has one call site today.
  - [x] Consider whether `statCheckInGeneric` should lose the "Generic" in its name now that there is no specific variant to be generic against. Renaming touches both dictionaries and one call site; either choice is fine, but make it deliberately. — **Decided: keep the name.** See Completion Notes.

- [x] **Task 3 — Reconsider the defensive wrap** (AC: 7)
  - [x] `statLabelSx` (`:1264`) carries `overflowWrap: "anywhere"`. It exists so a long accommodation name breaks rather than overflowing — that is, it exists for the exact string this story removes.
  - [x] After this story every label is a short fixed word from the dictionary, so nothing can trigger it in either language. Keep it or drop it, and say which and why. — **Decided: dropped.** See Completion Notes. Keeping it is defensible as insurance for a future language; dropping it is defensible as removing a workaround whose cause is gone. What is not defensible is leaving it unexamined.

- [x] **Task 4 — Tests** (AC: 1, 2, 4, 5)
  - [x] No suite pins any of these three labels today — verified by grep — so this story adds coverage rather than repairing it. — **Not accurate; see Completion Notes.** `tripDayViewLayout.test.tsx` pinned all three ("Total travel time", "Spend today", "Check-in Quinta") in *renders the four stat-strip cells for a populated day*. Repaired as well as extended.
  - [x] Assert the check-in label is identical with and without an accommodation (AC2). This is the assertion that would have caught the original problem.
  - [x] Assert the cell's *value* still differs between the two states, in text and in colour intent (AC5) — the label collapsing must not quietly take the distinction with it.
  - [x] `i18nDictionaries.test.ts` fails if `statCheckIn` leaves one dictionary only.
  - [x] `npm test` green.

- [ ] **Task 5 — Manual check** (AC: 7)
  - [ ] At 390px the strip is two columns of two (`gridTemplateColumns: { xs: "repeat(2, 1fr)", sm: "repeat(4, 1fr)" }`). Confirm no label wraps and both rows are short.
  - [ ] Open a day whose accommodation has a long name — the case that motivated this — and confirm the strip no longer reacts to it at all.
  - [ ] Check German, which has the longer words.
  - [ ] Throwaway copy of `dev.db` on an isolated port — never `prisma/dev.db`. Recipe in `7-12-bucket-list-sidebar-card.md`'s Dev Notes.

## Dev Notes

### What was asked

Tommy on 2026-08-02: *"Im Dayscreen unter dem Bild sind 4 Felder mit wichtigen Daten. Die Texte sind etwas lang, das macht es auf dem Handy schwieriger. 'Fahrzeit gesamt' => 'Fahrzeit', 'Ausgaben heute' => 'Ausgaben', 'Check-in <Ort>' => 'Check-in' (Also Ort weglassen. Das sorgt am Handy dafür, dass diese Zelle sehr groß werden kann, wenn der Text lang ist)."*

### Why the check-in cell is the real one

The other two are a preference. This one is a layout defect with a mechanism:

The strip is a CSS grid, two columns at `xs`. Row two holds **spend** and **check-in**. Grid rows size to their tallest cell, so a long accommodation name in the check-in label does not make that one cell tall — it makes **both** cells in the row tall, spend included. `statLabelSx` carries `overflowWrap: "anywhere"`, so the name breaks mid-word rather than overflowing, which converts an overflow into vertical growth. That is the behaviour Tommy is describing.

Removing user-supplied text from the label removes the mechanism, not just this instance of it.

### Nothing is lost with the name

The accommodation's name still appears twice on the same screen: as the label of its timeline segment (`:1038`, `label: currentStay.name`) and in the cost breakdown (`:1727`, `budgetItemCurrentNight` → "Aktuelle Nacht: {name}"). The stat label was the third occurrence and the only one that could not control its own width.

### An inconsistency this uncovers, deliberately left alone

`dayTotalCents` is rendered twice on the day screen: in this stat cell, labelled "Ausgaben heute", and in the cost card at `:2783`, titled "Kosten heute" with the subtitle "bisher erfasste Ausgaben, Tag {index}". Same number, two nouns, both with "heute".

Shortening one of them to "Ausgaben" does not create ambiguity — the two were already inconsistent, and the card's own subtitle already says which day it means. Whether the app should say "Ausgaben" or "Kosten" for this figure is a separate question worth a deferred-work entry rather than an unplanned rename inside a copy story.

### Traps

**1. `statStay` outlives its label.** The ternary at `:2307-2309` disappears; the variable it tests does not. It still drives `checkInStatValue` and the value's colour. Deleting it because "the label no longer needs it" removes the cell's distinction between "no accommodation" and "check-in unset".

**2. Two keys, one value.** `statCheckInGeneric` already holds "Check-in". Adding a new key with the same string, or keeping `statCheckIn` around unused, both leave the dictionaries worse than before a story whose whole subject is the dictionaries.

**3. The wrap rule is a leftover.** `overflowWrap: "anywhere"` was insurance against the string being removed here. Task 3 asks for a decision, not a default.

**4. This is a copy story.** If the strip still does not fit at 390px after the labels shorten, that is a finding for a new story, not licence to restructure the grid.

### Testing

Vitest 3.2 + Testing Library, jsdom, via `test/helpers/renderWithProviders.tsx`. `tripDayViewLayout.test.tsx` is the natural home; `i18nDictionaries.test.ts` enforces key parity. Grid heights are browser-only — jsdom computes no layout, so AC7 belongs to the manual pass.

### Project Structure Notes

`src/i18n/de.ts`, `src/i18n/en.ts`, `src/components/features/trips/TripDayView.tsx`, and the affected suites. No route, API or schema change.

### Sequencing

Independent of 6.19 and 6.20. It touches `TripDayView.tsx` like 6.19 does, but a different region — the stat strip at `:2255-2318` rather than the hero — so the two only conflict if both are in flight at once.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 6.21]
- [Source: travelplan/src/components/features/trips/TripDayView.tsx:2255-2318] — the four cells
- [Source: travelplan/src/components/features/trips/TripDayView.tsx:1264] — `statLabelSx` and its wrap rule
- [Source: travelplan/src/i18n/de.ts:245-248] — the three labels
- [Source: travelplan/src/components/features/trips/TripDayView.tsx:1038,1727] — where the stay name still appears

## Operator Pass — 2026-08-02, against `cec3505`

Chromium, German, at 390px **and 600px**, isolated worktree on port 3099 against a copy of `dev.db`.

- **AC7 at 390px** (2 columns, 178px cells): all four labels are a single line box and **none is clipped** — checked explicitly, because with `overflowWrap` removed and the wrapper's `overflow: hidden` a label that no longer fits would be cut off silently rather than spilling.
- **AC7 at 600px** (4 columns, **137.5px** cells — tighter than the phone, and covered by no acceptance criterion or test): also single-line, also unclipped. The gap the operator action flagged is closed.
- **The original defect is gone:** with an accommodation named "Grandhotel Schloss Bergblick am Wasserfall" the cells measure 86/85px — the same as any other day — and the spend cell beside check-in no longer grows in sympathy. This is the direct proof AC2 was written for.
- **AC5:** the two states still differ in the *value*: a booked stay shows "21:00" in ink `rgb(43,42,38)`, a day without one shows "Keine Unterkunft" in the warning tone `rgb(138,90,43)`.

**DW-135 confirmed, and larger than the entry assumed.** On a day with no accommodation the value "Keine Unterkunft" wraps to **2 lines at 390px** and **3 lines at 600px**, growing the row by **+31px at both widths**. That is the same mechanism this story removed from the label, surviving in the value — and a day without a stay is far more common than a very long hotel name, so it is arguably the bigger remaining trigger of the original complaint.

## Dev Agent Record

### Agent Model Used

claude-opus-5[1m]

### Debug Log References

- `grep -rn "statCheckIn\|statTravelTime\|statSpendToday\|statLabelSx\|statStay\|statDay" src test` — located the four cells, the two `statStay` value/colour readers, and (contra Task 4's first bullet) the three existing label assertions in `tripDayViewLayout.test.tsx`.
- `grep -rn "statCheckIn" src test` after the change → three hits, all `statCheckInGeneric` (one call site, one key per dictionary). No orphan, no duplicate.
- `npx vitest run test/i18nDictionaries.test.ts` → 31 passed (was 26).
- `npx vitest run test/tripDayViewLayout.test.tsx` → 96 passed (was 94).
- `npm test` → **105 files, 984 tests, all passed**, 132.9s.
- `npm run lint` → 2 errors, 83 warnings — all pre-existing, both errors in `src/theme.ts` (`react/no-children-prop`), untouched by this story.
- `npx tsc --noEmit` → 143 errors. Baseline confirmed by `git stash push -- travelplan/src travelplan/test` + re-run: **143 before, 143 after.** No new type errors. The nine in `tripDayViewLayout.test.tsx` are all at lines 76–2889, well above this story's edits (~4166+), and are the file's long-standing `as unknown as typeof fetch` cast pattern.

### Completion Notes List

**What changed.** `statTravelTime` and `statSpendToday` shortened in both dictionaries. The check-in cell's label collapsed from the `statStay ? formatMessage(statCheckIn, {name}) : statCheckInGeneric` ternary to an unconditional `t("trips.dayView.statCheckInGeneric")`, and `trips.dayView.statCheckIn` was deleted from both `de.ts` and `en.ts`. `statStay` survives untouched — it still computes `checkInStatValue` and still picks `tokens.ink` vs `theme.palette.warning.main` for the value. `statDay`, `statDayValue`, the grid, borders, `statCellSx` padding and the `labelCaps` variant are unchanged.

**Deliberate decision 1 — `statCheckInGeneric` keeps its name.** The tempting move is to rename it into the now-free `statCheckIn`, which is the name its three siblings' pattern implies. Rejected — but *not* for the reason first recorded here, which the review pass found to be invalid and which has been corrected in the code comment. (The original argument was that renaming would make "deleted correctly" indistinguishable from "left orphaned". It would not: an orphan's value is `"Check-in {name}"` and a renamed survivor's is `"Check-in"`, and `toBe("Check-in")` separates them exactly.)

The reason that does hold: `statCheckIn` is a **retired** name, not a free one. It is quoted as the strip's parameterised key in shipped specs — `7-3-day-detail-redesign.md` still lists it with its `{name}` placeholder, and 7.11 references it too — and throughout this repo's history. Rebinding it to a string with different semantics makes every one of those references silently wrong instead of obviously stale. A mildly odd suffix costs one comment; a rebound key costs a future reader a wrong answer. Recorded at the guard in `i18nDictionaries.test.ts`, and the stale 7.3 reference is logged as DW-139.

**Deliberate decision 2 — `overflowWrap: "anywhere"` dropped from `statLabelSx`.** Dropped, not kept. The rule and the bug are the same object: breaking a hotel name mid-word is exactly what converted an overflow into a taller grid *row*, and a grid row is as tall as its tallest cell, so the spend cell grew alongside it. Removing the user text while keeping the wrap rule disarms this instance and leaves the mechanism loaded for whoever next interpolates something into a label.

The review pass corrected two things about how this was justified, without changing the decision:

- **The claim "without the rule that mistake overflows visibly" was false.** The strip sits inside a wrapper that sets `overflow: hidden`, so a label that outgrows its cell is *clipped*, silently. The honest trade is therefore clipping-one-label versus growing-a-whole-row, and clipping still wins — but it is a quiet failure, which raises the burden on the guard. Logged as DW-138: giving the labels `nowrap` + `textOverflow: ellipsis` would deliver no row growth *and* a visible signal, and is deliberately not done inside a story whose AC6 says the label typography is untouched.
- **The pixel budget omitted the page gutters.** `Container maxWidth="lg"` contributes MUI's default 16px xs gutters and the wrapper adds borders, so the column is ~130px at 390px, not ~147px. "TRAVEL TIME" at ~86px still fits with room, so the decision holds; the comment now shows the arithmetic. The review also found the *narrowest* cell is not the phone at all: at `sm` the grid goes to four columns, so a 600px viewport gives ~89px per cell.

Compensating controls, since jsdom computes no layout: the reasoning is written at the declaration site; `i18nDictionaries.test.ts` guards the four labels — capping the **longest unbroken word** at 10 characters (the binding constraint now that nothing can break mid-word, sized against the ~89px `sm` cell rather than the roomier phone), the whole string at 14, and forbidding a `{` placeholder; and a computed-style assertion in `tripDayViewLayout.test.tsx` pins the absence of the rule so re-adding it has to argue with a test first. Both guards were mutation-checked — re-adding `overflowWrap` and lengthening a German label each fail with a message naming the actual problem.

**`statValueSx` keeps its `overflowWrap: "anywhere"`** — out of Task 3's scope, and still load-bearing: the value renders "No accommodation" / "Keine Unterkunft" in the same narrow cell. Its comment claimed cell 4's *label* could hold an accommodation name; that sentence became false with this change, so it was corrected to describe only the value. That the value itself still wraps and grows the row on every gap day — the same mechanism, one element down — is logged as DW-135; it is the most consequential thing this review found and it is explicitly out of scope per Trap 4.

**Divergence from the spec.** Task 4's first bullet ("No suite pins any of these three labels today — verified by grep") is wrong. `tripDayViewLayout.test.tsx` → *renders the four stat-strip cells for a populated day* asserted `getByText("Total travel time")`, `getByText("Spend today")` and `getByText("Check-in Quinta")`. All three were updated, and `queryByText("Check-in Quinta")` was added as the negative. So the story repairs existing coverage as well as adding new. Nothing else diverged.

**New coverage.**
- `tripDayViewLayout.test.tsx` → *uses one check-in label for both states while the value keeps them apart* (AC2, AC5). Renders once with a 56-character accommodation name and once with `missingAccommodation: true`, reading the label **positionally** (the cell's `firstElementChild`) rather than via `getByText("Check-in")` — a query that names the expected text cannot observe a label that is wrong, which is the whole point of AC2. Asserts the two labels are equal to each other and to `"Check-in"`, and that neither contains the name. Then asserts AC5 survives: value `"16:00"` vs `"No accommodation"`, colour `theme.palette.tokens.ink` vs `theme.palette.warning.main` — derived from the palette, not written as raw rgb triples, so a retuned token moves the expectation with it and only an actual collapse of the two fails — plus the two colours differ from each other. It also pins the Task 3 decision via `getComputedStyle` on the label, and asserts the value *keeps* its own wrap rule.
- `tripDayViewLayout.test.tsx` → *renders the shortened stat labels in German*. German carries the longer words and is the language the 390px check turns on; pins "Fahrzeit"/"Ausgaben"/"Check-in" and asserts "Fahrzeit gesamt"/"Ausgaben heute" cannot come back. All three label reads are scoped to their own cell — German has other "Check-in…" strings on this screen (`trips.stay.checkInLabel` is "Check-in-Zeit"), so the one label this story is about must not be read with a document-wide query.
- `i18nDictionaries.test.ts` → new `story 6.21 stat strip labels` block: `statCheckIn` absent from both dictionaries (AC4 — the orphan case the parity check structurally cannot see, since a key present in *both* dictionaries and read by *nobody* satisfies it); `statCheckInGeneric === "Check-in"` in both; the two shortened values pinned per language (AC1); and the length/no-placeholder guard described above. The guard iterates the `dictionaries` registry from `src/i18n/index.ts` rather than a hardcoded `[en, de]`, so a third locale inherits it instead of escaping it, and asserts each value is a string before measuring it so a key missing from one locale fails by name rather than throwing.

**AC status.** AC1–AC6 are satisfied and covered by tests. **AC7 is not verified** — see Task 5.

**What Task 5 still owes a human.** Not attempted: it is a browser check and the instructions forbid starting the dev server or touching `prisma/dev.db`. Task 5 and its subtasks are left unticked. A human must, at a 390px viewport where the strip is `repeat(2, 1fr)`:
1. Confirm none of the four labels wraps to a second line — **in German especially**. Note that `overflowWrap: "anywhere"` is gone, so a label that no longer fits will be *clipped at the cell edge* with no ellipsis (the strip's wrapper sets `overflow: hidden`), which means the failure is quiet: look for a label that reads as cut off, not one spilling over. If it appears, the finding is that a label is still too long, and per Trap 4 it is a copy fix or a new story, not licence to restructure the grid.
2. Open a day whose accommodation has a long name and confirm the strip's two rows are the height of their content and do not react to the name at all — in particular that the **spend** cell no longer grows in sympathy with the check-in cell beside it. This is the original defect and the only direct proof it is gone.
3. Confirm the check-in cell still reads correctly in both states in the browser: a booked stay shows the time in ink, a day with no accommodation shows "Keine Unterkunft" in the warning tone.
4. Added by the review pass — check a day with **no accommodation** at 390px. The value "Keine Unterkunft" is 16 characters at 21px/900 in a ~130px cell and is expected to wrap and grow row 2 by the same mechanism this story removed from the label. That is DW-135, out of scope here, but this pass is the cheapest place to confirm or dismiss it.
5. Also added by the review pass — check the strip at a **600px** viewport, not only 390px. At `sm` the grid goes to four columns, which makes each cell ~89px, narrower than on the phone. It is the tightest point for "TRAVEL TIME" and neither AC7 nor any test covers it.

**Noted, and now logged.** Five findings were routed to the deferred-work ledger rather than fixed here: DW-135 (the gap-day value still grows the row), DW-136 ("Ausgaben" vs "Kosten heute" for the same number — the entry the Dev Notes called for), DW-137 (a moving day's check-in cell no longer says which stay), DW-138 (labels clip silently; `nowrap` + ellipsis would fix that), DW-139 (spec 7.3 still names the deleted key).

### File List

- [../../travelplan/src/components/features/trips/TripDayView.tsx](../../travelplan/src/components/features/trips/TripDayView.tsx) — check-in label collapsed to the constant; `overflowWrap` removed from `statLabelSx`; `statValueSx` comment corrected; review pass rewrote the two decision comments to match the code's actual behaviour
- [../../travelplan/src/i18n/de.ts](../../travelplan/src/i18n/de.ts) — `statTravelTime`, `statSpendToday` shortened; `statCheckIn` deleted
- [../../travelplan/src/i18n/en.ts](../../travelplan/src/i18n/en.ts) — `statTravelTime`, `statSpendToday` shortened; `statCheckIn` deleted
- [../../travelplan/test/tripDayViewLayout.test.tsx](../../travelplan/test/tripDayViewLayout.test.tsx) — three existing label assertions updated; two tests added; review pass added the `overflowWrap` pin, derived the colour assertions from the palette, and scoped the German check-in read to its cell
- [../../travelplan/test/i18nDictionaries.test.ts](../../travelplan/test/i18nDictionaries.test.ts) — `story 6.21 stat strip labels` block added; review pass replaced the character ceiling with a longest-word bound, made it iterate the dictionary registry, and corrected the recorded reason for keeping the `Generic` suffix
- [deferred-work.md](deferred-work.md) — DW-135 … DW-139 appended

### Change Log

| Date | Change |
| --- | --- |
| 2026-08-02 | Story 6.21: shortened the day stat strip's three long labels and removed the accommodation name from the check-in label, so no user-supplied text can set the strip's row height at 390px; deleted the now-unread `trips.dayView.statCheckIn` from both dictionaries and dropped the `overflowWrap: "anywhere"` workaround it existed for. AC7 awaits the manual 390px pass. |
| 2026-08-02 | Review pass: eight patches, all to comments and tests, no behaviour change. Corrected two factually wrong justifications (the labels clip rather than overflow visibly; the column is ~130px not ~147px), replaced the invalid reason for keeping the `Generic` suffix, hardened the dictionary guard into a longest-word bound over the locale registry, pinned the `overflowWrap` decision with a computed-style assertion, and logged DW-135 … DW-139. |

## Review Triage Log

### 2026-08-02 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 8: (high 0, medium 0, low 8)
- defer: 5: (high 0, medium 1, low 4)
- reject: 5: (high 0, medium 0, low 5)
- addressed_findings:
  - `[low]` `[patch]` The `statLabelSx` comment claimed a too-long label would "overflow visibly"; the strip's wrapper sets `overflow: hidden`, so it is clipped silently. Comment rewritten to state the real trade, and DW-138 logged for the `nowrap` + ellipsis fix that would give both properties.
  - `[low]` `[patch]` The same comment's pixel budget (~147px at 390px) omitted the `Container`'s 16px xs gutters and the wrapper borders. Corrected to ~130px with the arithmetic shown; the decision is unaffected since "TRAVEL TIME" is ~86px.
  - `[low]` `[patch]` The cell comment claimed the stay's name "is still on screen twice"; the cost breakdown filters on `amountCents !== null`, so an un-priced stay shows it once. Reworded to say so.
  - `[low]` `[patch]` The Task 3 decision had no test — re-adding `overflowWrap` passed all 984 tests. Added a `getComputedStyle` assertion on the label plus its counterpart on the value; mutation-checked.
  - `[low]` `[patch]` The recorded reason for keeping the `Generic` suffix was invalid (a renamed survivor and an orphan differ by value, so a test *can* tell them apart). Replaced with the reason that holds: `statCheckIn` is a retired name quoted in shipped specs, and rebinding it would make those references silently wrong.
  - `[low]` `[patch]` The dictionary guard capped total characters at 12 — a weak proxy, since nothing can break mid-word any more, the text is uppercased at render, and the narrowest cell is the four-column `sm` layout (~89px) not the phone. Replaced with a longest-unbroken-word bound of 10 plus a 14-character string cap, now iterating the `dictionaries` registry so a third locale cannot escape it, with a string-type assertion before measuring. Mutation-checked.
  - `[low]` `[patch]` A pre-existing comment in `tripDayViewLayout.test.tsx` still named "Spend today", a string this story deleted, three lines above a new comment about the same assertions. Merged into one correct comment.
  - `[low]` `[patch]` Two brittle expectations in the new tests: raw `rgb(...)` triples instead of palette tokens, and a document-wide `getByText("Check-in")` in the German test where the other two reads are cell-scoped. Both fixed.

Deferred: DW-135 (the gap-day value still wraps and grows row 2 — the same mechanism one element below the label, and out of scope per Trap 4), DW-136 ("Ausgaben" vs "Kosten heute"), DW-137 (a moving day's check-in cell no longer names its stay), DW-138 (labels clip silently), DW-139 (spec 7.3 still lists the deleted key).

Rejected: AC7 being unverified (disclosed by design — it is Task 5, and the operator actions below carry it); `statSpendToday`'s key name still saying "today" (churn across dictionaries, call site and tests for no user-visible gain); the vacuous `queryByText("Check-in Quinta")` negative (redundant, but the positive assertion was mutation-proven to catch a reintroduced name); a missing i18n key rendering its raw dotted string into a clipped label (guarded by the parity test); and a German no-stay render (the English test covers the branch and parity covers the string).

## Auto Run Result

Status: awaiting-operator — every part an agent can do is complete and committed; AC7 is a browser judgement.

**What changed.** The day view's four-cell stat strip carries shorter labels: "Fahrzeit gesamt" → "Fahrzeit", "Ausgaben heute" → "Ausgaben", and the check-in cell now reads a bare "Check-in" instead of "Check-in {hotel name}". The last is the one that mattered — the strip is a two-column grid on a phone and a grid row is as tall as its tallest cell, so a long hotel name in that label grew the spend cell beside it too. `trips.dayView.statCheckIn` is deleted from both dictionaries; `statStay` survives and still drives the cell's value and its ink-vs-warning colour, so the two states still read differently.

**Files changed.** See the File List above — three source files, two test files, and the deferred-work ledger.

**Findings.** 8 patches applied (all low, all comments and tests, no behaviour change), 5 items deferred (DW-135 … DW-139, one medium), 5 rejected. No intent gaps and no spec defects: the spec was specific enough that the implementation matched it on the first pass, and every patch was about how a decision was *justified* rather than what was decided.

**Verification.** `npm test` → 105 files, 984 tests, all passing. Both new guards mutation-checked: re-adding `overflowWrap: "anywhere"` and lengthening a German label each fail with a message naming the real problem. `npm run lint` → 2 errors, 83 warnings, byte-identical to the documented baseline (both errors are the pre-existing `react/no-children-prop` pair in `theme.ts`, DW-134). `npx tsc --noEmit` → 143 errors, unchanged from baseline, verified by stash-and-rerun. Grep confirms `statCheckIn` has no reader left anywhere in `src/`, `test/` or e2e.

**Residual risks.** AC7 is unverified and cannot be verified here — jsdom computes no layout, so nothing in the suite can see whether a label wraps. The arithmetic says it fits with ~44px of room at 390px, but the arithmetic was wrong once already in this story. The tighter case is a 600px viewport, where the grid goes to four columns and each cell is ~89px against a ~86px label; no AC covers it. Separately, the strip can still grow on a day with no accommodation (DW-135) — the story's claim is that no *user-supplied text* can set the row height, which is true and narrower than "the strip no longer grows".

## Operator Confirmation

Confirmed 2026-08-02: the external actions this story owed were carried out.

- Run the app in a browser to do Task 5, on a throwaway copy of dev.db on an isolated port — never prisma/dev.db. The recipe is in the Dev Notes of _bmad-output/implementation-artifacts/7-12-bucket-list-sidebar-card.md. AC7 is the only one of the seven acceptance criteria that needs that session, and nothing in the suite can substitute: jsdom computes no layout at all, so no test can see whether a label wraps.
- At a 390px viewport, open a day and look at the four-cell strip under the photo. Confirm none of the four labels wraps to a second line and that both grid rows are the height of their content. Check German first — it has the longer words and is the language this turns on.
- Note what a failure looks like, because it is quiet: overflowWrap: "anywhere" was deliberately removed from the labels, and the strip's wrapper sets overflow: hidden, so a label that no longer fits is clipped at the cell edge with no ellipsis rather than visibly spilling. Look for a label that reads as cut off. If you see one, that is a copy fix or a new story — per Trap 4 it is not licence to restructure the grid.
- Open a day whose accommodation has a long name — the case that started this — and confirm the strip does not react to it at all. Specifically watch the spend cell next to check-in: it used to grow in sympathy because a grid row is as tall as its tallest cell, and that is the defect this story exists to remove. This is the only direct proof it is gone.
- Confirm the check-in cell still tells its two states apart in the browser: a booked stay shows the check-in time in ink, a day with no accommodation shows "Keine Unterkunft" in the warning tone. The label is now identical in both cases by design (AC2) — it is the value that must still differ.
- While on a day with no accommodation, look at whether "Keine Unterkunft" itself wraps and grows row 2. It is 16 characters at 21px in a ~130px cell, so it probably does. That is DW-135, deliberately out of scope here, but this is the cheapest moment to confirm or dismiss it — and it is arguably a more common trigger of the original complaint than a long hotel name.
- Also check the strip at a 600px viewport, not only at 390px. At sm the grid goes to four columns, which makes each cell about 89px — narrower than on the phone. That is the tightest point for "TRAVEL TIME" (~86px) and no acceptance criterion or test covers it.
- If every check passes, tick Task 5 in this spec, set status: done in the frontmatter and Status: done in the body, and set 6-21-shorter-day-stat-labels to done in sprint-status.yaml.

_Appended by the bmad-loop orchestrator (`bmad-loop confirm`, #335): a human confirmed these external actions out of band, and the story was advanced from `awaiting-operator` to `done`._
