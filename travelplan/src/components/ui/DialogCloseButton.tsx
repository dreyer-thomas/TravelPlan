"use client";

import { Box, DialogTitle, IconButton, Tooltip } from "@mui/material";
import { useTheme, type SxProps, type Theme } from "@mui/material/styles";
import type { ReactNode } from "react";
import { CloseXIcon } from "@/components/features/trips/TripIcons";

/**
 * `DESIGN.md.Components → icon-button → close`, in one place.
 *
 * Story 6.24 built this inline inside `DialogShell` and proved it on the activity dialog. Story 6.25
 * puts it on every dialog in the app — four via the shell, eleven that build their own `<Dialog>` — and
 * eleven hand-copies of a 44px hit area, a focus ring and a tooltip wrapper would drift on the first
 * one somebody edited. It lives here so "whatever the shell does, these match it" is true by
 * construction rather than by review.
 */

export type DialogCloseButtonProps = {
  /** The accessible name. Mandatory: an unlabelled `✕` is a button with no name for anyone not looking at it. */
  label: string;
  onClose: () => void;
  /** Set while a submit or delete is in flight — the same guard the footer's `Abbrechen` used to carry. */
  disabled?: boolean;
};

/**
 * The glyph itself. Callers place it at the top right of a dialog's title row; `DialogTitleWithClose`
 * below does that for the dialogs that do not use `DialogShell`.
 */
export function DialogCloseButton({ label, onClose, disabled = false }: DialogCloseButtonProps) {
  const { tokens } = useTheme().palette;

  return (
    /*
      A real `Tooltip`, not the native `title` attribute: `title` never fires on keyboard focus and
      never on touch, so on the control that is now a dialog's only labelled-by-name dismissal it
      would reach mouse users alone. The tooltip repeats the accessible name rather than replacing
      it (DESIGN.md.Components → icon-button), so `aria-label` stays and `describeChild` is
      deliberately not set — it would make a screen reader announce the same words twice.
    */
    <Tooltip title={label} enterDelay={0}>
      {/*
        The `span` is MUI's documented requirement, not decoration: a disabled button fires no
        events, so `Tooltip` cannot listen to one and warns. It carries the flex sizing and the
        negative margins, so the head's layout is unchanged by the glyph's presence — a 44px target
        does not add 44px of head height, and the glyph stays optically on the title's first line.
      */}
      <Box component="span" sx={{ display: "inline-flex", flex: "0 0 auto", mt: "-10px", mr: "-10px" }}>
        <IconButton
          aria-label={label}
          onClick={onClose}
          disabled={disabled}
          data-testid="dialog-close"
          sx={{
            width: 44,
            height: 44,
            borderRadius: "6px",
            color: tokens.inkSoft,
            backgroundColor: "transparent",
            // DESIGN.md's `icon-button` entry: "Hover and focus follow the Accessibility Floor — the
            // app-wide focus ring, never colour alone." `theme.ts` defines that ring under
            // `MuiButton` only, and MUI's `ButtonBase` ships `outline: 0`, so an `IconButton`
            // renders no focus indicator at all unless it says so itself. Story 6.24 hit this on
            // both of its icon buttons and fixed it per-site; stating it once here is why DW-154's
            // per-site copies stop multiplying. The app-wide gap on the *other* sixteen icon buttons
            // is still DW-154 and still open — a `MuiIconButton` theme override would close it, and
            // that is a sweep of its own, not a chrome story's diff.
            "&.Mui-focusVisible": {
              outline: `2px solid ${tokens.ink}`,
              outlineOffset: "2px",
            },
          }}
        >
          <CloseXIcon sx={{ fontSize: 20 }} />
        </IconButton>
      </Box>
    </Tooltip>
  );
}

export type DialogTitleWithCloseProps = DialogCloseButtonProps & {
  /** The title line. Becomes the dialog's `<h2>`; see the note below on why it is not the head. */
  children: ReactNode;
  /**
   * Merged into the `DialogTitle`'s own `sx`.
   *
   * Story 6.25 review: this was documented as being "for the two callers that need extra padding" and
   * no caller passed it — all eleven take MUI's default head. Kept as the escape hatch the merge
   * already implements, with the claim about existing callers removed rather than left to be believed.
   */
  sx?: SxProps<Theme>;
};

/**
 * A `DialogTitle` carrying the close glyph, for the eleven dialogs that build their own `<Dialog>`
 * rather than using `DialogShell`.
 *
 * **The heading role moves down onto the title line.** MUI's `DialogTitle` is an `<h2>` and the `✕`
 * sits inside it, so name-from-content walks into the button and a screen reader navigating by
 * heading hears "Reise löschen · Schließen". `DialogShell` hit this in Story 6.24 and fixed it the
 * same way; the fix has to travel with the glyph or every one of these eleven reintroduces it.
 *
 * The title line keeps `typography: h6` and `m: 0`, which is exactly what MUI's `DialogTitle`
 * rendered before — these dialogs are unstyled MUI heads, not the token-styled `.dialog-head` the
 * shell draws, and this story is not the one that reconciles them.
 */
export function DialogTitleWithClose({ children, label, onClose, disabled = false, sx }: DialogTitleWithCloseProps) {
  return (
    <DialogTitle
      component="div"
      sx={[{ display: "flex", alignItems: "flex-start", gap: "12px" }, ...(Array.isArray(sx) ? sx : [sx])]}
    >
      {/* `minWidth: 0` so a long title wraps instead of pushing the glyph off the row. */}
      <Box component="h2" sx={{ flex: 1, minWidth: 0, typography: "h6", m: 0 }}>
        {children}
      </Box>
      <DialogCloseButton label={label} onClose={onClose} disabled={disabled} />
    </DialogTitle>
  );
}

export default DialogCloseButton;
