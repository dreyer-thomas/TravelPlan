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
        <Box
          sx={{
            p: { xs: 3, md: 4 },
            borderRadius: 4,
            background: "#ffffff",
            boxShadow: "0 22px 40px rgba(17, 18, 20, 0.1)",
            border: "1px solid rgba(17, 18, 20, 0.08)",
          }}
        >
          <Link href="/trips" style={{ alignSelf: "flex-start", textDecoration: "none" }}>
            <Button variant="text" sx={{ alignSelf: "flex-start" }}>
              {t("trips.detail.back")}
            </Button>
          </Link>
          <Typography variant="h5" fontWeight={700}>
            {t("trips.detail.title")}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t("trips.detail.subtitle")}
          </Typography>
        </Box>

        <TripTimeline tripId={id} />
      </Box>
    </Container>
  );
}
