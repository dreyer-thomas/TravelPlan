import sharp from "sharp";

/**
 * Story 15.8. An image's pixel size for the connector's file shapes: the **original** size after EXIF
 * orientation, so a portrait phone photo reports portrait. Read from the header only (`metadata()`), cached
 * per file version and read a few at a time, because `get_day` may list dozens of images.
 */

export type ImageSize = { width: number; height: number };

const MAX_CACHE_ENTRIES = 5_000;
const READ_CONCURRENCY = 8;

/** Keyed by `fileId:updatedAt`: a replaced file has a new id or `updatedAt`, so a size is never stale. */
const sizeCache = new Map<string, ImageSize>();

const cacheKey = (fileId: string, updatedAt: Date) => `${fileId}:${updatedAt.toISOString()}`;

const remember = (key: string, size: ImageSize) => {
  sizeCache.set(key, size);
  if (sizeCache.size > MAX_CACHE_ENTRIES) {
    // A Map iterates in insertion order, so the first key is the oldest entry.
    sizeCache.delete(sizeCache.keys().next().value!);
  }
};

/** The oriented size, or `null` when sharp cannot read the file. */
export const readImageSize = async (filePath: string): Promise<ImageSize | null> => {
  try {
    const metadata = await sharp(filePath).metadata();
    const width = metadata.autoOrient?.width ?? metadata.width;
    const height = metadata.autoOrient?.height ?? metadata.height;
    return width && height ? { width, height } : null;
  } catch {
    return null;
  }
};

/**
 * The size of each image by id, `null` when its path does not resolve or sharp cannot read it. A failure is
 * not cached, so a passing problem (a file being written, too many open files) does not stick.
 */
export const readImageSizes = async (
  images: { fileId: string; updatedAt: Date; resolvePath: () => Promise<string | null> }[],
): Promise<Map<string, ImageSize | null>> => {
  const sizes = new Map<string, ImageSize | null>();
  const pending = images.filter((image) => {
    const cached = sizeCache.get(cacheKey(image.fileId, image.updatedAt));
    if (cached) sizes.set(image.fileId, cached);
    return !cached;
  });
  for (let start = 0; start < pending.length; start += READ_CONCURRENCY) {
    await Promise.all(
      pending.slice(start, start + READ_CONCURRENCY).map(async (image) => {
        const filePath = await image.resolvePath();
        const size = filePath ? await readImageSize(filePath) : null;
        if (size) remember(cacheKey(image.fileId, image.updatedAt), size);
        sizes.set(image.fileId, size);
      }),
    );
  }
  return sizes;
};

/** Tests only: forget every cached size. */
export const clearImageSizeCache = () => sizeCache.clear();
