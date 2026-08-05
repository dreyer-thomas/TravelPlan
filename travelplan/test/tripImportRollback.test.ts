import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db/prisma";
import { createTripWithDays, importTripFromExportForUser } from "@/lib/repositories/tripRepo";
import { getTripUploadDir, getTripsUploadRoot } from "@/lib/trips/uploadPaths";
import type { TripImportPayloadInput } from "@/lib/validation/tripImportSchemas";
import { jpegBytes, pdfBytes, writeUploadFile } from "./helpers/uploadFixtures";

/**
 * The post-commit disk phase, driven by a write that always fails.
 *
 * Its own file because the only honest way to reach that branch is to make `writeImportedPhotos`
 * throw, and `vi.mock` is per-module for the whole file - mocking it inside `tripRepo.test.ts`
 * would take the successful photo restores down with it.
 *
 * What is under test is the *rollback*, and specifically which of the two rollbacks runs. Overwrite
 * must never delete: the transaction has already replaced the target's rows, so deleting it
 * destroys the trip the user was replacing instead of leaving it recoverable by re-importing.
 */
const failingWrite = vi.hoisted(() => vi.fn());
const failingDiscard = vi.hoisted(() => vi.fn());
/**
 * The real writer, kept reachable from inside a test.
 *
 * The document case below has to write the photo half *for real* and then fail, which is what makes
 * it a test of the rollback rather than of the mock: the files the failed attempt left on disk are
 * only interesting if something actually put them there.
 */
const realImportPhotos = vi.hoisted(
  () => ({ current: null }) as { current: typeof import("@/lib/trips/importPhotos") | null },
);

vi.mock("@/lib/trips/importPhotos", async () => {
  const actual = await vi.importActual<typeof import("@/lib/trips/importPhotos")>(
    "@/lib/trips/importPhotos",
  );
  realImportPhotos.current = actual;
  return {
    ...actual,
    writeImportedPhotos: (...args: unknown[]) => failingWrite(...args),
    discardStashedTripUploadDir: (...args: unknown[]) => failingDiscard(...args),
  };
});

const STAMP = "2026-02-14T12:00:00.000Z";

/** One pooled hero photo, so there is always at least one planned write to fail. */
const PAYLOAD: TripImportPayloadInput = {
  meta: { exportedAt: STAMP, appVersion: "0.1.0", formatVersion: 2, warnings: [] },
  photos: { p1: { contentType: "image/jpeg", archivePath: "photos/p1.jpg" } },
  documents: {},
  trip: {
    id: "source-trip",
    name: "Rollback Trip",
    startDate: "2026-12-01T00:00:00.000Z",
    endDate: "2026-12-01T00:00:00.000Z",
    heroImageUrl: null,
    heroPhotoId: "p1",
    createdAt: STAMP,
    updatedAt: STAMP,
    bucketListItems: [{ id: "b1", title: "Survive the rollback", description: null, positionText: null, location: null }],
  },
  days: [
    {
      id: "source-day-1",
      date: "2026-12-01T00:00:00.000Z",
      dayIndex: 1,
      imageUrl: null,
      imagePhotoId: null,
      note: "Restored note",
      createdAt: STAMP,
      updatedAt: STAMP,
      accommodation: null,
      dayPlanItems: [],
      travelSegments: [],
    },
  ],
};

const photoBytes = () => new Map([["photos/p1.jpg", jpegBytes()]]);

/**
 * `PAYLOAD` plus a stay carrying one document, for the Story 9.1 half of this file.
 *
 * The rollback was never taught about documents and did not need to be: they live inside the trip's
 * own upload directory, so `stashTripUploadDir` / `restoreStashedTripUploadDir` already move them
 * with everything else. That claim is the thing being tested - by round trip, not by inspection.
 */
const DOCUMENT_PAYLOAD: TripImportPayloadInput = {
  ...PAYLOAD,
  documents: { d1: { contentType: "application/pdf", archivePath: "documents/d1.pdf" } },
  days: [
    {
      ...PAYLOAD.days[0],
      accommodation: {
        id: "source-stay-1",
        name: "Rollback Inn",
        notes: null,
        status: "planned",
        costCents: null,
        link: null,
        checkInTime: null,
        checkOutTime: null,
        location: null,
        createdAt: STAMP,
        updatedAt: STAMP,
        images: [],
        documents: [{ sortOrder: 0, documentId: "d1", fileName: "Restored Ticket.pdf" }],
      },
    },
  ],
};

const documentBytes = () => new Map([["documents/d1.pdf", pdfBytes()]]);

/**
 * Writes the photo half for real, then fails - i.e. the disk phase falls over on the documents.
 *
 * The returned record is what makes the test falsifiable. A mock that simply threw would produce the
 * same green result whether or not the import planned a single document write, so what it *saw* is
 * asserted afterwards, outside the mock, where a failed expectation cannot be swallowed by the very
 * error path under test.
 */
const failOnDocumentWrites = () => {
  const seen: { photoWrites: string[]; documentWrites: string[] } = { photoWrites: [], documentWrites: [] };

  failingWrite.mockImplementation(async (writes: PlannedWrite[], bytes: Parameters<WriteImportedPhotos>[1]) => {
    seen.photoWrites = writes.filter((write) => write.archivePath.startsWith("photos/")).map((w) => w.filePath);
    seen.documentWrites = writes
      .filter((write) => write.archivePath.startsWith("documents/"))
      .map((write) => write.filePath);
    await realImportPhotos.current!.writeImportedPhotos(
      writes.filter((write) => write.archivePath.startsWith("photos/")),
      bytes,
    );
    throw new Error("the document write failed");
  });

  return seen;
};

type WriteImportedPhotos = typeof import("@/lib/trips/importPhotos").writeImportedPhotos;
type PlannedWrite = Parameters<WriteImportedPhotos>[0][number];

const exists = async (filePath: string) =>
  fs
    .stat(filePath)
    .then(() => true)
    .catch(() => false);

describe("import photo-write rollback", () => {
  const uploadsRoot = getTripsUploadRoot();

  beforeEach(async () => {
    await prisma.accommodationDocument.deleteMany();
    await prisma.dayPlanItemDocument.deleteMany();
    await prisma.dayPlanItem.deleteMany();
    await prisma.accommodation.deleteMany();
    await prisma.tripDay.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
    await fs.rm(uploadsRoot, { recursive: true, force: true });

    failingWrite.mockReset();
    failingWrite.mockRejectedValue(new Error("disk went away"));
    failingDiscard.mockReset();
    failingDiscard.mockResolvedValue(undefined);
  });

  const createOwner = (email: string) =>
    prisma.user.create({ data: { email, passwordHash: "hashed", role: "OWNER" } });

  it("keeps an overwritten trip whose target never had an upload directory", async () => {
    const user = await createOwner("import-rollback-no-upload-dir@example.com");
    const target = await createTripWithDays({
      userId: user.id,
      name: PAYLOAD.trip.name,
      startDate: "2026-10-10T00:00:00.000Z",
      endDate: "2026-10-11T00:00:00.000Z",
    });

    // The whole point: a trip that never had a photo has no upload directory, so
    // `stashTripUploadDir` returns `null` for it. The rollback used to read that null as
    // "create-new" and delete the user's trip.
    expect(await exists(getTripUploadDir(target.trip.id))).toBe(false);

    await expect(
      importTripFromExportForUser({
        userId: user.id,
        payload: PAYLOAD,
        strategy: "overwrite",
        targetTripId: target.trip.id,
        photoBytes: photoBytes(),
      }),
    ).rejects.toThrow("photo_write_failed");

    const survivor = await prisma.trip.findUnique({ where: { id: target.trip.id } });
    expect(survivor).not.toBeNull();
    // The committed rows are the *restored* ones - the transaction succeeded, only the disk failed.
    expect(survivor?.name).toBe("Rollback Trip");
    const days = await prisma.tripDay.findMany({ where: { tripId: target.trip.id } });
    expect(days).toHaveLength(1);
    expect(days[0].note).toBe("Restored note");
    expect(await prisma.tripBucketListItem.count({ where: { tripId: target.trip.id } })).toBe(1);
  });

  it("puts a stashed upload directory back when the target did have one", async () => {
    const user = await createOwner("import-rollback-with-upload-dir@example.com");
    const target = await createTripWithDays({
      userId: user.id,
      name: PAYLOAD.trip.name,
      startDate: "2026-10-10T00:00:00.000Z",
      endDate: "2026-10-11T00:00:00.000Z",
    });
    await writeUploadFile(getTripUploadDir(target.trip.id), "hero.jpg", jpegBytes());

    await expect(
      importTripFromExportForUser({
        userId: user.id,
        payload: PAYLOAD,
        strategy: "overwrite",
        targetTripId: target.trip.id,
        photoBytes: photoBytes(),
      }),
    ).rejects.toThrow("photo_write_failed");

    expect(await prisma.trip.count({ where: { id: target.trip.id } })).toBe(1);
    expect(await fs.readFile(path.join(getTripUploadDir(target.trip.id), "hero.jpg"))).toEqual(jpegBytes());
    expect((await fs.readdir(uploadsRoot)).filter((entry) => entry.includes(".import-"))).toEqual([]);
  });

  it("still reports photo_write_failed when the restore itself fails", async () => {
    const user = await createOwner("import-rollback-restore-fails@example.com");
    const target = await createTripWithDays({
      userId: user.id,
      name: PAYLOAD.trip.name,
      startDate: "2026-10-10T00:00:00.000Z",
      endDate: "2026-10-11T00:00:00.000Z",
    });
    await writeUploadFile(getTripUploadDir(target.trip.id), "hero.jpg", jpegBytes());

    // Deleting the stash out from under the restore is the cheapest stand-in for the real cases -
    // a held handle, a scanner. Whatever it is, it must not replace the error that actually
    // explains the failure.
    failingWrite.mockImplementation(async () => {
      const stash = (await fs.readdir(uploadsRoot)).find((entry) => entry.includes(".import-"));
      if (stash) await fs.rm(path.join(uploadsRoot, stash), { recursive: true, force: true });
      throw new Error("disk went away");
    });

    await expect(
      importTripFromExportForUser({
        userId: user.id,
        payload: PAYLOAD,
        strategy: "overwrite",
        targetTripId: target.trip.id,
        photoBytes: photoBytes(),
      }),
    ).rejects.toThrow("photo_write_failed");

    expect(await prisma.trip.count({ where: { id: target.trip.id } })).toBe(1);
  });

  it("deletes the trip it just created when create-new fails, because it owns everything", async () => {
    const user = await createOwner("import-rollback-create-new@example.com");

    await expect(
      importTripFromExportForUser({
        userId: user.id,
        payload: PAYLOAD,
        strategy: "createNew",
        photoBytes: photoBytes(),
      }),
    ).rejects.toThrow("photo_write_failed");

    expect(await prisma.trip.count()).toBe(0);
    expect(await prisma.tripDay.count()).toBe(0);
    expect(await prisma.tripBucketListItem.count()).toBe(0);
  });

  /**
   * Story 9.1: the disk phase fails on the *document* half, and everything the trip had before comes
   * back - the photo the failed attempt overwrote, and the document nested three directories deep.
   *
   * Nothing in the rollback names documents. That is the point: they are inside the trip's upload
   * directory, so the stash already covers them, and the only honest way to know is to fail an import
   * that has both kinds and look at what is on disk afterwards.
   */
  it("restores a previous trip's documents when the document half of the disk phase fails", async () => {
    const user = await createOwner("import-rollback-documents@example.com");
    const target = await createTripWithDays({
      userId: user.id,
      name: DOCUMENT_PAYLOAD.trip.name,
      startDate: "2026-10-10T00:00:00.000Z",
      endDate: "2026-10-11T00:00:00.000Z",
    });

    // The previous state: a hero photo with distinguishable bytes, and a document sitting where the
    // upload routes put one - inside the entry's own `documents/` subdirectory.
    const tripDir = getTripUploadDir(target.trip.id);
    const previousHero = jpegBytes(128);
    const previousDocument = pdfBytes(96);
    const previousDocumentDir = path.join(tripDir, "days", "old-day", "accommodations", "old-stay", "documents");
    await writeUploadFile(tripDir, "hero.jpg", previousHero);
    await writeUploadFile(previousDocumentDir, "doc-previous.pdf", previousDocument);

    const seen = failOnDocumentWrites();

    await expect(
      importTripFromExportForUser({
        userId: user.id,
        payload: DOCUMENT_PAYLOAD,
        strategy: "overwrite",
        targetTripId: target.trip.id,
        photoBytes: photoBytes(),
        documentBytes: documentBytes(),
      }),
    ).rejects.toThrow("photo_write_failed");

    // The disk phase really did have both halves to do, and really did write the photo one: without
    // this the case below would be green for an import that planned no document at all.
    expect(seen.photoWrites).toHaveLength(1);
    expect(seen.documentWrites).toHaveLength(1);
    expect(seen.documentWrites[0]).toContain(`${path.sep}documents${path.sep}`);
    expect(path.basename(seen.documentWrites[0])).toMatch(/^doc-\d+-[a-z0-9]{1,8}\.pdf$/);

    // Overwrite never deletes the trip, whatever failed.
    expect(await prisma.trip.count({ where: { id: target.trip.id } })).toBe(1);

    // The previous document is back, byte for byte, at the path it was at.
    expect(await fs.readFile(path.join(previousDocumentDir, "doc-previous.pdf"))).toEqual(previousDocument);
    // ...and so is the photo, which the failed attempt really did overwrite: `planTripHeroPhoto`
    // writes the fixed name `hero.jpg`, so a rollback that only removed *new* files would have left
    // the payload's hero bytes sitting under the old name.
    expect(await fs.readFile(path.join(tripDir, "hero.jpg"))).toEqual(previousHero);
    expect(await fs.readFile(path.join(tripDir, "hero.jpg"))).not.toEqual(jpegBytes());

    // Nothing the failed attempt created survived, and no stash was left behind.
    const restoredDays = await fs.readdir(path.join(tripDir, "days"));
    expect(restoredDays).toEqual(["old-day"]);
    expect((await fs.readdir(uploadsRoot)).filter((entry) => entry.includes(".import-"))).toEqual([]);
  });

  it("leaves no document behind when create-new fails on the document half", async () => {
    const user = await createOwner("import-rollback-documents-create-new@example.com");

    const seen = failOnDocumentWrites();

    await expect(
      importTripFromExportForUser({
        userId: user.id,
        payload: DOCUMENT_PAYLOAD,
        strategy: "createNew",
        photoBytes: photoBytes(),
        documentBytes: documentBytes(),
      }),
    ).rejects.toThrow("photo_write_failed");

    // Create-new owns everything it made, so the whole trip directory goes - the photo the failed
    // attempt genuinely wrote included, and with it any document directory it had created.
    expect(seen.documentWrites).toHaveLength(1);
    expect(await prisma.trip.count()).toBe(0);
    expect(await prisma.accommodationDocument.count()).toBe(0);
    expect(await fs.readdir(uploadsRoot).catch(() => [])).toEqual([]);
  });

  it("reports success even when clearing the stash afterwards fails", async () => {
    const user = await createOwner("import-rollback-discard-fails@example.com");
    const target = await createTripWithDays({
      userId: user.id,
      name: PAYLOAD.trip.name,
      startDate: "2026-10-10T00:00:00.000Z",
      endDate: "2026-10-11T00:00:00.000Z",
    });
    await writeUploadFile(getTripUploadDir(target.trip.id), "hero.jpg", jpegBytes());

    // Every photo landed; only the tidy-up of the replaced directory failed. Reporting that as a
    // 500 would send the user to re-import against a trip that restored perfectly, straight into a
    // name conflict.
    failingWrite.mockResolvedValue([]);
    failingDiscard.mockRejectedValue(new Error("EBUSY: file is locked"));

    const result = await importTripFromExportForUser({
      userId: user.id,
      payload: PAYLOAD,
      strategy: "overwrite",
      targetTripId: target.trip.id,
      photoBytes: photoBytes(),
    });

    expect(result.outcome).toBe("imported");
    if (result.outcome !== "imported") return;
    expect(result.mode).toBe("overwrite");
    expect(result.trip.id).toBe(target.trip.id);
  });
});
