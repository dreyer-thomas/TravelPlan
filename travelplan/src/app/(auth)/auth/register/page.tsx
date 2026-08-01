"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import Link from "next/link";
import { Box, Button, Checkbox, CircularProgress, FormControlLabel } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import FormField from "@/components/forms/FormField";
import AuthScreenShell from "@/components/features/auth/AuthScreenShell";
import { AUTH_SUBMIT_SX } from "@/components/features/auth/authSubmitSx";
import AuthTabs from "@/components/features/auth/AuthTabs";
import { WarningTriangleIcon } from "@/components/features/trips/TripIcons";
import { useI18n } from "@/i18n/provider";

type RegisterFormValues = {
  email: string;
  password: string;
  consent: boolean;
};

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

/** Ties the consent error to the checkbox the way `FormField`'s `id`/`helperText` pair does. */
const CONSENT_ERROR_ID = "register-consent-error";

export default function RegisterPage() {
  const router = useRouter();
  const theme = useTheme();
  const { t } = useI18n();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
    reset,
  } = useForm<RegisterFormValues>({
    defaultValues: {
      email: "",
      password: "",
      consent: false,
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
        setServerError(t("auth.register.initError"));
      }
    };

    fetchCsrf();
  }, []);

  const onSubmit = async (values: RegisterFormValues) => {
    setServerError(null);
    setSuccess(false);

    if (!csrfToken) {
      setServerError(t("errors.csrfMissing"));
      return;
    }

    const response = await fetch("/api/auth/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify(values),
    });

    const body = (await response.json()) as ApiEnvelope<{ userId: string }>;

    if (!response.ok || body.error) {
      if (body.error?.code === "validation_error" && body.error.details) {
        const details = body.error.details as {
          fieldErrors?: Record<string, string[]>;
        };
        Object.entries(details.fieldErrors ?? {}).forEach(([field, messages]) => {
          if (messages?.[0]) {
            setError(field as keyof RegisterFormValues, { message: messages[0] });
          }
        });
        return;
      }

      const resolveApiError = (code?: string) => {
        switch (code) {
          case "email_exists":
            return t("auth.register.emailExists");
          case "rate_limited":
            return t("errors.rateLimited");
          case "csrf_invalid":
            return t("errors.csrfInvalid");
          case "server_error":
            return t("errors.server");
          case "invalid_json":
            return t("errors.invalidJson");
          default:
            return t("auth.register.error");
        }
      };

      setServerError(resolveApiError(body.error?.code));
      return;
    }

    setSuccess(true);
    reset({ email: "", password: "", consent: false });
    router.push("/auth/login");
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
      heroTitle={t("auth.hero.registerTitle")}
      heroSubtitle={t("auth.hero.registerSubtitle")}
      title={t("auth.register.title")}
      subtitle={t("auth.register.subtitle")}
      tabs={<AuthTabs active="register" />}
      error={serverError}
      success={success ? t("auth.register.success") : null}
      footer={
        <Box component="p" sx={{ m: 0 }}>
          {t("auth.register.haveAccount")} <Link href="/auth/login">{t("auth.register.loginLink")}</Link>
        </Box>
      }
    >
      <Box
        component="form"
        onSubmit={handleSubmit(onSubmit)}
        sx={{ display: "flex", flexDirection: "column", gap: "18px" }}
      >
        <FormField
          id="register-email"
          autoComplete="email"
          label={t("auth.emailLabel")}
          type="email"
          placeholder={t("auth.emailPlaceholder")}
          error={errors.email?.message}
          {...register("email", emailRules)}
        />
        <FormField
          id="register-password"
          autoComplete="new-password"
          label={t("auth.passwordLabel")}
          type="password"
          placeholder={t("auth.passwordPlaceholderMin")}
          error={errors.password?.message}
          {...register("password", passwordRules)}
        />
        {/*
          The consent checkbox stays: `registerSchema` requires `consent: z.literal(true)`. Screen E
          replaces it with a passive `.register-note`, but that is a mockup shortcut against a form
          with no consent field — so it is restyled here rather than dropped, and the separate note
          line is omitted because `auth.consentLabel` already states the same commitment.
          The whole row is the click target at a 44px minimum (DESIGN.md.components.checkbox).
        */}
        <Box>
          <FormControlLabel
            control={
              <Checkbox
                {...register("consent", { required: t("auth.consentRequired") })}
                // FormField gets this pairing free from MUI's `helperText`/`id` wiring; a hand-rolled
                // error Box does not. Without it the one hard blocker on the screen is the one error
                // a screen-reader user is never told about.
                slotProps={{
                  input: {
                    "aria-invalid": errors.consent ? true : undefined,
                    "aria-describedby": errors.consent ? CONSENT_ERROR_ID : undefined,
                  },
                }}
              />
            }
            label={t("auth.consentLabel")}
            sx={{
              m: 0,
              // Cancels MuiCheckbox's 12px touch padding so the glyph lines up with the field edges
              // above it (`.checkbox-row` sits flush in the mockup). The padding itself stays — it is
              // what makes the row a 44px target.
              ml: "-12px",
              minHeight: 44,
              alignItems: "center",
              "& .MuiFormControlLabel-label": {
                fontSize: 13,
                fontWeight: 600,
                color: theme.palette.tokens.ink,
              },
            }}
          />
          {errors.consent && (
            // Same warn-toned error-hint treatment FormField uses — not MUI's `color="error"` red.
            <Box
              id={CONSENT_ERROR_ID}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: "5px",
                mt: "2px",
                fontSize: 11,
                fontWeight: 700,
                color: theme.palette.warning.main,
              }}
            >
              <WarningTriangleIcon sx={{ fontSize: 12, flexShrink: 0 }} />
              {errors.consent.message}
            </Box>
          )}
        </Box>
        <Button type="submit" variant="contained" fullWidth disabled={isSubmitting} sx={AUTH_SUBMIT_SX}>
          {isSubmitting ? <CircularProgress size={22} /> : t("auth.register.submit")}
        </Button>
      </Box>
    </AuthScreenShell>
  );
}
