---
authored_against: 850d633
baseline_commit: 850d633197b125206a24eb6a2655f9706c54696d
---

# Story 8.6: The Sixth Route Story 8.4 Left Out

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## ⛔ This is the ledger's only open `high`, and it exists because 8.4's spec was wrong

Story 8.4 closed DW-194 — removing a day image recursively deleted every photo and document on that day — by building `src/lib/trips/mediaCleanup.ts` around one rule, *one file, never a tree*, and applying it to five routes.

**Its spec excluded a sixth on a stated ground that is false.** 8.4 argued the hero-image route "owns a flat file, not a tree". The rollback there reads:

```ts
// src/app/api/trips/[id]/hero-image/route.ts:109, :121-124
const uploadDir = getTripUploadDir(tripId);          // ← the whole trip, not a flat file
…
if (!updated) {
  await fs.rm(uploadDir, { recursive: true, force: true });
  return fail(apiError("not_found", "Trip not found"), 404);
}
```

`getTripUploadDir(tripId)` is the root of the trip's entire media tree — every day image, every stay and activity photo, and every Story 9.1 document, across every day. So this is **DW-194 one level broader**: the failed hero upload rolls back by destroying the trip's whole media library while touching no row, leaving every chip and strip rendering a 404 and an export able to emit only `Skipped document whose file is missing on disk`.

Recorded as **DW-305**, found incidentally by 8.4's own review — which checked the spec's reasoning against the code rather than trusting it.

## Story

As someone whose hero-image upload fails at the last step,
I want that failure to clean up the file it just wrote,
so that it does not take every photo and document in the trip with it.

## Acceptance Criteria

1. **AC1** — When `updateTripHeroImageForUser` returns `null`, the rollback removes only the hero file this request wrote. Every day image, stay photo, activity photo and document elsewhere in the trip survives on disk, byte-identical.
2. **AC2** — The hero file this request wrote **is** removed, so the fix does not trade a data-loss defect for an orphaned-bytes one.
3. **AC3** — The route still answers `404 not_found` in that branch. Only the cleanup changes.
4. **AC4** — The cleanup goes through `removeManagedMediaFile` rather than a second implementation of the same rule. Story 8.4 built the instrument; this story is its sixth call site.

## Tasks / Subtasks

- [ ] `src/app/api/trips/[id]/hero-image/route.ts` (`:121-124`) — replace the `fs.rm(uploadDir, { recursive: true, force: true })` with the helper 8.4 built:
  ```ts
  await removeManagedMediaFile({
    storedUrl: heroImageUrl,
    allowedDir: uploadDir,
    context: "hero image upload rollback",
  });
  ```
  `heroImageUrl` and `uploadDir` are both already in scope at that point (`:109`, `:118`) — AC1, AC2, AC4
- [ ] The same route — leave the `404` and its `apiError("not_found", "Trip not found")` untouched — AC3
- [ ] `test/tripHeroImageRoute.test.ts` — the regression, and **it must fail before the change**: seed a trip with a hero image *and* a day image *and* a stay photo, drive the `POST` so `updateTripHeroImageForUser` returns `null`, then assert the day image and the stay photo still exist and the newly written hero file does not — AC1, AC2
- [ ] `_bmad-output/implementation-artifacts/spec-8-4-media-deletion-that-deletes-only-its-own-file.md` — strike the "owns a flat file, not a tree" exclusion and record that it was wrong. A false premise left standing in a finished spec is what the next reader inherits — AC4

## Dev Notes

### Why `allowedDir` is exactly `uploadDir` here

`removeManagedMediaFile`'s containment rule is that the resolved file's **parent directory must be exactly** the directory the caller names — not a prefix match, which 8.4's first iteration used and which its review demonstrated was an arbitrary-file-unlink primitive.

The hero file is `hero.<ext>` written directly into `getTripUploadDir(tripId)` (`:113-116`). Its parent therefore *is* `uploadDir`, and the rule holds without a special case. That is also what makes this a three-line change: the helper's contract already fits the call site.

### `removeExistingHeroFiles` is not a second defect — do not "fix" it

`:35-49` unlinks the four possible `hero.<ext>` names in the trip directory before writing the new one. Named files, no tree, correct.

It does `throw` on any non-`ENOENT` errno, which looks like DW-195's shape but is not: it runs **before** the write and before the database update, so nothing has been committed and a 500 there is honest. DW-195's rule (log, do not throw) applies to cleanups that run *after* a committed change. Leave this one alone.

### How narrow the window is, and why it is still worth closing

`updateTripHeroImageForUser` returns `null` only when the trip stops satisfying the writer clause between the route gate and the update — the same race DW-245 records for the day route. Rare. But the cost per occurrence is the trip's entire media library, unrecoverable, and the fix is one call.

### What must not regress

- **Story 8.4's five call sites.** They are done and pinned by its tests; this story adds a sixth and changes none of them.
- **`mediaCleanup.ts`'s contract.** It never throws, logs its refusals, and treats `ENOENT` as success. No change to the helper is needed or wanted here.
- **The route's own gate.** Story 5.13 left `hero-image` deliberately owner-only, with a comment saying so. Untouched.

### Traps

1. **Passing the wrong `allowedDir`.** It is `getTripUploadDir(tripId)`, the directory the hero file sits directly in — not a day directory, and not derived from the URL.
2. **Deleting `uploadDir` "if it is empty afterwards".** The same reasoning 8.4 rejected: emptiness is a race, and the directory is legitimately non-empty whenever the trip has any other medium.
3. **Writing a green test.** The regression has to fail first. A test that passes before the change proves the fix nothing.

### Testing

`vitest` (`npm test`), suites under `travelplan/test/`. `test/setup.ts` points `MEDIA_STORAGE_ROOT` at a per-worker temp directory, so file assertions are safe. Story 8.4's own regression tests are the model for the shape.

Record the full-suite baseline before starting and report it after.

### Project Structure Notes

One route file, one test file, one spec correction. No new dependency, no migration, no schema change, no new helper — the helper exists.

### References

- The ledger entry: DW-305 in `_bmad-output/implementation-artifacts/deferred-work.md`
- The instrument and its reasoning: `travelplan/src/lib/trips/mediaCleanup.ts`
- The story whose spec excluded this route: [Source: _bmad-output/implementation-artifacts/8-4-media-deletion-that-deletes-only-its-own-file.md]
- Epic definition: [Source: _bmad-output/planning-artifacts/epics.md#Story 8.6: The Sixth Route Story 8.4 Left Out]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

### Change Log
