import fs from "node:fs/promises";
import path from "node:path";
import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { guardedFetch, type GuardedFetchFailure, type GuardedFetchOptions, type GuardedFetchResult } from "@/lib/http/guardedFetch";
import { toolError } from "@/lib/mcp/logging";
import {
  DESTRUCTIVE_WRITE_TOOL_ANNOTATIONS,
  idSchema,
  READ_ONLY_TOOL_ANNOTATIONS,
  requireWritableTrip,
  runTool,
  toolResult,
  WRITE_TOOL_ANNOTATIONS,
} from "@/lib/mcp/toolRuntime";
import { isCaller, readDay, recordChange, startWrite, tripIdField, writeErrorResult } from "@/lib/mcp/tools/activityWrite";
import { UnstorableReceiptError } from "@/lib/repositories/aiChangeRepo";
import { attachFileForConnector, deleteFileForConnector } from "@/lib/repositories/connectorFileRepo";
import { findFileForPlanner, findFileParentForPlanner, type PlannerFileRow } from "@/lib/repositories/connectorReadRepo";
import { checkRateLimit } from "@/lib/security/rateLimit";
import { DOCUMENT_LIMIT_ERROR_MESSAGE, MAX_DOCUMENTS_PER_ENTRY, sanitizeDocumentFileName } from "@/lib/trips/documentUploads";
import { sniffDocumentContentType, sniffPhotoContentType } from "@/lib/trips/importPackage";
import { removeManagedMediaFile } from "@/lib/trips/mediaCleanup";
import {
  getAccommodationDocumentUploadDir,
  getAccommodationImageUploadDir,
  getDayPlanItemDocumentUploadDir,
  getDayPlanItemImageUploadDir,
  getParkedDayPlanItemDocumentUploadDir,
  getParkedDayPlanItemImageUploadDir,
  getTripUploadDir,
  isExternalMediaUrl,
  resolveManagedItemMediaDir,
  resolveStoredMediaPath,
} from "@/lib/trips/uploadPaths";
import { ChangedSinceReadError } from "@/lib/trips/writeOrigin";

/**
 * Story 15.7. The connector's file tools: read one attached document or image (`get_file`), attach one
 * (`attach_file`) and delete one (`delete_file`), on the 15.4 rails (`startWrite`, `origin: "ai"` on the new
 * row, one `ai_changes` row in the write's own transaction, undo through `undo_ai_change`).
 *
 * **The files are the app's own.** An attach writes exactly where the app's four upload routes write (same
 * folders, same URL forms, `doc-`/`img-` disk names), so the day packet, the day email and the app's own
 * delete find a connector's ticket like any other. The bytes are stored unchanged, as the app stores them.
 *
 * **The type is judged by content only** (`sniffDocumentContentType`, `sniffPhotoContentType`): the name the
 * model gives, the URL's extension and the server's `content-type` are all ignored, and the extension on disk
 * comes from the sniffed type. A URL is fetched through the 15.1 guarded fetcher (https on 443, public
 * addresses only, checked on every redirect), never with a plain `fetch`.
 *
 * **Nothing about storage reaches the model.** Files are named by id; no `/uploads` URL or disk path appears
 * in any result, and the log line carries the tool, the user and the trip only, never the content or the URL.
 *
 * **Undo.** An attach or a delete on an entry with a day is undoable for 14 days (`fileAttached`,
 * `fileDeleted`). A deleted file stays on disk until then, and the expiry sweep removes it. A parked
 * activity's file writes have no receipt (no day), so a parked delete removes the file at once, as the app
 * does.
 */

export const FILE_NOT_FOUND = "File not found";
const ACTIVITY_NOT_FOUND = "Activity not found";
const STAY_NOT_FOUND = "Stay not found";
const FILE_NAME_UNUSABLE = "fileName has no usable characters; give the file's name, e.g. ticket.pdf.";
const ONE_SOURCE = "Give exactly one of contentBase64 or url.";
const NOT_BASE64 = "contentBase64 is not valid base64 (standard alphabet, with padding, no spaces or line breaks).";
const EMPTY_FILE = "The file is empty.";
const UPLOAD_LIMIT = "Upload limit reached (20 per hour); try again later.";
const NOT_A_DOCUMENT = "Only PDF, JPEG, PNG and WebP files can be attached as documents; this file is none of them.";
const NOT_AN_IMAGE = "Only JPEG, PNG and WebP files can be attached as images; this file is none of them.";
const PARENT_CHANGED =
  "The entry changed while the file was being saved (it was deleted or moved to another day); read it again and retry.";
const FILE_CHANGED =
  "This file changed since you read it, or is gone; read the day again with get_day and retry with the file's updatedAt.";
const UNSTORABLE_RECEIPT = "This file holds data the undo cannot keep, so nothing was written.";

/** Story 15.7, Epic 15 rule: 20 uploads per user and hour, counted once an attempt reaches the download. */
export const UPLOAD_RATE_LIMIT = 20;
export const UPLOAD_RATE_WINDOW_MS = 3_600_000;

const MIB = 1024 * 1024;
/** Inline content, decoded: keeps the base64 body well under the `/api/mcp` 2 MB cap. */
export const MAX_INLINE_BYTES = MIB;
/** A URL download: the app's own limits, 10 MB for a document and 5 MB for an image. */
const MAX_URL_DOCUMENT_BYTES = 10 * MIB;
const MAX_URL_IMAGE_BYTES = 5 * MIB;
/** `get_file` hands back at most this much as an embedded resource; a larger file answers metadata only. */
const MAX_TRANSFER_BYTES = 10 * MIB;
const DOWNLOAD_TIMEOUT_MS = 15_000;
const MAX_DOWNLOAD_REDIRECTS = 3;
/** The longest `subject` a file change stores, in code points. */
const MAX_SUBJECT_LENGTH = 120;

const fetchFile = (url: string, options: GuardedFetchOptions): Promise<GuardedFetchResult> => guardedFetch(url, options);

/** The injection seam: tests replace `fetch` with the real `guardedFetch` over fake DNS and request deps. */
export const fileToolDeps = { fetch: fetchFile };

/** Strict base64: the standard alphabet in groups of four, padded; no whitespace, no URL-safe letters. */
const STRICT_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

const EXTENSIONS: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** The fallback when the content does not sniff (or was not read): the stored name's extension. */
const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

const mimeOfName = (fileName: string) => {
  const extension = fileName.includes(".") ? fileName.split(".").pop()!.toLowerCase() : "";
  return Object.prototype.hasOwnProperty.call(MIME_BY_EXTENSION, extension)
    ? MIME_BY_EXTENSION[extension]
    : "application/octet-stream";
};

const subjectOf = (name: string) => [...name.trim()].slice(0, MAX_SUBJECT_LENGTH).join("") || null;

const fetchFailureText = (reason: GuardedFetchFailure, maxBytes: number): string => {
  switch (reason) {
    case "invalid_url":
      return "Only https URLs on port 443 with a host name are accepted.";
    case "blocked_address":
      return "That address is not public.";
    case "too_large":
      return `The file is larger than ${maxBytes / MIB} MB.`;
    case "timeout":
      return "The download took longer than 15 seconds.";
    case "redirect":
    case "too_many_redirects":
      return "Too many redirects.";
    case "dns_failed":
    case "network":
      return "The download failed.";
    default: {
      const unhandled: never = reason;
      throw new Error(`Unhandled fetch failure: ${String(unhandled)}`);
    }
  }
};

// ---------------------------------------------------------------------------------------------------------
// Inputs

const fileIdField = idSchema.describe("The file's id: a document's or image's id from get_day or get_bucket_list.");

const getInput = z.object({ tripId: tripIdField, fileId: fileIdField });

const attachInput = z
  .object({
    tripId: tripIdField,
    target: z.enum(["activity", "stay"]).describe("What the file belongs to: an activity (on a day or in the bucket list) or a stay."),
    id: idSchema.describe("The activity's or the stay's id, from get_day or get_bucket_list."),
    fileName: z
      .string()
      .max(1000)
      .describe("The file's name as the user should see it, e.g. \"Train ticket Prague.pdf\" (documents show it as their label; an image keeps no name and is listed by its stored name)."),
    as: z
      .enum(["document", "image"])
      .optional()
      .describe("document (default): a ticket, booking or voucher, in the day packet; image: a photo in the entry's gallery."),
    contentBase64: z
      .string()
      .max(2_000_000)
      .optional()
      .describe("The file's bytes as standard base64 (with padding, no line breaks), at most 1 MB decoded."),
    url: z
      .string()
      .max(2000)
      .optional()
      .describe("An https address to download the file from instead: at most 10 MB for a document, 5 MB for an image."),
  })
  .refine((args) => (args.contentBase64 === undefined) !== (args.url === undefined), { message: ONE_SOURCE });

const deleteInput = z.object({
  tripId: tripIdField,
  fileId: fileIdField,
  updatedAt: z.iso
    .datetime({ offset: true, error: "Use the ISO 8601 updatedAt from the read" })
    .describe("The file's updatedAt (ISO 8601) exactly as get_day or get_bucket_list returned it."),
});

type AttachArgs = z.infer<typeof attachInput>;

// ---------------------------------------------------------------------------------------------------------
// get_file

/**
 * The file's path on disk, or `null` when its stored URL must not be read: external, outside this trip's
 * own upload tree (lexically, or through a symlink), or missing. The containment of `dayPacket.ts`, layer
 * for layer, against this trip's directory and not the uploads root.
 */
const resolveTripFile = async (tripId: string, storedUrl: string): Promise<string | null> => {
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

const readHead = async (filePath: string, length: number) => {
  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
};

const fileMetadata = (file: PlannerFileRow, extra: { mimeType: string; sizeBytes: number | null; available: boolean }) => ({
  id: file.id,
  fileName: file.fileName,
  media: file.media,
  target: { type: file.target, id: file.parentId },
  mimeType: extra.mimeType,
  sizeBytes: extra.sizeBytes,
  updatedAt: file.updatedAt.toISOString(),
  aiChangedAt: file.aiChangedAt ? file.aiChangedAt.toISOString() : null,
  available: extra.available,
});

const getFile = async (tripId: string, file: PlannerFileRow): Promise<CallToolResult> => {
  const filePath = await resolveTripFile(tripId, file.url);
  const stat = filePath ? await fs.stat(filePath).catch(() => null) : null;
  if (!filePath || !stat?.isFile()) {
    return toolResult(fileMetadata(file, { mimeType: mimeOfName(file.fileName), sizeBytes: null, available: false }));
  }
  if (stat.size > MAX_TRANSFER_BYTES) {
    const head = await readHead(filePath, 16);
    const mimeType = sniffDocumentContentType(head) ?? mimeOfName(file.fileName);
    return toolResult({
      ...fileMetadata(file, { mimeType, sizeBytes: stat.size, available: true }),
      note: `The file is larger than ${MAX_TRANSFER_BYTES / MIB} MB, too large to transfer; open it in TravelPlan.`,
    });
  }
  const bytes = await fs.readFile(filePath);
  const mimeType = sniffDocumentContentType(bytes) ?? mimeOfName(file.fileName);
  const metadata = fileMetadata(file, { mimeType, sizeBytes: bytes.length, available: true });
  return {
    content: [
      { type: "text", text: JSON.stringify(metadata) },
      {
        type: "resource",
        resource: { uri: `travelplan://trips/${tripId}/files/${file.id}`, mimeType, blob: bytes.toString("base64") },
      },
    ],
    structuredContent: metadata,
  };
};

// ---------------------------------------------------------------------------------------------------------
// attach_file

/** The bytes from the inline content or the URL, or the refusal text. Nothing is written either way. */
const obtainBytes = async (args: AttachArgs, media: "document" | "image"): Promise<{ bytes: Buffer } | { refusal: string }> => {
  if (args.contentBase64 !== undefined) {
    if (!STRICT_BASE64.test(args.contentBase64)) return { refusal: NOT_BASE64 };
    const bytes = Buffer.from(args.contentBase64, "base64");
    if (bytes.length > MAX_INLINE_BYTES) {
      return { refusal: `The file is larger than ${MAX_INLINE_BYTES / MIB} MB; pass a url to download it instead.` };
    }
    return { bytes };
  }
  const maxBytes = media === "image" ? MAX_URL_IMAGE_BYTES : MAX_URL_DOCUMENT_BYTES;
  const result = await fileToolDeps.fetch(args.url!, {
    maxBytes,
    timeoutMs: DOWNLOAD_TIMEOUT_MS,
    maxRedirects: MAX_DOWNLOAD_REDIRECTS,
  });
  if (!result.ok) return { refusal: fetchFailureText(result.reason, maxBytes) };
  if (result.status < 200 || result.status > 299) return { refusal: `The download failed (HTTP ${result.status}).` };
  return { bytes: Buffer.from(result.body.buffer, result.body.byteOffset, result.body.byteLength) };
};

/**
 * Where the app's upload route for this entry writes, and the URL form it stores: an activity on a day
 * (`days/<d>/day-plan-items/<i>`), a parked one (`parked/day-plan-items/<i>`), or a stay
 * (`days/<d>/accommodations/<a>`), with `documents/` below for a document.
 */
const placementOf = (params: {
  tripId: string;
  target: "activity" | "stay";
  media: "document" | "image";
  parentId: string;
  tripDayId: string | null;
}) => {
  const { tripId, target, media, parentId, tripDayId } = params;
  const documents = media === "document" ? "/documents" : "";
  if (target === "stay") {
    const dayId = tripDayId!;
    return {
      dir:
        media === "document"
          ? getAccommodationDocumentUploadDir(tripId, dayId, parentId)
          : getAccommodationImageUploadDir(tripId, dayId, parentId),
      urlPrefix: `/uploads/trips/${tripId}/days/${dayId}/accommodations/${parentId}${documents}`,
    };
  }
  if (tripDayId === null) {
    return {
      dir:
        media === "document"
          ? getParkedDayPlanItemDocumentUploadDir(tripId, parentId)
          : getParkedDayPlanItemImageUploadDir(tripId, parentId),
      urlPrefix: `/uploads/trips/${tripId}/parked/day-plan-items/${parentId}${documents}`,
    };
  }
  return {
    dir:
      media === "document"
        ? getDayPlanItemDocumentUploadDir(tripId, tripDayId, parentId)
        : getDayPlanItemImageUploadDir(tripId, tripDayId, parentId),
    urlPrefix: `/uploads/trips/${tripId}/days/${tripDayId}/day-plan-items/${parentId}${documents}`,
  };
};

const fileWriteErrorResult = (error: unknown, changed: string): CallToolResult => {
  if (error instanceof ChangedSinceReadError) return toolError(changed);
  if (error instanceof UnstorableReceiptError) return toolError(UNSTORABLE_RECEIPT);
  return writeErrorResult(error);
};

// ---------------------------------------------------------------------------------------------------------
// Tools

export const registerFileTools = (server: McpServer) => {
  server.registerTool(
    "get_file",
    {
      title: "Read an attached file",
      description:
        "Returns one document or image attached to an activity or a stay, by the id get_day or get_bucket_list " +
        "gave it: its metadata (id, fileName, media document|image, target {type activity|stay, id}, mimeType " +
        "judged from the content, sizeBytes, updatedAt, aiChangedAt, available) and, up to 10 MB, the file " +
        "itself as an embedded resource. A larger file answers the metadata with a note; a file that is not on " +
        "the server answers available false and no content.",
      inputSchema: getInput,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    async (args, ctx) =>
      runTool({ name: "get_file", ctx, tripId: args.tripId }, async (userId) => {
        const gate = await requireWritableTrip(userId, args.tripId);
        if (gate !== true) return gate;
        const file = await findFileForPlanner({ userId, tripId: args.tripId, fileId: args.fileId });
        if (!file) return toolError(FILE_NOT_FOUND);
        return getFile(args.tripId, file);
      }),
  );

  server.registerTool(
    "attach_file",
    {
      title: "Attach a file",
      description:
        "Attaches a document (default) or an image to an activity (on a day or in the bucket list) or to a " +
        "stay. Give the bytes as contentBase64 (at most 1 MB decoded) or an https url to download (at most " +
        "10 MB for a document, 5 MB for an image; public addresses only, at most 3 redirects, 15 seconds). The " +
        "type is judged from the content alone: a document must be a PDF, JPEG, PNG or WebP, an image a JPEG, " +
        "PNG or WebP. An entry holds at most 10 documents; at most 20 uploads per hour. A document lands in " +
        "the day's document packet and day email like one uploaded in the app. Returns aiChangeId, the file " +
        "(id, fileName, media, mimeType, sizeBytes, updatedAt) and the day as get_day shows it when the entry " +
        "is on a day. The attach can be undone with undo_ai_change unless the entry is in the bucket list.",
      inputSchema: attachInput,
      annotations: WRITE_TOOL_ANNOTATIONS,
    },
    async (args, ctx) =>
      runTool({ name: "attach_file", ctx, tripId: args.tripId }, async (userId, { clientId }) => {
        const caller = await startWrite(userId, args.tripId, clientId);
        if (!isCaller(caller)) return caller;
        const media = args.as ?? "document";
        const parent = await findFileParentForPlanner({
          userId,
          tripId: args.tripId,
          target: args.target,
          parentId: args.id,
        });
        if (!parent) return toolError(args.target === "activity" ? ACTIVITY_NOT_FOUND : STAY_NOT_FOUND);
        // Only a document stores the name; an image is known by its disk name everywhere (get_day, the notice).
        const fileName = media === "document" ? sanitizeDocumentFileName(args.fileName) : null;
        if (media === "document" && !fileName) return toolError(FILE_NAME_UNUSABLE);
        if (media === "document" && parent.documentCount >= MAX_DOCUMENTS_PER_ENTRY) {
          return toolError(`${DOCUMENT_LIMIT_ERROR_MESSAGE}: an entry holds at most ${MAX_DOCUMENTS_PER_ENTRY} documents.`);
        }
        // Spent before the download: the bound exists for outbound fetches and disk writes.
        if (!checkRateLimit(`mcp-upload:${userId}`, UPLOAD_RATE_LIMIT, UPLOAD_RATE_WINDOW_MS).ok) {
          return toolError(UPLOAD_LIMIT);
        }

        const obtained = await obtainBytes(args, media);
        if ("refusal" in obtained) return toolError(obtained.refusal);
        const { bytes } = obtained;
        if (bytes.length === 0) return toolError(EMPTY_FILE);
        const mimeType = media === "document" ? sniffDocumentContentType(bytes) : sniffPhotoContentType(bytes);
        if (!mimeType) return toolError(media === "document" ? NOT_A_DOCUMENT : NOT_AN_IMAGE);

        const placement = placementOf({
          tripId: args.tripId,
          target: args.target,
          media,
          parentId: parent.id,
          tripDayId: parent.tripDayId,
        });
        const diskName = `${media === "document" ? "doc" : "img"}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${EXTENSIONS[mimeType]}`;
        const filePath = path.join(placement.dir, diskName);
        const url = `${placement.urlPrefix}/${diskName}`;
        const change = recordChange(caller, "fileAttached", parent.tripDayId, subjectOf(fileName ?? diskName), {
          requireReceipt: parent.tripDayId !== null,
        });
        let attached;
        try {
          await fs.mkdir(placement.dir, { recursive: true });
          await fs.writeFile(filePath, bytes);
          attached = await attachFileForConnector({
            userId,
            tripId: args.tripId,
            target: args.target,
            media,
            parentId: parent.id,
            expectedTripDayId: parent.tripDayId,
            url,
            fileName: fileName ?? diskName,
            inTransaction: change.hook,
          });
        } catch (error) {
          // No row names the file, so it goes now or never; a failed removal must not mask the refusal.
          await fs.rm(filePath, { force: true }).catch(() => undefined);
          return fileWriteErrorResult(error, PARENT_CHANGED);
        }
        if (attached.status === "limit_reached") {
          await fs.rm(filePath, { force: true }).catch(() => undefined);
          return toolError(`${DOCUMENT_LIMIT_ERROR_MESSAGE}: an entry holds at most ${MAX_DOCUMENTS_PER_ENTRY} documents.`);
        }

        return toolResult({
          aiChangeId: change.id(),
          file: {
            id: attached.file.id,
            fileName: fileName ?? diskName,
            media,
            mimeType,
            sizeBytes: bytes.length,
            updatedAt: attached.file.updatedAt.toISOString(),
          },
          ...(parent.tripDayId ? { day: await readDay(userId, args.tripId, parent.tripDayId) } : {}),
        });
      }),
  );

  server.registerTool(
    "delete_file",
    {
      title: "Delete an attached file",
      description:
        "Deletes one document or image of an activity or a stay, by the id get_day or get_bucket_list gave it. " +
        "Pass the file's updatedAt exactly as read: if it changed since, nothing is deleted. Returns aiChangeId, " +
        "deletedFileId and the day as get_day shows it when the entry is on a day. The delete can be undone " +
        "with undo_ai_change for 14 days, unless the entry is in the bucket list (then the file is gone at once).",
      inputSchema: deleteInput,
      annotations: DESTRUCTIVE_WRITE_TOOL_ANNOTATIONS,
    },
    async (args, ctx) =>
      runTool({ name: "delete_file", ctx, tripId: args.tripId }, async (userId, { clientId }) => {
        const caller = await startWrite(userId, args.tripId, clientId);
        if (!isCaller(caller)) return caller;
        const file = await findFileForPlanner({ userId, tripId: args.tripId, fileId: args.fileId });
        if (!file) return toolError(FILE_NOT_FOUND);
        const change = recordChange(caller, "fileDeleted", file.tripDayId, subjectOf(file.fileName), {
          requireReceipt: file.tripDayId !== null,
        });
        let deleted;
        try {
          deleted = await deleteFileForConnector({
            userId,
            tripId: args.tripId,
            target: file.target,
            media: file.media,
            fileId: file.id,
            expectedUpdatedAt: new Date(args.updatedAt),
            expectedTripDayId: file.tripDayId,
            inTransaction: change.hook,
          });
        } catch (error) {
          return fileWriteErrorResult(error, FILE_CHANGED);
        }

        // A parked activity's delete has no receipt and so no undo: its file goes now, after the commit, from
        // the activity's own folder, exactly as the app's delete route removes it.
        if (deleted.tripDayId === null) {
          const allowedDir =
            file.target === "activity"
              ? resolveManagedItemMediaDir({ storedUrl: deleted.url, tripId: args.tripId, itemId: deleted.parentId, kind: file.media })
              : null;
          if (allowedDir) {
            await removeManagedMediaFile({ storedUrl: deleted.url, allowedDir, context: "mcp delete_file" });
          } else if (!isExternalMediaUrl(deleted.url)) {
            console.error("mcp delete_file: stored media url names no folder of this activity", {
              tripId: args.tripId,
              fileId: file.id,
            });
          }
        }

        return toolResult({
          aiChangeId: change.id(),
          deletedFileId: file.id,
          ...(deleted.tripDayId ? { day: await readDay(userId, args.tripId, deleted.tripDayId) } : {}),
        });
      }),
  );
};
