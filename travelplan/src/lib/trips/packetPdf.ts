/**
 * Merges a day's documents into one offline packet PDF (Story 9.2, AC4/AC5).
 *
 * **Server-only.** `pdf-lib` is a runtime dependency of the packet route and nothing else; it must not
 * reach a client bundle. Bytes are handed in by the caller through `readFile` rather than read here, so
 * this module does no I/O, holds no path knowledge, and is testable against real bad bytes without a
 * filesystem or a database - which is what makes each AC5 degradation a test that can actually fail.
 *
 * **Memory, and why it needs real limits rather than a note.** `pdf-lib` holds every source document in
 * memory and `save()` returns one `Uint8Array`. Story 9.1's cap is 10 documents **per entry** at 10 MB
 * each, and nothing caps plan items per day, so "10 × 10 MB ≈ 100 MB" - which this comment used to
 * claim - understates the ceiling by however many entries the day has: 20 activities is 2 GB of upload
 * budget. Worse, upload bytes do not bound *decoded* bytes. A 200 KB PNG whose IHDR declares 8000×8000
 * costs ~700 MB of RSS inside `embedPng`, because `@pdf-lib/upng` decodes it and `pdf-lib` retains the
 * channel data; measured, not estimated. Either one lets an authenticated read-access member OOM-kill
 * the process from a legitimate-looking upload, so both are bounded here rather than documented:
 * `MAX_PACKET_DOCUMENTS`, `MAX_PACKET_INPUT_BYTES`, `MAX_PACKET_IMAGE_PIXELS` and
 * `MAX_PACKET_DECODED_PIXELS`. Exceeding a per-image bound is AC5's label page - one ticket degrades.
 * Exceeding a whole-packet bound is the route's refusal when it can be known before any file is opened
 * (the document count) and a label page when it cannot (bytes and pixels, which only reading reveals),
 * because a truncated packet that claims to be the day's documents is worse than saying what is missing.
 *
 * **The three source-side bounds do not bound the decode, which is why there is a fourth.** A per-image
 * pixel cap says nothing about a *packet* of images, and none of the other budgets sees decoded bytes at
 * all: measured on this tree, a valid flat 3000x3000 PNG is **34 KB on disk and retains ~26 MB** once
 * `embedPng` has run (~2.9 bytes per pixel, held until `save()`), and it accumulates linearly - five of
 * them cost 172 MB. Sixty such files are 2 MB of source bytes against a 200 MB budget, 9 MP each against
 * a 40 MP per-image cap, and exactly `MAX_PACKET_DOCUMENTS` documents: every existing bound reads as
 * unspent while ~1.5 GB is retained, and at 36 MP each - still legal per image - it is ~6 GB. So the
 * decode is bounded across the whole packet as well, by the one quantity that predicts it.
 *
 * **And a fifth, because the four above all measure images or bytes and the PDF branch measures neither.**
 * `copyPages` is the only step that turns one document into unbounded *output*, and its cost scales with
 * page count, superlinearly, while every byte-denominated budget reads as unspent. Measured on this tree
 * with the exact `load` -> `copyPages` -> `addPage` -> `save` sequence below: 1,000 pages is 0.01 MB and
 * 73 ms; 5,000 is 0.06 MB and 390 ms; **20,000 is 0.24 MB and 4.2 s at 216 MB of RSS** - 4x the pages for
 * 11x the time. A 100,000-page source, still well inside Story 9.1's 10 MB per-file cap at ~1.3 MB, takes
 * ~114 s. Node is single-threaded, so that is the whole instance stalled by one request whose budgets read
 * 1 document of 60, 1.3 MB of 200 MB and 0 pixels of 80 M. `MAX_PACKET_PAGES` is the missing dimension.
 *
 * This also corrects what this docblock and `MAX_PACKET_INPUT_BYTES` used to claim - that source bytes are
 * "the quantity `pdf-lib` retains". They are not: the 20,000-page case retains ~900x its source bytes. The
 * byte budget is a useful proxy for the image half and a floor, never an identity, for the PDF half.
 */
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import type { PDFFont, PDFImage, PDFPage } from "pdf-lib";
import { documentUrlExtension } from "@/lib/trips/documentUploads";

/** A4 at 72dpi, the size of every page this module *creates*. Copied pages keep their own - see below. */
const A4_PORTRAIT: [number, number] = [595.28, 841.89];
const A4_LANDSCAPE: [number, number] = [841.89, 595.28];

/** Label-page text inset, and the image pages' own margin (AC4's "24pt margin"). */
const LABEL_MARGIN = 56;
const IMAGE_MARGIN = 24;

/**
 * Whole-packet ceilings, and the per-image decode ceiling. See the memory note in the module docblock
 * for the measurements these come from.
 *
 * `MAX_PACKET_DOCUMENTS` is generous against real travel - a day needing more than 60 attached documents
 * is not a day - and its only job is to stop entry count multiplying Story 9.1's per-entry cap without
 * bound. `MAX_PACKET_INPUT_BYTES` bounds the source bytes actually read - a proxy for what `pdf-lib`
 * retains on the image half, and a floor rather than an identity on the PDF half, where a small file can
 * hold very many pages (see `MAX_PACKET_PAGES`). `MAX_PACKET_IMAGE_PIXELS` is the one that matters most
 * for a single image: 40 megapixels is well past
 * any phone camera (a 48 MP sensor writes ~12 MP by default) and well below the point where a decode
 * costs a gigabyte.
 *
 * `MAX_PACKET_DECODED_PIXELS` is the same quantity summed over the packet, and it is what stops sixty
 * individually-legal images from multiplying the per-image cap by sixty. At the measured ~2.9 bytes of
 * retained channel data per pixel, 80 MP is ~230 MB - the ceiling this module is willing to hold at once.
 * It applies to PNGs and to nothing else, deliberately: `embedJpg` hands the compressed bytes to the PDF
 * as a `DCTDecode` stream and never decodes them, so a JPEG's pixel count costs no memory and is already
 * accounted for by `MAX_PACKET_INPUT_BYTES`.
 */
export const MAX_PACKET_DOCUMENTS = 60;
export const MAX_PACKET_INPUT_BYTES = 200 * 1024 * 1024;
export const MAX_PACKET_DECODED_PIXELS = 80_000_000;
const MAX_PACKET_IMAGE_PIXELS = 40_000_000;
/**
 * The page ceiling for the whole packet, checked between `load` and `copyPages` - which is where it can
 * still do something. Measured on this tree at 20,000 pages: `load` is 385 ms of the 4.2 s, `copyPages`
 * is 3.1 s and `save` 571 ms, so refusing after the parse and before the copy avoids ~88% of the cost.
 * The residual parse is linear and bounded by Story 9.1's 10 MB per-file cap.
 *
 * 500 is generous against real travel - a day's tickets, vouchers and confirmations - by a wide margin,
 * and copies in single-digit milliseconds. It is a running total rather than a per-document limit for the
 * same reason the byte and pixel budgets are: what takes the process down is the sum.
 */
export const MAX_PACKET_PAGES = 500;

const INK = rgb(0.07, 0.07, 0.08);
const MUTED = rgb(0.42, 0.42, 0.45);

/**
 * Replaces everything `StandardFonts.Helvetica` cannot encode with a visible `?`.
 *
 * **This is not optional politeness: `drawText` throws at draw time on an unencodable character**, and
 * label pages carry `fileName`, which is whatever the user called the file. One ticket named in Greek or
 * with a typographic dash would otherwise take the entire packet down - the failure AC5 exists to make
 * impossible, arriving through the very page that reports it.
 *
 * The kept set is a deliberately *strict* subset of WinAnsi: printable ASCII plus Latin-1 `\xA0-\xFF`.
 * WinAnsi also maps `\x80-\x9F` onto typographic characters (€ … — ' "), but by *different* code points
 * than Unicode uses, so admitting them would mean carrying a transcoding table for the exact characters
 * a `?` communicates perfectly well on a label. Control characters collapse to a space rather than to
 * `?`, because they were whitespace or nothing to begin with and a run of `?` reads as a mangled name.
 *
 * Iterated by code point, so an astral character (an emoji in a file name) becomes one `?` rather than
 * two, and an unpaired surrogate - which `sanitizeDocumentFileName` can leave behind after truncating -
 * becomes one as well instead of reaching the encoder.
 *
 * **The one exception is the ellipsis, because this codebase writes it itself.** `truncateText` appends
 * U+2026 to any label past `PRINT_MAX_CHARS`, and `getPrintEntryLabel` runs both of its branches through
 * it - a long stay name, and the body text of a titleless plan item, which is the ordinary shape. Left to
 * the `?` rule the label page would read `...Grand Hotel Roma?`, destroying the one character that says
 * the name is cut short, on the page whose entire job is to identify a loose ticket. This is not the
 * transcoding table the paragraph above declines: it is a single character that our own truncation emits,
 * folded to the ASCII spelling of itself. A user-supplied `…` gets the same treatment, which is strictly
 * better than the `?` it used to get.
 */
const ELLIPSIS = "…";

export const toWinAnsiText = (text: string): string => {
  let out = "";
  for (const character of text) {
    if (character === ELLIPSIS) {
      out += "...";
      continue;
    }
    const code = character.codePointAt(0) ?? 0;
    if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff)) {
      out += character;
    } else if (code <= 0x1f || code === 0x7f) {
      out += " ";
    } else {
      out += "?";
    }
  }
  return out;
};

/**
 * The EXIF `Orientation` tag (IFD0, `0x0112`) of a JPEG, or `null` when it has no readable EXIF.
 *
 * **Why this exists at all.** Browsers default to `image-orientation: from-image`, so the printed HTML
 * half of this story gets rotation for free. `pdf-lib`'s `embedJpg` reads the SOF dimensions and nothing
 * else, so a phone photo - which very commonly stores *landscape* pixels plus `Orientation: 6` - embeds
 * sideways, on a page sized for the wrong aspect. There is no image library in this tree (`sharp` appears
 * only under `overrides`, as a transitive version pin), so the APP1 segment is parsed here.
 *
 * Written defensively throughout: every read is bounds-checked and anything unexpected returns `null`,
 * which the caller treats as "no rotation". A malformed EXIF block must degrade to an unrotated image,
 * never to a thrown packet.
 */
export const readJpegOrientation = (bytes: Uint8Array): number | null => {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null; // Not sitting on a marker: the stream is not what we think.

    // ITU T.81 §B.1.1.3 permits any number of `0xFF` fill bytes before a marker, so the marker is the
    // first byte after the run and not simply `bytes[offset + 1]`. Getting this wrong is silent and
    // expensive: `marker` reads as `0xff`, matches neither the standalone list nor SOS, a length is read
    // from the wrong two bytes, and `offset` jumps somewhere arbitrary - so the EXIF block is missed, the
    // rotation comes back 0, and a portrait phone ticket embeds sideways. That is exactly the failure this
    // whole function exists to prevent, which is why it is worth four lines.
    let markerAt = offset + 1;
    while (markerAt < bytes.length && bytes[markerAt] === 0xff) markerAt += 1;
    if (markerAt + 2 >= bytes.length) return null;
    const marker = bytes[markerAt];

    // Standalone markers carry no length field: SOI, EOI, the eight restart markers, TEM.
    //
    // EOI is in this list rather than being a `return null`, and that is deliberate after checking it:
    // walking past EOI into trailing bytes - an appended thumbnail, two JPEGs concatenated - would let
    // the *trailing* image's orientation be reported for this one. It cannot happen, because SOS below
    // returns first and every JPEG that has an EOI has an SOS before it. A `return null` here would be
    // unreachable defensive code that no fixture can make fail, which this project's reviews rightly
    // object to; the reasoning is recorded instead.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset = markerAt + 1;
      continue;
    }
    const length = (bytes[markerAt + 1] << 8) | bytes[markerAt + 2];
    if (length < 2) return null;
    if (marker === 0xe1) {
      const orientation = readExifIfd0Orientation(
        bytes,
        markerAt + 3,
        Math.min(markerAt + 1 + length, bytes.length),
      );
      if (orientation !== null) return orientation;
    }
    // Start of scan: everything after this is entropy-coded image data, not segments.
    if (marker === 0xda) return null;
    offset = markerAt + 1 + length;
  }
  return null;
};

const readExifIfd0Orientation = (bytes: Uint8Array, start: number, end: number): number | null => {
  // "Exif\0\0", then a TIFF header. An APP1 that is not EXIF (XMP, most commonly) is simply skipped.
  if (end - start < 14) return null;
  const marker = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];
  for (let i = 0; i < marker.length; i += 1) {
    if (bytes[start + i] !== marker[i]) return null;
  }

  const tiff = start + 6;
  const littleEndian =
    bytes[tiff] === 0x49 && bytes[tiff + 1] === 0x49
      ? true
      : bytes[tiff] === 0x4d && bytes[tiff + 1] === 0x4d
        ? false
        : null;
  if (littleEndian === null) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (at: number) => view.getUint16(at, littleEndian);
  const u32 = (at: number) => view.getUint32(at, littleEndian);

  if (tiff + 8 > end || u16(tiff + 2) !== 0x002a) return null;
  // IFD0's offset is relative to the start of the TIFF header, not to the file.
  const ifd0 = tiff + u32(tiff + 4);
  if (ifd0 < tiff || ifd0 + 2 > end) return null;

  const entryCount = u16(ifd0);
  for (let index = 0; index < entryCount; index += 1) {
    const entry = ifd0 + 2 + index * 12;
    if (entry + 12 > end) return null;
    if (u16(entry) !== 0x0112) continue;
    const type = u16(entry + 2);
    // SHORT in every producer; LONG accepted because the value still fits the inline 4-byte field.
    if (type === 3) return u16(entry + 8);
    if (type === 4) return u32(entry + 8);
    return null;
  }
  return null;
};

/**
 * Clockwise rotation, in degrees, that turns the stored pixels into what a viewer displays.
 *
 * The four mirrored orientations (`2`, `4`, `5`, `7`) fall back to their nearest pure rotation and the
 * mirror is left uncorrected: `2→1`, `4→3`, `5→8`, `7→6`. They are not produced by phone cameras, and an
 * honest approximation on a printed ticket beats a branch nobody ever exercises. Anything else - and no
 * EXIF at all - is 0.
 */
const ORIENTATION_ROTATION: Record<number, 0 | 90 | 180 | 270> = {
  1: 0,
  2: 0,
  3: 180,
  4: 180,
  5: 270,
  6: 90,
  7: 90,
  8: 270,
};

const rotationForOrientation = (orientation: number | null): 0 | 90 | 180 | 270 =>
  (orientation !== null ? ORIENTATION_ROTATION[orientation] : undefined) ?? 0;

/** One document to merge, as `collectTimelineDocuments` produces it. */
export type PacketDocument = {
  entryLabel: string;
  fileName: string;
  documentUrl: string;
  isPdf: boolean;
};

/**
 * Hands back the bytes of one document, or throws.
 *
 * The reader is injected rather than built in so this module stays free of paths and of `node:fs`: the
 * route supplies one that resolves the stored URL, containment-checks it against the trip's own upload
 * directory and reads it, and a test supplies one that returns real bad bytes or a real `ENOENT`. A throw
 * from here is an AC5 degradation like any other and lands on a label page.
 */
export type PacketDocumentReader = (document: PacketDocument) => Promise<Uint8Array>;

const wrapText = (text: string, font: PDFFont, size: number, maxWidth: number): string[] => {
  const lines: string[] = [];
  let current = "";

  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) {
      lines.push(current);
      current = "";
    }
    // A single token wider than the box is hard-broken. A 255-character file name with no spaces in it
    // is an ordinary file name, and left whole it would run off the right edge of the page.
    let remainder = word;
    while (font.widthOfTextAtSize(remainder, size) > maxWidth && remainder.length > 1) {
      let cut = remainder.length - 1;
      while (cut > 1 && font.widthOfTextAtSize(remainder.slice(0, cut), size) > maxWidth) cut -= 1;
      lines.push(remainder.slice(0, cut));
      remainder = remainder.slice(cut);
    }
    current = remainder;
  }

  if (current) lines.push(current);
  return lines;
};

const drawTextBlock = (
  page: PDFPage,
  lines: readonly string[],
  options: { x: number; top: number; size: number; lineHeight: number; font: PDFFont; color: typeof INK },
) => {
  let baseline = options.top - options.size;
  for (const line of lines) {
    page.drawText(line, { x: options.x, y: baseline, size: options.size, font: options.font, color: options.color });
    baseline -= options.lineHeight;
  }
  return baseline + options.size;
};

/**
 * The page that precedes every document, whether or not the document itself made it in.
 *
 * A label page rather than text drawn onto the document's own first page: AC4 permits either, and
 * drawing over a copied page risks landing on the barcode that makes the ticket usable.
 *
 * `failed` is what AC5's degradation looks like from the traveller's side. A packet that is nine tickets
 * long with no explanation, or that 500s because of the tenth, cannot be acted on at a gate; a page
 * naming the file and saying to open it from the app can.
 */
const drawLabelPage = (
  pdf: PDFDocument,
  fonts: { regular: PDFFont; bold: PDFFont },
  document: PacketDocument,
  failed: boolean,
) => {
  const page = pdf.addPage(A4_PORTRAIT);
  const maxWidth = A4_PORTRAIT[0] - LABEL_MARGIN * 2;
  let top = A4_PORTRAIT[1] - LABEL_MARGIN * 2;

  top = drawTextBlock(page, [failed ? "DOCUMENT NOT INCLUDED" : "DOCUMENT"], {
    x: LABEL_MARGIN,
    top,
    size: 10,
    lineHeight: 14,
    font: fonts.bold,
    color: MUTED,
  });

  top = drawTextBlock(page, wrapText(toWinAnsiText(document.entryLabel), fonts.bold, 20, maxWidth), {
    x: LABEL_MARGIN,
    top: top - 18,
    size: 20,
    lineHeight: 26,
    font: fonts.bold,
    color: INK,
  });

  top = drawTextBlock(page, wrapText(toWinAnsiText(document.fileName), fonts.regular, 13, maxWidth), {
    x: LABEL_MARGIN,
    top: top - 10,
    size: 13,
    lineHeight: 18,
    font: fonts.regular,
    color: INK,
  });

  if (failed) {
    drawTextBlock(
      page,
      wrapText(
        "This document could not be included in this packet. Open it from the app to view it.",
        fonts.regular,
        11,
        maxWidth,
      ),
      { x: LABEL_MARGIN, top: top - 16, size: 11, lineHeight: 15, font: fonts.regular, color: MUTED },
    );
  }
};

/**
 * Guarantees a `Uint8Array` that starts at offset 0 of its own `ArrayBuffer`.
 *
 * **`pdf-lib`'s `JpegEmbedder` reads the SOF header through `new DataView(imageData.buffer)` with no
 * `byteOffset`**, so a view into a shared buffer has its header read from the wrong bytes: either "SOI
 * not found in JPEG" or, worse, a silently wrong width and height and therefore a wrongly sized page.
 * `fs.readFile` returns exactly such a view for small files, because Node serves those out of its Buffer
 * pool - so this is the ordinary case for a modest ticket, not a hypothetical one.
 *
 * The copy is skipped when the view already spans its whole buffer, which is what `fs.readFile` returns
 * for anything past the pool threshold - i.e. every large document, the ones where a copy would cost.
 */
const toOwnBuffer = (bytes: Uint8Array) =>
  bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes : new Uint8Array(bytes);

/**
 * The pixel count a PNG's own IHDR declares, or `null` if this is not a PNG with a readable header.
 *
 * Read **before** `embedPng`, because that is the only order that helps: `@pdf-lib/upng` decodes the
 * whole image and `pdf-lib` retains the channel data, so a 200 KB file declaring 8000×8000 costs ~700 MB
 * of RSS by the time it could be rejected afterwards. IHDR is fixed-position by spec - the 8-byte
 * signature, then a length and the `IHDR` type, then width and height as big-endian u32 at offsets 16
 * and 20 - so this needs no PNG parser.
 *
 * `embedJpg` deliberately gets no equivalent: it hands the bytes to the PDF as a `DCTDecode` stream and
 * never decodes them, so a JPEG's declared dimensions cost nothing to carry.
 *
 * The signature and the `IHDR` chunk type are checked before the two dimensions are believed, because
 * offsets 16 and 20 are only *the dimensions* in a file that really is a PNG. Without the check, a
 * `.png` document whose bytes are corrupt or are some other format reports whatever two words happen to
 * sit there - and since the outcome either way is a label page, the only thing that changes is what the
 * operator log says: `null` here degrades with `embedPng`'s own parse error, which names the real
 * problem, instead of a fabricated "declares 3221225472 pixels" that sends the reader hunting for an
 * oversized image.
 */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const readPngPixelCount = (bytes: Uint8Array) => {
  if (bytes.byteLength < 24) return null;
  for (let index = 0; index < PNG_SIGNATURE.length; index += 1) {
    if (bytes[index] !== PNG_SIGNATURE[index]) return null;
  }
  // `IHDR` must be the first chunk after the signature, per spec, so its type sits at 12-15 and the
  // dimensions immediately after it.
  if (bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width === 0 || height === 0) return null;
  return width * height;
};

/**
 * Refuses an embedded image that cannot be drawn, so it degrades to AC5's label page.
 *
 * `embedJpg` reads the SOF dimensions and does not validate them. Measured: a JPEG whose header declares
 * `0 x 600` - a truncated or hand-corrupted SOF - embeds without complaint, and `drawImagePage` then
 * scales it to a zero extent and draws nothing, producing a page that carries no image, no failure label
 * and no `onDegraded` signal. That is the one degradation shaped like success, which is worse than any
 * of the ones AC5 names. A `0 x 0` header throws inside `drawImage` on its own (the scale is `Infinity`
 * and the width `NaN`) and so already lands in the per-document catch; exactly one zero dimension does
 * not, which is why this is checked here rather than left to the draw.
 */
const assertDrawableImage = (image: PDFImage, document: PacketDocument) => {
  if (!(image.width > 0) || !(image.height > 0)) {
    throw new Error(
      `Embedded image for ${document.documentUrl} declares a zero dimension (${image.width}x${image.height})`,
    );
  }
  return image;
};

/**
 * Embeds one image and reports what it cost to decode, which is what the whole-packet pixel budget is
 * kept in. A JPEG costs nothing (`DCTDecode`, never decoded here); a PNG costs its own pixel count.
 */
const embedPacketImage = async (
  pdf: PDFDocument,
  document: PacketDocument,
  input: Uint8Array,
  remainingPixels: number,
) => {
  const extension = documentUrlExtension(document.documentUrl);
  const bytes = toOwnBuffer(input);
  if (extension === "jpg" || extension === "jpeg") {
    return {
      image: assertDrawableImage(await pdf.embedJpg(bytes), document),
      rotation: rotationForOrientation(readJpegOrientation(bytes)),
      decodedPixels: 0,
    };
  }
  if (extension === "png") {
    const pixels = readPngPixelCount(bytes);
    if (pixels !== null && pixels > MAX_PACKET_IMAGE_PIXELS) {
      throw new Error(`PNG declares ${pixels} pixels, above the ${MAX_PACKET_IMAGE_PIXELS} packet limit`);
    }
    // Checked before `embedPng`, for the same reason the per-image cap is: afterwards the memory has
    // already been spent. Once the packet's decode budget cannot cover this image, it degrades to a label
    // page and the ones after it get whatever is left - so the packet still accounts for every document
    // rather than ending early or taking the process down.
    if (pixels !== null && pixels > remainingPixels) {
      throw new Error(
        `PNG declares ${pixels} pixels and the packet has ${remainingPixels} of its ${MAX_PACKET_DECODED_PIXELS}-pixel decode budget left`,
      );
    }
    return {
      image: assertDrawableImage(await pdf.embedPng(bytes), document),
      rotation: 0 as const,
      decodedPixels: pixels ?? 0,
    };
  }
  // `pdf-lib` has `embedJpg` and `embedPng` and that is the whole list, so a `.webp` document - which
  // Story 9.1's accept list admits - is refused here by extension rather than handed to a decoder that
  // would throw with a less useful message. Either way it becomes AC5's label page.
  throw new Error(`Cannot embed document with extension ${extension ?? "unknown"}`);
};

/**
 * Draws one embedded image onto a page of its own, sized to the image's *displayed* aspect.
 *
 * The rotation arithmetic is the part that goes wrong silently, so it is spelled out. `drawImage` builds
 * the CTM as `translate(x, y) · rotate(θ) · scale(width, height)` and draws a unit square, so the box is
 * `width × height` **before** rotation and pivots about `(x, y)` - which after a rotation is no longer the
 * bottom-left corner of what you see. Positive θ is counter-clockwise (PDF convention). With `W × H` the
 * *displayed* box and `(originX, originY)` its intended bottom-left corner:
 *
 * | display rotation | θ    | width | height | x             | y             |
 * |------------------|------|-------|--------|---------------|---------------|
 * | 0°               |    0 | W     | H      | originX       | originY       |
 * | 90° clockwise    |  -90 | H     | W      | originX       | originY + H   |
 * | 180°             |  180 | W     | H      | originX + W   | originY + H   |
 * | 270° clockwise   |  +90 | H     | W      | originX + W   | originY       |
 *
 * Each row is the image's own box mapped through `R(θ)` and then translated so its extent lands on
 * `[originX, originX+W] × [originY, originY+H]`.
 */
const drawImagePage = (pdf: PDFDocument, image: PDFImage, rotation: 0 | 90 | 180 | 270) => {
  const quarterTurn = rotation === 90 || rotation === 270;
  const displayedWidth = quarterTurn ? image.height : image.width;
  const displayedHeight = quarterTurn ? image.width : image.height;

  // Page orientation follows what the traveller sees, not what the file stores - the whole point of
  // reading the EXIF tag. A portrait ticket gets a portrait page even when its pixels are landscape.
  const [pageWidth, pageHeight] = displayedWidth > displayedHeight ? A4_LANDSCAPE : A4_PORTRAIT;
  const page = pdf.addPage([pageWidth, pageHeight]);

  const boxWidth = pageWidth - IMAGE_MARGIN * 2;
  const boxHeight = pageHeight - IMAGE_MARGIN * 2;
  // One scale factor for both axes: anything else distorts the ticket, which AC1 forbids on the print
  // half for the same reason it is wrong here.
  const scale = Math.min(boxWidth / displayedWidth, boxHeight / displayedHeight);
  const drawnWidth = displayedWidth * scale;
  const drawnHeight = displayedHeight * scale;
  const originX = (pageWidth - drawnWidth) / 2;
  const originY = (pageHeight - drawnHeight) / 2;

  if (rotation === 90) {
    page.drawImage(image, {
      x: originX,
      y: originY + drawnHeight,
      width: drawnHeight,
      height: drawnWidth,
      rotate: degrees(-90),
    });
    return;
  }
  if (rotation === 270) {
    page.drawImage(image, {
      x: originX + drawnWidth,
      y: originY,
      width: drawnHeight,
      height: drawnWidth,
      rotate: degrees(90),
    });
    return;
  }
  if (rotation === 180) {
    page.drawImage(image, {
      x: originX + drawnWidth,
      y: originY + drawnHeight,
      width: drawnWidth,
      height: drawnHeight,
      rotate: degrees(180),
    });
    return;
  }
  page.drawImage(image, { x: originX, y: originY, width: drawnWidth, height: drawnHeight });
};

/**
 * Builds the packet: for each document in order, a label page, then the document itself - a PDF copied
 * page-for-page, an image drawn onto one page.
 *
 * **Copied pages keep their own page size**, so a packet is legitimately mixed-size: A4 label pages
 * beside a US-Letter rail ticket. Rescaling somebody's boarding pass to a uniform sheet is the worse
 * outcome, and this is recorded so nobody later "fixes" it.
 *
 * **Every document sits in its own `try`/`catch`.** One unreadable file must cost its own group's content
 * and nothing else - not the nine documents after it, and not the whole response. The label page is drawn
 * *after* the read and the parse have succeeded or failed, which is how the failing group's label can say
 * so; that also means a throw can never leave a group claiming a document that is not there.
 */
export const buildDocumentPacket = async (
  documents: readonly PacketDocument[],
  readFile: PacketDocumentReader,
  options: {
    /**
     * Called once per document that degrades to a label page, with the error that caused it. Optional and
     * side-effect-only: this module does no I/O and no logging of its own, so the route owns where it
     * goes. Without it every degradation looks identical from outside - which is fine for the traveller
     * holding the packet and useless to whoever has to explain why a ticket is missing.
     */
    onDegraded?: (document: PacketDocument, error: unknown) => void;
    /**
     * The whole-packet source-byte budget, defaulting to `MAX_PACKET_INPUT_BYTES`. A parameter rather
     * than a bare constant read so the guard is testable at a size a test can afford to allocate -
     * a budget that can only be exercised by allocating 200 MB is a budget nothing ever exercises.
     */
    maxInputBytes?: number;
    /**
     * The whole-packet decode budget in pixels, defaulting to `MAX_PACKET_DECODED_PIXELS`. A parameter
     * for the same reason `maxInputBytes` is one: exercising the default would mean allocating the very
     * quarter-gigabyte the budget exists to prevent, so no test would ever cover it.
     */
    maxDecodedPixels?: number;
    /**
     * The whole-packet page budget, defaulting to `MAX_PACKET_PAGES`. A parameter for the same reason the
     * two above are: the default can only be exercised by building a source PDF whose page count costs
     * seconds to copy, which is exactly the cost the budget exists to avoid paying.
     */
    maxPages?: number;
  } = {},
): Promise<Uint8Array<ArrayBuffer>> => {
  const {
    onDegraded,
    maxInputBytes = MAX_PACKET_INPUT_BYTES,
    maxDecodedPixels = MAX_PACKET_DECODED_PIXELS,
    maxPages = MAX_PACKET_PAGES,
  } = options;
  const pdf = await PDFDocument.create();
  const fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
  };

  // Bounds the source bytes actually read, which is the quantity `pdf-lib` retains. Counted as it goes
  // rather than pre-flighted, because the sizes are not known until each file is read; once the budget is
  // spent every remaining document degrades to a label page, so the packet still says what it is missing
  // instead of ending early with no explanation.
  let inputBytes = 0;
  // The decode counterpart, and the one the source-byte budget cannot stand in for: a 34 KB PNG retains
  // ~26 MB (see the module docblock's measurement), so bytes read and bytes held are three orders of
  // magnitude apart. Counted as it goes for the same reason - a PNG's pixel count is only known once its
  // header has been read.
  let decodedPixels = 0;
  // The PDF-branch counterpart, and the one neither budget above can stand in for: page count is not
  // proportional to source bytes and costs superlinear time in `copyPages`. Only the copied pages count -
  // this module's own label and image pages are fixed-cost and are not what a source document can inflate.
  let packetPages = 0;

  for (const document of documents) {
    try {
      // `>=`, not `>`: the budget is a ceiling on bytes actually read, so once it is reached nothing
      // further is opened. `>` would let one more document of any size through after the limit.
      if (inputBytes >= maxInputBytes) {
        throw new Error(`Packet input budget of ${maxInputBytes} bytes is spent`);
      }
      const bytes = await readFile(document);
      inputBytes += bytes.byteLength;
      if (document.isPdf) {
        // No `{ ignoreEncryption: true }`: it loads an encrypted document whose page content streams are
        // still ciphertext, so `copyPages` yields pages that render as garbage. A label page saying the
        // ticket is not here is worth more than a page that looks like a corrupted one.
        const source = await PDFDocument.load(bytes);
        // Before `copyPages`, which is the expensive half and the only step that turns one document into
        // unbounded output. A source small enough to pass every byte budget can still hold six figures of
        // pages (see `MAX_PACKET_PAGES`); past the budget this document degrades to a label page and the
        // ones after it get what is left, so the packet still accounts for every document.
        const pageCount = source.getPageCount();
        if (packetPages + pageCount > maxPages) {
          throw new Error(
            `PDF has ${pageCount} pages and the packet has ${maxPages - packetPages} of its ${maxPages}-page budget left`,
          );
        }
        const copied = await pdf.copyPages(source, source.getPageIndices());
        packetPages += pageCount;
        drawLabelPage(pdf, fonts, document, false);
        for (const page of copied) pdf.addPage(page);
      } else {
        const { image, rotation, decodedPixels: cost } = await embedPacketImage(
          pdf,
          document,
          bytes,
          maxDecodedPixels - decodedPixels,
        );
        decodedPixels += cost;
        drawLabelPage(pdf, fonts, document, false);
        drawImagePage(pdf, image, rotation);
      }
    } catch (error) {
      onDegraded?.(document, error);
      // The handler must not re-enter the call that may have just thrown on the same inputs: if
      // `drawLabelPage` were the thing that failed, calling it again with the identical `entryLabel` and
      // `fileName` throws again, escapes this function, and the route answers 500 - AC5 defeated through
      // the very page that implements it. Today `toWinAnsiText` makes that unreachable (every code point
      // it can emit was checked against `Helvetica`), so this is the second line of defence for the day
      // the sanitiser or the font changes, and a group named only by its position still beats a 500.
      try {
        drawLabelPage(pdf, fonts, document, true);
      } catch {
        drawLabelPage(pdf, fonts, { entryLabel: "Document", fileName: "unnamed file", documentUrl: "", isPdf: false }, true);
      }
    }
  }

  const saved = await pdf.save();
  // Re-wrapped, not copied. `pdf-lib` types `save()` as a bare `Uint8Array`, which TypeScript 5.7 onward
  // reads as `Uint8Array<ArrayBufferLike>` - and `BodyInit` requires `ArrayBufferView<ArrayBuffer>`, so
  // the route could not hand the result to `new Response` without this. The value already is
  // `ArrayBuffer`-backed at runtime (`pdf-lib` allocates it with `new Uint8Array(size)`); this view spans
  // the same bytes, which matters at the scale `MAX_PACKET_INPUT_BYTES` permits.
  return new Uint8Array(saved.buffer as ArrayBuffer, saved.byteOffset, saved.byteLength);
};
