import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fsp from "node:fs/promises";
import path from "node:path";
import { removeManagedMediaFile, storedMediaUrlsNameSameFile } from "@/lib/trips/mediaCleanup";
import {
  getAccommodationImageUploadDir,
  getTripDayUploadDir,
  getTripsUploadRoot,
  getTripUploadDir,
} from "@/lib/trips/uploadPaths";

/**
 * A direct unit suite for the one module that decides whether a media cleanup unlinks anything.
 *
 * **Why it exists at all.** `mediaCleanup.ts` carries a forty-line docblock arguing that its containment
 * rule is subtle enough to have been got wrong in four consecutive iterations of this story - and until
 * now it was reached *only* through five route suites, where every input is a server-composed URL and
 * every refusal looks like every other refusal from the outside. That is exactly the ground on which
 * `isSafeMediaSegment` next door was given a unit test: covered only end-to-end, a helper is deletable
 * under a green suite, and a helper whose "no" is a silent exit is deletable without even a log line.
 *
 * The route suites still own the end-to-end evidence (AC1, AC4, AC8, AC9). What this file owns is the
 * property in isolation: **one file, only when its resolved parent *is* the directory the caller named,
 * and never a different answer for a different spelling of the same path.**
 */
describe("mediaCleanup", () => {
  const TRIP_ID = "trip-media-cleanup";
  const DAY_ID = "day-media-cleanup";
  const STAY_ID = "stay-media-cleanup";

  const dayDir = getTripDayUploadDir(TRIP_ID, DAY_ID);
  const stayDir = getAccommodationImageUploadDir(TRIP_ID, DAY_ID, STAY_ID);

  /** The canonical spelling of the day's own file - the one thing a day-image cleanup owns. */
  const dayImageUrl = `/uploads/trips/${TRIP_ID}/days/${DAY_ID}/day.webp`;
  const dayImagePath = path.join(dayDir, "day.webp");
  /** A nested sibling's file: inside the day's *tree*, but not in the day's own directory. */
  const stayImageUrl = `/uploads/trips/${TRIP_ID}/days/${DAY_ID}/accommodations/${STAY_ID}/img-stay.webp`;
  const stayImagePath = path.join(stayDir, "img-stay.webp");
  /** A traversal that escapes the media tree entirely and satisfies any day-prefix string test. */
  const escapeUrl = `/uploads/trips/${TRIP_ID}/days/${DAY_ID}/../../../../../victim.txt`;
  const escapePath = path.resolve(getTripsUploadRoot(), "..", "..", "victim.txt");

  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    await fsp.rm(getTripUploadDir(TRIP_ID), { recursive: true, force: true });
    await fsp.mkdir(stayDir, { recursive: true });
    await fsp.writeFile(dayImagePath, Buffer.from("day-cover-bytes"));
    await fsp.writeFile(stayImagePath, Buffer.from("stay-photo-bytes"));
    await fsp.mkdir(path.dirname(escapePath), { recursive: true });
    await fsp.writeFile(escapePath, Buffer.from("victim-bytes"));
    consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(async () => {
    consoleSpy.mockRestore();
    await fsp.rm(getTripUploadDir(TRIP_ID), { recursive: true, force: true });
    await fsp.rm(escapePath, { force: true });
  });

  it("removes the one file that sits directly in the directory the caller owns", async () => {
    await removeManagedMediaFile({ storedUrl: dayImageUrl, allowedDir: dayDir, context: "unit" });

    await expect(fsp.access(dayImagePath)).rejects.toBeDefined();
    // The nested sibling is the whole of DW-194 in miniature: it lives under the same day directory and
    // must be byte-identical afterwards.
    expect(await fsp.readFile(stayImagePath)).toEqual(Buffer.from("stay-photo-bytes"));
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  /**
   * The property the four shape tests kept breaking: a stored URL's *spelling* must never change the
   * answer, because `resolveStoredMediaPath` maps every one of these onto byte-for-byte the same file.
   *
   * While the gate here was "does this look like ours?", each spelling below took the module's one silent
   * exit for a real file inside `allowedDir` - bytes left on disk, no row naming them, nothing logged. The
   * last row is the one that ended the arms race: `/x/../…` pops its own leading segment, so the first
   * segment of the string is not the first segment of the path.
   */
  it.each([
    ["a doubled leading slash", `//uploads/trips/${TRIP_ID}/days/${DAY_ID}/day.webp`],
    ["a doubled inner slash", `/uploads//trips/${TRIP_ID}/days/${DAY_ID}/day.webp`],
    ["no leading slash at all", `uploads/trips/${TRIP_ID}/days/${DAY_ID}/day.webp`],
    ["a single-dot segment in front", `/./uploads/trips/${TRIP_ID}/days/${DAY_ID}/day.webp`],
    ["a capitalised uploads segment", `/Uploads/trips/${TRIP_ID}/days/${DAY_ID}/day.webp`],
    ["a segment popped by a following `..`", `/x/../uploads/trips/${TRIP_ID}/days/${DAY_ID}/day.webp`],
  ])("removes the same file when the stored url is spelled with %s", async (_label, storedUrl) => {
    await removeManagedMediaFile({ storedUrl, allowedDir: dayDir, context: "unit" });

    await expect(fsp.access(dayImagePath)).rejects.toBeDefined();
    expect(await fsp.readFile(stayImagePath)).toEqual(Buffer.from("stay-photo-bytes"));
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  /**
   * And the refusals must be spelling-proof in the same way, or a rule that is "wider on spelling" would
   * be wider on reach too. Each row resolves to a file the caller does not own, however it is written.
   */
  it.each([
    ["a nested sibling's file", () => stayImageUrl, () => stayImagePath],
    ["a nested sibling's file spelled with a doubled leading slash", () => `/${stayImageUrl}`, () => stayImagePath],
    [
      "a nested sibling's file spelled through a popped segment",
      () => `/x/..${stayImageUrl}`,
      () => stayImagePath,
    ],
    ["a traversal out of the media tree", () => escapeUrl, () => escapePath],
    ["a traversal spelled with a capitalised uploads segment", () => escapeUrl.replace("/uploads/", "/Uploads/"), () => escapePath],
  ])("refuses %s, leaves it on disk, and logs the refusal", async (_label, url, target) => {
    await removeManagedMediaFile({ storedUrl: url(), allowedDir: dayDir, context: "unit" });

    // Still there: the refusal is the point, and `fs.access` resolving is the only proof of it.
    await expect(fsp.access(target())).resolves.toBeUndefined();
    // The day's own file is untouched too - a refusal must not be a wildcard.
    expect(await fsp.readFile(dayImagePath)).toEqual(Buffer.from("day-cover-bytes"));
    // Logged, never silent: this branch orphans bytes exactly as an `EACCES` does, and iteration 2's
    // silent version is how the AC9 orphans left no trace in 2246 green assertions.
    expect(consoleSpy).toHaveBeenCalledWith(
      "unit: refusing to remove media file outside its own directory",
      expect.objectContaining({ allowedDir: path.resolve(dayDir) }),
    );
  });

  /**
   * The one silent exit the design permits, and the only shape test left. An external URL names no file on
   * this disk, so there is nothing to refuse and nothing to log - unlike every other non-removal here.
   */
  it.each([
    ["an https cover image", "https://cdn.example.com/hero.jpg"],
    ["a data url", "data:image/png;base64,iVBORw0KGgo="],
    ["an empty string", ""],
  ])("returns silently for %s", async (_label, storedUrl) => {
    await removeManagedMediaFile({ storedUrl, allowedDir: dayDir, context: "unit" });

    expect(await fsp.readFile(dayImagePath)).toEqual(Buffer.from("day-cover-bytes"));
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("treats an already-absent file as the desired end state", async () => {
    // AC3. `ENOENT` is not a failure: a half-finished earlier cleanup is the ordinary way to reach it, and
    // there is nothing for the caller or the user to do about it.
    await fsp.rm(dayImagePath);

    await removeManagedMediaFile({ storedUrl: dayImageUrl, allowedDir: dayDir, context: "unit" });

    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("logs any other errno and never throws it at the caller", async () => {
    // AC4 / DW-195 at unit level. Every call site runs *after* the row has been committed, so a throw here
    // would report "removal failed" for a change that already happened. House pattern for the spy is
    // `test/multipartToDisk.test.ts`; for the hand-built errno, `test/documentPacketPdf.test.ts`.
    const failure = new Error("EACCES: permission denied, unlink") as Error & { code: string };
    failure.code = "EACCES";
    const unlinkSpy = vi.spyOn(fsp, "unlink").mockRejectedValue(failure);

    try {
      await expect(
        removeManagedMediaFile({ storedUrl: dayImageUrl, allowedDir: dayDir, context: "unit" }),
      ).resolves.toBeUndefined();
    } finally {
      unlinkSpy.mockRestore();
    }

    expect(consoleSpy).toHaveBeenCalledWith(
      "unit: unable to remove media file",
      // The error object itself, not only its `code`: this line is the sole surviving record of the orphan.
      expect.objectContaining({ code: "EACCES", error: failure }),
    );
  });

  describe("storedMediaUrlsNameSameFile", () => {
    /**
     * The day-image trigger asks this before deciding whether the previous file still has a reason to
     * exist. Two spellings of one path answering "different files" is a deletion of the file the row was
     * just pointed at (confirmed by execution in iteration 5), so it has to agree with the containment
     * comparator about case and about every spelling above.
     */
    it("reads every spelling of one path as one file", () => {
      for (const url of [
        dayImageUrl,
        `//uploads/trips/${TRIP_ID}/days/${DAY_ID}/day.webp`,
        `/uploads//trips/${TRIP_ID}/days/${DAY_ID}/day.webp`,
        `uploads/trips/${TRIP_ID}/days/${DAY_ID}/day.webp`,
        `/./uploads/trips/${TRIP_ID}/days/${DAY_ID}/day.webp`,
        `/Uploads/trips/${TRIP_ID}/days/${DAY_ID}/day.webp`,
        `/x/../uploads/trips/${TRIP_ID}/days/${DAY_ID}/day.webp`,
      ]) {
        expect(storedMediaUrlsNameSameFile(dayImageUrl, url), url).toBe(true);
      }
    });

    it("keeps two genuinely different files apart, or the cleanup would never fire", () => {
      expect(storedMediaUrlsNameSameFile(dayImageUrl, `/uploads/trips/${TRIP_ID}/days/${DAY_ID}/day.png`)).toBe(false);
      expect(storedMediaUrlsNameSameFile(dayImageUrl, stayImageUrl)).toBe(false);
    });

    it("never calls a value that names no file here 'the same file' as anything", () => {
      // Including two identical external URLs: the caller's question is whether the *previous file* still
      // has a reason to exist, and two external URLs share no file to keep.
      expect(storedMediaUrlsNameSameFile(null, dayImageUrl)).toBe(false);
      expect(storedMediaUrlsNameSameFile(dayImageUrl, null)).toBe(false);
      expect(storedMediaUrlsNameSameFile("https://cdn.example.com/a.jpg", "https://cdn.example.com/a.jpg")).toBe(false);
      expect(storedMediaUrlsNameSameFile("https://cdn.example.com/a.jpg", dayImageUrl)).toBe(false);
    });
  });
});
