import { beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import {
  discardStashedTripUploadDir,
  ImportPhotoWriteError,
  planAccommodationGalleryPhoto,
  planDayPlanItemGalleryPhoto,
  planTripDayPhoto,
  planTripHeroPhoto,
  restoreStashedTripUploadDir,
  stashTripUploadDir,
  writeImportedPhotos,
} from "@/lib/trips/importPhotos";
import { getPublicRoot, getTripUploadDir, getTripsUploadRoot } from "@/lib/trips/uploadPaths";
import { jpegBytes, pngBytes, webpBytes, writeUploadFile } from "./helpers/uploadFixtures";

const exists = async (filePath: string) =>
  fs
    .stat(filePath)
    .then(() => true)
    .catch(() => false);

describe("importPhotos", () => {
  const uploadsRoot = getTripsUploadRoot();

  beforeEach(async () => {
    await fs.rm(uploadsRoot, { recursive: true, force: true });
  });

  it("places every photo kind under UPLOADS_PUBLIC_ROOT with the upload routes' own urls", () => {
    const takenFileNames = new Set<string>();
    const hero = planTripHeroPhoto("trip-1", "image/jpeg");
    const dayImage = planTripDayPhoto("trip-1", "day-1", "image/png");
    const stay = planAccommodationGalleryPhoto(
      { tripId: "trip-1", tripDayId: "day-1", accommodationId: "stay-1", contentType: "image/webp" },
      takenFileNames,
    );
    const activity = planDayPlanItemGalleryPhoto(
      { tripId: "trip-1", tripDayId: "day-1", dayPlanItemId: "item-1", contentType: "image/jpeg" },
      takenFileNames,
    );

    // Every path resolves through the helpers, so the redirected test root is what they land in -
    // this is the assertion that stops a future edit rebuilding a path from `process.cwd()`.
    for (const placement of [hero, dayImage, stay, activity]) {
      expect(placement.filePath.startsWith(getPublicRoot())).toBe(true);
      expect(path.join(getPublicRoot(), placement.imageUrl.replace(/^\/+/, ""))).toBe(placement.filePath);
    }

    expect(hero.imageUrl).toBe("/uploads/trips/trip-1/hero.jpg");
    expect(dayImage.imageUrl).toBe("/uploads/trips/trip-1/days/day-1/day.png");
    expect(stay.imageUrl).toMatch(
      /^\/uploads\/trips\/trip-1\/days\/day-1\/accommodations\/stay-1\/img-\d+-[a-z0-9]{1,8}\.webp$/,
    );
    expect(activity.imageUrl).toMatch(
      /^\/uploads\/trips\/trip-1\/days\/day-1\/day-plan-items\/item-1\/img-\d+-[a-z0-9]{1,8}\.jpg$/,
    );
  });

  it("derives the file name from the content type only, so a package name cannot escape the trip", () => {
    const takenFileNames = new Set<string>();
    const placement = planAccommodationGalleryPhoto(
      { tripId: "trip-1", tripDayId: "day-1", accommodationId: "stay-1", contentType: "image/png" },
      takenFileNames,
    );

    // Nothing in the signature accepts a name at all: the archive member path is only ever used to
    // look bytes up in a Map, never to build a path.
    expect(path.basename(placement.filePath)).toMatch(/^img-\d+-[a-z0-9]{1,8}\.png$/);
    expect(placement.filePath.startsWith(`${getTripUploadDir("trip-1")}${path.sep}`)).toBe(true);
    expect(placement.filePath).not.toContain("..");
  });

  it("never reuses a file name inside one import, where Date.now() does not move", () => {
    const takenFileNames = new Set<string>();
    const names = Array.from({ length: 25 }, () =>
      path.basename(
        planAccommodationGalleryPhoto(
          { tripId: "trip-1", tripDayId: "day-1", accommodationId: "stay-1", contentType: "image/jpeg" },
          takenFileNames,
        ).filePath,
      ),
    );

    expect(new Set(names).size).toBe(names.length);
  });

  it("rejects a content type outside the upload allow-list", () => {
    expect(() => planTripHeroPhoto("trip-1", "image/gif")).toThrow(ImportPhotoWriteError);
  });

  it("writes every planned photo to disk", async () => {
    const takenFileNames = new Set<string>();
    const hero = planTripHeroPhoto("trip-write", "image/jpeg");
    const gallery = planAccommodationGalleryPhoto(
      { tripId: "trip-write", tripDayId: "day-1", accommodationId: "stay-1", contentType: "image/png" },
      takenFileNames,
    );

    const written = await writeImportedPhotos(
      [
        { filePath: hero.filePath, archivePath: "photos/p1.jpg" },
        { filePath: gallery.filePath, archivePath: "photos/p2.png" },
      ],
      new Map([
        ["photos/p1.jpg", jpegBytes()],
        ["photos/p2.png", pngBytes()],
      ]),
    );

    expect(written).toHaveLength(2);
    expect(await fs.readFile(hero.filePath)).toEqual(jpegBytes());
    expect(await fs.readFile(gallery.filePath)).toEqual(pngBytes());
  });

  it("removes every file it already wrote when a later write fails", async () => {
    const takenFileNames = new Set<string>();
    const first = planTripHeroPhoto("trip-partial", "image/jpeg");
    const second = planTripDayPhoto("trip-partial", "day-1", "image/webp");
    const third = planAccommodationGalleryPhoto(
      { tripId: "trip-partial", tripDayId: "day-1", accommodationId: "stay-1", contentType: "image/png" },
      takenFileNames,
    );

    await expect(
      writeImportedPhotos(
        [
          { filePath: first.filePath, archivePath: "photos/p1.jpg" },
          { filePath: second.filePath, archivePath: "photos/p2.webp" },
          // No bytes for this one - the failure lands after two files are already on disk.
          { filePath: third.filePath, archivePath: "photos/missing.png" },
        ],
        new Map([
          ["photos/p1.jpg", jpegBytes()],
          ["photos/p2.webp", webpBytes()],
        ]),
      ),
    ).rejects.toBeInstanceOf(ImportPhotoWriteError);

    expect(await exists(first.filePath)).toBe(false);
    expect(await exists(second.filePath)).toBe(false);
    expect(await exists(third.filePath)).toBe(false);
  });

  it("moves an overwrite target's upload directory aside and only deletes it on success", async () => {
    const tripDir = getTripUploadDir("trip-overwrite");
    await writeUploadFile(tripDir, "hero.jpg", jpegBytes());

    const stash = await stashTripUploadDir("trip-overwrite");

    expect(stash).not.toBeNull();
    // The old directory is gone from its real location but still recoverable.
    expect(await exists(path.join(tripDir, "hero.jpg"))).toBe(false);
    expect(await exists(path.join(stash!.stashDir, "hero.jpg"))).toBe(true);

    await discardStashedTripUploadDir(stash);

    expect(await exists(stash!.stashDir)).toBe(false);
  });

  it("puts the previous upload directory back when the write phase fails", async () => {
    const tripDir = getTripUploadDir("trip-restore");
    await writeUploadFile(tripDir, "hero.jpg", jpegBytes());
    await writeUploadFile(path.join(tripDir, "days", "day-1"), "day.png", pngBytes());

    const stash = await stashTripUploadDir("trip-restore");
    // A partially written replacement, exactly what a failed write phase leaves behind.
    await writeUploadFile(tripDir, "hero.png", pngBytes());

    await restoreStashedTripUploadDir(stash);

    expect(await fs.readFile(path.join(tripDir, "hero.jpg"))).toEqual(jpegBytes());
    expect(await exists(path.join(tripDir, "days", "day-1", "day.png"))).toBe(true);
    expect(await exists(path.join(tripDir, "hero.png"))).toBe(false);
    expect(await exists(stash!.stashDir)).toBe(false);
  });

  it("treats a trip with no upload directory as nothing to stash", async () => {
    expect(await stashTripUploadDir("trip-never-had-photos")).toBeNull();
    // The no-op helpers must tolerate that null rather than making every caller branch.
    await expect(discardStashedTripUploadDir(null)).resolves.toBeUndefined();
    await expect(restoreStashedTripUploadDir(null)).resolves.toBeUndefined();
  });
});
