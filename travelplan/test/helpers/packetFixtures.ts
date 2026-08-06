import zlib from "node:zlib";
import { PDFDocument, StandardFonts } from "pdf-lib";

/**
 * Fixtures for Story 9.2's packet builder, and the reason they are not `uploadFixtures.ts`'s.
 *
 * Those are *sniffing* fixtures: a magic-byte prefix plus filler, which is exactly enough for the
 * importer's content-type check and no more. `pdf-lib` **parses** what it is given - `PDFDocument.load`
 * walks the object graph, `embedJpg` reads the SOF header, `embedPng` decodes the image - so a filler
 * fixture proves nothing about the merge path and, worse, would make every AC5 degradation pass for the
 * wrong reason: a test that feeds `%PDF-` plus 64 bytes of `0x5a` and sees a label page has not shown
 * that an *encrypted* document degrades, only that garbage does.
 *
 * So everything here is real for the purpose it is used for: a genuinely parseable multi-page PDF, a
 * genuinely `/Encrypt`-carrying one, a genuinely truncated one, a JPEG whose SOF and EXIF a parser
 * actually reads, and a PNG a decoder actually decodes.
 */

/**
 * A real PDF with `pageCount` pages at the given size, produced by the same library the packet builder
 * uses. Circular only in appearance: what the suite asserts is the *packet's* page count and page sizes
 * against this document's, which is a property of the merge, not of the writer.
 */
export const realPdfBytes = async (pageCount = 3, size: [number, number] = [400, 600]) => {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let index = 0; index < pageCount; index += 1) {
    const page = pdf.addPage(size);
    page.drawText(`source page ${index + 1}`, { x: 40, y: size[1] / 2, size: 18, font });
  }
  return pdf.save();
};

/**
 * A PDF whose trailer dictionary carries `/Encrypt`, which is what makes `PDFDocument.load` raise
 * `EncryptedPDFError` - the normal case for airline and rail tickets, not an exotic one.
 *
 * Saved with `useObjectStreams: false` so the document ends in a classic `trailer <<…>>` dictionary there
 * is something to inject into; the default cross-reference-stream form has no trailer keyword at all.
 * `latin1` throughout, because this is byte surgery on a binary file and any other encoding would rewrite
 * the high bytes of the content streams.
 */
export const encryptedPdfBytes = async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage([400, 600]);
  const classic = Buffer.from(await pdf.save({ useObjectStreams: false })).toString("latin1");
  // Points at the Catalog, which is a real object: an unresolvable reference would make this a *corrupt*
  // PDF and stop testing encryption specifically.
  return new Uint8Array(Buffer.from(classic.replace("/Size ", "/Encrypt 2 0 R\n/Size "), "latin1"));
};

/** The first half of a real PDF: the object graph references offsets that are no longer there. */
export const truncatedPdfBytes = async () => {
  const whole = await realPdfBytes(2);
  return whole.slice(0, Math.floor(whole.length / 2));
};

const APP1_EXIF_ORIENTATION_LENGTH = 34;

/**
 * A JPEG whose SOF0 header declares `width × height`, optionally preceded by an APP1 EXIF block carrying
 * `Orientation`.
 *
 * The scan data is not decodable and does not need to be: `pdf-lib`'s `JpegEmbedder` reads the SOF header
 * and hands the bytes straight to the PDF as a `DCTDecode` stream without ever decoding them, and this
 * story's own `readJpegOrientation` reads the APP1 segment. Those two headers are the entire contract
 * being tested, and they are real here.
 */
export const realJpegBytes = ({
  width,
  height,
  orientation,
}: {
  width: number;
  height: number;
  orientation?: number;
}) => {
  const parts: Buffer[] = [Buffer.from([0xff, 0xd8])];

  if (orientation !== undefined) {
    const app1 = Buffer.alloc(2 + APP1_EXIF_ORIENTATION_LENGTH);
    app1.writeUInt16BE(0xffe1, 0);
    app1.writeUInt16BE(APP1_EXIF_ORIENTATION_LENGTH, 2);
    app1.write("Exif", 4, "ascii");
    // The two NUL bytes that complete the "Exif\0\0" marker are already zero from `alloc`.
    const tiff = 10;
    app1.write("II", tiff, "ascii"); // little-endian byte order
    app1.writeUInt16LE(0x002a, tiff + 2); // TIFF magic
    app1.writeUInt32LE(8, tiff + 4); // IFD0 sits immediately after the header
    const ifd0 = tiff + 8;
    app1.writeUInt16LE(1, ifd0); // one entry
    app1.writeUInt16LE(0x0112, ifd0 + 2); // Orientation
    app1.writeUInt16LE(3, ifd0 + 4); // SHORT
    app1.writeUInt32LE(1, ifd0 + 6); // count
    app1.writeUInt16LE(orientation, ifd0 + 10); // inline value
    // Trailing "next IFD offset" is 0 from `alloc`.
    parts.push(app1);
  }

  // SOF0: length 17 = 2 + 1 precision + 2 height + 2 width + 1 component count + 3 per component.
  const sof = Buffer.alloc(4 + 15);
  sof.writeUInt16BE(0xffc0, 0);
  sof.writeUInt16BE(17, 2);
  sof.writeUInt8(8, 4); // 8 bits per component
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  sof.writeUInt8(3, 9); // three components -> DeviceRGB
  for (let component = 0; component < 3; component += 1) {
    sof.writeUInt8(component + 1, 10 + component * 3);
    sof.writeUInt8(0x11, 11 + component * 3);
    sof.writeUInt8(0, 12 + component * 3);
  }
  parts.push(sof);

  // SOS plus a token run of scan data and EOI, so the file is shaped like a JPEG end to end.
  parts.push(Buffer.from([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]));
  parts.push(Buffer.alloc(32, 0x5a));
  parts.push(Buffer.from([0xff, 0xd9]));

  // A fresh, exactly-sized buffer: `Buffer.concat` can hand back a view into Node's pool, and
  // `JpegEmbedder` reads its header through `new DataView(bytes.buffer)` with no byteOffset. A pooled
  // fixture would exercise `toOwnBuffer` rather than the header parse, which is not what is under test.
  return new Uint8Array(Buffer.concat(parts));
};

const pngChunk = (type: string, data: Buffer) => {
  const chunk = Buffer.alloc(8 + data.length + 4);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, "ascii");
  data.copy(chunk, 8);
  chunk.writeUInt32BE(zlib.crc32(chunk.subarray(4, 8 + data.length)), 8 + data.length);
  return chunk;
};

/**
 * A real 8-bit RGB PNG: correct CRCs, a correctly zlib-deflated `IDAT`. `embedPng` runs it through
 * `@pdf-lib/upng`, which genuinely decodes, so nothing short of a valid file gets past it.
 */
export const realPngBytes = ({ width, height }: { width: number; height: number }) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(2, 9); // colour type 2: truecolour RGB
  // Compression, filter and interlace methods are all 0, which `alloc` already wrote.

  // One filter byte (0 = None) plus three bytes per pixel, per row.
  const raw = Buffer.alloc(height * (1 + width * 3), 0x40);
  for (let row = 0; row < height; row += 1) raw.writeUInt8(0, row * (1 + width * 3));

  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      pngChunk("IHDR", ihdr),
      pngChunk("IDAT", zlib.deflateSync(raw)),
      pngChunk("IEND", Buffer.alloc(0)),
    ]),
  );
};

/** A real RIFF/WEBP container. `pdf-lib` has only `embedJpg`/`embedPng`, so this can never be embedded. */
export const realWebpBytes = () => {
  const payload = Buffer.alloc(64, 0x5a);
  const header = Buffer.alloc(12);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(4 + payload.length, 4);
  header.write("WEBP", 8, "ascii");
  return new Uint8Array(Buffer.concat([header, payload]));
};
