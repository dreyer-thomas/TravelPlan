import type { NextRequest } from "next/server";
import { apiError } from "@/lib/errors/apiError";
import { fail, ok } from "@/lib/http/response";
import { refuseUnlessTripWriter } from "@/lib/auth/tripAccess";
import { CSRF_COOKIE_NAME, validateCsrf } from "@/lib/security/csrf";
import {
  createPackingItem,
  deletePackingItem,
  listPackingItemsForTrip,
  type PackingItemDetail,
  updatePackingItem,
} from "@/lib/repositories/packingListRepo";
import {
  packingItemCreateSchema,
  packingItemDeleteSchema,
  packingItemUpdateSchema,
} from "@/lib/validation/packingListSchemas";
import { requireSession } from "@/lib/auth/sessionGuard";

/**
 * Story 16.1 (FR58). The trip's packing list, modelled on `bucket-list-items` with one deliberate
 * difference: `GET` is a **read** gate (the repository's participant clause + `deriveTripAccessRole`,
 * every participant, viewers included),
 * because the packing list is not hidden from viewers. Writes keep the writer gate
 * (`refuseUnlessTripWriter`: viewer 403, outsider 404) plus the repository's writer clause.
 *
 * `POST` answers 200 whether it created the item or found it already on the list (`existed`); a rename
 * onto another item's name is a 409 `duplicate_name`.
 */

type RouteContext = {
  params: Promise<{
    id?: string;
  }>;
};

const requireCsrf = (request: NextRequest) => {
  const csrfCookie = request.cookies.get(CSRF_COOKIE_NAME)?.value;
  const csrfHeader = request.headers.get("x-csrf-token") ?? undefined;
  return validateCsrf(csrfCookie, csrfHeader);
};

const parseJson = async (request: NextRequest) => {
  try {
    return await request.json();
  } catch {
    return null;
  }
};

const toWire = (item: PackingItemDetail) => ({
  ...item,
  createdAt: item.createdAt.toISOString(),
  updatedAt: item.updatedAt.toISOString(),
  aiChangedAt: item.aiChangedAt?.toISOString() ?? null,
});

/** Session, trip id and the writer gate, shared by the three writes. */
type WriteGate = { response: Response } | { response?: undefined; userId: string; tripId: string; rawPayload: unknown };

const authorizeWrite = async (request: NextRequest, context: RouteContext): Promise<WriteGate> => {
  if (!requireCsrf(request)) {
    return { response: fail(apiError("csrf_invalid", "Invalid CSRF token"), 403) };
  }

  const auth = await requireSession(request);
  if (auth.response) {
    return { response: auth.response };
  }
  const userId = auth.session.sub;

  const { id: tripId } = await context.params;
  if (!tripId) {
    return { response: fail(apiError("not_found", "Trip not found"), 404) };
  }
  const refusal = await refuseUnlessTripWriter(userId, tripId, "Trip not found");
  if (refusal) {
    return { response: refusal };
  }

  const rawPayload = await parseJson(request);
  if (!rawPayload) {
    return { response: fail(apiError("invalid_json", "Request body must be valid JSON"), 400) };
  }

  return { userId, tripId, rawPayload: rawPayload as unknown };
};

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
      origin: "user",
    });

    if (result.status === "not_found") {
      return fail(apiError("not_found", "Trip not found"), 404);
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
    const result = await deletePackingItem({ userId, tripId, itemId: parsed.data.itemId });

    if (result.status === "not_found") {
      return fail(apiError("not_found", "Trip not found"), 404);
    }
    if (result.status === "missing") {
      return fail(apiError("not_found", "Packing item not found"), 404);
    }

    return ok({ deleted: true });
  } catch {
    return fail(apiError("server_error", "Unable to delete packing item"), 500);
  }
};
