import { describe, expect, it } from "vitest";
import { crc32 } from "node:zlib";
import {
  MAX_IMPORT_PHOTO_BYTES,
  parseImportPackage,
  sniffPhotoContentType,
  validatePackagePhotos,
} from "@/lib/trips/importPackage";
import { MAX_IMPORT_PHOTO_TOTAL_BYTES } from "@/lib/trips/importLimits";
import {
  MAX_TOTAL_UNCOMPRESSED_BYTES,
  readZipMembers,
  ZipReadError,
} from "@/lib/trips/zipReader";
import { buildPackage, buildZip } from "./helpers/zipBuilder";
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
    expect(MAX_TOTAL_UNCOMPRESSED_BYTES).toBe(200 * 1024 * 1024);
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
