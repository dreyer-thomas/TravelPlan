import { Box, Container } from "@mui/material";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import AdminUsersList from "@/components/features/admin/AdminUsersList";
import { isAdminUser } from "@/lib/auth/adminAccess";
import { verifySessionJwt } from "@/lib/auth/jwt";

/**
 * The administration shell (Story 5.10, AC1, AC2).
 *
 * **Unlike `/users`, this page gates itself**, and the difference is worth stating because 5.8's page
 * deliberately does not. There, the only gate was `GET /api/users`, and the list component rendered a
 * blocked state from its 403 - one place decides, so the shell and the API cannot disagree. That works
 * when being refused is an ordinary outcome for an ordinary signed-in user.
 *
 * Here it is not. `/admin/users` is not a page a non-admin has any business seeing the frame of, and the
 * middleware cannot decide it - `role` in the session token is a seven-day snapshot and Prisma does not
 * run in the edge runtime. A server component can, so it does, and the answer is the live one.
 *
 * `notFound()` rather than a redirect or a rendered "forbidden" panel: to an account that is not an
 * administrator, this route does not exist. That is also why the component below still handles its own
 * `forbidden` state - the role can be revoked between this render and the fetch that follows it, and the
 * API remains the authority.
 *
 * The session itself is not re-checked for existence here; the middleware has already redirected a
 * signed-out visitor to `/auth/login` and a password-flagged one to the forced change. What is left for
 * this file is the role.
 */
const resolveSignedInUserId = async () => {
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
 * Note that `notFound()` itself throws, so it must sit outside the `try` or it would be caught here.
 */
const isAdminOrUnknown = async (userId: string) => {
  try {
    return await isAdminUser(userId);
  } catch {
    return false;
  }
};

export default async function AdminUsersPage() {
  const userId = await resolveSignedInUserId();

  if (!userId || !(await isAdminOrUnknown(userId))) {
    notFound();
  }

  return (
    <Box sx={{ minHeight: "100vh" }}>
      {/* `md`, matching `/users` - this is a list of rows, not a two-column layout. */}
      <Container maxWidth="md" sx={{ py: { xs: 4, md: 6 } }}>
        <AdminUsersList currentUserId={userId} />
      </Container>
    </Box>
  );
}
