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
import TripAccommodationDialog from "@/components/features/trips/TripAccommodationDialog";
import TripDayMapPanel, { buildDayMapPanelData } from "@/components/features/trips/TripDayMapPanel";
import TripDayPlanDialog from "@/components/features/trips/TripDayPlanDialog";
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
    location?: { lat: number; lng: number } | null;
  } | null;
};

type DayPlanItem = {
  id: string;
  tripDayId: string;
  contentJson: string;
  linkUrl: string | null;
  location?: { lat: number; lng: number } | null;
  createdAt: string;
};

type TripDetail = {
  trip: TripSummary;
  days: TripDay[];
};

type TripDayViewProps = {
  tripId: string;
  dayId: string;
};

const parsePlanText = (value: string) => {
  try {
    const doc = JSON.parse(value);
    const parts: string[] = [];

    const walk = (node: { text?: string; content?: unknown[] }) => {
      if (!node) return;
      if (typeof node.text === "string") parts.push(node.text);
      if (Array.isArray(node.content)) {
        node.content.forEach((child) => walk(child as { text?: string; content?: unknown[] }));
      }
    };

    walk(doc as { text?: string; content?: unknown[] });
    return parts.join(" ").trim();
  } catch {
    return "";
  }
};

const getMapLocation = (value: { lat: number; lng: number } | null | undefined) => {
  if (!value) return null;
  if (typeof value.lat !== "number" || typeof value.lng !== "number") return null;
  return value;
};

export default function TripDayView({ tripId, dayId }: TripDayViewProps) {
  const { language, t } = useI18n();
  const [detail, setDetail] = useState<TripDetail | null>(null);
  const [day, setDay] = useState<TripDay | null>(null);
  const [planItems, setPlanItems] = useState<DayPlanItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [stayOpen, setStayOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);

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

  const formatCost = useMemo(
    () => (value: number) =>
      new Intl.NumberFormat(language === "de" ? "de-DE" : "en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(value / 100),
    [language],
  );

  const resolveApiError = useCallback(
    (code?: string) => {
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
          return t("trips.dayView.loadError");
      }
    },
    [t],
  );

  const loadDay = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotFound(false);

    try {
      const detailResponse = await fetch(`/api/trips/${tripId}`, { method: "GET", credentials: "include" });
      const detailBody = (await detailResponse.json()) as ApiEnvelope<TripDetail>;

      if (detailResponse.status === 404 || detailBody.error?.code === "not_found") {
        setNotFound(true);
        setDetail(null);
        setDay(null);
        setPlanItems([]);
        return;
      }

      if (!detailResponse.ok || detailBody.error || !detailBody.data) {
        setError(resolveApiError(detailBody.error?.code));
        setDetail(null);
        setDay(null);
        setPlanItems([]);
        return;
      }

      const resolvedDay = detailBody.data.days.find((item) => item.id === dayId) ?? null;
      if (!resolvedDay) {
        setNotFound(true);
        setDetail(null);
        setDay(null);
        setPlanItems([]);
        return;
      }

      const planResponse = await fetch(`/api/trips/${tripId}/day-plan-items?tripDayId=${resolvedDay.id}`, {
        method: "GET",
        credentials: "include",
      });
      const planBody = (await planResponse.json()) as ApiEnvelope<{ items: DayPlanItem[] }>;

      if (!planResponse.ok || planBody.error || !planBody.data) {
        setError(resolveApiError(planBody.error?.code));
        setDetail(detailBody.data);
        setDay(resolvedDay);
        setPlanItems([]);
        return;
      }

      setDetail(detailBody.data);
      setDay(resolvedDay);
      setPlanItems(planBody.data.items);
    } catch {
      setError(t("trips.dayView.loadError"));
      setDetail(null);
      setDay(null);
      setPlanItems([]);
    } finally {
      setLoading(false);
    }
  }, [dayId, resolveApiError, t, tripId]);

  useEffect(() => {
    loadDay();
  }, [loadDay]);

  const previousDay = useMemo(() => {
    if (!detail || !day) return null;
    const currentIndex = detail.days.findIndex((candidate) => candidate.id === day.id);
    if (currentIndex <= 0) return null;
    return detail.days[currentIndex - 1] ?? null;
  }, [detail, day]);

  const previousStay = previousDay?.accommodation ?? null;
  const currentStay = day?.accommodation ?? null;
  const dayHasTimelineContent = Boolean(previousStay || currentStay || planItems.length > 0);

  const budgetEntries = useMemo(() => {
    const entries: { id: string; label: string; amountCents: number | null }[] = [];

    if (previousStay) {
      entries.push({
        id: `previous-stay-${previousStay.id}`,
        label: formatMessage(t("trips.dayView.budgetItemPreviousNight"), { name: previousStay.name }),
        amountCents: previousStay.costCents,
      });
    }

    planItems.forEach((item, index) => {
      const preview = parsePlanText(item.contentJson) || formatMessage(t("trips.dayView.budgetItemPlan"), { index: index + 1 });
      entries.push({
        id: item.id,
        label: preview,
        amountCents: null,
      });
    });

    if (currentStay) {
      entries.push({
        id: `current-stay-${currentStay.id}`,
        label: formatMessage(t("trips.dayView.budgetItemCurrentNight"), { name: currentStay.name }),
        amountCents: currentStay.costCents,
      });
    }

    return entries;
  }, [currentStay, planItems, previousStay, t]);

  const dayTotalCents = useMemo(
    () => budgetEntries.reduce((sum, entry) => sum + (entry.amountCents ?? 0), 0),
    [budgetEntries],
  );

  const mapData = useMemo(
    () =>
      buildDayMapPanelData({
        previousStay: previousStay
          ? {
              id: previousStay.id,
              label: previousStay.name,
              kind: "previousStay",
              location: getMapLocation(previousStay.location),
            }
          : null,
        planItems: planItems.map((item, index) => ({
          id: item.id,
          label: parsePlanText(item.contentJson) || formatMessage(t("trips.dayView.budgetItemPlan"), { index: index + 1 }),
          kind: "planItem" as const,
          location: getMapLocation(item.location),
        })),
        currentStay: currentStay
          ? {
              id: currentStay.id,
              label: currentStay.name,
              kind: "currentStay",
              location: getMapLocation(currentStay.location),
            }
          : null,
      }),
    [currentStay, planItems, previousStay, t],
  );

  if (loading) {
    return (
      <Paper elevation={1} sx={{ p: 3, borderRadius: 3 }}>
        <Box display="flex" flexDirection="column" gap={2}>
          <Skeleton variant="text" width="40%" height={34} />
          <Skeleton variant="text" width="30%" height={22} />
          <Divider />
          <Skeleton variant="rectangular" height={220} />
        </Box>
      </Paper>
    );
  }

  if (notFound) {
    return (
      <Paper elevation={1} sx={{ p: 3, borderRadius: 3 }}>
        <Box display="flex" flexDirection="column" gap={2}>
          <Typography variant="h6" fontWeight={600}>
            {t("trips.dayView.notFoundTitle")}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t("trips.dayView.notFoundBody")}
          </Typography>
          <Button component={Link} href={`/trips/${tripId}`} variant="outlined" sx={{ alignSelf: "flex-start" }}>
            {t("trips.dayView.back")}
          </Button>
        </Box>
      </Paper>
    );
  }

  return (
    <Box display="flex" flexDirection="column" gap={2} data-testid="trip-day-view-page">
      {error && <Alert severity="error">{error}</Alert>}

      {detail && day && (
        <>
          <Paper elevation={1} sx={{ p: 3, borderRadius: 3 }}>
            <Box display="flex" flexDirection="column" gap={2}>
              <Button component={Link} href={`/trips/${tripId}`} variant="text" sx={{ alignSelf: "flex-start" }}>
                {t("trips.dayView.back")}
              </Button>
              <Box display="flex" flexDirection="column" gap={0.5}>
                <Typography variant="h5" fontWeight={700}>
                  {formatMessage(t("trips.dayView.title"), { index: day.dayIndex })}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {formatDate(day.date)}
                </Typography>
              </Box>
              <Divider />
            </Box>
          </Paper>

          <Box display="flex" flexDirection={{ xs: "column", lg: "row" }} gap={2}>
            <Paper elevation={0} sx={{ flex: 2, p: 2, borderRadius: 2, border: "1px solid", borderColor: "divider" }}>
              <Box display="flex" alignItems="center" justifyContent="space-between" gap={1} flexWrap="wrap">
                <Typography variant="subtitle1" fontWeight={600}>
                  {t("trips.dayView.timelineTitle")}
                </Typography>
                <Box display="flex" alignItems="center" gap={1}>
                  <Button size="small" variant="outlined" onClick={() => setStayOpen(true)}>
                    {day.accommodation ? t("trips.stay.editAction") : t("trips.stay.addAction")}
                  </Button>
                  <Button size="small" variant="outlined" onClick={() => setPlanOpen(true)}>
                    {planItems.length > 0 ? t("trips.plan.editAction") : t("trips.plan.addAction")}
                  </Button>
                </Box>
              </Box>
              <Divider sx={{ my: 1.5 }} />

              {!dayHasTimelineContent && (
                <Typography variant="body2" color="text.secondary">
                  {t("trips.dayView.timelineEmpty")}
                </Typography>
              )}

              {dayHasTimelineContent && (
                <List disablePadding>
                  <ListItem divider disablePadding sx={{ py: 1 }}>
                    <ListItemText
                      primary={t("trips.dayView.previousNightTitle")}
                      secondary={
                        previousStay ? (
                          <Box display="flex" alignItems="center" gap={1} flexWrap="wrap" component="span">
                            <Typography variant="body2" component="span">
                              {previousStay.name}
                            </Typography>
                            <Chip
                              label={
                                previousStay.status === "booked"
                                  ? t("trips.stay.statusBooked")
                                  : t("trips.stay.statusPlanned")
                              }
                              size="small"
                              color={previousStay.status === "booked" ? "success" : "default"}
                              variant="outlined"
                            />
                          </Box>
                        ) : (
                          t("trips.dayView.previousNightEmpty")
                        )
                      }
                      secondaryTypographyProps={{ component: "span" }}
                    />
                  </ListItem>

                  <ListItem divider disablePadding sx={{ py: 1 }}>
                    <Box display="flex" flexDirection="column" width="100%" gap={1}>
                      <Typography variant="body1">{t("trips.dayView.activitiesTitle")}</Typography>
                      {planItems.length === 0 && (
                        <Typography variant="body2" color="text.secondary">
                          {t("trips.dayView.activitiesEmpty")}
                        </Typography>
                      )}
                      {planItems.length > 0 && (
                        <List disablePadding dense>
                          {planItems.map((item, index) => {
                            const preview =
                              parsePlanText(item.contentJson) ||
                              formatMessage(t("trips.dayView.budgetItemPlan"), { index: index + 1 });
                            return (
                              <ListItem key={item.id} disablePadding sx={{ py: 0.5 }}>
                                <ListItemText
                                  primary={preview}
                                  secondary={
                                    item.linkUrl ? (
                                      <Button
                                        component="a"
                                        href={item.linkUrl}
                                        target="_blank"
                                        rel="noreferrer noopener"
                                        variant="text"
                                        size="small"
                                        sx={{ p: 0, minWidth: "auto" }}
                                      >
                                        {t("trips.plan.linkOpen")}
                                      </Button>
                                    ) : (
                                      t("trips.plan.noLink")
                                    )
                                  }
                                />
                              </ListItem>
                            );
                          })}
                        </List>
                      )}
                    </Box>
                  </ListItem>

                  <ListItem disablePadding sx={{ py: 1 }}>
                    <ListItemText
                      primary={t("trips.dayView.currentNightTitle")}
                      secondary={
                        currentStay ? (
                          <Box display="flex" alignItems="center" gap={1} flexWrap="wrap" component="span">
                            <Typography variant="body2" component="span">
                              {currentStay.name}
                            </Typography>
                            <Chip
                              label={currentStay.status === "booked" ? t("trips.stay.statusBooked") : t("trips.stay.statusPlanned")}
                              size="small"
                              color={currentStay.status === "booked" ? "success" : "default"}
                              variant="outlined"
                            />
                          </Box>
                        ) : (
                          t("trips.dayView.currentNightEmpty")
                        )
                      }
                      secondaryTypographyProps={{ component: "span" }}
                    />
                  </ListItem>
                </List>
              )}
            </Paper>

            <Box sx={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
              <Paper elevation={0} sx={{ p: 2, borderRadius: 2, border: "1px solid", borderColor: "divider" }}>
                <Typography variant="subtitle1" fontWeight={600}>
                  {t("trips.dayView.summaryTitle")}
                </Typography>
                <Box display="flex" justifyContent="space-between" alignItems="center" mt={1.5}>
                  <Typography variant="body2" color="text.secondary">
                    {t("trips.dayView.budgetTotal")}
                  </Typography>
                  <Typography variant="body1" fontWeight={700}>
                    {formatMessage(t("trips.stay.costSummary"), { amount: formatCost(dayTotalCents) })}
                  </Typography>
                </Box>
                <Divider sx={{ my: 1.5 }} />

                {budgetEntries.length === 0 && (
                  <Typography variant="body2" color="text.secondary">
                    {t("trips.dayView.budgetEmpty")}
                  </Typography>
                )}

                {budgetEntries.length > 0 && (
                  <List dense sx={{ p: 0 }}>
                    {budgetEntries.map((entry) => (
                      <ListItem key={entry.id} sx={{ px: 0 }}>
                        <ListItemText
                          primary={entry.label}
                          secondary={
                            entry.amountCents !== null
                              ? formatMessage(t("trips.stay.costSummary"), { amount: formatCost(entry.amountCents) })
                              : t("trips.dayView.budgetNoAmount")
                          }
                        />
                      </ListItem>
                    ))}
                  </List>
                )}
              </Paper>

              <TripDayMapPanel loading={loading} points={mapData.points} missingLocations={mapData.missingLocations} />
            </Box>
          </Box>

          <TripAccommodationDialog
            open={stayOpen}
            tripId={tripId}
            day={day}
            onClose={() => setStayOpen(false)}
            onSaved={() => {
              setStayOpen(false);
              loadDay();
            }}
          />
          <TripDayPlanDialog
            open={planOpen}
            tripId={tripId}
            day={day}
            onClose={() => setPlanOpen(false)}
            onSaved={() => {
              setPlanOpen(false);
              loadDay();
            }}
          />
        </>
      )}
    </Box>
  );
}
