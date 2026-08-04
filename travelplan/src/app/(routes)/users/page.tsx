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
 *
 * ## Story 5.10, AC10: this page stays, exactly as it is
 *
 * Story 5.10 asked for administration of accounts - create, re-assign, delete - and had to decide what
 * became of this surface, which is gated on *owning a trip* rather than on being an administrator. The
 * decision was to **keep it and put the administration on a separate page** (`/admin/users`), rather than
 * move this one behind `ADMIN` or absorb it.
 *
 * Two reasons:
 *
 *   1. **The need it serves is not the administrator's.** `TripShareDialog` links here so that an owner can
 *      check whether the person they are about to invite already has an account, *before* inviting them.
 *      Story 5.10 does not remove that need, and gating this page on `ADMIN` would take it away from every
 *      non-admin owner - leaving a link in a dialog that walks into a wall, which is exactly what AC10
 *      exists to prevent.
 *   2. **The payloads are different sizes, and the difference should be structural.** This page's endpoint
 *      returns `{ id, email }` and nothing else. The administration endpoint returns roles and each
 *      account's whole trip reach. Serving both from one endpoint that branches on the caller's role would
 *      make the privacy floor a conditional - the kind that is one refactor away from leaking the wide
 *      shape to the narrow audience. Two endpoints, two gates, two shapes.
 *
 * So nothing here changed for Story 5.10, and that is the recorded decision rather than an omission. The
 * administration surface is `src/app/(routes)/admin/users/page.tsx`, reachable only from the header menu
 * and only by an admin.
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
