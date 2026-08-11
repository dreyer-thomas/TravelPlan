---
title: 'Story 8.5: Travel Segments That Match Their Day'
type: 'bugfix'
created: '2026-08-11'
status: 'done'
baseline_revision: '850d633'
final_revision: '1c41e73'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/8-5-travel-segments-that-match-their-day.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-8-context.md'
warnings: [multiple-goals, oversized]
---

<intent-contract>

## Intent

**Problem:** A day's travel legs and the day's timeline can disagree, and nothing on screen says so. Deleting a stay leaves every segment that pointed at it in the database (`DW-79`, `DW-215`: `deleteAccommodationForTripDay` is a bare `prisma.accommodation.delete` with no transaction and no cleanup, while the activity path has had one since Story 6.23). Inserting or retiming an activity strands its neighbours' segment (`DW-148`). Either way the row is invisible — `TripDayView` draws only the pairs its timeline produces — while `totalTravelMinutes` reduces over **every** fetched row, so the minutes stay in "Fahrzeit" forever with no control anywhere that can remove them (`DW-151`, reported from production on 2026-08-07).

**Approach:** Split the two cases on one distinction. **Endpoint gone → delete:** one type-agnostic cleanup helper serving both members of `TravelSegmentItemType`, called inside a transaction by the stay-delete path as it already is by the activity paths. **Adjacency changed → surface:** the day view derives its drawn endpoint pairs once, counts only those in the travel total, and lists everything else as a removable *orphaned leg*.

## Boundaries & Constraints

**Always:**
- `DW-79`'s recorded decision (clean up on delete in `accommodationRepo`) and `DW-151`'s (surface undrawable segments as a removable row) are the specification. Where `DW-148`'s older decision ("a segment whose endpoints are no longer adjacent is deleted") contradicts them, **the story governs and the segment is kept** — see Design Notes.
- Story 6.23's non-healing rule survives generalisation: the helper deletes and never creates, never joins a removed item's two former neighbours, never writes to a target day.
- `createTravelSegmentForTripDay` and `updateTravelSegmentForTripDay` keep refusing a non-adjacent pair. `ensureSegmentItemsExist` is **not** widened, relaxed, or given a third caller.
- Story 5.13's writer clause (`trip: { OR: [{ userId }, { members: { some: { userId, role: "CONTRIBUTOR" } } }] }`) stays on every path touched. A contributor may remove an orphaned leg exactly as they may edit a segment.
- Every new user-facing string exists in **both** `src/i18n/en.ts` and `src/i18n/de.ts` (`test/i18nDictionaries.test.ts` pins parity).
- The two required-red tests (AC1 repository, AC5 component) are written first and **observed failing at baseline**, then fixed. Record the observation in the Completion Notes.

**Block If:**
- Making the day's travel total honest turns out to require a schema change or a data migration of existing rows. It must not: this story deliberately leaves existing orphans in the database for their owner to remove through AC4.
- An existing test's pinned "Fahrzeit" figure changes under AC5 — that would mean a fixture the timeline never drew was being counted, i.e. a second reachable instance of the defect. Investigate and report it rather than editing the number to match.

**Never:**
- Do not delete a stranded segment on create/update/move of an activity. That is the decision this story declines: transport mode, duration and distance are the user's measurements and are not derivable.
- Do not add a drop-on-import. Story 2.35 restores segments as backed up on purpose; a restored orphan surfaces through AC4 (AC8).
- Do not remove or weaken the `@@unique([tripDayId, fromItemType, fromItemId, toItemType, toItemId])` constraint, and do not "repair" `DW-79`'s note about Story 2.32's id remapping colliding with it — that is not this story.
- Do not add a second `removeTravelSegmentsReferencingAccommodation`. One helper, both enum members (`DW-215`).
- No schema change, no migration, no new dependency, no reordering of the timeline, no change to the Gantt bar's own segment builder.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Stay deleted, own day | Day N has a stay S and a segment `activity → S` | Stay row and segment both gone, one transaction; route still answers `200 { deleted: true }` | Rolls back together; a failed cleanup fails the delete |
| Stay deleted, following day | Day N has stay S; day N+1 has a segment `S → firstActivity` (S as previous-night endpoint) | That segment is deleted too | As above |
| Stay deleted, unrelated rows | Segments on other days / between activities | Untouched | — |
| No stay on the day | `DELETE` for a day with no accommodation | Still `true`, nothing deleted (unchanged idempotence) | — |
| Activity inserted between A and B | `A →(car,40m)→ B` exists; M created with a time between them | Row survives with mode, duration and distance intact; **not** drawn; listed as an orphaned leg; excluded from "Fahrzeit" | — |
| Activity retimed / moved away | Same row, order changed by an update or a move to another day | Same as above (a *move* still deletes only the segments referencing the moved activity) | — |
| Orphaned leg removed | User confirms removal of an orphaned leg | `DELETE /api/trips/{id}/travel-segments` `{ tripDayId, segmentId }` → `200 { deleted: true }`; row leaves all three client copies | Failure restores the row in state and shows the page-level error |
| Endpoint no longer exists | Orphan whose `fromItemId`/`toItemId` names nothing on the day (pre-existing row) | Row still listed, unknown endpoint rendered with a fallback label, still removable | — |
| Creating a pair that already has one | `POST` where the `@@unique` row exists | `409 travel_segment_exists` unchanged; dialog shows a translated message naming the reason and pointing at the orphaned-legs list | — |
| Viewer (read-only member) | Day with an orphaned leg | Leg is visible; no remove control | — |

</intent-contract>

## Code Map

- `travelplan/src/lib/repositories/travelSegmentRepo.ts` -- `TravelSegmentItemType` already imported `:2`; `findTripDayForTripWriter` `:167` (writer clause `:173`); `buildSegmentTimeline` `:197-248` (previous day via `dayIndex: { lt }` + `findFirst` `:222-231`, order = previous stay → sorted plan items → this day's stay); `ensureSegmentItemsExist` `:250-266` (adjacency `toIndex !== fromIndex + 1`), **callers are only `:292` create and `:328` update**; `deleteTravelSegmentForTripDay` `:349-365` — writer check, `findFirst({ id, tripDayId })`, `delete`. **No adjacency test on the delete path.** No `$transaction` anywhere in this file.
- `travelplan/src/lib/repositories/dayPlanItemRepo.ts` -- `TransactionClient` alias `:8`; `removeTravelSegmentsReferencingDayPlanItem` docblock `:274-292`, body `:293-317` (`findMany` scoped by `tripDayId in` + type/id `OR`, then `deleteMany` by id, returns removed ids); call sites `:633` (delete, `[tripDayId]`) and `:693` (move, `[tripDayId, targetTripDayId]`), both inside interactive `prisma.$transaction`. `createDayPlanItemForTripDay` `:431` and `updateDayPlanItemForTripDay` `:551` touch no segments — that is AC3's current, correct behaviour.
- `travelplan/src/lib/repositories/accommodationRepo.ts` -- `deleteAccommodationForTripDay` `:474-488`: writer check → `false`; `findUnique({ where: { tripDayId } })` → `true` when absent; `prisma.accommodation.delete`. No transaction, no cleanup. `createAccommodationForTripDay` `:249` and `copyAccommodationFromPreviousNight` `:399` **upsert** (same row id), so no other stay path can orphan a segment.
- `travelplan/src/app/api/trips/[id]/accommodations/route.ts:197-207` -- `!deleted → 404 not_found`, else `ok({ deleted: true })`.
- `travelplan/src/app/api/trips/[id]/travel-segments/route.ts` -- `POST` `:87` (`P2002 → 409 travel_segment_exists` `:134`), `PATCH` `:170`, `DELETE` `:254-301` (CSRF, `travelSegmentDeleteSchema` `{ tripDayId, segmentId }`, `missing → 404`, success `ok({ deleted: true })`). **The delete endpoint already accepts an orphan's id.**
- `travelplan/src/components/features/trips/TripDayView.tsx` -- `SegmentItem` `:366`; `TravelSegment` type `:406`; `buildSegmentKey` `:483` / `buildSegmentKeyFromIds` `:484`; `loadDay` `:810-882` (segments seeded `:871`, plan items `:857`); `segmentsByKey` `:931-940`; `handleTravelSegmentSaved` `:950-976` (patches `travelSegments`, `day.travelSegments`, `detail.days[]`); `handleDeletePlan` `:1000-1062` — the house delete pattern (`window.confirm` `:1004`, `ensureCsrfToken` `:920`, optimistic removal + rollback, `resolveApiError` `:752`); `orderedDays` `:1105`; `previousDay` `:1350`; `previousStaySegment` `:1589`, `currentStaySegment` `:1598`, `firstPlanSegment` `:1752`, `previousSegmentTarget` `:1762`; `totalTravelMinutes` `:1702-1709` (reduces over **all** of `travelSegments`); `travelSegmentLabel` `:1723`; `renderTravelSegment` `:2221-2292`; render sites `:3388` (previous stay → first target) and `:3419-3427`/`:3545` (each plan item → next plan item or current stay); stat strip `:3173-3212`, travel cell `data-testid="day-stat-travel-time"` `:3205`; `ganttSummary` row `:3163-3171`; page-level `<Alert severity="error">` `:2767`; `VISUALLY_HIDDEN` + `aria-label` icon-button shape `:2272-2284`.
- `travelplan/src/components/features/trips/TripDayTravelSegmentDialog.tsx:582-598` -- POST/PATCH; on failure `setServerError(body.error?.message ?? t("trips.travelSegment.saveError"))` — the raw English server message is what the user sees for `travel_segment_exists`.
- **Activity ordering — the two orders that must agree (iteration 1's defect).** `travelplan/src/lib/repositories/tripRepo.ts:897` -- `getTripWithDaysForUser` returns `dayPlanItems` with `orderBy: { createdAt: "asc" }`, and this is the only source the day view has. `travelplan/src/lib/repositories/travelSegmentRepo.ts:186-195` (`comparePlanItemsByStartTime`) + `:245` -- the adjacency rule sorts by `fromTime`, then `createdAt`, then `id`. The two disagree for any day whose activities were not created in chronological order. Third and fourth copies of the same comparator: `dayPlanItemRepo.ts:351` (applied at `:391`) and the print payload's own ordering (`src/lib/trips/printDocuments.ts:12`, `tripRepo.ts` `orderedStops`) — `DW-216`. `TripDayView.tsx:868` discards `createdAt` (`createdAt: ""`) while the API does return it.
- `travelplan/src/components/features/trips/TripDayView.tsx:1627-1647` -- `travelSegmentsForGantt` feeds `buildTravelSegments` from **all** fetched rows; it is the coverage bar's input, on the same panel as the travel-time stat. `resolveApiError` `:752-774` has no `not_found` branch.
- `travelplan/src/components/features/trips/TripDayBucketListPanel.tsx:103-128` -- house pattern for a compact list row with a trailing 44px icon-button.
- `travelplan/src/i18n/en.ts:381-439` / `de.ts:366-426` -- the `trips.travelSegment.*` block. Stat labels: `en.ts:281` / `de.ts:265`.
- `travelplan/test/dayPlanItemRepo.test.ts:1135-1200` -- the activity-side precedent (seeds two segments, asserts removed ids, surviving count, and the recomputed total via `totalTravelMinutesForDay` `:85-92`). `test/accommodationRepo.test.ts:329`/`:354` -- delete-path tests that seed no segments. `test/tripDayViewLayout.test.tsx` -- the component harness (`stubFetch`, `renderWithProviders`, `// @vitest-environment jsdom`), travel-total assertions at `:3573`, `:3582`, `:4875`.

## Tasks & Acceptance

**Execution:**
- [x] `travelplan/src/lib/repositories/travelSegmentRepo.ts` -- add a local `TransactionClient` alias (mirroring `dayPlanItemRepo.ts:8`; there is no shared repository module in this project and inventing one is out of scope) and export `removeTravelSegmentsReferencingItemInTransaction(tx, tripDayIds: string[], itemType: TravelSegmentItemType, itemId: string): Promise<string[]>` — the generalisation of `removeTravelSegmentsReferencingDayPlanItem`, matching the established `…InTransaction` cross-repository convention (`bucketListRepo.ts:232`). Same body: `findMany` scoped by `tripDayId: { in: tripDayIds }` and `OR: [{ fromItemType: itemType, fromItemId: itemId }, { toItemType: itemType, toItemId: itemId }]`, then `deleteMany` by the collected ids, returning them. Carry the docblock across, keeping the non-healing paragraph verbatim and adding that it now serves both enum members. -- AC2
- [x] `travelplan/src/lib/repositories/dayPlanItemRepo.ts` -- delete the local helper and call the shared one at `:633` and `:693` with `"DAY_PLAN_ITEM"`. `grep -n "removeTravelSegmentsReferencingDayPlanItem" src` must come back empty: the point of `DW-215` is one helper, not two spellings of one. Behaviour, return shape and `removedTravelSegmentIds` are unchanged. -- AC2, AC3
- [x] `travelplan/src/lib/repositories/accommodationRepo.ts` -- `deleteAccommodationForTripDay` `:474`: keep the writer check and the idempotent `true` for a day with no stay, then wrap the delete in an interactive `prisma.$transaction` that (a) reads the trip's day ids (`tx.tripDay.findMany({ where: { tripId }, select: { id: true } })`), (b) `tx.accommodation.delete`, (c) calls the shared helper with `"ACCOMMODATION"` and the stay's id. **Scope is the trip's days, not just this one:** a stay is an endpoint on its own day *and* on the following day, where `buildSegmentTimeline` offers it as the previous night (`travelSegmentRepo.ts:222-234`), and older rows can sit on any later day. `DW-79`'s decision sketches an unscoped `deleteMany` on `fromItemId`/`toItemId`; trip-scoping is the same rule made precise and keeps the house helper's day-scoped shape. Return type stays `boolean` — the route contract does not change. -- AC1, AC2
- [x] **`travelplan/src/lib/trips/dayPlanItemOrder.ts` -- new, and do this first: one exported `compareDayPlanItemsByStartTime({ fromTime, createdAt, id })` accepting `createdAt` as `Date | string` (the client holds an ISO string, the repository a `Date`), with the existing rule verbatim — both timed → `fromTime.localeCompare`; exactly one timed → timed first; then `createdAt` ascending; then `id.localeCompare`. Import it in `travelSegmentRepo.ts` in place of the module-local copy at `:186`, and in `TripDayView.tsx`. This is the iteration-1 defect's root: the day view read `planItems` in the API's `createdAt` order while adjacency is decided in start-time order, so on any day whose activities were not created in chronological order the split was inverted — the one leg the API accepts was labelled an orphan and dropped from "Fahrzeit", and `DW-148`'s real insertion case was drawn and counted as before. Two orders cannot be made to agree by asserting that they do. Leave `dayPlanItemRepo.ts:351` and the print payload's copies alone: `DW-216` is not this story, and the two consumers whose disagreement *is* this story's defect are the two being unified. -- AC4, AC5**
- [x] **`travelplan/src/components/features/trips/TripDayView.tsx` -- carry `createdAt` through the `setPlanItems` mapping (`:857-869` currently writes `createdAt: ""` while the payload contains it) and order `planItems` with the shared comparator, so this screen's activity order, its timeline legs and the server's adjacency rule are one order. The day view renders activities in creation order today, which is a visible pre-existing oddity on its own and, once the drawn/orphan split depends on it, produces wrong data. If an existing test's expected activity order changes, that is evidence of the same defect — report it, do not edit the expectation to match. -- AC4, AC5**
- [x] `travelplan/src/components/features/trips/TripDayView.tsx` -- derive the day's endpoint order **once**. A `timelineEndpoints: SegmentItem[]` memo = `[previousStaySegment?, ...planItems.map(toPlanSegmentItem), currentStaySegment?]` (nulls filtered), where `toPlanSegmentItem` is the extracted form of the object currently built inline at `:3408` and `:3419`. The render then walks consecutive pairs of that array instead of rebuilding them: `renderTravelSegment(timelineEndpoints[i], timelineEndpoints[i + 1])`, which reproduces today's rows exactly (`previousSegmentTarget` is `timelineEndpoints[1]`; `nextSegmentItem` is the successor). One array is the whole point — a second derivation of "what is drawn" would be free to drift from what is rendered, which is the defect this story is closing. -- AC4, AC5
- [x] Same file -- from that array derive `drawnSegmentKeys: Set<string>` (consecutive pairs through `buildSegmentKey`) and split `travelSegments` into drawn and `orphanedSegments` (key not in the set). `totalTravelMinutes` `:1702` reduces over the **drawn** list only, keeping its existing `Number.isFinite` / `Math.max(0, …)` guards. **`travelSegmentsForGantt` `:1627-1647` must be fed the same drawn list**, or the coverage bar in the same panel paints a travel block and folds those minutes into "Planned" for a leg the block below declares uncounted — two figures on one screen disagreeing about one day, which is the defect wearing different clothes. Only the call site's input changes; `buildTravelSegments` itself is untouched, as **Never** requires. -- AC5
- [x] Same file -- render the orphaned legs. Place the block inside the panel that holds the stat strip, directly below it (`~:3212`), so the figure it is separate from is adjacent to it: `data-testid="orphan-travel-segments"`, a heading, one row per orphan (`data-testid="orphan-travel-segment"`, `data-segment-id`) showing its two endpoints as recorded — resolved to a label from `previousStay` / `currentStay` / `planItems` by id, and `t("trips.travelSegment.orphanUnknownEndpoint")` when the endpoint is gone — plus `travelSegmentLabel(segment)` for mode · duration · distance, and their summed duration stated as *not* counted in the travel time. The whole block is absent when there are no orphans. Remove control only when `canEditPlanning`, following `TripDayBucketListPanel.tsx:103-128` for the row and `:2272-2284` for the button's `aria-label` + `VISUALLY_HIDDEN` shape (no `Tooltip` — it is not imported here). -- AC4, AC5
- [x] Same file -- `handleRemoveOrphanSegment(segmentId)`: `window.confirm(t("trips.travelSegment.orphanRemoveConfirm"))`, `ensureCsrfToken`, `DELETE /api/trips/${tripId}/travel-segments` with `{ tripDayId: day.id, segmentId }`, mirroring `handleDeletePlan`'s optimistic-removal-with-rollback and `setError(resolveApiError(...))` handling. On success drop the id from all three copies the way `handleTravelSegmentSaved` `:950-976` patches them (`travelSegments`, `day.travelSegments`, `detail.days[]`). No repository or route change is needed — see Design Notes. Two corrections to iteration 1: **a `404 not_found` is a success, not a retryable failure** — the row is gone, which is what was asked for, so keep it removed and show nothing (restoring it puts a ghost row on screen under a "please try again" the user can never satisfy — reachable from a second tab or a double click); and **guard against a second in-flight request for the same id** (a `Set` of pending ids disabling the row's control), because the second click's `404` is otherwise what undoes the first click's result. -- AC6
- [x] `travelplan/src/components/features/trips/TripDayTravelSegmentDialog.tsx` -- when the response carries `error.code === "travel_segment_exists"`, show a translated message that names the real reason and points at the orphaned-legs list, instead of relaying the server's English string. Nothing else in the error path changes. Gate it on the **create** path (`!isEditing`): the same code comes back from `PATCH` (`route.ts:219`), where "find it under Orphaned travel legs" describes a row the user is editing in the open dialog. Word it so it is still true when this tab's day was loaded before the conflicting row existed — the list is where the row will be, and a reload may be needed to see it. -- AC7
- [x] `travelplan/src/i18n/en.ts`, `travelplan/src/i18n/de.ts` -- add the new `trips.travelSegment.*` keys (heading, explanatory line, uncounted-total, unknown endpoint, remove action, remove confirmation, remove error, and the `travel_segment_exists` hint) to both dictionaries, in the same relative order in each. Proof-read the German: `{duration}` is one quantity, so the uncounted-minutes line takes a singular verb (`zählt`, not `zählen`). -- AC4, AC6, AC7
- [x] `travelplan/test/accommodationRepo.test.ts` -- **required red.** Seed a stay on day 1 and segments referencing it on day 1 (`activity → stay`) and on day 2 (`stay → activity`), plus one unrelated segment on day 2. Delete the stay: assert both referencing rows are gone, the unrelated one survives, the accommodation row is gone, the call returns `true`, and — as `dayPlanItemRepo.test.ts:1135` does — that the recomputed day totals drop accordingly. Observe it failing before the repository change. -- AC1, AC2
- [x] `travelplan/test/dayPlanItemRepo.test.ts` -- the existing activity-side cases must pass **unmodified** after the helper move (that is the AC2 evidence). Add the AC3 pin: with `A →(car,40m)→ B` on a day, create an activity M timed between them, then retime one endpoint, and assert the `A→B` row still exists with its `transportType`, `durationMinutes` and `distanceKm` intact and that no segment was created. -- AC2, AC3
- [x] `travelplan/test/` (new `tripDayViewOrphanSegments.test.tsx`, mirroring `tripDayViewLayout.test.tsx`'s harness) -- **required red.** A day whose fetched segments include one drawn pair and one stranded pair asserts: `day-stat-travel-time` shows only the drawn duration; the timeline renders no row for the stranded pair; exactly one `orphan-travel-segment` row appears, naming what the row records; clicking its remove control issues the `DELETE` with that `segmentId` and drops the row and — where it applies — nothing else; a failed `DELETE` restores the row and surfaces the error; an orphan with an endpoint that no longer exists still renders and is still removable; and a viewer (`canEditPlanning` false) sees the row without a control. Three cases iteration 1 lacked, each of which hid a real defect: **(a) required red, and the sharpest one — a day whose activities were created out of chronological order** (`Dinner` 19:00 created first, `Museum` 09:00 second, one row `Museum → Dinner`) must count that leg in "Fahrzeit", draw it, and list no orphan; against iteration 1 it was the orphan and the day read `0m`. **(b)** the `DW-148` case built the way a user reaches it — a third activity *created last* with a time between two neighbours — which is the only way insertion happens and which iteration 1's fixture (ordered by creation) never produced. **(c)** a fixture with a previous night's stay, so `planEndpointOffset === 1` and the rewritten `previousSegmentTarget` are exercised by the suite that owns them. -- AC4, AC5, AC6
- [x] `travelplan/test/` -- AC7: the dialog shows the translated `travel_segment_exists` message on a `409`, and the day carrying that hidden row lists it as an orphaned leg (the two halves of "the day now offers a way to reach the existing row"). -- AC7
- [x] `travelplan/test/` (new `test/dayPlanItemOrder.test.ts`) -- a direct unit suite for the shared comparator: timed before untimed, `fromTime` ascending, equal times falling back to `createdAt` and then `id`, and `createdAt` accepted as both an ISO string and a `Date` with the same answer. It is now the single rule two layers depend on, and a comparator tested only through two screens is how the two orders came to disagree in the first place. -- AC4, AC5
- [x] `travelplan/test/` -- AC8: an import carrying a segment whose endpoints are not adjacent restores the row rather than dropping it, and that restored row surfaces as an orphaned leg. Assert against the existing import path; add no code to it. -- AC8

**Acceptance Criteria:**
- Given a stay with travel segments pointing at it from its own day and from the following day, when the stay is deleted, then the accommodation row and both segments are gone in one transaction and unrelated segments survive. *(AC1)*
- Given both members of `TravelSegmentItemType`, when segment cleanup runs for either, then it runs through the same exported helper — no `removeTravelSegmentsReferencingDayPlanItem` remains and no accommodation-specific twin is added, with the activity-side tests passing unmodified. *(AC2)*
- Given `A →(car, 40 min, 12 km)→ B` on a day, when an activity is inserted between them or one is retimed so the order changes, then the row still exists with mode, duration and distance unchanged, and no segment was fabricated. *(AC3)*
- Given a day holding a segment whose endpoint pair the timeline does not produce, when the day is viewed, then the segment appears as an orphaned leg naming what it records, and a viewer sees it too. *(AC4)*
- Given that same day, when its travel time is read, then it equals the sum of exactly the segments the timeline draws, and the orphan's minutes are reported separately as uncounted. *(AC5)*
- Given an orphaned leg and a user who may plan, when they confirm its removal, then the row is deleted through the existing endpoint and disappears from the day without a reload; and given the removal fails, then the row comes back and the failure is shown. *(AC6)*
- Given a pair that already has a segment, when a new one is created for it, then the refusal is still a `409` and the message the user reads is translated, names the constraint, and points at the orphaned-legs list where the existing row can be found. *(AC7)*
- Given a backup carrying a segment whose endpoints are no longer adjacent, when it is imported, then the row is restored unchanged and surfaces as an orphaned leg rather than being discarded. *(AC8)*
- Given the full suite at baseline, when the story is complete, then the suite is green with no test file lost, and the AC1 and AC5 tests are each demonstrated to have failed beforehand.

## Spec Change Log

### 2026-08-11 — Iteration 1: the two orders this screen sits between are not the same order

**Triggering findings.** Iteration 1 shipped green — 148 files / 2324 tests, typecheck clean, lint unchanged, build fine, and five mutations each failing a test. Both reviewers then independently found the same defect, and I reproduced its root by reading the query.

1. **The drawn/orphan split was computed in `createdAt` order against an adjacency rule decided in `fromTime` order** (`tripRepo.ts:897` vs `travelSegmentRepo.ts:245`). On a day whose activities were not created in chronological order, the only leg the API accepts was classified as an orphan — excluded from "Fahrzeit", offered a Remove button — while the day drew an "add travel" prompt for a pair the API answers `400 not_adjacent` for. Confirmed by execution by both reviewers.
2. **`DW-148` was therefore not fixed at all.** Insertion means creating an activity with a middling `fromTime`, which appends it in `createdAt` order, leaving the stranded pair adjacent on screen and still counted. The story's own fixture manufactured a state the application cannot reach, and the acceptance test passed against it.
3. **The coverage bar kept counting every row** (`travelSegmentsForGantt` `:1627`), so the same panel reported "Planned 9h" including an orphan while the block beneath it said "1h 30m not counted in this day's travel time".
4. **A `404` from the orphan delete restored a ghost row** under a "please try again" that can never succeed (second tab, or a double click, since there was no in-flight guard).
5. Smaller: the `travel_segment_exists` hint was not gated to the create path, so an edit conflict directed the user to a list for the row they had open; the German uncounted-minutes line used a plural verb for a singular quantity; two orphans with unresolvable endpoints shared one accessible button name; and the new suite covered neither a previous-night fixture (the `planEndpointOffset === 1` branch it rewrote) nor an out-of-creation-order day.

**What was amended** (all outside `<intent-contract>`): a new first task extracting `compareDayPlanItemsByStartTime` into `src/lib/trips/dayPlanItemOrder.ts`, imported by `travelSegmentRepo.ts` and by the day view, which now carries `createdAt` through its `setPlanItems` mapping and orders activities by it; `travelSegmentsForGantt` fed the drawn list; `404` treated as success plus an in-flight guard; the exists-hint gated to create and reworded; the German verb; the accessible-name rule; three new component cases (out-of-creation-order **required red**, the user-reachable `DW-148` insertion, a previous-night fixture); a direct unit suite for the comparator; and the Code Map and Design Notes now state the two orders and their disagreement instead of asserting they agree.

**Known-bad state avoided.** Shipping a story whose entire subject is "the day's travel legs match the day" while the screen and the API disagree about what the day's order *is* — so that the one leg the server considers valid is presented as an orphan to delete, and the production defect the story exists to close survives untouched, behind 2324 green tests.

**KEEP — must survive re-derivation.** Iteration 1's code is preserved at `/private/tmp/claude-501/-Users-tommy-Development-TravelPlan/8e486d22-d922-4bec-ba59-0208c45e6123/scratchpad/iteration-1-reference.diff` and is the right starting point: no reviewer found anything wrong with the repository half, and the component half is correct once its ordering input is. Specifically keep:
- The whole repository side unchanged: `removeTravelSegmentsReferencingItemInTransaction` in `travelSegmentRepo.ts` with the non-healing docblock carried across and widened to both enum members; `dayPlanItemRepo`'s two call sites passing `"DAY_PLAN_ITEM"` and its local helper and now-unused `TransactionClient` alias deleted; `deleteAccommodationForTripDay`'s interactive transaction with the trip-scoped day ids and the idempotent `true` left *outside* it.
- The single `timelineEndpoints` array, `toPlanSegmentItem`, `planEndpointOffset`, and the JSX indexing into the array rather than rebuilding endpoints inline. This is the right shape; only its input order was wrong.
- The orphan block's placement, markup and copy: real `ul`/`li`, `labelCaps` heading per `TripDayBucketListPanel`, per-row `data-segment-id`, the route-naming accessible label, the 44px `TrashIcon` button withheld from viewers, and the uncounted-minutes line.
- `handleRemoveOrphanSegment`'s optimistic removal patching all three copies with an index-preserving restore.
- The AC1 repository test and its `totalTravelMinutesForDay` helper copied from `dayPlanItemRepo.test.ts`, and the AC8 import case — all unaffected by this iteration's defect.
- The comment density and the "why, and which DW entry" convention, which carried the reasoning well. One correction: `travelSegmentsRef`'s comment claims it stops the callback being re-created on every segment change, which is false (`day` is in the dep list and every segment mutation calls `setDay`). Keep the ref if it mirrors `planItemsRef`, but say what it actually does.

### 2026-08-12 — Correction to iteration 1's stated root cause

**The iteration-1 entry above is wrong about *why* the ordering work was needed, and the record has to say so.** Its finding 1 claims the day view "was computed in `createdAt` order against an adjacency rule decided in `fromTime` order". Both reviewers reported that, and I confirmed only half of it: `getTripWithDaysForUser`'s Prisma query does order `dayPlanItems` by `createdAt` (`tripRepo.ts:897`), but its **mapping sorts them again** a hundred lines later — `[...day.dayPlanItems].sort(compareDayPlanItemsByStartTime)` (`tripRepo.ts:1036`, a private copy of the same rule since Story 2.21). The payload therefore arrives in start-time order, iteration 1's split was correct against the real API, and the reviewers' "confirmed by execution" rested on hand-built fixtures the API does not emit. Verified by reading the mapping, and corroborated by the fact that **no existing activity-order or "Fahrzeit" expectation moved** in either iteration.

**What survives the correction, and why iteration 2 was still worth having.** The screen was ordered correctly only because of that mapping line: nothing pinned it, the client could not see it, and `createdAt` was dropped from the payload entirely — so a same-minute tie was unreachable on the client *in principle*, and any edit to that mapping would have silently handed the day view a delete button for the one leg the server accepts. Iteration 2 replaced that implicit dependency with a shared comparator both layers call, carried `createdAt`, and pinned the mapping with a test. It also fixed four defects reviewers found that were real regardless of ordering: the coverage bar, the `404`, the exists-hint's gating, and the German verb. The iteration was justified; the sentence justifying it was not.

**Corrected in code too, not only here.** `dayPlanItemOrder.ts`'s docblock, `route.ts`'s two payload comments, the new component suite's header and two of its case docblocks were rewritten to state the true reason. A comment that misstates why code exists is the same defect as a spec that does.

## Review Triage Log

### 2026-08-11 — Review pass
- intent_gap: 0
- bad_spec: 8: (high 1, medium 3, low 4)
- patch: 0
- defer: 5: (high 0, medium 3, low 2)
- reject: 1: (high 0, medium 0, low 1)
- addressed_findings:
  - `[high]` `[bad_spec]` The day view classified drawn vs orphaned in the API's `createdAt` order while adjacency is decided in start-time order, inverting the split on any day whose activities were not created chronologically — spec amended to extract one shared comparator used by both layers and to order the day view's activities by it; code reverted for re-derivation.
  - `[high]` `[bad_spec]` Consequence of the same root: `DW-148`'s insertion case is unreachable in creation order, so the story's central defect was not fixed and its fixture could not occur — amended with a user-reachable insertion case and an out-of-creation-order required-red case.
  - `[medium]` `[bad_spec]` The coverage bar still counted every fetched row, so one panel reported an orphan's minutes as "Planned" while the block below called them uncounted — amended to feed `travelSegmentsForGantt` the drawn list.
  - `[medium]` `[bad_spec]` A `404` from the orphan delete restored a ghost row under an unsatisfiable retry message, reachable from a second tab or a double click — amended to treat `not_found` as success and to guard a second in-flight request per id.
  - `[medium]` `[bad_spec]` The new component suite exercised neither a previous-night fixture (the `planEndpointOffset === 1` branch it rewrote) nor an out-of-creation-order day — amended with both, plus a direct unit suite for the shared comparator.
  - `[low]` `[bad_spec]` The `travel_segment_exists` hint was not gated to the create path, so an edit conflict pointed the user at a list for the row open in front of them — amended to gate on `!isEditing` and to word the hint for a stale day.
  - `[low]` `[bad_spec]` The German uncounted-minutes line used a plural verb for a singular quantity — amended with a proof-reading instruction.
  - `[low]` `[bad_spec]` Two orphans whose endpoints all resolve to the unknown-endpoint fallback share one accessible button name — folded into the orphan-row task.

### 2026-08-12 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 9: (high 0, medium 3, low 6)
- defer: 0 (three findings re-confirmed entries already recorded in the previous pass: DW-318, DW-320, DW-322)
- reject: 2: (high 0, medium 0, low 2)
- addressed_findings:
  - `[medium]` `[patch]` The trip-overview coverage bar still counted orphaned legs, so one day reported "Planned 7h 45m" on the trip list and "7h 30m" on the day view (confirmed by execution) — the drawn-pair rule was extracted to `src/lib/trips/daySegmentPairs.ts` and `TripTimeline` now filters each day's segments through it, with the day view using the same module.
  - `[medium]` `[patch]` The orphan delete treated every `404` as success, but the route answers `404 not_found` both for a missing row and for a refused write, so a demoted contributor's refused delete made the row vanish silently and return on reload — the client now re-reads the day on a `404` and lets the server settle it, and parses the body defensively so a non-JSON error page cannot restore a ghost row.
  - `[medium]` `[patch]` `compareDayPlanItemsByStartTime` collapsed a missing `createdAt` to `0`, which tied the creation key and fell through to `id.localeCompare` — an active re-sort rather than a tiebreak, which inverted a same-minute pair on any payload lacking the field (confirmed by execution) — it now returns `0` before the `id` comparison so a stable sort keeps the server's order.
  - `[low]` `[patch]` `existsHint` asserted the conflicting row is an orphan, but the create path is also reached by a stale client whose collaborator just added an ordinary adjacent leg — reworded in both locales to be true either way, and the `en.ts` comment corrected to describe the string that is actually there.
  - `[low]` `[patch]` `handleRemoveOrphanSegment` lacked the `canEditPlanning` guard every sibling handler opens with — added as defence in depth behind the withheld control.
  - `[low]` `[patch]` The orphan remove button's accessible name relied on a bare `→` (announced as nothing by most screen readers) and was identical for two rows whose endpoints all resolve to the unknown-endpoint fallback — the i18n templates now use worded connectors and carry what the row records.
  - `[low]` `[patch]` A third byte-identical comparator copy in `tripRepo.ts` — the one sorting both the day payload and the print payload — now imports the shared module, leaving exactly one private copy (`dayPlanItemRepo.ts`, `DW-216`), and the module's docstring was corrected to count them accurately.
  - `[low]` `[patch]` Two comments stated things that were not true (`travelSegmentsRef` "at click time", the `en.ts` hedge) and `sumSegmentMinutes` was recreated every render inside two `useMemo`s without appearing in their dependency lists — corrected and hoisted.
  - `[low]` `[patch]` Two test gaps closed: `tripRepo.ts:1036`'s sort — the line the whole payload's order rests on — is now pinned in `tripDetailRoute.test.ts`, and the stay-delete transaction's atomicity claim is pinned by a new `accommodationDeleteRollback.test.ts` that forces the sweep to throw.

### 2026-08-12 — Review pass (follow-up)

- intent_gap: 0
- bad_spec: 0
- patch: 6: (high 0, medium 1, low 5)
- defer: 2: (high 0, medium 0, low 2)
- reject: 12: (high 0, medium 0, low 12)
- addressed_findings:
  - `[medium]` `[patch]` `handleRemoveOrphanSegment`'s rollback restored into whatever day is on screen, not the day the click happened on — press Remove, move to the next day, and a failed request pushed the first day's segment into the second day's list, where it rendered as an orphaned leg of a day it was never on until the next full load. `restore()` now returns unless `currentDayIdRef.current` is still the captured day (`setDetail` was always keyed by it; `setTravelSegments` and `setDay` were not).
  - `[low]` `[patch]` The `404` branch called `loadDay()`, which sets `loading` and makes the component return a full-screen skeleton — so settling one row of one list blanked the hero, the coverage bar, the stat strip and every card and remounted them. `loadDay` now takes `{ silent }`, which skips that flag and nothing else, and the two `not_found` branches pass it.
  - `[low]` `[patch]` The rollback re-inserted at the snapshot index in `travelSegments` but appended in `day.travelSegments` and `detail.days[]`, leaving the day's three copies of one list in two different orders behind a comment claiming otherwise — `withSegment` is index-preserving now and all three take the same path.
  - `[low]` `[patch]` `TripTimeline`'s coverage bar read `day.dayPlanItems` in array order, correct only because `getTripWithDaysForUser` sorts before serialising — the same invisible, unpinned dependency this story removed from `TripDayView`, left standing on the surface that renders the *same* summary string. It applies `compareDayPlanItemsByStartTime` itself now, its day type carries `createdAt`, and a new case in `tripTimelinePlan.test.tsx` pins it with an out-of-order payload (mutation-checked: the pin fails when the sort is neutralised).
  - `[low]` `[patch]` `tripImportSchemas.ts`'s validation docblock still said a restored distance-2 segment is one "`totalTravelMinutes` counts anyway — the invisible-but-counted shape Story 6.23 set out to stop creating", which this story's AC5 and AC8 made false. Corrected to state where such a row now lands. Same rule as the previous pass's correction: a comment that misstates why code exists is the same defect as a spec that does.
  - `[low]` `[patch]` The new component suite proved the remove control for the owner and withheld it from the viewer, which is equally true of a control gated on ownership by mistake — the role the Boundaries name explicitly ("a contributor may remove an orphaned leg exactly as they may edit a segment") was untested. A contributor case now carries the removal through to the request.

## Design Notes

### The delete path was never the blocker — the UI was

The story's fourth task asks to "allow deletion of a segment whose endpoints are non-adjacent or absent" by separating the delete path's use of `ensureSegmentItemsExist`. **That separation already exists.** `deleteTravelSegmentForTripDay` (`travelSegmentRepo.ts:349-365`) checks the writer clause, looks the row up by `{ id: segmentId, tripDayId }`, and deletes it; `ensureSegmentItemsExist` has exactly two callers, `:292` (create) and `:328` (update). `DELETE /api/trips/[id]/travel-segments` accepts `{ tripDayId, segmentId }` and answers `200 { deleted: true }`.

What is missing is on the client: **nothing in `src/` ever issues that `DELETE`**, and the only way to reach a segment in the UI is `renderTravelSegment`, which requires the pair to be drawn. So `DW-151`'s "cannot be deleted through the UI" is true, and its stated cause is not. The consequence for implementation is precise: AC6 is a UI task, and touching `ensureSegmentItemsExist` or the delete repository path would be a change with no acceptance criterion behind it and a live risk of relaxing the creation refusal AC7 depends on. The required-red test the story asks for on the delete route would be green from the start, which is why AC1 (repository) and AC5 (component) carry that duty instead.

### `DW-148`'s decision is superseded, and the record should say so

`DW-148` carries a 2026-08-08 decision — "a segment whose endpoints are no longer adjacent is deleted" — which the story explicitly declines, on Story 6.23's own grounds: mode, duration and distance are user measurements and a visible gap beats a silent loss. `DW-151`'s later decision (2026-08-09, "surface undrawable segments as a removable row") and the epic context both agree with the story. The story governs; the delete-on-insert option is out of scope under **Never**. Note this in the ledger when the entries are closed, so the superseded decision is not read later as an unimplemented one.

### Why the accommodation sweep is trip-scoped

The activity helper takes the days it must sweep because an activity can only be an endpoint on its own day. A stay cannot: `buildSegmentTimeline` (`:222-234`) offers day N's accommodation as the leading endpoint of day N+1, so `[tripDayId]` alone would leave the next day's `stay → firstActivity` row behind — the same defect, one day over. Passing every day id of the trip is complete, is precise (endpoint ids are cuids, so no other trip's rows can match), and leaves the helper's signature unchanged for the activity callers.

### One array, not two opinions

`totalTravelMinutes` reduces over the fetched rows while the timeline draws consecutive pairs assembled inline at three places in the JSX. Any independent re-derivation of "what is drawn" — server-side classification included — can disagree with what the component actually rendered, and a disagreement in that direction recreates exactly this bug (counted, not drawn). Hence a single `timelineEndpoints` array feeding both the render and the drawn-key set.

**And the array has to be in the server's order, which is not the order the API sends.** Iteration 1 of this spec asserted that "the plan-item order is the API's own" and that this matched the repository — it does not. `getTripWithDaysForUser` returns `dayPlanItems` ordered by `createdAt` (`tripRepo.ts:897`); `buildSegmentTimeline` sorts by `comparePlanItemsByStartTime` (`travelSegmentRepo.ts:245`). They coincide only on a day whose activities happen to have been created in chronological order. On any other day the split inverted: with `Dinner` (19:00) created before `Museum` (09:00), the client's consecutive pair was `Dinner → Museum` — which the API refuses as `not_adjacent` — while the one row the API accepts, `Museum → Dinner`, was labelled an orphan, offered for deletion and dropped out of "Fahrzeit". Both reviewers reproduced it independently. Worse for the story's purpose, `DW-148` was untouched: a user inserts an activity by creating one with a middling `fromTime`, which appends it in `createdAt` order, so the previously-adjacent pair stayed adjacent on screen and its minutes went on being counted — the production symptom, surviving behind a green suite built on a fixture that could not occur.

The fix is one comparator in one module, imported by the adjacency rule and by the screen (`src/lib/trips/dayPlanItemOrder.ts`), and the day view ordering its activities by it. That also settles the day view's rendering, which has always been in creation order: a timeline whose rows are not in time order is a separate small wrong that this story cannot leave in place, because the leg between two cards must be the leg between those two endpoints. Only the two consumers whose disagreement is this defect are unified; `dayPlanItemRepo`'s copy and the print payload's are `DW-216`'s business, and deferred.

The previous-day half was and remains correct: `previousDay` is `orderedDays[currentIndex - 1]` (`:1350`, chronological) against the repository's nearest-lower `dayIndex`.

### Endpoint labels

An orphan's endpoints are ids plus a type discriminator, with no join. Resolve them against what the day already holds — `previousStay`, `currentStay`, `planItems` — and fall back to a translated "no longer on this day" for anything unresolved. Do not fetch to resolve a foreign endpoint: the row is being shown so it can be removed, and a label that cannot be found is itself the explanation.

## Verification

**Commands:**
- `cd travelplan && npm test` -- **run first and record the baseline file/test counts** (serial, `fileParallelism: false`). Expected at completion: green, no file lost.
- `cd travelplan && npx vitest run test/accommodationRepo.test.ts` -- expected **red** on the new stay-cleanup case before the repository change, green after. Record it.
- `cd travelplan && npx vitest run test/tripDayViewOrphanSegments.test.tsx` -- expected **red** before the component change, green after. Record it.
- `cd travelplan && npx vitest run test/tripDayViewLayout.test.tsx test/dayPlanItemRepo.test.ts test/travelSegmentRoute.test.ts` -- expected: unmodified and green; a changed travel-total assertion is a **Block If**, not an edit.
- `cd travelplan && npm run typecheck` -- expected: clean.
- `cd travelplan && npm run lint` -- expected: warning count unchanged from baseline, 0 errors.
- `cd travelplan && npm run build` -- expected: succeeds.

**Manual checks (if no CLI):**
- `grep -rn "removeTravelSegmentsReferencingDayPlanItem" travelplan/src` returns nothing; `grep -rn "ensureSegmentItemsExist" travelplan/src` still returns exactly its definition and the create/update call sites.
- `grep -rn "orphan" travelplan/src/i18n/en.ts travelplan/src/i18n/de.ts` returns the same key set in both files.


## Auto Run Result

Status: done — three review passes. Pass 1 found 8 `bad_spec` and looped back; pass 2 found none and applied nine patches; this follow-up pass found no `intent_gap` and no `bad_spec`, applied six patches, and recorded two new deferrals.

### What shipped

**Endpoint gone → delete.** `removeTravelSegmentsReferencingItemInTransaction` lives in `travelSegmentRepo.ts` and serves both members of `TravelSegmentItemType`; `dayPlanItemRepo`'s private copy is gone and its two call sites pass `"DAY_PLAN_ITEM"`; `deleteAccommodationForTripDay` wraps its delete in an interactive transaction and sweeps the **trip's** days — not just the stay's own, because `buildSegmentTimeline` offers day N's accommodation as day N+1's leading endpoint, so a day-scoped sweep would leave the next day's row behind (`DW-79`, `DW-215`).

**Adjacency changed → surface.** The day view derives one ordered endpoint list, and both what it draws and what it counts come from that array; everything else is listed below the stat strip as a removable orphaned leg with its endpoints, its recorded mode/duration/distance, and its minutes stated as uncounted (`DW-148`, `DW-151`). The `409` refusal is translated and points at that list. The removal goes through the `DELETE` the route has always accepted — no repository or route change was needed, because `deleteTravelSegmentForTripDay` never consulted `ensureSegmentItemsExist`; what was missing was any caller at all.

**One order, and now on both surfaces.** `dayPlanItemOrder.ts` holds the activity-order rule and `daySegmentPairs.ts` the drawn-pair rule; the day view, the overview timeline and the adjacency check all read them rather than each keeping an opinion. As of this pass neither client surface depends on the server having sorted first, and both dependencies are pinned by tests.

### Files changed

26 files against `850d633`. New: `src/lib/trips/dayPlanItemOrder.ts`, `src/lib/trips/daySegmentPairs.ts`, `test/dayPlanItemOrder.test.ts`, `test/accommodationDeleteRollback.test.ts`, `test/tripDayViewOrphanSegments.test.tsx`. Modified: the three repositories plus `tripRepo.ts`, `app/api/trips/[id]/route.ts` (payload gains `createdAt`), `TripDayView.tsx`, `TripTimeline.tsx`, `TripDayTravelSegmentDialog.tsx`, `lib/validation/tripImportSchemas.ts` (docblock only), both dictionaries, and seven test suites.

### Review findings

- Pass 1: 8 `bad_spec` (1 high), 5 deferred (`DW-318`..`DW-322`), 1 rejected. Code reverted, spec amended, code re-derived.
- Pass 2: 0 `intent_gap`, 0 `bad_spec`, 9 patches (3 medium), 0 new deferrals, 2 rejected.
- Pass 3 (this one): 0 `intent_gap`, 0 `bad_spec`, 6 patches (1 medium), 2 new deferrals (`DW-323`, `DW-324`), 12 rejected. The rejections were mostly findings the ledger already carries (`DW-319`..`DW-322`), plus ledger-status observations this run is not permitted to act on — the orchestrator owns entry status — and one deliberate, documented decision the reviewers re-litigated (the comparator returning `0` rather than falling through to `id` when `createdAt` is unknown; the proposed alternative would re-sort rather than tie-break, and a mixed payload is not reachable from the real API).
- **A correction is recorded in the Spec Change Log**: pass 1's headline root cause was wrong. Both reviewers, and my own half-verification, missed that `getTripWithDaysForUser` sorts activities in its mapping after the Prisma `orderBy`, so the payload already arrived in adjacency order. The ordering work is still justified — it replaced an invisible, unpinned dependency on that line and carried the `createdAt` the client needs for a same-minute tie — but the stated reason was not true, and the code comments repeating it were corrected too.

### Verification

- `npm test` — **150 files / 2353 tests passing** (baseline 147 / 2308; pass 2 ended at 150 / 2351, and this pass added two cases).
- `npm run typecheck` clean · `npm run lint` **0 errors, 79 warnings — exactly the baseline count** · `npm run build` compiles.
- **Required-red observed** (pass 2, and the record that satisfies the Boundaries' "record the observation" duty): the stay-cleanup case failed at baseline (`expected [3 items] to have a length of 1`), and the component's stranded-leg cases failed before the day view changed (`Travel time` read `1h 15m` where `30m` was owed).
- **Mutation-checked** across passes: the stay sweep, the shared comparator's use, the drawn-only travel total, the drawn-only coverage input, the `404` handling, the comparator's missing-`createdAt` fallback, the orphan delete wiring, the in-flight guard, the transaction, the accessible-name template, and — this pass — the overview bar's own ordering, whose new pin fails when the sort is neutralised.
- `grep`: no `removeTravelSegmentsReferencingDayPlanItem` in `src`; `ensureSegmentItemsExist` still has exactly its two callers (create, update); one private comparator copy remains (`dayPlanItemRepo.ts`, `DW-216`).

### Residual risks

- **`DW-318` is the sharpest**: shrinking a trip's date range still deletes a stay by cascade without sweeping the next day's legs — the same defect class this story closed on the delete path, reproduced by execution during review, and mechanical to fix now that the helper exists.
- Also open from this story's reviews: `DW-319` (the day-level activity transfer bulk-deletes both days' segments, contradicting the rule this story canonised), `DW-320` (the printed day sheet silently omits orphaned legs), `DW-321` (travel-segment API errors other than the conflict are untranslated English), `DW-322` (a *drawn* leg still cannot be deleted, only edited), and new this pass `DW-323` (a failed stay delete is reported as a missing CSRF token) and `DW-324` (every drawn leg's edit button shares one accessible name).
- Existing orphaned rows are deliberately **not** migrated: AC4's list is how their owner resolves them, which is safer than a migration guessing which rows were meant.
- Ledger bookkeeping is left to the orchestrator, as this run was instructed: `DW-79`, `DW-148`, `DW-151` and `DW-215` are the entries this story answers, and `DW-148`'s superseded 2026-08-08 "delete the stranded segment" decision should be closed as superseded rather than unimplemented. `DW-216`'s location list is also now partly stale — two of its three named copies import the shared module, and one private copy survives in `dayPlanItemRepo.ts`.

### Follow-up review

Not recommended. This pass's six fixes are localized and low-consequence: three are in one handler (`handleRemoveOrphanSegment`'s rollback and its `404` branch), one is a docblock, one is a test, and the sixth is a small, additive change to a second component that arrived with its own mutation-checked pin. The only signature change — `loadDay({ silent })` — is additive and off by default, and the full suite, typecheck, lint and build were re-run green over all of it. Nothing here reaches new behaviour, API surface, security or data the way pass 2's nine did.
