---
baseline_commit: c111d8e
---

# Story 16.6: My Part of the List

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a traveller who splits the packing with the others by area (one takes Technik, the other Kleidung),
I want to narrow the trip's packing list to my categories,
so that a long list shows only what I am responsible for, and "Noch offen" tells me what is left for me.

*Added 2026-11-08 at Tommy's request (John/PM). FR covered: FR58 (category filter, amended 2026-11-08). Depends on Story 16.1 (done, `c111d8e`). Sequenced directly after 16.2 (done, **not yet committed** — its changes sit in the working tree on top of `c111d8e`, so build on the working tree, not on the commit), before 16.3. Source: `epics.md` → Epic 16 / Story 16.6; `prd.md` FR58.*

## Acceptance Criteria

1. **Chips.** On the packing list page (`/trips/[id]/packing`), when the list has **two or more category groups**, a row of category chips sits next to (directly below) the existing "Alle" / "Noch offen" toggle: one chip per group, with the **same groups, labels and order** as the list itself (`groupPackingItems`, including "Sonstiges" / "Other" for items without a category, last). With one group (or an empty list) no chips are shown.
2. **No selection = everything.** With no chip selected every category is shown (today's behaviour, unchanged).
3. **Multi-select.** Tapping a chip toggles it; several can be selected at once. Only the groups of the selected categories are shown.
4. **Clear.** An "Alle Kategorien" / "All categories" action, the first chip of the row, clears the selection; it is shown as selected while nothing else is.
5. **Phone width.** The chip row scrolls horizontally instead of wrapping into several rows (no horizontal page scroll), and every chip is at least 44 px tall.
6. **Combines with "Noch offen".** Category selection and the "Noch offen" filter apply together (selected categories AND not packed). When nothing is left to show with a selection active, the "all packed" text reads "In deiner Auswahl ist alles eingepackt." / "Everything in your selection is packed." (without a selection the existing "Alles eingepackt." / "Everything is packed." stays).
7. **Selection progress [default].** With a selection active the trip-wide progress line in the header stays exactly as it is, and a second line below it shows the progress of the selected groups: "Auswahl: 3 von 7 eingepackt" / "Selection: 3 of 7 packed". Counted over all items of the selected groups, regardless of the "Noch offen" filter. No second line without a selection.
8. **Remembered per trip.** The selection is remembered per viewer in the browser, **per trip**, with guarded storage access like the existing filter (a throwing `localStorage` must not break the page; the choice is then simply not remembered).
9. **Vanished categories.** A remembered category that no longer exists on the list is ignored; if none of the remembered ones exists, all categories are shown. Matching ignores case — it uses the group keys of `groupPackingItems` (lower-cased, NFC, `null` for "Other").
10. **Add-form prefill [default].** For owner and contributor, when exactly one category is selected the add form's category field is prefilled with that group's label (empty for the "Other" group); it can still be changed.
11. **Added outside the selection stays visible [default].** An item that is added (new, or an existing one reported back as "already on the list"), or recategorized in the edit dialog, into a category outside the selection stays visible for now (its group is shown with that item), without changing the remembered selection — as the existing filter already does for a packed duplicate. The reveal ends when the selection is changed.
12. **Viewer.** A viewer sees and uses the chips too; it changes nothing on the list (no write).
13. **Tests** cover: no selection, one and several categories, the "Other" group, combination with "Noch offen" (including the selection's all-packed text), the selection's progress line, the remembered selection per trip including a vanished category, a single category hiding the chips, the add-form prefill, the added-outside-the-selection case (add and recategorize), and a viewer using the filter.

**Out of scope:** a per-person assignment of categories or items ("who packs what" stays out, as ruled for Epic 16); a category filter on the day's "Take along" section; filtering in the day email or the connector; any API, repository, schema or backup change.

## Tasks / Subtasks

- [x] **Task 1: Pure selection rules** (AC: 1, 9)
  - [x] In `src/lib/trips/packingList.ts` add `resolvePackingCategorySelection(stored: readonly (string | null)[], groupKeys: readonly (string | null)[]): (string | null)[]` — answers the stored keys that exist among `groupKeys`, in group order, de-duplicated; **empty when `groupKeys.length < 2`** (no chips → no filter, AC 1). Stored keys are compared after `toLowerCase()` (they are already lower-cased when written; lower-casing again makes a hand-edited or older value harmless).
  - [x] Unit tests in `test/packingList.test.ts`: subset kept in group order, vanished key dropped, all vanished → `[]`, `null` ("Other") kept when the Other group exists, duplicates collapsed, fewer than two groups → `[]`, case-insensitive match.
- [x] **Task 2: Storage** (AC: 8, 9)
  - [x] In `TripPackingList.tsx`, next to `PACKING_FILTER_STORAGE_KEY`, export `packingCategoryStorageKey = (tripId: string) => \`travelplan.packingList.categories.${tripId}\``.
  - [x] `readStoredCategories(tripId): (string | null)[]` — `try { JSON.parse(getItem) }`; accept only an array, keep entries that are `string` or `null`; anything else (missing, malformed JSON, wrong shape, throwing storage) → `[]`.
  - [x] `storeCategories(tripId, keys)` — `setItem(key, JSON.stringify(keys))` in `try/catch` (clearing writes `[]`). Same comment style as `storeFilter`.
  - [x] Read it in the load effect right where `setFilter(readStoredFilter())` runs (after mount, never during render — same hydration reason as the comment at that line). `tripId` is already a dependency of that effect.
- [x] **Task 3: Filtering, chips, progress line** (AC: 1–7, 12)
  - [x] State: `storedSelection: (string | null)[]` (what the viewer chose) and `revealedIds: Set<string>` (AC 11, session only). Derive `selection = resolvePackingCategorySelection(storedSelection, groups.map(g => g.key))` with `useMemo`. Never write the derived value back to storage on its own (a vanished category must be ignored, not erased — it may come back).
  - [x] Extend `visibleGroups` (currently `TripPackingList.tsx:269-271`): a group passes the category step if `selection` is empty or contains `group.key`; otherwise it contributes only items in `revealedIds`. Then apply the existing `filter === "open"` step to what remains, and drop empty groups as today. Keep the group heading count (`group.packed/group.total`) group-wide, unchanged.
  - [x] `toggleCategory(key)`: new list = add or remove `key` from `selection` (the effective one, so vanished keys are pruned the moment the viewer touches the chips), `setStoredSelection`, `storeCategories`, clear `revealedIds`, and apply the prefill (Task 4). `clearCategories()`: `[]`, store, clear `revealedIds`.
  - [x] Render, only when `!loadError && groups.length >= 2`, directly below the `ToggleButtonGroup`: a `Box` with `role="group"`, `aria-label={t("trips.packingList.categoryFilterLabel")}`, `data-testid="packing-category-chips"`, `display: flex`, `flexWrap: "nowrap"`, `gap: 1`, `overflowX: "auto"`, `minWidth: 0`, `maxWidth: "100%"`, a little bottom padding so the scrollbar does not clip the chips. Children: first the "All categories" chip, then one MUI `Chip` per group (`label={group.label}`, React `key` with the same prefix scheme as the groups: `category:${key}` / `none`).
  - [x] Chip: `clickable`, `onClick`, `aria-pressed={selected}`, `variant={selected ? "filled" : "outlined"}`, `color={selected ? "primary" : "default"}`, `sx={{ height: TOUCH_TARGET_PX, flex: "0 0 auto", borderRadius: "22px" }}` (MUI's default chip height is 32 px — the explicit height is the 44 px rule of DESIGN.md, not decoration). Chip labels never truncate (`"& .MuiChip-label": { whiteSpace: "nowrap" }` — the row scrolls instead).
  - [x] Selection progress: when `selection.length > 0`, under `packing-progress` render `data-testid="packing-selection-progress"` with `formatMessage(t("trips.packingList.selectionProgress"), { packed, total })` over all items of the selected groups (not the revealed extras, not affected by "Noch offen"). Same typography as the trip-wide line.
  - [x] All-packed text (`TripPackingList.tsx:583-587`): `selection.length > 0 ? t("trips.packingList.allPackedSelection") : t("trips.packingList.allPacked")`.
- [x] **Task 4: Prefill and reveal** (AC: 10, 11)
  - [x] Prefill: when a chip change (or the initial load's restored selection) leaves exactly one effective category, `setCategory(group.key === null ? "" : group.label)`. Do it in the handlers / the load step, **not** in a `useEffect` over `selection` — an effect would overwrite what the person typed whenever `items` changes (every add/tick recomputes `groups`). Other selection sizes leave the field as it is. Viewers have no form; harmless.
  - [x] Reveal on add: in `handleAdd`, after `upsertItem(item)`, if `selection` is non-empty and the item's group key (`normalizePackingCategory(item.category)?.toLowerCase() ?? null`) is not in it, add `item.id` to `revealedIds`. This covers both the new item and the `existed` path (which already highlights and scrolls — without the reveal the highlight would scroll to a row that is not rendered).
  - [x] Reveal on edit: in `handleSave`, same check against the returned item.
  - [x] `normalizePackingCategory` is already exported from `@/lib/trips/packingList`; add it to the import. Do **not** hand-roll lower-casing of `item.category` (it would miss trim/NFC and the "Sonstiges"/"Other" → `null` folding that the grouping does).
- [x] **Task 5: i18n** (AC: 4, 6, 7)
  - [x] Add to both `src/i18n/de.ts` and `src/i18n/en.ts`, next to the other `trips.packingList.*` keys (de ~384-412, en ~405-433):
    - `trips.packingList.categoryFilterLabel`: "Kategorien" / "Categories"
    - `trips.packingList.allCategories`: "Alle Kategorien" / "All categories"
    - `trips.packingList.selectionProgress`: "Auswahl: {packed} von {total} eingepackt" / "Selection: {packed} of {total} packed"
    - `trips.packingList.allPackedSelection`: "In deiner Auswahl ist alles eingepackt." / "Everything in your selection is packed."
  - [x] If the project has an i18n key-parity test, it must stay green (both dictionaries gain the same keys).
- [x] **Task 6: Component tests** (AC: 13) in `test/tripPackingList.test.tsx`, a new `describe("TripPackingList category filter (Story 16.6)")` reusing `item()`, `installApi()`, `rowNames()` and the existing `beforeEach` (`localStorage.clear()`):
  - [x] no selection shows every group and no selection-progress line; "All categories" is pressed
  - [x] one chip → only that group's rows; `aria-pressed="true"` on it; selection-progress shows its counts
  - [x] two chips → both groups; toggling one off again removes it
  - [x] the "Other" chip (item without category) filters to the Other group, label "Other", last in the row
  - [x] chip order and labels equal the group headings' order and labels (mixed-case categories, e.g. "technik" and "Technik" form one chip)
  - [x] with "Not packed yet": selected AND unpacked only; all selected packed → "Everything in your selection is packed."
  - [x] remembered: select, unmount, render again → restored; stored under `packingCategoryStorageKey("trip-1")`; a second trip (`trip-2`) does not see it
  - [x] vanished: storage pre-seeded with `["kleidung", "gone"]` → only Kleidung selected; seeded with only `["gone"]` → all shown, no progress line; malformed JSON → all shown
  - [x] a throwing `localStorage` (copy the existing "survives a throwing localStorage" setup) → chips still work
  - [x] one group only → no `packing-category-chips`, even with a stored selection, and no selection-progress line
  - [x] prefill: select exactly one chip as owner → the category input shows its label; the Other chip → empty; selecting a second chip leaves the field as it was
  - [x] added outside: with "Clothing" selected, add "Charger" in "Electronics" → row visible; storage still `["clothing"]`; touching a chip ends the reveal. Same for recategorizing an item to an unselected category in the edit dialog, and for an `existed` duplicate in an unselected group (row visible and highlighted)
  - [x] viewer: chips present and filter the rows; no write calls (`writes()` empty)
  - [x] German: "Alle Kategorien" and "Auswahl: … eingepackt" (copy the existing "speaks German" setup)
- [x] **Task 7: Verify** — `npm run typecheck`, `npm run lint` (0 errors), the full suite (`npx vitest run`), `npm run build`. Baseline after 16.2: 268 files / 4265 tests green — re-measure, do not assume.

### Review Findings

- [x] [Review][Patch] An item added or recategorized can vanish at once when it creates the second group (stored selection becomes active again after the save); the reveal check reads the effective selection from before the request. Decide against the stored selection instead, and add a test for the 1 → 2 group case [travelplan/src/components/features/trips/TripPackingList.tsx:359]
- [x] [Review][Patch] A language switch re-runs the load effect (deps `[t, tripId]`), so the "prefill once" step overwrites what was typed in the category field; prefill only when the trip changes [travelplan/src/components/features/trips/TripPackingList.tsx:246]
- [x] [Review][Patch] Ticking an item that someone else moved outside the selection makes the row vanish mid-tap; reveal it in `handleToggle` as well, the same way add and edit do [travelplan/src/components/features/trips/TripPackingList.tsx:418]
- [x] [Review][Patch] The comment on the load-time grouping is wrong: group order uses `Intl.Collator(locale)`. The code is only correct because it looks groups up by key [travelplan/src/components/features/trips/TripPackingList.tsx:247]
- [x] [Review][Patch] `resolvePackingCategorySelection`: the `indexOf(key) === index` check de-duplicates group keys that are already unique (the stored duplicates are handled by the Set), so drop it [travelplan/src/lib/trips/packingList.ts:135]
- [x] [Review][Defer] A restored selection whose chip sits off-screen in the scrolling row is not scrolled into view, so a filtered list can show no visible reason [travelplan/src/components/features/trips/TripPackingList.tsx:686] — deferred as DW-440, enhancement beyond the ACs
- [x] [Review][Defer] Per-trip `travelplan.packingList.categories.<tripId>` keys are never removed when a trip is deleted or access is lost [travelplan/src/components/features/trips/TripPackingList.tsx:89] — deferred as DW-441, small per-viewer leftovers only

## Dev Notes

### Shared Epic 16 rules (apply verbatim)

- An item without a category is shown under "Sonstiges" (de) / "Other" (en). Categories sorted alphabetically, "Other" last; the chip row follows the same order because it is built from the same `groups` array.
- All UI text exists in German and English.
- Writes go through `packingListRepo` — **this story has no writes**. The filter is purely client-side view state; no API, repo, validation, schema, migration or backup change. If you find yourself editing `src/app/api/**` or `packingListRepo.ts`, stop.

### Current state (read these first)

- `src/components/features/trips/TripPackingList.tsx` (783 lines, with 16.2's working-tree changes): the only file with real changes.
  - `Filter = "all" | "open"`, `PACKING_FILTER_STORAGE_KEY = "travelplan.packingList.filter"` (global, not per trip), `readStoredFilter`/`storeFilter` guarded with `try/catch` (`:64-83`). The new storage follows exactly this pattern but is **per trip** (AC 8 — each trip has its own categories).
  - Load effect `:186-218` restores the filter after mount (hydration comment at `:204-205`). Restore the category selection at the same spot.
  - `groups = useMemo(groupPackingItems(items, t("trips.packingList.other"), locale))` `:267`; `visibleGroups` `:269-271`; `changeFilter` `:273-276`.
  - `handleAdd` `:278-310`: on `existed` with a packed item under "open" it calls `setFilter("all")` **without** `storeFilter` — the precedent for AC 11 (show for now, don't touch the remembered choice). Note `setName("")` but the category is kept after an add (16.1 test "keeps the category") — the prefill must not break that.
  - `handleSave` `:351-374` (edit dialog save).
  - Header: `title` + `packing-progress` `:494-501`; add form `:505-544`; `ToggleButtonGroup` `:557-575`; empty `:577-581`; all-packed `:583-587`; groups `:589-699`.
  - `TOUCH_TARGET_PX = 44` `:94` — reuse it.
- `src/lib/trips/packingList.ts`: `normalizePackingCategory` (trim, NFC, empty/"sonstiges"/"other" → `null`), `groupPackingItems` (group `key` = lower-cased normalized category or `null`; `label` = first spelling met, or the localized "Other"). The group key is the selection identity — never the label (labels differ by language for "Other" and by first-met spelling for the rest).
- `src/components/features/trips/TripDayPackingSection.tsx` (16.2) also groups items — **do not** add the filter there (out of scope).

### Design decisions taken in this story (keep them)

- **Identity = group key**, stored as a JSON array of `string | null` (`null` = "Other"). JSON keeps `null` natively; no sentinel string that a category could collide with.
- **Effective selection is derived, never written back** except when the viewer touches the chips. A category emptied by a delete (or renamed) disappears from the effective selection; if it comes back the remembered choice applies again. When all remembered ones vanish, everything is shown (AC 9).
- **Fewer than two groups → no chips and no filter** (`resolvePackingCategorySelection` answers `[]`), so a single-category list never shows a stale "Selection:" line with no visible way to clear it.
- **Reveal set, not filter mutation.** AC 11 is a session-only `Set` of item ids that bypass the category step (not the "open" step — the existing duplicate path already switches "open" off for a packed duplicate). Cleared on any chip change. Revealed items do not count in the selection progress line.
- **Prefill in handlers, not effects** (see Task 4).
- **Chips are MUI `Chip` with `aria-pressed`**, in a `role="group"` container, not a second `ToggleButtonGroup`: the epic's wording is "chips", the row must scroll (a `ToggleButtonGroup` joins borders and does not scroll nicely), and `aria-pressed` gives the same toggle semantics to screen readers. Selected = filled primary (`colors.accent`), unselected = outlined default. Do **not** use `warnBg` for anything here (DESIGN.md reserves warn for the gap state; on this page it is the duplicate highlight).

### UX notes

- Placement: title → progress (+ selection line) → add form → notices → "Alle / Noch offen" toggle → **chip row** → groups. The chip row sits right under the toggle so both filters read as one control area.
- One-handed on the phone: chips 44 px tall, horizontal scroll with `overflowX: auto` inside the card; the card already has `minWidth: 0` so the row cannot widen the page. Check at 390 px in the browser that there is no page-level horizontal scroll.
- `ux-design-specification.md` / DESIGN.md: 44 px floor for every interactive element (doc-chip rule); pills on `pillNeutral`/`accentSoft` exist, but MUI's `primary` filled chip is the clearest "selected" signal and uses the accent token.

### Testing

- Vitest + Testing Library, jsdom, `renderWithProviders`, `stubFetch`/`mockFetchResponse` (`test/helpers/`). Query chips by role and name: MUI clickable `Chip` renders `role="button"`, so `screen.getByRole("button", { name: "Electronics" })` and assert `toHaveAttribute("aria-pressed", "true")`. Beware a name clash with an item named like a category — use distinct names in fixtures.
- The "Not packed yet" toggle is also `role="button"` (ToggleButton); scope chip queries with `within(screen.getByTestId("packing-category-chips"))`.
- Seed storage with `window.localStorage.setItem(packingCategoryStorageKey("trip-1"), JSON.stringify([...]))` before render.
- Existing 16.1/16.2 tests in this file must stay green unchanged — in particular "adds an item … keeps the category", "filters to not-packed items, remembers the choice", "survives a throwing localStorage", and the duplicate-highlight cases. Most existing fixtures have ≥2 groups, so chips will now render in them; that must not break their role queries (e.g. a `getByRole("button", { name: "All" })` would now also match… check: the chip is "All categories", and Testing Library name matching is exact by default, so "All" stays unique — keep it that way, do not name the chip "All").
- Pure rules in `test/packingList.test.ts`.

### Previous story intelligence (16.1, 16.2)

- 16.1 review: group React keys with a prefix no category can equal (`category:${key}` / `none`) — reuse for chip keys. Guarded storage everywhere. Upsert returned items rather than trusting local state.
- 16.2 review: answers arriving after navigation — not relevant here (no new requests). Shared helpers live exported from `TripPackingList.tsx` (`packingApiErrorMessage`, `usePackingCategoryOptions`); put the storage-key helper there too, the pure rule in `packingList.ts`.
- Open deferrals touching this file, do not fix here: DW-433 (row of an item deleted elsewhere), DW-434 (CSRF cached), DW-439 (day section race). Note: when an item in a selected category is deleted and the group empties, the effective selection simply loses it (AC 9) — no extra handling.

### Git intelligence

`c111d8e` (16.1) built the page, repo, route, overview card and backup; 16.2 (working tree, done after review) added linked days on rows and the 409 `days_changed` delete. Neither changed the filter logic. No dependency, no migration needed.

### Project Structure Notes

- No `project-context.md` exists; conventions come from the code and `architecture.md`.
- Next.js 16 app router, MUI 7 (`Chip` from `@mui/material`, already used in `TripDayView.tsx`), Vitest, no new dependency. Files touched: `src/lib/trips/packingList.ts`, `src/components/features/trips/TripPackingList.tsx`, `src/i18n/de.ts`, `src/i18n/en.ts`, `test/packingList.test.ts`, `test/tripPackingList.test.tsx`. No new files.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 16.6: My Part of the List]
- [Source: _bmad-output/planning-artifacts/epics.md#Epic 16: The Packing List — shared rules, rulings 2026-11-08]
- [Source: _bmad-output/planning-artifacts/prd.md — FR58 (amended 2026-11-08)]
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-11-08-packing-list.md]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-TravelPlan-2026-07-27/DESIGN.md — 44 px floor (doc-chip), warn reserved]
- [Source: travelplan/src/components/features/trips/TripPackingList.tsx]
- [Source: travelplan/src/lib/trips/packingList.ts]
- [Source: _bmad-output/implementation-artifacts/16-1-the-trips-packing-list.md, 16-2-what-the-day-needs.md]

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (claude-opus-5-5)

### Debug Log References

- Mutation check: disabling the reveal (`revealIfOutsideSelection`) fails exactly the three AC 11 tests (add, recategorize, duplicate); restored.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.
- Task 1: `resolvePackingCategorySelection` in `packingList.ts` (group order, de-duplicated, case-insensitive, `[]` with < 2 groups); 5 unit tests.
- Task 2: `packingCategoryStorageKey(tripId)` exported; `readStoredCategories` / `storeCategories` guarded with try/catch, accepting only arrays of `string | null`. Restored in the load effect next to `readStoredFilter()`.
- Task 3: `storedSelection` + session-only `revealedIds`; effective `selection` derived with `useMemo` and never written back on its own (a vanished key stays stored). `visibleGroups` applies category step (or revealed ids) then the "open" step. Chip row (`role="group"`, MUI `Chip` with `aria-pressed`, 44 px, nowrap + `overflowX: auto`) below the toggle, only with ≥ 2 groups and no load error. Selection progress line over all items of the selected groups (not the revealed extras, not affected by "open"). Selection-specific all-packed text.
- Task 4: Prefill in `changeSelection` and in the load step (from the restored selection) — never in an effect; label of the single group, empty for Other; other sizes leave the field. Reveal in `handleAdd` (new and `existed`) and `handleSave`, using `normalizePackingCategory` for the group key. The load-step prefill groups with `("", "en")` because keys and labels don't depend on locale or the Other label — keeps `language` out of the fetch effect's deps.
- Task 5: 4 keys each in `de.ts` / `en.ts`.
- Task 6: 19 component tests in a new `describe` block (incl. German, viewer, 44 px / nowrap style, prefill on load). Existing 16.1/16.2 tests unchanged and green.
- Task 7: typecheck clean; lint 0 errors (touched files clean); full suite 268 files / 4289 tests green (baseline 4265 + 5 unit + 19 component); `npm run build` passes. Not done: a manual 390 px browser check of the chip row (jsdom has no layout; covered only by the style assertions).
- No API, repo, schema, migration or backup change.

### File List

- travelplan/src/lib/trips/packingList.ts
- travelplan/src/components/features/trips/TripPackingList.tsx
- travelplan/src/i18n/de.ts
- travelplan/src/i18n/en.ts
- travelplan/test/packingList.test.ts
- travelplan/test/tripPackingList.test.tsx
- _bmad-output/implementation-artifacts/16-6-my-part-of-the-list.md
- _bmad-output/implementation-artifacts/sprint-status.yaml

## Change Log

- 2026-11-08: Story 16.6 implemented — category chips filter on the trip packing list (per-trip remembered selection, selection progress line, add-form prefill, reveal of items added/recategorized outside the selection). 24 tests added. Status → review.
- 2026-11-08: Code review — 5 patches applied (reveal decided against the stored selection so an item creating the second group stays visible; prefill/reveal reset only on the trip's first load, not on a language switch; reveal on tick; comment fix; resolver simplified), 4 regression tests added, 2 deferred (DW-440, DW-441), 11 dismissed. Full suite 268 files / 4293 tests green, typecheck/lint/build pass. Status → done.
