import fs from "node:fs/promises";
import path from "node:path";
import { getTripUploadDir, isExternalMediaUrl, resolveStoredMediaPath } from "@/lib/trips/uploadPaths";

/**
 * Story 15.7, shared since 15.8 by `get_file`, the connector's file links and the `/f/` route.
 *
 * The file's path on disk, or `null` when its stored URL must not be read: external, outside this trip's
 * own upload tree (lexically, or through a symlink), or missing. The containment of `dayPacket.ts`, layer
 * for layer, against this trip's directory and not the uploads root.
 */
export const resolveTripFilePath = async (tripId: string, storedUrl: string): Promise<string | null> => {
  if (!storedUrl || isExternalMediaUrl(storedUrl)) return null;
  const tripRoot = path.resolve(getTripUploadDir(tripId));
  const requested = path.resolve(resolveStoredMediaPath(storedUrl));
  if (!requested.startsWith(`${tripRoot}${path.sep}`)) return null;
  // The root realpath'd too: on macOS the test media root sits under a symlinked `/var`.
  const tripRootReal = await fs.realpath(tripRoot).catch(() => tripRoot);
  const real = await fs.realpath(requested).catch(() => null);
  if (!real || !real.startsWith(`${tripRootReal}${path.sep}`)) return null;
  return real;
};

/** The file's first `length` bytes (fewer when it is shorter), for sniffing its type. */
export const readFileHead = async (filePath: string, length: number) => {
  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
};
