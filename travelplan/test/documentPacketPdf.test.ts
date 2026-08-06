import { describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  MAX_PACKET_DECODED_PIXELS,
  MAX_PACKET_INPUT_BYTES,
  MAX_PACKET_PAGES,
  buildDocumentPacket,
  readJpegOrientation,
  toWinAnsiText,
  type PacketDocument,
} from "@/lib/trips/packetPdf";
import { truncateText } from "@/lib/trips/printDocuments";
import {
  encryptedPdfBytes,
  realJpegBytes,
  realPngBytes,
  realPdfBytes,
  realWebpBytes,
  truncatedPdfBytes,
} from "./helpers/packetFixtures";

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
