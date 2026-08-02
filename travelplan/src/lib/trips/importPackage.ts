import { MAX_IMPORT_PHOTO_BYTES, MAX_IMPORT_PHOTO_TOTAL_BYTES } from "@/lib/trips/importLimits";
import { readZipMembers, ZipReadError } from "@/lib/trips/zipReader";

/**
 * Turns the bytes of an uploaded backup into a manifest plus its photo members.
 *
 * Two container shapes reach this function and both have to work (AC1 and AC2):
 *
 * - a **v2 package**: the ZIP Story 2.31 writes - a `trip.json` manifest and real photo files under
 *   `photos/`;
 * - a **v1 backup**: a bare `.json` file, which is the same manifest minus the v2 additions and with
 *   no photos at all.
 *
 * The two are told apart by magic bytes rather than by the upload's filename or MIME type, both of
 * which are client-supplied and neither of which is trustworthy. `PK\x03\x04` is a ZIP with at least
 * one member; `PK\x05\x06` is an empty archive, whose first record *is* the end-of-central-directory.
 *
 * Nothing here throws: every failure is returned as a code the route maps onto the `{ data, error }`
 * envelope, because "this file is not a valid backup" is a 400 and never a 500.
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

export type ImportPackageFailure = {
  /** Mirrors the route's error codes: a bare file that is not JSON is `invalid_json`, the rest are validation. */
  code: "invalid_json" | "validation_error";
  message: string;
};

export type ImportPackageResult =
  | { ok: true; value: ImportPackage }
  | ({ ok: false } & ImportPackageFailure);

const looksLikeZip = (bytes: Buffer) => {
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    return false;
  }
  const marker = (bytes[2] << 8) | bytes[3];
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

export const parseImportPackage = (bytes: Buffer): ImportPackageResult => {
  if (bytes.length === 0) {
    return { ok: false, code: "validation_error", message: "Backup file is empty" };
  }

  if (!looksLikeZip(bytes)) {
    // v1: the whole file is the manifest. `invalid_json` keeps the wire behaviour a user of the old
    // format already knows - a corrupt JSON backup reported the same way before this story.
    try {
      return { ok: true, value: { manifest: JSON.parse(bytes.toString("utf8")), photoBytes: new Map() } };
    } catch {
      return { ok: false, code: "invalid_json", message: "Backup file must be valid JSON or a ZIP archive" };
    }
  }

  let members;
  try {
    members = readZipMembers(bytes);
  } catch (error) {
    if (error instanceof ZipReadError) {
      return { ok: false, code: "validation_error", message: error.message };
    }
    throw error;
  }

  const manifestMember = members.find((member) => member.name === MANIFEST_MEMBER_NAME);
  if (!manifestMember) {
    return { ok: false, code: "validation_error", message: "Archive is missing its trip.json manifest" };
  }

  let manifest: unknown;
  try {
    manifest = JSON.parse(manifestMember.data.toString("utf8"));
  } catch {
    return { ok: false, code: "validation_error", message: "Archive manifest trip.json is not valid JSON" };
  }

  const photoBytes = new Map<string, Buffer>();
  for (const member of members) {
    if (member.name === MANIFEST_MEMBER_NAME || isArchiveBookkeeping(member.name)) {
      continue;
    }
    if (!member.name.startsWith(PHOTO_MEMBER_PREFIX)) {
      // `validatePackagePhotos` refuses an unregistered member *under* `photos/` on anti-smuggling
      // grounds. Silently dropping everything else made that check dodgeable by renaming the member
      // out of the prefix, which is not a distinction worth defending: a v2 package contains
      // `trip.json` and photos, and nothing else is meaningful to this reader.
      return {
        ok: false,
        code: "validation_error",
        message: `Archive contains a member that is neither trip.json nor a photo: ${member.name}`,
      };
    }
    photoBytes.set(member.name, member.data);
  }

  return { ok: true, value: { manifest, photoBytes } };
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
 * see everything wrong with it at once.
 */
export const validatePackagePhotos = ({
  photos,
  photoBytes,
  referenceCounts,
}: {
  photos: Record<string, PackagePhotoPoolEntry>;
  photoBytes: Map<string, Buffer>;
  /**
   * How many times each pool id is referenced by the manifest, from `countPhotoReferences`.
   *
   * Needed for the total-write-volume cap and for nothing else. The schema already bounds the
   * reference *count*, but only here are the two halves of the product in the same place: the
   * manifest knows how often a photo is used and the archive knows how big it is.
   */
  referenceCounts: Map<string, number>;
}): PackagePhotoValidation => {
  const issues: string[] = [];
  const claimedPaths = new Set<string>();
  let plannedBytes = 0;

  for (const [photoId, entry] of Object.entries(photos)) {
    claimedPaths.add(entry.archivePath);
    const bytes = photoBytes.get(entry.archivePath);
    if (!bytes) {
      issues.push(`Photo ${photoId} references archive member ${entry.archivePath}, which is not in the package`);
      continue;
    }
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

  for (const archivePath of photoBytes.keys()) {
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
