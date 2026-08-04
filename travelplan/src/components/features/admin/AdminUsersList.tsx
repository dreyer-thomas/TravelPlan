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
  IconButton,
  List,
  ListItem,
  Menu,
  MenuItem,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
  useTheme,
} from "@mui/material";
import { visuallyHidden } from "@mui/utils";
import { Controller, useForm } from "react-hook-form";
import { formatMessage } from "@/i18n";
import { useI18n } from "@/i18n/provider";
import { DialogTitleWithClose } from "@/components/ui/DialogCloseButton";
import DiscardChangesDialog, { useDiscardGuard } from "@/components/ui/DiscardChangesDialog";
import { MoreVerticalIcon, PlusIcon, TrashIcon } from "@/components/features/trips/TripIcons";

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
  /**
   * Story 5.11. The prefix for every per-row id on this surface: the overflow triggers, the one menu they
   * share, each shares-table caption and each role select's hidden label.
   *
   * `useId` rather than a literal, for the reason `TripAccommodationDialog` needs one: a fixed string
   * collides the moment a surface is mounted twice, and the ids here are already suffixed per account —
   * so a second mount would produce two elements answering to `admin-row-trigger-<userId>` and
   * `aria-controls` would resolve to whichever came first in document order.
   */
  const rowMenuIdPrefix = useId();
  const [state, setState] = useState<ListState>({ status: "loading" });
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [attachTarget, setAttachTarget] = useState<AdminUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);
  /**
   * Story 5.11. The row overflow menu: which account it belongs to, and what it hangs off.
   *
   * Two pieces of state rather than the anchor alone, because a list has one trigger per row and the
   * items need to know which account they act on. `menuUser` holds the account itself and not its id —
   * the id would have to be looked up again in `users` on every item, and every mutation replaces that
   * array wholesale (see the component docblock), so the lookup could miss.
   */
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [menuUser, setMenuUser] = useState<AdminUser | null>(null);
  /** Story 5.11. Removing a share is confirmed now; this is the pending one. */
  const [detachTarget, setDetachTarget] = useState<{ user: AdminUser; membership: AdminMembership } | null>(null);

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

  /**
   * Story 5.11. The target role is now a parameter rather than derived.
   *
   * Before this story the control was a text button whose label was the *other* value, and the handler
   * flipped it — reasonable while AC5 was a switch between exactly two values. The control is a select
   * now, so the chosen role is what the admin actually said, and reading it from the current value would
   * be inventing an answer the widget already gave.
   *
   * The no-op guard matters more than it looks: MUI fires `onChange` only on an actual change, but the
   * request is an **upsert**, so re-sending the role a membership already holds would spend a write and a
   * full list reload to arrive back where it started.
   */
  const changeMembershipRole = async (
    user: AdminUser,
    membership: AdminMembership,
    nextRole: "VIEWER" | "CONTRIBUTOR",
  ) => {
    if (nextRole === membership.role) return;
    setActionError(null);
    setBusyUserId(user.id);
    const { ok, envelope } = await mutate(`/api/admin/users/${user.id}/memberships`, "POST", {
      tripId: membership.tripId,
      role: nextRole,
    });
    setBusyUserId(null);

    if (!ok) {
      if (consumeForbidden(envelope)) return;
      setActionError(t(attachErrorKey(envelope?.error?.code)));
      return;
    }
    await load();
  };

  // ─── Detach ────────────────────────────────────────────────────────────────────────────────────────
  const [detachBusy, setDetachBusy] = useState(false);

  const closeDetach = () => {
    if (detachBusy) return;
    setDetachTarget(null);
  };

  /**
   * Story 5.11. **Removing a share is confirmed now, and that reverses a decision this file used to
   * argue for.** The previous version said so explicitly: detach was direct "and the difference is
   * reversibility rather than importance — a membership removed here can be put back from the same
   * screen in two clicks, and it destroys nothing."
   *
   * That reasoning was sound and is now outweighed by what the control became. It was a text button
   * reading "Von Reise entfernen"; it is a 44px trash glyph in a table row, sitting one row away from
   * three other trash glyphs, on a surface reached by exactly the people who can also delete accounts.
   * The word that used to say what the click costs is gone, and "two clicks to put back" assumes the
   * admin *noticed* — which is the assumption a mis-tap breaks. Same trade Story 6.24 made when
   * `Löschen` became a glyph and kept its confirmation.
   *
   * The failure message stays on the page rather than in the dialog, unlike the delete path: there is
   * no equivalent of AC7's `owns_trips` here — no refusal carries information the admin has to read
   * *inside* the dialog — so it closes and reports through `actionError` like the other row actions.
   */
  const confirmDetach = async () => {
    if (!detachTarget) return;
    const { user, membership } = detachTarget;
    setActionError(null);
    setDetachBusy(true);
    setBusyUserId(user.id);
    const { ok, envelope } = await mutate(`/api/admin/users/${user.id}/memberships`, "DELETE", {
      tripId: membership.tripId,
    });
    setDetachBusy(false);
    setBusyUserId(null);
    setDetachTarget(null);

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

  const closeRowMenu = () => {
    setMenuAnchor(null);
    setMenuUser(null);
  };

  /**
   * Story 5.11. Every menu item closes the menu **before** it acts, and the order is load-bearing.
   *
   * `TripDayView`'s overflow menu records the hazard this avoids: a trigger that unmounts while its menu
   * is open leaves `anchorEl` pointing at a detached node. Here it is not a latent edge case but the
   * normal path — two of the three items mutate, every mutation calls `load()`, and `load()` replaces the
   * whole `users` array (see the component docblock for why it re-reads rather than splices). The row
   * remounts, so the node in `menuAnchor` is gone and the menu would be anchored to nothing.
   *
   * The other two items open a dialog, where closing first is simply what should happen anyway: a menu
   * left standing behind a modal is a second dismissable layer the user did not ask for.
   */
  const runFromRowMenu = (action: () => void) => {
    closeRowMenu();
    action();
  };

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
                      {/*
                        Story 5.11. The account's name line, with the row's three actions collapsed into one
                        overflow trigger at its right edge. `alignItems: flex-start` rather than `center`:
                        the badges wrap on a narrow screen and a centred 44px glyph would drift down with
                        them, away from the name it belongs to.
                      */}
                      <Box display="flex" alignItems="flex-start" gap="8px">
                      <Box display="flex" alignItems="center" flexWrap="wrap" gap="8px" sx={{ flex: 1, minWidth: 0 }}>
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
                      {/*
                        The 44px hit area is spelled out for the reason `TripDayView`'s trigger spells it
                        out: theme.ts sets `minHeight` on `MuiButton` and has no `MuiIconButton` override,
                        so `size="small"` alone renders ~28px. The focus ring is spelled out for the same
                        reason 6.24's trash glyph is — the app-wide ring is scoped to `MuiButton`.
                      */}
                      <Tooltip title={formatMessage(t("admin.users.rowMenuFor"), { email: user.email })} enterDelay={0}>
                        <IconButton
                          id={`${rowMenuIdPrefix}-trigger-${user.id}`}
                          aria-label={formatMessage(t("admin.users.rowMenuFor"), { email: user.email })}
                          aria-haspopup="menu"
                          aria-expanded={menuUser?.id === user.id}
                          aria-controls={menuUser?.id === user.id ? `${rowMenuIdPrefix}-menu` : undefined}
                          disabled={busy}
                          onClick={(event) => {
                            setMenuAnchor(event.currentTarget);
                            setMenuUser(user);
                          }}
                          sx={{
                            flex: "0 0 auto",
                            width: 44,
                            height: 44,
                            borderRadius: "6px",
                            color: tokens.ink,
                            "&.Mui-focusVisible": { outline: `2px solid ${tokens.ink}`, outlineOffset: "2px" },
                          }}
                        >
                          <MoreVerticalIcon />
                        </IconButton>
                      </Tooltip>
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

                      </Box>

                      {/*
                        Story 5.11. The shares, as a table with the section's own add action above its right
                        edge. The memberships used to be one "Freigegeben für X · Rolle" line each with two
                        text buttons trailing it; three columns with a header row is tabular data, and the
                        cost overview's per-day list is the precedent for keeping a real `Table` rather than
                        converting it to the div-row idiom.
                      */}
                      <Box sx={{ mt: "10px" }}>
                        <Box display="flex" alignItems="center" justifyContent="space-between" gap="8px">
                          <Typography
                            id={`${rowMenuIdPrefix}-shares-${user.id}`}
                            variant="labelCaps"
                            component="div"
                            sx={{ fontSize: 11, letterSpacing: "0.06em", color: tokens.inkSoft }}
                          >
                            {t("admin.users.sharesLabel")}
                          </Typography>
                          {/*
                            The section's own entry point, and deliberately a second one: the same action is
                            in the overflow menu above, where it belongs to the account. Here it belongs to
                            this table — "add a row to this" — which is what makes a `+` legible without a
                            word. Disabled when there is no trip to attach to at all, which is the one case
                            where the dialog would open onto its own empty state.
                          */}
                          <Tooltip
                            title={formatMessage(t("admin.users.attach.title"), { email: user.email })}
                            enterDelay={0}
                          >
                            <Box component="span" sx={{ display: "inline-flex" }}>
                              <IconButton
                                aria-label={formatMessage(t("admin.users.attach.title"), { email: user.email })}
                                disabled={busy || trips.length === 0}
                                onClick={() => setAttachTarget(user)}
                                sx={{
                                  width: 44,
                                  height: 44,
                                  borderRadius: "6px",
                                  color: tokens.ink,
                                  "&.Mui-focusVisible": { outline: `2px solid ${tokens.ink}`, outlineOffset: "2px" },
                                }}
                              >
                                <PlusIcon />
                              </IconButton>
                            </Box>
                          </Tooltip>
                        </Box>

                        {user.memberships.length === 0 ? (
                          <Typography variant="caption" component="div" sx={{ color: tokens.inkMuted }}>
                            {t("admin.users.sharesEmpty")}
                          </Typography>
                        ) : (
                          <Table
                            size="small"
                            aria-labelledby={`${rowMenuIdPrefix}-shares-${user.id}`}
                            sx={{
                              "& .MuiTableCell-root": {
                                borderBottom: `1px solid ${tokens.border}`,
                                px: 0,
                                py: "6px",
                                fontSize: 12,
                              },
                              "& .MuiTableRow-root:last-of-type .MuiTableCell-root": { borderBottom: "none" },
                            }}
                          >
                            <TableHead>
                              <TableRow>
                                <TableCell
                                  sx={{ color: tokens.inkSoft, fontWeight: 700, textTransform: "uppercase", fontSize: 10 }}
                                >
                                  {t("admin.users.sharesTripColumn")}
                                </TableCell>
                                <TableCell
                                  sx={{ color: tokens.inkSoft, fontWeight: 700, textTransform: "uppercase", fontSize: 10 }}
                                >
                                  {t("admin.users.sharesRoleColumn")}
                                </TableCell>
                                {/*
                                  The trash column's header is visually hidden rather than absent: an empty
                                  `th` leaves the column unnamed for anyone reading the table by its
                                  structure, and a visible "Aktion" over a single 44px glyph is noise.
                                */}
                                <TableCell align="right">
                                  <Box component="span" sx={visuallyHidden}>
                                    {t("admin.users.sharesActionColumn")}
                                  </Box>
                                </TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {user.memberships.map((membership) => (
                                <TableRow key={membership.id}>
                                  <TableCell sx={{ color: tokens.ink, fontWeight: 600 }}>
                                    {membership.tripName}
                                  </TableCell>
                                  <TableCell>
                                    {/*
                                      `labelId`, not `aria-label`, and `TripAccommodationDialog` documents
                                      why: MUI forwards unrecognised props onto the `OutlinedInput` wrapper
                                      div, leaving the inner `role="combobox"` — the element AT actually
                                      reads — unnamed. `labelId` is the one prop `Select` routes down to it.
                                      The label it points at is hidden and names the trip, because the column
                                      header alone would call every select on the page "Rolle".
                                    */}
                                    <Box
                                      component="span"
                                      id={`${rowMenuIdPrefix}-role-label-${membership.id}`}
                                      sx={visuallyHidden}
                                    >
                                      {formatMessage(t("admin.users.roleForTrip"), { trip: membership.tripName })}
                                    </Box>
                                    <Select
                                      size="small"
                                      value={membership.role}
                                      labelId={`${rowMenuIdPrefix}-role-label-${membership.id}`}
                                      disabled={busy}
                                      onChange={(event) =>
                                        void changeMembershipRole(
                                          user,
                                          membership,
                                          event.target.value as "VIEWER" | "CONTRIBUTOR",
                                        )
                                      }
                                      sx={{ fontSize: 12, "& .MuiSelect-select": { py: "6px", minHeight: 32 } }}
                                    >
                                      <MenuItem value="VIEWER">{roleLabel("VIEWER")}</MenuItem>
                                      <MenuItem value="CONTRIBUTOR">{roleLabel("CONTRIBUTOR")}</MenuItem>
                                    </Select>
                                  </TableCell>
                                  <TableCell align="right">
                                    {/*
                                      The accessible name names the account *and* the trip, and that is not
                                      decoration: a row with two memberships otherwise renders two glyphs
                                      with identical names, indistinguishable to a screen reader and to
                                      `getByRole`. On a surface whose whole point is that two relations must
                                      not be confused, the control that acts on one of them has to name it.
                                      A real `Tooltip` rather than `title`, per 6.24's trash glyph: `title`
                                      fires on neither keyboard focus nor touch.
                                    */}
                                    <Tooltip
                                      title={formatMessage(t("admin.users.detach.actionFor"), {
                                        email: user.email,
                                        trip: membership.tripName,
                                      })}
                                      enterDelay={0}
                                    >
                                      <Box component="span" sx={{ display: "inline-flex" }}>
                                        <IconButton
                                          aria-label={formatMessage(t("admin.users.detach.actionFor"), {
                                            email: user.email,
                                            trip: membership.tripName,
                                          })}
                                          disabled={busy}
                                          onClick={() => setDetachTarget({ user, membership })}
                                          sx={{
                                            width: 44,
                                            height: 44,
                                            borderRadius: "6px",
                                            color: tokens.ink,
                                            "&.Mui-focusVisible": {
                                              outline: `2px solid ${tokens.ink}`,
                                              outlineOffset: "2px",
                                            },
                                          }}
                                        >
                                          <TrashIcon />
                                        </IconButton>
                                      </Box>
                                    </Tooltip>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        )}
                      </Box>
                    </ListItem>
                  );
                })}
              </List>
            )}

            {/*
              Story 5.11. **One menu for the whole list, not one per row.**

              The alternative — a `Menu` inside each `ListItem` — renders N menus into the DOM for an
              installation with N accounts, each with its own `Popover` and focus trap, and all but one of
              them closed. This one is driven by `menuUser`, which the trigger sets alongside the anchor,
              so the items always act on the account whose glyph was pressed.

              The chrome is `TripDayView`'s overflow menu, deliberately: right-aligned to its trigger
              (MUI's default top-left origin would open the paper over the glyph and leave `Popover`'s
              viewport clamping to drag it back), `slotProps.paper` rather than the deprecated
              `PaperProps`, and the list named by its trigger rather than by chance.

              No `aria-label` on any item — it would replace the visible label as the accessible name
              rather than supplement it, so a voice-control user saying what they read could not activate
              it (WCAG 2.5.3). `aria-haspopup="dialog"` is additive and does not touch the name, so the two
              items that open a modal carry it and the grant/revoke item, which acts directly, does not.
            */}
            <Menu
              id={`${rowMenuIdPrefix}-menu`}
              anchorEl={menuAnchor}
              open={Boolean(menuAnchor && menuUser)}
              onClose={closeRowMenu}
              anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
              transformOrigin={{ vertical: "top", horizontal: "right" }}
              slotProps={{
                paper: {
                  sx: {
                    mt: 1,
                    borderRadius: 3,
                    px: 1,
                    backgroundColor: "#ffffff",
                    border: "1px solid rgba(17, 18, 20, 0.08)",
                    boxShadow: "0 20px 40px rgba(17, 18, 20, 0.18)",
                  },
                },
                list: menuUser ? { "aria-labelledby": `${rowMenuIdPrefix}-trigger-${menuUser.id}` } : undefined,
              }}
            >
              {/*
                Ordering: the two additive actions first, the irreversible one last and separated from
                them by nothing but position — a divider between two items and one item would be more
                furniture than structure at this size.
              */}
              <MenuItem
                aria-haspopup="dialog"
                disabled={trips.length === 0}
                onClick={() => {
                  const target = menuUser;
                  runFromRowMenu(() => target && setAttachTarget(target));
                }}
              >
                <Typography>{t("admin.users.attach.action")}</Typography>
              </MenuItem>
              <MenuItem
                onClick={() => {
                  const target = menuUser;
                  runFromRowMenu(() => target && void setAdminRole(target, target.role !== "ADMIN"));
                }}
              >
                <Typography>
                  {menuUser?.role === "ADMIN" ? t("admin.users.revokeAdmin") : t("admin.users.grantAdmin")}
                </Typography>
              </MenuItem>
              {/*
                Not hidden on the admin's own row, and not hidden on an account that owns trips. Both are
                refused server-side with a reason worth reading - "you cannot delete your own account
                here", and AC7's list of the trips in the way - and a hidden item teaches neither. Hiding
                it would also be the "disabled button as a guard" that AC8 explicitly is not.
              */}
              <MenuItem
                aria-haspopup="dialog"
                onClick={() => {
                  const target = menuUser;
                  runFromRowMenu(() => target && setDeleteTarget(target));
                }}
              >
                <Typography sx={{ color: "error.main" }}>{t("admin.users.delete.action")}</Typography>
              </MenuItem>
            </Menu>
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

      {/* ─── Detach confirmation (Story 5.11) ────────────────────────────────────────────────────── */}
      <Dialog open={Boolean(detachTarget)} onClose={closeDetach} fullWidth maxWidth="xs">
        <DialogTitleWithClose label={t("common.close")} onClose={closeDetach} disabled={detachBusy}>
          {t("admin.users.detach.confirmTitle")}
        </DialogTitleWithClose>
        <DialogContent>
          {/*
            Names both sides and says what survives. "Die Reise selbst bleibt unverändert" is the sentence
            that makes this confirmation honest rather than alarming: unlike the account deletion below it
            cascades nothing, and an admin who cannot tell the two apart is the reader this surface exists
            to protect (AC3).
          */}
          <Typography variant="body2" color="text.secondary">
            {formatMessage(t("admin.users.detach.confirmBody"), {
              email: detachTarget?.user.email ?? "",
              trip: detachTarget?.membership.tripName ?? "",
            })}
          </Typography>
        </DialogContent>
        <DialogActions>
          {/* Story 6.25 AC3, as on the delete confirmation: both buttons keep their weight and the safe
              one names what it preserves, in the same noun as its neighbour. */}
          <Button onClick={closeDetach} disabled={detachBusy}>
            {t("admin.users.detach.keep")}
          </Button>
          <Button color="error" variant="contained" onClick={() => void confirmDetach()} disabled={detachBusy}>
            {detachBusy ? <CircularProgress size={22} /> : t("admin.users.detach.confirm")}
          </Button>
        </DialogActions>
      </Dialog>

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
