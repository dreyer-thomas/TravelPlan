"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { CircularProgress } from "@mui/material";
import Button from "@mui/material/Button";
import DialogShell from "@/components/ui/DialogShell";
import DiscardChangesDialog, { useDiscardGuard } from "@/components/ui/DiscardChangesDialog";
import TripCreateForm, { type TripCreateResponse } from "@/components/features/trips/TripCreateForm";
import { useI18n } from "@/i18n/provider";

type TripCreateDialogProps = {
  onCreated?: (trip: TripCreateResponse) => void;
  open: boolean;
  onClose: () => void;
};

export default function TripCreateDialog({ onCreated, open, onClose }: TripCreateDialogProps) {
  const { t } = useI18n();
  const formId = useId();
  const [submitting, setSubmitting] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [formDirty, setFormDirty] = useState(false);
  const closeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  const handleClose = useCallback(() => {
    if (submitting) {
      return;
    }
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setSubmitting(false);
    onClose();
    // Remounting the form is what resets it, so `formDirty` has to be cleared with it — the child's
    // `onDirtyChange` fires from an effect, and a stale `true` here would raise the discard question
    // on the *next* open of an untouched form.
    setFormDirty(false);
    setFormKey((current) => current + 1);
  }, [onClose, submitting]);

  /**
   * Story 6.25 AC7. The form lives in `TripCreateForm`, so this dialog cannot see its values — it
   * takes the child's own answer and guards the `✕`, the backdrop and Escape with it.
   */
  const createGuard = useDiscardGuard(formDirty, handleClose, submitting);

  const handleSuccess = () => {
    setSubmitting(false);
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
    }
    closeTimerRef.current = window.setTimeout(() => {
      onClose();
      setFormKey((current) => current + 1);
      // Story 6.25 review. The trip is saved and the form has been reset, so this close is a committed
      // decision and correctly does not go through the guard — but `formDirty` still holds whatever the
      // child last reported, and the child's `onDirtyChange` fires from an effect. Clearing it here is
      // the same reason `handleClose` clears it: a stale `true` would raise the discard question on the
      // *next* open of an untouched form.
      setFormDirty(false);
      closeTimerRef.current = null;
    }, 800);
  };

  return (
    <>
      <DialogShell
        open={open}
        onClose={createGuard.requestClose}
        title={t("trips.create.title")}
        // The helper used to be a body2 line at the top of the body. Screen F puts it in the head's
        // sub-line, so it moves there and is NOT rendered twice.
        subtitle={t("trips.create.helper")}
        width={460}
        disableDismiss={submitting}
        closeLabel={t("common.close")}
        footer={
          /*
            Story 6.25 AC2. The footer's `Abbrechen` is gone and the dismissal is the head's `✕`, so
            there is one button left and the fragment that held the pair went with it.

            `form` + `type="submit"` reaches the form rendered inside the body — the wiring, the
            800ms success delay and the `formKey` remount are this component's whole behaviour and
            none of it is visual. EXPERIENCE.md:85 permits the inline spinner on a dialog submit.
          */
          <Button type="submit" form={formId} variant="contained" disabled={submitting}>
            {submitting ? <CircularProgress size={22} /> : t("trips.create.submit")}
          </Button>
        }
        footerSx={{ justifyContent: "flex-end" }}
      >
        <TripCreateForm
          key={formKey}
          formId={formId}
          showSubmit={false}
          onSubmittingChange={setSubmitting}
          onDirtyChange={setFormDirty}
          onCreated={onCreated}
          onSuccess={handleSuccess}
        />
      </DialogShell>
      <DiscardChangesDialog {...createGuard.dialogProps} />
    </>
  );
}
