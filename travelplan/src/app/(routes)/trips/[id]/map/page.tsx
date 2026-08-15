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

  // DW-59: this shell deliberately sets no `minHeight: "100vh"`, and there is no wrapper left to
  // hang one on. It used to sit on a Box around this Container - a *sibling* of the 66px `AppHeader`,
  // not a replacement for it - so the document came to 100vh + 66px and the screen scrolled by
  // exactly the header height however the map below was sized. That is why shrinking
  // `FULL_PAGE_MAP_HEIGHT` alone could never reach zero, and why `fullViewportFloor.ts` guards this
  // file. `body` carries its own 100vh floor, so the page background is unaffected;
  // `FULL_PAGE_MAP_HEIGHT` is now the only thing deciding the fit.
  return (
    <Container maxWidth="lg" sx={{ py: { xs: 4, md: 6 } }}>
      <Box display="flex" flexDirection="column" gap={3}>
        <TripDayMapBackButton href={`/trips/${id}`} label={t("trips.overviewMap.back")} />
        <TripOverviewMapFullPage tripId={id} />
      </Box>
    </Container>
  );
}
