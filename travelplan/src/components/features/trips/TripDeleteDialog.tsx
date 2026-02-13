"use client";

import { useEffect, useState } from "react";
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle } from "@mui/material";
import Typography from "@mui/material/Typography";

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

type TripDeleteDialogProps = {
  open: boolean;
  tripName: string;
  tripId: string;
  onClose: () => void;
  onDeleted: () => void;
};

export default function TripDeleteDialog({ open, tripName, tripId, onClose, onDeleted }: TripDeleteDialogProps) {
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (!open) return;
    let active = true;

    const fetchCsrf = async () => {
      try {
        const response = await fetch("/api/auth/csrf", { method: "GET", credentials: "include", cache: "no-store" });
        const body = (await response.json()) as ApiEnvelope<{ csrfToken: string }>;

        if (!response.ok || body.error || !body.data?.csrfToken) {
          if (active) {
            setServerError(body.error?.message ?? "Unable to initialize deletion. Please refresh.");
          }
          return;
        }

        if (active) {
          setCsrfToken(body.data.csrfToken);
        }
      } catch {
        if (active) {
          setServerError("Unable to initialize deletion. Please refresh.");
        }
      }
    };

    fetchCsrf();

    return () => {
      active = false;
    };
  }, [open]);

  const handleDelete = async () => {
    setServerError(null);

    if (!csrfToken) {
      setServerError("Security token missing. Please refresh and try again.");
      return;
    }

    setIsDeleting(true);

    try {
      const response = await fetch(`/api/trips/${tripId}`, {
        method: "DELETE",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
      });

      const body = (await response.json()) as ApiEnvelope<{ deleted: boolean }>;
      if (!response.ok || body.error || !body.data?.deleted) {
        setServerError(body.error?.message ?? "Trip deletion failed. Please try again.");
        return;
      }

      onDeleted();
    } catch {
      setServerError("Trip deletion failed. Please try again.");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Delete trip?</DialogTitle>
      <DialogContent dividers>
        <Box display="flex" flexDirection="column" gap={2}>
          {serverError && <Alert severity="error">{serverError}</Alert>}
          <Typography variant="body2" color="text.secondary">
            This will remove “{tripName}” and all of its days. This action cannot be undone.
          </Typography>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={isDeleting}>
          Cancel
        </Button>
        <Button color="error" variant="contained" onClick={handleDelete} disabled={isDeleting}>
          {isDeleting ? <CircularProgress size={22} /> : "Delete trip"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
