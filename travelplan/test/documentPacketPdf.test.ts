import { describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  MAX_PACKET_DECODED_PIXELS,
  MAX_PACKET_INPUT_BYTES,
  MAX_PACKET_PAGES,
  buildDocumentPacket,
  getPacketLabels,
  readJpegOrientation,
  toWinAnsiText,
  type PacketDocument,
} from "@/lib/trips/packetPdf";
import { dictionaries, type Dictionary, type Language } from "@/i18n";
import { truncateText } from "@/lib/trips/printDocuments";
import {
  encryptedPdfBytes,
  realJpegBytes,
  realPngBytes,
  realPdfBytes,
  realWebpBytes,
  truncatedPdfBytes,
} from "./helpers/packetFixtures";
import { extractPageTexts, extractPdfText } from "./helpers/pdfText";

/**
 * Story 9.2 AC4/AC5, at unit level over `packetPdf.ts`.
 *
 * **Every degradation case here is real bad bytes, not a `vi.fn()` that throws.** A mock that rejects
 * proves only that the `catch` is wired; it says nothing about whether an encrypted PDF actually reaches
 * it, and this project's reviews have found exactly that shape of test passing while the behaviour it
 * claimed was absent. So: a PDF whose trailer carries `/Encrypt`, a genuinely truncated PDF, a real WebP
 * container, and a reader that raises a real `ENOENT`. The one `vi.fn()` below is the *reader*, which is
 * an injected dependency rather than the behaviour under test.
 *
 * Assertions are page counts and page sizes, never rendered pixels. Whether the `Orientation: 6` photo
 * comes out visually upright is a rendered-pixel claim and belongs to the browser verification pass; what
 * *is* checkable here is that the page it lands on has portrait dimensions, which is the observable half
 * of the same decision and the half that goes wrong silently.
 */

const imageDocument = (overrides: Partial<PacketDocument> = {}): PacketDocument => ({
  entryLabel: "Museum",
  fileName: "Ticket.jpg",
  documentUrl: "/uploads/trips/t/days/d/day-plan-items/i/documents/doc-1.jpg",
  isPdf: false,
  ...overrides,
});

const pdfDocument = (overrides: Partial<PacketDocument> = {}): PacketDocument => ({
  entryLabel: "Flight to Rome",
  fileName: "Boarding pass.pdf",
  documentUrl: "/uploads/trips/t/days/d/day-plan-items/i/documents/doc-1.pdf",
  isPdf: true,
  ...overrides,
});

/** A reader over a fixed map from `documentUrl` to bytes. Anything not in the map raises `ENOENT`. */
const readerFor = (files: Record<string, Uint8Array>) => async (document: PacketDocument) => {
  const bytes = files[document.documentUrl];
  if (!bytes) {
    const error = new Error(`ENOENT: no such file or directory, open '${document.documentUrl}'`) as Error & {
      code: string;
    };
    error.code = "ENOENT";
    throw error;
  }
  return bytes;
};

const A4_PORTRAIT = { width: 595.28, height: 841.89 };

const pageSizes = async (packet: Uint8Array) => {
  const pdf = await PDFDocument.load(packet);
  return pdf.getPages().map((page) => ({
    width: Math.round(page.getWidth() * 100) / 100,
    height: Math.round(page.getHeight() * 100) / 100,
  }));
};

describe("toWinAnsiText", () => {
  it("leaves printable ASCII and Latin-1 alone", () => {
    expect(toWinAnsiText("Ticket 2026 - Zürich (Gepäck) £5 ñ ÿ")).toBe("Ticket 2026 - Zürich (Gepäck) £5 ñ ÿ");
  });

  it("replaces Greek with question marks", () => {
    // The exact case from the spec's matrix. Without this, `drawText` throws and the whole packet is lost
    // to one file name.
    expect(toWinAnsiText("Εισιτήριο Ρώμη.pdf")).toBe("????????? ????.pdf");
  });

  it("replaces CJK with question marks", () => {
    expect(toWinAnsiText("東京行き切符.pdf")).toBe("??????.pdf");
  });

  it("replaces an em dash, an en dash and typographic quotes", () => {
    // These sit in WinAnsi's `\x80-\x9F` block at code points other than their Unicode ones, so this
    // module's strict subset refuses them rather than carrying a transcoding table for a label page.
    expect(toWinAnsiText("Rom — Wien – “Ticket”")).toBe("Rom ? Wien ? ?Ticket?");
  });

  it("folds the ellipsis to its ASCII spelling, because our own truncation writes it", () => {
    // `truncateText` appends U+2026 to any label past `PRINT_MAX_CHARS`, and `getPrintEntryLabel` runs
    // both branches through it - including the body text of a titleless plan item, the ordinary shape.
    // Under the blanket `?` rule the label page read `...Grand Hotel Roma?`, destroying the one character
    // that says the name is cut short, on the page whose whole job is to identify a loose ticket.
    expect(toWinAnsiText("Grand Hotel Roma…")).toBe("Grand Hotel Roma...");
    // Still the one exception and not the transcoding table the em-dash case above declines.
    expect(toWinAnsiText("Rom — Wien…")).toBe("Rom ? Wien...");
  });

  it("keeps the truncation marker legible end to end, from truncateText through to the label text", () => {
    // The two halves are in different modules, so asserting the sanitiser alone would stay green if
    // `truncateText` switched to a character the sanitiser does not know.
    expect(toWinAnsiText(truncateText("Hotel ".repeat(80)))).toMatch(/\.\.\.$/);
  });

  it("collapses control characters to a space rather than to a question mark", () => {
    expect(toWinAnsiText("Ticket\tRome\nMilan\0")).toBe("Ticket Rome Milan ");
  });

  it("replaces an astral character with a single question mark", () => {
    // One `?` and not two: iterated by code point, so a surrogate pair is one character.
    expect(toWinAnsiText("Trip 🎫.pdf")).toBe("Trip ?.pdf");
  });

  it("replaces an unpaired surrogate, which name truncation can leave behind", () => {
    expect(toWinAnsiText("Ticket\ud83c")).toBe("Ticket?");
  });

  it("returns an empty string unchanged", () => {
    expect(toWinAnsiText("")).toBe("");
  });
});

describe("readJpegOrientation", () => {
  it("reads Orientation 6 out of a real EXIF IFD0", () => {
    expect(readJpegOrientation(realJpegBytes({ width: 200, height: 100, orientation: 6 }))).toBe(6);
  });

  it("reads the other rotations the tag can carry", () => {
    for (const orientation of [1, 3, 8]) {
      expect(readJpegOrientation(realJpegBytes({ width: 100, height: 200, orientation }))).toBe(orientation);
    }
  });

  it("returns null for a JPEG with no EXIF segment at all", () => {
    expect(readJpegOrientation(realJpegBytes({ width: 100, height: 200 }))).toBeNull();
  });

  it("finds the orientation past 0xFF fill bytes before the APP1 marker", () => {
    // ITU T.81 B.1.1.3 lets an encoder pad with any number of 0xFF bytes before a marker. Reading the
    // marker as `bytes[offset + 1]` sees 0xff, matches no case, takes a length from the wrong two bytes and
    // walks off past the end - so the EXIF is missed, the rotation comes back 0, and a portrait phone
    // ticket embeds sideways with nothing to show anything went wrong. Without the fill-byte skip this
    // returns null.
    const jpeg = realJpegBytes({ width: 800, height: 400, orientation: 6 });
    const padded = new Uint8Array(jpeg.length + 3);
    padded.set(jpeg.subarray(0, 2), 0); // SOI
    padded.set([0xff, 0xff, 0xff], 2); // fill bytes
    padded.set(jpeg.subarray(2), 5); // APP1 onwards
    expect(readJpegOrientation(padded)).toBe(6);
  });

  it("returns null rather than throwing for bytes that are not a JPEG", () => {
    expect(readJpegOrientation(realPngBytes({ width: 4, height: 4 }))).toBeNull();
    expect(readJpegOrientation(new Uint8Array([0xff]))).toBeNull();
    expect(readJpegOrientation(new Uint8Array(0))).toBeNull();
  });

  it("returns null for a truncated EXIF segment instead of reading past the end", () => {
    const whole = realJpegBytes({ width: 200, height: 100, orientation: 6 });
    // Cut inside the APP1 payload: the segment's declared length now runs past the end of the file.
    expect(readJpegOrientation(whole.slice(0, 20))).toBeNull();
  });
});

describe("buildDocumentPacket", () => {
  it("emits a label page then the document, keeping a source PDF page-for-page at its own page size", async () => {
    const source = await realPdfBytes(3, [400, 600]);
    const document = pdfDocument();
    const packet = await buildDocumentPacket([document], readerFor({ [document.documentUrl]: source }));

    expect(await pageSizes(packet)).toEqual([
      A4_PORTRAIT,
      // Copied pages keep their own size: the packet is deliberately mixed-size rather than rescaling
      // somebody's ticket to a uniform sheet.
      { width: 400, height: 600 },
      { width: 400, height: 600 },
      { width: 400, height: 600 },
    ]);
  });

  it("merges documents in the order given, one label page each", async () => {
    const source = await realPdfBytes(2, [400, 600]);
    const first = pdfDocument({ documentUrl: "/uploads/trips/t/a.pdf" });
    const second = imageDocument({ documentUrl: "/uploads/trips/t/b.png", fileName: "Map.png" });
    const packet = await buildDocumentPacket(
      [first, second],
      readerFor({
        [first.documentUrl]: source,
        [second.documentUrl]: realPngBytes({ width: 100, height: 200 }),
      }),
    );

    // label, 2 copied, label, 1 image page.
    expect(await pageSizes(packet)).toEqual([
      A4_PORTRAIT,
      { width: 400, height: 600 },
      { width: 400, height: 600 },
      A4_PORTRAIT,
      A4_PORTRAIT,
    ]);
  });

  it("gives a portrait JPEG a portrait page", async () => {
    const document = imageDocument();
    const packet = await buildDocumentPacket(
      [document],
      readerFor({ [document.documentUrl]: realJpegBytes({ width: 800, height: 1200 }) }),
    );

    expect(await pageSizes(packet)).toEqual([A4_PORTRAIT, A4_PORTRAIT]);
  });

  it("gives a landscape JPEG a landscape page", async () => {
    const document = imageDocument();
    const packet = await buildDocumentPacket(
      [document],
      readerFor({ [document.documentUrl]: realJpegBytes({ width: 1200, height: 800 }) }),
    );

    expect(await pageSizes(packet)).toEqual([
      A4_PORTRAIT,
      { width: 841.89, height: 595.28 },
    ]);
  });

  /**
   * The single most likely thing in this story to ship silently wrong. A phone shooting in portrait very
   * commonly stores *landscape* pixels plus `Orientation: 6`; browsers apply the tag, `pdf-lib` does not.
   * Sized from `image.width`/`image.height` alone the page would come out landscape, which is the
   * observable half of "the ticket is printed sideways".
   */
  it("sizes the page from a JPEG's displayed aspect, not its stored pixels", async () => {
    const document = imageDocument();
    const rotated = await buildDocumentPacket(
      [document],
      readerFor({ [document.documentUrl]: realJpegBytes({ width: 1200, height: 800, orientation: 6 }) }),
    );
    const unrotated = await buildDocumentPacket(
      [document],
      readerFor({ [document.documentUrl]: realJpegBytes({ width: 1200, height: 800, orientation: 1 }) }),
    );

    // Same pixels, different tag, different page orientation - which is the whole claim.
    expect(await pageSizes(rotated)).toEqual([A4_PORTRAIT, A4_PORTRAIT]);
    expect(await pageSizes(unrotated)).toEqual([A4_PORTRAIT, { width: 841.89, height: 595.28 }]);
  });

  it("treats Orientation 8 as a quarter turn too", async () => {
    const document = imageDocument();
    const packet = await buildDocumentPacket(
      [document],
      readerFor({ [document.documentUrl]: realJpegBytes({ width: 1200, height: 800, orientation: 8 }) }),
    );

    expect(await pageSizes(packet)).toEqual([A4_PORTRAIT, A4_PORTRAIT]);
  });

  it("leaves the page aspect alone for Orientation 3, a half turn", async () => {
    const document = imageDocument();
    const packet = await buildDocumentPacket(
      [document],
      readerFor({ [document.documentUrl]: realJpegBytes({ width: 1200, height: 800, orientation: 3 }) }),
    );

    expect(await pageSizes(packet)).toEqual([A4_PORTRAIT, { width: 841.89, height: 595.28 }]);
  });

  it("embeds a PNG", async () => {
    const document = imageDocument({ documentUrl: "/uploads/trips/t/a.png", fileName: "Map.png" });
    const packet = await buildDocumentPacket(
      [document],
      readerFor({ [document.documentUrl]: realPngBytes({ width: 60, height: 40 }) }),
    );

    expect(await pageSizes(packet)).toEqual([A4_PORTRAIT, { width: 841.89, height: 595.28 }]);
  });

  describe("AC5 degradation: one label page, nothing else lost", () => {
    it.each([
      [
        "an encrypted PDF",
        () => pdfDocument({ documentUrl: "/uploads/trips/t/bad.pdf", fileName: "Encrypted.pdf" }),
        encryptedPdfBytes,
      ],
      [
        "a truncated PDF",
        () => pdfDocument({ documentUrl: "/uploads/trips/t/bad.pdf", fileName: "Truncated.pdf" }),
        truncatedPdfBytes,
      ],
      [
        "a WebP image, which pdf-lib cannot embed",
        () => imageDocument({ documentUrl: "/uploads/trips/t/bad.webp", fileName: "Shot.webp" }),
        async () => realWebpBytes(),
      ],
      [
        "a JPEG URL carrying bytes that are not a JPEG",
        () => imageDocument({ documentUrl: "/uploads/trips/t/bad.jpg", fileName: "Broken.jpg" }),
        async () => new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]),
      ],
      [
        "a document URL with no recognised extension",
        () => imageDocument({ documentUrl: "/uploads/trips/t/bad", fileName: "Mystery" }),
        async () => realJpegBytes({ width: 100, height: 100 }),
      ],
    ])("keeps the other nine documents when the tenth is %s", async (_label, makeBad, makeBytes) => {
      const good = await realPdfBytes(1, [400, 600]);
      const bad = makeBad();
      const files: Record<string, Uint8Array> = { [bad.documentUrl]: await makeBytes() };
      const documents: PacketDocument[] = [];
      for (let index = 0; index < 9; index += 1) {
        const url = `/uploads/trips/t/good-${index}.pdf`;
        files[url] = good;
        documents.push(pdfDocument({ documentUrl: url, fileName: `Ticket ${index}.pdf` }));
      }
      documents.splice(4, 0, bad);

      const sizes = await pageSizes(await buildDocumentPacket(documents, readerFor(files)));

      // Ten label pages plus one copied page for each of the nine that worked. The failing one contributes
      // its label page and nothing else - it is neither dropped nor fatal.
      expect(sizes).toHaveLength(19);
      expect(sizes.filter((size) => size.width === A4_PORTRAIT.width)).toHaveLength(10);
      expect(sizes.filter((size) => size.width === 400)).toHaveLength(9);
      // And it is the fifth group that degraded: label 5 is followed by another label, not by content.
      expect(sizes[8]).toEqual(A4_PORTRAIT);
      expect(sizes[9]).toEqual(A4_PORTRAIT);
      expect(sizes[10]).toEqual({ width: 400, height: 600 });
    });

    it("degrades a document whose file is missing on disk", async () => {
      const missing = pdfDocument({ documentUrl: "/uploads/trips/t/gone.pdf", fileName: "Gone.pdf" });
      const present = pdfDocument({ documentUrl: "/uploads/trips/t/here.pdf", fileName: "Here.pdf" });
      // The reader raises a real `ENOENT`, the way `fs.realpath` does for an unlinked file.
      const packet = await buildDocumentPacket(
        [missing, present],
        readerFor({ [present.documentUrl]: await realPdfBytes(1, [400, 600]) }),
      );

      expect(await pageSizes(packet)).toEqual([A4_PORTRAIT, A4_PORTRAIT, { width: 400, height: 600 }]);
    });

    it("completes the packet when a file name is unencodable, rather than throwing out of drawText", async () => {
      // The failure this whole sanitising step exists for: `StandardFonts.Helvetica` throws *at draw
      // time*, so without `toWinAnsiText` this rejects and the traveller loses every other ticket too.
      const document = pdfDocument({ fileName: "Εισιτήριο — Ρώμη 東京.pdf", entryLabel: "Πτήση προς Ρώμη" });
      const packet = await buildDocumentPacket(
        [document],
        readerFor({ [document.documentUrl]: await realPdfBytes(1, [400, 600]) }),
      );

      expect(await pageSizes(packet)).toEqual([A4_PORTRAIT, { width: 400, height: 600 }]);
    });

    it("does not ask for the bytes of a document twice, so a reader failure costs one read", async () => {
      const document = pdfDocument({ documentUrl: "/uploads/trips/t/gone.pdf" });
      const reader = vi.fn(readerFor({}));

      await buildDocumentPacket([document], reader);

      // A retry inside the builder would turn one unreadable 10 MB file into two reads of it.
      expect(reader).toHaveBeenCalledTimes(1);
    });
  });

  it("hands back a Uint8Array that starts with the PDF header", async () => {
    const document = imageDocument();
    const packet = await buildDocumentPacket(
      [document],
      readerFor({ [document.documentUrl]: realJpegBytes({ width: 100, height: 100 }) }),
    );

    expect(Buffer.from(packet.slice(0, 5)).toString("ascii")).toBe("%PDF-");
    expect(packet.byteOffset).toBe(0);
  });

  it("survives bytes handed in as a pooled Buffer view, which is what fs.readFile returns for a small file", async () => {
    // `pdf-lib`'s JpegEmbedder reads the SOF header through `new DataView(bytes.buffer)` with no
    // byteOffset, so a view into a shared buffer would have its header read from the wrong place. A
    // pooled `Buffer` is exactly what `fs.readFile` produces for a document under a few kilobytes.
    const jpeg = realJpegBytes({ width: 800, height: 1200 });
    const pool = Buffer.allocUnsafe(4096);
    const pooled = pool.subarray(64, 64 + jpeg.length);
    pooled.set(jpeg);
    expect(pooled.byteOffset).toBeGreaterThan(0);

    const document = imageDocument();
    const packet = await buildDocumentPacket([document], readerFor({ [document.documentUrl]: pooled }));

    // Two pages, not one: had the header read failed, this would have degraded to a lone label page.
    expect(await pageSizes(packet)).toEqual([A4_PORTRAIT, A4_PORTRAIT]);
  });

  it("refuses a PNG whose own header declares more pixels than the packet limit, before decoding it", async () => {
    // Upload bytes do not bound decoded bytes: a small PNG declaring 8000x8000 costs ~700 MB of RSS inside
    // `embedPng`, because @pdf-lib/upng decodes it and pdf-lib retains the channel data. The header is
    // therefore read first. The fixture is a real 1x1 PNG - correct signature, correct IHDR chunk type,
    // a genuinely deflated IDAT - whose declared dimensions alone are rewritten to 12000x12000. Rewriting
    // them does not recompute the IHDR CRC, so what this pins is the pre-check reading and refusing the
    // *declared* size: the assertion below is on the refusal reason naming pixels, not on the decoder
    // being the only other thing that could have caught it.
    const png = realPngBytes({ width: 1, height: 1 });
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    view.setUint32(16, 12000);
    view.setUint32(20, 12000);

    const document = imageDocument({ documentUrl: "/uploads/trips/t/days/d/accommodations/a/documents/doc-1.png" });
    const degraded: string[] = [];
    const packet = await buildDocumentPacket([document], readerFor({ [document.documentUrl]: png }), {
      onDegraded: (_doc, error) => degraded.push(error instanceof Error ? error.message : String(error)),
    });

    // One page, the label - not two, and not an out-of-memory kill.
    expect(await pageSizes(packet)).toEqual([A4_PORTRAIT]);
    expect(degraded).toHaveLength(1);
    expect(degraded[0]).toMatch(/pixels/);
  });

  it("degrades the documents past the whole-packet byte budget rather than building an unbounded packet", async () => {
    // Sized off the real constant so the test cannot drift away from it: two documents whose bytes exceed
    // the budget between them. The first is read and merged, the second is refused because the budget is
    // already spent, and the packet still says so with a label page rather than ending silently.
    const first = pdfDocument({ documentUrl: "/uploads/trips/t/days/d/accommodations/a/documents/doc-1.pdf" });
    const second = pdfDocument({ documentUrl: "/uploads/trips/t/days/d/accommodations/a/documents/doc-2.pdf" });
    const third = pdfDocument({ documentUrl: "/uploads/trips/t/days/d/accommodations/a/documents/doc-3.pdf" });
    const source = await realPdfBytes(1);

    const degraded: PacketDocument[] = [];
    const packet = await buildDocumentPacket([first, second, third], async () => source, {
      maxInputBytes: source.byteLength, // spent by the first document alone
      onDegraded: (document) => degraded.push(document),
    });

    // The first document is read and merged (label + its page); the two after it find the budget already
    // spent and each contribute a label alone, so the packet still accounts for every document.
    expect((await pageSizes(packet)).length).toBe(4);
    expect(degraded.map((document) => document.documentUrl)).toEqual([second.documentUrl, third.documentUrl]);
    expect(MAX_PACKET_INPUT_BYTES).toBeGreaterThan(source.byteLength);
  });

  it("degrades the images past the whole-packet decode budget, which the byte budget cannot stand in for", async () => {
    // The gap this closes, measured on this tree: a valid flat 3000x3000 PNG is 34 KB on disk and retains
    // ~26 MB once `embedPng` has run, accumulating linearly. So sixty of them are 2 MB against a 200 MB
    // byte budget and 9 MP each against a 40 MP per-image cap - every source-side bound reads as unspent
    // while ~1.5 GB is held. Only a *packet-wide* pixel budget sees that, which is why it exists and why
    // three PNGs here are sized so the second one cannot fit inside what the first leaves.
    const first = imageDocument({ documentUrl: "/uploads/trips/t/days/d/accommodations/a/documents/doc-1.png" });
    const second = imageDocument({ documentUrl: "/uploads/trips/t/days/d/accommodations/a/documents/doc-2.png" });
    const third = imageDocument({ documentUrl: "/uploads/trips/t/days/d/accommodations/a/documents/doc-3.png" });
    const png = realPngBytes({ width: 60, height: 40 }); // 2,400 pixels

    const degraded: string[] = [];
    const packet = await buildDocumentPacket(
      [first, second, third],
      readerFor({ [first.documentUrl]: png, [second.documentUrl]: png, [third.documentUrl]: png }),
      {
        // Room for exactly one of them, so the budget is spent by the first and the arithmetic is the
        // running total's rather than any single image's.
        maxDecodedPixels: 4_000,
        onDegraded: (_document, error) => degraded.push(error instanceof Error ? error.message : String(error)),
      },
    );

    // Label + image page for the first; a lone label for each of the two the budget could not cover.
    expect((await pageSizes(packet)).length).toBe(4);
    expect(degraded).toHaveLength(2);
    expect(degraded[0]).toMatch(/decode budget/);
    // The real default is far above the fixture's, so nothing here is asserting the production value away.
    expect(MAX_PACKET_DECODED_PIXELS).toBeGreaterThan(2_400 * 3);
  });

  it("degrades the PDFs past the whole-packet page budget, which neither byte budget can stand in for", async () => {
    // The gap this closes, measured on this tree with the exact `load` -> `copyPages` -> `addPage` ->
    // `save` sequence the builder runs: 1,000 pages is 0.01 MB and 73 ms, 5,000 is 0.06 MB and 390 ms,
    // 20,000 is 0.24 MB and 4.2 s at 216 MB of RSS - 4x the pages for 11x the time. A 100,000-page source
    // is ~1.3 MB, inside Story 9.1's 10 MB per-file cap, and takes ~114 s of a single-threaded event loop
    // while every other budget reads as unspent: 1 document of 60, 1.3 MB of 200 MB, 0 pixels of 80 M.
    // Page count is the only quantity that sees it, which is why it is counted separately here.
    const first = pdfDocument({ documentUrl: "/uploads/trips/t/days/d/accommodations/a/documents/doc-1.pdf" });
    const second = pdfDocument({ documentUrl: "/uploads/trips/t/days/d/accommodations/a/documents/doc-2.pdf" });
    const third = pdfDocument({ documentUrl: "/uploads/trips/t/days/d/accommodations/a/documents/doc-3.pdf" });
    const source = await realPdfBytes(4);

    const degraded: string[] = [];
    const packet = await buildDocumentPacket([first, second, third], async () => source, {
      // Room for exactly one of them, so the arithmetic under test is the running total's rather than any
      // single document's - the same shape the byte and decode budgets are exercised in above.
      maxPages: 4,
      onDegraded: (_document, error) => degraded.push(error instanceof Error ? error.message : String(error)),
    });

    // Label + 4 copied pages for the first; a lone label for each of the two the budget could not cover,
    // so the packet still accounts for every document rather than ending early with no explanation.
    expect((await pageSizes(packet)).length).toBe(7);
    expect(degraded).toHaveLength(2);
    expect(degraded[0]).toMatch(/page budget/);
    // The real default is far above the fixture's, so nothing here is asserting the production value away.
    expect(MAX_PACKET_PAGES).toBeGreaterThan(4 * 3);
  });

  it("admits a PDF sitting exactly on the page budget, so the bound cannot drift to off-by-one", async () => {
    // The companion the budget test above cannot provide: with only the over-budget case asserted, both
    // flipping the comparison to `>=` and lowering the constant stay green. This pins the other side.
    const document = pdfDocument({ documentUrl: "/uploads/trips/t/days/d/accommodations/a/documents/doc-1.pdf" });
    const source = await realPdfBytes(4);

    const degraded: string[] = [];
    const packet = await buildDocumentPacket([document], async () => source, {
      maxPages: 4,
      onDegraded: (_document, error) => degraded.push(error instanceof Error ? error.message : String(error)),
    });

    expect(degraded).toEqual([]);
    expect((await pageSizes(packet)).length).toBe(5); // label + all 4 pages, page-for-page
  });

  it("degrades a JPEG whose header declares a zero dimension instead of drawing an invisible page", async () => {
    // `embedJpg` reads the SOF dimensions and validates nothing, so a truncated or hand-corrupted header
    // declaring `0 x 600` embeds happily; scaled to fit, its drawn extent is zero and the page comes out
    // carrying no image, no failure label and no operator signal - a degradation shaped like success,
    // which is worse than any AC5 names. (`0 x 0` throws inside `drawImage` on its own and always landed
    // in the per-document catch; exactly one zero dimension is the case that slipped through.)
    const document = imageDocument({ documentUrl: "/uploads/trips/t/days/d/accommodations/a/documents/doc-1.jpg" });
    const degraded: string[] = [];
    const packet = await buildDocumentPacket(
      [document],
      readerFor({ [document.documentUrl]: realJpegBytes({ width: 0, height: 600 }) }),
      { onDegraded: (_doc, error) => degraded.push(error instanceof Error ? error.message : String(error)) },
    );

    expect(await pageSizes(packet)).toEqual([A4_PORTRAIT]);
    expect(degraded).toHaveLength(1);
    expect(degraded[0]).toMatch(/zero dimension/);
  });

  it("reports a corrupt .png by what is actually wrong with it, not as an oversized image", async () => {
    // Offsets 16 and 20 are the dimensions only in a file that really is a PNG, so the signature and the
    // IHDR chunk type are checked before they are believed. Both paths end in a label page - what this
    // pins is the reason an operator reads: `embedPng`'s own parse failure, rather than a fabricated pixel
    // count that sends them looking for an image the day does not contain.
    const document = imageDocument({ documentUrl: "/uploads/trips/t/days/d/accommodations/a/documents/doc-1.png" });
    // A real WebP served under a `.png` URL: valid bytes of the wrong format, whose offsets 16-23 happen
    // to be container data rather than dimensions.
    const degraded: string[] = [];
    const packet = await buildDocumentPacket(
      [document],
      readerFor({ [document.documentUrl]: realWebpBytes() }),
      { onDegraded: (_doc, error) => degraded.push(error instanceof Error ? error.message : String(error)) },
    );

    expect(await pageSizes(packet)).toEqual([A4_PORTRAIT]);
    expect(degraded).toHaveLength(1);
    expect(degraded[0]).not.toMatch(/pixels/);
  });

  /**
   * DW-230. The packet speaks the request's language.
   *
   * The first case is the helper's own proof and has to stay first: an extractor that silently returns
   * `""` would make every "does not contain the English heading" assertion below pass for the wrong
   * reason, which is the exact shape of test this project's reviews keep finding. So the extractor is
   * pinned against a *positive* on the default-language packet before it is trusted for anything else.
   */
  describe("DW-230 label pages in the request's language", () => {
    it("finds the English heading in a default-language packet, which is what makes the rest readable", async () => {
      const document = pdfDocument();
      const packet = await buildDocumentPacket(
        [document],
        readerFor({ [document.documentUrl]: await realPdfBytes(1, [400, 600]) }),
      );

      const text = extractPdfText(packet);
      expect(text).toContain("DOCUMENT");
      // And the document's own data reaches the page too, so this is reading the label page rather than
      // some other string that happens to say DOCUMENT.
      expect(text).toContain("Flight to Rome");
      expect(text).toContain("Boarding pass.pdf");
    });

    /**
     * The other half of that proof, and the one the helper's docblock used to make a *convention* of.
     *
     * "Assert a positive first" is only a rule while somebody remembers it, and this helper is written to
     * be shared by suites nobody has written yet - so it now throws instead of returning `""` when it finds
     * no drawn text at all. That is what makes every `not.toContain(...)` below a real assertion rather
     * than one that would pass unchanged if the extractor silently stopped working. Pinned here because a
     * guard nothing can fail is not a guard.
     */
    it("throws rather than returning an empty string for a PDF it finds no text in", async () => {
      const blank = await PDFDocument.create();
      blank.addPage([400, 600]);
      const bytes = await blank.save();

      expect(() => extractPdfText(bytes)).toThrowError(/extractPdfText/);
    });

    it("draws the German heading, and not the English one, for language: de", async () => {
      const document = pdfDocument();
      const packet = await buildDocumentPacket(
        [document],
        readerFor({ [document.documentUrl]: await realPdfBytes(1, [400, 600]) }),
        { language: "de" },
      );

      const text = extractPdfText(packet);
      expect(text).toContain("DOKUMENT");
      expect(text).not.toContain("DOCUMENT");
      // The traveller's own file name is not translated - it is what identifies the ticket.
      expect(text).toContain("Boarding pass.pdf");
    });

    it("carries the German failure heading and the German sentence on a degraded document", async () => {
      // Real bad bytes, like every other degradation case in this file: an encrypted PDF, not a thrown
      // mock. This is the label page AC5 exists for, and it is the one a German traveller is most likely
      // to have to read at a gate.
      const document = pdfDocument({ documentUrl: "/uploads/trips/t/bad.pdf", fileName: "Verschlüsselt.pdf" });
      const packet = await buildDocumentPacket(
        [document],
        readerFor({ [document.documentUrl]: await encryptedPdfBytes() }),
        { language: "de" },
      );

      const text = extractPdfText(packet);
      expect(text).toContain("DOKUMENT NICHT ENTHALTEN");
      expect(text).not.toContain("DOCUMENT NOT INCLUDED");
      expect(text).toContain("Dieses Dokument konnte nicht in dieses Paket aufgenommen werden.");
      expect(text).not.toContain("This document could not be included");
      // The umlaut, asserted rather than merely present in the fixture. It is the single premise
      // `extractPdfText` rests on - `Helvetica` is WinAnsi-encoded and WinAnsi agrees with latin1 across
      // exactly the range `toWinAnsiText` permits - and until this assertion existed every German
      // expectation in the change was pure ASCII, so the premise was argued and never exercised. A `ü`
      // arriving as `?` here would mean the packet cannot carry a German file name, which is the half of
      // the artefact DW-230 explicitly does not translate and therefore has to reproduce exactly.
      expect(text).toContain("Verschlüsselt.pdf");
    });

    it("falls back to the English packet for a language that was never passed", async () => {
      // The default is `DEFAULT_LANGUAGE`, which is what keeps every pre-DW-230 call site - and the route
      // serving a request with no `lang` cookie - producing exactly the bytes it did before.
      const document = imageDocument();
      const bytes = realJpegBytes({ width: 800, height: 1200 });
      const withDefault = await buildDocumentPacket([document], readerFor({ [document.documentUrl]: bytes }));
      const withEnglish = await buildDocumentPacket([document], readerFor({ [document.documentUrl]: bytes }), {
        language: "en",
      });

      expect(extractPdfText(withDefault)).toContain("DOCUMENT");
      expect(extractPdfText(withDefault)).toBe(extractPdfText(withEnglish));
    });

    it("changes only the words: page count, sizes and order are identical between en and de", async () => {
      // AC2's other half, and the reason `language` touches nothing but `drawLabelPage`. A German packet
      // that quietly gained or lost a page - or reordered one - would be a worse regression than an
      // untranslated one, and no assertion about text could see it.
      const pdfSource = await realPdfBytes(3, [400, 600]);
      const first = pdfDocument({ documentUrl: "/uploads/trips/t/a.pdf" });
      const second = imageDocument({ documentUrl: "/uploads/trips/t/b.jpg", fileName: "Karte.jpg" });
      const third = imageDocument({ documentUrl: "/uploads/trips/t/bad.webp", fileName: "Screenshot.webp" });
      const files = {
        [first.documentUrl]: pdfSource,
        [second.documentUrl]: realJpegBytes({ width: 1200, height: 800 }),
        // One degradation in the set, so the comparison covers the failure path's label page as well.
        [third.documentUrl]: realWebpBytes(),
      };
      const documents = [first, second, third];

      const english = await pageSizes(await buildDocumentPacket(documents, readerFor(files), { language: "en" }));
      const german = await pageSizes(await buildDocumentPacket(documents, readerFor(files), { language: "de" }));

      expect(german).toEqual(english);
      // Stated rather than left implicit, so a change that made *both* wrong in the same way still fails:
      // label + 3 copied, label + 1 landscape image page, label only for the WebP.
      expect(english).toEqual([
        A4_PORTRAIT,
        { width: 400, height: 600 },
        { width: 400, height: 600 },
        { width: 400, height: 600 },
        A4_PORTRAIT,
        { width: 841.89, height: 595.28 },
        A4_PORTRAIT,
      ]);
    });
  });

  /**
   * DW-230 review. A degraded document contributes exactly its one label page - and costs the documents
   * after it nothing.
   *
   * `drawLabelPage` calls `addPage` before it draws, so every attempt that throws leaves a blank A4 sheet
   * behind. The rollback that was added with the last-resort page was anchored *inside* the `catch`, after
   * the success-path draw and after the first attempt had already left theirs, so it could only ever remove
   * the third attempt's blank. Measured before the fix: one degraded document produced 2 pages where the
   * degradation path promises 1, and 3 when the success-path draw was the one that threw.
   *
   * **What is *not* rolled back is the budget, and `packetPages` is the case worth stating.** A revision of
   * this handler did refund it, on the reasoning that a document throwing between `copyPages` and the
   * `addPage` loop had spent budget on pages that never reached the packet. Measured, they do reach it: a
   * page belongs to the destination context from `copyPages` onward and `save()` serialises it whether or
   * not it was ever added - which is what the last case here pins, through the bytes. `MAX_PACKET_PAGES`
   * bounds exactly that copy-and-save cost, so refunding it lets a later document push the file past a
   * ceiling whose job is keeping the process up.
   *
   * Reached here through a non-string `entryLabel`, which is the only input `toWinAnsiText` cannot absorb
   * (its `for...of` throws before the sanitiser helps) and therefore the only way to make `drawLabelPage`
   * throw on demand. Unreachable from the app's own types today, which is exactly why it needs a test: the
   * whole catch chain is written for a day when it is not.
   */
  describe("DW-230 review: a failed label page leaves no blank sheet behind", () => {
    const undrawable = { entryLabel: 7 as unknown as string };

    it("costs one page, not two, when the first label-page attempt throws", async () => {
      const document = pdfDocument(undrawable);
      const packet = await buildDocumentPacket([document], readerFor({}));

      const pdf = await PDFDocument.load(packet);
      expect(pdf.getPageCount()).toBe(1);
      // And it is the label page, not a blank: the rewind must not have taken the page it was making room
      // for. Drawn from the dictionary placeholders, since the document's own label is the broken input.
      //
      // Read off the page tree, not the file. `extractPdfText` also returns the stream of the page the
      // rewind detached - which carries this same heading, from the attempt that threw - so a whole-file
      // `toContain` here passes whichever page survived and pins nothing.
      const [pageText] = await extractPageTexts(packet);
      expect(pageText).toContain("DOCUMENT NOT INCLUDED");
      expect(pageText).toContain("Document");
    });

    it("costs one page when the success-path draw is the one that throws", async () => {
      // The label page on the *success* path is outside the `catch` entirely, so its blank sheet was the
      // one no anchor inside the handler could reach. The reader succeeds here - this document was going
      // into the packet until the draw failed.
      const document = pdfDocument(undrawable);
      const packet = await buildDocumentPacket(
        [document],
        readerFor({ [document.documentUrl]: await realPdfBytes(2, [400, 600]) }),
      );

      const pdf = await PDFDocument.load(packet);
      expect(pdf.getPageCount()).toBe(1);
      expect((await pageSizes(packet))[0]).toEqual(A4_PORTRAIT);
    });

    it("keeps charging the page budget for pages it copied but could not add", async () => {
      // Two 3-page tickets and a 5-page budget. The first is copied - charging 3 - and then fails to draw
      // its label page, so none of its pages is in the packet the traveller sees. The budget stays spent
      // anyway and the second ticket is refused, which is the deliberate reading: the pages are in the
      // *file*, because `copyPages` put them in the context and `save()` writes them whether or not they
      // were ever added. Both halves are asserted below, the second through the bytes. A refund here would
      // put six pages of copied content into a packet bounded at five, past a ceiling `MAX_PACKET_PAGES`
      // documents as the thing standing between `copyPages`/`save` and the process.
      const source = await realPdfBytes(3, [400, 600]);
      const first = pdfDocument({ ...undrawable, documentUrl: "/uploads/trips/t/a.pdf" });
      const second = pdfDocument({ documentUrl: "/uploads/trips/t/b.pdf", fileName: "Second ticket.pdf" });
      const degraded: string[] = [];

      const packet = await buildDocumentPacket(
        [first, second],
        readerFor({ [first.documentUrl]: source, [second.documentUrl]: source }),
        { maxPages: 5, onDegraded: (_document, error) => degraded.push(String(error)) },
      );

      expect(degraded).toHaveLength(2);
      expect(degraded[1]).toMatch(/2 of its 5-page budget left/);
      // One label page each, and nothing else in the tree: the first document's copied pages were never
      // added, and the blank sheet its failed draw left was rewound.
      expect(await pageSizes(packet)).toEqual([A4_PORTRAIT, A4_PORTRAIT]);
      const pageTexts = await extractPageTexts(packet);
      expect(pageTexts.join("\n")).not.toContain("source page 1");
      expect(pageTexts.join("\n")).toContain("Second ticket.pdf");
      // And the reason the budget is not handed back: those pages are in the saved file regardless.
      expect(extractPdfText(packet)).toContain("source page 1");
    });
  });

  describe("DW-230 getPacketLabels", () => {
    // Two columns, not three: the first used to be a name bound to an unused `_name`, and `language`
    // already renders as `%s` in the title. Driven off the registry rather than a hardcoded [en, de],
    // matching the guards in `i18nDictionaries.test.ts` and for their reason - a third locale added to
    // `src/i18n/index.ts` inherits this instead of quietly escaping it.
    it.each(Object.entries(dictionaries) as [Language, Dictionary][])(
      "resolves all five label strings from the %s dictionary",
      (language, dictionary) => {
        // Read against the dictionary rather than restated as literals: a test that copies the strings
        // passes iff someone copied them across and catches no regression. What this pins is that each
        // field reads the key it claims to - a transposed `heading`/`headingFailed` pair would put
        // "DOCUMENT NOT INCLUDED" on every successful document and is otherwise invisible until someone
        // opens a packet.
        expect(getPacketLabels(language)).toEqual({
          heading: dictionary["trips.documents.packetLabelHeading"],
          headingFailed: dictionary["trips.documents.packetLabelHeadingFailed"],
          unavailable: dictionary["trips.documents.packetLabelUnavailable"],
          unknownEntry: dictionary["trips.documents.packetLabelUnknownEntry"],
          unknownFile: dictionary["trips.documents.packetLabelUnknownFile"],
        });
      },
    );

    it("gives the two languages five genuinely different strings", () => {
      // The guard against a half-done translation that leaves German pointing at English values - which
      // the dictionary-parity test cannot see, because parity is about keys and not about values.
      const english = getPacketLabels("en");
      const german = getPacketLabels("de");
      for (const field of ["heading", "headingFailed", "unavailable", "unknownEntry", "unknownFile"] as const) {
        expect(german[field], field).not.toBe(english[field]);
        expect(german[field].trim(), field).not.toBe("");
      }
    });
  });

  it("reports every degradation through onDegraded with the underlying error", async () => {
    // Without this the four reasons a document can be left out - unsupported format, encrypted, corrupt,
    // missing on disk - are indistinguishable to an operator, and a support report of "the packet says my
    // ticket isn't there" has nothing to go on.
    const webp = imageDocument({
      documentUrl: "/uploads/trips/t/days/d/accommodations/a/documents/doc-1.webp",
      fileName: "Screenshot.webp",
    });
    const missing = pdfDocument({ documentUrl: "/uploads/trips/t/days/d/accommodations/a/documents/gone.pdf" });
    const sealed = pdfDocument({ documentUrl: "/uploads/trips/t/days/d/accommodations/a/documents/doc-2.pdf" });

    const reasons: string[] = [];
    await buildDocumentPacket(
      [webp, missing, sealed],
      readerFor({
        [webp.documentUrl]: realWebpBytes(),
        [sealed.documentUrl]: await encryptedPdfBytes(),
      }),
      {
        onDegraded: (document, error) =>
          reasons.push(`${document.fileName}: ${error instanceof Error ? error.message : error}`),
      },
    );

    expect(reasons).toHaveLength(3);
    expect(reasons[0]).toMatch(/webp/i);
    expect(reasons[1]).toMatch(/ENOENT/);
    expect(reasons[2]).toMatch(/encrypt/i);
  });
});
