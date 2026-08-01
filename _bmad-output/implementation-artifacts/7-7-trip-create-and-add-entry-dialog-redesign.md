---
baseline_commit: b18997c2fb293ac1f6fc2adbc4b862620d455eb8
baseline_note: >-
  `b18997c` is `main` at story-creation time, but Stories 7.5 (review) and 7.6 (ready-for-dev)
  land before this one. Measure the real baseline yourself at start (`npm test`, `npx tsc
  --noEmit -p .`, `npx eslint src test`) — do not copy 7.5's numbers.
---

# Story 7.7: Trip-Create and Add-Entry Dialog Redesign

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner,
I want the "Reise erstellen" and "Eintrag hinzufügen" dialogs to match the approved design system,
So that creating trips and adding accommodations/day-plan items feels consistent with the rest of the redesigned app.

**FRs covered:** FR4, FR12, FR17 in `epics.md`'s FR scheme (`epics.md:22,30,35` — "create a trip with name and date range", "add an accommodation entry for a specific day", "create a day plan for each day"). No FR text changes; this is a re-skin of shipped capability.

## Acceptance Criteria

**AC1** (epic, verbatim)
**Given** `mockups/forms-authoring.html` (Screens F, G) and `EXPERIENCE.md`'s corresponding component patterns
**When** the trip-create dialog and the add-accommodation/add-day-item dialog are rebuilt
**Then** each uses the shared form-primitive tokens, and the add-entry dialog's photo upload area follows the same square/sharp-cornered photo-strip pattern used elsewhere

**AC2** (epic, verbatim)
**Given** the existing create-trip and add-entry functionality
**When** these dialogs are redesigned
**Then** all of it continues to work unchanged — this story is visual only

**AC3** (derived — Screen G draws one dialog where the product has two)
**Given** Screen G mocks a single "Eintrag hinzufügen" modal with an Unterkunft/Aktivität type toggle, while the product ships two separate dialogs reached from two different affordances (`TripAccommodationDialog`, mounted twice with `stayType="current"|"previous"`, and `TripDayPlanDialog`)
**When** the add-entry surfaces are rebuilt
**Then** both dialogs remain separate components with their existing triggers and payloads, each adopting Screen G's chrome and form primitives
**And** no type-tab control is introduced on either — merging them is a functional restructure that AC2 forbids

**AC4** (derived — Screen F draws three fields where the form has six)
**Given** Screen F shows only Reisename + Zeitraum, while `TripCreateForm` also carries start-location lookup, destination lookup (Story 3.3 / FR27) and hero-image upload (Story 2.11)
**When** the create dialog is rebuilt
**Then** every existing field is still present and functional, restyled into the Screen F field treatment
**And** no field is removed, reordered out of its current group, or moved behind a disclosure — Screen F's minimality is a mockup shortcut against a smaller form, not a decision to drop capability

**AC5** (derived — AC1's photo-strip clause has no matching implementation)
**Given** the image-gallery blocks in the accommodation and day-plan dialogs, which today render a bare `type="file"` `TextField`, a separate "Upload" button, and a vertical list of 42px rounded thumbnails each paired with a red 36px-wide delete button
**When** they are rebuilt
**Then** each renders the Screen G photo pattern: a dashed `photo-upload-zone`, then a left-aligned horizontal strip of uniform **56×56px, sharp-cornered (`borderRadius: 0`), `object-fit: cover; object-position: center`** thumbnails
**And** each thumbnail's remove affordance sits in a ≥44×44px hit area with an accessible name that names the image ("Remove image 2 of 3"), not three buttons all named "Remove"
**And** each thumbnail carries an indexed alt string per `DESIGN.md.Photo Alt-Text` ("meaning-bearing" class), not the single shared `trips.gallery.thumbnailAlt` value

**AC6** (derived — the restyle moves every field from a floating MUI label to an above-field caps label)
**Given** `test/tripAccommodationDialog.test.tsx`, `test/tripDayPlanDialog.test.tsx` and `test/tripCreateForm.test.tsx` resolve 20+ controls through `getByLabelText` / `getByRole("textbox", { name })`
**When** labels move above their inputs
**Then** every pinned accessible name is byte-identical afterwards — the label is associated by `htmlFor`/`id`, uppercase is applied by CSS `textTransform` only (never by uppercasing the i18n value), and no "optional" marker, helper text, or icon is placed inside the `<label>` element

**AC7** (derived — assigned here by the 7.3 code review)
**Given** the day-details dialog (`trips.dayImage.*`, inline in `TripDayView.tsx:2499-2559`), which `deferred-work.md:59` records as "Story 7.7's surface"
**When** it is restyled with the same chrome and photo pattern
**Then** it renders a preview `<img>` of the current day image with a real alt string, closing the recorded gap where a non-sighted owner could not confirm an upload succeeded

**AC8** (derived — the mockups define no destructive variant and the palette defines no `error`)
**Given** "Remove stay", the plan-item "Delete", the gallery remove buttons and the day-image "Remove" all use MUI `color="error"`, resolving to `#d32f2f`
**When** these dialogs are rebuilt
**Then** no `color="error"` remains on any button in the four dialogs — destructive actions use the secondary/text button variant, exactly as Story 7.8's AC states for "Reise löschen"
**And** no new colour is introduced: `theme.ts` defines no `error` palette entry and `DESIGN.md` defines no destructive treatment

### Scope note — read before Task 1

**AC2's "visual only" clause is superseded exactly twice: by AC7 (the missing day-image preview) and AC5's accessible-name change on the gallery remove buttons. Nowhere else.** This follows the precedent 7.8 set against 7.2 and 7.5 set against its own AC3.

Three things in the mockups are **not buildable as drawn** and are adapted rather than implemented. Each is repeated at its task:

1. **Screen G's type toggle (AC3).** `TripDayView.tsx:2404-2453` mounts `TripAccommodationDialog` twice (current night, previous night) and `TripDayPlanDialog` once, with three distinct open paths (`setPlanDialogMode("add"|"edit")`, bucket-list prefill at `:582`, timeline edit at `:783`). The two entities have separate routes, separate Zod schemas, separate repositories and non-overlapping fields (status/check-in/check-out vs. rich text/from-to/ordering). A merge is a product change. **Build two dialogs; build no tabs.**
2. **Screen F's three fields (AC4).** Keep all six. See AC4.
3. **`.field-label`'s `.opt` badge.** The mockup puts "optional" inside the label element. Every optional field here already says so in its existing helper line (`trips.plan.costHelper` "Optional amount…", `trips.stay.linkHelper` "Optional booking link", …). Rendering the badge inside the `<label>` would change the accessible name from `Link` to `Link optional` and break `test/tripDayPlanDialog.test.tsx:322,437`. **Skip the badge; keep the helper line.**

## Tasks / Subtasks

- [ ] **Task 1 — Shared form primitives, declared once (AC1, AC5, AC6)**
  - [ ] **First, check what Story 7.6 landed.** `ls travelplan/src/components/features/auth/`. 7.6's Task 2/3 create `AuthScreenShell.tsx`, `AuthField.tsx` (caps label + input + error hint) and an inline `AuthNotice` (warn/success banner using `tokens.warnBg`/`accentSoft`, **not** MUI `Alert`).
  - [ ] **If `AuthField.tsx` exists:** `git mv` it to `travelplan/src/components/forms/FormField.tsx`, rename the export to `FormField`, and update the five `(auth)` page imports. Extract `AuthNotice` from `AuthScreenShell.tsx` into `travelplan/src/components/forms/FormNotice.tsx` and have the shell import it. Keep both prop contracts byte-identical — this is a move, not a redesign. `architecture.md:401-402` puts UI primitives under `components/ui/*` and form components under `components/forms/*`; this story is the second consumer, which is the trigger for the move.
  - [ ] **If it does not exist** (7.6 slipped): create `components/forms/FormField.tsx` and `components/forms/FormNotice.tsx` fresh to 7.6's specified contract, and record in the Completion Notes that 7.6 must import from here rather than re-create them.
  - [ ] `FormField` contract: `{ id: string; label: string; error?: string; ...TextFieldProps }`. Renders `<Typography component="label" htmlFor={id} variant="labelCaps" sx={{ fontSize: 11, letterSpacing: "0.06em", color: tokens.inkSoft, display: "block", mb: "7px" }}>{label}</Typography>` then `<TextField id={id} fullWidth error={Boolean(error)} />`. Mockup `.field-label`: `forms-authoring.html:218-228`.
  - [ ] **`textTransform: "uppercase"` comes from the `labelCaps` variant (CSS).** Never uppercase the i18n string. `getByLabelText("Title")` matches on `textContent`, which CSS does not touch; uppercasing the value breaks all 20+ pinned queries at once.
  - [ ] Error hint via `helperText`: `WarningTriangleIcon` (12px, `aria-hidden`) from `TripIcons.tsx:37` + message, 11px/700/`palette.warning.main`, `display: flex`, `gap: 5px`. Override MUI's red with `sx={{ "& .MuiFormHelperText-root.Mui-error": { color: "warning.main" } }}`. Mockup `.field-hint.error`: `forms-authoring.html:287-289`.
  - [ ] **Add no sizing here.** 44px height, `tokens.cardAlt` fill, `borderStrong` border, accent focus ring and the `errorBorder`/`warnBg` error swap all already come from `theme.ts:279-310`'s `MuiOutlinedInput` override. Verify computed boxes in the browser check (Task 9) rather than restating them.
  - [ ] New `travelplan/src/components/ui/DialogShell.tsx`, `"use client"` — the head/body/footer chrome, so four dialogs do not each re-derive it. Props: `{ open; onClose; title; subtitle?; width: number; children; footer: ReactNode; disableBackdropClose?: boolean }`.
    - `<Dialog fullWidth maxWidth={false} slotProps={{ paper: { sx: { width: "100%", maxWidth: width, border: \`1px solid ${tokens.borderStrong}\` } } }} aria-labelledby={titleId}>`. The explicit border is required: `theme.ts:245-251`'s `MuiPaper` override stamps `1px solid rgba(17,18,20,0.08)` on every `Paper`, and the mockup's `.dialog` is `1px solid #D9D0BE` (`forms-authoring.html:186-192`). `slotProps.paper`, **not** `PaperProps` — MUI 7 deprecates the latter (7.5's deviation #2).
    - Head: `<DialogTitle sx={{ p: "20px 24px 16px", borderBottom: \`1px solid ${tokens.border}\` }}>` containing a title `Box` at 17px/900/`-0.2px`/`tokens.ink` carrying `id={titleId}`, and an optional sub-line `Box` at 12.5px/600/`tokens.inkSoft`, `mt: "4px"`.
    - **The sub-line must not be part of the dialog's accessible name.** Give the title `Box` its own `useId` and pass it as `aria-labelledby` on `Dialog`; give `DialogTitle` a separate id so MUI's context does not reassign it. This is 7.5's defect #1, already paid for once.
    - Body: `<DialogContent sx={{ p: "22px 24px", ".MuiDialogTitle-root + &": { pt: "22px" } }}>`. The sibling selector is mandatory — MUI ships `.MuiDialogTitle-root + .MuiDialogContent-root { padding-top: 0 }` at a specificity the `p` shorthand cannot beat, and **jsdom will not catch it** (7.5's defect #2). Mockup `.dialog-body` is `22px 24px` (`:199`).
    - Footer: `<DialogActions sx={{ p: "16px 24px", borderTop: \`1px solid ${tokens.border}\`, backgroundColor: tokens.cardAlt, gap: "10px" }}>`. `justifyContent` is left to the caller — three of the four dialogs put a destructive action at the far left (`justifyContent: "space-between"`), which is their current, preserved layout.
  - [ ] New `travelplan/src/components/forms/PhotoUploadField.tsx`, `"use client"` — Screen G's photo block, used by three dialogs (AC5, AC7).
    - Dropzone (`.photo-upload-zone`, `forms-authoring.html:346-354`): `1.5px dashed ${tokens.borderStrong}`, `borderRadius: 8`, `backgroundColor: tokens.cardAlt`, `padding: 20px`, `display: flex`, `alignItems: center`, `gap: 14px`. Leading 44×44 `borderRadius: 8` tile at `tokens.accentSoft` with a 20px upload glyph in `palette.primary.main`; then a 12.5px/700/`tokens.ink` line over an 11px/600/`tokens.inkMuted` line.
    - Add the upload glyph to `TripIcons.tsx` as `UploadIcon` (mockup path at `forms-authoring.html:731`), following the existing `IconProps` shape at `TripIcons.tsx:1-13`. Do not inline a one-off SVG in a dialog — `deferred-work.md:24` records that exact mistake from 7.2.
    - The zone wraps a visually-hidden `<input type="file">` so the whole zone is the click target and the input keeps its own accessible name. **Drag-and-drop is optional**; if you do not implement `onDrop`, use copy that does not promise it. Do not ship a zone that says "drag files here" and ignores a drop.
    - Preview strip (`.photo-strip-preview` / `.photo-thumb`, `:369-395`): `display: flex`, `gap: 8px`, `flexWrap: "wrap"`, `mt: "14px"`; each thumb `flex: "0 0 56px"`, `56×56`, `objectFit: "cover"`, `objectPosition: "center"`, `borderRadius: 0`, `border: "1px solid rgba(0,0,0,0.06)"`. **Never `flex: 1`** — `EXPERIENCE.md:67`.
    - Remove affordance: the mockup's 18px `remove-x` is below the touch floor. Render it as a `Button`/`IconButton` whose hit area is ≥44×44 (an absolutely-positioned 44px transparent target over the thumb's top-right, with the 18px dark disc drawn inside, is the cleanest reading of `DESIGN.md:266`). Accessible name interpolates the index (AC5).
    - `alt` per image: `formatMessage(t("trips.gallery.imageAlt"), { index, total })` (Task 8 adds the key).
    - Reuse `MiniImageStrip`'s already-shipped values rather than re-deriving them — `TripDayPlanItemContent.tsx:168-190` is the 7.3 implementation of the same 56px sharp strip, including the "fixed basis, never flex: 1" comment. **Do not import `MiniImageStrip` itself**: it caps at 3 images with a "+N" overflow and has a keyboard-access defect deferred at `deferred-work.md:57`; an editing surface must show and address every image.
  - [ ] Nothing in this task touches `TripShareDialog.tsx`. It carries its own inlined copy of this chrome and is in `review`; converting it to `DialogShell` is a follow-up sweep, recorded in Completion Notes, not this story's diff.

- [ ] **Task 2 — Trip-create dialog, Screen F (AC1, AC2, AC4, AC6)**
  - [ ] `TripCreateDialog.tsx` (97 lines): replace `Dialog`/`DialogTitle`/`DialogContent`/`DialogActions` with `DialogShell`, `width={460}` (`.dialog.w-460`, `forms-authoring.html:194`). Title `t("trips.create.title")`, subtitle `t("trips.create.helper")` — the helper currently sits as a `body2` at the top of the body (`:73-75`); it moves into the head sub-line and is **not** rendered twice.
  - [ ] Footer: secondary "Abbrechen" (`common.cancel`, `variant="outlined"`) then primary "Reise erstellen" (`trips.create.submit`, `variant="contained"`), right-aligned, in that order (`forms-authoring.html:649-652`). Keep the `form={formId}` + `type="submit"` wiring and the `<CircularProgress size={22} />` swap — `EXPERIENCE.md:85` explicitly permits an inline spinner on a dialog's submit.
  - [ ] Keep `handleClose`'s submit guard, the 800ms `closeTimerRef` success delay, and the `formKey` remount. They are the component's whole behaviour and none of it is visual.
  - [ ] `TripCreateForm.tsx` (537 lines): **every line above the `return` is untouched.** `useForm`, the CSRF effect, `onSubmit`, the hero-image upload, `normalizeDateInput`/`isValidDateInput`, `handleLookupLocation`, `nameRules`/`dateRules` — diff the top 396 lines to zero.
  - [ ] Render changes only: each `TextField` becomes a `FormField` with an explicit `id`. Label strings stay exactly `trips.form.name` / `trips.form.startDate` / `trips.form.endDate` / `trips.form.startLocation` / `trips.form.destinationLocation` / `trips.form.heroImage` — `test/tripCreateForm.test.tsx:79-84,153-158` matches them case-insensitively via regex, and `startLocation`'s value is literally "Start location (optional)".
  - [ ] Start/end dates go into one `.field-row` (`display: flex`, `gap: 12px`, each child `flex: 1`) under a single "Zeitraum"-style grouping, stacking to a column at `xs`. **Keep `type="date"`** — the tests type `"2026-02-10"` and `handleDateBlur` normalizes `DD.MM.YYYY`. The native control draws its own calendar affordance; do **not** add the mockup's `.icon-suffix` calendar on top of it.
  - [ ] Location rows: the Find/Clear buttons become `variant="outlined"` / `variant="text"`, aligned to the field, both already ≥44px from `theme.ts:253-260`. Keep the coordinate read-out `Typography` and its exact strings — `test/tripCreateForm.test.tsx` and the accommodation/plan tests all pin "No coordinates selected" and the `Latitude: … · Longitude: …` format.
  - [ ] Hero image: the `type="file"` `TextField` becomes a `PhotoUploadField` in single-file mode, or keeps a `FormField` wrapper if single-file preview is not worth the branch — **your call, but `getByLabelText(/hero image/i)` must still resolve to the file input** (`:84`).
  - [ ] `Alert severity="error"` / `severity="success"` (`:399-400`) → `FormNotice` tone `warn` / `success`. `theme.ts:151-157` defines no `error` palette entry, so MUI's `Alert` falls back to `#d32f2f`, a colour absent from `DESIGN.md`. Keep `role="alert"`; the success text (`trips.create.success` with its `{count}`) is unchanged.

- [ ] **Task 3 — Accommodation dialog, Screen G (AC1, AC2, AC3, AC5, AC6, AC8)**
  - [ ] `TripAccommodationDialog.tsx` (1053 lines): `DialogShell`, `width={520}` (`.dialog.w-520`, `:195`). Title stays `trips.stay.addTitle` / `trips.stay.editTitle`. Add a sub-line naming the day (`Tag N · date`) in the Screen G idiom — the `day` prop already carries `dayIndex` and `date`; format with the same helper the day view uses.
  - [ ] **No type tabs (AC3).** This dialog is reached from a stay slot that already knows it is a stay.
  - [ ] Field mapping, in the mockup's order where the data allows: Stay name (`trips.stay.nameLabel`) → Status select → Check-in/Check-out as one `.field-row` "Zeitraum" pair → Cost + Link as one `.field-row` → Payment schedule → Place lookup → Notes → photos.
  - [ ] **Preserve, do not simplify:** the Status select (`trips.stay.statusLabel`, FR13), the payment-schedule radio group and its `useFieldArray` rows (Story 4.5), the notes `multiline`, the place lookup. Screen G shows none of them; that is the mockup drawing a smaller form, not a scope decision. `getByLabelText("Split into multiple payments")` (`test/tripAccommodationDialog.test.tsx:255,312`) and `getByLabelText("Check-in time")` / `"Check-out time"` (`:170,211`) are pinned.
  - [ ] Payment rows keep `flexWrap` and their `minWidth` floors. If 520px makes them wrap badly in the browser check, widen this dialog to 560 and say so in the Completion Notes — do not compress the rows below the 44px floor to make 520 fit.
  - [ ] Gallery block (`:923-990`) → `PhotoUploadField`. This is the AC5 rebuild: dropzone + 56px sharp strip, no separate "Upload" `Button` row if the zone submits on selection — but **keep the explicit Upload action if you keep the two-step select-then-upload flow**, because `uploadGalleryImages` is a real network step with its own error path and busy state.
  - [ ] **Fix the hardcoded English at `:951`** — `{galleryFiles.length} file(s) selected` bypasses i18n while the day-plan dialog uses `formatMessage(t("trips.gallery.selectedFiles"), { count })` for the same string. Use the key. (`test/tripDayPlanDialog.test.tsx:1164` proves the German path works there; nothing pins the accommodation copy.)
  - [ ] Footer: "Remove stay" (`trips.stay.delete`) far left, then Abbrechen + "Save stay" (`trips.stay.save`) right. **Drop `color="error"` from the delete button** (AC8) — `variant="text"` with `tokens.ink`. `getByRole("button", { name: "Save stay" })` is pinned at `:127,264`.
  - [ ] The nested fullscreen-image `Dialog` at `:1011-1050` is left as-is. `epics.md:1772` (Story 7.9's AC) states the fullscreen photo viewer inherits 7.1's theme-level `MuiDialog` overrides and is not restyled; the `MiniImageStrip` keyboard defect stays deferred.

- [ ] **Task 4 — Day-plan dialog, Screen G (AC1, AC2, AC3, AC5, AC6, AC8)**
  - [ ] `TripDayPlanDialog.tsx` (1255 lines; the render tree starts at `:866`): `DialogShell`, `width={520}` (same 560 escape hatch as Task 3 — this dialog carries the TipTap toolbar and is the likelier of the two to need it). Currently `maxWidth="md"` (900px) at `:866`; the title/sub-line pair already exists at `:867-876` and moves into the shell's `title`/`subtitle`.
  - [ ] `getByText("Add plan item")` / `getByText("Edit plan item")` (`:309,432`) resolve on text, not on a dialog name — but keep the title in the head regardless.
  - [ ] **Preserve the TipTap editor whole.** The toolbar buttons' `aria-label`s (`Bold`, `Italic`, `Image`, and the bullet-list/link pair) are pinned at `:310-312,328`. Restyle the toolbar container and buttons to the token idiom; do not swap the editor, its extensions, or the button roles. Screen G has no rich-text field — that is the mockup, not a decision to drop FR18.
  - [ ] Field mapping: Title → rich text → From/To as one `.field-row` → Cost → payment schedule → Link → place lookup → photos. Labels stay exactly `Title`, `From`, `To`, `Cost`, `Link` (`trips.plan.*`). `getByRole("textbox", { name: "Link" })` (`:322,437,444`) means the Link field's accessible name is exactly `Link` — no `.opt` badge, no icon text, nothing else inside the `<label>`.
  - [ ] Gallery block → `PhotoUploadField`, same as Task 3. `getByRole("button", { name: "Upload" })` (`:897,992,1096`) and `getByRole("button", { name: "Remove" })` (`:1245,1252`) are pinned — **the Remove name changes under AC5** to an indexed string; update those two assertions in Task 8 and say so, rather than keeping three identically-named buttons.
  - [ ] Footer (`:1196-1214`): Cancel + "Delete" left, "Save item" / "Update item" right. Keep `handleDeleteClick`'s two-tap `onTouchEnd` confirm behaviour verbatim — it is the only delete confirmation this dialog has. Drop `color="error"` from `:1201` (AC8). Names pinned at `tripDayPlanDialog.test.tsx:332,445,518,623`.
  - [ ] Do not touch `TripDayView.tsx`'s call sites (`:2446-2455`) — props are unchanged.

- [ ] **Task 5 — Day-details dialog (AC1, AC2, AC5, AC7, AC8)**
  - [ ] `TripDayView.tsx:2499-2559` only. This is the single block of that 2600-line file this story is allowed to edit; 7.3 owns the rest and is `done`.
  - [ ] `DialogShell`, `width={460}`. Title `trips.dayImage.dialogTitle`.
  - [ ] Replace the `type="file"` `TextField` + `dayImageFile.name` line with `PhotoUploadField` in single-file mode. Keep the `event.target` (not `currentTarget`) file read and its comment at `:2506-2513` — it documents a real MUI wrapper bug.
  - [ ] **AC7:** when `hasDayImage`, render a 56px preview `<img>` of the current image with a real alt (`trips.dayImage.previewAlt` — Task 8 re-adds this key; 7.3 deleted it when the *hero* became decorative, which does not apply to an editing surface). When absent, keep the existing `trips.dayImage.empty` line.
  - [ ] Note `Typography` → `FormField` with `multiline`, keeping `maxLength: 280` and the helper.
  - [ ] Footer: "Remove" (`trips.dayImage.removeAction`) left, Cancel + "Save" right, no `color="error"` (AC8). Keep the `disabled={dayImageSaving || !hasDayImage}` guard.
  - [ ] Do **not** touch the transfer dialog directly above it (`:2454-2498`) or the fullscreen viewer below it. Neither is a create/add-entry surface.

- [ ] **Task 6 — Responsive behaviour (AC1)**
  - [ ] `EXPERIENCE.md:19`: this pass mocked desktop only. Follow the established resolution — pure-CSS MUI breakpoint objects in `sx` (`{ xs: …, sm: … }`), **never `useMediaQuery`** (deferred finding from 7.2, `deferred-work.md:25`).
  - [ ] Every `.field-row` pair (start/end date, check-in/check-out, from/to, cost/link) stacks to a column at `xs`.
  - [ ] Footers stack to full-width buttons at `xs` with the primary on top; a 520px dialog on a 390px viewport is already handled by MUI's `Dialog` margins. Verify `scrollWidth === clientWidth` at 390px rather than adding a `fullScreen` breakpoint.

- [ ] **Task 7 — i18n (AC1, AC5, AC7)**
  - [ ] Add to **both** `src/i18n/en.ts` and `src/i18n/de.ts`, in the same change (the convention every Epic 7 commit follows):
    - `trips.gallery.imageAlt` — "Image {index} of {total}" / "Bild {index} von {total}"
    - `trips.gallery.removeImage` — "Remove image {index} of {total}" / "Bild {index} von {total} entfernen"
    - `trips.gallery.uploadZoneTitle` — "Choose photos" / "Fotos auswählen" (drop "drag here" unless you implement `onDrop` — see Task 1)
    - **No shared size-limit key.** The three surfaces state three different limits today — `trips.form.heroImageHelper` "up to 5MB", `trips.dayImage.fileHelper` "up to 15MB", and the galleries state none. `PhotoUploadField` takes the hint line as a **prop**, each call site passes its existing key, and the mockup's invented "bis zu 10 MB pro Foto" is not adopted anywhere. Reconciling the three limits is a data/validation question, not a visual one — leave it, and note it for the backlog.
    - `trips.dayImage.previewAlt` — re-added (AC7)
  - [ ] Interpolate with `formatMessage` (`src/i18n/index.ts:23`), never template-literal concatenation.
  - [ ] `test/i18nDictionaries.test.ts` asserts key parity across both dictionaries — it will fail loudly if you add to one only.
  - [ ] Grep for orphaned keys afterwards and remove any this story strands (7.5 found three).

- [ ] **Task 8 — Tests (AC2, AC5, AC6)**
  - [ ] **`test/tripAccommodationDialog.test.tsx` (6 sites), `test/tripDayPlanDialog.test.tsx` (13 sites) and `test/tripCreateForm.test.tsx` (2 sites) all render with a bare `<I18nProvider>` and no `ThemeProvider`.** Every one of the 21 must become `renderWithProviders` (`test/helpers/renderWithProviders.tsx`) **before** you touch a component — a component reading `theme.palette.tokens.*` throws under MUI's bare default theme. 7.3, 7.4 and 7.5 each lost time to this; it is the single most likely way this story stalls.
  - [ ] `test/tripDayPlanDialog.test.tsx` imports the component dynamically (`await import(...)`) inside each case. Keep that pattern; only the render wrapper changes.
  - [ ] Update the assertions this story deliberately changes, and only these:
    - `getByRole("button", { name: "Remove" })` at `tripDayPlanDialog.test.tsx:1245,1252` → the new indexed name (AC5).
    - Any assertion that depended on the create dialog rendering `trips.create.helper` inside the body rather than the head.
  - [ ] Add coverage that is currently absent:
    - The 56px preview strip renders one thumbnail per gallery image with an indexed `alt` (AC5).
    - Each remove button's accessible name is unique within the dialog (AC5).
    - The day-details dialog renders a preview `<img>` when the day has an image and the empty line when it does not (AC7).
    - No button in the four dialogs carries `color="error"` (AC8) — assert on the rendered class or on the computed colour, whichever is stable in jsdom; if neither is, verify it in Task 9 and say so.
  - [ ] Do **not** weaken an existing assertion to make a restyle pass. If a pinned name has to change, change it deliberately and list it in the Completion Notes.
  - [ ] `test/tripDayViewLayout.test.tsx:30-37` and `test/tripTimelineRoles.test.tsx:8` mock both dialogs away — they need no change, and that is the signal your prop contracts stayed intact.

- [ ] **Task 9 — Browser verification (AC1, AC5, AC6, AC8)**
  - [ ] Follow 7.5's procedure exactly (`7-5-share-dialog-redesign.md:335-347`): a **throwaway** database (`prisma migrate deploy` + raw-SQL seed into `prisma/manual-check-7-7.db`), never `prisma/dev.db`; delete it afterwards. `test/uploadPaths.test.ts` exists because a suite once deleted the developer's real uploads (`deferred-work.md:41`) — treat the same care as mandatory here, since this story is the one that touches every upload surface.
  - [ ] Tommy's `next dev` holds a single-instance lock on this directory. Use `next build` + `next start -p <free port>`, verify his server still returns 200 afterwards, and note that the build rewrote the gitignored `.next/`.
  - [ ] Measure, do not infer: dialog paper widths (460/520); head `20px 24px 16px` + 1px `tokens.border`; body `22px 24px` with a **non-zero** top padding; footer `16px 24px` on `tokens.cardAlt`; every thumbnail exactly 56×56 with `border-radius: 0px`; every interactive element's computed box ≥44×44 including each remove affordance; no horizontal overflow at 390px.
  - [ ] Functional pass on the real flows: create a trip with a hero image and both locations; add and edit a stay with a split payment schedule and two photos; add and edit a plan item with rich text, a link and two photos; remove one photo from each; edit the day details and confirm the preview renders.

- [ ] **Task 10 — Status and record**
  - [ ] Fill the Dev Agent Record: baseline table (`npm test`, `npx tsc --noEmit -p .`, `npx eslint src test` — before and after), defects found, deviations with reasons, AC-by-AC coverage, File List.
  - [ ] Update `sprint-status.yaml`: `7-7-trip-create-and-add-entry-dialog-redesign: review`, and `last_updated`.

## Dev Notes

### Scope boundary

This story owns **four dialog surfaces and three new shared components**:

| In scope | Why |
|---|---|
| `TripCreateDialog.tsx` + `TripCreateForm.tsx` | Screen F |
| `TripAccommodationDialog.tsx` | Screen G, accommodation half |
| `TripDayPlanDialog.tsx` | Screen G, activity half |
| `TripDayView.tsx:2499-2559` **only** | Day-details dialog, assigned here by `deferred-work.md:59` |
| `components/forms/FormField.tsx`, `FormNotice.tsx`, `PhotoUploadField.tsx`, `components/ui/DialogShell.tsx` | The primitives, declared once |
| `TripIcons.tsx` | One new `UploadIcon` |

Do **not** touch:

- **`TripShareDialog.tsx`** — `review`, and it carries its own inlined copy of this chrome. Converting it to `DialogShell` is a follow-up.
- **`TripEditDialog.tsx`, `TripImportDialog.tsx`, `TripDeleteDialog.tsx`, `TripDayTravelSegmentDialog.tsx`** — none is a create/add-entry surface, none has a mockup, and none has a redesign story. They already inherit 7.1's theme-level primitives and do not look broken. `TripImportDialog`'s entry point is being removed by 7.8 anyway.
- **Anything else in `TripDayView.tsx`** — 7.3 owns that page and is `done`. One dialog block, nothing else.
- **`TripTimeline.tsx`** — 7.8 is `ready-for-dev` against it right now.
- **`theme.ts`** — every token this story needs exists. Adding one is a signal the value belongs in a component.
- **Any API route, repository, Zod schema, or Prisma model.** This story writes no server code. If you find yourself opening `src/app/api/`, stop and re-read AC2.

### What this story is really about

7.2 and 7.3 were pure re-skins because their payloads already carried what the mockups showed. This one is a re-skin too, but the risk is different: **it moves 20+ form controls from MUI's floating-label pattern to an above-field caps label, and 21 test render sites are one `ThemeProvider` away from throwing.** Nothing here is hard; everything here is easy to get subtly wrong in a way that shows up as 40 red tests rather than as a visual defect.

The three failure modes, in order of likelihood:

1. **Renders without the theme provider** → `Cannot read properties of undefined (reading 'ink')`. Fix all 21 sites in Task 8 first, before any component edit.
2. **Accessible name drift** → uppercasing the i18n value, putting the `.opt` badge or the helper icon inside the `<label>`, or losing the `htmlFor`/`id` pair. Any of the three breaks a block of `getByLabelText` queries at once.
3. **Deleting a field that Screen F/G does not draw.** The mockups draw a smaller product than the one that shipped. Every field currently on screen stays on screen.

### What must not be built

Every item below has been considered and ruled out. Building any of them is scope creep:

- **A merged "Eintrag hinzufügen" dialog with Unterkunft/Aktivität tabs.** AC3. Two entities, two routes, three open paths, non-overlapping fields.
- **An activity-type field, category, or icon picker.** `EXPERIENCE.md:66` is explicit and repeats it twice: the data model has no activity-type field and the product owner does not want one added to support iconography. A "type" select in the add-entry dialog is exactly the thing that rule forbids.
- **A custom date or time picker.** The native `type="date"`/`type="time"` inputs are what the tests drive and what `normalizeDateInput` expects. The mockup's calendar/clock `.icon-suffix` glyphs are decoration on a static `type="text"` input.
- **Dropping the TipTap editor, the payment schedule, the status select, the place lookup, or the hero-image field** because Screen F/G does not draw them. AC2, AC4.
- **A confirmation dialog before any delete.** The plan dialog's two-tap touch guard is the existing behaviour and is preserved; `TripDeleteDialog` remains the only confirm-gated action in the app.
- **Restyling `TripShareDialog` to share the new `DialogShell`.** Follow-up sweep.
- **Fixing the `MiniImageStrip` keyboard-access defect** (`deferred-work.md:57`) or the `formatCost` three-way divergence (`:54`). Both are deferred, both are adjacent, neither is this story.

### Test contracts this story must preserve — the exact list

| Pinned name | Where | Note |
|---|---|---|
| `Trip name`, `Start date`, `End date`, `Start location…`, `Destination…`, `Hero image…` | `tripCreateForm.test.tsx:79-84,153-158` | regex, case-insensitive |
| `Create trip` (button) | `tripCreateForm.test.tsx:87,168` | |
| `Stay name`, `Cost`, `Check-in time`, `Check-out time`, `Search place`, `Split into multiple payments` | `tripAccommodationDialog.test.tsx:51,170,211,253-255,312` | exact strings |
| `Find` (button), `Save stay` (button) | `tripAccommodationDialog.test.tsx:52,127,264` | |
| `No coordinates selected` | `tripAccommodationDialog.test.tsx:56`, `tripDayPlanDialog.test.tsx:320` | |
| `Title`, `From`, `To`, `Cost`, `Link` | `tripDayPlanDialog.test.tsx:322-326,433-444,620-622,689-691,739-742` | `Link` resolves via `getByRole("textbox", { name: "Link" })` |
| `Bold`, `Italic`, `Image` (buttons) | `tripDayPlanDialog.test.tsx:310-312,328` | TipTap toolbar `aria-label`s |
| `Save item`, `Update item`, `Delete`, `Upload` (buttons) | `tripDayPlanDialog.test.tsx:332,445,518,623,897,992,1096` | |
| `Add plan item`, `Edit plan item` (text) | `tripDayPlanDialog.test.tsx:309,432` | |
| `Latitude: … · Longitude: …` | `tripDayPlanDialog.test.tsx:331,438` | exact format |
| `2 file(s) selected` / `1 Datei(en) ausgewahlt` | `tripDayPlanDialog.test.tsx:895,1164` | German path proves i18n works here |
| `Remove` (gallery button) | `tripDayPlanDialog.test.tsx:1245,1252` | **changes under AC5** — the only sanctioned break |

### Reference implementations to copy, not re-derive

| Pattern | Reference |
|---|---|
| Dialog chrome at token values (head/body/footer, the two MUI traps) | `TripShareDialog.tsx:344-367` (7.5) |
| Caps section/field label | `TripShareDialog.tsx`'s `SectionLabel` — `variant="labelCaps"` with `fontSize: 11`, `letterSpacing: "0.06em"` |
| 56px sharp photo strip, incl. the "never `flex: 1`" rule | `TripDayPlanItemContent.tsx:168-190` (7.3, `variant="strip"`) |
| Token-based notice instead of MUI `Alert` | 7.6's `AuthNotice` inside `AuthScreenShell.tsx` |
| Icon component shape | `TripIcons.tsx:1-13` and any existing glyph |
| Provider-wrapped render | `test/helpers/renderWithProviders.tsx` |
| Message interpolation | `formatMessage` (`src/i18n/index.ts:23`) |
| `:last-child` divider suppression | `TripDayBucketListPanel.tsx` (7.3) |

### Token mapping — mockup hex to theme token

**This story adds no new hex literal.** Hardcoded-literal debt from 7.2/7.4 is already deferred (`deferred-work.md:23,32`); do not grow it.

| Mockup | Token |
|---|---|
| `#FFFFFF` dialog surface | `tokens.card` / `MuiDialog`'s default paper |
| `#FBF9F4` footer fill, input fill, dropzone fill | `tokens.cardAlt` |
| `#E4DFD3` head/footer rules | `tokens.border` |
| `#D9D0BE` dialog border, input border, dashed dropzone/add-tile border | `tokens.borderStrong` |
| `#2B2A26` dialog title, field values, remove-x disc | `tokens.ink` |
| `#6B675C` sub-line, field labels | `tokens.inkSoft` |
| `#8A8677` placeholders, dropzone hint | `tokens.inkMuted` |
| `#4B6358` primary button, dropzone icon, add-tile glyph | `palette.primary.main` |
| `#E7EDE7` dropzone icon tile fill | `tokens.accentSoft` |
| `#8A5A2B` error hint text | `palette.warning.main` |
| `#F6ECE0` / `#C97A3E` input error fill / border | already in `theme.ts:297-302`'s `Mui-error` branch |
| `rgba(0,0,0,0.06)` thumbnail hairline | the one sanctioned literal — it is what `MiniImageStrip` already ships |

`tokens.inkMuted` is a known AA failure at small sizes (`deferred-work.md:55`). Use it only for placeholders and the dropzone's secondary hint, exactly as the mockup does; anything a user must read to act uses `tokens.inkSoft`.

### Typography traps

- The custom variants (`display`, `heading`, `metricLg`, `cardTitle`, `kicker`, `labelCaps`) have **no `variantMapping`** — `<Typography variant="labelCaps">` renders a `<span>` unless you pass `component=`. For a field label you need `component="label"` **with `htmlFor`**; a `<span>` with `htmlFor` associates nothing and every `getByLabelText` in Task 8's table fails.
- `labelCaps` is 10.5px/`0.08em`; the mockup's `.field-label` is 11px/`0.06em`. Override those two values in `sx` — do not invent a variant and do not edit `theme.ts`.
- A dialog title is not a page heading. `DialogTitle` renders `<h2>` by default; leave it.

### Accessibility floor

No formal WCAG claim (`prd.md:207`, `EXPERIENCE.md:99`). These are the project's stated basics (`epics.md:82`):

- 44×44px on every interactive element — including each photo remove affordance and the dropzone's own activation target. Measure the computed box (Task 9); do not infer it from the theme.
- Visible keyboard focus on every control. `EXPERIENCE.md:95` notes focus visuals were never mocked; MUI's default ring plus the theme's accent focus ring satisfies the floor. Do not suppress either, and do not build a dropzone that is mouse-only — the visually-hidden `<input type="file">` is what keeps it keyboard-reachable.
- Colour is never the sole signal (`DESIGN.md:244`): every error state keeps its inline text line, not just the border swap.
- Every decorative icon is `aria-hidden="true"` (`EXPERIENCE.md:107`) — the upload glyph, the error-hint triangle, the dropzone tile. The remove button is the exception: its name is its only signal, and AC5 requires that name to be unique per image.
- Photo alt-text: dialog previews are **meaning-bearing**, not decorative (`DESIGN.md:252` names "photo previews in the Eintrag-hinzufügen dialog" explicitly). Indexed alt strings, not a shared constant.

### Previous story intelligence

From 7.5 (`review`), 7.6 (`ready-for-dev`) and the 7.2–7.4 records — re-applied rules, not discoveries to repeat:

- **A component reading `theme.palette.tokens.*` throws under MUI's bare default theme.** Four stories in a row have paid for this. 21 render sites here.
- **`.MuiDialogTitle-root + .MuiDialogContent-root { padding-top: 0 }`** beats a `p` shorthand and jsdom will not catch it (7.5 defect #2). The sibling selector is in Task 1 for a reason.
- **A sub-line inside `DialogTitle` becomes part of the dialog's accessible name** (7.5 defect #1). Explicit `aria-labelledby`.
- **`slotProps.paper`, not the deprecated `PaperProps`** (7.5 deviation #2).
- **`theme.ts`'s `MuiPaper` override stamps a border on every `Paper`** — which is why 7.3, 7.8 and 7.9 all use `Box` for card surfaces, and why `DialogShell` sets the paper border explicitly.
- **MUI `Alert severity="error"` and `Button color="error"` both resolve to `#d32f2f`**, a colour the palette does not define (7.6 Task 2, 7.8 AC). AC8.
- **`useMediaQuery`-derived layout attributes are deferred debt** (`deferred-work.md:25`). Pure `sx` breakpoints.
- **One commit per story, tests in the same commit as the code, i18n keys added to both dictionaries in the same change, no new dependency.**

### Git intelligence

`b18997c` (CI fix) sits on top of the redesign sequence `a876b8c` 7.1 → `a65c533` 7.2 → `cacfa72` 7.3 → `161a58e` 7.4, with `57c438d` (5.9, comments removal) interleaved. At story-creation time the working tree also carries uncommitted 7.5 work across `TripShareDialog.tsx`, `TripTimeline.tsx`, both i18n files, `tripRepo.ts`, `tripMemberSchemas.ts`, the members route and four test files.

Run `git status` before starting. Expect 7.5 and 7.6 to have landed; if 7.6 has not, take the fallback branch in Task 1. This story's diff should not touch a single file 7.8 or 7.9 owns.

### Latest technical information

No new library, no version bump, no migration. Everything is installed and pinned:

- `@mui/material` ^7.3.8 — `Dialog`/`DialogTitle`/`DialogContent`/`DialogActions`, `TextField`, `Button`, `Radio`/`FormControl`, `CircularProgress`. MUI 7 deprecates `PaperProps` in favour of `slotProps.paper`, and still zeroes `DialogContent`'s top padding after a `DialogTitle`.
- `react-hook-form` ^7.71.1 — `useForm`, `useFieldArray` (the payment rows). Unchanged usage; `register`'s returned `ref`/`name` must still reach the underlying input through `FormField`'s prop spread.
- `@tiptap/react` 3.x — untouched. Do not upgrade it inside a visual story.
- `next` 16.2.12 App Router, `@prisma/client` ^7.3.0 — not exercised by this story.
- Vitest ^3.2.7, `@testing-library/react` ^16.3.2, `user-event` ^14.6.1.
- ESLint: `react-hooks/set-state-in-effect` is downgraded to `warn` and **scoped to exactly 12 files**, three of which you are editing (`TripAccommodationDialog.tsx`, `TripDayPlanDialog.tsx`, `TripDayView.tsx` — `eslint.config.mjs:31`, `deferred-work.md:8`). Keep the file's warning count unchanged: do not add a new `useEffect` that sets state, and do not "fix" the existing ones — `TripDayPlanDialog.tsx:301`'s ~15 reset-on-open setters need their own story.

### Project Structure Notes

Files expected to change:

| Status | Path | Why |
|---|---|---|
| A | `travelplan/src/components/forms/FormField.tsx` | Task 1 (moved from 7.6's `AuthField` if present) |
| A | `travelplan/src/components/forms/FormNotice.tsx` | Task 1 (extracted from 7.6's `AuthNotice` if present) |
| A | `travelplan/src/components/forms/PhotoUploadField.tsx` | Task 1 |
| A | `travelplan/src/components/ui/DialogShell.tsx` | Task 1 |
| M | `travelplan/src/components/features/trips/TripIcons.tsx` | `UploadIcon` |
| M | `travelplan/src/components/features/trips/TripCreateDialog.tsx` | Task 2 |
| M | `travelplan/src/components/features/trips/TripCreateForm.tsx` | Task 2 (render tree only) |
| M | `travelplan/src/components/features/trips/TripAccommodationDialog.tsx` | Task 3 |
| M | `travelplan/src/components/features/trips/TripDayPlanDialog.tsx` | Task 4 |
| M | `travelplan/src/components/features/trips/TripDayView.tsx` | Task 5 — **one dialog block only** |
| M | `travelplan/src/app/(auth)/auth/*/page.tsx` | Task 1, import path only, if 7.6 has landed |
| M | `travelplan/src/i18n/en.ts`, `travelplan/src/i18n/de.ts` | Task 7 |
| M | `travelplan/test/tripCreateForm.test.tsx` | Task 8 |
| M | `travelplan/test/tripAccommodationDialog.test.tsx` | Task 8 |
| M | `travelplan/test/tripDayPlanDialog.test.tsx` | Task 8 |
| M | `_bmad-output/implementation-artifacts/sprint-status.yaml` | Status transitions |

`components/forms/*` and `components/ui/*` are both declared by `architecture.md:399-402` and neither exists yet — this story creates them at the boundary the architecture already names. No API route, no repository, no Zod schema, no migration, no new dependency, no Redux slice. If any of those seems necessary, the change belongs in a different story.

### References

- `_bmad-output/planning-artifacts/epics.md` → "Epic 7" (`:1549-1551`, framing and source-of-truth pointer) → "Story 7.7" (`:1685-1701`, ACs 1–2 verbatim above). Sibling scope: 7.5 (`:1645`, `review`), 7.6 (`:1667`, `ready-for-dev`), 7.8 (`:1703`, the precedent for superseding a prior AC, and the "no MUI error red" constraint at `:1724`), 7.9 (`:1740`, and `:1772` — dialog surfaces belong to *this* story, the fullscreen viewer does not). FR inventory `:19-51` (FR4 `:19`, FR12 `:27`, FR17 `:32`); "Additional Requirements" `:82` (44×44px touch targets, visible focus, full keyboard navigation).
- `_bmad-output/planning-artifacts/prd.md` — "Accessibility Level" (`:205-207`, no formal standard, basic best practices only).
- `.../ux-designs/ux-TravelPlan-2026-07-27/DESIGN.md` — front-matter `colors`/`spacing`/`rounded` (`:10-88`), `components.button` (`:154-160`), `components.input`/`select` (`:161-174`), `components.checkbox` (`:181-184`), `components.photo-strip` (`:141-145`), `components.tab` (`:175-180`); prose "Shapes" (`:229`, dialogs at 10px, photography always sharp), "Elevation & Depth" (`:225`, the modal is one of only three shadowed elements), "Components → button" (`:243`), "→ input / select" (`:244`), "→ photo-strip" (`:240`, fixed 56px basis, never `flex: 1`), "Photo Alt-Text" (`:252`, dialog photo previews are meaning-bearing), "Do's and Don'ts" (`:266`, the 44px floor supersedes the mockups' smaller paddings).
- `.../EXPERIENCE.md` — "Foundation" (`:19`, desktop-only mockups; `:21`, tokens are the source of truth regardless of substrate), "Information Architecture" (`:34-37`, Screens F/G/I and what each is for), "Voice and Tone" (`:47`), "Component Patterns → auth-tabs / type-tabs" (`:69`), "→ button" (`:70`, one primary per dialog, never disabled-with-no-explanation), "→ input / select" (`:71`, inline error line wording), "→ activity timeline neutral-marker rule" (`:66`, **do not add an activity-type field**), "→ photo-strip uniform-square rule" (`:67`), "State Patterns" (`:85` inline spinner permitted on a dialog submit, `:86` non-field errors as a top banner), "Accessibility Floor" (`:103-107`), "Key Flow 4" (`:145-154`, the add-entry flow this story re-skins, including its stated failure mode for empty required fields).
- `.../mockups/forms-authoring.html` — Screen F markup `:559-656`, Screen G markup `:658-754`, Screen I swatch sheet `:833-931`. CSS: `.dialog` `:186-192`, `.dialog.w-460`/`.w-520` `:194-195`, `.dialog-head` `:196`, `.dialog-title` `:197`, `.dialog-sub` `:198`, `.dialog-body` `:199`, `.dialog-footer` `:200-207`, `.field-block` `:213`, `.field-row` `:215`, `.field-label` `:218-228`, `.field-input` `:230-244`, `.field-select` `:267-283`, `.field-hint` `:286-289`, `.btn-primary` `:293-311`, `.btn-secondary` `:314-329`, `.type-tabs`/`.type-tab` `:333-344` (**reference only — not built, see AC3**), `.photo-upload-zone` `:346-354`, `.photo-upload-icon` `:355-363`, `.photo-strip-preview`/`.photo-thumb`/`.remove-x` `:369-395`, `.photo-add-tile` `:406-416`, `.checkbox-row` `:420-426`.
- `_bmad-output/implementation-artifacts/7-5-share-dialog-redesign.md` — "Reference implementations", "Token mapping", "Typography traps", "Accessibility floor", and the whole Dev Agent Record (the three defects, the throwaway-database procedure, the 20-assertion browser check this story's Task 9 mirrors).
- `_bmad-output/implementation-artifacts/7-6-login-register-and-password-reset-redesign.md` — Task 2 (`AuthScreenShell`, `AuthNotice`, the "no MUI Alert" rule) and Task 3 (`AuthField`'s exact contract, the `htmlFor`/`id` requirement, the `labelCaps` 11px/`0.06em` override). **Task 1 of this story depends on what that story landed.**
- `_bmad-output/implementation-artifacts/deferred-work.md` — `:8` (the `set-state-in-effect` warn-scoped file list, three of which this story edits), `:23` (hardcoded-literal debt), `:25` (why `useMediaQuery` must not be replicated), `:41` (why the browser check uses a throwaway database and never `prisma/dev.db`), `:55` (`inkMuted` contrast), `:57` (`MiniImageStrip` keyboard defect — stays deferred), `:59` (**"That dialog's internals are Story 7.7's surface"** — the origin of AC7).
- `travelplan/src/components/features/trips/TripCreateDialog.tsx` (97 lines — read in full), `TripCreateForm.tsx` (537 — read `:397-537`, the render tree; everything above is untouched), `TripAccommodationDialog.tsx` (1053 — read `:747-1051`), `TripDayPlanDialog.tsx` (1255 — read `:866-1253`), `TripDayView.tsx:2404-2455` (the three dialog mounts) and `:2499-2559` (the day-details dialog), `TripDayPlanItemContent.tsx:149-198` (`MiniImageStrip`), `TripIcons.tsx` (the icon contract and the existing glyph set), `TripShareDialog.tsx:344-367` (the shipped dialog chrome), `src/theme.ts` (tokens, custom variants, `MuiButton`/`MuiOutlinedInput`/`MuiSelect`/`MuiTab`/`MuiCheckbox`/`MuiDialog`/`MuiPaper` overrides), `src/i18n/en.ts:104-123` (`trips.create.*`, `trips.form.*`), `:301-308` (`trips.dayImage.*`), `:397-418` (`trips.plan.*`), then the contiguous `trips.payments.*`, `trips.stay.*` and `trips.gallery.*` blocks running to `:464`.
- `travelplan/test/tripCreateForm.test.tsx`, `test/tripAccommodationDialog.test.tsx`, `test/tripDayPlanDialog.test.tsx` (the three contract files — read in full before editing any component), `test/helpers/renderWithProviders.tsx`, `test/i18nDictionaries.test.ts`, `test/tripDayViewLayout.test.tsx:30-37` and `test/tripTimelineRoles.test.tsx:8` (the mocks that prove your prop contracts held), `travelplan/eslint.config.mjs:31`.
- `_bmad-output/planning-artifacts/architecture.md` — "Structure Patterns" (`:241`), "Component Boundaries" (`:399-402`, `components/ui/*` and `components/forms/*` — the homes this story creates), "Format Patterns" (`:256`).

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List

### Change Log

- 2026-08-01: Story created (create-story). Status: ready-for-dev. AC1–AC2 copied verbatim from `epics.md`; AC3–AC8 added because Screen G draws one dialog where the product has two, Screen F draws three fields where the form has six, AC1's photo-strip clause has no implementation behind it, the label move puts 20+ pinned accessible names at risk, `deferred-work.md:59` assigns the day-details dialog here, and the mockups define no destructive-button treatment — see the Scope note.
