import { Box, Container } from "@mui/material";
import TripCostOverview from "@/components/features/trips/TripCostOverview";
import TripDayMapBackButton from "@/components/features/trips/TripDayMapBackButton";
import { getServerT } from "@/i18n/server";

type TripCostOverviewPageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function TripCostOverviewPage({ params }: TripCostOverviewPageProps) {
  const { id } = await params;
  const t = await getServerT();

  return (
    <Box sx={{ backgroundColor: "#2f343d", minHeight: "100vh" }}>
      <Container maxWidth="lg" sx={{ py: { xs: 4, md: 6 } }}>
        <Box display="flex" flexDirection="column" gap={3}>
          <TripDayMapBackButton href={`/trips/${id}`} label={t("trips.costOverview.back")} />
          <TripCostOverview tripId={id} />
        </Box>
      </Container>
    </Box>
  );
}
