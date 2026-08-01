"use client";

import type { ReactNode } from "react";
import { Box, Typography } from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import { CheckIcon, HERO_SCRIM, toCssUrl, WarningTriangleIcon } from "@/components/features/trips/TripIcons";
import { useI18n } from "@/i18n/provider";

/**
 * The two-column hero/form split every auth screen renders inside (Screen E and Screen H).
 *
 * This is the ONE place the split layout, hero photo, scrim, card, notices and foot treatment are
 * declared. All five auth pages consume it; none re-declares the hero. It only works because the
 * pages live in the `(auth)` route group, which has no `AppHeader` ancestor (Story 7.6, AC3).
 */

const HERO_IMAGE = "/hero-mountains.jpg";

type AuthNoticeProps = {
  tone: "warn" | "success";
  message: string;
};

/**
 * Non-field messages sit at the top of the surface (EXPERIENCE.md:86) and never auto-dismiss.
 *
 * Deliberately NOT a MUI `<Alert severity="error">`: `theme.ts` defines no `error` palette entry, so
 * MUI would fall back to its default #d32f2f red — a colour absent from DESIGN.md. The warn family is
 * what the design system has. `role="alert"` is the semantics the previous `<Alert>` carried and is
 * preserved here, so a server error is still announced when it appears.
 */
function AuthNotice({ tone, message }: AuthNoticeProps) {
  const theme = useTheme();
  const isWarn = tone === "warn";

  return (
    <Box
      role="alert"
      sx={{
        display: "flex",
        alignItems: "flex-start",
        gap: "10px",
        padding: "12px 14px",
        borderRadius: "8px",
        mb: "18px",
        backgroundColor: isWarn ? theme.palette.tokens.warnBg : theme.palette.tokens.accentSoft,
        border: `1px solid ${isWarn ? theme.palette.tokens.warnBorder : alpha(theme.palette.primary.main, 0.24)}`,
        color: isWarn ? theme.palette.warning.main : theme.palette.primary.main,
      }}
    >
      {isWarn ? (
        <WarningTriangleIcon sx={{ fontSize: 16, flexShrink: 0, mt: "1px" }} />
      ) : (
        <CheckIcon sx={{ fontSize: 16, flexShrink: 0, mt: "1px" }} />
      )}
      <Typography sx={{ fontSize: 12, fontWeight: 700, lineHeight: 1.5, color: "inherit" }}>{message}</Typography>
    </Box>
  );
}

export type AuthScreenShellProps = {
  heroTitle: string;
  heroSubtitle: string;
  title: string;
  subtitle: string;
  tabs?: ReactNode;
  stepLabel?: string;
  error?: string | null;
  success?: string | null;
  footer?: ReactNode;
  children: ReactNode;
};

export default function AuthScreenShell({
  heroTitle,
  heroSubtitle,
  title,
  subtitle,
  tabs,
  stepLabel,
  error,
  success,
  footer,
  children,
}: AuthScreenShellProps) {
  const theme = useTheme();
  const { t } = useI18n();

  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
        // Below md the two columns stack, and without an explicit row template the grid's default
        // `align-content: stretch` splits the full 100dvh between them — the hero band measured
        // 236-322px instead of the intended ~180px. `auto 1fr` sizes the hero to its content (floored
        // at 180 below) and gives the form column every remaining pixel.
        gridTemplateRows: { xs: "auto 1fr", md: "1fr" },
        minHeight: "100dvh",
      }}
    >
      {/*
        Hero photo is decorative (DESIGN.md.Photo Alt-Text lists the login/reset side panels): a CSS
        background on a <div>, no <img>, nothing to label and nothing announced. The accent fill is
        the pre-load colour so the white hero text never lands on bare paper.
      */}
      <Box
        sx={{
          position: "relative",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
          minHeight: { xs: 180, md: "auto" },
          padding: { xs: "20px", md: "32px" },
          backgroundColor: theme.palette.primary.main,
          backgroundImage: toCssUrl(HERO_IMAGE),
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        {/* The mandatory four-stop scrim. Not a literal — see HERO_SCRIM's docstring on why the top stop exists. */}
        <Box aria-hidden sx={{ position: "absolute", inset: 0, background: HERO_SCRIM }} />

        <Box sx={{ position: "relative", zIndex: 2 }}>
          <Typography
            component="p"
            sx={{
              fontSize: 13,
              fontWeight: 900,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "#FFFFFF",
              mb: { xs: "10px", md: "18px" },
            }}
          >
            {t("app.brand")}
          </Typography>
          <Typography
            component="p"
            sx={{
              fontSize: { xs: 19, md: 26 },
              fontWeight: 900,
              letterSpacing: "-0.4px",
              color: "#FFFFFF",
              textShadow: "0 2px 14px rgba(0,0,0,.35)",
              maxWidth: 320,
              mb: "10px",
            }}
          >
            {heroTitle}
          </Typography>
          {/*
            Hidden below md: EXPERIENCE.md:19 mocked desktop only, and on a 390px screen a hero tall
            enough for the sub-line pushes the email field below the fold. Pure sx breakpoints — no
            useMediaQuery (deferred finding from 7.2).
          */}
          <Typography
            component="p"
            sx={{
              display: { xs: "none", md: "block" },
              fontSize: 13,
              fontWeight: 600,
              lineHeight: 1.5,
              color: "rgba(255,255,255,.88)",
              maxWidth: 300,
            }}
          >
            {heroSubtitle}
          </Typography>
        </Box>
      </Box>

      <Box
        sx={{
          backgroundColor: theme.palette.background.default,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: { xs: "32px 20px", md: "40px" },
        }}
      >
        {/*
          A plain Box, not a Paper: theme.ts's MuiPaper override stamps a border on every Paper, which
          is why 7.3, 7.8 and 7.9 all build card surfaces this way.
        */}
        <Box sx={{ width: "100%", maxWidth: 340 }}>
          {tabs}

          {stepLabel ? (
            <Box
              sx={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                fontSize: 10.5,
                fontWeight: 800,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: theme.palette.primary.main,
                backgroundColor: theme.palette.tokens.accentSoft,
                padding: "5px 10px",
                borderRadius: "5px",
                mb: "14px",
              }}
            >
              {stepLabel}
            </Box>
          ) : null}

          {/* component="h1" is required: the custom variants have no variantMapping and would render a <span>. */}
          <Typography
            component="h1"
            sx={{
              fontSize: 21,
              fontWeight: 900,
              letterSpacing: "-0.3px",
              color: theme.palette.tokens.ink,
              m: 0,
              mb: "6px",
            }}
          >
            {title}
          </Typography>
          <Typography
            component="p"
            sx={{
              fontSize: 12.5,
              fontWeight: 600,
              lineHeight: 1.5,
              color: theme.palette.tokens.inkSoft,
              mb: "22px",
            }}
          >
            {subtitle}
          </Typography>

          {error ? <AuthNotice tone="warn" message={error} /> : null}
          {success ? <AuthNotice tone="success" message={success} /> : null}

          {children}

          {footer ? (
            <Box
              sx={{
                mt: "16px",
                textAlign: "center",
                fontSize: 12,
                fontWeight: 600,
                color: theme.palette.tokens.inkSoft,
                "& a": { color: theme.palette.primary.main, fontWeight: 700 },
              }}
            >
              {footer}
            </Box>
          ) : null}
        </Box>
      </Box>
    </Box>
  );
}
