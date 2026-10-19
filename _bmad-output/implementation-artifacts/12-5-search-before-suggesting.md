---
authored_against: a20e4c6
baseline_commit: a20e4c6
---

# Story 12.5: Search Before Suggesting

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As someone asking for ideas for a day,
I want the suggestions to be checked against the web for that date,
so that what I get is open, actually taking place, and not a guess from the model's memory.

**FRs covered:** FR45 (12.1 already promised opening hours, closures and events on the given date). **Depends on:** Story 8.7 (its usage records are the measurement). **Origin:** Story 8.7's real run and spike, with Tommy, 2026-10-19.

**This story has two parts:** a measured comparison that **Tommy decides on** (Tasks 1-3), then a small code change that ships the variant he picks (Tasks 4-8). Do not write the production change before Tommy has picked.

## Acceptance Criteria

1. **Comparison.** At least these candidates, each run **at least three times** on the **same 3 real wishes** (Task 1):
   - **C** Sonnet 5.5, `output_config.format` + `effort: "medium"` + `web_search_20260209` with `allowed_callers: ["direct"]`
   - **D** Sonnet 5.5, `output_config.format` + `effort: "high"` + `web_search_20260209` (default callers)
   - **H** Haiku 5.5 (`claude-haiku-5-5`), `output_config.format` + `effort: "medium"` + `web_search_20250305`

   For each run, record side by side: web searches, duration, input / cache write / cache read / output tokens, estimated cost (8.7's formula and prices), whether the answer passes `suggestionsResponseSchema`, and the suggestions themselves. **Tommy judges quality** (open that day, actually taking place) and **picks one**. The table, Tommy's judgement and his pick go into Completion Notes.
2. **The chosen variant searches.** With the shipped code, a normal day search makes at least one web search, and `/admin/ai-usage` shows it (`web_search_requests > 0`) after a real run with Tommy.
3. **Inside the deadline.** Every measured run of the chosen variant finishes the model call inside the 60 s deadline (`SUGGESTION_TIMEOUT_MS`, unchanged). If any run of a candidate went over 60 s, that is written next to it in the table.
4. **Prices.** If the shipped model is not `claude-sonnet-5-5`, `AI_MODEL_PRICES` has an entry for it, checked against Anthropic's pricing page with the date in a comment. The existing Sonnet entry is re-checked on the same day (see Trap 6).
5. **Caching is decided from numbers.** The table shows `cache_read_input_tokens` per variant. Top-level `cache_control` stays only if, for the chosen variant, the mean cost with caching is lower than the same runs repriced without it (all cache write + read tokens billed as plain input). Otherwise it is removed. The decision and the two figures go into Completion Notes.
6. **The model setting keeps working.** `ANTHROPIC_MODEL` can still name either family: a `claude-haiku-*` model is sent `web_search_20250305`, every other model `web_search_20260209`. No request that the API rejects because of the tool version is built for either default model.
7. **Nothing else changes for the user.** Route order, status codes, error codes and bodies, the daily limit, the usage record, verification and images are as today. `buildSuggestionPrompt`'s output stays free of user, member and trip data (12.1 privacy rule).
8. **Docs.** `.env.example` and `docs/deployment-guide.md` name the default model actually shipped and say that a Haiku model uses the basic web search tool.

## Tasks / Subtasks

- [x] **Task 0 — Baseline** (all)
  - [x] `npm test`, `npm run typecheck`, `npm run lint` in `travelplan/` at a20e4c6. Last recorded: 218 files / 3497 tests, lint 0 errors / 80 warnings; `tsc` may show one stale `.next/dev/types/validator.ts` line about `day-plan-items/move` (pre-existing, `npm run build` regenerates it). Record what you see.
- [x] **Task 1 — Comparison script, outside the repo** (AC1, AC3, AC5)
  - [x] Start from 8.7's spike: `/private/tmp/claude-501/-Users-tommy-Development-TravelPlan/35cea0d0-df80-4367-9728-abbde84613ea/scratchpad/spike-8-7.ts` (copy it; if it is gone, the shape is in Dev Notes). Put the copy in **this session's scratchpad**, not in `travelplan/`. It imports `@/lib/ai/prompt` and `@/lib/validation/daySuggestionSchemas`, so run it from `travelplan/` with `vite-node` (installed; `tsx` is **not**), which honours the `@/` alias through the Vite/Vitest config. The `server-only` import throws outside a server bundle: alias it to an empty module for the run (e.g. a `resolve.alias` in a scratchpad vite config, or the same stub the Vitest setup uses — check `vitest.config.*` first).
  - [x] Use the **real** `buildSuggestionPrompt` and real `zodOutputFormat(modelSuggestionsSchema)`. Run the request the way the service does: the `pause_turn` loop (max 2 resumes), usage summed over resumes, `maxRetries: 0`, a 60 s abort. The cleanest way is to call `requestDaySuggestions` itself with a param override (see Dev Notes, "Measuring through the real service"), so the comparison measures the code that ships.
  - [x] Three wishes, fixed for every variant: (a) 8.7's Berlin wish "Konzerte oder Sonderausstellungen, die genau an diesem Tag stattfinden" (walking, 2026-10-24, Hotel Adlon start); (b) a wish where closures matter, e.g. "Museen, die an diesem Tag geöffnet haben" on a **Monday**; (c) a car day between two real places with a general wish. **Ask Tommy for (b) and (c)** if he wants to choose them; otherwise use these and say so.
  - [x] Write per run to a JSON-lines file in the scratchpad: variant, wish id, run no., `ms`, `stop_reason`, resumes, the five usage counts, schema ok, and the suggestions (`title`, `locationLabel`, `description`). Never print the API key. Then build one Markdown table (means and min/max per variant) plus the suggestion lists for Tommy.
  - [x] **Before the first paid run, tell Tommy the expected spend and get a yes.** 3 variants × 3 wishes × 3 runs = 27 calls; from 8.7's spike about $0.09 per Sonnet call and much less on Haiku, so roughly **$2-3**. Optional candidates (Dev Notes) add about $0.25-0.30 per 9 runs.
- [x] **Task 2 — Tommy judges and picks** (AC1, AC5)
  - [x] Show Tommy the table and, per wish, the suggestions of each variant. He marks wrong ones (closed that day, event not on that date, not findable). Count per variant.
  - [x] Tommy picks a variant. Also put AC5's caching figures in front of him. **HALT here until he has picked.** Record table, judgement and pick in Completion Notes.
- [x] **Task 3 — Re-check prices** (AC4)
  - [x] Fetch `https://platform.claude.com/docs/en/about-claude/pricing` on the day. Record Sonnet 5.5 and, if needed, Haiku 5.5: input, 5-minute cache write, cache read, output, the Haiku long-prompt rates and threshold, and the web search fee.
- [x] **Task 4 — Request settings per model** (AC2, AC6)
  - [x] `src/lib/ai/daySuggestionService.ts`: replace the constant `WEB_SEARCH_TOOL` and the hard-coded `effort: "medium"` with settings worked out from the model id read once per search (`const model = getAnthropicModel()` already exists): `claude-haiku-` prefix → `{ type: "web_search_20250305", name: "web_search", max_uses: 5 }`; otherwise → `web_search_20260209` with what Tommy picked (`allowed_callers: ["direct"]` for C). Effort = Tommy's pick. Keep it a small pure function in this file (exported for tests), not env.
  - [x] `max_uses: 5`, `max_tokens: 16000`, the 60 s deadline, `maxRetries: 0`, `output_config.format` and the `pause_turn` loop stay unless Tommy picked a variant without format (not a required candidate).
  - [x] `SERVER_TOOL_BLOCK_TYPES`: also treat `code_execution_tool_result`, `bash_code_execution_tool_result`, and `web_fetch_tool_result` as tool blocks (Trap 2). Harmless for C and H, required for D.
  - [x] If Tommy picked H: `DEFAULT_ANTHROPIC_MODEL = "claude-haiku-5-5"` in `config.ts`.
  - [x] Caching: keep or remove top-level `cache_control` per AC5. If removed, update the docblock paragraph and 8.7's tests that assert it, and say why in one sentence.
  - [x] Update the module docblock: "The request" paragraph (tool version per family, effort, why: the 2026-10-19 finding that format + medium + default callers never searched), and drop the out-of-date "Task 1's Shape B" sentence only if it is no longer true.
- [x] **Task 5 — Prompt** (AC1, AC7) — only if the comparison shows it is needed
  - [x] If the chosen variant still answers some runs with 0 searches, try the "which facts to search for" line (Dev Notes, optional candidate P) on that variant before shipping, and show Tommy the result. A prompt change goes into `SUGGESTION_SYSTEM_PROMPT` only (it stays constant). Update `prompt.ts`'s docblock sentence about Task 1 / Shape B if you touch it.
- [x] **Task 6 — Price table** (AC4)
  - [x] Correct the Sonnet entry if Task 3 found a different figure (date the comment again either way).
  - [x] If H: add `"claude-haiku-5-5"`. Haiku has a second rate card above 100K prompt tokens; see Dev Notes "Haiku's long-prompt rate" for the default handling and the `AiModelPrice` change it needs. Extend `usageSummary.test.ts` for it.
- [x] **Task 7 — Tests** (AC2, AC6, AC7) — see Testing.
- [x] **Task 8 — Docs + gates + real run** (AC2, AC3, AC8)
  - [x] `.env.example` line 24 and `docs/deployment-guide.md` lines 79-80 (+ the 8.7 paragraph if caching changed): default model, Haiku uses the basic web search tool, searches now take longer (about 20-40 s on Sonnet per the spike; use the measured figure).
  - [x] test / typecheck / lint (0 errors, warnings ≤ baseline) / `npm run build`.
  - [x] Real run with Tommy in the dev server with the real key: 2+ searches with the shipped code, `/admin/ai-usage` shows web searches > 0 for the month, both under 60 s for the model call. Status stays `in-progress` until Tommy confirms.

### Review Findings

- [x] [Review][Decision] AC1 quality judgement was a pick, not marks — resolved 2026-10-19: Tommy accepts the pick as AC1's quality judgement (waiver recorded in Completion Notes). AC1 / Task 2 ask Tommy to mark wrong suggestions (closed that day, event not on that date, not findable) and count them per variant. Completion Notes say he picked H from the search counts and did not mark individual suggestions. Either accept the pick as the AC1 judgement (record a waiver in Completion Notes), or Tommy marks the suggestions in the scratchpad `table.md` now and the counts are added.
- [x] [Review][Patch] `code_execution_tool_result` alone is not pinned by any test, and `text_editor_code_execution_tool_result` is missing from the set — the realistic-layout test passes without the new type because `server_tool_use` precedes it (Trap 2's named type survives a single-type mutation); add it to the standalone `it.each`, and add the text-editor sibling of the code-execution result types to `SERVER_TOOL_BLOCK_TYPES` [travelplan/src/lib/ai/daySuggestionService.ts:110, travelplan/test/daySuggestionService.test.ts:178]
- [x] [Review][Patch] Test pins `claude-haiku-4-5` with `effort: "medium"`, a model that was never measured and that does not take `effort` — use 5.x ids only for the family-prefix cases [travelplan/test/daySuggestionService.test.ts:138]
- [x] [Review][Patch] `prompt.ts` docblock still calls the Shape B question "still open", contradicting the new service docblock — one-sentence comment fix, prompt output unchanged [travelplan/src/lib/ai/prompt.ts:17]

## Dev Notes

### What 8.7 found (read this first)

- **The day search has never web-searched.** 0 web searches in all 5 real searches (3-9 s each). In 8.7's one-shot spike (n=1 per variant, Berlin event wish):

  | Variant | Web searches | Duration | Cache write | Cache read | Output |
  |---|---|---|---|---|---|
  | A today: format + medium + default callers | 0 | 12.7 s | 6,196 | 0 | 1,528 |
  | B without format | 5 | 36.0 s | 9,269 | 30,790 | 2,680 |
  | C format + `allowed_callers: ["direct"]` | 2 | 22.2 s | 19,036 | 3,048 | 2,288 |
  | D format + `effort: "high"` | 5 | 37.5 s | 842 | 19,186 | 3,406 |
  | E without format + direct | 2 | 19.2 s | 22,782 | 3,386 | 2,511 |

- Structured output alone is not the block. The combination of medium effort + format + the dynamic-filtering default of `web_search_20260209` is. That is why 12.5's required candidates are C, D and H. n=1 is not a measurement; this story's job is n≥3 on three wishes.
- Caching only costs money today (no search loop, so nothing is re-read: all input bills as a 1.25× write, +16 %). Once searching runs, reads of 19-31k tokens appear within the search (B, D).

### Current state of the files this story touches

- **`src/lib/ai/daySuggestionService.ts`** (247 lines) — `WEB_SEARCH_TOOL` const (`web_search_20260209`, `max_uses: 5`), `output_config: { effort: "medium", format: zodOutputFormat(modelSuggestionsSchema) }`, top-level `cache_control`, `max_tokens: 16000`, `pause_turn` loop with `MAX_PAUSE_RESUMES = 2`, single 60 s `AbortController`, `maxRetries: 0`. Answer = text blocks after the last block whose type is in `SERVER_TOOL_BLOCK_TYPES` (`server_tool_use`, `web_search_tool_result`). Usage summed before any throwing check; `onUsage` once from `finally`. `model` is read once at the top — use that same value to pick the tool. **Preserve:** error mapping, usage accounting, the `finally`, the abort forwarding.
- **`src/lib/ai/config.ts`** — `DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5-5"`, env read per call, `AI_MODEL_PRICES` with one Sonnet entry dated 2026-10-19, `getModelPrice`. Price table is a constant, not env.
- **`src/lib/ai/prompt.ts`** — constant system prompt; already says "Use web search to check opening hours, closures and events on the given date." Its docblock mentions 12.1 Task 1 / Shape B as still open — the comparison closes that question (format + web search works when the request is right).
- **`src/lib/ai/usageSummary.ts`** — cost per record = `(input × in + cacheWrite × cw + cacheRead × cr + output × out) / 1e6 + webSearches × fee`; unpriced models listed as incomplete.
- **Route** `src/app/api/trips/[id]/days/[dayId]/suggestions/route.ts` — no change expected. Its docblock budgets 60 s model + 10 s Nominatim + 8 s images = 78 s inside the proxy's 90 s read timeout; that budget still holds because the 60 s deadline is unchanged.
- **UI** — `trips.suggestions.searchingHint` already says "This can take up to a minute." No UI change.

### Measuring through the real service

Best: run the comparison through `requestDaySuggestions` so the measured code is the shipped code. It takes an injected `client`; pass a thin wrapper whose `messages.create(params, opts)` rewrites `params` for the variant (model, `tools`, `output_config.effort`) and forwards to a real `Anthropic` client. Read `ANTHROPIC_MODEL` from the variant (set `process.env.ANTHROPIC_MODEL` per variant, since `getAnthropicModel()` is read inside). Collect usage through `onUsage`. This also proves the answer extraction works with each variant's block layout (Trap 2), which 8.7's spike never checked — it printed block types only and did not parse.

### Haiku 5.5 facts (claude-api reference, cached 2026-10-06; verify prices on the day)

- `claude-haiku-5-5`, 1M context, 128K output. Adaptive thinking on by default; `effort` low-max, **default `medium`**. No sampling params, no prefill (both 400 — the service sends neither). Structured outputs (`output_config.format`) supported.
- **`web_search_20260209` (dynamic filtering) is Opus/Sonnet only** → Haiku needs `web_search_20250305`: no filtering, raw results land in the context, so expect much more input per search than on Sonnet.
- Prices: $0.10 / $0.50 per MTok input / output for prompts ≤ 100K tokens, **$0.50 / $2.50 above**; cache read 0.1× input, 5-minute write 1.25×. Web search $10 / 1,000 on every model. So on Haiku the search fee will dominate: 3 searches = $0.03 against well under a cent of tokens.
- Minimum cacheable prefix 512 tokens (same as Sonnet 5.5) — the ~6k prompt qualifies.
- Refusals: Haiku has **no server-side fallback**; a refusal is `stop_reason: "refusal"` → the service's existing `ai_failed`. Note any refusals in the table.
- Anthropic's own guidance for Haiku 5.5 with search tools: "say which facts to search for", give the date (the prompt does), and avoid blanket "always search" rules. That is the source of optional candidate P.

### Optional candidates (run only if the required three leave the choice open; ask Tommy)

- **P** — the chosen-or-closest variant plus this line after the "Use web search…" rule in `SUGGESTION_SYSTEM_PROMPT`: *"Your training data ends well before the given date. Opening hours, closures, exhibitions and events may have changed since then, so search for them before you suggest a place, even when you feel sure."* Cheap fix if C or H searches only sometimes.
- **H-high** — Haiku with `effort: "high"`.
- **S318** — Sonnet with `web_search_20260318` (the SDK at `^0.135.0` types it, `node_modules/@anthropic-ai/sdk/resources/messages/messages.d.ts:4894`; same fields as 20260209 plus `response_inclusion`). Only if the docs say it differs in a way that matters here; do not switch tool versions on a hunch.
- `user_location` on the tool is available on all versions; **not** a candidate — the prompt already carries the place, and it would add trip location to the request without being asked for.

### Haiku's long-prompt rate (only if H is picked)

A usage record sums all requests of one search, so the summary cannot know whether a single request crossed 100K. Default: add an optional `longPrompt?: { aboveInputTokens: number; inputPerMTok; outputPerMTok; cacheWritePerMTok; cacheReadPerMTok }` to `AiModelPrice`, and in `usageSummary.ts` apply it when the record's total input (`input + cacheWrite + cacheRead`) is above the threshold. This over-estimates a search whose requests were each under 100K — the safe side for an estimate. Say so in the docblock. Check in the comparison how close Haiku runs come to 100K per request; if none come near it, record that too. (Open question 2.)

### Traps

1. **`ANTHROPIC_MODEL` is operator-settable.** Today an operator who sets a Haiku model gets `web_search_20260209` → 400 → every search `ai_failed`. AC6 fixes that by family prefix. Do not key on the exact id only.
2. **Answer extraction with dynamic filtering.** With default callers (D), the response can carry `code_execution_tool_result` / `bash_code_execution_tool_result` blocks (SDK `ContentBlock` union, `messages.d.ts:3235`). They are not in `SERVER_TOOL_BLOCK_TYPES`, so a text block *before* the last search could be glued onto the JSON and fail `JSON.parse`. Add them (Task 4) and test it.
3. **Thinking blocks.** Adaptive thinking is on by default on both models; `thinking` blocks may appear in `content` and must go back unchanged on `pause_turn` resumes (the loop already pushes `response.content` as is). Don't filter them out of the resend.
4. **Don't send what the model rejects.** No `thinking: { type: "disabled" }` (400 on Sonnet 5.5), no sampling params, no prefill, no forced `tool_choice` (400 on Sonnet 5.5).
5. **The existing request-shape test changes on purpose.** `test/daySuggestionService.test.ts:62` pins `web_search_20260209` without `allowed_callers` and `effort: "medium"`. Update it to the shipped shape and keep it strict (`toEqual` on `tools`), don't loosen it.
6. **Sonnet cache-read price is in doubt.** `config.ts` says $0.10 (0.05× input), read from the pricing page on 2026-10-19. The claude-api reference (cached 2026-10-06) says $0.20 for Sonnet 5.5. One of them is wrong; Task 3 settles it and the comment gets a new date. AC5's caching decision depends on it.
7. **Spike costs real money.** Get Tommy's yes on the budget first (Task 1). Never print the key; don't commit the script.
8. **No migration.** The usage record already has every column the comparison needs. dev.db has a checksum drift (DW-402): never `prisma migrate dev`.
9. **Privacy.** The prompt function is unchanged in what it takes (`DaySuggestionContext`). The JSONL with suggestions stays in the scratchpad.

### Testing

Vitest; the service is tested with an injected fake client (`test/daySuggestionService.test.ts`), the route with the service mocked.

- **Service:** Sonnet default → `tools` exactly the chosen 20260209 shape (incl. `allowed_callers` if C), `effort` as chosen; `ANTHROPIC_MODEL=claude-haiku-5-5` → `web_search_20250305` without `allowed_callers`; another non-Haiku id → 20260209 shape; resumed call sends the same tool and effort; a response whose content is `server_tool_use`, `text` ("Let me check…"), `code_execution_tool_result`, `text` (JSON) parses to the JSON only; `cache_control` asserted present or absent per AC5. Existing usage tests stay green.
- **Config / summary (if H):** `getModelPrice("claude-haiku-5-5")` returns the entry; long-prompt rate applied above the threshold and not at or below it.
- **Mutations to run and record:** send 20260209 for Haiku → red; drop the new block types from `SERVER_TOOL_BLOCK_TYPES` → red; revert effort/callers to today's → red.
- **Must not regress:** all of `daySuggestionService.test.ts`, `daySuggestionsRoute.test.ts`, `usageSummary.test.ts`, `adminAiUsage*.test.ts`, the i18n parity test.

### Project Structure Notes

Updated: `travelplan/src/lib/ai/daySuggestionService.ts`, `travelplan/src/lib/ai/config.ts` (prices, maybe default model), maybe `travelplan/src/lib/ai/prompt.ts` (Task 5), maybe `travelplan/src/lib/ai/usageSummary.ts` (Haiku long-prompt), tests, `travelplan/.env.example`, `docs/deployment-guide.md`. No new files in the repo, no dependency change (`@anthropic-ai/sdk` stays `^0.135.0`, which types all three web search versions), no migration, no UI or i18n change. The comparison script lives only in the scratchpad.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 12.5: Search Before Suggesting]
- [Source: _bmad-output/implementation-artifacts/8-7-what-the-ai-searches-cost.md] — Completion Notes: real run, spike table, caching decision
- [Source: _bmad-output/implementation-artifacts/12-1-ask-claude-what-the-day-could-hold.md] — request rules, Task 1.2 spike never run
- [Source: travelplan/src/lib/ai/daySuggestionService.ts], [Source: travelplan/src/lib/ai/config.ts], [Source: travelplan/src/lib/ai/prompt.ts], [Source: travelplan/src/lib/ai/usageSummary.ts]
- claude-api reference (bundled skill, cached 2026-10-06): Haiku 5.5 migration section, Server Tools quick reference, prompt-caching minimums
- Anthropic pricing page — read on the day (AC4)

### Open questions (defaults applied; confirm with Tommy)

1. **Wishes (b) and (c):** defaults are a Monday museum day and a car day between two real places; Tommy may pick his own.
2. **Haiku long-prompt pricing:** default is the conservative "total input above 100K" rule. Alternative: ignore the second rate card and note it.
3. **If two variants tie on quality**, the default recommendation is the cheaper per search; Tommy decides.
4. **Refusal fallback** (`fallbacks: "default"` on Sonnet 5.5) is out of scope; a refusal stays `ai_failed` as today.

## Dev Agent Record

### Agent Model Used

claude-opus-5-5

### Debug Log References

- Task 0 baseline at a20e4c6 (2026-10-19): 218 files / 3497 tests passed, typecheck clean, lint 0 errors / 80 warnings.
- Task 1: script `compare-12-5.ts` + `table.py` in the session scratchpad (not in the repo), run with `vite-node` and a scratchpad config that aliases `@` and `server-only`. It calls the real `requestDaySuggestions` with a client wrapper that rewrites model / tool / effort per variant. A dry run with an invalid key (401) checked the chain before any paid call. Tommy approved the spend (27 calls) and the default wishes: (a) Berlin Sat 2026-10-24 events, walking; (b) Munich Mon 2026-10-26 "Museen, die an diesem Tag geöffnet haben", walking from Bayerischer Hof; (c) car Tue 2026-10-27 München Hbf → Salzburg Altstadt, "Schöne Zwischenstopps unterwegs, gern mit Aussicht und einem guten Mittagessen".
- Task 8 gates (2026-10-19): 218 files / 3511 tests passed (+14), typecheck clean, lint 0 errors / 80 warnings (= baseline), `npm run build` ok. Docs: `.env.example`, `docs/deployment-guide.md` (variable row + a 12.5 paragraph with the measured 14-31 s / ~22 s and ~$0.04 per search), and `docs/deployment-configuration.md:27`, which also named the old default.
- Task 3 (pricing page read 2026-10-19): Sonnet 5.5 $2 in / $2.50 5m write / $0.10 cache hit (0.05x, footnote 2) / $10 out, so `config.ts` is right and Trap 6 is settled. Haiku 5.5 ≤100K prompt tokens: $0.10 / $0.125 / $0.01 / $0.50; >100K: $0.50 / $0.625 / $0.05 / $2.50. Priced **per request** ("A request's prompt length counts all of its input tokens, including cache reads and cache writes. Each request is priced on its own"). Web search $10 / 1,000 searches.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created

**Comparison (AC1, AC3, AC5)** — 27 real calls on 2026-10-19 through the real `requestDaySuggestions`, 3 wishes × 3 runs per variant, about $1.45 in total. Mean (min-max) per variant; cost from the pricing page read on the day; "no cache" = the same runs with every cache write and read billed as plain input.

| Variant | Runs | Schema ok | 0-search runs | Web searches | Duration s | >60 s | Input | Cache write | Cache read | Output | Cost $ (cached) | Cost $ (no cache) | Max prompt/request |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| C | 9 | 9 | 6 | 0.7 (0.0-2.0) | 13.9 (9.1-17.5) | 0 | 5 (4-6) | 7,007 (0-21,064) | 3,051 (0-6,096) | 1,734 (1,034-2,344) | 0.0418 (0.0107-0.0945) | 0.0441 (0.0165-0.0898) | 25,121 |
| D | 9 | 9 | 1 | 4.1 (0.0-5.0) | 34.2 (23.7-43.7) | 0 | 8 (6-10) | 3,498 (670-7,334) | 17,580 (6,188-27,682) | 2,857 (2,294-3,524) | 0.0802 (0.0339-0.1049) | 0.1119 (0.0568-0.1383) | 29,908 |
| H | 9 | 9 | 0 | 3.0 (2.0-5.0) | 21.8 (14.2-31.3) | 0 | 7 (6-10) | 29,047 (16,756-44,733) | 20,177 (3,040-60,996) | 4,114 (3,168-5,178) | 0.0395 (0.0237-0.0807) | 0.0426 (0.0239-0.1032) | 100,596 |

- All 27 answers passed `suggestionsResponseSchema`; no refusal, no `pause_turn` (0 resumes in every run); **no run of any candidate went over 60 s** (slowest: D 43.7 s, H 31.3 s).
- **C** searched only for wish (a) (2 searches each run); wishes (b) and (c) were answered from memory in all 6 runs. When it did search, a C run cost $0.082-0.095.
- **D** searched in 8 of 9 runs (one 0-search run on wish b), slowest and dearest; its event suggestions for wish (a) were the vaguest ("Abendkonzert im Konzerthaus"). D #1 on the Monday wish (b) proposed the Alte Pinakothek, which as far as known is closed on Mondays.
- **H** searched in all 9 runs (2-5 searches) and named concrete dated events for wish (a). Two runs returned only 3-4 stops. One H request (wish c, run 2) reached 100,596 prompt tokens, i.e. just over Haiku's 100K price step; another reached 81K. So Haiku's long-prompt rate is real for this workload (open question 2): the default rule ships (whole record at the long rate once its total prompt is above 100K; errs high only for searches with resumptions, and none had one).
- Full per-run table and every suggestion list: session scratchpad `table.md` / `runs.jsonl` (not in the repo; privacy rule 9).

**Tommy's judgement and pick (Task 2).** Tommy first leaned to C (faster, he mostly searches for places that do not change), then, after the point that C is cheap mainly because it skips the search (6 of 9 runs, including the Monday museum wish) and that AC2 asks every normal day search to search, **picked H — Haiku 5.5**. He did not mark individual suggestions; the counts above are the evidence. **AC1 waiver (code review, 2026-10-19):** Tommy accepts this pick as AC1's quality judgement instead of per-suggestion marks and counts. For non-Haiku models set through `ANTHROPIC_MODEL`, the shipped settings are C's (20260209, `allowed_callers: ["direct"]`, medium), the Sonnet variant that searched at all at medium effort.

**Caching (AC5).** Chosen variant H: mean **$0.0395 per search with caching** vs **$0.0426** for the same runs repriced without it (C $0.0418 vs $0.0441, D $0.0802 vs $0.1119). Top-level `cache_control` **stays**; 8.7's tests asserting it are unchanged.

**Real run (AC2, AC3, Task 8), 2026-10-19 with Tommy in the dev server, default model, real key.** Two day searches, read back from `ai_usage_records`: 18:38:34 `claude-haiku-5-5` ok, 19.9 s, 2 web searches (6 in / 19,365 write / 3,121 read / 3,801 out); 18:39:24 `claude-haiku-5-5` ok, 18.3 s, 2 web searches (6 / 20,708 / 3,117 / 3,392). `/admin/ai-usage` for October 2026 (Tommy's screenshot): 6 searches (4 from 8.7's run, all Sonnet with 0 web searches), 1 failed, **Websuchen 4**, est. $0.14, $0.0234 per search, 8.7 % read from cache. Both model calls well under 60 s.

**Prices (AC4, Task 3/6).** Sonnet entry re-checked on 2026-10-19 and correct ($0.10 cache hit = 0.05x, so Trap 6's $0.20 in the claude-api reference is the wrong one). `claude-haiku-5-5` added with its long-prompt card; `AiModelPrice` gained an optional `longPrompt` (`AiModelRates` + `aboveInputTokens`), applied in `usageSummary.ts`.

**Task 4/7.** `searchSettingsFor(model)` (exported, pure) picks the tool by `claude-haiku-` prefix; effort `medium` for both families. `SERVER_TOOL_BLOCK_TYPES` gained `web_fetch_tool_result`, `code_execution_tool_result`, `bash_code_execution_tool_result`. `DEFAULT_ANTHROPIC_MODEL = "claude-haiku-5-5"`. Docblock "The request" rewritten; the Shape B sentence replaced (format + search measured to work on both tool versions). Task 5 not needed: H never answered with 0 searches, so the prompt is unchanged (`prompt.ts` untouched, AC7's privacy rule unaffected).
- Tests: request-shape test now pins Haiku + `web_search_20250305` strictly (`toEqual`); Sonnet/Opus/unknown → 20260209 + direct callers; three Haiku ids by prefix; resumed calls carry the same tool and effort; code-execution / bash / web-fetch result blocks skip the text before them; `getModelPrice` for Haiku and Sonnet; long-prompt rate at exactly 100K (base) and above it (long). The realistic dynamic-filtering layout (text, `server_tool_use`, `code_execution_tool_result`) passes even without the new block types, because `server_tool_use` precedes the result; the standalone `bash_code_execution_tool_result` / `web_fetch_tool_result` cases are the ones that pin them.
- Mutations (all red, file restored): Haiku sent 20260209 → 6 failed; new block types dropped → 2 failed; callers removed + effort changed → 9 failed.

### File List

- travelplan/src/lib/ai/daySuggestionService.ts
- travelplan/src/lib/ai/config.ts
- travelplan/src/lib/ai/usageSummary.ts
- travelplan/src/lib/ai/prompt.ts (docblock only, code review)
- travelplan/test/daySuggestionService.test.ts
- travelplan/test/aiConfig.test.ts
- travelplan/test/usageSummary.test.ts
- travelplan/.env.example
- docs/deployment-guide.md
- docs/deployment-configuration.md
- _bmad-output/implementation-artifacts/12-5-search-before-suggesting.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
