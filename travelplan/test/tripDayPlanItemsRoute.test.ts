import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { DELETE, GET, PATCH, POST } from "@/app/api/trips/[id]/day-plan-items/route";
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

const sampleDoc = (text: string) =>
  JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

describe("/api/trips/[id]/day-plan-items", () => {
  beforeEach(async () => {
    await prisma.dayPlanItem.deleteMany();
    await prisma.tripDay.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
  });

  it("lists day plan items for the trip day", async () => {
    const user = await prisma.user.create({
      data: { email: "plan-route-owner@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const token = await createSessionJwt({ sub: user.id, role: user.role });

    const trip = await prisma.trip.create({
      data: {
        userId: user.id,
        name: "Plan Route",
        startDate: new Date("2026-12-01T00:00:00.000Z"),
        endDate: new Date("2026-12-01T00:00:00.000Z"),
      },
    });

    const day = await prisma.tripDay.create({
      data: {
        tripId: trip.id,
        date: new Date("2026-12-01T00:00:00.000Z"),
        dayIndex: 1,
      },
    });

    await prisma.dayPlanItem.create({
      data: {
        tripDayId: day.id,
        contentJson: sampleDoc("First"),
        costCents: null,
        linkUrl: null,
        locationLat: null,
        locationLng: null,
        locationLabel: null,
        createdAt: new Date("2026-12-01T08:00:00.000Z"),
      },
    });

    await prisma.dayPlanItem.create({
      data: {
        tripDayId: day.id,
        contentJson: sampleDoc("Second"),
        costCents: 3200,
        linkUrl: "https://example.com/plan",
        locationLat: 48.1372,
        locationLng: 11.5756,
        locationLabel: "Marienplatz",
        createdAt: new Date("2026-12-01T09:00:00.000Z"),
      },
    });

    const request = buildRequest(
      `http://localhost/api/trips/${trip.id}/day-plan-items?tripDayId=${day.id}`,
      {
        session: token,
        method: "GET",
      },
    );

    const response = await GET(request, { params: { id: trip.id } });
    const payload = (await response.json()) as ApiEnvelope<{
      items: {
        id: string;
        contentJson: string;
        costCents: number | null;
        linkUrl: string | null;
        location: { lat: number; lng: number; label: string | null } | null;
      }[];
    }>;

    expect(response.status).toBe(200);
    expect(payload.error).toBeNull();
    expect(payload.data?.items.map((item) => item.contentJson)).toEqual([sampleDoc("First"), sampleDoc("Second")]);
    expect(payload.data?.items.map((item) => item.costCents)).toEqual([null, 3200]);
    expect(payload.data?.items[1].linkUrl).toBe("https://example.com/plan");
    expect(payload.data?.items[1].location).toEqual({ lat: 48.1372, lng: 11.5756, label: "Marienplatz" });
  });

  it("returns 404 when listing items for a non-owned trip day", async () => {
    const owner = await prisma.user.create({
      data: { email: "plan-route-owner-2@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const other = await prisma.user.create({
      data: { email: "plan-route-other@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const token = await createSessionJwt({ sub: other.id, role: other.role });

    const trip = await prisma.trip.create({
      data: {
        userId: owner.id,
        name: "Private Trip",
        startDate: new Date("2026-12-02T00:00:00.000Z"),
        endDate: new Date("2026-12-02T00:00:00.000Z"),
      },
    });

    const day = await prisma.tripDay.create({
      data: {
        tripId: trip.id,
        date: new Date("2026-12-02T00:00:00.000Z"),
        dayIndex: 1,
      },
    });

    const request = buildRequest(
      `http://localhost/api/trips/${trip.id}/day-plan-items?tripDayId=${day.id}`,
      {
        session: token,
        method: "GET",
      },
    );

    const response = await GET(request, { params: { id: trip.id } });
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(404);
    expect(payload.data).toBeNull();
    expect(payload.error?.code).toBe("not_found");
  });

  it("creates a day plan item for the trip day", async () => {
    const user = await prisma.user.create({
      data: { email: "plan-route-create@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const token = await createSessionJwt({ sub: user.id, role: user.role });

    const trip = await prisma.trip.create({
      data: {
        userId: user.id,
        name: "Create Trip",
        startDate: new Date("2026-12-03T00:00:00.000Z"),
        endDate: new Date("2026-12-03T00:00:00.000Z"),
      },
    });

    const day = await prisma.tripDay.create({
      data: {
        tripId: trip.id,
        date: new Date("2026-12-03T00:00:00.000Z"),
        dayIndex: 1,
      },
    });

    const request = buildRequest(`http://localhost/api/trips/${trip.id}/day-plan-items`, {
      session: token,
      csrf: "csrf-token",
      method: "POST",
      body: JSON.stringify({
        tripDayId: day.id,
        contentJson: sampleDoc("Plan"),
        costCents: 1500,
        linkUrl: "https://example.com/plan",
        location: { lat: 48.145, lng: 11.582, label: "Gallery" },
      }),
    });

    const response = await POST(request, { params: { id: trip.id } });
    const payload = (await response.json()) as ApiEnvelope<{
      dayPlanItem: {
        id: string;
        tripDayId: string;
        contentJson: string;
        costCents: number | null;
        linkUrl: string | null;
        location: { lat: number; lng: number; label: string | null } | null;
      };
    }>;

    expect(response.status).toBe(200);
    expect(payload.error).toBeNull();
    expect(payload.data?.dayPlanItem.tripDayId).toBe(day.id);
    expect(payload.data?.dayPlanItem.costCents).toBe(1500);
    expect(payload.data?.dayPlanItem.linkUrl).toBe("https://example.com/plan");
    expect(payload.data?.dayPlanItem.location).toEqual({ lat: 48.145, lng: 11.582, label: "Gallery" });
  });

  it("creates and returns rich formatted content without data loss", async () => {
    const user = await prisma.user.create({
      data: { email: "plan-route-rich@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const token = await createSessionJwt({ sub: user.id, role: user.role });

    const trip = await prisma.trip.create({
      data: {
        userId: user.id,
        name: "Rich Trip",
        startDate: new Date("2026-12-03T00:00:00.000Z"),
        endDate: new Date("2026-12-03T00:00:00.000Z"),
      },
    });

    const day = await prisma.tripDay.create({
      data: {
        tripId: trip.id,
        date: new Date("2026-12-03T00:00:00.000Z"),
        dayIndex: 1,
      },
    });

    const richDoc = JSON.stringify({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Italic activity", marks: [{ type: "italic" }] }],
        },
        {
          type: "image",
          attrs: { src: "https://images.example.com/day-1.webp", alt: "Plan image" },
        },
      ],
    });

    const request = buildRequest(`http://localhost/api/trips/${trip.id}/day-plan-items`, {
      session: token,
      csrf: "csrf-token",
      method: "POST",
      body: JSON.stringify({
        tripDayId: day.id,
        contentJson: richDoc,
        linkUrl: null,
      }),
    });

    const response = await POST(request, { params: { id: trip.id } });
    const payload = (await response.json()) as ApiEnvelope<{
      dayPlanItem: {
        id: string;
        tripDayId: string;
        contentJson: string;
      };
    }>;

    expect(response.status).toBe(200);
    expect(payload.error).toBeNull();
    expect(payload.data?.dayPlanItem.contentJson).toBe(richDoc);
  });

  it("rejects invalid contentJson on create", async () => {
    const user = await prisma.user.create({
      data: { email: "plan-route-invalid@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const token = await createSessionJwt({ sub: user.id, role: user.role });

    const trip = await prisma.trip.create({
      data: {
        userId: user.id,
        name: "Invalid Trip",
        startDate: new Date("2026-12-04T00:00:00.000Z"),
        endDate: new Date("2026-12-04T00:00:00.000Z"),
      },
    });

    const day = await prisma.tripDay.create({
      data: {
        tripId: trip.id,
        date: new Date("2026-12-04T00:00:00.000Z"),
        dayIndex: 1,
      },
    });

    const request = buildRequest(`http://localhost/api/trips/${trip.id}/day-plan-items`, {
      session: token,
      csrf: "csrf-token",
      method: "POST",
      body: JSON.stringify({
        tripDayId: day.id,
        contentJson: " ",
        linkUrl: null,
      }),
    });

    const response = await POST(request, { params: { id: trip.id } });
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(400);
    expect(payload.data).toBeNull();
    expect(payload.error?.code).toBe("validation_error");
  });

  it("rejects unsafe image node URLs on create", async () => {
    const user = await prisma.user.create({
      data: { email: "plan-route-image-url-invalid@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const token = await createSessionJwt({ sub: user.id, role: user.role });

    const trip = await prisma.trip.create({
      data: {
        userId: user.id,
        name: "Invalid Image URL Trip",
        startDate: new Date("2026-12-04T00:00:00.000Z"),
        endDate: new Date("2026-12-04T00:00:00.000Z"),
      },
    });

    const day = await prisma.tripDay.create({
      data: {
        tripId: trip.id,
        date: new Date("2026-12-04T00:00:00.000Z"),
        dayIndex: 1,
      },
    });

    const unsafeDoc = JSON.stringify({
      type: "doc",
      content: [{ type: "image", attrs: { src: "javascript:alert(1)", alt: "Bad image" } }],
    });

    const request = buildRequest(`http://localhost/api/trips/${trip.id}/day-plan-items`, {
      session: token,
      csrf: "csrf-token",
      method: "POST",
      body: JSON.stringify({
        tripDayId: day.id,
        contentJson: unsafeDoc,
        linkUrl: null,
      }),
    });

    const response = await POST(request, { params: { id: trip.id } });
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(400);
    expect(payload.data).toBeNull();
    expect(payload.error?.code).toBe("validation_error");
  });

  it("rejects non-http linkUrl on create", async () => {
    const user = await prisma.user.create({
      data: { email: "plan-route-link-url-invalid@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const token = await createSessionJwt({ sub: user.id, role: user.role });

    const trip = await prisma.trip.create({
      data: {
        userId: user.id,
        name: "Invalid Link URL Trip",
        startDate: new Date("2026-12-04T00:00:00.000Z"),
        endDate: new Date("2026-12-04T00:00:00.000Z"),
      },
    });

    const day = await prisma.tripDay.create({
      data: {
        tripId: trip.id,
        date: new Date("2026-12-04T00:00:00.000Z"),
        dayIndex: 1,
      },
    });

    const request = buildRequest(`http://localhost/api/trips/${trip.id}/day-plan-items`, {
      session: token,
      csrf: "csrf-token",
      method: "POST",
      body: JSON.stringify({
        tripDayId: day.id,
        contentJson: sampleDoc("Plan"),
        linkUrl: "javascript:alert(1)",
      }),
    });

    const response = await POST(request, { params: { id: trip.id } });
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(400);
    expect(payload.data).toBeNull();
    expect(payload.error?.code).toBe("validation_error");
  });

  it("rejects partial location coordinates on create", async () => {
    const user = await prisma.user.create({
      data: { email: "plan-route-location-invalid@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const token = await createSessionJwt({ sub: user.id, role: user.role });

    const trip = await prisma.trip.create({
      data: {
        userId: user.id,
        name: "Invalid Location Trip",
        startDate: new Date("2026-12-04T00:00:00.000Z"),
        endDate: new Date("2026-12-04T00:00:00.000Z"),
      },
    });

    const day = await prisma.tripDay.create({
      data: {
        tripId: trip.id,
        date: new Date("2026-12-04T00:00:00.000Z"),
        dayIndex: 1,
      },
    });

    const request = buildRequest(`http://localhost/api/trips/${trip.id}/day-plan-items`, {
      session: token,
      csrf: "csrf-token",
      method: "POST",
      body: JSON.stringify({
        tripDayId: day.id,
        contentJson: sampleDoc("Has partial location"),
        linkUrl: null,
        location: { lat: 48.145 },
      }),
    });

    const response = await POST(request, { params: { id: trip.id } });
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(400);
    expect(payload.data).toBeNull();
    expect(payload.error?.code).toBe("validation_error");
  });

  it("updates a day plan item for the trip day", async () => {
    const user = await prisma.user.create({
      data: { email: "plan-route-update@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const token = await createSessionJwt({ sub: user.id, role: user.role });

    const trip = await prisma.trip.create({
      data: {
        userId: user.id,
        name: "Update Trip",
        startDate: new Date("2026-12-05T00:00:00.000Z"),
        endDate: new Date("2026-12-05T00:00:00.000Z"),
      },
    });

    const day = await prisma.tripDay.create({
      data: {
        tripId: trip.id,
        date: new Date("2026-12-05T00:00:00.000Z"),
        dayIndex: 1,
      },
    });

    const item = await prisma.dayPlanItem.create({
      data: {
        tripDayId: day.id,
        contentJson: sampleDoc("Original"),
        linkUrl: null,
      },
    });

    const request = buildRequest(`http://localhost/api/trips/${trip.id}/day-plan-items`, {
      session: token,
      csrf: "csrf-token",
      method: "PATCH",
      body: JSON.stringify({
        tripDayId: day.id,
        itemId: item.id,
        contentJson: sampleDoc("Updated"),
        costCents: 2800,
        linkUrl: "https://example.com/updated",
        location: { lat: 48.13, lng: 11.56, label: "Center" },
      }),
    });

    const response = await PATCH(request, { params: { id: trip.id } });
    const payload = (await response.json()) as ApiEnvelope<{
      dayPlanItem: {
        id: string;
        contentJson: string;
        costCents: number | null;
        location: { lat: number; lng: number; label: string | null } | null;
      };
    }>;

    expect(response.status).toBe(200);
    expect(payload.error).toBeNull();
    expect(payload.data?.dayPlanItem.contentJson).toContain("Updated");
    expect(payload.data?.dayPlanItem.costCents).toBe(2800);
    expect(payload.data?.dayPlanItem.location).toEqual({ lat: 48.13, lng: 11.56, label: "Center" });
  });

  it("deletes a day plan item for the trip day", async () => {
    const user = await prisma.user.create({
      data: { email: "plan-route-delete@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const token = await createSessionJwt({ sub: user.id, role: user.role });

    const trip = await prisma.trip.create({
      data: {
        userId: user.id,
        name: "Delete Trip",
        startDate: new Date("2026-12-06T00:00:00.000Z"),
        endDate: new Date("2026-12-06T00:00:00.000Z"),
      },
    });

    const day = await prisma.tripDay.create({
      data: {
        tripId: trip.id,
        date: new Date("2026-12-06T00:00:00.000Z"),
        dayIndex: 1,
      },
    });

    const item = await prisma.dayPlanItem.create({
      data: {
        tripDayId: day.id,
        contentJson: sampleDoc("Delete"),
        linkUrl: null,
      },
    });

    const request = buildRequest(`http://localhost/api/trips/${trip.id}/day-plan-items`, {
      session: token,
      csrf: "csrf-token",
      method: "DELETE",
      body: JSON.stringify({ tripDayId: day.id, itemId: item.id }),
    });

    const response = await DELETE(request, { params: { id: trip.id } });
    const payload = (await response.json()) as ApiEnvelope<{ deleted: boolean }>;

    expect(response.status).toBe(200);
    expect(payload.error).toBeNull();
    expect(payload.data?.deleted).toBe(true);
  });
});
