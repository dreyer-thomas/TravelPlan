import "server-only";
import { cookies } from "next/headers";
import { isAdminUser } from "@/lib/auth/adminAccess";
import { verifySessionJwt } from "@/lib/auth/jwt";

/**
 * The self-gate the administration pages share (Story 5.10; extracted for Story 8.7's second page).
 *
 * A page under `/admin` answers `notFound()` to anyone who is not an administrator, decided from the live
 * role rather than the session token's seven-day snapshot - see `admin/users/page.tsx` for why it is a
 * server-side gate and not a rendered "forbidden" panel. The session's existence is the proxy's job; what
 * is left here is the role.
 */
export const resolveSignedInUserId = async () => {
  const token = (await cookies()).get("session")?.value;
  if (!token) return null;

  try {
    return (await verifySessionJwt(token)).sub;
  } catch {
    return null;
  }
};

/**
 * Wrapped, because `notFound()` is the honest answer to "we could not establish that you are an admin" and a
 * framework 500 is not. `AppHeader` guards the same call for the same reason; this one did not, so a transient
 * Prisma error rendered the error page here while merely hiding the menu row there - two callers of one
 * predicate handling its failure in opposite ways.
 *
 * Note that `notFound()` itself throws, so a caller must call it outside any `try` or it would be caught.
 */
export const isAdminOrUnknown = async (userId: string) => {
  try {
    return await isAdminUser(userId);
  } catch {
    return false;
  }
};
