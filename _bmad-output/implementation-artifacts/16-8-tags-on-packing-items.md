---
baseline_commit: d95b088
---

# Story 16.8: Tags on Packing Items

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a traveller preparing the trip,
I want to put tags like "Kaufen", "Reparieren", "Aufladen" or "Zoll anmelden" on packing items, and filter by them,
so that one tap shows me everything I still have to buy, or charge, before I can pack it.

*Added 2026-11-08 at Tommy's request (John/PM); reverses the earlier "no tags" ruling. FRs covered: FR58 (tags, amended 2026-11-08), FR59 (tags shown on the day), FR51 (tags in the day email), FR53, FR54 (connector), FR57. Depends on 16.1, 16.2, 16.3, 16.4, 16.6, 16.7 (all done). Sequenced after 16.7, before 16.5 (which copies tags). **16.7 is done but not committed**: its changes (incl. migration `20261108140000_add_packing_item_not_needed`) are in the working tree on top of `d95b088`. Build on the working tree, not on the commit. Source: `epics.md` → Epic 16 / Story 16.8; `prd.md` FR58; memory ruling "free tags after all".*

## Acceptance Criteria

1. **Tag rules.** A tag is free text: NFC, trimmed, 1–30 characters, **no comma** (D4). An item carries 0 to 10 tags, unique per item ignoring case (`packingTagKey` = NFC, trimmed, lower-cased, the same folding as `packingNameKey`). **[default]**
2. **One spelling per trip.** Tags are matched ignoring case across the trip. When a tag is written whose key another item of the trip already uses, the existing spelling is stored (as `resolveCategory` does for categories), so "kaufen" joins "Kaufen". A different spelling of a tag on the item itself, unused elsewhere, is a case fix and is allowed. **[default]**
3. **Tags survive state changes.** Ticking an item packed, unticking it, marking it not needed or needed again keeps its tags. Tags are removed by hand only (no automatic removal).
4. **Add form.** For owner/contributor, the packing list page's add form has a tags field (below name and category): several tags as removable chips, suggestions = the localized defaults Kaufen/Buy, Reparieren/Repair, Aufladen/Charge, Zoll anmelden/Declare at customs, then every tag used on the trip not among them (alphabetically), minus the tags already in the field. **Enter or comma** turns the typed text into a tag; a duplicate (ignoring case) is ignored; the 11th tag is not accepted and the field shows "Höchstens 10 Tags." / "At most 10 tags.". Text still typed in the tags field when Add is pressed is added as a tag (never silently dropped). Tags stay in the field after a successful add, as the category does.
5. **Edit dialog.** The item's edit dialog has the same tags field, prefilled with the item's tags; each tag is removed with **one tap** on its chip's delete control (hit area ≥ 44 px). Save sends the full tag list. "Diesmal nicht nötig" / "Doch nötig" from the dialog also send changed tags (16.7 review lesson: `pendingEditsFor` carries every unsaved field).
6. **Adding an existing name with tags [default, D3].** Adding on the trip list a name that already exists answers `existed` as today (notice, highlight, section/filter reveal), **and** the given tags are added to the existing item (merge, existing spelling rules, nothing removed). If the merge would exceed 10 tags, nothing is written and the page shows "Dieser Gegenstand hat schon zu viele Tags." / "This item would have too many tags." (409 `too_many_tags`).
7. **Chips on items.** Each item shows its tags as small chips after its name, in the **soft `badge-pill`** variant (`primary.main` text on `tokens.accentSoft`, 11 px / 800, radius 4 px, padding 3 px 8 px; the `timePillSx` look in `TripDayView.tsx:2549`), sorted alphabetically (locale collator, D2), on:
   - the trip list rows,
   - the not-needed section rows (16.7),
   - the day's "Take along" rows (16.2, `TripDayPackingSection`).
   At phone width (360 px) the chips **wrap below the name** rather than truncating it; the name keeps `overflowWrap: "anywhere"`. Chips are display only (not clickable). Never use the warn colours (DESIGN.md reserves them for gaps), and do not use the AI badge's neutral look (`tokens.border` fill) — a tag must not read as "KI".
8. **Tag filter row.** With at least one tag on the trip (any item, needed or not), a row of tag chips appears **below 16.6's category chips** (or alone, if the category row is not shown because there is only one category group): "Alle Tags" / "All tags" first, then one chip per trip tag, sorted alphabetically (collator), labelled with the trip's spelling. Same look and behaviour as the category chips: toggle on tap, `aria-pressed`, horizontal scrolling (`nowrap`, `overflowX: auto`), 44 px height, `role="group"` with `aria-label` "Tags".
9. **Filter semantics.** Several selected tags = an item with **any** of them is shown (OR). Tags combine with the category selection and "Noch offen" by AND: *selected categories AND any selected tag AND not packed*. The not-needed section (16.7) applies the category and tag selection too ("Noch offen" still hides it entirely). Group heading counts ("Technik 4/7") keep counting the whole category, as they do under "Noch offen" (D6).
10. **Progress and messages.** 16.6's selection progress line ("Auswahl: 3 von 5 eingepackt") counts needed items matching the combined category + tag selection, and is shown when either selection is active and that count is > 0. The "all packed in your selection" (`allPackedSelection`) and "nothing needed in this selection" (`allNotNeededSelection`) messages apply to the combined selection.
11. **Remembered per viewer.** The tag selection is stored in the browser per trip (`travelplan.packingList.tags.<tripId>`, JSON array of tag keys), guarded like the category selection. A stored tag that no longer exists on the trip is ignored, never erased (it applies again if the tag comes back). Reveals (`revealedIds`) also end on a tag chip change.
12. **Prefill [default].** With exactly one tag selected, the add form's tags field is prefilled with that tag (trip spelling), on the trip's first load and on a tag chip change — never in an effect over the selection (16.6 lesson: it would overwrite what the person typed).
13. **Reveal.** An item added or edited so that it falls outside the stored category **or** tag selection stays visible for now (`revealIfOutsideSelection` checks both stored selections).
14. **Day email.** Each take-along item shows its tags after the name, `Powerbank (Aufladen, Kaufen)`, in the HTML and the text part, both escaped (`escapeHtml` on every tag in HTML). No tags → just the name. Both languages.
15. **Viewer.** A viewer sees the tag chips on items and can use the tag filter (and its remembered selection), without the tags field or any editing control. The API refuses viewer writes (403) as today.
16. **Backup (v2 archive).** Each entry of `trip.packingItems` carries `tags` (array of strings, in the item's display order). An archive without it imports with no tags. Import applies the tag rules: entries with an invalid tag (too long, comma, empty) fail validation like a too-long name; more than 10 in one entry fails validation. Entries merged by name key take the union of their tags (first spelling of the archive per tag key across the trip, capped at 10 in archive order). Not-needed items keep their tags.
17. **Connector reads.** `get_packing_list` items and `get_day`'s `packingItems` carry `tags` (array of strings, sorted by tag key). `get_trip` is unchanged. Descriptions say so.
18. **Connector writes.**
    - `add_packing_items` accepts `tags` per item (array, optional). A created item gets them; a name that resolves to an existing item **adds** the given tags to it (status stays `existed`; the item gets an `updated` receipt entry if a tag was actually added).
    - `update_packing_item` accepts `addTags` and `removeTags` (like `addDayIds`/`removeDayIds`): adding a tag the item has (ignoring case) and removing one it does not have are no-ops; a tag in both lists (ignoring case) is refused with `A tag cannot be in both addTags and removeTags.`; a call that only has tags is not "Nothing to change.".
    - A write that would leave an item with more than 10 tags writes nothing: `An item carries at most 10 tags` (update) / `items[i]: An item carries at most 10 tags` (add — the **whole** call is refused, nothing written).
    - Invalid tag text is refused with the field's message (`items[i]: …` for add, as name/category do).
19. **KI and undo.** Each connector tag change is marked KI (`aiChangedAt`) and undoable with the packing receipt: the snapshot gains `tags`, undo restores the prior tags exactly. Receipts stored before this story (no `tags`) still parse and undo, restoring no tag change (D5). App tag writes go through `origin: "user"` and clear `aiChangedAt`, like every app write.
20. **i18n.** All new UI text exists in German and English (see Task 9).
21. **Tests** cover: adding and removing tags; the limits (30 chars, comma, 10 per item, 409/tool error on merge overflow) and case-insensitive uniqueness; trip-wide spelling; suggestions from the trip; chips on the trip list, the not-needed section and the day section; the tag filter alone and combined with categories and "Noch offen"; the selection progress and messages; the remembered selection including a vanished tag; the add-form prefill; the day email in both languages (HTML + text, escaped); viewer read-only; export/import with and without tags (and the merge); the connector read (`get_packing_list`, `get_day`), add (new + existing + overflow), update (add/remove/both/overflow/no-op), and undo (including an old receipt without `tags`).

**Out of scope:** renaming or deleting a tag across the whole trip in one step; tag colours; tag filters in the day section, the day email or the connector; automatic tags (e.g. "Kaufen" removed when packed); tags in the day picker's options; copying (16.5 carries tags later).

## Tasks / Subtasks

- [x] **Task 1: Schema and migration** (AC: 1, 2)
  - [x] `prisma/schema.prisma`: new model after `PackingItemDay`, with a `// Story 16.8` comment:
    ```prisma
    model PackingItemTag {
      packingItemId String   @map("packing_item_id")
      tag           String   @map("tag")
      tagKey        String   @map("tag_key")
      createdAt     DateTime @default(now()) @map("created_at")

      packingItem PackingItem @relation(fields: [packingItemId], references: [id], onDelete: Cascade)

      @@id([packingItemId, tagKey])
      @@map("packing_item_tags")
    }
    ```
    and `tags PackingItemTag[]` on `PackingItem`. Why a table and not a JSON column: per-item uniqueness is enforced by the primary key, a tag change is an insert/delete instead of a read-modify-write of a string, and it mirrors `PackingItemDay` (D1).
  - [x] New migration `prisma/migrations/20261108160000_add_packing_item_tags/migration.sql` (header comment in the style of `20261108140000_add_packing_item_not_needed`): `CREATE TABLE "packing_item_tags" (...)` with the composite PK and `FOREIGN KEY ("packing_item_id") REFERENCES "packing_items" ("id") ON DELETE CASCADE ON UPDATE CASCADE`. Generate the SQL with `npx prisma migrate diff` (or `migrate dev --create-only`) rather than by hand, then check it. **Never edit an existing migration** (`npm run check:migrations`).
  - [x] `npx prisma generate` (`src/generated/prisma` is committed; regenerate, don't hand-edit).
- [x] **Task 2: Pure rules** (AC: 1, 2, 4, 8, 9, 11) — `src/lib/trips/packingList.ts` (no Prisma here)
  - [x] `PACKING_TAG_MAX = 30`, `PACKING_TAGS_PER_ITEM_MAX = 10`.
  - [x] `normalizePackingTag(raw)` (NFC + trim) and `packingTagKey(tag)` (normalized, lower-cased).
  - [x] `dedupePackingTags(tags)`: normalized, empties dropped, first spelling per key kept, input order.
  - [x] `sortPackingTags(tags, locale)`: collator `{ sensitivity: "base", numeric: true }`, ties by key (D2).
  - [x] `suggestedPackingTags(defaults, usedTags, locale)`: the twin of `suggestedPackingCategories` (defaults first, then used tags not among them, alphabetical).
  - [x] `collectPackingTags(items, locale)`: `{ key, label }[]` over every item's tags, first spelling met per key, sorted by label (collator) — feeds the chip row.
  - [x] `resolvePackingTagSelection(stored, tagKeys)`: stored keys (lower-cased again) that exist, in `tagKeys` order. **No "fewer than two" rule** (unlike categories: the row shows from one tag).
  - [x] `itemHasAnyPackingTag(item, selectedKeys)`: `true` for an empty selection.
  - [x] Unit tests in `test/packingList.test.ts`.
- [x] **Task 3: Validation** (AC: 1, 5, 6, 18) — `src/lib/validation/packingListSchemas.ts`
  - [x] Export `tagField`: NFC + trim, then `.min(1, "Tag is required")`, `.max(PACKING_TAG_MAX, "Tag must be at most 30 characters")`, `.refine(no ",", "Tag must not contain a comma")`.
  - [x] Export `tagsField = z.array(tagField).max(PACKING_TAGS_PER_ITEM_MAX, "An item carries at most 10 tags")` then `.transform(dedupePackingTags)`. Note: `max` on the raw array is a body bound; the real limit is checked again after the dedupe and, for merges, in the repository.
  - [x] `packingItemCreateSchema` gains `tags: tagsField.optional()`.
  - [x] `packingItemUpdateSchema` gains `tags: tagsField.optional()` (full replacement); the "Nothing to update" refine accepts it.
  - [x] `packingDayLinkCreateSchema` stays unchanged (the day picker takes no tags).
- [x] **Task 4: Repository** (AC: 1, 2, 3, 6, 18, 19) — `src/lib/repositories/packingListRepo.ts`
  - [x] `PackingItemDetail` gains `tags: string[]` (sorted by tag key; the client sorts for display). Add `tags: { select: { tag: true, tagKey: true }, orderBy: { tagKey: "asc" } }` to `detailSelect`, `DetailRow` and `toDetail`.
  - [x] `PackingItemForDay` / `listPackingItemsForDay` gain `tags` (same select) for the day email.
  - [x] New `resolveTags(tx, tripId, tags, excludeItemId?)`: for the given keys, the earliest existing spelling on the trip (`tx.packingItemTag.findMany({ where: { tagKey: { in }, packingItem: { tripId, id: { not: excludeItemId } } }, orderBy: [{ createdAt: "asc" }] })`), else the given spelling. The twin of `resolveCategory`.
  - [x] New `writeTagsInTx(tx, itemId, nextTags)`: diff against the item's rows by key → `deleteMany` removed keys, `update` a changed spelling, `create` added ones **one by one** (Prisma's `createMany({ skipDuplicates })` is not supported on SQLite). Returns whether anything changed. Kept rows keep their `createdAt`, so "first spelling on the trip" stays stable.
  - [x] A tag change must **write the item** too (`aiChangedAt` per origin, `updatedAt` by Prisma), exactly like a link change, so stale checks and receipt stamps see it.
  - [x] `createOrResolveInTx` gains `tags?: string[]`: a created item gets them (resolved); an `existed` item gets the **missing** ones added (merge) — but only when the caller passes `mergeTags: true` (the list add and the connector add). Over 10 after the merge → throw `PackingTagLimitError` (a new error class) so the transaction rolls back. The day add (`addPackingItemToDay`) passes no tags and is unchanged.
  - [x] `createPackingItem` gains `tags`; new result `{ status: "too_many_tags" }` from the caught `PackingTagLimitError`. An `existed` answer with merged tags returns the fresh item. **Trap:** its catch treats any `P2002` as "the name was created concurrently" and looks up the winner by name — keep that, but make sure a `PackingTagLimitError` is checked first.
  - [x] `updatePackingItem` gains `tags?: string[]` (full replacement, resolved with `excludeItemId`), result `too_many_tags` is impossible here (the schema caps the replacement at 10) — no new status. **Trap:** its catch maps **every** unique violation to `duplicate_name`. A concurrent identical tag insert would be misreported. Guard it as 16.4 did for the connector (`params.name !== undefined && isUniqueViolation(error)`), and let other unique violations retry once (`retryOnceOnUniqueViolation`) or rethrow.
  - [x] Connector, `snapshotSelect` / `toSnapshot`: add `tags` (the stored spellings, tag-key order).
  - [x] `addPackingItemsForConnector`: items gain `tags?: string[]`. Pass them with `mergeTags: true`. An existing item that gained a tag gets an `updated` entry with its `before` snapshot (read before the resolve, as today), unless it already has an entry. Catch `PackingTagLimitError` **outside** the transaction and answer `{ status: "too_many_tags"; index }` (the error carries the input index). Do not `return` from inside the loop (16.7 lesson: only a throw rolls back the creates made earlier in the batch).
  - [x] `updatePackingItemForConnector` gains `addTags?: string[]`, `removeTags?: string[]` and result `{ status: "too_many_tags" }`. Compute the next set from `current.tags` (add missing keys with resolved spelling, remove given keys), check the limit **before any write**, include "tags changed" in the no-op detection (`unchanged` writes nothing, runs no hook). Keep the 16.4 guard that maps only a rename's unique violation to `duplicate_name`.
  - [x] `undoPackingChangeForTrip`: new `restoreTags(tx, itemId, tags)` (delete all rows, create `before.tags` in order) for the `updated` restore and the `deleted` recreate — **only when `before.tags` is defined** (an old receipt has none: leave tags untouched, D5). Restore tags **before** the final `packingItem.update` that writes `updatedAt: before.updatedAt`, so nothing bumps the stamp afterwards (`@updatedAt` is set on item updates only; tag row writes don't touch the item, but keep the order anyway).
  - [x] Update the file's header doc comment with a Story 16.8 paragraph.
- [x] **Task 5: Receipt** (AC: 19)
  - [x] `src/lib/trips/packingChangeReceipt.ts`: `PackingItemSnapshot` gains `tags` — in memory `tags?: string[]` (absent = a receipt from before 16.8, undo leaves tags alone) — and `mapSnapshot` copies it when present. Keep `version: 1`.
  - [x] `packingChangeReceiptSchemas.ts`: `tags: z.array(z.string()).max(PACKING_TAGS_PER_ITEM_MAX * 2).optional()` in the `.strict()` `snapshotSchema` (no length cap on stored text, per the file's own rule).
  - [x] Test (`aiChangeRepo.test.ts`): a stored receipt without `tags` parses and undoes.
- [x] **Task 6: App API** (AC: 4, 5, 6)
  - [x] `src/app/api/trips/[id]/packing-items/route.ts`: POST passes `tags`, maps `too_many_tags` → 409 `too_many_tags` "Packing item would carry more than 10 tags". PATCH passes `tags`. Update the route doc comment.
  - [x] `shared.ts` `toWire` spreads the detail, so `tags` flows through. Verify with a route test.
- [x] **Task 7: Backup** (AC: 16) — `tripRepo.ts` (**use `grep -a`**: the file contains a byte that makes plain `grep` print nothing)
  - [x] `TripExportPackingItem` (~435) gains `tags: string[]`; the export select (~1943) adds `tags: { select: { tag: true, tagKey: true }, orderBy: { tagKey: "asc" } }`; the mapping (~2587) adds `tags: item.tags.map((row) => row.tag)`. Add a line to the `export/route.ts:44-45` comment.
  - [x] `tripImportSchemas.ts` `packingItemImportSchema` (~613) gains `tags: z.array(<tag rules>).max(10).optional().default([])` (reuse the length/comma rules; import the constants, not the app schema with its transform, if that keeps the schema readable).
  - [x] `createImportedPackingItems` (~3193): merged entries take the union of tags by key (first-seen spelling, a trip-wide `tagSpelling` map like `categorySpelling`), capped at 10 in archive order; create the tag rows after the item (`packingItemTag.create` per tag). Tags are kept for not-needed items. Update the doc comment.
- [x] **Task 8: Connector** (AC: 17, 18, 19)
  - [x] `src/lib/mcp/packingShapes.ts` `toPackingItem`: `tags` after `notNeeded`.
  - [x] `src/lib/repositories/connectorReadRepo.ts:132,263`: the day's `packingItems` select and type gain `tags` (same select as the repo); `src/lib/mcp/plannerShapes.ts:219` maps `tags: item.tags.map((row) => row.tag)` (or whatever shape the read returns — keep one mapping).
  - [x] `src/lib/mcp/tools/tripRead.ts`: `get_day` description mentions `tags` on `packingItems`.
  - [x] `src/lib/mcp/tools/packingTools.ts`:
    - Export `PACKING_TAG_LIMIT = "An item carries at most 10 tags"` and `TAG_IN_BOTH = "A tag cannot be in both addTags and removeTags."`.
    - `addInput.items[]` gains `tags: z.array(z.string()).max(PACKING_TAGS_PER_ITEM_MAX).optional().describe(...)`; validate each with `tagField` in the existing per-item loop (`items[i]: <message>.`), dedupe.
    - `updateInput` gains `addTags` / `removeTags` (`z.array(z.string()).max(PACKING_TAGS_PER_ITEM_MAX)`), validated with `tagField`; the "nothing to change" guard counts them; `TAG_IN_BOTH` by tag key.
    - Map `too_many_tags` → `toolError(PACKING_TAG_LIMIT)` / `` `items[${index}]: ${PACKING_TAG_LIMIT}` ``; extend the exhaustive `switch` (its `never` default flags a missed status).
  - [x] Descriptions: `get_packing_list` (tags = free labels such as Kaufen, Aufladen; at most 10 per item; matched ignoring case across the trip, stored in the trip's first spelling); `add_packing_items` (tags per item; for a name that exists, the tags are added to it); `update_packing_item` (addTags/removeTags, the limit, packing or marking not needed keeps tags).
  - [x] No new tool and no new `ai_changes` action; tag changes go through `packingAdded` / `packingUpdated` with the item name as subject.
- [x] **Task 9: i18n** (AC: 20) — both `src/i18n/de.ts` and `src/i18n/en.ts`, next to the `trips.packingList.*` keys (`test/i18nDictionaries.test.ts` checks parity)

  | key | de | en |
  |---|---|---|
  | `tagsLabel` | Tags | Tags |
  | `tagFilterLabel` | Tags | Tags |
  | `allTags` | Alle Tags | All tags |
  | `tagLimit` | Höchstens 10 Tags. | At most 10 tags. |
  | `tagRemoveAria` | Tag {tag} entfernen | Remove tag {tag} |
  | `tooManyTags` | Dieser Gegenstand hat schon zu viele Tags. | This item would have too many tags. |
  | `suggestTag.buy` | Kaufen | Buy |
  | `suggestTag.repair` | Reparieren | Repair |
  | `suggestTag.charge` | Aufladen | Charge |
  | `suggestTag.customs` | Zoll anmelden | Declare at customs |

  `packingApiErrorMessage` gains `case "too_many_tags": return t("trips.packingList.tooManyTags")`.
- [x] **Task 10: UI pieces** (AC: 4, 5, 7) — one new file `src/components/features/trips/PackingTags.tsx`
  - [x] `PackingTagChips({ tags })`: the display chips (soft `badge-pill`, see AC 7), sorted with `sortPackingTags(tags, locale)`, `data-testid="packing-tag"` per chip, `whiteSpace: "nowrap"` per chip; renders nothing for no tags.
  - [x] `PackingTagInput({ value, onChange, options, disabled })`: MUI `Autocomplete` `multiple freeSolo`, controlled `value` + `inputValue`. Enter adds (freeSolo default); a comma in `onInputChange` splits: complete pieces become tags, the rest stays typed. Dedupe by key, ignore past 10 and show `tagLimit` as helper text, `maxLength={PACKING_TAG_MAX}` on the input, options filtered to exclude chosen keys. Chips in the field use the MUI v7 API (`renderValue`, `renderTags` is deprecated in v7 — check the installed `@mui/material` 7.3 typings) with a delete control whose hit area is ≥ 44 px and `aria-label` = `tagRemoveAria`. Expose a way for the parent to flush pending typed text on submit (e.g. `onChange` called from `onBlur`, or a `commitPending()` via ref — pick one and test it).
  - [x] `usePackingTagOptions(items)` (beside `usePackingCategoryOptions` in `TripPackingList.tsx` or in the new file): defaults in the UI language + the trip's tags.
- [x] **Task 11: Packing list page** (AC: 4–13, 15) — `TripPackingList.tsx`
  - [x] `PackingItemWire` gains `tags: string[]`.
  - [x] State `tags` (add form) and `editTags` (dialog). `handleAdd` sends `tags` (after flushing typed text); keep `tags` after success. `openEdit` sets `editTags`; `handleSave` sends `tags`; `pendingEditsFor` includes `tags` when the set differs from the item's (compare keys).
  - [x] `handleAdd`: 409 `too_many_tags` → `actionError` via `resolveApiError`. An `existed` answer upserts the item (now with merged tags) as today.
  - [x] Tag selection: `storedTagSelection` state, `packingTagStorageKey(tripId)`, read/store helpers guarded like `readStoredCategories`/`storeCategories`; restore in the load effect next to the category restore, inside the `restoredForTrip` branch for the prefill only (the stored value is re-read on every load, as for categories).
  - [x] `tagChips = collectPackingTags(items, locale)` (all items); `tagSelection = resolvePackingTagSelection(storedTagSelection, tagChips.map(k))`.
  - [x] Replace the group-level `inSelection` with an item predicate `inSelection(item) = revealed || (category selected or none) && itemHasAnyPackingTag(item, tagSelection)`; use it for `visibleGroups` and `notNeededVisible`. Heading counts stay group totals (D6).
  - [x] Selection progress: active when `selection.length > 0 || tagSelection.length > 0`; `selectedTotal`/`packed` over **needed items** matching categories AND tags (ignore reveals, as today). Messages (`allPackedSelection`, `allNotNeededSelection`) use the same "selection active" condition.
  - [x] Tag chip row below the category row: shown when `tagChips.length >= 1`; "Alle Tags" + chips; `changeTagSelection(next)` stores, ends reveals (`setRevealedIds(new Set())`), and with exactly one tag prefills the add form's tags with `[label]`. Factor the chip row markup so both rows share it (same `Chip` sx).
  - [x] `revealIfOutsideSelection`: outside when the stored category selection excludes it **or** the stored tag selection is non-empty and the item has none of those keys.
  - [x] Add form: the tags field on its own full-width line under name + category (`flex: "1 1 100%"`), the Add button stays reachable at 360 px.
  - [x] Rows (main list and not-needed section): name and `PackingTagChips` in a `flex-wrap` box (`columnGap` 0.75, `rowGap` 0.5, `alignItems: "center"`), so chips wrap below the name; the days line stays below.
  - [x] Viewer: chips and filter row; no tags field (it lives in the writer-only form/dialog).
- [x] **Task 12: Day section** (AC: 7) — `TripDayPackingSection.tsx` ~line 417: wrap the name `Typography` and `PackingTagChips` in the same `flex-wrap` box (`flex: "1 1 auto", minWidth: 0`). Picker unchanged.
- [x] **Task 13: Day email** (AC: 14) — `src/lib/notifications/dayEmail.ts:217,243`: a local `withTags(entry)` → `name` or `name (tag1, tag2)` (tags sorted with `sortPackingTags(…, language)`); text part uses it raw, HTML escapes name and each tag (`escapeHtml(name) + " (" + tags.map(escapeHtml).join(", ") + ")"`). `PackingItemForDay` now carries `tags`; update every caller/fixture (`email/route.ts`, tests).
- [x] **Task 14: Tests** (AC: 21). Extend the existing suites; add no new test file — `PackingTags.tsx` is covered through `tripPackingList.test.tsx` and `tripDayPackingSection.test.tsx`.
  - [x] `test/packingList.test.ts`: the pure helpers (normalize/key/dedupe/sort/suggest/collect/resolve selection incl. vanished key, `itemHasAnyPackingTag`).
  - [x] `test/packingListRepo.test.ts`: create with tags; existed + merge; merge overflow → `too_many_tags` and nothing written; update replace (add/remove/case fix); trip-wide spelling ("kaufen" stored as "Kaufen"); tags kept on pack/unpack/not-needed/needed; tag write bumps `updatedAt` and sets/clears `aiChangedAt` per origin; item delete cascades tags; connector add (new/existing/overflow whole-batch rollback — count items and tag rows before/after), connector update (add/remove/no-op `unchanged`/overflow), undo restores tags; old snapshot without `tags` leaves tags untouched.
  - [x] `test/packingListRoute.test.ts`: POST/PATCH with `tags`; 400 for a 31-char tag, a comma, 11 tags; 409 `too_many_tags`; viewer 403; `toWire` carries `tags`.
  - [x] `test/packingListBackup.test.ts`: round trip with tags; archive without `tags`; merge union + cap; invalid tag refused.
  - [x] `test/tripExportRoute.test.ts`: pinned packing item shape gains `tags` (expect red first; fix by asserting the new shape, **not** by loosening `toEqual`).
  - [x] `test/dayEmail.test.ts`: tags after the name in HTML and text, escaped (`<b>` in a tag), both languages; no tags = name only.
  - [x] `test/tripPackingList.test.tsx`: chips on rows and in the not-needed section; tags field add (Enter, comma, duplicate ignored, 10 limit message, pending text flushed on Add); edit dialog remove in one tap + save payload; "Diesmal nicht nötig" carries changed tags; tag filter alone, with categories, with "Noch offen", in the not-needed section; selection progress and messages; remembered selection + vanished tag ignored and not erased; prefill on first load and on chip change (and not overwriting typed tags on reload); reveal of an item added outside the tag selection; 409 `too_many_tags` message; viewer sees chips and filter, no field.
  - [x] `test/tripDayPackingSection.test.tsx`: chips after the name in the day rows.
  - [x] `test/mcpPackingTools.test.ts`: `get_packing_list` `tags`; add with tags (new, existing merge → `updated` receipt entry, overflow `items[i]: …` nothing written, invalid tag); update `addTags`/`removeTags`, `TAG_IN_BOTH`, overflow, tags-only call; `undo_ai_change` restores tags; KI marker.
  - [x] `test/mcpReadTools.test.ts` / `test/mcpPlannerShapes.test.ts` / `test/mcpRouteShapes.test.ts`: `get_day.packingItems[].tags`; fixtures gain `tags` where the type requires it.
  - [x] `test/aiChangeRepo.test.ts`: stored receipt without `tags` parses and undoes.
  - [x] Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run check:migrations`, `npm run build`. **Baseline after 16.7: 269 files / 4393 tests green.** Re-measure before starting rather than assuming.

### Review Findings

- [x] [Review][Decision] Vanished stored tag is dropped on the next chip tap — AC 11 says a stored tag that no longer exists is "ignored, never erased"; it is ignored on load, but `toggleTag`/`changeTagSelection` rebuild the stored list from `tagChips` only, so the next tap erases it (the test asserts that). `toggleCategory` (16.6) behaves identically. Options: keep the 16.6 behaviour and read AC 11 as "on load", or carry vanished keys through every store. **Resolved (Tommy, 2026-11-08): option 1, keep the 16.6 behaviour; AC 11 "never erased" applies to the load.**
- [x] [Review][Patch] Edit dialog Save always sends the full tag list, deleting tags the connector or another person added while the dialog was open — send `tags` only when `!samePackingTags(committed.tags, editTarget.tags)` [travelplan/src/components/features/trips/TripPackingList.tsx:666]
- [x] [Review][Patch] `updatePackingItem` maps any unique violation to `duplicate_name` when a name is sent (the dialog always sends it), so a tag race reads "name exists"; a second violation is a 500 — rerun once on any unique violation (the rerun's clash check answers a real name race), then `duplicate_name` only for a rename [travelplan/src/lib/repositories/packingListRepo.ts:546]
- [x] [Review][Patch] Connector `updatePackingItemForConnector` does not rerun on a tag-race unique violation (surfaces as a generic error) — rerun once, the rerun answers stale/duplicate properly [travelplan/src/lib/repositories/packingListRepo.ts:1053]
- [x] [Review][Patch] "Diesmal nicht nötig" / "Doch nötig" from the dialog silently drop typed tag text refused by the 10-tag limit (Save refuses instead) — abort these actions when the commit is refused [travelplan/src/components/features/trips/TripPackingList.tsx:642]
- [x] [Review][Patch] `maxLength` on the tags input truncates a pasted comma list ("Kaufen, Aufladen, Zoll anmelden" loses its end) — drop it from the input; `addPackingTags` already caps each piece [travelplan/src/components/features/trips/PackingTags.tsx:240]
- [x] [Review][Patch] Add form: Tab reaches Add before the tags field, and the tags field is not disabled while adding — DOM order tags before the button with flex `order`, pass `disabled={addBusy}` [travelplan/src/components/features/trips/TripPackingList.tsx:1027]
- [x] [Review][Patch] Import: a tag skipped by an item's 10-cap does not register its archive spelling, so a later item uses its own spelling — register `tagSpelling` before the cap check [travelplan/src/lib/repositories/tripRepo.ts:3238]
- [x] [Review][Patch] Comments: the export route says tags come "in the item's display order" (they are in tag-key order); the export test says "a not-needed item keeps its own" but gives it none [travelplan/src/app/api/trips/[id]/export/route.ts:46, travelplan/test/tripExportRoute.test.ts:357]
- [x] [Review][Patch] Missing tests: tool descriptions mention tags (AC 17); the tag chip delete control's 44 px hit area by style (AC 5) [travelplan/test/mcpPackingTools.test.ts, travelplan/test/tripPackingList.test.tsx]
- [x] [Review][Defer] Undo restores snapshot tag spellings without trip resolution and with fresh `createdAt` — a second spelling of one key can return [travelplan/src/lib/repositories/packingListRepo.ts:1108] — deferred, DW-445
- [x] [Review][Defer] `createPackingItem` after two lost races answers `existed` without merging the given tags [travelplan/src/lib/repositories/packingListRepo.ts:446] — deferred, DW-446
- [x] [Review][Defer] No index on `packing_item_tags.tag_key`; `resolveTags` cannot use the item-first primary key [travelplan/prisma/migrations/20261108160000_add_packing_item_tags/migration.sql] — deferred, DW-447

## Dev Notes

### Deviations and defaults (decided here, flagged for Tommy)

- **D1: Tags live in their own table `packing_item_tags`** (item id + tag key as primary key), not in a JSON column. Uniqueness per item is a database rule, and adding/removing a tag never rewrites the others.
- **D2: Tags on an item are shown alphabetically** (locale collator), not in the order they were added. The epic does not say; alphabetical is predictable and needs no position column.
- **D3: The app's add of an existing name adds the typed tags to that item** (same rule the epic sets for the connector). Otherwise, with the tag filter on "Kaufen" and the field prefilled, re-adding "Sonnencreme" would answer "already on the list" and the item would still be hidden by the filter. The 16.1 notice and highlight are unchanged; nothing else of the item changes.
- **D4: A tag cannot contain a comma**, because comma is the separator in the input and in the day email ("Powerbank (Aufladen, Kaufen)").
- **D5: The receipt stays `version: 1`** with optional `tags` (as 16.7's D5). A receipt from before 16.8 has no tags, and its undo leaves the item's tags as they are (a tag change could not have been part of it).
- **D6: Category heading counts ("Technik 4/7") ignore the tag filter**, as they already ignore "Noch offen". The selection progress line is the count of the filtered view.
- **D7: Over-limit merges are refused, not truncated** — app 409 `too_many_tags`, connector `An item carries at most 10 tags` for the whole call. The backup import is the exception: it never refuses a merge (it caps at 10, archive order), matching its "nothing refused" stance for merges.

### Current state of the files this story touches (as of the 16.7 working tree)

- **`packingListRepo.ts` (972 lines).** Every write re-checks `findTripForTripWriter` (owner, or member with explicit `role: "CONTRIBUTOR"` — keep that). App writes set `aiChangedAt` via `aiChangedAtFor(origin)`. `resolveCategory` (175-192) is the exact pattern for `resolveTags`. `linkInTx` → `touchItem` is how a side-table change also writes the item. Connector writes run `inTransaction` last; a no-op writes nothing and runs no hook. `addPackingItemsForConnector` reads `before` snapshots before the resolve (685-688) and must keep doing so for tag merges. `undoPackingChangeForTrip` restores links via `restoreLinks` (874-885): `restoreTags` is its twin. Stamps are compared with `getTime()`.
- **`TripPackingList.tsx` (1332 lines).**
  - Three groupings since 16.7: `chipGroups` (all items: chips, selection, prefill), `neededGroups` (list + counts), `notNeededGroups` (section). The tag row uses all items too.
  - `inSelection` (384-387) is group-level today; it becomes item-level.
  - The load effect (252-308) restores selections and prefills **only on the trip's first load** (`restoredForTrip`); the effect also re-runs on language switch and reloads.
  - `revealIfOutsideSelection` (435-440) decides against the **stored** selection on purpose. Keep that for tags.
  - `pendingEditsFor` (534-542): extend with tags.
  - Every successful write bumps `writeCount` via `send`.
- **`TripDayPackingSection.tsx` (560 lines).** Row markup at ~386-437; the name is a 12.5 px/600 `Typography` with `flex: "1 1 auto"`.
- **`dayEmail.ts`.** Text lines at ~217 (`- ${entry.name}`), HTML `<li>` at ~243 with `escapeHtml(entry.name)`.
- **`tripRepo.ts`.** Export type 435, select 1943, mapping 2587, import 3193 (`createImportedPackingItems`, with the 16.7 merge rules). `grep -a` only.
- **`connectorReadRepo.ts:263`, `plannerShapes.ts:219`.** `get_day`'s packing items (select `{ id, name, category, packed }`).
- **`packingTools.ts` (376 lines).** Per-item validation loop at 207-213, update guards at 267-278, exhaustive `switch` at 314-333.

### Traps

- **`updatePackingItem`'s catch maps every `P2002` to `duplicate_name`** (382-385). With a tag table, a unique violation can also be a concurrent identical tag. Guard by `params.name !== undefined` (as the connector does at 836) and retry or rethrow otherwise.
- **`createMany({ skipDuplicates: true })` does not exist for SQLite in Prisma.** Diff and create one by one inside the transaction.
- **Return vs throw inside a batch transaction**: a `return` commits the creates already made; only a throw rolls back (16.7 note). The tag-limit refusal in the connector add must throw.
- **The highlight must point at a rendered row** (16.6/16.7): with a tag filter active, an `existed` add whose item lacks the selected tag must be revealed before the highlight effect runs (`revealIfOutsideSelection` handles it once it checks tags).
- **Prefill only in handlers and the first load** — never an effect over the selection.
- **MUI Autocomplete `multiple` + `freeSolo`**: with a controlled `inputValue`, an un-entered text is lost on blur unless handled; AC 4 requires flushing it on Add/Save.
- **Pinned shapes will go red first**: `tripExportRoute.test.ts` (packing items), `mcpPackingTools` item shapes, `mcpReadTools` `get_day`. Fix by asserting the new shape.

### Response and description conventions (connector)

- Error strings are exact and asserted by tests; batch refusals are prefixed `items[i]: `.
- Tools call repositories only (Epic 15 rule, `server.ts`). No Prisma in `packingTools.ts`.
- `get_trip` keeps its shape.

### Design

- Tag chips: soft `badge-pill` (`primary.main` on `tokens.accentSoft`, 11 px/800, radius 4, padding 3 px 8 px). Not warn (reserved for gaps), not the AI badge's `tokens.border` neutral fill.
- Filter chips: identical to 16.6's category chips (44 px, 22 px radius, filled primary when selected, outlined otherwise, scrolling row).
- 44 px targets for every new control, including the delete control of a chip in the tags field. One-handed at 360 px, no horizontal page scroll (the chip rows scroll inside themselves).

### Testing

- Helpers: `test/helpers/connectorWriteFixtures.ts` (`setupConnectorTrip`, `structured`, `errorText`, `storedReceipt`), `test/helpers/mcpClient.ts` (`callTool`), `test/helpers/renderWithProviders.tsx`, `test/helpers/mockFetch.ts`, `test/helpers/routeContext.ts`.
- The DB is migrated per run (`test/globalSetup.ts` / `test/setup.ts`, `prisma migrate deploy`), so the new migration is picked up automatically. A missing `prisma generate` shows as type errors on `packingItemTag`.
- Clean-up chains that delete users/trips already cascade to items and therefore tags.

### Previous story intelligence

- **16.7:** the invariant table pattern (one row per write path) worked well; list every tag write path the same way when implementing (app create/existed, app PATCH, connector add/existed, connector update, import, undo). Review lessons: actions in the edit dialog must carry unsaved edits; a selection whose needed total is 0 shows `allNotNeededSelection` and no "0 von 0" line.
- **16.6:** chips/selection use group keys; vanished stored keys are ignored, never erased; prefill in handlers and first load only; a restored chip can sit off-screen (DW-440, open — don't fix in passing).
- **16.4:** a no-op connector write answers `aiChangeId: null`; only a rename maps a unique violation to `duplicate_name`; subjects are read in-transaction (`storedNamesOf`).
- **16.3:** the day email groups with `groupPackingItems` and escapes everything; test both languages.
- **15.4/15.5:** compare stamps with `getTime()`; undo restores `updatedAt`/`aiChangedAt` explicitly.
- Open ledger items not to "fix" in passing: DW-434, DW-435, DW-436, DW-440, DW-441, DW-442, DW-443, DW-444.

### Git intelligence

- `d95b088` (16.3 + 16.4), `fa84061` (16.2 + 16.6), `c111d8e` (16.1) set the patterns: repo + route + `shared.ts` `toWire`, client component with guarded `localStorage`, tests per layer. 16.7 (uncommitted, working tree) added `notNeeded` across the same layers — the closest template for this story's shape changes.
- No new dependency: MUI 7.3 (`Autocomplete`, `Chip`), Prisma 7.10 with the better-sqlite3 adapter, zod 4.1.

### Project Structure Notes

- New files: `prisma/migrations/20261108160000_add_packing_item_tags/migration.sql`, `src/components/features/trips/PackingTags.tsx` (plus regenerated `src/generated/prisma/**`, which gains a `PackingItemTag` model file).
- No new route, no new tool, no new `ai_changes` action. Receipt version stays 1.
- There is no `project-context.md` in this repository; conventions come from the code and the previous stories.

### References

- `_bmad-output/planning-artifacts/epics.md` → Epic 16, Story 16.8 (~5348), 16.7 (~5299), 16.5 (~5227, copies tags)
- `_bmad-output/planning-artifacts/prd.md` FR58 (amended 2026-11-08)
- `_bmad-output/planning-artifacts/sprint-change-proposal-2026-11-08-packing-list.md`
- `_bmad-output/implementation-artifacts/16-7-not-needed-this-time.md` (defaults, review findings), `16-6-my-part-of-the-list.md` (selection rules), `16-4-the-packing-list-through-the-connector.md` (receipt, connector conventions)
- `_bmad-output/planning-artifacts/ux-designs/ux-TravelPlan-2026-07-27/DESIGN.md` (`badge-pill`, warn reservation at line 234)
- Code: `travelplan/src/lib/trips/packingList.ts`, `travelplan/src/lib/repositories/packingListRepo.ts`, `travelplan/src/lib/validation/packingListSchemas.ts`, `travelplan/src/lib/trips/packingChangeReceipt.ts`, `travelplan/src/lib/validation/packingChangeReceiptSchemas.ts`, `travelplan/src/app/api/trips/[id]/packing-items/route.ts`, `travelplan/src/lib/repositories/tripRepo.ts`, `travelplan/src/lib/validation/tripImportSchemas.ts`, `travelplan/src/lib/mcp/tools/packingTools.ts`, `travelplan/src/lib/mcp/packingShapes.ts`, `travelplan/src/lib/mcp/plannerShapes.ts`, `travelplan/src/lib/repositories/connectorReadRepo.ts`, `travelplan/src/lib/mcp/tools/tripRead.ts`, `travelplan/src/lib/notifications/dayEmail.ts`, `travelplan/src/components/features/trips/TripPackingList.tsx`, `travelplan/src/components/features/trips/TripDayPackingSection.tsx`, `travelplan/src/components/features/trips/TripDayView.tsx:2548` (pill styles)

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (claude-opus-5-5) via bmad-dev-story

### Debug Log References

- Baseline before the story (16.7 working tree): 4401 tests green.
- `prisma migrate diff` also emits an unrelated, pre-existing `cost_payments` redefine (schema drift from before this story). The new migration takes only the `CreateTable "packing_item_tags"` part; a re-run of the diff afterwards shows no `packing_item_tags` difference.
- Pinned shapes went red first as the story predicted and were fixed by asserting the new shape, not by loosening: `tripExportRoute` (packing items), `mcpPackingTools` (`get_packing_list` item, `get_day.packingItems`), `packingListRepo` (`listPackingItemsForDay`), `tripPackingList` (POST body now carries `tags: []`).
- First full run: 3 failures in `test/tripDayViewPacking.test.tsx` — its untyped `packingItem` fixture had no `tags`, and `PackingTagChips` read `tags.length`. Fixed the fixture (`tags: []`) and made `PackingTagChips` / `PackingNameWithTags` accept `undefined` (a page left open across a deploy can hold a pre-16.8 payload). Re-run: 269 files / 4448 tests green.
- `tripRepo.ts` edited with Python using `errors="surrogateescape"`; `git diff --stat` shows only the intended hunks.

### Completion Notes List

- **Write paths (16.7's invariant-table pattern).** Every tag write also writes the item (`aiChangedAt` per origin, `updatedAt`):
  | path | tags | limit |
  |---|---|---|
  | app add, new name | created with the item (nested create), trip spelling | schema ≤ 10 |
  | app add, existing name (D3) | missing ones added, item touched; nothing given/nothing new → nothing written | `PackingTagLimitError` → 409 `too_many_tags`, nothing written |
  | app PATCH | full replacement via `writeTagsInTx` (diff by key, kept rows keep `createdAt`) | schema ≤ 10 |
  | connector add | as app add, `updated` receipt entry when a tag was added | thrown with input index → whole batch rolled back, `items[i]: An item carries at most 10 tags` |
  | connector update | `addTags` / `removeTags`, checked before any write, part of the no-op detection | `too_many_tags` → `An item carries at most 10 tags` |
  | backup import | union by key, first archive spelling trip-wide, capped at 10 (never refused) | cap |
  | undo | `restoreTags` before the stamp-restoring item write; skipped for a receipt without `tags` (D5) | — |
  | pack / not needed / day add | untouched | — |
- **Trap handling.** `updatePackingItem` now maps a unique violation to `duplicate_name` only when a name was given; otherwise it reruns once. `createPackingItem` reruns once on a unique violation (so a tag merge applies to a concurrent winner) and checks `PackingTagLimitError` first; the old winner lookup remains as the fallback.
- **Tags field flush.** Chosen: the parent owns both the tags and the typed text (`inputValue`), and `commitPackingTagText` adds the typed text on Add/Save and in `pendingEditsFor`. If the typed text would pass the limit, nothing is sent and the field keeps the text with "At most 10 tags." (never silently dropped). Tested.
- **Chip delete hit area.** The `Chip` delete control is a 44×44 span (`role="button"`, `aria-label` "Remove tag {tag}") with negative margins, so the chip stays compact. jsdom cannot measure layout; the 44 px is asserted only by style for the filter chips.
- **Defaults D1–D7** implemented as written in Dev Notes. No new dependency, no new route or tool, no new `ai_changes` action, receipt stays `version: 1`.
- **Tests added/extended:** packingList (8 pure-rule/schema tests), packingListRepo (13), packingListRoute (2), packingListBackup (3), mcpPackingTools (5), aiChangeRepo (1), mcpPlannerShapes (1 assertion), dayEmail (3), tripPackingList (19), tripDayPackingSection (1); pinned shapes in tripExportRoute, mcpPackingTools, packingListRepo, tripPackingList updated.
- **Validation:** full suite 269 files / 4448 tests green (baseline 4401); `npm run typecheck` clean; `npm run lint` 0 errors (no warnings in touched files); `npm run check:migrations` passes; `npm run build` compiles.

### File List

- `travelplan/prisma/schema.prisma` (modified: `PackingItemTag` model, `PackingItem.tags`)
- `travelplan/prisma/migrations/20261108160000_add_packing_item_tags/migration.sql` (new)
- `travelplan/src/generated/prisma/browser.ts`, `client.ts`, `models.ts`, `internal/class.ts`, `internal/prismaNamespace.ts`, `internal/prismaNamespaceBrowser.ts`, `models/PackingItem.ts` (regenerated)
- `travelplan/src/generated/prisma/models/PackingItemTag.ts` (new, generated)
- `travelplan/src/lib/trips/packingList.ts` (modified)
- `travelplan/src/lib/validation/packingListSchemas.ts` (modified)
- `travelplan/src/lib/validation/packingChangeReceiptSchemas.ts` (modified)
- `travelplan/src/lib/validation/tripImportSchemas.ts` (modified)
- `travelplan/src/lib/trips/packingChangeReceipt.ts` (modified)
- `travelplan/src/lib/repositories/packingListRepo.ts` (modified)
- `travelplan/src/lib/repositories/tripRepo.ts` (modified)
- `travelplan/src/lib/repositories/connectorReadRepo.ts` (modified)
- `travelplan/src/lib/mcp/packingShapes.ts` (modified)
- `travelplan/src/lib/mcp/plannerShapes.ts` (modified)
- `travelplan/src/lib/mcp/tools/packingTools.ts` (modified)
- `travelplan/src/lib/mcp/tools/tripRead.ts` (modified)
- `travelplan/src/lib/notifications/dayEmail.ts` (modified)
- `travelplan/src/app/api/trips/[id]/packing-items/route.ts` (modified)
- `travelplan/src/app/api/trips/[id]/export/route.ts` (modified, doc comment)
- `travelplan/src/components/features/trips/PackingTags.tsx` (new)
- `travelplan/src/components/features/trips/TripPackingList.tsx` (modified)
- `travelplan/src/components/features/trips/TripDayPackingSection.tsx` (modified)
- `travelplan/src/i18n/de.ts`, `travelplan/src/i18n/en.ts` (modified)
- `travelplan/test/tripDayViewPacking.test.tsx` (modified: fixture gains `tags`)
- `travelplan/test/packingList.test.ts`, `packingListRepo.test.ts`, `packingListRoute.test.ts`, `packingListBackup.test.ts`, `tripExportRoute.test.ts`, `dayEmail.test.ts`, `tripPackingList.test.tsx`, `tripDayPackingSection.test.tsx`, `mcpPackingTools.test.ts`, `mcpPlannerShapes.test.ts`, `aiChangeRepo.test.ts` (modified)
- `_bmad-output/implementation-artifacts/sprint-status.yaml`, `_bmad-output/implementation-artifacts/16-8-tags-on-packing-items.md` (status tracking)

### Change Log

- 2026-11-08: Code review (bmad-code-review): 1 decision resolved (keep 16.6 selection behaviour), 9 patches applied (edit Save sends tags only when changed; app and connector updates rerun once on a unique violation; dialog not-needed/needed actions refuse over-limit tag text; no maxLength on the tags input; add form tab order + disabled while adding; import registers archive tag spelling before the cap; comments; tests for tool descriptions, 44 px delete control, the two dialog fixes and the import spelling), 3 deferred (DW-445..447), 13 dismissed. Full suite 269 files / 4451 tests green, typecheck clean, lint 0 errors.

- 2026-11-08: Story 16.8 implemented — free tags on packing items (own table, trip-wide spelling, 10 per item, no comma), tags field in add form and edit dialog, tag chips on the trip list / not-needed section / day section, tag filter row (OR, AND with categories and "Noch offen", remembered per trip, prefill, reveal), tags in the day email, backup v2 `tags`, connector `tags` / `addTags` / `removeTags` with KI marker and undo (receipt stays v1, older receipts leave tags alone).
