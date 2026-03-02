"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Divider,
  Paper,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import Link from "next/link";
import { useI18n } from "@/i18n/provider";
import { formatMessage } from "@/i18n";
import { parsePlanText } from "@/components/features/trips/TripDayPlanItemContent";

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
  plannedCostTotal: number;
  accommodationCostTotalCents: number | null;
  heroImageUrl: string | null;
};

type TripDay = {
  id: string;
  date: string;
  dayIndex: number;
  note?: string | null;
  plannedCostSubtotal: number;
  accommodation: {
    id: string;
    name: string;
    costCents: number | null;
  } | null;
  dayPlanItems: {
    id: string;
    title: string | null;
    contentJson: string;
    costCents: number | null;
  }[];
};

type TripDetail = {
  trip: TripSummary;
  days: TripDay[];
};

type TripCostOverviewProps = {
  tripId: string;
};

const compareTripDaysChronologically = (left: TripDay, right: TripDay) => {
  if (left.dayIndex !== right.dayIndex) return left.dayIndex - right.dayIndex;
  const leftTime = Date.parse(left.date);
  const rightTime = Date.parse(right.date);
  if (!Number.isNaN(leftTime) && !Number.isNaN(rightTime) && leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  return left.id.localeCompare(right.id);
};

export default function TripCostOverview({ tripId }: TripCostOverviewProps) {
  const { language, t } = useI18n();
  const [detail, setDetail] = useState<TripDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

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

  useEffect(() => {
    let isMounted = true;

    const loadTrip = async () => {
      setLoading(true);
      setError(null);
      setNotFound(false);
      try {
        const response = await fetch(`/api/trips/${tripId}`, { method: "GET", credentials: "include", cache: "no-store" });
        const body = (await response.json()) as ApiEnvelope<TripDetail>;

        if (response.status === 404 || body.error?.code === "not_found") {
          if (isMounted) {
            setNotFound(true);
            setDetail(null);
          }
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

          if (isMounted) {
            setError(resolveApiError(body.error?.code));
            setDetail(null);
          }
          return;
        }

        if (isMounted) {
          setDetail(body.data);
        }
      } catch {
        if (isMounted) {
          setError(t("trips.detail.loadError"));
          setDetail(null);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    loadTrip();
    return () => {
      isMounted = false;
    };
  }, [tripId, t]);

  if (loading) {
    return (
      <Paper elevation={1} sx={{ p: 3, borderRadius: 3, background: "#ffffff" }}>
        <Box display="flex" flexDirection="column" gap={2}>
          <Skeleton variant="text" width="40%" height={32} />
          <Skeleton variant="text" width="60%" height={24} />
          <Divider />
          <Skeleton variant="rectangular" width="100%" height={120} />
        </Box>
      </Paper>
    );
  }

  if (notFound) {
    return (
      <Paper elevation={1} sx={{ p: 3, borderRadius: 3, background: "#ffffff" }}>
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

  const sortedDays = [...(detail?.days ?? [])].sort(compareTripDaysChronologically);
  const tripTotalAmount = detail ? formatCost(detail.trip.plannedCostTotal) : "";

  return (
    <Box display="flex" flexDirection="column" gap={2}>
      {error && <Alert severity="error">{error}</Alert>}
      <Paper elevation={1} sx={{ p: 3, borderRadius: 3, background: "#ffffff" }}>
        <Box display="flex" flexDirection="column" gap={2}>
          <Box display="flex" flexDirection="column" gap={0.5}>
            <Typography variant="h6" fontWeight={600}>
              {t("trips.costOverview.title")}
            </Typography>
            {detail ? (
              <Typography variant="body2" color="text.secondary">
                {detail.trip.name} · {formatDate(detail.trip.startDate)} - {formatDate(detail.trip.endDate)}
              </Typography>
            ) : null}
          </Box>
          <Divider />
          {detail && sortedDays.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {t("trips.costOverview.empty")}
            </Typography>
          ) : null}

          {detail && sortedDays.length > 0 && (
            <Box sx={{ overflowX: "auto" }} data-testid="cost-overview-table-wrapper">
              <Table sx={{ minWidth: 640 }}>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>{t("trips.costOverview.columnDay")}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>{t("trips.costOverview.columnItems")}</TableCell>
                    <TableCell sx={{ fontWeight: 600, textAlign: "right" }}>
                      {t("trips.costOverview.columnDayTotal")}
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {sortedDays.map((day, index) => {
                    const entries: { id: string; label: string; amountCents: number | null }[] = [];

                    day.dayPlanItems.forEach((item, itemIndex) => {
                      const preview =
                        parsePlanText(item.contentJson) || formatMessage(t("trips.dayView.budgetItemPlan"), { index: itemIndex + 1 });
                      const title = item.title?.trim() || preview;
                      entries.push({
                        id: item.id,
                        label: title,
                        amountCents: item.costCents,
                      });
                    });

                    if (day.accommodation) {
                      entries.push({
                        id: `current-stay-${day.accommodation.id}`,
                        label: formatMessage(t("trips.dayView.budgetItemCurrentNight"), { name: day.accommodation.name }),
                        amountCents: day.accommodation.costCents,
                      });
                    }

                    return (
                      <TableRow key={day.id}>
                        <TableCell sx={{ verticalAlign: "top", width: { xs: 160, md: 220 } }}>
                          <Box display="flex" flexDirection="column" gap={0.5}>
                            <Typography variant="subtitle2" fontWeight={600}>
                              {formatMessage(t("trips.timeline.dayLabel"), { index: day.dayIndex })}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {formatDate(day.date)}
                            </Typography>
                          </Box>
                        </TableCell>
                        <TableCell sx={{ verticalAlign: "top" }}>
                          {entries.length === 0 ? (
                            <Typography variant="body2" color="text.secondary">
                              {t("trips.costOverview.emptyDay")}
                            </Typography>
                          ) : (
                            <Box display="flex" flexDirection="column" gap={1}>
                              {entries.map((entry) => {
                                const amountLabel =
                                  entry.amountCents === null
                                    ? "-"
                                    : formatMessage(t("trips.stay.costSummary"), { amount: formatCost(entry.amountCents) });
                                return (
                                  <Box
                                    key={entry.id}
                                    display="grid"
                                    gridTemplateColumns="minmax(0, 1fr) auto"
                                    columnGap={2}
                                    rowGap={0.5}
                                    alignItems="baseline"
                                  >
                                    <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>
                                      {entry.label}
                                    </Typography>
                                    <Typography
                                      variant="body2"
                                      color={entry.amountCents === null ? "text.secondary" : "text.primary"}
                                      textAlign="right"
                                      data-testid={entry.amountCents === null ? "cost-missing" : "cost-known"}
                                    >
                                      {amountLabel}
                                    </Typography>
                                  </Box>
                                );
                              })}
                            </Box>
                          )}
                        </TableCell>
                        <TableCell sx={{ verticalAlign: "top", textAlign: "right", whiteSpace: "nowrap" }}>
                          {formatMessage(t("trips.stay.costSummary"), { amount: formatCost(day.plannedCostSubtotal) })}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Box>
          )}

          {detail && (
            <Box display="flex" justifyContent="flex-end">
              <Typography variant="subtitle1" fontWeight={700}>
                {formatMessage(t("trips.costOverview.tripTotalLabel"), { total: tripTotalAmount })}
              </Typography>
            </Box>
          )}
        </Box>
      </Paper>
    </Box>
  );
}
