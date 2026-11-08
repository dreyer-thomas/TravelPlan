---
baseline_commit: fa840614b877da110d266cd8dc6c13493c1b6df8
---

# Story 16.4: The Packing List through the Connector

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As someone planning with Claude,
I want Claude to read, add, tick off, delete and link packing items,
so that Claude can draft the list from the trip's activities, places and season, and keep it current with me.

**FRs covered:** FR53, FR54 (packing list, amended 2026-11-08), FR57. **Depends on:** 16.1, 16.2 (done), 15.4 (done).

## Acceptance Criteria

1. **`get_packing_list(tripId, dayId?)`**, read-only, writers only (R1: any other trip → `Trip not found`). Without `dayId` it returns every item; with `dayId` only the items linked to that day (`Day not found` for a day that is not on the trip). Per item: `id`, `name`, `category` (or `null`), `packed`, `dayIds` (ascending by `dayIndex`), `updatedAt` (ISO 8601) and `aiChangedAt` (ISO 8601, or `null`). The AC in epics.md calls this field `aiChanged`. `aiChangedAt` is used because every other connector read already uses that key (see Dev Notes, deviation D2). Items come in name-key order.
2. **`get_trip`** gains `packing: { total, packed }` at the trip level. **`get_day`** gains `packingItems: [{ id, name, category, packed }]`, the items linked to that day in name-key order. Every write tool that returns `day` (through `readDay` → `toLinkedPlannerDay`) carries this field too. Both tool descriptions name the new fields.
3. **`add_packing_items(tripId, items: [{ name, category? }], dayId?)`** with 1–50 items. Each name is validated by the app's rules: NFC, trimmed, 1–80 characters; category ≤ 40 characters and optional. One invalid input refuses the whole call, and the refusal names its index. A name that exists (ignoring case and surrounding spaces) resolves to the existing item: no duplicate, and its category and packed state are unchanged. A new name creates an unpacked item. A repeat within the same batch resolves to the item an earlier input resolved to. With `dayId`, every resolved item is linked to that day. Unknown day → `Day not found`, nothing written. The answer lists one entry per input: `{ name (as given), itemId, status: "created" | "existed" }`. It also carries `aiChangeId` (`null` when nothing was written) and `items`: the resolved items, deduplicated, in the `get_packing_list` shape.
4. **`update_packing_item(tripId, itemId, updatedAt, name?, category?, packed?, addDayIds?, removeDayIds?)`** changes only the given fields, under the shared rules. A rename onto another item's name (ignoring case) is refused (`A packing item named "<name>" already exists.`). A case fix of the item's own name is allowed. `category: null` or `""` clears the category. "Sonstiges"/"Other" in any case is stored as `null`. A category matching an existing one (ignoring case) takes the existing spelling. A stale `updatedAt` answers exactly `Packing item changed since you read it; read the list again` and writes nothing. An unknown item → `Packing item not found`. Any day id not on the trip → `Day not found`, nothing written. A day in both `addDayIds` and `removeDayIds` is refused. No field given → `Nothing to change.` A call whose effect is a no-op (same values, links already as asked) writes nothing and answers `aiChangeId: null`. The answer is `{ aiChangeId, item }`.
5. **`delete_packing_item(tripId, itemId)`** deletes the item and every day link. Unknown item → `Packing item not found`. The description says plainly that it removes the item from every day it is linked to: the confirmation the UI asks for is the model's job. The answer is `{ aiChangeId, deleted: { id, name, dayCount } }`.
6. **The 15.4 rules for every write:**
   - It goes through `startWrite`: client id required, writers only (`Trip not found` otherwise, viewers included), and the shared rate limit through `runTool`.
   - It writes exactly one `ai_changes` row in the write's own transaction. `tripDayId` is `null`, except for an `add_packing_items` with `dayId`, whose row carries that day.
   - The actions are `packingAdded` (subject: the stored names joined with ", ", capped at 120 code points), `packingUpdated` (subject: the item's name after the write) and `packingDeleted` (subject: the deleted item's name).
   - `list_ai_changes` lists them with an English summary, and its description names the new actions.
7. **KI/AI marker:** a connector write sets `packing_items.ai_changed_at` on every item it created or changed, including an existing item it only linked to the day. An app write clears it (already true through `origin: "user"`). The packing list page and the day's "Take along" section already render `<AiBadge />` while it is set (16.1/16.2); this story proves it in tests.
8. **Undo:** every packing write stores a packing receipt (each touched item's prior state and day links, or the ids it created) and is undoable through `undo_ai_change` and from the app (`POST /api/trips/{id}/ai-changes/{changeId}/undo`) in one step. It is **refused as stale** when any touched item changed since: its `updatedAt` differs from the stamp the write left, it is gone, or a restore would collide with another item's name. Undo restores each item's `updatedAt` and `aiChangedAt` to their prior values, so that undoing newest first works across chained changes. A link to a day that no longer exists is not restored. A stale packing undo answers `The packing list has changed since this change was made; it can no longer be undone.` (tool) and `409 undo_stale` (app).
9. **AI-changes notice on the packing list page** (writers only): the day view's `AiChangesNotice`, with its collapsed line and count, expandable rows with Undo, and OK, lists every not-undone, not-acknowledged packing change of the trip, day-scoped adds included. The title reads "KI hat die Packliste geändert" / "AI changed the packing list". After an undo the list reloads. A day-scoped packing add also shows on that day's notice in the day view, as every change with that `tripDayId` does. An undo there refreshes the day's "Take along" section.
10. **Tests** cover:
    - reading the whole list and a day's list
    - `get_trip.packing` and `get_day.packingItems`
    - a batch add with an existing name and an in-batch repeat
    - a day-scoped add
    - tick
    - a rename refused as a duplicate
    - linking and unlinking days
    - delete
    - a stale `updatedAt`
    - undo of each write, from the tool and from the app route, including chained undo newest first and a stale undo after an app edit
    - the badge set by a connector write and cleared by an app write
    - a view-only trip answering *not found* for every new tool
    - the packing-scoped `GET ai-changes`
    - the notice on the packing page in both languages
11. **Production (Tommy, manual):** asking Claude "Make a packing list for this trip and put the beach things on the beach days" produces items with KI badges, linked to the right days, and Undo in the app removes them.

**Out of scope:** an in-app AI suggestion feature; a copy-between-trips tool (the assistant reads one list and adds to the other); the open packing ledger items DW-436 (names made only of invisible characters) and DW-442 (interior newlines), which also apply to connector input but stay deferred.

## Tasks / Subtasks

- [x] **Task 1: The packing receipt (AC 8)**
  - [x] 1.1 New `src/lib/trips/packingChangeReceipt.ts` (no Prisma import, like `dayChangeReceipt.ts`): the types `PackingItemSnapshot = { id, name, nameKey, category, packed, aiChangedAt, createdAt, updatedAt, dayIds: string[] }` (Date on the server, ISO on the wire) and `PackingReceiptEntry = { change: "created"; itemId; updatedAt } | { change: "updated"; before: PackingItemSnapshot; updatedAt } | { change: "deleted"; before: PackingItemSnapshot }`, where `updatedAt` is the stamp the write left. The receipt is `PackingChangeReceipt = { kind: "packingChanged"; version: 1; entries: PackingReceiptEntry[] }`. Add the wire converters `toPackingChangeReceiptWire` and `fromPackingChangeReceiptWire`.
  - [x] 1.2 New `src/lib/validation/packingChangeReceiptSchemas.ts`: `storedPackingChangeReceiptSchema`, with every object `.strict()`, ids bounded (128), the ISO-timestamp regex as in `dayChangeReceiptSchemas.ts:52`, `entries` 1–50 and `dayIds` capped (e.g. 1000). No length caps on stored text (see the reasoning at `dayChangeReceiptSchemas.ts:22-30`).
- [x] **Task 2: `aiChangeRepo` learns the second receipt kind (AC 6, 8)**
  - [x] 2.1 Add `"packingAdded" | "packingUpdated" | "packingDeleted"` to `AiChangeAction`, plus one doc line in the union's comment.
  - [x] 2.2 `insertAiChangeInTransaction`: `receipt: DayChangeReceipt | PackingChangeReceipt | null`. `storableReceiptJson` dispatches on `"kind" in receipt && receipt.kind === "packingChanged"`. A packing receipt is validated with `storedPackingChangeReceiptSchema` and serialized; with `requireReceipt` a failure throws `UnstorableReceiptError`. The day path is unchanged (`findInvalidity` only for day receipts).
  - [x] 2.3 Replace the bare `parseStoredReceipt` with a parser that returns `{ type: "day"; receipt } | { type: "packing"; receipt } | null`, keyed on the parsed JSON's `kind === "packingChanged"`. Keep the sweep's and `pendingDayChangeKeepsUrl`'s behaviour: they only ever see day receipts (`KEPT_FILE_ACTIONS`), so they narrow to `type === "day"`.
  - [x] 2.4 `undoAiChange`: a packing receipt goes to `undoPackingChangeForTrip` (Task 3) with the same `inTransaction` that marks the row undone. Map its results onto `AiChangeUndoResult`. Add the stale subject so callers can phrase it: `{ status: "stale"; scope: "day" | "packing" }`, and keep the "concurrent undo got there first → `already_undone`" re-read for both. Update the exhaustive switches in `undo_ai_change` (`aiChanges.ts`) and the app route (`ai-changes/[changeId]/undo/route.ts`). The route keeps `409 undo_stale` with the message "The packing list has changed since this change was made" for packing.
  - [x] 2.5 `listAiChangesForTrip` gains `actions?: AiChangeAction[]` (`action: { in }`). Export `PACKING_AI_CHANGE_ACTIONS`.
- [x] **Task 3: Connector writes and undo in `packingListRepo` (AC 3, 4, 5, 7, 8)**. Every packing write goes through this repository (Epic 16 shared rule). Do not create a `connectorPackingRepo.ts`.
  - [x] 3.1 A hook type `PackingInTransactionHook = (tx, outcome: { receipt: PackingChangeReceipt }) => Promise<void>`. It runs last inside the transaction, and a throw rolls everything back (mirrors `InTransactionHook` in `writeOrigin.ts`).
  - [x] 3.2 `addPackingItemsForConnector({ userId, tripId, items, tripDayId?, inTransaction })` → `not_found | day_missing | { status: "added", results, items, written: boolean }`:
    - Writer gate (`findTripForTripWriter`). One transaction for the whole batch, reusing `createOrResolveInTx` (origin `"ai"`) and `linkInTx`.
    - Snapshot the `before` (with `dayIds`) of an **existing** item before linking it, and record it only if the link was new. That write sets `aiChangedAt` through `touchItem`.
    - Created items → `created` entries with their post-write `updatedAt`. An existing item with an already-present link, or without `dayId`, writes nothing and gets no entry.
    - Run the hook only when there is at least one entry.
    - Wrap in `retryOnceOnUniqueViolation`. The tool must reset its captured change id per attempt.
  - [x] 3.3 `updatePackingItemForConnector({ userId, tripId, itemId, expectedUpdatedAt, name?, category?, packed?, addDayIds?, removeDayIds?, inTransaction })` → `not_found | missing | day_missing | duplicate_name | unchanged | { status: "updated", item }`:
    - Read the item and its links in the transaction, and throw `ChangedSinceReadError` on a stamp mismatch (compare `getTime()`).
    - Verify every given day is on the trip.
    - Apply the rename (same clash rule as `updatePackingItem`), the category through `resolveCategory(..., itemId)`, packed, and the links. Creating and deleting `PackingItemDay` rows goes in the same transaction.
    - If nothing differs, return `unchanged` without writing. Otherwise write once with `aiChangedAt: new Date()` and emit `{ change: "updated", before, updatedAt }`.
    - Map `P2002` to `duplicate_name`.
  - [x] 3.4 `deletePackingItemForConnector({ userId, tripId, itemId, inTransaction })` → `not_found | missing | { status: "deleted", name, dayCount }`. Snapshot first, then `deleteMany` (links cascade), then the hook with `{ change: "deleted", before }`.
  - [x] 3.5 `undoPackingChangeForTrip({ userId, tripId, receipt, inTransaction })` → `undone | not_found | invalid | stale`:
    - Writer gate. Throw `UndoStaleError` inside the transaction (import it from `dayPlanChangeRepo`) so everything rolls back, and map it to `stale`.
    - Process entries in reverse order:
      - `created`: the item must exist on this trip with the recorded `updatedAt`; delete it.
      - `updated`: the item must exist with the recorded stamp, and `before.nameKey` must not be held by another item. Write back `name`, `nameKey`, `category`, `packed`, `aiChangedAt` **and `updatedAt`** explicitly. Set the links to `before.dayIds` ∩ the trip's current days.
      - `deleted`: no item may hold `before.id` or `before.nameKey`. Recreate it with its own `id`, `createdAt`, `updatedAt` and `aiChangedAt`, then its links to the days that still exist.
    - An item id that exists on **another** trip → `invalid`.
    - Then `inTransaction(tx)`.
    - **Verify in a test that an explicit `updatedAt` survives Prisma's `@updatedAt`.** If it does not, set the stamp with a follow-up `$executeRaw` inside the same transaction. Chained undo (AC 8) depends on it.
  - [x] 3.6 Update the module docblock (the "Story 16.4 will add…" sentence at `packingListRepo.ts:17-18` becomes true).
- [x] **Task 4: The tools (AC 1, 3, 4, 5, 6)**: new `src/lib/mcp/tools/packingTools.ts`, registered in `server.ts` under a `// Story 16.4.` comment.
  - [x] 4.1 `get_packing_list`: `READ_ONLY_TOOL_ANNOTATIONS`, `requireWritableTrip`, then `listPackingItemsForTrip` (filter by day in the tool after checking the day is on the trip; the items carry `days`). Shape through a `toPackingItem` helper (`dayIds`, ISO stamps), placed in `plannerShapes.ts` or a small `packingShapes.ts`.
  - [x] 4.2 `add_packing_items` (`WRITE_TOOL_ANNOTATIONS`), `update_packing_item` and `delete_packing_item` (`DESTRUCTIVE_WRITE_TOOL_ANNOTATIONS`):
    - Each goes through `startWrite` + `isCaller`. Input schemas use `tripIdField` and `idSchema`. Validate names and categories with the app's field rules: export `nameField` and `categoryField` from `packingListSchemas.ts`, or reuse `packingItemCreateSchema` per item. Do not write new limits.
    - `updatedAt` is `z.iso.datetime({ offset: true, ... })`, as `dayWrite.ts:39` has it.
    - `addDayIds` and `removeDayIds` are `z.array(idSchema).max(366)`.
    - Record the change through `insertAiChangeInTransaction` with `requireReceipt: true`, inside a local helper modelled on `recordChange` (`activityWrite.ts:290`), whose hook is typed for the packing receipt.
    - Map `ChangedSinceReadError` → the AC 4 text and `UnstorableReceiptError` → "This packing list holds data the undo cannot keep, so nothing was written."
  - [x] 4.3 Descriptions: the model needs to know four things. Names are unique per trip ignoring case, so adding an existing name links or returns it. There are no quantities. `updatedAt` comes from `get_packing_list`. Delete removes the item from every day, so confirm with the user first.
- [x] **Task 5: Reads gain packing fields (AC 2)**
  - [x] 5.1 `toTripOverview` (`plannerShapes.ts:231`) adds `packing: trip.packing`. `TripWithDays.packing` is already read in the same query (`tripRepo.ts:1225`), so add no extra query, and keep `mcpTripRouteSinglePass.test.ts` green.
  - [x] 5.2 `getPlannerDayForUser` (`connectorReadRepo.ts:146`) reads the day's items inside its existing transaction (`tx.packingItem.findMany({ where: { tripId, days: { some: { tripDayId } } }, select: { id, name, category, packed }, orderBy: [{ nameKey: "asc" }, { id: "asc" }] })`). Add them to `PlannerDay`. `toPlannerDay` emits `packingItems`.
  - [x] 5.3 Update the `get_trip` and `get_day` descriptions. Fix every test that pins the exact day or trip key set (search `test/mcp*.test.ts` and `test/connectorReadRepo.test.ts` for `toEqual({` on whole day objects).
- [x] **Task 6: Change log texts (AC 6)**: in `aiChanges.ts`, add `SUMMARIES` entries (`Added packing items …`, `Updated packing item …`, `Deleted packing item …`). The `list_ai_changes` description lists the three actions and says `dayId` is null "for the bucket list and trip-wide packing changes". `AI_CHANGE_STALE` stays for days; add `AI_CHANGE_PACKING_STALE`.
- [x] **Task 7: The app's notice (AC 9)**
  - [x] 7.1 `GET /api/trips/{id}/ai-changes?scope=packing` lists `listAiChangesForTrip({ actions: PACKING_AI_CHANGE_ACTIONS, notUndone, notAcknowledged, take: 50 })` with no day filter. `tripDayId` and `scope` together → `400 validation_error`. Without `scope`, the behaviour is unchanged. Update the docblock.
  - [x] 7.2 `AiChangesNotice`: add `scope?: "day" | "packing"` (default `"day"`; `dayId` only for day). In packing scope it fetches `?scope=packing`, uses `trips.aiChanges.packingTitle`, keys its "left the day" guards on the scope rather than on `dayId`, and shows `trips.aiChanges.packingStale` for a stale row. Add the three `ACTION_KEYS`. `onBucketChanged` becomes optional. Keep `tripDayViewAiChanges.test.tsx` green with no edits to its assertions.
  - [x] 7.3 `TripPackingList`: render the notice for `canEdit` only, at the top of the list card, above the filters (UX: "the AI-changes notice (16.4) sits at the top"). Add a `reloadKey` to the load effect's dependencies, bumped by the notice's `onDayChanged` callback after an undo, and pass the page's load count as `refreshKey`. The reload must not reset the 16.6 reveals or the add-form prefill (that guard already exists via `restoredForTrip`).
  - [x] 7.4 `TripDayView` + `TripDayPackingSection`: add a `refreshKey` prop to the section and include it in its load effect's dependencies. `reloadDayAfterAiUndo` bumps it, so undoing a day-scoped packing add from the day notice refreshes "Take along".
  - [x] 7.5 i18n, both `de.ts` and `en.ts`:
    - `trips.aiChanges.packingTitle`: "KI hat die Packliste geändert" / "AI changed the packing list"
    - `trips.aiChanges.packingAdded`: "Zur Packliste hinzugefügt: {title}" / "Added to the packing list: {title}"
    - `trips.aiChanges.packingUpdated`: "Gegenstand geändert: {title}" / "Packing item changed: {title}"
    - `trips.aiChanges.packingDeleted`: "Gegenstand gelöscht: {title}" / "Packing item deleted: {title}"
    - `trips.aiChanges.packingStale`: "Die Packliste hat sich seitdem geändert; diese Änderung kann nicht mehr rückgängig gemacht werden." / "The packing list has changed since; this change can no longer be undone."
- [x] **Task 8: Tests (AC 10)**: see Testing below. Then run the full suite, typecheck, lint and build.

### Review Findings

- [x] [Review][Patch] A failed list reload (e.g. after an AI undo) leaves the packing page stuck on the error: `loadError` is never cleared on a later successful load, and it hides the notice and the add form [travelplan/src/components/features/trips/TripPackingList.tsx:245]
- [x] [Review][Patch] The packing page's AI-changes notice does not re-read after the person's own edits (add, tick, rename, delete), so a connector change they have since edited still offers Undo, which can only answer stale; the day view bumps `refreshKey` after every write [travelplan/src/components/features/trips/TripPackingList.tsx:631]
- [x] [Review][Patch] `update_packing_item` maps every unique violation to `duplicate_name`, including one on a `PackingItemDay` link, and then answers `A packing item named "undefined" already exists.` when no rename was asked; only a rename should map to `duplicate_name` [travelplan/src/lib/repositories/packingListRepo.ts:720]
- [x] [Review][Patch] `AiChangesNotice` allows the default `scope="day"` without `dayId`, which requests `?tripDayId=` and lists every change of the trip under the day title; make the props a discriminated union [travelplan/src/components/features/trips/AiChangesNotice.tsx:86]
- [x] [Review][Patch] AC 10 test gaps: undo of an update and a delete (and chained undo) through the app route; undo of a day-scoped add that only linked existing items, through the tool; a name-key order test whose insertion order differs from the sort [travelplan/test/aiChangesRoute.test.ts, travelplan/test/mcpPackingTools.test.ts]
- [x] [Review][Defer] Deleting a day removes the undo of a day-scoped packing add whose created items survive (`ai_changes` cascades with the day) [travelplan/prisma/schema.prisma] — deferred as DW-443 (schema change, AC 6 by design)

## Dev Notes

### Deviations from the planning text (decided here, flagged for Tommy)

- **D1: The receipt is its own type, not a fourth `edited` kind of the v3 day receipt.** The change proposal (`sprint-change-proposal-2026-11-08-packing-list.md:297`) says "a new additive receipt kind, `packingChanged` (still version 3)". That does not fit the code:
  - `receiptShape.tripDayId` is a required id (`dayChangeReceiptSchemas.ts:464`).
  - `undoDayPlanChangeForTrip` refuses a receipt whose day is not on the trip and gates on the day (`dayPlanChangeRepo.ts:1335-1339`).
  - Trip-wide packing writes have no day.

  Making `tripDayId` nullable would ripple through the signed client-held receipt, `findInvalidity` and the undo core. So the packing receipt keeps the proposal's name `packingChanged`, but is a separate stored shape with its own version and its own undo function. `aiChangeRepo` dispatches between the two. Client-held (signed) receipts are not affected: packing receipts are only ever stored server-side.
- **D2: `aiChangedAt` instead of `aiChanged`** in `get_packing_list`. Every connector read since 15.4 exposes `aiChangedAt` (ISO or null; `plannerShapes.ts:30`), and the model already knows that key.

### Current state of the files this story touches

- **`src/lib/repositories/packingListRepo.ts`** (479 lines, includes uncommitted 16.3 work in the tree):
  - `findTripForTripWriter`: the explicit `role: "CONTRIBUTOR"` is load-bearing.
  - `detailSelect` / `toDetail` (days sorted by `dayIndex`) and `resolveCategory`.
  - `createOrResolveInTx`: answers `existed` **without writing**.
  - `linkInTx`: creates the link and `touchItem`s only when new.
  - `retryOnceOnUniqueViolation`.
  - The app writes take `origin: WriteOrigin`. `deletePackingItem` without `confirmedDayCount` is unconditional ("the connector" was anticipated, but the connector needs a snapshot, so add a separate function rather than reuse it).
  - **Preserve:** every existing export and its behaviour; the app routes and their tests must not change.
- **`src/lib/repositories/aiChangeRepo.ts`** (448 lines):
  - `insertAiChangeInTransaction` (retention delete + insert; the `requireReceipt` semantics).
  - `parseStoredReceipt` (day-only today).
  - `sweepExpiredFileDeletions` and `pendingDayChangeKeepsUrl` (day receipts only, through `KEPT_FILE_ACTIONS`).
  - `undoAiChange` (calls `runDayChangeUndo` with an `inTransaction` that marks the row undone via a conditional `updateMany`; the stale → `already_undone` re-read).
  - **Preserve:** retention, the sweep, and the day undo path byte for byte.
- **`src/lib/mcp/tools/activityWrite.ts`**: `startWrite` (client id, `requireWritableTrip`, runs the file sweep), `isCaller`, `recordChange` (typed to the day receipt's `InTransactionHook`, hence a packing twin), `tripIdField`, `writeErrorResult`. `src/lib/mcp/tools/dayWrite.ts` is the closest small template: the stale check, an `unchanged` result that skips the hook, and `aiChangeId: null`.
- **`src/lib/mcp/toolRuntime.ts`**: `runTool` (auth, rate limit 120/min, generic error), `toolResult`, the annotations, `requireWritableTrip` (R1), `idSchema`, `TRIP_NOT_FOUND`, `DAY_NOT_FOUND`.
- **`src/lib/mcp/tools/aiChanges.ts`**: `SUMMARIES` (an unknown action falls back to "Changed activity", which is wrong for packing, so add the entries), plus `list_ai_changes` and `undo_ai_change` with the exhaustive switch.
- **`src/components/features/trips/AiChangesNotice.tsx`** (377 lines): day-bound today (the `dayId` prop, `?tripDayId=`, the `currentDayIdRef` guards, `stateDayId` reset). `TripDayView.tsx:4122` renders it for `canEditPlanning`, with `refreshKey={dayLoadVersion}`.
- **`TripPackingList.tsx`** (940 lines): the load effect depends on `[t, tripId]` (line ~224), `ensureCsrfToken` is at line ~288, `canEdit` comes from `accessRole`, and the badge is at line ~841. **`TripDayPackingSection.tsx`** (515 lines): it loads only when `dayId` changes (line ~100), and the badge is at line ~389.
- **Schema:** `PackingItem.aiChangedAt` and `AiChange` already exist. **No migration.**

### Undo semantics, concretely

- Chain A = add "Sonnencreme", B = tick it. Undo B restores `packed: false`, `updatedAt` = A's stamp and `aiChangedAt` = A's marker. Then undo A finds the stamp it left and deletes the item. Undo A **before** B → stale, because the stamp differs. This matches the tool's advice "Undo changes newest first".
- An app edit after a connector write clears `aiChangedAt` and moves `updatedAt`, so the connector change's undo is stale. That is FR57's "unless something it touched has changed since".
- A batch add that only linked existing items to a day: undo removes exactly those links and restores those items' stamps and markers. It never deletes an item that existed before.
- A delete's undo recreates the item with its **old id**, so later receipts that name it still match.

### Response and description conventions

- English tool texts. Errors through `toolError`. Results through `toolResult` (the same JSON as `structuredContent` and as text).
- Dates are ISO 8601 with milliseconds. Ids are bounded by `idSchema`.

### Testing

- New `test/mcpPackingTools.test.ts`, end to end through `POST /api/mcp` with a real token, as `test/mcpDayWriteTools.test.ts` does:
  - Fixtures from `test/helpers/connectorWriteFixtures.ts` (`setupConnectorTrip`, `structured`, `errorText`, `storedReceipt`) and `test/helpers/mcpClient.ts` (`callTool`).
  - Clean `prisma.aiChange` and `prisma.trip` in `beforeEach`, and reset the `mcp-tool:` rate-limit keys.
  - Cover the owner and a contributor; a viewer gets `Trip not found` on all four tools.
- `test/packingListRepo.test.ts`: the connector functions and `undoPackingChangeForTrip`, including the explicit-`updatedAt` restore, name collisions on undo, a link to a deleted day skipped, and a cross-trip item id → `invalid`. Add an app write after a connector write to prove the badge clears.
- `test/aiChangeRepo.test.ts`: storing and parsing a packing receipt, `requireReceipt` with an unstorable one, dispatch in `undoAiChange` including the concurrent-undo → `already_undone` case, and the `actions` filter.
- `test/aiChangesRoute.test.ts`: `?scope=packing` (includes day-scoped adds, excludes activity changes, 400 with `tripDayId`), and a packing undo through the app route (200, then 409 `undo_stale` after an app edit).
- `test/mcpReadTools.test.ts`: `get_trip.packing` and `get_day.packingItems`.
- `test/tripPackingList.test.tsx`: the notice for a writer (not a viewer), in both languages; undo reloads the list.
- `test/tripDayViewPacking.test.tsx`: undo from the day notice refreshes "Take along".
- `test/mcpRoute.test.ts` or the server test may pin the tool list: add the four names.
- Baseline before you start (16.3): 268 files / 4304 tests green. Re-measure rather than assume.

### Previous story intelligence

- 16.2 review: answers that arrive after day navigation must be dropped (`activeDay` ref). Keep this in the new `refreshKey` path of `TripDayPackingSection`.
- 16.2: a no-op link or unlink writes nothing. The connector must follow suit (a no-op means no hook and `aiChangeId: null`).
- 15.9: `dayWrite.ts` reads the subject from the in-transaction snapshot, never from a read before the transaction. Do the same for `packingDeleted` and `packingUpdated`.
- 15.4/15.5: compare stamps with `getTime()` (SQLite milliseconds). Never compare `Date` objects by identity.

### Project Structure Notes

- New files:
  - `src/lib/trips/packingChangeReceipt.ts`
  - `src/lib/validation/packingChangeReceiptSchemas.ts`
  - `src/lib/mcp/tools/packingTools.ts`
  - `test/mcpPackingTools.test.ts`
- No new dependency and no migration. Tools call repositories only (Epic 15 rule, `server.ts:13`).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 16.4] and the Epic 16 shared rules (lines 5073-5085)
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-11-08-packing-list.md:48,56,297,304]
- [Source: _bmad-output/planning-artifacts/prd.md FR53, FR54, FR57]
- [Source: travelplan/src/lib/repositories/aiChangeRepo.ts, packingListRepo.ts, connectorDayRepo.ts]
- [Source: travelplan/src/lib/mcp/tools/activityWrite.ts:274-320, dayWrite.ts, aiChanges.ts, tripRead.ts]
- [Source: travelplan/src/lib/validation/dayChangeReceiptSchemas.ts:455-494, packingListSchemas.ts]
- [Source: travelplan/src/components/features/trips/AiChangesNotice.tsx, TripPackingList.tsx, TripDayPackingSection.tsx, TripDayView.tsx:1187,4122,5058]

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (claude-opus-5-5), via bmad-dev-story

### Debug Log References

- Baseline before the story: one test failed while source files were being edited during the run. Re-measured after the story: 269 files / 4338 tests green.
- Prisma's `@updatedAt` keeps an explicitly given `updatedAt` on `update` and `create`. The repo tests show it (`restored.updatedAt === read.updatedAt`), so the undo needs no follow-up `$executeRaw`.

### Completion Notes List

- **Receipt (Task 1):** `packingChangeReceipt.ts` has `created`, `updated` and `deleted` entries, each with the stamp the write left, plus wire converters and `isPackingChangeReceipt`. `packingChangeReceiptSchemas.ts` validates the stored form: `.strict()`, bounded ids, ISO regex, 1–50 entries, `dayIds` ≤ 1000, no text caps. D1 as flagged: the receipt is its own type, not a fourth day-receipt kind.
- **aiChangeRepo (Task 2):** `insertAiChangeInTransaction` takes either receipt kind. It validates a packing receipt with its own schema; with `requireReceipt`, a receipt that fails the schema throws `UnstorableReceiptError`. `parseStoredReceipt` returns `{type: "day" | "packing"}`. The sweep and the kept-picture check use the day-only `parseStoredDayReceipt`, so the day path is unchanged. `undoAiChange` sends a packing receipt to `undoPackingChangeForTrip`, with the same `markUndone` transaction hook and the same concurrent → `already_undone` re-read. `stale` now carries `scope: "day" | "packing"`. Added `PACKING_AI_CHANGE_ACTIONS` and the `actions` filter.
- **packingListRepo (Task 3):** added `addPackingItemsForConnector`, `updatePackingItemForConnector`, `deletePackingItemForConnector` and `undoPackingChangeForTrip`. A no-op writes nothing and skips the hook. An existing item that is only linked to the day gets an `updated` entry with its prior state and is marked. An undo is stale when the item's stamp moved, the item is gone, or a restore would take another item's name. An item id from another trip is `invalid`. Undo restores links only to days that still exist. Existing exports are unchanged.
- **Tools (Task 4):** `packingTools.ts` registers `get_packing_list`, `add_packing_items`, `update_packing_item` and `delete_packing_item`. Writes go through `startWrite`; names and categories go through the app's `nameField` / `categoryField`, now exported. A batch refusal names the item's index (`items[1]: Name is required.`). The packing twin of `recordChange` reads the subject inside the transaction and resets the change id on every run. D2 as flagged: the field is `aiChangedAt`.
- **Reads (Task 5):** `get_trip.packing` comes from the existing `TripWithDays.packing` (no extra query). `get_day.packingItems` is read inside `getPlannerDayForUser`'s transaction, so every write tool that returns `day` includes it. Both descriptions are updated.
- **Change log (Task 6):** three `SUMMARIES` entries, an updated `list_ai_changes` description, `AI_CHANGE_PACKING_STALE`, and an `undo_ai_change` description that covers the packing list.
- **App (Task 7):** `GET ai-changes?scope=packing`; `scope` together with `tripDayId`, or any other scope value, is a 400. `AiChangesNotice` has a `scope` prop, its guards key on a view key (`packing` or `day:<id>`), and a stale packing row shows `packingStale`. The packing page shows the notice to writers above the add form and filters; an undo bumps `reloadKey`, and the page's `loadCount` is the notice's `refreshKey`. The 16.6 reveals and prefill are untouched (guarded by `restoredForTrip`). `TripDayPackingSection` has a `refreshKey`, which the day view bumps in `reloadDayAfterAiUndo`. i18n is done in DE and EN.
- **Tests (Task 8):** new `test/mcpPackingTools.test.ts` (10 end-to-end tests). Extended `packingListRepo` (+12), `aiChangeRepo` (+5), `aiChangesRoute` (+3), `tripPackingList` (+3) and `tripDayViewPacking` (+1). Adjusted the pinned tool list (`mcpRoute`), the `get_trip` shape (`mcpReadTools`), the `PlannerDay` fixture (`mcpPlannerShapes`), and the day undo's `stale` result (`aiChangeRepo`). `tripDayViewAiChanges.test.tsx` passes with no edits.
- **Gates:** full suite 269 files / 4338 tests green. Typecheck, lint (0 errors, no warnings in touched files) and `next build` pass.
- AC 11 (production check with Claude) is Tommy's manual step.

### File List

- travelplan/src/lib/trips/packingChangeReceipt.ts (new)
- travelplan/src/lib/validation/packingChangeReceiptSchemas.ts (new)
- travelplan/src/lib/mcp/tools/packingTools.ts (new)
- travelplan/src/lib/mcp/packingShapes.ts (new)
- travelplan/src/lib/repositories/packingListRepo.ts
- travelplan/src/lib/repositories/aiChangeRepo.ts
- travelplan/src/lib/repositories/connectorReadRepo.ts
- travelplan/src/lib/validation/packingListSchemas.ts
- travelplan/src/lib/mcp/server.ts
- travelplan/src/lib/mcp/plannerShapes.ts
- travelplan/src/lib/mcp/tools/aiChanges.ts
- travelplan/src/lib/mcp/tools/tripRead.ts
- travelplan/src/app/api/trips/[id]/ai-changes/route.ts
- travelplan/src/app/api/trips/[id]/ai-changes/[changeId]/undo/route.ts
- travelplan/src/components/features/trips/AiChangesNotice.tsx
- travelplan/src/components/features/trips/TripPackingList.tsx
- travelplan/src/components/features/trips/TripDayPackingSection.tsx
- travelplan/src/components/features/trips/TripDayView.tsx
- travelplan/src/i18n/de.ts
- travelplan/src/i18n/en.ts
- travelplan/test/mcpPackingTools.test.ts (new)
- travelplan/test/packingListRepo.test.ts
- travelplan/test/aiChangeRepo.test.ts
- travelplan/test/aiChangesRoute.test.ts
- travelplan/test/mcpReadTools.test.ts
- travelplan/test/mcpRoute.test.ts
- travelplan/test/mcpPlannerShapes.test.ts
- travelplan/test/tripPackingList.test.tsx
- travelplan/test/tripDayViewPacking.test.tsx

## Change Log

- 2026-11-08: Implemented Story 16.4. Added four connector packing tools, the packing receipt and its undo (tool and app), packing fields in `get_trip`/`get_day`, and the packing-scoped AI-changes notice. Status → review.
- 2026-11-08: Code review (bmad-code-review): 5 patches applied (packing page clears a load error on a successful reload; its AI-changes notice re-reads after the person's own writes; only a rename maps a unique violation to `duplicate_name`; `AiChangesNotice` props are a scope/day discriminated union; tests for undo of update/delete/chain via the app route, undo of a link-only day add via the tool, name-key order, and the notice refresh), 1 deferred (DW-443), 23 dismissed. Full suite 269 files / 4342 tests green, typecheck and lint clean. Status → done.
