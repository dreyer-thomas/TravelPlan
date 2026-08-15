---
title: 'Import boundary refuses stored image URLs that are neither an upload path nor http(s)'
type: 'bugfix'
created: '2026-08-15'
baseline_revision: 'eb3db32'
final_revision: '7a575ea'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: [oversized]
---

<intent-contract>

## Intent

**Problem:** The import schema puts no scheme constraint on a stored image URL: `heroImageUrl` (`tripImportSchemas.ts:480`) is a bare `z.union([z.string().trim(), z.null()])`, and `dayImageUrlOrNull` (`:88-98`) falls back to `z.string().url()`, which parses `javascript:`, `data:` and `file:` happily. Nothing downstream catches it — `isForeignTripUploadUrl` (`tripRepo.ts:2257-2266`) returns `false` for anything `isExternalMediaUrl` accepts — so a hand-edited backup restores a trip whose hero or day image is rendered directly as an `<img src>`.

**Approach:** Add one shared predicate `isSafeStoredImageUrl` (accept set: a `/uploads/`-rooted relative path, or an `http(s)` absolute URL) and one shared field schema `storedImageUrlOrNull`, and apply both to the only two URL-bearing stored-image fields in the manifest. A value outside the accept set is **nulled and counted**, never a 400: a single aggregated English line is unshifted onto `meta.warnings`, the channel the route already merges onto the wire.

## Boundaries & Constraints

**Always:**
- The accept set is exactly `/uploads/…` **or** `http(s)://…`; everything else (`javascript:`, `data:`, `file:`, `blob:`, bare strings, any other scheme) is nulled and counted. *Settled from the ledger's own disagreement — see Design Notes.*
- Rejection nulls one field and warns; it never fails the archive (Story 2.32 AC2).
- The warning uses the house style already in `tripRepo.ts:2599-2619`: plain English, aggregated by count, never one line per item, never localized.
- Reuse `isSafeExternalUrl` (`src/lib/validation/safeExternalUrl.ts`) for the http(s) half rather than re-deriving it.

**Block If:**
- Any existing test named as an AC pin cannot be kept green without editing its assertions — specifically `tripBackupRoundTrip.test.ts:748` (v1 `https://cdn.example.com/hero.jpg` hero restored verbatim through the real route) and the `it.each` at `tripRepo.test.ts:2322`.

**Never:**
- Do not touch `isForeignTripUploadUrl`, `isExternalMediaUrl`, or `dropReplacedUploadUrl` — Story 8.4 owns the path-shaped half, and its overwrite-path guarantees (AC7) must not move.
- Do not touch the deferred-work ledger; the orchestrator records resolution.
- Do not widen scope to `dayImageSchemas.ts` (the live day-image PATCH route), to render-site CSP, or to `urlOrNull` on accommodation `link` / plan-item `linkUrl`.
- Do not add a new field to the success envelope; the existing `warnings` array is the channel.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Upload path kept | `trip.heroImageUrl = "/uploads/trips/t1/hero.webp"` | Parsed verbatim, no warning | No error expected |
| Absolute http(s) kept | `trip.heroImageUrl = "https://cdn.example.com/hero.jpg"` | Parsed verbatim, no warning | No error expected |
| `javascript:` hero | `trip.heroImageUrl = "javascript:alert(1)"` | `heroImageUrl === null`, one warning line, parse succeeds | Nulled, not thrown |
| `data:` day image | `days[0].imageUrl = "data:image/svg+xml,<svg/>"` | `days[0].imageUrl === null`, one warning line | Nulled, not thrown |
| Two bad values | bad hero **and** bad day image | Both null, **one** line reading `2 images` | Nulled, not thrown |
| Null stays null | `heroImageUrl = null`, `imageUrl` absent | `null` / default `null`, no warning | No error expected |
| Route-level | multipart import whose hero is `javascript:…` | HTTP 200, trip + days + segments imported, response `warnings` contains the line | No error expected |

</intent-contract>

## Code Map

- `travelplan/src/lib/validation/safeExternalUrl.ts` -- existing http(s) allowlist predicate; the http(s) half of the new rule delegates to it.
- `travelplan/src/lib/validation/tripImportSchemas.ts` -- owns the change. `:76-86` `externalLinkOrNull` is the model; `:88-98` `dayImageUrlOrNull` is replaced; `:460` day `imageUrl`; `:480` `heroImageUrl`; `:498` `tripImportPayloadSchema` (already `.superRefine`-chained); `:513-520` `meta.warnings`.
- `travelplan/src/app/api/trips/import/route.ts:409` -- merges `[...imported.warnings, ...payload.meta.warnings]` onto the wire. Read-only for this story.
- `travelplan/src/lib/repositories/tripRepo.ts:2596-2619` -- `skippedTravelSegmentWarnings` / `droppedForeignImageWarnings`; the wording house style to match. Read-only.
- `travelplan/test/tripImportSchemas.test.ts` -- `validPayload` `:16`, `v2Payload` `:141`, `withFirstDay` `:172`. New schema tests go here.
- `travelplan/test/tripImportRoute.test.ts` -- `buildMultipartRequest` `:150`, `v2Package()` `:148`, warnings assertion idiom `:559-576`. New route test goes here.

## Tasks & Acceptance

**Execution:**
- [x] `travelplan/src/lib/validation/safeStoredImageUrl.ts` -- new module exporting `isSafeStoredImageUrl(value: string): boolean`, returning `true` for a trimmed value starting `/uploads/` or satisfying `isSafeExternalUrl`, else `false` -- one predicate in one place, the same reason `safeExternalUrl.ts` exists.
- [x] `travelplan/src/lib/validation/tripImportSchemas.ts` -- replace `dayImageUrlOrNull` with `storedImageUrlOrNull` (`z.union([z.string().trim().max(2000), z.null()])`, shape and length only, no rejection) and apply it at `:460` and `:480` -- one schema for both stored-image fields, no format rejection so a bad value can be nulled instead of 400ing.
- [x] `travelplan/src/lib/validation/tripImportSchemas.ts` -- chain a `.transform()` onto `tripImportPayloadSchema` after its existing `.superRefine`, walking `trip.heroImageUrl` and every `days[].imageUrl`: null each value failing `isSafeStoredImageUrl`, count them, and when the count is non-zero `unshift` one line onto `meta.warnings` -- the transform is the only place that sees both the raw value and the payload-wide count.
- [x] `travelplan/src/lib/validation/tripImportSchemas.ts` -- update the `meta.warnings` docblock (`:513-515`) so it no longer claims the array records only what the *export* skipped -- the comment becomes false the moment the transform writes to it.
- [x] `travelplan/test/tripImportSchemas.test.ts` -- cover every row of the I/O matrix above the route row -- these are the edge cases the rule exists for.
- [x] `travelplan/test/tripImportRoute.test.ts` -- add a multipart import whose hero is `javascript:…`, asserting HTTP 200, the trip persisted with a null hero, the days/segments imported, and the warning present in the response `warnings` -- proves nulled-and-counted rather than nulled-and-silent.

**Acceptance Criteria:**
- Given a v1 backup whose hero is `https://cdn.example.com/hero.jpg`, when it is imported through the route, then the stored hero is that string verbatim and `tripBackupRoundTrip.test.ts` passes unmodified.
- Given a create-new import whose hero URL is unsafe, when `importTripFromExportForUser` is called by the route, then it receives `null` for that field and its own `droppedImageCount` is unchanged — the schema absorbed the value before the repository saw it.
- Given `npm run lint && npm run typecheck && npm test` in `travelplan/`, when all three run, then all pass with no pre-existing test regressed and no existing assertion edited.

## Spec Change Log

## Review Triage Log

### 2026-08-15 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 6: (high 0, medium 2, low 4)
- defer: 0
- reject: 8: (high 0, medium 0, low 8)
- addressed_findings:
  - `[medium]` `[patch]` The transform counted a dropped image even when `heroPhotoId`/`imagePhotoId` was set, so a warning named a loss the user never suffered — `runTripImport` (`tripRepo.ts:2324-2329`) already draws this distinction. Split nulling from counting: nulled always, counted only when no pooled photo would replace the field. Two new `it.each` rows pin it; the pre-existing new tests were re-fixtured with the photo ids nulled, because every one of them had been asserting the wrong behaviour.
  - `[medium]` `[patch]` `storedImageUrlOrNull`'s `.max(2000)` added a brand-new hard 400 to two fields that previously had no cap, contradicting the change's own AC2 premise that a single bad field must never fail the archive. Moved the bound into `isSafeStoredImageUrl` as `MAX_STORED_IMAGE_URL_LENGTH`, so over-long is nulled and counted like any other unusable address; the field schema now asserts nothing but the type. Added an at-the-cap boundary test and converted the over-length test from `success: false` to nulled-and-counted.
  - `[low]` `[patch]` An empty or whitespace-only URL was nulled *and* counted, reporting a dropped image for a field that carried none. Now normalised to null in silence.
  - `[low]` `[patch]` `tripRepo.ts:2237` and `:2245` still asserted that `heroImageUrl` "carries no format validation at all" and that the gap is one "this rule neither widens nor closes" — both false after this change, and load-bearing in a codebase where the docblock is the specification. Corrected to state that the schema now answers the question a layer up while this rule is unchanged. Comment-only; `isForeignTripUploadUrl` itself untouched.
  - `[low]` `[patch]` The transform docblock claimed the new line "goes first in `warnings`"; it goes first within `meta.warnings`, while the route still puts the repository's own lines ahead of the whole array. Clarified.
  - `[low]` `[patch]` Two prose inaccuracies in the new docblocks: `storedImageUrlOrNull` described a "shape" check it does not perform, and `safeStoredImageUrl.ts` framed `z.string().url()` as the prior defence for both fields when `heroImageUrl` had none at all. Both corrected.

### 2026-08-15 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 0, medium 1, low 3)
- defer: 2: (high 0, medium 2, low 0)
- reject: 14: (high 0, medium 0, low 14)
- addressed_findings:
  - `[medium]` `[patch]` The sentence this change added to `tripRepo.ts:2237` claimed the import schema "now refuses every one of those spellings before this rule sees it" — false, and falsifiable against the paragraph directly above it, which lists `/uploads//trips/<other>/x` as a confirmed evasion. `isSafeStoredImageUrl` tests `startsWith("/uploads/")`, which `/uploads//…` satisfies; confirmed by execution that five of the six enumerated spellings are refused and that one walks through. In a codebase where the docblock is the specification, a false "this is now handled upstream" claim on a containment rule is the kind of sentence a future reader stops thinking at. Rewritten to state which spellings the upstream test turns away and which walks through it — which strengthens rather than weakens the paragraph's actual argument, that a shape test *anywhere* is walked through by the next spelling somebody invents.
  - `[low]` `[patch]` `safeStoredImageUrl.ts` asserted that the import boundary is "the only untrusted writer" these two columns have. `dayImageUpdateSchema` (`dayImageSchemas.ts:3-13`) still guards the day-image PATCH route with exactly the `z.string().url()` fallback this change deleted from the import path, so any trip writer can still store `javascript:` or `data:` in `TripDay.imageUrl`. The gap itself is out of scope by the spec's own Never list; the claim that it does not exist is not. Corrected to name the second writer, say why it is deferred, and record that this predicate closes one door of two. Filed as DW-335.
  - `[low]` `[patch]` `MAX_STORED_IMAGE_URL_LENGTH`'s docblock justified 2000 as "the same 2000 the write side already enforces on this column" — true of `TripDay.imageUrl`, but `Trip.heroImageUrl` takes no string from a client on any route and has no write-side schema at all (no `heroImageUrl` anywhere in `src/lib/validation/` outside this change). Corrected to state that only one of the two columns has a write side to inherit from, and that its bound is being applied to both for want of better evidence.
  - `[low]` `[patch]` The over-length test hard-coded `"a".repeat(2000)` while the at-cap test beside it derived its length from the imported `MAX_STORED_IMAGE_URL_LENGTH`; the two drift the moment the constant moves. Switched to the constant, and corrected the same "the write side caps this column" inaccuracy in that test's comment.

## Design Notes

**The accept set, settled.** The two ledger entries disagree: DW-8's recorded decision (2026-08-01) says accept only a relative `/uploads/` path and asks for a test that an absolute `http(s)` hero is *refused*; DW-317 (2026-08-11) says `/uploads/` **or** `http(s)`. DW-317 wins, on evidence that postdates DW-8: `tripBackupRoundTrip.test.ts:748` drives a v1 manifest with `heroImageUrl: "https://cdn.example.com/hero.jpg"` through the **real import route** and asserts the string back verbatim at `:831`, and `spec-8-4-…md:342` names that test an untouchable AC7 pin. Refusing absolute http(s) is therefore not a stricter version of this fix — it breaks a pinned acceptance criterion of a shipped story. The cost is stated rather than discovered: an `http(s)` hero remains a third-party request from the user's browser on every trip-list render (DW-317's tracking-pixel concern), which is knowingly left open here and belongs to a CSP decision, not to the import boundary.

**Only two fields carry a stored image URL.** Accommodation and plan-item galleries reference the photo pool by `{ sortOrder, photoId }` (`imagesSchema`, `:140-148`) and never carry a URL string; document fields carry `fileName` hardened by `documentFileNameSchema`. So "the day/plan-item image URL fields" in the intent reduces to `days[].imageUrl` alone.

**Why the transform sits on the payload, not on the field.** Zod has no route from a field schema into the warnings channel, and a field-level transform that nulls destroys the evidence a counter needs. One walk at payload level sees both. Wording mirrors the existing lines:

```ts
`Dropped ${count === 1 ? "1 image" : `${count} images`} whose stored address is neither an uploaded file nor an http(s) URL`
```

`unshift` rather than `push`: `route.ts:404-408` explains that the dialog renders only the first ten lines while `meta.warnings` may hold 500, so an appended line can be buried by warnings the export wrote.

**Out of scope, noted not fixed:** `dayImageUpdateSchema` (`src/lib/validation/dayImageSchemas.ts:3-13`) has the same hole on the live day-image PATCH route. DW-8's decision scopes this work to the import boundary, and `tripDayImageRoute.test.ts` pins the current behaviour there.

## Verification

**Commands:**
- `cd travelplan && npm run typecheck` -- expected: exit 0.
- `cd travelplan && npm run lint` -- expected: exit 0, no new warnings on touched files.
- `cd travelplan && npm test -- tripImportSchemas.test.ts tripImportRoute.test.ts` -- expected: all pass, new cases included.
- `cd travelplan && npm test` -- expected: full suite green; specifically `tripRepo.test.ts`, `tripBackupRoundTrip.test.ts` and `tripDayImageRoute.test.ts` pass with no assertion edited.


## Auto Run Result

**Status:** done — follow-up review pass, no code behaviour changed.

**What this pass did.** The implementation was already complete and committed at `10b320c`. This run was the follow-up review the previous pass recommended. Two adversarial reviewers ran in parallel over the full diff since `eb3db32`; their findings were deduplicated and triaged to 4 patches, 2 deferrals and 14 rejections. No `intent_gap` and no `bad_spec`, so no loopback: the shipped behaviour was found correct and is unchanged by this pass. Every patch was a docblock or test-constant correction.

**Files changed in this pass:**
- `travelplan/src/lib/repositories/tripRepo.ts` — corrected the false claim that the import schema refuses every evasive `/uploads/` spelling; `/uploads//…` passes its prefix test.
- `travelplan/src/lib/validation/safeStoredImageUrl.ts` — corrected two prose claims: that the import boundary is the only untrusted writer, and that both columns have a write side enforcing 2000.
- `travelplan/test/tripImportSchemas.test.ts` — derived the over-length fixture from `MAX_STORED_IMAGE_URL_LENGTH` instead of a hard-coded `2000`; corrected the same write-side inaccuracy in its comment.
- `_bmad-output/implementation-artifacts/deferred-work.md` — appended DW-335 and DW-336 as new entries.

**Findings breakdown.** 4 patches applied (1 medium, 3 low), all documentation or test-hygiene. 2 deferred: DW-335, the day-image PATCH route still accepting `javascript:`/`data:`/`file:` — pre-existing, excluded by this spec's own Never list, and now cheap to close because `isSafeStoredImageUrl` was built standalone; DW-336, two NUL bytes in `tripRepo.ts` that make `grep` return nothing and exit 0 for symbols defined in it, found by hitting it during this review and confirmed present at the baseline commit. 14 rejected — the substantive ones being that the overwrite path skips `isForeignTripUploadUrl` (deliberate and documented: `dropForeignUploadUrls: false`, pinned by Story 8.4 AC7) and that `.transform((payload): typeof payload => …)` is a no-op annotation (it is not — it constrains the returned object literal, which is what keeps the schema's output type from drifting).

**Verification.** `npm run typecheck` exit 0. `npm run lint` 0 errors, 79 warnings, all pre-existing and none on the touched lines. `npm test` — 151 files, 2380 tests, all passing, including `tripRepo.test.ts`, `tripBackupRoundTrip.test.ts` and `tripDayImageRoute.test.ts` with no assertion edited. The `/uploads//` gap and the NUL bytes were both confirmed by direct execution rather than inference.

**Residual risks.** The day-image PATCH route remains open (DW-335), which also means the app can currently export a `data:` day image that will not round-trip back through its own import. An `http(s)` hero is still a third-party request on every trip-list render — a knowing, spec-recorded exclusion belonging to a CSP decision. `isSafeStoredImageUrl` is a shape test and is evadable by `/uploads//…`; that is by design and containment is the repository's job, but only on the create-new path.
