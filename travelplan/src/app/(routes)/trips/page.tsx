import { Box, Container, Typography } from "@mui/material";
import TripsDashboard from "@/components/features/trips/TripsDashboard";
import { getServerT } from "@/i18n/server";

export default async function TripsPage() {
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
          <Typography variant="h3" fontWeight={700} gutterBottom>
            {t("trips.page.title")}
          </Typography>
          <Typography variant="body1" color="text.secondary">
            {t("trips.page.subtitle")}
          </Typography>
        </Box>

        <TripsDashboard />
      </Box>
    </Container>
  );
}
