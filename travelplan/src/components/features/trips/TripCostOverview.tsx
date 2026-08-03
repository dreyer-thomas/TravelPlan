"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Divider,
  Skeleton,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  Typography,
  useTheme,
} from "@mui/material";
import Link from "next/link";
import { useI18n } from "@/i18n/provider";
import { formatMessage } from "@/i18n";
import { formatCost } from "@/lib/trips/formatCost";
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
  const theme = useTheme();
  const tokens = theme.palette.tokens;
  // The shipped `card` treatment, identical to TripOverviewMapFullPage.tsx and TripTimeline.tsx's
  // cost summary card. A Box, not a Paper: theme.ts stamps a non-token 1px border on every MuiPaper,
  // which would layer over borderStrong. 18px is --spacing-card-padding.
  const cardSx = {
    backgroundColor: tokens.card,
    border: "1px solid",
    borderColor: tokens.borderStrong,
    borderRadius: "8px",
    padding: "18px",
  } as const;
  // The quieter nested surface the dashboard rows, the share dialog and DialogShell already use: a
  // month group sits *inside* the card above, so it takes cardAlt with the plain `border` token and a
  // 6px radius that does not compete with the card's 8px.
  const nestedGroupSx = {
    backgroundColor: tokens.cardAlt,
    border: "1px solid",
    borderColor: tokens.border,
    borderRadius: "6px",
    padding: "16px",
  } as const;
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
  const tripTotalAmount = detail ? formatCost(detail.trip.plannedCostTotal, language) : "";

  if (loading) {
    return (
      <Box sx={cardSx}>
        <Box display="flex" flexDirection="column" gap={2}>
          {/* The real label, not a text skeleton, exactly as TripOverviewMapFullPage.tsx:134-139 does
              it: a placeholder bar sized for the retired h6 title is twice the height of the caps
              label that replaces it and would jump on settle, and rendering the label keeps the screen
              from having no heading at all while it loads. Only the content below is skeletoned. */}
          <Typography variant="labelCaps" component="h1" sx={{ color: tokens.inkSoft, display: "block" }}>
            {t("trips.costOverview.title")}
          </Typography>
          <Skeleton variant="text" width="60%" height={24} />
          <Divider sx={{ borderColor: tokens.border }} />
          <Skeleton variant="rectangular" width="100%" height={120} />
        </Box>
      </Box>
    );
  }

  if (notFound) {
    return (
      <Box sx={cardSx}>
        <Box display="flex" flexDirection="column" gap={2}>
          {/* `heading` in `ink`, not the caps card-label the main card carries: AC8 pins this branch to
              the treatment already shipped on the screens this one is reached from, and both map
              screens render this same key that way (TripOverviewMapFullPage.tsx:149). A dead end the
              user landed on by a stale URL has to be legible, so it is a title, not a label. */}
          <Typography variant="heading" component="h1" sx={{ color: tokens.ink }}>
            {t("trips.detail.notFoundTitle")}
          </Typography>
          <Typography variant="body2" sx={{ color: tokens.inkSoft }}>
            {t("trips.detail.notFoundBody")}
          </Typography>
          <Button component={Link} href="/trips" variant="outlined" sx={{ alignSelf: "flex-start" }}>
            {t("trips.detail.back")}
          </Button>
        </Box>
      </Box>
    );
  }

  return (
    <Box display="flex" flexDirection="column" gap={2}>
      {error && <Alert severity="error">{error}</Alert>}
      <Box sx={cardSx} data-testid="cost-overview-card">
        <Box display="flex" flexDirection="column" gap={2}>
          <Box display="flex" flexDirection="column" gap={0.5}>
            {/* component= is mandatory: the custom labelCaps variant has no variantMapping entry, so
                it renders a <span> otherwise. h1 because this screen has no page title above the card
                - the card label is its only heading, as Story 7.9 decided for the map screens. */}
            <Typography variant="labelCaps" component="h1" sx={{ color: tokens.inkSoft, display: "block" }}>
              {t("trips.costOverview.title")}
            </Typography>
            {detail ? (
              <Typography variant="body2" sx={{ color: tokens.inkSoft }}>
                {detail.trip.name} · {formatDate(detail.trip.startDate)} - {formatDate(detail.trip.endDate)}
              </Typography>
            ) : null}
          </Box>
          <Divider sx={{ borderColor: tokens.border }} />
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
            <Typography variant="body2" sx={{ color: tokens.inkSoft }}>
              {t("trips.costOverview.empty")}
            </Typography>
          ) : null}

          {detail && sortedDays.length > 0 && viewMode === "days" && (
            <Box sx={{ overflowX: "auto" }} data-testid="cost-overview-table-wrapper">
              {/* Still a real Table: three columns and a header row is tabular data, and the element
                  is what conveys that to assistive technology. Only the paint changes here - every
                  cell rule is the `border` token rather than MUI's cold default `divider`, and the
                  trailing rule is suppressed via :last-child the way the cost summary and bucket list
                  already do, so adding a day never leaves a rule hanging under the last row. */}
              <Table
                sx={{
                  minWidth: 640,
                  "& td, & th": { borderColor: tokens.border },
                  "& tbody tr:last-child td": { borderBottom: "none" },
                }}
              >
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ typography: "labelCaps", color: tokens.inkSoft }}>
                      {t("trips.costOverview.columnDay")}
                    </TableCell>
                    <TableCell sx={{ typography: "labelCaps", color: tokens.inkSoft }}>
                      {t("trips.costOverview.columnItems")}
                    </TableCell>
                    <TableCell sx={{ typography: "labelCaps", color: tokens.inkSoft, textAlign: "right" }}>
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
                            <Typography variant="caption" sx={{ color: tokens.inkSoft }}>
                              {formatDate(day.date)}
                            </Typography>
                          </Box>
                        </TableCell>
                        <TableCell sx={{ verticalAlign: "top" }}>
                          {entries.length === 0 ? (
                            <Typography variant="body2" sx={{ color: tokens.inkSoft }}>
                              {t("trips.costOverview.emptyDay")}
                            </Typography>
                          ) : (
                            <Box display="flex" flexDirection="column" gap={1}>
                              {entries.map((entry) => {
                                const amountLabel = entry.amountCents === null ? "-" : formatCost(entry.amountCents, language);
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
                                      sx={{ fontVariantNumeric: "tabular-nums" }}
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
                        <TableCell
                          sx={{
                            verticalAlign: "top",
                            textAlign: "right",
                            whiteSpace: "nowrap",
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          {formatCost(day.plannedCostSubtotal, language)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Box>
          )}

          {detail && sortedDays.length > 0 && viewMode === "months" && monthlyGroups.length === 0 ? (
            <Typography variant="body2" sx={{ color: tokens.inkSoft }}>
              {t("trips.costOverview.emptyMonths")}
            </Typography>
          ) : null}

          {detail && sortedDays.length > 0 && viewMode === "months" && monthlyGroups.length > 0 && (
            <Box display="flex" flexDirection="column" gap={2}>
              {monthlyGroups.map((group) => (
                <Box key={group.monthKey} sx={nestedGroupSx} data-testid="cost-overview-month-group">
                  <Box display="flex" flexDirection="column" gap={1.5}>
                    <Box display="flex" justifyContent="space-between" gap={2} alignItems="baseline">
                      {/* h2 so the outline descends from the card's h1 without skipping a level. */}
                      <Typography variant="cardTitle" component="h2" sx={{ color: tokens.ink }}>
                        {formatMonth(group.monthDate)}
                      </Typography>
                      <Typography variant="body2" fontWeight={600} sx={{ fontVariantNumeric: "tabular-nums" }}>
                        {formatMessage(t("trips.costOverview.monthTotalLabel"), {
                          total: formatCost(group.totalCents, language),
                        })}
                      </Typography>
                    </Box>
                    <Divider sx={{ borderColor: tokens.border }} />
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
                          <Typography variant="body2" sx={{ color: tokens.inkSoft, whiteSpace: "nowrap" }}>
                            {formatDate(entry.date)}
                          </Typography>
                          <Typography
                            variant="body2"
                            textAlign="right"
                            sx={{ whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}
                          >
                            {formatCost(entry.amountCents, language)}
                          </Typography>
                        </Box>
                      ))}
                    </Box>
                  </Box>
                </Box>
              ))}
            </Box>
          )}

          {detail && (
            <Box display="flex" justifyContent="flex-end">
              <Typography variant="cardTitle" sx={{ color: tokens.ink, fontVariantNumeric: "tabular-nums" }}>
                {formatMessage(t("trips.costOverview.tripTotalLabel"), { total: tripTotalAmount })}
              </Typography>
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
}
