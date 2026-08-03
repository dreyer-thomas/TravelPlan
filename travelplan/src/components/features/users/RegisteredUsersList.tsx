"use client";

import { useEffect, useId, useState } from "react";
import { Alert, Box, CircularProgress, List, ListItem, Typography, useTheme } from "@mui/material";
import { formatMessage } from "@/i18n";
import { useI18n } from "@/i18n/provider";

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

type RegisteredUser = {
  id: string;
  email: string;
};

/**
 * One state at a time, as a union rather than four booleans: "blocked" and "loaded" are mutually
 * exclusive claims and a boolean pair can hold both at once.
 */
type ListState =
  | { status: "loading" }
  | { status: "blocked" }
  | { status: "error"; messageKey: string }
  | { status: "loaded"; users: RegisteredUser[] };

export default function RegisteredUsersList() {
  const { t } = useI18n();
  const { tokens } = useTheme().palette;
  const countLabelId = useId();
  const [state, setState] = useState<ListState>({ status: "loading" });

  useEffect(() => {
    let active = true;

    const loadUsers = async () => {
      try {
        // `cache: "no-store"` is what makes a reload show accounts registered since the last visit:
        // without it the browser is free to answer this GET from its own cache.
        const response = await fetch("/api/users", {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        });
        const body = (await response.json()) as ApiEnvelope<{ users?: RegisteredUser[] }>;

        if (!active) {
          return;
        }

        if (!response.ok || body.error || !body.data) {
          switch (body.error?.code) {
            // Not a failure: the account owns no trip, which is a thing the user can act on.
            case "forbidden":
              setState({ status: "blocked" });
              break;
            // The session died between the page render and this fetch - the middleware guards the
            // navigation, not the XHR that follows it. "Please refresh" would be a dead end, so say
            // what every other client in the app says for these two codes.
            case "unauthorized":
            case "password_change_required":
              setState({ status: "error", messageKey: "errors.unauthorized" });
              break;
            default:
              setState({ status: "error", messageKey: "users.registered.loadError" });
          }
          return;
        }

        // A 200 without the list is a broken contract, not an empty system - reporting it as "no
        // accounts registered yet" would be an affirmative claim we cannot make.
        if (!Array.isArray(body.data.users)) {
          setState({ status: "error", messageKey: "users.registered.loadError" });
          return;
        }

        setState({ status: "loaded", users: body.data.users });
      } catch {
        if (active) {
          setState({ status: "error", messageKey: "users.registered.loadError" });
        }
      }
    };

    void loadUsers();

    return () => {
      active = false;
    };
  }, []);

  return (
    <Box
      sx={{
        backgroundColor: tokens.card,
        border: `1px solid ${tokens.borderStrong}`,
        borderRadius: "8px",
        padding: "18px",
      }}
    >
      {/*
        `component="h1"`, not the `div` a `labelCaps` section label would use elsewhere: this card is
        the whole of `/users`, so its title is the page's only heading. `labelCaps` has no
        `variantMapping`, so without the explicit element the document outline here would be empty -
        the same pairing `TripDayMapFullPage.tsx:378` and `TripOverviewMapFullPage.tsx:137` use where
        a label-styled string is doing page-title duty.
      */}
      <Typography variant="labelCaps" component="h1" sx={{ color: tokens.inkSoft }}>
        {t("users.registered.title")}
      </Typography>
      <Typography variant="body2" component="div" sx={{ mt: "4px", color: tokens.inkSoft }}>
        {t("users.registered.subtitle")}
      </Typography>

      <Box sx={{ mt: "14px" }}>
        {state.status === "loading" && (
          <Box display="flex" justifyContent="center" py={2}>
            <CircularProgress size={24} />
          </Box>
        )}

        {/*
          `info`, not `error`. Introducing the `forbidden` code was justified by the UI having to
          tell "you may not see this" apart from a failure, and rendering both in the same red
          chrome would spend that distinction on the message string alone. Nothing went wrong for a
          non-owner: the state is legitimate, permanent until they own a trip, and not theirs to
          retry.
        */}
        {state.status === "blocked" && <Alert severity="info">{t("users.registered.forbidden")}</Alert>}

        {state.status === "error" && <Alert severity="error">{t(state.messageKey)}</Alert>}

        {state.status === "loaded" && (
          <>
            <Typography
              id={countLabelId}
              variant="labelCaps"
              component="div"
              sx={{ fontSize: 11, letterSpacing: "0.06em", color: tokens.inkSoft, mb: "7px" }}
            >
              {formatMessage(t("users.registered.countLabel"), { count: state.users.length })}
            </Typography>

            {/* No rows means no rule to draw: an empty bordered list is a stray hairline. */}
            {state.users.length === 0 ? (
              <Typography variant="caption" component="div" sx={{ color: tokens.inkSoft }}>
                {t("users.registered.empty")}
              </Typography>
            ) : (
              <List
                aria-labelledby={countLabelId}
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
                {state.users.map((user) => (
                  // Email only. No role, no timestamp, no per-row action - this list informs the
                  // invite, it does not perform it.
                  <ListItem key={user.id} disableGutters sx={{ py: "12px" }}>
                    <Box sx={{ fontSize: 13, fontWeight: 700, color: tokens.ink }}>{user.email}</Box>
                  </ListItem>
                ))}
              </List>
            )}
          </>
        )}
      </Box>
    </Box>
  );
}
