import "server-only";

/**
 * Story 12.1. The AI day-suggestion settings, all read from the environment **on every call** rather than
 * at module load, so a test can set and unset a variable per case and an operator's change applies on the
 * next restart without a rebuild.
 *
 * `ANTHROPIC_API_KEY` is read here and nowhere else in the app. It never leaves `lib/ai/`: the day page
 * learns only `isAiSuggestionsEnabled()`'s boolean, and nothing logs the value.
 */

export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5-5";
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
