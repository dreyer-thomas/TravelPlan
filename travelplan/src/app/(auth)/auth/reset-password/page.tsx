"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Box, Button, CircularProgress } from "@mui/material";
import FormField from "@/components/forms/FormField";
import AuthScreenShell from "@/components/features/auth/AuthScreenShell";
import { AUTH_SUBMIT_SX } from "@/components/features/auth/authSubmitSx";
import { useI18n } from "@/i18n/provider";

type ResetPasswordValues = {
  token: string;
  password: string;
  /**
   * Client-side only (Screen H Step B). `passwordResetConfirmSchema` accepts `{ token, password }`;
   * the request body is built explicitly below so this never reaches the API.
   */
  confirmPassword: string;
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
      confirmPassword: "",
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
        // Built explicitly rather than forwarding `values`: `confirmPassword` is a client-side check
        // and must not be sent to the API.
        body: JSON.stringify({ token: values.token, password: values.password }),
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
    reset({ token: "", password: "", confirmPassword: "" });
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
      // Re-runs the mismatch check on `confirmPassword` whenever THIS field changes. RHF's `deps`
      // points at the fields to re-validate, so it belongs here and not on the confirm rule: without
      // it, a user who resolves a mismatch by editing the password field keeps staring at "Passwords
      // do not match" until they touch the confirm field again. (Submitting always succeeded — the
      // error was stale, not blocking — but it reads as a stuck form.) Only takes effect after a
      // first failed submit, since the form's default mode does not validate before then.
      deps: ["confirmPassword" as const],
    }),
    [t],
  );

  const confirmPasswordRules = useMemo(
    () => ({
      required: t("auth.reset.confirmRequired"),
      // `validate` receives (value, formValues), which reads `password` without a `watch`.
      validate: (value: string, values: ResetPasswordValues) =>
        value === values.password || t("auth.reset.confirmMismatch"),
    }),
    [t],
  );

  /**
   * When the token arrives in the URL its input is hidden, so `errors.token` has nowhere to render.
   * `setError("token", …)` can still fire from the API's `validation_error` details (a whitespace-only
   * `?token=` passes RHF's `required` but fails `passwordResetConfirmSchema`'s `.trim().min(1)`), and
   * the client-side `required` fires after a successful reset clears the field. Without this the
   * submit would spin and leave the screen completely unchanged.
   */
  const hiddenTokenError = initialToken ? errors.token?.message : undefined;

  return (
    <AuthScreenShell
      heroTitle={t("auth.hero.resetTitle")}
      heroSubtitle={t("auth.hero.resetSubtitle")}
      title={t("auth.reset.title")}
      // Deliberately generic. Screen H Step B's sub-line names the account's email and the link's
      // remaining validity; no endpoint exposes either, and one that did would be a token-validity
      // oracle for unauthenticated callers.
      subtitle={t("auth.reset.subtitle")}
      stepLabel={t("auth.reset.step")}
      error={serverError ?? hiddenTokenError ?? null}
      // Says what actually happens: `POST /api/auth/password-reset/confirm` issues no session, so the
      // mockup's "you will be signed in automatically" promise is not made here.
      success={success ? t("auth.reset.success") : null}
      footer={
        <Box component="p" sx={{ m: 0 }}>
          <Link href="/auth/login">{t("auth.backToLogin")}</Link>
        </Box>
      }
    >
      <Box
        component="form"
        onSubmit={handleSubmit(onSubmit)}
        sx={{ display: "flex", flexDirection: "column", gap: "18px" }}
      >
        {/*
          Screen H Step B shows no token field, because the emailed link carries it. The registration
          is kept either way — `passwordResetConfirmSchema` requires `token` — so a user who arrives
          without one can still enter it manually and `auth.reset.tokenRequired` stays reachable.
        */}
        {initialToken ? (
          <input type="hidden" {...register("token", tokenRules)} />
        ) : (
          <FormField
            id="reset-token"
            autoComplete="off"
            label={t("auth.reset.tokenLabel")}
            error={errors.token?.message}
            {...register("token", tokenRules)}
          />
        )}
        <FormField
          id="reset-password"
          autoComplete="new-password"
          label={t("auth.reset.newPassword")}
          type="password"
          placeholder={t("auth.passwordPlaceholderMin")}
          error={errors.password?.message}
          {...register("password", passwordRules)}
        />
        <FormField
          id="reset-confirm-password"
          autoComplete="new-password"
          label={t("auth.reset.confirmPassword")}
          type="password"
          placeholder={t("auth.reset.confirmPlaceholder")}
          error={errors.confirmPassword?.message}
          {...register("confirmPassword", confirmPasswordRules)}
        />
        <Button type="submit" variant="contained" fullWidth disabled={isSubmitting} sx={AUTH_SUBMIT_SX}>
          {isSubmitting ? <CircularProgress size={22} /> : t("auth.reset.submit")}
        </Button>
      </Box>
    </AuthScreenShell>
  );
}
