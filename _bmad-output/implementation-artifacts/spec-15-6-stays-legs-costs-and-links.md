---
title: 'Story 15.6: Stays, Legs, Costs and Links'
type: 'feature'
created: '2026-10-29'
status: 'done'
baseline_revision: '5134a5b'
final_revision: '50bc9ff'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-15-context.md'
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** The connector can write activities (15.4) and whole day plans (15.5), but not the night's stay, single travel legs, foreign-currency costs, payment schedules or links. So a day Claude planned is never complete, and the budget is wrong.

**Approach:** Add three groups of connector tools, all on the 15.4 rails (marker, one `ai_changes` row in the write's transaction, undo, `updatedAt` check, `Trip not found` for non-writable trips):
- **Stays:** `set_stay` and `delete_stay`, through `accommodationRepo`, with the new receipt kinds `stayCreated`, `stayUpdated` and `stayDeleted`.
- **Legs:** `create_leg`, `update_leg` and `delete_leg`, through `travelSegmentRepo`, with the existing leg kinds.
- **Costs and links:** `create_activity` and `update_activity` take `link` and `cost`. A cost is EUR or an ECB currency, converted on the server at the ECB rate as the dialogs do.

## Boundaries & Constraints

**Always:**
- **Shared cost input** (`src/lib/mcp/costInput.ts`):
  - Shape: `cost: {amount, currency?, payments?} | null`.
    - `amount` is in the currency's major unit, ≥0, ≤1,000,000, with at most 2 decimals.
    - `currency` is `"EUR"` (the default) or a code from `ECB_CURRENCIES`. Anything else is refused and the message lists the accepted codes.
    - `payments` is `[{amount, dueDate: YYYY-MM-DD}]`, 1..20, in the same currency. Their amounts must add up exactly to `amount`.
  - When `payments` is absent, there is one payment of the full amount due on the entry's day date. A bucket-list activity has no day, so it must give `payments`.
  - A foreign currency needs `amount` > 0. The rate comes from `costDeps.rates()` (default `getEcbRates`) and the conversion from `convertEntryToCents`. The stored fields are `costCents`, `costOriginalAmount` (hundredths), `costCurrency`, `costRate`, `costRateDate` (the rates' date), and each payment's `amountCents` and `amountOriginal`.
  - If the ECB call fails (`ExchangeRateError`), the tool answers: "The ECB exchange rates are unavailable right now, so nothing was written. Give the cost in EUR or try again later." Nothing is written.
  - The result always goes through the app's schema for the entry (`dayPlanItemMutationSchema`, `bucketListMutationSchema` or `accommodationMutationSchema`) before the write.
  - `cost: null` clears the cost, the four currency fields and the payments (passed as `[]`). An absent `cost` keeps what is stored (today's `storedMoneyAndLink`).
- **Links:** `link: string | null` (http/https, checked by the entry's schema). Absent keeps the stored link; `null` removes it.
- **`set_stay(tripId, dayId, updatedAt?, name?, status?, checkInTime?, checkOutTime?, place?, link?, cost?, notes?)`:**
  - Times are `HH:MM`. `place` uses `placeField`, and a name alone is geocoded. `notes` are plain text, ≤1000 characters. Nullable fields take `null` to clear them.
  - **No stay on the day → create.**
    - `name` is required and `status` defaults to `planned`.
    - A given `updatedAt` is refused with "This day has no stay; leave out updatedAt to create one."
    - The repository refuses inside the transaction when a stay appeared meanwhile, with `ChangedSinceReadError`, and never upserts over it.
  - **A stay exists → update.**
    - `updatedAt` is required: "This day already has a stay; pass its updatedAt from get_day to change it."
    - Only the given fields change; the rest are taken from the stored row.
    - A different resolved check-out recomputes the next day exactly as the app does (`planCheckOutScheduleInTransaction`).
- **`delete_stay(tripId, dayId, updatedAt)`:**
  - It removes the referencing legs as the app does, and the image and document rows by cascade. The files stay on disk, as in the app.
  - It does not recompute the next day, as in the app.
- **`create_leg(tripId, dayId, from:{type:"stay"|"activity", id}, to:{…}, mode, durationMinutes?, distanceKm?, link?)`:**
  - A missing duration, or a car's missing distance, is routed with 15.5's `routeLeg` (exported) for car, walking or cycling, when both endpoints have coordinates. The coordinates come from the day read; last night's stay point comes from `readDayPlanContextForWriter`.
  - If the leg still lacks a duration (or a car leg its distance), the call is refused and asks for it. Nothing is written.
  - A pair that already has a drawn leg is refused before the write: "These two entries already have a leg (<id>); change it with update_leg."
  - The repository result `missing` answers "Entry not found on this day". `not_adjacent` answers "A leg connects two consecutive entries of the day: last night's stay, the activities in order, tonight's stay."
- **`update_leg(tripId, legId, updatedAt, mode?, durationMinutes?, distanceKm?|null, link?|null)`:**
  - The endpoints are fixed.
  - A switch to ship or flight without a given distance drops the stored distance.
  - The merged values pass `travelSegmentMutationSchema`.
- **`delete_leg(tripId, legId, updatedAt)`.**
- **Repositories** (keep every app call site's behaviour unchanged):
  - `travelSegmentRepo` create, update and delete gain `inTransaction?: InTransactionHook`, called last with the receipt and the segment id.
  - `travelSegmentRepo` update and delete also gain `expectedUpdatedAt?`, checked inside the transaction; a mismatch throws `ChangedSinceReadError`.
  - `accommodationRepo`:
    - create gains `expectNoStay?: true` and `inTransaction?`
    - update gains `expectedUpdatedAt?` and `inTransaction?`
    - delete gains `expectedUpdatedAt?` and `inTransaction?`; with these it reads and checks the stay inside the transaction
    - each one builds its connector receipt only when a hook is given
  - The route return values do not change.
- **Receipt kinds** (additive, still version 3; every exhaustive switch, `mapReceipt`, the strict schema, `findInvalidity` and undo phases 1, 2 and 3 cover them):
  - `stayCreated {accommodationId, updatedAt}`: `tripDayId` is the stay's day. No moved items, no removed legs.
  - `stayUpdated {accommodationId, updatedAt, previous: StaySnapshot}`:
    - `tripDayId` is the pushed next day when the check-out recompute ran, otherwise the stay's day.
    - `StaySnapshot` is every `Accommodation` column (status `PLANNED`/`BOOKED`, stamps, `aiChangedAt`) plus its payments as `CostPaymentRow`s, with `accommodationId` set and `dayPlanItemId` null.
  - `stayDeleted {accommodationId, previous: StaySnapshot + images[] + documents[], nextDayId: string|null, nextDayLegs: TravelSegmentRow[]}`:
    - `tripDayId` is the stay's day.
    - `removedTravelSegments` holds the deleted legs on that day that were drawn before.
    - `nextDayLegs` holds the deleted legs drawn on the next day.
    - Legs that were already undrawn are deleted and not recorded (see Design Notes).
- **`findInvalidity`:**
  - Stay snapshot ids match `accommodationId`.
  - Payments, images and documents belong to the stay. Media paths stay inside the trip's upload tree.
  - `stayCreated` and `stayUpdated` have no removed legs.
  - `stayCreated` and `stayDeleted` have no moved items.
  - In `stayUpdated`, `previous.tripDayId === tripDayId` implies no moved items.
  - In `stayDeleted`:
    - `previous.tripDayId === tripDayId`
    - `nextDayLegs` are all on `nextDayId`, which is non-null when any exist and differs from `tripDayId`
    - there are no duplicate leg ids across both lists
- **Undo:**
  - `stayCreated`:
    - Phase 1 refuses when the stay is gone, its stamp changed, or it gained an image, a document or a leg.
    - Phase 2 deletes it, conditional on the stamp.
  - `stayUpdated`:
    - Phase 1 refuses when the stamp differs, or when `tripDayId` is neither the stay's day nor the day after it.
    - Phase 2 writes all previous columns back (conditional `updateMany`) and replaces the payments.
  - `stayDeleted`:
    - Phase 1 refuses when the id exists again, the day has a stay again, or a `nextDayLegs` id exists again. It also refuses when `nextDayId` is no longer the next day.
    - Phase 2 recreates the stay with its payments, images and documents, then the next-day legs.
    - Phase 3 checks that each next-day leg is drawn on the next day.
- **`ai_changes`:**
  - Actions: `stayCreated`, `stayUpdated`, `stayDeleted`, `legCreated`, `legUpdated`, `legDeleted`.
  - `tripDayId` is the stay's or the leg's day.
  - The subject is the stay's name for stays. For legs it is "<from> → <to>", using the activity title or stay name, with "?" when untitled, capped at 120 code points.
  - The notice labels (en/de):
    - "Stay added: {title}" / „Unterkunft hinzugefügt: {title}"
    - "Stay changed: {title}" / „Unterkunft geändert: {title}"
    - "Stay deleted: {title}" / „Unterkunft gelöscht: {title}"
    - "Leg added: {title}" / „Fahrt hinzugefügt: {title}"
    - "Leg changed: {title}" / „Fahrt geändert: {title}"
    - "Leg deleted: {title}" / „Fahrt gelöscht: {title}"
  - English `SUMMARIES` in `aiChanges.ts`, and its description lists the new actions.
- **Results:**
  - `{aiChangeId, stay|leg (get_day shape) or deletedStayId|deletedLegId, day}`, where `day` is `get_day` of the entry's day with its warnings.
  - `set_stay` adds `nextDay` (the `get_day` shape) when the recompute ran.
- **Badge on legs:**
  - `GET /api/trips/{id}` (both day mappings) returns each leg's `aiChangedAt`.
  - `TripDayView` shows `<AiBadge>` after the leg label in `renderTravelSegment`.

**Block If:** none. The open choices are decided in Design Notes.

**Never:**
- touching `sprint-status.yaml`
- Prisma in tools
- changing app routes' behaviour or the client-held receipts
- trip budget, name or dates
- day or hero images
- files (15.7)
- foreign currency in `apply_day_plan` (it stays EUR)
- logging argument contents

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Create stay | day 1 without a stay, `set_stay` with name, booked, place lat/lng, cost 240 EUR | stay marked, one payment 24000 due on the day's date, `ai_changes` `stayCreated`; undo removes it | — |
| Check-out push + undo | stay day 1 checkout 10:00 → 12:00, day 2 flexible first at 10:30 | day 2 flexible items move later, `nextDay` returned, receipt `stayUpdated` on day 2; `undo_ai_change` restores stay (all fields, payments, marker) and day 2 times | stale if day 2 item edited since |
| Delete stay + undo | stay day 1 with image, document, payment, legs into it (day 1) and out of it (day 2) | stay, rows, both legs gone; undo restores stay, media rows, payments, both legs exactly | stale if day 1 got a new stay |
| Foreign cost | `update_activity` cost `{amount: 100, currency: "USD", payments: [{40},{60}]}`, rate 1.08 | costCents 9259, payments 3704/5555, costOriginalAmount 10000, currency/rate/date stored; receipt `updated` | — |
| ECB down | foreign cost, rates stub throws `ExchangeRateError` | clear error, nothing written, no `ai_changes` row | — |
| Legs | `create_leg` walking without duration (route stub), `update_leg` duration, `delete_leg` | written, day recomputed, each undoable | stale `updatedAt` → "changed since you read it" |
| Bad leg | non-adjacent pair / existing pair / car without distance and no coordinates | refused, nothing written | — |
| Viewer | any new tool | `Trip not found` | — |

</intent-contract>

## Code Map

- `travelplan/src/lib/mcp/tools/activityWrite.ts`: the 15.4 rails to reuse: `startWrite`, `recordChange`, `writeErrorResult`, `lookUpPlace`, `readDay`, `storedMoneyAndLink`, `invalid`. `create_activity` and `update_activity` gain `cost` and `link`.
- `travelplan/src/lib/mcp/tools/dayPlanApply.ts`: `routeLeg`, `dayPlanApplyDeps.route` (export `routeLeg`) and `hasAtMostTwoDecimals`.
- `travelplan/src/lib/repositories/accommodationRepo.ts`: create (upsert), update (`planCheckOutScheduleInTransaction` and the push receipt), delete (the leg sweep across all trip days).
- `travelplan/src/lib/repositories/travelSegmentRepo.ts`: create, update and delete with leg receipts. `readDrawnSegmentKeysInTransaction`, `buildStoredSegmentPairKey`, `buildSegmentTimelineInTransaction`.
- `travelplan/src/lib/repositories/dayPlanChangeRepo.ts`: `findInvalidity`, `undoInTransaction` phases, `isInsideTripUploadTree`, `restorePayments`.
- `travelplan/src/lib/trips/dayChangeReceipt.ts` + `src/lib/validation/dayChangeReceiptSchemas.ts`: the types, `mapReceipt`, the strict schemas (payment rows are activity-only today).
- `travelplan/src/lib/repositories/aiChangeRepo.ts`, `src/lib/mcp/tools/aiChanges.ts`, `src/components/features/trips/AiChangesNotice.tsx`, `src/i18n/en.ts` and `de.ts`: actions and labels.
- `travelplan/src/lib/repositories/connectorReadRepo.ts`: add `findStayForPlanner` (the stored stay of a day plus its payments and the day's date, writer-scoped) and `findLegForPlanner` (a stored leg of the trip, writer-scoped). `readDayPlanContextForWriter` is in `dayPlanApplyRepo.ts`.
- `travelplan/src/lib/rates/exchangeRateService.ts` (`getEcbRates`, `ECB_CURRENCIES`, `ExchangeRateError`), `src/lib/trips/convertCost.ts` (`convertEntryToCents`).
- `travelplan/src/lib/validation/{accommodationSchemas,travelSegmentSchemas,dayPlanItemSchemas,bucketListSchemas}.ts`: the app schemas the tools reuse.
- `travelplan/src/lib/mcp/server.ts`: tool registration.
- `travelplan/src/app/api/trips/[id]/route.ts` (travelSegments mapping, 2×), `src/components/features/trips/TripDayView.tsx` (`renderTravelSegment`, the `travelSegments` type).
- Tests: `test/mcpActivityWriteTools.test.ts`, `test/mcpDayPlanApply.test.ts` (patterns), `test/helpers/{mcpClient,oauthFixtures,plannerFixtures}.ts`, `test/exchangeRateService.test.ts` (ECB stub), `test/dayChangeReceipt*.test.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/trips/dayChangeReceipt.ts`: add `StayRow`, `StayPaymentRow` (`CostPaymentRow` already allows a stay payment), `StaySnapshot` and `DeletedStaySnapshot`, the three kinds, their `mapReceipt` cases, and the doc comment.
- [x] `src/lib/validation/dayChangeReceiptSchemas.ts`: a stay payment row schema (`accommodationId` id, `dayPlanItemId` null), stay row, image and document schemas, and the three strict kinds (`nextDayLegs` ≤ `MAX_LEGS`).
- [x] `src/lib/repositories/dayPlanChangeRepo.ts`: `findInvalidity` and undo phases 1, 2 and 3 for the three kinds. Update the doc comment.
- [x] `src/lib/repositories/travelSegmentRepo.ts`: `expectedUpdatedAt` and `inTransaction` on the three writes.
- [x] `src/lib/repositories/accommodationRepo.ts`: the connector options and receipts on create, update and delete. Delete partitions the removed legs by drawn-before on the stay's day and the next day.
- [x] `src/lib/trips/writeOrigin.ts`: `InTransactionHook`'s doc says `itemId` is the targeted row (activity, stay or leg).
- [x] `src/lib/repositories/connectorReadRepo.ts`: `findStayForPlanner` and `findLegForPlanner`.
- [x] `src/lib/mcp/costInput.ts` (new): the cost field schema, `costDeps`, and `resolveCost(cost, {dueDateDefault}) → {fields} | {refusal}`, which converts and refuses as above.
- [x] `src/lib/mcp/tools/activityWrite.ts`: `cost` and `link` on `create_activity` and `update_activity` (day and bucket), updated descriptions, and the "changing" check including them.
- [x] `src/lib/mcp/tools/stayWrite.ts` (new): `set_stay` and `delete_stay`. `src/lib/mcp/tools/legWrite.ts` (new): `create_leg`, `update_leg` and `delete_leg`. Register both in `server.ts`, with destructive annotations on update and delete.
- [x] `src/lib/repositories/aiChangeRepo.ts`, `tools/aiChanges.ts`, `AiChangesNotice.tsx`, `en.ts` and `de.ts`: the six actions.
- [x] `src/app/api/trips/[id]/route.ts`, `TripDayView.tsx`: leg `aiChangedAt` and the badge.
- [x] Tests, new: `test/mcpStayWriteTools.test.ts`, `test/mcpLegWriteTools.test.ts`, `test/mcpCostInput.test.ts`.
  - every matrix row, for owner and contributor
  - the stale undo
  - the notice labels
  - extend the receipt tests with the round-trip and invalidity of the stay kinds
  - extend a day-view test with the leg badge

**Acceptance Criteria:**
- Given any successful new write, then exactly one `ai_changes` row exists for it, in the same transaction. The created or edited stay or leg has `aiChangedAt` set, and rows only shifted by a recompute keep theirs.
- Given an app (`origin: "user"`) edit of a marked stay or leg, then its badge is gone. App routes answer exactly as before.
- Given the full suite, then typecheck, lint (no new warnings over the baseline of 80), all tests, `check:migrations` and the build pass.

## Spec Change Log

## Review Triage Log

### 2026-10-29 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 8 (high 0, medium 2, low 6)
- defer: 0
- reject: 13 (high 0, medium 3, low 10)
- addressed_findings:
  - `[medium]` `[patch]` `update_leg` mapped the repository's `missing` to "changed since you read it". That result also means an endpoint is gone, so the model would retry forever. It now re-reads the leg: if the stamp is unchanged, it answers "no longer connects two entries … delete it with delete_leg".
  - `[medium]` `[patch]` Stay and leg writes stored an unstorable receipt as `null`, so a delete of a stay with an external image had no undo. `set_stay`, `delete_stay`, `update_leg` and `delete_leg` now pass `requireReceipt` and refuse with a clear message, writing nothing.
  - `[low]` `[patch]` The `set_stay` description now says that only changing an existing stay's check-out recomputes the next day. Creating a stay does not, as in the app.
  - `[low]` `[patch]` `expectNoStay` used an upsert, which could overwrite a stay created concurrently. It now uses `create`, and `P2002` maps to `ChangedSinceReadError`.
  - `[low]` `[patch]` `update_leg` to car without a distance now answers "A car leg needs distanceKm; give it." instead of a generic schema message.
  - `[low]` `[patch]` A `convertEntryToCents` residual error is now a clear refusal, not the generic error.
  - `[low]` `[patch]` A foreign cost that converts to 0 cents or more than 100,000,000 cents is refused with a message about the conversion.
  - `[low]` `[patch]` `findInvalidity` (`stayDeleted`) now requires next-day legs to leave from the stay and removed legs to reference it.

## Design Notes

- **The ECB conversion is on the server here.** The dialogs convert in the browser; the connector has no browser, so it fetches the same rates (`getEcbRates`, cached for 30 minutes) and runs the same pure `convertEntryToCents`. The stored shape is therefore identical, and the app's `refineCostCurrency` re-checks it.
- **Stay receipts are connector-only.** The app's stay routes keep returning what they return today (`stayCheckOutChanged` or nothing), so the client-held receipts do not change.
- **`stayUpdated` lives on the pushed day when there was a push.** That follows the `stayCheckOutChanged` precedent: `movedItems` must sit on `receipt.tripDayId` for the shared phases. Phase 1 proves that day is the stay's day or the day after it.
- **The legs a stay delete takes span two days.** On the stay's day (into tonight's stay) they go in the generic `removedTravelSegments`; on the next day (out of last night's stay) they go in `nextDayLegs`, restored and checked by the kind's own branch. A leg already undrawn before the delete (old orphan rows on any day) is still deleted, as the app does, but not recorded: restoring it would fail the "restored legs are drawn" post-condition and make every such undo stale.
- **Restoring a stay cannot orphan another leg.** On its own day it comes back last, and on the next day first; a leg can only start or end at an entry that exists. So the protected-legs rule needs no next-day extension.
- **Create never upserts over a stay.** The app's create is an upsert. The connector passes `expectNoStay`, so a stay that appeared between the read and the write refuses as "changed since you read it" instead of being overwritten without an undo.

## Verification

**Commands (in `travelplan/`):**
- `npm run typecheck`: expected clean.
- `npm run lint`: expected 0 errors and ≤80 warnings.
- `npx vitest run test/mcpStayWriteTools.test.ts test/mcpLegWriteTools.test.ts test/mcpCostInput.test.ts test/mcpActivityWriteTools.test.ts test/mcpDayPlanApply.test.ts`: expected pass.
- `npm test && npm run check:migrations && npm run build`: expected pass.

## Auto Run Result

Status: done

**Summary:** Connector tools for stays (`set_stay`, `delete_stay`) and legs (`create_leg`, `update_leg`, `delete_leg`). `create_activity` and `update_activity` gain `cost` (EUR or an ECB currency, converted on the server with `convertEntryToCents`, with payment schedules) and `link`. The new receipt kinds `stayCreated`, `stayUpdated` and `stayDeleted` are in the type, schema, `findInvalidity` and the three undo phases. There are six new `ai_changes` actions with notice labels in en and de, and the KI/AI badge on legs in the day view.

**Files** (under `travelplan/`):
- New:
  - `src/lib/mcp/costInput.ts`: cost input, ECB conversion, refusals
  - `src/lib/mcp/tools/stayWrite.ts`, `legWrite.ts`: the tools
  - `test/helpers/connectorWriteFixtures.ts`
  - tests `mcpStayWriteTools`, `mcpLegWriteTools`, `mcpCostInput`
- Repositories:
  - `accommodationRepo.ts`, `travelSegmentRepo.ts`: connector options (`expectNoStay`, `expectedUpdatedAt`, `inTransaction`) and receipts
  - `connectorReadRepo.ts`: `findStayForPlanner`, `findLegForPlanner`
  - `tripRepo.ts`: leg `aiChangedAt`
- Receipts and undo: `dayChangeReceipt.ts`, `dayChangeReceiptSchemas.ts`, `dayPlanChangeRepo.ts`, `writeOrigin.ts` (doc)
- Tools: `activityWrite.ts` (cost and link), `dayPlanApply.ts` (shared helpers), `aiChanges.ts`, `aiChangeRepo.ts`, `server.ts`
- UI: `AiChangesNotice.tsx`, `TripDayView.tsx` (leg badge), `en.ts`/`de.ts`, `api/trips/[id]/route.ts`
- Existing tests extended: `dayChangeReceipt`, `mcpRoute`, `tripDayViewAiChanges`, `tripDetailRoute`

**Review:** 8 patched (2 medium, 6 low), 0 deferred, 13 rejected. The rejected ones include:
- old undrawn legs not restored after a stay delete (by design, see Design Notes)
- stored link, notes and times re-validated on an edit
- a label-only location
- decimals in JPY
- a zero ECB rate
- no media check in the `stayUpdated` undo (parity with `updated`)
- the notice listing a pushed-day change on the stay's day
- duplicated reads

**Follow-up review recommended:** false. The fixes are localized; most only add refusals, and each has a test.

**Verification** (in `travelplan/`):
- `npm run typecheck`: clean.
- `npm run lint`: 0 errors, 80 warnings (the baseline).
- `npm test`: 252 files, 3993 passed.
- `npm run check:migrations`: passed.
- `npm run build`: succeeded.

**Residual risks:**
- Stay deletes drop old undrawn legs without undo.
- The ECB fetch adds latency to foreign-currency writes, cached for 30 minutes.
- Production acceptance in Claude is Tommy's manual step.
