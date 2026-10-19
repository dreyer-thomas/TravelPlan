import { afterEach, describe, expect, it } from "vitest";
import { getAnthropicModel, getDailyLimit, getModelPrice, isAiSuggestionsEnabled } from "@/lib/ai/config";
import { consumeDailySearch } from "@/lib/ai/dailyLimit";

const ENV_KEYS = ["ANTHROPIC_API_KEY", "ANTHROPIC_MODEL", "AI_SUGGESTIONS_DAILY_LIMIT"] as const;
const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = saved[key];
    }
  }
});

describe("isAiSuggestionsEnabled", () => {
  it("is false when the key is unset, empty or whitespace", () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(isAiSuggestionsEnabled()).toBe(false);
    process.env.ANTHROPIC_API_KEY = "";
    expect(isAiSuggestionsEnabled()).toBe(false);
    process.env.ANTHROPIC_API_KEY = "   ";
    expect(isAiSuggestionsEnabled()).toBe(false);
  });

  it("is true when a key is set, read on every call", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    expect(isAiSuggestionsEnabled()).toBe(true);
    delete process.env.ANTHROPIC_API_KEY;
    expect(isAiSuggestionsEnabled()).toBe(false);
  });
});

describe("getAnthropicModel", () => {
  it("defaults to claude-haiku-5-5 and trims an override", () => {
    delete process.env.ANTHROPIC_MODEL;
    expect(getAnthropicModel()).toBe("claude-haiku-5-5");
    process.env.ANTHROPIC_MODEL = "   ";
    expect(getAnthropicModel()).toBe("claude-haiku-5-5");
    process.env.ANTHROPIC_MODEL = "  claude-opus-5-5 ";
    expect(getAnthropicModel()).toBe("claude-opus-5-5");
  });
});

describe("getModelPrice", () => {
  it("prices the shipped Haiku default, with its long-prompt rate above 100K", () => {
    expect(getModelPrice("claude-haiku-5-5")).toEqual({
      inputPerMTok: 0.1,
      outputPerMTok: 0.5,
      cacheWritePerMTok: 0.125,
      cacheReadPerMTok: 0.01,
      webSearchPerSearch: 0.01,
      longPrompt: {
        aboveInputTokens: 100_000,
        inputPerMTok: 0.5,
        outputPerMTok: 2.5,
        cacheWritePerMTok: 0.625,
        cacheReadPerMTok: 0.05,
      },
    });
  });

  it("keeps the Sonnet entry and knows no other model", () => {
    expect(getModelPrice("claude-sonnet-5-5")).toMatchObject({ inputPerMTok: 2, cacheReadPerMTok: 0.1 });
    expect(getModelPrice("claude-sonnet-5-5")).not.toHaveProperty("longPrompt");
    expect(getModelPrice("claude-unknown")).toBeNull();
  });
});

describe("getDailyLimit", () => {
  it.each([
    [undefined, 20],
    ["", 20],
    ["abc", 20],
    ["0", 20],
    ["-3", 20],
    ["2.5", 20],
    ["5", 5],
    [" 40 ", 40],
  ])("reads %s as %s", (raw, expected) => {
    if (raw === undefined) {
      delete process.env.AI_SUGGESTIONS_DAILY_LIMIT;
    } else {
      process.env.AI_SUGGESTIONS_DAILY_LIMIT = raw;
    }
    expect(getDailyLimit()).toBe(expected);
  });
});

describe("consumeDailySearch", () => {
  let counter = 0;
  const freshUser = () => `daily-limit-user-${Date.now()}-${counter++}`;

  it("allows the configured number of searches per user and refuses the next", () => {
    process.env.AI_SUGGESTIONS_DAILY_LIMIT = "2";
    const user = freshUser();
    const now = new Date(2026, 9, 16, 10, 0, 0);

    expect(consumeDailySearch(user, now).ok).toBe(true);
    expect(consumeDailySearch(user, now).ok).toBe(true);
    expect(consumeDailySearch(user, now).ok).toBe(false);
    // Per user, not shared.
    expect(consumeDailySearch(freshUser(), now).ok).toBe(true);
  });

  it("starts a new count on the next server-local day", () => {
    process.env.AI_SUGGESTIONS_DAILY_LIMIT = "1";
    const user = freshUser();

    expect(consumeDailySearch(user, new Date(2026, 9, 16, 23, 59, 0)).ok).toBe(true);
    expect(consumeDailySearch(user, new Date(2026, 9, 16, 23, 59, 30)).ok).toBe(false);
    expect(consumeDailySearch(user, new Date(2026, 9, 17, 0, 0, 1)).ok).toBe(true);
  });
});
