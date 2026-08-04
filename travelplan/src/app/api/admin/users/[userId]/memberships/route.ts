import type { NextRequest } from "next/server";
import { apiError } from "@/lib/errors/apiError";
import { fail, ok } from "@/lib/http/response";
import { requireAdmin } from "@/lib/auth/adminAccess";
import { removeTripMembershipForAdmin, setTripMembershipForAdmin } from "@/lib/repositories/adminUserRepo";
import { removeAdminMembershipSchema, setAdminMembershipSchema } from "@/lib/validation/adminUserSchemas";
import { CSRF_COOKIE_NAME, validateCsrf } from "@/lib/security/csrf";

/**
 * Story 5.10 review decision: the swallowed exception is logged before the envelope goes out.
 *
 * The rest of this app's 32 route files catch and return without a word, and that is tolerable where a 500
 * means a list did not load. It is not tolerable here. These are the only routes that can grant an
 * administrator, revoke one, or delete an account and its memberships, and a bare `catch` on them means an
 * incident cannot be reconstructed afterwards - there is no record of what failed, only that something did.
 * This is the narrow half of the choice: no audit table, no new concepts, just the reason a 500 happened.
 */

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    userId?: string;
  }>;
};

/**
 * Attach a user to a trip, or change the role they hold on it (Story 5.10, AC5, AC6).
 *
 * These are the same three operations `POST` and `DELETE` on `/api/trips/[id]/members` perform, and the
 * story's instruction was that "the access predicate is what changes, not the logic". That is true of the
 * *authorisation*, which is `requireAdmin` here and `hasTripOwnerAccess` there. It could not be made true
 * of the queries, and the reason is worth recording rather than glossing:
 *
 *   - `createTripCollaboratorForOwner` and `deleteTripCollaboratorForOwner` carry `userId: ownerUserId`
 *     inside their `where` clauses, so the statement that finds the row is the statement that proves the
 *     caller owns it. An admin owns nothing by virtue of being an admin, so there is no value to pass -
 *     the tenancy is not a parameter to vary, it is a clause to not have.
 *   - The trip-share route has no role-change operation at all. It creates memberships and deletes them;
 *     AC5 needs a third thing.
 *   - It is also user-first rather than trip-first: this surface knows the account and picks the trip.
 *
 * So the operations are re-expressed against `TripMember` in `adminUserRepo`, without a tenancy clause and
 * with attach and change collapsed into one `upsert` on `@@unique([tripId, userId])`. The trip-share route
 * is untouched, and its owner path keeps the guard it always had.
 */
export const POST = async (request: NextRequest, context: RouteContext) => {
  const csrfCookie = request.cookies.get(CSRF_COOKIE_NAME)?.value;
  const csrfHeader = request.headers.get("x-csrf-token") ?? undefined;
  if (!validateCsrf(csrfCookie, csrfHeader)) {
    return fail(apiError("csrf_invalid", "Invalid CSRF token"), 403);
  }

  const auth = await requireAdmin(request);
  if (auth.response) {
    return auth.response;
  }

  const { userId } = await context.params;
  if (!userId) {
    return fail(apiError("not_found", "Account not found"), 404);
  }

  let rawPayload: unknown;
  try {
    rawPayload = await request.json();
  } catch {
    return fail(apiError("invalid_json", "Request body must be valid JSON"), 400);
  }

  const parsed = setAdminMembershipSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return fail(apiError("validation_error", "Invalid membership details", parsed.error.flatten()), 400);
  }

  try {
    const result = await setTripMembershipForAdmin({
      userId,
      tripId: parsed.data.tripId,
      role: parsed.data.role,
    });

    // Two distinct 404 codes rather than one: the admin picked both the account and the trip, and "which
    // of the two is gone" is the difference between reloading the list and picking another trip.
    if (result.outcome === "user_not_found") {
      return fail(apiError("not_found", "Account not found"), 404);
    }

    if (result.outcome === "trip_not_found") {
      return fail(apiError("trip_not_found", "Trip not found"), 404);
    }

    if (result.outcome === "owns_trip") {
      return fail(apiError("trip_owner", "This account already owns the trip"), 409);
    }

    return ok({ membership: result.membership });
  } catch (error) {
    console.error("admin/memberships POST: unable to update the membership", error);
    return fail(apiError("server_error", "Unable to update the membership"), 500);
  }
};

/**
 * Detaches a user from one trip (AC6).
 *
 * Removes the `TripMember` row and nothing else - it cannot reach `Trip.userId`, so a trip the user *owns*
 * is out of range by construction rather than by promise. Deleting the account is a different operation on
 * a different route, and the one that has to refuse (AC7).
 *
 * The trip id travels in the body rather than the path so that this route's `DELETE` matches its `POST`,
 * and matches `DELETE /api/trips/[id]/members`, which also takes its target from the body.
 */
export const DELETE = async (request: NextRequest, context: RouteContext) => {
  const csrfCookie = request.cookies.get(CSRF_COOKIE_NAME)?.value;
  const csrfHeader = request.headers.get("x-csrf-token") ?? undefined;
  if (!validateCsrf(csrfCookie, csrfHeader)) {
    return fail(apiError("csrf_invalid", "Invalid CSRF token"), 403);
  }

  const auth = await requireAdmin(request);
  if (auth.response) {
    return auth.response;
  }

  const { userId } = await context.params;
  if (!userId) {
    return fail(apiError("not_found", "Account not found"), 404);
  }

  let rawPayload: unknown;
  try {
    rawPayload = await request.json();
  } catch {
    return fail(apiError("invalid_json", "Request body must be valid JSON"), 400);
  }

  const parsed = removeAdminMembershipSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return fail(apiError("validation_error", "Invalid membership details", parsed.error.flatten()), 400);
  }

  try {
    const result = await removeTripMembershipForAdmin({ userId, tripId: parsed.data.tripId });

    if (result.outcome === "missing") {
      return fail(apiError("not_found", "Membership not found"), 404);
    }

    return ok({ removed: true });
  } catch (error) {
    console.error("admin/memberships DELETE: unable to remove the membership", error);
    return fail(apiError("server_error", "Unable to remove the membership"), 500);
  }
};
