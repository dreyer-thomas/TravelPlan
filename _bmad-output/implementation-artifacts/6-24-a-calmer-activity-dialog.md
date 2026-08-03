---
authored_against: 8ac08ae
baseline_commit: e8b51f77fae2048e176790b19cd83de168610f01
---

# Story 6.24: A Calmer Activity Dialog

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner,
I want the activity dialog to hold still when I switch tabs and to carry fewer buttons,
so that the thing I just clicked stops moving away from my cursor and the footer stops taking a third of the dialog.

## Acceptance Criteria

1. **The dialog does not move when switching tabs.** Its top and bottom edges stay where they are across all four tabs. A panel with less content shows empty space rather than shrinking the frame.
2. **The floor is a minimum, not a fixed height.** The `Kosten` panel grows without bound as split-payment rows are added (DW-149), so it must still be able to exceed the floor and scroll. What is forbidden is the frame *shrinking* below it.
3. **`Abbrechen` leaves the footer and becomes a close control** — the usual `✕` at the top right of the dialog, built to `DESIGN.md.Components → icon-button.close`.
3a. **A dirty form asks before it closes.** An untouched dialog closes silently; one the user has typed into confirms once, naming what goes, with the keeping answer as the safe one. This is `EXPERIENCE.md.State Patterns → Dismissing a dialog with unsaved input`, added on 2026-08-03 because the dismissal shrinks from a labelled footer button to a 44px glyph — easier to hit by accident and carrying no word for the consequence. This dialog is where it is proven first: four tabs, eleven fields and a rich-text description are the most there is to lose anywhere in the app.
4. **The close control is named.** It carries an accessible name and a 44px hit area; an unlabelled `✕` is a button with no name for anyone not looking at it.
5. **`Löschen` becomes a trash glyph** with `trips.plan.deleteItemAria` ("Planpunkt löschen") as its accessible name and a tooltip, at the same 44px floor. The confirmation step is unchanged.
6. **`Speichern` becomes `OK`.** Both `trips.plan.saveNew` ("Element speichern") and `trips.plan.saveUpdate` ("Änderungen speichern") carry the same word afterwards, so whether two keys are still warranted is decided rather than left.
7. **`Auf anderen Tag verschieben` becomes `anderer Tag`.**
8. **The footer fits on one row** at 390px and at desktop width. It measures 243px at 390px today — 31% of a 780px dialog.
9. **Nothing about behaviour changes.** Every action does what it did; this story changes where controls sit and what they are called.

## Tasks / Subtasks

- [x] **Task 1 — Hold the frame still** (AC: 1, 2)
  - [x] Measured at 1400×1000 before this story: the dialog is **668px** on `Was`, **501px** on `Wann & Wo`, **572px** on `Kosten`, **660px** on `Medien & Links` — a 167px swing. Because MUI centres it, that lands as ±84px on *both* edges, so the tab bar moves down 84px under the pointer that just used it. That displacement, not the resize, is what reads as restless.
  - [x] At 390px the dialog already measures 780px on every tab — it fills the viewport there. **This is a desktop-only defect**; do not "fix" the phone case, which is not broken.
  - [x] Put a `minHeight` on the content area sized to the tallest ordinary panel (475px content at desktop, 485px at 390px in the same fixture). Shorter panels then pad with space — which is exactly what was asked for.
  - [x] Do **not** use a fixed `height`. `Kosten` reaches 1634px at five split-payment rows; a fixed frame would clip it or force a nested scroll inside a scroll.
  - [x] The floor is a magic number by nature. Derive it from the panels if that is practical; otherwise name the constant and say in a comment where the number came from, so the next person does not have to re-measure.

- [x] **Task 2 — The close control** (AC: 3, 3a, 4)
  - [x] Build it to `icon-button.close`: 44x44, glyph ~20px, `{colors.ink-soft}`, no fill or border at rest, app-wide focus ring, mandatory accessible name.
  - [x] Implement the dirty-form confirmation (AC3a). "Dirty" needs defining — the dialog holds every field in `useState`, so a comparison against the values it opened with is available without new machinery. Say which definition was used.
  - [x] Remove the `Abbrechen` button from `DialogActions`. **Do not retire `common.cancel`** — unlike `common.save` in Story 6.17, it has several readers; confirm with a grep before touching it.
  - [x] Add an `IconButton` at the dialog's top right. It needs its own accessible name — reuse an existing "close" string if one exists, otherwise add one; `i18nDictionaries.test.ts` enforces parity.
  - [x] It must be the same action as `Abbrechen` was: close, discard nothing to the server, no save. If `Abbrechen` had unsaved-changes handling, the `✕` inherits it.
  - [x] Mind the title row: the dialog already has one, and the `✕` sits in it rather than above it.

- [x] **Task 3 — The trash glyph** (AC: 5)
  - [x] `trips.plan.deleteItemAria` already reads "Planpunkt löschen" — the name exists, so this is a change of presentation only.
  - [x] Give it a tooltip as well as the aria label. This is the **destructive** action becoming the least-labelled control in the footer, which is a real trade: an icon is faster to reach and slower to read. The tooltip and the existing confirmation are what keep it honest.
  - [x] 44px hit area, as the theme's other icon buttons carry.
  - [x] `trips.plan.deleteItem` ("Löschen") loses its reader if the label goes. Delete it or keep it deliberately.

- [x] **Task 4 — The two labels** (AC: 6, 7)
  - [x] `trips.plan.saveNew` and `trips.plan.saveUpdate` both become "OK" / "OK". Two keys with one value is the shape Story 6.17 called a trap on `common.save`: decide whether to collapse them to one key or keep both with a note saying why.
  - [x] `trips.plan.moveAction` becomes "anderer Tag" / a matching short English phrase. It is terse on purpose; the dialog it opens carries `trips.plan.moveDialogTitle` ("Auf anderen Tag verschieben"), so the full sentence still reaches the user one step later.
  - [x] Tests query these by visible text. Every renamed label breaks a query.

- [x] **Task 5 — Tests** (AC: 3, 5, 6, 7, 9)
  - [x] `tripDayPlanDialog.test.tsx` and its four import-shape siblings are the constraints; 6.22 already reworked most of them around tab selection.
  - [x] Assert: no button named by `common.cancel` in the dialog; a close control exists and is named; the delete control is reachable by its aria name and still confirms; the save control reads "OK"; the move control reads "anderer Tag".
  - [x] Assert the delete confirmation still stands between the glyph and the deletion — that is the one behaviour this story must not thin out.
  - [x] `npm test` green.

- [x] **Task 6 — Manual check** (AC: 1, 8)
  - [x] Throwaway copy of `dev.db` on an isolated port — never `prisma/dev.db`. Recipe in `7-12-bucket-list-sidebar-card.md`'s Dev Notes.
  - [x] **At 1400px, switch through all four tabs and watch the top edge.** It must not move. Record the four dialog heights the way this spec records the four before it.
  - [x] At 390px confirm the footer is one row, and measure it against today's 243px.
  - [x] Open an activity with split payments and several rows and confirm the `Kosten` panel still scrolls past the floor rather than being clipped.
  - [x] Tap the trash glyph on a phone and confirm the target is comfortable and the confirmation appears.

### Code Review Browser Pass (2026-08-03)

Run as part of the review, to discharge the one finding whose answer could only be measured. Throwaway copy of `dev.db` in the session scratchpad, `git worktree` at `e8b51f7` with the four changed source files copied in, the worktree's own `.env` repointed at the copy, `next dev -p 3091`, Playwright/Chromium at 1400×1000, 390×844 and 320×844, `lang=de`. `prisma/dev.db` was never opened — its mtime was unchanged throughout. Worktree, DB copy and dev server all removed afterwards.

**The floor, re-measured across 18 real activities.** The story's derivation for `PLAN_PANEL_MIN_HEIGHT = 475` was wrong, and its own before/after table said so. Natural panel heights (the floor is a `minHeight` on a block parent, so a block child's measured height is still its natural one):

| panel | 1400×1000 | 390×844 |
|---|---|---|
| `Was` | **361–606** | **361–930** |
| `Wann & Wo` | 194 | 406 |
| `Kosten` (single payment) | 266 | 392 |
| `Medien & Links` | 315–354 | 315–354 |

So there is no "tallest ordinary panel" to derive a floor from: `Was` holds the rich-text description and is unbounded, exactly as `Kosten` is via split-payment rows (DW-149). **475 was kept**, because the measurement vindicates the number even though it refutes the reason: it clears every non-`Was` panel at both viewports with headroom, and at 1400px **17 of the 18 sampled activities hold perfectly still (0.0px swing)**. The one exception, a 606px description, swings 131px. At 390px 14 of 18 hold still and the worst case is **13.3px** — the taller ones run into MUI's `calc(100% - 64px)` cap and are pinned by it. Against the 167px swing and 84px displacement this story set out to remove, that is the ordinary case fixed and the phone improved by an order of magnitude. Raising the floor to cover the outlier costs +131px on every activity; the residual is **DW-155**.

The auditor's predicted ~10px per-tab swing at 390px does **not** occur: measured 766.69px on all four tabs, top edge 38.66px on all four. The predicted mechanism was sound but the story's "485px at 390px" figure was wrong — the real tallest phone panel on that fixture is 424px, still under the floor.

**Measured at 1400px, after the review's patches** — dialog 756.69px and top edge 121.66px on all four tabs, unchanged from the story's own figures.

**The two icon buttons, measured rather than asserted.** `✕`: 44×44, `rgb(107,103,92)` = `#6B675C` = `{colors.ink-soft}`, `rgba(0,0,0,0)` background, `border-style: none` — and at rest `outline: 0px`, which is the defect the review found. Under `Mui-focusVisible` it now computes `rgb(43,42,38) solid 2px` with a 2px offset (`#2B2A26` = `{colors.ink}`). Trash glyph: 44×44, `{colors.ink}`, same ring. The dialog's `<h2>` reads `"Planpunkt bearbeiten"` — the glyph's name is out of the heading.

**The footer at 320px, with a before/after.** With `flexWrap: "wrap"` the footer wraps to two rows (132px) and neither it nor the dialog overflows horizontally. With it removed — the state the story shipped in — the footer measures `scrollWidth 272px` inside `clientWidth 254px` and **both the footer and the dialog paper overflow horizontally**. That is the finding proven in the browser, in the one place jsdom could never see it.

### Review Findings

Code review 2026-08-03 (`bmad-code-review`, three parallel layers: Blind Hunter, Edge Case Hunter, Acceptance Auditor). Every finding below was re-verified against the working tree before being kept; nine were dismissed as disproven or out of scope and are listed at the end of this section.

- [x] [Review][Patch] **The floor constant's derivation does not hold, in either direction** — *Decision 2026-08-03 (Tommy): re-measure in the browser.* Re-open the fixture, measure each panel wrapper's own height at 1400px and at 390px, set the constant to the true tallest, and rewrite the doc comment with the real derivation. Record all four dialog heights at 390px — Task 6 asked for them and only one was captured. — `PLAN_PANEL_MIN_HEIGHT = 475`'s doc comment makes two claims the recorded measurements contradict. (a) It says 475 "is the tallest ordinary panel's own height … the `Was` panel". If that were true the `Was` tab could not grow, yet the AC1 table records it going 668px → **757px**. Nothing else in the diff adds height (the desktop footer was already one row; the `✕` uses `mt/mr: -10px` precisely so it adds none), so the floor sits ~89px *above* the tallest panel — every tab, including the tallest, now carries ~89px of dead space, and 475 was evidently measured on the content area (tabs included, as Task 1 literally says: "475px **content**") but applied to the panel wrapper below `<Tabs>` (`TripDayPlanDialog.tsx:1578`). (b) It says "485px at 390px in the same fixture, **so one constant covers both**" — 475 does not cover 485. Before this story the 390px dialog was pinned at MUI's `calc(100% - 64px)` cap (780px on every tab, which is exactly 844 − 64), so its constancy was the *cap*, not a floor. The AC8 note records it coming down to 767px and no longer scrolling, i.e. height is now content-driven again: the 485px panel yields 767px and the other three yield ~757px — a ~10px per-tab swing at 390px that did not exist before, against AC1 (unqualified by viewport) and Trap 5. Task 6 recorded only **one** phone height, so 390px constancy was never actually verified in either direction. Decision needed because the right number is a browser measurement, and the Dev Agent Record already flags the unconditional floor as "one token to reverse if that is wrong".
- [x] [Review][Patch] **`locationQuery` is watched by the dirty guard but is never saved** — *Decision 2026-08-03 (Tommy): drop it from the fingerprint.* Watch only what a save would persist, which is the guard's stated contract and the same reasoning already used to reject a per-field `touched` flag. — the save payload sends `location: resolvedLocation` only (`TripDayPlanDialog.tsx:1042`); `locationQuery` is a search box whose contents are never persisted. So typing `Rom` into the location lookup without pressing the lookup button, then clicking the `✕`, raises "Änderungen verwerfen?" over a value no save would have kept — the same over-firing the guard's own doc comment uses to reject a per-field `touched` flag ("only when there is something to lose"). Whether an abandoned search term deserves the question is a product call, not a mechanical fix.
- [x] [Review][Patch] **The two nested dialogs still have no `✕`, and Story 6.25 cannot reach them** — *Decision 2026-08-03 (Tommy): add both to Story 6.25's scope.* Edit 6.25's Task 2 to name this dialog's two nested dialogs so the sweep that makes `closeLabel` required actually reaches every surface. No code change in 6.24. — the new discard confirmation (`TripDayPlanDialog.tsx:2087`) and the move picker are raw `<Dialog>`s with no close control, against `DESIGN.md`'s "Every dialog has exactly one". The Dev Agent Record discloses this and its reasoning is sound (a two-button destructive confirmation whose safe half *is* the close, following `TripDeleteDialog`), but 6.25's Task 2 enumerates five files by name and neither of these surfaces is among them. Needs an explicit decision — either 6.25's scope grows or these two are exempted on the record.
- [x] [Review][Patch] Neither new `IconButton` has a visible focus state, so `icon-button.close`'s Accessibility Floor is not met [travelplan/src/components/ui/DialogShell.tsx:146] — `theme.ts:302`'s `"&.Mui-focusVisible": { outline: 2px solid ink }` sits inside **`MuiButton`** only; `MuiIconButton`/`MuiButtonBase` have no override anywhere in `src`, and MUI's `ButtonBase` ships `outline: 0`. Measured in jsdom against real MUI: `getComputedStyle(closeButton).outline` is `0px`. `DESIGN.md`'s `icon-button` entry (line 260) is explicit — "Hover and focus follow the Accessibility Floor — the app-wide focus ring, never colour alone" — and AC3 says the `✕` is built to that entry. This also lands on the trash glyph (`TripDayPlanDialog.tsx:1477`), which **regressed**: as a `<Button variant="text">` it inherited the ring, as an `IconButton` it does not — so AC9 as well as AC3/AC5. The browser pass measured size, fill, border and colour but not focus, which is why the recorded evidence reads as complete. `TripIcons.tsx:447` is the house precedent for spelling it out on an `IconButton`.
- [x] [Review][Patch] Every visual claim in this story is asserted against an exported literal, never against a rendered element [travelplan/test/tripDayPlanDialog.test.tsx:2352] — `sx` is in `MUI_ONLY_PROPS` in that suite, so `expect(PLAN_PANEL_FLOOR_SX.minHeight).toBe("475px")` and `expect(PLAN_FOOTER_SX.flexDirection).toEqual({xs:"row",sm:"row"})` describe two object literals and nothing about the component: delete `sx={PLAN_PANEL_FLOOR_SX}` from line 1578 and `footerSx={PLAN_FOOTER_SX}` from line 1495 and the whole suite stays green — AC1, AC2 and AC8 would silently revert. The floor test's `toContainElement` does pin the wrapper, but not the prop on it. Meanwhile `test/formPrimitives.test.tsx:273` already has a `describe("DialogShell")` that renders **real MUI with no mock** — the natural home for the 44×44 hit area, `tokens.inkSoft`, `disableDismiss` disabling the glyph, AC9's "no `✕` renders without `closeLabel`", and the "glyph, backdrop and Escape are one outcome" claim that currently rests entirely on one unrepeatable browser pass (`onClose` is in `MUI_ONLY_PROPS` too, so the mock throws it away and every AC3a test clicks the glyph). The diff adds nothing to that suite.
- [x] [Review][Patch] The description's dirty baseline and its live value come from two different serializers [travelplan/src/components/features/trips/TripDayPlanDialog.tsx:719] — the baseline is the server's raw `item.contentJson` string, and `setEditorContent` passes `emitUpdate: false` (line 654) so it is never normalised; from the first keystroke onward the live value is `JSON.stringify(instance.getJSON())` (line 643). For any stored doc that is not byte-identical to TipTap's re-serialisation of it — a doc written before the `image`/`link` extensions existed, or any node the current schema fills defaults into — typing one character and deleting it again leaves the form permanently dirty, so the `✕` asks about a visibly unchanged form for the rest of the session. It fails safe (a spurious question, never a silent discard), but it is precisely the "typed and deleted again" property the fingerprint was chosen over a `touched` flag to deliver, and the test that proves that property exercises only the plain-text `Title` field. Fix: fingerprint the seed through the same serializer (`JSON.stringify(parseDoc(value))`).
- [x] [Review][Patch] The comment justifying `pendingPhotoCount` states something false [travelplan/src/components/features/trips/TripDayPlanDialog.tsx:432] — "`uploadGalleryImages` only runs from a save" is wrong: it has exactly one caller, the Media tab's own `Upload` button (line 1965), and `handleSave` never calls it. Watching staged photos is still right (the `✕` *does* lose them), but the stated reason is not, and the next reader will believe `OK` uploads them. See the deferred item below for the behaviour behind it.
- [x] [Review][Patch] The footer lost its wrap safety net with nothing replacing it [travelplan/src/components/features/trips/TripDayPlanDialog.tsx:190] — `PLAN_FOOTER_SX` forces `flexDirection: row` at `xs` as well as `sm`, the move button is pinned `whiteSpace: "nowrap"` (line 1454), and `DialogActions` sets no `flex-wrap`. The recorded 390px measurement leaves ~40px of slack (174px + 64px in a 278px row), so below ~330px — a 320px viewport, or 390px at 125% text zoom, or any translation longer than "anderer Tag" / "Another day" — the footer overflows the dialog horizontally where the deleted `{ xs: "column-reverse" }` used to stack it. Fix: `flexWrap: "wrap"` plus a `rowGap`.
- [x] [Review][Patch] AC5's tooltip is the native `title` attribute, which the users who need it most never see [travelplan/src/components/features/trips/TripDayPlanDialog.tsx:1479] — `title` never fires on keyboard focus, never on touch, and is suppressed while the button is disabled. This is the *destructive* control whose word was just removed, and Trap 3 makes the tooltip load-bearing rather than decorative. The repo already has the stronger pattern for exactly this case (`TripDayMapPanel.tsx:66` and `TripOverviewMapPanel.tsx:45` wrap icon-only buttons in `<Tooltip enterDelay={0}>`); the weaker one was picked. Duplicating one string into both `aria-label` and `title` also makes some screen readers announce "Planpunkt löschen, Planpunkt löschen". Same applies to the `✕` (`DialogShell.tsx:142`).
- [x] [Review][Patch] Three counts in the record and in `DialogShell`'s doc comment are wrong, and 6.25 is being scoped off them [travelplan/src/components/ui/DialogShell.tsx:46] — `grep -rn "<DialogShell" src` finds **four** call sites (`TripDayView.tsx:3249`, `TripAccommodationDialog.tsx:795`, `TripCreateDialog.tsx:57`, `TripDayPlanDialog.tsx:1414`), so **three** other consumers, not "five" — the substance holds (the `...(closeLabel ? … : null)` spread is a genuine no-op and hoisting `titleBlock` renders identical DOM), only the number is wrong. The same comment's "the five dialogs that build their own `Dialog`" is also wrong: `grep -rn "<Dialog "` finds **13** raw sites in `src`, two of them in this file. And `common.cancel` had 12 readers across **9** files, not ten; 11 remain after this story (`TripDayPlanDialog.tsx:2064` keeps one, on the move picker) — the i18n test's "the remaining eleven" is the number that is right and the story prose is the one that is wrong.
- [x] [Review][Patch] The `{colors.warn}` rationale misquotes the document it cites [travelplan/src/components/features/trips/TripDayPlanDialog.tsx:1470] — the comment and the Completion Notes say `DESIGN.md` reserves warn for a destructive action "already confirmed elsewhere **in the same view** / beside it". `DESIGN.md:260` actually reads "only where the action is destructive *and* already confirmed elsewhere", and this delete **is** confirmed elsewhere (`TripDayView.handleDeletePlan`), so warn was *permitted* rather than forbidden. `{colors.ink}` remains a legal choice ("for actions that change something") — only the recorded reason needs correcting, not the outcome.
- [x] [Review][Patch] An `it.each` prints a nonsense test name, on the one test whose name records AC6's intent [travelplan/test/tripDayPlanDialog.test.tsx:2327] — `it.each([["en","OK"],["de","OK"]])("labels the committing action %s in %s for both modes", …)` reports "labels the committing action en in OK for both modes". The assertion is correct; the placeholders are swapped.
- [x] [Review][Defer] `OK` silently discards staged-but-unuploaded photos [travelplan/src/components/features/trips/TripDayPlanDialog.tsx:1123] — deferred, pre-existing. Stage two files in `Medien & Links`, do not press `Upload`, press `OK`: `handleSave` never touches `galleryFiles`, calls `onSaved()`, and `TripDayView.handlePlanDialogSaved` unmounts the dialog — the files are gone with no question and no notice. The same two files dismissed via the `✕` now *do* raise "Änderungen verwerfen?", so the guard asks about data on the one exit that was not destructive and stays silent on the one that is. The loss predates this story (`Speichern` behaved identically) and fixing it is a behaviour change AC9 forbids, so it is out of 6.24's scope — but the asymmetry is new and worth its own story.

**Dismissed after verification** (recorded so a later review does not re-raise them):

1. *The `✕` inside `DialogTitle` pollutes the dialog's heading name* — disproven empirically. `computeAccessibleName` on the `<h2>` returns `"Add stay Day 3"` and on the dialog `"Add stay"`; the nested button's `aria-label` does not join either. This is also MUI's own documented close-in-title pattern.
2. *The payment-normalisation effect makes an untouched dialog dirty* — disproven. `skipCostSync.current` is set by the open effect and consumed by the cost-sync effect in the **same** effect flush (declaration order, `TripDayPlanDialog.tsx:686` before `:859`), and that effect has no dependency that re-fires afterwards. A seeded row whose `amountCents` differs from `costCents` is not rewritten.
3. *The discard confirmation can outlive the dialog it belongs to* — unreachable. The only two writers of `setPlanDialogMode(null)` (`TripDayView.tsx:857`, `:864`) are the dialog's own close and saved handlers; the URL effect at `:1099`/`:1106` only ever *opens*. The open effect resets `discardOpen` at `:700`.
4. *`closeLabel=""` yields a dialog with no close control* — unreachable. Internal prop, one caller, and `i18nDictionaries.test.ts` enforces the key's presence in both dictionaries.
5. *AC1 still fails for panels taller than the floor* — permitted by design. AC2 is explicit that the frame must remain free to grow; AC1 forbids *shrinking* below the floor.
6. *The floor is unconditional on viewport height, so short viewports gain a scroll* — no regression. Head + 475 + footer ≈ 620px, and the pre-story dialog already stood at 668px on `Was`, so any window that scrolls now was already scrolling.
7. *`disableDismiss={isBusy}` omits `galleryBusy`* — exact parity with the control it replaced: the old `Abbrechen` was `disabled={isBusy}` (`git show HEAD:…TripDayPlanDialog.tsx:1215`). Closing mid-upload was already possible; no regression.
8. *Two dialog-scoped keys now both hold the literal "OK"* (`trips.plan.save`, `trips.travelSegment.save`) — this follows the convention Story 6.17 established deliberately and recorded at `en.ts:645` ("so the next dialog needing a save button adds its own key"). Not the `common.save` trap, which was about one key with one reader.
9. *The editor's lifecycle re-arms the dirty baseline* — benign. `editor` going `null` → instance re-runs the open effect, but it recomputes the **same** seed, so the fingerprint it writes is unchanged.

## Dev Notes

### What was asked

Tommy on 2026-08-03, after using the tabbed dialog: *"Beim Umschalten 'springt' der Dialog, weil die Panes unterschiedlich groß sind. Das wirkt unruhig. Schöner wäre der Dialog behielte seine Größe und in der Pane ist einfach nur freie Fläche. Die Buttons sind mit auch zu viel. Daher folgendes: Abbrechen machen wir als Button weg und dafür oben rechts im Dialog einen normalen Schließen Button (so ein Kreuz). Statt löschen machen wir einen Mülleimer als Symbol hin, Speichern wird OK und der Text 'Auf anderen Tag verschieben' wird nur 'anderer Tag'."*

### The measurements behind it

At 1400×1000, one activity, before this story:

| tab | dialog height | top edge |
|---|---|---|
| Was | 668px | 166 |
| Wann & Wo | **501px** | 250 |
| Kosten | 572px | 214 |
| Medien & Links | 660px | 170 |

At 390×844 the same dialog is 780px on every tab, with a 447px content window and a **243px footer** — 31% of the dialog is buttons, stacked four deep because the four labels do not fit a row.

So the two complaints have different homes: the jumping is desktop-only, and the footer is worst on the phone.

### Why it feels worse than 167px

MUI centres the dialog vertically. A 167px change is split across both edges, so the top moves 84px — and the tab bar is at the top. The control being used is the control that moves. A dialog that grew downward only would be far less noticeable at the same magnitude.

### Traps

**1. `minHeight`, never `height`.** DW-149 records that the `Kosten` panel reaches 1634px at five payment rows. A fixed frame would clip the one panel that genuinely needs room.

**2. `common.cancel` is shared.** Story 6.17 retired `common.save` because it had exactly one reader. `common.cancel` does not — check before assuming the same move applies.

**3. The destructive action is losing its label.** That is what was asked and it is a normal pattern, but it makes the tooltip and the confirmation load-bearing rather than decorative.

**4. Two keys, one word.** `saveNew` and `saveUpdate` both becoming "OK" is the `common.save` shape again — decide, do not drift into it.

**5. The phone is not broken.** Do not add responsive machinery to a case that already holds still.

### Testing

Vitest 3.2 + Testing Library, jsdom. `tripDayPlanDialog.test.tsx` is the constraint. AC1 and AC8 are geometry and browser-only.

### Project Structure Notes

`src/components/features/trips/TripDayPlanDialog.tsx` and both dictionaries, plus the affected suites. No route, API or schema change.

### Sequencing

Follows **6.22** (which introduced the tabs) and **6.23** (which added the move action to the footer). Both are `done`.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 6.24]
- [Source: _bmad-output/implementation-artifacts/6-22-activity-dialog-in-tabs.md] — the tabs, and the DW-149 measurement
- [Source: _bmad-output/implementation-artifacts/6-23-move-a-single-activity-to-another-day.md] — the move action and the 243px footer
- [Source: travelplan/src/i18n/de.ts:440-446] — `saveNew`, `saveUpdate`, `deleteItem`, `deleteItemAria`

## Dev Agent Record

### Agent Model Used

claude-opus-5[1m] (Claude Opus 5, 1M context) via `bmad-dev-story`.

### Debug Log References

**Browser pass** — throwaway copy of `dev.db` in the session scratchpad, `git worktree` at `e8b51f7` with the four changed source files copied in, `next dev -p 3098`, `DATABASE_URL` and `UPLOADS_PUBLIC_ROOT` pointed at the scratch paths. Playwright/Chromium at 1400×1000 and 390×844, `lang=de`. `prisma/dev.db` was never opened. Worktree, database copy and the temporary Playwright install were all removed afterwards; `git worktree list` and `git status` are clean apart from the nine files below.

Two incidental notes for the next person doing this: the login route allows **10 attempts per 10 minutes** per IP and the counter is in-process, so a run that iterates gets 429s until the dev server is restarted; and `[data-testid="day-plan-item-edit-overlay"]` sits *under* the card's text, so Playwright needs `dispatchEvent("click")` — a real click, `force` included, lands on the `<p>` above it.

### Completion Notes List

**AC1 — the frame holds still.** Measured at 1400×1000, all four tabs:

| tab | before | after | top edge before | top edge after |
|---|---|---|---|---|
| Was | 668px | **757px** | 166 | **122** |
| Wann & Wo | 501px | **757px** | 250 | **122** |
| Kosten | 572px | **757px** | 214 | **122** |
| Medien & Links | 660px | **757px** | 170 | **122** |

A 167px swing and an 84px displacement of the tab bar became zero of each. `PLAN_PANEL_MIN_HEIGHT = 475` wraps all four panels in one element rather than sitting on each of them, so a fifth panel inherits the floor instead of having to remember it. The number is a magic number by nature; deriving it at runtime was rejected because a measure-then-set pass would still jump on the first switch to a taller panel, which is the defect. The constant's doc comment carries the recipe for re-measuring it.

**AC2 — a minimum, not a fixed height.** Confirmed live: an activity switched to split payments with extra rows renders a 936px dialog with a 666px panel region against the 475px floor, and the content area scrolls rather than clipping. `PLAN_PANEL_FLOOR_SX` is asserted to hold `minHeight` and to carry neither `height` nor `maxHeight` — a test over the real exported value rather than a grep over source text.

**AC3/AC4 — the close control.** `DialogShell` gained an opt-in `closeLabel` prop; only the activity dialog passes it, so the **three** other consumers render byte-identically (AC9) — corrected from "five" in code review; there are four `<DialogShell` call sites, not six. Measured in the browser: 44×44, `rgba(0,0,0,0)` background, `border-style: none`, `rgb(107,103,92)` = `#6B675C` = `{colors.ink-soft}` — `icon-button.close` as DESIGN.md specifies it. It reuses `common.close` ("Schließen"/"Close"), which already had two readers, rather than adding a second key for one word. It shares the shell's existing `onClose`, so the glyph, the backdrop and Escape are one outcome by construction — which is what makes the dirty guard below cover all three.

`common.cancel` was **not** retired: grep found twelve readers across **nine** files before this story ("ten" was wrong, corrected in code review), and eleven remain afterwards — this dialog keeps one, on the move picker. Story 6.25 owns them, and `i18nDictionaries.test.ts`'s "the remaining eleven" is the number to trust.

**AC3a — the dirty-form confirmation.** "Dirty" is defined as **the form's values differ from the ones it opened with**, compared as one serialised fingerprint over eleven values (`planFormFingerprint`). The alternative — a per-field `touched` flag — calls a form dirty after a character is typed and deleted again, and would guard a `✕` with nothing behind it. A value comparison also covers the two paths no `onChange` sees: the geocode lookup writing `resolvedLocation`, and the payment rows the normalisation effects rewrite. Staged-but-unuploaded photos count; images already on the server do not, because adding and removing those are immediate writes.

The open effect's three near-identical branches were refactored to *compute* a `PlanFormValues` seed and then both apply and fingerprint it. That is the one structural change in this story, and it is load-bearing: two hand-maintained copies of the seed would drift on the first field a later story adds, and the failure would be silent — a `✕` that discards typing without asking.

Verified live at 1400px: an untouched dialog closes on one click with no question, in both add and edit mode; a typed-into dialog raises "Änderungen verwerfen?" naming what goes; "Weiter bearbeiten" leaves the dialog open with the typing intact; "Änderungen verwerfen" closes it; **Escape on a dirty form asks too**; and a successful `OK` closes without asking anything, with the saved value becoming the new baseline (reopening and closing is silent again).

**AC5 — the trash glyph.** 44×44, `aria-label` and `title` both `trips.plan.deleteItemAria` ("Planpunkt löschen") — the name that already existed, and one that names the object rather than the mechanism, as DESIGN.md requires of an icon-only control. `{colors.ink}` and not `{colors.warn}`: the warn tint is reserved for a destructive action already confirmed *beside* it, and this one's confirmation is a step later. `trips.plan.deleteItem` ("Löschen") was deleted — it had exactly one reader and would otherwise sit waiting for a second to pick it up.

The confirmation is unchanged and still lives where it always did, in `TripDayView.handleDeletePlan`. Its **declined** half had no coverage at all, which meant the guard could have been dropped and every existing test (all of which answer "yes") would still have passed; `tripDayViewLayout.test.tsx` now asserts it. Confirmed on the phone: tapping the glyph raises "Diesen Planpunkt löschen?" and declining leaves the activity in place.

**AC6 — `Speichern` becomes `OK`, and the two keys become one.** `saveNew` ("Element speichern") and `saveUpdate` ("Änderungen speichern") were collapsed into `trips.plan.save` = "OK". Two keys holding one word is exactly the shape Story 6.17 named a trap on `common.save`, so keeping both was declined. It is **not** `common.ok`, for that same story's other reason, recorded in `en.ts`: a `common.` name invites the next dialog to inherit an OK button it never decided on.

**AC7 — `anderer Tag`.** German lower-case as the request wrote it and as the binding wording; English "Another day" in sentence case like every other English label in the file. `moveDialogTitle` still carries the full sentence one step later, which is why shortening the action costs nothing.

**AC8 — the footer on one row.** 243px → **78px** at 390px; 31% of the dialog became 10%. One row at both widths, no horizontal overflow (174px + 64px in a 278px row). Two consequences worth recording: the phone dialog came *down* from 780px to 767px, and its content area — which scrolled on every tab before this story — now **does not scroll at all**, because the 165px the footer gave back more than pays for the floor.

**A defect the browser pass caught, which no unit test could have.** The first version of `PLAN_FOOTER_SX` set a plain `flexDirection: "row"`. That looks correct — `DialogShell` merges `footerSx` last and the final entry of an sx array takes precedence — but MUI compiles the shell's `{ xs: "column-reverse", sm: "row" }` into two media queries, and a bare property deep-merges *alongside* them and then loses to `@media (min-width:0px)`, which always matches. It measured `row` at 1400px, from the untouched `sm` query, and `column-reverse` with a 132px footer at 390px — the one viewport AC8 is about. Both breakpoint keys are now spelled out so the shell's queries are replaced rather than sat under, and the per-breakpoint shape is pinned by a test with the reason attached.

**AC9 — behaviour.** Every action does what it did. Save (POST and PATCH), delete, move, gallery upload, validation-error tab selection and field focus are all unchanged and still covered; the save path was re-verified in the browser end to end.

**Judgements a reviewer should look at rather than assume:**

- **The floor is unconditional, not `{ xs: 0, sm: 475 }`.** The spec's Task 1 gives a phone number as well as a desktop one, which reads as one constant covering both, and adding a breakpoint here is the responsive machinery Trap 5 warns against. It turned out to cost nothing measurable — the phone dialog got shorter and stopped scrolling — but it is one token to reverse if that is wrong.
- **The discard dialog has no `✕` of its own.** DESIGN.md gives every dialog exactly one close, and this is a two-button confirmation whose safe half already *is* the close. Story 6.25 AC3 says confirmations "also gain the `✕`" — but its Task 2 enumerates five files by name and this dialog's two nested dialogs (the move picker and this new discard) are in none of them. **6.25 will miss both unless someone adds them to its scope.**
- **`DialogShell`'s `closeLabel` is deliberately optional and deliberately temporary.** Making it required is Story 6.25's job; until then it is what kept a chrome change to one surface.

### File List

- `travelplan/src/components/features/trips/TripDayPlanDialog.tsx` (modified)
- `travelplan/src/components/ui/DialogShell.tsx` (modified)
- `travelplan/src/i18n/de.ts` (modified)
- `travelplan/src/i18n/en.ts` (modified)
- `travelplan/test/tripDayPlanDialog.test.tsx` (modified)
- `travelplan/test/tripDayViewLayout.test.tsx` (modified)
- `travelplan/test/i18nDictionaries.test.ts` (modified)
- `_bmad-output/implementation-artifacts/6-24-a-calmer-activity-dialog.md` (modified)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified)

### Change Log

- 2026-08-03 — Story 6.24 implemented. The activity dialog holds a 475px floor under all four tab panels, so its top and bottom edges no longer move when a tab is switched (757px on every tab at 1400px, against a 668/501/572/660 swing before). `Abbrechen` left the footer and became `icon-button.close` in the title row, guarded by a dirty-form confirmation on the glyph, the backdrop and Escape. `Löschen` became a named 44px trash glyph, `Speichern` became `OK` on a single collapsed key, and `Auf anderen Tag verschieben` became `anderer Tag` — a 243px footer is now 78px on one row. `trips.plan.saveNew`, `trips.plan.saveUpdate` and `trips.plan.deleteItem` deleted; `trips.plan.save` and four `discard*` keys added; `common.cancel` deliberately kept (twelve readers, Story 6.25's scope).
- 2026-08-03 — Browser pass caught a plain-value `flexDirection` override losing to MUI's compiled `@media (min-width:0px)` block, which left the 390px footer stacked at 132px while reading `row` at 1400px. Fixed by matching `DialogShell`'s breakpoint keys; pinned by test.
- 2026-08-03 — Tests: 1128 → 1170 across 110 files, all green. Lint unchanged at 85 problems (the 2 errors are pre-existing, in `src/theme.ts`). `tsc --noEmit` unchanged at 155 errors, all pre-existing and all in `test/`; no `src/` errors.
- 2026-08-03 — **Code review (3 layers) → 3 decisions resolved, 12 patches applied, 1 deferred, 9 dismissed.** The `✕` and the trash glyph gained the focus ring `DESIGN.md`'s `icon-button` entry requires — `theme.ts` scopes it to `MuiButton`, so both computed `outline: 0px` (app-wide gap logged as DW-154). Both moved from the native `title` attribute to a real `Tooltip`, which needed MUI's `span` wrapper for the disabled state; that wrapper made the glyph's name join the head's `<h2>`, so the heading role moved down onto the title line. The dirty fingerprint stopped watching `locationQuery` (a search box no save persists) and the description's baseline is now canonicalised through the editor, which fixes a form that read dirty forever after one keystroke on any doc TipTap normalises. `PLAN_FOOTER_SX` gained `flexWrap` — without it the 320px footer overflows the dialog, measured. Three wrong counts corrected (three `DialogShell` consumers, not five; 14 raw `<Dialog>` sites; `common.cancel` across nine files) and Story 6.25's Task 1–3 rewritten around them, including the two nested dialogs it would otherwise have missed. Tests 1170 → **1181** across 110 files; lint and `tsc` baselines unchanged.
- 2026-08-03 — **The floor was re-measured across 18 real activities** rather than one. `475` survives — 17 of 18 hold perfectly still at 1400px, worst case 13.3px at 390px — but its stated derivation was wrong and there is no "tallest ordinary panel" to derive one from, because the `Was` panel is unbounded via the description. Comment rewritten with the real numbers; the residual limit on AC1 is DW-155.
