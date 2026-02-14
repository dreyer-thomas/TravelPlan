import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/trips/route";
import { prisma } from "@/lib/db/prisma";
import { createSessionJwt } from "@/lib/auth/jwt";
import { createTripWithDays } from "@/lib/repositories/tripRepo";

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

const buildRequest = (options?: { session?: string }) => {
  const headers: Record<string, string> = {};
  if (options?.session) {
    headers.cookie = `session=${options.session}`;
  }
  return new NextRequest("http://localhost/api/trips", {
    method: "GET",
    headers,
  });
};

describe("GET /api/trips", () => {
  beforeEach(async () => {
    await prisma.tripDay.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
  });

  it("includes heroImageUrl in trip summaries", async () => {
    const user = await prisma.user.create({
      data: {
        email: "trip-list@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });
    const token = await createSessionJwt({ sub: user.id, role: user.role });

    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Hero List Trip",
      startDate: "2026-05-01T00:00:00.000Z",
      endDate: "2026-05-02T00:00:00.000Z",
    });
    await prisma.trip.update({
      where: { id: trip.id },
      data: { heroImageUrl: `/uploads/trips/${trip.id}/hero.png` },
    });

    const request = buildRequest({ session: token });
    const response = await GET(request);
    const payload = (await response.json()) as ApiEnvelope<{
      trips: {
        id: string;
        name: string;
        startDate: string;
        endDate: string;
        dayCount: number;
        heroImageUrl: string | null;
      }[];
    }>;

    expect(response.status).toBe(200);
    expect(payload.error).toBeNull();
    expect(payload.data?.trips[0]?.heroImageUrl).toBe(`/uploads/trips/${trip.id}/hero.png`);
  });
});
