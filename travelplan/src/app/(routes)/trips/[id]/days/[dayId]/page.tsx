import { Container } from "@mui/material";
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
    <Container maxWidth="lg" sx={{ py: { xs: 6, md: 10 } }}>
      <TripDayView tripId={id} dayId={dayId} />
    </Container>
  );
}
