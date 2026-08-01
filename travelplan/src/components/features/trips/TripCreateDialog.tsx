"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CircularProgress } from "@mui/material";
import Button from "@mui/material/Button";
import DialogShell from "@/components/ui/DialogShell";
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
  const closeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  const handleClose = () => {
    if (submitting) {
      return;
    }
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setSubmitting(false);
    onClose();
    setFormKey((current) => current + 1);
  };

  const handleSuccess = () => {
    setSubmitting(false);
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
    }
    closeTimerRef.current = window.setTimeout(() => {
      onClose();
      setFormKey((current) => current + 1);
      closeTimerRef.current = null;
    }, 800);
  };

  return (
    <DialogShell
      open={open}
      onClose={handleClose}
      title={t("trips.create.title")}
      // The helper used to be a body2 line at the top of the body. Screen F puts it in the head's
      // sub-line, so it moves there and is NOT rendered twice.
      subtitle={t("trips.create.helper")}
      width={460}
      disableDismiss={submitting}
      footer={
        <>
          <Button variant="outlined" onClick={handleClose} disabled={submitting}>
            {t("common.cancel")}
          </Button>
          {/*
            `form` + `type="submit"` reaches the form rendered inside the body — the wiring, the
            800ms success delay and the `formKey` remount are this component's whole behaviour and
            none of it is visual. EXPERIENCE.md:85 permits the inline spinner on a dialog submit.
          */}
          <Button type="submit" form={formId} variant="contained" disabled={submitting}>
            {submitting ? <CircularProgress size={22} /> : t("trips.create.submit")}
          </Button>
        </>
      }
      footerSx={{ justifyContent: "flex-end" }}
    >
      <TripCreateForm
        key={formKey}
        formId={formId}
        showSubmit={false}
        onSubmittingChange={setSubmitting}
        onCreated={onCreated}
        onSuccess={handleSuccess}
      />
    </DialogShell>
  );
}
