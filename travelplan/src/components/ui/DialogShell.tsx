"use client";

import { useId, type ReactNode } from "react";
import { Box, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Tooltip } from "@mui/material";
import { useTheme, type SxProps, type Theme } from "@mui/material/styles";
import { CloseXIcon } from "@/components/features/trips/TripIcons";

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
  /**
   * Story 6.24. When set, the title row carries `DESIGN.md.Components → icon-button → close`: a
   * 44x44 `✕` at the top right that calls `onClose`, named by this string.
   *
   * Opt-in rather than unconditional, and that is temporary. Story 6.24 proves the affordance — and
   * the dirty-form confirmation EXPERIENCE.md attaches to it — on the activity dialog alone; Story
   * 6.25 carries it to every consumer, at which point this becomes required and the dialogs that
   * build their own `Dialog` are brought into line with it. Making it unconditional here would have
   * put a `✕` on the three other surfaces that use this shell, in a story whose AC9 says nothing
   * else changes.
   *
   * The counts, since they scope Story 6.25 and the story record got them wrong twice: **four**
   * `<DialogShell` call sites (`TripDayView`, `TripAccommodationDialog`, `TripCreateDialog` and
   * `TripDayPlanDialog`), so three others — not five, and `FullscreenPhotoViewer` and
   * `TripCostOverview` are not among them. And **14** raw `<Dialog>` sites across 11 files, two of
   * them inside `TripDayPlanDialog` itself (the move picker and the discard confirmation), neither of
   * which 6.25's Task 2 originally named.
   *
   * It shares `onClose` rather than taking a handler of its own: backdrop click, Escape and the
   * glyph are one outcome, so a caller guarding one of them (as the activity dialog now does)
   * guards all three by construction. `FullscreenPhotoViewer` already has its own close control and
   * must not pass this.
   */
  closeLabel?: string;
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
  closeLabel,
}: DialogShellProps) {
  const { tokens } = useTheme().palette;
  const headId = useId();
  const titleId = useId();

  /**
   * With a `closeLabel`, `DialogTitle` stops being the heading and the title line becomes it.
   *
   * MUI's `DialogTitle` is an `<h2>`, and the `✕` sits inside it — so the glyph's accessible name
   * joins the *heading's* name and a screen reader navigating by heading hears "Add stay · Day 3 ·
   * Close". (The dialog's own name is safe either way: `aria-labelledby` points at the title line
   * alone.) Moving the heading role down onto the title line fixes it at the source, and is the same
   * defect class as 7.5's #1 one level up.
   *
   * Only when `closeLabel` is set, so the three consumers that do not pass one keep the DOM they had
   * before Story 6.24 — `formPrimitives.test.tsx` holds both shapes. Story 6.25 makes the prop
   * required, at which point this branch becomes the only shape and the conditional goes.
   */
  const titleBlock = (
    <>
      <Box
        id={titleId}
        component={closeLabel ? "h2" : "div"}
        sx={{
          fontSize: 17,
          fontWeight: 900,
          letterSpacing: "-0.2px",
          color: tokens.ink,
          // A real `h2` brings the browser's own margin with it; the design's spacing is the head's.
          ...(closeLabel ? { m: 0 } : null),
        }}
      >
        {title}
      </Box>
      {subtitle ? (
        <Box sx={{ mt: "4px", fontSize: 12.5, fontWeight: 600, color: tokens.inkSoft }}>{subtitle}</Box>
      ) : null}
    </>
  );

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
      {/*
        The head keeps its padding, its `borderBottom` and its two ids in both shapes. Without a
        `closeLabel` it renders exactly what it rendered before Story 6.24 — the three consumers that
        do not pass one are byte-identical, which is what let this land without touching them, and
        `formPrimitives.test.tsx` asserts that against real MUI rather than leaving it to inspection.
      */}
      <DialogTitle
        id={headId}
        // See `titleBlock`: with a `✕` inside it, an `<h2>` head would take the glyph's name into the
        // heading's, so the heading role moves down to the title line and this becomes a plain box.
        component={closeLabel ? "div" : "h2"}
        sx={{
          p: "20px 24px 16px",
          borderBottom: `1px solid ${tokens.border}`,
          ...(closeLabel ? { display: "flex", alignItems: "flex-start", gap: "12px" } : null),
        }}
      >
        {closeLabel ? (
          <>
            {/* `minWidth: 0` so a long title wraps instead of pushing the glyph off the row. */}
            <Box sx={{ flex: 1, minWidth: 0 }}>{titleBlock}</Box>
            {/*
              `icon-button.close`, per DESIGN.md: 44x44, ~20px glyph, {colors.ink-soft}, no fill and
              no border at rest, and a mandatory accessible name. The negative margins pull the hit
              area back into the head's own padding so a 44px target does not add 44px of head
              height — the glyph stays optically on the title's first line.

              Disabled while `disableDismiss`, which is the same guard the footer's Cancel button
              used to carry: a dialog that refuses Escape while honouring the `✕` has not protected
              anyone's input.

              A real `Tooltip`, not the native `title` attribute: `title` never fires on keyboard
              focus and never on touch, so on the control that is now a dialog's only labelled-by-
              name dismissal it would reach mouse users alone. `TripDayMapPanel` and
              `TripOverviewMapPanel` already use this shape for their icon-only buttons. The tooltip
              repeats the accessible name rather than replacing it (DESIGN.md.Components →
              icon-button), so `aria-label` stays and `describeChild` is deliberately not set — it
              would make a screen reader announce the same words twice.
            */}
            <Tooltip title={closeLabel} enterDelay={0}>
              {/*
                The `span` is MUI's documented requirement, not decoration: a disabled button fires
                no events, so `Tooltip` cannot listen to one and warns. It carries the flex sizing
                and the negative margins so the head's layout is unchanged by its presence.
              */}
              <Box
                component="span"
                sx={{ display: "inline-flex", flex: "0 0 auto", mt: "-10px", mr: "-10px" }}
              >
                <IconButton
                  aria-label={closeLabel}
                  onClick={onClose}
                  disabled={disableDismiss}
                  data-testid="dialog-shell-close"
                  sx={{
                    width: 44,
                    height: 44,
                    borderRadius: "6px",
                    color: tokens.inkSoft,
                    backgroundColor: "transparent",
                    // DESIGN.md's `icon-button` entry: "Hover and focus follow the Accessibility
                    // Floor — the app-wide focus ring, never colour alone." `theme.ts` defines that
                    // ring under `MuiButton` only, and MUI's `ButtonBase` ships `outline: 0`, so an
                    // `IconButton` renders no focus indicator at all unless it says so itself — the
                    // same reason `TripIcons`' on-photo chrome spells its own out. Repeated here
                    // rather than added as a `MuiIconButton` theme override because that would put a
                    // ring on sixteen other icon buttons across the app, which Story 6.24's AC9 does
                    // not cover; the app-wide gap is logged as DW-154.
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
          </>
        ) : (
          titleBlock
        )}
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
