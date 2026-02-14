"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Paper,
  Skeleton,
  Typography,
} from "@mui/material";
import Link from "next/link";
import TripCreateDialog from "@/components/features/trips/TripCreateDialog";
import { type TripCreateResponse } from "@/components/features/trips/TripCreateForm";
import { useI18n } from "@/i18n/provider";
import { formatMessage } from "@/i18n";

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

type TripSummary = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  dayCount: number;
  heroImageUrl: string | null;
};

export default function TripsDashboard() {
  const { language, t } = useI18n();
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const loadTrips = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/trips", { method: "GET" });
      const body = (await response.json()) as ApiEnvelope<{ trips: TripSummary[] }>;

      if (!response.ok || body.error) {
        setError(body.error?.message ?? t("trips.dashboard.loadError"));
        setTrips([]);
        return;
      }

      const sorted = [...(body.data?.trips ?? [])].sort(
        (a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime(),
      );
      setTrips(sorted);
    } catch {
      setError(t("trips.dashboard.loadError"));
      setTrips([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTrips();
  }, [loadTrips]);

  const listEmpty = useMemo(() => !loading && trips.length === 0 && !error, [loading, trips.length, error]);
  const formatDate = useMemo(
    () => (value: string) =>
      new Intl.DateTimeFormat(language === "de" ? "de-DE" : "en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(value)),
    [language],
  );
  const buildDateRange = useCallback(
    (trip: TripSummary) => `${formatDate(trip.startDate)} - ${formatDate(trip.endDate)}`,
    [formatDate],
  );
  const handleTripCreated = useCallback((response: TripCreateResponse) => {
    const summary: TripSummary = {
      id: response.trip.id,
      name: response.trip.name,
      startDate: response.trip.startDate,
      endDate: response.trip.endDate,
      dayCount: response.dayCount,
      heroImageUrl: response.trip.heroImageUrl ?? null,
    };
    setTrips((current) => {
      const merged = [summary, ...current.filter((trip) => trip.id !== summary.id)];
      return merged.sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
    });
  }, []);
  const handleOpenCreate = useCallback(() => {
    setCreateOpen(true);
  }, []);
  const handleCloseCreate = useCallback(() => {
    setCreateOpen(false);
  }, []);

  return (
    <Box display="flex" flexDirection="column" gap={4}>
      <Box display="flex" alignItems="center" justifyContent="space-between" gap={2} flexWrap="wrap">
        <Typography variant="h6" fontWeight={600}>
          {t("trips.dashboard.title")}
        </Typography>
        <Button variant="contained" onClick={handleOpenCreate}>
          {t("trips.dashboard.addTrip")}
        </Button>
      </Box>

      <Box display="flex" flexDirection="column" gap={2}>
        {error && <Alert severity="error">{error}</Alert>}

        {loading && (
          <Paper elevation={1} sx={{ p: 3, borderRadius: 3 }}>
            <Box display="flex" flexDirection="column" gap={1.5}>
              <Skeleton variant="text" width="60%" height={28} />
              <Skeleton variant="text" width="45%" height={22} />
              <Skeleton variant="text" width="55%" height={22} />
            </Box>
          </Paper>
        )}

        {listEmpty && (
          <Paper elevation={1} sx={{ p: 3, borderRadius: 3 }}>
            <Box display="flex" flexDirection="column" gap={1.5} alignItems="flex-start">
              <Typography variant="body2" color="text.secondary">
                {t("trips.dashboard.empty")}
              </Typography>
              <Button variant="outlined" onClick={handleOpenCreate}>
                {t("trips.dashboard.addTrip")}
              </Button>
            </Box>
          </Paper>
        )}

        {!loading && trips.length > 0 && (
          <Paper elevation={1} sx={{ p: 3, borderRadius: 3 }}>
            <List disablePadding>
              {trips.map((trip) => (
                <ListItem key={trip.id} divider disablePadding>
                  <ListItemButton
                    component={Link}
                    href={`/trips/${trip.id}`}
                    sx={{
                      borderRadius: 2,
                      my: 0.5,
                      "&:hover": { backgroundColor: "rgba(241, 90, 36, 0.08)" },
                      display: "flex",
                      gap: 2,
                    }}
                  >
                    <Box
                      sx={{
                        width: 96,
                        height: 64,
                        borderRadius: 2,
                        overflow: "hidden",
                        flexShrink: 0,
                        backgroundColor: "rgba(0, 0, 0, 0.04)",
                      }}
                    >
                      <Box
                        component="img"
                        src={trip.heroImageUrl ?? "/images/world-map-placeholder.svg"}
                        alt={trip.name}
                        sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                      />
                    </Box>
                    <ListItemText
                      primary={trip.name}
                      secondary={`${buildDateRange(trip)} - ${formatMessage(t("trips.dashboard.dayCount"), {
                        count: trip.dayCount,
                      })}`}
                    />
                  </ListItemButton>
                </ListItem>
              ))}
            </List>
          </Paper>
        )}
      </Box>

      <TripCreateDialog open={createOpen} onClose={handleCloseCreate} onCreated={handleTripCreated} />
    </Box>
  );
}
