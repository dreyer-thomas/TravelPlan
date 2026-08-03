---
authored_against: 03af7c7
---

# Story 2.35: The Import Accepts a Valid Backup

Status: ready-for-dev

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

- [ ] **Task 1 — Widen the endpoint check** (AC: 1, 5)
  - [ ] `tripImportSchemas.ts:515-518` builds `resolves` from *this* day alone:
        `itemType === "accommodation" ? itemId === accommodationId : planItemIds.has(itemId)`.
        The comment above it states the assumption — "A segment's endpoints must be records of *this* day" — and that assumption is what is wrong.
  - [ ] `previousStay` is `previousDay?.accommodation` (`TripDayView.tsx:1092`), and `previousStaySegment` carries `id: previousStay.id`. So a segment on day N legitimately points at day N−1's accommodation.
  - [ ] **The importer already handles it.** `accommodationIdBySourceId` (`tripRepo.ts:1823`) is declared *outside* the `for (const day of sortedDays)` loop and filled as each day is created, so an earlier day's accommodation is already mapped when a later day's segments are written. Only the guard in front rejects it. Confirm this before writing code — it decides whether this is a one-line fix or a rework.
  - [ ] Accept an accommodation from the current or an **earlier** day. The tight rule mirrors the feature (`previousDay` is exactly one back); a looser "any day in the payload" would also work with the trip-wide map. Choose, and say which and why.

- [ ] **Task 2 — Skip rather than refuse** (AC: 2, 3)
  - [ ] An endpoint matching nothing in the payload is a genuine orphan — from an activity deleted before Story 6.23 fixed the cause. Those rows exist in every database that predates it.
  - [ ] Drop the segment and record a warning. `meta.warnings` already exists and `TripImportDialog` already renders "what the export itself had already dropped" — reuse that channel.
  - [ ] The importer's `if (!fromItemId || !toItemId)` branch already stands where an unresolvable pair lands. Check what it does today; if it already skips, this task is mostly about letting the payload reach it.

- [ ] **Task 3 — Tests** (AC: 1, 2, 6)
  - [ ] A payload whose day-2 segment references day-1's accommodation validates and imports, with the segment present afterwards.
  - [ ] A payload with an endpoint matching nothing imports, without that segment, and reports one warning.
  - [ ] The counts in the response still add up when segments are skipped.
  - [ ] `tripBackupRoundTrip.test.ts` stays green.
  - [ ] `npm test` green.

- [ ] **Task 4 — Manual check** (AC: 4)
  - [ ] Import `~/Downloads/trip-neuseeland-2026-08-03.zip` against a throwaway copy of `dev.db` on an isolated port — never `prisma/dev.db`.
  - [ ] Expect 41 days, 150 photos, and a warning naming the **9** skipped segments.
  - [ ] Spot-check a day that had a previous-night segment and confirm it is present rather than skipped — 27 of the 36 rejections were that case, and turning them into warnings instead of imports would be the wrong fix passing its own test.

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

### Debug Log References

### Completion Notes List

### File List

### Change Log
