/**
 * Minimal in-process ZIP reader for the export suites.
 *
 * Deliberately parses the *central directory* rather than trusting a single extractor: the classic
 * failure mode of a hand-rolled writer is a local header and a central directory record that
 * disagree, which produces an archive one tool opens and another rejects. Reading both back and
 * comparing is the only way a unit test catches that.
 *
 * In-process on purpose - shelling out to `unzip` would make the suite depend on host tooling.
 */

export const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
export const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
export const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;

export type ZipReaderEntry = {
  name: string;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  flags: number;
  method: number;
  dosTime: number;
  dosDate: number;
  localHeaderOffset: number;
  /** Signature found at `localHeaderOffset`, so a test can assert the pointer actually lands on one. */
  localHeaderSignature: number;
  data: Buffer;
};

export type ZipReaderArchive = {
  entries: ZipReaderEntry[];
  entriesThisDisk: number;
  entriesTotal: number;
  centralDirectorySize: number;
  centralDirectoryOffset: number;
};

const findEndOfCentralDirectory = (buffer: Buffer) => {
  for (let offset = buffer.length - 22; offset >= 0; offset -= 1) {
    if (buffer.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      return offset;
    }
  }
  throw new Error("No end-of-central-directory record found");
};

export const readZipArchive = (buffer: Buffer): ZipReaderArchive => {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const entriesThisDisk = buffer.readUInt16LE(eocdOffset + 8);
  const entriesTotal = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);

  const entries: ZipReaderEntry[] = [];
  let cursor = centralDirectoryOffset;

  for (let index = 0; index < entriesTotal; index += 1) {
    const signature = buffer.readUInt32LE(cursor);
    if (signature !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error(`Bad central directory signature at ${cursor}: 0x${signature.toString(16)}`);
    }

    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const dosTime = buffer.readUInt16LE(cursor + 12);
    const dosDate = buffer.readUInt16LE(cursor + 14);
    const crc32 = buffer.readUInt32LE(cursor + 16);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");

    const localHeaderSignature = buffer.readUInt32LE(localHeaderOffset);
    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;

    entries.push({
      name,
      crc32,
      compressedSize,
      uncompressedSize,
      flags,
      method,
      dosTime,
      dosDate,
      localHeaderOffset,
      localHeaderSignature,
      data: buffer.subarray(dataStart, dataStart + compressedSize),
    });

    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return {
    entries,
    entriesThisDisk,
    entriesTotal,
    centralDirectorySize,
    centralDirectoryOffset,
  };
};

/** Convenience: entry names in central-directory order. */
export const readZipEntryNames = (buffer: Buffer) => readZipArchive(buffer).entries.map((entry) => entry.name);

/** Convenience: `name -> bytes`. */
export const readZipEntryMap = (buffer: Buffer) =>
  new Map(readZipArchive(buffer).entries.map((entry) => [entry.name, entry.data]));
