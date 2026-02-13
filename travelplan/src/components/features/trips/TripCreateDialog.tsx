"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  Box,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from "@mui/material";
import Button from "@mui/material/Button";
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
    <>
      <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm">
        <DialogTitle>
          <Typography variant="h6" fontWeight={600} component="div">
            {t("trips.create.title")}
          </Typography>
        </DialogTitle>
        <DialogContent dividers>
          <Box display="flex" flexDirection="column" gap={2.5}>
            <Typography variant="body2" color="text.secondary">
              {t("trips.create.helper")}
            </Typography>
            <TripCreateForm
              key={formKey}
              formId={formId}
              showSubmit={false}
              onSubmittingChange={setSubmitting}
              onCreated={onCreated}
              onSuccess={handleSuccess}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose} disabled={submitting}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form={formId} variant="contained" disabled={submitting}>
            {submitting ? <CircularProgress size={22} /> : t("trips.create.submit")}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
