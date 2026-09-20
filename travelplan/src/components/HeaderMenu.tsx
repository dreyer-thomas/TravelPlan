"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Box, IconButton, Menu, MenuItem, Typography } from "@mui/material";
import { getAuthMenuItems, type AuthMenuActionKey } from "@/lib/navigation/authMenu";
import LanguageSwitcherMenuItem from "@/components/LanguageSwitcherMenuItem";
import type { Language } from "@/i18n";
import { useI18n } from "@/i18n/provider";

type HeaderMenuProps = {
  isAuthenticated: boolean;
  /**
   * Story 5.10, AC2. Resolved from the database by `AppHeader`, not from the session token - see the note
   * there.
   *
   * Defaulted so that `/page.tsx` does not have to make a claim it has no reason to resolve: the marketing
   * home page is reached **anonymously only**, because `proxy.ts` redirects any session at `/` to
   * `/trips`. (An earlier version of this comment said "anonymous and signed-in visitors", which would have
   * made the default a bug rather than a convenience - `headerMenuAdminEntry.test.tsx` has it right.)
   */
  isAdmin?: boolean;
};

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

/**
 * `/api/auth/csrf`'s body. `authenticated` is optional here on purpose, and the optionality is the
 * contract rather than laziness: the field is additive (DW-128), so a response from an older deployment,
 * a proxy cache, or one of the ~17 existing suites that stub this endpoint as `{ data: { csrfToken } }`
 * must be read as "no opinion" rather than as "signed out".
 */
type CsrfBody = {
  csrfToken: string;
  authenticated?: boolean;
};

/**
 * DW-180. MUI's `MenuItem` sets `minHeight: 48` and then resets it to `auto` inside a
 * `theme.breakpoints.up('sm')` block, so a bare `sx={{ minHeight: 44 }}` is the same one class of
 * specificity as that media rule and loses to it on every desktop width - measured at **32.3px at 747px**
 * on this very menu, against 48px at 390px. Doubling the class selector reaches (0,2,0) and the ordering
 * question disappears.
 *
 * Not exported, like `DAY_MENU_ITEM_SX` in `TripDayView.tsx` and `ROW_MENU_ITEM_SX` in
 * `AdminUsersList.tsx` - though both of those are declared inside their component functions and this one
 * sits at module scope, which is the same privacy without a per-render allocation. A shared constant was
 * considered and rejected: the value is one line and the *explanation* is the part worth having, so it is
 * spelled out here and pointed at from `LanguageSwitcherMenuItem.tsx` rather than restated there.
 */
const HEADER_MENU_ITEM_SX = { "&&": { minHeight: 44 } } as const;

export default function HeaderMenu({ isAuthenticated, isAdmin = false }: HeaderMenuProps) {
  const router = useRouter();
  /**
   * DW-129, per the 2026-08-08 decision. Presentation only: the pathname decides which row is marked as
   * the current page, never which rows exist - `getAuthMenuItems` is still a function of auth state alone,
   * which is the property stories 6.11 / 6.15 / 6.20 AC4 were protecting when they refused route coupling.
   */
  const pathname = usePathname();
  const { t } = useI18n();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [languageAnchorEl, setLanguageAnchorEl] = useState<null | HTMLElement>(null);
  const [authState, setAuthState] = useState(isAuthenticated);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [languageError, setLanguageError] = useState<string | null>(null);

  useEffect(() => {
    setAuthState(isAuthenticated);
  }, [isAuthenticated]);

  const fetchCsrfToken = async (): Promise<string | null> => {
    try {
      const response = await fetch("/api/auth/csrf", { method: "GET", credentials: "include", cache: "no-store" });
      const body = (await response.json()) as ApiEnvelope<CsrfBody>;
      if (!response.ok || body.error) {
        // A failed probe reports failure and keeps whatever token is already cached, rather than clearing
        // it. Until this function started running on every menu open it was reached only from the mount
        // effect or from immediately before a mutation, where there was nothing worth keeping; now a
        // single transient blip on an idle open would throw away a token that is still good and make the
        // next logout round-trip for a replacement. A cached token that has genuinely gone stale is
        // already handled where it is used - both mutation paths refetch once on a `403`.
        return null;
      }

      // DW-128: the one place the menu learns that the session it was server-rendered for is gone. Only an
      // explicit `false` from a successful response acts - an absent field, an error envelope, a non-ok
      // status or a thrown fetch all leave `authState` alone (each of those returns above or lands in the
      // `catch`), because none of them is evidence of being signed out.
      //
      // One direction only. Flipping back to `true` would let this endpoint *grant* the menu a session
      // state the server never rendered, and a stale-negative row is not a reported defect.
      //
      // Be precise about how that recovers, because the answer is narrower than "the prop effect fixes
      // it": `AppHeader` is a server component in the `(routes)` layout, which App Router keeps mounted
      // across a soft navigation inside that group, so the `isAuthenticated` prop does not change and the
      // effect above does not re-fire. What restores a `true` state is a document load or leaving the
      // group - both of which remount this component with the prop as its initial state. In the case this
      // guards, the session really is gone and the collapse is correct; the residual window is the one
      // where it comes back in another tab, and it closes on the next full load.
      if (body.data?.authenticated === false) {
        setAuthState(false);
      }

      if (body.data?.csrfToken) {
        setCsrfToken(body.data.csrfToken);
        return body.data.csrfToken;
      }
    } catch {
      // Same as the non-ok branch above: a network failure is not evidence that the cached token is bad.
    }

    return null;
  };

  useEffect(() => {
    void fetchCsrfToken();
  }, []);

  // `authState` rather than the `isAuthenticated` prop, because signing out flips it locally without a
  // navigation; `isAdmin` has no such local transition - only a page load changes who you are.
  const items = useMemo(() => getAuthMenuItems({ isAuthenticated: authState, isAdmin }), [authState, isAdmin]);
  const open = Boolean(anchorEl);
  const languageMenuOpen = Boolean(languageAnchorEl);

  const handleOpen = (event: React.MouseEvent<HTMLElement>) => {
    setLanguageError(null);
    setAnchorEl(event.currentTarget);
    // Revalidate on every open, not only on mount - DW-128. The mount fetch is useless to the case the
    // entry describes: a tab left open for hours, whose session expired long after this component
    // mounted. That does cost one request per open where there used to be one per mount, which is the
    // price of the guarantee AC3 states absolutely - it is a `no-store` GET that verifies a JWT and
    // re-issues a cookie, on an interaction a user performs a handful of times per page. The anchor is
    // set first so the menu opens immediately and the flag lands when it lands.
    void fetchCsrfToken();
  };

  const handleClose = () => {
    setAnchorEl(null);
    setLanguageAnchorEl(null);
    setLanguageError(null);
  };

  const handleOpenLanguageMenu = (event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    setLanguageAnchorEl(event.currentTarget);
  };

  const handleCloseLanguageMenu = () => {
    setLanguageAnchorEl(null);
  };

  const persistLanguage = async (value: Language) => {
    // Cookie-only for a signed-out visitor: there is no account to write the preference to, and the
    // cookie is what the language actually reads from either way. Note what changed underneath this
    // line - `authState` used to move only on a prop change or a confirmed logout, and DW-128's probe
    // now writes it too, so a wrongly-negative probe takes this branch and the preference reaches the
    // cookie but never the account. Deliberate rather than a hole worth guarding: in the case the probe
    // exists for the session really is gone and the `PATCH` would 401, and in the case it is wrong the
    // language still changes and still persists for this browser.
    if (!authState) {
      return true;
    }

    let token = csrfToken ?? (await fetchCsrfToken());
    if (!token) {
      setLanguageError(t("language.saveError"));
      return false;
    }

    const attemptUpdate = async (csrf: string) =>
      fetch("/api/users/me/language", {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrf,
        },
        body: JSON.stringify({ preferredLanguage: value }),
      });

    let response = await attemptUpdate(token);
    if (response.status === 403) {
      token = await fetchCsrfToken();
      if (token) {
        response = await attemptUpdate(token);
      }
    }

    if (!response.ok) {
      setLanguageError(t("language.saveError"));
      return false;
    }

    setLanguageError(null);
    return true;
  };

  const handleLanguageChange = async (value: Language) => {
    await persistLanguage(value);
    router.refresh();
  };

  const handleLogout = async () => {
    let token = csrfToken ?? (await fetchCsrfToken());
    if (!token) {
      handleClose();
      return;
    }

    const attemptLogout = async (csrf: string) =>
      fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
        headers: {
          "x-csrf-token": csrf,
        },
      });

    let response = await attemptLogout(token);
    if (response.status === 403) {
      token = await fetchCsrfToken();
      if (token) {
        response = await attemptLogout(token);
      }
    }

    if (response.ok) {
      setAuthState(false);
      router.push("/");
      router.refresh();
    }

    handleClose();
  };

  /**
   * Every action a menu row can be, keyed by the union's action keys - DW-127. Exhaustive by type: adding
   * an `{ kind: "action" }` item to `getAuthMenuItems` without a handler here fails `tsc`, which is the
   * whole point of the discriminated union. The renderer no longer tests `item.key === "logout"` at all,
   * so which item logs you out is stated where the items are, not a second time in the markup that draws
   * them.
   */
  const menuActions: Record<AuthMenuActionKey, () => void> = {
    logout: handleLogout,
  };

  return (
    <>
      <IconButton
        // DW-97 / DW-140: `aria-label` alone told a screen-reader user this was a button called "Open
        // menu" and nothing else - not that it opens a menu, nor whether that menu is open. Mirrors the
        // day hero's trigger (`TripDayView.tsx`, Story 6.11), including gating `aria-controls` on the open
        // state even though `keepMounted` leaves the list in the DOM, so this trigger reads the same way
        // as the app's existing menu triggers (`TripDayView.tsx:2102` and `:2853`, `AdminUsersList.tsx:816`
        // - four of them now, counting the language row below). The `id` is not decoration: it is what
        // names the list below (`slotProps.list`), which is the other half of the day hero's pattern and
        // the half that gives the popup a name.
        id="header-menu-button"
        aria-label={t("header.openMenu")}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? "header-menu" : undefined}
        onClick={handleOpen}
        size="large"
        sx={{
          color: "inherit",
          border: "none",
          borderRadius: 0,
          padding: 0,
          width: 32,
          height: 32,
          backgroundColor: "transparent",
        }}
      >
        <Box
          component="span"
          sx={{
            width: 22,
            height: 2,
            display: "block",
            bgcolor: "currentColor",
            boxShadow: "0 6px 0 0 currentColor, 0 12px 0 0 currentColor",
          }}
        />
      </IconButton>
      <Menu
        id="header-menu"
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        keepMounted
        // `selected` below is presentation, and this is what holds it to that. MUI's `Menu` defaults to
        // `variant="selectedMenu"`, under which `MenuList` moves initial focus onto the first `selected`
        // child and makes it the list's only tab stop - so on `/trips` the current-page marker would
        // silently reorder keyboard entry into the menu, skipping the language row above it. Worse in
        // combination with the revalidation below: focus would sit on the "All trips" anchor, the probe
        // would then unmount that row, and `document.activeElement` would fall back to `<body>` while the
        // menu was still open. `variant="menu"` focuses the list itself instead, which no row list change
        // can unmount, and leaves `aria-current` + the `Mui-selected` class as the marker they were meant
        // to be.
        variant="menu"
        // `slotProps.paper`, not the deprecated `PaperProps` (MUI 7) - the same migration `TripDayView`
        // and `AdminUsersList` already made, and it has to happen here anyway because `slotProps` is where
        // the list below is reached.
        slotProps={{
          paper: {
            sx: {
              mt: 1.5,
              borderRadius: 3,
              px: 1,
              backgroundColor: "#ffffff",
              border: "1px solid rgba(17, 18, 20, 0.08)",
              boxShadow: "0 20px 40px rgba(17, 18, 20, 0.18)",
            },
          },
          // Named by its trigger, the way both of the app's other menus name theirs. Without it the popup
          // is announced as an unnamed list of items - the trigger's three new attributes say a menu
          // exists and whether it is open, and this is what says which menu it is.
          list: { "aria-labelledby": "header-menu-button" },
        }}
      >
        <LanguageSwitcherMenuItem
          anchorEl={languageAnchorEl}
          open={languageMenuOpen}
          onOpen={handleOpenLanguageMenu}
          onClose={handleCloseLanguageMenu}
          onLanguageChange={handleLanguageChange}
        />
        {items.map((item) => {
          // Branch on the shape rather than on a key literal (DW-127). `item.href` is a `string` inside
          // this narrowing, so the `?? "#"` fallback that used to stand in for a missing one is gone -
          // there is no longer a shape it could stand in for.
          if (item.kind === "action") {
            return (
              <MenuItem key={item.key} onClick={menuActions[item.key]} sx={HEADER_MENU_ITEM_SX}>
                <Typography>{t(item.labelKey)}</Typography>
              </MenuItem>
            );
          }

          // DW-129. Exact path only: on `/trips/abc` the trips row leads somewhere else, so it is not the
          // current page and must not claim to be. `aria-current` is what a screen reader announces and
          // `selected` is what a sighted user sees; the row is still rendered and still navigable either
          // way, because 6.20 AC4 decided the self-link stays.
          const isCurrentPage = item.href === pathname;

          return (
            <MenuItem
              key={item.key}
              component={Link}
              href={item.href}
              onClick={handleClose}
              selected={isCurrentPage}
              aria-current={isCurrentPage ? "page" : undefined}
              sx={HEADER_MENU_ITEM_SX}
            >
              <Typography>{t(item.labelKey)}</Typography>
            </MenuItem>
          );
        })}
        {languageError && (
          // The floor applies here too: the row is disabled, not decorative, and it is the one row that
          // carries text a user has to read after something went wrong.
          <MenuItem disabled sx={HEADER_MENU_ITEM_SX}>
            <Typography color="error">{languageError}</Typography>
          </MenuItem>
        )}
      </Menu>
    </>
  );
}
