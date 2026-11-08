import { Box, Container } from "@mui/material";
import TripDayMapBackButton from "@/components/features/trips/TripDayMapBackButton";
import TripPackingList from "@/components/features/trips/TripPackingList";
import { getServerT } from "@/i18n/server";

/** Story 16.1 (FR58). The trip's packing list page, the shape of the cost overview page. */

type TripPackingListPageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function TripPackingListPage({ params }: TripPackingListPageProps) {
  const { id } = await params;
  const t = await getServerT();

  return (
    <Box sx={{ minHeight: "100vh" }}>
      <Container maxWidth="lg" sx={{ py: { xs: 4, md: 6 } }}>
        <Box display="flex" flexDirection="column" gap={3}>
          <TripDayMapBackButton href={`/trips/${id}`} label={t("trips.packingList.back")} />
          <TripPackingList tripId={id} />
        </Box>
      </Container>
    </Box>
  );
}
