import { Box, Container } from "@mui/material";
import TripTimeline from "@/components/features/trips/TripTimeline";

type TripDetailPageProps = {
  params: Promise<{
    id: string;
  }>;
};

/**
 * The trip detail shell: a `Container` and the timeline, nothing above it.
 *
 * Story 6.20 removed a breadcrumb from the top of this page; the way back to all trips is a row in
 * the global `HeaderMenu` now. Keep the timeline the first block - the top spacing comes from the
 * `Container`'s own `py`, so a wrapper is not needed to produce it.
 */
export default async function TripDetailPage({ params }: TripDetailPageProps) {
  const { id } = await params;
  return (
    <Box sx={{ minHeight: "100vh" }}>
      <Container maxWidth="lg" sx={{ py: { xs: 4, md: 6 } }}>
        <TripTimeline tripId={id} />
      </Container>
    </Box>
  );
}
