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
  accommodationCostTotalCents: number | null;
  heroImageUrl: string | null;
};

type TripDay = {
  id: string;
  date: string;
  dayIndex: number;
  missingAccommodation: boolean;
  missingPlan: boolean;
  accommodation: {
    id: string;
    name: string;
    notes: string | null;
    status: "planned" | "booked";
    costCents: number | null;
    link: string | null;
  } | null;
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
  const formatCost = useMemo(
    () => (value: number) =>
      new Intl.NumberFormat(language === "de" ? "de-DE" : "en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(value / 100),
    [language],
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

  return (
    <Box display="flex" flexDirection="column" gap={2}>
      {error && <Alert severity="error">{error}</Alert>}

      {detail && (
        <>
          <Paper
            elevation={1}
            sx={{
              p: 3,
              borderRadius: 3,
              background: "#ffffff",
              boxShadow: "0 22px 40px rgba(17, 18, 20, 0.1)",
              border: "1px solid rgba(17, 18, 20, 0.08)",
            }}
          >
            <Box display="flex" flexDirection="column" gap={2}>
              <Box
                sx={{
                  width: "100%",
                  height: { xs: 220, sm: 260 },
                  borderRadius: 3,
                  overflow: "hidden",
                  position: "relative",
                  backgroundColor: "rgba(0, 0, 0, 0.04)",
                }}
              >
                <Box
                  component="img"
                  src={detail.trip.heroImageUrl ?? "/images/world-map-placeholder.svg"}
                  alt={detail.trip.name}
                  sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                />
                <Box
                  sx={{
                    position: "absolute",
                    inset: 0,
                    background:
                      "linear-gradient(180deg, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.05) 60%, rgba(0,0,0,0.6) 100%)",
                  }}
                />
                <Box sx={{ position: "absolute", left: 24, right: 24, bottom: 20 }}>
                  <Typography variant="h4" fontWeight={700} sx={{ color: "#fff" }}>
                    {detail.trip.name}
                  </Typography>
                </Box>
              </Box>
              <Box display="flex" flexDirection="column" gap={1}>
                <Box display="flex" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={2}>
                  <Typography variant="body2" color="text.secondary">
                    {buildDateRange(detail.trip)}
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
                <Typography variant="body2" color="text.secondary">
                  {formatMessage(t("trips.dashboard.dayCount"), { count: detail.trip.dayCount })}
                </Typography>
              </Box>
            </Box>
          </Paper>

          <Paper
            elevation={1}
            sx={{
              p: 3,
              borderRadius: 3,
              background: "#ffffff",
            }}
          >
            <Box display="flex" flexDirection="column" gap={2}>
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
                          <Button
                            component={Link}
                            href={`/trips/${tripId}/days/${day.id}`}
                            size="small"
                            variant="text"
                          >
                            {t("trips.timeline.openDay")}
                          </Button>
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
                        </Box>
                      }
                    >
                      <ListItemText
                        primary={formatMessage(t("trips.timeline.dayLabel"), { index: day.dayIndex })}
                        secondary={
                          <Box display="flex" flexDirection="column" gap={0.5}>
                            <Typography variant="body2" color="text.secondary" component="span">
                              {formatDate(day.date)}
                            </Typography>
                            {!day.missingAccommodation && day.accommodation && (
                              <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
                                <Chip
                                  label={
                                    day.accommodation.status === "booked"
                                      ? t("trips.stay.statusBooked")
                                      : t("trips.stay.statusPlanned")
                                  }
                                  size="small"
                                  color={day.accommodation.status === "booked" ? "success" : "default"}
                                  variant="outlined"
                                  clickable={Boolean(day.accommodation.link)}
                                  component={day.accommodation.link ? "a" : "div"}
                                  href={day.accommodation.link ?? undefined}
                                  target={day.accommodation.link ? "_blank" : undefined}
                                  rel={day.accommodation.link ? "noreferrer noopener" : undefined}
                                />
                                {day.accommodation.costCents !== null && (
                                  <Typography variant="caption" color="text.secondary" component="span">
                                    {formatMessage(t("trips.stay.costSummary"), {
                                      amount: formatCost(day.accommodation.costCents),
                                    })}
                                  </Typography>
                                )}
                              </Box>
                            )}
                          </Box>
                        }
                        secondaryTypographyProps={{ component: "div" }}
                        sx={{ py: 0.5 }}
                      />
                    </ListItem>
                  ))}
                </List>
              )}
            </Box>
          </Paper>
        </>
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
