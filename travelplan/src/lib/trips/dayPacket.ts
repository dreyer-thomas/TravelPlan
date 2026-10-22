import fs from "node:fs/promises";
import path from "node:path";
import { formatMessage, type Language } from "@/i18n";
import type { TripDayPrintPayload } from "@/lib/repositories/tripRepo";
import { MAX_PACKET_DOCUMENTS, buildDocumentPacket, type PacketDocument } from "@/lib/trips/packetPdf";
import { collectTimelineDocuments } from "@/lib/trips/printDocuments";
import { toSafeSlug } from "@/lib/trips/toSafeSlug";
import { getTripUploadDir, resolveStoredMediaPath } from "@/lib/trips/uploadPaths";

export type DayPacketResult =
  | { kind: "empty" }
  | { kind: "tooMany" }
  | { kind: "built"; bytes: Uint8Array<ArrayBuffer>; fileName: string };

/**
 * The day's documents merged into one offline PDF (Story 9.2, AC4-AC6) - the one build behind both the
 * packet download (`documents/packet/route.ts`) and the packet attached to the day email (Story 9.3).
 *
 * Extracted rather than copied because the containment below is security-critical: two copies of it are
 * two places to get it wrong, and a mail whose packet differed from the download in order, labels or
 * failure pages would be a second definition of "the day's documents".
 *
 * **The order is not decided here.** `getTripDayPrintPayloadForUser` already built the day's timeline and
 * `collectTimelineDocuments` flattens it - the same call the printed sheet makes - so the packet and the
 * sheet cannot disagree about which documents the day has or what order they are in.
 *
 * **Bytes come off disk, never over HTTP.** After Story 8.3 the media route authorises every read with the
 * session cookie, which a server-side fetch of the app's own URL does not have; it would 401 in production
 * and pass in test, which is the worst of both. `resolveStoredMediaPath` maps the stored URL back onto a
 * file and the containment layers below are what make that safe.
 *
 * `language` and `t` must come out of **one** `getRequestI18n` call (DW-230): the `language` handed to
 * `buildDocumentPacket` and the dictionary behind `t` are then the same resolution of the same cookie by
 * construction. Two independent lookups would agree today and have nothing but coincidence keeping them in
 * step - a packet whose label pages were German while its plan-item labels stayed English is exactly the
 * split DW-230 exists to close.
 *
 * The caller has already authorised the request. Per-document failures become label pages inside the
 * builder; what throws out of here is nobody's expected outcome (a containment escape, `MEDIA_STORAGE_ROOT`
 * unset) and the caller logs it.
 */
export const buildDayPacket = async ({
  tripId,
  dayId,
  payload,
  language,
  t,
  logPrefix,
}: {
  tripId: string;
  dayId: string;
  payload: TripDayPrintPayload;
  language: Language;
  t: (key: string) => string;
  /** Leads every log line, so the journal says which route was building the packet. */
  logPrefix: string;
}): Promise<DayPacketResult> => {
  // The same wording, from the same key, that the printed sheet gives a titleless activity's card - so a
  // loose label page in the packet and the card it belongs to name that activity identically, in
  // whichever language the packet is being built in.
  const planItemFallback = (position: number) => formatMessage(t("trips.dayPrint.planItemFallback"), { position });

  const documents = collectTimelineDocuments(payload.timeline, planItemFallback);
  if (documents.length === 0) {
    return { kind: "empty" };
  }
  // Story 9.1's cap is 10 documents *per entry* and nothing caps entries per day, so the day's total is
  // unbounded and each one is up to 10 MB held in memory. Refused rather than truncated: a packet that
  // silently contains some of the day's documents while calling itself the day's documents is the worse
  // outcome, and this is the one bound that has to be checked before any file is opened.
  if (documents.length > MAX_PACKET_DOCUMENTS) {
    return { kind: "tooMany" };
  }

  // Containment, mirroring `src/app/uploads/[...path]/route.ts` layer for layer - including *which* root
  // it contains against, which is this trip's own directory and not the uploads root. Authorisation
  // above is per-trip, so containment has to be per-trip too, or a hand-corrupted `documentUrl` naming
  // a sibling trip's file would be "contained" and still cross the boundary the access check drew.
  const tripRoot = path.resolve(getTripUploadDir(tripId));
  // The root is realpath'd as well as the file: on macOS `os.tmpdir()` is a symlink into `/private`,
  // which is exactly where the test suite's media root lives, so a realpath'd file compared against a
  // lexical root would reject perfectly valid paths.
  const tripRootReal = await fs.realpath(tripRoot).catch(() => tripRoot);

  const readDocument = async (document: PacketDocument) => {
    const requested = path.resolve(resolveStoredMediaPath(document.documentUrl));
    // Lexical containment. The trailing separator is what stops a sibling directory - `.../<id>-evil` -
    // from passing a bare `startsWith`.
    if (!requested.startsWith(`${tripRoot}${path.sep}`)) {
      console.error(`${logPrefix}: document path escaped the trip upload root`, {
        tripId,
        documentUrl: document.documentUrl,
      });
      throw new Error("Document path escaped the trip upload root");
    }
    // `fs.readFile` follows symlinks, so a link planted inside the trip's directory would pass the lexical
    // check above and hand back its target's bytes; `fs.realpath` is what resolves it first. This throws
    // `ENOENT` for a file that is simply gone, which is AC5's "missing file on disk" - the same
    // degradation, reached through the same catch.
    const real = await fs.realpath(requested);
    if (!real.startsWith(`${tripRootReal}${path.sep}`)) {
      console.error(`${logPrefix}: symlink target escaped the trip upload root`, {
        tripId,
        documentUrl: document.documentUrl,
      });
      throw new Error("Document symlink target escaped the trip upload root");
    }
    // Returned as the `Buffer` `readFile` produced rather than copied into a fresh array: the one place
    // that cares about the backing buffer's offset normalises it itself (`toOwnBuffer` in `packetPdf.ts`),
    // and a copy here would double peak memory for every document, against a budget the builder caps at
    // `MAX_PACKET_INPUT_BYTES`.
    return fs.readFile(real);
  };

  // Every per-document failure is handled *inside* the builder, as its own label page. Nothing a single
  // document can do reaches the caller's catch, which is what makes AC5's "200 with ten groups" true.
  const bytes = await buildDocumentPacket(documents, readDocument, {
    language,
    onDegraded: (document, error) => {
      // Without this every degradation is indistinguishable to an operator: a WebP document, an
      // encrypted ticket, an unlinked file and a genuine bug in `embedJpg` all produce the same page and
      // no signal. The user-visible outcome is unchanged - a label page, and the packet still builds.
      console.error(`${logPrefix}: document could not be included`, {
        tripId,
        dayId,
        documentUrl: document.documentUrl,
        reason: error instanceof Error ? error.message : String(error),
      });
    },
  });

  return {
    kind: "built",
    bytes,
    fileName: `${toSafeSlug(payload.trip.name)}-day-${payload.day.dayIndex}-documents.pdf`,
  };
};
