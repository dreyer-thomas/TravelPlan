import type { NextRequest } from "next/server";
import { apiError } from "@/lib/errors/apiError";
import { fail } from "@/lib/http/response";
import { prisma } from "@/lib/db/prisma";
import { requireSession } from "@/lib/auth/sessionGuard";

/**
 * The one predicate that decides who reaches the administration surface, used by the API routes and the
 * header menu alike (Story 5.10, AC1).
 *
 * **It is deliberately not `hasAnyOwnedTrip`.** That helper lives one file over in `tripAccess.ts`, it
 * compiles here, and it answers a different question: `register/route.ts` gives every self-registration
 * `role: "OWNER"`, so "owns at least one trip" is satisfied by essentially every account in the system.
 * Story 5.8 used it to approximate an administrator for a read-only list, where the cost of being wrong
 * was a wider audience for a list of email addresses. This surface deletes accounts, and the account
 * deletion cascades a user's entire travel history, so the gate has to be a real role rather than a
 * population that happens to be small today.
 *
 * Note that `ADMIN` is the first `UserRole` value in this app that decides anything at all. `OWNER` and
 * `VIEWER` are written and carried in the session JWT but nothing branches on either of them - trip-level
 * permission comes from `Trip.userId` and `TripMember.role`, which are different relations entirely (see
 * the note on the enum in `schema.prisma` about the two words spelled "owner").
 */
export const isAdminUser = async (userId: string) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });

  // A missing row is not an error here. A session JWT is valid for seven days and nothing revokes it when
  // an admin deletes an account, so "the caller no longer exists" is a reachable state and its answer is
  // simply "not an admin".
  return user?.role === "ADMIN";
};

/**
 * `requireSession` plus the admin role, in the shape the routes already destructure - `{ response, session }`,
 * where a non-null `response` is the refusal to return unchanged.
 *
 * **The role is re-read from the database on every request, and never taken from the token.** This is the
 * answer to the story's Trap 6 rather than an acceptance of it: `createSessionJwt({ sub, role })` bakes the
 * role in for seven days, so a token is a snapshot of what the account was at sign-in. Taking `sub` from
 * the token and the role from the database costs one indexed primary-key lookup per request and buys two
 * properties this surface needs:
 *
 *   - a promotion (`admin:grant`, or the grant action here) takes effect at once, so the operator does not
 *     have to work out that they must sign out and back in; and
 *   - more importantly, a **revocation** takes effect at once. If the role came from the token, an admin
 *     whose role had just been taken away would keep full access - including account deletion - for up to
 *     a week, and AC8's "another admin may take it from them" would be advice rather than a rule.
 *
 * The token's own `role` claim is therefore now purely informational. Nothing authorises on it.
 *
 * `forbidden` rather than `not_found`, following 5.8's reasoning: the client has to tell "you may not see
 * this" apart from the two session failures above, and a 404 would collapse all three into one message.
 */
export const requireAdmin = async (request: NextRequest) => {
  const auth = await requireSession(request);
  if (auth.response) {
    return { response: auth.response, session: null };
  }

  if (!(await isAdminUser(auth.session.sub))) {
    return {
      response: fail(apiError("forbidden", "Administrator access required"), 403),
      session: null,
    };
  }

  return { response: null, session: auth.session };
};
