"use client";

import { Box, Chip, List, ListItem, Paper, Skeleton, Typography } from "@mui/material";
import dynamic from "next/dynamic";
import { useI18n } from "@/i18n/provider";

export type TripDayMapItemKind = "previousStay" | "planItem" | "currentStay";

export type TripDayMapItem = {
  id: string;
  label: string;
  kind: TripDayMapItemKind;
  location: { lat: number; lng: number } | null;
};

export type TripDayMapPoint = {
  id: string;
  label: string;
  kind: TripDayMapItemKind;
  position: [number, number];
  order: number;
};

export type TripDayMapPanelData = {
  points: TripDayMapPoint[];
  missingLocations: TripDayMapItem[];
};

export const buildDayMapPanelData = (params: {
  previousStay?: TripDayMapItem | null;
  planItems?: TripDayMapItem[];
  currentStay?: TripDayMapItem | null;
}): TripDayMapPanelData => {
  const ordered: TripDayMapItem[] = [];

  if (params.previousStay) ordered.push(params.previousStay);
  if (params.planItems) ordered.push(...params.planItems);
  if (params.currentStay) ordered.push(params.currentStay);

  const points: TripDayMapPoint[] = [];
  const missingLocations: TripDayMapItem[] = [];

  ordered.forEach((item, index) => {
    if (item.location) {
      points.push({
        id: item.id,
        label: item.label,
        kind: item.kind,
        position: [item.location.lat, item.location.lng],
        order: index,
      });
    } else {
      missingLocations.push(item);
    }
  });

  return { points, missingLocations };
};

const TripDayLeafletMap = dynamic(() => import("./TripDayLeafletMap"), { ssr: false });

type TripDayMapPanelProps = {
  points: TripDayMapPoint[];
  missingLocations: TripDayMapItem[];
  polylinePositions?: [number, number][];
  routingUnavailable?: boolean;
  loading?: boolean;
};

export default function TripDayMapPanel({
  points,
  missingLocations,
  polylinePositions,
  routingUnavailable = false,
  loading = false,
}: TripDayMapPanelProps) {
  const { t } = useI18n();

  return (
    <Paper elevation={0} sx={{ p: 2, borderRadius: 2, border: "1px solid", borderColor: "divider" }}>
      <Box display="flex" flexDirection="column" gap={2}>
        <Typography variant="subtitle1" fontWeight={600}>
          {t("trips.dayView.mapTitle")}
        </Typography>

        {loading ? (
          <Skeleton variant="rectangular" height={220} sx={{ borderRadius: 2 }} />
        ) : points.length === 0 ? (
          <Box
            sx={{
              minHeight: 220,
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
              {t("trips.dayView.mapEmptyTitle")}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t("trips.dayView.mapEmptyBody")}
            </Typography>
          </Box>
        ) : (
          <Box sx={{ borderRadius: 2, overflow: "hidden" }}>
            <TripDayLeafletMap points={points} polylinePositions={polylinePositions} />
          </Box>
        )}

        {routingUnavailable && (
          <Box display="flex" flexDirection="column" gap={0.5} data-testid="day-map-routing-unavailable">
            <Typography variant="body2" color="warning.main" fontWeight={600}>
              {t("trips.dayView.routingUnavailableTitle")}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {t("trips.dayView.routingUnavailableBody")}
            </Typography>
          </Box>
        )}

        {missingLocations.length > 0 && (
          <Box display="flex" flexDirection="column" gap={1}>
            <Typography variant="body2" fontWeight={600}>
              {t("trips.dayView.mapMissingTitle")}
            </Typography>
            <List dense sx={{ p: 0 }}>
              {missingLocations.map((item) => (
                <ListItem key={item.id} sx={{ px: 0, display: "flex", gap: 1 }}>
                  <Chip label={t("trips.dayView.mapMissingTag")} size="small" color="warning" />
                  <Typography variant="body2">{item.label}</Typography>
                </ListItem>
              ))}
            </List>
          </Box>
        )}
      </Box>
    </Paper>
  );
}
