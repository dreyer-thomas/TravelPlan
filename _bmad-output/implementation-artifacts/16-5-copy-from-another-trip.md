---
baseline_commit: aaa21c6
---

# Story 16.5: Copy from Another Trip

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a traveller starting a new trip,
I want to take over items from another trip's packing list,
so that I don't type the swimwear and chargers again for every trip.

*FRs covered: FR60 (amended 2026-11-08: copies carry tags and arrive as needed). Depends on 16.1, 16.7, 16.8 (all done and committed in `aaa21c6`). Last story of Epic 16. Source: `epics.md` → Epic 16 / Story 16.5 (~line 5227); `prd.md` FR60 (~line 330); memory ruling "Reuse: in-app copy from another TravelPlan trip (any trip, pick items; they arrive unchecked, without day links, and same-name items aren't duplicated)".*

## Acceptance Criteria

1. **Entry point.** On the packing list page, an owner or contributor sees an outlined button "Aus anderer Reise übernehmen" / "Copy from another trip" (44 px high) in the writer area, directly below the add form. It is there whether the list is empty or not. A viewer does not see it.
2. **Choose a trip.** The button opens a dialog (`DialogShell`, `fullScreenOnPhone`). Step 1 lists every **other** trip the person can see (owner, contributor or viewer) **that has at least one packing item** **[default D1]**, newest first (start date descending, then id), each row showing the trip name, its date range and the item count ("12 Gegenstände" / "12 items", singular form for 1). Each row is one 44 px+ button. With no such trip: "Keine andere Reise hat eine Packliste." / "No other trip has a packing list.". The current trip is never offered.
3. **Choose items.** Choosing a trip loads that trip's packing list and shows step 2: its items grouped by category with the same groups, labels and order as the list itself (`groupPackingItems`, "Sonstiges"/"Other" last). Not-needed items are listed **in their category, like every other item** (not in a separate section). **All items start selected.** Each item has a checkbox (44 px target) with its name and tag chips (`PackingNameWithTags`). Each category heading has a tri-state checkbox that selects all / none of that category (checked = all, indeterminate = some, unchecked = none; `aria-label` "{category}: alle auswählen" / "{category}: select all"). A line shows "{selected} von {total} ausgewählt" / "{selected} of {total} selected". A "Andere Reise" / "Other trip" button returns to step 1 (the selection is dropped).
4. **Hints in step 2 [default D2].** An item whose name already exists on this trip (ignoring case, `packingNameKey`) shows a small `inkSoft` hint "schon auf der Liste" / "already on the list" and stays selected (the server skips it). An item that is not needed on the source trip shows the hint "dort nicht nötig" / "not needed there". The source's packed state is not shown.
5. **Confirm.** The confirm button reads "{count} übernehmen" / "Copy {count}" and is disabled with 0 selected or while copying. Confirming sends one request with the source trip id and the selected item ids. While it runs, the dialog cannot be dismissed (`disableDismiss`).
6. **What a copy is.** Each selected item that is not yet on this trip is created **unpacked, needed, without day links**, with its **name** (source spelling), **category** and **tags**, all in one transaction:
   - the category is stored in this trip's spelling if this trip already uses it ignoring case (as `resolveCategory`), no category stays none;
   - the tags are stored in this trip's spelling per tag key (as `resolveTags`);
   - "Nicht nötig" on the source is reset: the copy is needed (the summer trip's swimwear is needed again next summer);
   - no KI marker: `aiChangedAt` is `null` (`origin: "user"`).
7. **Duplicates skipped.** A selected item whose name already exists on this trip (ignoring case) is skipped and the existing item is **not changed at all** — no category, tag, packed or not-needed change, no write **[default D3]**.
8. **Result.** The dialog closes and the page shows an info notice (the existing `packing-notice` alert) built from two parts:
   - "{count} Gegenstände übernommen." / "{count} items added." (singular "1 Gegenstand übernommen." / "1 item added."; for 0: "Nichts übernommen." / "Nothing added."),
   - then, only when something was skipped, "{count} waren schon auf der Liste." / "{count} were already on the list." (singular "1 war schon auf der Liste." / "1 was already on the list.").
   The created items appear on the list at once (no reload). They are **not** revealed past an active category / tag filter and nothing is highlighted **[default D4]**; the notice is the feedback.
9. **The source trip is never changed.** No row of the source trip (items, tags, day links, `updatedAt`, `aiChangedAt`) is written.
10. **Access.**
    - Target trip: owner or contributor only. A viewer gets 403, an outsider 404 (the existing writer gate), for both the source listing and the copy.
    - Source trip: any trip the person can see, including one where they are only a viewer. A source trip the person cannot see, a missing one, or the target trip itself is refused with 404 `source_not_found` and nothing is written.
    - Item ids that do not belong to the source trip (another trip's, or deleted meanwhile) are ignored and not counted **[default D5]**.
11. **Errors.** A failed copy keeps the dialog open on step 2 with the selection, and shows the message in the dialog (`source_not_found` → "Diese Reise ist nicht mehr verfügbar." / "That trip is no longer available."; other codes via `packingApiErrorMessage`). A failed load of the trips or of the source list shows "Konnte nicht geladen werden." / "Could not be loaded." in the dialog.
12. **i18n.** All new UI text exists in German and English (Task 6).
13. **Tests** cover: copying all; a partial selection; duplicates skipped (case-insensitive) with the existing item untouched; categories kept (incl. this trip's spelling and no category) and tags kept (incl. this trip's spelling); packed state, "Nicht nötig" and day links not copied; no KI marker; a viewer-only source trip allowed; a source trip the user cannot see refused; the target itself as source refused; foreign item ids ignored; the source trip unchanged; viewer/outsider on the target refused; the source listing (excludes the target, trips without items and strangers' trips; includes viewer trips; newest first); the dialog flow (button visibility per role, trip list, grouping, preselection, category tri-state, hints, confirm payload, result notice variants, items shown, error kept in dialog, back to step 1).

**Out of scope:** file import and export (Claude does that through the connector); saved templates; a connector tool for copying; copying day links, packed state or "Nicht nötig"; merging tags into an existing same-name item; copying from the backup archive.

## Tasks / Subtasks

- [x] **Task 1: Validation** (AC: 5, 10) — `src/lib/validation/packingListSchemas.ts`
  - [x] `PACKING_COPY_MAX_ITEMS = 500` (a body bound; there is no per-trip item cap) next to the schema.
  - [x] `packingCopySchema = z.object({ sourceTripId: z.string().trim().min(1, "Source trip is required"), itemIds: z.array(itemIdField).min(1, "Nothing selected").max(PACKING_COPY_MAX_ITEMS, …) }).strict()`, then dedupe `itemIds` (`.transform`).
- [x] **Task 2: Repository** (AC: 2, 6, 7, 9, 10) — `src/lib/repositories/packingListRepo.ts`
  - [x] `export type PackingCopySource = { id: string; name: string; startDate: Date; endDate: Date; itemCount: number }`.
  - [x] `listPackingCopySources({ userId, tripId }): Promise<PackingCopySource[] | null>` — `null` when `findTripForTripWriter` fails. Otherwise `prisma.trip.findMany({ where: { id: { not: tripId }, OR: [{ userId }, { members: { some: { userId } } }], packingItems: { some: {} } }, select: { id, name, startDate, endDate, _count: { select: { packingItems: true } } }, orderBy: [{ startDate: "desc" }, { id: "desc" }] })`. Annotate the `where` as `Prisma.TripWhereInput` (see `tripRepo.ts:917` `listTripsForUser`: an unannotated const loses excess-property checks on an authorisation filter).
  - [x] `export type PackingCopyResult = { status: "not_found" } | { status: "source_not_found" } | { status: "copied"; added: number; existed: number; items: PackingItemDetail[] }`.
  - [x] `copyPackingItemsFromTrip({ userId, tripId, sourceTripId, itemIds })`:
    1. `findTripForTripWriter(userId, tripId)` → else `not_found`.
    2. `sourceTripId === tripId` → `source_not_found`. Source read gate: `prisma.trip.findFirst({ where: { id: sourceTripId, OR: [{ userId }, { members: { some: { userId } } }] }, select: { id: true } })` — the **participant** clause (viewers included), **not** the writer clause. Missing → `source_not_found`.
    3. In one `prisma.$transaction`, wrapped in `retryOnceOnUniqueViolation` (a concurrent add of the same name loses on `tripId_nameKey`; the rerun sees it as existing):
       - read the selected source items: `tx.packingItem.findMany({ where: { tripId: sourceTripId, id: { in: itemIds } }, select: { name: true, nameKey: true, category: true, tags: { select: { tag: true, tagKey: true }, orderBy: { tagKey: "asc" } } }, orderBy: [{ nameKey: "asc" }, { id: "asc" }] })` — only **reads** on the source (AC 9);
       - read once the target's existing `nameKey`s for those keys (`tx.packingItem.findMany({ where: { tripId, nameKey: { in } }, select: { nameKey: true } })`) → `existed` count, skip them untouched (D3);
       - for the rest: `resolveCategory(tx, tripId, source.category)` and `resolveTags(tx, tripId, source.tags.map(t => t.tag))`, then `tx.packingItem.create({ data: { tripId, name, nameKey, category, packed: false, notNeeded: false, aiChangedAt: null, tags: { create: … } }, select: detailSelect })`. Calling the resolvers per item inside the transaction is correct (each sees the items created before it in the same transaction, so two copied items share one spelling) and fast enough for ≤ 500 items on SQLite; do not pre-cache unless a test shows a problem.
       - Do **not** call `createOrResolveInTx`: it would merge tags with `mergeTags`, and without it still runs one extra read per item; the duplicate rule here is "skip, never touch" (D3). Do reuse `resolveCategory`, `resolveTags`, `detailSelect`, `toDetail`, `packingTagKey`.
       - Source tags are at most 10 per item already (the source trip enforces it), so no `PackingTagLimitError` can arise; no new error path.
    4. Answer `{ status: "copied", added, existed, items }` (`items` = the created ones, `toDetail`, name-key order).
  - [x] Extend the file header doc comment with a Story 16.5 paragraph (source read gate = participant; target write gate; skip-never-touch; no KI marker; source only read).
- [x] **Task 3: Route** (AC: 2, 5, 10, 11) — new `src/app/api/trips/[id]/packing-items/copy/route.ts`
  - [x] `GET` → the source listing. `requireSession`, trip id, `refuseUnlessTripWriter(userId, tripId, "Trip not found")` (viewer 403, outsider 404; GET carries no CSRF, as the list's GET), then `listPackingCopySources`; answer `ok({ trips: [{ id, name, startDate: ISO, endDate: ISO, itemCount }] })`; 500 `server_error` "Unable to load trips".
  - [x] `POST` → `authorizeWrite` from `../shared` (CSRF + session + writer gate + JSON), `packingCopySchema.safeParse` (400 `validation_error` "Invalid packing copy"), `copyPackingItemsFromTrip`; `not_found` → 404 `not_found` "Trip not found"; `source_not_found` → 404 `source_not_found` "Source trip not found"; success → `ok({ added, existed, items: items.map(toWire) })`; catch → 500 `server_error` "Unable to copy packing items".
  - [x] Route doc comment in the style of `packing-items/route.ts` (Story 16.5, FR60, the two gates).
- [x] **Task 4: Dialog component** (AC: 2–5, 11) — new `src/components/features/trips/PackingCopyDialog.tsx`
  - [x] Props: `{ open, tripId, currentItems: readonly Pick<PackingItemWire, "name">[], onClose, onCopy: (sourceTripId, itemIds) => Promise<{ error?: string }> }`. The parent does the POST (it owns `send`, `writeCount`, items and the notice); the dialog only shows the error it gets back.
  - [x] Fresh state per open: render the body under `key={useOpenInstanceKey(open)}` (`DialogShell.tsx:57`), never a hand-written reset effect.
  - [x] `DialogShell` with `title` = copyTitle, `closeLabel` = `t("common.close")`, `width` 520, `fullScreenOnPhone`, `disableDismiss` while copying. Footer: step 2 → "Andere Reise" (text button, left) and the confirm button (contained, right); step 1 → no confirm.
  - [x] Step 1: `GET /api/trips/${tripId}/packing-items/copy` on open (guard `active` like the page's load effect). Rows = `Button`/`ListItemButton` per trip, `minHeight: 44`, name (600) + "{dateRange} · {count}" (`inkSoft`). Date range: `Intl.DateTimeFormat(INTL_LOCALES[language], { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })` start – end, the dashboard's format (`TripsDashboard.tsx:192-204`); the dates are stored at UTC midnight, so `timeZone: "UTC"` is mandatory.
  - [x] Step 2: `GET /api/trips/${sourceId}/packing-items` (the existing read; viewers allowed). Group with `groupPackingItems(items, t("trips.packingList.other"), locale)` over **all** items (needed and not needed together). Selection = `Set<itemId>` initialised to all ids. Group heading row: MUI `Checkbox` with `checked` / `indeterminate`, label = group label. Item rows: `Checkbox` + `PackingNameWithTags` + hints (D2: `existingKeys = new Set(currentItems.map(i => packingNameKey(i.name)))`).
  - [x] Confirm → `onCopy(sourceId, [...selected])`; on `error` stay on step 2 and show it in an `Alert` inside the dialog; on success the parent closes it.
  - [x] 44 px targets for every checkbox and button; no horizontal scroll at 360 px (names wrap, `overflowWrap: "anywhere"` as on the list rows).
- [x] **Task 5: Packing list page** (AC: 1, 8) — `TripPackingList.tsx`
  - [x] State `copyOpen`. The button below the add form inside the `canEdit` branch (`variant="outlined"`, `minHeight: TOUCH_TARGET_PX`, `alignSelf: "flex-start"`).
  - [x] Let `send` take an optional path suffix (`send(method, payload, "/copy")` → `/api/trips/${tripId}/packing-items/copy`) so the copy also bumps `writeCount` (the AI-changes notice refresh key) — do not add a second fetch helper.
  - [x] `handleCopy(sourceTripId, itemIds)`: POST; on error return `{ error: code === "source_not_found" ? t(copySourceGone) : resolveApiError(code) }`; on success: `setItems(current => [...current, ...created])` (the ids are new; `upsertItem` per item also works), close the dialog, `setActionError(null)`, `setNotice(copyResultMessage(added, existed))`. No `revealIfOutsideSelection`, no `setHighlight` (D4).
  - [x] Keep the existing add form, filters, selection storage and prefill untouched.
  - [x] Update the component doc comment (Story 16.5 paragraph).
- [x] **Task 6: i18n** (AC: 12) — `src/i18n/de.ts` and `src/i18n/en.ts`, beside the `trips.packingList.*` keys (`test/i18nDictionaries.test.ts` checks parity). Singular forms follow the existing `…One` key convention (`deleteDaysOne`); `formatMessage` has no plural support.

  | key | de | en |
  |---|---|---|
  | `copyOpen` | Aus anderer Reise übernehmen | Copy from another trip |
  | `copyTitle` | Aus anderer Reise übernehmen | Copy from another trip |
  | `copyChooseTrip` | Von welcher Reise? | From which trip? |
  | `copyNoSources` | Keine andere Reise hat eine Packliste. | No other trip has a packing list. |
  | `copyLoadError` | Konnte nicht geladen werden. | Could not be loaded. |
  | `copyItemCount` | {count} Gegenstände | {count} items |
  | `copyItemCountOne` | 1 Gegenstand | 1 item |
  | `copyBack` | Andere Reise | Other trip |
  | `copySelectedCount` | {selected} von {total} ausgewählt | {selected} of {total} selected |
  | `copySelectGroupAria` | {category}: alle auswählen | {category}: select all |
  | `copyConfirm` | {count} übernehmen | Copy {count} |
  | `copyAlreadyOnList` | schon auf der Liste | already on the list |
  | `copyWasNotNeeded` | dort nicht nötig | not needed there |
  | `copySourceGone` | Diese Reise ist nicht mehr verfügbar. | That trip is no longer available. |
  | `copyResultAdded` | {count} Gegenstände übernommen. | {count} items added. |
  | `copyResultAddedOne` | 1 Gegenstand übernommen. | 1 item added. |
  | `copyResultNone` | Nichts übernommen. | Nothing added. |
  | `copyResultExisted` | {count} waren schon auf der Liste. | {count} were already on the list. |
  | `copyResultExistedOne` | 1 war schon auf der Liste. | 1 was already on the list. |

- [x] **Task 7: Tests** (AC: 13). Baseline after 16.8: **269 files / 4451 tests green** — re-measure before starting.
  - [x] `test/packingListRepo.test.ts` — `copyPackingItemsFromTrip`: copy all; partial; duplicate (other case) skipped, existing item byte-identical afterwards (`updatedAt`, tags, category, packed); category in the target's spelling and `null` kept; tags in the target's spelling (target has "Kaufen", source "kaufen" → "Kaufen"); a packed + day-linked source item → copy unpacked without links; a not-needed source item → copy needed; `aiChangedAt` null; viewer-only source allowed; stranger's source → `source_not_found`, nothing written (count before/after); target as source → `source_not_found`; a viewer of the target → `not_found`; an id of a third trip ignored and not counted; the source trip's items, tags, links and `updatedAt` unchanged. `listPackingCopySources`: excludes target, empty trips and strangers' trips, includes a viewer trip, start date descending, `itemCount`; `null` for a viewer of the target.
  - [x] New `test/packingListCopyRoute.test.ts` (model it on `test/packingListRoute.test.ts`: `buildRequest`, `routeContext`, `createSessionJwt`, `setup`): GET owner/contributor 200 with ISO dates, viewer 403, stranger 404, no session 401; POST 200 `{ added, existed, items }` with wire items; 400 for empty `itemIds`, > 500 ids, a stray field, invalid JSON; 403 without CSRF; viewer 403; 404 `source_not_found`.
  - [x] `test/tripPackingList.test.tsx`: **trap** — the stub's `if (method === "GET")` answers every GET with the list. Route by URL first: `/packing-items/copy` → sources; `/api/trips/<sourceId>/packing-items` → source items; the trip's own list last. Cases: button for owner and contributor, none for viewer; trip rows newest first with name, dates and count; "no other trip" message; step 2 grouped with "Other" last, all preselected, not-needed items inside their category with the hint, "already on the list" hint; group tri-state (all → none → all, indeterminate after one item); count line; confirm disabled at 0; confirm payload `{ sourceTripId, itemIds }` to `/packing-items/copy`; notice variants (added only, added + existed, nothing added, singular); created items rendered; error (`source_not_found`) shown in the dialog, dialog stays on step 2; "Other trip" back to step 1; load error message.
  - [x] Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run check:migrations`, `npm run build`.

### Review Findings

- [x] [Review][Patch] Copy transaction runs on Prisma's default 5 s interactive timeout; up to 500 items × (resolveCategory + resolveTags + create) can exceed it → P2028 → 500. Give it an explicit timeout like `dayPlanApplyRepo` [travelplan/src/lib/repositories/packingListRepo.ts:1287]
- [x] [Review][Patch] `handleCopy` appends created items blindly; a list reload (reloadKey after an AI undo) that already returned them would duplicate rows. Merge by id like `upsertItem` [travelplan/src/components/features/trips/TripPackingList.tsx:452]
- [x] [Review][Patch] `confirm()` has no try/finally: if `onCopy` ever rejects, `busy` stays true and the dialog (disableDismiss) is stuck [travelplan/src/components/features/trips/PackingCopyDialog.tsx:159]
- [x] [Review][Defer] Source list with > 500 items: all preselected, confirm answers 400 with a generic message [travelplan/src/components/features/trips/PackingCopyDialog.tsx:101] — deferred, unrealistic list size today (DW-448)
- [x] [Review][Defer] Second lost unique race in the copy escapes as 500 [travelplan/src/lib/repositories/packingListRepo.ts:1286] — deferred, same pattern as DW-446 (DW-449)
- [x] [Review][Defer] Source list empty by the time step 2 loads shows only "0 of 0 selected" [travelplan/src/components/features/trips/PackingCopyDialog.tsx:266] — deferred, rare race (DW-450)
- [x] [Review][Defer] After `source_not_found`, "Other trip" still lists the gone trip (sources not reloaded) [travelplan/src/components/features/trips/PackingCopyDialog.tsx:133] — deferred, low (DW-451)
- [x] [Review][Defer] `<h3>`/`<div>` inside `<label>` in step 2 rows (invalid content model for label) [travelplan/src/components/features/trips/PackingCopyDialog.tsx:290] — deferred, cosmetic/a11y nit (DW-452)
- [x] [Review][Defer] Test gaps: listing id tie-break, `handleCopy` network-failure branch, route-level viewer-only source [travelplan/test/packingListRepo.test.ts] — deferred, low (DW-453)

## Dev Notes

### Defaults (decided here, flagged for Tommy)

- **D1: The trip picker lists only trips that have packing items.** The epic says "any other trip I can see"; most older trips have no packing list yet (the feature is days old), and choosing one would lead to an empty step 2. If none qualifies, the dialog says so.
- **D2: Step 2 marks items already on this trip ("schon auf der Liste") and items that were not needed on the source ("dort nicht nötig")**, but keeps both preselected as the epic asks. Cheap help when copying the summer list onto a winter trip; the server still decides what is a duplicate.
- **D3: A skipped duplicate is not touched** — no tag merge, unlike the app's add of an existing name (16.8 D3). The epic says names that exist "are skipped"; merging tags from an old trip could re-add a "Kaufen" that was already done.
- **D4: Copied items are not revealed past an active category/tag filter and not highlighted.** 16.6's "added item stays visible" rule is for one item the person just typed; for a bulk copy it would undo the filter. The notice gives the counts.
- **D5: Item ids not on the source trip are ignored and not counted** (an item deleted on the source while the dialog was open). Refusing the whole copy for that would be unhelpful.

### Current state of the files this story touches (as of `aaa21c6`)

- **`packingListRepo.ts` (1208 lines).** `findTripForTripWriter` (149) is the write gate (explicit `role: "CONTRIBUTOR"` — load-bearing, see its comment). The participant read clause is `OR: [{ userId }, { members: { some: { userId } } }]` (used in `listPackingItemsForTrip`, 296). `resolveCategory` (210) and `resolveTags` (235) give this trip's spelling. `createOrResolveInTx` (367) is **not** the right tool here (D3). `retryOnceOnUniqueViolation` (630) reruns a write once after a unique violation. `detailSelect` / `toDetail` (158/185) shape the answer. App writes use `aiChangedAtFor("user", …)` → `null`; a direct `aiChangedAt: null` is equivalent.
- **`packing-items/route.ts` and `shared.ts`.** `authorizeWrite` = CSRF + session + `refuseUnlessTripWriter` + JSON body; `toWire` turns dates into ISO strings. The new route lives in `packing-items/copy/route.ts` and imports from `../shared`, as `day-links/route.ts` does.
- **`TripPackingList.tsx` (1503 lines).** Writer section = the add form (~998-1051) under `!loadError && canEdit`. `send` (~398) is bound to `/packing-items`; extend it with a suffix. `notice` / `actionError` alerts (~1054). `groupPackingItems` and `PackingNameWithTags` are already imported. The load effect (~305) restores filters and prefills on the first load only — this story does not touch it.
- **`DialogShell.tsx`.** `useOpenInstanceKey` (57) for fresh state per open; `fullScreenOnPhone` (Story 12.3) is pure sx breakpoints — never `useMediaQuery` or MUI's `fullScreen`. `closeLabel` is required.
- **`TripsDashboard.tsx:192-204`.** The date-range format to mirror (do not import from the dashboard; it is a local callback).

### What must keep working

- The add form, the "Alle"/"Noch offen" filter, category and tag chips, their stored selections and prefill, reveals and highlight — untouched by the copy.
- The AI-changes notice: a copy is a person's write (`origin: "user"`), creates no `ai_changes` row and must not show as KI. Bumping `writeCount` only refreshes the notice.
- The trip overview's packing entry counts come from the server on the next visit; nothing to change.
- Backup export/import, the connector and the day email are unaffected (no new field, no migration).

### Traps

- **Source gate ≠ target gate.** The source uses the participant clause (viewers allowed, AC 10); the target uses `findTripForTripWriter`. Swapping them either blocks the viewer-source case or lets a viewer write.
- **Read the source items with `tripId: sourceTripId` in the `where`**, never by id alone — otherwise ids of a third trip the person cannot see would be copied (AC 10, D5).
- **A `return` inside the transaction commits what was created before it**; only a throw rolls back (16.7 lesson). This story has no mid-loop refusal, keep it that way.
- **The test stub answers every GET with the list** (`test/tripPackingList.test.tsx:50`): route the new GETs by URL before that branch, or the dialog will "load" the trip's own list as the sources.
- **`writes()` in that suite counts every non-GET call** — existing assertions on write counts are unaffected as long as the copy is only triggered in the new tests.
- **Dates are UTC midnight.** Format with `timeZone: "UTC"` or the range shifts a day west of UTC.
- **`tripRepo.ts` is not touched.** (If you grep it anyway: use `grep -a`, a byte makes plain grep print nothing.)

### Design

- Button: outlined, 44 px, under the add form. Dialog: `DialogShell` width 520, full screen on phones, footer "Andere Reise" left / "{n} übernehmen" right.
- Trip rows: name 600 weight, second line `inkSoft` "1. Juli 2026 – 14. Juli 2026 · 23 Gegenstände" (the dashboard format), 44 px+.
- Item rows: same name + tag chip look as the list (`PackingNameWithTags`); hints in `inkSoft` 12 px; no warn colours (DESIGN.md reserves warn for gaps), no AI badge look.
- Category heading: tri-state checkbox + label, like a group heading on the list without counts.

### Testing

- Helpers: `test/helpers/routeContext.ts`, `test/helpers/mockFetch.ts` (`stubFetch`, `mockFetchResponse`, `requestUrl`), `test/helpers/renderWithProviders.tsx`. The DB is migrated per run; clean-up chains that delete users/trips cascade to items, tags and links.
- Pin the repo result shape with `toEqual` on counts and on the created items' `{ name, category, packed, notNeeded, tags, dayCount, aiChangedAt }`.

### Previous story intelligence

- **16.8:** `resolveTags` / trip-wide spelling; `PackingNameWithTags` accepts `undefined` tags (old payloads). Review lessons: send only what changed; guard unique violations precisely.
- **16.7:** not-needed invariant (never packed, never linked) — a copy is needed and unlinked, so it holds trivially. Throw-not-return in batch transactions.
- **16.6:** reveals and prefill rules (D4 deliberately does not extend reveals to bulk copies).
- **16.1:** name rules (`packingNameKey`, NFC + trim + lower), category "Other" stored as `null`, alerts and notice pattern.
- Open ledger items not to "fix" in passing: DW-434…436, DW-440…447.

### Git intelligence

- `aaa21c6` (16.7 + 16.8), `d95b088` (16.3 + 16.4), `fa84061` (16.2 + 16.6), `c111d8e` (16.1): repo + route + `shared.ts` `toWire` + client component + one suite per layer. `day-links/route.ts` is the template for a sub-route under `packing-items/`.
- No new dependency (MUI 7.3, Prisma 7.10 with better-sqlite3, zod 4.1). **No migration.**

### Project Structure Notes

- New files: `src/app/api/trips/[id]/packing-items/copy/route.ts`, `src/components/features/trips/PackingCopyDialog.tsx`, `test/packingListCopyRoute.test.ts`.
- Modified: `packingListRepo.ts`, `packingListSchemas.ts`, `TripPackingList.tsx`, `de.ts`, `en.ts`, `packingListRepo.test.ts`, `tripPackingList.test.tsx`.
- There is no `project-context.md` in this repository; conventions come from the code and the previous stories.

### References

- `_bmad-output/planning-artifacts/epics.md` → Epic 16 shared rules (~5073), Story 16.5 (~5227)
- `_bmad-output/planning-artifacts/prd.md` FR60 (~330)
- `_bmad-output/planning-artifacts/sprint-change-proposal-2026-11-08-packing-list.md`
- `_bmad-output/implementation-artifacts/16-8-tags-on-packing-items.md`, `16-7-not-needed-this-time.md`, `16-6-my-part-of-the-list.md`
- Code: `travelplan/src/lib/repositories/packingListRepo.ts`, `travelplan/src/app/api/trips/[id]/packing-items/{route.ts,shared.ts,day-links/route.ts}`, `travelplan/src/components/features/trips/TripPackingList.tsx`, `travelplan/src/components/features/trips/PackingTags.tsx`, `travelplan/src/components/ui/DialogShell.tsx`, `travelplan/src/lib/trips/packingList.ts`, `travelplan/src/lib/validation/packingListSchemas.ts`, `travelplan/src/components/features/trips/TripsDashboard.tsx:192-204`

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (claude-opus-5-5)

### Debug Log References

- Baseline before starting: 269 files / 4451 tests green (from 16.8). After: 270 files / 4485 tests green (+34: 13 repo, 6 route, 15 UI).
- Typecheck: the first UI test draft passed a bare status to `mockFetchResponse` (`MockResponseInit` takes `{ status }`); fixed.
- Lint: 0 errors, 80 warnings - the same 80 pre-existing warnings as on the baseline (checked by stashing the change).
- `npm run check:migrations` passes (no migration); `npm run build` passes and lists `/api/trips/[id]/packing-items/copy`.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created
- Task 1: `PACKING_COPY_MAX_ITEMS = 500` and `packingCopySchema` (strict, ids deduped by `.transform`).
- Task 2: `listPackingCopySources` (writer gate on the target; participant clause on sources, `packingItems: { some: {} }` (D1), start date desc then id desc; the `where` annotated `Prisma.TripWhereInput`) and `copyPackingItemsFromTrip` (target writer gate -> `not_found`; source = target or not visible -> `source_not_found`; one transaction in `retryOnceOnUniqueViolation`; source items read with `tripId: sourceTripId` (D5); existing name keys skipped untouched (D3); each copy through `resolveCategory` / `resolveTags`, created `packed: false, notNeeded: false, aiChangedAt: null`, no day links). The shared participant clause is a small `participantClause(userId)` helper. Header doc extended.
- Task 3: new `packing-items/copy/route.ts` - `GET` (session + `refuseUnlessTripWriter`, ISO dates) and `POST` (`authorizeWrite`, 400 `validation_error`, 404 `not_found` / `source_not_found`, 500 `server_error`).
- Task 4: new `PackingCopyDialog.tsx` - `DialogShell` (520, `fullScreenOnPhone`, `disableDismiss` while copying), fresh body per open via `useOpenInstanceKey`; step 1 trip rows (44 px+, UTC date range, item count with singular); step 2 `groupPackingItems` over all items, everything preselected, tri-state group boxes, "x of y selected", hints "already on the list" / "not needed there" (D2), error kept on step 2 with the selection.
- Task 5: `TripPackingList` - outlined "Copy from another trip" button under the add form (writers only, also on an empty list); `send` takes an optional path suffix so the copy bumps `writeCount`; `handleCopy` appends the created items, closes the dialog, shows the notice (added / nothing + optional skipped part, singular forms); no reveal, no highlight (D4). Dialog rendered only for writers.
- Task 6: 19 keys in `de.ts` / `en.ts` as specified (parity test green).
- Task 7: repo tests (copy all, partial, case-insensitive duplicate left byte-identical, target spelling for category and tags, null category, packed / not-needed / day links / KI marker not copied, viewer-only source, stranger and missing source, target as source, viewer/outsider target, foreign ids ignored, source trip unchanged, listing order/filters/counts, null for a viewer); route suite; UI suite with a URL-routing stub (own `installCopyApi` in the new describe, so the existing `installApi` stays unchanged).
- No new dependency, no migration. Defaults D1-D5 implemented as flagged in Dev Notes.

### File List

- travelplan/src/lib/validation/packingListSchemas.ts (modified)
- travelplan/src/lib/repositories/packingListRepo.ts (modified)
- travelplan/src/app/api/trips/[id]/packing-items/copy/route.ts (new)
- travelplan/src/components/features/trips/PackingCopyDialog.tsx (new)
- travelplan/src/components/features/trips/TripPackingList.tsx (modified)
- travelplan/src/i18n/de.ts (modified)
- travelplan/src/i18n/en.ts (modified)
- travelplan/test/packingListRepo.test.ts (modified)
- travelplan/test/packingListCopyRoute.test.ts (new)
- travelplan/test/tripPackingList.test.tsx (modified)
- _bmad-output/implementation-artifacts/sprint-status.yaml (modified)
- _bmad-output/implementation-artifacts/16-5-copy-from-another-trip.md (status, tasks, Dev Agent Record)

### Change Log

- 2026-11-08: Code review: 3 patches applied (copy transaction timeout 30 s, copied items merged by id, dialog confirm guarded by try/finally); 6 low findings deferred (DW-448..453); 13 dismissed. Status -> done.
- 2026-11-08: Story 16.5 implemented - copy packing items from another trip (repo, route, dialog, page button and notice, i18n, tests). Status -> review.
