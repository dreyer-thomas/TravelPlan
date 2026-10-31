import { MCP_IMAGE_LINK_WIDTH, readFileLinkTtlSeconds, signFileLink } from "@/lib/files/fileLinks";
import { readImageSizes } from "@/lib/files/imageInfo";
import {
  toBucketActivity,
  toPlannerDay,
  type FileLink,
  type FileLinks,
} from "@/lib/mcp/plannerShapes";
import type { ParkedDayPlanItemDetail } from "@/lib/repositories/bucketListRepo";
import type { PlannerDay, PlannerMedia } from "@/lib/repositories/connectorReadRepo";
import { resolveTripFilePath } from "@/lib/trips/tripFilePath";

/**
 * Story 15.8. The signed `downloadUrl`s and image sizes the connector's file shapes carry, built here so
 * `plannerShapes.ts` stays pure. Every tool that returns a day "as get_day shows it" goes through
 * `toLinkedPlannerDay`, so those results stay identical to `get_day`.
 *
 * A document is signed by id (no width) once its path resolves inside the trip's tree. An image is signed
 * with `w=1600` once its original size has been read from disk; an external image, an unreadable file or a
 * missing secret gives `downloadUrl`, `width` and `height` all `null`. An external or missing document gives
 * `downloadUrl: null`.
 */

const NO_LINK: FileLink = { downloadUrl: null, width: null, height: null };

export const buildFileLinks = async (tripId: string, media: PlannerMedia[]): Promise<FileLinks> => {
  const links: FileLinks = new Map();
  const documents = media.flatMap((entry) => entry.documents);
  const images = media.flatMap((entry) => entry.images);
  // Signed only when it lies on disk inside the trip's tree, as `get_file` does: a link that can only 404 is null.
  await Promise.all(
    documents.map(async (document) => {
      const url = signFileLink(document.id)?.url ?? null;
      const onDisk = url !== null && (await resolveTripFilePath(tripId, document.documentUrl)) !== null;
      links.set(document.id, { downloadUrl: onDisk ? url : null });
    }),
  );
  // Without a secret nothing is signed, and then no image is read from disk either.
  const signed: { image: PlannerMedia["images"][number]; url: string }[] = [];
  for (const image of images) {
    const url = signFileLink(image.id, { width: MCP_IMAGE_LINK_WIDTH })?.url ?? null;
    if (url === null) links.set(image.id, NO_LINK);
    else signed.push({ image, url });
  }
  const sizes = await readImageSizes(
    signed.map(({ image }) => ({
      fileId: image.id,
      updatedAt: image.updatedAt,
      resolvePath: () => resolveTripFilePath(tripId, image.imageUrl),
    })),
  );
  for (const { image, url } of signed) {
    const size = sizes.get(image.id);
    links.set(image.id, size ? { downloadUrl: url, width: size.width, height: size.height } : NO_LINK);
  }
  return links;
};

/** `toPlannerDay` with the day's activity and stay files linked. */
export const toLinkedPlannerDay = async (tripId: string, day: PlannerDay) =>
  toPlannerDay(day, await buildFileLinks(tripId, [...day.items, ...(day.stay ? [day.stay] : [])]));

/** `toBucketActivity` for each parked activity, with every file linked in one pass. */
export const toLinkedBucketActivities = async (
  tripId: string,
  items: ParkedDayPlanItemDetail[],
  media: Map<string, PlannerMedia>,
) => {
  const links = await buildFileLinks(tripId, [...media.values()]);
  return items.map((item) => toBucketActivity(item, media.get(item.id), links));
};

/** The tool-description text on `downloadUrl`, with the link lifetime from the configuration. */
export const fileLinkNote = () => {
  const minutes = Math.max(1, Math.round(readFileLinkTtlSeconds() / 60));
  return (
    `Each image and document carries downloadUrl: a short-lived link (valid about ${minutes} ` +
    `minute${minutes === 1 ? "" : "s"}) that needs ` +
    "no login and no token; fetch it with a plain HTTPS GET. An image comes at most " +
    `${MCP_IMAGE_LINK_WIDTH} pixels wide (an image attached as a document at its original size), re-encoded ` +
    "without any metadata (no EXIF, no GPS); an image's width and height are the original's pixels. The size " +
    "is fixed by the link's signature, so for another size, or once a link has expired, read again for a new " +
    "one. downloadUrl (and an image's width and height) is null when the file cannot be served, e.g. an " +
    "external image."
  );
};
