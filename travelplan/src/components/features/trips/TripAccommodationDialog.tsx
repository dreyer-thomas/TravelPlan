"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
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
  accommodation: { id: string; name: string; notes: string | null } | null;
};

type AccommodationFormValues = {
  name: string;
  notes: string;
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
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
    reset,
  } = useForm<AccommodationFormValues>({
    defaultValues: {
      name: day?.accommodation?.name ?? "",
      notes: day?.accommodation?.notes ?? "",
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

    const payload = {
      tripDayId: day.id,
      name: values.name,
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
