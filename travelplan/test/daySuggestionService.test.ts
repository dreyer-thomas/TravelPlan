import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { AiSuggestionError, requestDaySuggestions, type AiSearchUsage } from "@/lib/ai/daySuggestionService";
import type { DaySuggestionContext } from "@/lib/repositories/tripRepo";

/**
 * Story 12.1. The model call, with an injected fake client (the `fetchImpl` pattern) instead of a
 * `vi.mock` of the SDK. The fake answers like the Messages API does: a `content` array and a
 * `stop_reason`.
 */

const context: DaySuggestionContext = {
  date: "2026-08-02",
  start: { label: "Hotel Adlon, Berlin", lat: 52.5159, lng: 13.3801 },
  end: null,
  existingTitles: ["Museum"],
};

const suggestion = (n: number) => ({
  title: `Stop ${n}`,
  description: `Why stop ${n} fits.`,
  locationLabel: `Place ${n}, Berlin`,
  lat: 52.5 + n / 100,
  lng: 13.4,
  durationMinutes: 60,
});

const answer = (count: number) => JSON.stringify({ suggestions: Array.from({ length: count }, (_, i) => suggestion(i + 1)) });

type FakeResponse = { stop_reason: string; content: Array<Record<string, unknown>> };

const endTurn = (text: string, before: Array<Record<string, unknown>> = []): FakeResponse => ({
  stop_reason: "end_turn",
  content: [...before, { type: "text", text, citations: null }],
});

const fakeClient = (...responses: Array<FakeResponse | (() => Promise<FakeResponse>)>) => {
  const create = vi.fn(async () => {
    const next = responses.shift();
    if (!next) throw new Error("no more fake responses");
    return typeof next === "function" ? next() : next;
  });
  return { client: { messages: { create } } as unknown as Anthropic, create };
};

const ENV_KEYS = ["ANTHROPIC_MODEL"] as const;
const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

describe("requestDaySuggestions", () => {
  beforeEach(() => {
    delete process.env.ANTHROPIC_MODEL;
  });

  afterEach(() => {
    vi.useRealTimers();
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it("sends the model, the web search tool with max_uses 5, medium effort and the output schema", async () => {
    const { client, create } = fakeClient(endTurn(answer(3)));

    const suggestions = await requestDaySuggestions({ context, prompt: "museums", mode: "walking", client });

    expect(suggestions).toHaveLength(3);
    const [params, options] = create.mock.calls[0] as unknown as [Record<string, unknown>, Record<string, unknown>];
    expect(params.model).toBe("claude-sonnet-5-5");
    expect(params.tools).toEqual([{ type: "web_search_20260209", name: "web_search", max_uses: 5 }]);
    expect(params.output_config).toMatchObject({ effort: "medium", format: { type: "json_schema" } });
    expect(params).not.toHaveProperty("thinking");
    expect(params).not.toHaveProperty("temperature");
    expect(params).not.toHaveProperty("tool_choice");
    expect(params.messages).toEqual([{ role: "user", content: expect.stringContaining("museums") }]);
    expect(options.maxRetries).toBe(0);
    expect(options.signal).toBeInstanceOf(AbortSignal);
    // Story 8.7: top-level caching, nothing else about the request changes.
    expect(params.cache_control).toEqual({ type: "ephemeral" });
  });

  it("uses ANTHROPIC_MODEL when set", async () => {
    process.env.ANTHROPIC_MODEL = " claude-opus-5-5 ";
    const { client, create } = fakeClient(endTurn(answer(3)));

    await requestDaySuggestions({ context, prompt: "museums", mode: "car", client });

    expect((create.mock.calls[0] as unknown as [{ model: string }])[0].model).toBe("claude-opus-5-5");
  });

  it("sends no member data, trip name, notes, costs or links - only the day context", async () => {
    const { client, create } = fakeClient(endTurn(answer(3)));

    await requestDaySuggestions({ context, prompt: "museums", mode: "car", client });

    const body = JSON.stringify(create.mock.calls[0]);
    expect(body).toContain("Hotel Adlon, Berlin");
    expect(body).toContain("2026-08-02");
    expect(body).not.toMatch(/userId|email|tripName|notes|cost|linkUrl/i);
  });

  it("reads the answer from the text after the last web search, ignoring the preamble", async () => {
    const { client } = fakeClient(
      endTurn(answer(4), [
        { type: "text", text: "Let me check opening hours.", citations: null },
        { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: { query: "museums Berlin" } },
        { type: "web_search_tool_result", tool_use_id: "srvtoolu_1", content: [] },
      ]),
    );

    const suggestions = await requestDaySuggestions({ context, prompt: "museums", mode: "car", client });

    expect(suggestions).toHaveLength(4);
  });

  it("joins an answer split across several text blocks", async () => {
    const text = answer(3);
    const { client } = fakeClient({
      stop_reason: "end_turn",
      content: [
        { type: "text", text: text.slice(0, 40), citations: null },
        { type: "text", text: text.slice(40), citations: [{ type: "web_search_result_location" }] },
      ],
    });

    expect(await requestDaySuggestions({ context, prompt: "museums", mode: "car", client })).toHaveLength(3);
  });

  it("resumes a pause_turn twice by resending the assistant turn, with no extra user message", async () => {
    const paused = { stop_reason: "pause_turn", content: [{ type: "server_tool_use", id: "s1", name: "web_search", input: {} }] };
    const { client, create } = fakeClient(paused, paused, endTurn(answer(3)));

    const suggestions = await requestDaySuggestions({ context, prompt: "museums", mode: "car", client });

    expect(suggestions).toHaveLength(3);
    expect(create).toHaveBeenCalledTimes(3);
    const rolesOf = (call: number) =>
      (create.mock.calls[call] as unknown as [{ messages: Array<{ role: string }> }])[0].messages.map((m) => m.role);
    expect(rolesOf(0)).toEqual(["user"]);
    expect(rolesOf(1)).toEqual(["user", "assistant"]);
    expect(rolesOf(2)).toEqual(["user", "assistant", "assistant"]);
  });

  it("fails when still paused after two resumes", async () => {
    const paused = { stop_reason: "pause_turn", content: [{ type: "server_tool_use", id: "s1", name: "web_search", input: {} }] };
    const { client, create } = fakeClient(paused, paused, paused);

    await expect(requestDaySuggestions({ context, prompt: "museums", mode: "car", client })).rejects.toMatchObject({
      code: "ai_failed",
    });
    expect(create).toHaveBeenCalledTimes(3);
  });

  it.each(["refusal", "max_tokens"])("fails on stop_reason %s", async (stopReason) => {
    const { client } = fakeClient({ stop_reason: stopReason, content: [{ type: "text", text: answer(3) }] });

    await expect(requestDaySuggestions({ context, prompt: "museums", mode: "car", client })).rejects.toBeInstanceOf(
      AiSuggestionError,
    );
  });

  it.each([
    ["text that is not JSON", "Here are some ideas!"],
    ["a schema failure", JSON.stringify({ suggestions: [{ title: "x" }, { title: "y" }, { title: "z" }] })],
    ["2 suggestions", answer(2)],
    ["no text at all", ""],
  ])("fails on %s", async (_label, text) => {
    const { client } = fakeClient(endTurn(text));

    await expect(requestDaySuggestions({ context, prompt: "museums", mode: "car", client })).rejects.toMatchObject({
      name: "AiSuggestionError",
      code: "ai_failed",
    });
  });

  it("keeps the first 8 of 9 suggestions rather than failing the paid answer", async () => {
    const { client } = fakeClient(endTurn(answer(9)));

    const suggestions = await requestDaySuggestions({ context, prompt: "museums", mode: "car", client });

    expect(suggestions.map((s) => s.title)).toEqual(Array.from({ length: 8 }, (_, i) => `Stop ${i + 1}`));
  });

  it("does not start the paid call for a client that has already gone", async () => {
    const create = vi.fn(
      (_params: unknown, options: { signal: AbortSignal }) =>
        options.signal.aborted ? Promise.reject(new Anthropic.APIUserAbortError()) : Promise.resolve(endTurn(answer(3))),
    );
    const client = { messages: { create } } as unknown as Anthropic;
    const gone = new AbortController();
    gone.abort();

    await expect(
      requestDaySuggestions({ context, prompt: "museums", mode: "car", client, signal: gone.signal }),
    ).rejects.toMatchObject({ code: "ai_failed", upstream: "APIUserAbortError" });
  });

  it("maps an SDK API error to ai_failed without leaking its message", async () => {
    const { client } = fakeClient(async () => {
      throw new Anthropic.APIError(500, { error: { message: "upstream secret detail" } }, "upstream secret detail", new Headers());
    });

    const error = await requestDaySuggestions({ context, prompt: "museums", mode: "car", client }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AiSuggestionError);
    expect((error as Error).message).not.toContain("upstream secret detail");
    // The SDK class and status survive for the log line; the upstream text does not.
    expect(error).toMatchObject({ status: 500, upstream: "APIError" });
  });

  it("times out after 60 s in total and fails with ai_failed", async () => {
    vi.useFakeTimers();
    const create = vi.fn(
      (_params: unknown, options: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () => reject(new Anthropic.APIUserAbortError()));
        }),
    );
    const client = { messages: { create } } as unknown as Anthropic;

    const pending = requestDaySuggestions({ context, prompt: "museums", mode: "car", client });
    const assertion = expect(pending).rejects.toMatchObject({ code: "ai_failed" });
    await vi.advanceTimersByTimeAsync(59_999);
    expect(create).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
  });

  it("rethrows a non-SDK error so the route answers 500, not 502", async () => {
    const { client } = fakeClient(async () => {
      throw new TypeError("a bug");
    });

    await expect(requestDaySuggestions({ context, prompt: "museums", mode: "car", client })).rejects.toBeInstanceOf(TypeError);
  });
});

/**
 * Story 8.7. What a search consumed, reported once from the service's `finally` through `onUsage` - summed
 * over the first request and every `pause_turn` resumption, counted before any check that could throw.
 */
describe("requestDaySuggestions usage", () => {
  beforeEach(() => {
    delete process.env.ANTHROPIC_MODEL;
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  const withUsage = <T extends FakeResponse>(
    response: T,
    usage: {
      input_tokens: number;
      output_tokens: number;
      cache_creation_input_tokens?: number | null;
      cache_read_input_tokens?: number | null;
      server_tool_use?: { web_search_requests: number } | null;
    },
  ) => ({ ...response, usage });

  const pausedSearch = { stop_reason: "pause_turn", content: [{ type: "server_tool_use", id: "s1", name: "web_search", input: {} }] };

  const collect = () => {
    const calls: AiSearchUsage[] = [];
    return { calls, onUsage: (usage: AiSearchUsage) => calls.push(usage) };
  };

  it("sends cache_control on the first call and on every resumed call", async () => {
    const { client, create } = fakeClient(pausedSearch, endTurn(answer(3)));

    await requestDaySuggestions({ context, prompt: "museums", mode: "car", client });

    expect(create).toHaveBeenCalledTimes(2);
    for (const call of create.mock.calls) {
      expect((call as unknown as [Record<string, unknown>])[0].cache_control).toEqual({ type: "ephemeral" });
    }
  });

  it("sums the usage over a pause_turn and the final response, null cache fields counting as 0", async () => {
    const { client } = fakeClient(
      withUsage(pausedSearch, {
        input_tokens: 1000,
        output_tokens: 50,
        cache_creation_input_tokens: 800,
        cache_read_input_tokens: 0,
        server_tool_use: { web_search_requests: 3 },
      }),
      withUsage(endTurn(answer(3)), {
        input_tokens: 200,
        output_tokens: 400,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: 1500,
        server_tool_use: { web_search_requests: 2 },
      }),
    );
    const { calls, onUsage } = collect();

    const suggestions = await requestDaySuggestions({ context, prompt: "museums", mode: "car", client, onUsage });

    expect(suggestions).toHaveLength(3);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      model: "claude-sonnet-5-5",
      outcome: "ok",
      inputTokens: 1200,
      cacheCreationInputTokens: 800,
      cacheReadInputTokens: 1500,
      outputTokens: 450,
      webSearchRequests: 5,
    });
    expect(calls[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it("carries exactly the AC2 fields - nothing from the prompt or the answer", async () => {
    const { client } = fakeClient(withUsage(endTurn(answer(3)), { input_tokens: 10, output_tokens: 20 }));
    const { calls, onUsage } = collect();

    await requestDaySuggestions({ context, prompt: "a secret wish", mode: "car", client, onUsage });

    expect(Object.keys(calls[0]).sort()).toEqual(
      [
        "cacheCreationInputTokens",
        "cacheReadInputTokens",
        "durationMs",
        "inputTokens",
        "model",
        "outcome",
        "outputTokens",
        "webSearchRequests",
      ].sort(),
    );
    expect(JSON.stringify(calls[0])).not.toContain("secret wish");
    expect(JSON.stringify(calls[0])).not.toContain("Stop 1");
  });

  it("reports the model from ANTHROPIC_MODEL", async () => {
    process.env.ANTHROPIC_MODEL = "claude-test-model";
    const { client } = fakeClient(endTurn(answer(3)));
    const { calls, onUsage } = collect();

    await requestDaySuggestions({ context, prompt: "museums", mode: "car", client, onUsage });

    expect(calls[0].model).toBe("claude-test-model");
  });

  it("reports failed with zero counts when the first call rejects before any response", async () => {
    const { client } = fakeClient(async () => {
      throw new Anthropic.APIConnectionTimeoutError();
    });
    const { calls, onUsage } = collect();

    await expect(requestDaySuggestions({ context, prompt: "museums", mode: "car", client, onUsage })).rejects.toMatchObject({
      code: "ai_failed",
    });

    expect(calls).toEqual([
      expect.objectContaining({
        outcome: "failed",
        inputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        outputTokens: 0,
        webSearchRequests: 0,
      }),
    ]);
  });

  it("keeps the first response's counts when the resumption rejects", async () => {
    const { client } = fakeClient(
      withUsage(pausedSearch, { input_tokens: 700, output_tokens: 30, server_tool_use: { web_search_requests: 2 } }),
      async () => {
        throw new Anthropic.APIError(529, undefined, "overloaded", new Headers());
      },
    );
    const { calls, onUsage } = collect();

    await expect(requestDaySuggestions({ context, prompt: "museums", mode: "car", client, onUsage })).rejects.toMatchObject({
      code: "ai_failed",
    });

    expect(calls).toEqual([expect.objectContaining({ outcome: "failed", inputTokens: 700, outputTokens: 30, webSearchRequests: 2 })]);
  });

  it.each([
    ["a schema miss", withUsage(endTurn(answer(2)), { input_tokens: 300, output_tokens: 90 })],
    ["a refusal", withUsage({ stop_reason: "refusal", content: [{ type: "text", text: "no" }] }, { input_tokens: 300, output_tokens: 90 })],
    ["text that is not JSON", withUsage(endTurn("Here are some ideas!"), { input_tokens: 300, output_tokens: 90 })],
  ])("counts a paid response that ends in %s as failed with its counts", async (_label, response) => {
    const { client } = fakeClient(response);
    const { calls, onUsage } = collect();

    await expect(requestDaySuggestions({ context, prompt: "museums", mode: "car", client, onUsage })).rejects.toBeInstanceOf(
      AiSuggestionError,
    );

    expect(calls).toEqual([expect.objectContaining({ outcome: "failed", inputTokens: 300, outputTokens: 90 })]);
  });

  it("reports a rethrown bug as failed, once", async () => {
    const { client } = fakeClient(async () => {
      throw new TypeError("a bug");
    });
    const { calls, onUsage } = collect();

    await expect(requestDaySuggestions({ context, prompt: "museums", mode: "car", client, onUsage })).rejects.toBeInstanceOf(
      TypeError,
    );

    expect(calls).toEqual([expect.objectContaining({ outcome: "failed" })]);
  });

  it("does not let a throwing onUsage change the returned suggestions", async () => {
    const { client } = fakeClient(endTurn(answer(3)));
    const onUsage = vi.fn(() => {
      throw new Error("callback broke");
    });

    const suggestions = await requestDaySuggestions({ context, prompt: "museums", mode: "car", client, onUsage });

    expect(suggestions).toHaveLength(3);
    expect(onUsage).toHaveBeenCalledTimes(1);
  });

  it("does not let a throwing onUsage replace the search's own error", async () => {
    const { client } = fakeClient(endTurn("not json"));
    const onUsage = vi.fn(() => {
      throw new TypeError("callback broke");
    });

    await expect(requestDaySuggestions({ context, prompt: "museums", mode: "car", client, onUsage })).rejects.toMatchObject({
      code: "ai_failed",
    });
    expect(onUsage).toHaveBeenCalledTimes(1);
  });
});
