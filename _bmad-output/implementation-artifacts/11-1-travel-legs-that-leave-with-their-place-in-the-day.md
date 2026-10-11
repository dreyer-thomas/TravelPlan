---
baseline_commit: 7780dfb52ac0e5d0b0a9ca7e4c2e5e9043df7219
---

# Story 11.1: Travel Legs That Leave With Their Place in the Day

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As someone rearranging a day,
I want travel legs that no longer connect two consecutive stops to disappear on their own,
so that I stop deleting them one by one from the orphan list, without losing the ability to take the change back.

**FRs covered:** FR42 (leg removal and undo). **Supersedes** Story 8.5's AC2 (in the epic; AC3 in 8.5's own story file). **Depends on:** nothing.
Sources: [epics.md#Story 11.1](../planning-artifacts/epics.md), [sprint-change-proposal-2026-10-10.md](../planning-artifacts/sprint-change-proposal-2026-10-10.md) §2 *Technical impact* (rule 5, *The change receipt*), DESIGN.md `action-notice`, EXPERIENCE.md *Change with side effects*, architecture.md *API & Communication Patterns* (Day recalculation receipts).

All code paths below are relative to `travelplan/`. Line numbers were read at `7780dfb`.

## Read this first: what the epic's wording assumes that the code does not

Each item below was checked against the working tree. Each one changes what a task asks for.

1. **The response key stays `dayPlanItem`.** architecture.md writes `{ data: { item, receipt } }`, but the AC says "alongside today's payload". POST and PATCH return `ok({ dayPlanItem })` today (`src/app/api/trips/[id]/day-plan-items/route.ts:176`, `:265`) and DELETE returns `ok({ deleted, removedTravelSegmentIds })` (`:331`). **Add a `receipt` key; rename nothing.** Read the architecture line's `item` as "today's item payload".
2. **"The existing delete path, which cleans up its legs and media" removes rows, not files.** `deleteDayPlanItemForTripDay` (`dayPlanItemRepo.ts:614-648`) drops image, document and payment rows through the DB cascade. The DELETE route never calls `removeManagedMediaFile`, so the files stay on disk. That is pre-existing behaviour. **Do not add file unlinking to the item delete in this story:** undoing a delete (below) restores image and document rows that point at those files. Check the ledger for an entry about activity-delete leaving files. If there is none, file a `DW-` entry that also records this coupling: undo depends on the files surviving.
3. **`buildSegmentTimeline` cannot run inside a transaction yet.** It is private, uses the global `prisma` client, and carries its own writer clause (`travelSegmentRepo.ts:191-242`). The sweep must read the timeline through `tx`, so extract a transaction-capable core (Task 2).
4. **A previous state is more than the item's columns.** PATCH replaces `CostPayment` rows with `deleteMany` + `createMany` (`dayPlanItemRepo.ts:587-600`), so restoring the columns alone would lose payments. A **deleted** item also loses its image, document and payment rows through the cascade, and the undo of a delete has to bring them back. The snapshot covers all of these.
5. **The update snapshot is read outside the transaction today.** `updateDayPlanItemForTripDay` calls `prisma.dayPlanItem.findFirst` before `$transaction` (`:556`). Read the receipt's "previous state" *inside* the transaction, or a concurrent write can slip in between the snapshot and the write.
6. **There are two create paths.** POST with `bucketListItemId` goes through `convertBucketListItemToDayPlanItemForTripDay` (`:471-545`), which also deletes the bucket-list row. It needs the same sweep and receipt. Its undo must also bring the idea back (see *Undo semantics*).
7. **No optimistic-concurrency check exists anywhere in the codebase.** Nothing compares `updatedAt`. Use the conditional-write precedent instead: `deleteMany`/`updateMany` scoped by key, then `count !== 1` (`dayPlanItemRepo.ts:629-631`), extended with `updatedAt` in the `where`.
8. **The gantt panel sits between the hero and the stat strip.** DESIGN.md places `action-notice` "directly below the day hero … and above the stat strip". In the code, the coverage/gantt panel (`TripDayView.tsx:3537-3623`) sits between them, and all three are inside one framed card (`:3224-3812`). **Ruling for this story:** render the notice inside the frame, directly after the hero's closing tag (`:3535`) and before the gantt panel. Wrap it in a band that uses the gantt panel's responsive inline padding (`HERO_PADDING_INLINE`). The notice itself is its own `rounded.md` panel with a `border-strong` border inside that band. This keeps "directly below the hero" literally true and puts the notice in view without scrolling.
9. **Terminology.** The existing German copy calls a leg "Reiseabschnitt" (`de.ts:442`, `:621-622`). The epic, the change proposal and DESIGN.md all specify "Fahrt" for this notice ("1 Fahrt entfernt"). The gantt legend already uses "Fahrt" (`de.ts:275`). **Use "Fahrt" / "Fahrten" as ratified.** Leave the existing keys alone.

## Acceptance Criteria

1. **AC1: Non-consecutive legs are swept in the same transaction.**
   - **Trigger:** a create (both create paths), an update, or a delete of a day plan item.
   - **What is deleted:**
     - every `TravelSegment` on that day that was *drawn* before the change (its endpoint pair was consecutive in the day's timeline) and is *not drawn* after it;
     - every leg that references a deleted item, as today.
   - **Stays count.** The timeline includes last night's stay as the leading endpoint and tonight's stay as the trailing one, so legs to or from either are covered.
   - **Pre-existing orphans are not swept.** A leg that was already undrawn before the change (a restored backup, DW-318, or old rows) is left alone unless it references a deleted item. The change did not orphan it, and Story 8.5 AC4's list is how its owner removes it.
   - **Atomicity:** the sweep runs inside the write's own `prisma.$transaction`, reading the day through `tx`. If the sweep throws, the write is rolled back.
2. **AC2: The response carries a change receipt.**
   - **Which responses:** a successful POST, PATCH or DELETE on `/api/trips/{id}/day-plan-items`. Today's keys are unchanged.
   - **What the receipt holds** (shape in Dev Notes):
     - every swept leg as a full row;
     - the edited item's previous state (`updated` or `deleted`, with payments, and for `deleted` also image and document rows), or that it was `created`;
     - for a bucket-list conversion, the consumed bucket-list row;
     - the post-write `updatedAt` of every row the change left in place. A swept or deleted row is recorded with its own last `updatedAt` inside its snapshot.
   - **Always present:** the receipt is returned even when nothing was swept.
   - **DELETE's id list:** `removedTravelSegmentIds` now lists **every** removed leg, swept or referencing, so the client's existing local filter (`TripDayView.tsx:1365-1369`) stays correct.
3. **AC3: A receipt with side effects shows the notice.**
   - **Condition:** the receipt has side effects. In this story, that means at least one removed leg.
   - **Where:** an `action-notice` appears in the day view at the placement ruled above.
   - **Content:**
     - a summary line, for example "1 Fahrt entfernt" / "2 Fahrten entfernt", with a separate singular key per the `statusGap`/`statusGapOne` convention;
     - a *Rückgängig* text button;
     - a close icon-button.
   - **No auto-dismiss.**
4. **AC4: A receipt without side effects shows nothing.** No notice appears, and every existing save, delete and render behaviour is byte-identical to today.
5. **AC5: Undo restores the whole change in one request.**
   - **The request:** activating *Rückgängig* sends `POST /api/trips/{id}/day-plan-changes/undo` with the receipt. That one request restores the whole change in one transaction.
   - **Created item:** it is deleted through the same in-transaction delete core that DELETE uses.
   - **Updated item:** its columns, its payments and its `updatedAt` return to the snapshot.
   - **Deleted item:** it is recreated with its original `id`, `createdAt` and `updatedAt`, together with its payments and its image and document rows.
   - **Removed legs:** every one is recreated with its original `id`, endpoints, `transportType`, `durationMinutes`, `distanceKm`, `linkUrl`, `createdAt` and `updatedAt`.
   - **Bucket-list conversion:** the bucket-list row is recreated with its original id.
   - **After success:** the notice disappears and the day re-reads silently.
6. **AC6: Undo refuses when the day has moved on.**
   - **When:** any check in *Staleness* (Dev Notes) fails.
   - **Response:** `409` with code `undo_stale`. Nothing is written; the whole transaction rolls back.
   - **What the user sees:** the notice says the day has changed since. *Rückgängig* is withdrawn, close stays, and the day re-reads silently.
   - **Guarantee:** an undo never overwrites a later edit.
7. **AC7: The receipt lives only in client state, never persisted.** It is discarded when any of these happens:
   - the notice is closed;
   - the day changes (the render-time `dayId` reset at `TripDayView.tsx:695-703`);
   - the component unmounts;
   - any other write is made on the day from this view. Every handler listed in Task 7 counts, including the plan dialog's own media writes. A new receipt from a later save **replaces** the old one.
8. **AC8: Planning rights.**
   - **Client:** a viewer (`canEditPlanning === false`) never sees a notice or an undo control.
   - **Server:** the undo route uses the same gate as POST/PATCH (`hasTripOwnerOrContributorAccess` → `404 not_found`), plus the repository's writer clause on the trip day.
9. **AC9: The orphan list stays.**
   - **Unchanged:** Story 8.5's orphan block (`TripDayView.tsx:3700-3811`), `handleRemoveOrphanSegment` and their tests.
   - **Still true:** a pre-existing orphan still appears there after an unrelated edit to the same day (follows from AC1).
10. **AC10: Moving between days is untouched.**
    - `moveDayPlanItemToTripDay`, `moveDayPlanItemsBetweenTripDays`, `swapDayPlanItemsBetweenTripDays`, their routes, and `planMoveNotice` keep their current behaviour.
    - None of them returns a receipt.
    - Their only change is the mechanical one from Task 1, where the helper returns rows.
11. **AC11: Both dictionaries.**
    - Every new key exists in both `src/i18n/en.ts` and `src/i18n/de.ts`.
    - `test/i18nDictionaries.test.ts` stays green.
12. **AC12: The undo endpoint is no more powerful than the write endpoints.**
    - **Validation:** a forged or tampered receipt is validated before anything is written:
      - every row belongs to the receipt's `tripDayId`, and that day belongs to the trip in the URL;
      - every URL passes `isSafeExternalUrl`;
      - every restored media URL resolves into this trip's own upload tree.
    - **Failure:** a failure here is `400 validation_error`, not a stale `409`.

## Tasks / Subtasks

- [x] **Task 0: Baseline.** Run `npm test`, `npm run typecheck` and `npm run lint` in `travelplan/`, and record the file and test counts and the lint problem count in the Completion Notes. (AC: all)

- [x] **Task 1: One sweep helper that returns rows** (AC: 1, 2, 10)
  - [x] `src/lib/repositories/travelSegmentRepo.ts:289-314`: `removeTravelSegmentsReferencingItemInTransaction` returns full `TravelSegment` rows instead of ids. Select every column before the `deleteMany`.
    - **Keep it one helper.** This is 8.5's DW-215 rule: no second, near-identical helper.
    - **Keep the non-healing docblock.** It deletes and never creates.
  - [x] Update its callers mechanically to `.map((s) => s.id)`:
    - `dayPlanItemRepo.ts` delete (`:633`) and move (`:693`);
    - `accommodationRepo.ts:554-581`.
  - [x] **Their returned shapes and the move route's `removedTravelSegmentIds` do not change.**

- [x] **Task 2: A transaction-capable timeline** (AC: 1)
  - [x] Extract the endpoint-ordering core of `buildSegmentTimeline` into an exported `buildSegmentTimelineInTransaction(tx, tripId, tripDayId)`. It takes no writer clause; callers have already passed it.
    - **Endpoint order:**
      1. the nearest-lower-`dayIndex` day's accommodation;
      2. the day's items, sorted by the shared `compareDayPlanItemsByStartTime`;
      3. this day's accommodation.
  - [x] `buildSegmentTimeline` becomes its writer check plus a call to the core, so `ensureSegmentItemsExist` and its two callers are untouched.
  - [x] **Do not widen `ensureSegmentItemsExist`. Create and update of a non-adjacent pair still refuse.**

- [x] **Task 3: The sweep** (AC: 1)
  - [x] Add `sweepNoLongerDrawnSegmentsInTransaction(tx, { tripId, tripDayId, drawnBefore: Set<string> })` in `travelSegmentRepo.ts`. It:
    1. reads the timeline after the change through Task 2;
    2. builds `drawnAfter` with `buildDrawnDaySegmentPairKeys` (`src/lib/trips/daySegmentPairs.ts`);
    3. loads the day's segments;
    4. deletes those whose key is in `drawnBefore` but not in `drawnAfter`;
    5. returns them as full rows.
  - [x] **Reuse `daySegmentPairs.ts`.** It is the one drawn-pair rule that the day view and the overview already share. Do not write a fourth adjacency rule (see DW-320's count).
  - [x] Map endpoint types with care. `buildSegmentTimeline` yields `"accommodation" | "dayPlanItem"`, and `TravelSegment` stores `ACCOMMODATION | DAY_PLAN_ITEM`. Write one small mapping function and test it.
  - [x] Each write path computes `drawnBefore` from the timeline it reads in `tx` **before** mutating, then calls the sweep **after** mutating.

- [x] **Task 4: Receipts on the four write paths** (AC: 1, 2)
  - [x] Add a new `src/lib/trips/dayChangeReceipt.ts` that holds:
    - the receipt types;
    - the wire (ISO-string) form and conversion to and from DB rows;
    - `receiptHasSideEffects(receipt)`, which in this story is `removedTravelSegments.length > 0`;
    - `summarizeDayChangeReceipt(receipt, t)`, which returns summary parts joined with `" · "`.

    Keep it free of Prisma imports so the client can import it. Story 11.2 adds `movedItems` to the same type, side-effect test and summary, so build these as lists of parts, not a single string.
  - [x] `createDayPlanItemForTripDay` (`:417-469`):
    - compute `drawnBefore` inside the transaction;
    - create the item;
    - run the sweep;
    - return `{ item, receipt }`, where `edited = { kind: "created", itemId, updatedAt }`.
  - [x] `convertBucketListItemToDayPlanItemForTripDay` (`:471-545`): the same, plus snapshot the bucket-list row before `deleteBucketListItemForTripInTransaction` and put it in `receipt.consumedBucketListItem`.
  - [x] `updateDayPlanItemForTripDay` (`:547-612`):
    1. move the item read **into** the transaction;
    2. snapshot the item's columns and its `CostPayment` rows (`sortOrder` order);
    3. compute `drawnBefore`;
    4. write;
    5. run the sweep;
    6. re-read the post-write `updatedAt` for `edited = { kind: "updated", itemId, updatedAt, previous }`.

    `missing` and `not_found` keep their current meaning.
  - [x] `deleteDayPlanItemForTripDay` (`:614-648`):
    - extract the transaction body into `deleteDayPlanItemInTransaction(tx, { tripDayId, itemId })` so that undo can call the same core (AC5);
    - before the `deleteMany`, snapshot the item, its payments, and its `DayPlanItemImage` and `DayPlanItemDocument` rows;
    - compute `drawnBefore`;
    - delete;
    - call the referencing-legs helper;
    - run the sweep;
    - return the union of both leg sets, deduplicated by id.

    The result keeps `removedTravelSegmentIds` (the full union) and adds `receipt`.
  - [x] Update the result types (`DayPlanItemDetail` does not carry `updatedAt` today, so the receipt reads it from the row, not from `toDetail`). Then update the route (`day-plan-items/route.ts`) to add `receipt` to all three success bodies.
  - [x] **Do not touch the private comparator copy at `dayPlanItemRepo.ts:374-390` (DW-216).** It belongs to Story 11.2.

- [x] **Task 5: The undo repository function and route** (AC: 5, 6, 8, 12)
  - [x] `src/lib/validation/dayChangeReceiptSchemas.ts` (new): a Zod schema for the wire receipt.
    - **Make it `.strict()`.** Every id is a non-empty bounded string, and every date is an ISO string that parses.
    - **Restored segments:** `transportType` comes from the shared enum (`@/lib/trips/transportTypes`). `durationMinutes` is a non-negative integer. `distanceKm` is finite or null. `linkUrl` passes `isSafeExternalUrl` or is null.
    - **Item snapshots:** the field shapes of `dayPlanItemSchemas.ts`.
    - **Image and document `url`:** must pass `isSafeStoredImageUrl` / the document equivalent.
    - **Do not re-apply create-time business rules** such as the per-mode distance rule. A legitimately stored row (for example, from an import) may not satisfy them. Undo restores what existed; it does not author anything new.
    - **Cap array lengths** (for example, 200 legs) so the body stays bounded.
  - [x] `src/lib/repositories/dayPlanChangeRepo.ts` (new): `undoDayPlanChangeForTrip({ userId, tripId, receipt })`. It returns `not_found | invalid | stale | undone`.
    1. Run the writer check (the same clause as `findTripDayForTripWriter`), and check that the receipt's `tripDayId` belongs to `tripId`.
    2. Check that every restored leg's `tripDayId` and every snapshot's `tripDayId` equals the receipt's. Otherwise return `invalid`.
    3. Check that every restored media URL resolves into this trip's own upload directory. Reuse the resolved-path check behind `isForeignTripUploadUrl` (`tripRepo.ts`, Story 8.4); do not use a string prefix. Otherwise return `invalid`.
    4. Run one `prisma.$transaction`, in this order:
       1. the staleness checks (Dev Notes);
       2. the reverse;
       3. the post-condition.

       On any failure, throw a typed `UndoStaleError` and map it to `stale`. A `P2002` raised while recreating a row also maps to `stale`, because someone recreated that pair or id.
  - [x] `src/app/api/trips/[id]/day-plan-changes/undo/route.ts` (new): `POST`. Follow the same check order as `day-plan-items/route.ts` POST:
    1. `requireCsrf` → `403 csrf_invalid`;
    2. `requireSession`;
    3. `hasTripOwnerOrContributorAccess` → `404 not_found`;
    4. `parseJson` → `400 invalid_json`;
    5. the schema → `400 validation_error`.

    Then map the repository result:

    | Repository result | Response |
    |---|---|
    | `not_found` | `404 not_found` |
    | `invalid` | `400 validation_error` |
    | `stale` | `409 undo_stale` ("The day has changed since this change was made") |
    | `undone` | `ok({ undone: true })` |

    Use the `ok`, `fail` and `apiError` helpers.

- [x] **Task 6: The `action-notice` component** (AC: 3, 4, 6)
  - [x] Add `src/components/ui/ActionNotice.tsx`, a generic component named after DESIGN.md's `action-notice`.
    - **Props:** `summary: string`, `warning?: string`, `actionLabel?: string`, `onAction?`, `actionPending?: boolean`, `onClose`, `closeLabel: string`.
    - **Panel:** `borderRadius: "8px"` (rounded.md has no theme token; use the literal, as `TripDayView.tsx:3224` does), `backgroundColor: tokens.card`, `1px solid tokens.borderStrong`, `padding: "18px"` (card-padding, a literal), and `gap: 1` (8px).
    - **Text:** summary in `tokens.ink`. The optional warning line uses `theme.palette.warning.main` (`warn` is not in `tokens`; see `theme.ts:75`) with the small alert icon. Story 11.2 uses that line; render it only when `warning` is set.
    - **Buttons:** a trailing text `Button` (`MuiButton` already sets `minHeight: 44`) and a close `IconButton`, 44×44, `CloseXIcon` at `fontSize: 20`, `color: tokens.inkSoft`, with `aria-label={closeLabel}`. Copy `DialogCloseButton`'s pattern, but **do not reuse that component**: it hard-codes dialog offsets and `data-testid="dialog-close"`.
    - **Not an error.** Do not use `Alert severity=…` and do not borrow error colours.
    - **Accessibility:** `role="status"` so screen readers hear the summary.
    - **Test ids:** `data-testid="action-notice"`, `action-notice-undo`, `action-notice-close`.

- [x] **Task 7: Wire the receipt into the day view** (AC: 3, 4, 5, 6, 7, 8)
  - [x] **`TripDayPlanDialog.tsx`:**
    - change `onSaved: () => void` (`:391`) to `onSaved: (receipt: DayChangeReceipt | null) => void`;
    - read `body.data?.receipt` on success (`:1649`);
    - add an optional `onDayWrite?: () => void` prop and call it after each successful media write in the dialog (image and document upload and delete, `:1983`, `:2028`, `:2096`, `:2148`), so a write the view cannot see still ends the undo window (AC7).
  - [x] **`TripDayView.tsx` state:**
    - add `const [dayChange, setDayChange] = useState<{ receipt; status: "ready" | "pending" | "stale" } | null>(null)`;
    - add a `dayChangeRef` mirror if a handler needs it at click time;
    - add `setDayChange(null)` to the render-time reset at `:695-703`, beside `setPlanMoveNotice(null)`.
  - [x] **Set the receipt** only when `canEditPlanning && receiptHasSideEffects(receipt)`, otherwise `null`:
    - in `handlePlanDialogSaved` (`:1392`), from its new argument;
    - in `handleDeletePlan` (`:1321-1384`), from `body.data?.receipt`.
  - [x] **Discard the receipt** (`setDayChange(null)`) at the start of every other write on the day:
    - `handleRemoveOrphanSegment` (`:1164`);
    - `handleSubmitTransfer` (`:1481`);
    - `handleMovePlanItem` (`:1557`);
    - `handleCopyPreviousStay` (`:1868`);
    - `handleSaveDayImage` (`:2757`), which also carries the day note;
    - `handleRemoveDayImage` (`:2864`);
    - `handleTravelSegmentSaved` (`:1120`);
    - both `TripAccommodationDialog` `onSaved` callbacks (`:4409`, `:4421`);
    - the plan dialog's new `onDayWrite`.

    `handlePlanDialogSaved` and `handleDeletePlan` replace the receipt rather than only clearing it.
  - [x] **`handleUndoDayChange`:**
    - **Guards:** `canEditPlanning`, a receipt present, and an in-flight guard (status `pending` disables the button).
    - **Request:** `ensureCsrfToken`, then `POST /api/trips/${tripId}/day-plan-changes/undo` with `{ receipt }`.
    - **Discard stale responses:** capture `dayId` and ignore the response if `currentDayIdRef.current` changed meanwhile.
    - **On 200:**
      1. `setDayChange(null)`;
      2. `loadDay({ silent: true })`;
      3. `loadBucketListItems()` if the receipt carried `consumedBucketListItem`.
    - **On 409 `undo_stale`:** set status `stale` (the notice shows `trips.dayChange.undoStale` and drops the undo button), then `loadDay({ silent: true })`.
    - **On any other failure:** keep the receipt at status `ready` and show the page error through `resolveApiError(code, t("trips.dayChange.undoError"))`.
  - [x] **Render `<ActionNotice>`** at the placement ruled in *Read this first* §8, only when `dayChange && canEditPlanning`:
    - `summary = summarizeDayChangeReceipt(...)`, or `t("trips.dayChange.undoStale")` when stale;
    - `actionLabel = t("trips.dayChange.undo")` unless stale;
    - `closeLabel = t("trips.dayChange.dismiss")`.

- [x] **Task 8: Strings** (AC: 3, 6, 11). Add these keys to both dictionaries, in the same relative order, near `trips.plan.move*`:

  | Key | de | en |
  |---|---|---|
  | `trips.dayChange.legsRemovedOne` | 1 Fahrt entfernt | 1 travel leg removed |
  | `trips.dayChange.legsRemoved` | {count} Fahrten entfernt | {count} travel legs removed |
  | `trips.dayChange.undo` | Rückgängig | Undo |
  | `trips.dayChange.dismiss` | Hinweis schließen | Dismiss notice |
  | `trips.dayChange.undoStale` | Der Tag wurde seitdem geändert – die Änderung lässt sich nicht mehr rückgängig machen. | The day has changed since – this change can no longer be undone. |
  | `trips.dayChange.undoError` | Rückgängig fehlgeschlagen – bitte erneut versuchen. | Undo failed – please try again. |

  Add a German comment on the `One` key, matching `de.ts:140`, explaining that `formatMessage` has no plural rules.

- [x] **Task 9: Tests** (AC: all). See *Testing* for the cases.
- [x] **Task 10: Ledger and record.**
  - [x] Add one line under 8.5's story file record, or the Completion Notes, saying that its AC3 (the epic's AC2) is superseded by 11.1.
  - [x] File the media-file `DW-` entry from §2 if it is absent.
  - [x] Run the final gates and record the results against the Task 0 baseline.

### Review Findings

Code review 2026-10-10 (Blind Hunter + Edge Case Hunter + Acceptance Auditor): 2 decision-needed, 8 patch, 1 defer, 10 dismissed. Tommy's rulings (2026-10-11): Decision 1 → refuse as stale; Decision 2 → sign the receipt; all patches applied.

- [x] [Review][Decision] Post-condition (a) checks endpoints-on-timeline, not pair-drawn — Undo restores a swept leg as an orphan when a later unrelated edit has put an activity between its endpoints (e.g. a neighbour retimed). A forged receipt (real `created` receipt + invented `removedTravelSegments`) can also insert legs between non-adjacent endpoints, which `ensureSegmentItemsExist` refuses with 400 — an AC12 breach. The story's Staleness table says "endpoints absent"; the dev flagged this. Options: tighten to `drawnAfterUndo.has(key)` → `stale` (recommended; legit undos always redraw their legs), or keep as written. [`dayPlanChangeRepo.ts:221-225`] — **Resolved: refuse as stale.** Each restored leg must be in the drawn keys of the final timeline; pinned by two new stale cases (interposed activity; forged non-adjacent leg), both observed red against the old check.
- [x] [Review][Decision] Forged-receipt surface is wider than the write endpoints (AC12) — A crafted `updated`/`deleted` snapshot can write malformed `fromTime`/`toTime` (any ≤16 chars, not `HH:mm`), unparseable `contentJson`, 2000-char titles, negative costs, non-`YYYY-MM-DD` `dueDate`, negative `distanceKm`; a plain create's receipt can carry an invented `consumedBucketListItem` (bypassing 1–120/1000/200 limits); restored media may point at *another item's* files in the same trip; a non-leg `P2002` (payment/image id colliding cross-trip) answers 409 instead of 400; a tampered `created.itemId` is 409 not 400. Conversely, some caps are stricter than storable data (`contentJson` > 1 MB, imported `locationLabel` > 2000) so a legit receipt can be un-undoable. Options: (1) HMAC-sign the receipt server-side and verify on undo, keeping only reader-safety checks; (2) harden field-by-field to the write schemas' *formats* (not business rules), bucket-list limits, item-folder containment for media, non-leg `P2002` → `invalid`, and align caps with storage; (3) accept — a contributor can already write the day — and ledger it. [`dayChangeReceiptSchemas.ts:86-157`, `dayPlanChangeRepo.ts:83-119, 263`] — **Resolved: signed.** New `src/lib/trips/dayChangeReceiptSignature.ts`: HMAC-SHA256 under a purpose-derived key from `JWT_SECRET`, binding trip + user, over a key-sorted canonical form (Zod rebuilds objects in schema order). The write route signs; the undo route verifies after the schema → `400 validation_error`. Stored-text length caps dropped (array caps raised to 1000 as body bounds); URL, enum and media-containment checks and `findInvalidity` kept as defence in depth — the tamper tests now re-sign their forgeries so they still reach those checks.
- [x] [Review][Patch] Non-409 undo failures (400 `validation_error`, 404) re-arm *Rückgängig* forever — only 500/network should stay `ready`; 400/404 can never succeed, so withdraw the action (stale-like terminal state) and re-read the day [`TripDayView.tsx` `handleUndoDayChange`, ~1400]
- [x] [Review][Patch] `handleDeletePlan` takes a late receipt without a day guard and does not end the undo window at start — switching day mid-DELETE puts day 1's receipt on day 2 (AC7); the old notice's Undo stays clickable while the delete is in flight. Guard with `currentDayIdRef` and `setDayChange(null)` at start [`TripDayView.tsx:1415-1463`]
- [x] [Review][Patch] Stay-dialog media writes (image/document upload and delete) do not end the undo window — AC7 "any other write on the day from this view"; add `onDayWrite` to `TripAccommodationDialog` as done for the plan dialog [`TripAccommodationDialog.tsx` media handlers; `TripDayView.tsx:4537-4560`]
- [x] [Review][Patch] Losing planning rights hides the receipt but keeps it in state — clear `dayChange` when `canEditPlanning` turns false (AC8) [`TripDayView.tsx` `takeDayChangeReceipt` / render gate ~3642]
- [x] [Review][Patch] Conversion undo that lands after a day switch skips `loadBucketListItems()` — the bucket list is trip-level, so reload it before the day guard returns [`TripDayView.tsx` `handleUndoDayChange`]
- [x] [Review][Patch] `isoDateSchema` accepts any `Date.parse`-able string ("2026", "Oct 10 2026"), not ISO as Task 5 requires [`dayChangeReceiptSchemas.ts:32-35`]
- [x] [Review][Patch] Stale comments — `removeTravelSegmentsReferencingItemInTransaction` docblock still says "returns the ids"; `dayPlanItemRepo.ts` header still says return shape and `removedTravelSegmentIds` are 6.23's; the `TransactionClient` "went with the segment sweep" note is now false [`travelSegmentRepo.ts` ~347; `dayPlanItemRepo.ts:7-10, 26`]
- [x] [Review][Patch] Test hygiene — rewritten 8.5 pin still uses `plan-insert-keeps-segment@example.com`; no UI case renders as a viewer *from the start* with a receipt (Testing list) [`test/dayPlanItemRepo.test.ts`; `test/tripDayViewDayChange.test.tsx`]
- [x] [Review][Defer] Staleness keyed on millisecond `updatedAt` — two writes in the same ms are indistinguishable, so undo could overwrite a later edit [`dayPlanChangeRepo.ts:149, 167, 199`] — deferred, by design of the spec (DW-370)

## Dev Notes

### The receipt shape (wire form; dates are ISO strings)

```ts
type DayChangeReceipt = {
  version: 1;
  tripDayId: string;
  edited:
    | { kind: "created"; itemId: string; updatedAt: string }
    | { kind: "updated"; itemId: string; updatedAt: string; previous: DayPlanItemSnapshot }
    | { kind: "deleted"; previous: DayPlanItemSnapshot & { images: ImageRow[]; documents: DocumentRow[] } };
  removedTravelSegments: TravelSegmentRow[];      // full rows incl. createdAt, updatedAt
  consumedBucketListItem?: TripBucketListItemRow;  // conversion create only
  // Story 11.2 adds: movedItems: { itemId; updatedAt; previousFromTime; previousToTime }[]
};
// DayPlanItemSnapshot = every DayPlanItem column (prisma/schema.prisma:201-227) incl. id, tripDayId,
// createdAt, updatedAt, plus payments: CostPayment rows (all columns, in sortOrder).
```

**The `updatedAt` on `created` and `updated` is the item's state *after* the write.** That is the value undo compares against. Swept and deleted rows carry their own last `updatedAt` inside their snapshot, and undo restores it.

### Staleness: every check, all inside the undo transaction, before any write

| Receipt part | Refuse (`stale`) when |
|---|---|
| `edited.created` | the item is missing, its `updatedAt` ≠ receipt, **or** it now has any image or document row, **or** any travel segment references it. Media and legs on a freshly created item can only come from later edits, and deleting them would overwrite those edits. |
| `edited.updated` | the item is missing or its `updatedAt` ≠ receipt. Do the restore as `updateMany({ where: { id, tripDayId, updatedAt } })` and check that `count === 1`. |
| `edited.deleted` | a row with that id exists. |
| each removed leg | a row with that id exists, or the recreate hits `P2002` on `idx_travel_segments_pair` (someone drew a new leg for the same pair). |
| `consumedBucketListItem` | a row with that id exists. |
| **post-condition** | after the reverse, recompute the day's drawn keys (Task 2 + `daySegmentPairs`). Refuse if (a) any restored leg's pair is not drawn on the final timeline (review 2026-10-11: tightened from "endpoints absent"), or (b) any leg **not in the receipt** that was drawn before the undo is no longer drawn. Undo never orphans a leg it did not delete, and never resurrects a leg pointing at nothing. |

**Compare `updatedAt` by epoch milliseconds,** never by `Date` identity. SQLite stores milliseconds.

**Check whether Prisma 7 honours an explicitly passed `updatedAt` on `update`/`updateMany`/`create` for an `@updatedAt` field.** The server analysis says it does on create. Pin the answer with a test, because success criterion 3 of the change proposal ("byte for byte on every touched row") depends on it. If Prisma overrides the value on update, record that in the Completion Notes and raise it. Do not silently accept a moved `updatedAt`.

### Undo semantics per kind

- **created:** call `deleteDayPlanItemInTransaction` (Task 4's extracted core). Its legs-referencing sweep finds nothing, because the staleness check refused if any leg referenced the item. Then recreate the removed legs.
- **created via conversion:** as above, then recreate the bucket-list row with its original `id`, `createdAt` and `updatedAt`. Without that, undo destroys the idea outright, which the user never asked for.
- **updated:** restore every column, replace payments with the snapshot's, and restore `updatedAt`. Then recreate the legs.
- **deleted:** recreate the item, its payments, and its image and document rows, all with original ids, `sortOrder`, `createdAt` and `updatedAt`. Then recreate the legs. The files are still on disk because the item delete never unlinked them (*Read this first* §2).
- **Order:** restore items before legs, so the post-condition sees the final timeline.

### What must not regress

- **Story 6.23's non-healing rule.** Nothing here *creates* a leg except undo recreating rows it removed. Never join the new neighbours.
- **`ensureSegmentItemsExist`'s two callers** (`travelSegmentRepo.ts:340`, `:376`), and the `400` on a non-adjacent create. Do not widen it.
- **The `@@unique([tripDayId, fromItemType, fromItemId, toItemType, toItemId])` constraint.** Do not remove it to make undo easier; `P2002` maps to `stale`.
- **Story 5.13's writer clause** on every path. A contributor may undo exactly as they may write.
- **Import fidelity** (8.5 AC8 / Story 2.35). The import path is not a day-plan-item write and must not sweep.
- **`handleDeletePlan`'s optimistic removal and rollback.** The receipt is only *added* on success.
- **`handlePlanDialogSaved`'s `loadDay()` + `loadBucketListItems()`.** These are unchanged.
- **The move notice** (`planMoveNotice`, `<Alert severity="success">` at `TripDayView.tsx:3220`). It is unchanged, and it is not the precedent for the new notice's styling.

### Existing tests that this story deliberately changes

These pin 8.5's superseded rule and **must** now fail. Rewrite each one to the new rule, and cite the supersession in its docblock. This is the one sanctioned exception to "never edit an expectation to match":

- the 8.5 AC3 pin in `test/dayPlanItemRepo.test.ts` (A →(car,40m)→ B, insert M between them, retime: "row still exists with mode, duration and distance intact"). It now asserts the row is **gone**, the receipt carries it in full, and undo brings it back identical;
- any case in `test/tripDayPlanItemsRoute.test.ts` that asserts the exact POST, PATCH or DELETE body with `toEqual`. Add `receipt`.

Any **other** red test, especially in `tripDayViewOrphanSegments.test.tsx` (stubbed fetch, so it should stay green) or `tripDayViewLayout.test.tsx`, is a regression to investigate. Do not edit it to pass. The layout suite's plan-dialog stub (`test/tripDayViewLayout.test.tsx:107-170`) types `onSaved: () => void`. Widening that type is fine. Changing what it asserts is not.

### Testing

`vitest` (`npm test`; serial, a single fork) runs against real SQLite (`test/setup.ts`) with no repository mocks. Component suites use `// @vitest-environment jsdom`, `renderWithProviders`, and `stubFetch`/`mockFetchResponse` from `test/helpers/mockFetch.ts`. Route suites build `NextRequest` with `createSessionJwt` and `routeContext(tripId)` from `test/helpers/routeContext.ts`.

**Required red:** the sweep cases are written first and observed failing at baseline (the leg survives today). Record the observation.

- **`test/dayPlanItemRepo.test.ts`** (or a new `test/dayPlanChangeSweep.test.ts` to keep one concern per file):
  - create between A and B sweeps A→B;
  - a retime that changes the order sweeps;
  - clearing times sweeps;
  - a delete sweeps both referencing legs and returns them all;
  - legs to or from last night's stay and tonight's stay are swept when their pair breaks;
  - **a pre-existing orphan on the day survives an unrelated edit**;
  - a retime that keeps the order sweeps nothing and the receipt has no side effects;
  - the conversion create sweeps and carries the bucket-list row;
  - **rollback**: make the sweep throw (`vi.mock` with `importActual` spread, as in `test/accommodationDeleteRollback.test.ts`) and assert that the item write did not commit.
- **`test/dayPlanChangeUndo.test.ts`** (new; repository plus route):
  - undo of create, update and delete each restores **every touched row identical**, column by column, including `updatedAt`, `createdAt`, payments, and image and document rows;
  - undo of a conversion restores the bucket-list row;
  - stale on each staleness row above: a later PATCH, an image added to a created item, a leg recreated for the same pair, a leg added that the undo would orphan, and an endpoint deleted since;
  - after a refused undo, the DB is unchanged;
  - viewer → 404, non-member → 404, CSRF → 403;
  - **tampering**: a receipt naming another trip's day, a leg on another day, a `javascript:` link, and a media URL escaping the trip directory each give 400 and write nothing.
- **`test/dayChangeReceipt.test.ts`:** `receiptHasSideEffects`, the summary's singular and plural in both languages, and the wire round trip.
- **`test/tripDayViewDayChange.test.tsx`** (new; mirror `tripDayViewOrphanSegments.test.tsx`'s harness):
  - the notice appears after a save whose receipt removed a leg, and is absent after an empty receipt;
  - it is absent for a viewer even when given a receipt;
  - *Rückgängig* posts the receipt once (a double click does not post twice), then the notice goes and the day reloads;
  - a 409 shows the stale text without an undo button;
  - a 500 keeps the notice and shows the error;
  - close discards it;
  - a `rerender` to another `dayId` discards it;
  - the orphan remove, a travel segment save, and the plan dialog's `onDayWrite` each discard it;
  - a delete with a receipt shows the notice and the existing segment filter still runs.
- **`test/actionNotice.test.tsx`:** `role="status"`, a 44px close target with an accessible name, the warning line only when given, and no `MuiAlert` class.

### Project Structure Notes

- **No schema change, no migration, no new dependency.** No `sortOrder` column (the change proposal's central point; it belongs to the design of 11.2).
- **New files:**
  - `src/lib/trips/dayChangeReceipt.ts`
  - `src/lib/validation/dayChangeReceiptSchemas.ts`
  - `src/lib/repositories/dayPlanChangeRepo.ts`
  - `src/app/api/trips/[id]/day-plan-changes/undo/route.ts`
  - `src/components/ui/ActionNotice.tsx`
  - the test files named above
- **Modified files:**
  - `travelSegmentRepo.ts`, `dayPlanItemRepo.ts`, `accommodationRepo.ts` (mechanical only)
  - `day-plan-items/route.ts`
  - `TripDayPlanDialog.tsx`, `TripDayView.tsx`
  - both dictionaries
  - the deliberately changed tests above
- **Ignore `.kilo/worktrees/fern-bugle/`.** It is a stale copy of the app.

### References

- Epic and ACs: [epics.md#Story 11.1](../planning-artifacts/epics.md); the rulings: [sprint-change-proposal-2026-10-10.md §2, §5 *Decisions recorded*](../planning-artifacts/sprint-change-proposal-2026-10-10.md)
- Superseded rule and its reasoning: [8-5-travel-segments-that-match-their-day.md](8-5-travel-segments-that-match-their-day.md), [spec-8-5-travel-segments-that-match-their-day.md](spec-8-5-travel-segments-that-match-their-day.md) (*Design Notes*: one array, one order; `daySegmentPairs.ts`)
- Component spec: `ux-designs/ux-TravelPlan-2026-07-27/DESIGN.md` → `action-notice` (frontmatter `components.action-notice`); EXPERIENCE.md → *Change with side effects*
- API envelope: `src/lib/http/response.ts`, `src/lib/errors/apiError.ts`; access: `src/lib/auth/tripAccess.ts:80`
- Plural convention: `de.ts:140-142` (`statusGap` / `statusGapOne`)
- Ledger: DW-216 (11.2's business, not this story's), DW-318 / DW-320 (orphans by other routes; unchanged), DW-319 (whole-day transfer; unchanged under AC10), DW-180 (menu-row `'&&'` fix; 11.3's concern)

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (`claude-opus-5-5`), via bmad-dev-story.

### Debug Log References

- **Baseline (Task 0, at `7780dfb`):** `npm test` 157 files / 2603 tests, all passing. `npm run typecheck` 0 errors. `npm run lint` 80 problems (0 errors, 80 warnings).
- **Required red:** `test/dayPlanChangeSweep.test.ts` was written before any repository change and run against the unchanged code. 8/8 failed. Five failed on the leg surviving (`expected 1 to be +0`, `expected 2 to be +0`, `expected {…} to be null`); delete, pre-existing-orphan and keep-order failed only on the absent `receipt`, as expected, because they assert nothing is swept, or that the delete already removed the referencing legs.
- **The superseded 8.5 pin** (`dayPlanItemRepo.test.ts`, "keeps a neighbours' segment intact…") went red after Tasks 1–4 exactly as predicted (`expected [] to have a length of 1`). No other existing test went red. `tripDayViewOrphanSegments.test.tsx` and `tripDayViewLayout.test.tsx` were not edited.
- **Final gates:** `npm test` 163 files / 2656 tests, all passing (+6 files, +53 tests). `npm run typecheck` 0 errors. `npm run lint` 80 problems (0 errors, 80 warnings), unchanged from baseline. The new files add no warnings, and the 7 warnings in `TripDayView.tsx` / `TripDayPlanDialog.tsx` are the same pre-existing ones, at shifted line numbers.

### Completion Notes List

- **Sweep (AC1).** `buildSegmentTimelineInTransaction` is the extracted, writer-free core. `buildSegmentTimeline` is now the writer check plus a call to it, and `ensureSegmentItemsExist` is untouched. `readDrawnSegmentKeysInTransaction` and `sweepNoLongerDrawnSegmentsInTransaction` reuse `daySegmentPairs.ts`, so there is no fourth adjacency rule. The endpoint-type mapping is the existing `fromPrismaItemType`, now exported and tested, not a second copy. Every write path reads `drawnBefore` through `tx` before mutating and sweeps after. Rollback is pinned for create, update and delete (`dayPlanChangeSweepRollback.test.ts`).
- **One helper (Task 1).** `removeTravelSegmentsReferencingItemInTransaction` returns full rows. The move path maps them to ids. `accommodationRepo.ts` needed **no edit**, because it never read the return value.
- **Receipts (AC2).** `createDayPlanItemForTripDay` now returns `{ item, receipt } | null`. Four existing tests in `dayPlanItemRepo.test.ts` changed accessor only (`item?.x` → `item?.item.x`); no expectation changed. The update snapshot is read inside the transaction. The delete body is `deleteDayPlanItemInTransaction` (it takes `tripId` as well, which the timeline read needs). `removedTravelSegmentIds` is the deduplicated union.
- **Prisma 7 and `@updatedAt` (Dev Notes check).** An explicitly passed `updatedAt` **is honoured** on `create`, `createMany` and `updateMany`. This is pinned by `dayPlanChangeUndo.test.ts`, whose update case asserts the original millisecond back and compares the whole database to the pre-change snapshot with `toEqual`. "Byte for byte on every touched row" holds.
- **Undo (AC5/AC6/AC12).** The repository runs staleness checks, then the reverse (items before legs), then the post-condition, all in one transaction. Failures throw `UndoStaleError`, and `P2002` maps to `stale`. **`isForeignTripUploadUrl` no longer exists** in `tripRepo.ts`; the story text predates its removal. The media check is built from the same resolved-path primitives in `uploadPaths.ts` (`isExternalMediaUrl`, `resolveStoredMediaPath`, `mediaPathIsInside`, `getTripUploadDir`), so it is not a string prefix. An external URL is refused, because item media is only ever stored as upload paths.
- **Order decision, AC12 vs AC8.** A receipt naming another trip's day answers `400 validation_error`, as AC12 requires. To get there, the repository checks that the day is on the URL's trip (`invalid`) *before* the writer clause (`not_found`). The route's trip-level gate still answers `404` to viewers and non-members.
- **Review point: post-condition (a) follows the spec literally.** It requires a restored leg's *endpoints* to be on the timeline, not the pair to be *drawn*. So if an unrelated activity is inserted between a swept leg's endpoints after the change, undo restores that leg as an orphan, which then appears in the 8.5 list, instead of refusing. Tightening this to "drawn" is a one-line change if you prefer refusal.
- **"Clearing times sweeps" is not reachable.** Both item schemas require `fromTime`/`toTime`. The test covers the same order change from the other side: an untimed (imported) activity gains a time and moves ahead.
- **UI (AC3/AC4/AC7/AC8).** `ActionNotice` is generic (`role="status"`, no `Alert`, 44px close, no timer). The notice renders inside the day frame, right after the hero and before the coverage panel, in a band using `HERO_PADDING_INLINE`. The receipt is held only when `canEditPlanning && receiptHasSideEffects`, and it is discarded on close, on a day change (the render-time reset), on unmount, and at the start of every write listed in Task 7, including the plan dialog's new `onDayWrite` after each of its four media writes. The undo handler claims a ref before any await, so a double click posts once. Every state write after the response is conditional on the held receipt still being the same one, so a notice closed mid-flight stays closed.
- **Not verified in a real browser.** All UI evidence is jsdom. The notice's placement and wrapping at 390px have not been looked at in Chrome.
- **Ledger and record (Task 10).** `DW-187` already records that an activity delete leaves its media files on disk. Rather than file a duplicate, a dated Story 11.1 note was appended to it recording the coupling: undo of a delete depends on those files surviving, so a future fix must not simply add an unlink to the delete. Story 8.5's Change Log now records that its AC3 (the epic's AC2) is superseded by 11.1.

### File List

New:
- travelplan/src/lib/trips/dayChangeReceipt.ts
- travelplan/src/lib/validation/dayChangeReceiptSchemas.ts
- travelplan/src/lib/repositories/dayPlanChangeRepo.ts
- travelplan/src/app/api/trips/[id]/day-plan-changes/undo/route.ts
- travelplan/src/components/ui/ActionNotice.tsx
- travelplan/src/lib/trips/dayChangeReceiptSignature.ts (code review)
- travelplan/test/dayPlanChangeSweep.test.ts
- travelplan/test/dayPlanChangeSweepRollback.test.ts
- travelplan/test/dayPlanChangeUndo.test.ts
- travelplan/test/dayChangeReceipt.test.ts
- travelplan/test/actionNotice.test.tsx
- travelplan/test/tripDayViewDayChange.test.tsx

Modified:
- travelplan/src/lib/repositories/travelSegmentRepo.ts
- travelplan/src/lib/repositories/dayPlanItemRepo.ts
- travelplan/src/app/api/trips/[id]/day-plan-items/route.ts
- travelplan/src/components/features/trips/TripDayPlanDialog.tsx
- travelplan/src/components/features/trips/TripDayView.tsx
- travelplan/src/components/features/trips/TripAccommodationDialog.tsx (code review: `onDayWrite`)
- travelplan/src/i18n/en.ts
- travelplan/src/i18n/de.ts
- travelplan/test/dayPlanItemRepo.test.ts
- travelplan/test/tripDayPlanItemsRoute.test.ts
- _bmad-output/implementation-artifacts/deferred-work.md
- _bmad-output/implementation-artifacts/8-5-travel-segments-that-match-their-day.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- _bmad-output/implementation-artifacts/11-1-travel-legs-that-leave-with-their-place-in-the-day.md

### Change Log

- 2026-10-11: Code review fixes. Receipts are now server-signed (trip + user bound) and verified by the undo route; undo refuses to restore a leg that would not be drawn (Staleness post-condition (a) tightened from "endpoints present" to "pair drawn"); ISO-only receipt dates; write-time length caps no longer applied to stored text. Client: 400/404 on undo withdraws the action (`trips.dayChange.undoUnavailable`); a delete ends the earlier undo window at start and ignores a receipt landing after a day switch; stay-dialog media writes end the window (`onDayWrite`); a drop in planning rights discards the receipt; a conversion undo reloads the bucket list whichever day is shown. Gates: 163 files / 2668 tests passing, typecheck 0, lint 80 warnings (unchanged). Status → done.

- 2026-10-10: Story 11.1 implemented. Non-consecutive legs are swept in the write's own transaction. POST, PATCH and DELETE on `day-plan-items` return a change receipt. New `POST /api/trips/{id}/day-plan-changes/undo` restores the whole change or refuses with `409 undo_stale`. New `action-notice` component is wired into the day view. Story 8.5 AC3 is superseded. Status → review.
