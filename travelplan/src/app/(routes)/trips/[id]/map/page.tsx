import { Box, Container } from "@mui/material";
import TripDayMapBackButton from "@/components/features/trips/TripDayMapBackButton";
import TripOverviewMapFullPage from "@/components/features/trips/TripOverviewMapFullPage";
import { getServerT } from "@/i18n/server";

type TripOverviewMapPageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function TripOverviewMapPage({ params }: TripOverviewMapPageProps) {
  const { id } = await params;
  const t = await getServerT();

  return (
    <Box sx={{ backgroundColor: "#2f343d", minHeight: "100vh" }}>
      <Container maxWidth="lg" sx={{ py: { xs: 4, md: 6 } }}>
        <Box display="flex" flexDirection="column" gap={3}>
          <TripDayMapBackButton href={`/trips/${id}`} label={t("trips.overviewMap.back")} />
          <TripOverviewMapFullPage tripId={id} />
        </Box>
      </Container>
    </Box>
  );
}
