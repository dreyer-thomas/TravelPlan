"use client";

import { Box, Chip, List, ListItem, Paper, Skeleton, Typography } from "@mui/material";
import { MapContainer, Marker, Polyline, TileLayer, useMap } from "react-leaflet";
import { useEffect, useMemo } from "react";
import L from "leaflet";
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

const FitToBounds = ({ points }: { points: TripDayMapPoint[] }) => {
  const map = useMap();

  useEffect(() => {
    if (points.length === 0) return;
    const bounds = L.latLngBounds(points.map((point) => point.position));
    map.fitBounds(bounds, { padding: [24, 24] });
  }, [map, points]);

  return null;
};

type TripDayMapPanelProps = {
  points: TripDayMapPoint[];
  missingLocations: TripDayMapItem[];
  loading?: boolean;
};

export default function TripDayMapPanel({ points, missingLocations, loading = false }: TripDayMapPanelProps) {
  const { t } = useI18n();
  const center = useMemo<[number, number]>(() => points[0]?.position ?? [0, 0], [points]);
  const polylinePositions = useMemo(() => points.map((point) => point.position), [points]);

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
            <MapContainer center={center} zoom={12} style={{ height: 220, width: "100%" }} scrollWheelZoom={false}>
              <TileLayer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution="&copy; OpenStreetMap contributors"
              />
              {points.map((point, index) => (
                <Marker
                  key={point.id}
                  position={point.position}
                  data-testid={`day-map-marker-${index}`}
                />
              ))}
              {polylinePositions.length >= 2 && (
                <Polyline positions={polylinePositions} data-testid="day-map-polyline" />
              )}
              <FitToBounds points={points} />
            </MapContainer>
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
