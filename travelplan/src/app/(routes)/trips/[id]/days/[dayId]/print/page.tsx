import type { Metadata } from "next";
import { Box } from "@mui/material";
import TripDayPrintPage from "@/components/features/trips/TripDayPrintPage";

type TripDayPrintPageProps = {
  params: Promise<{
    id: string;
    dayId: string;
  }>;
};

export async function generateMetadata({ params }: TripDayPrintPageProps): Promise<Metadata> {
  const { id, dayId } = await params;
  return { title: `Day itinerary — ${id} / ${dayId}` };
}

export default async function TripDayPrintPageRoute({ params }: TripDayPrintPageProps) {
  const { id, dayId } = await params;
  return (
    <Box sx={{ backgroundColor: "#fff", minHeight: "100vh" }}>
      <TripDayPrintPage tripId={id} dayId={dayId} />
    </Box>
  );
}
