import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import fs from "node:fs/promises";
import { crc32 } from "node:zlib";
import { GET } from "@/app/api/trips/[id]/export/route";
import { prisma } from "@/lib/db/prisma";
import { createSessionJwt } from "@/lib/auth/jwt";
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
import { readZipArchive, readZipEntryMap, readZipEntryNames } from "./helpers/zipReader";
import { pdfBytes, writeUploadFile } from "./helpers/uploadFixtures";
import { toDosDateTime } from "@/lib/trips/zipArchive";

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

type ExportDocumentRef = { sortOrder: number; documentId: string; fileName: string };

type ExportManifest = {
  meta: { exportedAt: string; appVersion: string; formatVersion: number; warnings: string[] };
  photos: Record<string, { contentType: string; archivePath: string }>;
  documents: Record<string, { contentType: string; archivePath: string }>;
  trip: {
    id: string;
    name: string;
    updatedAt: string;
    heroImageUrl: string | null;
    heroPhotoId: string | null;
    bucketListItems: {
      id: string;
      title: string;
      description: string | null;
      positionText: string | null;
      location: { lat: number; lng: number; label: string | null } | null;
    }[];
  };
  days: {
    id: string;
    dayIndex: number;
    imageUrl: string | null;
    imagePhotoId: string | null;
    accommodation: {
      id: string;
      images: { sortOrder: number; photoId: string }[];
      documents: ExportDocumentRef[];
    } | null;
    dayPlanItems: {
      id: string;
      images: { sortOrder: number; photoId: string }[];
      documents: ExportDocumentRef[];
    }[];
    travelSegments: {
      id: string;
      fromItemType: string;
      fromItemId: string;
      toItemType: string;
      toItemId: string;
      transportType: string;
      durationMinutes: number;
      distanceKm: number | null;
      linkUrl: string | null;
    }[];
  }[];
};

const buildRequest = (tripId: string, options?: { session?: string }) => {
  const headers: Record<string, string> = {};
  if (options?.session) {
    headers.cookie = `session=${options.session}`;
  }

  return new NextRequest(`http://localhost/api/trips/${tripId}/export`, {
    method: "GET",
    headers,
  });
};

const routeContext = (id: string) => ({ params: Promise.resolve({ id }) });

const readArchive = async (response: Response) => Buffer.from(await response.arrayBuffer());

const readManifest = (archive: Buffer) => {
  const entry = readZipArchive(archive).entries.find((candidate) => candidate.name === "trip.json");
  if (!entry) {
    throw new Error("Archive has no trip.json member");
  }
  return JSON.parse(entry.data.toString("utf8")) as ExportManifest;
};

describe("GET /api/trips/[id]/export", () => {
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
    // Added by Story 5.13, which gave this suite its first memberships. Without it a stale row would
    // decide the next test's role.
    await prisma.tripMember.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
    await fs.rm(uploadsRoot, { recursive: true, force: true });
  });

  const createOwner = async (email: string) => {
    const user = await prisma.user.create({
      data: { email, passwordHash: "hashed", role: "OWNER" },
    });
    return { user, token: await createSessionJwt({ sub: user.id, role: user.role }) };
  };

  it("returns a downloadable v2 zip archive for an owned trip", async () => {
    const { user, token } = await createOwner("trip-export-route@example.com");

    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Paris / Rome 2026",
      startDate: "2026-11-01T00:00:00.000Z",
      endDate: "2026-11-02T00:00:00.000Z",
    });
    const [day1] = await prisma.tripDay.findMany({
      where: { tripId: trip.id },
      orderBy: { dayIndex: "asc" },
    });
    await prisma.accommodation.create({
      data: {
        tripDayId: day1.id,
        name: "River Hotel",
        status: "BOOKED",
      },
    });

    const request = buildRequest(trip.id, { session: token });
    const response = await GET(request, routeContext(trip.id));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toMatch(
      /^attachment; filename="trip-paris-rome-2026-\d{4}-\d{2}-\d{2}\.zip"$/
    );

    const archive = await readArchive(response);
    const parsed = readZipArchive(archive);
    expect(parsed.entries.map((entry) => entry.name)).toEqual(["trip.json"]);

    const payload = readManifest(archive);
    expect(payload.meta.formatVersion).toBe(2);
    expect(payload.meta.exportedAt).toBe(payload.trip.updatedAt);
    expect(payload.meta.warnings).toEqual([]);
    expect(payload.photos).toEqual({});
    expect(payload.documents).toEqual({});
    expect(payload.trip.id).toBe(trip.id);
    expect(payload.trip.heroPhotoId).toBeNull();
    expect(payload.trip.bucketListItems).toEqual([]);
    expect(payload.days).toHaveLength(2);
    expect(payload.days[0].imagePhotoId).toBeNull();
    expect(payload.days[0].accommodation?.images).toEqual([]);
    expect(payload.days[0].accommodation?.documents).toEqual([]);
    expect(payload.days[0].travelSegments).toEqual([]);
  });

  it("round-trips travel segments and bucket list items into the manifest", async () => {
    const { user, token } = await createOwner("trip-export-segments@example.com");

    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Segment Trip",
      startDate: "2026-09-01T00:00:00.000Z",
      endDate: "2026-09-01T00:00:00.000Z",
    });
    const [day] = await prisma.tripDay.findMany({ where: { tripId: trip.id } });

    const accommodation = await prisma.accommodation.create({
      data: { tripDayId: day.id, name: "Harbour Inn" },
    });
    const planItem = await prisma.dayPlanItem.create({
      data: {
        tripDayId: day.id,
        title: "Ferry terminal",
        contentJson: JSON.stringify({ type: "doc", content: [] }),
      },
    });
    await prisma.travelSegment.create({
      data: {
        tripDayId: day.id,
        fromItemType: "ACCOMMODATION",
        fromItemId: accommodation.id,
        toItemType: "DAY_PLAN_ITEM",
        toItemId: planItem.id,
        transportType: "SHIP",
        durationMinutes: 45,
        distanceKm: 12.5,
        linkUrl: "https://example.com/ferry",
      },
    });
    // Deliberately inserted out of alphabetical order to pin the title-first ordering.
    await prisma.tripBucketListItem.create({
      data: { tripId: trip.id, title: "Zoo visit", description: "Pandas", positionText: "North" },
    });
    await prisma.tripBucketListItem.create({
      data: {
        tripId: trip.id,
        title: "Aquarium",
        locationLat: 48.14,
        locationLng: 11.58,
        locationLabel: "Old harbour",
      },
    });

    const response = await GET(buildRequest(trip.id, { session: token }), routeContext(trip.id));
    const payload = readManifest(await readArchive(response));

    expect(response.status).toBe(200);
    expect(payload.trip.bucketListItems.map((item) => item.title)).toEqual(["Aquarium", "Zoo visit"]);
    expect(payload.trip.bucketListItems[0].location).toEqual({ lat: 48.14, lng: 11.58, label: "Old harbour" });
    expect(payload.trip.bucketListItems[1]).toEqual(
      expect.objectContaining({ description: "Pandas", positionText: "North", location: null })
    );

    expect(payload.days[0].travelSegments).toHaveLength(1);
    const segment = payload.days[0].travelSegments[0];
    expect(segment).toEqual(
      expect.objectContaining({
        fromItemType: "accommodation",
        toItemType: "dayPlanItem",
        transportType: "ship",
        durationMinutes: 45,
        distanceKm: 12.5,
        linkUrl: "https://example.com/ferry",
      })
    );
    // Endpoint ids must equal the exported records' ids, or 2.32 cannot rewire them.
    expect(segment.fromItemId).toBe(payload.days[0].accommodation?.id);
    expect(segment.toItemId).toBe(payload.days[0].dayPlanItems[0].id);
  });

  it("writes one archive member per pooled photo with no unregistered member and no dangling reference", async () => {
    const { user, token } = await createOwner("trip-export-photos@example.com");

    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Photo Trip",
      startDate: "2026-07-01T00:00:00.000Z",
      endDate: "2026-07-01T00:00:00.000Z",
    });
    const [day] = await prisma.tripDay.findMany({ where: { tripId: trip.id } });
    const accommodation = await prisma.accommodation.create({
      data: { tripDayId: day.id, name: "Gallery Hotel" },
    });
    const planItem = await prisma.dayPlanItem.create({
      data: { tripDayId: day.id, contentJson: JSON.stringify({ type: "doc", content: [] }) },
    });

    await writeUploadFile(getTripUploadDir(trip.id), "hero.jpg", "hero-bytes");
    await writeUploadFile(getTripDayUploadDir(trip.id, day.id), "day.png", "day-bytes");
    await writeUploadFile(
      getAccommodationImageUploadDir(trip.id, day.id, accommodation.id),
      "stay.webp",
      "stay-bytes"
    );
    await writeUploadFile(
      getDayPlanItemImageUploadDir(trip.id, day.id, planItem.id),
      "activity.JPEG",
      "activity-bytes"
    );

    await prisma.trip.update({
      where: { id: trip.id },
      data: { heroImageUrl: `/uploads/trips/${trip.id}/hero.jpg` },
    });
    await prisma.tripDay.update({
      where: { id: day.id },
      data: { imageUrl: `/uploads/trips/${trip.id}/days/${day.id}/day.png` },
    });
    await prisma.accommodationImage.create({
      data: {
        accommodationId: accommodation.id,
        imageUrl: `/uploads/trips/${trip.id}/days/${day.id}/accommodations/${accommodation.id}/stay.webp`,
        sortOrder: 0,
      },
    });
    await prisma.dayPlanItemImage.create({
      data: {
        dayPlanItemId: planItem.id,
        imageUrl: `/uploads/trips/${trip.id}/days/${day.id}/day-plan-items/${planItem.id}/activity.JPEG`,
        sortOrder: 0,
      },
    });

    const response = await GET(buildRequest(trip.id, { session: token }), routeContext(trip.id));
    const archive = await readArchive(response);
    const parsed = readZipArchive(archive);
    const payload = readManifest(archive);

    expect(response.status).toBe(200);
    expect(payload.meta.warnings).toEqual([]);
    // Pool keys are assigned in traversal order: hero, day image, accommodation gallery, plan items.
    expect(Object.keys(payload.photos)).toEqual(["p1", "p2", "p3", "p4"]);
    expect(payload.photos).toEqual({
      p1: { contentType: "image/jpeg", archivePath: "photos/p1.jpg" },
      p2: { contentType: "image/png", archivePath: "photos/p2.png" },
      p3: { contentType: "image/webp", archivePath: "photos/p3.webp" },
      p4: { contentType: "image/jpeg", archivePath: "photos/p4.jpeg" },
    });
    expect(payload.trip.heroPhotoId).toBe("p1");
    expect(payload.days[0].imagePhotoId).toBe("p2");
    expect(payload.days[0].accommodation?.images).toEqual([{ sortOrder: 0, photoId: "p3" }]);
    expect(payload.days[0].dayPlanItems[0].images).toEqual([{ sortOrder: 0, photoId: "p4" }]);

    // Pool and archive agree in both directions.
    const memberNames = parsed.entries.filter((entry) => entry.name !== "trip.json").map((entry) => entry.name);
    const poolPaths = Object.values(payload.photos).map((photo) => photo.archivePath);
    expect([...memberNames].sort()).toEqual([...poolPaths].sort());
    expect(memberNames).toHaveLength(new Set(memberNames).size);

    // Every reference resolves to a pool key.
    const referenced = [
      payload.trip.heroPhotoId,
      payload.days[0].imagePhotoId,
      ...(payload.days[0].accommodation?.images.map((image) => image.photoId) ?? []),
      ...payload.days[0].dayPlanItems.flatMap((item) => item.images.map((image) => image.photoId)),
    ].filter((value): value is string => value !== null);
    for (const photoId of referenced) {
      expect(payload.photos[photoId]).toBeDefined();
    }

    const byName = readZipEntryMap(archive);
    expect(byName.get("photos/p1.jpg")?.toString("utf8")).toBe("hero-bytes");
    expect(byName.get("photos/p4.jpeg")?.toString("utf8")).toBe("activity-bytes");
  });

  it("pools a file referenced by two records once and writes one member for it", async () => {
    const { user, token } = await createOwner("trip-export-dedupe@example.com");

    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Dedupe Trip",
      startDate: "2026-07-05T00:00:00.000Z",
      endDate: "2026-07-05T00:00:00.000Z",
    });
    const [day] = await prisma.tripDay.findMany({ where: { tripId: trip.id } });
    const accommodation = await prisma.accommodation.create({
      data: { tripDayId: day.id, name: "Shared Photo Hotel" },
    });

    const sharedUrl = `/uploads/trips/${trip.id}/days/${day.id}/accommodations/${accommodation.id}/shared.jpg`;
    await writeUploadFile(
      getAccommodationImageUploadDir(trip.id, day.id, accommodation.id),
      "shared.jpg",
      "shared-bytes"
    );
    await prisma.accommodationImage.createMany({
      data: [
        { accommodationId: accommodation.id, imageUrl: sharedUrl, sortOrder: 0 },
        { accommodationId: accommodation.id, imageUrl: sharedUrl, sortOrder: 1 },
      ],
    });

    const response = await GET(buildRequest(trip.id, { session: token }), routeContext(trip.id));
    const archive = await readArchive(response);
    const payload = readManifest(archive);
    const parsed = readZipArchive(archive);

    expect(Object.keys(payload.photos)).toEqual(["p1"]);
    expect(payload.days[0].accommodation?.images).toEqual([
      { sortOrder: 0, photoId: "p1" },
      { sortOrder: 1, photoId: "p1" },
    ]);
    expect(parsed.entries.map((entry) => entry.name)).toEqual(["trip.json", "photos/p1.jpg"]);
  });

  it("round-trips real binary photo bytes through the archive", async () => {
    const { user, token } = await createOwner("trip-export-binary@example.com");

    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Binary Trip",
      startDate: "2026-07-06T00:00:00.000Z",
      endDate: "2026-07-06T00:00:00.000Z",
    });

    // Every other fixture in this suite writes ASCII, which exercises neither the CRC nor the size
    // fields the way a real JPEG does. This one carries a PNG signature, embedded nulls, high bytes
    // and every byte value in between, at a length no header field can hide a mistake in.
    const bytes = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from(Array.from({ length: 4096 }, (_, index) => index % 256)),
    ]);
    await writeUploadFile(getTripUploadDir(trip.id), "hero.png", bytes);
    await prisma.trip.update({
      where: { id: trip.id },
      data: { heroImageUrl: `/uploads/trips/${trip.id}/hero.png` },
    });

    const response = await GET(buildRequest(trip.id, { session: token }), routeContext(trip.id));
    const archive = await readArchive(response);
    const member = readZipArchive(archive).entries.find((entry) => entry.name === "photos/p1.png");

    expect(member).toBeDefined();
    expect(member?.uncompressedSize).toBe(bytes.length);
    expect(member?.compressedSize).toBe(bytes.length);
    expect(member?.crc32).toBe(crc32(bytes));
    expect(Buffer.compare(member?.data ?? Buffer.alloc(0), bytes)).toBe(0);
  });

  it("exports a trip with no photos as a single-member archive", async () => {
    const { user, token } = await createOwner("trip-export-no-photos@example.com");

    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "No Photos",
      startDate: "2026-07-10T00:00:00.000Z",
      endDate: "2026-07-10T00:00:00.000Z",
    });

    const response = await GET(buildRequest(trip.id, { session: token }), routeContext(trip.id));
    const archive = await readArchive(response);
    const payload = readManifest(archive);

    expect(response.status).toBe(200);
    expect(readZipEntryNames(archive)).toEqual(["trip.json"]);
    expect(payload.photos).toEqual({});
    expect(payload.meta.warnings).toEqual([]);
  });

  it("drops a photo whose file was deleted from disk and records a warning", async () => {
    const { user, token } = await createOwner("trip-export-missing-file@example.com");

    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Missing File",
      startDate: "2026-07-12T00:00:00.000Z",
      endDate: "2026-07-12T00:00:00.000Z",
    });
    const heroUrl = `/uploads/trips/${trip.id}/hero.jpg`;
    await prisma.trip.update({ where: { id: trip.id }, data: { heroImageUrl: heroUrl } });

    const response = await GET(buildRequest(trip.id, { session: token }), routeContext(trip.id));
    const archive = await readArchive(response);
    const payload = readManifest(archive);

    expect(response.status).toBe(200);
    expect(payload.trip.heroPhotoId).toBeNull();
    // The v1 field survives untouched, so a v1 reader is unaffected.
    expect(payload.trip.heroImageUrl).toBe(heroUrl);
    expect(payload.photos).toEqual({});
    expect(payload.meta.warnings).toHaveLength(1);
    expect(payload.meta.warnings[0]).toContain(heroUrl);
    expect(readZipEntryNames(archive)).toEqual(["trip.json"]);
  });

  it("never reads a stored path that escapes the trip's own upload directory", async () => {
    const { user, token } = await createOwner("trip-export-traversal@example.com");

    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Traversal Trip",
      startDate: "2026-07-15T00:00:00.000Z",
      endDate: "2026-07-15T00:00:00.000Z",
    });
    const [day] = await prisma.tripDay.findMany({ where: { tripId: trip.id } });

    // A real file exists at the escape target, so a pass would be visible rather than silent.
    await writeUploadFile(uploadsRoot, "escape.png", "escaped-bytes");

    const escapeUrl = `/uploads/trips/${trip.id}/../../escape.png`;
    await prisma.tripDay.update({ where: { id: day.id }, data: { imageUrl: escapeUrl } });

    const response = await GET(buildRequest(trip.id, { session: token }), routeContext(trip.id));
    const archive = await readArchive(response);
    const payload = readManifest(archive);

    expect(response.status).toBe(200);
    expect(payload.days[0].imagePhotoId).toBeNull();
    expect(payload.days[0].imageUrl).toBe(escapeUrl);
    expect(payload.photos).toEqual({});
    expect(readZipEntryNames(archive)).toEqual(["trip.json"]);
    expect(archive.includes(Buffer.from("escaped-bytes", "utf8"))).toBe(false);
  });

  it("leaves an external https image URL unfetched and unpooled", async () => {
    const { user, token } = await createOwner("trip-export-external@example.com");

    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "External Image",
      startDate: "2026-07-18T00:00:00.000Z",
      endDate: "2026-07-18T00:00:00.000Z",
    });
    const [day] = await prisma.tripDay.findMany({ where: { tripId: trip.id } });
    await prisma.tripDay.update({
      where: { id: day.id },
      data: { imageUrl: "https://cdn.example.com/day.jpg" },
    });

    const response = await GET(buildRequest(trip.id, { session: token }), routeContext(trip.id));
    const payload = readManifest(await readArchive(response));

    expect(payload.days[0].imagePhotoId).toBeNull();
    expect(payload.days[0].imageUrl).toBe("https://cdn.example.com/day.jpg");
    expect(payload.photos).toEqual({});
    expect(payload.meta.warnings).toEqual([]);
  });

  it("writes document members after the photo members, in their own pool order", async () => {
    const { user, token } = await createOwner("trip-export-documents@example.com");

    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Document Trip",
      startDate: "2026-07-20T00:00:00.000Z",
      endDate: "2026-07-20T00:00:00.000Z",
    });
    const [day] = await prisma.tripDay.findMany({ where: { tripId: trip.id } });
    const accommodation = await prisma.accommodation.create({
      data: { tripDayId: day.id, name: "Ticketed Hotel" },
    });
    const planItem = await prisma.dayPlanItem.create({
      data: { tripDayId: day.id, contentJson: JSON.stringify({ type: "doc", content: [] }) },
    });

    // One photo, so the fixed entry order has both halves to order.
    await writeUploadFile(getTripUploadDir(trip.id), "hero.jpg", "hero-bytes");
    await prisma.trip.update({
      where: { id: trip.id },
      data: { heroImageUrl: `/uploads/trips/${trip.id}/hero.jpg` },
    });

    const stayDocumentDir = getAccommodationDocumentUploadDir(trip.id, day.id, accommodation.id);
    const itemDocumentDir = getDayPlanItemDocumentUploadDir(trip.id, day.id, planItem.id);
    await writeUploadFile(stayDocumentDir, "doc-1.pdf", "stay-ticket-bytes");
    await writeUploadFile(stayDocumentDir, "doc-2.png", "stay-map-bytes");
    await writeUploadFile(itemDocumentDir, "doc-3.pdf", "activity-ticket-bytes");

    await prisma.accommodationDocument.createMany({
      data: [
        {
          accommodationId: accommodation.id,
          documentUrl: `/uploads/trips/${trip.id}/days/${day.id}/accommodations/${accommodation.id}/documents/doc-1.pdf`,
          fileName: "Ticket Rom.pdf",
          sortOrder: 0,
        },
        {
          accommodationId: accommodation.id,
          documentUrl: `/uploads/trips/${trip.id}/days/${day.id}/accommodations/${accommodation.id}/documents/doc-2.png`,
          fileName: "Lageplan.png",
          sortOrder: 1,
        },
      ],
    });
    await prisma.dayPlanItemDocument.create({
      data: {
        dayPlanItemId: planItem.id,
        documentUrl: `/uploads/trips/${trip.id}/days/${day.id}/day-plan-items/${planItem.id}/documents/doc-3.pdf`,
        fileName: "Museum.pdf",
        sortOrder: 0,
      },
    });

    const response = await GET(buildRequest(trip.id, { session: token }), routeContext(trip.id));
    const archive = await readArchive(response);
    const payload = readManifest(archive);

    expect(response.status).toBe(200);
    expect(payload.meta.warnings).toEqual([]);
    // Still 2: documents are an additive change *within* v2, not a new format.
    expect(payload.meta.formatVersion).toBe(2);

    // Its own pool, its own `d` sequence, its own prefix - never the photo pool.
    expect(Object.keys(payload.photos)).toEqual(["p1"]);
    expect(payload.documents).toEqual({
      d1: { contentType: "application/pdf", archivePath: "documents/d1.pdf" },
      d2: { contentType: "image/png", archivePath: "documents/d2.png" },
      d3: { contentType: "application/pdf", archivePath: "documents/d3.pdf" },
    });

    // The refs carry the name, which is the only place AC8's "the same names come back" can live.
    expect(payload.days[0].accommodation?.documents).toEqual([
      { sortOrder: 0, documentId: "d1", fileName: "Ticket Rom.pdf" },
      { sortOrder: 1, documentId: "d2", fileName: "Lageplan.png" },
    ]);
    expect(payload.days[0].dayPlanItems[0].documents).toEqual([
      { sortOrder: 0, documentId: "d3", fileName: "Museum.pdf" },
    ]);

    // Fixed entry order: manifest, photos in pool order, then documents in pool order. Asserted as
    // the whole list rather than as membership, because the order *is* the property.
    expect(readZipEntryNames(archive)).toEqual([
      "trip.json",
      "photos/p1.jpg",
      "documents/d1.pdf",
      "documents/d2.png",
      "documents/d3.pdf",
    ]);

    const byName = readZipEntryMap(archive);
    expect(byName.get("documents/d1.pdf")?.toString("utf8")).toBe("stay-ticket-bytes");
    expect(byName.get("documents/d3.pdf")?.toString("utf8")).toBe("activity-ticket-bytes");
  });

  it("drops a document whose file was deleted from disk and records a warning", async () => {
    const { user, token } = await createOwner("trip-export-missing-document@example.com");

    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Missing Document",
      startDate: "2026-07-21T00:00:00.000Z",
      endDate: "2026-07-21T00:00:00.000Z",
    });
    const [day] = await prisma.tripDay.findMany({ where: { tripId: trip.id } });
    const accommodation = await prisma.accommodation.create({
      data: { tripDayId: day.id, name: "Lost Ticket Hotel" },
    });

    const documentUrl = `/uploads/trips/${trip.id}/days/${day.id}/accommodations/${accommodation.id}/documents/doc-gone.pdf`;
    await prisma.accommodationDocument.create({
      data: { accommodationId: accommodation.id, documentUrl, fileName: "Ticket.pdf", sortOrder: 0 },
    });

    const response = await GET(buildRequest(trip.id, { session: token }), routeContext(trip.id));
    const archive = await readArchive(response);
    const payload = readManifest(archive);

    // A ref has no `documentUrl` to fall back on, so the row vanishes entirely and the warning is
    // the only trace the user gets. That is exactly why the warning has to be there.
    expect(payload.days[0].accommodation?.documents).toEqual([]);
    expect(payload.documents).toEqual({});
    expect(payload.meta.warnings).toHaveLength(1);
    expect(payload.meta.warnings[0]).toContain(documentUrl);
    expect(readZipEntryNames(archive)).toEqual(["trip.json"]);
  });

  it("never reads a document path that escapes the trip's own upload directory", async () => {
    const { user, token } = await createOwner("trip-export-document-traversal@example.com");

    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Document Traversal Trip",
      startDate: "2026-07-22T00:00:00.000Z",
      endDate: "2026-07-22T00:00:00.000Z",
    });
    const [day] = await prisma.tripDay.findMany({ where: { tripId: trip.id } });
    const accommodation = await prisma.accommodation.create({
      data: { tripDayId: day.id, name: "Escaping Hotel" },
    });

    // A real file at the escape target, so a pass would be visible rather than silent. The document
    // pool shares `resolveOwnedMediaPath` with the photo pool precisely so this cannot diverge.
    await writeUploadFile(uploadsRoot, "escape.pdf", "escaped-document-bytes");
    await prisma.accommodationDocument.create({
      data: {
        accommodationId: accommodation.id,
        documentUrl: `/uploads/trips/${trip.id}/../../escape.pdf`,
        fileName: "Escape.pdf",
        sortOrder: 0,
      },
    });

    const response = await GET(buildRequest(trip.id, { session: token }), routeContext(trip.id));
    const archive = await readArchive(response);
    const payload = readManifest(archive);

    expect(response.status).toBe(200);
    expect(payload.days[0].accommodation?.documents).toEqual([]);
    expect(payload.documents).toEqual({});
    expect(readZipEntryNames(archive)).toEqual(["trip.json"]);
    expect(archive.includes(Buffer.from("escaped-document-bytes", "utf8"))).toBe(false);
  });

  it("pools one document file referenced by two rows once, keeping both names", async () => {
    const { user, token } = await createOwner("trip-export-document-dedupe@example.com");

    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Document Dedupe Trip",
      startDate: "2026-07-23T00:00:00.000Z",
      endDate: "2026-07-23T00:00:00.000Z",
    });
    const [day] = await prisma.tripDay.findMany({ where: { tripId: trip.id } });
    const accommodation = await prisma.accommodation.create({
      data: { tripDayId: day.id, name: "Shared Document Hotel" },
    });

    await writeUploadFile(
      getAccommodationDocumentUploadDir(trip.id, day.id, accommodation.id),
      "shared.pdf",
      pdfBytes(),
    );
    const sharedUrl = `/uploads/trips/${trip.id}/days/${day.id}/accommodations/${accommodation.id}/documents/shared.pdf`;
    await prisma.accommodationDocument.createMany({
      data: [
        { accommodationId: accommodation.id, documentUrl: sharedUrl, fileName: "Hinfahrt.pdf", sortOrder: 0 },
        { accommodationId: accommodation.id, documentUrl: sharedUrl, fileName: "Rueckfahrt.pdf", sortOrder: 1 },
      ],
    });

    const response = await GET(buildRequest(trip.id, { session: token }), routeContext(trip.id));
    const archive = await readArchive(response);
    const payload = readManifest(archive);

    // One file, one member - and two names, which is why `fileName` is on the ref and not on the
    // pool entry: a pool entry has nowhere to put a second one.
    expect(Object.keys(payload.documents)).toEqual(["d1"]);
    expect(readZipEntryNames(archive)).toEqual(["trip.json", "documents/d1.pdf"]);
    expect(payload.days[0].accommodation?.documents).toEqual([
      { sortOrder: 0, documentId: "d1", fileName: "Hinfahrt.pdf" },
      { sortOrder: 1, documentId: "d1", fileName: "Rueckfahrt.pdf" },
    ]);
  });

  it("produces byte-identical archives for two exports of an unchanged trip", async () => {
    const { user, token } = await createOwner("trip-export-deterministic@example.com");

    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Deterministic Trip",
      startDate: "2026-08-01T00:00:00.000Z",
      endDate: "2026-08-01T00:00:00.000Z",
    });
    const [day] = await prisma.tripDay.findMany({ where: { tripId: trip.id } });
    const accommodation = await prisma.accommodation.create({
      data: { tripDayId: day.id, name: "Stable Hotel" },
    });
    await writeUploadFile(
      getAccommodationImageUploadDir(trip.id, day.id, accommodation.id),
      "stay.jpg",
      "stay-bytes"
    );
    await prisma.accommodationImage.create({
      data: {
        accommodationId: accommodation.id,
        imageUrl: `/uploads/trips/${trip.id}/days/${day.id}/accommodations/${accommodation.id}/stay.jpg`,
        sortOrder: 0,
      },
    });
    // A document too, since Story 9.1: byte-identity has to hold over the *whole* archive, and a
    // fixture with no documents would leave the new pool and the new members outside the property.
    await writeUploadFile(
      getAccommodationDocumentUploadDir(trip.id, day.id, accommodation.id),
      "stay.pdf",
      pdfBytes(),
    );
    await prisma.accommodationDocument.create({
      data: {
        accommodationId: accommodation.id,
        documentUrl: `/uploads/trips/${trip.id}/days/${day.id}/accommodations/${accommodation.id}/documents/stay.pdf`,
        fileName: "Buchung.pdf",
        sortOrder: 0,
      },
    });

    const first = await readArchive(await GET(buildRequest(trip.id, { session: token }), routeContext(trip.id)));
    const second = await readArchive(await GET(buildRequest(trip.id, { session: token }), routeContext(trip.id)));

    expect(readZipEntryNames(first)).toEqual(["trip.json", "photos/p1.jpg", "documents/d1.pdf"]);
    expect(Buffer.compare(first, second)).toBe(0);
  });

  it("derives every archive timestamp from trip.updatedAt rather than the wall clock", async () => {
    const { user, token } = await createOwner("trip-export-timestamps@example.com");

    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Timestamped Trip",
      startDate: "2026-08-01T00:00:00.000Z",
      endDate: "2026-08-01T00:00:00.000Z",
    });

    // Byte-identity alone cannot catch a `new Date()` regression: DOS timestamps have two-second
    // resolution, so two back-to-back exports stay identical even with the clock wired in. Pinning
    // `updatedAt` to a date that is not today is what makes this assertion fail on that mutation.
    const pinnedUpdatedAt = new Date("2021-03-04T05:06:08.000Z");
    await prisma.trip.update({ where: { id: trip.id }, data: { updatedAt: pinnedUpdatedAt } });

    const archive = await readArchive(
      await GET(buildRequest(trip.id, { session: token }), routeContext(trip.id)),
    );
    const parsed = readZipArchive(archive);
    const expected = toDosDateTime(pinnedUpdatedAt);

    expect(expected.dosDate).not.toBe(toDosDateTime(new Date()).dosDate);
    expect(parsed.entries).not.toHaveLength(0);
    for (const entry of parsed.entries) {
      expect({ dosTime: entry.dosTime, dosDate: entry.dosDate }).toEqual(expected);
    }
  });

  it("rejects unauthenticated export requests", async () => {
    const response = await GET(buildRequest("missing-trip"), routeContext("missing-trip"));
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(401);
    expect(payload.data).toBeNull();
    expect(payload.error?.code).toBe("unauthorized");
  });

  it("blocks flagged sessions from exporting trips", async () => {
    const user = await prisma.user.create({
      data: {
        email: "trip-export-flagged@example.com",
        passwordHash: "hashed",
        role: "VIEWER",
        mustChangePassword: true,
      },
    });
    const token = await createSessionJwt({ sub: user.id, role: user.role, mustChangePassword: true });

    const { trip } = await createTripWithDays({
      userId: user.id,
      name: "Blocked Export Trip",
      startDate: "2026-11-10T00:00:00.000Z",
      endDate: "2026-11-11T00:00:00.000Z",
    });

    const response = await GET(buildRequest(trip.id, { session: token }), routeContext(trip.id));
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(403);
    expect(payload.data).toBeNull();
    expect(payload.error?.code).toBe("password_change_required");
  });

  it("returns 404 for non-owned or missing trips", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "trip-export-owner@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });
    const other = await prisma.user.create({
      data: {
        email: "trip-export-other@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });
    const otherToken = await createSessionJwt({ sub: other.id, role: other.role });

    const { trip } = await createTripWithDays({
      userId: owner.id,
      name: "Private Trip",
      startDate: "2026-10-01T00:00:00.000Z",
      endDate: "2026-10-02T00:00:00.000Z",
    });

    const response = await GET(buildRequest(trip.id, { session: otherToken }), routeContext(trip.id));
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(404);
    expect(payload.error?.code).toBe("not_found");
  });

  it("rejects invalid session token", async () => {
    const response = await GET(buildRequest("trip-1", { session: "not-a-valid-jwt" }), routeContext("trip-1"));
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(401);
    expect(payload.error?.code).toBe("unauthorized");
  });

  it("sanitizes export filename to prevent header injection", async () => {
    const user = await prisma.user.create({
      data: {
        email: "trip-export-filename@example.com",
        passwordHash: "hashed",
        role: "OWNER",
      },
    });
    const token = await createSessionJwt({ sub: user.id, role: user.role });

    const { trip } = await createTripWithDays({
      userId: user.id,
      name: 'Trip "\r\nInjected',
      startDate: "2026-11-01T00:00:00.000Z",
      endDate: "2026-11-01T00:00:00.000Z",
    });

    const response = await GET(buildRequest(trip.id, { session: token }), routeContext(trip.id));
    const contentDisposition = response.headers.get("content-disposition");

    expect(response.status).toBe(200);
    expect(contentDisposition).toMatch(/^attachment; filename="trip-trip-injected-\d{4}-\d{2}-\d{2}\.zip"$/);
    expect(contentDisposition).not.toContain("\r");
    expect(contentDisposition).not.toContain("\n");
  });
  /**
   * Story 5.13, AC2/AC4/AC6. The export moved to owner-or-contributor because a contributor can already
   * read every stay, activity, photo and document the archive contains - it changes the container, not
   * the exposure. The whole archive hangs off `getTripExportForUser`'s single root query, so the
   * manifest is read here rather than only the status: a 200 carrying an empty or wrong-trip archive
   * would mean the route gate moved and the repository scope did not.
   *
   * The contributor's account row is `role: "VIEWER"` on purpose: the route must decide on
   * `TripMember.role` and never on `User.role`.
   */
  it("exports the archive for a contributor, refuses a viewer 403 forbidden and a non-participant 404", async () => {
    const { user: owner } = await createOwner("trip-export-roles-owner@example.com");
    const contributor = await prisma.user.create({
      data: { email: "trip-export-roles-contributor@example.com", passwordHash: "hashed", role: "VIEWER" },
    });
    const contributorToken = await createSessionJwt({ sub: contributor.id, role: contributor.role });
    const viewer = await prisma.user.create({
      data: { email: "trip-export-roles-viewer@example.com", passwordHash: "hashed", role: "VIEWER" },
    });
    const viewerToken = await createSessionJwt({ sub: viewer.id, role: viewer.role });
    const { token: strangerToken } = await createOwner("trip-export-roles-stranger@example.com");

    const { trip } = await createTripWithDays({
      userId: owner.id,
      name: "Shared Export Trip",
      startDate: "2026-11-01T00:00:00.000Z",
      endDate: "2026-11-02T00:00:00.000Z",
    });
    const [day1] = await prisma.tripDay.findMany({ where: { tripId: trip.id }, orderBy: { dayIndex: "asc" } });
    await prisma.accommodation.create({ data: { tripDayId: day1.id, name: "Shared Hotel", status: "BOOKED" } });
    await prisma.tripBucketListItem.create({ data: { tripId: trip.id, title: "Shared idea" } });
    await prisma.tripMember.create({ data: { tripId: trip.id, userId: contributor.id, role: "CONTRIBUTOR" } });
    await prisma.tripMember.create({ data: { tripId: trip.id, userId: viewer.id, role: "VIEWER" } });

    const contributorResponse = await GET(
      buildRequest(trip.id, { session: contributorToken }),
      routeContext(trip.id),
    );
    expect(contributorResponse.status).toBe(200);
    expect(contributorResponse.headers.get("content-type")).toBe("application/zip");

    const manifest = readManifest(await readArchive(contributorResponse));
    expect(manifest.trip.id).toBe(trip.id);
    expect(manifest.trip.name).toBe("Shared Export Trip");
    expect(manifest.days).toHaveLength(2);
    // The whole archive hangs off one root query, so a stay and an idea reached through two different
    // includes are what say the root resolved to this trip rather than to an empty result.
    expect(manifest.days[0].accommodation?.id).toBeTruthy();
    expect(manifest.trip.bucketListItems.map((entry) => entry.title)).toEqual(["Shared idea"]);

    const viewerResponse = await GET(buildRequest(trip.id, { session: viewerToken }), routeContext(trip.id));
    expect(viewerResponse.status).toBe(403);
    expect(((await viewerResponse.json()) as { error: { code: string } | null }).error?.code).toBe("forbidden");

    const strangerResponse = await GET(buildRequest(trip.id, { session: strangerToken }), routeContext(trip.id));
    expect(strangerResponse.status).toBe(404);
    expect(((await strangerResponse.json()) as { error: { code: string } | null }).error?.code).toBe("not_found");
  });
});
