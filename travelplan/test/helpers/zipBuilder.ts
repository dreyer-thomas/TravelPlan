import { crc32, deflateRawSync } from "node:zlib";

/**
 * ZIP *writer* for the import suites, with every field individually corruptible.
 *
 * `src/lib/trips/zipArchive.ts` deliberately cannot produce a bad archive - it validates its own
 * input, only does STORE, and refuses anything that would need ZIP64. Those are the exact cases
 * `src/lib/trips/zipReader.ts` has to survive, so proving the reader rejects them needs a writer
 * that will happily emit them: a wrong CRC, a ZIP64 sentinel, a DEFLATE member, a traversal name.
 *
 * Kept out of `src/` on purpose - nothing in production has any business writing a malformed ZIP.
 */

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;

export type ZipBuildEntry = {
  name: string;
  /** Uncompressed content. Compressed with the chosen method before being written. */
  data: Buffer;
  /** 0 = STORE (default), 8 = DEFLATE, anything else is written verbatim as an unknown method. */
  method?: number;
  /** Overrides the CRC-32 written into both headers. */
  crc?: number;
  /** Overrides the uncompressed size written into both headers. */
  uncompressedSize?: number;
  /** Overrides the local header offset recorded in the central directory. */
  localHeaderOffset?: number;
};

export type ZipBuildOptions = {
  /** Overrides the entry count in the end-of-central-directory record. */
  totalEntries?: number;
  /** Overrides the central directory offset in the end-of-central-directory record. */
  centralDirectoryOffset?: number;
  /** Overrides the central directory size in the end-of-central-directory record. */
  centralDirectorySize?: number;
  comment?: Buffer;
};

export const buildZip = (entries: ZipBuildEntry[], options: ZipBuildOptions = {}): Buffer => {
  const parts: Buffer[] = [];
  const centralDirectory: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const method = entry.method ?? 0;
    const payload = method === 8 ? deflateRawSync(entry.data) : entry.data;
    const crc = entry.crc ?? crc32(entry.data);
    const uncompressedSize = entry.uncompressedSize ?? entry.data.length;
    const nameBytes = Buffer.from(entry.name, "utf8");

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(LOCAL_FILE_HEADER_SIGNATURE, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(33, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(payload.length, 18);
    localHeader.writeUInt32LE(uncompressedSize, 22);
    localHeader.writeUInt16LE(nameBytes.length, 26);
    localHeader.writeUInt16LE(0, 28);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(CENTRAL_DIRECTORY_SIGNATURE, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(33, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(payload.length, 20);
    centralHeader.writeUInt32LE(uncompressedSize, 24);
    centralHeader.writeUInt16LE(nameBytes.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(entry.localHeaderOffset ?? offset, 42);

    parts.push(localHeader, nameBytes, payload);
    centralDirectory.push(Buffer.concat([centralHeader, nameBytes]));
    offset += localHeader.length + nameBytes.length + payload.length;
  }

  const centralDirectoryOffset = offset;
  const centralDirectoryBytes = Buffer.concat(centralDirectory);
  const comment = options.comment ?? Buffer.alloc(0);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(END_OF_CENTRAL_DIRECTORY_SIGNATURE, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(options.totalEntries ?? entries.length, 8);
  eocd.writeUInt16LE(options.totalEntries ?? entries.length, 10);
  eocd.writeUInt32LE(options.centralDirectorySize ?? centralDirectoryBytes.length, 12);
  eocd.writeUInt32LE(options.centralDirectoryOffset ?? centralDirectoryOffset, 16);
  eocd.writeUInt16LE(comment.length, 20);

  return Buffer.concat([...parts, centralDirectoryBytes, eocd, comment]);
};

/** Convenience for the common case: a manifest object plus zero or more photo members. */
export const buildPackage = (
  manifest: unknown,
  photos: { name: string; data: Buffer }[] = [],
  options?: ZipBuildOptions,
) =>
  buildZip(
    [
      { name: "trip.json", data: Buffer.from(JSON.stringify(manifest), "utf8") },
      ...photos.map((photo) => ({ name: photo.name, data: photo.data })),
    ],
    options,
  );
