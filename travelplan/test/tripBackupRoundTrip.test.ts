import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { GET as EXPORT } from "@/app/api/trips/[id]/export/route";
import { POST as IMPORT } from "@/app/api/trips/import/route";
import { createSessionJwt } from "@/lib/auth/jwt";
import { prisma } from "@/lib/db/prisma";
import { createTripWithDays } from "@/lib/repositories/tripRepo";
import {
  getAccommodationImageUploadDir,
  getDayPlanItemImageUploadDir,
  getTripDayUploadDir,
  getTripUploadDir,
  getTripsUploadRoot,
} from "@/lib/trips/uploadPaths";
import { jpegBytes, pngBytes, webpBytes, writeUploadFile } from "./helpers/uploadFixtures";

/**
 * The automated half of Story 2.32's manual verification: export a fully populated trip through the
 * **real** export route, then feed those exact bytes to the **real** import route as a multipart
 * upload.
 *
 * Neither side is stubbed on purpose. Every other suite tests one half against a fixture it wrote
 * itself, which cannot catch the two halves agreeing with their fixtures and not with each other -
 * exactly what happened between this story's original spec and what Story 2.31 shipped.
 *
 * The load-bearing assertions are the ones about *identity*: travel segment endpoints must be the
 * new rows' ids, and every photo must live under the new trip's own upload directory. A restore
 * that re-points at the source trip's `/uploads` passes a naive "the image renders" check and then
 * breaks the moment the source trip is deleted - so this test deletes it.
 */

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

type ImportResponse = {
  trip: { id: string; name: string; heroImageUrl: string | null };
  dayCount: number;
  mode: string;
  travelSegmentCount: number;
  bucketListItemCount: number;
  photoCount: number;
};

const exists = async (filePath: string) =>
  fs
    .stat(filePath)
    .then(() => true)
    .catch(() => false);

describe("trip backup round trip", () => {
  const uploadsRoot = getTripsUploadRoot();

  beforeEach(async () => {
    await prisma.accommodationImage.deleteMany();
    await prisma.dayPlanItemImage.deleteMany();
    await prisma.travelSegment.deleteMany();
    await prisma.tripBucketListItem.deleteMany();
    await prisma.dayPlanItem.deleteMany();
    await prisma.accommodation.deleteMany();
    await prisma.tripDay.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
    await fs.rm(uploadsRoot, { recursive: true, force: true });
  });

  it("exports a fully populated trip and imports it back as an independent copy", async () => {
    const user = await prisma.user.create({
      data: { email: "round-trip@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const session = await createSessionJwt({ sub: user.id, role: user.role });

    // --- source trip ---------------------------------------------------------------------------
    const { trip: sourceTrip } = await createTripWithDays({
      userId: user.id,
      name: "Lofoten Round Trip",
      startDate: "2026-09-01T00:00:00.000Z",
      endDate: "2026-09-02T00:00:00.000Z",
    });
    const [sourceDay1, sourceDay2] = await prisma.tripDay.findMany({
      where: { tripId: sourceTrip.id },
      orderBy: { dayIndex: "asc" },
    });

    const sourceStay = await prisma.accommodation.create({
      data: {
        tripDayId: sourceDay1.id,
        name: "Harbour Inn",
        status: "BOOKED",
        costCents: 18000,
        checkInTime: "15:00",
        checkOutTime: "10:00",
        locationLat: 68.1,
        locationLng: 13.6,
        locationLabel: "Reine",
      },
    });
    const sourcePlanItem = await prisma.dayPlanItem.create({
      data: {
        tripDayId: sourceDay1.id,
        title: "Ferry terminal",
        contentJson: JSON.stringify({ type: "doc", content: [] }),
        costCents: 2500,
      },
    });
    await prisma.travelSegment.create({
      data: {
        tripDayId: sourceDay1.id,
        fromItemType: "ACCOMMODATION",
        fromItemId: sourceStay.id,
        toItemType: "DAY_PLAN_ITEM",
        toItemId: sourcePlanItem.id,
        transportType: "SHIP",
        durationMinutes: 45,
        linkUrl: "https://example.com/ferry",
      },
    });
    await prisma.tripBucketListItem.createMany({
      data: [
        { tripId: sourceTrip.id, title: "Aurora hunt", description: "Clear night", positionText: "North" },
        { tripId: sourceTrip.id, title: "Kayaking" },
      ],
    });

    // Real magic-byte-valid photos: the importer sniffs them, so ASCII fixtures would be rejected.
    const heroBytes = jpegBytes(256);
    const dayBytes = pngBytes(256);
    const stayBytes = webpBytes(256);
    const planBytes = jpegBytes(512);

    await writeUploadFile(getTripUploadDir(sourceTrip.id), "hero.jpg", heroBytes);
    await writeUploadFile(getTripDayUploadDir(sourceTrip.id, sourceDay1.id), "day.png", dayBytes);
    await writeUploadFile(
      getAccommodationImageUploadDir(sourceTrip.id, sourceDay1.id, sourceStay.id),
      "stay.webp",
      stayBytes
    );
    await writeUploadFile(
      getDayPlanItemImageUploadDir(sourceTrip.id, sourceDay1.id, sourcePlanItem.id),
      "activity.jpg",
      planBytes
    );

    await prisma.trip.update({
      where: { id: sourceTrip.id },
      data: { heroImageUrl: `/uploads/trips/${sourceTrip.id}/hero.jpg` },
    });
    await prisma.tripDay.update({
      where: { id: sourceDay1.id },
      data: { imageUrl: `/uploads/trips/${sourceTrip.id}/days/${sourceDay1.id}/day.png`, note: "Arrival" },
    });
    await prisma.accommodationImage.create({
      data: {
        accommodationId: sourceStay.id,
        imageUrl: `/uploads/trips/${sourceTrip.id}/days/${sourceDay1.id}/accommodations/${sourceStay.id}/stay.webp`,
        sortOrder: 0,
      },
    });
    await prisma.dayPlanItemImage.create({
      data: {
        dayPlanItemId: sourcePlanItem.id,
        imageUrl: `/uploads/trips/${sourceTrip.id}/days/${sourceDay1.id}/day-plan-items/${sourcePlanItem.id}/activity.jpg`,
        sortOrder: 0,
      },
    });

    // --- export --------------------------------------------------------------------------------
    const exportResponse = await EXPORT(
      new NextRequest(`http://localhost/api/trips/${sourceTrip.id}/export`, {
        method: "GET",
        headers: { cookie: `session=${session}` },
      }),
      { params: Promise.resolve({ id: sourceTrip.id }) }
    );

    expect(exportResponse.status).toBe(200);
    expect(exportResponse.headers.get("content-type")).toBe("application/zip");
    const archive = Buffer.from(await exportResponse.arrayBuffer());

    // --- import, byte-for-byte what the export produced -----------------------------------------
    const form = new FormData();
    form.set("file", new File([new Uint8Array(archive)], "backup.zip", { type: "application/zip" }));
    form.set("strategy", "createNew");

    const importResponse = await IMPORT(
      new NextRequest("http://localhost/api/trips/import", {
        method: "POST",
        headers: { cookie: `session=${session}; csrf_token=csrf-token`, "x-csrf-token": "csrf-token" },
        body: form,
      })
    );
    const imported = (await importResponse.json()) as ApiEnvelope<ImportResponse>;

    expect(importResponse.status).toBe(200);
    expect(imported.error).toBeNull();
    expect(imported.data?.mode).toBe("createNew");
    expect(imported.data?.dayCount).toBe(2);
    expect(imported.data?.travelSegmentCount).toBe(1);
    expect(imported.data?.bucketListItemCount).toBe(2);
    expect(imported.data?.photoCount).toBe(4);

    const newTripId = imported.data!.trip.id;
    expect(newTripId).not.toBe(sourceTrip.id);

    // --- rows ------------------------------------------------------------------------------------
    const newDays = await prisma.tripDay.findMany({
      where: { tripId: newTripId },
      orderBy: { dayIndex: "asc" },
    });
    expect(newDays.map((day) => day.dayIndex)).toEqual([1, 2]);
    expect(newDays[0].note).toBe("Arrival");
    expect(newDays[1].id).not.toBe(sourceDay2.id);

    const newStay = await prisma.accommodation.findFirstOrThrow({ where: { tripDayId: newDays[0].id } });
    expect(newStay.name).toBe("Harbour Inn");
    expect(newStay.status).toBe("BOOKED");
    expect(newStay.costCents).toBe(18000);
    expect(newStay.checkInTime).toBe("15:00");
    expect(newStay.locationLabel).toBe("Reine");

    const newPlanItem = await prisma.dayPlanItem.findFirstOrThrow({ where: { tripDayId: newDays[0].id } });
    expect(newPlanItem.title).toBe("Ferry terminal");
    expect(newPlanItem.costCents).toBe(2500);

    const bucketItems = await prisma.tripBucketListItem.findMany({
      where: { tripId: newTripId },
      orderBy: { title: "asc" },
    });
    expect(bucketItems.map((item) => item.title)).toEqual(["Aurora hunt", "Kayaking"]);
    expect(bucketItems[0].positionText).toBe("North");

    // Payments are back-filled from costCents by the exporter and restored by the importer.
    expect(await prisma.costPayment.count({ where: { accommodationId: newStay.id } })).toBe(1);
    expect(await prisma.costPayment.count({ where: { dayPlanItemId: newPlanItem.id } })).toBe(1);

    // --- travel segment endpoints point at the *new* rows ---------------------------------------
    const newSegment = await prisma.travelSegment.findFirstOrThrow({ where: { tripDayId: newDays[0].id } });
    expect(newSegment.fromItemId).toBe(newStay.id);
    expect(newSegment.toItemId).toBe(newPlanItem.id);
    expect(newSegment.fromItemId).not.toBe(sourceStay.id);
    expect(newSegment.toItemId).not.toBe(sourcePlanItem.id);
    expect(newSegment.transportType).toBe("SHIP");
    expect(newSegment.durationMinutes).toBe(45);
    expect(newSegment.linkUrl).toBe("https://example.com/ferry");

    // --- photos live under the new trip, with the same bytes ------------------------------------
    const newTrip = await prisma.trip.findFirstOrThrow({ where: { id: newTripId } });
    const newStayImage = await prisma.accommodationImage.findFirstOrThrow({
      where: { accommodationId: newStay.id },
    });
    const newPlanImage = await prisma.dayPlanItemImage.findFirstOrThrow({
      where: { dayPlanItemId: newPlanItem.id },
    });

    const storedUrls = [
      newTrip.heroImageUrl,
      newDays[0].imageUrl,
      newStayImage.imageUrl,
      newPlanImage.imageUrl,
    ];
    for (const url of storedUrls) {
      expect(url).not.toBeNull();
      expect(url).toContain(`/uploads/trips/${newTripId}/`);
      expect(url).not.toContain(sourceTrip.id);
    }

    const heroPath = path.join(getTripUploadDir(newTripId), "hero.jpg");
    const dayPath = path.join(getTripDayUploadDir(newTripId, newDays[0].id), "day.png");
    const stayPath = path.join(
      getAccommodationImageUploadDir(newTripId, newDays[0].id, newStay.id),
      path.basename(newStayImage.imageUrl)
    );
    const planPath = path.join(
      getDayPlanItemImageUploadDir(newTripId, newDays[0].id, newPlanItem.id),
      path.basename(newPlanImage.imageUrl)
    );

    expect(await fs.readFile(heroPath)).toEqual(heroBytes);
    expect(await fs.readFile(dayPath)).toEqual(dayBytes);
    expect(await fs.readFile(stayPath)).toEqual(stayBytes);
    expect(await fs.readFile(planPath)).toEqual(planBytes);
    expect(newStayImage.sortOrder).toBe(0);
    expect(newPlanImage.sortOrder).toBe(0);

    // --- the copy survives its source ------------------------------------------------------------
    // This is the whole point of the story: the import copied bytes rather than re-pointing at the
    // original trip's directory, so deleting that trip cannot break the restored copy.
    await prisma.trip.delete({ where: { id: sourceTrip.id } });
    await fs.rm(getTripUploadDir(sourceTrip.id), { recursive: true, force: true });

    expect(await exists(heroPath)).toBe(true);
    expect(await exists(dayPath)).toBe(true);
    expect(await exists(stayPath)).toBe(true);
    expect(await exists(planPath)).toBe(true);
    expect(await prisma.travelSegment.count({ where: { tripDayId: newDays[0].id } })).toBe(1);
  });

  it("round-trips a trip with no photos at all", async () => {
    const user = await prisma.user.create({
      data: { email: "round-trip-no-photos@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const session = await createSessionJwt({ sub: user.id, role: user.role });

    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Bare Round Trip",
      startDate: "2026-05-01T00:00:00.000Z",
      endDate: "2026-05-01T00:00:00.000Z",
    });

    const exportResponse = await EXPORT(
      new NextRequest(`http://localhost/api/trips/${trip.id}/export`, {
        method: "GET",
        headers: { cookie: `session=${session}` },
      }),
      { params: Promise.resolve({ id: trip.id }) }
    );
    const archive = Buffer.from(await exportResponse.arrayBuffer());

    const form = new FormData();
    form.set("file", new File([new Uint8Array(archive)], "backup.zip", { type: "application/zip" }));
    form.set("strategy", "createNew");

    const importResponse = await IMPORT(
      new NextRequest("http://localhost/api/trips/import", {
        method: "POST",
        headers: { cookie: `session=${session}; csrf_token=csrf-token`, "x-csrf-token": "csrf-token" },
        body: form,
      })
    );
    const imported = (await importResponse.json()) as ApiEnvelope<ImportResponse>;

    expect(importResponse.status).toBe(200);
    expect(imported.data?.photoCount).toBe(0);
    expect(imported.data?.dayCount).toBe(1);
    expect(await prisma.trip.count({ where: { userId: user.id } })).toBe(2);
  });

  it("overwrites the source trip in place and removes its previous files", async () => {
    const user = await prisma.user.create({
      data: { email: "round-trip-overwrite@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const session = await createSessionJwt({ sub: user.id, role: user.role });

    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Overwrite Round Trip",
      startDate: "2026-06-01T00:00:00.000Z",
      endDate: "2026-06-01T00:00:00.000Z",
    });
    const [day] = await prisma.tripDay.findMany({ where: { tripId: trip.id } });

    await writeUploadFile(getTripUploadDir(trip.id), "hero.jpg", jpegBytes(128));
    await prisma.trip.update({
      where: { id: trip.id },
      data: { heroImageUrl: `/uploads/trips/${trip.id}/hero.jpg` },
    });
    // An orphan from an earlier upload, with no row pointing at it. AC5 wants it gone.
    await writeUploadFile(getTripDayUploadDir(trip.id, day.id), "orphan.png", pngBytes());

    const exportResponse = await EXPORT(
      new NextRequest(`http://localhost/api/trips/${trip.id}/export`, {
        method: "GET",
        headers: { cookie: `session=${session}` },
      }),
      { params: Promise.resolve({ id: trip.id }) }
    );
    const archive = Buffer.from(await exportResponse.arrayBuffer());

    const form = new FormData();
    form.set("file", new File([new Uint8Array(archive)], "backup.zip", { type: "application/zip" }));
    form.set("strategy", "overwrite");
    form.set("targetTripId", trip.id);

    const importResponse = await IMPORT(
      new NextRequest("http://localhost/api/trips/import", {
        method: "POST",
        headers: { cookie: `session=${session}; csrf_token=csrf-token`, "x-csrf-token": "csrf-token" },
        body: form,
      })
    );
    const imported = (await importResponse.json()) as ApiEnvelope<ImportResponse>;

    expect(importResponse.status).toBe(200);
    expect(imported.data?.mode).toBe("overwrite");
    expect(imported.data?.trip.id).toBe(trip.id);
    expect(imported.data?.photoCount).toBe(1);

    // The hero came back, the orphan did not, and the stash directory left no residue.
    expect(await fs.readFile(path.join(getTripUploadDir(trip.id), "hero.jpg"))).toEqual(jpegBytes(128));
    expect(await exists(path.join(getTripDayUploadDir(trip.id, day.id), "orphan.png"))).toBe(false);
    expect((await fs.readdir(uploadsRoot)).filter((entry) => entry.includes(".import-"))).toEqual([]);
    expect(await prisma.trip.count({ where: { userId: user.id } })).toBe(1);
  });
});
