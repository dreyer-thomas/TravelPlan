import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { POST } from "@/app/api/trips/[id]/hero-image/route";
import { prisma } from "@/lib/db/prisma";
import { createSessionJwt } from "@/lib/auth/jwt";
import { createTripWithDays } from "@/lib/repositories/tripRepo";

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

const buildRequest = async (
  tripId: string,
  options: { session?: string; csrf?: string; file?: File | null }
) => {
  const form = new FormData();
  if (options.file) {
    form.set("file", options.file);
  }

  const headers: Record<string, string> = {};
  if (options.session) {
    headers.cookie = `session=${options.session}`;
  }
  if (options.csrf) {
    headers.cookie = headers.cookie ? `${headers.cookie}; csrf_token=${options.csrf}` : `csrf_token=${options.csrf}`;
    headers["x-csrf-token"] = options.csrf;
  }

  return new NextRequest(`http://localhost/api/trips/${tripId}/hero-image`, {
    method: "POST",
    headers,
    body: form,
  });
};

const uploadsRoot = path.resolve(process.cwd(), "public", "uploads", "trips");

describe("POST /api/trips/[id]/hero-image", () => {
  beforeEach(async () => {
    await prisma.tripDay.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
    await fs.rm(uploadsRoot, { recursive: true, force: true });
  });

  it("rejects unauthenticated uploads", async () => {
    const request = await buildRequest("missing-trip", {
      csrf: "csrf-token",
      file: new File([Buffer.from("fake")], "hero.png", { type: "image/png" }),
    });
    const response = await POST(request, { params: { id: "missing-trip" } });
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(401);
    expect(payload.data).toBeNull();
    expect(payload.error?.code).toBe("unauthorized");
  });

  it("rejects invalid file types", async () => {
    const user = await prisma.user.create({
      data: {
        email: "hero-invalid@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });
    const token = await createSessionJwt({ sub: user.id, role: user.role });

    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Invalid Hero Trip",
      startDate: "2026-09-01T00:00:00.000Z",
      endDate: "2026-09-02T00:00:00.000Z",
    });

    const request = await buildRequest(trip.id, {
      session: token,
      csrf: "csrf-token",
      file: new File([Buffer.from("not-an-image")], "hero.txt", { type: "text/plain" }),
    });
    const response = await POST(request, { params: { id: trip.id } });
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(400);
    expect(payload.data).toBeNull();
    expect(payload.error?.code).toBe("validation_error");
  });

  it("does not delete existing hero images for other-user uploads", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "hero-owner@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });
    const other = await prisma.user.create({
      data: {
        email: "hero-other@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });
    const otherToken = await createSessionJwt({ sub: other.id, role: other.role });

    const { trip } = await createTripWithDays({
      userId: owner.id,
      name: "Owner Trip",
      startDate: "2026-12-01T00:00:00.000Z",
      endDate: "2026-12-02T00:00:00.000Z",
    });

    const uploadDir = path.join(uploadsRoot, trip.id);
    await fs.mkdir(uploadDir, { recursive: true });
    const heroPath = path.join(uploadDir, "hero.png");
    await fs.writeFile(heroPath, Buffer.from("existing-hero"));

    const request = await buildRequest(trip.id, {
      session: otherToken,
      csrf: "csrf-token",
      file: new File([Buffer.from("malicious")], "hero.png", { type: "image/png" }),
    });
    const response = await POST(request, { params: { id: trip.id } });
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(404);
    expect(payload.data).toBeNull();
    expect(payload.error?.code).toBe("not_found");
    await expect(fs.readFile(heroPath)).resolves.toBeTruthy();
  });

  it("rejects oversized files", async () => {
    const user = await prisma.user.create({
      data: {
        email: "hero-oversize@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });
    const token = await createSessionJwt({ sub: user.id, role: user.role });

    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Oversize Hero Trip",
      startDate: "2026-10-01T00:00:00.000Z",
      endDate: "2026-10-02T00:00:00.000Z",
    });

    const oversized = Buffer.alloc(5 * 1024 * 1024 + 1);
    const request = await buildRequest(trip.id, {
      session: token,
      csrf: "csrf-token",
      file: new File([oversized], "hero.png", { type: "image/png" }),
    });
    const response = await POST(request, { params: { id: trip.id } });
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(400);
    expect(payload.data).toBeNull();
    expect(payload.error?.code).toBe("validation_error");
  });

  it("stores the hero image and returns the updated trip", async () => {
    const user = await prisma.user.create({
      data: {
        email: "hero-upload@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });
    const token = await createSessionJwt({ sub: user.id, role: user.role });

    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Hero Upload Trip",
      startDate: "2026-11-01T00:00:00.000Z",
      endDate: "2026-11-02T00:00:00.000Z",
    });

    const request = await buildRequest(trip.id, {
      session: token,
      csrf: "csrf-token",
      file: new File([Buffer.from("fake-image")], "hero.webp", { type: "image/webp" }),
    });
    const response = await POST(request, { params: { id: trip.id } });
    const payload = (await response.json()) as ApiEnvelope<{
      trip: { id: string; name: string; startDate: string; endDate: string; dayCount: number; heroImageUrl: string | null };
    }>;

    expect(response.status).toBe(200);
    expect(payload.error).toBeNull();
    expect(payload.data?.trip.id).toBe(trip.id);
    expect(payload.data?.trip.heroImageUrl).toBe(`/uploads/trips/${trip.id}/hero.webp`);
  });
});
