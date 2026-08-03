---
authored_against: 0ab5e0e
baseline_revision: 8f419d229b37ccaf08474e1f1032dbb7127c7ac1
final_revision: fcc88ec5a3cd86b292d3002ac92f47a0518b9632
status: done
review_loop_iteration: 0
followup_review_recommended: true
warnings: []
operator_actions:
  - "Do Task 6 in a real browser, on a throwaway copy of dev.db on an isolated port — never prisma/dev.db. The recipe is in the Dev Notes of _bmad-output/implementation-artifacts/7-12-bucket-list-sidebar-card.md. AC6 and AC9 are the two criteria nothing in the suite can reach: jsdom computes no layout and does not resolve responsive sx, so no test can measure a panel or judge two controls at a glance."
  - "Run the app in German — the four tab labels are longest there and the German set is the binding one. Open a day, open an activity, and check at a 390px viewport that all four labels ('Was', 'Wann & Wo', 'Kosten', 'Medien & Links') sit on one row without the bar turning scrollable. If any tab is cut off or the bar scrolls, that is a copy fix on the label, not a change to variant='scrollable' — a scrollable bar hides tabs and works against the whole story."
  - "AC9 is the measurement the story exists for. At 390px, measure the content height of the tallest panel (Kosten in split mode with three or more payment rows is the candidate) against the 1341px the whole form measured before this change. Record the number in the Dev Agent Record either way. If the tallest panel is not clearly shorter, the grouping needs revisiting and that is a new story, not an edit here."
  - "AC6, and it is a judgement call no test can make: with the Was tab open, look at the tab bar and the formatting toolbar directly below it (B, I, list, link, image) and confirm they do not read as one control. The tab bar is deliberately the pill switch from AuthTabs and the toolbar is five outlined squares; if they still read as one stacked widget, say so — the fix is spacing or a divider, not new tab semantics."
  - "Walk the add flow end to end on a phone, which Trap 2 says is the flow that pays for tabs: create a new activity, visit all four tabs, and judge whether the taps cost more than the scrolling saved. This is the case where the story could be wrong, and it is the one only a person can judge."
  - "On the add flow's Medien & Links tab, confirm the new line 'Fotos kannst du hinzufügen, sobald der Planpunkt gespeichert ist.' appears in place of the gallery, and that the gallery is there as normal when you reopen the saved item for editing."
  - "Check the error path by hand, because it is the risk the whole design turns on: on the Kosten tab type a nonsense amount ('zwölf Euro'), switch to Was, and press Speichern. The dialog must jump to Kosten, put the caret in the amount box, and show a warning triangle on the tab that is legible against the white selected pill (it is now #8A5A2B, not the old pale sand). Then fix the amount and confirm the triangle disappears without another save."
  - "Switch tabs with the arrow keys, not the mouse, and confirm Left/Right move between the four tabs — this comes from MUI and the test suite mocks MUI away, so nothing in the repo verifies it (DW-146)."
  - "If every check passes, tick Task 6 in this spec, set status: done in the frontmatter and Status: done in the body, and set 6-22-activity-dialog-in-tabs to done in sprint-status.yaml."
---

# Story 6.22: The Activity Dialog in Tabs

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner on a phone,
I want the activity dialog split into four tabs instead of one long scroll,
so that I can see what a section holds without scrolling through everything that comes before it.

## Acceptance Criteria

1. **Four tabs, and none of them holds a single field.**
   - **Was** — Titel, Beschreibung (with its own formatting toolbar)
   - **Wann & Wo** — Von, Bis, Ort
   - **Kosten** — Betrag, Zahlungsart, die Zahlungszeilen
   - **Medien & Links** — Galerie, Link
2. **An error is never invisible.** Every tab holding a field with an error carries a visible marker, and pressing save from any tab switches to the **first** tab with an error and puts focus on the offending field. Saving must never fail silently because the message is on a tab the user cannot see.
3. **The error-to-tab map is total and the compiler enforces it.** `fieldErrors` has six keys today — `title`, `contentJson`, `fromTime`, `toTime`, `costCents`, `linkUrl` — plus `paymentError` and `paymentRowErrors`. The map is typed so that adding a seventh key without assigning it a tab fails to compile.
4. **Nothing is lost by switching tabs.** Typed-but-unsaved values, the rich-text content, the selected files and an in-flight upload all survive moving away and back.
5. **It is not a wizard.** No Next/Back; every tab is reachable at any time, and Abbrechen/Speichern stay visible from all four.
6. **The tab bar does not read as a second toolbar.** The description already carries one (B, I, list, link, image). The two must be distinguishable at a glance at 390px.
7. **Tab semantics, not styled buttons.** `role="tablist"`/`tab`/`tabpanel` with `aria-controls`/`aria-selected`, arrow-key navigation between tabs, and each panel labelled by its tab.
8. **Behaviour is unchanged.** Every field, validation rule, default, upload path and save path works exactly as before. This story changes where a field is, not what it does.
9. **Shorter, measurably.** At 390px the tallest tab's content is shorter than today's whole form — which measures **1341px of content in a 556px window**, 2.4 screens.

## Tasks / Subtasks

- [x] **Task 1 — The four panels** (AC: 1, 5, 8)
  - [x] `TripDayPlanDialog.tsx` is 1284 lines; the form body runs from the title `FormField` at `:948` to the gallery at `:1243`. Move blocks into panels — do not rewrite them.
  - [x] Grouping is decided (AC1) and follows from Tommy's own point: a tab with one control costs a tap and gives nothing. `Wann & Wo` pairs the two time fields with the location search; `Medien & Links` pairs the gallery with the link.
  - [x] `Kosten` is one block that expands: `paymentMode` (`single`/`split`) reveals repeatable amount/date rows. It earns its tab by expansion, not by field count.
  - [x] Keep `DialogActions` outside the panels. Save is not per-section.

- [x] **Task 2 — Errors cannot hide** (AC: 2, 3)
  - [x] This is the acceptance criterion the story exists to satisfy safely. A tabbed form that reports an error on a hidden tab is worse than the long scroll it replaced.
  - [x] Build the map as a typed total function over the error keys, e.g. `Record<keyof FieldErrors, TabId>`, so the compiler refuses an unmapped key. `paymentError` and `paymentRowErrors` live outside `fieldErrors` and need mapping too — decide whether to fold them in or map them separately, and say which.
  - [x] On save: compute the errors, and if any exist select the first tab (in tab order) that owns one, then focus that field. Do not merely mark the tab.
  - [x] The marker must not rely on colour alone.

- [x] **Task 3 — Nothing is lost** (AC: 4)
  - [x] Good news, and worth knowing before designing around it: **every field is already `useState` in the dialog** (`:220-256`), not `react-hook-form`. State lives above the fields, so an unmounted panel cannot drop a value. The usual tabbed-form data-loss trap does not apply here — do not add machinery to solve a problem that is already solved.
  - [x] The TipTap editor is created at dialog level with `useEditor` (`:280`), so content and undo history survive too; only `EditorContent`'s DOM host is re-attached. Check after switching away and back that the toolbar buttons still act on the editor and that undo still reaches edits made before the switch.
  - [x] `galleryBusy` guards an upload in progress (`:1247`, `:1259`). Switching tabs mid-upload must not cancel it or lose the result.
  - [x] Decide whether panels unmount or stay mounted and hidden, and record why. Unmounting is cheaper and safe for state; it costs scroll position and DOM focus.

- [x] **Task 4 — Tabs, not a toolbar** (AC: 6, 7)
  - [x] Tommy suggested "Tabs oder eine Toolbar". A toolbar is the wrong form here: the description already has one directly below, and two toolbars stacked read as one broken control. Tabs carry their own indicator and separate cleanly.
  - [x] MUI `Tabs`/`Tab` give the ARIA wiring and arrow-key handling. Use them rather than hand-rolling buttons.
  - [x] At 390px four German labels must fit — `variant="scrollable"` if they do not, but check before reaching for it, because a scrollable tab bar hides tabs and works against the story.

- [x] **Task 5 — Tests** (AC: 1, 2, 4, 8)
  - [x] `tripDayPlanDialog.test.tsx` is **1308 lines and 13 tests**, and nearly every one queries a field directly. If panels unmount, those fields are absent until their tab is selected — so most of the file needs a "select the tab first" step. Write one helper rather than repeating it.
  - [x] Four smaller files also import this dialog (`tripDayPlanDialogImport`, `…ImportWithMocks`, `…MockMuiDialogImport`, `…MockMuiImport`). They test import shape rather than behaviour and should survive — confirm rather than assume.
  - [x] New: an error on a non-active tab marks that tab; saving from tab 1 with an error on tab 3 switches to tab 3 and focuses the field (AC2). This is the assertion that makes the whole story safe.
  - [x] New: type in a field, switch tabs, switch back, and the value is still there (AC4).
  - [x] New: the error-to-tab map covers every key — a table-driven test, so a future key without a tab fails.
  - [x] `npm test` green.

- [ ] **Task 6 — Manual check** (AC: 6, 9)
  - [ ] jsdom computes no layout, so AC9 is browser-only.
  - [ ] At 390px measure the tallest panel's content height against today's 1341px.
  - [ ] Confirm the tab bar and the editor toolbar do not read as one control (AC6), in German, where labels are longest.
  - [ ] Walk the add flow end to end on a phone: this is where tabs cost the most, and it is the case to judge.
  - [ ] Throwaway copy of `dev.db` on an isolated port — never `prisma/dev.db`. Recipe in `7-12-bucket-list-sidebar-card.md`'s Dev Notes.

## Dev Notes

### What was asked, and what was measured

Tommy on 2026-08-02: *"Der Dialog für eine Aktivität ist mittlerweile recht lang geworden. Wäre es da nicht sinnvoll, wenn wir diesen in Bereiche aufteilen und diese z.B. mit Tabs oder einer Toolbar umschalten könnten? … Vielleicht könnten wir auch etwas zusammenlegen, damit es nicht nur ein Element ist."*

Measured at 390×844 before writing this: the dialog's content area is **556px tall and holds 1341px of content** — 2.4 screens — with **11 input fields**, and that is the *empty* add form. Split payments and a populated gallery make it taller.

Tabs were chosen over collapsible sections and a single "Weitere Angaben" toggle, with the error-visibility risk stated and accepted. AC2 is what makes that choice safe, so it is not optional.

### The grouping came from the right instinct

Tommy's own caveat — *"damit es nicht nur ein Element ist"* — is the reason this has four tabs and not six. A tab holding one field costs a tap and returns nothing.

### Two fears that turned out to be unfounded

Both were checked in the source before this spec was written, because both would have changed the shape of the work:

1. **Data loss on switching.** Every field is plain `useState` in the dialog (`:220-256`). There is no `react-hook-form`, so nothing unregisters and no value can be dropped by an unmounting panel.
2. **The rich-text editor.** `useEditor` runs at dialog level (`:280`), so the Editor instance — content and undo history — outlives any panel. Only `EditorContent`'s host div is re-attached.

Neither needs defending against. Say so in the Dev Agent Record rather than adding machinery.

### The one real risk

A tabbed form that reports a validation error on a tab the user is not looking at. Press Speichern, nothing appears to happen, and the reason is one tab away. That is the single most common way this pattern fails, and it is why AC2 asks for *switching and focusing* rather than for a marker alone.

The mapping is small and total today, which is the moment to make it compiler-enforced:

| Tab | Error keys |
|---|---|
| Was | `title`, `contentJson` |
| Wann & Wo | `fromTime`, `toTime` |
| Kosten | `costCents`, `paymentError`, `paymentRowErrors` |
| Medien & Links | `linkUrl` |

`Ort` and `Galerie` carry no error key today. If either gains one, AC3's typing is what makes the omission a compile error rather than an invisible bug.

### Traps

**1. Do not make it a wizard.** Tabs are random access. Next/Back turns editing one field into a walk through four screens — the opposite of what this story is for.

**2. The add flow pays for this, the edit flow gains.** Adding means visiting every tab; editing usually means one. AC5 and Task 6's walk-through exist so the cost to the add flow is looked at rather than assumed away.

**3. Two toolbars.** The tab bar sits directly above a formatting toolbar. If both are rendered as rows of small controls they read as one broken widget.

**4. The test file is the bulk of the work.** 1308 lines, 13 tests, nearly all querying fields that will not be in the DOM until their tab is selected.

**5. Do not rewrite the blocks.** Costs, payments, the location search and the gallery each carry their own history. This story moves them.

### Testing

Vitest 3.2 + Testing Library, jsdom, via `test/helpers/renderWithProviders.tsx`. `tripDayPlanDialog.test.tsx` is the constraint, plus four small import-shape suites. AC6 and AC9 are browser-only.

### Project Structure Notes

`src/components/features/trips/TripDayPlanDialog.tsx` and both i18n dictionaries (four tab labels). No route, API, schema or validation change.

### Sequencing

Independent of 6.17–6.21. It touches no file they touch except the dictionaries, where it only adds keys.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 6.22]
- [Source: travelplan/src/components/features/trips/TripDayPlanDialog.tsx:220-256] — the state, and why nothing is lost
- [Source: travelplan/src/components/features/trips/TripDayPlanDialog.tsx:242-249] — `fieldErrors`, the keys the map must cover
- [Source: travelplan/src/components/features/trips/TripDayPlanDialog.tsx:280] — the editor instance, above any panel
- [Source: travelplan/src/components/features/trips/TripDayPlanDialog.tsx:948-1243] — the form body to be split

## Operator Pass — 2026-08-03, against `1cb5a84`

Chromium, German, 390px, isolated worktree on port 3099 against a copy of `dev.db`.

- **Tabs (action 2):** `Was` / `Wann & Wo` / `Kosten` / `Medien & Links` on **one row**, tablist 268px, **not** scrollable.
- **AC6 (action 4):** **154px** between the tab bar and the editor's formatting toolbar. They cannot be mistaken for one control.
- **Error path (action 7) — the criterion the design turns on, and it works.** With "zwölf Euro" in the amount and the `Was` tab active, pressing save **switched to `Kosten` and put focus in the amount field**. Correcting the value cleared the error **without a second save**.
- **Arrow keys (action 8):** `ArrowRight` moves *focus* from `Was` to `Wann & Wo`; `Enter` activates it. That is the ARIA manual-activation pattern and it is correct. *A first measurement that only read `aria-selected` reported this as broken — it is not.*
- **Add flow (action 6):** the `Medien & Links` tab carries "Fotos kannst du hinzufügen, sobald der Planpunkt gespeichert ist." and no gallery; the gallery is present when editing a saved item.

**AC9, and it needs qualifying.** Panel content heights at 390px: `Was` 485px, `Wann & Wo` 513px, `Kosten` 516px, `Medien & Links` 478px — the tallest is **516px against the 1341px** the whole form measured, a 62% reduction. But the `Kosten` panel grows ~246px per payment row once split payments are on:

| payment rows | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| content | 516px | 895px | 1141px | **1388px** | **1634px** |

So it crosses the 1341px figure at **four rows**. Read literally AC9 fails there; read as intended it holds, because the 1341px baseline was measured with a *single* payment and the same content pre-change would have been ~2080px — the tab still saves ~700px. The split-payment block is unbounded by nature, which is a grouping question rather than a defect in this story. Recorded as DW-149.

**Noticed while measuring:** `trips.plan.costInvalid` reads "Bitte einen **gueltigen** …" while `trips.travelSegment.linkInvalid` and `trips.stay.costInvalid` both write "gültigen". An ASCII fallback in a user-facing error. DW-150.

## Dev Agent Record

### Agent Model Used

Claude Opus 5

### Debug Log References

Run from `travelplan/`:

- `npx tsc --noEmit` — 143 errors, **byte-identical to the pre-change baseline** (captured by stashing this
  story's diff and re-running). Every one is in `test/*.ts(x)` and pre-dates this story; the two most
  common are `Property 'mock' does not exist on type … typeof fetch` (the `as unknown as typeof fetch`
  idiom this repo's route tests use) and `'id' does not exist in type 'Promise<{ id?: string }>'` (Next 16
  async route params). **No error in `src/`, and none added.** The one `fetchMock.mock.calls` line the new
  AC2 test first used was rewritten to `expect(fetchMock).not.toHaveBeenCalledWith(…)` precisely so this
  story adds nothing to that count.
- `npm run lint` — `✖ 85 problems (2 errors, 83 warnings)`, the same set as baseline. The only diff is that
  three pre-existing `react-hooks` warnings in `TripDayPlanDialog.tsx` moved from `337:5 / 414:7 / 455:9`
  to `516:5 / 596:7 / 637:9` because the file grew above them. Both errors are `react/no-children-prop` in
  another file and pre-date this story.
- `npm test` — `Test Files 110 passed (110) · Tests 1092 passed (1092)`. `tripDayPlanDialog.test.tsx` went
  from 13 to 25 tests.
- AC3's compiler guard was **verified rather than assumed**: adding a throwaway seventh key to
  `PlanFieldErrors` and re-running `tsc` produced two errors — `TS2741: Property 'seventhKey' is missing …
  in type 'Record<PlanErrorKey, …>'` and `TS2322: Type '"seventhKey"' is not assignable to type 'never'`
  (the focus resolver's exhaustiveness default). The key was then removed.

### Completion Notes List

**The error→tab map: mapped separately, not folded in (Task 2's open question).**
`PLAN_ERROR_TAB` is `Record<PlanErrorKey, PlanTabId>` where
`PlanErrorKey = keyof PlanFieldErrors | "paymentError" | "paymentRowErrors"`. `paymentError` and
`paymentRowErrors` were **not** folded into `fieldErrors`, for two reasons. `paymentRowErrors` is an array
of per-row `{ amount?, dueDate? }` objects and does not fit a flat `Record<string, string | undefined>`
without changing what the payment block reads — and that block is moved by this story, not rewritten
(Trap 5). `paymentError` is a block-level message rendered through `FormControl`/`FormHelperText`, not
through a `FormField`, so folding it in would have bought nothing and changed three call sites' behaviour.
Widening the union keeps exactly the guarantee AC3 asks for: a seventh `fieldErrors` key **or** a new
union member without a tab fails to compile (verified above).

Tab order lives in one place — the `PLAN_TAB_IDS` array. `PLAN_ERROR_KEYS_IN_TAB_ORDER` is derived from it
by a *stable* sort of `Object.keys(PLAN_ERROR_TAB)`, so "the first tab that owns an error" cannot drift
from the order the `Tabs` component renders, and keys sharing a tab keep their declaration order
(`title` before `contentJson`, `fromTime` before `toTime`).

**Panels unmount (Task 3's open question).** Inactive panels are not rendered at all. The spec's own
finding is what makes this safe: every field is plain `useState` at dialog level (`:220-256`) and the
TipTap instance comes from a dialog-level `useEditor`, so no value and no undo history can be dropped by
an unmounting panel — and TipTap's own `EditorContent` unmount path moves the editor DOM into a detached
div and re-appends it on remount rather than destroying it. Unmounting also keeps the DOM small on the
phone this story is for, and makes AC9's "the tallest tab is shorter than the whole form" true by
construction rather than by CSS. What it costs is scroll position and DOM focus, which is why AC2's focus
restoration is an explicit effect rather than a side effect of showing the panel. **No machinery was added
to preserve state** — none is needed, and the round-trip test proves it (it asserts the field is genuinely
absent from the DOM mid-trip, so it is testing an unmount and not a hidden panel).

**Focus after a rejected save.** `revealFirstError(state)` selects the owning tab, records the target in a
ref, and bumps an `errorFocusNonce`; an effect keyed on the nonce then focuses. The nonce is needed
because `activeTab` alone is not a reliable trigger — pressing Speichern while already standing on the tab
that owns the error leaves it unchanged, and AC2 wants the caret on the field either way. `setActiveTab`
and the nonce land in the same batch, so the panel is mounted by the time the effect runs. All seven
early-return branches of `handleSave` plus the server `validation_error` branch call it; the server branch
now collects `nextPaymentError` into a local instead of setting state inside the loop, so the snapshot
handed to `revealFirstError` is complete.

Focus targets are resolved by `planErrorFocusId`, which is total over `PlanErrorKey` via a `never`
default. `contentJson` returns `null` and is handled through a ref, because a contenteditable has no id —
the effect prefers the real `[contenteditable="true"]` node and falls back to the block itself
(`tabIndex={-1}`), which is also what happens under the jsdom TipTap mock. `paymentError` is block-level
(sum mismatch / cost required / minimum rows) and focuses the cost box, since that is the field a user has
to change to satisfy any of the three.

**The marker is not colour.** A tab owning an error renders a `WarningTriangleIcon` (shape) and its
accessible name becomes `"{label} (contains errors)"` (words). The `warnBorder` tint is a third, redundant
signal — remove it and the marker still reads.

**Tab bar vs. formatting toolbar (AC6, Trap 3).** MUI `Tabs`/`Tab` for the ARIA wiring and arrow keys, but
styled as the *pill switch* `AuthTabs` established and `theme.ts` already encodes (`MuiTabs` paints the
`paperOuter` track, `MuiTab` the white selected pill with a shadow). The underline indicator is switched
off: the filled pill is the selected state and an underline on top of it is a conflicting second one. That
is a deliberately different idiom from the five 44px outlined squares of the TipTap toolbar directly
below. `variant="fullWidth"`, not `scrollable` — a scrollable bar hides tabs, which works against the
story; the four German labels fit at 12px/800 with per-tab padding cut to 6px, and the longest
("Medien & Links") may wrap to a second line, costing ~8px of bar height rather than a tab. **The 390px
confirmation is Task 6's, not this one's** — jsdom computes no layout.

**Grouping note.** `Medien & Links` holds the gallery and the link, but the gallery only renders for a
saved item (pre-existing `editingItemId` guard), so in the *add* flow that tab is briefly a one-field tab.
That is existing behaviour, not a regression, and closing it would mean showing an upload zone that cannot
upload.

**Tests.** One `selectTab(tab, language?)` helper replaces ~40 would-be repetitions; it matches on the
*prefix* of the tab's accessible name so it reaches a tab in both its plain and its "(contains errors)"
state. The `@mui/material` mock gained `Tabs`/`Tab` that render `role="tablist"`/`role="tab"` and
`aria-selected` — deliberately, so a regression from tabs back to styled buttons breaks the suite instead
of passing quietly. One collision needed handling: each panel is `aria-labelledby` its tab (AC7), so the
panel element itself answers to `getByLabelText("Cost")`; a `costField()` helper narrows to
`{ selector: "input" }` rather than dropping to a test id. The four import-shape suites were **run, not
assumed** — all four still pass; the two that mock `@mui/material` without `Tabs`/`Tab` survive because
they only import the module and never render it.

**AC6 and AC9 remain unverified** — they are browser measurements and Task 6 is left open for the
operator. The in-flight-upload case in Task 3 was verified by reading rather than by a test: the upload
loop and `galleryFiles`/`galleryBusy` all live above the panels, so unmounting `PhotoUploadField` mid-flight
cannot cancel the loop or discard its results; only the native file input's own `value` resets, which
nothing reads.

### File List

- `travelplan/src/components/features/trips/TripDayPlanDialog.tsx` — modified. Tab/error-map module
  constants and types (`PLAN_TAB_IDS`, `PlanFieldErrors`, `PlanErrorKey`, `PLAN_ERROR_TAB`,
  `planErrorFocusId`, exported where the tests need them); `activeTab` / `errorFocusNonce` state and the
  focus effect; `revealFirstError` wired into every rejection branch of `handleSave`; the form body split
  into four `role="tabpanel"` blocks with the location search moved into `Wann & Wo` and the link into
  `Medien & Links`. `DialogActions` is untouched and still outside the panels.
- `travelplan/src/i18n/en.ts` — added `trips.plan.tabsLabel`, `tabWhat`, `tabWhenWhere`, `tabCost`,
  `tabMedia`, `tabWithErrors`, and (review pass) `galleryAfterSave`.
- `travelplan/src/i18n/de.ts` — the same seven keys.
- `travelplan/test/tripDayPlanDialog.test.tsx` — modified. `Tabs`/`Tab` added to the MUI mock; `selectTab`
  and `costField` helpers; all 13 existing tests taught to select their tab; three new tests (hidden-tab
  error switches + marks + focuses; value survives a tab round trip; table-driven map coverage), plus
  three more from the review pass (multi-tab marking with first-in-order selection; the unmappable
  server rejection; marker cleared once the field is fixed). 13 → 28 tests.

### Change Log

| Date | Change |
|---|---|
| 2026-08-03 | Tasks 1–5 implemented. Activity dialog split into four tabs (`Was` / `Wann & Wo` / `Kosten` / `Medien & Links`) with a compiler-enforced total error→tab map, switch-and-focus on rejected saves, and a non-colour tab marker. `tripDayPlanDialog.test.tsx` 13 → 25 tests. Gates: `tsc` no new errors, `lint` no new problems, `npm test` 1092/1092. Task 6 (browser check for AC6/AC9) left for the operator. |
| 2026-08-03 | Review pass. 8 patches, no spec loopback. The four that change behaviour: a rejected save whose `validation_error` names no field this dialog surfaces now raises the banner instead of failing in silence (AC2); `title`, `costCents`, `linkUrl` and the rich text clear their own error on change, so a tab marker cannot outlive the fix; `paymentRowErrors` is kept in step with the rows on removal and on a mode switch, so `Kosten` cannot keep a triangle for a message that renders nowhere; and the marker moved from `warnBorder` (#E3C7A2, 1.6:1 on the selected pill) to `warning.main` (#8A5A2B, 5.87:1), the colour `theme.ts` already assigns every error foreground. Four smaller ones: `aria-controls` now only on the selected tab, since the other three panels are not in the DOM; `for…of` instead of `forEach` in the server-error branch so `nextPaymentError` is not narrowed to `null`; a visible focus ring on the rich-text host for the case where AC2 focuses it programmatically; and a line in the add flow's `Medien & Links` explaining that photos come after the first save, so AC1's "no tab holds a single field" holds there too. `npm test` 1095/1095. |

## Review Triage Log

### 2026-08-03 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 8: (high 0, medium 4, low 4)
- defer: 2: (high 0, medium 0, low 2)
- reject: 5: (high 0, medium 0, low 5)
- addressed_findings:
  - `[medium]` `[patch]` A `validation_error` carrying only keys the dialog does not surface (`location`, `tripDayId`, `bucketListItemId`, `itemId`, or `formErrors` alone) cleared every error store, marked no tab, focused nothing and showed no banner — the exact silent failure AC2 forbids, and pre-existing but now harder to spot with the form behind tabs. Added a fallback: when the mapped state owns no error key, the branch raises the standard save-error notice. New test `shows a banner when a rejected save maps to no field at all`.
  - `[medium]` `[patch]` Only the two time fields cleared their error on change, so a corrected `title`, `costCents`, `linkUrl` or rich-text body left its tab marked "(enthält Fehler)" until the next save. Harmless when the message sat beside the field; a lie once it is global navigation chrome. All four now clear their own key, and editing the cost also clears the block-level `paymentError`, which is a claim about that number. New test `drops a tab's marker once the offending field is corrected`.
  - `[medium]` `[patch]` `paymentRowErrors` is positional and was only rebuilt inside `handleSave`: removing a row re-attached its message to whichever row slid into the index, and an error past the new end kept `Kosten` marked with nothing visible on the panel. Same shape on a `single`↔`split` switch. Both handlers now keep the array in step with the rows.
  - `[medium]` `[patch]` The tab's error marker was painted `tokens.warnBorder` (#E3C7A2) — a border token at 1.62:1 on the white selected pill and 1.35:1 on the track, inherited by the `WarningTriangleIcon` through `currentColor`. AC2's marker was legible only in the accessibility tree. Moved to `warning.main` (#8A5A2B, 5.87:1), which `theme.ts:415-421` already prescribes for every error foreground and which `TripDayView.tsx:2797` already uses for this same icon.
  - `[low]` `[patch]` All four tabs carried a permanent `aria-controls`, but only the active panel is rendered, so three of the four references always dangled and jump-to-controlled-element reached nothing. Now set only on the selected tab.
  - `[low]` `[patch]` `nextPaymentError` was assigned inside a `forEach` callback, which TypeScript's control-flow analysis cannot see: it was narrowed back to `null` at both use sites, leaving the payment branch of AC3's error path unchecked. Rewritten as `for…of`.
  - `[low]` `[patch]` The rich-text host is `tabIndex={-1}` with `outline: none`, and AC2 focuses it when the editor has not initialised. Added a `:focus` ring — `:focus`, not `:focus-visible`, because after a tap on Speichern the focus-visible heuristic does not match and the phone is the case this story is for.
  - `[low]` `[patch]` The gallery is gated on `editingItemId`, so in the add flow `Medien & Links` held exactly one URL box — the one-control tab AC1 exists to prevent, in the flow Trap 2 says pays for tabs. Added `trips.plan.galleryAfterSave` in both locales, shown in place of the gallery before the first save. Showing a real upload zone was rejected: it has nothing to upload to.
  - `[low]` `[patch]` `planTabsWithErrors` builds a `Set`, but no test produced errors on two tabs at once — every client-side branch returns on the first problem, so only the server path can. New test `marks every tab a server error owns and selects the first in tab order`, starting on the last tab so "switched to the first owner" cannot pass by accident. It and the marker-clearing test also cover the `title` and `linkUrl` focus targets, which nothing exercised.

## Auto Run Result

Status: awaiting-operator — Tasks 1–5 are complete and verified; Task 6 is a browser pass, and AC6 and AC9 are rendered-pixel claims jsdom cannot reach.

**What was built.** The activity dialog's form body is split into four tab panels — `Was` (title, rich text), `Wann & Wo` (from, to, location search), `Kosten` (amount, payment mode, payment rows) and `Medien & Links` (gallery, link) — with `DialogActions` outside them, so Abbrechen/Speichern stay visible from every tab and there is no Next/Back. The blocks were moved, not rewritten. Inactive panels unmount, which is safe because every field is dialog-level `useState` and the TipTap instance comes from a dialog-level `useEditor`, so nothing can be dropped by an unmounting panel. Error visibility is the part that makes tabs safe: `PLAN_ERROR_TAB` is `Record<PlanErrorKey, PlanTabId>` over `keyof PlanFieldErrors | "paymentError" | "paymentRowErrors"`, so a new key without a tab does not compile (verified by adding a throwaway seventh key), and every rejection branch of `handleSave` calls `revealFirstError`, which selects the first tab in tab order owning an error and puts the caret on the field. The marker is a warning triangle plus an accessible name, never colour alone.

**Files changed**
- `travelplan/src/components/features/trips/TripDayPlanDialog.tsx` — the tab machinery, the error→tab map and focus resolver, the four panels, and the review pass's error-clearing and payment-row-sync fixes.
- `travelplan/src/i18n/en.ts`, `travelplan/src/i18n/de.ts` — seven new keys each (four tab labels, the tablist name, the error suffix, the add-flow gallery line).
- `travelplan/test/tripDayPlanDialog.test.tsx` — `Tabs`/`Tab` in the MUI mock, a `selectTab` helper, all 13 existing tests taught to select their tab, and six new tests. 13 → 28.
- `_bmad-output/implementation-artifacts/deferred-work.md` — DW-146, DW-147.

**Review findings.** 0 intent_gap, 0 bad_spec, 8 patched (4 medium, 4 low), 2 deferred, 5 rejected. The four medium patches all touch behaviour: the silent-save fallback for a `validation_error` naming no field this dialog surfaces; four fields clearing their own error on change so a tab marker cannot outlive the fix; `paymentRowErrors` kept in step with the rows on removal and on a mode switch; and the marker's colour moved off a border token at 1.6:1 onto the 5.87:1 error foreground `theme.ts` already prescribes. Rejected: `PLAN_TAB_IDS` not driving panel rendering (a hazard only for a hypothetical fifth tab, and deriving panels would mean rewriting the blocks Trap 5 says to move); the German tablist name using "Aktivität" rather than "Planpunkt" (aria-label only, and "Aktivität" is the word the request itself used); the TipTap round trip being untested (the reviewer read TipTap's own unmount path and cleared it, and mocking TipTap is a repo-wide pattern); Task 6 being unticked (that is this workflow, not a defect); and per-key focus assertions for the remaining five error keys (title, linkUrl and costCents are now covered, and the rest share one effect and one table-driven map test).

**Verification.** From `travelplan/`, all three run and compared against the pre-change baseline rather than read in isolation: `npx tsc --noEmit` → 143 errors, the identical pre-existing set, none in `src/` and none added (the four `fetchMock.mock` sites in the dialog suite are the same four as at HEAD). `npm run lint` → 85 problems (2 errors, 83 warnings), the same set; the only delta is three pre-existing `react-hooks` warnings in this file shifting line numbers as it grew. `npm test` → 110 files, 1095 tests, all passing, including the four import-shape suites run rather than assumed.

**Residual risks.** AC6 and AC9 are unverified — the tab bar's readability against the formatting toolbar and the tallest panel's height are both browser measurements, and AC9 is the criterion the story exists to deliver. AC7's arrow-key navigation comes from MUI and the suite mocks MUI, so nothing executes it (DW-146). The German labels are expected to fit one 390px row at 12px/800, but "Medien & Links" may wrap to two lines; that is a bar ~8px taller, not a lost tab, and it is the operator's to confirm. The add flow's `Medien & Links` now explains that photos come after the first save rather than holding a single URL box, which is new copy in both locales and worth a glance.

## Operator Confirmation

Confirmed 2026-08-03: the external actions this story owed were carried out.

- Do Task 6 in a real browser, on a throwaway copy of dev.db on an isolated port — never prisma/dev.db. The recipe is in the Dev Notes of _bmad-output/implementation-artifacts/7-12-bucket-list-sidebar-card.md. AC6 and AC9 are the two criteria nothing in the suite can reach: jsdom computes no layout and does not resolve responsive sx, so no test can measure a panel or judge two controls at a glance.
- Run the app in German — the four tab labels are longest there and the German set is the binding one. Open a day, open an activity, and check at a 390px viewport that all four labels ('Was', 'Wann & Wo', 'Kosten', 'Medien & Links') sit on one row without the bar turning scrollable. If any tab is cut off or the bar scrolls, that is a copy fix on the label, not a change to variant='scrollable' — a scrollable bar hides tabs and works against the whole story.
- AC9 is the measurement the story exists for. At 390px, measure the content height of the tallest panel (Kosten in split mode with three or more payment rows is the candidate) against the 1341px the whole form measured before this change. Record the number in the Dev Agent Record either way. If the tallest panel is not clearly shorter, the grouping needs revisiting and that is a new story, not an edit here.
- AC6, and it is a judgement call no test can make: with the Was tab open, look at the tab bar and the formatting toolbar directly below it (B, I, list, link, image) and confirm they do not read as one control. The tab bar is deliberately the pill switch from AuthTabs and the toolbar is five outlined squares; if they still read as one stacked widget, say so — the fix is spacing or a divider, not new tab semantics.
- Walk the add flow end to end on a phone, which Trap 2 says is the flow that pays for tabs: create a new activity, visit all four tabs, and judge whether the taps cost more than the scrolling saved. This is the case where the story could be wrong, and it is the one only a person can judge.
- On the add flow's Medien & Links tab, confirm the new line 'Fotos kannst du hinzufügen, sobald der Planpunkt gespeichert ist.' appears in place of the gallery, and that the gallery is there as normal when you reopen the saved item for editing.
- Check the error path by hand, because it is the risk the whole design turns on: on the Kosten tab type a nonsense amount ('zwölf Euro'), switch to Was, and press Speichern. The dialog must jump to Kosten, put the caret in the amount box, and show a warning triangle on the tab that is legible against the white selected pill (it is now #8A5A2B, not the old pale sand). Then fix the amount and confirm the triangle disappears without another save.
- Switch tabs with the arrow keys, not the mouse, and confirm Left/Right move between the four tabs — this comes from MUI and the test suite mocks MUI away, so nothing in the repo verifies it (DW-146).
- If every check passes, tick Task 6 in this spec, set status: done in the frontmatter and Status: done in the body, and set 6-22-activity-dialog-in-tabs to done in sprint-status.yaml.

_Appended by the bmad-loop orchestrator (`bmad-loop confirm`, #335): a human confirmed these external actions out of band, and the story was advanced from `awaiting-operator` to `done`._
