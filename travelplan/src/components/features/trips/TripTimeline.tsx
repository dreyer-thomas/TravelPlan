"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Box, Button, Divider, Paper, Skeleton, SvgIcon, Typography, useMediaQuery, useTheme } from "@mui/material";
import Link from "next/link";
import { useRouter } from "next/navigation";
import TripDeleteDialog from "@/components/features/trips/TripDeleteDialog";
import TripEditDialog, { type TripDetail as EditableTripDetail } from "@/components/features/trips/TripEditDialog";
import TripImportDialog from "@/components/features/trips/TripImportDialog";
import TripShareDialog from "@/components/features/trips/TripShareDialog";
import TripDayGanttBar from "@/components/features/trips/TripDayGanttBar";
import TripFeedbackPanel, { type FeedbackSummary } from "@/components/features/trips/TripFeedbackPanel";
import { buildOverviewGanttSegments } from "@/components/features/trips/TripDayGanttOverviewData";
import { deriveCoverageSummary, type TripDayGanttSegment } from "@/components/features/trips/TripDayGanttSegments";
import TripOverviewMapPanel from "@/components/features/trips/TripOverviewMapPanel";
import TripBucketListPanel from "@/components/features/trips/TripBucketListPanel";
import { buildTripOverviewMapData } from "@/components/features/trips/TripOverviewMapData";
import { useI18n } from "@/i18n/provider";
import { formatMessage } from "@/i18n";

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

type TripSummary = {
  id: string;
  name: string;
  currentUserId?: string;
  accessRole?: "owner" | "viewer" | "contributor";
  startDate: string;
  endDate: string;
  dayCount: number;
  plannedCostTotal: number;
  accommodationCostTotalCents: number | null;
  heroImageUrl: string | null;
  feedback: FeedbackSummary;
};

type TripDay = {
  id: string;
  date: string;
  dayIndex: number;
  imageUrl?: string | null;
  note?: string | null;
  updatedAt?: string;
  missingAccommodation: boolean;
  missingPlan: boolean;
  accommodation: {
    id: string;
    name: string;
    notes: string | null;
    status: "planned" | "booked";
    costCents: number | null;
    link: string | null;
    checkInTime?: string | null;
    checkOutTime?: string | null;
    location: { lat: number; lng: number; label: string | null } | null;
    feedback: FeedbackSummary;
  } | null;
  dayPlanItems: {
    id: string;
    title?: string | null;
    fromTime?: string | null;
    toTime?: string | null;
    contentJson: string;
    linkUrl: string | null;
    location: { lat: number; lng: number; label: string | null } | null;
    feedback: FeedbackSummary;
  }[];
  travelSegments?: {
    id: string;
    fromItemType: "accommodation" | "dayPlanItem";
    fromItemId: string;
    toItemType: "accommodation" | "dayPlanItem";
    toItemId: string;
    transportType: "car" | "ship" | "flight";
    durationMinutes: number;
    distanceKm: number | null;
    linkUrl: string | null;
  }[];
  feedback: FeedbackSummary;
};

type TripDetail = {
  trip: TripSummary;
  days: TripDay[];
};

type TripTimelineProps = {
  tripId: string;
};

function HouseIcon({ sx }: { sx?: object }) {
  return (
    <SvgIcon aria-hidden viewBox="0 0 24 24" sx={{ fontSize: 15, ...sx }}>
      <path
        d="M3 21V8l9-5 9 5v13"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9 21v-7h6v7"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </SvgIcon>
  );
}

function WarningTriangleIcon({ sx }: { sx?: object }) {
  return (
    <SvgIcon aria-hidden viewBox="0 0 24 24" sx={{ fontSize: 15, ...sx }}>
      <path d="M12 9v4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
      <path d="M12 17h.01" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
      <path
        d="M10.3 3.9 2.5 18a1.7 1.7 0 0 0 1.5 2.5h16a1.7 1.7 0 0 0 1.5-2.5L13.7 3.9a1.7 1.7 0 0 0-3.4 0Z"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinejoin="round"
      />
    </SvgIcon>
  );
}

function ChevronRightIcon({ sx }: { sx?: object }) {
  return (
    <SvgIcon aria-hidden viewBox="0 0 24 24" sx={{ fontSize: 18, ...sx }}>
      <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </SvgIcon>
  );
}

function ShareGlyphIcon({ sx }: { sx?: object }) {
  return (
    <SvgIcon aria-hidden viewBox="0 0 24 24" sx={{ fontSize: 15, ...sx }}>
      <circle cx="18" cy="5" r="2.6" fill="none" stroke="currentColor" strokeWidth={2} />
      <circle cx="6" cy="12" r="2.6" fill="none" stroke="currentColor" strokeWidth={2} />
      <circle cx="18" cy="19" r="2.6" fill="none" stroke="currentColor" strokeWidth={2} />
      <line x1="8.3" y1="10.7" x2="15.7" y2="6.3" stroke="currentColor" strokeWidth={2} />
      <line x1="8.3" y1="13.3" x2="15.7" y2="17.7" stroke="currentColor" strokeWidth={2} />
    </SvgIcon>
  );
}

const HERO_SCRIM =
  "linear-gradient(to top, rgba(20,18,14,.88) 0%, rgba(20,18,14,.54) 38%, rgba(20,18,14,.10) 66%, rgba(20,18,14,.26) 100%)";
const DAY_ROW_GAP_BG = "#FBF6EE";

export default function TripTimeline({ tripId }: TripTimelineProps) {
  const { language, t } = useI18n();
  const theme = useTheme();
  const tokens = theme.palette.tokens;
  const [detail, setDetail] = useState<TripDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const router = useRouter();
  const isNarrowLayout = useMediaQuery(theme.breakpoints.down("sm"));
  const isOwner = detail?.trip.accessRole ? detail.trip.accessRole === "owner" : true;
  const canEditPlanning = detail?.trip.accessRole ? detail.trip.accessRole !== "viewer" : true;

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
  const formatShortDate = useMemo(
    () => (value: string) =>
      new Intl.DateTimeFormat(language === "de" ? "de-DE" : "en-US", {
        month: "numeric",
        day: "numeric",
        timeZone: "UTC",
      }).format(new Date(value)),
    [language],
  );
  // style: "currency" places the symbol per locale - German needs "1.234,50 €", not "€1.234,50".
  const formatCost = useMemo(
    () => (value: number) =>
      new Intl.NumberFormat(language === "de" ? "de-DE" : "en-US", {
        style: "currency",
        currency: "EUR",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(value / 100),
    [language],
  );

  const loadTrip = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    setNotFound(false);

    try {
      const response = await fetch(`/api/trips/${tripId}`, { method: "GET", credentials: "include", cache: "no-store" });
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
  const resolveDayImageSrc = useCallback((imageUrl?: string | null, updatedAt?: string) => {
    if (!imageUrl || !imageUrl.trim()) return null;
    if (!updatedAt) return imageUrl;
    const version = encodeURIComponent(updatedAt);
    return imageUrl.includes("?") ? `${imageUrl}&v=${version}` : `${imageUrl}?v=${version}`;
  }, []);

  const formatDurationSummary = useCallback(
    (minutes: number) => {
      const safeMinutes = Math.max(0, Math.round(minutes));
      const hours = Math.floor(safeMinutes / 60);
      const remainingMinutes = safeMinutes % 60;
      if (hours > 0 && remainingMinutes > 0) {
        return formatMessage(t("trips.dayView.ganttHoursMinutes"), { hours, minutes: remainingMinutes });
      }
      if (hours > 0) {
        return formatMessage(t("trips.dayView.ganttHours"), { hours });
      }
      return formatMessage(t("trips.dayView.ganttMinutes"), { minutes: remainingMinutes });
    },
    [t],
  );

  // Only ever resolves a real place: the accommodation's own location label, or nothing. A day-note
  // fallback used to exist here for the gap-alert copy, but a gap day has no accommodation by
  // construction (tripRepo: missingAccommodation === !hasAccommodation), so it only ever produced the
  // raw note - sometimes an itinerary line - in place of a place name. The gap-alert copy now names
  // the day and date instead.
  const resolveStayLocationLabel = useCallback(
    (day: TripDay): string | null => day.accommodation?.location?.label?.trim() || null,
    [],
  );

  const overviewMapData = useMemo(() => {
    if (!detail) {
      return { points: [], missingLocations: [], polylinePositions: [] };
    }

    return buildTripOverviewMapData({
      tripId,
      days: detail.days.map((day) => ({
        id: day.id,
        date: day.date,
        dayIndex: day.dayIndex,
        accommodation: day.accommodation
          ? {
              id: day.accommodation.id,
              name: day.accommodation.name,
              notes: day.accommodation.notes,
              location: day.accommodation.location,
            }
          : null,
        dayPlanItems: day.dayPlanItems.map((item) => ({
          id: item.id,
          title: item.title ?? null,
          contentJson: item.contentJson,
          location: item.location,
        })),
      })),
      getDayLabel: (index) => formatMessage(t("trips.timeline.dayLabel"), { index }),
      getPlanItemFallbackLabel: (index) => formatMessage(t("trips.plan.previewFallback"), { index }),
    });
  }, [detail, t, tripId]);

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
    setDetail(updated as TripDetail);
    setEditOpen(false);
  };

  const handleDeleted = () => {
    setDeleteOpen(false);
    router.push("/trips");
  };

  const handleImported = async () => {
    await loadTrip();
    setSuccess(t("trips.import.success"));
    setImportOpen(false);
  };

  const extractAttachmentFilename = (headerValue: string | null) => {
    if (!headerValue) return null;
    const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(headerValue);
    if (utf8Match?.[1]) {
      try {
        return decodeURIComponent(utf8Match[1]);
      } catch {
        return utf8Match[1];
      }
    }

    const simpleMatch = /filename="?([^";]+)"?/i.exec(headerValue);
    return simpleMatch?.[1] ?? null;
  };

  const triggerDownload = (blob: Blob, filename: string) => {
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.style.display = "none";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  };

  const handleExport = async () => {
    setError(null);
    try {
      const response = await fetch(`/api/trips/${tripId}/export`, { method: "GET" });
      if (!response.ok) {
        setError(t("trips.export.error"));
        return;
      }

      const filename = extractAttachmentFilename(response.headers.get("content-disposition")) ?? `trip-${tripId}.json`;
      const blob = await response.blob();
      triggerDownload(blob, filename);
    } catch {
      setError(t("trips.export.error"));
    }
  };

  // Quoted and percent-escaped: an unquoted url() breaks on any path containing a space or ")", and
  // trip import accepts heroImageUrl as a free-form string, which would otherwise let imported data
  // close the url() and inject arbitrary CSS declarations into this page.
  const heroImageCss = detail
    ? `url("${encodeURI(detail.trip.heroImageUrl ?? "/images/world-map-placeholder.svg").replace(/"/g, "%22")}")`
    : "none";
  const openDaysCount = detail?.days.filter((day) => day.missingAccommodation).length ?? 0;
  const firstGapDay = detail?.days.find((day) => day.missingAccommodation) ?? null;
  const accommodationCostTotal = detail?.trip.accommodationCostTotalCents ?? 0;
  const activitiesCostTotal = Math.max((detail?.trip.plannedCostTotal ?? 0) - accommodationCostTotal, 0);

  return (
    <Box display="flex" flexDirection="column" gap={2}>
      {error && <Alert severity="error">{error}</Alert>}
      {success && <Alert severity="success">{success}</Alert>}

      {detail && (
        <>
          <Box sx={{ borderRadius: "8px", overflow: "hidden", border: "1px solid", borderColor: tokens.border }}>
            <Box
              data-testid="trip-hero"
              sx={{
                position: "relative",
                minHeight: 300,
                display: "flex",
                flexDirection: "column",
                justifyContent: "flex-end",
                padding: "22px 32px 24px",
                overflow: "hidden",
                backgroundColor: theme.palette.primary.main,
                backgroundImage: heroImageCss,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }}
            >
              <Box aria-hidden sx={{ position: "absolute", inset: 0, background: HERO_SCRIM }} />
              <Box
                sx={{
                  position: "absolute",
                  top: 20,
                  left: 32,
                  right: 32,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  zIndex: 2,
                  gap: 2,
                }}
              >
                <Typography variant="kicker" sx={{ color: "rgba(255,255,255,.92)" }}>
                  {t("trips.timeline.activeTripKicker")}
                </Typography>
                {isOwner ? (
                  <Button
                    variant="text"
                    onClick={() => setShareOpen(true)}
                    startIcon={<ShareGlyphIcon />}
                    sx={{
                      backgroundColor: "rgba(255,255,255,.18)",
                      border: "1px solid rgba(255,255,255,.55)",
                      color: "#FFFFFF",
                      whiteSpace: "nowrap",
                      "&:hover": { backgroundColor: "rgba(255,255,255,.28)" },
                    }}
                  >
                    {t("trips.share.open")}
                  </Button>
                ) : null}
              </Box>
              <Box sx={{ position: "relative", zIndex: 2 }}>
                <Typography variant="display" component="h4" sx={{ color: "#FFFFFF", textShadow: "0 2px 14px rgba(0,0,0,.35)" }}>
                  {detail.trip.name}
                </Typography>
                <Typography sx={{ color: "rgba(255,255,255,.92)", fontSize: 13, fontWeight: 600, mt: 0.75 }}>
                  {buildDateRange(detail.trip)}
                </Typography>
              </Box>
            </Box>

            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "repeat(2, 1fr)", sm: "repeat(4, 1fr)" },
                backgroundColor: tokens.card,
              }}
            >
              <Box sx={{ p: "16px 24px", borderRight: "1px solid", borderBottom: { xs: "1px solid", sm: "none" }, borderColor: tokens.border }}>
                <Typography variant="labelCaps" sx={{ color: tokens.inkSoft, display: "block", mb: 0.75 }}>
                  {t("trips.timeline.statDuration")}
                </Typography>
                <Typography sx={{ fontSize: 21, fontWeight: 900, fontVariantNumeric: "tabular-nums", color: tokens.ink }}>
                  {formatMessage(t("trips.dashboard.dayCount"), { count: detail.trip.dayCount })}
                </Typography>
              </Box>
              <Box sx={{ p: "16px 24px", borderRight: { xs: "none", sm: "1px solid" }, borderBottom: { xs: "1px solid", sm: "none" }, borderColor: tokens.border }}>
                <Typography variant="labelCaps" sx={{ color: tokens.inkSoft, display: "block", mb: 0.75 }}>
                  {t("trips.timeline.statStations")}
                </Typography>
                <Typography sx={{ fontSize: 21, fontWeight: 900, fontVariantNumeric: "tabular-nums", color: tokens.ink }}>
                  {overviewMapData.points.length}
                </Typography>
              </Box>
              <Box
                component={Link}
                href={`/trips/${tripId}/costs`}
                aria-label={t("trips.costOverview.openAria")}
                sx={{
                  p: "16px 24px",
                  borderRight: "1px solid",
                  borderColor: tokens.border,
                  textDecoration: "none",
                  display: "block",
                }}
              >
                <Typography variant="labelCaps" sx={{ color: tokens.inkSoft, display: "block", mb: 0.75 }}>
                  {t("trips.timeline.costSummaryTitle")}
                </Typography>
                <Typography sx={{ fontSize: 21, fontWeight: 900, fontVariantNumeric: "tabular-nums", color: theme.palette.primary.main }}>
                  {formatCost(detail.trip.plannedCostTotal)}
                </Typography>
              </Box>
              <Box sx={{ p: "16px 24px" }}>
                <Typography variant="labelCaps" sx={{ color: tokens.inkSoft, display: "block", mb: 0.75 }}>
                  {t("trips.timeline.statOpenItems")}
                </Typography>
                <Typography
                  sx={{
                    fontSize: 21,
                    fontWeight: 900,
                    fontVariantNumeric: "tabular-nums",
                    color: openDaysCount > 0 ? theme.palette.warning.main : tokens.ink,
                  }}
                >
                  {openDaysCount}
                </Typography>
              </Box>
            </Box>
          </Box>

          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", md: "1.7fr 1fr" },
              gap: { xs: 2, md: 0 },
            }}
          >
            <Box sx={{ p: { xs: 0, md: "22px 28px 22px 0" } }}>
              <Typography variant="labelCaps" component="h5" sx={{ color: tokens.inkSoft, display: "block", mb: 1.5 }}>
                {t("trips.timeline.title")}
              </Typography>

              {listEmpty && (
                <Typography variant="body2" color="text.secondary">
                  {t("trips.timeline.empty")}
                </Typography>
              )}

              <Box component="ul" sx={{ listStyle: "none", p: 0, m: 0 }}>
              {!listEmpty &&
                detail.days.map((day, index) => {
                  const previousDay = index > 0 ? detail.days[index - 1] : null;
                  const ganttSegments = buildOverviewGanttSegments({
                    previousStay: previousDay?.accommodation
                      ? {
                          id: previousDay.accommodation.id,
                          checkOutTime: previousDay.accommodation.checkOutTime ?? null,
                        }
                      : null,
                    currentStay: day.accommodation
                      ? {
                          id: day.accommodation.id,
                          checkInTime: day.accommodation.checkInTime ?? null,
                          checkOutTime: day.accommodation.checkOutTime ?? null,
                        }
                      : null,
                    planItems: day.dayPlanItems.map((item) => ({
                      id: item.id,
                      fromTime: item.fromTime ?? null,
                      toTime: item.toTime ?? null,
                    })),
                    travelSegments: Array.isArray(day.travelSegments)
                      ? day.travelSegments.map((segment) => ({
                          id: segment.id,
                          fromItemType: segment.fromItemType,
                          fromItemId: segment.fromItemId,
                          durationMinutes: segment.durationMinutes,
                        }))
                      : [],
                  });
                  const ganttCoverage = deriveCoverageSummary(ganttSegments);
                  // A stay on record with no check-in/out times contributes no accommodation segment,
                  // which would otherwise hatch the whole bar and read as "structurally incomplete" on
                  // a day that actually has a booked place to sleep.
                  const stayLacksTimes =
                    !!day.accommodation && !day.accommodation.checkInTime && !day.accommodation.checkOutTime;
                  // Per AC2 / EXPERIENCE.md: a day with no accommodation shows one oversized gap rather
                  // than several slivers - the bar says "this day is structurally incomplete", not "some
                  // minutes are free". Gaps paint beneath real segments, so the span reads as a backdrop.
                  const gapSegments: TripDayGanttSegment[] = stayLacksTimes
                    ? []
                    : day.missingAccommodation && ganttCoverage.gaps.length > 0
                      ? [
                          {
                            startMinute: ganttCoverage.gaps[0].startMinute,
                            endMinute: ganttCoverage.gaps[ganttCoverage.gaps.length - 1].endMinute,
                            kind: "gap",
                          },
                        ]
                      : ganttCoverage.gaps.map((gap) => ({
                          startMinute: gap.startMinute,
                          endMinute: gap.endMinute,
                          kind: "gap" as const,
                        }));
                  const allSegments: TripDayGanttSegment[] = [...ganttSegments, ...gapSegments];
                  const plannedSummary = formatDurationSummary(ganttCoverage.plannedMinutes);
                  const unplannedSummary = formatDurationSummary(ganttCoverage.unplannedMinutes);
                  const ganttSummary = formatMessage(t("trips.dayView.ganttSummary"), {
                    planned: plannedSummary,
                    unplanned: unplannedSummary,
                  });
                  const isGap = day.missingAccommodation;
                  const subLabel = resolveStayLocationLabel(day);
                  const titleText =
                    day.note && day.note.trim().length > 0
                      ? `${formatMessage(t("trips.timeline.dayLabel"), { index: day.dayIndex })}: ${day.note.trim()}`
                      : formatMessage(t("trips.timeline.dayLabel"), { index: day.dayIndex });

                  return (
                    <Box
                      key={day.id}
                      component="li"
                      data-testid="timeline-day-card"
                      data-layout={isNarrowLayout ? "stacked" : "inline"}
                      sx={{
                        position: "relative",
                        display: "grid",
                        // The xs template must name every area the children use: without a "stay" row the
                        // stay/gap indicator resolves against non-existent grid lines and gets auto-placed
                        // into an implicit track, overflowing the row on narrow viewports.
                        gridTemplateColumns: { xs: "56px 1fr", sm: "72px 1fr 190px" },
                        gridTemplateAreas: {
                          xs: '"photo title" "stay stay" "cov cov"',
                          sm: '"photo title stay" "cov cov cov"',
                        },
                        alignItems: "center",
                        gap: "14px",
                        padding: "30px 14px 12px 14px",
                        border: "1px solid",
                        borderColor: isGap ? tokens.warnBorder : tokens.borderStrong,
                        borderRadius: "8px",
                        marginBottom: "8px",
                        backgroundColor: isGap ? DAY_ROW_GAP_BG : tokens.card,
                        // Keyboard-only focus: the row is outlined when its navigation link is focused,
                        // without also firing on plain mouse clicks the way :focus-within does.
                        "&:has(:focus-visible)": {
                          outline: `2px solid ${theme.palette.primary.main}`,
                          outlineOffset: 2,
                        },
                      }}
                    >
                      <Box
                        component={Link}
                        href={`/trips/${tripId}/days/${day.id}`}
                        aria-label={formatMessage(t("trips.timeline.openDayNamed"), { day: titleText })}
                        sx={{ position: "absolute", inset: 0, zIndex: 1, borderRadius: "8px" }}
                      />

                      <Box
                        component="img"
                        data-testid="day-row-photo"
                        src={resolveDayImageSrc(day.imageUrl, day.updatedAt) ?? "/images/world-map-placeholder.svg"}
                        alt=""
                        sx={{
                          gridArea: "photo",
                          width: { xs: 56, sm: 72 },
                          height: { xs: 56, sm: 72 },
                          objectFit: "cover",
                          objectPosition: "center",
                          borderRadius: 0,
                          flexShrink: 0,
                          position: "relative",
                        }}
                      />

                      <Box sx={{ gridArea: "title", display: "flex", flexDirection: "column", gap: 0.25, minWidth: 0, position: "relative" }}>
                        <Typography variant="labelCaps" sx={{ color: tokens.inkSoft }}>
                          <Box component="span" sx={{ color: theme.palette.primary.main }}>
                            {formatMessage(t("trips.timeline.dayLabel"), { index: day.dayIndex })}
                          </Box>{" "}
                          · {formatShortDate(day.date)}
                        </Typography>
                        <Typography variant="cardTitle" component="h6" sx={{ color: tokens.ink }}>
                          {titleText}
                        </Typography>
                        {subLabel ? (
                          <Typography variant="body2" sx={{ color: tokens.inkSoft }}>
                            {subLabel}
                          </Typography>
                        ) : null}
                        {day.missingPlan ? (
                          <Typography variant="body2" sx={{ color: theme.palette.warning.main, fontWeight: 700 }}>
                            {t("trips.timeline.missingPlan")}
                          </Typography>
                        ) : null}
                      </Box>

                      <Box
                        sx={{
                          gridArea: "stay",
                          position: "relative",
                          zIndex: 2,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: isGap ? "flex-start" : "flex-end",
                          gap: 0.75,
                          // This column paints above the full-row navigation link, so without letting
                          // clicks through, the chevron - the visible "open day" affordance - and the
                          // whole 190px column would be dead zones. Real controls opt back in.
                          pointerEvents: "none",
                          "& a, & button": { pointerEvents: "auto" },
                        }}
                      >
                        {isGap ? (
                          <Box
                            data-testid="day-row-gap-pill"
                            sx={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 0.75,
                              backgroundColor: tokens.warnBg,
                              color: theme.palette.warning.main,
                              px: 1.25,
                              py: 0.75,
                              borderRadius: "6px",
                              fontSize: "11.5px",
                              fontWeight: 700,
                            }}
                          >
                            <WarningTriangleIcon />
                            {t("trips.timeline.noAccommodation")}
                          </Box>
                        ) : day.accommodation ? (
                          <Box
                            component={day.accommodation.link ? "a" : "span"}
                            href={day.accommodation.link ?? undefined}
                            target={day.accommodation.link ? "_blank" : undefined}
                            rel={day.accommodation.link ? "noreferrer noopener" : undefined}
                            data-testid="day-row-stay"
                            sx={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 0.75,
                              color: theme.palette.primary.main,
                              fontSize: "11.5px",
                              fontWeight: 700,
                              textDecoration: "none",
                              minWidth: 0,
                            }}
                          >
                            <HouseIcon sx={{ flexShrink: 0 }} />
                            <Box component="span" sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {day.accommodation.name}
                            </Box>
                          </Box>
                        ) : null}
                        <ChevronRightIcon sx={{ color: tokens.inkMuted, flexShrink: 0 }} />
                      </Box>

                      <Box
                        sx={{
                          gridArea: "cov",
                          position: "relative",
                          zIndex: 2,
                          display: "flex",
                          flexDirection: "column",
                          gap: 0.5,
                          // Non-interactive, but painted above the row link - pass clicks through.
                          pointerEvents: "none",
                        }}
                      >
                        <TripDayGanttBar segments={allSegments} ariaLabel={t("trips.dayView.ganttAriaLabel")} variant="compact" />
                        <Typography variant="caption" sx={{ color: tokens.inkSoft }}>
                          {ganttSummary}
                        </Typography>
                      </Box>

                      <Box sx={{ position: "absolute", top: 6, right: 8, zIndex: 3 }}>
                        <TripFeedbackPanel
                          tripId={detail.trip.id}
                          feedback={day.feedback}
                          targetType="tripDay"
                          targetId={day.id}
                          currentUserId={detail.trip.currentUserId}
                          contextLabel={titleText}
                          onUpdated={(feedback) =>
                            setDetail((current) =>
                              current
                                ? {
                                    ...current,
                                    days: current.days.map((entry) => (entry.id === day.id ? { ...entry, feedback } : entry)),
                                  }
                                : current,
                            )
                          }
                        />
                      </Box>
                    </Box>
                  );
                })}
              </Box>
            </Box>

            <Box sx={{ p: { xs: 0, md: "22px 0 22px 22px" }, borderLeft: { xs: "none", md: "1px solid" }, borderColor: tokens.border }}>
              <Box sx={{ backgroundColor: tokens.card, border: "1px solid", borderColor: tokens.borderStrong, borderRadius: "8px", padding: "18px", mb: 2 }}>
                <Typography variant="labelCaps" component="h5" sx={{ color: tokens.inkSoft, display: "block", mb: 1.25 }}>
                  {t("trips.timeline.costSummaryTitle")}
                </Typography>
                <Typography variant="metricLg" sx={{ color: tokens.ink, fontVariantNumeric: "tabular-nums" }}>
                  {formatCost(detail.trip.plannedCostTotal)}
                </Typography>
                <Typography variant="body2" sx={{ color: tokens.inkSoft, mb: 1.5, display: "block" }}>
                  {t("trips.timeline.costSummarySubtitle")}
                </Typography>
                {/* Divider via :last-child so adding a third row (travel costs, once the schema carries
                    them) does not leave a trailing rule the way a per-row hardcode would. */}
                <Box sx={{ "& > div:last-child": { borderBottom: "none" } }}>
                  {[
                    { key: "accommodation", label: t("trips.timeline.costAccommodationLine"), value: accommodationCostTotal },
                    { key: "activities", label: t("trips.timeline.costActivitiesLine"), value: activitiesCostTotal },
                  ].map((row) => (
                    <Box
                      key={row.key}
                      sx={{
                        display: "flex",
                        justifyContent: "space-between",
                        py: 1,
                        borderBottom: "1px solid",
                        borderColor: tokens.border,
                      }}
                    >
                      <Typography sx={{ fontSize: "12.5px", fontWeight: 600, color: tokens.ink }}>{row.label}</Typography>
                      <Typography
                        sx={{ fontSize: "12.5px", color: tokens.ink, fontVariantNumeric: "tabular-nums", fontWeight: 700 }}
                      >
                        {formatCost(row.value)}
                      </Typography>
                    </Box>
                  ))}
                </Box>
              </Box>

              <TripOverviewMapPanel
                points={overviewMapData.points}
                missingLocations={overviewMapData.missingLocations}
                polylinePositions={overviewMapData.polylinePositions}
                expandHref={`/trips/${tripId}/map`}
              />

              {firstGapDay ? (
                <Box
                  sx={{
                    mt: 2,
                    border: "1px solid",
                    borderColor: tokens.warnBorder,
                    backgroundColor: tokens.warnBg,
                    borderRadius: "8px",
                    padding: "14px 16px",
                    display: "flex",
                    gap: 1.25,
                    alignItems: "flex-start",
                  }}
                >
                  <WarningTriangleIcon sx={{ color: theme.palette.warning.main, fontSize: 18, mt: "1px" }} />
                  <Box>
                    <Typography sx={{ fontSize: 13, fontWeight: 800, color: theme.palette.warning.main, mb: 0.5 }}>
                      {formatMessage(t("trips.timeline.gapAlertTitle"), { dayIndex: firstGapDay.dayIndex })}
                    </Typography>
                    <Typography sx={{ fontSize: "11.5px", color: tokens.ink, fontWeight: 500 }}>
                      {formatMessage(t("trips.timeline.gapAlertBody"), {
                        dayIndex: firstGapDay.dayIndex,
                        date: formatDate(firstGapDay.date),
                      })}
                    </Typography>
                  </Box>
                </Box>
              ) : null}
            </Box>
          </Box>

          {isOwner ? <TripBucketListPanel tripId={detail.trip.id} /> : null}

          <Paper
            elevation={1}
            sx={{
              p: 3,
              borderRadius: 3,
              background: "#ffffff",
            }}
          >
            <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
              {isOwner ? (
                <Button variant="outlined" onClick={() => setImportOpen(true)}>
                  {t("trips.import.action")}
                </Button>
              ) : null}
              <Button variant="outlined" onClick={handleExport}>
                {t("trips.export.action")}
              </Button>
              {canEditPlanning ? (
                <Button variant="outlined" onClick={() => setEditOpen(true)}>
                  {t("trips.edit.open")}
                </Button>
              ) : null}
              {isOwner ? (
                <Button variant="outlined" color="error" onClick={() => setDeleteOpen(true)}>
                  {t("trips.delete.open")}
                </Button>
              ) : null}
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
          <TripShareDialog open={shareOpen} tripId={detail.trip.id} onClose={() => setShareOpen(false)} />
          <TripImportDialog open={importOpen} tripId={detail.trip.id} onClose={() => setImportOpen(false)} onImported={handleImported} />
        </>
      )}
    </Box>
  );
}
