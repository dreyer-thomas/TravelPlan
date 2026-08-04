"use client";

import { useCallback, useState } from "react";
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { useI18n } from "@/i18n/provider";

/**
 * `EXPERIENCE.md.State Patterns → "Dismissing a dialog with unsaved input"`, in one place.
 *
 * **Ask once, and only if there is something to lose.** An untouched form closes silently; a form the
 * user has typed into confirms first, naming what goes, with the keeping answer as the safe one. The
 * pattern exists because the dismissal moved from a labelled footer button to a 44px glyph in the
 * corner: easier to hit by accident, and carrying no word that names the consequence.
 *
 * Story 6.24 proved it on the activity dialog, inline. Story 6.25 owes it to nine more form dialogs
 * (AC7), and nine copies of a two-button confirmation plus its open/keep/discard state would drift —
 * and the drift is silent, because the failure mode is a `✕` that throws typing away without asking.
 *
 * `useDiscardGuard` owns the state and the decision; `DiscardChangesDialog` draws the question.
 */

export type DiscardGuard = {
  /**
   * Pass this wherever the dialog's dismissal is wired — the `✕`, the `<Dialog onClose>` (which is
   * both the backdrop and Escape), and any footer button that abandons rather than commits. All of
   * them are one outcome, so all of them ask the same question.
   */
  requestClose: () => void;
  /** Spread onto `<DiscardChangesDialog {...guard.dialogProps} />`. */
  dialogProps: { open: boolean; onKeep: () => void; onDiscard: () => void };
};

/**
 * @param isDirty Whether the form holds input the user would lose. Read at click time, so it must be
 *   a value the render already has — react-hook-form's `formState.isDirty` for the dialogs that use
 *   it, an explicit comparison against the values the dialog opened with for the ones that do not.
 * @param onClose The unguarded close. A committed decision (a successful save, a delete, a confirmed
 *   move) must call this directly and **not** go through `requestClose`: re-asking "discard your
 *   changes?" after the user has just committed them is noise.
 * @param busy Whether a write is in flight. Pass the same flag that disables the dialog's `✕`.
 *   Story 6.25 review: several closers guard themselves with that flag and early-return while it is
 *   set, so `onDiscard` would call one of them and change nothing — the question would vanish, the
 *   dialog would stay open, and the user's explicit "Änderungen verwerfen" would silently do nothing.
 *   The guard therefore withdraws the question rather than offering an answer that cannot be honoured.
 */
export function useDiscardGuard(isDirty: boolean, onClose: () => void, busy = false): DiscardGuard {
  const [open, setOpen] = useState(false);

  // Reset during render rather than in an effect, per React's own prescription for adjusting state on
  // a prop change — and one render earlier than an effect would manage. Same idiom Story 6.25 uses for
  // `TripEditDialog`'s hero-image flag and `TripDayView`'s day-menu anchor.
  if (busy && open) {
    setOpen(false);
  }

  const requestClose = useCallback(() => {
    // Mirrors the `✕`'s own `disabled`: while a write is in flight there is no dismissal to offer.
    if (busy) return;
    if (isDirty) {
      setOpen(true);
      return;
    }
    onClose();
  }, [busy, isDirty, onClose]);

  const onKeep = useCallback(() => setOpen(false), []);

  const onDiscard = useCallback(() => {
    setOpen(false);
    onClose();
  }, [onClose]);

  return { requestClose, dialogProps: { open, onKeep, onDiscard } };
}

export type DiscardChangesDialogProps = {
  open: boolean;
  /** The safe answer, and also what Escape and the backdrop resolve to. */
  onKeep: () => void;
  onDiscard: () => void;
  /**
   * A dialog-specific body, for the surfaces that can name their object ("…an diesem Planpunkt").
   * Defaults to the shared wording, which still names the outcome rather than asking "are you sure?".
   */
  body?: string;
  /** For the suites that assert the body text; `TripDayPlanDialog`'s existing one is `plan-discard-body`. */
  bodyTestId?: string;
};

export default function DiscardChangesDialog({
  open,
  onKeep,
  onDiscard,
  body,
  bodyTestId = "discard-changes-body",
}: DiscardChangesDialogProps) {
  const { t } = useI18n();
  const { tokens } = useTheme().palette;

  return (
    /*
      No `✕` of its own, and that is the one exemption Story 6.25 writes down rather than infers.
      DESIGN.md gives every dialog exactly one close — but this dialog is *raised by* a `✕`, and a
      glyph on the guard would mean the same thing as the glyph that opened it — and two clicks in the
      same corner would land the user back in the form they were leaving, which is a loop rather than a
      consistency. Escape and the backdrop already resolve to keeping, so the safe default is reachable
      without one, and the two buttons are the point: both name a real outcome, on equal footing, per
      Voice and Tone.

      **Ratified in Story 6.25's code review, and it supersedes Story 6.24's reading of AC3**, which
      took the opposite view. Note that it is the opposite call from the two *delete* confirmations,
      which do get a `✕`: those are raised by a delete action rather than by a close, so a glyph there
      is an escape from the question rather than a second copy of it.
    */
    <Dialog open={open} onClose={onKeep} fullWidth maxWidth="xs">
      <DialogTitle>{t("common.discard.title")}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ color: tokens.inkSoft }} data-testid={bodyTestId}>
          {body ?? t("common.discard.body")}
        </Typography>
      </DialogContent>
      <DialogActions>
        {/* The safe half. `color="error"` on the discard follows `TripDeleteDialog`, which is the
            app's existing shape for "the destructive half of a pair". */}
        <Button variant="outlined" onClick={onKeep}>
          {t("common.discard.keep")}
        </Button>
        <Button color="error" variant="contained" onClick={onDiscard}>
          {t("common.discard.confirm")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
