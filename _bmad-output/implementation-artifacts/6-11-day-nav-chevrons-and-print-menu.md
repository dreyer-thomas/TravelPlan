---
authored_against: 096291f
---

# Story 6.11: Day Navigation as Hero Chevrons, Print Into an Overflow Menu

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner opening a day on my phone,
I want previous/next to be chevrons on the day photo and print to live behind an overflow menu,
so that the day view stops spending a full toolbar row on three controls I rarely need.

## Acceptance Criteria

1. **Chevrons in the hero.** Previous/next render as chevron controls inside the day hero photo, one at each side, vertically centred, using `ON_PHOTO_CHROME` (`TripIcons.tsx:321`). Each keeps a ≥44×44px hit area and its existing accessible name (`trips.dayView.previousAria` / `nextAria`).
2. **Absent, not disabled.** On the first or last day the chevron for the missing direction is **not rendered at all** — no disabled control, nothing focusable in its place.
3. **Toolbar gone.** The flex row that held previous/next/print (`TripDayView.tsx:2061-2104`) is removed, not left as an empty container.
4. **Print behind an overflow menu.** Print moves into a new `⋯` overflow menu in the hero header, beside the day-image edit action, built from the same `Menu` / `MenuItem` treatment `HeaderMenu.tsx` uses.
5. **Global menu untouched.** `src/components/HeaderMenu.tsx` and `src/lib/navigation/authMenu.ts` are not modified.
6. **Print is not owner-gated.** The overflow renders without the `isOwner` guard that wraps the day-image edit action, so viewers and contributors keep print. The header's right slot renders correctly for owner (edit + overflow) and non-owner (overflow only).
7. **Print behaviour preserved.** It still targets `/trips/{id}/days/{dayId}/print` with `target="_blank"` and `rel="noopener noreferrer"`, and the menu closes on selection.
8. **Space reclaimed.** At a phone width the hero is followed directly by the day's content, with no toolbar band between them.
9. **No functional change.** The timeline, coverage bar, stays, travel segments, bucket list, map panel, costs and the print document itself are untouched.

## Tasks / Subtasks

- [ ] **Task 1 — Chevrons** (AC: 1, 2)
  - [ ] Render two chevron controls positioned inside the hero photo, left and right, vertically centred. Spread `ON_PHOTO_CHROME` for fill, border, hover and the white `Mui-focusVisible` ring — Story 7.11 verified that ring in a browser, so do not author a new one.
  - [ ] Size them 44×44 explicitly. `size="small"` on an `IconButton` renders ~28px; the theme's `minHeight` applies to `MuiButton`, not `MuiIconButton`. The day-image edit button beside them (`:1884`) already carries `sx={{ ...ON_PHOTO_CHROME, width: 44, height: 44 }}` — match it.
  - [ ] Keep `component={Link}` with the existing hrefs so they stay real navigations, not JS handlers.
  - [ ] `ChevronRightIcon` exists in `TripIcons.tsx`; a left-pointing one does not. Add it there rather than rotating the right one inline — the module is the established home and `IconProps` is now `SxProps<Theme>`.
  - [ ] Render **nothing** when `previousDay` / `nextDay` is absent. No disabled button, no placeholder, no reserved space.

- [ ] **Task 2 — Overflow menu** (AC: 4, 5, 6, 7)
  - [ ] Add a `⋯` `IconButton` to the hero header's right-hand `Box` (`:1874`), beside the day-image edit action, with `ON_PHOTO_CHROME`, 44×44 and an accessible name.
  - [ ] Open a MUI `Menu` from it with one `MenuItem` — print — using `trips.dayView.printAction` as its label and keeping `trips.dayView.printAria` on the trigger or the item.
  - [ ] The `MenuItem` is `component={Link}` to `/trips/${tripId}/days/${day.id}/print` with `target="_blank"` and `rel="noopener noreferrer"`, and closes the menu on click. `HeaderMenu.tsx:219` is the shape to copy.
  - [ ] **Do not touch** `HeaderMenu.tsx` or `authMenu.ts`. This menu belongs to the day page.
  - [ ] Place it **outside** the `isOwner` conditional. Print is a read action available to every role that can open the day; the edit action beside it is owner-only.

- [ ] **Task 3 — Clean up what the move leaves behind** (AC: 3)
  - [ ] Delete the toolbar `Box` at `:2061-2104` and its comment.
  - [ ] `TripDayView.tsx:1873-1874` carries: *"Rendered even when empty so the row keeps two flex children and space-between goes on pinning the trip button left for a non-owner."* Once the overflow is unconditional that box is never empty — re-read the comment and either delete it or correct it. A comment describing a workaround that no longer applies is worse than none.
  - [ ] Check whether `trips.dayView.previousAction` and `nextAction` (the visible labels) still have a reader. If not, remove them from **both** dictionaries; `i18nDictionaries.test.ts` enforces key parity. Keep the `*Aria` keys — the chevrons need them.

- [ ] **Task 4 — Tests** (AC: 1, 2, 4, 6, 7)
  - [ ] Update any suite asserting the old toolbar buttons by their visible labels.
  - [ ] Add: both chevrons render on a middle day; the previous chevron is absent on the first day and the next chevron on the last; the overflow renders for a non-owner; the print item carries `target="_blank"` and `rel="noopener noreferrer"`.
  - [ ] Assert the chevrons' hrefs point at the neighbouring days, so a swapped left/right is caught mechanically rather than by eye.
  - [ ] `npm test` green.

- [ ] **Task 5 — Manual check** (AC: 1, 6, 8)
  - [ ] jsdom lays nothing out, so chevron placement over the photo and the reclaimed vertical space need a browser. Check at 390px and desktop, as owner and as viewer.
  - [ ] Confirm the chevrons stay legible over a light photo and a dark one — that is what `ON_PHOTO_CHROME`'s translucent fill and white border are for, and the day hero shows arbitrary user photography.
  - [ ] Throwaway copy of `dev.db` on an isolated port, never `prisma/dev.db`. Recipe in `7-12-bucket-list-sidebar-card.md`'s Dev Notes.

## Dev Notes

### Why this exists

`TripDayView.tsx:2061-2104` renders a flex row of three controls below the hero — previous day, next day, print. Its own comment concedes the position was never designed: *"Undepicted by the mockup, which shows only the breadcrumb and back button — kept as its own slim toolbar rather than dropped."* On a phone that row is a band of chrome above the content the user came for. Tommy raised it after using the app on a real trip.

Both decisions this story needed were settled by him on 2026-08-01: the missing-direction chevron is **not rendered** (the controls sit inside the photo, so an absent one leaves no hole), and print goes into a **page-local overflow menu** rather than making the global `HeaderMenu` context-aware.

The argument for the page-local menu, recorded so it is not re-litigated: `HeaderMenu`'s items come from `getAuthMenuItems(authState)` (`HeaderMenu.tsx:58,209`), a list driven only by auth state. Print needs `tripId` and `day.id`. Story 5.8's spec deliberately kept `authMenu.ts` free of page-specific entries because a globally visible entry dangles for users it does not apply to — the same reasoning applies here, since print is meaningless on every non-day page.

### This story re-touches what Story 6.9 just rebuilt

Story 6.9 (`096291f`) reworked this exact header: it deleted the breadcrumb, moved "back to trip" into the left slot with `ON_PHOTO_CHROME` at `minHeight: 48` and `paddingInline: 22px`, and kept the day-image edit action in the right slot. Read that header as it stands now (`:1855-1890`) before changing anything — the line numbers in this spec are from `096291f` and are locators, not addresses.

Two of 6.9's choices are load-bearing here:

- The hero header is a `space-between` row. This story adds a second child to its right slot; the left slot's single button stays where it is.
- The right slot is deliberately rendered even when empty. That workaround exists only because the edit action is owner-only. An unconditional overflow makes it moot — see Task 3.

### Traps

**1. The `isOwner` guard.** The edit action is owner-only; print is not. Placing the overflow inside the same conditional silently removes print for viewers and contributors — a capability regression disguised as a layout change, and no existing test would catch it because print has never been role-tested.

**2. `IconButton` has no theme `minHeight`.** `theme.ts` sets `minHeight: 44` on `MuiButton` only. Story 7.11's `Mui-focusVisible` ring is also `MuiButton`-scoped, which is why `ON_PHOTO_CHROME` carries its own — see DW-71's sibling finding about `MuiIconButton` having no focus ring at all. Size and focus both need to be explicit here.

**3. Left/right is easy to get backwards** and reads as correct in a screenshot. Task 4 asserts the hrefs for that reason.

**4. Do not restyle the print document.** `/trips/{id}/days/{dayId}/print` and `TripDayPrintPage.tsx` are Story 6.8's and are untouched. This story changes only how you get there.

### Testing

Vitest 3.2 + Testing Library, jsdom, via `test/helpers/renderWithProviders.tsx`. `tripDayViewLayout.test.tsx` is the main constraint and was heavily reworked by 6.9 — read it before adding to it. Chevron placement over photography and the reclaimed vertical space (AC1 partly, AC8) are browser-only.

### Project Structure Notes

Files touched: `src/components/features/trips/TripDayView.tsx`, `src/components/features/trips/TripIcons.tsx` (a left chevron), possibly `src/i18n/en.ts` and `de.ts` (removing two now-unused label keys), and the affected suites. No route, API or schema change. `HeaderMenu.tsx` and `authMenu.ts` are explicitly out of bounds.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 6.11]
- [Source: travelplan/src/components/features/trips/TripDayView.tsx:1855-1890] — the hero header as 6.9 left it
- [Source: travelplan/src/components/features/trips/TripDayView.tsx:2061-2104] — the toolbar to remove
- [Source: travelplan/src/components/features/trips/TripIcons.tsx:321-327] — `ON_PHOTO_CHROME`
- [Source: travelplan/src/components/HeaderMenu.tsx:200-225] — the `Menu` / `MenuItem` shape to copy
- [Source: _bmad-output/implementation-artifacts/5-8-view-all-registered-system-users.md] — why `authMenu.ts` stays free of page-specific entries

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

### Change Log
