import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { IMAGE_UPLOAD_ACCEPT, isSupportedImageUpload } from "@/lib/trips/imageUploads";

// `image/jpg` and `image/pjpeg` are not registered MIME types. They previously appeared in the
// day-image field's accept filter, where macOS translated the list into the native file panel's
// allowed-type set and refused to enable its Upload button for any file - the picker offered no
// explanation, and no unit test could see it because the failure happened entirely inside the OS
// dialog, before the app ever received a change event.
const INVALID_IMAGE_MIME_TYPES = ["image/jpg", "image/pjpeg"];

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

describe("image upload accept filter", () => {
  it("declares only registered MIME types", () => {
    const mimeTypes = IMAGE_UPLOAD_ACCEPT.split(",").map((token) => token.trim());
    expect(mimeTypes).toEqual(["image/jpeg", "image/png", "image/webp"]);
    for (const invalid of INVALID_IMAGE_MIME_TYPES) {
      expect(mimeTypes).not.toContain(invalid);
    }
  });

  it("covers every format the upload routes accept", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp"]) {
      expect(IMAGE_UPLOAD_ACCEPT).toContain(type);
    }
  });

  it("never reintroduces a bogus MIME type", async () => {
    const files = await collectTsxFiles(COMPONENT_DIR);
    const offenders: string[] = [];
    for (const file of files) {
      const source = await readFile(file, "utf8");
      if (/accept:\s*"[^"]*image\//.test(source) || /accept="[^"]*image\//.test(source)) {
        offenders.push(`${path.relative(process.cwd(), file)}: inline image accept filter`);
      }
      for (const invalid of INVALID_IMAGE_MIME_TYPES) {
        if (source.includes(invalid)) {
          offenders.push(`${path.relative(process.cwd(), file)}: invalid MIME type ${invalid}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("isSupportedImageUpload", () => {
  it("accepts every format the upload routes allow", () => {
    expect(isSupportedImageUpload({ type: "image/jpeg", name: "a.jpg" })).toBe(true);
    expect(isSupportedImageUpload({ type: "image/png", name: "a.png" })).toBe(true);
    expect(isSupportedImageUpload({ type: "image/webp", name: "a.webp" })).toBe(true);
  });

  it("falls back to the extension when the browser reports no usable MIME type", () => {
    // Safari sometimes reports an empty type for files picked from unusual locations.
    expect(isSupportedImageUpload({ type: "", name: "photo.PNG" })).toBe(true);
    expect(isSupportedImageUpload({ type: "application/octet-stream", name: "photo.jpeg" })).toBe(true);
  });

  it("rejects formats the server cannot store, so the user gets a reason up front", () => {
    expect(isSupportedImageUpload({ type: "image/heic", name: "IMG_0001.HEIC" })).toBe(false);
    expect(isSupportedImageUpload({ type: "image/gif", name: "a.gif" })).toBe(false);
    expect(isSupportedImageUpload({ type: "", name: "notes.pdf" })).toBe(false);
    expect(isSupportedImageUpload({ type: "", name: "noextension" })).toBe(false);
  });
});
