"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Box, Button, Skeleton, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import Link from "next/link";
import TripCreateDialog from "@/components/features/trips/TripCreateDialog";
import { type TripCreateResponse } from "@/components/features/trips/TripCreateForm";
import {
  CalendarIcon,
  CheckIcon,
  ChevronRightIcon,
  ClockIcon,
  NEUTRAL_PILL_BG,
  PlusIcon,
  ROW_GAP_BG,
  WarningTriangleIcon,
} from "@/components/features/trips/TripIcons";
import { withImageCacheBuster } from "@/lib/trips/imageUploads";
import { formatCost } from "@/lib/trips/formatCost";
import { deriveTripStatus, startOfTodayUtc, type TripStatus } from "@/lib/trips/tripStatus";
import { useI18n } from "@/i18n/provider";
import { formatMessage } from "@/i18n";

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
  heroImageUrl: string | null;
  /** Versions the hero URL; see `withImageCacheBuster`. Optional so an older cached payload still renders. */
  updatedAt?: string;
  /** Days with no accommodation, or one whose name is blank. Feeds the gap pill and the stat strip. */
  openDayCount: number;
  planItemCount: number;
  /** Cents, matching the trip-overview figure for the same trip. */
  plannedCostTotal: number;
  startLocationLabel?: string | null;
  destinationLocationLabel?: string | null;
};

/**
 * Non-past trips first in ascending start order, past trips last in descending order.
 *
 * This is what Screen C depicts - its May-2026 row sits below the September/December ones - and it
 * follows from AC3's archival framing: a finished trip is a logbook entry, not a to-do. Applied
 * client-side because it depends on "today"; the repository's `orderBy` stays ascending.
 */
const buildTripComparator = (todayUtc: Date) => (a: TripSummary, b: TripSummary) => {
  const aPast = deriveTripStatus(a, todayUtc) === "past";
  const bPast = deriveTripStatus(b, todayUtc) === "past";
  if (aPast !== bPast) return aPast ? 1 : -1;
  const delta = new Date(a.startDate).getTime() - new Date(b.startDate).getTime();
  return aPast ? -delta : delta;
};

export default function TripsDashboard() {
  const { language, t } = useI18n();
  const theme = useTheme();
  const tokens = theme.palette.tokens;
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  // Computed once for the whole render, not per row. Held in state rather than a bare `useMemo` so
  // it can be refreshed: a memo with an empty dep array pins "today" to mount time, and a dashboard
  // left open across midnight would keep stale pills, a stale cost label and a stale sort order even
  // after a refetch. Derived on the client because it depends on the viewer's clock and timezone -
  // computing it server-side would mean a hydration mismatch and a value baked into the response.
  const [todayUtc, setTodayUtc] = useState(() => startOfTodayUtc(new Date()));

  useEffect(() => {
    // Re-check whenever the tab comes back to the foreground. That covers the overnight case without
    // an interval, and `setTodayUtc` keeps the previous object when the day has not turned, so the
    // identity stays stable and the memos below do not churn.
    const syncToday = () => {
      const next = startOfTodayUtc(new Date());
      setTodayUtc((current) => (current.getTime() === next.getTime() ? current : next));
    };

    document.addEventListener("visibilitychange", syncToday);
    window.addEventListener("focus", syncToday);
    return () => {
      document.removeEventListener("visibilitychange", syncToday);
      window.removeEventListener("focus", syncToday);
    };
  }, []);

  const loadTrips = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/trips", { method: "GET" });
      const body = (await response.json()) as ApiEnvelope<{ trips: TripSummary[] }>;

      if (!response.ok || body.error) {
        setError(body.error?.message ?? t("trips.dashboard.loadError"));
        setTrips([]);
        return;
      }

      setTrips([...(body.data?.trips ?? [])].sort(buildTripComparator(todayUtc)));
    } catch {
      setError(t("trips.dashboard.loadError"));
      setTrips([]);
    } finally {
      setLoading(false);
    }
  }, [todayUtc]);

  useEffect(() => {
    loadTrips();
  }, [loadTrips]);

  const listEmpty = useMemo(() => !loading && trips.length === 0 && !error, [loading, trips.length, error]);
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
  const handleTripCreated = useCallback(
    (response: TripCreateResponse) => {
      const summary: TripSummary = {
        id: response.trip.id,
        name: response.trip.name,
        startDate: response.trip.startDate,
        endDate: response.trip.endDate,
        dayCount: response.dayCount,
        heroImageUrl: response.trip.heroImageUrl ?? null,
        updatedAt: response.trip.updatedAt,
        // POST does not return the derived fields, so they are reconstructed here: a fresh trip has
        // every day open and nothing planned, which derives to `upcoming` rather than a warn row.
        openDayCount: response.dayCount,
        planItemCount: 0,
        plannedCostTotal: 0,
        startLocationLabel: response.trip.startLocation?.label ?? null,
        destinationLocationLabel: response.trip.destinationLocation?.label ?? null,
      };
      setTrips((current) =>
        [summary, ...current.filter((trip) => trip.id !== summary.id)].sort(buildTripComparator(todayUtc)),
      );
    },
    [todayUtc],
  );
  const handleOpenCreate = useCallback(() => {
    setCreateOpen(true);
  }, []);
  const handleCloseCreate = useCallback(() => {
    setCreateOpen(false);
  }, []);

  const statuses = useMemo(
    () => new Map(trips.map((trip) => [trip.id, deriveTripStatus(trip, todayUtc)] as const)),
    [trips, todayUtc],
  );
  const activeTrips = useMemo(() => trips.filter((trip) => statuses.get(trip.id) !== "past"), [trips, statuses]);
  const totalCost = useMemo(() => trips.reduce((sum, trip) => sum + trip.plannedCostTotal, 0), [trips]);
  const gapTrips = useMemo(
    () => activeTrips.filter((trip) => statuses.get(trip.id) === "gap"),
    [activeTrips, statuses],
  );
  // Counted over `gap` trips only, the same population the sub-line beside it reports. Past trips
  // are out because a finished trip's missing accommodation is not actionable (AC3 frames those rows
  // as archival), and `upcoming` trips are out because their days are open by definition - counting
  // them would turn this cell warn-orange the moment any future trip is created, re-introducing one
  // level up exactly what the status ladder exists to prevent. The two numbers still measure
  // different things - days here, trips in the sub-line - but now over the same set of trips.
  const openItems = useMemo(() => gapTrips.reduce((sum, trip) => sum + trip.openDayCount, 0), [gapTrips]);

  const hasData = !loading && !error;
  const subline = formatMessage(
    t(trips.length === 1 ? "trips.dashboard.sublineOne" : "trips.dashboard.subline"),
    { tripCount: trips.length, gapTripCount: gapTrips.length },
  );

  const statusPill = (trip: TripSummary, status: TripStatus) => {
    const treatment = {
      gap: {
        color: theme.palette.warning.main,
        backgroundColor: tokens.warnBg,
        icon: <WarningTriangleIcon sx={{ fontSize: 13 }} />,
        label:
          trip.openDayCount === 1
            ? t("trips.dashboard.statusGapOne")
            : formatMessage(t("trips.dashboard.statusGap"), { count: trip.openDayCount }),
      },
      planned: {
        color: theme.palette.primary.main,
        backgroundColor: tokens.accentSoft,
        icon: <CheckIcon />,
        label: t("trips.dashboard.statusPlanned"),
      },
      upcoming: {
        color: tokens.inkSoft,
        backgroundColor: NEUTRAL_PILL_BG,
        icon: <ClockIcon />,
        label: t("trips.dashboard.statusUpcoming"),
      },
      past: {
        color: tokens.inkSoft,
        backgroundColor: NEUTRAL_PILL_BG,
        icon: <CalendarIcon />,
        label: t("trips.dashboard.statusPast"),
      },
    }[status];

    return (
      <Box
        data-testid="trip-row-status"
        data-status={status}
        sx={{
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
          padding: "6px 10px",
          borderRadius: "6px",
          fontSize: "11.5px",
          fontWeight: 700,
          whiteSpace: "nowrap",
          color: treatment.color,
          backgroundColor: treatment.backgroundColor,
        }}
      >
        {treatment.icon}
        {treatment.label}
      </Box>
    );
  };

  // `value` is only rendered once the fetch has settled. While loading it is a skeleton, and after a
  // failure an em dash: the numbers derive from `trips`, which is empty in both cases, so printing
  // them would state "no trips, no cost, nothing open" as fact - most damagingly right next to a
  // banner saying the data could not be loaded.
  const statCell = (testId: string, label: string, value: string, color: string, isLast = false) => (
    <Box
      data-testid={testId}
      sx={{
        p: { xs: "16px", md: "16px 24px" },
        borderRight: { xs: "none", md: isLast ? "none" : "1px solid" },
        borderBottom: { xs: isLast ? "none" : "1px solid", md: "none" },
        borderColor: tokens.border,
      }}
    >
      <Typography variant="labelCaps" sx={{ color: tokens.inkSoft, display: "block", mb: 0.75 }}>
        {label}
      </Typography>
      <Typography
        component="div"
        sx={{ fontSize: 21, fontWeight: 900, fontVariantNumeric: "tabular-nums", color: hasData ? color : tokens.inkSoft }}
      >
        {loading ? <Skeleton variant="text" width="3.5ch" sx={{ fontSize: 21 }} /> : hasData ? value : "—"}
      </Typography>
    </Box>
  );

  return (
    <Box display="flex" flexDirection="column">
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "20px",
          flexWrap: "wrap",
          // Aligned with the trip rows' content rather than the mockup's literal 32px: the rows sit
          // inside the page `Container`'s gutter plus their own padding, so a flat 32px here would
          // indent the page title further right than the trip names it sits above.
          padding: { xs: "22px 16px", md: "22px 24px" },
          borderBottom: "1px solid",
          borderColor: tokens.border,
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="kicker" sx={{ color: theme.palette.primary.main, display: "block", mb: 0.75 }}>
            {t("trips.page.title")}
          </Typography>
          {/* The mockup greets the user by name; `User` has no name field and deriving one from the
              email local-part would present a guess as a fact. The existing dashboard title stands in. */}
          <Typography variant="display" component="h1" sx={{ color: tokens.ink, mb: 0.75 }}>
            {t("trips.dashboard.title")}
          </Typography>
          {/* Same rule as the stat cells: the counts come from `trips`, so they are only stated once
              the fetch has settled. */}
          {loading ? (
            <Skeleton variant="text" width={190} sx={{ fontSize: 13 }} />
          ) : (
            hasData && (
              <Typography sx={{ fontSize: 13, fontWeight: 600, color: tokens.inkSoft }}>{subline}</Typography>
            )
          )}
        </Box>
        <Button
          variant="contained"
          onClick={handleOpenCreate}
          startIcon={<PlusIcon />}
          // MUI's `ButtonStartIcon` sets `& > *:nth-of-type(1) { font-size: 20px }` at a higher
          // specificity than the `sx` on the icon itself, so the glyph has to be sized from here to
          // reach the mockup's 15px.
          sx={{ "& .MuiButton-startIcon > *:nth-of-type(1)": { fontSize: 15 } }}
        >
          {t("trips.dashboard.addTrip")}
        </Button>
      </Box>

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "repeat(1, 1fr)", md: "repeat(3, 1fr)" },
          backgroundColor: tokens.card,
          borderBottom: "1px solid",
          borderColor: tokens.border,
        }}
      >
        {statCell("stat-active-trips", t("trips.dashboard.statActiveTrips"), String(activeTrips.length), tokens.ink)}
        {statCell(
          "stat-total-cost",
          t("trips.dashboard.statTotalCost"),
          formatCost(totalCost, language),
          theme.palette.primary.main,
        )}
        {statCell(
          "stat-open-items",
          t("trips.dashboard.statOpenItems"),
          String(openItems),
          openItems > 0 ? theme.palette.warning.main : tokens.ink,
          true,
        )}
      </Box>

      <Box sx={{ padding: { xs: "22px 0 0", md: "22px 8px 0" }, display: "flex", flexDirection: "column", gap: 2 }}>
        {error && <Alert severity="error">{error}</Alert>}

        {loading && (
          // A silhouette of the real row rather than a spinner (EXPERIENCE.md, "Cold load").
          <Box>
            {[0, 1, 2].map((index) => (
              <Box
                key={index}
                data-testid="trip-row-skeleton"
                sx={{
                  display: "grid",
                  gridTemplateColumns: { xs: "72px 1fr", md: "96px 1fr auto 150px" },
                  alignItems: "center",
                  gap: "16px",
                  padding: "14px 16px",
                  border: "1px solid",
                  borderColor: tokens.borderStrong,
                  borderRadius: "8px",
                  marginBottom: "10px",
                  backgroundColor: tokens.card,
                }}
              >
                <Skeleton variant="rectangular" sx={{ width: { xs: 72, md: 96 }, height: { xs: 72, md: 96 } }} />
                <Box>
                  <Skeleton variant="text" width="55%" height={22} />
                  <Skeleton variant="text" width="75%" height={18} />
                </Box>
                <Skeleton variant="rounded" width={140} height={28} sx={{ display: { xs: "none", md: "block" } }} />
                <Skeleton variant="text" width={110} height={26} sx={{ display: { xs: "none", md: "block" } }} />
              </Box>
            ))}
          </Box>
        )}

        {listEmpty && (
          <Box
            sx={{
              backgroundColor: tokens.card,
              border: "1px solid",
              borderColor: tokens.borderStrong,
              borderRadius: "8px",
              padding: "18px",
              display: "flex",
              flexDirection: "column",
              gap: 1.5,
              alignItems: "flex-start",
            }}
          >
            <Typography variant="body1" sx={{ color: tokens.inkSoft }}>
              {t("trips.dashboard.empty")}
            </Typography>
            <Button variant="outlined" onClick={handleOpenCreate}>
              {t("trips.dashboard.addTrip")}
            </Button>
          </Box>
        )}

        {!loading && trips.length > 0 && (
          // `role="list"` is not redundant: Safari/VoiceOver drops the implicit list role once
          // `list-style: none` is applied, and `display: grid` on the rows below removes the
          // implicit `list-item` display in every engine.
          <Box component="ul" role="list" sx={{ listStyle: "none", p: 0, m: 0 }}>
            {trips.map((trip) => {
              const status = statuses.get(trip.id) ?? "planned";
              const isGap = status === "gap";
              const isPast = status === "past";
              const route =
                trip.startLocationLabel?.trim() && trip.destinationLocationLabel?.trim()
                  ? ` · ${trip.startLocationLabel.trim()} → ${trip.destinationLocationLabel.trim()}`
                  : "";

              return (
                <Box
                  key={trip.id}
                  component="li"
                  role="listitem"
                  data-testid="trip-row"
                  data-status={status}
                  sx={{
                    position: "relative",
                    display: "grid",
                    // Both templates must name every area the children use: an unnamed area resolves
                    // against non-existent grid lines, gets auto-placed into an implicit track, and
                    // overflows the row on narrow viewports.
                    //
                    // The four-column template waits for `md`, not `sm`: its fixed tracks and gaps
                    // need ~750px, so at the 600px `sm` boundary they would leave the `1fr` title
                    // column around 30px and ellipse every trip name to two characters. The status
                    // track is `auto` rather than a fixed 190px because the German `upcoming` label
                    // ("Bevorstehend · Planung offen") is wider than that and, being `nowrap`, would
                    // otherwise spill its pill background back across the trip name.
                    gridTemplateColumns: { xs: "72px 1fr", md: "96px 1fr auto 150px" },
                    gridTemplateAreas: {
                      xs: '"photo title" "status status" "cost cost"',
                      md: '"photo title status cost"',
                    },
                    alignItems: "center",
                    gap: "16px",
                    padding: "14px 16px",
                    border: "1px solid",
                    borderColor: isGap ? tokens.warnBorder : tokens.borderStrong,
                    borderRadius: "8px",
                    marginBottom: "10px",
                    backgroundColor: isGap ? ROW_GAP_BG : tokens.card,
                    // DESIGN.md is explicit that opacity is the whole treatment for a past row - the
                    // text is not additionally greyed and the border is not dropped.
                    opacity: isPast ? 0.78 : 1,
                    // The whole row is a click target, so it needs a pointer affordance of its own -
                    // EXPERIENCE.md leaves hover unspecified and asks implementations to author it
                    // from the accent/border tokens. Border-only, so a gap row keeps its warn fill
                    // and a past row keeps reading as archival.
                    transition: theme.transitions.create(["border-color", "background-color"], {
                      duration: theme.transitions.duration.shortest,
                    }),
                    "@media (hover: hover)": {
                      "&:hover": {
                        borderColor: isGap ? tokens.warnBorder : theme.palette.primary.main,
                        backgroundColor: isGap ? ROW_GAP_BG : tokens.cardAlt,
                      },
                    },
                    "&:has(:focus-visible)": {
                      outline: `2px solid ${theme.palette.primary.main}`,
                      outlineOffset: 2,
                    },
                  }}
                >
                  <Box
                    component={Link}
                    href={`/trips/${trip.id}`}
                    aria-label={formatMessage(t("trips.dashboard.openTripAria"), { trip: trip.name })}
                    sx={{ position: "absolute", inset: 0, zIndex: 1, borderRadius: "8px" }}
                  />

                  <Box
                    component="img"
                    data-testid="trip-row-photo"
                    src={
                      // Versioned at read time - `hero.<ext>` is replaced in place, so an
                      // unversioned URL keeps serving the browser's stale copy. Placeholder is
                      // a static asset and needs none.
                      trip.heroImageUrl
                        ? withImageCacheBuster(trip.heroImageUrl, trip.updatedAt)
                        : "/images/world-map-placeholder.svg"
                    }
                    // Decorative: the adjacent title names the same trip (DESIGN.md, "Photo Alt-Text").
                    alt=""
                    // Intrinsic size so the row does not reflow as heroes arrive; the `sx` width and
                    // height still drive the rendered box.
                    width={96}
                    height={96}
                    loading="lazy"
                    sx={{
                      gridArea: "photo",
                      width: { xs: 72, md: 96 },
                      height: { xs: 72, md: 96 },
                      objectFit: "cover",
                      objectPosition: "center",
                      borderRadius: 0,
                      border: "1px solid rgba(0,0,0,0.06)",
                      // A neutral tile behind the image: the placeholder only covers a null
                      // `heroImageUrl`, so a non-null URL whose file has gone would otherwise leave
                      // a bare broken-image glyph in a cell with no alt text to fall back on.
                      backgroundColor: "rgba(0,0,0,0.04)",
                      flexShrink: 0,
                      position: "relative",
                    }}
                  />

                  <Box sx={{ gridArea: "title", minWidth: 0, position: "relative" }}>
                    <Typography
                      variant="cardTitle"
                      component="h2"
                      sx={{
                        fontSize: 16,
                        fontWeight: 800,
                        color: tokens.ink,
                        mb: 0.5,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {trip.name}
                    </Typography>
                    <Typography
                      sx={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: tokens.inkSoft,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {`${buildDateRange(trip)} · ${formatMessage(t("trips.dashboard.dayCount"), {
                        count: trip.dayCount,
                      })}${route}`}
                    </Typography>
                  </Box>

                  <Box
                    sx={{
                      gridArea: "status",
                      position: "relative",
                      zIndex: 2,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: { xs: "flex-start", md: "flex-end" },
                      minWidth: 0,
                      // This column paints above the full-row link, so it has to let clicks through
                      // or it becomes a dead zone. Real controls opt back in.
                      pointerEvents: "none",
                      "& a, & button": { pointerEvents: "auto" },
                    }}
                  >
                    {statusPill(trip, status)}
                  </Box>

                  <Box
                    sx={{
                      gridArea: "cost",
                      position: "relative",
                      zIndex: 2,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "flex-end",
                      gap: 1,
                      pointerEvents: "none",
                      "& a, & button": { pointerEvents: "auto" },
                    }}
                  >
                    <Box sx={{ textAlign: "right", minWidth: 0 }}>
                      <Typography
                        sx={{
                          fontSize: 10,
                          fontWeight: 700,
                          letterSpacing: "0.06em",
                          textTransform: "uppercase",
                          color: tokens.inkSoft,
                          mb: "3px",
                        }}
                      >
                        {/* A finished trip's running total is final, so the label changes with it. */}
                        {isPast ? t("trips.dashboard.costTotal") : t("trips.dashboard.costSoFar")}
                      </Typography>
                      <Typography
                        sx={{
                          fontSize: 16.5,
                          fontWeight: 900,
                          fontVariantNumeric: "tabular-nums",
                          color: tokens.ink,
                        }}
                      >
                        {formatCost(trip.plannedCostTotal, language)}
                      </Typography>
                    </Box>
                    {/* Not in the mockup, but the row is a click-through and Story 7.2 established
                        the chevron as this system's "opens something" affordance. */}
                    <ChevronRightIcon sx={{ color: tokens.inkMuted, flexShrink: 0 }} />
                  </Box>
                </Box>
              );
            })}
          </Box>
        )}
      </Box>

      <TripCreateDialog open={createOpen} onClose={handleCloseCreate} onCreated={handleTripCreated} />
    </Box>
  );
}
