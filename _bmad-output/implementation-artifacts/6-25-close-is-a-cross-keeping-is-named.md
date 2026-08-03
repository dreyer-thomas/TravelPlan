---
authored_against: 8ac08ae
---

# Story 6.25: Close Is a Cross, and Keeping Is Named

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As someone using this app,
I want every dialog to close the same way and every deletion to offer a clearly named way out,
so that a footer full of `Abbrechen` becomes one familiar `✕`, and the safe answer to "delete this?" says what it keeps.

## Acceptance Criteria

1. **Every dialog carries a `✕` at the top right**, with an accessible name and a 44px hit area. It closes without saving — exactly what `Abbrechen` did.
2. **Form dialogs lose their `Abbrechen` button.** Ten of the twelve call sites are forms; their footer keeps only the confirming action.
3. **Confirmation dialogs keep two buttons, and the safe one names its outcome.** `TripDeleteDialog` reads **"Reise behalten"** beside "Reise löschen"; the bucket-list confirmation reads **"Eintrag behalten"** beside "Eintrag löschen". Both also gain the `✕`.
4. **`common.cancel` is retired, not orphaned.** All twelve readers are in this story's scope; afterwards none remains, so the key is deleted from both dictionaries.
5. **Form confirmations keep saying `OK`.** Extending "name the outcome" to forms was considered and declined — this story does not touch them.
6. **`DialogShell` is where the `✕` lives** for the six files that use it. The five that do not get it locally; migrating them onto the shell is **not** in scope.
7. **Nothing else changes.** Every dialog opens, validates, saves and closes as before.

## Tasks / Subtasks

- [ ] **Task 1 — The shell carries it** (AC: 1, 6)
  - [ ] `src/components/ui/DialogShell.tsx` (126 lines) already owns the `DialogTitle` row at `:84`. Put the `IconButton` there, right-aligned, so its six consumers inherit it: `FullscreenPhotoViewer`, `TripDayView`, `TripAccommodationDialog`, `TripDayPlanDialog`, `TripCostOverview`, `TripCreateDialog`.
  - [ ] The shell's title row has `borderBottom` and its own `id` for labelling — do not disturb either.
  - [ ] The close action needs a handler. The shell already receives one for its dialog; confirm the prop shape before inventing a second.
  - [ ] `FullscreenPhotoViewer` already has its own close control from Story 6.12. Check before adding a second one to the same corner.

- [ ] **Task 2 — The five that do not use the shell** (AC: 1, 6)
  - [ ] `TripImportDialog`, `TripDeleteDialog`, `TripDayTravelSegmentDialog`, `TripBucketListPanel`, `TripEditDialog` build their own `Dialog`. Add the same control to each.
  - [ ] **Do not migrate them onto `DialogShell` here.** That is a worthwhile cleanup and a different story; folding it in turns a chrome change into a refactor of five dialogs with their own histories.
  - [ ] Whatever the shell does, these five must match it — same glyph, same position, same accessible name. If that means extracting a small shared piece, do that rather than copying markup five times.

- [ ] **Task 3 — Remove `Abbrechen` from the ten forms** (AC: 2, 4)
  - [ ] The twelve `common.cancel` sites: `TripImportDialog:456`, `TripAccommodationDialog:822`, `TripDayPlanDialog:1216` and `:1818`, `TripDayTravelSegmentDialog:757`, `TripCreateDialog:69`, `TripDayView:3238` and `:3270`, `TripBucketListPanel:675`, `TripEditDialog:359` — ten forms; plus `TripDeleteDialog:123` and `TripBucketListPanel:697`, which are Task 4.
  - [ ] Note `TripBucketListPanel` holds **both** kinds: `:675` is the add/edit form, `:697` is the delete confirmation. They are two different dialogs in one file and must not be treated alike.
  - [ ] Once all twelve are done, `common.cancel` has no readers. Delete it from `de.ts` and `en.ts` — `i18nDictionaries.test.ts` enforces parity, and a key left behind is the `common.save` shape Story 6.17 wrote a trap about.

- [ ] **Task 4 — The two confirmations** (AC: 3)
  - [ ] `TripDeleteDialog:123`: `common.cancel` becomes a new key reading "Reise behalten" / "Keep trip". The neighbouring `trips.delete.submit` is `color="error"` and stays exactly as it is.
  - [ ] `TripBucketListPanel:697`: the same, "Eintrag behalten" / "Keep entry", beside `trips.bucketList.deleteConfirm`.
  - [ ] **Both buttons stay.** The safe answer must not shrink to a corner glyph when the other one is destructive and red — that is the whole reason these two are carved out.
  - [ ] Keep the visual weight as it is: the destructive button is contained and red, the keeping one is not. Naming the outcome is the change; re-ranking them is not.

- [ ] **Task 5 — Tests** (AC: 1, 2, 3, 4, 7)
  - [ ] Every dialog suite that clicks `Abbrechen` needs rewriting to the `✕`. Grep the test tree for the label before starting — that is the bulk of the work.
  - [ ] Assert the close control exists and is named in each dialog, and that it closes without saving.
  - [ ] Assert the two confirmations still render **two** buttons, and that the safe one carries the new wording.
  - [ ] Assert `common.cancel` is absent from both dictionaries, the way `i18nDictionaries.test.ts` already asserts it for `common.save`.
  - [ ] `npm test` green.

- [ ] **Task 6 — Manual check** (AC: 1, 3)
  - [ ] Throwaway copy of `dev.db` on an isolated port — never `prisma/dev.db`. Recipe in `7-12-bucket-list-sidebar-card.md`'s Dev Notes.
  - [ ] Open each of the eleven dialogs at 390px and confirm the `✕` sits in the same place every time. Consistency is the point; one dialog with it somewhere else is worse than none having it.
  - [ ] Scroll a long dialog to the bottom and confirm the `✕` is still reachable — the title row is fixed and only the content scrolls, so it should be, but this is the assumption the pattern rests on.
  - [ ] Open both delete confirmations and read them aloud: "Reise behalten" / "Reise löschen" should be two outcomes, not a question and an answer.

## Dev Notes

### What was asked

Tommy on 2026-08-03: *"Das mit dem Schließen als Symbol oben rechts (quasi wie in Windows) könnten wir auch zum Standard machen. Dann fielen auf allen diesen Dialogen der Abbrechen-Button weg, oder?"* — and, on the delete case: *"Dann würde ich beim Reise löschen aber auch nicht Abbrechen nehmen, sondern eher sowas wie 'Reise behalten'."*

Form confirmations keeping "OK" was settled in the same exchange: *"Ich denke wir lassen es erst mal so bei OK."*

### Why the two confirmations are carved out

In `TripDeleteDialog` the footer is `Abbrechen` beside a red, contained "Reise löschen". Remove the first and the only button left is the destructive one, with the escape reduced to a glyph in the corner. A dialog that asks whether to delete something should not make the harmless answer smaller than the final one.

Naming the outcome is the better half of the change. "Abbrechen" beside "Löschen" asks the reader to work out *what* is being cancelled — the question, or the deletion? "Reise behalten" beside "Reise löschen" puts two results side by side, and the choice is a choice rather than a translation.

### The shell is half the work

`DialogShell.tsx` owns the title row, content and actions, and **six** of the eleven dialog files use it. Putting the `✕` there covers those six at once. The other five build their own `Dialog` and need it locally — but migrating them onto the shell is a separate, larger change and is explicitly out of scope, or this becomes a refactor wearing a chrome story's name.

### `common.cancel` really does end up orphaned

Twelve readers, all listed in Task 3, none elsewhere — verified including the test tree. After this story none remains. That is the same situation Story 6.17 handled for `common.save`, and it is handled the same way: delete the key and let `i18nDictionaries.test.ts` hold the line.

*(An earlier reading of this said `common.cancel` had readers that would survive. It does not — every one of them is in scope here.)*

### Traps

**1. `TripBucketListPanel` holds both kinds.** `:675` is a form, `:697` is a confirmation. One file, two rules.

**2. `FullscreenPhotoViewer` already has a close control.** Story 6.12 put one at top-right with a 44px target. Adding the shell's would double it.

**3. Do not migrate the five onto the shell.** Worth doing, not here.

**4. The destructive button keeps its weight.** This story renames the safe one; it does not re-rank the pair.

**5. The tests are the bulk.** Every suite that clicks "Abbrechen" changes. Grep before estimating.

### Testing

Vitest 3.2 + Testing Library, jsdom. Eleven dialog suites plus `i18nDictionaries.test.ts`. AC1's placement consistency is browser-only.

### Project Structure Notes

`src/components/ui/DialogShell.tsx`, five dialog components, `TripBucketListPanel` twice, both dictionaries, and the affected suites. No route, API or schema change.

### Sequencing

**After 6.24**, which applies the `✕` to the activity dialog alone. That story is the trial run: if the placement or the glyph reads wrong there, it is one file to change rather than eleven.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 6.25]
- [Source: travelplan/src/components/ui/DialogShell.tsx:84] — the title row the `✕` belongs in
- [Source: travelplan/src/components/features/trips/TripDeleteDialog.tsx:123] — the confirmation that keeps two buttons
- [Source: travelplan/src/components/features/trips/TripBucketListPanel.tsx:675,697] — one file, both kinds
- [Source: _bmad-output/implementation-artifacts/6-24-a-calmer-activity-dialog.md] — the trial run
- [Source: _bmad-output/implementation-artifacts/6-17-travel-segment-dialog-on-a-phone.md] — the `common.save` precedent for retiring a shared-looking key

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

### Change Log
