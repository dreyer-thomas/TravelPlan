import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { deleteUserForAdmin } from "@/lib/repositories/adminUserRepo";
import { createAiUsageRecord, getEarliestAiUsageAt, listAiUsageForRange } from "@/lib/repositories/aiUsageRepo";
import type { AiSearchUsage } from "@/lib/ai/daySuggestionService";

/** Story 8.7. The usage records' repository, and AC7: a deleted account keeps its history. */

const usage: AiSearchUsage = {
  model: "claude-sonnet-5-5",
  outcome: "ok",
  durationMs: 4200,
  inputTokens: 10,
  cacheCreationInputTokens: 20,
  cacheReadInputTokens: 30,
  outputTokens: 40,
  webSearchRequests: 2,
};

const createUser = (email: string) => prisma.user.create({ data: { email, passwordHash: "hashed" } });

describe("aiUsageRepo", () => {
  beforeEach(async () => {
    await prisma.aiUsageRecord.deleteMany();
    await prisma.tripMember.deleteMany();
    await prisma.tripDay.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
  });

  it("stores every count and lists the records of a range with the account's email", async () => {
    const user = await createUser("usage@example.com");
    await createAiUsageRecord(user.id, usage);

    const rows = await listAiUsageForRange(new Date(Date.now() - 60_000), new Date(Date.now() + 60_000));

    // Duration is stored but not read back for the month view.
    const { durationMs: _durationMs, ...counts } = usage;
    expect(rows).toEqual([{ userId: user.id, user: { email: "usage@example.com" }, ...counts }]);
    expect((await prisma.aiUsageRecord.findFirstOrThrow()).durationMs).toBe(4200);
    expect(await listAiUsageForRange(new Date(Date.now() + 60_000), new Date(Date.now() + 120_000))).toEqual([]);
  });

  it("answers the earliest record time, or null without records", async () => {
    expect(await getEarliestAiUsageAt()).toBeNull();
    const user = await createUser("usage@example.com");
    await prisma.aiUsageRecord.create({ data: { ...usage, userId: user.id, createdAt: new Date(2026, 0, 5) } });
    await createAiUsageRecord(user.id, usage);

    expect(await getEarliestAiUsageAt()).toEqual(new Date(2026, 0, 5));
  });

  it("keeps a deleted account's records, with userId cleared (AC7)", async () => {
    const user = await createUser("leaving@example.com");
    await createAiUsageRecord(user.id, usage);
    await createAiUsageRecord(user.id, { ...usage, outcome: "failed" });

    const result = await deleteUserForAdmin({ userId: user.id });

    expect(result.outcome).toBe("deleted");
    const rows = await prisma.aiUsageRecord.findMany();
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.userId === null)).toBe(true);
  });
});
