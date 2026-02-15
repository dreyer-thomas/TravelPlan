"use client";

import { Box, Chip, List, ListItem, Paper, Typography } from "@mui/material";
import dynamic from "next/dynamic";
import { useMemo } from "react";
import Link from "next/link";
import { useI18n } from "@/i18n/provider";

export type TripOverviewMapPoint = {
  id: string;
  label: string;
  position: [number, number];
};

export type TripOverviewMissingLocation = {
  id: string;
  label: string;
  href: string;
};

const MapContainer = dynamic(async () => (await import("react-leaflet")).MapContainer, { ssr: false });
const TileLayer = dynamic(async () => (await import("react-leaflet")).TileLayer, { ssr: false });
const Marker = dynamic(async () => (await import("react-leaflet")).Marker, { ssr: false });

type TripOverviewMapPanelProps = {
  points: TripOverviewMapPoint[];
  missingLocations: TripOverviewMissingLocation[];
};

export default function TripOverviewMapPanel({ points, missingLocations }: TripOverviewMapPanelProps) {
  const { t } = useI18n();
  const center = useMemo<[number, number]>(() => points[0]?.position ?? [0, 0], [points]);

  return (
    <Paper elevation={1} sx={{ p: 3, borderRadius: 3, background: "#ffffff" }}>
      <Box display="flex" flexDirection="column" gap={2}>
        <Typography variant="h6" fontWeight={600}>
          {t("trips.overviewMap.title")}
        </Typography>

        {points.length === 0 ? (
          <Box
            sx={{
              minHeight: 240,
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
            <MapContainer center={center} zoom={5} style={{ height: 280, width: "100%" }} scrollWheelZoom={false}>
              <TileLayer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution="&copy; OpenStreetMap contributors"
              />
              {points.map((point, index) => (
                <Marker key={point.id} position={point.position} data-testid={`overview-map-marker-${index}`} />
              ))}
            </MapContainer>
          </Box>
        )}

        {missingLocations.length > 0 && (
          <Box display="flex" flexDirection="column" gap={1}>
            <Typography variant="body2" fontWeight={600}>
              {t("trips.overviewMap.missingTitle")}
            </Typography>
            <List dense sx={{ p: 0 }}>
              {missingLocations.map((item) => (
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
        )}
      </Box>
    </Paper>
  );
}
