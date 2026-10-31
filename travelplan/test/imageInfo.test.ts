import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp, { type Sharp } from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearImageSizeCache, readImageSize, readImageSizes } from "@/lib/files/imageInfo";

/** Story 15.8. The oriented size, the per-version cache and the bounded reads behind the connector's image shapes. */

const dir = path.join(os.tmpdir(), "travelplan-test-image-info", process.env.VITEST_WORKER_ID ?? "0");

const writeImage = async (name: string, image: Sharp) => {
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, name);
  await fs.writeFile(filePath, await image.toBuffer());
  return filePath;
};

const solid = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: "gray" } });

beforeEach(() => {
  clearImageSizeCache();
});

describe("readImageSize", () => {
  it("reports the size after EXIF orientation, and null for a file sharp cannot read", async () => {
    expect(await readImageSize(await writeImage("plain.jpg", solid(400, 300).jpeg()))).toEqual({ width: 400, height: 300 });
    const rotated = await writeImage("rotated.jpg", solid(400, 300).jpeg().withMetadata({ orientation: 6 }));
    expect(await readImageSize(rotated)).toEqual({ width: 300, height: 400 });
    await fs.writeFile(path.join(dir, "broken.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));
    expect(await readImageSize(path.join(dir, "broken.jpg"))).toBeNull();
    expect(await readImageSize(path.join(dir, "missing.jpg"))).toBeNull();
  });
});

describe("readImageSizes", () => {
  it("caches a size per file id and updatedAt, and reads again for a new updatedAt", async () => {
    const filePath = await writeImage("cached.png", solid(120, 80).png());
    const resolvePath = vi.fn(async () => filePath);
    const updatedAt = new Date("2027-01-01T00:00:00.000Z");
    const first = await readImageSizes([{ fileId: "f1", updatedAt, resolvePath }]);
    const second = await readImageSizes([{ fileId: "f1", updatedAt, resolvePath }]);
    expect(first.get("f1")).toEqual({ width: 120, height: 80 });
    expect(second.get("f1")).toEqual({ width: 120, height: 80 });
    expect(resolvePath).toHaveBeenCalledTimes(1);
    await readImageSizes([{ fileId: "f1", updatedAt: new Date("2027-01-02T00:00:00.000Z"), resolvePath }]);
    expect(resolvePath).toHaveBeenCalledTimes(2);
  });

  it("does not cache a failure, and gives an unresolved path null", async () => {
    const resolvePath = vi.fn(async () => null);
    const updatedAt = new Date("2027-01-01T00:00:00.000Z");
    expect((await readImageSizes([{ fileId: "f2", updatedAt, resolvePath }])).get("f2")).toBeNull();
    expect((await readImageSizes([{ fileId: "f2", updatedAt, resolvePath }])).get("f2")).toBeNull();
    expect(resolvePath).toHaveBeenCalledTimes(2);
  });

  it("reads at most 8 files at a time", async () => {
    const filePath = await writeImage("many.jpg", solid(10, 10).jpeg());
    let active = 0;
    let peak = 0;
    const images = Array.from({ length: 30 }, (_, index) => ({
      fileId: `many-${index}`,
      updatedAt: new Date("2027-01-01T00:00:00.000Z"),
      resolvePath: async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return filePath;
      },
    }));
    const sizes = await readImageSizes(images);
    expect(sizes.size).toBe(30);
    expect(peak).toBe(8);
  });
});
