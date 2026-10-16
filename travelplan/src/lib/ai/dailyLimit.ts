import "server-only";
import { checkRateLimit } from "@/lib/security/rateLimit";
import { getDailyLimit } from "@/lib/ai/config";

/**
 * Story 12.1. "At most N searches per user since midnight", on the existing fixed-window limiter.
 *
 * `checkRateLimit` has no notion of a calendar day, so the day is put in the **key**
 * (`ai-suggestions:<userId>:<YYYY-MM-DD>`, server-local) and the window is the time left until the next
 * local midnight. A new day is a new key, so the count restarts at midnight without a reset hook, and the
 * old entry simply expires. The `ai-suggestions:` prefix keeps these entries apart from the auth limits
 * that share the same store.
 *
 * The count lives in process memory, like the auth limits: a restart forgets it. That is acceptable for a
 * guard against runaway use; the Anthropic console's spend limit is the real cost cap.
 *
 * The route calls this only once access and validation have passed, immediately before the model call,
 * so only searches that reach Claude count - and a failed model call still counts, because it was paid
 * for.
 */
const localDateKey = (now: Date) =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

const msUntilNextLocalMidnight = (now: Date) => {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return Math.max(1, midnight.getTime() - now.getTime());
};

export const consumeDailySearch = (userId: string, now = new Date()) => {
  const result = checkRateLimit(`ai-suggestions:${userId}:${localDateKey(now)}`, getDailyLimit(), msUntilNextLocalMidnight(now));
  return { ok: result.ok };
};
