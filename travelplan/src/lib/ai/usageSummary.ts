import type { AiModelPrice } from "@/lib/ai/config";
import type { AiUsageRow } from "@/lib/repositories/aiUsageRepo";

/**
 * Story 8.7. The month view's arithmetic: totals, cache-read share and an estimated cost from stored counts
 * and a price table. Pure - the price lookup is passed in, so tests run on round numbers and a price change
 * re-prices past months without touching a record.
 *
 * Money is USD, Anthropic's billing currency, and it is an estimate: the console is the bill.
 */

export type AiUsageTotals = {
  searches: number;
  failed: number;
  inputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  outputTokens: number;
  webSearchRequests: number;
};

export type AiUsagePerUser = {
  /** `null` for every deleted account, merged into one row. */
  userId: string | null;
  email: string | null;
  searches: number;
  /** The searches whose model has a price; `estimatedCostUsd` covers these only. */
  pricedSearches: number;
  estimatedCostUsd: number;
};

export type AiUsageSummary = {
  totals: AiUsageTotals;
  /** `cache_read / (input + cache_creation + cache_read)`, or `null` when there was no input at all. */
  cacheReadShare: number | null;
  /** The priced records only; see `unpricedModels`. */
  estimatedCostUsd: number;
  /**
   * Divided by every priced search, failed ones included - they were paid for too. An unpriced search adds
   * no cost, so counting it would pull the average down. `null` when no search in the month has a price.
   */
  costPerSearchUsd: number | null;
  /** Models that had records but no price entry: their counts are in the totals, their cost is not. */
  unpricedModels: string[];
  perUser: AiUsagePerUser[];
};

const recordCost = (row: AiUsageRow, price: AiModelPrice) =>
  (row.inputTokens * price.inputPerMTok +
    row.cacheCreationInputTokens * price.cacheWritePerMTok +
    row.cacheReadInputTokens * price.cacheReadPerMTok +
    row.outputTokens * price.outputPerMTok) /
    1e6 +
  row.webSearchRequests * price.webSearchPerSearch;

export const summarizeAiUsage = (
  rows: AiUsageRow[],
  getPrice: (model: string) => AiModelPrice | null,
): AiUsageSummary => {
  const totals: AiUsageTotals = {
    searches: 0,
    failed: 0,
    inputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    outputTokens: 0,
    webSearchRequests: 0,
  };
  let estimatedCostUsd = 0;
  let pricedSearches = 0;
  const unpriced = new Set<string>();
  const perUser = new Map<string | null, AiUsagePerUser>();

  for (const row of rows) {
    totals.searches += 1;
    if (row.outcome === "failed") totals.failed += 1;
    totals.inputTokens += row.inputTokens;
    totals.cacheCreationInputTokens += row.cacheCreationInputTokens;
    totals.cacheReadInputTokens += row.cacheReadInputTokens;
    totals.outputTokens += row.outputTokens;
    totals.webSearchRequests += row.webSearchRequests;

    const price = getPrice(row.model);
    const cost = price ? recordCost(row, price) : 0;
    if (price) pricedSearches += 1;
    else unpriced.add(row.model);
    estimatedCostUsd += cost;

    const entry = perUser.get(row.userId) ?? {
      userId: row.userId,
      email: row.user?.email ?? null,
      searches: 0,
      pricedSearches: 0,
      estimatedCostUsd: 0,
    };
    entry.searches += 1;
    if (price) entry.pricedSearches += 1;
    entry.estimatedCostUsd += cost;
    perUser.set(row.userId, entry);
  }

  const totalInput = totals.inputTokens + totals.cacheCreationInputTokens + totals.cacheReadInputTokens;

  return {
    totals,
    cacheReadShare: totalInput > 0 ? totals.cacheReadInputTokens / totalInput : null,
    estimatedCostUsd,
    costPerSearchUsd: pricedSearches > 0 ? estimatedCostUsd / pricedSearches : null,
    unpricedModels: [...unpriced].sort(),
    perUser: [...perUser.values()].sort(
      (a, b) => b.estimatedCostUsd - a.estimatedCostUsd || b.searches - a.searches,
    ),
  };
};

/**
 * Months are server-local, like the daily limit's day (`dailyLimit.ts`): built with `new Date(y, m, 1)`,
 * never from an ISO string, which would be UTC.
 */
const parseMonthKey = (month: string) => {
  const [year, monthNumber] = month.split("-").map(Number);
  return { year, monthIndex: monthNumber - 1 };
};

const toMonthKey = (year: number, monthIndex: number) => `${year}-${String(monthIndex + 1).padStart(2, "0")}`;

/** The server-local `[from, to)` of a `YYYY-MM` month. */
export const monthRange = (month: string) => {
  const { year, monthIndex } = parseMonthKey(month);
  return { from: new Date(year, monthIndex, 1), to: new Date(year, monthIndex + 1, 1) };
};

export const currentMonthKey = (now: Date) => toMonthKey(now.getFullYear(), now.getMonth());

/** Every month from `earliest` to `latest`, both included, newest first. */
export const monthsBetween = (earliest: string, latest: string) => {
  const start = parseMonthKey(earliest);
  const end = parseMonthKey(latest);
  const months: string[] = [];
  for (let index = end.year * 12 + end.monthIndex; index >= start.year * 12 + start.monthIndex; index -= 1) {
    months.push(toMonthKey(Math.floor(index / 12), index % 12));
  }
  return months;
};
