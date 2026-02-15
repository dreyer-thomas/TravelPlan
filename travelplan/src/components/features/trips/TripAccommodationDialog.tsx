"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
} from "@mui/material";
import { useI18n } from "@/i18n/provider";

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

type TripDay = {
  id: string;
  dayIndex: number;
  accommodation: {
    id: string;
    name: string;
    notes: string | null;
    status: "planned" | "booked";
    costCents: number | null;
    link: string | null;
    location: { lat: number; lng: number; label: string | null } | null;
  } | null;
};

type AccommodationFormValues = {
  name: string;
  notes: string;
  status: "planned" | "booked";
  costCents: string;
  link: string;
};

type GalleryImage = {
  id: string;
  imageUrl: string;
  sortOrder: number;
};

type TripAccommodationDialogProps = {
  open: boolean;
  tripId: string;
  day: TripDay | null;
  onClose: () => void;
  onSaved: () => void;
};

export default function TripAccommodationDialog({ open, tripId, day, onClose, onSaved }: TripAccommodationDialogProps) {
  const { t } = useI18n();
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [locationQuery, setLocationQuery] = useState("");
  const [resolvedLocation, setResolvedLocation] = useState<{ lat: number; lng: number; label: string | null } | null>(
    null,
  );
  const [initError, setInitError] = useState<string | null>(null);
  const [galleryImages, setGalleryImages] = useState<GalleryImage[]>([]);
  const [galleryFiles, setGalleryFiles] = useState<File[]>([]);
  const [galleryBusy, setGalleryBusy] = useState(false);
  const [fullscreenImage, setFullscreenImage] = useState<{ imageUrl: string; alt: string } | null>(null);

  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
    reset,
  } = useForm<AccommodationFormValues>({
    defaultValues: {
      name: day?.accommodation?.name ?? "",
      notes: day?.accommodation?.notes ?? "",
      status: day?.accommodation?.status ?? "planned",
      costCents:
        day?.accommodation?.costCents !== null && day?.accommodation?.costCents !== undefined
          ? (day.accommodation.costCents / 100).toFixed(2)
          : "",
      link: day?.accommodation?.link ?? "",
    },
  });

  useEffect(() => {
    if (!open) return;
    setServerError(null);
    setInitError(null);
    setCsrfToken(null);
    setIsDeleting(false);
    setIsGeocoding(false);
    reset({
      name: day?.accommodation?.name ?? "",
      notes: day?.accommodation?.notes ?? "",
      status: day?.accommodation?.status ?? "planned",
      costCents:
        day?.accommodation?.costCents !== null && day?.accommodation?.costCents !== undefined
          ? (day.accommodation.costCents / 100).toFixed(2)
          : "",
      link: day?.accommodation?.link ?? "",
    });
    setResolvedLocation(
      day?.accommodation?.location
        ? {
            lat: day.accommodation.location.lat,
            lng: day.accommodation.location.lng,
            label: day.accommodation.location.label ?? null,
          }
        : null,
    );
    setLocationQuery(day?.accommodation?.location?.label ?? day?.accommodation?.name ?? "");
  }, [day, open, reset]);

  useEffect(() => {
    if (!open) return;
    let active = true;

    const fetchCsrf = async () => {
      try {
        const response = await fetch("/api/auth/csrf", { method: "GET", credentials: "include", cache: "no-store" });
        const body = (await response.json()) as ApiEnvelope<{ csrfToken: string }>;

        if (!response.ok || body.error || !body.data?.csrfToken) {
          if (active) {
            setInitError(body.error?.message ?? t("trips.stay.initError"));
          }
          return;
        }

        if (active) {
          setCsrfToken(body.data.csrfToken);
        }
      } catch {
        if (active) {
          setInitError(t("trips.stay.initError"));
        }
      }
    };

    fetchCsrf();

    return () => {
      active = false;
    };
  }, [open, t]);

  useEffect(() => {
    if (!open || !day?.accommodation) {
      setGalleryImages([]);
      return;
    }
    const accommodationId = day.accommodation.id;
    let active = true;

    const loadGallery = async () => {
      try {
        const response = await fetch(
          `/api/trips/${tripId}/accommodations/images?tripDayId=${day.id}&accommodationId=${accommodationId}`,
          { method: "GET", credentials: "include", cache: "no-store" },
        );
        const body = (await response.json()) as ApiEnvelope<{ images: GalleryImage[] }>;
        if (!active) return;
        if (!response.ok || body.error) {
          setGalleryImages([]);
          return;
        }
        setGalleryImages(body.data?.images ?? []);
      } catch {
        if (active) setGalleryImages([]);
      }
    };

    void loadGallery();
    return () => {
      active = false;
    };
  }, [day?.accommodation, day?.id, open, tripId]);

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

  const onSubmit = async (values: AccommodationFormValues) => {
    if (!day) return;
    setServerError(null);

    let token: string;
    try {
      token = await ensureCsrfToken();
    } catch {
      setServerError(t("errors.csrfMissing"));
      return;
    }

    const costValue = values.costCents.trim();
    const costCents = costValue ? Math.round(Number(costValue) * 100) : null;
    const linkValue = values.link.trim();

    const payload = {
      tripDayId: day.id,
      name: values.name,
      status: values.status,
      costCents,
      link: linkValue.length > 0 ? linkValue : null,
      notes: values.notes.trim() ? values.notes : null,
      location: resolvedLocation,
    };

    try {
      const response = await fetch(`/api/trips/${tripId}/accommodations`, {
        method: day.accommodation ? "PATCH" : "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": token,
        },
        body: JSON.stringify(payload),
      });

      const body = (await response.json()) as ApiEnvelope<{ accommodation: { id: string } }>;

      if (!response.ok || body.error) {
        if (body.error?.code === "validation_error" && body.error.details) {
          const details = body.error.details as { fieldErrors?: Record<string, string[]> };
          Object.entries(details.fieldErrors ?? {}).forEach(([field, messages]) => {
            if (messages?.[0]) {
              setError(field as keyof AccommodationFormValues, { message: messages[0] });
            }
          });
          return;
        }

        const resolveApiError = (code?: string) => {
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
              return t("trips.stay.error");
          }
        };

        setServerError(resolveApiError(body.error?.code));
        return;
      }

      onSaved();
    } catch {
      setServerError(t("trips.stay.error"));
    }
  };

  const handleDelete = async () => {
    if (!day || !day.accommodation) return;

    setServerError(null);
    setIsDeleting(true);

    let token: string;
    try {
      token = await ensureCsrfToken();
    } catch {
      setServerError(t("errors.csrfMissing"));
      setIsDeleting(false);
      return;
    }

    try {
      const response = await fetch(`/api/trips/${tripId}/accommodations`, {
        method: "DELETE",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": token,
        },
        body: JSON.stringify({ tripDayId: day.id }),
      });

      const body = (await response.json()) as ApiEnvelope<{ deleted: boolean }>;

      if (!response.ok || body.error) {
        const resolveApiError = (code?: string) => {
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
              return t("trips.stay.deleteError");
          }
        };

        setServerError(resolveApiError(body.error?.code));
        return;
      }

      onSaved();
    } catch {
      setServerError(t("errors.csrfMissing"));
    } finally {
      setIsDeleting(false);
    }
  };

  const handleLookupLocation = async () => {
    const query = locationQuery.trim();
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
      setLocationQuery(body.data.result.label);
    } catch {
      setServerError(t("trips.location.lookupError"));
    } finally {
      setIsGeocoding(false);
    }
  };

  const uploadGalleryImages = async () => {
    if (!day?.accommodation || galleryFiles.length === 0) return;
    let token: string;
    try {
      token = await ensureCsrfToken();
    } catch {
      setServerError(t("errors.csrfMissing"));
      return;
    }

    setGalleryBusy(true);
    setServerError(null);
    try {
      const uploaded: GalleryImage[] = [];
      for (const file of galleryFiles) {
        const formData = new FormData();
        formData.set("tripDayId", day.id);
        formData.set("accommodationId", day.accommodation.id);
        formData.set("file", file);

        const response = await fetch(`/api/trips/${tripId}/accommodations/images`, {
          method: "POST",
          credentials: "include",
          headers: { "x-csrf-token": token },
          body: formData,
        });
        const body = (await response.json()) as ApiEnvelope<{ image: GalleryImage }>;
        if (!response.ok || body.error || !body.data?.image) {
          setServerError(t("trips.stay.error"));
          return;
        }
        uploaded.push(body.data.image);
      }
      setGalleryImages((current) => [...current, ...uploaded]);
      setGalleryFiles([]);
    } catch {
      setServerError(t("trips.stay.error"));
    } finally {
      setGalleryBusy(false);
    }
  };

  const deleteGalleryImage = async (imageId: string) => {
    if (!day?.accommodation) return;
    let token: string;
    try {
      token = await ensureCsrfToken();
    } catch {
      setServerError(t("errors.csrfMissing"));
      return;
    }

    setGalleryBusy(true);
    setServerError(null);
    try {
      const response = await fetch(`/api/trips/${tripId}/accommodations/images`, {
        method: "DELETE",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": token,
        },
        body: JSON.stringify({
          tripDayId: day.id,
          accommodationId: day.accommodation.id,
          imageId,
        }),
      });
      const body = (await response.json()) as ApiEnvelope<{ deleted: boolean }>;
      if (!response.ok || body.error) {
        setServerError(t("trips.stay.deleteError"));
        return;
      }
      setGalleryImages((current) => current.filter((image) => image.id !== imageId));
    } catch {
      setServerError(t("trips.stay.deleteError"));
    } finally {
      setGalleryBusy(false);
    }
  };

  const title = day?.accommodation ? t("trips.stay.editTitle") : t("trips.stay.addTitle");

  const nameRules = useMemo(
    () => ({
      required: t("trips.stay.nameRequired"),
    }),
    [t],
  );

  const maxCostCents = 100000000;
  const costRules = useMemo(
    () => ({
      validate: (value: string) => {
        const trimmed = value.trim();
        if (!trimmed) return true;
        if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
          return t("trips.stay.costInvalid");
        }
        const parsed = Number(trimmed);
        if (!Number.isFinite(parsed) || parsed < 0) {
          return t("trips.stay.costInvalid");
        }
        const cents = Math.round(parsed * 100);
        if (cents > maxCostCents) {
          return t("trips.stay.costTooHigh");
        }
        return true;
      },
    }),
    [t],
  );

  const linkRules = useMemo(
    () => ({
      validate: (value: string) => {
        const trimmed = value.trim();
        if (!trimmed) return true;
        try {
          new URL(trimmed);
          return true;
        } catch {
          return t("trips.stay.linkInvalid");
        }
      },
    }),
    [t],
  );

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>
        <Typography variant="h6" fontWeight={600} component="div">
          {title}
        </Typography>
      </DialogTitle>
      <DialogContent dividers>
        <Box display="flex" flexDirection="column" gap={2.5}>
          {(serverError || initError) && <Alert severity="error">{serverError ?? initError}</Alert>}
          <Box
            component="form"
            id="trip-accommodation-form"
            onSubmit={handleSubmit(onSubmit)}
            display="flex"
            flexDirection="column"
            gap={2}
          >
            <TextField
              label={t("trips.stay.nameLabel")}
              error={Boolean(errors.name)}
              {...register("name", nameRules)}
              fullWidth
            />
            <FormControl fullWidth error={Boolean(errors.status)}>
              <InputLabel id="trip-accommodation-status-label">{t("trips.stay.statusLabel")}</InputLabel>
              <Controller
                control={control}
                name="status"
                render={({ field }) => (
                  <Select
                    labelId="trip-accommodation-status-label"
                    label={t("trips.stay.statusLabel")}
                    {...field}
                  >
                    <MenuItem value="planned">{t("trips.stay.statusPlanned")}</MenuItem>
                    <MenuItem value="booked">{t("trips.stay.statusBooked")}</MenuItem>
                  </Select>
                )}
              />
            </FormControl>
            <TextField
              label={t("trips.stay.costLabel")}
              error={Boolean(errors.costCents)}
              helperText={errors.costCents?.message}
              {...register("costCents", costRules)}
              fullWidth
              type="number"
              inputMode="decimal"
              inputProps={{ min: 0, step: 0.01 }}
              placeholder="0.00"
            />
            <TextField
              label={t("trips.stay.linkLabel")}
              error={Boolean(errors.link)}
              helperText={errors.link?.message}
              {...register("link", linkRules)}
              fullWidth
              type="url"
              inputMode="url"
              placeholder="https://"
            />
            <Box display="flex" gap={1} alignItems="flex-start">
              <TextField
                label={t("trips.location.searchLabel")}
                value={locationQuery}
                onChange={(event) => setLocationQuery(event.target.value)}
                fullWidth
              />
              <Button
                variant="outlined"
                onClick={() => void handleLookupLocation()}
                disabled={isSubmitting || isDeleting || isGeocoding}
                sx={{ mt: 1 }}
              >
                {isGeocoding ? <CircularProgress size={18} /> : t("trips.location.searchAction")}
              </Button>
              <Button
                variant="text"
                onClick={() => setResolvedLocation(null)}
                disabled={isSubmitting || isDeleting || isGeocoding || !resolvedLocation}
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
            <TextField
              label={t("trips.stay.notesLabel")}
              error={Boolean(errors.notes)}
              {...register("notes")}
              fullWidth
              multiline
              minRows={3}
            />
            {day?.accommodation && (
              <Box display="flex" flexDirection="column" gap={1}>
                <Typography variant="body2" fontWeight={600}>
                  {t("trips.gallery.title")}
                </Typography>
                <Box display="flex" gap={1} alignItems="center">
                  <TextField
                    size="small"
                    type="file"
                    onChange={(event) => {
                      const input = event.currentTarget as HTMLInputElement;
                      setGalleryFiles(input.files ? Array.from(input.files) : []);
                    }}
                    inputProps={{ accept: "image/jpeg,image/png,image/webp", multiple: true }}
                    fullWidth
                  />
                  <Button
                    variant="outlined"
                    onClick={() => void uploadGalleryImages()}
                    disabled={galleryFiles.length === 0 || galleryBusy}
                  >
                    {t("trips.gallery.uploadAction")}
                  </Button>
                </Box>
                {galleryFiles.length > 0 && (
                  <Typography variant="caption" color="text.secondary">
                    {galleryFiles.length} file(s) selected
                  </Typography>
                )}
                {galleryImages.length === 0 ? (
                  <Typography variant="caption" color="text.secondary">
                    {t("trips.gallery.empty")}
                  </Typography>
                ) : (
                  <Box display="flex" flexDirection="column" gap={0.75}>
                    {galleryImages
                      .slice()
                      .sort((left, right) => left.sortOrder - right.sortOrder)
                      .map((image, index) => (
                        <Box key={image.id} display="flex" alignItems="center" gap={1}>
                          <Box
                            component="img"
                            src={image.imageUrl}
                            alt={t("trips.gallery.thumbnailAlt")}
                            sx={{ width: 42, height: 42, objectFit: "cover", borderRadius: 1, cursor: "pointer" }}
                            loading="lazy"
                            onClick={() => setFullscreenImage({ imageUrl: image.imageUrl, alt: t("trips.gallery.thumbnailAlt") })}
                          />
                          <Typography variant="caption" sx={{ minWidth: 20 }}>
                            {index + 1}
                          </Typography>
                          <Button size="small" color="error" onClick={() => void deleteGalleryImage(image.id)} disabled={galleryBusy}>
                            {t("trips.gallery.removeAction")}
                          </Button>
                        </Box>
                      ))}
                  </Box>
                )}
              </Box>
            )}
          </Box>
        </Box>
      </DialogContent>
      <DialogActions sx={{ justifyContent: "space-between" }}>
        <Box>
          {day?.accommodation && (
            <Button color="error" onClick={handleDelete} disabled={isSubmitting || isDeleting}>
              {isDeleting ? <CircularProgress size={22} /> : t("trips.stay.delete")}
            </Button>
          )}
        </Box>
        <Box display="flex" gap={1}>
          <Button onClick={onClose} disabled={isSubmitting || isDeleting}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form="trip-accommodation-form" variant="contained" disabled={isSubmitting || isDeleting}>
            {isSubmitting ? <CircularProgress size={22} /> : t("trips.stay.save")}
          </Button>
        </Box>
      </DialogActions>
      <Dialog
        open={Boolean(fullscreenImage)}
        onClose={() => setFullscreenImage(null)}
        maxWidth={false}
        sx={{
          "& .MuiDialog-paper": {
            backgroundColor: "transparent",
            boxShadow: "none",
            m: 0,
          },
        }}
        onKeyDown={() => setFullscreenImage(null)}
      >
        {fullscreenImage ? (
          <DialogContent
            onClick={() => setFullscreenImage(null)}
            sx={{
              p: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              minWidth: "100vw",
              minHeight: "100vh",
              backgroundColor: "rgba(0, 0, 0, 0.85)",
              cursor: "zoom-out",
            }}
          >
            <Box
              component="img"
              src={fullscreenImage.imageUrl}
              alt={fullscreenImage.alt}
              sx={{
                maxWidth: "96vw",
                maxHeight: "96vh",
                objectFit: "contain",
              }}
            />
          </DialogContent>
        ) : null}
      </Dialog>
    </Dialog>
  );
}
