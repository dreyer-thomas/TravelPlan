import { MAX_IMPORT_PHOTO_BYTES, MAX_IMPORT_PHOTO_TOTAL_BYTES } from "@/lib/trips/importLimits";
import {
  bufferByteSource,
  openZipArchive,
  ZipReadError,
  type ZipByteSource,
} from "@/lib/trips/zipReader";

/**
 * Turns an uploaded backup into a manifest plus a way to get at its photo members.
 *
 * Two container shapes reach this module and both have to work (AC1 and AC2):
 *
 * - a **v2 package**: the ZIP Story 2.31 writes - a `trip.json` manifest and real photo files under
 *   `photos/`;
 * - a **v1 backup**: a bare `.json` file, which is the same manifest minus the v2 additions and with
 *   no photos at all.
 *
 * The two are told apart by magic bytes rather than by the upload's filename or MIME type, both of
 * which are client-supplied and neither of which is trustworthy. `PK\x03\x04` is a ZIP with at least
 * one member; `PK\x05\x06` is an empty archive, whose first record *is* the end-of-central-directory.
 * `looksLikeZipPrefix` is that decision and is exported, because the import route makes it against
 * the first four bytes of a temp file and a second copy of the constants is a second thing to keep
 * in step.
 *
 * There are two entry points, and the difference between them is where the photo bytes live:
 *
 * - `parseImportPackage(bytes)` materialises every member into a `Map`. It is the original shape and
 *   the one the suites are written against, and it is still what a v1 upload and any caller holding
 *   the whole archive should use.
 * - `openImportPackage(source)` reads the manifest and hands back a lazy `PhotoSource`, so a 217 MB
 *   backup on disk costs one photo of memory rather than the whole archive (Story 2.34).
 *
 * Neither entry point throws: every failure is returned as a code the route maps onto the
 * `{ data, error }` envelope, because "this file is not a valid backup" is a 400 and never a 500.
 * The one thing that can throw is the lazy `PhotoSource` handed back by `openImportPackage` - it
 * reads and verifies a member at the moment it is asked for, so a member whose CRC-32 is wrong
 * surfaces as a `ZipReadError` from `read`. Its callers are documented to map that to the same
 * `validation_error` 400 the eager path returns.
 */

const MANIFEST_MEMBER_NAME = "trip.json";
const PHOTO_MEMBER_PREFIX = "photos/";

// Re-exported so the package reader stays the one import for everything about a package's photos.
export { MAX_IMPORT_PHOTO_BYTES };

export type ImportPackage = {
  manifest: unknown;
  /** Archive member path (`photos/p1.jpg`) to its bytes. Always empty for a v1 backup. */
  photoBytes: Map<string, Buffer>;
};

/**
 * The package's photos, addressed by archive member path, one at a time.
 *
 * The interface a `Map<string, Buffer>` already satisfied in spirit, made explicit so the bytes can
 * come from a file instead. `read` materialises exactly one member and the caller is expected to let
 * go of it before asking for the next - that is the whole of AC1's memory bound.
 *
 * The consequence is deliberate and worth stating: a photo is read out of the archive **twice** on
 * the import path, once by `validatePackagePhotos` to size and sniff it and once by
 * `writeImportedPhotos` to put it on disk (plus once more per pooled photo in `tripRepo`, which
 * sniffs the bytes to name the file). The alternative is keeping the pool resident, which is the bug
 * Story 2.34 exists to remove. Re-reading a member off a local temp file is much cheaper than the
 * memory it saves.
 */
export type PhotoSource = {
  /** Member paths in archive order. */
  paths(): string[];
  has(path: string): boolean;
  /**
   * The member's first `length` bytes, for a magic-byte sniff.
   *
   * Its own operation rather than `read(path).subarray(0, length)` because the difference is 12 bytes
   * against 15 MB, per photo, per caller - and `tripRepo` sniffs the whole pool a second time to name
   * the files it writes. A STORE member answers this from a twelve-byte read; a DEFLATE one has to be
   * inflated, so it falls back to the full read.
   *
   * Unlike `read`, this verifies nothing: a prefix cannot be checked against a CRC-32 of the whole.
   * `validatePackagePhotos` reads every pooled photo in full before the transaction opens, which is
   * where that verification happens and is why doing without it here costs nothing.
   */
  head(path: string, length: number): Buffer;
  /** May throw `ZipReadError` for an archive-backed source: verification happens on read. */
  read(path: string): Buffer;
};

/** Enough for every signature `sniffPhotoContentType` allow-lists - WebP's is the longest, at 12. */
export const PHOTO_SIGNATURE_HEAD_BYTES = 12;

export const photoSourceFromMap = (map: Map<string, Buffer>): PhotoSource => {
  const require = (path: string) => {
    const bytes = map.get(path);
    if (!bytes) {
      throw new ZipReadError(`Archive has no entry named: ${path}`);
    }
    return bytes;
  };

  return {
    paths: () => [...map.keys()],
    has: (path) => map.has(path),
    head: (path, length) => require(path).subarray(0, length),
    read: require,
  };
};

/**
 * Accept the old shape and the new one at every call site.
 *
 * Every existing caller and suite passes a `Map`, and there is no reason to make them all change to
 * gain a bound they do not need - a caller that already holds the bytes has already paid for them.
 */
export const toPhotoSource = (photos: PhotoSource | Map<string, Buffer>): PhotoSource =>
  photos instanceof Map ? photoSourceFromMap(photos) : photos;

export type ImportPackageFailure = {
  /** Mirrors the route's error codes: a bare file that is not JSON is `invalid_json`, the rest are validation. */
  code: "invalid_json" | "validation_error";
  message: string;
};

export type ImportPackageResult =
  | { ok: true; value: ImportPackage }
  | ({ ok: false } & ImportPackageFailure);

/**
 * Does a buffer *start* like a ZIP - `PK\x03\x04` or `PK\x05\x06`?
 *
 * Exported because the import route has to make the same decision about a file it has only read four
 * bytes of, and for a while it made it with its own copy of the constants. Two spellings of one
 * container decision that must agree forever is a defect waiting for one of them to be edited, and
 * this module's header already claims the decision as its own - so it owns the predicate too.
 *
 * Only the first four bytes are looked at; anything after them is the caller's, and a buffer shorter
 * than four bytes is not a ZIP by definition.
 */
export const looksLikeZipPrefix = (head: Buffer) => {
  if (head.length < 4 || head[0] !== 0x50 || head[1] !== 0x4b) {
    return false;
  }
  const marker = (head[2] << 8) | head[3];
  return marker === 0x0304 || marker === 0x0506;
};


/**
 * Members that carry no backup content and must be ignored rather than rejected.
 *
 * Our own writer emits neither, but a user who unzips a backup to look inside it and re-zips the
 * folder is doing something entirely reasonable, and both Finder and Explorer add these on the way
 * back out: a directory entry per folder, macOS resource forks under `__MACOSX/`, and `.DS_Store`.
 * Rejecting them would fail a sound archive on bookkeeping the user never chose to include - and
 * would waste the zero-length-DEFLATE tolerance directly below, which exists for the same re-zip.
 *
 * This is deliberately a closed list of known-inert names, not a general "ignore what you don't
 * recognise": an unregistered member under `photos/` is still refused on anti-smuggling grounds,
 * and so is anything else the reader cannot account for.
 */
const isArchiveBookkeeping = (name: string) => {
  if (name.endsWith("/")) return true; // directory entry
  if (name === "__MACOSX" || name.startsWith("__MACOSX/")) return true;
  const baseName = name.slice(name.lastIndexOf("/") + 1);
  return baseName === ".DS_Store" || baseName === "Thumbs.db";
};

/**
 * `trip.json` is a member of the archive but not of the *photo* source, so the triage's own list is
 * what a lookup is checked against - not the archive's.
 */
const requirePhotoMember = (path: string, knownPaths: Set<string>) => {
  if (!knownPaths.has(path)) {
    throw new ZipReadError(`Archive has no entry named: ${path}`);
  }
};

export type OpenImportPackage = {
  manifest: unknown;
  /** The archive's photo members, materialised one at a time. Empty for a package with no photos. */
  photos: PhotoSource;
};

export type OpenImportPackageResult =
  | { ok: true; value: OpenImportPackage }
  | ({ ok: false } & ImportPackageFailure);

/**
 * Read a v2 package's manifest and triage its members, without materialising a single photo.
 *
 * Magic-byte detection is not this function's job - a `ZipByteSource` is already a decision that the
 * upload is an archive, and the route sniffs the temp file's first bytes before choosing between
 * this and `parseImportPackage`.
 *
 * The triage is the same one `parseImportPackage` has always done, and it is done here because it is
 * cheap: `trip.json` is required and parsed eagerly (it is the smallest member and nothing can
 * proceed without it), the bookkeeping members Finder and Explorer inject are ignored, and a member
 * that is neither `trip.json` nor under `photos/` is the same `validation_error` it was before.
 */
export const openImportPackage = (source: ZipByteSource): OpenImportPackageResult => {
  let archive;
  try {
    archive = openZipArchive(source);
  } catch (error) {
    if (error instanceof ZipReadError) {
      return { ok: false, code: "validation_error", message: error.message };
    }
    throw error;
  }

  if (!archive.entries.some((entry) => entry.name === MANIFEST_MEMBER_NAME)) {
    return { ok: false, code: "validation_error", message: "Archive is missing its trip.json manifest" };
  }

  let manifestBytes: Buffer;
  try {
    manifestBytes = archive.readMember(MANIFEST_MEMBER_NAME);
  } catch (error) {
    if (error instanceof ZipReadError) {
      return { ok: false, code: "validation_error", message: error.message };
    }
    throw error;
  }

  let manifest: unknown;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch {
    return { ok: false, code: "validation_error", message: "Archive manifest trip.json is not valid JSON" };
  }

  const photoPaths: string[] = [];
  for (const entry of archive.entries) {
    if (entry.name === MANIFEST_MEMBER_NAME || isArchiveBookkeeping(entry.name)) {
      continue;
    }
    if (!entry.name.startsWith(PHOTO_MEMBER_PREFIX)) {
      // `validatePackagePhotos` refuses an unregistered member *under* `photos/` on anti-smuggling
      // grounds. Silently dropping everything else made that check dodgeable by renaming the member
      // out of the prefix, which is not a distinction worth defending: a v2 package contains
      // `trip.json` and photos, and nothing else is meaningful to this reader.
      return {
        ok: false,
        code: "validation_error",
        message: `Archive contains a member that is neither trip.json nor a photo: ${entry.name}`,
      };
    }
    photoPaths.push(entry.name);
  }

  const knownPaths = new Set(photoPaths);
  return {
    ok: true,
    value: {
      manifest,
      photos: {
        paths: () => [...photoPaths],
        has: (path) => knownPaths.has(path),
        head: (path, length) => {
          requirePhotoMember(path, knownPaths);
          return archive.readMemberHead(path, length);
        },
        read: (path) => {
          requirePhotoMember(path, knownPaths);
          return archive.readMember(path);
        },
      },
    },
  };
};

export const parseImportPackage = (bytes: Buffer): ImportPackageResult => {
  if (bytes.length === 0) {
    return { ok: false, code: "validation_error", message: "Backup file is empty" };
  }

  if (!looksLikeZipPrefix(bytes)) {
    // v1: the whole file is the manifest. `invalid_json` keeps the wire behaviour a user of the old
    // format already knows - a corrupt JSON backup reported the same way before this story.
    try {
      return { ok: true, value: { manifest: JSON.parse(bytes.toString("utf8")), photoBytes: new Map() } };
    } catch {
      return { ok: false, code: "invalid_json", message: "Backup file must be valid JSON or a ZIP archive" };
    }
  }

  const opened = openImportPackage(bufferByteSource(bytes));
  if (!opened.ok) {
    return opened;
  }

  // The eager half, and the only place that still holds every member at once. The archive is already
  // resident here, so the copies cost what they always did.
  const photoBytes = new Map<string, Buffer>();
  try {
    for (const path of opened.value.photos.paths()) {
      photoBytes.set(path, opened.value.photos.read(path));
    }
  } catch (error) {
    if (error instanceof ZipReadError) {
      return { ok: false, code: "validation_error", message: error.message };
    }
    throw error;
  }

  return { ok: true, value: { manifest: opened.value.manifest, photoBytes } };
};

/**
 * Magic-byte signatures for the three types the upload routes accept.
 *
 * This is what turns AC3's "photo data that cannot be decoded" into a real check. A declared
 * `contentType` is just a string in a manifest anyone can hand-edit; the bytes are the only evidence
 * that what lands in `public/uploads` and gets served back as an image actually is one.
 */
const PHOTO_SIGNATURES: Record<string, (bytes: Buffer) => boolean> = {
  "image/jpeg": (bytes) => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  "image/png": (bytes) =>
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  // WebP is a RIFF container: "RIFF" at 0, a four-byte size, then the "WEBP" form type at 8.
  "image/webp": (bytes) =>
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP",
};

/**
 * The content type the *bytes* claim, or `null` when they match no allow-listed signature.
 *
 * The bytes are the authority here, never the manifest's `contentType`, and the reason is on this
 * app's own upload path: `trips/[id]/hero-image/route.ts` picks the stored extension from the
 * client-supplied `file.type` without sniffing anything. A PNG uploaded as `image/jpeg` is stored
 * as `hero.jpg` and exported as `image/jpeg`, so requiring the two to agree would reject a backup
 * this app produced. What AC3 is really after is narrower - data that is not a decodable image must
 * not be written - and "matches no signature" is exactly that.
 */
export const sniffPhotoContentType = (bytes: Buffer): string | null => {
  for (const [contentType, matchesSignature] of Object.entries(PHOTO_SIGNATURES)) {
    if (matchesSignature(bytes)) {
      return contentType;
    }
  }
  return null;
};

export type PackagePhotoPoolEntry = { contentType: string; archivePath: string };

export type PackagePhotoValidation = { ok: true } | { ok: false; issues: string[] };

/**
 * Archive-level photo validation, run **before** the transaction opens (AC3).
 *
 * Zod cannot do any of this: the bytes are not in the manifest, so the pool and the archive members
 * are two independent facts that only agree if something compares them. The comparison runs in both
 * directions - a pool entry with no member would produce a broken image, and a member no entry
 * claims is either a mistake or an attempt to smuggle a file past the type checks.
 *
 * The pool's declared `contentType` is *not* one of the things checked: see
 * `sniffPhotoContentType` for why the bytes decide alone, and `importPhotos.ts` for the extension
 * that gets derived from them.
 *
 * All issues are collected rather than short-circuited: a user fixing a hand-built package should
 * see everything wrong with it at once. **With one exception, for an archive-backed source:** `read`
 * verifies the member it materialises, so the first photo that fails its CRC-32 or will not
 * decompress throws out of the loop and no later issue is reached. That is intended rather than
 * tolerated - the eager path answered such a package with that one accurate message too, and Story
 * 2.34's rule was that moving *when* a member is verified must not move what the client sees. A
 * package the reader cannot read is not a package whose remaining problems are worth enumerating.
 *
 * One photo is resident at a time. Nothing here accumulates the pool - it needs a length and the
 * first twelve bytes of each member and then it is done with it, which is why this can run against a
 * package that is still on disk.
 */
export const validatePackagePhotos = ({
  photos,
  photoBytes,
  referenceCounts,
}: {
  photos: Record<string, PackagePhotoPoolEntry>;
  /**
   * A `Map` from `parseImportPackage`, or the lazy source from `openImportPackage`. An archive-backed
   * source throws `ZipReadError` for a member that fails its CRC-32 or cannot be decompressed; the
   * import route maps that to the same `validation_error` 400 the eager path would have returned.
   */
  photoBytes: PhotoSource | Map<string, Buffer>;
  /**
   * How many times each pool id is referenced by the manifest, from `countPhotoReferences`.
   *
   * Needed for the total-write-volume cap and for nothing else. The schema already bounds the
   * reference *count*, but only here are the two halves of the product in the same place: the
   * manifest knows how often a photo is used and the archive knows how big it is.
   */
  referenceCounts: Map<string, number>;
}): PackagePhotoValidation => {
  const source = toPhotoSource(photoBytes);
  const issues: string[] = [];
  const claimedPaths = new Set<string>();
  let plannedBytes = 0;

  for (const [photoId, entry] of Object.entries(photos)) {
    claimedPaths.add(entry.archivePath);
    if (!source.has(entry.archivePath)) {
      issues.push(`Photo ${photoId} references archive member ${entry.archivePath}, which is not in the package`);
      continue;
    }
    const bytes = source.read(entry.archivePath);
    if (bytes.length === 0) {
      issues.push(`Photo ${photoId} is empty`);
      continue;
    }
    if (bytes.length > MAX_IMPORT_PHOTO_BYTES) {
      issues.push(`Photo ${photoId} exceeds the ${MAX_IMPORT_PHOTO_BYTES} byte image size limit`);
      continue;
    }
    if (!sniffPhotoContentType(bytes)) {
      issues.push(`Photo ${photoId} does not contain JPEG, PNG or WebP image data`);
      continue;
    }
    plannedBytes += bytes.length * (referenceCounts.get(photoId) ?? 0);
  }

  for (const archivePath of source.paths()) {
    if (!claimedPaths.has(archivePath)) {
      issues.push(`Archive member ${archivePath} is not registered in the photo pool`);
    }
  }

  if (plannedBytes > MAX_IMPORT_PHOTO_TOTAL_BYTES) {
    issues.push(
      `Backup plans to write ${plannedBytes} bytes of photos, more than the ${MAX_IMPORT_PHOTO_TOTAL_BYTES} byte limit for one import`,
    );
  }

  return issues.length > 0 ? { ok: false, issues } : { ok: true };
};
