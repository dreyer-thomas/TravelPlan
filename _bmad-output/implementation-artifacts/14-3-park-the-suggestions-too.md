# Story 14.3: Park the Suggestions Too

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As someone who got more good suggestions than fit into today,
I want to park the extra ones instead of losing them,
so that I don't have to search for them again for another day.

**FRs covered:** FR49. **Depends on:** Stories 13.4 (done) and 14.1 (done). 14.2 (done) gave the bucket list its *Parken* and the `parked/` media folder this story writes to. 14.4 (ready-for-dev) touches the activity dialog and the move route only; no overlap with this story.

Sources: [epics.md#Story 14.3](../planning-artifacts/epics.md) (l.4239); [sprint-change-proposal-2026-10-17-bucket-parking.md](../planning-artifacts/sprint-change-proposal-2026-10-17-bucket-parking.md) §2 *Suggestions (14.3)* and *UX impact → Suggestions preview*, §6 (Winston); [architecture.md](../planning-artifacts/architecture.md) l.150-151 (readers, media) and l.170 (*Parking and scheduling*: "parked suggestions are listed in the `suggestionsApplied` receipt with the scheduled ones, and their media cleanup follows the URL-derived rule"); DESIGN.md `park-choice` (l.314) and `schedule-mode` (l.306) in `ux-designs/ux-TravelPlan-2026-07-27/`; [13-4](13-4-suggestions-and-backups-speak-in-durations.md) §14 *Leave room for 14.3*; [14-1](14-1-one-kind-of-entry.md); [14-2](14-2-park-it-for-another-day.md).

All code paths below are relative to `travelplan/`. Line numbers were read on 2026-10-18 on the working tree **after 13.4** (13.4 is done but its changes were not yet committed when this file was written; commit them first, see Task 0). Re-read them; they drift. Abbreviations:

| Short | Path |
|---|---|
| `SAS` | `src/lib/validation/daySuggestionApplySchemas.ts` |
| `SAR` | `src/lib/repositories/daySuggestionApplyRepo.ts` |
| `APL` | `src/app/api/trips/[id]/days/[dayId]/suggestions/apply/route.ts` |
| `PRV` | `src/app/api/trips/[id]/days/[dayId]/suggestions/preview/route.ts` |
| `SD` | `src/components/features/trips/TripDaySuggestionsDialog.tsx` |
| `DCR` | `src/lib/repositories/dayPlanChangeRepo.ts` (undo) |
| `RCP` | `src/lib/trips/dayChangeReceipt.ts` |
| `RCS` | `src/lib/validation/dayChangeReceiptSchemas.ts` |
| `TDV` | `src/components/features/trips/TripDayView.tsx` |
| `UND` | `src/app/api/trips/[id]/day-plan-changes/undo/route.ts` |

**Search caveat:** plain `grep` treats some repositories (`tripRepo.ts`) as binary. Use `grep -a` or `rg`.

## Read this first: decisions this file takes

Each item was checked against the code. Items marked **(Q)** are defaults for Tommy to confirm; they are repeated under *Questions*.

### Part A: the request and the apply (server)

1. **A separate `parked` array, not a `target` per suggestion.** The proposal says "a per-suggestion `target: "day" | "parked"`". In the code, `suggestions` and `legs` are index-aligned in visiting order (`SAS:73-95`: "One leg per suggestion") and the basis fingerprint covers exactly the scheduled ones. A `target` field inside that array would force every reader to filter and re-index, and a parked entry would need a dummy leg. So the apply request becomes:
   ```ts
   { mode, suggestions /* scheduled, visiting order, 0..8 */, legs /* one per scheduled */, basis /* null iff suggestions is empty */, parked /* 0..8, the dialog's list order */ }
   ```
   Rules in `superRefine`: `suggestions.length + parked.length` is 1..`MAX_SUGGESTIONS` (8); `legs.length === suggestions.length` (unchanged); `basis` is required when `suggestions.length > 0` and must be `null` when it is 0. The intent of the proposal (per-suggestion choice, parked ones are not in the order, the chain or the fingerprint) is unchanged. `parked` uses `applySuggestionSchema` as is (same bounds, same Wikimedia guards on pictures). `parked` is **optional with default `[]`** so a 13.4 client body still parses.
2. **The preview request does not change.** The dialog sends only the scheduled ones to `/suggestions/preview` (it needs `min(1)`, `SAS:45-48`, kept). `PRV` needs no change at all. Parked suggestions are never routed through OSRM.
3. **All parked: the day is not touched** (AC3). `applySuggestionsForTripDay` (`SAR:290`) takes `parked: ApplySuggestion[]` and `parkedImages: DownloadedSuggestionImage[][]`. When `suggestions` is empty it skips `readScheduleInputInTransaction`, the plan, the basis check, `readDrawnSegmentKeysInTransaction`, `applyScheduleChangesInTransaction`, the sweep, the timeline and the legs. It still runs `readPlanContext(tx, …)` first: that is the writer clause on the day (`SAR:76-77`, `SAR:93`), so a viewer or a foreign day still answers `null` → 404. No `DayPlanChangedError` can come out of an all-parked apply.
4. **Mixed: plan and check before the first write.** Order inside the one transaction: context → (if scheduled) state, plan, basis check → creates of the scheduled rows and their pictures (as today, `SAR:310-352`) → creates of the parked rows and their pictures → (if scheduled) `applyScheduleChangesInTransaction`, sweep, timeline, legs (as today, `SAR:354-386`) → receipt. A 409 still writes nothing, files included (the existing rollback, `SAR:401-407`).
5. **A parked suggestion's row** (AC2), created with `tx.dayPlanItem.create`:
   `tripId`, `tripDayId: null`, `scheduleMode: "FLEXIBLE"`, `fromTime: null`, `toTime: null`, `sortOrder: 0`, `durationMinutes: suggestionDurationMinutes(s.durationMinutes)` (`src/lib/trips/suggestionPlan.ts:96`, rounds up to 5, clamps to the activity range), `title`, `contentJson: plainTextToTiptapDoc(s.description)`, `locationLat/Lng`, `locationLabel`, `createdAt: new Date(base + suggestions.length + index)` (continues the scheduled ones' millisecond stagger). The values `FLEXIBLE / null / null / 0` are what `day_plan_items_parked_check` demands (`prisma/migrations/20261018120000_day_plan_items_without_day/migration.sql:38`) and what `createParkedDayPlanItem` writes (`src/lib/repositories/bucketListRepo.ts:207-213`). Do **not** call `createParkedDayPlanItem`: it opens its own transaction and its own writer check, and this must be one transaction with the scheduled rows.
6. **Parked pictures go to `parked/`.** `planDayPlanItemGalleryPhoto` already takes `tripDayId: string | null` and places a `null` under `uploads/trips/<tripId>/parked/day-plan-items/<itemId>/` (`src/lib/trips/importPhotos.ts:190-206`, added by 14.1). Call it with `tripDayId: null`; collect `writtenFiles` and `createdDirs` the same way, so a rollback removes them. Image rows: `dayPlanItemImage.create` with `sortOrder: position + 1`, ids into the receipt's `imageIds` as today.
7. **Downloads.** `APL:84-88` calls `downloadSuggestionImages(suggestions.map(images))` once. Call it once with `[...suggestions, ...parked].map(images)` and split the result at `suggestions.length`. One call keeps the one download budget (`IMAGE_DOWNLOAD_BUDGET_MS`) for the whole apply; the worst case (8 × 3 pictures) is what it was.
8. **No legs, no order, no fingerprint for parked ones.** Nothing in `planSuggestionAppend`, `planBasis`, `planFirstLegFrom` or the leg loop sees a parked suggestion. 13.4 kept `planSuggestionAppend` taking only the day's suggestions for exactly this (13.4 §14). Do not change those functions.

### Part B: the receipt and the undo

9. **A new optional `parkedItems` in `suggestionsApplied`** (architecture l.170: listed "with the scheduled ones" in the same receipt). The shape becomes:
   ```ts
   { kind: "suggestionsApplied"; items: {itemId, updatedAt}[]; segments: …; imageIds: string[]; parkedItems?: {itemId, updatedAt}[] }
   ```
   Why a separate list and not a flag on `items`: the notice (`RCP:445`, `summarizeSuggestionsApplied`) is computed on the client from the receipt alone and must say how many were parked; and the undo must delete a parked row by `{ id, tripId, tripDayId: null }`, a day row by `{ id, tripDayId }`. Receipts stay **version 3** (additive kind field, as 12.4 / 13.4; architecture l.170). Old receipts without `parkedItems` stay valid.
   - `RCS:257-270`: `items` becomes `.min(0)`; add `parkedItems: z.array(itemSchema).max(MAX_APPLIED_SUGGESTIONS).optional()`; refine on the object: `items.length + (parkedItems?.length ?? 0)` is 1..`MAX_APPLIED_SUGGESTIONS`. Keep `.strict()`.
   - `RCP:205-210` type: add `parkedItems?: { itemId: string; updatedAt: T }[]`. `RCP:337-343` (`mapReceipt` / wire conversion): convert `parkedItems` like `items`, and omit the key when absent (do not emit `parkedItems: undefined`; a signed receipt is compared as JSON).
   - `SAR` receipt (`SAR:373-389`): `parkedItems` only when `parked.length > 0`, so an apply without parking writes the 13.4 receipt byte for byte.
   - The receipt's `tripDayId` is the dialog's day even when everything was parked. It is never null (architecture l.170: "the receipt's `tripDayId` is the day that was recomputed, so it is never null"; here: the day the apply was made from, which the undo route needs for its writer check, `DCR:632-636`).
10. **Invalidity (`DCR:206-213`).** Add: every id once across `items` **and** `parkedItems` ("duplicate item"); no parked id in `movedItems` ("applied item listed as moved", the existing message). An all-parked receipt must have empty `movedItems` and `removedTravelSegments` and no `segments` ("side effect an all-parked apply never has"), because it never touched the day.
11. **Phase 1 (`checkSuggestionsAppliedInTransaction`, `DCR:244-287`).** Pass `tripId` in. Check the parked rows with `tx.dayPlanItem.findMany({ where: { id: { in: parkedIds }, ...parkedDayPlanItemsWhere(tripId) } })` (`src/lib/repositories/dayPlanItemRepo.ts:430`) and the same stamp rule ("applied item changed"). A parked suggestion that was scheduled with "+" since, edited in the bucket dialog, or deleted is stale. The images / documents / referencing-legs checks run over **all** ids (`[...itemIds, ...parkedIds]`), so a picture added to a parked one later refuses the undo, as for a scheduled one. The returned `UndoneImageFile[]` covers both, so the route removes the parked files too.
12. **Phase 2 (`DCR:548-565`).** After the scheduled items, delete each parked one with `tx.dayPlanItem.deleteMany({ where: { id, ...parkedDayPlanItemsWhere(tripId), updatedAt } })`; `count !== 1` → `UndoStaleError("applied item changed")`. The cascade takes its image rows (and payments, which it cannot have). Do **not** use `deleteDayPlanItemInTransaction`: it is scoped by `tripDayId` (`dayPlanItemRepo.ts:582-614`) and would answer `missing`.
13. **Files after the commit.** `UND:100-128` already derives each file's folder from its own URL with `resolveManagedItemMediaDir`, which accepts `parked/day-plan-items/<itemId>` since 14.1. No route change; a test must pin that a parked suggestion's file and its folder are gone after the undo.
14. **Phase 3 is harmless for all-parked.** The post-condition reads the day's timeline (`DCR:592-620`); with no segments, no moved rows and no removed legs it checks nothing. Leave it.

### Part C: the dialog (`SD`)

15. **Where the toggle lives: on the ticked card in the choose step.** DESIGN.md `park-choice`: "A two-segment toggle on a ticked suggestion card … Shown only while the card is ticked." The epic says "the suggestions preview with ticked suggestions"; in the dialog that is the list of cards (the second step is the timeline, where nothing is ticked). The preview timeline then shows only the scheduled ones (AC1).
16. **The card is a `<label>` today** (`SD:619-636`, "the whole card is the click target, so the card *is* the label"). A `ToggleButtonGroup` inside it would be a nested interactive element, and a click on *Parken* would also toggle the checkbox (see the same reasoning at `SD:721-725`). Restructure: an outer `Box` carries the border and `data-testid="suggestion-card"`; inside it the existing `label` (checkbox + text + thumbnails) unchanged; below the label, still inside the border, the toggle row, rendered only when `checked`. Keep the whole label area clickable. Test: clicking *Parken* leaves the card ticked.
17. **Toggle look** (`park-choice` → `schedule-mode` → the mode toggle's `auth-tabs` code at `SD:511-548`): `ToggleButtonGroup exclusive`, two segments *Einplanen* / *Parken*, compact (`minHeight: 36`, not 44: "compact height inside the card"; the hit area stays ≥36 px because the card itself is a large target and the toggle is secondary, **(Q)**), selected segment `backgroundColor: tokens.accentSoft`, `color: tokens.ink`, `fontWeight: 700`. The token exists (`src/theme.ts:73`, `palette.tokens.accentSoft`). `aria-label` from `trips.suggestions.parkChoiceLabel` plus the title, so a screen reader hears which card it belongs to. Pressing the active option reports `null`: ignore it (as `SD:515-518`). Disabled while `searching || planBusy`.
18. **State.** `const [parkedChoice, setParkedChoice] = useState<Set<number>>(() => new Set())` (indices into `suggestions`, like `ticked`, `SD:124`). Default is *Einplanen* (= not in the set). Unticking a card removes its index (so re-ticking defaults to *Einplanen* again, AC1). A new search clears it with the ticks (`SD:189`). *Zurück zur Auswahl* keeps it.
19. **The buttons** (AC1: "the apply button names both counts"). Let `s` = ticked and not parked, `p` = ticked and parked.
    - Choose step, `p === 0`: unchanged, *Übernehmen (n)* opens the preview (13.4 tests stay green).
    - Choose step, `s > 0 && p > 0`: *Übernehmen (n)* opens the preview of the `s` scheduled ones. The preview step's primary reads **"3 einplanen · 2 parken"** instead of *Hinzufügen*.
    - Choose step, `s === 0 && p > 0`: the button reads **"2 parken"** (`"1 parken"` for one) and applies directly, with no preview step: there is nothing to plan or show (`suggestions: [], legs: [], basis: null, parked`). Same busy spinner, same non-dismissable dialog while it runs (`disableDismiss={applying}`, `SD:446`).
    - Preview step with `p === 0`: *Hinzufügen* as today.
    - **(Q)** whether the choose-step button should also show the split ("Übernehmen: 3 einplanen · 2 parken"). Default: no, it opens a preview, and the preview's primary is the button that writes.
20. **The preview step lists the parked ones.** Below the timeline, when `p > 0`: a `labelCaps` heading *Kommt in die Bucket-Liste* and one compact row per parked suggestion (title, place · `formatApproxDuration`), no times, no legs, `data-testid="suggestions-preview-parked"`. The user sees everything the button will write. The preview's `picked` state keeps the scheduled ones only (what the server planned); keep the parked ones next to it in `PreviewState` (`parked: DaySuggestion[]`), snapshotted when the preview opens, so a 409 re-preview (`SD:389-391`) sends the same split.
21. **The apply body.** `suggestions: preview.order.map(i => preview.picked[i])` (unchanged), `legs`, `basis`, plus `parked` in the dialog's list order. The client sends the `DaySuggestion` objects as today (`images` included; the server's `imagesSchema` filters).
22. **After the apply.** `onApplied(receipt)` as today. `TDV:5172-5180` must also call `loadBucketListItems()` when the receipt has `parkedItems` (cheaper rule: always call it after an apply; the bucket list is the trip's). The undo handler (`TDV:1524-1528`) reloads the bucket list for `scheduled` / `parked`; add `suggestionsApplied` with `parkedItems?.length`. Without both, the parked ones appear only on the next page load (14.2's review found exactly this class of miss).
23. **The notice** (`RCP:409-422`, `summarizeSuggestionsApplied`): when `parkedItems` is non-empty, append a part "2 geparkt" / "1 geparkt" (`trips.dayChange.suggestionsParked` / `…ParkedOne`). When `items` is empty, the "added" part is left out, so an all-parked apply reads only "2 geparkt". `receiptHasSideEffects` already returns `true` for every `suggestionsApplied` (`RCP:392`), so the notice and its *Rückgängig* show.
24. **The discard guard** (`SD:147`) keys on `ticked.size > 0`; unchanged.

### Part D: what must be preserved

- An apply without parked suggestions writes exactly what 13.4 wrote, with the same receipt (no `parkedItems` key). Every existing test in `daySuggestionApplyRoute.test.ts`, `suggestionsApplyUndo.test.ts`, `suggestionPlan.test.ts`, `tripDaySuggestionsDialog.test.tsx` and `tripDayViewSuggestionsEntry.test.tsx` stays green unmodified, except where a test asserts the request schema shape.
- The preview (`PRV`) is unchanged. OSRM is called once per preview, never by apply.
- The parked invariant (CHECK) and the readers: no trip-level reader may see the parked suggestions (`test/parkedItemsExcludedFromTripReaders.test.ts` keeps passing; no new reader is added).
- Viewers: no apply button (`TDV:5172` passes `onApplied` only to writers) and `refuseUnlessTripWriter` on the route; unchanged.
- A 13.4 receipt (signed before this deploy) still undoes.

## Acceptance Criteria

1. **Given** the suggestions dialog with ticked suggestions and a writer, **then** each ticked card shows a `park-choice` toggle *Einplanen* / *Parken*, defaulting to *Einplanen*, and an unticked card shows none; clicking the toggle never unticks the card; the preview's timeline, order and legs include only the ones set to *Einplanen*; and the button that writes names both counts ("3 einplanen · 2 parken"), or "2 parken" alone when every ticked one is parked (then it applies without a preview step).
2. **Given** an apply with parked suggestions, **then** the scheduled ones are applied exactly as in 13.4 (times, order, legs, `movedItems`, basis check); each parked one becomes a `DayPlanItem` with `tripDayId = null`, `FLEXIBLE`, no times, `sortOrder` 0, `durationMinutes = suggestionDurationMinutes(suggested)`, its title, description (as TipTap doc), place label and coordinates; its pictures are downloaded and stored under `uploads/trips/<tripId>/parked/day-plan-items/<itemId>/` with image rows; and it has no legs.
3. **Given** an apply in which every suggestion is parked, **then** no row, leg or time of the day changes (whole-DB comparison of the day's rows and legs before and after), no `409 day_plan_changed` can be answered (even if the day changed since the dialog opened), the request carries no basis, and the suggestions appear in the Day Detail bucket list without a page reload.
4. **Given** *Rückgängig* after an apply, **then** the scheduled activities with their legs and pictures and the parked activities with their pictures are removed in one request, the files and their now-empty folders are deleted, swept legs and moved rows are restored, the database equals its state before the apply (whole-DB `toEqual`), and the bucket list reloads; a parked suggestion edited, scheduled or given a picture or document since makes the undo `409 undo_stale` and writes nothing.
5. **Given** a forged or malformed `suggestionsApplied` receipt (an id in both `items` and `parkedItems`, a parked id in `movedItems`, no item at all, more than 8 together, an unknown field, an all-parked receipt with segments or moved rows), **then** the undo answers `400` and writes nothing; a 13.4 receipt without `parkedItems` still undoes.
6. **Given** an invalid apply request (more than 8 suggestions together, none at all, a basis missing while something is scheduled, a basis present while nothing is), **then** the route answers `400 validation_error` and writes nothing; a 13.4-shaped body without `parked` is accepted.
7. **Given** the notice after an apply with parked suggestions, **then** it reads e.g. "3 Aktivitäten und 2 Wege hinzugefügt · 2 geparkt", or "2 geparkt" when all were parked.
8. **Given** both dictionaries, **then** `en.ts` and `de.ts` carry every new string.

## Tasks / Subtasks

- [ ] **Task 0: Baseline** (all ACs)
  - [ ] 13.4's changes are in the working tree but not committed (`git status`). Ask Tommy to commit them (or commit on his word) before starting, so this story's diff is reviewable on its own. Record the baseline commit in this file's front matter, as 13.4 did.
  - [ ] Run `npx vitest run test/daySuggestionApplyRoute.test.ts test/suggestionsApplyUndo.test.ts test/tripDaySuggestionsDialog.test.tsx` green before any change.
- [ ] **Task 1: Request schema** (AC 6; §1)
  - [ ] `SAS`: `suggestions` in the apply request `.min(0)`; `parked: z.array(applySuggestionSchema).max(MAX_SUGGESTIONS).default([])`; `basis: suggestionPlanBasisSchema.nullable()`; `superRefine` adds the total 1..8 rule and the basis-iff-scheduled rule. Keep the leg rules. Update the docblock (`SAS:68-72`).
  - [ ] No test imports `suggestionApplyRequestSchema` directly today; cover every AC 6 case through the route in `test/daySuggestionApplyRoute.test.ts` (400 and nothing written), plus pure schema cases in `test/daySuggestionSchemas.test.ts`.
- [ ] **Task 2: Apply** (AC 2, 3; §3-8)
  - [ ] `SAR` `ApplySuggestionsParams`: `basis: SuggestionPlanBasis | null`, `parked: ApplySuggestion[]`, `parkedImages: DownloadedSuggestionImage[][]`.
  - [ ] Restructure `applySuggestionsForTripDay` per §4: the scheduled branch only when `suggestions.length > 0`; the parked creates per §5-6; receipt per §9. Keep the file rollback covering both.
  - [ ] Update the `SAR` header docblock: one paragraph "Story 14.3" (parked ones: no day, no plan, no basis, no legs; all-parked writes nothing on the day).
  - [ ] `APL`: one download call over both lists, split (§7); pass `parked` and `parkedImages`. Docblock line for 14.3.
- [ ] **Task 3: Receipt and undo** (AC 4, 5; §9-14)
  - [ ] `RCS`, `RCP` type and wire conversion (`parkedItems` optional, omitted when absent).
  - [ ] `DCR`: invalidity (§10), phase 1 (§11), phase 2 (§12). Add a "Story 14.3" sentence to the `DCR` header block next to 12.4's (`DCR:51-58`).
  - [ ] `summarizeSuggestionsApplied` (`RCP:409`) per §23, with the two new keys.
- [ ] **Task 4: Dialog** (AC 1; §15-21)
  - [ ] Card restructure (§16), toggle (§17), state (§18), buttons (§19), parked list in the preview step (§20), body (§21).
  - [ ] Update the `SD` header docblock: a bullet "Story 14.3: park instead of schedule".
- [ ] **Task 5: Day view** (AC 3, 4; §22)
  - [ ] `TDV:5172-5180`: reload the bucket list after an apply. `TDV:1524-1528`: reload it after the undo of a `suggestionsApplied` with parked items. Update the comment there.
- [ ] **Task 6: i18n** (AC 7, 8): add every key in *Copy* to both files, next to their siblings.
- [ ] **Task 7: Tests**
  - [ ] `test/daySuggestionApplyRoute.test.ts` (use `test/helpers/suggestionApplyFixtures.ts`): mixed apply (scheduled ones identical to a 13.4 apply of the same scheduled set, parked rows' columns per AC 2, parked picture file exists under `parked/`, no leg names a parked id, receipt lists `parkedItems`); all-parked apply on a day changed since the dialog opened (no 409, day rows and legs `toEqual` before/after, `movedItems` and `segments` empty); all-parked apply by a viewer → 403/404 as today; 13.4-shaped body still works; AC 6 cases.
  - [ ] `test/suggestionsApplyUndo.test.ts`: mixed undo with whole-DB `toEqual` and files plus folders gone (scheduled `days/…` and parked `parked/…`); stale cases for a parked one edited (`updateParkedDayPlanItem`), scheduled with "+" (`POST day-plan-items/schedule`), given a picture, deleted; AC 5 forged cases; an old receipt without `parkedItems`.
  - [ ] Receipt schema / summary tests (`rg "summarizeDayChangeReceipt" test`): the two AC 7 strings, both languages' keys exist.
  - [ ] `test/tripDaySuggestionsDialog.test.tsx`: toggle only on ticked cards; click on *Parken* keeps the tick; untick + re-tick resets to *Einplanen*; new search clears; preview body has only scheduled ones and the parked list; the request bodies (`preview` without parked, `apply` with `parked`); the button labels in all four cases of §19; all-parked applies without a preview request; 409 re-preview keeps the split.
  - [ ] `test/tripDayViewSuggestionsEntry.test.tsx`: after `onApplied` the bucket-list endpoint is fetched again; after the undo of a receipt with `parkedItems` too.
  - [ ] Mutation checks (record each red/green in *Debug Log*): (1) drop `tripDayId: null` from the parked create → CHECK or test red; (2) let the all-parked path run the basis check → AC 3 test red; (3) phase 2 skips the parked deletes → undo test red; (4) phase 1 skips the parked stamp check → stale test red; (5) dialog renders the toggle inside the `label` → keep-the-tick test red; (6) day view does not reload the bucket list → entry test red. If one stays green because a second guard catches it (13.3 mutation 3), say which and why.
- [ ] **Task 8: Gates and real run**
  - [ ] `npx vitest run`, `npx tsc --noEmit`, `npm run lint` (0 errors), `npm run build`.
  - [ ] Real run with Tommy (dev server, Safari, 390 px): search, tick five, park two, preview shows three plus "Kommt in die Bucket-Liste", apply, notice "… · 2 geparkt", the two appear in the Day Detail bucket list with thumbnails and durations, "+" one of them onto another day with its pictures; then *Rückgängig* on a fresh apply removes all; an all-parked apply leaves the day as it was. Status stays `in-progress` until Tommy confirms; then `review`.

## Dev Notes

### Copy (de / en)

| Key | de | en |
|---|---|---|
| `trips.suggestions.parkChoiceLabel` | Einplanen oder parken: {title} | Schedule or park: {title} |
| `trips.suggestions.choiceSchedule` | Einplanen | Schedule |
| `trips.suggestions.choicePark` | Parken | Park |
| `trips.suggestions.applySplit` | {scheduled} einplanen · {parked} parken | Schedule {scheduled} · park {parked} |
| `trips.suggestions.applyParkedOnly` | {count} parken | Park {count} |
| `trips.suggestions.previewParkedTitle` | Kommt in die Bucket-Liste | Goes to the bucket list |
| `trips.dayChange.suggestionsParked` | {count} geparkt | {count} parked |
| `trips.dayChange.suggestionsParkedOne` | 1 geparkt | 1 parked |

`formatMessage` has no plural rules; "1 parken" / "1 einplanen" read correctly in German as imperative-infinitive, so `applySplit` and `applyParkedOnly` need no `One` variants. The notice's part does (convention `activitiesAddedOne`, `de.ts:691`). The bucket list's German name in the UI is *Bucket-Liste* (`de.ts:525`), so the heading uses it. Dictionaries are flat `"a.b.c": "…"` maps; suggestions keys sit at `de.ts:727-745`, `en.ts:792ff`.

### Current state of what this story changes

- **Apply request:** `SAS:73-95` (`suggestions` min 1, `legs` aligned, `basis` required).
- **Apply route:** `APL:79-100`: schema → `downloadSuggestionImages` → `applySuggestionsForTripDay` → signed receipt; `DayPlanChangedError` → `dayChangedResponse()`.
- **Apply repo:** `SAR:290-409`: context, state, `planSuggestionAppend`, basis check, creates with pictures (`planDayPlanItemGalleryPhoto` with the day id), `applyScheduleChangesInTransaction`, sweep, drawn legs, `buildReceipt(tripDayId, { kind: "suggestionsApplied", items, segments, imageIds }, removed, movedItems, { planConflicts })`. Rollback of files in the `catch`.
- **Receipt:** type `RCP:204-210`, wire `RCP:337-343`, side effects `RCP:387-396`, summary `RCP:398-470`; schema `RCS:255-270` (`MAX_APPLIED_SUGGESTIONS = MAX_SUGGESTIONS = 8`, `RCS:40`).
- **Undo:** invalidity `DCR:206-213`; phase 1 `DCR:244-287` (items by `{ id in, tripDayId }`); phase 2 `DCR:548-565` (`deleteDayPlanItemInTransaction`, scoped by day); route file removal `UND:100-128` (URL-derived folders, parked-aware since 14.1).
- **Dialog:** state `SD:112-128`; toggle pattern `SD:511-548`; preview/apply `SD:343-394`; footer `SD:402-433`; card as `label` `SD:611-698`; preview step `SD:760-863`.
- **Day view:** `onApplied` `TDV:5172-5180`; undo bucket reload `TDV:1524-1528`; `loadBucketListItems` `TDV:1133`.

### Architecture compliance

- Receipts version 3; new behaviour is additive (architecture l.170). Undo stays one request, one transaction, files after commit.
- Parked rows: `tripDayId IS NULL` ⇔ parked, always `FLEXIBLE`, no times, `sortOrder` 0, no legs (architecture l.150; the CHECK). Only bucket-list reads query by `tripId`; the undo's parked check uses `parkedDayPlanItemsWhere` (the shared predicate).
- Media: URLs never rewritten; uploads go to the item's current place (`parked/` here); cleanup is URL-derived (architecture l.151).
- The server computes every time; the client never does. One OSRM request per explicit action (preview); apply never calls OSRM.
- Writers only (owner, contributor): `refuseUnlessTripWriter` in the route plus the writer clause in `readPlanContext`.

### Library / framework

No new dependency. Next.js App Router route handlers, Prisma 7.3 interactive transactions (SQLite), zod 4 (`.default`, `.nullable`, `superRefine`, `.strict()`), MUI `ToggleButtonGroup`, Vitest + Testing Library. Nothing depends on a version newer than installed, so no web research was needed.

### Testing standards

- Vitest, per-worker SQLite (`test/setup.ts`), `fileParallelism: false`. Suggestion suites share `test/helpers/suggestionApplyFixtures.ts` and mock OSRM and the picture download per file (`vi.mock`).
- Seeds made with `prisma.dayPlanItem.create` default to FIXED / 15 / `sortOrder` 0; use `settleSeededDay` for real schedule fields.
- "Restores exactly" = whole-DB `toEqual` of `databaseState()` before the apply and after the undo (copy from `dayMakeFlexible.test.ts` / `dayPlanChangeReorder.test.ts`). For AC 3 compare the day's rows and legs before/after the apply.
- Parked fixtures and file assertions: `test/parkedItemMedia.test.ts` and `test/dayPlanItemPark.test.ts` show how 14.1/14.2 assert `parked/` paths and folder removal.
- Refusal tests assert the response code **and** that nothing was written (14.2 review patch 3/4).

### Previous story intelligence

- **13.4:** `planSuggestionAppend` takes only the day's suggestions; the basis fingerprint carries the planned times; `movedItems` allowed on `suggestionsApplied` but never a created id. The route suite was rewritten to schedule-rule times (e.g. 09:42); reuse its fixtures rather than new ones.
- **14.1:** `planDayPlanItemGalleryPhoto(tripDayId: null)`, `resolveManagedItemMediaDir`, `parkedDayPlanItemsWhere`, the parked CHECK, the bucket list reading `firstImageUrl`. Parked deletes remove files (no undo for a bucket delete) - the suggestion undo removes them too, by the route's existing path.
- **14.2:** the `parked` receipt kind and the review findings: a view that misses a reload (the bucket list after a park), refusal tests that do not assert their text, an undo window left open after an edit. All three shapes can recur here (Task 5, Task 7).
- **Recurring in Epics 13/14:** stale line references and "until 14.x" comments, a key in one dictionary only, mutation checks that stay green because a second guard catches the case. Check them before handing over.

### Git intelligence

Recent commits: `624bcb5` / `bae6d99` 13-3, `a65c894` 13-2, `e0643cd` 14-2, `f4957e3` 14-1; 13-4 done but uncommitted at the time of writing. Messages follow `14-3: <summary>; status <status>`.

### Project Structure Notes

- No new route, component or migration. All changes are in the files of the table above plus tests and both dictionaries.
- Tests stay flat in `test/`. A new file is only warranted if the dialog test grows past readability; prefer extending the existing suites.

### Questions (defaults applied; Tommy to confirm)

1. **Request shape** (§1): a separate `parked` list instead of the proposal's per-suggestion `target`. Same behaviour, simpler alignment with legs and basis. Default: separate list.
2. **All parked skips the preview** (§19): with nothing to plan, "2 parken" writes at once. Default: yes. Alternative: show a preview with only the parked list.
3. **Which button carries the counts** (§19): the button that writes (the preview's primary, or "n parken" on the choose step). The choose step's *Übernehmen (n)* keeps its label. Default as described.
4. **Toggle height 36 px** (§17), "compact" per DESIGN.md, below the 44 px used elsewhere. Default: 36 px.
5. **Parked rows' `createdAt`** continue the scheduled ones' millisecond stagger, so the bucket list's tiebreak (title, then `createdAt`) keeps the dialog's order for equal titles. Default: yes.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 14.3]
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-10-17-bucket-parking.md#Suggestions (14.3), #UX impact, §6]
- [Source: _bmad-output/planning-artifacts/architecture.md l.150-151, l.170]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-TravelPlan-2026-07-27/DESIGN.md#park-choice, #schedule-mode]
- [Source: _bmad-output/planning-artifacts/prd.md FR49]
- [Source: _bmad-output/implementation-artifacts/13-4-suggestions-and-backups-speak-in-durations.md §14]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.

### File List
