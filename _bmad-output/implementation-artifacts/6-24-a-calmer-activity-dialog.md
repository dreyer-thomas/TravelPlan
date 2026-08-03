---
authored_against: 8ac08ae
---

# Story 6.24: A Calmer Activity Dialog

Status: ready-for-dev

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

- [ ] **Task 1 — Hold the frame still** (AC: 1, 2)
  - [ ] Measured at 1400×1000 before this story: the dialog is **668px** on `Was`, **501px** on `Wann & Wo`, **572px** on `Kosten`, **660px** on `Medien & Links` — a 167px swing. Because MUI centres it, that lands as ±84px on *both* edges, so the tab bar moves down 84px under the pointer that just used it. That displacement, not the resize, is what reads as restless.
  - [ ] At 390px the dialog already measures 780px on every tab — it fills the viewport there. **This is a desktop-only defect**; do not "fix" the phone case, which is not broken.
  - [ ] Put a `minHeight` on the content area sized to the tallest ordinary panel (475px content at desktop, 485px at 390px in the same fixture). Shorter panels then pad with space — which is exactly what was asked for.
  - [ ] Do **not** use a fixed `height`. `Kosten` reaches 1634px at five split-payment rows; a fixed frame would clip it or force a nested scroll inside a scroll.
  - [ ] The floor is a magic number by nature. Derive it from the panels if that is practical; otherwise name the constant and say in a comment where the number came from, so the next person does not have to re-measure.

- [ ] **Task 2 — The close control** (AC: 3, 3a, 4)
  - [ ] Build it to `icon-button.close`: 44x44, glyph ~20px, `{colors.ink-soft}`, no fill or border at rest, app-wide focus ring, mandatory accessible name.
  - [ ] Implement the dirty-form confirmation (AC3a). "Dirty" needs defining — the dialog holds every field in `useState`, so a comparison against the values it opened with is available without new machinery. Say which definition was used.
  - [ ] Remove the `Abbrechen` button from `DialogActions`. **Do not retire `common.cancel`** — unlike `common.save` in Story 6.17, it has several readers; confirm with a grep before touching it.
  - [ ] Add an `IconButton` at the dialog's top right. It needs its own accessible name — reuse an existing "close" string if one exists, otherwise add one; `i18nDictionaries.test.ts` enforces parity.
  - [ ] It must be the same action as `Abbrechen` was: close, discard nothing to the server, no save. If `Abbrechen` had unsaved-changes handling, the `✕` inherits it.
  - [ ] Mind the title row: the dialog already has one, and the `✕` sits in it rather than above it.

- [ ] **Task 3 — The trash glyph** (AC: 5)
  - [ ] `trips.plan.deleteItemAria` already reads "Planpunkt löschen" — the name exists, so this is a change of presentation only.
  - [ ] Give it a tooltip as well as the aria label. This is the **destructive** action becoming the least-labelled control in the footer, which is a real trade: an icon is faster to reach and slower to read. The tooltip and the existing confirmation are what keep it honest.
  - [ ] 44px hit area, as the theme's other icon buttons carry.
  - [ ] `trips.plan.deleteItem` ("Löschen") loses its reader if the label goes. Delete it or keep it deliberately.

- [ ] **Task 4 — The two labels** (AC: 6, 7)
  - [ ] `trips.plan.saveNew` and `trips.plan.saveUpdate` both become "OK" / "OK". Two keys with one value is the shape Story 6.17 called a trap on `common.save`: decide whether to collapse them to one key or keep both with a note saying why.
  - [ ] `trips.plan.moveAction` becomes "anderer Tag" / a matching short English phrase. It is terse on purpose; the dialog it opens carries `trips.plan.moveDialogTitle` ("Auf anderen Tag verschieben"), so the full sentence still reaches the user one step later.
  - [ ] Tests query these by visible text. Every renamed label breaks a query.

- [ ] **Task 5 — Tests** (AC: 3, 5, 6, 7, 9)
  - [ ] `tripDayPlanDialog.test.tsx` and its four import-shape siblings are the constraints; 6.22 already reworked most of them around tab selection.
  - [ ] Assert: no button named by `common.cancel` in the dialog; a close control exists and is named; the delete control is reachable by its aria name and still confirms; the save control reads "OK"; the move control reads "anderer Tag".
  - [ ] Assert the delete confirmation still stands between the glyph and the deletion — that is the one behaviour this story must not thin out.
  - [ ] `npm test` green.

- [ ] **Task 6 — Manual check** (AC: 1, 8)
  - [ ] Throwaway copy of `dev.db` on an isolated port — never `prisma/dev.db`. Recipe in `7-12-bucket-list-sidebar-card.md`'s Dev Notes.
  - [ ] **At 1400px, switch through all four tabs and watch the top edge.** It must not move. Record the four dialog heights the way this spec records the four before it.
  - [ ] At 390px confirm the footer is one row, and measure it against today's 243px.
  - [ ] Open an activity with split payments and several rows and confirm the `Kosten` panel still scrolls past the floor rather than being clipped.
  - [ ] Tap the trash glyph on a phone and confirm the target is comfortable and the confirmation appears.

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

### Debug Log References

### Completion Notes List

### File List

### Change Log
