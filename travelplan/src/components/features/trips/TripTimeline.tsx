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
import TripAccommodationDialog from "@/components/features/trips/TripAccommodationDialog";
import { useI18n } from "@/i18n/provider";
import { formatMessage } from "@/i18n";

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
  accommodation: { id: string; name: string; notes: string | null } | null;
};

type TripDetail = {
  trip: TripSummary;
  days: TripDay[];
};

type TripTimelineProps = {
  tripId: string;
};

export default function TripTimeline({ tripId }: TripTimelineProps) {
  const { language, t } = useI18n();
  const [detail, setDetail] = useState<TripDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [stayOpen, setStayOpen] = useState(false);
  const [stayDay, setStayDay] = useState<TripDay | null>(null);
  const router = useRouter();

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
        const resolveApiError = (code?: string) => {
          switch (code) {
            case "unauthorized":
              return t("errors.unauthorized");
            case "csrf_invalid":
              return t("errors.csrfInvalid");
            case "server_error":
              return t("errors.server");
            case "invalid_json":
              return t("errors.invalidJson");
            default:
              return t("trips.detail.loadError");
          }
        };

        setError(resolveApiError(body.error?.code));
        setDetail(null);
        return;
      }

      setDetail(body.data);
    } catch {
      setError(t("trips.detail.loadError"));
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [tripId, t]);

  useEffect(() => {
    loadTrip();
  }, [loadTrip]);

  const listEmpty = useMemo(() => !loading && !!detail && detail.days.length === 0, [loading, detail]);

  if (loading) {
    return (
      <Paper elevation={1} sx={{ p: 3, borderRadius: 3 }}>
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
      <Paper elevation={1} sx={{ p: 3, borderRadius: 3 }}>
        <Box display="flex" flexDirection="column" gap={2}>
          <Typography variant="h6" fontWeight={600}>
            {t("trips.detail.notFoundTitle")}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t("trips.detail.notFoundBody")}
          </Typography>
          <Button component={Link} href="/trips" variant="outlined" sx={{ alignSelf: "flex-start" }}>
            {t("trips.detail.back")}
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

  const handleStayOpen = (day: TripDay) => {
    setStayDay(day);
    setStayOpen(true);
  };

  const handleStayClose = () => {
    setStayOpen(false);
    setStayDay(null);
  };

  const handleStaySaved = () => {
    setStayOpen(false);
    setStayDay(null);
    loadTrip();
  };

  return (
    <Box display="flex" flexDirection="column" gap={2}>
      {error && <Alert severity="error">{error}</Alert>}

      {detail && (
        <Paper
          elevation={1}
          sx={{
            p: 3,
            borderRadius: 3,
            background: "#ffffff",
          }}
        >
          <Box display="flex" flexDirection="column" gap={2}>
            <Box display="flex" flexDirection="column" gap={1.5}>
              <Box display="flex" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={2}>
                <Typography variant="h4" fontWeight={700}>
                  {detail.trip.name}
                </Typography>
                <Box display="flex" alignItems="center" gap={1}>
                  <Button variant="outlined" onClick={() => setEditOpen(true)}>
                    {t("trips.edit.open")}
                  </Button>
                  <Button variant="outlined" color="error" onClick={() => setDeleteOpen(true)}>
                    {t("trips.delete.open")}
                  </Button>
                </Box>
              </Box>
              <Typography variant="body1" color="text.secondary">
                {buildDateRange(detail.trip)} ·{" "}
                {formatMessage(t("trips.dashboard.dayCount"), { count: detail.trip.dayCount })}
              </Typography>
            </Box>

            <Divider />

            {listEmpty && (
              <Typography variant="body2" color="text.secondary">
                {t("trips.timeline.empty")}
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
                      <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
                        {(day.missingAccommodation || day.missingPlan) && (
                          <>
                            {day.missingAccommodation && (
                              <Chip label={t("trips.timeline.missingStay")} size="small" color="warning" variant="outlined" />
                            )}
                            {day.missingPlan && (
                              <Chip label={t("trips.timeline.missingPlan")} size="small" color="warning" variant="outlined" />
                            )}
                          </>
                        )}
                        <Button size="small" variant="text" onClick={() => handleStayOpen(day)}>
                          {day.accommodation ? t("trips.stay.editAction") : t("trips.stay.addAction")}
                        </Button>
                      </Box>
                    }
                  >
                    <ListItemText
                      primary={formatMessage(t("trips.timeline.dayLabel"), { index: day.dayIndex })}
                      secondary={formatDate(day.date)}
                      sx={{ py: 0.5 }}
                    />
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
          <TripAccommodationDialog
            open={stayOpen}
            tripId={detail.trip.id}
            day={stayDay}
            onClose={handleStayClose}
            onSaved={handleStaySaved}
          />
        </>
      )}
    </Box>
  );
}
