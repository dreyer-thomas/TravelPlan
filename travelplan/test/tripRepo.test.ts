import { beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db/prisma";
import {
  getAccommodationImageUploadDir,
  getDayPlanItemImageUploadDir,
  getTripDayUploadDir,
  getTripUploadDir,
  getTripsUploadRoot,
} from "@/lib/trips/uploadPaths";
import {
  createTripWithDays,
  deleteTripForUser,
  getTripDayPrintPayloadForUser,
  getTripExportForUser,
  getTripWithDaysForUser,
  importTripFromExportForUser,
  updateTripDayImageForUser,
  updateTripWithDays,
} from "@/lib/repositories/tripRepo";
import type { TripImportPayloadInput } from "@/lib/validation/tripImportSchemas";
import { jpegBytes, pngBytes, webpBytes, writeUploadFile } from "./helpers/uploadFixtures";

const VALID_RANGE = {
  startDate: "2026-04-01T00:00:00.000Z",
  endDate: "2026-04-02T00:00:00.000Z",
};

/**
 * The v1 payload shape, spelled out with the defaults the v2 schema fills in.
 *
 * `importTripFromExportForUser` is typed against the schema's *output*, so a fixture that omits the
 * v2 fields is not a v1 payload - it is a payload that never went through Zod. The AC2 regression
 * guard that a real v1 file still parses lives in `test/tripImportSchemas.test.ts`, where the input
 * side is what is under test.
 */
const IMPORT_PAYLOAD: TripImportPayloadInput = {
  meta: {
    exportedAt: "2026-02-14T12:00:00.000Z",
    appVersion: "0.1.0",
    formatVersion: 1,
    warnings: [],
  },
  photos: {},
  documents: {},
  trip: {
    id: "export-trip",
    name: "Imported Trip",
    startDate: "2026-11-01T00:00:00.000Z",
    endDate: "2026-11-02T00:00:00.000Z",
    heroImageUrl: null,
    heroPhotoId: null,
    createdAt: "2026-02-14T12:00:00.000Z",
    updatedAt: "2026-02-14T12:00:00.000Z",
    bucketListItems: [],
  },
  days: [
    {
      id: "export-day-2",
      date: "2026-11-02T00:00:00.000Z",
      dayIndex: 2,
      imageUrl: "/uploads/trips/export-trip/days/export-day-2/day.webp",
      imagePhotoId: null,
      note: "Arrival and city walk",
      createdAt: "2026-02-14T12:00:00.000Z",
      updatedAt: "2026-02-14T12:00:00.000Z",
      accommodation: {
        id: "export-stay-2",
        name: "Dockside Hotel",
        notes: "Near station",
        status: "booked",
        costCents: 22300,
        link: "https://example.com/stay-2",
        checkInTime: "16:00",
        checkOutTime: "10:00",
        location: { lat: 48.14, lng: 11.58, label: "Dockside" },
        createdAt: "2026-02-14T12:00:00.000Z",
        updatedAt: "2026-02-14T12:00:00.000Z",
        images: [],
        documents: [],
      },
      dayPlanItems: [
        {
          id: "export-plan-2",
          title: null,
          fromTime: null,
          toTime: null,
          contentJson: "{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"Museum\"}]}]}",
          costCents: 1800,
          linkUrl: "https://example.com/museum",
          location: { lat: 48.141, lng: 11.581, label: "Museum" },
          createdAt: "2026-02-14T12:00:00.000Z",
          updatedAt: "2026-02-14T12:00:00.000Z",
          images: [],
          documents: [],
        },
      ],
      travelSegments: [],
    },
    {
      id: "export-day-1",
      date: "2026-11-01T00:00:00.000Z",
      dayIndex: 1,
      imageUrl: null,
      imagePhotoId: null,
      note: null,
      createdAt: "2026-02-14T12:00:00.000Z",
      updatedAt: "2026-02-14T12:00:00.000Z",
      accommodation: null,
      dayPlanItems: [],
      travelSegments: [],
    },
  ],
};

/**
 * A complete v2 backup: pooled photos on every surface, an accommodation and a plan-item gallery, a
 * travel segment wired to the *source* record ids, and bucket list items.
 *
 * The v1 `heroImageUrl` / `imageUrl` strings deliberately point into a foreign trip's directory, so
 * a test can prove the pooled photo took precedence rather than the old dead link surviving.
 */
const V2_IMPORT_PAYLOAD: TripImportPayloadInput = {
  meta: {
    exportedAt: "2026-02-14T12:00:00.000Z",
    appVersion: "0.1.0",
    formatVersion: 2,
    warnings: [],
  },
  photos: {
    p1: { contentType: "image/jpeg", archivePath: "photos/p1.jpg" },
    p2: { contentType: "image/png", archivePath: "photos/p2.png" },
    p3: { contentType: "image/webp", archivePath: "photos/p3.webp" },
    p4: { contentType: "image/jpeg", archivePath: "photos/p4.jpg" },
  },
  documents: {},
  trip: {
    id: "source-trip",
    name: "Complete Backup Trip",
    startDate: "2026-12-01T00:00:00.000Z",
    endDate: "2026-12-02T00:00:00.000Z",
    heroImageUrl: "/uploads/trips/source-trip/hero.jpg",
    heroPhotoId: "p1",
    createdAt: "2026-02-14T12:00:00.000Z",
    updatedAt: "2026-02-14T12:00:00.000Z",
    bucketListItems: [
      {
        id: "source-bucket-1",
        title: "Northern lights",
        description: "  Away from town  ",
        positionText: "   ",
        location: { lat: 69.65, lng: 18.95, label: "Tromso" },
        createdAt: "2026-02-14T12:00:00.000Z",
        updatedAt: "2026-02-14T12:00:00.000Z",
      },
      {
        id: "source-bucket-2",
        title: "Fjord cruise",
        description: null,
        positionText: null,
        location: null,
        createdAt: "2026-02-14T12:00:00.000Z",
        updatedAt: "2026-02-14T12:00:00.000Z",
      },
    ],
  },
  days: [
    {
      id: "source-day-1",
      date: "2026-12-01T00:00:00.000Z",
      dayIndex: 1,
      imageUrl: "/uploads/trips/source-trip/days/source-day-1/day.png",
      imagePhotoId: "p2",
      note: null,
      createdAt: "2026-02-14T12:00:00.000Z",
      updatedAt: "2026-02-14T12:00:00.000Z",
      accommodation: {
        id: "source-stay-1",
        name: "Harbour Inn",
        notes: null,
        status: "booked",
        costCents: null,
        link: null,
        checkInTime: null,
        checkOutTime: null,
        location: null,
        createdAt: "2026-02-14T12:00:00.000Z",
        updatedAt: "2026-02-14T12:00:00.000Z",
        images: [{ sortOrder: 0, photoId: "p3" }],
        documents: [],
      },
      dayPlanItems: [
        {
          id: "source-plan-1",
          title: "Ferry terminal",
          fromTime: null,
          toTime: null,
          contentJson: "{\"type\":\"doc\"}",
          costCents: null,
          linkUrl: null,
          location: null,
          createdAt: "2026-02-14T12:00:00.000Z",
          updatedAt: "2026-02-14T12:00:00.000Z",
          // Two slots, one of them sharing a pool entry with the accommodation gallery: a pooled
          // photo referenced twice must land as two files, one per slot.
          images: [
            { sortOrder: 0, photoId: "p4" },
            { sortOrder: 1, photoId: "p3" },
          ],
          documents: [],
        },
      ],
      travelSegments: [
        {
          id: "source-seg-1",
          fromItemType: "accommodation",
          fromItemId: "source-stay-1",
          toItemType: "dayPlanItem",
          toItemId: "source-plan-1",
          transportType: "ship",
          durationMinutes: 45,
          distanceKm: null,
          linkUrl: "https://example.com/ferry",
          createdAt: "2026-02-14T12:00:00.000Z",
          updatedAt: "2026-02-14T12:00:00.000Z",
        },
      ],
    },
    {
      id: "source-day-2",
      date: "2026-12-02T00:00:00.000Z",
      dayIndex: 2,
      imageUrl: null,
      imagePhotoId: null,
      note: null,
      createdAt: "2026-02-14T12:00:00.000Z",
      updatedAt: "2026-02-14T12:00:00.000Z",
      accommodation: null,
      dayPlanItems: [],
      travelSegments: [],
    },
  ],
};

const v2PhotoBytes = () =>
  new Map([
    ["photos/p1.jpg", jpegBytes()],
    ["photos/p2.png", pngBytes()],
    ["photos/p3.webp", webpBytes()],
    ["photos/p4.jpg", jpegBytes(128)],
  ]);

describe("tripRepo", () => {
  const uploadsRoot = getTripsUploadRoot();

  beforeEach(async () => {
    await prisma.tripDay.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
    await fs.rm(uploadsRoot, { recursive: true, force: true });
  });

  it("does not create days when trip creation fails", async () => {
    await expect(
      createTripWithDays({
        userId: "missing-user",
        name: "Failing Trip",
        ...VALID_RANGE,
      })
    ).rejects.toBeDefined();

    const tripCount = await prisma.trip.count();
    const dayCount = await prisma.tripDay.count();

    expect(tripCount).toBe(0);
    expect(dayCount).toBe(0);
  });

  it("returns days in ascending dayIndex order", async () => {
    const user = await prisma.user.create({
      data: {
        email: "trip-order@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });

    const trip = await prisma.trip.create({
      data: {
        userId: user.id,
        name: "Ordering Trip",
        startDate: new Date("2026-04-01T00:00:00.000Z"),
        endDate: new Date("2026-04-03T00:00:00.000Z"),
      },
    });

    await prisma.tripDay.createMany({
      data: [
        { tripId: trip.id, date: new Date("2026-04-02T00:00:00.000Z"), dayIndex: 2 },
        { tripId: trip.id, date: new Date("2026-04-01T00:00:00.000Z"), dayIndex: 1 },
        { tripId: trip.id, date: new Date("2026-04-03T00:00:00.000Z"), dayIndex: 3 },
      ],
    });

    const detail = await getTripWithDaysForUser(user.id, trip.id);

    expect(detail).not.toBeNull();
    expect(detail?.days.map((day) => day.dayIndex)).toEqual([1, 2, 3]);
  });

  it("orders days by dayIndex then date", async () => {
    const user = await prisma.user.create({
      data: {
        email: "trip-tiebreaker@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });

    const trip = await prisma.trip.create({
      data: {
        userId: user.id,
        name: "Tie Break Trip",
        startDate: new Date("2026-04-01T00:00:00.000Z"),
        endDate: new Date("2026-04-03T00:00:00.000Z"),
      },
    });

    await prisma.tripDay.createMany({
      data: [
        { tripId: trip.id, date: new Date("2026-04-02T00:00:00.000Z"), dayIndex: 1 },
        { tripId: trip.id, date: new Date("2026-04-01T00:00:00.000Z"), dayIndex: 1 },
        { tripId: trip.id, date: new Date("2026-04-03T00:00:00.000Z"), dayIndex: 2 },
      ],
    });

    const detail = await getTripWithDaysForUser(user.id, trip.id);

    expect(detail).not.toBeNull();
    expect(detail?.days.map((day) => `${day.dayIndex}-${day.date.toISOString()}`)).toEqual([
      "1-2026-04-01T00:00:00.000Z",
      "1-2026-04-02T00:00:00.000Z",
      "2-2026-04-03T00:00:00.000Z",
    ]);
  });

  it("builds complete export payload with nested accommodation and day plans", async () => {
    const user = await prisma.user.create({
      data: {
        email: "trip-export@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });

    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Export Trip",
      startDate: "2026-11-01T00:00:00.000Z",
      endDate: "2026-11-02T00:00:00.000Z",
    });

    const [day1, day2] = await prisma.tripDay.findMany({
      where: { tripId: trip.id },
      orderBy: { dayIndex: "asc" },
    });
    await prisma.tripDay.update({
      where: { id: day1.id },
      data: {
        imageUrl: "/uploads/trips/export-trip/days/day-1/day.webp",
        note: "Arrival and check-in",
      },
    });

    const stay = await prisma.accommodation.create({
      data: {
        tripDayId: day1.id,
        name: "Dockside Hotel",
        notes: "Near ferry terminal",
        status: "BOOKED",
        costCents: 22300,
        link: "https://example.com/stay",
        checkInTime: "16:00",
        checkOutTime: "10:00",
        locationLat: 48.1401,
        locationLng: 11.5802,
        locationLabel: "Dockside",
      },
    });
    const planItem = await prisma.dayPlanItem.create({
      data: {
        tripDayId: day1.id,
        contentJson: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Museum" }] }] }),
        costCents: 1500,
        linkUrl: "https://example.com/plan-1",
        locationLat: 48.141,
        locationLng: 11.581,
        locationLabel: "Museum",
      },
    });
    await prisma.dayPlanItem.create({
      data: {
        tripDayId: day2.id,
        contentJson: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Walk" }] }] }),
        costCents: null,
        linkUrl: null,
      },
    });

    await prisma.travelSegment.create({
      data: {
        tripDayId: day1.id,
        fromItemType: "ACCOMMODATION",
        fromItemId: stay.id,
        toItemType: "DAY_PLAN_ITEM",
        toItemId: planItem.id,
        transportType: "CAR",
        durationMinutes: 20,
        distanceKm: 4.2,
        linkUrl: null,
      },
    });
    // Inserted out of alphabetical order to pin `title asc, createdAt asc, id asc`.
    await prisma.tripBucketListItem.create({
      data: { tripId: trip.id, title: "Rooftop bar", description: "Sunset", positionText: "Centre" },
    });
    await prisma.tripBucketListItem.create({
      data: {
        tripId: trip.id,
        title: "Botanical garden",
        locationLat: 48.15,
        locationLng: 11.5,
        locationLabel: "North park",
      },
    });

    // Real files, so the pool and `photoFiles` are exercised end to end. The day image URL above is
    // deliberately left pointing at a foreign trip directory - it must stay unpooled and warn.
    await writeUploadFile(getTripUploadDir(trip.id), "hero.jpg", "hero-bytes");
    await writeUploadFile(getAccommodationImageUploadDir(trip.id, day1.id, stay.id), "stay.webp", "stay-bytes");
    await writeUploadFile(getDayPlanItemImageUploadDir(trip.id, day1.id, planItem.id), "plan.png", "plan-bytes");
    await prisma.trip.update({
      where: { id: trip.id },
      data: { heroImageUrl: `/uploads/trips/${trip.id}/hero.jpg` },
    });
    await prisma.accommodationImage.create({
      data: {
        accommodationId: stay.id,
        imageUrl: `/uploads/trips/${trip.id}/days/${day1.id}/accommodations/${stay.id}/stay.webp`,
        sortOrder: 0,
      },
    });
    await prisma.dayPlanItemImage.create({
      data: {
        dayPlanItemId: planItem.id,
        imageUrl: `/uploads/trips/${trip.id}/days/${day1.id}/day-plan-items/${planItem.id}/plan.png`,
        sortOrder: 0,
      },
    });

    const exportResult = await getTripExportForUser(user.id, trip.id);
    const exported = exportResult?.payload ?? null;

    expect(exported).not.toBeNull();
    expect(exported?.trip.id).toBe(trip.id);
    expect(exported?.trip.name).toBe("Export Trip");
    expect(exported?.trip.startDate).toBe("2026-11-01T00:00:00.000Z");
    expect(exported?.trip.endDate).toBe("2026-11-02T00:00:00.000Z");
    expect(exported?.trip.createdAt).toMatch(/Z$/);
    expect(exported?.trip.updatedAt).toMatch(/Z$/);
    expect(exported?.days).toHaveLength(2);
    expect(exported?.days[0]).toEqual(
      expect.objectContaining({
        imageUrl: "/uploads/trips/export-trip/days/day-1/day.webp",
        note: "Arrival and check-in",
      })
    );
    expect(exported?.days[0].accommodation).toEqual(
      expect.objectContaining({
        name: "Dockside Hotel",
        status: "booked",
        costCents: 22300,
        payments: [{ amountCents: 22300, dueDate: "2026-11-01" }],
        link: "https://example.com/stay",
        checkInTime: "16:00",
        checkOutTime: "10:00",
        location: { lat: 48.1401, lng: 11.5802, label: "Dockside" },
      })
    );
    expect(exported?.days[0].dayPlanItems[0]).toEqual(
      expect.objectContaining({
        costCents: 1500,
        payments: [{ amountCents: 1500, dueDate: "2026-11-01" }],
        linkUrl: "https://example.com/plan-1",
        location: { lat: 48.141, lng: 11.581, label: "Museum" },
      })
    );
    expect(exported?.days[1].accommodation).toBeNull();
    expect(exported?.days[1].dayPlanItems).toHaveLength(1);
    expect(exported?.days[1].dayPlanItems[0].payments).toEqual([]);
    expect(exported?.days[1].dayPlanItems[0].location).toBeNull();

    // --- v2 additions -------------------------------------------------------------------------

    // Pool keys follow the traversal: hero, then day by day (day image, accommodation gallery, plan
    // item galleries). The day image points at a foreign trip directory, so it never earns a key.
    expect(exported?.photos).toEqual({
      p1: { contentType: "image/jpeg", archivePath: "photos/p1.jpg" },
      p2: { contentType: "image/webp", archivePath: "photos/p2.webp" },
      p3: { contentType: "image/png", archivePath: "photos/p3.png" },
    });
    expect(exportResult?.photoFiles.map((photo) => photo.archivePath)).toEqual([
      "photos/p1.jpg",
      "photos/p2.webp",
      "photos/p3.png",
    ]);
    // `filePath` is a realpath - it is what the pool dedupes aliases on - so compare it in the same
    // terms rather than against the lexical path (macOS resolves `/var` to `/private/var`).
    expect(exportResult?.photoFiles[0].filePath).toBe(
      await fs.realpath(path.join(getTripUploadDir(trip.id), "hero.jpg")),
    );

    expect(exported?.trip.heroPhotoId).toBe("p1");
    expect(exported?.trip.heroImageUrl).toBe(`/uploads/trips/${trip.id}/hero.jpg`);
    expect(exported?.days[0].imagePhotoId).toBeNull();
    expect(exported?.days[1].imagePhotoId).toBeNull();
    expect(exported?.days[0].accommodation?.images).toEqual([{ sortOrder: 0, photoId: "p2" }]);
    expect(exported?.days[0].dayPlanItems[0].images).toEqual([{ sortOrder: 0, photoId: "p3" }]);
    expect(exported?.days[1].dayPlanItems[0].images).toEqual([]);

    expect(exported?.warnings).toHaveLength(1);
    expect(exported?.warnings[0]).toContain("/uploads/trips/export-trip/days/day-1/day.webp");

    expect(exported?.trip.bucketListItems.map((item) => item.title)).toEqual([
      "Botanical garden",
      "Rooftop bar",
    ]);
    expect(exported?.trip.bucketListItems[0]).toEqual(
      expect.objectContaining({
        description: null,
        positionText: null,
        location: { lat: 48.15, lng: 11.5, label: "North park" },
      })
    );
    expect(exported?.trip.bucketListItems[1]).toEqual(
      expect.objectContaining({ description: "Sunset", positionText: "Centre", location: null })
    );

    expect(exported?.days[1].travelSegments).toEqual([]);
    expect(exported?.days[0].travelSegments).toHaveLength(1);
    expect(exported?.days[0].travelSegments[0]).toEqual(
      expect.objectContaining({
        fromItemType: "accommodation",
        // Endpoint ids are the exported record ids - Story 2.32 remaps against exactly these.
        fromItemId: exported?.days[0].accommodation?.id,
        toItemType: "dayPlanItem",
        toItemId: exported?.days[0].dayPlanItems[0].id,
        transportType: "car",
        durationMinutes: 20,
        distanceKm: 4.2,
        linkUrl: null,
      })
    );
  });

  it("pools one entry per distinct file when the same photo is referenced twice", async () => {
    const user = await prisma.user.create({
      data: {
        email: "trip-export-dedupe@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });

    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Dedupe Export",
      startDate: "2026-11-01T00:00:00.000Z",
      endDate: "2026-11-01T00:00:00.000Z",
    });
    const [day] = await prisma.tripDay.findMany({ where: { tripId: trip.id } });
    const stay = await prisma.accommodation.create({
      data: { tripDayId: day.id, name: "Shared Photo Hotel" },
    });

    await writeUploadFile(getAccommodationImageUploadDir(trip.id, day.id, stay.id), "shared.jpg", "shared");
    const sharedUrl = `/uploads/trips/${trip.id}/days/${day.id}/accommodations/${stay.id}/shared.jpg`;
    await prisma.accommodationImage.createMany({
      data: [
        { accommodationId: stay.id, imageUrl: sharedUrl, sortOrder: 0 },
        { accommodationId: stay.id, imageUrl: sharedUrl, sortOrder: 1 },
      ],
    });

    const exportResult = await getTripExportForUser(user.id, trip.id);

    expect(Object.keys(exportResult?.payload.photos ?? {})).toEqual(["p1"]);
    expect(exportResult?.photoFiles).toHaveLength(1);
    expect(exportResult?.payload.days[0].accommodation?.images).toEqual([
      { sortOrder: 0, photoId: "p1" },
      { sortOrder: 1, photoId: "p1" },
    ]);
  });

  it("refuses to pool a stored path that resolves outside the trip's own upload directory", async () => {
    const user = await prisma.user.create({
      data: {
        email: "trip-export-containment@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });

    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Containment Export",
      startDate: "2026-11-01T00:00:00.000Z",
      endDate: "2026-11-01T00:00:00.000Z",
    });
    const [day] = await prisma.tripDay.findMany({ where: { tripId: trip.id } });

    // A sibling directory whose name merely starts with this trip's id must not pass the prefix test.
    await writeUploadFile(`${getTripUploadDir(trip.id)}-evil`, "evil.jpg", "evil");
    await writeUploadFile(uploadsRoot, "escape.png", "escaped");

    await prisma.trip.update({
      where: { id: trip.id },
      data: { heroImageUrl: `/uploads/trips/${trip.id}-evil/evil.jpg` },
    });
    await prisma.tripDay.update({
      where: { id: day.id },
      data: { imageUrl: `/uploads/trips/${trip.id}/../../escape.png` },
    });

    const exportResult = await getTripExportForUser(user.id, trip.id);

    expect(exportResult?.payload.photos).toEqual({});
    expect(exportResult?.photoFiles).toEqual([]);
    expect(exportResult?.payload.trip.heroPhotoId).toBeNull();
    expect(exportResult?.payload.days[0].imagePhotoId).toBeNull();
    // The v1 fields keep their stored value regardless.
    expect(exportResult?.payload.trip.heroImageUrl).toBe(`/uploads/trips/${trip.id}-evil/evil.jpg`);
    expect(exportResult?.payload.days[0].imageUrl).toBe(`/uploads/trips/${trip.id}/../../escape.png`);
    expect(exportResult?.payload.warnings).toHaveLength(2);
  });

  it("refuses to pool a symlink inside the trip directory that points outside it", async () => {
    const user = await prisma.user.create({
      data: {
        email: "trip-export-symlink@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });

    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Symlink Export",
      startDate: "2026-11-01T00:00:00.000Z",
      endDate: "2026-11-01T00:00:00.000Z",
    });

    // The lexical containment check passes for this URL - the link itself lives inside the trip's
    // own directory. Only realpath sees that reading it would hand the caller a file it does not own.
    await writeUploadFile(uploadsRoot, "outside-secret.jpg", "secret-bytes");
    const tripDir = getTripUploadDir(trip.id);
    await fs.mkdir(tripDir, { recursive: true });
    await fs.symlink(path.join(uploadsRoot, "outside-secret.jpg"), path.join(tripDir, "hero.jpg"));

    await prisma.trip.update({
      where: { id: trip.id },
      data: { heroImageUrl: `/uploads/trips/${trip.id}/hero.jpg` },
    });

    const exportResult = await getTripExportForUser(user.id, trip.id);

    expect(exportResult?.payload.photos).toEqual({});
    expect(exportResult?.photoFiles).toEqual([]);
    expect(exportResult?.payload.trip.heroPhotoId).toBeNull();
    expect(exportResult?.payload.warnings).toHaveLength(1);
  });

  it("warns when a gallery entry is dropped, because a gallery ref carries no fallback URL", async () => {
    const user = await prisma.user.create({
      data: {
        email: "trip-export-gallery-warn@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });

    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Gallery Warning Export",
      startDate: "2026-11-01T00:00:00.000Z",
      endDate: "2026-11-01T00:00:00.000Z",
    });
    const [day] = await prisma.tripDay.findMany({ where: { tripId: trip.id } });
    const stay = await prisma.accommodation.create({
      data: { tripDayId: day.id, name: "External Photo Hotel" },
    });

    // An external URL is legal in this schema, is never fetched, and - unlike a hero or day image -
    // has no surviving v1 field on a gallery ref. Without a warning it would vanish without trace.
    await prisma.accommodationImage.create({
      data: { accommodationId: stay.id, imageUrl: "https://cdn.example.com/lobby.jpg", sortOrder: 3 },
    });

    const exportResult = await getTripExportForUser(user.id, trip.id);

    expect(exportResult?.payload.photos).toEqual({});
    expect(exportResult?.payload.days[0].accommodation?.images).toEqual([]);
    expect(exportResult?.payload.warnings).toEqual([
      "Dropped gallery image at sortOrder 3 that could not be archived: https://cdn.example.com/lobby.jpg",
    ]);
  });

  it("reports every gallery slot lost to one bad url, not just the first", async () => {
    const user = await prisma.user.create({
      data: {
        email: "trip-export-gallery-repeat@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });

    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Repeated Bad Gallery Export",
      startDate: "2026-11-01T00:00:00.000Z",
      endDate: "2026-11-01T00:00:00.000Z",
    });
    const [day] = await prisma.tripDay.findMany({ where: { tripId: trip.id } });
    const stay = await prisma.accommodation.create({
      data: { tripDayId: day.id, name: "Repeated Photo Hotel" },
    });

    // Nothing forbids one url occupying several slots - `AccommodationImage` is unique on
    // `(accommodationId, sortOrder)`. Warnings deduped per url alone would name slot 0 and let
    // slot 1 disappear silently, which is the one thing a gallery ref cannot afford: it carries no
    // fallback url of its own.
    for (const sortOrder of [0, 1]) {
      await prisma.accommodationImage.create({
        data: { accommodationId: stay.id, imageUrl: "https://cdn.example.com/lobby.jpg", sortOrder },
      });
    }
    // A missing local file is reported once by the pool resolver for the row that discovered it,
    // then per slot for every later row - one line per lost slot either way, never zero.
    const missingUrl = `/uploads/trips/${trip.id}/gone.jpg`;
    for (const sortOrder of [2, 3]) {
      await prisma.accommodationImage.create({
        data: { accommodationId: stay.id, imageUrl: missingUrl, sortOrder },
      });
    }

    const exportResult = await getTripExportForUser(user.id, trip.id);

    expect(exportResult?.payload.days[0].accommodation?.images).toEqual([]);
    expect(exportResult?.payload.warnings).toEqual([
      "Dropped gallery image at sortOrder 0 that could not be archived: https://cdn.example.com/lobby.jpg",
      "Dropped gallery image at sortOrder 1 that could not be archived: https://cdn.example.com/lobby.jpg",
      `Skipped image whose file is missing on disk: ${missingUrl}`,
      `Dropped gallery image at sortOrder 3 that could not be archived: ${missingUrl}`,
    ]);
  });

  it("pools one entry when two urls alias the same file through a symlink inside the trip", async () => {
    const user = await prisma.user.create({
      data: {
        email: "trip-export-alias@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });

    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Alias Export",
      startDate: "2026-11-01T00:00:00.000Z",
      endDate: "2026-11-01T00:00:00.000Z",
    });
    const [day] = await prisma.tripDay.findMany({ where: { tripId: trip.id } });

    // Both urls resolve inside the trip's directory, so both are legitimately archivable - but they
    // are the same bytes. Deduping on the lexical path would write the file into the archive twice
    // under two pool ids; the pool dedupes on the realpath so the aliases collapse.
    const tripDir = getTripUploadDir(trip.id);
    await writeUploadFile(tripDir, "hero.jpg", "hero-bytes");
    await fs.symlink(path.join(tripDir, "hero.jpg"), path.join(tripDir, "alias.jpg"));

    await prisma.trip.update({
      where: { id: trip.id },
      data: { heroImageUrl: `/uploads/trips/${trip.id}/hero.jpg` },
    });
    await prisma.tripDay.update({
      where: { id: day.id },
      data: { imageUrl: `/uploads/trips/${trip.id}/alias.jpg` },
    });

    const exportResult = await getTripExportForUser(user.id, trip.id);

    expect(Object.keys(exportResult?.payload.photos ?? {})).toEqual(["p1"]);
    expect(exportResult?.photoFiles).toHaveLength(1);
    expect(exportResult?.payload.trip.heroPhotoId).toBe("p1");
    expect(exportResult?.payload.days[0].imagePhotoId).toBe("p1");
    expect(exportResult?.payload.warnings).toEqual([]);
  });

  it("falls back to a binary content type for an extension outside the upload allow-list", async () => {
    const user = await prisma.user.create({
      data: {
        email: "trip-export-extension@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });

    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Extension Export",
      startDate: "2026-11-01T00:00:00.000Z",
      endDate: "2026-11-01T00:00:00.000Z",
    });
    const [day] = await prisma.tripDay.findMany({ where: { tripId: trip.id } });

    await writeUploadFile(getTripUploadDir(trip.id), "hero.gif", "gif-bytes");
    await writeUploadFile(getTripUploadDir(trip.id), "plain", "no-extension-bytes");

    await prisma.trip.update({
      where: { id: trip.id },
      data: { heroImageUrl: `/uploads/trips/${trip.id}/hero.gif` },
    });
    await prisma.tripDay.update({
      where: { id: day.id },
      data: { imageUrl: `/uploads/trips/${trip.id}/plain` },
    });

    const exportResult = await getTripExportForUser(user.id, trip.id);

    expect(exportResult?.payload.photos).toEqual({
      p1: { contentType: "application/octet-stream", archivePath: "photos/p1.bin" },
      p2: { contentType: "application/octet-stream", archivePath: "photos/p2.bin" },
    });
    expect(exportResult?.payload.trip.heroPhotoId).toBe("p1");
    expect(exportResult?.payload.days[0].imagePhotoId).toBe("p2");
    expect(exportResult?.payload.warnings).toEqual([]);
  });

  it("skips a stored path that resolves to a directory rather than a regular file", async () => {
    const user = await prisma.user.create({
      data: {
        email: "trip-export-directory@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });

    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Directory Export",
      startDate: "2026-11-01T00:00:00.000Z",
      endDate: "2026-11-01T00:00:00.000Z",
    });

    await fs.mkdir(path.join(getTripUploadDir(trip.id), "hero.jpg"), { recursive: true });
    await prisma.trip.update({
      where: { id: trip.id },
      data: { heroImageUrl: `/uploads/trips/${trip.id}/hero.jpg` },
    });

    const exportResult = await getTripExportForUser(user.id, trip.id);

    expect(exportResult?.payload.photos).toEqual({});
    expect(exportResult?.payload.trip.heroPhotoId).toBeNull();
    expect(exportResult?.payload.warnings).toEqual([
      `Skipped image that is not a regular file: /uploads/trips/${trip.id}/hero.jpg`,
    ]);
  });

  it("builds a printable day payload with previous stay, travel segments, route points, and image metadata", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "trip-print-owner@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });

    const { trip } = await createTripWithDays({
      userId: owner.id,
      name: "Printable Trip",
      startDate: "2026-11-01T00:00:00.000Z",
      endDate: "2026-11-02T00:00:00.000Z",
    });

    const [day1, day2] = await prisma.tripDay.findMany({
      where: { tripId: trip.id },
      orderBy: { dayIndex: "asc" },
    });

    const previousStay = await prisma.accommodation.create({
      data: {
        tripDayId: day1.id,
        name: "Airport Hotel",
        notes: "Late arrival",
        status: "BOOKED",
        costCents: 12000,
        link: "https://example.com/airport-hotel",
        checkInTime: "22:00",
        checkOutTime: "08:00",
        locationLat: 48.3538,
        locationLng: 11.7861,
        locationLabel: "Airport",
      },
    });
    await prisma.accommodationImage.create({
      data: {
        accommodationId: previousStay.id,
        imageUrl: "/uploads/trips/printable/prev-stay.webp",
        sortOrder: 0,
      },
    });

    const breakfast = await prisma.dayPlanItem.create({
      data: {
        tripDayId: day2.id,
        title: "Breakfast stop",
        fromTime: "08:30",
        toTime: "09:15",
        contentJson: JSON.stringify({
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Coffee and croissant" }] }],
        }),
        costCents: 1800,
        linkUrl: "https://example.com/breakfast",
        locationLat: 48.1372,
        locationLng: 11.5756,
        locationLabel: "Cafe",
      },
    });
    await prisma.dayPlanItemImage.create({
      data: {
        dayPlanItemId: breakfast.id,
        imageUrl: "/uploads/trips/printable/breakfast.webp",
        sortOrder: 0,
      },
    });

    const museum = await prisma.dayPlanItem.create({
      data: {
        tripDayId: day2.id,
        title: "Museum visit",
        fromTime: "10:00",
        toTime: "12:00",
        contentJson: JSON.stringify({
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Main gallery and exhibits" }] }],
        }),
        costCents: 2400,
        linkUrl: null,
        locationLat: 48.145,
        locationLng: 11.582,
        locationLabel: "Museum",
      },
    });

    const currentStay = await prisma.accommodation.create({
      data: {
        tripDayId: day2.id,
        name: "City Hotel",
        notes: "Check in before dinner",
        status: "PLANNED",
        costCents: 22300,
        link: "https://example.com/city-hotel",
        checkInTime: "16:00",
        checkOutTime: "10:00",
        locationLat: 48.148,
        locationLng: 11.59,
        locationLabel: "City Center",
      },
    });
    await prisma.accommodationImage.create({
      data: {
        accommodationId: currentStay.id,
        imageUrl: "/uploads/trips/printable/current-stay.webp",
        sortOrder: 0,
      },
    });

    await prisma.travelSegment.createMany({
      data: [
        {
          tripDayId: day2.id,
          fromItemType: "ACCOMMODATION",
          fromItemId: previousStay.id,
          toItemType: "DAY_PLAN_ITEM",
          toItemId: breakfast.id,
          transportType: "CAR",
          durationMinutes: 20,
          distanceKm: 15.4,
          linkUrl: "https://example.com/segment-1",
        },
        {
          tripDayId: day2.id,
          fromItemType: "DAY_PLAN_ITEM",
          fromItemId: breakfast.id,
          toItemType: "DAY_PLAN_ITEM",
          toItemId: museum.id,
          transportType: "SHIP",
          durationMinutes: 35,
          distanceKm: 4.2,
          linkUrl: null,
        },
        {
          tripDayId: day2.id,
          fromItemType: "DAY_PLAN_ITEM",
          fromItemId: museum.id,
          toItemType: "ACCOMMODATION",
          toItemId: currentStay.id,
          transportType: "FLIGHT",
          durationMinutes: 10,
          distanceKm: null,
          linkUrl: null,
        },
      ],
    });

    const printable = await getTripDayPrintPayloadForUser({
      userId: owner.id,
      tripId: trip.id,
      dayId: day2.id,
    });

    expect(printable).not.toBeNull();
    expect(printable?.trip).toEqual(
      expect.objectContaining({
        id: trip.id,
        name: "Printable Trip",
      }),
    );
    expect(printable?.day).toEqual(
      expect.objectContaining({
        id: day2.id,
        dayIndex: 2,
      }),
    );
    expect(printable?.timeline.map((entry) => entry.kind)).toEqual([
      "previousStay",
      "travelSegment",
      "planItem",
      "travelSegment",
      "planItem",
      "travelSegment",
      "currentStay",
    ]);
    expect(printable?.timeline[0]).toEqual(
      expect.objectContaining({
        kind: "previousStay",
        stay: expect.objectContaining({
          id: previousStay.id,
          name: "Airport Hotel",
          images: [{ id: expect.any(String), imageUrl: "/uploads/trips/printable/prev-stay.webp", sortOrder: 0 }],
        }),
      }),
    );
    expect(printable?.timeline[2]).toEqual(
      expect.objectContaining({
        kind: "planItem",
        item: expect.objectContaining({
          id: breakfast.id,
          title: "Breakfast stop",
          images: [{ id: expect.any(String), imageUrl: "/uploads/trips/printable/breakfast.webp", sortOrder: 0 }],
        }),
      }),
    );
    expect(printable?.timeline[3]).toEqual(
      expect.objectContaining({
        kind: "travelSegment",
        segment: expect.objectContaining({
          fromItemId: breakfast.id,
          toItemId: museum.id,
          transportType: "ship",
          durationMinutes: 35,
          distanceKm: 4.2,
        }),
      }),
    );
    expect(printable?.map.points.map((point) => point.kind)).toEqual(["previousStay", "planItem", "planItem", "currentStay"]);
    expect(printable?.map.points.map((point) => point.label)).toEqual([
      "Airport Hotel",
      "Breakfast stop",
      "Museum visit",
      "City Hotel",
    ]);
    expect(printable?.map.missingLocations).toEqual([]);
  });

  it("allows viewer collaborators to load printable day payloads", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "trip-print-owner-2@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });
    const viewer = await prisma.user.create({
      data: {
        email: "trip-print-viewer@example.com",
        passwordHash: "hashed",
        role: "VIEWER",
      },
    });

    const { trip } = await createTripWithDays({
      userId: owner.id,
      name: "Shared Printable Trip",
      startDate: "2026-12-01T00:00:00.000Z",
      endDate: "2026-12-01T00:00:00.000Z",
    });
    const [day] = await prisma.tripDay.findMany({
      where: { tripId: trip.id },
      orderBy: { dayIndex: "asc" },
    });

    await prisma.tripMember.create({
      data: {
        tripId: trip.id,
        userId: viewer.id,
        role: "VIEWER",
      },
    });

    const printable = await getTripDayPrintPayloadForUser({
      userId: viewer.id,
      tripId: trip.id,
      dayId: day.id,
    });

    expect(printable).not.toBeNull();
    expect(printable?.trip.id).toBe(trip.id);
    expect(printable?.day.id).toBe(day.id);
  });

  it("returns no previousStay entry for the first day of a trip", async () => {
    const user = await prisma.user.create({
      data: {
        email: "trip-print-first-day@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });

    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "First Day Trip",
      startDate: "2026-11-10T00:00:00.000Z",
      endDate: "2026-11-10T00:00:00.000Z",
    });

    const [day1] = await prisma.tripDay.findMany({
      where: { tripId: trip.id },
      orderBy: { dayIndex: "asc" },
    });

    await prisma.dayPlanItem.create({
      data: {
        tripDayId: day1.id,
        title: "Morning walk",
        fromTime: "09:00",
        toTime: "10:00",
        contentJson: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Walk" }] }] }),
        linkUrl: null,
      },
    });

    const printable = await getTripDayPrintPayloadForUser({
      userId: user.id,
      tripId: trip.id,
      dayId: day1.id,
    });

    expect(printable).not.toBeNull();
    const kinds = printable?.timeline.map((e) => e.kind) ?? [];
    expect(kinds).not.toContain("previousStay");
    expect(kinds).toContain("planItem");
  });

  it("returns export days ordered by dayIndex then date", async () => {
    const user = await prisma.user.create({
      data: {
        email: "trip-export-order@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });

    const trip = await prisma.trip.create({
      data: {
        userId: user.id,
        name: "Export Order Trip",
        startDate: new Date("2026-12-01T00:00:00.000Z"),
        endDate: new Date("2026-12-03T00:00:00.000Z"),
      },
    });

    await prisma.tripDay.createMany({
      data: [
        { tripId: trip.id, date: new Date("2026-12-02T00:00:00.000Z"), dayIndex: 1 },
        { tripId: trip.id, date: new Date("2026-12-01T00:00:00.000Z"), dayIndex: 1 },
        { tripId: trip.id, date: new Date("2026-12-03T00:00:00.000Z"), dayIndex: 2 },
      ],
    });

    const exportResult = await getTripExportForUser(user.id, trip.id);
    const exported = exportResult?.payload ?? null;

    expect(exported).not.toBeNull();
    expect(exported?.days.map((day) => `${day.dayIndex}-${day.date}`)).toEqual([
      "1-2026-12-01T00:00:00.000Z",
      "1-2026-12-02T00:00:00.000Z",
      "2-2026-12-03T00:00:00.000Z",
    ]);
  });

  it("preserves payment row order in exports when due dates match", async () => {
    const user = await prisma.user.create({
      data: {
        email: "trip-export-payment-order@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });

    const trip = await prisma.trip.create({
      data: {
        userId: user.id,
        name: "Payment Order Trip",
        startDate: new Date("2026-12-01T00:00:00.000Z"),
        endDate: new Date("2026-12-01T00:00:00.000Z"),
      },
    });

    const day = await prisma.tripDay.create({
      data: {
        tripId: trip.id,
        date: new Date("2026-12-01T00:00:00.000Z"),
        dayIndex: 1,
      },
    });

    const item = await prisma.dayPlanItem.create({
      data: {
        tripDayId: day.id,
        title: "Ordered tickets",
        fromTime: "09:00",
        toTime: "10:00",
        contentJson: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Tickets" }] }] }),
        costCents: 3000,
        linkUrl: null,
      },
    });

    await prisma.costPayment.createMany({
      data: [
        { dayPlanItemId: item.id, amountCents: 2000, dueDate: "2026-12-01", sortOrder: 0 },
        { dayPlanItemId: item.id, amountCents: 1000, dueDate: "2026-12-01", sortOrder: 1 },
      ],
    });

    const exportResult = await getTripExportForUser(user.id, trip.id);
    const exported = exportResult?.payload ?? null;

    expect(exported?.days[0].dayPlanItems[0].payments).toEqual([
      { amountCents: 2000, dueDate: "2026-12-01" },
      { amountCents: 1000, dueDate: "2026-12-01" },
    ]);
  });

  it("updates trip and adjusts day entries to match new date range", async () => {
    const user = await prisma.user.create({
      data: {
        email: "trip-update@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });

    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Original Trip",
      startDate: "2026-05-01T00:00:00.000Z",
      endDate: "2026-05-03T00:00:00.000Z",
    });

    const updated = await updateTripWithDays({
      userId: user.id,
      tripId: trip.id,
      name: "Updated Trip",
      startDate: "2026-05-02T00:00:00.000Z",
      endDate: "2026-05-04T00:00:00.000Z",
    });

    expect(updated).not.toBeNull();
    expect(updated?.trip.name).toBe("Updated Trip");
    expect(updated?.dayCount).toBe(3);

    const days = await prisma.tripDay.findMany({
      where: { tripId: trip.id },
      orderBy: { dayIndex: "asc" },
    });

    expect(days.map((day) => day.date.toISOString())).toEqual([
      "2026-05-02T00:00:00.000Z",
      "2026-05-03T00:00:00.000Z",
      "2026-05-04T00:00:00.000Z",
    ]);
  });

  it("computes missing accommodation and plan flags per day", async () => {
    const user = await prisma.user.create({
      data: {
        email: "trip-gaps@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });

    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Gap Trip",
      startDate: "2026-09-01T00:00:00.000Z",
      endDate: "2026-09-04T00:00:00.000Z",
    });

    const days = await prisma.tripDay.findMany({
      where: { tripId: trip.id },
      orderBy: { dayIndex: "asc" },
    });

    await prisma.accommodation.create({
      data: { tripDayId: days[0].id, name: "Lake Cabin", notes: "Bring snacks" },
    });
    await prisma.dayPlanItem.create({
      data: {
        tripDayId: days[1].id,
        contentJson: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Day 2" }] }] }),
        linkUrl: null,
      },
    });
    await prisma.accommodation.create({
      data: { tripDayId: days[2].id, name: "Forest Lodge" },
    });
    await prisma.dayPlanItem.create({
      data: {
        tripDayId: days[2].id,
        contentJson: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Day 3" }] }] }),
        linkUrl: "https://example.com/plan",
      },
    });
    await prisma.accommodation.create({
      data: { tripDayId: days[3].id, name: "   " },
    });

    const detail = await getTripWithDaysForUser(user.id, trip.id);

    expect(detail).not.toBeNull();
    expect(detail?.days.map((day) => [day.missingAccommodation, day.missingPlan])).toEqual([
      [false, true],
      [true, false],
      [false, false],
      [true, true],
    ]);
    expect(detail?.days.map((day) => day.accommodation?.name ?? null)).toEqual([
      "Lake Cabin",
      null,
      "Forest Lodge",
      null,
    ]);
  });

  it("computes planned cost totals with null costs treated as zero", async () => {
    const user = await prisma.user.create({
      data: {
        email: "trip-budget@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });

    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Budget Trip",
      startDate: "2026-10-01T00:00:00.000Z",
      endDate: "2026-10-03T00:00:00.000Z",
    });

    const days = await prisma.tripDay.findMany({
      where: { tripId: trip.id },
      orderBy: { dayIndex: "asc" },
    });

    await prisma.accommodation.create({
      data: { tripDayId: days[0].id, name: "Night 1", costCents: 25000 },
    });
    await prisma.accommodation.create({
      data: { tripDayId: days[1].id, name: "Night 2", costCents: null },
    });
    await prisma.dayPlanItem.create({
      data: {
        tripDayId: days[0].id,
        contentJson: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Museum" }] }] }),
        costCents: 1300,
        linkUrl: null,
      },
    });
    await prisma.dayPlanItem.create({
      data: {
        tripDayId: days[1].id,
        contentJson: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Walk" }] }] }),
        costCents: null,
        linkUrl: null,
      },
    });

    const detail = await getTripWithDaysForUser(user.id, trip.id);

    expect(detail).not.toBeNull();
    expect(detail?.plannedCostTotal).toBe(26300);
    expect(detail?.accommodationCostTotalCents).toBe(25000);
    expect(detail?.days.map((day) => day.plannedCostSubtotal)).toEqual([26300, 0, 0]);
  });

  it("deletes trip and associated days for user", async () => {
    const user = await prisma.user.create({
      data: {
        email: "trip-delete@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });

    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Delete Trip",
      startDate: "2026-06-01T00:00:00.000Z",
      endDate: "2026-06-02T00:00:00.000Z",
    });

    const deleted = await deleteTripForUser(user.id, trip.id);
    expect(deleted).toBe(true);

    const tripCount = await prisma.trip.count({ where: { id: trip.id } });
    const dayCount = await prisma.tripDay.count({ where: { tripId: trip.id } });

    expect(tripCount).toBe(0);
    expect(dayCount).toBe(0);
  });

  it("persists hero image urls on trips", async () => {
    const user = await prisma.user.create({
      data: {
        email: "trip-hero@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });

    const heroImageUrl = "/uploads/trips/hero-trip/hero.jpg";

    const trip = await prisma.trip.create({
      data: {
        userId: user.id,
        name: "Hero Trip",
        startDate: new Date("2026-07-01T00:00:00.000Z"),
        endDate: new Date("2026-07-02T00:00:00.000Z"),
        heroImageUrl,
      },
    });

    const stored = await prisma.trip.findUnique({ where: { id: trip.id } });

    expect(stored?.heroImageUrl).toBe(heroImageUrl);
  });

  it("persists start and destination locations on trips", async () => {
    const user = await prisma.user.create({
      data: {
        email: "trip-locations@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });

    const startLocation = { lat: 48.14, lng: 11.58, label: "Munich" };
    const destinationLocation = { lat: 47.37, lng: 8.54, label: "Zurich" };

    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Location Trip",
      startDate: "2026-08-01T00:00:00.000Z",
      endDate: "2026-08-02T00:00:00.000Z",
      startLocation,
      destinationLocation,
    });

    const stored = await prisma.trip.findUnique({ where: { id: trip.id } });

    expect(stored?.startLocationLat).toBeCloseTo(startLocation.lat);
    expect(stored?.startLocationLng).toBeCloseTo(startLocation.lng);
    expect(stored?.startLocationLabel).toBe(startLocation.label);
    expect(stored?.destinationLocationLat).toBeCloseTo(destinationLocation.lat);
    expect(stored?.destinationLocationLng).toBeCloseTo(destinationLocation.lng);
    expect(stored?.destinationLocationLabel).toBe(destinationLocation.label);
  });

  it("persists image urls on trip days", async () => {
    const user = await prisma.user.create({
      data: {
        email: "trip-day-image@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });

    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Day Image Trip",
      startDate: "2026-07-01T00:00:00.000Z",
      endDate: "2026-07-01T00:00:00.000Z",
    });

    const day = await prisma.tripDay.findFirstOrThrow({ where: { tripId: trip.id } });
    const imageUrl = "/uploads/trips/day/day-1.webp";

    await prisma.tripDay.update({
      where: { id: day.id },
      data: {
        imageUrl,
      },
    });

    const stored = await prisma.tripDay.findUnique({ where: { id: day.id } });
    expect(stored?.imageUrl).toBe(imageUrl);
  });

  it("returns day image urls in trip detail", async () => {
    const user = await prisma.user.create({
      data: {
        email: "trip-day-image-detail@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });

    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Day Image Detail Trip",
      startDate: "2026-07-01T00:00:00.000Z",
      endDate: "2026-07-01T00:00:00.000Z",
    });

    const day = await prisma.tripDay.findFirstOrThrow({ where: { tripId: trip.id } });
    await prisma.tripDay.update({
      where: { id: day.id },
      data: { imageUrl: "/uploads/trips/day/day-detail.webp", note: "Flight from FRA to SIN" },
    });

    const detail = await getTripWithDaysForUser(user.id, trip.id);
    expect(detail?.days[0].imageUrl).toBe("/uploads/trips/day/day-detail.webp");
    expect(detail?.days[0].note).toBe("Flight from FRA to SIN");
  });

  it("updates trip day image url with ownership constraints", async () => {
    const user = await prisma.user.create({
      data: {
        email: "trip-day-image-update@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });

    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Day Image Update Trip",
      startDate: "2026-07-01T00:00:00.000Z",
      endDate: "2026-07-01T00:00:00.000Z",
    });

    const day = await prisma.tripDay.findFirstOrThrow({ where: { tripId: trip.id } });
    const updated = await updateTripDayImageForUser({
      userId: user.id,
      tripId: trip.id,
      dayId: day.id,
      imageUrl: "/uploads/trips/day/day-update.webp",
      note: "Flight from FRA to SIN",
    });

    expect(updated).not.toBeNull();
    expect(updated?.imageUrl).toBe("/uploads/trips/day/day-update.webp");
    expect(updated?.note).toBe("Flight from FRA to SIN");
  });

  it("removes trip day image url with ownership constraints", async () => {
    const user = await prisma.user.create({
      data: {
        email: "trip-day-image-remove@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });

    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Day Image Remove Trip",
      startDate: "2026-07-01T00:00:00.000Z",
      endDate: "2026-07-01T00:00:00.000Z",
    });

    const day = await prisma.tripDay.findFirstOrThrow({ where: { tripId: trip.id } });
    await prisma.tripDay.update({
      where: { id: day.id },
      data: { imageUrl: "/uploads/trips/day/day-remove.webp", note: "Initial note" },
    });

    const removed = await updateTripDayImageForUser({
      userId: user.id,
      tripId: trip.id,
      dayId: day.id,
      imageUrl: null,
      note: null,
    });

    expect(removed).not.toBeNull();
    expect(removed?.imageUrl).toBeNull();
    expect(removed?.note).toBeNull();
  });

  it("returns null when updating day image for non-owner", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "trip-day-image-owner@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });
    const other = await prisma.user.create({
      data: {
        email: "trip-day-image-other@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });

    const { trip } = await createTripWithDays({
      userId: owner.id,
      name: "Day Image Guard Trip",
      startDate: "2026-07-01T00:00:00.000Z",
      endDate: "2026-07-01T00:00:00.000Z",
    });

    const day = await prisma.tripDay.findFirstOrThrow({ where: { tripId: trip.id } });
    const updated = await updateTripDayImageForUser({
      userId: other.id,
      tripId: trip.id,
      dayId: day.id,
      imageUrl: "/uploads/trips/day/blocked.webp",
    });

    expect(updated).toBeNull();
  });

  it("returns conflict without writes when same-name trip exists and no strategy is set", async () => {
    const user = await prisma.user.create({
      data: {
        email: "trip-import-conflict@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });

    await prisma.trip.create({
      data: {
        userId: user.id,
        name: IMPORT_PAYLOAD.trip.name,
        startDate: new Date("2026-10-01T00:00:00.000Z"),
        endDate: new Date("2026-10-02T00:00:00.000Z"),
      },
    });

    const result = await importTripFromExportForUser({
      userId: user.id,
      payload: IMPORT_PAYLOAD,
    });

    expect(result.outcome).toBe("conflict");
    const trips = await prisma.trip.findMany({ where: { userId: user.id } });
    expect(trips).toHaveLength(1);
  });

  it("imports nested data in create-new mode with deterministic day ordering", async () => {
    const user = await prisma.user.create({
      data: {
        email: "trip-import-create-new@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });

    const result = await importTripFromExportForUser({
      userId: user.id,
      payload: IMPORT_PAYLOAD,
      strategy: "createNew",
    });

    expect(result.outcome).toBe("imported");
    expect(result.mode).toBe("createNew");
    expect(result.dayCount).toBe(2);

    const detail = await getTripWithDaysForUser(user.id, result.trip.id);
    expect(detail).not.toBeNull();
    expect(detail?.days.map((day) => `${day.dayIndex}-${day.date.toISOString()}`)).toEqual([
      "1-2026-11-01T00:00:00.000Z",
      "2-2026-11-02T00:00:00.000Z",
    ]);
    expect(detail?.days[1].imageUrl).toBe("/uploads/trips/export-trip/days/export-day-2/day.webp");
    expect(detail?.days[1].note).toBe("Arrival and city walk");
    expect(detail?.days[1].accommodation?.status).toBe("booked");
    expect(detail?.days[1].accommodation?.checkInTime).toBe("16:00");
    expect(detail?.days[1].accommodation?.checkOutTime).toBe("10:00");
    expect(detail?.days[1].accommodation?.location).toEqual({
      lat: 48.14,
      lng: 11.58,
      label: "Dockside",
    });
    expect(detail?.days[1].dayPlanItems).toHaveLength(1);
    expect(detail?.days[1].dayPlanItems[0].costCents).toBe(1800);
  });

  it("overwrites target trip data atomically in overwrite mode", async () => {
    const user = await prisma.user.create({
      data: {
        email: "trip-import-overwrite@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });

    const target = await createTripWithDays({
      userId: user.id,
      name: IMPORT_PAYLOAD.trip.name,
      startDate: "2026-10-10T00:00:00.000Z",
      endDate: "2026-10-11T00:00:00.000Z",
    });

    const targetDay = await prisma.tripDay.findFirstOrThrow({
      where: { tripId: target.trip.id, dayIndex: 1 },
    });
    await prisma.accommodation.create({
      data: {
        tripDayId: targetDay.id,
        name: "Old Accommodation",
        status: "PLANNED",
      },
    });

    const result = await importTripFromExportForUser({
      userId: user.id,
      payload: IMPORT_PAYLOAD,
      strategy: "overwrite",
      targetTripId: target.trip.id,
    });

    expect(result.outcome).toBe("imported");
    expect(result.mode).toBe("overwrite");
    expect(result.trip.id).toBe(target.trip.id);

    const detail = await getTripWithDaysForUser(user.id, target.trip.id);
    expect(detail?.name).toBe("Imported Trip");
    expect(detail?.days).toHaveLength(2);
    expect(detail?.days[1].accommodation?.name).toBe("Dockside Hotel");
  });

  it("rolls back imported records when transaction fails", async () => {
    const user = await prisma.user.create({
      data: {
        email: "trip-import-rollback-mid-transaction@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });
    // Driven with the v2 payload so the rollback covers the rows this story added as well: the
    // first day carries photos, a gallery, a travel segment and bucket list items, and the second
    // day is what fails.
    const invalidPayload = {
      ...V2_IMPORT_PAYLOAD,
      days: [
        V2_IMPORT_PAYLOAD.days[0],
        {
          ...V2_IMPORT_PAYLOAD.days[1],
          date: "not-a-date",
        },
      ],
    } as unknown as TripImportPayloadInput;

    await expect(
      importTripFromExportForUser({
        userId: user.id,
        payload: invalidPayload,
        strategy: "createNew",
        photoBytes: v2PhotoBytes(),
      })
    ).rejects.toBeDefined();

    expect(await prisma.trip.count()).toBe(0);
    expect(await prisma.tripDay.count()).toBe(0);
    expect(await prisma.accommodation.count()).toBe(0);
    expect(await prisma.dayPlanItem.count()).toBe(0);
    expect(await prisma.travelSegment.count()).toBe(0);
    expect(await prisma.tripBucketListItem.count()).toBe(0);
    expect(await prisma.accommodationImage.count()).toBe(0);
    expect(await prisma.dayPlanItemImage.count()).toBe(0);
    // AC3 covers the disk too: photos are written only after the commit, so a failed transaction
    // must leave the uploads root untouched.
    expect(await fs.readdir(uploadsRoot).catch(() => [])).toEqual([]);
  });

  it("restores photos, galleries, travel segments and bucket list items from a v2 backup", async () => {
    const user = await prisma.user.create({
      data: { email: "trip-import-v2@example.com", passwordHash: "hashed", role: "OWNER" },
    });

    const result = await importTripFromExportForUser({
      userId: user.id,
      payload: V2_IMPORT_PAYLOAD,
      strategy: "createNew",
      photoBytes: v2PhotoBytes(),
    });

    expect(result.outcome).toBe("imported");
    if (result.outcome !== "imported") return;
    expect(result.dayCount).toBe(2);
    expect(result.travelSegmentCount).toBe(1);
    expect(result.bucketListItemCount).toBe(2);
    // Hero + day image + one accommodation slot + two plan-item slots.
    expect(result.photoCount).toBe(5);

    const tripId = result.trip.id;
    const day = await prisma.tripDay.findFirstOrThrow({ where: { tripId, dayIndex: 1 } });
    const accommodation = await prisma.accommodation.findFirstOrThrow({ where: { tripDayId: day.id } });
    const planItem = await prisma.dayPlanItem.findFirstOrThrow({ where: { tripDayId: day.id } });

    // --- travel segment id remapping -----------------------------------------------------------
    const segment = await prisma.travelSegment.findFirstOrThrow({ where: { tripDayId: day.id } });
    expect(segment.fromItemId).toBe(accommodation.id);
    expect(segment.toItemId).toBe(planItem.id);
    expect(segment.fromItemId).not.toBe("source-stay-1");
    expect(segment.toItemId).not.toBe("source-plan-1");
    expect(segment.fromItemType).toBe("ACCOMMODATION");
    expect(segment.toItemType).toBe("DAY_PLAN_ITEM");
    expect(segment.transportType).toBe("SHIP");
    expect(segment.durationMinutes).toBe(45);
    expect(segment.linkUrl).toBe("https://example.com/ferry");

    // --- bucket list ---------------------------------------------------------------------------
    const bucketItems = await prisma.tripBucketListItem.findMany({
      where: { tripId },
      orderBy: { title: "asc" },
    });
    expect(bucketItems.map((item) => item.title)).toEqual(["Fjord cruise", "Northern lights"]);
    // `cleanOptionalString` semantics: trimmed, and a blank string becomes null.
    expect(bucketItems[1].description).toBe("Away from town");
    expect(bucketItems[1].positionText).toBeNull();
    expect(bucketItems[1].locationLabel).toBe("Tromso");

    // --- image rows carry the new ids ----------------------------------------------------------
    const stayImages = await prisma.accommodationImage.findMany({
      where: { accommodationId: accommodation.id },
      orderBy: { sortOrder: "asc" },
    });
    const planImages = await prisma.dayPlanItemImage.findMany({
      where: { dayPlanItemId: planItem.id },
      orderBy: { sortOrder: "asc" },
    });
    expect(stayImages.map((image) => image.sortOrder)).toEqual([0]);
    expect(planImages.map((image) => image.sortOrder)).toEqual([0, 1]);
    expect(stayImages[0].imageUrl).toMatch(
      new RegExp(`^/uploads/trips/${tripId}/days/${day.id}/accommodations/${accommodation.id}/img-`),
    );
    expect(planImages[0].imageUrl).toMatch(
      new RegExp(`^/uploads/trips/${tripId}/days/${day.id}/day-plan-items/${planItem.id}/img-`),
    );
    // A pool entry referenced twice is written once per slot, never shared between rows.
    expect(planImages[1].imageUrl).not.toBe(stayImages[0].imageUrl);

    // --- hero / day image precedence -----------------------------------------------------------
    const trip = await prisma.trip.findFirstOrThrow({ where: { id: tripId } });
    expect(trip.heroImageUrl).toBe(`/uploads/trips/${tripId}/hero.jpg`);
    expect(day.imageUrl).toBe(`/uploads/trips/${tripId}/days/${day.id}/day.png`);
    expect(trip.heroImageUrl).not.toContain("source-trip");

    // --- files really landed, under the *new* trip's directory ---------------------------------
    expect(await fs.readFile(path.join(getTripUploadDir(tripId), "hero.jpg"))).toEqual(jpegBytes());
    expect(await fs.readFile(path.join(getTripDayUploadDir(tripId, day.id), "day.png"))).toEqual(pngBytes());
    const stayDir = getAccommodationImageUploadDir(tripId, day.id, accommodation.id);
    const planDir = getDayPlanItemImageUploadDir(tripId, day.id, planItem.id);
    expect(await fs.readdir(stayDir)).toHaveLength(1);
    expect(await fs.readdir(planDir)).toHaveLength(2);
    expect(await fs.readFile(path.join(stayDir, path.basename(stayImages[0].imageUrl)))).toEqual(webpBytes());
  });

  it("keeps the v1 image strings when a backup carries no pooled photos", async () => {
    const user = await prisma.user.create({
      data: { email: "trip-import-v1-urls@example.com", passwordHash: "hashed", role: "OWNER" },
    });

    const result = await importTripFromExportForUser({
      userId: user.id,
      payload: IMPORT_PAYLOAD,
      strategy: "createNew",
    });

    expect(result.outcome).toBe("imported");
    if (result.outcome !== "imported") return;
    expect(result.photoCount).toBe(0);
    expect(result.travelSegmentCount).toBe(0);
    expect(result.bucketListItemCount).toBe(0);

    const day = await prisma.tripDay.findFirstOrThrow({ where: { tripId: result.trip.id, dayIndex: 2 } });
    expect(day.imageUrl).toBe("/uploads/trips/export-trip/days/export-day-2/day.webp");
  });

  it("replaces bucket list items and leaves no orphaned segment or image rows on overwrite", async () => {
    const user = await prisma.user.create({
      data: { email: "trip-import-overwrite-v2@example.com", passwordHash: "hashed", role: "OWNER" },
    });

    const target = await createTripWithDays({
      userId: user.id,
      name: V2_IMPORT_PAYLOAD.trip.name,
      startDate: "2026-10-10T00:00:00.000Z",
      endDate: "2026-10-11T00:00:00.000Z",
    });
    const targetDay = await prisma.tripDay.findFirstOrThrow({
      where: { tripId: target.trip.id, dayIndex: 1 },
    });
    const oldAccommodation = await prisma.accommodation.create({
      data: { tripDayId: targetDay.id, name: "Old Accommodation" },
    });
    const oldPlanItem = await prisma.dayPlanItem.create({
      data: { tripDayId: targetDay.id, contentJson: "{\"type\":\"doc\"}" },
    });
    await prisma.accommodationImage.create({
      data: {
        accommodationId: oldAccommodation.id,
        imageUrl: `/uploads/trips/${target.trip.id}/days/${targetDay.id}/accommodations/${oldAccommodation.id}/old.jpg`,
        sortOrder: 0,
      },
    });
    await prisma.travelSegment.create({
      data: {
        tripDayId: targetDay.id,
        fromItemType: "ACCOMMODATION",
        fromItemId: oldAccommodation.id,
        toItemType: "DAY_PLAN_ITEM",
        toItemId: oldPlanItem.id,
        transportType: "CAR",
        durationMinutes: 15,
      },
    });
    await prisma.tripBucketListItem.create({
      data: { tripId: target.trip.id, title: "Stale bucket entry" },
    });
    // A file the previous import left behind: AC5 says the overwrite must clear the disk too.
    await writeUploadFile(getTripUploadDir(target.trip.id), "stale.jpg", jpegBytes());

    const result = await importTripFromExportForUser({
      userId: user.id,
      payload: V2_IMPORT_PAYLOAD,
      strategy: "overwrite",
      targetTripId: target.trip.id,
      photoBytes: v2PhotoBytes(),
    });

    expect(result.outcome).toBe("imported");
    if (result.outcome !== "imported") return;
    expect(result.mode).toBe("overwrite");
    expect(result.trip.id).toBe(target.trip.id);

    const bucketItems = await prisma.tripBucketListItem.findMany({ where: { tripId: target.trip.id } });
    expect(bucketItems.map((item) => item.title).sort()).toEqual(["Fjord cruise", "Northern lights"]);

    // `tripDay.deleteMany` cascades days -> accommodations / plan items / segments / images, so the
    // only rows left must belong to the freshly imported day.
    const segments = await prisma.travelSegment.findMany();
    expect(segments).toHaveLength(1);
    expect(segments[0].transportType).toBe("SHIP");
    const stayImages = await prisma.accommodationImage.findMany();
    expect(stayImages).toHaveLength(1);
    expect(stayImages[0].imageUrl).not.toContain(oldAccommodation.id);

    expect(await fs.readdir(getTripUploadDir(target.trip.id))).not.toContain("stale.jpg");
    expect(await fs.readFile(path.join(getTripUploadDir(target.trip.id), "hero.jpg"))).toEqual(jpegBytes());
    // The rename-aside directory must not survive as a sibling of the trip's own.
    expect((await fs.readdir(uploadsRoot)).filter((entry) => entry.includes(".import-"))).toEqual([]);
  });

  it("clears v1 image urls that name files the overwrite just deleted", async () => {
    const user = await prisma.user.create({
      data: { email: "trip-import-overwrite-v1-urls@example.com", passwordHash: "hashed", role: "OWNER" },
    });

    const target = await createTripWithDays({
      userId: user.id,
      name: IMPORT_PAYLOAD.trip.name,
      startDate: "2026-10-10T00:00:00.000Z",
      endDate: "2026-10-11T00:00:00.000Z",
    });
    await writeUploadFile(getTripUploadDir(target.trip.id), "hero.jpg", jpegBytes());

    // A v1 backup of this very trip: no photo pool, only verbatim `/uploads/…` strings that name
    // files inside the directory the overwrite is about to delete.
    const selfReferentialV1: TripImportPayloadInput = {
      ...IMPORT_PAYLOAD,
      trip: { ...IMPORT_PAYLOAD.trip, heroImageUrl: `/uploads/trips/${target.trip.id}/hero.jpg` },
      days: [
        {
          ...IMPORT_PAYLOAD.days[0],
          imageUrl: `/uploads/trips/${target.trip.id}/days/old-day/day.webp`,
        },
        IMPORT_PAYLOAD.days[1],
      ],
    };

    const result = await importTripFromExportForUser({
      userId: user.id,
      payload: selfReferentialV1,
      strategy: "overwrite",
      targetTripId: target.trip.id,
    });

    expect(result.outcome).toBe("imported");
    if (result.outcome !== "imported") return;

    // AC5 wants no orphaned rows, and those files are genuinely gone - a null renders as "no
    // image" instead of as a broken one.
    const trip = await prisma.trip.findFirstOrThrow({ where: { id: target.trip.id } });
    expect(trip.heroImageUrl).toBeNull();
    const day = await prisma.tripDay.findFirstOrThrow({ where: { tripId: target.trip.id, dayIndex: 2 } });
    expect(day.imageUrl).toBeNull();
    expect(await fs.readdir(getTripUploadDir(target.trip.id)).catch(() => [])).not.toContain("hero.jpg");
  });

  it("keeps a v1 url pointing at another trip's directory, which an overwrite does not touch", async () => {
    const user = await prisma.user.create({
      data: { email: "trip-import-overwrite-foreign-urls@example.com", passwordHash: "hashed", role: "OWNER" },
    });

    const target = await createTripWithDays({
      userId: user.id,
      name: IMPORT_PAYLOAD.trip.name,
      startDate: "2026-10-10T00:00:00.000Z",
      endDate: "2026-10-11T00:00:00.000Z",
    });

    const result = await importTripFromExportForUser({
      userId: user.id,
      // `IMPORT_PAYLOAD`'s day image names `export-trip`, not the target - nothing deletes it here.
      payload: IMPORT_PAYLOAD,
      strategy: "overwrite",
      targetTripId: target.trip.id,
    });

    expect(result.outcome).toBe("imported");
    const day = await prisma.tripDay.findFirstOrThrow({ where: { tripId: target.trip.id, dayIndex: 2 } });
    expect(day.imageUrl).toBe("/uploads/trips/export-trip/days/export-day-2/day.webp");
  });

  it("names a restored file for what its bytes are, not for what the manifest declared", async () => {
    const user = await prisma.user.create({
      data: { email: "trip-import-sniffed-extension@example.com", passwordHash: "hashed", role: "OWNER" },
    });

    // Exactly what `hero-image/route.ts` produces from a PNG uploaded as `image/jpeg`: it names the
    // stored file from the client-supplied `file.type` without sniffing, and the export repeats the
    // claim. Writing `hero.jpg` here would serve PNG bytes under a jpg extension.
    const mislabelled: TripImportPayloadInput = {
      ...V2_IMPORT_PAYLOAD,
      photos: { p1: { contentType: "image/jpeg", archivePath: "photos/p1.jpg" } },
      trip: { ...V2_IMPORT_PAYLOAD.trip, heroPhotoId: "p1", bucketListItems: [] },
      days: [
        {
          ...V2_IMPORT_PAYLOAD.days[0],
          imagePhotoId: null,
          accommodation: null,
          dayPlanItems: [],
          travelSegments: [],
        },
        V2_IMPORT_PAYLOAD.days[1],
      ],
    };

    const result = await importTripFromExportForUser({
      userId: user.id,
      payload: mislabelled,
      strategy: "createNew",
      photoBytes: new Map([["photos/p1.jpg", pngBytes()]]),
    });

    expect(result.outcome).toBe("imported");
    if (result.outcome !== "imported") return;
    expect(result.trip.heroImageUrl).toBe(`/uploads/trips/${result.trip.id}/hero.png`);
    expect(await fs.readFile(path.join(getTripUploadDir(result.trip.id), "hero.png"))).toEqual(pngBytes());
  });

  it("refuses to write anything when a referenced photo's bytes are missing", async () => {
    const user = await prisma.user.create({
      data: { email: "trip-import-missing-bytes@example.com", passwordHash: "hashed", role: "OWNER" },
    });

    const bytes = v2PhotoBytes();
    bytes.delete("photos/p3.webp");

    await expect(
      importTripFromExportForUser({
        userId: user.id,
        payload: V2_IMPORT_PAYLOAD,
        strategy: "createNew",
        photoBytes: bytes,
      })
    ).rejects.toThrow("photo_bytes_missing");

    expect(await prisma.trip.count()).toBe(0);
    expect(await fs.readdir(uploadsRoot).catch(() => [])).toEqual([]);
  });
});
