import { Box, Container } from "@mui/material";
import TripDayMapFullPage from "@/components/features/trips/TripDayMapFullPage";
import TripDayMapBackButton from "@/components/features/trips/TripDayMapBackButton";
import { getServerT } from "@/i18n/server";

type TripDayMapPageProps = {
  params: Promise<{
    id: string;
    dayId: string;
  }>;
};

export default async function TripDayMapPage({ params }: TripDayMapPageProps) {
  const { id, dayId } = await params;
  const t = await getServerT();
  return (
    <Box sx={{ backgroundColor: "#2f343d", minHeight: "100vh" }}>
      <Container maxWidth="lg" sx={{ py: { xs: 4, md: 6 } }}>
        <Box display="flex" flexDirection="column" gap={3}>
          <TripDayMapBackButton href={`/trips/${id}/days/${dayId}`} label={t("trips.dayView.back")} />
          <TripDayMapFullPage tripId={id} dayId={dayId} />
        </Box>
      </Container>
    </Box>
  );
}
