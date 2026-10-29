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
  Typography,
  useTheme,
} from "@mui/material";
import { formatMessage, INTL_LOCALES } from "@/i18n";
import { useI18n } from "@/i18n/provider";
import { DialogTitleWithClose } from "@/components/ui/DialogCloseButton";

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

/** One entry of `GET /api/users/me/connections`: one token family, dates as ISO strings. */
export type Connection = {
  id: string;
  clientName: string;
  redirectHost: string | null;
  connectedAt: string;
  lastUsedAt: string | null;
};

type ListState =
  | { status: "loading" }
  | { status: "error"; messageKey: string }
  | { status: "loaded"; connections: Connection[] };

type ConnectedAppsProps = {
  /** `getMcpResourceUrl()`, resolved on the server: the URL a user pastes into Claude to connect. */
  mcpUrl: string;
};

/**
 * Story 15.3. *Connected apps* / *Verbundene Apps* on the account page: every assistant that holds tokens
 * on this account, one row per connection (token family), each with a confirmed *Disconnect*.
 *
 * Only rendered while the connector is switched on - `account/page.tsx` decides that, and both routes
 * answer 404 otherwise, so a stale page fetching after the switch went off shows the load error rather
 * than an empty list that would claim nothing is connected.
 *
 * The list, CSRF and dialog handling follow `AdminUsersList`: the list and the token are fetched in
 * parallel on mount, the mutation retries once on `csrf_invalid` only, and the whole send sits inside one
 * `try` so a network failure clears the spinner and shows the error instead of leaving a dead dialog.
 * After a disconnect - or a `not_found`, which is either "already gone" or "the connector was switched
 * off" - the list is fetched again rather than edited locally, so the page shows what the server now holds
 * instead of assuming which of the two it was.
 */
export default function ConnectedApps({ mcpUrl }: ConnectedAppsProps) {
  const { t, language } = useI18n();
  const { tokens } = useTheme().palette;
  const headingId = useId();
  const [state, setState] = useState<ListState>({ status: "loading" });
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [target, setTarget] = useState<Connection | null>(null);
  // The dialog keeps the last client's name through its closing fade, after `target` is already null.
  const [dialogClient, setDialogClient] = useState("");
  const [busy, setBusy] = useState(false);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Dates in the UI language, through the same locale table the print sheet uses.
  const dateFormat = useMemo(
    () => new Intl.DateTimeFormat(INTL_LOCALES[language], { dateStyle: "medium", timeStyle: "short" }),
    [language],
  );

  const fetchList = useCallback(async (): Promise<ListState> => {
    try {
      const response = await fetch("/api/users/me/connections", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });
      const body = (await response.json()) as ApiEnvelope<{ connections?: Connection[] }>;
      if (!response.ok || body.error || !body.data) {
        const code = body.error?.code;
        // The session died between the page render and this fetch; say what the rest of the app says.
        if (code === "unauthorized" || code === "password_change_required") {
          return { status: "error", messageKey: "errors.unauthorized" };
        }
        return { status: "error", messageKey: "account.connections.loadError" };
      }
      // A 200 without the list is a broken contract, not "nothing connected".
      if (!Array.isArray(body.data.connections)) {
        return { status: "error", messageKey: "account.connections.loadError" };
      }
      return { status: "loaded", connections: body.data.connections };
    } catch {
      return { status: "error", messageKey: "account.connections.loadError" };
    }
  }, []);

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

  useEffect(() => {
    let active = true;

    const run = async () => {
      const [nextState, token] = await Promise.all([fetchList(), requestCsrfToken()]);
      if (!active) return;
      setState(nextState);
      setCsrfToken(token);
    };

    void run();

    return () => {
      active = false;
    };
  }, [fetchList, requestCsrfToken]);

  // The "Copied" label is a moment, not a state: it returns to "Copy URL" after two seconds.
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(mcpUrl);
      setCopied(true);
    } catch {
      // No clipboard (insecure context, denied permission): the URL is printed beside the button as
      // selectable text, so the fallback is to select it by hand - nothing to report.
    }
  };

  const openConfirm = (connection: Connection) => {
    setDisconnectError(null);
    setDialogClient(connection.clientName);
    setTarget(connection);
  };

  const closeConfirm = () => {
    if (busy) return;
    setTarget(null);
    setDisconnectError(null);
  };

  /** The DELETE with the retry-once-on-`csrf_invalid` of `AdminUsersList.mutate`. */
  const sendDisconnect = async (familyId: string) => {
    const send = async (csrf: string) => {
      const response = await fetch(`/api/users/me/connections/${encodeURIComponent(familyId)}`, {
        method: "DELETE",
        credentials: "include",
        headers: { "x-csrf-token": csrf },
      });
      const envelope = (await response.json().catch(() => null)) as ApiEnvelope<unknown> | null;
      return { ok: response.ok && !envelope?.error, status: response.status, code: envelope?.error?.code };
    };

    let token = csrfToken ?? (await requestCsrfToken());
    if (!token) return { ok: false, code: undefined };
    setCsrfToken(token);

    const first = await send(token);
    if (first.status === 403 && first.code === "csrf_invalid") {
      token = await requestCsrfToken();
      setCsrfToken(token);
      if (token) return send(token);
    }
    return first;
  };

  const confirmDisconnect = async () => {
    if (!target) return;
    setBusy(true);
    setDisconnectError(null);
    try {
      const result = await sendDisconnect(target.id);
      // `not_found` is a connection already gone (revoked by the assistant or in another tab) or a
      // connector switched off meanwhile. The refetch tells the two apart: the list either lacks the row
      // or fails to load.
      if (result.ok || result.code === "not_found") {
        setTarget(null);
        setState(await fetchList());
        return;
      }
      // The session ended while the page sat open: say what the list load says, not "try again".
      setDisconnectError(
        result.code === "unauthorized" || result.code === "password_change_required"
          ? t("errors.unauthorized")
          : t("account.connections.disconnectError"),
      );
    } catch {
      setDisconnectError(t("account.connections.disconnectError"));
    } finally {
      setBusy(false);
    }
  };

  const formatDate = (iso: string) => {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? "—" : dateFormat.format(date);
  };

  return (
    <Box
      component="section"
      aria-labelledby={headingId}
      sx={{
        backgroundColor: tokens.card,
        border: `1px solid ${tokens.borderStrong}`,
        borderRadius: "8px",
        padding: "18px",
      }}
    >
      <Typography id={headingId} variant="labelCaps" component="h2" sx={{ color: tokens.inkSoft }}>
        {t("account.connections.title")}
      </Typography>
      <Typography variant="body2" component="div" sx={{ mt: "4px", color: tokens.inkSoft }}>
        {t("account.connections.subtitle")}
      </Typography>

      <Box sx={{ mt: "14px" }}>
        {state.status === "loading" && (
          <Box display="flex" justifyContent="center" py={2}>
            <CircularProgress size={24} />
          </Box>
        )}

        {state.status === "error" && <Alert severity="error">{t(state.messageKey)}</Alert>}

        {state.status === "loaded" && state.connections.length === 0 && (
          <Box>
            <Typography variant="body2" component="div" sx={{ fontWeight: 700, color: tokens.ink }}>
              {t("account.connections.empty")}
            </Typography>
            <Typography variant="body2" component="div" sx={{ mt: "6px", color: tokens.inkSoft }}>
              {t("account.connections.howTo")}
            </Typography>
            <Box sx={{ mt: "8px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1 }}>
              {/* Plain, selectable text: the copy button is a convenience, this is the fallback. */}
              <Box
                component="code"
                data-testid="connector-url"
                sx={{
                  fontSize: 13,
                  color: tokens.ink,
                  userSelect: "all",
                  wordBreak: "break-all",
                  border: `1px solid ${tokens.border}`,
                  borderRadius: "4px",
                  px: "6px",
                  py: "2px",
                }}
              >
                {mcpUrl}
              </Box>
              <Button size="small" variant="outlined" onClick={() => void copyUrl()} aria-live="polite">
                {copied ? t("account.connections.copied") : t("account.connections.copy")}
              </Button>
            </Box>
          </Box>
        )}

        {state.status === "loaded" && state.connections.length > 0 && (
          <List
            aria-labelledby={headingId}
            disablePadding
            sx={{
              borderTop: `1px solid ${tokens.border}`,
              "& .MuiListItem-root": { borderBottom: `1px solid ${tokens.border}` },
              "& .MuiListItem-root:last-child": { borderBottom: "none" },
            }}
          >
            {state.connections.map((connection) => (
              <ListItem
                key={connection.id}
                disableGutters
                sx={{ py: "12px", display: "flex", alignItems: "flex-start", gap: 2 }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Box sx={{ fontSize: 13, fontWeight: 700, color: tokens.ink }}>{connection.clientName}</Box>
                  <Typography variant="caption" component="div" sx={{ color: tokens.inkSoft }}>
                    {formatMessage(t("account.connections.redirectHost"), { host: connection.redirectHost ?? "—" })}
                  </Typography>
                  <Typography variant="caption" component="div" sx={{ color: tokens.inkSoft }}>
                    {formatMessage(t("account.connections.connectedAt"), { date: formatDate(connection.connectedAt) })}
                  </Typography>
                  <Typography variant="caption" component="div" sx={{ color: tokens.inkSoft }}>
                    {formatMessage(t("account.connections.lastUsed"), {
                      date: connection.lastUsedAt ? formatDate(connection.lastUsedAt) : t("account.connections.never"),
                    })}
                  </Typography>
                </Box>
                <Button size="small" color="error" variant="outlined" onClick={() => openConfirm(connection)}>
                  {t("account.connections.disconnect")}
                </Button>
              </ListItem>
            ))}
          </List>
        )}
      </Box>

      <Dialog open={Boolean(target)} onClose={closeConfirm} fullWidth maxWidth="xs">
        <DialogTitleWithClose label={t("common.close")} onClose={closeConfirm} disabled={busy}>
          {formatMessage(t("account.connections.confirm.title"), { client: dialogClient })}
        </DialogTitleWithClose>
        <DialogContent>
          {disconnectError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {disconnectError}
            </Alert>
          )}
          <Typography variant="body2" color="text.secondary">
            {formatMessage(t("account.connections.confirm.body"), { client: dialogClient })}
          </Typography>
        </DialogContent>
        <DialogActions>
          {/* The safe choice first, as on the admin confirmations (Story 6.25 AC3). */}
          <Button onClick={closeConfirm} disabled={busy}>
            {t("account.connections.confirm.keep")}
          </Button>
          <Button color="error" variant="contained" onClick={() => void confirmDisconnect()} disabled={busy}>
            {busy ? <CircularProgress size={22} /> : t("account.connections.confirm.confirm")}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
