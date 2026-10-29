---
title: 'Story 15.4: Claude Plans Activities, Marked and Undoable'
type: 'feature'
created: '2026-10-29'
status: 'done'
baseline_revision: 'dd9e9e7'
final_revision: 'd0bdcc7'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-15-context.md'
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** The connector can read trips (15.2) but cannot write them. Receipts for undo are only held by the browser, so a connector write would be impossible to undo. No row records that an AI changed it, so the user cannot trust a plan Claude edits.

**Approach:**
- Add a nullable `aiChangedAt` column to activities, stays, legs, documents and images.
- Add a required `origin: "user" | "ai"` to every repository function that creates or edits those rows.
- Store connector receipts server-side in a new `ai_changes` table, written in the write's own transaction.
- Extract the undo route's logic into one undo core with three callers: the UI receipt route, a new app route for AI changes, and a tool.
- Ship nine activity tools: `create_activity`, `update_activity`, `delete_activity`, `move_activity`, `move_activity_to_day`, `park_activity`, `schedule_activity`, `list_ai_changes` and `undo_ai_change`.
- In the app, show a *KI*/*AI* badge on marked entries and an *AI changed this day* notice with *Undo*.

## Boundaries & Constraints

**Always:**
- **Origin parameter:**
  - Every exported repository function that **creates or edits** a DayPlanItem (day or parked), Accommodation, TravelSegment, item/stay image or item/stay document row takes a required `origin: WriteOrigin` (no default, no optional).
  - `"ai"` sets `aiChangedAt = now` on the targeted rows: the created row, the edited row, the moved/parked/scheduled activity, or the rows a day transfer moved.
  - `"user"` sets `aiChangedAt = null` on them.
  - Rows only shifted or renumbered by the recompute (`applyScheduleChangesInTransaction`, `renumberDayInTransaction`, `recomputeDayInTransaction`) keep their value.
  - Pure deletes and media-order changes take no origin.
  - Every UI route and Epic 12 apply passes `"user"`.
- **Receipts carry the marker:**
  - `aiChangedAt` (ISO or null, required key) is in the item, leg, image and document row snapshots of receipts.
  - `previousAiChangedAt` (required, nullable) is added to the `scheduled` and `reordered` kinds and to `parked.previous`, so undo restores the marker. The receipt stays at version 3.
  - Older client-held receipts fail the strict parse and show "undo unavailable", as after Epic 14.
- **Recording and staleness:**
  - A connector write and its `ai_changes` row commit in one transaction (an in-transaction hook on the repository function). The `updatedAt` check for `update_activity`/`delete_activity` runs inside that transaction.
  - Writes the app cannot undo (create, edit or delete of a parked activity) store `receiptJson = null`.
- **Same path as the app:**
  - Tools call the same repository function as the matching UI route, so recompute, push, sweep, warnings and validation (title ≤ 120, duration 5..1439, `HH:MM`, fixed needs start + end or duration, the end must not pass 23:59) behave exactly as in the app.
  - Tool input validation reuses the bounds exported from `dayPlanItemSchemas.ts`.
- **Access:** a non-writable trip, or an activity or change outside a writable trip, answers `Trip not found`, `Activity not found` or `AI change not found`, never "forbidden".
- **Undo rules:**
  - Undo from the app is allowed for any owner or contributor of the trip and is CSRF-checked. Undo through the tool is allowed for any writer of the trip.
  - Both use the same core and the unchanged stale rule (409 `undo_stale`).
  - A successful undo sets `undoneAt` in the same transaction, conditional on it being null.
- **Retention:** entries older than 14 days are deleted whenever a new entry is written. Every read and undo also ignores rows older than 14 days.
- **Strings:** every new UI string goes in `en.ts` and `de.ts`. Tool descriptions are in English and name their units.

**Block If:** none. The open design choices are decided in Design Notes.

**Never:**
- Touching `sprint-status.yaml`.
- Prisma calls in tools or routes.
- Exporting `aiChangedAt` in backups.
- Cost, payment, link, stay, leg or file write tools (15.6, 15.7).
- `apply_day_plan` (15.5).
- Badges on legs, documents and images (15.6 and 15.7 add them with their writes).
- Changing Epic 12 behaviour or the client-held receipt signing.
- Logging tool argument contents.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Create on day | `create_activity` with flexible duration 90 and place `{name:"Louvre"}` | Geocoded, appended, day recomputed, row `aiChangedAt` set, one `ai_changes` row (action `created`, receipt `created`). Returns `{aiChangeId, activity, day:{activities[order,times], warnings}}` | Geocoder finds nothing → error asking for lat/lng, nothing written |
| Create parked | no `dayId` | Bucket-list activity, `ai_changes` row with `tripDayId` and `receiptJson` both null | — |
| Update stale | `updatedAt` older than the row | Nothing written | "This activity changed since you read it; read it again with get_day or get_bucket_list and retry with the new updatedAt." |
| Update partial | only `title` given | Other fields (times, place, description, cost, payments, link) kept. Marker set | — |
| UI edit after AI | PATCH from the dialog | `aiChangedAt` → null, badge gone | — |
| Undo from app | POST `/api/trips/{id}/ai-changes/{cid}/undo` as a contributor who did not connect | 200, day restored including the marker, `undoneAt` set, entry leaves the notice | CSRF → 403. Viewer or foreign → 404. Undone → 409 `already_undone`. No or unparseable receipt → 400 `undo_unavailable`. Stale → 409 `undo_stale`, notice shows the stale text |
| Undo by tool | `undo_ai_change(cid)` | Same core and result | The same four cases as short tool errors |
| Move to day | `move_activity_to_day(activityId, dayId)` | Park on the source day, then schedule onto the target, as the app's two steps. Two entries (`parked`, `scheduled`); returns both ids | If the park succeeds but the schedule fails, the error says the activity is now in the bucket list |
| Viewer | any tool on a viewer-only trip | `Trip not found` | — |
| Expired | entry is 15 days old | Not listed, undo → not found, deleted on the next insert | — |

</intent-contract>

## Code Map

- `travelplan/prisma/schema.prisma` + new `prisma/migrations/20261029180000_add_ai_changes/`: `aiChangedAt DateTime? @map("ai_changed_at")` on `DayPlanItem`, `Accommodation`, `TravelSegment`, `DayPlanItemImage`, `DayPlanItemDocument`, `AccommodationImage` and `AccommodationDocument`, plus the new `AiChange` model.
- `travelplan/src/lib/repositories/{dayPlanItemRepo,bucketListRepo,accommodationRepo,travelSegmentRepo,daySuggestionApplyRepo}.ts`: the write functions that get `origin` and the hook. Helpers: `finishActivityWriteInTransaction` (:510) and `toReceiptRow` (:408, copies full rows into receipts).
- `travelplan/src/lib/repositories/dayPlanChangeRepo.ts`: `undoDayPlanChangeForTrip` (:629) and `undoInTransaction`. The explicit column lists in the `scheduled`, `parked` and moved-item restores (~:513, :532, :581); `itemColumns` spreads snapshots.
- `travelplan/src/lib/repositories/dayScheduleTransaction.ts`: `ScheduleEdit` and `planDaySchedule` (for move-to-position), `buildReceipt`, and `DayPlanChangedError`.
- `travelplan/src/lib/trips/dayChangeReceipt.ts` and `src/lib/validation/dayChangeReceiptSchemas.ts` (all `.strict()`): row types, `mapReceipt`, and the schemas `dayPlanItemColumns`, `travelSegmentRowSchema`, `imageRowSchema`, `documentRowSchema` and `parked.previous`.
- `travelplan/src/app/api/trips/[id]/day-plan-changes/undo/route.ts`: the post-commit file cleanup that moves into the shared undo core.
- `travelplan/src/lib/mcp/{server,toolRuntime,plannerShapes,verifier}.ts` and `tools/tripRead.ts`: tool registration pattern, `runTool` (handler gets only `userId`; `authInfo.clientId` is the client URL), `requireWritableTrip`, `toActivity`/`toBucketActivity`/`toPlannerDay`, and `idSchema`.
- `travelplan/src/lib/repositories/connectorReadRepo.ts`: `getPlannerDayForUser` explicit selects, where `aiChangedAt` gets added.
- `travelplan/src/lib/trips/planText.ts`: `plainTextToTiptapDoc` and `tiptapDocToPlainText`. The editor's extensions are in `TripDayPlanDialog.tsx`.
- `travelplan/src/lib/geocoding/nominatim.ts`: `searchNominatim` plus `nominatimThrottle.book`. See `src/lib/ai/verifySuggestions.ts` for its use from the server.
- UI:
  - `src/components/features/trips/TripDayView.tsx`: `loadDay` field-by-field mapping (~:1081), activity title (~:4629), stay titles (~:4400 and ~:4740), and the day-change notice block (~:3990). Pill styles `timePillAssumedSx` are at ~:2505.
  - `TripDayBucketListPanel.tsx` (:137) and `TripBucketListPanel.tsx` (:395).
  - The dialogs `TripDayPlanDialog.tsx` and `TripAccommodationDialog.tsx`, and `src/components/ui/DialogShell.tsx` (title is a string only).
  - `src/components/ui/ActionNotice.tsx`.
- Data path to the client:
  - `tripRepo.getTripWithDaysForUser` (select ~:1148, mapper ~:1285).
  - `src/app/api/trips/[id]/route.ts`: GET and PUT both map the payload by hand.
  - `bucketListRepo` select/`toDetail` and the bucket route `toWire`.
- Tests: `test/helpers/{mcpClient,oauthFixtures,plannerFixtures,mockFetch,renderWithProviders}.ts(x)`, `test/mcpReadTools.test.ts` (pattern) and `test/tripDayViewDayChange.test.tsx` (notice pattern).

## Tasks & Acceptance

**Execution:**
- [x] `prisma/schema.prisma` + migration: add the seven `aiChangedAt` columns.
  - Add `model AiChange` (`ai_changes`) with: `id` cuid; `tripId` (Trip, Cascade); `tripDayId?` (TripDay, Cascade); `userId` (User, Cascade); `clientId String`; `action String`; `subject String?`; `receiptJson String?`; `createdAt @default(now())`; `undoneAt DateTime?`.
  - Indexes: `(tripId, tripDayId, createdAt)` and `(createdAt)`.
  - Run `npx prisma generate` and `npm run check:migrations`.
- [x] `src/lib/trips/writeOrigin.ts` (new): `WriteOrigin`, `aiChangedAtFor(origin, now)` and `ChangedSinceReadError`. Also the hook type `InTransactionHook = (tx, outcome: { receipt: DayChangeReceipt | null; itemId: string }) => Promise<void>`.
- [x] The repositories listed in the Code Map. Their tests and callers follow.
  - **Day items:** add `origin` to `createDayPlanItemForTripDay`, `updateDayPlanItemForTripDay`, `scheduleParkedDayPlanItemForTripDay`, `parkDayPlanItemForTripDay`, `reorderDayPlanItemForTripDay`, `moveDayPlanItemsBetweenTripDays`, `swapDayPlanItemsBetweenTripDays`, `createDayPlanItemImage` and `createDayPlanItemDocument`.
  - **Parked items:** add `origin` to `createParkedDayPlanItem` and `updateParkedDayPlanItem`.
  - **Stays and legs:** add `origin` to `createAccommodationForTripDay`, `updateAccommodationForTripDay`, `copyAccommodationFromPreviousNight`, `createAccommodationImage`, `createAccommodationDocument`, `createTravelSegmentForTripDay` and `updateTravelSegmentForTripDay`.
  - **Epic 12:** add `origin` to `applySuggestionsForTripDay`.
  - **Optional hook and staleness:** the activity create, update, delete, reorder, park and schedule functions and the parked create, update and delete functions take an optional `inTransaction?: InTransactionHook`, run last inside their transaction. Item update and delete and parked update and delete also take optional `expectedUpdatedAt?: Date`; a mismatch inside the transaction throws `ChangedSinceReadError`.
  - **Move to a position:** `reorderDayPlanItemForTripDay` also accepts `toIndex` (0-based, flexible activities only) as an alternative to `direction`. It yields one `reordered` receipt whose `movedItems` cover every row whose order or times changed, with `neighbourId` set to the row it now follows or precedes.
- [x] All UI routes calling these (`day-plan-items/**`, `day-activity-transfer`, `accommodations/**`, `travel-segments`, `bucket-list-items`, `days/[dayId]/suggestions/apply`): pass `origin: "user"`. Add `origin: "user"` to every direct test call.
- [x] `dayChangeReceipt.ts`, `dayChangeReceiptSchemas.ts`, `dayPlanChangeRepo.ts`: carry `aiChangedAt` and `previousAiChangedAt` through the types, the date mapping and the strict schemas. Restore them in the `scheduled`, `parked` and `reordered` undo writes.
  - `undoDayPlanChangeForTrip` gains an optional `inTransaction?: (tx) => Promise<void>` that runs after the reverse writes.
  - Confirm `toReceiptRow` passes the column through.
- [x] `src/lib/trips/dayChangeUndo.ts` (new, the undo core): `runDayChangeUndo({userId, tripId, receipt, inTransaction?})` calls the repo, then does the image-file cleanup moved out of the undo route. `day-plan-changes/undo/route.ts` uses it with unchanged behaviour.
- [x] `src/lib/repositories/aiChangeRepo.ts` (new):
  - `insertAiChangeInTransaction(tx, {...}) → id`, which also deletes rows older than 14 days.
  - `listAiChangesForTrip({tripId, tripDayId?, now})`, newest first, within 14 days.
  - `findAiChangeForTrip`.
  - `undoAiChange({userId, tripId, changeId, now})` → `undone | not_found | already_undone | unavailable | stale`. It parses the stored receipt with `dayChangeReceiptSchema` and runs `runDayChangeUndo` with the hook `updateMany({id, undoneAt:null}) → count 1` (otherwise it throws `UndoStaleError`).
- [x] `src/app/api/trips/[id]/ai-changes/route.ts` (GET `?tripDayId=`) and `.../ai-changes/[changeId]/undo/route.ts` (POST):
  - Session; CSRF on POST; the writer gate answers 404.
  - The list returns `{changes:[{id, action, subject, createdAt, undoable}]}`.
  - Status mapping as in the I/O matrix.
- [x] `src/lib/trips/planText.ts`: add `markdownToTiptapDoc(text)`.
  - Supports paragraphs, `-`/`*` bullet lists, `1.` ordered lists, `**bold**`, `*italic*` and `[text](https://…)` links. Everything else stays literal text.
  - Node and mark names must match the editor's extensions.
  - The output must pass `contentJsonSchema`.
- [x] `src/lib/mcp/toolRuntime.ts`: pass `{ clientId }` from `authInfo` as the handler's second argument. Add `WRITE_TOOL_ANNOTATIONS` and a destructive variant.
- [x] `src/lib/mcp/tools/activityWrite.ts` and `tools/aiChanges.ts` (new; register them in `server.ts`): the nine tools, each running under `runTool` and `requireWritableTrip`.
  - **Common:**
    - Find an activity by id within the trip (on a day or parked; a repo lookup).
    - Geocode `place.name` when `lat`/`lng` are absent.
    - Convert `description` with `markdownToTiptapDoc`.
    - Pass the hook that inserts `ai_changes` (`action` ∈ created, updated, deleted, moved, parked, scheduled; `subject` = activity title).
    - Map `ChangedSinceReadError` and `DayPlanChangedError` to short errors.
    - Return `{aiChangeId, activity, day}`: `day` comes from `getPlannerDayForUser` and holds the order, times and warnings. Parked results return the bucket shape and `day: null`.
  - **`update_activity`:** merges the provided fields over the stored row. Cost, payments and link pass through unchanged.
  - **`delete_activity` (parked):** removes files like the bucket route does.
  - **`list_ai_changes(tripId, dayId?)`:** returns id, dayId, action, subject, an English one-line summary, createdAt, undoneAt, undoable and the client host.
- [x] `src/lib/repositories/connectorReadRepo.ts`, `plannerShapes.ts`: add `aiChangedAt` (ISO or null) to activities, legs, stays and bucket activities in the read tools.
- [x] Data path to the UI: add `aiChangedAt` in `tripRepo` (select, type and mapper for items and the accommodation), in `api/trips/[id]/route.ts` (GET and PUT mapping), in `bucketListRepo` (select, `toDetail`, route `toWire`), in the `TripDayView` `loadDay` mapping and types, and in `bucketListItem.ts`. Verify the export code does not emit it.
- [x] `src/components/ui/AiBadge.tsx` (new, neutral pill from theme tokens, tooltip, `data-testid="ai-badge"`). Show it after the title on day activity cards, both stay cards, both bucket-list panels, and both dialog headers through a new `DialogShell` prop `titleAdornment` (kept outside the labelled h2).
- [x] `src/components/features/trips/AiChangesNotice.tsx` (new), mounted under the day-change notice in `TripDayView` for writers.
  - It fetches the list for the day on day load.
  - It shows one line, „KI hat diesen Tag geändert · N Änderungen", expandable to rows of localized summary + time + *Rückgängig*.
  - Undo POSTs with CSRF via the existing `ensureCsrfToken`, then reloads the list, the day and the bucket list.
  - A 409 `undo_stale` shows the stale text on that row. Rows without a receipt have no button.
- [x] `src/i18n/en.ts`, `de.ts`: `trips.aiBadge.label` / `tooltip`, `trips.aiChanges.*` (title, count, one per action with `{title}`, undo, stale, unavailable, error).
- [x] Tests (new files plus updates):
  - Every tool as owner and as contributor, and a viewer getting `Trip not found`.
  - Recompute parity: the same create through the tool and through the repo with `origin:"user"` on twin days gives the same order and times.
  - The marker is set by the tool and cleared by the PATCH route.
  - Undo from the app route (contributor), undo by the tool, a stale undo, an already-undone change, a change without a receipt, and 14-day expiry.
  - Concurrency refusal (stale `updatedAt`, nothing written).
  - Atomicity: when the hook throws, nothing is written.
  - The receipt round-trip with the marker, and the scheduled/parked/reordered undo restoring it.
  - `markdownToTiptapDoc` cases.
  - The badge on the card, the bucket row and the dialog.
  - The notice: list, undo, stale, no-receipt row.
  - i18n parity.

**Acceptance Criteria:**
- Given the migration, then the seven tables have `ai_changed_at` and `ai_changes` exists, and `npm run check:migrations` passes.
- Given any connector write tool, when it succeeds, then exactly one `ai_changes` row exists for it (two for `move_activity_to_day`), in the same transaction as the write. When the write fails or the hook throws, nothing is written.
- Given an entry marked by the connector, when a person edits, moves, parks or schedules it in the app, then its badge disappears. Rows the recompute only shifted keep their badge.
- Given the full suite, then typecheck, lint (no new warnings over baseline), all tests and the build pass.

## Spec Change Log

## Review Triage Log

### 2026-10-29 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 15 (high 0, medium 4, low 11)
- defer: 0
- reject: 8 (high 0, medium 3, low 5)
- addressed_findings:
  - `[medium]` `[patch]` A reorder threw `DayPlanChangedError` when the recompute had not restamped the moved row (a regression for the app's own reorder on duplicate sortOrder). The marker write is now skipped when the marker stays null, and is conditional on the stamp only for a moved row.
  - `[medium]` `[patch]` `update_activity` with only a new `startTime` on a fixed activity kept the old end time. It now keeps the duration.
  - `[medium]` `[patch]` When `move_activity_to_day` parked the activity but could not schedule it, the park's change id was dropped. The error now names it, and `not_found`/`missing` get accurate messages.
  - `[medium]` `[patch]` A stored receipt that the stored schema would refuse was listed as undoable. It is now validated at insert and stored as null on failure.
  - `[low]` `[patch]` Fixed the `writeOrigin.ts` and schema comments that overclaimed "cleared by any write from the app".
  - `[low]` `[patch]` The AI-changes list now filters `undoneAt` in the DB and is capped at 50 for the app.
  - `[low]` `[patch]` Description: capped at 10,000 characters, with a clear error when empty. `updatedAt` must be strict ISO with offset.
  - `[low]` `[patch]` Markdown: an ordered list starts only at `1.`, links allow balanced parentheses, and inline parsing is linear.
  - `[low]` `[patch]` Write tools refuse a token with no client id.
  - `[low]` `[patch]` `move_activity` to the current position returns a specific message.
  - `[low]` `[patch]` Notice: `role="status"` is only on the summary, and its state resets on day change.
  - `[low]` `[patch]` `update_activity` with nothing to change returns an error instead of a no-op write.
  - `[low]` `[patch]` Times given while the mode is flexible now return an error instead of being dropped.
  - `[low]` `[patch]` Optimistic delete and leg writes bump the notice reload.
  - `[low]` `[patch]` An empty title is stored as a null subject.

### 2026-10-29 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 4 (high 0, medium 0, low 4)
- defer: 0
- reject: 18 (high 0, medium 3, low 15)
- addressed_findings:
  - `[low]` `[patch]` `create_activity` and `update_activity` took a server-wide geocoder slot before validating. A create for an unknown day, or a payload the schema refuses, now fails before the place is geocoded.
  - `[low]` `[patch]` `list_ai_changes` had no row cap. It now returns at most the newest 100, with `truncated` set when there are more.
  - `[low]` `[patch]` With the AI badge beside it, a dialog heading could not wrap a long unbroken title. The `h2` now has `minWidth: 0` and `overflowWrap: "anywhere"`.
  - `[low]` `[patch]` Corrected a `TripDayView` comment that said a delete removes the activity's AI changes. They stay listed.

## Design Notes

- **`summary` is stored as `action` + `subject`** (the activity's title at write time) instead of a fixed sentence. The notice can then speak the UI language, e.g. „„Louvre" hinzugefügt" / "“Louvre” added". `list_ai_changes` builds an English line from the same two fields.
- **`move_activity_to_day` is park then schedule.** That is the app's only path since Story 14.4, and there is no `moved to day` receipt kind. It therefore records two entries, one on each day. They are undone newest first; undoing the park while the activity sits on the target day is refused as stale. This is the one exception to "one entry per tool".
- **Pure deletes and media reorders take no `origin`.** They create or edit no marked row, and a delete's row is gone. Trip import creates rows with a null marker because backups never carry it, so it takes no `origin` either.
- **Out of scope for 15.4:** cost, payments and link on activities (15.6). `update_activity` passes the stored values through, because the repository replaces payments wholesale.
- **Badges on legs, documents and images** arrive with the stories that let the connector write them. The columns and `origin` exist now.
- Tool inputs (zod, ids via `idSchema`):
  - `create_activity{tripId, dayId?, title, description?, mode?: "flexible"|"fixed" (default flexible), durationMinutes?, startTime?, endTime? (HH:MM), place?: {name?, lat?, lng?}, afterActivityId?}`. Without `description` the title becomes the text, because the app requires a non-empty one.
  - `update_activity{tripId, activityId, updatedAt, …same optional fields; place: null clears}`
  - `delete_activity{tripId, activityId, updatedAt}`
  - `move_activity{tripId, activityId, direction?: "earlier"|"later", position?: 1-based}` (exactly one)
  - `move_activity_to_day{tripId, activityId, dayId}`
  - `park_activity{tripId, activityId}`
  - `schedule_activity{tripId, activityId, dayId}` (appends)
  - `list_ai_changes{tripId, dayId?}`
  - `undo_ai_change{tripId, changeId}`
- The undo core in one line: `runDayChangeUndo` = repo transaction (+ optional hook) + post-commit image cleanup. The UI receipt route keeps its signature check before calling it.

## Verification

**Commands (in `travelplan/`):**
- `npm run typecheck`: expected clean.
- `npm run lint`: expected 0 errors and no new warnings over baseline (80).
- `npm test`: expected all pass.
- `npm run check:migrations && npm run build`: expected success.

## Auto Run Result

Status: done

**Summary:** A follow-up review of Story 15.4 (connector activity tools, the AI marker, stored AI changes, the shared undo core, the badge and the notice) found no defects that block it. It applied 4 small hardening fixes.

**Files changed in this pass** (under `travelplan/`):
- `src/lib/mcp/tools/activityWrite.ts`: `create_activity` and `update_activity` check the day and the payload before using the geocoder. The payload builders are now shared between that check and the write.
- `src/lib/mcp/tools/aiChanges.ts`: `list_ai_changes` returns at most 100 changes and a `truncated` flag. Its description says so.
- `src/components/ui/DialogShell.tsx`: the heading can wrap beside the title adornment.
- `src/components/features/trips/TripDayView.tsx`: comment corrected.
- `test/mcpActivityWriteTools.test.ts`: two new tests, one for no geocoding on a refused create or edit and one for the list cap and `truncated`.

**Review:** Blind Hunter and Edge Case Hunter. 22 distinct findings: 4 patched (all low), 0 deferred, 18 rejected.
- 3 medium rejects. All three were already decided in the spec or by an earlier review:
  - The notice keeps listing changes that are no longer undoable for 14 days.
  - `move_activity_to_day` is two transactions.
  - Deleting an account cascades its `ai_changes`.
- 15 low rejects:
  - Checked against the code and not real:
    - the reorder marker's restamp filter (`updatedAt: now` is written by the recompute)
    - `replacePayments`, which rewrites identical rows
  - By spec:
    - Epic 12 apply passes `"user"`
    - receipt v3 is not bumped
    - the global purge
    - parked AI changes are not listed in a day notice
    - the "everything else literal" Markdown subset, which leaves nested bold inside italic as literal text
  - Rare, cosmetic, or a messaging nuance:
    - same-millisecond ordering
    - more than 50 changes in one day's notice
    - the hint when one change must be undone before another
    - the legacy null title
    - the position message
    - a stored receipt that fails the schema
    - no rate limit on the app undo, like the other app routes

**Follow-up review recommended:** false. There were only 4 localized low-severity fixes.

**Verification** (in `travelplan/`):
- `npm run typecheck`: clean.
- `npm run lint`: 0 errors / 80 warnings, the baseline.
- `npm test`: 248 files / 3918 passed.
- `npm run check:migrations`: passed.
- `npm run build`: succeeded.

**Residual risks** (unchanged from the first run):
- Client-held receipts issued before the deploy show "undo unavailable".
- `move_activity_to_day` is not atomic.
- The notice lists changes the user has since overridden until they are undone or expire.
- The badges for legs, documents and images come with 15.6 and 15.7.
