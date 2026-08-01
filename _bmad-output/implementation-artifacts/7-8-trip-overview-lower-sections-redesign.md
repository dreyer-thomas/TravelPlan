---
baseline_commit: 57c438d
---

# Story 7.8: Trip Overview Lower Sections — Bucket List, Trip Controls, and Import/Export Removal

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a trip planner,
I want the bucket list and the trip controls at the bottom of the trip overview to match the approved design, and the JSON import/export buttons removed from that page,
so that the overview reads as one consistent surface end-to-end instead of trailing off into two pre-redesign cards and two developer-facing actions.

## Acceptance Criteria

1. Given the trip-overview bucket-list panel and the `bucket-list` / `bucket-item` / `bucket-add` patterns already implemented for Day Detail in Story 7.3 (`TripDayBucketListPanel.tsx`), when `TripBucketListPanel.tsx` is restyled, then it uses the same `card` shell, `card-label` title, `bucket-item` rows with `:last-child` divider suppression, and a 24px circular add affordance inside a ≥44×44px hit area — reusing the established pattern rather than introducing a second visual treatment for the same feature; **and** the non-palette surface color `#f7f9fc`, the raw `borderColor: "divider"`, and the `warning.main`-colored add button are all replaced with token values (`tokens.cardAlt`, `tokens.border`, and the accent — see Dev Notes → "There is no `tokens.accent`") — warn is reserved exclusively for gap/open-item states per `DESIGN.md`; **and** its inline `SvgIcon` paths are replaced with the shared stroke icons from `TripIcons.tsx`.
2. Given the trip-controls block at the bottom of the trip overview, when it is restyled, then its container uses the token card treatment (`tokens.card`, `tokens.borderStrong`, 8px radius) instead of hardcoded `#ffffff` / `borderRadius: 3`; **and** "Reise löschen" uses the existing secondary button variant paired with its confirmation dialog, not MUI's default `color="error"` red (`#d32f2f`) — the palette defines no `error` entry, and `DESIGN.md` defines no destructive variant, so no new color is introduced by this story.
3. Given the "Import JSON" and "Export JSON" buttons currently rendered in that same controls block, when the trip overview renders, then neither button is present anywhere in the UI; **and** the underlying export/import API routes, dialogs, and logic remain intact and functional — this is a UI-entry-point removal, not a feature removal.
4. Given a viewer or contributor opens a trip, when the redesigned controls block renders, then the pre-existing defect where an ungated "Export JSON" button produced an owner-only 404 error is resolved by the button's removal; **and** `test/tripTimelineRoles.test.tsx` is updated to assert the absence of both import and export controls for every role, closing the gap where Export visibility was never asserted.
5. Given existing bucket-list functionality (add, edit, delete, add-to-day-plan) and trip controls (edit, delete), when the redesigned sections render, then all of it continues to work unchanged, including owner/contributor/viewer gating — apart from the import/export removal, this story is visual only.

## Tasks / Subtasks

- [ ] Task 1: Restyle `TripBucketListPanel.tsx` onto the `card` shell. (AC: 1, 5)
  - [ ] Replace the outer `Paper elevation={1} sx={{ p: 3, borderRadius: 3, background: "#ffffff" }}` (`TripBucketListPanel.tsx:390`) with a plain `Box` carrying the card treatment — `backgroundColor: tokens.card`, `border: "1px solid"`, `borderColor: tokens.borderStrong`, `borderRadius: "8px"`, `padding: "18px"`. Copy the shape from `TripDayBucketListPanel.tsx:30-38`, which is this story's reference implementation. **Use a `Box`, not a `Paper`** — the theme's `MuiPaper` override (`theme.ts:245-252`) stamps a non-token `border: 1px solid rgba(17, 18, 20, 0.08)` on every `Paper`, which would sit on top of the `borderStrong` rule. This is why 7.3 moved off `Paper` for the same card and why `TripTimeline`'s own sidebar cards (`TripTimeline.tsx:765`) are `Box`es.
  - [ ] Title: `Typography variant="h6" fontWeight={600}` → `variant="labelCaps" component="h5"` in `tokens.inkSoft` with `display: "block"`. **`component="h5"`, not `h6`** — see Dev Notes → "Heading levels differ between the two screens". Keep the `trips.bucketList.title` key unchanged.
  - [ ] Keep the count line (`entryCountLabel`, `trips.bucketList.countLine`) below the label, restyled to `11.5px/600` in `tokens.inkSoft`. A test asserts `getByText("2 entries")` is visible while collapsed (`test/tripBucketListPanel.test.tsx:51`).
  - [ ] Bring the loading / error / empty branches on-token (`tokens.inkSoft` body text, `Alert severity="error"` unchanged). The empty copy `trips.bucketList.empty` already matches `EXPERIENCE.md`'s recommended treatment — do not invent an empty-state component.
- [ ] Task 2: Rebuild the bucket rows as `bucket-item`. (AC: 1, 5)
  - [ ] Per row: `display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 9px 0; border-bottom: 1px solid tokens.border`, with the last row's rule suppressed via a **`:last-child` selector on the wrapper**, not a per-row hardcode. The current rows are 16px-padded, `borderRadius: 2`, `#f7f9fc`-filled tiles with a `borderColor: "divider"` frame (`:439-451`) — all three go. `#f7f9fc` is a cool-grey with no place in this warm palette; the mockup's row has **no fill at all**, only the bottom rule.
  - [ ] Name at `12.5px/700` in `tokens.ink`; description and location sub-lines at `11px/600` in `tokens.inkSoft` with `mt: "1px"`. Add `overflowWrap: "anywhere"` on all three, as `TripDayBucketListPanel` does — bucket titles are free text up to 120 chars and the row is `justify-content: space-between` against a fixed-width action cluster.
  - [ ] **Keep MUI `List`/`ListItem` semantics.** The rows are already a real list (`:436-491`) and 7.3's code review had to patch that exact regression back in on the Day Detail panel ("Bucket-list and cost-card rows dropped `<ul>/<li>` semantics for a `:last-child` border that works equally well on `ListItem`"). Apply the presentational treatment to the `ListItem` (or a `Box` inside it) without costing the list its role — a screen reader must still announce "list, N items". `:last-child` works the same on `ListItem`.
  - [ ] Keep the per-row edit and delete `IconButton`s and their `aria-label`s (`trips.bucketList.editAction`, `trips.bucketList.deleteAction`) exactly as they are functionally. They have **no depicted equivalent in any mockup** — the mockup's `bucket-item` has only the trailing "+" — so their retention and placement (trailing cluster, right of the text block) is a judgment call; record it as such in Dev Agent Record. Give each ≥44×44px (they are `size="small"`, ~28px today) using the padded-hit-area technique from `TripDayBucketListPanel.tsx:102-122`: a `width: 44, height: 44, padding: 0` `IconButton` wrapping a smaller visible glyph.
- [ ] Task 3: Replace the panel's inline SVG paths with shared stroke icons. (AC: 1)
  - [ ] `TripBucketListPanel.tsx` inlines four filled Material-style `path` sets: chevron-down/up (`:405-408`), plus (`:418`), pencil (`:476`), trash (`:486`). The design system is stroke-based (`fill="none"; stroke="currentColor"; strokeWidth={2}`) — see every glyph in `TripIcons.tsx`. Add the missing ones to `TripIcons.tsx` in that same style and prop shape (`{ sx }: IconProps`, `aria-hidden`, `viewBox="0 0 24 24"`): a **chevron-down** (reuse/rotate rather than duplicating `ChevronRightIcon` if that reads cleaner — either is fine, just do not ship two near-identical paths), a **plus**, a **pencil**, and a **trash** glyph. `TripDayBucketListPanel.tsx:125-128` already has a hand-rolled two-path plus — move that into `TripIcons.tsx` as `PlusIcon` and have both panels import it rather than leaving a third copy behind.
  - [ ] All four stay `aria-hidden`; each sits inside an `IconButton` whose `aria-label` already carries the meaning, which is the naming rule `TripIcons.tsx`'s header comment sets.
  - [ ] Do **not** widen the extraction beyond these glyphs. Other components still inline their own `SvgIcon`s; those belong to their own stories.
- [ ] Task 4: Restyle the panel-level add affordance. (AC: 1)
  - [ ] The `Add item` `IconButton` (`:411-420`) currently carries `sx={{ color: "warning.main", border: "1px solid", borderColor: "warning.main" }}`. **Warn is reserved for gap/open states** — `DESIGN.md`'s Do's and Don'ts and 7.2/7.3 both treat any other use as a defect. Replace with the `bucket-add` treatment: a **24px** circle, `border-radius: 50%`, `1px solid tokens.borderStrong`, `backgroundColor: tokens.card`, accent-colored "+" glyph — inside a **44×44px** `IconButton` hit area (`width: 44, height: 44, padding: 0`). Copy the nested-circle technique verbatim from `TripDayBucketListPanel.tsx:99-130`; `EXPERIENCE.md`'s Accessibility Floor names this affordance specifically as one that was previously undersized. Verify the computed box in dev tools, don't assume.
  - [ ] Accent color = `theme.palette.primary.main`. **`theme.palette.tokens.accent` does not exist** — read Dev Notes → "There is no `tokens.accent`" before you write this line. Do not add the token.
  - [ ] Keep the `aria-label`/`title` `trips.bucketList.addAction` ("Add item") — `test/tripBucketListPanel.test.tsx:86` clicks it by that name and asserts the add dialog opens.
  - [ ] Give the collapse/expand toggle the same 44px floor while you are in this cluster; keep its `aria-label` swapping between `trips.bucketList.expandAction` / `trips.bucketList.collapseAction` (two tests pin both strings).
  - [ ] **Do not touch the collapse behavior.** Default-collapsed with a visible count line is Story 4.4's shipped feature (`isCollapsed` initial `true`, `Collapse ... unmountOnExit`), and `test/tripBucketListPanel.test.tsx:40-73` pins that items are absent while collapsed and present after one click, with no refetch. This story restyles the shell, not the state machine.
  - [ ] Leave the add/edit and delete-confirmation `Dialog`s (`:499-590`) alone. Dialog internals are Story 7.7's surface and already pick up Story 7.1's theme-level `MuiDialog`/`MuiButton`/`MuiOutlinedInput` overrides.
- [ ] Task 5: Restyle the trip-controls block and remove the import/export entry points. (AC: 2, 3, 5)
  - [ ] `TripTimeline.tsx:843-871`: replace the `Paper elevation={1} sx={{ p: 3, borderRadius: 3, background: "#ffffff" }}` with the same card `Box` treatment used in Task 1 (`tokens.card` / `tokens.borderStrong` / 8px / 18px padding). Same `MuiPaper`-override reason as Task 1.
  - [ ] Delete the Import button (`:852-856`) and the Export button (`:857-859`) outright.
  - [ ] "Delete trip": drop `color="error"` (`:866`), keep `variant="outlined"`. The theme's `MuiButton.outlined` override (`theme.ts:266-271`) is already exactly `DESIGN.md`'s secondary button — `card` fill, `borderStrong` border, 700-weight ink text, 44px min-height — so this is a one-word deletion, not a restyle. Keep it wired to `setDeleteOpen(true)` and its existing `TripDeleteDialog` confirmation. **Do not** introduce a red/destructive variant: `theme.palette` has no `error` entry, so `color="error"` currently resolves to MUI's stock `#d32f2f`, which is the off-palette value this AC removes.
  - [ ] "Edit trip" keeps `variant="outlined"` and its `canEditPlanning` gate. Its accessible name must stay "Edit trip" — `test/tripHeroImage.test.tsx:87` and `:126` click it by that name.
  - [ ] **New edge case created by the removal: the controls card can now render empty.** Today Export renders for every role, so the block always has at least one child. After removal a **viewer** (`canEditPlanning === false`, `isOwner === false`) gets an empty 18px-padded bordered card. Guard the whole block on `canEditPlanning || isOwner` so nothing renders for a viewer, and cover it with a test (Task 7). This is the single most likely thing to be missed in this story.
- [ ] Task 6: Remove the now-dead import/export UI code and orphaned i18n keys. (AC: 3)
  - [ ] From `TripTimeline.tsx` delete: `handleExport` (`:356-371`), `extractAttachmentFilename` (`:329-342`), `triggerDownload` (`:344-354`), `handleImported` (`:323-327`), the `importOpen`/`setImportOpen` state, the `TripImportDialog` import (`:9`) and its render (`:886`). These are the UI layer, not "the underlying export/import logic" AC3 preserves — that is the API routes (`src/app/api/trips/[id]/export/route.ts`, `.../import/route.ts`) and `TripImportDialog.tsx` itself, all of which stay on disk and keep their own passing route tests (`test/tripExportRoute.test.ts`, `test/tripImportRoute.test.ts`, `test/tripImportDialog.test.tsx`). Leaving the helpers behind would fail lint as unused.
  - [ ] `handleImported` is the **only** `setSuccess` caller in this component. Once it goes, the `success` state and its `<Alert severity="success">` (`:393`) are dead too — remove both, or leave them only if you find another writer (grep first, then say which in Dev Agent Record). The `error` state stays; it has other writers.
  - [ ] Delete the orphaned keys from **both** `src/i18n/en.ts` and `src/i18n/de.ts` — `trips.export.action`, `trips.export.error`, and `trips.import.success`. Each has exactly one call site today, all three inside the code this task removes (verified by grep at baseline). **Keep `trips.import.action`** — `TripImportDialog.tsx:272` uses it for its own submit button; deleting it would break the dialog and two of its tests. Re-run the grep before deleting anything; 7.2's review found dead keys left behind after a rename and 7.3 established deleting orphans from both dictionaries as the convention.
  - [ ] `TripImportDialog.tsx` now has **zero production call sites** — reachable only from `test/tripImportDialog.test.tsx`. That is the intended consequence of AC3 ("dialogs remain intact"), not an oversight: keep the file and its tests, and record the state in `_bmad-output/implementation-artifacts/deferred-work.md` under a `Deferred from: 7-8-...` heading so the next reader does not delete it as dead code, and so the "no user-facing entry point exists until one is decided" note in `prd.md` FR33/FR34 has a matching implementation-side record.
- [ ] Task 7: Update and extend the test suite. (AC: 4, 5)
  - [ ] `test/tripBucketListPanel.test.tsx` — **this suite will start throwing.** It renders with a bare `I18nProvider` (`:43-47`, `:61-65`, `:79-83`) and no `ThemeProvider`; the moment the panel reads `theme.palette.tokens.*`, MUI's default theme has no `tokens` object and every render fails on `undefined`. Switch all three renders to the shared `renderWithProviders` helper (`test/helpers/renderWithProviders.tsx`). This is the identical trap 7.3 hit on `tripDayMapPanel.test.tsx`; it is listed here so it costs you a minute instead of a debugging session.
  - [ ] `test/tripBucketListPanel.test.tsx` — the three existing behaviors (default-collapsed + count line, expand reveals content without refetching, add icon opens the dialog) **must keep passing unchanged** apart from the provider swap. They are the canary for Task 4's "do not touch the collapse behavior".
  - [ ] `test/tripTimelineRoles.test.tsx:118` and `:149` — `queryByRole("button", { name: "Import trip" })` is **vacuous today**: the rendered label is `trips.import.action` = "Import JSON", so this assertion has never proved anything about the Import button, for any role. Fix the name **and** add the missing Export assertion, then extend both to the owner case:
    - viewer: neither "Import JSON" nor "Export JSON" present (existing test, `:106`)
    - contributor: neither present (existing test, `:134`)
    - **owner: neither present** — a new case. This is the assertion AC3/AC4 actually turn on; the two existing role tests would both pass even if the buttons still rendered for owners.
  - [ ] `test/tripTimelineRoles.test.tsx` — the `vi.mock` of `TripImportDialog` (`:20-22`) is no longer needed once the component stops rendering it. Removing it is optional cleanup; if you leave it, say so rather than letting it read as an oversight.
  - [ ] `test/tripTimelinePlan.test.tsx:422-475` (`shows export action and requests trip export endpoint`) and `:477-522` (`shows localized export error when download fails`) — **delete both.** They exercise UI this story removes; there is no assertion to preserve. Their behavioral intent survives at the API layer in `test/tripExportRoute.test.ts`. Verify that file actually covers the success path and the owner-only 404 before deleting, and state the result in Dev Agent Record — "the route test covers it" must be a checked fact, not an assumption.
  - [ ] **New coverage** — this story's own surfaces, which have none today:
    (a) a viewer renders **no** trip-controls card at all (Task 5's empty-card guard);
    (b) an owner renders both "Edit trip" and "Delete trip" in the controls card, and the Delete button does **not** carry MUI's error color class (`MuiButton-outlinedError`) — this is AC2's only mechanical assertion;
    (c) the bucket-list panel's add button resolves to a ≥44×44px box and no longer computes to `warning.main` — AC1's 44px floor and warn-reservation rule, asserted rather than eyeballed;
    (d) bucket rows render with the last row's `border-bottom` suppressed and the others present, so the `:last-child` rule is pinned against a future per-row regression;
    (e) the bucket list still exposes a real list role with N items after Task 2's restyle.
  - [ ] Run `npx vitest run` from `travelplan/`. Triage every failure as either a stale assertion encoding a pre-redesign detail (fix the assertion, and say so in Dev Agent Record) or a real regression (fix the implementation). Do not relax or delete assertions in bulk to get green. Also run `npx tsc --noEmit -p .` and `eslint` over the touched files, and report counts against the baseline the way Stories 7.1–7.3 did — establish the baseline with `git stash push --include-untracked` first, since there is a known pre-existing population (161 tsc errors, ~9 eslint warnings) unrelated to this work.
  - [ ] `npm run build` must stay clean.
- [ ] Task 8: Manual browser check on a real dev server, against a **throwaway** database. (AC: 5)
  - [ ] `prisma/dev.db` holds Tommy's own trip data — Stories 7.2 and 7.3 both established seeding an isolated SQLite file on an isolated port as the precedent. Do not run against `dev.db`.
  - [ ] Verify as **owner**: the bucket-list card matches the Day Detail panel visually (same shell, same row rhythm, same 24px circle), collapse/expand works, add / edit / delete all still round-trip, the count line updates, and the controls card shows Edit + Delete with no red.
  - [ ] Verify as **viewer** and as **contributor** (use the share flow to create them): no bucket-list panel for either, no Import, no Export, no empty controls card for the viewer, Edit present for the contributor only.
  - [ ] Confirm the export capability is still alive by hitting `/api/trips/{id}/export` directly as the owner — AC3 says the route stays functional, and the UI no longer proves it.

## Dev Notes

### Scope boundary

Visual/structural only, for the **two bottom blocks of the Trip Overview** plus the import/export entry-point removal:

- `TripBucketListPanel.tsx` — full restyle (Tasks 1–4).
- `TripTimeline.tsx:841-886` — the controls block, the import/export removal, and the dead-code cleanup that follows (Tasks 5–6).
- `TripIcons.tsx` — additive only (Task 3).

Do **not** touch:

- Anything above `TripTimeline.tsx:841` — the hero, stat strip, day-row list and sidebar cards are Story 7.2's finished work. This story does not re-open that layout.
- `TripDayBucketListPanel.tsx` beyond moving its inline plus glyph into `TripIcons.tsx` (Task 3). Story 7.3 is `done`.
- `TripsDashboard.tsx` (7.4), `TripShareDialog.tsx` (7.5), the auth screens (7.6), `TripCreateDialog.tsx` / `TripEditDialog.tsx` / `TripDeleteDialog.tsx` / `TripImportDialog.tsx` / the bucket-list add-edit dialog internals (7.7). Their trigger buttons live on this screen and must keep working; their *contents* are someone else's story, and they already pick up Story 7.1's theme-level overrides so they will not look broken.
- The export/import **API routes, repositories, schemas and validation**. Nothing server-side changes in this story. If a server change seems necessary, that is a signal the change belongs elsewhere.
- The `Alert severity="error"` convention at the top of the component. `EXPERIENCE.md` calls the error-banner treatment "not pixel-mocked — minimal convention only" and no AC covers it.

### There is no `tokens.accent` (read before Tasks 2 and 4)

The epic's AC names `tokens.accent` as a replacement value. **That token does not exist.** `theme.palette.tokens` (`theme.ts:6-19`, `:158-171`) contains exactly: `ink`, `inkSoft`, `inkMuted`, `border`, `borderStrong`, `card`, `cardAlt`, `paperOuter`, `accentSoft`, `travelNeutral`, `warnBg`, `warnBorder`. `accent` (`#4B6358`) and `accent-2` (`#7C9483`) are exposed as `theme.palette.primary.main` and `theme.palette.secondary.main` instead, and `warn` as `theme.palette.warning.main`.

Use `theme.palette.primary.main`, exactly as `TripDayBucketListPanel.tsx:110` does. **Do not add an `accent` key to the tokens object** to make the AC read literally — that is a theme-wide change with no AC behind it, and it would leave two names for one color. Note the correction in Dev Agent Record.

### Heading levels differ between the two screens (read before Task 1)

7.3's code review resolved this explicitly: card labels are **title + 1**, not a fixed tag.

- Trip Overview's title is `h4` (`TripTimeline.tsx:443`), so its card labels are `h5` (`TripTimeline.tsx:766`). **This panel is on Trip Overview → `component="h5"`.**
- Day Detail's title is pinned at `h5` by ~44 test assertions, so *its* card labels were re-levelled to `h6`. Copying `TripDayBucketListPanel.tsx:39`'s literal `component="h6"` would invert the outline on this screen.

And the reason `component=` must be passed at all: Story 7.1's custom typography variants (`display`/`heading`/`metricLg`/`cardTitle`/`kicker`/`labelCaps`) have **no `variantMapping` entry** — custom variants never do — so `<Typography variant="labelCaps">` renders a `<span>` unless you say otherwise. 7.2 and 7.3 each shipped a version of this bug before catching it.

### Current state of the two blocks (read at baseline `57c438d`)

**`TripBucketListPanel.tsx`** — 593 lines, owner-only, rendered once at `TripTimeline.tsx:841`. Full CRUD: fetches `/api/trips/{id}/bucket-list-items`, add/edit dialog with geocoding lookup, delete confirmation dialog, collapse/expand (Story 4.4). Everything below the shell keeps working untouched:

| Value | Where | Replace with |
|---|---|---|
| `Paper elevation={1}` + `borderRadius: 3` + `background: "#ffffff"` | `:390` | `Box` with `tokens.card` / `tokens.borderStrong` / 8px / 18px |
| `variant="h6" fontWeight={600}` title | `:394` | `variant="labelCaps" component="h5"`, `tokens.inkSoft` |
| `color: "warning.main"` + `borderColor: "warning.main"` add button | `:415` | 24px circle in a 44px hit area, `theme.palette.primary.main` glyph, `tokens.borderStrong` ring |
| `backgroundColor: "#f7f9fc"` | `:450` | no fill; the row carries only a `tokens.border` bottom rule |
| `borderColor: "divider"` + `borderRadius: 2` + `p: 2` tiles | `:447-449` | `bucket-item` rhythm: `padding: 9px 0`, `:last-child` divider suppression |
| filled Material `path` glyphs (chevron/plus/pencil/trash) | `:405-408`, `:418`, `:476`, `:486` | stroke glyphs in `TripIcons.tsx` |
| `size="small"` row `IconButton`s (~28px) | `:469-488` | 44×44px hit area, smaller visible glyph |

**`TripTimeline.tsx:843-871`** — the controls `Paper`. Four buttons, three gates: Import (`isOwner`), Export (**ungated** — the defect), Edit (`canEditPlanning`), Delete (`isOwner`, `color="error"`). `isOwner` / `canEditPlanning` are derived at `:117-118` and default to `true` when `accessRole` is absent.

Add no new hex literals. 7.2 left a standing deferred finding about hardcoded literals contradicting Story 7.1's token foundation; this story should shrink that debt, not grow it. There is no literal in this story's scope that `DESIGN.md` mandates as a literal — every value here has a token.

### The Export 404 is real, and this is the only fix in scope (read before Task 5)

Verified at baseline: `src/app/api/trips/[id]/export/route.ts:40-41` gates on `hasTripOwnerAccess(userId, tripId)` and returns **404 "Trip not found"** to anyone else. The button at `TripTimeline.tsx:857` has no `isOwner` guard, so a viewer or contributor clicking Export gets the `trips.export.error` banner ("Trip export failed. Please try again.") on a trip they are legitimately viewing. AC4 resolves this **by removing the button**, not by adding a gate — do not "improve" on that by gating instead. The whole point of AC3 is that no export entry point survives on this page.

### Why the two existing role assertions never caught it

`test/tripTimelineRoles.test.tsx:118` and `:149` query `{ name: "Import trip" }`. The rendered label is `t("trips.import.action")` = **"Import JSON"**. `queryByRole` for a name that never existed always returns `null`, so both assertions have been passing vacuously since the file was written. Export was never asserted at all, for any role. Task 7 fixes both and adds the owner case — that owner case is the only assertion in the suite that will actually fail if the buttons come back.

### Bucket-list pattern: same visual language, different feature surface

`TripDayBucketListPanel.tsx` is the reference for the *shell, rows, and 44px circle* — not for the feature. The two panels differ, deliberately:

| | Day Detail (`TripDayBucketListPanel`) | Trip Overview (`TripBucketListPanel`) |
|---|---|---|
| Data | props from parent | fetches its own, owns CRUD |
| Trailing row action | one "+" → add to this day | edit + delete icons |
| Panel-level action | none | "Add item" (the 24px circle) + collapse toggle |
| Collapse | none | default-collapsed, Story 4.4 |

So the mockup's `bucket-add` "+" circle maps to the **panel-level Add item button** here, and the row-level edit/delete cluster has no mockup equivalent at all. Keep both; the placement is a judgment call in the same class as 7.2's bucket-list positioning and 7.3's undepicted affordances. Note it rather than silently deciding it.

`EXPERIENCE.md:91` is worth reading before you decide the row is clickable: "`bucket-item`'s trailing '+' circle is a discrete add-to-day-plan action, separate from the row's own (non-existent) navigation — clicking the row text does nothing; only the '+' acts." Do not add row-level click targets on this screen either.

### i18n

Every string goes through `t()` / `formatMessage()`; do not introduce the first hardcoded exception. **This story needs no new keys** — every string it renders already exists. It removes three (Task 6) and keeps the rest.

Reuse, do not duplicate: `trips.bucketList.title`, `.countLine`, `.addAction`, `.expandAction`, `.collapseAction`, `.editAction`, `.deleteAction`, `.loading`, `.empty`, `.loadError`, `.locationMissing`, `trips.edit.open`, `trips.delete.open`. Check both dictionaries before touching any shared key.

### Responsive behavior

`EXPERIENCE.md` states this design pass mocked desktop only (~1080px). Follow the established idiom: MUI breakpoint objects in `sx` (`{ xs: ..., md: ... }`), no `useMediaQuery`. 7.2's review flagged the existing JS-side `data-layout` breakpoint re-derivation in this very file as a duplicated source of truth (deferred) — do not replicate that pattern in new code. The two blocks in this story are full-width single-column sections and need little more than letting the button row wrap (`flexWrap: "wrap"` is already on the controls block at `:851`).

### Project Structure Notes

Files this story is expected to touch:

- `travelplan/src/components/features/trips/TripBucketListPanel.tsx` — primary restyle target (Tasks 1–4).
- `travelplan/src/components/features/trips/TripTimeline.tsx` — controls block, import/export removal, dead-code cleanup (Tasks 5–6).
- `travelplan/src/components/features/trips/TripIcons.tsx` — additive: chevron-down, plus, pencil, trash (Task 3).
- `travelplan/src/components/features/trips/TripDayBucketListPanel.tsx` — import the shared `PlusIcon` instead of its inline copy (Task 3).
- `travelplan/src/i18n/en.ts`, `travelplan/src/i18n/de.ts` — remove three orphaned keys (Task 6).
- `travelplan/test/tripBucketListPanel.test.tsx` — `renderWithProviders` + new coverage (Task 7).
- `travelplan/test/tripTimelineRoles.test.tsx` — fix the vacuous assertions, add the owner case and the controls-card cases (Task 7).
- `travelplan/test/tripTimelinePlan.test.tsx` — delete the two export tests (Task 7).
- `_bmad-output/implementation-artifacts/deferred-work.md` — record `TripImportDialog`'s zero-call-site state (Task 6).

No new files, no new directories. This matches `architecture.md`'s Component Boundaries (feature components under `components/features/*`). No API, repository, schema, or validation change is in scope.

### Known epic-level FR discrepancies (non-blocking, flagged for the PM)

The epic's "**FRs covered:** FR7, FR8, FR30, FR31 (import/export UI removal affects FR25 and FR34)" has two errors, checked against `prd.md`:

- **FR31 was removed** on 2026-07-30 (comments/suggestions, discontinued with Story 5.9). It cannot be covered by this story.
- **FR25 is transport segments**, not export. The export FR is **FR33**. `prd.md:272-273` already carries the correct pairing — both FR33 and FR34 were annotated on 2026-08-01 with "capability retained and functional; UI entry point removed from the trip overview by Story 7.8".
- The bucket-list FRs are **FR35/FR36** (idea capture / assign to days), which the epic's list omits.

Corrected coverage for this story: **FR7, FR8, FR30, FR35, FR36**, with the UI-entry-point removal affecting **FR33 and FR34**. This is a documentation fix in `epics.md`, not an implementation change — it does not block development.

### References

- `_bmad-output/planning-artifacts/epics.md` → "Epic 7" → "Story 7.8" (lines 1703-1738; Story/AC text above copied from it, with the `tokens.accent` and FR corrections noted). Stories 7.1–7.3 (the foundation this builds on, lines 1553-1621) and 7.4–7.7 (explicitly out of scope, lines 1623-1701).
- `_bmad-output/planning-artifacts/prd.md` → FR7/FR8 (lines 222-223), FR30 (line 266), FR31 removed (line 267), FR33/FR34 with the 2026-08-01 Story 7.8 annotation (lines 272-273), FR35/FR36 (lines 277-278).
- `_bmad-output/planning-artifacts/ux-designs/ux-TravelPlan-2026-07-27/DESIGN.md` — front-matter `colors`, `rounded`, `spacing`, and the `components.card` (`radius`/`border`/`padding`/`bg`) and `components.button` (`minHeight: 44px`, primary vs. secondary) blocks; prose sections "Colors" (accent's reserved jobs), "Shapes" (circular elements incl. "the add-to-bucket-list button" at `rounded.full`), "Elevation & Depth" (flat and bordered), "Components → card" ("Used for cost summaries, map previews, the gap alert, the day map, **and the bucket list**"), "Components → button" (secondary = `card` fill + `border-strong` border, and the bare-text-action rule), "Do's and Don'ts" (44px floor as the single source of truth, warn reserved for gaps).
- `_bmad-output/planning-artifacts/ux-designs/ux-TravelPlan-2026-07-27/EXPERIENCE.md` — line 39 (bucket list is an embedded card using existing conventions, "no new visual language"), line 81 (empty bucket list `[ASSUMPTION]`), line 91 (only the "+" acts; the row has no navigation), line 106 (44px floor, "including the previously undersized bucket-list '+' affordance").
- `_bmad-output/planning-artifacts/ux-designs/ux-TravelPlan-2026-07-27/mockups/trip-overview-day-detail.html` — `.card` / `.card-label` at `:390-391`, `.bucket-list` / `.bucket-item` / `.bucket-item-name` / `.bucket-item-sub` / `.bucket-add` at `:577-603`, sample markup at `:1074-1090`. Note the bucket list is depicted on **Screen B only** — there is no Screen A bucket-list or trip-controls mockup, which is why AC1 points at 7.3's implementation as the pattern source rather than at a mockup region.
- `_bmad-output/implementation-artifacts/7-3-day-detail-redesign.md` — the immediately preceding story. Its **Task 8** is the bucket-list pattern this story reuses; its **Review Findings** carry three rules this story must re-apply rather than rediscover: keep `ul`/`li` semantics under a `:last-child` divider, card labels are title+1 (decision 5), and a component that starts reading `theme.palette.tokens.*` breaks any test rendering it without a `ThemeProvider`.
- `_bmad-output/implementation-artifacts/7-2-trip-overview-redesign.md` — Task 2 (lines 40, 179) explains why the bucket list and the action row sit as full-width sections below the two-column grid, and its Dev Notes (line 112) record the deliberate decision to leave both blocks as-is — which is precisely the debt this story clears.
- `_bmad-output/implementation-artifacts/deferred-work.md` → "Deferred from: code review of 7-2-trip-overview-redesign" (the hardcoded-literal debt this story must not grow) and "npm-audit-zero-vuln-gate" (the pre-existing `react-hooks/set-state-in-effect` warnings in `TripTimeline.tsx`, downgraded to `warn` — expect them in the baseline lint count, do not attribute them to this story).
- `travelplan/src/components/features/trips/TripBucketListPanel.tsx`, `TripDayBucketListPanel.tsx`, `TripTimeline.tsx`, `TripIcons.tsx` — read in full; every line reference above is drawn from these at baseline `57c438d`.
- `travelplan/src/theme.ts` — `tokens` declaration (`:6-19`) and values (`:158-171`), the `MuiPaper` border override (`:245-252`), the `MuiButton` root/outlined overrides (`:253-273`), and the custom typography variants without `variantMapping` (`:25-52`, `:185-222`).
- `travelplan/src/app/api/trips/[id]/export/route.ts:40-41` — the owner-only 404 gate behind AC4's defect.
- `travelplan/test/tripBucketListPanel.test.tsx`, `test/tripTimelineRoles.test.tsx`, `test/tripTimelinePlan.test.tsx`, `test/tripHeroImage.test.tsx`, `test/helpers/renderWithProviders.tsx` — the existing behavioral contracts this story must preserve or deliberately, visibly update (see Task 7).

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List

### Change Log

- 2026-08-01: Story created (create-story). Status: ready-for-dev.
