import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import fs from "node:fs/promises";
import { DELETE, GET, PATCH, POST } from "@/app/api/trips/[id]/day-plan-items/images/route";
import { createSessionJwt } from "@/lib/auth/jwt";
import { prisma } from "@/lib/db/prisma";
import { moveDayPlanItemToTripDay } from "@/lib/repositories/dayPlanItemRepo";
import { getTripsUploadRoot, resolveStoredMediaPath } from "@/lib/trips/uploadPaths";

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

describe("/api/trips/[id]/day-plan-items/images", () => {
  const uploadsRoot = getTripsUploadRoot();

  beforeEach(async () => {
    // Explicit, though `TripMember` cascades from both `Trip` and `User` below. Story 5.13 gave this
    // suite membership rows and a stranger-still-gets-404 assertion in the same commit, and those two
    // facts are only compatible while the cascade holds. Naming the table costs one line and makes
    // the guarantee local, matching the five sibling suites the same story touched.
    await prisma.tripMember.deleteMany();
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
    const viewer = await prisma.user.create({
      data: { email: "day-plan-item-images-viewer@example.com", passwordHash: "hashed", role: "VIEWER" },
    });
    const viewerToken = await createSessionJwt({ sub: viewer.id, role: viewer.role });

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
    await prisma.tripMember.create({
      data: { tripId: trip.id, userId: viewer.id, role: "VIEWER" },
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

    const viewerGetRequest = new NextRequest(
      `http://localhost/api/trips/${trip.id}/day-plan-items/images?tripDayId=${day.id}&dayPlanItemId=${dayPlanItem.id}`,
      {
        method: "GET",
        headers: { cookie: `session=${viewerToken}` },
      },
    );
    const viewerGetResponse = await GET(viewerGetRequest, { params: Promise.resolve({ id: trip.id }) });
    expect(viewerGetResponse.status).toBe(200);

    const batchGetRequest = new NextRequest(
      `http://localhost/api/trips/${trip.id}/day-plan-items/images?tripDayId=${day.id}`,
      {
        method: "GET",
        headers: { cookie: `session=${token}` },
      },
    );
    const batchGetResponse = await GET(batchGetRequest, { params: Promise.resolve({ id: trip.id }) });
    const batchGetPayload = (await batchGetResponse.json()) as ApiEnvelope<{
      images: { id: string; dayPlanItemId: string; imageUrl: string; sortOrder: number }[];
    }>;
    expect(batchGetResponse.status).toBe(200);
    expect(batchGetPayload.data?.images).toHaveLength(1);
    expect(batchGetPayload.data?.images[0].dayPlanItemId).toBe(dayPlanItem.id);

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

  /**
   * Story 5.13, AC1/AC4/AC6 - the activity twin of the stay case in `tripAccommodationImagesRoute`. The
   * contributor's account row is deliberately `role: "VIEWER"` so that a regression reading `User.role`
   * instead of `TripMember.role` fails here rather than shipping.
   */
  it("lets a contributor upload, reorder and delete, refuses a viewer 403 forbidden and a stranger 404", async () => {
    const owner = await prisma.user.create({
      data: { email: "day-plan-item-images-role-owner@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const contributor = await prisma.user.create({
      data: { email: "day-plan-item-images-role-contributor@example.com", passwordHash: "hashed", role: "VIEWER" },
    });
    const contributorToken = await createSessionJwt({ sub: contributor.id, role: contributor.role });
    const viewer = await prisma.user.create({
      data: { email: "day-plan-item-images-role-viewer@example.com", passwordHash: "hashed", role: "VIEWER" },
    });
    const viewerToken = await createSessionJwt({ sub: viewer.id, role: viewer.role });
    const stranger = await prisma.user.create({
      data: { email: "day-plan-item-images-role-stranger@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const strangerToken = await createSessionJwt({ sub: stranger.id, role: stranger.role });

    const trip = await prisma.trip.create({
      data: {
        userId: owner.id,
        name: "Day Plan Item Images Roles",
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
          content: [{ type: "paragraph", content: [{ type: "text", text: "Shared stop" }] }],
        }),
      },
    });
    await prisma.tripMember.create({ data: { tripId: trip.id, userId: contributor.id, role: "CONTRIBUTOR" } });
    await prisma.tripMember.create({ data: { tripId: trip.id, userId: viewer.id, role: "VIEWER" } });

    const uploadRequest = (sessionToken: string, fileName: string) => {
      const form = new FormData();
      form.set("tripDayId", day.id);
      form.set("dayPlanItemId", dayPlanItem.id);
      form.set("file", new File([Buffer.from("fake")], fileName, { type: "image/webp" }));
      return new NextRequest(`http://localhost/api/trips/${trip.id}/day-plan-items/images`, {
        method: "POST",
        headers: {
          cookie: `session=${sessionToken}; csrf_token=csrf-token`,
          "x-csrf-token": "csrf-token",
        },
        body: form,
      });
    };

    const jsonRequest = (sessionToken: string, method: "PATCH" | "DELETE", body: unknown) =>
      new NextRequest(`http://localhost/api/trips/${trip.id}/day-plan-items/images`, {
        method,
        headers: {
          "Content-Type": "application/json",
          cookie: `session=${sessionToken}; csrf_token=csrf-token`,
          "x-csrf-token": "csrf-token",
        },
        body: JSON.stringify(body),
      });

    const contributorUpload = await POST(uploadRequest(contributorToken, "contributor.webp"), {
      params: Promise.resolve({ id: trip.id }),
    });
    const contributorUploadPayload = (await contributorUpload.json()) as ApiEnvelope<{ image: { id: string } }>;
    expect(contributorUpload.status).toBe(200);
    expect(contributorUploadPayload.error).toBeNull();
    const imageId = contributorUploadPayload.data!.image.id;
    // Both layers, not just the route: the row is what proves the repository scope moved with the gate.
    expect(await prisma.dayPlanItemImage.findUnique({ where: { id: imageId } })).not.toBeNull();

    const contributorReorder = await PATCH(
      jsonRequest(contributorToken, "PATCH", {
        tripDayId: day.id,
        dayPlanItemId: dayPlanItem.id,
        order: [{ imageId, sortOrder: 1 }],
      }),
      { params: Promise.resolve({ id: trip.id }) },
    );
    expect(contributorReorder.status).toBe(200);

    const viewerUpload = await POST(uploadRequest(viewerToken, "viewer.webp"), {
      params: Promise.resolve({ id: trip.id }),
    });
    expect(viewerUpload.status).toBe(403);
    expect(((await viewerUpload.json()) as ApiEnvelope<null>).error?.code).toBe("forbidden");

    const viewerReorder = await PATCH(
      jsonRequest(viewerToken, "PATCH", {
        tripDayId: day.id,
        dayPlanItemId: dayPlanItem.id,
        order: [{ imageId, sortOrder: 1 }],
      }),
      { params: Promise.resolve({ id: trip.id }) },
    );
    expect(viewerReorder.status).toBe(403);
    expect(((await viewerReorder.json()) as ApiEnvelope<null>).error?.code).toBe("forbidden");

    const viewerDelete = await DELETE(
      jsonRequest(viewerToken, "DELETE", { tripDayId: day.id, dayPlanItemId: dayPlanItem.id, imageId }),
      { params: Promise.resolve({ id: trip.id }) },
    );
    expect(viewerDelete.status).toBe(403);
    expect(((await viewerDelete.json()) as ApiEnvelope<null>).error?.code).toBe("forbidden");
    expect(await prisma.dayPlanItemImage.findUnique({ where: { id: imageId } })).not.toBeNull();

    // The stranger keeps 404 on every verb: AC6 moves the *role* refusal only.
    const strangerUpload = await POST(uploadRequest(strangerToken, "stranger.webp"), {
      params: Promise.resolve({ id: trip.id }),
    });
    expect(strangerUpload.status).toBe(404);
    expect(((await strangerUpload.json()) as ApiEnvelope<null>).error?.code).toBe("not_found");

    const strangerReorder = await PATCH(
      jsonRequest(strangerToken, "PATCH", {
        tripDayId: day.id,
        dayPlanItemId: dayPlanItem.id,
        order: [{ imageId, sortOrder: 1 }],
      }),
      { params: Promise.resolve({ id: trip.id }) },
    );
    expect(strangerReorder.status).toBe(404);

    const contributorDelete = await DELETE(
      jsonRequest(contributorToken, "DELETE", { tripDayId: day.id, dayPlanItemId: dayPlanItem.id, imageId }),
      { params: Promise.resolve({ id: trip.id }) },
    );
    expect(contributorDelete.status).toBe(200);
    expect(await prisma.dayPlanItemImage.findUnique({ where: { id: imageId } })).toBeNull();
  });

  /**
   * Story 8.4 / DW-195, AC4 - the activity-photo copy of the case all five media routes carry.
   *
   * The unlink runs *after* the row delete has committed, so the deletion the response describes has
   * already happened. Rethrowing a non-`ENOENT` errno turned that into a 500 and a "removal failed"
   * message about a row that no longer existed, and sent the user back to retry a delete that could only
   * ever answer 404 from then on. It is logged instead: the orphaned bytes are the only remaining record
   * that anything went wrong, so silence would be no better than the 500.
   *
   * Repeated in all five suites rather than shared, because the four route-local helpers this replaces
   * were byte-identical copies - one suite passing is not evidence about the other three, and three fixed
   * with one left behind would make the behaviour depend on which media type the user deleted.
   */
  it("reports the delete that committed when the unlink fails with a non-ENOENT errno", async () => {
    const owner = await prisma.user.create({
      data: { email: "day-plan-item-images-unlink-fails@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const token = await createSessionJwt({ sub: owner.id, role: owner.role });
    const trip = await prisma.trip.create({
      data: {
        userId: owner.id,
        name: "Day Plan Item Images Unlink Fails",
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
          content: [{ type: "paragraph", content: [{ type: "text", text: "Locked stop" }] }],
        }),
      },
    });

    const uploadForm = new FormData();
    uploadForm.set("tripDayId", day.id);
    uploadForm.set("dayPlanItemId", dayPlanItem.id);
    uploadForm.set("file", new File([Buffer.from("fake")], "stop.webp", { type: "image/webp" }));
    const uploadResponse = await POST(
      new NextRequest(`http://localhost/api/trips/${trip.id}/day-plan-items/images`, {
        method: "POST",
        headers: { cookie: `session=${token}; csrf_token=csrf-token`, "x-csrf-token": "csrf-token" },
        body: uploadForm,
      }),
      { params: Promise.resolve({ id: trip.id }) },
    );
    expect(uploadResponse.status).toBe(200);

    const row = await prisma.dayPlanItemImage.findFirstOrThrow({ where: { dayPlanItemId: dayPlanItem.id } });
    const filePath = resolveStoredMediaPath(row.imageUrl);

    const permissionDenied = new Error(`EACCES: permission denied, unlink '${filePath}'`) as Error & {
      code: string;
    };
    permissionDenied.code = "EACCES";
    const unlinkSpy = vi.spyOn(fs, "unlink").mockRejectedValue(permissionDenied);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const response = await DELETE(
        new NextRequest(`http://localhost/api/trips/${trip.id}/day-plan-items/images`, {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            cookie: `session=${token}; csrf_token=csrf-token`,
            "x-csrf-token": "csrf-token",
          },
          body: JSON.stringify({
            tripDayId: day.id,
            dayPlanItemId: dayPlanItem.id,
            imageId: row.id,
          }),
        }),
        { params: Promise.resolve({ id: trip.id }) },
      );

      expect(response.status).toBe(200);
      expect(((await response.json()) as ApiEnvelope<{ deleted: boolean }>).data?.deleted).toBe(true);
      expect(await prisma.dayPlanItemImage.findUnique({ where: { id: row.id } })).toBeNull();
      expect(consoleSpy).toHaveBeenCalledWith(
        "day plan item image delete: unable to remove media file",
        expect.objectContaining({ filePath, code: "EACCES" }),
      );
    } finally {
      unlinkSpy.mockRestore();
      consoleSpy.mockRestore();
    }
  });

  /**
   * Story 8.4, iteration 5. The sibling of the case above, carried by the same argument.
   *
   * When `readStoredMediaDayId` cannot read a day out of the stored URL there is no file of ours to remove,
   * so the `200` is right - but the outcome is a committed row delete with bytes left on disk, exactly what
   * the containment refusal and the `EACCES` above produce, and both of those log. Iteration 4 added the log
   * line and asserted it on one of the four routes only, which is the same "one suite is not evidence for
   * the rest" this file's AC4 case exists to refuse.
   */
  it("logs rather than skipping silently when the stored url names no day under this trip", async () => {
    const owner = await prisma.user.create({
      data: { email: "day-plan-item-images-no-day-in-url@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const token = await createSessionJwt({ sub: owner.id, role: owner.role });
    const trip = await prisma.trip.create({
      data: {
        userId: owner.id,
        name: "Day Plan Item Images No Day In Url",
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
          content: [{ type: "paragraph", content: [{ type: "text", text: "Drifted stop" }] }],
        }),
      },
    });
    // Parses as a path, but the trip id in it is not this route's, so `readStoredMediaDayId` refuses it.
    const imageUrl = "/uploads/trips/other-trip/days/other-day/day-plan-items/other-item/img-1.webp";
    const row = await prisma.dayPlanItemImage.create({
      data: { dayPlanItemId: dayPlanItem.id, imageUrl, sortOrder: 0 },
    });

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const response = await DELETE(
        new NextRequest(`http://localhost/api/trips/${trip.id}/day-plan-items/images`, {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            cookie: `session=${token}; csrf_token=csrf-token`,
            "x-csrf-token": "csrf-token",
          },
          body: JSON.stringify({ tripDayId: day.id, dayPlanItemId: dayPlanItem.id, imageId: row.id }),
        }),
        { params: Promise.resolve({ id: trip.id }) },
      );

      expect(response.status).toBe(200);
      expect(await prisma.dayPlanItemImage.findUnique({ where: { id: row.id } })).toBeNull();
      // The ids, not `storedUrl` alone. This branch fires precisely when the URL names some *other*
      // trip, so the URL is the one value in the record that cannot be traced back to the row whose
      // bytes were abandoned - which makes it the one value a log of it alone cannot do its job with.
      expect(consoleSpy).toHaveBeenCalledWith(
        "day plan item image delete: stored media url names no day under this trip",
        expect.objectContaining({
          tripId: trip.id,
        dayPlanItemId: dayPlanItem.id,
        imageId: row.id,
          storedUrl: imageUrl,
        }),
      );
    } finally {
      consoleSpy.mockRestore();
    }
  });

  /**
   * Story 8.4 / AC9. An activity's media does not follow the activity between days.
   *
   * `moveDayPlanItemToTripDay` moves an activity with a bare `updateMany` of `tripDayId` - deliberately,
   * so that "everything attached to the activity travels with it for free". No file is moved and no URL
   * is rewritten, so the stored URL keeps naming the day the photo was *uploaded* under while the row
   * names the day it is on *now*. A cleanup that composes the directory it is allowed to unlink in out
   * of the request's `tripDayId` therefore looks in the wrong place, refuses, and answers
   * `200 { deleted: true }` with the bytes still on disk - orphaned for good, because the row that named
   * them is gone.
   *
   * So the day segment has to come from the stored URL (`readStoredMediaDayId`), not from the request.
   */
  it("removes the file of a photo uploaded before the activity was moved to another day", async () => {
    const owner = await prisma.user.create({
      data: { email: "day-plan-item-images-moved@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const token = await createSessionJwt({ sub: owner.id, role: owner.role });
    const trip = await prisma.trip.create({
      data: {
        userId: owner.id,
        name: "Day Plan Item Images Moved",
        startDate: new Date("2026-12-21T00:00:00.000Z"),
        endDate: new Date("2026-12-22T00:00:00.000Z"),
      },
    });
    const uploadDay = await prisma.tripDay.create({
      data: { tripId: trip.id, date: new Date("2026-12-21T00:00:00.000Z"), dayIndex: 1 },
    });
    const laterDay = await prisma.tripDay.create({
      data: { tripId: trip.id, date: new Date("2026-12-22T00:00:00.000Z"), dayIndex: 2 },
    });
    const dayPlanItem = await prisma.dayPlanItem.create({
      data: {
        tripDayId: uploadDay.id,
        contentJson: JSON.stringify({
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Moved stop" }] }],
        }),
      },
    });

    const uploadForm = new FormData();
    uploadForm.set("tripDayId", uploadDay.id);
    uploadForm.set("dayPlanItemId", dayPlanItem.id);
    uploadForm.set("file", new File([Buffer.from("fake")], "moved.webp", { type: "image/webp" }));
    const uploadResponse = await POST(
      new NextRequest(`http://localhost/api/trips/${trip.id}/day-plan-items/images`, {
        method: "POST",
        headers: { cookie: `session=${token}; csrf_token=csrf-token`, "x-csrf-token": "csrf-token" },
        body: uploadForm,
      }),
      { params: Promise.resolve({ id: trip.id }) },
    );
    expect(uploadResponse.status).toBe(200);

    const row = await prisma.dayPlanItemImage.findFirstOrThrow({ where: { dayPlanItemId: dayPlanItem.id } });
    const filePath = resolveStoredMediaPath(row.imageUrl);
    expect(await fs.readFile(filePath)).toEqual(Buffer.from("fake"));

    // Through the repository rather than the move route, so the test pins the *data* shape the cleanup
    // has to cope with rather than one HTTP surface's spelling of it.
    const move = await moveDayPlanItemToTripDay({
      userId: owner.id,
      tripId: trip.id,
      tripDayId: uploadDay.id,
      itemId: dayPlanItem.id,
      targetTripDayId: laterDay.id,
    });
    expect(move.status).toBe("moved");
    // The URL still names the upload day - that is the premise, not an incidental detail.
    expect(row.imageUrl).toContain(`/days/${uploadDay.id}/`);

    const response = await DELETE(
      new NextRequest(`http://localhost/api/trips/${trip.id}/day-plan-items/images`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          cookie: `session=${token}; csrf_token=csrf-token`,
          "x-csrf-token": "csrf-token",
        },
        body: JSON.stringify({
          tripDayId: laterDay.id,
          dayPlanItemId: dayPlanItem.id,
          imageId: row.id,
        }),
      }),
      { params: Promise.resolve({ id: trip.id }) },
    );

    expect(response.status).toBe(200);
    expect(await prisma.dayPlanItemImage.findUnique({ where: { id: row.id } })).toBeNull();
    // The assertion that matters: the row going without the file is the orphan AC9 exists to prevent.
    await expect(fs.access(filePath)).rejects.toBeDefined();
  });
});
