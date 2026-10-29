"use client";

import { Box, Typography, useTheme } from "@mui/material";
import { formatMessage } from "@/i18n";
import { useI18n } from "@/i18n/provider";

type AccountSummaryProps = {
  email: string;
};

/**
 * Story 15.3. The head of the account page: its only `h1` and the signed-in email. A client component for
 * the same reason the other list cards are - the UI language and the theme tokens live in client context.
 */
export default function AccountSummary({ email }: AccountSummaryProps) {
  const { t } = useI18n();
  const { tokens } = useTheme().palette;

  return (
    <Box
      sx={{
        backgroundColor: tokens.card,
        border: `1px solid ${tokens.borderStrong}`,
        borderRadius: "8px",
        padding: "18px",
      }}
    >
      <Typography variant="labelCaps" component="h1" sx={{ color: tokens.inkSoft }}>
        {t("account.title")}
      </Typography>
      <Typography variant="body2" component="div" sx={{ mt: "4px", color: tokens.ink }}>
        {formatMessage(t("account.signedInAs"), { email })}
      </Typography>
    </Box>
  );
}
