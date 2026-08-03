import { Box, Container } from "@mui/material";
import RegisteredUsersList from "@/components/features/users/RegisteredUsersList";

/**
 * The registered-users shell: a `Container` and the list, nothing above it.
 *
 * No back link, matching both sibling pages. Story 6.20 removed the breadcrumb from the trip detail
 * shell and put the way back to all trips in the global `HeaderMenu`, which `(routes)/layout.tsx`
 * renders on this page too - a second back affordance here would be the one this app already decided
 * against.
 *
 * The ownership gate is deliberately *not* repeated here. `GET /api/users` is the single place that
 * decides it, and the list component renders the blocked state from that 403 - a second check in the
 * shell could disagree with the API and would give the page a state no test of the endpoint covers.
 */
export default function RegisteredUsersPage() {
  return (
    <Box sx={{ minHeight: "100vh" }}>
      <Container maxWidth="md" sx={{ py: { xs: 4, md: 6 } }}>
        <RegisteredUsersList />
      </Container>
    </Box>
  );
}
