"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  List,
  ListItem,
  MenuItem,
  TextField,
  Typography,
  useTheme,
} from "@mui/material";
import { Controller, useForm } from "react-hook-form";
import { formatMessage } from "@/i18n";
import { useI18n } from "@/i18n/provider";
import { DialogTitleWithClose } from "@/components/ui/DialogCloseButton";
import DiscardChangesDialog, { useDiscardGuard } from "@/components/ui/DiscardChangesDialog";

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

type AdminMembership = {
  id: string;
  tripId: string;
  tripName: string;
  role: "VIEWER" | "CONTRIBUTOR";
};

type AdminUser = {
  id: string;
  email: string;
  role: "OWNER" | "VIEWER" | "ADMIN";
  ownedTrips: { id: string; name: string }[];
  memberships: AdminMembership[];
};

type AdminTrip = {
  id: string;
  name: string;
  ownerEmail: string;
};

/**
 * One state at a time, as a union rather than a set of booleans - the same shape 5.8's
 * `RegisteredUsersList` uses, and for the same reason: "blocked" and "loaded" are mutually exclusive
 * claims that a boolean pair can hold at once.
 */
type ListState =
  | { status: "loading" }
  | { status: "blocked" }
  | { status: "error"; messageKey: string }
  | { status: "loaded"; users: AdminUser[]; trips: AdminTrip[] };

type CreateFormValues = {
  email: string;
  temporaryPassword: string;
};

type AttachFormValues = {
  tripId: string;
  role: "VIEWER" | "CONTRIBUTOR";
};

/**
 * `POST …/memberships` answers with three codes the admin can act on differently, and the routes separate
 * them on purpose - `memberships/route.ts` says so where it returns them: which of the account and the trip
 * is gone "is the difference between reloading the list and picking another trip". Mapping all three onto
 * one generic sentence threw that away at the only place it was for.
 */
const attachErrorKey = (code: string | undefined) => {
  switch (code) {
    case "trip_owner":
      return "admin.users.attach.tripOwner";
    case "trip_not_found":
      return "admin.users.attach.tripNotFound";
    case "not_found":
      return "admin.users.attach.userNotFound";
    default:
      return "admin.users.attach.error";
  }
};

/**
 * The administration surface (Story 5.10).
 *
 * Every mutation here re-reads the whole list afterwards rather than patching local state. That is a
 * deliberate trade of one extra request for the thing this surface most needs to be: correct about who can
 * reach what. Half of these actions change a row other than the one clicked - deleting an account removes
 * its memberships, and the last-admin rule makes one row's grant button depend on every other row's role -
 * so a local splice would show a list that disagrees with the database precisely where being wrong matters.
 */
export default function AdminUsersList({ currentUserId }: { currentUserId: string }) {
  const { t } = useI18n();
  const { tokens } = useTheme().palette;
  const countLabelId = useId();
  const [state, setState] = useState<ListState>({ status: "loading" });
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [attachTarget, setAttachTarget] = useState<AdminUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);

  /**
   * Fetches the list and **returns** the state it implies rather than applying it.
   *
   * Splitting the read from the write is what lets the mount effect below hold a real cancellation flag:
   * if this set the state itself, an `active` check in the caller would guard nothing, because the write
   * would already have happened inside. It also keeps `react-hooks/set-state-in-effect` satisfied
   * honestly - the effect's `setState` is in a callback that runs after the await, which is what the rule
   * is asking for, rather than being hidden from it behind an indirection.
   */
  const fetchList = useCallback(async (): Promise<ListState> => {
    try {
      // `cache: "no-store"`, like 5.8's list: without it the browser may answer this GET from its own
      // cache and show a membership that was removed two clicks ago.
      const response = await fetch("/api/admin/users", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });
      const body = (await response.json()) as ApiEnvelope<{ users?: AdminUser[]; trips?: AdminTrip[] }>;

      if (!response.ok || body.error || !body.data) {
        switch (body.error?.code) {
          // The role was revoked between the page's server render and this fetch. A legitimate state, not a
          // failure - and the reason the page's own gate is not the only one.
          case "forbidden":
            return { status: "blocked" };
          case "unauthorized":
          case "password_change_required":
            return { status: "error", messageKey: "errors.unauthorized" };
          default:
            return { status: "error", messageKey: "admin.users.loadError" };
        }
      }

      // A 200 without the arrays is a broken contract, not an empty installation - reporting it as "no
      // accounts registered yet" would be an affirmative claim we cannot make.
      if (!Array.isArray(body.data.users) || !Array.isArray(body.data.trips)) {
        return { status: "error", messageKey: "admin.users.loadError" };
      }

      return { status: "loaded", users: body.data.users, trips: body.data.trips };
    } catch {
      return { status: "error", messageKey: "admin.users.loadError" };
    }
  }, []);

  /** The post-mutation refresh. Called from event handlers, never from an effect. */
  const load = useCallback(async () => {
    setState(await fetchList());
  }, [fetchList]);

  /** Reads a token and returns it, for the same read/write split `fetchList` above is documented for. */
  const requestCsrfToken = useCallback(async (): Promise<string | null> => {
    try {
      const response = await fetch("/api/auth/csrf", { method: "GET", credentials: "include", cache: "no-store" });
      const body = (await response.json()) as ApiEnvelope<{ csrfToken: string }>;
      if (!response.ok || body.error || !body.data?.csrfToken) {
        return null;
      }
      return body.data.csrfToken;
    } catch {
      return null;
    }
  }, []);

  /** Reads a token and remembers it. The event-handler path; `mutate` calls this when its own has expired. */
  const refreshCsrfToken = useCallback(async () => {
    const token = await requestCsrfToken();
    setCsrfToken(token);
    return token;
  }, [requestCsrfToken]);

  useEffect(() => {
    let active = true;

    const run = async () => {
      // In parallel: the list and the token are independent, and the page's first paint should not wait
      // for the token that only its first mutation needs.
      const [nextState, token] = await Promise.all([fetchList(), requestCsrfToken()]);

      // A real guard, not a formality: this page is one navigation away from `/trips`, and applying a
      // resolved fetch to an unmounted tree is what 5.8's list added the same flag for.
      if (!active) return;

      setState(nextState);
      setCsrfToken(token);
    };

    void run();

    return () => {
      active = false;
    };
  }, [fetchList, requestCsrfToken]);

  /**
   * One mutating call, with the retry-once-on-403 the rest of the app uses (`HeaderMenu`, the share
   * dialog): a CSRF token can expire while a page is open, and asking the user to reload for that is a
   * dead end when re-fetching the token costs one request.
   *
   * Returns the parsed envelope so each caller can map its own error codes - `owns_trips` means something
   * only to the delete action, `trip_owner` only to attach.
   *
   * **The whole body is inside one `try`, including the sends.** `fetchList` and `requestCsrfToken` both
   * guard their `fetch`; this one used to guard only `response.json()`, and the asymmetry was reachable: an
   * offline blip, a connection reset or a server restart mid-click rejects `fetch` with `TypeError`, the
   * rejection escaped the click handler as an unhandled rejection, and every one of the four busy flags
   * below is cleared on the line *after* its await. The clicked row stayed disabled behind a spinner
   * permanently, with no message, until the page was reloaded - worst on the delete path, where the admin
   * could not tell whether the account had been deleted. A rejection now returns the same
   * `{ ok: false, envelope: null }` a refused token does, so the callers' existing error branches fire.
   */
  const mutate = useCallback(
    async (path: string, method: "POST" | "PATCH" | "DELETE", body?: unknown) => {
      const failed = { ok: false, envelope: null as ApiEnvelope<unknown> | null };

      const send = async (csrf: string) =>
        fetch(path, {
          method,
          credentials: "include",
          headers: { "Content-Type": "application/json", "x-csrf-token": csrf },
          body: body === undefined ? undefined : JSON.stringify(body),
        });

      try {
        const token = csrfToken ?? (await refreshCsrfToken());
        if (!token) {
          return failed;
        }

        const attempt = async (csrf: string) => {
          const response = await send(csrf);
          const envelope = (await response.json().catch(() => null)) as ApiEnvelope<unknown> | null;
          return { ok: response.ok && !envelope?.error, status: response.status, envelope };
        };

        const first = await attempt(token);

        // Retried only for `csrf_invalid`. `requireAdmin` answers 403 `forbidden` and `requireSession` 403
        // `password_change_required` on the same status, so retrying every 403 re-sent the mutation for two
        // conditions a second attempt cannot fix - harmless only while a 403 means nothing was written, which
        // is not a property any future route is obliged to keep. The body is read once per attempt rather than
        // sniffed through a `clone()`, so the code is available to decide on without a second read.
        if (first.status === 403 && first.envelope?.error?.code === "csrf_invalid") {
          const retryToken = await refreshCsrfToken();
          if (retryToken) {
            const second = await attempt(retryToken);
            return { ok: second.ok, envelope: second.envelope };
          }
        }

        return { ok: first.ok, envelope: first.envelope };
      } catch {
        return failed;
      }
    },
    [csrfToken, refreshCsrfToken],
  );

  /**
   * A revocation that lands between this page's server-side gate and a click has to reach the same
   * `blocked` state `fetchList` produces for it, and by the same name. Without this the mutation path
   * reported a revoked admin as a generic red alert - "Unable to change the role" - for what is not a
   * failure at all but a legitimate change in who the caller is.
   *
   * @returns whether the envelope was the role refusal, in which case the caller has nothing left to say.
   */
  const consumeForbidden = useCallback((envelope: ApiEnvelope<unknown> | null) => {
    if (envelope?.error?.code !== "forbidden") return false;
    setState({ status: "blocked" });
    return true;
  }, []);

  // Memoised because `attachableTrips` below depends on `trips`, and a fresh `[]` on every render would
  // make that `useMemo` recompute every time - which the exhaustive-deps rule says out loud.
  const users = useMemo(() => (state.status === "loaded" ? state.users : []), [state]);
  const trips = useMemo(() => (state.status === "loaded" ? state.trips : []), [state]);

  // ─── Create ────────────────────────────────────────────────────────────────────────────────────────
  const createForm = useForm<CreateFormValues>({ defaultValues: { email: "", temporaryPassword: "" } });
  const createBusy = createForm.formState.isSubmitting;
  const [createError, setCreateError] = useState<string | null>(null);

  const closeCreate = useCallback(() => {
    setCreateOpen(false);
    setCreateError(null);
    createForm.reset({ email: "", temporaryPassword: "" });
  }, [createForm]);

  // EXPERIENCE.md's dirty-form question, owned by the shared guard (Story 6.25 AC7). Neither field is a
  // file input, so `formState.isDirty` is trustworthy here - the `FileList` trap that made it latch true on
  // the two hero-image forms does not apply.
  const createGuard = useDiscardGuard(createForm.formState.isDirty, closeCreate, createBusy);

  const submitCreate = createForm.handleSubmit(async (values) => {
    setCreateError(null);
    const { ok, envelope } = await mutate("/api/admin/users", "POST", {
      email: values.email,
      temporaryPassword: values.temporaryPassword,
    });

    if (!ok) {
      if (consumeForbidden(envelope)) return;
      const code = envelope?.error?.code;
      setCreateError(
        code === "email_exists"
          ? t("admin.users.create.emailExists")
          : code === "validation_error"
            ? t("admin.users.create.validationError")
            : t("admin.users.create.error"),
      );
      return;
    }

    // A committed decision closes directly rather than through the guard: re-asking "discard your changes?"
    // after the account has been created would name an outcome that is no longer on offer.
    closeCreate();
    await load();
  });

  // ─── Grant / revoke ────────────────────────────────────────────────────────────────────────────────
  const setAdminRole = async (user: AdminUser, makeAdmin: boolean) => {
    setActionError(null);
    setBusyUserId(user.id);
    const { ok, envelope } = await mutate(`/api/admin/users/${user.id}`, "PATCH", { isAdmin: makeAdmin });
    setBusyUserId(null);

    if (!ok) {
      if (consumeForbidden(envelope)) return;
      setActionError(
        envelope?.error?.code === "last_admin" ? t("admin.users.lastAdmin") : t("admin.users.roleError"),
      );
      return;
    }

    // Reloads even when the row changed is somebody else's: the last-admin rule means one account's role
    // decides whether another account's revoke button may be pressed at all.
    await load();
  };

  // ─── Attach / detach ───────────────────────────────────────────────────────────────────────────────
  const attachForm = useForm<AttachFormValues>({ defaultValues: { tripId: "", role: "VIEWER" } });
  const attachBusy = attachForm.formState.isSubmitting;
  const [attachError, setAttachError] = useState<string | null>(null);

  const closeAttach = useCallback(() => {
    setAttachTarget(null);
    setAttachError(null);
    attachForm.reset({ tripId: "", role: "VIEWER" });
  }, [attachForm]);

  const attachGuard = useDiscardGuard(attachForm.formState.isDirty, closeAttach, attachBusy);

  const submitAttach = attachForm.handleSubmit(async (values) => {
    if (!attachTarget) return;
    setAttachError(null);

    const { ok, envelope } = await mutate(`/api/admin/users/${attachTarget.id}/memberships`, "POST", {
      tripId: values.tripId,
      role: values.role,
    });

    if (!ok) {
      if (consumeForbidden(envelope)) return;
      setAttachError(t(attachErrorKey(envelope?.error?.code)));
      return;
    }

    closeAttach();
    await load();
  });

  const changeMembershipRole = async (user: AdminUser, membership: AdminMembership) => {
    setActionError(null);
    setBusyUserId(user.id);
    const { ok, envelope } = await mutate(`/api/admin/users/${user.id}/memberships`, "POST", {
      tripId: membership.tripId,
      // AC5 is a switch between exactly two values, so the row's control is a toggle rather than a select:
      // one click, and the label already says which of the two it currently is.
      role: membership.role === "VIEWER" ? "CONTRIBUTOR" : "VIEWER",
    });
    setBusyUserId(null);

    if (!ok) {
      if (consumeForbidden(envelope)) return;
      setActionError(t(attachErrorKey(envelope?.error?.code)));
      return;
    }
    await load();
  };

  /**
   * Detach is a direct action with no confirmation, unlike the account deletion below, and the difference
   * is reversibility rather than importance. A membership removed here can be put back from the same
   * screen in two clicks, and it destroys nothing - the trip, its days and its photos all belong to the
   * owner. Account deletion is irreversible and cascades, which is what earns it a confirmation.
   */
  const detach = async (user: AdminUser, membership: AdminMembership) => {
    setActionError(null);
    setBusyUserId(user.id);
    const { ok, envelope } = await mutate(`/api/admin/users/${user.id}/memberships`, "DELETE", {
      tripId: membership.tripId,
    });
    setBusyUserId(null);

    if (!ok) {
      if (consumeForbidden(envelope)) return;
      setActionError(
        envelope?.error?.code === "not_found"
          ? t("admin.users.detach.notFound")
          : t("admin.users.detach.error"),
      );
      return;
    }
    await load();
  };

  // ─── Delete ────────────────────────────────────────────────────────────────────────────────────────
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  /**
   * Refuses to close while the delete is in flight, which is what the other two dialogs get free from
   * `useDiscardGuard` (it early-returns on `busy`). This one is wired straight to `onClose`, so without the
   * guard Escape or a backdrop click during the request set `deleteTarget` to `null` and the refusal that
   * arrived a moment later was written into a dialog nobody could see - including AC7's `owns_trips` message
   * *with the blocking trip names in it*, the single most important thing this surface says.
   */
  const closeDelete = () => {
    if (deleteBusy) return;
    setDeleteTarget(null);
    setDeleteError(null);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteError(null);
    setDeleteBusy(true);
    const { ok, envelope } = await mutate(`/api/admin/users/${deleteTarget.id}`, "DELETE");
    setDeleteBusy(false);

    if (!ok) {
      if (consumeForbidden(envelope)) return;
      const code = envelope?.error?.code;
      const details = envelope?.error?.details as { tripNames?: string[] } | undefined;
      const tripNames = Array.isArray(details?.tripNames) ? details.tripNames : [];

      // Only when the names actually arrived. `ownsTrips` exists to say *which* trips are in the way, so
      // rendering it over an empty list produces "… cannot be deleted: " with nothing after the colon -
      // which is precisely the shape any envelope the client could not fully parse degrades to. The generic
      // message is honest about knowing less; that one looks broken.
      if (code === "owns_trips" && tripNames.length > 0) {
        // AC7's refusal, with the trips named. The dialog stays open holding the reason, rather than
        // closing and dropping it into the page behind - the admin asked here and is answered here.
        setDeleteError(
          formatMessage(t("admin.users.delete.ownsTrips"), {
            email: deleteTarget.email,
            trips: tripNames.join(", "),
          }),
        );
      } else if (code === "self_delete") {
        setDeleteError(t("admin.users.delete.selfDelete"));
      } else if (code === "last_admin") {
        setDeleteError(t("admin.users.lastAdmin"));
      } else {
        setDeleteError(t("admin.users.delete.error"));
      }
      return;
    }

    closeDelete();
    await load();
  };

  const attachableTrips = useMemo(
    () =>
      // The trips this account is not already the owner of. Attaching an owner to their own trip is refused
      // server-side (`trip_owner`), so offering it would be offering a certain failure. Existing
      // memberships stay in the list, because picking one of those is how a role gets changed from here.
      //
      // Which is exactly why each one carries the role it currently holds: the submit is an `upsert`, so
      // picking a trip the account is already a `CONTRIBUTOR` on and leaving the role select at its default
      // silently *demoted* them to `VIEWER` - no confirmation, no diff, and the reload afterwards showed the
      // new value as though it had been asked for. `currentRole` is what makes the picker unable to change a
      // role without saying which role it is changing.
      attachTarget
        ? trips
            .filter((trip) => !attachTarget.ownedTrips.some((owned) => owned.id === trip.id))
            .map((trip) => ({
              ...trip,
              currentRole: attachTarget.memberships.find((membership) => membership.tripId === trip.id)?.role,
            }))
        : [],
    [attachTarget, trips],
  );

  const roleLabel = (role: "VIEWER" | "CONTRIBUTOR") => t(`admin.users.role${role}`);

  return (
    <Box
      sx={{
        backgroundColor: tokens.card,
        border: `1px solid ${tokens.borderStrong}`,
        borderRadius: "8px",
        padding: "18px",
      }}
    >
      <Box display="flex" alignItems="flex-start" justifyContent="space-between" gap={2}>
        <Box>
          {/*
            `component="h1"` for the same reason 5.8's list needs it: this card is the whole page, so its
            title is the document's only heading, and `labelCaps` has no `variantMapping` of its own.
          */}
          <Typography variant="labelCaps" component="h1" sx={{ color: tokens.inkSoft }}>
            {t("admin.users.title")}
          </Typography>
          <Typography variant="body2" component="div" sx={{ mt: "4px", color: tokens.inkSoft }}>
            {t("admin.users.subtitle")}
          </Typography>
        </Box>
        {state.status === "loaded" && (
          <Button variant="contained" onClick={() => setCreateOpen(true)} sx={{ flex: "0 0 auto" }}>
            {t("admin.users.create.action")}
          </Button>
        )}
      </Box>

      <Box sx={{ mt: "14px" }}>
        {state.status === "loading" && (
          <Box display="flex" justifyContent="center" py={2}>
            <CircularProgress size={24} />
          </Box>
        )}

        {/*
          `info`, not `error`, following 5.8: nothing went wrong for a non-admin. The state is legitimate
          and not theirs to retry. It is reachable here only by a revocation landing between the page's
          server-side gate and this fetch.
        */}
        {state.status === "blocked" && <Alert severity="info">{t("admin.users.forbidden")}</Alert>}

        {state.status === "error" && <Alert severity="error">{t(state.messageKey)}</Alert>}

        {state.status === "loaded" && (
          <>
            {actionError && (
              <Alert severity="error" sx={{ mb: "12px" }} onClose={() => setActionError(null)}>
                {actionError}
              </Alert>
            )}

            <Typography
              id={countLabelId}
              variant="labelCaps"
              component="div"
              sx={{ fontSize: 11, letterSpacing: "0.06em", color: tokens.inkSoft, mb: "7px" }}
            >
              {formatMessage(t("admin.users.countLabel"), { count: users.length })}
            </Typography>

            {users.length === 0 ? (
              <Typography variant="caption" component="div" sx={{ color: tokens.inkSoft }}>
                {t("admin.users.empty")}
              </Typography>
            ) : (
              <List
                aria-labelledby={countLabelId}
                disablePadding
                sx={{
                  borderTop: `1px solid ${tokens.border}`,
                  "& .MuiListItem-root": { borderBottom: `1px solid ${tokens.border}` },
                  "& .MuiListItem-root:last-child": { borderBottom: "none" },
                }}
              >
                {users.map((user) => {
                  const isSelf = user.id === currentUserId;
                  const busy = busyUserId === user.id;

                  return (
                    <ListItem key={user.id} disableGutters sx={{ py: "12px", display: "block" }}>
                      <Box display="flex" alignItems="center" flexWrap="wrap" gap="8px">
                        <Box sx={{ fontSize: 13, fontWeight: 700, color: tokens.ink }}>{user.email}</Box>
                        {user.role === "ADMIN" && (
                          <Box
                            component="span"
                            sx={{
                              fontSize: 10,
                              fontWeight: 700,
                              letterSpacing: "0.06em",
                              textTransform: "uppercase",
                              color: tokens.inkSoft,
                              backgroundColor: tokens.pillNeutral,
                              borderRadius: "4px",
                              px: "6px",
                              py: "2px",
                            }}
                          >
                            {t("admin.users.adminBadge")}
                          </Box>
                        )}
                        {/*
                          Marks the admin's own row. Two of the refusals on this page are about *who is
                          asking* - self-deletion outright, and the last-admin rule most often reached by
                          demoting yourself - so which row is yours is information the admin needs before
                          clicking rather than in an error afterwards.
                        */}
                        {isSelf && (
                          <Box component="span" sx={{ fontSize: 11, color: tokens.inkMuted }}>
                            {t("admin.users.youBadge")}
                          </Box>
                        )}
                        {busy && <CircularProgress size={14} />}
                      </Box>

                      {/* AC3: the two relations, labelled differently, never merged. */}
                      <Box sx={{ mt: "6px", display: "flex", flexDirection: "column", gap: "4px" }}>
                        {user.ownedTrips.length === 0 && user.memberships.length === 0 && (
                          <Typography variant="caption" sx={{ color: tokens.inkMuted }}>
                            {t("admin.users.reachesNothing")}
                          </Typography>
                        )}

                        {user.ownedTrips.length > 0 && (
                          <Typography variant="caption" sx={{ color: tokens.inkSoft }}>
                            <Box component="span" sx={{ fontWeight: 700 }}>
                              {t("admin.users.ownsLabel")}
                            </Box>{" "}
                            {user.ownedTrips.map((trip) => trip.name).join(", ")}
                          </Typography>
                        )}

                        {user.memberships.map((membership) => (
                          <Box
                            key={membership.id}
                            display="flex"
                            alignItems="center"
                            flexWrap="wrap"
                            gap="6px"
                          >
                            <Typography variant="caption" sx={{ color: tokens.inkSoft }}>
                              <Box component="span" sx={{ fontWeight: 700 }}>
                                {t("admin.users.sharedLabel")}
                              </Box>{" "}
                              {membership.tripName} · {roleLabel(membership.role)}
                            </Typography>
                            {/*
                              Both buttons carry an `aria-label` naming the account and the trip, because the
                              visible labels cannot: the toggle's is the target role alone and detach's names
                              no trip, so an account with two memberships rendered two buttons called
                              "Contributor" and two called "Remove from trip" on one row - indistinguishable
                              to a screen reader, and to `getByRole`, which is why a two-membership fixture
                              could not have been tested before this. On a surface whose whole point is that
                              two relations must not be confused, the controls that act on one of them have to
                              name it.
                            */}
                            <Button
                              size="small"
                              variant="text"
                              disabled={busy}
                              aria-label={formatMessage(t("admin.users.roleToggleFor"), {
                                email: user.email,
                                trip: membership.tripName,
                                role: roleLabel(membership.role === "VIEWER" ? "CONTRIBUTOR" : "VIEWER"),
                              })}
                              onClick={() => void changeMembershipRole(user, membership)}
                              sx={{ fontSize: 11, minWidth: 0 }}
                            >
                              {roleLabel(membership.role === "VIEWER" ? "CONTRIBUTOR" : "VIEWER")}
                            </Button>
                            <Button
                              size="small"
                              variant="text"
                              disabled={busy}
                              aria-label={formatMessage(t("admin.users.detach.actionFor"), {
                                email: user.email,
                                trip: membership.tripName,
                              })}
                              onClick={() => void detach(user, membership)}
                              sx={{ fontSize: 11, minWidth: 0 }}
                            >
                              {t("admin.users.detach.action")}
                            </Button>
                          </Box>
                        ))}
                      </Box>

                      <Box sx={{ mt: "8px", display: "flex", flexWrap: "wrap", gap: "8px" }}>
                        <Button
                          size="small"
                          variant="text"
                          disabled={busy || trips.length === 0}
                          onClick={() => setAttachTarget(user)}
                          sx={{ fontSize: 11 }}
                        >
                          {t("admin.users.attach.action")}
                        </Button>
                        <Button
                          size="small"
                          variant="text"
                          disabled={busy}
                          onClick={() => void setAdminRole(user, user.role !== "ADMIN")}
                          sx={{ fontSize: 11 }}
                        >
                          {user.role === "ADMIN" ? t("admin.users.revokeAdmin") : t("admin.users.grantAdmin")}
                        </Button>
                        {/*
                          Not hidden on the admin's own row, and not hidden on an account that owns trips.
                          Both are refused server-side with a reason worth reading - "you cannot delete your
                          own account here", and AC7's list of the trips in the way - and a hidden button
                          teaches neither. Hiding it would also be the "disabled button as a guard" that
                          AC8 explicitly is not.
                        */}
                        <Button
                          size="small"
                          variant="text"
                          color="error"
                          disabled={busy}
                          onClick={() => setDeleteTarget(user)}
                          sx={{ fontSize: 11 }}
                        >
                          {t("admin.users.delete.action")}
                        </Button>
                      </Box>
                    </ListItem>
                  );
                })}
              </List>
            )}
          </>
        )}
      </Box>

      {/* ─── Create dialog ───────────────────────────────────────────────────────────────────────── */}
      <Dialog open={createOpen} onClose={createGuard.requestClose} fullWidth maxWidth="xs">
        <DialogTitleWithClose label={t("common.close")} onClose={createGuard.requestClose} disabled={createBusy}>
          {t("admin.users.create.title")}
        </DialogTitleWithClose>
        <DialogContent dividers>
          <Box display="flex" flexDirection="column" gap={2}>
            {createError && <Alert severity="error">{createError}</Alert>}
            <Box component="form" id="admin-create-user-form" onSubmit={submitCreate} display="flex" flexDirection="column" gap={2}>
              <TextField
                label={t("admin.users.create.emailLabel")}
                type="email"
                error={Boolean(createForm.formState.errors.email)}
                helperText={createForm.formState.errors.email?.message}
                {...createForm.register("email", {
                  required: t("admin.users.create.emailRequired"),
                })}
                fullWidth
              />
              <TextField
                label={t("admin.users.create.passwordLabel")}
                // AC4's `mustChangePassword` is what makes showing this safe to type in the open: the
                // account cannot keep it, and the admin has to be able to read back what they will pass on.
                //
                // `autoComplete="new-password"` is the other half of that decision: on a form whose sibling
                // field is an email, a browser or password manager will otherwise offer to save this value,
                // or autofill the *admin's own* credentials into it.
                autoComplete="new-password"
                // The rule rather than the static hint once the field is in error - a red box with no words
                // is what this replaced. Both bounds are the server's (`passwordSchema` is 8-72), so a
                // 73-character password is refused here and named, instead of returning as a generic 500-ish
                // `validation_error` the admin cannot act on.
                helperText={
                  createForm.formState.errors.temporaryPassword?.message ?? t("admin.users.create.passwordHelper")
                }
                error={Boolean(createForm.formState.errors.temporaryPassword)}
                {...createForm.register("temporaryPassword", {
                  required: t("admin.users.create.passwordRule"),
                  minLength: { value: 8, message: t("admin.users.create.passwordRule") },
                  maxLength: { value: 72, message: t("admin.users.create.passwordRule") },
                })}
                fullWidth
              />
            </Box>
          </Box>
        </DialogContent>
        <DialogActions>
          {/* Story 6.24 AC5: a form dialog's confirmation says OK. No cancel button - the title row's `✕`
              is the dismissal, and `common.cancel` was removed from both dictionaries by 6.25. */}
          <Button type="submit" form="admin-create-user-form" variant="contained" disabled={createBusy}>
            {createBusy ? <CircularProgress size={22} /> : t("admin.users.create.submit")}
          </Button>
        </DialogActions>
      </Dialog>
      <DiscardChangesDialog {...createGuard.dialogProps} />

      {/* ─── Attach dialog ───────────────────────────────────────────────────────────────────────── */}
      <Dialog open={Boolean(attachTarget)} onClose={attachGuard.requestClose} fullWidth maxWidth="xs">
        <DialogTitleWithClose label={t("common.close")} onClose={attachGuard.requestClose} disabled={attachBusy}>
          {formatMessage(t("admin.users.attach.title"), { email: attachTarget?.email ?? "" })}
        </DialogTitleWithClose>
        <DialogContent dividers>
          <Box display="flex" flexDirection="column" gap={2}>
            {attachError && <Alert severity="error">{attachError}</Alert>}
            {attachableTrips.length === 0 ? (
              <Typography variant="body2" sx={{ color: tokens.inkSoft }}>
                {t("admin.users.attach.noTrips")}
              </Typography>
            ) : (
              <Box component="form" id="admin-attach-form" onSubmit={submitAttach} display="flex" flexDirection="column" gap={2}>
                {/*
                  `Controller` rather than a spread `register` on both selects. Two reasons, and the first is
                  a bug this closes: seeding the role from the chosen trip needs the role select's displayed
                  value to follow `setValue`, and a MUI `select` with `defaultValue` and a spread `register`
                  is uncontrolled - MUI keeps its own value, so the form state and the visible option drift
                  apart. Second, the rest of this codebase reaches for `SelectProps={{ native: true }}` with
                  `<option>` children precisely so a bare `register` wires up; this dialog needs `MenuItem`
                  for the composed option label, so it takes the other supported route rather than the
                  unsupported middle.
                */}
                <Controller
                  control={attachForm.control}
                  name="tripId"
                  rules={{ required: true }}
                  render={({ field }) => (
                    <TextField
                      select
                      label={t("admin.users.attach.tripLabel")}
                      error={Boolean(attachForm.formState.errors.tripId)}
                      {...field}
                      // Seeds the role from the membership the account already holds on the chosen trip, so
                      // the value shown is the value that exists rather than a default that would demote.
                      onChange={(event) => {
                        field.onChange(event);
                        const picked = attachableTrips.find((trip) => trip.id === event.target.value);
                        attachForm.setValue("role", picked?.currentRole ?? "VIEWER");
                      }}
                      fullWidth
                    >
                      {attachableTrips.map((trip) => (
                        // The owner's address is part of the option, not decoration: trip names are not
                        // unique and two people may both have a "Norwegen 2027".
                        <MenuItem key={trip.id} value={trip.id}>
                          {trip.name} · {trip.ownerEmail}
                          {trip.currentRole
                            ? ` · ${formatMessage(t("admin.users.attach.currentRole"), {
                                role: roleLabel(trip.currentRole),
                              })}`
                            : ""}
                        </MenuItem>
                      ))}
                    </TextField>
                  )}
                />
                <Controller
                  control={attachForm.control}
                  name="role"
                  rules={{ required: true }}
                  render={({ field }) => (
                    <TextField select label={t("admin.users.attach.roleLabel")} {...field} fullWidth>
                      <MenuItem value="VIEWER">{roleLabel("VIEWER")}</MenuItem>
                      <MenuItem value="CONTRIBUTOR">{roleLabel("CONTRIBUTOR")}</MenuItem>
                    </TextField>
                  )}
                />
              </Box>
            )}
          </Box>
        </DialogContent>
        {attachableTrips.length > 0 && (
          <DialogActions>
            <Button type="submit" form="admin-attach-form" variant="contained" disabled={attachBusy}>
              {attachBusy ? <CircularProgress size={22} /> : t("admin.users.attach.submit")}
            </Button>
          </DialogActions>
        )}
      </Dialog>
      <DiscardChangesDialog {...attachGuard.dialogProps} />

      {/* ─── Delete confirmation ─────────────────────────────────────────────────────────────────── */}
      <Dialog open={Boolean(deleteTarget)} onClose={closeDelete} fullWidth maxWidth="xs">
        <DialogTitleWithClose label={t("common.close")} onClose={closeDelete} disabled={deleteBusy}>
          {t("admin.users.delete.title")}
        </DialogTitleWithClose>
        <DialogContent>
          {deleteError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {deleteError}
            </Alert>
          )}
          <Typography variant="body2" color="text.secondary">
            {formatMessage(t("admin.users.delete.body"), { email: deleteTarget?.email ?? "" })}
          </Typography>
        </DialogContent>
        <DialogActions>
          {/* Story 6.25 AC3: both buttons keep their weight and the safe one names what it preserves, in
              the same noun as its neighbour - "Keep account" beside "Delete account". */}
          <Button onClick={closeDelete} disabled={deleteBusy}>
            {t("admin.users.delete.keep")}
          </Button>
          <Button color="error" variant="contained" onClick={() => void confirmDelete()} disabled={deleteBusy}>
            {deleteBusy ? <CircularProgress size={22} /> : t("admin.users.delete.confirm")}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
