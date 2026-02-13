"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  List,
  ListItem,
  ListItemText,
  Paper,
  Skeleton,
  Typography,
} from "@mui/material";
import Link from "next/link";
import { useRouter } from "next/navigation";
import TripDeleteDialog from "@/components/features/trips/TripDeleteDialog";
import TripEditDialog, { type TripDetail as EditableTripDetail } from "@/components/features/trips/TripEditDialog";

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
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

type TripDay = {
  id: string;
  date: string;
  dayIndex: number;
  missingAccommodation: boolean;
  missingPlan: boolean;
};

type TripDetail = {
  trip: TripSummary;
  days: TripDay[];
};

const formatDate = (value: string) =>
  new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(
    new Date(value),
  );

const buildDateRange = (trip: TripSummary) => `${formatDate(trip.startDate)} - ${formatDate(trip.endDate)}`;

type TripTimelineProps = {
  tripId: string;
};

export default function TripTimeline({ tripId }: TripTimelineProps) {
  const [detail, setDetail] = useState<TripDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const router = useRouter();

  const loadTrip = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotFound(false);

    try {
      const response = await fetch(`/api/trips/${tripId}`, { method: "GET" });
      const body = (await response.json()) as ApiEnvelope<TripDetail>;

      if (response.status === 404 || body.error?.code === "not_found") {
        setNotFound(true);
        setDetail(null);
        return;
      }

      if (!response.ok || body.error || !body.data) {
        setError(body.error?.message ?? "Unable to load trip.");
        setDetail(null);
        return;
      }

      setDetail(body.data);
    } catch {
      setError("Unable to load trip.");
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [tripId]);

  useEffect(() => {
    loadTrip();
  }, [loadTrip]);

  const listEmpty = useMemo(() => !loading && !!detail && detail.days.length === 0, [loading, detail]);

  if (loading) {
    return (
      <Paper elevation={1} sx={{ p: 3 }}>
        <Box display="flex" flexDirection="column" gap={2}>
          <Skeleton variant="text" width="50%" height={34} />
          <Skeleton variant="text" width="35%" height={24} />
          <Divider />
          <Box display="flex" flexDirection="column" gap={1.5}>
            <Skeleton variant="text" width="60%" height={22} />
            <Skeleton variant="text" width="55%" height={22} />
            <Skeleton variant="text" width="50%" height={22} />
          </Box>
        </Box>
      </Paper>
    );
  }

  if (notFound) {
    return (
      <Paper elevation={1} sx={{ p: 3 }}>
        <Box display="flex" flexDirection="column" gap={2}>
          <Typography variant="h6" fontWeight={600}>
            Trip not found
          </Typography>
          <Typography variant="body2" color="text.secondary">
            This trip might have been deleted or you may not have access to it.
          </Typography>
          <Button component={Link} href="/trips" variant="outlined" sx={{ alignSelf: "flex-start" }}>
            Back to trips
          </Button>
        </Box>
      </Paper>
    );
  }

  const handleEditClose = () => {
    setEditOpen(false);
  };

  const handleDeleteClose = () => {
    setDeleteOpen(false);
  };

  const handleUpdated = (updated: EditableTripDetail) => {
    setDetail(updated);
    setEditOpen(false);
  };

  const handleDeleted = () => {
    setDeleteOpen(false);
    router.push("/trips");
  };

  return (
    <Box display="flex" flexDirection="column" gap={2}>
      {error && <Alert severity="error">{error}</Alert>}

      {detail && (
        <Paper elevation={1} sx={{ p: 3 }}>
          <Box display="flex" flexDirection="column" gap={2}>
            <Box display="flex" flexDirection="column" gap={1.5}>
              <Box display="flex" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={2}>
                <Typography variant="h4" fontWeight={700}>
                  {detail.trip.name}
                </Typography>
                <Box display="flex" alignItems="center" gap={1}>
                  <Button variant="outlined" onClick={() => setEditOpen(true)}>
                    Edit trip
                  </Button>
                  <Button variant="outlined" color="error" onClick={() => setDeleteOpen(true)}>
                    Delete trip
                  </Button>
                </Box>
              </Box>
              <Typography variant="body1" color="text.secondary">
                {buildDateRange(detail.trip)} · {detail.trip.dayCount} days
              </Typography>
            </Box>

            <Divider />

            {listEmpty && (
              <Typography variant="body2" color="text.secondary">
                No days found for this trip yet.
              </Typography>
            )}

            {!listEmpty && (
              <List disablePadding>
                {detail.days.map((day) => (
                  <ListItem
                    key={day.id}
                    divider
                    disablePadding
                    secondaryAction={
                      (day.missingAccommodation || day.missingPlan) && (
                        <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
                          {day.missingAccommodation && (
                            <Chip label="Missing stay" size="small" color="warning" variant="outlined" />
                          )}
                          {day.missingPlan && <Chip label="Missing plan" size="small" color="warning" variant="outlined" />}
                        </Box>
                      )
                    }
                  >
                    <ListItemText primary={`Day ${day.dayIndex}`} secondary={formatDate(day.date)} />
                  </ListItem>
                ))}
              </List>
            )}
          </Box>
        </Paper>
      )}

      {detail && (
        <>
          <TripEditDialog open={editOpen} trip={detail.trip} onClose={handleEditClose} onUpdated={handleUpdated} />
          <TripDeleteDialog
            open={deleteOpen}
            tripId={detail.trip.id}
            tripName={detail.trip.name}
            onClose={handleDeleteClose}
            onDeleted={handleDeleted}
          />
        </>
      )}
    </Box>
  );
}
