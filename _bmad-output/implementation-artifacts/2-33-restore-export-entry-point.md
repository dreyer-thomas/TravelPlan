---
authored_against: e058259
---

# Story 2.33: Restore the Export Entry Point on the Trip Overview

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip owner,
I want an export button back among the trip controls at the bottom of the trip overview,
so that I can download a backup without typing an API URL with an internal trip id.

## Acceptance Criteria

1. **Placement.** An export control sits in the trip-controls card beside "Reise bearbeiten" and "Reise löschen", in the same outlined button treatment. No second card, no new toolbar.
2. **It downloads.** Pressing it downloads the archive; it does not navigate away from the trip.
3. **Owner only.** It renders only for a user who passes the route's `hasTripOwnerAccess` gate. A contributor and a viewer see no export control.
4. **Test assertion deliberately inverted.** `test/tripTimelineRoles.test.tsx` currently asserts the *absence* of both import and export controls for every role. It is rewritten: export present for an owner, absent for contributor and viewer; import still absent for all three. The inversion is called out in the story's record.
5. **Feedback.** A photo-heavy export takes a moment and produces a file, not a page. The user gets an indication that something is happening, and a failure surfaces a message rather than failing silently.
6. **Import untouched.** "Backup importieren" stays exactly where Story 2.32 left it, on the trips list.
7. **Nothing else changes.** Edit, delete, their confirmation dialogs and the role gating around them behave as before. No route, format, schema or i18n contract change beyond the strings this control needs.

## Tasks / Subtasks

- [ ] **Task 1 — Add the control** (AC: 1, 2, 6)
  - [ ] The trip-controls card is in `TripTimeline.tsx` (`data-testid="trip-controls-card"`). **Story 6.10 moves it into the layout grid's left column** — read the file at your actual HEAD before quoting line numbers; the ones in this spec are from `e058259`.
  - [ ] Put the control in the same `Box display="flex" … flexWrap="wrap"` that holds edit and delete, as a third `Button variant="outlined"`.
  - [ ] Target `GET /api/trips/{tripId}/export`. It answers with `content-disposition: attachment; filename="trip-<slug>-<YYYY-MM-DD>.zip"`, so a plain anchor download is enough — no fetch-and-blob dance, and no new tab.
  - [ ] Do **not** touch the import control on the trips list (`TripsDashboard.tsx:329`).

- [ ] **Task 2 — Gate it** (AC: 3)
  - [ ] `export/route.ts:43-44` gates on `hasTripOwnerAccess` and answers **404**, not 403, to everyone else — deliberately, so a stranger cannot learn a trip exists. That means a shown-but-unauthorised button produces a bare "not found", which is precisely why Story 7.8 removed the old one.
  - [ ] Render it under the same condition the server enforces. The card already distinguishes `canEditPlanning` (contributors included) from `isOwner` — export needs **`isOwner`**, the narrower one. Using `canEditPlanning` would reintroduce 7.8's defect for contributors.
  - [ ] Check the card's own guard still holds: it renders when `canEditPlanning || isOwner`, so a contributor sees the card with edit but no export, and a viewer sees no card at all.

- [ ] **Task 3 — Feedback** (AC: 5)
  - [ ] A 16 MB archive took a noticeable moment to build in verification. Give the control a pending state while the download starts.
  - [ ] A plain anchor gives no error hook. If the story needs AC5's failure path, that argues for a fetch-and-object-URL download instead — decide which, and record the trade-off in the Dev Agent Record. Both are acceptable; silently doing neither is not.
  - [ ] Any new strings go into **both** dictionaries; `i18nDictionaries.test.ts` enforces parity. `trips.export.action` and `trips.export.error` were **removed** by Story 7.8 — check whether re-adding them under the same names is cleanest, or whether the removal should stay and new names are clearer.

- [ ] **Task 4 — Tests** (AC: 3, 4, 6)
  - [ ] Rewrite the role assertions in `test/tripTimelineRoles.test.tsx`: owner sees export, contributor does not, viewer sees no card. Import stays absent for all three.
  - [ ] Add an assertion that the control targets the export route for the trip being viewed, so a wrong-id regression is caught mechanically.
  - [ ] `npm test` green.

- [ ] **Task 5 — Manual check** (AC: 2, 3, 5)
  - [ ] Download a real archive as owner and confirm it opens as a ZIP with `trip.json` plus a `photos/` directory.
  - [ ] Sign in as a contributor and as a viewer and confirm neither sees the control.
  - [ ] Throwaway copy of `dev.db` on an isolated port — never `prisma/dev.db`. Recipe in `7-12-bucket-list-sidebar-card.md`'s Dev Notes.

## Dev Notes

### There is currently no way to export from the UI at all

Three stories produced this between them, each correctly within its own scope:

- **7.8** removed "Import JSON" and "Export JSON" from the trip-controls card. The export button was ungated, so a viewer or contributor pressing it got a bare 404. Removing it was the right call for that story; its AC even records the defect as "resolved by the button's removal".
- **2.31** rebuilt the export as a real ZIP archive and noted "no UI entry point" as a deliberate deferral.
- **2.32** kept the *import* reachable — "Backup importieren" on the trips list.

The result is asymmetric: import has a button, export has a URL. The only way to export today is typing `GET /api/trips/{id}/export` with an internal cuid in it. That is not a usable backup tool, and it leaves 2.31's format unreachable.

### Why `isOwner` and not `canEditPlanning`

The card renders for `canEditPlanning || isOwner`, and its two existing buttons split along that line: edit is `canEditPlanning` (contributors included), delete is `isOwner`. Export belongs with delete, because that is what the server enforces.

Whether a contributor *should* be able to export is a fair question and not this story's: it would be a change to `export/route.ts`'s gate, not to a button. If you want it, file it separately.

### The test inversion is the point, not a side effect

`test/tripTimelineRoles.test.tsx` asserts the absence of both controls for every role. Story 7.8 added that assertion deliberately, to close a gap where export visibility had never been asserted at all. This story inverts half of it.

That is legitimate — the reason for the absence (an ungated button) is gone once Task 2 lands — but it must read as a decision in the record, not as a test that someone loosened to make their change pass.

### Sequencing

After **Story 6.10**, which moves this exact card into the grid's left column. Landing this first would put a third button into a block that is about to move, and both stories would touch the same lines.

### Testing

Vitest 3.2 + Testing Library, jsdom, via `test/helpers/renderWithProviders.tsx`. `tripTimelineRoles.test.tsx` is the constraint and the file this story deliberately rewrites.

### Project Structure Notes

`src/components/features/trips/TripTimeline.tsx`, `src/i18n/en.ts` and `de.ts`, and `test/tripTimelineRoles.test.tsx`. No route, schema or format change — `GET /api/trips/{id}/export` is used exactly as it stands.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.33]
- [Source: travelplan/src/app/api/trips/[id]/export/route.ts:33-44] — the session guard and the 404-not-403 decision
- [Source: travelplan/src/components/features/trips/TripsDashboard.tsx:329] — the import control, which stays
- [Source: _bmad-output/planning-artifacts/epics.md#Story 7.8] — why the old button was removed
- [Source: _bmad-output/implementation-artifacts/2-31-complete-trip-backup-export-with-photos-travel-segments-and-bucket-list.md] — the ZIP format this exposes

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

### Change Log
