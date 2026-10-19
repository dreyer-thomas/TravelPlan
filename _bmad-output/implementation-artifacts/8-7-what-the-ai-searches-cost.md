---
authored_against: 547be68
baseline_commit: 547be68
---

# Story 8.7: What the AI Searches Cost

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the administrator of this installation,
I want every AI day search to record what it consumed, the repeated part of each search to be cached, and both to be visible on an admin-only page,
so that I can see what the feature costs, and whether caching pays, from numbers instead of a guess.

**FRs covered:** none (operations; Epic 12's feature is unchanged for its users). **Depends on:** Story 12.1. **Origin:** Tommy with John (PM), 2026-10-18. The model stays `claude-sonnet-5-5`; a Haiku comparison is deliberately out of scope (epic Context).

## Acceptance Criteria

1. **Caching on, nothing else changes.** The Claude request in `requestDaySuggestions` (first call *and* every `pause_turn` resumption) carries top-level `cache_control: { type: "ephemeral" }`. Model, tool (`web_search_20260209`, `max_uses: 5`), `effort: "medium"`, `output_config.format`, `max_tokens`, the 60 s deadline and `maxRetries: 0` are unchanged. Nothing that varies per request (date, ids, the wish) moves into `system` or ahead of it — `buildSuggestionPrompt` is not touched.
2. **One record per search that reached Claude.** When `requestDaySuggestions` ends — success, `ai_failed`, or a rethrown bug — exactly one `AiUsageRecord` is stored with: time, requesting user, model, outcome (`ok` / `failed`), duration in ms, and `input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `output_tokens`, `server_tool_use.web_search_requests` **summed over the first request and every `pause_turn` resumption**.
3. **Failures before a response still count.** A call that failed before any response arrived (timeout, abort, connection error, 5xx) is recorded as `failed` with whatever counts it has (zero if none). A resumption that fails after an earlier response keeps that earlier response's counts.
4. **Refusals record nothing.** A search refused before the model call (CSRF, session, `ai_unavailable`, params, access, 404, JSON, validation, `ai_limit_reached`) stores no record — the same line `consumeDailySearch` draws.
5. **Privacy (Story 12.1 rule).** A record holds no prompt text, no wish, no place, no trip/day id and no response content — only the fields in AC2.
6. **Recording never fails the search.** A write error is logged (error class name only) and the user still gets their suggestions (or still gets the `ai_failed` they would have got). The response status and body are identical to today's in every case.
7. **Deleted accounts keep their history.** When an account with records is deleted through the user administration (Story 5.10, `deleteUserForAdmin`), the records stay with `userId` cleared, and the page shows them as "deleted account" / "Gelöschtes Konto". Monthly totals do not shrink.
8. **Menu row.** For a signed-in admin, the global header menu shows "AI usage" / "KI-Nutzung" directly after "User administration" / "Nutzerverwaltung", linking to `/admin/ai-usage`. Non-admins get exactly today's rows.
9. **Guarded, not hidden.** `/admin/ai-usage` gates itself like `/admin/users` (`notFound()` for a non-admin or an unknown role), and `GET /api/admin/ai-usage` refuses through `requireAdmin` (401 signed out, 403 non-admin), `Cache-Control: no-store`.
10. **The month view.** Current month by default (server-local month, like the daily limit's server-local day); previous months selectable back to the month of the earliest record. Shows: searches and how many failed; the four token counts; web searches; **cache-read share** = `cache_read / (input + cache_creation + cache_read)`; **estimated cost** for the month and **per search**; a per-user breakdown (searches, estimated cost; deleted accounts aggregated as one "deleted account" row). A month without searches shows an empty-state sentence, not a table of zeros.
11. **Cost at display time.** Computed from stored counts and a price table in `src/lib/ai/config.ts` (input, output, cache write, cache read per million tokens, fee per web search), keyed by model. No price is stored on a record, so a price change needs no migration. A record whose model has no price entry contributes its counts but no cost, and the page says the estimate is incomplete for that model. Labelled as an estimate; the page says the Anthropic console is the authoritative bill. Prices are taken from Anthropic's pricing page at implementation time (with the date checked in a comment), **not** from this file or the epic.
12. **i18n.** `en.ts` and `de.ts` carry every new string (key-parity test stays green).
13. **Real run with Tommy.** Two or more searches, at least one with several web searches: the page shows them, and the multi-search one has `cache_read_input_tokens > 0`. If it is zero, caching is not working and the story is not done until it is understood (see "If cache reads are zero").
   **Waiver (Tommy, 2026-10-19, code review):** met by understanding, not as written. The app never web-searches today (format + medium effort + default callers), so no multi-search record exists; the spike showed 19-31k cache reads within one search once searching runs (variants B/D). Making the app search is Story 12.5. The "deleted account" row is accepted on tests (repo + API); the 390 px layout stays a manual check for Tommy.

## Tasks / Subtasks

- [x] **Task 0 — Baseline** (all)
  - [x] `npm test`, `npm run typecheck`, `npm run lint` green at 547be68 (last recorded: 213 files / 3432 tests, lint 0 errors / 79 warnings). Record the numbers.
- [x] **Task 1 — Schema + migration** (AC2, AC5, AC7)
  - [x] `prisma/schema.prisma`: add `enum AiUsageOutcome { ok failed }` (lowercase values have precedent: `PreferredLanguage { en de }`; SQLite stores TEXT, no CHECK) and `model AiUsageRecord` (see Dev Notes for the exact shape). Add `aiUsageRecords AiUsageRecord[]` to `User`.
  - [x] New migration `prisma/migrations/20261019120000_add_ai_usage_records/migration.sql`, generated with `prisma migrate dev --create-only` and given a header comment like its neighbours. Do **not** edit any existing migration (`npm run check:migrations`).
  - [x] Verify the FK reads `ON DELETE SET NULL` in the generated SQL.
- [x] **Task 2 — Price table + usage types** (AC11)
  - [x] `src/lib/ai/config.ts`: `AI_MODEL_PRICES` keyed by model id, USD: `inputPerMTok`, `outputPerMTok`, `cacheWritePerMTok` (5-minute write — the default TTL of `ephemeral`), `cacheReadPerMTok`, `webSearchPerSearch`. One entry, `claude-sonnet-5-5`, values copied from https://www.anthropic.com/pricing / the API pricing docs on the day of implementation, with a comment `// Checked against Anthropic's pricing page on YYYY-MM-DD`. Export a `getModelPrice(model)` returning the entry or `null`.
  - [x] Keep the file's rule: env read per call; the price table is a constant, not env.
- [x] **Task 3 — Service accumulates usage and enables caching** (AC1, AC2, AC3, AC5)
  - [x] `src/lib/ai/daySuggestionService.ts`: add `cache_control: { type: "ephemeral" }` to the `messages.create` params.
  - [x] Read `getAnthropicModel()` once before the loop into a `const model` and use it for every request and the record (same value as today; removes a theoretical mid-search env change splitting the record from the request).
  - [x] Add an optional `onUsage?: (usage: AiSearchUsage) => void` parameter. Accumulate after every `create` that returns, **before** any check that could throw (stop reason, parse, schema): `input_tokens`, `cache_creation_input_tokens ?? 0`, `cache_read_input_tokens ?? 0`, `output_tokens`, `server_tool_use?.web_search_requests ?? 0`. Read `response.usage` defensively (`response.usage?.…`) — the existing fake responses in `test/daySuggestionService.test.ts` have no `usage`.
  - [x] In the existing `finally`, call `onUsage` exactly once with `{ model, outcome, durationMs: Date.now() - startedAt, ...totals }`; `outcome` is `ok` only when the function is about to return suggestions (set a flag immediately before `return parsed.data.suggestions`). Wrap the callback call so a throwing callback cannot replace the search's own result/error.
  - [x] Export the `AiSearchUsage` type (from this file or a small `src/lib/ai/usage.ts`). Update the module docblock: caching paragraph + usage paragraph.
- [x] **Task 4 — Repository** (AC2, AC6, AC7, AC10)
  - [x] `src/lib/repositories/aiUsageRepo.ts`: `createAiUsageRecord(userId, usage)`; `listAiUsageForRange(from, to)` selecting only the count columns plus `user: { select: { email: true } }`; `getEarliestAiUsageAt()` (`aggregate _min createdAt`).
- [x] **Task 5 — Route records the usage** (AC2, AC3, AC4, AC6)
  - [x] `src/app/api/trips/[id]/days/[dayId]/suggestions/route.ts`: capture usage from `onUsage` into a local, and record it in a `finally` that wraps **only** the `requestDaySuggestions` call (so the record is written whether the model call succeeds or throws, and before Nominatim/Wikimedia run). The record helper catches everything and logs `console.error("day suggestions: usage record failed", { name })` — never the message. Nothing before `consumeDailySearch` changes, so refusals record nothing by construction.
  - [x] Await the write (SQLite insert, milliseconds) rather than fire-and-forget, so tests can assert it and no write is left dangling at process shutdown.
  - [x] Update the route docblock: one sentence on the usage record.
- [x] **Task 6 — Summary (pure)** (AC10, AC11)
  - [x] `src/lib/ai/usageSummary.ts`: `summarizeAiUsage(rows, getPrice)` → totals (searches, failed, four token sums, web searches, cache-read share or `null` when total input is 0), `estimatedCostUsd` (or partial + `unpricedModels: string[]`), `costPerSearchUsd`, `perUser[]` (key = userId or `null` for deleted; label = email or null; searches; cost), sorted by cost desc then searches desc. Cost per record = `(input × in + cacheWrite × cw + cacheRead × cr + output × out) / 1e6 + webSearches × fee`.
  - [x] `monthRange(month: "YYYY-MM")` → server-local `[from, to)` Dates, plus `currentMonthKey(now)`; mirror `dailyLimit.ts`'s local-date construction (`new Date(y, m, 1)`), no UTC.
- [x] **Task 7 — Admin API** (AC9, AC10, AC11)
  - [x] `src/app/api/admin/ai-usage/route.ts`: `GET ?month=YYYY-MM` (optional, defaults to current; Zod in `src/lib/validation/adminAiUsageSchemas.ts`; a month in the future or malformed → `400 validation_error`). `requireAdmin` first; `runtime = "nodejs"`; `no-store`; `try/catch` with `console.error("admin/ai-usage GET: …", error)` like `admin/users/route.ts`. Body: `{ month, months: string[] /* earliest..current, newest first */, summary }`. Emails appear only inside this admin-only response.
- [x] **Task 8 — Page + component** (AC7, AC9, AC10, AC11, AC12)
  - [x] `src/app/(routes)/admin/ai-usage/page.tsx`: same self-gate as `admin/users/page.tsx` (`resolveSignedInUserId` + `isAdminOrUnknown` + `notFound()`). Extract those two helpers into `src/lib/auth/adminPage.ts` and use them from both pages — no behaviour change on `/admin/users`.
  - [x] `src/components/features/admin/AdminAiUsage.tsx` (client): month `Select` driven by `months`; stat tiles (searches / failed, est. cost, cost per search, cache-read share, web searches); token table (four counts); per-user table; empty state; load error; `forbidden` state (role revoked between render and fetch, same reasoning as `AdminUsersList`). Numbers via `Intl.NumberFormat` per language; money as USD (`style: "currency", currency: "USD"`, 2 decimals, per-search with up to 4). Estimate disclaimer under the cost. Phone width 390 px: no horizontal page scroll (tables may scroll inside their own container). Design tokens from `theme.ts` only — no hard-coded colours (`test/helpers/hardcodedColour.ts` exists for this).
  - [x] Leave `/admin` → `/admin/users` redirect as is.
- [x] **Task 9 — Header menu** (AC8)
  - [x] `src/lib/navigation/authMenu.ts`: add key `"aiUsage"` to the destination union and, inside the existing `isAdmin` spread, a second row `{ key: "aiUsage", labelKey: "header.aiUsage", href: "/admin/ai-usage" }` after `admin`. `HeaderMenu.tsx` needs no change (renders destinations generically; exact-path `aria-current` works).
- [x] **Task 10 — i18n** (AC12)
  - [x] `header.aiUsage` ("AI usage" / "KI-Nutzung") and an `admin.aiUsage.*` block (title, subtitle, month label, stat labels, token labels, per-user headings, `deletedAccount`, `empty`, `loadError`, `forbidden`, `estimateNote` naming the Anthropic console, `unpricedModel` with `{model}`). German with real umlauts.
- [x] **Task 11 — Tests** (all) — see Testing.
- [x] **Task 12 — Docs**
  - [x] `docs/deployment-guide.md` near the `ANTHROPIC_*` table: one paragraph — usage is recorded per search, visible to admins at `/admin/ai-usage`, the cost is an estimate, the console is the bill. No new env variable.
- [x] **Task 13 — Gates + real run** (AC13)
  - [x] test / typecheck / lint (0 errors, warnings ≤ baseline) / `npm run build` / `npm run check:migrations`.
  - [x] Real run with Tommy (dev server, real key): ≥ 2 searches, one wish that forces several web searches (e.g. "Museen mit aktuellen Sonderausstellungen und Öffnungszeiten"). Check the page, and check the multi-search record's `cache_read_input_tokens`. Also delete a throwaway account that made a search and confirm the "deleted account" row. Status stays `in-progress` until Tommy confirms.

### Review Findings

Code review 2026-10-19 (Blind Hunter, Edge Case Hunter, Acceptance Auditor). 1 decision, 9 patches, 1 deferred, 11 dismissed. Decision resolved (option 1, AC13 waiver); all 9 patches applied with tests (5 mutations red, restored); full suite 218 files / 3497 tests, typecheck clean, lint 0 errors / 80 warnings. Deferred: DW-402.

- [x] [Review][Decision] AC13 closed by agreement, not as written; story file contradicts itself — AC13 asks for a multi-search record with `cache_read_input_tokens > 0`; the app never web-searched, so that was reproduced only in the spike (variants B/D). Completion Notes say "AC13 closed with Tommy", but the later "Not verified" note still says AC13 and the story stay open, while Task 13's box is ticked. The "deleted account" row was checked by tests only, and the 390 px layout was not checked in a browser. Either amend AC13 (waiver pointing at Story 12.5), fix the stale note and accept tests for the deleted-account row, or run those checks before `done`. **Resolved (Tommy): option 1, waiver recorded under AC13, stale note fixed.**
- [x] [Review][Patch] Month switch snaps the picker back to the old month and keeps old figures with no loading cue [travelplan/src/components/features/admin/AdminAiUsage.tsx:153]
- [x] [Review][Patch] A failed month fetch removes the month picker; the admin is stuck until reload [travelplan/src/components/features/admin/AdminAiUsage.tsx:146]
- [x] [Review][Patch] A requested month before the earliest record (or an earliest record after the current month) is missing from `months`, so the Select has an out-of-range value [travelplan/src/app/api/admin/ai-usage/route.ts:41]
- [x] [Review][Patch] Years 0000–0099 pass the month regex and `new Date(y, m, 1)` maps them to 19xx [travelplan/src/lib/validation/adminAiUsageSchemas.ts:11]
- [x] [Review][Patch] With an unpriced model, per-search cost divides by unpriced searches too, and the cost tiles / per-user `$0.00` give no hint the figure is partial [travelplan/src/lib/ai/usageSummary.ts:99]
- [x] [Review][Patch] Failed count is hidden when zero; AC10 asks to show how many failed [travelplan/src/components/features/admin/AdminAiUsage.tsx:198]
- [x] [Review][Patch] `admin.aiUsage.*` keys sit between the Story 5.10 comment and the `admin.users.*` keys it explains (de.ts "siehe en.ts" now points at the wrong block) [travelplan/src/i18n/en.ts:1015]
- [x] [Review][Patch] Route test reads the clock once at module load; a run across a month boundary fails [travelplan/test/adminAiUsageRoute.test.ts:37]
- [x] [Review][Patch] Page test's admin case asserts only `toBeTruthy`, not that `AdminAiUsage` is rendered [travelplan/test/adminAiUsagePage.test.ts:53]
- [x] [Review][Defer] dev.db checksum drift on `20260308120020_add_cost_payments` makes `prisma migrate dev` demand a reset [travelplan/prisma/migrations] — deferred, pre-existing

## Dev Notes

### Current state of the files this story touches

- **`src/lib/ai/daySuggestionService.ts`** — one `messages.create` per loop turn, `pause_turn` resumed by re-sending the assistant content (max 2 resumes), one 60 s `AbortController` deadline, `maxRetries: 0`. Answer extracted from text after the last server-tool block, `JSON.parse` + `suggestionsResponseSchema`. All SDK errors / abort → `AiSuggestionError("ai_failed")`; anything else rethrown (route → 500). **`response.usage` is read nowhere.** The `finally` clears the timer and the abort listener — extend it, don't add a second one.
- **`src/app/api/trips/[id]/days/[dayId]/suggestions/route.ts`** — order: CSRF → session → `ai_unavailable` → params → `refuseUnlessTripPlannerOrAdminReader` → day context → JSON → body → `consumeDailySearch` → model → verify → images. Logs only class names/status. **Preserve the order and every status/body.**
- **`src/lib/ai/config.ts`** — env read per call; `DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5-5"`. Key never leaves `lib/ai/`.
- **`src/lib/ai/prompt.ts`** — keeps the system prompt constant "so that a later story can cache" it. **Do not touch.**
- **`src/lib/navigation/authMenu.ts`** — discriminated union `kind: "destination" | "action"` (DW-127); admin row gated *in this file* by `isAdmin`. Long docblocks — match their tone with a short Story 8.7 note.
- **`src/app/(routes)/admin/users/page.tsx`** — server component self-gate; `notFound()` outside the `try`.
- **`src/lib/repositories/adminUserRepo.ts` `deleteUserForAdmin`** — refuses accounts owning trips, then `tx.user.delete`. With `onDelete: SetNull` the records survive automatically; **no change to this function**.
- **`src/proxy.ts`** — matcher already covers `/admin/:path*` (signed-out → login); does not cover `/api/admin/*` (routes self-guard). No change.

### Schema shape

```prisma
enum AiUsageOutcome {
  ok
  failed
}

model AiUsageRecord {
  id                       String         @id @default(cuid()) @map("id")
  createdAt                DateTime       @default(now()) @map("created_at")
  userId                   String?        @map("user_id")
  model                    String         @map("model")
  outcome                  AiUsageOutcome @map("outcome")
  durationMs               Int            @map("duration_ms")
  inputTokens              Int            @default(0) @map("input_tokens")
  cacheCreationInputTokens Int            @default(0) @map("cache_creation_input_tokens")
  cacheReadInputTokens     Int            @default(0) @map("cache_read_input_tokens")
  outputTokens             Int            @default(0) @map("output_tokens")
  webSearchRequests        Int            @default(0) @map("web_search_requests")

  user User? @relation(fields: [userId], references: [id], onDelete: SetNull)

  @@index([createdAt], map: "ai_usage_records_created_at_idx")
  @@index([userId], map: "ai_usage_records_user_id_idx")
  @@map("ai_usage_records")
}
```

No `tripId`, no `dayId`, no prompt column — AC5. This is the first `SetNull` relation in the schema; everything else cascades. That is the point (AC7), say so in a schema comment.

### Why the record is written in the route, from a callback

The service stays DB-free (it is tested with an injected fake client and no Prisma), and the callback fires from its `finally`, so every exit path — return, `ai_failed`, rethrown bug, client abort — produces exactly one usage object. Returning usage on the result/error instead would lose it on the rethrown-bug path. The route owns the user id, so it owns the write.

### Caching: what to expect and what top-level `cache_control` does

- SDK 0.135.0 types `MessageCreateParams.cache_control?: CacheControlEphemeral` as "top-level cache control automatically applies a cache_control marker to the last cacheable block in the request" (`node_modules/@anthropic-ai/sdk/resources/messages/messages.d.ts` ~line 5281). No beta header, no SDK upgrade needed.
- Inside one search the server-side web search loop re-reads the growing context; the expectation (not a measurement) is that those re-reads bill as `cache_read_input_tokens`. Across searches the shared prefix (tool + system prompt) is < ~1,000 tokens and lives 5 minutes, so little is expected there.
- `usage` on a single response already covers the server-side loop's iterations; each `pause_turn` resumption is a separate billed request — hence the sum.
- Pricing structure to expect (verify): 5-minute cache write ≈ 1.25× input, cache read ≈ 0.1× input, web search billed per search on top of tokens.

### If cache reads are zero (AC13)

Check in this order and write the finding into Completion Notes: (1) the outgoing request really carries `cache_control` (log the param keys once in dev, not the content); (2) the minimum cacheable prompt length for the model — a short first prefix may simply not qualify; (3) whether the multi-search record really had `webSearchRequests > 1`; (4) the Anthropic console's own cache columns for the same time. Do not "fix" it by moving content into `system` (AC1).

### Traps

1. **Existing fake responses have no `usage`.** Accumulate defensively or 20+ service tests go red for the wrong reason. Add `usage` to the fakes only in the new tests.
2. **Count before you validate.** A response that ends in `refusal`, `max_tokens`, bad JSON or a schema miss was paid for — add its usage before the check that throws.
3. **Don't touch the request shape beyond `cache_control`.** The existing "sends the model, the web search tool…" test must pass unmodified apart from an added `cache_control` assertion.
4. **The callback must not change the outcome.** A throwing `onUsage` or a failing DB write must not turn a success into a 500 or an `ai_failed` into something else.
5. **Server-local months.** The daily limit is server-local; the month view is too. Don't build ranges from `"YYYY-MM-01T00:00:00Z"`.
6. **Hidden row ≠ guard.** Page self-gates, API uses `requireAdmin`. Test both with a non-admin.
7. **Money is USD.** Anthropic bills in USD; do not reuse `formatCost` (hard-coded EUR) and do not convert.
8. **No `/api/admin/*` CSRF on GET** — matches `admin/users`.
9. **Privacy in logs.** Log error class names only, as the route already does.

### What must not regress

Every existing test in `daySuggestionService.test.ts`, `daySuggestionsRoute.test.ts`, `headerMenuAdminEntry.test.tsx`, `authMenu.test.ts`, `adminUsersRoute.test.ts`, `adminUserActionsRoute.test.ts`, `adminIndexRedirect.test.ts`, and the i18n parity test. Non-admin menu = `trips`, `logout` exactly. `/admin` still redirects to `/admin/users`.

### Testing

Vitest, real per-worker SQLite (`test/setup.ts` migrates it — the new migration is picked up automatically), injected fake Anthropic client for the service, `vi.mock` of the service for the route (existing pattern in `daySuggestionsRoute.test.ts`).

- **Service** (`daySuggestionService.test.ts`, new cases): `cache_control` on first call and on a resumed call; usage summed over a `pause_turn` + final response (incl. `server_tool_use.web_search_requests`, `null` cache fields → 0); `outcome: "ok"` on success; `failed` with zeros when `create` rejects with `APIConnectionTimeoutError`; `failed` with the first response's counts when the resume rejects; `failed` with counts on schema miss / `refusal`; `onUsage` called exactly once per call; a throwing `onUsage` does not change the returned suggestions; usage object has exactly the AC2 keys (no prompt/content).
- **Route** (`daySuggestionsRoute.test.ts`): one row after success; one `failed` row after `ai_failed` (502 unchanged); zero rows for `ai_unavailable`, a viewer, invalid body and `ai_limit_reached`; with `createAiUsageRecord` forced to throw the response is still 200 with suggestions; record's `userId` is the caller; the stored row has no column carrying the wish (assert against the row's keys).
- **Delete** (new, repo-level or via `adminUserActionsRoute`): delete a trip-less user with two records → records remain with `userId: null`.
- **Summary** (`usageSummary.test.ts`): totals, cache-read share (and `null` on zero input), cost per record by formula with a test price table, unpriced model reported, deleted users merged into one row, sort order, `monthRange` local boundaries incl. December → January.
- **Admin API** (`adminAiUsageRoute.test.ts`): 401 signed out, 403 non-admin, 200 admin with `no-store`; default month = current; `months` from earliest record to current; malformed / future month → 400; records outside the month excluded.
- **Menu** (`authMenu.test.ts`, `headerMenuAdminEntry.test.tsx`): admin gets the row after "User administration" with `href="/admin/ai-usage"` in en and de; non-admin and signed-out lists unchanged.
- **Component** (`adminAiUsage.test.tsx`, jsdom): renders tiles and tables from a mocked fetch; empty month → empty-state text, no table; deleted-account label; month change refetches with `?month=`; `403` → forbidden text; estimate note present.
- **Page gate**: non-admin → `notFound()` (pattern of existing admin page tests, if any; otherwise test the extracted helper).
- **Mutations to run and record:** remove `cache_control` → red; drop the resume's usage from the sum → red; move the record write after `verifySuggestionLocations` with verify throwing → red; change `onDelete: SetNull` to `Cascade` → red; drop the `isAdmin` gate on the new row → red.

### Project Structure Notes

New: `prisma/migrations/20261019120000_add_ai_usage_records/`, `src/lib/repositories/aiUsageRepo.ts`, `src/lib/ai/usageSummary.ts`, `src/lib/auth/adminPage.ts`, `src/lib/validation/adminAiUsageSchemas.ts`, `src/app/api/admin/ai-usage/route.ts`, `src/app/(routes)/admin/ai-usage/page.tsx`, `src/components/features/admin/AdminAiUsage.tsx`, tests as above.
Updated: `prisma/schema.prisma`, `src/lib/ai/config.ts`, `src/lib/ai/daySuggestionService.ts`, `src/app/api/trips/[id]/days/[dayId]/suggestions/route.ts`, `src/app/(routes)/admin/users/page.tsx` (helpers moved only), `src/lib/navigation/authMenu.ts`, `src/i18n/en.ts`, `src/i18n/de.ts`, `docs/deployment-guide.md`.
All paths relative to `travelplan/`. No new dependency; `@anthropic-ai/sdk` stays at `^0.135.0`.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 8.7: What the AI Searches Cost]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 12.1: Ask Claude What the Day Could Hold] — privacy rule, daily limit, failure codes
- [Source: _bmad-output/implementation-artifacts/12-1-ask-claude-what-the-day-could-hold.md]
- [Source: _bmad-output/implementation-artifacts/5-10-user-administration-for-admins.md] — `requireAdmin`, page self-gate, deletion rules
- [Source: travelplan/src/lib/ai/daySuggestionService.ts], [Source: travelplan/src/lib/ai/dailyLimit.ts], [Source: travelplan/src/lib/navigation/authMenu.ts], [Source: travelplan/src/lib/auth/adminAccess.ts]
- [Source: docs/deployment-guide.md] — `ANTHROPIC_*` variables
- Anthropic pricing page and prompt-caching docs — to be read at implementation (AC11)

### Open questions (defaults applied; confirm before or during dev)

1. **Currency of the estimate:** USD (Anthropic's billing currency), no conversion. Alternative: EUR via the Epic 10 rate service.
2. **Caching is always on**, no env switch. The epic's "when caching is enabled" is read as "with this change", not as a toggle.
3. **A rethrown bug (route 500) after the model call is recorded as `failed`** — it was paid for. The epic names only `ok` / `ai_failed`.
4. **Per-search cost divides by all searches, failed included.**

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (claude-opus-5-5), via bmad-dev-story, 2026-10-19.

### Debug Log References

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created
- **Baseline (Task 0), at 547be68:** 213 files / 3451 tests green (the story's 3432 predates 14-3/14-4); lint 0 errors / 80 warnings; `tsc` 1 error, pre-existing and not ours: `.next/dev/types/validator.ts` still names `day-plan-items/move/route.js`, which 14-4 deleted (stale generated types; `npm run build` regenerates them and passes).
- **After:** 218 files / 3489 tests green; lint 0 errors / 80 warnings (unchanged); `tsc` only the same stale `.next/dev` line; `npm run build` passes and lists `/admin/ai-usage` and `/api/admin/ai-usage`; `check:migrations` passes.
- **Migration generated with `prisma migrate diff`, not `migrate dev --create-only`.** `migrate dev` refused because `20260308120020_add_cost_payments` no longer matches its applied checksum in dev.db, and it wanted to **reset dev.db**. Not done. The diff against dev.db also carried old, unrelated drift (CHECK-constraint table rebuilds); only the `ai_usage_records` CREATE TABLE and two indexes were taken. The FK reads `ON DELETE SET NULL ON UPDATE CASCADE`. dev.db itself is untouched, so the migration is **not yet applied** there. Use `npx prisma migrate deploy` (it applies pending migrations without a reset) before the real run, never `migrate dev`.
- **Prices (AC11), from platform.claude.com/docs/en/about-claude/pricing on 2026-10-19:** Sonnet 5.5: $2 input, $2.50 5m cache write, **$0.10 cache read (0.05× input, not the 0.1× the Dev Notes expected)**, $10 output; web search $10 per 1,000 searches. Comment in `config.ts` carries the date.
- **Service:** `cache_control: { type: "ephemeral" }` on every `create`; `model` read once; usage summed after every returned `create`, before the stop-reason/JSON/schema checks; `onUsage` called once from the existing `finally`, guarded by its own try/catch. `outcome: "ok"` is set only immediately before the return.
- **Route:** `requestDaySuggestions` is wrapped in an inner `try/finally` that awaits `recordUsage`, so the record is written before verification and on every exit path. `recordUsage` swallows write errors and logs `{ name }` only. If the callback never fired, nothing is written (only possible with a mock).
- **Open questions 1-4: defaults applied** (USD, caching always on, a rethrown bug counts as `failed`, per-search cost divides by every search).
- **Existing tests touched (AC8 makes them right):** `authMenu.test.ts` admin key list now `trips, admin, aiUsage, logout`; `headerMenuAccessibility.test.tsx` admin menu now has 5 rows, not 4. The service's "sends the model…" test only gained the `cache_control` assertion.
- **Mutations (all red, all restored):** remove `cache_control` → 2 red; drop the resume's usage from the sum → 1 red; write the record after `verifySuggestionLocations` → 1 red; FK `SET NULL` → `CASCADE` → 2 red; drop the `isAdmin` gate on the menu rows → 4 red.
- **Real run, first pass (2026-10-19 ~19:25, Tommy):** 3 records, all for Tommy's account (2 ok, 1 failed), so recording works end to end, failed searches included. **Cache reads 0, web searches 0.** Per row: input 4, cache write ~6,250, output 174-1,276, duration 2.7-9.4 s. Diagnosis following "If cache reads are zero": (1) `cache_control` does arrive: 4 uncached input tokens and the whole ~6.25k prompt written to the cache means the top-level marker sits on the user message. (2) Length is not the problem (6k ≫ minimum). (3) **None of the three searches used web search**: `web_search_requests` 0, and 3-9 s is too short for any search round. So there was no in-search loop to re-read, and AC13's multi-search record does not exist yet. Across searches nothing can hit either: the only breakpoint is on the per-request user message, so no cache entry ever ends at the shared tools+system prefix. Consequence: today caching only costs money. All input bills as a 1.25× write: $0.0675 for the three, against $0.058 without caching (+16%). AC13 is still open, pending a real search that does use web search.
- **Real run, second pass:** a 4th search with a wish that needs current information ("Konzerte/Sonderausstellungen an diesem Tag") also shows `web_search_requests` 0, 8.0 s, ~6.27k input. **The app has never been seen doing a web search.** Story 12.1's Task 1.2 spike (does `output_config.format` work together with `web_search_20260209`?) was never run, because there was no key; the API accepts the combination (no 400) but evidently does not search. The docs (structured-outputs, web-search-tool, read 2026-10-19) neither rule this out nor confirm it. Suspects, none tested yet: constrained JSON decoding suppresses the search; `effort: "medium"`; the default `allowed_callers` (code execution / dynamic filtering) of `web_search_20260209`. That is an Epic 12 problem, not an 8.7 one, but it blocks AC13 as written.
- **Spike (Tommy chose option A, 2026-10-19):** the real `buildSuggestionPrompt` (Berlin, 2026-10-24, wish "Konzerte oder Sonderausstellungen, die genau an diesem Tag stattfinden"), sent once per variant, `cache_control` on all of them. Results:

  | Variant | Web searches | Duration | Cache write | Cache read | Output |
  |---|---|---|---|---|---|
  | A today: format + medium + default callers | **0** | 12.7 s | 6,196 | 0 | 1,528 |
  | B without format | 5 | 36.0 s | 9,269 | 30,790 | 2,680 |
  | C format + `allowed_callers: ["direct"]` | 2 | 22.2 s | 19,036 | 3,048 | 2,288 |
  | D format + `effort: "high"` | 5 | 37.5 s | 842 | 19,186 | 3,406 |
  | E without format + direct | 2 | 19.2 s | 22,782 | 3,386 | 2,511 |

  **Only today's combination never searches** (5 of 5 real searches plus A here). Structured output alone is not the block: D and C search with it. Medium effort + format + dynamic filtering (the `web_search_20260209` default) is. n=1 per variant, so this is indicative, not a measurement. **For 8.7 (AC13): once a search runs, top-level caching pays off within the search** (B 30.8k and D 19.2k tokens read at 0.05×). AC13's "multi-search record with cache_read > 0" is reproduced with D and B, but not by the app as it stands. Spike cost about $0.42 (estimated from the counts). The script was deleted from the repo; a copy is in the session scratchpad.
- **AC13 closed with Tommy (2026-10-19):** recording confirmed on real searches (failed included). The zero cache reads are understood: no search ever ran a web search. The spike shows cache reads of 19-31k inside one search as soon as it does. The web search fix and Tommy's Haiku cost comparison go to the new **Story 12.5 (Search Before Suggesting)**, added to epics.md and sprint-status as backlog. The "deleted account" row was checked by tests only (repo + API), not in the real run.
- **Tommy, 2026-10-19: caching stays on, and there is no switch.** Without web search it only costs extra (~0.3 ¢ per search, 6.25k tokens at $2.50 instead of $2.00). An admin switch was weighed and rejected: it would need a settings table, a write endpoint and a DB read per search. Story 12.5 decides about `cache_control` from its comparison.
- **Not verified:** the 390 px layout in a real browser (jsdom lays nothing out; the tiles use a 2-column grid at `xs` and the tables scroll inside their own `TableContainer`); left to Tommy as a manual check. AC13 is closed by waiver (see AC13).

### File List

New:
- travelplan/prisma/migrations/20261019120000_add_ai_usage_records/migration.sql
- travelplan/src/lib/repositories/aiUsageRepo.ts
- travelplan/src/lib/ai/usageSummary.ts
- travelplan/src/lib/auth/adminPage.ts
- travelplan/src/lib/validation/adminAiUsageSchemas.ts
- travelplan/src/app/api/admin/ai-usage/route.ts
- travelplan/src/app/(routes)/admin/ai-usage/page.tsx
- travelplan/src/components/features/admin/AdminAiUsage.tsx
- travelplan/test/usageSummary.test.ts
- travelplan/test/aiUsageRepo.test.ts
- travelplan/test/adminAiUsageRoute.test.ts
- travelplan/test/adminAiUsage.test.tsx
- travelplan/test/adminAiUsagePage.test.ts

Modified:
- travelplan/prisma/schema.prisma
- travelplan/src/generated/prisma/** (regenerated by `prisma generate`)
- travelplan/src/lib/ai/config.ts
- travelplan/src/lib/ai/daySuggestionService.ts
- travelplan/src/app/api/trips/[id]/days/[dayId]/suggestions/route.ts
- travelplan/src/app/(routes)/admin/users/page.tsx (helpers moved to lib/auth/adminPage.ts only)
- travelplan/src/lib/navigation/authMenu.ts
- travelplan/src/i18n/en.ts
- travelplan/src/i18n/de.ts
- travelplan/test/daySuggestionService.test.ts
- travelplan/test/daySuggestionsRoute.test.ts
- travelplan/test/authMenu.test.ts
- travelplan/test/headerMenuAdminEntry.test.tsx
- travelplan/test/headerMenuAccessibility.test.tsx
- docs/deployment-guide.md
- _bmad-output/implementation-artifacts/sprint-status.yaml

### Change Log

- 2026-10-19: Implemented Tasks 0-12 and Task 13's gates: prompt caching on every request, a usage record per search (summed over resumptions, written before verification, never failing the search), deleted accounts kept via SetNull, USD price table and display-time estimate, `/admin/ai-usage` and `GET /api/admin/ai-usage` behind the admin gate, "AI usage" / "KI-Nutzung" header row, en/de strings, docs. Status stays in-progress pending the real run (AC13).
- 2026-10-19: Real run and web-search spike with Tommy; AC13 closed as understood; Story 12.5 created for the web search fix and the Haiku comparison. Status → review.
- 2026-10-19: Code review. AC13 waiver recorded; patches: month picker keeps the picked month and stays after a failed load, old figures cleared while loading; asked month always in `months`; years before 1000 refused; per-search cost over priced searches, cost tiles and partly priced accounts marked incomplete; failed count shown at zero; 5.10 i18n comment moved back to its keys; route test clock pinned; page test checks the rendered component. DW-402 deferred. Status done.
