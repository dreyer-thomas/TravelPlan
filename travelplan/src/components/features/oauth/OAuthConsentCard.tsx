"use client";

import { useEffect, useState } from "react";
import { Alert, Box, Button, CircularProgress, Typography } from "@mui/material";
import AuthScreenShell from "@/components/features/auth/AuthScreenShell";
import { formatMessage } from "@/i18n";
import { useI18n } from "@/i18n/provider";
import { assignLocation } from "@/lib/browser/assignLocation";

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

export type OAuthConsentCardProps =
  | { mode: "error"; reason: string }
  | {
      mode: "consent";
      query: string;
      clientName: string;
      clientHost: string;
      redirectHost: string;
      email: string;
      loopbackWarning: boolean;
    };

/**
 * Story 15.1, AC 11-12. The consent screen of the connector's authorization step, in the sign-in card.
 *
 * The client's name is self-asserted, so it is always shown next to the host of its `client_id`, which is
 * not. The decision goes to the server with the original query string; the server validates it again and
 * answers with the URL to go to, which is always the client's verified redirect URI on another origin, hence
 * a full navigation (`assignLocation`) rather than the router.
 */
export default function OAuthConsentCard(props: OAuthConsentCardProps) {
  const { t } = useI18n();
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (props.mode !== "consent") return;
    const fetchCsrf = async () => {
      try {
        const response = await fetch("/api/auth/csrf", { method: "GET" });
        const body = (await response.json()) as ApiEnvelope<{ csrfToken: string }>;
        if (body.data?.csrfToken) setCsrfToken(body.data.csrfToken);
        else setFailed(true);
      } catch {
        // Without a token both buttons stay disabled; say so instead of leaving a dead card.
        setCsrfToken(null);
        setFailed(true);
      }
    };
    void fetchCsrf();
  }, [props.mode]);

  if (props.mode === "error") {
    return (
      <AuthScreenShell
        heroTitle={t("oauth.consent.heroTitle")}
        heroSubtitle={t("oauth.consent.heroSubtitle")}
        title={t("oauth.error.title")}
        subtitle={t("oauth.error.subtitle")}
        error={t(`oauth.error.${props.reason}`)}
      >
        <Box />
      </AuthScreenShell>
    );
  }

  const decide = async (decision: "allow" | "deny") => {
    if (!csrfToken || pending) return;
    setPending(true);
    setFailed(false);
    try {
      const response = await fetch("/api/oauth/authorize/decision", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
        body: JSON.stringify({ query: props.query, decision }),
      });
      const body = (await response.json()) as ApiEnvelope<{ redirectUrl: string }>;
      if (!response.ok || !body.data?.redirectUrl) {
        setFailed(true);
        setPending(false);
        return;
      }
      assignLocation(body.data.redirectUrl);
    } catch {
      setFailed(true);
      setPending(false);
    }
  };

  return (
    <AuthScreenShell
      heroTitle={t("oauth.consent.heroTitle")}
      heroSubtitle={t("oauth.consent.heroSubtitle")}
      title={formatMessage(t("oauth.consent.title"), { client: props.clientName })}
      subtitle={formatMessage(t("oauth.consent.subtitle"), { email: props.email })}
      error={failed ? t("oauth.consent.failed") : null}
    >
      <Box sx={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        <Typography variant="body2" data-testid="oauth-client-host">
          {formatMessage(t("oauth.consent.clientHost"), { host: props.clientHost })}
        </Typography>
        <Typography variant="body2" data-testid="oauth-redirect-host">
          {formatMessage(t("oauth.consent.redirectHost"), { host: props.redirectHost })}
        </Typography>
        <Box>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {t("oauth.consent.permissionIntro")}
          </Typography>
          <Typography variant="body2" component="ul" sx={{ m: 0, pl: "20px" }}>
            <li>{t("oauth.consent.permission")}</li>
          </Typography>
        </Box>
        {props.loopbackWarning ? <Alert severity="warning">{t("oauth.consent.loopbackWarning")}</Alert> : null}
        <Box sx={{ display: "flex", gap: "12px", mt: "6px" }}>
          <Button
            variant="outlined"
            fullWidth
            disabled={!csrfToken || pending}
            onClick={() => decide("deny")}
          >
            {t("oauth.consent.deny")}
          </Button>
          <Button
            variant="contained"
            fullWidth
            disabled={!csrfToken || pending}
            aria-busy={pending}
            onClick={() => decide("allow")}
          >
            {pending ? <CircularProgress size={22} /> : t("oauth.consent.allow")}
          </Button>
        </Box>
      </Box>
    </AuthScreenShell>
  );
}
