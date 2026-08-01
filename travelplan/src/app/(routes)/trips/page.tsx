import { Container } from "@mui/material";
import TripsDashboard from "@/components/features/trips/TripsDashboard";

// The page-level header block moved into TripsDashboard's topbar: it now shows counts derived from
// the fetched trips, which a server component cannot know. The old card was also a shadowed,
// 16px-radius Paper in a system that is flat and bordered (DESIGN.md, "Elevation & Depth").
export default function TripsPage() {
  return (
    <Container maxWidth="lg" sx={{ py: { xs: 3, md: 4 } }}>
      <TripsDashboard />
    </Container>
  );
}
