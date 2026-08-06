import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DOCUMENT_UPLOAD_ACCEPT,
  MAX_DOCUMENTS_PER_ENTRY,
  documentDisplayName,
  isSupportedDocumentUpload,
  sanitizeDocumentFileName,
} from "@/lib/trips/documentUploads";

// Neither is a registered MIME type. `application/x-pdf` is an unregistered vendor spelling and
// `text/pdf` was never real at all; both still turn up in copied-and-pasted accept filters. Browsers
// translate the list into the native file panel's allowed-type set, so a bogus entry can only narrow
// or confuse it - and it does so inside the OS dialog, where the app never sees a change event and no
// unit test can observe the failure. Same lesson as `image/jpg` in `imageUploadAccept.test.ts`.
const INVALID_DOCUMENT_MIME_TYPES = ["application/x-pdf", "text/pdf", "application/acrobat"];

const COMPONENT_DIR = path.join(process.cwd(), "src", "components");

const collectTsxFiles = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return collectTsxFiles(full);
      return entry.isFile() && /\.tsx?$/.test(entry.name) ? [full] : [];
    }),
  );
  return nested.flat();
};

/**
 * The two document upload routes' own `ALLOWED_TYPES`, read out of their source.
 *
 * Read rather than re-declared, because a copy here would agree with itself forever: the property
 * being asserted is that the client-side gate matches what the servers actually store, and the only
 * way for that to fail is for one of the routes to change. Both are read, because there are two of
 * them and "the routes agree with each other" is half of what makes one shared client gate correct.
 */
const readRouteAllowedTypes = async (routePath: string) => {
  const source = await readFile(path.join(process.cwd(), routePath), "utf8");
  const block = /const ALLOWED_TYPES: Record<string, string> = \{([\s\S]*?)\};/.exec(source);
  if (!block) throw new Error(`No ALLOWED_TYPES literal found in ${routePath}`);
  const entries = [...block[1].matchAll(/"([^"]+)":\s*"([^"]+)"/g)].map(([, mime, extension]) => ({
    mime,
    extension,
  }));
  if (entries.length === 0) throw new Error(`ALLOWED_TYPES in ${routePath} parsed as empty`);
  return entries;
};

const ROUTE_PATHS = [
  "src/app/api/trips/[id]/accommodations/documents/route.ts",
  "src/app/api/trips/[id]/day-plan-items/documents/route.ts",
];

describe("document upload accept filter", () => {
  it("declares only registered MIME types", () => {
    const mimeTypes = DOCUMENT_UPLOAD_ACCEPT.split(",").map((token) => token.trim());
    expect(mimeTypes).toEqual(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
    for (const invalid of INVALID_DOCUMENT_MIME_TYPES) {
      expect(mimeTypes).not.toContain(invalid);
    }
  });

  /**
   * Written before Story 9.1's UI layer existed, on the reasoning that the moment
   * `DocumentUploadField` appears is exactly the moment a hand-rolled `accept="application/pdf,..."`
   * becomes possible, and a scan added after the fact tends to be added *around* whatever was
   * written. The field has since landed and takes `accept` as a prop, so the call sites pass
   * `DOCUMENT_UPLOAD_ACCEPT` and the scan still finds nothing - which is the passing condition, not
   * the absence of a document field.
   *
   * The two components are asserted to be *in* the scanned set for that reason: a scan whose subject
   * has quietly moved out of `src/components` passes by finding nothing at all, which is the
   * unfalsifiable-assertion failure Story 5.11's review found twice.
   */
  it("keeps the accept list in one place and never reintroduces a bogus MIME type", async () => {
    const files = await collectTsxFiles(COMPONENT_DIR);
    const scanned = files.map((file) => path.relative(process.cwd(), file));
    expect(scanned).toContain(path.join("src", "components", "forms", "DocumentUploadField.tsx"));
    expect(scanned).toContain(path.join("src", "components", "ui", "DocChip.tsx"));

    const offenders: string[] = [];
    for (const file of files) {
      const source = await readFile(file, "utf8");
      if (/accept:\s*"[^"]*application\/pdf/.test(source) || /accept="[^"]*application\/pdf/.test(source)) {
        offenders.push(`${path.relative(process.cwd(), file)}: inline document accept filter`);
      }
      for (const invalid of INVALID_DOCUMENT_MIME_TYPES) {
        if (source.includes(invalid)) {
          offenders.push(`${path.relative(process.cwd(), file)}: invalid MIME type ${invalid}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("matches both routes' ALLOWED_TYPES exactly", async () => {
    const [accommodationTypes, planItemTypes] = await Promise.all(ROUTE_PATHS.map(readRouteAllowedTypes));
    // The two routes must agree, or one shared client-side gate is wrong for one of them.
    expect(planItemTypes).toEqual(accommodationTypes);

    const declared = DOCUMENT_UPLOAD_ACCEPT.split(",").map((token) => token.trim());
    expect(declared).toEqual(accommodationTypes.map((entry) => entry.mime));

    for (const { mime, extension } of accommodationTypes) {
      expect(isSupportedDocumentUpload({ type: mime, name: `ticket.${extension}` }), mime).toBe(true);
      // And through the fallback path, which is what a browser reporting nothing useful leaves.
      expect(isSupportedDocumentUpload({ type: "", name: `ticket.${extension}` }), extension).toBe(true);
    }
  });

  it("keeps the per-entry cap where both the repositories and the client can read it", () => {
    // Ten, and in a module with no Prisma import - `TripDayView` and the two dialogs need the number
    // and cannot reach a repository without pulling the client into the bundle.
    expect(MAX_DOCUMENTS_PER_ENTRY).toBe(10);
  });
});

describe("isSupportedDocumentUpload", () => {
  it("accepts a PDF and every image type the document routes allow", () => {
    expect(isSupportedDocumentUpload({ type: "application/pdf", name: "ticket.pdf" })).toBe(true);
    expect(isSupportedDocumentUpload({ type: "image/jpeg", name: "a.jpg" })).toBe(true);
    expect(isSupportedDocumentUpload({ type: "image/png", name: "a.png" })).toBe(true);
    expect(isSupportedDocumentUpload({ type: "image/webp", name: "a.webp" })).toBe(true);
  });

  it("falls back to the extension when the browser reports no usable MIME type", () => {
    // Safari sometimes reports an empty type for files picked from unusual locations, and a PDF
    // handed over by a mail client frequently arrives as `application/octet-stream`.
    expect(isSupportedDocumentUpload({ type: "", name: "Ticket.PDF" })).toBe(true);
    expect(isSupportedDocumentUpload({ type: "application/octet-stream", name: "boarding.jpeg" })).toBe(true);
  });

  it("rejects formats the server cannot store, so the user gets a reason up front", () => {
    expect(isSupportedDocumentUpload({ type: "text/plain", name: "notes.txt" })).toBe(false);
    expect(isSupportedDocumentUpload({ type: "image/heic", name: "IMG_0001.HEIC" })).toBe(false);
    expect(isSupportedDocumentUpload({ type: "application/zip", name: "trip.zip" })).toBe(false);
    expect(isSupportedDocumentUpload({ type: "", name: "noextension" })).toBe(false);
  });
});

describe("documentDisplayName", () => {
  it("strips exactly the final extension", () => {
    expect(documentDisplayName("Ticket Rom.pdf")).toBe("Ticket Rom");
    // Several dots: the ones in the middle are part of what the user called the file.
    expect(documentDisplayName("a.b.pdf")).toBe("a.b");
    expect(documentDisplayName("boarding-pass.2026-08-05.v2.pdf")).toBe("boarding-pass.2026-08-05.v2");
  });

  it("leaves a name with no extension alone", () => {
    expect(documentDisplayName("README")).toBe("README");
  });

  /**
   * A leading dot with nothing after it is the whole name, not an empty name with an extension.
   * Treating it as an extension would leave the chip labelled with an empty string.
   */
  it("treats a dotfile as having no extension", () => {
    expect(documentDisplayName(".gitignore")).toBe(".gitignore");
  });
});

describe("sanitizeDocumentFileName", () => {
  it("reduces a path to its basename", () => {
    expect(sanitizeDocumentFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeDocumentFileName("/var/tmp/ticket.pdf")).toBe("ticket.pdf");
    // A backslash is a separator on exactly one of the operating systems a browser runs on, so
    // treating only `/` as one lets a Windows path through whole.
    expect(sanitizeDocumentFileName("C:\\Users\\tommy\\Ticket Rom.pdf")).toBe("Ticket Rom.pdf");
    expect(sanitizeDocumentFileName("folder/sub/a.b.pdf")).toBe("a.b.pdf");
  });

  it("trims and keeps an ordinary name untouched", () => {
    expect(sanitizeDocumentFileName("Ticket Rom.pdf")).toBe("Ticket Rom.pdf");
    expect(sanitizeDocumentFileName("  Ticket Rom.pdf  ")).toBe("Ticket Rom.pdf");
    // Umlauts and spaces are legal in a file name and are not the thing being defended against.
    expect(sanitizeDocumentFileName("Zugtickets München.pdf")).toBe("Zugtickets München.pdf");
  });

  it("refuses what is left when nothing usable survives", () => {
    expect(sanitizeDocumentFileName("")).toBeNull();
    expect(sanitizeDocumentFileName("   ")).toBeNull();
    expect(sanitizeDocumentFileName("a/b/")).toBeNull();
    expect(sanitizeDocumentFileName(".")).toBeNull();
    expect(sanitizeDocumentFileName("..")).toBeNull();
    expect(sanitizeDocumentFileName("../..")).toBeNull();
    expect(sanitizeDocumentFileName("some/dir/.")).toBeNull();
  });

  it("refuses control characters, which have no business in rendered or printed text", () => {
    expect(sanitizeDocumentFileName("tick\u0000et.pdf")).toBeNull();
    expect(sanitizeDocumentFileName("ticket\n.pdf")).toBeNull();
    expect(sanitizeDocumentFileName("ticket\u007f.pdf")).toBeNull();
  });

  it("caps the stored name at 255 characters rather than refusing it", () => {
    const long = `${"a".repeat(400)}.pdf`;
    const sanitized = sanitizeDocumentFileName(long);
    expect(sanitized).not.toBeNull();
    expect(sanitized).toHaveLength(255);
    // Exactly 255 is fine and is not truncated.
    const exact = "b".repeat(255);
    expect(sanitizeDocumentFileName(exact)).toBe(exact);
  });

  /**
   * `slice` counts UTF-16 code units, so a cut at 255 can land *between* the two halves of an astral
   * character - one emoji in a long file name is enough. What survives is an unpaired high surrogate:
   * it renders as U+FFFD in the chip, `JSON.stringify` writes it into the backup as a bare `\udXXX`
   * escape that no strict-UTF-8 reader will accept, and Story 9.2 will print it onto a PDF page.
   *
   * The fixture puts the emoji at exactly the boundary, which is the only position that can fail: 254
   * ASCII characters, then a surrogate pair whose leading half is code unit 255.
   */
  it("never leaves half a character behind when it truncates", () => {
    const sanitized = sanitizeDocumentFileName(`${"a".repeat(254)}🎫 Rom.pdf`);
    expect(sanitized).not.toBeNull();
    // The pair is dropped whole rather than split, so the name is one code unit shorter than the cap.
    expect(sanitized).toHaveLength(254);
    expect(sanitized).toBe("a".repeat(254));
    // No lone surrogate survives, in either half of the range.
    expect(/[\uD800-\uDFFF]/.test(sanitized ?? "")).toBe(false);
    // A pair that fits is untouched.
    expect(sanitizeDocumentFileName("Ticket 🎫.pdf")).toBe("Ticket 🎫.pdf");
  });
});
