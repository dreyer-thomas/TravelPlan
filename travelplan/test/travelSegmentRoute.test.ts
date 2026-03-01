import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { DELETE, GET, PATCH, POST } from "@/app/api/trips/[id]/travel-segments/route";
import { prisma } from "@/lib/db/prisma";
import { createSessionJwt } from "@/lib/auth/jwt";

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
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
    method: options?.method ?? "GET",
    headers,
    body: options?.body,
  });
};

describe("/api/trips/[id]/travel-segments", () => {
  beforeEach(async () => {
    await prisma.travelSegment.deleteMany();
    await prisma.dayPlanItem.deleteMany();
    await prisma.accommodation.deleteMany();
    await prisma.tripDay.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
  });

  it("lists travel segments for a trip day", async () => {
    const user = await prisma.user.create({
      data: { email: "segment-list@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const token = await createSessionJwt({ sub: user.id, role: user.role });

    const trip = await prisma.trip.create({
      data: {
        userId: user.id,
        name: "Segment Trip",
        startDate: new Date("2026-12-10T00:00:00.000Z"),
        endDate: new Date("2026-12-10T00:00:00.000Z"),
      },
    });

    const day = await prisma.tripDay.create({
      data: {
        tripId: trip.id,
        date: new Date("2026-12-10T00:00:00.000Z"),
        dayIndex: 1,
      },
    });

    const accommodation = await prisma.accommodation.create({
      data: {
        tripDayId: day.id,
        name: "Harbor Hotel",
        status: "PLANNED",
      },
    });

    const planItem = await prisma.dayPlanItem.create({
      data: {
        tripDayId: day.id,
        contentJson: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Plan" }] }] }),
      },
    });

    await prisma.travelSegment.create({
      data: {
        tripDayId: day.id,
        fromItemType: "DAY_PLAN_ITEM",
        fromItemId: planItem.id,
        toItemType: "ACCOMMODATION",
        toItemId: accommodation.id,
        transportType: "CAR",
        durationMinutes: 45,
        distanceKm: 18.5,
        linkUrl: "https://maps.example.com",
      },
    });

    const request = buildRequest(`http://localhost/api/trips/${trip.id}/travel-segments?tripDayId=${day.id}`, {
      session: token,
      method: "GET",
    });

    const response = await GET(request, { params: { id: trip.id } });
    const payload = (await response.json()) as ApiEnvelope<{ segments: { id: string; transportType: string }[] }>;

    expect(response.status).toBe(200);
    expect(payload.error).toBeNull();
    expect(payload.data?.segments).toHaveLength(1);
    expect(payload.data?.segments[0].transportType).toBe("car");
  });

  it("creates, updates, and deletes a travel segment", async () => {
    const user = await prisma.user.create({
      data: { email: "segment-create@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const token = await createSessionJwt({ sub: user.id, role: user.role });

    const trip = await prisma.trip.create({
      data: {
        userId: user.id,
        name: "Segment Trip",
        startDate: new Date("2026-12-11T00:00:00.000Z"),
        endDate: new Date("2026-12-11T00:00:00.000Z"),
      },
    });

    const day = await prisma.tripDay.create({
      data: {
        tripId: trip.id,
        date: new Date("2026-12-11T00:00:00.000Z"),
        dayIndex: 1,
      },
    });

    const accommodation = await prisma.accommodation.create({
      data: {
        tripDayId: day.id,
        name: "Station Stay",
        status: "PLANNED",
      },
    });

    const planItem = await prisma.dayPlanItem.create({
      data: {
        tripDayId: day.id,
        contentJson: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Plan" }] }] }),
      },
    });

    const createRequest = buildRequest(`http://localhost/api/trips/${trip.id}/travel-segments`, {
      session: token,
      csrf: "csrf-token",
      method: "POST",
      body: JSON.stringify({
        tripDayId: day.id,
        fromItemType: "dayPlanItem",
        fromItemId: planItem.id,
        toItemType: "accommodation",
        toItemId: accommodation.id,
        transportType: "car",
        durationMinutes: 30,
        distanceKm: 12.2,
        linkUrl: "https://maps.example.com",
      }),
    });

    const createResponse = await POST(createRequest, { params: { id: trip.id } });
    const createPayload = (await createResponse.json()) as ApiEnvelope<{ segment: { id: string } }>;

    expect(createResponse.status).toBe(200);
    expect(createPayload.error).toBeNull();
    expect(createPayload.data?.segment.id).toBeDefined();

    const segmentId = createPayload.data?.segment.id ?? "";

    const updateRequest = buildRequest(`http://localhost/api/trips/${trip.id}/travel-segments`, {
      session: token,
      csrf: "csrf-token",
      method: "PATCH",
      body: JSON.stringify({
        tripDayId: day.id,
        segmentId,
        fromItemType: "dayPlanItem",
        fromItemId: planItem.id,
        toItemType: "accommodation",
        toItemId: accommodation.id,
        transportType: "ship",
        durationMinutes: 90,
        distanceKm: null,
        linkUrl: null,
      }),
    });

    const updateResponse = await PATCH(updateRequest, { params: { id: trip.id } });
    const updatePayload = (await updateResponse.json()) as ApiEnvelope<{ segment: { transportType: string } }>;

    expect(updateResponse.status).toBe(200);
    expect(updatePayload.data?.segment.transportType).toBe("ship");

    const deleteRequest = buildRequest(`http://localhost/api/trips/${trip.id}/travel-segments`, {
      session: token,
      csrf: "csrf-token",
      method: "DELETE",
      body: JSON.stringify({
        tripDayId: day.id,
        segmentId,
      }),
    });

    const deleteResponse = await DELETE(deleteRequest, { params: { id: trip.id } });
    const deletePayload = (await deleteResponse.json()) as ApiEnvelope<{ deleted: boolean }>;

    expect(deleteResponse.status).toBe(200);
    expect(deletePayload.data?.deleted).toBe(true);
  });

  it("rejects non-adjacent travel segments", async () => {
    const user = await prisma.user.create({
      data: { email: "segment-adjacent@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const token = await createSessionJwt({ sub: user.id, role: user.role });

    const trip = await prisma.trip.create({
      data: {
        userId: user.id,
        name: "Segment Trip",
        startDate: new Date("2026-12-12T00:00:00.000Z"),
        endDate: new Date("2026-12-13T00:00:00.000Z"),
      },
    });

    const previousDay = await prisma.tripDay.create({
      data: {
        tripId: trip.id,
        date: new Date("2026-12-12T00:00:00.000Z"),
        dayIndex: 1,
      },
    });

    const currentDay = await prisma.tripDay.create({
      data: {
        tripId: trip.id,
        date: new Date("2026-12-13T00:00:00.000Z"),
        dayIndex: 2,
      },
    });

    const previousStay = await prisma.accommodation.create({
      data: {
        tripDayId: previousDay.id,
        name: "Prev Stay",
        status: "PLANNED",
      },
    });

    const currentStay = await prisma.accommodation.create({
      data: {
        tripDayId: currentDay.id,
        name: "Current Stay",
        status: "PLANNED",
      },
    });

    await prisma.dayPlanItem.create({
      data: {
        tripDayId: currentDay.id,
        contentJson: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Plan" }] }] }),
      },
    });

    const request = buildRequest(`http://localhost/api/trips/${trip.id}/travel-segments`, {
      session: token,
      csrf: "csrf-token",
      method: "POST",
      body: JSON.stringify({
        tripDayId: currentDay.id,
        fromItemType: "accommodation",
        fromItemId: previousStay.id,
        toItemType: "accommodation",
        toItemId: currentStay.id,
        transportType: "car",
        durationMinutes: 20,
        distanceKm: 5,
        linkUrl: "https://maps.example.com",
      }),
    });

    const response = await POST(request, { params: { id: trip.id } });
    const payload = (await response.json()) as ApiEnvelope<unknown>;

    expect(response.status).toBe(400);
    expect(payload.error?.code).toBe("validation_error");
  });
});
