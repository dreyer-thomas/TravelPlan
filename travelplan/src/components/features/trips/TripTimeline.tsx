"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Box, Button, Divider, Paper, Skeleton, Typography, useMediaQuery, useTheme } from "@mui/material";
import Link from "next/link";
import { useRouter } from "next/navigation";
import TripDeleteDialog from "@/components/features/trips/TripDeleteDialog";
import TripEditDialog, { type TripDetail as EditableTripDetail } from "@/components/features/trips/TripEditDialog";
import TripShareDialog from "@/components/features/trips/TripShareDialog";
import TripDayGanttBar from "@/components/features/trips/TripDayGanttBar";
import { buildOverviewGanttSegments } from "@/components/features/trips/TripDayGanttOverviewData";
import { deriveCoverageSummary, type TripDayGanttSegment } from "@/components/features/trips/TripDayGanttSegments";
import TripOverviewMapPanel from "@/components/features/trips/TripOverviewMapPanel";
import TripBucketListPanel from "@/components/features/trips/TripBucketListPanel";
import { buildTripOverviewMapData } from "@/components/features/trips/TripOverviewMapData";
import {
  ChevronRightIcon,
  HERO_SCRIM,
  HouseIcon,
  ON_PHOTO_CHROME,
  ShareGlyphIcon,
  WarningTriangleIcon,
  toCssUrl,
} from "@/components/features/trips/TripIcons";
import { withImageCacheBuster } from "@/lib/trips/imageUploads";
import type { TransportType } from "@/lib/trips/transportTypes";
import { useI18n } from "@/i18n/provider";
import { formatMessage } from "@/i18n";

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

type TripSummary = {
  id: string;
  name: string;
  accessRole?: "owner" | "viewer" | "contributor";
  startDate: string;
  endDate: string;
  dayCount: number;
  plannedCostTotal: number;
  accommodationCostTotalCents: number | null;
  heroImageUrl: string | null;
  /** Versions the hero URL; see `withImageCacheBuster`. Optional so an older cached payload still renders. */
  updatedAt?: string;
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
  } | null;
  dayPlanItems: {
    id: string;
    title?: string | null;
    fromTime?: string | null;
    toTime?: string | null;
    contentJson: string;
    linkUrl: string | null;
    location: { lat: number; lng: number; label: string | null } | null;
  }[];
  travelSegments?: {
    id: string;
    fromItemType: "accommodation" | "dayPlanItem";
    fromItemId: string;
    toItemType: "accommodation" | "dayPlanItem";
    toItemId: string;
    transportType: TransportType;
    durationMinutes: number;
    distanceKm: number | null;
    linkUrl: string | null;
  }[];
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
  const theme = useTheme();
  const tokens = theme.palette.tokens;
  const [detail, setDetail] = useState<TripDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const router = useRouter();
  const isNarrowLayout = useMediaQuery(theme.breakpoints.down("sm"));
  // The overview grid's own key (`gridTemplateColumns: { xs: "1fr", md: "1.7fr 1fr" }`), not a new
  // value: this decides *where* the single trip-controls card is mounted, and any other breakpoint
  // would open a window where the layout is stacked but the ordering is not.
  const isTwoColumnLayout = useMediaQuery(theme.breakpoints.up("md"));
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

  // The hero is versioned at *read* time, not just at upload time. The upload route replaces
  // `hero.<ext>` in place, so without a version the URL is byte-identical before and after and the
  // browser keeps serving whatever it already cached for that key - which is why a freshly uploaded
  // hero appeared, then vanished again the moment this component refetched on the next navigation.
  // The placeholder is a static asset and needs no version.
  const heroImageCss = detail
    ? toCssUrl(
        detail.trip.heroImageUrl
          ? withImageCacheBuster(detail.trip.heroImageUrl, detail.trip.updatedAt)
          : "/images/world-map-placeholder.svg",
      )
    : "none";
  const openDaysCount = detail?.days.filter((day) => day.missingAccommodation).length ?? 0;
  const firstGapDay = detail?.days.find((day) => day.missingAccommodation) ?? null;
  const accommodationCostTotal = detail?.trip.accommodationCostTotalCents ?? 0;
  const activitiesCostTotal = Math.max((detail?.trip.plannedCostTotal ?? 0) - accommodationCostTotal, 0);

  // One card, two possible parents - never two cards. Story 6.14: below `md` the grid stacks and DOM
  // order is visual order, so a card living inside the day column lands between the day list and the
  // sidebar's information. It has to move past the whole sidebar there, and a CSS `order` cannot do
  // that: it reorders siblings, and the card's siblings are the day rows, not the sidebar's cards.
  // So the element is built once here and mounted in exactly one of two positions (see the grid
  // below); duplicating it and hiding one copy would double Edit/Delete in the accessibility tree.
  // The guard travels with it - viewers get neither button, and a bare 18px-padded bordered card is
  // the defect Story 7.8 Task 5 fixed.
  const tripControlsCard =
    canEditPlanning || isOwner ? (
      <Box
        data-testid="trip-controls-card"
        sx={{
          backgroundColor: tokens.card,
          border: "1px solid",
          borderColor: tokens.borderStrong,
          borderRadius: "8px",
          padding: "18px",
        }}
      >
        <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
          {canEditPlanning ? (
            <Button variant="outlined" onClick={() => setEditOpen(true)}>
              {t("trips.edit.open")}
            </Button>
          ) : null}
          {isOwner ? (
            <Button variant="outlined" onClick={() => setDeleteOpen(true)}>
              {t("trips.delete.open")}
            </Button>
          ) : null}
        </Box>
      </Box>
    ) : null;

  return (
    <Box display="flex" flexDirection="column" gap={2}>
      {error && <Alert severity="error">{error}</Alert>}

      {/*
       * Story 6.20: when the load failed outright there is no trip to render, so this alert is the
       * whole page. It gets the same recovery button as the not-found panel above, for the same
       * reason that one keeps its own: the way back to all trips used to sit above this component as
       * a breadcrumb on the trip detail page, and hunting through the header menu is a poor thing to
       * ask of someone whose page did not load. A transient error over an already-rendered trip
       * (`detail` present) does not get one - the trip's own chrome is still there.
       */}
      {error && !detail && (
        <Button component={Link} href="/trips" variant="outlined" sx={{ alignSelf: "flex-start" }}>
          {t("trips.detail.back")}
        </Button>
      )}

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
                    sx={{ ...ON_PHOTO_CHROME, whiteSpace: "nowrap" }}
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
            data-testid="trip-overview-grid"
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", md: "1.7fr 1fr" },
              gap: { xs: 2, md: 0 },
            }}
          >
            <Box data-testid="trip-overview-main-column" sx={{ p: { xs: 0, md: "22px 28px 22px 0" } }}>
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
                        padding: "12px 14px",
                        border: "1px solid",
                        borderColor: isGap ? tokens.warnBorder : tokens.borderStrong,
                        borderRadius: "8px",
                        marginBottom: "8px",
                        backgroundColor: isGap ? tokens.warnBgRow : tokens.card,
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
                    </Box>
                  );
                })}
              </Box>

              {/* Two-column layout only: last block of the day column, so it lines up with the day
                  rows above it. The column's own padding sets the width - a `width`/`maxWidth`/
                  margin here would drift the moment the grid changes - and the rows already end
                  with their 8px `marginBottom`, this column's spacing rhythm, so a margin would
                  stack a second gap on top of it. Below `md` this position is empty and the same
                  element mounts after the side column instead. */}
              {isTwoColumnLayout ? tripControlsCard : null}
            </Box>

            <Box
              data-testid="trip-overview-side-column"
              sx={{ p: { xs: 0, md: "22px 0 22px 22px" }, borderLeft: { xs: "none", md: "1px solid" }, borderColor: tokens.border }}
            >
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

              {/* Third sidebar card, after the map panel. The panel brings its own card shell
                  (Story 7.8), so the wrapper carries spacing only - a bordered wrapper here would
                  double the edge. The side column has no flex gap: its rhythm is the sibling
                  `mb: 2` / `mt: 2` used by the cost card and the gap alert, so this joins that same
                  16px rule rather than introducing a second spacing scale. */}
              {isOwner ? (
                <Box sx={{ mt: 2 }}>
                  <TripBucketListPanel tripId={detail.trip.id} />
                </Box>
              ) : null}

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

            {/* Single-column layout only: a third grid child, after the side column, so the two
                actions nobody reaches for end the page instead of interrupting it. Staying inside
                the grid is deliberate - the card gets the grid's own `1fr` track and its own
                `gap: { xs: 2 }`, so it is width-constrained exactly the way the columns are
                (both carry `p: { xs: 0 }`) and needs no width, margin or wrapper of its own.
                Rendering it after the grid instead would reintroduce the loose full-width block
                Stories 7.12 and 6.10 removed. At `md` and above this position is empty, so nothing
                follows the side column and the desktop tree is exactly what Story 6.10 left. */}
            {isTwoColumnLayout ? null : tripControlsCard}
          </Box>
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
          <TripShareDialog
            open={shareOpen}
            tripId={detail.trip.id}
            tripName={detail.trip.name}
            onClose={() => setShareOpen(false)}
          />
        </>
      )}
    </Box>
  );
}
