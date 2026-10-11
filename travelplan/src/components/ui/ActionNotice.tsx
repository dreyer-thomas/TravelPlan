"use client";

import { Box, Button, IconButton, Tooltip, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { CloseXIcon, WarningTriangleIcon } from "@/components/features/trips/TripIcons";

/**
 * `DESIGN.md.Components → action-notice` (Story 11.1). Feedback for a save that did more than the user
 * typed: a summary of the consequences, an optional warning line, a trailing text action that reverses
 * them, and a close icon-button.
 *
 * **Not an error, and it does not borrow the error treatment.** The save succeeded; this reports what it
 * did besides. So no `Alert severity=…`, no error colours — a plain card panel with a strong border.
 *
 * **No auto-dismiss.** Its action is the only way to take the change back, so it stays until the caller
 * removes it (close, leaving the day, another write). The component holds no timer and no state.
 *
 * The close button copies `DialogCloseButton`'s glyph, hit area and tooltip, but is not that component:
 * that one carries dialog-head offsets and `data-testid="dialog-close"`, both wrong outside a dialog.
 */

export type ActionNoticeProps = {
  /** The summary line. Announced through `role="status"`. */
  summary: string;
  /** Optional second line in the warning colour, with the small alert icon. Story 11.2 uses it. */
  warning?: string;
  /** The trailing text action ("Rückgängig"). Omitted, the notice shows no action — e.g. once stale. */
  actionLabel?: string;
  onAction?: () => void;
  /** Disables the action while its request is in flight, so a double click cannot send it twice. */
  actionPending?: boolean;
  onClose: () => void;
  /** The close button's accessible name. Mandatory: an unlabelled `✕` has no name for a screen reader. */
  closeLabel: string;
};

export function ActionNotice({
  summary,
  warning,
  actionLabel,
  onAction,
  actionPending = false,
  onClose,
  closeLabel,
}: ActionNoticeProps) {
  const theme = useTheme();
  const { tokens } = theme.palette;

  return (
    <Box
      role="status"
      data-testid="action-notice"
      sx={{
        // `rounded.md` has no theme token; the literal matches the day frame (`TripDayView.tsx`).
        borderRadius: "8px",
        backgroundColor: tokens.card,
        border: `1px solid ${tokens.borderStrong}`,
        // `spacing.card-padding`, a literal for the same reason.
        padding: "18px",
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 1,
      }}
    >
      <Box sx={{ flex: "1 1 240px", minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
        <Typography variant="body2" sx={{ color: tokens.ink }}>
          {summary}
        </Typography>
        {warning ? (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <WarningTriangleIcon sx={{ fontSize: 16, color: theme.palette.warning.main }} />
            <Typography variant="body2" sx={{ color: theme.palette.warning.main }}>
              {warning}
            </Typography>
          </Box>
        ) : null}
      </Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, ml: "auto" }}>
        {actionLabel && onAction ? (
          <Button variant="text" onClick={onAction} disabled={actionPending} data-testid="action-notice-undo">
            {actionLabel}
          </Button>
        ) : null}
        <Tooltip title={closeLabel} enterDelay={0}>
          <IconButton
            aria-label={closeLabel}
            onClick={onClose}
            data-testid="action-notice-close"
            sx={{
              width: 44,
              height: 44,
              borderRadius: "6px",
              color: tokens.inkSoft,
              backgroundColor: "transparent",
            }}
          >
            <CloseXIcon sx={{ fontSize: 20 }} />
          </IconButton>
        </Tooltip>
      </Box>
    </Box>
  );
}

export default ActionNotice;
