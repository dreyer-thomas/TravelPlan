import { afterEach, describe, expect, it } from "vitest";
import { crc32 } from "node:zlib";
import {
  MAX_IMPORT_PHOTO_BYTES,
  openImportPackage,
  parseImportPackage,
  photoSourceFromMap,
  sniffPhotoContentType,
  validatePackagePhotos,
} from "@/lib/trips/importPackage";
import { MAX_IMPORT_PACKAGE_BYTES, MAX_IMPORT_PHOTO_TOTAL_BYTES } from "@/lib/trips/importLimits";
import {
  bufferByteSource,
  fileByteSource,
  MAX_CENTRAL_DIRECTORY_BYTES,
  MAX_MEMBER_UNCOMPRESSED_BYTES,
  MAX_TOTAL_UNCOMPRESSED_BYTES,
  openZipArchive,
  readZipMembers,
  ZipReadError,
} from "@/lib/trips/zipReader";
import { buildPackage, buildZip, writeZipToTempFile, type TempZipFile } from "./helpers/zipBuilder";
import { jpegBytes, pngBytes, webpBytes } from "./helpers/uploadFixtures";

const MANIFEST = {
  meta: { formatVersion: 2 },
  trip: { name: "Package Trip" },
  days: [],
};

const expectFailure = (result: ReturnType<typeof parseImportPackage>) => {
  if (result.ok) {
    throw new Error("Expected the package to be rejected");
  }
  return result;
};

const expectSuccess = (result: ReturnType<typeof parseImportPackage>) => {
  if (!result.ok) {
    throw new Error(`Expected the package to parse, got: ${result.message}`);
  }
  return result.value;
};

describe("parseImportPackage", () => {
  it("reads the manifest and photo members out of a v2 zip", () => {
    const archive = buildPackage(MANIFEST, [
      { name: "photos/p1.jpg", data: jpegBytes() },
      { name: "photos/p2.png", data: pngBytes() },
    ]);

    const parsed = expectSuccess(parseImportPackage(archive));

    expect(parsed.manifest).toEqual(MANIFEST);
    expect([...parsed.photoBytes.keys()].sort()).toEqual([
      "photos/p1.jpg",
      "photos/p2.png",
    ]);
    expect(parsed.photoBytes.get("photos/p1.jpg")).toEqual(jpegBytes());
  });

  it("treats a bare json file as a v1 backup with no photos", () => {
    const parsed = expectSuccess(
      parseImportPackage(Buffer.from(JSON.stringify(MANIFEST), "utf8")),
    );

    expect(parsed.manifest).toEqual(MANIFEST);
    expect(parsed.photoBytes.size).toBe(0);
  });

  it("sniffs the container by magic bytes rather than by anything the client claims", () => {
    // Same JSON, wrapped in a ZIP: the only difference the sniff can see is `PK\x03\x04`.
    expect(
      expectSuccess(parseImportPackage(buildPackage(MANIFEST))).photoBytes.size,
    ).toBe(0);
    expect(
      parseImportPackage(Buffer.from("PK not really a zip", "utf8")).ok,
    ).toBe(false);
  });

  it("reports a bare file that is not json as invalid_json", () => {
    const result = expectFailure(
      parseImportPackage(Buffer.from("this is not a backup", "utf8")),
    );

    expect(result.code).toBe("invalid_json");
  });

  it("rejects an empty upload", () => {
    expect(expectFailure(parseImportPackage(Buffer.alloc(0))).code).toBe(
      "validation_error",
    );
  });

  it("rejects an archive with no trip.json", () => {
    const archive = buildZip([{ name: "photos/p1.jpg", data: jpegBytes() }]);
    const result = expectFailure(parseImportPackage(archive));

    expect(result.code).toBe("validation_error");
    expect(result.message).toContain("trip.json");
  });

  it("rejects an archive whose trip.json is not json", () => {
    const archive = buildZip([
      { name: "trip.json", data: Buffer.from("{ nope", "utf8") },
    ]);
    const result = expectFailure(parseImportPackage(archive));

    expect(result.code).toBe("validation_error");
    expect(result.message).toContain("not valid JSON");
  });

  it("accepts a deflated member - another tool may legitimately re-zip a backup", () => {
    const archive = buildZip([
      {
        name: "trip.json",
        data: Buffer.from(JSON.stringify(MANIFEST), "utf8"),
        method: 8,
      },
      { name: "photos/p1.webp", data: webpBytes(512), method: 8 },
    ]);

    const parsed = expectSuccess(parseImportPackage(archive));

    expect(parsed.manifest).toEqual(MANIFEST);
    expect(parsed.photoBytes.get("photos/p1.webp")).toEqual(webpBytes(512));
  });

  it("rejects a member whose bytes fail their CRC-32", () => {
    const archive = buildZip([
      {
        name: "trip.json",
        data: Buffer.from(JSON.stringify(MANIFEST), "utf8"),
      },
      { name: "photos/p1.jpg", data: jpegBytes(), crc: 0x1234abcd },
    ]);

    expect(expectFailure(parseImportPackage(archive)).message).toContain(
      "CRC-32",
    );
  });

  it("rejects a member whose declared size does not match its bytes", () => {
    const archive = buildZip([
      {
        name: "trip.json",
        data: Buffer.from(JSON.stringify(MANIFEST), "utf8"),
        uncompressedSize: 9,
      },
    ]);

    expect(expectFailure(parseImportPackage(archive)).code).toBe(
      "validation_error",
    );
  });

  it("rejects a traversal member name instead of handing it to a caller", () => {
    const archive = buildZip([
      {
        name: "trip.json",
        data: Buffer.from(JSON.stringify(MANIFEST), "utf8"),
      },
      { name: "photos/../../escape.jpg", data: jpegBytes() },
    ]);

    expect(expectFailure(parseImportPackage(archive)).message).toContain("..");
  });

  it("rejects an absolute member name", () => {
    const archive = buildZip([
      { name: "/etc/passwd", data: Buffer.from("x", "utf8") },
    ]);

    expect(expectFailure(parseImportPackage(archive)).message).toContain(
      "relative",
    );
  });

  it("rejects ZIP64 sentinels rather than reading them as literal values", () => {
    const archive = buildZip(
      [{ name: "trip.json", data: Buffer.from("{}", "utf8") }],
      {
        centralDirectoryOffset: 0xffffffff,
      },
    );

    expect(expectFailure(parseImportPackage(archive)).message).toContain(
      "ZIP64",
    );
  });

  it("rejects a per-entry ZIP64 size sentinel", () => {
    const archive = buildZip([
      {
        name: "trip.json",
        data: Buffer.from("{}", "utf8"),
        uncompressedSize: 0xffffffff,
      },
    ]);

    expect(expectFailure(parseImportPackage(archive)).message).toContain(
      "ZIP64",
    );
  });

  it("rejects a central directory that points past the end of the file", () => {
    const archive = buildZip(
      [{ name: "trip.json", data: Buffer.from("{}", "utf8") }],
      {
        centralDirectoryOffset: 5,
        centralDirectorySize: 9_999_999,
      },
    );

    expect(expectFailure(parseImportPackage(archive)).code).toBe(
      "validation_error",
    );
  });

  it("rejects a local header offset that does not land on a local header", () => {
    const archive = buildZip([
      {
        name: "trip.json",
        data: Buffer.from("{}", "utf8"),
        localHeaderOffset: 3,
      },
    ]);

    expect(expectFailure(parseImportPackage(archive)).message).toContain(
      "local file header",
    );
  });

  it("rejects duplicate member names, which no consumer could disambiguate", () => {
    const archive = buildZip([
      {
        name: "trip.json",
        data: Buffer.from(JSON.stringify(MANIFEST), "utf8"),
      },
      { name: "photos/p1.jpg", data: jpegBytes() },
      { name: "photos/p1.jpg", data: pngBytes() },
    ]);

    expect(expectFailure(parseImportPackage(archive)).message).toContain(
      "duplicate",
    );
  });

  it("rejects a member that is neither trip.json nor a photo", () => {
    // Renaming `photos/x.png` to `x.png` used to skip the pool/member cross-check entirely: the
    // member was silently dropped instead of being reported as unregistered.
    const archive = buildZip([
      {
        name: "trip.json",
        data: Buffer.from(JSON.stringify(MANIFEST), "utf8"),
      },
      { name: "stowaway.png", data: pngBytes() },
    ]);
    const result = expectFailure(parseImportPackage(archive));

    expect(result.code).toBe("validation_error");
    expect(result.message).toContain("stowaway.png");
  });

  it("ignores the bookkeeping members Finder and Explorer add when a backup is re-zipped", () => {
    // The same re-zip the zero-length-DEFLATE tolerance below exists for also injects directory
    // entries, `__MACOSX/` resource forks and `.DS_Store`. Rejecting those as stowaways would fail
    // a sound archive on files the user never chose to include - and would make that tolerance
    // unreachable, since the stray-member check runs first.
    const archive = buildZip([
      { name: "trip.json", data: Buffer.from(JSON.stringify(MANIFEST), "utf8") },
      { name: "photos/", data: Buffer.alloc(0) },
      { name: "__MACOSX/._trip.json", data: Buffer.from("resource fork", "utf8") },
      { name: "__MACOSX/photos/._p1.jpg", data: Buffer.from("resource fork", "utf8") },
      { name: ".DS_Store", data: Buffer.from("finder metadata", "utf8") },
      { name: "photos/p1.jpg", data: jpegBytes() },
    ]);

    const parsed = expectSuccess(parseImportPackage(archive));

    // Only the real photo is pooled - the bookkeeping members are dropped, not smuggled through as
    // members the pool would then have to account for.
    expect([...parsed.photoBytes.keys()]).toEqual(["photos/p1.jpg"]);
    expect(
      validatePackagePhotos({
        photos: { p1: { contentType: "image/jpeg", archivePath: "photos/p1.jpg" } },
        referenceCounts: new Map([["p1", 1]]),
        photoBytes: parsed.photoBytes,
      }).ok,
    ).toBe(true);
  });

  it("reads a deflated zero-length member instead of failing the whole package", () => {
    // `inflateRawSync(_, { maxOutputLength: 0 })` throws `ERR_OUT_OF_RANGE`, so a sound archive
    // re-zipped by Finder or Explorer used to report as unreadable.
    const archive = buildZip([
      {
        name: "trip.json",
        data: Buffer.from(JSON.stringify(MANIFEST), "utf8"),
      },
      { name: "photos/empty.jpg", data: Buffer.alloc(0), method: 8 },
    ]);

    const parsed = expectSuccess(parseImportPackage(archive));

    expect(parsed.photoBytes.get("photos/empty.jpg")).toEqual(Buffer.alloc(0));
  });

  it("rejects an unsupported compression method", () => {
    const archive = buildZip([
      {
        name: "trip.json",
        data: Buffer.from(JSON.stringify(MANIFEST), "utf8"),
        method: 12,
      },
    ]);

    expect(expectFailure(parseImportPackage(archive)).message).toContain(
      "compression method",
    );
  });
});

describe("readZipMembers", () => {
  it("throws a typed error rather than letting a RangeError escape from a truncated file", () => {
    const archive = buildPackage(MANIFEST);
    const truncated = archive.subarray(0, archive.length - 4);

    expect(() => readZipMembers(truncated)).toThrow(ZipReadError);
  });

  it("finds the record behind an archive comment but gives up before scanning the whole file", () => {
    const withComment = buildPackage(MANIFEST, [], {
      comment: Buffer.from("a trailing comment", "utf8"),
    });

    expect(readZipMembers(withComment).map((member) => member.name)).toEqual([
      "trip.json",
    ]);
  });

  it("caps total uncompressed output so a zip bomb cannot exhaust memory", () => {
    // One highly compressible member: ~1 MB on the wire, far more than the cap once inflated.
    const bomb = Buffer.alloc(4 * 1024 * 1024, 0);
    const archive = buildZip([{ name: "trip.json", data: bomb, method: 8 }]);

    expect(() =>
      readZipMembers(archive, { maxTotalUncompressedBytes: 1024 }),
    ).toThrow(ZipReadError);
    expect(MAX_TOTAL_UNCOMPRESSED_BYTES).toBe(400 * 1024 * 1024);
  });

  it("rejects a single member that declares more than the per-member cap, at open time", () => {
    // The measured bomb, in miniature: one zeroed DEFLATE member that is tiny on the wire and
    // declares far more than any allocation this reader will make. The archive-wide cap says nothing
    // about it - 65 MB is comfortably under 400 MB - so only the per-member cap can catch it.
    const declared = MAX_MEMBER_UNCOMPRESSED_BYTES + 1;
    const archive = buildZip([
      { name: "trip.json", data: Buffer.from("{}", "utf8") },
      { name: "photos/bomb.jpg", data: Buffer.alloc(64 * 1024, 0), method: 8, uncompressedSize: declared },
    ]);

    expect(archive.length).toBeLessThan(MAX_MEMBER_UNCOMPRESSED_BYTES);
    expect(() => openZipArchive(bufferByteSource(archive))).toThrow(ZipReadError);
    expect(() => openZipArchive(bufferByteSource(archive))).toThrow(
      /larger than this reader will read: photos\/bomb\.jpg/,
    );

    // And at *open* time, before a byte is inflated: if the cap only fired on the read, the open
    // would hand back a handle and the allocation would happen the moment anything asked for the
    // member. `openZipArchive` throwing is the whole guarantee.
    let opened = false;
    try {
      openZipArchive(bufferByteSource(archive));
      opened = true;
    } catch {
      // The assertions above already pin the error; this one is about how far the reader got.
    }
    expect(opened).toBe(false);
  });

  it("keeps the per-member cap well above the largest photo any upload route accepts", () => {
    // Same spirit as the ceiling relationship below: the cap only rejects nothing genuine for as
    // long as it stays above the biggest member a real backup can contain, which is a 15 MB day
    // image. Four times that is the headroom, and drift is how a real backup starts failing.
    expect(MAX_MEMBER_UNCOMPRESSED_BYTES).toBe(64 * 1024 * 1024);
    expect(MAX_MEMBER_UNCOMPRESSED_BYTES).toBeGreaterThan(MAX_IMPORT_PHOTO_BYTES * 4 - 1);
    expect(MAX_MEMBER_UNCOMPRESSED_BYTES).toBeLessThan(MAX_TOTAL_UNCOMPRESSED_BYTES);
  });

  it("keeps the bomb cap above what the route will accept, so a STORE backup cannot fail it", () => {
    // The 2026-08-02 stopgap raised `MAX_IMPORT_PACKAGE_BYTES` to 300 MB for the 217 MB production
    // trip and left this at 200 MB, so that backup was accepted on the wire and then rejected by the
    // reader. A STORE-only archive of already-compressed photos expands to its own size, so the
    // relationship between these two numbers is the whole of whether a real backup is restorable.
    expect(MAX_TOTAL_UNCOMPRESSED_BYTES).toBeGreaterThan(MAX_IMPORT_PACKAGE_BYTES);
  });

  it("skips directory entries so an empty folder is not mistaken for a zero-byte photo", () => {
    const archive = buildZip([
      { name: "photos/", data: Buffer.alloc(0) },
      { name: "trip.json", data: Buffer.from("{}", "utf8") },
    ]);

    expect(readZipMembers(archive).map((member) => member.name)).toEqual([
      "trip.json",
    ]);
  });

  it("reads member bytes through the central directory's own crc, size and offset", () => {
    const data = pngBytes(1024);
    const archive = buildZip([{ name: "photos/p1.png", data }]);
    const [member] = readZipMembers(archive);

    expect(member.name).toBe("photos/p1.png");
    expect(crc32(member.data)).toBe(crc32(data));
    expect(Buffer.compare(member.data, data)).toBe(0);
  });
});

/**
 * The same reader, addressed through a file descriptor instead of a `Buffer`.
 *
 * This is the half Story 2.34 added and the half the import route actually takes, so every bounds
 * check that used to be "is this offset inside a buffer" needs proving again as "is this offset
 * inside the file". A `RangeError` from `Buffer.readUInt32LE` was always the failure this reader was
 * written to avoid; an unguarded `fs.readSync` at an attacker-chosen offset is the worse version of
 * it, and only these tests can tell the two apart.
 */
describe("openZipArchive over a file source", () => {
  let fixture: TempZipFile | null = null;

  const onDisk = (bytes: Buffer) => {
    fixture = writeZipToTempFile(bytes);
    return fileByteSource(fixture.fd, fixture.size);
  };

  afterEach(() => {
    fixture?.close();
    fixture = null;
  });

  it("reads a good archive's members from disk, byte for byte", () => {
    const photo = pngBytes(4096);
    const archive = openZipArchive(
      onDisk(buildPackage(MANIFEST, [{ name: "photos/p1.png", data: photo }])),
    );

    expect(archive.entries.map((entry) => entry.name)).toEqual(["trip.json", "photos/p1.png"]);
    expect(JSON.parse(archive.readMember("trip.json").toString("utf8"))).toEqual(MANIFEST);
    expect(Buffer.compare(archive.readMember("photos/p1.png"), photo)).toBe(0);
  });

  it("rejects a truncated central directory instead of reading past the end of the file", () => {
    const source = onDisk(
      buildZip([{ name: "trip.json", data: Buffer.from("{}", "utf8") }], {
        totalEntries: 4,
      }),
    );

    expect(() => openZipArchive(source)).toThrow(ZipReadError);
    expect(() => openZipArchive(source)).toThrow(/central directory is truncated/);
  });

  it("rejects a central directory that points past the end of the file", () => {
    const source = onDisk(
      buildZip([{ name: "trip.json", data: Buffer.from("{}", "utf8") }], {
        centralDirectoryOffset: 5,
        centralDirectorySize: 9_999_999,
      }),
    );

    expect(() => openZipArchive(source)).toThrow(/extends past the end of the file/);
  });

  it("refuses an escaping member name before it can be handed to anything", () => {
    const source = onDisk(
      buildZip([
        { name: "trip.json", data: Buffer.from("{}", "utf8") },
        { name: "photos/../../escape.jpg", data: jpegBytes() },
      ]),
    );

    expect(() => openZipArchive(source)).toThrow(/".." segments/);
  });

  it("rejects a ZIP64 sentinel rather than seeking to whatever it decodes as", () => {
    const source = onDisk(
      buildZip([{ name: "trip.json", data: Buffer.from("{}", "utf8") }], {
        centralDirectoryOffset: 0xffffffff,
      }),
    );

    expect(() => openZipArchive(source)).toThrow(/ZIP64/);
  });

  it("fails a member whose bytes do not match its CRC-32, at the moment it is read", () => {
    const archive = openZipArchive(
      onDisk(
        buildZip([
          { name: "trip.json", data: Buffer.from("{}", "utf8") },
          { name: "photos/p1.jpg", data: jpegBytes(), crc: 0x1234abcd },
        ]),
      ),
    );

    // The open succeeds - nothing in the central directory is wrong - and the CRC is what the lazy
    // read is for. Both halves matter: `trip.json` must still come back.
    expect(archive.readMember("trip.json").toString("utf8")).toBe("{}");
    expect(() => archive.readMember("photos/p1.jpg")).toThrow(/CRC-32/);
  });

  it("turns a short read at the tail into a ZipReadError, not a buffer of uninitialised bytes", () => {
    // A source that claims more bytes than the file holds is what a truncated upload looks like from
    // the inside: the descriptor is fine, the arithmetic is not.
    const bytes = buildPackage(MANIFEST);
    fixture = writeZipToTempFile(bytes);
    const overlongSource = fileByteSource(fixture.fd, bytes.length + 64);

    expect(() => openZipArchive(overlongSource)).toThrow(ZipReadError);
  });

  it("refuses a read outside the source instead of seeking there", () => {
    const bytes = buildPackage(MANIFEST);
    fixture = writeZipToTempFile(bytes);
    const source = fileByteSource(fixture.fd, fixture.size);

    for (const [offset, length] of [
      [-1, 4],
      [0, -1],
      [bytes.length - 1, 2],
      [Number.MAX_SAFE_INTEGER, 4],
    ]) {
      expect(() => source.read(offset, length)).toThrow(ZipReadError);
    }
  });

  it("caps the central directory it will allocate for, as a ZipReadError and not a RangeError", () => {
    // The cap only gets a turn once the *sum* check ahead of it passes, so the file has to be bigger
    // than the cap for the declared directory to fit inside it at all. Padding the front is the
    // cheapest way there: the archive's own records stay at the tail where the EOCD scan finds them.
    // Asserting the message is the point - with a small fixture this test passed on "extends past the
    // end of the file" and the cap could have been deleted without failing anything.
    const archive = buildZip([{ name: "trip.json", data: Buffer.from("{}", "utf8") }], {
      centralDirectoryOffset: 0,
      centralDirectorySize: MAX_CENTRAL_DIRECTORY_BYTES + 1,
    });
    const source = onDisk(Buffer.concat([Buffer.alloc(MAX_CENTRAL_DIRECTORY_BYTES + 64), archive]));

    expect(() => openZipArchive(source)).toThrow(ZipReadError);
    expect(() => openZipArchive(source)).toThrow(/central directory is larger than this reader will read/);
    expect(MAX_CENTRAL_DIRECTORY_BYTES).toBe(16 * 1024 * 1024);
  });

  it("caps a member's declared compressed size, which is the read that happens before any inflate", () => {
    // The mirror of the inflate bomb the per-member uncompressed cap closed. `readMember` reads
    // `compressedSize` bytes off the source *first* and only then inflates them, so a member is free
    // to declare a kilobyte uncompressed while pointing at hundreds of megabytes of payload - and the
    // allocation is the archive's size again, which is exactly the coupling this story removed.
    const source = onDisk(
      buildZip([
        { name: "trip.json", data: Buffer.from(JSON.stringify(MANIFEST), "utf8") },
        {
          name: "photos/bomb.jpg",
          data: jpegBytes(64),
          method: 8,
          uncompressedSize: 1024,
          compressedSize: MAX_MEMBER_UNCOMPRESSED_BYTES + 1,
        },
      ]),
    );

    // At open time, from the central directory, before a payload byte is touched.
    expect(() => openZipArchive(source)).toThrow(
      /compressed data is larger than this reader will read: photos\/bomb\.jpg/,
    );
  });

  it("answers readMemberHead for a DEFLATE member by inflating it, because there is no prefix to address", () => {
    // `zipArchive.ts` only ever writes STORE, so the twelve-byte read is what this app's own exports
    // get. A backup re-zipped by Finder or Explorer is DEFLATE, and the documented fallback is a full
    // `readMember` - which has to still return the right bytes, or the content-type sniff in
    // `tripRepo` reads garbage for precisely the archives users hand-make.
    const photo = pngBytes(4096);
    const archive = openZipArchive(
      onDisk(
        buildZip([
          { name: "trip.json", data: Buffer.from(JSON.stringify(MANIFEST), "utf8") },
          { name: "photos/p1.png", data: photo, method: 8 },
        ]),
      ),
    );

    expect(Buffer.compare(archive.readMemberHead("photos/p1.png", 12), photo.subarray(0, 12))).toBe(0);
  });

  it("reads the same archive identically from memory and from disk", () => {
    const bytes = buildPackage(MANIFEST, [{ name: "photos/p1.jpg", data: jpegBytes(2048) }]);
    fixture = writeZipToTempFile(bytes);

    const fromMemory = openZipArchive(bufferByteSource(bytes));
    const fromDisk = openZipArchive(fileByteSource(fixture.fd, fixture.size));

    expect(fromDisk.entries).toEqual(fromMemory.entries);
    expect(
      Buffer.compare(fromDisk.readMember("photos/p1.jpg"), fromMemory.readMember("photos/p1.jpg")),
    ).toBe(0);
  });
});

describe("openImportPackage", () => {
  let fixture: TempZipFile | null = null;

  const onDisk = (bytes: Buffer) => {
    fixture = writeZipToTempFile(bytes);
    return fileByteSource(fixture.fd, fixture.size);
  };

  afterEach(() => {
    fixture?.close();
    fixture = null;
  });

  it("parses the manifest eagerly and leaves the photos on disk", () => {
    const result = openImportPackage(
      onDisk(
        buildPackage(MANIFEST, [
          { name: "photos/p1.jpg", data: jpegBytes() },
          { name: "photos/p2.png", data: pngBytes() },
        ]),
      ),
    );

    if (!result.ok) throw new Error(`Expected the package to open, got: ${result.message}`);
    expect(result.value.manifest).toEqual(MANIFEST);
    expect(result.value.photos.paths()).toEqual(["photos/p1.jpg", "photos/p2.png"]);
    expect(result.value.photos.has("photos/p1.jpg")).toBe(true);
    expect(result.value.photos.has("trip.json")).toBe(false);
    expect(result.value.photos.read("photos/p2.png")).toEqual(pngBytes());
  });

  it("returns its failures rather than throwing them", () => {
    const missingManifest = openImportPackage(onDisk(buildZip([{ name: "photos/p1.jpg", data: jpegBytes() }])));

    expect(missingManifest).toMatchObject({ ok: false, code: "validation_error" });
    expect(missingManifest.ok ? "" : missingManifest.message).toContain("trip.json");
  });

  it("refuses a member that is neither trip.json nor a photo", () => {
    const result = openImportPackage(
      onDisk(
        buildZip([
          { name: "trip.json", data: Buffer.from(JSON.stringify(MANIFEST), "utf8") },
          { name: "stowaway.png", data: pngBytes() },
        ]),
      ),
    );

    expect(result).toMatchObject({ ok: false, code: "validation_error" });
    expect(result.ok ? "" : result.message).toContain("stowaway.png");
  });

  it("ignores the bookkeeping members a re-zip injects", () => {
    const result = openImportPackage(
      onDisk(
        buildZip([
          { name: "trip.json", data: Buffer.from(JSON.stringify(MANIFEST), "utf8") },
          { name: "photos/", data: Buffer.alloc(0) },
          { name: "__MACOSX/._trip.json", data: Buffer.from("resource fork", "utf8") },
          { name: ".DS_Store", data: Buffer.from("finder metadata", "utf8") },
          { name: "photos/p1.jpg", data: jpegBytes() },
        ]),
      ),
    );

    if (!result.ok) throw new Error(`Expected the package to open, got: ${result.message}`);
    expect(result.value.photos.paths()).toEqual(["photos/p1.jpg"]);
  });

  it("agrees with parseImportPackage on the same archive", () => {
    const bytes = buildPackage(MANIFEST, [{ name: "photos/p1.jpg", data: jpegBytes() }]);
    const eager = expectSuccess(parseImportPackage(bytes));
    const lazy = openImportPackage(onDisk(bytes));

    if (!lazy.ok) throw new Error(`Expected the package to open, got: ${lazy.message}`);
    expect(lazy.value.manifest).toEqual(eager.manifest);
    expect(lazy.value.photos.paths()).toEqual([...eager.photoBytes.keys()]);
    expect(lazy.value.photos.read("photos/p1.jpg")).toEqual(eager.photoBytes.get("photos/p1.jpg"));
  });
});

describe("validatePackagePhotos", () => {
  const poolWith = (contentType: string, archivePath: string) => ({
    p1: { contentType, archivePath },
  });

  it("accepts a pool and member set that agree", () => {
    const result = validatePackagePhotos({
      photos: poolWith("image/jpeg", "photos/p1.jpg"),
      referenceCounts: new Map(),
      photoBytes: new Map([["photos/p1.jpg", jpegBytes()]]),
    });

    expect(result.ok).toBe(true);
  });

  it("accepts a package with no photos at all", () => {
    expect(
      validatePackagePhotos({
        photos: {},
        photoBytes: new Map(),
        referenceCounts: new Map(),
      }).ok,
    ).toBe(true);
  });

  it("rejects a pool entry with no matching archive member", () => {
    const result = validatePackagePhotos({
      photos: poolWith("image/jpeg", "photos/p1.jpg"),
      referenceCounts: new Map(),
      photoBytes: new Map(),
    });

    expect(result).toMatchObject({ ok: false });
    expect(result.ok ? [] : result.issues[0]).toContain("not in the package");
  });

  it("rejects an archive member that the pool does not register", () => {
    const result = validatePackagePhotos({
      photos: {},
      referenceCounts: new Map(),
      photoBytes: new Map([["photos/stowaway.jpg", jpegBytes()]]),
    });

    expect(result).toMatchObject({ ok: false });
    expect(result.ok ? [] : result.issues[0]).toContain("not registered");
  });

  it("rejects an empty photo", () => {
    const result = validatePackagePhotos({
      photos: poolWith("image/jpeg", "photos/p1.jpg"),
      referenceCounts: new Map(),
      photoBytes: new Map([["photos/p1.jpg", Buffer.alloc(0)]]),
    });

    expect(result).toMatchObject({ ok: false });
    expect(result.ok ? [] : result.issues[0]).toContain("empty");
  });

  it("caps a photo at the largest of the four upload routes' own limits", () => {
    // `days/[dayId]/image` accepts 15 MB where the other three accept 5 MB. Import has to clear the
    // highest, or an 8 MB day photo uploaded through the app makes its own backup unrestorable.
    expect(MAX_IMPORT_PHOTO_BYTES).toBe(15 * 1024 * 1024);

    const oversize = Buffer.concat([
      jpegBytes(0),
      Buffer.alloc(MAX_IMPORT_PHOTO_BYTES, 0x5a),
    ]);
    const result = validatePackagePhotos({
      photos: poolWith("image/jpeg", "photos/p1.jpg"),
      referenceCounts: new Map(),
      photoBytes: new Map([["photos/p1.jpg", oversize]]),
    });

    expect(result).toMatchObject({ ok: false });
    expect(result.ok ? [] : result.issues[0]).toContain("size limit");
  });

  it("accepts bytes that disagree with the declared content type, because the bytes are the authority", () => {
    // `hero-image/route.ts` names the stored file from the client-supplied `file.type` without
    // sniffing, so a PNG uploaded as `image/jpeg` is stored `hero.jpg` and exported as
    // `image/jpeg`. Demanding agreement would reject a backup this app produced.
    const result = validatePackagePhotos({
      photos: poolWith("image/jpeg", "photos/p1.jpg"),
      referenceCounts: new Map(),
      photoBytes: new Map([["photos/p1.jpg", pngBytes()]]),
    });

    expect(result.ok).toBe(true);
  });

  it("rejects bytes that match no allow-listed signature at all", () => {
    // This is what AC3's "photo data that cannot be decoded" actually means now.
    const result = validatePackagePhotos({
      photos: poolWith("image/jpeg", "photos/p1.jpg"),
      referenceCounts: new Map(),
      photoBytes: new Map([
        ["photos/p1.jpg", Buffer.from("GIF89a not really an image", "utf8")],
      ]),
    });

    expect(result).toMatchObject({ ok: false });
    expect(result.ok ? [] : result.issues[0]).toContain("JPEG, PNG or WebP");
  });

  it("accepts each allow-listed signature against its own content type", () => {
    const cases: [string, Buffer][] = [
      ["image/jpeg", jpegBytes()],
      ["image/png", pngBytes()],
      ["image/webp", webpBytes()],
    ];

    for (const [contentType, bytes] of cases) {
      const result = validatePackagePhotos({
        photos: poolWith(contentType, "photos/p1.bin"),
        referenceCounts: new Map(),
        photoBytes: new Map([["photos/p1.bin", bytes]]),
      });
      expect(result.ok).toBe(true);
    }
  });

  it("accepts the export's application/octet-stream fallback when the bytes are a real image", () => {
    // `toExportPhotoExtension` falls back to octet-stream for a stored URL with an unrecognised
    // extension, and this importer can itself create such a row - a v1 `imageUrl` is written
    // verbatim, so `/uploads/.../day.jfif` round-trips straight back out as octet-stream.
    const result = validatePackagePhotos({
      photos: poolWith("application/octet-stream", "photos/p1.bin"),
      referenceCounts: new Map(),
      photoBytes: new Map([["photos/p1.bin", jpegBytes()]]),
    });

    expect(result.ok).toBe(true);
  });

  it("caps the total bytes an import may write, not just the file count", () => {
    // One modest photo referenced enough times to blow past the volume ceiling. The count cap in
    // the schema cannot see this: 5000 references is legal, 5000 × 15 MB is not.
    const bytes = Buffer.concat([jpegBytes(), Buffer.alloc(1024 * 1024)]);
    const references = Math.ceil(MAX_IMPORT_PHOTO_TOTAL_BYTES / bytes.length) + 1;

    const result = validatePackagePhotos({
      photos: poolWith("image/jpeg", "photos/p1.jpg"),
      referenceCounts: new Map([["p1", references]]),
      photoBytes: new Map([["photos/p1.jpg", bytes]]),
    });

    expect(result).toMatchObject({ ok: false });
    expect(result.ok ? [] : result.issues[0]).toContain("more than the");
  });

  it("allows heavy but legitimate reuse of a pooled photo", () => {
    const bytes = jpegBytes();

    const result = validatePackagePhotos({
      photos: poolWith("image/jpeg", "photos/p1.jpg"),
      referenceCounts: new Map([["p1", 500]]),
      photoBytes: new Map([["photos/p1.jpg", bytes]]),
    });

    expect(result.ok).toBe(true);
  });

  it("reaches the same verdict against a package that is still on disk", () => {
    // The route's own path: the archive is never materialised, so validation reads one member,
    // sizes and sniffs it, and lets go before asking for the next.
    const bytes = buildPackage(MANIFEST, [{ name: "photos/p1.jpg", data: jpegBytes() }]);
    const fixture = writeZipToTempFile(bytes);
    try {
      const opened = openImportPackage(fileByteSource(fixture.fd, fixture.size));
      if (!opened.ok) throw new Error(`Expected the package to open, got: ${opened.message}`);

      expect(
        validatePackagePhotos({
          photos: poolWith("image/jpeg", "photos/p1.jpg"),
          referenceCounts: new Map([["p1", 1]]),
          photoBytes: opened.value.photos,
        }).ok,
      ).toBe(true);

      const unregistered = validatePackagePhotos({
        photos: {},
        referenceCounts: new Map(),
        photoBytes: opened.value.photos,
      });
      expect(unregistered.ok ? [] : unregistered.issues[0]).toContain("not registered");
    } finally {
      fixture.close();
    }
  });

  it("treats a Map and the PhotoSource wrapped around it as the same input", () => {
    const photoBytes = new Map([["photos/p1.jpg", jpegBytes()]]);
    const asSource = photoSourceFromMap(photoBytes);

    expect(asSource.paths()).toEqual(["photos/p1.jpg"]);
    expect(
      validatePackagePhotos({
        photos: poolWith("image/jpeg", "photos/p1.jpg"),
        referenceCounts: new Map(),
        photoBytes: asSource,
      }),
    ).toEqual(
      validatePackagePhotos({
        photos: poolWith("image/jpeg", "photos/p1.jpg"),
        referenceCounts: new Map(),
        photoBytes,
      }),
    );
  });

  it("collects every problem rather than stopping at the first", () => {
    const result = validatePackagePhotos({
      photos: {
        p1: { contentType: "image/jpeg", archivePath: "photos/p1.jpg" },
        p2: { contentType: "image/png", archivePath: "photos/p2.png" },
      },
      referenceCounts: new Map(),
      photoBytes: new Map([
        // p1's member is absent, p2's bytes decode as nothing, and p3 is a member no entry claims.
        ["photos/p2.png", Buffer.from("not an image", "utf8")],
        ["photos/p3.jpg", jpegBytes()],
      ]),
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.issues).toHaveLength(3);
  });
});

describe("sniffPhotoContentType", () => {
  it("names the type the bytes really are, and nothing for bytes that are no image", () => {
    expect(sniffPhotoContentType(jpegBytes())).toBe("image/jpeg");
    expect(sniffPhotoContentType(pngBytes())).toBe("image/png");
    expect(sniffPhotoContentType(webpBytes())).toBe("image/webp");
    expect(sniffPhotoContentType(Buffer.from("plain text", "utf8"))).toBeNull();
    expect(sniffPhotoContentType(Buffer.alloc(0))).toBeNull();
  });
});
