---
baseline_commit: 4653c591abb85e46f451abf898c70d9c038f9d44
---

# Story 15.8: Signed Download Links for Images and Documents

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## ⛔ Prerequisites — read before starting

- **Story 15.7 is done** (`e05a01d`, confirmed `ba8d362`). This story extends its `get_file` and the file shapes of 15.2's `get_day`/`get_bucket_list`. If `src/lib/mcp/tools/fileTools.ts` has no `get_file`, you are on the wrong base.
- Source of truth: Story 15.8 in `epics.md` (added 2026-10-31) and the scope Tommy agreed to in conversation on 2026-10-31. The scope is reproduced in full in this file.
- **`sharp` is not a direct dependency today.** It sits only under `overrides` in `travelplan/package.json`, as a transitive pin for Next. `packetPdf.ts:151` says "there is no image library in this tree" because of this. Task 1 makes it a real dependency. Do not write any image code until that is done.
- Production runs on **linux arm64**. `@img/sharp-linux-arm64` 0.35.5 is already in `package-lock.json` as an optional package, and `npm ci` installs it there.

## Story

As someone who lets an AI client build something from a trip (a travel book),
I want every image and document the connector lists to come with a short-lived download link,
so that the client can fetch the files over HTTPS like any other file, instead of only as embedded resources.

## Acceptance Criteria

1. **Signed link.** `signFileLink(fileId, { width? })` returns
   `${APP_BASE_URL}/f/${fileId}?w=${width}&exp=${exp}&sig=${sig}`. When there is no width, `w` is left out of the query.
   - `exp` is in Unix seconds: `now + FILE_LINK_TTL_SECONDS`.
   - `sig` is `base64url(HMAC-SHA256(secret, "${fileId}|${w}|${exp}"))`, with an empty `w` when the link has no width.
   - The secret is `FILE_LINK_SECRET`, decoded from base64url, at least 32 bytes.
   - `FILE_LINK_TTL_SECONDS` is an integer from 60 to 86400. Anything else, or unset, means 900.
   - With no usable secret, `signFileLink` returns `null`, and callers emit `downloadUrl: null`.

2. **Route `GET /f/{fileId}`** (`src/app/f/[fileId]/route.ts`). The checks run in this order:
   1. **Rate limit.** At most 300 requests per minute per IP, key `file-link:${ip}` through `getClientIp` and `checkRateLimit`. An `"unknown"` IP skips the limit, as the other routes do. Over the limit, the route answers 429.
   2. **Query check.** Answer **403** with an empty body when any of these holds:
      - `exp` or `sig` is missing;
      - `w` is present but not one of `800`, `1600`, `2400`;
      - `exp` is not an integer, or `exp ≤ now`;
      - the signature does not match. Compare with `crypto.timingSafeEqual` on equal-length buffers; a length mismatch is a mismatch.
      - there is no usable secret.
   3. **File lookup.** Look the file up by id across the four media tables. Then resolve it on disk inside its trip's upload tree with the containment rules `get_file` already uses. If the file is unknown, external, outside the tree or missing on disk, answer **404** with an empty body.
   4. **Serve the file** as described in AC 3 and AC 4.

   Nothing in any response tells a wrong signature apart from an expired one or a bad `w`.

3. **Images** (activity or stay image, and any document whose content sniffs as JPEG, PNG or WebP):
   - Process with `sharp`: `autoOrient()`, then `resize({ width: w, withoutEnlargement: true })` when `w` is given.
   - Output **WebP** when the source is WebP or a PNG with alpha. Otherwise output **JPEG**.
   - The output **always carries no metadata** (no EXIF, no GPS, no XMP). sharp's default output does this, so never call `keepMetadata`, `keepExif`, `withExif` or `withMetadata`.
   - The same holds without `w`: the image is re-encoded at its original size, and the stored bytes never leave unprocessed.
   - A document image gets **no** resize. A `w` on a document link answers 403, because such links are never minted with a width.

4. **PDF documents** are streamed unchanged, with `content-type: application/pdf`.

5. **Response headers** on every 200:
   - `content-type` matches the bytes actually sent;
   - `content-length`;
   - `cache-control: private, max-age=${exp - now}`;
   - `x-content-type-options: nosniff`;
   - `content-disposition: inline`.

   The route serves only `/f/{fileId}`. It has no catch-all and no directory listing, and the `fileId` segment must pass the id character set `[A-Za-z0-9_-]{1,64}`; anything else answers 404.

6. **MCP shapes.**
   - In `get_day`, `get_bucket_list` and every write tool that returns the day or the bucket activity in the `get_day` shape, each image carries:
     - `downloadUrl` (signed with `w=1600`);
     - `width` and `height`: the **original** pixel size **after EXIF orientation**, so a portrait phone photo reports portrait.
   - Each document carries `downloadUrl` (no width).
   - An external image (stored URL is `http(s)://…`), an unreadable file, or no secret gives `downloadUrl: null`. Images then also get `width: null` and `height: null`.
   - `get_file` adds the same fields to its metadata.
   - Above the 10 MB transfer cap, `get_file` keeps answering metadata without the embedded resource. Its note now points to `downloadUrl`.

7. **Tool descriptions.** `get_day`, `get_bucket_list` and `get_file` explain, for the model:
   - `downloadUrl` is short-lived (state the minutes), needs no login and no token, and can be fetched with a plain GET;
   - the width is fixed by the link's signature, so another size, or an expired link, needs a new read;
   - `width` and `height` are the original pixels;
   - images arrive without metadata.

8. **Startup check.** With `MCP_ENABLED=true` in production (the same conditions as `assertMcpConfigured`), the server refuses to start unless `FILE_LINK_SECRET` decodes from base64url to at least 32 bytes. The check is called from `instrumentation.ts` inside the existing `nodejs` branch.
   - `deploy/travelplan.env.example` documents both variables, with an empty secret and a generation command.
   - `docs/deployment-configuration.md` (environment table) lists both variables.
   - `deploy/README.md` (Connector section) says Nginx must pass `/f/` to the app and that `FILE_LINK_SECRET` must be set.

9. **Deferred, not built.** `caption` and `isCover` per image are recorded as a new `DW-` entry in `deferred-work.md`, with Tommy's request as the reason.

10. **Tests.** See *Testing* for the full list. Gates:
    - `npm run typecheck` clean;
    - `npm run lint` with 0 errors and no new warnings;
    - `npm test`, `npm run check:migrations` and `npm run build` pass.

## Tasks / Subtasks

- [x] **Task 1: Make `sharp` a dependency** (AC 3)
  - [x] Add `"sharp": "^0.35.5"` to `dependencies` with `npm install sharp@^0.35.5` in `travelplan/`. Keep the `overrides` entry consistent (same range), so Next and the app resolve one copy.
  - [x] Check that `package-lock.json` still lists `node_modules/@img/sharp-linux-arm64` and `@img/sharp-libvips-linux-arm64` (production is arm64), and that `sharp` is no longer `optional`.
  - [x] Next keeps `sharp` external by default (`serverExternalPackages` default list). `npm run build` must pass, with no bundling error for `sharp`.
- [x] **Task 2: Link signing** (AC 1, 8). New module `src/lib/files/fileLinks.ts` (no `node:fs`, `node:crypto` only):
  - [x] `FILE_LINK_WIDTHS = [800, 1600, 2400] as const` and `MCP_IMAGE_LINK_WIDTH = 1600`.
  - [x] `readFileLinkSecret(): Buffer | null` (base64url, ≥ 32 bytes) and `readFileLinkTtlSeconds(): number` (60–86400, default 900).
  - [x] `fileLinkSignature(secret, fileId, w: number | null, exp: number): string`. It is exported, so tests can mint expired or tampered links.
  - [x] `signFileLink(fileId, options: { width?: number; now?: Date }): { url: string; expiresAt: Date } | null`. The base URL comes from `APP_BASE_URL` through `parseBaseUrl` (`src/lib/oauth/config.ts`), with no trailing slash. With no base URL, return `null`.
  - [x] `verifyFileLink({ fileId, w, exp, sig, now }): { ok: true; width: number | null; expiresAt: number } | { ok: false }`. It covers every refusal in AC 2.2.
  - [x] `assertFileLinksConfigured()`: same gate as `assertMcpConfigured` (`NEXT_PHASE`, `NODE_ENV`, `isMcpEnabled()`); it throws `"MCP_ENABLED=true requires FILE_LINK_SECRET (base64url, at least 32 bytes)"`. Call it from `instrumentation.ts` right after `assertMcpConfigured()`.
- [x] **Task 3: One file resolver** (AC 2.3, 6)
  - [x] Move `resolveTripFile` (`fileTools.ts:204`) and `readHead` into a new `src/lib/trips/tripFilePath.ts` as `resolveTripFilePath(tripId, storedUrl)` and `readFileHead(path, n)`. Behaviour stays unchanged: an external URL, a path lexically or realpath-outside `getTripUploadDir(tripId)`, or a missing file give `null`. `fileTools.ts` imports them from there.
  - [x] New `findFileForSignedLink(fileId)` in `connectorReadRepo.ts`. It mirrors `findFileForPlanner`'s four parallel lookups, but by id only (**no user or writer filter**: the signature is the grant; the link is minted only after the tool's writer check), and returns `{ id, tripId, media, url, fileName } | null`. The `tripId` comes from the item (`dayPlanItem.tripId`) or the stay (`accommodation.tripDay.tripId`).
- [x] **Task 4: Image info** (AC 6). New `src/lib/files/imageInfo.ts`:
  - [x] `readImageSize(filePath): Promise<{ width: number; height: number } | null>` via `sharp(filePath).metadata()`. Use `metadata.autoOrient.width/height` (sharp ≥ 0.34, see `node_modules/sharp/lib/index.d.ts:1238`), falling back to `width`/`height`. Any throw gives `null`.
  - [x] Cache results in memory by `${fileId}:${updatedAt.toISOString()}`: a plain `Map`, oldest entry evicted beyond 5,000 entries. A replaced file has a new id or `updatedAt`, so the cache never serves stale sizes.
  - [x] Read at most 8 files at a time (simple batching), because `get_day` may list dozens of images.
- [x] **Task 5: Route `/f/[fileId]`** (AC 2–5). `src/app/f/[fileId]/route.ts`:
  - [x] Set `export const runtime = "nodejs"` and `export const dynamic = "force-dynamic"`, as the `/uploads` route does.
  - [x] The order of AC 2: rate limit, `fileId` charset, `verifyFileLink`, `findFileForSignedLink`, `resolveTripFilePath`, then serve.
  - [x] Find the type by content: `sniffPhotoContentType` and `sniffDocumentContentType` from `importPackage.ts` on `readFileHead(path, 16)`. Never trust the extension or the column.
  - [x] Images per AC 3, from `toBuffer()`; files are capped at 5–10 MB at upload, so buffering is fine. A sharp failure answers 404 (the file is unusable) and is logged once with the file id, never with the path.
  - [x] PDFs: `fs.readFile` (≤ 10 MB) or a stream (`createReadStream` plus `Readable.toWeb`, as `/uploads` does).
  - [x] An image link carries `w`. A document link never does, and its `w` answers 403 (AC 3).
  - [x] Check: `src/proxy.ts`'s matcher must **not** cover `/f` (it is a closed list today; do not add `/f`), so no session logic runs for these requests.
- [x] **Task 6: MCP shapes** (AC 6, 7)
  - [x] Keep `plannerShapes.ts` pure. Add a `FileLinks` type, `Map<fileId, { downloadUrl: string | null; width?: number | null; height?: number | null }>`, as an optional argument through `toFiles`, `toActivity`, `toStay`, `toPlannerDay` and `toBucketActivity`. A missing entry gives `downloadUrl: null` (plus `width`/`height: null` for images), so the shape is the same in every result.
  - [x] New async `buildFileLinks(tripId, media: PlannerMedia[])` in `src/lib/mcp/fileLinkShapes.ts`. It signs each document (no width) and each image (`w=1600`), reads each image's size through `resolveTripFilePath` and `readImageSize`, and gives an external or missing image `null`s. `PlannerMedia.images` already carries `imageUrl`; documents need no disk read.
  - [x] Use it in `get_day` and `get_bucket_list` (`tripRead.ts`), and in `activityWrite.ts`'s `readDay` (~360) and the bucket re-read (~375), so every tool that "returns the day as get_day shows it" stays identical to `get_day`.
  - [x] `get_file`: `fileMetadata` gains `downloadUrl`, plus `width`/`height` for images. Image links carry `w=1600`; for an image-typed document the link has no `w`. The >10 MB note becomes "…too large to transfer here; download it from downloadUrl."
  - [x] Add a shared `FILE_LINK_NOTE` text to the three descriptions, with the minutes taken from `readFileLinkTtlSeconds()`.
- [x] **Task 7: Configuration and docs** (AC 8, 9)
  - [x] `deploy/travelplan.env.example`: in the connector block, add `FILE_LINK_SECRET=` (empty, with the generation command `openssl rand -base64 32 | tr '+/' '-_' | tr -d '='`) and `FILE_LINK_TTL_SECONDS=900`.
  - [x] `docs/deployment-configuration.md`: add both rows to the environment table.
  - [x] `deploy/README.md`, Connector section: the secret, and that Nginx must pass `/f/` (check with `curl -I` on a fresh `downloadUrl`).
  - [x] `deferred-work.md`: add DW-424 (next free number after DW-423; check again), "caption and isCover per image", source this story.
  - [x] `architecture.md`, *MCP endpoint* paragraph: one sentence on signed file links (public `/f/` route, HMAC grant, no session, TTL, metadata stripped).
- [x] **Task 8: Tests and gates** (AC 10). See *Testing*.

### Review Findings

- [x] [Review][Patch] Documents get a downloadUrl without a disk check; sign a document only when `resolveTripFilePath` resolves it, as `get_file` does (Tommy 2026-10-31: AC 6 wins over Task 6) [travelplan/src/lib/mcp/fileLinkShapes.ts:29]
- [x] [Review][Patch] `readFileHead` is not guarded; a file deleted or unreadable between `stat` and the head read throws a 500 instead of the empty 404 (AC 2.3) [travelplan/src/app/f/[fileId]/route.ts:86]
- [x] [Review][Patch] `get_file`'s over-10 MB note says "download it from downloadUrl" even when `downloadUrl` is null (no secret/base URL, unreadable image); keep the old "open it in TravelPlan" wording then [travelplan/src/lib/mcp/tools/fileTools.ts:248]
- [x] [Review][Patch] TTL wording floors to whole minutes, so a TTL of 60–119 s reads "valid about 1 minutes"; round and pluralise [travelplan/src/lib/mcp/fileLinkShapes.ts:69]
- [x] [Review][Patch] Test link matchers build a RegExp from `ISSUER` and the id without escaping, so `.` matches any character and the origin assertion is looser than it reads [travelplan/test/mcpFileLinks.test.ts]
- [x] [Review][Defer] Unbounded concurrent sharp renders on `/f/` (a valid link holder can drive 300 full re-encodes per minute per IP; no render concurrency cap) [travelplan/src/app/f/[fileId]/route.ts:54] — deferred, DW-425
- [x] [Review][Defer] PDF `content-length` comes from an earlier `stat` and the stream reopens the path, so a file replaced in between gives a mismatched length [travelplan/src/app/f/[fileId]/route.ts:91] — deferred, DW-426
- [x] [Review][Defer] Nginx access logs store full signed URLs, `sig` included; the deploy docs do not mention stripping the query for `/f/` [deploy/README.md] — deferred, DW-427

## Dev Notes

### What exists, and what this story reuses

| Need | Existing | Use |
|---|---|---|
| File by id, per trip, writer-only | `findFileForPlanner` (`connectorReadRepo.ts:597`): four parallel `findFirst`, ids are cuids | Mirror it without the writer filter for the route (Task 3) |
| Containment on disk | `resolveTripFile` (`fileTools.ts:204`): rejects external, lexical outside and realpath outside the trip tree | Move it to `tripFilePath.ts` unchanged |
| Content type by bytes | `sniffPhotoContentType`, `sniffDocumentContentType` (`importPackage.ts`) | Route and `get_file` |
| Rate limit | `checkRateLimit(key, limit, windowMs)` (`security/rateLimit.ts:16`), in memory, one process | `file-link:${ip}` |
| Client IP | `getClientIp(request)` (`http/clientIp.ts`); `"unknown"` means skip | Route |
| Base URL | `parseBaseUrl(process.env.APP_BASE_URL)` (`oauth/config.ts`) | `signFileLink` |
| Startup gate | `assertMcpConfigured` (`oauth/config.ts:91`), called in `instrumentation.ts` | Same gate for the secret |
| File serving pattern | `src/app/uploads/[...path]/route.ts`: `runtime`, `dynamic`, closed type map, `nosniff`, streaming | Pattern only; do not change it |
| File shapes | `toFiles` (`plannerShapes.ts:88`), `fileNameOfUrl`; `PlannerMedia` (`connectorReadRepo.ts:49`) | Extend with optional links |

### What must not change

- `/uploads/[...path]` stays session-guarded, and nothing here makes a stored file public.
- `get_file` keeps the embedded resource up to 10 MB. The download link is added next to it, not instead of it.
- Files on disk are never modified. A resize happens per request and in memory.
- No URL or disk path of a stored file reaches the model, as 15.7 established (`fileTools.ts` header). A `downloadUrl` names only the file id, and it is the one deliberate public reference. Its path never contains the storage path.
- Logging per the Epic 15 rules: the route logs nothing on success; on a sharp failure it logs the file id only. Never log `sig`.

### Security decisions (recorded; the review will look here first)

- **The signature is the grant.** `/f/` has no session, no bearer token, no CSRF and no trip check. A link is minted only inside a tool call that has passed `requireWritableTrip`, so its holder has, for at most the TTL, exactly what the planner's own `get_file` would give them. A link leaked to a third party works until `exp`: that is the documented risk of short-lived links (Tommy: "only per file and time-limited").
- **Revocation** happens only by expiry, or by rotating `FILE_LINK_SECRET`, which invalidates every open link at once. Deleting the file makes its link answer 404.
- **Constant time.** Compute the expected signature, then check the lengths, then `timingSafeEqual`. Do not use `===` on the strings.
- **`w` is inside the signature**, so a client cannot ask for a larger render with the same link. An unsigned width would let anyone holding one link make the server re-encode at any size.
- **Metadata is always stripped from images**, even without `w`. Phone photos carry GPS, and a book client would publish them.
- **Decompression bombs**: keep sharp's default `limitInputPixels` (about 268 MP). Uploads are already capped at 5 MB.
- **Rate limit before verification**, so brute-forcing signatures costs as much as fetching.
- **No directory reach**: one dynamic segment, a charset check, and a DB lookup by id. The id never becomes part of a path.

### sharp 0.35.5 specifics (checked against `node_modules/sharp/lib/index.d.ts`)

- `autoOrient()` (line 421) replaces the old argument-less `rotate()`.
- `metadata().autoOrient: { width, height }` (line 1238) gives the oriented size.
- `withExif({ IFD0, IFD1, IFD2, IFD3 })` (line 711; IFD3 = GPS, line 1183) is **for tests only**, to build a photo that has GPS.
- `resize({ width, withoutEnlargement: true })` (line 1595).
- Output: `.jpeg({ quality: 85, mozjpeg: true })` and `.webp({ quality: 82 })`. By default sharp writes no metadata and converts to sRGB.
- `metadata().hasAlpha` decides PNG → WebP or PNG → JPEG.

### Testing

New test files, following `test/mcpFileTools.test.ts` (media root, `uploadFixtures`, `mcpClient`):

- `test/fileLinks.test.ts` (unit):
  - a sign → verify round trip;
  - a tampered `sig`, another `fileId` with the same `sig`, a changed `w` (1600 → 2400), a removed `w`, an expired `exp` and a non-numeric `exp` all fail;
  - an unsupported `w` (1000) fails;
  - a short or missing secret gives `signFileLink === null`;
  - the TTL is clamped and defaults to 900;
  - `assertFileLinksConfigured` throws only with `NODE_ENV=production` plus `MCP_ENABLED=true` and a bad secret.
- `test/fileLinkRoute.test.ts` (route, with real files under the test media root):
  - a valid image link answers 200, `image/jpeg`, width ≤ 1600 (source 3000×2000 → 1600×1067), `cache-control` `private, max-age` ≤ TTL, `nosniff`;
  - **GPS:** a source made with `withExif({ IFD3: { GPSLatitudeRef: "N", … } })` has `metadata().exif` in the test setup, and the response bytes have `metadata().exif === undefined`;
  - an Orientation-6 source comes back with its dimensions swapped;
  - a small source (600 px) with `w=1600` stays 600 px (never enlarged);
  - a PNG with alpha comes back as WebP;
  - a PDF document comes back byte-identical as `application/pdf`; a document link with `w` answers 403;
  - tampered `sig`, wrong `fileId`, changed `w` and expired `exp` all answer 403 with an empty body; an unknown file id with a valid signature answers 404; an external image URL answers 404;
  - the 301st request from one IP within a minute answers 429.
- `test/mcpFileLinks.test.ts` (through the MCP client, as `mcpReadTools.test.ts` does):
  - `get_day` returns `downloadUrl` (with `w=1600`), `width` and `height` for each image, and `downloadUrl` for each document;
  - fetching that URL through the route handler, with no cookie and no token, answers 200;
  - `get_bucket_list` and `get_file` carry the same fields;
  - an external image gives `null`s;
  - without a secret, all `downloadUrl`s are `null`;
  - the descriptions name the TTL.
- Update the existing exact-shape tests (`mcpPlannerShapes.test.ts`, `mcpReadTools.test.ts`, `mcpFileTools.test.ts`, the write-tool tests that compare day shapes) for the new fields. Do not loosen them to `toMatchObject` where they were exact.
- Set `FILE_LINK_SECRET` for the test run in the test setup (`vitest` setup file or per suite with `vi.stubEnv`), and cover one case without it.

### Production check (Tommy, manual, after deploy)

1. Set the secret in `TravelPlan.service` with `Environment="FILE_LINK_SECRET=…"`, then run `daemon-reload` and `restart`. Startup must succeed.
2. In Claude: `get_day` for a day with photos. Copy a `downloadUrl`.
3. Run `curl -sS -o /tmp/p.jpg -D - "<downloadUrl>"`. Expect 200 and `image/jpeg`, with no cookie or token sent. Then:
   - `sips -g pixelWidth /tmp/p.jpg` (macOS) shows at most 1600;
   - `exiftool /tmp/p.jpg` or `sips -g all` shows no GPS.
4. After 15 minutes, the same `curl` answers 403. Change one character of `sig`: 403.
5. If `/f/` answers an Nginx 404, Nginx does not pass `/f/` to the app; add it.

### Project Structure Notes

- New: `src/app/f/[fileId]/route.ts`, `src/lib/files/fileLinks.ts`, `src/lib/files/imageInfo.ts`, `src/lib/trips/tripFilePath.ts`, `src/lib/mcp/fileLinkShapes.ts`, three test files.
- `src/lib/files/` is new; the name follows `src/lib/<area>/` (as `security/`, `http/`, `oauth/`).
- No schema change, no migration, no UI, no i18n.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 15.8] and the Epic 15 shared rules.
- [Source: _bmad-output/planning-artifacts/architecture.md#MCP endpoint, #Connector auth]
- [Source: _bmad-output/implementation-artifacts/spec-15-7-documents-and-images.md#Design Notes, #Code Map]
- [Source: travelplan/src/lib/mcp/tools/fileTools.ts:204-265] `resolveTripFile`, `fileMetadata`, `getFile`
- [Source: travelplan/src/lib/repositories/connectorReadRepo.ts:49, 584-640] `PlannerMedia`, `PlannerFileRow`, `findFileForPlanner`
- [Source: travelplan/src/lib/mcp/plannerShapes.ts:77-207] `fileNameOfUrl`, `toFiles`, `toActivity`, `toStay`, `toPlannerDay`, `toBucketActivity`
- [Source: travelplan/src/app/uploads/[...path]/route.ts] serving pattern, headers
- [Source: travelplan/src/instrumentation.ts], [Source: travelplan/src/lib/oauth/config.ts:91] startup gate
- [Source: docs/deployment-configuration.md] production is a single linux arm64 host

### Previous story intelligence (15.7)

- Its review patched a stale-day race and an unbounded sweep. Keep request-path work bounded here too: batch the size reads (Task 4) and cache them.
- 15.7 established "nothing about storage reaches the model". `downloadUrl` is the one deliberate, signed exception. It carries the file id only.
- Image names come from the stored disk name (`fileNameOfUrl`). Do not change that.

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (claude-opus-5-5), bmad-dev-story, interactive.

### Debug Log References

- sharp rewrites an `Orientation` tag given through `withExif({ IFD0: { Orientation: "6" } })` to 1, so the orientation fixtures use `withMetadata({ orientation: 6 })` (test-only; production code never calls `withMetadata`). The GPS fixtures use `withExif({ IFD3: … })` as the story says.
- Next rejects non-standard exports from a route file at build time, so the route's rate-limit constant is module-private.
- `npm run build`: 11 Turbopack "dynamic filesystem access" warnings, all at untouched lines (`tripRepo.ts:2165/2252`, `importPhotos.ts`, `uploadPaths.ts:172/296/338`), each location once. No new warnings and no bundling error for `sharp`.

### Completion Notes List

- **Task 1:** `sharp ^0.35.5` is now a direct dependency (`npm install`), with the `overrides` entry at the same range. In the lockfile, `sharp`, `@img/colour` and `semver` lost `optional`, and `@img/sharp-linux-arm64` 0.35.5 and `@img/sharp-libvips-linux-arm64` 1.3.4 are still listed. The lockfile diff is 4 lines.
- **Task 2:** `src/lib/files/fileLinks.ts` has the signing, the checks, the TTL and the startup check, and is called from `instrumentation.ts` after `assertMcpConfigured`. `parseBaseUrl` is now exported from `oauth/config.ts`. The link base is `APP_BASE_URL`'s origin, as `getIssuer` uses. Two decisions:
  - `w` and `exp` must be written as canonical integers (no leading zeros), so each link has exactly one valid spelling.
  - The secret must match the base64url character set (padding allowed) before decoding, because `Buffer.from(…, "base64url")` silently skips invalid characters.
- **Task 3:** `resolveTripFilePath`/`readFileHead` moved unchanged to `src/lib/trips/tripFilePath.ts`. `findFileForSignedLink` (four `findUnique` by id, no user filter) is in `connectorReadRepo.ts`.
- **Task 4:** `src/lib/files/imageInfo.ts` has `readImageSize`, which uses `metadata().autoOrient` and falls back to width/height. `readImageSizes` caches results per `fileId:updatedAt` with FIFO eviction above 5,000 entries and reads 8 files at a time. A failed read is not cached, so a passing problem does not stick.
- **Task 5:** `src/app/f/[fileId]/route.ts` runs the checks in this order: rate limit 300/min per IP, then the id charset, `verifyFileLink`, the lookup, containment and the content sniff. Unknown IPs skip the rate limit.
  - Images are re-encoded with `autoOrient` and resized to the signed width. A WebP source or a PNG with alpha becomes WebP; everything else becomes JPEG. No metadata call is ever made, so the output carries no metadata.
  - PDFs are streamed with `content-length` taken from `stat`.
  - A document link with `w` answers 403. A sharp failure answers 404 and logs `{ fileId }` only.
  - `/f` is not in `proxy.ts`'s matcher, which is unchanged.
- **Task 6:** `plannerShapes.ts` stays pure, with an optional `FileLinks` map threaded through `toFiles`, `toActivity`, `toStay`, `toPlannerDay` and `toBucketActivity`. A missing entry gives `null`s.
  - `src/lib/mcp/fileLinkShapes.ts` has `buildFileLinks`, `toLinkedPlannerDay`, `toLinkedBucketActivities` and `fileLinkNote()`. `fileLinkNote()` is a function, not a constant, because the TTL is read from the environment per registration.
  - `get_day`, `get_bucket_list`, `activityWrite.readDay` (which every write tool returning "the day as get_day shows it" goes through) and the bucket re-read all use the linked shapes.
  - Without a secret no image is read from disk.
  - `get_file` metadata gains `downloadUrl`, and images also get `width`/`height`. An image-typed document is signed without `w`. The over-10 MB note now points to `downloadUrl`.
- **Task 7:** Updated `deploy/travelplan.env.example` (empty secret, generation command, TTL 900), the `docs/deployment-configuration.md` environment table (two rows), the Connector section of `deploy/README.md` (secret, Nginx must pass `/f/`, `curl -I` check), `deferred-work.md` (DW-424: caption and isCover) and `architecture.md` (one sentence in the MCP endpoint paragraph).
- **Task 8:** Four new test files with 37 tests:
  - `fileLinks.test.ts`: 11
  - `fileLinkRoute.test.ts`: 12, real sharp images covering GPS, orientation, no enlargement, alpha→WebP, PDF identity, the 403/404 matrix and the 301st request → 429
  - `mcpFileLinks.test.ts`: 10, through `/api/mcp`, fetching links with no cookie or token
  - `imageInfo.test.ts`: 4

  The exact-shape tests in `mcpReadTools`, `mcpFileTools` and `mcpPlannerShapes` gained the new `null` fields and are still `toEqual`. The existing suites run without a secret; the new suites stub it per suite, and each new suite has a case without it.
- **Gates:** `typecheck` clean; `lint` 0 errors, 80 warnings (unchanged baseline); `check:migrations` passed; `build` passed; `npm test` 257 files, 4081 tests passed (the two test files type-fixed after that run were re-run: 14/14).
- **Production check** (manual, Tommy): follow *Production check* above. Set `FILE_LINK_SECRET` in the unit before starting this build, because with `MCP_ENABLED=true` startup refuses without it. Nginx must pass `/f/`.

### File List

- travelplan/package.json (modified)
- travelplan/package-lock.json (modified)
- travelplan/src/app/f/[fileId]/route.ts (new)
- travelplan/src/instrumentation.ts (modified)
- travelplan/src/lib/files/fileLinks.ts (new)
- travelplan/src/lib/files/imageInfo.ts (new)
- travelplan/src/lib/mcp/fileLinkShapes.ts (new)
- travelplan/src/lib/mcp/plannerShapes.ts (modified)
- travelplan/src/lib/mcp/tools/activityWrite.ts (modified)
- travelplan/src/lib/mcp/tools/fileTools.ts (modified)
- travelplan/src/lib/mcp/tools/tripRead.ts (modified)
- travelplan/src/lib/oauth/config.ts (modified)
- travelplan/src/lib/repositories/connectorReadRepo.ts (modified)
- travelplan/src/lib/trips/tripFilePath.ts (new)
- travelplan/test/fileLinks.test.ts (new)
- travelplan/test/fileLinkRoute.test.ts (new)
- travelplan/test/imageInfo.test.ts (new)
- travelplan/test/mcpFileLinks.test.ts (new)
- travelplan/test/mcpFileTools.test.ts (modified)
- travelplan/test/mcpPlannerShapes.test.ts (modified)
- travelplan/test/mcpReadTools.test.ts (modified)
- deploy/travelplan.env.example (modified)
- deploy/README.md (modified)
- docs/deployment-configuration.md (modified)
- _bmad-output/implementation-artifacts/deferred-work.md (modified)
- _bmad-output/planning-artifacts/architecture.md (modified)
- _bmad-output/implementation-artifacts/sprint-status.yaml (modified)
- _bmad-output/implementation-artifacts/15-8-signed-download-links.md (this file)

### Change Log

- 2026-10-31: Story created (bmad-create-story) from Tommy's request "signierte Download-Links für Bilder" and the scope agreed in conversation.
- 2026-10-31: Implemented (bmad-dev-story): sharp as a dependency, HMAC-signed `/f/{fileId}` links, metadata-free image re-encoding, `downloadUrl`/`width`/`height` in `get_day`, `get_bucket_list`, `get_file` and every write tool's day, startup check, docs, DW-424. Status → review.
