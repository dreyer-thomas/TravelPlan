"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useSearchParams } from "next/navigation";
import { Alert, Box, Button, CircularProgress, Container, Paper, TextField, Typography } from "@mui/material";
import { useI18n } from "@/i18n/provider";

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
  const { t } = useI18n();

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
        setServerError(t("auth.reset.initError"));
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
      setServerError(t("errors.csrfMissing"));
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
      setServerError(t("errors.network"));
      return;
    }

    let body: ApiEnvelope<{ success: boolean }> | null = null;
    try {
      body = (await response.json()) as ApiEnvelope<{ success: boolean }>;
    } catch {
      setServerError(t("auth.reset.error"));
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

      const resolveApiError = (code?: string) => {
        switch (code) {
          case "rate_limited":
            return t("errors.rateLimited");
          case "csrf_invalid":
            return t("errors.csrfInvalid");
          case "server_error":
            return t("errors.server");
          case "invalid_json":
            return t("errors.invalidJson");
          default:
            return t("auth.reset.error");
        }
      };

      setServerError(resolveApiError(body.error?.code));
      return;
    }

    setSuccess(true);
    reset({ token: "", password: "" });
  };

  const tokenRules = useMemo(
    () => ({
      required: t("auth.reset.tokenRequired"),
    }),
    [t],
  );

  const passwordRules = useMemo(
    () => ({
      required: t("auth.passwordRequired"),
      minLength: { value: 8, message: t("auth.passwordMin") },
      maxLength: { value: 72, message: t("auth.passwordMax") },
    }),
    [t],
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
              {t("app.brand")}
            </Typography>
            <Typography variant="h4" fontWeight={600} gutterBottom>
              {t("auth.reset.title")}
            </Typography>
            <Typography variant="body1" color="text.secondary">
              {t("auth.reset.subtitle")}
            </Typography>
          </Box>

          {serverError && <Alert severity="error">{serverError}</Alert>}
          {success && <Alert severity="success">{t("auth.reset.success")}</Alert>}

          <Box component="form" onSubmit={handleSubmit(onSubmit)} display="flex" flexDirection="column" gap={2}>
            <TextField
              label={t("auth.reset.tokenLabel")}
              error={Boolean(errors.token)}
              helperText={errors.token?.message}
              {...register("token", tokenRules)}
              fullWidth
            />
            <TextField
              label={t("auth.reset.newPassword")}
              type="password"
              error={Boolean(errors.password)}
              helperText={errors.password?.message}
              {...register("password", passwordRules)}
              fullWidth
            />
            <Button type="submit" variant="contained" size="large" disabled={isSubmitting}>
              {isSubmitting ? <CircularProgress size={22} /> : t("auth.reset.submit")}
            </Button>
          </Box>
        </Box>
      </Paper>
    </Container>
  );
}
