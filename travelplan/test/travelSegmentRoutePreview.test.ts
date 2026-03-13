import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/trips/[id]/travel-segments/route-preview/route";
import { createSessionJwt } from "@/lib/auth/jwt";
import { prisma } from "@/lib/db/prisma";

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

const buildRequest = (tripId: string, session?: string) => {
  const headers: Record<string, string> = {};
  if (session) {
    headers.cookie = `session=${session}`;
  }
  return new NextRequest(
    `http://localhost/api/trips/${tripId}/travel-segments/route-preview?originLat=52.52&originLng=13.405&destinationLat=48.137&destinationLng=11.575`,
    {
      method: "GET",
      headers,
    },
  );
};

describe("GET /api/trips/[id]/travel-segments/route-preview", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await prisma.tripMember.deleteMany();
    await prisma.tripDay.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
  });

  it("rejects unauthenticated calls", async () => {
    const response = await GET(buildRequest("trip-1"), {
      params: Promise.resolve({ id: "trip-1" }),
    });
    const body = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(401);
    expect(body.error?.code).toBe("unauthorized");
  });

  it("returns normalized route payload for authorized trip access", async () => {
    const user = await prisma.user.create({
      data: { email: "segment-route@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const session = await createSessionJwt({ sub: user.id, role: user.role });
    const trip = await prisma.trip.create({
      data: {
        userId: user.id,
        name: "Route Preview Trip",
        startDate: new Date("2026-12-10T00:00:00.000Z"),
        endDate: new Date("2026-12-10T00:00:00.000Z"),
      },
    });

    vi.mocked(getDayRouteFromOsrm).mockResolvedValue({
      polyline: [
        [52.52, 13.405],
        [48.137, 11.575],
      ],
      distanceMeters: 584321,
      durationSeconds: 20880,
    });

    const response = await GET(buildRequest(trip.id, session), {
      params: Promise.resolve({ id: trip.id }),
    });
    const body = (await response.json()) as ApiEnvelope<{
      route: { polyline: [number, number][]; distanceMeters: number | null; durationSeconds: number | null };
    }>;

    expect(response.status).toBe(200);
    expect(body.error).toBeNull();
    expect(body.data?.route.distanceMeters).toBe(584321);
    expect(body.data?.route.durationSeconds).toBe(20880);
  });

  it("returns fallback error envelope when routing service fails", async () => {
    const user = await prisma.user.create({
      data: { email: "segment-route-failure@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const session = await createSessionJwt({ sub: user.id, role: user.role });
    const trip = await prisma.trip.create({
      data: {
        userId: user.id,
        name: "Route Preview Failure Trip",
        startDate: new Date("2026-12-11T00:00:00.000Z"),
        endDate: new Date("2026-12-11T00:00:00.000Z"),
      },
    });

    vi.mocked(getDayRouteFromOsrm).mockRejectedValue(
      new DayRouteError("routing_unavailable", "Routing service unavailable"),
    );

    const response = await GET(buildRequest(trip.id, session), {
      params: Promise.resolve({ id: trip.id }),
    });
    const body = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(502);
    expect(body.data).toBeNull();
    expect(body.error?.code).toBe("routing_unavailable");
  });
});
