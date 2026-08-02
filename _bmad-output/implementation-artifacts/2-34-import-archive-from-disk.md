---
authored_against: ac03570
---

# Story 2.34: Read the Import Archive From Disk

Status: ready-for-dev

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

- [ ] **Task 1 — Get the body to disk without a second copy** (AC: 1, 4)
  - [ ] The body is buffered twice before `importPackage` sees it: once by Next for the middleware, once by `await request.formData()` (`import/route.ts:81`). The route's own comment at `:22` already records the second one — *"`await request.formData()` reads the whole body into memory before the `file.size` check below can run"*.
  - [ ] Decide how to remove the middleware copy and record the choice. Two shapes: take `/api/trips/*/import` out of the middleware matcher and self-guard the route (`5-8`'s spec establishes that a route not covered by the matcher must call `requireSession` itself — this route already does, at `:33`), or stream the body without a second materialisation.
  - [ ] Replace `request.formData()` with a streaming multipart read that writes the file part straight to a temp path. `request.body` is a `ReadableStream`; the multipart framing has to be parsed as it passes rather than after.
  - [ ] `contentLengthExceedsLimit` (`:28-31`) stays and stays first — it is the cheap pre-check that avoids reading an oversized body at all, and it becomes *more* useful once the read is streamed.

- [ ] **Task 2 — Read the ZIP from a file descriptor** (AC: 1, 3)
  - [ ] `readZipMembers(bytes)` (`importPackage.ts:89`) takes a `Buffer`. Give it a source it can seek in instead.
  - [ ] `zipReader.ts`'s docblock records that *"Every read is bounds-checked before it happens"* — it already treats the archive as random-access. The change is where the bytes come from, not how they are validated. Keep `readU16` / `readU32` / `findEndOfCentralDirectory` semantically identical, including the `RangeError` they guard against.
  - [ ] A ZIP is read end-first: the end-of-central-directory record is at the tail, then the central directory, then each member. That is seek-friendly and is why this works at all.
  - [ ] Members are still materialised one at a time to be written out. That is the bound AC1 describes — one member, not the archive.

- [ ] **Task 3 — Temp file lifecycle** (AC: 2)
  - [ ] Create it under the OS temp dir, not under `public/` and not next to the uploads. `uploadPaths.ts` exists precisely because writing into the served tree caused real damage once — do not reintroduce a path that a cleanup routine might sweep.
  - [ ] Remove it in a `finally`, so a validation rejection, a `ZipReadError`, an aborted request and a thrown Prisma error all clean up.
  - [ ] A crash between write and cleanup leaves a file behind. Decide whether that needs a sweep on start-up or is acceptable, and say which.

- [ ] **Task 4 — Re-justify the limits** (AC: 5)
  - [ ] `MAX_IMPORT_PACKAGE_BYTES` is 300 MB, `proxyClientMaxBodySize` is `"320mb"`, and nginx carries `client_max_body_size 320m`. All three were chosen on 2026-08-02 for memory headroom on a 3.8 GB box.
  - [ ] Once memory is no longer the constraint, rewrite `importLimits.ts`'s comment: the 3–4× multiplier it documents stops being true, and a comment that describes a solved problem is worse than none.
  - [ ] Whether to raise the ceiling further is a judgement — the remaining costs are disk, request duration and the write amplification of extracting photos. Say what the number now protects against.

- [ ] **Task 5 — Tests** (AC: 3, 8)
  - [ ] `tripImportPackage.test.ts`, `tripImportRoute.test.ts`, `tripImportPhotos.test.ts`, `tripImportRollback.test.ts` and `tripBackupRoundTrip.test.ts` all exercise this path. Extend rather than rewrite; they are the guard that AC8 holds.
  - [ ] `test/helpers/zipBuilder.ts` builds archives in memory for the tests. It may need to write to a temp file instead — keep both if the reader is given a source abstraction.
  - [ ] Add a malformed-archive case that proves the bounds checking still fires from the new source: a truncated central directory, and a member name attempting `../`.
  - [ ] `npm test` green.

- [ ] **Task 6 — Measure it** (AC: 7)
  - [ ] Build a 217 MB backup — the production trip `cmlntl8qi0001llu8gl827ypj` is that size, or synthesise one from a throwaway database.
  - [ ] Import it and record peak RSS. The point of the story is that this number stops tracking the archive size; a measurement that merely says "it worked" does not demonstrate that.
  - [ ] Throwaway copy of `dev.db` on an isolated port — never `prisma/dev.db`. Recipe in `7-12-bucket-list-sidebar-card.md`'s Dev Notes.

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

### Debug Log References

### Completion Notes List

### File List

### Change Log
