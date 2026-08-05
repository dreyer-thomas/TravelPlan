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
  getAccommodationDocumentUploadDir,
  getAccommodationImageUploadDir,
  getDayPlanItemDocumentUploadDir,
  getDayPlanItemImageUploadDir,
  getTripDayUploadDir,
  getTripUploadDir,
  getTripsUploadRoot,
} from "@/lib/trips/uploadPaths";
import { jpegBytes, pdfBytes, pngBytes, webpBytes, writeUploadFile } from "./helpers/uploadFixtures";

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
  documentCount: number;
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
    await prisma.accommodationDocument.deleteMany();
    await prisma.dayPlanItemDocument.deleteMany();
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

  /**
   * Story 6.16 / AC7. The backup format carries `transportType`, and both new values have to survive
   * export *and* import - the export mapper and the import mapper are separate switches, so one of
   * them silently falling back to FLIGHT is exactly the failure this catches.
   *
   * The cycling leg keeps a distance and the walking leg does not, which is also the AC6 rule
   * travelling through the backup format intact.
   */
  it("round-trips walking and cycling travel segments", async () => {
    const user = await prisma.user.create({
      data: { email: "round-trip-modes@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const session = await createSessionJwt({ sub: user.id, role: user.role });

    const { trip: sourceTrip } = await createTripWithDays({
      userId: user.id,
      name: "Modes Round Trip",
      startDate: "2026-10-01T00:00:00.000Z",
      endDate: "2026-10-01T00:00:00.000Z",
    });
    const [sourceDay] = await prisma.tripDay.findMany({ where: { tripId: sourceTrip.id } });

    const sourceStay = await prisma.accommodation.create({
      data: { tripDayId: sourceDay.id, name: "Trailhead Lodge", status: "PLANNED" },
    });
    const firstStop = await prisma.dayPlanItem.create({
      data: {
        tripDayId: sourceDay.id,
        title: "Viewpoint",
        contentJson: JSON.stringify({ type: "doc", content: [] }),
      },
    });
    const secondStop = await prisma.dayPlanItem.create({
      data: {
        tripDayId: sourceDay.id,
        title: "Lake",
        contentJson: JSON.stringify({ type: "doc", content: [] }),
      },
    });

    await prisma.travelSegment.create({
      data: {
        tripDayId: sourceDay.id,
        fromItemType: "ACCOMMODATION",
        fromItemId: sourceStay.id,
        toItemType: "DAY_PLAN_ITEM",
        toItemId: firstStop.id,
        transportType: "WALKING",
        durationMinutes: 15,
        distanceKm: null,
      },
    });
    await prisma.travelSegment.create({
      data: {
        tripDayId: sourceDay.id,
        fromItemType: "DAY_PLAN_ITEM",
        fromItemId: firstStop.id,
        toItemType: "DAY_PLAN_ITEM",
        toItemId: secondStop.id,
        transportType: "CYCLING",
        durationMinutes: 75,
        distanceKm: 22.4,
      },
    });

    const exportResponse = await EXPORT(
      new NextRequest(`http://localhost/api/trips/${sourceTrip.id}/export`, {
        method: "GET",
        headers: { cookie: `session=${session}` },
      }),
      { params: Promise.resolve({ id: sourceTrip.id }) }
    );
    expect(exportResponse.status).toBe(200);
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
    expect(imported.error).toBeNull();
    expect(imported.data?.travelSegmentCount).toBe(2);

    const newTripId = imported.data!.trip.id;
    const [newDay] = await prisma.tripDay.findMany({ where: { tripId: newTripId } });
    const newSegments = await prisma.travelSegment.findMany({
      where: { tripDayId: newDay.id },
      orderBy: { durationMinutes: "asc" },
    });

    expect(newSegments.map((segment) => segment.transportType)).toEqual(["WALKING", "CYCLING"]);
    expect(newSegments[0].distanceKm).toBeNull();
    expect(newSegments[1].distanceKm).toBe(22.4);
    // Endpoints are remapped onto the restored rows, not left pointing at the source trip's.
    const sourceIds = [sourceStay.id, firstStop.id, secondStop.id];
    for (const segment of newSegments) {
      expect(sourceIds).not.toContain(segment.fromItemId);
      expect(sourceIds).not.toContain(segment.toItemId);
    }
  });

  /**
   * The other direction of AC7, and the one that could actually regress: a backup written *before*
   * this story - so carrying only CAR / SHIP / FLIGHT - must still import cleanly. The change to the
   * import schema is accept-more, so this is a guard against someone later "tidying" the enum into
   * only the modes the current dialog offers.
   */
  it("imports a backup written before walking and cycling existed", async () => {
    const user = await prisma.user.create({
      data: { email: "round-trip-legacy@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const session = await createSessionJwt({ sub: user.id, role: user.role });

    const { trip: sourceTrip } = await createTripWithDays({
      userId: user.id,
      name: "Legacy Backup Trip",
      startDate: "2026-04-01T00:00:00.000Z",
      endDate: "2026-04-01T00:00:00.000Z",
    });
    const [sourceDay] = await prisma.tripDay.findMany({ where: { tripId: sourceTrip.id } });

    const legacyStay = await prisma.accommodation.create({
      data: { tripDayId: sourceDay.id, name: "Legacy Hotel", status: "PLANNED" },
    });
    const legacyStops = [];
    for (const title of ["Port", "Airport", "Hotel"]) {
      legacyStops.push(
        await prisma.dayPlanItem.create({
          data: {
            tripDayId: sourceDay.id,
            title,
            contentJson: JSON.stringify({ type: "doc", content: [] }),
          },
        })
      );
    }

    // The exact three modes a pre-6.16 build could write, in the order the timeline puts them.
    await prisma.travelSegment.create({
      data: {
        tripDayId: sourceDay.id,
        fromItemType: "ACCOMMODATION",
        fromItemId: legacyStay.id,
        toItemType: "DAY_PLAN_ITEM",
        toItemId: legacyStops[0].id,
        transportType: "CAR",
        durationMinutes: 25,
        distanceKm: 18,
      },
    });
    await prisma.travelSegment.create({
      data: {
        tripDayId: sourceDay.id,
        fromItemType: "DAY_PLAN_ITEM",
        fromItemId: legacyStops[0].id,
        toItemType: "DAY_PLAN_ITEM",
        toItemId: legacyStops[1].id,
        transportType: "SHIP",
        durationMinutes: 120,
        distanceKm: null,
      },
    });
    await prisma.travelSegment.create({
      data: {
        tripDayId: sourceDay.id,
        fromItemType: "DAY_PLAN_ITEM",
        fromItemId: legacyStops[1].id,
        toItemType: "DAY_PLAN_ITEM",
        toItemId: legacyStops[2].id,
        transportType: "FLIGHT",
        durationMinutes: 300,
        distanceKm: null,
      },
    });

    const exportResponse = await EXPORT(
      new NextRequest(`http://localhost/api/trips/${sourceTrip.id}/export`, {
        method: "GET",
        headers: { cookie: `session=${session}` },
      }),
      { params: Promise.resolve({ id: sourceTrip.id }) }
    );
    const archive = Buffer.from(await exportResponse.arrayBuffer());

    const form = new FormData();
    form.set("file", new File([new Uint8Array(archive)], "legacy-backup.zip", { type: "application/zip" }));
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
    expect(imported.data?.travelSegmentCount).toBe(3);

    const [newDay] = await prisma.tripDay.findMany({ where: { tripId: imported.data!.trip.id } });
    const newSegments = await prisma.travelSegment.findMany({
      where: { tripDayId: newDay.id },
      orderBy: { durationMinutes: "asc" },
    });
    expect(newSegments.map((segment) => segment.transportType)).toEqual(["CAR", "SHIP", "FLIGHT"]);
    expect(newSegments[0].distanceKm).toBe(18);
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


  /**
   * Story 9.1 AC8, through both real routes: documents on a stay *and* on an activity come back on
   * the same entries, with the same names, in the same order, and with the same bytes.
   *
   * The names are the load-bearing part. The file on disk is `doc-<ts>-<rand>.<ext>` on both sides -
   * nothing in the archive names it - so `fileName` surviving is a property of the manifest ref and
   * of nothing else. The bytes are checked too, because a restored row pointing at a file that will
   * not open is the failure this AC exists to catch.
   */
  it("round-trips documents on a stay and on an activity", async () => {
    const user = await prisma.user.create({
      data: { email: "round-trip-documents@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const session = await createSessionJwt({ sub: user.id, role: user.role });

    const { trip: sourceTrip } = await createTripWithDays({
      userId: user.id,
      name: "Documented Round Trip",
      startDate: "2026-09-10T00:00:00.000Z",
      endDate: "2026-09-10T00:00:00.000Z",
    });
    const [sourceDay] = await prisma.tripDay.findMany({ where: { tripId: sourceTrip.id } });

    const sourceStay = await prisma.accommodation.create({
      data: { tripDayId: sourceDay.id, name: "Ticketed Inn", status: "BOOKED" },
    });
    const sourcePlanItem = await prisma.dayPlanItem.create({
      data: {
        tripDayId: sourceDay.id,
        title: "Colosseum",
        contentJson: JSON.stringify({ type: "doc", content: [] }),
      },
    });

    // A photo as well, so the two pools are exercised side by side and a document landing in the
    // photo gallery (or the reverse) would show up as a wrong count on one of them.
    const stayPhotoBytes = webpBytes(128);
    await writeUploadFile(
      getAccommodationImageUploadDir(sourceTrip.id, sourceDay.id, sourceStay.id),
      "stay.webp",
      stayPhotoBytes,
    );
    await prisma.accommodationImage.create({
      data: {
        accommodationId: sourceStay.id,
        imageUrl: `/uploads/trips/${sourceTrip.id}/days/${sourceDay.id}/accommodations/${sourceStay.id}/stay.webp`,
        sortOrder: 0,
      },
    });

    const bookingBytes = pdfBytes(256);
    const mapBytes = pngBytes(192);
    const ticketBytes = pdfBytes(320);

    const stayDocumentDir = getAccommodationDocumentUploadDir(sourceTrip.id, sourceDay.id, sourceStay.id);
    const itemDocumentDir = getDayPlanItemDocumentUploadDir(sourceTrip.id, sourceDay.id, sourcePlanItem.id);
    await writeUploadFile(stayDocumentDir, "doc-booking.pdf", bookingBytes);
    await writeUploadFile(stayDocumentDir, "doc-map.png", mapBytes);
    await writeUploadFile(itemDocumentDir, "doc-ticket.pdf", ticketBytes);

    const stayDocumentPrefix = `/uploads/trips/${sourceTrip.id}/days/${sourceDay.id}/accommodations/${sourceStay.id}/documents`;
    await prisma.accommodationDocument.createMany({
      data: [
        {
          accommodationId: sourceStay.id,
          documentUrl: `${stayDocumentPrefix}/doc-booking.pdf`,
          fileName: "Buchungsbestätigung.pdf",
          sortOrder: 0,
        },
        {
          accommodationId: sourceStay.id,
          documentUrl: `${stayDocumentPrefix}/doc-map.png`,
          fileName: "Lageplan Hotel.png",
          sortOrder: 1,
        },
      ],
    });
    await prisma.dayPlanItemDocument.create({
      data: {
        dayPlanItemId: sourcePlanItem.id,
        documentUrl: `/uploads/trips/${sourceTrip.id}/days/${sourceDay.id}/day-plan-items/${sourcePlanItem.id}/documents/doc-ticket.pdf`,
        fileName: "Colosseum Ticket.pdf",
        sortOrder: 0,
      },
    });

    const exportResponse = await EXPORT(
      new NextRequest(`http://localhost/api/trips/${sourceTrip.id}/export`, {
        method: "GET",
        headers: { cookie: `session=${session}` },
      }),
      { params: Promise.resolve({ id: sourceTrip.id }) }
    );
    expect(exportResponse.status).toBe(200);
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
    expect(imported.error).toBeNull();
    // Counted under its own name, never folded into `photoCount`.
    expect(imported.data?.photoCount).toBe(1);
    expect(imported.data?.documentCount).toBe(3);

    const newTripId = imported.data!.trip.id;
    const [newDay] = await prisma.tripDay.findMany({ where: { tripId: newTripId } });
    const newStay = await prisma.accommodation.findFirstOrThrow({ where: { tripDayId: newDay.id } });
    const newPlanItem = await prisma.dayPlanItem.findFirstOrThrow({ where: { tripDayId: newDay.id } });

    const newStayDocuments = await prisma.accommodationDocument.findMany({
      where: { accommodationId: newStay.id },
      orderBy: { sortOrder: "asc" },
    });
    const newItemDocuments = await prisma.dayPlanItemDocument.findMany({
      where: { dayPlanItemId: newPlanItem.id },
      orderBy: { sortOrder: "asc" },
    });

    // Same owners, same order, same names.
    expect(newStayDocuments.map((document) => [document.sortOrder, document.fileName])).toEqual([
      [0, "Buchungsbestätigung.pdf"],
      [1, "Lageplan Hotel.png"],
    ]);
    expect(newItemDocuments.map((document) => [document.sortOrder, document.fileName])).toEqual([
      [0, "Colosseum Ticket.pdf"],
    ]);

    // Nothing crossed pools: the stay's photo is still a photo and its documents are still documents.
    expect(await prisma.accommodationImage.count({ where: { accommodationId: newStay.id } })).toBe(1);
    expect(await prisma.dayPlanItemImage.count({ where: { dayPlanItemId: newPlanItem.id } })).toBe(0);

    // The stored URL is the new trip's, the on-disk name is server-generated, and it sits in the
    // entry's own `documents/` subdirectory rather than beside its photos.
    const documentPath = (documentUrl: string, dir: string) => path.join(dir, path.basename(documentUrl));
    const newStayDocumentDir = getAccommodationDocumentUploadDir(newTripId, newDay.id, newStay.id);
    const newItemDocumentDir = getDayPlanItemDocumentUploadDir(newTripId, newDay.id, newPlanItem.id);

    for (const document of [...newStayDocuments, ...newItemDocuments]) {
      expect(document.documentUrl).toContain(`/uploads/trips/${newTripId}/`);
      expect(document.documentUrl).not.toContain(sourceTrip.id);
      expect(document.documentUrl).toContain("/documents/");
      // Never named from the package: the manifest's `fileName` is a column value only.
      expect(path.basename(document.documentUrl)).toMatch(/^doc-\d+-[a-z0-9]{1,8}\.(pdf|png)$/);
      expect(path.basename(document.documentUrl)).not.toContain(" ");
    }

    expect(await fs.readFile(documentPath(newStayDocuments[0].documentUrl, newStayDocumentDir))).toEqual(bookingBytes);
    expect(await fs.readFile(documentPath(newStayDocuments[1].documentUrl, newStayDocumentDir))).toEqual(mapBytes);
    expect(await fs.readFile(documentPath(newItemDocuments[0].documentUrl, newItemDocumentDir))).toEqual(ticketBytes);

    // The extension follows the *bytes*, through `sniffDocumentContentType`: the PNG document is a
    // `.png` and not a `.pdf`, and the two PDFs are `.pdf`.
    expect(newStayDocuments[0].documentUrl.endsWith(".pdf")).toBe(true);
    expect(newStayDocuments[1].documentUrl.endsWith(".png")).toBe(true);

    // And the copy survives its source, as the photo half already must.
    await prisma.trip.delete({ where: { id: sourceTrip.id } });
    await fs.rm(getTripUploadDir(sourceTrip.id), { recursive: true, force: true });
    expect(await exists(documentPath(newItemDocuments[0].documentUrl, newItemDocumentDir))).toBe(true);
  });

  /**
   * The first of Story 9.1's two backward-compatibility negatives: **a v1 JSON backup imports exactly
   * as today.**
   *
   * v1 is the pre-2.31 shape - a bare `.json` manifest with no `photos` key, no `documents` key and
   * no archive at all. Every field the two later stories added is optional with an empty default, and
   * this is the test that says so: it goes through the real route, and it asserts the *whole* result,
   * counts included, rather than merely that nothing threw.
   */
  it("imports a v1 JSON backup exactly as before, with no documents anywhere", async () => {
    const user = await prisma.user.create({
      data: { email: "round-trip-v1@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const session = await createSessionJwt({ sub: user.id, role: user.role });

    const v1Backup = {
      meta: { exportedAt: "2026-02-14T12:00:00.000Z", appVersion: "0.1.0", formatVersion: 1 },
      trip: {
        id: "v1-trip",
        name: "V1 Backup Trip",
        startDate: "2026-03-01T00:00:00.000Z",
        endDate: "2026-03-01T00:00:00.000Z",
        heroImageUrl: "https://cdn.example.com/hero.jpg",
        createdAt: "2026-02-14T12:00:00.000Z",
        updatedAt: "2026-02-14T12:00:00.000Z",
      },
      days: [
        {
          id: "v1-day-1",
          date: "2026-03-01T00:00:00.000Z",
          dayIndex: 1,
          imageUrl: null,
          note: "Arrival",
          createdAt: "2026-02-14T12:00:00.000Z",
          updatedAt: "2026-02-14T12:00:00.000Z",
          accommodation: {
            id: "v1-stay-1",
            name: "Old Format Hotel",
            notes: "Near station",
            status: "booked",
            costCents: 12000,
            link: "https://example.com/stay",
            checkInTime: "15:00",
            checkOutTime: "10:00",
            location: { lat: 41.9, lng: 12.5, label: "Roma" },
            createdAt: "2026-02-14T12:00:00.000Z",
            updatedAt: "2026-02-14T12:00:00.000Z",
          },
          dayPlanItems: [
            {
              id: "v1-plan-1",
              contentJson: JSON.stringify({ type: "doc", content: [] }),
              linkUrl: "https://example.com/plan",
              location: null,
              createdAt: "2026-02-14T12:00:00.000Z",
              updatedAt: "2026-02-14T12:00:00.000Z",
            },
          ],
        },
      ],
    };

    const form = new FormData();
    form.set(
      "file",
      new File([new Uint8Array(Buffer.from(JSON.stringify(v1Backup), "utf8"))], "backup.json", {
        type: "application/json",
      })
    );
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
    expect(imported.data?.dayCount).toBe(1);
    expect(imported.data?.travelSegmentCount).toBe(0);
    expect(imported.data?.bucketListItemCount).toBe(0);
    expect(imported.data?.photoCount).toBe(0);
    expect(imported.data?.documentCount).toBe(0);

    const newTripId = imported.data!.trip.id;
    const newTrip = await prisma.trip.findFirstOrThrow({ where: { id: newTripId } });
    // The v1 external hero URL comes back verbatim, as it always did.
    expect(newTrip.heroImageUrl).toBe("https://cdn.example.com/hero.jpg");

    const [newDay] = await prisma.tripDay.findMany({ where: { tripId: newTripId } });
    const newStay = await prisma.accommodation.findFirstOrThrow({ where: { tripDayId: newDay.id } });
    expect(newStay.name).toBe("Old Format Hotel");
    expect(newStay.checkInTime).toBe("15:00");
    expect(await prisma.dayPlanItem.count({ where: { tripDayId: newDay.id } })).toBe(1);

    // No document rows and no document directory: the new tables are untouched by a v1 restore.
    expect(await prisma.accommodationDocument.count()).toBe(0);
    expect(await prisma.dayPlanItemDocument.count()).toBe(0);
    expect(await exists(getTripUploadDir(newTripId))).toBe(false);
  });

  /**
   * The second negative: **a documents-free v2 package imports byte-for-byte the same result as
   * today.**
   *
   * Proved by comparison rather than by assertion, which is the only way to make it falsifiable: the
   * *same* archive is imported twice into two independent trips, and the two restored trips are
   * compared field by field with the ids and timestamps projected out. A change that quietly altered
   * what a documents-free package restores would have to alter both copies identically to pass, and
   * the explicit counts below pin what "the same" is.
   */
  it("imports a documents-free v2 package exactly as it did before documents existed", async () => {
    const user = await prisma.user.create({
      data: { email: "round-trip-v2-no-documents@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const session = await createSessionJwt({ sub: user.id, role: user.role });

    const { trip: sourceTrip } = await createTripWithDays({
      userId: user.id,
      name: "Documents Free Trip",
      startDate: "2026-04-10T00:00:00.000Z",
      endDate: "2026-04-10T00:00:00.000Z",
    });
    const [sourceDay] = await prisma.tripDay.findMany({ where: { tripId: sourceTrip.id } });
    const sourceStay = await prisma.accommodation.create({
      data: { tripDayId: sourceDay.id, name: "Photo Only Hotel", status: "BOOKED", costCents: 9000 },
    });
    const sourcePlanItem = await prisma.dayPlanItem.create({
      data: {
        tripDayId: sourceDay.id,
        title: "Harbour walk",
        contentJson: JSON.stringify({ type: "doc", content: [] }),
      },
    });
    await prisma.travelSegment.create({
      data: {
        tripDayId: sourceDay.id,
        fromItemType: "ACCOMMODATION",
        fromItemId: sourceStay.id,
        toItemType: "DAY_PLAN_ITEM",
        toItemId: sourcePlanItem.id,
        transportType: "WALKING",
        durationMinutes: 20,
      },
    });
    await prisma.tripBucketListItem.create({ data: { tripId: sourceTrip.id, title: "Gelato" } });

    const galleryBytes = jpegBytes(192);
    await writeUploadFile(
      getAccommodationImageUploadDir(sourceTrip.id, sourceDay.id, sourceStay.id),
      "stay.jpg",
      galleryBytes,
    );
    await prisma.accommodationImage.create({
      data: {
        accommodationId: sourceStay.id,
        imageUrl: `/uploads/trips/${sourceTrip.id}/days/${sourceDay.id}/accommodations/${sourceStay.id}/stay.jpg`,
        sortOrder: 0,
      },
    });

    const exportResponse = await EXPORT(
      new NextRequest(`http://localhost/api/trips/${sourceTrip.id}/export`, {
        method: "GET",
        headers: { cookie: `session=${session}` },
      }),
      { params: Promise.resolve({ id: sourceTrip.id }) }
    );
    const archive = Buffer.from(await exportResponse.arrayBuffer());
    // Nothing document-shaped is in the archive at all - not a member and not a pool entry.
    expect(archive.includes(Buffer.from("documents/", "utf8"))).toBe(false);

    const importOnce = async () => {
      const form = new FormData();
      form.set("file", new File([new Uint8Array(archive)], "backup.zip", { type: "application/zip" }));
      form.set("strategy", "createNew");
      const response = await IMPORT(
        new NextRequest("http://localhost/api/trips/import", {
          method: "POST",
          headers: { cookie: `session=${session}; csrf_token=csrf-token`, "x-csrf-token": "csrf-token" },
          body: form,
        })
      );
      const envelope = (await response.json()) as ApiEnvelope<ImportResponse>;
      expect(response.status).toBe(200);
      expect(envelope.error).toBeNull();
      return envelope.data!;
    };

    /** Everything the restore produced, with the ids and timestamps a new row necessarily changes projected out. */
    const restoredShape = async (tripId: string) => {
      const days = await prisma.tripDay.findMany({ where: { tripId }, orderBy: { dayIndex: "asc" } });
      const stays = await prisma.accommodation.findMany({ where: { tripDayId: { in: days.map((day) => day.id) } } });
      const items = await prisma.dayPlanItem.findMany({ where: { tripDayId: { in: days.map((day) => day.id) } } });
      const images = await prisma.accommodationImage.findMany({
        where: { accommodationId: { in: stays.map((stay) => stay.id) } },
        orderBy: { sortOrder: "asc" },
      });
      return {
        days: days.map((day) => ({ dayIndex: day.dayIndex, note: day.note, hasImage: day.imageUrl !== null })),
        stays: stays.map((stay) => ({ name: stay.name, status: stay.status, costCents: stay.costCents })),
        items: items.map((item) => ({ title: item.title, contentJson: item.contentJson })),
        imageSortOrders: images.map((image) => image.sortOrder),
        segments: (
          await prisma.travelSegment.findMany({ where: { tripDayId: { in: days.map((day) => day.id) } } })
        ).map((segment) => ({ transportType: segment.transportType, durationMinutes: segment.durationMinutes })),
        bucketTitles: (await prisma.tripBucketListItem.findMany({ where: { tripId } })).map((item) => item.title),
      };
    };

    const first = await importOnce();
    const second = await importOnce();

    for (const result of [first, second]) {
      expect(result.dayCount).toBe(1);
      expect(result.photoCount).toBe(1);
      expect(result.travelSegmentCount).toBe(1);
      expect(result.bucketListItemCount).toBe(1);
      // The one field this story added, and `0` is the whole of "unchanged" for such a package.
      expect(result.documentCount).toBe(0);
    }

    expect(await restoredShape(second.trip.id)).toEqual(await restoredShape(first.trip.id));
    expect(await prisma.accommodationDocument.count()).toBe(0);
    expect(await prisma.dayPlanItemDocument.count()).toBe(0);

    // The restored photo is a real file with the original bytes, on both copies.
    for (const result of [first, second]) {
      const [day] = await prisma.tripDay.findMany({ where: { tripId: result.trip.id } });
      const stay = await prisma.accommodation.findFirstOrThrow({ where: { tripDayId: day.id } });
      const image = await prisma.accommodationImage.findFirstOrThrow({ where: { accommodationId: stay.id } });
      const filePath = path.join(
        getAccommodationImageUploadDir(result.trip.id, day.id, stay.id),
        path.basename(image.imageUrl)
      );
      expect(await fs.readFile(filePath)).toEqual(galleryBytes);
      // And no `documents/` subdirectory was created for an entry that has none.
      expect(await exists(getAccommodationDocumentUploadDir(result.trip.id, day.id, stay.id))).toBe(false);
    }
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
