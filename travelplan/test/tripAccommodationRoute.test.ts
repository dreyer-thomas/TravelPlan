import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { DELETE, PATCH, POST } from "@/app/api/trips/[id]/accommodations/route";
import { prisma } from "@/lib/db/prisma";
import { createSessionJwt } from "@/lib/auth/jwt";

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

const buildRequest = (
  tripId: string,
  options?: { session?: string; csrf?: string; method?: string; body?: string }
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

  return new NextRequest(`http://localhost/api/trips/${tripId}/accommodations`, {
    method: options?.method ?? "POST",
    headers,
    body: options?.body,
  });
};

describe("/api/trips/[id]/accommodations", () => {
  beforeEach(async () => {
    await prisma.accommodation.deleteMany();
    await prisma.tripDay.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
  });

  it("creates an accommodation for the trip day", async () => {
    const user = await prisma.user.create({
      data: {
        email: "route-stay-owner@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });
    const token = await createSessionJwt({ sub: user.id, role: user.role });

    const trip = await prisma.trip.create({
      data: {
        userId: user.id,
        name: "Route Trip",
        startDate: new Date("2026-11-01T00:00:00.000Z"),
        endDate: new Date("2026-11-01T00:00:00.000Z"),
      },
    });

    const day = await prisma.tripDay.create({
      data: {
        tripId: trip.id,
        date: new Date("2026-11-01T00:00:00.000Z"),
        dayIndex: 1,
      },
    });

    const request = buildRequest(trip.id, {
      session: token,
      csrf: "csrf-token",
      method: "POST",
      body: JSON.stringify({
        tripDayId: day.id,
        name: "Sunset Hotel",
        status: "booked",
        costCents: 9800,
        link: "https://example.com/sunset",
        notes: "Late arrival",
        location: { lat: 48.1372, lng: 11.5756, label: "Old Town" },
      }),
    });

    const response = await POST(request, { params: { id: trip.id } });
    const payload = (await response.json()) as ApiEnvelope<{
      accommodation: {
        id: string;
        name: string;
        notes: string | null;
        tripDayId: string;
        status: string;
        costCents: number | null;
        link: string | null;
        location: { lat: number; lng: number; label: string | null } | null;
      };
    }>;

    expect(response.status).toBe(200);
    expect(payload.error).toBeNull();
    expect(payload.data?.accommodation.tripDayId).toBe(day.id);
    expect(payload.data?.accommodation.name).toBe("Sunset Hotel");
    expect(payload.data?.accommodation.notes).toBe("Late arrival");
    expect(payload.data?.accommodation.status).toBe("booked");
    expect(payload.data?.accommodation.costCents).toBe(9800);
    expect(payload.data?.accommodation.link).toBe("https://example.com/sunset");
    expect(payload.data?.accommodation.location).toEqual({ lat: 48.1372, lng: 11.5756, label: "Old Town" });
  });

  it("rejects accommodation creation without valid CSRF", async () => {
    const user = await prisma.user.create({
      data: {
        email: "route-stay-csrf@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });
    const token = await createSessionJwt({ sub: user.id, role: user.role });

    const trip = await prisma.trip.create({
      data: {
        userId: user.id,
        name: "Route Trip",
        startDate: new Date("2026-11-02T00:00:00.000Z"),
        endDate: new Date("2026-11-02T00:00:00.000Z"),
      },
    });

    const day = await prisma.tripDay.create({
      data: {
        tripId: trip.id,
        date: new Date("2026-11-02T00:00:00.000Z"),
        dayIndex: 1,
      },
    });

    const request = buildRequest(trip.id, {
      session: token,
      method: "POST",
      body: JSON.stringify({
        tripDayId: day.id,
        name: "CSRF Stay",
        status: "planned",
        costCents: null,
        link: null,
        notes: null,
      }),
    });

    const response = await POST(request, { params: { id: trip.id } });
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(403);
    expect(payload.data).toBeNull();
    expect(payload.error?.code).toBe("csrf_invalid");
  });

  it("updates an accommodation for the trip day", async () => {
    const user = await prisma.user.create({
      data: {
        email: "route-stay-update@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });
    const token = await createSessionJwt({ sub: user.id, role: user.role });

    const trip = await prisma.trip.create({
      data: {
        userId: user.id,
        name: "Route Trip",
        startDate: new Date("2026-11-03T00:00:00.000Z"),
        endDate: new Date("2026-11-03T00:00:00.000Z"),
      },
    });

    const day = await prisma.tripDay.create({
      data: {
        tripId: trip.id,
        date: new Date("2026-11-03T00:00:00.000Z"),
        dayIndex: 1,
      },
    });

    await prisma.accommodation.create({
      data: {
        tripDayId: day.id,
        name: "Initial Stay",
        status: "PLANNED",
        costCents: null,
        link: null,
        notes: null,
      },
    });

    const request = buildRequest(trip.id, {
      session: token,
      csrf: "csrf-token",
      method: "PATCH",
      body: JSON.stringify({
        tripDayId: day.id,
        name: "Updated Stay",
        status: "booked",
        costCents: 15000,
        link: "https://example.com/updated",
        notes: "Window seat",
        location: { lat: 48.145, lng: 11.582, label: "Center" },
      }),
    });

    const response = await PATCH(request, { params: { id: trip.id } });
    const payload = (await response.json()) as ApiEnvelope<{
      accommodation: {
        id: string;
        name: string;
        notes: string | null;
        tripDayId: string;
        status: string;
        costCents: number | null;
        link: string | null;
        location: { lat: number; lng: number; label: string | null } | null;
      };
    }>;

    expect(response.status).toBe(200);
    expect(payload.error).toBeNull();
    expect(payload.data?.accommodation.name).toBe("Updated Stay");
    expect(payload.data?.accommodation.notes).toBe("Window seat");
    expect(payload.data?.accommodation.status).toBe("booked");
    expect(payload.data?.accommodation.costCents).toBe(15000);
    expect(payload.data?.accommodation.link).toBe("https://example.com/updated");
    expect(payload.data?.accommodation.location).toEqual({ lat: 48.145, lng: 11.582, label: "Center" });
  });

  it("returns 404 when updating without an existing accommodation", async () => {
    const user = await prisma.user.create({
      data: {
        email: "route-stay-missing@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });
    const token = await createSessionJwt({ sub: user.id, role: user.role });

    const trip = await prisma.trip.create({
      data: {
        userId: user.id,
        name: "Route Trip",
        startDate: new Date("2026-11-03T00:00:00.000Z"),
        endDate: new Date("2026-11-03T00:00:00.000Z"),
      },
    });

    const day = await prisma.tripDay.create({
      data: {
        tripId: trip.id,
        date: new Date("2026-11-03T00:00:00.000Z"),
        dayIndex: 1,
      },
    });

    const request = buildRequest(trip.id, {
      session: token,
      csrf: "csrf-token",
      method: "PATCH",
      body: JSON.stringify({
        tripDayId: day.id,
        name: "Missing Stay",
        status: "planned",
        costCents: null,
        link: null,
        notes: null,
      }),
    });

    const response = await PATCH(request, { params: { id: trip.id } });
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(404);
    expect(payload.data).toBeNull();
    expect(payload.error?.code).toBe("not_found");
  });

  it("deletes an accommodation for the trip day", async () => {
    const user = await prisma.user.create({
      data: {
        email: "route-stay-delete@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });
    const token = await createSessionJwt({ sub: user.id, role: user.role });

    const trip = await prisma.trip.create({
      data: {
        userId: user.id,
        name: "Route Trip",
        startDate: new Date("2026-11-04T00:00:00.000Z"),
        endDate: new Date("2026-11-04T00:00:00.000Z"),
      },
    });

    const day = await prisma.tripDay.create({
      data: {
        tripId: trip.id,
        date: new Date("2026-11-04T00:00:00.000Z"),
        dayIndex: 1,
      },
    });

    await prisma.accommodation.create({
      data: {
        tripDayId: day.id,
        name: "Delete Stay",
        status: "PLANNED",
        costCents: null,
        link: null,
        notes: null,
      },
    });

    const request = buildRequest(trip.id, {
      session: token,
      csrf: "csrf-token",
      method: "DELETE",
      body: JSON.stringify({ tripDayId: day.id }),
    });

    const response = await DELETE(request, { params: { id: trip.id } });
    const payload = (await response.json()) as ApiEnvelope<{ deleted: boolean }>;

    expect(response.status).toBe(200);
    expect(payload.data?.deleted).toBe(true);
    expect(await prisma.accommodation.count()).toBe(0);
  });

  it("returns 404 when trip day does not belong to user", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "route-stay-owner-2@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });
    const other = await prisma.user.create({
      data: {
        email: "route-stay-other@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });

    const token = await createSessionJwt({ sub: other.id, role: other.role });

    const trip = await prisma.trip.create({
      data: {
        userId: owner.id,
        name: "Private Trip",
        startDate: new Date("2026-11-05T00:00:00.000Z"),
        endDate: new Date("2026-11-05T00:00:00.000Z"),
      },
    });

    const day = await prisma.tripDay.create({
      data: {
        tripId: trip.id,
        date: new Date("2026-11-05T00:00:00.000Z"),
        dayIndex: 1,
      },
    });

    const request = buildRequest(trip.id, {
      session: token,
      csrf: "csrf-token",
      method: "POST",
      body: JSON.stringify({
        tripDayId: day.id,
        name: "Hidden Stay",
        status: "planned",
        costCents: null,
        link: null,
        notes: null,
      }),
    });

    const response = await POST(request, { params: { id: trip.id } });
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(404);
    expect(payload.data).toBeNull();
    expect(payload.error?.code).toBe("not_found");
  });

  it("validates status, cost, and link fields", async () => {
    const user = await prisma.user.create({
      data: {
        email: "route-stay-validate@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });
    const token = await createSessionJwt({ sub: user.id, role: user.role });

    const trip = await prisma.trip.create({
      data: {
        userId: user.id,
        name: "Validation Trip",
        startDate: new Date("2026-11-06T00:00:00.000Z"),
        endDate: new Date("2026-11-06T00:00:00.000Z"),
      },
    });

    const day = await prisma.tripDay.create({
      data: {
        tripId: trip.id,
        date: new Date("2026-11-06T00:00:00.000Z"),
        dayIndex: 1,
      },
    });

    const request = buildRequest(trip.id, {
      session: token,
      csrf: "csrf-token",
      method: "POST",
      body: JSON.stringify({
        tripDayId: day.id,
        name: "Validation Stay",
        status: "invalid-status",
        costCents: -5,
        link: "not-a-url",
        notes: null,
      }),
    });

    const response = await POST(request, { params: { id: trip.id } });
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(400);
    expect(payload.data).toBeNull();
    expect(payload.error?.code).toBe("validation_error");
  });
});
