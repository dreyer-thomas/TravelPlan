import type { NextRequest } from "next/server";
import { apiError } from "@/lib/errors/apiError";
import { fail, ok } from "@/lib/http/response";
import { requireAdmin } from "@/lib/auth/adminAccess";
import { createUserForAdmin, listTripsForAdmin, listUsersForAdmin } from "@/lib/repositories/adminUserRepo";
import { createAdminUserSchema } from "@/lib/validation/adminUserSchemas";
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

/**
 * The administration list: every account, and what each can reach (Story 5.10, AC3).
 *
 * `requireAdmin` rather than `requireSession` + `hasAnyOwnedTrip`, and that substitution is the story
 * (AC1, Trap 2). The middleware does not cover `/api/admin/*` - it cannot decide `ADMIN` in the edge
 * runtime, where Prisma does not run and the token's role is a seven-day snapshot - so this route
 * self-guards and gets the live role.
 *
 * The trip list rides along in the same response. The attach action needs it, it is small, and a second
 * endpoint would double the request count on a page that is one list.
 *
 * No CSRF on the `GET`, matching `/api/users` and the members `GET`.
 *
 * `Cache-Control: no-store` because the body is every email address in the system plus the whole trip
 * graph. The client asks for `no-store` itself; a proxy or a curl that does not has no other instruction.
 */
export const GET = async (request: NextRequest) => {
  const auth = await requireAdmin(request);
  if (auth.response) {
    return auth.response;
  }

  try {
    const [users, trips] = await Promise.all([listUsersForAdmin(), listTripsForAdmin()]);
    return ok({ users, trips }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("admin/users GET: unable to load accounts", error);
    return fail(apiError("server_error", "Unable to load accounts"), 500);
  }
};

/**
 * Creates an account by email with a temporary password (AC4).
 *
 * CSRF before the session check, in that order, matching every other mutating route in this app.
 */
export const POST = async (request: NextRequest) => {
  const csrfCookie = request.cookies.get(CSRF_COOKIE_NAME)?.value;
  const csrfHeader = request.headers.get("x-csrf-token") ?? undefined;
  if (!validateCsrf(csrfCookie, csrfHeader)) {
    return fail(apiError("csrf_invalid", "Invalid CSRF token"), 403);
  }

  const auth = await requireAdmin(request);
  if (auth.response) {
    return auth.response;
  }

  let rawPayload: unknown;
  try {
    rawPayload = await request.json();
  } catch {
    return fail(apiError("invalid_json", "Request body must be valid JSON"), 400);
  }

  const parsed = createAdminUserSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return fail(apiError("validation_error", "Invalid account details", parsed.error.flatten()), 400);
  }

  try {
    const result = await createUserForAdmin(parsed.data);

    if (result.outcome === "email_exists") {
      // The same code registration returns for the same condition, so a client that already handles one
      // handles the other.
      return fail(apiError("email_exists", "An account already exists for this email"), 409);
    }

    return ok({ user: result.user });
  } catch (error) {
    console.error("admin/users POST: unable to create the account", error);
    return fail(apiError("server_error", "Unable to create the account"), 500);
  }
};
