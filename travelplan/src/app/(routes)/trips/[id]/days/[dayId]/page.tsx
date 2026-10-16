import { Container } from "@mui/material";
import TripDayView from "@/components/features/trips/TripDayView";
import { isAiSuggestionsEnabled } from "@/lib/ai/config";

type TripDayViewPageProps = {
  params: Promise<{
    id: string;
    dayId: string;
  }>;
};

export default async function TripDayViewPage({ params }: TripDayViewPageProps) {
  const { id, dayId } = await params;
  // Story 12.1: only the capability crosses to the client, never the key itself.
  const aiSuggestionsEnabled = isAiSuggestionsEnabled();
  return (
    <Container maxWidth="lg" sx={{ py: { xs: 4, md: 6 } }}>
      <TripDayView tripId={id} dayId={dayId} aiSuggestionsEnabled={aiSuggestionsEnabled} />
    </Container>
  );
}
