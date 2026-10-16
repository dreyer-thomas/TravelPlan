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
 * **The request.** The model from `ANTHROPIC_MODEL` (default `claude-sonnet-5-5`), the web search server
 * tool at `max_uses: 5`, `effort: "medium"` for latency, and the answer constrained by
 * `output_config.format`. No `thinking` (adaptive is this model's default and `disabled` is a 400), no
 * sampling parameters, no prefill and no forced `tool_choice` - each of those is a 400 on Sonnet 5.5.
 *
 * **`create` and our own extraction, not `messages.parse`.** The SDK's `parse` runs the JSON parser on
 * *every* `text` block of the response and throws on the first that does not parse (`lib/parser.js`,
 * `parseMessage`). A web-search turn can carry text blocks that are not the answer - a sentence before a
 * search, or an answer split into cited fragments - so `parse` would fail a good response. Here the answer
 * is the text after the last server-tool block, joined, `JSON.parse`d and checked by our own
 * `suggestionsResponseSchema`. The same extraction serves Task 1's "Shape B" unchanged: if the API refuses
 * a JSON schema alongside web search, only `format` leaves the request (the system prompt already
 * describes the shape).
 *
 * **One deadline.** A single 60 s `AbortController` covers the first request and any `pause_turn`
 * resumption, and `maxRetries: 0` everywhere, because SDK retries would multiply the wall-clock time.
 *
 * **Failures.** The SDK's own error classes, an aborted deadline, `refusal`, `max_tokens`, a turn still
 * paused after two resumes, and an answer that fails our schema all become `ai_failed` with a generic
 * message - no upstream text, prompt or key goes into it. Anything else is a bug and is rethrown, so the
 * route answers 500 rather than blaming the model.
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
const WEB_SEARCH_TOOL = { type: "web_search_20260209", name: "web_search", max_uses: 5 } as const;

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

const SERVER_TOOL_BLOCK_TYPES = new Set(["server_tool_use", "web_search_tool_result"]);

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

const createDefaultClient = () =>
  new Anthropic({ apiKey: getAnthropicApiKey(), maxRetries: 0, timeout: SUGGESTION_TIMEOUT_MS });

export const requestDaySuggestions = async ({
  context,
  prompt,
  mode,
  client = createDefaultClient(),
  signal,
}: {
  context: DaySuggestionContext;
  prompt: string;
  mode: SuggestionMode;
  client?: Anthropic;
  signal?: AbortSignal;
}): Promise<ModelDaySuggestion[]> => {
  const { system, user } = buildSuggestionPrompt(context, { prompt, mode });
  const startedAt = Date.now();
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
          model: getAnthropicModel(),
          max_tokens: 16000,
          system,
          messages: [...messages],
          tools: [WEB_SEARCH_TOOL],
          output_config: { effort: "medium", format: zodOutputFormat(modelSuggestionsSchema) },
        },
        {
          signal: deadline.signal,
          timeout: Math.max(1, SUGGESTION_TIMEOUT_MS - (Date.now() - startedAt)),
          maxRetries: 0,
        },
      );

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
  }
};
