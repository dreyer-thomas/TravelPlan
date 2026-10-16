---
baseline_commit: 5335c8b
---

# Story 12.1: Ask Claude What the Day Could Hold

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As someone planning a day,
I want the app to ask an AI for stops that fit my wish, my mode of travel and the day's route,
so that I start from concrete ideas instead of a blank day.

**FRs covered:** FR44 (search only: no images, no UI). **Depends on:** nothing. Stories 12.2 (images), 12.3 (dialog) and 12.4 (apply) build on the service and the response shape defined here, so treat the response shape as a contract.
Sources: [epics.md#Story 12.1](../planning-artifacts/epics.md); [sprint-change-proposal-2026-10-16.md](../planning-artifacts/sprint-change-proposal-2026-10-16.md) (rulings R1–R7, defaults D1–D6); [prd.md FR44 and the AI-provider domain note](../planning-artifacts/prd.md); [architecture.md](../planning-artifacts/architecture.md) *Integration Points → External Integrations* (AI suggestions entry) and *Rate Limiting Scope*.

All code paths below are relative to `travelplan/`. Line numbers were read at `5335c8b`. The working tree differs from that commit only in planning artifacts.

## Read this first: what the epic's wording assumes that the code does not

Each item was checked against the code, and each one changes what a task asks for.

1. **No trip check lets an ADMIN in.** Every trip and day lookup filters on `OR: [{ userId }, { members: { some: { userId } } }]`: `getTripAccessForUser` (`src/lib/auth/tripAccess.ts:33`), `getTripDayByIdForUser` (`src/lib/repositories/tripRepo.ts:3655`) and `getDayRoutePointsForUser` (`tripRepo.ts:3682`). An admin who is not on the trip gets `404` from all of them. The day page itself loads through those member-filtered reads, so the UI can never show such a trip to that admin. **Resolution for this story (default; see *Questions*):** the gate is *"trip writer (owner or contributor), **or** an ADMIN with read access to the trip (a viewer)"*. An admin who is not on the trip gets the same `404` as everyone else. That keeps Story 8.3's "a non-participant learns nothing" rule, and it gives R2's ADMIN the only case the UI can actually reach: an operator invited to a trip as a viewer. Build it as one new helper beside `refuseUnlessTripWriter`, not inline in the route (Task 3).
2. **The epic says "the same check as other planning writes", but this route writes nothing.** It is a `POST` because it spends the operator's money, and it must still go through the **CSRF check** like every other `POST` (`day-plan-items/route.ts` pattern). A viewer who is not an admin gets `403 forbidden` "Trip write access required", the same refusal `refuseUnlessTripWriter` gives (`tripAccess.ts:117-127`).
3. **Geocoding exists only inside a route.** `src/app/api/geocode/route.ts` builds the Nominatim URL, parses and filters rows inline, and has no timeout. There is no server function to call. **Extract** the request-and-parse part into `src/lib/geocoding/nominatim.ts` (`searchNominatim({ q, limit, fetchImpl, timeoutMs })`), and make the route a thin caller of it. `test/geocodeRoute.test.ts` pins `limit=5`, the `User-Agent` and the row-filtering rules, and it must stay green **unedited**. That proves the extraction changed nothing.
4. **Nominatim allows at most one request per second.** Its usage policy is the reason for the explicit *Find* button (comment at `geocode/route.ts:47-56`). Verifying 3–8 suggestions with `Promise.all` would send up to eight requests at once from the server's IP. Verify **sequentially**, at least 1 s between request starts, with a per-request timeout of 3.5 s (the OSRM/ECB default). The whole verification gets a budget of 10 s. A suggestion still unverified when the budget runs out stays `verified: false`. This is the only acceptable way to meet D3 without risking an IP ban, and it adds a few seconds to a call that already takes tens of seconds.
5. **No distance helper is exported.** `metersBetween` in `src/lib/routing/dayRouteService.ts:86-100` is private and equirectangular, and its comment says the codebase has no geo-distance helper. Add `haversineMeters(a, b)` to a new `src/lib/geo/distance.ts` and use it for the 2 km check. **Do not** rewire `dayRouteService.ts` to it: its tests pin its own numbers, and that is out of scope.
6. **The trip's start location is never used as a day-1 fallback today.** `getDayRoutePointsForUser` returns coordinates only (no labels) and has no trip-start fallback. Write a dedicated loader `getDaySuggestionContextForUser` (Task 4). It uses the same previous-day rule (nearest lower `dayIndex`, `orderBy [{dayIndex:"desc"},{date:"desc"}]`, as at `tripRepo.ts:3732-3737`), **not** the print payload's `dayIndex - 1`. Do not modify `getDayRoutePointsForUser`.
7. **No env-based feature flag exists.** Today only `JWT_SECRET`, `DATABASE_URL`, `MEDIA_STORAGE_ROOT`, `APP_BASE_URL` and `OSRM_BASE_URL` are read. The day page server component (`src/app/(routes)/trips/[id]/days/[dayId]/page.tsx`) only awaits `params`. The capability flag is `isAiSuggestionsEnabled()` in `src/lib/ai/config.ts`. The page reads it and passes `aiSuggestionsEnabled` as a prop to `TripDayView` (the `AppHeader → HeaderMenu isAdmin` pattern). `TripDayView` accepts the prop and does nothing with it yet, because 12.3 uses it. **Only the boolean crosses to the client, never the key.**
8. **The rate limiter has no daily window and no reset hook.** `checkRateLimit(key, limit, windowMs)` (`src/lib/security/rateLimit.ts`) is a fixed window keyed by string, stored on `globalThis` outside production. For "since midnight server time", key it as `ai-suggestions:${userId}:${localDateKey}` (server-local `YYYY-MM-DD`) and set the window to the milliseconds remaining until the next local midnight. Tests use a fresh user per case (the cuid differs), so no reset hook is needed. **Count only searches that reach Claude**: check the limit after access and validation pass, immediately before the model call. A failed model call still counts, because it was paid for.
9. **`.env.example` is stale and is at the repo root, not in `travelplan/`.** `/Users/tommy/Development/TravelPlan/.env.example` still lists `VITE_JWT_SECRET` and SendGrid. Create `travelplan/.env.example` with the three new variables, plus the five variables the app already reads (without real values). Leave the root file alone and mention it in the completion notes. Docs: `docs/deployment-guide.md:63-75` says *"The source tree reads five variables"*, so update the count and the table. Also update `docs/deployment-configuration.md` *Environment variables* (around line 20) and its systemd `Environment=` example (around line 172). The secrets warning there (around line 211) applies to the API key and must name it.
10. **It has not been confirmed that the model API accepts JSON structured output together with the web search server tool.** The structured-outputs docs list citations as incompatible, and web search produces cited text. The docs read for this story neither confirm nor rule out the combination. Task 1 is therefore a **spike** that settles it before anything else is built. The service is designed so that only the request construction depends on the result (see *The Claude call, precisely*).

## Acceptance Criteria

1. **Happy path.** Given `ANTHROPIC_API_KEY` is set, when an owner, a contributor, or an ADMIN who can read the trip (item 1) sends `POST /api/trips/[id]/days/[dayId]/suggestions` with a valid CSRF token and the body `{ prompt, mode: "car" | "walking" | "cycling" }`, then the server calls Claude through `@anthropic-ai/sdk`:
   - model: `process.env.ANTHROPIC_MODEL` (trimmed), defaulting to `claude-sonnet-5-5`;
   - tools: `[{ type: "web_search_20260209", name: "web_search", max_uses: 5 }]`;
   - output: structured and validated with Zod.

   It answers `200 { data: { suggestions }, error: null }` with 3–8 suggestions, each `{ title, description, locationLabel, lat, lng, durationMinutes, wikiTitle?, verified }`.
2. **Body validation.** `prompt` is trimmed and must be 1–500 characters. `mode` must be one of the three values. Anything else gets `400 validation_error` with `parsed.error.flatten()` details, and a body that does not parse gets `400 invalid_json`. Neither calls Claude or counts against the limit.
3. **Request context.** The request contains:
   - the day's date (`YYYY-MM-DD`);
   - the start place: the previous night's stay (`name`, `locationLabel`, coordinates), or else the trip's start location, or else "unknown";
   - the end place: the day's stay, or "none";
   - the free-text wish;
   - the mode with its meaning: walking or cycling means stops reachable on foot or by bike from the start or the end;
   - the titles of the day's existing activities, non-empty ones only, so they are not suggested again.

   It contains **no** user id, name, email, trip name, member data, notes, costs or links. A test asserts this on the captured request body.
4. **Coordinate verification.** Each suggestion's `locationLabel` is geocoded through the extracted Nominatim function, sequentially and within its budget (item 4). If any of the top 5 results lies within **2 km** (inclusive, haversine) of the AI's coordinates, the closest such result's coordinates replace the AI's and `verified: true`. Otherwise, or if Nominatim fails, times out or the budget runs out, the AI's coordinates stay and `verified: false`. A Nominatim failure never fails the search.
5. **Permission.** No session gets `401`. A CSRF failure gets `403 csrf_invalid`. Not on the trip (an admin included) gets `404 not_found` "Trip day not found". A viewer who is not an admin gets `403 forbidden` "Trip write access required". A day that does not belong to the trip gets `404`. None of these calls Claude or counts against the limit.
6. **Feature off.** When `ANTHROPIC_API_KEY` is unset or whitespace, the endpoint answers `503 ai_unavailable` (checked right after the session, before any trip lookup), and `isAiSuggestionsEnabled()` returns `false`. The day page passes `aiSuggestionsEnabled` to `TripDayView`.
7. **Daily limit.** After `AI_SUGGESTIONS_DAILY_LIMIT` searches by the same user since server-local midnight, the next search gets `429 ai_limit_reached`. The default is 20, and a missing, non-numeric or non-positive value falls back to 20. The count is in memory per process (item 8), and limits are per user, not per trip.
8. **Model failure.** Each of the following gets `502 ai_failed` with the standard envelope (`{ data: null, error: { code: "ai_failed", message } }`), and nothing is written:
   - a timeout (60 s total, web search and any `pause_turn` resumption included);
   - an SDK or API error;
   - `stop_reason` of `refusal` or `max_tokens`;
   - a `pause_turn` that is still paused after the resume allowance;
   - output that fails the schema, including fewer than 3 or more than 8 suggestions.

   The message is generic. No upstream text, prompt or key goes into the response.
9. **Secrets and docs.**
   - The key is read only in `src/lib/ai/` and never logged. Log lines carry the error class name and HTTP status only.
   - `src/lib/ai/*` imports `"server-only"`, so a client import fails the build.
   - `travelplan/.env.example`, `docs/deployment-guide.md` and `docs/deployment-configuration.md` document `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` and `AI_SUGGESTIONS_DAILY_LIMIT`.
10. **Tests (SDK mocked, Nominatim stubbed).** Tests cover:
    - permission: owner, contributor, viewer, admin-viewer, admin not on the trip, and no session;
    - the missing key;
    - the limit;
    - the verification threshold: 1.9 km verified, 2.1 km not, Nominatim failing not;
    - invalid model output: a schema failure, 2 suggestions and 9 suggestions;
    - a timeout and a refusal;
    - the privacy of the request context.

    The full suite, `tsc --noEmit`, lint (0 errors, warning baseline 80) and `npm run check:migrations` are green, and `npm run audit:check` passes with the new dependency.

## Tasks / Subtasks

- [x] **Task 1: Spike the request shape (AC: 1, 8)**: decide this before writing the service.
  - [x] 1.1 `npm i @anthropic-ai/sdk@^0.135.0` (latest on 2026-10-16; peer `zod ^3.25 || ^4`, and the app has zod 4.4.3). Run `npm run audit:check`. If it flags something, stop and report it rather than editing `audit-allowlist.json` silently.
  - [x] 1.2 With a real key (Tommy's, in a local `.env.local`, never committed), run a throwaway script in the scratch directory that sends `client.messages.parse({ …, tools: [webSearch], output_config: { format: zodOutputFormat(Schema) } })`. Record the result in the Debug Log: success, or the exact 400 text.
  - [x] 1.3 **If it succeeds:** use **Shape A**: `messages.create` with `output_config.format: zodOutputFormat(...)`, the answer taken as the `text` blocks after the last server-tool block, joined and `JSON.parse`d. (Amended at code review, 2026-10-16, Tommy's ruling D1. It was `messages.parse`, but the SDK's `parseMessage` JSON-parses *every* `text` block and would fail a cited, fragmented answer.) **If it is rejected:** use **Shape B** (`messages.create` with web search and no `output_config.format`, the schema described in the system prompt, the last `text` block extracted, `JSON.parse`d and `safeParse`d with the same Zod schema). Either way, the result goes through our own `suggestionsResponseSchema.safeParse` (see *The Claude call, precisely*). Without a key, implement Shape A, note in the completion notes that the spike is open, and flag it to Tommy.
- [x] **Task 2: Shared helpers (AC: 4)**
  - [x] 2.1 `src/lib/geo/distance.ts`: `haversineMeters({lat,lng},{lat,lng})` with `EARTH_RADIUS_METERS = 6371000`. Unit tests: 0 for identical points, a known pair (e.g. Brandenburger Tor ↔ Alexanderplatz ≈ 2.2 km ± 50 m), and correct results across the antimeridian.
  - [x] 2.2 `src/lib/geocoding/nominatim.ts`: `searchNominatim({ q, limit = 5, fetchImpl = fetch, timeoutMs = 3500 })`, returning `Array<{lat,lng,label}>` and throwing `GeocodingError` (`code: "geocoding_unavailable"`) on a non-OK response, a timeout or a network error. Move the row-filtering block from `geocode/route.ts:80-141` **unchanged, comments included**. Rewrite `geocode/route.ts` to call it: keep its 401/400 checks and map `GeocodingError` to `502 server_error` "Unable to geocode location" and anything else to `500`, as today. `test/geocodeRoute.test.ts` must pass unedited.
- [x] **Task 3: Access gate (AC: 5)**
  - [x] 3.1 In `src/lib/auth/tripAccess.ts`, add `refuseUnlessTripPlannerOrAdminReader(userId, tripId, notFoundMessage)`. It does one `getTripAccessForUser` call: null → 404; writer → `null`; viewer → `isAdminUser(userId)` ? `null` : `403 forbidden` "Trip write access required". Import `isAdminUser` from `adminAccess.ts` (no cycle: `adminAccess` does not import `tripAccess`). Add a docblock in the file's style explaining item 1. **Do not** change `refuseUnlessTripWriter`.
- [x] **Task 4: Day context loader (AC: 3)**
  - [x] 4.1 In `src/lib/repositories/tripRepo.ts` (use `grep -a`; the file contains a byte that makes plain grep treat it as binary), add `getDaySuggestionContextForUser({ userId, tripId, dayId })`. It returns `null` when the day is not on the trip or the user cannot read it (same OR filter). Otherwise it returns `{ date: "YYYY-MM-DD", start: Place | null, end: Place | null, existingTitles: string[] }`, where `Place = { label: string, lat: number | null, lng: number | null }`.
    - Start: the previous stay, if one exists. Its label is the `name`, plus `locationLabel` when that is set, and it counts only if it has coordinates or a label. Otherwise the trip's `startLocationLabel` with its coordinates, if set. Otherwise `null`.
    - End: the day's stay, built the same way.
    - `existingTitles`: the trimmed, non-empty `DayPlanItem.title`s, ordered with `compareDayPlanItemsByStartTime` (`src/lib/trips/dayPlanItemOrder.ts:67`).
    - Format the date with the UTC date part (`toISOString().slice(0,10)`). Day dates are stored at UTC midnight (see `createTripWithDays`), so this cannot shift the day.
  - [x] 4.2 Repo tests: previous-day stay, a nearest-lower `dayIndex` with a gap (day 3 has no row for day 2, so day 1's stay is used), day 1 falling back to the trip start, no start at all, no end, and untitled items dropped.
- [x] **Task 5: AI module (AC: 1, 3, 6, 7, 8, 9)**: `src/lib/ai/`, every file begins with `import "server-only";` (add `server-only` as a dependency if `next` does not already resolve it; check with `node -e "require.resolve('server-only')"` from `travelplan/`).
  - [x] 5.1 `config.ts`: `isAiSuggestionsEnabled()`, `getAnthropicModel()` (default `"claude-sonnet-5-5"`) and `getDailyLimit()` (default 20). Read `process.env` on each call, not at module load, so tests can set and unset variables per case.
  - [x] 5.2 Schemas live **outside** `lib/ai`, in `src/lib/validation/daySuggestionSchemas.ts` (beside the other `*Schemas.ts`, no `server-only`), because the 12.3 client component imports the types: `suggestionsRequestSchema` (body), `modelSuggestionsSchema` / `suggestionsResponseSchema` (model output, see below), and the exported types `SuggestionMode` and `DaySuggestion` (the API shape including `verified`).
  - [x] 5.3 `prompt.ts`: `buildSuggestionPrompt(context, { prompt, mode })` returns `{ system, user }`. It is a pure function and gets its own unit test for the privacy rule (AC 3). The system prompt is stable (good for caching later). Day-specific data goes only in the user message.
  - [x] 5.4 `daySuggestionService.ts`: `requestDaySuggestions({ context, prompt, mode, client?, signal? })` returns `DaySuggestion[]` without `verified`, or throws `AiSuggestionError` (`code: "ai_failed"`). Inject `client` (default `new Anthropic({ apiKey, maxRetries: 0, timeout: 60_000 })`), following the `fetchImpl` pattern, so tests pass a fake rather than `vi.mock` the SDK.
  - [x] 5.5 `verifySuggestions.ts`: `verifySuggestionLocations(suggestions, { geocode = searchNominatim, now, sleep, budgetMs = 10_000, minIntervalMs = 1_000 })` returns suggestions with `verified`. Inject `sleep` and `now` so tests do not wait in real time.
  - [x] 5.6 `dailyLimit.ts`: `consumeDailySearch(userId, now = new Date())` returns `{ ok }` through `checkRateLimit` (item 8).
- [x] **Task 6: Route (AC: 1, 2, 5, 6, 7, 8)**: `src/app/api/trips/[id]/days/[dayId]/suggestions/route.ts`
  - [x] 6.1 `export const runtime = "nodejs"`. Add `export const maxDuration = 90` only if the project sets `maxDuration` elsewhere. It is self-hosted (systemd), so it probably does not; check and leave it out if so.
  - [x] 6.2 Order: CSRF → `requireSession` → `isAiSuggestionsEnabled` (503) → params (`dayRouteParamsSchema`) → access gate (Task 3) → `getDaySuggestionContextForUser` (404) → JSON/body validation (400) → `consumeDailySearch` (429) → `requestDaySuggestions` → `verifySuggestionLocations` → `ok({ suggestions })`. Map `AiSuggestionError` to `502 ai_failed` and anything else to `500 server_error`. Log with `console.error("day suggestions: …", { name: error.name, status })` only.
  - [x] 6.3 Check whether `src/proxy.ts`'s matcher covers this path (it covers `/api/trips/:path…`) and whether it adds anything this route must respect. Do not change the matcher.
- [x] **Task 7: Capability flag (AC: 6)**: `page.tsx` calls `isAiSuggestionsEnabled()` and passes `aiSuggestionsEnabled`. Add an optional `aiSuggestionsEnabled?: boolean` prop to `TripDayView`'s props type, unused for now and with a one-line comment pointing to Story 12.3. A test that renders `page.tsx` is not required. A unit test of `isAiSuggestionsEnabled` is enough.
- [x] **Task 8: Docs and env (AC: 9)**: item 9. In `deployment-configuration.md`, the variable table lists `ANTHROPIC_API_KEY` as *No (feature off without it)*, plus a note that searches are paid per call by the operator, that the Anthropic console spend limit is the real cost cap, and that the data sent is the place names, coordinates, wish, mode and activity titles (the PRD domain note).
- [x] **Task 9: Route tests (AC: 10)**: `test/daySuggestionsRoute.test.ts`, real per-worker SQLite, seeded users and trips, signed JWTs and the CSRF cookie and header, following `tripDayPlanItemsRoute.test.ts`. Mock `@/lib/ai/daySuggestionService` with `vi.mock` + `importActual` (the `tripDayRoute.test.ts:8-14` pattern) and stub `fetch` for Nominatim with `vi.stubGlobal`. Set and delete `process.env.ANTHROPIC_API_KEY` in `beforeEach` / `afterEach`. The service tests (`test/daySuggestionService.test.ts`) use the injected fake client and assert the request body: model, tool definition, `max_uses: 5`, no member data.
- [x] **Task 10: Gates**: `npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run check:migrations`, `npm run audit:check`. Then one manual call with a real key against a seeded trip, with the response shape and timing recorded in the completion notes.

### Review Findings

Code review 2026-10-16 (Blind Hunter, Edge Case Hunter, Acceptance Auditor). Story tests: 108/108 green, `tsc --noEmit` clean, `geocodeRoute.test.ts` unchanged.

- [x] [Review][Patch] Resolved D1 (Tommy, 2026-10-16: accept the deviation): amend Task 1.3 to say Shape A is `messages.create` + `output_config.format` + our own extraction of the text after the last server-tool block, not `messages.parse` [_bmad-output/implementation-artifacts/12-1-ask-claude-what-the-day-could-hold.md:87]
- [x] [Review][Defer] Resolved D2 (Tommy, 2026-10-16: waive AC10 for this story): `npm run audit:check` fails on 23 findings that were there before this story; tracked for Epic 8 [travelplan/package.json] — deferred, pre-existing (DW-384)
- [x] [Review][Patch] Resolved D3 (Tommy, 2026-10-16: be lenient): parse the suggestions one by one, drop the entries that fail their bounds, keep at most 8, and still require at least 3 valid ones; a paid answer is no longer thrown away over one bad entry [travelplan/src/lib/validation/daySuggestionSchemas.ts:78]
- [x] [Review][Patch] Nominatim 1 req/s spacing only holds within one verification pass; concurrent searches and `/api/geocode` share the server IP unthrottled — make the spacing a module-level throttle in `nominatim.ts` [travelplan/src/lib/ai/verifySuggestions.ts:69]
- [x] [Review][Patch] A request can run about 70 s (60 s model + 10 s verify); document a reverse-proxy read timeout of at least 90 s for `/api/trips/*/suggestions` in the nginx section [docs/deployment-configuration.md:124]
- [x] [Review][Patch] The 8th suggestion can never be verified (starts at 0…6 s; 7 + 3.5 > 10), and the spacing sleep runs before the budget check — clamp the per-request timeout to the remaining budget and check the budget before sleeping [travelplan/src/lib/ai/verifySuggestions.ts:74]
- [x] [Review][Patch] A client signal that is already aborted is never forwarded (`addEventListener` after the abort); `request.signal` is also not passed to verification [travelplan/src/lib/ai/daySuggestionService.ts:102]
- [x] [Review][Patch] Every model failure logs as `AiSuggestionError`, so timeouts, aborts and 5xx can't be told apart in the logs (AC9 asks for the error class name) — carry the upstream class name on the error [travelplan/src/lib/ai/daySuggestionService.ts:161]
- [x] [Review][Patch] `.int()` in the model schema brings in zod 4's safe-integer bounds, which the SDK moves into the field description (the spec says no numeric constraints there) — use `z.number()` and keep `.int()` in the response schema [travelplan/src/lib/validation/daySuggestionSchemas.ts:36]
- [x] [Review][Patch] Response schema: `wikiTitle: null` fails the whole answer (use `nullish`), and an empty description is accepted (add `.min(1)`) [travelplan/src/lib/validation/daySuggestionSchemas.ts:61]
- [x] [Review][Patch] AC3 privacy: no test checks seeded secrets (trip name, email, note, cost, link) against the actual Claude request body; the route test asserts only the mocked service arguments [travelplan/test/daySuggestionsRoute.test.ts:181]
- [x] [Review][Patch] Existing activity titles go into the prompt raw — collapse whitespace and newlines, cap the length, and cap the count [travelplan/src/lib/ai/prompt.ts:57]
- [x] [Review][Patch] The docs say "No user … is sent", but the *content* of stay names, labels and the free-text wish can be personal data — reword to name fields, not guarantee content [docs/deployment-configuration.md:39]
- [x] [Review][Patch] Route tests run verification on the real 1 s spacing (about 10 s of suite time) — mock `verifySuggestions` or use fake timers [travelplan/test/daySuggestionsRoute.test.ts:123]
- [x] [Review][Patch] Leftovers from the extraction: four-space indentation in the moved block, and the stale comment "one request per *Find*" [travelplan/src/lib/geocoding/nominatim.ts]
- [x] [Review][Defer] Rate-limit store never prunes expired keys; daily keys add one entry per user per day [travelplan/src/lib/security/rateLimit.ts:16] — deferred, pre-existing
- [x] [Review][Defer] Verification accepts a broad match (a city or district centroid) within 2 km and moves the pin to it [travelplan/src/lib/ai/verifySuggestions.ts:95] — deferred, product rule from the spec
- [x] [Review][Defer] Shape B and `pause_turn` robustness: code fences or lead-in text, other server-tool block types, and two assistant messages in a row after a second pause [travelplan/src/lib/ai/daySuggestionService.ts:62] — deferred, settle in the Task 1.2 spike

## Dev Notes

### The Claude call, precisely

```ts
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

const response = await client.messages.parse(
  {
    model: getAnthropicModel(),
    max_tokens: 16000,
    system,                                   // stable; no per-day data
    messages,                                 // [{ role: "user", content: user }]
    tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 5 }],
    output_config: { effort: "medium", format: zodOutputFormat(modelSuggestionsSchema) },
  },
  { signal: deadline.signal, timeout: remainingMs(), maxRetries: 0 },
);
```

- **Model rules (Sonnet 5.5, per the bundled Claude API reference, cached 2026-10-06):** do not send `thinking` at all (adaptive is the default; `{type:"disabled"}` returns 400). No `temperature`/`top_p`. No assistant prefill (400). Do not use forced `tool_choice` (400 on this model), and none is needed. Use `effort: "medium"` for latency. Raise it only if quality is poor, and note any raise in the completion notes.
- **Web search version:** `web_search_20260209` (dynamic filtering) is the current version for Sonnet 5.5. **Do not** also declare `code_execution`. Search errors come back as a `web_search_tool_result` with an error object, not as an exception. Ignore them: the model continues without results.
- **One deadline for everything:** create one `AbortController` with a 60 s `setTimeout`, pass its `signal` on every request, and set `maxRetries: 0`, because SDK retries would multiply the wall-clock time (`timeout × (retries+1)`). Clear the timer in `finally` (the `dayRouteService.ts:114` pattern).
- **`pause_turn`:** the server-side tool loop can stop with `stop_reason: "pause_turn"`. Resume by sending `[...messages, { role: "assistant", content: response.content }]` again, with **no** extra "continue" user message, at most **2** times within the same deadline. If it is still paused, throw `ai_failed`.
- **Failure mapping (all to `AiSuggestionError("ai_failed")`):** the SDK's typed errors (`Anthropic.APIError` and subclasses, `APIConnectionTimeoutError`, `APIUserAbortError`), `stop_reason` of `refusal` or `max_tokens`, `parsed_output === null`, any throw from `parse`, and our own `suggestionsResponseSchema.safeParse` failing. Catch the SDK classes specifically, not by matching message strings.
- **Schema.** The model schema has no numeric or length constraints, because the API strips them and the SDK re-checks them client-side. Our own post-validation enforces:
  - `suggestions` has 3–8 entries;
  - `title` 1–120 characters, trimmed;
  - `description` trimmed and **truncated** to 600 characters on a word boundary (truncated, not rejected: "about 600" is a guideline, not a reason to throw away a good answer);
  - `locationLabel` 1–200 characters (matching `locationSchemas.ts`);
  - `lat` in −90..90 and `lng` in −180..180;
  - `durationMinutes` an integer from 10 to 600;
  - `wikiTitle` optional and trimmed, with an empty string becoming `undefined`.
- **Keep any URL out of the output schema.** Story 12.2 must never use AI-produced image URLs, and the easiest way to guarantee that is for the schema to have no URL field.

### Prompt content (guidance, not wording to copy)

System prompt: you suggest concrete, real, currently open places or activities for one day of a trip. Each must be a findable place with a precise label that a geocoder can resolve ("Neues Museum, Bodestraße 1, Berlin", not "a nice museum"). Give realistic visit durations. Use web search to check opening hours, closures and events on the given date. Write descriptions in the language of the user's wish. Do not repeat the listed existing activities. Return 3–8 suggestions.

Mode meaning:
- `car`: anywhere sensible between or around start and end, with reasonable detours.
- `walking`: within comfortable walking distance (about 3 km) of the start or the end.
- `cycling`: within about 15 km of the start or the end.

These radii are guidance for the model, not a server-side filter. Do not reject suggestions on distance.

### Verification, precisely

For each suggestion in order:
1. Wait until at least `minIntervalMs` has passed since the previous request started.
2. Stop if `now() - startedAt + perRequestTimeout > budgetMs`. The remaining suggestions become `verified: false`.
3. Call `searchNominatim({ q: locationLabel, limit: 5 })`.
4. Pick the candidate closest to the AI's point. If it is `<= 2000 m`, replace `lat`/`lng` with it and set `verified: true`. **Keep the AI's `locationLabel`**: Nominatim's `display_name` is long and noisy, and 12.4 stores the label on the activity.

### Response contract (consumed by 12.2–12.4)

```ts
type DaySuggestion = {
  title: string; description: string; locationLabel: string;
  lat: number; lng: number; durationMinutes: number;
  wikiTitle?: string; verified: boolean;
};
// 200: { data: { suggestions: DaySuggestion[] }, error: null }
```
12.2 adds `images` to each suggestion. Do not add an `id` now. 12.3 can use the array index, and 12.4 receives the ticked objects back in its request body.

### Error codes and statuses

| Case | Status | Code |
|---|---|---|
| CSRF | 403 | `csrf_invalid` |
| No session | 401 | `unauthorized` |
| Key unset | 503 | `ai_unavailable` |
| Not on trip / day not in trip | 404 | `not_found` |
| Viewer, not admin | 403 | `forbidden` |
| Bad JSON / body | 400 | `invalid_json` / `validation_error` |
| Daily limit | 429 | `ai_limit_reached` |
| Model failure / timeout / invalid output | 502 | `ai_failed` |
| Anything else | 500 | `server_error` |

`ai_unavailable` comes before the trip lookup on purpose. It reveals nothing about the trip, and it keeps the off state cheap.

### What must not regress

- `test/geocodeRoute.test.ts`: unedited and green (proves the Nominatim extraction).
- `refuseUnlessTripWriter`, `getDayRoutePointsForUser`, `dayRouteService.ts`: unchanged.
- The `/api/geocode` responses: same statuses, same rows, same `User-Agent` (`TravelPlan/0.1 geocoding`). Give the suggestion verification its own `User-Agent`, `TravelPlan/0.1 suggestions`, so the two are distinguishable in Nominatim's logs. This needs a `userAgent` parameter on `searchNominatim`, defaulting to the geocoding one.
- Auth endpoint rate limits: they share the `checkRateLimit` store, so the key prefix `ai-suggestions:` must not collide with theirs.
- Nothing is written to the database by this story. No migration. `check:migrations` must pass trivially.

### Testing

- Vitest 3.2, `test/` directory, camelCase `*.test.ts`. A real SQLite database per worker (`test/setup.ts` runs `prisma migrate deploy`). **Do not mock Prisma or auth.** Seed and sign real tokens instead.
- `test/helpers/routeContext.ts` explicitly does not fit `[dayId]` handlers. Build `{ params: Promise.resolve({ id, dayId }) }` inline, as `tripDayRoute.test.ts` does.
- Fake client for service tests: `{ messages: { parse: vi.fn(async () => ({ stop_reason: "end_turn", parsed_output: {...}, content: [] })) } }`, cast through `unknown as Anthropic`. The timeout test is a fake that waits on `signal`, with `vi.useFakeTimers()` advanced past 60 s. The `pause_turn` test returns `pause_turn` twice and then `end_turn` (succeeds), and three times (fails).
- Verification tests: inject `geocode`, `sleep` and `now`. Cover 1.9 km → verified, 2.1 km → not, geocode throws → not and continues to the next, budget exhausted → the rest are not, and calls are spaced ≥ 1000 ms (assert the `sleep` arguments).
- Follow the 6.31 discipline: write each test red first, and make at least one deliberate mutation per threshold (change 2000 to 2100 and watch the 2.1 km case fail).

### Project Structure Notes

New: `src/lib/ai/{config,prompt,daySuggestionService,verifySuggestions,dailyLimit}.ts`, `src/lib/validation/daySuggestionSchemas.ts`, `src/lib/geo/distance.ts`, `src/lib/geocoding/nominatim.ts`, `src/app/api/trips/[id]/days/[dayId]/suggestions/route.ts`, `travelplan/.env.example`, and tests.
Updated: `src/app/api/geocode/route.ts`, `src/lib/auth/tripAccess.ts`, `src/lib/repositories/tripRepo.ts`, `src/app/(routes)/trips/[id]/days/[dayId]/page.tsx`, `src/components/features/trips/TripDayView.tsx` (props type only), `package.json` and lockfile, `docs/deployment-guide.md`, `docs/deployment-configuration.md`.
Conventions: typed error class with a `code` union, an injectable dependency and a timeout on every outbound call, a named `User-Agent`, long "why" docblocks citing the story, and the `{ data, error }` envelope via `ok`/`fail`. Modules a client component imports must not import Prisma or `server-only` code.

### Previous story intelligence

- 6.31 (most recent): derive from one source of truth, keep a "what must not regress" list and treat it as a gate, red before green, verify with deliberate mutations, and record the gate numbers (174 files / 2885 tests, tsc 0, lint 0 errors / 80 warnings) as the baseline to beat.
- 11.4: when moving code between modules (the Nominatim extraction here), **move unchanged**, keep the old tests unedited as the proof, and watch for `vi.mock` boundaries that only intercept cross-module calls. That is why the route test mocks `daySuggestionService` (a module the route imports) and not functions inside it.
- `stayTimes.ts` has `DEFAULT_CHECK_OUT_TIME = "10:00"`, while proposal D1 says 09:00. That matters for **12.4**, not here. It is recorded under *Questions* so it is decided before 12.4 is created.

### Git intelligence

The last five commits (`5335c8b` 6.31, `cfb5690` 11.4, `b9df833` 11.1–11.3, two bugfixes) touch travel segments and day-plan recalculation. None touch geocoding, auth or the day page server component, so there is no overlap with this story's update files apart from `TripDayView.tsx` (props type only).

### Latest technical information (2026-10-16)

- `@anthropic-ai/sdk` 0.135.0 is the latest on npm. Peer `zod ^3.25 || ^4`. The Zod helper is `zodOutputFormat` from `@anthropic-ai/sdk/helpers/zod`, used with `client.messages.parse()`, and the result is in `response.parsed_output` (nullable).
- TypeScript SDK timeouts are in **milliseconds**. The default `maxRetries` is 2 and retries 408/409/429/5xx, so set it to 0 here.
- `output_config.format` is the current parameter. `output_format` is deprecated.
- Web search: `web_search_20260209`, `max_uses`, result blocks `web_search_tool_result`, and there is a per-search fee on top of tokens.
- Refusal fallbacks (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`, beta endpoint) exist for Sonnet 5.5 on the Claude API. They are **not** enabled in this story. A refusal maps to `ai_failed` (see *Questions*).

### Questions for Tommy (not blocking; the defaults above apply)

1. **ADMIN scope (item 1).** The default is "an admin may search on trips they can at least view". The alternative is "an admin may search on every trip", which needs member-unfiltered loaders and lets an admin reach trips through the API that the UI never shows them. Recommendation: keep the default.
2. **Structured output + web search (item 10).** If the spike shows the API rejects the combination, Shape B (JSON in the text, validated by us) is used. It is equally safe, because our own Zod check is the gate either way.
3. **Refusal fallback.** The Claude API offers a server-side fallback that reruns a refused request on another model. Travel suggestions should rarely trigger a refusal, and when one happens it shows as `ai_failed`. It is left off to keep the call on the plain, non-beta endpoint. Say if you want it on.
4. **For 12.4, not 12.1:** the default check-out is 10:00 in `stayTimes.ts` (shared by the timeline and the Epic 11 push), but D1 says 09:00. Reusing `resolveCheckOutTime` (10:00) keeps the new activities consistent with what the timeline already shows. Recommendation: use 10:00 and correct the epic text when 12.4 is created.

### References

- [epics.md — Story 12.1](../planning-artifacts/epics.md) · [sprint-change-proposal-2026-10-16.md](../planning-artifacts/sprint-change-proposal-2026-10-16.md) §2 rulings/defaults, §5 handoff
- [architecture.md — External Integrations, Rate Limiting Scope, Implementation Patterns](../planning-artifacts/architecture.md)
- `src/lib/auth/tripAccess.ts:33-127`, `src/lib/auth/adminAccess.ts`, `src/lib/auth/sessionGuard.ts`
- `src/app/api/geocode/route.ts`, `test/geocodeRoute.test.ts`
- `src/lib/repositories/tripRepo.ts:3655-3770` (day lookups, previous-day rule)
- `src/lib/routing/dayRouteService.ts:86-160` (distance, timeout pattern), `src/lib/rates/exchangeRateService.ts:160`
- `src/lib/security/rateLimit.ts`, `src/lib/errors/apiError.ts`, `src/lib/http/response.ts`, `src/lib/validation/dayRouteSchemas.ts`
- `test/tripDayRoute.test.ts`, `test/tripDayPlanItemsRoute.test.ts`, `test/helpers/mockFetch.ts`
- `docs/deployment-guide.md:63-75`, `docs/deployment-configuration.md` (env table, systemd unit, secrets warning)

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (`claude-opus-5-5`), via bmad-dev-story in Claude Code.

### Debug Log References

- **Task 1.2 spike: NOT RUN.** No API key was available: `travelplan/.env` holds only `DATABASE_URL` and `JWT_SECRET`, `ANTHROPIC_API_KEY` is unset in the shell, and no `.env.local` exists. Whether the API accepts `output_config.format` together with `web_search_20260209` is still **unconfirmed**. Per Task 1.3, the Shape A request (format sent) is implemented. See the deviation below for why the response is not read through `messages.parse`.
- **SDK finding (0.135.0, `lib/parser.js` → `parseMessage`):** `messages.parse()` runs the output-format parser on **every** `text` block and throws `AnthropicError("Failed to parse structured output")` on the first one that does not parse. A web-search turn can contain text that is not the answer: a sentence before a search, or an answer split into several cited `text` blocks. `parse()` would fail such a response even when the final JSON is valid.
- **Task 1.1 audit:** `npm run audit:check` fails with 23 unsuppressed findings (next, @tiptap/*, prosemirror-view, sharp, source-map-js, fast-uri, deepmerge-ts, …). `npm audit --package-lock-only` on the **baseline lockfile (HEAD)** reports the identical package set. These are advisories published since the last check. **None come from `@anthropic-ai/sdk` or `server-only`.** `audit-allowlist.json` was not touched. Reported to Tommy, not suppressed.
- **Task 2.1 oracle:** the suggested Brandenburger Tor ↔ Alexanderplatz "≈ 2.2 km" is wrong. Those points are ~2.47 km apart. The test pins the published haversine reference instead: Land's End ↔ John o' Groats, 968.9 km on a 6371 km sphere.
- **Mutations (6.31 discipline), each turned a test red and was reverted:** verify radius 2000→2100; `<=`→`<1800`; spacing 1000→900; budget 10 000→13 000; `.min(3).max(8)`→`.min(2).max(9)`; `durationMinutes` `.int()` removed; `MAX_PAUSE_RESUMES` 2→3; `max_uses` 5→6 (the first attempt hit the docblock, not the constant, and was redone on the code line); default daily limit 20→21.
- **Gates (2026-10-16):** `npm test` 184 files / 2982 tests green (baseline 174 / 2885). The 9 files touching the schemas were re-run after the last `wikiTitle` fix: 97/97. `tsc --noEmit` 0 errors. Lint 0 errors / 80 warnings (baseline unchanged, and no warnings in the new files). `check:migrations` passes (no migration changes). `audit:check` **fails on pre-existing advisories only** (see Task 1.1 above). `next build` green.
- **`server-only` guard verified both ways:** `next build` is green, and temporarily importing `@/lib/ai/config` into `TripDayView.tsx` (`"use client"`) fails it with *"'server-only' cannot be imported from a Client Component module"*. The probe was reverted and the build re-run green.

### Completion Notes List

- **Deviation from Task 1.3 / Dev Notes (for review): `messages.create` + our own extraction instead of `messages.parse`.** The request is Shape A as specified: `output_config: { effort: "medium", format: zodOutputFormat(modelSuggestionsSchema) }`, web search `max_uses: 5`, no `thinking`, sampling parameters or `tool_choice`, and `maxRetries: 0`. Because of the parser behaviour above, the answer is taken as the `text` blocks after the last `server_tool_use` / `web_search_tool_result` block. They are joined, `JSON.parse`d and gated by `suggestionsResponseSchema.safeParse`. A side benefit is that Shape B now differs only by removing `format` from `output_config`. The system prompt already describes every field for that case. The service tests' fake client therefore stubs `messages.create`, not `messages.parse`.
- **Spike settled, Task 1.2 and Task 10 manual call (2026-10-16, Tommy, real key in `travelplan/.env`, local dev server):** one search on the imported Neuseeland trip (`mode: "car"`, wish "Schöne Wanderungen und ein gutes Café") answered `200`. **The API accepts `output_config.format` together with `web_search_20260209`, so Shape A stays and Shape B is not needed.** The response shape matched the contract: 5 entries of `{ title, description, locationLabel, lat, lng, durationMinutes, verified }`, German descriptions following the wish's language, no `wikiTitle` on any entry. 1 of 5 was `verified` (a Portobello café). The other four had geocodable-looking labels that Nominatim did not place within 2 km, which is the flag working as designed; Story 12.3 must make unverified stops clearly visible. Two entries were the same stop ("Tunnel Beach Track", same label). This led to a follow-up patch: `suggestionsResponseSchema` now drops repeats (same title and label, ignoring case and spacing) before the 3-entry minimum. Timing was not recorded, because the Safari console snippet's timing line was not part of the paste.
- **Refusal fallbacks are deliberately off** (Question 3). The bundled Claude API guidance suggests enabling `fallbacks: "default"` for `claude-sonnet-5-5`. The story keeps the plain non-beta endpoint, and a refusal maps to `ai_failed`.
- Access (Q1 default): `refuseUnlessTripPlannerOrAdminReader` admits writers, plus an ADMIN who is at least a viewer. An admin not on the trip gets the same 404. `refuseUnlessTripWriter`, `getDayRoutePointsForUser` and `dayRouteService.ts` are unchanged.
- Nominatim extraction: lines 74–129 of the old route moved **byte-identical** (checked with `diff` against `HEAD`). `test/geocodeRoute.test.ts` is unedited and green. Behaviour change worth knowing: a network error or timeout on `/api/geocode` now answers `502` (it was `500` via the catch-all), and there is now a 3.5 s timeout where there was none. A non-JSON body is still `500`.
- Verification is sequential and ≥1 s apart, with a 10 s budget. A request starts only if it can finish within the budget at its full 3.5 s timeout. It sends `User-Agent: TravelPlan/0.1 suggestions` and keeps the model's `locationLabel`.
- Daily limit: key `ai-suggestions:<userId>:<local YYYY-MM-DD>`, window = time to next local midnight. It is consumed after access and body validation and before the model call, so failed model calls count (the route test asserts this).
- The route forwards `request.signal` to the model call, so a client that disconnects aborts the paid request. That search still counts.
- `vitest.config.ts`: `server-only` is aliased to its `empty.js`, the same module Next resolves for server code, because its default entry throws outside a React server bundle.
- `travelplan/.env.example` was created with all eight variables. The **root** `/Users/tommy/Development/TravelPlan/.env.example` is stale (`VITE_JWT_SECRET`, SendGrid) and was left alone as instructed. It could be deleted in an Epic 8 chore.
- `docs/deployment-configuration.md`: the API-key secrets note says the DW-331 accepted risk was decided for `JWT_SECRET`, and that the key (spendable money) is a reasonable moment to reconsider `EnvironmentFile=`. This is a note, not a change of the decision.
- No `maxDuration` export: none exists anywhere in `src`. `runtime = "nodejs"` is set. The `src/proxy.ts` matcher covers the path and adds only the session/password-change gate, unchanged.

### File List

New:
- `travelplan/src/lib/ai/config.ts`
- `travelplan/src/lib/ai/prompt.ts`
- `travelplan/src/lib/ai/daySuggestionService.ts`
- `travelplan/src/lib/ai/verifySuggestions.ts`
- `travelplan/src/lib/ai/dailyLimit.ts`
- `travelplan/src/lib/validation/daySuggestionSchemas.ts`
- `travelplan/src/lib/geo/distance.ts`
- `travelplan/src/lib/geocoding/nominatim.ts`
- `travelplan/src/app/api/trips/[id]/days/[dayId]/suggestions/route.ts`
- `travelplan/.env.example`
- `travelplan/test/geoDistance.test.ts`
- `travelplan/test/nominatim.test.ts`
- `travelplan/test/tripPlannerOrAdminReaderGate.test.ts`
- `travelplan/test/daySuggestionContextRepo.test.ts`
- `travelplan/test/daySuggestionSchemas.test.ts`
- `travelplan/test/daySuggestionPrompt.test.ts`
- `travelplan/test/aiConfig.test.ts`
- `travelplan/test/daySuggestionService.test.ts`
- `travelplan/test/verifySuggestions.test.ts`
- `travelplan/test/daySuggestionsRoute.test.ts`

Modified:
- `travelplan/src/app/api/geocode/route.ts`
- `travelplan/src/lib/auth/tripAccess.ts`
- `travelplan/src/lib/repositories/tripRepo.ts`
- `travelplan/src/app/(routes)/trips/[id]/days/[dayId]/page.tsx`
- `travelplan/src/components/features/trips/TripDayView.tsx` (props type only)
- `travelplan/vitest.config.ts`
- `travelplan/package.json`, `travelplan/package-lock.json` (`@anthropic-ai/sdk@^0.135.0`, `server-only`)
- `docs/deployment-guide.md`
- `docs/deployment-configuration.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/implementation-artifacts/12-1-ask-claude-what-the-day-could-hold.md`

## Change Log

- 2026-10-16: Story 12.1 implemented. AI day-suggestion endpoint, Nominatim extraction, haversine helper, planner-or-admin-reader gate, day context loader, capability flag and env docs. Spike (Task 1.2) and the real-key manual call (Task 10) remain open for lack of a key.
- 2026-10-16: Code review. D1 (accept the `messages.create` extraction, Task 1.3 amended), D2 (AC10 waived, DW-384) and D3 (drop invalid entries, still at least 3) ruled by Tommy. 14 patches applied: a process-wide Nominatim throttle (also booked by `/api/geocode`); verification can try all 8 suggestions (timeout clamped to the remaining budget) and stops when the client leaves; an already-aborted signal is forwarded; `upstream` SDK class in the log line; lenient per-entry response schema (null `wikiTitle`, non-empty description), with no `.int()` in the model schema; existing titles normalised and capped; an AC3 test on the real Claude request body; route tests mock verification; docs now cover the proxy timeout, the privacy wording and the quiet fallbacks. DW-381 to DW-383 deferred. Story stays `in-progress`: Task 1.2 (spike) and Task 10 (real-key call) are still open.
- 2026-10-16: Spike and manual call done with Tommy's key: `200`, Shape A confirmed, Task 1.2 and Task 10 ticked. Follow-up: duplicate suggestions are dropped. Gates: 184 files / 2996 tests green, tsc 0, lint 0 errors, check:migrations passes; audit:check waived (D2, DW-384). Status → done.
