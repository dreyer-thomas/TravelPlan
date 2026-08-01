"use client";

import { Box, Typography } from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import { CheckIcon, WarningTriangleIcon } from "@/components/features/trips/TripIcons";

/**
 * Non-field messages sit at the top of the surface (EXPERIENCE.md:86) and never auto-dismiss.
 *
 * Landed by Story 7.6 inside `AuthScreenShell`; extracted here by 7.7 so the trip-create dialog gets
 * the same treatment instead of a second copy. The shell now imports it; its rendered output is
 * unchanged.
 *
 * Deliberately NOT a MUI `<Alert severity="error">`: `theme.ts` defines no `error` palette entry, so
 * MUI would fall back to its default #d32f2f red — a colour absent from DESIGN.md. The warn family is
 * what the design system has. `role="alert"` is the semantics the previous `<Alert>` carried and is
 * preserved here, so a server error is still announced when it appears.
 */

export type FormNoticeProps = {
  tone: "warn" | "success";
  message: string;
};

export default function FormNotice({ tone, message }: FormNoticeProps) {
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
