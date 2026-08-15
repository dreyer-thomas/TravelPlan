"use client";

import { Alert, Box, Button, Chip, Dialog, DialogContent, List, ListItem, Skeleton, Typography, useTheme } from "@mui/material";
import { DialogTitleWithClose } from "@/components/ui/DialogCloseButton";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PlanItemRichContent, parsePlanText } from "@/components/features/trips/TripDayPlanItemContent";
import { buildTripOverviewMapData, type TripOverviewMapPoint } from "@/components/features/trips/TripOverviewMapData";
import { useI18n } from "@/i18n/provider";
import { formatMessage } from "@/i18n";

const TripOverviewLeafletMap = dynamic(() => import("./TripOverviewLeafletMap"), { ssr: false });

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
  accommodation: {
    id: string;
    name: string;
    notes: string | null;
    location: { lat: number; lng: number; label?: string | null } | null;
  } | null;
  dayPlanItems: {
    id: string;
    title: string | null;
    contentJson: string;
    location: { lat: number; lng: number; label?: string | null } | null;
  }[];
};

type TripDetail = {
  trip: TripSummary;
  days: TripDay[];
};

type TripOverviewMapFullPageProps = {
  tripId: string;
};

/**
 * DW-59. Per-file on purpose, not a shared export with `TripDayMapFullPage`: the two screens are
 * free to carry different chrome above the map, and a shared constant would silently be wrong on one
 * of them the moment they diverge. They happen to agree today.
 *
 * 331px is every band between the viewport top and the map at `md`, on a card with no
 * missing-locations list and no routing warning. Each one is traceable to its source:
 *
 *     73  AppHeader - `Toolbar sx={{ minHeight: 72 }}` plus the AppBar's 1px bottom border,
 *         `position="static"` so it is in flow, and no `MuiToolbar` override in `theme.ts`
 *     96  Container py={6}, both ends
 *     45  back button - `MuiButton.root` minHeight 44, paddingBlock 10 over a 24.5px line box
 *     24  gap={3} between the back button and the card
 *     38  card border (2) + padding (36)
 *     39  the caps label and its trip-name subline, gap={0.75} included
 *     16  gap={2} between that title block and the map
 *
 * The 220px this started at accounted for roughly the app shell and nothing else. Note the header
 * band only became removable once the page shell stopped carrying `minHeight: "100vh"` below it -
 * see the comment in `app/(routes)/trips/[id]/map/page.tsx`.
 *
 * This table previously read 66 for the header and totalled 324, which left the page scrolling by
 * the missing 7px - the exact defect DW-59 was filed about. Re-derive every band from source before
 * changing anything above the map, and prefer erring high: over-subtracting costs a few unused
 * pixels below the map, under-subtracting costs a scrollbar.
 *
 * The `max()` is a floor, not part of the fit, and it takes over well before the subtraction would
 * reach zero: `100vh - 331px < 240px` from a viewport of about 571px down. Below that the page
 * scrolls rather than handing Leaflet a container too short to be a map, which is the right trade
 * and the only case in which it is allowed to.
 */
const FULL_PAGE_MAP_HEIGHT = "max(240px, calc(100vh - 331px))";

export default function TripOverviewMapFullPage({ tripId }: TripOverviewMapFullPageProps) {
  const { t } = useI18n();
  const theme = useTheme();
  const tokens = theme.palette.tokens;
  // The shipped `card` treatment, identical to TripOverviewMapPanel.tsx and TripDayView.tsx's cardSx.
  // A Box, not a Paper: theme.ts stamps a non-token 1px border on every MuiPaper, which would layer
  // over borderStrong.
  const cardSx = {
    backgroundColor: tokens.card,
    border: "1px solid",
    borderColor: tokens.borderStrong,
    borderRadius: "8px",
    padding: "18px",
  } as const;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [detail, setDetail] = useState<TripDetail | null>(null);
  const [mapDialogItem, setMapDialogItem] = useState<TripOverviewMapPoint | null>(null);

  const loadTrip = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotFound(false);

    try {
      const response = await fetch(`/api/trips/${tripId}`, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });
      const body = (await response.json()) as ApiEnvelope<TripDetail>;

      if (response.status === 404 || body.error?.code === "not_found") {
        setNotFound(true);
        setDetail(null);
        return;
      }

      if (!response.ok || body.error || !body.data) {
        setError(t("trips.dayView.loadError"));
        setDetail(null);
        return;
      }

      setDetail(body.data);
    } catch {
      setError(t("trips.dayView.loadError"));
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [t, tripId]);

  useEffect(() => {
    void loadTrip();
  }, [loadTrip]);

  const mapData = useMemo(() => {
    if (!detail) {
      return { points: [], missingLocations: [], polylinePositions: [] };
    }

    return buildTripOverviewMapData({
      tripId,
      days: detail.days,
      getDayLabel: (index) => formatMessage(t("trips.timeline.dayLabel"), { index }),
      getPlanItemFallbackLabel: (index) => formatMessage(t("trips.plan.previewFallback"), { index }),
    });
  }, [detail, t, tripId]);

  if (loading) {
    return (
      <Box sx={cardSx}>
        <Box display="flex" flexDirection="column" gap={2}>
          {/* The real label, not a text skeleton: the preview panels render their title during load
              and skeleton only the map, and a placeholder bar sized for the retired h5 title would
              jump on settle. It also keeps the screen from having no heading at all while loading. */}
          <Typography variant="labelCaps" component="h1" sx={{ color: tokens.inkSoft }}>
            {t("trips.overviewMap.title")}
          </Typography>
          <Skeleton variant="rectangular" height={FULL_PAGE_MAP_HEIGHT} sx={{ borderRadius: "6px" }} />
        </Box>
      </Box>
    );
  }

  if (notFound) {
    return (
      <Box sx={cardSx}>
        <Typography variant="heading" component="h1" sx={{ color: tokens.ink }}>
          {t("trips.detail.notFoundTitle")}
        </Typography>
      </Box>
    );
  }

  return (
    <Box display="flex" flexDirection="column" gap={3}>
      {error ? <Alert severity="error">{error}</Alert> : null}

      <Box sx={cardSx}>
        <Box display="flex" flexDirection="column" gap={2}>
          <Box display="flex" flexDirection="column" gap={0.75}>
            {/* component= is mandatory: the custom labelCaps variant has no variantMapping entry, so
                it renders a <span> otherwise. h1 because neither map screen has a page title - the
                card label is this screen's only heading. */}
            <Typography variant="labelCaps" component="h1" sx={{ color: tokens.inkSoft }}>
              {t("trips.overviewMap.title")}
            </Typography>
            {/* Kept: the only element on the page that names the trip, which matters on a screen
                reachable by direct URL. Set to the panel-caption rhythm so it reads as a subline
                under the caps label rather than competing with it. */}
            {detail ? (
              <Typography sx={{ fontSize: "11.5px", fontWeight: 600, color: tokens.inkSoft }}>
                {detail.trip.name}
              </Typography>
            ) : null}
          </Box>

          {/* DW-56: an empty `points` array beside a failed load is not an empty trip. Without the
              guard the alert above and a "no mapped places yet" panel below contradict each other,
              and the reader has to guess which one is telling the truth. Note the shape: the ledger
              prescribed `points.length === 0 && !error` on the condition, but that falls through to
              the *map* arm on a failed load and hands Leaflet an empty bounds it cannot fit. The
              no-points branch has to resolve to nothing instead - the same nesting the two preview
              panels use for the same rule. */}
          {mapData.points.length === 0 ? (
            error ? null : (
              <Box
                sx={{
                  minHeight: FULL_PAGE_MAP_HEIGHT,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "center",
                  alignItems: "center",
                  borderRadius: "6px",
                  border: "1px dashed",
                  borderColor: tokens.border,
                  px: 2,
                  textAlign: "center",
                  gap: 1,
                }}
              >
                <Typography variant="body1" fontWeight={600}>
                  {t("trips.overviewMap.emptyTitle")}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {t("trips.overviewMap.emptyBody")}
                </Typography>
              </Box>
            )
          ) : (
            <Box sx={{ borderRadius: "6px", overflow: "hidden" }}>
              <TripOverviewLeafletMap
                points={mapData.points}
                polylinePositions={mapData.polylinePositions}
                height={FULL_PAGE_MAP_HEIGHT}
                onMarkerClick={setMapDialogItem}
              />
            </Box>
          )}

          {mapData.missingLocations.length > 0 ? (
            <Box display="flex" flexDirection="column" gap={1}>
              <Typography variant="body2" fontWeight={600}>
                {t("trips.overviewMap.missingTitle")}
              </Typography>
              <List dense sx={{ p: 0 }}>
                {mapData.missingLocations.map((item) => (
                  <ListItem key={item.id} sx={{ px: 0, display: "flex", gap: 1 }}>
                    <Chip label={t("trips.overviewMap.missingTag")} size="small" color="warning" />
                    <Typography
                      component={Link}
                      href={item.href}
                      variant="body2"
                      sx={{
                        color: "primary.main",
                        textDecoration: "underline",
                        textUnderlineOffset: "2px",
                        "&:hover": { color: "primary.dark" },
                      }}
                    >
                      {item.label}
                    </Typography>
                  </ListItem>
                ))}
              </List>
            </Box>
          ) : null}
        </Box>
      </Box>

      <Dialog open={Boolean(mapDialogItem)} onClose={() => setMapDialogItem(null)} fullWidth maxWidth="sm">
        {/* Story 6.25 AC1 — as in `TripDayMapFullPage`: a read-only popup whose only dismissals were
            the backdrop and Escape now carries the same `✕` as every other dialog. */}
        <DialogTitleWithClose label={t("common.close")} onClose={() => setMapDialogItem(null)}>
          {mapDialogItem?.label ?? ""}
        </DialogTitleWithClose>
        <DialogContent>
          {mapDialogItem ? (
            <Box display="flex" flexDirection="column" gap={1.5}>
              <Chip
                label={
                  mapDialogItem.kind === "accommodation"
                    ? t("trips.overviewMap.popupStay")
                    : t("trips.overviewMap.popupPlanItem")
                }
                size="small"
                sx={{ alignSelf: "flex-start" }}
              />
              {mapDialogItem.kind === "accommodation" ? (
                mapDialogItem.notes ? (
                  <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                    {mapDialogItem.notes}
                  </Typography>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    {t("trips.overviewMap.popupNoNotes")}
                  </Typography>
                )
              ) : (
                <PlanItemRichContent
                  contentJson={mapDialogItem.contentJson ?? ""}
                  fallbackText={parsePlanText(mapDialogItem.contentJson ?? "") || mapDialogItem.label}
                />
              )}
              <Button
                component={Link}
                href={mapDialogItem.href}
                variant="text"
                size="small"
                sx={{ alignSelf: "flex-start", px: 0, minWidth: "auto", textTransform: "none" }}
              >
                {t("trips.overviewMap.openLinkedItem")}
              </Button>
            </Box>
          ) : null}
        </DialogContent>
      </Dialog>
    </Box>
  );
}
