import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/trips/route";
import { prisma } from "@/lib/db/prisma";
import { createSessionJwt } from "@/lib/auth/jwt";

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
interface ApiEnvelope<T> {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
}

const buildRequest = (body: Record<string, unknown>, options?: { csrf?: boolean; session?: string }) => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  const cookies: string[] = [];
  if (options?.csrf !== false) {
    const csrfToken = "test-csrf-token";
    headers["x-csrf-token"] = csrfToken;
    cookies.push(`csrf_token=${csrfToken}`);
  }

  if (options?.session) {
    cookies.push(`session=${options.session}`);
  }

  if (cookies.length > 0) {
    headers.cookie = cookies.join("; ");
  }

  return new NextRequest("http://localhost/api/trips", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
};

describe("POST /api/trips", () => {
  beforeEach(async () => {
    await prisma.tripDay.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
  });

  it("creates a trip and auto-generates days", async () => {
    const user = await prisma.user.create({
      data: {
        email: "trip-owner@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });
    const token = await createSessionJwt({ sub: user.id, role: user.role });

    const request = buildRequest(
      {
        name: "Spring Break",
        startDate: "2026-03-01T00:00:00.000Z",
        endDate: "2026-03-03T00:00:00.000Z",
      },
      { session: token }
    );

    const response = await POST(request);
    const payload = (await response.json()) as ApiEnvelope<{
      trip: { id: string; name: string; startDate: string; endDate: string };
      dayCount: number;
    }>;

    expect(response.status).toBe(200);
    expect(payload.error).toBeNull();
    expect(payload.data?.trip.name).toBe("Spring Break");
    expect(payload.data?.dayCount).toBe(3);
  });

  it("rejects invalid name", async () => {
    const user = await prisma.user.create({
      data: {
        email: "trip-invalid-name@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });
    const token = await createSessionJwt({ sub: user.id, role: user.role });

    const request = buildRequest(
      {
        name: "   ",
        startDate: "2026-03-01T00:00:00.000Z",
        endDate: "2026-03-01T00:00:00.000Z",
      },
      { session: token }
    );

    const response = await POST(request);
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(400);
    expect(payload.data).toBeNull();
    expect(payload.error?.code).toBe("validation_error");
  });

  it("rejects invalid date range", async () => {
    const user = await prisma.user.create({
      data: {
        email: "trip-invalid-range@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });
    const token = await createSessionJwt({ sub: user.id, role: user.role });

    const request = buildRequest(
      {
        name: "Bad Range",
        startDate: "2026-03-05T00:00:00.000Z",
        endDate: "2026-03-03T00:00:00.000Z",
      },
      { session: token }
    );

    const response = await POST(request);
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(400);
    expect(payload.data).toBeNull();
    expect(payload.error?.code).toBe("validation_error");
  });

  it("rejects unauthenticated requests", async () => {
    const request = buildRequest({
      name: "No Auth",
      startDate: "2026-03-01T00:00:00.000Z",
      endDate: "2026-03-01T00:00:00.000Z",
    });

    const response = await POST(request);
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(401);
    expect(payload.data).toBeNull();
    expect(payload.error?.code).toBe("unauthorized");
  });
});
