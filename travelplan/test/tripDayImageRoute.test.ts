import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { PATCH, POST } from "@/app/api/trips/[id]/days/[dayId]/image/route";
import { prisma } from "@/lib/db/prisma";
import { createSessionJwt } from "@/lib/auth/jwt";
import { createTripWithDays } from "@/lib/repositories/tripRepo";
import { getMediaRoot, getTripsUploadRoot } from "@/lib/trips/uploadPaths";

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

  /**
   * Story 8.4 / DW-194's regression, and the reason the story exists.
   *
   * The day's upload directory is the *parent* of every stay and activity photo and every document on
   * that day (`uploadPaths.ts`), so a cleanup that removed the directory took all of them with it
   * while touching no row: the chips kept rendering and every one of them 404'd. The assertions that
   * matter are the two siblings, not `day.webp` - the pre-fix route passed the `day.webp` half
   * perfectly, which is exactly why nothing caught this.
   *
   * Seeded on disk rather than through the upload routes on purpose: what is being asserted is the
   * blast radius of one `fs` call, and the file layout is the thing under test.
   */
  const seedDayMediaTree = async (tripId: string, dayId: string) => {
    const dayDir = path.join(uploadsRoot, tripId, "days", dayId);
    const stayImageDir = path.join(dayDir, "accommodations", "stay-1");
    const stayDocumentDir = path.join(stayImageDir, "documents");
    await fs.mkdir(stayDocumentDir, { recursive: true });

    const dayImagePath = path.join(dayDir, "day.webp");
    const stayImagePath = path.join(stayImageDir, "img-stay.webp");
    const stayDocumentPath = path.join(stayDocumentDir, "doc-ticket.pdf");
    await fs.writeFile(dayImagePath, Buffer.from("day-cover-bytes"));
    await fs.writeFile(stayImagePath, Buffer.from("stay-photo-bytes"));
    await fs.writeFile(stayDocumentPath, Buffer.from("stay-ticket-bytes"));

    return { dayDir, dayImagePath, stayImagePath, stayDocumentPath };
  };

  const seedDayWithImage = async (email: string, name: string, imageUrl?: string) => {
    const user = await prisma.user.create({
      data: { email, passwordHash: "hashed", role: "OWNER" },
    });
    const token = await createSessionJwt({ sub: user.id, role: user.role });

    const { trip } = await createTripWithDays({
      userId: user.id,
      name,
      startDate: "2026-08-01T00:00:00.000Z",
      endDate: "2026-08-01T00:00:00.000Z",
    });
    const day = await prisma.tripDay.findFirstOrThrow({ where: { tripId: trip.id } });
    await prisma.tripDay.update({
      where: { id: day.id },
      data: { imageUrl: imageUrl ?? `/uploads/trips/${trip.id}/days/${day.id}/day.webp` },
    });

    return { token, trip, day };
  };

  const patchDayMeta = async (
    trip: { id: string },
    day: { id: string },
    token: string,
    body: Record<string, unknown>,
  ) =>
    PATCH(
      buildJsonRequest({
        tripId: trip.id,
        dayId: day.id,
        session: token,
        csrf: "csrf-token",
        body,
      }),
      { params: Promise.resolve({ id: trip.id, dayId: day.id }) },
    );

  const patchImageUrl = async (
    trip: { id: string },
    day: { id: string },
    token: string,
    imageUrl: string | null,
  ) => patchDayMeta(trip, day, token, { imageUrl });

  it("removes only the day image file and leaves the day's stay photo and document intact", async () => {
    const { token, trip, day } = await seedDayWithImage(
      "day-image-sibling-media@example.com",
      "Day Sibling Media Trip",
    );
    const seeded = await seedDayMediaTree(trip.id, day.id);

    const response = await patchImageUrl(trip, day, token, null);

    expect(response.status).toBe(200);
    await expect(fs.access(seeded.dayImagePath)).rejects.toBeDefined();
    // Byte-identical, not merely present: a cleanup that truncated instead of unlinking would be the
    // same loss with a different symptom.
    expect(await fs.readFile(seeded.stayImagePath)).toEqual(Buffer.from("stay-photo-bytes"));
    expect(await fs.readFile(seeded.stayDocumentPath)).toEqual(Buffer.from("stay-ticket-bytes"));
  });

  it("leaves the day's stay photo and document intact when the image moves out of the day directory", async () => {
    // AC2: the trigger has two arms, and a fix that only covered `imageUrl: null` would leave half the
    // defect in place - replacing the cover photo with an external URL destroyed just as much.
    const { token, trip, day } = await seedDayWithImage(
      "day-image-sibling-media-replaced@example.com",
      "Day Sibling Media Replaced Trip",
    );
    const seeded = await seedDayMediaTree(trip.id, day.id);

    const response = await patchImageUrl(trip, day, token, "https://cdn.example.com/day-new.jpg");

    expect(response.status).toBe(200);
    await expect(fs.access(seeded.dayImagePath)).rejects.toBeDefined();
    expect(await fs.readFile(seeded.stayImagePath)).toEqual(Buffer.from("stay-photo-bytes"));
    expect(await fs.readFile(seeded.stayDocumentPath)).toEqual(Buffer.from("stay-ticket-bytes"));
  });

  /**
   * Story 8.4 / AC8, containment. Both of the two cases below are stored URLs a *client* can put in
   * this row - `dayImageUpdateSchema` accepts any string beginning `/uploads/`, with no traversal
   * check - and both satisfy a `startsWith("/uploads/trips/<tripId>/days/<dayId>/")` test, which is
   * why a prefix guard is not a containment check and the rule is
   * `path.dirname(resolved) === path.resolve(allowedDir)` instead.
   *
   * Each asserts two things at once, deliberately: the file outside the day directory is untouched
   * *and* the day's own sibling media is untouched. That is what makes them red for two different
   * reasons - the recursive `fs.rm` destroys the siblings, a prefix-guarded unlink destroys the
   * out-of-directory target - so neither shape of the defect can pass them.
   */
  it("unlinks nothing outside the day directory when the stored url traverses out of it", async () => {
    const { token, trip, day } = await seedDayWithImage(
      "day-image-traversal@example.com",
      "Day Traversal Trip",
    );
    const seeded = await seedDayMediaTree(trip.id, day.id);

    const victimPath = path.join(getMediaRoot(), "victim.txt");
    await fs.writeFile(victimPath, Buffer.from("victim-bytes"));
    // Five `..` from `days/<dayId>/` land on the media root itself, above `uploads/trips` entirely:
    // `resolveStoredMediaPath` + `path.join` normalise this to `<mediaRoot>/victim.txt`.
    await prisma.tripDay.update({
      where: { id: day.id },
      data: {
        imageUrl: `/uploads/trips/${trip.id}/days/${day.id}/../../../../../victim.txt`,
      },
    });

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let response;
    try {
      response = await patchImageUrl(trip, day, token, null);
      // And it says so. A hostile stored URL reaching this branch is the thing most worth seeing in a log.
      expect(consoleSpy).toHaveBeenCalledWith(
        "day image update: refusing to remove media file outside its own directory",
        expect.objectContaining({ filePath: victimPath }),
      );
    } finally {
      consoleSpy.mockRestore();
    }

    expect(response.status).toBe(200);
    expect(await fs.readFile(victimPath)).toEqual(Buffer.from("victim-bytes"));
    expect(await fs.readFile(seeded.stayImagePath)).toEqual(Buffer.from("stay-photo-bytes"));
    expect(await fs.readFile(seeded.stayDocumentPath)).toEqual(Buffer.from("stay-ticket-bytes"));
  });

  it("unlinks nothing when the stored url names a nested stay photo rather than the day's own file", async () => {
    const { token, trip, day } = await seedDayWithImage(
      "day-image-nested-sibling@example.com",
      "Day Nested Sibling Trip",
    );
    const seeded = await seedDayMediaTree(trip.id, day.id);

    // Stay and activity media live *under* `days/<dayId>/` by construction, so this URL passes a day
    // prefix test - and unlinking it would delete a stay photo whose row survives, which is DW-194's
    // own symptom re-entered one file at a time.
    await prisma.tripDay.update({
      where: { id: day.id },
      data: { imageUrl: `/uploads/trips/${trip.id}/days/${day.id}/accommodations/stay-1/img-stay.webp` },
    });

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let response;
    try {
      response = await patchImageUrl(trip, day, token, null);
      // The refusal is *logged*, and this is where that is pinned. It leaves bytes with no row naming
      // them, exactly as an `EACCES` does, so it cannot be the one silent path: a silent version of this
      // branch is how AC9's orphans went unnoticed behind a green suite.
      expect(consoleSpy).toHaveBeenCalledWith(
        "day image update: refusing to remove media file outside its own directory",
        expect.objectContaining({ filePath: seeded.stayImagePath }),
      );
    } finally {
      consoleSpy.mockRestore();
    }

    expect(response.status).toBe(200);
    expect(await fs.readFile(seeded.stayImagePath)).toEqual(Buffer.from("stay-photo-bytes"));
    expect(await fs.readFile(seeded.stayDocumentPath)).toEqual(Buffer.from("stay-ticket-bytes"));
  });

  /**
   * Story 8.4, iteration 4. The cleanup trigger fires on "the previous URL is not the new one", and that
   * makes a *note* save destructive as soon as the client resends an `imageUrl` it is no longer sure
   * about. `TripDayView`'s day-meta save used to post `imageUrl: day.imageUrl ?? null` out of local
   * state; with the row already advanced to `day.png` by another writer, a note-only save from a client
   * still holding `day.webp` set the row back **and unlinked `day.png`** - the file the day was
   * displaying (confirmed by execution).
   *
   * The fix is that the save sends only the field being edited, which removes the lost update itself and
   * not just its filesystem consequence. That is a `PATCH` with no `imageUrl` key at all, so this route
   * has to accept one - `dayImageUpdateSchema` used to require the field, which would have turned the
   * corrected client into a `400`.
   */
  it("keeps the day image and its file when the save carries only a note", async () => {
    const { token, trip, day } = await seedDayWithImage(
      "day-image-note-only-save@example.com",
      "Day Note Only Save Trip",
    );
    const seeded = await seedDayMediaTree(trip.id, day.id);

    const response = await patchDayMeta(trip, day, token, { note: "Ferry at 07:40" });
    const payload = (await response.json()) as ApiEnvelope<{ day: { imageUrl: string | null; note: string | null } }>;

    expect(response.status).toBe(200);
    expect(payload.data?.day.note).toBe("Ferry at 07:40");
    // The row is untouched on the field nobody edited...
    expect(payload.data?.day.imageUrl).toBe(`/uploads/trips/${trip.id}/days/${day.id}/day.webp`);
    // ...and so is the file it names, which is the assertion that matters: the destructive version of
    // this answered `200` with a perfectly good row and no bytes behind it.
    expect(await fs.readFile(seeded.dayImagePath)).toEqual(Buffer.from("day-cover-bytes"));
    expect(await fs.readFile(seeded.stayImagePath)).toEqual(Buffer.from("stay-photo-bytes"));
  });

  it("does not unlink the previous file when the request spells the same file differently", async () => {
    // Two spellings of one path are one file, so the trigger compares *resolved paths* rather than raw
    // strings. On a string comparison this `PATCH` reads as a change of image and unlinks the file the row
    // still points at - `path.join` collapses the doubled separator, so both names resolve to the same
    // `day.webp`.
    //
    // The doubled *inner* slash rather than a doubled leading one: `dayImageUpdateSchema` requires a
    // request value to begin `/uploads/` or parse as a URL, so `//uploads/…` cannot arrive this way at all.
    // It can still sit in the row - see the stored-URL case below - which is why the two halves of this
    // amendment need two different spellings.
    const { token, trip, day } = await seedDayWithImage(
      "day-image-same-file-respelled@example.com",
      "Day Same File Respelled Trip",
    );
    const seeded = await seedDayMediaTree(trip.id, day.id);

    const response = await patchImageUrl(trip, day, token, `/uploads//trips/${trip.id}/days/${day.id}/day.webp`);

    expect(response.status).toBe(200);
    expect(await fs.readFile(seeded.dayImagePath)).toEqual(Buffer.from("day-cover-bytes"));
  });

  /**
   * Story 8.4, iteration 5. The same amendment, in the one spelling it was still wrong about: case.
   *
   * The trigger asks "different file?" and the cleanup then asks "inside this day's directory?". Iteration 4
   * made the second question case-insensitive and left the first case-*sensitive*, so these two requests
   * answered *yes* to both - two files, one directory - and the route unlinked the file the row had just been
   * pointed at. Both spellings are reachable: `dayImageUpdateSchema` constrains only the `/uploads/` prefix,
   * so a request can carry any filename case, and a row can hold a case-variant `uploads` segment because
   * rows are written by imports and migrations too.
   *
   * `day.webp` must survive on either kind of filesystem, and for two different reasons: on a
   * case-insensitive one the row's new value *is* that file, and on a case-sensitive one the fold trades a
   * possible orphan for never deleting a live file. That trade is the point - see `mediaPathKey`.
   */
  it("does not unlink the previous file when the two spellings differ only in case", async () => {
    const { token, trip, day } = await seedDayWithImage(
      "day-image-same-file-case@example.com",
      "Day Same File Case Trip",
    );
    const seeded = await seedDayMediaTree(trip.id, day.id);

    // The request spells the filename differently from the row.
    const renamed = await patchImageUrl(trip, day, token, `/uploads/trips/${trip.id}/days/${day.id}/DAY.webp`);

    expect(renamed.status).toBe(200);
    expect(await fs.readFile(seeded.dayImagePath)).toEqual(Buffer.from("day-cover-bytes"));

    // And the other direction: the *row* carries the case variant and the request re-points at the canonical
    // spelling of the same file, which is what an ordinary save after a v1 import looks like.
    await prisma.tripDay.update({
      where: { id: day.id },
      data: { imageUrl: `/Uploads/trips/${trip.id}/days/${day.id}/day.webp` },
    });

    const recanonicalised = await patchImageUrl(
      trip,
      day,
      token,
      `/uploads/trips/${trip.id}/days/${day.id}/day.webp`,
    );

    expect(recanonicalised.status).toBe(200);
    expect(await fs.readFile(seeded.dayImagePath)).toEqual(Buffer.from("day-cover-bytes"));
    expect(await fs.readFile(seeded.stayImagePath)).toEqual(Buffer.from("stay-photo-bytes"));
  });

  /**
   * The other half of the same amendment, and the more dangerous half. "Is this a media URL?" was a shape
   * test, and every spelling below fails one of the four this story wrote - so the cleanup returned
   * **silently** and left a real file inside the day's own directory behind, with no row naming it and
   * nothing in the logs. There is no shape test for "ours" any more: `isExternalMediaUrl` answers `false`
   * for all of these, and the containment check then does the rest.
   *
   * Four spellings because the shape tests missed different things: the raw `startsWith("/uploads/")`
   * misses the first three, the form that collapses leading slashes first still misses the second and
   * third, and the first-segment form survives those and dies on the fourth, where a `..` pops the segment
   * in front of it. A stored row can hold any of them - unlike a *request* value, which
   * `dayImageUpdateSchema` constrains - because rows are written by imports and migrations as well as by
   * this route.
   */
  it.each([
    ["a doubled leading slash", (t: string, d: string) => `//uploads/trips/${t}/days/${d}/day.webp`],
    ["no leading slash at all", (t: string, d: string) => `uploads/trips/${t}/days/${d}/day.webp`],
    ["a single-dot segment in front", (t: string, d: string) => `/./uploads/trips/${t}/days/${d}/day.webp`],
    ["a segment popped by a following `..`", (t: string, d: string) => `/x/../uploads/trips/${t}/days/${d}/day.webp`],
  ])("removes the previous file when its stored url is spelled with %s", async (label, spell) => {
    const { token, trip, day } = await seedDayWithImage(
      `day-image-respelled-${label.replace(/[^a-z]+/gi, "-")}@example.com`,
      `Day Respelled Stored URL Trip ${label}`,
    );
    const seeded = await seedDayMediaTree(trip.id, day.id);
    await prisma.tripDay.update({
      where: { id: day.id },
      data: { imageUrl: spell(trip.id, day.id) },
    });

    const response = await patchImageUrl(trip, day, token, null);

    expect(response.status).toBe(200);
    await expect(fs.access(seeded.dayImagePath)).rejects.toBeDefined();
    // Still only its own file: the spelling changes what the cleanup recognises, never what it may reach.
    expect(await fs.readFile(seeded.stayImagePath)).toEqual(Buffer.from("stay-photo-bytes"));
    expect(await fs.readFile(seeded.stayDocumentPath)).toEqual(Buffer.from("stay-ticket-bytes"));
  });

  it("succeeds when the previous day image file is already absent", async () => {
    // AC3: the row is the only thing that has to be right. A missing file is the ordinary aftermath of
    // a half-finished earlier cleanup, not a fault the user can act on.
    const { token, trip, day } = await seedDayWithImage(
      "day-image-missing-file@example.com",
      "Day Missing File Trip",
    );

    const response = await patchImageUrl(trip, day, token, null);
    const payload = (await response.json()) as ApiEnvelope<{ day: { imageUrl: string | null } }>;

    expect(response.status).toBe(200);
    expect(payload.data?.day.imageUrl).toBeNull();
  });

  it("unlinks nothing when the previous day image url belongs to another trip", async () => {
    // AC3 / AC8. A v1-imported or drifted value naming someone else's directory must not point this
    // route's unlink at a file it does not own.
    const { token, trip, day } = await seedDayWithImage(
      "day-image-foreign-url@example.com",
      "Day Foreign URL Trip",
      "/uploads/trips/other-trip/hero.jpg",
    );
    const foreignPath = path.join(uploadsRoot, "other-trip", "hero.jpg");
    await fs.mkdir(path.dirname(foreignPath), { recursive: true });
    await fs.writeFile(foreignPath, Buffer.from("other-trip-hero-bytes"));

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let response;
    try {
      response = await patchImageUrl(trip, day, token, null);
      expect(consoleSpy).toHaveBeenCalledWith(
        "day image update: refusing to remove media file outside its own directory",
        expect.objectContaining({ filePath: foreignPath }),
      );
    } finally {
      consoleSpy.mockRestore();
    }

    expect(response.status).toBe(200);
    expect(await fs.readFile(foreignPath)).toEqual(Buffer.from("other-trip-hero-bytes"));
  });

  /**
   * Story 8.4 / DW-195, AC4 - the day-image route's copy of the case the four media suites also carry.
   *
   * The unlink runs *after* the row update has committed, so the change the response describes has
   * already happened. Rethrowing a non-`ENOENT` errno turned that into this handler's `catch` and a
   * 500 for a row that was updated perfectly. The failure is logged instead, because the orphaned
   * bytes are then the only record that anything went wrong - AC4 says log, not ignore.
   */
  it("reports the day image update that committed when the unlink fails with a non-ENOENT errno", async () => {
    const { token, trip, day } = await seedDayWithImage(
      "day-image-unlink-fails@example.com",
      "Day Unlink Fails Trip",
    );
    const dayDir = path.join(uploadsRoot, trip.id, "days", day.id);
    await fs.mkdir(dayDir, { recursive: true });
    await fs.writeFile(path.join(dayDir, "day.webp"), Buffer.from("day-cover-bytes"));

    const permissionDenied = new Error(
      `EACCES: permission denied, unlink '${path.join(dayDir, "day.webp")}'`,
    ) as Error & { code: string };
    permissionDenied.code = "EACCES";
    const unlinkSpy = vi.spyOn(fs, "unlink").mockRejectedValue(permissionDenied);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const response = await patchImageUrl(trip, day, token, null);
      const payload = (await response.json()) as ApiEnvelope<{ day: { imageUrl: string | null } }>;

      expect(response.status).toBe(200);
      expect(payload.data?.day.imageUrl).toBeNull();
      expect(consoleSpy).toHaveBeenCalledWith(
        "day image update: unable to remove media file",
        expect.objectContaining({ filePath: path.join(dayDir, "day.webp"), code: "EACCES" }),
      );
    } finally {
      unlinkSpy.mockRestore();
      consoleSpy.mockRestore();
    }

    expect(await prisma.tripDay.findFirstOrThrow({ where: { id: day.id } })).toMatchObject({
      imageUrl: null,
    });
  });
});
