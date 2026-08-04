---
authored_against: 8ac08ae
baseline_commit: 2765fd8a8a3cc67e82613be2faf13309adf939cc
---

# Story 6.25: Close Is a Cross, and Keeping Is Named

Status: done

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
7. **Every form dialog asks before discarding typed input**, per `EXPERIENCE.md.State Patterns → Dismissing a dialog with unsaved input`. Story 6.24 establishes the behaviour on the activity dialog; this story carries it to the other nine.
8. **The design documents are updated with the change, not after it.** `DESIGN.md.Components → button` and the new `icon-button` entry, `EXPERIENCE.md`'s component table, Voice and Tone row and State Pattern were written on 2026-08-03 and are the specification this story implements. `mockups/forms-authoring.html` still draws the old footer and is named by DESIGN.md as the binding reference — it is brought into line here.
9. **Nothing else changes.** Every dialog opens, validates, saves and closes as before.

## Tasks / Subtasks

- [x] **Task 1 — The shell carries it** (AC: 1, 6)
  - [x] **Story 6.24 already built this**, behind an opt-in `closeLabel` prop that only `TripDayPlanDialog` passes. This task's remaining work is to make the prop **required** and drop the two `closeLabel ?` conditionals in `DialogShell` — the glyph, its `Tooltip`, its focus ring, the 44px hit area and the `disableDismiss` guard all exist and are tested in `formPrimitives.test.tsx` against real MUI. Read that suite first; it is the spec for what "the shell carries it" now means.
  - [x] `src/components/ui/DialogShell.tsx` owns the `DialogTitle` row. Its consumers are **four**, not six: `TripDayView`, `TripAccommodationDialog`, `TripCreateDialog`, `TripDayPlanDialog`. `FullscreenPhotoViewer` and `TripCostOverview` do **not** use the shell — corrected by 6.24's code review; verify with `grep -rn "<DialogShell" src`.
  - [x] Making `closeLabel` required puts a `✕` on the three consumers that do not pass one today. That is this story's job and 6.24's AC9 is why it was not done there.
  - [x] Note the heading shape 6.24 introduced: with a `closeLabel`, `DialogTitle` renders as a `div` and the title line becomes the `h2`, because otherwise the glyph's accessible name joins the heading's. Once the prop is required, that branch is the only shape and the conditional goes with it.
  - [x] The shell's title row has `borderBottom` and its own `id` for labelling — do not disturb either.
  - [x] The close action needs a handler. The shell already receives one for its dialog; confirm the prop shape before inventing a second.
  - [x] `FullscreenPhotoViewer` already has its own close control from Story 6.12. Check before adding a second one to the same corner. **Checked: it does, top-right and named, so it gets none from this story.**

- [x] **Task 2 — The ones that do not use the shell** (AC: 1, 6)
  - [x] `TripImportDialog`, `TripDeleteDialog`, `TripDayTravelSegmentDialog`, `TripBucketListPanel` (**two** dialogs), `TripEditDialog` build their own `Dialog`. Add the same control to each.
  - [x] **Widened by Story 6.24's code review (2026-08-03).** The original list named five files and missed the rest. The full inventory is **14 raw `<Dialog>` sites across 11 files** — verify with `grep -rn "<Dialog\b" src | grep -v DialogShell` before starting, and decide each one explicitly rather than by omission:
    - [x] **`TripDayPlanDialog`'s two nested dialogs** — the move picker (`:2109`) and the discard confirmation Story 6.24 added (`:2176`). Neither was in this task's original list, so both would have been missed. 6.24's record argues the discard confirmation should be *exempt*: it is a two-button destructive confirmation whose safe half ("Weiter bearbeiten") already **is** the close, which is the same carve-out Task 4 makes for the two delete confirmations. The move picker has no such argument and should get the `✕`. Record the decision either way — DESIGN.md says every dialog has exactly one, so an exemption has to be written down, not inferred. **Decided: the move picker gets the `✕`; the discard confirmation is exempt, but for a different reason than 6.24 gave — it is *raised by* a `✕`, so a glyph on it would mean the same thing as the glyph that opened it, and two clicks on the same corner would land the user back in the form they were leaving. The two delete confirmations are raised by a delete action, so theirs is an escape rather than a loop, and they do get one. Written up in the Completion Notes.**
    - [x] `TripDayView`'s two (`:3207` day transfer, `:3334` map) and the three map dialogs in `TripDayMapFullPage`, `TripOverviewMapFullPage`. **All done. Worth noting: the four map popups had no visible dismissal at all before this — only the backdrop and Escape.**
    - [x] `FullscreenPhotoViewer` (`ui/`) and `TripShareDialog` — both already have their own close control (6.12 and 7.5). Confirm before adding a second, as Task 1's last bullet already warns. **Confirmed and both exempt; reasons in the Completion Notes, `TripShareDialog`'s residual gap as DW-157, and both pinned by test so neither drifts into a second control.**
  - [x] **Do not migrate them onto `DialogShell` here.** That is a worthwhile cleanup and a different story; folding it in turns a chrome change into a refactor of a dozen dialogs with their own histories. **Not migrated. The residual 4px vertical difference between the two head paddings was measured and logged as DW-156.**
  - [x] Whatever the shell does, these must match it — same glyph, same position, same accessible name. If that means extracting a small shared piece, do that rather than copying markup a dozen times. **Extracted as `DialogCloseButton` / `DialogTitleWithClose` in `src/components/ui/DialogCloseButton.tsx`; `DialogShell` renders the same component.**
  - [x] The shared piece must carry the **focus ring** with it. `theme.ts` scopes the app-wide ring to `MuiButton`, so an `IconButton` shows nothing under keyboard focus unless it says so itself — Story 6.24 hit this on both of its icon buttons and fixed it per-site. See DW-154; this task is the natural place to solve it once. **Solved once, inside the shared control. DW-154's app-wide gap on the other ~16 icon buttons stays open — a `MuiIconButton` override is a sweep of its own.**

- [x] **Task 3 — Remove `Abbrechen` from the ten forms** (AC: 2, 4)
  - [x] **Eleven sites, not twelve** — Story 6.24 removed `TripDayPlanDialog`'s footer `Abbrechen`, so its remaining reader is the move picker alone. Re-grep rather than trusting these line numbers, all of which 6.24 moved: `grep -rn 'common\.cancel' src | grep -v i18n/`. As of 2026-08-03: `TripImportDialog:456`, `TripAccommodationDialog:822`, `TripDayPlanDialog:2064` (the move picker), `TripDayTravelSegmentDialog:757`, `TripCreateDialog:69`, `TripDayView:3238` and `:3270`, `TripBucketListPanel:675`, `TripEditDialog:359` — nine forms; plus `TripDeleteDialog:123` and `TripBucketListPanel:697`, which are Task 4. **Re-grepped: eleven confirmed, exactly this list.**
  - [x] Note `TripBucketListPanel` holds **both** kinds: `:675` is the add/edit form, `:697` is the delete confirmation. They are two different dialogs in one file and must not be treated alike. **They were not: the form lost its cancel, the confirmation kept two buttons.**
  - [x] Once all eleven are done, `common.cancel` has no readers. Delete it from `de.ts` and `en.ts` — `i18nDictionaries.test.ts` enforces parity, and a key left behind is the `common.save` shape Story 6.17 wrote a trap about. That suite currently pins "the remaining eleven"; it is the count to trust. **Deleted from both. `i18nDictionaries.test.ts` gained a `story 6.25 key changes` block asserting its absence.**

- [x] **Task 4 — The two confirmations** (AC: 3)
  - [x] `TripDeleteDialog:123`: `common.cancel` becomes a new key reading "Reise behalten" / "Keep trip". The neighbouring `trips.delete.submit` is `color="error"` and stays exactly as it is. **`trips.delete.keep`; `submit` untouched.**
  - [x] `TripBucketListPanel:697`: the same, "Eintrag behalten" / "Keep entry", beside `trips.bucketList.deleteConfirm`. **`trips.bucketList.deleteKeep`, and the English is "Keep item" rather than "Keep entry": the neighbour reads "Delete item", and two nouns for one object breaks the exact thing AC3 is for. The German is as written. The noun match is now asserted rather than left to the eye.**
  - [x] **Both buttons stay.** The safe answer must not shrink to a corner glyph when the other one is destructive and red — that is the whole reason these two are carved out. **Both stay. Measured on screen: 139px beside 137px.**
  - [x] Keep the visual weight as it is: the destructive button is contained and red, the keeping one is not. Naming the outcome is the change; re-ranking them is not. **Unchanged, and pinned by class assertions as well as measured.**

- [x] **Task 5 — Tests** (AC: 1, 2, 3, 4, 7)
  - [x] Every dialog suite that clicks `Abbrechen` needs rewriting to the `✕`. Grep the test tree for the label before starting — that is the bulk of the work. **Grepped first, and it was not the bulk: only two suites clicked it. The actual bulk was two suites needing a `ThemeProvider` they had never needed, because the glyph reads `theme.palette.tokens`.**
  - [x] Assert the close control exists and is named in each dialog, and that it closes without saving. **`test/dialogCloseAffordance.test.tsx`, new — 28 cases.**
  - [x] Assert the two confirmations still render **two** buttons, and that the safe one carries the new wording. **Done, plus the unchanged visual weight.**
  - [x] Assert `common.cancel` is absent from both dictionaries, the way `i18nDictionaries.test.ts` already asserts it for `common.save`. **Done, plus the three promoted `trips.plan.discard*` keys.**
  - [x] `npm test` green. **1213 passed across 111 files, from 1181/110.**

- [x] **Task 6 — The mockups** (AC: 8)
  - [x] `mockups/forms-authoring.html` draws `Abbrechen` in four dialog footers (lines 545, 650, 748, 899) and is the only mockup that does. DESIGN.md names it the binding reference for dialog footers, so a story that changes footers and leaves it alone creates exactly the drift Story 7.11 exists to clean up. **Of those four line numbers, only two (650, 748) are dialog-footer buttons; 545 is prose describing Screen F and 899 is the swatch specimen. All four were addressed.**
  - [x] Remove the four `btn-secondary` cancel buttons from the form dialogs, add the `✕` to their title rows, and leave the swatch sheet's `btn-secondary` specimen in place — the variant still exists, for destructive confirmations. **Done. The specimen stays but is relabelled "Reise behalten": DESIGN.md now defines that variant by its rank and forbids "Abbrechen" on it, so a specimen carrying that word contradicts the entry it illustrates. An `icon-button.close` specimen was added beside it.**
  - [x] If a destructive confirmation is not mocked at all, say so rather than inventing one: the gap belongs in the record. **It is not mocked anywhere in the file. Recorded in the file's own rationale block, along with a second drift found while there: Screen G's footer says "Speichern" where the activity dialog has said "OK" since 6.24.**

- [x] **Task 7 — Manual check** (AC: 1, 3)
  - [x] Throwaway copy of `dev.db` on an isolated port — never `prisma/dev.db`. Recipe in `7-12-bucket-list-sidebar-card.md`'s Dev Notes. **Followed: scratchpad DB copy, detached `git worktree`, ports 3097/3096. `prisma/dev.db` was never opened; everything was removed afterwards.**
  - [x] Open each of the eleven dialogs at 390px and confirm the `✕` sits in the same place every time. Consistency is the point; one dialog with it somewhere else is worse than none having it. **Fifteen dialogs carry the glyph and thirteen were opened. `insetRight` was 15.0px on every one, at 390px and 1400px. `insetTop` is 11px on the four shell dialogs and 7px on the raw ones — the head-padding difference, DW-156. The two not reached (TripDayView's inline map popup, the bucket-list delete confirmation) are covered by tests.**
  - [x] Scroll a long dialog to the bottom and confirm the `✕` is still reachable — the title row is fixed and only the content scrolls, so it should be, but this is the assumption the pattern rests on. **Measured: the stay dialog scrolled 883px with `glyphMovedPx: 0` and `headMovedPx: 0`, glyph still in the viewport.**
  - [x] Open both delete confirmations and read them aloud: "Reise behalten" / "Reise löschen" should be two outcomes, not a question and an answer. **They are: 139px transparent with accent text beside 137px `#8A5A2B` filled with white.**
  - [x] **Not in the spec, found by doing it:** an untouched "Neue Reise" dialog asked "Änderungen verwerfen?" on its own `✕`. Cause and fix in the Completion Notes; this is the finding that justifies the task.

### Review Findings

Code review 2026-08-04 (`bmad-code-review`, three parallel layers: Blind Hunter and Edge Case Hunter on a spec-free diff, Acceptance Auditor against this file). 34 raw findings, deduped to 24. Verified independently before triage: `npm test` **1213/111 green**, lint **85 problems / 2 errors** (both pre-existing in `src/theme.ts`), `tsc --noEmit` **0 `src/` errors** — all three headline numbers in the Completion Notes hold exactly.

Three findings below were raised by all three layers independently; those are marked **(3/3)**.

**Decisions — resolved by Tommy, 2026-08-04**

- [x] [Review][Decision] **`TripShareDialog` is a form dialog with typed input and no discard guard** — AC7 says "*every* form dialog asks before discarding typed input". This dialog holds a live react-hook-form invite form (`email`, `role`, `temporaryPassword` at `TripShareDialog.tsx:452,461,487`) and both its dismissals — the `<Dialog onClose>` at `:407` and the footer `Schließen` at `:628` — call `onClose` unguarded. It fell out of scope because AC7's "other nine" was derived from the `common.cancel` reader list, which this dialog was never on. DW-157 exempts it from the close-*placement* only and says nothing about the guard. Either wire the guard (one `useDiscardGuard` call, same shape as the other nine) or record the exemption explicitly — right now it is neither. **Resolved: wire the guard.** AC7's "every" admits no exemption, and a typed invite email plus a temporary password is exactly the loss the guard exists to prevent. Promoted to a patch below. DW-157 continues to cover the close *placement* only.
- [x] [Review][Decision] **The guard fires on two one-select pickers** (day transfer `TripDayView.tsx:967`, move picker `TripDayPlanDialog.tsx:1300`), where "something to lose" is a single dropdown choice. The Completion Notes flag this for a reviewer themselves. EXPERIENCE.md's rule has no triviality threshold and AC7 names all nine, so uniform application is defensible — but this is where uniform may read as over-asking, and it is one boolean per site to relax. **Resolved: keep uniform.** EXPERIENCE.md's rule has no triviality threshold and AC7 names all nine; a guard that fires on some dialogs and not others is harder to learn than one that always fires. No code change. Note that fixing the move picker's reset (patch below) also stops it firing spuriously on a reopen.
- [x] [Review][Decision] **`TripImportDialog`'s post-import "Fertig" is a second dismissal beside the `✕`** — `TripImportDialog.tsx:485-489` renders a contained `trips.import.done` that calls `onClose` directly. AC2 says a form dialog's footer keeps only the confirming action and `DESIGN.md:257` says it carries no secondary button. The Completion Notes argue it is an acknowledgement of a result rather than a dismissal, which is reasonable — but it was never surfaced into a task or AC, and the rename was driven by a test-query ambiguity, a weaker reason than the AC it bends. **Resolved: keep the button, and promote the reasoning from a Completion Note into a written-down exemption** (patch below) so it is not re-litigated. In the post-import state that button acknowledges a result the user has to read; it is not a dismissal offered instead of committing.
- [x] [Review][Decision] **The discard confirmation's `✕` exemption contradicts 6.24's reading of AC3** — argued in three places and coherent (it is *raised by* a `✕`, so a second would loop). Flagged only because it is the story's one self-granted exemption against `DESIGN.md`'s "every dialog has exactly one", and it reverses a prior story's call. Ratify or revisit. **Resolved: ratified.** The argument holds — the dialog is *raised by* a `✕`, so a glyph in the same corner would mean the same thing as the one that opened it, and two clicks would land the user back in the form they were leaving. Escape and the backdrop already resolve to keeping, so the safe default needs no glyph. 6.24's reading of AC3 is superseded.

**Patches**

- [x] [Review][Patch] **`TripShareDialog` gets the discard guard** [travelplan/src/components/features/trips/TripShareDialog.tsx:407] — from the decision above. Wire `useDiscardGuard` over the invite form's dirty signal and route both `<Dialog onClose>` (`:407`) and the footer `Schließen` (`:628`) through `requestClose`. Use `dirtyFields` rather than `isDirty`, per the defect the browser pass caught on `heroImage`. **severity: medium**
- [x] [Review][Patch] **Write down the two ratified exemptions where the next reader will find them** — from the decisions above: `TripImportDialog`'s post-import "Fertig" (why a second dismissal is correct in that one state) and `DiscardChangesDialog`'s missing `✕` (already argued in three places, now ratified and superseding 6.24's reading of AC3). Both currently live only in this story's Completion Notes; they belong in the components' own docblocks, since `DESIGN.md` requires an exemption to be argued rather than inferred. **severity: low**

- [x] [Review][Patch] **"Discard changes" discards nothing in the day-image dialog, and the discarded note can still be saved** [travelplan/src/components/features/trips/TripDayView.tsx:1091] — `handleCloseDayMeta` is `setDayMetaOpen(false)` and nothing else; `dayNoteDraft`/`dayImageFile` are re-seeded only by the effect keyed on `[day?.id, day?.note]`, neither of which changes on close. Type a note → `✕` → "Änderungen verwerfen" → reopen: the discarded text is back, the guard reads dirty immediately, and `handleSaveDayImage` (`:1860`) / `handleRemoveDayImage` (`:1957`) both post `dayNoteDraft` — so the note the user explicitly discarded reaches the server. Contrast `TripDayPlanDialog.tsx:776-790`, whose open effect does clear its equivalents. **severity: high**
- [x] [Review][Patch] **The move picker keeps the target day the user just discarded** [travelplan/src/components/features/trips/TripDayPlanDialog.tsx:1296] — `closeMovePicker` does not reset `moveTargetDayId`; only the *outer* activity dialog's open effect does (`:788`). Pick a day → `✕` → "Discard" → reopen the picker from the same activity: it is pre-filled with the abandoned day, confirm is enabled, and one click moves the activity there. The docblock's claim that "It opens with `moveTargetDayId` blank" is true only for the first open per activity. **severity: high**
- [x] [Review][Patch] **(3/3) The accommodation dialog reads raw `isDirty` while two on-open effects write `shouldDirty: true`** [travelplan/src/components/features/trips/TripAccommodationDialog.tsx:812] — the normalisation effect at `:230-241` force-syncs `payments.0.amount` to `costCents` on open whenever `paymentMode === "single"`. For a stay whose single stored payment differs from its cost (a deposit against a larger total, or `costCents: null` with a payment row), `isDirty` latches true before the user touches anything and every dismissal asks to discard changes that do not exist. This is the same defect class as the `heroImage`/`FileList` one the browser pass caught, on the one dialog left on `isDirty` rather than moved to `dirtyFields`. The new regression case (`dialogCloseAffordance.test.tsx:466`) uses a fixture with no `payments` array, the one shape where `buildDefaultPayments` makes the two sides equal by construction and the effect provably cannot fire. **severity: high**
- [x] [Review][Patch] **Staged gallery photos survive the discard and latch the stay guard permanently dirty** [travelplan/src/components/features/trips/TripAccommodationDialog.tsx:160] — `setGalleryFiles([])` runs only after a *successful upload* (`:652`), never on open or close, and the dialog is never unmounted. Select photos → `✕` → "Discard" → reopen: the field still reads "n files selected", Upload is live for files the user discarded, and `galleryFiles.length > 0` makes `stayGuard` dirty forever. `TripDayPlanDialog.tsx:784` clears exactly this state; this dialog does not. **severity: medium**
- [x] [Review][Patch] **"Discard changes" is a silent no-op when the underlying closer is blocked** [travelplan/src/components/ui/DiscardChangesDialog.tsx:69] — `onDiscard` calls `onClose()` unconditionally, but three closers early-return on an in-flight write (`TripDayView.tsx:881`, `TripDayPlanDialog.tsx:1297`, `TripCreateDialog.tsx:34`). Answer "Änderungen verwerfen" while a request is in flight and the question vanishes, the dialog stays open, the selection stays, and the user's unambiguous destructive answer produced nothing and no feedback. **severity: medium**
- [x] [Review][Patch] **The new test file does not type-check** [travelplan/test/dialogCloseAffordance.test.tsx:636] — `images={[{ url: …, alt: … }]}` against `FullscreenPhoto = { key, imageUrl, alt }` (`FullscreenPhotoViewer.tsx:38-44`). Reproduced: `TS2353: 'url' does not exist in type 'FullscreenPhoto'`. It is the only *new* `tsc` error in this change — the Completion Notes' "the `test/` errors are pre-existing" is true as worded but skips it. The test passes anyway because it asserts only on the close button, so it renders a viewer with `imageUrl === undefined` and a missing `key`. **severity: medium**
- [x] [Review][Patch] ~~**A failed hero-image upload leaves the create form reported clean**~~ [travelplan/src/components/features/trips/TripCreateForm.tsx:326] — **withdrawn on verification; no code change.** The mechanism the finding describes is real: on the `uploadFailed` branch `reset()` and `setHeroImageSelected(false)` do run before the `if (!uploadFailed) onSuccess?.()` guard, so the form reports clean while the dialog stays open showing the error. But closing silently is the *correct* behaviour there, and raising the discard question would be wrong: the trip has already been created and `onCreated` has already fired, so there are no unsaved changes to discard — only a hero image that did not upload, which the form cannot retry anyway (re-submitting would create a second trip) and which the user can add by editing the trip. "Änderungen verwerfen?" over a saved trip would name an outcome that is not the one on offer. The real residual gap is narrower and is not a dirty-signal problem: closing dismisses the *knowledge* that the upload failed. Not patched, and not deferred either — recorded here so the next reviewer does not re-raise it. **severity: none, on inspection**
- [x] [Review][Patch] **Four map-popup glyphs have no test, and the record says one of them does** [travelplan/src/components/features/trips/TripDayView.tsx:3361] — the Completion Notes state that `TripDayView`'s inline map popup is "covered by `dialogCloseAffordance.test.tsx`, which asserts the glyph's presence". That suite does not import `TripDayView` at all (imports at `:6-18`), and no test anywhere asserts `dialog-close` for it or for `TripDayMapFullPage` / `TripOverviewMapFullPage`. Those four glyphs are neither browser-measured nor unit-tested. Fix the coverage or fix the record. **severity: medium**
- [x] [Review][Patch] **The "both directions" coverage claim covers four of the nine guards** [travelplan/test/dialogCloseAffordance.test.tsx:393-566] — the Completion Notes and `sprint-status.yaml` both say "each dialog's dirty signal in BOTH directions". The block asserts trip edit, trip create (one direction), accommodation and travel segment. No dirty-signal assertion in either direction exists for the bucket-list form, the import dialog, the move picker or the day-image dialog. Not a wiring defect — the wiring is real in all nine — but note that the move picker and the day-image dialog are exactly where the two `high` findings above live. **severity: medium**
- [x] [Review][Patch] **The import discard question fires when there is nothing to discard** [travelplan/src/components/features/trips/TripImportDialog.tsx:101] — the dirty signal is `file !== null && result === null`, which is also the state after the server *rejects* a file. Pick a corrupt backup → import fails → `✕` to go pick another → "Änderungen verwerfen?" over a non-outcome, in the generic wording. **severity: low**
- [x] [Review][Patch] **The create dialog's 800 ms success timer bypasses the guard** [travelplan/src/components/features/trips/TripCreateDialog.tsx:56] — `handleSuccess` calls `onClose()` directly rather than `createGuard.requestClose`. Type into the reset form during the success window and the input is thrown away with no question, where the same input one tick later would be guarded. **severity: low**
- [x] [Review][Patch] **The test that claims to catch `closeLabel={undefined}` cannot catch it** [travelplan/test/formPrimitives.test.tsx:329] — its docstring says a `closeLabel={undefined}` slipping through a spread "would compile" and is what this case pins, but it asserts only `getByTestId("dialog-close")`. `renderShell` spreads `{...props}` after the fixture's `closeLabel`, so `renderShell({ closeLabel: undefined })` still renders the button and still passes. The meaningful assertion (`toHaveAccessibleName`) lives in a different case on the default fixture. **severity: low**
- [x] [Review][Patch] **The noun-match assertion is positional, asymmetric, and checks one language per pair** [travelplan/test/i18nDictionaries.test.ts:2089] — it compares `en` for the bucket-list pair and `de` for the trip pair via `.split(" ")[n]`. The German bucket-list pair and the English trip pair are never checked, and the index arithmetic breaks on any label that gains a word. Reworking German to "Eintrag behalten" / "Punkt löschen" passes every assertion while breaking the property the docstring pins. **severity: low**
- [x] [Review][Patch] **Off-by-one in the new shared component's own docs, plus a dead prop** [travelplan/src/components/ui/DialogCloseButton.tsx:12] — "ten dialogs that build their own `<Dialog>`" appears at `DialogCloseButton.tsx:12,13,89,95` and `DialogShell.tsx:158,159`; there are **eleven** `<DialogTitleWithClose>` call sites, and the Completion Notes and Change Log both say eleven. Separately, `DialogTitleWithCloseProps.sx` is documented "for the two callers that need extra padding" (`:82`) and **no caller passes it**. **severity: low**

**Deferred (pre-existing, logged as DW-159 … DW-162)**

- [x] [Review][Defer] **Escape and the backdrop are not blocked during an in-flight write on the eleven raw `<Dialog>` sites, while the `✕` is** [travelplan/src/components/features/trips/TripDeleteDialog.tsx:112] — deferred, pre-existing (DW-159). Baseline `TripDeleteDialog` already had `onClose={onClose}` unguarded beside a `disabled={isDeleting}` footer button; the story preserved the shape rather than introducing it. Worth recording because `DialogShell.tsx:110-115` *does* guard both gestures, so "whatever the shell does, these must match it" is not yet true for dismissal-during-write.
- [x] [Review][Defer] **The eleven non-shell dialogs set no `aria-labelledby`, so a screen reader announces an unnamed dialog** [travelplan/src/components/ui/DialogCloseButton.tsx:93] — deferred, pre-existing (DW-160). `DialogTitleWithClose` renders `<Box component="h2">` with no `id` and no call site wires it to the `<Dialog>`; `DialogShell.tsx:138` does it explicitly and `formPrimitives.test.tsx` asserts it for that path. Pre-existing, but this change created the one component where it could be fixed once.
- [x] [Review][Defer] **`TripDayTravelSegmentDialog`'s open snapshot became a `useMemo` over live props** [travelplan/src/components/features/trips/TripDayTravelSegmentDialog.tsx:277] — deferred, pre-existing risk class (DW-161). The lint reason is sound (`react-hooks/refs`, and a ref read during render is a real hazard), but the semantic change is real: equivalent only while `segment`/`mapsLink` are stable for the dialog's lifetime. If the parent re-supplies `segment` while the dialog is open, both the dirty baseline and the stale-route-restore target shift under it, where the ref would have held. Untested.
- [x] [Review][Defer] **No destructive confirmation is drawn in `forms-authoring.html`** — deferred, self-declared in the change (DW-162). DESIGN.md names that file the binding reference for dialog footers, and after this story the two-button footer is the only footer shape in the app it does not contain. The `btn-secondary` specimen now carries a usage constraint ("nur als sichere Hälfte einer zerstörenden Bestätigung") with no drawn instance to check it against.

**Dismissed as noise (3)**

- The two delete confirmations offer both a `✕` and "Reise behalten" for the same outcome — AC3 mandates both buttons; the redundancy is the specification, not a defect.
- "Three unrelated dirty strategies feed one hook that validates none of them" — architectural observation. A boolean is the correct seam for the hook; the concrete instances are the accommodation findings above.
- AC2, AC4 and AC6 carry counts that were already wrong at the baseline (twelve/ten/six against eleven/nine/four) — the Task text carries the corrections and the build follows them. The auditor confirmed the Acceptance Criteria block is byte-identical in the diff, i.e. nothing was rewritten to match what was built.

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

claude-opus-5[1m] (Claude Opus 5, 1M context) via `bmad-dev-story`.

### Debug Log References

**Browser pass** — throwaway copy of `dev.db` in the session scratchpad, `git worktree` detached at `2765fd8` with the changed source files copied in, `next dev` on port 3097 (and 3096 for the re-verification), `DATABASE_URL` and `UPLOADS_PUBLIC_ROOT` pointed at scratch paths, Playwright/Chromium at 390×844 and 1400×1000, `lang=de`. `prisma/dev.db` was never opened; its size and `git status` are unchanged. Worktree, database copy, the throwaway password hash, the cached session and the temporary Playwright install were all removed afterwards; `git worktree list` shows only `main` and the pre-existing `TravelPlan-wt-614`.

Four notes for the next person doing this:

- **MUI's `Modal` stamps `aria-hidden="true"` on the app root while a dialog is open**, and Playwright's role selectors respect it. A probe that clicks the `✕` and then immediately looks for the next trigger finds nothing and reports "trigger not found" rather than failing — the wrong diagnosis. Every dismissal needs `waitForFunction(() => document.querySelectorAll('[role="dialog"]').length === 0)` after it.
- The login route allows **10 attempts per 10 minutes** per IP and the counter is in-process, so an iterating run gets 429s until the dev server is restarted. Caching `storageState` to disk after the first sign-in removes the problem entirely.
- The login page is at `/auth/login`, not `/login`, and the language is **cookie-driven** (`lang`) rather than taken from the user's `preferred_language` — so a German pass has to set the cookie on the context.
- `npx prettier` has **no config in this repo** and defaults to 80 columns, so running it on a source file reformats the whole thing. It is not the project's formatter; the surrounding style is ~120 columns and hand-maintained.

### Completion Notes List

**AC1/AC6 — the `✕` is one control, not fifteen copies of one.**

`DialogShell`'s `closeLabel` is now required and both `closeLabel ?` conditionals are gone, so the heading-role shape 6.24 introduced is the only shape. The glyph itself moved out into `src/components/ui/DialogCloseButton.tsx`, which exports two things: `DialogCloseButton` (the 44px control, its `Tooltip`, its focus ring) and `DialogTitleWithClose` (a `DialogTitle` that carries it, for the nine dialogs that build their own `<Dialog>`). The shell renders the same `DialogCloseButton`, so "whatever the shell does, these must match it" is true by construction rather than by review.

That extraction is the one structural decision in this story and it is load-bearing in three ways: the 44px geometry, the `Tooltip`-not-`title` choice and the **focus ring** all travel with the glyph. `theme.ts` scopes the app-wide ring to `MuiButton`, so an `IconButton` computes `outline: 0px`; 6.24 fixed that per-site on two controls, and fifteen hand-copies would have drifted on the first one somebody edited. DW-154's app-wide gap on the other ~16 icon buttons is untouched and still open.

The heading fix travels with it too, and had to. MUI's `DialogTitle` is an `<h2>` with the glyph inside it, so name-from-content walks into the button and a screen reader navigating by heading hears "Reise löschen · Schließen". `DialogTitleWithClose` renders `component="div"` and puts the heading role on the title line, matching what the shell does. Nine dialogs would otherwise each have reintroduced it.

**Fifteen dialogs carry the glyph** — 4 via `DialogShell` and 11 via `DialogTitleWithClose` (`grep -c "<DialogTitleWithClose" src` and `grep "closeLabel={" src`). Three are exempt, all three written down below.

**Thirteen of the fifteen were measured on screen** at 390px: 44×44, `rgba(0, 0, 0, 0)` background, `border-style: none`, `rgb(107, 103, 92)` = `#6B675C` = `{colors.ink-soft}`. `insetRight` from the paper's right edge was **15.0px on every one of the thirteen, at 390px and 1400px alike** — the consistency claim AC1 and Task 7 are actually about. The two not reached by the browser probes are `TripDayView`'s inline map popup (the full-page map's identical popup was measured instead) and the bucket-list delete confirmation; both are covered by `dialogCloseAffordance.test.tsx`, which asserts the glyph's presence in each. `insetTop` is 11px on the four shell dialogs and 7px on the raw ones; that 4px is the two heads' different top padding, it predates this story (the *title text* sits 4px lower in the shell too, so in both shapes the glyph is aligned to its own title's first line), and it is what the deferred shell migration would remove — **DW-156**.

**Four dialogs gained their first visible dismissal.** The map popups in `TripDayView`, `TripDayMapFullPage` and `TripOverviewMapFullPage` have no footer at all and were dismissible only by the backdrop and Escape — neither discoverable on a touch screen. Confirmed on screen: `{"hasGlyph": true, "insetRight": 15, "insetTop": 7, "footerButtons": []}`.

**AC2/AC4 — `common.cancel` really is orphaned, and it is gone.** Eleven readers, nine of them form footers, all removed; the key is deleted from both dictionaries and `i18nDictionaries.test.ts` holds the line in a new `story 6.25 key changes` block, the same way it does for `common.save`. Verified on screen rather than only by grep: every dialog opened in the browser reported `cancelButtons: []`.

**AC3 — the two confirmations.** `trips.delete.keep` = "Reise behalten" / "Keep trip"; `trips.bucketList.deleteKeep` = "Eintrag behalten" / **"Keep item"**. Read aloud in the browser, "Reise behalten" measures 139px (transparent, `rgb(75, 99, 88)` accent text) beside "Reise löschen" at 137px (`rgb(138, 90, 43)` fill, white) — two outcomes of near-equal width, which is what makes the pair a choice rather than a question and an answer. The weight is untouched: naming the outcome was the change, re-ranking was not.

**The English deviates from the story's parenthetical.** Task 4 suggests "Keep entry"; the neighbour is `trips.bucketList.deleteConfirm` = "Delete item". "Keep entry" beside "Delete item" is two nouns for one object, which breaks the exact thing AC3 exists for. "Keep item" it is, and `i18nDictionaries.test.ts` now asserts the noun match rather than leaving it to the eye. The German is the binding wording and is exactly as the request wrote it.

**AC7 — the discard guard on nine more dialogs, and the defect the browser found.**

`useDiscardGuard` + `DiscardChangesDialog` in `src/components/ui/DiscardChangesDialog.tsx` own the pattern once. 6.24's inline copy inside `TripDayPlanDialog` was converted to use it, passing its dialog-specific body and keeping the `plan-discard-body` testid, so 6.24's assertions still point at the same element. Its `discardTitle`/`discardConfirm`/`discardKeep` keys were promoted to `common.discard.*`: a `common.` name for a genuinely shared thing, which is the distinction 6.17's note was drawing — the trap is a shared-*sounding* name with one reader, and these have ten.

Each dialog's own dirty signal is the half that can be silently wrong, so all nine were wired individually and the two directions are asserted separately. `react-hook-form`'s `dirtyFields` where a form exists, an explicit comparison against the values the dialog opened with where one does not. Deliberate exclusions, following 6.24: search-box text no save persists (`locationQuery`, both `*LocationQuery`) does not count; images already on the server do not count; staged-but-unuploaded files do.

**The defect.** An untouched "Neue Reise" dialog raised "Änderungen verwerfen?" on its own `✕`. Cause: `heroImage` is a registered file input whose value is an empty `FileList`, while `defaultValues` does not mention it — and a `FileList` never deep-compares equal to `undefined`, so react-hook-form's `isDirty` is `true` from the first render and can never clear, with `dirtyFields` empty the whole time. Both `heroImage` forms (`TripCreateForm`, `TripEditDialog`) had it. Fixed by reading `dirtyFields` instead of `isDirty`, plus an explicit `heroImageSelected` flag for the one bit `dirtyFields` cannot carry.

**jsdom does not reproduce it** — its empty file input compares equal — so the "untouched closes silently" test passed before the fix and passes after it. That is the honest reason this needed a browser, and it is why the two new tests pin the *file-chosen* direction (which does exercise the new flag) rather than pretending to cover the one that only a browser sees.

Confirmed live over three open/close cycles, which is the sequence that matters: untouched closes silently → typed-into asks → **untouched after a discard closes silently again**. That third cycle is what the flag's reset is for, and it is reset during render rather than in the open effect, per React's own prescription for resetting state on a prop change — the same idiom `TripDayView` uses for the day menu's anchor. Doing it in the effect tripped `react-hooks/set-state-in-effect` and would also have cleared one render late.

Also verified live: the travel-segment dialog (untouched silent, `Dauer (Std.)` 2 → 5 asks, "Weiter bearbeiten" leaves the 5 in place, "Änderungen verwerfen" closes), the day-image dialog, and the day-transfer picker (nothing chosen closes straight through; a target chosen asks).

**Judgements a reviewer should look at rather than assume:**

- **The discard confirmation gets no `✕`, and that is the story's one written-down exemption.** DESIGN.md says every dialog has exactly one close, so an exemption has to be argued. This dialog is *raised by* a `✕`, so a glyph on it would mean the same thing as the glyph that opened it — and two clicks on the same corner would land the user back in the form they were leaving, which is a trap rather than a consistency. Escape and the backdrop already resolve to keeping, so the safe default needs no glyph. **This contradicts 6.24's suggestion that AC3 requires one**, and it is the opposite call from the two delete confirmations, which are raised by a delete action and therefore get one. Confirmed absent on screen.
- **`TripShareDialog` is exempt, and that is a judgement, not an oversight.** Its dismissal is already a named 44px control — a footer `Schließen` from 7.5 — and `mockups/trips-list-share-login.html:585` draws it there. Adding a `✕` would give it two dismissals with the same name; moving the existing one deletes a footer bar the mockup specifies, and Task 6 scopes mockup work to `forms-authoring.html`. Logged as **DW-157** and pinned by a test so it cannot drift into a second control unnoticed. `FullscreenPhotoViewer` is exempt for a simpler reason: no title row, and its close is already top-right in the on-photo chrome DESIGN.md specifies.
- **`TripImportDialog`'s post-import footer says "Fertig", not `common.close`.** With the `✕` above it, `common.close` put two controls named "Schließen" in one dialog and the suite caught it as an ambiguous query. A new `trips.import.done` key; "Fertig" also names the outcome rather than the mechanism. The button itself stays, because in that state it is the acknowledgement of a result the user has to read, not a dismissal offered instead of committing.
- **The guard fires on two one-select pickers** (day transfer, move picker), where "something to lose" is a single dropdown choice. EXPERIENCE.md's rule has no triviality threshold and AC7 names all nine, so it is applied uniformly — but this is the place where uniform might read as over-asking, and it is one boolean per site to relax.
- **`TripDayTravelSegmentDialog`'s open snapshot became a `useMemo`.** It was a ref, and the dirty comparison reads it during render — an eslint error (`react-hooks/refs`) and a real hazard, since nothing re-renders when a ref changes. Derived from exactly the inputs the open effect keys on, so seeding and comparing cannot drift apart. The restore-a-stale-import path reads the same value.
- **`TripCreateForm` gained an `onDirtyChange` prop.** The form lives in a different component from the dialog that owns the `✕`, so the child has to report up. It mirrors the existing `onSubmittingChange` exactly; the standalone `/trips/new` mount simply does not pass it.

**Two suites needed a `ThemeProvider` they had never needed before** (`travelSegmentDialog`, `tripEditDialogHeroImage`). The close control reads `theme.palette.tokens`, absent under MUI's bare default theme, so the component throws rather than rendering something subtly wrong. Wrapped at the suite's own `render` helper rather than at ~50 call sites; the per-test `I18nProvider` and its language are untouched. `test/helpers/renderWithProviders.tsx` already documents this exact reason for the suites that needed it from the start.

**AC5 — untouched.** Form confirmations still say `OK`. No key that reads "OK" was changed.

**AC8 — the mockup.** `forms-authoring.html`'s two form-dialog footers lost their `btn-secondary` and both heads gained the `✕`; `.dialog-head` is a flex row now with a `.dialog-close` rule carrying the 44/20/ink-soft/6px spec, and a new `icon-button.close` specimen sits in the swatch sheet. The `btn-secondary` specimen stays — the variant still exists — but its label changed from "Abbrechen" to "Reise behalten", because DESIGN.md now defines that variant by its rank and explicitly forbids that word on it. **Two gaps are recorded in the file rather than papered over:** no destructive confirmation is mocked anywhere in it, so the "Reise behalten"/"Reise löschen" pair has no picture despite DESIGN.md naming this file the binding reference for dialog footers — drawing one from the code would be a transcription, not a design decision; and Screen G's footer still says "Speichern" where the activity dialog has said "OK" since 6.24, which is 6.24's drift and not fixed by a word DESIGN.md does not specify.

**AC9 — behaviour.** Every dialog opens, validates, saves and closes as before. Save paths, the delete confirmations, the move, the day transfer and the gallery uploads are unchanged and still covered; the trip-edit save, the segment save and both confirmations were re-exercised in the browser.

The travel-segment dialog needed a day with an actual segment (day 3, not day 1), which is why the browser pass took three runs rather than one.

**Numbers.** Tests **1181 → 1213** across 110 → 111 files, all green. Lint back to its **85-problem / 2-error baseline** (both errors pre-existing, in `src/theme.ts`) after the two regressions the browser pass surfaced were fixed. `tsc --noEmit`: **0 errors in `src/`**; the `test/` errors are pre-existing.

### File List

- `travelplan/src/components/ui/DialogCloseButton.tsx` (new)
- `travelplan/src/components/ui/DiscardChangesDialog.tsx` (new)
- `travelplan/src/components/ui/DialogShell.tsx` (modified)
- `travelplan/src/components/features/trips/TripAccommodationDialog.tsx` (modified)
- `travelplan/src/components/features/trips/TripBucketListPanel.tsx` (modified)
- `travelplan/src/components/features/trips/TripCreateDialog.tsx` (modified)
- `travelplan/src/components/features/trips/TripCreateForm.tsx` (modified)
- `travelplan/src/components/features/trips/TripDayMapFullPage.tsx` (modified)
- `travelplan/src/components/features/trips/TripDayPlanDialog.tsx` (modified)
- `travelplan/src/components/features/trips/TripDayTravelSegmentDialog.tsx` (modified)
- `travelplan/src/components/features/trips/TripDayView.tsx` (modified)
- `travelplan/src/components/features/trips/TripDeleteDialog.tsx` (modified)
- `travelplan/src/components/features/trips/TripEditDialog.tsx` (modified)
- `travelplan/src/components/features/trips/TripImportDialog.tsx` (modified)
- `travelplan/src/components/features/trips/TripOverviewMapFullPage.tsx` (modified)
- `travelplan/src/components/features/trips/TripShareDialog.tsx` (modified — code review, AC7 guard)
- `travelplan/src/i18n/de.ts` (modified)
- `travelplan/src/i18n/en.ts` (modified)
- `travelplan/test/dialogCloseAffordance.test.tsx` (new)
- `travelplan/test/formPrimitives.test.tsx` (modified)
- `travelplan/test/i18nDictionaries.test.ts` (modified)
- `travelplan/test/travelSegmentDialog.test.tsx` (modified)
- `travelplan/test/tripDayViewLayout.test.tsx` (modified)
- `travelplan/test/tripEditDialogHeroImage.test.tsx` (modified)
- `travelplan/test/tripImportDialog.test.tsx` (modified)
- `travelplan/test/tripDayPlanDialog.test.tsx` (modified — code review, move-picker reset regression)
- `travelplan/test/tripDayMapFullPage.test.tsx` (modified — code review, map popup `✕`)
- `travelplan/test/tripOverviewMapFullPage.test.tsx` (modified — code review, map popup `✕`)
- `_bmad-output/planning-artifacts/ux-designs/ux-TravelPlan-2026-07-27/mockups/forms-authoring.html` (modified)
- `_bmad-output/implementation-artifacts/deferred-work.md` (modified)
- `_bmad-output/implementation-artifacts/6-25-close-is-a-cross-keeping-is-named.md` (modified)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified)

### Change Log

- 2026-08-04 — Story 6.25 implemented. Every dialog in the app is now dismissed by one `icon-button.close` at the top right of its title row: `DialogShell`'s `closeLabel` became required, and the glyph moved into a shared `DialogCloseButton` / `DialogTitleWithClose` that the eleven non-shell dialogs render too, so the 44px geometry, the `Tooltip` and the focus ring travel with it rather than being copied fifteen times. Nine form footers lost `Abbrechen` and `common.cancel` was deleted from both dictionaries. The two destructive confirmations keep both buttons and the safe one now names what it preserves — "Reise behalten" / "Eintrag behalten" — at unchanged visual weight. Four read-only map popups gained their first visible dismissal. `useDiscardGuard` + `DiscardChangesDialog` carry EXPERIENCE.md's dirty-form question from the activity dialog to nine more, with 6.24's inline copy folded into the shared one and its title/keep/discard keys promoted to `common.discard.*`. New keys: `trips.delete.keep`, `trips.bucketList.deleteKeep`, `trips.import.done`, four `common.discard.*`. Deleted: `common.cancel`, `trips.plan.discardTitle`, `trips.plan.discardConfirm`, `trips.plan.discardKeep`.
- 2026-08-04 — **Browser pass caught a defect no unit test could have.** An untouched "Neue Reise" dialog asked "Änderungen verwerfen?" on its own `✕`: `heroImage` is a registered file input whose empty `FileList` never deep-compares equal to the `undefined` in `defaultValues`, so react-hook-form's `isDirty` latched `true` on the first render with `dirtyFields` empty. Both `heroImage` forms were affected. Fixed by reading `dirtyFields` plus an explicit selected-file flag; jsdom does not reproduce the defect, so the new tests pin the file-chosen direction instead. Re-verified live over three open/close cycles.
- 2026-08-04 — Two lint regressions the pass surfaced were fixed rather than left: the travel-segment dialog's open snapshot became a `useMemo` (a ref read during render is `react-hooks/refs` and a stale-baseline hazard), and `TripEditDialog`'s flag reset moved from the open effect to a render-phase reset (`react-hooks/set-state-in-effect`, and it also cleared one render late). Lint back to its 85-problem / 2-pre-existing-error baseline.
- 2026-08-04 — Two exemptions written down rather than inferred, per DESIGN.md's "every dialog has exactly one": the dirty-form discard confirmation gets no `✕` (it is raised *by* one, so a second would loop) — contradicting 6.24's reading of AC3 — and `TripShareDialog` keeps its footer `Schließen` (DW-157). `TripImportDialog`'s post-import footer became "Fertig" because `common.close` beside the new `✕` gave one dialog two identically named controls.
- 2026-08-04 — `mockups/forms-authoring.html` brought into line: two footers lost their cancel, both heads gained the `✕`, a `.dialog-close` rule and an `icon-button.close` specimen were added, and the `btn-secondary` specimen was relabelled "Reise behalten". Two gaps recorded in the file: no destructive confirmation is mocked at all, and Screen G still says "Speichern" against 6.24's "OK".
- 2026-08-04 — Tests 1181 → **1213** across 111 files, all green; `test/dialogCloseAffordance.test.tsx` is new (28 cases). Lint at its 85/2 baseline, `tsc --noEmit` with 0 `src/` errors. Deferred work: **DW-156** (the 4px head-padding difference between shell and non-shell dialogs), **DW-157** (`TripShareDialog`'s footer close), **DW-158** (the travel-segment buttons are named "Reise hinzufügen" / "Reise bearbeiten", colliding with the trip-level actions).
- 2026-08-04 — **Code review (`bmad-code-review`, three parallel layers).** 34 raw findings → 24 after dedup: 4 decisions (resolved by Tommy), 16 patches (all applied), 4 deferrals (DW-159 … DW-162), 3 dismissed, 1 withdrawn on verification. The `✕` rollout, the `common.cancel` retirement and both "keep" confirmations were confirmed correct; the review's weight fell on AC7's discard guard, where three findings all said the same thing in different places — **"discard" was not discarding**. The day-image dialog kept the note it was told to throw away, and both its save paths post `dayNoteDraft`, so a later photo-only save would have written a discarded note to the server. The move picker kept the target day the user had just abandoned, pre-selected with the confirm button live. The accommodation dialog read raw `isDirty` under two on-open `setValue(..., { shouldDirty: true })` effects, so a stay whose stored payment disagrees with its cost interrogated a user who had touched nothing — the same defect class as the `heroImage` `FileList` one, surviving because every fixture used the one shape (`payments` absent) where `buildDefaultPayments` makes the two sides equal by construction. All three are fixed and all three are pinned by a test that was **verified to fail without its fix**.
- 2026-08-04 — Also from the review: `useDiscardGuard` gained a `busy` parameter, because "Änderungen verwerfen" was a silent no-op whenever the underlying closer early-returned on an in-flight write — the question vanished, the dialog stayed, and the user's explicit answer did nothing. `TripShareDialog` gained the guard outright (Tommy's call): AC7 says *every* form dialog, and its invite address, role and temporary password were being thrown away without a word — it had escaped the nine only because that list was derived from the `common.cancel` readers, which it never was. `TripImportDialog` stopped asking about a file the server had **rejected**, which is not a change anyone made. The story's own record was corrected where it overstated: the four map-popup glyphs were claimed as unit-covered and were not (now asserted in the two map suites), the "both directions on all nine" coverage claim was four of nine (bucket-list and import added), a `closeLabel={undefined}` case could not catch what its docstring claimed, the noun-match assertion checked one language per pair by array index (now both, by shared word), and "ten dialogs" in six docblocks is eleven.
- 2026-08-04 — One finding **withdrawn rather than patched**: the failed-hero-upload path reports the create form clean, which is correct — the trip is already saved, so a discard question would name an outcome that is not on offer. Recorded in the findings so it is not re-raised. Two exemptions ratified and moved out of the story into the components that hold them (`TripImportDialog`'s post-import "Fertig", `DiscardChangesDialog`'s absent `✕` — which now explicitly supersedes 6.24's reading of AC3). Deferred, all pre-existing: **DW-159** (Escape and the backdrop are not blocked during an in-flight write on the eleven raw `<Dialog>` sites, while the `✕` is), **DW-160** (those eleven set no `aria-labelledby`, so a screen reader announces an unnamed dialog — `DialogTitleWithClose` is now the one seam where that could be fixed once), **DW-161** (the travel-segment open snapshot is derived from live props rather than captured at open), **DW-162** (no destructive confirmation is drawn in the binding footer mockup).
- 2026-08-04 — After the review: tests **1213 → 1220** across 111 files, all green. Lint back at its 85-problem / 2-pre-existing-error baseline. `tsc --noEmit`: 0 `src/` errors, and the `test/` count went **144 → 143** — the one type error this story had introduced (`dialogCloseAffordance.test.tsx`'s `FullscreenPhoto` fixture, which rendered a viewer with `imageUrl === undefined` and still passed) is gone.
