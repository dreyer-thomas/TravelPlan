"use client";

import Link from "next/link";
import { Box } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { useI18n } from "@/i18n/provider";

/**
 * The sign-in / register pill switch (`DESIGN.md.Components → auth-tabs`), on `/auth/login` and
 * `/auth/register` only.
 *
 * These are navigation, not a tab panel: login and register stay two routes (see the story's Scope
 * note 3), so the inactive tab is a real `next/link` and the active one is a plain `<span>` carrying
 * `aria-current="page"`. Deliberately NOT a button and NOT MUI `Tabs`/`Tab` — `getByRole("button",
 * { name: /sign in/i })` in `test/loginPage.test.tsx` must keep resolving to the submit button alone.
 */

type AuthTabsProps = {
  active: "signIn" | "register";
};

const TABS = [
  { key: "signIn", href: "/auth/login", labelKey: "auth.tabs.signIn" },
  { key: "register", href: "/auth/register", labelKey: "auth.tabs.register" },
] as const;

export default function AuthTabs({ active }: AuthTabsProps) {
  const theme = useTheme();
  const { t } = useI18n();

  const tabBase = {
    flex: 1,
    minHeight: 44, // supersedes the mockup's `padding: 8px 0` (DESIGN.md:266)
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "5px",
    fontSize: 12.5,
    fontWeight: 800,
    textDecoration: "none",
  } as const;

  return (
    <Box
      sx={{
        display: "flex",
        gap: "6px",
        backgroundColor: theme.palette.tokens.paperOuter,
        borderRadius: "7px",
        padding: "4px",
        mb: "22px",
      }}
    >
      {TABS.map((tab) =>
        tab.key === active ? (
          <Box
            key={tab.key}
            component="span"
            aria-current="page"
            sx={{
              ...tabBase,
              backgroundColor: theme.palette.tokens.card,
              color: theme.palette.tokens.ink,
              boxShadow: "0 1px 3px rgba(30,28,20,.12)",
            }}
          >
            {t(tab.labelKey)}
          </Box>
        ) : (
          <Box
            key={tab.key}
            component={Link}
            href={tab.href}
            sx={{
              ...tabBase,
              backgroundColor: "transparent",
              color: theme.palette.tokens.inkSoft,
            }}
          >
            {t(tab.labelKey)}
          </Box>
        ),
      )}
    </Box>
  );
}
