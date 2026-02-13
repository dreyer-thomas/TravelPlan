import { Box, Container, Typography } from "@mui/material";
import TripsDashboard from "@/components/features/trips/TripsDashboard";

export default function TripsPage() {
  return (
    <Container maxWidth="md" sx={{ py: { xs: 6, md: 10 } }}>
      <Box display="flex" flexDirection="column" gap={4}>
        <Box>
          <Typography variant="h3" fontWeight={700} gutterBottom>
            Your trips
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Set a date range, generate your planning days, and keep the whole journey in view.
          </Typography>
        </Box>

        <TripsDashboard />
      </Box>
    </Container>
  );
}
