"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useRouter } from "next/navigation";
import { Alert, Box, Button, CircularProgress, Container, Paper, TextField, Typography } from "@mui/material";
import { useI18n } from "@/i18n/provider";

type LoginFormValues = {
  email: string;
  password: string;
};

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

export default function LoginPage() {
  const router = useRouter();
  const { t } = useI18n();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
    reset,
  } = useForm<LoginFormValues>({
    defaultValues: {
      email: "",
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
        setCsrfToken(null);
      }
    };

    fetchCsrf();
  }, []);

  const onSubmit = async (values: LoginFormValues) => {
    setServerError(null);
    setSuccess(false);

    if (!csrfToken) {
      setServerError(t("errors.csrfMissing"));
      return;
    }

    let response: Response;
    try {
      response = await fetch("/api/auth/login", {
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

    let body: ApiEnvelope<{ userId: string }> | null = null;
    try {
      body = (await response.json()) as ApiEnvelope<{ userId: string }>;
    } catch {
      setServerError(t("auth.login.error"));
      return;
    }

    if (!response.ok || body.error) {
      if (body.error?.code === "validation_error" && body.error.details) {
        const details = body.error.details as {
          fieldErrors?: Record<string, string[]>;
        };
        Object.entries(details.fieldErrors ?? {}).forEach(([field, messages]) => {
          if (messages?.[0]) {
            setError(field as keyof LoginFormValues, { message: messages[0] });
          }
        });
        return;
      }

      const resolveApiError = (code?: string) => {
        switch (code) {
          case "invalid_credentials":
            return t("auth.login.invalidCredentials");
          case "rate_limited":
            return t("errors.rateLimited");
          case "csrf_invalid":
            return t("errors.csrfInvalid");
          case "server_error":
            return t("errors.server");
          case "invalid_json":
            return t("errors.invalidJson");
          default:
            return t("auth.login.error");
        }
      };

      setServerError(resolveApiError(body.error?.code));
      return;
    }

    setSuccess(true);
    reset({ email: "", password: "" });
    router.push("/");
  };

  const emailRules = useMemo(
    () => ({
      required: t("auth.emailRequired"),
      pattern: {
        value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
        message: t("auth.emailInvalid"),
      },
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
              {t("auth.login.title")}
            </Typography>
            <Typography variant="body1" color="text.secondary">
              {t("auth.login.subtitle")}
            </Typography>
          </Box>

          {serverError && <Alert severity="error">{serverError}</Alert>}
          {success && <Alert severity="success">{t("auth.login.success")}</Alert>}

          <Box component="form" onSubmit={handleSubmit(onSubmit)} display="flex" flexDirection="column" gap={2}>
            <TextField
              label={t("auth.emailLabel")}
              type="email"
              error={Boolean(errors.email)}
              helperText={errors.email?.message}
              {...register("email", emailRules)}
              fullWidth
            />
            <TextField
              label={t("auth.passwordLabel")}
              type="password"
              error={Boolean(errors.password)}
              helperText={errors.password?.message}
              {...register("password", passwordRules)}
              fullWidth
            />
            <Button type="submit" variant="contained" size="large" disabled={isSubmitting}>
              {isSubmitting ? <CircularProgress size={22} /> : t("auth.login.submit")}
            </Button>
          </Box>
        </Box>
      </Paper>
    </Container>
  );
}
