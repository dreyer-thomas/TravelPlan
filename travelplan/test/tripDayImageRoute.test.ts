import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { PATCH, POST } from "@/app/api/trips/[id]/days/[dayId]/image/route";
import { prisma } from "@/lib/db/prisma";
import { createSessionJwt } from "@/lib/auth/jwt";
import { createTripWithDays } from "@/lib/repositories/tripRepo";
import { getTripsUploadRoot } from "@/lib/trips/uploadPaths";

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
  const uploadsRoot = getTripsUploadRoot();

  beforeEach(async () => {
    // Explicit, though `TripMember` cascades from both `Trip` and `User` below. Story 5.13 gave this
    // suite membership rows and a non-participant-still-gets-404 assertion in the same commit, and
    // those two facts are only compatible while the cascade holds. Naming the table costs one line
    // and makes the guarantee local, matching the five sibling suites the same story touched.
    await prisma.tripMember.deleteMany();
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

  /**
   * The trip and day are real, and that is not decoration. Story 5.13 moved `refuseUnlessTripWriter`
   * ahead of the body parse in this handler (deliberately: a viewer must not be able to map the payload
   * schema by guessing at a route she may not call), so a request naming a trip that does not exist is
   * answered `404` before zod ever runs. Pointing this case at a literal `"trip-id"` would therefore
   * assert the auth gate rather than the validation it is named for.
   */
  it("rejects invalid payload", async () => {
    const user = await prisma.user.create({
      data: {
        email: "day-image-invalid@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });
    const token = await createSessionJwt({ sub: user.id, role: user.role });

    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Invalid Payload Trip",
      startDate: "2026-08-01T00:00:00.000Z",
      endDate: "2026-08-01T00:00:00.000Z",
    });
    const day = await prisma.tripDay.findFirstOrThrow({ where: { tripId: trip.id } });

    const request = buildJsonRequest({
      tripId: trip.id,
      dayId: day.id,
      session: token,
      csrf: "csrf-token",
      body: { imageUrl: "not-a-url", note: "Flight from FRA to SIN" },
    });

    const response = await PATCH(request, {
      params: Promise.resolve({ id: trip.id, dayId: day.id }),
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

  /**
   * Story 5.13 changed this case from 404 to 403. The viewer is still refused - AC4 - but she holds a
   * membership on this trip and can see the day on her screen, so answering "it is not there" was a
   * false statement that the client could not tell apart from a broken app. The 404 above, for someone
   * with no membership at all, is unchanged.
   */
  it("returns 403 forbidden and names the reason when a viewer tries to upload a day image", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "day-image-viewer-owner@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });
    const viewer = await prisma.user.create({
      data: {
        email: "day-image-viewer@example.com",
        passwordHash: "hashed",
        role: "VIEWER",
      },
    });
    const token = await createSessionJwt({ sub: viewer.id, role: viewer.role });

    const { trip } = await createTripWithDays({
      userId: owner.id,
      name: "Viewer Upload Trip",
      startDate: "2026-08-01T00:00:00.000Z",
      endDate: "2026-08-01T00:00:00.000Z",
    });
    const day = await prisma.tripDay.findFirstOrThrow({ where: { tripId: trip.id } });
    await prisma.tripMember.create({
      data: {
        tripId: trip.id,
        userId: viewer.id,
        role: "VIEWER",
      },
    });

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
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(403);
    expect(payload.error?.code).toBe("forbidden");
    await expect(fs.access(path.join(uploadsRoot, trip.id, "days", day.id, "day.webp"))).rejects.toBeDefined();
  });

  /**
   * Story 5.13, AC2/AC4/AC6. A day image is content of a day, and a contributor already fills that day
   * with stays and activities, so both verbs move together with the repository scope behind them.
   *
   * The contributor's account row is `role: "VIEWER"` on purpose: the route must decide on
   * `TripMember.role` and never on `User.role`.
   */
  it("lets a contributor upload and clear a day image, and still answers 404 to a non-participant", async () => {
    const owner = await prisma.user.create({
      data: { email: "day-image-contributor-owner@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const contributor = await prisma.user.create({
      data: { email: "day-image-contributor@example.com", passwordHash: "hashed", role: "VIEWER" },
    });
    const contributorToken = await createSessionJwt({ sub: contributor.id, role: contributor.role });
    const stranger = await prisma.user.create({
      data: { email: "day-image-contributor-stranger@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const strangerToken = await createSessionJwt({ sub: stranger.id, role: stranger.role });

    const { trip } = await createTripWithDays({
      userId: owner.id,
      name: "Contributor Day Image Trip",
      startDate: "2026-08-01T00:00:00.000Z",
      endDate: "2026-08-01T00:00:00.000Z",
    });
    const day = await prisma.tripDay.findFirstOrThrow({ where: { tripId: trip.id } });
    await prisma.tripMember.create({ data: { tripId: trip.id, userId: contributor.id, role: "CONTRIBUTOR" } });

    const uploadResponse = await POST(
      await buildUploadRequest({
        tripId: trip.id,
        dayId: day.id,
        session: contributorToken,
        csrf: "csrf-token",
        file: new File([Buffer.from("fake-image")], "day.webp", { type: "image/webp" }),
      }),
      { params: Promise.resolve({ id: trip.id, dayId: day.id }) },
    );
    const uploadPayload = (await uploadResponse.json()) as ApiEnvelope<{ day: { imageUrl: string | null } }>;
    expect(uploadResponse.status).toBe(200);
    expect(uploadPayload.error).toBeNull();
    expect(uploadPayload.data?.day.imageUrl).toBe(`/uploads/trips/${trip.id}/days/${day.id}/day.webp`);
    // Both layers: `updateTripDayImageForUser`'s own day lookup had to move with the route gate, or this
    // would have come back as the same 404 as before.
    expect(await prisma.tripDay.findUniqueOrThrow({ where: { id: day.id } })).toMatchObject({
      imageUrl: `/uploads/trips/${trip.id}/days/${day.id}/day.webp`,
    });

    const clearResponse = await PATCH(
      buildJsonRequest({
        tripId: trip.id,
        dayId: day.id,
        session: contributorToken,
        csrf: "csrf-token",
        body: { imageUrl: null, note: null },
      }),
      { params: Promise.resolve({ id: trip.id, dayId: day.id }) },
    );
    const clearPayload = (await clearResponse.json()) as ApiEnvelope<{ day: { imageUrl: string | null } }>;
    expect(clearResponse.status).toBe(200);
    expect(clearPayload.data?.day.imageUrl).toBeNull();

    // No membership at all: the existence of this trip is still not confirmed to her.
    const strangerResponse = await POST(
      await buildUploadRequest({
        tripId: trip.id,
        dayId: day.id,
        session: strangerToken,
        csrf: "csrf-token",
        file: new File([Buffer.from("fake-image")], "day.webp", { type: "image/webp" }),
      }),
      { params: Promise.resolve({ id: trip.id, dayId: day.id }) },
    );
    expect(strangerResponse.status).toBe(404);
    expect(((await strangerResponse.json()) as ApiEnvelope<null>).error?.code).toBe("not_found");
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

  it("accepts jpg uploads reported as image/jpg", async () => {
    const user = await prisma.user.create({
      data: {
        email: "day-image-upload-jpg@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });
    const token = await createSessionJwt({ sub: user.id, role: user.role });

    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Day Upload JPG Trip",
      startDate: "2026-08-01T00:00:00.000Z",
      endDate: "2026-08-01T00:00:00.000Z",
    });
    const day = await prisma.tripDay.findFirstOrThrow({ where: { tripId: trip.id } });

    const request = await buildUploadRequest({
      tripId: trip.id,
      dayId: day.id,
      session: token,
      csrf: "csrf-token",
      file: new File([Buffer.from("fake-image")], "day.jpg", { type: "image/jpg" }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ id: trip.id, dayId: day.id }),
    });
    const payload = (await response.json()) as ApiEnvelope<{ day: { id: string; imageUrl: string | null } }>;

    expect(response.status).toBe(200);
    expect(payload.error).toBeNull();
    expect(payload.data?.day.imageUrl).toBe(`/uploads/trips/${trip.id}/days/${day.id}/day.jpg`);
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
