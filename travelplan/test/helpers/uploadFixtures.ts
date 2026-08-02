import fs from "node:fs/promises";
import path from "node:path";

/**
 * Fixture writer for export photos. Paths must come from the upload helpers, never from
 * `process.cwd() + "/public"` - `test/setup.ts` redirects `UPLOADS_PUBLIC_ROOT` to a per-worker temp
 * directory and the helpers are the only thing that honours it. See the header comment in
 * `src/lib/trips/uploadPaths.ts` for what happened the last time suites rolled their own paths.
 *
 * Shared rather than copied per suite: when the way a fixture is laid down changes, one edit has to
 * reach every suite that writes one, or the suites quietly disagree about the upload contract.
 *
 * `contents` accepts a `Buffer` as well as a string so a suite can lay down real image-shaped bytes
 * - nulls, high bytes, a length that is not trivially small. CRC-32 and the size fields are the two
 * things most likely to be wrong for binary input, and an all-ASCII fixture never exercises them.
 */
export const writeUploadFile = async (dir: string, fileName: string, contents: string | Buffer) => {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, fileName),
    typeof contents === "string" ? Buffer.from(contents, "utf8") : contents,
  );
};

/**
 * Photo fixtures with real leading magic bytes.
 *
 * Story 2.32's importer checks the first bytes of every photo against its declared `contentType` -
 * that check is what makes AC3's "photo data that cannot be decoded" a real test rather than a
 * claim. An ASCII fixture is therefore no longer usable for anything that goes through import
 * validation; these are the minimum a byte-sniffing importer accepts.
 *
 * The trailing filler is not decodable image data, and nothing in this app decodes it - the
 * importer sniffs, it does not parse.
 */
const withFiller = (signature: number[], filler: number) =>
  Buffer.concat([Buffer.from(signature), Buffer.alloc(filler, 0x5a)]);

export const jpegBytes = (filler = 64) => withFiller([0xff, 0xd8, 0xff, 0xe0], filler);

export const pngBytes = (filler = 64) =>
  withFiller([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], filler);

/** RIFF container: "RIFF", a four-byte size, then the "WEBP" form type at offset 8. */
export const webpBytes = (filler = 64) => {
  const header = Buffer.alloc(12);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(4 + filler, 4);
  header.write("WEBP", 8, "ascii");
  return Buffer.concat([header, Buffer.alloc(filler, 0x5a)]);
};
