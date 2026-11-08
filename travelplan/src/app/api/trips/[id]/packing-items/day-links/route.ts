import type { NextRequest } from "next/server";
import { apiError } from "@/lib/errors/apiError";
import { fail, ok } from "@/lib/http/response";
import {
  addPackingItemToDay,
  linkPackingItemToDay,
  unlinkPackingItemFromDay,
} from "@/lib/repositories/packingListRepo";
import { packingDayLinkCreateSchema, packingDayLinkDeleteSchema } from "@/lib/validation/packingListSchemas";
import { authorizeWrite, type RouteContext, toWire } from "../shared";

/**
 * Story 16.2 (FR59). What a day needs: links between the trip's packing items and its days.
 *
 * `POST { tripDayId, itemId }` links an item; `POST { tripDayId, name, category? }` links the trip's item
 * of that name (ignoring case) or creates it unpacked first - so the server, not a possibly stale client
 * list, decides that a typed name already exists. `DELETE { tripDayId, itemId }` removes only the link.
 * Both are writes: writer gate here (viewer 403, outsider 404) plus the repository's writer clause. A day
 * or item of another trip is a 404 and writes nothing.
 */

const tripNotFound = () => fail(apiError("not_found", "Trip not found"), 404);
const dayNotFound = () => fail(apiError("not_found", "Trip day not found"), 404);
const itemNotFound = () => fail(apiError("not_found", "Packing item not found"), 404);

export const POST = async (request: NextRequest, context: RouteContext) => {
  const gate = await authorizeWrite(request, context);
  if (gate.response) {
    return gate.response;
  }
  const { userId, tripId, rawPayload } = gate;

  const parsed = packingDayLinkCreateSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return fail(apiError("validation_error", "Invalid packing day link", parsed.error.flatten()), 400);
  }

  try {
    if ("itemId" in parsed.data) {
      const result = await linkPackingItemToDay({
        userId,
        tripId,
        tripDayId: parsed.data.tripDayId,
        itemId: parsed.data.itemId,
        origin: "user",
      });
      if (result.status === "not_found") return tripNotFound();
      if (result.status === "day_missing") return dayNotFound();
      if (result.status === "missing") return itemNotFound();
      return ok({ item: toWire(result.item), created: false });
    }

    const result = await addPackingItemToDay({
      userId,
      tripId,
      tripDayId: parsed.data.tripDayId,
      name: parsed.data.name,
      category: parsed.data.category ?? null,
      origin: "user",
    });
    if (result.status === "not_found") return tripNotFound();
    if (result.status === "day_missing") return dayNotFound();
    return ok({ item: toWire(result.item), created: result.status === "created" });
  } catch {
    return fail(apiError("server_error", "Unable to add packing item to the day"), 500);
  }
};

export const DELETE = async (request: NextRequest, context: RouteContext) => {
  const gate = await authorizeWrite(request, context);
  if (gate.response) {
    return gate.response;
  }
  const { userId, tripId, rawPayload } = gate;

  const parsed = packingDayLinkDeleteSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return fail(apiError("validation_error", "Invalid packing day link", parsed.error.flatten()), 400);
  }

  try {
    const result = await unlinkPackingItemFromDay({
      userId,
      tripId,
      tripDayId: parsed.data.tripDayId,
      itemId: parsed.data.itemId,
      origin: "user",
    });
    if (result.status === "not_found") return tripNotFound();
    if (result.status === "day_missing") return dayNotFound();
    if (result.status === "missing") return itemNotFound();
    return ok({ item: toWire(result.item) });
  } catch {
    return fail(apiError("server_error", "Unable to remove packing item from the day"), 500);
  }
};
