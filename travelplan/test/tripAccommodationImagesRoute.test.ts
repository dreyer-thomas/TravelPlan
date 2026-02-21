import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { DELETE, GET, PATCH, POST } from "@/app/api/trips/[id]/accommodations/images/route";
import { createSessionJwt } from "@/lib/auth/jwt";
import { prisma } from "@/lib/db/prisma";

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

describe("/api/trips/[id]/accommodations/images", () => {
  const uploadsRoot = path.resolve(process.cwd(), "public", "uploads", "trips");

  beforeEach(async () => {
    await prisma.accommodationImage.deleteMany();
    await prisma.dayPlanItemImage.deleteMany();
    await prisma.accommodation.deleteMany();
    await prisma.dayPlanItem.deleteMany();
    await prisma.tripDay.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
    await fs.rm(uploadsRoot, { recursive: true, force: true });
  });

  it("enforces auth/csrf/validation and supports upload/list/reorder/delete", async () => {
    const owner = await prisma.user.create({
      data: { email: "accommodation-images-owner@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const token = await createSessionJwt({ sub: owner.id, role: owner.role });
    const other = await prisma.user.create({
      data: { email: "accommodation-images-other@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const otherToken = await createSessionJwt({ sub: other.id, role: other.role });

    const trip = await prisma.trip.create({
      data: {
        userId: owner.id,
        name: "Accommodation Images",
        startDate: new Date("2026-12-20T00:00:00.000Z"),
        endDate: new Date("2026-12-20T00:00:00.000Z"),
      },
    });
    const day = await prisma.tripDay.create({
      data: { tripId: trip.id, date: new Date("2026-12-20T00:00:00.000Z"), dayIndex: 1 },
    });
    const accommodation = await prisma.accommodation.create({
      data: { tripDayId: day.id, name: "Gallery Hotel" },
    });

    const unauthGet = new NextRequest(
      `http://localhost/api/trips/${trip.id}/accommodations/images?tripDayId=${day.id}&accommodationId=${accommodation.id}`,
      { method: "GET" },
    );
    const unauthResponse = await GET(unauthGet, { params: Promise.resolve({ id: trip.id }) });
    expect(unauthResponse.status).toBe(401);

    const noCsrfUploadForm = new FormData();
    noCsrfUploadForm.set("tripDayId", day.id);
    noCsrfUploadForm.set("accommodationId", accommodation.id);
    noCsrfUploadForm.set("file", new File([Buffer.from("fake")], "stay.webp", { type: "image/webp" }));
    const noCsrfUpload = new NextRequest(`http://localhost/api/trips/${trip.id}/accommodations/images`, {
      method: "POST",
      headers: { cookie: `session=${token}` },
      body: noCsrfUploadForm,
    });
    const noCsrfResponse = await POST(noCsrfUpload, { params: Promise.resolve({ id: trip.id }) });
    expect(noCsrfResponse.status).toBe(403);

    const uploadForm = new FormData();
    uploadForm.set("tripDayId", day.id);
    uploadForm.set("accommodationId", accommodation.id);
    uploadForm.set("file", new File([Buffer.from("fake")], "stay.webp", { type: "image/webp" }));
    const upload = new NextRequest(`http://localhost/api/trips/${trip.id}/accommodations/images`, {
      method: "POST",
      headers: {
        cookie: `session=${token}; csrf_token=csrf-token`,
        "x-csrf-token": "csrf-token",
      },
      body: uploadForm,
    });
    const uploadResponse = await POST(upload, { params: Promise.resolve({ id: trip.id }) });
    const uploadPayload = (await uploadResponse.json()) as ApiEnvelope<{ image: { id: string; sortOrder: number } }>;
    expect(uploadResponse.status).toBe(200);
    expect(uploadPayload.error).toBeNull();
    expect(uploadPayload.data?.image.sortOrder).toBe(1);

    const getRequest = new NextRequest(
      `http://localhost/api/trips/${trip.id}/accommodations/images?tripDayId=${day.id}&accommodationId=${accommodation.id}`,
      {
        method: "GET",
        headers: { cookie: `session=${token}` },
      },
    );
    const getResponse = await GET(getRequest, { params: Promise.resolve({ id: trip.id }) });
    const getPayload = (await getResponse.json()) as ApiEnvelope<{ images: { id: string }[] }>;
    expect(getResponse.status).toBe(200);
    expect(getPayload.data?.images).toHaveLength(1);

    const unauthorizedGetRequest = new NextRequest(
      `http://localhost/api/trips/${trip.id}/accommodations/images?tripDayId=${day.id}&accommodationId=${accommodation.id}`,
      {
        method: "GET",
        headers: { cookie: `session=${otherToken}` },
      },
    );
    const unauthorizedGetResponse = await GET(unauthorizedGetRequest, { params: Promise.resolve({ id: trip.id }) });
    expect(unauthorizedGetResponse.status).toBe(404);

    const unauthorizedUploadForm = new FormData();
    unauthorizedUploadForm.set("tripDayId", day.id);
    unauthorizedUploadForm.set("accommodationId", accommodation.id);
    unauthorizedUploadForm.set("file", new File([Buffer.from("fake")], "stay-unauthorized.webp", { type: "image/webp" }));
    const unauthorizedUploadRequest = new NextRequest(`http://localhost/api/trips/${trip.id}/accommodations/images`, {
      method: "POST",
      headers: {
        cookie: `session=${otherToken}; csrf_token=csrf-token`,
        "x-csrf-token": "csrf-token",
      },
      body: unauthorizedUploadForm,
    });
    const unauthorizedUploadResponse = await POST(unauthorizedUploadRequest, { params: Promise.resolve({ id: trip.id }) });
    expect(unauthorizedUploadResponse.status).toBe(404);

    const reorderRequest = new NextRequest(`http://localhost/api/trips/${trip.id}/accommodations/images`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        cookie: `session=${token}; csrf_token=csrf-token`,
        "x-csrf-token": "csrf-token",
      },
      body: JSON.stringify({
        tripDayId: day.id,
        accommodationId: accommodation.id,
        order: [{ imageId: getPayload.data!.images[0].id, sortOrder: 1 }],
      }),
    });
    const reorderResponse = await PATCH(reorderRequest, { params: Promise.resolve({ id: trip.id }) });
    expect(reorderResponse.status).toBe(200);

    const unauthorizedReorderRequest = new NextRequest(`http://localhost/api/trips/${trip.id}/accommodations/images`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        cookie: `session=${otherToken}; csrf_token=csrf-token`,
        "x-csrf-token": "csrf-token",
      },
      body: JSON.stringify({
        tripDayId: day.id,
        accommodationId: accommodation.id,
        order: [{ imageId: getPayload.data!.images[0].id, sortOrder: 1 }],
      }),
    });
    const unauthorizedReorderResponse = await PATCH(unauthorizedReorderRequest, { params: Promise.resolve({ id: trip.id }) });
    expect(unauthorizedReorderResponse.status).toBe(404);

    const deleteRequest = new NextRequest(`http://localhost/api/trips/${trip.id}/accommodations/images`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        cookie: `session=${token}; csrf_token=csrf-token`,
        "x-csrf-token": "csrf-token",
      },
      body: JSON.stringify({
        tripDayId: day.id,
        accommodationId: accommodation.id,
        imageId: getPayload.data!.images[0].id,
      }),
    });
    const deleteResponse = await DELETE(deleteRequest, { params: Promise.resolve({ id: trip.id }) });
    expect(deleteResponse.status).toBe(200);

    const unauthorizedDeleteRequest = new NextRequest(`http://localhost/api/trips/${trip.id}/accommodations/images`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        cookie: `session=${otherToken}; csrf_token=csrf-token`,
        "x-csrf-token": "csrf-token",
      },
      body: JSON.stringify({
        tripDayId: day.id,
        accommodationId: accommodation.id,
        imageId: getPayload.data!.images[0].id,
      }),
    });
    const unauthorizedDeleteResponse = await DELETE(unauthorizedDeleteRequest, { params: Promise.resolve({ id: trip.id }) });
    expect(unauthorizedDeleteResponse.status).toBe(404);
  });
});
