"use client";

import { Alert, Box, IconButton, Typography, useTheme } from "@mui/material";
import { useI18n } from "@/i18n/provider";
import BucketItemThumbnail from "@/components/features/trips/BucketItemThumbnail";
import { PlusIcon } from "@/components/features/trips/TripIcons";
import { bucketItemMetaLine } from "@/lib/trips/activityDuration";

/** Story 14.1. A parked activity as the row shows it (DESIGN.md `bucket-item`). */
type BucketListItem = {
  id: string;
  title: string;
  durationMinutes: number;
  location: { lat: number; lng: number; label: string | null } | null;
  firstImageUrl: string | null;
};

type TripDayBucketListPanelProps<T extends BucketListItem> = {
  items: T[];
  loading: boolean;
  error: string | null;
  /** Story 14.1: "+" moves the idea itself onto this day (no dialog). */
  onSchedule: (item: T) => void;
  /** Story 14.1 (Tommy's Q3 ruling): *Idee hinzufügen* here too; the header "+" opens the parked dialog. */
  onAdd?: () => void;
};

/**
 * Day Detail's bucket list. A row's "+" schedules that idea onto the day being viewed; the header's "+"
 * adds a new idea to the list (Story 14.1, Q3: Tommy wanted adding here as well as on the overview).
 * Editing an idea stays on the overview.
 */
export default function TripDayBucketListPanel<T extends BucketListItem>({
  items,
  loading,
  error,
  onSchedule,
  onAdd,
}: TripDayBucketListPanelProps<T>) {
  const { t } = useI18n();
  const theme = useTheme();
  const tokens = theme.palette.tokens;
  // The visible circle stays the mockup's 24px, the hit area the 44px floor; shared by the header's add
  // and each row's schedule button.
  const addCircleSx = {
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
  };

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
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, mb: 1.25 }}>
        <Typography variant="labelCaps" component="h6" sx={{ color: tokens.inkSoft, display: "block" }}>
          {t("trips.bucketList.title")}
        </Typography>
        {onAdd ? (
          // The overview card's add control: a 24px circle in a 44px hit area.
          <IconButton
            aria-label={t("trips.bucketList.addAction")}
            title={t("trips.bucketList.addAction")}
            onClick={onAdd}
            sx={{ ...addCircleSx, my: "-11px" }}
          >
            <Box className="bucket-add-circle">
              <PlusIcon />
            </Box>
          </IconButton>
        ) : null}
      </Box>
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
            const metaLine = bucketItemMetaLine(item, t);
            return (
              <Box
                component="li"
                key={item.id}
                data-testid="bucket-item"
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1.25,
                  padding: "9px 0",
                  borderBottom: "1px solid",
                  borderColor: tokens.border,
                }}
              >
                <BucketItemThumbnail imageUrl={item.firstImageUrl} />
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="body1" sx={{ fontWeight: 600, color: tokens.ink, overflowWrap: "anywhere" }}>
                    {item.title}
                  </Typography>
                  <Typography variant="body2" sx={{ color: tokens.inkSoft, mt: "1px", overflowWrap: "anywhere" }}>
                    {metaLine}
                  </Typography>
                </Box>
                {/* The visible circle stays the mockup's 24px, but the hit area is padded out to the
                    44px floor - EXPERIENCE.md names this affordance specifically as one that was
                    previously undersized. */}
                <IconButton
                  aria-label={t("trips.bucketList.addToDayAction")}
                  onClick={() => onSchedule(item)}
                  sx={addCircleSx}
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
