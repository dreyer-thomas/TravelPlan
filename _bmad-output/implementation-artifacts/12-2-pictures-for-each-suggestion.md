---
baseline_commit: 3140a60
---

# Story 12.2: Pictures for Each Suggestion

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As someone choosing between suggestions,
I want two or three small pictures of each place,
so that I can judge it at a glance.

**FRs covered:** FR44 (images). **Depends on:** 12.1 (done, `f917a7a`). Story 12.3 shows these images as thumbnails on the cards, and Story 12.4 downloads them into media storage on *Übernehmen*. The `images` field added here is part of the response contract both of them read.
Sources: [epics.md#Story 12.2](../planning-artifacts/epics.md); [sprint-change-proposal-2026-10-16.md](../planning-artifacts/sprint-change-proposal-2026-10-16.md) (D4: Wikimedia, never AI URLs, no attribution); [12-1-ask-claude-what-the-day-could-hold.md](12-1-ask-claude-what-the-day-could-hold.md) (*Response contract*, *Verification, precisely*); [architecture.md](../planning-artifacts/architecture.md) *Integration Points → External Integrations* (Wikimedia entry).

All code paths below are relative to `travelplan/`. Line numbers were read at `3140a60`. The working tree differs from that commit only in `.env` and a database backup.

## Read this first: what the epic's wording assumes that the code or Wikimedia does not

Each item was checked, and each one changes what a task asks for.

1. **"At most 320 px wide" has to be 250 px.** Since January 2026 Wikimedia serves only standard thumbnail widths: 20, 40, 60, 120, **250**, **330**, 500, 960, 1280, 1920, 3840. The imageinfo API rounds a non-standard width *up* to the next step, so asking for 320 gets 330, which breaks the AC. Hotlinked thumbnail URLs with non-standard widths are rejected outright, and 12.3 hotlinks these thumbnails. Request **`iiurlwidth=250`** and **`pithumbsize=250`**, both as one constant `THUMBNAIL_WIDTH = 250` with a docblock explaining why. A source image narrower than 250 px comes back with its original as the thumbnail. That is fine, because it is still ≤ 320.
2. **The `User-Agent` must carry contact information.** The Wikimedia API access policy asks for `<client>/<version> (<contact>)`. A string without a contact, like the existing `TravelPlan/0.1 routing`, risks being blocked without notice. Use `TravelPlan/0.1 (suggestion images; <contact>)`. The contact is `process.env.APP_BASE_URL` when it is set and not a `localhost` URL. Otherwise it is the literal `self-hosted; no public URL`. The env var is already read by `api/auth/password-reset/request/route.ts:53`, so this adds no new variable. Build the string in a function that reads `process.env` on each call (the `lib/ai/config.ts` pattern), not at module load. See *Questions* 1.
3. **Wikipedia page images give one picture per article, not "2–3".** `prop=pageimages` returns the article's single lead image. The other images come from Commons geosearch. The order is therefore: the article's lead image first, then Commons files near the coordinates, deduplicated by file name (the lead image is often also a geosearch hit) and capped at 3. `prop=images` (every file on the page) is **not** used: it returns flags, icons, maps and SVG logos.
4. **The model's `wikiTitle` is in an unknown language, and in the one real call it was never sent.** `prompt.ts:39` asks for "the exact title of the place's Wikipedia article" without saying which Wikipedia. The 12.1 manual call returned **no `wikiTitle` on any of 5 entries**. So: (a) change that prompt line to ask for the **English** Wikipedia title, and (b) query `en.wikipedia.org`. Then `title` is the fallback, and Commons geosearch carries most of the load. `test/daySuggestionPrompt.test.ts:72` only checks that the field is named, so it stays green. Check that no other assertion pins the old wording.
5. **The lookups must run *after* verification, on the verified coordinates.** The route does `requestDaySuggestions` and then `verifySuggestionLocations`. Commons geosearch within 1 km is only as good as the point it is given, and verification moves the point to the geocoder's when it finds a match. So the order is model → verify → images. The time cost: the model call is ≤ 60 s, verification ≤ 10 s and images ≤ 8 s, so ≤ 78 s in total. That is still under the ≥ 90 s reverse-proxy read timeout 12.1 documented in `docs/deployment-configuration.md`. Update that paragraph's arithmetic so it names the image step.
6. **The existing route test would start calling the real internet.** `test/daySuggestionsRoute.test.ts` stubs `fetch` only in the cases that run real verification. In every other case `fetch` is real. Its happy-path test also asserts `fetchMock` was called exactly **3** times (`:178`), and Wikimedia calls would break that. Mock the new image module at its boundary in that suite, the same way `verifySuggestions` is mocked there (`:16-29`). Default the mock to "no images" and add one case that checks the route attaches what the lookup returned.
7. **`originalUrl` comes back to the server in 12.4, so 12.4 needs it to be checkable.** 12.4 receives the ticked suggestions in its request body and downloads `originalUrl` server-side. An unchecked URL there would be an SSRF hole. Put a shared, pure `isWikimediaUploadUrl(url)` in `src/lib/validation/daySuggestionSchemas.ts` (https, host exactly `upload.wikimedia.org`, no credentials, no port). Use it here to **drop** any URL Wikimedia returns that fails it, and 12.4 reuses it on input. *(Amended in code review, 2026-10-16: it guards `originalUrl` only. `thumbnailUrl` is guarded by the sibling `isWikimediaThumbnailUrl`, because thumbnails are served from `thumb.wikimedia.org`. See Deviation 1.)* Also note for 12.4 that Commons originals are often 10–50 MB, while the day-plan-item image route caps uploads at 5 MB (`day-plan-items/images/route.ts:27`). See *Questions* 3.
8. **Commons namespace 6 holds more than photos.** Geosearch on `ggsnamespace=6` also returns PDFs, SVG maps, OGG audio, WebM video and TIFF scans. Keep only `mime` in `image/jpeg`, `image/png` and `image/webp`, which are the formats the media pipeline and every browser handle. Apply the same filter to the page image. Ask the API for `iiprop=url|mime` so the filter can work.

## Acceptance Criteria

1. **Lookup.** For each suggestion returned by the 12.1 pipeline (after verification), the server looks for up to **3** images:
   - (a) the English Wikipedia lead image (`prop=pageimages`) for `wikiTitle`, or for `title` if there is no `wikiTitle`;
   - (b) if (a) used `wikiTitle` and found nothing, the same lookup for `title` when it differs;
   - (c) Commons files within **1000 m** of the suggestion's (possibly verified) `lat`/`lng`, nearest first.

   The results are merged in the order (a/b) then (c), deduplicated by file name, filtered to JPEG, PNG and WebP, and cut to 3. The page-image and geosearch requests for a suggestion may run concurrently. Only the merge order is fixed.
2. **Shape.** Each suggestion in the `200` response gains `images: Array<{ thumbnailUrl: string; originalUrl: string }>`, which is always present and may be `[]`. `thumbnailUrl` is Wikimedia's thumbnail at width **250** (item 1), or the original when the source is known to be no wider than 250 px. `originalUrl` passes `isWikimediaUploadUrl` and `thumbnailUrl` passes `isWikimediaThumbnailUrl` (thumbnails are served from `thumb.wikimedia.org`; amended in code review, 2026-10-16), and any URL that fails its check is dropped. No author, licence, description, file page or dimensions are kept or returned.
3. **Never AI URLs.** Image URLs come only from Wikimedia API responses. The model schema keeps having no URL field (`daySuggestionSchemas.ts`, `modelSuggestionsSchema`), and a test asserts that `modelSuggestionsSchema`'s shape has no key containing `url` or `image`.
4. **Failure is quiet.** If Wikimedia answers non-OK, times out, returns malformed JSON or no usable file, that suggestion's `images` is `[]`. A failure in one source does not discard the other source's images. The search as a whole still answers `200`, and no image failure maps to `ai_failed` or `500`.
5. **Parallel, with a budget.** All lookups for all suggestions run in parallel, with one total budget of **8 s** (one `AbortController`, one timer, cleared in `finally`). When the budget runs out, the requests still open are aborted, and each suggestion keeps whatever its finished requests produced. `request.signal` is forwarded as well, so a client that disconnects aborts the lookups too.
6. **Etiquette.** Every Wikimedia request sends the `User-Agent` from item 2, `cache: "no-store"`, `format=json` and `formatversion=2`, and goes only to `https://en.wikipedia.org/w/api.php` or `https://commons.wikimedia.org/w/api.php`. No API key or cookie is sent.
7. **Tests (Wikimedia mocked through an injected `fetchImpl`).** Tests cover:
   - the lookup order: the page image comes before geosearch hits, `wikiTitle` is tried before `title`, and `title` is tried after an empty `wikiTitle` lookup;
   - the 3-image cap, with 5 available;
   - deduplication of the lead image when it is also a geosearch hit;
   - the MIME filter;
   - the missing-image case (`images: []`);
   - each source failing on its own (non-OK, throw, bad JSON);
   - the 8 s timeout on fake timers, with partial results kept;
   - an off-host URL dropped;
   - the exact query parameters (`pithumbsize=250`, `iiurlwidth=250`, `ggsradius=1000`, `ggscoord=lat|lng`, `ggsnamespace=6`);
   - the `User-Agent` with and without `APP_BASE_URL`.

   The route suite proves the route attaches the lookup's result and still answers `200` when the lookup rejects.
8. **Gates.** The full suite, `tsc --noEmit`, lint (0 errors, warning baseline 80) and `npm run check:migrations` are green. `npm run audit:check` stays waived as in 12.1 (DW-384), and this story adds **no dependency**. The docs record the new outbound host.

## Tasks / Subtasks

- [x] **Task 1: Contract (AC: 2, 3)**: `src/lib/validation/daySuggestionSchemas.ts`
  - [x] 1.1 Add `export type SuggestionImage = { thumbnailUrl: string; originalUrl: string }` and change `DaySuggestion` to `ModelDaySuggestion & { verified: boolean; images: SuggestionImage[] }`. Update the docblock above `DaySuggestion` (it says "consumed by Stories 12.2–12.4") to describe `images`.
  - [x] 1.2 Add `export const isWikimediaUploadUrl = (value: string): boolean`. Parse it with `new URL` inside a try. It is true only for `protocol === "https:"`, `hostname === "upload.wikimedia.org"`, an empty `port`, and an empty `username` and `password`. Pure, with no `server-only`, because 12.4 runs it on request input and 12.3 may import the module.
  - [x] 1.3 `verifySuggestions.ts` returns `DaySuggestion[]`, which will now require `images`. Give verification its own output type, `VerifiedDaySuggestion = ModelDaySuggestion & { verified: boolean }` (exported from the schemas file), and have the image step turn `VerifiedDaySuggestion[]` into `DaySuggestion[]`. **Do not** add `images: []` inside verification: that would put two steps' fields into one function and hide a missing image step behind a type that still compiles.
  - [x] 1.4 Tests in `test/daySuggestionSchemas.test.ts`: `isWikimediaUploadUrl` accepts a real `https://upload.wikimedia.org/wikipedia/commons/thumb/…/250px-X.jpg`, and rejects `http:`, `upload.wikimedia.org.evil.com`, `user:pw@upload.wikimedia.org`, `:8443`, `commons.wikimedia.org` and a non-URL. Add the "no URL field in the model schema" assertion (AC 3) over `Object.keys(modelSuggestionsSchema.shape.suggestions.element.shape)`.
- [x] **Task 2: Prompt (item 4)**: `src/lib/ai/prompt.ts:39`. Change the `wikiTitle` line so it asks for the exact title of the place's **English** Wikipedia article, omitted if there is none. Run `test/daySuggestionPrompt.test.ts` and keep it unedited if it stays green.
- [x] **Task 3: Wikimedia client (AC: 1, 2, 4, 6)**: new `src/lib/ai/suggestionImages.ts`, beginning with `import "server-only"`. Its only caller is the AI route, and the `server-only` guard follows 12.1's rule for that folder.
  - [x] 3.1 Constants with "why" docblocks: `THUMBNAIL_WIDTH = 250` (item 1), `MAX_IMAGES_PER_SUGGESTION = 3`, `GEOSEARCH_RADIUS_METERS = 1000`, `GEOSEARCH_LIMIT = 10` (enough candidates to survive the MIME filter and the dedupe), `IMAGE_LOOKUP_BUDGET_MS = 8000`, `ALLOWED_IMAGE_MIME = ["image/jpeg","image/png","image/webp"]`, `WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php"` and `COMMONS_API = "https://commons.wikimedia.org/w/api.php"`.
  - [x] 3.2 `getWikimediaUserAgent()` (item 2), read on each call.
  - [x] 3.3 `fetchPageImage({ title, fetchImpl, signal, userAgent })` returns `Candidate | null`, where `Candidate = { fileName, thumbnailUrl, originalUrl, mime }`. Send one request: `action=query&format=json&formatversion=2&redirects=1&prop=pageimages|pageprops&piprop=thumbnail|original|name&pithumbsize=250&titles=<title>`.
    - **MIME:** pageimages does not return a MIME type, so infer it from the `original.source` extension (`.jpg`, `.jpeg`, `.png`, `.webp`, case-insensitive) and drop anything else. Write a comment explaining why.
    - **Disambiguation pages:** drop them (`pageprops.disambiguation` present).
    - **Missing pages:** drop them (`missing: true`).
    - **File name:** `pageimage` is the bare name, `Foo.jpg`. Normalise it to the dedupe key `File:Foo.jpg` with spaces as underscores.
  - [x] 3.4 `fetchNearbyCommonsImages({ lat, lng, fetchImpl, signal, userAgent })` returns `Candidate[]` (nearest first). Send one request: `action=query&format=json&formatversion=2&generator=geosearch&ggscoord=<lat>|<lng>&ggsradius=1000&ggsnamespace=6&ggslimit=10&prop=imageinfo&iiprop=url|mime&iiurlwidth=250`.
    - **Order:** `formatversion=2` returns `query.pages` as an array that is **not** in distance order. Sort by the generator's `index` field (ascending), and write a comment explaining why.
    - **Thumbnail:** `thumbnailUrl = imageinfo[0].thumburl ?? imageinfo[0].url`. `originalUrl = imageinfo[0].url`.
    - **Dedupe key:** `title` (`File:…`), normalised in the same way as 3.3.
  - [x] 3.5 Both functions treat a non-OK status, a thrown fetch, a JSON parse failure and an unexpected shape (no `query`, `pages` not an array, a row that is not an object) as "nothing". They `return null` or `[]` and never throw. Guard every row the way `nominatim.ts` does (a `null` or a string among the rows must not throw). Drop any candidate whose URLs fail `isWikimediaUploadUrl`.
  - [x] 3.6 `findSuggestionImages(suggestion, deps)` runs the page-image chain (wikiTitle, then title, as in AC 1 a/b) and the geosearch **concurrently** (`Promise.all` of the two chains). It merges them as page image first, then geosearch, dedupes, cuts to 3 and maps to `{ thumbnailUrl, originalUrl }`. Trim `wikiTitle` and `title` before use. Compare them case-sensitively but ignore spacing: Wikipedia titles are case-sensitive after the first letter, so "same title" means byte-equal after trimming and collapsing spaces.
  - [x] 3.7 `attachSuggestionImages(suggestions, { fetchImpl = fetch, signal, budgetMs = IMAGE_LOOKUP_BUDGET_MS, setTimer?/clearTimer? })` returns `Promise<DaySuggestion[]>`.
    - **Signals:** create one `AbortController` for the budget and combine it with the caller's `signal`. Use `AbortSignal.any([budget.signal, signal])` when `signal` is given. Node 20+ has it; check `engines`/`.nvmrc` and fall back to a manual listener if the runtime is older. If `signal` is already aborted, every suggestion gets `images: []` and no request is sent.
    - **Concurrency:** run `findSuggestionImages` for all suggestions with `Promise.all`. Each one is already non-throwing, so one slow suggestion cannot fail the rest.
    - **Partial results:** a request aborted by the budget returns nothing from its own source only. This is what keeps partial results.
    - **Wrapper:** wrap the whole step in a final `try/catch` that returns every suggestion with `images: []`. This is a belt-and-braces guard so AC 4 holds even for a bug. Write a comment saying so.
    - **Order:** keep the input order and every other field unchanged.
  - [x] 3.8 Docblock at the top of the file in the 12.1 style: Story 12.2, D4 (Wikimedia only, never AI URLs, no attribution because the app is private, Tommy 2026-10-16), why the lookups run after verification (item 5), why 250 (item 1), why parallel is acceptable here when Nominatim had to be sequential (Wikimedia's API has no 1 req/s rule for this volume, about 16–24 requests per search, and each request names itself through the `User-Agent`), and the budget.
- [x] **Task 4: Route (AC: 4, 5)**: `src/app/api/trips/[id]/days/[dayId]/suggestions/route.ts:107`
  - [x] 4.1 Replace `return ok({ suggestions: await verifySuggestionLocations(...) })` with: verify, then `attachSuggestionImages(verified, { signal: request.signal })`, then `ok({ suggestions })`. Keep it inside the existing `try`. The image step never throws, but if it ever did, the existing catch would turn a paid answer into a `500`. So also wrap the image call in its own try that falls back to `images: []`, or rely on 3.7's wrapper and say so in a comment. Pick one and do not do both.
  - [x] 4.2 Extend the route docblock's timing paragraph (": verification … can take up to ten seconds on top of it") with the 8 s image step and the ≤ 78 s total.
- [x] **Task 5: Tests (AC: 7)**
  - [x] 5.1 New `test/suggestionImages.test.ts`. Use an injected `fetchImpl` that routes on `URL.hostname` and `searchParams.get("generator")` / `get("prop")`, and build its responses with `mockFetchResponse` from `test/helpers/mockFetch.ts`. Cover every bullet of AC 7. For the timeout, the fake waits on `init.signal` and rejects on abort. Use `vi.useFakeTimers()` and advance by 8000 ms. Assert the geosearch images that arrived before the deadline are kept while the hung page-image request contributes nothing. Use realistic fixture rows (`formatversion=2` shape: `query.pages[]` with `title`, `index`, `imageinfo[{url, thumburl, mime}]`, and for pageimages `thumbnail.source`, `original.source`, `pageimage`).
  - [x] 5.2 `test/daySuggestionsRoute.test.ts`: add `vi.mock("@/lib/ai/suggestionImages", …importActual)` beside the verification mock (`:16-29`). In `beforeEach`, default it to `suggestions.map(s => ({ ...s, images: [] }))`. Add two cases: the lookup's images appear on the response, and the lookup rejecting still answers `200` (only if you chose the route-level try in 4.1; otherwise test the wrapper in 5.1). **The `toHaveBeenCalledTimes(3)` assertion at `:178` must stay unedited and green.** That proves no Wikimedia call leaks into that test.
  - [x] 5.3 `test/verifySuggestions.test.ts` should only need type adjustments, if any. It must not gain `images`.
  - [x] 5.4 Mutation discipline (6.31): change 250 → 320, 3 → 4, 1000 → 2000, the budget 8000 → 9000, and swap the merge order, and watch a test go red each time. Record them in the Debug Log.
- [x] **Task 6: Docs (AC: 8)**
  - [x] 6.1 `docs/deployment-configuration.md`: in the outbound-hosts / external services part (find where OSRM, Nominatim and api.anthropic.com are listed; 12.1 added the Anthropic entry), add `en.wikipedia.org`, `commons.wikimedia.org` (API) and `upload.wikimedia.org` (fetched by the **browser** for thumbnails from 12.3, and by the server from 12.4). Note that `APP_BASE_URL` now also serves as the Wikimedia contact. Update the ≥ 90 s proxy-timeout arithmetic (item 5).
  - [x] 6.2 `docs/deployment-guide.md`: only if it describes `APP_BASE_URL`, add the extra use in one clause.
- [x] **Task 7: Gates**: `npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run check:migrations`. If Tommy's key is available again, make one manual call against the Neuseeland trip and record how many suggestions got images, how many came from the page image and how many from geosearch, and the added time.

### Review Findings

Code review 2026-10-16 (Blind Hunter, Edge Case Hunter, Acceptance Auditor). 2 decision-needed (resolved: one became a patch, one accepted as specified), 8 patch, 4 deferred (DW-385 to DW-388), 9 dismissed.

- [x] [Review][Patch] Add a route-level try around the image step and a route test proving `200` when the lookup rejects (AC 7; Tommy chose this over amending the AC, 2026-10-16) [travelplan/src/app/api/trips/[id]/days/[dayId]/suggestions/route.ts:111]
- [x] [Review][Decision] The lead image found by the `title` fallback is not checked against the suggestion's location — Resolved: accepted as AC 1(a)/(b) specify (Tommy, 2026-10-16); no coordinate check.
- [x] [Review][Patch] A `|` in `wikiTitle` or `title` turns one lookup into several, and the first page wins [travelplan/src/lib/ai/suggestionImages.ts:144] — MediaWiki splits `titles` on the pipe. Checked live: `titles=Foo|Eiffel_Tower` returns two pages in page-id order. `|` is not a legal title character, so skip the lookup for such a title.
- [x] [Review][Patch] The original stands in as the thumbnail without checking its width [travelplan/src/lib/ai/suggestionImages.ts:165] — The fallback assumes a missing `thumbnail`/`thumburl` means the source is narrower than 250 px, but that is never checked. If thumbnail generation fails, a 10–50 MB original reaches the card. Read `original.width` (pageimages) and add `size` to `iiprop` (geosearch, line 205). Drop the candidate when there is no thumbnail and the width is over `THUMBNAIL_WIDTH` or unknown.
- [x] [Review][Patch] The image step logs nothing, so a systematic Wikimedia block (403/429 over the User-Agent) would silently empty every card [travelplan/src/lib/ai/suggestionImages.ts:112] — Count failures in `getJson` (status, or error class name only) and write one `console.warn` per search when any request failed, matching the class-names-only rule of the route's `console.error`.
- [x] [Review][Patch] The SSRF/purity docblock sits on the private `isHttpsUrlOnHost` instead of the exported `isWikimediaUploadUrl` [travelplan/src/lib/validation/daySuggestionSchemas.ts:157] — Editor hovers for the guard 12.4 imports show nothing.
- [x] [Review][Patch] AC 2 and "Read this first" item 7 still say both URLs pass `isWikimediaUploadUrl` [_bmad-output/implementation-artifacts/12-2-pictures-for-each-suggestion.md:43] — Amend them to name `isWikimediaThumbnailUrl` for `thumbnailUrl` (Deviation 1), so 12.3 and 12.4 read the right contract.
- [x] [Review][Patch] `MAX_IMAGES_PER_SUGGESTION`, `WIKIPEDIA_API` and `COMMONS_API` lack the "why" docblocks Task 3.1 asks for [travelplan/src/lib/ai/suggestionImages.ts:43]
- [x] [Review][Patch] Schema test hygiene [travelplan/test/daySuggestionSchemas.test.ts:160] — The `isWikimediaUploadUrl` case "accepts a real Wikimedia thumbnail and original" uses the pre-2026 `upload…/thumb/…/250px-` form, which the code says no longer occurs. Rename it or use a real original. The `isWikimediaThumbnailUrl` rejection list lacks the user-only credential form and the empty string that the upload list tests.
- [x] [Review][Defer] The User-Agent contact can leak an internal address or carry no contact [travelplan/src/lib/ai/suggestionImages.ts:55] — deferred as DW-385.
- [x] [Review][Defer] 12.4's download must not follow redirects off `upload.wikimedia.org` [travelplan/src/lib/validation/daySuggestionSchemas.ts:179] — deferred as DW-386, for Story 12.4.
- [x] [Review][Defer] Browser hotlinking of `thumb.wikimedia.org` exposes members' IPs and Referer, and needs a CSP `img-src` entry [docs/deployment-configuration.md:46] — deferred as DW-387, for Story 12.3.
- [x] [Review][Defer] The Task 7 end-to-end call with a real key was not made, so the 78 s total is unmeasured [_bmad-output/implementation-artifacts/12-2-pictures-for-each-suggestion.md:102] — deferred as DW-388.

## Dev Notes

### Wikimedia requests, precisely

Page image (English Wikipedia):
```
GET https://en.wikipedia.org/w/api.php
  ?action=query&format=json&formatversion=2&redirects=1
  &prop=pageimages|pageprops&piprop=thumbnail|original|name&pithumbsize=250
  &titles=Neues%20Museum
→ { query: { pages: [ { title, missing?, pageprops?: { disambiguation? },
     pageimage?: "Neues_Museum_Berlin.jpg",
     thumbnail?: { source, width, height }, original?: { source, width, height } } ] } }
```
`pilicense` is left at its default (`free`), so non-free lead images are not offered. No licence data is stored either way (D4).

Commons geosearch:
```
GET https://commons.wikimedia.org/w/api.php
  ?action=query&format=json&formatversion=2
  &generator=geosearch&ggscoord=52.52|13.398&ggsradius=1000&ggsnamespace=6&ggslimit=10
  &prop=imageinfo&iiprop=url|mime&iiurlwidth=250
→ { query: { pages: [ { title: "File:…", index, imageinfo: [ { url, thumburl, mime } ] } ] } }
```
- Use `URLSearchParams` and let it encode the `|`. Do not hand-concatenate.
- Coordinates go in as plain numbers. Do not round them to fewer than 5 decimals, because 1 km is about 0.009°.
- No results gives a body **without** `query`, which is valid: treat it as `[]`.

### What must not regress

- `verifySuggestions.ts` behaviour and its tests: no new fields, only the return type name changes (Task 1.3).
- `test/daySuggestionsRoute.test.ts:178` (`fetch` called 3 times) is unedited and green.
- `test/daySuggestionPrompt.test.ts` and `test/nominatim.test.ts` are unedited and green.
- `modelSuggestionsSchema` gets no new field. The response schema's per-entry leniency and duplicate dropping (12.1 D3) stay unchanged.
- The error-code table from 12.1 stays unchanged. Images add no code.
- No database write, no migration, no new dependency, no new env variable.

### Architecture compliance

- Outbound-call conventions used across the code (`dayRouteService.ts:114-141`, `exchangeRateService.ts:160-178`, `nominatim.ts`): an injectable `fetchImpl`, an `AbortController` timeout cleared in `finally`, `cache: "no-store"` and a named `User-Agent`.
- `lib/ai/*` begins with `import "server-only"`. `vitest.config.ts` already aliases it (12.1).
- The client never talks to the Wikimedia API. It only renders the returned thumbnail URLs (12.3). No CSP or `next/image` `remotePatterns` exist in `next.config.ts` today, so plain `<img src>` works. If 12.3 uses `next/image`, it must add `upload.wikimedia.org`. Leave that to 12.3.

### Testing standards

Vitest 3.2, `test/`, camelCase `*.test.ts`. Inject dependencies in unit tests (no `vi.stubGlobal("fetch")` in the new suite). At the route boundary, use `vi.mock` + `importActual`, as 12.1 did. Real SQLite per worker for the route suite. Do not mock Prisma or auth. Write each test red first.

### Previous story intelligence (12.1)

- `messages.parse` was replaced with `messages.create` plus our own extraction. That does not matter here, but it is a reminder to check what an SDK or API actually returns before trusting the docs. The same applies to Wikimedia's `formatversion=2` page order (item 3.4).
- The real call returned **no `wikiTitle`** and verified **1 of 5** places. So: the title fallback matters, geosearch will often run on the model's unverified point, and AI coordinates were sometimes far off. That is why *Questions* 2 exists.
- The review caught a process-wide throttle problem and a budget that made the last item unreachable. For this story, check that the 8 s budget really does let every suggestion run (it does: the lookups run in parallel, not one after another) and that an already-aborted `signal` sends nothing.
- Gate baseline after 12.1: **184 files / 2996 tests**, tsc 0, lint 0 errors / 80 warnings.

### Git intelligence

`f917a7a` (12.1) added every file this story touches. `3140a60` (import ceiling) does not overlap. Follow the docblock density and naming of `verifySuggestions.ts` and `nominatim.ts`.

### Latest technical information (2026-10-16)

- Wikimedia standard thumbnail steps (since January 2026): 20, 40, 60, 120, 250, 330, 500, 960, 1280, 1920, 3840 px. Non-standard widths are rounded up through the API, and hotlinked ones are rejected. See [Common thumbnail sizes](https://www.mediawiki.org/wiki/Common_thumbnail_sizes).
- User-Agent: `<client>/<version> (<contact>) <library>/<version>`. A missing or generic UA may be blocked without notice. See [Wikimedia APIs/Access policy](https://www.mediawiki.org/wiki/Wikimedia_APIs/Access_policy).
- No dependency is needed. Global `fetch` and `AbortSignal.any` are in Node 20.3+.

### Project Structure Notes

New: `src/lib/ai/suggestionImages.ts`, `test/suggestionImages.test.ts`.
Updated: `src/lib/validation/daySuggestionSchemas.ts`, `src/lib/ai/verifySuggestions.ts` (return type only), `src/lib/ai/prompt.ts` (one line), `src/app/api/trips/[id]/days/[dayId]/suggestions/route.ts`, `test/daySuggestionSchemas.test.ts`, `test/daySuggestionsRoute.test.ts`, `docs/deployment-configuration.md` (and `docs/deployment-guide.md` if needed).

### Questions for Tommy (not blocking; the defaults above apply)

1. **Wikimedia contact (item 2).** The default is `APP_BASE_URL` when it is a real URL, otherwise "self-hosted; no public URL". Wikimedia prefers a reachable contact, such as an email address or a user page. If you want an email address in the UA, name one (a project address, not necessarily your work address) and it becomes a constant.
2. **Images for unverified places.** The default is to run Commons geosearch for every suggestion, using the model's point when verification failed. In the real call 4 of 5 were unverified, and skipping them would leave most cards bare. The cost is that a misplaced point can show photos of whatever is nearby. The *Ort nicht bestätigt* marker (12.3) already warns. The alternative is page image only for unverified places.
3. **For 12.4, not here:** Commons originals are often far above the 5 MB day-plan-item image limit. Recommendation for 12.4: download the 1280 px standard thumbnail (same host, derivable from the thumbnail URL) instead of the original, and keep `originalUrl` for reference. Decide this when 12.4 is created.

### References

- [epics.md — Story 12.2](../planning-artifacts/epics.md) · [sprint-change-proposal-2026-10-16.md](../planning-artifacts/sprint-change-proposal-2026-10-16.md) D4, D5
- [12-1 story](12-1-ask-claude-what-the-day-could-hold.md): *Response contract*, *Verification, precisely*, Completion Notes (manual call)
- `src/app/api/trips/[id]/days/[dayId]/suggestions/route.ts:100-121`
- `src/lib/validation/daySuggestionSchemas.ts` (model schema, `DaySuggestion`)
- `src/lib/ai/verifySuggestions.ts`, `src/lib/ai/prompt.ts:39`, `src/lib/ai/config.ts`
- `src/lib/geocoding/nominatim.ts` (row guards, timeout pattern)
- `src/app/api/trips/[id]/day-plan-items/images/route.ts:27` (5 MB, for 12.4)
- `test/daySuggestionsRoute.test.ts:8-29, 125-178`, `test/helpers/mockFetch.ts`

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (claude-opus-5-5), via bmad-dev-story, 2026-10-16.

### Debug Log References

- **Live API probe before writing the client (2026-10-16).** One geosearch and one pageimages request against the real APIs, to check the story's assumptions about the responses. Three findings:
  1. Both APIs now hand **thumbnails out on `thumb.wikimedia.org`**, not `upload.wikimedia.org`. Originals stay on `upload.wikimedia.org`. Task 1.2's guard, written for the upload host only, would have dropped every thumbnail. See Completion Notes, *Deviation 1*.
  2. Every URL carries a `?utm_source=…&utm_campaign=…&utm_content=…` query. URLs are kept exactly as Wikimedia returns them. The MIME check reads the extension from the URL's `pathname`, so the query does not affect it.
  3. Geosearch `index` starts at **−1**, and the pages are not in distance order. That confirms the sort in 3.4. The pageimages answer for "Neues Museum" had `pageimage: "Berlin_Neues_Museum_001.JPG"` (an upper-case extension, which the case-insensitive check handles) and `pageprops.page_image_free`.
- **Mutation runs (5.4).** Each change was applied on its own and reverted, then the suite was run. All of them turned a test red: width 250→320, cap 3→4, radius 1000→2000, budget 8000→9000, merge order swapped, no `index` sort, no dedupe, no MIME filter, no wrapper `catch`, no title fallback, no `clearTimeout`, no off-host check, client signal not forwarded, no abort check in `getJson`, and the route without the image step (route suite). My first script was broken: it saved its backup to the wrong path, so the mutations stacked up. I restored the files from separate backups and ran every mutation again, one at a time.
- **Two mutants survived the first clean run, and both were fixed.** (a) Removing `attachSuggestionImages`' own already-aborted check changed nothing, because `getJson` already refuses an aborted signal. The redundant check was deleted, and a comment says why none is needed. (b) Not forwarding the client signal still passed, because the hung requests were later released by the 8 s budget in real time. That test now runs on fake timers and asserts the step has settled right after the client aborts, before any budget time has passed.
- **Live run of the image step (no model call, no cost).** `attachSuggestionImages` ran against real Wikimedia for five Dunedin places like the ones from 12.1's manual call. Result: 5 of 5 got 3 images. 2 of 5 had a lead image (Larnach Castle with a `wikiTitle`; Mount Cargill through the `title` fallback). Commons supplied 6–10 candidates for each, and the step took **1941 ms** in total. Quality note: Tunnel Beach's first nearby picture is a "cracked earth" photo, which is *Questions* 2's noise in practice.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.
- **Contract (Task 1).** Added `SuggestionImage`, `VerifiedDaySuggestion` (what verification returns) and `DaySuggestion = VerifiedDaySuggestion & { images }`. Verification now returns `VerifiedDaySuggestion[]`, a type change only. Its behaviour and tests are unchanged, and it does not set `images`. Added `isWikimediaUploadUrl` as specified, plus a test that the model schema has no `url`/`image` key.
- **Deviation 1: a second URL guard, `isWikimediaThumbnailUrl`.** The live API serves thumbnails from `thumb.wikimedia.org` (Debug Log). Widening `isWikimediaUploadUrl` would also have widened 12.4's SSRF check on downloads, so it stays exactly as Task 1.2 wrote it and still guards `originalUrl`. The new sibling guards `thumbnailUrl`. It accepts `thumb.wikimedia.org`, and also `upload.wikimedia.org`, because when the source is narrower than 250 px the original is the thumbnail. It has the same https/port/credential rules and lives in the same pure module. AC 2's wording ("both URLs pass `isWikimediaUploadUrl`") therefore holds for `originalUrl`, and for `thumbnailUrl` the check is the sibling guard. **For 12.4:** if it follows *Questions* 3 and downloads the 1280 px thumbnail instead of the original, that URL is on `thumb.wikimedia.org`, so 12.4 has to decide which guard its download uses.
- **Prompt (Task 2).** The `wikiTitle` line now asks for the English Wikipedia title. `daySuggestionPrompt.test.ts` was not edited and stays green.
- **Client (Task 3).** New `src/lib/ai/suggestionImages.ts`. `fetchPageImage` and `fetchNearbyCommonsImages` never throw: a non-OK status, a network error, an abort, bad JSON, an odd shape or a bad row all count as "nothing". `findSuggestionImages` runs the page-image chain (wikiTitle, then title) and the geosearch concurrently, then merges, dedupes on `File:` keys with underscores, and cuts to 3. `attachSuggestionImages` uses one `AbortController`, one timer cleared in `finally`, and `AbortSignal.any` with the client signal (Node 24 is pinned, so no fallback is needed), plus the final `catch` wrapper. `setTimer`/`clearTimer` injection (marked optional in 3.7) was not added, because `vi.useFakeTimers()` covers the budget test.
- **Route (Task 4), choice for 4.1: rely on 3.7's wrapper**, with a comment at the call site. There is no route-level try. So 5.2's conditional "lookup rejects → 200" route case does not apply. The wrapper is tested in `suggestionImages.test.ts` instead ("answers images: [] … even when the step itself breaks"; the mutation that removes the `catch` turns it red). Strictly, AC 7's last sentence asks the *route suite* to prove the rejection case. That would require the route-level try that 4.1 says not to add alongside the wrapper. I followed the task text. If you want the route-level guarantee as well, it is a three-line change.
- **Tests (Task 5).** 33 tests in the new suite and 1 new route case. `daySuggestionsRoute.test.ts`'s `toHaveBeenCalledTimes(3)` is unedited and green. `verifySuggestions`, `daySuggestionPrompt` and `nominatim` suites are untouched.
- **Docs (Task 6).** `deployment-configuration.md` now covers the Wikimedia step: the two API hosts, the two media hosts (browser and server), the `User-Agent` contact taken from `APP_BASE_URL`, and timing of up to 78 s (heading now "about 80 seconds"). The `APP_BASE_URL` row mentions the new use. `deployment-guide.md` has one clause added to its `APP_BASE_URL` row. There is no separate outbound-host list, so the hosts are documented in the AI section beside Nominatim, OSRM and Anthropic.
- **Gates (Task 7).** `npm test` **185 files / 3036 tests** green (was 184 / 2996). `tsc --noEmit` clean. Lint 0 errors / 80 warnings (baseline). `check:migrations` passes. `audit:check` was not run, as it stays waived (DW-384). No dependency, env variable, migration or DB write was added. **The full real-key end-to-end call was not made**: 12.1's was made by Tommy from the browser with his own session. Only the image step was run live (Debug Log), so the end-to-end timing with the model is still unmeasured.

### File List

- `travelplan/src/lib/validation/daySuggestionSchemas.ts` (modified)
- `travelplan/src/lib/ai/verifySuggestions.ts` (modified, return type only)
- `travelplan/src/lib/ai/prompt.ts` (modified, one line)
- `travelplan/src/lib/ai/suggestionImages.ts` (new)
- `travelplan/src/app/api/trips/[id]/days/[dayId]/suggestions/route.ts` (modified)
- `travelplan/test/suggestionImages.test.ts` (new)
- `travelplan/test/daySuggestionSchemas.test.ts` (modified)
- `travelplan/test/daySuggestionsRoute.test.ts` (modified)
- `docs/deployment-configuration.md` (modified)
- `docs/deployment-guide.md` (modified)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified)
- `_bmad-output/implementation-artifacts/12-2-pictures-for-each-suggestion.md` (this file)

### Change Log

- 2026-10-16: Story 12.2 implemented. Wikimedia lead image + Commons geosearch per suggestion (≤ 3, 250 px, JPEG/PNG/WebP, 8 s parallel budget, never fails a search), run after verification. `images` added to the response contract. `isWikimediaUploadUrl` for 12.4, and `isWikimediaThumbnailUrl` because thumbnails now come from `thumb.wikimedia.org`. Prompt asks for the English Wikipedia title. Docs cover the new hosts and timing. 185 files / 3036 tests green, tsc 0, lint 0/80, check:migrations passes. Status → review.
- 2026-10-16: Code review (3 layers). 8 fixes applied: a route-level catch with a route test for AC 7; pipes in titles skipped; the original used as a thumbnail only when it is known to be ≤ 250 px; one warn line per search on lookup failures; docblock placement; constant docblocks; AC 2 and item 7 wording; schema test tidy-up. One decision accepted as specified (no location check on the lead image). 4 deferred (DW-385 to DW-388). Gates: 185 files / 3040 tests, tsc 0, lint 0/80. Status review → done.
- 2026-10-16 (after 12.4): Commons geosearch replaced by a Commons full-text search for the place's name with `nearcoord:3km` (`fetchNamedCommonsImages`). On the Neuseeland trip the nearest geotagged files were mostly naturalists' close-ups (beetles, fungi, seedlings). The lead image stays first; no fallback to geosearch. Same request count. 192 files / 3183 tests, tsc 0, lint 0/80.
