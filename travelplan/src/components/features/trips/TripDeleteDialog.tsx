"use client";

import { useEffect, useState } from "react";
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle } from "@mui/material";
import Typography from "@mui/material/Typography";
import { useI18n } from "@/i18n/provider";
import { formatMessage } from "@/i18n";

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
  const { t } = useI18n();
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
            setServerError(body.error?.message ?? t("trips.delete.initError"));
          }
          return;
        }

        if (active) {
          setCsrfToken(body.data.csrfToken);
        }
      } catch {
        if (active) {
          setServerError(t("trips.delete.initError"));
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
      setServerError(t("errors.csrfMissing"));
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
        const resolveApiError = (code?: string) => {
          switch (code) {
            case "unauthorized":
              return t("errors.unauthorized");
            case "csrf_invalid":
              return t("errors.csrfInvalid");
            case "server_error":
              return t("errors.server");
            case "invalid_json":
              return t("errors.invalidJson");
            default:
              return t("trips.delete.error");
          }
        };

        setServerError(resolveApiError(body.error?.code));
        return;
      }

      onDeleted();
    } catch {
      setServerError(t("trips.delete.error"));
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{t("trips.delete.title")}</DialogTitle>
      <DialogContent dividers>
        <Box display="flex" flexDirection="column" gap={2}>
          {serverError && <Alert severity="error">{serverError}</Alert>}
          <Typography variant="body2" color="text.secondary">
            {formatMessage(t("trips.delete.body"), { name: tripName })}
          </Typography>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={isDeleting}>
          {t("common.cancel")}
        </Button>
        <Button color="error" variant="contained" onClick={handleDelete} disabled={isDeleting}>
          {isDeleting ? <CircularProgress size={22} /> : t("trips.delete.submit")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
