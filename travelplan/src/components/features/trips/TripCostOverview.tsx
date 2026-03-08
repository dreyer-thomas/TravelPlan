"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Divider,
  Paper,
  Skeleton,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
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
    payments: { amountCents: number; dueDate: string }[];
  } | null;
  dayPlanItems: {
    id: string;
    title: string | null;
    contentJson: string;
    costCents: number | null;
    payments: { amountCents: number; dueDate: string }[];
  }[];
};

type TripDetail = {
  trip: TripSummary;
  days: TripDay[];
};

type TripCostOverviewProps = {
  tripId: string;
};

type CostViewMode = "days" | "months";

type DayEntry = {
  id: string;
  label: string;
  amountCents: number | null;
};

type MonthlyEntry = {
  id: string;
  label: string;
  amountCents: number;
  date: string;
  sortKey: string;
};

type MonthlyGroup = {
  monthKey: string;
  monthDate: string;
  entries: MonthlyEntry[];
  totalCents: number;
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

const compareMonthlyEntries = (left: MonthlyEntry, right: MonthlyEntry) => {
  if (left.date !== right.date) return left.date.localeCompare(right.date);
  if (left.sortKey !== right.sortKey) return left.sortKey.localeCompare(right.sortKey);
  return left.id.localeCompare(right.id);
};

const buildDayEntries = (day: TripDay, t: ReturnType<typeof useI18n>["t"]): DayEntry[] => {
  const entries: DayEntry[] = [];

  day.dayPlanItems.forEach((item, itemIndex) => {
    const preview = parsePlanText(item.contentJson) || formatMessage(t("trips.dayView.budgetItemPlan"), { index: itemIndex + 1 });
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

  return entries;
};

const buildMonthlyGroups = (days: TripDay[], t: ReturnType<typeof useI18n>["t"]): MonthlyGroup[] => {
  const entries: MonthlyEntry[] = [];

  days.forEach((day) => {
    if (day.accommodation && day.accommodation.costCents !== null) {
      const accommodationPayments = day.accommodation.payments ?? [];
      if (accommodationPayments.length > 0) {
        accommodationPayments.forEach((payment, index) => {
          entries.push({
            id: `accommodation-payment-${day.accommodation!.id}-${index}`,
            label: day.accommodation!.name,
            amountCents: payment.amountCents,
            date: payment.dueDate,
            sortKey: `accommodation-${day.accommodation!.id}-${index}`,
          });
        });
      } else {
        entries.push({
          id: `accommodation-fallback-${day.accommodation.id}`,
          label: day.accommodation.name,
          amountCents: day.accommodation.costCents,
          date: day.date.slice(0, 10),
          sortKey: `accommodation-${day.accommodation.id}`,
        });
      }
    }

    day.dayPlanItems.forEach((item, itemIndex) => {
      const preview = parsePlanText(item.contentJson) || formatMessage(t("trips.dayView.budgetItemPlan"), { index: itemIndex + 1 });
      const title = item.title?.trim() || preview;

      if (item.payments.length > 0) {
        item.payments.forEach((payment, paymentIndex) => {
          entries.push({
            id: `day-plan-payment-${item.id}-${paymentIndex}`,
            label: title,
            amountCents: payment.amountCents,
            date: payment.dueDate,
            sortKey: `day-plan-${item.id}-${paymentIndex}`,
          });
        });
        return;
      }

      if (item.costCents !== null) {
        entries.push({
          id: `day-plan-fallback-${item.id}`,
          label: title,
          amountCents: item.costCents,
          date: day.date.slice(0, 10),
          sortKey: `day-plan-${item.id}`,
        });
      }
    });
  });

  const groupsByMonth = new Map<string, MonthlyEntry[]>();

  entries
    .filter((entry) => entry.amountCents > 0 && entry.date.length >= 10)
    .sort(compareMonthlyEntries)
    .forEach((entry) => {
      const monthKey = entry.date.slice(0, 7);
      const bucket = groupsByMonth.get(monthKey);
      if (bucket) {
        bucket.push(entry);
        return;
      }

      groupsByMonth.set(monthKey, [entry]);
    });

  return [...groupsByMonth.entries()]
    .sort(([leftMonth], [rightMonth]) => leftMonth.localeCompare(rightMonth))
    .map(([monthKey, monthEntries]) => ({
      monthKey,
      monthDate: `${monthKey}-01`,
      entries: [...monthEntries].sort(compareMonthlyEntries),
      totalCents: monthEntries.reduce((sum, entry) => sum + entry.amountCents, 0),
    }));
};

export default function TripCostOverview({ tripId }: TripCostOverviewProps) {
  const { language, t } = useI18n();
  const [detail, setDetail] = useState<TripDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [viewMode, setViewMode] = useState<CostViewMode>("days");

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

  const formatMonth = useMemo(
    () => (value: string) =>
      new Intl.DateTimeFormat(language === "de" ? "de-DE" : "en-US", {
        month: "long",
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

  const sortedDays = useMemo(() => [...(detail?.days ?? [])].sort(compareTripDaysChronologically), [detail?.days]);
  const monthlyGroups = useMemo(() => buildMonthlyGroups(sortedDays, t), [sortedDays, t]);
  const tripTotalAmount = detail ? formatCost(detail.trip.plannedCostTotal) : "";

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
          <Tabs
            value={viewMode}
            onChange={(_event, value: CostViewMode) => setViewMode(value)}
            aria-label={t("trips.costOverview.modeLabel")}
            sx={{ alignSelf: "flex-start" }}
          >
            <Tab value="days" label={t("trips.costOverview.modeDays")} />
            <Tab value="months" label={t("trips.costOverview.modeMonths")} />
          </Tabs>
          {detail && sortedDays.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {t("trips.costOverview.empty")}
            </Typography>
          ) : null}

          {detail && sortedDays.length > 0 && viewMode === "days" && (
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
                  {sortedDays.map((day) => {
                    const entries = buildDayEntries(day, t);

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

          {detail && sortedDays.length > 0 && viewMode === "months" && monthlyGroups.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {t("trips.costOverview.emptyMonths")}
            </Typography>
          ) : null}

          {detail && sortedDays.length > 0 && viewMode === "months" && monthlyGroups.length > 0 && (
            <Box display="flex" flexDirection="column" gap={2}>
              {monthlyGroups.map((group) => (
                <Paper key={group.monthKey} variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                  <Box display="flex" flexDirection="column" gap={1.5}>
                    <Box display="flex" justifyContent="space-between" gap={2} alignItems="baseline">
                      <Typography variant="subtitle1" fontWeight={700}>
                        {formatMonth(group.monthDate)}
                      </Typography>
                      <Typography variant="body2" fontWeight={600}>
                        {formatMessage(t("trips.costOverview.monthTotalLabel"), { total: formatCost(group.totalCents) })}
                      </Typography>
                    </Box>
                    <Divider />
                    <Box display="flex" flexDirection="column" gap={1.25}>
                      {group.entries.map((entry) => (
                        <Box
                          key={entry.id}
                          display="grid"
                          gridTemplateColumns={{ xs: "minmax(0, 1fr)", sm: "minmax(0, 1fr) auto auto" }}
                          columnGap={2}
                          rowGap={0.5}
                          alignItems="baseline"
                        >
                          <Typography variant="body2" fontWeight={500} sx={{ overflowWrap: "anywhere" }}>
                            {entry.label}
                          </Typography>
                          <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>
                            {formatDate(entry.date)}
                          </Typography>
                          <Typography variant="body2" textAlign="right" sx={{ whiteSpace: "nowrap" }}>
                            {formatMessage(t("trips.stay.costSummary"), { amount: formatCost(entry.amountCents) })}
                          </Typography>
                        </Box>
                      ))}
                    </Box>
                  </Box>
                </Paper>
              ))}
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
