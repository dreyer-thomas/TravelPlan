"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  IconButton,
  List,
  ListItem,
  Typography,
  useTheme,
} from "@mui/material";
import { formatMessage } from "@/i18n";
import { useI18n } from "@/i18n/provider";
import { DialogTitleWithClose } from "@/components/ui/DialogCloseButton";
import { useOpenInstanceKey } from "@/components/ui/DialogShell";
import BucketItemThumbnail, { BUCKET_ITEM_THUMBNAIL_PX } from "@/components/features/trips/BucketItemThumbnail";
import TripDayPlanDialog from "@/components/features/trips/TripDayPlanDialog";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
} from "@/components/features/trips/TripIcons";
import { bucketItemMetaLine } from "@/lib/trips/activityDuration";

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

/**
 * Story 14.1. A parked activity - an activity with no day yet - as `GET bucket-list-items` returns it:
 * everything the activity dialog needs to open on it, plus the row's first picture.
 */
type BucketListItem = {
  id: string;
  tripId: string;
  title: string;
  contentJson: string;
  durationMinutes: number;
  costCents: number | null;
  costOriginalAmount: number | null;
  costCurrency: string | null;
  costRate: number | null;
  costRateDate: string | null;
  payments: { amountCents: number; dueDate: string; amountOriginal?: number }[];
  linkUrl: string | null;
  location: { lat: number; lng: number; label: string | null } | null;
  firstImageUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

type TripBucketListPanelProps = {
  tripId: string;
};

type IdeaDialog = { mode: "add" } | { mode: "edit"; item: BucketListItem };

/** The row as the activity dialog's `item`: parked, so FLEXIBLE with no day and no times. */
const toDialogItem = (item: BucketListItem) => ({
  id: item.id,
  tripDayId: null,
  title: item.title,
  fromTime: null,
  toTime: null,
  contentJson: item.contentJson,
  costCents: item.costCents,
  costOriginalAmount: item.costOriginalAmount,
  costCurrency: item.costCurrency,
  costRate: item.costRate,
  costRateDate: item.costRateDate,
  payments: item.payments,
  linkUrl: item.linkUrl,
  location: item.location,
  createdAt: item.createdAt,
  scheduleMode: "FLEXIBLE" as const,
  durationMinutes: item.durationMinutes,
});

/*
 * Expanded-height cap for the row list (Story 7.12 AC2).
 *
 * Derived from the row metric rather than written as a pixel literal, so a change to the row's own
 * measurements moves the cap instead of silently invalidating it.
 *
 * Story 14.1 re-derived it for the `bucket-item` row. A row is `alignItems: "center"`, so its height is
 * the tallest of three things: the 40px thumbnail, the text block (title in `body1` 13.5px and one meta
 * line in `body2` 11.5px, both at MUI's `lineHeight: 1.5`, which `theme.ts` leaves in force, plus the
 * meta line's 1px offset: 38.5px), and the 44px touch floor of the trailing edit/delete buttons. The
 * buttons win, so every row is the same height now - a row without a picture or a place is no shorter -
 * and the cap shows exactly 5.5 of them unless a long title wraps in the narrow sidebar column, which is
 * not knowable here.
 */
const BUCKET_ROW_LINE_HEIGHT = 1.5; // MUI's default; theme.ts sets only fontSize/fontWeight on body1/body2
const BUCKET_ROW_TITLE_FONT_SIZE_PX = 13.5; // `body1`
const BUCKET_ROW_META_FONT_SIZE_PX = 11.5; // `body2`
const BUCKET_ROW_META_OFFSET_PX = 1; // the meta line's `mt: "1px"`
const BUCKET_ROW_TEXT_HEIGHT_PX =
  BUCKET_ROW_TITLE_FONT_SIZE_PX * BUCKET_ROW_LINE_HEIGHT +
  BUCKET_ROW_META_FONT_SIZE_PX * BUCKET_ROW_LINE_HEIGHT +
  BUCKET_ROW_META_OFFSET_PX;
const BUCKET_ROW_ACTION_HIT_AREA_PX = 44; // the edit/delete IconButtons' 44px touch floor
const BUCKET_ROW_PADDING_Y_PX = 9; // ListItem padding, top and bottom
const BUCKET_ROW_DIVIDER_PX = 1; // ListItem `borderBottom: "1px solid"`
export const BUCKET_ROW_HEIGHT_PX =
  Math.max(BUCKET_ITEM_THUMBNAIL_PX, BUCKET_ROW_TEXT_HEIGHT_PX, BUCKET_ROW_ACTION_HIT_AREA_PX) +
  BUCKET_ROW_PADDING_Y_PX * 2 +
  BUCKET_ROW_DIVIDER_PX;

// Five full rows plus half of the sixth, so the cut falls mid-row and the list visibly reads as
// scrollable instead of looking like it simply ends.
const BUCKET_LIST_VISIBLE_ROWS = 5.5;
export const BUCKET_LIST_MAX_HEIGHT_PX = BUCKET_ROW_HEIGHT_PX * BUCKET_LIST_VISIBLE_ROWS;

/**
 * The trip overview's bucket-list card (Story 7.12), on parked activities since Story 14.1. Owners and
 * contributors only - the caller gates it, and the route refuses a viewer. Adding and editing an idea
 * open the activity dialog in parked mode; deleting keeps its confirmation, and removes the idea's
 * pictures and documents with it.
 */
export default function TripBucketListPanel({ tripId }: TripBucketListPanelProps) {
  const { t } = useI18n();
  const theme = useTheme();
  const tokens = theme.palette.tokens;
  const [items, setItems] = useState<BucketListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<IdeaDialog | null>(null);
  // One mount per open, keyed by the idea, as `TripDayView` keys its plan dialog.
  const dialogKey = useOpenInstanceKey(dialog !== null, dialog?.mode === "edit" ? dialog.item.id : "add");
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<BucketListItem | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  // The editor's delete waits on this panel's confirmation: it resolves `true` once the idea is gone and
  // `false` when the user keeps it, so a cancelled delete leaves the editor (and its edits) open.
  const deleteResolverRef = useRef<((deleted: boolean) => void) | null>(null);
  const settleEditorDelete = useCallback((deleted: boolean) => {
    deleteResolverRef.current?.(deleted);
    deleteResolverRef.current = null;
  }, []);
  const keepDeleteTarget = useCallback(() => {
    setDeleteTarget(null);
    settleEditorDelete(false);
  }, [settleEditorDelete]);
  // Stable while the dialog is open: a fresh object per render would re-run the dialog's seed effect on
  // every reload of the list (a picture upload calls `onDayWrite`) and wipe what the user typed.
  const dialogItem = useMemo(() => (dialog?.mode === "edit" ? toDialogItem(dialog.item) : null), [dialog]);

  const resolveApiError = useCallback(
    (code?: string, fallback?: string) => {
      switch (code) {
        case "unauthorized":
          return t("errors.unauthorized");
        case "csrf_invalid":
          return t("errors.csrfInvalid");
        case "server_error":
          return t("errors.server");
        case "invalid_json":
          return t("errors.invalidJson");
        // Story 5.13: the widened routes answer this to a participant refused for her role, where they
        // used to answer `not_found`. Without this branch the fallback would still say "it is not there".
        case "forbidden":
          return t("errors.forbidden");
        default:
          return fallback ?? t("trips.bucketList.loadError");
      }
    },
    [t],
  );

  /**
   * Fetches the list and returns the state it implies rather than applying it, as `AdminUsersList`
   * does: the mount effect below then sets state only after the await (`react-hooks/set-state-in-effect`)
   * and can drop a response that arrives after unmount.
   */
  const fetchItems = useCallback(async (): Promise<{ items: BucketListItem[]; error: string | null }> => {
    try {
      const response = await fetch(`/api/trips/${tripId}/bucket-list-items`, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });
      const body = (await response.json()) as ApiEnvelope<{ items: BucketListItem[] }>;
      if (!response.ok || body.error) {
        return { items: [], error: resolveApiError(body.error?.code, t("trips.bucketList.loadError")) };
      }
      return { items: body.data?.items ?? [], error: null };
    } catch {
      return { items: [], error: t("trips.bucketList.loadError") };
    }
  }, [resolveApiError, t, tripId]);

  const applyItems = useCallback((result: { items: BucketListItem[]; error: string | null }) => {
    setItems(result.items);
    setLoadError(result.error);
    setLoading(false);
  }, []);

  /** A reload after a write: the list shows its loading line again until the answer is in. */
  const loadItems = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    applyItems(await fetchItems());
  }, [applyItems, fetchItems]);

  useEffect(() => {
    let active = true;
    void fetchItems().then((result) => {
      if (active) applyItems(result);
    });
    return () => {
      active = false;
    };
  }, [applyItems, fetchItems]);

  const ensureCsrfToken = useCallback(async () => {
    if (csrfToken) return csrfToken;
    const response = await fetch("/api/auth/csrf", { method: "GET", credentials: "include", cache: "no-store" });
    const body = (await response.json()) as ApiEnvelope<{ csrfToken: string }>;
    if (!response.ok || body.error || !body.data?.csrfToken) {
      throw new Error("csrf");
    }
    setCsrfToken(body.data.csrfToken);
    return body.data.csrfToken;
  }, [csrfToken]);

  const handleDelete = async () => {
    if (!deleteTarget) return;

    setDeleteBusy(true);
    setDeleteError(null);
    let token: string;
    try {
      token = await ensureCsrfToken();
    } catch {
      setDeleteError(t("errors.csrfMissing"));
      setDeleteBusy(false);
      return;
    }

    try {
      const response = await fetch(`/api/trips/${tripId}/bucket-list-items`, {
        method: "DELETE",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": token,
        },
        body: JSON.stringify({ itemId: deleteTarget.id }),
      });
      const body = (await response.json()) as ApiEnvelope<{ deleted: boolean }>;

      if (!response.ok || body.error) {
        setDeleteError(resolveApiError(body.error?.code, t("trips.bucketList.deleteError")));
        return;
      }

      setDeleteTarget(null);
      settleEditorDelete(true);
      await loadItems();
    } catch {
      setDeleteError(t("trips.bucketList.deleteError"));
    } finally {
      setDeleteBusy(false);
    }
  };

  const entryCountLabel =
    items.length === 1
      ? t("trips.bucketList.countLineOne")
      : formatMessage(t("trips.bucketList.countLine"), { count: items.length });
  const toggleLabel = isCollapsed ? t("trips.bucketList.expandAction") : t("trips.bucketList.collapseAction");

  // Gated on `!loadError` for the same reason `entryCountLabel` is: a failed load already clears
  // `items` to `[]`, so without this the empty-state copy would render underneath the error `Alert`
  // once the panel is expanded, claiming "no items" about a load that never actually completed.
  const emptyState = useMemo(
    () => !loading && !loadError && items.length === 0,
    [items.length, loadError, loading],
  );

  // Shared by both row-action buttons so the 44px hit-area floor and the DW-50 `:focus-visible`
  // outline cannot drift apart between them.
  //
  // The outline half is now redundant: DW-65 / DW-154 moved the ring into `theme.ts`'s `MuiIconButton`
  // override, which both rows inherit. Left in place deliberately (removing DW-50's row treatment is its
  // own decision) — but note it is a *duplicate* stated through a different selector (`:focus-visible`
  // rather than `.Mui-focusVisible`), and `sx` outranks `styleOverrides`, so editing the value here
  // diverges these two rows from the app-wide ring instead of changing it.
  const rowActionButtonSx = {
    width: 44,
    height: 44,
    padding: 0,
    color: tokens.inkSoft,
    "&:focus-visible": { outline: `2px solid ${tokens.ink}`, outlineOffset: "2px" },
  };

  return (
    <>
      <Box
        sx={{
          backgroundColor: tokens.card,
          border: "1px solid",
          borderColor: tokens.borderStrong,
          borderRadius: "8px",
          padding: "18px",
        }}
      >
        <Box display="flex" flexDirection="column" gap={2}>
          <Box display="flex" alignItems="center" justifyContent="space-between" gap={1} flexWrap="wrap">
            <Box display="flex" flexDirection="column" gap={0.25}>
              {/* Trip Overview's title is `h4`, so its card labels are `h5` (title + 1). The custom
                  labelCaps variant has no `variantMapping`, so `component="h5"` must be passed
                  explicitly - otherwise the Typography renders as a <span>. */}
              <Typography
                variant="labelCaps"
                component="h5"
                sx={{ color: tokens.inkSoft, display: "block" }}
              >
                {t("trips.bucketList.title")}
              </Typography>
              {!loadError && (
                <Typography sx={{ fontSize: "11.5px", fontWeight: 600, color: tokens.inkSoft }}>
                  {entryCountLabel}
                </Typography>
              )}
            </Box>
            <Box display="flex" alignItems="center" gap={0.75}>
              <IconButton
                aria-label={toggleLabel}
                title={toggleLabel}
                onClick={() => setIsCollapsed((prev) => !prev)}
                sx={{ width: 44, height: 44, padding: 0, color: tokens.inkSoft }}
              >
                {isCollapsed ? <ChevronDownIcon /> : <ChevronUpIcon />}
              </IconButton>
              {/* The visible circle stays the mockup's 24px, but the hit area is padded out to the
                  44px floor - matches the pattern established in TripDayBucketListPanel. */}
              <IconButton
                aria-label={t("trips.bucketList.addAction")}
                title={t("trips.bucketList.addAction")}
                onClick={() => setDialog({ mode: "add" })}
                sx={{
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
          </Box>

          {/* Rendered outside `Collapse` so a load failure is visible even while the panel is
              collapsed (DW-48) - a collapsed panel that only shows "0 entries" with no error is
              indistinguishable from an empty trip. The header's count line is gated on `!loadError`
              above so the two never appear together. */}
          {loadError && <Alert severity="error">{loadError}</Alert>}

          <Collapse in={!isCollapsed} timeout="auto" unmountOnExit>
            {loading && (
              <Typography variant="body2" sx={{ color: tokens.inkSoft }}>
                {t("trips.bucketList.loading")}
              </Typography>
            )}

            {emptyState && (
              <Typography variant="body2" sx={{ color: tokens.inkSoft }}>
                {t("trips.bucketList.empty")}
              </Typography>
            )}

            {!loading && items.length > 0 && (
              // Real MUI List/ListItem semantics: the presentational treatment is applied to each
              // ListItem, and the last row's border-bottom is suppressed via `:last-child` on the
              // wrapper so adding or removing an item never leaves a trailing rule.
              // The cap and the scroll region sit on the List, never on the card Box, so the
              // header, count line and add affordance stay visible while the rows scroll.
              // `md` is the trip overview grid's own breakpoint (TripTimeline's
              // `gridTemplateColumns: { xs: "1fr", md: "1.7fr 1fr" }`): below it the overview is a
              // single column, and capping there would nest a scroll region inside the page's own
              // scroll. Using any other key would open a window where the layout is stacked but the
              // list is still capped.
              <List
                disablePadding
                tabIndex={0}
                aria-label={t("trips.bucketList.title")}
                sx={{
                  "& > li:last-child": { borderBottom: "none" },
                  maxHeight: { xs: "none", md: BUCKET_LIST_MAX_HEIGHT_PX },
                  overflowY: { xs: "visible", md: "auto" },
                }}
              >
                {items.map((item) => (
                  <ListItem
                    key={item.id}
                    disablePadding
                    data-testid="bucket-item"
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 1.25,
                      padding: `${BUCKET_ROW_PADDING_Y_PX}px 0`,
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
                        {bucketItemMetaLine(item, t)}
                      </Typography>
                    </Box>
                    {/* `gap: 1` (8px, DW-50) keeps the two 44px hit areas from reading as a single
                        touch target. The `&:focus-visible` outline in `rowActionButtonSx` predates
                        DW-65's app-wide `MuiIconButton` ring, which these rows now also inherit; see
                        that constant for why the duplicate was left rather than removed. */}
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexShrink: 0 }}>
                      <IconButton
                        aria-label={t("trips.bucketList.editAction")}
                        title={t("trips.bucketList.editAction")}
                        onClick={() => setDialog({ mode: "edit", item })}
                        sx={rowActionButtonSx}
                      >
                        <PencilIcon />
                      </IconButton>
                      <IconButton
                        aria-label={t("trips.bucketList.deleteAction")}
                        title={t("trips.bucketList.deleteAction")}
                        onClick={() => {
                          setDeleteError(null);
                          setDeleteTarget(item);
                        }}
                        sx={rowActionButtonSx}
                      >
                        <TrashIcon />
                      </IconButton>
                    </Box>
                  </ListItem>
                ))}
              </List>
            )}
          </Collapse>
        </Box>
      </Box>

      {/* Story 14.1: add and edit are the activity dialog in parked mode - an idea is an activity
          without a day, with every tab an activity has (text, cost, pictures, documents, link). */}
      <TripDayPlanDialog
        key={`idea-${dialogKey}`}
        open={dialog !== null}
        mode={dialog?.mode ?? "add"}
        tripId={tripId}
        day={null}
        placement="parked"
        item={dialogItem}
        onDelete={(itemId) => {
          // The confirmation is this panel's own (below), shown over the editor; the editor closes only
          // once the idea is actually deleted.
          const target = items.find((entry) => entry.id === itemId);
          if (!target) return Promise.resolve(false);
          setDeleteError(null);
          settleEditorDelete(false);
          setDeleteTarget(target);
          return new Promise<boolean>((resolve) => {
            deleteResolverRef.current = resolve;
          });
        }}
        onClose={() => setDialog(null)}
        onSaved={() => {
          setDialog(null);
          void loadItems();
        }}
        // A picture uploaded or removed in the dialog changes the row's thumbnail even without a save.
        onDayWrite={() => void loadItems()}
      />

      {/* The confirmation half. One file, two rules — see Story 6.25's Trap 1. */}
      <Dialog open={Boolean(deleteTarget)} onClose={keepDeleteTarget} fullWidth maxWidth="xs">
        <DialogTitleWithClose
          label={t("common.close")}
          onClose={keepDeleteTarget}
          disabled={deleteBusy}
        >
          {t("trips.bucketList.deleteTitle")}
        </DialogTitleWithClose>
        <DialogContent>
          {deleteError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {deleteError}
            </Alert>
          )}
          <Typography variant="body2" color="text.secondary">
            {t("trips.bucketList.deleteBody")}
          </Typography>
        </DialogContent>
        <DialogActions>
          {/* Story 6.25 AC3. Both buttons stay and the weight is unchanged; only the safe one's word
              changes — "Eintrag behalten" beside "Eintrag löschen" is two outcomes about the same
              object, in the same noun. */}
          <Button onClick={keepDeleteTarget} disabled={deleteBusy}>
            {t("trips.bucketList.deleteKeep")}
          </Button>
          <Button color="error" variant="contained" onClick={() => void handleDelete()} disabled={deleteBusy}>
            {deleteBusy ? <CircularProgress size={22} /> : t("trips.bucketList.deleteConfirm")}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
