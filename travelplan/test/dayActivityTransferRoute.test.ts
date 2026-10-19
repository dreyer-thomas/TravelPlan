import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/trips/[id]/day-activity-transfer/route";
import { GET as TRIP_GET } from "@/app/api/trips/[id]/route";
import { prisma } from "@/lib/db/prisma";
import { createSessionJwt } from "@/lib/auth/jwt";
import { routeContext } from "./helpers/routeContext";

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

const buildRequest = (
  url: string,
  options?: { session?: string; csrf?: string; method?: string; body?: string },
) => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (options?.session) {
    headers.cookie = `session=${options.session}`;
  }

  if (options?.csrf) {
    headers.cookie = headers.cookie ? `${headers.cookie}; csrf_token=${options.csrf}` : `csrf_token=${options.csrf}`;
    headers["x-csrf-token"] = options.csrf;
  }

  return new NextRequest(url, {
    method: options?.method ?? "POST",
    headers,
    body: options?.body,
  });
};

const sampleDoc = (text: string) =>
  JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

describe("/api/trips/[id]/day-activity-transfer", () => {
  beforeEach(async () => {
    await prisma.travelSegment.deleteMany();
    await prisma.dayPlanItemImage.deleteMany();
    await prisma.costPayment.deleteMany();
    await prisma.dayPlanItem.deleteMany();
    await prisma.accommodation.deleteMany();
    await prisma.tripMember.deleteMany();
    await prisma.tripDay.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
  });

  it("moves activities between days for a contributor", async () => {
    const owner = await prisma.user.create({
      data: { email: "transfer-owner@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const contributor = await prisma.user.create({
      data: { email: "transfer-contributor@example.com", passwordHash: "hashed", role: "VIEWER" },
    });
    const token = await createSessionJwt({ sub: contributor.id, role: contributor.role });

    const trip = await prisma.trip.create({
      data: {
        userId: owner.id,
        name: "Transfer Trip",
        startDate: new Date("2026-12-15T00:00:00.000Z"),
        endDate: new Date("2026-12-16T00:00:00.000Z"),
      },
    });
    await prisma.tripMember.create({
      data: {
        tripId: trip.id,
        userId: contributor.id,
        role: "CONTRIBUTOR",
      },
    });

    const sourceDay = await prisma.tripDay.create({
      data: {
        tripId: trip.id,
        date: new Date("2026-12-15T00:00:00.000Z"),
        dayIndex: 1,
      },
    });
    const targetDay = await prisma.tripDay.create({
      data: {
        tripId: trip.id,
        date: new Date("2026-12-16T00:00:00.000Z"),
        dayIndex: 2,
      },
    });

    const sourceItem = await prisma.dayPlanItem.create({
      data: {
        tripId: sourceDay.tripId, tripDayId: sourceDay.id,
        title: "Source item",
        fromTime: "09:00",
        toTime: "10:00",
        contentJson: sampleDoc("Source item"),
      },
    });

    const response = await POST(
      buildRequest(`http://localhost/api/trips/${trip.id}/day-activity-transfer`, {
        session: token,
        csrf: "csrf-token",
        body: JSON.stringify({
          operation: "move",
          sourceTripDayId: sourceDay.id,
          targetTripDayId: targetDay.id,
          confirmOverwrite: true,
        }),
      }),
      routeContext(trip.id),
    );
    const payload = (await response.json()) as ApiEnvelope<{
      operation: "move" | "swap";
      sourceTripDayId: string;
      targetTripDayId: string;
      movedItemIds?: string[];
    }>;

    expect(response.status).toBe(200);
    expect(payload.error).toBeNull();
    expect(payload.data).toMatchObject({
      operation: "move",
      sourceTripDayId: sourceDay.id,
      targetTripDayId: targetDay.id,
      movedItemIds: [sourceItem.id],
    });
    expect(await prisma.dayPlanItem.findUnique({ where: { id: sourceItem.id } })).toMatchObject({ tripDayId: targetDay.id });
  });

  it("swaps activities between days for the trip owner", async () => {
    const owner = await prisma.user.create({
      data: { email: "transfer-owner-swap@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const token = await createSessionJwt({ sub: owner.id, role: owner.role });

    const trip = await prisma.trip.create({
      data: {
        userId: owner.id,
        name: "Swap Trip",
        startDate: new Date("2026-12-17T00:00:00.000Z"),
        endDate: new Date("2026-12-18T00:00:00.000Z"),
      },
    });
    const firstDay = await prisma.tripDay.create({
      data: {
        tripId: trip.id,
        date: new Date("2026-12-17T00:00:00.000Z"),
        dayIndex: 1,
      },
    });
    const secondDay = await prisma.tripDay.create({
      data: {
        tripId: trip.id,
        date: new Date("2026-12-18T00:00:00.000Z"),
        dayIndex: 2,
      },
    });

    const firstItem = await prisma.dayPlanItem.create({
      data: {
        tripId: firstDay.tripId, tripDayId: firstDay.id,
        title: "First",
        fromTime: "09:00",
        toTime: "10:00",
        contentJson: sampleDoc("First"),
      },
    });
    const secondItem = await prisma.dayPlanItem.create({
      data: {
        tripId: secondDay.tripId, tripDayId: secondDay.id,
        title: "Second",
        fromTime: "12:00",
        toTime: "13:00",
        contentJson: sampleDoc("Second"),
      },
    });

    const response = await POST(
      buildRequest(`http://localhost/api/trips/${trip.id}/day-activity-transfer`, {
        session: token,
        csrf: "csrf-token",
        body: JSON.stringify({
          operation: "swap",
          sourceTripDayId: firstDay.id,
          targetTripDayId: secondDay.id,
        }),
      }),
      routeContext(trip.id),
    );
    const payload = (await response.json()) as ApiEnvelope<{
      operation: "move" | "swap";
      firstDayItemIds?: string[];
      secondDayItemIds?: string[];
    }>;

    expect(response.status).toBe(200);
    expect(payload.error).toBeNull();
    expect(payload.data).toMatchObject({
      operation: "swap",
      firstDayItemIds: [secondItem.id],
      secondDayItemIds: [firstItem.id],
    });
  });

  it("returns a validation error when source and target are the same day", async () => {
    const owner = await prisma.user.create({
      data: { email: "transfer-owner-same-day@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const token = await createSessionJwt({ sub: owner.id, role: owner.role });

    const trip = await prisma.trip.create({
      data: {
        userId: owner.id,
        name: "Same Day Trip",
        startDate: new Date("2026-12-19T00:00:00.000Z"),
        endDate: new Date("2026-12-19T00:00:00.000Z"),
      },
    });
    const day = await prisma.tripDay.create({
      data: {
        tripId: trip.id,
        date: new Date("2026-12-19T00:00:00.000Z"),
        dayIndex: 1,
      },
    });

    const response = await POST(
      buildRequest(`http://localhost/api/trips/${trip.id}/day-activity-transfer`, {
        session: token,
        csrf: "csrf-token",
        body: JSON.stringify({
          operation: "swap",
          sourceTripDayId: day.id,
          targetTripDayId: day.id,
        }),
      }),
      routeContext(trip.id),
    );
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(400);
    expect(payload.error?.code).toBe("validation_error");
  });

  it("requires overwrite confirmation when the move target already has activities", async () => {
    const owner = await prisma.user.create({
      data: { email: "transfer-owner-overwrite@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const token = await createSessionJwt({ sub: owner.id, role: owner.role });

    const trip = await prisma.trip.create({
      data: {
        userId: owner.id,
        name: "Overwrite Trip",
        startDate: new Date("2026-12-20T00:00:00.000Z"),
        endDate: new Date("2026-12-21T00:00:00.000Z"),
      },
    });
    const sourceDay = await prisma.tripDay.create({
      data: {
        tripId: trip.id,
        date: new Date("2026-12-20T00:00:00.000Z"),
        dayIndex: 1,
      },
    });
    const targetDay = await prisma.tripDay.create({
      data: {
        tripId: trip.id,
        date: new Date("2026-12-21T00:00:00.000Z"),
        dayIndex: 2,
      },
    });
    await prisma.dayPlanItem.create({
      data: {
        tripId: sourceDay.tripId, tripDayId: sourceDay.id,
        title: "Source item",
        fromTime: "09:00",
        toTime: "10:00",
        contentJson: sampleDoc("Source item"),
      },
    });
    const targetItem = await prisma.dayPlanItem.create({
      data: {
        tripId: targetDay.tripId, tripDayId: targetDay.id,
        title: "Target item",
        fromTime: "12:00",
        toTime: "13:00",
        contentJson: sampleDoc("Target item"),
      },
    });

    const response = await POST(
      buildRequest(`http://localhost/api/trips/${trip.id}/day-activity-transfer`, {
        session: token,
        csrf: "csrf-token",
        body: JSON.stringify({
          operation: "move",
          sourceTripDayId: sourceDay.id,
          targetTripDayId: targetDay.id,
        }),
      }),
      routeContext(trip.id),
    );
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(400);
    expect(payload.error?.code).toBe("validation_error");
    expect(await prisma.dayPlanItem.findUnique({ where: { id: targetItem.id } })).not.toBeNull();
  });

  it("returns 403 unauthorized for viewers without write access", async () => {
    const owner = await prisma.user.create({
      data: { email: "transfer-owner-viewer@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const viewer = await prisma.user.create({
      data: { email: "transfer-viewer@example.com", passwordHash: "hashed", role: "VIEWER" },
    });
    const token = await createSessionJwt({ sub: viewer.id, role: viewer.role });

    const trip = await prisma.trip.create({
      data: {
        userId: owner.id,
        name: "Viewer Transfer Trip",
        startDate: new Date("2026-12-20T00:00:00.000Z"),
        endDate: new Date("2026-12-21T00:00:00.000Z"),
      },
    });
    const sourceDay = await prisma.tripDay.create({
      data: {
        tripId: trip.id,
        date: new Date("2026-12-20T00:00:00.000Z"),
        dayIndex: 1,
      },
    });
    const targetDay = await prisma.tripDay.create({
      data: {
        tripId: trip.id,
        date: new Date("2026-12-21T00:00:00.000Z"),
        dayIndex: 2,
      },
    });
    await prisma.tripMember.create({
      data: {
        tripId: trip.id,
        userId: viewer.id,
        role: "VIEWER",
      },
    });

    const response = await POST(
      buildRequest(`http://localhost/api/trips/${trip.id}/day-activity-transfer`, {
        session: token,
        csrf: "csrf-token",
        body: JSON.stringify({
          operation: "move",
          sourceTripDayId: sourceDay.id,
          targetTripDayId: targetDay.id,
          confirmOverwrite: true,
        }),
      }),
      routeContext(trip.id),
    );
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(403);
    expect(payload.error?.code).toBe("unauthorized");
  });
});

/**
 * Story 13.3 AC4. The moves between days recompute the days they change, in the same transaction: the
 * order travels as it was, FIXED rows keep their times, flexible ones follow the new day's start (last
 * night's check-out), and a flexible row that no longer fits is stored without times (13.2).
 */
describe("/api/trips/[id]/day-activity-transfer recomputes (Story 13.3)", () => {
  beforeEach(async () => {
    await prisma.travelSegment.deleteMany();
    await prisma.dayPlanItemImage.deleteMany();
    await prisma.costPayment.deleteMany();
    await prisma.dayPlanItem.deleteMany();
    await prisma.accommodation.deleteMany();
    await prisma.tripMember.deleteMany();
    await prisma.tripDay.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
  });

  /** Day 2 starts at 08:00 (day 1's check-out), day 3 at 10:30 (day 2's). */
  const seedTrip = async (email: string) => {
    const owner = await prisma.user.create({ data: { email, passwordHash: "hashed", role: "OWNER" } });
    const token = await createSessionJwt({ sub: owner.id, role: owner.role });
    const trip = await prisma.trip.create({
      data: {
        userId: owner.id,
        name: "Recompute Trip",
        startDate: new Date("2026-12-15T00:00:00.000Z"),
        endDate: new Date("2026-12-17T00:00:00.000Z"),
      },
    });
    const day = (dayIndex: number) =>
      prisma.tripDay.create({
        data: { tripId: trip.id, date: new Date(`2026-12-${14 + dayIndex}T00:00:00.000Z`), dayIndex },
      });
    const day1 = await day(1);
    const day2 = await day(2);
    const day3 = await day(3);
    await prisma.accommodation.create({ data: { tripDayId: day1.id, name: "First", checkOutTime: "08:00" } });
    await prisma.accommodation.create({ data: { tripDayId: day2.id, name: "Second", checkOutTime: "10:30" } });
    return { owner, token, trip, day1, day2, day3 };
  };

  const row = (
    tripId: string,
    tripDayId: string,
    title: string,
    sortOrder: number,
    scheduleMode: "FLEXIBLE" | "FIXED",
    durationMinutes: number,
    fromTime: string | null,
    toTime: string | null,
  ) =>
    prisma.dayPlanItem.create({
      data: { tripId, tripDayId, title, sortOrder, scheduleMode, durationMinutes, fromTime, toTime, contentJson: sampleDoc(title) },
    });

  const transfer = async (tripId: string, token: string, body: Record<string, unknown>) => {
    const response = await POST(
      buildRequest(`http://localhost/api/trips/${tripId}/day-activity-transfer`, {
        session: token,
        csrf: "csrf-token",
        body: JSON.stringify(body),
      }),
      routeContext(tripId),
    );
    return { status: response.status, body: (await response.json()) as ApiEnvelope<Record<string, unknown>> };
  };

  const dayRows = async (tripDayId: string) =>
    (await prisma.dayPlanItem.findMany({ where: { tripDayId }, orderBy: { sortOrder: "asc" } })).map(
      (item) => `${item.sortOrder} ${item.title} ${item.scheduleMode} ${item.fromTime}–${item.toTime}`,
    );

  it("moves a flexible chain from an 08:00 day onto a 10:30 day: it starts at 10:30, order kept", async () => {
    const { token, trip, day2, day3 } = await seedTrip("recompute-move@example.com");
    await row(trip.id, day2.id, "A", 0, "FLEXIBLE", 60, "08:00", "09:00");
    await row(trip.id, day2.id, "B", 1, "FLEXIBLE", 30, "09:00", "09:30");

    const response = await transfer(trip.id, token, { operation: "move", sourceTripDayId: day2.id, targetTripDayId: day3.id });

    expect(response.status).toBe(200);
    expect(await dayRows(day3.id)).toEqual(["0 A FLEXIBLE 10:30–11:30", "1 B FLEXIBLE 11:30–12:00"]);
    expect(await dayRows(day2.id)).toEqual([]);
  });

  it("swaps two days and recomputes both from their new starts", async () => {
    const { token, trip, day2, day3 } = await seedTrip("recompute-swap@example.com");
    await row(trip.id, day2.id, "A", 0, "FLEXIBLE", 60, "08:00", "09:00");
    await row(trip.id, day3.id, "X", 0, "FLEXIBLE", 90, "10:30", "12:00");
    await row(trip.id, day3.id, "Y", 1, "FLEXIBLE", 30, "12:00", "12:30");

    const response = await transfer(trip.id, token, { operation: "swap", sourceTripDayId: day2.id, targetTripDayId: day3.id });

    expect(response.status).toBe(200);
    expect(await dayRows(day2.id)).toEqual(["0 X FLEXIBLE 08:00–09:30", "1 Y FLEXIBLE 09:30–10:00"]);
    expect(await dayRows(day3.id)).toEqual(["0 A FLEXIBLE 10:30–11:30"]);
  });

  it("keeps a FIXED row's times and order; the flexible row before it makes it late in the trip payload", async () => {
    const { owner, token, trip, day2, day3 } = await seedTrip("recompute-fixed@example.com");
    // On day 2: Walk 08:00–10:00, then the 10:30 ferry. On day 3 Walk starts at 10:30 and ends at 12:30.
    await row(trip.id, day2.id, "Walk", 0, "FLEXIBLE", 120, "08:00", "10:00");
    const ferry = await row(trip.id, day2.id, "Ferry", 1, "FIXED", 60, "10:30", "11:30");

    const response = await transfer(trip.id, token, { operation: "move", sourceTripDayId: day2.id, targetTripDayId: day3.id });

    expect(response.status).toBe(200);
    expect(await dayRows(day3.id)).toEqual(["0 Walk FLEXIBLE 10:30–12:30", "1 Ferry FIXED 10:30–11:30"]);
    const session = await createSessionJwt({ sub: owner.id, role: owner.role });
    const read = await TRIP_GET(
      new NextRequest(`http://localhost/api/trips/${trip.id}`, { headers: { cookie: `session=${session}` } }),
      routeContext(trip.id),
    );
    const payload = (await read.json()) as ApiEnvelope<{ days: { id: string; planConflicts: unknown[] }[] }>;
    expect(payload.data!.days.find((entry) => entry.id === day3.id)!.planConflicts).toEqual([
      { kind: "late", itemId: ferry.id, title: "Ferry", fromTime: "10:30", reachableAt: "12:30", lateMinutes: 120 },
    ]);
  });

  it("stores a flexible row that no longer fits on the later day without times", async () => {
    const { token, trip, day2, day3 } = await seedTrip("recompute-overflow@example.com");
    await row(trip.id, day2.id, "Long", 0, "FLEXIBLE", 780, "08:00", "21:00");
    await row(trip.id, day2.id, "Late", 1, "FLEXIBLE", 120, "21:00", "23:00");

    const response = await transfer(trip.id, token, { operation: "move", sourceTripDayId: day2.id, targetTripDayId: day3.id });

    expect(response.status).toBe(200);
    expect(await dayRows(day3.id)).toEqual(["0 Long FLEXIBLE 10:30–23:30", "1 Late FLEXIBLE null–null"]);
    expect(await prisma.dayPlanItem.findFirstOrThrow({ where: { title: "Late" } })).toMatchObject({ durationMinutes: 120 });
  });
});
