import { readSync } from "node:fs";
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
 * - the end-of-central-directory record is found by a *bounded* backward scan over the archive's
 *   tail, so a file full of near-miss signatures cannot turn the lookup into an O(n) sweep of a
 *   300 MB archive;
 * - the **central directory** is the authority, and each member's bytes are located through its
 *   `localHeaderOffset`. A local header and a central directory record that disagree is the classic
 *   malformed-archive case, and trusting the local header is how a reader gets walked off the end of
 *   the file;
 * - ZIP64 sentinels (`0xFFFF` / `0xFFFFFFFF`) are rejected rather than read as literal values. The
 *   writer cannot emit ZIP64, so a sentinel here is either corruption or an attempt to make the
 *   reader address the wrong bytes;
 * - member names that are absolute, contain a backslash, or contain a `.`/`..` segment are rejected,
 *   mirroring `assertUsableName` in the writer. Nothing downstream is allowed to join a member name
 *   onto a filesystem path, but rejecting here means a traversal name never reaches that decision;
 * - CRC-32 and the declared uncompressed size of every member are verified;
 * - total uncompressed output is capped, and so is any *single* member, so a zip bomb fails fast
 *   instead of exhausting memory.
 *
 * Every read is bounds-checked before it happens: a `RangeError` escaping from `Buffer.readUInt32LE`
 * would surface as a 500 on a request that is really just a bad upload. Everything throws
 * `ZipReadError`, which callers map to a `validation_error` 400.
 *
 * **Where the bytes come from is the caller's business** (Story 2.34). The reader addresses the
 * archive through a `ZipByteSource` rather than a `Buffer`, so the import route can hand it a file
 * descriptor over a temp file and never hold the archive in memory. That moved the bounds checking
 * from "is this offset inside a buffer" to "is this offset inside the source", which is the one
 * thing that had to stay exactly as strict: an unguarded `fs.readSync` at an attacker-chosen offset
 * is a worse bug than the `RangeError` this reader was already written to avoid. `ZipByteSource.read`
 * is the single choke point for *addressing*: an out-of-range offset or length, and a short read at
 * the tail, both come back as `ZipReadError` rather than as a `RangeError` or a buffer with an
 * uninitialised tail. It is not a guarantee about I/O - an `EBADF` or `EIO` out of `readSync` is a
 * real fault on this box, not a bad upload, and is deliberately left to propagate as the raw `Error`
 * the route answers with a 500.
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

/**
 * A random-access view of an archive's bytes.
 *
 * A ZIP is read end-first - the end-of-central-directory record is at the tail, the central
 * directory it names is just before it, and each member is located by an offset recorded there - so
 * seeking is the natural access pattern and always was. Only the *supply* of bytes changed.
 *
 * `read` must return exactly `length` bytes at `offset` or throw `ZipReadError`. Returning fewer
 * (a short read, a truncated file) is a failure, not a partial success: every caller below has
 * already decided how many bytes the record it is parsing needs. The returned buffer is read-only by
 * convention and may alias the source's own storage.
 *
 * `ownsReads` says it does not alias: every `read` hands back a freshly allocated buffer nobody else
 * holds. That is worth declaring because `readMember` otherwise has to copy a STORE member out of
 * whatever it was handed, and for a 15 MB photo that copy is a second 15 MB allocation per member
 * for no benefit - a file source has already done the allocating.
 */
export type ZipByteSource = {
  size: number;
  ownsReads?: boolean;
  read(offset: number, length: number): Buffer;
};

const assertInsideSource = (size: number, offset: number, length: number) => {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset + length > size
  ) {
    throw new ZipReadError("Archive is truncated: a record points outside the file");
  }
};

/** The in-memory source: a v1 JSON upload, a test fixture, or any archive already resident. */
export const bufferByteSource = (buffer: Buffer): ZipByteSource => ({
  size: buffer.length,
  read(offset, length) {
    assertInsideSource(buffer.length, offset, length);
    return buffer.subarray(offset, offset + length);
  },
});

/**
 * The disk source: the import route's temp file, read through an already-open descriptor.
 *
 * `size` is passed in rather than `fstat`-ed per call so the bounds check cannot race a file that
 * grows underneath it, and the loop is what makes a short read a `ZipReadError` instead of a buffer
 * with an uninitialised tail - `readSync` is allowed to return fewer bytes than asked for.
 */
export const fileByteSource = (fd: number, size: number): ZipByteSource => ({
  size,
  ownsReads: true,
  read(offset, length) {
    assertInsideSource(size, offset, length);
    if (length === 0) {
      return Buffer.alloc(0);
    }
    const target = Buffer.allocUnsafe(length);
    let filled = 0;
    while (filled < length) {
      const read = readSync(fd, target, filled, length - filled, offset + filled);
      if (read === 0) {
        throw new ZipReadError("Archive is truncated: the file ended inside a record it declares");
      }
      filled += read;
    }
    return target;
  },
});

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
 * Ceiling on the *decompressed* size of a whole archive - the decompression-bomb guard.
 *
 * A DEFLATE member can expand by orders of magnitude, so what the route accepted on the wire says
 * nothing about how much this reader would produce. Summing the central directory's declared
 * uncompressed sizes before reading anything is what makes a bomb fail immediately.
 *
 * **It has to clear `MAX_IMPORT_PACKAGE_BYTES`, and for a while it did not.** This app writes
 * STORE-only archives of already-entropy-coded photos, so a backup expands to essentially its own
 * size - which means a cap *below* what the route accepts rejects archives the route just took. The
 * 2026-08-02 stopgap raised `MAX_IMPORT_PACKAGE_BYTES` from 100 MB to 300 MB for the 113 MB and
 * 217 MB production trips and left this constant at 200 MB, so the 217 MB trip stayed unrestorable -
 * it simply failed one ceiling later, with "Archive expands to more data than the import limit
 * allows" instead of a size error. Found and fixed by Story 2.34, which raised this constant to
 * 400 MB after measuring the 217 MB backup against it by hand.
 *
 * 400 MB is a third of headroom over the largest package the route will accept, which is enough that
 * no legitimate, incompressible backup can trip it, while a bomb - which expands by 100× or 1000×,
 * not by 1.3× - still fails on the central directory before a byte is inflated. This is a cap on the
 * *archive*, though, and on its own it says nothing about one allocation: see
 * `MAX_MEMBER_UNCOMPRESSED_BYTES` for the per-member ceiling that does, and which is what actually
 * bounds peak memory now that members are materialised one at a time.
 *
 * `tripImportPackage.test.ts` asserts it stays above `MAX_IMPORT_PACKAGE_BYTES`, because the two
 * drifting apart is exactly how the 217 MB trip came to be rejected by a limit nobody had raised.
 */
export const MAX_TOTAL_UNCOMPRESSED_BYTES = 400 * 1024 * 1024;

/**
 * Ceiling on **one** member, applied to both of its declared sizes - the largest single allocation
 * this reader will make.
 *
 * *Single*, and for a DEFLATE member there are two of them live at once: `readMember` holds the
 * `compressedSize` bytes it read off the source while `inflateRawSync` fills `uncompressedSize` bytes
 * beside them, because the input to an inflate cannot be released until the inflate is done. So the
 * per-member peak is up to 2× this number for a compressed member, and exactly this number for a
 * STORE member - which is every member of a package this app produces, since `zipArchive.ts` writes
 * `METHOD_STORE` for the manifest as well as the photos. A DEFLATE member only ever arrives from a
 * backup someone re-zipped with Finder or Explorer, which this reader accepts on purpose. That is a
 * bound either way, which is what matters; it is just not the single allocation the first line would
 * suggest on its own.
 *
 * The whole-archive cap above is a cap on a *sum*, and a sum bounds nothing about a single
 * `inflateRawSync`. Until 2026-08-03 nothing else did either, and the arithmetic was measured rather
 * than argued: one zeroed DEFLATE member declaring 398,458,880 bytes under `photos/` is 378 KB on the
 * wire and produced 771 MB of peak RSS on the 3.8 GB no-swap box this runs on - from an upload small
 * enough that neither `content-length` nor `MAX_IMPORT_PACKAGE_BYTES` had anything to say about it.
 * `MAX_IMPORT_PHOTO_BYTES` does not help, because `validatePackagePhotos` applies it to bytes
 * `PhotoSource.read` has already returned.
 *
 * So this is checked in the central-directory loop, per entry, for the same reason the running total
 * is: the bomb has to fail before a byte is inflated.
 *
 * **Both sizes, because `readMember` allocates twice.** It reads `compressedSize` bytes off the
 * source and *then* inflates them, so capping the uncompressed size alone left the first allocation
 * unbounded: a member declaring `uncompressedSize: 1024` with 300 MB of incompressible DEFLATE
 * payload passed the check above and still made `source.read` allocate 300 MB, which is peak memory
 * tracking the archive again - the exact coupling Story 2.34 exists to remove. A genuine DEFLATE
 * member is never meaningfully larger compressed than uncompressed, so one number covers both and
 * the compressed check refuses nothing a real archive contains.
 *
 * **Why 64 MB.** Only two kinds of member exist in a package this app produces. Photos are capped at
 * `MAX_IMPORT_PHOTO_BYTES` (15 MB) by `validatePackagePhotos`, so 64 MB is four times the largest
 * photo any upload route would have accepted in the first place. `trip.json` is the other, and its
 * real size is a few hundred kilobytes - orders of magnitude below this. Note what that is *not*: the
 * row caps in `importLimits.ts` do not bound the manifest anywhere near 64 MB (`MAX_IMPORT_DAYS` 7300
 * × `MAX_IMPORT_SEGMENTS_PER_DAY` 200 alone admits far more text than this, and day-plan items per
 * day are not capped at all), so a synthetic manifest can hit this ceiling and be refused with a
 * message about the reader rather than about the schema. That is acceptable for input no export
 * produces, and it is a reason to cap the manifest in the schema rather than a reason to raise this.
 * It rejects nothing genuine, and it is what turns "peak memory is bounded by the largest single
 * member" from a hope into a number.
 */
export const MAX_MEMBER_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;

/**
 * Ceiling on the central directory, which is the one part of the archive still read whole.
 *
 * Its size is a uint32 on the wire, so an archive can ask this reader for a 4 GB allocation before
 * anything has been validated. Nothing real comes close: the entry count is a uint16 (≤ 65535) and
 * every record is at least 46 bytes plus its name, so a maximal directory of 65535 entries with
 * 200-byte names is under 17 MB and a backup this app produces is a few hundred kilobytes. 16 MB
 * therefore rejects nothing that could be genuine while turning an unbounded allocation into a
 * bounded one - and it fails as a `ZipReadError`, not as whatever `Buffer.allocUnsafe` throws.
 */
export const MAX_CENTRAL_DIRECTORY_BYTES = 16 * 1024 * 1024;

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

/**
 * Locate the end-of-central-directory record, reading only the tail it can possibly occupy.
 *
 * The record is 22 bytes plus a comment whose length field is a uint16, so nothing further back than
 * 22 + 0xffff bytes from the end can be it - which is why this needs one bounded read rather than
 * the whole archive. The scan and its disambiguation rule are unchanged from when the archive was a
 * `Buffer`; only the window the offsets are expressed in is new.
 */
const findEndOfCentralDirectory = (source: ZipByteSource) => {
  if (source.size < END_OF_CENTRAL_DIRECTORY_SIZE) {
    throw new ZipReadError("Archive is too small to be a ZIP file");
  }

  const tailLength = Math.min(source.size, END_OF_CENTRAL_DIRECTORY_SIZE + MAX_ARCHIVE_COMMENT_LENGTH);
  const tailStart = source.size - tailLength;
  const tail = source.read(tailStart, tailLength);

  const start = tail.length - END_OF_CENTRAL_DIRECTORY_SIZE;
  const limit = Math.max(0, start - MAX_ARCHIVE_COMMENT_LENGTH);
  for (let offset = start; offset >= limit; offset -= 1) {
    if (tail.readUInt32LE(offset) !== END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      continue;
    }
    // A four-byte signature can occur by chance inside compressed data. The comment length is what
    // disambiguates: in a real EOCD it accounts for exactly the remaining bytes.
    const commentLength = tail.readUInt16LE(offset + 20);
    if (tailStart + offset + END_OF_CENTRAL_DIRECTORY_SIZE + commentLength === source.size) {
      return tailStart + offset;
    }
  }

  throw new ZipReadError("Archive has no end-of-central-directory record");
};

/** Everything the central directory says about one member, plus where its bytes begin. */
export type ZipEntryInfo = {
  name: string;
  uncompressedSize: number;
  compressedSize: number;
  method: number;
  crc: number;
  /** Absolute offset of the member's payload, resolved from its local header during the open. */
  dataStart: number;
};

export type ZipArchive = {
  /** Non-directory members in central-directory order, every name already validated. */
  entries: ZipEntryInfo[];
  /** Materialises exactly one member: decompress, check the declared size, check the CRC-32. */
  readMember(name: string): Buffer;
  /**
   * The member's first `length` bytes, for callers that only need to look at a magic number.
   *
   * A STORE member answers from a `length`-byte read, which is the whole point: sniffing a 15 MB
   * photo should not allocate 15 MB. A DEFLATE member has no addressable prefix, so it falls back to
   * `readMember`. Nothing is verified either way - a prefix cannot be checked against a CRC-32 of
   * the whole member, so callers that need the guarantee must use `readMember`.
   */
  readMemberHead(name: string, length: number): Buffer;
};

/**
 * Validate an archive's structure and return a handle that can produce one member at a time.
 *
 * Everything knowable from the central directory is checked here, before any payload is touched:
 * the ZIP64 sentinels, the split-archive fields, every member name, duplicates, each member's
 * declared uncompressed size, the running uncompressed total, and each member's local header - its
 * signature and the data range it implies. That ordering is deliberate. The two size caps are what
 * make a zip bomb fail before a single byte is inflated, and resolving the local headers up front
 * means a package whose members are unreachable is rejected as a whole rather than half-way through
 * being restored.
 *
 * What is *not* done here is decompression, the declared-size check and the CRC-32 check: those need
 * the member's bytes, and holding all of them is precisely what Story 2.34 removed. `readMember`
 * runs them, one member at a time, and throws the same `ZipReadError` it always did.
 */
export const openZipArchive = (
  source: ZipByteSource,
  options?: { maxTotalUncompressedBytes?: number },
): ZipArchive => {
  const maxTotalUncompressedBytes = options?.maxTotalUncompressedBytes ?? MAX_TOTAL_UNCOMPRESSED_BYTES;
  const eocdOffset = findEndOfCentralDirectory(source);
  const eocd = source.read(eocdOffset, END_OF_CENTRAL_DIRECTORY_SIZE);

  const diskNumber = readU16(eocd, 4, "disk number");
  const centralDirectoryDisk = readU16(eocd, 6, "central directory disk");
  const entriesThisDisk = readU16(eocd, 8, "entry count for this disk");
  const entriesTotal = readU16(eocd, 10, "total entry count");
  const centralDirectorySize = readU32(eocd, 12, "central directory size");
  const centralDirectoryOffset = readU32(eocd, 16, "central directory offset");

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
  if (centralDirectoryOffset + centralDirectorySize > source.size) {
    throw new ZipReadError("Archive central directory extends past the end of the file");
  }
  if (centralDirectorySize > MAX_CENTRAL_DIRECTORY_BYTES) {
    throw new ZipReadError("Archive central directory is larger than this reader will read");
  }

  const centralDirectory = source.read(centralDirectoryOffset, centralDirectorySize);
  const entries: ZipEntryInfo[] = [];
  const seenNames = new Set<string>();
  let cursor = 0;
  let totalUncompressed = 0;

  for (let index = 0; index < entriesTotal; index += 1) {
    if (cursor + CENTRAL_DIRECTORY_HEADER_SIZE > centralDirectory.length) {
      throw new ZipReadError("Archive central directory is truncated");
    }
    if (readU32(centralDirectory, cursor, "central directory signature") !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new ZipReadError(`Archive central directory record ${index} has a bad signature`);
    }

    const flags = readU16(centralDirectory, cursor + 8, "general purpose flags");
    const method = readU16(centralDirectory, cursor + 10, "compression method");
    const expectedCrc = readU32(centralDirectory, cursor + 16, "CRC-32");
    const compressedSize = readU32(centralDirectory, cursor + 20, "compressed size");
    const uncompressedSize = readU32(centralDirectory, cursor + 24, "uncompressed size");
    const nameLength = readU16(centralDirectory, cursor + 28, "name length");
    const extraLength = readU16(centralDirectory, cursor + 30, "extra field length");
    const commentLength = readU16(centralDirectory, cursor + 32, "comment length");
    const localHeaderOffset = readU32(centralDirectory, cursor + 42, "local header offset");

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
    if (cursor + CENTRAL_DIRECTORY_HEADER_SIZE + nameLength > centralDirectory.length) {
      throw new ZipReadError("Archive central directory is truncated");
    }

    const name = centralDirectory
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

    // Per member before per archive: the sum is what catches a thousand small bombs, this is what
    // catches the single big one, and neither has read a payload byte yet.
    if (uncompressedSize > MAX_MEMBER_UNCOMPRESSED_BYTES) {
      throw new ZipReadError(`Archive entry is larger than this reader will read: ${name}`);
    }
    // The compressed side is the *first* allocation `readMember` makes - it reads this many bytes
    // off the source before `inflateRawSync` sees them - so leaving it uncapped left a member free
    // to be 300 MB on disk while declaring a kilobyte uncompressed.
    if (compressedSize > MAX_MEMBER_UNCOMPRESSED_BYTES) {
      throw new ZipReadError(`Archive entry's compressed data is larger than this reader will read: ${name}`);
    }

    totalUncompressed += uncompressedSize;
    if (totalUncompressed > maxTotalUncompressedBytes) {
      throw new ZipReadError("Archive expands to more data than the import limit allows");
    }

    if (!isDirectoryEntry) {
      if (localHeaderOffset < 0 || localHeaderOffset + 4 > source.size) {
        throw new ZipReadError("Archive is truncated: cannot read local file header signature");
      }
      // Read whatever of the 30-byte header the file actually holds, so a header that runs off the
      // end still fails through `readU16`'s own message rather than through the source's generic one.
      const localHeader = source.read(
        localHeaderOffset,
        Math.min(LOCAL_FILE_HEADER_SIZE, source.size - localHeaderOffset),
      );
      if (readU32(localHeader, 0, "local file header signature") !== LOCAL_FILE_HEADER_SIGNATURE) {
        throw new ZipReadError(`Archive entry does not point at a local file header: ${name}`);
      }
      // The local header's own name/extra lengths are the only fields read from it: they are what
      // the data offset is measured from, and the central directory has no equivalent. Everything
      // that describes the *content* still comes from the central directory.
      const localNameLength = readU16(localHeader, 26, "local name length");
      const localExtraLength = readU16(localHeader, 28, "local extra length");
      const dataStart = localHeaderOffset + LOCAL_FILE_HEADER_SIZE + localNameLength + localExtraLength;
      const dataEnd = dataStart + compressedSize;
      if (dataEnd > source.size) {
        throw new ZipReadError(`Archive entry data extends past the end of the file: ${name}`);
      }
      if (method === METHOD_STORE && compressedSize !== uncompressedSize) {
        throw new ZipReadError(`Stored archive entry has mismatched sizes: ${name}`);
      }

      entries.push({ name, uncompressedSize, compressedSize, method, crc: expectedCrc, dataStart });
    }

    cursor += CENTRAL_DIRECTORY_HEADER_SIZE + nameLength + extraLength + commentLength;
  }

  const entryByName = new Map(entries.map((entry) => [entry.name, entry]));

  const requireEntry = (name: string) => {
    const entry = entryByName.get(name);
    if (!entry) {
      // A caller asking for a member the open never listed is a programming error, but it arrives
      // here as bad input would, so it answers as bad input does.
      throw new ZipReadError(`Archive has no entry named: ${name}`);
    }
    return entry;
  };

  const readMember = (name: string): Buffer => {
    const entry = requireEntry(name);

    const raw = source.read(entry.dataStart, entry.compressedSize);
    let data: Buffer;
    if (entry.method === METHOD_STORE) {
      // The copy is what stops a member returned from a `Buffer`-backed archive retaining the whole
      // archive through a subarray. A source that owns its reads has nothing to retain.
      data = source.ownsReads ? raw : Buffer.from(raw);
    } else if (entry.method === METHOD_DEFLATE) {
      if (entry.uncompressedSize === 0) {
        // `maxOutputLength: 0` makes Node throw `ERR_OUT_OF_RANGE` before it decompresses anything,
        // which would report a sound archive as unreadable. Re-zipping a backup with Finder or
        // Explorer really does produce deflated zero-length members, and there is nothing to inflate
        // for one anyway - the CRC and size checks below still run.
        data = Buffer.alloc(0);
      } else {
        // Raw inflate, not `inflateSync`: a ZIP DEFLATE member carries no zlib header. The output
        // cap is a second line of defence behind the running total - a member that lies about its
        // uncompressed size must not be allowed to allocate on the way to being caught.
        try {
          data = inflateRawSync(raw, { maxOutputLength: entry.uncompressedSize });
        } catch {
          throw new ZipReadError(`Archive entry could not be decompressed: ${name}`);
        }
      }
    } else {
      throw new ZipReadError(`Archive entry uses an unsupported compression method (${entry.method}): ${name}`);
    }

    if (data.length !== entry.uncompressedSize) {
      throw new ZipReadError(`Archive entry size does not match its declared size: ${name}`);
    }
    // `crc32` returns an unsigned 32-bit value, matching the header field's own encoding.
    if (crc32(data) !== entry.crc) {
      throw new ZipReadError(`Archive entry failed its CRC-32 check: ${name}`);
    }

    return data;
  };

  return {
    entries,
    readMember,
    readMemberHead(name, length) {
      const entry = requireEntry(name);
      if (entry.method !== METHOD_STORE) {
        return readMember(name).subarray(0, length);
      }
      return source.read(entry.dataStart, Math.min(length, entry.compressedSize));
    },
  };
};

/**
 * Parse an archive into its members, in central-directory order, all resident at once.
 *
 * The eager form of `openZipArchive`, kept for the two callers that genuinely have the whole archive
 * in memory already: `parseImportPackage`'s buffer entry point and the suites built around it. The
 * disk-backed import route uses `openZipArchive` directly - materialising everything is exactly what
 * Story 2.34 stopped doing.
 */
export const readZipMembers = (
  buffer: Buffer,
  options?: { maxTotalUncompressedBytes?: number },
): ZipMember[] => {
  const archive = openZipArchive(bufferByteSource(buffer), options);
  return archive.entries.map((entry) => ({ name: entry.name, data: archive.readMember(entry.name) }));
};
