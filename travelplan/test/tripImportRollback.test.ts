import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db/prisma";
import { createTripWithDays, importTripFromExportForUser } from "@/lib/repositories/tripRepo";
import { getTripUploadDir, getTripsUploadRoot } from "@/lib/trips/uploadPaths";
import type { TripImportPayloadInput } from "@/lib/validation/tripImportSchemas";
import { jpegBytes, writeUploadFile } from "./helpers/uploadFixtures";

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

vi.mock("@/lib/trips/importPhotos", async () => {
  const actual = await vi.importActual<typeof import("@/lib/trips/importPhotos")>(
    "@/lib/trips/importPhotos",
  );
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

const exists = async (filePath: string) =>
  fs
    .stat(filePath)
    .then(() => true)
    .catch(() => false);

describe("import photo-write rollback", () => {
  const uploadsRoot = getTripsUploadRoot();

  beforeEach(async () => {
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
