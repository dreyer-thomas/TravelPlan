"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
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

type TripCreateDialogProps = {
  onCreated?: (trip: TripCreateResponse) => void;
  open: boolean;
  onClose: () => void;
};

export default function TripCreateDialog({ onCreated, open, onClose }: TripCreateDialogProps) {
  const formId = useId();
  const [submitting, setSubmitting] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const closeTimerRef = useRef<number | null>(null);

  const helperText = useMemo(
    () => "Give your trip a name and a date range to generate a full set of planning days.",
    [],
  );

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
            Create a new trip
          </Typography>
        </DialogTitle>
        <DialogContent dividers>
          <Box display="flex" flexDirection="column" gap={2.5}>
            <Typography variant="body2" color="text.secondary">
              {helperText}
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
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="contained" disabled={submitting}>
            {submitting ? <CircularProgress size={22} /> : "Create trip"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
