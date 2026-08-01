"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useRouter } from "next/navigation";
import { Box, Button, CircularProgress } from "@mui/material";
import AuthField from "@/components/features/auth/AuthField";
import AuthScreenShell from "@/components/features/auth/AuthScreenShell";
import { AUTH_SUBMIT_SX } from "@/components/features/auth/authSubmitSx";
import { useI18n } from "@/i18n/provider";

type FirstLoginPasswordValues = {
  password: string;
};

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

export default function FirstLoginPasswordPage() {
  const router = useRouter();
  const { t } = useI18n();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
    reset,
  } = useForm<FirstLoginPasswordValues>({
    defaultValues: {
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
        setServerError(t("auth.firstLogin.initError"));
      }
    };

    fetchCsrf();
  }, [t]);

  const onSubmit = async (values: FirstLoginPasswordValues) => {
    setServerError(null);
    setSuccess(false);

    if (!csrfToken) {
      setServerError(t("errors.csrfMissing"));
      return;
    }

    let response: Response;
    try {
      response = await fetch("/api/auth/first-login-password", {
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
      setServerError(t("auth.firstLogin.error"));
      return;
    }

    if (!response.ok || body.error) {
      if (body.error?.code === "validation_error" && body.error.details) {
        const details = body.error.details as {
          fieldErrors?: Record<string, string[]>;
        };
        Object.entries(details.fieldErrors ?? {}).forEach(([field, messages]) => {
          if (messages?.[0]) {
            setError(field as keyof FirstLoginPasswordValues, { message: messages[0] });
          }
        });
        return;
      }

      const resolveApiError = (code?: string) => {
        switch (code) {
          case "unauthorized":
            return t("errors.unauthorized");
          case "password_change_not_required":
            return t("auth.firstLogin.notRequired");
          case "rate_limited":
            return t("errors.rateLimited");
          case "csrf_invalid":
            return t("errors.csrfInvalid");
          case "server_error":
            return t("errors.server");
          case "invalid_json":
            return t("errors.invalidJson");
          default:
            return t("auth.firstLogin.error");
        }
      };

      setServerError(resolveApiError(body.error?.code));
      return;
    }

    setSuccess(true);
    reset({ password: "" });
    router.push("/");
  };

  const passwordRules = useMemo(
    () => ({
      required: t("auth.passwordRequired"),
      minLength: { value: 8, message: t("auth.passwordMin") },
      maxLength: { value: 72, message: t("auth.passwordMax") },
    }),
    [t],
  );

  return (
    /*
      AC4: the invite flow's fifth screen uses the same shell and primitives as the other four, so a
      collaborator arriving from a temporary password does not drop out of the design system halfway
      through. No step pill, no tabs, no foot link — and no confirm-password field, which Screen H
      mocks for the reset screen only.
    */
    <AuthScreenShell
      heroTitle={t("auth.hero.firstLoginTitle")}
      heroSubtitle={t("auth.hero.firstLoginSubtitle")}
      title={t("auth.firstLogin.title")}
      subtitle={t("auth.firstLogin.subtitle")}
      error={serverError}
      success={success ? t("auth.firstLogin.success") : null}
    >
      <Box
        component="form"
        onSubmit={handleSubmit(onSubmit)}
        sx={{ display: "flex", flexDirection: "column", gap: "18px" }}
      >
        <AuthField
          id="first-login-password"
          label={t("auth.firstLogin.passwordLabel")}
          type="password"
          placeholder={t("auth.passwordPlaceholderMin")}
          error={errors.password?.message}
          {...register("password", passwordRules)}
        />
        <Button type="submit" variant="contained" fullWidth disabled={isSubmitting} sx={AUTH_SUBMIT_SX}>
          {isSubmitting ? <CircularProgress size={22} /> : t("auth.firstLogin.submit")}
        </Button>
      </Box>
    </AuthScreenShell>
  );
}
