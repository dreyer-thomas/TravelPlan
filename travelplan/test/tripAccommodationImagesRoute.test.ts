import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import fs from "node:fs/promises";
import { DELETE, GET, PATCH, POST } from "@/app/api/trips/[id]/accommodations/images/route";
import { createSessionJwt } from "@/lib/auth/jwt";
import { prisma } from "@/lib/db/prisma";
import { getTripsUploadRoot, resolveStoredMediaPath } from "@/lib/trips/uploadPaths";

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

describe("/api/trips/[id]/accommodations/images", () => {
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
      data: { email: "accommodation-images-owner@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const token = await createSessionJwt({ sub: owner.id, role: owner.role });
    const other = await prisma.user.create({
      data: { email: "accommodation-images-other@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const otherToken = await createSessionJwt({ sub: other.id, role: other.role });
    const viewer = await prisma.user.create({
      data: { email: "accommodation-images-viewer@example.com", passwordHash: "hashed", role: "VIEWER" },
    });
    const viewerToken = await createSessionJwt({ sub: viewer.id, role: viewer.role });

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
    await prisma.tripMember.create({
      data: { tripId: trip.id, userId: viewer.id, role: "VIEWER" },
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

    const viewerGetRequest = new NextRequest(
      `http://localhost/api/trips/${trip.id}/accommodations/images?tripDayId=${day.id}&accommodationId=${accommodation.id}`,
      {
        method: "GET",
        headers: { cookie: `session=${viewerToken}` },
      },
    );
    const viewerGetResponse = await GET(viewerGetRequest, { params: Promise.resolve({ id: trip.id }) });
    expect(viewerGetResponse.status).toBe(200);

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

  /**
   * Story 5.13, AC1/AC4/AC6. Three roles against one trip, because the story's content is the boundary
   * between them and not any one of them: the contributor writes, the viewer is refused *with a reason*,
   * and the stranger keeps the 404 that refuses to confirm the trip exists at all.
   *
   * The contributor's account row is `role: "VIEWER"` on purpose (the idiom from
   * `tripDayPlanItemsRoute.test.ts`): the route must read `TripMember.role` and never `User.role`, and a
   * matching pair would let a regression that read the wrong one pass.
   */
  it("lets a contributor upload, reorder and delete, refuses a viewer 403 forbidden and a stranger 404", async () => {
    const owner = await prisma.user.create({
      data: { email: "accommodation-images-role-owner@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const contributor = await prisma.user.create({
      data: { email: "accommodation-images-role-contributor@example.com", passwordHash: "hashed", role: "VIEWER" },
    });
    const contributorToken = await createSessionJwt({ sub: contributor.id, role: contributor.role });
    const viewer = await prisma.user.create({
      data: { email: "accommodation-images-role-viewer@example.com", passwordHash: "hashed", role: "VIEWER" },
    });
    const viewerToken = await createSessionJwt({ sub: viewer.id, role: viewer.role });
    const stranger = await prisma.user.create({
      data: { email: "accommodation-images-role-stranger@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const strangerToken = await createSessionJwt({ sub: stranger.id, role: stranger.role });

    const trip = await prisma.trip.create({
      data: {
        userId: owner.id,
        name: "Accommodation Images Roles",
        startDate: new Date("2026-12-20T00:00:00.000Z"),
        endDate: new Date("2026-12-20T00:00:00.000Z"),
      },
    });
    const day = await prisma.tripDay.create({
      data: { tripId: trip.id, date: new Date("2026-12-20T00:00:00.000Z"), dayIndex: 1 },
    });
    const accommodation = await prisma.accommodation.create({
      data: { tripDayId: day.id, name: "Shared Hotel" },
    });
    await prisma.tripMember.create({ data: { tripId: trip.id, userId: contributor.id, role: "CONTRIBUTOR" } });
    await prisma.tripMember.create({ data: { tripId: trip.id, userId: viewer.id, role: "VIEWER" } });

    const uploadRequest = (sessionToken: string, fileName: string) => {
      const form = new FormData();
      form.set("tripDayId", day.id);
      form.set("accommodationId", accommodation.id);
      form.set("file", new File([Buffer.from("fake")], fileName, { type: "image/webp" }));
      return new NextRequest(`http://localhost/api/trips/${trip.id}/accommodations/images`, {
        method: "POST",
        headers: {
          cookie: `session=${sessionToken}; csrf_token=csrf-token`,
          "x-csrf-token": "csrf-token",
        },
        body: form,
      });
    };

    const jsonRequest = (sessionToken: string, method: "PATCH" | "DELETE", body: unknown) =>
      new NextRequest(`http://localhost/api/trips/${trip.id}/accommodations/images`, {
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
    expect(await prisma.accommodationImage.findUnique({ where: { id: imageId } })).not.toBeNull();

    const contributorReorder = await PATCH(
      jsonRequest(contributorToken, "PATCH", {
        tripDayId: day.id,
        accommodationId: accommodation.id,
        order: [{ imageId, sortOrder: 1 }],
      }),
      { params: Promise.resolve({ id: trip.id }) },
    );
    expect(contributorReorder.status).toBe(200);

    const viewerUpload = await POST(uploadRequest(viewerToken, "viewer.webp"), {
      params: Promise.resolve({ id: trip.id }),
    });
    const viewerUploadPayload = (await viewerUpload.json()) as ApiEnvelope<null>;
    expect(viewerUpload.status).toBe(403);
    expect(viewerUploadPayload.error?.code).toBe("forbidden");

    const viewerReorder = await PATCH(
      jsonRequest(viewerToken, "PATCH", {
        tripDayId: day.id,
        accommodationId: accommodation.id,
        order: [{ imageId, sortOrder: 1 }],
      }),
      { params: Promise.resolve({ id: trip.id }) },
    );
    expect(viewerReorder.status).toBe(403);
    expect(((await viewerReorder.json()) as ApiEnvelope<null>).error?.code).toBe("forbidden");

    const viewerDelete = await DELETE(
      jsonRequest(viewerToken, "DELETE", { tripDayId: day.id, accommodationId: accommodation.id, imageId }),
      { params: Promise.resolve({ id: trip.id }) },
    );
    expect(viewerDelete.status).toBe(403);
    expect(((await viewerDelete.json()) as ApiEnvelope<null>).error?.code).toBe("forbidden");
    expect(await prisma.accommodationImage.findUnique({ where: { id: imageId } })).not.toBeNull();

    // The stranger keeps 404 on every verb: AC6 moves the *role* refusal only.
    const strangerUpload = await POST(uploadRequest(strangerToken, "stranger.webp"), {
      params: Promise.resolve({ id: trip.id }),
    });
    expect(strangerUpload.status).toBe(404);
    expect(((await strangerUpload.json()) as ApiEnvelope<null>).error?.code).toBe("not_found");

    const strangerReorder = await PATCH(
      jsonRequest(strangerToken, "PATCH", {
        tripDayId: day.id,
        accommodationId: accommodation.id,
        order: [{ imageId, sortOrder: 1 }],
      }),
      { params: Promise.resolve({ id: trip.id }) },
    );
    expect(strangerReorder.status).toBe(404);

    const contributorDelete = await DELETE(
      jsonRequest(contributorToken, "DELETE", { tripDayId: day.id, accommodationId: accommodation.id, imageId }),
      { params: Promise.resolve({ id: trip.id }) },
    );
    expect(contributorDelete.status).toBe(200);
    expect(await prisma.accommodationImage.findUnique({ where: { id: imageId } })).toBeNull();
  });

  /**
   * Story 8.4, iteration 4. The last silent path in a design whose whole argument is that a skipped
   * unlink must leave a trace.
   *
   * The day segment of the directory this route may unlink in comes from the stored URL
   * (`readStoredMediaDayId`, AC9). When that URL names nothing under this trip's days - a value drifted or
   * imported from somewhere else - there is no file of ours to remove, and the delete is right to answer
   * `200`. But it is *not* right to say nothing: the outcome is a committed row delete with bytes left on
   * disk, which is the same outcome the containment refusal and an `EACCES` produce, and both of those
   * log. A silent version of this branch is how the AC9 orphans went unnoticed behind a green suite.
   */
  it("logs rather than skipping silently when the stored url names no day under this trip", async () => {
    const owner = await prisma.user.create({
      data: { email: "accommodation-images-unparseable-day@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const token = await createSessionJwt({ sub: owner.id, role: owner.role });
    const trip = await prisma.trip.create({
      data: {
        userId: owner.id,
        name: "Accommodation Images Unparseable Day",
        startDate: new Date("2026-12-20T00:00:00.000Z"),
        endDate: new Date("2026-12-20T00:00:00.000Z"),
      },
    });
    const day = await prisma.tripDay.create({
      data: { tripId: trip.id, date: new Date("2026-12-20T00:00:00.000Z"), dayIndex: 1 },
    });
    const accommodation = await prisma.accommodation.create({
      data: { tripDayId: day.id, name: "Drifted Hotel" },
    });
    // A URL under some other trip: it parses as a path but `readStoredMediaDayId` refuses it, because the
    // trip id in it is not this route's.
    const imageUrl = "/uploads/trips/other-trip/days/other-day/accommodations/other-stay/img-1.webp";
    const row = await prisma.accommodationImage.create({
      data: { accommodationId: accommodation.id, imageUrl, sortOrder: 0 },
    });

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const response = await DELETE(
        new NextRequest(`http://localhost/api/trips/${trip.id}/accommodations/images`, {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            cookie: `session=${token}; csrf_token=csrf-token`,
            "x-csrf-token": "csrf-token",
          },
          body: JSON.stringify({ tripDayId: day.id, accommodationId: accommodation.id, imageId: row.id }),
        }),
        { params: Promise.resolve({ id: trip.id }) },
      );

      expect(response.status).toBe(200);
      expect(await prisma.accommodationImage.findUnique({ where: { id: row.id } })).toBeNull();
      // The ids, not `storedUrl` alone. This branch fires precisely when the URL names some *other*
      // trip, so the URL is the one value in the record that cannot be traced back to the row whose
      // bytes were abandoned - which makes it the one value a log of it alone cannot do its job with.
      expect(consoleSpy).toHaveBeenCalledWith(
        "accommodation image delete: stored media url names no day under this trip",
        expect.objectContaining({
          tripId: trip.id,
          accommodationId: accommodation.id,
          imageId: row.id,
          storedUrl: imageUrl,
        }),
      );
    } finally {
      consoleSpy.mockRestore();
    }
  });

  /**
   * Story 8.4 / DW-195, AC4 - the stay-photo copy of the case all five media routes carry.
   *
   * The unlink runs *after* the row delete has committed, so the deletion the response describes has
   * already happened. Rethrowing a non-`ENOENT` errno turned that into a 500 and a "removal failed"
   * message about a row that no longer existed, and sent the user back to retry a delete that could only
   * ever answer 404 from then on. It is logged instead: the orphaned bytes are the only remaining record
   * that anything went wrong, so silence would be no better than the 500.
   *
   * Repeated in all five suites rather than shared, because the four route-local helpers this replaces
   * were byte-identical copies - one suite passing is not evidence about the other three.
   */
  it("reports the delete that committed when the unlink fails with a non-ENOENT errno", async () => {
    const owner = await prisma.user.create({
      data: { email: "accommodation-images-unlink-fails@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const token = await createSessionJwt({ sub: owner.id, role: owner.role });
    const trip = await prisma.trip.create({
      data: {
        userId: owner.id,
        name: "Accommodation Images Unlink Fails",
        startDate: new Date("2026-12-20T00:00:00.000Z"),
        endDate: new Date("2026-12-20T00:00:00.000Z"),
      },
    });
    const day = await prisma.tripDay.create({
      data: { tripId: trip.id, date: new Date("2026-12-20T00:00:00.000Z"), dayIndex: 1 },
    });
    const accommodation = await prisma.accommodation.create({
      data: { tripDayId: day.id, name: "Locked Hotel" },
    });

    const uploadForm = new FormData();
    uploadForm.set("tripDayId", day.id);
    uploadForm.set("accommodationId", accommodation.id);
    uploadForm.set("file", new File([Buffer.from("fake")], "stay.webp", { type: "image/webp" }));
    const uploadResponse = await POST(
      new NextRequest(`http://localhost/api/trips/${trip.id}/accommodations/images`, {
        method: "POST",
        headers: { cookie: `session=${token}; csrf_token=csrf-token`, "x-csrf-token": "csrf-token" },
        body: uploadForm,
      }),
      { params: Promise.resolve({ id: trip.id }) },
    );
    expect(uploadResponse.status).toBe(200);

    const row = await prisma.accommodationImage.findFirstOrThrow({ where: { accommodationId: accommodation.id } });
    const filePath = resolveStoredMediaPath(row.imageUrl);

    const permissionDenied = new Error(`EACCES: permission denied, unlink '${filePath}'`) as Error & {
      code: string;
    };
    permissionDenied.code = "EACCES";
    const unlinkSpy = vi.spyOn(fs, "unlink").mockRejectedValue(permissionDenied);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const response = await DELETE(
        new NextRequest(`http://localhost/api/trips/${trip.id}/accommodations/images`, {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            cookie: `session=${token}; csrf_token=csrf-token`,
            "x-csrf-token": "csrf-token",
          },
          body: JSON.stringify({
            tripDayId: day.id,
            accommodationId: accommodation.id,
            imageId: row.id,
          }),
        }),
        { params: Promise.resolve({ id: trip.id }) },
      );

      expect(response.status).toBe(200);
      expect(((await response.json()) as ApiEnvelope<{ deleted: boolean }>).data?.deleted).toBe(true);
      expect(await prisma.accommodationImage.findUnique({ where: { id: row.id } })).toBeNull();
      expect(consoleSpy).toHaveBeenCalledWith(
        "accommodation image delete: unable to remove media file",
        expect.objectContaining({ filePath, code: "EACCES" }),
      );
    } finally {
      unlinkSpy.mockRestore();
      consoleSpy.mockRestore();
    }
  });
});
