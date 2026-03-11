"use client";

import { Alert, Box, Button, Chip, Dialog, DialogContent, DialogTitle, List, ListItem, Paper, Skeleton, Typography } from "@mui/material";
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

const FULL_PAGE_MAP_HEIGHT = "calc(100vh - 220px)";

export default function TripOverviewMapFullPage({ tripId }: TripOverviewMapFullPageProps) {
  const { t } = useI18n();
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
      <Paper elevation={1} sx={{ p: 3, borderRadius: 3, background: "#ffffff" }}>
        <Box display="flex" flexDirection="column" gap={2}>
          <Skeleton variant="text" width="40%" height={36} />
          <Skeleton variant="rectangular" height={FULL_PAGE_MAP_HEIGHT} sx={{ borderRadius: 2 }} />
        </Box>
      </Paper>
    );
  }

  if (notFound) {
    return (
      <Paper elevation={1} sx={{ p: 3, borderRadius: 3, background: "#ffffff" }}>
        <Typography variant="h6" fontWeight={600}>
          {t("trips.detail.notFoundTitle")}
        </Typography>
      </Paper>
    );
  }

  return (
    <Box display="flex" flexDirection="column" gap={3}>
      {error ? <Alert severity="error">{error}</Alert> : null}

      <Paper elevation={1} sx={{ p: 3, borderRadius: 3, background: "#ffffff" }}>
        <Box display="flex" flexDirection="column" gap={2}>
          <Box display="flex" flexDirection="column" gap={0.75}>
            <Typography variant="h5" fontWeight={700}>
              {t("trips.overviewMap.fullPageTitle")}
            </Typography>
            {detail ? (
              <Typography variant="body2" color="text.secondary">
                {detail.trip.name}
              </Typography>
            ) : null}
          </Box>

          {mapData.points.length === 0 ? (
            <Box
              sx={{
                minHeight: FULL_PAGE_MAP_HEIGHT,
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                alignItems: "center",
                borderRadius: 2,
                border: "1px dashed",
                borderColor: "divider",
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
          ) : (
            <Box sx={{ borderRadius: 2, overflow: "hidden" }}>
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
                    <Typography variant="body2">{item.label}</Typography>
                  </ListItem>
                ))}
              </List>
            </Box>
          ) : null}
        </Box>
      </Paper>

      <Dialog open={Boolean(mapDialogItem)} onClose={() => setMapDialogItem(null)} fullWidth maxWidth="sm">
        <DialogTitle>{mapDialogItem?.label ?? ""}</DialogTitle>
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
