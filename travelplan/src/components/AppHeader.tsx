import { AppBar, Box, Container, Toolbar, Typography } from "@mui/material";
import { cookies } from "next/headers";
import HeaderMenu from "@/components/HeaderMenu";
import { isAdminUser } from "@/lib/auth/adminAccess";
import { verifySessionJwt } from "@/lib/auth/jwt";
import { getServerT } from "@/i18n/server";

/**
 * Story 5.10 widened this from a boolean to `{ isAuthenticated, isAdmin }`.
 *
 * **`isAdmin` comes from the database, not from the token's `role` claim.** This is a server component on
 * the Node runtime, so it can ask - and the token cannot answer honestly: `createSessionJwt({ sub, role })`
 * bakes the role in for seven days, so an account promoted by `admin:grant` would see no menu entry until
 * it next signed in, and one whose role had been revoked would keep being offered the row. Reading it here
 * costs one indexed primary-key lookup on a header that already verifies a JWT, and it is the same
 * predicate `requireAdmin` uses, so the menu and the API cannot disagree about who is an admin.
 *
 * **The two lookups have separate `try` blocks, and that separation is load-bearing.** They fail for
 * unrelated reasons and the honest answer differs: a `verifySessionJwt` rejection means there is no session,
 * while a Prisma error means the *role* is unknown. With both under one `catch` - as they briefly were - a
 * transient `SQLITE_BUSY` or a locked database file made a user holding a perfectly valid session render as
 * anonymous, so the header offered Login and Register on every page in the `(routes)` group while the rest of
 * the page went on treating them as signed in. A database failure now costs the administration row and
 * nothing else.
 */
const resolveAuthState = async () => {
  const cookieStore = await cookies();
  const token = cookieStore.get("session")?.value;
  if (!token) return { isAuthenticated: false, isAdmin: false };

  let userId: string;
  try {
    userId = (await verifySessionJwt(token)).sub;
  } catch {
    return { isAuthenticated: false, isAdmin: false };
  }

  try {
    return { isAuthenticated: true, isAdmin: await isAdminUser(userId) };
  } catch {
    // The session is good; only the role is unknown. Withholding the row is the safe direction - the page
    // and every `/api/admin/*` route re-check it anyway, so a false negative here costs a navigation and a
    // false positive would put a non-admin in front of a surface that deletes accounts.
    return { isAuthenticated: true, isAdmin: false };
  }
};

export default async function AppHeader() {
  const { isAuthenticated, isAdmin } = await resolveAuthState();
  const t = await getServerT();

  return (
    <AppBar
      position="static"
      color="transparent"
      elevation={0}
      sx={{
        borderBottom: "1px solid rgba(17, 18, 20, 0.08)",
        backdropFilter: "blur(8px)",
        backgroundColor: "rgba(255, 255, 255, 0.92)",
      }}
    >
      <Container maxWidth="lg">
        <Toolbar disableGutters sx={{ minHeight: 72, display: "flex", justifyContent: "space-between" }}>
          <Box display="flex" alignItems="center" gap={2}>
            <Typography variant="h6" fontWeight={700} sx={{ letterSpacing: "0.12em", textTransform: "uppercase" }}>
              {t("app.brand")}
            </Typography>
          </Box>
          <HeaderMenu isAuthenticated={isAuthenticated} isAdmin={isAdmin} />
        </Toolbar>
      </Container>
    </AppBar>
  );
}
