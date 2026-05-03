import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/trips/[id]/day-activity-transfer/route";
import { prisma } from "@/lib/db/prisma";
import { createSessionJwt } from "@/lib/auth/jwt";

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
        tripDayId: sourceDay.id,
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
      { params: { id: trip.id } },
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
        tripDayId: firstDay.id,
        title: "First",
        fromTime: "09:00",
        toTime: "10:00",
        contentJson: sampleDoc("First"),
      },
    });
    const secondItem = await prisma.dayPlanItem.create({
      data: {
        tripDayId: secondDay.id,
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
      { params: { id: trip.id } },
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
      { params: { id: trip.id } },
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
        tripDayId: sourceDay.id,
        title: "Source item",
        fromTime: "09:00",
        toTime: "10:00",
        contentJson: sampleDoc("Source item"),
      },
    });
    const targetItem = await prisma.dayPlanItem.create({
      data: {
        tripDayId: targetDay.id,
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
      { params: { id: trip.id } },
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
      { params: { id: trip.id } },
    );
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(403);
    expect(payload.error?.code).toBe("unauthorized");
  });
});
