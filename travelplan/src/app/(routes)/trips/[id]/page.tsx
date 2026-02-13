import { Box, Button, Container, Typography } from "@mui/material";
import Link from "next/link";
import TripTimeline from "@/components/features/trips/TripTimeline";

type TripDetailPageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function TripDetailPage({ params }: TripDetailPageProps) {
  const { id } = await params;
  return (
    <Container maxWidth="md" sx={{ py: { xs: 6, md: 10 } }}>
      <Box display="flex" flexDirection="column" gap={4}>
        <Box display="flex" flexDirection="column" gap={1}>
          <Link href="/trips" style={{ alignSelf: "flex-start", textDecoration: "none" }}>
            <Button variant="text" sx={{ alignSelf: "flex-start" }}>
              ← Back to trips
            </Button>
          </Link>
          <Typography variant="h5" fontWeight={700}>
            Trip timeline
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Review each day and keep your itinerary organized.
          </Typography>
        </Box>

        <TripTimeline tripId={id} />
      </Box>
    </Container>
  );
}
