import { AppBar, Box, Container, Toolbar, Typography } from "@mui/material";
import { cookies } from "next/headers";
import HeaderMenu from "@/components/HeaderMenu";
import { verifySessionJwt } from "@/lib/auth/jwt";

const resolveAuthState = async () => {
  const cookieStore = await cookies();
  const token = cookieStore.get("session")?.value;
  if (!token) return false;

  try {
    await verifySessionJwt(token);
    return true;
  } catch {
    return false;
  }
};

export default async function AppHeader() {
  const isAuthenticated = await resolveAuthState();

  return (
    <AppBar position="static" color="transparent" elevation={0}>
      <Container maxWidth="lg">
        <Toolbar disableGutters sx={{ minHeight: 64, display: "flex", justifyContent: "space-between" }}>
          <Box display="flex" alignItems="center" gap={2}>
            <Typography variant="h6" fontWeight={700}>
              TravelPlan
            </Typography>
          </Box>
          <HeaderMenu isAuthenticated={isAuthenticated} />
        </Toolbar>
      </Container>
    </AppBar>
  );
}
