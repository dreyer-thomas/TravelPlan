import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { DELETE, GET, PATCH } from "@/app/api/trips/[id]/route";
import { prisma } from "@/lib/db/prisma";
import { createSessionJwt } from "@/lib/auth/jwt";
import { createTripWithDays } from "@/lib/repositories/tripRepo";

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

  return new NextRequest(`http://localhost/api/trips/${tripId}`, {
    method: options?.method ?? "GET",
    headers,
    body: options?.body,
  });
};

describe("GET /api/trips/[id]", () => {
  beforeEach(async () => {
    await prisma.tripDay.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
  });

  it("returns trip and days for owning user", async () => {
    const user = await prisma.user.create({
      data: {
        email: "trip-owner@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });
    const token = await createSessionJwt({ sub: user.id, role: user.role });

    const { trip, dayCount } = await createTripWithDays({
      userId: user.id,
      name: "Coastal Escape",
      startDate: "2026-05-01T00:00:00.000Z",
      endDate: "2026-05-03T00:00:00.000Z",
    });
    await prisma.trip.update({
      where: { id: trip.id },
      data: { heroImageUrl: `/uploads/trips/${trip.id}/hero.jpg` },
    });

    const days = await prisma.tripDay.findMany({
      where: { tripId: trip.id },
      orderBy: { dayIndex: "asc" },
    });

    await prisma.accommodation.create({
      data: {
        tripDayId: days[0].id,
        name: "Harbor Hotel",
        notes: "Ocean view",
        status: "BOOKED",
        costCents: 17500,
        link: "https://example.com/harbor",
        locationLat: 48.1372,
        locationLng: 11.5756,
        locationLabel: "Harbor",
      },
    });
    await prisma.dayPlanItem.create({
      data: {
        tripDayId: days[1].id,
        contentJson: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Plan" }] }] }),
        costCents: 1400,
        linkUrl: "https://example.com/plan",
        locationLat: 48.145,
        locationLng: 11.582,
        locationLabel: "Museum",
      },
    });
    await prisma.accommodation.create({
      data: {
        tripDayId: days[2].id,
        name: "   ",
        status: "PLANNED",
        costCents: null,
        link: null,
      },
    });
    await prisma.dayPlanItem.create({
      data: {
        tripDayId: days[2].id,
        contentJson: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Notes" }] }] }),
        costCents: null,
        linkUrl: null,
      },
    });

    const request = buildRequest(trip.id, { session: token });
    const response = await GET(request, { params: { id: trip.id } });
    const payload = (await response.json()) as ApiEnvelope<{
      trip: {
        id: string;
        name: string;
        startDate: string;
        endDate: string;
        dayCount: number;
        plannedCostTotal: number;
        accommodationCostTotalCents: number | null;
        heroImageUrl: string | null;
      };
      days: {
        id: string;
        date: string;
        dayIndex: number;
        plannedCostSubtotal: number;
        missingAccommodation: boolean;
        missingPlan: boolean;
        accommodation: {
          id: string;
          name: string;
          notes: string | null;
          status: string;
        costCents: number | null;
        link: string | null;
        location: { lat: number; lng: number; label: string | null } | null;
      } | null;
      dayPlanItems: {
        id: string;
        contentJson: string;
        costCents: number | null;
        linkUrl: string | null;
        location: { lat: number; lng: number; label: string | null } | null;
      }[];
    }[];
    }>;

    expect(response.status).toBe(200);
    expect(payload.error).toBeNull();
    expect(payload.data?.trip.id).toBe(trip.id);
    expect(payload.data?.trip.dayCount).toBe(dayCount);
    expect(payload.data?.trip.plannedCostTotal).toBe(18900);
    expect(payload.data?.trip.accommodationCostTotalCents).toBe(17500);
    expect(payload.data?.trip.heroImageUrl).toBe(`/uploads/trips/${trip.id}/hero.jpg`);
    expect(payload.data?.days.map((day) => day.dayIndex)).toEqual([1, 2, 3]);
    expect(payload.data?.days.map((day) => day.plannedCostSubtotal)).toEqual([17500, 1400, 0]);
    expect(payload.data?.days.map((day) => [day.missingAccommodation, day.missingPlan])).toEqual([
      [false, true],
      [true, false],
      [true, false],
    ]);
    expect(payload.data?.days.map((day) => day.accommodation?.name ?? null)).toEqual([
      "Harbor Hotel",
      null,
      null,
    ]);
    expect(payload.data?.days[0].accommodation?.status).toBe("booked");
    expect(payload.data?.days[0].accommodation?.costCents).toBe(17500);
    expect(payload.data?.days[0].accommodation?.link).toBe("https://example.com/harbor");
    expect(payload.data?.days[0].accommodation?.location).toEqual({ lat: 48.1372, lng: 11.5756, label: "Harbor" });
    expect(payload.data?.days[1].dayPlanItems[0].costCents).toBe(1400);
    expect(payload.data?.days[1].dayPlanItems[0].location).toEqual({ lat: 48.145, lng: 11.582, label: "Museum" });
  });

  it("rejects unauthenticated requests", async () => {
    const request = buildRequest("missing-trip");
    const response = await GET(request, { params: { id: "missing-trip" } });
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(401);
    expect(payload.data).toBeNull();
    expect(payload.error?.code).toBe("unauthorized");
  });

  it("returns 404 for non-existent trip", async () => {
    const user = await prisma.user.create({
      data: {
        email: "trip-missing@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });
    const token = await createSessionJwt({ sub: user.id, role: user.role });

    const request = buildRequest("missing-trip", { session: token });
    const response = await GET(request, { params: { id: "missing-trip" } });
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(404);
    expect(payload.data).toBeNull();
    expect(payload.error?.code).toBe("not_found");
  });

  it("returns 404 for other-user trip", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "trip-owner-2@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });
    const other = await prisma.user.create({
      data: {
        email: "trip-other@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });
    const token = await createSessionJwt({ sub: other.id, role: other.role });

    const { trip } = await createTripWithDays({
      userId: owner.id,
      name: "Private Trip",
      startDate: "2026-06-01T00:00:00.000Z",
      endDate: "2026-06-02T00:00:00.000Z",
    });

    const request = buildRequest(trip.id, { session: token });
    const response = await GET(request, { params: { id: trip.id } });
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(404);
    expect(payload.data).toBeNull();
    expect(payload.error?.code).toBe("not_found");
  });
});

describe("PATCH /api/trips/[id]", () => {
  beforeEach(async () => {
    await prisma.tripDay.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
  });

  it("updates trip details and returns adjusted days", async () => {
    const user = await prisma.user.create({
      data: {
        email: "trip-update-route@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });
    const token = await createSessionJwt({ sub: user.id, role: user.role });

    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Initial Trip",
      startDate: "2026-07-01T00:00:00.000Z",
      endDate: "2026-07-03T00:00:00.000Z",
    });

    const request = buildRequest(trip.id, {
      session: token,
      csrf: "csrf-token",
      method: "PATCH",
      body: JSON.stringify({
        name: "Updated Trip",
        startDate: "2026-07-02T00:00:00.000Z",
        endDate: "2026-07-04T00:00:00.000Z",
      }),
    });

    const response = await PATCH(request, { params: { id: trip.id } });
    const payload = (await response.json()) as ApiEnvelope<{
      trip: {
        id: string;
        name: string;
        startDate: string;
        endDate: string;
        dayCount: number;
        plannedCostTotal: number;
        accommodationCostTotalCents: number | null;
      };
      days: { id: string; date: string; dayIndex: number }[];
    }>;

    expect(response.status).toBe(200);
    expect(payload.error).toBeNull();
    expect(payload.data?.trip.name).toBe("Updated Trip");
    expect(payload.data?.trip.plannedCostTotal).toBe(0);
    expect(payload.data?.trip.accommodationCostTotalCents).toBe(0);
    expect(payload.data?.days.map((day) => day.dayIndex)).toEqual([1, 2, 3]);
    expect(payload.data?.days.map((day) => day.date)).toEqual([
      "2026-07-02T00:00:00.000Z",
      "2026-07-03T00:00:00.000Z",
      "2026-07-04T00:00:00.000Z",
    ]);
    expect(payload.data?.days.map((day) => [day.missingAccommodation, day.missingPlan])).toEqual([
      [true, true],
      [true, true],
      [true, true],
    ]);
  });

  it("rejects unauthorized update requests", async () => {
    const request = buildRequest("missing-trip", {
      csrf: "csrf-token",
      method: "PATCH",
      body: JSON.stringify({
        name: "Updated Trip",
        startDate: "2026-07-02T00:00:00.000Z",
        endDate: "2026-07-04T00:00:00.000Z",
      }),
    });

    const response = await PATCH(request, { params: { id: "missing-trip" } });
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(401);
    expect(payload.data).toBeNull();
    expect(payload.error?.code).toBe("unauthorized");
  });
});

describe("DELETE /api/trips/[id]", () => {
  beforeEach(async () => {
    await prisma.tripDay.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
  });

  it("deletes trip for owning user", async () => {
    const user = await prisma.user.create({
      data: {
        email: "trip-delete-route@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });
    const token = await createSessionJwt({ sub: user.id, role: user.role });

    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Delete Trip",
      startDate: "2026-08-01T00:00:00.000Z",
      endDate: "2026-08-02T00:00:00.000Z",
    });

    const request = buildRequest(trip.id, {
      session: token,
      csrf: "csrf-token",
      method: "DELETE",
    });

    const response = await DELETE(request, { params: { id: trip.id } });
    const payload = (await response.json()) as ApiEnvelope<{ deleted: boolean }>;

    expect(response.status).toBe(200);
    expect(payload.data?.deleted).toBe(true);
    expect(await prisma.trip.count({ where: { id: trip.id } })).toBe(0);
  });

  it("removes hero image uploads when deleting a trip", async () => {
    const user = await prisma.user.create({
      data: {
        email: "trip-delete-cleanup@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });
    const token = await createSessionJwt({ sub: user.id, role: user.role });

    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Delete Trip Uploads",
      startDate: "2026-08-10T00:00:00.000Z",
      endDate: "2026-08-11T00:00:00.000Z",
    });

    const uploadDir = path.join(process.cwd(), "public", "uploads", "trips", trip.id);
    await fs.mkdir(uploadDir, { recursive: true });
    await fs.writeFile(path.join(uploadDir, "hero.png"), Buffer.from("hero"));

    const request = buildRequest(trip.id, {
      session: token,
      csrf: "csrf-token",
      method: "DELETE",
    });

    const response = await DELETE(request, { params: { id: trip.id } });
    const payload = (await response.json()) as ApiEnvelope<{ deleted: boolean }>;

    expect(response.status).toBe(200);
    expect(payload.data?.deleted).toBe(true);
    await expect(fs.stat(uploadDir)).rejects.toThrow();
  });

  it("rejects unauthenticated delete requests", async () => {
    const request = buildRequest("missing-trip", { csrf: "csrf-token", method: "DELETE" });
    const response = await DELETE(request, { params: { id: "missing-trip" } });
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(401);
    expect(payload.data).toBeNull();
    expect(payload.error?.code).toBe("unauthorized");
  });
});
