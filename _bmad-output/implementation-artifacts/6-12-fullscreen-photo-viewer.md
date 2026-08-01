---
authored_against: 096291f
closes_deferred: [DW-30, DW-51]
---

# Story 6.12: One Fullscreen Photo Viewer — Correct Coverage, Paging, Keyboard Access

Status: ready-for-dev

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

- [ ] **Task 1 — Build the shared viewer** (AC: 1, 2, 3, 4, 5, 8, 9)
  - [ ] Create it in `src/components/ui/`, alongside `DialogShell.tsx` — that directory is Story 7.7's home for shared chrome.
  - [ ] Props: the image collection (`{ id/key, imageUrl, alt }[]`), the index to open at, and an `onClose`. Not a single URL.
  - [ ] **Coverage:** put the dark surface on the dialog itself rather than on a `DialogContent` inside it, so there is one surface and not two. MUI's `Dialog` already renders a backdrop; the current code paints `rgba(0,0,0,0.85)` on the content *on top of* that default `rgba(0,0,0,0.5)`, which is where the rim comes from. `fullScreen` plus a dark paper, or a styled backdrop with a transparent paper, both work — pick one and say which in the Dev Agent Record.
  - [ ] Do not size anything with `100vw`. It includes the scrollbar width on pointer devices, which is the second half of the reported defect.
  - [ ] Keep the image at `objectFit: "contain"` so it is never cropped, and keep click-to-close on the surrounding surface with `cursor: zoom-out` — that behaviour is fine and users have it today.
  - [ ] Paging controls: previous/next, plus arrow keys. Decide wrap-or-stop and apply it identically at both ends.
  - [ ] Position indicator: `trips.gallery.imageAlt` already interpolates `{index, total}` and `PhotoUploadField` uses it — reuse that key or add a sibling rather than composing a new string inline.

- [ ] **Task 2 — Key handling and focus** (AC: 8)
  - [ ] Every copy today carries `onKeyDown={() => setFullscreenImage(null)}` on the `Dialog` — **any** key closes it, Tab included. Replace with a handler that acts on `Escape` and the arrow keys only.
  - [ ] MUI's `Dialog` traps focus and restores it to the opener by default. Verify that still holds once the blanket `onKeyDown` is gone — the current handler is what breaks Tab inside the viewer today.
  - [ ] The paging controls must be reachable by keyboard and have accessible names.

- [ ] **Task 3 — Thumbnails in `MiniImageStrip`** (AC: 6, 7)
  - [ ] `TripDayPlanItemContent.tsx:149-200`. The thumbnails are `<Box component="img">` with `onClick` and `cursor: pointer` and nothing else — no `role`, no `tabIndex`, no key handler.
  - [ ] Make each operable by keyboard. An `<img>` is not natively interactive; prefer wrapping each in a real `<button>` over bolting `role="button"` onto the image — Story 6.9 hit exactly this and had to rebuild a `role="button"` construction because it made the element's contents presentational.
  - [ ] Change `onImageClick(imageUrl, alt)` to hand over the index, and update all nine call sites.
  - [ ] The `+N` indicator (`:192-196`) is a `Typography` today. Make it open the viewer at the first hidden image — index 3.
  - [ ] Do **not** change the three-thumbnail cap or the strip's layout. AC10 keeps it as it is; paging is what makes the rest reachable.

- [ ] **Task 4 — Thumbnails in `PhotoUploadField`** (AC: 7)
  - [ ] `src/components/forms/PhotoUploadField.tsx:207-230`. Same defect, same fix.
  - [ ] This one serves three surfaces — the accommodation gallery, the day-plan gallery and the day-details preview. Fixing only `MiniImageStrip` leaves all three behind, which is why DW-51 exists separately from DW-30.
  - [ ] Its `PhotoPreview.onOpen?: () => void` is a per-image closure. Reshape so the viewer receives the collection and an index; keep `onOpen` optional, since a read-only preview may have none.

- [ ] **Task 5 — Convert the call sites** (AC: 1, 2)
  - [ ] Nine `setFullscreenImage({...})` sites across four files. Each now passes the collection it already holds plus the clicked index.
  - [ ] Delete the four inline `Dialog` blocks and the `fullscreenImage` state each file carries.
  - [ ] `TripDayMapFullPage.tsx` has two call sites (`:486`, `:499`) inside the marker dialog. Story 7.9 AC5 deliberately left that dialog unrestyled; this story changes how the viewer is invoked from it, not how the dialog looks.

- [ ] **Task 6 — Tests** (AC: 3, 5, 6, 7, 8)
  - [ ] There is no test file for the viewer or the strip today. Add one for the shared component: it opens at the given index, pages forward and back, states its position, closes on `Escape` only, and does **not** close on Tab or an arbitrary key.
  - [ ] Assert both thumbnail components expose a focusable control per image with an accessible name, and that the `+N` indicator is operable.
  - [ ] `formPrimitives.test.tsx` covers `PhotoUploadField` — extend rather than duplicate.
  - [ ] `npm test` green.

- [ ] **Task 7 — Manual check** (AC: 3, 4, 5)
  - [ ] jsdom neither lays out nor paints, so the coverage defect — the whole reason for this story — cannot be seen there. Open a photo on an activity with **four or more** images and confirm: one uniform dark surface, no lighter rim, no horizontal scrollbar, and paging reaches the images the strip does not show.
  - [ ] Check at desktop with a visible scrollbar and at 390px, and on a portrait and a landscape photo.
  - [ ] Throwaway copy of `dev.db` on an isolated port — never `prisma/dev.db`. Recipe in `7-12-bucket-list-sidebar-card.md`'s Dev Notes.

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

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

### Change Log
