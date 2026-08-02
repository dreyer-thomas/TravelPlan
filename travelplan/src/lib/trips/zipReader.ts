import { crc32, inflateRawSync } from "node:zlib";

/**
 * Minimal, dependency-free ZIP reader - the matching half of `zipArchive.ts`.
 *
 * Why hand-rolled: Story 2.31 wrote the archive without a library on purpose (every runtime
 * dependency is a standing `npm audit` obligation), and a reader that needs a library would undo
 * that decision. `test/helpers/zipReader.ts` exists but is deliberately trusting - it reads archives
 * this app just wrote. This one reads bytes an attacker uploaded, which is a different problem.
 *
 * Everything below therefore assumes the input is hostile:
 *
 * - the end-of-central-directory record is found by a *bounded* backward scan, so a file full of
 *   near-miss signatures cannot turn the lookup into an O(n) sweep of a 100 MB buffer;
 * - the **central directory** is the authority, and each member's bytes are located through its
 *   `localHeaderOffset`. A local header and a central directory record that disagree is the classic
 *   malformed-archive case, and trusting the local header is how a reader gets walked off the end of
 *   the buffer;
 * - ZIP64 sentinels (`0xFFFF` / `0xFFFFFFFF`) are rejected rather than read as literal values. The
 *   writer cannot emit ZIP64, so a sentinel here is either corruption or an attempt to make the
 *   reader address the wrong bytes;
 * - member names that are absolute, contain a backslash, or contain a `.`/`..` segment are rejected,
 *   mirroring `assertUsableName` in the writer. Nothing downstream is allowed to join a member name
 *   onto a filesystem path, but rejecting here means a traversal name never reaches that decision;
 * - CRC-32 and the declared uncompressed size of every member are verified;
 * - total uncompressed output is capped, so a zip bomb fails fast instead of exhausting memory.
 *
 * Every read is bounds-checked before it happens: a `RangeError` escaping from `Buffer.readUInt32LE`
 * would surface as a 500 on a request that is really just a bad upload. Everything throws
 * `ZipReadError`, which callers map to a `validation_error` 400.
 *
 * Layout references: PKWARE APPNOTE 6.3.10 §4.3.7, §4.3.12, §4.3.16.
 */

export class ZipReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipReadError";
  }
}

export type ZipMember = {
  name: string;
  data: Buffer;
};

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const LOCAL_FILE_HEADER_SIZE = 30;
const CENTRAL_DIRECTORY_HEADER_SIZE = 46;
const END_OF_CENTRAL_DIRECTORY_SIZE = 22;

/** The archive comment length field is a uint16, so the EOCD cannot sit further back than this. */
const MAX_ARCHIVE_COMMENT_LENGTH = 0xffff;

const ZIP64_SENTINEL_16 = 0xffff;
const ZIP64_SENTINEL_32 = 0xffffffff;

const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

/** Bit 0 of the general purpose flags: the member is encrypted. Nothing here can decrypt it. */
const FLAG_ENCRYPTED = 0x0001;

/**
 * Ceiling on the *decompressed* size of a whole archive.
 *
 * The route already caps the upload at 100 MB, but a DEFLATE member can expand by orders of
 * magnitude, so the compressed cap says nothing about peak memory. 200 MB is comfortably above any
 * real backup (photos are capped at `MAX_IMPORT_PHOTO_BYTES` each and are already entropy-coded, so
 * they barely shrink) and far below what would take the process down.
 */
export const MAX_TOTAL_UNCOMPRESSED_BYTES = 200 * 1024 * 1024;

const readU16 = (buffer: Buffer, offset: number, what: string) => {
  if (offset < 0 || offset + 2 > buffer.length) {
    throw new ZipReadError(`Archive is truncated: cannot read ${what}`);
  }
  return buffer.readUInt16LE(offset);
};

const readU32 = (buffer: Buffer, offset: number, what: string) => {
  if (offset < 0 || offset + 4 > buffer.length) {
    throw new ZipReadError(`Archive is truncated: cannot read ${what}`);
  }
  return buffer.readUInt32LE(offset);
};

/**
 * Reject member names that could be used as a path.
 *
 * This is defence in depth: `importPackage.ts` matches names against a manifest and never joins one
 * onto a directory. But a reader that hands back `../../etc/passwd` as a key is one careless caller
 * away from a traversal, and the writer refuses to produce such a name in the first place.
 */
const assertUsableName = (name: string) => {
  if (!name) {
    throw new ZipReadError("Archive contains an entry with an empty name");
  }
  if (name.startsWith("/") || name.includes("\\")) {
    throw new ZipReadError(`Archive entry name must be a relative forward-slash path: ${name}`);
  }
  if (name.split("/").some((segment) => segment === "." || segment === "..")) {
    throw new ZipReadError(`Archive entry name must not contain "." or ".." segments: ${name}`);
  }
  // A NUL in a name means the producer and the consumer will disagree about where it ends.
  if (name.includes("\u0000")) {
    throw new ZipReadError("Archive entry name contains a NUL byte");
  }
};

const findEndOfCentralDirectory = (buffer: Buffer) => {
  if (buffer.length < END_OF_CENTRAL_DIRECTORY_SIZE) {
    throw new ZipReadError("Archive is too small to be a ZIP file");
  }

  const start = buffer.length - END_OF_CENTRAL_DIRECTORY_SIZE;
  const limit = Math.max(0, start - MAX_ARCHIVE_COMMENT_LENGTH);
  for (let offset = start; offset >= limit; offset -= 1) {
    if (buffer.readUInt32LE(offset) !== END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      continue;
    }
    // A four-byte signature can occur by chance inside compressed data. The comment length is what
    // disambiguates: in a real EOCD it accounts for exactly the remaining bytes.
    const commentLength = buffer.readUInt16LE(offset + 20);
    if (offset + END_OF_CENTRAL_DIRECTORY_SIZE + commentLength === buffer.length) {
      return offset;
    }
  }

  throw new ZipReadError("Archive has no end-of-central-directory record");
};

/**
 * Parse an archive into its members, in central-directory order.
 *
 * The whole archive is resident: it arrived as one request body, and the manifest plus every photo
 * has to be validated before anything is written anyway.
 */
export const readZipMembers = (
  buffer: Buffer,
  options?: { maxTotalUncompressedBytes?: number },
): ZipMember[] => {
  const maxTotalUncompressedBytes = options?.maxTotalUncompressedBytes ?? MAX_TOTAL_UNCOMPRESSED_BYTES;
  const eocdOffset = findEndOfCentralDirectory(buffer);

  const diskNumber = readU16(buffer, eocdOffset + 4, "disk number");
  const centralDirectoryDisk = readU16(buffer, eocdOffset + 6, "central directory disk");
  const entriesThisDisk = readU16(buffer, eocdOffset + 8, "entry count for this disk");
  const entriesTotal = readU16(buffer, eocdOffset + 10, "total entry count");
  const centralDirectorySize = readU32(buffer, eocdOffset + 12, "central directory size");
  const centralDirectoryOffset = readU32(buffer, eocdOffset + 16, "central directory offset");

  if (
    entriesTotal === ZIP64_SENTINEL_16 ||
    entriesThisDisk === ZIP64_SENTINEL_16 ||
    diskNumber === ZIP64_SENTINEL_16 ||
    centralDirectoryDisk === ZIP64_SENTINEL_16 ||
    centralDirectorySize === ZIP64_SENTINEL_32 ||
    centralDirectoryOffset === ZIP64_SENTINEL_32
  ) {
    throw new ZipReadError("ZIP64 archives are not supported");
  }
  if (diskNumber !== 0 || centralDirectoryDisk !== 0) {
    throw new ZipReadError("Split ZIP archives are not supported");
  }
  if (entriesThisDisk !== entriesTotal) {
    throw new ZipReadError("Archive central directory spans multiple disks");
  }
  if (centralDirectoryOffset + centralDirectorySize > buffer.length) {
    throw new ZipReadError("Archive central directory extends past the end of the file");
  }

  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;
  const members: ZipMember[] = [];
  const seenNames = new Set<string>();
  let cursor = centralDirectoryOffset;
  let totalUncompressed = 0;

  for (let index = 0; index < entriesTotal; index += 1) {
    if (cursor + CENTRAL_DIRECTORY_HEADER_SIZE > centralDirectoryEnd) {
      throw new ZipReadError("Archive central directory is truncated");
    }
    if (readU32(buffer, cursor, "central directory signature") !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new ZipReadError(`Archive central directory record ${index} has a bad signature`);
    }

    const flags = readU16(buffer, cursor + 8, "general purpose flags");
    const method = readU16(buffer, cursor + 10, "compression method");
    const expectedCrc = readU32(buffer, cursor + 16, "CRC-32");
    const compressedSize = readU32(buffer, cursor + 20, "compressed size");
    const uncompressedSize = readU32(buffer, cursor + 24, "uncompressed size");
    const nameLength = readU16(buffer, cursor + 28, "name length");
    const extraLength = readU16(buffer, cursor + 30, "extra field length");
    const commentLength = readU16(buffer, cursor + 32, "comment length");
    const localHeaderOffset = readU32(buffer, cursor + 42, "local header offset");

    if (
      compressedSize === ZIP64_SENTINEL_32 ||
      uncompressedSize === ZIP64_SENTINEL_32 ||
      localHeaderOffset === ZIP64_SENTINEL_32
    ) {
      throw new ZipReadError("ZIP64 archives are not supported");
    }
    if ((flags & FLAG_ENCRYPTED) !== 0) {
      throw new ZipReadError("Encrypted ZIP entries are not supported");
    }
    if (cursor + CENTRAL_DIRECTORY_HEADER_SIZE + nameLength > centralDirectoryEnd) {
      throw new ZipReadError("Archive central directory is truncated");
    }

    const name = buffer
      .subarray(cursor + CENTRAL_DIRECTORY_HEADER_SIZE, cursor + CENTRAL_DIRECTORY_HEADER_SIZE + nameLength)
      .toString("utf8");
    assertUsableName(name);
    if (seenNames.has(name)) {
      throw new ZipReadError(`Archive contains duplicate entry: ${name}`);
    }
    seenNames.add(name);

    // Directory entries carry no payload and nothing here consumes them; skipping them keeps a
    // `photos/` folder entry from being mistaken for a zero-byte photo.
    const isDirectoryEntry = name.endsWith("/");

    totalUncompressed += uncompressedSize;
    if (totalUncompressed > maxTotalUncompressedBytes) {
      throw new ZipReadError("Archive expands to more data than the import limit allows");
    }

    if (!isDirectoryEntry) {
      if (readU32(buffer, localHeaderOffset, "local file header signature") !== LOCAL_FILE_HEADER_SIGNATURE) {
        throw new ZipReadError(`Archive entry does not point at a local file header: ${name}`);
      }
      // The local header's own name/extra lengths are the only fields read from it: they are what
      // the data offset is measured from, and the central directory has no equivalent. Everything
      // that describes the *content* still comes from the central directory.
      const localNameLength = readU16(buffer, localHeaderOffset + 26, "local name length");
      const localExtraLength = readU16(buffer, localHeaderOffset + 28, "local extra length");
      const dataStart = localHeaderOffset + LOCAL_FILE_HEADER_SIZE + localNameLength + localExtraLength;
      const dataEnd = dataStart + compressedSize;
      if (dataEnd > buffer.length) {
        throw new ZipReadError(`Archive entry data extends past the end of the file: ${name}`);
      }

      const raw = buffer.subarray(dataStart, dataEnd);
      let data: Buffer;
      if (method === METHOD_STORE) {
        if (compressedSize !== uncompressedSize) {
          throw new ZipReadError(`Stored archive entry has mismatched sizes: ${name}`);
        }
        data = Buffer.from(raw);
      } else if (method === METHOD_DEFLATE) {
        if (uncompressedSize === 0) {
          // `maxOutputLength: 0` makes Node throw `ERR_OUT_OF_RANGE` before it decompresses
          // anything, which would report a sound archive as unreadable. Re-zipping a backup with
          // Finder or Explorer really does produce deflated zero-length members, and there is
          // nothing to inflate for one anyway - the CRC and size checks below still run.
          data = Buffer.alloc(0);
        } else {
          // Raw inflate, not `inflateSync`: a ZIP DEFLATE member carries no zlib header. The output
          // cap is a second line of defence behind the running total - a member that lies about its
          // uncompressed size must not be allowed to allocate on the way to being caught.
          try {
            data = inflateRawSync(raw, { maxOutputLength: uncompressedSize });
          } catch {
            throw new ZipReadError(`Archive entry could not be decompressed: ${name}`);
          }
        }
      } else {
        throw new ZipReadError(`Archive entry uses an unsupported compression method (${method}): ${name}`);
      }

      if (data.length !== uncompressedSize) {
        throw new ZipReadError(`Archive entry size does not match its declared size: ${name}`);
      }
      // `crc32` returns an unsigned 32-bit value, matching the header field's own encoding.
      if (crc32(data) !== expectedCrc) {
        throw new ZipReadError(`Archive entry failed its CRC-32 check: ${name}`);
      }

      members.push({ name, data });
    }

    cursor += CENTRAL_DIRECTORY_HEADER_SIZE + nameLength + extraLength + commentLength;
  }

  return members;
};
