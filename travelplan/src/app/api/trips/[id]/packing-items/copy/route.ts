import type { NextRequest } from "next/server";
import { apiError } from "@/lib/errors/apiError";
import { fail, ok } from "@/lib/http/response";
import { refuseUnlessTripWriter } from "@/lib/auth/tripAccess";
import { requireSession } from "@/lib/auth/sessionGuard";
import { copyPackingItemsFromTrip, listPackingCopySources } from "@/lib/repositories/packingListRepo";
import { packingCopySchema } from "@/lib/validation/packingListSchemas";
import { authorizeWrite, type RouteContext, toWire } from "../shared";

/**
 * Story 16.5 (FR60). Copy items from another trip's packing list onto this one.
 *
 * `GET` lists the trips to copy from: every other trip the person can see (any role) that has packing
 * items, newest first. `POST { sourceTripId, itemIds }` copies the chosen items - unpacked, needed, without
 * day links, names already on this trip skipped and left untouched - and answers `{ added, existed, items }`.
 *
 * Two gates: this trip needs a writer for both (`refuseUnlessTripWriter`: viewer 403, outsider 404, plus the
 * repository's writer clause); the source trip only needs a participant, viewers included. A source the
 * person cannot see, a missing one or this trip itself is a 404 `source_not_found` and writes nothing.
 */

const tripNotFound = () => fail(apiError("not_found", "Trip not found"), 404);

export const GET = async (request: NextRequest, context: RouteContext) => {
  const auth = await requireSession(request);
  if (auth.response) {
    return auth.response;
  }
  const userId = auth.session.sub;

  const { id: tripId } = await context.params;
  if (!tripId) {
    return tripNotFound();
  }
  const refusal = await refuseUnlessTripWriter(userId, tripId, "Trip not found");
  if (refusal) {
    return refusal;
  }

  try {
    const trips = await listPackingCopySources({ userId, tripId });
    if (!trips) {
      return tripNotFound();
    }
    return ok({
      trips: trips.map((trip) => ({
        id: trip.id,
        name: trip.name,
        startDate: trip.startDate.toISOString(),
        endDate: trip.endDate.toISOString(),
        itemCount: trip.itemCount,
      })),
    });
  } catch {
    return fail(apiError("server_error", "Unable to load trips"), 500);
  }
};

export const POST = async (request: NextRequest, context: RouteContext) => {
  const gate = await authorizeWrite(request, context);
  if (gate.response) {
    return gate.response;
  }
  const { userId, tripId, rawPayload } = gate;

  const parsed = packingCopySchema.safeParse(rawPayload);
  if (!parsed.success) {
    return fail(apiError("validation_error", "Invalid packing copy", parsed.error.flatten()), 400);
  }

  try {
    const result = await copyPackingItemsFromTrip({
      userId,
      tripId,
      sourceTripId: parsed.data.sourceTripId,
      itemIds: parsed.data.itemIds,
    });
    if (result.status === "not_found") return tripNotFound();
    if (result.status === "source_not_found") {
      return fail(apiError("source_not_found", "Source trip not found"), 404);
    }
    return ok({ added: result.added, existed: result.existed, items: result.items.map(toWire) });
  } catch {
    return fail(apiError("server_error", "Unable to copy packing items"), 500);
  }
};
