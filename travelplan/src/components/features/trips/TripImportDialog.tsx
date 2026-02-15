"use client";

import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from "@mui/material";
import { useI18n } from "@/i18n/provider";

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

type ImportResponse = {
  trip: {
    id: string;
    name: string;
    startDate: string;
    endDate: string;
    heroImageUrl: string | null;
  };
  dayCount: number;
  mode: "overwrite" | "createNew";
};

type TripConflict = {
  id: string;
  name: string;
};

type TripImportDialogProps = {
  open: boolean;
  tripId: string;
  onClose: () => void;
  onImported: () => void;
};

export default function TripImportDialog({ open, tripId, onClose, onImported }: TripImportDialogProps) {
  const { t } = useI18n();
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [payload, setPayload] = useState<unknown | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [serverError, setServerError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [conflicts, setConflicts] = useState<TripConflict[]>([]);
  const [conflictTargetTripId, setConflictTargetTripId] = useState<string | null>(null);

  const readFileText = async (file: File): Promise<string> => {
    if (typeof file.text === "function") {
      return file.text();
    }

    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
      reader.onerror = () => reject(new Error("file_read_failed"));
      reader.readAsText(file);
    });
  };

  useEffect(() => {
    if (!open) {
      setServerError(null);
      setConflicts([]);
      setConflictTargetTripId(null);
      setPayload(null);
      setFileName("");
      return;
    }

    let active = true;

    const fetchCsrf = async () => {
      try {
        const response = await fetch("/api/auth/csrf", { method: "GET", credentials: "include", cache: "no-store" });
        const body = (await response.json()) as ApiEnvelope<{ csrfToken: string }>;

        if (!response.ok || body.error || !body.data?.csrfToken) {
          if (active) {
            setServerError(body.error?.message ?? t("trips.import.initError"));
          }
          return;
        }

        if (active) {
          setCsrfToken(body.data.csrfToken);
        }
      } catch {
        if (active) {
          setServerError(t("trips.import.initError"));
        }
      }
    };

    fetchCsrf();

    return () => {
      active = false;
    };
  }, [open, t]);

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setServerError(null);
    setConflicts([]);

    if (!file) {
      setPayload(null);
      setFileName("");
      return;
    }

    try {
      const text = await readFileText(file);
      const parsed = JSON.parse(text) as unknown;
      setPayload(parsed);
      setFileName(file.name);
    } catch {
      setPayload(null);
      setFileName(file.name);
      setServerError(t("trips.import.invalidFile"));
    }
  };

  const resolveApiError = useMemo(
    () => (code?: string) => {
      switch (code) {
        case "unauthorized":
          return t("errors.unauthorized");
        case "csrf_invalid":
          return t("errors.csrfInvalid");
        case "invalid_json":
          return t("errors.invalidJson");
        case "validation_error":
          return t("trips.import.validationError");
        case "server_error":
          return t("errors.server");
        default:
          return t("trips.import.error");
      }
    },
    [t],
  );

  const submitImport = async (strategy?: "overwrite" | "createNew") => {
    setServerError(null);

    if (!csrfToken) {
      setServerError(t("errors.csrfMissing"));
      return;
    }

    if (!payload) {
      setServerError(t("trips.import.fileRequired"));
      return;
    }

    const targetTripId = strategy === "overwrite" ? conflictTargetTripId ?? conflicts[0]?.id ?? tripId : undefined;

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/trips/import", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({ payload, strategy, targetTripId }),
      });

      const body = (await response.json()) as ApiEnvelope<ImportResponse>;

      if (response.status === 409 && body.error?.code === "trip_name_conflict") {
        const conflictItems =
          ((body.error.details as { conflicts?: TripConflict[] } | undefined)?.conflicts ?? []).filter(
            (item): item is TripConflict => Boolean(item?.id && item?.name),
          );
        setConflicts(conflictItems);
        setConflictTargetTripId(conflictItems[0]?.id ?? null);
        setServerError(t("trips.import.conflictError"));
        return;
      }

      if (!response.ok || body.error || !body.data) {
        setServerError(resolveApiError(body.error?.code));
        return;
      }

      onImported();
      onClose();
    } catch {
      setServerError(t("trips.import.error"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const hasConflict = conflicts.length > 0;

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t("trips.import.title")}</DialogTitle>
      <DialogContent dividers>
        <Box display="flex" flexDirection="column" gap={2}>
          {serverError && <Alert severity="error">{serverError}</Alert>}
          <Box display="flex" flexDirection="column" gap={1}>
            <Typography variant="body2" color="text.secondary">
              {t("trips.import.fileHelp")}
            </Typography>
            <input
              aria-label={t("trips.import.fileLabel")}
              type="file"
              accept="application/json,.json"
              onChange={(event) => {
                void handleFileChange(event);
              }}
            />
            {fileName && (
              <Typography variant="caption" color="text.secondary">
                {fileName}
              </Typography>
            )}
          </Box>

          {hasConflict && (
            <Box display="flex" flexDirection="column" gap={1}>
              <Typography variant="body2" color="text.secondary">
                {t("trips.import.conflictHelp")}
              </Typography>
              <TextField
                select
                SelectProps={{ native: true }}
                value={conflictTargetTripId ?? ""}
                onChange={(event) => setConflictTargetTripId(event.target.value)}
                label={t("trips.import.conflictSelectLabel")}
                size="small"
              >
                {conflicts.map((conflict) => (
                  <option key={conflict.id} value={conflict.id}>
                    {conflict.name}
                  </option>
                ))}
              </TextField>
              <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
                <Button variant="outlined" onClick={() => void submitImport("overwrite")} disabled={isSubmitting}>
                  {t("trips.import.strategyOverwrite")}
                </Button>
                <Button variant="outlined" onClick={() => void submitImport("createNew")} disabled={isSubmitting}>
                  {t("trips.import.strategyCreateNew")}
                </Button>
              </Box>
            </Box>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={isSubmitting}>
          {t("common.cancel")}
        </Button>
        <Button variant="contained" onClick={() => void submitImport()} disabled={isSubmitting || !payload}>
          {isSubmitting ? <CircularProgress size={22} /> : t("trips.import.action")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
