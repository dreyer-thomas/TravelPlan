import {
  fileLinksEnabled,
  MCP_IMAGE_LINK_WIDTH,
  readFileLinkTtlSeconds,
  signFileLink,
  type FileLinkExtension,
} from "@/lib/files/fileLinks";
import { readImageSizes, type ImageSize } from "@/lib/files/imageInfo";
import {
  toBucketActivity,
  toPlannerDay,
  type FileLink,
  type FileLinks,
} from "@/lib/mcp/plannerShapes";
import type { ParkedDayPlanItemDetail } from "@/lib/repositories/bucketListRepo";
import type { PlannerDay, PlannerMedia } from "@/lib/repositories/connectorReadRepo";
import { sniffDocumentContentType } from "@/lib/trips/importPackage";
import { readFileHead, resolveTripFilePath } from "@/lib/trips/tripFilePath";

/**
 * Story 15.8. The signed `downloadUrl`s and image sizes the connector's file shapes carry, built here so
 * `plannerShapes.ts` stays pure. Every tool that returns a day "as get_day shows it" goes through
 * `toLinkedPlannerDay`, so those results stay identical to `get_day`.
 *
 * A document is signed by id (no width) once it lies on disk inside the trip's tree. An image is signed
 * with `w=1600` once its original size has been read from disk; an external image, an unreadable file or a
 * missing secret gives `downloadUrl`, `width` and `height` all `null`. An external or missing document gives
 * `downloadUrl: null`.
 *
 * Each link's path ends in the extension of what the route sends (`.jpg`, `.webp`, `.pdf`), because some
 * download tools refuse a URL without one before they fetch it.
 */

const NO_IMAGE_LINK: FileLink = { downloadUrl: null, width: null, height: null };

/** An image's link and original size from its read size; an unread or unreadable image gives nulls. */
export const imageFileLink = (fileId: string, size: ImageSize | null | undefined): FileLink => {
  const url = size ? signFileLink(fileId, { width: MCP_IMAGE_LINK_WIDTH, extension: size.extension })?.url : null;
  return size && url ? { downloadUrl: url, width: size.width, height: size.height } : NO_IMAGE_LINK;
};

/**
 * A document's link (no width, it keeps its size), named by what the route sends: `.pdf`, or for an image
 * document the re-encoded image's extension. A document that is not on disk or cannot be served gives null.
 */
export const documentFileLink = async (
  document: { id: string; updatedAt: Date },
  filePath: string | null,
): Promise<FileLink> => {
  const head = filePath ? await readFileHead(filePath, 16).catch(() => null) : null;
  const contentType = head ? sniffDocumentContentType(head) : null;
  let extension: FileLinkExtension | null = null;
  if (contentType === "application/pdf") {
    extension = "pdf";
  } else if (contentType) {
    const sizes = await readImageSizes([{ fileId: document.id, updatedAt: document.updatedAt, resolvePath: async () => filePath }]);
    extension = sizes.get(document.id)?.extension ?? null;
  }
  return { downloadUrl: extension ? (signFileLink(document.id, { extension })?.url ?? null) : null };
};

export const buildFileLinks = async (tripId: string, media: PlannerMedia[]): Promise<FileLinks> => {
  const links: FileLinks = new Map();
  // Without a secret nothing is signed and nothing is read from disk; a missing entry gives nulls (`toFiles`).
  if (!fileLinksEnabled()) return links;
  const documents = media.flatMap((entry) => entry.documents);
  const images = media.flatMap((entry) => entry.images);
  await Promise.all(
    documents.map(async (document) => {
      links.set(document.id, await documentFileLink(document, await resolveTripFilePath(tripId, document.documentUrl)));
    }),
  );
  const sizes = await readImageSizes(
    images.map((image) => ({
      fileId: image.id,
      updatedAt: image.updatedAt,
      resolvePath: () => resolveTripFilePath(tripId, image.imageUrl),
    })),
  );
  for (const image of images) links.set(image.id, imageFileLink(image.id, sizes.get(image.id)));
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
