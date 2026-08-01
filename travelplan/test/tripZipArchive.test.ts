import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { crc32 } from "node:zlib";
import { createZipStream, toDosDateTime, type ZipEntry } from "@/lib/trips/zipArchive";
import {
  CENTRAL_DIRECTORY_SIGNATURE,
  END_OF_CENTRAL_DIRECTORY_SIGNATURE,
  LOCAL_FILE_HEADER_SIGNATURE,
  readZipArchive,
} from "./helpers/zipReader";

const MODIFIED_AT = new Date("2026-03-04T05:06:08.000Z");

const collect = async (stream: ReadableStream<Uint8Array>) => {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
};

describe("zipArchive", () => {
  let tempDir = "";
  let filePath = "";
  const fileBytes = Buffer.from("photo-bytes-éüß-0123456789", "utf8");

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "travelplan-zip-"));
    filePath = path.join(tempDir, "photo.bin");
    await fs.writeFile(filePath, fileBytes);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const buildEntries = (): ZipEntry[] => [
    { name: "trip.json", source: { kind: "buffer", data: Buffer.from('{"meta":{"formatVersion":2}}', "utf8") } },
    { name: "notes/empty.txt", source: { kind: "buffer", data: Buffer.alloc(0) } },
    { name: "photos/p1.jpg", source: { kind: "file", path: filePath } },
  ];

  it("writes a STORE-only archive whose headers, CRCs and payloads all agree", async () => {
    const entries = buildEntries();
    const archive = await collect(createZipStream(entries, MODIFIED_AT));

    expect(archive.readUInt32LE(0)).toBe(LOCAL_FILE_HEADER_SIGNATURE);

    const parsed = readZipArchive(archive);
    expect(parsed.entriesTotal).toBe(3);
    expect(parsed.entriesThisDisk).toBe(3);
    expect(parsed.entries.map((entry) => entry.name)).toEqual(["trip.json", "notes/empty.txt", "photos/p1.jpg"]);

    // EOCD self-consistency: the central directory really starts and ends where it says it does.
    expect(archive.readUInt32LE(parsed.centralDirectoryOffset)).toBe(CENTRAL_DIRECTORY_SIGNATURE);
    expect(parsed.centralDirectoryOffset + parsed.centralDirectorySize).toBe(archive.length - 22);
    expect(archive.readUInt32LE(archive.length - 22)).toBe(END_OF_CENTRAL_DIRECTORY_SIGNATURE);

    const expectedBytes = new Map<string, Buffer>([
      ["trip.json", Buffer.from('{"meta":{"formatVersion":2}}', "utf8")],
      ["notes/empty.txt", Buffer.alloc(0)],
      ["photos/p1.jpg", fileBytes],
    ]);

    const { dosTime, dosDate } = toDosDateTime(MODIFIED_AT);

    for (const entry of parsed.entries) {
      // Each central-directory pointer lands on a real local header.
      expect(entry.localHeaderSignature).toBe(LOCAL_FILE_HEADER_SIGNATURE);
      expect(entry.method).toBe(0);
      expect(entry.compressedSize).toBe(entry.uncompressedSize);
      // Flag bit 11 declares UTF-8 names.
      expect(entry.flags & 0x0800).toBe(0x0800);
      expect(entry.dosTime).toBe(dosTime);
      expect(entry.dosDate).toBe(dosDate);

      const expected = expectedBytes.get(entry.name);
      expect(expected).toBeDefined();
      expect(Buffer.compare(entry.data, expected as Buffer)).toBe(0);
      expect(entry.uncompressedSize).toBe((expected as Buffer).length);
      expect(entry.crc32).toBe(crc32(entry.data));

      // The local header must repeat exactly what the central directory claims.
      const nameLength = archive.readUInt16LE(entry.localHeaderOffset + 26);
      expect(archive.readUInt16LE(entry.localHeaderOffset + 6)).toBe(entry.flags);
      expect(archive.readUInt16LE(entry.localHeaderOffset + 8)).toBe(0);
      expect(archive.readUInt16LE(entry.localHeaderOffset + 10)).toBe(dosTime);
      expect(archive.readUInt16LE(entry.localHeaderOffset + 12)).toBe(dosDate);
      expect(archive.readUInt32LE(entry.localHeaderOffset + 14)).toBe(entry.crc32);
      expect(archive.readUInt32LE(entry.localHeaderOffset + 18)).toBe(entry.compressedSize);
      expect(archive.readUInt32LE(entry.localHeaderOffset + 22)).toBe(entry.uncompressedSize);
      expect(archive.readUInt16LE(entry.localHeaderOffset + 28)).toBe(0);
      expect(
        archive.subarray(entry.localHeaderOffset + 30, entry.localHeaderOffset + 30 + nameLength).toString("utf8"),
      ).toBe(entry.name);
    }
  });

  it("derives DOS timestamps from the supplied date in UTC and clamps below the DOS epoch", () => {
    expect(toDosDateTime(new Date("2026-03-04T05:06:08.000Z"))).toEqual({
      dosTime: (5 << 11) | (6 << 5) | (8 >> 1),
      dosDate: ((2026 - 1980) << 9) | (3 << 5) | 4,
    });
    // Year clamps to the DOS epoch; the field cannot express anything earlier.
    expect(toDosDateTime(new Date("1970-01-02T00:00:00.000Z")).dosDate).toBe((0 << 9) | (1 << 5) | 2);
  });

  it("keeps an unrepresentable date inside the uint16 fields instead of overflowing them", () => {
    // The year is a 7-bit offset from 1980. Without an upper clamp this overflows the field and
    // `writeUInt16LE` throws from inside the stream - after the response headers have gone out.
    const farFuture = toDosDateTime(new Date("2200-06-15T12:30:20.000Z"));
    expect(farFuture.dosDate).toBe(((2107 - 1980) << 9) | (6 << 5) | 15);
    expect(farFuture.dosDate).toBeLessThanOrEqual(0xffff);
    expect(farFuture.dosTime).toBeLessThanOrEqual(0xffff);

    // An Invalid Date must not emit month 0 / day 0, which is not a legal MS-DOS date.
    const invalid = toDosDateTime(new Date("not a date"));
    expect(invalid).toEqual({ dosTime: 0, dosDate: (1 << 5) | 1 });

    // Both must survive an actual write, which is the failure this guards.
    expect(() => Buffer.alloc(2).writeUInt16LE(farFuture.dosDate)).not.toThrow();
    expect(() => Buffer.alloc(2).writeUInt16LE(invalid.dosDate)).not.toThrow();
  });

  it("produces byte-identical output for the same modifiedAt and different output for another", async () => {
    const first = await collect(createZipStream(buildEntries(), MODIFIED_AT));
    const second = await collect(createZipStream(buildEntries(), MODIFIED_AT));
    expect(Buffer.compare(first, second)).toBe(0);

    const later = await collect(createZipStream(buildEntries(), new Date("2027-01-02T03:04:06.000Z")));
    expect(later.length).toBe(first.length);
    expect(Buffer.compare(later, first)).not.toBe(0);
  });

  it("throws rather than truncating when the archive would need ZIP64", () => {
    const tooMany: ZipEntry[] = Array.from({ length: 0x10000 }, (_, index) => ({
      name: `photos/p${index}.bin`,
      source: { kind: "buffer" as const, data: Buffer.alloc(0) },
    }));

    expect(() => createZipStream(tooMany, MODIFIED_AT)).toThrow(/ZIP64/);
    // One below the limit is still writable, so the guard is on the right side of the boundary.
    expect(() => createZipStream(tooMany.slice(0, 0xffff), MODIFIED_AT)).not.toThrow();
  });

  it("rejects entry names that could escape the archive root", () => {
    const reject = (name: string) =>
      createZipStream([{ name, source: { kind: "buffer", data: Buffer.alloc(1) } }], MODIFIED_AT);

    expect(() => reject("/photos/p1.jpg")).toThrow();
    expect(() => reject("../photos/p1.jpg")).toThrow();
    expect(() => reject("photos/../../p1.jpg")).toThrow();
    expect(() => reject("photos\\p1.jpg")).toThrow();
    expect(() => reject("")).toThrow();
    expect(() =>
      createZipStream(
        [
          { name: "photos/p1.jpg", source: { kind: "buffer", data: Buffer.alloc(1) } },
          { name: "photos/p1.jpg", source: { kind: "buffer", data: Buffer.alloc(1) } },
        ],
        MODIFIED_AT,
      ),
    ).toThrow(/Duplicate/);
  });
});
