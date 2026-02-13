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
};

const formatDate = (value: string) =>
  new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(
    new Date(value),
  );

const buildDateRange = (trip: TripSummary) => `${formatDate(trip.startDate)} - ${formatDate(trip.endDate)}`;

export default function TripsDashboard() {
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
        setError(body.error?.message ?? "Unable to load trips.");
        setTrips([]);
        return;
      }

      const sorted = [...(body.data?.trips ?? [])].sort(
        (a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime(),
      );
      setTrips(sorted);
    } catch {
      setError("Unable to load trips.");
      setTrips([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTrips();
  }, [loadTrips]);

  const listEmpty = useMemo(() => !loading && trips.length === 0 && !error, [loading, trips.length, error]);
  const handleTripCreated = useCallback((response: TripCreateResponse) => {
    const summary: TripSummary = {
      id: response.trip.id,
      name: response.trip.name,
      startDate: response.trip.startDate,
      endDate: response.trip.endDate,
      dayCount: response.dayCount,
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
          Trips in progress
        </Typography>
        <Button variant="contained" onClick={handleOpenCreate}>
          Add trip
        </Button>
      </Box>

      <Box display="flex" flexDirection="column" gap={2}>
        {error && <Alert severity="error">{error}</Alert>}

        {loading && (
          <Paper elevation={1} sx={{ p: 2 }}>
            <Box display="flex" flexDirection="column" gap={1.5}>
              <Skeleton variant="text" width="60%" height={28} />
              <Skeleton variant="text" width="45%" height={22} />
              <Skeleton variant="text" width="55%" height={22} />
            </Box>
          </Paper>
        )}

        {listEmpty && (
          <Paper elevation={1} sx={{ p: 2 }}>
            <Box display="flex" flexDirection="column" gap={1.5} alignItems="flex-start">
              <Typography variant="body2" color="text.secondary">
                No trips yet. Select Add trip to start building your plan.
              </Typography>
              <Button variant="outlined" onClick={handleOpenCreate}>
                Add trip
              </Button>
            </Box>
          </Paper>
        )}

        {!loading && trips.length > 0 && (
          <Paper elevation={1} sx={{ p: 2 }}>
            <List disablePadding>
              {trips.map((trip) => (
                <ListItem key={trip.id} divider disablePadding>
                  <ListItemButton component={Link} href={`/trips/${trip.id}`}>
                    <ListItemText
                      primary={trip.name}
                      secondary={`${buildDateRange(trip)} - ${trip.dayCount} days`}
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
