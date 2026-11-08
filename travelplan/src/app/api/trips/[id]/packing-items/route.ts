import type { NextRequest } from "next/server";
import { apiError } from "@/lib/errors/apiError";
import { fail, ok } from "@/lib/http/response";
import {
  createPackingItem,
  deletePackingItem,
  listPackingItemsForTrip,
  updatePackingItem,
} from "@/lib/repositories/packingListRepo";
import {
  packingItemCreateSchema,
  packingItemDeleteSchema,
  packingItemUpdateSchema,
} from "@/lib/validation/packingListSchemas";
import { requireSession } from "@/lib/auth/sessionGuard";
import { authorizeWrite, type RouteContext, toWire } from "./shared";

/**
 * Story 16.1 (FR58). The trip's packing list, modelled on `bucket-list-items` with one deliberate
 * difference: `GET` is a **read** gate (the repository's participant clause + `deriveTripAccessRole`,
 * every participant, viewers included),
 * because the packing list is not hidden from viewers. Writes keep the writer gate
 * (`refuseUnlessTripWriter`: viewer 403, outsider 404) plus the repository's writer clause.
 *
 * `POST` answers 200 whether it created the item or found it already on the list (`existed`); a rename
 * onto another item's name is a 409 `duplicate_name`.
 *
 * Story 16.2: `DELETE` takes the day count the person confirmed; when the item's links changed since,
 * it answers 409 `days_changed` with the current count and deletes nothing (DW-432).
 *
 * Story 16.7: `PATCH { notNeeded: true, confirmedDayCount }` marks the item not needed this time (unticked,
 * removed from its days); a changed day count is the same 409 `days_changed`. `notNeeded: false` marks it
 * needed again. Ticking an item that is not needed is a 409 `not_needed`.
 *
 * Story 16.8: `POST` and `PATCH` take `tags`. On `POST` they go on a new item, or are added to the existing
 * one (D3); a merge past 10 tags is a 409 `too_many_tags` and writes nothing. On `PATCH` they replace the
 * item's tags.
 */

export const GET = async (request: NextRequest, context: RouteContext) => {
  const auth = await requireSession(request);
  if (auth.response) {
    return auth.response;
  }
  const userId = auth.session.sub;

  const { id: tripId } = await context.params;
  if (!tripId) {
    return fail(apiError("not_found", "Trip not found"), 404);
  }

  try {
    // The repository's read clause is the gate: owner or any member; `null` for everyone else.
    const list = await listPackingItemsForTrip({ userId, tripId });
    if (!list) {
      return fail(apiError("not_found", "Trip not found"), 404);
    }

    return ok({ accessRole: list.accessRole, items: list.items.map(toWire) });
  } catch {
    return fail(apiError("server_error", "Unable to load packing list"), 500);
  }
};

export const POST = async (request: NextRequest, context: RouteContext) => {
  const gate = await authorizeWrite(request, context);
  if (gate.response) {
    return gate.response;
  }
  const { userId, tripId, rawPayload } = gate;

  const parsed = packingItemCreateSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return fail(apiError("validation_error", "Invalid packing item", parsed.error.flatten()), 400);
  }

  try {
    const result = await createPackingItem({
      userId,
      tripId,
      name: parsed.data.name,
      category: parsed.data.category ?? null,
      tags: parsed.data.tags,
      origin: "user",
    });

    if (result.status === "not_found") {
      return fail(apiError("not_found", "Trip not found"), 404);
    }
    if (result.status === "too_many_tags") {
      return fail(apiError("too_many_tags", "Packing item would carry more than 10 tags"), 409);
    }

    return ok({ item: toWire(result.item), existed: result.status === "existed" });
  } catch {
    return fail(apiError("server_error", "Unable to save packing item"), 500);
  }
};

export const PATCH = async (request: NextRequest, context: RouteContext) => {
  const gate = await authorizeWrite(request, context);
  if (gate.response) {
    return gate.response;
  }
  const { userId, tripId, rawPayload } = gate;

  const parsed = packingItemUpdateSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return fail(apiError("validation_error", "Invalid packing item", parsed.error.flatten()), 400);
  }

  try {
    const result = await updatePackingItem({
      userId,
      tripId,
      itemId: parsed.data.itemId,
      name: parsed.data.name,
      category: parsed.data.category,
      packed: parsed.data.packed,
      notNeeded: parsed.data.notNeeded,
      tags: parsed.data.tags,
      confirmedDayCount: parsed.data.confirmedDayCount,
      origin: "user",
    });

    if (result.status === "not_found") {
      return fail(apiError("not_found", "Trip not found"), 404);
    }
    if (result.status === "missing") {
      return fail(apiError("not_found", "Packing item not found"), 404);
    }
    if (result.status === "duplicate_name") {
      return fail(apiError("duplicate_name", "A packing item with this name already exists"), 409);
    }
    if (result.status === "days_changed") {
      return fail(apiError("days_changed", "Packing item day links changed", { dayCount: result.dayCount }), 409);
    }
    if (result.status === "not_needed") {
      return fail(apiError("not_needed", "Packing item is marked not needed"), 409);
    }

    return ok({ item: toWire(result.item) });
  } catch {
    return fail(apiError("server_error", "Unable to update packing item"), 500);
  }
};

export const DELETE = async (request: NextRequest, context: RouteContext) => {
  const gate = await authorizeWrite(request, context);
  if (gate.response) {
    return gate.response;
  }
  const { userId, tripId, rawPayload } = gate;

  const parsed = packingItemDeleteSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return fail(apiError("validation_error", "Invalid packing item", parsed.error.flatten()), 400);
  }

  try {
    const result = await deletePackingItem({
      userId,
      tripId,
      itemId: parsed.data.itemId,
      confirmedDayCount: parsed.data.confirmedDayCount,
    });

    if (result.status === "not_found") {
      return fail(apiError("not_found", "Trip not found"), 404);
    }
    if (result.status === "missing") {
      return fail(apiError("not_found", "Packing item not found"), 404);
    }
    if (result.status === "days_changed") {
      return fail(apiError("days_changed", "Packing item day links changed", { dayCount: result.dayCount }), 409);
    }

    return ok({ deleted: true });
  } catch {
    return fail(apiError("server_error", "Unable to delete packing item"), 500);
  }
};
