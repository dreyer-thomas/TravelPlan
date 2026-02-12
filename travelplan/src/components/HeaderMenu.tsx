"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Box, IconButton, Menu, MenuItem, Typography } from "@mui/material";
import { getAuthMenuItems } from "@/lib/navigation/authMenu";

type HeaderMenuProps = {
  isAuthenticated: boolean;
};

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

export default function HeaderMenu({ isAuthenticated }: HeaderMenuProps) {
  const router = useRouter();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [authState, setAuthState] = useState(isAuthenticated);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);

  useEffect(() => {
    setAuthState(isAuthenticated);
  }, [isAuthenticated]);

  const fetchCsrfToken = async (): Promise<string | null> => {
    try {
      const response = await fetch("/api/auth/csrf", { method: "GET" });
      const body = (await response.json()) as ApiEnvelope<{ csrfToken: string }>;
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

  const handleOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
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
      <IconButton aria-label="Open menu" onClick={handleOpen} size="large" sx={{ color: "inherit" }}>
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
      <Menu anchorEl={anchorEl} open={open} onClose={handleClose} keepMounted>
        {items.map((item) => {
          if (item.key === "logout") {
            return (
              <MenuItem key={item.key} onClick={handleLogout}>
                <Typography>Sign out</Typography>
              </MenuItem>
            );
          }

          return (
            <MenuItem key={item.key} component={Link} href={item.href ?? "#"} onClick={handleClose}>
              <Typography>{item.label}</Typography>
            </MenuItem>
          );
        })}
      </Menu>
    </>
  );
}
