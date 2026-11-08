---
baseline_commit: c111d8e
---

# Story 16.2: What the Day Needs

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a traveller on the morning of a day,
I want the day to show what we should take along, and to add things I notice are missing,
so that we don't leave the swimwear behind on the beach day, and the trip list fills up over the days.

*Added 2026-11-08 (Tommy, with John/PM). FR covered: FR59. Depends on Story 16.1 (done, `c111d8e`). Source: `epics.md` → Epic 16 / Story 16.2; `sprint-change-proposal-2026-11-08-packing-list.md` (approved; defaults 2, 3 and 4 accepted: packed mark on the day, linked days on the trip list, no confirmation on unlink).*

## Acceptance Criteria

1. **Day section.** The day view shows a "Mitnehmen" / "Take along" section listing the packing items linked to that day, grouped by category with the same rules as the trip list (`groupPackingItems`: categories alphabetical, "Sonstiges"/"Other" last, items alphabetical). It is **information only**: no checkbox. Every role sees it when the day has items (owner, contributor, viewer).
2. **Packed mark.** Each item in the day section shows whether it is packed on the trip list: a packed item has a small check mark with the accessible name "Eingepackt" / "Packed" (reuse `trips.packingList.packedMark`); an unpacked item has none, so a missing item stands out. The day section never changes `packed`.
3. **Empty day.** A day without linked items shows, for owner and contributor, a collapsed section: the "Mitnehmen" / "Take along" heading and an "Hinzufügen" / "Add" action, no list, no empty-state sentence. For a viewer the section is not rendered at all.
4. **Pick an existing item.** "Add" (owner or contributor) opens a picker that searches the trip's packing list by name (case-insensitive substring; items already linked to this day are not offered). Picking an item links it to the day; it appears in the section immediately.
5. **Create from the day.** Typing a name that matches no item offers "„Taucherbrille“ neu anlegen" / "Create 'Snorkel mask'". Choosing it shows an optional category field (same suggestions as the trip list: `suggestedPackingCategories`) and a create button. The new item lands on the trip list **unpacked** and is linked to the day.
6. **No duplicates.** Typing a name that exists on the trip (trimmed, ignoring case) links the existing item (no create offer for an exact key match), and the server resolves a create-by-name onto an existing name to that item too (never a second item; the existing item's category and packed state are unchanged).
7. **Remove from this day.** Each item in the day section has a "Vom Tag entfernen" / "Remove from this day" action (owner and contributor only). It removes only the link to this day, with **no confirmation**; the item stays on the trip list and on its other days.
8. **Linked days on the trip list.** On the packing list page (`/trips/[id]/packing`) each item shows the days it is linked to as short dates (`formatShortDate`, ascending by day), e.g. "Mo., 3.8. · Di., 4.8.". An item with no links shows nothing extra. Viewers see it too.
9. **Delete with fresh day count (DW-432).** Deleting an item on the packing list page never skips the "Also removed from N days?" confirmation because the page's loaded day count is stale: the server refuses a delete whose links no longer match what the user confirmed (409 `days_changed` with the current count) and the page then shows the confirmation with the fresh count.
10. **Re-dated trip.** When the trip is re-dated shorter, links to the removed days disappear and the items stay (cascade from 16.1's schema; tested, no code change expected).
11. **Access.** Link and unlink are writes: viewer 403, non-participant 404 (`refuseUnlessTripWriter` + the repository's writer clause). A `tripDayId` that is not a day of this trip, or an `itemId` that is not an item of this trip, answers 404 and writes nothing.
12. **Tests** cover: linking an existing item, creating from the day, a duplicate name linking the existing item, unlinking, an item on several days, deleting from the trip list removing every link, a removed day (re-dating), viewer read-only (UI and API), the linked days shown on the trip list, and the stale-day-count delete (409 then confirmation).

**Out of scope:** a per-day checkbox; linking items to activities; linking days from the packing list page (links are made on the day); the day email (16.3); connector tools, KI badge setting and undo (16.4); copying (16.5); the print view of the day.

## Tasks / Subtasks

- [x] **Task 1: Repository - day links** (AC: 4–7, 10, 11)
  - [x] In `src/lib/repositories/packingListRepo.ts` extend `PackingItemDetail` with `days: { id: string; dayIndex: number; date: Date }[]` (ascending by `dayIndex`) and keep `dayCount` (= `days.length`, other code and tests read it). Change `detailSelect` to also select `days: { select: { tripDay: { select: { id, dayIndex, date } } } }` (Prisma cannot `orderBy` a nested relation field through the link table — sort in `toDetail`). Keep `_count` or drop it in favour of `days.length` — either, but one source.
  - [x] `linkPackingItemToDay({ userId, tripId, tripDayId, itemId, origin })` → `not_found | day_missing | missing | linked` (with the item). Writer clause first; then in one transaction: day must satisfy `{ id: tripDayId, tripId }`, item `{ id: itemId, tripId }`; create the link if absent (idempotent: an existing link is success, not an error — use `upsert` on the compound id `packingItemId_tripDayId` or find-then-create catching `P2002`); then `tx.packingItem.update({ where: { id }, data: { aiChangedAt: aiChangedAtFor(origin, now) }, select: detailSelect })` — this also bumps `updatedAt`, which 16.4's stale check (`update_packing_item(..., updatedAt, addDayIds, removeDayIds)`) relies on. Only touch the item when a link was actually created (a no-op re-link must not bump `updatedAt`).
  - [x] `addPackingItemToDay({ userId, tripId, tripDayId, name, category, origin })` → `not_found | day_missing | created | existed` (with the item, now linked). One transaction: check the day; resolve by `nameKey` (existing → keep its name/category/packed) or create unpacked with `resolveCategory` (16.1's helper — reuse, do not copy); link as above. On a concurrent-create `P2002` retry once by resolving the winner and linking it. Factor the 16.1 create body into a private `createOrResolveInTx(tx, ...)` so `createPackingItem` and this function share it — do not duplicate the duplicate-name logic.
  - [x] `unlinkPackingItemFromDay({ userId, tripId, tripDayId, itemId, origin })` → `not_found | missing | unlinked` (with the item). `deleteMany({ where: { packingItemId: itemId, tripDayId, packingItem: { tripId } } })`; item missing on the trip → `missing`; a link that was already gone is still `unlinked` (idempotent — the click had its effect); bump the item (as above) only when a row was deleted.
  - [x] `deletePackingItem` gains optional `confirmedDayCount?: number`. Inside a transaction: count the item's links; if `confirmedDayCount !== undefined && count > 0 && count !== confirmedDayCount` → `{ status: "days_changed", dayCount: count }` and write nothing; otherwise delete as today. `undefined` keeps the 16.1 behaviour (16.4's connector delete will not pass it).
- [x] **Task 2: Validation** (AC: 4–7, 9)
  - [x] In `src/lib/validation/packingListSchemas.ts`: `packingDayLinkCreateSchema` = `{ tripDayId, itemId }` **or** `{ tripDayId, name, category? }` (a `z.union` of two `.strict()` objects; reuse `nameField`/`categoryField`/`itemIdField`); `packingDayLinkDeleteSchema` = `{ tripDayId, itemId }` strict. `packingItemDeleteSchema` gains `confirmedDayCount: z.number().int().min(0).optional()` (still `.strict()`).
- [x] **Task 3: API** (AC: 4–7, 9, 11)
  - [x] New `src/app/api/trips/[id]/packing-items/day-links/route.ts`: `POST` (link existing or create-by-name, per the body) and `DELETE` (unlink). Reuse the 16.1 route's `authorizeWrite` shape (CSRF → session → `refuseUnlessTripWriter` → JSON) — extract `authorizeWrite`/`toWire`/`requireCsrf`/`parseJson` from `packing-items/route.ts` into a small sibling module (e.g. `src/app/api/trips/[id]/packing-items/shared.ts`, not a route file) rather than copying them. Answers: `POST` → `{ item, created: boolean }` (200); `DELETE` → `{ item }`; `day_missing` → 404 `apiError("not_found", "Trip day not found")`; `missing` → 404 "Packing item not found"; `not_found` → 404 "Trip not found".
  - [x] `toWire` adds `days: [{ id, dayIndex, date: ISO string }]`.
  - [x] `DELETE /packing-items` passes `confirmedDayCount`; `days_changed` → **409** `apiError("days_changed", "Packing item day links changed", { dayCount })`.
- [x] **Task 4: Day section component** (AC: 1–7)
  - [x] New client component `src/components/features/trips/TripDayPackingSection.tsx`, props `{ tripId, dayId, canEdit }`. It fetches `GET /api/trips/{tripId}/packing-items` itself (viewers are allowed on that GET) and derives the day's items as `items.filter(i => i.days.some(d => d.id === dayId))`. Re-fetch when `dayId` changes (prev/next day navigation keeps the component mounted).
  - [x] Rendering: card in the day view's `cardSx` style (`tokens.card`, `borderStrong`, radius 8, padding 18), `labelCaps` `component="h6"` heading "Mitnehmen" (the day view's side-column cards use h6), an add `IconButton` (`PlusIcon`, 44 px, `aria-label` "Mitnehmen hinzufügen" / "Add to take along") in the header for `canEdit`, then the groups (group label `labelCaps` without counts — the per-category packed/total belongs to the trip list), rows as a real `ul/li`: packed mark slot (`CheckIcon` with `role="img"` + `aria-label` packedMark, as `TripPackingList.tsx` viewer rows), name (not struck through — the day list is not a packing state; use `tokens.ink`), `AiBadge` when `aiChangedAt`, and for `canEdit` a remove `IconButton` (44 px; `CloseXIcon` from `TripIcons` (unlinking is not deleting, so not the trash glyph); `aria-label` "{name} vom Tag entfernen" / "Remove {name} from this day").
  - [x] Empty day: `canEdit` → heading + add button only (AC 3); not `canEdit` → render `null`. While loading: render nothing for viewers, a quiet heading-only card for planners (no skeleton jump in the side column). Load error: small `Alert` inside the card for planners; nothing for viewers.
  - [x] Picker: a `Dialog` (`DialogTitleWithClose`, `fullWidth maxWidth="xs"`) with an MUI `Autocomplete` (`freeSolo`, options = trip items not linked to this day, `filterOptions` = case-insensitive substring on `name`, option label shows name + category in `inkSoft`). Add a synthetic last option "„{input}“ neu anlegen" / "Create '{input}'" when the trimmed input's `packingNameKey` matches **no** trip item (linked or not — an input matching an already-linked item shows no create option and the option list says it is already on this day, or simply filters to nothing; never a create). Picking an existing option → `POST day-links { tripDayId, itemId }`, close. Picking the create option → step 2 in the same dialog: the name (read-only text) + category `Autocomplete freeSolo` with `suggestedPackingCategories` + "Anlegen" / "Create" button → `POST day-links { tripDayId, name, category }`. Enter on an input that exactly matches an existing item's key links that item (AC 6).
  - [x] After a successful link/create/unlink: upsert the returned item into local state (its `days` now include/exclude this day). Remove is optimistic (drop the row, restore on failure with an `Alert`). Map error codes as `TripPackingList.tsx`'s `resolveApiError`.
  - [x] CSRF: same `ensureCsrfToken` pattern as `TripPackingList.tsx` (fetch `/api/auth/csrf` once).
- [x] **Task 5: Mount in the day view** (AC: 1, 3)
  - [x] In `TripDayView.tsx`, in the side column (the `Box` at ~:4955 holding the cost card, `TripDayMapPanel` and `TripDayBucketListPanel`), insert `<TripDayPackingSection tripId={tripId} dayId={day.id} canEdit={canEditPlanning} />` as the **first** child, above the cost card — it is the morning checklist. **Outside** any `canEditPlanning` guard (viewers see a non-empty day's list). The column already has `gap: 2`; add no margins.
  - [x] `TripDayView`'s own `loadDay` is untouched: the section owns its fetch (do **not** add packing items to `GET /api/trips/[id]` — `getTripWithDaysForUser` feeds the connector and `test/mcpTripRouteSinglePass.test.ts` counts its queries).
- [x] **Task 6: Packing list page - linked days + fresh delete** (AC: 8, 9)
  - [x] `PackingItemWire` (exported from `TripPackingList.tsx`) gains `days: { id: string; dayIndex: number; date: string }[]`. Under the item name (same `Typography` block, `variant="body2"`, `tokens.inkSoft`, `overflowWrap: "anywhere"`) render the short dates joined by " · " via `formatShortDate(date, language)` (skip `null`s). `data-testid="packing-row-days"`. Nothing when `days` is empty.
  - [x] Delete: send `{ itemId, confirmedDayCount: item.dayCount }`. On 409 `days_changed`, update the item's `dayCount` from `error.details.dayCount` (and drop stale `days` by re-fetching the list, or simply set `dayCount`) and open the confirmation dialog with the fresh count (if called from the confirmation dialog itself, just update its text). The confirmed delete then sends the fresh count. Delete `DW-432`'s ledger entry status → `resolved (16.2)` in `_bmad-output/implementation-artifacts/deferred-work.md`.
- [x] **Task 7: i18n** (AC: all UI)
  - [x] Add to both `src/i18n/de.ts` and `src/i18n/en.ts` (parity enforced by `test/i18nDictionaries.test.ts`): `trips.packingList.dayTitle` Mitnehmen / Take along · `.dayAdd` Hinzufügen / Add · `.dayAddAria` Mitnehmen hinzufügen / Add to take along · `.dayPickerTitle` Mitnehmen hinzufügen / Add to take along · `.dayPickerLabel` Gegenstand suchen oder neu eingeben / Search or type a new item · `.dayCreateOption` „{name}“ neu anlegen / Create '{name}' · `.dayCreate` Anlegen / Create · `.dayRemoveAria` {name} vom Tag entfernen / Remove {name} from this day · `.dayAlreadyLinked` Schon an diesem Tag. / Already on this day. · `.dayLoadError` Mitnehmen-Liste konnte nicht geladen werden. / Could not load the take-along list. Reuse existing `trips.packingList.packedMark`, `.categoryLabel`, `.other`, `.saveError`, `.forbidden`, `.suggest.*`. Use `formatMessage` for placeholders.
- [x] **Task 8: Tests** (AC: 12) — see Dev Notes → "Testing".
- [x] **Task 9: Gates** — `npm run typecheck`, `npm run lint` (0 errors), `npm test` (full suite green; baseline 265 files / 4220 tests after 16.1's review), `npm run build`.

### Review Findings

- [x] [Review][Patch] Unlink 404 handling keys on the English message and restores the row when the day or trip is gone (the link is gone either way) [travelplan/src/components/features/trips/TripDayPackingSection.tsx:269]
- [x] [Review][Patch] Answers after day navigation: a successful add leaves the picker open and drops the trip-wide item update; add/remove errors show on the new day; the picker is not reset when `dayId` changes [travelplan/src/components/features/trips/TripDayPackingSection.tsx:206]
- [x] [Review][Patch] A failed remove restores the whole pre-click snapshot, overwriting newer updates of the item; re-add only this day's link [travelplan/src/components/features/trips/TripDayPackingSection.tsx:263]
- [x] [Review][Patch] Planner loading/error state shows a disabled add button instead of the heading-only card (Task 4) [travelplan/src/components/features/trips/TripDayPackingSection.tsx:311]
- [x] [Review][Patch] `resolveApiError` copied from the packing page instead of shared [travelplan/src/components/features/trips/TripDayPackingSection.tsx:91]
- [x] [Review][Patch] Test gaps: route DELETE with unknown/foreign day (404 "Trip day not found"), DELETE without CSRF, foreign-item unlink message, viewer sees the linked-days line; repo test's `expect(day2).toBeDefined()` asserts nothing [travelplan/test/packingListDayLinksRoute.test.ts]
- [x] [Review][Defer] Link/add-to-day P2002 retry has no test [travelplan/src/lib/repositories/packingListRepo.ts] — deferred (DW-438)
- [x] [Review][Defer] Re-add while the day remove is in flight can desync the section [travelplan/src/components/features/trips/TripDayPackingSection.tsx:256] — deferred (DW-439)

## Dev Notes

### Shared Epic 16 rules (apply verbatim)

- Writes go through `packingListRepo`, never Prisma directly, and re-check access per trip: owner and contributor write, viewer reads (FR30, FR32).
- Name: trimmed, 1–80 chars, unique per trip ignoring case (`packingNameKey`: NFC + trim + lower-case). A second "Taucherbrille" resolves to the existing item.
- Category: free text, trimmed, ≤ 40, optional; "Sonstiges"/"Other" in any case is stored as `null`; a category matching an existing one ignoring case reuses the stored spelling (`resolveCategory` in the repo).
- Categories alphabetical, "Other" last; items alphabetical within a category.
- All UI text in German and English.

### What 16.1 built (current state — read these files first)

- `prisma/schema.prisma`: `PackingItem` (`nameKey` unique with `tripId`) and `PackingItemDay` (`@@id([packingItemId, tripDayId])`, both relations `onDelete: Cascade`, index on `tripDayId`). **No migration in this story** — the link table exists and is empty in production. Prisma's compound-id accessor is `packingItemId_tripDayId`.
- `src/lib/repositories/packingListRepo.ts` (268 lines): `findTripForTripWriter` (explicit `role: "CONTRIBUTOR"` — load-bearing), `detailSelect`/`toDetail`, `resolveCategory(tx, tripId, raw, excludeItemId?)`, `listPackingItemsForTrip` (participant read clause + `deriveTripAccessRole`; one query), `createPackingItem` (find by key → `existed`, else create; `P2002` → `existed` with the winner), `updatePackingItem`, `deletePackingItem` (`deleteMany({ where: { id, tripId } })`, links cascade). Every write takes a required `origin: WriteOrigin`; the app passes `"user"` → `aiChangedAt` cleared.
- `src/app/api/trips/[id]/packing-items/route.ts`: GET (read gate in the repo), POST/PATCH/DELETE through a local `authorizeWrite` helper, `toWire` (dates → ISO). Error code `duplicate_name` 409.
- `src/lib/trips/packingList.ts`: `normalizePackingName`, `packingNameKey`, `normalizePackingCategory`, `groupPackingItems(items, otherLabel, locale)`, `suggestedPackingCategories(defaults, used, locale)`. Pure, client-safe — the day section uses the same functions.
- `src/components/features/trips/TripPackingList.tsx` (732 lines): the page; exports `PackingItemWire`; `handleDeleteFromEdit` decides the confirmation from the loaded `dayCount` (the DW-432 gap this story closes); viewer rows already render the packed `CheckIcon` with `role="img"` + `packedMark`.
- Nothing in the app created links before this story; tests seeded them with `prisma.packingItemDay.create`.

### Design decisions taken in this story (keep them)

- **The day section owns its fetch** of the whole trip list (`GET /packing-items`) rather than riding on `GET /api/trips/[id]`. Reasons: the picker needs the whole trip list anyway; `getTripWithDaysForUser` is shared with the connector and pinned to a single query; and the 8+ `TripDayView` suites stay unaffected except for the new URL (see Testing → trap).
- **One endpoint for link and create-and-link** (`POST day-links`), distinguished by `itemId` vs `name` in the body, so "typing an existing name links it" is decided on the server by `nameKey` and the client cannot create a duplicate even with a stale list.
- **Link/unlink bump the item** (`aiChangedAt` per origin, `updatedAt` automatically). An app link is an app write and clears the KI marker (15.4 semantics); 16.4's `update_packing_item` stale check compares `updatedAt` and must see link changes. No-op link/unlink does not bump.
- **Unlink is idempotent and unconfirmed** (AC 7, accepted default 4).
- **The day list shows no strike-through**: packed items get the check mark only. Strike-through on the trip list means "done packing"; on the day it would read as "done for today", which the day list deliberately does not track (Tommy: day list is information only, nothing gets used up).
- **No per-category counts on the day** — they describe packing progress, which lives on the trip list.

### Access (do not get this wrong)

- `GET /packing-items` is the participant read (viewers included) — the day section can use it for viewers.
- Link/unlink/create are writes: route gate `refuseUnlessTripWriter(userId, tripId, "Trip not found")` (viewer 403, outsider 404) **and** the repo's writer clause. The UI hiding the add/remove buttons is not the protection.
- Cross-trip ids: the day must belong to the trip (`tripDay.findFirst({ where: { id: tripDayId, tripId } })`) and the item too. Never link an item of trip A to a day of trip B — a test pins it.

### API shapes

```
GET    /api/trips/{id}/packing-items                 → { data: { accessRole, items: PackingItemWire[] } }
DELETE /api/trips/{id}/packing-items  { itemId, confirmedDayCount? }
       → { data: { deleted: true } } | 409 { error: { code: "days_changed", details: { dayCount } } } | 404

POST   /api/trips/{id}/packing-items/day-links  { tripDayId, itemId }                 (link existing)
                                               | { tripDayId, name, category? }         (create-or-resolve + link)
       → { data: { item: PackingItemWire, created: boolean } } | 404 (trip / day / item) | 403 viewer | 400
DELETE /api/trips/{id}/packing-items/day-links  { tripDayId, itemId }
       → { data: { item: PackingItemWire } } | 404 | 403

PackingItemWire = { id, name, category: string|null, packed, dayCount, days: { id, dayIndex, date }[],
                    aiChangedAt: string|null, createdAt, updatedAt }
```

`days` sorted by `dayIndex` ascending. `date` is the stored UTC-midnight ISO string; format with `formatShortDate` (UTC zone — never `toLocaleDateString` in the viewer's zone).

### Files to touch

| File | Action | Notes |
|---|---|---|
| `src/lib/repositories/packingListRepo.ts` | UPDATE | `days` on the detail; link / add-to-day / unlink; `confirmedDayCount` on delete; shared create-or-resolve |
| `src/lib/validation/packingListSchemas.ts` | UPDATE | day-link schemas; `confirmedDayCount` |
| `src/app/api/trips/[id]/packing-items/route.ts` | UPDATE | use shared helpers; `days` in wire; 409 `days_changed` |
| `src/app/api/trips/[id]/packing-items/shared.ts` | NEW | `authorizeWrite`, `toWire`, CSRF/JSON helpers (not a route file — Next only treats `route.ts` as a route) |
| `src/app/api/trips/[id]/packing-items/day-links/route.ts` | NEW | POST / DELETE |
| `src/components/features/trips/TripDayPackingSection.tsx` | NEW | day section + picker |
| `src/components/features/trips/TripDayView.tsx` | UPDATE | mount the section first in the side column |
| `src/components/features/trips/TripPackingList.tsx` | UPDATE | linked days line; delete with `confirmedDayCount` + 409 handling; `PackingItemWire.days` |
| `src/i18n/de.ts`, `src/i18n/en.ts` | UPDATE | keys above |
| `_bmad-output/implementation-artifacts/deferred-work.md` | UPDATE | DW-432 → resolved |

**Must be preserved:**
- `TripDayView.tsx` (5466 lines): its `loadDay` (`:1041`), the AI-changes notice (`:4121`), the day-change receipt flow, and the side column order cost card → map → bucket list. The section goes above the cost card; nothing else moves. Do not touch `canEditPlanning`'s derivation (`:856`, it deliberately defaults to read-only when `accessRole` is missing).
- 16.1's behaviour of the packing page (tick sequencing, highlight nonce, remembered filter, duplicate-add upsert) — change only the delete path and the row's second line.
- `deletePackingItem` without `confirmedDayCount` behaves exactly as before (16.4 relies on it).
- The trip export/import (16.1) already writes/reads `dayIndexes`; untouched.

### UX notes

- The day view on a phone is one column: the side column follows the timeline. That is acceptable for this story (the section is at the top of that column); do not reorder the grid.
- Rows: `minHeight: 44`, name `body1`/`12.5px 600` in the style of the side-column cards, `ul/li` with `borderBottom` like the cost card's list (`:4985-5002`, `:last-child` no border).
- Packed mark: `CheckIcon` 18 px in `tokens.inkSoft`, in a fixed 24 px slot at the row start so names align whether packed or not.
- Picker: autofocus the search input; Escape closes; after a link the dialog closes and focus returns to the add button (MUI default). Create step keeps the typed name; "Back" is the dialog close.
- Theme tokens only — no hard-coded colours (`test/helpers/hardcodedColour.ts` guard tests).

### Testing

Real SQLite test DB per file (`test/globalSetup.ts`). Patterns from 16.1: `test/packingListRepo.test.ts`, `test/packingListRoute.test.ts`, `test/tripPackingList.test.tsx` (its `installApi` fetch fake), `test/helpers/routeContext.ts`, `test/helpers/mockFetch.ts`.

**Trap — strict fetch stubs in the day view suites.** Eight `test/tripDayView*.test.tsx` suites (and `tripTimelinePlan`, `theme`, `iconButtonFocusRing`, `dialogOpenInstanceKey`, `fullscreenPhotoViewer`, `tripAccommodationDialog`, `tripDayPlanDialog`, `tripDaySuggestionsDialog` render `TripDayView` too) have fetch stubs that `throw new Error(\`Unexpected fetch ${url}\`)` for unknown URLs (e.g. `tripDayViewLayout.test.tsx:2519`). The new section's GET would hit that. The section catches fetch errors (it must — try/catch around the whole load), so most suites keep passing, but do **not** rely on that: add `vi.mock("@/components/features/trips/TripDayPackingSection", () => ({ default: () => null }))` to every suite that renders `TripDayView` and does not test the section — the exact pattern the timeline suites use for `TripBucketListPanel` (`test/tripHeroImage.test.tsx:12`). Then the day-view integration test (below) renders the real one.

**Trap — existing 16.1 assertions that change.** `test/tripPackingList.test.tsx:287` asserts the DELETE body is exactly `{ itemId: "1" }` → now `{ itemId: "1", confirmedDayCount: 0 }`; its `item()` factory (`:15`) needs `days: []`. `test/packingListRoute.test.ts:110` uses `objectContaining` (safe). Update, do not loosen.

New / extended:
- `test/packingListRepo.test.ts` (extend) — link existing (link row + item `updatedAt` bumped + `aiChangedAt` cleared when seeded set); re-link is a no-op (no second row, `updatedAt` unchanged); add-to-day creates unpacked + linked; add-to-day with an existing name in other case/spaces links the existing item (count of items unchanged, its category/packed unchanged); item on two days (`days` sorted by `dayIndex`, `dayCount` 2); unlink removes only this day's link (other day kept, item kept); unlink of a missing link → `unlinked`, no bump; day of another trip → `day_missing`; item of another trip → `missing`; viewer/stranger → `not_found` on all three writes; delete with `confirmedDayCount` mismatch → `days_changed` + nothing deleted; match → deleted with all links; re-dating via `updateTripWithDays` to a shorter range removes the dropped days' links and keeps the items (AC 10).
- `test/packingListDayLinksRoute.test.ts` (new) — POST link (200, `created: false`, `days` contains the day), POST by new name (`created: true`), POST by existing name (`created: false`, same id), DELETE unlink; viewer 403; stranger 404; CSRF missing 403; invalid body 400 (both `itemId` and `name`, neither, empty name, 81 chars); unknown day 404; unknown item 404.
- `test/packingListRoute.test.ts` (extend) — DELETE 409 `days_changed` with `details.dayCount`; wire carries `days` with ISO dates.
- `test/tripDayPackingSection.test.tsx` (new) — groups and order; packed mark present only on packed items, no checkbox anywhere; empty day: planner sees heading + add, viewer sees nothing; viewer with items sees the list without add/remove; picker filters case-insensitively and hides already-linked items; picking links (POST body `{ tripDayId, itemId }`) and the row appears; typing a new name shows the create option, choosing it + category posts `{ tripDayId, name, category }`; typing an existing name in other case shows no create option and Enter links the existing item; remove posts DELETE without a confirmation dialog and the row disappears (restored on error); German labels.
- `test/tripDayViewPacking.test.tsx` (new, or a `describe` in an existing day view suite) — the real section is mounted first in the side column for owner and viewer (viewer: only when the day has items).
- `test/tripPackingList.test.tsx` (extend) — linked days line ("Mon, 8/3 · Tue, 8/4" style via `formatShortDate`), none for an unlinked item; DELETE 409 `days_changed` opens the confirmation with the fresh count and the confirmed delete sends it.

### Previous story intelligence (16.1)

- Review patches worth repeating here: NFC before length checks (already in the schema fields — reuse them); per-item sequencing for racing writes (relevant if remove is clicked twice — disable the row's button while its request runs); upsert returned items rather than trusting local state; group React keys with a prefix no category can equal (`category:${key}` / `none`).
- `localStorage` is not needed in this story.
- Deferred and still open, do not fix here unless trivial: DW-433 (row of an item deleted elsewhere — the day section should at least treat a 404 "Packing item not found" on unlink as success-and-drop, since the link is gone either way), DW-434 (CSRF cached), DW-435, DW-436.
- 16.1's dev note "test/tripExportRoute.test.ts builds real DB rows" — the Dev Notes there were wrong once; verify line references here with `grep -an` (`tripRepo.ts` contains a byte that makes plain `grep` treat it as binary and print nothing).

### Git intelligence

`c111d8e` (16.1) added the packing model, repo, route, page, overview card and backup; `159ba13` (15.9/15.10) and 15.4 established required `origin`, `aiChangedAt` "set by AI, cleared by app", single-query reads pinned by tests. No dependency, no migration needed for this story.

### Project Structure Notes

- No `project-context.md` exists; conventions come from the code and `architecture.md:182`.
- Next.js 16 app router, Prisma 7 + SQLite (`src/generated/prisma`), MUI 7, Vitest, zod. No new dependency.

### References

- [Source: _bmad-output/planning-artifacts/epics.md → Epic 16, Story 16.2]
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-11-08-packing-list.md §§2, 4.4, 4.5; open defaults 2–4]
- [Source: _bmad-output/planning-artifacts/architecture.md:182]
- [Source: _bmad-output/planning-artifacts/prd.md → FR59, FR30, FR32]
- [Source: _bmad-output/implementation-artifacts/16-1-the-trips-packing-list.md]
- [Source: _bmad-output/implementation-artifacts/deferred-work.md → DW-432, DW-433]
- [Source: travelplan/src/components/features/trips/TripDayView.tsx:856 (canEditPlanning), :1041 (loadDay), :4955-5070 (side column)]
- [Source: travelplan/src/lib/repositories/tripRepo.ts:1031-1086 (updateTripWithDays keeps days by date, deletes stale ones)]
- [Source: travelplan/src/lib/trips/formatShortDate.ts]

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (claude-opus-5-5), bmad-dev-story

### Debug Log References

- Red first: 11 new repo tests failed before the repo functions existed; then green.
- `react-hooks/set-state-in-effect` refused resetting `loading` inside the section's load effect; `loading` is now derived (`loadedFor !== dayId`), set only in the async callback.
- `tripDayViewPacking` first matched every h6 (the timeline's "Day timeline" too); it now filters to the four side-column card titles.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.
- **Side column order changed by Tommy during implementation (2026-11-08): Map → Costs → Take along → Bucket list.** This replaces Task 5's "first child, above the cost card" and the "cost card → map → bucket list must be preserved" note: the map moved above the cost card, and the section sits between costs and the bucket list. Pinned by `test/tripDayViewPacking.test.tsx`. No existing day view test asserted the old order.
- Repository: `PackingItemDetail.days` (sorted in `toDetail`; `dayCount = days.length`, `_count` dropped, so there is one source). New `linkPackingItemToDay`, `addPackingItemToDay`, `unlinkPackingItemFromDay`; the 16.1 create body is now the private `createOrResolveInTx`, shared by `createPackingItem` and `addPackingItemToDay`. Link and unlink write the item (`aiChangedAt` per origin, `updatedAt`) only when a link row changed. A concurrent `P2002` on link or add-to-day retries the transaction once (`retryOnceOnUniqueViolation`), which then resolves onto the winner.
- **Small deviation:** `unlinkPackingItemFromDay` also returns `day_missing` (the task listed `not_found | missing | unlinked`). AC 11 says a `tripDayId` that is not a day of this trip answers 404, so unlink checks the day like link does. The route maps it to 404 "Trip day not found".
- `deletePackingItem({ confirmedDayCount })`: checks the count in a transaction and returns `days_changed` when the item has links and the count differs. Without the parameter it behaves exactly as in 16.1. A confirmed count higher than the real one with zero links still deletes, as the task's rule says.
- API: `packing-items/shared.ts` holds `authorizeWrite`, `toWire` (now with `days`, ISO dates), CSRF and JSON helpers. `packing-items/route.ts` uses it and answers 409 `days_changed` with `{ dayCount }`. New `packing-items/day-links/route.ts` (POST link or create-by-name, DELETE unlink).
- UI: `TripDayPackingSection` fetches the whole list itself and re-fetches on `dayId` change. Rows are information only: a packed mark (no strike-through), no counts. The picker is an `Autocomplete` with a case-insensitive substring filter and a "Create '…'" option shown only when the typed key matches no trip item. "Already on this day." shows as helper text. Enter on an exact key links that item. Remove is optimistic without confirmation, with a disabled button while its request runs. A 404 "Packing item not found" counts as done and drops the row (DW-433). Answers that arrive after moving to another day are dropped.
- `usePackingCategoryOptions` was extracted from `TripPackingList.tsx`, so the page and the day picker offer the same category suggestions.
- Packing page: a second line under the name lists the linked days (`formatShortDate`, " · "). Delete sends `confirmedDayCount`. On 409 the page updates `dayCount` and opens (or updates) the confirmation with the fresh count. DW-432 resolved in the ledger.
- `trips.packingList.dayAdd` is used as the add button's `title` (tooltip); its accessible name is `dayAddAria`.
- 8 `TripDayView` suites mock `TripDayPackingSection`. The real section runs in `tripDayViewPacking.test.tsx` and `tripDayPackingSection.test.tsx`.
- Gates: typecheck clean; lint 0 errors (80 pre-existing warnings, none in new files); full suite 268 files / 4262 tests green (baseline 265 / 4220); `npm run build` passes, with `/api/trips/[id]/packing-items/day-links` listed.

### File List

- `travelplan/src/lib/repositories/packingListRepo.ts` (modified)
- `travelplan/src/lib/validation/packingListSchemas.ts` (modified)
- `travelplan/src/app/api/trips/[id]/packing-items/route.ts` (modified)
- `travelplan/src/app/api/trips/[id]/packing-items/shared.ts` (new)
- `travelplan/src/app/api/trips/[id]/packing-items/day-links/route.ts` (new)
- `travelplan/src/components/features/trips/TripDayPackingSection.tsx` (new)
- `travelplan/src/components/features/trips/TripDayView.tsx` (modified)
- `travelplan/src/components/features/trips/TripPackingList.tsx` (modified)
- `travelplan/src/i18n/de.ts` (modified)
- `travelplan/src/i18n/en.ts` (modified)
- `travelplan/test/packingListRepo.test.ts` (modified)
- `travelplan/test/packingListRoute.test.ts` (modified)
- `travelplan/test/packingListDayLinksRoute.test.ts` (new)
- `travelplan/test/tripDayPackingSection.test.tsx` (new)
- `travelplan/test/tripDayViewPacking.test.tsx` (new)
- `travelplan/test/tripPackingList.test.tsx` (modified)
- `travelplan/test/tripDayViewEmail.test.tsx`, `tripDayViewReorder.test.tsx`, `tripDayViewAiChanges.test.tsx`, `tripDayViewLayout.test.tsx`, `tripDayViewLegPush.test.tsx`, `tripDayViewDayChange.test.tsx`, `tripDayViewSuggestionsEntry.test.tsx`, `tripDayViewOrphanSegments.test.tsx` (modified: section mock)
- `_bmad-output/implementation-artifacts/deferred-work.md` (modified: DW-432 resolved)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified)

### Change Log

- 2026-11-08: Story created (bmad-create-story). Status → ready-for-dev.
- 2026-11-08: Implemented (bmad-dev-story): day links in repo/API, "Take along" section in the day view, linked days and fresh-count delete on the packing list page. Side column reordered to Map → Costs → Take along → Bucket list at Tommy's request. Status → review.
- 2026-11-08: Code review (bmad-code-review): 6 patches applied (day section: 404 on unlink, answers after day navigation, link-only restore, heading-only loading card, shared error mapper; test gaps), 2 deferred (DW-438, DW-439). Status → done.
