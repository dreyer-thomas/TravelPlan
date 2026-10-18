import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { createSessionJwt } from "@/lib/auth/jwt";
import { routeContext } from "./helpers/routeContext";

/**
 * Story 14.2 AC8. The park is written conditionally on the `updatedAt` the transaction read. If another
 * write lands between that read and the park, the park matches no row, the whole change rolls back, and
 * the route answers `409 day_plan_changed`.
 *
 * Its own file because `vi.mock` is per-module for a whole file (`dayPlanChangePushConflict.test.ts`'s
 * pattern): the drawn-set read runs after the row read and before the first write, so the mock bumps the
 * row's `updatedAt` through the same `tx` there, exactly as a write that slipped in would leave it.
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

const { POST } = await import("@/app/api/trips/[id]/day-plan-items/park/route");
const { DayPlanChangedError, parkDayPlanItemForTripDay } = await import("@/lib/repositories/dayPlanItemRepo");

const sampleDoc = (text: string) =>
  JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

const PAST = new Date("2026-01-02T03:04:05.678Z");
const CSRF = "csrf-token-value";

const seed = async () => {
  const user = await prisma.user.create({ data: { email: "park-race@example.com", passwordHash: "hashed", role: "OWNER" } });
  const trip = await prisma.trip.create({
    data: {
      userId: user.id,
      name: "Race",
      startDate: new Date("2026-10-01T00:00:00.000Z"),
      endDate: new Date("2026-10-01T00:00:00.000Z"),
    },
  });
  const day = await prisma.tripDay.create({ data: { tripId: trip.id, date: new Date("2026-10-01T00:00:00.000Z"), dayIndex: 1 } });
  const a = await prisma.dayPlanItem.create({
    data: { tripId: trip.id, tripDayId: day.id, title: "A", fromTime: "09:00", toTime: "10:00", contentJson: sampleDoc("A"), createdAt: PAST, updatedAt: PAST },
  });
  const b = await prisma.dayPlanItem.create({
    data: { tripId: trip.id, tripDayId: day.id, title: "B", fromTime: "10:30", toTime: "11:30", sortOrder: 1, contentJson: sampleDoc("B"), createdAt: PAST, updatedAt: PAST },
  });
  await prisma.travelSegment.create({
    data: { tripDayId: day.id, fromItemType: "DAY_PLAN_ITEM", fromItemId: a.id, toItemType: "DAY_PLAN_ITEM", toItemId: b.id, transportType: "WALKING", durationMinutes: 10 },
  });
  return { user, trip, day, a, b };
};

const state = async () => ({
  items: await prisma.dayPlanItem.findMany({ orderBy: { id: "asc" } }),
  legs: await prisma.travelSegment.findMany({ orderBy: { id: "asc" } }),
});

describe("a park that loses a race rolls back (Story 14.2 AC8)", () => {
  beforeEach(async () => {
    await prisma.travelSegment.deleteMany();
    await prisma.costPayment.deleteMany();
    await prisma.dayPlanItem.deleteMany();
    await prisma.tripDay.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
    interlope.title = null;
  });

  it("throws DayPlanChangedError from the repository and writes nothing", async () => {
    const { user, trip, day, b } = await seed();
    const before = await state();
    interlope.title = "B";

    await expect(parkDayPlanItemForTripDay({ userId: user.id, tripId: trip.id, tripDayId: day.id, itemId: b.id })).rejects.toBeInstanceOf(
      DayPlanChangedError,
    );
    interlope.title = null;
    // The interloper wrote through the same `tx`, so the rollback takes its stamp back too.
    expect(await state()).toEqual(before);
  });

  it("answers 409 day_plan_changed through the route and writes nothing", async () => {
    const { user, trip, day, b } = await seed();
    const before = await state();
    interlope.title = "B";

    const session = await createSessionJwt({ sub: user.id, role: user.role });
    const response = await POST(
      new NextRequest(`http://localhost/api/trips/${trip.id}/day-plan-items/park`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: `session=${session}; csrf_token=${CSRF}`,
          "x-csrf-token": CSRF,
        },
        body: JSON.stringify({ itemId: b.id, tripDayId: day.id }),
      }),
      routeContext(trip.id),
    );

    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("day_plan_changed");
    interlope.title = null;
    expect(await state()).toEqual(before);
  });
});
