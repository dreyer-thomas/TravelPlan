import fs from "node:fs/promises";
import { crc32 } from "node:zlib";

/**
 * Minimal, dependency-free ZIP writer (STORE only).
 *
 * Why hand-rolled: every runtime dependency is a standing `npm audit --omit=dev --audit-level=low`
 * obligation, and Story 6.8 already set the precedent of solving an export format without adding a
 * library. A STORE-only writer against a frozen 1989 file format is a small, fixed amount of code.
 *
 * Why STORE and not DEFLATE: the payload is JPEG/PNG/WebP, all already entropy-coded. Deflating them
 * typically grows them and buys a second failure mode. The manifest is the only compressible member
 * and it is small.
 *
 * Determinism is a contract, not a nicety (Story 2.31 AC7): every timestamp in the output comes from
 * the caller-supplied `modifiedAt`. There is deliberately no `new Date()` in this module.
 *
 * Layout references: PKWARE APPNOTE 6.3.10 §4.3.7 (local file header), §4.3.12 (central directory
 * header), §4.3.16 (end of central directory).
 */

export type ZipEntrySource = { kind: "buffer"; data: Buffer } | { kind: "file"; path: string };

export type ZipEntry = {
  /** Archive member name. Forward slashes, no leading slash, no `.`/`..` segments. */
  name: string;
  source: ZipEntrySource;
};

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const LOCAL_FILE_HEADER_SIZE = 30;
const CENTRAL_DIRECTORY_HEADER_SIZE = 46;
const END_OF_CENTRAL_DIRECTORY_SIZE = 22;

const VERSION_MADE_BY = 20;
const VERSION_NEEDED = 20;
/** Bit 11: file name (and comment) are UTF-8 encoded. */
const FLAG_UTF8_NAMES = 0x0800;
const METHOD_STORE = 0;

/** ZIP64 is out of scope; these are the limits the classic 32-bit record fields can express. */
const MAX_UINT32 = 0xffffffff;
const MAX_ENTRY_COUNT = 0xffff;

/** The DOS date field cannot express anything before 1980. */
const DOS_EPOCH_YEAR = 1980;
/** ...nor after 2107: the year is a 7-bit offset from 1980. */
const DOS_MAX_YEAR = 2107;

export class ZipArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipArchiveError";
  }
}

/**
 * MS-DOS date/time, read in UTC so the archive does not shift with the server's timezone.
 *
 * The second field holds seconds/2 - DOS timestamps have two-second resolution.
 */
export const toDosDateTime = (modifiedAt: Date): { dosTime: number; dosDate: number } => {
  // An unrepresentable instant must still yield a writable uint16 pair. Without the upper clamp a
  // year past 2107 overflows the field and `writeUInt16LE` throws from inside the stream - after the
  // response headers are already on the wire, where nothing can turn it back into a 500. An
  // `Invalid Date` (NaN everywhere) would otherwise emit month 0 / day 0, which some extractors
  // flag; it falls back to the DOS epoch instead.
  if (Number.isNaN(modifiedAt.getTime())) {
    return { dosTime: 0, dosDate: (1 << 5) | 1 };
  }

  const year = Math.min(DOS_MAX_YEAR, Math.max(DOS_EPOCH_YEAR, modifiedAt.getUTCFullYear()));
  const month = modifiedAt.getUTCMonth() + 1;
  const day = modifiedAt.getUTCDate();
  const hours = modifiedAt.getUTCHours();
  const minutes = modifiedAt.getUTCMinutes();
  const seconds = modifiedAt.getUTCSeconds();

  return {
    dosTime: (hours << 11) | (minutes << 5) | (seconds >> 1),
    dosDate: ((year - DOS_EPOCH_YEAR) << 9) | (month << 5) | day,
  };
};

const assertUsableName = (name: string) => {
  if (!name) {
    throw new ZipArchiveError("ZIP entry name must not be empty");
  }
  if (name.startsWith("/") || name.includes("\\")) {
    throw new ZipArchiveError(`ZIP entry name must be a relative forward-slash path: ${name}`);
  }
  if (name.split("/").some((segment) => segment === "." || segment === "..")) {
    throw new ZipArchiveError(`ZIP entry name must not contain "." or ".." segments: ${name}`);
  }
};

const buildLocalFileHeader = (params: {
  nameBytes: Buffer;
  crc: number;
  size: number;
  dosTime: number;
  dosDate: number;
}) => {
  const header = Buffer.alloc(LOCAL_FILE_HEADER_SIZE);
  header.writeUInt32LE(LOCAL_FILE_HEADER_SIGNATURE, 0);
  header.writeUInt16LE(VERSION_NEEDED, 4);
  header.writeUInt16LE(FLAG_UTF8_NAMES, 6);
  header.writeUInt16LE(METHOD_STORE, 8);
  header.writeUInt16LE(params.dosTime, 10);
  header.writeUInt16LE(params.dosDate, 12);
  header.writeUInt32LE(params.crc, 14);
  header.writeUInt32LE(params.size, 18);
  header.writeUInt32LE(params.size, 22);
  header.writeUInt16LE(params.nameBytes.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, params.nameBytes]);
};

const buildCentralDirectoryHeader = (params: {
  nameBytes: Buffer;
  crc: number;
  size: number;
  dosTime: number;
  dosDate: number;
  localHeaderOffset: number;
}) => {
  const header = Buffer.alloc(CENTRAL_DIRECTORY_HEADER_SIZE);
  header.writeUInt32LE(CENTRAL_DIRECTORY_SIGNATURE, 0);
  header.writeUInt16LE(VERSION_MADE_BY, 4);
  header.writeUInt16LE(VERSION_NEEDED, 6);
  header.writeUInt16LE(FLAG_UTF8_NAMES, 8);
  header.writeUInt16LE(METHOD_STORE, 10);
  header.writeUInt16LE(params.dosTime, 12);
  header.writeUInt16LE(params.dosDate, 14);
  header.writeUInt32LE(params.crc, 16);
  header.writeUInt32LE(params.size, 20);
  header.writeUInt32LE(params.size, 24);
  header.writeUInt16LE(params.nameBytes.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(params.localHeaderOffset, 42);
  return Buffer.concat([header, params.nameBytes]);
};

const buildEndOfCentralDirectory = (params: { entryCount: number; cdSize: number; cdOffset: number }) => {
  const record = Buffer.alloc(END_OF_CENTRAL_DIRECTORY_SIZE);
  record.writeUInt32LE(END_OF_CENTRAL_DIRECTORY_SIGNATURE, 0);
  record.writeUInt16LE(0, 4);
  record.writeUInt16LE(0, 6);
  record.writeUInt16LE(params.entryCount, 8);
  record.writeUInt16LE(params.entryCount, 10);
  record.writeUInt32LE(params.cdSize, 12);
  record.writeUInt32LE(params.cdOffset, 16);
  record.writeUInt16LE(0, 20);
  return record;
};

/**
 * Streams a STORE-only ZIP archive.
 *
 * One entry is buffered at a time: STORE still needs the CRC and the size *before* the local header,
 * so each file must be read whole - but never more than one concurrently, which keeps peak memory at
 * the largest single member rather than the whole archive.
 *
 * Entry sizing and count are guarded up front where they are knowable synchronously; a file that
 * turns out to be too large is caught before its header is written. A silent 32-bit overflow would
 * produce an archive that looks fine and unpacks to garbage.
 */
export const createZipStream = (entries: ZipEntry[], modifiedAt: Date): ReadableStream<Uint8Array> => {
  if (entries.length > MAX_ENTRY_COUNT) {
    throw new ZipArchiveError(
      `ZIP archive would need ZIP64: ${entries.length} entries exceeds the ${MAX_ENTRY_COUNT} limit`,
    );
  }

  const seenNames = new Set<string>();
  for (const entry of entries) {
    assertUsableName(entry.name);
    if (seenNames.has(entry.name)) {
      throw new ZipArchiveError(`Duplicate ZIP entry name: ${entry.name}`);
    }
    seenNames.add(entry.name);

    if (entry.source.kind === "buffer" && entry.source.data.length >= MAX_UINT32) {
      throw new ZipArchiveError(`ZIP entry would need ZIP64: ${entry.name} is ${entry.source.data.length} bytes`);
    }
  }

  const { dosTime, dosDate } = toDosDateTime(modifiedAt);
  const centralDirectory: Buffer[] = [];
  let offset = 0;
  let index = 0;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (index < entries.length) {
        const entry = entries[index];
        index += 1;

        // One member resident at a time - read, hash, emit, release.
        const data = entry.source.kind === "buffer" ? entry.source.data : await fs.readFile(entry.source.path);

        if (data.length >= MAX_UINT32) {
          throw new ZipArchiveError(`ZIP entry would need ZIP64: ${entry.name} is ${data.length} bytes`);
        }
        if (offset >= MAX_UINT32) {
          throw new ZipArchiveError("ZIP archive would need ZIP64: local header offset exceeds 32 bits");
        }

        const nameBytes = Buffer.from(entry.name, "utf8");
        // Computed once and written into both the local header and the central directory. Two copies
        // that disagree yield an archive some extractors accept and others reject.
        const crc = crc32(data);
        const localHeader = buildLocalFileHeader({ nameBytes, crc, size: data.length, dosTime, dosDate });

        centralDirectory.push(
          buildCentralDirectoryHeader({
            nameBytes,
            crc,
            size: data.length,
            dosTime,
            dosDate,
            localHeaderOffset: offset,
          }),
        );

        controller.enqueue(localHeader);
        controller.enqueue(data);
        offset += localHeader.length + data.length;
        return;
      }

      const cdOffset = offset;
      let cdSize = 0;
      for (const header of centralDirectory) {
        cdSize += header.length;
      }
      // The per-entry guard above bounds each local header's own offset, but the end-of-central-
      // directory record stores the directory's offset and size in their own uint32 fields. Those
      // are only knowable once the last member is written, and an unguarded `writeUInt32LE` would
      // throw a RangeError here - after gigabytes have already been streamed. Check before enqueuing
      // anything, so the failure is a thrown error rather than a truncated archive.
      if (cdOffset >= MAX_UINT32 || cdSize >= MAX_UINT32 || cdOffset + cdSize >= MAX_UINT32) {
        throw new ZipArchiveError("ZIP archive would need ZIP64: central directory exceeds 32-bit offsets");
      }
      for (const header of centralDirectory) {
        controller.enqueue(header);
      }
      controller.enqueue(
        buildEndOfCentralDirectory({ entryCount: centralDirectory.length, cdSize, cdOffset }),
      );
      controller.close();
    },
  });
};
