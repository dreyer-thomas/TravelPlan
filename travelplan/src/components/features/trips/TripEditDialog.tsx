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

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

type TripSummary = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  dayCount: number;
};

type TripDay = {
  id: string;
  date: string;
  dayIndex: number;
  missingAccommodation: boolean;
  missingPlan: boolean;
  accommodation?: { id: string; name: string; notes: string | null } | null;
};

export type TripDetail = {
  trip: TripSummary;
  days: TripDay[];
};

type TripEditFormValues = {
  name: string;
  startDate: string;
  endDate: string;
};

type TripEditDialogProps = {
  open: boolean;
  trip: TripSummary;
  onClose: () => void;
  onUpdated: (detail: TripDetail) => void;
};

const toIsoUtc = (value: string) => new Date(`${value}T00:00:00.000Z`).toISOString();
const toDateInput = (value: string) => value.slice(0, 10);

export default function TripEditDialog({ open, trip, onClose, onUpdated }: TripEditDialogProps) {
  const { t } = useI18n();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
    reset,
  } = useForm<TripEditFormValues>({
    defaultValues: {
      name: trip.name,
      startDate: toDateInput(trip.startDate),
      endDate: toDateInput(trip.endDate),
    },
  });

  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    reset({
      name: trip.name,
      startDate: toDateInput(trip.startDate),
      endDate: toDateInput(trip.endDate),
    });
  }, [open, reset, trip]);

  useEffect(() => {
    if (!open) return;
    let active = true;

    const fetchCsrf = async () => {
      try {
        const response = await fetch("/api/auth/csrf", { method: "GET", credentials: "include", cache: "no-store" });
        const body = (await response.json()) as ApiEnvelope<{ csrfToken: string }>;

        if (!response.ok || body.error || !body.data?.csrfToken) {
          if (active) {
            setServerError(body.error?.message ?? t("trips.edit.initError"));
          }
          return;
        }

        if (active) {
          setCsrfToken(body.data.csrfToken);
        }
      } catch {
        if (active) {
          setServerError(t("trips.edit.initError"));
        }
      }
    };

    fetchCsrf();

    return () => {
      active = false;
    };
  }, [open]);

  const onSubmit = async (values: TripEditFormValues) => {
    setServerError(null);

    if (!csrfToken) {
      setServerError(t("errors.csrfMissing"));
      return;
    }

    const payload = {
      name: values.name,
      startDate: toIsoUtc(values.startDate),
      endDate: toIsoUtc(values.endDate),
    };

    const response = await fetch(`/api/trips/${trip.id}`, {
      method: "PATCH",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify(payload),
    });

    const body = (await response.json()) as ApiEnvelope<TripDetail>;

    if (!response.ok || body.error || !body.data) {
      if (body.error?.code === "validation_error" && body.error.details) {
        const details = body.error.details as {
          fieldErrors?: Record<string, string[]>;
        };
        Object.entries(details.fieldErrors ?? {}).forEach(([field, messages]) => {
          if (messages?.[0]) {
            setError(field as keyof TripEditFormValues, { message: messages[0] });
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
            return t("trips.edit.error");
        }
      };

      setServerError(resolveApiError(body.error?.code));
      return;
    }

    onUpdated(body.data);
    onClose();
  };

  const nameRules = useMemo(
    () => ({
      required: t("trips.form.nameRequired"),
    }),
    [t],
  );

  const dateRules = useMemo(
    () => ({
      required: t("trips.form.dateRequired"),
    }),
    [t],
  );

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>
        <Typography variant="h6" fontWeight={600} component="div">
          {t("trips.edit.title")}
        </Typography>
      </DialogTitle>
      <DialogContent dividers>
        <Box display="flex" flexDirection="column" gap={2.5}>
          {serverError && <Alert severity="error">{serverError}</Alert>}
          <Box
            component="form"
            id="trip-edit-form"
            onSubmit={handleSubmit(onSubmit)}
            display="flex"
            flexDirection="column"
            gap={2}
          >
            <TextField
              label={t("trips.form.name")}
              error={Boolean(errors.name)}
              helperText={errors.name?.message}
              {...register("name", nameRules)}
              fullWidth
            />
            <TextField
              label={t("trips.form.startDate")}
              type="date"
              error={Boolean(errors.startDate)}
              helperText={errors.startDate?.message}
              InputLabelProps={{ shrink: true }}
              {...register("startDate", dateRules)}
              fullWidth
            />
            <TextField
              label={t("trips.form.endDate")}
              type="date"
              error={Boolean(errors.endDate)}
              helperText={errors.endDate?.message}
              InputLabelProps={{ shrink: true }}
              {...register("endDate", dateRules)}
              fullWidth
            />
          </Box>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={isSubmitting}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" form="trip-edit-form" variant="contained" disabled={isSubmitting}>
          {isSubmitting ? <CircularProgress size={22} /> : t("trips.edit.submit")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
