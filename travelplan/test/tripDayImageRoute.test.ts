import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { PATCH, POST } from "@/app/api/trips/[id]/days/[dayId]/image/route";
import { prisma } from "@/lib/db/prisma";
import { createSessionJwt } from "@/lib/auth/jwt";
import { createTripWithDays } from "@/lib/repositories/tripRepo";

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

const buildJsonRequest = ({
  tripId,
  dayId,
  session,
  csrf,
  body,
}: {
  tripId: string;
  dayId: string;
  session?: string;
  csrf?: string;
  body?: unknown;
}) => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (session) {
    headers.cookie = `session=${session}`;
  }

  if (csrf) {
    headers.cookie = headers.cookie ? `${headers.cookie}; csrf_token=${csrf}` : `csrf_token=${csrf}`;
    headers["x-csrf-token"] = csrf;
  }

  return new NextRequest(`http://localhost/api/trips/${tripId}/days/${dayId}/image`, {
    method: "PATCH",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
};

const buildUploadRequest = async ({
  tripId,
  dayId,
  session,
  csrf,
  file,
}: {
  tripId: string;
  dayId: string;
  session?: string;
  csrf?: string;
  file?: File | null;
}) => {
  const form = new FormData();
  if (file) {
    form.set("file", file);
  }

  const headers: Record<string, string> = {};
  if (session) {
    headers.cookie = `session=${session}`;
  }
  if (csrf) {
    headers.cookie = headers.cookie ? `${headers.cookie}; csrf_token=${csrf}` : `csrf_token=${csrf}`;
    headers["x-csrf-token"] = csrf;
  }

  return new NextRequest(`http://localhost/api/trips/${tripId}/days/${dayId}/image`, {
    method: "POST",
    headers,
    body: form,
  });
};

describe("PATCH /api/trips/[id]/days/[dayId]/image", () => {
  const uploadsRoot = path.resolve(process.cwd(), "public", "uploads", "trips");

  beforeEach(async () => {
    await prisma.dayPlanItem.deleteMany();
    await prisma.accommodation.deleteMany();
    await prisma.tripDay.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
    await fs.rm(uploadsRoot, { recursive: true, force: true });
  });

  it("rejects unauthenticated requests", async () => {
    const request = buildJsonRequest({
      tripId: "missing-trip",
      dayId: "missing-day",
      csrf: "csrf-token",
      body: { imageUrl: "https://example.com/day.webp", note: "Flight from FRA to SIN" },
    });

    const response = await PATCH(request, {
      params: Promise.resolve({ id: "missing-trip", dayId: "missing-day" }),
    });
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(401);
    expect(payload.error?.code).toBe("unauthorized");
  });

  it("rejects invalid csrf token", async () => {
    const user = await prisma.user.create({
      data: {
        email: "day-image-csrf@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });
    const token = await createSessionJwt({ sub: user.id, role: user.role });

    const request = buildJsonRequest({
      tripId: "trip-id",
      dayId: "day-id",
      session: token,
      body: { imageUrl: "https://example.com/day.webp", note: "Flight from FRA to SIN" },
    });

    const response = await PATCH(request, {
      params: Promise.resolve({ id: "trip-id", dayId: "day-id" }),
    });
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(403);
    expect(payload.error?.code).toBe("csrf_invalid");
  });

  it("rejects invalid payload", async () => {
    const user = await prisma.user.create({
      data: {
        email: "day-image-invalid@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });
    const token = await createSessionJwt({ sub: user.id, role: user.role });

    const request = buildJsonRequest({
      tripId: "trip-id",
      dayId: "day-id",
      session: token,
      csrf: "csrf-token",
      body: { imageUrl: "not-a-url", note: "Flight from FRA to SIN" },
    });

    const response = await PATCH(request, {
      params: Promise.resolve({ id: "trip-id", dayId: "day-id" }),
    });
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(400);
    expect(payload.error?.code).toBe("validation_error");
  });

  it("returns 404 when day is not owned by user", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "day-image-owner@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });
    const other = await prisma.user.create({
      data: {
        email: "day-image-other@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });
    const token = await createSessionJwt({ sub: other.id, role: other.role });

    const { trip } = await createTripWithDays({
      userId: owner.id,
      name: "Owner Trip",
      startDate: "2026-08-01T00:00:00.000Z",
      endDate: "2026-08-01T00:00:00.000Z",
    });
    const day = await prisma.tripDay.findFirstOrThrow({ where: { tripId: trip.id } });

    const request = buildJsonRequest({
      tripId: trip.id,
      dayId: day.id,
      session: token,
      csrf: "csrf-token",
      body: { imageUrl: "https://example.com/day.webp", note: "Flight from FRA to SIN" },
    });

    const response = await PATCH(request, {
      params: Promise.resolve({ id: trip.id, dayId: day.id }),
    });
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(404);
    expect(payload.error?.code).toBe("not_found");
  });

  it("sets and removes day image", async () => {
    const user = await prisma.user.create({
      data: {
        email: "day-image-success@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });
    const token = await createSessionJwt({ sub: user.id, role: user.role });

    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Day Image Trip",
      startDate: "2026-08-01T00:00:00.000Z",
      endDate: "2026-08-01T00:00:00.000Z",
    });
    const day = await prisma.tripDay.findFirstOrThrow({ where: { tripId: trip.id } });

    const setRequest = buildJsonRequest({
      tripId: trip.id,
      dayId: day.id,
      session: token,
      csrf: "csrf-token",
      body: { imageUrl: "https://example.com/day.webp", note: "Flight from FRA to SIN" },
    });

    const setResponse = await PATCH(setRequest, {
      params: Promise.resolve({ id: trip.id, dayId: day.id }),
    });
    const setPayload = (await setResponse.json()) as ApiEnvelope<{ day: { id: string; imageUrl: string | null; note: string | null } }>;

    expect(setResponse.status).toBe(200);
    expect(setPayload.error).toBeNull();
    expect(setPayload.data?.day.imageUrl).toBe("https://example.com/day.webp");
    expect(setPayload.data?.day.note).toBe("Flight from FRA to SIN");

    const removeRequest = buildJsonRequest({
      tripId: trip.id,
      dayId: day.id,
      session: token,
      csrf: "csrf-token",
      body: { imageUrl: null, note: null },
    });

    const removeResponse = await PATCH(removeRequest, {
      params: Promise.resolve({ id: trip.id, dayId: day.id }),
    });
    const removePayload = (await removeResponse.json()) as ApiEnvelope<{ day: { id: string; imageUrl: string | null; note: string | null } }>;

    expect(removeResponse.status).toBe(200);
    expect(removePayload.error).toBeNull();
    expect(removePayload.data?.day.imageUrl).toBeNull();
    expect(removePayload.data?.day.note).toBeNull();
  });

  it("uploads day image file and returns stored image url", async () => {
    const user = await prisma.user.create({
      data: {
        email: "day-image-upload@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });
    const token = await createSessionJwt({ sub: user.id, role: user.role });

    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Day Upload Trip",
      startDate: "2026-08-01T00:00:00.000Z",
      endDate: "2026-08-01T00:00:00.000Z",
    });
    const day = await prisma.tripDay.findFirstOrThrow({ where: { tripId: trip.id } });

    const request = await buildUploadRequest({
      tripId: trip.id,
      dayId: day.id,
      session: token,
      csrf: "csrf-token",
      file: new File([Buffer.from("fake-image")], "day.webp", { type: "image/webp" }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ id: trip.id, dayId: day.id }),
    });
    const payload = (await response.json()) as ApiEnvelope<{ day: { id: string; imageUrl: string | null } }>;

    expect(response.status).toBe(200);
    expect(payload.error).toBeNull();
    expect(payload.data?.day.imageUrl).toBe(`/uploads/trips/${trip.id}/days/${day.id}/day.webp`);
  });

  it("uploads day image file with note in one request", async () => {
    const user = await prisma.user.create({
      data: {
        email: "day-image-upload-note@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });
    const token = await createSessionJwt({ sub: user.id, role: user.role });

    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Day Upload Note Trip",
      startDate: "2026-08-01T00:00:00.000Z",
      endDate: "2026-08-01T00:00:00.000Z",
    });
    const day = await prisma.tripDay.findFirstOrThrow({ where: { tripId: trip.id } });

    const form = new FormData();
    form.set("file", new File([Buffer.from("fake-image")], "day.webp", { type: "image/webp" }));
    form.set("note", "Flight from FRA to SIN");
    const request = new NextRequest(`http://localhost/api/trips/${trip.id}/days/${day.id}/image`, {
      method: "POST",
      headers: {
        cookie: `session=${token}; csrf_token=csrf-token`,
        "x-csrf-token": "csrf-token",
      },
      body: form,
    });

    const response = await POST(request, {
      params: Promise.resolve({ id: trip.id, dayId: day.id }),
    });
    const payload = (await response.json()) as ApiEnvelope<{ day: { id: string; imageUrl: string | null; note: string | null } }>;

    expect(response.status).toBe(200);
    expect(payload.data?.day.note).toBe("Flight from FRA to SIN");
  });

  it("rejects invalid upload file type", async () => {
    const user = await prisma.user.create({
      data: {
        email: "day-image-upload-invalid@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });
    const token = await createSessionJwt({ sub: user.id, role: user.role });

    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Day Upload Invalid Trip",
      startDate: "2026-08-01T00:00:00.000Z",
      endDate: "2026-08-01T00:00:00.000Z",
    });
    const day = await prisma.tripDay.findFirstOrThrow({ where: { tripId: trip.id } });

    const request = await buildUploadRequest({
      tripId: trip.id,
      dayId: day.id,
      session: token,
      csrf: "csrf-token",
      file: new File([Buffer.from("not-image")], "day.txt", { type: "text/plain" }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ id: trip.id, dayId: day.id }),
    });
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(400);
    expect(payload.error?.code).toBe("validation_error");
  });

  it("rejects upload note values over 280 chars", async () => {
    const user = await prisma.user.create({
      data: {
        email: "day-image-upload-note-too-long@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });
    const token = await createSessionJwt({ sub: user.id, role: user.role });

    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Day Upload Note Too Long Trip",
      startDate: "2026-08-01T00:00:00.000Z",
      endDate: "2026-08-01T00:00:00.000Z",
    });
    const day = await prisma.tripDay.findFirstOrThrow({ where: { tripId: trip.id } });

    const form = new FormData();
    form.set("file", new File([Buffer.from("fake-image")], "day.webp", { type: "image/webp" }));
    form.set("note", "a".repeat(281));
    const request = new NextRequest(`http://localhost/api/trips/${trip.id}/days/${day.id}/image`, {
      method: "POST",
      headers: {
        cookie: `session=${token}; csrf_token=csrf-token`,
        "x-csrf-token": "csrf-token",
      },
      body: form,
    });

    const response = await POST(request, {
      params: Promise.resolve({ id: trip.id, dayId: day.id }),
    });
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(400);
    expect(payload.error?.code).toBe("validation_error");
  });

  it("removes existing day upload files when switching to external image url", async () => {
    const user = await prisma.user.create({
      data: {
        email: "day-image-switch-to-external@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });
    const token = await createSessionJwt({ sub: user.id, role: user.role });

    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Day External URL Trip",
      startDate: "2026-08-01T00:00:00.000Z",
      endDate: "2026-08-01T00:00:00.000Z",
    });
    const day = await prisma.tripDay.findFirstOrThrow({ where: { tripId: trip.id } });
    await prisma.tripDay.update({
      where: { id: day.id },
      data: { imageUrl: `/uploads/trips/${trip.id}/days/${day.id}/day.webp` },
    });

    const uploadDir = path.join(uploadsRoot, trip.id, "days", day.id);
    await fs.mkdir(uploadDir, { recursive: true });
    await fs.writeFile(path.join(uploadDir, "day.webp"), Buffer.from("fake-image"));

    const patchRequest = buildJsonRequest({
      tripId: trip.id,
      dayId: day.id,
      session: token,
      csrf: "csrf-token",
      body: { imageUrl: "https://example.com/day-new.webp", note: "External image now" },
    });
    const response = await PATCH(patchRequest, {
      params: Promise.resolve({ id: trip.id, dayId: day.id }),
    });

    expect(response.status).toBe(200);
    await expect(fs.access(path.join(uploadDir, "day.webp"))).rejects.toBeDefined();
  });
});
