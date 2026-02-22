import { Box, Button, Container, Typography } from "@mui/material";
import Link from "next/link";
import TripTimeline from "@/components/features/trips/TripTimeline";
import { getServerT } from "@/i18n/server";

type TripDetailPageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function TripDetailPage({ params }: TripDetailPageProps) {
  const { id } = await params;
  const t = await getServerT();
  return (
    <Box sx={{ backgroundColor: "#2f343d", minHeight: "100vh" }}>
      <Container maxWidth="md" sx={{ py: { xs: 4, md: 6 } }}>
        <Box display="flex" flexDirection="column" gap={4}>
          <Link href="/trips" style={{ alignSelf: "flex-start", textDecoration: "none" }}>
            <Button variant="text" sx={{ alignSelf: "flex-start", color: "#f3f6fb" }}>
              {t("trips.detail.back")}
            </Button>
          </Link>

          <TripTimeline tripId={id} />
        </Box>
      </Container>
    </Box>
  );
}
