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

const buildRequest = (tripId: string, session?: string, mode?: string) => {
  const headers: Record<string, string> = {};
  if (session) {
    headers.cookie = `session=${session}`;
  }
  const query = "originLat=52.52&originLng=13.405&destinationLat=48.137&destinationLng=11.575";
  return new NextRequest(
    `http://localhost/api/trips/${tripId}/travel-segments/route-preview?${query}${mode ? `&mode=${mode}` : ""}`,
    {
      method: "GET",
      headers,
    },
  );
};

const createUserWithTrip = async (email: string) => {
  const user = await prisma.user.create({ data: { email, passwordHash: "hashed", role: "OWNER" } });
  const session = await createSessionJwt({ sub: user.id, role: user.role });
  const trip = await prisma.trip.create({
    data: {
      userId: user.id,
      name: "Route Preview Trip",
      startDate: new Date("2026-12-10T00:00:00.000Z"),
      endDate: new Date("2026-12-10T00:00:00.000Z"),
    },
  });
  return { user, session, trip };
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

  // --- Story 6.16: walking and cycling route import --------------------------------------------

  /**
   * AC4. The wire speaks the app's travel modes; the OSRM profile name is an implementation detail
   * this endpoint owns, so the mapping is asserted on what the service is actually called with.
   */
  it.each([
    ["car", "driving"],
    ["walking", "walking"],
    ["cycling", "cycling"],
  ])("routes mode=%s with the %s profile", async (mode, profile) => {
    const { session, trip } = await createUserWithTrip(`segment-route-${mode}@example.com`);

    vi.mocked(getDayRouteFromOsrm).mockResolvedValue({
      polyline: [
        [52.52, 13.405],
        [48.137, 11.575],
      ],
      distanceMeters: 4200,
      durationSeconds: 3000,
    });

    const response = await GET(buildRequest(trip.id, session, mode), {
      params: Promise.resolve({ id: trip.id }),
    });

    expect(response.status).toBe(200);
    expect(vi.mocked(getDayRouteFromOsrm)).toHaveBeenCalledWith(expect.objectContaining({ profile }));
  });

  it("defaults to the driving profile when no mode is supplied", async () => {
    const { session, trip } = await createUserWithTrip("segment-route-default@example.com");

    vi.mocked(getDayRouteFromOsrm).mockResolvedValue({
      polyline: [
        [52.52, 13.405],
        [48.137, 11.575],
      ],
      distanceMeters: 1,
      durationSeconds: 1,
    });

    const response = await GET(buildRequest(trip.id, session), { params: Promise.resolve({ id: trip.id }) });

    expect(response.status).toBe(200);
    expect(vi.mocked(getDayRouteFromOsrm)).toHaveBeenCalledWith(expect.objectContaining({ profile: "driving" }));
  });

  /**
   * `searchParams.get` returns `""`, not `null`, for `&mode=` and for a bare `&mode`, so a `??`
   * guard lets the empty string through to the enum and the `.default("car")` never fires. Pre-6.16
   * callers are exactly the ones that would send a stripped parameter.
   */
  it.each(["", "&mode"])("defaults to driving for an empty mode parameter (%s)", async (suffix) => {
    const { session, trip } = await createUserWithTrip(`segment-route-empty${suffix.length}@example.com`);

    vi.mocked(getDayRouteFromOsrm).mockResolvedValue({
      polyline: [
        [52.52, 13.405],
        [48.137, 11.575],
      ],
      distanceMeters: 1,
      durationSeconds: 1,
    });

    const query = "originLat=52.52&originLng=13.405&destinationLat=48.137&destinationLng=11.575";
    const url = `http://localhost/api/trips/${trip.id}/travel-segments/route-preview?${query}${suffix || "&mode="}`;
    const response = await GET(new NextRequest(url, { method: "GET", headers: { cookie: `session=${session}` } }), {
      params: Promise.resolve({ id: trip.id }),
    });

    expect(response.status).toBe(200);
    expect(vi.mocked(getDayRouteFromOsrm)).toHaveBeenCalledWith(expect.objectContaining({ profile: "driving" }));
  });

  /**
   * Ship and flight have no routing profile, so they must never reach this endpoint - the dialog
   * sends them down the manual path instead. Rejecting them at the boundary keeps that contract
   * from decaying into a silent car route.
   */
  it.each(["ship", "flight", "teleport"])("rejects mode=%s as unroutable", async (mode) => {
    const { session, trip } = await createUserWithTrip(`segment-route-reject-${mode}@example.com`);

    const response = await GET(buildRequest(trip.id, session, mode), {
      params: Promise.resolve({ id: trip.id }),
    });
    const body = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(400);
    expect(body.error?.code).toBe("validation_error");
    expect(vi.mocked(getDayRouteFromOsrm)).not.toHaveBeenCalled();
  });

  /**
   * Bicycle coverage is patchy in much of the world. "No route for this mode here" is a fact about
   * the request, not an outage, so it keeps its own code and a 404 rather than the 502 an unreachable
   * router gets.
   */
  it("reports an empty routing result as routing_no_route rather than a failure", async () => {
    const { session, trip } = await createUserWithTrip("segment-route-no-route@example.com");

    vi.mocked(getDayRouteFromOsrm).mockRejectedValue(
      new DayRouteError("routing_no_route", "No route available for this travel mode"),
    );

    const response = await GET(buildRequest(trip.id, session, "cycling"), {
      params: Promise.resolve({ id: trip.id }),
    });
    const body = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(404);
    expect(body.data).toBeNull();
    expect(body.error?.code).toBe("routing_no_route");
  });
});
