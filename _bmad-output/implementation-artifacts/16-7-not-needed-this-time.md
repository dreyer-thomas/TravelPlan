---
baseline_commit: fa84061
---

# Story 16.7: Not Needed This Time

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a traveller who keeps one packing list going from trip to trip,
I want to mark an item as not needed on this trip without deleting it,
so that the summer swimwear stays on the list for later but doesn't clutter "Noch offen" or the progress of the winter trip.

*Added 2026-11-08 at Tommy's request (John/PM). FRs covered: FR58 (not needed, amended 2026-11-08), FR53, FR54 (connector), FR57. Depends on 16.1, 16.2, 16.4 (all done). Sequenced after 16.4, before 16.8 and 16.5. **16.3 and 16.4 are done but not committed**: their changes are in the working tree on top of `fa84061`. Build on the working tree, not on the commit. Source: `epics.md` → Epic 16 / Story 16.7; `prd.md` FR58; memory ruling "Nicht nötig is a fixed item state, NOT a tag".*

## Acceptance Criteria

1. **Three states.** An item is in exactly one of three states: **open**, **packed**, **not needed**. As owner or contributor I can mark an item "Diesmal nicht nötig" / "Not needed this time", and mark a not-needed item "Doch nötig" / "Needed after all". Marking a packed item not needed unticks it (`packed = false`). Marking it needed again returns it as **open** (never packed). **[default]**
2. **The invariant, enforced server-side everywhere.** A not-needed item is never packed and never linked to a day. Every write path keeps this true: app PATCH, app day links, connector add/update, backup import, undo (see Dev Notes, "Every path that can break the invariant").
3. **Not-needed section [default].** On the packing list page, not-needed items are not in the category groups. They are in their own section **after all categories**, collapsed by default, headed "Nicht nötig (4)" / "Not needed (4)". Inside, they are grouped by category with the same grouping and order as the main list (`groupPackingItems`), greyed out (`tokens.inkSoft`), with **no checkbox**. The open/closed state is kept for the session only (not stored). With no not-needed items, the section is not rendered.
4. **Counts exclude not-needed.** Not-needed items count in none of these:
   - the page's progress line ("18 von 30 eingepackt" counts needed items only)
   - the per-category heading counts ("Technik 4/7")
   - 16.6's selection progress line
   - the trip overview entry's progress (`GET /api/trips/[id]` → `trip.packing`)
5. **Filters.** The "Noch offen" filter hides the whole not-needed section. The category filter (16.6) applies to the section too: with a selection, the section shows only the selected categories' not-needed items, its heading count is the count of what it shows, and it is hidden when it has nothing to show. Category chips are built from **all** items (needed and not-needed), so a category that only exists in the section still gets a chip.
6. **Overview entry [default].** `trip.packing` becomes `{ total, packed, notNeeded }`, where `total` and `packed` count needed items only. The overview card (`TripTimeline.tsx`) shows:
   - `total === 0 && notNeeded === 0`: "Noch leer" / "Empty yet" (unchanged)
   - `notNeeded > 0` (any `total`, including 0): "{packed} von {total} eingepackt · {notNeeded} nicht nötig" / "{packed} of {total} packed · {notNeeded} not needed", e.g. "0 von 0 eingepackt · 4 nicht nötig"
   - otherwise: "{packed} von {total} eingepackt" (unchanged)
   The aria-label follows the same text. The epic text only covers the all-not-needed case. Showing the "· N nicht nötig" suffix in the mixed case too is a **default flagged for Tommy** (D3).
7. **Day confirmation [default].** Marking an item not needed that is linked to one or more days first asks: title "Diesmal nicht nötig?" / "Not needed this time?", body "Von 3 Tagen entfernen?" / "Remove from 3 days?" ("Von 1 Tag entfernen?" / "Remove from 1 day?"). Confirming removes those links in the same write. The confirmed count is sent (`confirmedDayCount`). If the links changed in the meantime, the server answers 409 `days_changed` with the fresh count and writes nothing, and the dialog asks again with the fresh count. This is the delete's DW-432 pattern. An item with no links is marked without asking.
8. **Day picker (16.2).** The day's "Add" picker does not offer not-needed items in its search results. If the typed text is exactly the name of a not-needed item (ignoring case, `packingNameKey`), the picker offers „Badehose“ wieder als nötig markieren und hinzufügen / "Mark 'Swimwear' needed and add" in place of the create option. Picking it marks the item needed and links it to the day in one write. It never creates a duplicate. **[default]**
9. **Trip-list add of a not-needed name.** Adding an item on the trip list with the name of a not-needed item creates nothing (unchanged server behaviour, `existed`). The page opens the not-needed section, shows the existing "„X“ steht schon auf der Liste." notice, and highlights and scrolls to the existing row, as for any existing name (16.1). It does **not** silently mark it needed.
10. **Viewer.** A viewer sees the not-needed section (collapsed, expandable) read-only, without the "Doch nötig" button, the edit pencil or any marking action. The API refuses viewer writes (403) as today.
11. **Backup (v2 archive).** Each entry of `trip.packingItems` carries `notNeeded` (boolean). An archive without it imports with `notNeeded: false`. On import, an entry with `notNeeded: true` comes back unpacked and without day links, even if the archive says otherwise (the invariant wins). When entries that share a name key are merged, the merged item is not needed only if **all** of them are.
12. **Connector reads.**
   - `get_packing_list` returns `notNeeded` per item.
   - `get_trip`'s `packing` gains `notNeeded`, and its `total`/`packed` count needed items only.
   - `get_day` does not change shape: not-needed items are never linked. Its query also filters `notNeeded: false` as defence in depth.
   - The tool descriptions say all of this.
13. **Connector writes.** `update_packing_item` accepts `notNeeded`, with the same rules:
   - `notNeeded: true` unticks the item and removes all its day links (the description says so, and says to confirm with the user first, naming the days).
   - `addDayIds` on an item that is, or would end up, not needed is refused with exactly `Item is marked not needed; set notNeeded false first`. Nothing is written.
   - `packed: true` on such an item gets the same refusal.
   - `notNeeded: false` together with `addDayIds` or `packed` in one call is allowed.
   - `add_packing_items` with `dayId`, where a name resolves to a not-needed item, refuses the whole call. The message is `items[i]: Item is marked not needed; set notNeeded false first` and nothing is written. Without `dayId` such a name resolves to `existed` as today and is returned with `notNeeded: true`.
14. **KI and undo.** Each connector change is marked KI (`aiChangedAt`) and undoable with the packing receipt. The receipt snapshot gains `notNeeded`, so undo restores the prior state, the `packed` value and the removed day links (days that no longer exist are skipped, as today). Receipts stored before this story (no `notNeeded` in the snapshot) still parse and undo, with `notNeeded: false`.
15. **App writes clear the badge.** Marking or unmarking from the app goes through `origin: "user"` and clears `aiChangedAt`, like every other app write.
16. **i18n.** All new UI text exists in German and English (see Dev Notes for the keys).
17. **Tests** cover:
   - marking and unmarking; a packed item becoming not needed (unticked); needed again = open
   - progress and counts excluding not-needed items, on the page and on the overview entry (including "0 von 0 eingepackt · 4 nicht nötig")
   - the "Noch offen" filter hiding the section; the category filter applied to the section; a chip for a category that exists only in the section
   - the collapsed section
   - removal of day links after confirmation, and the `days_changed` re-ask
   - the day picker hiding the item, and the exact-name "mark needed and add"
   - the trip-list add of a not-needed name opening the section and highlighting the row
   - viewer read-only
   - export/import with and without the field, and the import invariant
   - the connector read, write, refused link, refused add-with-day, and undo (including an old receipt without `notNeeded`)

**Out of scope:** a reason or note for "not needed"; automatic suggestions of what isn't needed (Claude does that through the connector); anything in the day email (not-needed items are never linked); tags (16.8); copying (16.5, which resets `notNeeded` to false when it copies).

## Tasks / Subtasks

- [x] **Task 1: Schema and migration** (AC: 1, 2)
  - [x] `prisma/schema.prisma`, `model PackingItem` (line ~500): add `notNeeded Boolean @default(false) @map("not_needed")` after `packed`, with a one-line `// Story 16.7` comment.
  - [x] New migration folder `prisma/migrations/20261108140000_add_packing_item_not_needed/migration.sql`, with a header comment in the style of `20261101120000_add_trip_day_ai_changed_at` and the line `ALTER TABLE "packing_items" ADD COLUMN "not_needed" BOOLEAN NOT NULL DEFAULT false;`. **Never edit an existing migration**: `npm run check:migrations` enforces this.
  - [x] `npx prisma generate`. `src/generated/prisma` is committed; regenerate it, don't hand-edit it.
- [x] **Task 2: Repository** (AC: 1, 2, 7, 8, 9, 13, 14, 15). Everything goes through `src/lib/repositories/packingListRepo.ts`.
  - [x] `PackingItemDetail` gains `notNeeded: boolean`. Add it to `detailSelect`, `DetailRow` and `toDetail`.
  - [x] `PackingItemForDay` / `listPackingItemsForDay`: add `notNeeded: false` to the `where` (defence in depth; the day email must never show one).
  - [x] `updatePackingItem` (app PATCH) gains `notNeeded?: boolean` and `confirmedDayCount?: number`, and new results `{ status: "days_changed"; dayCount }` and `{ status: "not_needed" }`. Read `current` with `notNeeded`, `packed` and `_count.days`. Then:
    - `notNeeded === true`: if `confirmedDayCount !== undefined && dayCount > 0 && dayCount !== confirmedDayCount`, answer `days_changed` and write nothing. Otherwise `packingItemDay.deleteMany({ where: { packingItemId } })` and set `notNeeded: true, packed: false`.
    - `notNeeded === false`: set `notNeeded: false` (`packed` stays false; it is already false by the invariant).
    - `packed === true` and the item ends up not needed (it is not needed now and `notNeeded` is not `false` in this request): answer `not_needed` and write nothing.
    - All of it stays inside the existing transaction, and name and category still work.
  - [x] `linkPackingItemToDay` and `addPackingItemToDay` gain `markNeeded?: boolean` and a result `{ status: "not_needed" }`. When the resolved item is not needed: with `markNeeded`, set `notNeeded: false` in the same transaction, then link. `linkInTx` → `touchItem` already writes the item; fold `notNeeded: false` into that one update rather than writing twice. Without `markNeeded`, answer `not_needed` and write nothing. **For `addPackingItemToDay`, the item may have been created just now (never not needed) or resolved (`existed`); check only the resolved one.**
  - [x] `createPackingItem` / `createOrResolveInTx`: no behaviour change (a not-needed name answers `existed`, unchanged). The detail now carries `notNeeded`, which the page needs for AC 9.
  - [x] Connector, `snapshotSelect` / `toSnapshot`: add `notNeeded`.
  - [x] `addPackingItemsForConnector`: when `tripDayId !== undefined` and a resolved existing item is not needed, refuse. Return a new result `{ status: "not_needed"; index: number }`, where `index` is the input index, before anything is written. Do it with a pre-pass over the inputs' name keys (`findMany` on `nameKey in [...]`, `notNeeded: true`) at the top of the transaction. Don't return from inside the loop: a returned value commits the creates made earlier in the batch, and only a **throw** rolls them back. Do not leave half a batch written.
  - [x] `updatePackingItemForConnector` gains `notNeeded?: boolean` and a result `{ status: "not_needed" }`. Compute `endsNotNeeded = params.notNeeded ?? current.notNeeded`, then:
    - if `endsNotNeeded` and (`toLink.length > 0` or `params.packed === true`): answer `not_needed` and write nothing. Check this **before** any write.
    - if `params.notNeeded === true && !current.notNeeded`: `data.notNeeded = true`, `data.packed = false` (if it was packed), and unlink **all** current days (`toUnlink` = every linked day, whatever `removeDayIds` says).
    - if `params.notNeeded === false && current.notNeeded`: `data.notNeeded = false`.
    - The no-op detection (`unchanged`, no hook) must treat `notNeeded` like the other fields: `notNeeded: true` on an already not-needed item is `unchanged`.
  - [x] `undoPackingChangeForTrip`: write `notNeeded: before.notNeeded` in the `updated` restore and in the `deleted` recreate. `restoreLinks` is unchanged. A restored snapshot is internally consistent, because it was read from a consistent row.
  - [x] Update the file's header doc comment with a Story 16.7 paragraph (the invariant, the two new statuses).
- [x] **Task 3: Receipt** (AC: 14)
  - [x] `src/lib/trips/packingChangeReceipt.ts`: `PackingItemSnapshot` gains `notNeeded: boolean`. `mapSnapshot` spreads it already; check it.
  - [x] `src/lib/validation/packingChangeReceiptSchemas.ts`: in `snapshotSchema`, `notNeeded: z.boolean().optional()` (still `.strict()`). Keep `version: 1`; the field is additive.
  - [x] `fromPackingChangeReceiptWire` (or the wire type): an absent `notNeeded` becomes `false`, so `before.notNeeded` is always a boolean after parsing. The wire type then has `notNeeded?: boolean` while the in-memory type has `notNeeded: boolean`. Split the generic or default in `mapSnapshot` on the way in, whichever stays readable.
  - [x] Test: a stored receipt JSON without `notNeeded` parses (`aiChangeRepo.test.ts`) and undoes.
- [x] **Task 4: App API** (AC: 1, 7, 8, 10)
  - [x] `src/lib/validation/packingListSchemas.ts`:
    - `packingItemUpdateSchema` gains `notNeeded: z.boolean().optional()` and `confirmedDayCount: z.number().int().min(0).optional()`.
    - The "Nothing to update" refine also accepts `notNeeded`.
    - Add a refine that refuses `notNeeded: true` together with `packed: true` ("An item cannot be packed and not needed").
    - `confirmedDayCount` without `notNeeded: true` is a 400.
  - [x] `packingDayLinkCreateSchema`: both union members gain `markNeeded: z.literal(true).optional()`. They stay `.strict()`.
  - [x] `src/app/api/trips/[id]/packing-items/route.ts` PATCH:
    - pass `notNeeded` and `confirmedDayCount` through
    - map `days_changed` → 409 `days_changed` with `{ dayCount }` (same as DELETE)
    - map `not_needed` → 409 `not_needed` "Packing item is marked not needed"
    - update the route doc comment.
  - [x] `src/app/api/trips/[id]/packing-items/day-links/route.ts` POST: pass `markNeeded`, and map `not_needed` → 409 `not_needed`.
  - [x] `shared.ts` `toWire` spreads the detail, so `notNeeded` flows through. Verify with a route test.
- [x] **Task 5: Trip summary, overview entry and backup** (AC: 4, 6, 11). **`tripRepo.ts` contains a byte that makes plain `grep` treat it as binary and print nothing: use `grep -a`.**
  - [x] `tripRepo.ts:262`: the type becomes `packing: { total: number; packed: number; notNeeded: number }`.
  - [x] `tripRepo.ts:1225`: select `{ packed: true, notNeeded: true }`.
  - [x] `tripRepo.ts:1284-1287`:
    - `total` = items where `!notNeeded`
    - `packed` = items where `packed && !notNeeded`
    - `notNeeded` = items where `notNeeded`
  - [x] `src/app/api/trips/[id]/route.ts:64` passes `trip.packing` through; nothing to change, but extend `test/tripDetailRoute.test.ts:249-275` (it pins `{ total, packed }` with `toEqual`, so it **will go red** until it expects `notNeeded`).
  - [x] `TripTimeline.tsx:73`: the type becomes `packing?: { total: number; packed: number; notNeeded?: number }` (optional `notNeeded`, so an older payload or a fixture still renders). Lines 1237-1269: put the text in one small local helper used by both the `aria-label` and the visible line, following AC 6. There is no new card, no new layout and no new colour.
  - [x] Export:
    - `TripExportPackingItem` (`tripRepo.ts:431`) gains `notNeeded: boolean`
    - the export select (~1936) adds `notNeeded: true`
    - the mapping (~2579) adds `notNeeded: item.notNeeded`
    - add a line to the `export/route.ts:44` comment ("Story 16.7 adds `notNeeded`, additive within v2").
  - [x] Import:
    - `tripImportSchemas.ts:613` `packingItemImportSchema` gains `notNeeded: z.boolean().optional().default(false)`.
    - `createImportedPackingItems` (`tripRepo.ts:3180`): the merge tracks `notNeeded` as "all entries not needed" (start with the first entry's value, `existing.notNeeded = existing.notNeeded && item.notNeeded`).
    - On create, when `notNeeded`: `packed: false` and **no links**.
    - Update its doc comment.
- [x] **Task 6: Connector** (AC: 12, 13, 14)
  - [x] `src/lib/mcp/packingShapes.ts` `toPackingItem`: add `notNeeded` after `packed`.
  - [x] `src/lib/mcp/plannerShapes.ts:256`: `packing: { total, packed, notNeeded }`. `get_day`'s `packingItems` (`plannerShapes.ts:219`) keeps its shape.
  - [x] `src/lib/repositories/connectorReadRepo.ts:262`: add `notNeeded: false` to the day's `packingItems` `where`.
  - [x] `src/lib/mcp/tools/tripRead.ts:77-78`: the `get_trip` description says the packing counts cover needed items and that `notNeeded` counts the items marked not needed this time.
  - [x] `src/lib/mcp/tools/packingTools.ts`:
    - Export `PACKING_ITEM_NOT_NEEDED = "Item is marked not needed; set notNeeded false first"`.
    - `updateInput` gains `notNeeded: z.boolean().optional().describe(...)`.
    - The "nothing to change" guard includes `notNeeded`.
    - Map `not_needed` → `toolError(PACKING_ITEM_NOT_NEEDED)`, and extend the exhaustive `switch` (it has a `never` default, so the compiler will flag a missed status).
    - `add_packing_items` maps `{ status: "not_needed", index }` → `toolError(\`items[${index}]: ${PACKING_ITEM_NOT_NEEDED}\`)`.
  - [x] Descriptions:
    - `get_packing_list`: notNeeded = "kept on the list but not needed on this trip; such an item is never packed and never linked to a day".
    - `update_packing_item`: notNeeded true unticks the item and removes it from every day it is linked to (confirm with the user first, naming the days); a not-needed item cannot be ticked or linked until notNeeded is set false.
    - `add_packing_items`: with dayId, a name that is a not-needed item refuses the call.
  - [x] No new tool and no new `ai_changes` action. Marking goes through `packingUpdated` and its subject is the item's name, as today.
- [x] **Task 7: Packing list page** (AC: 1, 3, 4, 5, 7, 9, 10, 15, 16). `src/components/features/trips/TripPackingList.tsx`
  - [x] `PackingItemWire` gains `notNeeded: boolean`.
  - [x] Derive three groupings:
    - `neededGroups = groupPackingItems(items.filter(i => !i.notNeeded), …)`: the main list and its heading counts
    - `notNeededGroups = groupPackingItems(items.filter(i => i.notNeeded), …)`: the section
    - `chipGroups = groupPackingItems(items, …)`: the 16.6 chips, `resolvePackingCategorySelection` and the prefill lookups. Today's `groups` is used for all three of these; rename it carefully. **The load-time prefill at line 267 groups `body.data.items` itself, so leave it on all items.**
  - [x] Progress line (617): `packedCount` and `total` over needed items only. Selection progress (620-627): sum over `neededGroups` whose key is in the selection.
  - [x] `visibleGroups` (347-355) is built from `neededGroups`. The all-packed / all-packed-selection message stays tied to the needed list. When there are items but **no needed items at all**, show `trips.packingList.allNotNeeded` instead of "Alles eingepackt." (**[default]**, D4). The empty-list text (`items.length === 0`) is unchanged.
  - [x] Not-needed section, after the last group:
    - Render only when `filter === "all"` and, after the category selection (and 16.6 reveals) is applied, it has items.
    - Header: a full-width toggle button (min height 44 px, `aria-expanded`, `aria-controls`) with "Nicht nötig ({count})", where count = items shown in it. Same `labelCaps` look as group headings plus a chevron; reuse an icon from `TripIcons` if one fits, otherwise MUI `Collapse` without an icon.
    - Body: `Collapse` (respects reduced motion like the rest of the page), with category sub-headings showing only the label, no `x/y` count (there is nothing packed in it).
    - Rows: same row shell as the main list, but a fixed empty 44 px slot in place of the checkbox (alignment), the name in `tokens.inkSoft`, the AI badge, and for writers a text `Button` "Doch nötig" (`aria-label` "{name} doch nötig" / "Mark {name} needed", min height 44 px) plus the existing pencil.
    - `data-testid`s: `packing-not-needed-section`, `packing-not-needed-toggle`, `packing-not-needed-row`.
  - [x] State `notNeededOpen` (session only). Set it to true in `handleAdd` when the answered `existed` item is not needed (AC 9), **before** the highlight, so the row is rendered when the scroll effect runs. If the scroll lands on a not-yet-mounted row because of the `Collapse` animation, render the section body with `unmountOnExit={false}` or open without transition in that case; the 16.6 lesson is that the highlight must point at a rendered row. Also switch `filter` from "open" to "all" for the session, as is already done for a packed duplicate (416).
  - [x] Edit dialog: a third action. For a needed item, `Button` "Diesmal nicht nötig"; for a not-needed item, "Doch nötig". Keep the destructive Delete on the left. Put the new action next to Save on the right, or as a full-width secondary button above the actions; pick whichever fits 360 px without wrapping awkwardly (test at phone width).
  - [x] `markNotNeeded(item)`:
    - if `item.dayCount > 0`, open a confirmation dialog (`notNeededTarget` state, built like the delete dialog at 934-962: title `notNeededTitle`, body `notNeededDays`/`notNeededDaysOne`, actions `notNeededCancel` + `notNeededConfirm`; not a destructive red, use `variant="contained"` default colour).
    - otherwise PATCH `{ itemId, notNeeded: true, confirmedDayCount: 0 }` directly.
    - On 409 `days_changed`, update the count and re-ask (mirror `deleteItem` 500-522).
    - On success, `upsertItem(body.data.item)` (it comes back with `days: []`, `dayCount: 0`, `packed: false`), close the dialogs, and keep a 16.6 reveal in mind (`revealIfOutsideSelection` is still right).
  - [x] `markNeeded(item)`: PATCH `{ itemId, notNeeded: false }`, then upsert. No confirmation.
  - [x] `handleToggle` is only reachable for needed rows. If the server answers 409 `not_needed` (marked elsewhere), roll back as today and reload the list (`reloadAfterAiUndo` does exactly a reload), with the `notNeededError` message.
  - [x] `packingApiErrorMessage` (130-147): add `case "not_needed": return t("trips.packingList.notNeededError")`.
- [x] **Task 8: Day section and picker** (AC: 8). `src/components/features/trips/TripDayPackingSection.tsx`
  - [x] `pickable` (≈ line 160) excludes `item.notNeeded`.
  - [x] `exactMatch` stays over all items. When `exactMatch?.notNeeded`, `filterOptions` pushes `{ kind: "markNeeded", item: exactMatch }` in place of the create option. Extend `PickerOption` with that variant, plus a type guard, `getOptionLabel` and `renderOption` (label `dayMarkNeededOption`).
  - [x] Picking it, or pressing Enter on the exact text (`handlePick`'s string path where `match.notNeeded`), calls `addToDay({ itemId: match.id, markNeeded: true })`. Today's code would call `addToDay({ itemId })` for any match: that path must branch on `notNeeded` first.
  - [x] Create flow (`handleCreate`, by name): if the server answers 409 `not_needed` (the list was stale), show `notNeededError` in the picker and refetch the list by bumping an internal reload. The exact-name option then appears.
  - [x] Day rows are unchanged. A not-needed item is never linked, so nothing renders for it.
- [x] **Task 9: i18n** (AC: 16). Add to both `src/i18n/de.ts` and `src/i18n/en.ts`, next to the other `trips.packingList.*` keys:

  | key | de | en |
  |---|---|---|
  | `markNotNeeded` | Diesmal nicht nötig | Not needed this time |
  | `markNeeded` | Doch nötig | Needed after all |
  | `markNeededAria` | {name} doch nötig | Mark {name} needed |
  | `notNeededSection` | Nicht nötig ({count}) | Not needed ({count}) |
  | `notNeededTitle` | Diesmal nicht nötig? | Not needed this time? |
  | `notNeededDaysOne` | Von 1 Tag entfernen? | Remove from 1 day? |
  | `notNeededDays` | Von {count} Tagen entfernen? | Remove from {count} days? |
  | `notNeededCancel` | Abbrechen | Cancel |
  | `notNeededConfirm` | Nicht nötig | Not needed |
  | `progressWithNotNeeded` | {packed} von {total} eingepackt · {notNeeded} nicht nötig | {packed} of {total} packed · {notNeeded} not needed |
  | `allNotNeeded` | Diesmal ist nichts auf der Liste nötig. | Nothing on the list is needed this time. |
  | `notNeededError` | Dieser Gegenstand ist diesmal als nicht nötig markiert. | This item is marked not needed this time. |
  | `dayMarkNeededOption` | „{name}“ wieder als nötig markieren und hinzufügen | Mark '{name}' needed and add |

  There is no `common.cancel` key in the dictionaries (checked), hence `notNeededCancel`. German uses „…“ quotes, English '…' quotes, as the existing `dayCreateOption` does.
- [x] **Task 10: Tests** (AC: 17). Extend the existing suites; **add no new test file** except where none fits.
  - [x] `test/packingListRepo.test.ts`:
    - mark/unmark; packed → not needed unticks; needed again = open
    - `days_changed` with a stale count; links removed on confirm
    - `packed: true` on a not-needed item → `not_needed`
    - link / add-to-day refused without `markNeeded`, and with it marks needed and links in one write (one `updatedAt` bump)
    - `listPackingItemsForDay` ignores a not-needed row even if a link is forced in by raw Prisma
    - connector: update with `notNeeded`, refused `addDayIds`, refused `packed`, `notNeeded: false` + `addDayIds` allowed, no-op `unchanged`
    - add-with-day refusal writes nothing (count items before and after)
    - undo of a not-needed mark restores `packed: true` and the day links
  - [x] `test/packingListRoute.test.ts`: PATCH `notNeeded`; 409 `days_changed`; 409 `not_needed`; 400 for `notNeeded + packed: true` and for `confirmedDayCount` alone; viewer 403; `toWire` carries `notNeeded`.
  - [x] `test/packingListDayLinksRoute.test.ts`: 409 `not_needed` by id and by name; `markNeeded: true` marks and links; `markNeeded` with a stray value → 400.
  - [x] `test/packingListBackup.test.ts`: round trip with `notNeeded`; an archive without the field → false; `notNeeded: true` with `packed: true` and `dayIndexes` imports unpacked and unlinked; merge rule.
  - [x] `test/tripDetailRoute.test.ts:249-275`: expect `{ total, packed, notNeeded }` with needed-only counts. `:370` pins the trip key set; `packing` is already in it.
  - [x] `test/tripTimelineRoles.test.tsx:342`: the overview card with `notNeeded` (all-not-needed text, mixed text, absent field = old text).
  - [x] `test/tripPackingList.test.tsx`:
    - progress and heading counts exclude not-needed
    - section collapsed by default with count; expands
    - "Noch offen" hides it; category chip filters it; a chip for a section-only category
    - mark from the edit dialog with and without days (confirm dialog text, PATCH payload with `confirmedDayCount`), `days_changed` re-ask
    - "Doch nötig" from the section
    - add of a not-needed name opens the section and highlights the row
    - all-not-needed message
    - viewer sees the section without buttons
    - both languages for the new strings that have a visible line
  - [x] `test/tripDayPackingSection.test.tsx`: the picker hides a not-needed item; the exact name offers "mark needed and add" and posts `{ itemId, markNeeded: true }`; a 409 `not_needed` on create shows the message.
  - [x] `test/mcpPackingTools.test.ts`:
    - `get_packing_list` has `notNeeded`
    - update `notNeeded: true` on a linked, packed item (links gone, unpacked, KI marker, receipt) → `undo_ai_change` restores both
    - refused `addDayIds` (exact message)
    - refused `packed: true`
    - add with `dayId` hitting a not-needed name → `items[i]: …` and nothing written
  - [x] `test/mcpReadTools.test.ts`: `get_trip.packing` with `notNeeded` and needed-only counts.
  - [x] `test/mcpPlannerShapes.test.ts`, `test/mcpRouteShapes.test.ts:110`: fixtures carrying `packing` gain `notNeeded: 0` where the type requires it.
  - [x] `test/aiChangeRepo.test.ts`: a stored packing receipt without `notNeeded` parses and undoes.
  - [x] Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run check:migrations`. **Baseline after 16.4: 269 files / 4342 tests green.** Re-measure before starting rather than assuming.

### Review Findings

- [x] [Review][Patch] "Diesmal nicht nötig" / "Doch nötig" in the edit dialog discards unsaved name/category edits (Tommy: send the changed name/category in the same PATCH; a duplicate name shows the edit error and keeps the dialog open) [travelplan/src/components/features/trips/TripPackingList.tsx:624] — `sendNotNeeded` and `markNeeded` send only `{ itemId, notNeeded }` and close the dialog, so a rename or category change typed in the same dialog is lost without warning (blind+edge+auditor).
- [x] [Review][Patch] Selecting a chip whose category holds only not-needed items (Tommy: new key "In dieser Auswahl ist diesmal nichts nötig." / "Nothing in this selection is needed this time.", and hide the selection progress line when its total is 0) [travelplan/src/components/features/trips/TripPackingList.tsx:939] says "all packed in this selection" — chips come from all items (AC 5), so the selection leaves `visibleGroups` empty while needed items exist elsewhere; the page shows `allPackedSelection` and "0 von 0 eingepackt" although nothing in the selection is needed (under "Noch offen" the section is hidden too, so only the false message is visible) (blind+edge).
- [x] [Review][Patch] Day picker: a by-id pick refused with 409 `not_needed` never re-reads the list, so the stale item stays pickable and fails on every retry [travelplan/src/components/features/trips/TripDayPackingSection.tsx:231]
- [x] [Review][Patch] Import merge takes `packed` and `dayIndexes` from a not-needed entry into a merged needed item (A needed + B `{notNeeded, packed, dayIndexes:[3]}` → needed, packed, linked to day 3); only needed entries should contribute [travelplan/src/lib/repositories/tripRepo.ts:3217]
- [x] [Review][Patch] `get_day` description does not say not-needed items are never in `packingItems` (AC 12 "the tool descriptions say all of this") [travelplan/src/lib/mcp/tools/tripRead.ts:108]
- [x] [Review][Patch] `add_packing_items` description: without dayId a not-needed name resolves to existed and stays not needed (returned with notNeeded true) — not stated, so the assistant may report it as on the list [travelplan/src/lib/mcp/tools/packingTools.ts:191]
- [x] [Review][Defer] Repo test for markNeeded link only asserts `updatedAt` moved forward, not that it was one write [travelplan/test/packingListRepo.test.ts] — deferred, test strength only; the code folds `notNeeded: false` into the single `touchItem` update (verified)

## Dev Notes

### Deviations and defaults (decided here, flagged for Tommy)

- **D1: The server refuses rather than auto-fixing.** Linking or ticking a not-needed item is a 409 / tool error unless the request explicitly says "needed" (`markNeeded: true` in the app, `notNeeded: false` in the connector). The picker's "mark needed and add" sends that flag on purpose. A stale client therefore cannot silently resurrect an item someone else just marked not needed.
- **D2: `add_packing_items` with `dayId` refuses the whole call** when a name resolves to a not-needed item. It does not skip that item, and it does not mark it needed. This matches "one invalid item refuses the whole call" in the existing tool description, and the AC's explicit "set notNeeded false first" wording.
- **D3: The overview entry shows "· N nicht nötig" whenever N > 0**, not only when every item is not needed (AC 6). The alternative is that a list with 30 needed and 4 not-needed items hides the 4 entirely on the overview.
- **D4: The all-not-needed page message** "Diesmal ist nichts auf der Liste nötig." The epic does not specify it. Without it, the page would say "Alles eingepackt." over a list where nothing is needed.
- **D5: The receipt stays `version: 1`**, with `notNeeded` optional in the stored schema (absent = false). A version bump would make every older stored packing receipt fail the strict parse, and therefore become un-undoable.

### Every path that can break the invariant (not needed ⇒ unpacked, unlinked)

| Path | File | What to do |
|---|---|---|
| App PATCH `packed: true` | `updatePackingItem` | `not_needed` unless `notNeeded: false` in the same request |
| App PATCH `notNeeded: true` | `updatePackingItem` | unpack and unlink all, after the day-count check |
| App link by id | `linkPackingItemToDay` | `not_needed` unless `markNeeded` |
| App add by name to day | `addPackingItemToDay` | `not_needed` unless `markNeeded` (only for a resolved, existing item) |
| Connector add with day | `addPackingItemsForConnector` | refuse the whole batch before any write |
| Connector update | `updatePackingItemForConnector` | `endsNotNeeded` checks before writes; `notNeeded: true` unlinks all |
| Import | `createImportedPackingItems` | force `packed: false`, no links |
| Undo | `undoPackingChangeForTrip` | restores a consistent snapshot; nothing extra |
| Day email / `get_day` | `listPackingItemsForDay`, `connectorReadRepo.ts:262` | `notNeeded: false` filter (defence in depth) |
| Copy (16.5, later) | — | resets to needed; not this story |

### Current state of the files this story touches

- **`packingListRepo.ts` (855 lines).** Every write re-checks `findTripForTripWriter` (owner, or member with `role: "CONTRIBUTOR"`: keep that explicit role). App writes set `aiChangedAt` through `aiChangedAtFor(origin)`. Connector writes run `inTransaction` last with the receipt, and a no-op writes nothing and runs no hook. `linkInTx` → `touchItem` bumps `updatedAt` only when a link was created. `deletePackingItem`'s `confirmedDayCount` / `days_changed` (lines 347-369) is the exact pattern to copy for the not-needed confirmation. Stamps are compared with `getTime()`, never by identity.
- **`TripPackingList.tsx` (965 lines).**
  - `groups` (340) drives the chips (716-757), the selection (342-345), the selection progress (620-627) and the visible list (347-355).
  - The load effect (232-288) restores the 16.6 selection and does the add-form prefill **only on the first load per trip** (`restoredForTrip`). Do not move that into an effect over the selection (16.6 review lesson: it would overwrite what the person typed).
  - `revealIfOutsideSelection` (386-391) decides against the **stored** selection on purpose. Keep it.
  - Tick is optimistic with a per-item sequence (`toggleSeq`); only the latest answer touches the row.
  - Every successful write bumps `writeCount`, which refreshes the AI-changes notice. The new PATCHes go through `send`, so they get that for free.
  - The highlight effect (293-299) scrolls `rowRefs.current.get(id)`: the row must be mounted.
- **`TripDayPackingSection.tsx` (518 lines).**
  - It fetches the whole trip list itself.
  - `pickable` = items not on the day. `exactMatch` is computed over all items, and the create option is offered only when there is no exact match.
  - `handlePick`'s string path links any exact match: this must branch on `notNeeded`.
  - Answers after day navigation are dropped (`activeDay` ref; keep this).
- **`TripTimeline.tsx:1228-1271`.** The overview card reads `detail.trip.packing` and fetches nothing; text and aria-label are duplicated today, so factor them once.
- **`tripRepo.ts`.** The summary count (1224-1226, 1284-1287) is also what `get_trip` returns, via `getTripWithDaysForUser` → `plannerShapes.ts:256`. So changing the count there changes both the app and the connector, which is intended.

### Response and description conventions (connector)

- Error strings are exact and asserted by tests: `Item is marked not needed; set notNeeded false first`; batch refusals are prefixed `items[i]: `.
- Tools call repositories only (Epic 15 rule, `server.ts`). No Prisma in `packingTools.ts`.
- `get_day` keeps its shape. Do not add `notNeeded` to `packingItems` there (it would always be false).

### Design

- The section header uses the same `labelCaps` + `tokens.inkSoft` as group headings, with no new colour. Greyed rows use `tokens.inkSoft`, as packed names already do, but **without** the strike-through (strike-through means packed).
- `tokens.warnBg` remains the highlight only; do not use warn for not-needed rows (DESIGN.md reserves warn).
- 44 px targets for every new button. The page must still work one-handed at 360 px with no horizontal page scroll.
- The "Doch nötig" button is a text button (no fill). It must not compete with the checkbox column visually.

### Testing

- Fixtures and helpers already used by these suites: `test/helpers/connectorWriteFixtures.ts` (`setupConnectorTrip`, `structured`, `errorText`, `storedReceipt`), `test/helpers/mcpClient.ts` (`callTool`), `test/helpers/renderWithProviders.tsx`, `test/helpers/mockFetch.ts`, `test/helpers/routeContext.ts`.
- The DB is migrated per run by `test/globalSetup.ts` / `test/setup.ts` (`prisma migrate deploy`), so the new migration folder is picked up automatically. A missing `prisma generate` shows up as type errors on `notNeeded`.
- `tripDetailRoute.test.ts` and the timeline fixtures pin `packing`. Expect them to fail first; fix them by asserting the new shape, **not** by loosening `toEqual`.

### Previous story intelligence

- **16.4:**
  - A no-op connector write writes nothing and answers `aiChangeId: null`.
  - The subject is read in-transaction (`storedNamesOf`).
  - Only a rename maps a unique violation to `duplicate_name` (review patch at `packingListRepo.ts:719-721`); keep that guard when adding statuses.
  - `AiChangesNotice` props are a discriminated union.
  - The packing page re-reads the notice after the person's own writes.
- **16.6:** chips and selection use the group keys of `groupPackingItems` (lower-cased, NFC, `null` = Other). A vanished stored key is ignored, never erased. The prefill happens in handlers and the first load, never in an effect.
- **16.2:** DW-432 (`confirmedDayCount` / `days_changed`) is the confirmation pattern. DW-433: a 404 "Packing item not found" on unlink means the item is gone, so drop it locally.
- **15.4/15.5:** compare stamps with `getTime()`. Undo restores `updatedAt` and `aiChangedAt` explicitly, so chained undos work newest-first.
- Open ledger items in this area that you must not "fix" in passing: DW-434 (CSRF cache), DW-435 (concurrent category spellings), DW-436, DW-440, DW-441, DW-442, DW-443.

### Git intelligence

- `fa84061` (16.2 + 16.6) and `c111d8e` (16.1) set the patterns: repo + route + `shared.ts` `toWire`, client component with guarded `localStorage`, tests per layer. 16.3/16.4 (uncommitted) added `packingShapes.ts`, `packingTools.ts`, the packing receipt and `?scope=packing`.
- No library changes are needed: MUI 7 (`Collapse`, `Chip`, `ToggleButtonGroup` already in use), Prisma 7 with the better-sqlite3 adapter, zod 4 (`z.iso.datetime` is already used in `packingTools.ts`). There is no new dependency.

### Project Structure Notes

- New files: only the migration `prisma/migrations/20261108140000_add_packing_item_not_needed/migration.sql` (plus regenerated `src/generated/prisma/**`).
- No new route, no new tool and no new `ai_changes` action. The receipt version stays 1.
- There is no `project-context.md` in this repository. The conventions above come from the code and the previous stories.

### References

- `_bmad-output/planning-artifacts/epics.md` → Epic 16 header (amended rulings), Story 16.7 (lines ~5299-5346), 16.5 (copy resets not-needed), 16.8 (tags keep across not-needed)
- `_bmad-output/planning-artifacts/prd.md` FR58 (amended 2026-11-08)
- `_bmad-output/planning-artifacts/sprint-change-proposal-2026-11-08-packing-list.md`
- `_bmad-output/implementation-artifacts/16-4-the-packing-list-through-the-connector.md` (D1 receipt, D2 `aiChangedAt`, review findings)
- `_bmad-output/implementation-artifacts/16-6-my-part-of-the-list.md` (selection rules)
- `travelplan/src/lib/repositories/packingListRepo.ts`, `travelplan/src/lib/trips/packingList.ts`, `travelplan/src/lib/trips/packingChangeReceipt.ts`, `travelplan/src/lib/validation/packingChangeReceiptSchemas.ts`, `travelplan/src/lib/validation/packingListSchemas.ts`, `travelplan/src/lib/mcp/tools/packingTools.ts`, `travelplan/src/lib/mcp/packingShapes.ts`, `travelplan/src/lib/mcp/plannerShapes.ts`, `travelplan/src/lib/repositories/connectorReadRepo.ts`, `travelplan/src/lib/repositories/tripRepo.ts` (use `grep -a`), `travelplan/src/lib/validation/tripImportSchemas.ts`, `travelplan/src/components/features/trips/TripPackingList.tsx`, `travelplan/src/components/features/trips/TripDayPackingSection.tsx`, `travelplan/src/components/features/trips/TripTimeline.tsx`

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (claude-opus-5-5), via bmad-dev-story, 2026-11-08.

### Debug Log References

- Baseline re-measured before starting: 16.3/16.4 are committed now (`d95b088`), so the story built on HEAD, not on an uncommitted working tree. `baseline_commit: fa84061` in the frontmatter was kept as found.
- First full run after the shape change: 5 expected red pins (`tripDetailRoute` packing, `tripExportRoute` packing items, `mcpReadTools` get_trip, two `mcpPackingTools` shapes). Fixed by asserting the new shape, not by loosening `toEqual`.
- `TripPackingList.tsx`: the section header was first written as a heading inside a `<button>` (invalid HTML); changed to the accordion pattern (button inside the `h2`).
- Lint: one new warning from a test (`_drop` destructure), removed; back to the 80 pre-existing warnings, 0 errors.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created
- **Schema:** `PackingItem.notNeeded` (`not_needed`, default false) and the additive migration `20261108140000_add_packing_item_not_needed`; Prisma client regenerated. `check:migrations` passes.
- **Invariant (not needed ⇒ unpacked, unlinked)** is kept on every write path in `packingListRepo.ts`: app PATCH (`notNeeded: true` unpacks and deletes the links after the `confirmedDayCount` check → `days_changed`; `packed: true` on a not-needed item → `not_needed` unless `notNeeded: false` in the same request), app link/add-to-day (`not_needed` unless `markNeeded`; `markNeeded` folds `notNeeded: false` into the one `touchItem` write), connector add with a day (pre-pass before any write, `{ status: "not_needed", index }`), connector update (`endsNotNeeded` check before writes; marking unlinks all days whatever `removeDayIds` says; already-not-needed is `unchanged`), import (forced unpacked, no links, merge = "all entries not needed"), undo (restores the snapshot's `notNeeded`). `listPackingItemsForDay` and `get_day` filter `notNeeded: false` as defence in depth.
- One small deviation from the task text, deliberate: the connector refusal checks `addDayIds.length > 0`, not `toLink.length > 0`, so `addDayIds` naming an already-linked day on an item being marked not needed is also refused (matches AC 13's "addDayIds on an item that is, or would end up, not needed is refused").
- **Receipt (D5):** the snapshot type carries `notNeeded` (required in memory, optional on the wire); `mapSnapshot` defaults an absent one to `false`; the stored schema has `notNeeded: z.boolean().optional()`, still `version: 1`, still `.strict()`. A stored receipt without the field parses and undoes (test).
- **Overview / summary:** `trip.packing` is `{ total, packed, notNeeded }` with needed-only `total`/`packed`; the same count feeds `get_trip`. `TripTimeline` uses one helper `packingCardTextOf` for both the visible line and the aria-label (D3: suffix whenever N > 0).
- **Page:** three groupings (`chipGroups` from all items for chips/selection/prefill, `neededGroups` for the list and counts, `notNeededGroups` for the section). Section after the last group, collapsed, session-only state, hidden by "Noch offen", filtered by the chips, sub-headings take the chip label. Rows: empty 44 px slot, `inkSoft` name without strike-through, AI badge, "Doch nötig" text button + pencil for writers only. Edit dialog: full-width outlined "Diesmal nicht nötig" / "Doch nötig" above the actions (chosen so three actions fit 360 px without wrapping). Confirm dialog with the DW-432 re-ask. Adding a not-needed name opens the section (rendered without the collapse animation in that case, so the highlighted row has its height when the scroll runs) and leaves "Noch offen" for the session. A tick refused with `not_needed` rolls back and reloads. D4 message when nothing is needed.
- **Day picker:** `pickable` excludes not-needed items; the exact name offers "„X“ wieder als nötig markieren und hinzufügen" in place of "create", by click or Enter, posting `{ itemId, markNeeded: true }`; a create refused with 409 `not_needed` shows the message, returns to the search with the typed name and re-reads the list.
- **Connector:** `notNeeded` in `get_packing_list` items and `get_trip.packing`; `update_packing_item` accepts `notNeeded`; exact error `Item is marked not needed; set notNeeded false first` (and `items[i]: …` for the batch); descriptions updated. No new tool, no new action.
- **i18n:** the 13 keys of Task 9 in `de.ts` and `en.ts`.
- **Tests:** 43 new tests across repo, both routes, backup, receipt, connector tools, get_trip, timeline card, page and day section; the pinned shapes updated. `test/mcpPlannerShapes.test.ts` needed no change (its fixture carries no `packing`).
- **Note on red-green:** the implementation was written per task before its tests (the tests were then run against it and all pass); the five pre-existing pins were the only genuine "red first" signals.
- **Not verified in a real browser:** the 360 px layout of the edit dialog and the section was reasoned from the layout (full-width button, `nowrap` text button), not looked at; worth a quick look on the phone during review.
- **Gates:** `npm run typecheck` clean; `npm run lint` 0 errors (80 pre-existing warnings, none new); `npm run check:migrations` passes; `npm test` 269 files / 4385 tests green (baseline 4342); `npm run build` passes.

### File List

- `travelplan/prisma/schema.prisma`
- `travelplan/prisma/migrations/20261108140000_add_packing_item_not_needed/migration.sql` (new)
- `travelplan/src/generated/prisma/internal/class.ts` (regenerated)
- `travelplan/src/generated/prisma/internal/prismaNamespace.ts` (regenerated)
- `travelplan/src/generated/prisma/internal/prismaNamespaceBrowser.ts` (regenerated)
- `travelplan/src/generated/prisma/models/PackingItem.ts` (regenerated)
- `travelplan/src/lib/repositories/packingListRepo.ts`
- `travelplan/src/lib/repositories/tripRepo.ts`
- `travelplan/src/lib/repositories/connectorReadRepo.ts`
- `travelplan/src/lib/trips/packingChangeReceipt.ts`
- `travelplan/src/lib/validation/packingChangeReceiptSchemas.ts`
- `travelplan/src/lib/validation/packingListSchemas.ts`
- `travelplan/src/lib/validation/tripImportSchemas.ts`
- `travelplan/src/lib/mcp/packingShapes.ts`
- `travelplan/src/lib/mcp/plannerShapes.ts`
- `travelplan/src/lib/mcp/tools/packingTools.ts`
- `travelplan/src/lib/mcp/tools/tripRead.ts`
- `travelplan/src/app/api/trips/[id]/packing-items/route.ts`
- `travelplan/src/app/api/trips/[id]/packing-items/day-links/route.ts`
- `travelplan/src/app/api/trips/[id]/export/route.ts`
- `travelplan/src/components/features/trips/TripPackingList.tsx`
- `travelplan/src/components/features/trips/TripDayPackingSection.tsx`
- `travelplan/src/components/features/trips/TripTimeline.tsx`
- `travelplan/src/i18n/de.ts`
- `travelplan/src/i18n/en.ts`
- `travelplan/test/packingListRepo.test.ts`
- `travelplan/test/packingListRoute.test.ts`
- `travelplan/test/packingListDayLinksRoute.test.ts`
- `travelplan/test/packingListBackup.test.ts`
- `travelplan/test/aiChangeRepo.test.ts`
- `travelplan/test/mcpPackingTools.test.ts`
- `travelplan/test/mcpReadTools.test.ts`
- `travelplan/test/mcpRouteShapes.test.ts`
- `travelplan/test/tripDetailRoute.test.ts`
- `travelplan/test/tripExportRoute.test.ts`
- `travelplan/test/tripTimelineRoles.test.tsx`
- `travelplan/test/tripPackingList.test.tsx`
- `travelplan/test/tripDayPackingSection.test.tsx`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`

## Change Log

- 2026-11-08: Story 16.7 implemented (bmad-dev-story): `notNeeded` item state with its invariant on every write path, needed-only counts and the overview suffix, the collapsed not-needed section and day-picker "mark needed and add", connector read/write/undo support, v2 backup field; 43 new tests. Status → review.
- 2026-11-08: Code review (bmad-code-review): 2 decisions resolved by Tommy (edit-dialog edits travel with the not-needed action; new text for a selection with only not-needed items), 6 patches applied with 8 new tests, 1 deferred (DW-444), 17 dismissed. Gates green: typecheck, lint 0 errors, check:migrations, 269 files / 4393 tests. Status → done.
