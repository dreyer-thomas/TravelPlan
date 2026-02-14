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
    <Container maxWidth="md" sx={{ py: { xs: 6, md: 10 } }}>
      <Box display="flex" flexDirection="column" gap={4}>
        <Link href="/trips" style={{ alignSelf: "flex-start", textDecoration: "none" }}>
          <Button variant="text" sx={{ alignSelf: "flex-start" }}>
            {t("trips.detail.back")}
          </Button>
        </Link>

        <TripTimeline tripId={id} />
      </Box>
    </Container>
  );
}
