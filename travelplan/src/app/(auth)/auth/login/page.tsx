"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Box, Button, CircularProgress } from "@mui/material";
import AuthField from "@/components/features/auth/AuthField";
import AuthScreenShell from "@/components/features/auth/AuthScreenShell";
import { AUTH_SUBMIT_SX } from "@/components/features/auth/authSubmitSx";
import AuthTabs from "@/components/features/auth/AuthTabs";
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

    let body: ApiEnvelope<{ userId: string; mustChangePassword: boolean }> | null = null;
    try {
      body = (await response.json()) as ApiEnvelope<{ userId: string; mustChangePassword: boolean }>;
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
    router.push(body.data?.mustChangePassword ? "/auth/first-login-password" : "/");
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
    <AuthScreenShell
      heroTitle={t("auth.hero.loginTitle")}
      heroSubtitle={t("auth.hero.loginSubtitle")}
      title={t("auth.login.title")}
      subtitle={t("auth.login.subtitle")}
      tabs={<AuthTabs active="signIn" />}
      error={serverError}
      success={success ? t("auth.login.success") : null}
      footer={
        <>
          {/*
            AC5: this link is the only UI entry point to the reset flow — before this story the whole
            flow was unreachable from the app. The register tab and the foot link below are
            deliberately redundant; Screen E draws both.
          */}
          <Box component="p" sx={{ m: 0, mb: "6px" }}>
            <Link href="/auth/forgot-password">{t("auth.login.forgotLink")}</Link>
          </Box>
          <Box component="p" sx={{ m: 0 }}>
            {t("auth.login.noAccount")} <Link href="/auth/register">{t("auth.login.registerLink")}</Link>
          </Box>
        </>
      }
    >
      <Box
        component="form"
        onSubmit={handleSubmit(onSubmit)}
        sx={{ display: "flex", flexDirection: "column", gap: "18px" }}
      >
        <AuthField
          id="login-email"
          label={t("auth.emailLabel")}
          type="email"
          placeholder={t("auth.emailPlaceholder")}
          error={errors.email?.message}
          {...register("email", emailRules)}
        />
        <AuthField
          id="login-password"
          label={t("auth.passwordLabel")}
          type="password"
          error={errors.password?.message}
          {...register("password", passwordRules)}
        />
        <Button type="submit" variant="contained" fullWidth disabled={isSubmitting} sx={AUTH_SUBMIT_SX}>
          {isSubmitting ? <CircularProgress size={22} /> : t("auth.login.submit")}
        </Button>
      </Box>
    </AuthScreenShell>
  );
}
