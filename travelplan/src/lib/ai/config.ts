import "server-only";

/**
 * Story 12.1. The AI day-suggestion settings, all read from the environment **on every call** rather than
 * at module load, so a test can set and unset a variable per case and an operator's change applies on the
 * next restart without a rebuild.
 *
 * `ANTHROPIC_API_KEY` is read here and nowhere else in the app. It never leaves `lib/ai/`: the day page
 * learns only `isAiSuggestionsEnabled()`'s boolean, and nothing logs the value.
 */

export const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-5-5";
export const DEFAULT_DAILY_LIMIT = 20;

export const getAnthropicApiKey = () => process.env.ANTHROPIC_API_KEY?.trim() ?? "";

/** The capability flag: without a key the feature is off, and the endpoint answers `503 ai_unavailable`. */
export const isAiSuggestionsEnabled = () => getAnthropicApiKey().length > 0;

export const getAnthropicModel = () => process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_ANTHROPIC_MODEL;

/** Searches per user per server-local day. Anything but a positive whole number falls back to 20. */
export const getDailyLimit = () => {
  const raw = process.env.AI_SUGGESTIONS_DAILY_LIMIT?.trim() ?? "";
  if (!/^\d+$/.test(raw)) {
    return DEFAULT_DAILY_LIMIT;
  }
  const value = Number(raw);
  return value > 0 ? value : DEFAULT_DAILY_LIMIT;
};

/**
 * Story 8.7. What one model costs, in USD (Anthropic bills in USD; nothing here converts). A constant, not
 * env: it changes when Anthropic's price list does, and that is a code change with a date on it.
 *
 * Used only at display time (`usageSummary.ts`) - no price is stored on a usage record, so a change here
 * re-prices every past month without a migration. `cacheWritePerMTok` is the **5-minute** write, the
 * default TTL of `cache_control: { type: "ephemeral" }`.
 *
 * `longPrompt` (Story 12.5) is a second rate card for prompts above `aboveInputTokens` (input + cache
 * write + cache read). Anthropic applies it per request; a usage record sums every request of one search,
 * so `usageSummary.ts` applies it to the whole record once the record's total prompt is above the
 * threshold. That can over-estimate a search with resumptions whose requests were each below it - the
 * safe side for an estimate.
 */
export type AiModelRates = {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheWritePerMTok: number;
  cacheReadPerMTok: number;
};

export type AiModelPrice = AiModelRates & {
  webSearchPerSearch: number;
  longPrompt?: AiModelRates & { aboveInputTokens: number };
};

// Checked against Anthropic's pricing page (platform.claude.com/docs/en/about-claude/pricing) on 2026-10-19:
// Sonnet 5.5 $2 input, $2.50 5m cache write, $0.10 cache hit (0.05x input), $10 output. Haiku 5.5 for
// prompts up to 100,000 tokens $0.10 input, $0.125 5m cache write, $0.01 cache hit, $0.50 output; over
// 100,000 tokens $0.50, $0.625, $0.05, $2.50. Web search $10 per 1,000 searches on both.
export const AI_MODEL_PRICES: Readonly<Record<string, AiModelPrice>> = {
  "claude-haiku-5-5": {
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
  },
  "claude-sonnet-5-5": {
    inputPerMTok: 2,
    outputPerMTok: 10,
    cacheWritePerMTok: 2.5,
    cacheReadPerMTok: 0.1,
    webSearchPerSearch: 0.01,
  },
};

/** The price entry for a model id, or `null` when the table has none (its cost is then left out, not guessed). */
export const getModelPrice = (model: string): AiModelPrice | null =>
  Object.hasOwn(AI_MODEL_PRICES, model) ? AI_MODEL_PRICES[model] : null;
