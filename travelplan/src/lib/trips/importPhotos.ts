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
    // Same reasoning as `extensionFor`: `validatePackageDocuments` has already refused bytes that
    // match no allow-listed signature, so reaching here means a caller skipped it.
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
