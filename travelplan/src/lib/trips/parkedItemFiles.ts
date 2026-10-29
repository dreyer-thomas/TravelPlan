import fs from "node:fs/promises";
import path from "node:path";
import { removeManagedMediaFile } from "@/lib/trips/mediaCleanup";
import {
  getParkedDayPlanItemDocumentUploadDir,
  getParkedDayPlanItemImageUploadDir,
  resolveManagedItemMediaDir,
} from "@/lib/trips/uploadPaths";

/**
 * Story 14.1 §15, moved here from `bucket-list-items/route.ts` by Story 15.4 so the connector's
 * `delete_activity` removes a parked activity's files exactly as the app's delete does.
 *
 * After the commit: each file from the folder its own URL names (`resolveManagedItemMediaDir`), so a
 * picture the activity got on an earlier day goes too; a URL outside the item's folders is logged and
 * skipped. Then every folder a file came from (and an item folder above a documents folder) and the parked
 * folders, deepest first, each only if empty. Never throws: the row is already gone.
 */
export const removeParkedItemFiles = async (
  tripId: string,
  itemId: string,
  urls: { imageUrls: string[]; documentUrls: string[] },
) => {
  const files = [
    ...urls.imageUrls.map((storedUrl) => ({ storedUrl, kind: "image" as const })),
    ...urls.documentUrls.map((storedUrl) => ({ storedUrl, kind: "document" as const })),
  ];
  const dirs = new Set([getParkedDayPlanItemDocumentUploadDir(tripId, itemId), getParkedDayPlanItemImageUploadDir(tripId, itemId)]);
  for (const { storedUrl, kind } of files) {
    const allowedDir = resolveManagedItemMediaDir({ storedUrl, tripId, itemId, kind });
    if (!allowedDir) {
      console.error("bucket list item delete: stored media url names no folder of this activity", {
        tripId,
        itemId,
        storedUrl,
      });
      continue;
    }
    await removeManagedMediaFile({ storedUrl, allowedDir, context: "bucket list item delete" });
    dirs.add(allowedDir);
    // A document sits in `<item>/documents`; the item's own folder above it may be empty now too.
    if (kind === "document") dirs.add(path.dirname(allowedDir));
  }
  // Deepest first, so a documents folder goes before the item folder that holds it.
  for (const dir of [...dirs].sort((left, right) => right.length - left.length)) {
    await fs.rmdir(dir).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT" && error.code !== "ENOTEMPTY") {
        console.error("bucket list item delete: could not remove folder", { tripId, itemId, dir, code: error.code });
      }
    });
  }
};

