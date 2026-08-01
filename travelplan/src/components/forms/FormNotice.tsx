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
 * Deliberately NOT a MUI `<Alert severity="error">`. The original reason was that `theme.ts` had no
 * `error` palette entry, so MUI fell back to its default #d32f2f red; Story 7.11 added one
 * (`colors.errorBorder`), so that particular argument no longer holds. The component stays as it is
 * regardless: DESIGN.md's treatment for a *form-level* notice is the warn family, which is what this
 * renders, and the app now carries two error idioms — this one for form/dialog notices and `<Alert>`
 * for surface-level load and action failures. Picking one of them to win app-wide is a UX decision,
 * not a refactor, and it is deliberately not made here.
 *
 * `role="alert"` is the semantics the previous `<Alert>` carried and is preserved, so a server error
 * is still announced when it appears.
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
