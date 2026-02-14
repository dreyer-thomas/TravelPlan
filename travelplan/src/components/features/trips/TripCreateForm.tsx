"use client";

import { useEffect, useMemo, useState, type FocusEvent } from "react";
import { useForm } from "react-hook-form";
import { Alert, Box, Button, CircularProgress, TextField } from "@mui/material";
import { useI18n } from "@/i18n/provider";
import { formatMessage } from "@/i18n";

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

type TripCreateFormValues = {
  name: string;
  startDate: string;
  endDate: string;
  heroImage?: FileList;
};

export type TripCreateResponse = {
  trip: { id: string; name: string; startDate: string; endDate: string; heroImageUrl?: string | null };
  dayCount: number;
};

const toIsoUtc = (value: string) => new Date(`${value}T00:00:00.000Z`).toISOString();

const normalizeDateInput = (value: string) => {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(trimmed);
  if (match) {
    const [, dd, mm, yyyy] = match;
    return `${yyyy}-${mm}-${dd}`;
  }
  return trimmed;
};

const isValidDateInput = (value: string) => {
  const normalized = normalizeDateInput(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return false;
  }
  const [year, month, day] = normalized.split("-").map((part) => Number(part));
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    Number.isFinite(year) &&
    Number.isFinite(month) &&
    Number.isFinite(day) &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
};

export type TripCreateFormProps = {
  onCreated?: (trip: TripCreateResponse) => void;
  onSuccess?: () => void;
  onSubmittingChange?: (isSubmitting: boolean) => void;
  formId?: string;
  submitLabel?: string;
  showSubmit?: boolean;
};

export default function TripCreateForm({
  onCreated,
  onSuccess,
  onSubmittingChange,
  formId,
  submitLabel,
  showSubmit = true,
}: TripCreateFormProps) {
  const { t } = useI18n();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
    setValue,
    reset,
  } = useForm<TripCreateFormValues>({
    defaultValues: {
      name: "",
      startDate: "",
      endDate: "",
    },
  });

  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    const fetchCsrf = async () => {
      try {
        const response = await fetch("/api/auth/csrf", { method: "GET", credentials: "include", cache: "no-store" });
        const body = (await response.json()) as ApiEnvelope<{ csrfToken: string }>;

        if (!response.ok || body.error) {
          setServerError(t("trips.create.initError"));
          return;
        }

        if (body.data?.csrfToken) {
          setCsrfToken(body.data.csrfToken);
          return;
        }

        setServerError(t("trips.create.initError"));
      } catch {
        setServerError(t("trips.create.initError"));
      }
    };

    fetchCsrf();
  }, []);

  useEffect(() => {
    onSubmittingChange?.(isSubmitting);
  }, [isSubmitting, onSubmittingChange]);

  const onSubmit = async (values: TripCreateFormValues) => {
    setServerError(null);
    setSuccess(null);

    if (!csrfToken) {
      setServerError(t("errors.csrfMissing"));
      return;
    }

    const payload = {
      name: values.name,
      startDate: toIsoUtc(normalizeDateInput(values.startDate)),
      endDate: toIsoUtc(normalizeDateInput(values.endDate)),
    };

    const response = await fetch("/api/trips", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify(payload),
    });

    const body = (await response.json()) as ApiEnvelope<TripCreateResponse>;

    if (!response.ok || body.error) {
      if (body.error?.code === "validation_error" && body.error.details) {
        const details = body.error.details as {
          fieldErrors?: Record<string, string[]>;
        };
        Object.entries(details.fieldErrors ?? {}).forEach(([field, messages]) => {
          if (messages?.[0]) {
            setError(field as keyof TripCreateFormValues, { message: messages[0] });
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
            return t("trips.create.error");
        }
      };

      setServerError(resolveApiError(body.error?.code));
      return;
    }

    if (body.data) {
      let heroImageUrl = body.data.trip.heroImageUrl ?? null;
      const file = values.heroImage?.item(0);
      let uploadFailed = false;

      if (file) {
        const formData = new FormData();
        formData.set("file", file);
        const uploadResponse = await fetch(`/api/trips/${body.data.trip.id}/hero-image`, {
          method: "POST",
          credentials: "include",
          headers: {
            "x-csrf-token": csrfToken,
          },
          body: formData,
        });

        let uploadBody: ApiEnvelope<{ trip: { id: string; heroImageUrl: string | null } }> | null = null;
        try {
          uploadBody = (await uploadResponse.json()) as ApiEnvelope<{ trip: { id: string; heroImageUrl: string | null } }>;
        } catch {
          uploadBody = null;
        }

        if (!uploadResponse.ok || !uploadBody || uploadBody.error) {
          uploadFailed = true;
          setServerError(t("trips.create.uploadError"));
        } else {
          heroImageUrl = uploadBody.data?.trip.heroImageUrl ?? null;
        }
      }

      setSuccess(
        formatMessage(t("trips.create.success"), {
          count: body.data.dayCount,
        }),
      );
      reset({ name: "", startDate: "", endDate: "" });
      onCreated?.({
        ...body.data,
        trip: {
          ...body.data.trip,
          heroImageUrl,
        },
      });
      if (!uploadFailed) {
        onSuccess?.();
      }
    }
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
      validate: (value: string) => (isValidDateInput(value) ? true : t("trips.form.dateInvalid")),
    }),
    [t],
  );

  const handleDateBlur = (field: "startDate" | "endDate") => (event: FocusEvent<HTMLInputElement>) => {
    const normalized = normalizeDateInput(event.target.value);
    if (normalized !== event.target.value) {
      setValue(field, normalized, { shouldValidate: true, shouldDirty: true });
    }
  };

  return (
    <Box display="flex" flexDirection="column" gap={3}>
      {serverError && <Alert severity="error">{serverError}</Alert>}
      {success && <Alert severity="success">{success}</Alert>}

      <Box
        component="form"
        id={formId}
        onSubmit={handleSubmit(onSubmit)}
        display="flex"
        flexDirection="column"
        gap={2}
      >
        <TextField
          label={t("trips.form.name")}
          placeholder={t("trips.form.namePlaceholder")}
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
          onBlur={handleDateBlur("startDate")}
          fullWidth
        />
        <TextField
          label={t("trips.form.endDate")}
          type="date"
          error={Boolean(errors.endDate)}
          helperText={errors.endDate?.message}
          InputLabelProps={{ shrink: true }}
          {...register("endDate", dateRules)}
          onBlur={handleDateBlur("endDate")}
          fullWidth
        />
        <TextField
          label={t("trips.form.heroImage")}
          type="file"
          InputLabelProps={{ shrink: true }}
          inputProps={{ accept: "image/jpeg,image/png,image/webp" }}
          helperText={t("trips.form.heroImageHelper")}
          {...register("heroImage")}
          fullWidth
        />
        {showSubmit && (
          <Button type="submit" variant="contained" size="large" disabled={isSubmitting}>
            {isSubmitting ? <CircularProgress size={22} /> : submitLabel ?? t("trips.create.submit")}
          </Button>
        )}
      </Box>
    </Box>
  );
}
