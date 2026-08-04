import type { NextRequest } from "next/server";
import { apiError } from "@/lib/errors/apiError";
import { fail, ok } from "@/lib/http/response";
import { requireAdmin } from "@/lib/auth/adminAccess";
import { deleteUserForAdmin, setUserAdminRoleForAdmin } from "@/lib/repositories/adminUserRepo";
import { updateAdminUserRoleSchema } from "@/lib/validation/adminUserSchemas";
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
 * Grants or revokes `ADMIN` on one account (Story 5.10, AC8a).
 *
 * The last-admin rule (AC8) is enforced in the repository, inside the transaction that does the write -
 * not by a disabled button. AC8's wording matters and is honoured literally: the refusal is for the
 * operation that would leave **zero** admins, not for demoting yourself. An admin may hand the role on and
 * then drop their own, and another admin may take it from them.
 */
export const PATCH = async (request: NextRequest, context: RouteContext) => {
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

  const parsed = updateAdminUserRoleSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return fail(apiError("validation_error", "Invalid role change", parsed.error.flatten()), 400);
  }

  try {
    const result = await setUserAdminRoleForAdmin({ userId, makeAdmin: parsed.data.isAdmin });

    if (result.outcome === "not_found") {
      return fail(apiError("not_found", "Account not found"), 404);
    }

    if (result.outcome === "last_admin") {
      // 409 rather than 403: the caller is permitted to perform this operation in general, and the
      // installation's state is what conflicts with this particular one.
      return fail(apiError("last_admin", "At least one administrator must remain"), 409);
    }

    return ok({ role: result.role });
  } catch (error) {
    console.error("admin/users PATCH: unable to change the role", error);
    return fail(apiError("server_error", "Unable to change the role"), 500);
  }
};

/**
 * Deletes an account - only one that owns nothing (AC7).
 *
 * Two refusals, in two places, because they are two different kinds of fact:
 *
 *   - **Owns trips** is a fact about the row, and lives in the repository inside the transaction that
 *     would otherwise delete it. `Trip.user` is `onDelete: Cascade` all the way down through days, plan
 *     items, images and payments, so this refusal is the whole of the protection between a click here and
 *     an entire travel history. It is server-side rather than a confirmation dialog because a dialog is
 *     advice and this has to be a rule.
 *   - **Deleting yourself** is a fact about the *caller*, which the repository has no business knowing, so
 *     it is checked here. AC8 refuses it outright - not subject to the admin count, and not offered with a
 *     warning.
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

  if (userId === auth.session.sub) {
    return fail(apiError("self_delete", "You cannot delete your own account here"), 409);
  }

  try {
    const result = await deleteUserForAdmin({ userId });

    if (result.outcome === "not_found") {
      return fail(apiError("not_found", "Account not found"), 404);
    }

    if (result.outcome === "owns_trips") {
      // The trip names travel in `details` so the client can name them in the message rather than saying
      // "this account owns trips" and leaving the admin to go and find out which.
      return fail(
        apiError("owns_trips", "Account owns trips and cannot be deleted", { tripNames: result.tripNames }),
        409,
      );
    }

    if (result.outcome === "last_admin") {
      return fail(apiError("last_admin", "At least one administrator must remain"), 409);
    }

    return ok({ deleted: true, email: result.email });
  } catch (error) {
    console.error("admin/users DELETE: unable to delete the account", error);
    return fail(apiError("server_error", "Unable to delete the account"), 500);
  }
};
