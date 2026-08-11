import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { toPhotoSource, type PhotoSource } from "@/lib/trips/importPackage";
import {
  getAccommodationDocumentUploadDir,
  getAccommodationImageUploadDir,
  getDayPlanItemDocumentUploadDir,
  getDayPlanItemImageUploadDir,
  getTripDayUploadDir,
  getTripUploadDir,
  isSafeMediaSegment,
} from "@/lib/trips/uploadPaths";

/**
 * Staging half of the media import: where a restored photo or document lands, and how the disk is
 * put back if writing it fails.
 *
 * Two rules shape everything here.
 *
 * **Never use a filename from the package.** A package is attacker-controlled input, and a member
 * name is the shortest path from "restore my backup" to writing outside the uploads tree. Names are
 * generated server-side with the same conventions the upload routes use, and the extension comes
 * from the allow-listed `contentType` rather than from anything in the file.
 *
 * The rule is absolute and Story 9.1 did not soften it. A document's manifest entry carries the name
 * the user gave the file, because the chip is labelled with it and AC8 requires it back - but that
 * value is a **database column and nothing else**. It is sanitised at the schema boundary by
 * `sanitizeDocumentFileName`, the same function the upload routes use, and it never appears in a
 * path: the file on disk is `doc-<ts>-<rand>.<ext>` exactly as if it had been uploaded.
 *
 * **Paths come from `uploadPaths.ts` only.** Those helpers resolve through `MEDIA_STORAGE_ROOT`,
 * which is what keeps `npm test` away from the developer's real uploads and what keeps restored
 * photos out of the statically-served tree - see the header comment there for both incidents.
 * Rebuilding a path from `process.cwd()` here would reintroduce exactly that.
 *
 * Writes happen *after* the transaction commits, because every URL contains an id Prisma only
 * generates on insert. That ordering means the disk can be left behind the database, so
 * `writeImportedPhotos` removes every file it wrote before rethrowing.
 */

/** Extension per allow-listed content type, matching `ALLOWED_TYPES` in the three upload routes. */
const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * The same table for documents, matching `ALLOWED_TYPES` in the two document upload routes: PDF plus
 * the three image types, because a ticket screenshot is a document.
 *
 * Spread from the photo table rather than retyped, so the three shared rows cannot drift into two
 * spellings of the same extension. The dependency runs one way: nothing here can add an extension to
 * the *photo* table.
 */
const DOCUMENT_EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  "application/pdf": "pdf",
  ...EXTENSION_BY_CONTENT_TYPE,
};

export class ImportPhotoWriteError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ImportPhotoWriteError";
  }
}

/** One file to create once the transaction has committed. */
export type PlannedPhotoWrite = {
  /** Absolute path, always inside the new trip's own upload directory. */
  filePath: string;
  /** Archive member whose bytes belong at `filePath`. */
  archivePath: string;
};

/** Where a photo will live, and the URL the database row must carry for it. */
export type PhotoPlacement = {
  filePath: string;
  imageUrl: string;
};

/** The same for a document. A separate type because the column it feeds is `documentUrl`. */
export type DocumentPlacement = {
  filePath: string;
  documentUrl: string;
};

const extensionFor = (contentType: string) => {
  const extension = EXTENSION_BY_CONTENT_TYPE[contentType];
  if (!extension) {
    // The Zod schema allow-lists the same three types, so this is a programming error rather than
    // bad input - failing loudly beats inventing an extension for bytes of unknown type.
    throw new ImportPhotoWriteError(`Unsupported photo content type: ${contentType}`);
  }
  return extension;
};

const documentExtensionFor = (contentType: string) => {
  const extension = DOCUMENT_EXTENSION_BY_CONTENT_TYPE[contentType];
  if (!extension) {
    // Same reasoning as `extensionFor`: `validatePackageMedia` - the function the import route
    // actually calls, and the one both `validatePackagePhotos` and `validatePackageDocuments` are
    // thin wrappers over - has already refused bytes that match no allow-listed signature, so
    // reaching here means a caller skipped it.
    throw new ImportPhotoWriteError(`Unsupported document content type: ${contentType}`);
  }
  return extension;
};

/**
 * Gallery filename, byte-for-byte the convention the two gallery upload routes use.
 *
 * `taken` guards the one case the routes never hit: an import writes a whole gallery in a single
 * tick, so `Date.now()` is constant across it and only the random suffix separates two files in the
 * same directory.
 */
const generateGalleryFileName = (contentType: string, taken: Set<string>) => {
  const extension = extensionFor(contentType);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = `img-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${extension}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
  throw new ImportPhotoWriteError("Unable to generate a unique photo file name");
};

/**
 * Document filename, byte-for-byte the convention the two document upload routes use.
 *
 * `taken` is the same guard and for the same reason: an import writes a whole entry's documents in a
 * single tick, so `Date.now()` is constant across it and only the random suffix separates two files
 * in the same directory. It is shared with the gallery names rather than kept per-kind - the two
 * prefixes make a collision impossible anyway, and one set is one thing to pass around.
 *
 * Nothing from the package reaches this name. The manifest's `fileName` is a column value; see this
 * file's header.
 */
const generateDocumentFileName = (contentType: string, taken: Set<string>) => {
  const extension = documentExtensionFor(contentType);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = `doc-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${extension}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
  throw new ImportPhotoWriteError("Unable to generate a unique document file name");
};

/**
 * Hero and day images keep the upload routes' fixed `hero.<ext>` / `day.<ext>` names rather than a
 * generated one. Both are server-chosen (nothing from the package reaches them), and matching the
 * routes means a later hero replacement overwrites the imported file in place instead of orphaning
 * it - which is the behaviour the rest of the app already assumes of those two URLs.
 */
export const planTripHeroPhoto = (tripId: string, contentType: string): PhotoPlacement => {
  const fileName = `hero.${extensionFor(contentType)}`;
  return {
    filePath: path.join(getTripUploadDir(tripId), fileName),
    imageUrl: `/uploads/trips/${tripId}/${fileName}`,
  };
};

export const planTripDayPhoto = (tripId: string, tripDayId: string, contentType: string): PhotoPlacement => {
  const fileName = `day.${extensionFor(contentType)}`;
  return {
    filePath: path.join(getTripDayUploadDir(tripId, tripDayId), fileName),
    imageUrl: `/uploads/trips/${tripId}/days/${tripDayId}/${fileName}`,
  };
};

export const planAccommodationGalleryPhoto = (
  params: { tripId: string; tripDayId: string; accommodationId: string; contentType: string },
  takenFileNames: Set<string>,
): PhotoPlacement => {
  const { tripId, tripDayId, accommodationId, contentType } = params;
  const fileName = generateGalleryFileName(contentType, takenFileNames);
  return {
    filePath: path.join(getAccommodationImageUploadDir(tripId, tripDayId, accommodationId), fileName),
    imageUrl: `/uploads/trips/${tripId}/days/${tripDayId}/accommodations/${accommodationId}/${fileName}`,
  };
};

export const planDayPlanItemGalleryPhoto = (
  params: { tripId: string; tripDayId: string; dayPlanItemId: string; contentType: string },
  takenFileNames: Set<string>,
): PhotoPlacement => {
  const { tripId, tripDayId, dayPlanItemId, contentType } = params;
  const fileName = generateGalleryFileName(contentType, takenFileNames);
  return {
    filePath: path.join(getDayPlanItemImageUploadDir(tripId, tripDayId, dayPlanItemId), fileName),
    imageUrl: `/uploads/trips/${tripId}/days/${tripDayId}/day-plan-items/${dayPlanItemId}/${fileName}`,
  };
};

/**
 * Documents land in the entry's own `documents/` subdirectory, which is what
 * `getAccommodationDocumentUploadDir` composes - never beside its photos. A restored document has to
 * be indistinguishable from an uploaded one, and where it sits is half of that.
 */
export const planAccommodationDocument = (
  params: { tripId: string; tripDayId: string; accommodationId: string; contentType: string },
  takenFileNames: Set<string>,
): DocumentPlacement => {
  const { tripId, tripDayId, accommodationId, contentType } = params;
  const fileName = generateDocumentFileName(contentType, takenFileNames);
  return {
    filePath: path.join(getAccommodationDocumentUploadDir(tripId, tripDayId, accommodationId), fileName),
    documentUrl: `/uploads/trips/${tripId}/days/${tripDayId}/accommodations/${accommodationId}/documents/${fileName}`,
  };
};

export const planDayPlanItemDocument = (
  params: { tripId: string; tripDayId: string; dayPlanItemId: string; contentType: string },
  takenFileNames: Set<string>,
): DocumentPlacement => {
  const { tripId, tripDayId, dayPlanItemId, contentType } = params;
  const fileName = generateDocumentFileName(contentType, takenFileNames);
  return {
    filePath: path.join(getDayPlanItemDocumentUploadDir(tripId, tripDayId, dayPlanItemId), fileName),
    documentUrl: `/uploads/trips/${tripId}/days/${tripDayId}/day-plan-items/${dayPlanItemId}/documents/${fileName}`,
  };
};

/**
 * Writes every planned photo, or writes none of them.
 *
 * "Or none" is the AC3 obligation applied to the disk phase: a half-written gallery is a trip whose
 * images 404, which is worse than a failed import. Every path is recorded as it is created and
 * removed with `force: true` on the way out, so cleanup itself cannot fail the request.
 *
 * One member is read per write and released before the next (Story 2.34): with the package still on
 * disk, `photoBytes` is a window onto the archive rather than the archive itself, and holding the
 * pool here would put back exactly the copy that story removed. A pooled photo used by several
 * gallery slots is therefore read once per slot - the read volume is already bounded by
 * `MAX_IMPORT_MEDIA_TOTAL_BYTES`, since it is the same volume as the writes.
 *
 * **Documents go through this same call** (Story 9.1), as further planned writes against a source
 * merged over both pools (`mergeMemberSources`). Not a second call: "or none" cannot span two of
 * them, and a photo pass that succeeded followed by a document pass that failed would leave the
 * photos on disk with nothing left to unwind them.
 */
export const writeImportedPhotos = async (
  writes: PlannedPhotoWrite[],
  photoBytes: PhotoSource | Map<string, Buffer>,
): Promise<string[]> => {
  const source = toPhotoSource(photoBytes);
  const written: string[] = [];

  try {
    for (const write of writes) {
      if (!source.has(write.archivePath)) {
        // Validated before the transaction opened, so reaching here means the caller skipped that
        // step. Treated as a write failure so the cleanup below still runs.
        throw new ImportPhotoWriteError(`Package has no bytes for archive member ${write.archivePath}`);
      }
      const bytes = source.read(write.archivePath);
      await fs.mkdir(path.dirname(write.filePath), { recursive: true });
      await fs.writeFile(write.filePath, bytes);
      written.push(write.filePath);
    }
  } catch (error) {
    await removeWrittenPhotos(written);
    throw error instanceof ImportPhotoWriteError
      ? error
      : new ImportPhotoWriteError("Unable to write imported photos", { cause: error });
  }

  return written;
};

export const removeWrittenPhotos = async (filePaths: string[]) => {
  await Promise.all(filePaths.map((filePath) => fs.rm(filePath, { force: true })));
};

/**
 * How old a lock directory's `mtime` must be before another import may reclaim it.
 *
 * With the heartbeat below refreshing that `mtime` every minute, this reads "the holding process is
 * gone", not "the import is slow" - which is the only reading that makes it safe. Measured from
 * acquisition with no refresh, the timeout would instead measure *import duration*, and a legitimate
 * import near the `MAX_IMPORT_MEDIA_TOTAL_BYTES` (3 GB) ceiling would have its lock stolen mid-flight
 * by the very mechanism that exists to keep two writers apart.
 *
 * Fifteen minutes is fifteen missed heartbeats, so a crashed or `SIGKILL`ed process does not lock the
 * trip until somebody notices. Exported so the unit tests can backdate a lock by exactly this much
 * instead of duplicating the number or waiting for the clock.
 */
export const IMPORT_LOCK_STALE_MS = 15 * 60 * 1000;

/** One minute, i.e. fifteen chances to prove liveness before `IMPORT_LOCK_STALE_MS` expires. */
const IMPORT_LOCK_REFRESH_MS = 60 * 1000;

/**
 * Name of the file inside the sentinel carrying the holder's nonce.
 *
 * Release compares it before removing anything. Without it, release is "remove this path", so a holder
 * whose stale lock was reclaimed would delete the *reclaimer's* fresh sentinel on its way out and open
 * the window for a third import - the failure mode the lock exists to prevent, reached through the
 * lock.
 */
const IMPORT_LOCK_HOLDER_FILE = "holder";

/**
 * Where one trip's import sentinel lives.
 *
 * A *sibling* of the trip's upload directory rather than a child, because the trip directory is exactly
 * what the import renames away - a lock inside it would travel with the stash. That is also why trip
 * deletion has to name it explicitly (`api/trips/[id]/route.ts`): the recursive `fs.rm` of the trip
 * directory does not reach a sibling, and a deleted trip's id is never imported again, so nothing would
 * ever reclaim what was left behind. One definition, used by the acquire and by that deletion, so the
 * two cannot come to disagree about which path is the sentinel.
 */
export const getTripImportLockDir = (tripId: string) => `${getTripUploadDir(tripId)}.import-lock`;

export type TripImportLock = {
  lockDir: string;
  /** This holder's claim on `lockDir`; see `IMPORT_LOCK_HOLDER_FILE`. */
  nonce: string;
  /** The heartbeat, cleared by the release. `unref`'d, so it never holds the process open. */
  heartbeat: ReturnType<typeof setInterval>;
};

/**
 * Refreshes the sentinel's `mtime` while this holder still owns it.
 *
 * **It verifies the claim on every tick, not just the path.** Closing over `lockDir` alone means a holder
 * whose stale lock was reclaimed keeps touching the *reclaimer's* sentinel - so the reclaimer's lock is
 * attested as alive by a process that does not own it, and if the reclaimer then dies the trip never goes
 * stale and can never be reclaimed again. Reading the nonce first and `clearInterval`-ing on a mismatch
 * makes the heartbeat mean "the holder of *this* claim is alive", which is the only statement
 * `IMPORT_LOCK_STALE_MS` can safely be read against.
 *
 * **An unreadable holder file is "unknown", not a mismatch, and it keeps beating.** A read that fails is
 * not evidence the claim moved to somebody else - only a *different nonce* is that. Treating a failure as
 * a mismatch means one transient `EIO`, `EMFILE` or `ENFILE` silently ends the liveness of a live import,
 * whose lock is then reclaimed out from under it fifteen minutes later while it is still writing. The
 * cost of the other direction is bounded and much smaller: a holder that keeps beating on a directory it
 * no longer owns for as long as the file stays unreadable, which the nonce check ends the moment one read
 * succeeds.
 */
const startImportLockHeartbeat = (lockDir: string, nonce: string) => {
  const heartbeat: ReturnType<typeof setInterval> = setInterval(() => {
    void (async () => {
      const holder = await fs.readFile(path.join(lockDir, IMPORT_LOCK_HOLDER_FILE), "utf8").catch(() => null);
      if (holder !== null && holder.trim() !== nonce) {
        clearInterval(heartbeat);
        return;
      }
      const now = new Date();
      // A failed `utimes` is ignored on purpose: a missed refresh only brings the lock closer to being
      // reclaimable, and there is no caller here to report to.
      await fs.utimes(lockDir, now, now).catch(() => undefined);
    })();
  }, IMPORT_LOCK_REFRESH_MS);
  heartbeat.unref?.();
  return heartbeat;
};

/**
 * The exclusive claim itself: `mkdir` without `recursive`, which is the only `fs` call here that fails
 * when the thing already exists.
 *
 * **All-or-nothing, and that is not defensive tidiness.** A `mkdir` that succeeds followed by a holder
 * write that fails (`ENOSPC`, `EACCES`, `EIO`) leaves behind a sentinel nobody can ever remove: release
 * refuses on a holder file it cannot read, and the caller never received a lock object to release in the
 * first place. The trip would then answer `409 import_in_progress` for the whole staleness window with no
 * import running anywhere. Removing the directory before rethrowing turns that into an ordinary failed
 * acquire, which the caller already handles.
 */
const claimImportLock = async (lockDir: string): Promise<TripImportLock> => {
  await fs.mkdir(lockDir);
  const nonce = randomUUID();
  try {
    await fs.writeFile(path.join(lockDir, IMPORT_LOCK_HOLDER_FILE), nonce, "utf8");
  } catch (error) {
    // Best effort, and deliberately not allowed to mask the real error: if even this fails there is
    // nothing further to try, and the original write failure is the one worth reporting.
    await fs.rm(lockDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
  return { lockDir, nonce, heartbeat: startImportLockHeartbeat(lockDir, nonce) };
};

/**
 * Serialises overwrite imports of one trip (Story 8.4 / DW-86).
 *
 * Two concurrent overwrite imports of the same trip interleaved in the worst possible way: both
 * transactions committed, then both ran the disk phase over one directory - the second
 * `stashTripUploadDir` moved the *first* import's freshly written files aside as though they were the
 * old ones, and its `discardStashedTripUploadDir` then deleted them. The `ENOENT` swallow in
 * `stashTripUploadDir` is correct and stays (a photo-free trip has no directory); it is only what made
 * the race silent.
 *
 * **Why an exclusive `mkdir`.** It is the one filesystem primitive here that is atomic and fails when
 * the thing already exists. Every other `fs.mkdir` in this codebase passes `{ recursive: true }`, which
 * succeeds on an existing directory and is therefore useless as a sentinel - hence the bare `mkdir`
 * inside `claimImportLock`, and hence the parent being ensured separately first. There is no existing
 * lock idiom in `src/` to mirror.
 *
 * The lock lives beside the trip directory rather than inside it, because the trip directory is exactly
 * what the import renames away. Its name cannot collide with `stashTripUploadDir`'s
 * `<tripDir>.import-<ts>-<rand>` stash: that suffix always continues with a digit, this one with `l`.
 *
 * **`tripId` must be one safe path segment, and this is the last line of defence rather than the first.**
 * The caller now resolves the id through the database before locking, so nothing hostile should arrive
 * here - but the id is interpolated straight into a filesystem path, and the first implementation of
 * this story locked on the raw `targetTripId` request field (`z.string().trim().min(1)`), which was
 * confirmed by execution to `mkdir` and then `rm -rf` a directory *outside* the media root for any
 * authenticated caller. Refusing an unsafe segment here means no future caller can reintroduce that,
 * and it throws its own message rather than `import_in_progress`: a malformed id is a fault, not a
 * lost race, and reporting it as a race would be a permanent false "another import is running".
 */
export const acquireTripImportLock = async (tripId: string): Promise<TripImportLock> => {
  if (!isSafeMediaSegment(tripId)) {
    throw new Error("import_lock_unsafe_trip_id");
  }

  const lockDir = getTripImportLockDir(tripId);
  await fs.mkdir(path.dirname(lockDir), { recursive: true });

  try {
    return await claimImportLock(lockDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code !== "EEXIST") {
      throw error;
    }
  }

  const stats = await fs.stat(lockDir).catch(() => null);
  if (stats && Date.now() - stats.mtimeMs < IMPORT_LOCK_STALE_MS) {
    throw new Error("import_in_progress");
  }

  if (stats) {
    // **Reclaim by rename, because reclaim has to be atomic.** `stat` -> `rm -rf` -> `mkdir` lets two
    // callers that both read the same stale `stat` both succeed: the second's `rm` removes the first's
    // freshly created sentinel.
    //
    // **But `fs.rename` on its own is not sufficient either, and "exactly one reclaimer can win" was
    // false.** Two callers can both `stat` the same stale lock; the winner renames it aside, removes it,
    // `mkdir`s and writes its holder - and only *then* does the loser's rename execute, moving the
    // **winner's fresh sentinel** aside and claiming the lock as well. Confirmed by execution: two
    // concurrent acquires against one stale lock both returned a lock, which is DW-86's interleaving
    // reached through the mechanism built to prevent it.
    //
    // So the rename is verified rather than trusted: the directory that was moved must be the directory
    // that was found stale, which its inode number identifies across the rename. On a mismatch this
    // caller moved something that was not its to move, puts it back (best effort - a third caller may
    // have recreated the path in the meantime, and then leaving the copy aside is the lesser harm) and
    // reports the lost race. The residual is a filesystem that reuses an inode number for a directory
    // created microseconds after another was removed; APFS and ext4 both allocate monotonically here.
    const staleDir = `${lockDir}.stale-${randomUUID()}`;
    let renamed = true;
    try {
      await fs.rename(lockDir, staleDir);
    } catch (error) {
      // **An `ENOENT` here is not a lost race.** It means the stale holder's own release removed the
      // sentinel between the `stat` and the `rename`, so there is now no lock at all and the right move is
      // the retry below - exactly what the `stats === null` branch above already does for the identical
      // situation observed one step earlier. Reporting `import_in_progress` for it answers "another import
      // is running" when none is, and does so for the full staleness window's worth of retries.
      if ((error as NodeJS.ErrnoException | null)?.code !== "ENOENT") {
        throw new Error("import_in_progress");
      }
      renamed = false;
    }
    if (renamed) {
      const moved = await fs.stat(staleDir).catch(() => null);
      if (!moved || moved.ino !== stats.ino) {
        await fs.rename(staleDir, lockDir).catch(() => undefined);
        throw new Error("import_in_progress");
      }
      await fs.rm(staleDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  // A lock that vanished between the `EEXIST` and the `stat` was released by its holder, so this retry
  // is the right move on that path too.
  try {
    return await claimImportLock(lockDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === "EEXIST") {
      throw new Error("import_in_progress");
    }
    // Anything else - `EACCES`, `ENOSPC`, `EROFS` - is rethrown rather than reported as a lost race. A
    // bare `catch` here made every one of them a permanent `import_in_progress` for a trip no import
    // was touching, with nothing in the message to say why.
    throw error;
  }
};

/**
 * Must run in a `finally`: a lock that outlives its import blocks the trip until it goes stale.
 *
 * Removes the sentinel **only while it is still this holder's**. The nonce comparison is what keeps a
 * slow holder whose lock was already reclaimed from deleting the reclaimer's - see
 * `IMPORT_LOCK_HOLDER_FILE`. A mismatch, or a holder file that cannot be read, means the directory is
 * not ours to remove and is left alone; the current owner's release, or the staleness timeout, deals
 * with it.
 */
export const releaseTripImportLock = async (lock: TripImportLock | null) => {
  if (!lock) return;
  clearInterval(lock.heartbeat);

  const holder = await fs.readFile(path.join(lock.lockDir, IMPORT_LOCK_HOLDER_FILE), "utf8").catch(() => null);
  if (holder?.trim() !== lock.nonce) {
    return;
  }

  await fs.rm(lock.lockDir, { recursive: true, force: true });
};

export type StashedTripUploadDir = {
  tripDir: string;
  stashDir: string;
};

/**
 * Moves an overwrite target's upload directory aside instead of deleting it (AC5).
 *
 * `fs.rm` first would make a later failure unrecoverable: the rows are already replaced by then, so
 * the old files are the only thing left to put back. A rename is atomic within a filesystem and
 * costs nothing, and the directory is only really deleted once the new photos are safely on disk.
 *
 * Returns `null` when there is nothing to move - a trip that never had an upload directory is the
 * common case, not an error.
 */
export const stashTripUploadDir = async (tripId: string): Promise<StashedTripUploadDir | null> => {
  const tripDir = getTripUploadDir(tripId);
  const stashDir = `${tripDir}.import-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  try {
    await fs.rename(tripDir, stashDir);
  } catch (error) {
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
  return { tripDir, stashDir };
};

/** Success path: the replaced files are finally gone, and with them AC5's orphaned files. */
export const discardStashedTripUploadDir = async (stash: StashedTripUploadDir | null) => {
  if (!stash) return;
  await fs.rm(stash.stashDir, { recursive: true, force: true });
};

/**
 * Failure path: put the previous directory back.
 *
 * Anything the failed attempt already created is removed first, because `fs.rename` onto a
 * non-empty directory fails on every platform this runs on.
 */
export const restoreStashedTripUploadDir = async (stash: StashedTripUploadDir | null) => {
  if (!stash) return;
  await fs.rm(stash.tripDir, { recursive: true, force: true });
  await fs.rename(stash.stashDir, stash.tripDir);
};
