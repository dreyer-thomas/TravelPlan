"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useSearchParams } from "next/navigation";
import { Alert, Box, Button, CircularProgress, Container, TextField, Typography } from "@mui/material";

type ResetPasswordValues = {
  token: string;
  password: string;
};

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

export default function ResetPasswordPage() {
  const searchParams = useSearchParams();
  const initialToken = searchParams.get("token") ?? "";

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
    reset,
    setValue,
  } = useForm<ResetPasswordValues>({
    defaultValues: {
      token: initialToken,
      password: "",
    },
  });

  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [success, setSuccess] = useState<boolean>(false);

  useEffect(() => {
    const fetchCsrf = async () => {
      try {
        const response = await fetch("/api/auth/csrf", { method: "GET" });
        const body = (await response.json()) as ApiEnvelope<{ csrfToken: string }>;
        if (body.data?.csrfToken) {
          setCsrfToken(body.data.csrfToken);
        }
      } catch {
        setServerError("Unable to initialize password reset. Please refresh.");
      }
    };

    fetchCsrf();
  }, []);

  useEffect(() => {
    if (initialToken) {
      setValue("token", initialToken);
    }
  }, [initialToken, setValue]);

  const onSubmit = async (values: ResetPasswordValues) => {
    setServerError(null);
    setSuccess(false);

    if (!csrfToken) {
      setServerError("Security token missing. Please refresh and try again.");
      return;
    }

    let response: Response;
    try {
      response = await fetch("/api/auth/password-reset/confirm", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify(values),
      });
    } catch {
      setServerError("Unable to reach the server. Please try again.");
      return;
    }

    let body: ApiEnvelope<{ success: boolean }> | null = null;
    try {
      body = (await response.json()) as ApiEnvelope<{ success: boolean }>;
    } catch {
      setServerError("Password reset failed. Please try again.");
      return;
    }

    if (!response.ok || body.error) {
      if (body.error?.code === "validation_error" && body.error.details) {
        const details = body.error.details as {
          fieldErrors?: Record<string, string[]>;
        };
        Object.entries(details.fieldErrors ?? {}).forEach(([field, messages]) => {
          if (messages?.[0]) {
            setError(field as keyof ResetPasswordValues, { message: messages[0] });
          }
        });
        return;
      }

      setServerError(body.error?.message ?? "Password reset failed. Please try again.");
      return;
    }

    setSuccess(true);
    reset({ token: "", password: "" });
  };

  const tokenRules = useMemo(
    () => ({
      required: "Reset token is required",
    }),
    [],
  );

  const passwordRules = useMemo(
    () => ({
      required: "Password is required",
      minLength: { value: 8, message: "Password must be at least 8 characters" },
      maxLength: { value: 72, message: "Password must be at most 72 characters" },
    }),
    [],
  );

  return (
    <Container maxWidth="sm" sx={{ py: 8 }}>
      <Box display="flex" flexDirection="column" gap={3}>
        <Box>
          <Typography variant="h4" fontWeight={600} gutterBottom>
            Set a new password
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Enter the reset token and your new password.
          </Typography>
        </Box>

        {serverError && <Alert severity="error">{serverError}</Alert>}
        {success && <Alert severity="success">Password updated. You can now sign in.</Alert>}

        <Box component="form" onSubmit={handleSubmit(onSubmit)} display="flex" flexDirection="column" gap={2}>
          <TextField
            label="Reset token"
            error={Boolean(errors.token)}
            helperText={errors.token?.message}
            {...register("token", tokenRules)}
            fullWidth
          />
          <TextField
            label="New password"
            type="password"
            error={Boolean(errors.password)}
            helperText={errors.password?.message}
            {...register("password", passwordRules)}
            fullWidth
          />
          <Button type="submit" variant="contained" size="large" disabled={isSubmitting}>
            {isSubmitting ? <CircularProgress size={22} /> : "Update password"}
          </Button>
        </Box>
      </Box>
    </Container>
  );
}
