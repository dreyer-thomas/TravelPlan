import fs from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import * as images from "@/app/api/trips/[id]/day-plan-items/images/route";
import * as documents from "@/app/api/trips/[id]/day-plan-items/documents/route";
import { GET as SERVE } from "@/app/uploads/[...path]/route";
import { createSessionJwt } from "@/lib/auth/jwt";
import { prisma } from "@/lib/db/prisma";
import { getTripsUploadRoot, resolveStoredMediaPath } from "@/lib/trips/uploadPaths";

/**
 * Story 14.1 AC7. A parked activity's pictures and documents: uploaded under the trip's `parked/` folder
 * (no day in the request), listed and deleted by the item id alone, and served like every other upload.
 * An activity that was on a day keeps its `days/<d>/…` files, which still delete; a URL outside the
 * item's own folders is refused and logged.
 */

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

const CSRF = "csrf-token";
const doc = (text: string) =>
  JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

const context = (tripId: string) => ({ params: Promise.resolve({ id: tripId }) });

const writeRequest = (url: string, token: string, method: string, body: FormData | string) =>
  new NextRequest(url, {
    method,
    headers: {
      cookie: `session=${token}; csrf_token=${CSRF}`,
      "x-csrf-token": CSRF,
      ...(typeof body === "string" ? { "Content-Type": "application/json" } : {}),
    },
    body,
  });

const readRequest = (url: string, token: string) =>
  new NextRequest(url, { method: "GET", headers: { cookie: `session=${token}` } });

let counter = 0;
const seed = async () => {
  const owner = await prisma.user.create({
    data: { email: `parked-media-owner-${counter++}@example.com`, passwordHash: "hashed", role: "OWNER" },
  });
  const viewer = await prisma.user.create({
    data: { email: `parked-media-viewer-${counter++}@example.com`, passwordHash: "hashed", role: "VIEWER" },
  });
  const stranger = await prisma.user.create({
    data: { email: `parked-media-stranger-${counter++}@example.com`, passwordHash: "hashed", role: "OWNER" },
  });
  const trip = await prisma.trip.create({
    data: { userId: owner.id, name: "Parked media", startDate: new Date("2026-12-01T00:00:00.000Z"), endDate: new Date("2026-12-01T00:00:00.000Z") },
  });
  await prisma.tripMember.create({ data: { tripId: trip.id, userId: viewer.id, role: "VIEWER" } });
  const day = await prisma.tripDay.create({ data: { tripId: trip.id, date: new Date("2026-12-01T00:00:00.000Z"), dayIndex: 1 } });
  const idea = await prisma.dayPlanItem.create({
    data: { tripId: trip.id, tripDayId: null, scheduleMode: "FLEXIBLE", title: "Idea", contentJson: doc("Idea") },
  });
  return {
    trip,
    day,
    idea,
    ownerToken: await createSessionJwt({ sub: owner.id, role: owner.role }),
    viewerToken: await createSessionJwt({ sub: viewer.id, role: viewer.role }),
    strangerToken: await createSessionJwt({ sub: stranger.id, role: stranger.role }),
  };
};

const uploadImage = (tripId: string, token: string, fields: Record<string, string>) => {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  form.set("file", new File([Buffer.from("fake")], "photo.webp", { type: "image/webp" }));
  return images.POST(writeRequest(`http://localhost/api/trips/${tripId}/day-plan-items/images`, token, "POST", form), context(tripId));
};

const uploadDocument = (tripId: string, token: string, fields: Record<string, string>) => {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  form.set("file", new File([Buffer.from("%PDF-1.4 fake")], "Ticket.pdf", { type: "application/pdf" }));
  return documents.POST(
    writeRequest(`http://localhost/api/trips/${tripId}/day-plan-items/documents`, token, "POST", form),
    context(tripId),
  );
};

const exists = (file: string) =>
  fs.stat(file).then(
    () => true,
    () => false,
  );

describe("media on parked activities (Story 14.1 AC7)", () => {
  const uploadsRoot = getTripsUploadRoot();

  beforeEach(async () => {
    await prisma.tripMember.deleteMany();
    await prisma.dayPlanItemDocument.deleteMany();
    await prisma.dayPlanItemImage.deleteMany();
    await prisma.dayPlanItem.deleteMany();
    await prisma.tripDay.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
    await fs.rm(uploadsRoot, { recursive: true, force: true });
  });

  it("uploads, lists and deletes a picture on a parked activity under parked/, without a day", async () => {
    const { trip, idea, ownerToken } = await seed();

    const uploaded = await uploadImage(trip.id, ownerToken, { dayPlanItemId: idea.id });
    const body = (await uploaded.json()) as ApiEnvelope<{ image: { id: string; imageUrl: string } }>;
    expect(uploaded.status).toBe(200);
    const imageUrl = body.data!.image.imageUrl;
    expect(imageUrl.startsWith(`/uploads/trips/${trip.id}/parked/day-plan-items/${idea.id}/`)).toBe(true);
    expect(await exists(resolveStoredMediaPath(imageUrl))).toBe(true);

    const listed = await images.GET(
      readRequest(`http://localhost/api/trips/${trip.id}/day-plan-items/images?dayPlanItemId=${idea.id}`, ownerToken),
      context(trip.id),
    );
    expect(((await listed.json()) as ApiEnvelope<{ images: { imageUrl: string }[] }>).data?.images.map((row) => row.imageUrl)).toEqual([
      imageUrl,
    ]);

    const deleted = await images.DELETE(
      writeRequest(
        `http://localhost/api/trips/${trip.id}/day-plan-items/images`,
        ownerToken,
        "DELETE",
        JSON.stringify({ dayPlanItemId: idea.id, imageId: body.data!.image.id }),
      ),
      context(trip.id),
    );
    expect(deleted.status).toBe(200);
    expect(await prisma.dayPlanItemImage.count()).toBe(0);
    expect(await exists(resolveStoredMediaPath(imageUrl))).toBe(false);
  });

  it("uploads, lists and deletes a document on a parked activity under parked/…/documents/", async () => {
    const { trip, idea, ownerToken } = await seed();

    const uploaded = await uploadDocument(trip.id, ownerToken, { dayPlanItemId: idea.id });
    const body = (await uploaded.json()) as ApiEnvelope<{ document: { id: string; documentUrl: string } }>;
    expect(uploaded.status).toBe(200);
    const documentUrl = body.data!.document.documentUrl;
    expect(documentUrl.startsWith(`/uploads/trips/${trip.id}/parked/day-plan-items/${idea.id}/documents/`)).toBe(true);

    const listed = await documents.GET(
      readRequest(`http://localhost/api/trips/${trip.id}/day-plan-items/documents?dayPlanItemId=${idea.id}`, ownerToken),
      context(trip.id),
    );
    expect(((await listed.json()) as ApiEnvelope<{ documents: unknown[] }>).data?.documents).toHaveLength(1);

    const deleted = await documents.DELETE(
      writeRequest(
        `http://localhost/api/trips/${trip.id}/day-plan-items/documents`,
        ownerToken,
        "DELETE",
        JSON.stringify({ dayPlanItemId: idea.id, documentId: body.data!.document.id }),
      ),
      context(trip.id),
    );
    expect(deleted.status).toBe(200);
    expect(await exists(resolveStoredMediaPath(documentUrl))).toBe(false);
  });

  it("refuses a parked item addressed with a day, and a planned item addressed without one", async () => {
    const { trip, day, idea, ownerToken } = await seed();
    const planned = await prisma.dayPlanItem.create({
      data: { tripId: trip.id, tripDayId: day.id, title: "Planned", fromTime: "09:00", toTime: "10:00", contentJson: doc("x") },
    });

    expect((await uploadImage(trip.id, ownerToken, { tripDayId: day.id, dayPlanItemId: idea.id })).status).toBe(404);
    expect((await uploadImage(trip.id, ownerToken, { dayPlanItemId: planned.id })).status).toBe(404);
    expect(await prisma.dayPlanItemImage.count()).toBe(0);
    // The rolled-back upload left no file behind.
    const parkedDir = path.join(uploadsRoot, trip.id, "parked", "day-plan-items", planned.id);
    expect((await fs.readdir(parkedDir).catch(() => [])).length).toBe(0);
  });

  it("keeps listing a parked activity's media from viewers: the bucket list is writers only", async () => {
    const { trip, idea, viewerToken } = await seed();
    const listed = await images.GET(
      readRequest(`http://localhost/api/trips/${trip.id}/day-plan-items/images?dayPlanItemId=${idea.id}`, viewerToken),
      context(trip.id),
    );
    expect(listed.status).toBe(404);
  });

  it("deletes a picture and a document the activity got on an earlier day, after it was parked", async () => {
    const { trip, idea, ownerToken } = await seed();
    const oldDayDir = path.join(uploadsRoot, trip.id, "days", "old-day", "day-plan-items", idea.id);
    await fs.mkdir(path.join(oldDayDir, "documents"), { recursive: true });
    await fs.writeFile(path.join(oldDayDir, "old.webp"), "o");
    await fs.writeFile(path.join(oldDayDir, "documents", "old.pdf"), "d");
    const image = await prisma.dayPlanItemImage.create({
      data: { dayPlanItemId: idea.id, imageUrl: `/uploads/trips/${trip.id}/days/old-day/day-plan-items/${idea.id}/old.webp`, sortOrder: 1 },
    });
    const document = await prisma.dayPlanItemDocument.create({
      data: {
        dayPlanItemId: idea.id,
        documentUrl: `/uploads/trips/${trip.id}/days/old-day/day-plan-items/${idea.id}/documents/old.pdf`,
        fileName: "old.pdf",
        sortOrder: 1,
      },
    });

    const deletedImage = await images.DELETE(
      writeRequest(`http://localhost/api/trips/${trip.id}/day-plan-items/images`, ownerToken, "DELETE", JSON.stringify({ dayPlanItemId: idea.id, imageId: image.id })),
      context(trip.id),
    );
    const deletedDocument = await documents.DELETE(
      writeRequest(
        `http://localhost/api/trips/${trip.id}/day-plan-items/documents`,
        ownerToken,
        "DELETE",
        JSON.stringify({ dayPlanItemId: idea.id, documentId: document.id }),
      ),
      context(trip.id),
    );

    expect(deletedImage.status).toBe(200);
    expect(deletedDocument.status).toBe(200);
    expect(await exists(path.join(oldDayDir, "old.webp"))).toBe(false);
    expect(await exists(path.join(oldDayDir, "documents", "old.pdf"))).toBe(false);
  });

  it("refuses and logs a stored URL from another item or another trip, and keeps that file", async () => {
    const { trip, idea, ownerToken } = await seed();
    const otherItemFile = path.join(uploadsRoot, trip.id, "parked", "day-plan-items", "other-item", "x.webp");
    const otherTripFile = path.join(uploadsRoot, "other-trip", "parked", "day-plan-items", idea.id, "y.webp");
    for (const file of [otherItemFile, otherTripFile]) {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, "keep");
    }
    const rows = await Promise.all(
      [
        `/uploads/trips/${trip.id}/parked/day-plan-items/other-item/x.webp`,
        `/uploads/trips/other-trip/parked/day-plan-items/${idea.id}/y.webp`,
        `/uploads/trips/${trip.id}/parked/day-plan-items/${idea.id}/../other-item/x.webp`,
      ].map((imageUrl, index) => prisma.dayPlanItemImage.create({ data: { dayPlanItemId: idea.id, imageUrl, sortOrder: index + 1 } })),
    );
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    for (const row of rows) {
      const response = await images.DELETE(
        writeRequest(`http://localhost/api/trips/${trip.id}/day-plan-items/images`, ownerToken, "DELETE", JSON.stringify({ dayPlanItemId: idea.id, imageId: row.id })),
        context(trip.id),
      );
      expect(response.status).toBe(200);
    }

    expect(log).toHaveBeenCalledTimes(3);
    log.mockRestore();
    expect(await exists(otherItemFile)).toBe(true);
    expect(await exists(otherTripFile)).toBe(true);
  });

  it("serves a parked picture to a viewer of the trip and refuses an outsider", async () => {
    const { trip, idea, ownerToken, viewerToken, strangerToken } = await seed();
    const uploaded = await uploadImage(trip.id, ownerToken, { dayPlanItemId: idea.id });
    const imageUrl = ((await uploaded.json()) as ApiEnvelope<{ image: { imageUrl: string } }>).data!.image.imageUrl;
    const segments = imageUrl.replace(/^\/uploads\//, "").split("/");

    const serve = (token: string) =>
      SERVE(
        new NextRequest(`http://localhost${imageUrl}`, { method: "GET", headers: { cookie: `session=${token}` } }),
        { params: Promise.resolve({ path: segments }) },
      );

    expect((await serve(viewerToken)).status).toBe(200);
    expect((await serve(strangerToken)).status).toBe(404);
  });
});
