---
authored_against: 84fd6fb
baseline_commit: 84fd6fb94d399bda42765a576c3061a003f3e402
---

# Story 8.4: Media Deletion That Deletes Only Its Own File

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## ⛔ This bundle contains the ledger's only `high`

Four deferred-work entries, all about code that destroys or mislabels files that are not its own. They are grouped because they share one failure shape — a write path whose blast radius is wider than the thing it was asked to change — and because three of the four are one-file fixes that are only worth a story together.

| Entry | Severity | What it does |
|---|---|---|
| **DW-194** | **high** | Removing a day image deletes every photo and document on that day |
| DW-86 | medium | Two concurrent overwrite imports destroy each other's photo files |
| DW-88 | medium | A create-new import can render another user's photo |
| DW-195 | medium | A failed unlink reports "removal failed" for a row that is already gone |

DW-86 and DW-88 **already carry recorded decisions** from the 2026-08-08/09 sweeps. Those decisions are the specification here — do not re-open them.

## DW-194 — the one that loses bytes

`PATCH { imageUrl: null }` on the day-image route cleans up one file by removing the entire day directory:

```ts
// src/app/api/trips/[id]/days/[dayId]/image/route.ts:225-229
const dayUploadPathPrefix = `/uploads/trips/${tripId}/days/${dayId}/`;
if (nextImageUrl === null || (typeof nextImageUrl === "string" && !nextImageUrl.startsWith(dayUploadPathPrefix))) {
  const uploadDir = getTripDayUploadDir(tripId, dayId);
  await fs.rm(uploadDir, { recursive: true, force: true });
}
```

That directory is the parent of every medium on the day, by construction in `uploadPaths.ts:94-121`:

```
days/<dayId>/
├── <the day image>                     ← the only file this route owns
├── accommodations/<id>/…               ← stay photos
│   └── documents/…                     ← stay documents  (Story 9.1)
└── day-plan-items/<id>/…               ← activity photos
    └── documents/…                     ← activity documents
```

So one click unlinks every ticket PDF and every gallery photo on that day **while touching no row**. The chips and strips keep rendering and every one of them 404s. An export can then only emit `Skipped document whose file is missing on disk`. The bytes are gone.

Two triggers, not one: the condition also fires when the new `imageUrl` is a string that does not start with the day prefix — i.e. replacing the day image with an external URL destroys the day's media just as removing it does.

### ⚠️ The ledger's suggested fix rests on a false premise

DW-194 says *"the route already knows the previous `imageUrl`"*. **It does not.** `updateTripDayImageForUser` (`tripRepo.ts:1084-1097`) looks the day up with `select: { id: true }`, then issues a raw `UPDATE` and re-reads the **new** row. The previous URL is never captured anywhere.

The lookup already runs before the update, so the fix is to widen that `select` — but it is a change to the repository, not a route-local one, and a dev agent that trusts the ledger sentence will go looking for a value that is not there.

## Story

As someone who removes a day's cover photo,
I want exactly that file removed,
so that the tickets and photos attached to that day's stays and activities are still there afterwards.

## Acceptance Criteria

1. **AC1** — Removing a day image deletes the day image file and nothing else. Every accommodation and day-plan-item photo and document on that day survives, on disk, byte-identical.
2. **AC2** — The same holds when the day image is *replaced* with a URL outside the day's upload directory, which is the condition's second trigger.
3. **AC3** — The day image's own file is still removed, so the change does not trade a data-loss defect for an orphaned-bytes one. A day image whose file is already absent is not an error.
4. **AC4** — A filesystem failure **after** the row has been committed no longer turns a completed deletion into a `500` and a "removal failed" message. It is logged; the response reports the deletion that actually happened. Applies to all four media routes at once (stay and activity, images and documents).
5. **AC5** — Two overwrite imports of the same trip cannot interleave: the second is refused or waits, rather than both writing into one directory. Per DW-86's recorded decision, an exclusive-`mkdir` sentinel per trip, released in a `finally`, with an explicit staleness timeout so a crashed process does not lock the trip forever.
6. **AC6** — On the create-new import path, a stored `/uploads/trips/<id>/…` URL whose trip id is **not** the trip being created is nulled rather than kept, and the import result names how many images were dropped. Per DW-88's recorded decision.
7. **AC7** — The v1 verbatim-restore rule is narrowed, not abandoned: a URL that belongs to the trip being created is still restored exactly as written, and the seven existing v1 tests that pin that string pass unmodified.

## Tasks / Subtasks

- [ ] `src/lib/repositories/tripRepo.ts` — `updateTripDayImageForUser` (`:1084`): widen the existing lookup to `select: { id: true, imageUrl: true }` and return the previous URL alongside the updated day. The lookup already runs before the `UPDATE`, so this costs nothing — AC1, AC3
- [ ] `src/app/api/trips/[id]/days/[dayId]/image/route.ts` (`:225-229`) — replace the recursive `fs.rm` of the day directory with an unlink of the previous day image's own file, resolved the way the media routes already resolve one (`resolveStoredMediaPath`, guarded on the `/uploads/trips/<tripId>/` prefix). Keep both trigger conditions: removal **and** replacement with an out-of-directory URL — AC1, AC2, AC3
- [ ] The same route — an already-absent file is not an error (`ENOENT` returns quietly), matching `removeManagedFile`'s existing contract — AC3
- [ ] `src/app/api/trips/[id]/accommodations/documents/route.ts`, `.../day-plan-items/documents/route.ts`, `.../accommodations/images/route.ts` (`:243`) and `.../day-plan-items/images/route.ts` — `removeManagedFile` currently swallows `ENOENT` and **rethrows every other errno** (`:90-104`), after the row delete has committed. Log and continue instead. The four copies are byte-identical; keep them in agreement or extract one helper — AC4
- [ ] `src/lib/trips/importPhotos.ts` — the per-trip lock around `stashTripUploadDir` (`:292`). Exclusive directory creation as the sentinel, released in a `finally`, with a documented staleness timeout. `stashTripUploadDir` swallowing `ENOENT` is deliberate (a photo-free trip has no directory) and must stay — it is precisely what makes the unlocked race silent — AC5
- [ ] `src/lib/repositories/tripRepo.ts` — `dropReplacedUploadUrl` (`:2170`) is called with `replacedUploadPrefix: null` on the create-new path, which is what preserves a foreign URL. Add the create-new rule: null any `/uploads/trips/<id>/…` URL whose id is not the trip being created, and count the drops — AC6, AC7
- [ ] `src/app/api/trips/import/route.ts` + `TripImportDialog.tsx` — surface the dropped-image count in the import summary, beside the existing `photoCount` / `documentCount` — AC6
- [ ] `test/` — AC1's regression, and it must fail before the fix: seed a day with a day image **and** a stay photo **and** a stay document, `PATCH { imageUrl: null }`, assert the two entry files still exist and the day image does not. This one test is the story — AC1, AC3
- [ ] `test/` — AC2 with an out-of-directory replacement URL; AC4 by making the unlink fail with a non-`ENOENT` errno and asserting a 2xx with the row gone; AC6/AC7 with a v1 backup carrying a foreign URL and one carrying its own — AC2, AC4, AC6, AC7

## Dev Notes

### Why these four are one story

They are not one code area — a route, a repository, an import helper and four media routes. They are one *class*: every one of them takes an action whose stated scope is narrower than its effect. Fixing them separately would mean four stories each too small to justify a review pass, and DW-194 and DW-195 both land on media deletion within the same request path.

The bundle deliberately excludes DW-187 (the missing orphan sweep) and DW-188 (transaction work), which DW-195 names as natural pairs. Those are new mechanisms; this story is containment of existing ones.

### The decisions are already made — do not re-derive them

DW-86 and DW-88 sat open precisely because their fixes were product calls rather than patches. Both were answered in a sweep decision pass and the answers are recorded in the ledger:

> **DW-86, 2026-08-09** — *Exclusive mkdir sentinel per trip. Before `stashTripUploadDir` runs, attempt an exclusive directory creation (e.g. `<tripDir>.import-lock`) as a lock; release it in a `finally` after the import completes or fails. Needs an explicit staleness timeout … since a crashed process leaves the sentinel behind forever otherwise.*

> **DW-88, 2026-08-08** — *Null the foreign URL and warn. On the create-new path, null any `/uploads/trips/<id>/...` URL whose trip id is not the trip being created and add an import warning naming how many images were dropped. The imported trip then has no image instead of a broken one, and the v1 verbatim rule is narrowed to URLs that still resolve.*

Implement those. If either turns out to be unworkable, say so and stop — do not substitute a different design silently.

### What must not regress

- **The v1 verbatim rule (AC7).** Story 2.32's AC2 requires a v1 backup to restore "exactly as before" and seven tests pin the verbatim string. DW-85's resolution already narrowed the nulling to the overwrite path *on purpose*. This story narrows it once more — by trip id, not by path — and those seven tests must pass unmodified.
- **`stashTripUploadDir`'s `ENOENT` swallow.** It is correct: a trip with no photos has no directory. The race is not caused by the swallow; it is made silent by it. Keep the behaviour and add the lock above it.
- **Story 5.13's writer clause.** `updateTripDayImageForUser`'s lookup carries `OR: [{ userId }, { members: { some: { userId, role: "CONTRIBUTOR" } } }]` with a comment explaining why widening the route alone would have shipped green and broken. Widening the `select` must not disturb the `where`.
- **The day-image route's own 404 semantics.** `updated === null` still answers `not_found`.

### Traps

1. **Trusting DW-194's "the route already knows the previous `imageUrl`."** It does not — see above. This is the single most likely way to lose an hour.
2. **Deleting the day directory "but only when it is empty."** Tempting and wrong: emptiness is a race, and the directory is legitimately non-empty whenever the day has any stay or activity media. Delete the file, never the tree.
3. **Fixing removal and forgetting replacement.** The `if` has two arms (AC2). A test that only covers `imageUrl: null` leaves half the defect in place.
4. **Making the post-commit unlink failure silent as well as non-fatal.** AC4 says *log*, not *ignore*. The orphaned file is the only record that anything went wrong.
5. **Patching one of the four `removeManagedFile` copies.** They are byte-identical by design; three fixed and one not is worse than none, because it makes the behaviour depend on which media type the user deleted.

### Testing

`vitest` (`npm test`), suites under `travelplan/test/`. Route suites drive the exported handler directly with a session built by `createSessionJwt`. Note `test/setup.ts` points `MEDIA_STORAGE_ROOT` at a per-worker temp directory — file assertions are safe and must use that root rather than the real media tree.

AC1's test is the one that matters. Write it first, watch it fail, then fix. A version of this story that ships without a test that failed beforehand has not demonstrated anything.

Record the full-suite baseline before starting and report it after.

### Project Structure Notes

No new dependency, no migration, no schema change. One repository function widened, one route's cleanup narrowed, four media routes' error handling aligned, one import helper gaining a lock, one URL rule narrowed, plus the import summary field.

### References

- The four ledger entries: DW-194, DW-86, DW-88, DW-195 in `_bmad-output/implementation-artifacts/deferred-work.md`
- Directory composition that makes DW-194 destructive: `travelplan/src/lib/trips/uploadPaths.ts:94-121`
- The writer clause not to disturb: [Source: _bmad-output/implementation-artifacts/5-13-what-a-contributor-may-do-made-consistent.md]
- The v1 verbatim rule: [Source: _bmad-output/implementation-artifacts/2-32-complete-trip-backup-import-with-photos-travel-segments-and-bucket-list.md]
- Epic definition: [Source: _bmad-output/planning-artifacts/epics.md#Story 8.4: Media Deletion That Deletes Only Its Own File]

## Dev Agent Record

### Agent Model Used

Claude Opus 5 (1M context) - `claude-opus-5[1m]`, via `bmad-dev-auto`, 2026-08-11.
Spec: `spec-8-4-media-deletion-that-deletes-only-its-own-file.md` (commit `9a99dda`, baseline `15ba325`).

### Debug Log References

Full detail lives in the spec's `## Spec Change Log`, `## Review Triage Log` and `## Auto Run Result`.
Four implementation iterations, four adversarial review passes; passes 1-3 each found a defect the
change itself had introduced, reproduced by execution before being accepted.

**The story's two false premises, both confirmed.** DW-194's "the route already knows the previous
`imageUrl`" - it does not; the lookup selected `{ id }` and re-read the *new* row. And **AC7's**
"the seven existing v1 tests pin that string pass unmodified" is a miscount: two of them
(`test/tripRepo.test.ts:1982`, `:2187`) are create-new tests over `IMPORT_PAYLOAD`, whose `trip.id`
is `export-trip` while a create-new import mints a fresh cuid - so those URLs are foreign by
construction and AC6 requires them nulled. DW-88's recorded decision governs; exactly those two
assertions moved, the overwrite pin at `:2333` and the other five v1 pins are untouched.

**What the review passes caught, none of which the green suite saw.** A URL string prefix is not a
containment check: `dayImageUpdateSchema` admits any `/uploads/…` string, so the first
implementation's `startsWith(dayPrefix)` guard resolved `…/days/<dayId>/../../../../../victim.txt`
to `<mediaRoot>/victim.txt` and unlinked it - a new arbitrary-file-unlink primitive - and admitted
`…/days/<dayId>/accommodations/<a>/img-stay.webp`, i.e. DW-194's own symptom one file at a time.
The lock was keyed on the raw `targetTripId` (`z.string().trim().min(1)`), so `../../../../x`
produced `mkdir` then `rm -rf` outside the media root for any authenticated caller. `allowedDir`
built from the request's day orphaned the media of every activity ever moved between days.
`fs.rename` alone does not make a stale-lock reclaim atomic - two callers both got the lock. And the
`previous !== updated` trigger made a note-only save delete the day's current photo.

**Mutation-checked, per Story 8.3's discipline.** Removing the `ino` comparison, `looksLikeStoredMediaUrl`,
the `fs.utimes` heartbeat, the `{ note }`-only request body, the resolved-path trigger, the
"no day in the stored URL" log line, the case fold, and the empty-body `refine` each fails a test.
The heartbeat is the one that mattered: before a test existed for it, replacing `fs.utimes` with a
no-op left the whole suite green, so the mechanism the entire staleness argument rests on was
deletable undetected.

### Completion Notes List

- AC1-AC4 done for the day-image route and all four media routes, through one shared
  `removeManagedMediaFile` that never throws; the four `removeManagedFile` copies are deleted, not edited.
- AC5 done: per-trip sentinel on a DB-resolved owned id, atomic reclaim, nonce-checked release,
  liveness heartbeat, released on every exit path, and removed when the trip is deleted.
- AC6/AC7 done: create-new nulls a URL that is not this trip's (decided on the resolved path, failing
  closed for one escaping the media tree) and reports the count; overwrite is unchanged.
- Two acceptance criteria were added during review and are also met: **AC8** (containment, not prefix
  matching) and **AC9** (media found under the day its stored URL names, not the entry's current day).
- Red before green: the AC1 and AC8 regressions failed at baseline. The AC9 regressions are red against
  the second iteration's shape, not the baseline - the baseline handled that input correctly - and that
  is reported rather than papered over.
- Suite: 146 files / 2273 tests, from a baseline of 145 / 2223. Typecheck clean, lint at the baseline
  warning count (79, 0 errors), build compiles.
- **Next story should be DW-305:** `hero-image/route.ts` still recursively removes the *whole trip's*
  media on its rollback - the same defect class, one level broader. This story's spec excluded it on the
  stated grounds that it "owns a flat file, not a tree", which is false: its `uploadDir` is
  `getTripUploadDir(tripId)`.

### File List

**New**
- `travelplan/src/lib/trips/mediaCleanup.ts`
- `travelplan/test/tripDayImageRollback.test.ts`

**Modified**
- `travelplan/src/lib/trips/uploadPaths.ts`, `travelplan/src/lib/trips/importPhotos.ts`
- `travelplan/src/lib/repositories/tripRepo.ts`, `travelplan/src/lib/validation/dayImageSchemas.ts`
- `travelplan/src/app/api/trips/[id]/days/[dayId]/image/route.ts`
- `travelplan/src/app/api/trips/[id]/{accommodations,day-plan-items}/{images,documents}/route.ts`
- `travelplan/src/app/api/trips/[id]/route.ts`, `travelplan/src/app/api/trips/import/route.ts`
- `travelplan/src/components/features/trips/{TripDayView,TripImportDialog}.tsx`
- `travelplan/src/i18n/en.ts`, `travelplan/src/i18n/de.ts`
- 11 test suites; `deferred-work.md` (DW-302..DW-310 added)

**Deliberately not modified** - `travelplan/src/app/api/trips/[id]/hero-image/route.ts` (DW-305).

### Change Log

| File | Change |
|---|---|
| `lib/trips/mediaCleanup.ts` | **New.** `removeManagedMediaFile` - unlinks one file only when its resolved parent *is* the caller's own directory; `ENOENT` quiet, every other errno logged, never throws. Plus `storedMediaUrlsNameSameFile`. |
| `lib/trips/uploadPaths.ts` | `readStoredMediaDayId` (the day a stored URL actually lives under), `looksLikeStoredMediaUrl` (segment-based, not a prefix test, and deliberately not `path.posix.normalize`), `mediaPathIsDirectlyIn` / `mediaPathIsInside` (one case-folded comparator pair). |
| `lib/trips/importPhotos.ts` | Per-trip import lock: `IMPORT_LOCK_STALE_MS`, `getTripImportLockDir`, all-or-nothing claim, `ino`-verified `fs.rename` reclaim, nonce-checked release, ownership-checked 60s heartbeat, `isSafeMediaSegment` refusal. |
| `lib/repositories/tripRepo.ts` | `updateTripDayImageForUser` returns `previousImageUrl` (widened `select`, Story 5.13's `where` untouched); `resolvesInsideTripUploadDir` as the one containment primitive behind both import rules; `isForeignTripUploadUrl` fails closed; `droppedImageCount` + warning; `runTripImport` behind a lock-owning wrapper. |
| `api/.../days/[dayId]/image/route.ts` | `PATCH` unlinks the previous day image's own file instead of removing the day tree; `POST`'s rollback likewise, through the never-throwing helper. |
| the four media routes | Local `removeManagedFile` deleted; shared helper with the entry's own directory, built from the day the **stored URL** names; an unparseable URL logs rather than skipping silently. |
| `api/trips/[id]/route.ts` | Trip deletion removes the import sentinel, which is a sibling of the trip directory. |
| `api/trips/import/route.ts` | `import_in_progress` → 409, `import_lock_unsafe_trip_id` → explicit 4xx. |
| `validation/dayImageSchemas.ts` | `imageUrl` optional so a note-only save can omit it; `refine` rejects a body that asks for no change. |
| `TripDayView.tsx` | The day-meta save sends `{ note }` only - resending a stale `imageUrl` deleted the day's current photo under the new trigger. |
| `TripImportDialog.tsx`, `i18n/{en,de}.ts` | `import_in_progress` message. |
