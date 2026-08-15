import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db/prisma";
import {
  getAccommodationImageUploadDir,
  getDayPlanItemImageUploadDir,
  getMediaRoot,
  getTripDayUploadDir,
  getTripUploadDir,
  getTripsUploadRoot,
} from "@/lib/trips/uploadPaths";
import { acquireTripImportLock, releaseTripImportLock } from "@/lib/trips/importPhotos";
import {
  buildTripAggregateQuery,
  createTripWithDays,
  deleteTripForUser,
  getTripDayPrintPayloadForUser,
  getTripExportForUser,
  getTripWithDaysForUser,
  importTripFromExportForUser,
  listTripsForUser,
  TRIPS_LIST_LIMIT,
  updateTripDayImageForUser,
  updateTripWithDays,
  type ImportTripResult,
} from "@/lib/repositories/tripRepo";
import type { TripImportPayloadInput } from "@/lib/validation/tripImportSchemas";
import { jpegBytes, pngBytes, webpBytes, writeUploadFile } from "./helpers/uploadFixtures";

/**
 * Narrows an import result to its `"imported"` arm so the success-only fields can be read.
 *
 * Be accurate about what this buys, because the obvious argument for it is wrong here. The
 * `if (result.outcome !== "imported") return;` form used at the five sites further down *would* skip
 * every assertion after it and pass - but at all five, and at the two converted to this helper, the
 * line immediately above is `expect(result.outcome).toBe("imported")`, which fails first. No site in
 * this file is currently vacuous, so the five were left alone rather than swept on a premise that does
 * not apply to them.
 *
 * What the helper does buy is that the narrowing no longer *depends* on that neighbouring `expect`.
 * The early-return form is only non-vacuous for as long as somebody keeps the two lines together;
 * delete or reword the `expect` - or paste the guard into a new case without it - and the test silently
 * asserts nothing. Throwing carries its own failure, so it is correct in isolation, and it names the
 * outcome actually received instead of reporting a skipped test as a pass.
 */
const expectImportedResult = (result: ImportTripResult): Extract<ImportTripResult, { outcome: "imported" }> => {
  if (result.outcome !== "imported") {
    throw new Error(`Expected an "imported" import outcome, received "${result.outcome}".`);
  }

  return result;
};

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
          // Story 9.2: this day carries no documents, so the field has to be present and empty rather than
          // absent. The print sheet and the packet both read it unconditionally.
          documents: [],
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
          documents: [],
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

  /**
   * Story 9.2. The print payload carries documents on both stay kinds and on plan items, ordered by
   * `sortOrder` the way the image galleries are.
   *
   * Rows are created out of `sortOrder` order on purpose: inserted ascending, an `orderBy` that was dropped
   * entirely would still produce the expected list, because SQLite would hand back insertion order. The
   * only way this assertion can fail is if the ordering rule is actually gone.
   */
  it("carries documents on both stay kinds and on plan items, ordered by sortOrder", async () => {
    const owner = await prisma.user.create({
      data: { email: "trip-print-documents@example.com", passwordHash: "hashed", role: "OWNER" },
    });

    const { trip } = await createTripWithDays({
      userId: owner.id,
      name: "Documented Trip",
      startDate: "2026-11-01T00:00:00.000Z",
      endDate: "2026-11-02T00:00:00.000Z",
    });
    const [day1, day2] = await prisma.tripDay.findMany({
      where: { tripId: trip.id },
      orderBy: { dayIndex: "asc" },
    });

    const previousStay = await prisma.accommodation.create({
      data: { tripDayId: day1.id, name: "Airport Hotel", status: "BOOKED" },
    });
    const currentStay = await prisma.accommodation.create({
      data: { tripDayId: day2.id, name: "City Hotel", status: "PLANNED" },
    });
    const activity = await prisma.dayPlanItem.create({
      data: {
        tripDayId: day2.id,
        title: "Museum visit",
        fromTime: "10:00",
        contentJson: '{"type":"doc","content":[]}',
      },
    });
    const withoutDocuments = await prisma.dayPlanItem.create({
      data: {
        tripDayId: day2.id,
        title: "Evening walk",
        fromTime: "18:00",
        contentJson: '{"type":"doc","content":[]}',
      },
    });

    await prisma.accommodationDocument.createMany({
      data: [
        {
          accommodationId: previousStay.id,
          documentUrl: "/uploads/trips/documented/prev-booking.pdf",
          fileName: "Booking.pdf",
          sortOrder: 0,
        },
        {
          accommodationId: currentStay.id,
          documentUrl: "/uploads/trips/documented/current-second.pdf",
          fileName: "Second.pdf",
          sortOrder: 1,
        },
        {
          accommodationId: currentStay.id,
          documentUrl: "/uploads/trips/documented/current-first.jpg",
          fileName: "First.jpg",
          sortOrder: 0,
        },
      ],
    });
    await prisma.dayPlanItemDocument.createMany({
      data: [
        {
          dayPlanItemId: activity.id,
          documentUrl: "/uploads/trips/documented/item-second.pdf",
          fileName: "Audio guide.pdf",
          sortOrder: 1,
        },
        {
          dayPlanItemId: activity.id,
          documentUrl: "/uploads/trips/documented/item-first.jpg",
          fileName: "Entry ticket.jpg",
          sortOrder: 0,
        },
      ],
    });

    const printable = await getTripDayPrintPayloadForUser({ userId: owner.id, tripId: trip.id, dayId: day2.id });

    expect(printable).not.toBeNull();
    const timeline = printable!.timeline;

    const previous = timeline.find((entry) => entry.kind === "previousStay");
    expect(previous?.kind === "previousStay" && previous.stay.documents).toEqual([
      {
        id: expect.any(String),
        documentUrl: "/uploads/trips/documented/prev-booking.pdf",
        fileName: "Booking.pdf",
        sortOrder: 0,
      },
    ]);

    const current = timeline.find((entry) => entry.kind === "currentStay");
    expect(current?.kind === "currentStay" && current.stay.documents.map((document) => document.fileName)).toEqual([
      "First.jpg",
      "Second.pdf",
    ]);

    const planItems = timeline.filter((entry) => entry.kind === "planItem");
    expect(planItems).toHaveLength(2);
    expect(planItems[0].kind === "planItem" && planItems[0].item.id).toBe(activity.id);
    expect(planItems[0].kind === "planItem" && planItems[0].item.documents.map((d) => d.fileName)).toEqual([
      "Entry ticket.jpg",
      "Audio guide.pdf",
    ]);
    // The empty-array default, on an entry that exists alongside ones that have documents.
    expect(planItems[1].kind === "planItem" && planItems[1].item.id).toBe(withoutDocuments.id);
    expect(planItems[1].kind === "planItem" && planItems[1].item.documents).toEqual([]);
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

  /**
   * Story 5.13 widened `getTripExportForUser`'s root `where` to the writer clause, and every `include`
   * hangs off that one root - so the single line decides who may download the whole archive.
   *
   * Route-level tests cannot pin the `role: "CONTRIBUTOR"` half of it: `refuseUnlessTripWriter` answers a
   * viewer 403 on the export route before the repository is reached, so the query is never observed with
   * a viewer's id there. Dropping the role and leaving the participant read clause would hand every
   * viewer a full ZIP of the trip and no other test would notice.
   */
  it("exports a trip for a contributor and refuses a viewer", async () => {
    const owner = await prisma.user.create({
      data: { email: "trip-export-scope-owner@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    // Account roles deliberately unlike the membership roles below: the export scope must read the
    // `TripMember` row, never `User.role`.
    const contributor = await prisma.user.create({
      data: { email: "trip-export-scope-contributor@example.com", passwordHash: "hashed", role: "VIEWER" },
    });
    const viewer = await prisma.user.create({
      data: { email: "trip-export-scope-viewer@example.com", passwordHash: "hashed", role: "OWNER" },
    });

    const trip = await prisma.trip.create({
      data: {
        userId: owner.id,
        name: "Export Scope Trip",
        startDate: new Date("2026-12-01T00:00:00.000Z"),
        endDate: new Date("2026-12-01T00:00:00.000Z"),
      },
    });
    await prisma.tripDay.create({
      data: { tripId: trip.id, date: new Date("2026-12-01T00:00:00.000Z"), dayIndex: 1 },
    });
    await prisma.tripMember.create({
      data: { tripId: trip.id, userId: contributor.id, role: "CONTRIBUTOR" },
    });
    await prisma.tripMember.create({
      data: { tripId: trip.id, userId: viewer.id, role: "VIEWER" },
    });

    const contributorExport = await getTripExportForUser(contributor.id, trip.id);
    expect(contributorExport).not.toBeNull();
    expect(contributorExport?.payload.trip.name).toBe("Export Scope Trip");
    expect(contributorExport?.payload.days).toHaveLength(1);

    expect(await getTripExportForUser(viewer.id, trip.id)).toBeNull();
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

  /**
   * The membership half of the same guard. The case above only proves a stranger is refused, which the
   * pre-5.13 `trip: { userId }` scope also did; this one is the only assertion that separates the widened
   * writer clause from the participant read clause, because the day-image route refuses a viewer with 403
   * before `updateTripDayImageForUser` is called and no route test can reach the query with her id.
   */
  it("updates a day image for a contributor and refuses a viewer", async () => {
    const owner = await prisma.user.create({
      data: { email: "trip-day-image-scope-owner@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const contributor = await prisma.user.create({
      data: { email: "trip-day-image-scope-contributor@example.com", passwordHash: "hashed", role: "VIEWER" },
    });
    const viewer = await prisma.user.create({
      data: { email: "trip-day-image-scope-viewer@example.com", passwordHash: "hashed", role: "OWNER" },
    });

    const { trip } = await createTripWithDays({
      userId: owner.id,
      name: "Day Image Scope Trip",
      startDate: "2026-07-01T00:00:00.000Z",
      endDate: "2026-07-01T00:00:00.000Z",
    });
    await prisma.tripMember.create({
      data: { tripId: trip.id, userId: contributor.id, role: "CONTRIBUTOR" },
    });
    await prisma.tripMember.create({
      data: { tripId: trip.id, userId: viewer.id, role: "VIEWER" },
    });

    const day = await prisma.tripDay.findFirstOrThrow({ where: { tripId: trip.id } });

    const byContributor = await updateTripDayImageForUser({
      userId: contributor.id,
      tripId: trip.id,
      dayId: day.id,
      imageUrl: "/uploads/trips/day/contributor.webp",
      note: "Contributor note",
    });
    expect(byContributor).not.toBeNull();
    expect(byContributor?.imageUrl).toBe("/uploads/trips/day/contributor.webp");
    expect(byContributor?.note).toBe("Contributor note");

    const byViewer = await updateTripDayImageForUser({
      userId: viewer.id,
      tripId: trip.id,
      dayId: day.id,
      imageUrl: "/uploads/trips/day/viewer.webp",
      note: "Viewer note",
    });
    expect(byViewer).toBeNull();

    // The write is a raw `$executeRawUnsafe` after the scope check, so assert the row itself rather than
    // trusting the null return: a refusal that still wrote would be invisible above.
    const stored = await prisma.tripDay.findUniqueOrThrow({ where: { id: day.id } });
    expect(stored.imageUrl).toBe("/uploads/trips/day/contributor.webp");
    expect(stored.note).toBe("Contributor note");
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
    const imported = expectImportedResult(result);
    expect(imported.mode).toBe("createNew");
    expect(imported.dayCount).toBe(2);

    const detail = await getTripWithDaysForUser(user.id, imported.trip.id);
    expect(detail).not.toBeNull();
    expect(detail?.days.map((day) => `${day.dayIndex}-${day.date.toISOString()}`)).toEqual([
      "1-2026-11-01T00:00:00.000Z",
      "2-2026-11-02T00:00:00.000Z",
    ]);
    // `null`, not the payload's `/uploads/trips/export-trip/…` string (Story 8.4 / DW-88). The created
    // trip has a fresh cuid, so that URL resolves into a directory this trip does not own - the row would
    // point at another trip's file, which 404s for most viewers and vanishes when that trip is deleted.
    expect(detail?.days[1].imageUrl).toBeNull();
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
    const imported = expectImportedResult(result);
    expect(imported.mode).toBe("overwrite");
    expect(imported.trip.id).toBe(target.trip.id);

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

  /**
   * Story 8.4 / DW-88 narrowed this. It used to assert the v1 string came back verbatim on create-new;
   * Story 2.32's verbatim rule is now read as "verbatim for URLs that still resolve to this trip", which
   * on this path means URLs naming the trip being created. `IMPORT_PAYLOAD`'s `export-trip` is foreign by
   * construction - a create-new import mints a fresh cuid - so it is nulled and counted. The *overwrite*
   * counterpart below still pins the verbatim string, and so does everything else that pinned it: the
   * export-side tests, the external `https://` hero, the schema parse.
   */
  it("nulls a create-new v1 image string that names another trip's upload directory", async () => {
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
    // The count and the warning are the whole of AC6's "names how many images were dropped" - without them
    // this is a silent loss and the user just finds a trip with fewer pictures than they backed up.
    expect(result.droppedImageCount).toBe(1);
    expect(result.warnings[0]).toContain("1 image");

    const day = await prisma.tripDay.findFirstOrThrow({ where: { tripId: result.trip.id, dayIndex: 2 } });
    expect(day.imageUrl).toBeNull();
  });

  it("keeps a create-new url that names the trip being created, and never counts an external one", async () => {
    // AC7's other half. A create-new id is minted inside the transaction, so a payload cannot state one in
    // advance - the reachable form of an own-trip URL is the one the import writes itself when a pooled
    // photo replaces the v1 string, and that URL must survive the rule rather than be nulled by it. The
    // external `https://` hero is the case the rule must never match at all: it names no upload directory,
    // so there is nothing foreign about it.
    const user = await prisma.user.create({
      data: { email: "trip-import-own-urls@example.com", passwordHash: "hashed", role: "OWNER" },
    });

    const result = await importTripFromExportForUser({
      userId: user.id,
      payload: {
        ...V2_IMPORT_PAYLOAD,
        trip: { ...V2_IMPORT_PAYLOAD.trip, heroPhotoId: null, heroImageUrl: "https://cdn.example.com/hero.jpg" },
      },
      strategy: "createNew",
      photoBytes: v2PhotoBytes(),
    });

    expect(result.outcome).toBe("imported");
    if (result.outcome !== "imported") return;
    expect(result.droppedImageCount).toBe(0);
    expect(result.warnings).toEqual([]);
    expect(result.trip.heroImageUrl).toBe("https://cdn.example.com/hero.jpg");

    // Day 1 carried both a foreign v1 string and a pooled photo. The photo wins, the written URL names the
    // created trip, and nothing is reported as dropped - the user lost no image.
    const day = await prisma.tripDay.findFirstOrThrow({ where: { tripId: result.trip.id, dayIndex: 1 } });
    expect(day.imageUrl).toBe(`/uploads/trips/${result.trip.id}/days/${day.id}/day.png`);
  });

  /**
   * Story 8.4 / AC8. Spellings that a `startsWith("/uploads/trips/<own>/")` test reads as not-foreign,
   * and which `resolveStoredMediaPath` + `path.join` normalise onto a file the created trip does not own
   * - verified by execution during review. The rule is therefore decided on the resolved path, and these
   * cases are what pin that rather than the string form.
   *
   * The hero rather than a day image, because the hero is the one field of the three whose value reaches
   * the rule straight from the payload with no pooled-photo precedence in front of it.
   *
   * **The `/uploads/trips/<own>/../<other>/x` class is deliberately absent, because it is unreachable on
   * this path.** A create-new trip's id is minted inside the transaction, so no payload can spell it in
   * advance; a literal placeholder in its place would just be another foreign id, i.e. a case the naive
   * string rule would also have caught, dressed up as an evasion. Iteration 2's version of this test did
   * exactly that and passed against the very rule it claimed to exclude. The class is real on the
   * *overwrite* path, where the target id is known - and that is `dropReplacedUploadUrl`, which now
   * decides on the resolved path for this reason.
   *
   * The escape row is the fail-closed case: a `/uploads/…` URL that escapes the trips root entirely. It is
   * *further* from "a file this trip owns" than a foreign-trip URL is, so it must be nulled too. Asking
   * instead whether the resolved path was inside `getTripsUploadRoot()` and keeping it when it was not
   * imported `/uploads/trips/../../../../etc/passwd` verbatim with `droppedImageCount: 0` - confirmed by
   * execution.
   *
   * **The last four rows are this table's history of shape tests, and each one killed the rule before it.**
   * A normalised-prefix test collapses leading slashes but adds none, so a URL with no leading slash at
   * all, one with a `.` segment in front, and one spelling `uploads` with a capital all read as naming no
   * file here. The rule that replaced it - "the first remaining segment is `uploads`" - survives those
   * three and dies on the last row: a `..` *pops the segment in front of it*, so the first segment of the
   * string (`x`) is not the first segment of the path, while `resolveStoredMediaPath` maps the value onto
   * byte-for-byte the same foreign file (all confirmed by execution). There is no shape test in front of
   * the rule any more - only `isExternalMediaUrl`, and none of these has a scheme - so every row reaches
   * the resolved-path containment check, which fails closed. `heroImageUrl` is
   * `z.union([z.string().trim(), z.null()])` with no format validation at all (`tripImportSchemas.ts`), so
   * a backup can carry any of them.
   */
  it.each([
    ["a doubled leading slash", "//uploads/trips/other-trip/hero.jpg"],
    ["a doubled inner slash", "/uploads//trips/other-trip/hero.jpg"],
    ["a path that escapes the trips root entirely", "/uploads/trips/../../../../etc/passwd"],
    ["no leading slash at all", "uploads/trips/other-trip/hero.jpg"],
    ["a single-dot segment in front", "/./uploads/trips/other-trip/hero.jpg"],
    ["a capitalised uploads segment", "/Uploads/trips/other-trip/hero.jpg"],
    ["a segment popped by a following `..`", "/x/../uploads/trips/other-trip/hero.jpg"],
  ])("nulls a create-new hero url that reaches a foreign file through %s", async (label, heroImageUrl) => {
    const user = await prisma.user.create({
      data: {
        email: `trip-import-evasion-${label.replace(/[^a-z]+/gi, "-")}@example.com`,
        passwordHash: "hashed",
        role: "OWNER",
      },
    });

    const result = await importTripFromExportForUser({
      userId: user.id,
      payload: {
        ...IMPORT_PAYLOAD,
        trip: { ...IMPORT_PAYLOAD.trip, heroPhotoId: null, heroImageUrl },
      },
      strategy: "createNew",
    });

    expect(result.outcome).toBe("imported");
    if (result.outcome !== "imported") return;
    expect(result.trip.heroImageUrl).toBeNull();
    const stored = await prisma.trip.findUniqueOrThrow({ where: { id: result.trip.id } });
    expect(stored.heroImageUrl).toBeNull();
    // The day image is foreign too, so the count is hero plus day - what matters is that the hero was
    // caught at all, which a raw string test would not have done for any of these spellings.
    expect(result.droppedImageCount).toBe(2);
  });

  /**
   * The opposite direction, and it is what stops the gate above being widened into a deletion of its own.
   *
   * The rule now nulls **everything path-shaped** that does not resolve inside the created trip's own
   * directory, and the only thing standing between an external cover image and that treatment is
   * `isExternalMediaUrl`. Remove it and every one of these heroes is nulled and counted, because
   * `resolveStoredMediaPath("https://cdn.example.com/hero.jpg")` resolves under the media root and lands
   * nowhere near the created trip - a silent data loss for a URL the import never had any business
   * judging. The count is `1` rather than `0` here because `IMPORT_PAYLOAD`'s day image is foreign by
   * construction: what these rows pin is that the hero is not among the drops. `droppedImageCount: 0` for a
   * payload with no foreign URL at all is pinned by the V2 case above.
   */
  it.each([
    ["an https url", "https://cdn.example.com/hero.jpg"],
    ["an http url", "http://cdn.example.com/hero.jpg"],
    ["a data url", "data:image/png;base64,iVBORw0KGgo="],
  ])("restores a create-new hero spelled as %s verbatim and never counts it", async (label, heroImageUrl) => {
    const user = await prisma.user.create({
      data: {
        email: `trip-import-external-${label.replace(/[^a-z]+/gi, "-")}@example.com`,
        passwordHash: "hashed",
        role: "OWNER",
      },
    });

    const result = await importTripFromExportForUser({
      userId: user.id,
      payload: {
        ...IMPORT_PAYLOAD,
        trip: { ...IMPORT_PAYLOAD.trip, heroPhotoId: null, heroImageUrl },
      },
      strategy: "createNew",
    });

    expect(result.outcome).toBe("imported");
    if (result.outcome !== "imported") return;
    expect(result.trip.heroImageUrl).toBe(heroImageUrl);
    const stored = await prisma.trip.findUniqueOrThrow({ where: { id: result.trip.id } });
    expect(stored.heroImageUrl).toBe(heroImageUrl);
    // The day image alone. The hero is not ours to judge and is not among the drops.
    expect(result.droppedImageCount).toBe(1);
  });

  it("refuses a second overwrite import of a trip while the first still holds the lock", async () => {
    // Story 8.4 / DW-86 at the repository boundary: the refusal has to happen before the transaction, so
    // the loser has written no row and no file when it is turned away.
    const user = await prisma.user.create({
      data: { email: "trip-import-concurrent@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const target = await createTripWithDays({
      userId: user.id,
      name: IMPORT_PAYLOAD.trip.name,
      startDate: "2026-11-01T00:00:00.000Z",
      endDate: "2026-11-02T00:00:00.000Z",
    });

    const lock = await acquireTripImportLock(target.trip.id);
    try {
      await expect(
        importTripFromExportForUser({
          userId: user.id,
          payload: IMPORT_PAYLOAD,
          strategy: "overwrite",
          targetTripId: target.trip.id,
        }),
      ).rejects.toThrow("import_in_progress");
    } finally {
      await releaseTripImportLock(lock);
    }

    // The refusal is not a one-way door: once the holder releases, the same import succeeds. Running it
    // twice is also what proves the wrapper's `finally` released the lock it took on the first, successful
    // run - without that, the second call would be refused.
    const after = await importTripFromExportForUser({
      userId: user.id,
      payload: IMPORT_PAYLOAD,
      strategy: "overwrite",
      targetTripId: target.trip.id,
    });
    expect(after.outcome).toBe("imported");

    const again = await importTripFromExportForUser({
      userId: user.id,
      payload: IMPORT_PAYLOAD,
      strategy: "overwrite",
      targetTripId: target.trip.id,
    });
    expect(again.outcome).toBe("imported");
  });

  it("releases the lock after an import that throws, not only after one that succeeds", async () => {
    // The `finally` is the whole of AC5's "released on every exit path including failure". Without it a
    // failed import locks the trip for `IMPORT_LOCK_STALE_MS` - fifteen minutes in which the user's obvious
    // next move, retrying, is refused with a message about an import that is not running.
    const user = await prisma.user.create({
      data: { email: "trip-import-lock-release-on-throw@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const target = await createTripWithDays({
      userId: user.id,
      name: V2_IMPORT_PAYLOAD.trip.name,
      startDate: "2026-12-01T00:00:00.000Z",
      endDate: "2026-12-02T00:00:00.000Z",
    });

    // A manifest declaring pooled photos with no bytes behind them: it fails inside `runTripImport`, after
    // the lock has been taken.
    await expect(
      importTripFromExportForUser({
        userId: user.id,
        payload: V2_IMPORT_PAYLOAD,
        strategy: "overwrite",
        targetTripId: target.trip.id,
      }),
    ).rejects.toThrow();

    expect(await fs.stat(`${getTripUploadDir(target.trip.id)}.import-lock`).catch(() => null)).toBeNull();
    // And the proof that matters: the next acquire succeeds rather than being told a race was lost.
    const lock = await acquireTripImportLock(target.trip.id);
    await releaseTripImportLock(lock);
  });

  it("takes no lock for an overwrite whose target the caller does not own", async () => {
    // Story 8.4 / AC8. The first implementation locked on the raw `targetTripId` request field, which is
    // validated only as a non-empty string and is interpolated into a filesystem path - so a hostile value
    // got `mkdir` and then `rm -rf` on a directory *outside* the media root, for any authenticated caller
    // with a parseable backup and no trip ownership at all. The key is now resolved through
    // `findFirst({ where: { id, userId } })`, so a miss - a stranger's trip or a traversal string - takes no
    // lock and creates nothing, and `409 import_in_progress` stops being a discriminator for "an import of
    // a trip you cannot see is running".
    const owner = await prisma.user.create({
      data: { email: "trip-import-lock-owner@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const stranger = await prisma.user.create({
      data: { email: "trip-import-lock-stranger@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const target = await createTripWithDays({
      userId: owner.id,
      name: IMPORT_PAYLOAD.trip.name,
      startDate: "2026-11-01T00:00:00.000Z",
      endDate: "2026-11-02T00:00:00.000Z",
    });

    // `target_trip_not_conflict`, not `target_trip_not_found`: the name-conflict list `runTripImport` checks
    // first is scoped to the caller, so another user's trip can never appear in it. Either way the request
    // is refused, and the point of this case is what is *not* on disk afterwards.
    await expect(
      importTripFromExportForUser({
        userId: stranger.id,
        payload: IMPORT_PAYLOAD,
        strategy: "overwrite",
        targetTripId: target.trip.id,
      }),
    ).rejects.toThrow("target_trip_not_conflict");
    expect(await fs.stat(`${getTripUploadDir(target.trip.id)}.import-lock`).catch(() => null)).toBeNull();

    // And a `targetTripId` that is a traversal string rather than an id: no directory anywhere, least of
    // all outside the media root.
    const escapeProbe = path.resolve(getMediaRoot(), "..", "..", "probe-escape");
    await expect(
      importTripFromExportForUser({
        userId: stranger.id,
        payload: IMPORT_PAYLOAD,
        strategy: "overwrite",
        targetTripId: "../../../../probe-escape/x",
      }),
    ).rejects.toThrow("target_trip_not_conflict");
    expect(await fs.stat(escapeProbe).catch(() => null)).toBeNull();
    expect(await fs.stat(`${escapeProbe}.import-lock`).catch(() => null)).toBeNull();
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

  /**
   * Story 8.4 / AC8, the overwrite half. `dropReplacedUploadUrl` used to be a string prefix test and so
   * carried the same evasion its create-new counterpart did: `//uploads/trips/<target>/x` reads as
   * not-this-trip's and is restored verbatim, while resolving to a file this very import is about to
   * delete - a row pointing at nothing, which is precisely what the rule exists to prevent. Decided on
   * the resolved path, all three spellings land on the same file and are nulled.
   *
   * Reachable here in a way it is not on create-new: an overwrite's target id is known before the
   * transaction, so a payload can spell it - including a traversal *through* it.
   */
  it.each([
    ["a doubled leading slash", (id: string) => `//uploads/trips/${id}/hero.jpg`],
    ["a doubled inner slash", (id: string) => `/uploads//trips/${id}/hero.jpg`],
    ["a traversal through its own directory", (id: string) => `/uploads/trips/${id}/days/../hero.jpg`],
  ])("clears an overwrite v1 hero url spelled with %s", async (label, spell) => {
    const user = await prisma.user.create({
      data: {
        email: `trip-import-overwrite-evasion-${label.replace(/[^a-z]+/gi, "-")}@example.com`,
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
    await writeUploadFile(getTripUploadDir(target.trip.id), "hero.jpg", jpegBytes());

    const result = await importTripFromExportForUser({
      userId: user.id,
      payload: {
        ...IMPORT_PAYLOAD,
        trip: { ...IMPORT_PAYLOAD.trip, heroImageUrl: spell(target.trip.id) },
      },
      strategy: "overwrite",
      targetTripId: target.trip.id,
    });

    expect(result.outcome).toBe("imported");
    const trip = await prisma.trip.findFirstOrThrow({ where: { id: target.trip.id } });
    expect(trip.heroImageUrl).toBeNull();
    // And the file really was deleted, so keeping the string would have restored a broken row.
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

  /**
   * `listTripsForUser` used to derive its four per-trip integers by including every `TripDay` with its
   * accommodation and all of its plan items, for every trip the account can reach, and counting the
   * result in JavaScript. Since the `where` became owner-OR-member the size of that fetch was decided
   * partly by *other* accounts. The four numbers now come from one grouped SQL aggregate over a
   * bounded page.
   *
   * The block below pins the numbers, and - just as importantly - the three properties that make the
   * replacement worth having and that a passing set of numeric assertions would not notice: the page
   * query loads no relations, the aggregate's plan-item subquery is bounded, and the cap discards the
   * archival end of the list rather than the upcoming one.
   */
  describe("listTripsForUser", () => {
    const createListUser = (email: string) =>
      prisma.user.create({ data: { email, passwordHash: "hashed", role: "OWNER" } });

    const createListTrip = (userId: string, name: string, overrides: Record<string, unknown> = {}) =>
      prisma.trip.create({
        data: {
          userId,
          name,
          startDate: new Date("2026-09-01T00:00:00.000Z"),
          endDate: new Date("2026-09-04T00:00:00.000Z"),
          ...overrides,
        },
      });

    const createListDay = (tripId: string, dayIndex: number) =>
      prisma.tripDay.create({ data: { tripId, dayIndex, date: new Date(Date.UTC(2026, 8, dayIndex)) } });

    /**
     * The fixture the aggregate assertions and the `getTripWithDaysForUser` cross-check share, laid
     * out so every row of the spec's edge-case matrix is present at once:
     *
     *   day 1 - no accommodation row, three plan items costing `null`, 500, `null`
     *   day 2 - a stay named `"   "` carrying 12 000, which is blank and so contributes nothing
     *   day 3 - a stay named "Hotel Lisboa" carrying 12 000, which counts
     *   day 4 - a stay named with a single tab carrying 7 000: blank to `String.prototype.trim`, and
     *           *not* blank to SQLite's one-argument `trim(X)`, so this day is the one that fails if
     *           the aggregate ever loses its explicit character set
     *
     * which is `dayCount` 4, `openDayCount` 3, `planItemCount` 3 and `plannedCostTotal` 12 500.
     */
    const seedMixedTrip = async (userId: string, overrides: Record<string, unknown> = {}) => {
      const trip = await createListTrip(userId, "Mixed", overrides);
      const noStay = await createListDay(trip.id, 1);
      const blankStay = await createListDay(trip.id, 2);
      const namedStay = await createListDay(trip.id, 3);
      const tabStay = await createListDay(trip.id, 4);

      await prisma.accommodation.create({ data: { tripDayId: blankStay.id, name: "   ", costCents: 12_000 } });
      await prisma.accommodation.create({
        data: { tripDayId: namedStay.id, name: "Hotel Lisboa", costCents: 12_000 },
      });
      await prisma.accommodation.create({ data: { tripDayId: tabStay.id, name: "\u0009", costCents: 7_000 } });
      await prisma.dayPlanItem.createMany({
        data: [
          { tripDayId: noStay.id, contentJson: "{}", costCents: null },
          { tripDayId: noStay.id, contentJson: "{}", costCents: 500 },
          { tripDayId: namedStay.id, contentJson: "{}", costCents: null },
        ],
      });

      return trip;
    };

    it("derives the four summary numbers from the aggregate, with the visible-accommodation rule intact", async () => {
      const user = await createListUser("list-aggregates@example.com");
      const trip = await seedMixedTrip(user.id);

      const { trips, totalCount } = await listTripsForUser(user.id);

      expect(totalCount).toBe(1);
      expect(trips).toHaveLength(1);
      expect(trips[0]).toMatchObject({
        id: trip.id,
        dayCount: 4,
        openDayCount: 3,
        // 12 000 from the named stay only. The blank-named and tab-named stays carry 19 000 between
        // them and contribute none of it; the three plan items contribute 500 across two nulls.
        planItemCount: 3,
        plannedCostTotal: 12_500,
      });

      // Not a formality. `@prisma/adapter-better-sqlite3` returns `bigint` for a raw statement's
      // `COUNT`/`SUM` columns, and a `bigint` passes every arithmetic assertion above before dying as
      // "Do not know how to serialize a BigInt" inside the route's response - a 500 no repository
      // test would have seen.
      for (const key of ["dayCount", "openDayCount", "planItemCount", "plannedCostTotal"] as const) {
        expect(typeof trips[0][key], key).toBe("number");
      }
    });

    it("treats a stay named only with characters String.prototype.trim strips as blank", async () => {
      const user = await createListUser("list-trim@example.com");
      const trip = await createListTrip(user.id, "Whitespace stays");

      // Tab, no-break space and ideographic space. All three are stripped by `String.prototype.trim`
      // and none of them by SQLite's one-argument `trim(X)`, which strips U+0020 alone - so with the
      // one-argument form these three days would read as *named* on the dashboard and as blank on the
      // trip overview, with their 30 000 appearing in one cost total and not the other.
      const blankNames = ["\u0009", "\u00A0", "\u3000"];
      for (const [index, name] of blankNames.entries()) {
        const day = await createListDay(trip.id, index + 1);
        await prisma.accommodation.create({ data: { tripDayId: day.id, name, costCents: 10_000 } });
      }

      const { trips } = await listTripsForUser(user.id);

      expect(trips[0].dayCount).toBe(3);
      expect(trips[0].openDayCount).toBe(3);
      expect(trips[0].plannedCostTotal).toBe(0);
    });

    /**
     * The whole-set version of the case above, and the one that actually pins `JS_TRIM_CHARACTERS`.
     *
     * That constant's own docstring warns that a missing code point is "a silent behaviour difference
     * rather than a visible edit" - and then only three of its twenty-five characters were exercised
     * anywhere. Deleting U+FEFF, U+1680, U+2007, U+205F, U+2028 or U+2029 from it left the entire
     * suite green while a stay named with that character read blank on the trip overview (JavaScript
     * `trim`) and named on the dashboard (SQL `trim`), its cost appearing in one total and not the
     * other. Which is precisely the divergence the constant exists to prevent.
     *
     * The expected set is *derived*, not typed out: every BMP code point is asked whether
     * `String.prototype.trim` strips it, which makes the set complete by construction and immune to a
     * hand-written list drifting from the engine. (There is no whitespace above the BMP, so a 16-bit
     * sweep is the whole of it.) The characters are read out of the production statement's own bound
     * values rather than re-spelled here, so the test cannot agree with a copy of the constant while
     * disagreeing with the constant.
     */
    it("strips exactly the code points String.prototype.trim strips, on both sides, one at a time", async () => {
      // `Prisma.sql` binds in source order and `JS_TRIM_CHARACTERS` is the statement's first
      // interpolation, so this is the very string the aggregate hands to SQLite's `trim(X, Y)`.
      const [trimCharacters] = buildTripAggregateQuery(["any-trip-id"]).values as [string];

      const jsWhitespace = Array.from({ length: 0x10000 }, (_, code) => String.fromCharCode(code)).filter(
        (character) => character.trim() === "",
      );
      // Negative controls. Zero-width space, word joiner and the Mongolian vowel separator all *look*
      // like whitespace and none of them is: they must be blank to neither side. Without these the
      // test would still pass if the constant grew characters JavaScript does not strip, which is the
      // same divergence in the other direction.
      const candidates = [...jsWhitespace, "\u200B", "\u2060", "\u180E", "x"];

      expect(jsWhitespace).toHaveLength(25);

      for (const character of candidates) {
        const codePoint = `U+${character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`;
        const [row] = await prisma.$queryRawUnsafe<{ blank: number | bigint }[]>(
          "SELECT trim(?, ?) = '' AS blank",
          character,
          trimCharacters,
        );

        expect(Number(row.blank) === 1, `${codePoint}: SQL trim() and String.prototype.trim() disagree`).toBe(
          character.trim() === "",
        );
      }
    });

    it("refuses an empty trip id list by name rather than letting Prisma.join explain it", () => {
      // The precondition is enforced at the call site inside `listTripsForUser`, which is exactly why
      // it also has to be enforced here: the function is exported, and the failure a caller would
      // otherwise get is `Prisma.join`'s "Expected `join([])` to be called with an array of multiple
      // elements", which names neither this function nor the rule that was broken.
      expect(() => buildTripAggregateQuery([])).toThrow(/buildTripAggregateQuery requires a non-empty tripIds/);
    });

    it("reports four zeros for a trip with no days, which produces no aggregate row at all", async () => {
      const user = await createListUser("list-zero-days@example.com");
      await createListTrip(user.id, "Nothing planned");

      const { trips, totalCount } = await listTripsForUser(user.id);

      // The aggregate is grouped over `trip_days`, so a dayless trip is simply absent from it. The
      // four defaults are what turn that absence into zeros rather than into `undefined`s on the wire.
      expect(totalCount).toBe(1);
      expect(trips[0]).toMatchObject({ dayCount: 0, openDayCount: 0, planItemCount: 0, plannedCostTotal: 0 });
    });

    it("caps the page at TRIPS_LIST_LIMIT, keeps the latest-starting trips, and reports the full total", async () => {
      const user = await createListUser("list-cap@example.com");
      const overflow = 3;
      const total = TRIPS_LIST_LIMIT + overflow;

      // Zero-padded explicit ids, one day apart, so "ascending by id" and "ascending by start date"
      // name the same order here and the two assertions below cannot disagree by accident.
      await prisma.trip.createMany({
        data: Array.from({ length: total }, (_, index) => ({
          id: `cap-${String(index).padStart(3, "0")}`,
          userId: user.id,
          name: `Trip ${index}`,
          startDate: new Date(Date.UTC(2026, 0, 1 + index)),
          endDate: new Date(Date.UTC(2026, 0, 1 + index)),
        })),
      });

      const { trips, totalCount } = await listTripsForUser(user.id);

      expect(totalCount).toBe(total);
      expect(trips).toHaveLength(TRIPS_LIST_LIMIT);
      // *Which* end the cap keeps is the point of the descending-select-then-reverse pair. `take` on
      // an ascending `startDate` would have returned cap-000..cap-199, discarding the three trips
      // furthest in the future - precisely the ones this surface exists to show, on a dashboard that
      // sorts finished trips to the bottom as archival.
      expect(trips[0].id).toBe(`cap-${String(overflow).padStart(3, "0")}`);
      expect(trips.at(-1)?.id).toBe(`cap-${String(total - 1).padStart(3, "0")}`);
      // And the page is handed back ascending, not in the descending order it was selected in.
      const ids = trips.map((entry) => entry.id);
      expect(ids).toEqual([...ids].sort());
    });

    it("orders trips sharing a startDate by ascending id, identically on repeated reads", async () => {
      const user = await createListUser("list-tiebreak@example.com");
      const sameDay = {
        startDate: new Date("2026-09-12T00:00:00.000Z"),
        endDate: new Date("2026-09-13T00:00:00.000Z"),
      };

      // Two properties of this fixture are load-bearing and neither is obvious.
      //
      // *Explicit* ids, because cuid is time-monotonic: with generated ids the rows come out of a
      // tiebreaker-less query in insertion order, which is also ascending id order, so the assertion
      // below would pass with the tiebreaker deleted.
      //
      // And an insertion order that is *neither* ascending nor descending by id, because the
      // repository selects `startDate desc, id desc` and then reverses. A fixture written in one
      // straight direction comes back in the other, so a plain descending insertion - the obvious
      // choice against an ascending query - would still satisfy this assertion with the tiebreaker
      // gone. c, a, d, b satisfies neither SQLite's rowid order nor its reverse, so deleting
      // `{ id: "desc" }` from the repository's `orderBy` fails this test. That was checked by
      // deleting it, not reasoned about.
      for (const id of ["tie-c", "tie-a", "tie-d", "tie-b"]) {
        await prisma.trip.create({ data: { id, userId: user.id, name: id, ...sameDay } });
      }

      const first = await listTripsForUser(user.id);
      const second = await listTripsForUser(user.id);

      expect(first.trips.map((entry) => entry.id)).toEqual(["tie-a", "tie-b", "tie-c", "tie-d"]);
      expect(second.trips.map((entry) => entry.id)).toEqual(first.trips.map((entry) => entry.id));
    });

    it("agrees with getTripWithDaysForUser's JavaScript derivation on the same fixture", async () => {
      const user = await createListUser("list-crosscheck@example.com");
      const trip = await seedMixedTrip(user.id);

      // The blank-stay and visible-cost rules now exist twice - in SQL in the aggregate, and in
      // JavaScript in `getTripWithDaysForUser` - and nothing but this case holds the two together. A
      // `trim(X)` regression on the SQL side, or a changed rule on the JS side, surfaces here as a
      // disagreement instead of as two internally consistent surfaces quoting different totals for
      // one trip.
      const detail = await getTripWithDaysForUser(user.id, trip.id);
      const { trips } = await listTripsForUser(user.id);
      const summary = trips.find((entry) => entry.id === trip.id);

      expect(detail).not.toBeNull();
      expect(summary).toBeDefined();
      expect(summary?.dayCount).toBe(detail?.dayCount);
      expect(summary?.plannedCostTotal).toBe(detail?.plannedCostTotal);
      expect(summary?.openDayCount).toBe(detail?.days.filter((day) => day.missingAccommodation).length);
      expect(summary?.planItemCount).toBe(
        detail?.days.reduce((sum, day) => sum + day.dayPlanItems.length, 0),
      );
    });

    it("asks the page query for no day, stay or plan-item rows", async () => {
      const user = await createListUser("list-no-include@example.com");
      await seedMixedTrip(user.id);

      // `vi.spyOn` alone is not enough on a Prisma 7 delegate, and the failure is silent in one
      // direction and destructive in the other. `prisma.trip` is a Proxy whose
      // `getOwnPropertyDescriptor` reports `value: undefined` while its `get` returns the real
      // function, so a plain spy wraps `undefined` (every call returns `undefined`) and
      // `mockRestore` writes that `undefined` back - breaking `prisma.trip.findMany` for every test
      // that runs after this one in the same worker. Capturing the function through `get` first, and
      // reinstating it by hand in the `finally`, is what makes the spy both call through and clean up.
      const delegate = prisma.trip as unknown as { findMany: (args?: unknown) => Promise<unknown[]> };
      const original = delegate.findMany;
      const findMany = vi
        .spyOn(prisma.trip, "findMany")
        .mockImplementation(((args: never) => original(args)) as never);

      try {
        await listTripsForUser(user.id);

        expect(findMany).toHaveBeenCalledTimes(1);
        const args = findMany.mock.calls[0]?.[0] as
          | { include?: Record<string, unknown>; select?: Record<string, unknown> }
          | undefined;
        // Both keys, because Prisma loads a relation through either one and an `include`-only
        // assertion is blind to the cheaper rewrite: `select: { id: true, ..., days: { select: ... } }`
        // restores the O(days x items) fetch the whole change exists to remove while leaving
        // `include` empty, and every numeric assertion in this block still passes with it back.
        // Scalars are filtered out by name so a future `select` of plain columns stays legal - it is
        // the *relations* that decide how much of the tree crosses the wire.
        const TRIP_RELATION_FIELDS = ["user", "members", "days", "bucketListItems"];
        const requested = { ...(args?.include ?? {}), ...(args?.select ?? {}) };
        const relationsAsked = Object.keys(requested).filter(
          (key) => TRIP_RELATION_FIELDS.includes(key) && requested[key],
        );
        // The membership sub-select is the only relation this query is allowed to load.
        expect(relationsAsked).toEqual(["members"]);
      } finally {
        findMany.mockRestore();
        delegate.findMany = original;
      }
    });

    /**
     * The plan-shape guard, and the one test in this block whose subject is *how* the aggregate runs
     * rather than what it returns.
     *
     * Three things had to be got right for it to mean anything, and the first two are why the earlier
     * version of it was worse than nothing.
     *
     * **It pins the statistics.** SQLite's plan choice is cost-based, so it is decided by
     * `sqlite_stat1` and not by the SQL alone - and `sqlite_stat1` is *persistent state of the test
     * database file*, surviving every `deleteMany` in `beforeEach` and every process boundary. One
     * developer running `ANALYZE` on a large fixture while investigating this query leaves numbers
     * behind that silently re-plan this statement for everybody afterwards; that is exactly what made
     * the previous version pass in one invocation and fail in the next. Dropping the table restores
     * the planner's built-in default estimates, which is also the state the application runs in -
     * nothing in this codebase ever issues `ANALYZE`. Measured against those defaults the shape below
     * held at 0, 2, 200, 1 000 and 5 000 trips, and for 1- and 200-id pages, so the assertions are not
     * secretly a function of this fixture's size.
     *
     * **It names what it forbids.** "No line starting with SCAN" was simultaneously too strict and
     * too weak: it banned `SCAN p`, which is a pass over the already-bounded materialised subquery and
     * is not a cost anyone cares about, while saying nothing by name about the two tables that can
     * actually be read whole. The cost this story exists to remove is an unbounded pass over
     * `day_plan_items`; `accommodations` is the other table joined per page row. Those two are named.
     *
     * **It seeds its own data**, including plan items on a trip outside the page, so the aggregate's
     * *result* can be checked to exclude them in the same breath - a bound the plan alone cannot show.
     *
     * SQLite prints the *aliases* from the statement, not table names: `i` is `day_plan_items`, `a` is
     * `accommodations`, `t` and `d` are both `trip_days`, and `p` is the materialised subquery.
     * `MATERIALIZE p` is deliberately *not* asserted: it appears whether or not the subquery carries
     * its `WHERE`, so it can only ever fail spuriously.
     */
    it("plans the aggregate without an unbounded pass over day_plan_items or accommodations", async () => {
      const user = await createListUser("list-query-plan@example.com");
      const trip = await seedMixedTrip(user.id);
      // Plan items belonging to a trip that is *not* on the page. The property under test is that
      // they are never visited, which is a stronger statement than "they are not in the result" - but
      // both are checked below.
      const other = await createListTrip(user.id, "Not on the page");
      const otherDay = await createListDay(other.id, 1);
      await prisma.dayPlanItem.create({ data: { tripDayId: otherDay.id, contentJson: "{}", costCents: 999 } });

      // See the docstring: leftover `ANALYZE` statistics in the test database file are what made this
      // test's outcome depend on which other tests had run, and on which experiments a developer had
      // run days earlier. `IF EXISTS` because the clean state is for the table to be absent.
      await prisma.$executeRawUnsafe("DROP TABLE IF EXISTS sqlite_stat1");

      // `EXPLAIN QUERY PLAN` of the very `Prisma.Sql` production runs, values and all - a retyped
      // paraphrase of the statement would keep passing while the real query regressed.
      const sql = buildTripAggregateQuery([trip.id]);
      const plan = await prisma.$queryRawUnsafe<{ detail: string }[]>(
        `EXPLAIN QUERY PLAN ${sql.sql}`,
        ...sql.values,
      );
      const details = plan.map((row) => row.detail);

      const scansOf = (alias: string) => details.filter((detail) => new RegExp(`^SCAN ${alias}\\b`).test(detail));

      // The regression this whole change exists to prevent. Remove the subquery's own
      // `WHERE t.trip_id IN (...)` - with or without leaving the `JOIN trip_days t` in place - and
      // this becomes `["SCAN i USING INDEX idx_day_plan_items_trip_day_id"]`: every plan item row in
      // the database, grouped, on every dashboard load.
      expect(scansOf("i"), "unbounded pass over day_plan_items").toEqual([]);
      expect(scansOf("a"), "unbounded pass over accommodations").toEqual([]);

      // And positively: each of the four tables is reached through an equality lookup on its index.
      // Stated as well as the prohibition above because a plan that stopped reading `day_plan_items`
      // altogether - a subquery accidentally optimised away - would satisfy the prohibition alone.
      const has = (pattern: RegExp) => details.some((detail) => pattern.test(detail));
      expect(has(/^SEARCH i USING INDEX idx_day_plan_items_trip_day_id \(trip_day_id=\?\)/)).toBe(true);
      expect(has(/^SEARCH t USING INDEX idx_trip_days_trip_id \(trip_id=\?\)/)).toBe(true);
      expect(has(/^SEARCH d USING INDEX idx_trip_days_trip_id \(trip_id=\?\)/)).toBe(true);
      expect(has(/^SEARCH a USING INDEX idx_accommodations_trip_day_id \(trip_day_id=\?\)/)).toBe(true);

      // The result half of the same bound: the outside trip's plan item is neither visited nor counted.
      const rows = await prisma.$queryRaw<{ planItemCount: number | bigint }[]>(sql);
      expect(rows).toHaveLength(1);
      expect(Number(rows[0].planItemCount)).toBe(3);
    });

    /**
     * The same statement at the size production can actually reach. The test above binds a single id,
     * so on its own it leaves the two claims that only bite at a full page untested:
     *
     *   - `TRIPS_LIST_LIMIT`'s docstring reasons about a **bind-parameter budget** - the id list is
     *     bound twice plus two trim strings, so a full page is 2 x 200 + 2 = 402 host parameters. If
     *     that arithmetic were ever wrong, or the constant raised past SQLite's ceiling, the failure
     *     is "too many SQL variables" and a 500 on the dashboard's only fetch, on precisely the
     *     accounts the cap exists to make safe. Nothing else in the suite executes the statement with
     *     more than a handful of ids.
     *   - The plan-shape docstring claims the access paths hold "for 1- and 200-id pages". Measured
     *     once by hand is not the same as pinned; SQLite may plan a 200-element `IN` list differently
     *     from a singleton.
     *
     * No fixture is seeded: both properties are about the *statement*, and an `IN` list of ids that
     * match nothing exercises the binding and the planner exactly as a real page would.
     */
    it("binds and plans a full TRIPS_LIST_LIMIT page without exceeding its host-parameter budget", async () => {
      const pageIds = Array.from({ length: TRIPS_LIST_LIMIT }, (_, index) => `plan-budget-${index}`);
      const sql = buildTripAggregateQuery(pageIds);
      expect(sql.values).toHaveLength(TRIPS_LIST_LIMIT * 2 + 2);

      await prisma.$executeRawUnsafe("DROP TABLE IF EXISTS sqlite_stat1");

      // Executing it is the assertion for the budget: over the ceiling this throws "too many SQL
      // variables" rather than returning an empty result.
      const rows = await prisma.$queryRaw<{ tripId: string }[]>(sql);
      expect(rows).toEqual([]);

      const plan = await prisma.$queryRawUnsafe<{ detail: string }[]>(
        `EXPLAIN QUERY PLAN ${sql.sql}`,
        ...sql.values,
      );
      const details = plan.map((row) => row.detail);
      const scansOf = (alias: string) => details.filter((detail) => new RegExp(`^SCAN ${alias}\\b`).test(detail));

      // The same bound as the single-id case, at the page size that makes it matter.
      expect(scansOf("i"), "unbounded pass over day_plan_items at a full page").toEqual([]);
      expect(scansOf("a"), "unbounded pass over accommodations at a full page").toEqual([]);
      expect(details.some((detail) => /^SEARCH i USING INDEX idx_day_plan_items_trip_day_id/.test(detail))).toBe(true);
    });

    it("returns owned and membership-reached trips, and counts both in the total", async () => {
      const owner = await createListUser("list-scope-owner@example.com");
      const member = await createListUser("list-scope-member@example.com");
      await createListTrip(member.id, "Mine", { id: "scope-a" });
      await createListTrip(owner.id, "Theirs, shared", { id: "scope-b" });
      await createListTrip(owner.id, "Theirs, not shared", { id: "scope-c" });
      await prisma.tripMember.create({ data: { tripId: "scope-b", userId: member.id, role: "VIEWER" } });

      const { trips, totalCount } = await listTripsForUser(member.id);

      // `totalCount` runs the same owner-OR-member `where` as the page, so a trip the account cannot
      // reach must not inflate it - otherwise the advisory line would announce a truncation that never
      // happened, over somebody else's data.
      expect(totalCount).toBe(2);
      expect(trips.map((entry) => [entry.id, entry.accessRole])).toEqual([
        ["scope-a", "owner"],
        ["scope-b", "viewer"],
      ]);
    });
  });
});
