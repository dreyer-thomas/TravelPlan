import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import {
  acquireTripImportLock,
  discardStashedTripUploadDir,
  ImportPhotoWriteError,
  IMPORT_LOCK_STALE_MS,
  planAccommodationDocument,
  planAccommodationGalleryPhoto,
  planDayPlanItemDocument,
  planDayPlanItemGalleryPhoto,
  planTripDayPhoto,
  planTripHeroPhoto,
  releaseTripImportLock,
  restoreStashedTripUploadDir,
  stashTripUploadDir,
  writeImportedPhotos,
  type TripImportLock,
} from "@/lib/trips/importPhotos";
import { getMediaRoot, getTripUploadDir, getTripsUploadRoot } from "@/lib/trips/uploadPaths";
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

  it("places every photo kind under MEDIA_STORAGE_ROOT with the upload routes' own urls", () => {
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
      expect(placement.filePath.startsWith(getMediaRoot())).toBe(true);
      expect(path.join(getMediaRoot(), placement.imageUrl.replace(/^\/+/, ""))).toBe(placement.filePath);
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

  it("places a document in the entry's own documents subdirectory, never beside its photos", () => {
    const takenFileNames = new Set<string>();
    const stay = planAccommodationDocument(
      { tripId: "trip-1", tripDayId: "day-1", accommodationId: "stay-1", contentType: "application/pdf" },
      takenFileNames,
    );
    const activity = planDayPlanItemDocument(
      { tripId: "trip-1", tripDayId: "day-1", dayPlanItemId: "item-1", contentType: "image/png" },
      takenFileNames,
    );

    for (const placement of [stay, activity]) {
      expect(placement.filePath.startsWith(getMediaRoot())).toBe(true);
      expect(path.join(getMediaRoot(), placement.documentUrl.replace(/^\/+/, ""))).toBe(placement.filePath);
    }

    expect(stay.documentUrl).toMatch(
      /^\/uploads\/trips\/trip-1\/days\/day-1\/accommodations\/stay-1\/documents\/doc-\d+-[a-z0-9]{1,8}\.pdf$/,
    );
    expect(activity.documentUrl).toMatch(
      /^\/uploads\/trips\/trip-1\/days\/day-1\/day-plan-items\/item-1\/documents\/doc-\d+-[a-z0-9]{1,8}\.png$/,
    );
  });

  it("takes a document's extension from the sniffed type and its name from nothing at all", () => {
    // The signature accepts no name: the manifest's `fileName` is a column value and cannot reach a
    // path even by accident, because there is no parameter it could arrive through.
    const placement = planAccommodationDocument(
      { tripId: "trip-1", tripDayId: "day-1", accommodationId: "stay-1", contentType: "image/webp" },
      new Set<string>(),
    );

    expect(path.basename(placement.filePath)).toMatch(/^doc-\d+-[a-z0-9]{1,8}\.webp$/);
    expect(placement.filePath.startsWith(`${getTripUploadDir("trip-1")}${path.sep}`)).toBe(true);
    expect(placement.filePath).not.toContain("..");
  });

  it("never reuses a document name inside one import, where Date.now() does not move", () => {
    const takenFileNames = new Set<string>();
    const names = Array.from({ length: 25 }, () =>
      path.basename(
        planAccommodationDocument(
          { tripId: "trip-1", tripDayId: "day-1", accommodationId: "stay-1", contentType: "application/pdf" },
          takenFileNames,
        ).filePath,
      ),
    );

    expect(new Set(names).size).toBe(names.length);
  });

  it("shares the taken-name set with the photo planners without colliding with them", () => {
    // One set for both kinds, which is only safe because the two prefixes differ. Asserted rather
    // than assumed: a future edit that dropped one of the prefixes would silently reintroduce the
    // collision the set exists to prevent.
    const takenFileNames = new Set<string>();
    const photo = planAccommodationGalleryPhoto(
      { tripId: "trip-1", tripDayId: "day-1", accommodationId: "stay-1", contentType: "image/png" },
      takenFileNames,
    );
    const document = planAccommodationDocument(
      { tripId: "trip-1", tripDayId: "day-1", accommodationId: "stay-1", contentType: "image/png" },
      takenFileNames,
    );

    expect(path.basename(photo.filePath)).toMatch(/^img-/);
    expect(path.basename(document.filePath)).toMatch(/^doc-/);
    expect(path.dirname(document.filePath)).toBe(path.join(path.dirname(photo.filePath), "documents"));
  });

  it("rejects a document content type outside the two document routes' allow-list", () => {
    expect(() =>
      planAccommodationDocument(
        { tripId: "trip-1", tripDayId: "day-1", accommodationId: "stay-1", contentType: "text/plain" },
        new Set<string>(),
      ),
    ).toThrow(ImportPhotoWriteError);
  });

  it("refuses to place a PDF through the photo planners, which is the separation that matters", () => {
    expect(() =>
      planAccommodationGalleryPhoto(
        { tripId: "trip-1", tripDayId: "day-1", accommodationId: "stay-1", contentType: "application/pdf" },
        new Set<string>(),
      ),
    ).toThrow(ImportPhotoWriteError);
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

  /**
   * Story 8.4 / DW-86. Two overwrite imports of one trip used to interleave over a single directory: both
   * committed, then the second `stashTripUploadDir` moved the *first* one's freshly written files aside
   * as if they were the old ones and the discard deleted them.
   *
   * Unit-level rather than through the route on purpose - the race the lock exists for cannot be provoked
   * reliably through two HTTP calls, whereas "the second acquire is refused" is exactly the property the
   * fix rests on and is directly observable here.
   */
  describe("per-trip import lock", () => {
    it("refuses a second acquire while a fresh lock is held, and releases it again", async () => {
      const lock = await acquireTripImportLock("trip-locked");

      await expect(acquireTripImportLock("trip-locked")).rejects.toThrow("import_in_progress");
      // A different trip is a different sentinel: the lock serialises one trip, not all imports.
      const other = await acquireTripImportLock("trip-locked-other");
      await releaseTripImportLock(other);

      await releaseTripImportLock(lock);
      expect(await exists(lock.lockDir)).toBe(false);

      // And once released, the next import gets it.
      const reacquired = await acquireTripImportLock("trip-locked");
      await releaseTripImportLock(reacquired);
    });

    it("reclaims a lock left behind by a crashed import once it is stale", async () => {
      const lock = await acquireTripImportLock("trip-stale-lock");
      // Backdated rather than waited for: the timeout is fifteen minutes, and the property under test is
      // the comparison against `mtime`, not the clock.
      const stale = new Date(Date.now() - IMPORT_LOCK_STALE_MS - 1_000);
      await fs.utimes(lock.lockDir, stale, stale);

      const reclaimed = await acquireTripImportLock("trip-stale-lock");
      expect(reclaimed.lockDir).toBe(lock.lockDir);
      // Freshly acquired, so it is now the *reclaiming* import's lock and blocks the next caller.
      await expect(acquireTripImportLock("trip-stale-lock")).rejects.toThrow("import_in_progress");

      await releaseTripImportLock(reclaimed);
    });

    it("does not let a holder whose lock was reclaimed remove the reclaimer's", async () => {
      // The reason release carries a nonce at all. Release by path would have the original holder's
      // `finally` delete the *reclaimer's* fresh sentinel on its way out - opening the window for a third
      // import, through the mechanism that exists to prevent a second.
      const original = await acquireTripImportLock("trip-reclaimed");
      const stale = new Date(Date.now() - IMPORT_LOCK_STALE_MS - 1_000);
      await fs.utimes(original.lockDir, stale, stale);

      const reclaimer = await acquireTripImportLock("trip-reclaimed");
      expect(reclaimer.nonce).not.toBe(original.nonce);

      await releaseTripImportLock(original);
      expect(await exists(reclaimer.lockDir)).toBe(true);
      await expect(acquireTripImportLock("trip-reclaimed")).rejects.toThrow("import_in_progress");

      await releaseTripImportLock(reclaimer);
      expect(await exists(reclaimer.lockDir)).toBe(false);
    });

    it("leaves no sentinel behind when the holder nonce cannot be written", async () => {
      // The claim has to be all-or-nothing. A `mkdir` that succeeds and a nonce write that then fails
      // (`ENOSPC`, `EACCES`, `EIO`) used to leave a directory nobody could ever remove: release refuses on
      // a holder file it cannot read, and this caller never received a lock object to release. The trip
      // would answer `409 import_in_progress` for the full staleness window with no import running.
      const outOfSpace = new Error("ENOSPC: no space left on device, write") as Error & { code: string };
      outOfSpace.code = "ENOSPC";
      const writeSpy = vi.spyOn(fs, "writeFile").mockRejectedValue(outOfSpace);

      try {
        await expect(acquireTripImportLock("trip-claim-fails")).rejects.toThrow("ENOSPC");
      } finally {
        writeSpy.mockRestore();
      }

      // The half-made sentinel is gone, so this is an ordinary failed acquire rather than a trip locked
      // out for fifteen minutes...
      expect(await exists(`${getTripUploadDir("trip-claim-fails")}.import-lock`)).toBe(false);
      // ...and the proof of that is that the next import gets the lock straight away.
      const lock = await acquireTripImportLock("trip-claim-fails");
      await releaseTripImportLock(lock);
    });

    it("stops refreshing a sentinel once the claim has been reclaimed", async () => {
      // The heartbeat has to verify the claim, not just the path. Closing over `lockDir` alone means a
      // holder whose stale lock was reclaimed keeps touching the *reclaimer's* sentinel - so the
      // reclaimer's lock is attested alive by a process that does not own it, and if the reclaimer then
      // dies the trip never goes stale and can never be reclaimed again. That is the staleness invariant
      // the heartbeat exists to establish, defeated by the heartbeat.
      vi.useFakeTimers();
      try {
        const original = await acquireTripImportLock("trip-heartbeat");
        const stale = new Date(Date.now() - IMPORT_LOCK_STALE_MS - 1_000);
        await fs.utimes(original.lockDir, stale, stale);

        const reclaimer = await acquireTripImportLock("trip-heartbeat");
        expect(reclaimer.nonce).not.toBe(original.nonce);
        // The reclaimer's own heartbeat is taken out of the picture and its `mtime` pushed back, so any
        // refresh observed below can only be the original holder's.
        clearInterval(reclaimer.heartbeat);
        await fs.utimes(reclaimer.lockDir, stale, stale);

        await vi.advanceTimersByTimeAsync(3 * 60 * 1000);

        const stats = await fs.stat(reclaimer.lockDir);
        expect(Math.abs(stats.mtimeMs - stale.getTime())).toBeLessThan(2_000);

        await releaseTripImportLock(reclaimer);
      } finally {
        vi.useRealTimers();
      }
    });

    it("refreshes the sentinel's mtime while the import it belongs to is still running", async () => {
      // This is the whole of what `IMPORT_LOCK_STALE_MS` is allowed to mean. Fifteen minutes reads "the
      // holding process is gone" *only* because something keeps touching the sentinel while the import
      // runs; measured from acquisition with no refresh it measures import *duration*, and a legitimate
      // import near the 3 GB `MAX_IMPORT_MEDIA_TOTAL_BYTES` ceiling has its lock stolen mid-flight by the
      // mechanism that exists to keep two writers apart.
      //
      // Nothing asserted it until now, and that is the point: replacing the `fs.utimes` call with a no-op
      // left the entire suite green (confirmed by execution during review), so the basis of the timeout
      // was deletable without a single failure - the gap Story 8.3's mutation pass established this
      // project's discipline against.
      //
      // The assertion is behavioural, not just an `mtime` comparison: the sentinel is backdated to one
      // minute short of stale, which is where a long import sits just before its next tick, and after the
      // tick a second acquire must still be refused. Without the refresh that second acquire *reclaims*,
      // which is exactly the AC5 violation.
      vi.useFakeTimers();
      try {
        const lock = await acquireTripImportLock("trip-heartbeat-refresh");
        const nearlyStale = new Date(Date.now() - IMPORT_LOCK_STALE_MS + 60_000);
        await fs.utimes(lock.lockDir, nearlyStale, nearlyStale);

        // One tick of the 60-second heartbeat. Advancing the fake clock only *starts* the callback: it is
        // `async` and does real filesystem work, so the zero-length advances below are what yield real
        // macrotasks for the `readFile`/`utimes` pair to finish on. Bounded, so a heartbeat that never
        // refreshes fails the assertion instead of hanging the suite.
        await vi.advanceTimersByTimeAsync(61_000);
        let mtimeMs = (await fs.stat(lock.lockDir)).mtimeMs;
        for (let attempt = 0; attempt < 50 && mtimeMs <= nearlyStale.getTime(); attempt += 1) {
          await vi.advanceTimersByTimeAsync(0);
          mtimeMs = (await fs.stat(lock.lockDir)).mtimeMs;
        }

        expect(mtimeMs).toBeGreaterThan(nearlyStale.getTime());
        // Refreshed to *now*, so a full staleness window away from reclaimable again rather than merely
        // nudged forward.
        expect(Date.now() - mtimeMs).toBeLessThan(60_000);
        await expect(acquireTripImportLock("trip-heartbeat-refresh")).rejects.toThrow("import_in_progress");

        await releaseTripImportLock(lock);
      } finally {
        vi.useRealTimers();
      }
    });

    it("hands one lock to one caller when two acquires race the same stale sentinel", async () => {
      // Story 8.4 / DW-86 reached *through* the lock. Two callers can both `stat` one stale sentinel and
      // both decide to reclaim it, and the second implementation of the reclaim - a bare `fs.rename` -
      // let both of them end up holding it (confirmed by execution: two concurrent acquires against one
      // stale lock both returned a lock). That is precisely the interleaving of two overwrite imports the
      // lock exists to prevent.
      //
      // Every interleaving must come out the same way, so this asserts the property rather than a
      // sequence: one lock, one `import_in_progress`, and the surviving sentinel belongs to the winner.
      const abandoned = await acquireTripImportLock("trip-reclaim-race");
      // The crashed holder does not keep beating; leaving its interval running would refresh the very
      // `mtime` the race is set up around.
      clearInterval(abandoned.heartbeat);
      const stale = new Date(Date.now() - IMPORT_LOCK_STALE_MS - 1_000);
      await fs.utimes(abandoned.lockDir, stale, stale);

      const results = await Promise.allSettled([
        acquireTripImportLock("trip-reclaim-race"),
        acquireTripImportLock("trip-reclaim-race"),
      ]);

      const held = results.filter(
        (result): result is PromiseFulfilledResult<TripImportLock> => result.status === "fulfilled",
      );
      const refused = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
      expect(held).toHaveLength(1);
      expect(refused).toHaveLength(1);
      expect((refused[0].reason as Error).message).toBe("import_in_progress");

      // The sentinel on disk is the winner's, so the loser neither took it nor destroyed it on the way
      // past - a reclaim that moved the winner's fresh directory aside would have left the holder file
      // saying somebody else.
      const winner = held[0].value;
      expect(await fs.readFile(path.join(winner.lockDir, "holder"), "utf8")).toBe(winner.nonce);

      await releaseTripImportLock(winner);
      expect(await exists(winner.lockDir)).toBe(false);
    });

    it("loses the reclaim when the directory it moved aside is not the one it found stale", async () => {
      // The same race with its timing pinned instead of left to the scheduler, because the ordering that
      // breaks a bare `fs.rename` is one specific one: the winner has already renamed the stale sentinel
      // aside, removed it, recreated the lock and written its own holder *before* the loser's rename runs.
      // The loser then moves the **winner's fresh sentinel** aside and, with nothing checking, claims the
      // lock as well. The concurrent test above cannot be relied on to schedule that ordering, so it is
      // injected here: the winner's whole reclaim happens inside the first `fs.rename` call.
      //
      // What makes the difference is comparing the renamed directory's `ino` against the `ino` of the
      // directory that was found stale. On a mismatch the loser puts back what it moved and reports a lost
      // race, which is the same answer a fresh lock gives.
      const abandoned = await acquireTripImportLock("trip-reclaim-late-rename");
      clearInterval(abandoned.heartbeat);
      const stale = new Date(Date.now() - IMPORT_LOCK_STALE_MS - 1_000);
      await fs.utimes(abandoned.lockDir, stale, stale);

      const realRename = fs.rename.bind(fs);
      const winners: TripImportLock[] = [];
      const renameSpy = vi.spyOn(fs, "rename").mockImplementationOnce(async (from, to) => {
        // The winner, interleaved exactly where review found the hole.
        await fs.rm(String(from), { recursive: true, force: true });
        winners.push(await acquireTripImportLock("trip-reclaim-late-rename"));
        return realRename(from, to);
      });

      try {
        await expect(acquireTripImportLock("trip-reclaim-late-rename")).rejects.toThrow("import_in_progress");
      } finally {
        renameSpy.mockRestore();
      }

      const winner = winners[0];
      expect(winner).toBeDefined();
      clearInterval(winner.heartbeat);
      // Put back, not taken: the winner's holder file is still the winner's...
      expect(await fs.readFile(path.join(winner.lockDir, "holder"), "utf8")).toBe(winner.nonce);
      // ...and the trip is still locked against everybody else, which it would not be if the loser had
      // walked off with a lock of its own.
      await expect(acquireTripImportLock("trip-reclaim-late-rename")).rejects.toThrow("import_in_progress");

      await releaseTripImportLock(winner);
      expect(await exists(winner.lockDir)).toBe(false);
    });

    it("acquires the lock when the stale sentinel is released between the stat and the rename", async () => {
      // Story 8.4, iteration 5. The reclaim's `rename` failing with `ENOENT` is **not** a lost race: it
      // means the stale holder's own release removed the sentinel in the window between the `stat` that
      // found it stale and the `rename` that would move it aside. There is then no lock at all, so the
      // right answer is the retry - exactly what the `stats === null` branch beside it already does for the
      // identical situation observed one step earlier. Reporting `import_in_progress` answers
      // "409 another import is running" when none is, and keeps doing so for every retry the caller makes.
      //
      // Injected rather than raced, because this ordering is a few microseconds wide: the holder's release
      // happens inside the `rename` call itself.
      const abandoned = await acquireTripImportLock("trip-released-mid-reclaim");
      clearInterval(abandoned.heartbeat);
      const stale = new Date(Date.now() - IMPORT_LOCK_STALE_MS - 1_000);
      await fs.utimes(abandoned.lockDir, stale, stale);

      const realRename = fs.rename.bind(fs);
      const renameSpy = vi.spyOn(fs, "rename").mockImplementationOnce(async (from, to) => {
        // The holder's release, landing between this caller's `stat` and its `rename`.
        await fs.rm(String(from), { recursive: true, force: true });
        // Now raises `ENOENT`, which is the whole point of the case.
        return realRename(from, to);
      });

      let acquired;
      try {
        acquired = await acquireTripImportLock("trip-released-mid-reclaim");
      } finally {
        renameSpy.mockRestore();
      }

      expect(acquired.lockDir).toBe(abandoned.lockDir);
      expect(await fs.readFile(path.join(acquired.lockDir, "holder"), "utf8")).toBe(acquired.nonce);
      await releaseTripImportLock(acquired);
      expect(await exists(acquired.lockDir)).toBe(false);
    });

    it("still reclaims a stale sentinel whose holder file is missing", async () => {
      // The one state that must not be permanent. A holder file is missing when a `mkdir` succeeded and
      // the nonce write then failed - and release refuses on a holder it cannot read, while the caller
      // that would have released it never got a lock object at all. If staleness did not still apply
      // here, that trip would refuse imports forever rather than for fifteen minutes. The claim is
      // all-or-nothing now, so this is the belt to that braces: nothing about reclaim may depend on the
      // holder file existing.
      const lock = await acquireTripImportLock("trip-holderless");
      await fs.rm(path.join(lock.lockDir, "holder"), { force: true });

      // Fresh, so it is still respected: a missing holder file is not on its own a reason to steal a lock.
      await expect(acquireTripImportLock("trip-holderless")).rejects.toThrow("import_in_progress");

      const stale = new Date(Date.now() - IMPORT_LOCK_STALE_MS - 1_000);
      await fs.utimes(lock.lockDir, stale, stale);

      const reclaimed = await acquireTripImportLock("trip-holderless");
      expect(reclaimed.lockDir).toBe(lock.lockDir);
      await releaseTripImportLock(reclaimed);
      expect(await exists(reclaimed.lockDir)).toBe(false);
    });

    it("refuses a trip id that is not one safe path segment, and creates nothing", async () => {
      // The id is interpolated straight into a filesystem path. The caller resolves it through the
      // database first, so nothing hostile should arrive - this is the layer that means no future caller
      // can reintroduce the `mkdir` outside the media root the first implementation of this story had.
      await expect(acquireTripImportLock("../escape")).rejects.toThrow("import_lock_unsafe_trip_id");
      await expect(acquireTripImportLock("nested/segment")).rejects.toThrow("import_lock_unsafe_trip_id");
      await expect(acquireTripImportLock("")).rejects.toThrow("import_lock_unsafe_trip_id");

      // Nothing anywhere: not the sentinel it would have made, and not the parent it would have ensured.
      expect(await exists(path.join(getMediaRoot(), "uploads", "escape.import-lock"))).toBe(false);
      expect(await exists(path.join(getTripsUploadRoot(), "nested"))).toBe(false);
      expect(await exists(`${getTripUploadDir("")}.import-lock`)).toBe(false);
    });

    it("treats releasing nothing as a no-op", async () => {
      // The wrapper passes `null` for every create-new import, so this is the ordinary case rather than a
      // defensive one.
      await expect(releaseTripImportLock(null)).resolves.toBeUndefined();
    });
  });
});
