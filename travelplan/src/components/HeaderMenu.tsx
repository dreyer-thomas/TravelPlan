"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Box, IconButton, Menu, MenuItem, Typography } from "@mui/material";
import { getAuthMenuItems } from "@/lib/navigation/authMenu";
import LanguageSwitcherMenuItem from "@/components/LanguageSwitcherMenuItem";
import type { Language } from "@/i18n";
import { useI18n } from "@/i18n/provider";

type HeaderMenuProps = {
  isAuthenticated: boolean;
};

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

export default function HeaderMenu({ isAuthenticated }: HeaderMenuProps) {
  const router = useRouter();
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
      const body = (await response.json()) as ApiEnvelope<{ csrfToken: string }>;
      if (!response.ok || body.error) {
        setCsrfToken(null);
        return null;
      }

      if (body.data?.csrfToken) {
        setCsrfToken(body.data.csrfToken);
        return body.data.csrfToken;
      }
    } catch {
      setCsrfToken(null);
    }

    return null;
  };

  useEffect(() => {
    void fetchCsrfToken();
  }, []);

  const items = useMemo(() => getAuthMenuItems(authState), [authState]);
  const open = Boolean(anchorEl);
  const languageMenuOpen = Boolean(languageAnchorEl);

  const handleOpen = (event: React.MouseEvent<HTMLElement>) => {
    setLanguageError(null);
    setAnchorEl(event.currentTarget);
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

  return (
    <>
      <IconButton
        aria-label={t("header.openMenu")}
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
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        keepMounted
        PaperProps={{
          sx: {
            mt: 1.5,
            borderRadius: 3,
            px: 1,
            backgroundColor: "#ffffff",
            border: "1px solid rgba(17, 18, 20, 0.08)",
            boxShadow: "0 20px 40px rgba(17, 18, 20, 0.18)",
          },
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
          if (item.key === "logout") {
            return (
              <MenuItem key={item.key} onClick={handleLogout}>
                <Typography>{t(item.labelKey)}</Typography>
              </MenuItem>
            );
          }

          return (
            <MenuItem key={item.key} component={Link} href={item.href ?? "#"} onClick={handleClose}>
              <Typography>{t(item.labelKey)}</Typography>
            </MenuItem>
          );
        })}
        {languageError && (
          <MenuItem disabled>
            <Typography color="error">{languageError}</Typography>
          </MenuItem>
        )}
      </Menu>
    </>
  );
}
