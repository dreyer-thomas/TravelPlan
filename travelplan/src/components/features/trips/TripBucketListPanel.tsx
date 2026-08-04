"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  TextField,
  Typography,
  useTheme,
} from "@mui/material";
import { useForm } from "react-hook-form";
import { formatMessage } from "@/i18n";
import { useI18n } from "@/i18n/provider";
import { DialogTitleWithClose } from "@/components/ui/DialogCloseButton";
import DiscardChangesDialog, { useDiscardGuard } from "@/components/ui/DiscardChangesDialog";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
} from "@/components/features/trips/TripIcons";

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

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

type BucketListFormValues = {
  title: string;
  description: string;
  positionText: string;
};

type TripBucketListPanelProps = {
  tripId: string;
};

type DialogMode = "add" | "edit";

/*
 * Expanded-height cap for the row list (Story 7.12 AC2).
 *
 * Derived from the row metric rather than written as a pixel literal, so a change to the row's own
 * measurements moves the cap instead of silently invalidating it.
 *
 * A row is `alignItems: "center"`, so its height is whichever is taller: the stacked text block, or
 * the 44px touch floor of its trailing edit/delete buttons. The text block wins for a fully
 * populated row - the row `Typography`s carry no `variant`, so they are `body1`, and `theme.ts`
 * overrides only `fontSize`/`fontWeight` there, leaving MUI's `lineHeight: 1.5` in force. That is
 * 53.75px of text against 44px of button, which is why the line-height term below is not optional.
 *
 * The metric is taken from a fully populated row (title + description + location, one line each)
 * because that is the row the add dialog produces when every field is filled, and it is the taller
 * case - so the cap never shows FEWER than the intended rows. A row with no description is 63px, of
 * which the cap shows ~6.3: still inside AC2's "roughly 5-6". A row whose text wraps in the narrow
 * sidebar column is taller again and the cap shows correspondingly fewer; wrapping is not knowable
 * here, so the cap is deliberately an approximation and Task 6's browser pass is what judges it.
 */
const BUCKET_ROW_LINE_HEIGHT = 1.5; // MUI `body1`; theme.ts sets only fontSize/fontWeight on it
const BUCKET_ROW_TITLE_FONT_SIZE_PX = 12.5;
const BUCKET_ROW_SUBLINE_FONT_SIZE_PX = 11; // the description and location lines
const BUCKET_ROW_SUBLINE_OFFSET_PX = 1; // each subline's `mt: "1px"`
const BUCKET_ROW_TEXT_HEIGHT_PX =
  BUCKET_ROW_TITLE_FONT_SIZE_PX * BUCKET_ROW_LINE_HEIGHT +
  2 * (BUCKET_ROW_SUBLINE_FONT_SIZE_PX * BUCKET_ROW_LINE_HEIGHT + BUCKET_ROW_SUBLINE_OFFSET_PX);
const BUCKET_ROW_ACTION_HIT_AREA_PX = 44; // the edit/delete IconButtons' 44px touch floor
const BUCKET_ROW_PADDING_Y_PX = 9; // ListItem `padding: "9px 0"`, top and bottom
const BUCKET_ROW_DIVIDER_PX = 1; // ListItem `borderBottom: "1px solid"`
const BUCKET_ROW_HEIGHT_PX =
  Math.max(BUCKET_ROW_TEXT_HEIGHT_PX, BUCKET_ROW_ACTION_HIT_AREA_PX) +
  BUCKET_ROW_PADDING_Y_PX * 2 +
  BUCKET_ROW_DIVIDER_PX;

// Five full rows plus half of the sixth, so the cut falls mid-row and the list visibly reads as
// scrollable instead of looking like it simply ends.
const BUCKET_LIST_VISIBLE_ROWS = 5.5;
export const BUCKET_LIST_MAX_HEIGHT_PX = BUCKET_ROW_HEIGHT_PX * BUCKET_LIST_VISIBLE_ROWS;

export default function TripBucketListPanel({ tripId }: TripBucketListPanelProps) {
  const { t } = useI18n();
  const theme = useTheme();
  const tokens = theme.palette.tokens;
  const [items, setItems] = useState<BucketListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<DialogMode>("add");
  const [editingItem, setEditingItem] = useState<BucketListItem | null>(null);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [resolvedLocation, setResolvedLocation] = useState<{ lat: number; lng: number; label: string | null } | null>(
    null,
  );
  const [resolvedLocationQuery, setResolvedLocationQuery] = useState<string>("");
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<BucketListItem | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isDirty },
    reset,
    setError,
    watch,
  } = useForm<BucketListFormValues>({
    defaultValues: {
      title: "",
      description: "",
      positionText: "",
    },
  });

  const positionTextValue = watch("positionText");

  /**
   * Story 6.25 AC7 / EXPERIENCE.md.State Patterns → "Dismissing a dialog with unsaved input".
   *
   * `isDirty` alone is not enough, and that is 6.24's lesson rather than a guess: the geocode lookup
   * writes `resolvedLocation` outside react-hook-form entirely, so a user who searched for a place
   * and then hit the `✕` would lose it silently. The comparison is against the values the dialog
   * *opened* with — the same seed the open effect above applies — so a coordinate that was already
   * on the item does not read as dirty.
   */
  const openLocationKey = useMemo(() => {
    const seed = dialogMode === "edit" && editingItem ? editingItem.location ?? null : null;
    return seed ? `${seed.lat},${seed.lng}` : "";
  }, [dialogMode, editingItem]);
  const currentLocationKey = resolvedLocation ? `${resolvedLocation.lat},${resolvedLocation.lng}` : "";
  const closeFormDialog = useCallback(() => setDialogOpen(false), []);
  const formGuard = useDiscardGuard(isDirty || currentLocationKey !== openLocationKey, closeFormDialog);

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
        default:
          return fallback ?? t("trips.bucketList.loadError");
      }
    },
    [t],
  );

  const loadItems = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch(`/api/trips/${tripId}/bucket-list-items`, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });
      const body = (await response.json()) as ApiEnvelope<{ items: BucketListItem[] }>;

      if (!response.ok || body.error) {
        setLoadError(resolveApiError(body.error?.code, t("trips.bucketList.loadError")));
        setItems([]);
        return;
      }

      setItems(body.data?.items ?? []);
    } catch {
      setLoadError(t("trips.bucketList.loadError"));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [resolveApiError, t, tripId]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  useEffect(() => {
    if (!dialogOpen) return;
    setServerError(null);
    if (dialogMode === "edit" && editingItem) {
      reset({
        title: editingItem.title ?? "",
        description: editingItem.description ?? "",
        positionText: editingItem.positionText ?? "",
      });
      setResolvedLocation(editingItem.location ?? null);
      setResolvedLocationQuery(editingItem.positionText?.trim() ?? "");
    } else {
      reset({
        title: "",
        description: "",
        positionText: "",
      });
      setResolvedLocation(null);
      setResolvedLocationQuery("");
    }
  }, [dialogMode, dialogOpen, editingItem, reset]);

  useEffect(() => {
    if (!deleteTarget) {
      setDeleteError(null);
    }
  }, [deleteTarget]);

  useEffect(() => {
    if (!resolvedLocation) return;
    const trimmedPosition = positionTextValue?.trim() ?? "";
    if (trimmedPosition && trimmedPosition !== resolvedLocationQuery) {
      setResolvedLocation(null);
      setResolvedLocationQuery("");
    }
  }, [positionTextValue, resolvedLocation, resolvedLocationQuery]);

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

  const handleLookupLocation = async () => {
    const query = positionTextValue?.trim() ?? "";
    if (!query) {
      setServerError(t("trips.location.searchRequired"));
      return;
    }

    setServerError(null);
    setIsGeocoding(true);
    try {
      const response = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`, {
        method: "GET",
        credentials: "include",
      });
      const body = (await response.json()) as ApiEnvelope<{
        result: { lat: number; lng: number; label: string } | null;
      }>;

      if (!response.ok || body.error) {
        setServerError(body.error?.message ?? t("trips.location.lookupError"));
        return;
      }

      if (!body.data?.result) {
        setServerError(t("trips.location.noResult"));
        return;
      }

      setResolvedLocation({
        lat: body.data.result.lat,
        lng: body.data.result.lng,
        label: body.data.result.label,
      });
      setResolvedLocationQuery(query);
    } catch {
      setServerError(t("trips.location.lookupError"));
    } finally {
      setIsGeocoding(false);
    }
  };

  const attemptGeocode = async (query: string) => {
    try {
      const response = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`, {
        method: "GET",
        credentials: "include",
      });
      const body = (await response.json()) as ApiEnvelope<{
        result: { lat: number; lng: number; label: string } | null;
      }>;

      if (!response.ok || body.error || !body.data?.result) {
        return null;
      }

      return {
        lat: body.data.result.lat,
        lng: body.data.result.lng,
        label: body.data.result.label,
      };
    } catch {
      return null;
    }
  };

  const onSubmit = async (values: BucketListFormValues) => {
    setServerError(null);

    let token: string;
    try {
      token = await ensureCsrfToken();
    } catch {
      setServerError(t("errors.csrfMissing"));
      return;
    }

    const trimmedPosition = values.positionText.trim();
    let nextLocation = resolvedLocation;

    if (trimmedPosition && !nextLocation) {
      const geocoded = await attemptGeocode(trimmedPosition);
      if (geocoded) {
        nextLocation = geocoded;
        setResolvedLocation(geocoded);
        setResolvedLocationQuery(trimmedPosition);
      }
    }

    const payload = {
      title: values.title,
      description: values.description.trim() ? values.description : null,
      positionText: trimmedPosition ? trimmedPosition : null,
      location: nextLocation,
    } as {
      title: string;
      description: string | null;
      positionText: string | null;
      location: { lat: number; lng: number; label: string | null } | null;
      itemId?: string;
    };

    if (dialogMode === "edit" && editingItem) {
      payload.itemId = editingItem.id;
    }

    try {
      const response = await fetch(`/api/trips/${tripId}/bucket-list-items`, {
        method: dialogMode === "edit" ? "PATCH" : "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": token,
        },
        body: JSON.stringify(payload),
      });
      const body = (await response.json()) as ApiEnvelope<{ item: BucketListItem }>;

      if (!response.ok || body.error) {
        if (body.error?.code === "validation_error" && body.error.details) {
          const details = body.error.details as { fieldErrors?: Record<string, string[]> };
          Object.entries(details.fieldErrors ?? {}).forEach(([field, messages]) => {
            if (!messages?.[0]) return;
            if (field === "title") setError("title", { message: messages[0] });
            if (field === "description") setError("description", { message: messages[0] });
            if (field === "positionText") setError("positionText", { message: messages[0] });
          });
          return;
        }

        setServerError(resolveApiError(body.error?.code, t("trips.bucketList.saveError")));
        return;
      }

      setDialogOpen(false);
      setEditingItem(null);
      await loadItems();
    } catch {
      setServerError(t("trips.bucketList.saveError"));
    }
  };

  const openAddDialog = () => {
    setDialogMode("add");
    setEditingItem(null);
    setDialogOpen(true);
  };

  const openEditDialog = (item: BucketListItem) => {
    setDialogMode("edit");
    setEditingItem(item);
    setDialogOpen(true);
  };

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
      await loadItems();
    } catch {
      setDeleteError(t("trips.bucketList.deleteError"));
    } finally {
      setDeleteBusy(false);
    }
  };

  const dialogTitle = dialogMode === "edit" ? t("trips.bucketList.editTitle") : t("trips.bucketList.addTitle");
  const saveLabel = dialogMode === "edit" ? t("trips.bucketList.saveUpdate") : t("trips.bucketList.saveNew");
  const entryCountLabel = formatMessage(t("trips.bucketList.countLine"), { count: items.length });
  const toggleLabel = isCollapsed ? t("trips.bucketList.expandAction") : t("trips.bucketList.collapseAction");

  const emptyState = useMemo(() => !loading && items.length === 0, [items.length, loading]);

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
              <Typography sx={{ fontSize: "11.5px", fontWeight: 600, color: tokens.inkSoft }}>
                {entryCountLabel}
              </Typography>
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
                onClick={openAddDialog}
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

          <Collapse in={!isCollapsed} timeout="auto" unmountOnExit>
            {loadError && <Alert severity="error">{loadError}</Alert>}

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
                          sx={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: tokens.inkSoft,
                            mt: "1px",
                            overflowWrap: "anywhere",
                          }}
                        >
                          {item.description}
                        </Typography>
                      ) : null}
                      <Typography
                        sx={{
                          fontSize: 11,
                          fontWeight: 600,
                          color: tokens.inkSoft,
                          mt: "1px",
                          overflowWrap: "anywhere",
                        }}
                      >
                        {item.positionText?.trim()
                          ? item.positionText
                          : item.location?.label?.trim() ?? t("trips.bucketList.locationMissing")}
                      </Typography>
                    </Box>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 0.25, flexShrink: 0 }}>
                      <IconButton
                        aria-label={t("trips.bucketList.editAction")}
                        title={t("trips.bucketList.editAction")}
                        onClick={() => openEditDialog(item)}
                        sx={{ width: 44, height: 44, padding: 0, color: tokens.inkSoft }}
                      >
                        <PencilIcon />
                      </IconButton>
                      <IconButton
                        aria-label={t("trips.bucketList.deleteAction")}
                        title={t("trips.bucketList.deleteAction")}
                        onClick={() => setDeleteTarget(item)}
                        sx={{ width: 44, height: 44, padding: 0, color: tokens.inkSoft }}
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

      {/* The form half of this file. `formGuard.requestClose` is wired to the backdrop, Escape and the
          `✕` alike — one outcome, one question. A successful save calls `setDialogOpen(false)`
          directly, because re-asking "discard your changes?" after committing them is noise. */}
      <Dialog open={dialogOpen} onClose={formGuard.requestClose} fullWidth maxWidth="sm">
        <DialogTitleWithClose
          label={t("common.close")}
          onClose={formGuard.requestClose}
          disabled={isSubmitting}
        >
          {dialogTitle}
        </DialogTitleWithClose>
        <DialogContent dividers>
          <Box display="flex" flexDirection="column" gap={2.5}>
            {serverError && <Alert severity="error">{serverError}</Alert>}
            <Box component="form" id="bucket-list-form" onSubmit={handleSubmit(onSubmit)} display="flex" flexDirection="column" gap={2}>
              <TextField
                label={t("trips.bucketList.titleLabel")}
                error={Boolean(errors.title)}
                helperText={errors.title?.message}
                inputProps={{ maxLength: 120 }}
                {...register("title")}
                fullWidth
              />
              <TextField
                label={t("trips.bucketList.descriptionLabel")}
                error={Boolean(errors.description)}
                helperText={errors.description?.message}
                {...register("description")}
                fullWidth
                multiline
                minRows={3}
              />
              <TextField
                label={t("trips.bucketList.positionLabel")}
                error={Boolean(errors.positionText)}
                helperText={errors.positionText?.message}
                inputProps={{ maxLength: 200 }}
                {...register("positionText")}
                fullWidth
              />
              <Box display="flex" gap={1} alignItems="flex-start">
                <Button
                  variant="outlined"
                  onClick={() => void handleLookupLocation()}
                  disabled={isSubmitting || isGeocoding}
                  sx={{ mt: 1 }}
                >
                  {isGeocoding ? <CircularProgress size={18} /> : t("trips.location.searchAction")}
                </Button>
                <Button
                  variant="text"
                  onClick={() => setResolvedLocation(null)}
                  disabled={isSubmitting || isGeocoding || !resolvedLocation}
                  sx={{ mt: 1 }}
                >
                  {t("trips.location.clearAction")}
                </Button>
              </Box>
              <Typography variant="body2" color="text.secondary">
                {resolvedLocation
                  ? `${t("trips.location.latLabel")}: ${resolvedLocation.lat.toFixed(6)} · ${t("trips.location.lngLabel")}: ${resolvedLocation.lng.toFixed(6)}`
                  : t("trips.location.noCoordinates")}
              </Typography>
            </Box>
          </Box>
        </DialogContent>
        {/* Story 6.25 AC2. A form dialog carries no cancel button: the committing action has no
            consequential opposite worth the same visual weight, so the footer keeps one button and
            the dismissal is the `✕` above. `justifyContent: space-between` went with the pair it
            was spacing. */}
        <DialogActions>
          <Button type="submit" form="bucket-list-form" variant="contained" disabled={isSubmitting}>
            {isSubmitting ? <CircularProgress size={22} /> : saveLabel}
          </Button>
        </DialogActions>
      </Dialog>
      <DiscardChangesDialog {...formGuard.dialogProps} />

      {/* The confirmation half. One file, two rules — see Story 6.25's Trap 1. */}
      <Dialog open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} fullWidth maxWidth="xs">
        <DialogTitleWithClose
          label={t("common.close")}
          onClose={() => setDeleteTarget(null)}
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
          <Button onClick={() => setDeleteTarget(null)} disabled={deleteBusy}>
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
