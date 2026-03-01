import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/trips/[id]/accommodations/copy/route";
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

  return new NextRequest(`http://localhost/api/trips/${tripId}/accommodations/copy`, {
    method: options?.method ?? "POST",
    headers,
    body: options?.body,
  });
};

describe("/api/trips/[id]/accommodations/copy", () => {
  beforeEach(async () => {
    await prisma.accommodation.deleteMany();
    await prisma.tripDay.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
  });

  it("copies the previous-night accommodation", async () => {
    const user = await prisma.user.create({
      data: {
        email: "route-copy-owner@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });
    const token = await createSessionJwt({ sub: user.id, role: user.role });

    const trip = await prisma.trip.create({
      data: {
        userId: user.id,
        name: "Route Copy Trip",
        startDate: new Date("2026-11-01T00:00:00.000Z"),
        endDate: new Date("2026-11-02T00:00:00.000Z"),
      },
    });

    const previousDay = await prisma.tripDay.create({
      data: {
        tripId: trip.id,
        date: new Date("2026-11-01T00:00:00.000Z"),
        dayIndex: 1,
      },
    });

    const currentDay = await prisma.tripDay.create({
      data: {
        tripId: trip.id,
        date: new Date("2026-11-02T00:00:00.000Z"),
        dayIndex: 2,
      },
    });

    await prisma.accommodation.create({
      data: {
        tripDayId: previousDay.id,
        name: "Copy Stay",
        status: "BOOKED",
        costCents: 14000,
        link: "https://example.com/copy",
        notes: "Saved",
        checkInTime: "16:00",
        checkOutTime: "10:30",
        locationLat: 48.1372,
        locationLng: 11.5756,
        locationLabel: "Old Town",
      },
    });

    const request = buildRequest(trip.id, {
      session: token,
      csrf: "csrf-token",
      method: "POST",
      body: JSON.stringify({ tripDayId: currentDay.id }),
    });

    const response = await POST(request, { params: { id: trip.id } });
    const payload = (await response.json()) as ApiEnvelope<{
      accommodation: {
        id: string;
        name: string;
        tripDayId: string;
        status: string;
        costCents: number | null;
        link: string | null;
        notes: string | null;
        checkInTime: string | null;
        checkOutTime: string | null;
        location: { lat: number; lng: number; label: string | null } | null;
      };
    }>;

    expect(response.status).toBe(200);
    expect(payload.error).toBeNull();
    expect(payload.data?.accommodation.tripDayId).toBe(currentDay.id);
    expect(payload.data?.accommodation.name).toBe("Copy Stay");
    expect(payload.data?.accommodation.status).toBe("booked");
    expect(payload.data?.accommodation.costCents).toBeNull();
    expect(payload.data?.accommodation.link).toBe("https://example.com/copy");
    expect(payload.data?.accommodation.notes).toBe("Saved");
    expect(payload.data?.accommodation.checkInTime).toBe("16:00");
    expect(payload.data?.accommodation.checkOutTime).toBe("10:30");
    expect(payload.data?.accommodation.location).toEqual({ lat: 48.1372, lng: 11.5756, label: "Old Town" });
  });

  it("returns not_found when there is no previous-night accommodation", async () => {
    const user = await prisma.user.create({
      data: {
        email: "route-copy-missing@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });
    const token = await createSessionJwt({ sub: user.id, role: user.role });

    const trip = await prisma.trip.create({
      data: {
        userId: user.id,
        name: "Route Copy Trip",
        startDate: new Date("2026-11-03T00:00:00.000Z"),
        endDate: new Date("2026-11-04T00:00:00.000Z"),
      },
    });

    await prisma.tripDay.create({
      data: {
        tripId: trip.id,
        date: new Date("2026-11-03T00:00:00.000Z"),
        dayIndex: 1,
      },
    });

    const currentDay = await prisma.tripDay.create({
      data: {
        tripId: trip.id,
        date: new Date("2026-11-04T00:00:00.000Z"),
        dayIndex: 2,
      },
    });

    const request = buildRequest(trip.id, {
      session: token,
      csrf: "csrf-token",
      method: "POST",
      body: JSON.stringify({ tripDayId: currentDay.id }),
    });

    const response = await POST(request, { params: { id: trip.id } });
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(404);
    expect(payload.data).toBeNull();
    expect(payload.error?.code).toBe("not_found");
  });

  it("returns unauthorized when no session is provided", async () => {
    const request = buildRequest("trip-1", {
      csrf: "csrf-token",
      method: "POST",
      body: JSON.stringify({ tripDayId: "day-1" }),
    });

    const response = await POST(request, { params: { id: "trip-1" } });
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(401);
    expect(payload.data).toBeNull();
    expect(payload.error?.code).toBe("unauthorized");
  });

  it("rejects invalid csrf tokens", async () => {
    const user = await prisma.user.create({
      data: {
        email: "route-copy-csrf@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });
    const token = await createSessionJwt({ sub: user.id, role: user.role });

    const request = buildRequest("trip-1", {
      session: token,
      method: "POST",
      body: JSON.stringify({ tripDayId: "day-1" }),
    });

    const response = await POST(request, { params: { id: "trip-1" } });
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(403);
    expect(payload.data).toBeNull();
    expect(payload.error?.code).toBe("csrf_invalid");
  });

  it("returns not_found for non-owner copy attempts", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "route-copy-owner-2@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });
    const other = await prisma.user.create({
      data: {
        email: "route-copy-other@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });
    const token = await createSessionJwt({ sub: other.id, role: other.role });

    const trip = await prisma.trip.create({
      data: {
        userId: owner.id,
        name: "Route Copy Trip",
        startDate: new Date("2026-11-01T00:00:00.000Z"),
        endDate: new Date("2026-11-02T00:00:00.000Z"),
      },
    });

    const previousDay = await prisma.tripDay.create({
      data: {
        tripId: trip.id,
        date: new Date("2026-11-01T00:00:00.000Z"),
        dayIndex: 1,
      },
    });

    const currentDay = await prisma.tripDay.create({
      data: {
        tripId: trip.id,
        date: new Date("2026-11-02T00:00:00.000Z"),
        dayIndex: 2,
      },
    });

    await prisma.accommodation.create({
      data: {
        tripDayId: previousDay.id,
        name: "Copy Stay",
        status: "BOOKED",
        costCents: 14000,
      },
    });

    const request = buildRequest(trip.id, {
      session: token,
      csrf: "csrf-token",
      method: "POST",
      body: JSON.stringify({ tripDayId: currentDay.id }),
    });

    const response = await POST(request, { params: { id: trip.id } });
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(404);
    expect(payload.data).toBeNull();
    expect(payload.error?.code).toBe("not_found");
  });
});
