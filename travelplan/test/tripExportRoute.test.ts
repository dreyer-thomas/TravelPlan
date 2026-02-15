import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/trips/[id]/export/route";
import { prisma } from "@/lib/db/prisma";
import { createSessionJwt } from "@/lib/auth/jwt";
import { createTripWithDays } from "@/lib/repositories/tripRepo";

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

const buildRequest = (tripId: string, options?: { session?: string }) => {
  const headers: Record<string, string> = {};
  if (options?.session) {
    headers.cookie = `session=${options.session}`;
  }

  return new NextRequest(`http://localhost/api/trips/${tripId}/export`, {
    method: "GET",
    headers,
  });
};

describe("GET /api/trips/[id]/export", () => {
  beforeEach(async () => {
    await prisma.dayPlanItem.deleteMany();
    await prisma.accommodation.deleteMany();
    await prisma.tripDay.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
  });

  it("returns downloadable JSON for owned trip", async () => {
    const user = await prisma.user.create({
      data: {
        email: "trip-export-route@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });
    const token = await createSessionJwt({ sub: user.id, role: user.role });

    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Paris / Rome 2026",
      startDate: "2026-11-01T00:00:00.000Z",
      endDate: "2026-11-02T00:00:00.000Z",
    });
    const [day1] = await prisma.tripDay.findMany({
      where: { tripId: trip.id },
      orderBy: { dayIndex: "asc" },
    });
    await prisma.accommodation.create({
      data: {
        tripDayId: day1.id,
        name: "River Hotel",
        status: "BOOKED",
      },
    });

    const request = buildRequest(trip.id, { session: token });
    const response = await GET(request, { params: { id: trip.id } });
    const payload = (await response.json()) as {
      meta: { formatVersion: number; exportedAt: string };
      trip: { id: string; name: string };
      days: unknown[];
    };

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("content-disposition")).toMatch(
      /^attachment; filename="trip-paris-rome-2026-\d{4}-\d{2}-\d{2}\.json"$/
    );
    expect(payload.meta.formatVersion).toBe(1);
    expect(payload.meta.exportedAt).toBe(payload.trip.updatedAt);
    expect(payload.trip.id).toBe(trip.id);
    expect(payload.days).toHaveLength(2);
  });

  it("rejects unauthenticated export requests", async () => {
    const response = await GET(buildRequest("missing-trip"), { params: { id: "missing-trip" } });
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(401);
    expect(payload.data).toBeNull();
    expect(payload.error?.code).toBe("unauthorized");
  });

  it("returns 404 for non-owned or missing trips", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "trip-export-owner@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });
    const other = await prisma.user.create({
      data: {
        email: "trip-export-other@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });
    const otherToken = await createSessionJwt({ sub: other.id, role: other.role });

    const { trip } = await createTripWithDays({
      userId: owner.id,
      name: "Private Trip",
      startDate: "2026-10-01T00:00:00.000Z",
      endDate: "2026-10-02T00:00:00.000Z",
    });

    const response = await GET(buildRequest(trip.id, { session: otherToken }), { params: { id: trip.id } });
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(404);
    expect(payload.error?.code).toBe("not_found");
  });

  it("rejects invalid session token", async () => {
    const response = await GET(buildRequest("trip-1", { session: "not-a-valid-jwt" }), { params: { id: "trip-1" } });
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(401);
    expect(payload.error?.code).toBe("unauthorized");
  });

  it("sanitizes export filename to prevent header injection", async () => {
    const user = await prisma.user.create({
      data: {
        email: "trip-export-filename@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });
    const token = await createSessionJwt({ sub: user.id, role: user.role });

    const { trip } = await createTripWithDays({
      userId: user.id,
      name: 'Trip "\r\nInjected',
      startDate: "2026-11-01T00:00:00.000Z",
      endDate: "2026-11-01T00:00:00.000Z",
    });

    const response = await GET(buildRequest(trip.id, { session: token }), { params: { id: trip.id } });
    const contentDisposition = response.headers.get("content-disposition");

    expect(response.status).toBe(200);
    expect(contentDisposition).toMatch(/^attachment; filename="trip-trip-injected-\d{4}-\d{2}-\d{2}\.json"$/);
    expect(contentDisposition).not.toContain("\r");
    expect(contentDisposition).not.toContain("\n");
  });
});
