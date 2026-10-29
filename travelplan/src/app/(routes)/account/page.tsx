import { Box, Container, Stack } from "@mui/material";
import { notFound } from "next/navigation";
import AccountSummary from "@/components/features/account/AccountSummary";
import ConnectedApps from "@/components/features/account/ConnectedApps";
import { resolveSignedInUserId } from "@/lib/auth/adminPage";
import { getMcpResourceUrl, isMcpEnabled } from "@/lib/oauth/config";
import { getUserEmailById } from "@/lib/repositories/userRepo";

export const dynamic = "force-dynamic";

/**
 * Story 15.3. The account page - the first one this app has. The epic assumed an existing page to hang
 * *Connected apps* on and there was none, so this is the smallest faithful one: who is signed in, and the
 * connections section. A self-service password change or account deletion are separate features and are
 * deliberately not here.
 *
 * The session itself is the proxy's job (`/account` joins its page predicate and matcher), exactly as for
 * `/admin/users`; what is left here is reading the email. An account that vanished between the proxy and
 * this render - deleted by an admin - gets `notFound()`, not a page about nobody.
 *
 * The section is rendered only while the connector is switched on (`isMcpEnabled()`), decided here on the
 * server so the switch is read where it is authoritative; its two routes answer 404 when it is off. The
 * connector URL is resolved here for the same reason - `APP_BASE_URL` is a server variable.
 */
export default async function AccountPage() {
  const userId = await resolveSignedInUserId();
  // No `.catch` here: a database failure must reach the error boundary, not pass for a missing account.
  const email = userId ? await getUserEmailById(userId) : null;

  if (!email) {
    notFound();
  }

  return (
    <Box sx={{ minHeight: "100vh" }}>
      <Container maxWidth="md" sx={{ py: { xs: 4, md: 6 } }}>
        <Stack spacing={3}>
          <AccountSummary email={email} />
          {isMcpEnabled() && <ConnectedApps mcpUrl={getMcpResourceUrl()} />}
        </Stack>
      </Container>
    </Box>
  );
}
