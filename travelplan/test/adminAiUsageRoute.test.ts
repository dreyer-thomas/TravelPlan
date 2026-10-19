import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/admin/ai-usage/route";
import { createSessionJwt } from "@/lib/auth/jwt";
import { prisma } from "@/lib/db/prisma";
import { currentMonthKey } from "@/lib/ai/usageSummary";
import type { AiUsageSummary } from "@/lib/ai/usageSummary";

/** Story 8.7, AC9-AC11. The month view's API, on the real per-worker SQLite database. */

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

type Body = { month: string; months: string[]; summary: AiUsageSummary };

const createUser = (email: string, role: "OWNER" | "VIEWER" | "ADMIN" = "OWNER") =>
  prisma.user.create({ data: { email, passwordHash: "hashed", role } });

const sessionFor = (user: { id: string; role: string }) => createSessionJwt({ sub: user.id, role: user.role });

const read = async (session?: string, query = "") => {
  const response = await GET(
    new NextRequest(`http://localhost/api/admin/ai-usage${query}`, {
      headers: session ? { cookie: `session=${session}` } : {},
    }),
  );
  return { response, payload: (await response.json()) as ApiEnvelope<Body> };
};

const record = (userId: string | null, createdAt: Date, inputTokens = 1000) =>
  prisma.aiUsageRecord.create({
    data: { userId, createdAt, model: "claude-sonnet-5-5", outcome: "ok", durationMs: 5000, inputTokens },
  });

// Pinned mid-month, so a run that crosses a month boundary cannot split "this month" between the test
// and the route. Only `Date` is faked; timers stay real for Prisma.
const now = (() => {
  const real = new Date();
  return new Date(real.getFullYear(), real.getMonth(), 15, 12);
})();
const thisMonth = currentMonthKey(now);
const monthsAgo = (count: number) => new Date(now.getFullYear(), now.getMonth() - count, 15, 12);

describe("GET /api/admin/ai-usage", () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"], now });
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  beforeEach(async () => {
    await prisma.aiUsageRecord.deleteMany();
    await prisma.tripMember.deleteMany();
    await prisma.tripDay.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
  });

  it("answers 401 signed out", async () => {
    const { response } = await read();
    expect(response.status).toBe(401);
  });

  it("answers 403 forbidden to a signed-in non-admin", async () => {
    const owner = await createUser("owner@example.com");
    const { response, payload } = await read(await sessionFor(owner));

    expect(response.status).toBe(403);
    expect(payload.error?.code).toBe("forbidden");
    expect(payload.data).toBeNull();
  });

  it("answers an admin with the current month by default, no-store", async () => {
    const admin = await createUser("admin@example.com", "ADMIN");
    await record(admin.id, new Date());

    const { response, payload } = await read(await sessionFor(admin));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(payload.data?.month).toBe(thisMonth);
    expect(payload.data?.months).toEqual([thisMonth]);
    expect(payload.data?.summary.totals.searches).toBe(1);
    expect(payload.data?.summary.perUser).toEqual([
      expect.objectContaining({ userId: admin.id, email: "admin@example.com", searches: 1 }),
    ]);
    expect(payload.data?.summary.estimatedCostUsd).toBeGreaterThan(0);
  });

  it("lists months from the earliest record to now, and shows only the asked month's records", async () => {
    const admin = await createUser("admin@example.com", "ADMIN");
    await record(admin.id, monthsAgo(2), 111);
    await record(admin.id, monthsAgo(1), 222);
    await record(admin.id, new Date(), 333);
    const twoAgo = currentMonthKey(monthsAgo(2));

    const { payload } = await read(await sessionFor(admin), `?month=${twoAgo}`);

    expect(payload.data?.months).toEqual([thisMonth, currentMonthKey(monthsAgo(1)), twoAgo]);
    expect(payload.data?.month).toBe(twoAgo);
    expect(payload.data?.summary.totals).toMatchObject({ searches: 1, inputTokens: 111 });
  });

  it("offers just the current month when there are no records", async () => {
    const admin = await createUser("admin@example.com", "ADMIN");

    const { payload } = await read(await sessionFor(admin));

    expect(payload.data?.months).toEqual([thisMonth]);
    expect(payload.data?.summary.totals.searches).toBe(0);
  });

  it("offers an asked month before the earliest record, so the picker lists the month it shows", async () => {
    const admin = await createUser("admin@example.com", "ADMIN");
    await record(admin.id, new Date());
    const threeAgo = currentMonthKey(monthsAgo(3));

    const { payload } = await read(await sessionFor(admin), `?month=${threeAgo}`);

    expect(payload.data?.month).toBe(threeAgo);
    expect(payload.data?.months).toEqual([0, 1, 2, 3].map((count) => currentMonthKey(monthsAgo(count))));
    expect(payload.data?.summary.totals.searches).toBe(0);
  });

  it("still offers the current month when the earliest record is dated after it", async () => {
    const admin = await createUser("admin@example.com", "ADMIN");
    await record(admin.id, monthsAgo(-2));

    const { payload } = await read(await sessionFor(admin));

    expect(payload.data?.months).toEqual([thisMonth]);
  });

  it.each(["2026-13", "2026-1", "abc", "2026-10-01", "0050-03", "0999-12"])("answers 400 validation_error for a malformed month %s", async (month) => {
    const admin = await createUser("admin@example.com", "ADMIN");

    const { response, payload } = await read(await sessionFor(admin), `?month=${month}`);

    expect(response.status).toBe(400);
    expect(payload.error?.code).toBe("validation_error");
  });

  it("answers 400 validation_error for a month in the future", async () => {
    const admin = await createUser("admin@example.com", "ADMIN");

    const { response, payload } = await read(await sessionFor(admin), `?month=${currentMonthKey(monthsAgo(-1))}`);

    expect(response.status).toBe(400);
    expect(payload.error?.code).toBe("validation_error");
  });

  it("keeps a deleted account's records, as one row without an email", async () => {
    const admin = await createUser("admin@example.com", "ADMIN");
    const gone = await createUser("gone@example.com");
    await record(gone.id, new Date());
    await prisma.user.delete({ where: { id: gone.id } });

    const { payload } = await read(await sessionFor(admin));

    expect(payload.data?.summary.totals.searches).toBe(1);
    expect(payload.data?.summary.perUser).toEqual([expect.objectContaining({ userId: null, email: null, searches: 1 })]);
  });
});
