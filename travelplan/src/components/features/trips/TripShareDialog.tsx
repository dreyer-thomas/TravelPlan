"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItem,
  ListItemText,
  TextField,
  Typography,
} from "@mui/material";
import { useI18n } from "@/i18n/provider";

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

type TripCollaborator = {
  email: string;
  role: "viewer" | "contributor";
};

type TripShareDialogProps = {
  open: boolean;
  tripId: string;
  onClose: () => void;
};

type TripShareFormValues = {
  email: string;
  role: "viewer" | "contributor";
  temporaryPassword?: string;
};

const defaultValues: TripShareFormValues = {
  email: "",
  role: "viewer",
  temporaryPassword: "",
};

export default function TripShareDialog({ open, tripId, onClose }: TripShareDialogProps) {
  const { t } = useI18n();
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<TripShareFormValues>({
    defaultValues,
  });
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [collaborators, setCollaborators] = useState<TripCollaborator[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const resolveApiError = useMemo(
    () => (code?: string) => {
      switch (code) {
        case "unauthorized":
          return t("errors.unauthorized");
        case "csrf_invalid":
          return t("errors.csrfInvalid");
        case "trip_owner_email":
          return t("trips.share.ownerEmailError");
        case "trip_member_exists":
          return t("trips.share.duplicateError");
        case "invalid_json":
          return t("errors.invalidJson");
        case "validation_error":
          return t("trips.share.validationError");
        case "server_error":
          return t("errors.server");
        default:
          return t("trips.share.error");
      }
    },
    [t],
  );

  useEffect(() => {
    if (!open) {
      reset(defaultValues);
      setCsrfToken(null);
      setCollaborators([]);
      setLoadError(null);
      setServerError(null);
      setSuccess(null);
      setLoading(false);
      return;
    }

    let active = true;

    const loadDialogData = async () => {
      setLoading(true);
      setLoadError(null);
      setServerError(null);
      setSuccess(null);

      try {
        const [csrfResponse, membersResponse] = await Promise.all([
          fetch("/api/auth/csrf", { method: "GET", credentials: "include", cache: "no-store" }),
          fetch(`/api/trips/${tripId}/members`, { method: "GET", credentials: "include", cache: "no-store" }),
        ]);

        const csrfBody = (await csrfResponse.json()) as ApiEnvelope<{ csrfToken: string }>;
        const membersBody = (await membersResponse.json()) as ApiEnvelope<{ collaborators: TripCollaborator[] }>;

        if (!csrfResponse.ok || csrfBody.error || !csrfBody.data?.csrfToken) {
          if (active) {
            setLoadError(t("trips.share.initError"));
          }
          return;
        }

        if (!membersResponse.ok || membersBody.error || !membersBody.data) {
          if (active) {
            setLoadError(resolveApiError(membersBody.error?.code));
          }
          return;
        }

        if (active) {
          setCsrfToken(csrfBody.data.csrfToken);
          setCollaborators(membersBody.data.collaborators);
        }
      } catch {
        if (active) {
          setLoadError(t("trips.share.initError"));
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void loadDialogData();

    return () => {
      active = false;
    };
  }, [open, reset, resolveApiError, t, tripId]);

  const onSubmit = async (values: TripShareFormValues) => {
    setServerError(null);
    setSuccess(null);

    if (!csrfToken) {
      setServerError(t("errors.csrfMissing"));
      return;
    }

    try {
      const response = await fetch(`/api/trips/${tripId}/members`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify(values),
      });

      const body = (await response.json()) as ApiEnvelope<{
        accountAction?: "created_account" | "linked_existing_account";
        collaborator: TripCollaborator;
        collaborators: TripCollaborator[];
      }>;

      if (!response.ok || body.error || !body.data) {
        if (body.error?.code === "validation_error" && body.error.details) {
          const details = body.error.details as {
            fieldErrors?: Record<string, string[]>;
          };

          Object.entries(details.fieldErrors ?? {}).forEach(([field, messages]) => {
            if (messages?.[0]) {
              setError(field as keyof TripShareFormValues, { message: messages[0] });
            }
          });
        }

        setServerError(resolveApiError(body.error?.code));
        return;
      }

      setCollaborators(body.data.collaborators);
      setSuccess(
        body.data.accountAction === "linked_existing_account"
          ? t("trips.share.linkSuccess")
          : t("trips.share.success"),
      );
      reset(defaultValues);
    } catch {
      setServerError(t("trips.share.error"));
    }
  };

  const collaboratorRoleLabel = (role: TripCollaborator["role"]) =>
    role === "viewer" ? t("trips.share.roleViewer") : t("trips.share.roleContributor");

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t("trips.share.title")}</DialogTitle>
      <DialogContent dividers>
        <Box display="flex" flexDirection="column" gap={2}>
          {loadError && <Alert severity="error">{loadError}</Alert>}
          {serverError && <Alert severity="error">{serverError}</Alert>}
          {success && <Alert severity="success">{success}</Alert>}

          <Box
            component="form"
            display="flex"
            flexDirection="column"
            gap={2}
            onSubmit={(event) => {
              event.preventDefault();
              void handleSubmit(onSubmit)(event);
            }}
          >
            <TextField
              label={t("auth.emailLabel")}
              type="email"
              autoComplete="email"
              error={Boolean(errors.email)}
              helperText={errors.email?.message}
              {...register("email", { required: t("auth.emailRequired") })}
            />
            <TextField
              select
              label={t("trips.share.roleLabel")}
              error={Boolean(errors.role)}
              helperText={errors.role?.message}
              SelectProps={{ native: true }}
              {...register("role")}
            >
              <option value="viewer">{t("trips.share.roleViewer")}</option>
              <option value="contributor">{t("trips.share.roleContributor")}</option>
            </TextField>
            <TextField
              label={t("trips.share.temporaryPasswordOptionalLabel")}
              type="password"
              autoComplete="new-password"
              error={Boolean(errors.temporaryPassword)}
              helperText={errors.temporaryPassword?.message ?? t("trips.share.temporaryPasswordHelp")}
              {...register("temporaryPassword")}
            />
            <Box display="flex" justifyContent="flex-end">
              <Button type="submit" variant="contained" disabled={isSubmitting || loading}>
                {isSubmitting ? <CircularProgress size={22} /> : t("trips.share.submit")}
              </Button>
            </Box>
          </Box>

          <Box display="flex" flexDirection="column" gap={1}>
            <Typography variant="subtitle2" fontWeight={700}>
              {t("trips.share.collaboratorsTitle")}
            </Typography>
            {loading ? (
              <Box display="flex" justifyContent="center" py={2}>
                <CircularProgress size={24} />
              </Box>
            ) : collaborators.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                {t("trips.share.empty")}
              </Typography>
            ) : (
              <List disablePadding>
                {collaborators.map((collaborator) => (
                  <ListItem key={`${collaborator.email}-${collaborator.role}`} disableGutters divider>
                    <ListItemText
                      primary={collaborator.email}
                      secondary={collaboratorRoleLabel(collaborator.role)}
                    />
                  </ListItem>
                ))}
              </List>
            )}
          </Box>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common.cancel")}</Button>
      </DialogActions>
    </Dialog>
  );
}
