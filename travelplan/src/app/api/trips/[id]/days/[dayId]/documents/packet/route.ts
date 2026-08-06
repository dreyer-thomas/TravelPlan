import fs from "node:fs/promises";
import path from "node:path";
import type { NextRequest } from "next/server";
import { apiError } from "@/lib/errors/apiError";
import { fail } from "@/lib/http/response";
import { hasTripReadAccess } from "@/lib/auth/tripAccess";
import { getTripDayPrintPayloadForUser } from "@/lib/repositories/tripRepo";
import { requireSession } from "@/lib/auth/sessionGuard";
import { dayRouteParamsSchema } from "@/lib/validation/dayRouteSchemas";
import { MAX_PACKET_DOCUMENTS, buildDocumentPacket, type PacketDocument } from "@/lib/trips/packetPdf";
import { collectTimelineDocuments } from "@/lib/trips/printDocuments";
import { toSafeSlug } from "@/lib/trips/toSafeSlug";
import { getTripUploadDir, resolveStoredMediaPath } from "@/lib/trips/uploadPaths";

// `node:fs` for the document bytes and `pdf-lib` for the merge; neither runs on the edge.
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    id?: string;
    dayId?: string;
  }>;
};

/**
 * `GET /api/trips/[id]/days/[dayId]/documents/packet` - the day's documents merged into one offline PDF
 * (Story 9.2, AC4-AC6).
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
 * The guard chain is `requireSession` → params → `hasTripReadAccess`, and the middleware's session gate
 * (`middleware.ts`) sits in front of all of it. Both layers are required; every sibling route does both.
 * Read access, not ownership: a viewer who can open the day can take its documents offline.
 */
export const GET = async (request: NextRequest, context: RouteContext) => {
  const auth = await requireSession(request);
  if (auth.response) {
    return auth.response;
  }
  const userId = auth.session.sub;

  const parsedParams = dayRouteParamsSchema.safeParse(await context.params);
  if (!parsedParams.success) {
    return fail(apiError("validation_error", "Invalid route parameters", parsedParams.error.flatten()), 400);
  }
  const { id: tripId, dayId } = parsedParams.data;

  // 404 and not 403, this repo's settled convention: distinguishing "exists but hidden" from "does not
  // exist" leaks which trips exist.
  if (!(await hasTripReadAccess(userId, tripId))) {
    return fail(apiError("not_found", "Trip day not found"), 404);
  }

  try {
    const payload = await getTripDayPrintPayloadForUser({ userId, tripId, dayId });
    if (!payload) {
      return fail(apiError("not_found", "Trip day not found"), 404);
    }

    const documents = collectTimelineDocuments(payload.timeline);
    if (documents.length === 0) {
      // Its own code, deliberately not `not_found`: the client maps that one to "trip not found"
      // (`TripTimeline.tsx`), and a traveller told the trip does not exist when the day simply has no
      // tickets goes looking in the wrong place.
      return fail(apiError("no_documents", "This day has no documents"), 404);
    }
    // Story 9.1's cap is 10 documents *per entry* and nothing caps entries per day, so the day's total is
    // unbounded and each one is up to 10 MB held in memory. Refused rather than truncated: a packet that
    // silently contains some of the day's documents while calling itself the day's documents is the worse
    // outcome, and this is the one bound that has to be checked before any file is opened.
    if (documents.length > MAX_PACKET_DOCUMENTS) {
      return fail(
        apiError("too_many_documents", `This day has more than ${MAX_PACKET_DOCUMENTS} documents to package`),
        413,
      );
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
        console.error("documents packet GET: document path escaped the trip upload root", {
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
        console.error("documents packet GET: symlink target escaped the trip upload root", {
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
    // document can do reaches this function's catch, which is what makes AC5's "200 with ten groups" true.
    const packet = await buildDocumentPacket(documents, readDocument, {
      onDegraded: (document, error) => {
        // Without this every degradation is indistinguishable to an operator: a WebP document, an
        // encrypted ticket, an unlinked file and a genuine bug in `embedJpg` all produce the same page and
        // no signal. The user-visible outcome is unchanged - a label page, and the packet stays 200.
        console.error("documents packet GET: document could not be included", {
          tripId,
          dayId,
          documentUrl: document.documentUrl,
          reason: error instanceof Error ? error.message : String(error),
        });
      },
    });

    const fileName = `${toSafeSlug(payload.trip.name)}-day-${payload.day.dayIndex}-documents.pdf`;

    return new Response(packet, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${fileName}"`,
        // Tickets carry names, addresses and booking codes; nothing about this response should be held by
        // an intermediary. The print route sets the same header for the same reason.
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    // Logged, because this is the one branch that is nobody's expected outcome. Every per-document
    // failure above announces itself through `onDegraded`, and both containment refusals log - so a bare
    // 500 here would be the *only* silent failure in the route. It is also the branch a deployment
    // mistake lands in: `getMediaRoot()` throws when `MEDIA_STORAGE_ROOT` is unset, which would turn
    // every packet request into "please try again" with nothing anywhere to connect it to the variable.
    console.error("documents packet GET: unable to build the document packet", {
      tripId,
      dayId,
      reason: error instanceof Error ? error.message : String(error),
    });
    return fail(apiError("server_error", "Unable to build the document packet"), 500);
  }
};
