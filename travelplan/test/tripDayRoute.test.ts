import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/trips/[id]/days/[dayId]/route/route";
import { createSessionJwt } from "@/lib/auth/jwt";
import { prisma } from "@/lib/db/prisma";
import { createTripWithDays } from "@/lib/repositories/tripRepo";

vi.mock("@/lib/routing/dayRouteService", async () => {
  const actual = await vi.importActual<typeof import("@/lib/routing/dayRouteService")>("@/lib/routing/dayRouteService");
  return {
    ...actual,
    getDayRouteFromOsrm: vi.fn(),
  };
});

import { DayRouteError, getDayRouteFromOsrm } from "@/lib/routing/dayRouteService";

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

const buildRequest = (tripId: string, dayId: string, session?: string) => {
  const headers: Record<string, string> = {};
  if (session) {
    headers.cookie = `session=${session}`;
  }
  return new NextRequest(`http://localhost/api/trips/${tripId}/days/${dayId}/route`, {
    method: "GET",
    headers,
  });
};

describe("GET /api/trips/[id]/days/[dayId]/route", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await prisma.dayPlanItem.deleteMany();
    await prisma.accommodation.deleteMany();
    await prisma.tripDay.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
  });

  it("rejects unauthenticated calls", async () => {
    const response = await GET(buildRequest("trip-1", "day-1"), {
      params: Promise.resolve({ id: "trip-1", dayId: "day-1" }),
    });
    const body = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(401);
    expect(body.error?.code).toBe("unauthorized");
  });

  it("rejects malformed route params", async () => {
    const user = await prisma.user.create({
      data: {
        email: "day-route-params@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });
    const session = await createSessionJwt({ sub: user.id, role: user.role });

    const response = await GET(buildRequest("trip-1", "day-1", session), {
      params: Promise.resolve({ id: "", dayId: "   " }),
    });
    const body = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(400);
    expect(body.error?.code).toBe("validation_error");
  });

  it("returns normalized route payload for owner", async () => {
    const user = await prisma.user.create({
      data: {
        email: "day-route-owner@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });
    const session = await createSessionJwt({ sub: user.id, role: user.role });

    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Route Trip",
      startDate: "2026-08-01T00:00:00.000Z",
      endDate: "2026-08-02T00:00:00.000Z",
    });
    const [day1, day2] = await prisma.tripDay.findMany({
      where: { tripId: trip.id },
      orderBy: { dayIndex: "asc" },
    });
    await prisma.accommodation.create({
      data: {
        tripDayId: day1.id,
        name: "Airport Hotel",
        status: "BOOKED",
        locationLat: 48.3538,
        locationLng: 11.7861,
      },
    });
    await prisma.dayPlanItem.create({
      data: {
        tripDayId: day2.id,
        contentJson: JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] }),
        locationLat: 48.1372,
        locationLng: 11.5756,
      },
    });
    await prisma.accommodation.create({
      data: {
        tripDayId: day2.id,
        name: "City Hotel",
        status: "PLANNED",
        locationLat: 48.145,
        locationLng: 11.582,
      },
    });

    vi.mocked(getDayRouteFromOsrm).mockResolvedValue({
      polyline: [
        [48.3538, 11.7861],
        [48.2, 11.6],
        [48.1372, 11.5756],
        [48.145, 11.582],
      ],
      distanceMeters: 12345,
      durationSeconds: 1800,
    });

    const response = await GET(buildRequest(trip.id, day2.id, session), {
      params: Promise.resolve({ id: trip.id, dayId: day2.id }),
    });
    const body = (await response.json()) as ApiEnvelope<{
      points: { id: string; kind: string; lat: number; lng: number }[];
      route: { polyline: [number, number][]; distanceMeters: number | null; durationSeconds: number | null };
    }>;

    expect(response.status).toBe(200);
    expect(body.error).toBeNull();
    expect(body.data?.points.map((point) => point.kind)).toEqual(["previousStay", "planItem", "currentStay"]);
    expect(body.data?.route.polyline).toEqual([
      [48.3538, 11.7861],
      [48.2, 11.6],
      [48.1372, 11.5756],
      [48.145, 11.582],
    ]);
  });

  it("prevents cross-user route access", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "day-route-owner-2@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });
    const other = await prisma.user.create({
      data: {
        email: "day-route-other@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });
    const session = await createSessionJwt({ sub: other.id, role: other.role });

    const { trip } = await createTripWithDays({
      userId: owner.id,
      name: "Private Route Trip",
      startDate: "2026-08-10T00:00:00.000Z",
      endDate: "2026-08-10T00:00:00.000Z",
    });
    const day = await prisma.tripDay.findFirstOrThrow({ where: { tripId: trip.id } });

    const response = await GET(buildRequest(trip.id, day.id, session), {
      params: Promise.resolve({ id: trip.id, dayId: day.id }),
    });
    const body = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(404);
    expect(body.error?.code).toBe("not_found");
  });

  it("returns stable error envelope on routing failure", async () => {
    const user = await prisma.user.create({
      data: {
        email: "day-route-failure@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });
    const session = await createSessionJwt({ sub: user.id, role: user.role });

    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Route Failure Trip",
      startDate: "2026-08-20T00:00:00.000Z",
      endDate: "2026-08-21T00:00:00.000Z",
    });
    const [day1, day2] = await prisma.tripDay.findMany({
      where: { tripId: trip.id },
      orderBy: { dayIndex: "asc" },
    });
    await prisma.accommodation.create({
      data: {
        tripDayId: day1.id,
        name: "Start",
        status: "PLANNED",
        locationLat: 48.3538,
        locationLng: 11.7861,
      },
    });
    await prisma.accommodation.create({
      data: {
        tripDayId: day2.id,
        name: "End",
        status: "PLANNED",
        locationLat: 48.145,
        locationLng: 11.582,
      },
    });

    vi.mocked(getDayRouteFromOsrm).mockRejectedValue(
      new DayRouteError("routing_unavailable", "Routing service unavailable"),
    );

    const response = await GET(buildRequest(trip.id, day2.id, session), {
      params: Promise.resolve({ id: trip.id, dayId: day2.id }),
    });
    const body = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(502);
    expect(body.data).toBeNull();
    expect(body.error?.code).toBe("routing_unavailable");
    expect(body.error?.details).toEqual({
      fallbackPolyline: [
        [48.3538, 11.7861],
        [48.145, 11.582],
      ],
    });
  });
});
