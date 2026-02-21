import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { DELETE, GET, PATCH, POST } from "@/app/api/trips/[id]/day-plan-items/images/route";
import { createSessionJwt } from "@/lib/auth/jwt";
import { prisma } from "@/lib/db/prisma";

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

describe("/api/trips/[id]/day-plan-items/images", () => {
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
      data: { email: "day-plan-item-images-owner@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const token = await createSessionJwt({ sub: owner.id, role: owner.role });
    const other = await prisma.user.create({
      data: { email: "day-plan-item-images-other@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const otherToken = await createSessionJwt({ sub: other.id, role: other.role });

    const trip = await prisma.trip.create({
      data: {
        userId: owner.id,
        name: "Day Plan Item Images",
        startDate: new Date("2026-12-21T00:00:00.000Z"),
        endDate: new Date("2026-12-21T00:00:00.000Z"),
      },
    });
    const day = await prisma.tripDay.create({
      data: { tripId: trip.id, date: new Date("2026-12-21T00:00:00.000Z"), dayIndex: 1 },
    });
    const dayPlanItem = await prisma.dayPlanItem.create({
      data: {
        tripDayId: day.id,
        contentJson: JSON.stringify({
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Gallery stop" }] }],
        }),
      },
    });

    const unauthGet = new NextRequest(
      `http://localhost/api/trips/${trip.id}/day-plan-items/images?tripDayId=${day.id}&dayPlanItemId=${dayPlanItem.id}`,
      { method: "GET" },
    );
    const unauthResponse = await GET(unauthGet, { params: Promise.resolve({ id: trip.id }) });
    expect(unauthResponse.status).toBe(401);

    const uploadForm = new FormData();
    uploadForm.set("tripDayId", day.id);
    uploadForm.set("dayPlanItemId", dayPlanItem.id);
    uploadForm.set("file", new File([Buffer.from("fake")], "item.webp", { type: "image/webp" }));
    const noCsrfUpload = new NextRequest(`http://localhost/api/trips/${trip.id}/day-plan-items/images`, {
      method: "POST",
      headers: { cookie: `session=${token}` },
      body: uploadForm,
    });
    const noCsrfResponse = await POST(noCsrfUpload, { params: Promise.resolve({ id: trip.id }) });
    expect(noCsrfResponse.status).toBe(403);

    const validUploadForm = new FormData();
    validUploadForm.set("tripDayId", day.id);
    validUploadForm.set("dayPlanItemId", dayPlanItem.id);
    validUploadForm.set("file", new File([Buffer.from("fake")], "item.webp", { type: "image/webp" }));
    const uploadRequest = new NextRequest(`http://localhost/api/trips/${trip.id}/day-plan-items/images`, {
      method: "POST",
      headers: {
        cookie: `session=${token}; csrf_token=csrf-token`,
        "x-csrf-token": "csrf-token",
      },
      body: validUploadForm,
    });
    const uploadResponse = await POST(uploadRequest, { params: Promise.resolve({ id: trip.id }) });
    const uploadPayload = (await uploadResponse.json()) as ApiEnvelope<{ image: { id: string } }>;
    expect(uploadResponse.status).toBe(200);
    expect(uploadPayload.error).toBeNull();

    const getRequest = new NextRequest(
      `http://localhost/api/trips/${trip.id}/day-plan-items/images?tripDayId=${day.id}&dayPlanItemId=${dayPlanItem.id}`,
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
      `http://localhost/api/trips/${trip.id}/day-plan-items/images?tripDayId=${day.id}&dayPlanItemId=${dayPlanItem.id}`,
      {
        method: "GET",
        headers: { cookie: `session=${otherToken}` },
      },
    );
    const unauthorizedGetResponse = await GET(unauthorizedGetRequest, { params: Promise.resolve({ id: trip.id }) });
    expect(unauthorizedGetResponse.status).toBe(404);

    const unauthorizedUploadForm = new FormData();
    unauthorizedUploadForm.set("tripDayId", day.id);
    unauthorizedUploadForm.set("dayPlanItemId", dayPlanItem.id);
    unauthorizedUploadForm.set("file", new File([Buffer.from("fake")], "item-unauthorized.webp", { type: "image/webp" }));
    const unauthorizedUploadRequest = new NextRequest(`http://localhost/api/trips/${trip.id}/day-plan-items/images`, {
      method: "POST",
      headers: {
        cookie: `session=${otherToken}; csrf_token=csrf-token`,
        "x-csrf-token": "csrf-token",
      },
      body: unauthorizedUploadForm,
    });
    const unauthorizedUploadResponse = await POST(unauthorizedUploadRequest, { params: Promise.resolve({ id: trip.id }) });
    expect(unauthorizedUploadResponse.status).toBe(404);

    const reorderRequest = new NextRequest(`http://localhost/api/trips/${trip.id}/day-plan-items/images`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        cookie: `session=${token}; csrf_token=csrf-token`,
        "x-csrf-token": "csrf-token",
      },
      body: JSON.stringify({
        tripDayId: day.id,
        dayPlanItemId: dayPlanItem.id,
        order: [{ imageId: getPayload.data!.images[0].id, sortOrder: 1 }],
      }),
    });
    const reorderResponse = await PATCH(reorderRequest, { params: Promise.resolve({ id: trip.id }) });
    expect(reorderResponse.status).toBe(200);

    const unauthorizedReorderRequest = new NextRequest(`http://localhost/api/trips/${trip.id}/day-plan-items/images`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        cookie: `session=${otherToken}; csrf_token=csrf-token`,
        "x-csrf-token": "csrf-token",
      },
      body: JSON.stringify({
        tripDayId: day.id,
        dayPlanItemId: dayPlanItem.id,
        order: [{ imageId: getPayload.data!.images[0].id, sortOrder: 1 }],
      }),
    });
    const unauthorizedReorderResponse = await PATCH(unauthorizedReorderRequest, { params: Promise.resolve({ id: trip.id }) });
    expect(unauthorizedReorderResponse.status).toBe(404);

    const deleteRequest = new NextRequest(`http://localhost/api/trips/${trip.id}/day-plan-items/images`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        cookie: `session=${token}; csrf_token=csrf-token`,
        "x-csrf-token": "csrf-token",
      },
      body: JSON.stringify({
        tripDayId: day.id,
        dayPlanItemId: dayPlanItem.id,
        imageId: getPayload.data!.images[0].id,
      }),
    });
    const deleteResponse = await DELETE(deleteRequest, { params: Promise.resolve({ id: trip.id }) });
    expect(deleteResponse.status).toBe(200);

    const unauthorizedDeleteRequest = new NextRequest(`http://localhost/api/trips/${trip.id}/day-plan-items/images`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        cookie: `session=${otherToken}; csrf_token=csrf-token`,
        "x-csrf-token": "csrf-token",
      },
      body: JSON.stringify({
        tripDayId: day.id,
        dayPlanItemId: dayPlanItem.id,
        imageId: getPayload.data!.images[0].id,
      }),
    });
    const unauthorizedDeleteResponse = await DELETE(unauthorizedDeleteRequest, { params: Promise.resolve({ id: trip.id }) });
    expect(unauthorizedDeleteResponse.status).toBe(404);
  });
});
