import "server-only";
import Anthropic, { AnthropicError } from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { getAnthropicApiKey, getAnthropicModel } from "@/lib/ai/config";
import { buildSuggestionPrompt } from "@/lib/ai/prompt";
import type { DaySuggestionContext } from "@/lib/repositories/tripRepo";
import {
  modelSuggestionsSchema,
  suggestionsResponseSchema,
  type ModelDaySuggestion,
  type SuggestionMode,
} from "@/lib/validation/daySuggestionSchemas";

/**
 * Story 12.1. One Claude call that turns a day and a wish into 3–8 concrete stops, or an
 * `AiSuggestionError("ai_failed")`. Verification against a geocoder is the caller's next step
 * (`verifySuggestions.ts`); this module only asks and validates.
 *
 * **The request.** The model from `ANTHROPIC_MODEL` (default `claude-haiku-5-5`), the web search server
 * tool at `max_uses: 5`, `effort: "medium"`, and the answer constrained by `output_config.format`. The
 * tool version follows the model family (`searchSettingsFor`, Story 12.5): a `claude-haiku-*` model gets
 * the basic `web_search_20250305`, because the dynamic-filtering `web_search_20260209` is Opus/Sonnet only
 * and a 400 on Haiku; every other model gets `web_search_20260209` with `allowed_callers: ["direct"]`.
 * Until 2026-10-19 the request sent 20260209 with its default callers, and format + medium effort + those
 * callers never searched at all (Story 8.7's spike). Story 12.5's comparison (3 wishes × 3 runs) then
 * picked Haiku: it searched in every run, inside the deadline, at the lowest cost per search. No
 * `thinking` (adaptive is the default and `disabled` is a 400 on Sonnet 5.5), no sampling parameters, no
 * prefill and no forced `tool_choice`.
 *
 * **`create` and our own extraction, not `messages.parse`.** The SDK's `parse` runs the JSON parser on
 * *every* `text` block of the response and throws on the first that does not parse (`lib/parser.js`,
 * `parseMessage`). A web-search turn can carry text blocks that are not the answer - a sentence before a
 * search, or an answer split into cited fragments - so `parse` would fail a good response. Here the answer
 * is the text after the last server-tool block, joined, `JSON.parse`d and checked by our own
 * `suggestionsResponseSchema`. (`format` and web search work together - Story 12.5 measured it on both
 * tool versions - so 12.1's fallback "Shape B" without `format` is not needed.)
 *
 * **One deadline.** A single 60 s `AbortController` covers the first request and any `pause_turn`
 * resumption, and `maxRetries: 0` everywhere, because SDK retries would multiply the wall-clock time.
 *
 * **Failures.** The SDK's own error classes, an aborted deadline, `refusal`, `max_tokens`, a turn still
 * paused after two resumes, and an answer that fails our schema all become `ai_failed` with a generic
 * message - no upstream text, prompt or key goes into it. Anything else is a bug and is rethrown, so the
 * route answers 500 rather than blaming the model.
 *
 * **Caching (Story 8.7).** Every request, the first and each resumption, carries top-level
 * `cache_control: { type: "ephemeral" }`, which puts the cache marker on the last cacheable block. Inside
 * one search the server-side web search loop re-reads its own growing context, and those re-reads can then
 * bill as cache reads. Nothing that varies per request is moved into `system` for this - the prompt module
 * is unchanged.
 *
 * **Usage (Story 8.7).** `response.usage` of every request that returns is added up *before* anything that
 * could throw on it (stop reason, JSON, schema), because a response that is then rejected was still paid
 * for. The `finally` hands the total to `onUsage` exactly once per call, on every exit path - success,
 * `ai_failed` and a rethrown bug alike - so the caller can record it. This module stays free of the
 * database; the route owns the write. The usage object carries counts only, never prompt or answer text.
 */

export type AiSuggestionErrorCode = "ai_failed";

export class AiSuggestionError extends Error {
  code: AiSuggestionErrorCode;
  status: number | undefined;
  /** The class name of the SDK error behind this one (`APIConnectionTimeoutError`, `RateLimitError`, ...), for the log line. */
  upstream: string | undefined;

  constructor(code: AiSuggestionErrorCode, message: string, status?: number, upstream?: string) {
    super(message);
    this.name = "AiSuggestionError";
    this.code = code;
    this.status = status;
    this.upstream = upstream;
  }
}

export const SUGGESTION_TIMEOUT_MS = 60_000;
const MAX_PAUSE_RESUMES = 2;

/**
 * Story 12.5. The web search tool and effort for a model id, by family prefix rather than exact id, so an
 * operator who names another Haiku in `ANTHROPIC_MODEL` still gets a tool version that model accepts.
 */
export const searchSettingsFor = (model: string): { tool: Anthropic.ToolUnion; effort: "medium" } =>
  model.startsWith("claude-haiku-")
    ? { tool: { type: "web_search_20250305", name: "web_search", max_uses: 5 }, effort: "medium" }
    : {
        tool: { type: "web_search_20260209", name: "web_search", max_uses: 5, allowed_callers: ["direct"] },
        effort: "medium",
      };

const fail = (status?: number, upstream?: string) =>
  new AiSuggestionError("ai_failed", "Unable to get suggestions right now", status, upstream);

/**
 * Which kind of SDK failure this was, for the log line. Mapped by class rather than read from
 * `error.name` (the SDK leaves it at "Error") or `constructor.name` (a minified build renames it). The
 * status-specific subclasses all collapse to `APIError`, because the logged `status` already says which.
 */
const upstreamName = (error: unknown) => {
  if (error instanceof Anthropic.APIConnectionTimeoutError) return "APIConnectionTimeoutError";
  if (error instanceof Anthropic.APIUserAbortError) return "APIUserAbortError";
  if (error instanceof Anthropic.APIConnectionError) return "APIConnectionError";
  if (error instanceof Anthropic.APIError) return "APIError";
  if (error instanceof AnthropicError) return "AnthropicError";
  return undefined;
};

// Dynamic filtering (web_search_20260209) can add code-execution results, and a fetch result is a tool block
// too: a sentence before any of them is not the answer (Story 12.5).
const SERVER_TOOL_BLOCK_TYPES = new Set([
  "server_tool_use",
  "web_search_tool_result",
  "web_fetch_tool_result",
  "code_execution_tool_result",
  "bash_code_execution_tool_result",
  "text_editor_code_execution_tool_result",
]);

/** The answer: every `text` block after the last server-tool block, joined in order. */
const extractAnswerText = (content: Anthropic.ContentBlock[]) => {
  let lastToolIndex = -1;
  content.forEach((block, index) => {
    if (SERVER_TOOL_BLOCK_TYPES.has(block.type)) {
      lastToolIndex = index;
    }
  });
  return content
    .slice(lastToolIndex + 1)
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("")
    .trim();
};

/** What one search consumed (Story 8.7): counts only, summed over the request and its resumptions. */
export type AiSearchUsage = {
  model: string;
  outcome: "ok" | "failed";
  durationMs: number;
  inputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  outputTokens: number;
  webSearchRequests: number;
};

const createDefaultClient = () =>
  new Anthropic({ apiKey: getAnthropicApiKey(), maxRetries: 0, timeout: SUGGESTION_TIMEOUT_MS });

export const requestDaySuggestions = async ({
  context,
  prompt,
  mode,
  client = createDefaultClient(),
  signal,
  onUsage,
}: {
  context: DaySuggestionContext;
  prompt: string;
  mode: SuggestionMode;
  client?: Anthropic;
  signal?: AbortSignal;
  onUsage?: (usage: AiSearchUsage) => void;
}): Promise<ModelDaySuggestion[]> => {
  const { system, user } = buildSuggestionPrompt(context, { prompt, mode });
  // Read once, so the record names the model every request of this search was sent to.
  const model = getAnthropicModel();
  const { tool, effort } = searchSettingsFor(model);
  const startedAt = Date.now();
  const totals = {
    inputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    outputTokens: 0,
    webSearchRequests: 0,
  };
  let succeeded = false;
  const deadline = new AbortController();
  const timer = setTimeout(() => {
    deadline.abort();
  }, SUGGESTION_TIMEOUT_MS);
  const forwardAbort = () => deadline.abort();
  // A listener added after the abort never fires, so a client that left during the DB lookups is
  // forwarded here, before the paid call starts.
  if (signal?.aborted) {
    deadline.abort();
  }
  signal?.addEventListener("abort", forwardAbort);

  try {
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: user }];
    let response: Anthropic.Message;
    let resumes = 0;

    for (;;) {
      response = await client.messages.create(
        {
          model,
          max_tokens: 16000,
          system,
          messages: [...messages],
          tools: [tool],
          output_config: { effort, format: zodOutputFormat(modelSuggestionsSchema) },
          cache_control: { type: "ephemeral" },
        },
        {
          signal: deadline.signal,
          timeout: Math.max(1, SUGGESTION_TIMEOUT_MS - (Date.now() - startedAt)),
          maxRetries: 0,
        },
      );

      // Counted before any check below can throw: a response we then reject was still paid for. Read
      // defensively - `usage` is always present on the real API, the cache and tool fields may be null.
      const usage = response.usage as Partial<Anthropic.Usage> | undefined;
      totals.inputTokens += usage?.input_tokens ?? 0;
      totals.cacheCreationInputTokens += usage?.cache_creation_input_tokens ?? 0;
      totals.cacheReadInputTokens += usage?.cache_read_input_tokens ?? 0;
      totals.outputTokens += usage?.output_tokens ?? 0;
      totals.webSearchRequests += usage?.server_tool_use?.web_search_requests ?? 0;

      if (response.stop_reason !== "pause_turn") {
        break;
      }
      // The server-side search loop stopped mid-turn. Resending the turn as it stands resumes it; an
      // extra "continue" user message would not (the API resumes on the trailing server-tool block).
      if (resumes >= MAX_PAUSE_RESUMES) {
        throw fail();
      }
      resumes += 1;
      messages.push({ role: "assistant", content: response.content });
    }

    if (response.stop_reason !== "end_turn" && response.stop_reason !== "stop_sequence") {
      throw fail();
    }

    let json: unknown;
    try {
      json = JSON.parse(extractAnswerText(response.content));
    } catch {
      throw fail();
    }

    const parsed = suggestionsResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw fail();
    }
    succeeded = true;
    return parsed.data.suggestions;
  } catch (error) {
    if (error instanceof AiSuggestionError) {
      throw error;
    }
    // The SDK's typed errors - API status errors, connection errors and timeouts, and the abort our own
    // deadline causes - are all "the model call failed". Matched by class, never by message text.
    if (error instanceof AnthropicError || deadline.signal.aborted) {
      throw fail(
        error instanceof Anthropic.APIError ? error.status : undefined,
        upstreamName(error),
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", forwardAbort);
    // Guarded: recording what a search cost must never replace its result or its error.
    try {
      onUsage?.({ model, outcome: succeeded ? "ok" : "failed", durationMs: Date.now() - startedAt, ...totals });
    } catch {
      // The caller's own failure; it logs what it needs.
    }
  }
};
