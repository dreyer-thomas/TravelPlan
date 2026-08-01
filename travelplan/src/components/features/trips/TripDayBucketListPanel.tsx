"use client";

import { Alert, Box, IconButton, Typography, useTheme } from "@mui/material";
import { useI18n } from "@/i18n/provider";
import { PlusIcon } from "@/components/features/trips/TripIcons";

type BucketListItem = {
  id: string;
  tripId: string;
  title: string;
  description: string | null;
  positionText: string | null;
  location: { lat: number; lng: number; label: string | null } | null;
  createdAt: string;
  updatedAt: string;
};

type TripDayBucketListPanelProps = {
  items: BucketListItem[];
  loading: boolean;
  error: string | null;
  onAddToDay: (item: BucketListItem) => void;
};

export default function TripDayBucketListPanel({ items, loading, error, onAddToDay }: TripDayBucketListPanelProps) {
  const { t } = useI18n();
  const theme = useTheme();
  const tokens = theme.palette.tokens;

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
      <Typography variant="labelCaps" component="h6" sx={{ color: tokens.inkSoft, display: "block", mb: 1.25 }}>
        {t("trips.bucketList.title")}
      </Typography>
      {loading ? (
        <Typography variant="body2" sx={{ color: tokens.inkSoft }}>
          {t("trips.bucketList.loading")}
        </Typography>
      ) : null}
      {error ? (
        <Alert severity="error" sx={{ mt: 1 }}>
          {error}
        </Alert>
      ) : null}
      {!loading && !error && items.length === 0 ? (
        <Typography variant="body2" sx={{ color: tokens.inkSoft }}>
          {t("trips.bucketList.empty")}
        </Typography>
      ) : null}
      {items.length > 0 ? (
        // A real ul/li: the bordered-row treatment is presentational, so it must not cost the list its
        // semantics - screen readers still need to announce "list, N items". Divider via :last-child so
        // the list stays correct as items are added and removed.
        <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0, "& > li:last-child": { borderBottom: "none" } }}>
          {items.map((item) => {
            const locationLabel = item.positionText?.trim() || item.location?.label || "";
            return (
              <Box
                component="li"
                key={item.id}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 1.25,
                  padding: "9px 0",
                  borderBottom: "1px solid",
                  borderColor: tokens.border,
                }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography
                    sx={{ fontSize: "12.5px", fontWeight: 700, color: tokens.ink, overflowWrap: "anywhere" }}
                  >
                    {item.title}
                  </Typography>
                  {item.description ? (
                    <Typography
                      sx={{ fontSize: 11, fontWeight: 600, color: tokens.inkSoft, mt: "1px", overflowWrap: "anywhere" }}
                    >
                      {item.description}
                    </Typography>
                  ) : null}
                  {locationLabel ? (
                    <Typography
                      sx={{ fontSize: 11, fontWeight: 600, color: tokens.inkSoft, mt: "1px", overflowWrap: "anywhere" }}
                    >
                      {locationLabel}
                    </Typography>
                  ) : null}
                </Box>
                {/* The visible circle stays the mockup's 24px, but the hit area is padded out to the
                    44px floor - EXPERIENCE.md names this affordance specifically as one that was
                    previously undersized. */}
                <IconButton
                  aria-label={t("trips.bucketList.addToDayAction")}
                  onClick={() => onAddToDay(item)}
                  sx={{
                    flexShrink: 0,
                    width: 44,
                    height: 44,
                    padding: 0,
                    color: theme.palette.primary.main,
                    "& .bucket-add-circle": {
                      width: 24,
                      height: 24,
                      borderRadius: "50%",
                      border: "1px solid",
                      borderColor: tokens.borderStrong,
                      backgroundColor: tokens.card,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    },
                  }}
                >
                  <Box className="bucket-add-circle">
                    <PlusIcon />
                  </Box>
                </IconButton>
              </Box>
            );
          })}
        </Box>
      ) : null}
    </Box>
  );
}
