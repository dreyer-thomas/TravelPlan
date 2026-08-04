"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
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
  TextField,
  Typography,
  useTheme,
} from "@mui/material";
import DiscardChangesDialog, { useDiscardGuard } from "@/components/ui/DiscardChangesDialog";
import { formatMessage } from "@/i18n";
import { useI18n } from "@/i18n/provider";

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

type TripCollaborator = {
  id: string;
  email: string;
  role: "viewer" | "contributor";
};

type TripShareDialogProps = {
  open: boolean;
  tripId: string;
  tripName: string;
  onClose: () => void;
};

type TripShareFormValues = {
  email: string;
  role: "viewer" | "contributor";
  temporaryPassword?: string;
};

type RoleBadgeVariant = "owner" | "viewer" | "contributor";

const defaultValues: TripShareFormValues = {
  email: "",
  role: "viewer",
  temporaryPassword: "",
};

/** A payload that omits the list renders as empty rather than crashing the next `.length`/`.map`. */
const toCollaboratorList = (value: unknown): TripCollaborator[] =>
  Array.isArray(value) ? (value as TripCollaborator[]) : [];

/**
 * Section heading above a group of controls.
 *
 * `labelCaps` is 10.5px/0.08em; Screen D's `.field-label` is 11px/0.06em, so the two values are
 * overridden rather than a new variant invented. The variant has no `variantMapping`, hence the
 * explicit `component="div"`.
 */
const SectionLabel = ({ id, children }: { id?: string; children: ReactNode }) => {
  const { tokens } = useTheme().palette;

  return (
    <Typography
      id={id}
      variant="labelCaps"
      component="div"
      sx={{ fontSize: 11, letterSpacing: "0.06em", color: tokens.inkSoft, mb: "7px" }}
    >
      {children}
    </Typography>
  );
};

/**
 * Role pill. The owner variant is the one sanctioned non-gap use of the warn family in this system
 * (DESIGN.md:239) — it is not licence to use warn decoratively elsewhere. The word stays in the badge
 * so colour is never the sole signal.
 */
const RoleBadge = ({ variant, label }: { variant: RoleBadgeVariant; label: string }) => {
  const theme = useTheme();
  const { tokens } = theme.palette;

  const palette: Record<RoleBadgeVariant, { backgroundColor: string; color: string }> = {
    contributor: {
      backgroundColor: theme.palette.primary.main,
      color: theme.palette.primary.contrastText,
    },
    viewer: {
      backgroundColor: tokens.accentSoft,
      color: theme.palette.primary.main,
    },
    owner: {
      backgroundColor: tokens.warnBg,
      color: theme.palette.warning.main,
    },
  };

  return (
    <Box
      component="span"
      sx={{
        ...palette[variant],
        borderRadius: "5px",
        padding: "5px 10px",
        fontSize: 10.5,
        fontWeight: 800,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </Box>
  );
};

export default function TripShareDialog({ open, tripId, tripName, onClose }: TripShareDialogProps) {
  const { t } = useI18n();
  const theme = useTheme();
  const { tokens } = theme.palette;
  const headId = useId();
  const titleId = useId();
  const inviteLabelId = useId();
  const accessLabelId = useId();
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting, dirtyFields },
  } = useForm<TripShareFormValues>({
    defaultValues,
  });
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [ownerEmail, setOwnerEmail] = useState<string | null>(null);
  const [collaborators, setCollaborators] = useState<TripCollaborator[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [removingMemberIds, setRemovingMemberIds] = useState<string[]>([]);
  /**
   * Ids whose removal has already succeeded this session. Every server list is a snapshot taken at its
   * own commit time, so a slower response can still contain a member a faster one has deleted; filtering
   * through this set stops a removed collaborator reappearing with a live Remove button.
   */
  const removedIdsRef = useRef<Set<string>>(new Set());
  /**
   * Bumped whenever the dialog closes. A request that started under an older generation must not write
   * state back into a dialog the user has already dismissed — the load effect's `active` flag equivalent
   * for the two handlers, which live outside it.
   */
  const generationRef = useRef(0);
  const accessSectionRef = useRef<HTMLDivElement | null>(null);

  const resolveApiError = useMemo(
    () => (code?: string, fallback?: string) => {
      switch (code) {
        // Operation-agnostic: the same sentence is right whichever request produced the code.
        case "unauthorized":
          return t("errors.unauthorized");
        case "csrf_invalid":
          return t("errors.csrfInvalid");
        case "invalid_json":
          return t("errors.invalidJson");
        case "server_error":
          return t("errors.server");
        // Invite-specific copy. A caller that supplied its own fallback (loading, removing) must not
        // inherit a sentence about adding a collaborator.
        case "trip_owner_email":
          return fallback ?? t("trips.share.ownerEmailError");
        case "trip_member_exists":
          return fallback ?? t("trips.share.duplicateError");
        case "validation_error":
          return fallback ?? t("trips.share.validationError");
        default:
          return fallback ?? t("trips.share.error");
      }
    },
    [t],
  );

  useEffect(() => {
    if (!open) {
      generationRef.current += 1;
      removedIdsRef.current = new Set();
      reset(defaultValues);
      setCsrfToken(null);
      setOwnerEmail(null);
      setCollaborators([]);
      setLoadError(null);
      setServerError(null);
      setSuccess(null);
      setLoading(false);
      setRemovingMemberIds([]);
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
        const membersBody = (await membersResponse.json()) as ApiEnvelope<{
          owner?: { email: string };
          collaborators: TripCollaborator[];
        }>;

        if (!csrfResponse.ok || csrfBody.error || !csrfBody.data?.csrfToken) {
          if (active) {
            setLoadError(t("trips.share.initError"));
          }
          return;
        }

        if (!membersResponse.ok || membersBody.error || !membersBody.data) {
          if (active) {
            setLoadError(resolveApiError(membersBody.error?.code, t("trips.share.initError")));
          }
          return;
        }

        if (active) {
          setCsrfToken(csrfBody.data.csrfToken);
          // Both fields are tolerated as absent on the wire: an older payload renders the list without
          // an owner row rather than throwing, and a missing list renders empty rather than crashing
          // the next `.length`/`.map`.
          setOwnerEmail(membersBody.data.owner?.email ?? null);
          setCollaborators(toCollaboratorList(membersBody.data.collaborators));
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

  /** Server snapshots are only authoritative about members we have not already removed. */
  const applyRemovals = (list: unknown) =>
    toCollaboratorList(list).filter((collaborator) => !removedIdsRef.current.has(collaborator.id));

  /**
   * The removed row took the focused button with it, which would otherwise drop focus to `<body>` and
   * restart tabbing from the top of the document. The success alert carries the announcement.
   */
  const restoreFocusAfterRemoval = () => {
    accessSectionRef.current?.focus();
  };

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

      setCollaborators(applyRemovals(body.data.collaborators));
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

  const onRemove = async (memberId: string) => {
    setServerError(null);
    setSuccess(null);

    if (!csrfToken) {
      setServerError(t("errors.csrfMissing"));
      return;
    }

    const generation = generationRef.current;
    setRemovingMemberIds((pending) => (pending.includes(memberId) ? pending : [...pending, memberId]));

    try {
      const response = await fetch(`/api/trips/${tripId}/members`, {
        method: "DELETE",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({ memberId }),
      });

      const body = (await response.json()) as ApiEnvelope<{
        deleted: boolean;
        collaborators: TripCollaborator[];
      }>;

      if (generationRef.current !== generation) {
        return;
      }

      if (!response.ok || body.error || !body.data) {
        // A 404 means the membership is already gone — the user's intent is satisfied, so reconcile the
        // row away instead of leaving a phantom that errors on every retry.
        if (response.status === 404) {
          removedIdsRef.current.add(memberId);
          setCollaborators((current) => current.filter((collaborator) => collaborator.id !== memberId));
          setSuccess(t("trips.share.removeSuccess"));
          restoreFocusAfterRemoval();
          return;
        }

        setServerError(resolveApiError(body.error?.code, t("trips.share.removeError")));
        return;
      }

      removedIdsRef.current.add(memberId);
      setCollaborators(applyRemovals(body.data.collaborators));
      setSuccess(t("trips.share.removeSuccess"));
      restoreFocusAfterRemoval();
    } catch {
      if (generationRef.current === generation) {
        setServerError(t("trips.share.removeError"));
      }
    } finally {
      if (generationRef.current === generation) {
        setRemovingMemberIds((pending) => pending.filter((id) => id !== memberId));
      }
    }
  };

  const collaboratorRoleLabel = (role: TripCollaborator["role"]) =>
    role === "contributor" ? t("trips.share.roleContributor") : t("trips.share.roleViewer");

  // An unrecognised role must not be presented as the more privileged one.
  const roleBadgeVariant = (role: TripCollaborator["role"]): RoleBadgeVariant =>
    role === "contributor" ? "contributor" : "viewer";

  const accessCount = collaborators.length + (ownerEmail ? 1 : 0);

  /**
   * Story 6.25 AC7, added by that story's code review.
   *
   * This dialog was not in AC7's list of nine, because that list was derived from the `common.cancel`
   * readers and this dialog was never one — it has always dismissed with a named footer button. But
   * AC7 says *every* form dialog, and this is one: an invite address, a role, and a temporary password
   * that is typed once and not shown again. Closing threw all three away without a word.
   *
   * `dirtyFields` rather than `isDirty`, per the defect the browser pass caught on `heroImage`: a
   * registered input whose value never deep-compares equal to its default latches `isDirty` true
   * forever, and `dirtyFields` is the signal that does not. The collaborator list below is not part of
   * this — adding and removing people are immediate writes with nothing pending behind them, the same
   * split every other dialog in this story makes.
   *
   * DW-157 continues to cover the *placement* of this dialog's close control, which is unchanged.
   */
  const shareGuard = useDiscardGuard(Object.keys(dirtyFields).length > 0, onClose, isSubmitting);

  return (
    <>
    <Dialog
      open={open}
      onClose={shareGuard.requestClose}
      fullWidth
      maxWidth={false}
      slotProps={{ paper: { sx: { width: "100%", maxWidth: 460 } } }}
      // The sub-line lives inside the head, so the dialog is named by the title alone rather than by
      // MUI's default (the whole `DialogTitle`, sub-line included).
      aria-labelledby={titleId}
    >
      <DialogTitle id={headId} sx={{ p: "20px 24px 16px", borderBottom: `1px solid ${tokens.border}` }}>
        <Box id={titleId} sx={{ fontSize: 17, fontWeight: 900, letterSpacing: "-0.2px", color: tokens.ink }}>
          {t("trips.share.title")}
        </Box>
        <Box sx={{ mt: "4px", fontSize: 12.5, fontWeight: 600, color: tokens.inkSoft }}>
          {`${tripName} · ${t("trips.share.subtitle")}`}
        </Box>
      </DialogTitle>

      {/*
        MUI zeroes `padding-top` on a DialogContent that follows a DialogTitle, at a specificity the
        plain `p` shorthand cannot beat — hence the explicit sibling selector.
      */}
      <DialogContent sx={{ p: "20px 24px", ".MuiDialogTitle-root + &": { pt: "20px" } }}>
        <Box display="flex" flexDirection="column" gap={2}>
          {loadError && <Alert severity="error">{loadError}</Alert>}
          {serverError && <Alert severity="error">{serverError}</Alert>}
          {success && <Alert severity="success">{success}</Alert>}

          <Box
            component="form"
            aria-labelledby={inviteLabelId}
            onSubmit={(event) => {
              event.preventDefault();
              void handleSubmit(onSubmit)(event);
            }}
          >
            <SectionLabel id={inviteLabelId}>{t("trips.share.inviteLabel")}</SectionLabel>

            <Box
              sx={{
                display: "flex",
                flexDirection: { xs: "column", sm: "row" },
                alignItems: "flex-start",
                gap: "10px",
              }}
            >
              <TextField
                label={t("auth.emailLabel")}
                type="email"
                autoComplete="email"
                error={Boolean(errors.email)}
                helperText={errors.email?.message}
                sx={{ flex: 1, width: { xs: "100%", sm: "auto" } }}
                {...register("email", { required: t("auth.emailRequired") })}
              />
              <TextField
                select
                label={t("trips.share.roleLabel")}
                error={Boolean(errors.role)}
                helperText={errors.role?.message}
                SelectProps={{ native: true }}
                sx={{ minWidth: 118, width: { xs: "100%", sm: "auto" } }}
                {...register("role")}
              >
                <option value="viewer">{t("trips.share.roleViewer")}</option>
                <option value="contributor">{t("trips.share.roleContributor")}</option>
              </TextField>
              <Button
                type="submit"
                variant="contained"
                disabled={isSubmitting || loading}
                sx={{ width: { xs: "100%", sm: "auto" } }}
              >
                {isSubmitting ? <CircularProgress size={22} /> : t("trips.share.submit")}
              </Button>
            </Box>

            {/*
              Screen D omits this field because it was drawn against the design system rather than the
              real invite flow; the API rejects a brand-new account without it.
            */}
            <TextField
              fullWidth
              label={t("trips.share.temporaryPasswordOptionalLabel")}
              type="password"
              autoComplete="new-password"
              error={Boolean(errors.temporaryPassword)}
              helperText={errors.temporaryPassword?.message ?? t("trips.share.temporaryPasswordHelp")}
              sx={{
                mt: "10px",
                "& .MuiFormHelperText-root": { fontSize: 11, color: tokens.inkMuted },
              }}
              {...register("temporaryPassword")}
            />
          </Box>

          {/*
            The discovery half of the invite: whether the person already has an account is not
            answerable from this dialog. It opens in a new tab on purpose - navigating away would
            unmount the dialog and discard a half-typed invite.
          */}
          <Button
            component="a"
            href="/users"
            target="_blank"
            rel="noopener"
            variant="text"
            sx={{ alignSelf: "flex-start", fontSize: 12, fontWeight: 700 }}
          >
            {t("trips.share.viewRegisteredUsers")}
          </Button>

          {/*
            The count and the empty state are claims about data we hold. While the fetch is in flight
            they would read "Access (0)", and after a failed fetch they would assert the trip has nobody
            on it — so the section renders neither until the list is actually known.
          */}
          <Box ref={accessSectionRef} tabIndex={-1} sx={{ outline: "none" }}>
            {loading ? (
              <Box display="flex" justifyContent="center" py={2}>
                <CircularProgress size={24} />
              </Box>
            ) : loadError ? null : (
              <>
                <SectionLabel id={accessLabelId}>
                  {formatMessage(t("trips.share.accessLabel"), { count: accessCount })}
                </SectionLabel>

                {/* No rows means no rule to draw: an empty bordered list is a stray hairline. */}
                {accessCount > 0 && (
                <List
                  aria-labelledby={accessLabelId}
                  disablePadding
                  sx={{
                    borderTop: `1px solid ${tokens.border}`,
                    "& .MuiListItem-root": {
                      borderBottom: `1px solid ${tokens.border}`,
                    },
                    "& .MuiListItem-root:last-child": {
                      borderBottom: "none",
                    },
                  }}
                >
                  {ownerEmail && (
                    <ListItem
                      disableGutters
                      sx={{
                        py: "12px",
                        display: "flex",
                        flexWrap: "wrap",
                        justifyContent: "space-between",
                        gap: "10px",
                      }}
                    >
                      <Box sx={{ fontSize: 13, fontWeight: 700, color: tokens.ink }}>{ownerEmail}</Box>
                      <Box sx={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <RoleBadge variant="owner" label={t("trips.share.roleOwner")} />
                      </Box>
                    </ListItem>
                  )}

                  {collaborators.map((collaborator) => (
                    <ListItem
                      key={collaborator.id}
                      disableGutters
                      sx={{
                        py: "12px",
                        display: "flex",
                        flexWrap: "wrap",
                        justifyContent: "space-between",
                        gap: "10px",
                      }}
                    >
                      <Box sx={{ fontSize: 13, fontWeight: 700, color: tokens.ink }}>
                        {collaborator.email}
                      </Box>
                      <Box sx={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <RoleBadge
                          variant={roleBadgeVariant(collaborator.role)}
                          label={collaboratorRoleLabel(collaborator.role)}
                        />
                        <Button
                          variant="text"
                          onClick={() => void onRemove(collaborator.id)}
                          disabled={removingMemberIds.includes(collaborator.id)}
                          aria-label={formatMessage(t("trips.share.removeAria"), { email: collaborator.email })}
                          sx={{
                            minHeight: 44,
                            minWidth: 44,
                            px: 1.5,
                            color: theme.palette.warning.main,
                            fontSize: 11.5,
                            fontWeight: 700,
                          }}
                        >
                          {t("trips.share.remove")}
                        </Button>
                      </Box>
                    </ListItem>
                  ))}
                </List>
                )}

                {collaborators.length === 0 && (
                  <Typography variant="caption" component="div" sx={{ mt: "10px", color: tokens.inkSoft }}>
                    {t("trips.share.empty")}
                  </Typography>
                )}
              </>
            )}
          </Box>
        </Box>
      </DialogContent>

      <DialogActions
        sx={{
          p: "16px 24px",
          borderTop: `1px solid ${tokens.border}`,
          backgroundColor: tokens.cardAlt,
          justifyContent: "flex-end",
        }}
      >
        <Button variant="outlined" onClick={shareGuard.requestClose}>
          {t("common.close")}
        </Button>
      </DialogActions>
    </Dialog>
    {/* A sibling of the dialog it guards, which is the shape every other guarded dialog has. */}
    <DiscardChangesDialog {...shareGuard.dialogProps} />
    </>
  );
}
