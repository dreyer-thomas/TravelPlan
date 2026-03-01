"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItem,
  Paper,
  SvgIcon,
  TextField,
  Typography,
} from "@mui/material";
import { useForm } from "react-hook-form";
import { useI18n } from "@/i18n/provider";

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

export default function TripBucketListPanel({ tripId }: TripBucketListPanelProps) {
  const { t } = useI18n();
  const [items, setItems] = useState<BucketListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<DialogMode>("add");
  const [editingItem, setEditingItem] = useState<BucketListItem | null>(null);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
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
    formState: { errors, isSubmitting },
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

  const emptyState = useMemo(() => !loading && items.length === 0, [items.length, loading]);

  return (
    <>
      <Paper elevation={1} sx={{ p: 3, borderRadius: 3, background: "#ffffff" }}>
        <Box display="flex" flexDirection="column" gap={2}>
          <Box display="flex" alignItems="center" justifyContent="space-between" gap={1} flexWrap="wrap">
            <Typography variant="h6" fontWeight={600}>
              {t("trips.bucketList.title")}
            </Typography>
            <Button variant="outlined" onClick={openAddDialog}>
              {t("trips.bucketList.addAction")}
            </Button>
          </Box>

          {loadError && <Alert severity="error">{loadError}</Alert>}

          {loading && <Typography variant="body2">{t("trips.bucketList.loading")}</Typography>}

          {emptyState && (
            <Typography variant="body2" color="text.secondary">
              {t("trips.bucketList.empty")}
            </Typography>
          )}

          {!loading && items.length > 0 && (
            <List disablePadding sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>
              {items.map((item) => (
                <ListItem key={item.id} disablePadding>
                  <Box
                    display="flex"
                    justifyContent="space-between"
                    alignItems="flex-start"
                    gap={1.5}
                    sx={{
                      width: "100%",
                      p: 2,
                      borderRadius: 2,
                      border: "1px solid",
                      borderColor: "divider",
                      backgroundColor: "#f7f9fc",
                    }}
                  >
                    <Box display="flex" flexDirection="column" gap={0.5} minWidth={0}>
                      <Typography variant="subtitle1" fontWeight={600}>
                        {item.title}
                      </Typography>
                      {item.description ? (
                        <Typography variant="body2" color="text.secondary">
                          {item.description}
                        </Typography>
                      ) : null}
                      <Typography variant="caption" color="text.secondary">
                        {item.positionText?.trim()
                          ? item.positionText
                          : item.location?.label?.trim() ?? t("trips.bucketList.locationMissing")}
                      </Typography>
                    </Box>
                    <Box display="flex" alignItems="center" gap={0.5}>
                      <IconButton
                        size="small"
                        aria-label={t("trips.bucketList.editAction")}
                        title={t("trips.bucketList.editAction")}
                        onClick={() => openEditDialog(item)}
                      >
                        <SvgIcon fontSize="inherit">
                          <path d="M3 17.25V21h3.75l11-11-3.75-3.75-11 11zm14.71-9.04a1.003 1.003 0 0 0 0-1.42l-2.5-2.5a1.003 1.003 0 0 0-1.42 0l-1.83 1.83 3.75 3.75 2-1.66z" />
                        </SvgIcon>
                      </IconButton>
                      <IconButton
                        size="small"
                        aria-label={t("trips.bucketList.deleteAction")}
                        title={t("trips.bucketList.deleteAction")}
                        onClick={() => setDeleteTarget(item)}
                      >
                        <SvgIcon fontSize="inherit">
                          <path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6zm3.5-8h1v7h-1zm4 0h1v7h-1zM15.5 4l-1-1h-5l-1 1H5v2h14V4z" />
                        </SvgIcon>
                      </IconButton>
                    </Box>
                  </Box>
                </ListItem>
              ))}
            </List>
          )}
        </Box>
      </Paper>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>
          <Typography variant="h6" fontWeight={600} component="div">
            {dialogTitle}
          </Typography>
        </DialogTitle>
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
        <DialogActions sx={{ justifyContent: "space-between" }}>
          <Button onClick={() => setDialogOpen(false)} disabled={isSubmitting}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form="bucket-list-form" variant="contained" disabled={isSubmitting}>
            {isSubmitting ? <CircularProgress size={22} /> : saveLabel}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} fullWidth maxWidth="xs">
        <DialogTitle>{t("trips.bucketList.deleteTitle")}</DialogTitle>
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
          <Button onClick={() => setDeleteTarget(null)} disabled={deleteBusy}>
            {t("common.cancel")}
          </Button>
          <Button color="error" variant="contained" onClick={() => void handleDelete()} disabled={deleteBusy}>
            {deleteBusy ? <CircularProgress size={22} /> : t("trips.bucketList.deleteConfirm")}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
