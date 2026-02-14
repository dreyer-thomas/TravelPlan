"use client";

import { useEffect, useMemo, useState } from "react";
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
  FormHelperText,
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
  } | null;
};

type AccommodationFormValues = {
  name: string;
  notes: string;
  status: "planned" | "booked";
  costCents: string;
  link: string;
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
    setCsrfToken(null);
    setIsDeleting(false);
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
            setServerError(body.error?.message ?? t("trips.stay.initError"));
          }
          return;
        }

        if (active) {
          setCsrfToken(body.data.csrfToken);
        }
      } catch {
        if (active) {
          setServerError(t("trips.stay.initError"));
        }
      }
    };

    fetchCsrf();

    return () => {
      active = false;
    };
  }, [open, t]);

  const onSubmit = async (values: AccommodationFormValues) => {
    if (!day) return;
    setServerError(null);

    if (!csrfToken) {
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
    };

    const response = await fetch(`/api/trips/${tripId}/accommodations`, {
      method: day.accommodation ? "PATCH" : "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken,
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
  };

  const handleDelete = async () => {
    if (!day || !day.accommodation) return;
    if (!csrfToken) {
      setServerError(t("errors.csrfMissing"));
      return;
    }

    setServerError(null);
    setIsDeleting(true);

    try {
      const response = await fetch(`/api/trips/${tripId}/accommodations`, {
        method: "DELETE",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
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
      setServerError(t("trips.stay.deleteError"));
    } finally {
      setIsDeleting(false);
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
          {serverError && <Alert severity="error">{serverError}</Alert>}
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
              helperText={errors.name?.message}
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
              {errors.status?.message && <FormHelperText>{errors.status.message}</FormHelperText>}
            </FormControl>
            <TextField
              label={t("trips.stay.costLabel")}
              error={Boolean(errors.costCents)}
              helperText={errors.costCents?.message ?? t("trips.stay.costHelper")}
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
              helperText={errors.link?.message ?? t("trips.stay.linkHelper")}
              {...register("link", linkRules)}
              fullWidth
              type="url"
              inputMode="url"
              placeholder="https://"
            />
            <TextField
              label={t("trips.stay.notesLabel")}
              error={Boolean(errors.notes)}
              helperText={errors.notes?.message}
              {...register("notes")}
              fullWidth
              multiline
              minRows={3}
            />
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
    </Dialog>
  );
}
