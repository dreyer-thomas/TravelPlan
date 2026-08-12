---
title: 'Story 8.6: The Sixth Route Story 8.4 Left Out'
type: 'bugfix'
created: '2026-08-12'
status: 'done'
baseline_revision: 'e7c1539'
final_revision: '48fdeaa'
review_loop_iteration: 0
followup_review_recommended: false
closes_deferred: [DW-305]
context:
  - '{project-root}/_bmad-output/implementation-artifacts/8-6-the-sixth-route-story-8-4-left-out.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-8-context.md'
warnings: [oversized]
---

<intent-contract>

## Intent

**Problem:** `POST /api/trips/[id]/hero-image` rolls back a failed upload with `fs.rm(uploadDir, { recursive: true, force: true })` where `uploadDir = getTripUploadDir(tripId)` (`route.ts:109`, `:121-124`) — the root of the trip's entire media tree. When `updateTripHeroImageForUser` returns `null`, the handler destroys every day image, every stay and activity photo and every Story 9.1 document across every day of the trip, while touching no database row: chips and strips keep rendering and every one of them 404s, and an export can only emit `Skipped document whose file is missing on disk`. This is `DW-194` one level broader, and it is the ledger's only open `high` (`DW-305`). Story 8.4 built the fix and excluded this route on the stated ground that it "owns a flat file, not a tree" — which `:109` shows is false.

**Approach:** Make this route the sixth call site of the instrument 8.4 already built. Replace the recursive tree removal with `removeManagedMediaFile`, which deletes the one file the stored URL names and refuses anything whose parent directory is not exactly `allowedDir`. Then correct the false premise where it was recorded, so the next reader does not inherit it.

## Boundaries & Constraints

**Always:**
- The rollback removes **only** the hero file this request wrote. Everything else under `getTripUploadDir(tripId)` survives **byte-identical**, not merely present.
- The removal goes through `removeManagedMediaFile` from `@/lib/trips/mediaCleanup`. No second implementation of the same rule, no inline `unlink`.
- `allowedDir` is `uploadDir` — the already-in-scope `getTripUploadDir(tripId)` at `:109`. Never derived from a URL, never a day directory.
- The regression test must be observed **failing at baseline** before the route change, and passing after. A test that is green beforehand proves nothing.
- The route's `404 not_found` / `apiError("not_found", "Trip not found")` answer in that branch is unchanged; only the cleanup changes.
- Record the full-suite baseline before starting and report the same suite after.

**Block If:**
- `removeManagedMediaFile`'s containment rule would have to be relaxed, widened, or given a special case for this call site. It fits as-is; if it does not, the premise of the story is wrong.

**Never:**
- No change to `travelplan/src/lib/trips/mediaCleanup.ts`. Its contract (never throws, logs refusals, `ENOENT` is success) is correct and is depended on by 8.4's five existing call sites.
- No change to `removeExistingHeroFiles` (`:35-48`). It unlinks four named files, not a tree, and it runs *before* the write and before the database update, so its non-`ENOENT` `throw` is honest. `DW-195`'s log-don't-throw rule governs post-commit cleanups only. Leave it alone.
- No change to the route's owner-only gate (`:70`) or its Story 5.13 comment.
- Do not remove `uploadDir` "if it is empty afterwards" — emptiness is a race, and the directory is legitimately non-empty whenever the trip holds any other medium.
- No new helper, no dependency, no migration, no schema change, no API-contract change.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Rollback with siblings on disk | Valid owner `POST`, hero written to `<uploadDir>/hero.webp`, trip also holds a day image, a stay photo and a stay document; `updateTripHeroImageForUser` resolves `null` | `<uploadDir>/hero.webp` is gone; day image, stay photo and stay document all still readable and byte-identical; response is `404` with `error.code === "not_found"` | No error expected; helper never throws |
| Successful upload unchanged | Valid owner `POST`, repository returns the updated trip | `200` envelope with the trip and `heroImageUrl` `/uploads/trips/<tripId>/hero.<ext>`; the file stays on disk | No error expected |
| Hero file already absent at rollback | Rollback branch, but the written file was removed out of band first | `404 not_found`; siblings untouched; no throw, no log | `ENOENT` is the desired end state — silent success |
| Unlink fails with a non-`ENOENT` errno | Rollback branch, `fs.unlink` rejects `EACCES` | Still `404 not_found`; siblings untouched | Helper logs `"hero image upload rollback: unable to remove media file"` with `{ filePath, code }` and returns; the route does not surface a 500 |
| Refusals before the write | Unauthenticated, non-owner, contributor, bad type, oversized | Unchanged from today — refused before any file is written, so the rollback branch is never entered | Unchanged |

</intent-contract>

## Code Map

- `travelplan/src/app/api/trips/[id]/hero-image/route.ts` — the single production change. `uploadDir = getTripUploadDir(tripId)` `:109`; hero written to `path.join(uploadDir, "hero.<ext>")` `:113-116`; `heroImageUrl` `:118`; the defect at `:121-124` (the `fs.rm` itself is `:122`) (`if (!updated) { await fs.rm(uploadDir, { recursive: true, force: true }); return fail(...404) }`). `heroImageUrl` and `uploadDir` are both already in scope. `removeExistingHeroFiles` `:35-48` (called at `:111`) — read-only context, do not touch. Owner-only gate `:70` with its Story 5.13 comment — do not touch. `fs` from `node:fs/promises` is imported at `:3` and stays imported (`mkdir`/`writeFile` still use it).
- `travelplan/src/lib/trips/mediaCleanup.ts` — `removeManagedMediaFile({ storedUrl, allowedDir, context })` at `:61`, returns `Promise<void>`, never throws. Containment at `:94`: the resolved file's **parent must be exactly** `path.resolve(allowedDir)` — not a prefix. Refusal logs `` `${context}: refusing to remove media file outside its own directory` `` `:97`. `ENOENT` → silent success; other errno → logs `` `${context}: unable to remove media file` `` `:105-115`. **Read-only for this story.**
- `travelplan/src/lib/trips/uploadPaths.ts` — `getTripUploadDir(tripId)` `:89` = `<MEDIA_STORAGE_ROOT>/uploads/trips/<tripId>`; `resolveStoredMediaPath(url)` `:158` maps `/uploads/trips/<id>/hero.jpg` to that root. The hero file's parent therefore *is* `uploadDir`, so the containment rule holds with no special case.
- `travelplan/test/tripHeroImageRoute.test.ts` — the existing suite (7 tests, real Prisma test DB, no repo mocks). It cannot reach the `null` branch: `hasTripOwnerAccess` and `getTripByIdForUser` have already passed for the same user and trip, so the branch is only reachable with a module mock. **This suite is not the right home for the regression.**
- `travelplan/test/tripDayImageRollback.test.ts` — the exact analogue Story 8.4 wrote for the day route's `null` branch, and the pattern to follow: `vi.hoisted` mock fn + `vi.mock("@/lib/repositories/tripRepo", …)` spreading `importActual` and overriding only the one repository function, then a top-level `await import(...)` of the route so the mock is in place first; siblings seeded directly on disk; assertions on `404` + `error.code`, on the written file being gone, and on each sibling being **byte-identical** via `expect(await fs.readFile(p)).toEqual(Buffer.from(...))`.
- `travelplan/test/setup.ts` `:24-26` — points `MEDIA_STORAGE_ROOT` at `os.tmpdir()/travelplan-test-uploads/worker-<id>`, so filesystem assertions are worker-safe.
- `_bmad-output/implementation-artifacts/spec-8-4-media-deletion-that-deletes-only-its-own-file.md` — carries the false premise in six places: the **Never** clause `:38`, three Review Triage "Rejected" lines (`:294`, `:310`, `:324`) and the Design Notes subsection `### The hero-image exclusion's stated reason is wrong…` `:397-399`, plus the Residual risks note `:450`. That spec is `status: done` and its `<intent-contract>` is a historical record.
- `_bmad-output/implementation-artifacts/deferred-work.md` `:2844-2851` — `DW-305`, `severity: high`, `status: open`. The closing convention is defined by `.claude/skills/bmad-loop-sweep/deferred-work-format.md` (`:60-108`) and is a two-line split: `status: done <date>` on its own, then a `resolution:` line naming the story. Prose belongs in `resolution:`, never in `status:` — the file is line-oriented and readers scan for `<field>:` at line start. A story may also declare `closes_deferred: [DW-…]` in its spec frontmatter, which is the sanctioned way to link a closure to a story.

## Tasks & Acceptance

**Execution:**
- [x] `travelplan/test/tripHeroImageRollback.test.ts` — **write first and observe it fail at baseline.** New suite, modelled on `tripDayImageRollback.test.ts`: mock only `updateTripHeroImageForUser` out of `@/lib/repositories/tripRepo` (spread `importActual`) to resolve `null`, import the route after the mock, seed a real trip on the Prisma test DB, write sibling media directly on disk under `<uploadsRoot>/<tripId>/days/<dayId>/…` (a day image, a stay photo, a stay document) with known byte contents, drive a valid owner `POST` with a hero file, then assert: `404` + `error.code === "not_found"`, the mocked repository called once, `<uploadDir>/hero.<ext>` absent, and every sibling byte-identical. Add the `ENOENT` case (file removed out of band before rollback → still `404`, no throw) and the `EACCES` case (`vi.spyOn(fs, "unlink")` rejecting, `console.error` spied and restored in a `finally` → still `404`, log line `"hero image upload rollback: unable to remove media file"` with `expect.objectContaining({ code: "EACCES" })`) — covers the I/O matrix rows -- proves the defect exists before the fix and is closed after
- [x] `travelplan/src/app/api/trips/[id]/hero-image/route.ts` (`:121-124`) — replace `await fs.rm(uploadDir, { recursive: true, force: true })` with `await removeManagedMediaFile({ storedUrl: heroImageUrl, allowedDir: uploadDir, context: "hero image upload rollback" })`, adding the import from `@/lib/trips/mediaCleanup`. Leave the `404` and its `apiError("not_found", "Trip not found")` exactly as they are -- the whole production fix, and the only behaviour change in the story
- [x] `travelplan/src/app/api/trips/[id]/hero-image/route.ts` — add a short comment at the rollback naming why the helper is used and why `allowedDir` is `uploadDir` (the hero file sits *directly* in it, so the exact-parent rule holds without a special case) -- the exclusion was inherited once already; the next reader should find the reasoning at the call site
- [x] `_bmad-output/implementation-artifacts/spec-8-4-media-deletion-that-deletes-only-its-own-file.md` — strike the false premise without rewriting history: leave the original **Never** clause `:38` legible but annotate it inline as superseded by Story 8.6 and factually wrong, and append a correction to its Design Notes subsection at `:397-399` recording that the exclusion's stated reason was false, that the deferral was nevertheless the right call under a read-only contract, and that `DW-305` is now closed. Do not touch the Review Triage Log entries -- an append-only record of what each pass decided at the time -- a false premise left standing in a finished spec is what the next reader inherits
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` (`:2844-2851`) — flip `DW-305` from `status: open` to `status: done 2026-08-12` plus a separate `resolution:` line, per `deferred-work-format.md`, naming the helper call that replaced the `fs.rm` and the regression suite that pins it -- the ledger's only open `high`; a shipped fix that leaves it open makes the ledger lie

**Acceptance Criteria:**
- Given a trip whose upload tree holds a day image, a stay photo and a stay document, when a hero upload reaches the rollback branch, then all three are still present and byte-identical afterwards. *(AC1)*
- Given that same rollback, when it completes, then the `hero.<ext>` file this request wrote is gone from `getTripUploadDir(tripId)` — the fix does not trade data loss for orphaned bytes. *(AC2)*
- Given the rollback branch, when the response is produced, then it is still `404` with `error.code === "not_found"` and the message `"Trip not found"`. *(AC3)*
- Given the rollback, when the file is removed, then it is removed by a call to `removeManagedMediaFile` — verifiable by reading the route: no `fs.rm`, no inline `unlink`, and no new copy of the containment rule. *(AC4)*
- Given the full test suite at baseline, when it is run after the change, then it passes with no test that passed before now failing — Story 8.4's five call sites and `mediaCleanup.ts`'s own unit tests included.
- Given a reader who opens Story 8.4's spec afterwards, when they reach the hero-image exclusion, then they find it marked wrong and superseded rather than stated as fact.

## Spec Change Log

## Review Triage Log

### 2026-08-12 — Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 9: (high 0, medium 4, low 5)
- defer: 3: (high 0, medium 2, low 1)
- reject: 3: (high 0, medium 0, low 3)
- addressed_findings:
  - `[medium]` `[patch]` Four ledger closures belonging to Story 8.5 were sitting in the working tree and would have ridden this story's commit. Verified true against the code, then split into their own commit ahead of this one and reworded out of the byte-identical boilerplate they carried. The review named them `DW-79, DW-214, DW-215, DW-151`; the second is actually `DW-148` (`DW-214` is an unrelated distance-prefill entry) and flipping the id the review gave would have closed the wrong entry. `DW-148` also carries a note that its own recorded `decision:` is superseded — 8.5 keeps and surfaces a non-adjacent segment rather than deleting it.
  - `[medium]` `[patch]` `DW-305`'s closure stuffed a five-sentence paragraph into `status:`, which `deferred-work-format.md:60-108` reserves for `done <date>` alone, and wrote no `resolution:` line at all. Split into `status:` + `resolution:` — and the same normalisation applied to the four Story 8.5 entries, which had the identical defect.
  - `[medium]` `[patch]` `"(pending commit)"` was written into a permanent record with no second pass to fill the sha in. Removed: the `resolution:` line names the story, per the format doc's own example. `closes_deferred: [DW-305]` added to this spec's frontmatter, which is the sanctioned link.
  - `[medium]` `[patch]` The correction to Story 8.4's spec was written **inside** its `<intent-contract>` at `:38` — a block that spec's own amendment log declares off-limits four times over. The clause is restored byte-for-byte; the correction lives only in the Design Notes, which now states why the contract line was left alone. This spec's task 4 was the cause and has been reworded.
  - `[low]` `[patch]` This spec cited "the four `DW` entries closed by Story 8.5" as the house style for closing a ledger entry — a precedent minted in the same uncommitted tree an hour earlier. Now cites `deferred-work-format.md` directly.
  - `[low]` `[patch]` `epic-8-context.md`'s regeneration asserted "nothing here adds a capability a user can name" while describing Story 8.5's orphaned-leg removal control, claimed 8.2/8.4/8.5 "share nothing" where the previous version recorded that they all touch the export/import round trip, and silently dropped three constraints (the route-matcher character-for-character rule, the native-module ABI decisions, "prove it, don't reason about it"). All restored or reconciled.
  - `[low]` `[patch]` `tripHeroImageRollback.test.ts:133` asserted `rejects.toBeDefined()`, which a mistyped path or an `EACCES` satisfies as readily as the removal AC2 is about. Now `rejects.toMatchObject({ code: "ENOENT" })`.
  - `[low]` `[patch]` Tests 2 and 3 omitted `expect(updateTripHeroImage).toHaveBeenCalledTimes(1)`. Load-bearing in test 3, whose `fs.unlink` mock is gated on that call count: a handler calling the repository twice would silently re-aim the mock and stay green. Added to both, with a comment saying why.
  - `[low]` `[patch]` `postHero` wrapped its body in an IIFE equivalent to a plain `async` arrow. Unwrapped. Also: the route comment now records that this call site passes the **widest** `allowedDir` of the six — the trip root, not a leaf directory — so what makes it safe is that `heroImageUrl` is server-composed, not anything `mediaCleanup.ts` enforces.
  - Deferred (3): `DW-325` the pre-write hero unlink destroys the previous hero irrecoverably (medium, the hero analogue of `DW-315`); `DW-326` a repository *rejection* rather than a `null` skips the rollback entirely and escapes as a 500 page (medium, pre-existing); `DW-327` the narrowed rollback can strand an empty trip upload directory (low, an accepted trade of this change, collectible by `DW-187`'s sweep).
  - Rejected (3): the review bundle omitting files (a complaint about the review packaging, not the artifact); the claim that `DW-151`'s closure names only one of its two alternatives (its text names both); test 3's ordering assumption (subsumed by the call-count assertion above).

## Design Notes

### Why `allowedDir` is exactly `uploadDir`, and why that makes this three lines

`removeManagedMediaFile`'s containment rule is an **exact-parent** test, not a prefix match — 8.4's first iteration used a prefix and its review demonstrated that this was an arbitrary-file-unlink primitive. The hero file is `hero.<ext>` written directly into `getTripUploadDir(tripId)`, so its parent *is* `uploadDir` and the rule holds with no special case. The helper's contract already fits the call site; that is the whole reason this is a small change and not a redesign.

```ts
// route.ts, replacing the recursive rm
if (!updated) {
  // One file, never a tree (Story 8.4). `uploadDir` is the directory the hero file sits *directly*
  // in, so the helper's exact-parent containment rule holds without a special case.
  await removeManagedMediaFile({
    storedUrl: heroImageUrl,
    allowedDir: uploadDir,
    context: "hero image upload rollback",
  });
  return fail(apiError("not_found", "Trip not found"), 404);
}
```

### The branch needs a module mock, so it needs its own file

`tripHeroImageRoute.test.ts` reaches this route through the real repository. By the time control arrives at `:120`, `hasTripOwnerAccess` and `getTripByIdForUser` have both succeeded for the same user and trip, so `updateTripHeroImageForUser` cannot return `null` without a mock — and `vi.mock` of the repository module would distort the other seven tests in that suite. Story 8.4 hit the identical problem on the day route and answered it with a separate `…Rollback.test.ts` file. Follow that, for the same reason.

### Byte-identity, not existence

Asserting siblings merely `exist` would pass against a cleanup that truncated them. Read the bytes back and compare — this is what 8.4's rollback test does, and it is what makes the assertion actually about the blast radius.

### How narrow the window is, and why it is still worth closing

`updateTripHeroImageForUser` returns `null` only if the trip stops satisfying the writer clause between the route gate and the update — the same race `DW-245` records for the day route. Rare. But the cost per occurrence is the trip's entire media library, unrecoverable, and the fix is one call.

### What must not regress

Story 8.4's five call sites are done and pinned by their own suites; this story adds a sixth and changes none of them. `mediaCleanup.ts` itself is untouched.

## Verification

**Commands:** (all run from `travelplan/`)
- `npm test` — expected: full suite green; record the pass/fail counts **before** any change as the baseline and compare after. No previously-passing test may fail.
- `npm test -- test/tripHeroImageRollback.test.ts` — expected: **fails at baseline** (siblings destroyed / hero file assertions), passes after the route change. Both runs must be recorded.
- `npm test -- test/tripHeroImageRoute.test.ts` — expected: all 7 existing tests still pass, unchanged.
- `npm test -- test/mediaCleanup.test.ts test/tripDayImageRollback.test.ts` — expected: green; confirms 8.4's instrument and its analogous call site are undisturbed.
- `npm run typecheck` — expected: clean.
- `npm run lint` — expected: no new findings.

**Manual checks (if no CLI):**
- Read `route.ts` after the change: no `fs.rm` anywhere in the file, `fs` still imported and still used for `mkdir`/`writeFile`/`unlink`-in-`removeExistingHeroFiles`, the `404` branch otherwise identical.
- `grep -n "flat file" _bmad-output/implementation-artifacts/spec-8-4-*.md` — every remaining hit must sit inside an explicit superseded/corrected annotation or the append-only Review Triage Log, never as a standing claim.
- `grep -n -A1 "DW-305" _bmad-output/implementation-artifacts/deferred-work.md` — status reads `done <date>`, not `open`.

## Auto Run Result

Status: **done**. `DW-305`, the ledger's only open `high`, is closed.

### What shipped

The hero-image `POST`'s rollback stopped being a recursive removal of the trip's entire media tree and became the sixth call site of the single-file helper Story 8.4 built. When `updateTripHeroImageForUser` returns `null`, `removeManagedMediaFile({ storedUrl: heroImageUrl, allowedDir: uploadDir, context: "hero image upload rollback" })` removes the one `hero.<ext>` this request wrote and nothing else; the `404 not_found` answer is byte-for-byte what it was. `mediaCleanup.ts` was not touched — its exact-parent containment rule fit the call site unchanged, which is what made this a five-line production change.

The premise that excluded this route from Story 8.4 — "it owns a flat file, not a tree" — is corrected where it was recorded, without editing that spec's frozen intent contract.

### Files changed

- `travelplan/src/app/api/trips/[id]/hero-image/route.ts` — the `fs.rm` replaced by the helper call, plus a comment recording why `allowedDir` is `uploadDir` and that this is the widest `allowedDir` of the helper's six call sites, safe because `heroImageUrl` is server-composed.
- `travelplan/test/tripHeroImageRollback.test.ts` — new. Three cases: siblings byte-identical while the hero file is gone (`ENOENT`-specific), an already-absent hero file staying silent, and a non-`ENOENT` unlink failure logged rather than thrown. Its own file because the branch needs a module mock that would distort the seven existing tests in `tripHeroImageRoute.test.ts`.
- `_bmad-output/implementation-artifacts/spec-8-4-…md` — the false premise corrected in Design Notes and Residual risks; the **Never** clause inside `<intent-contract>` left verbatim by design, with the correction stating why.
- `_bmad-output/implementation-artifacts/deferred-work.md` — `DW-305` closed in the `status:` / `resolution:` split; `DW-325`, `DW-326`, `DW-327` opened from the review.
- `_bmad-output/implementation-artifacts/epic-8-context.md` — regenerated for Story 8.6, then reconciled against constraints the regeneration had dropped.

### Review findings

One pass, two independent reviewers. 0 intent gaps, 0 spec defects, 9 patches applied, 3 deferred, 3 rejected — itemised in the Review Triage Log. No finding touched the production fix's correctness; one reviewer independently reverted the route and confirmed all three new cases fail against the old recursive removal.

### Verification

- Baseline before any change: `Test Files 150 passed (150) / Tests 2353 passed (2353)`.
- Regression observed **failing first**: all three cases red against the recursive `fs.rm`, the load-bearing one on `fs.readFile(dayImagePath)` throwing `ENOENT` — the sibling day image had been destroyed.
- After the change and after the patches: `Test Files 151 passed (151) / Tests 2356 passed (2356)`. Exactly +1 file / +3 tests; nothing that passed before fails.
- `npm run typecheck` clean. `npm run lint` `0 errors, 79 warnings`, all pre-existing (none in the changed or added files).
- Read back: no `fs.rm` remains in the route; `fs` still imported and used for `mkdir`, `writeFile` and `removeExistingHeroFiles`.

### Residual risks

- `DW-325` (medium): `removeExistingHeroFiles` still deletes the previous hero *before* the write, so a failed upload costs the user the image they already had while the row still names it. Out of this story's contract, and the hero analogue of `DW-315` — the two want one fix.
- `DW-326` (medium): a repository *rejection* rather than a `null` skips the rollback entirely and escapes as a 500 page. Pre-existing and unchanged by this story, but now the only unguarded outcome of this branch.
- `DW-327` (low): narrowing the removal can strand an empty `uploads/trips/<id>/` directory in the delete race. An accepted trade — the contract forbids an emptiness test, and `DW-187`'s sweep is where it belongs.
- The window itself stays open: nothing here makes `updateTripHeroImageForUser` returning `null` less likely, it only makes the consequence proportionate.
