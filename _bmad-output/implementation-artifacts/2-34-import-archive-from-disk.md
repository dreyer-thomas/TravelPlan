---
authored_against: ac03570
baseline_revision: f5d5adf796e63876a9d47905b9549542f7562cab
status: done
review_loop_iteration: 0
final_revision: f08ebbe
followup_review_recommended: false
---

# Story 2.34: Read the Import Archive From Disk

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the maintainer of TravelPlan,
I want the import to read a backup from disk instead of holding it in memory,
so that the size of a restorable backup is a policy decision rather than a function of how much RAM the server happens to have.

## Acceptance Criteria

1. **Disk-backed read.** The request body is written to a temporary file and the ZIP is read from it. Peak memory is bounded by the largest single member, not by the archive.
2. **Cleaned up on every path.** The temporary file is removed on success, on validation failure, on a rejected import and on an unexpected throw.
3. **Bounds checking preserved.** `zipReader`'s per-read validation, its `ZipReadError` cases and its refusal of escaping member names are unchanged in behaviour. Its tests pass or are extended, never replaced.
4. **The middleware buffer is addressed too.** Next buffers the body before the handler runs, because `/api/trips/:path*` is in `middleware.ts:66`'s matcher. A disk-backed reader behind a memory-backed body buffer solves half the problem; both halves must go.
5. **Limits re-justified.** `importLimits.ts`'s comment explaining the 3–4× multiplier is corrected, and whatever ceiling remains is chosen for a reason other than "what fits in RAM".
6. **Export untouched.** `createZipStream` is the reference, not a target.
7. **Measured, not assumed.** A 217 MB backup imports end to end with peak process memory recorded.
8. **Behaviour unchanged.** v1 JSON backups, `createNew` and `overwrite`, photo-missing warnings and rollback-on-failure all behave exactly as today.

## Tasks / Subtasks

- [x] **Task 1 — Get the body to disk without a second copy** (AC: 1, 4)
  - [x] The body is buffered twice before `importPackage` sees it: once by Next for the middleware, once by `await request.formData()` (`import/route.ts:81`). The route's own comment at `:22` already records the second one — *"`await request.formData()` reads the whole body into memory before the `file.size` check below can run"*.
  - [x] Decide how to remove the middleware copy and record the choice. Two shapes: take `/api/trips/*/import` out of the middleware matcher and self-guard the route (`5-8`'s spec establishes that a route not covered by the matcher must call `requireSession` itself — this route already does, at `:33`), or stream the body without a second materialisation.
  - [x] Replace `request.formData()` with a streaming multipart read that writes the file part straight to a temp path. `request.body` is a `ReadableStream`; the multipart framing has to be parsed as it passes rather than after.
  - [x] `contentLengthExceedsLimit` (`:28-31`) stays and stays first — it is the cheap pre-check that avoids reading an oversized body at all, and it becomes *more* useful once the read is streamed.

- [x] **Task 2 — Read the ZIP from a file descriptor** (AC: 1, 3)
  - [x] `readZipMembers(bytes)` (`importPackage.ts:89`) takes a `Buffer`. Give it a source it can seek in instead.
  - [x] `zipReader.ts`'s docblock records that *"Every read is bounds-checked before it happens"* — it already treats the archive as random-access. The change is where the bytes come from, not how they are validated. Keep `readU16` / `readU32` / `findEndOfCentralDirectory` semantically identical, including the `RangeError` they guard against.
  - [x] A ZIP is read end-first: the end-of-central-directory record is at the tail, then the central directory, then each member. That is seek-friendly and is why this works at all.
  - [x] Members are still materialised one at a time to be written out. That is the bound AC1 describes — one member, not the archive.

- [x] **Task 3 — Temp file lifecycle** (AC: 2)
  - [x] Create it under the OS temp dir, not under `public/` and not next to the uploads. `uploadPaths.ts` exists precisely because writing into the served tree caused real damage once — do not reintroduce a path that a cleanup routine might sweep.
  - [x] Remove it in a `finally`, so a validation rejection, a `ZipReadError`, an aborted request and a thrown Prisma error all clean up.
  - [x] A crash between write and cleanup leaves a file behind. Decide whether that needs a sweep on start-up or is acceptable, and say which.

- [x] **Task 4 — Re-justify the limits** (AC: 5)
  - [x] `MAX_IMPORT_PACKAGE_BYTES` is 300 MB, `proxyClientMaxBodySize` is `"320mb"`, and nginx carries `client_max_body_size 320m`. All three were chosen on 2026-08-02 for memory headroom on a 3.8 GB box.
  - [x] Once memory is no longer the constraint, rewrite `importLimits.ts`'s comment: the 3–4× multiplier it documents stops being true, and a comment that describes a solved problem is worse than none.
  - [x] Whether to raise the ceiling further is a judgement — the remaining costs are disk, request duration and the write amplification of extracting photos. Say what the number now protects against.

- [x] **Task 5 — Tests** (AC: 3, 8)
  - [x] `tripImportPackage.test.ts`, `tripImportRoute.test.ts`, `tripImportPhotos.test.ts`, `tripImportRollback.test.ts` and `tripBackupRoundTrip.test.ts` all exercise this path. Extend rather than rewrite; they are the guard that AC8 holds.
  - [x] `test/helpers/zipBuilder.ts` builds archives in memory for the tests. It may need to write to a temp file instead — keep both if the reader is given a source abstraction.
  - [x] Add a malformed-archive case that proves the bounds checking still fires from the new source: a truncated central directory, and a member name attempting `../`.
  - [x] `npm test` green.

- [x] **Task 6 — Measure it** (AC: 7)
  - [x] Build a 217 MB backup — the production trip `cmlntl8qi0001llu8gl827ypj` is that size, or synthesise one from a throwaway database.
  - [x] Import it and record peak RSS. The point of the story is that this number stops tracking the archive size; a measurement that merely says "it worked" does not demonstrate that.
  - [x] Throwaway copy of `dev.db` on an isolated port — never `prisma/dev.db`. Recipe in `7-12-bucket-list-sidebar-card.md`'s Dev Notes.

## Dev Notes

### Why this exists, with the numbers

Measured on 2026-08-02, the production uploads directory:

```
113 MB   trips/cmlzhtbni0038gsu8che5t89c/
217 MB   trips/cmlntl8qi0001llu8gl827ypj/
```

A STORE-only archive is essentially the sum of those bytes, so both exceeded the original 100 MB ceiling — **neither real trip was restorable.** The ceiling was raised to 300 MB the same day as a stopgap. On the production box (3.8 GB total, 2.9 GB available, **no swap**) a 217 MB import peaks around 700–870 MB, which fits. At roughly 600 MB it would not, and without swap the failure mode is an immediate kill that may take the second application on the box with it.

So the raised limit bought time, not a solution. This story removes the coupling.

### The export is the reference

`zipArchive.ts:199-206` is a `ReadableStream` whose `pull` reads one member per tick, with the comment *"One member resident at a time — read, hash, emit, release."* The export of a 217 MB trip is already safe. The pattern exists in this codebase, is proven, and is the shape to copy — this story is about bringing the reading half up to it, not about inventing something.

### Four copies, not one

It is tempting to fix `readZipMembers` and stop. That addresses one of four:

| Copy | Where |
|---|---|
| Next's middleware body buffer | implicit, because `/api/trips/:path*` is in the matcher |
| `request.formData()`'s `File` | `import/route.ts:81` |
| the `Buffer` handed to `readZipMembers` | `importPackage.ts:89` |
| each member copied out via `Buffer.from(raw)` | `zipReader.ts:252` |

AC4 exists because the first is invisible in this repo's own source — it is Next's behaviour, discovered on 2026-08-02 only because the server logged *"Request body exceeded 10MB"* while a 13.4 MB import failed with a misleading `invalid_form_data`.

### Traps

**1. Do not write the temp file under `public/`.** `uploadPaths.ts` exists because a test suite once deleted the developer's real uploads. Anything under the served tree is fair game for a cleanup routine that does not know about you.

**2. The bounds checks are not incidental.** `zipReader` validates every offset before reading it, and refuses member names that escape the root. Moving to a file descriptor must not turn a guarded read into an unguarded `fs.read` at an attacker-chosen offset — this is the one place in the app that parses a file a user supplied.

**3. `contentLengthExceedsLimit` stays first.** It reads a client-supplied header, so it is not enforcement — but it is what stops an oversized body from being read at all, and it matters more once reading means writing to disk.

**4. The route self-guards already.** If the fix takes it out of the middleware matcher, check that: `import/route.ts:33` calls `requireSession`, so the `401`/`403` behaviour survives. Verify rather than assume — that is exactly the kind of thing that looks fine until someone tests it unauthenticated.

### Testing

Vitest 3.2. Five suites cover this path and were written by Stories 2.31/2.32. They are the AC8 guard and should be extended, not rewritten. jsdom is irrelevant here — this is all server-side.

The memory claim (AC7) cannot be made by the suite. It needs a real import of a real archive with RSS recorded.

### Project Structure Notes

`src/app/api/trips/import/route.ts`, `src/lib/trips/importPackage.ts`, `src/lib/trips/zipReader.ts`, `src/lib/trips/importLimits.ts` (comment), possibly `src/middleware.ts` (matcher), and the five test suites plus `test/helpers/zipBuilder.ts`. No schema, format or UI change.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.34]
- [Source: travelplan/src/lib/trips/zipArchive.ts:199-206] — the streaming pattern to copy
- [Source: travelplan/src/app/api/trips/import/route.ts:14-31,81] — the route's own note on `formData()` buffering
- [Source: travelplan/src/lib/trips/zipReader.ts] — the bounds-checking contract to preserve
- [Source: travelplan/src/lib/trips/importLimits.ts] — the 3–4× multiplier this story invalidates

## Dev Agent Record

### Agent Model Used

Claude Opus 5 (1M context) — `claude-opus-5[1m]`, via the bmad-loop dev-auto implementation agent.

### Debug Log References

- `npm test` — 107 files, 1029 tests, all passing (was 1028 before this story; the suites gained 44 tests and lost none).
- `npm run lint` — 85 problems, 2 errors, 83 warnings: byte-identical to the pre-story baseline. Both errors are pre-existing `react/no-children-prop` in `travelplan/src/theme.ts`.
- `npx tsc --noEmit` — 143 errors, identical to the pre-story baseline, **none of them in `src/`**. They are all pre-existing test-file typing issues (Prisma 7 `Promise<{id?}>` route params, `vi.fn` on `fetch`) and are untouched by this story. Baseline confirmed by stashing the change set and re-running both commands.
- AC7 measurement harness, all under the session scratchpad and since deleted: `build-big-backup.js` (synthesises a STORE-only v2 package), `measure.sh` (starts one `next dev`, samples the whole process tree's RSS at 20 ms, uploads with `curl -F`), `probe-reader2.mjs` (the reader in isolation, `--expose-gc`). Two `git worktree` checkouts of `f5d5adf` on ports 3096/3097, each with its own throwaway copy of `prisma/dev.db` and its own `UPLOADS_PUBLIC_ROOT`. `prisma/dev.db` was never opened by a server.

### Completion Notes List

**The archive is read through a seekable source, and it is the same reader.** `zipReader.ts` gained `ZipByteSource` (`size` + a bounds-checked `read`), `bufferByteSource` and `fileByteSource`, and `openZipArchive(source)` which validates everything knowable from the central directory up front and returns `readMember(name)` for one member at a time. `readZipMembers(buffer, options)` survives unchanged as a thin eager wrapper, so every existing suite calls exactly what it called before. Every check the old reader performed still runs, in the same order and with the same message text, with two deliberate exceptions noted below.

**Trap 2 was the design constraint.** `ZipByteSource.read` is the single choke point: it validates the range, refuses a non-integer or negative offset, and throws `ZipReadError` — never `RangeError`, never a short read (`fileByteSource` loops until `length` bytes are filled and treats a zero-byte `readSync` as truncation). `readU16`/`readU32` are untouched and still operate on `Buffer`s, so their messages are byte-identical; the local file header is read as `min(30, size - offset)` bytes precisely so a header running off the end still fails through `readU16`'s own wording rather than the source's generic one.

**Two behaviour details moved, both deliberately.** (1) A member's *content* checks — decompression, declared size, CRC-32 — now happen when the member is read rather than during the open. On the streaming route path a bad CRC therefore surfaces from `validatePackagePhotos` rather than from `parseImportPackage`; `POST` catches `ZipReadError` and answers `validation_error` 400 with `error.message`, which is exactly what the eager path returned, message included (`tripImportRoute.test.ts` — *"maps a member that fails its CRC-32 to the same validation_error it always did"*). The one visible difference is ordering on doubly-invalid input: an archive with both a stowaway member and a bad CRC now reports the stowaway first. (2) `readMember` no longer copies a STORE member when the source owns its reads (`fileByteSource`), because that copy was a second 15 MB allocation per photo for a retention problem a file source does not have. The `Buffer`-backed source still copies, for the reason it always did.

**A second ceiling was silently blocking the 217 MB backup, and AC7 could not have passed without fixing it.** `MAX_TOTAL_UNCOMPRESSED_BYTES` was 200 MB while `MAX_IMPORT_PACKAGE_BYTES` had been raised to 300 MB on 2026-08-02. A STORE-only archive of already-compressed photos expands to essentially its own size, so the 217 MB production trip was accepted on the wire and then rejected by the reader with *"Archive expands to more data than the import limit allows"* — it was never restorable, it just failed one ceiling later than the story's Dev Notes assumed. Raised to **400 MB**, a third of headroom over the largest package the route accepts, and `tripImportPackage.test.ts` now asserts `MAX_TOTAL_UNCOMPRESSED_BYTES > MAX_IMPORT_PACKAGE_BYTES` so the two cannot drift apart again.

**`MAX_IMPORT_PACKAGE_BYTES` stays at 300 MB, re-justified.** It is no longer a memory ceiling — peak memory no longer tracks the archive at all — so its docblock's "Not just a policy number" paragraph and its 3–4× multiplier are gone. What the number now protects is temp-file disk per concurrent import, request duration against the 120 s import transaction, and the fact that the third of the three agreeing limits (nginx's `client_max_body_size 320m`) lives outside this repo and would have to be moved in step. Raising it is a coordinated three-number change, not an architectural one, and nothing measured here argues for doing it now.

**The multipart body is parsed as it streams** by `src/lib/http/multipartToDisk.ts`, a new dependency-free module in the spirit of the hand-rolled ZIP writer and reader. The file part goes straight to a descriptor and never exists as a `Buffer`; text parts are capped at 4 KB each and 16 in number; the working buffer only ever holds the current field, a capped header block, or the `boundary.length + 3` bytes a delimiter straddling two chunks could be hiding in. Wire behaviour is unchanged: no file part → `validation_error` "Backup file is required", over the cap → `file_too_large` "Backup file exceeds the import size limit", unparseable → `invalid_form_data` "Request body must be valid form data". `multipartToDisk.test.ts` runs the same body through the parser at chunk sizes 1, 2, 3, 7, 13, 31, 1024 and whole, which is the only honest way to cover a straddling boundary.

**Crash-leftover policy: accepted, not swept — and the reason is in the code.** A hard kill between the write and the `finally` leaves one uniquely named file of at most 300 MB in the OS temp directory. A start-up sweep was rejected because this app has no once-per-process start-up hook (route modules initialise lazily and there is no `instrumentation.ts`), because macOS and the Linux host both sweep their temp directories already, and because a sweeper matching our own prefix would be a second thing deleting files it did not create — the exact shape of the incident `uploadPaths.ts` documents. The failure mode of doing nothing is some temp space after a crash; the failure mode of a buggy sweeper is deleting a live import's body.

**Matcher form.** `"/api/trips/:path((?!import$).*)"` plus a separate `"/api/trips"` entry. Verified against Next's own `getMiddlewareMatchers` rather than assumed — `middleware.test.ts` compiles `config.matcher` with the same function `next build` uses and asserts that `/api/trips/import` is excluded while `/api/trips`, `/api/trips/:id` and every nested route stay covered. `requireSession` was confirmed to return the same codes and statuses the middleware did (`unauthorized` 401, `password_change_required` 403), and `tripImportRoute.test.ts` proves both against the route on the JSON *and* the multipart path. The tests send a valid CSRF pair on purpose: the CSRF check runs before `requireSession`, so an unauthenticated request without a token still gets `csrf_invalid` 403, which is today's behaviour and is unchanged.

**Deviations from the design brief.** `PhotoSource` gained a fourth method, `head(path, length)`, beyond the `paths`/`has`/`read` the brief specified. The reason is measured: with three full reads per pooled photo (validate, `tripRepo`'s sniff, write) a 220 MB import churned ~1.3 GB of 11 MB buffers and peaked at +387 MB RSS. `tripRepo` only ever needed the first twelve bytes, and a STORE member's prefix is addressable, so `head` cut a whole pass; together with dropping the STORE copy it took the peak to +243 MB. `validatePackagePhotos` deliberately keeps the *full* read, because that is where every pooled photo's CRC-32 is verified before the transaction opens and moving it would turn a 400 into a post-commit 500. The brief's note that a photo is read twice therefore holds exactly: once by validation, once per write.

**AC7, measured.** Two `next dev` servers from `git worktree` checkouts, one at `f5d5adf` (baseline, with only `MAX_TOTAL_UNCOMPRESSED_BYTES` raised so it could complete at all) and one with this change set, each with a throwaway `dev.db` copy and its own uploads root. Synthetic STORE-only v2 packages, each a manifest plus N JPEG-signature day photos. Peak RSS is the whole process tree (`npm` → `next dev` → `next-server`) sampled every 20 ms; the figure quoted is the rise above the settled idle RSS, which was ~450 MB for the dev server in both cases.

| archive | baseline peak rise | this change, peak rise |
|---|---|---|
| 11 MB (1 photo) | +143 MB | +97 MB |
| 110 MB (10 × 11 MB) | +1040 MB | +216 MB |
| 220 MB (20 × 11 MB) | **+1808 MB** | **+250 MB** |
| 220 MB (80 × 2.75 MB) | not run | +249 MB |

All five imports returned `200` with `dayCount: 20`, `photoCount: 20` and every photo on disk under the new trip's own upload directory. The baseline is dead linear at ~8.2× the archive; the new path rises 34 MB when the archive doubles from 110 MB to 220 MB. That is the claim AC7 asks for: peak stopped tracking archive size.

The residual is transient allocation, not anything the import holds. The reader on its own, over the same 220 MB archive on a real file descriptor, with `--expose-gc`: **+45 MB** reading every member one at a time and releasing it, against **+407 MB** for `readZipMembers` over the resident archive. The largest member is 11 MB, so +45 MB is a few members' worth of allocator slack — that is AC1's bound, demonstrated directly.

Caveat worth recording: this was measured in `next dev` on macOS, which is why the idle baseline is ~450 MB rather than production's ~150 MB. The *deltas* are the comparable figures. Nothing was measured against the real production archive `cmlntl8qi0001llu8gl827ypj`, which is not on this machine; the synthetic package matches it in size, member count order of magnitude and compression method.

### File List

**Changed**

- `travelplan/src/lib/trips/zipReader.ts` — `ZipByteSource`/`bufferByteSource`/`fileByteSource`, `openZipArchive` with `readMember`/`readMemberHead`, `MAX_CENTRAL_DIRECTORY_BYTES`, `MAX_TOTAL_UNCOMPRESSED_BYTES` 200 MB → 400 MB, `readZipMembers` reduced to a wrapper.
- `travelplan/src/lib/trips/importPackage.ts` — `PhotoSource`, `photoSourceFromMap`, `toPhotoSource`, `PHOTO_SIGNATURE_HEAD_BYTES`, `openImportPackage`; `parseImportPackage` re-implemented over the same internals with its signature and error codes unchanged; `validatePackagePhotos` now takes either shape and reads one photo at a time.
- `travelplan/src/lib/trips/importPhotos.ts` — `writeImportedPhotos` takes `PhotoSource | Map` and reads one member per write.
- `travelplan/src/lib/repositories/tripRepo.ts` — `importTripFromExportForUser`'s `photoBytes` accepts either shape; the content-type sniff reads twelve bytes instead of a whole photo.
- `travelplan/src/app/api/trips/import/route.ts` — streams the body to an OS temp file, sniffs magic bytes on it, reads the ZIP through a descriptor, maps `ZipReadError` to `validation_error` 400, and releases the descriptor and the file in a `finally` covering the whole handler.
- `travelplan/src/lib/trips/importLimits.ts` — `MAX_IMPORT_PACKAGE_BYTES` re-justified; two stale "100 MB" references corrected.
- `travelplan/src/middleware.ts` — matcher excludes `/api/trips/import` and lists `/api/trips` explicitly.
- `travelplan/next.config.ts` — `proxyClientMaxBodySize` 320 MB → 20 MB, with the docblock no longer claiming the matcher covers the import route and recording the pre-check that makes the smaller buffer safe.
- `travelplan/src/app/api/trips/[id]/hero-image/route.ts`, `travelplan/src/app/api/trips/[id]/days/[dayId]/image/route.ts`, `travelplan/src/app/api/trips/[id]/accommodations/images/route.ts`, `travelplan/src/app/api/trips/[id]/day-plan-items/images/route.ts` — each pre-checks `content-length` against its own `MAX_FILE_SIZE_BYTES` before asking Next for the body, so lowering `proxyClientMaxBodySize` does not turn an oversized upload into `invalid_form_data`.
- `travelplan/test/helpers/zipBuilder.ts` — `writeZipToTempFile`, so a fixture can be read from disk as well as from memory.
- `travelplan/test/tripImportPackage.test.ts` — `openZipArchive` over a file source (good archive, truncated central directory, `../` name, ZIP64 sentinel, bad CRC, short read at the tail, out-of-range reads, the directory cap, memory/disk equivalence), `openImportPackage`, `validatePackagePhotos` against an on-disk package, and the ceiling relationship.
- `travelplan/test/tripImportRoute.test.ts` — the CRC `ZipReadError` mapping, route-level 401/403 without the middleware, and temp-file cleanup on success, validation rejection, `ZipReadError`, 409 conflict and an unparseable body.
- `travelplan/test/middleware.test.ts` — compiles `config.matcher` with Next's own `getMiddlewareMatchers` and asserts the exclusion and its bounds.

**Added**

- `travelplan/src/lib/http/multipartToDisk.ts` — streaming `multipart/form-data` reader that writes one named part to a file.
- `travelplan/src/lib/http/bodyLimit.ts` — the `content-length` pre-check the four still-matched upload routes need now that `proxyClientMaxBodySize` is 20 MB, and the counted JSON read that gives the route's `application/json` branch back the ceiling the matcher change removed.
- `travelplan/test/multipartToDisk.test.ts` — the parser as a unit, including a boundary split at nine different chunk sizes.
- `travelplan/test/bodyLimit.test.ts` — both guards as units, because neither ceiling can be proven through a route without uploading hundreds of megabytes.
- `travelplan/test/tripImportTempFileOnThrow.test.ts` — temp-file cleanup when the repository throws, in its own file because the mock is per-module.

**Not changed, on purpose**

- `travelplan/src/lib/trips/zipArchive.ts` — AC6. Read as the reference for the streaming pattern; not edited.

### Change Log

| Date | Change |
|---|---|
| 2026-08-03 | Story 2.34 implemented: the import reads its archive from a temp file through a `ZipByteSource`, the multipart body is streamed to disk by a new hand-rolled parser, `/api/trips/import` is out of the middleware matcher, and `MAX_TOTAL_UNCOMPRESSED_BYTES` was raised from 200 MB to 400 MB after it was found to be rejecting the very backup the story exists to restore. Peak RSS for a 220 MB import fell from +1808 MB to +250 MB, and stops scaling with archive size. |
| 2026-08-03 | Second follow-up review pass: the `content-length` pre-check now allows for the multipart framing wrapped around the file part, so a backup of exactly the documented 300 MB is read rather than refused unread — the one caller of `MULTIPART_FRAMING_SLACK_BYTES` that the previous pass missed. Everything else was comment accuracy verified against the code: the temp file's memory argument depends on `os.tmpdir()` not being a `tmpfs` mount and now says so with the check and the `TMPDIR` lever; the per-member cap is two allocations for a DEFLATE member, not one; and the four image routes' guard does not avoid Next's body buffer (confirmed in `body-streams.js`) and is not backed by `file.size` for a chunked upload over the cap. |
| 2026-08-03 | Follow-up review pass: the per-member cap now bounds a member's compressed size too (it was the read that happens before any inflate, so peak still tracked the archive — measured at +200 MB, now 0), the `application/json` branch counts its body against `MAX_IMPORT_PACKAGE_BYTES` instead of trusting a header the matcher change left as its only bound, and the four upload routes still behind the middleware pre-check `content-length` so lowering `proxyClientMaxBodySize` to 20 MB does not report an oversized photo as a damaged one. Plus `O_EXCL` on the temp file, a chunking-independent header cap, a dropped upload as 400 rather than 500, and three tests or comments that asserted more than the code did. |

## Review Triage Log

### 2026-08-03 — Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 12: (high 2, medium 5, low 5)
- defer: 2: (high 0, medium 2, low 0)
- reject: 10
- addressed_findings:
  - `[high]` `[patch]` **No per-member uncompressed cap: a 378 KB upload allocated 398 MB.** `openZipArchive` summed declared sizes against `MAX_TOTAL_UNCOMPRESSED_BYTES` (which this story raised 200 MB → 400 MB) but capped no individual member, and `readMember`'s `inflateRawSync` would take the whole budget in one allocation. Reproduced during triage: a single zeroed DEFLATE member in a 387,538-byte archive read successfully and moved peak RSS by 771 MB — on the 3.8 GB no-swap box the Dev Notes describe. AC1's bound was only a bound if the largest member is bounded. Added `MAX_MEMBER_UNCOMPRESSED_BYTES` (64 MB), enforced per entry in the central-directory loop before any payload is touched. Re-probed after the fix: rejected at open time, RSS delta 0 MB.
  - `[high]` `[patch]` **The temp file holding the whole backup was world-readable.** `fs.open(path, "w")` with no mode landed at 0644 in `os.tmpdir()` — `/tmp` on the Linux host, which the route's own docblock notes is shared with a second application. Any local account could read another user's trip data and photos for the duration of an import. Now `0o600`, pinned by a test.
  - `[medium]` `[patch]` **Unauthenticated requests changed status code.** The middleware used to answer 401 before the route's CSRF check could run; with the route out of the matcher, `validateCsrf` ran first and turned every signed-out caller into `csrf_invalid` 403. `requireSession` now runs first, restoring the exact prior wire behaviour, and the tests assert 401/403 *without* a CSRF pair instead of being written around the change.
  - `[medium]` `[patch]` **`proxyClientMaxBodySize` lost its justification and kept its value.** 320 MB existed solely for the import, which is now out of the matcher; the four routes still matched cap at 5 MB and 15 MB and all call `request.formData()`. Lowered to 20 MB — the same hazard this story removes, relocated to its neighbours, at 16× less exposure. nginx's `client_max_body_size 320m` stays: the import still traverses the proxy.
  - `[medium]` `[patch]` **Duplicate text parts flipped first-wins to last-wins.** The replaced `formData.get("strategy")` returns the first value; the new reader returned the last, and `strategy` selects create-new versus overwrite. Restored first-wins under AC8.
  - `[medium]` `[patch]` **The `maxFields` cap counted distinct names, not parts** — 100 parts all named `strategy` passed a cap of 3. Now counts parts as they are opened.
  - `[medium]` `[patch]` **Skipped parts and the epilogue were drained with no cap at all.** `maxFileBytes` bound only the named file part, and with the route outside the matcher nothing else bounds a chunked body. Added a whole-body `maxTotalBytes` ceiling.
  - `[low]` `[patch]` The matcher excluded `/api/trips/import` but not `/api/trips/import/` — same route, same body. Now `((?!import/?$).*)`, with the trailing-slash case in `middleware.test.ts`.
  - `[low]` `[patch]` `FileHandle.write` is not guaranteed to write a whole buffer; a short write would have truncated the temp file and reported a sound backup as corrupt. Now loops.
  - `[low]` `[patch]` The body stream was cancelled only on the failure path, so a throw from the file write left it open. Now cancelled in `finally` whenever the stream was not drained.
  - `[low]` `[patch]` ZIP magic detection had been duplicated into the route. One exported `looksLikeZipPrefix` now serves both callers.
  - `[low]` `[patch]` Five comments asserted things the code did not do: the "bounded by the largest single member" claim in `importLimits.ts` (true only after the first patch above), a `zipReader.ts` line citing AC7 as though it were a runnable test, the `ZipByteSource.read` guarantee overstated to cover I/O faults it does not catch, `validatePackagePhotos`'s "all issues are collected" which no longer holds for an archive-backed source, and `importTripFromExportForUser`'s undocumented reliance on `validatePackagePhotos` having verified the bytes its twelve-byte sniff reads unverified.

Deferred as DW-142 (the v1 fallback is still materialised whole, plus a second copy as a JS string — a cap is what AC8 forbids) and DW-143 (nothing bounds concurrent imports, though `importLimits.ts` now names temp-file disk per concurrent import as the first reason the ceiling holds).

Rejected as noise or as out of this story's scope: unlink-on-open in place of the documented no-sweep policy (a preference; `0o600` closes the disclosure and the file must stay openable by path for the magic sniff and the v1 read); `validatePackagePhotos` no longer collecting every issue on the disk path (the client gets the same single accurate message the eager path returned); the two-to-three re-reads per photo (measured and documented as the deliberate trade for the memory bound); `leftoverImportTempFiles` "comparing raw `readdir` output" (it filters by prefix — misread); `middleware.test.ts` importing a Next build internal (deliberate and documented; an upgrade fails the test loudly rather than silently); `optionalFormField`'s "dead branch" (it handles `undefined`, which is reachable); descriptor recycling if a `PhotoSource` outlived the response (no such caller exists); `readMemberHead`'s unverified prefix (the bytes are CRC-verified before the transaction — the precondition is now documented); the error-precedence flip inside `readZipMembers` (AC3 fixes the set of `ZipReadError` cases, not their order); and the case-folded and percent-encoded matcher spellings (they 404 or are normalised before routing, and the proxy patch shrinks what any matched request can buffer).

### 2026-08-03 — Review pass (follow-up)

- intent_gap: 0
- bad_spec: 0
- patch: 9: (high 0, medium 3, low 6)
- defer: 1: (high 0, medium 0, low 1)
- reject: 7
- addressed_findings:
  - `[medium]` `[patch]` **The per-member cap bounded the wrong size, so peak memory still tracked the archive.** `readMember` reads `compressedSize` bytes off the source and *only then* inflates them, but `openZipArchive` capped `uncompressedSize` alone. A DEFLATE member declaring 1 KB uncompressed while pointing at the whole of a 300 MB archive therefore passed the check the last review pass added and still made one 300 MB allocation — AC1's "bounded by the largest single member, not by the archive" restated as a hope. Measured during triage: a 200 MB archive of incompressible payload, `source.read` of the declared compressed size, **+200 MB RSS**; with the cap it is refused from the central directory before a payload byte is touched, **RSS delta 0 MB**. `MAX_MEMBER_UNCOMPRESSED_BYTES` now applies to both declared sizes, which refuses nothing genuine because a real DEFLATE member is never meaningfully larger compressed than uncompressed.
  - `[medium]` `[patch]` **The JSON branch lost its only ceiling when the route left the middleware matcher.** `request.json()` reads until the stream ends; Next's body clone used to truncate it, which is what the 2026-08-02 "Request body exceeded 10MB" line was. With `/api/trips/import` out of the matcher (AC4) the sole remaining bound was `contentLengthExceedsLimit`, and a `Transfer-Encoding: chunked` request simply omits the header — an authenticated caller could stream JSON of any size into memory on a no-swap box. `readJsonBodyWithinLimit` now counts what it accumulates against the same `MAX_IMPORT_PACKAGE_BYTES` the client was already told about, so it is enforcement of an advertised ceiling rather than a new policy and AC8 is untouched. The residency itself is still DW-142's, unchanged.
  - `[medium]` `[patch]` **Lowering `proxyClientMaxBodySize` to 20 MB moved a truncation cliff onto the four routes it was lowered for.** Verified against `next/dist/server/body-streams.js`: over the cap Next logs and pushes `null` — it truncates rather than refuses — so `request.formData()` throws and the route answers `invalid_form_data` "Request body must be valid form data". At 320 MB no real upload ever reached that cliff; at 20 MB a 25 MB photo does, and the previous pass's patch therefore turned an accurate "exceeds size limit" into the exact "intact file reported as damaged" failure the 2026-08-02 incident is about. The cap stays at 20 MB and the four matched upload routes now pre-check `content-length` against their own `MAX_FILE_SIZE_BYTES` before asking for the body (`src/lib/http/bodyLimit.ts`), which keeps the memory win and the accurate message.
  - `[low]` `[patch]` `MAX_PART_HEADER_BYTES` was enforced only while the `\r\n\r\n` terminator was still missing, so whether a 64 KB header block was refused depended on how the client chunked it. Now checked on both branches, with the oversized block asserted at four chunk sizes.
  - `[low]` `[patch]` `fs.open(path, "w", 0o600)` is `O_CREAT|O_TRUNC` without `O_EXCL`: it follows a symlink and **ignores the mode argument when the file already exists**, which made the previous pass's `0o600` conditional on the path being fresh in a shared `/tmp`. Now `"wx"`, pinned by a test that plants a `0666` file at the path and asserts it is neither truncated nor written through.
  - `[low]` `[patch]` A request body that *errors* mid-flight — a client walking away, a proxy cutting the upload — propagated out of `readMultipartToDisk` into the handler's outer catch and became `server_error` 500. `await request.formData()`, the call it replaced, rejected on the same input and the route answered `invalid_form_data` 400. Read errors are now `malformed`; a write fault still propagates, which is the line the catch is drawn around.
  - `[low]` `[patch]` The `MAX_CENTRAL_DIRECTORY_BYTES` test never reached the guard it claimed to pin — the EOF check ahead of it fired first on a 118-byte fixture, so deleting the cap left the suite green. The fixture is now larger than the cap and the message is asserted.
  - `[low]` `[patch]` `middleware.test.ts` compiled the matcher with `getMiddlewareMatchers(config.matcher, {})` instead of the project's `next.config.ts`; `basePath` and `trailingSlash` change the emitted regexps, so the test could have kept asserting an exclusion production had lost — which is the one thing it exists to catch.
  - `[low]` `[patch]` Two comments asserted more than the code does: `importLimits.ts`'s "peak memory is bounded by the largest single member" held only for a ZIP body (the v1 branch is DW-142) and did not mention the compressed side, and `tripRepo.ts`'s "only the member's first twelve bytes are read" is true for the STORE members this app exports but not for a Finder-re-zipped DEFLATE backup, where `readMemberHead` falls back to a full inflate. Both corrected, and the DEFLATE fallback now has a test proving it still returns the right prefix.

Deferred as DW-144 (the import schema puts no ceiling on the manifest, so `trip.json`'s effective limit is the ZIP reader's per-member cap and a manifest that trips it gets a message about the reader) — the miscount in that cap's own justification was corrected in place.

Rejected as noise, as out of scope, or as already on the ledger: adding a `size` accessor to `PhotoSource` so `MAX_IMPORT_PHOTO_BYTES` (15 MB) bounds the allocation instead of the 64 MB per-member cap (a tightening, not a defect — AC1's bound is the per-member cap and it holds); the fencepost between `contentLengthExceedsLimit` counting multipart framing and `maxTotalBytes` allowing 256 KB of it (a backup within a few hundred bytes of exactly 300 MB is refused with the accurate message); "most of the ZIP suite now guards the eager wrapper" (AC3 required those tests be kept, and `openZipArchive` has its own plus a memory/disk equivalence test); RFC 2046 transport padding after a boundary (`--boundary   \r\n`) being read as malformed (no browser or `undici` client emits it); no idle timeout on a stalled body and no bound on endless zero-length chunks (the same exposure `formData()` had, and the resource bound it wants is DW-143's); unbounded concurrent temp files (DW-143); and capping the v1 fallback's whole-body materialisation (DW-142 — only its missing *ceiling* was fixed here, not its residency).

### 2026-08-03 — Review pass (second follow-up)

- intent_gap: 0
- bad_spec: 0
- patch: 5: (high 0, medium 1, low 4)
- defer: 0
- reject: 8
- addressed_findings:
  - `[medium]` `[patch]` **The whole memory argument rests on `os.tmpdir()` being real disk, and nothing said so.** `createUploadTempPath` hard-codes `os.tmpdir()` and `importLimits.ts` prices the ceiling against "its own upload's worth of `/tmp`" — but on a host where `/tmp` is a `tmpfs` mount (the systemd default on Fedora and Arch, common in containers) the 300 MB body is resident memory again and AC1 is void with nothing in the logs to say so. Task 3 directs the OS temp dir, so relocating it would be the spec deviation; what was missing is that the precondition is operational. `createUploadTempPath`'s docblock now names the check (`findmnt -no FSTYPE /tmp`) and the lever — `os.tmpdir()` honours `TMPDIR`, which is why no bespoke setting was added to duplicate it.
  - `[low]` `[patch]` **The per-member cap's own docblock called itself "the allocation this reader will ever make"; for a DEFLATE member it is two of them.** `readMember` has to keep the `compressedSize` bytes it read live while `inflateRawSync` fills `uncompressedSize` beside them, so the per-member peak is up to 2 × 64 MB. Still a bound, and irrelevant to a package this app produces — `zipArchive.ts` writes `METHOD_STORE` for the manifest as well as the photos, verified rather than assumed — but a DEFLATE member arrives from any backup someone re-zipped in Finder, which the reader accepts on purpose. Corrected in `zipReader.ts` and in `importLimits.ts`, which repeated the single-member claim.
  - `[low]` `[patch]` **The 300 MB ceiling was unreachable from the app's own dialog by the width of its multipart framing.** `contentLengthExceedsLimit` compared a *whole-body* `content-length` against `MAX_IMPORT_PACKAGE_BYTES`, which is the ceiling on the *file part* — the number the reader counts and the number the user is told. A 300 MB backup declares 300 MB plus the two delimiters, the `content-disposition` line and the `strategy` and `targetTripId` fields, so it was refused `file_too_large` unread. The previous pass had already exported `MULTIPART_FRAMING_SLACK_BYTES` for exactly this and applied it to the four image upload routes, leaving the import route the one caller not using it. Now applied on the multipart branch only — a JSON body has no framing, so `content-length` there is the payload. Pinned both ways: the pre-check test moved to the real ceiling, and a new test proves a length over the file limit but inside the allowance is read and imported rather than refused.
  - `[low]` `[patch]` **"Before Next is asked for the body" read as though the guard avoided the 20 MB buffer. It does not.** Verified in `next/dist/server/body-streams.js`: `cloneBodyStream()` pushes the request into two `PassThrough`s ignoring backpressure and `finalize()` awaits the request's `end` before handing the copy back, so for any matched path the whole body is already resident before the handler's first line. The guard buys the accurate message and nothing else, and in a change set whose standard is comment accuracy that is worth saying. Corrected in `bodyLimit.ts`'s header and in all four route comments. The reviewer's companion suggestion — hoisting the check above the two ownership round trips — was rejected: it would answer a size error before authorising the caller.
  - `[low]` `[patch]` **`bodyLimit.ts` claimed `file.size` "remains the enforcement" behind the pre-check, which is false for the one case the pre-check misses.** A `Transfer-Encoding: chunked` upload sends no `content-length`, so the guard passes; over `proxyClientMaxBodySize` the clone truncates, `request.formData()` throws, and `file.size` is never reached — the route answers `invalid_form_data`, which is the misleading message the guard exists to prevent. Lowering the cap to 20 MB on 2026-08-03 is what put a reachable size in that window. The gap is narrow (the upload was over the route's own ceiling and is refused either way, and a browser `FormData` upload always sends the header) and closing it properly means not asking Next for the body at all, which is the shape `/api/trips/import` now has and a larger change than these four need. Documented precisely instead of overstated.

Nothing new was deferred; DW-142, DW-143 and DW-144 already carry everything this pass found that belongs on the ledger.

Rejected as noise, as out of scope, or as already on the ledger: the v1 and `application/json` branches materialising a 300 MB body plus a string copy, with a proposed few-megabyte `MAX_IMPORT_MANIFEST_BYTES` (the residency is DW-142 and the proposed cap is the one DW-142 records AC8 as forbidding; the branch's bound is the ceiling the client was already told about); `writeImportedPhotos` re-reading and re-inflating a pooled member once per reference, measured at 786 ms for a 15 KB DEFLATE bomb (documented as the deliberate trade for the memory bound, the volume is bounded by `MAX_IMPORT_PHOTO_TOTAL_BYTES` which exists for precisely this amplification and permits the same volume of *writes* regardless, and the loop `await`s a `writeFile` between members so no inflate run monopolises the event loop); no bound on concurrent imports or free space (DW-143); the 64 MB per-member cap being looser than `MAX_IMPORT_PHOTO_BYTES` (rejected on the same grounds last pass — a tightening, not a defect); `readZipMembers` and `parseImportPackage`'s ZIP branch having no production caller left (AC3 required the eager path's suites be kept, and both docblocks already say the eager form exists for the buffer entry point and those tests); the manifest having no schema ceiling of its own (DW-144); `file_too_large` naming the backup when the *whole-body* ceiling tripped on a 1 MB backup padded with 400 KB of epilogue (reachable only from a crafted body, which genuinely is oversized in total, and the code and status are the right class); and no `break` once the closing delimiter has been seen, so a client that stops sending pins the handler (`await request.formData()` stalled identically on that input and held the body in memory rather than on disk, so it is not caused by this change; cancelling a live request stream early to skip an epilogue risks the response never reaching the client, and the resource bound it wants is DW-143's).

## Auto Run Result

Status: done

### What was implemented

The trip import no longer holds its archive in memory. The multipart body is streamed to a `0600` file in the OS temp directory by a new hand-rolled parser, the ZIP is read from that file through a bounds-checked `ZipByteSource`, and members are materialised one at a time. `/api/trips/import` was taken out of `middleware.ts`'s matcher, because Next buffers the request body in memory for every path the matcher covers — a disk-backed reader behind a memory-backed body buffer would have solved half the problem. The route self-guards with `requireSession`, which it already did.

Peak RSS for a 220 MB import fell from **+1808 MB to +250 MB**, and stopped scaling with archive size: doubling the archive from 110 MB to 220 MB now costs 34 MB.

Three ceilings moved, none of them because the story asked. `MAX_TOTAL_UNCOMPRESSED_BYTES` was 200 MB while the route accepted 300 MB, so the 217 MB production trip this story exists to restore was accepted on the wire and then rejected by the reader — it was never restorable, it just failed one ceiling later than the Dev Notes assumed. Review then found that no per-*member* cap existed at all (a 378 KB upload declaring one 398 MB DEFLATE member moved peak RSS by 771 MB), and the first follow-up review found that cap had been applied to the wrong size: `readMember` reads a member's *compressed* bytes before inflating them, so a member declaring a kilobyte uncompressed while pointing at a whole 300 MB archive still made one 300 MB allocation. `MAX_MEMBER_UNCOMPRESSED_BYTES` (64 MB) now bounds both declared sizes, which is what makes AC1's "bounded by the largest single member" a number rather than a hope.

### Files changed

| File | Change |
|---|---|
| `../../travelplan/src/lib/trips/zipReader.ts` | `ZipByteSource` + buffer and file sources; `openZipArchive` with `readMember`/`readMemberHead`; `MAX_CENTRAL_DIRECTORY_BYTES` and `MAX_MEMBER_UNCOMPRESSED_BYTES`, the latter applied to a member's compressed *and* uncompressed size; `MAX_TOTAL_UNCOMPRESSED_BYTES` 200 MB → 400 MB; `readZipMembers` reduced to an eager wrapper |
| `../../travelplan/src/lib/http/multipartToDisk.ts` | **new** — streaming `multipart/form-data` reader writing one named part to a `0600` file opened `O_EXCL`, with whole-body, per-field, part-count and chunking-independent header ceilings; a body that errors mid-flight is a bad request, not a 500 |
| `../../travelplan/src/lib/http/bodyLimit.ts` | **new** — the two body-size guards: `declaredBodyExceedsFileLimit` (the `content-length` pre-check the four still-matched upload routes needed once `proxyClientMaxBodySize` came down) and `readJsonBodyWithinLimit` (the counted read that restores a ceiling to the JSON branch), plus `MULTIPART_FRAMING_SLACK_BYTES`, which the import route now uses too |
| `../../travelplan/src/lib/trips/importPackage.ts` | `PhotoSource` and `openImportPackage`; `looksLikeZipPrefix`; `parseImportPackage` re-implemented over the same internals with its signature unchanged |
| `../../travelplan/src/app/api/trips/import/route.ts` | streams the body to a temp file, reads the ZIP through a descriptor, `requireSession` before `validateCsrf`, bounds the JSON branch by counting, allows for multipart framing in the `content-length` pre-check, releases the descriptor and file in a `finally` covering the whole handler |
| `../../travelplan/src/lib/trips/importPhotos.ts` | `writeImportedPhotos` reads one member per write |
| `../../travelplan/src/lib/repositories/tripRepo.ts` | accepts either photo shape; the content-type sniff reads twelve bytes of a STORE member instead of a whole photo |
| `../../travelplan/src/middleware.ts` | matcher excludes `/api/trips/import` and `/api/trips/import/`, lists `/api/trips` explicitly |
| `../../travelplan/src/lib/trips/importLimits.ts` | `MAX_IMPORT_PACKAGE_BYTES` re-justified against disk and duration rather than RAM; three stale numbers corrected; the peak-memory claim qualified to the ZIP path and to one member per STORE entry, two per DEFLATE entry |
| `../../travelplan/next.config.ts` | `proxyClientMaxBodySize` 320 MB → 20 MB, justified by the four image upload routes that remain matched, and recording the pre-check that keeps the smaller buffer safe |
| `../../travelplan/src/app/api/trips/[id]/hero-image/route.ts`, `.../days/[dayId]/image/route.ts`, `.../accommodations/images/route.ts`, `.../day-plan-items/images/route.ts` | each pre-checks `content-length` against its own `MAX_FILE_SIZE_BYTES`, so an oversized upload keeps its accurate "exceeds size limit" message now that Next's buffer truncates at 20 MB rather than 320 MB |
| `../../travelplan/test/` | `multipartToDisk.test.ts`, `bodyLimit.test.ts` and `tripImportTempFileOnThrow.test.ts` **new**; `tripImportPackage.test.ts`, `tripImportRoute.test.ts`, `middleware.test.ts`, `tripHeroImageRoute.test.ts` and `helpers/zipBuilder.ts` extended |
| `../../travelplan/src/lib/trips/zipArchive.ts` | **not changed** — AC6; read as the reference for the streaming pattern |

### Review findings

Three passes. The first patched 12 (2 high, 5 medium, 5 low), deferred DW-142 and DW-143 and rejected 10. The first follow-up patched 9 (3 medium, 6 low), deferred DW-144 and rejected 7. This second follow-up patched 5 (1 medium, 4 low), deferred nothing and rejected 8.

The reviewers converged on ground already covered: five of the eight rejections this pass are DW-142, DW-143, DW-144 or a finding the previous pass had already weighed and recorded. Of what was left, one was a real behaviour defect — the `content-length` pre-check compared a whole-body figure against a file-part ceiling, so a backup of exactly the documented 300 MB was refused unread by the width of its own multipart framing, and the import route turned out to be the one caller not using the allowance the previous pass had exported for exactly that. The other four were comment claims that outran the code, each checked against the source rather than reasoned about: that the temp file is on disk (true only if `os.tmpdir()` is not a `tmpfs` mount, which nothing in the repo pinned), that the per-member cap is one allocation (two, for a DEFLATE member), that the image routes' guard runs "before Next is asked for the body" (the body is fully buffered by the middleware before the handler's first line — confirmed in `next/dist/server/body-streams.js`), and that `file.size` is the enforcement behind the pre-check (not for a chunked upload over the cap, where Next truncates and `formData()` throws first). Full breakdown in `## Review Triage Log`.

### Verification

- `npm test` — **108 files, 1055 tests, all passing.** 1028 before the story, 1040 after the first review pass, 1054 after the second; one net new here, none removed or weakened.
- `npm run lint` — 85 problems (2 errors, 83 warnings), **byte-identical to the pre-story baseline**.
- `npx tsc --noEmit` — 143 errors, **identical to the baseline, none in `src/`**; all pre-existing test-file typing issues.
- The framing-slack change is pinned both ways: the existing pre-check test moved to the real ceiling (`MAX_IMPORT_PACKAGE_BYTES + MULTIPART_FRAMING_SLACK_BYTES + 1`), and a new test proves a declared length above the file limit but inside the allowance is read and imported rather than refused. Both fail if the allowance is removed.
- Next's buffering behaviour was read out of `node_modules/next/dist/server/body-streams.js` for this pass, not carried over from the previous one's note: `cloneBodyStream()` pushes into two `PassThrough`s ignoring backpressure and `finalize()` awaits the request's `end`, which is what makes the "already resident before the handler" correction correct.
- `zipArchive.ts` was checked before the DEFLATE note was written: it writes `METHOD_STORE` for the manifest as well as the photos, so a compressed member only ever arrives from a re-zipped backup.
- AC7 measured end to end in the first pass against two `next dev` servers from `git worktree` checkouts, throwaway `dev.db` copies on isolated ports. Table in the Completion Notes. Nothing in this pass touches a read path, so it was not re-measured.

### Residual risks

- **The memory bound assumes `/tmp` is real disk.** This is now documented with the check and the `TMPDIR` override rather than being silently assumed, but it is an operational precondition that no test can assert. On a host where `/tmp` is a `tmpfs` mount, AC1 does not hold and nothing logs it. Worth confirming on the production box once.
- **Concurrency is still unbounded** (DW-143): N simultaneous imports each claim their own temp file up to 300 MB, with no semaphore and no free-space precondition. Moving the cost from memory to a shared filesystem removed the accidental back-pressure that memory pressure used to provide.
- **The v1 and `application/json` branches are bounded but still resident** (DW-142): a non-ZIP body is read whole and copied again as a UTF-8 string for `JSON.parse`. Capping it below `MAX_IMPORT_PACKAGE_BYTES` is what AC8 forbids, so the ceiling is the advertised one.
- **The manifest has no schema ceiling of its own** (DW-144): `trip.json`'s effective limit is the reader's 64 MB per-member cap, so a synthetic manifest that trips it gets a message about the reader rather than about the schema. No export produces one.
- **A chunked upload over 20 MB to one of the four still-matched image routes answers `invalid_form_data`** rather than a size message, because Next truncates before the handler can measure anything. Unreachable from this app's client, which always sends `content-length`; documented rather than closed, since closing it means taking those routes off `request.formData()` too.
