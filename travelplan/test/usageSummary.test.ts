import { describe, expect, it } from "vitest";
import type { AiModelPrice } from "@/lib/ai/config";
import type { AiUsageRow } from "@/lib/repositories/aiUsageRepo";
import { currentMonthKey, monthRange, monthsBetween, summarizeAiUsage } from "@/lib/ai/usageSummary";

/** Story 8.7. The month view's arithmetic, on a test price table so the expected numbers are round. */

const PRICES: Record<string, AiModelPrice> = {
  priced: { inputPerMTok: 2, outputPerMTok: 10, cacheWritePerMTok: 3, cacheReadPerMTok: 0.5, webSearchPerSearch: 0.01 },
};
const getPrice = (model: string) => PRICES[model] ?? null;

const row = (overrides: Partial<AiUsageRow> = {}): AiUsageRow => ({
  userId: "u1",
  model: "priced",
  outcome: "ok",
  inputTokens: 1_000_000,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
  outputTokens: 0,
  webSearchRequests: 0,
  user: { email: "a@example.com" },
  ...overrides,
});

describe("summarizeAiUsage", () => {
  it("adds up searches, failures, the four token counts and web searches", () => {
    const summary = summarizeAiUsage(
      [
        row({ inputTokens: 100, cacheCreationInputTokens: 20, cacheReadInputTokens: 30, outputTokens: 40, webSearchRequests: 2 }),
        row({ outcome: "failed", inputTokens: 1, cacheCreationInputTokens: 2, cacheReadInputTokens: 3, outputTokens: 4, webSearchRequests: 5 }),
      ],
      getPrice,
    );

    expect(summary.totals).toEqual({
      searches: 2,
      failed: 1,
      inputTokens: 101,
      cacheCreationInputTokens: 22,
      cacheReadInputTokens: 33,
      outputTokens: 44,
      webSearchRequests: 7,
    });
  });

  it("computes the cache-read share over all input, and null when there is no input", () => {
    const share = summarizeAiUsage([row({ inputTokens: 100, cacheCreationInputTokens: 100, cacheReadInputTokens: 200 })], getPrice);
    expect(share.cacheReadShare).toBe(0.5);

    const none = summarizeAiUsage([row({ inputTokens: 0 })], getPrice);
    expect(none.cacheReadShare).toBeNull();
  });

  it("prices each record by the formula, and divides by every search for the per-search cost", () => {
    const summary = summarizeAiUsage(
      [
        // 1M input × 2 + 1M write × 3 + 2M read × 0.5 + 0.5M output × 10 = 2 + 3 + 1 + 5 = 11, + 4 searches × 0.01
        row({
          inputTokens: 1_000_000,
          cacheCreationInputTokens: 1_000_000,
          cacheReadInputTokens: 2_000_000,
          outputTokens: 500_000,
          webSearchRequests: 4,
        }),
        row({ outcome: "failed", inputTokens: 0 }),
      ],
      getPrice,
    );

    expect(summary.estimatedCostUsd).toBeCloseTo(11.04, 10);
    expect(summary.costPerSearchUsd).toBeCloseTo(5.52, 10);
    expect(summary.unpricedModels).toEqual([]);
  });

  it("counts an unpriced model's tokens but not its cost, and names it", () => {
    const summary = summarizeAiUsage([row(), row({ model: "mystery", inputTokens: 5 }), row({ model: "mystery" })], getPrice);

    expect(summary.totals.searches).toBe(3);
    expect(summary.totals.inputTokens).toBe(2_000_005);
    expect(summary.estimatedCostUsd).toBeCloseTo(2, 10);
    // Per search over the one priced search only - the unpriced ones add no cost to divide.
    expect(summary.costPerSearchUsd).toBeCloseTo(2, 10);
    expect(summary.unpricedModels).toEqual(["mystery"]);
    expect(summary.perUser).toEqual([
      expect.objectContaining({ userId: "u1", searches: 3, pricedSearches: 1 }),
    ]);
  });

  it("merges every deleted account into one row and sorts by cost, then searches", () => {
    const summary = summarizeAiUsage(
      [
        row({ userId: "cheap", user: { email: "cheap@example.com" }, inputTokens: 1 }),
        row({ userId: "cheap", user: { email: "cheap@example.com" }, inputTokens: 1 }),
        row({ userId: "rich", user: { email: "rich@example.com" }, inputTokens: 3_000_000 }),
        row({ userId: "tied", user: { email: "tied@example.com" }, inputTokens: 1 }),
        row({ userId: null, user: null, inputTokens: 500_000 }),
        row({ userId: null, user: null, inputTokens: 500_000 }),
      ],
      getPrice,
    );

    expect(summary.perUser.map((entry) => [entry.userId, entry.email, entry.searches])).toEqual([
      ["rich", "rich@example.com", 1],
      [null, null, 2],
      ["cheap", "cheap@example.com", 2],
      ["tied", "tied@example.com", 1],
    ]);
    expect(summary.perUser[1].estimatedCostUsd).toBeCloseTo(2, 10);
  });

  it("has no per-search cost when no search in the month is priced", () => {
    const summary = summarizeAiUsage([row({ model: "mystery" })], getPrice);

    expect(summary.totals.searches).toBe(1);
    expect(summary.costPerSearchUsd).toBeNull();
  });

  it("answers an empty month with zero searches and no per-user rows", () => {
    const summary = summarizeAiUsage([], getPrice);

    expect(summary.totals.searches).toBe(0);
    expect(summary.costPerSearchUsd).toBeNull();
    expect(summary.cacheReadShare).toBeNull();
    expect(summary.perUser).toEqual([]);
  });
});

describe("months", () => {
  it("builds server-local [from, to) boundaries", () => {
    const { from, to } = monthRange("2026-10");
    expect(from).toEqual(new Date(2026, 9, 1));
    expect(to).toEqual(new Date(2026, 10, 1));
  });

  it("rolls December over into January of the next year", () => {
    const { from, to } = monthRange("2026-12");
    expect(from).toEqual(new Date(2026, 11, 1));
    expect(to).toEqual(new Date(2027, 0, 1));
  });

  it("names the current month from local time", () => {
    expect(currentMonthKey(new Date(2026, 0, 31, 23, 59))).toBe("2026-01");
    expect(currentMonthKey(new Date(2026, 11, 1, 0, 0))).toBe("2026-12");
  });

  it("lists months from the earliest to the current one, newest first", () => {
    expect(monthsBetween("2025-11", "2026-02")).toEqual(["2026-02", "2026-01", "2025-12", "2025-11"]);
    expect(monthsBetween("2026-10", "2026-10")).toEqual(["2026-10"]);
  });
});
