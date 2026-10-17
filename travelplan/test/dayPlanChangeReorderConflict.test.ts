import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { createSessionJwt } from "@/lib/auth/jwt";
import { routeContext } from "./helpers/routeContext";

/**
 * Story 11.3 AC11. A reorder writes both swapped rows (and every moved one) conditionally on the
 * `updatedAt` its transaction read, through `applyScheduleChangesInTransaction` (Story 13.1). If another write lands
 * between that read and the writes, the whole change rolls back and the route answers
 * `409 day_plan_changed`.
 *
 * Its own file because `vi.mock` is per-module for a whole file, as `dayPlanChangePushConflict.test.ts`
 * explains; the interloper is simulated the same way, in the drawn-set read that sits between the plan
 * and the first write.
 */
const interlope = vi.hoisted(() => ({ title: null as string | null }));

vi.mock("@/lib/repositories/travelSegmentRepo", async () => {
  const actual = await vi.importActual<typeof import("@/lib/repositories/travelSegmentRepo")>(
    "@/lib/repositories/travelSegmentRepo",
  );
  return {
    ...actual,
    readDrawnSegmentKeysInTransaction: async (...args: Parameters<typeof actual.readDrawnSegmentKeysInTransaction>) => {
      const [tx] = args;
      if (interlope.title) {
        await tx.dayPlanItem.updateMany({ where: { title: interlope.title }, data: { updatedAt: new Date("2030-01-01T00:00:00.000Z") } });
      }
      return actual.readDrawnSegmentKeysInTransaction(...args);
    },
  };
});

const { POST } = await import("@/app/api/trips/[id]/day-plan-items/reorder/route");

const sampleDoc = (text: string) =>
  JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

const PAST = new Date("2026-01-02T03:04:05.678Z");
const CSRF = "csrf-token-value";

describe("a reorder that loses a race rolls the whole change back (Story 11.3)", () => {
  beforeEach(async () => {
    await prisma.travelSegment.deleteMany();
    await prisma.costPayment.deleteMany();
    await prisma.dayPlanItem.deleteMany();
    await prisma.tripDay.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
    interlope.title = null;
  });

  it("answers 409 day_plan_changed and writes nothing", async () => {
    const user = await prisma.user.create({ data: { email: "reorder-race@example.com", passwordHash: "hashed", role: "OWNER" } });
    const trip = await prisma.trip.create({
      data: {
        userId: user.id,
        name: "Race",
        startDate: new Date("2026-10-01T00:00:00.000Z"),
        endDate: new Date("2026-10-01T00:00:00.000Z"),
      },
    });
    const day = await prisma.tripDay.create({
      data: { tripId: trip.id, date: new Date("2026-10-01T00:00:00.000Z"), dayIndex: 1 },
    });
    // Story 13.1 §10: only a FLEXIBLE row is offered up and down, so both rows are flexible here.
    const flexible = { scheduleMode: "FLEXIBLE" as const, durationMinutes: 60 };
    await prisma.dayPlanItem.create({
      data: { tripDayId: day.id, title: "A", fromTime: "09:00", toTime: "10:00", ...flexible, sortOrder: 0, contentJson: sampleDoc("A"), createdAt: PAST, updatedAt: PAST },
    });
    const b = await prisma.dayPlanItem.create({
      data: { tripDayId: day.id, title: "B", fromTime: "10:00", toTime: "11:00", ...flexible, sortOrder: 1, contentJson: sampleDoc("B"), createdAt: PAST, updatedAt: PAST },
    });
    const before = await prisma.dayPlanItem.findMany({ orderBy: { id: "asc" } });
    // A is the second row the reorder writes; B is written first and would have succeeded.
    interlope.title = "A";

    const session = await createSessionJwt({ sub: user.id, role: user.role });
    const response = await POST(
      new NextRequest(`http://localhost/api/trips/${trip.id}/day-plan-items/reorder`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: `session=${session}; csrf_token=${CSRF}`,
          "x-csrf-token": CSRF,
        },
        body: JSON.stringify({ tripDayId: day.id, itemId: b.id, direction: "up" }),
      }),
      routeContext(trip.id),
    );

    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("day_plan_changed");
    // Nothing committed: B's write rolled back with A's miss, and so did the interloper's own bump.
    expect(await prisma.dayPlanItem.findMany({ orderBy: { id: "asc" } })).toEqual(before);
  });
});
