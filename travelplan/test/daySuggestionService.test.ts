import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { AiSuggestionError, requestDaySuggestions } from "@/lib/ai/daySuggestionService";
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
