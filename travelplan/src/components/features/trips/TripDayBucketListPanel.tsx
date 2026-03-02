"use client";

import { Alert, Box, Divider, IconButton, List, ListItem, Paper, SvgIcon, Typography } from "@mui/material";
import { useI18n } from "@/i18n/provider";

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

  return (
    <Paper elevation={0} sx={{ p: 2, borderRadius: 2, border: "1px solid", borderColor: "divider" }}>
      <Typography variant="subtitle1" fontWeight={600}>
        {t("trips.bucketList.title")}
      </Typography>
      {loading ? (
        <Typography variant="body2" color="text.secondary" mt={1}>
          {t("trips.bucketList.loading")}
        </Typography>
      ) : null}
      {error ? (
        <Alert severity="error" sx={{ mt: 1 }}>
          {error}
        </Alert>
      ) : null}
      {!loading && !error && items.length === 0 ? (
        <Typography variant="body2" color="text.secondary" mt={1}>
          {t("trips.bucketList.empty")}
        </Typography>
      ) : null}
      {items.length > 0 ? (
        <List dense sx={{ mt: 1, p: 0 }}>
          {items.map((item, index) => {
            const locationLabel = item.positionText?.trim() || item.location?.label || "";
            return (
              <Box key={item.id}>
                <ListItem sx={{ px: 0, py: 1, alignItems: "flex-start" }}>
                  <Box
                    sx={{
                      display: "grid",
                      gridTemplateColumns: "minmax(0, 1fr) auto",
                      alignItems: "start",
                      columnGap: 1.5,
                      width: "100%",
                    }}
                  >
                    <Box display="flex" flexDirection="column" gap={0.5}>
                      <Typography variant="body2" fontWeight={600} sx={{ overflowWrap: "anywhere" }}>
                        {item.title}
                      </Typography>
                      {item.description ? (
                        <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
                          {item.description}
                        </Typography>
                      ) : null}
                      {locationLabel ? (
                        <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
                          {locationLabel}
                        </Typography>
                      ) : null}
                    </Box>
                    <IconButton
                      color="primary"
                      aria-label={t("trips.bucketList.addToDayAction")}
                      onClick={() => onAddToDay(item)}
                    >
                      <SvgIcon fontSize="small" viewBox="0 0 24 24">
                        <path d="M11 5h2v14h-2z" />
                        <path d="M5 11h14v2H5z" />
                      </SvgIcon>
                    </IconButton>
                  </Box>
                </ListItem>
                {index < items.length - 1 ? <Divider /> : null}
              </Box>
            );
          })}
        </List>
      ) : null}
    </Paper>
  );
}
