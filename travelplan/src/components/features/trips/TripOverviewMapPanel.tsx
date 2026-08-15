"use client";

import { Box, Chip, IconButton, List, ListItem, SvgIcon, Tooltip, Typography, useTheme } from "@mui/material";
import dynamic from "next/dynamic";
import Link from "next/link";
import { formatMessage } from "@/i18n";
import { useI18n } from "@/i18n/provider";
import type { TripOverviewMapPoint, TripOverviewMissingLocation } from "@/components/features/trips/TripOverviewMapData";

const TripOverviewLeafletMap = dynamic(() => import("./TripOverviewLeafletMap"), { ssr: false });

// DESIGN.md's compact `.map-preview` footprint, the same 150 `TripDayMapPanel` uses. Both the empty
// placeholder and the populated frame are this tall on the outside, so the card keeps one height
// whichever it shows.
const MAP_PREVIEW_HEIGHT = 150;
const MAP_PREVIEW_BORDER = 1;

type TripOverviewMapPanelProps = {
  points: TripOverviewMapPoint[];
  missingLocations: TripOverviewMissingLocation[];
  polylinePositions?: [number, number][];
  expandHref?: string;
  /**
   * DW-56: whether the parent's *load* failed. An empty `points` array means two different things -
   * "this trip has nothing mapped yet" and "we never got the data" - and only the first one deserves
   * the placeholder. Optional and defaulting to false so the panel keeps behaving as it does today
   * for any caller that does not track a load error.
   */
  loadError?: boolean;
};

export default function TripOverviewMapPanel({
  points,
  missingLocations,
  polylinePositions,
  expandHref,
  loadError = false,
}: TripOverviewMapPanelProps) {
  const { t } = useI18n();
  const theme = useTheme();
  const tokens = theme.palette.tokens;
  const expandLabel = t("trips.overviewMap.expand");

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
          <Typography variant="labelCaps" component="h5" sx={{ color: tokens.inkSoft }}>
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
          /* DW-56: an empty `points` array beside a failed load is not an empty trip, and saying "no
             mapped places yet" under the parent's error alert contradicts it. Nothing at all is the
             honest answer - the alert is already carrying the message. */
          loadError ? null : (
            <Box
              sx={{
                height: MAP_PREVIEW_HEIGHT,
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
          /* DW-15: the populated wrapper carries the same 1px frame the dashed empty state above
             already had, on the mockup's paper fill. `background.default` is that fill - there is no
             `tokens.paper` token, and `TripDayView.tsx` already reaches for the same palette entry
             where it needs it. Without the frame the tiles bleed straight into the card with no edge
             of their own. */
          <Box
            sx={{
              height: MAP_PREVIEW_HEIGHT,
              borderRadius: "6px",
              overflow: "hidden",
              // Built from the constant rather than a `"1px solid"` literal: the map below is sized
              // by subtracting this same number, and two independent spellings of it would let a
              // thicker frame clip the route again without anything failing.
              border: `${MAP_PREVIEW_BORDER}px solid`,
              borderColor: tokens.border,
              backgroundColor: theme.palette.background.default,
            }}
          >
            {/* The map must be told its height: left at its 280px default it renders full-size and is
                simply clipped, hiding the lower half of the route behind overflow: hidden. It is told
                the *content* box, not `MAP_PREVIEW_HEIGHT`: `globals.css` puts everything in
                `border-box`, so the frame added just above eats into the height the wrapper reserves,
                and passing the outer number would clip the bottom 2px of the route - the very thing
                this comment warns about, reintroduced by the border. */}
            <TripOverviewLeafletMap
              points={points}
              polylinePositions={polylinePositions}
              height={MAP_PREVIEW_HEIGHT - 2 * MAP_PREVIEW_BORDER}
            />
          </Box>
        )}

        {/* DW-15, ported wholesale from `TripDayMapPanel`'s caption block. EXPERIENCE.md's accessibility
            floor: a map is never the sole carrier of information, so a populated preview is always
            paired with a text summary and a real link to the full map. Gated on points as well as
            expandHref - a caption reading "0 stops" beside the "no mapped places" placeholder,
            linking to a map with nothing on it, is worse than no caption. */}
        {expandHref && points.length > 0 ? (
          <Typography
            component={Link}
            href={expandHref}
            data-testid="trip-overview-map-caption"
            sx={{
              fontSize: "11.5px",
              fontWeight: 600,
              color: tokens.inkSoft,
              textDecoration: "none",
              "&:hover": { textDecoration: "underline" },
            }}
          >
            {points.length === 1
              ? t("trips.overviewMap.mapCaptionOne")
              : formatMessage(t("trips.overviewMap.mapCaption"), { count: points.length })}
          </Typography>
        ) : null}

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
    </Box>
  );
}
