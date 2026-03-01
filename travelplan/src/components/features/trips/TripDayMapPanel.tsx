"use client";

import { Box, Chip, IconButton, List, ListItem, Paper, Skeleton, SvgIcon, Tooltip, Typography } from "@mui/material";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useI18n } from "@/i18n/provider";
import { parsePlanText } from "@/components/features/trips/TripDayPlanItemContent";

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

type TripDayMapPlanItemInput = {
  id: string;
  title: string | null;
  contentJson: string;
  location: { lat: number; lng: number } | null;
};

type TripDayMapStayInput = {
  id: string;
  name: string;
  location: { lat: number; lng: number } | null | undefined;
};

const getValidMapLocation = (value: { lat: number; lng: number } | null | undefined) => {
  if (!value) return null;
  if (
    typeof value.lat !== "number" ||
    typeof value.lng !== "number" ||
    !Number.isFinite(value.lat) ||
    !Number.isFinite(value.lng)
  ) {
    return null;
  }
  return value;
};

export const buildTripDayMapItems = (params: {
  previousStay?: TripDayMapStayInput | null;
  planItems?: TripDayMapPlanItemInput[];
  currentStay?: TripDayMapStayInput | null;
  getPlanItemFallbackLabel: (index: number) => string;
}): {
  previousStay: TripDayMapItem | null;
  planItems: TripDayMapItem[];
  currentStay: TripDayMapItem | null;
} => {
  return {
    previousStay: params.previousStay
      ? {
          id: params.previousStay.id,
          label: params.previousStay.name,
          kind: "previousStay",
          location: getValidMapLocation(params.previousStay.location),
        }
      : null,
    planItems: (params.planItems ?? []).map((item, index) => ({
      id: item.id,
      label:
        item.title?.trim() ||
        parsePlanText(item.contentJson) ||
        params.getPlanItemFallbackLabel(index + 1),
      kind: "planItem" as const,
      location: getValidMapLocation(item.location),
    })),
    currentStay: params.currentStay
      ? {
          id: params.currentStay.id,
          label: params.currentStay.name,
          kind: "currentStay",
          location: getValidMapLocation(params.currentStay.location),
        }
      : null,
  };
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

const DAY_MAP_PANEL_HEIGHT = "clamp(240px, 35vh, 360px)";

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
  const expandLabel = t("trips.dayView.mapExpand");

  return (
    <Paper elevation={0} sx={{ p: 2, borderRadius: 2, border: "1px solid", borderColor: "divider" }}>
      <Box display="flex" flexDirection="column" gap={2}>
        <Box display="flex" alignItems="center" justifyContent="space-between" gap={1}>
          <Typography variant="subtitle1" fontWeight={600}>
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
          <Skeleton variant="rectangular" height={DAY_MAP_PANEL_HEIGHT} sx={{ borderRadius: 2 }} />
        ) : points.length === 0 ? (
          <Box
            sx={{
              minHeight: DAY_MAP_PANEL_HEIGHT,
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
            <TripDayLeafletMap
              points={points}
              polylinePositions={polylinePositions}
              height={DAY_MAP_PANEL_HEIGHT}
              onMarkerClick={onMarkerClick}
            />
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
