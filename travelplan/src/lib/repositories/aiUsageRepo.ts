import { prisma } from "@/lib/db/prisma";
import type { AiSearchUsage } from "@/lib/ai/daySuggestionService";

/**
 * Story 8.7. The AI usage records: one row per day search that reached Claude, counts only.
 *
 * Not tenancy-scoped, like `adminUserRepo`: the reads serve the admin-only page, and the proof that the
 * caller may see them is `requireAdmin` in the route. The write is the suggestions route's, for the
 * signed-in caller it has already authenticated.
 */

export const createAiUsageRecord = (userId: string, usage: AiSearchUsage) =>
  prisma.aiUsageRecord.create({
    data: {
      userId,
      model: usage.model,
      outcome: usage.outcome,
      durationMs: usage.durationMs,
      inputTokens: usage.inputTokens,
      cacheCreationInputTokens: usage.cacheCreationInputTokens,
      cacheReadInputTokens: usage.cacheReadInputTokens,
      outputTokens: usage.outputTokens,
      webSearchRequests: usage.webSearchRequests,
    },
    select: { id: true },
  });

export type AiUsageRow = {
  userId: string | null;
  model: string;
  outcome: "ok" | "failed";
  inputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  outputTokens: number;
  webSearchRequests: number;
  /** `null` once the account is deleted - the row stays, its `userId` is cleared (AC7). */
  user: { email: string } | null;
};

/** The records created in `[from, to)`, with only the counts and the account's email. */
export const listAiUsageForRange = (from: Date, to: Date): Promise<AiUsageRow[]> =>
  prisma.aiUsageRecord.findMany({
    where: { createdAt: { gte: from, lt: to } },
    select: {
      userId: true,
      model: true,
      outcome: true,
      inputTokens: true,
      cacheCreationInputTokens: true,
      cacheReadInputTokens: true,
      outputTokens: true,
      webSearchRequests: true,
      user: { select: { email: true } },
    },
  });

/** When the first record was written, or `null` when there is none - the month picker's lower bound. */
export const getEarliestAiUsageAt = async () => {
  const result = await prisma.aiUsageRecord.aggregate({ _min: { createdAt: true } });
  return result._min.createdAt;
};
