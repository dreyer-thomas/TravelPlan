import { PDFDocument } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import { buildDocumentPacket, type PacketDocument } from "@/lib/trips/packetPdf";
import { extractPdfText } from "./helpers/pdfText";

/**
 * The packet's third and last line of defence, which is the only one that cannot be reached with ordinary
 * inputs - and therefore the only one that would otherwise ship untested (DW-230 review).
 *
 * `buildDocumentPacket` draws a failing document's label page three ways: with the document's own strings,
 * then with the dictionary's placeholders, then with `LAST_RESORT_LABELS`. The middle attempt covers a
 * *document* whose `entryLabel` or `fileName` cannot be drawn. It cannot cover a broken `labels` object,
 * because it passes that same object back in - so before the third attempt existed, one unusable dictionary
 * value took the whole packet down through the very page AC5 exists to draw, and the route answered 500.
 *
 * **Why the dictionary is mocked rather than a value being chosen that breaks the real one.** It cannot be:
 * every string in either dictionary goes through `toWinAnsiText`, which emits only characters `Helvetica`
 * can encode, and `i18nDictionaries.test.ts` pins that at the source as well. The reachable failure is a
 * value that is not a `string` at all - a number left in a dictionary, a key resolving to something a
 * refactor changed - at which point `toWinAnsiText`'s `for...of` throws before any of that helps. So the
 * `en` dictionary is given exactly one such value, in `packetLabelHeadingFailed`: the field *every* failure
 * page draws, and therefore the one that breaks both of the first two attempts at once.
 *
 * The mock is a whole file of its own for the same reason - it changes what every packet in scope says, and
 * `documentPacketPdf.test.ts` asserts the real English wording throughout.
 */
vi.mock("@/i18n", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/i18n")>();
  return {
    ...actual,
    dictionaries: {
      ...actual.dictionaries,
      en: {
        ...actual.dictionaries.en,
        // Not a string, so `toWinAnsiText` throws on it - the one shape of bad dictionary value the
        // sanitiser cannot absorb.
        "trips.documents.packetLabelHeadingFailed": 7 as unknown as string,
      },
    },
  };
});

const failingDocument: PacketDocument = {
  entryLabel: "Flight to Rome",
  fileName: "Boarding pass.pdf",
  documentUrl: "/uploads/trips/t/days/d/day-plan-items/i/documents/doc-1.pdf",
  isPdf: true,
};

// A real degradation, the same one AC5's "missing file on disk" case uses: the reader throws, so the
// document lands in the per-document catch and every label-page attempt below is the genuine code path.
const readerThatCannotFind = async () => {
  throw new Error("ENOENT: no such file or directory");
};

describe("packet label page of last resort", () => {
  it("still answers with a packet when the dictionary is what breaks the label page", async () => {
    const packet = await buildDocumentPacket([failingDocument], readerThatCannotFind);

    // The property that matters is the one stated as an absence: nothing escaped `buildDocumentPacket`, so
    // the route answers 200 with a packet rather than 500 with `server_error`.
    const pdf = await PDFDocument.load(packet);
    expect(pdf.getPageCount()).toBe(1);

    const text = extractPdfText(packet);
    // Drawn from the module constants, not from the mocked dictionary - which is the whole point: the page
    // stops speaking the request's language rather than not existing.
    expect(text).toContain("DOCUMENT NOT INCLUDED");
    expect(text).toContain("Document");
    expect(text).toContain("unnamed file");
    expect(text).toContain("This document could not be included in this packet.");
  });

  it("reports the degradation through onDegraded with the reason the document failed", async () => {
    // The operator signal has to survive all three attempts: a packet whose last-resort page says nothing
    // about *which* document it stands for is only useful if the log says.
    const reasons: string[] = [];
    await buildDocumentPacket([failingDocument], readerThatCannotFind, {
      onDegraded: (_document, error) => reasons.push(error instanceof Error ? error.message : String(error)),
    });

    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain("ENOENT");
  });

  it("keeps going: one document with an undrawable label costs its own page and nothing else", async () => {
    // Three documents, all degrading, so the recovery is shown to leave the loop in a state the next
    // iteration can use - a fallback that swallowed the packet after the first failure would still pass a
    // single-document assertion.
    const documents = [1, 2, 3].map((n) => ({ ...failingDocument, documentUrl: `/uploads/trips/t/doc-${n}.pdf` }));
    const packet = await buildDocumentPacket(documents, readerThatCannotFind);

    const pdf = await PDFDocument.load(packet);
    expect(pdf.getPageCount()).toBe(3);
  });
});
