import type { NextRequest } from "next/server";
import { apiError } from "@/lib/errors/apiError";
import { fail, ok } from "@/lib/http/response";
import { hasAnyOwnedTrip } from "@/lib/auth/tripAccess";
import { listRegisteredUsers } from "@/lib/repositories/userRepo";
import { requireSession } from "@/lib/auth/sessionGuard";

export const runtime = "nodejs";

/**
 * The system-wide account list, for trip owners deciding who to invite.
 *
 * Two guards, both of which have to live here. `requireSession` because the middleware matcher is
 * `/api/trips`-scoped and does not cover this path, so nothing upstream produces the `unauthorized`
 * 401 or the `password_change_required` 403. `hasAnyOwnedTrip` because this is the only read in the
 * app that leaves the caller's own trip graph - a signed-in account with no trip of its own, and a
 * viewer or contributor on somebody else's trip, both get `forbidden` rather than a thinner list.
 *
 * `forbidden` is deliberately not `not_found`: the UI has to tell "you may not see this" apart from
 * the session failures above, and a 404 would collapse them into one message.
 *
 * No CSRF check - read-only `GET`, same as the members `GET`.
 *
 * `Cache-Control: no-store` because the body is every email address in the system: the client asks
 * for the same thing with `cache: "no-store"`, but a caller that does not - a proxy, curl, a future
 * server-side reader - has no other instruction. Same treatment the print and CSRF routes give their
 * responses.
 */
export const GET = async (request: NextRequest) => {
  const auth = await requireSession(request);
  if (auth.response) {
    return auth.response;
  }

  try {
    // The ownership check is inside the `try` as well: it is a Prisma call, and a rejection from it
    // would escape the `{ data, error }` envelope as a framework 500 the clients cannot read.
    if (!(await hasAnyOwnedTrip(auth.session.sub))) {
      return fail(apiError("forbidden", "Trip ownership required"), 403);
    }

    const users = await listRegisteredUsers();
    return ok({ users }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return fail(apiError("server_error", "Unable to load registered users"), 500);
  }
};
