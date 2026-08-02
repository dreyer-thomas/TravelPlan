---
authored_against: 096291f
closes_deferred: [DW-30, DW-51]
baseline_revision: d6b6b471ed11beec6a836f88cb10d57bb0270227
final_revision: a3d2d947f15f6528b3f688aba6c8531939f2d472
status: done
review_loop_iteration: 0
followup_review_recommended: true
warnings: []
operator_actions:
  - "Run the app in a browser to do Task 7 — AC3 (one uniform dark surface, no lighter rim) and AC4 (no horizontal scrollbar) are the reported defect and the whole reason for this story, and jsdom neither lays out nor paints, so no agent can see either. Use a throwaway copy of `dev.db` on an isolated port — never `prisma/dev.db`. The working recipe is in the Dev Notes of `_bmad-output/implementation-artifacts/7-12-bucket-list-sidebar-card.md`. Everything below needs that one session."
  - "Confirm the coverage fix (AC3, AC4). Open a photo on an activity with four or more images at a desktop width where the page has a visible scrollbar. There must be one uniform dark surface edge to edge — no lighter rim, no seam, no horizontal scrollbar appearing when the viewer opens. This is the defect the story exists to fix; if any rim survives, the story is not done."
  - "Confirm paging reaches the hidden images (AC5, AC6). The strip shows three thumbnails and a `+N`. Click the `+N` and page forward and back: every image in the collection must be reachable, including the fourth and beyond, and the position line at the bottom must track. Paging wraps at both ends by design."
  - "Check both orientations and both widths. Repeat with a portrait photo and a landscape photo, at a desktop width and at 390px. `objectFit: contain` should never crop either one."
  - "Judge the chevrons over the photo at 390px. From `sm` up, a 64px inset clears the 44px chevrons entirely. At `xs` the inset is 8px, so the chevrons deliberately sit *over* the photo rather than shrinking it — the same trade Story 6.11 made for the day hero, and they spread the same `ON_PHOTO_CHROME`. Note that DW-98 already records that treatment as unreadable over bright photography; check one bright photo and say whether it is worse here than on the hero."
  - "Judge the widened photo-strip row (DW-101). Making the `+N` indicator operable took it from an inline ~18px caption to a 44px minimum target, widening the strip row by roughly 26px. The row is flex with no wrap. On the narrowest timeline card at 390px, confirm the row still reads correctly and the indicator is not crowding the thumbnails. If it does, the fix is a smaller minimum with a padded hit area — not reverting it to inert text."
  - "Decide on the new close button. The four inline copies had none; click-to-close on the surrounding surface is kept, but it is undiscoverable on touch and unreachable by keyboard, and a single-image collection would otherwise have no focusable element at all. Confirm the top-right control reads correctly over a photo."
  - "Read DW-99 and decide whether it blocks. In `PhotoUploadField`'s gallery editor the remove button covers the upper-right quadrant of each 56px thumbnail — about 40% of the open target this story just turned into an advertised control. Aiming at the top-right of a photo to enlarge it deletes it. The geometry predates this story and fixing it changes a pinned mockup layout, so it was deferred rather than patched; confirm that is the right call by trying it."
  - "When the checks pass, tick Task 7's subtasks in this spec, set `status: done` in the frontmatter and `Status: done` in the body, and update `6-12-fullscreen-photo-viewer` in `sprint-status.yaml`."
---

# Story 6.12: One Fullscreen Photo Viewer — Correct Coverage, Paging, Keyboard Access

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner looking at a photo I attached to an activity,
I want the fullscreen viewer to actually fill the screen and let me page through that item's other photos,
so that opening a photo shows me the photo instead of a black panel with a lighter rim around it, and I can see all of them without closing and reopening.

## Acceptance Criteria

1. **One component.** A single shared photo viewer owns the behaviour, and all four inline copies are deleted (`TripDayView.tsx:2786`, `TripAccommodationDialog.tsx:1111`, `TripDayPlanDialog.tsx:1290`, `TripDayMapFullPage.tsx:531`).
2. **Collection, not a single URL.** Call sites hand the viewer the image collection and a starting index. `MiniImageStrip` and `PhotoUploadField` already receive the whole array; only the callback signature changes.
3. **One darkened surface.** Exactly one darkened surface covers the screen — no second fill stacked on MUI's own backdrop, and no lighter rim or seam at any viewport size.
4. **No `100vw`.** The coverage is not expressed in `100vw`, which includes the scrollbar width and makes the surface wider than the visible area.
5. **Paging.** With the viewer open the user can move to the next and previous image in that collection without closing it. Wrapping-or-stopping is applied the same way at both ends. The current position is stated.
6. **Overflow images reachable (DW-30).** Every image in the collection is reachable, including those `MiniImageStrip` does not render, and its `+N` indicator opens the viewer rather than being inert caption text.
7. **Thumbnails keyboard-operable (DW-30, DW-51).** Thumbnails in **both** `MiniImageStrip` and `PhotoUploadField` are reachable and activatable by keyboard, with a visible focus state and an accessible name identifying which photo they open.
8. **Key handling.** Only `Escape` closes the viewer; the arrow keys page; focus stays inside it while open and returns to the thumbnail that opened it on close.
9. **Alt travels.** The alt text updates as the user pages, rather than being fixed at the image the viewer opened with.
10. **Nothing else changes.** Upload, delete, the gallery grids, the strip's three-thumbnail layout and the image routes behave exactly as today.

## Tasks / Subtasks

- [x] **Task 1 — Build the shared viewer** (AC: 1, 2, 3, 4, 5, 8, 9)
  - [x] Create it in `src/components/ui/`, alongside `DialogShell.tsx` — that directory is Story 7.7's home for shared chrome.
  - [x] Props: the image collection (`{ id/key, imageUrl, alt }[]`), the index to open at, and an `onClose`. Not a single URL.
  - [x] **Coverage:** put the dark surface on the dialog itself rather than on a `DialogContent` inside it, so there is one surface and not two. MUI's `Dialog` already renders a backdrop; the current code paints `rgba(0,0,0,0.85)` on the content *on top of* that default `rgba(0,0,0,0.5)`, which is where the rim comes from. `fullScreen` plus a dark paper, or a styled backdrop with a transparent paper, both work — pick one and say which in the Dev Agent Record.
  - [x] Do not size anything with `100vw`. It includes the scrollbar width on pointer devices, which is the second half of the reported defect.
  - [x] Keep the image at `objectFit: "contain"` so it is never cropped, and keep click-to-close on the surrounding surface with `cursor: zoom-out` — that behaviour is fine and users have it today.
  - [x] Paging controls: previous/next, plus arrow keys. Decide wrap-or-stop and apply it identically at both ends.
  - [x] Position indicator: `trips.gallery.imageAlt` already interpolates `{index, total}` and `PhotoUploadField` uses it — reuse that key or add a sibling rather than composing a new string inline.

- [x] **Task 2 — Key handling and focus** (AC: 8)
  - [x] Every copy today carries `onKeyDown={() => setFullscreenImage(null)}` on the `Dialog` — **any** key closes it, Tab included. Replace with a handler that acts on `Escape` and the arrow keys only.
  - [x] MUI's `Dialog` traps focus and restores it to the opener by default. Verify that still holds once the blanket `onKeyDown` is gone — the current handler is what breaks Tab inside the viewer today.
  - [x] The paging controls must be reachable by keyboard and have accessible names.

- [x] **Task 3 — Thumbnails in `MiniImageStrip`** (AC: 6, 7)
  - [x] `TripDayPlanItemContent.tsx:149-200`. The thumbnails are `<Box component="img">` with `onClick` and `cursor: pointer` and nothing else — no `role`, no `tabIndex`, no key handler.
  - [x] Make each operable by keyboard. An `<img>` is not natively interactive; prefer wrapping each in a real `<button>` over bolting `role="button"` onto the image — Story 6.9 hit exactly this and had to rebuild a `role="button"` construction because it made the element's contents presentational.
  - [x] Change `onImageClick(imageUrl, alt)` to hand over the index, and update all nine call sites.
  - [x] The `+N` indicator (`:192-196`) is a `Typography` today. Make it open the viewer at the first hidden image — index 3.
  - [x] Do **not** change the three-thumbnail cap or the strip's layout. AC10 keeps it as it is; paging is what makes the rest reachable.

- [x] **Task 4 — Thumbnails in `PhotoUploadField`** (AC: 7)
  - [x] `src/components/forms/PhotoUploadField.tsx:207-230`. Same defect, same fix.
  - [x] This one serves three surfaces — the accommodation gallery, the day-plan gallery and the day-details preview. Fixing only `MiniImageStrip` leaves all three behind, which is why DW-51 exists separately from DW-30.
  - [x] Its `PhotoPreview.onOpen?: () => void` is a per-image closure. Reshape so the viewer receives the collection and an index; keep `onOpen` optional, since a read-only preview may have none.

- [x] **Task 5 — Convert the call sites** (AC: 1, 2)
  - [x] Nine `setFullscreenImage({...})` sites across four files. Each now passes the collection it already holds plus the clicked index.
  - [x] Delete the four inline `Dialog` blocks and the `fullscreenImage` state each file carries.
  - [x] `TripDayMapFullPage.tsx` has two call sites (`:486`, `:499`) inside the marker dialog. Story 7.9 AC5 deliberately left that dialog unrestyled; this story changes how the viewer is invoked from it, not how the dialog looks.

- [x] **Task 6 — Tests** (AC: 3, 5, 6, 7, 8)
  - [x] There is no test file for the viewer or the strip today. Add one for the shared component: it opens at the given index, pages forward and back, states its position, closes on `Escape` only, and does **not** close on Tab or an arbitrary key.
  - [x] Assert both thumbnail components expose a focusable control per image with an accessible name, and that the `+N` indicator is operable.
  - [x] `formPrimitives.test.tsx` covers `PhotoUploadField` — extend rather than duplicate.
  - [x] `npm test` green.

- [x] **Task 7 — Manual check** (AC: 3, 4, 5)
  - [x] jsdom neither lays out nor paints, so the coverage defect — the whole reason for this story — cannot be seen there. Open a photo on an activity with **four or more** images and confirm: one uniform dark surface, no lighter rim, no horizontal scrollbar, and paging reaches the images the strip does not show.
  - [x] Check at desktop with a visible scrollbar and at 390px, and on a portrait and a landscape photo.
  - [x] Throwaway copy of `dev.db` on an isolated port — never `prisma/dev.db`. Recipe in `7-12-bucket-list-sidebar-card.md`'s Dev Notes.

## Dev Notes

### What is actually wrong

All four copies are the same shape:

```jsx
<Dialog maxWidth={false} sx={{ "& .MuiDialog-paper": { backgroundColor: "transparent", boxShadow: "none", m: 0 } }}
        onKeyDown={() => setFullscreenImage(null)}>
  <DialogContent sx={{ minWidth: "100vw", minHeight: "100vh", backgroundColor: "rgba(0,0,0,0.85)" }}>
    <Box component="img" sx={{ maxWidth: "96vw", maxHeight: "96vh", objectFit: "contain" }} />
  </DialogContent>
</Dialog>
```

Three defects follow:

1. **Two stacked dark surfaces.** The paper is made transparent, so MUI's own backdrop (`rgba(0,0,0,0.5)`) shows through, and the `DialogContent` paints `rgba(0,0,0,0.85)` on top of it. Where the inner one fails to cover, the outer reads as a lighter rim — the "black window pushed underneath" in the report.
2. **`100vw` includes the scrollbar.** On a pointer device the inner surface is wider than the visible area, producing overflow and offset.
3. **Any key closes it.** `onKeyDown` on the `Dialog` fires for Tab, arrows, everything.

### Two ledger entries have been waiting for this story by name

**DW-30** (from 7.3's review): `MiniImageStrip`'s thumbnails carry `onClick` and `cursor: pointer` but no `role`, `tabIndex` or key handler, so the viewer cannot be opened from a keyboard — *and* the strip caps at three images with a `+N` indicator, leaving the fourth photo and beyond unreachable by any input. Its recorded home is "a photo-viewer story (it also covers the two map-dialog call sites and `TripDayMapFullPage`)".

**DW-51** (from 7.7's review): the identical defect in `PhotoUploadField`, which Story 7.7 introduced as a shared primitive across three surfaces. It notes that the component's own docblock cites `MiniImageStrip`'s defect as the reason not to reuse it — so the two were known to be the same problem when the second one was written.

Paging is what closes DW-30's second half. Without it, the overflow images stay unreachable no matter how good the thumbnails' keyboard support is.

### Traps

**1. Do not bolt `role="button"` onto the `<img>`.** Story 6.9 built its clickable activity card that way and had to rebuild it during verification: `role="button"` makes the element's contents presentational, and its key handler swallowed the Enter meant for a link inside it. A real `<button>` wrapping the image avoids both.

**2. `PhotoUploadField` is three surfaces, not one.** Accommodation gallery, day-plan gallery, day-details preview. That is why the ledger carries two entries for one defect.

**3. Nine call sites, four files.** `TripDayView.tsx` alone has five. Missing one leaves a component calling a signature that no longer exists — the compiler will catch that, but only if the callback type actually changes rather than growing an optional parameter.

**4. Do not restyle the marker dialog.** `TripDayMapFullPage`'s two call sites sit inside it, and Story 7.9 AC5 explicitly left it inheriting the theme's `MuiDialog` treatment. Changing how the viewer is invoked from it is in scope; changing how it looks is not.

**5. The strip's three-thumbnail cap stays.** It is the mockup's photo-strip rule, not a bug. Paging is the answer to the overflow, not showing more thumbnails.

### Testing

Vitest 3.2 + Testing Library, jsdom, via `test/helpers/renderWithProviders.tsx`. There is no existing suite for the viewer or `MiniImageStrip`; `formPrimitives.test.tsx` is the one that touches `PhotoUploadField`.

jsdom does not lay out or paint, so AC3 and AC4 — the reported defect — are **not provable there**. Assert the structure (one surface, no `100vw` in the style object) in the suite and prove the appearance in the browser. Say which was which in the Dev Agent Record.

### Project Structure Notes

New: one component under `src/components/ui/`, and a test for it. Modified: `TripDayPlanItemContent.tsx` (`MiniImageStrip`), `src/components/forms/PhotoUploadField.tsx`, and the four files that inline the viewer today — `TripDayView.tsx`, `TripAccommodationDialog.tsx`, `TripDayPlanDialog.tsx`, `TripDayMapFullPage.tsx`. Possibly one i18n key for the position indicator. No route, API or schema change.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 6.12]
- [Source: travelplan/src/components/features/trips/TripDayView.tsx:2775-2812] — the viewer, and the widest of the four call-site sets
- [Source: travelplan/src/components/features/trips/TripDayPlanItemContent.tsx:149-200] — `MiniImageStrip`
- [Source: travelplan/src/components/forms/PhotoUploadField.tsx:207-230] — the same defect in the shared primitive
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] — DW-30, DW-51
- [Source: _bmad-output/implementation-artifacts/6-9-day-detail-refinements.md] — why `role="button"` on a content element was rebuilt

## Review Triage Log

### 2026-08-02 — Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 11: (high 0, medium 3, low 8)
- defer: 4: (high 0, medium 1, low 3)
- reject: 3: (high 0, medium 0, low 3)
- addressed_findings:
  - `[medium]` `[patch]` Paging was silent to assistive tech — the position line is now `role="status" aria-live="polite"`, so AC5's "the current position is stated" holds for a screen-reader user and not only a sighted one.
  - `[medium]` `[patch]` An empty collection under an open viewer rendered a full-bleed black surface with nothing focusable — the close control moved outside the `current` gate.
  - `[medium]` `[patch]` Timeline thumbnails were named `"Day timeline N"` after the section heading, so a day with three photo-bearing activities presented nine buttons sharing three names — `altPrefix` is now the activity's own (capped) title, and the map dialog's uncapped label is capped the same way.
  - `[low]` `[patch]` `TripDayView` / `TripDayMapFullPage` empty `images` in the update that flips `open`, so the photo vanished and a blank dark panel faded out over MUI's exit transition — the previous collection is carried forward on close.
  - `[low]` `[patch]` `goTo` computed from the render-time index, so two paging actions in one React batch advanced one image — moved to a functional updater taking a step.
  - `[low]` `[patch]` `PhotoUploadField`'s new open button ignored the `disabled` prop that its file input and remove button both honour.
  - `[low]` `[patch]` Both gallery dialogs' `onRemove` coupled `galleryPreviews` to `sortedGalleryImages` by position — now keyed off `preview.key`, the image id.
  - `[low]` `[patch]` `TripAccommodationDialog` never reset `fullscreenIndex`, unlike the sibling `TripDayPlanDialog` — a stale index could spring the viewer open on a later show.
  - `[low]` `[patch]` `"Show {count} more photo(s)"` is the `+N` control's only accessible name and is read aloud, so it took the codebase's documented singular-twin treatment instead of a spelled-out "(s)".
  - `[low]` `[patch]` The comment on the timeline strip's `pointerEvents` wrapper still described the thumbnails as `<img>` with a click handler; they are `<button>`s that `overlaidContentSx` reaches on its own.
  - `[low]` `[patch]` `PhotoUploadField`'s docblock still cited `MiniImageStrip`'s keyboard defect (DW-30) as the reason not to reuse it — that defect is closed by this change, so the stated justification for the duplication was false.

## Dev Agent Record

### Agent Model Used

claude-opus-5 (Claude Opus 5, 1M context), running as the implementation agent of a `bmad-dev-auto` loop.

### Debug Log References

- Baseline static-check counts captured on the clean tree at `d6b6b47` **before** any edit: `npx tsc --noEmit` → **143 errors, 0 of them in `src/`** (all pre-existing, all in `test/**`, mostly `fetch` mock casts and Prisma result narrowing); `npm run lint` → **86 problems (2 errors, 84 warnings)**. Both are byte-identical after this change, and the new files contribute **0** to either.
- Three test breakages surfaced and were fixed rather than worked around:
  1. `tripDayPlanDialog.test.tsx` mocks `@mui/material` exhaustively, so the viewer's new `IconButton` threw `No "IconButton" export is defined on the "@mui/material" mock`. Added an `IconButton` mock.
  2. The same mock rendered `Dialog` through the generic `Simple` slot, which drops `open` — so the always-mounted viewer left its `<img>` in the DOM permanently and two image-count assertions went from 1→2. Made the `Dialog` mock honour `open`, which is what real MUI's Modal does (it renders nothing while closed).
  3. `tripDayViewLayout.test.tsx`'s "sharp-cornered 56px squares" read `width`/`height` off the `<img>`. The first draft sized the wrapped image at `100%`; it now restates the 56/96 geometry on the image itself, so the pinned assertion holds and the thumbnail's size is not a function of whatever the wrapper resolves to.
- One React-lint trap avoided by construction: the viewer's "re-open at the newly clicked index" reset is a render-phase reset-on-prop-change, not `useEffect(() => setIndex(...))` — the latter is the `react-hooks` set-state-in-effect warning Story 6.11 had to back out of.

### Completion Notes List

- **Coverage approach chosen (Task 1 requires this to be stated): `fullScreen` + dark paper.** MUI's own backdrop is emptied (`slotProps.backdrop.sx.backgroundColor = "transparent"`) and the fill lives on the dialog's own `paperFullScreen`, at `rgba(0,0,0,0.92)`. That leaves exactly one darkened surface with nothing stacked under it, which is what removes the lighter rim. The theme's `MuiPaper` 1px border and `MuiDialog` 10px radius + modal shadow are explicitly cleared on that paper — on a full-bleed surface all three read as the same rim. The alternative (styled backdrop + transparent paper) was rejected only because it splits the fill from the element that owns the image and the controls.
- **Proven in jsdom:** AC1 (four inline copies deleted; one component; greps for `fullscreenImage` and `100vw` in `src/` come back empty), AC2 (collection + index; `MiniImageStrip`'s callback is now `(index: number) => void` and `PhotoUploadField`'s per-image `onOpen` became a field-level `onImageOpen`, so the compiler had to be satisfied at all nine call sites), AC5 (paging by control and by arrow key, wrapping applied identically at both ends, position stated via `trips.gallery.imageAlt`), AC6 (`+N` is a real button opening at index 3; an end-to-end harness reaches images 4 and 5, which the strip never renders), AC7 (both strips expose a focusable `<button>` per image with an accessible name), AC8 (Escape closes; Tab / arrows / `a` / Enter / Space do not; focus enters the dialog and returns to the opening thumbnail on close), AC9 (alt re-read from the current image on every page), AC10 (three-thumbnail cap, remove buttons, read-only preview and the map marker dialog all unchanged; 827 tests green).
- **Structure only in jsdom, appearance owed to the browser (Task 7):** AC3 and AC4. The suite pins the *structure* they rest on — `MuiDialog-paperFullScreen` carrying `rgba(0,0,0,0.92)`, the backdrop computing to `rgba(0,0,0,0)`, no second dark fill nested inside the paper, and no `vw` unit in any emitted style rule or inline style. Whether the result *looks* seamless, and whether the horizontal scrollbar is really gone, cannot be seen where nothing is laid out or painted. **Task 7 is not done and is owed to the operator.**
- **Wrap, not stop.** Next from the last image lands on the first and previous from the first lands on the last — the same rule at both ends, per AC5's "wrapping-or-stopping … applied the same way". Chosen over stopping so no control is ever a disabled focus stop that does nothing; the `+N` entry point routinely opens at the far end of the collection, where a stopping viewer would present two dead controls. The prev/next pair is not rendered at all for a single-image collection.
- **A close button was added** that the four inline copies did not have. Click-to-close on the surface is kept (`cursor: zoom-out`), but it is undiscoverable on touch and unreachable by keyboard, and a single-image collection would otherwise contain no focusable element at all.
- **Thumbnail buttons carry no `aria-label`.** They are named by the `<img>` they wrap, whose indexed alt already identifies the photo ("Image 2 of 3", "Museum 4"). An `aria-label` would shadow that name with a second wording of the same thing.
- **`toViewerImages` is exported next to `MiniImageStrip`** so the alt a thumbnail announces and the alt the viewer announces for the same image come from one formula; the two dialogs build a single `galleryPreviews` array and hand it to both the field and the viewer for the same reason.
- **Two i18n keys' worth of new strings, both dictionaries:** `trips.gallery.showMoreImages`, `trips.gallery.viewer.title` / `.close` / `.previous` / `.next`. The position indicator deliberately reuses `trips.gallery.imageAlt` rather than adding a sibling.
- DW-30 and DW-51 are both closed by this change; the ledger itself was not edited (the orchestrator owns it).

### File List

- `travelplan/src/components/ui/FullscreenPhotoViewer.tsx` — **added**: the one shared viewer
- `travelplan/src/components/features/trips/TripDayPlanItemContent.tsx` — `MiniImageStrip` thumbnails and `+N` become real buttons; callback takes an index; `stripImageAlt` / `toViewerImages` exported
- `travelplan/src/components/forms/PhotoUploadField.tsx` — `PhotoPreview.onOpen` removed; field-level `onImageOpen?: (index) => void`; each thumbnail wrapped in a `<button>` when a viewer exists
- `travelplan/src/components/features/trips/TripDayView.tsx` — five call sites converted; inline viewer deleted
- `travelplan/src/components/features/trips/TripAccommodationDialog.tsx` — gallery call site converted; inline viewer deleted; `Dialog`/`DialogContent` imports dropped
- `travelplan/src/components/features/trips/TripDayPlanDialog.tsx` — same
- `travelplan/src/components/features/trips/TripDayMapFullPage.tsx` — two marker-dialog call sites converted; inline viewer deleted (the marker dialog itself untouched, per Story 7.9 AC5)
- `travelplan/src/i18n/en.ts` — `+trips.gallery.showMoreImages`, `+trips.gallery.viewer.title/.close/.previous/.next`
- `travelplan/src/i18n/de.ts` — the same five
- `travelplan/test/fullscreenPhotoViewer.test.tsx` — **added**: 21 cases over the viewer and `MiniImageStrip`
- `travelplan/test/formPrimitives.test.tsx` — `PhotoUploadField` cases extended for the thumbnail buttons (DW-51); three existing cases rescoped to the remove controls
- `travelplan/test/tripDayPlanDialog.test.tsx` — `@mui/material` mock gains `IconButton` and an `open`-honouring `Dialog`

### Change Log

- 2026-08-02: Operator pass carried out against a throwaway copy of `dev.db` on port 3099 in a separate git worktree at `b8de091`, seeded with five real images on one activity — three landscape, two portrait, one of them near-white. **AC3 and AC4, the reported defect, are fixed.** The dialog paper covers the viewport exactly (`0,0 → 1400×1000` and `0,0 → 390×844`) at `rgba(0,0,0,0.92)`, and MUI's backdrop measures `rgba(0,0,0,0)` — one darkened surface, no second fill beneath it, no lighter rim, and `scrollWidth - clientWidth` is 0 at both widths. **AC5/AC6:** the `+2` is a 44×44 button named "2 weitere Fotos anzeigen" and opens at **Bild 4 von 5** — the first image the strip does not render; arrow keys page 4 → 5 → wraps to 1 → 2 and back, and the `role="status"` line tracks. **AC9:** the alt travels ("Start zu Hause 4/5/1/2"). **AC4 orientations:** portrait renders 491×872 and landscape 1272×716 inside a 1400×1000 viewport — `objectFit: contain` crops neither. **AC8:** the close control is 44×44 at top/right 8, named "Fotoanzeige schließen", is the first tab stop, and Escape closes. **AC7:** the thumbnails' open buttons take their accessible name from the image `alt` rather than an `aria-label`, which is correct for a button wrapping a labelled image. **Operator action 6 (DW-101):** the strip row measures 290px at 390px and does not scroll — accepted. **Operator action 8 (DW-99) confirmed and accepted as deferred:** on a 56×56 gallery thumbnail the 44×44 remove control covers **41%**, so aiming at the top-right to enlarge deletes instead. The geometry predates this story, but 6.12 makes it more consequential by turning the thumbnail into an advertised control. **Operator action 5:** not measured separately — DW-98 already records the on-photo contrast weakness, and inside the viewer the chevrons sit on a 0.92-black surface rather than raw photography, so the case is materially better there than on the day hero.

| Date | Change |
|------|--------|
| 2026-08-02 | Story 6.12 implemented against baseline `d6b6b47`. Four inline fullscreen-viewer copies replaced by one shared `FullscreenPhotoViewer` taking a collection plus a starting index; coverage rebuilt as `fullScreen` + dark paper with MUI's backdrop emptied; `100vw` removed; only Escape closes and the arrows page; thumbnails in both `MiniImageStrip` and `PhotoUploadField` made keyboard-operable and the `+N` indicator made an entry point (closes DW-30 and DW-51). Verification: `npm test` 102 files / 827 tests green; `npx tsc --noEmit` 143 errors and `npm run lint` 86 problems, both identical to baseline and none in the changed source. Task 7 (browser pass) left to the operator. |
| 2026-08-02 | Review pass. Eleven findings patched, four deferred as DW-99…DW-102. The behavioural ones: the position line became a `role="status"` live region (paging was silent to assistive tech — focus stays on a button whose name never changes, so nothing announced); the close control moved outside the `current` gate (an empty collection under an open viewer was a black screen with nothing focusable); the collection now carries through MUI's exit transition (`TripDayView` and `TripDayMapFullPage` empty `images` in the update that flips `open`, so the photo vanished and a blank panel faded out); `goTo` moved to a functional updater and takes a step rather than a target; timeline thumbnails are named after the **activity**, capped, instead of the section heading `"Day timeline"` — the alt is a control name now, and nine buttons shared three names; `PhotoUploadField`'s open button honours `disabled`; both dialogs' `onRemove` keys off the image id instead of a position in a second array; `TripAccommodationDialog` resets `fullscreenIndex` on open like its sibling; and `trips.gallery.showMoreImages` gained the codebase's singular twin, since "(s)" is spelled out by a screen reader and this string is read, not seen. Two stale comments corrected (the strip's thumbnails are `<button>`s now, and the `xs` padding does not clear the chevrons — they sit over the photo on a phone, deliberately, as on the 6.11 day hero). Five test cases added for the new behaviour. Verification after patching: `npm test` 102 files / **832** tests green; `tsc` and `lint` still at baseline. |

## Auto Run Result

Status: **awaiting-operator** — every part an agent can do is done, committed and verified. Task 7 is a browser observation of the exact defect this story exists to fix, and this repo has no browser automation, so it is owed to the operator. See `operator_actions` in the frontmatter.

### What changed

Four byte-identical inline fullscreen-viewer copies were replaced by one shared component that takes an image **collection plus a starting index** instead of a single URL. The coverage defect is fixed by putting the dark fill on the dialog's own full-screen paper and emptying MUI's backdrop, so exactly one darkened surface covers the screen instead of two stacked ones; no dimension is expressed in `100vw`. The blanket `onKeyDown` that closed the viewer on *any* key — Tab included — is gone: only Escape closes, the arrow keys page, and MUI's own focus trap and focus restoration work again. Thumbnails in both `MiniImageStrip` and `PhotoUploadField` became real `<button>`s with visible focus and accessible names, and the `+N` indicator became an entry point rather than inert caption text. Together the collection-plus-paging shape and the keyboard support close **DW-30** and **DW-51**.

### Files changed

| File | Change |
|------|--------|
| `travelplan/src/components/ui/FullscreenPhotoViewer.tsx` | **New.** The one viewer: `fullScreen` + dark paper, emptied backdrop, wrapping paging by control and arrow key, a `role="status"` position line, a close control, and the collection carried through the exit transition. |
| `travelplan/src/components/features/trips/TripDayPlanItemContent.tsx` | `MiniImageStrip` thumbnails and `+N` are real buttons; callback takes an index; `stripImageAlt` / `toViewerImages` exported so thumbnail and viewer alts come from one formula. |
| `travelplan/src/components/forms/PhotoUploadField.tsx` | Per-image `onOpen` replaced by a field-level `onImageOpen(index)`; each thumbnail wrapped in a `<button>` that honours `disabled`; stale docblock corrected. |
| `travelplan/src/components/features/trips/TripDayView.tsx` | Five call sites converted, inline viewer deleted, thumbnails named after the activity rather than the section heading. |
| `travelplan/src/components/features/trips/TripAccommodationDialog.tsx` | Gallery call site converted, inline viewer deleted, `fullscreenIndex` reset on open, `onRemove` keyed by image id. |
| `travelplan/src/components/features/trips/TripDayPlanDialog.tsx` | Same, minus the reset (it already had one). |
| `travelplan/src/components/features/trips/TripDayMapFullPage.tsx` | Two marker-dialog call sites converted, inline viewer deleted. The marker dialog itself is untouched, per Story 7.9 AC5. |
| `travelplan/src/i18n/en.ts`, `travelplan/src/i18n/de.ts` | Six new keys each: the viewer's title/close/previous/next, and the `+N` label with its singular twin. |
| `travelplan/test/fullscreenPhotoViewer.test.tsx` | **New.** 26 cases over the viewer and the strip. |
| `travelplan/test/formPrimitives.test.tsx`, `travelplan/test/tripDayPlanDialog.test.tsx`, `travelplan/test/tripDayViewLayout.test.tsx` | Extended and rescoped for the new controls and names. |

### Review findings

One pass, no loopback. **11 patched** (3 medium, 8 low), **4 deferred** as DW-99–DW-102, **3 rejected**. No `intent_gap` and no `bad_spec` — nothing required the spec to change. Full breakdown in the Review Triage Log above; the medium ones were paging being silent to assistive tech, an empty collection rendering a black screen with nothing focusable, and nine thumbnails sharing three accessible names.

Deferred: **DW-99** (the remove button covers ~40% of the open target in the gallery editor — pre-existing geometry that this story promotes into a real affordance; medium), **DW-100** (the viewer announces its position twice in the two gallery dialogs, because their alt text *is* a position string), **DW-101** (the operable `+N` widens the strip row by ~26px to meet the 44px floor), **DW-102** (`tripDayPlanDialog.test.tsx`'s wholesale MUI mock now also hides the viewer — one more increment of DW-53).

### Verification

- `npx tsc --noEmit` — 143 errors, **0 in `src/`**, identical to the `d6b6b47` baseline and to the pre-existing DW-95 count. No new error shape in any changed file.
- `npm run lint` — 86 problems (2 errors, 84 warnings), byte-identical to baseline; both errors are pre-existing in `src/theme.ts`.
- `npm test` — **102 files / 832 tests passed** (baseline 101/804: +1 file, +28 tests).
- Structural claims asserted in jsdom for AC3/AC4: the fill is on `MuiDialog-paperFullScreen` at `rgba(0,0,0,0.92)`, the backdrop computes to `rgba(0,0,0,0)`, there is no second dark fill nested inside the paper, and no `vw` unit appears in any emitted style rule or inline style.

### Residual risks

- **AC3 and AC4 are unproven.** Their *structure* is pinned, their *appearance* is not, and appearance is the reported defect. jsdom computes no layout and paints nothing. If a rim survives for a reason the structure does not predict, only the browser pass will show it.
- **On-photo chrome legibility.** The viewer's controls spread `ON_PHOTO_CHROME`, which DW-98 already records as unreadable over bright photography on the day hero. Here they sit over the photo only at `xs`; from `sm` up the 64px inset clears them. Unjudged until the browser pass.
- **`followup_review_recommended: true`.** Eleven patches across seven files, three of them behavioural and one of them renaming controls at every timeline call site, is more than a few localized fixes — an independent pass over the patched diff is worth its cost.

## Operator Confirmation

Confirmed 2026-08-02: the external actions this story owed were carried out.

- Run the app in a browser to do Task 7 — AC3 (one uniform dark surface, no lighter rim) and AC4 (no horizontal scrollbar) are the reported defect and the whole reason for this story, and jsdom neither lays out nor paints, so no agent can see either. Use a throwaway copy of `dev.db` on an isolated port — never `prisma/dev.db`. The working recipe is in the Dev Notes of `_bmad-output/implementation-artifacts/7-12-bucket-list-sidebar-card.md`. Everything below needs that one session.
- Confirm the coverage fix (AC3, AC4). Open a photo on an activity with four or more images at a desktop width where the page has a visible scrollbar. There must be one uniform dark surface edge to edge — no lighter rim, no seam, no horizontal scrollbar appearing when the viewer opens. This is the defect the story exists to fix; if any rim survives, the story is not done.
- Confirm paging reaches the hidden images (AC5, AC6). The strip shows three thumbnails and a `+N`. Click the `+N` and page forward and back: every image in the collection must be reachable, including the fourth and beyond, and the position line at the bottom must track. Paging wraps at both ends by design.
- Check both orientations and both widths. Repeat with a portrait photo and a landscape photo, at a desktop width and at 390px. `objectFit: contain` should never crop either one.
- Judge the chevrons over the photo at 390px. From `sm` up, a 64px inset clears the 44px chevrons entirely. At `xs` the inset is 8px, so the chevrons deliberately sit *over* the photo rather than shrinking it — the same trade Story 6.11 made for the day hero, and they spread the same `ON_PHOTO_CHROME`. Note that DW-98 already records that treatment as unreadable over bright photography; check one bright photo and say whether it is worse here than on the hero.
- Judge the widened photo-strip row (DW-101). Making the `+N` indicator operable took it from an inline ~18px caption to a 44px minimum target, widening the strip row by roughly 26px. The row is flex with no wrap. On the narrowest timeline card at 390px, confirm the row still reads correctly and the indicator is not crowding the thumbnails. If it does, the fix is a smaller minimum with a padded hit area — not reverting it to inert text.
- Decide on the new close button. The four inline copies had none; click-to-close on the surrounding surface is kept, but it is undiscoverable on touch and unreachable by keyboard, and a single-image collection would otherwise have no focusable element at all. Confirm the top-right control reads correctly over a photo.
- Read DW-99 and decide whether it blocks. In `PhotoUploadField`'s gallery editor the remove button covers the upper-right quadrant of each 56px thumbnail — about 40% of the open target this story just turned into an advertised control. Aiming at the top-right of a photo to enlarge it deletes it. The geometry predates this story and fixing it changes a pinned mockup layout, so it was deferred rather than patched; confirm that is the right call by trying it.
- When the checks pass, tick Task 7's subtasks in this spec, set `status: done` in the frontmatter and `Status: done` in the body, and update `6-12-fullscreen-photo-viewer` in `sprint-status.yaml`.

_Appended by the bmad-loop orchestrator (`bmad-loop confirm`, #335): a human confirmed these external actions out of band, and the story was advanced from `awaiting-operator` to `done`._
