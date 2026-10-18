import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { createSessionJwt } from "@/lib/auth/jwt";
import { routeContext } from "./helpers/routeContext";

/**
 * Story 13.3 AC5. *Alle flexibel machen* writes each converted row conditionally on the `updatedAt` the
 * transaction read. If another write lands between that read and the write, the whole change rolls back and
 * the route answers `409 day_plan_changed`. Its own file for the per-file `vi.mock`, as
 * `dayPlanItemParkConflict.test.ts`: the drawn-set read runs after the row read and before the first write.
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

const { POST } = await import("@/app/api/trips/[id]/day-plan-items/make-flexible/route");

const sampleDoc = (text: string) =>
  JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

const PAST = new Date("2026-01-02T03:04:05.678Z");
const CSRF = "csrf-token-value";

const seed = async () => {
  const user = await prisma.user.create({ data: { email: "flexible-race@example.com", passwordHash: "hashed", role: "OWNER" } });
  const trip = await prisma.trip.create({
    data: { userId: user.id, name: "Race", startDate: new Date("2026-10-01T00:00:00.000Z"), endDate: new Date("2026-10-01T00:00:00.000Z") },
  });
  const day = await prisma.tripDay.create({ data: { tripId: trip.id, date: new Date("2026-10-01T00:00:00.000Z"), dayIndex: 1 } });
  for (const [sortOrder, title, fromTime, toTime] of [
    [0, "A", "10:00", "11:00"],
    [1, "B", "13:00", "14:00"],
  ] as const) {
    await prisma.dayPlanItem.create({
      data: { tripId: trip.id, tripDayId: day.id, title, sortOrder, scheduleMode: "FIXED", durationMinutes: 60, fromTime, toTime, contentJson: sampleDoc(title), createdAt: PAST, updatedAt: PAST },
    });
  }
  return { user, trip, day };
};

const state = async () => ({
  items: await prisma.dayPlanItem.findMany({ orderBy: { id: "asc" } }),
  legs: await prisma.travelSegment.findMany({ orderBy: { id: "asc" } }),
});

describe("making a day flexible that loses a race rolls back (Story 13.3 AC5)", () => {
  beforeEach(async () => {
    await prisma.travelSegment.deleteMany();
    await prisma.costPayment.deleteMany();
    await prisma.dayPlanItem.deleteMany();
    await prisma.tripDay.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
    interlope.title = null;
  });

  it("answers 409 day_plan_changed and writes nothing when a converted row changed in between", async () => {
    const { user, trip, day } = await seed();
    const session = await createSessionJwt({ sub: user.id, role: user.role });
    const before = await state();
    interlope.title = "B";

    const response = await POST(
      new NextRequest(`http://localhost/api/trips/${trip.id}/day-plan-items/make-flexible`, {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: `session=${session}; csrf_token=${CSRF}`, "x-csrf-token": CSRF },
        body: JSON.stringify({ tripDayId: day.id }),
      }),
      routeContext(trip.id),
    );

    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("day_plan_changed");
    // The interloper's own bump rolled back with the transaction, so the day is exactly as before.
    expect(await state()).toEqual(before);
  });
});
