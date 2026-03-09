import type { NextRequest } from "next/server";
import { apiError } from "@/lib/errors/apiError";
import { fail, ok } from "@/lib/http/response";
import { hasTripOwnerAccess } from "@/lib/auth/tripAccess";
import { CSRF_COOKIE_NAME, validateCsrf } from "@/lib/security/csrf";
import { createTripCollaboratorForOwner, listTripCollaboratorsForOwner } from "@/lib/repositories/tripRepo";
import { createTripMemberSchema } from "@/lib/validation/tripMemberSchemas";
import { requireSession } from "@/lib/auth/sessionGuard";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    id?: string;
  }>;
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
  if (!(await hasTripOwnerAccess(userId, tripId))) {
    return fail(apiError("not_found", "Trip not found"), 404);
  }

  try {
    const collaborators = await listTripCollaboratorsForOwner(userId, tripId);
    if (!collaborators) {
      return fail(apiError("not_found", "Trip not found"), 404);
    }

    return ok({ collaborators });
  } catch {
    return fail(apiError("server_error", "Unable to load collaborators"), 500);
  }
};

export const POST = async (request: NextRequest, context: RouteContext) => {
  const csrfCookie = request.cookies.get(CSRF_COOKIE_NAME)?.value;
  const csrfHeader = request.headers.get("x-csrf-token") ?? undefined;
  if (!validateCsrf(csrfCookie, csrfHeader)) {
    return fail(apiError("csrf_invalid", "Invalid CSRF token"), 403);
  }

  const auth = await requireSession(request);
  if (auth.response) {
    return auth.response;
  }
  const userId = auth.session.sub;

  const { id: tripId } = await context.params;
  if (!tripId) {
    return fail(apiError("not_found", "Trip not found"), 404);
  }
  if (!(await hasTripOwnerAccess(userId, tripId))) {
    return fail(apiError("not_found", "Trip not found"), 404);
  }

  let rawPayload: unknown;
  try {
    rawPayload = await request.json();
  } catch {
    return fail(apiError("invalid_json", "Request body must be valid JSON"), 400);
  }

  const parsed = createTripMemberSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return fail(apiError("validation_error", "Invalid collaborator details", parsed.error.flatten()), 400);
  }

  try {
    const result = await createTripCollaboratorForOwner({
      ownerUserId: userId,
      tripId,
      ...parsed.data,
    });

    if (result.outcome === "not_found") {
      return fail(apiError("not_found", "Trip not found"), 404);
    }

    if (result.outcome === "conflict") {
      if (result.reason === "existing_account") {
        return fail(
          apiError("trip_member_existing_account", "Existing accounts cannot be reprovisioned with a temporary password"),
          409,
        );
      }

      return fail(apiError("trip_member_exists", "Collaborator is already linked to this trip"), 409);
    }

    return ok({
      collaborator: result.collaborator,
      collaborators: result.collaborators,
    });
  } catch {
    return fail(apiError("server_error", "Unable to create collaborator"), 500);
  }
};
