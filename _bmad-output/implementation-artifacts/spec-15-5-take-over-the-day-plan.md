---
title: 'Story 15.5: Take Over the Day Plan'
type: 'feature'
created: '2026-10-29'
status: 'done'
baseline_revision: '39e119a'
final_revision: 'b6def93'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-15-context.md'
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** After planning a day with Claude, the connector can only write it activity by activity (15.4): many calls, many `ai_changes` entries, and no single step to take the whole plan back.

**Approach:** One connector tool, `apply_day_plan(tripId, dayId, mode, activities[], legs?)`, writes a whole day in one transaction through a new repository function:
- `append` adds after the day's last activity.
- `replace` first deletes the day's activities and their legs.

The day is recomputed once. The call is stored as one `ai_changes` row with a new receipt kind `dayPlanApplied`, which undoes it in one step from the app or the tool.

## Boundaries & Constraints

**Always:**
- **Activities** (1..50), each with:
  - title (≤120) and description (Markdown → editor JSON through `markdownToTiptapDoc`, default the title)
  - `mode` flexible (duration, default 15) or fixed (`startTime` plus `endTime` or `durationMinutes`, ending by 23:59)
  - place: name only → geocoded through `activityWriteDeps.geocode`; given lat/lng are used as they are
  - `link` (http/https) and `costEur` (EUR amount, ≥0, at most 2 decimals). A cost is stored as `costCents` plus one payment of the full amount due on the day's date, which is the dialog's default.
- **Validation:** every entry is validated with the app's `dayPlanItemMutationSchema` before any geocoding, routing or write. A refusal names the 1-based entry, e.g. `Activity 3 ("Louvre"): …`, and nothing is written.
- **Legs:** `legs?: [{toActivity (1-based), mode ∈ TRANSPORT_TYPES, durationMinutes?, distanceKm?, link?}]`.
  - Leg n goes from activity n-1 to activity n.
  - For n = 1 it goes from the entry before the first new one: the day's last activity in `append`, last night's stay otherwise. With nothing there, the leg is skipped.
  - A missing duration or distance is computed like the leg dialog's route preview: `getDayRouteFromOsrm` for car, walking or cycling between two points with coordinates, converted with `legFromOsrm`.
  - When the leg still has no duration (routing failed, another mode, no coordinates), or is a car leg without a distance, it is **not created** and is reported in `skippedLegs` with a reason. The activities are still written.
  - Distance given for ship or flight, a duplicate `toActivity` or one out of range → invalid input, nothing written.
- **The transaction**, with the writer clause on the day:
  1. `replace`: delete each activity through `deleteDayPlanItemInTransaction`. That deletes the referencing legs and sweeps, and snapshots the activity with its payments, images and documents. Files stay on disk (DW-187).
  2. Read the schedule state. If the first leg's `from` entry is not the one routed before the transaction, throw `DayPlanChangedError`.
  3. Plan once through `planDaySchedule` with an extended `append` edit that places each FIXED item by its start (`placeFixedItem`), in input order. That is the same placement as a single create; Epic 12's all-FLEXIBLE appends are unchanged.
  4. Create the rows with the planned times and `sortOrder` (`aiChangedAt` from `origin`), and their payments.
  5. `applyScheduleChangesInTransaction`, then the sweep.
  6. Create each leg only where the final timeline draws its pair. An undrawn leg is reported in `skippedLegs`.
  7. Build the receipt and run the hook last.
- **Receipt:** `dayPlanApplied {mode, items:[{itemId,updatedAt}], segments:[{segmentId,updatedAt}], deletedItems: DeletedDayPlanItemSnapshot[]}`.
  - The legs deleted with the activities and every swept leg go into `removedTravelSegments`, as full rows.
  - It stays version 3, and every exhaustive switch covers the kind (map, schema, `findInvalidity`, undo).
- **Undo** (`dayPlanChangeRepo`):
  - Phase 1 refuses as stale when:
    - a created row or leg is gone or has a new stamp
    - a created activity gained an image, a document or a leg the plan did not create
    - a deleted id exists again
  - Phase 2, in order:
    - deletes the created legs, then the created activities
    - recreates each deleted activity from its snapshot with `tripId`, and its payments, images and documents
    - then restores the moved items and the removed legs, which the post-condition checks
  - `findInvalidity` checks:
    - the snapshots are on the receipt's day, and their payments, media and upload paths belong to them, as for `deleted`
    - no created id appears in `movedItems` or among the deleted ids
    - there are no duplicates
    - no leg is both created and removed
- **`ai_changes`:** action `planAppended` or `planReplaced`. Its `subject` is the new titles joined by ", ", capped at 120 characters with "…". The app's notice shows "Day plan added: {title}" / „Tagesplan ergänzt: {title}" and "Day plan replaced: {title}" / „Tagesplan ersetzt: {title}". `list_ai_changes` gives an English summary.
- **Result:** `{aiChangeId, mode, activityIds (input order), deletedActivityCount, legsCreated, skippedLegs:[{toActivity, reason}], day}`. `day` is the `get_day` shape with the FR47 warnings. An over-full day is saved, not refused.
- **Access:** `startWrite` (client id plus writer trip). A non-writable trip → `Trip not found`; a day not on the trip → `Day not found`. Errors are short and give no internals.

**Block If:** none. The open choices are decided in Design Notes.

**Never:**
- touching `sprint-status.yaml`
- Prisma in tools
- foreign-currency costs or payment schedules (15.6)
- legs into tonight's stay
- writing several days in one call
- files or images
- changing Epic 12 behaviour
- logging argument contents

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Append | day3 empty, 3 flexible + 1 fixed 18:00, legs into 2 and 3 with given durations | 4 rows marked, fixed placed by time, 2 legs, one `ai_changes` (`planAppended`) | — |
| Replace + undo | day2 (museum, dinner + doc/img, overflow walk, 3 legs) replaced by 2 activities | old rows and legs gone, new ones there; `undo_ai_change` restores `get_day` exactly (ids, times, order, legs, media, cost) | stale if a new row was edited since |
| Leg computed | walking leg without duration, both places with coordinates | route stub answers → leg with rounded minutes/km | — |
| Routing fails | car leg without duration, router throws | activities written, leg in `skippedLegs`, day without that leg | — |
| Over-full | flexible activities past 23:59, fixed overlap | saved; flexible overflow without times; warnings returned | — |
| Invalid entry | 51 activities / fixed without end or duration / unknown mode | nothing written, no `ai_changes`, the message names the entry | — |
| Viewer | any call | `Trip not found` | — |

</intent-contract>

## Code Map

- `travelplan/src/lib/repositories/daySuggestionApplyRepo.ts`: the closest model. It plans through `planSuggestionAppend` and `planDaySchedule` "append", creates rows, applies changes, sweeps, creates only the drawn legs, and builds the receipt.
- `travelplan/src/lib/repositories/dayScheduleTransaction.ts`: `planDaySchedule` (extend `append` to place FIXED), `applyScheduleChangesInTransaction`, `buildReceipt`, `toPlanConflicts`, `DayPlanChangedError`.
- `travelplan/src/lib/repositories/dayPlanItemRepo.ts`:
  - `deleteDayPlanItemInTransaction` (:580)
  - `scheduleFieldsOf` (:491), private; export it for the FIXED start+duration → end rule
- `travelplan/src/lib/repositories/dayPlanChangeRepo.ts`: `findInvalidity`, `checkSuggestionsAppliedInTransaction`, the `undoInTransaction` phases and `restorePayments`.
- `travelplan/src/lib/trips/dayChangeReceipt.ts` + `src/lib/validation/dayChangeReceiptSchemas.ts`: the types, `mapReceipt`, the strict schema and `receiptHasSideEffects`.
- `travelplan/src/lib/repositories/aiChangeRepo.ts` (`AiChangeAction`), `src/lib/mcp/tools/aiChanges.ts` (`SUMMARIES` and the description), `src/components/features/trips/AiChangesNotice.tsx` (`ACTION_KEYS`).
- `travelplan/src/lib/mcp/tools/activityWrite.ts`: the 15.4 helpers to export and reuse: `startWrite`, `isCaller`, `recordChange`, `resolvePlace`, `placeField`, `activityFields`, `writeErrorResult`, `activityWriteDeps`.
- `travelplan/src/lib/routing/dayRouteService.ts` (`getDayRouteFromOsrm`), `src/lib/trips/suggestionPlan.ts` (`SUGGESTION_MODE_ROUTING`, `legFromOsrm`), `src/lib/trips/transportTypes.ts`, `src/lib/validation/travelSegmentSchemas.ts`.
- `travelplan/src/lib/repositories/connectorReadRepo.ts` + `plannerShapes.ts`: day read for the result.
- Tests: `test/mcpActivityWriteTools.test.ts` (pattern), `test/helpers/{mcpClient,oauthFixtures,plannerFixtures}.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/repositories/dayScheduleTransaction.ts`: in the `append` edit, place each FIXED item with a readable start by `placeFixedItem` as it is added. Update the doc comment.
- [x] `src/lib/repositories/dayPlanItemRepo.ts`: export `scheduleFieldsOf`.
- [x] `src/lib/trips/dayChangeReceipt.ts`: add the `dayPlanApplied` kind, its `mapReceipt` case and `receiptHasSideEffects`. Extend the doc comment.
- [x] `src/lib/validation/dayChangeReceiptSchemas.ts`: the strict schema of the kind. `items` 1..50, `segments` ≤50, `deletedItems` ≤1000, `mode` enum.
- [x] `src/lib/repositories/dayPlanChangeRepo.ts`: `findInvalidity`, phase 1 and phase 2 for the kind, with the created legs added to `receiptLegIds`.
- [x] `src/lib/repositories/dayPlanApplyRepo.ts` (new): `applyDayPlanForTripDay({userId, tripId, tripDayId, mode, activities, legs, firstLegFromId, origin, inTransaction?})`. It returns `{receipt, itemIds, deletedCount, legsCreated, skippedLegs}` or `null` when the day is not the writer's. It also exports `readDayPlanContextForWriter` (the day's date, last activity and its point, and last night's stay and its point) for the tool's routing.
- [x] `src/lib/repositories/aiChangeRepo.ts`, `tools/aiChanges.ts`, `AiChangesNotice.tsx`, `src/i18n/en.ts` + `de.ts`: the actions `planAppended` and `planReplaced`.
- [x] `src/lib/mcp/tools/activityWrite.ts`: export the shared helpers. `src/lib/mcp/tools/dayPlanApply.ts` (new): the `apply_day_plan` tool (destructive annotations) and `dayPlanApplyDeps.route`. Register it in `server.ts`.
- [x] `test/mcpDayPlanApply.test.ts` (new): the matrix rows.
  - owner and contributor
  - append, including a fixed placed by time and the markers
  - replace, then undo restoring `get_day` exactly
  - a leg computed by the route stub, and a routing failure that skips the leg
  - over-full warnings
  - invalid entries (count, fixed without end, unknown mode, distance on a flight) writing nothing
  - a viewer
  - a stale undo
  - the notice label
- [x] `test/dayScheduleTransaction*` or an existing receipt test: the `append` placement of a FIXED item, the `dayPlanApplied` wire round-trip, and the invalidity cases.

**Acceptance Criteria:**
- Given a successful `apply_day_plan`, then exactly one `ai_changes` row exists for it, in the same transaction. Every created activity and leg has `aiChangedAt` set, and rows only shifted by the recompute keep theirs.
- Given `replace` then `undo_ai_change` (or the app's undo route), then `get_day` equals its pre-apply answer (ids, times, order, legs, media, cost, markers) and the change is marked undone.
- Given the full suite, then typecheck, lint (no new warnings over the baseline of 80), all tests and the build pass.

## Spec Change Log

## Review Triage Log

### 2026-10-29 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 10 (high 0, medium 3, low 7)
- defer: 0
- reject: 6 (high 0, medium 1, low 5)
- addressed_findings:
  - `[medium]` `[patch]` Name-only places were looked up one by one with no cap. At up to 50 s of the server-wide Nominatim slot, other users' lookups were blocked and the call could outlive the client, so a retry would duplicate the plan. Now at most 10 distinct names per call are allowed, refused before any lookup, and each distinct name is looked up once.
  - `[medium]` `[patch]` A replace whose receipt failed the stored schema (for example a legacy document URL) was committed with `receiptJson = null`: the whole day deleted with no undo. It now refuses: `insertAiChangeInTransaction` takes `requireReceipt` and throws `UnstorableReceiptError` inside the transaction, and the tool answers with a clear error. Nothing is written.
  - `[medium]` `[patch]` The undo ran under Prisma's 5 s default while the apply had 30 s. The undo transaction now gets 30 s too.
  - `[low]` `[patch]` `costEur` had no upper bound and could overflow the 32-bit cents column with a generic error. It is now capped at 1,000,000 by the input schema.
  - `[low]` `[patch]` Undoing a replace after a person had added an activity to the day restored the old rows beside it, with a clashing order. It is now refused as stale.
  - `[low]` `[patch]` A walking or cycling leg that had its duration was routed just for its optional distance. A route is now requested only for a missing duration or a car's required distance.
  - `[low]` `[patch]` The subject cap cut by UTF-16 unit and could split an emoji. It now cuts by code point.
  - `[low]` `[patch]` `findInvalidity` now refuses an `append` receipt that carries `deletedItems`.
  - `[low]` `[patch]` Added tests: the geocode cap and dedupe, the cost bound, the unrouted walking leg, refusing an unstorable replace receipt, a stale undo after an added activity, and undoing an append whose fixed activity was placed before existing rows (plus the forged append receipt).
  - `[low]` `[patch]` Found while testing: `get_day` ordered legs by `createdAt` only, so a leg an undo recreated could read in another position when stamps tied. An `id` tiebreak was added in `connectorReadRepo`.

### 2026-10-29 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 3 (high 0, medium 2, low 1)
- defer: 0
- reject: 18 (high 0, medium 2, low 16)
- addressed_findings:
  - `[medium]` `[patch]` A replace whose deleted activities hold an image stored as an external address passed the stored-receipt schema but not the undo's `findInvalidity`. So the whole day was deleted and the undo then refused it as invalid. With `requireReceipt`, `insertAiChangeInTransaction` now also runs `findInvalidity` (exported) for the trip and throws `UnstorableReceiptError`, so nothing is written.
  - `[medium]` `[patch]` Leg routing had no cap: up to 50 sequential OSRM calls at a 3.5 s timeout, so the client could give up and retry a write that still landed. Now at most 10 legs are routed per call. Past that, a leg without its duration is skipped with the reason "only 10 legs are routed per call; give durationMinutes for the others", and the activities are still written.
  - `[low]` `[patch]` The unstorable-receipt refusal told an `append` to "use mode append". The text is now per mode.

## Design Notes

- **Cost is EUR only here.** Foreign currency with ECB conversion and payment schedules are 15.6's. One payment due on the day's date satisfies the app's rule that "payments are required when cost is set", exactly as the dialog's default row does.
- **A leg without a duration is skipped, not stored.** A stored leg needs a positive duration (and a car leg a distance), so "falling back to no duration" means no leg. The day is then scheduled without it, as Epic 12 does for an unknown leg. Skipping it keeps a good plan from failing on a flaky router.
- **Replace reuses the delete path** (`deleteDayPlanItemInTransaction`). Its removed legs go into `removedTravelSegments`, so the existing phase 2 and post-condition restore and check them. Only the activity snapshots need a new field.
- **Routing happens before the transaction** (no network I/O inside SQLite). The first leg's `from` id is passed in, and the transaction refuses with `DayPlanChangedError` when the day changed under it. The tool maps that to "The day changed while this was being saved; …".
- **The order is sequential-create semantics:** flexible activities are appended in input order, and fixed ones are placed by start time among what is there. That matches N single `create_activity` calls, recomputed once.

## Verification

**Commands (in `travelplan/`):**
- `npm run typecheck`: expected clean.
- `npm run lint`: expected 0 errors and ≤80 warnings.
- `npx vitest run test/mcpDayPlanApply.test.ts test/mcpActivityWriteTools.test.ts test/dayChangeReceipt.test.ts test/suggestionsApplyUndo.test.ts`: expected pass.
- `npm test && npm run build`: expected pass.

## Auto Run Result

Status: done

**Summary:** This was a follow-up review pass on Story 15.5 (`apply_day_plan`). The code was already implemented and reviewed. Blind Hunter and Edge Case Hunter reviewed the full diff since `39e119a` again. Three findings were patched; nothing was deferred.

**Files changed in this pass** (under `travelplan/`):
- `src/lib/repositories/dayPlanChangeRepo.ts`: `findInvalidity` is now exported.
- `src/lib/repositories/aiChangeRepo.ts`: with `requireReceipt`, a receipt that the undo would refuse as invalid for the trip now throws `UnstorableReceiptError`.
- `src/lib/mcp/tools/dayPlanApply.ts`: `MAX_ROUTED_LEGS = 10`, with the skip reason `ROUTE_CAP_REACHED`. The unstorable-receipt message is now per mode, and the tool description mentions the cap.
- `test/mcpDayPlanApply.test.ts`: two tests. A replace of a day holding an external image writes nothing. A plan with 12 unrouted walking legs routes 10 and skips 2 with the reason.

**Review:** 3 patched (2 medium, 1 low), 0 deferred, 18 rejected. The rejected ones include:
- the 30 s write lock and the O(n) deletes on replace (accepted earlier)
- orphaned files (DW-187)
- leg duration and distance without an upper bound: the app's leg schema has none, and an overflow rolls back
- a zero-distance route reported as "could not be computed"
- subject graphemes and commas
- `costEur: 0`
- the duplicated "last night's stay" read
- the widened export surface of `activityWrite`
- the FIXED placement in the shared `append` edit (by design, pinned by tests)
- a `readDay` error after commit (the same pattern as 15.4)
- a forged `movedItems` on a replace receipt
- test-coverage wishes

**Follow-up review recommended:** false. There are two localized medium fixes. Both only add refusals (nothing is written in more cases) or skip extra routing, and each has a test.

**Verification** (in `travelplan/`):
- `npm run typecheck`: clean.
- `npm run lint`: 0 errors, 80 warnings (the baseline).
- `npm test`: 249 files, 3949 passed.
- `npm run check:migrations`: passed.
- `npm run build`: succeeded.

**Residual risks:**
- Replacing a day that holds an orphaned leg deletes it with its activity, and the undo then refuses as stale.
- A large replace holds SQLite's write lock for its whole transaction.
- Production acceptance (plan a day in Claude, see it in the app, undo it) is still Tommy's manual step.
