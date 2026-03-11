"use client";

import { Box, Chip, IconButton, List, ListItem, Paper, SvgIcon, Tooltip, Typography } from "@mui/material";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useI18n } from "@/i18n/provider";
import type { TripOverviewMapPoint, TripOverviewMissingLocation } from "@/components/features/trips/TripOverviewMapData";

const TripOverviewLeafletMap = dynamic(() => import("./TripOverviewLeafletMap"), { ssr: false });

type TripOverviewMapPanelProps = {
  points: TripOverviewMapPoint[];
  missingLocations: TripOverviewMissingLocation[];
  polylinePositions?: [number, number][];
  expandHref?: string;
};

export default function TripOverviewMapPanel({
  points,
  missingLocations,
  polylinePositions,
  expandHref,
}: TripOverviewMapPanelProps) {
  const { t } = useI18n();
  const expandLabel = t("trips.overviewMap.expand");

  return (
    <Paper elevation={1} sx={{ p: 3, borderRadius: 3, background: "#ffffff" }}>
      <Box display="flex" flexDirection="column" gap={2}>
        <Box display="flex" alignItems="center" justifyContent="space-between" gap={1}>
          <Typography variant="h6" fontWeight={600}>
            {t("trips.overviewMap.title")}
          </Typography>
          {expandHref ? (
            <Tooltip title={expandLabel} enterDelay={0}>
              <span>
                <IconButton
                  size="small"
                  aria-label={expandLabel}
                  component={Link}
                  href={expandHref}
                  data-testid="trip-overview-map-expand"
                >
                  <SvgIcon fontSize="inherit">
                    <path d="M4 4h6v2H6v4H4V4zm10 0h6v6h-2V6h-4V4zm4 14v-4h2v6h-6v-2h4zM4 14h2v4h4v2H4v-6z" />
                  </SvgIcon>
                </IconButton>
              </span>
            </Tooltip>
          ) : null}
        </Box>

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
            <TripOverviewLeafletMap points={points} polylinePositions={polylinePositions} />
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
