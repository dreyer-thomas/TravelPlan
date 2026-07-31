"use client";

import { Box, Chip, IconButton, List, ListItem, Skeleton, SvgIcon, Tooltip, Typography, useTheme } from "@mui/material";
import dynamic from "next/dynamic";
import Link from "next/link";
import { formatMessage } from "@/i18n";
import { useI18n } from "@/i18n/provider";
import {
  buildDayMapPanelData,
  buildTripDayMapItems,
  type TripDayMapItem,
  type TripDayMapPanelData,
  type TripDayMapPoint,
} from "@/lib/trips/dayMapData";
export { buildDayMapPanelData, buildTripDayMapItems };
export type { TripDayMapItem, TripDayMapPanelData, TripDayMapPoint } from "@/lib/trips/dayMapData";

const TripDayLeafletMap = dynamic(() => import("./TripDayLeafletMap"), { ssr: false });

// DESIGN.md's compact `.map-preview` footprint. This value is passed down to Leaflet, not just used
// to clip: left at its own default the map renders full-size and the lower half of the route is
// simply hidden behind overflow: hidden.
const DAY_MAP_PANEL_HEIGHT = 150;

type TripDayMapPanelProps = {
  points: TripDayMapPoint[];
  missingLocations: TripDayMapItem[];
  polylinePositions?: [number, number][];
  routingUnavailable?: boolean;
  loading?: boolean;
  expandHref?: string;
  onExpandClick?: () => void;
  onMarkerClick?: (point: TripDayMapPoint) => void;
};

export default function TripDayMapPanel({
  points,
  missingLocations,
  polylinePositions,
  routingUnavailable = false,
  loading = false,
  expandHref,
  onExpandClick,
  onMarkerClick,
}: TripDayMapPanelProps) {
  const { t } = useI18n();
  const theme = useTheme();
  const tokens = theme.palette.tokens;
  const expandLabel = t("trips.dayView.mapExpand");

  return (
    <Box
      sx={{
        backgroundColor: tokens.card,
        border: "1px solid",
        borderColor: tokens.borderStrong,
        borderRadius: "8px",
        padding: "18px",
      }}
    >
      <Box display="flex" flexDirection="column" gap={1.5}>
        <Box display="flex" alignItems="center" justifyContent="space-between" gap={1}>
          <Typography variant="labelCaps" component="h6" sx={{ color: tokens.inkSoft }}>
            {t("trips.dayView.mapTitle")}
          </Typography>
          <Tooltip title={expandLabel} enterDelay={0}>
            <span>
              <IconButton
                size="small"
                aria-label={expandLabel}
                component={expandHref ? Link : "button"}
                href={expandHref}
                disabled={!expandHref}
                onClick={expandHref ? onExpandClick : undefined}
                data-testid="day-map-expand"
              >
                <SvgIcon fontSize="inherit">
                  <path d="M4 4h6v2H6v4H4V4zm10 0h6v6h-2V6h-4V4zm4 14v-4h2v6h-6v-2h4zM4 14h2v4h4v2H4v-6z" />
                </SvgIcon>
              </IconButton>
            </span>
          </Tooltip>
        </Box>

        {loading ? (
          <Skeleton variant="rectangular" height={DAY_MAP_PANEL_HEIGHT} sx={{ borderRadius: "6px" }} />
        ) : points.length === 0 ? (
          <Box
            sx={{
              height: DAY_MAP_PANEL_HEIGHT,
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
              {t("trips.dayView.mapEmptyTitle")}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t("trips.dayView.mapEmptyBody")}
            </Typography>
          </Box>
        ) : (
          <Box sx={{ height: DAY_MAP_PANEL_HEIGHT, borderRadius: "6px", overflow: "hidden" }}>
            <TripDayLeafletMap
              points={points}
              polylinePositions={polylinePositions}
              height={DAY_MAP_PANEL_HEIGHT}
              onMarkerClick={onMarkerClick}
            />
          </Box>
        )}

        {/* EXPERIENCE.md's accessibility floor: a map is never the sole carrier of information, so a
            populated preview is always paired with a text summary and a real link to the full map.
            Gated on points as well as expandHref - a caption reading "0 stops" beside the "no
            locations" placeholder, linking to a map with nothing on it, is worse than no caption. */}
        {expandHref && !loading && points.length > 0 ? (
          <Typography
            component={Link}
            href={expandHref}
            onClick={onExpandClick}
            data-testid="day-map-caption"
            sx={{
              fontSize: "11.5px",
              fontWeight: 600,
              color: tokens.inkSoft,
              textDecoration: "none",
              "&:hover": { textDecoration: "underline" },
            }}
          >
            {points.length === 1
              ? t("trips.dayView.mapCaptionOne")
              : formatMessage(t("trips.dayView.mapCaption"), { count: points.length })}
          </Typography>
        ) : null}

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
    </Box>
  );
}
