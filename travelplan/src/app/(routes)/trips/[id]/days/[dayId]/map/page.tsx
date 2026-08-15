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
  // DW-59: no `minHeight: "100vh"` on this shell, for the reason spelled out in the sibling trip
  // map's `page.tsx` - the Box that used to carry it sat under the 66px `AppHeader`, so the document
  // came to 100vh + 66px and no value of `FULL_PAGE_MAP_HEIGHT` could stop the screen scrolling.
  // Guarded by `fullViewportFloor.ts`.
  return (
    <Container maxWidth="lg" sx={{ py: { xs: 4, md: 6 } }}>
      <Box display="flex" flexDirection="column" gap={3}>
        <TripDayMapBackButton href={`/trips/${id}/days/${dayId}`} label={t("trips.dayView.mapBack")} />
        <TripDayMapFullPage tripId={id} dayId={dayId} />
      </Box>
    </Container>
  );
}
