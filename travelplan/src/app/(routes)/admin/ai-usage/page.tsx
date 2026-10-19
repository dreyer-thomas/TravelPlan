import { Box, Container } from "@mui/material";
import { notFound } from "next/navigation";
import AdminAiUsage from "@/components/features/admin/AdminAiUsage";
import { isAdminOrUnknown, resolveSignedInUserId } from "@/lib/auth/adminPage";

/**
 * Story 8.7. What the AI day searches cost (AC9, AC10).
 *
 * Gates itself exactly like `/admin/users` - `notFound()` for anyone who is not, or cannot be shown to be,
 * an administrator - and the component still handles `forbidden` from the API, which stays the authority.
 * The header row leading here is presentation only.
 */
export default async function AdminAiUsagePage() {
  const userId = await resolveSignedInUserId();

  if (!userId || !(await isAdminOrUnknown(userId))) {
    notFound();
  }

  return (
    <Box sx={{ minHeight: "100vh" }}>
      <Container maxWidth="md" sx={{ py: { xs: 4, md: 6 } }}>
        <AdminAiUsage />
      </Container>
    </Box>
  );
}
