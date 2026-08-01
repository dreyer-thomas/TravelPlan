"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import Link from "next/link";
import { Box, Button, CircularProgress } from "@mui/material";
import AuthField from "@/components/features/auth/AuthField";
import AuthScreenShell from "@/components/features/auth/AuthScreenShell";
import { AUTH_SUBMIT_SX } from "@/components/features/auth/authSubmitSx";
import { useI18n } from "@/i18n/provider";

type ForgotPasswordValues = {
  email: string;
};

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

export default function ForgotPasswordPage() {
  const { t } = useI18n();
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
        setServerError(t("auth.forgot.initError"));
      }
    };

    fetchCsrf();
  }, []);

  const onSubmit = async (values: ForgotPasswordValues) => {
    setServerError(null);
    setSuccess(false);

    if (!csrfToken) {
      setServerError(t("errors.csrfMissing"));
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
      setServerError(t("errors.network"));
      return;
    }

    let body: ApiEnvelope<{ success: boolean }> | null = null;
    try {
      body = (await response.json()) as ApiEnvelope<{ success: boolean }>;
    } catch {
      setServerError(t("auth.forgot.error"));
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
            return t("auth.forgot.error");
        }
      };

      setServerError(resolveApiError(body.error?.code));
      return;
    }

    setSuccess(true);
    reset({ email: "" });
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

  return (
    <AuthScreenShell
      heroTitle={t("auth.hero.forgotTitle")}
      heroSubtitle={t("auth.hero.forgotSubtitle")}
      title={t("auth.forgot.title")}
      subtitle={t("auth.forgot.subtitle")}
      stepLabel={t("auth.forgot.step")}
      error={serverError}
      // Keeps the deliberately non-enumerating "if an account exists" wording.
      success={success ? t("auth.forgot.success") : null}
      footer={
        <Box component="p" sx={{ m: 0 }}>
          {t("auth.forgot.rememberedPrefix")} <Link href="/auth/login">{t("auth.backToLogin")}</Link>
        </Box>
      }
    >
      <Box
        component="form"
        onSubmit={handleSubmit(onSubmit)}
        sx={{ display: "flex", flexDirection: "column", gap: "18px" }}
      >
        <AuthField
          id="forgot-email"
          label={t("auth.emailLabel")}
          type="email"
          placeholder={t("auth.emailPlaceholder")}
          error={errors.email?.message}
          {...register("email", emailRules)}
        />
        <Button type="submit" variant="contained" fullWidth disabled={isSubmitting} sx={AUTH_SUBMIT_SX}>
          {isSubmitting ? <CircularProgress size={22} /> : t("auth.forgot.submit")}
        </Button>
      </Box>
    </AuthScreenShell>
  );
}
