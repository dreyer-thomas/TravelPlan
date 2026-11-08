---
baseline_commit: 159ba135b891a9f0a1103a07ec720bc0cb3ba953
---

# Story 16.1: The Trip's Packing List

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a traveller packing for a trip,
I want one shared packing list on the trip, grouped by category, that I can extend and tick off,
so that we can collect items while planning and see while packing what is already in the suitcase.

*Added 2026-11-08 (Tommy, with John/PM). FRs covered: FR58, FR33 (the backup carries the list). First story of Epic 16. Source: `epics.md` → Epic 16 / Story 16.1; `sprint-change-proposal-2026-11-08-packing-list.md` (approved, all 7 open defaults accepted); `architecture.md` → "Packing list (added 2026-11-08, Epic 16)".*

## Acceptance Criteria

1. **Overview entry.** The trip overview shows a "Packliste" / "Packing list" entry with the progress ("18 von 30 eingepackt" / "18 of 30 packed") that opens the trip's packing list page (`/trips/[id]/packing`). A trip without items shows "Noch leer" / "Empty yet". Every role sees it (owner, contributor, viewer).
2. **Add.** On the packing list page, an owner or contributor can add an item with a name and an optional category. The category input offers the suggestions from the shared rules (localized defaults + every category already used on the trip).
3. **Duplicate name.** Adding a name that already exists on the trip (trimmed, ignoring case) creates no second item; the existing item is highlighted (scrolled into view, briefly marked) and a short notice says it is already on the list.
4. **Edit and tick.** An owner or contributor can rename an item, change (or clear) its category, and tick or untick it as packed in one tap. A rename onto another item's name (ignoring case) is refused with a visible message and writes nothing.
5. **Delete.** An owner or contributor can delete an item. If it is linked to one or more days, a confirmation names how many days it disappears from ("Auch an 3 Tagen entfernen?" / "Also removed from 3 days?"; singular "Auch an 1 Tag entfernen?" / "Also removed from 1 day?"). An item with no day links is deleted without that confirmation. Deleting removes the item and all its day links.
6. **Grouping and order.** Items are grouped by category with a per-category count ("Technik 4/7" = packed/total). Categories sort alphabetically (locale-aware, case-insensitive) with "Sonstiges" / "Other" (items without category) last; items within a category sort alphabetically. A packed item stays in place, shown ticked and struck through.
7. **Filter.** A filter switches between "Alle" / "All" and "Noch offen" / "Not packed yet"; the choice is remembered per viewer in the browser (`localStorage`, failure-tolerant). The page header shows the overall progress.
8. **Phone.** The page works one-handed at phone width: no horizontal scroll at 360 px, tick and row action targets at least 44 × 44 px.
9. **Viewer.** A viewer sees the list and its progress read-only: no add field, no edit, no tick, no delete controls. The API refuses every write from a viewer (403) and answers 404 to a non-participant.
10. **Backup.** The v2 export's `trip.json` carries `trip.packingItems` (name, category, packed, `dayIndexes` it is linked to). Importing an archive restores them (both create-new and overwrite). An archive without `packingItems` still imports. `formatVersion` stays 2.
11. **Tests** cover: add, duplicate name, rename onto an existing name (refused), category change, tick and untick, delete with and without day links, viewer read-only (UI and API), empty state, and the export/import round trip (incl. an archive without `packingItems`, and overwrite not doubling the list).

**Out of scope:** creating day links in the UI and showing linked days per item (16.2); day email (16.3); connector tools, AI-changes notice and undo (16.4); copying from another trip (16.5); per-person lists, quantities, tags, templates, file import/export.

## Tasks / Subtasks

- [x] **Task 1: Schema + migration** (AC: 5, 10)
  - [x] In `prisma/schema.prisma` add `PackingItem` and `PackingItemDay` (exact shape in Dev Notes → "Data model"), plus back-relations `Trip.packingItems PackingItem[]` and `TripDay.packingItemDays PackingItemDay[]`.
  - [x] New migration folder `prisma/migrations/20261108120000_add_packing_list/migration.sql`, written as Prisma generates it, with the house header comment (story, purpose, "Additive only"). Verify with `npx prisma migrate diff` (migrations dir → schema) that it produces no drift for the new tables. Do not touch any existing migration (`npm run check:migrations`).
  - [x] `npx prisma generate` (also runs on postinstall).
- [x] **Task 2: Pure rules module** (AC: 2, 3, 4, 6)
  - [x] New `src/lib/trips/packingList.ts` (no Prisma, importable by client components): `PACKING_ITEM_NAME_MAX = 80`, `PACKING_CATEGORY_MAX = 40`, `normalizePackingName(raw)` (NFC + trim), `packingNameKey(name)` (NFC + trim + `toLowerCase()`), `normalizePackingCategory(raw)` (trim; empty → `null`; a value equal ignoring case to "Sonstiges" or "Other" → `null`, so it never forms a second "Other" group), `groupPackingItems(items, otherLabel, locale)` returning ordered groups `{ key, label, packed, total, items }` per AC 6, and `suggestedPackingCategories(t-labels, usedCategories)` (defaults first, then used categories not already present ignoring case).
- [x] **Task 3: Validation schemas** (AC: 2, 4, 5)
  - [x] New `src/lib/validation/packingListSchemas.ts` (zod, the style of `bucketListSchemas.ts`): create `{ name, category? }`, update `{ itemId, name?, category?, packed? }` (at least one field), delete `{ itemId }`. Lengths measured after trim (name 1–80, category ≤ 40, `null`/`""` clears the category).
- [x] **Task 4: `packingListRepo`** (AC: 2–5, 9)
  - [x] New `src/lib/repositories/packingListRepo.ts` — the only place that touches `prisma.packingItem` / `prisma.packingItemDay` (besides `tripRepo` export/import and the trip summary count, see Tasks 6–7). Functions: `listPackingItemsForTrip({ userId, tripId })` (read clause: owner or any member) → `{ accessRole, items } | null`; `createPackingItem({ userId, tripId, name, category, origin })` → `{ status: "not_found" } | { status: "created" | "existed", item }`; `updatePackingItem({ userId, tripId, itemId, name?, category?, packed?, origin })` → `not_found | missing | duplicate_name | updated`; `deletePackingItem({ userId, tripId, itemId })` → `not_found | missing | deleted`.
  - [x] Writer clause exactly like `bucketListRepo.findTripForTripWriter` (explicit `role: "CONTRIBUTOR"`); reader clause `OR: [{ userId }, { members: { some: { userId } } }]` plus `deriveTripAccessRole` for the role (see `getTripAccessForUser`).
  - [x] Each item detail: `id, name, category, packed, dayCount, aiChangedAt, createdAt, updatedAt` (`dayCount` via `_count: { select: { days: true } }`).
  - [x] `origin: WriteOrigin` is a **required** parameter on create/update (`aiChangedAtFor(origin, now)` from `src/lib/trips/writeOrigin.ts`); the app always passes `"user"`, which clears the marker. No `inTransaction` hook / receipt yet (16.4 adds them) — keep the function shapes easy to extend.
  - [x] Duplicate handling: create looks up `{ tripId, nameKey }` first → `existed`; also catch Prisma `P2002` on the unique index (a concurrent create) and answer `existed` with the winner. Rename: if another item of the trip has the new `nameKey` → `duplicate_name`; renaming an item to a different spelling of its own name (e.g. case change) is allowed.
  - [x] Category write: if the trip already uses the category ignoring case, store the existing spelling (so "technik" joins "Technik").
  - [x] Delete: `deleteMany({ where: { id, tripId } })`; the link rows cascade.
- [x] **Task 5: API route** (AC: 2–5, 9)
  - [x] New `src/app/api/trips/[id]/packing-items/route.ts` with `GET`, `POST`, `PATCH`, `DELETE`, modelled line for line on `bucket-list-items/route.ts` (CSRF on writes, `requireSession`, `parseJson`, `ok`/`fail`, try/catch → 500).
  - [x] `GET`: read gate — `getTripAccessForUser`; `null` → 404 "Trip not found"; any role passes. Answers `{ accessRole, items }` (dates as ISO strings).
  - [x] Writes: `refuseUnlessTripWriter(userId, tripId, "Trip not found")` (viewer 403, outsider 404) before parsing.
  - [x] `POST` → `{ item, existed: boolean }` (200 both ways). `PATCH` → `{ item }`; `duplicate_name` → **409** `apiError("duplicate_name", "A packing item with this name already exists")`; `missing` → 404 "Packing item not found". `DELETE` → `{ deleted: true }`.
- [x] **Task 6: Trip summary progress** (AC: 1)
  - [x] In `getTripWithDaysForUser` (`src/lib/repositories/tripRepo.ts:1112`) select `packingItems: { select: { packed: true } }` in the same query and return `packing: { total, packed }` on `TripWithDays`. Add it to the `GET /api/trips/[id]` response (`src/app/api/trips/[id]/route.ts`, the `trip` object). Do not add a second query (`test/mcpTripRouteSinglePass.test.ts` counts calls).
- [x] **Task 7: Backup export/import** (AC: 10)
  - [x] Export (`getTripExportForUser`, `tripRepo.ts:1900`): include `packingItems` (ordered by `nameKey`, then `id`, for byte-stable output) with their links' `tripDay.dayIndex`; write `trip.packingItems: { name, category, packed, dayIndexes: number[] (ascending) }[]` (always present, `[]` when empty). Add the field to `TripExportPayload["trip"]` with a doc comment. Do **not** export `aiChangedAt` or ids. Extend the comment on `FORMAT_VERSION` in `export/route.ts` with one line: additive within v2 (Story 16.1).
  - [x] Import schema (`src/lib/validation/tripImportSchemas.ts`, `tripImportSchema`): `packingItems: z.array(packingItemImportSchema).max(MAX_IMPORT_PACKING_ITEMS).optional().default([])`; item: `name` (trim, 1–80), `category` (trim, ≤ 40, nullable/optional → null), `packed` (boolean, default false), `dayIndexes` (int ≥ 1 array, ≤ `MAX_IMPORT_DAYS`, default `[]`). Add `MAX_IMPORT_PACKING_ITEMS = 1000` to `src/lib/trips/importLimits.ts`. In the payload `superRefine`, refuse a `dayIndexes` entry that names no day of the archive ("Unknown dayIndex in packing item", path `["trip","packingItems",i,"dayIndexes"]`).
  - [x] Import write (`runTripImport`): a helper `createImportedPackingItems({ tx, tripId, items })` called after `createImportedDays` in **both** branches. It reads `tx.tripDay.findMany({ where: { tripId }, select: { id, dayIndex } })`, merges archive entries with the same `nameKey` (first wins for name/category; `packed` = any packed; `dayIndexes` unioned), normalizes categories with `normalizePackingCategory`, creates items (`aiChangedAt` null) and links.
  - [x] **Overwrite branch:** add `await tx.packingItem.deleteMany({ where: { tripId: targetTrip.id } })` next to the parked-items delete (`tripRepo.ts:3472`). Without it the old items survive (they hang off the trip, not the days) and the import hits the unique index or doubles the list.
- [x] **Task 8: Packing list page** (AC: 2–9)
  - [x] New server page `src/app/(routes)/trips/[id]/packing/page.tsx`, the shape of `costs/page.tsx` (`Container maxWidth="lg"`, `TripDayMapBackButton` to `/trips/${id}` with `t("trips.packingList.back")`).
  - [x] New client component `src/components/features/trips/TripPackingList.tsx`: loads `GET /api/trips/{id}/packing-items`; derives `canEdit = canTripAccessRoleWrite(accessRole)` from `@/lib/auth/tripAccessRole` (never from `tripAccess.ts` — it pulls in Prisma). CSRF token via `/api/auth/csrf` as in `TripBucketListPanel.tsx:186-195`; error codes mapped like `TripBucketListPanel.tsx:120-135`.
  - [x] Layout (top to bottom): title + progress ("18 von 30 eingepackt"); add row (name `TextField` + category `Autocomplete freeSolo` with the suggestions + Add button; Enter submits; field keeps focus and clears after a successful add, category kept for the next item); filter (`ToggleButtonGroup` All / Not packed yet); groups ("Technik 4/7" heading, rows). Empty state: "Noch nichts auf der Liste." / "Nothing on the list yet." (+ for viewers nothing else).
  - [x] Row: `Checkbox` (≥ 44 px hit area) toggling `packed` with an optimistic update rolled back on error; name (struck through + muted when packed); `AiBadge` when `aiChangedAt` is set; an edit `IconButton` (≥ 44 px, `aria-label` with the item name) opening an edit dialog (name, category Autocomplete, Save, Delete). Viewer rows: a non-interactive check mark for packed, no checkbox, no edit button.
  - [x] Duplicate on add (`existed: true`): clear the field, switch the filter to All if the existing item is packed and hidden, `scrollIntoView` + highlight the row for ~2 s, show the notice "„{name}“ steht schon auf der Liste." / "'{name}' is already on the list.".
  - [x] Rename refused (409): keep the dialog open with an inline error "Diesen Namen gibt es schon." / "An item with this name already exists.".
  - [x] Delete: `dayCount > 0` → confirmation dialog in the bucket-list style (`TripBucketListPanel.tsx:470-500`, `DialogTitleWithClose`, keep/confirm buttons) with the AC 5 text; `dayCount === 0` → delete directly.
  - [x] Filter persistence: `localStorage` key `travelplan.packingList.filter` (`"all" | "open"`), read and write wrapped in try/catch, default `"all"`; read in an effect after mount (no hydration mismatch).
- [x] **Task 9: Overview entry** (AC: 1)
  - [x] In `TripTimeline.tsx`, add a card to the side column directly **before** the bucket-list panel block (`TripTimeline.tsx:1226-1239`), **outside** the `canEditPlanning` guard (viewers see it): same card shell as the distance card (`tokens.card`, `borderStrong`, radius 8, padding 18, `mb: 2`), `labelCaps` title "Packliste", progress line, the whole card a `Link` to `/trips/${tripId}/packing` with `aria-label` `t("trips.packingList.openAria")`, `data-testid="trip-packing-card"`. Add `packing?: { total: number; packed: number }` (optional, so old fixtures still type-check) to `TripSummary`; absent or `total === 0` → "Noch leer".
- [x] **Task 10: i18n** (AC: all UI)
  - [x] Add every `trips.packingList.*` key to both `src/i18n/de.ts` and `src/i18n/en.ts` (key list in Dev Notes). `test/i18nDictionaries.test.ts` enforces parity.
- [x] **Task 11: Tests** (AC: 11) — see Dev Notes → "Testing".
- [x] **Task 12: Gates** — `npm run typecheck`, `npm run lint` (0 errors), `npm test` (full suite green), `npm run build`.

### Review Findings

_bmad-code-review, 2026-11-08 (Blind Hunter, Edge Case Hunter, Acceptance Auditor). 8 patch (all applied), 6 defer, 18 dismissed. After the fixes: typecheck clean, lint 0 errors, full suite 265 files / 4220 tests green; new tests cover the not-yet-loaded duplicate, the repeated highlight, the unchanged remembered filter and the NFC length check._

- [x] [Review][Patch] Duplicate add of an item this page has not loaded yet (added by another participant meanwhile) shows the notice but no row - the `existed` branch never calls `upsertItem(item)`, so nothing scrolls/highlights (AC 3) [travelplan/src/components/features/trips/TripPackingList.tsx:279]
- [x] [Review][Patch] Tick races: no per-item sequencing, out-of-order PATCH answers win, and the rollback restores the whole click-time copy (can wipe a rename saved meanwhile) - roll back only `packed`, ignore stale answers [travelplan/src/components/features/trips/TripPackingList.tsx:294]
- [x] [Review][Patch] A second duplicate add of the same item within 2 s does not re-scroll or restart the highlight timer (effect keyed on the unchanged `highlightId`) [travelplan/src/components/features/trips/TripPackingList.tsx:189]
- [x] [Review][Patch] The automatic switch to "All" after a duplicate add of a packed item goes through `changeFilter`, overwriting the viewer's remembered "Not packed yet" in localStorage - use `setFilter("all")` only (AC 7) [travelplan/src/components/features/trips/TripPackingList.tsx:280]
- [x] [Review][Patch] Delete-confirm dialog's Keep/Delete buttons have no `minHeight: TOUCH_TARGET_PX` (the edit dialog's buttons do) (AC 8) [travelplan/src/components/features/trips/TripPackingList.tsx:702]
- [x] [Review][Patch] Group React key `group.key ?? "__other"` collides with a user category named "__other" - use a prefix no category key can equal [travelplan/src/components/features/trips/TripPackingList.tsx:538]
- [x] [Review][Patch] Name/category max length is checked before NFC normalization, so a name that grows under NFC is stored longer than 80 (also the import schema) - normalize before `.max` [travelplan/src/lib/validation/packingListSchemas.ts:10]
- [x] [Review][Patch] Overview card's `aria-label="Open packing list"` replaces the accessible name, so screen readers never hear the progress ("18 of 30 packed") - drop it or include the progress [travelplan/src/components/features/trips/TripTimeline.tsx:1236]
- [x] [Review][Defer] Delete skips the day-count confirmation when `dayCount` is stale (links added after load) [travelplan/src/components/features/trips/TripPackingList.tsx:363] — deferred to 16.2 (DW-432), the first story that creates links in the app
- [x] [Review][Defer] A 404 for an item deleted elsewhere leaves the row and fails every retry until reload [travelplan/src/components/features/trips/TripPackingList.tsx:341] — deferred (DW-433)
- [x] [Review][Defer] CSRF token cached for the page lifetime, never refreshed on `csrf_invalid` [travelplan/src/components/features/trips/TripPackingList.tsx:197] — deferred, pre-existing pattern in 5 components (DW-434)
- [x] [Review][Defer] Concurrent creates with "technik"/"Technik" on a trip without that category store both spellings [travelplan/src/lib/repositories/packingListRepo.ts:104] — deferred (DW-435)
- [x] [Review][Defer] A name or category made only of zero-width characters passes `.trim()` [travelplan/src/lib/validation/packingListSchemas.ts:10] — deferred (DW-436)
- [x] [Review][Defer] Cost overview card has the same `aria-label` override hiding its figure [travelplan/src/components/features/trips/TripTimeline.tsx:788] — deferred, pre-existing (DW-437)

## Dev Notes

### Shared Epic 16 rules (apply verbatim)

- Writes go through `packingListRepo`, never Prisma directly, and re-check access per trip: owner and contributor write, viewer reads (FR30, FR32). [Source: epics.md → Epic 16 shared rules]
- Name: trimmed, 1–80 chars, unique per trip ignoring case. A second "Taucherbrille" resolves to the existing item.
- Category: free text, trimmed, ≤ 40 chars, optional. No category → shown under "Sonstiges" (de) / "Other" (en). Suggestions (localized, **not stored** as a list): Kleidung/Clothing, Technik/Electronics, Hygiene/Toiletries, Dokumente/Documents, Medikamente/Medication, Sonstiges/Other, plus every category already used on the trip.
- Categories alphabetical, "Other" last; items alphabetical within a category; packed items stay in place, ticked and struck through.
- All UI text in German and English.

Two clarifications this story adds (keep them; 16.2/16.4/16.5 depend on the same behaviour):
- Picking the "Sonstiges"/"Other" suggestion stores `null` (else there would be two "Other" groups).
- A category matching an existing one ignoring case reuses the stored spelling.

### Data model

```prisma
// Story 16.1 (FR58). One shared packing list per trip. `nameKey` is the trimmed, lower-cased name
// (`packingNameKey`), unique per trip, so every path that adds by name (app, day, connector, copy)
// resolves to the existing item. `aiChangedAt` has the Story 15.4 meaning; not exported in backups.
model PackingItem {
  id          String    @id @default(cuid()) @map("id")
  tripId      String    @map("trip_id")
  name        String    @map("name")
  nameKey     String    @map("name_key")
  category    String?   @map("category")
  packed      Boolean   @default(false) @map("packed")
  aiChangedAt DateTime? @map("ai_changed_at")
  createdAt   DateTime  @default(now()) @map("created_at")
  updatedAt   DateTime  @updatedAt @map("updated_at")

  trip Trip             @relation(fields: [tripId], references: [id], onDelete: Cascade)
  days PackingItemDay[]

  @@unique([tripId, nameKey], map: "packing_items_trip_id_name_key_key")
  @@map("packing_items")
}

// Story 16.1. A packing item linked to a day (written from Story 16.2 on). Both sides cascade: a day
// removed by re-dating loses its links, never the item.
model PackingItemDay {
  packingItemId String   @map("packing_item_id")
  tripDayId     String   @map("trip_day_id")
  createdAt     DateTime @default(now()) @map("created_at")

  packingItem PackingItem @relation(fields: [packingItemId], references: [id], onDelete: Cascade)
  tripDay     TripDay     @relation(fields: [tripDayId], references: [id], onDelete: Cascade)

  @@id([packingItemId, tripDayId])
  @@index([tripDayId], map: "idx_packing_item_days_trip_day_id")
  @@map("packing_item_days")
}
```

The link table is created **now** even though no UI writes it until 16.2: AC 5 (delete counts days) and AC 10 (`dayIndexes` in the backup) need it, and one migration is cleaner than two. Tests seed links with `prisma.packingItemDay.create`.

SQLite has no partial/functional index; uniqueness ignoring case is achieved by the stored `nameKey`, never by `COLLATE NOCASE` (which only folds ASCII — "Ä" vs "ä" would slip through). `toLowerCase()` after `normalize("NFC")` handles umlauts.

### Access (do not get this wrong)

- The **bucket list hides from viewers**; the **packing list does not** (AC 9, FR30). So `GET` uses the participant read clause, not `refuseUnlessTripWriter` (which `bucket-list-items` GET uses). Writes use `refuseUnlessTripWriter` + the repository's writer clause (defence in depth, same as `bucketListRepo`).
- The page's edit controls come from `accessRole` in the GET answer. The UI hiding controls is not the protection; the 403 is.
- A bare `members: { some: { userId } }` is the **read** clause; the write clause needs `role: "CONTRIBUTOR"` (see the comment at `bucketListRepo.ts:84-88`).

### Files to touch

| File | Action | Notes |
|---|---|---|
| `prisma/schema.prisma` | UPDATE | two models + back-relations on `Trip`, `TripDay` |
| `prisma/migrations/20261108120000_add_packing_list/migration.sql` | NEW | additive |
| `src/lib/trips/packingList.ts` | NEW | pure rules, client-safe |
| `src/lib/validation/packingListSchemas.ts` | NEW | zod |
| `src/lib/repositories/packingListRepo.ts` | NEW | all app reads/writes |
| `src/app/api/trips/[id]/packing-items/route.ts` | NEW | GET/POST/PATCH/DELETE |
| `src/app/(routes)/trips/[id]/packing/page.tsx` | NEW | server shell |
| `src/components/features/trips/TripPackingList.tsx` | NEW | the page UI |
| `src/components/features/trips/TripTimeline.tsx` | UPDATE | overview card; `TripSummary.packing?` |
| `src/lib/repositories/tripRepo.ts` | UPDATE | summary count; export; import (both branches + overwrite delete) |
| `src/app/api/trips/[id]/route.ts` | UPDATE | `trip.packing` in GET |
| `src/app/api/trips/[id]/export/route.ts` | UPDATE | comment only |
| `src/lib/validation/tripImportSchemas.ts` | UPDATE | `packingItems` + dayIndex cross-check |
| `src/lib/trips/importLimits.ts` | UPDATE | `MAX_IMPORT_PACKING_ITEMS` |
| `src/i18n/de.ts`, `src/i18n/en.ts` | UPDATE | keys below |

**Current state / what must be preserved:**
- `TripTimeline.tsx` side column: cost card → distance card → map panel → bucket list (writers only) → gap alert. Insert the packing card before the bucket list; keep the `mb: 2` / `mt: 2` rhythm described in the comment at `TripTimeline.tsx:1226-1235`. The trip-controls card's dual mount (Story 6.14) is untouched. Ten timeline test files mock `TripBucketListPanel`; the packing card makes **no fetch of its own** (it reads `detail.trip.packing`), so those tests need no new mock.
- `getTripWithDaysForUser` feeds the trip GET, the day view and the connector (`get_trip`, `get_trip_route`); adding one selected relation is additive. Keep the single query.
- Export must stay byte-stable for an unchanged trip (`export/route.ts` uses `trip.updatedAt` as `exportedAt` for that reason) → deterministic order. Adding `packingItems: []` changes the manifest of every export; `test/tripExportRoute.test.ts` builds a mocked Prisma trip (line ~42) — add `packingItems: []` there and assert `payload.trip.packingItems` (`[]` and a populated case).
- Import: both branches call `createImportedDays` then `createImportedParkedItems`; add the packing helper after them inside the same transaction. The post-commit disk phase is unaffected (no files).
- `updateTripWithDays` (re-dating) deletes days → links cascade. Nothing to do here; 16.2 tests it.

### API shapes

```
GET    /api/trips/{id}/packing-items  → { data: { accessRole, items: PackingItemWire[] } }
POST   { name, category? }            → { data: { item, existed } }
PATCH  { itemId, name?, category?, packed? } → { data: { item } } | 409 duplicate_name | 404
DELETE { itemId }                     → { data: { deleted: true } } | 404

PackingItemWire = { id, name, category: string|null, packed, dayCount, aiChangedAt: string|null, createdAt, updatedAt }
```

Body-based `itemId` (not a sub-path) to match `bucket-list-items`. Return lists unsorted-by-category; grouping/sorting is `groupPackingItems` on the client so one rule serves the page, 16.2's day section and 16.3's email.

### i18n keys (de / en)

`trips.packingList.title` Packliste / Packing list · `.back` ← Zurück zur Reise / ← Back to trip · `.openAria` Packliste öffnen / Open packing list · `.progress` {packed} von {total} eingepackt / {packed} of {total} packed · `.emptyShort` Noch leer / Empty yet · `.empty` Noch nichts auf der Liste. / Nothing on the list yet. · `.nameLabel` Gegenstand / Item · `.categoryLabel` Kategorie (optional) / Category (optional) · `.add` Hinzufügen / Add · `.filterAll` Alle / All · `.filterOpen` Noch offen / Not packed yet · `.filterLabel` Anzeigen / Show · `.groupCount` {category} {packed}/{total} · `.other` Sonstiges / Other · `.alreadyOnList` „{name}“ steht schon auf der Liste. / '{name}' is already on the list. · `.duplicateName` Diesen Namen gibt es schon. / An item with this name already exists. · `.editTitle` Gegenstand bearbeiten / Edit item · `.editAria` {name} bearbeiten / Edit {name} · `.save` Speichern / Save · `.delete` Löschen / Delete · `.deleteTitle` Gegenstand löschen? / Delete item? · `.deleteDaysOne` Auch an 1 Tag entfernen? / Also removed from 1 day? · `.deleteDays` Auch an {count} Tagen entfernen? / Also removed from {count} days? · `.deleteKeep` Behalten / Keep · `.deleteConfirm` Löschen / Delete · `.toggleAria` {name} eingepackt / {name} packed · `.allPacked` Alles eingepackt. / Everything is packed. (shown when the "Not packed yet" filter leaves nothing) · suggestions `.suggest.clothing` Kleidung/Clothing, `.suggest.electronics` Technik/Electronics, `.suggest.toiletries` Hygiene/Toiletries, `.suggest.documents` Dokumente/Documents, `.suggest.medication` Medikamente/Medication. Use `formatMessage` for placeholders, as the rest of the app does. Check `.back` against the existing `trips.costOverview.back` wording and reuse its text.

### UX notes

- Built for packing with the phone in one hand: the add field at the top, big rows, checkbox on the left. Use theme `tokens` (`useTheme().palette.tokens`) — no hard-coded colours (there is a test helper `test/helpers/hardcodedColour.ts` used by guard tests).
- Packed: name `textDecoration: line-through`, colour `tokens.inkSoft`; row does not move.
- Highlight on duplicate: a short background tint (e.g. `tokens.warnBg` or the primary tint used elsewhere) removed after ~2 s; respect `prefers-reduced-motion` (no smooth scroll then).
- The group count is "packed/total" for the category ("Technik 4/7").

### Testing

Run against the real SQLite test DB (each file gets its own migrated copy, `test/globalSetup.ts` — so the migration must exist before the tests run). Patterns: `test/bucketListRepo.test.ts` (repo, seeded users/trips/members), `test/bucketListRoute.test.ts` (route with `test/helpers/routeContext.ts`, session + CSRF), `test/tripBucketListPanel.test.tsx` and `test/tripCostOverview.test.tsx` (component with `renderWithProviders`, `test/helpers/mockFetch.ts`), `test/tripTimelineRoles.test.tsx` (overview per role), `test/tripExportRoute.test.ts` and the `tripImport*.test.ts` files (backup).

New / extended files:
- `test/packingList.test.ts` — pure rules: name key (case, spaces, umlauts), category normalization (empty, "sonstiges", "OTHER" → null), grouping order (alphabetical, Other last, locale-aware), counts.
- `test/packingListRepo.test.ts` — create; duplicate name → `existed` with the same id (also different case/spaces); rename onto another item → `duplicate_name`, nothing written; case-only rename of itself allowed; category change and clear; category reuses existing spelling; tick/untick; delete with 0 and with 2 day links (links gone, other items untouched); `dayCount`; contributor writes; viewer → `not_found` on every write but reads; stranger reads `null`; `origin: "user"` leaves `aiChangedAt` null (seed one with a date, edit, assert cleared).
- `test/packingListRoute.test.ts` — GET for owner/contributor/viewer (200 + `accessRole`) and stranger (404); POST/PATCH/DELETE: viewer 403, stranger 404, CSRF missing 403, invalid body 400 (empty name, 81 chars, category 41 chars), PATCH duplicate 409, unknown item 404.
- `test/tripPackingList.test.tsx` — renders groups and counts; empty state; add (fetch called, row appears); duplicate add highlights and shows the notice; tick sends PATCH and strikes through; rename 409 shows the error; delete with `dayCount: 3` shows "Also removed from 3 days?", with 0 deletes directly; filter "Not packed yet" hides packed rows and is restored from `localStorage` (and survives a throwing `localStorage`); viewer sees no checkbox/add/edit.
- `test/tripTimelineRoles.test.tsx` (extend) — the packing card shows "18 of 30 packed" / "Empty yet", links to `/trips/{id}/packing`, and is present for a viewer.
- `test/tripDetailRoute.test.ts` (extend) — `trip.packing` totals.
- Backup: export carries `packingItems` with sorted `dayIndexes`; import (create-new) restores items, packed flags, categories and links to the right new days; overwrite replaces the old list (no doubling, no P2002); archive without `packingItems` imports; unknown `dayIndex` → validation error; duplicate names in an archive are merged.

### Previous work to reuse (don't reinvent)

- Route skeleton, CSRF, envelopes: `src/app/api/trips/[id]/bucket-list-items/route.ts`.
- Writer clause, transaction style, `aiChangedAtFor`: `src/lib/repositories/bucketListRepo.ts`, `src/lib/trips/writeOrigin.ts`.
- Role predicates for the client: `src/lib/auth/tripAccessRole.ts` (`canTripAccessRoleWrite`).
- Delete confirmation dialog and keep/confirm wording style (Story 6.25): `TripBucketListPanel.tsx:470-500`.
- Back button + page shell: `src/app/(routes)/trips/[id]/costs/page.tsx`.
- KI badge: `src/components/ui/AiBadge.tsx` (nothing sets `aiChangedAt` until 16.4, but rendering it now is one line and keeps 16.4 to the connector side).

### Git intelligence

Recent work (15.4–15.10) established: required `origin` on every repository write, `aiChangedAt` columns with "set by AI, cleared by app" semantics, single-query reads checked by tests, and additive migrations written as Prisma generates them with a story header comment. Follow those. Last commit `159ba13` (stories 15-9/15-10); the working tree has the uncommitted Epic 16 planning edits (epics/prd/architecture/sprint-status, change proposal) — leave them as they are.

### Project Structure Notes

- No `project-context.md` exists; conventions come from the code and `architecture.md`.
- Next.js 16 app router (`src/app/(routes)` for pages, `src/app/api` for routes), Prisma 7 with SQLite (`prisma-client` generator → `src/generated/prisma`), MUI 7, Vitest. No new dependency is needed.
- `localStorage` is used nowhere else in `src/` yet; this is the first use — keep it inside `TripPackingList.tsx`, guarded.

### References

- [Source: _bmad-output/planning-artifacts/epics.md → Epic 16, Story 16.1]
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-11-08-packing-list.md §§2, 4.4, 4.5]
- [Source: _bmad-output/planning-artifacts/architecture.md:182 "Packing list (added 2026-11-08, Epic 16)"]
- [Source: _bmad-output/planning-artifacts/prd.md → FR58, FR30, FR32, FR33]
- [Source: travelplan/src/lib/repositories/bucketListRepo.ts; travelplan/src/app/api/trips/[id]/bucket-list-items/route.ts]
- [Source: travelplan/src/lib/repositories/tripRepo.ts:1112 (getTripWithDaysForUser), :1900 (export), :3380-3600 (import branches)]
- [Source: travelplan/src/lib/validation/tripImportSchemas.ts:605-760]
- [Source: travelplan/src/components/features/trips/TripTimeline.tsx:1105-1240]

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (claude-opus-5-5), via bmad-dev-story, 2026-11-08.

### Debug Log References

- `npx prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --script` prints nothing for `packing_*` after the migration is in place; the remaining `cost_payments` / `trip_members` redefinitions predate this story (same note as Story 15.4's migration). `npm run check:migrations`: passed (no existing migration touched).
- Red check on AC 10 overwrite: with the new `tx.packingItem.deleteMany` disabled, `packingListBackup.test.ts` › "replaces the target's list on overwrite" fails; restored, it passes.
- Gates: `npm run typecheck` clean; `npm run lint` 0 errors (81 warnings, all in existing files; the new files lint clean); `npx vitest run` 265 files / 4217 tests passed; `npm run build` passed and lists `/trips/[id]/packing`.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.
- **Schema/migration (Task 1):** `PackingItem` + `PackingItemDay` exactly as specified, back-relations on `Trip` / `TripDay`; migration `20261108120000_add_packing_list` written as Prisma generates it, with the house header.
- **Rules (Task 2):** `src/lib/trips/packingList.ts` - name normalize/key (NFC + trim [+ lower]), category normalize ("Sonstiges"/"Other" in any case → `null`), `groupPackingItems` (Intl.Collator, base sensitivity, Other last, ties by id) and `suggestedPackingCategories(defaults, used, locale)` (signature takes the localized default labels as an array).
- **Repository (Task 4):** writer clause copied from `bucketListRepo` (explicit `CONTRIBUTOR`); the read clause + `deriveTripAccessRole` lives in `listPackingItemsForTrip`, which also loads the items in the same query. Duplicate create → `existed` (also on a concurrent `P2002`); rename clash → `duplicate_name` (also on `P2002`); case fix of the item's own name allowed. Category reuse ignores the item being edited, so the only item of a category can still fix that category's case. Writes run in a transaction, so 16.4's `inTransaction` hook has a place to go.
- **Route (Task 5):** one deviation from the task text, deliberate: `GET` does not call `getTripAccessForUser` before the repository - `listPackingItemsForTrip` already applies the same participant clause and role derivation and answers `null` for a non-participant (→ 404), so the extra call would only be a second query for the same answer. Writes share one `authorizeWrite` helper (CSRF → session → `refuseUnlessTripWriter` → JSON), same order and answers as `bucket-list-items`.
- **Summary (Task 6):** `packingItems: { select: { packed } }` inside the existing `getTripWithDaysForUser` query; `TripWithDays.packing` and `trip.packing` in the trip GET. `mcpTripRouteSinglePass` stays green.
- **Backup (Task 7):** export writes `trip.packingItems` (order `nameKey`, `id`; `dayIndexes` ascending; no ids, no `aiChangedAt`); import schema with `MAX_IMPORT_PACKING_ITEMS = 1000` and the "Unknown dayIndex in packing item" refine; `createImportedPackingItems` in both branches, merging same-key entries (first name/category, packed = any, union of days) and unifying category spelling within the archive; overwrite deletes the old list. Note for the record: `test/tripExportRoute.test.ts` builds real DB rows, not a mocked Prisma trip as the Dev Notes said, so no `packingItems: []` fixture was needed there; the three *typed import* fixtures (`tripRepo.test.ts` ×2, `tripImportRollback.test.ts`) and `mcpRouteShapes.test.ts`'s `TripWithDays` fixture got the new field instead.
- **Page (Task 8):** `TripPackingList.tsx` + server page. Edit controls from `canTripAccessRoleWrite(accessRole)`; optimistic tick with rollback; duplicate add clears the field, switches the filter to All when the existing item is hidden, scrolls (no smooth scroll under reduced motion) and highlights the row (`tokens.warnBg`) for 2 s with the notice; rename 409 keeps the dialog open with the inline error; delete asks only when `dayCount > 0`. Filter in `localStorage` (`travelplan.packingList.filter`), every access in try/catch; it is read after the list loads rather than in a mount effect (lint rule `react-hooks/set-state-in-effect`), which still keeps it out of the server render. Viewers keep the filter (reading) and see a non-interactive check mark for packed items. All targets are 44 px; the add row wraps (`flex-wrap`, `minWidth: 0`) for 360 px.
- **Overview card (Task 9):** card before the bucket-list block, outside the `canEditPlanning` guard, whole card a `Link`; uses `mt: 2` (not `mb: 2`) because the map panel above has no bottom margin - this keeps the side column's 16 px rhythm. No fetch of its own.
- **i18n (Task 10):** all listed `trips.packingList.*` keys in de/en, plus five the UI needed that the list did not name: `loading`, `loadError`, `saveError`, `forbidden`, `packedMark`. `.back` reuses `trips.costOverview.back`'s wording.
- **Tests (Task 11):** new `packingList.test.ts` (6), `packingListRepo.test.ts` (13), `packingListRoute.test.ts` (8), `packingListBackup.test.ts` (6), `tripPackingList.test.tsx` (19); extended `tripDetailRoute.test.ts` (progress + key set), `tripExportRoute.test.ts` (empty + populated), `tripTimelineRoles.test.tsx` (card for all three roles, "Empty yet", older payload, German).
- **Manual check not done:** phone-width layout (AC 8) is covered by the 44 px sizing and wrapping in code and by no automated layout test (jsdom does no layout); worth one look on a phone at 360 px.

### File List

New:
- travelplan/prisma/migrations/20261108120000_add_packing_list/migration.sql
- travelplan/src/lib/trips/packingList.ts
- travelplan/src/lib/validation/packingListSchemas.ts
- travelplan/src/lib/repositories/packingListRepo.ts
- travelplan/src/app/api/trips/[id]/packing-items/route.ts
- travelplan/src/app/(routes)/trips/[id]/packing/page.tsx
- travelplan/src/components/features/trips/TripPackingList.tsx
- travelplan/src/generated/prisma/models/PackingItem.ts (generated)
- travelplan/src/generated/prisma/models/PackingItemDay.ts (generated)
- travelplan/test/packingList.test.ts
- travelplan/test/packingListRepo.test.ts
- travelplan/test/packingListRoute.test.ts
- travelplan/test/packingListBackup.test.ts
- travelplan/test/tripPackingList.test.tsx

Modified:
- travelplan/prisma/schema.prisma
- travelplan/src/lib/repositories/tripRepo.ts
- travelplan/src/app/api/trips/[id]/route.ts
- travelplan/src/app/api/trips/[id]/export/route.ts
- travelplan/src/lib/validation/tripImportSchemas.ts
- travelplan/src/lib/trips/importLimits.ts
- travelplan/src/components/features/trips/TripTimeline.tsx
- travelplan/src/i18n/de.ts
- travelplan/src/i18n/en.ts
- travelplan/src/generated/prisma/browser.ts, client.ts, models.ts, internal/class.ts, internal/prismaNamespace.ts, internal/prismaNamespaceBrowser.ts, models/Trip.ts, models/TripDay.ts (generated by `prisma generate`)
- travelplan/test/tripDetailRoute.test.ts
- travelplan/test/tripExportRoute.test.ts
- travelplan/test/tripTimelineRoles.test.tsx
- travelplan/test/mcpRouteShapes.test.ts
- travelplan/test/tripRepo.test.ts
- travelplan/test/tripImportRollback.test.ts
- _bmad-output/implementation-artifacts/sprint-status.yaml
- _bmad-output/implementation-artifacts/16-1-the-trips-packing-list.md

### Change Log

- 2026-11-08: Story 16.1 implemented - packing list schema + migration, rules module, repository, API route, trip summary progress, v2 backup export/import, packing list page, overview card, de/en texts, tests. Status → review.
- 2026-11-08: Code review (bmad-code-review): 8 patches applied (duplicate-add upsert, tick sequencing + field-only rollback, highlight nonce, filter not persisted on auto switch, 44 px confirm buttons, group key, NFC-before-length, overview card aria-label with progress); 6 deferred (DW-432..437). Status → done.
