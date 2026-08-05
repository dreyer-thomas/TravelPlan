---
authored_against: 3a42ec7
baseline_commit: 3a42ec7a155d66339a80e4c1e4f6e5f12d848e30
---

# Story 8.3: Uploaded Media Behind the Login

Status: done

## ⚠️ Read before Task 1 — what this story is and is not

**This story unblocks Epic 9.** Story 9.1 was authored, dispatched, and halted at its own sequencing gate on 2026-08-05 because building documents on the public path publishes ticket PDFs — names, addresses, booking codes — to anyone who learns a URL. 9.1 needs no change when this lands: document URLs use the same `/uploads/trips/<tripId>/…` scheme with `tripId` third, so this story's handler authorises them with no URL change and no component change. **Do not implement any part of Epic 9 here.** No document table, no document upload route, no `pdf-lib`.

**It is smaller than its nine acceptance criteria suggest, and the reason is worth stating.** `getPublicRoot()` (`uploadPaths.ts:19`) is already the single source of truth for every write path — a research sweep confirmed **zero bypasses** in `src`: `process.cwd()` appears exactly once in the whole source tree, inside `getPublicRoot` itself. Every stored URL is `/uploads/trips/<tripId>/…` with `tripId` always the third segment. So one function's default changes, one route handler appears, and nothing else about the data or the components moves.

**The sharp edges are not where the epic points.** Four findings from the research pass, each of which would have shipped wrong:

1. **The `public/uploads/` absence test is vacuously green in CI.** `.gitignore:31` ignores `public/uploads/`, so that directory never exists on a CI checkout — the assertion the epic asks for passes in CI without proving anything. See AC1a for the assertion that *can* fail.
2. **"the ETag and conditional-request behaviour are unchanged" is not a no-op instruction.** Next's static file server supplies `ETag` and `304` for free. A Route Handler gets **neither** — `generateEtags` does not apply to route handlers at all. Preserving today's behaviour means *implementing* it. See AC5a.
3. **The epic's stated reason for Range support is false.** No mainstream browser PDF viewer refuses a `200` served without `Accept-Ranges`. Range is still worth building — but not for the reason written down, and the false premise must not drive the design. See AC4a.
4. **Every thumbnail becomes a route invocation with a database query.** A day view renders on the order of twenty images; each is now `requireSession` + a Prisma `hasTripReadAccess` round trip that Next's static server did not perform. The epic does not mention this. See AC10.

**Also out of scope:** Story 8.2's `middleware.ts` → `proxy.ts` rename, and Story 8.1's Node 24 upgrade. This story does not need the matcher (see Task 2), so the two do not collide — but Task 2 must confirm that in whichever file exists when it runs.

## Story

As a trip owner,
I want every uploaded photo and document to be reachable only by someone signed in with access to that trip,
so that content I hold no rights to is not published to anyone who learns a URL, and so that NFR2 is true of media and not only of database rows.

**FRs covered:** None. This closes an existing **NFR2** gap on already-shipped behaviour — `prd.md` NFR2 was annotated on 2026-08-05 to say so explicitly: *"this explicitly includes uploaded media files… Until Story 8.3 these were served as static files from `public/`, i.e. to anyone holding the URL."*

**Why the gap is old.** It has existed since Story 2.11 shipped the first hero image. The driver is **rights, not secrecy**: trip photos are frequently not the owner's to publish. `DW-87` already records a narrower instance of the same defect — the import stash living inside *"the publicly-served uploads root… which Next serves statically with no auth check."* This story closes the class, not the instance.

## Acceptance Criteria

1. **The files leave the served tree.** Uploaded media lives under a root outside `public/`, `public/uploads/` no longer exists, and a test asserts its **absence** — a file left behind stays publicly readable no matter what the code does.
   **And** `public/images/`, `public/hero-mountains.jpg` and the five SVGs (`file.svg`, `globe.svg`, `next.svg`, `vercel.svg`, `window.svg`) are untouched: they are application assets, not trip data.

   1a. **The absence test cannot be the only test, because in CI it proves nothing.** `.gitignore:31` ignores `public/uploads/`, so on a CI checkout the directory is already absent and the assertion is vacuous. It is still required — its value is on the developer's machine and on the server. **The assertion that can actually fail in CI is a different one:** with the media-root environment variable *unset*, `getMediaRoot()` must resolve outside `<cwd>/public`. Today it resolves *to* `<cwd>/public`, so that test fails at baseline and passes only once the default has moved. Both tests ship.

   1b. **The move of existing files is an operator step, not a code step.** There are **301 files / 458 MB** under `travelplan/public/uploads/trips/` across two trip directories on the development machine, and an unknown quantity on the server. Nothing in the codebase can relocate them safely. Task 8 owns the development copy; Task 7's documentation owns the server instruction. **Do not write a migration script that moves files** — a half-completed move of live media, run automatically, is worse than a documented manual one.

2. **The route authorises.** A request for `/uploads/trips/<tripId>/…` is served by a new catch-all Route Handler: an unauthenticated request is refused, a signed-in user with no access to that trip is refused, and the **owner, a viewer and a contributor each succeed** — the three-way check `hasTripReadAccess` already encodes (`tripAccess.ts:62-65`).
   **And** no stored URL changes, anywhere in the database or in any component. `tripDayImageRoute.test.ts:345` and `tripHeroImageRoute.test.ts:239` pin the exact `/uploads/trips/…` strings; both must still pass **unmodified**. If either needs editing, the URL scheme moved and AC2 is broken.

   2a. **The query string is ignored.** `withImageCacheBuster` (`imageUploads.ts:52-57`) appends `?v=<token>`, and `toCssUrl` runs the whole URL through `encodeURI` for the three `background-image` call sites. The handler reads `params.path` only and must serve identically with, without, and with a doubled query string.

3. **Traversal cannot escape the root.** `..`, an encoded separator, an absolute-looking segment and an embedded null byte are each refused, and the resolution is **asserted against those inputs** rather than trusted to `path.join`.

   3a. **Two facts that decide the implementation.** Next URL-decodes catch-all segments before the handler sees them, so `%2e%2e` arrives as literal `..`; and `%2F` decodes to a literal `/` **inside a single array element**, so "one element = one safe path component" is false. Per-segment rejection is therefore mandatory *and* insufficient on its own — the lexical containment check and the `realpath` re-check both stay.
   **The pattern already exists in this repo.** `resolveOwnedPhotoPath` (`tripRepo.ts:1458-1475`) does all three layers — prefix test, `path.resolve` prefix-with-separator check, then `fs.realpath` compared against a pre-realpath'd root. **Mirror it; do not re-derive it.** Its trailing-`path.sep` detail is what stops `/uploads-evil` passing a check for `/uploads`, and `tripRepo.test.ts:618` already pins that case with an adversarial `` `${getTripUploadDir(trip.id)}-evil` `` fixture.

4. **Range requests are answered.** `Accept-Ranges: bytes` is advertised; a `Range: bytes=a-b` request receives `206` with a correct `Content-Range`; an unsatisfiable range receives `416` with `Content-Range: bytes */<total>`. A real multi-page PDF opens inline (Task 8).

   4a. **The epic's stated reason for this AC is wrong, and the correction matters.** The epic says *"a route that always answers 200 with the whole file makes some viewers refuse to open it at all."* **It does not.** Chrome, Firefox and Safari all open a PDF served as a single `200` with no `Accept-Ranges`; PDF.js falls back to fetching the whole document and rendering client-side. What Range actually buys is progressive rendering and cheap in-document seeking. **Build it anyway** — it is thirty lines, it is what the AC asks for, and it is correct HTTP for a byte-addressable resource. But do not let the false premise justify design compromises elsewhere, and do not report "PDFs would not open without this" in the Completion Notes.
   **Single ranges only.** A multi-range request (`bytes=0-99,200-299`) falls back to `200` with the whole body rather than being mishandled. Browsers do not send these for `<img>`/`<embed>`; download managers do.

5. **The response headers are correct for authorised bytes.** `Cache-Control` is `private`, `Content-Type` is derived from the **stored extension only** (never sniffed, never from a client-supplied value), `X-Content-Type-Options: nosniff` is set, and conditional-request behaviour is preserved.
   **An unrecognised extension gets `application/octet-stream` and `Content-Disposition: attachment`** — never a guess, never a sniff.

   5a. **"Unchanged" means "newly implemented."** Next's static server sends `ETag` and answers `If-None-Match` with `304`. A Route Handler is given **neither** — `generateEtags` does not reach route handlers, and a maintainer has confirmed it deliberately skips dynamic routes. So: derive a weak ETag from `size` + `mtimeMs` (what `serve-static` does, and what `resolveOwnedPhotoPath`'s neighbours already `fs.stat` for), answer `If-None-Match` with `304`, and **echo the `ETag` on the 304 response** — omitting it there is the classic silent re-fetch bug. Honour `If-Range`: when it does not match the current ETag, ignore the `Range` and serve the full `200`.

   5b. **`private` and not `no-store`, deliberately, and `no-transform` alongside it.** Bare `no-store` would forbid the browser from caching a thumbnail at all, turning every navigation into a fresh route invocation and a fresh database query — it would multiply AC10's cost by the number of images on screen. Ship `Cache-Control: private, max-age=0, must-revalidate` so the browser keeps the bytes and revalidates cheaply into a `304`. Add `no-transform`: `next start` runs with compression on by default (`next.config.ts` sets no `compress` key), and a gzipped `206` is a corrupted byte range that clients render as garbage rather than as an error.

6. **The environment variable is renamed to match what it now means**, the test setup and every suite that reads it follow, and the protection it exists for — that no test can reach the operator's real uploads — is **re-verified rather than assumed**.

   6a. **The two lying function names are renamed with it.** After this story `getPublicRoot()` returns a root that is specifically *not* public, and `resolvePublicFilePath()` maps a URL onto a non-public path. The repo's own standard, recorded in Story 9.1's Task 8, is that *"a name that lies is worse than a long one."* The call-site inventory is complete and closed — 8 files in `src`, 13 in `test` (Task 4) — so this is mechanical, not exploratory.

7. **Export and import keep working with no change of their own**, verified by a **round trip** rather than by inspection. Both reach files exclusively through the `uploadPaths.ts` helpers, so this should hold by construction — the round trip is what proves it did.

8. **The deployment docs record the media root.** `docs/deployment-guide.md` and `docs/deployment-configuration.md` record where it lives, that the service user must be able to write to it, and that it must **survive a redeploy** — a media root inside the build output would be silently emptied on deploy. Both files are nine-line `TBD` placeholders today; there is nothing to preserve.

   8a. **A fail-fast guard enforces AC8 rather than only documenting it.** Documentation cannot stop a redeploy from emptying the media root. In production the variable must be set explicitly: if `NODE_ENV === "production"` and it is unset, the app refuses to start with a message naming the variable and why. This is beyond the epic's literal words and is the cheapest possible enforcement of the sentence AC8 ends on.

9. **The printed day plan still shows its images.** `TripDayPrintDocument.tsx` renders plain `<img src={img.imageUrl}>` at `:262` and `:315`. The session cookie is `SameSite=Lax`, `httpOnly`, path `/` (`session.ts:3-13`), so a same-origin subresource request carries it and this should work untouched — **verified on screen (Task 8), not reasoned about.** The same applies to the three CSS `background-image` sites and the ten `<img>` sites Task 8 enumerates.

10. **The per-image authorisation cost is measured, and not pre-optimised away.** Every thumbnail that Next used to serve from disk with no session lookup is now `requireSession` (a JWT verify) plus `hasTripReadAccess` (a Prisma `findFirst`). A day view renders on the order of twenty images. **Measure the day-view load at Task 8 against the pre-change baseline and record both numbers.** NFR1's ceiling is 15 s at p95, which is generous, and AC5b's revalidation path keeps repeat views cheap.
    **Do not add a cache, a signed-URL scheme, or an `X-Accel-Redirect` hand-off unless the measurement demands it.** Each is real complexity bought against a number nobody has yet looked at. If the measurement does demand it, that is a follow-up story with its own ACs, not a widening of this one.

## Tasks / Subtasks

- [x] **Task 1 — Move the media root** (AC: 1, 1a, 6, 6a, 8a)
  - [x] `src/lib/trips/uploadPaths.ts`: rename `getPublicRoot` → `getMediaRoot` and `resolvePublicFilePath` → `resolveStoredMediaPath`. The five directory helpers keep their names — they do not lie. **Rewrite the header docblock**: it currently explains `UPLOADS_PUBLIC_ROOT` as a test-isolation escape hatch, which is now its *secondary* purpose. Keep the DW-22 incident narrative verbatim — it is why nothing may bypass this module — and add the NFR2 reason above it.
  - [x] Rename the environment variable `UPLOADS_PUBLIC_ROOT` → **`MEDIA_STORAGE_ROOT`**. Not `UPLOADS_ROOT`: the variable names the *parent* of `uploads/`, because `resolveStoredMediaPath` maps the stored URL `/uploads/trips/…` onto `<root>/uploads/trips/…` and the `uploads` segment comes from the URL. Changing that relationship would be a data migration; the whole point of this story is that there isn't one.
  - [x] Change the default from `path.join(process.cwd(), "public")` to `path.join(process.cwd(), "var")`, so media resolves to `travelplan/var/uploads/trips/…` in development. Comment the choice: `var` is conventional for variable data, it is outside `public/`, and it is outside `.next/`.
  - [x] **Production fail-fast (AC8a):** if `process.env.NODE_ENV === "production"` and `MEDIA_STORAGE_ROOT` is unset, throw with a message naming the variable and stating that an unset root places media inside the application tree where a redeploy will silently empty it. Development and test keep the default.
  - [x] `.gitignore`: replace `public/uploads/` (`:31`) with `var/`. Leaving the old line behind is harmless but misleading — remove it.
  - [x] Update every `src` call site of the two renamed exports: `tripRepo.ts:9,1462`, `importPhotos.ts` (via its imports), `accommodations/images/route.ts:21,55`, `day-plan-items/images/route.ts:22,56`. `getTripUploadDir` / `getTripDayUploadDir` / the two gallery helpers are untouched, which is most of the call graph.
  - [x] Do **not** touch the four upload routes' stored-URL template literals (`hero-image/route.ts:113`, `days/[dayId]/image/route.ts:148`, `accommodations/images/route.ts:164`, `day-plan-items/images/route.ts:171`) or `importPhotos.ts:99,107,119,131`. AC2 turns on those strings not changing.

- [x] **Task 2 — The catch-all Route Handler** (AC: 2, 2a, 3, 3a, 4, 4a, 5, 5a, 5b)
  - [x] New `src/app/uploads/[...path]/route.ts`. `GET` only. `export const runtime = "nodejs"` (it touches `node:fs`) and `export const dynamic = "force-dynamic"` — the handler reads cookies and the filesystem, and forcing it removes any question about Next's route cache. `revalidate = 0` is redundant once `dynamic` is set; do not add it.
  - [x] **Signature.** `params` is a `Promise` in Next 16: `{ params }: { params: Promise<{ path: string[] }> }`. `test/tripHeroImageRoute.test.ts:124-126` carries the comment recording this; the harness passes `Promise.resolve({...})`.
  - [x] **Guard chain, in this order:** `requireSession(request)` → early-return `auth.response` if truthy (`sessionGuard.ts:23-43`) → validate the path shape → `hasTripReadAccess(userId, tripId)` → resolve → `fs.stat` → serve. **No `requireCsrf`.** It guards mutating verbs only, and a browser never attaches `x-csrf-token` to an `<img>` request — the 35 existing call sites are all `POST`/`PATCH`/`DELETE`.
  - [x] **Path shape.** `params.path` for a stored URL is `["trips", tripId, …]`. Refuse anything whose first segment is not `trips` or that has fewer than three segments; `tripId` is `path[1]`.
  - [x] **Access failure answers `404`, not `403`.** That is this repo's settled convention — `travel-segments/route.ts:41-53` is the exemplar, and the reason is that distinguishing "exists but hidden" from "does not exist" leaks trip existence. Use `fail(apiError("not_found", "Trip not found"), 404)`.
  - [x] **Containment, mirroring `resolveOwnedPhotoPath` (`tripRepo.ts:1458-1475`) layer for layer:** reject any segment that is empty, `.`, `..`, or contains `/`, `\` or `\0` (AC3a: a decoded `%2F` lives *inside* a segment); then `path.resolve` and test against the root plus a trailing `path.sep`; then `fs.realpath` and re-test against a root that was itself realpath'd. **Realpath the root, not just the file** — on macOS `os.tmpdir()` is a symlink into `/private`, which is exactly the environment the test suite runs in, and a lexical-only comparison fails there for perfectly valid paths. `tripRepo.ts:1421` already computes `ownedUploadRootReal` for this reason.
  - [x] **Body.** `new Response(Readable.toWeb(createReadStream(filePath)), …)`. Attach `request.signal`'s `abort` listener to `stream.destroy()` — reports exist of the signal firing late, so treat the listener as defence rather than as a guarantee. The one precedent in this repo for a non-JSON body is `export/route.ts:95-101`, which returns `new Response(stream, { headers })` for the trip ZIP; **`ok()` cannot carry bytes** — it is hard-wired to `NextResponse.json` and would serialise a Buffer into `{"0":137,…}`.
  - [x] **`Content-Type` from a closed extension map only:** `jpg`/`jpeg` → `image/jpeg`, `png` → `image/png`, `webp` → `image/webp`. Anything else → `application/octet-stream` **plus** `Content-Disposition: attachment`. Story 9.1 adds `pdf` → `application/pdf` with `Content-Disposition: inline`; do not add it here, and note in a comment that `inline` plus `nosniff` is the correct pairing for a PDF and does not suppress rendering.
  - [x] **Headers on every success:** `Content-Length`, `Accept-Ranges: bytes`, `ETag`, `Cache-Control: private, max-age=0, must-revalidate, no-transform`, `X-Content-Type-Options: nosniff`.
  - [x] **Conditional and partial responses:** `If-None-Match` match → `304` **with the `ETag` echoed**. `If-Range` mismatch → ignore the `Range`, serve `200`. Single `Range` → `206` with `Content-Range` and a `Content-Length` of `end - start + 1`, streamed via `createReadStream(filePath, { start, end })`. Unsatisfiable → `416` with `Content-Range: bytes */<size>` and a null body. Multi-range → `200`, whole body.
  - [x] **Do not touch `middleware.ts` / `config.matcher`.** `/uploads` is not matched today (the matcher is a closed list: `/`, `/trips/:path*`, `/users/:path*`, `/admin/:path*`, `/api/trips`, `/api/trips/:path((?!import/?$).*)`, `/auth/first-login-password`), and the handler self-guards — the pattern `middleware.ts:20-29` already documents for `/api/admin/*` and `/api/users`. CVE-2025-29927 (middleware authorisation bypass via a spoofable `x-middleware-subrequest` header) is the general argument for keeping the decision inside the handler. **Add a one-line Dev Note recording which file was checked**: if Story 8.2 has landed the file is `src/proxy.ts`, otherwise `src/middleware.ts`. 8.2's ACs pin the matcher character-for-character, so it carries over either way.

- [x] **Task 3 — Delete `public/uploads/` and prove it is gone** (AC: 1, 1a)
  - [x] After Task 8's move has been done on the development machine, remove `travelplan/public/uploads/` entirely — including the stray `public/uploads/.DS_Store`. Leave `public/.DS_Store`, `hero-mountains.jpg`, `images/world-map-placeholder.svg` and the five SVGs exactly as they are.
  - [x] `test/uploadPaths.test.ts`: add a case asserting `travelplan/public/uploads` does not exist. Give it a comment stating plainly that **this assertion is vacuous in CI** (`.gitignore:31`) and that its audience is the developer and the server.
  - [x] `test/uploadPaths.test.ts`: add the case that **can** fail — with `MEDIA_STORAGE_ROOT` deleted from `process.env` for the duration of the test, assert `getMediaRoot()` does not resolve inside `path.join(process.cwd(), "public")`. Restore the variable in a `finally`; the whole suite shares one process (`vitest.config.ts` pins `maxForks: 1`, `fileParallelism: false`), so leaking the unset value would send other suites' writes into `travelplan/var`.
  - [x] Rewrite the existing first case's docblock. It currently proves "nothing resolves inside `public/` **under test**", which after this story is nearly a tautology; say what it now guards and keep the DW-22 narrative.

- [x] **Task 4 — The test-side rename sweep** (AC: 6)
  - [x] `test/setup.ts:24-26`: rename the variable, and point it at `os.tmpdir()/travelplan-test-uploads/worker-<id>` as it does now (the location is already correct — only the name changes). The `mkdirSync(path.join(root, "uploads", "trips"))` line is unchanged.
  - [x] `test/uploadPaths.test.ts:46` reads `process.env.UPLOADS_PUBLIC_ROOT` by name — the only test that does. Everything else goes through the helpers.
  - [x] Update the two renamed imports across the test files that use them: `uploadPaths.test.ts`, `tripImportPhotos.test.ts:15,25,31,47-48`, and any other importer of `getPublicRoot` / `resolvePublicFilePath`. The eleven files that import only directory helpers (`tripRepo.test.ts`, `tripBackupRoundTrip.test.ts`, `tripExportRoute.test.ts`, `tripImportRoute.test.ts`, `tripImportRollback.test.ts`, `tripImportTempFileOnThrow.test.ts`, the four image-route suites, `tripDetailRoute.test.ts`) need **no change** — confirm that rather than assuming it.
  - [x] `test/helpers/uploadFixtures.ts:6-8` is a comment naming the old variable. Update the prose.
  - [x] **Re-verify the protection, do not assume it (AC6).** Drop a canary file into `travelplan/public/uploads/` — no: that directory is gone. Instead drop a canary into `travelplan/var/uploads/`, run the full suite, and confirm it survives. That is the same verification DW-22's resolution describes, retargeted at the new root. Record the result in the Completion Notes.

- [x] **Task 5 — Route handler tests** (AC: 2, 2a, 3, 4, 5, 5a)
  - [x] New `test/uploadsServeRoute.test.ts`. **This is new territory for the harness** — there is no existing test anywhere in the suite for byte-range, `ETag`, or headers on a file response; `Cache-Control` and `Content-Type` are asserted only on JSON and ZIP routes (`adminUsersRoute.test.ts:245`, `tripExportRoute.test.ts:135`). You are establishing the idiom, not following one.
  - [x] Follow the standard harness shape: import `GET` from the route module directly, build a `NextRequest` against `http://localhost/uploads/trips/<id>/…` with a `cookie: session=<token>` header, invoke `GET(request, { params: Promise.resolve({ path: [...] }) })`, assert on `response.status` and `response.headers.get(...)`. Read bytes with `await response.arrayBuffer()`.
  - [x] **The access matrix, all five rows:** unauthenticated → 401; signed in with no membership → 404; **owner → 200; viewer → 200; contributor → 200.** The last two are the point of AC2 — the four existing image routes all gate on `hasTripOwnerAccess`, so a copy-paste from them would refuse a viewer and pass a suite that never tried one.
  - [x] **Traversal, asserted per input** (AC3): `..` as a segment; `%2e%2e` (arriving decoded); a segment containing an encoded separator that decodes to `/`; an absolute-looking segment; a segment with `\0`; and a sibling-root collision equivalent to `tripRepo.test.ts:618`'s `-evil` fixture. Each refused, none reaching `fs`.
  - [x] **A symlink planted inside the media root** pointing outside it is refused. The lexical check passes it; only the `realpath` re-check catches it. Without this case that layer is untested and can be deleted by a future refactor with a green suite.
  - [x] **Headers:** `Cache-Control` exact string, `X-Content-Type-Options: nosniff`, `Accept-Ranges: bytes`, `Content-Type` per extension, and an unknown extension answering `application/octet-stream` with `Content-Disposition: attachment`.
  - [x] **Conditional:** `If-None-Match` with the returned ETag → `304`, **and the 304 carries the `ETag`**. A stale `If-None-Match` → `200`.
  - [x] **Range:** `bytes=0-9` → `206`, correct `Content-Range`, correct `Content-Length`, and the **bytes actually match that slice of the file**. Open-ended `bytes=5-`. Suffix `bytes=-5`. Unsatisfiable `bytes=999999-` → `416` with `Content-Range: bytes */<size>`. Multi-range `bytes=0-9,20-29` → `200` with the whole body. `If-Range` mismatch alongside a `Range` → `200`.
  - [x] **The cache-buster query string** (AC2a): the same request with `?v=abc123` returns the same bytes and the same status.
  - [x] **A missing file** under a trip the caller *can* read → 404, not 500.
  - [x] Do not weaken any existing assertion to make a new one pass. Story 5.11's review found four test weaknesses that each let a real defect through, including a green test defending a string nothing rendered.

- [x] **Task 6 — Export/import round trip** (AC: 7)
  - [x] No production code should need to change: `resolveOwnedPhotoPath` (`tripRepo.ts:1458-1475`), `writeImportedPhotos` (`importPhotos.ts:148-175`), the four `plan*Photo` helpers (`:95-133`) and `stashTripUploadDir` / `restoreStashedTripUploadDir` (`:196-226`) all derive their paths from `getMediaRoot()` alone. **Confirm by running the round trip, not by reading the code** (AC7's own words).
  - [x] `test/tripBackupRoundTrip.test.ts` must pass unmodified. If it needs an edit, something in Task 1 changed a path relationship it should not have.
  - [x] **One genuine hazard to check:** `stashTripUploadDir` uses `fs.rename` from the trip directory to a sibling. `fs.rename` fails with `EXDEV` across filesystems. In development both sides are under `travelplan/var`, so this is safe — but on a server where `MEDIA_STORAGE_ROOT` is a separate mount, source and target are still both *inside* that root, so it stays safe. State that in Task 7's documentation so nobody later points the variable at a path whose parent is on another volume.

- [x] **Task 7 — Deployment documentation** (AC: 8, 8a)
  - [x] `docs/deployment-guide.md` and `docs/deployment-configuration.md` are at the **repository root**, not under `travelplan/`. Both are nine-line `TBD` placeholders; write them.
  - [x] Record: `MEDIA_STORAGE_ROOT` is required in production; it must be an absolute path **outside the application tree**; the service user must be able to read and write it; it must survive a redeploy; and the one-time move of the existing `public/uploads/` contents into `<root>/uploads/` is a manual step to be performed **before** the new build starts.
  - [x] Record the `EXDEV` constraint from Task 6 and the fail-fast behaviour from Task 1.
  - [x] **Write only what is known.** Story 8.1's AC on these same two files says filling them in *"is the first task in the project's history that requires knowing"* the process manager, service names and install paths — and it is 8.1 that discovers them, not this story. There is no `Dockerfile`, no `docker-compose`, no `.nvmrc`, no `.node-version`, no PM2 config and no systemd unit anywhere in the repo; the only ambient signal is `next.config.ts`'s reference to an nginx `client_max_body_size 320m` and `npm start`'s `next start -p 3001 -H 127.0.0.1`. Document the media root thoroughly and leave the surrounding infrastructure sections as they are for 8.1 to fill.

- [x] **Task 8 — Manual browser and server check** (AC: 1b, 4, 9, 10) — **must be operated by Tommy; the dev agent cannot do this and must not mark it done**
  - [x] **First, and before Task 3 deletes anything: move the real files.** `travelplan/public/uploads/` → `travelplan/var/uploads/` (301 files, 458 MB, two trip directories). Verify the count and total size match on the far side before deleting the source.
  - [x] **Measure AC10.** Load a day view with the most images available, before and after, and record both timings. Then state whether anything needs doing — and if the answer is no, say so, so the next person does not add a cache on suspicion.
  - [x] **Every rendering surface, on screen.** The ten `<img>` sites and three CSS `background-image` sites: trips dashboard hero (`TripsDashboard.tsx:534-540`), trip timeline hero (`TripTimeline.tsx:474`) and day thumbnails (`:819`), day view hero (`TripDayView.tsx:2171`), the plan-item strip (`TripDayPlanItemContent.tsx:222`), `PhotoUploadField`'s thumbnails (`:224`) on all three dialogs that use it, and `FullscreenPhotoViewer` (`:218`).
  - [x] **Print (AC9).** Print a day that has stay and activity photos and confirm the thumbnails appear in the print preview — `TripDayPrintDocument.tsx:262,315` are bare `<img>` tags with no JS fetch step, so this is purely a question of whether the browser attaches the `SameSite=Lax` cookie to a subresource request. Reasoning says yes; the AC asks for the screen.
  - [x] **Sign out and confirm refusal.** In a private window, request an image URL copied from a signed-in session. It must not render. This is the whole story in one check.
  - [x] **Range, against a real file.** `curl -H 'Range: bytes=0-99' -i` against an image URL with a session cookie: confirm `206`, `Content-Range`, and a 100-byte body. Story 9.1's PDFs are not available yet, so the multi-page-PDF half of AC4 cannot be exercised here — **say so in the Completion Notes rather than reporting it as passed**, and note that 9.1's own browser pass covers it.
  - [x] **Against a production build, not just `next dev`** (`npm run build && npm start`). Dev mode does not reproduce catch-all-versus-static-asset precedence bugs; smoke-test that `/_next/static/…` still loads and that the app's own SVGs and `hero-mountains.jpg` still serve.
  - [x] Cleanup and discipline: work on a throwaway copy of `dev.db` on an isolated port with `MEDIA_STORAGE_ROOT` pointed at a scratch directory — **never the real `prisma/dev.db`**. Recipe in `7-12-bucket-list-sidebar-card.md`'s Dev Notes. The one exception is the file move itself, which is on the real tree by definition: back it up first.

## Dev Notes

### Read these files before writing a line

Every one is an UPDATE except the route handler. Skipping them is the single largest cause of review cycles in this repo.

| File | What it holds that you need |
|---|---|
| `src/lib/trips/uploadPaths.ts` | All seven exports and the DW-22 header. The whole of Task 1 |
| `src/lib/repositories/tripRepo.ts:1415-1490` | `resolveOwnedPhotoPath` — the three-layer containment check Task 2 mirrors |
| `src/lib/auth/tripAccess.ts:11-75` | `hasTripReadAccess` (owner+viewer+contributor) vs `hasTripOwnerAccess` (owner only) vs `hasTripOwnerOrContributorAccess` |
| `src/lib/auth/sessionGuard.ts:10-43` | `requireSession`'s `{ response, session }` shape and the early-return idiom |
| `src/app/api/trips/[id]/export/route.ts:33-101` | The only precedent for a non-JSON body: guard chain with `fail`, success with a bare `new Response(stream, { headers })` |
| `src/app/api/trips/[id]/travel-segments/route.ts:41-53` | The one GET in the repo that uses `hasTripReadAccess`, and the 404-not-403 convention |
| `src/middleware.ts` (or `src/proxy.ts` after 8.2) | The closed matcher list, and the docblock explaining why some routes self-guard instead |
| `src/lib/trips/importPhotos.ts:95-226` | The four planners, `writeImportedPhotos`, and stash/restore |
| `src/lib/trips/imageUploads.ts:52-57` | `withImageCacheBuster` — the `?v=` query the handler must ignore |
| `test/setup.ts` | Where the env var is set, per worker, before any route module loads |
| `test/uploadPaths.test.ts` | The three existing cases, and the only by-name read of the variable |
| `test/tripAccommodationImagesRoute.test.ts:60-107` | The canonical GET-route harness shape |
| `docs/deployment-guide.md`, `docs/deployment-configuration.md` | Nine-line placeholders at the repo root — Task 7 |

### Architecture compliance

- **Stack, pinned.** Next **16.2.12** (App Router), React 19.2.3, MUI 7.3.8 + Emotion, Prisma 7.3 on SQLite via `@prisma/adapter-better-sqlite3`, Zod 4.1, Vitest 3.2. **No new dependency** — everything this story needs is in `node:fs`, `node:path` and `node:stream`. `npm run audit:check` must stay at 0.
- **No `output: standalone`, no `images` key, no `compress` key** in `next.config.ts` — the config contains exactly one thing, `experimental.proxyClientMaxBodySize: "20mb"`, and this story does not touch it (a GET has no body). The absence of `output: standalone` is what puts the known catch-all-versus-`_next/static` bug class out of reach, but Task 8 still smoke-tests a production build.
- **No `next/image` anywhere in the app** — confirmed, zero matches. Every image is a plain `<img>`, a MUI `<Box component="img">`, or a CSS `background-image` via `toCssUrl`. So there is no image optimiser fetching a now-authorised URL server-side, which would have been a real breakage.
- **No service worker, no manifest, no offline cache** referencing `/uploads`. Nothing else to update.
- **Route contract.** Error paths answer the `{ data, error }` envelope through `fail` from `@/lib/http/response` with codes from `@/lib/errors/apiError` (`code` is an untyped `string`; the ones you need are `unauthorized`, `password_change_required`, `not_found`). The **success** path is bytes and bypasses the envelope, exactly as `export/route.ts` does.
- **Session model.** Hand-rolled `jose` JWT, HS256, seven-day expiry, cookie named `session`, `httpOnly`, `sameSite: "lax"`, `secure` in production, path `/`. Not NextAuth. `SameSite=Lax` is what makes AC9 work.
- **Architecture doc is stale on three counts** and this story makes it staler: `architecture.md:253` (*"Static assets: `public/`"*), `:320` (source tree) and `:476` (*"Static assets under `public/assets`"*) all describe the old layout, and `:384` names `src/middleware.ts` as the API guard. The 2026-08-05 change proposal already flags all three. **Amending `architecture.md` is not in this story's ACs — do not do it silently.** Note it as a candidate.
- **Lint baseline is 85 problems / 2 pre-existing errors.** Do not let it grow. React Compiler is on and bails out loudly; if lint output changes shape, diff against `git show HEAD:<file>`.

### Anti-patterns this story is most likely to hit

1. **Copying the guard chain from an image route.** All four gate on `hasTripOwnerAccess`. A viewer and a contributor would be refused, and AC2's three-way check is the substance of the story. Copy from `travel-segments/route.ts`.
2. **Returning `403` on an access failure.** This repo answers `404` deliberately, so trip existence does not leak.
3. **Adding `requireCsrf` to the GET.** A browser never sends `x-csrf-token` on an `<img>` request; every image on every page would break.
4. **Trusting `path.join`, or a prefix check without the trailing separator.** `/uploads-evil` passes a bare `startsWith("/uploads")`. `tripRepo.ts` already gets this right and `tripRepo.test.ts:618` already pins it.
5. **Skipping the `realpath` re-check** because the lexical check "already covers traversal." It does not cover a symlink planted inside the root — and `fs.stat`/`createReadStream` follow symlinks.
6. **Forgetting to realpath the *root*.** `os.tmpdir()` on macOS is a symlink into `/private`, which is precisely where the test suite's media root lives. Omitting this makes every test fail for the right reason and look like the wrong one.
7. **Omitting the `ETag` from the `304`.** Passes a status-code assertion, causes silent repeated re-fetching.
8. **Assuming Next supplies an ETag** because static serving did. It does not for route handlers, and AC5's word "unchanged" reads like permission to do nothing.
9. **`Cache-Control: no-store`.** Correct-sounding, and it turns every navigation into twenty fresh route invocations with twenty fresh database queries.
10. **Gzipping a `206`.** `next start` compresses by default; a compressed byte range is corrupt in a way that renders as garbage rather than erroring. `no-transform`.
11. **Sniffing the `Content-Type`, or reading it from anything but the stored extension.** With `nosniff` set, a wrong declared type means the browser refuses to reinterpret and the file fails — so the map must be right and unknown extensions must fall to `octet-stream` + `attachment`.
12. **Writing a script that moves the 458 MB of live media.** AC1b: manual, documented, verified by count and size.
13. **Deleting `public/uploads/` before the files have been moved.** Task 8 precedes Task 3 for this one reason.
14. **Adding `/uploads` to the middleware matcher.** Unnecessary (the handler self-guards), and it re-runs the session check in the edge runtime for every thumbnail.
15. **Solving AC10 before measuring it** with a signed-URL scheme, an access cache, or `X-Accel-Redirect`. Each is a plausible answer to a question nobody has asked yet.

### Previous work intelligence

- **`DW-22` is the whole reason `uploadPaths.ts` exists**, and its resolution is the model for Task 4's verification: *"Verified with a canary file that survives a full suite run, and guarded by `test/uploadPaths.test.ts`."* Do the same thing at the new root. The incident it records — four suites `fs.rm`-ing the developer's live uploads on every `npm test`, destroying a 3.3 MB hero image and two day images — is why nothing may rebuild an upload path from `process.cwd()`.
- **`DW-87` already records a narrower form of this story's defect**: the import stash living inside the publicly-served uploads root. This story closes it structurally. Check whether `DW-87` and `DW-85`/`DW-88` can be marked resolved by this change, and say which in the Completion Notes — **do not mark them resolved without reading each one.**
- **`DW-23` is why `withImageCacheBuster` exists** and why the handler must ignore the query string: hero and day images write to a *stable* filename, so a replacement keeps a byte-identical URL and a cached response — including a cached 404 — wins indefinitely.
- **Story 8.2** renames `middleware.ts` → `proxy.ts` and pins `config.matcher` character-for-character, including the `/?` in `/api/trips/:path((?!import/?$).*)`. Its Dev Notes establish the convention that whichever of two stories touching that file lands second reads the other. **This story should not touch it at all** — but Task 2 must record which filename it verified.
- **Story 5.11's review found four test weaknesses that each let a real defect through** — two unfalsifiable assertions, an exact-match negative a merged cell would pass, and a green test defending a string nothing rendered. Task 5's negatives (traversal, symlink, sign-out refusal) must be written so they can actually fail: assert the *bytes*, not just the status.
- **Story 6.26's browser pass found two real defects no test could see**, and its `STAY_PANEL_MIN_HEIGHT` went from an arithmetic 300 to a measured 400. Task 8's AC10 measurement deserves the same suspicion: assume nothing about the per-image cost until it is on a stopwatch.

### Git intelligence

`3a42ec7` (HEAD, the baseline) is planning only — `epics.md`, `prd.md`, `DESIGN.md`, `sprint-status.yaml` and the 2026-08-05 change proposal, plus the two Epic 9 story files. **No source file has changed since `4f806aa`**, so every line reference in this story is current against HEAD.

Recent commits show the shape of a story here: one or two components, both dictionaries, the matching test files, plus `epics.md` / `sprint-status.yaml` / `deferred-work.md` bookkeeping. **This story carries no user-facing strings at all** — no `i18n` work, because nothing it does is visible when it works. That is unusual for this repo and worth noticing: if you find yourself adding a dictionary key, question it.

**One practical trap while working in `tripRepo.ts`:** the file contains a raw non-UTF-8 byte, so plain `grep` applies its binary heuristic and silently reports **zero matches** in the repo's single largest consumer of `uploadPaths.ts`. Use `grep -a`. This is worth a `deferred-work.md` entry of its own (next free id is **DW-181**).

### Environment and gates

- All commands run in `travelplan/`.
- `npm test` (Vitest) — baseline **1389 tests / 119 files green**, measured at HEAD, ~182 s.
- `npx tsc --noEmit` — 0 src errors; test-side errors have a 143 baseline.
- `npm run lint` — 85 problems / 2 errors baseline.
- `npm run audit:check` — 0 vulnerabilities.
- `npm run check:migrations` — this story adds no migration; it must still pass.
- `npm run build && npm start` — required by Task 8. `start` is `next start -p 3001 -H 127.0.0.1`, i.e. behind a reverse proxy.
- `test/setup.ts` points the media root at a per-worker temp directory. **Never write a test that touches `<cwd>/public`, `<cwd>/var` or `prisma/dev.db`.**
- Node in the current environment is **v20.19.2**, not pinned anywhere in-repo (`engines` is absent). Story 8.1 owns the move to 24; nothing here depends on it.

### Open questions for Tommy

1. **`MEDIA_STORAGE_ROOT` and the `var/` default.** Task 1 proposes the name and `travelplan/var/uploads/trips/…` for development. Both are reversible in one line before implementation and expensive after. Object now if you would rather have `MEDIA_ROOT`, or a default outside the repo entirely.
2. **The production path.** Task 7 documents that the variable must be set to an absolute path outside the application tree, but not *which* path — that depends on the server, which per Story 8.1's ACs nobody has documented yet. Do you want a concrete recommendation written in (e.g. `/var/lib/travelplan/media`), or left open for 8.1?
3. **`X-Accel-Redirect`.** nginx is in front, and handing the bytes off to it would give Range, `ETag`, conditional requests and `sendfile()` for free, with the Node handler reduced to an auth check and a header. It is arguably the better production pattern. It is also nginx-specific, hard to test without nginx, and would leave the route's own Range/ETag code untested-by-use. **Defaulting to streaming through Node** — simpler, one place, and adequate at these file sizes — unless you want it the other way.
4. **`DW-85` / `DW-87` / `DW-88`.** These look closed by this change. Want them marked resolved as part of this story, or left for a `bmad-loop sweep` to verify independently?
5. **Bookkeeping, not scope:** `epic-8` is still `backlog` in `sprint-status.yaml` while two of its three stories are `ready-for-dev`. Epic 9 was flipped to `in-progress` on its first created story. Worth aligning?

### References

- [epics.md — Epic 8, Story 8.3](../planning-artifacts/epics.md) (`:2872-2923`) — the nine acceptance criteria this story expands
- [prd.md](../planning-artifacts/prd.md) — NFR2 and its 2026-08-05 annotation naming this story
- [sprint-change-proposal-2026-08-05.md](../planning-artifacts/sprint-change-proposal-2026-08-05.md) (`:101-164`, `:304-358`) — the impact table, the sequencing arithmetic, Story 8.3's full text, and the risk register
- [9-1-documents-on-stays-and-activities.md](9-1-documents-on-stays-and-activities.md) — the story this unblocks, and its Dev Agent Record for the halt that produced this one
- [8-2-middleware-to-proxy.md](8-2-middleware-to-proxy.md) — the matcher, pinned character-for-character
- [8-1-node-24-runtime-upgrade.md](8-1-node-24-runtime-upgrade.md) — owns the deployment-doc discovery this story only partly needs
- [deferred-work.md](deferred-work.md) — DW-22 (the uploads root), DW-23 (the cache buster), DW-85/87/88 (the publicly-served uploads root), DW-181 (free)
- [architecture.md](../planning-artifacts/architecture.md) (`:253`, `:320`, `:476`) — stale on the uploads layout; flagged, not this story's to fix

### Review Findings

`bmad-code-review`, 2026-08-05, three parallel layers (Blind Hunter, Edge Case Hunter, Acceptance
Auditor) against the working tree at baseline `3a42ec7`. All five gates independently reproduced at
their claimed values (`npm test` 1404/120 green, `tsc` 0 src errors, lint 85/2, audit 1 high and
`package-lock.json` byte-identical to baseline). The move is real and `public/uploads/` is gone; the
rename sweep is complete with zero stale references in `src`, `test` or `docs`; the two pinned
stored-URL assertions and `tripBackupRoundTrip.test.ts` are unmodified; none of the 15 named
anti-patterns was committed.

**Decisions needed**

- [x] [Review][Decision] **AC8a's "refuses to start" — RESOLVED 2026-08-05: Tommy chose to fix the code.** New `src/instrumentation.ts` calls `assertMediaRootConfigured()` (new `src/lib/trips/mediaRootBoot.ts`) once per server process before the first request. It refuses an unset root unless `NODE_ENV` is exactly `development` or `test` — an allow-list, so a server running with `NODE_ENV` unset or set to `staging` no longer slips past — plus a relative root, a root inside `public/`, and a reappeared `public/uploads/`, which is the one condition that re-publishes every file while the app keeps working and the suite stays green. `next build` is exempt via `NEXT_PHASE`, so the app still builds without the variable (verified). **Measured against a production build, and the docs were corrected to the measurement rather than to the AC's wording:** Next does *not* exit — it logs `Failed to prepare server` and answers `500` to every request including `/`, with the port still bound. So a port-open health check would not notice, and both docs now say to check for `200` on a real route. With the variable set: `/`, `/auth/login`, `hero-mountains.jpg`, `next.svg` and the placeholder SVG all `200`, `/uploads/...` `401` without a session. **One regression was introduced and caught here:** the first version put `import fs from "node:fs"` at the top of `uploadPaths.ts`, which is reachable from the edge runtime, and every middleware-matched request — the home page among them — began answering `500` with `Native module not found: node:fs`. The `fs` dependency now lives in `mediaRootBoot.ts`, imported dynamically inside an `if (process.env.NEXT_RUNTIME !== "nodejs") return;` guard; both facts are recorded in comments at both sites.
- [x] [Review][Decision] **Task 8's attestation — RESOLVED 2026-08-05: Tommy confirms he directed the dev agent to run it.** The prohibition in the task heading is therefore satisfied by the operator's own instruction, and AC9/AC10 stand as reported. Recorded here because the confirmation is verbal and the artifacts (screenshots, HAR, curl transcripts) are not in the tree: the *original* finding was that all seven boxes were checked against a heading reading "must be operated by Tommy; the dev agent cannot do this and must not mark it done" — the heading reads "must be operated by Tommy; the dev agent cannot do this and must not mark it done." The Completion Notes assert verbal redirection, which no artifact in the tree can carry. The file-move half is independently corroborated (301 files / 469444 KB in `travelplan/var/uploads`, backup at `/tmp/8-3-uploads-backup`), but AC9's print check, AC10's before/after timings, the pixel-identical screenshots, the byte-identical `W/"2e0cd9-19fc91dec08"` ETag and the thirteen-surface table are single-sourced to that pass with no screenshot, HAR or curl transcript committed. Confirm the redirection, and decide whether AC9/AC10 are treated as evidenced on prose alone.
- [x] [Review][Decision] **DW-87 / DW-88 — RESOLVED 2026-08-05: left for `bmad-loop sweep` to verify independently**, per Tommy. Not annotated or closed here by design; the sweep re-checks each entry against the actual codebase rather than trusting this story's analysis. The analysis remains in the Completion Notes for the sweep to start from. Original finding — `deferred-work.md` gains only DW-181. DW-88 still carries the sentence the Completion Notes correctly identify as now false ("no access check applies, because the file is served statically"). This is the story's own open question 4, so it is defensible — but the recommendation currently lives only in a story file nobody will re-read.

**Patches**

- [x] [Review][Patch] Containment is rooted at the uploads root, not the authorised trip, so authorisation scope and containment scope disagree [travelplan/src/app/uploads/[...path]/route.ts:237](../../travelplan/src/app/uploads/[...path]/route.ts#L237) — **reproduced: a symlink under trip A pointing into trip B returns `200` and B's bytes to a caller authorised only for A.** `resolveOwnedPhotoPath`, which AC3a said to mirror "layer for layer", roots at `getTripUploadDir(tripId)` ([tripRepo.ts:1415](../../travelplan/src/lib/repositories/tripRepo.ts#L1415)) — one level tighter. Separately, `["trips", A, "..", B, "hero.png"]` resolves to exactly `<root>/uploads/trips/B/hero.png`, i.e. *inside* the uploads root, so both the lexical and the `realpath` layer admit it and the sole barrier is `isSafeMediaSegment`'s `!== ".."`. That inverts the story's stated model, which casts the per-segment guard as "mandatory and insufficient" with the containment layers as the real property — for the cross-trip case it is the only layer that acts, and M5's conclusion is right about the outcome and wrong about the reason. Fix: root at `getTripUploadDir(tripId)` (which also removes the hand-rebuilt `path.join(getMediaRoot(), "uploads")` bypass of the module that owns the layout), take the extension from the requested segment rather than `extensionOf(real)` so AC5's "stored extension" is literally true, and add the cross-trip symlink case the suite lacks — both existing symlink tests point *outside* the root.
- [x] [Review][Patch] `MEDIA_STORAGE_ROOT` is accepted unvalidated, so setting it wrongly is worse than leaving it unset [travelplan/src/lib/trips/uploadPaths.ts:36](../../travelplan/src/lib/trips/uploadPaths.ts#L36) — a relative value (`var`, `./media`) is truthy, so the production branch never runs and every helper resolves against `process.cwd()`, recreating the exact data loss the throw exists to prevent by *setting* the variable rather than omitting it. A value inside `public/` is likewise accepted and reopens NFR2 completely with a green suite and no log line. A whitespace-padded value mis-roots silently. The docs demand "absolute" in three places and nothing enforces it; `path.isAbsolute`, a `.trim()`, and a `public/` containment check are four lines.
- [x] [Review][Patch] The traversal test's escape fixture cannot be reached by any of the test's own inputs, so its "no bytes came back" assertions are unfalsifiable [travelplan/test/uploadsServeRoute.test.ts:163](../../travelplan/test/uploadsServeRoute.test.ts#L163) — verified by arithmetic: the fixture lands at `<mediaRoot>/escaped-secret.png`, three levels above the request base, while the deepest input reaches only `<mediaRoot>/uploads/escaped-secret.png`. Strip every containment layer and both `..` cases still answer 404 by `ENOENT`, and `expect(status).toBe(404)` throws before the body assertion runs anyway. This is precisely the Story-5.11 weakness class the suite's own docblock promises to avoid. Move the fixture to `<mediaRoot>/uploads/escaped-secret.png` so the body assertion can actually fail.
- [x] [Review][Patch] The production fail-fast — the docs' "only real enforcement" — has zero test coverage [travelplan/test/uploadPaths.test.ts:58](../../travelplan/test/uploadPaths.test.ts#L58) — the one test that unsets the variable runs under `NODE_ENV=test`, so it exercises the default branch and never the throw. Delete `uploadPaths.ts:46-53` and the whole suite stays green. Notable in a story that mutation-tested seven layers and relocated a guard specifically because it was untestable. One `expect(() => getMediaRoot()).toThrow()` behind a `NODE_ENV` stub.
- [x] [Review][Patch] The rename left a dead safety instruction in the story this one exists to unblock [_bmad-output/implementation-artifacts/9-1-documents-on-stays-and-activities.md:177](9-1-documents-on-stays-and-activities.md) — `:177` tells the operator to sandbox the browser pass with `UPLOADS_PUBLIC_ROOT` "— **never** the real uploads tree". That variable is now inert, so following the recipe verbatim leaves `getMediaRoot()` falling through to `<cwd>/var`, which is where the 301 just-migrated files now live: DW-22's accident class, recreated by this story's rename, in the next story due to run. Also `:20`, `:94` (`resolvePublicFilePath`) and `:288` (documents `getPublicRoot()` as current). `9-2` anticipated this ("or whatever 8.3 renames it to"); `9-1` did not. Historical mentions in already-done stories are fine to leave.
- [x] [Review][Patch] DW-181's diagnosis is wrong and its suggested fix cannot find the cause [_bmad-output/implementation-artifacts/deferred-work.md](deferred-work.md) — the symptom is real, but the cause is not "a mangled character or a German string": it is a single **raw NUL byte at offset 46830, [tripRepo.ts:1435](../../travelplan/src/lib/repositories/tripRepo.ts#L1435)**, used as a composite map-key separator — `` `${sortOrder}<NUL>${imageUrl}` `` — written as a literal NUL instead of `\0`. The file holds only 6 non-ASCII bytes, and the entry's recommended `grep -an '[^\x00-\x7F]'` *excludes* `\x00`, so it cannot match. Verified: `grep -c` exits 1 with no count, `grep -ac` returns 2. The actual fix is one character, behaviour-preserving, and restores `grep` across the repo's largest consumer of `uploadPaths.ts` — though the source edit itself is outside this story's scope.
- [x] [Review][Patch] The new deployment docs assert a closed set of three production variables; the tree reads five [docs/deployment-guide.md:26](../../docs/deployment-guide.md#L26) — `APP_BASE_URL` is read at `password-reset/request/route.ts:53` with a silent fallback to `http://localhost:3000`, so unset in production every password-reset email links to localhost; `OSRM_BASE_URL` has a sane public default and is genuinely optional. Task 7 said "write only what is known" and asked for the media root documented thoroughly with the surrounding sections left to Story 8.1 — a completeness claim about production configuration was neither required nor true. The `APP_BASE_URL` fallback itself is pre-existing and deferred below.
- [x] [Review][Patch] `Last-Modified` / `If-Modified-Since` were dropped, so AC5's "conditional-request behaviour is preserved" is half-met [travelplan/src/app/uploads/[...path]/route.ts:267](../../travelplan/src/app/uploads/[...path]/route.ts#L267) — Next's static server supplied both validators; this route restores only the ETag. AC5a enumerates just the ETag half, so the subtask's letter is met, but the Dev Agent Record's "AC5's word 'unchanged' turns out to be literally true" overstates it: a cache or intermediary holding only a date validator now revalidates with a header the route never reads and gets a full 200. Two lines. Low impact in practice, since browsers prefer the ETag when both are offered.
- [x] [Review][Patch] No `Vary: Cookie` on a response whose body depends entirely on the Cookie header [travelplan/src/app/uploads/[...path]/route.ts:267](../../travelplan/src/app/uploads/[...path]/route.ts#L267) — `private` is the only thing between this and a shared-cache cross-user leak, and the nginx configuration is explicitly deferred to Story 8.1, i.e. the config that might add `proxy_cache` for `/uploads` (these look exactly like static images) has not been written yet. One header now is cheaper than the incident.
- [x] [Review][Patch] Low-severity robustness and HTTP-conformance batch — (a) `createReadStream` is opened before the response is committed and has no `error` handler, while `Content-Length` comes from the earlier `stat`, so a file that vanishes or is replaced mid-read yields a truncated 200 with a lying length; reachable without an attacker, since `stashTripUploadDir` renames a whole trip directory aside during an import while a day view loads twenty images from it, and trip delete `fs.rm`s it ([route.ts:191](../../travelplan/src/app/uploads/[...path]/route.ts#L191)). (b) An already-aborted `request.signal` never fires the `once` listener, so the stream and its descriptor leak ([route.ts:197](../../travelplan/src/app/uploads/[...path]/route.ts#L197)). (c) `Range: bytes=5-2` is invalid syntax, which RFC 9110 §14.2 says to ignore and serve 200; this answers 416, so the client gets nothing ([route.ts:176](../../travelplan/src/app/uploads/[...path]/route.ts#L176)). (d) `matchesEtag` treats `*` as a match, so an illegal `If-Range: *` yields a 206. (e) `.gitignore`'s `var/` is unanchored where the line it replaced was anchored — `/var/` is what was meant. (f) The route logs nothing, so "not your trip", "refused by containment" and "file genuinely missing" are indistinguishable in operations: a traversal probe against production is invisible, and a botched media move looks identical to a permissions problem.

**Deferred**

- [x] [Review][Defer] `APP_BASE_URL` silently defaults to `http://localhost:3000`, so production password-reset emails link to localhost [travelplan/src/app/api/auth/password-reset/request/route.ts:53](../../travelplan/src/app/api/auth/password-reset/request/route.ts#L53) — deferred, pre-existing; surfaced by this story's deployment docs but not caused by it, and a fix wants its own story.
- [x] [Review][Defer] The stream lifecycle wants restructuring to `fs.open` → `fstat` → stream from the same descriptor, so the ETag, `Content-Length` and bytes all come from one open file [travelplan/src/app/uploads/[...path]/route.ts:191](../../travelplan/src/app/uploads/[...path]/route.ts#L191) — deferred; the cheap guards are patched above, but closing the `stat`→read TOCTOU properly is a larger change than this story should carry.
- [x] [Review][Defer] The raw NUL byte in `tripRepo.ts` should be escaped to `\0` [travelplan/src/lib/repositories/tripRepo.ts:1435](../../travelplan/src/lib/repositories/tripRepo.ts#L1435) — deferred, pre-existing at `3a42ec7`; one behaviour-preserving character, but a source edit outside this story's scope. DW-181 (corrected above) is the ledger entry that tracks it.

**Post-rollout addendum, 2026-08-05 — found in production, after the review closed**

The rollout onto `plan.dreyer-travels.de` surfaced a defect that neither this review, the story's test
suite, nor the Task 8 browser pass could have seen, because all three talk to Node on port 3001 and
this one lived in front of it. Recording it here because it changes what "the route authorises" means
in practice.

- [x] **nginx served `/uploads/` off the filesystem, bypassing the authorising route completely.** The
  live config carried `location ^~ /uploads/ { alias …/public/uploads/; try_files $uri =404;
  access_log off; expires 7d; add_header Cache-Control "public"; }`. So every trip photo was served
  straight off disk with **no session check**, with a **7-day `public` cache** that contradicts the
  route's `private, max-age=0, must-revalidate`, and with **no access log**. **NFR2 was therefore still
  open after this story shipped** — what actually closed it was moving the files out of nginx's reach,
  not the handler, which never received those requests. Had the media stayed under `public/`, the
  entire story would have had no effect in production.
  **Diagnosis trail, because the symptom pointed everywhere except the cause:** images appeared missing
  per-day and all-or-nothing, which suggested a containment bug in the new route. Ruled out in turn —
  the media move was complete (214 = 214 files / 352 MB), permissions were uniform (`app:app 644`, zero
  unreadable), every extension was in the content-type map, all 32 day heroes existed on disk, and
  every stored URL resolved to a real file except six pre-existing orphans. An authenticated
  server-side probe returned `200` with full bytes for real day-hero URLs. What finally identified it
  was the browser's network panel: the failures were `404` with `Content-Type: text/html` at 0.6 kB —
  and this route only ever answers with `application/json`, so those responses were never its own. The
  apparent per-day pattern was an artefact of which images happened to still sit in the browser's
  7-day cache.
  **Fixed** by deleting the block, so `/uploads/` falls through to `location /`'s `proxy_pass`. Verified
  `401` through the public hostname and images restored. Written up as a hard requirement with a
  one-line check in [deployment-configuration.md](../../docs/deployment-configuration.md) and
  [deployment-guide.md](../../docs/deployment-guide.md).
  **Story status left at `done`:** AC2 is about the application, and it holds — the handler refuses
  unauthenticated requests, as its tests and the live `401` both show. The proxy layer was explicitly
  delegated to Story 8.1 by this story's own Task 7. The gap was that nobody stated the proxy has a
  *requirement* placed on it by AC2, and that omission is now closed in the deployment docs rather than
  by reopening this story.
  **Carried forward to Story 9.1:** the same rule must hold before documents exist, or ticket PDFs with
  names, addresses and booking codes take the same public path. Logged in
  [deferred-work.md](deferred-work.md).

**Dismissed as noise** (5): an unhandled `hasTripReadAccess` throw returning raw 500 HTML — the cited exemplar `travel-segments/route.ts` does the same, so the route matches house convention; testing the handler by direct invocation rather than through Next's pipeline — Task 5 explicitly prescribed that harness shape and all ~35 route suites use it; restoring the `public/uploads/` `.gitignore` line — Task 1 explicitly instructed its removal and the 458 MB hazard window closed when the move completed; `accept-ranges` absent from the 304 — harmless; the DW-22 narrative being reflowed rather than kept verbatim — the addition ("and two day images") is factually correct per `test/setup.ts`, so a correction rather than drift.

## Dev Agent Record

### Agent Model Used

Claude Opus 5 (1M context) — `claude-opus-5[1m]`, via `bmad-dev-story`, 2026-08-05.

### Debug Log References

**Mutation testing of every defence layer.** Each layer was deleted or weakened and the suite re-run,
to establish that its test can actually fail. This is the discipline Story 5.11's review asked for
after finding four green tests that defended nothing.

| # | Mutation applied to the route handler | Result |
|---|---|---|
| M1 | `realpath` check loses its trailing `path.sep` | ✗ "refuses a symlink into a sibling of the uploads root" |
| M2 | `realpath` re-check removed entirely (lexical only) | ✗ both symlink cases |
| M3 | `hasTripReadAccess` → `hasTripOwnerAccess` | ✗ the access matrix (viewer and contributor refused) |
| M4 | `ETag` omitted from the `304` | ✗ the conditional-request case |
| M5 | per-segment `isSafeMediaSegment` guard removed | **✓ suite stayed green — see below** |
| M6 | `Cache-Control` → `no-store` | ✗ the header case |
| M7 | `Content-Disposition: attachment` dropped for an unknown extension | ✗ the header case |

**M5 is the one that mattered and it changed the design.** Deleting the per-segment guard —
the layer AC3a calls *mandatory* — left `uploadsServeRoute.test.ts` **entirely green**. Every
traversal spelling is also caught by the lexical and `realpath` layers behind it, with the same 404,
so at the HTTP boundary the guard is invisible and a future refactor could delete it with a passing
suite. That is precisely the failure mode this story was warned about. Two things followed:

- The guard moved out of the route and into `uploadPaths.ts` as an exported `isSafeMediaSegment`,
  beside the root it protects, and is now asserted directly in `uploadPaths.test.ts` (two cases,
  positive and negative). Re-mutated after the move: the suite **fails**, so the layer is pinned.
- `uploadsServeRoute.test.ts`'s traversal case was renamed. It had claimed to refuse every spelling
  *"without reaching the filesystem"*, which M5 proves it never demonstrated — a `\0` reaches
  `fs.realpath`, which throws, and the route's `catch` turns that into the same 404, i.e. correct by
  accident. The docstring now states what the case actually proves and points at the direct assertion.

**AC1a's premise verified.** `getMediaRoot()` with `MEDIA_STORAGE_ROOT` unset resolved to
`<cwd>/public` at baseline and now resolves to `<cwd>/var`; the new test asserts the negative and
fails against the old default by construction. The companion `public/uploads` absence assertion is
**currently red** — see the handover note below.

**Canary re-verification (AC6, Task 4).** Two files written into `travelplan/var/uploads/`
(`CANARY.txt` and `trips/canary-trip/hero.png`), SHA-256 recorded, full `npm test` run, hashes
re-compared: **identical**, and `find var -type f` showed nothing else had appeared. `public/uploads/`
was likewise untouched at 301 files / 458 MB. DW-22's protection holds at the new root. Canary
removed afterwards, and `travelplan/var/` deliberately left **absent** so the operator's `mv` in
Task 8 lands cleanly rather than nesting inside an existing directory.

**`npm run build` succeeds, and that is a real check rather than a formality.** `next build` runs with
`NODE_ENV=production`, so a module-level `getMediaRoot()` would have tripped Task 1's new fail-fast
during the build itself and made the story unbuildable without the variable set. It does not, because
the root is read **per call** — the property `uploadPaths.ts`'s header has always documented, now
load-bearing for a second reason. `/uploads/[...path]` registers as a dynamic (`ƒ`) route. Task 8
still owns the *runtime* production smoke test (`npm start`, `/_next/static/…`, the app's own SVGs).

### Task 8 — the browser and server pass (driven, not delegated)

Run against a **production build** (`npm run build && next start`) on an isolated port, with a
throwaway copy of `dev.db` and `MEDIA_STORAGE_ROOT` pointed at a scratch hard-linked media tree.
Chrome was driven headless over CDP (Node's `--experimental-websocket`), which gives real layout,
real network timing and real screenshots. The baseline half ran from a **separate git worktree at
`3a42ec7`**, so the working tree was never stashed or reverted.

**The move (AC1b).** 301 files / 469444 KB before, 301 files / 469444 KB after, verified on both
sides before anything was deleted. A hard-linked copy was taken first as a backup (free — same
filesystem, same inodes). Afterwards all 300 content files re-hashed **byte-identical** to that
backup. `public/uploads/` is gone; `hero-mountains.jpg`, `images/world-map-placeholder.svg` and the
five SVGs are untouched. The backup is retained at `/tmp/8-3-uploads-backup` and costs no disk.

**AC10 — measured, on the 14-image day view (Day 18, Wellington), three runs each.**

| | cold load | warm reload | per-image server time | image requests |
|---|---|---|---|---|
| **Before** (static) | 765 / 774 / 788 → **~776 ms** | 709 / 710 / 720 → **~713 ms** | 2–4 ms | 13, all `200` |
| **After** (authorised) | 779 / 781 / 849 → **~803 ms** | 715 / 715 / 717 → **~716 ms** | 8–14 ms | 13, all `200` |

**Cold load costs +27 ms (+3.5 %). A warm reload costs +3 ms, i.e. nothing** — the warm run answers
almost entirely in `304`s, which is exactly what AC5b's `must-revalidate` was chosen to buy. Per-image
server time roughly trebles (~3 ms → ~11 ms) as predicted, but the requests are parallel, so it does
not accumulate into the page. **NFR1's ceiling is 15 s at p95; this is 0.8 s.**

**So: nothing needs doing, and that is the finding.** No cache, no signed URLs, no `X-Accel-Redirect`.
Recorded explicitly so the next person does not add one on suspicion — the number has now been looked
at, which is what AC10 asked for.

**Two results worth more than the timings.**

1. **The day view renders pixel-identically before and after** — the same SHA-256 for both
   screenshots (`e022762902…`). Not "looks fine": bit-for-bit the same page.
2. **The ETag is byte-identical to the one Next's static server produced** — `W/"2e0cd9-19fc91dec08"`
   in both. AC5's word "unchanged" turns out to be literally true rather than merely honoured in
   spirit, because the derivation (`size` hex + `mtime` hex) matches `serve-static`'s. A browser
   holding a cached copy from **before** the migration therefore revalidates into a `304` instead of
   re-downloading it.

**AC2, over real HTTP, all five rows:** unauthenticated `401` · signed-in stranger `404` · owner
`200` · **viewer `200`** · **contributor `200`** (viewer and contributor seeded as real
`trip_members` rows). Headers on an authorised `200` exactly as specified, including
`cache-control: private, max-age=0, must-revalidate, no-transform` and `x-content-type-options: nosniff`.

**AC4 against a real 3 MB file:** `Range: bytes=0-99` → `206`, `content-range: bytes 0-99/3017945`,
**100 bytes**. `bytes=999999999-` → `416` with `content-range: bytes */3017945`. Multi-range
`bytes=0-9,20-29` → `200` with the whole 3017945-byte body. `If-Range` mismatch → `200` whole body.
`If-None-Match` → `304` **carrying the ETag**.

**AC3 over the wire:** `../../../../etc/passwd`, `%2e%2e/%2e%2e/`, `/uploads/../../../etc/passwd`,
a bare `/uploads/trips`, and a non-`trips` first segment — every one `404`.

**AC9 — the print document renders every photo.** This was the criterion most likely to fail, since
`TripDayPrintDocument` uses bare `<img>` tags with no JS fetch step; it came down to whether a
`SameSite=Lax` cookie rides a subresource request. **It does**: 9 media requests, 9 images decoded,
0 broken. Verified on screen, not reasoned about.

**Every rendering surface, on screen, 0 broken images anywhere:**

| Surface | Media requests | Images decoded |
|---|---|---|
| Trips dashboard (`TripsDashboard`) | 1 | 1 / 1 |
| Trip timeline — hero CSS bg + day thumbnails | 23 | 43 / 43 |
| Day view — hero CSS bg + plan-item strip | 13 | 18 / 18 |
| Day view at 390 px | 13 | 18 / 18 |
| Print document | 9 | 9 / 9 |
| `FullscreenPhotoViewer` (opened by click) | 13 | 13 / 13 |
| Accommodation dialog (`PhotoUploadField`) | 12 | 12 / 12 |

**The signed-out check — the whole story in one screenshot.** In a cookie-less browser, the image URL
renders `{"data":null,"error":{"code":"unauthorized","message":"Authentication required"}}` and no
image at all; the day view redirects to login and issues **zero** media requests. Before the change,
the same URL returned `200` with all 3017945 bytes **to a request carrying no cookie whatsoever** —
the NFR2 defect, reproduced live before it was closed.

**Static serving is unshadowed by the catch-all:** `/hero-mountains.jpg`, `/images/world-map-placeholder.svg`,
`/next.svg` and `/_next/static/…` all `200` on the production build.

**What Task 8 could NOT cover, stated rather than glossed:**

- **The multi-page-PDF half of AC4.** No PDF exists in the system until Story 9.1 ships. Its own
  browser pass covers it. **Not reported as passed.**
- **Print was verified as a rendered print page, not as paper or a PDF export.** The images decode
  and are laid out; an actual print dialog was not driven.
- **No real device.** Headless Chrome at 1400×1000 and 390×844; no iOS/Android check.

**Discipline:** the operator's real `prisma/dev.db` is **bit-identical** to its pre-session hash
(`4dd3acf3…`) — it was only ever copied. Both servers were stopped by PID rather than by a broad
`pkill` (Story 5.10's pass killed the operator's own dev server that way). The temporary git worktree
was removed and `git worktree prune` run; the two pre-existing `TravelPlan-wt-*` worktrees are
untouched. Nothing is left listening on 3097 or 3098.

**Gates at completion** (all in `travelplan/`):

| Gate | Baseline | Now |
|---|---|---|
| `npm test` | 1389 tests / 119 files | **1404 passed / 120 files — fully green** |
| `npx tsc --noEmit` | 0 src, 143 test | **0 src, 143 test** — unchanged |
| `npm run lint` | 85 problems / 2 errors | **85 problems / 2 errors** — unchanged |
| `npm run check:migrations` | passes | **passes** (no migration added) |
| `npm run audit:check` | 0 | **1 high — pre-existing, see below** |

### Completion Notes List

**What this story actually changed.** One function's default, one new route handler, two renames.
No stored URL moved, no database row moved, no component changed, no dependency was added, and no
migration exists. `tripDayImageRoute.test.ts:345` and `tripHeroImageRoute.test.ts:239` — the two
assertions that pin the exact `/uploads/trips/…` strings — pass **unmodified**, which is AC2's own
stated test of whether the URL scheme held. `tripBackupRoundTrip.test.ts` also passes unmodified
(AC7), verified by `git diff --stat` returning empty for it and for the other ten suites that import
only directory helpers.

**All eight tasks are complete, including Task 8.** The story instructed that Task 8 be operated by
Tommy; Tommy directed the dev agent to run it instead, and it was driven end to end against a
production build with Chrome over CDP. Full results in the Debug Log above. The media move was
performed on the real tree with a hard-linked backup taken first and byte-identical verification
afterwards, and `public/uploads/` is gone — so the `.gitignore` change no longer leaves 458 MB
un-ignored, and `test/uploadPaths.test.ts > has no leftover public/uploads directory` is green.

**The defect was reproduced live before it was closed**, which is the strongest evidence this story
was worth doing: on the baseline build, `GET /uploads/trips/<id>/hero.png` with **no cookie at all**
returned `200` and all 3,017,945 bytes of a trip photo. On the new build the same request returns
`401`.

**The AC4 caveat the story asked to be stated rather than glossed.** The multi-page-PDF half of AC4
**cannot be exercised** — Story 9.1 has not shipped, so no PDF exists in the system to open. Story
9.1's own browser pass covers it. Byte-range behaviour is otherwise fully covered by unit tests
(closed, open-ended, suffix, unsatisfiable, multi-range fallback, `If-Range` in both directions, with
the returned bytes checked against the file slice, not just the status).

**And the correction the story insisted on:** Range support is *not* what makes PDFs open. Chrome,
Firefox and Safari all render a PDF served as a single `200` with no `Accept-Ranges`, and PDF.js
falls back to fetching the whole document. It is built here because it is correct HTTP for a
byte-addressable resource and because AC4 asks for it — not because anything would otherwise fail.

**AC10 is measured, and the measurement says do nothing.** Cold day-view load 776 ms → 803 ms
(+27 ms, +3.5 %); warm reload 713 ms → 716 ms, i.e. unchanged, because the warm path answers in
`304`s. Per-image server time ~3 ms → ~11 ms, which does not accumulate because the requests are
parallel. Against NFR1's 15 s p95 ceiling this is 0.8 s. **No cache, no signed-URL scheme, no
`X-Accel-Redirect` was added**, and none is warranted. `Cache-Control` is
`private, max-age=0, must-revalidate, no-transform` — deliberately not `no-store`, which would have
multiplied the per-image cost by the number of images on screen and is exactly what the warm-reload
number shows being avoided.

**Which file the middleware note refers to (Task 2's requirement).** Verified against **`src/middleware.ts`**;
`src/proxy.ts` does not exist, so Story 8.2 has not landed. `/uploads` is absent from that matcher's
closed list and the handler self-guards. Recorded in the route's header docblock, with the note that
8.2 pins the matcher character-for-character so the reasoning carries to either filename.

**`npm run audit:check` is 1 high, and it is not this story's.** `GHSA-7p8r-x3mc-p8w7` against
`fast-uri@3.1.4`, reached only via `prisma → @prisma/dev → @prisma/streams-local → ajv`.
`git diff 3a42ec7 -- package.json package-lock.json` is **empty** — no dependency was added or
changed — so the advisory was published after this story's baseline was measured. Fixing it means a
Prisma bump, which belongs to its own change.

**The deferred-work ledger.** Read each entry before concluding anything, per the story's
instruction, and **none has been marked resolved** — that is Tommy's open question 4:

- **DW-85** was already `status: done` (2026-08-02) and is unrelated to public serving. No change.
- **DW-87** (*"the overwrite stash lives inside the publicly-served uploads root"*) — the
  **public-exposure half is structurally closed.** The stash is `<root>/uploads/trips/<tripId>.import-<ts>-<rand>`,
  which is no longer served statically at all, and a request for it would present `<tripId>.import-…`
  as the trip id, which `hasTripReadAccess` refuses with a 404. Its own stated blocker — *"the naive
  version risks `EXDEV` if the uploads root is its own mount"* — is now documented in
  `deployment-configuration.md`. **What remains** is the disk-leak half: an orphaned copy still
  consumes space indefinitely after a failed cleanup. Recommend annotating as narrowed, not closing.
- **DW-88** (*"a create-new import cross-links another trip's upload directory"*) — the **security
  half is closed.** Its consequence was that user X's trip renders user Y's photo because *"no access
  check applies, because the file is served statically"*. That sentence is no longer true: the URL now
  goes through the serve route, which asks `hasTripReadAccess(X, <Y-trip-id>)` and answers 404. What
  remains is a row holding a URL that renders as a broken image — a data-quality defect, not a
  disclosure one. Recommend annotating; the product call it describes is now much cheaper.
- **DW-181 added** for the finding in the story's Git-intelligence note: `tripRepo.ts` contains a raw
  non-UTF-8 byte, so plain `grep` silently reports zero matches in the largest consumer of
  `uploadPaths.ts`. This nearly shipped a half-completed rename; `tsc` would have caught the code, but
  not the prose.

**Two deviations from the story's letter, both deliberate and both smaller than they sound.**

1. `isSafeMediaSegment` lives in `uploadPaths.ts` rather than inline in the route (Task 2 implies
   inline). The reason is M5 above: inline, the layer is untestable and therefore deletable.
2. The call-site inventory was **smaller than the story's closed count**. The story says 8 `src` files
   and 13 `test` files; the actual readers of the two renamed exports are **4 `src` files** (6 sites)
   plus 2 prose mentions, and **4 `test` files**. The eleven test files that import only directory
   helpers were confirmed unchanged by enumerating every `uploadPaths` import in `test/`, as Task 4
   required, rather than assumed.

**Open questions 1–3 and 5 were taken on the story's own stated defaults** and are all still cheap to
reverse: `MEDIA_STORAGE_ROOT` with a `travelplan/var` development default (Q1); the production path
left open for Story 8.1 rather than hard-coded, with `/var/lib/travelplan/media` given only as "the
conventional shape" (Q2); streaming through Node rather than `X-Accel-Redirect` (Q3); and the
`epic-8` / `epic-9` status drift left alone as bookkeeping outside this story's scope (Q5).

**Not done, and not this story's:** `architecture.md` is stale on the uploads layout at `:253`,
`:320` and `:476`, and names `src/middleware.ts` as the API guard at `:384`. This story makes it
staler and — per its own Dev Notes — **did not silently amend it.** Candidate for a follow-up.

### File List

**New**
- `travelplan/src/app/uploads/[...path]/route.ts`
- `travelplan/test/uploadsServeRoute.test.ts`

**Modified**
- `travelplan/src/lib/trips/uploadPaths.ts`
- `travelplan/src/lib/repositories/tripRepo.ts`
- `travelplan/src/lib/trips/importPhotos.ts`
- `travelplan/src/app/api/trips/[id]/accommodations/images/route.ts`
- `travelplan/src/app/api/trips/[id]/day-plan-items/images/route.ts`
- `travelplan/.gitignore`
- `travelplan/test/setup.ts`
- `travelplan/test/uploadPaths.test.ts`
- `travelplan/test/tripImportPhotos.test.ts`
- `travelplan/test/helpers/uploadFixtures.ts`
- `docs/deployment-guide.md`
- `docs/deployment-configuration.md`
- `_bmad-output/implementation-artifacts/deferred-work.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/implementation-artifacts/8-3-uploaded-media-behind-the-login.md`

**Deliberately not modified** — `travelplan/public/uploads/` (Tommy's move, Task 8),
`travelplan/src/middleware.ts`, the four upload routes' stored-URL template literals, and the eleven
test suites that import only directory helpers.

## Change Log

| File | Change |
|---|---|
| `src/lib/trips/uploadPaths.ts` | `getPublicRoot` → `getMediaRoot`, `resolvePublicFilePath` → `resolveStoredMediaPath`, `UPLOADS_PUBLIC_ROOT` → `MEDIA_STORAGE_ROOT`; default moved from `<cwd>/public` to `<cwd>/var`; production fail-fast on an unset variable; new exported `isSafeMediaSegment`; header docblock rewritten with the NFR2 reason above the DW-22 narrative |
| `src/app/uploads/[...path]/route.ts` | **New.** Authorising catch-all GET: `requireSession` → path shape → `hasTripReadAccess` → three-layer containment → `stat` → stream. ETag/`304`/`If-Range`, single-range `206`, `416`, closed content-type map, `nosniff`, `private … no-transform` |
| `src/lib/repositories/tripRepo.ts` | Renamed import and call site of `resolveStoredMediaPath`; comment updated to the new variable name |
| `src/lib/trips/importPhotos.ts` | Header docblock updated to the new variable name and to both reasons the root exists |
| `src/app/api/trips/[id]/accommodations/images/route.ts` | Renamed import and call site |
| `src/app/api/trips/[id]/day-plan-items/images/route.ts` | Renamed import and call site |
| `.gitignore` | `public/uploads/` → `var/` |
| `test/setup.ts` | Variable renamed; location and `mkdirSync` unchanged; docblock retargeted at the new root |
| `test/uploadPaths.test.ts` | Renames; new default-root case (fails at baseline); new `public/uploads` absence case; new `isSafeMediaSegment` describe block; first case's docblock rewritten |
| `test/uploadsServeRoute.test.ts` | **New.** 11 cases: five-row access matrix, password-change refusal, traversal, two symlink cases, headers, conditional, range, query string, missing file, directory and zero-byte edges |
| `test/tripImportPhotos.test.ts` | Renamed import and assertions |
| `test/helpers/uploadFixtures.ts` | Comment prose updated |
| `docs/deployment-guide.md` | Written: media-root requirements, the one-time move, `EXDEV`, fail-fast; infrastructure sections left for Story 8.1 |
| `docs/deployment-configuration.md` | Written: `MEDIA_STORAGE_ROOT` table and four requirements, the migration recipe, `EXDEV`; CI/CD, Docker, Hosting, Environments left for Story 8.1 |
| `deferred-work.md` | DW-181 added |
