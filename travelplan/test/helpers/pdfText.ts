import zlib from "node:zlib";
import { PDFArray, PDFDocument, PDFRawStream } from "pdf-lib";

// The operand shape both readers below decode, in one place so they cannot drift apart: `drawText` encodes
// through the font and lands on `<hex> Tj`, and WinAnsi agrees with latin1 across the range `toWinAnsiText`
// permits (see the note on `extractPdfText`).
const hexTj = (content: string): string[] =>
  [...content.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)].map((hit) => Buffer.from(hit[1], "hex").toString("latin1"));

/**
 * Every string drawn anywhere in a `pdf-lib`-saved PDF, read back out of the bytes (DW-230).
 *
 * **"Anywhere" is meant literally, and it is the limit worth knowing before writing a negative assertion.**
 * This walks the saved file's stream objects, not the page tree, so what it returns includes the content
 * streams of *embedded and copied* documents - a traveller's own ticket - alongside the label pages this
 * module was written to read, and even pages `copyPages` brought into the context that were never added.
 * That is fine for a positive on a string only a label page can hold, which is how every current caller
 * uses it. It is not fine for `not.toContain(x)` where `x` is a word a fixture ticket could plausibly
 * contain: such an assertion fails for a reason that has nothing to do with what it is testing. Pick
 * strings the label pages own (`DOKUMENT`, the degradation sentence), not generic ones, and keep fixture
 * page text distinctive.
 *
 * Shared by `documentPacketPdf.test.ts` (unit level, over `buildDocumentPacket`) and
 * `tripDayDocumentPacketRoute.test.ts` (end to end, over the route). One copy rather than two, because two
 * copies of a parser drift and the end-to-end suite would be the one left reading the old shape.
 *
 * **This was measured rather than assumed, and the first assumption was wrong.** DW-230's spec proposed
 * scanning the saved bytes directly for `<hex>` runs, on the premise that `pdf-lib` does not compress
 * content streams. It does: every content stream this library writes comes out `/Filter /FlateDecode`, and
 * a raw scan of a packet finds no hex runs and no `DOCUMENT` at all - checked before anything was built on
 * it. So one step is added rather than the whole approach abandoned: inflate each stream, *then* decode the
 * hex operands. The narrower fallback the spec named as plan B - pin the wiring through `getPacketLabels`
 * and assert page-shape equivalence - is kept as well, in the cases that use this, but it is not what
 * proves the German text reaches the page; this is.
 *
 * The rest of the premise held. `drawText` encodes through the font's `encodeText`, which emits a hex
 * string, and `Tj` is the operator it lands on. `StandardFonts.Helvetica` is WinAnsi-encoded, and WinAnsi
 * agrees with latin1 across the whole range `toWinAnsiText` permits (printable ASCII plus `\xA0-\xFF`), so
 * a latin1 decode is exact for every character a packet label can legally contain - German umlauts
 * included. It would be wrong for the `\x80-\x9F` block, which is precisely the range `toWinAnsiText`
 * refuses.
 *
 * **It throws rather than returning `""` when it finds no text at all.** It used to return the empty string
 * for a PDF it could not read, and lean on a convention - "every suite using it asserts a known string
 * first" - to stop that turning into a green `not.toContain(...)`. Nothing enforced the convention, in a
 * helper written to be shared by suites nobody has written yet, and a silent `""` makes *every* negative
 * assertion built on it vacuously true at once: the whole class of failure this parser could have, arriving
 * as a pass. A throw converts that class into a loud red instead, so the positive-first ordering is a
 * courtesy to the reader now rather than the only thing standing between the suite and a false green.
 *
 * The consequence is deliberate: a caller handing this a PDF that legitimately draws no text gets an
 * exception. There is no such caller - a packet always has label pages - and "this PDF has no text" is a
 * thing a test should have to say out loud rather than receive as `""`.
 *
 * Streams that are not Flate - an embedded JPEG's own bytes - simply fail to inflate and are skipped.
 */
export const extractPdfText = (bytes: Uint8Array): string => {
  const raw = Buffer.from(bytes);
  // latin1 is one byte per character, so string indices into this are byte offsets into `raw`.
  const latin1 = raw.toString("latin1");
  const inflated: string[] = [];

  const streamStarts = /stream\r?\n/g;
  let match: RegExpExecArray | null;
  while ((match = streamStarts.exec(latin1)) !== null) {
    const start = match.index + match[0].length;
    const end = latin1.indexOf("endstream", start);
    if (end < 0) continue;
    try {
      inflated.push(zlib.inflateSync(raw.subarray(start, end)).toString("latin1"));
    } catch {
      continue;
    }
  }

  const drawn = hexTj(inflated.join("\n"));

  // The two ways this can find nothing are worth telling apart in the message, because they point at
  // different things: no stream inflated at all means the bytes are not a `pdf-lib` PDF (or it stopped
  // Flate-encoding, which is the premise this whole parser rests on), while streams that inflated with no
  // `Tj` in them means the PDF is real and the operand shape changed.
  if (drawn.length === 0) {
    throw new Error(
      inflated.length === 0
        ? `extractPdfText: inflated no content stream out of ${bytes.byteLength} bytes - this is not a pdf-lib PDF, or its streams are no longer Flate-encoded`
        : `extractPdfText: inflated ${inflated.length} content stream(s) and found no <hex> Tj operand in any of them - either this PDF draws no text or pdf-lib's text encoding changed`,
    );
  }

  return drawn.join("\n");
};

/**
 * The text of each page **that is actually in the page tree**, in page order - the assertion `extractPdfText`
 * cannot make (DW-230 review).
 *
 * `extractPdfText` walks stream objects, so it reads orphans: pages `copyPages` brought into the context but
 * never added, and pages `removePage` detached. `buildDocumentPacket`'s degradation path creates exactly the
 * second kind - `drawLabelPage` calls `addPage` before it draws, so a failed attempt leaves a sheet that the
 * rewind then removes from the tree while its content stream stays in the bytes. A whole-file scan therefore
 * finds the heading of an attempt that *failed*, which makes `toContain(...)` on a packet with one surviving
 * page a test that cannot fail: the string is there whether the page that survived is the label page or a
 * blank. Reaching the page tree instead is what makes "one page, and it is the right one" checkable.
 *
 * Resolves each page's `/Contents` (one stream or an array of them, both of which `pdf-lib` writes) and
 * inflates it. Non-Flate streams are read as-is rather than skipped, since a page's content stream is the one
 * place `pdf-lib` is guaranteed not to be handing back an embedded image. Returns `""` for a page that draws
 * no text - unlike `extractPdfText`, an empty entry here is a *result* (a blank sheet is precisely what these
 * callers assert against) rather than a parser failure to hide.
 */
export const extractPageTexts = async (bytes: Uint8Array): Promise<string[]> => {
  const pdf = await PDFDocument.load(bytes);
  return pdf.getPages().map((page) => {
    const contents = page.node.Contents();
    if (!contents) return "";
    const parts = contents instanceof PDFArray ? contents.asArray() : [contents];
    const decoded = parts
      .map((part) => pdf.context.lookup(part))
      .filter((object): object is PDFRawStream => object instanceof PDFRawStream)
      .map((stream) => {
        const raw = Buffer.from(stream.getContents());
        try {
          return zlib.inflateSync(raw).toString("latin1");
        } catch {
          return raw.toString("latin1");
        }
      });
    return hexTj(decoded.join("\n")).join("\n");
  });
};
