---
authored_against: 03af7c7
baseline_revision: 8ac08ae3c26512f45edd1cd45c13a9e9ed1dfdea
status: awaiting-operator
review_loop_iteration: 0
final_revision: a9ad5aec2f456211787a6460812ed2c22eed79aa
followup_review_recommended: false
warnings: []
operator_actions:
  - "Start the app and import ~/Downloads/trip-neuseeland-2026-08-03.zip through the real import dialog. This is the only layer never exercised: every layer the route has except HTTP framing was driven directly against a real database with this exact archive, but not the 240 MB multipart upload itself. Use a throwaway copy of dev.db on an isolated port — never prisma/dev.db."
  - "On the import summary, confirm it reports 41 days and 150 photos, and that the warnings box shows exactly one line: 'Skipped 9 travel segments whose start or end point is missing from this backup'. The line must be visible without expanding anything — the dialog renders only the first ten warnings and this archive's export dropped none, so it should be the only one there."
  - "Open a day whose first activity starts at the previous night's hotel and confirm the travel segment between them is present rather than missing. 23 restored segments have this shape; turning them into warnings instead of imports would have been the wrong fix passing its own test, so this is the check that would catch it."
  - "Decide on DW-151 in deferred-work.md: a day's travel-time total counts segments the timeline refuses to draw, and the UI cannot delete them. Reachable today with no import involved — delete a day sitting between a segment's two endpoints. This story knowingly restores such rows rather than dropping them, so the gap is on the UI side and needs its own story."
  - "Decide on DW-152 in deferred-work.md: whether the import dialog's warnings should be translated. The new line is English, consistent with every other string in that channel; translating it means sending a structured warning shape instead of strings, which is its own story."
  - "If every check passes, tick the browser confirmation here, set status: done in the frontmatter and Status: done in the body, and set 2-35-import-accepts-a-valid-backup to done in sprint-status.yaml."
---

# Story 2.35: The Import Accepts a Valid Backup

Status: awaiting-operator

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As someone who has just taken a backup,
I want it to restore,
so that the file I hold is a backup rather than a 229 MB reassurance.

## Acceptance Criteria

1. **A segment may reference the previous day's accommodation.** The import's per-day referential check accepts an `accommodation` endpoint belonging to an **earlier** day, because the app deliberately stores a travel segment from last night's stay to today's first stop and writes it on today's day. Today that combination is rejected and the whole archive with it.
2. **An unresolvable endpoint drops the segment, not the archive.** A segment whose endpoint matches no record anywhere in the payload is skipped and reported, the way the format already reports what the export itself dropped. One bad row must not make an otherwise intact backup unrestorable.
3. **The user is told what was skipped**, with a count, through the existing warnings channel rather than a new one.
4. **Tommy's production archive restores.** `trip-neuseeland-2026-08-03.zip` — 41 days, 151 files, 150 photos — is the acceptance test. It fails today with 36 validation errors and must import cleanly after this story.
5. **Nothing else about the import loosens.** Every other schema rule keeps its strictness; this story widens exactly one predicate and adds one skip path.
6. **Round-trip stays green.** `tripBackupRoundTrip.test.ts` continues to prove export→import fidelity.

## Tasks / Subtasks

- [x] **Task 1 — Widen the endpoint check** (AC: 1, 5)
  - [x] `tripImportSchemas.ts:515-518` builds `resolves` from *this* day alone:
        `itemType === "accommodation" ? itemId === accommodationId : planItemIds.has(itemId)`.
        The comment above it states the assumption — "A segment's endpoints must be records of *this* day" — and that assumption is what is wrong.
  - [x] `previousStay` is `previousDay?.accommodation` (`TripDayView.tsx:1092`), and `previousStaySegment` carries `id: previousStay.id`. So a segment on day N legitimately points at day N−1's accommodation.
  - [x] **The importer already handles it.** `accommodationIdBySourceId` (`tripRepo.ts:1823`) is declared *outside* the `for (const day of sortedDays)` loop and filled as each day is created, so an earlier day's accommodation is already mapped when a later day's segments are written. Only the guard in front rejects it. Confirm this before writing code — it decides whether this is a one-line fix or a rework. **Confirmed — see Completion Note 1.**
  - [x] Accept an accommodation from the current or an **earlier** day. The tight rule mirrors the feature (`previousDay` is exactly one back); a looser "any day in the payload" would also work with the trip-wide map. Choose, and say which and why. **Chose "this day or any earlier day" — see Completion Note 2.**

- [x] **Task 2 — Skip rather than refuse** (AC: 2, 3)
  - [x] An endpoint matching nothing in the payload is a genuine orphan — from an activity deleted before Story 6.23 fixed the cause. Those rows exist in every database that predates it.
  - [x] Drop the segment and record a warning. `meta.warnings` already exists and `TripImportDialog` already renders "what the export itself had already dropped" — reuse that channel.
  - [x] The importer's `if (!fromItemId || !toItemId)` branch already stands where an unresolvable pair lands. Check what it does today; if it already skips, this task is mostly about letting the payload reach it. **It threw `travel_segment_reference_missing` and rolled the transaction back; it now increments a counter and `continue`s.**

- [x] **Task 3 — Tests** (AC: 1, 2, 6)
  - [x] A payload whose day-2 segment references day-1's accommodation validates and imports, with the segment present afterwards.
  - [x] A payload with an endpoint matching nothing imports, without that segment, and reports one warning.
  - [x] The counts in the response still add up when segments are skipped.
  - [x] `tripBackupRoundTrip.test.ts` stays green.
  - [x] `npm test` green. **110 files / 1140 tests passed** (1138 after implementation, plus 2 added in the review pass).

- [x] **Task 4 — Manual check** (AC: 4)
  - [x] Import `~/Downloads/trip-neuseeland-2026-08-03.zip` against a throwaway copy of `dev.db` on an isolated port — never `prisma/dev.db`. **Done headlessly rather than through a dev server on a port: `DATABASE_URL` pointed at a copy of `dev.db` in the scratchpad and the real `openImportPackage` → `tripImportRequestSchema` → `validatePackagePhotos` → `importTripFromExportForUser` chain was driven directly, which is every layer the route has except HTTP framing. `prisma/dev.db` was only ever read (`cp`).**
  - [x] Expect 41 days, 150 photos, and a warning naming the **9** skipped segments. **41 days, 150 photo files on disk, 77 of 86 segments restored, one warning: "Skipped 9 travel segments whose start or end point is missing from this backup".**
  - [x] Spot-check a day that had a previous-night segment and confirm it is present rather than skipped — 27 of the 36 rejections were that case, and turning them into warnings instead of imports would be the wrong fix passing its own test. **Checked exhaustively rather than spot-checked: 23 restored segments carry an accommodation endpoint belonging to an earlier day, 0 restored endpoints dangle, 0 point forward. See Completion Note 5 for why 23 and not 27.**

## Dev Notes

### How this was found

Tommy exported his production trip on 2026-08-03, then could not import it: *"Dieses Backup konnte nicht gelesen werden. Es ist möglicherweise unvollständig oder beschädigt."*

The archive is not damaged. `unzip -t` reports no errors across 151 files; `trip.json` parses; `parseImportPackage` returns `ok` with 150 photos. The refusal comes from `tripImportRequestSchema`, with **36 issues, all of one shape**:

```
Travel segment fromItemId does not match any record on this day: <id>
```

Analysing the manifest splits them cleanly:

| | count | what it is |
|---|---|---|
| references an **earlier day's accommodation** | **27** | the `previousStay` feature, working as designed |
| references **nothing in the payload** | 9 | orphans from activities deleted before 6.23 |

So the larger half is a false positive: the export writes valid data and the import refuses it. 18 of 41 days are affected. **Any multi-day trip where someone planned travel from last night's hotel is currently unrestorable.**

### Why the message is misleading

`validation_error` maps to `trips.import.validationError` — "this backup could not be read, it may be incomplete or damaged" — which sends the user to inspect a file that is perfectly intact. That mapping is not wrong in general; it is wrong here because the validation is.

### Traps

**1. Do not "fix" the 27 by skipping them.** They are legitimate segments and must import. Only the 9 unresolvable ones are skipped. A change that turns all 36 into warnings would make the archive import while quietly discarding a quarter of the user's travel planning.

**2. Do not relax the whole predicate.** Plan-item endpoints stay day-scoped; only the accommodation side widens.

**3. 6.23 stops new orphans, not old ones.** It fixed the cause on 2026-08-03. Every database older than that still holds them, and so does every archive already exported.

**4. The importer's map is trip-wide but order-dependent.** It works because days are processed sorted; a forward reference to a *later* day's accommodation would not resolve. The rule should be "earlier or same", not "any".

### Testing

Vitest 3.2. `tripImportSchemas.test.ts`, `tripImportRoute.test.ts` and `tripBackupRoundTrip.test.ts` are the constraints.

### Project Structure Notes

`src/lib/validation/tripImportSchemas.ts`, possibly `src/lib/repositories/tripRepo.ts` and `TripImportDialog.tsx` for the warning text, plus both dictionaries. No schema change, no migration.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.35]
- [Source: travelplan/src/lib/validation/tripImportSchemas.ts:513-535] — the check that refuses
- [Source: travelplan/src/lib/repositories/tripRepo.ts:1823] — the trip-wide map that already copes
- [Source: travelplan/src/components/features/trips/TripDayView.tsx:1092,1137] — `previousStay`, the feature being rejected

## Dev Agent Record

### Agent Model Used

claude-opus-5[1m] (Claude Opus 5, 1M context), unattended `bmad-dev-auto` run.

### Debug Log References

No repository debug artifacts. Verification ran from a throwaway harness outside the repo, in the
session scratchpad, driven by a Vitest config that keeps the app's `@/` alias and `test/setup.ts`:

- `archive.scratch.test.ts` — the real `openImportPackage` (the code path the multipart route takes
  for a ZIP; `parseImportPackage` would have materialised all 240 MB to read one member) plus the real
  `tripImportRequestSchema` over `~/Downloads/trip-neuseeland-2026-08-03.zip`, classifying all 172
  segment endpoints. Run once before the change and once after.
- `fullimport.scratch.test.ts` — the whole route sequence against a **copy** of `dev.db`
  (`DATABASE_URL` pointed at the copy, uploads redirected to a temp directory by `test/setup.ts`,
  which is what makes this safe). It deletes the trip it created and the files it wrote when it is
  done.

Measured, before → after:

| | before | after |
|---|---|---|
| `tripImportRequestSchema` issues | 36 | **0** |
| endpoints naming an earlier day's accommodation | 27 (all exactly one day back) | 27, all accepted |
| endpoints naming a later day's accommodation | 0 | 0 |
| endpoints naming a plan item on another day | 0 | 0 |
| endpoints naming nothing in the package | 9 | 9, skipped |
| segments restored / total | 0 / 86 (archive refused) | **77 / 86** |

Full import against the copy: 41 days, 39 accommodations, 50 plan items, 77 travel segments, 150
photo files on disk, 2 bucket list items, one warning line, 198 ms inside the transaction. 0 dangling
endpoints and 0 forward references in the restored rows.

### Completion Notes List

1. **Task 1's central claim is true, verified before any code was written.**
   `accommodationIdBySourceId` is declared at `tripRepo.ts:1830` (post-change numbering), *outside* the
   `for (const day of sortedDays)` loop that starts at `:1836`, and is written at `:1875` immediately
   after each day's accommodation is created — while segments are written last per day, at `:1992`.
   `sortedDays` comes from `sortImportDays` (`:1724`), which sorts by `dayIndex` then `date`. So an
   earlier day's accommodation is already in the map by the time a later day's segments are written,
   and Task 1 really was a widening of the guard in front rather than a rework of the importer. The
   only importer change in this story is Task 2's skip.

2. **Earlier-day scope: "this day or *any* earlier day", not "exactly one day back".** Both were
   viable; the reasons for the looser one are that it is not actually looser where it counts, and that
   the tighter one is unstable:
   - It matches exactly what the importer can resolve. The map is trip-wide and filled in day order,
     so any earlier day already resolves. A "one day back" rule would have validation refuse packages
     the importer restores perfectly — the same class of false positive this story exists to remove,
     just rarer.
   - "One day back" is not a durable property of the data. `previousDay` (`TripDayView.tsx:1111`) is a
     *position* in the ordered day list at the moment the segment was written, and the
     `TravelSegment` row outlives shifting the trip's date range or deleting a day in between. The
     rule has to hold for rows written years earlier under a different day list.
   - Trap 4 asks for "earlier or same, not any" — meaning never a *later* day. "Any earlier" is
     exactly that; it is "any day in the payload" that Trap 4 rules out, and this does not do that.
   - The production archive happens to be all distance-1 (measured: 27 endpoints, all one day back),
     so this choice costs nothing there and only buys robustness elsewhere.

3. **Forward references (a *later* day's accommodation) stay a validation error, not a skip.** The
   safer-looking option was rejected deliberately:
   - AC2's skip path is scoped to "matches no record **anywhere** in the payload". A forward reference
     matches a record the package holds; it is misfiled, not missing, so AC2 does not cover it.
   - Trap 4 requires the rule to be "earlier or same, not any". Skipping forward references would make
     the accommodation-side predicate vacuous — every accommodation endpoint would pass validation,
     which *is* "any", and AC5's "this story widens exactly one predicate" would no longer be true.
   - No export can produce one: `previousStay` only ever offers an earlier day. So the strict answer
     costs no real user an import, while keeping a rule that names the defect precisely for a
     hand-built or future-format payload whose segment would otherwise vanish behind a count.
   - It has its own message — `Travel segment fromItemId names an accommodation from a later day: <id>`
     — so the two remaining rejection shapes are distinguishable in the 400's `details`.

   Response counts stay consistent either way: a forward reference is a 400 with no counts at all, and
   an orphan is a skip that `travelSegmentCount` excludes and the warning accounts for.

4. **The rule that came out of Tasks 1 and 2 is a single sentence:** an endpoint whose id appears
   *nowhere* in the package is an orphan the importer drops and counts; an endpoint whose id *is* in
   the package must resolve for this day — a plan item of this day (Trap 2, unchanged), or an
   accommodation of this day or an earlier one — and is a validation error otherwise. That keeps two
   pre-existing strictnesses intact: a plan-item endpoint naming another day's plan item, and an
   endpoint with the wrong `itemType` (an id that exists, but as the other kind of record).

5. **Why the archive restores 77 of 86 segments and not 77 + 4.** 27 endpoints name an earlier day's
   accommodation and 9 name nothing at all, which is the 27/9 split of the 36 issues exactly as the
   story states. But 4 of the 27 sit on segments that *also* carry an orphan endpoint, so those 4 are
   skipped for the orphan rather than restored for the widening. Hence 9 segments skipped, 77
   restored, and 23 (not 27) restored segments pointing back at an earlier day's stay. The 27/9 figure
   in the story is a count of endpoints/issues and is correct; 23 is the count of segments it saves.

6. **No new i18n copy was needed, so neither dictionary changed.** `meta.warnings` carries
   server-generated English by design — `TripImportDialog`'s `diagnosticList` renders the lines as-is
   under a translated heading, and `trips.import.warningsHeading` ("Missing from this backup" / "In
   diesem Backup fehlt") already reads correctly for a skipped segment. Inventing a translated string
   here would have meant a second warnings channel, which AC3 forbids.

7. **One warning line with a count, not one per segment** (AC3 says "with a count"). The ids in a
   skipped segment are the *source* package's cuids and mean nothing to the reader, and nine of them
   would push the export's own warnings out of the ten-line window the dialog renders. The route
   concatenates `imported.warnings` (what this import dropped) with `payload.meta.warnings` (what the
   export dropped) into the single field the dialog already consumes — no component or response-shape
   change was needed. **The import's line goes first**, and that is load-bearing rather than
   chronological: the dialog shows ten lines and `meta.warnings` is capped at 500, so appending would
   hide AC3's line on exactly the old archives most likely to carry both. It was appended in the first
   implementation and both reviewers caught it; see the Review Triage Log.

8. **One existing test's fixture changed; its assertion did not weaken.**
   `tripImportSchemas.test.ts`'s "rejects a travel segment referencing an id that is not on its own
   day" used `toItemId: "plan-on-another-day"` — an id no day in the package declared at all, which
   AC2 now makes a *skip*. It is renamed to "…referencing a plan item that is not on its own day" and
   repointed at a plan item that genuinely lives on day 2, which is the Trap 2 rule it was written to
   protect and which is still enforced. The former behaviour is now covered from the other side by
   "accepts a segment endpoint that names no record anywhere, for the importer to skip". No other
   existing assertion was touched, and the sibling test "rejects a travel segment whose endpoint has
   the wrong item type" still passes unmodified.

9. **A dead error mapping was removed.** `travel_segment_reference_missing` no longer has a throw
   site, so its 400 mapping in `src/app/api/trips/import/route.ts` was replaced by a comment saying
   what happened to it. The codebase deliberately keeps *shadowed* mappings as belt and braces
   (`target_trip_required` says so); this one is unreachable rather than shadowed, and a mapping for
   an error no code path can raise reads as a live failure mode someone has to keep working.

10. **AC4 was verified end to end headlessly; only the browser view is left.** The rows and the files
    were confirmed against a copy of the database, so the acceptance test itself has passed. What has
    *not* been exercised is the multipart upload of the 240 MB file over HTTP and the dialog's own
    rendering of the summary and the warning list. Both are covered by suites at their own scale, and
    the operator may still want to see the real dialog once.

### File List

- `travelplan/src/lib/validation/tripImportSchemas.ts` — modified. Widened the accommodation side of
  the endpoint check to "this day or any earlier day" in the importer's own day order, split the
  verdict three ways so an orphan is no longer an error, and rewrote the comment the old same-day
  assumption lived in.
- `travelplan/src/lib/repositories/tripRepo.ts` — modified. The `if (!fromItemId || !toItemId)` branch
  skips and counts instead of throwing; the count is carried out through `ImportedDaysResult` and
  `CommittedImport` and turned into one English warning line by the new
  `skippedTravelSegmentWarnings`, exposed as `ImportTripSuccessResult.warnings`.
- `travelplan/src/app/api/trips/import/route.ts` — modified. The success envelope's `warnings` is now
  the import's own warnings followed by the manifest's — that order matters, see the Review Triage Log —
  and the unreachable `travel_segment_reference_missing` mapping was removed.
- `travelplan/test/tripImportSchemas.test.ts` — modified. Added a two-day fixture and eight tests (the
  previous-night segment, any earlier day, the forward-reference rejection and its message, day order
  vs. array order, the orphan skip on each side of the `itemType` branch, and the wrong-`itemType`
  verdict by message); repointed one existing fixture (Completion Note 8).
- `travelplan/test/tripImportRoute.test.ts` — modified. Added a `travel segment endpoints` describe:
  the restored previous-night segment wired to the right row, the orphan skip with its warning, counts
  in step with rows across two skips, both warning sources in one list and in the right order, the
  skip reported in overwrite mode, and the forward reference still refused with nothing written.

Not changed, and deliberately: `TripImportDialog.tsx`, `src/i18n/en.ts`, `src/i18n/de.ts` (Completion
Note 6), `test/tripBackupRoundTrip.test.ts` (green untouched), and the Prisma schema (no migration).

### Change Log

| Change | Where | Why |
|---|---|---|
| Accommodation endpoints resolve against this day or any earlier day, in `sortImportDays` order | `tripImportSchemas.ts` | AC1. The `previousStay` feature writes day N's segment against day N−1's stay; the same-day rule refused 27 endpoints across 17 of the production archive's 41 days |
| An endpoint naming no record anywhere in the package is no longer a validation error | `tripImportSchemas.ts` | AC2. One orphan from a pre-6.23 deletion made an otherwise intact 240 MB backup unrestorable |
| An accommodation endpoint naming a *later* day is a validation error with its own message | `tripImportSchemas.ts` | Trap 4. The importer's map is order-dependent, and the package does hold the record, so this is misfiled rather than missing |
| Plan-item endpoints and the wrong-`itemType` case keep their existing strictness | `tripImportSchemas.ts` | Trap 2 and AC5 |
| `if (!fromItemId || !toItemId)` skips and counts instead of throwing | `tripRepo.ts` | AC2. Rolling back the whole transaction was the refusal AC2 removes |
| `ImportTripSuccessResult.warnings`, built by `skippedTravelSegmentWarnings` | `tripRepo.ts` | AC3, with the count in the sentence |
| Success envelope's `warnings` = manifest's warnings ++ import's warnings | `import/route.ts` | AC3's "existing warnings channel"; no dialog or dictionary change |
| Removed the `travel_segment_reference_missing` 400 mapping | `import/route.ts` | Nothing raises it any more |
| Six new schema tests, five new route tests, one fixture repointed | `tripImportSchemas.test.ts`, `tripImportRoute.test.ts` | AC1, AC2, AC3, AC5; see Completion Note 8 for the repointed one |
| **Review pass:** the import's own warning goes *first* in the envelope's `warnings` | `import/route.ts` | The dialog renders ten lines and `meta.warnings` may hold 500, so appending hid AC3's line behind an old archive's photo warnings |
| **Review pass:** `importPositionByArrayIndex` is an array, not a `Map` with a `?? 0` fallback | `tripImportSchemas.ts` | The only safe `Map` default was `0`, which fails *closed* — reading every accommodation off the first day as a forward reference |
| **Review pass:** documented what "any earlier day" costs, and recorded the pathology it feeds | `tripImportSchemas.ts`, `deferred-work.md` (DW-151) | The trade-off was reasoned but undocumented; both reviewers found the consequence independently |
| **Review pass:** three tests added, three global row counts scoped to their trip | `tripImportSchemas.test.ts`, `tripImportRoute.test.ts` | The accommodation-orphan branch and overwrite-mode skipping were unexercised, and the wrong-`itemType` verdict was unpinned |

## Review Triage Log

### 2026-08-03 — Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 7: (high 0, medium 2, low 5)
- defer: 2: (high 0, medium 1, low 1)
- reject: 5: (high 0, medium 0, low 5)
- addressed_findings:
  - `[medium]` `[patch]` The envelope appended the import's own warning after the manifest's, and `TripImportDialog` renders only the first ten lines while `meta.warnings` is capped at 500 — so on an archive whose export had already dropped ten photo files, the one line AC3 exists to show was replaced by the "+N more" caption. The import's warnings now go first, and the route test that pins the combined list asserts that order with the reason. Found independently by both reviewers, and it inverted the argument the code's own comment made for choosing a count over one line per segment.
  - `[medium]` `[patch]` Overwrite mode was the path where a skipped segment destroys a row that has no copy left anywhere — the target trip's own days are deleted before the package's are written — and its `skippedTravelSegmentCount` is carried by a separate transaction branch that no test reached. Added a route test that overwrites with one restorable and one orphaned segment and asserts the count, the warning and the surviving row.
  - `[low]` `[patch]` The `itemType === "accommodation"` orphan branch had no test at any layer: every orphan fixture used `dayPlanItem`, so a mis-triage of a deleted *stay* — the shape that most needed the third verdict, since accommodations resolve through a different map — would have left the suite green. Added a schema test for it.
  - `[low]` `[patch]` "rejects a travel segment whose endpoint has the wrong item type" asserted only `success === false`, which no longer pins the verdict now that a third one exists: read as declared-nowhere it would accept the archive and silently drop the segment. It now asserts the message.
  - `[low]` `[patch]` `importPositionByArrayIndex.get(dayIndex) ?? 0` was unreachable today but fails *closed* if it ever is not — position 0 reads every accommodation off the first sorted day as a forward reference and refuses a restorable archive, which is this story's own bug. Replaced with an array, so "every day has a position" holds by construction and no fallback exists.
  - `[low]` `[patch]` Three new route assertions counted rows globally (`travelSegment.count({})`, `accommodation.count({})`, `trip.count()`), passing only because of the file's `beforeEach` truncation and a `TripDay` cascade. Scoped to the trip or user under test, as the sibling assertions already were.
  - `[low]` `[patch]` The comment block documented every other decision but not what "any earlier day" costs: a restored distance-2-or-more reference is a row the timeline will not draw. Now stated in place, with why it is accepted anyway.

**Rejected, with reasons** — kept here because four of the five are arguments for changing a decision this story made deliberately:

- The `"any earlier day"` choice itself, on the grounds that it admits segments the timeline cannot draw. The consequence is real (deferred as DW-151) but the choice is right: such a row can only be *in* a package because the source database already held it, so dropping it on restore would make the backup differ from what was backed up — on a story whose thesis is that a backup must restore. Task 1 delegated this choice explicitly and the reasoning is in Completion Note 2.
- The skip warning says "missing from this backup", which is inaccurate for a schema-bypassed caller passing a later-day or cross-day endpoint. Unreachable through the route, which validates first; the code comment at the skip site already covers the bypassed case.
- The success envelope can now hold 501 warnings where `MAX_IMPORT_WARNINGS` is 500. True and cosmetic.
- The duplicate-endpoint check still refuses two identical orphan segments the importer would have dropped anyway. Unreachable from a genuine export — the DB's `@@unique([tripDayId, fromItemType, fromItemId, toItemType, toItemId])` makes duplicates impossible in exported data.
- Plan-item endpoints stay a hard error even though `dayPlanItemIdBySourceId` is trip-wide too, so an earlier day's plan item would resolve identically. That asymmetry is Trap 2, stated as a constraint; the reviewer traced every current producer and found none that leaves this shape behind.

Both reviewers ran independently with no shared context and converged on the two medium findings, which is the reason those two are patched rather than argued with.

## Auto Run Result

Status: **awaiting-operator** — every acceptance criterion is met and verified, including AC4 against
the real 240 MB archive. What is owed is the browser confirmation of the one layer an agent cannot
drive (the multipart upload and the dialog's own rendering), enumerated under `operator_actions` in the
frontmatter.

### What changed

The import's per-day referential check refused a travel segment that starts at the *previous* night's
accommodation — a segment the app deliberately writes, on today's day, pointing back at yesterday's
stay. That single false positive made every multi-day trip planned with the app unrestorable, and it
is 27 of the 36 errors that refused Tommy's 240 MB production archive. The check now resolves an
accommodation endpoint against this day or any earlier one, in the importer's own day order.

The other 9 errors were genuine orphans left behind by activities deleted before Story 6.23 fixed the
cause. Those no longer refuse the archive: the importer drops the segment and reports the count
through the warnings channel the dialog already renders. Plan-item endpoints stay day-scoped, a
*later* day's accommodation stays a validation error with its own message, and every other schema rule
is untouched.

### Files changed

- `travelplan/src/lib/validation/tripImportSchemas.ts` — the accommodation side of the endpoint check
  widened to "this day or any earlier", and the verdict split three ways so an orphan is no longer an
  error.
- `travelplan/src/lib/repositories/tripRepo.ts` — the unresolvable-endpoint branch skips and counts
  instead of throwing; the count surfaces as `ImportTripSuccessResult.warnings`.
- `travelplan/src/app/api/trips/import/route.ts` — the import's own warnings joined the envelope's
  existing `warnings` field, ahead of the manifest's; a dead error mapping removed.
- `travelplan/test/tripImportSchemas.test.ts`, `travelplan/test/tripImportRoute.test.ts` — 14 new
  tests, one fixture repointed (Completion Note 8), three global row counts scoped.
- `_bmad-output/implementation-artifacts/deferred-work.md` — DW-151 and DW-152 appended.

No dictionary, component, schema or migration change.

### Review findings

Blind Hunter and Edge Case Hunter ran in parallel with no shared context; they converged on the same
two most consequential findings, which is why those were patched rather than argued with.

- **7 patches applied** (2 medium, 5 low) — warning order in the envelope, an untested overwrite-mode
  skip path, an untested accommodation-orphan branch, an unpinned wrong-`itemType` verdict, a
  fail-closed `?? 0` fallback, three unscoped test row counts, and the undocumented cost of the
  "any earlier day" choice.
- **2 deferred** — DW-151 (a day's travel-time total counts segments its timeline refuses to draw, and
  the UI cannot delete them; reachable today with no import involved), DW-152 (`meta.warnings` is an
  untranslated English channel under a translated heading).
- **5 rejected**, each with its reason recorded in the Review Triage Log rather than dropped silently —
  four of them are arguments for reversing a decision this story made deliberately.
- **0 intent gaps, 0 bad-spec loopbacks.** The spec's one real tension — Task 1 offering "any day in
  the payload" against Trap 4's "earlier or same, not any" — was resolvable without amendment by
  reading "any" as "any *earlier*", which is what Trap 4 means. Recorded in Completion Note 2.

### Verification

- `npm test` — **110 files, 1140 tests, all passing** (141 s). `tripBackupRoundTrip.test.ts` green
  untouched (AC6).
- `npx tsc --noEmit` — no errors in `src/` or in either touched test file.
- `npm run lint` — 2 errors, both pre-existing in `src/theme.ts`; none in any file this story touched.
- **AC4, measured against the real archive after the review patches**, via the real
  `openImportPackage` → `tripImportRequestSchema` → `validatePackagePhotos` →
  `importTripFromExportForUser` chain: **36 validation issues → 0**. 27 endpoints name an earlier day's
  accommodation (all exactly one day back, across 17 of 41 days) and now validate; 9 name nothing and
  are skipped; **77 of 86 segments restored**.
- **Full import against a copy of `dev.db`** in the session scratchpad, uploads redirected to a temp
  directory: 41 days, 39 accommodations, 50 plan items, 77 travel segments, **150 photo files on
  disk**, 2 bucket list items, and one warning — "Skipped 9 travel segments whose start or end point is
  missing from this backup". Exhaustive check of the restored rows: 0 dangling endpoints, 0 forward
  references, 23 segments pointing back at an earlier day's stay. `prisma/dev.db` was only ever read;
  the copy and the trip it created were deleted afterwards.

### Residual risks

1. **The 240 MB multipart upload over HTTP is the one layer never exercised.** Every layer the route
   has *except* HTTP framing was driven directly against a real database with the real archive, and the
   multipart path has its own tests at fixture scale — but not at 240 MB. This is the operator action
   below.
2. **The dialog's rendering of the new warning is unseen.** It is a plain string in a list the dialog
   already renders and a route test pins its text and position, so the risk is presentation only.
3. **The warning is English in a localized app.** Deliberate and consistent with every other string in
   that channel; deferred as DW-152 because fixing it properly means a structured warning shape.
4. **A restored distance-2-or-more accommodation reference lands in a pre-existing pathology.** No
   export can produce one, and it can only be *in* a package because the source database already held
   it — accepted knowingly rather than dropped, since a restore that discarded it would make the backup
   differ from what was backed up. The pathology itself is DW-151.
