"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { Alert, Box, Button, CircularProgress, TextField } from "@mui/material";

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

type TripCreateFormValues = {
  name: string;
  startDate: string;
  endDate: string;
};

export type TripCreateResponse = {
  trip: { id: string; name: string; startDate: string; endDate: string };
  dayCount: number;
};

const toIsoUtc = (value: string) => new Date(`${value}T00:00:00.000Z`).toISOString();

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
  submitLabel = "Create trip",
  showSubmit = true,
}: TripCreateFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
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
          setServerError(body.error?.message ?? "Unable to initialize trip creation. Please refresh.");
          return;
        }

        if (body.data?.csrfToken) {
          setCsrfToken(body.data.csrfToken);
          return;
        }

        setServerError("Unable to initialize trip creation. Please refresh.");
      } catch {
        setServerError("Unable to initialize trip creation. Please refresh.");
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
      setServerError("Security token missing. Please refresh and try again.");
      return;
    }

    const payload = {
      name: values.name,
      startDate: toIsoUtc(values.startDate),
      endDate: toIsoUtc(values.endDate),
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

      setServerError(body.error?.message ?? "Trip creation failed. Please try again.");
      return;
    }

    if (body.data) {
      setSuccess(`Trip created with ${body.data.dayCount} days.`);
      reset({ name: "", startDate: "", endDate: "" });
      onCreated?.(body.data);
      onSuccess?.();
    }
  };

  const nameRules = useMemo(
    () => ({
      required: "Trip name is required",
    }),
    [],
  );

  const dateRules = useMemo(
    () => ({
      required: "Date is required",
    }),
    [],
  );

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
          label="Trip name"
          placeholder="e.g. Spring in Kyoto"
          error={Boolean(errors.name)}
          helperText={errors.name?.message}
          {...register("name", nameRules)}
          fullWidth
        />
        <TextField
          label="Start date"
          type="date"
          error={Boolean(errors.startDate)}
          helperText={errors.startDate?.message}
          InputLabelProps={{ shrink: true }}
          {...register("startDate", dateRules)}
          fullWidth
        />
        <TextField
          label="End date"
          type="date"
          error={Boolean(errors.endDate)}
          helperText={errors.endDate?.message}
          InputLabelProps={{ shrink: true }}
          {...register("endDate", dateRules)}
          fullWidth
        />
        {showSubmit && (
          <Button type="submit" variant="contained" size="large" disabled={isSubmitting}>
            {isSubmitting ? <CircularProgress size={22} /> : submitLabel}
          </Button>
        )}
      </Box>
    </Box>
  );
}
