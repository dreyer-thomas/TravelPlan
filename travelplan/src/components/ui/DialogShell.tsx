"use client";

import { useId, type ReactNode } from "react";
import { Box, Dialog, DialogActions, DialogContent, DialogTitle } from "@mui/material";
import { useTheme, type SxProps, type Theme } from "@mui/material/styles";

/**
 * The head/body/footer dialog chrome the authoring dialogs share (`mockups/forms-authoring.html`
 * `.dialog`, `.dialog-head`, `.dialog-body`, `.dialog-footer`).
 *
 * Story 7.5 built this inline inside `TripShareDialog` and paid for two MUI traps doing it; 7.7 needs
 * it on four more surfaces, so it is declared once here. Both traps are handled below and neither is
 * catchable in jsdom — verify them in a browser, not in a test.
 *
 * `TripShareDialog` still carries its own copy: it is in review, and converting it is a follow-up
 * sweep rather than this story's diff.
 */

export type DialogShellProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  /** The `.dialog-sub` line. Deliberately NOT part of the dialog's accessible name — see below. */
  subtitle?: string;
  /** `.dialog.w-460` / `.dialog.w-520`. */
  width: number;
  children: ReactNode;
  /** `justifyContent` is the caller's: three of the four dialogs put a destructive action far left. */
  footer: ReactNode;
  /** Merged into the footer's `sx` — this is how the caller sets `justifyContent`. */
  footerSx?: SxProps<Theme>;
  /**
   * Set when a submit or delete is in flight: blocks **both** dismissal gestures MUI reports, the
   * backdrop click and Escape. Named for the effect rather than for one of the two causes — every
   * call site pairs it with a `disabled` Cancel button, and a dialog that refuses the button while
   * honouring Escape has not actually protected the user's input.
   */
  disableDismiss?: boolean;
};

export default function DialogShell({
  open,
  onClose,
  title,
  subtitle,
  width,
  children,
  footer,
  footerSx,
  disableDismiss = false,
}: DialogShellProps) {
  const { tokens } = useTheme().palette;
  const headId = useId();
  const titleId = useId();

  return (
    <Dialog
      open={open}
      onClose={(_event, reason) => {
        if (disableDismiss && (reason === "backdropClick" || reason === "escapeKeyDown")) {
          return;
        }
        onClose();
      }}
      fullWidth
      maxWidth={false}
      // `slotProps.paper`, not the deprecated `PaperProps` (MUI 7). The explicit border is required:
      // theme.ts's MuiPaper override stamps `1px solid rgba(17,18,20,0.08)` on every Paper, and the
      // mockup's `.dialog` border is `1px solid #D9D0BE` (borderStrong).
      slotProps={{
        paper: {
          sx: {
            width: "100%",
            maxWidth: width,
            border: `1px solid ${tokens.borderStrong}`,
          },
        },
      }}
      // The sub-line lives inside the head, so the dialog is named by the title alone rather than by
      // MUI's default (the whole `DialogTitle`, sub-line included). `DialogTitle` keeps its own id so
      // MUI's context does not reassign this one.
      aria-labelledby={titleId}
    >
      <DialogTitle id={headId} sx={{ p: "20px 24px 16px", borderBottom: `1px solid ${tokens.border}` }}>
        <Box id={titleId} sx={{ fontSize: 17, fontWeight: 900, letterSpacing: "-0.2px", color: tokens.ink }}>
          {title}
        </Box>
        {subtitle ? (
          <Box sx={{ mt: "4px", fontSize: 12.5, fontWeight: 600, color: tokens.inkSoft }}>{subtitle}</Box>
        ) : null}
      </DialogTitle>

      {/*
        MUI ships `.MuiDialogTitle-root + .MuiDialogContent-root { padding-top: 0 }` at a specificity
        the plain `p` shorthand cannot beat — hence the explicit sibling selector. jsdom does not
        resolve it either way, so the top padding is a browser check, not a test.
      */}
      <DialogContent sx={{ p: "22px 24px", ".MuiDialogTitle-root + &": { pt: "22px" } }}>{children}</DialogContent>

      <DialogActions
        sx={[
          {
            p: "16px 24px",
            borderTop: `1px solid ${tokens.border}`,
            backgroundColor: tokens.cardAlt,
            // `gap` is the only spacing mechanism here. MUI's DialogActions ships
            // `& > :not(style) ~ :not(style) { margin-left: 8px }`, which would stack on top of the
            // gap and render 18px between buttons — so it is zeroed rather than re-set to 10px.
            gap: "10px",
            "& > :not(style) ~ :not(style)": { ml: 0 },
            // At xs the footer stacks and every button goes full width, primary first — a 520px
            // dialog on a 390px viewport otherwise crowds three controls onto one line. Pure sx
            // breakpoints, never useMediaQuery (deferred finding from 7.2).
            flexDirection: { xs: "column-reverse", sm: "row" },
            alignItems: { xs: "stretch", sm: "center" },
          },
          // MUI's array form, not an object spread: `SxProps` legitimately accepts an array or a
          // callback, and spreading either into an object literal drops it silently.
          ...(Array.isArray(footerSx) ? footerSx : [footerSx]),
        ]}
      >
        {footer}
      </DialogActions>
    </Dialog>
  );
}
