import { Box, Container } from "@mui/material";
import TripDayView from "@/components/features/trips/TripDayView";

type TripDayViewPageProps = {
  params: Promise<{
    id: string;
    dayId: string;
  }>;
};

export default async function TripDayViewPage({ params }: TripDayViewPageProps) {
  const { id, dayId } = await params;
  return (
    <Box sx={{ backgroundColor: "#2f343d", minHeight: "100vh" }}>
      <Container maxWidth="lg" sx={{ py: { xs: 4, md: 6 } }}>
        <TripDayView tripId={id} dayId={dayId} />
      </Container>
    </Box>
  );
}
