import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { createSessionJwt } from "@/lib/auth/jwt";
import { routeContext } from "./helpers/routeContext";

/**
 * Story 11.4 AC12. A leg or check-out save writes its moves conditionally on the `updatedAt` the plan
 * read. If another write lands in between, the move matches no row, the whole save (the leg or the stay
 * included) rolls back, and the route answers `409 day_plan_changed`.
 *
 * Its own file because `vi.mock` is per-module for a whole file. The interloper is simulated inside the
 * window: `readScheduleInputInTransaction` (Story 13.1; called across the module boundary from
 * `travelSegmentRepo.ts` and `accommodationRepo.ts`) has read the day, and no write has happened yet, so
 * the mock bumps the to-be-moved row's `updatedAt` through the same `tx` right there, exactly as a write
 * that slipped in would leave it.
 */
const interlope = vi.hoisted(() => ({ title: null as string | null }));

vi.mock("@/lib/repositories/dayScheduleTransaction", async () => {
  const actual = await vi.importActual<typeof import("@/lib/repositories/dayScheduleTransaction")>(
    "@/lib/repositories/dayScheduleTransaction",
  );
  return {
    ...actual,
    readScheduleInputInTransaction: async (...args: Parameters<typeof actual.readScheduleInputInTransaction>) => {
      const state = await actual.readScheduleInputInTransaction(...args);
      const [tx] = args;
      if (interlope.title) {
        await tx.dayPlanItem.updateMany({ where: { title: interlope.title }, data: { updatedAt: new Date("2030-01-01T00:00:00.000Z") } });
      }
      return state;
    },
  };
});

const { POST: SEGMENT_POST } = await import("@/app/api/trips/[id]/travel-segments/route");
const { PATCH: STAY_PATCH } = await import("@/app/api/trips/[id]/accommodations/route");

const PAST = new Date("2026-01-02T03:04:05.678Z");
const CSRF = "csrf-token-value";

const sampleDoc = (text: string) =>
  JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

const request = (url: string, method: "POST" | "PATCH", session: string, body: unknown) =>
  new NextRequest(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      cookie: `session=${session}; csrf_token=${CSRF}`,
      "x-csrf-token": CSRF,
    },
    body: JSON.stringify(body),
  });

const seed = async (email: string) => {
  const user = await prisma.user.create({ data: { email, passwordHash: "hashed", role: "OWNER" } });
  const trip = await prisma.trip.create({
    data: {
      userId: user.id,
      name: "Race",
      startDate: new Date("2026-10-01T00:00:00.000Z"),
      endDate: new Date("2026-10-02T00:00:00.000Z"),
    },
  });
  const stayDay = await prisma.tripDay.create({ data: { tripId: trip.id, date: new Date("2026-10-01T00:00:00.000Z"), dayIndex: 1 } });
  const day = await prisma.tripDay.create({ data: { tripId: trip.id, date: new Date("2026-10-02T00:00:00.000Z"), dayIndex: 2 } });
  const stay = await prisma.accommodation.create({
    data: { tripDayId: stayDay.id, name: "Stay", checkOutTime: "09:00", createdAt: PAST, updatedAt: PAST },
  });
  // Story 13.1: flexible rows, so a leg or a check-out moves them; stored as the schedule computes them
  // from the 09:00 check-out: A 09:00–09:30, B 09:30–10:30.
  const item = (title: string, fromTime: string, toTime: string, durationMinutes: number, sortOrder: number) =>
    prisma.dayPlanItem.create({
      data: {
        tripDayId: day.id,
        title,
        fromTime,
        toTime,
        scheduleMode: "FLEXIBLE",
        durationMinutes,
        sortOrder,
        contentJson: sampleDoc(title),
        createdAt: PAST,
        updatedAt: PAST,
      },
    });
  const a = await item("A", "09:00", "09:30", 30, 0);
  const b = await item("B", "09:30", "10:30", 60, 1);
  const session = await createSessionJwt({ sub: user.id, role: user.role });
  return { trip, stayDay, day, stay, a, b, session };
};

describe("a leg or check-out push that loses a race rolls the whole save back (Story 11.4 AC12)", () => {
  beforeEach(async () => {
    await prisma.travelSegment.deleteMany();
    await prisma.dayPlanItem.deleteMany();
    await prisma.accommodation.deleteMany();
    await prisma.tripDay.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
    interlope.title = null;
  });

  it("answers 409 day_plan_changed to a leg save and writes no leg", async () => {
    const { trip, day, a, b, session } = await seed("leg-race@example.com");
    interlope.title = "B";

    const response = await SEGMENT_POST(
      request(`http://localhost/api/trips/${trip.id}/travel-segments`, "POST", session, {
        tripDayId: day.id,
        fromItemType: "dayPlanItem",
        fromItemId: a.id,
        toItemType: "dayPlanItem",
        toItemId: b.id,
        transportType: "car",
        durationMinutes: 90,
        distanceKm: 50,
      }),
      routeContext(trip.id),
    );

    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("day_plan_changed");
    expect(await prisma.travelSegment.count()).toBe(0);
    expect((await prisma.dayPlanItem.findUniqueOrThrow({ where: { id: b.id } })).fromTime).toBe("09:30");
  });

  it("answers 409 day_plan_changed to a check-out save and leaves the stay as it was", async () => {
    const { trip, stayDay, stay, a, session } = await seed("stay-race@example.com");
    interlope.title = "A";

    const response = await STAY_PATCH(
      request(`http://localhost/api/trips/${trip.id}/accommodations`, "PATCH", session, {
        tripDayId: stayDay.id,
        name: "Renamed",
        status: "planned",
        checkOutTime: "11:00",
      }),
      routeContext(trip.id),
    );

    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("day_plan_changed");
    expect(await prisma.accommodation.findUniqueOrThrow({ where: { id: stay.id } })).toMatchObject({
      name: "Stay",
      checkOutTime: "09:00",
      updatedAt: PAST,
    });
    expect((await prisma.dayPlanItem.findUniqueOrThrow({ where: { id: a.id } })).fromTime).toBe("09:00");
  });
});
