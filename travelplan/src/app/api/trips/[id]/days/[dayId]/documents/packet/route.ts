import type { NextRequest } from "next/server";
import { apiError } from "@/lib/errors/apiError";
import { fail } from "@/lib/http/response";
import { hasTripReadAccess } from "@/lib/auth/tripAccess";
import { getRequestI18n } from "@/i18n/request";
import { getTripDayPrintPayloadForUser } from "@/lib/repositories/tripRepo";
import { requireSession } from "@/lib/auth/sessionGuard";
import { dayRouteParamsSchema } from "@/lib/validation/dayRouteSchemas";
import { buildDayPacket } from "@/lib/trips/dayPacket";
import { MAX_PACKET_DOCUMENTS } from "@/lib/trips/packetPdf";

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
 * **The build itself lives in `buildDayPacket` (`src/lib/trips/dayPacket.ts`)** - order, containment,
 * budgets and degradation logging - shared with the day email (Story 9.3), which attaches the same packet.
 * This route is the HTTP shape around it.
 *
 * The guard chain is `requireSession` → params → `hasTripReadAccess`, and the proxy's session gate
 * (`proxy.ts`) sits in front of all of it. Both layers are required; every sibling route does both.
 * Read access, not ownership: a viewer who can open the day can take its documents offline.
 *
 * **The packet speaks the language the request arrived in (DW-230).** It comes off the `lang` cookie, which
 * is the app's single runtime source of language and therefore the same value the day-menu item the user
 * just clicked was rendered with - the whole of DW-230's complaint was that a fully localised route led to
 * an English artefact. Read through `getRequestI18n` rather than `next/headers`, for the reason that
 * module's docblock gives - and in one call rather than two, so the language handed to the builder and the
 * dictionary behind `t` cannot drift apart. The error **codes** and `apiError` messages stay English:
 * the code is the contract and the client translates it.
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

    // Both halves come out of *one* call - see `buildDayPacket` for why that is the point (DW-230).
    const { language, t } = getRequestI18n(request);
    const packet = await buildDayPacket({
      tripId,
      dayId,
      payload,
      language,
      t,
      logPrefix: "documents packet GET",
    });

    if (packet.kind === "empty") {
      // Its own code, deliberately not `not_found`: the client maps that one to "trip not found"
      // (`TripTimeline.tsx`), and a traveller told the trip does not exist when the day simply has no
      // tickets goes looking in the wrong place.
      return fail(apiError("no_documents", "This day has no documents"), 404);
    }
    // Refused rather than truncated - see `buildDayPacket`.
    if (packet.kind === "tooMany") {
      return fail(
        apiError("too_many_documents", `This day has more than ${MAX_PACKET_DOCUMENTS} documents to package`),
        413,
      );
    }

    const { bytes, fileName } = packet;

    return new Response(bytes, {
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
    // failure inside `buildDayPacket` announces itself through `onDegraded`, and both containment refusals
    // log - so a bare 500 here would be the *only* silent failure in the route. It is also the branch a deployment
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
