"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { Alert, Box, Button, CircularProgress, Container, Paper, TextField, Typography } from "@mui/material";

type ForgotPasswordValues = {
  email: string;
};

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

export default function ForgotPasswordPage() {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
    reset,
  } = useForm<ForgotPasswordValues>({
    defaultValues: {
      email: "",
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

  const onSubmit = async (values: ForgotPasswordValues) => {
    setServerError(null);
    setSuccess(false);

    if (!csrfToken) {
      setServerError("Security token missing. Please refresh and try again.");
      return;
    }

    let response: Response;
    try {
      response = await fetch("/api/auth/password-reset/request", {
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
            setError(field as keyof ForgotPasswordValues, { message: messages[0] });
          }
        });
        return;
      }

      setServerError(body.error?.message ?? "Password reset failed. Please try again.");
      return;
    }

    setSuccess(true);
    reset({ email: "" });
  };

  const emailRules = useMemo(
    () => ({
      required: "Email is required",
      pattern: {
        value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
        message: "Enter a valid email",
      },
    }),
    [],
  );

  return (
    <Container maxWidth="sm" sx={{ py: { xs: 6, md: 10 } }}>
      <Paper
        elevation={1}
        sx={{
          p: { xs: 3, md: 4 },
          borderRadius: 4,
          background: "#ffffff",
        }}
      >
        <Box display="flex" flexDirection="column" gap={3}>
          <Box>
            <Typography variant="overline" color="text.secondary" letterSpacing="0.25em">
              TravelPlan
            </Typography>
            <Typography variant="h4" fontWeight={600} gutterBottom>
              Reset your password
            </Typography>
            <Typography variant="body1" color="text.secondary">
              Enter your email and we will send you a reset link if the account exists.
            </Typography>
          </Box>

          {serverError && <Alert severity="error">{serverError}</Alert>}
          {success && (
            <Alert severity="success">
              If an account exists for that email, a reset link has been sent.
            </Alert>
          )}

          <Box component="form" onSubmit={handleSubmit(onSubmit)} display="flex" flexDirection="column" gap={2}>
            <TextField
              label="Email"
              type="email"
              error={Boolean(errors.email)}
              helperText={errors.email?.message}
              {...register("email", emailRules)}
              fullWidth
            />
            <Button type="submit" variant="contained" size="large" disabled={isSubmitting}>
              {isSubmitting ? <CircularProgress size={22} /> : "Send reset link"}
            </Button>
          </Box>
        </Box>
      </Paper>
    </Container>
  );
}
